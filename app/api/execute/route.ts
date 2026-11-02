import { execute } from "@/lib/runtime";
import { checkTask } from "@/lib/checkers";
import { presentAnswer } from "@/lib/present";
import { ndjson, resolveSpec, trustedWrappers } from "@/lib/api";
import { TOOLS } from "@/lib/tools";
import tasksFile from "@/data/tasks.json";
export const maxDuration = 60;
export async function POST(req: Request) {
  const b = await req.json();
  return ndjson(async (send) => {
    const spec = resolveSpec(b.spec);
    const agent = { code: String(b.agent?.code ?? ""), tools: (b.agent?.tools ?? []).filter((n: string) => TOOLS.some((t) => t.name === n)), wrappers: trustedWrappers(b.agent?.wrappers), category: spec.category };
    const task = b.task_id ? (tasksFile as any).tasks.find((t: any) => t.id === b.task_id) : null;
    const inputs = task ? task.inputs : b.inputs ?? {};
    const mode = b.mode === "live" ? "live" : "replay";
    send({ type: "start", inputs, mode, task_id: task?.id ?? null });
    const r = await execute(agent, inputs, { mode, confirmed: !!b.confirmed, text: task?.text ?? b.text, onStep: (s) => send({ type: "step", step: s }) });
    const check = task && mode === "replay" && b.spec?.pilot_id === task.spec_id ? checkTask(spec, inputs, task.truth, r.run) : null;
    const view = presentAnswer(spec.category, b.spec?.pilot_id, inputs, r.run);
    send({ type: "result", run: r.run, stats: r.stats, check, truth: task?.truth ?? null, now: r.now, view });
  });
}
