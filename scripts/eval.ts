// Main experiment (plan §7). Phases are checkpointed to eval/out/*.json; rerun with --force=<phase>.
import fs from "fs";
import path from "path";
import { D_INTAKE, D_RETRIEVAL, PILOT, specById } from "../lib/specs";
import { intake, retrieve, generateAgent, selectTools, VARIANTS, Agent, IntakeResult, RetrievalResult } from "../lib/stages";
import { API_REGISTRY, synthesizeWrapper, SynthResult } from "../lib/openapi";
import { fetchRecorded, flushRecordings, makeToolClient, toolCard, Wrapper } from "../lib/tools";
import { flushCache, LlmCall, complete } from "../lib/llm";
import { generateRarcTests, generateGenericTests, generateRandomTests, runCertification, executeTask, TestGenResult, Certificate, execute, evalProperty, TAXONOMY } from "../lib/runtime";
import { runInSandbox } from "../lib/sandbox";
import { ATTACKS, MAPPING_CASES, SEEDED_FAULTS } from "../lib/attacks";
import { REFERENCE_AGENTS } from "../lib/reference";
import { Task } from "../lib/tasks";
import { sha } from "../lib/util";
import tasksFile from "../data/tasks.json";

const OUT = path.join(process.cwd(), "eval", "out");
fs.mkdirSync(OUT, { recursive: true });
const TASKS: Task[] = (tasksFile as any).tasks;
const DATASET_HASH: string = (tasksFile as any).hash;
const force = new Set((process.argv.find((a) => a.startsWith("--force="))?.slice(8) ?? "").split(","));
const only = process.argv[2] ?? "all";

const save = (n: string, d: any) => fs.writeFileSync(path.join(OUT, n + ".json"), JSON.stringify(d));
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(OUT, n + ".json"), "utf8"));
const has = (n: string) => fs.existsSync(path.join(OUT, n + ".json")) && !force.has(n);
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function pool<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k], k); } }));
  return out;
}

// ---------------- A: intake ----------------
async function phaseIntake() {
  if (has("intake")) return load("intake");
  log("A intake on", D_INTAKE.length, "specs");
  const rows = await pool(D_INTAKE, 2, async (it) => {
    const calls: LlmCall[] = [];
    try { const r = await intake(it.text, calls, { noCache: true }); return { id: it.id, gold: it, pred: r, calls }; }
    catch (e: any) { return { id: it.id, gold: it, pred: null, error: e.message, calls }; }
  });
  save("intake", rows); flushCache();
  return rows;
}

// ---------------- B: retrieval ----------------
async function phaseRetrieval(intakeRows: any[]) {
  if (has("retrieval")) return load("retrieval");
  log("B retrieval on", D_RETRIEVAL.length, "specs (3 runs)");
  const rows = await pool(D_RETRIEVAL, 2, async (it) => {
    const ir: IntakeResult = intakeRows.find((r: any) => r.id === it.id)?.pred ?? { required_capabilities: [], constraints: [] };
    const runs: RetrievalResult[] = [];
    const calls: LlmCall[] = [];
    for (let k = 0; k < 3; k++) runs.push(await retrieve(it.text, ir, calls, { noCache: k > 0 }));
    return { id: it.id, gold: it.gold_tools, runs, calls };
  });
  save("retrieval", rows); flushCache();
  return rows;
}

// ---------------- C: wrappers ----------------
async function phaseWrappers() {
  if (has("wrappers")) return load("wrappers");
  log("C wrapper synthesis on", API_REGISTRY.length, "APIs");
  const rows: SynthResult[] = [];
  for (const api of API_REGISTRY) {
    const r = await synthesizeWrapper(api, { mode: "replay", fetchJson: (u) => fetchRecorded(u, "replay") });
    log("  ", api.id, r.valid, "repairs", r.repairs, r.attempts.map((a) => a.error ?? "ok").join(" | ").slice(0, 200));
    rows.push(r);
  }
  save("wrappers", rows); flushCache(); flushRecordings();
  return rows;
}

