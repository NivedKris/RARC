import { TOOLS } from "@/lib/tools";
import { API_REGISTRY } from "@/lib/openapi";
export async function GET() {
  return Response.json({ tools: TOOLS, apis: API_REGISTRY.map((a) => ({ id: a.id, title: a.title, capability: a.capability, allow_host: a.allow_host, target: a.target, openapi: a.openapi, example_args: a.example_args })) });
}
