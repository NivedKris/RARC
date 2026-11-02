// Turns an agent's structured answer into a human-readable result: resolves item IDs against the
// provider data, formats money / units / times, and explains non-success statuses in plain words.
// Deterministic (no LLM), so what the user reads is exactly what the agent returned.
import { findPerson, lookupItem } from "./world";
import { toNum } from "./util";

export interface ViewLine { label: string; title: string; detail?: string; amount?: string; warn?: boolean }
export interface AnswerView { tone: "good" | "warn" | "bad"; headline: string; sub?: string; lines: ViewLine[]; total?: { label: string; amount: string } }

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
function fmtDate(d: string) { const t = new Date(d + "T00:00:00Z"); return isNaN(+t) ? d : `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; }
function fmtLocal(ms: number, offMin: number) { const t = new Date(ms + offMin * 60000); return { day: `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`, time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` }; }
const parseT = (x: any) => (typeof x === "string" ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(x) ? x : x + "Z") : NaN);
const tzShort: Record<string, string> = { "Asia/Kolkata": "IST", "Europe/London": "GMT", "America/New_York": "EST" };

function statusView(status: string, errorCode: string | null, errorMessage: string | undefined, raw: any): AnswerView | null {
  const si = raw?.success_indicators ?? {};
  const reason = si.question ?? si.reason ?? si.error ?? si.message ?? (Array.isArray(raw?.trace) && raw.trace.length ? raw.trace[raw.trace.length - 1] : undefined);
  if (errorCode) return { tone: "bad", headline: "The agent failed with an error.", sub: `${errorCode}${errorMessage ? ": " + errorMessage : ""}`, lines: [] };
  if (status === "infeasible") return { tone: "warn", headline: "No option satisfies these constraints.", sub: reason ? String(reason) : "The agent searched the available options and none fit.", lines: [] };
  if (status === "needs_clarification") return { tone: "warn", headline: "The agent needs more information.", sub: reason ? String(reason) : undefined, lines: [] };
  if (status === "failed_gracefully") return { tone: "warn", headline: "The agent could not complete the task, and stopped safely.", sub: reason ? String(reason) : undefined, lines: [] };
  return null;
}

function c1View(inputs: any, a: any): AnswerView {
  const nights = toNum(inputs.nights) || 1;
  const lines: ViewLine[] = (Array.isArray(a.plan) ? a.plan : []).map((it: any) => {
    const L = lookupItem(it.kind, it.id);
    const cost = toNum(it.cost);
    const amount = cost === 0 ? "Free" : inr(cost);
    if (!L) return { label: it.kind, title: `Unknown item ${it.id}`, detail: "not found in provider data", amount, warn: true };
    const r = L.rec;
    switch (it.kind) {
      case "hotel": return { label: "Hotel", title: r.name, detail: [r.rating !== undefined ? `★ ${r.rating}` : "unrated", r.veg_friendly ? "veg-friendly" : null, `${inr(toNum(r.price_per_night))} × ${nights} night${nights > 1 ? "s" : ""}`].filter(Boolean).join(" · "), amount };
      case "attraction": return { label: "Attraction", title: r.name, detail: `${r.category} · about ${r.duration_hours} h`, amount };
      case "restaurant": return { label: "Restaurant", title: r.name, detail: `${r.cuisine} · ${r.veg ? "vegetarian" : "non-veg"} · ★ ${r.rating} · cost for two`, amount };
      default: return { label: it.kind === "flight" ? "Flight" : "Train", title: `${r.carrier} · ${r.origin} → ${r.destination}`, detail: `${fmtDate(r.date)} · departs ${r.depart.slice(11)} · arrives ${r.arrive.slice(11)}${r.arrive.slice(0, 10) !== r.date ? " (+1 day)" : ""}`, amount };
    }
  });
  const total = toNum(a.total_cost), budget = toNum(inputs.budget);
  const where = inputs.city ? ` in ${inputs.city}` : "";
  const stay = inputs.nights ? `${inputs.nights} night${toNum(inputs.nights) > 1 ? "s" : ""}${where}` : `Your plan${where}`;
  return {
    tone: budget && total > budget ? "bad" : "good",
    headline: `${stay} for ${inr(total)}`,
    sub: budget ? (total <= budget ? `${inr(budget - total)} under your ${inr(budget)} budget.` : `${inr(total - budget)} over your ${inr(budget)} budget.`) : undefined,
    lines, total: { label: "Total", amount: inr(total) },
  };
}