// ---------------- D: assembly ----------------
async function phaseAssembly(intakeRows: any[], retrievalRows: any[], wrappers: SynthResult[]) {
  if (has("agents")) return load("agents");
  log("D assembly: ", PILOT.length, "specs x", VARIANTS.length, "variants");
  const jobs = PILOT.flatMap((s) => VARIANTS.map((v) => ({ s, v })));
  const agents = await pool(jobs, 6, async ({ s, v }) => {
    const r0: RetrievalResult = retrievalRows.find((r: any) => r.id === s.id).runs[0];
    const ir = intakeRows.find((r: any) => r.id === s.id)?.pred;
    const rr = { ...r0, ...selectTools(r0.ranked, ir?.required_capabilities ?? []) };
    const ws: Wrapper[] = rr.synth_candidates.map((c) => wrappers.find((w) => w.api_id === c.api_id)?.wrapper).filter(Boolean) as Wrapper[];
    const calls: LlmCall[] = [];
    const a = await generateAgent(s, rr.selected, ws, v, calls);
    log("  ", a.agent_id, a.ok ? "ok" : "FAIL", a.model_id, "repairs", a.repairs, a.contract.violations.join(";"));
    flushCache();
    return { ...a, calls };
  });
  save("agents", agents); flushCache();
  return agents;
}

// ---------------- E: test generation ----------------
async function phaseTests(agents: any[]) {
  if (has("tests")) return load("tests");
  log("E test generation");
  const rows = await pool(PILOT, 3, async (s) => {
    const a = agents.find((x: any) => x.spec_id === s.id);
    const toolNames = [...a.tools, ...a.wrappers.map((w: Wrapper) => w.tool.name)];
    const extra = a.wrappers.map((w: Wrapper) => toolCard(w.tool));
    const heldout = TASKS.filter((t) => t.spec_id === s.id && t.split === "heldout").map((t) => ({ text: t.text, inputs: t.inputs }));
    // fixed, equal budget for every method: 3 tests x 8 categories = 24. Failed LLM calls are not cached,
    // so retrying only re-issues the missing parts.
    const budget = 24;
    let rarc = await generateRarcTests(s, toolNames, extra, heldout);
    for (let k = 0; k < 3 && rarc.tests.length < budget; k++) rarc = await generateRarcTests(s, toolNames, extra, heldout);
    let generic = await generateGenericTests(s, toolNames, extra, heldout, { budget });
    for (let k = 0; k < 3 && generic.tests.length < budget * 0.9; k++) generic = await generateGenericTests(s, toolNames, extra, heldout, { budget });
    const random = generateRandomTests(s, budget);
    log("  ", s.id, "rarc", rarc.tests.length, "/", rarc.generated, "generic", generic.tests.length, "random", random.tests.length);
    flushCache();
    return { spec_id: s.id, rarc, generic, random };
  });
  save("tests", rows); flushCache();
  return rows;
}

// ---------------- F: certification + task runs ----------------
function slimTrace(tr: any[]) { return tr.map((s) => ({ tool: s.tool, ok: s.ok, ms: s.ms, fault: s.fault, err: s.error?.code, args: JSON.stringify(s.args).slice(0, 160) })); }

