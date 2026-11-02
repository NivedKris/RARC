import { intake } from "@/lib/stages";
import { LlmCall } from "@/lib/llm";
import { jsonError } from "@/lib/api";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (typeof text !== "string" || !text.trim()) return jsonError("text required", 400);
    const calls: LlmCall[] = [];
    const r = await intake(text.slice(0, 4000), calls);
    return Response.json({ intake: r, calls });
  } catch (e) { return jsonError(e); }
}