function c2View(specId: string | undefined, inputs: any, a: any): AnswerView {
  const v = toNum(a.value);
  const unit = String(a.unit ?? "");
  const norm = unit.toLowerCase().replace(/[°\s]/g, "");
  const u = ["f", "fahrenheit", "degf"].includes(norm) ? "°F" : ["c", "celsius", "degc"].includes(norm) ? "°C" : ["in", "inch", "inches"].includes(norm) ? "in" : unit;
  const val = `${Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)} ${u}`.trim();
  const days = inputs.days ? `over the next ${inputs.days} day${toNum(inputs.days) > 1 ? "s" : ""}` : "";
  const H: Record<string, string> = {
    P06: `Average daily high in ${inputs.city} ${days}`,
    P07: `${inputs.city_a} vs ${inputs.city_b}: difference in average daily high ${days}`,
    P08: `Total forecast rain in ${inputs.city} ${days}`,
    P09: `Average nightly hotel price in ${inputs.city} (rated ≥ ${inputs.min_rating})`,
    P10: `Average PM2.5 in ${inputs.city} ${days}`,
  };
  let sub: string | undefined;
  if (specId === "P07") sub = v > 0 ? `${inputs.city_a} is warmer by ${Math.abs(v).toFixed(2)} °C.` : v < 0 ? `${inputs.city_b} is warmer by ${Math.abs(v).toFixed(2)} °C.` : "Both cities average the same daily high.";
  if (specId === "P10") sub = v <= 15 ? "Within the WHO 24-hour guideline (15 µg/m³)." : `About ${(v / 15).toFixed(1)}× the WHO 24-hour guideline (15 µg/m³).`;
  return { tone: "good", headline: val, sub: (H[specId ?? ""] ?? "Answer") + (sub ? `. ${sub}` : ""), lines: [] };
}

function c3View(inputs: any, a: any): AnswerView {
  const s = parseT(a.start), e = parseT(a.end);
  if (isNaN(s) || isNaN(e)) return { tone: "bad", headline: "The agent returned an unreadable time slot.", sub: `${a.start} → ${a.end}`, lines: [] };
  const u = fmtLocal(s, 0), ue = fmtLocal(e, 0);
  const people: string[] = Array.isArray(a.participants) ? a.participants : [];
  const lines: ViewLine[] = people.map((p) => {
    const per = findPerson(p);
    if (!per) return { label: "Participant", title: String(p), detail: "unknown person", warn: true };
    const ls = fmtLocal(s, per.off), le = fmtLocal(e, per.off);
    return { label: "Participant", title: per.person, detail: `${per.tz}`, amount: `${ls.day}, ${ls.time}–${le.time} ${tzShort[per.tz] ?? ""}`.trim() };
  });
  const mins = Math.round((e - s) / 60000);
  return { tone: "good", headline: `${u.day}, ${u.time}–${ue.time} UTC`, sub: `${mins}-minute meeting for ${people.join(", ")}${inputs.title ? ` (“${inputs.title}”)` : ""}. Local times below.`, lines };
}

export function presentAnswer(category: string, specId: string | undefined, inputs: any, run: { status: string; error_code: string | null; error_message?: string; answer: any; raw?: any }): AnswerView | null {
  const sv = statusView(run.status, run.error_code, run.error_message, run.raw);
  if (sv) return sv;
  if (!run.answer || typeof run.answer !== "object") return null;
  try {
    if (category === "C1") return c1View(inputs ?? {}, run.answer);
    if (category === "C2") return c2View(specId, inputs ?? {}, run.answer);
    if (category === "C3") return c3View(inputs ?? {}, run.answer);
  } catch { /* fall back to raw JSON in the UI */ }
  return null;
}