async function phaseRuns(agents: any[], tests: any[]) {
  if (has("runs")) return load("runs");
  log("F certification + task runs for", agents.length, "agents");
  const certs: any[] = [];
  const runs: any[] = [];
  await pool(agents, 3, async (a: any) => {
    const spec = specById(a.spec_id)!;
    const ts = tests.find((t: any) => t.spec_id === a.spec_id);
    const cert: Record<string, Certificate> = {};
    const tcert0 = Date.now();
    for (const m of ["rarc", "generic", "random"]) {
      const t0 = Date.now();
      cert[m] = a.ok ? await runCertification(a, spec, ts[m], { concurrency: 4 }) : { method: m, score: 0, per_category: {}, weakest: [], basis: "synthetic tests", outcomes: ts[m].tests.map((t: any) => ({ test_id: t.id, category: t.category, pass: false, why: "E_CONTRACT", status: "error", error_code: "E_CONTRACT", tool_calls: 0, ms: 0 })) };
      (cert[m] as any).wall_ms = Date.now() - t0;
    }
    certs.push({ agent_id: a.agent_id, spec_id: a.spec_id, variant: a.variant, cert, cert_wall_ms: Date.now() - tcert0 });
    const myTasks = TASKS.filter((t) => t.spec_id === a.spec_id);
    for (let rep = 0; rep < 3; rep++) {
      await pool(myTasks, 4, async (t) => {
        const r = await executeTask(a, spec, t, { mode: "replay" });
        runs.push({
          run_id: sha(`${a.agent_id}|${t.id}|${rep}`, 12), timestamp: new Date().toISOString(), run_type: "real_task", repeat: rep,
          spec_id: a.spec_id, spec_version: sha(spec.text, 8), task_id: t.id, task_category: spec.category, split: t.split, hard: t.hard, hard_reason: t.hard_reason,
          agent_id: a.agent_id, agent_version: a.variant, code_hash: a.code_hash, tool_ids: a.tools, synthesized_tool_ids: a.wrappers.map((w: Wrapper) => w.tool.name),
          cert_score_at_run_time: Object.fromEntries(Object.entries(cert).map(([k, v]) => [k, v.score])), cert_breakdown: Object.fromEntries(Object.entries(cert.rarc.per_category).map(([k, v]: any) => [k, v.rate])),
          trace: slimTrace(r.trace), status: r.run.status, error_code: r.run.error_code, error_message: r.run.error_message?.slice(0, 200), answer: r.run.answer,
          checker_result: { success: r.check!.success, partial_score: r.check!.partial_score, failed: r.check!.checks.filter((c) => !c.ok).map((c) => c.name), expected: r.check!.expected_status, got: r.check!.got_status },
          tool_stats: r.stats, stage_latencies: { execution_ms: r.run.duration_ms }, terminated_within_budget: r.run.terminated_within_budget, dataset_hash: DATASET_HASH,
        });
      });
    }
    log("  ", a.agent_id, "rarc", cert.rarc.score.toFixed(2), "generic", cert.generic.score.toFixed(2), "random", cert.random.score.toFixed(2), "TSR", (runs.filter((r) => r.agent_id === a.agent_id && r.repeat === 0 && r.split === "heldout" && r.checker_result.success).length / 7).toFixed(2));
  });
  const out = { certs, runs };
  save("runs", out);
  return out;
}

// ---------------- G: seeded faults ----------------
async function phaseFaults(agents: any[], tests: any[], runsOut: any) {
  if (has("faults")) return load("faults");
  log("G seeded faults");
  // 10 working agents: best v1/v2/v3 agent per spec by held-out TSR, first 10 specs by TSR
  const tsr = (id: string) => runsOut.runs.filter((r: any) => r.agent_id === id && r.repeat === 0).filter((r: any) => r.checker_result.success).length;
  const best = PILOT.map((s) => agents.filter((a: any) => a.spec_id === s.id && a.ok).sort((x: any, y: any) => tsr(y.agent_id) - tsr(x.agent_id))[0]).filter(Boolean).sort((x: any, y: any) => tsr(y.agent_id) - tsr(x.agent_id)).slice(0, 10);
  const rows: any[] = [];
  for (const a of best) {
    const spec = specById(a.spec_id)!;
    const base = runsOut.certs.find((c: any) => c.agent_id === a.agent_id).cert;
    const ts = tests.find((t: any) => t.spec_id === a.spec_id);
    for (const f of SEEDED_FAULTS) {
      const fa = { ...a, code: a.code + "\n" + f.wrap(spec.input_schema.filter((x) => x.required).map((x) => x.name)) };
      const det: any = {};
      for (const m of ["rarc", "generic", "random"]) {
        const c = await runCertification(fa, spec, ts[m], { concurrency: 4 });
        const newFails = c.outcomes.filter((o, i) => !o.pass && base[m].outcomes[i]?.pass).length;
        det[m] = { detected: newFails > 0, new_failures: newFails, score: c.score, base_score: base[m].score };
      }
      rows.push({ agent_id: a.agent_id, fault: f.id, fault_name: f.name, targets: f.targets, det });
      log("  ", a.agent_id, f.id, Object.entries(det).map(([m, d]: any) => `${m}:${d.detected ? "Y" : "n"}(${d.new_failures})`).join(" "));
    }
  }
  save("faults", rows);
  return rows;
}

