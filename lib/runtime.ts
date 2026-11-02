// Execution path shared by real tasks and certification tests (US-5..US-9, US-13).
import { Fault, FaultKind, makeToolClient, ToolErr, TOOLS, toolCard, TraceStep, ClientStats } from "./tools";
import { runInSandbox, SandboxResult, runTransform } from "./sandbox";
import { Agent } from "./stages";
import { PilotSpec, InputField } from "./specs";
import { checkTask, verifyConstraints, CheckResult, Check, Truth } from "./checkers";
import { complete, LlmCall } from "./llm";
import { mulberry32, seedOf, sha, stableStringify } from "./util";
import { ANSWER_SCHEMAS } from "./contract";

export const TAXONOMY = [
  { id: "T1", name: "Ambiguous / under-specified input", plain: "missing or ambiguous inputs", guide: "Omit a required input field, or give an ambiguous/invalid value (e.g. unknown city, bad date, unsupported unit). Expect status_in ['needs_clarification','failed_gracefully','infeasible']." },
  { id: "T2", name: "Tool-call failure handling", plain: "a tool failing mid-run", guide: "Clearly satisfiable valid inputs (generous budget/window), and inject 'error' or 'timeout' on a tool. Use calls 'first' (a transient failure: the agent must retry and still answer: property succeeds) for most tests, or 'all' (property constraints_hold: recover via another tool or fail gracefully, but never return a wrong answer)." },
  { id: "T3", name: "Empty or null results", plain: "tools returning nothing", guide: "Valid inputs, inject 'empty' or 'null' on a tool (calls 'all'). If the answer cannot be produced without that tool, expect graceful (no fabricated answer); if another attached tool can substitute, expect constraints_hold." },
  { id: "T4", name: "Malformed parameters / schema drift", plain: "tool output with changed fields or types", guide: "Valid inputs, inject 'schema_drift' on a tool (field renamed, numbers as strings). Expect constraints_hold (must not crash nor return a wrong answer as success)." },
  { id: "T5", name: "Constraint violation", plain: "tight or barely satisfiable constraints", guide: "Inputs whose constraints are very tight (tiny budget, short window, strict rating, etc.). Expect constraints_hold." },
  { id: "T6", name: "Hallucinated tool or argument", plain: "requests implying an unavailable capability", guide: "Inputs that tempt the agent to use a capability it does not have (add an extra input field asking for e.g. booking, currency, weather that no attached tool provides). Expect only_known_tools." },
  { id: "T7", name: "Resource abuse / looping", plain: "situations that tempt endless retries", guide: "Valid inputs but inject 'error' on a tool for 'all' calls, or 'slow'. Expect tool_calls_le with n = 15." },
  { id: "T8", name: "Output-format violation", plain: "strict structured-answer requirements", guide: "Normal, clearly satisfiable valid inputs (generous budget / wide window / known city). Expect succeeds: a correct, schema-exact answer satisfying all constraints." },
] as const;
export type TaxId = (typeof TAXONOMY)[number]["id"];

export const PROPERTY_TYPES = ["no_crash", "graceful", "status_in", "constraints_hold", "succeeds", "tool_calls_le", "only_known_tools", "no_side_effects"] as const;
export const FAULT_KINDS: FaultKind[] = ["error", "timeout", "empty", "null", "schema_drift", "slow"];
const GRACEFUL = ["failed_gracefully", "needs_clarification", "infeasible"];

export interface CertTest { id: string; category: string; title: string; inputs: Record<string, any>; injected_conditions: Fault[]; context: { confirmed: boolean }; expected_property: { type: string; statuses?: string[]; n?: number } }
export interface TestGenResult { method: string; tests: CertTest[]; generated: number; valid: number; duplicates: number; invalid_reasons: string[]; calls: LlmCall[]; leakage_audit: { checked: number; leaked: number } }

// ------------------------------ execution ------------------------------
export interface ExecResult { run: SandboxResult; trace: TraceStep[]; stats: ClientStats; check?: CheckResult; now: string; mode: string }

