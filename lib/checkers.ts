// Programmatic checkers (plan §1.2): success is computed by code from the agent's structured output.
// Also: reference solvers (ground truth) and oracle-free verifiers used by certification tests.
import recordings from "../data/recordings.json";
import { PilotSpec } from "./specs";
import { attractions, busyAsIntervals, findCity, findPerson, hotels, lookupItem, restaurants, transports, nextDate, RECORDING_DATE } from "./world";
import { mean, round, toNum } from "./util";

const REC = recordings as any;

export interface Check { name: string; ok: boolean; detail?: string }
export interface CheckResult { success: boolean; partial_score: number; checks: Check[]; expected_status: string; got_status: string }

// ------------------------------ C1 ------------------------------
function nightsOf(spec: PilotSpec, inp: any) { return spec.c1?.fixed_nights ?? toNum(inp.nights); }
function needCount(spec: PilotSpec, inp: any, k: string) { const v = (spec.c1!.required as any)[k]; return v === undefined ? 0 : typeof v === "string" ? toNum(inp[v]) : v; }

export function c1Options(spec: PilotSpec, inp: any) {
  const cfg = spec.c1!;
  const n = nightsOf(spec, inp);
  const opts: Record<string, { id: string; cost: number }[]> = {};
  if (cfg.required.hotel) opts.hotel = hotels(inp.city).filter((h) => (!cfg.hotel_veg || h.veg_friendly) && (!cfg.min_rating || (h.rating !== undefined && h.rating >= toNum(inp.min_rating)))).map((h) => ({ id: h.id, cost: toNum(h.price_per_night) * n }));
  if (cfg.required.attraction) opts.attraction = attractions(inp.city).map((a) => ({ id: a.id, cost: toNum(a.entry_fee) }));
  if (cfg.required.restaurant) opts.restaurant = restaurants(inp.city).filter((r) => !cfg.restaurant_veg || r.veg).map((r) => ({ id: r.id, cost: r.avg_cost_for_two }));
  if (cfg.required.flight) opts.flight = transports("flight", inp.origin, inp.city, inp.date).map((t) => ({ id: t.id, cost: t.price }));
  if (cfg.required.transport) opts.transport = [...transports("flight", inp.origin, inp.city, inp.date), ...transports("train", inp.origin, inp.city, inp.date)].map((t) => ({ id: t.id, cost: t.price }));
  return opts;
}

export function solveC1(spec: PilotSpec, inp: any) {
  const opts = c1Options(spec, inp);
  let min = 0;
  for (const k of Object.keys(spec.c1!.required)) {
    const need = needCount(spec, inp, k);
    const list = (opts[k] ?? []).map((o) => o.cost).sort((a, b) => a - b);
    if (!(need >= 1) || list.length < need) return { feasible: false, min_cost: null, reason: `not enough ${k} options` };
    min += list.slice(0, need).reduce((a, b) => a + b, 0);
  }
  return { feasible: min <= toNum(inp.budget), min_cost: min, reason: min <= toNum(inp.budget) ? "" : `cheapest plan costs ${min}` };
}

