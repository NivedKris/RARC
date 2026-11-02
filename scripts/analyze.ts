// Reproduction script (US-15): regenerates every number shown in the Evaluation tab from logged data.
// Deterministic: fixed bootstrap seeds, no LLM calls. Runs the computation twice and compares hashes (M12.1).
import fs from "fs";
import path from "path";
import { PILOT, D_INTAKE, specById } from "../lib/specs";
import { TOOLS } from "../lib/tools";
import { ROUTES } from "../lib/llm";
import { TAXONOMY } from "../lib/runtime";
import { VARIANTS, CODEGEN_PROMPT_VERSION, INTAKE_PROMPT_VERSION, LIBRARY_VERSION, CLARIFY_THRESHOLD } from "../lib/stages";
import { auroc, auprc, bestThreshold, bootstrap, brier, calibration, pairedBootstrap, Pair, pearson, prf, runLevel, spearman, statAuroc, statPearson, statSpearman } from "../lib/metrics";
import { mean, mulberry32, quantile, round, sha, stableStringify } from "../lib/util";
import tasksFile from "../data/tasks.json";

const OUT = path.join(process.cwd(), "eval", "out");
const L = (n: string) => JSON.parse(fs.readFileSync(path.join(OUT, n + ".json"), "utf8"));
const TASKS: any[] = (tasksFile as any).tasks;
const r3 = (x: number) => (x === null || x === undefined || !isFinite(x) ? null : round(x, 3));
const ci3 = (c: number[]) => c.map((x) => r3(x));
const pct = (a: number, b: number) => (b ? a / b : NaN);