// ---------------- H: sandbox suite ----------------
async function phaseSandbox() {
  if (has("sandbox")) return load("sandbox");
  log("H sandbox attack suite");
  const canaryVal = "CANARY-" + sha(String(Math.random()), 10);
  process.env.RARC_CANARY = canaryVal;
  const dir = fs.mkdtempSync(path.join(process.cwd(), "eval", "canary-"));
  const canaryFile = path.join(dir, "secret.txt");
  const fileVal = "FILECANARY-" + sha(String(Math.random()), 10);
  fs.writeFileSync(canaryFile, fileVal);
  const spawnMarker = path.join(dir, "spawned");
  const keyPrefixes = [process.env.GROQ_API_KEY?.slice(0, 12), process.env.GOOGLE_AI_STUDIO_API_KEY?.slice(0, 12)].filter(Boolean) as string[];
  const realFetch = globalThis.fetch;
  let hostFetches = 0;
  (globalThis as any).fetch = (...a: any[]) => { hostFetches++; return (realFetch as any)(...a); };
  const attacks: any[] = [];
  for (const at of ATTACKS) {
    const before = hostFetches;
    const tc = makeToolClient({ allowed: ["search_hotels", "get_person_profile", "book_hotel", "send_invite"], mode: "replay" });
    const r = await runInSandbox({ code: at.code, task: { inputs: {} }, context: { now: tc.now, confirmed: false, canary_file: canaryFile, canary_spawn: spawnMarker }, category: "C2", toolCall: tc.call, limits: { wallMs: 3000 } });
    const blob = JSON.stringify([r.answer, r.raw, r.logs, r.error_message]);
    const leaks = [blob.includes(canaryVal) && "env", blob.includes(fileVal) && "file", fs.existsSync(spawnMarker) && "spawn", keyPrefixes.some((k) => blob.includes(k)) && "api_key", hostFetches > before && "network"].filter(Boolean);
    // runtime-only layer (static contract check disabled): defence in depth
    const r2 = await runInSandbox({ code: at.code, task: { inputs: {} }, context: { now: tc.now, confirmed: false, canary_file: canaryFile, canary_spawn: spawnMarker }, category: "C2", toolCall: makeToolClient({ allowed: ["search_hotels", "get_person_profile", "book_hotel", "send_invite"], mode: "replay" }).call, limits: { wallMs: 3000 }, skipStatic: true });
    const blob2 = JSON.stringify([r2.answer, r2.raw, r2.logs, r2.error_message]);
    const leaks2 = [blob2.includes(canaryVal) && "env", blob2.includes(fileVal) && "file", fs.existsSync(spawnMarker) && "spawn", keyPrefixes.some((k) => blob2.includes(k)) && "api_key"].filter(Boolean);
    attacks.push({ id: at.id, cls: at.cls, error_code: r.error_code, expected: at.expect, blocked_as_intended: at.expect.includes(r.error_code), escaped: leaks.length > 0, leaks, duration_ms: r.duration_ms, within_budget: r.terminated_within_budget, killed: r.killed, msg: r.error_message?.slice(0, 120), runtime_only: { error_code: r2.error_code, escaped: leaks2.length > 0, leaks: leaks2, within_budget: r2.terminated_within_budget } });
    log("  ", at.id.padEnd(22), r.error_code, leaks.join(",") || "-", "| runtime-only:", r2.error_code, r.duration_ms + "ms");
  }
  (globalThis as any).fetch = realFetch;
  const mapping: any[] = [];
  for (const mc of MAPPING_CASES) {
    const tc = makeToolClient({ allowed: ["search_hotels", "book_hotel", "send_invite"], mode: "replay", faults: mc.faults as any });
    const r = await runInSandbox({ code: mc.code, task: { inputs: {} }, context: { now: tc.now, confirmed: false }, category: "C2", toolCall: tc.call, limits: { wallMs: 2500 } });
    mapping.push({ id: mc.id, expected: mc.expect, got: r.error_code, ok: r.error_code === mc.expect });
  }
  log("  mapping", mapping.filter((m) => m.ok).length, "/", mapping.length);
  // false kills + overhead on reference agents
  const refRuns: any[] = [];
  for (const [sid, ref] of Object.entries(REFERENCE_AGENTS)) {
    const spec = specById(sid)!;
    for (const t of TASKS.filter((t) => t.spec_id === sid)) {
      for (let rep = 0; rep < 3; rep++) {
        const r = await executeTask({ ...ref, wrappers: [], category: spec.category } as any, spec, t, { mode: "replay" });
        // bare (unsandboxed, trusted reference code only) run for overhead
        const tc = makeToolClient({ allowed: ref.tools, mode: "replay" });
        const tb = Date.now();
        const fn = new Function("return (" + ref.code.replace(/^async function run/, "async function") + ")")();
        let bare: any;
        try { bare = await fn({ inputs: t.inputs }, { call: async (n: string, a: any) => { const x = await tc.call(n, a); if (x.error) { const e: any = new Error(x.error.message); e.code = x.error.code; e.name = "ToolError"; throw e; } return x.data; } }, { now: tc.now, confirmed: false }); } catch {}
        refRuns.push({ spec_id: sid, task_id: t.id, rep, killed: ["E_TIMEOUT", "E_RESOURCE"].includes(r.run.error_code ?? ""), error_code: r.run.error_code, success: r.check!.success, sandbox_ms: r.run.duration_ms, bare_ms: Date.now() - tb, bare_status: bare?.status });
      }
    }
  }
  log("  reference agents:", refRuns.filter((r) => r.success).length, "/", refRuns.length, "checker-pass; killed", refRuns.filter((r) => r.killed).length);
  fs.rmSync(dir, { recursive: true, force: true });
  const out = { attacks, mapping, refRuns };
  save("sandbox", out);
  return out;
}

