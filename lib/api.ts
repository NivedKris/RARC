import { PilotSpec, specById } from "./specs";
import { API_REGISTRY } from "./openapi";
import { Wrapper } from "./tools";

export function jsonError(e: any, status = 500) {
  return Response.json({ error: String(e?.message ?? e).slice(0, 500) }, { status });
}

// NDJSON stream: each event is one JSON line.
export function ndjson(run: (send: (ev: any) => void) => Promise<void>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (ev: any) => ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      try { await run(send); } catch (e: any) { send({ type: "error", error: String(e?.message ?? e).slice(0, 500) }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

export function resolveSpec(s: any): PilotSpec {
  const p = s?.pilot_id ? specById(s.pilot_id) : undefined;
  if (p) return p;
  return { id: String(s?.id ?? "custom"), category: s?.category ?? "C2", title: "custom", text: String(s?.text ?? ""), gold_capabilities: [], gold_tools: { required: [], useful: [] }, input_schema: Array.isArray(s?.input_schema) ? s.input_schema : [], example_inputs: s?.example_inputs ?? {} };
}

// Client-supplied wrappers are re-bound to the registry: tool metadata and allowed host come from the server.
export function trustedWrappers(ws: any[]): Wrapper[] {
  const out: Wrapper[] = [];
  for (const w of Array.isArray(ws) ? ws : []) {
    const api = API_REGISTRY.find((a) => a.id === w?.api_id);
    if (!api) continue;
    try { if (new URL(String(w.base_url)).host !== api.allow_host) continue; } catch { continue; }
    out.push({ tool: api.target, method: "GET", base_url: String(w.base_url), path_template: String(w.path_template ?? ""), query: w.query && typeof w.query === "object" ? w.query : {}, transform: String(w.transform ?? ""), api_id: api.id });
  }
  return out;
}
