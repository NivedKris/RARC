import { intake, retrieve, generateAgent, VARIANTS } from "../lib/stages";
import { PILOT } from "../lib/specs";
import { executeTask } from "../lib/runtime";
import { flushCache, LlmCall } from "../lib/llm";
import tasks from "../data/tasks.json";
(async () => {
  const id = process.argv[2] ?? "P01"; const vi = Number(process.argv[3] ?? 0);
  const spec = PILOT.find(p => p.id === id)!; const calls: LlmCall[] = [];
  const ir = await intake(spec.text, calls); console.log("intake", JSON.stringify(ir).slice(0, 400));
  const rr = await retrieve(spec.text, ir, calls); console.log("retrieval", rr.selected, rr.coverage_gaps, rr.ranked.slice(0,4).map(r=>[r.tool,r.similarity,r.why]));
  const ag = await generateAgent(spec, rr.selected, [], VARIANTS[vi], calls); console.log("agent", ag.ok, ag.model_id, ag.repairs, ag.contract.violations, ag.code.length);
  for (const t of (tasks as any).tasks.filter((t: any) => t.spec_id === id)) { const r = await executeTask(ag, spec, t, { mode: "replay" }); console.log(t.id, t.truth.expected_status, "->", r.run.status, r.run.error_code ?? "", r.check!.success, r.check!.checks.filter(c=>!c.ok).map(c=>c.name).join(";"), r.stats.calls); }
  console.log(calls.map(c => `${c.stage}:${c.model_id}:${c.latency_ms}ms:${c.tokens_in}/${c.tokens_out}${c.error ? " ERR " + c.error : ""}`).join("\n"));
  flushCache();
})();