function c1Checks(spec: PilotSpec, inp: any, ans: any): Check[] {
  const cfg = spec.c1!;
  const n = nightsOf(spec, inp);
  const checks: Check[] = [];
  const plan: any[] = Array.isArray(ans?.plan) ? ans.plan : [];
  const kinds = (k: string) => plan.filter((p) => (k === "transport" ? p.kind === "flight" || p.kind === "train" : p.kind === k));
  let allExist = true, costsOk = true, cityOk = true, attrsOk = true;
  const seen = new Set<string>();
  let dup = false;
  for (const it of plan) {
    if (seen.has(it.id)) dup = true;
    seen.add(it.id);
    const L = lookupItem(it.kind, it.id);
    if (!L) { allExist = false; continue; }
    const rec = L.rec;
    let truth = 0;
    if (it.kind === "hotel") truth = toNum(rec.price_per_night) * n;
    else if (it.kind === "attraction") truth = toNum(rec.entry_fee);
    else if (it.kind === "restaurant") truth = rec.avg_cost_for_two;
    else truth = rec.price;
    if (Math.abs(truth - toNum(it.cost)) > 1) costsOk = false;
    if (it.kind === "flight" || it.kind === "train") { if (rec.origin !== findCity(inp.origin)?.name || rec.destination !== findCity(inp.city)?.name || rec.date !== inp.date) cityOk = false; }
    else if (L.city !== findCity(inp.city)?.name) cityOk = false;
    if (it.kind === "hotel" && cfg.hotel_veg && !rec.veg_friendly) attrsOk = false;
    if (it.kind === "hotel" && cfg.min_rating && !(rec.rating !== undefined && rec.rating >= toNum(inp.min_rating))) attrsOk = false;
    if (it.kind === "restaurant" && cfg.restaurant_veg && !rec.veg) attrsOk = false;
  }
  checks.push({ name: "items exist in provider data", ok: allExist && plan.length > 0 });
  checks.push({ name: "no duplicate items", ok: !dup });
  checks.push({ name: "item costs match provider data", ok: costsOk });
  checks.push({ name: "location / route / date match", ok: cityOk });
  checks.push({ name: "item attribute constraints (veg / rating)", ok: attrsOk });
  let countsOk = true;
  for (const k of Object.keys(cfg.required)) if (kinds(k).length !== needCount(spec, inp, k)) countsOk = false;
  const extra = plan.filter((p) => !Object.keys(cfg.required).some((k) => (k === "transport" ? p.kind === "flight" || p.kind === "train" : p.kind === k))).length;
  checks.push({ name: "required items present (exact counts)", ok: countsOk && extra === 0 });
  const sum = plan.reduce((a, p) => a + toNum(p.cost), 0);
  checks.push({ name: "total_cost equals sum of items", ok: Math.abs(sum - toNum(ans?.total_cost)) <= 1 });
  checks.push({ name: "total within budget", ok: toNum(ans?.total_cost) <= toNum(inp.budget) && sum <= toNum(inp.budget) });
  return checks;
}

