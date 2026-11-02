// Tool library + metadata store + tool client (record/replay, fault injection, side-effect policy).
import recordings from "../data/recordings.json";
import { attractions, busyBlocks, findCity, findPerson, hotels, restaurants, transports, RECORDING_DATE, nextDate } from "./world";
import { round, toNum } from "./util";

export type SideEffect = "read_only" | "reversible" | "requires_confirmation";
export interface FieldSpec { type: "string" | "number" | "integer" | "boolean" | "array" | "object"; description?: string; enum?: string[]; items?: any }
export interface ToolMeta {
  name: string;
  description: string;
  capabilities: string[];
  input: { properties: Record<string, FieldSpec>; required: string[] };
  output: string; // human/LLM-readable output shape
  side_effect: SideEffect;
  endpoints: string[];
  source: "live_api" | "simulated" | "synthesized";
  emptyShape?: "array" | string; // how an empty result looks
}

export const CAPABILITIES = [
  "geocoding", "weather_forecast", "air_quality", "hotel_search", "flight_search", "train_search",
  "attraction_search", "restaurant_search", "calendar_lookup", "person_profile", "hotel_booking",
  "send_invite", "currency_conversion", "public_holidays", "elevation", "sun_times",
] as const;

export const TOOLS: ToolMeta[] = [
  {
    name: "geocode_city", source: "live_api", side_effect: "read_only", capabilities: ["geocoding"],
    endpoints: ["geocoding-api.open-meteo.com"],
    description: "Resolve a city/place name to coordinates. Returns up to 5 matches ordered by relevance. Names are global: pass country_code (ISO-2, e.g. 'IN') to restrict to one country.",
    input: { properties: { city: { type: "string" }, country_code: { type: "string", description: "optional ISO-3166 alpha-2 filter" } }, required: ["city"] },
    output: "Array<{name: string, country_code: string, admin1?: string, latitude: number, longitude: number, timezone: string}> (empty array if no match)",
    emptyShape: "array",
  },
  {
    name: "weather_forecast", source: "live_api", side_effect: "read_only", capabilities: ["weather_forecast"],
    endpoints: ["api.open-meteo.com"],
    description: "Daily weather forecast for coordinates, starting today, up to 16 days: max/min temperature in Celsius and precipitation in mm.",
    input: { properties: { latitude: { type: "number" }, longitude: { type: "number" }, days: { type: "integer", description: "1..16" } }, required: ["latitude", "longitude", "days"] },
    output: "{latitude: number, longitude: number, daily: Array<{date: 'YYYY-MM-DD', temp_max_c: number, temp_min_c: number, precipitation_mm: number}>}",
    emptyShape: "daily",
  },
  {
    name: "air_quality", source: "live_api", side_effect: "read_only", capabilities: ["air_quality"],
    endpoints: ["air-quality-api.open-meteo.com"],
    description: "Daily air-quality forecast for coordinates, up to 5 days: mean PM2.5 (µg/m³) and max US AQI per day.",
    input: { properties: { latitude: { type: "number" }, longitude: { type: "number" }, days: { type: "integer", description: "1..5" } }, required: ["latitude", "longitude", "days"] },
    output: "{daily: Array<{date: 'YYYY-MM-DD', pm25_mean: number, us_aqi_max: number}>}",
    emptyShape: "daily",
  },
  {
    name: "search_hotels", source: "simulated", side_effect: "read_only", capabilities: ["hotel_search"],
    endpoints: ["hotels.sim.rarc"],
    description: "Search hotels in an Indian city. Prices are per night in INR. Some providers return price as a formatted string and some records lack a rating.",
    input: { properties: { city: { type: "string" }, checkin: { type: "string", description: "YYYY-MM-DD" }, nights: { type: "integer" } }, required: ["city"] },
    output: "Array<{id: string, name: string, city: string, price_per_night: number|string, rating?: number, veg_friendly: boolean}>",
    emptyShape: "array",
  },
  {
    name: "search_flights", source: "simulated", side_effect: "read_only", capabilities: ["flight_search"],
    endpoints: ["flights.sim.rarc"],
    description: "One-way flights between two Indian cities on a date. Price in INR per person.",
    input: { properties: { origin: { type: "string" }, destination: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["origin", "destination", "date"] },
    output: "Array<{id: string, mode: 'flight', carrier: string, origin: string, destination: string, date: string, depart: string, arrive: string, price: number}>",
    emptyShape: "array",
  },
  {
    name: "search_trains", source: "simulated", side_effect: "read_only", capabilities: ["train_search"],
    endpoints: ["trains.sim.rarc"],
    description: "Trains between two Indian cities on a date. Price in INR per person.",
    input: { properties: { origin: { type: "string" }, destination: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["origin", "destination", "date"] },
    output: "Array<{id: string, mode: 'train', carrier: string, origin: string, destination: string, date: string, depart: string, arrive: string, price: number}>",
    emptyShape: "array",
  },
  {
    name: "list_attractions", source: "simulated", side_effect: "read_only", capabilities: ["attraction_search"],
    endpoints: ["attractions.sim.rarc"],
    description: "Tourist attractions in a city with entry fee in INR (null means free) and typical visit duration.",
    input: { properties: { city: { type: "string" } }, required: ["city"] },
    output: "Array<{id: string, name: string, city: string, entry_fee: number|null, duration_hours: number, category: string}>",
    emptyShape: "array",
  },
  {
    name: "search_restaurants", source: "simulated", side_effect: "read_only", capabilities: ["restaurant_search"],
    endpoints: ["restaurants.sim.rarc"],
    description: "Restaurants in a city: cuisine, average cost for two (INR), vegetarian flag, rating.",
    input: { properties: { city: { type: "string" }, veg_only: { type: "boolean" } }, required: ["city"] },
    output: "Array<{id: string, name: string, city: string, cuisine: string, avg_cost_for_two: number, veg: boolean, rating: number}>",
    emptyShape: "array",
  },
  {
    name: "get_calendar", source: "simulated", side_effect: "read_only", capabilities: ["calendar_lookup"],
    endpoints: ["calendar.sim.rarc"],
    description: "Busy intervals for a person between two UTC instants. Entries are UTC 'YYYY-MM-DDTHH:mmZ'; all-day events use dates only with all_day=true (in the person's local timezone).",
    input: { properties: { person: { type: "string" }, start: { type: "string", description: "ISO date or datetime (UTC)" }, end: { type: "string", description: "ISO date or datetime (UTC)" } }, required: ["person", "start", "end"] },
    output: "{person: string, busy: Array<{start: string, end: string, title?: string, all_day?: boolean}>}",
    emptyShape: "busy",
  },
  {
    name: "get_person_profile", source: "simulated", side_effect: "read_only", capabilities: ["person_profile"],
    endpoints: ["directory.sim.rarc"],
    description: "Directory profile: IANA timezone, UTC offset in minutes, and local working hours.",
    input: { properties: { person: { type: "string" } }, required: ["person"] },
    output: "{person: string, timezone: string, utc_offset_minutes: number, working_hours: {start: 'HH:mm', end: 'HH:mm'}}",
  },
  {
    name: "book_hotel", source: "simulated", side_effect: "requires_confirmation", capabilities: ["hotel_booking"],
    endpoints: ["hotels.sim.rarc"],
    description: "Book a hotel. SIDE EFFECT: requires explicit user confirmation (context.confirmed === true).",
    input: { properties: { hotel_id: { type: "string" }, checkin: { type: "string" }, nights: { type: "integer" } }, required: ["hotel_id", "checkin", "nights"] },
    output: "{booking_id: string, status: 'confirmed'}",
  },
  {
    name: "send_invite", source: "simulated", side_effect: "requires_confirmation", capabilities: ["send_invite"],
    endpoints: ["calendar.sim.rarc"],
    description: "Send a calendar invite to participants. SIDE EFFECT: requires explicit user confirmation (context.confirmed === true).",
    input: { properties: { participants: { type: "array", items: { type: "string" } }, start: { type: "string" }, end: { type: "string" }, title: { type: "string" } }, required: ["participants", "start", "end"] },
    output: "{invite_id: string, status: 'sent'}",
  },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

// ----------------------------- implementations -----------------------------
export class ToolErr extends Error { constructor(public code: string, msg: string) { super(msg); } }

export interface ToolEnv { mode: "live" | "replay"; now: string; callIndex: number; httpLog?: string[] }
const REC = recordings as any;
let recordingsDirty = false;
export function flushRecordings() {
  if (!recordingsDirty) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs"), path = require("path");
  fs.writeFileSync(path.join(process.cwd(), "data", "recordings.json"), JSON.stringify(REC));
  recordingsDirty = false;
}

async function httpJson(url: string, env: ToolEnv) {
  env.httpLog?.push(url);
  if (env.mode === "replay") {
    let r = REC.http[url];
    if (!r && process.env.RARC_RECORD === "1") {
      // record-on-first-use (eval only): the live response becomes part of the replay set
      try { const res = await fetch(url, { signal: AbortSignal.timeout(10000) }); r = REC.http[url] = { status: res.status, body: await res.json().catch(() => null) }; recordingsDirty = true; } catch { /* fall through */ }
    }
    if (!r) throw new ToolErr("NO_RECORDING", `no recorded response for ${url}`);
    if (r.status !== 200) throw new ToolErr("UPSTREAM_" + r.status, "upstream error");
    return r.body;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new ToolErr("UPSTREAM_" + res.status, `upstream returned ${res.status}`);
  return res.json();
}

function nearest(list: any[], lat: number, lon: number) {
  let best: any, bd = Infinity;
  for (const x of list) { const d = Math.hypot(x.lat - lat, x.lon - lon); if (d < bd) { bd = d; best = x; } }
  return bd < 0.3 ? best : undefined;
}

function needNum(v: unknown, name: string) { if (typeof v !== "number" || !isFinite(v)) throw new ToolErr("INVALID_ARGS", `${name} must be a number`); return v; }

const impl: Record<string, (a: any, env: ToolEnv) => Promise<any>> = {
  async geocode_city(a, env) {
    const cc = typeof a.country_code === "string" && a.country_code ? `&countryCode=${a.country_code.trim().toUpperCase()}` : "";
    const known = findCity(a.city);
    let body: any;
    try { body = await httpJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(known ? known.name : String(a.city).trim())}&count=5${cc}`, env); }
    catch (e) { if (e instanceof ToolErr && e.code === "NO_RECORDING") return []; throw e; }
    return (body.results ?? []).map((r: any) => ({ name: r.name, country_code: r.country_code, admin1: r.admin1, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone }));
  },
  async weather_forecast(a, env) {
    const lat = needNum(a.latitude, "latitude"), lon = needNum(a.longitude, "longitude");
    const days = Math.max(1, Math.min(16, Math.floor(toNum(a.days) || 7)));
    let daily: any;
    if (env.mode === "replay") {
      const w = nearest(REC.weather, lat, lon);
      if (!w) throw new ToolErr("NO_DATA", "no forecast for these coordinates");
      daily = w.daily;
    } else {
      daily = (await httpJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=16`, env)).daily;
    }
    const start = Math.max(0, daily.time.indexOf(env.now));
    const out = [];
    for (let i = start; i < Math.min(daily.time.length, start + days); i++) out.push({ date: daily.time[i], temp_max_c: daily.temperature_2m_max[i], temp_min_c: daily.temperature_2m_min[i], precipitation_mm: daily.precipitation_sum[i] });
    return { latitude: lat, longitude: lon, daily: out };
  },
  async air_quality(a, env) {
    const lat = needNum(a.latitude, "latitude"), lon = needNum(a.longitude, "longitude");
    const days = Math.max(1, Math.min(5, Math.floor(toNum(a.days) || 3)));
    let hourly: any;
    if (env.mode === "replay") {
      const w = nearest(REC.aq, lat, lon);
      if (!w) throw new ToolErr("NO_DATA", "no air-quality data for these coordinates");
      hourly = w.hourly;
    } else hourly = (await httpJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,us_aqi&forecast_days=5&timezone=auto`, env)).hourly;
    const byDay: Record<string, { pm: number[]; aqi: number[] }> = {};
    hourly.time.forEach((t: string, i: number) => {
      const d = t.slice(0, 10);
      (byDay[d] ??= { pm: [], aqi: [] });
      if (hourly.pm2_5[i] != null) byDay[d].pm.push(hourly.pm2_5[i]);
      if (hourly.us_aqi[i] != null) byDay[d].aqi.push(hourly.us_aqi[i]);
    });
    const dates = Object.keys(byDay).sort().filter((d) => d >= env.now).slice(0, days);
    return { daily: dates.map((d) => ({ date: d, pm25_mean: round(byDay[d].pm.reduce((x, y) => x + y, 0) / Math.max(1, byDay[d].pm.length), 1), us_aqi_max: Math.max(...byDay[d].aqi, 0) })) };
  },
  async search_hotels(a, env) {
    // quirk: the Jaipur provider fails on the first request of a session (recorded flake)
    if (findCity(a.city)?.code === "JAI" && env.callIndex === 0) throw new ToolErr("UPSTREAM_503", "service temporarily unavailable, retry");
    return hotels(a.city);
  },
  async search_flights(a) { return transports("flight", a.origin, a.destination, a.date); },
  async search_trains(a) { return transports("train", a.origin, a.destination, a.date); },
  async list_attractions(a) { return attractions(a.city); },
  async search_restaurants(a) { const r = restaurants(a.city); return a.veg_only ? r.filter((x) => x.veg) : r; },
  async get_calendar(a) {
    const p = findPerson(a.person);
    if (!p) throw new ToolErr("NOT_FOUND", `unknown person '${a.person}'`);
    const s = normIso(String(a.start)), e = normIso(String(a.end));
    if (!s || !e) throw new ToolErr("INVALID_ARGS", "start/end must be ISO dates or datetimes");
    return { person: p.person, busy: busyBlocks(p.person).filter((b) => { const bs = normIso(b.start)!, be = normIso(b.end)!; return bs < e && be > s; }) };
  },
  async get_person_profile(a) {
    const p = findPerson(a.person);
    if (!p) throw new ToolErr("NOT_FOUND", `unknown person '${a.person}'`);
    return { person: p.person, timezone: p.tz, utc_offset_minutes: p.off, working_hours: { start: "09:00", end: "17:00" } };
  },
  async book_hotel(a) { return { booking_id: "BK-" + String(a.hotel_id), status: "confirmed" }; },
  async send_invite() { return { invite_id: "INV-" + Date.now().toString(36), status: "sent" }; },
};

// ----------------------------- synthesized wrappers -----------------------------
export interface Wrapper {
  tool: ToolMeta;
  method: "GET";
  base_url: string;
  path_template: string; // e.g. /api/v3/PublicHolidays/{year}/{countryCode}
  query: Record<string, string>; // query param -> "{arg}" template or literal
  transform: string; // JS source: function transform(body, args) { ... }
  api_id: string;
}

// ----------------------------- fault injection -----------------------------
export type FaultKind = "error" | "timeout" | "empty" | "null" | "schema_drift" | "slow";
export interface Fault { tool: string; fault: FaultKind; calls?: "all" | "first" | number }

export function applyDrift(tool: string, data: any): any {
  const strNums = (o: any): any => Array.isArray(o) ? o.map(strNums) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? String(v) : strNums(v)])) : o;
  switch (tool) {
    case "search_hotels": return (data as any[]).map(({ rating, ...h }) => ({ ...h, price_per_night: String(h.price_per_night), stars: rating }));
    case "weather_forecast": return { ...data, daily: data.daily.map((d: any) => ({ date: d.date, tmax: d.temp_max_c, tmin: d.temp_min_c, precipitation_mm: String(d.precipitation_mm) })) };
    case "get_calendar": return { ...data, busy: data.busy.map((b: any) => ({ from: b.start, to: b.end, title: b.title })) };
    case "geocode_city": return (data as any[]).map((g) => ({ ...g, latitude: String(g.latitude), longitude: String(g.longitude) }));
    default: return strNums(data);
  }
}

function emptyOf(meta: ToolMeta | undefined, data: any) {
  if (!meta?.emptyShape || meta.emptyShape === "array" || Array.isArray(data)) return [];
  return { ...data, [meta.emptyShape]: [] };
}

// ----------------------------- tool client -----------------------------
export interface TraceStep { i: number; tool: string; args: any; ok: boolean; result_preview?: string; error?: { code: string; message: string }; ms: number; fault?: string; synthesized?: boolean }
export interface ClientStats { calls: number; unknown_tool_calls: number; invalid_arg_calls: number; confirm_violations: number; net_denied: number; call_cap_hit: boolean; side_effect_calls: string[] }

export const MAX_TOOL_CALLS = 40;

export function validateArgs(meta: ToolMeta, args: any): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "args must be an object";
  for (const r of meta.input.required) if (args[r] === undefined || args[r] === null || args[r] === "") return `missing required argument '${r}'`;
  for (const [k, v] of Object.entries(args)) {
    const f = meta.input.properties[k];
    if (!f) continue;
    if (v === undefined || v === null) continue;
    const t = f.type;
    const ok = t === "string" ? typeof v === "string" : t === "number" ? typeof v === "number" && isFinite(v) : t === "integer" ? Number.isInteger(v) : t === "boolean" ? typeof v === "boolean" : t === "array" ? Array.isArray(v) : typeof v === "object";
    if (!ok) return `argument '${k}' must be ${t}`;
  }
  return null;
}

export interface ToolClientOpts {
  allowed: string[];
  wrappers?: Wrapper[];
  mode: "live" | "replay";
  now?: string;
  faults?: Fault[];
  confirmed?: boolean;
  runWrapperTransform?: (w: Wrapper, body: any, args: any) => Promise<any>;
  onStep?: (s: TraceStep) => void;
}

export function makeToolClient(o: ToolClientOpts) {
  const trace: TraceStep[] = [];
  const stats: ClientStats = { calls: 0, unknown_tool_calls: 0, invalid_arg_calls: 0, confirm_violations: 0, net_denied: 0, call_cap_hit: false, side_effect_calls: [] };
  const perTool: Record<string, number> = {};
  const now = o.now ?? (o.mode === "replay" ? RECORDING_DATE : new Date().toISOString().slice(0, 10));
  const httpLog: string[] = [];

  async function call(name: string, args: any): Promise<{ data?: any; error?: { code: string; message: string }; fatal?: string }> {
    const t0 = Date.now();
    stats.calls++;
    if (stats.calls > MAX_TOOL_CALLS) { stats.call_cap_hit = true; return { fatal: "ResourceLimit", error: { code: "CALL_CAP", message: `tool-call budget of ${MAX_TOOL_CALLS} exceeded` } }; }
    const idx = (perTool[name] = (perTool[name] ?? -1) + 1);
    const wrapper = o.wrappers?.find((w) => w.tool.name === name);
    const meta = wrapper?.tool ?? toolByName(name);
    const step: TraceStep = { i: trace.length, tool: name, args, ok: false, ms: 0, synthesized: !!wrapper };
    const finish = (r: { data?: any; error?: { code: string; message: string }; fatal?: string }) => {
      step.ms = Date.now() - t0;
      step.ok = !r.error;
      if (r.error) step.error = r.error; else step.result_preview = preview(r.data);
      trace.push(step); o.onStep?.(step);
      return r;
    };
    if (!meta || (!o.allowed.includes(name) && !wrapper)) { stats.unknown_tool_calls++; return finish({ error: { code: "UNKNOWN_TOOL", message: `tool '${name}' is not attached to this agent` } }); }
    if (meta.side_effect === "requires_confirmation") {
      stats.side_effect_calls.push(name);
      if (!o.confirmed) { stats.confirm_violations++; return finish({ fatal: "ConfirmRequired", error: { code: "CONFIRM_REQUIRED", message: `${name} requires user confirmation` } }); }
    }
    const bad = validateArgs(meta, args);
    if (bad) { stats.invalid_arg_calls++; return finish({ error: { code: "INVALID_ARGS", message: bad } }); }
    const f = o.faults?.find((f) => (f.tool === name || f.tool === "*") && (f.calls === undefined || f.calls === "all" || (f.calls === "first" && idx === 0) || f.calls === idx));
    if (f) step.fault = f.fault;
    if (f?.fault === "error") return finish({ error: { code: "UPSTREAM_500", message: "injected upstream failure" } });
    if (f?.fault === "timeout") return finish({ error: { code: "TIMEOUT", message: "tool call timed out" } });
    if (f?.fault === "slow") await new Promise((r) => setTimeout(r, 150));
    try {
      let data: any;
      if (wrapper) {
        const url = buildWrapperUrl(wrapper, args);
        const body = await httpJson(url, { mode: o.mode, now, callIndex: idx, httpLog });
        data = o.runWrapperTransform ? await o.runWrapperTransform(wrapper, body, args) : body;
      } else data = await impl[name](args, { mode: o.mode, now, callIndex: idx, httpLog });
      if (f?.fault === "empty") data = emptyOf(meta, data);
      if (f?.fault === "null") data = null;
      if (f?.fault === "schema_drift") data = applyDrift(name, data);
      return finish({ data });
    } catch (e: any) {
      if (e instanceof ToolErr) return finish({ error: { code: e.code, message: e.message } });
      return finish({ error: { code: "TOOL_FAILURE", message: String(e?.message ?? e) } });
    }
  }
  return { call, trace, stats, now, httpLog };
}

export function buildWrapperUrl(w: Wrapper, args: any) {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(args?.[k] ?? ""));
  const path = fill(w.path_template);
  const q = Object.entries(w.query).map(([k, v]) => [k, fill(v)]).filter(([, v]) => v !== "");
  return w.base_url.replace(/\/$/, "") + path + (q.length ? "?" + q.map(([k, v]) => `${k}=${v}`).join("&") : "");
}

export function normIso(s: string): string | null {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 16) + "Z";
}

function preview(d: any) {
  const s = JSON.stringify(d);
  return s && s.length > 300 ? s.slice(0, 300) + "…" : s;
}

export function toolCard(t: ToolMeta) {
  const args = Object.entries(t.input.properties).map(([k, f]) => `${k}${t.input.required.includes(k) ? "" : "?"}: ${f.type}${f.description ? ` /* ${f.description} */` : ""}`).join(", ");
  return `- ${t.name}({${args}}) -> ${t.output}\n  ${t.description} [side_effect=${t.side_effect}]`;
}

export { nextDate };

export async function fetchRecorded(url: string, mode: "live" | "replay") {
  return httpJson(url, { mode, now: RECORDING_DATE, callIndex: 0 });
}
