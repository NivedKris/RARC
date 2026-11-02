import { generateRarcTests, generateGenericTests, generateRandomTests, runCertification, TestGenResult } from "@/lib/runtime";
import { ndjson, resolveSpec, trustedWrappers } from "@/lib/api";
import { TOOLS, toolCard } from "@/lib/tools";
import tasksFile from "@/data/tasks.json";
export const maxDuration = 180;
export async function POST(req: Request) {
  const b = await req.json();
  return ndjson(async (send) => {
    const spec = resolveSpec(b.spec);
    const wrappers = trustedWrappers(b.agent?.wrappers);
    const tools = (b.agent?.tools ?? []).filter((n: string) => TOOLS.some((t) => t.name === n));
    const agent: any = { code: String(b.agent?.code ?? ""), tools, wrappers, category: spec.category };
    const toolNames = [...tools, ...wrappers.map((w) => w.tool.name)];
    const extra = wrappers.map((w) => toolCard(w.tool));
    // leakage guard: the generator never sees held-out tasks; they are only used to audit its prompt
    const heldout = (tasksFile as any).tasks.filter((t: any) => t.spec_id === b.spec?.pilot_id && t.split === "heldout").map((t: any) => ({ text: t.text, inputs: t.inputs }));
    const methods: string[] = Array.isArray(b.methods) ? b.methods : ["rarc", "generic", "random"];
    let budget = 24;
    for (const m of methods) {
      send({ type: "phase", method: m, phase: "generating tests" });
      let gen: TestGenResult;
      if (m === "rarc") gen = await generateRarcTests(spec, toolNames, extra, heldout);
      else if (m === "generic") gen = await generateGenericTests(spec, toolNames, extra, heldout, { budget });
      else gen = generateRandomTests(spec, budget);
      if (m === "rarc") budget = gen.tests.length || 24;
      send({ type: "tests", method: m, tests: gen.tests, stats: { generated: gen.generated, valid: gen.valid, duplicates: gen.duplicates, invalid_reasons: gen.invalid_reasons.slice(0, 5), leakage: gen.leakage_audit }, calls: gen.calls });
      const cert = await runCertification(agent, spec, gen, { concurrency: 6, onOutcome: (o) => send({ type: "outcome", method: m, outcome: o }) });
      send({ type: "certificate", method: m, certificate: { ...cert, outcomes: undefined } });
    }
    send({ type: "done" });
  });
}
