import { API_REGISTRY, synthesizeWrapper } from "@/lib/openapi";
import { fetchRecorded } from "@/lib/tools";
import { jsonError } from "@/lib/api";
export const maxDuration = 90;
export async function POST(req: Request) {
  try {
    const { api_id, mode } = await req.json();
    const api = API_REGISTRY.find((a) => a.id === api_id);
    if (!api) return jsonError("unknown api", 400);
    const m = mode === "live" ? "live" : "replay";
    const r = await synthesizeWrapper(api, { mode: m, fetchJson: async (u) => { try { return await fetchRecorded(u, m); } catch (e) { if (m === "replay") return fetchRecorded(u, "live"); throw e; } } });
    return Response.json({ ...r, openapi: api.openapi, target: api.target, title: api.title });
  } catch (e) { return jsonError(e); }
}