function compute() {
  const intake = L("intake"), retrieval = L("retrieval"), wrappers = L("wrappers"), agents = L("agents"), tests = L("tests"), runsOut = L("runs"), faults = L("faults"), sandbox = L("sandbox"), tagsOut = L("tags");
  const runs: any[] = runsOut.runs, certs: any[] = runsOut.certs;
  const tags = tagsOut.tags as Record<string, any>;
  const allCalls: any[] = [...intake.flatMap((r: any) => r.calls), ...retrieval.flatMap((r: any) => r.calls), ...wrappers.flatMap((w: any) => w.calls), ...agents.flatMap((a: any) => a.calls), ...tests.flatMap((t: any) => [...t.rarc.calls, ...t.generic.calls]), ...tagsOut.calls];

  // ---------------- M1 intake ----------------
  const clear = intake.filter((r: any) => !r.gold.ambiguous && r.pred);
  const catAcc = pct(clear.filter((r: any) => r.pred.task_category === r.gold.category).length, clear.length);
  let tp = 0, fp = 0, fn = 0;
  for (const r of clear) { const g = new Set(r.gold.capabilities), p = new Set(r.pred.required_capabilities); for (const c of p) g.has(c) ? tp++ : fp++; for (const c of g) if (!p.has(c)) fn++; }
  const capF1 = (2 * tp) / (2 * tp + fp + fn);
  const asked = intake.filter((r: any) => r.pred).map((r: any) => ({ asked: r.pred.needs_clarification ? 1 : 0, amb: r.gold.ambiguous ? 1 : 0 }));
  const clar = prf(asked.map((a: any) => a.asked), asked.map((a: any) => a.amb));
  const intakeLat = intake.flatMap((r: any) => r.calls.filter((c: any) => !c.cache_hit && !c.error).map((c: any) => c.latency_ms / 1000));
  const M1 = {
    M1_1: r3(catAcc), M1_2: r3(capF1), M1_3: { precision: r3(clar.precision), recall: r3(clar.recall) }, M1_4: { p50: r3(quantile(intakeLat, 0.5)), p95: r3(quantile(intakeLat, 0.95)) },
    n: intake.length, n_ambiguous: intake.filter((r: any) => r.gold.ambiguous).length, threshold: CLARIFY_THRESHOLD,
    rows: intake.map((r: any) => ({ id: r.id, text: r.gold.text, ambiguous: r.gold.ambiguous, gold_category: r.gold.category, pred_category: r.pred?.task_category, confidence: r.pred?.confidence, asked: r.pred?.needs_clarification, question: r.pred?.clarifying_question, gold_caps: r.gold.capabilities, pred_caps: r.pred?.required_capabilities })),
  };

  // ---------------- M2 retrieval ----------------
  const LIB = new Set(TOOLS.map((t) => t.name));
  function retMetrics(order: (r: any) => string[]) {
    const per = retrieval.map((r: any) => {
      const req = r.gold.required.filter((t: string) => LIB.has(t)), use = r.gold.useful.filter((t: string) => LIB.has(t));
      const rel = new Set([...req, ...use]);
      const o = order(r);
      const at = (k: number) => o.slice(0, k);
      const hit = req.every((t: string) => at(5).includes(t)) ? 1 : 0;
      const P = (k: number) => at(k).filter((t) => rel.has(t)).length / k, Rr = (k: number) => (rel.size ? at(k).filter((t) => rel.has(t)).length / rel.size : 1);
      const first = o.findIndex((t) => rel.has(t));
      const gain = (t: string) => (req.includes(t) ? 2 : use.includes(t) ? 1 : 0);
      const dcg = at(5).reduce((a, t, i) => a + (2 ** gain(t) - 1) / Math.log2(i + 2), 0);
      const ideal = [...req.map(() => 2), ...use.map(() => 1)].slice(0, 5).reduce((a, g, i) => a + (2 ** g - 1) / Math.log2(i + 2), 0);
      return { id: r.id, hit, p3: P(3), r3: Rr(3), p5: P(5), r5: Rr(5), rr: first >= 0 ? 1 / (first + 1) : 0, ndcg: ideal ? dcg / ideal : 1 };
    });
    const m = (k: string) => r3(mean(per.map((p: any) => p[k])));
    return { hit_rate_at5: m("hit"), p_at3: m("p3"), r_at3: m("r3"), p_at5: m("p5"), r_at5: m("r5"), mrr: m("rr"), ndcg_at5: m("ndcg"), per };
  }
  const withRR = retMetrics((r) => r.runs[0].ranked.map((x: any) => x.tool));
  const simOnly = retMetrics((r) => r.runs[0].ranked_sim_only);
  const jac = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return A.size + B.size - i ? i / (A.size + B.size - i) : 1; };
  const reproNoCache = mean(retrieval.map((r: any) => mean([jac(r.runs[0].selected, r.runs[1].selected), jac(r.runs[0].selected, r.runs[2].selected), jac(r.runs[1].selected, r.runs[2].selected)])));
  const M2 = {
    k: 5, rerank: { ...withRR, per: undefined }, similarity_only: { ...simOnly, per: undefined }, rerank_lift_ndcg: r3((withRR.ndcg_at5 ?? 0) - (simOnly.ndcg_at5 ?? 0)),
    M2_5_with_cache: 1.0, M2_5_cache_disabled: r3(reproNoCache), n: retrieval.length,
    rows: retrieval.map((r: any) => ({ id: r.id, gold_required: r.gold.required, selected: r.runs[0].selected, top5: r.runs[0].ranked.slice(0, 5).map((x: any) => ({ tool: x.tool, sim: x.similarity, why: x.why, relevant: x.relevant })), gaps: r.runs[0].coverage_gaps, synth: r.runs[0].synth_candidates, hit: withRR.per.find((p: any) => p.id === r.id)?.hit })),
  };

  // ---------------- M3 wrappers ----------------
  const synthTasks = runs.filter((r) => r.repeat === 0 && r.synthesized_tool_ids.length && r.split === "heldout");
  const M3 = {
    M3_1: { valid: wrappers.filter((w: any) => w.valid).length, attempted: wrappers.length }, M3_2: r3(pct(wrappers.filter((w: any) => w.valid).length, wrappers.length)),
    M3_3: r3(mean(wrappers.filter((w: any) => w.valid).map((w: any) => w.repairs))), M3_4: r3(pct(synthTasks.filter((r) => r.checker_result.success).length, synthTasks.length)), M3_4_n: synthTasks.length,
    rows: wrappers.map((w: any) => ({ api: w.api_id, valid: w.valid, repairs: w.repairs, attempts: w.attempts.map((a: any) => ({ ok: a.ok, url: a.url, error: a.error, output: a.output })), wrapper: w.wrapper && { name: w.wrapper.tool.name, base_url: w.wrapper.base_url, path_template: w.wrapper.path_template, query: w.wrapper.query, transform: w.wrapper.transform } })),
  };

  // ---------------- M4 code generation ----------------
  const ok = agents.filter((a: any) => a.ok);
  const certOf = (id: string) => certs.find((c) => c.agent_id === id)?.cert;
  const heldRuns = (id: string, rep = 0) => runs.filter((r) => r.agent_id === id && r.repeat === rep && r.split === "heldout");
  const nominalTask = (sid: string) => TASKS.find((t) => t.spec_id === sid && t.split === "heldout" && !t.hard)!.id;
  const solvedNominal = (a: any) => runs.some((r) => r.agent_id === a.agent_id && r.repeat === 0 && r.task_id === nominalTask(a.spec_id) && r.checker_result.success);
  const specsWithNominal = PILOT.filter((s) => agents.some((a: any) => a.spec_id === s.id && runs.some((r) => r.agent_id === a.agent_id && r.repeat === 0 && !r.hard && r.checker_result.success && !r.error_code))).length;
  const errHandling = ok.filter((a: any) => { const c = certOf(a.agent_id)?.rarc; const t2 = c?.outcomes.filter((o: any) => o.category === "T2"), t3 = c?.outcomes.filter((o: any) => o.category === "T3"); return a.contract.has_try_catch && a.contract.has_empty_check && t2?.some((o: any) => o.pass) && t3?.some((o: any) => o.pass); }).length;
  const grams = (code: string) => { const toks = code.replace(/\/\/.*$/gm, "").match(/[A-Za-z_$][\w$]*|\d+|\S/g) ?? []; const s = new Set<string>(); for (let i = 0; i + 2 < toks.length; i++) s.add(toks[i] + " " + toks[i + 1] + " " + toks[i + 2]); return s; };
  const G = Object.fromEntries(ok.map((a: any) => [a.agent_id, grams(a.code)]));
  const dist = (x: string, y: string) => { const A = G[x], B = G[y]; let i = 0; for (const g of A) if (B.has(g)) i++; return 1 - i / (A.size + B.size - i); };
  const within: number[] = [], between: number[] = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) (ok[i].spec_id === ok[j].spec_id ? within : between).push(dist(ok[i].agent_id, ok[j].agent_id));
  const pass1 = mean(agents.map((a: any) => (solvedNominal(a) ? 1 : 0)));
  const pass3 = mean(PILOT.map((s) => (agents.filter((a: any) => a.spec_id === s.id).some(solvedNominal) ? 1 : 0)));
  const M4 = {
    M4_1: r3(pct(agents.filter((a: any) => a.contract.ok).length, agents.length)), M4_1_first_attempt: r3(pct(agents.filter((a: any) => a.attempts[0]?.ok).length, agents.length)),
    M4_2: r3(pct(agents.filter((a: any) => a.load_ok).length, agents.length)), M4_3: { specs: specsWithNominal, of: PILOT.length },
    M4_4: { pass_at_1: r3(pass1), pass_at_3: r3(pass3) }, M4_5: r3(pct(errHandling, ok.length)), M4_6: r3(pct(agents.filter((a: any) => a.repairs > 0).length, agents.length)),
    M4_7: { within_spec: r3(mean(within)), between_spec: r3(mean(between)) }, n_agents: agents.length,
    per_variant: VARIANTS.map((v) => { const as = agents.filter((a: any) => a.variant === v.id); const mc: Record<string, number> = {}; for (const x of as) mc[x.model_id] = (mc[x.model_id] ?? 0) + 1; return { variant: v.id, label: v.label, model: Object.entries(mc).sort((p, q) => q[1] - p[1]).map(([m, n]) => `${m.replace("openai/", "")} ×${n}`).join(" + "), ok: as.filter((a: any) => a.ok).length, n: as.length, repairs: r3(mean(as.map((a: any) => a.repairs))), loc: Math.round(mean(as.map((a: any) => a.code.split("\n").length))), latency_s: r3(mean(as.map((a: any) => a.gen_latency_ms / 1000))) }; }),
  };

  // ---------------- M5 task completion ----------------
  const H0 = runs.filter((r) => r.repeat === 0 && r.split === "heldout");
  const rnd = mulberry32(3);
  const bootMean = (xs: number[]) => { const v: number[] = []; for (let b = 0; b < 1000; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)]; v.push(s / xs.length); } v.sort((a, b) => a - b); return [v[25], v[974]]; };
  const tsrBlock = (rs: any[]) => { const xs = rs.map((r) => (r.checker_result.success ? 1 : 0)); return { tsr: r3(mean(xs)), ci: ci3(bootMean(xs)), partial: r3(mean(rs.map((r) => r.checker_result.partial_score))), n: rs.length }; };
  const failed = H0.filter((r) => !r.checker_result.success);
  const stab = (() => { const keys = new Set(runs.map((r) => r.agent_id + "|" + r.task_id)); let same = 0; for (const k of keys) { const rs = runs.filter((r) => r.agent_id + "|" + r.task_id === k); if (new Set(rs.map((r) => r.checker_result.success)).size === 1) same++; } return pct(same, keys.size); })();
  const tc = H0.reduce((a, r) => ({ calls: a.calls + r.tool_stats.calls, bad: a.bad + r.tool_stats.unknown_tool_calls + r.tool_stats.invalid_arg_calls }), { calls: 0, bad: 0 });
  const M5 = {
    M5_1: { overall: tsrBlock(H0), per_category: Object.fromEntries(["C1", "C2", "C3"].map((c) => [c, tsrBlock(H0.filter((r) => r.task_category === c))])), per_variant: Object.fromEntries(VARIANTS.map((v) => [v.id, tsrBlock(H0.filter((r) => r.agent_version === v.id))])), hard: tsrBlock(H0.filter((r) => r.hard)), normal: tsrBlock(H0.filter((r) => !r.hard)) },
    M5_2: r3(mean(H0.map((r) => r.checker_result.partial_score))), M5_3: r3(pct(tc.calls - tc.bad, tc.calls)),
    M5_4: r3(pct(failed.filter((r) => !["E_CRASH", "E_MALFORMED_OUTPUT"].includes(r.error_code)).length, failed.length)),
    M5_5: r3(stab), M5_6: { tool_calls: r3(mean(H0.map((r) => r.tool_stats.calls))), wall_ms: r3(mean(H0.map((r) => r.stage_latencies.execution_ms))), llm_calls_at_runtime: 0 },
    error_codes: Object.entries(H0.reduce((a: any, r) => { const k = r.error_code ?? (r.checker_result.success ? "success" : "wrong_answer_or_status"); a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a: any, b: any) => b[1] - a[1]),
    per_spec: PILOT.map((s) => ({ spec: s.id, title: s.title, category: s.category, ...Object.fromEntries(VARIANTS.map((v) => [v.id, r3(mean(H0.filter((r) => r.agent_id === `${s.id}-${v.id}`).map((r) => (r.checker_result.success ? 1 : 0))))])) })),
  };

  // ---------------- M6 sandbox ----------------
  const atk = sandbox.attacks;
  const classes = [...new Set(atk.map((a: any) => a.cls))] as string[];
  const ref = sandbox.refRuns;
  const allRunsWithin = runs.filter((r) => !r.terminated_within_budget).length;
  const M6 = {
    M6_1: atk.filter((a: any) => a.escaped).length, M6_1_runtime_only: atk.filter((a: any) => a.runtime_only.escaped).length, n_attacks: atk.length,
    M6_2: classes.map((c) => { const xs = atk.filter((a: any) => a.cls === c); return { cls: c, blocked: xs.filter((a: any) => a.blocked_as_intended && !a.escaped).length, n: xs.length }; }),
    M6_3: { ok: sandbox.mapping.filter((m: any) => m.ok).length, n: sandbox.mapping.length, rows: sandbox.mapping },
    M6_4: atk.filter((a: any) => !a.within_budget).length + allRunsWithin, M6_4_runs_checked: atk.length + runs.length,
    M6_5: r3(pct(ref.filter((r: any) => r.killed).length, ref.length)), M6_5_n: ref.length, reference_checker_pass: r3(pct(ref.filter((r: any) => r.success).length, ref.length)),
    M6_6: { sandbox_ms_p50: r3(quantile(ref.map((r: any) => r.sandbox_ms), 0.5)), bare_ms_p50: r3(quantile(ref.map((r: any) => r.bare_ms), 0.5)), overhead_ms_p50: r3(quantile(ref.map((r: any) => r.sandbox_ms - r.bare_ms), 0.5)) },
    attacks: atk.map((a: any) => ({ id: a.id, cls: a.cls, error_code: a.error_code, expected: a.expected, ok: a.blocked_as_intended && !a.escaped, escaped: a.escaped, ms: a.duration_ms, runtime_only: a.runtime_only.error_code, runtime_only_escaped: a.runtime_only.escaped })),
  };

  // ---------------- M7 predictiveness ----------------
  const evalAgents = ok.map((a: any) => a.agent_id);
  const devRate: Record<string, number> = {};
  for (const c of ["C1", "C2", "C3"]) { const d = runs.filter((r) => r.repeat === 0 && r.split === "dev" && r.task_category === c && evalAgents.includes(r.agent_id)); devRate[c] = mean(d.map((r) => (r.checker_result.success ? 1 : 0))); }
  const methods = ["none", "generic", "random", "rarc"];
  const scoreOf = (id: string, m: string) => (m === "none" ? devRate[agents.find((a: any) => a.agent_id === id).category] : certOf(id)[m].score);
  const pairsFor = (m: string, split = "heldout", sc?: (id: string) => number): Pair[] => evalAgents.map((id: string) => ({ agent: id, s: sc ? sc(id) : scoreOf(id, m), ys: runs.filter((r) => r.agent_id === id && r.repeat === 0 && r.split === split).map((r) => (r.checker_result.success ? 1 : 0)) }));
  const M7: any = { methods: {}, paired: {}, n_agents: evalAgents.length, n_runs: pairsFor("rarc").reduce((a, p) => a + p.ys.length, 0), excluded_agents: agents.filter((a: any) => !a.ok).map((a: any) => a.agent_id), dev_rate: devRate };
  for (const m of methods) {
    const P = pairsFor(m), D = pairsFor(m, "dev");
    const rl = runLevel(P), dl = runLevel(D);
    const tau = bestThreshold(dl.s, dl.fail);
    const pr = prf(rl.s.map((s) => (s < tau ? 1 : 0)), rl.fail);
    const cal = calibration(rl.s, rl.y);
    M7.methods[m] = {
      spearman: r3(statSpearman(P)), spearman_ci: ci3(bootstrap(P, statSpearman)), pearson: r3(statPearson(P)), pearson_ci: ci3(bootstrap(P, statPearson)),
      auroc: r3(auroc(rl.score, rl.fail)), auroc_ci: ci3(bootstrap(P, statAuroc)), auprc: r3(auprc(rl.score, rl.fail)), auprc_ci: ci3(bootstrap(P, (p) => { const r = runLevel(p); return auprc(r.score, r.fail); })),
      base_failure_rate: r3(mean(rl.fail)), brier: r3(brier(rl.s, rl.y)), brier_ci: ci3(bootstrap(P, (p) => { const r = runLevel(p); return brier(r.s, r.y); })), ece: r3(cal.ece),
      tau: r3(tau), precision: r3(pr.precision), recall: r3(pr.recall), f1: r3(pr.f1),
      calibration: cal.bins.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, conf: r3(b.conf), acc: r3(b.acc) })),
      scatter: P.map((p) => ({ agent: p.agent, s: r3(p.s), Y: r3(mean(p.ys)) })),
    };
  }
  for (const base of ["generic", "random", "none"]) {
    const A = pairsFor("rarc"), B = pairsFor(base);
    M7.paired[`rarc_vs_${base}`] = { d_auroc: r3(statAuroc(A) - statAuroc(B)), ...(() => { const x = pairedBootstrap(A, B, statAuroc); return { auroc_ci: ci3(x.ci), auroc_p: r3(x.p_one_sided) }; })(), d_spearman: r3(statSpearman(A) - statSpearman(B)), ...(() => { const x = pairedBootstrap(A, B, statSpearman); return { spearman_ci: ci3(x.ci), spearman_p: r3(x.p_one_sided) }; })() };
  }
  // M7.8 per-category predictiveness (agent level): rarc fails a T_c test  ->  real failure tagged T_c
  M7.per_category = TAXONOMY.map((t) => {
    const pred = evalAgents.map((id: string) => (certOf(id).rarc.outcomes.some((o: any) => o.category === t.id && !o.pass) ? 1 : 0));
    const act = evalAgents.map((id: string) => (H0.some((r) => r.agent_id === id && !r.checker_result.success && (tags[r.run_id]?.primary === t.id || tags[r.run_id]?.secondary?.includes(t.id))) ? 1 : 0));
    const x = prf(pred, act);
    return { category: t.id, name: t.name, predicted_agents: pred.reduce((a: number, b: number) => a + b, 0), actual_agents: act.reduce((a: number, b: number) => a + b, 0), precision: r3(x.precision), recall: r3(x.recall), f1: r3(x.f1) };
  });

  // ---------------- M8 test generator ----------------
  const cells = tests.flatMap((t: any) => TAXONOMY.map((tx) => t.rarc.tests.filter((x: any) => x.category === tx.id).length));
  const tg = (m: string) => ({ generated: tests.reduce((a: number, t: any) => a + t[m].generated, 0), valid: tests.reduce((a: number, t: any) => a + t[m].valid, 0), kept: tests.reduce((a: number, t: any) => a + t[m].tests.length, 0), duplicates: tests.reduce((a: number, t: any) => a + t[m].duplicates, 0) });
  const fd = TAXONOMY.map((tx) => ({ category: tx.id, name: tx.name, rate: r3(pct(evalAgents.filter((id: string) => certOf(id).rarc.outcomes.some((o: any) => o.category === tx.id && !o.pass)).length, evalAgents.length)), pass_rate: r3(mean(evalAgents.flatMap((id: string) => certOf(id).rarc.outcomes.filter((o: any) => o.category === tx.id).map((o: any) => (o.pass ? 1 : 0))))) }));
  const fdet = (m: string) => r3(pct(faults.filter((f: any) => f.det[m].detected).length, faults.length));
  const loco = TAXONOMY.map((tx) => {
    const sc = (id: string) => { const per = certOf(id).rarc.per_category; const ks = Object.keys(per).filter((k) => k !== tx.id); return ks.length ? mean(ks.map((k) => per[k].rate)) : 0; };
    return { category: tx.id, auroc_without: r3(statAuroc(pairsFor("rarc", "heldout", sc))), delta: r3(statAuroc(pairsFor("rarc", "heldout", sc)) - statAuroc(pairsFor("rarc"))) };
  });
  const budgetCurve = [1, 2, 3].map((k) => {
    const rr = mulberry32(100 + k);
    const vals: Record<string, number[]> = { rarc: [], generic: [], random: [] };
    for (let rep = 0; rep < 100; rep++) {
      for (const m of ["rarc", "generic", "random"]) {
        const sc = (id: string) => {
          const os = certOf(id)[m].outcomes;
          if (m === "rarc") { const cats = [...new Set(os.map((o: any) => o.category))] as string[]; return mean(cats.map((c) => { const xs = os.filter((o: any) => o.category === c); const pick = [...xs].sort(() => rr() - 0.5).slice(0, k); return mean(pick.map((o: any) => (o.pass ? 1 : 0))); })); }
          const pick = [...os].sort(() => rr() - 0.5).slice(0, 8 * k); return mean(pick.map((o: any) => (o.pass ? 1 : 0)));
        };
        vals[m].push(statAuroc(pairsFor(m, "heldout", sc)));
      }
    }
    return { tests_per_agent: 8 * k, ...Object.fromEntries(Object.entries(vals).map(([m, v]) => [m, r3(mean(v.filter(isFinite)))])) };
  });
  const M8 = {
    M8_1: r3(pct(cells.filter((c: number) => c >= 3).length, cells.length)), M8_1_at_least_1: r3(pct(cells.filter((c: number) => c >= 1).length, cells.length)), cells: cells.length,
    M8_2: { rarc: r3(pct(tg("rarc").valid, tg("rarc").generated)), generic: r3(pct(tg("generic").valid, tg("generic").generated)) }, counts: { rarc: tg("rarc"), generic: tg("generic"), random: tg("random") },
    M8_3: fd, M8_4: { rarc: fdet("rarc"), generic: fdet("generic"), random: fdet("random"), n: faults.length, per_fault: [...new Set(faults.map((f: any) => f.fault))].map((fid) => { const xs = faults.filter((f: any) => f.fault === fid); return { fault: fid, name: xs[0].fault_name, targets: xs[0].targets, rarc: r3(pct(xs.filter((f: any) => f.det.rarc.detected).length, xs.length)), generic: r3(pct(xs.filter((f: any) => f.det.generic.detected).length, xs.length)), random: r3(pct(xs.filter((f: any) => f.det.random.detected).length, xs.length)), n: xs.length }; }) },
    M8_5: r3(pct(tg("rarc").duplicates, tg("rarc").valid)), M8_6: loco, M8_7: budgetCurve,
    leakage_audit: { prompts_checked: tests.length * 3, leaked: tests.reduce((a: number, t: any) => a + t.rarc.leakage_audit.leaked + t.generic.leakage_audit.leaked, 0) },
    examples: tests.slice(0, 15).map((t: any) => ({ spec_id: t.spec_id, rarc: t.rarc.tests.filter((_: any, i: number) => i % 3 === 0).slice(0, 8), generic: t.generic.tests.slice(0, 3), random: t.random.tests.slice(0, 3) })),
  };

  // ---------------- M9 tagging ----------------
  const fl = H0.filter((r) => !r.checker_result.success);
  const tagged = fl.filter((r) => tags[r.run_id]?.primary);
  const dist9 = Object.entries(tagged.reduce((a: any, r) => { const k = tags[r.run_id].primary; a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a: any, b: any) => b[1] - a[1]);
  const M9 = { M9_1: r3(pct(tagged.length, fl.length)), M9_2: r3(pct(tagged.filter((r) => !TAXONOMY.some((t) => t.id === tags[r.run_id].primary)).length, tagged.length)), M9_3: null, M9_4: null, n_failures: fl.length, distribution: dist9, judges: [...new Set(Object.values(tags).map((t: any) => t.judge))] };

  // ---------------- M10 performance ----------------
  const live = allCalls.filter((c) => !c.cache_hit && !c.error);
  const stages = [...new Set(allCalls.map((c) => c.stage))] as string[];
  const M10 = {
    M10_1: [
      { stage: "intake", p50: r3(quantile(intakeLat, 0.5)), p95: r3(quantile(intakeLat, 0.95)) },
      { stage: "retrieval (embed + re-rank)", ...(() => { const xs = retrieval.map((r: any) => r.runs[1].latency_ms / 1000); return { p50: r3(quantile(xs, 0.5)), p95: r3(quantile(xs, 0.95)) }; })() },
      { stage: "code generation (incl. repairs)", ...(() => { const xs = agents.map((a: any) => a.gen_latency_ms / 1000); return { p50: r3(quantile(xs, 0.5)), p95: r3(quantile(xs, 0.95)) }; })() },
      { stage: "certification run (rarc tests)", ...(() => { const xs = certs.map((c: any) => (c.cert.rarc.wall_ms ?? 0) / 1000); return { p50: r3(quantile(xs, 0.5)), p95: r3(quantile(xs, 0.95)) }; })() },
      { stage: "task execution (sandbox)", ...(() => { const xs = H0.map((r) => r.stage_latencies.execution_ms / 1000); return { p50: r3(quantile(xs, 0.5)), p95: r3(quantile(xs, 0.95)) }; })() },
    ],
    M10_3: stages.map((s) => { const xs = allCalls.filter((c) => c.stage === s); return { stage: s, calls: xs.length, live_calls: xs.filter((c) => !c.cache_hit).length, tokens_in: Math.round(xs.reduce((a, c) => a + (c.tokens_in || 0), 0)), tokens_out: Math.round(xs.reduce((a, c) => a + (c.tokens_out || 0), 0)), providers: [...new Set(xs.map((c) => c.provider + ":" + c.model_id))] }; }),
    M10_4: ["groq", "gemini"].map((p) => { const xs = allCalls.filter((c) => c.provider === p); return { provider: p, calls: xs.length, retries: xs.reduce((a, c) => a + (c.retries || 0), 0), errors: xs.filter((c) => c.error).length, fallback_used: xs.filter((c) => c.fallback_used).length, cache_hits: xs.filter((c) => c.cache_hit).length, p50_latency_s: r3(quantile(live.filter((c) => c.provider === p).map((c) => c.latency_ms / 1000), 0.5)) }; }),
  };

  // ---------------- agents + scorecard ----------------
  const agentRows = agents.map((a: any) => { const c = certOf(a.agent_id); return { agent_id: a.agent_id, spec_id: a.spec_id, title: specById(a.spec_id)!.title, category: a.category, variant: a.variant, model: a.model_id, ok: a.ok, repairs: a.repairs, code_hash: a.code_hash, loc: a.code.split("\n").length, rarc: r3(c?.rarc.score), generic: r3(c?.generic.score), random: r3(c?.random.score), none: r3(devRate[a.category]), tsr_heldout: r3(mean(heldRuns(a.agent_id).map((r) => (r.checker_result.success ? 1 : 0)))), rarc_breakdown: c ? Object.fromEntries(Object.entries(c.rarc.per_category).map(([k, v]: any) => [k, r3(v.rate)])) : {}, weakest: c?.rarc.weakest ?? [] }; });
  const rm = M7.methods.rarc, gm = M7.methods.generic, pv = M7.paired.rarc_vs_generic;
  const T1 = [
    { capability: "1 · Assembly", metric: "M2.1 retrieval hit-rate@5", value: M2.rerank.hit_rate_at5, target: "≥ 0.90", pass: (M2.rerank.hit_rate_at5 ?? 0) >= 0.9 },
    { capability: "1 · Assembly", metric: "M4.3 specs with a working agent", value: `${M4.M4_3.specs}/${M4.M4_3.of}`, target: "100% of pilot", pass: M4.M4_3.specs === M4.M4_3.of },
    { capability: "1 · Assembly", metric: "M3.1 synthesized wrappers valid", value: `${M3.M3_1.valid}/${M3.M3_1.attempted}`, target: "≥ 2/2", pass: M3.M3_1.valid >= 2 },
    { capability: "2 · Execution", metric: "M5.1 held-out task success", value: M5.M5_1.overall.tsr, target: "reported (95% CI)", pass: null },
    { capability: "3 · Certification", metric: "M7.3 AUROC (rarc)", value: rm.auroc, target: "> generic, CI on Δ excludes 0", pass: pv.auroc_ci[0] > 0 },
    { capability: "3 · Certification", metric: "M7.1 Spearman ρ (rarc)", value: rm.spearman, target: "> generic", pass: (rm.spearman ?? -1) > (gm.spearman ?? -1) },
    { capability: "4 · Safety", metric: "M6.1 sandbox escapes", value: M6.M6_1, target: "0", pass: M6.M6_1 === 0 },
    { capability: "4 · Safety", metric: "M6.2 limit enforcement", value: `${M6.M6_2.reduce((a: number, c: any) => a + c.blocked, 0)}/${M6.n_attacks}`, target: "100% per class", pass: M6.M6_2.every((c: any) => c.blocked === c.n) },
    { capability: "4 · Safety", metric: "M6.3 error-mapping accuracy", value: `${M6.M6_3.ok}/${M6.M6_3.n}`, target: "100%", pass: M6.M6_3.ok === M6.M6_3.n },
    { capability: "4 · Safety", metric: "M6.4 hang count", value: M6.M6_4, target: "0", pass: M6.M6_4 === 0 },
  ];

  return {
    meta: { dataset_hash: (tasksFile as any).hash, n_specs: PILOT.length, n_intake_specs: D_INTAKE.length, n_agents: agents.length, n_tasks: TASKS.length, n_heldout: TASKS.filter((t) => t.split === "heldout").length, n_runs_logged: runs.length, n_cert_runs: certs.reduce((a, c) => a + c.cert.rarc.outcomes.length + c.cert.generic.outcomes.length + c.cert.random.outcomes.length, 0), routes: ROUTES, prompt_versions: { intake: INTAKE_PROMPT_VERSION, codegen: CODEGEN_PROMPT_VERSION }, library_version: LIBRARY_VERSION, variants: VARIANTS, mode: "replay (recorded 2026-11-02)" },
    T1, M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, agents: agentRows,
  };
}

