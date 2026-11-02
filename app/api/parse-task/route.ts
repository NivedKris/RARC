import { parseTask } from "@/lib/stages";
import { LlmCall } from "@/lib/llm";
import { jsonError } from "@/lib/api";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { text, schema } = await req.json();
    const calls: LlmCall[] = [];
    const inputs = await parseTask(String(text).slice(0, 2000), Array.isArray(schema) ? schema : [], calls);
    return Response.json({ inputs, calls });
  } catch (e) { return jsonError(e); }
}