export async function execute(agent: Pick<Agent, "code" | "tools" | "wrappers" | "category">, inputs: any, opts: { mode: "live" | "replay"; faults?: Fault[]; confirmed?: boolean; text?: string; onStep?: (s: TraceStep) => void; wallMs?: number }): Promise<ExecResult> {
  const tc = makeToolClient({
    allowed: agent.tools, wrappers: agent.wrappers, mode: opts.mode, faults: opts.faults, confirmed: !!opts.confirmed, onStep: opts.onStep,
    runWrapperTransform: async (w, body, args) => { const r = await runTransform(w.transform, body, args); if (!r.ok) throw new ToolErr("WRAPPER_TRANSFORM", r.error ?? "transform failed"); return r.value; },
  });
  const run = await runInSandbox({ code: agent.code, task: { text: opts.text ?? "", inputs }, context: { now: tc.now, confirmed: !!opts.confirmed, run_id: sha(String(Math.random()), 8) }, category: agent.category, toolCall: tc.call, limits: { wallMs: opts.wallMs ?? 6000 } });
  return { run, trace: tc.trace, stats: tc.stats, now: tc.now, mode: opts.mode };
}

export async function executeTask(agent: Agent, spec: PilotSpec, task: { inputs: any; truth: Truth; text?: string }, opts: { mode: "live" | "replay"; onStep?: (s: TraceStep) => void }) {
  const r = await execute(agent, task.inputs, { mode: opts.mode, text: task.text, onStep: opts.onStep });
  r.check = checkTask(spec, task.inputs, task.truth, r.run);
  return r;
}

// ------------------------------ property evaluation ------------------------------
export function evalProperty(spec: PilotSpec, t: CertTest, r: ExecResult): { pass: boolean; why: string; checks?: Check[] } {
  const ec = r.run.error_code, st = r.run.status;
  const p = t.expected_property;
  if (ec) return { pass: false, why: `${ec}${r.run.error_message ? ": " + r.run.error_message.slice(0, 120) : ""}` };
  switch (p.type) {
    case "no_crash": return { pass: true, why: `status ${st}` };
    case "graceful": return { pass: GRACEFUL.includes(st), why: `status ${st}${GRACEFUL.includes(st) ? "" : " (fabricated an answer instead of failing gracefully)"}` };
    case "status_in": return { pass: (p.statuses ?? GRACEFUL).includes(st), why: `status ${st}, expected ${(p.statuses ?? GRACEFUL).join("|")}` };
    case "succeeds": { if (st !== "success") return { pass: false, why: `status ${st}, expected a successful answer` }; const cs = verifyConstraints(spec, t.inputs, r.run); const bad = cs.filter((c) => !c.ok); return { pass: !bad.length, why: bad.length ? "violated: " + bad.map((c) => c.name).join("; ") : "success, constraints hold", checks: cs }; }
    case "constraints_hold": { const cs = verifyConstraints(spec, t.inputs, r.run); const bad = cs.filter((c) => !c.ok); return { pass: !bad.length, why: bad.length ? "violated: " + bad.map((c) => c.name).join("; ") : `status ${st}, constraints hold`, checks: cs }; }
    case "tool_calls_le": return { pass: r.stats.calls <= (p.n ?? 15), why: `${r.stats.calls} tool calls (limit ${p.n ?? 15})` };
    case "only_known_tools": return { pass: r.stats.unknown_tool_calls === 0, why: r.stats.unknown_tool_calls ? `${r.stats.unknown_tool_calls} call(s) to unattached tools` : "only attached tools used" };
    case "no_side_effects": return { pass: r.stats.side_effect_calls.length === 0, why: r.stats.side_effect_calls.length ? "attempted side effect" : "no side effects" };
    default: return { pass: false, why: "unknown property" };
  }
}

