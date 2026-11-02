// Sensitivity analysis: recompute predictiveness excluding held-out tasks whose inputs equal a spec's
// example_inputs (which the test generator saw). No LLM calls; reads eval/out.
import fs from "fs";
import { PILOT } from "../lib/specs";
import { statAuroc, statSpearman, bootstrap, pairedBootstrap, Pair } from "../lib/metrics";
import tasksFile from "../data/tasks.json";
const T: any[] = (tasksFile as any).tasks;
const leaked = new Set(T.filter((t) => JSON.stringify(t.inputs) === JSON.stringify(PILOT.find((p) => p.id === t.spec_id)!.example_inputs)).map((t) => t.id));
const agents = JSON.parse(fs.readFileSync("eval/out/agents.json", "utf8")).filter((a: any) => a.ok);
const { runs, certs } = JSON.parse(fs.readFileSync("eval/out/runs.json", "utf8"));
const dev: Record<string, number> = {};
for (const c of ["C1", "C2", "C3"]) { const d = runs.filter((r: any) => r.repeat === 0 && r.split === "dev" && r.task_category === c && agents.some((a: any) => a.agent_id === r.agent_id)); dev[c] = d.filter((r: any) => r.checker_result.success).length / d.length; }
const pairs = (m: string, excl: boolean): Pair[] => agents.map((a: any) => ({ agent: a.agent_id, s: m === "none" ? dev[a.category] : certs.find((c: any) => c.agent_id === a.agent_id).cert[m].score, ys: runs.filter((r: any) => r.agent_id === a.agent_id && r.repeat === 0 && r.split === "heldout" && !(excl && leaked.has(r.task_id))).map((r: any) => (r.checker_result.success ? 1 : 0)) }));
const out: any = { leaked_tasks: [...leaked], rows: [] };
for (const excl of [false, true]) for (const m of ["rarc", "generic", "random", "none"]) { const P = pairs(m, excl); out.rows.push({ excluded_leaked: excl, method: m, n_runs: P.reduce((a, p) => a + p.ys.length, 0), auroc: +statAuroc(P).toFixed(3), auroc_ci: bootstrap(P, statAuroc).map((x) => +x.toFixed(3)), spearman: +statSpearman(P).toFixed(3) }); }
for (const b of ["generic", "random", "none"]) { const x = pairedBootstrap(pairs("rarc", true), pairs(b, true), statAuroc); out[`rarc_vs_${b}_excl`] = { d_auroc: +(statAuroc(pairs("rarc", true)) - statAuroc(pairs(b, true))).toFixed(3), ci: x.ci.map((v: number) => +v.toFixed(3)), p: +x.p_one_sided.toFixed(3) }; }
fs.writeFileSync("eval/out/leakage-sensitivity.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