// ------------------------------ C2 ------------------------------
function geocodeIN(city: string) {
  const c = findCity(city);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c ? c.name : city)}&count=5&countryCode=IN`;
  const r = REC.http[url]?.body?.results?.[0];
  return r ? { lat: r.latitude, lon: r.longitude } : undefined;
}
function nearest(list: any[], g: { lat: number; lon: number }) {
  let best: any, bd = Infinity;
  for (const x of list) { const d = Math.hypot(x.lat - g.lat, x.lon - g.lon); if (d < bd) { bd = d; best = x; } }
  return best;
}
function forecast(city: string, days: number) {
  const g = geocodeIN(city);
  if (!g) return undefined;
  const w = nearest(REC.weather, g).daily;
  const s = w.time.indexOf(RECORDING_DATE);
  const idx = Array.from({ length: Math.min(days, 16) }, (_, i) => s + i).filter((i) => i < w.time.length);
  return idx.map((i) => ({ tmax: w.temperature_2m_max[i], precip: w.precipitation_sum[i] }));
}
export function usdRate() { return REC.http["https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD"].body.rates.USD as number; }

export function solveC2(spec: PilotSpec, inp: any): { value: number | null; unit: string; valid_input: boolean } {
  const days = Math.floor(toNum(inp.days));
  switch (spec.c2!.kind) {
    case "avg_tmax_f": { const f = findCity(inp.city) && days >= 1 && days <= 16 ? forecast(inp.city, days) : undefined; return { value: f ? round(mean(f.map((d) => d.tmax)) * 9 / 5 + 32, 2) : null, unit: "F", valid_input: !!f }; }
    case "tmax_diff_c": { const ok = findCity(inp.city_a) && findCity(inp.city_b) && days >= 1 && days <= 16; const a = ok ? forecast(inp.city_a, days) : undefined, b = ok ? forecast(inp.city_b, days) : undefined; return { value: a && b ? round(mean(a.map((d) => d.tmax)) - mean(b.map((d) => d.tmax)), 2) : null, unit: "C", valid_input: !!(a && b) }; }
    case "precip": { const unitOk = inp.unit === "mm" || inp.unit === "in"; const f = findCity(inp.city) && unitOk && days >= 1 && days <= 16 ? forecast(inp.city, days) : undefined; const mm = f ? f.reduce((a, d) => a + d.precip, 0) : null; return { value: mm === null ? null : round(inp.unit === "in" ? mm / 25.4 : mm, 3), unit: inp.unit, valid_input: !!f }; }
    case "hotel_usd": { const hs = findCity(inp.city) ? hotels(inp.city).filter((h) => h.rating !== undefined && h.rating >= toNum(inp.min_rating)) : []; return { value: hs.length ? round(mean(hs.map((h) => toNum(h.price_per_night))) * usdRate(), 2) : null, unit: "USD", valid_input: hs.length > 0 }; }
    case "pm25": {
      const g = findCity(inp.city) && days >= 1 && days <= 5 ? geocodeIN(inp.city) : undefined;
      if (!g) return { value: null, unit: "ug/m3", valid_input: false };
      const h = nearest(REC.aq, g).hourly;
      const byDay: Record<string, number[]> = {};
      h.time.forEach((t: string, i: number) => { if (h.pm2_5[i] != null) (byDay[t.slice(0, 10)] ??= []).push(h.pm2_5[i]); });
      const ds = Object.keys(byDay).sort().filter((d) => d >= RECORDING_DATE).slice(0, days);
      return { value: round(mean(ds.map((d) => round(mean(byDay[d]), 1))), 2), unit: "ug/m3", valid_input: true };
    }
  }
}

function unitMatches(expected: string, got: unknown) {
  const g = String(got ?? "").toLowerCase().replace(/[°\s]/g, "").replace("µ", "u");
  const e = expected.toLowerCase();
  if (e === "f") return ["f", "fahrenheit", "degf"].includes(g);
  if (e === "c") return ["c", "celsius", "degc"].includes(g);
  if (e === "mm") return ["mm", "millimeters", "millimetres"].includes(g);
  if (e === "in") return ["in", "inch", "inches"].includes(g);
  if (e === "usd") return ["usd", "$", "us$", "dollars"].includes(g);
  if (e === "ug/m3") return ["ug/m3", "ug/m³", "μg/m3", "μg/m³", "microgramspercubicmeter"].includes(g) || g.startsWith("ug/m") || g.startsWith("μg/m");
  return g === e;
}

// ------------------------------ C3 ------------------------------
export function usHolidays(): Set<string> {
  const b = REC.http["https://date.nager.at/api/v3/PublicHolidays/2026/US"]?.body ?? [];
  return new Set(b.filter((h: any) => h.global !== false || (h.types ?? []).includes("Public")).map((h: any) => h.date));
}

function slotViolations(spec: PilotSpec, participants: string[], s: number, e: number) {
  const cfg = spec.c3!;
  const v: string[] = [];
  const hol = cfg.us_holidays ? usHolidays() : null;
  for (const p of participants) {
    const per = findPerson(p);
    if (!per) { v.push(`unknown participant ${p}`); continue; }
    for (const [bs, be] of busyAsIntervals(per.person)) if (bs < e && be > s) { v.push(`conflict for ${p}`); break; }
    const ls = new Date(s + per.off * 60000), le = new Date(e + per.off * 60000);
    const dow = ls.getUTCDay();
    const sm = ls.getUTCHours() * 60 + ls.getUTCMinutes(), em = sm + (e - s) / 60000;
    if (cfg.working_hours && (dow === 0 || dow === 6 || sm < 540 || em > 1020 || ls.toISOString().slice(0, 10) !== le.toISOString().slice(0, 10) && em !== 1440)) v.push(`outside working hours for ${p}`);
    if (cfg.lunch && sm < 840 && em > 750) v.push(`overlaps lunch for ${p}`);
  }
  if (hol) { const ny = new Date(s - 300 * 60000).toISOString().slice(0, 10); if (hol.has(ny)) v.push(`US public holiday ${ny}`); }
  return v;
}

const parseT = (x: any) => (typeof x === "string" ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(x) ? x : x + "Z") : NaN);

export function solveC3(spec: PilotSpec, inp: any) {
  const ps: string[] = Array.isArray(inp.participants) ? inp.participants : [];
  const dur = toNum(inp.duration_minutes);
  const ws = parseT(inp.window_start), we = parseT(inp.window_end);
  if (!ps.length || ps.some((p) => !findPerson(p)) || !(dur > 0) || isNaN(ws) || isNaN(we)) return { feasible: false, earliest: null as string | null, valid_input: false };
  const step = 30 * 60000;
  for (let t = Math.ceil(ws / step) * step; t + dur * 60000 <= we; t += step) {
    if (!slotViolations(spec, ps, t, t + dur * 60000).length) return { feasible: true, earliest: new Date(t).toISOString().slice(0, 16) + "Z", valid_input: true };
  }
  return { feasible: false, earliest: null, valid_input: true };
}

function c3Checks(spec: PilotSpec, inp: any, ans: any, truthEarliest: string | null, oracle: boolean): Check[] {
  const s = parseT(ans?.start), e = parseT(ans?.end);
  const checks: Check[] = [];
  const ps: string[] = (inp.participants ?? []).map((p: string) => String(p).toLowerCase());
  checks.push({ name: "valid start/end datetimes", ok: !isNaN(s) && !isNaN(e) });
  checks.push({ name: "duration exactly as requested", ok: e - s === toNum(inp.duration_minutes) * 60000 });
  checks.push({ name: "inside the search window", ok: s >= parseT(inp.window_start) && e <= parseT(inp.window_end) });
  const got = new Set((Array.isArray(ans?.participants) ? ans.participants : []).map((p: any) => String(p).toLowerCase()));
  checks.push({ name: "all participants included (exact set)", ok: got.size === ps.length && ps.every((p) => got.has(p)) });
  const v = isNaN(s) || isNaN(e) ? ["invalid"] : slotViolations(spec, ps, s, e);
  checks.push({ name: "zero calendar conflicts", ok: !v.some((x) => x.startsWith("conflict") || x === "invalid") });
  checks.push({ name: "inside everyone's working hours", ok: !v.some((x) => x.startsWith("outside") || x === "invalid") });
  if (spec.c3!.lunch) checks.push({ name: "no lunch overlap", ok: !v.some((x) => x.startsWith("overlaps lunch")) });
  if (spec.c3!.us_holidays) checks.push({ name: "not on a US public holiday", ok: !v.some((x) => x.startsWith("US public")) });
  if (oracle && spec.c3!.earliest) checks.push({ name: "earliest feasible slot", ok: !isNaN(s) && new Date(s).toISOString().slice(0, 16) + "Z" === truthEarliest });
  return checks;
}

// ------------------------------ truth + check ------------------------------
export interface Truth { expected_status: "success" | "infeasible" | "invalid_input"; value?: number | null; unit?: string; min_cost?: number | null; earliest?: string | null; note?: string }

export function computeTruth(spec: PilotSpec, inp: any): Truth {
  if (spec.category === "C1") {
    const missing = spec.input_schema.filter((f) => f.required && (inp[f.name] === undefined || inp[f.name] === null || inp[f.name] === "")).length > 0;
    if (missing || !findCity(inp.city) || (inp.origin !== undefined && !findCity(inp.origin))) return { expected_status: "invalid_input" };
    const s = solveC1(spec, inp);
    return { expected_status: s.feasible ? "success" : "infeasible", min_cost: s.min_cost, note: s.reason };
  }
  if (spec.category === "C2") {
    const s = solveC2(spec, inp);
    return s.valid_input ? { expected_status: "success", value: s.value, unit: s.unit } : { expected_status: "invalid_input" };
  }
  const s = solveC3(spec, inp);
  if (!s.valid_input) return { expected_status: "invalid_input" };
  return { expected_status: s.feasible ? "success" : "infeasible", earliest: s.earliest };
}

const GRACEFUL = ["failed_gracefully", "needs_clarification", "infeasible"];

export function checkTask(spec: PilotSpec, inp: any, truth: Truth, run: { status: string; error_code: string | null; answer: any }): CheckResult {
  const got = run.error_code ? `error:${run.error_code}` : run.status;
  if (truth.expected_status === "invalid_input") {
    const ok = !run.error_code && GRACEFUL.includes(run.status);
    return { success: ok, partial_score: ok ? 1 : 0, checks: [{ name: "invalid input handled gracefully (no answer fabricated)", ok }], expected_status: "needs_clarification|failed_gracefully|infeasible", got_status: got };
  }
  if (truth.expected_status === "infeasible") {
    const ok = !run.error_code && run.status === "infeasible";
    return { success: ok, partial_score: ok ? 1 : 0, checks: [{ name: "reports infeasible (no valid plan exists)", ok }], expected_status: "infeasible", got_status: got };
  }
  if (run.error_code || run.status !== "success") return { success: false, partial_score: 0, checks: [{ name: "status success", ok: false, detail: got }], expected_status: "success", got_status: got };
  let checks: Check[] = [];
  if (spec.category === "C1") checks = c1Checks(spec, inp, run.answer);
  else if (spec.category === "C2") {
    const v = toNum(run.answer?.value);
    checks = [
      { name: `unit is ${truth.unit}`, ok: unitMatches(truth.unit!, run.answer?.unit) },
      { name: `value within ±${spec.c2!.tol} of ground truth ${truth.value}`, ok: Math.abs(v - (truth.value as number)) <= spec.c2!.tol, detail: `got ${v}` },
    ];
  } else checks = c3Checks(spec, inp, run.answer, truth.earliest ?? null, true);
  const passed = checks.filter((c) => c.ok).length;
  return { success: passed === checks.length, partial_score: passed / checks.length, checks, expected_status: "success", got_status: got };
}

// Oracle-free verifier for certification's `constraints_hold` property: checks the answer against
// tool data and stated constraints only, never against a solver's ground truth.
export function verifyConstraints(spec: PilotSpec, inp: any, run: { status: string; answer: any }): Check[] {
  if (run.status !== "success") return [];
  if (!spec.c1 && !spec.c2 && !spec.c3) return []; // custom spec: schema validity is enforced by the sandbox
  if (spec.category === "C1") return c1Checks(spec, inp, run.answer);
  if (spec.category === "C3") return c3Checks(spec, inp, run.answer, null, false);
  const unit = spec.c2!.kind === "avg_tmax_f" ? "F" : spec.c2!.kind === "tmax_diff_c" ? "C" : spec.c2!.kind === "precip" ? String(inp.unit) : spec.c2!.kind === "hotel_usd" ? "USD" : "ug/m3";
  const v = toNum(run.answer?.value);
  const plausible = spec.c2!.kind === "avg_tmax_f" ? v > -40 && v < 140 : spec.c2!.kind === "tmax_diff_c" ? Math.abs(v) < 60 : spec.c2!.kind === "pm25" ? v >= 0 && v < 1000 : v >= 0;
  return [{ name: `unit is ${unit}`, ok: unitMatches(unit, run.answer?.unit) }, { name: "value finite and physically plausible", ok: isFinite(v) && plausible }];
}

export { nextDate };
