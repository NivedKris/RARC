import { retrieve } from "@/lib/stages";
import { LlmCall } from "@/lib/llm";
import { jsonError } from "@/lib/api";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { text, intake } = await req.json();
    const calls: LlmCall[] = [];
    const r = await retrieve(String(text).slice(0, 4000), { required_capabilities: intake?.required_capabilities ?? [], constraints: intake?.constraints ?? [] }, calls);
    return Response.json({ retrieval: r, calls });
  } catch (e) { return jsonError(e); }
}
