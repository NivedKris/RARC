// Simulated providers (hotels, flights, trains, attractions, restaurants, calendars).
// Deterministic: every value is a pure function of a seed, so live and replay modes agree.
// Real-world quirks are deliberate (string prices, missing ratings, flaky endpoints, odd calendar
// entries) because real APIs have them, and they are what separates robust agents from fragile ones.
import { rngFor } from "./util";

export const CITIES = [
  { name: "Pune", code: "PNQ", mult: 1.0 },
  { name: "Mumbai", code: "BOM", mult: 1.5 },
  { name: "Delhi", code: "DEL", mult: 1.3 },
  { name: "Bengaluru", code: "BLR", mult: 1.25 },
  { name: "Goa", code: "GOI", mult: 1.35 },
  { name: "Jaipur", code: "JAI", mult: 1.05 },
  { name: "Chennai", code: "MAA", mult: 1.1 },
  { name: "Kolkata", code: "CCU", mult: 0.95 },
  { name: "Hyderabad", code: "HYD", mult: 1.1 },
  { name: "Kochi", code: "COK", mult: 1.0 },
] as const;

export type CityName = (typeof CITIES)[number]["name"];

export function findCity(name: unknown) {
  if (typeof name !== "string") return undefined;
  const n = name.trim().toLowerCase();
  return CITIES.find((c) => c.name.toLowerCase() === n || c.code.toLowerCase() === n);
}

const HOTEL_WORDS = ["Grand", "Residency", "Palace", "Inn", "Suites", "Retreat", "Heritage", "Comfort", "Lotus", "Orchid", "Harbour", "Courtyard"];
const ATTR_WORDS = ["Fort", "Museum", "Gardens", "Temple", "Lake", "Market", "Gallery", "Palace", "Beach", "Caves", "Zoo", "Promenade"];
const CUISINES = ["South Indian", "North Indian", "Mughlai", "Coastal", "Gujarati", "Bengali", "Cafe", "Chinese", "Italian", "Street food"];

export interface Hotel { id: string; name: string; city: string; price_per_night: number | string; rating?: number; veg_friendly: boolean }
export interface Attraction { id: string; name: string; city: string; entry_fee: number | null; duration_hours: number; category: string }
export interface Restaurant { id: string; name: string; city: string; cuisine: string; avg_cost_for_two: number; veg: boolean; rating: number }
export interface Transport { id: string; mode: "flight" | "train"; carrier: string; origin: string; destination: string; date: string; depart: string; arrive: string; price: number }

const round50 = (x: number) => Math.round(x / 50) * 50;

export function hotels(city: string): Hotel[] {
  const c = findCity(city);
  if (!c) return [];
  const r = rngFor("hotels", c.code);
  const out: Hotel[] = [];
  for (let i = 1; i <= 8; i++) {
    const price = round50((1400 + r() * 7000) * c.mult);
    const h: Hotel = {
      id: `H-${c.code}-${i}`,
      name: `${c.name} ${HOTEL_WORDS[Math.floor(r() * HOTEL_WORDS.length)]} ${HOTEL_WORDS[Math.floor(r() * HOTEL_WORDS.length)]}`,
      city: c.name,
      price_per_night: price,
      rating: Math.round((2.8 + r() * 2.1) * 10) / 10,
      veg_friendly: r() < 0.55,
    };
    // quirk: one record per city has no rating (field absent)
    if (i === 3) delete h.rating;
    // quirk: Goa and Kochi providers return formatted price strings for even ids
    if ((c.code === "GOI" || c.code === "COK") && i % 2 === 0) h.price_per_night = price.toLocaleString("en-IN");
    out.push(h);
  }
  return out;
}

export function attractions(city: string): Attraction[] {
  const c = findCity(city);
  if (!c) return [];
  const r = rngFor("attr", c.code);
  const out: Attraction[] = [];
  for (let i = 1; i <= 8; i++) {
    const cat = ATTR_WORDS[Math.floor(r() * ATTR_WORDS.length)];
    let fee: number | null = Math.round((r() < 0.25 ? 0 : 50 + r() * 1100) / 10) * 10;
    // quirk: Delhi returns null fee for free monuments
    if (c.code === "DEL" && fee === 0) fee = null;
    if (c.code === "DEL" && i === 5) fee = null;
    out.push({ id: `A-${c.code}-${i}`, name: `${c.name} ${cat} ${i}`, city: c.name, entry_fee: fee, duration_hours: 1 + Math.floor(r() * 4), category: cat.toLowerCase() });
  }
  return out;
}

