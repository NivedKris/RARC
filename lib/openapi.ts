// D-OpenAPI: external APIs available for wrapper synthesis (US-3). Each entry: an OpenAPI document,
// the capability it provides, the target tool interface, one example call and an output validator.
import { ToolMeta, Wrapper, buildWrapperUrl } from "./tools";
import { complete, LlmCall } from "./llm";
import { runTransform } from "./sandbox";

export interface ApiEntry {
  id: string;
  title: string;
  capability: string;
  allow_host: string;
  openapi: any;
  target: ToolMeta;
  example_args: any;
  validate: (out: any) => string | null;
}

const num = (x: any) => typeof x === "number" && isFinite(x);

export const API_REGISTRY: ApiEntry[] = [
  {
    id: "frankfurter", title: "Frankfurter exchange rates (ECB)", capability: "currency_conversion", allow_host: "api.frankfurter.dev",
    openapi: {
      openapi: "3.0.0", info: { title: "Frankfurter", version: "1.0" }, servers: [{ url: "https://api.frankfurter.dev" }],
      paths: {
        "/v1/latest": { get: { summary: "Latest exchange rates", parameters: [
          { name: "base", in: "query", schema: { type: "string" }, description: "Base currency ISO code, default EUR" },
          { name: "symbols", in: "query", schema: { type: "string" }, description: "Comma-separated target currency codes" },
        ], responses: { "200": { description: "OK", content: { "application/json": { example: { amount: 1.0, base: "INR", date: "2026-10-30", rates: { USD: 0.0105 } } } } } } } },
        "/v1/{date}": { get: { summary: "Historical rates for a date", parameters: [{ name: "date", in: "path", required: true, schema: { type: "string" } }, { name: "base", in: "query", schema: { type: "string" } }] } },
        "/v1/currencies": { get: { summary: "List supported currencies" } },
      },
    },
    target: {
      name: "convert_currency", source: "synthesized", side_effect: "read_only", capabilities: ["currency_conversion"], endpoints: ["api.frankfurter.dev"],
      description: "Convert an amount between currencies at the latest ECB reference rate.",
      input: { properties: { amount: { type: "number" }, from: { type: "string", description: "ISO currency code, e.g. INR" }, to: { type: "string", description: "ISO currency code, e.g. USD" } }, required: ["amount", "from", "to"] },
      output: "{amount: number, from: string, to: string, rate: number, converted: number, date: string}",
    },
    example_args: { amount: 1000, from: "INR", to: "USD" },
    validate: (o) => (!o || !num(o.rate) || !num(o.converted) || typeof o.from !== "string" || typeof o.to !== "string" ? "expected {amount, from, to, rate:number, converted:number, date}" : Math.abs(o.converted - o.amount * o.rate) > 1e-6 * Math.max(1, o.converted) ? "converted must equal amount * rate" : null),
  },
  {
    id: "nager", title: "Nager.Date public holidays", capability: "public_holidays", allow_host: "date.nager.at",
    openapi: {
      openapi: "3.0.1", info: { title: "Nager.Date API", version: "v3" }, servers: [{ url: "https://date.nager.at" }],
      paths: {
        "/api/v3/PublicHolidays/{year}/{countryCode}": { get: { summary: "Get public holidays", parameters: [{ name: "year", in: "path", required: true, schema: { type: "integer" } }, { name: "countryCode", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Success", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { date: { type: "string", format: "date" }, localName: { type: "string" }, name: { type: "string" }, countryCode: { type: "string" }, global: { type: "boolean" }, types: { type: "array", items: { type: "string" } } } } } } } } } } },
        "/api/v3/AvailableCountries": { get: { summary: "Get all available countries" } },
        "/api/v3/NextPublicHolidaysWorldwide": { get: { summary: "Upcoming holidays worldwide" } },
      },
    },
    target: {
      name: "public_holidays", source: "synthesized", side_effect: "read_only", capabilities: ["public_holidays"], endpoints: ["date.nager.at"],
      description: "Public holidays for a country and year.",
      input: { properties: { country_code: { type: "string", description: "ISO-2, e.g. US" }, year: { type: "integer" } }, required: ["country_code", "year"] },
      output: "Array<{date: 'YYYY-MM-DD', name: string}>",
      emptyShape: "array",
    },
    example_args: { country_code: "US", year: 2026 },
    validate: (o) => (!Array.isArray(o) || !o.length || o.some((h) => typeof h?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || typeof h?.name !== "string") ? "expected non-empty Array<{date:'YYYY-MM-DD', name:string}>" : null),
  },
  {
    id: "elevation", title: "Open-Meteo Elevation API", capability: "elevation", allow_host: "api.open-meteo.com",
    openapi: {
      openapi: "3.0.0", info: { title: "Open-Meteo Elevation", version: "1.0" }, servers: [{ url: "https://api.open-meteo.com" }],
      paths: { "/v1/elevation": { get: { summary: "Digital elevation model (90 m)", parameters: [{ name: "latitude", in: "query", required: true, schema: { type: "string" }, description: "comma-separated list allowed" }, { name: "longitude", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { content: { "application/json": { example: { elevation: [542.0] } } } } } } } },
    },
    target: {
      name: "get_elevation", source: "synthesized", side_effect: "read_only", capabilities: ["elevation"], endpoints: ["api.open-meteo.com"],
      description: "Terrain elevation in metres above sea level for coordinates.",
      input: { properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"] },
      output: "{elevation_m: number}",
    },
    example_args: { latitude: 18.52, longitude: 73.86 },
    validate: (o) => (!o || !num(o.elevation_m) ? "expected {elevation_m:number}" : null),
  },
  {
    id: "sunrise", title: "Sunrise-Sunset API", capability: "sun_times", allow_host: "api.sunrise-sunset.org",
    openapi: {
      openapi: "3.0.0", info: { title: "Sunrise Sunset", version: "1.0" }, servers: [{ url: "https://api.sunrise-sunset.org" }],
      paths: { "/json": { get: { summary: "Sunrise and sunset times", parameters: [{ name: "lat", in: "query", required: true, schema: { type: "number" } }, { name: "lng", in: "query", required: true, schema: { type: "number" } }, { name: "date", in: "query", schema: { type: "string" }, description: "YYYY-MM-DD or 'today'" }, { name: "formatted", in: "query", schema: { type: "integer" }, description: "0 = ISO 8601 times, day_length in seconds" }],
        responses: { "200": { content: { "application/json": { example: { results: { sunrise: "2026-11-10T01:13:01+00:00", sunset: "2026-11-10T12:30:51+00:00", day_length: 40670 }, status: "OK" } } } } } } } },
    },
    target: {
      name: "sun_times", source: "synthesized", side_effect: "read_only", capabilities: ["sun_times"], endpoints: ["api.sunrise-sunset.org"],
      description: "Sunrise/sunset (UTC ISO) and day length for coordinates on a date.",
      input: { properties: { latitude: { type: "number" }, longitude: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["latitude", "longitude", "date"] },
      output: "{sunrise_utc: string, sunset_utc: string, day_length_s: number}",
    },
    example_args: { latitude: 18.52, longitude: 73.86, date: "2026-11-10" },
    validate: (o) => (!o || typeof o.sunrise_utc !== "string" || typeof o.sunset_utc !== "string" || !num(o.day_length_s) ? "expected {sunrise_utc, sunset_utc, day_length_s:number}" : null),
  },
];

export const apiForCapability = (c: string) => API_REGISTRY.find((a) => a.capability === c);

export interface SynthAttempt { attempt: number; url?: string; ok: boolean; error?: string; output?: any }
export interface SynthResult { api_id: string; wrapper: Wrapper | null; valid: boolean; attempts: SynthAttempt[]; repairs: number; calls: LlmCall[] }

const SYS = `You synthesize MCP-compatible tool wrappers from OpenAPI documents. Output ONLY JSON:
{"method":"GET","base_url":"https://...","path_template":"/path/{arg}","query":{"param":"{arg} or literal"},"transform":"function transform(body, args) { ... return <output>; }"}
Rules: placeholders {name} refer to the TARGET tool's argument names. base_url must be one of the OpenAPI servers. transform is plain ES2020 JavaScript, pure (no I/O), and must return exactly the target output shape.`;

export async function synthesizeWrapper(api: ApiEntry, opts: { mode: "live" | "replay"; maxRepairs?: number; fetchJson: (url: string) => Promise<any> }): Promise<SynthResult> {
  const calls: LlmCall[] = [];
  const attempts: SynthAttempt[] = [];
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYS },
    { role: "user", content: `OpenAPI document:\n${JSON.stringify(api.openapi, null, 1)}\n\nTARGET tool interface:\nname: ${api.target.name}\ndescription: ${api.target.description}\narguments: ${JSON.stringify(api.target.input)}\noutput shape: ${api.target.output}\n\nExample call arguments: ${JSON.stringify(api.example_args)}` },
  ];
  const maxRepairs = opts.maxRepairs ?? 2;
  for (let a = 0; a <= maxRepairs; a++) {
    let spec: any;
    try { spec = (await complete("wrapper", msgs, { json: true, calls, stage: "wrapper_synthesis" })).json; }
    catch (e: any) { attempts.push({ attempt: a, ok: false, error: "LLM: " + e.message }); break; }
    const w: Wrapper = { tool: api.target, method: "GET", base_url: String(spec?.base_url ?? ""), path_template: String(spec?.path_template ?? ""), query: spec?.query && typeof spec.query === "object" ? spec.query : {}, transform: String(spec?.transform ?? ""), api_id: api.id };
    let err: string | null = null, url: string | undefined, out: any;
    try {
      url = buildWrapperUrl(w, api.example_args);
      const host = new URL(url).host;
      if (host !== api.allow_host) err = `host ${host} is not on the allow-list (${api.allow_host})`;
      else {
        const body = await opts.fetchJson(url);
        const t = await runTransform(w.transform, body, api.example_args);
        if (!t.ok) err = "transform failed: " + t.error;
        else { out = t.value; err = api.validate(out); }
      }
    } catch (e: any) { err = String(e?.message ?? e); }
    attempts.push({ attempt: a, url, ok: !err, error: err ?? undefined, output: out });
    if (!err) return { api_id: api.id, wrapper: w, valid: true, attempts, repairs: a, calls };
    msgs.push({ role: "assistant", content: JSON.stringify(spec) }, { role: "user", content: `Validation failed for the example call${url ? ` (${url})` : ""}: ${err}. Return corrected JSON only.` });
  }
  return { api_id: api.id, wrapper: null, valid: false, attempts, repairs: maxRepairs, calls };
}