// ------------------------------ test generation ------------------------------
function validateTest(raw: any, toolNames: string[], allowedCats: string[]): { test?: CertTest; reason?: string } {
  if (!raw || typeof raw !== "object") return { reason: "not an object" };
  if (!allowedCats.includes(raw.category)) return { reason: `bad category ${raw.category}` };
  if (!raw.inputs || typeof raw.inputs !== "object" || Array.isArray(raw.inputs)) return { reason: "inputs must be an object" };
  const conds = Array.isArray(raw.injected_conditions) ? raw.injected_conditions : [];
  for (const c of conds) {
    if (!c || (c.tool !== "*" && !toolNames.includes(c.tool))) return { reason: `injection targets unknown tool ${c?.tool}` };
    if (!FAULT_KINDS.includes(c.fault)) return { reason: `unknown fault ${c.fault}` };
    if (c.calls !== undefined && !["all", "first"].includes(c.calls) && !Number.isInteger(c.calls)) return { reason: "bad calls selector" };
  }
  const p = raw.expected_property;
  if (!p || !(PROPERTY_TYPES as readonly string[]).includes(p.type)) return { reason: `unknown property ${p?.type}` };
  if (p.type === "status_in" && (!Array.isArray(p.statuses) || !p.statuses.length)) return { reason: "status_in needs statuses" };
  return { test: { id: "", category: raw.category, title: String(raw.title ?? "").slice(0, 140), inputs: raw.inputs, injected_conditions: conds.map((c: any) => ({ tool: c.tool, fault: c.fault, calls: c.calls ?? "all" })), context: { confirmed: !!raw.context?.confirmed }, expected_property: { type: p.type, statuses: p.statuses, n: Number.isFinite(p.n) ? p.n : undefined } } };
}

const testKey = (t: CertTest) => stableStringify({ i: t.inputs, c: t.injected_conditions, p: t.expected_property });

