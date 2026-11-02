import { parseTask } from "@/lib/stages";
import { LlmCall } from "@/lib/llm";
import { jsonError } from "@/lib/api";
import { PILOT } from "@/lib/specs";
import { RECORDING_DATE } from "@/lib/world";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { text, schema, spec_text, spec_id, mode } = await req.json();
    const calls: LlmCall[] = [];
    // replay mode uses recorded data from RECORDING_DATE, so relative dates resolve against it
    const now = mode === "live" ? new Date().toISOString().slice(0, 10) : RECORDING_DATE;
    const catalog = PILOT.filter((p) => p.id !== spec_id).map((p) => ({ id: p.id, title: p.title, text: p.text }));
    const parsed = await parseTask(String(text).slice(0, 2000), Array.isArray(schema) ? schema : [], calls, { specText: spec_text, now, catalog });
    return Response.json({ ...parsed, now, calls });
  } catch (e) { return jsonError(e); }
}