export function restaurants(city: string): Restaurant[] {
  const c = findCity(city);
  if (!c) return [];
  const r = rngFor("rest", c.code);
  const out: Restaurant[] = [];
  for (let i = 1; i <= 8; i++) {
    let veg = r() < 0.5;
    if (c.code === "CCU") veg = i === 2; // quirk: only one veg place in Kolkata
    out.push({
      id: `R-${c.code}-${i}`,
      name: `${CUISINES[Math.floor(r() * CUISINES.length)]} House ${i}`,
      city: c.name,
      cuisine: CUISINES[Math.floor(r() * CUISINES.length)],
      avg_cost_for_two: round50((300 + r() * 2400) * c.mult),
      veg,
      rating: Math.round((3 + r() * 1.9) * 10) / 10,
    });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z"));
}

export function transports(mode: "flight" | "train", origin: string, destination: string, date: string): Transport[] {
  const o = findCity(origin), d = findCity(destination);
  if (!o || !d || o.code === d.code || !validDate(date)) return [];
  const r = rngFor(mode, o.code, d.code, date);
  // some routes simply don't exist
  const routeR = rngFor(mode, "route", [o.code, d.code].sort().join("-"))();
  if (mode === "flight" && routeR < 0.12) return [];
  if (mode === "train" && routeR < 0.25) return [];
  const n = mode === "flight" ? 3 : 2;
  const carriers = mode === "flight" ? ["IndiGo", "Air India", "Akasa", "SpiceJet"] : ["Rajdhani", "Shatabdi", "Duronto", "Vande Bharat"];
  const out: Transport[] = [];
  for (let k = 1; k <= n; k++) {
    const dep = 5 + Math.floor(r() * 16);
    const dur = mode === "flight" ? 1 + Math.floor(r() * 3) : 6 + Math.floor(r() * 18);
    const price = mode === "flight" ? round50(2500 + r() * 9500) : round50(450 + r() * 3000);
    const arrH = dep + dur;
    out.push({
      id: `${mode === "flight" ? "F" : "T"}-${o.code}${d.code}-${date.slice(5).replace("-", "")}-${k}`,
      mode, carrier: carriers[Math.floor(r() * carriers.length)], origin: o.name, destination: d.name, date,
      depart: `${date}T${pad(dep)}:${r() < 0.5 ? "00" : "30"}`,
      arrive: arrH < 24 ? `${date}T${pad(arrH)}:15` : `${nextDate(date, Math.floor(arrH / 24))}T${pad(arrH % 24)}:15`,
      price,
    });
  }
  return out;
}

export function nextDate(date: string, days: number) {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function lookupItem(kind: string, id: string): { city?: string; cost?: number; rec?: any } | undefined {
  if (typeof id !== "string") return undefined;
  const m = id.match(/^([HARFT])-([A-Z]{3})/);
  if (!m) return undefined;
  if (kind === "hotel" && m[1] === "H") { const c = CITIES.find((c) => c.code === m[2]); const h = c && hotels(c.name).find((x) => x.id === id); return h && { city: h.city, rec: h }; }
  if (kind === "attraction" && m[1] === "A") { const c = CITIES.find((c) => c.code === m[2]); const a = c && attractions(c.name).find((x) => x.id === id); return a && { city: a.city, rec: a }; }
  if (kind === "restaurant" && m[1] === "R") { const c = CITIES.find((c) => c.code === m[2]); const a = c && restaurants(c.name).find((x) => x.id === id); return a && { city: a.city, rec: a }; }
  if ((kind === "flight" && m[1] === "F") || (kind === "train" && m[1] === "T")) {
    const mm = id.match(/^[FT]-([A-Z]{3})([A-Z]{3})-(\d{2})(\d{2})-\d$/);
    if (!mm) return undefined;
    const o = CITIES.find((c) => c.code === mm[1]), d = CITIES.find((c) => c.code === mm[2]);
    if (!o || !d) return undefined;
    const date = `2026-${mm[3]}-${mm[4]}`;
    const t = transports(kind as any, o.name, d.name, date).find((x) => x.id === id);
    return t && { city: t.destination, rec: t };
  }
  return undefined;
}

// ---------------- People & calendars ----------------
export const PEOPLE = [
  { person: "alice", tz: "Asia/Kolkata", off: 330 },
  { person: "bob", tz: "Asia/Kolkata", off: 330 },
  { person: "carol", tz: "Asia/Kolkata", off: 330 },
  { person: "dave", tz: "Europe/London", off: 0 },
  { person: "erin", tz: "America/New_York", off: -300 },
  { person: "frank", tz: "Asia/Kolkata", off: 330 },
  { person: "grace", tz: "America/New_York", off: -300 },
  { person: "heidi", tz: "Europe/London", off: 0 },
] as const;

export function findPerson(p: unknown) {
  if (typeof p !== "string") return undefined;
  return PEOPLE.find((x) => x.person === p.trim().toLowerCase());
}

export interface Busy { start: string; end: string; title?: string; all_day?: boolean }

function iso(ms: number) { return new Date(ms).toISOString().slice(0, 16) + "Z"; }

// Busy blocks for Nov 2 .. Dec 4 2026 weekdays, in UTC.
export function busyBlocks(person: string): Busy[] {
  const p = findPerson(person);
  if (!p) return [];
  const r = rngFor("cal", p.person);
  const out: Busy[] = [];
  for (let day = 2; day <= 34; day++) {
    const base = Date.UTC(2026, 10, day);
    const dow = new Date(base).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const startLocalMin = 9 * 60 + Math.floor(r() * 15) * 30; // 09:00 .. 16:00 local
      const dur = [30, 60, 60, 90, 120][Math.floor(r() * 5)];
      const startUtc = base + (startLocalMin - p.off) * 60000;
      out.push({ start: iso(startUtc), end: iso(startUtc + dur * 60000), title: ["Standup", "1:1", "Review", "Planning", "Customer call", "Focus"][Math.floor(r() * 6)] });
    }
  }
  // quirk: frank has an all-day offsite expressed as dates only
  if (p.person === "frank") out.push({ start: "2026-11-11", end: "2026-11-12", title: "Offsite", all_day: true });
  if (p.person === "frank") out.push({ start: "2026-11-25", end: "2026-11-26", title: "Offsite", all_day: true });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function busyAsIntervals(person: string): [number, number][] {
  return busyBlocks(person).map((b) => {
    if (b.all_day) return [Date.parse(b.start + "T00:00:00Z") - (findPerson(person)!.off * 60000), Date.parse(b.end + "T00:00:00Z") - (findPerson(person)!.off * 60000)] as [number, number];
    return [Date.parse(b.start.replace("Z", ":00Z")), Date.parse(b.end.replace("Z", ":00Z"))] as [number, number];
  });
}

export const RECORDING_DATE = "2026-11-02";