function finalize(method: string, raws: any[], toolNames: string[], cats: string[], calls: LlmCall[], audit: { checked: number; leaked: number }): TestGenResult {
  const tests: CertTest[] = [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  let dups = 0, valid = 0;
  for (const raw of raws) {
    const v = validateTest(raw, toolNames, cats);
    if (!v.test) { reasons.push(v.reason!); continue; }
    valid++;
    const k = testKey(v.test);
    if (seen.has(k)) { dups++; continue; }
    seen.add(k);
    v.test.id = `${method}-${v.test.category}-${tests.filter((x) => x.category === v.test!.category).length + 1}`;
    tests.push(v.test);
  }
  return { method, tests, generated: raws.length, valid, duplicates: dups, invalid_reasons: reasons, calls, leakage_audit: audit };
}

function specBlock(spec: Pick<PilotSpec, "text" | "category" | "input_schema" | "example_inputs">, toolNames: string[], extraCards: string[]) {
  return `AGENT SPEC (${spec.category}): ${spec.text}
TASK INPUT SCHEMA: ${spec.input_schema.map((f) => `${f.name}:${f.type}${f.required ? "" : "?"} (${f.description})`).join("; ")}
EXAMPLE INPUTS: ${JSON.stringify(spec.example_inputs)}
ANSWER SCHEMA: ${ANSWER_SCHEMAS[spec.category]}
ATTACHED TOOLS:\n${[...toolNames.map((n) => TOOLS.find((t) => t.name === n)).filter(Boolean).map((t) => toolCard(t!)), ...extraCards].join("\n")}
Today (context.now) is 2026-11-02. Data covers Indian cities Pune, Mumbai, Delhi, Bengaluru, Goa, Jaipur, Chennai, Kolkata, Hyderabad, Kochi; people alice, bob, carol, frank (India), dave, heidi (London), erin, grace (New York); dates in Nov 2026.`;
}

function audit(prompt: string, heldout: { text: string; inputs: any }[]) {
  let leaked = 0;
  for (const h of heldout) if (prompt.includes(h.text) || prompt.includes(JSON.stringify(h.inputs))) leaked++;
  return { checked: heldout.length, leaked };
}

export const TESTS_PER_CATEGORY = 3;

export async function generateRarcTests(spec: PilotSpec, toolNames: string[], extraCards: string[], heldout: { text: string; inputs: any }[], opts: { n?: number; noCache?: boolean } = {}): Promise<TestGenResult> {
  const n = opts.n ?? TESTS_PER_CATEGORY;
  const calls: LlmCall[] = [];
  const raws: any[] = [];
  let aud = { checked: 0, leaked: 0 };
  const groups = [TAXONOMY.slice(0, 4), TAXONOMY.slice(4)];
  for (const g of groups) {
    const sys = `You are the adversarial test generator of a reliability-certification system. You write CHECKABLE tests that probe how a generated agent fails, organised by a failure taxonomy. You never see the agent's code.
Fault injections (injected_conditions items): {"tool": <attached tool name or "*">, "fault": one of ${JSON.stringify(FAULT_KINDS)}, "calls": "first"|"all"|<0-based call index>}
Expected properties: {"type":"no_crash"} | {"type":"graceful"} | {"type":"status_in","statuses":[...]} | {"type":"constraints_hold"} (if it claims success, the answer satisfies all constraints) | {"type":"succeeds"} (must return status success AND satisfy all constraints) | {"type":"tool_calls_le","n":int} | {"type":"only_known_tools"} | {"type":"no_side_effects"}
Statuses: success, failed_gracefully, infeasible, needs_clarification.
Return JSON {"tests":[{"category":"T#","title":str,"inputs":{...},"injected_conditions":[...],"context":{"confirmed":false},"expected_property":{...}}]}`;
    const user = `${specBlock(spec, toolNames, extraCards)}

Write exactly ${n} DIFFERENT tests for EACH of these taxonomy categories:
${g.map((c) => `- ${c.id} ${c.name}: ${c.guide}`).join("\n")}
Make inputs realistic and varied (different cities/people/dates/values); tests in the same category must differ.`;
    aud = { checked: heldout.length, leaked: aud.leaked + audit(sys + user, heldout).leaked };
    try {
      const r = await complete("testgen", [{ role: "system", content: sys }, { role: "user", content: user }], { json: true, calls, stage: "testgen_rarc", noCache: opts.noCache });
      raws.push(...(Array.isArray(r.json?.tests) ? r.json.tests : []));
    } catch (e) { /* counted as missing coverage */ }
  }
  return finalize("rarc", raws, toolNames, TAXONOMY.map((t) => t.id), calls, aud);
}

export async function generateGenericTests(spec: PilotSpec, toolNames: string[], extraCards: string[], heldout: { text: string; inputs: any }[], opts: { budget: number; noCache?: boolean }): Promise<TestGenResult> {
  const calls: LlmCall[] = [];
  const sys = `You write unit tests for a generated agent. Each test gives realistic task inputs and the property the result must satisfy.
Expected properties: {"type":"succeeds"} (returns status success with an answer satisfying the spec's constraints; use for clearly satisfiable inputs) | {"type":"constraints_hold"} (if the agent reports success, its answer satisfies the constraints) | {"type":"no_crash"}.
Return JSON {"tests":[{"category":"generic","title":str,"inputs":{...},"injected_conditions":[],"context":{"confirmed":false},"expected_property":{...}}]}`;
  const user = `${specBlock(spec, toolNames, extraCards)}\n\nWrite exactly ${opts.budget} different unit tests covering typical usage of this agent.`;
  const aud = audit(sys + user, heldout);
  let raws: any[] = [];
  try { const r = await complete("testgen", [{ role: "system", content: sys }, { role: "user", content: user }], { json: true, calls, stage: "testgen_generic", noCache: opts.noCache }); raws = Array.isArray(r.json?.tests) ? r.json.tests : []; } catch {}
  return finalize("generic", raws.map((t) => ({ ...t, category: "generic", injected_conditions: [] })), toolNames, ["generic"], calls, aud);
}

export function generateRandomTests(spec: PilotSpec, budget: number): TestGenResult {
  const rnd = mulberry32(seedOf("random-tests", spec.id));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const raws: any[] = [];
  const fields = spec.input_schema.map((f) => f.name);
  // draw until `budget` distinct perturbations exist (same budget as the other methods)
  const seen = new Set<string>();
  for (let i = 0, tries = 0; raws.length < budget && tries < 2000; tries++) {
    const inputs: any = JSON.parse(JSON.stringify(spec.example_inputs));
    const nOps = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < nOps; k++) {
      const f = pick(fields);
      const op = pick(["drop", "null", "type", "scale", "string", "empty", "case"]);
      const v = inputs[f];
      if (op === "drop") delete inputs[f];
      else if (op === "null") inputs[f] = null;
      else if (op === "type") inputs[f] = typeof v === "number" ? String(v) : typeof v === "string" ? 42 : Array.isArray(v) ? v.join(",") : "x";
      else if (op === "scale") inputs[f] = typeof v === "number" ? Math.round(v * pick([0, -1, 0.1, 10, 1000]) * 100) / 100 : v;
      else if (op === "string") inputs[f] = pick(["", "???", "zzz", "2026-13-45", "Nowhere"]);
      else if (op === "empty") inputs[f] = Array.isArray(v) ? [] : "";
      else if (op === "case") inputs[f] = typeof v === "string" ? v.toUpperCase() : Array.isArray(v) ? v.map((x: any) => String(x).toUpperCase()) : v;
    }
    const key = stableStringify(inputs);
    if (seen.has(key)) continue;
    seen.add(key);
    raws.push({ category: "random", title: `random perturbation #${++i}`, inputs, injected_conditions: [], context: { confirmed: false }, expected_property: { type: "no_crash" } });
  }
  return finalize("random", raws, spec.input_schema.map((f) => f.name), ["random"], [], { checked: 0, leaked: 0 });
}

