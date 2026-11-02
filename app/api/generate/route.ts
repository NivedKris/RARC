import { generateAgent, VARIANTS } from "@/lib/stages";
import { LlmCall } from "@/lib/llm";
import { jsonError, resolveSpec, trustedWrappers } from "@/lib/api";
import { TOOLS } from "@/lib/tools";
export const maxDuration = 120;
export async function POST(req: Request) {
  try {
    const { spec, tools, wrappers, variant } = await req.json();
    const s = resolveSpec(spec);
    const v = VARIANTS.find((x) => x.id === variant) ?? VARIANTS[0];
    const names = (Array.isArray(tools) ? tools : []).filter((n: string) => TOOLS.some((t) => t.name === n));
    const calls: LlmCall[] = [];
    const a = await generateAgent({ id: s.id, text: s.text, category: s.category, input_schema: s.input_schema }, names, trustedWrappers(wrappers), v, calls);
    return Response.json({ agent: a, calls });
  } catch (e) { return jsonError(e); }
}