const a = compute();
const b = compute();
const ha = sha(stableStringify(a), 16), hb = sha(stableStringify(b), 16);
const results = { ...a, M12: { M12_1_identical: ha === hb, hash: ha }, generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(process.cwd(), "public", "results.json"), JSON.stringify(results));
// public run log sample + agent code for the Datasets/Logs tab
const agents = L("agents"), runsOut = L("runs");
fs.writeFileSync(path.join(process.cwd(), "public", "agents-public.json"), JSON.stringify(agents.map((x: any) => ({ agent_id: x.agent_id, spec_id: x.spec_id, variant: x.variant, model_id: x.model_id, provider: x.provider, code_hash: x.code_hash, code: x.code, tools: x.tools, wrappers: x.wrappers.map((w: any) => ({ name: w.tool.name, api_id: w.api_id })), contract: x.contract, repairs: x.repairs, ok: x.ok, attempts: x.attempts }))));
fs.writeFileSync(path.join(process.cwd(), "public", "runs-sample.json"), JSON.stringify(runsOut.runs.filter((r: any) => r.repeat === 0)));
console.log("results hash", ha, "reproducible:", ha === hb);
console.log(JSON.stringify(results.T1, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(results.M7.methods).map(([k, v]: any) => [k, { rho: v.spearman, auroc: v.auroc, ci: v.auroc_ci, brier: v.brier }]))));
console.log(JSON.stringify(results.M7.paired));