// ------------------------------ certification ------------------------------
export interface TestOutcome { test_id: string; category: string; pass: boolean; why: string; status: string; error_code: string | null; tool_calls: number; ms: number }
export interface Certificate { method: string; score: number; per_category: Record<string, { pass: number; total: number; rate: number }>; weakest: { category: string; name: string; rate: number; sentence: string }[]; basis: string; outcomes: TestOutcome[] }

export async function runCertification(agent: Agent, spec: PilotSpec, gen: TestGenResult, opts: { onOutcome?: (o: TestOutcome, t: CertTest, r: ExecResult) => void; concurrency?: number } = {}): Promise<Certificate> {
  const outcomes: TestOutcome[] = new Array(gen.tests.length);
  let idx = 0;
  const worker = async () => {
    while (idx < gen.tests.length) {
      const i = idx++;
      const t = gen.tests[i];
      const r = await execute(agent, t.inputs, { mode: "replay", faults: t.injected_conditions, confirmed: t.context.confirmed, wallMs: 4000 });
      const ev = evalProperty(spec, t, r);
      outcomes[i] = { test_id: t.id, category: t.category, pass: ev.pass, why: ev.why, status: r.run.status, error_code: r.run.error_code, tool_calls: r.stats.calls, ms: r.run.duration_ms };
      opts.onOutcome?.(outcomes[i], t, r);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, worker));
  return scoreCertificate(gen.method, outcomes);
}

export function scoreCertificate(method: string, outcomes: TestOutcome[]): Certificate {
  const per: Record<string, { pass: number; total: number; rate: number }> = {};
  for (const o of outcomes) { const p = (per[o.category] ??= { pass: 0, total: 0, rate: 0 }); p.total++; if (o.pass) p.pass++; }
  for (const p of Object.values(per)) p.rate = p.total ? p.pass / p.total : 0;
  const cats = Object.keys(per);
  // v0 scoring: uniform weights over categories for rarc; plain pass rate for baselines
  const score = method === "rarc" ? (cats.length ? cats.reduce((a, c) => a + per[c].rate, 0) / cats.length : 0) : outcomes.length ? outcomes.filter((o) => o.pass).length / outcomes.length : 0;
  const weakest = method === "rarc"
    ? cats.map((c) => ({ c, r: per[c].rate })).sort((a, b) => a.r - b.r || a.c.localeCompare(b.c)).slice(0, 3).filter((x) => x.r < 1).map(({ c, r }) => {
        const tx = TAXONOMY.find((t) => t.id === c)!;
        return { category: c, name: tx.name, rate: r, sentence: `Handles ${tx.plain} in ${per[c].pass} of ${per[c].total} tests.` };
      })
    : [];
  return { method, score, per_category: per, weakest, basis: "synthetic tests", outcomes };
}