// ---------------- I: failure tagging ----------------
async function phaseTagging(agents: any[], runsOut: any) {
  if (has("tags")) return load("tags");
  const fails = runsOut.runs.filter((r: any) => r.repeat === 0 && !r.checker_result.success);
  log("I failure tagging:", fails.length, "failures");
  const byProv: Record<string, any[]> = {};
  for (const f of fails) { const prov = agents.find((a: any) => a.agent_id === f.agent_id)?.provider ?? "gemini"; (byProv[prov] ??= []).push(f); }
  const tags: Record<string, { primary: string; secondary: string[]; judge: string }> = {};
  const calls: LlmCall[] = [];
  for (const [prov, list] of Object.entries(byProv)) {
    const role = prov === "gemini" ? "judge_for_gemini" : "judge_for_groq";
    for (let i = 0; i < list.length; i += 12) {
      const batch = list.slice(i, i + 12);
      const sys = `You tag agent failures with ONE primary category of a failure taxonomy (or "Other"), plus optional secondary ones.\n${TAXONOMY.map((t) => `${t.id}: ${t.name}`).join("\n")}\nReturn JSON {"tags":[{"run_id":str,"primary":"T#"|"Other","secondary":["T#"]}]}`;
      const user = batch.map((f: any) => `run_id=${f.run_id} | task=${TASKS.find((t) => t.id === f.task_id)?.text} | inputs=${JSON.stringify(TASKS.find((t) => t.id === f.task_id)?.inputs)} | expected=${f.checker_result.expected} got=${f.checker_result.got} | error=${f.error_code ?? "-"} ${f.error_message ?? ""} | failed_checks=${f.checker_result.failed.join("; ")} | tool_calls=${f.trace.map((s: any) => `${s.tool}${s.ok ? "" : "!" + s.err}`).join(",")}`).join("\n");
      try {
        const r = await complete(role as any, [{ role: "system", content: sys }, { role: "user", content: user }], { json: true, calls, stage: "taxonomy_tagging" });
        for (const t of r.json?.tags ?? []) if (t?.run_id) tags[t.run_id] = { primary: String(t.primary), secondary: Array.isArray(t.secondary) ? t.secondary.map(String) : [], judge: r.call.model_id };
      } catch (e: any) { log("   tagging batch failed", e.message.slice(0, 100)); }
    }
  }
  save("tags", { tags, calls }); flushCache();
  return { tags, calls };
}

(async () => {
  const t0 = Date.now();
  const intakeRows = await phaseIntake();
  if (only === "intake") return;
  const retrievalRows = await phaseRetrieval(intakeRows);
  const wrappers = await phaseWrappers();
  if (only === "wrappers") return;
  const agents = await phaseAssembly(intakeRows, retrievalRows, wrappers);
  if (only === "agents") return;
  const tests = await phaseTests(agents);
  const sandbox = only === "sandbox" ? await phaseSandbox() : null;
  if (only === "sandbox") return;
  const runsOut = await phaseRuns(agents, tests);
  await phaseFaults(agents, tests, runsOut);
  if (!sandbox) await phaseSandbox();
  await phaseTagging(agents, runsOut);
  flushCache(); flushRecordings();
  log("done in", Math.round((Date.now() - t0) / 1000), "s");
})();
