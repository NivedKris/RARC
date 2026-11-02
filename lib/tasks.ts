// D-Tasks: 10 tasks per pilot spec (3 dev / 7 held-out), ~30% hard. Ground truth from recorded data.
import { PILOT, PilotSpec } from "./specs";
import { computeTruth, solveC1, Truth } from "./checkers";
import { sha, stableStringify } from "./util";

export interface Task { id: string; spec_id: string; split: "dev" | "heldout"; hard: boolean; hard_reason?: string; text: string; inputs: Record<string, any>; truth: Truth }

type Base = { inputs: Record<string, any>; f?: number; hard?: string };
const W = (a: string, b: string) => ({ window_start: `2026-11-${a}T00:00Z`, window_end: `2026-11-${b}T23:59Z` });

const BASES: Record<string, Base[]> = {
  P01: [
    { inputs: { city: "Pune", checkin: "2026-11-13", nights: 2 }, f: 1.5 }, { inputs: { city: "Mumbai", checkin: "2026-11-14", nights: 1 }, f: 1.3 },
    { inputs: { city: "Delhi", checkin: "2026-11-20", nights: 2 }, f: 1.4, hard: "null entry fees" }, { inputs: { city: "Bengaluru", checkin: "2026-11-21", nights: 3 }, f: 1.8 },
    { inputs: { city: "Chennai", checkin: "2026-11-27", nights: 2 }, f: 1.2 }, { inputs: { city: "Hyderabad", checkin: "2026-11-15", nights: 1 }, f: 1.6 },
    { inputs: { city: "Jaipur", checkin: "2026-11-22", nights: 2 }, f: 1.3, hard: "flaky provider (503 on first call)" }, { inputs: { city: "Kochi", checkin: "2026-11-18", nights: 2 }, f: 1.04, hard: "string prices + tight budget" },
    { inputs: { city: "Goa", checkin: "2026-11-28", nights: 1 }, f: 0.9, hard: "infeasible budget" }, { inputs: { city: "Kolkata", checkin: "2026-11-12", nights: 2 }, f: 1.5 },
  ],
  P02: [
    { inputs: { origin: "Pune", city: "Delhi", date: "2026-11-16", nights: 2, min_rating: 4 }, f: 1.4 }, { inputs: { origin: "Mumbai", city: "Bengaluru", date: "2026-11-17", nights: 1, min_rating: 3.5 }, f: 1.3 },
    { inputs: { origin: "Delhi", city: "Mumbai", date: "2026-11-18", nights: 3, min_rating: 4 }, f: 1.5 }, { inputs: { origin: "Chennai", city: "Hyderabad", date: "2026-11-19", nights: 2, min_rating: 3 }, f: 1.25 },
    { inputs: { origin: "Kolkata", city: "Delhi", date: "2026-11-23", nights: 2, min_rating: 4.5 }, f: 1.3, hard: "high rating bar, missing ratings" }, { inputs: { origin: "Bengaluru", city: "Pune", date: "2026-11-24", nights: 1, min_rating: 3.5 }, f: 1.6 },
    { inputs: { origin: "Hyderabad", city: "Jaipur", date: "2026-11-25", nights: 2, min_rating: 3.5 }, f: 1.3, hard: "flaky hotel provider" }, { inputs: { origin: "Delhi", city: "Goa", date: "2026-11-26", nights: 2, min_rating: 4 }, f: 1.05, hard: "string prices + tight budget" },
    { inputs: { origin: "Pune", city: "Chennai", date: "2026-11-30", nights: 2, min_rating: 4 }, f: 0.93, hard: "infeasible budget" }, { inputs: { origin: "Mumbai", city: "Kolkata", date: "2026-11-20", nights: 2, min_rating: 3.5 }, f: 1.4 },
  ],
  P03: [
    { inputs: { origin: "Mumbai", city: "Pune", date: "2026-11-20", nights: 2 }, f: 1.4 }, { inputs: { origin: "Delhi", city: "Jaipur", date: "2026-11-21", nights: 1 }, f: 1.3, hard: "flaky hotel provider" },
    { inputs: { origin: "Chennai", city: "Bengaluru", date: "2026-11-14", nights: 2 }, f: 1.5 }, { inputs: { origin: "Pune", city: "Hyderabad", date: "2026-11-15", nights: 2 }, f: 1.2 },
    { inputs: { origin: "Kolkata", city: "Chennai", date: "2026-11-16", nights: 3 }, f: 1.6 }, { inputs: { origin: "Bengaluru", city: "Kochi", date: "2026-11-17", nights: 2 }, f: 1.03, hard: "string prices + tight budget" },
    { inputs: { origin: "Hyderabad", city: "Mumbai", date: "2026-11-18", nights: 1 }, f: 1.5 }, { inputs: { origin: "Delhi", city: "Kolkata", date: "2026-11-19", nights: 2 }, f: 0.95, hard: "infeasible budget" },
    { inputs: { origin: "Goa", city: "Pune", date: "2026-11-27", nights: 2 }, f: 1.3 }, { inputs: { origin: "Jaipur", city: "Delhi", date: "2026-11-28", nights: 1 }, f: 1.4 },
  ],
  P04: [
    { inputs: { city: "Bengaluru", count: 3 }, f: 1.3 }, { inputs: { city: "Pune", count: 2 }, f: 1.5 }, { inputs: { city: "Mumbai", count: 3 }, f: 1.2 },
    { inputs: { city: "Delhi", count: 2 }, f: 1.8 }, { inputs: { city: "Kolkata", count: 3 }, f: 1.5, hard: "only one veg restaurant (infeasible)" }, { inputs: { city: "Chennai", count: 4 }, f: 1.02, hard: "tight budget" },
    { inputs: { city: "Hyderabad", count: 2 }, f: 0.9, hard: "infeasible budget" }, { inputs: { city: "Jaipur", count: 3 }, f: 1.4 }, { inputs: { city: "Kochi", count: 2 }, f: 1.3 }, { inputs: { city: "Goa", count: 1 }, f: 2 },
  ],
  P05: [
    { inputs: { city: "Chennai", checkin: "2026-11-21" }, f: 1.3 }, { inputs: { city: "Pune", checkin: "2026-11-14" }, f: 1.5 }, { inputs: { city: "Delhi", checkin: "2026-11-15" }, f: 1.4, hard: "null entry fees" },
    { inputs: { city: "Bengaluru", checkin: "2026-11-22" }, f: 1.2 }, { inputs: { city: "Mumbai", checkin: "2026-11-28" }, f: 1.6 }, { inputs: { city: "Goa", checkin: "2026-11-29" }, f: 1.03, hard: "string prices + tight budget" },
    { inputs: { city: "Jaipur", checkin: "2026-11-20" }, f: 1.4, hard: "flaky provider" }, { inputs: { city: "Hyderabad", checkin: "2026-11-13" }, f: 0.92, hard: "infeasible budget" },
    { inputs: { city: "Kochi", checkin: "2026-11-27" }, f: 1.5 }, { inputs: { city: "Kolkata", checkin: "2026-11-16" }, f: 1.5 },
  ],
  P06: [
    { inputs: { city: "Pune", days: 5 } }, { inputs: { city: "Mumbai", days: 3 } }, { inputs: { city: "Delhi", days: 7 } }, { inputs: { city: "Bengaluru", days: 10 } },
    { inputs: { city: "Chennai", days: 1 } }, { inputs: { city: "Hyderabad", days: 16 }, hard: "max horizon" }, { inputs: { city: "Kochi", days: 5 }, hard: "ambiguous name (Kochi, Japan)" },
    { inputs: { city: "Jaipur", days: 4 } }, { inputs: { city: "Kolkata", days: 6 } }, { inputs: { city: "Atlantis", days: 3 }, hard: "not an Indian city" },
  ],
  P07: [
    { inputs: { city_a: "Chennai", city_b: "Delhi", days: 7 } }, { inputs: { city_a: "Mumbai", city_b: "Pune", days: 3 } }, { inputs: { city_a: "Jaipur", city_b: "Kolkata", days: 5 } },
    { inputs: { city_a: "Bengaluru", city_b: "Hyderabad", days: 10 } }, { inputs: { city_a: "Kochi", city_b: "Chennai", days: 4 }, hard: "ambiguous name (Kochi, Japan)" },
    { inputs: { city_a: "Delhi", city_b: "Delhi", days: 2 }, hard: "same city (expect 0)" }, { inputs: { city_a: "Pune", city_b: "Kolkata", days: 0 }, hard: "invalid days" },
    { inputs: { city_a: "Hyderabad", city_b: "Mumbai", days: 6 } }, { inputs: { city_a: "Kolkata", city_b: "Bengaluru", days: 8 } }, { inputs: { city_a: "Pune", city_b: "Jaipur", days: 2 } },
  ],
  P08: [
    { inputs: { city: "Mumbai", days: 7, unit: "mm" } }, { inputs: { city: "Chennai", days: 10, unit: "mm" } }, { inputs: { city: "Kolkata", days: 5, unit: "in" }, hard: "unit conversion to inches" },
    { inputs: { city: "Bengaluru", days: 14, unit: "mm" } }, { inputs: { city: "Pune", days: 3, unit: "mm" } }, { inputs: { city: "Kochi", days: 7, unit: "mm" }, hard: "ambiguous name (Kochi, Japan)" },
    { inputs: { city: "Delhi", days: 4, unit: "cm" }, hard: "unsupported unit" }, { inputs: { city: "Hyderabad", days: 9, unit: "in" } }, { inputs: { city: "Jaipur", days: 6, unit: "mm" } }, { inputs: { city: "Chennai", days: 16, unit: "in" } },
  ],
  P09: [
    { inputs: { city: "Mumbai", min_rating: 3.5 } }, { inputs: { city: "Pune", min_rating: 3 } }, { inputs: { city: "Delhi", min_rating: 4 } }, { inputs: { city: "Bengaluru", min_rating: 3.5 } },
    { inputs: { city: "Goa", min_rating: 3 }, hard: "string prices" }, { inputs: { city: "Kochi", min_rating: 3.5 }, hard: "string prices" }, { inputs: { city: "Chennai", min_rating: 4.95 }, hard: "no hotel qualifies" },
    { inputs: { city: "Jaipur", min_rating: 3.5 }, hard: "flaky provider" }, { inputs: { city: "Hyderabad", min_rating: 3 } }, { inputs: { city: "Kolkata", min_rating: 4 } },
  ],
  P10: [
    { inputs: { city: "Delhi", days: 3 } }, { inputs: { city: "Mumbai", days: 5 } }, { inputs: { city: "Pune", days: 2 } }, { inputs: { city: "Kolkata", days: 4 } },
    { inputs: { city: "Chennai", days: 1 } }, { inputs: { city: "Kochi", days: 3 }, hard: "ambiguous name (Kochi, Japan)" }, { inputs: { city: "Bengaluru", days: 7 }, hard: "days beyond 5-day horizon" },
    { inputs: { city: "Jaipur", days: 5 } }, { inputs: { city: "Hyderabad", days: 3 } }, { inputs: { city: "Springfield", days: 2 }, hard: "not an Indian city" },
  ],
  P11: [
    { inputs: { participants: ["alice", "bob", "carol"], duration_minutes: 60, ...W("09", "13") } }, { inputs: { participants: ["alice", "frank"], duration_minutes: 90, ...W("11", "11") }, hard: "all-day offsite entry" },
    { inputs: { participants: ["bob", "carol"], duration_minutes: 120, ...W("16", "18") } }, { inputs: { participants: ["alice", "bob", "carol", "frank"], duration_minutes: 60, ...W("23", "25") } },
    { inputs: { participants: ["carol", "zoe"], duration_minutes: 60, ...W("10", "12") }, hard: "unknown participant" }, { inputs: { participants: ["alice", "dave"], duration_minutes: 60, ...W("17", "19") } },
    { inputs: { participants: ["bob", "erin"], duration_minutes: 30, ...W("17", "19") }, hard: "no working-hours overlap (infeasible)" }, { inputs: { participants: ["frank", "carol"], duration_minutes: 60, ...W("30", "30") } },
    { inputs: { participants: ["alice", "bob"], duration_minutes: 45, ...W("12", "12") } }, { inputs: { participants: ["heidi", "dave"], duration_minutes: 60, ...W("20", "20") } },
  ],
  P12: [
    { inputs: { participants: ["alice", "dave"], duration_minutes: 30, ...W("10", "12") } }, { inputs: { participants: ["dave", "grace"], duration_minutes: 60, ...W("16", "18") } },
    { inputs: { participants: ["bob", "heidi"], duration_minutes: 60, ...W("23", "24") } }, { inputs: { participants: ["alice", "dave", "erin"], duration_minutes: 30, ...W("17", "20") }, hard: "no common working hours (infeasible)" },
    { inputs: { participants: ["heidi", "erin"], duration_minutes: 90, ...W("09", "11") } }, { inputs: { participants: ["carol", "dave", "heidi"], duration_minutes: 60, ...W("12", "13") } },
    { inputs: { participants: ["frank", "dave"], duration_minutes: 60, ...W("11", "11") }, hard: "all-day offsite (infeasible day)" }, { inputs: { participants: ["grace", "erin"], duration_minutes: 30, ...W("27", "27") } },
    { inputs: { participants: ["alice", "heidi"], duration_minutes: 120, ...W("18", "19") } }, { inputs: { participants: ["dave"], duration_minutes: 30, ...W("30", "30") } },
  ],
  P13: [
    { inputs: { participants: ["erin", "dave"], duration_minutes: 60, ...W("25", "27") }, hard: "Thanksgiving in window" }, { inputs: { participants: ["grace", "heidi"], duration_minutes: 30, ...W("10", "12") }, hard: "Veterans Day in window" },
    { inputs: { participants: ["erin", "grace"], duration_minutes: 60, ...W("16", "18") } }, { inputs: { participants: ["dave", "erin", "heidi"], duration_minutes: 30, ...W("23", "25") } },
    { inputs: { participants: ["grace"], duration_minutes: 120, ...W("26", "26") }, hard: "only day is a holiday (infeasible)" }, { inputs: { participants: ["erin", "heidi"], duration_minutes: 60, ...W("11", "13") } },
    { inputs: { participants: ["grace", "dave"], duration_minutes: 90, ...W("17", "19") } }, { inputs: { participants: ["erin", "alice"], duration_minutes: 30, ...W("17", "18") }, hard: "no common working hours" },
    { inputs: { participants: ["heidi", "grace"], duration_minutes: 60, ...W("30", "30") } }, { inputs: { participants: ["dave", "grace"], duration_minutes: 30, ...W("09", "09") } },
  ],
  P14: [
    { inputs: { participants: ["bob", "frank"], duration_minutes: 45, ...W("11", "13"), title: "Sync" }, hard: "all-day offsite on first day" }, { inputs: { participants: ["alice", "carol"], duration_minutes: 30, ...W("16", "17"), title: "Design review" } },
    { inputs: { participants: ["alice", "dave"], duration_minutes: 60, ...W("18", "20"), title: "Roadmap" } }, { inputs: { participants: ["bob", "carol", "heidi"], duration_minutes: 30, ...W("23", "24") } },
    { inputs: { participants: ["frank"], duration_minutes: 60, ...W("25", "25"), title: "1:1" }, hard: "offsite day (infeasible)" }, { inputs: { participants: ["carol", "dave"], duration_minutes: 90, ...W("09", "10"), title: "Planning" } },
    { inputs: { participants: ["alice", "bob"], duration_minutes: 60, ...W("30", "30"), title: "Retro" } }, { inputs: { participants: ["heidi", "bob"], duration_minutes: 45, ...W("12", "13"), title: "Hiring" } },
    { inputs: { participants: ["carol", "yuki"], duration_minutes: 30, ...W("16", "16"), title: "Intro" }, hard: "unknown participant" }, { inputs: { participants: ["dave", "frank"], duration_minutes: 30, ...W("19", "20") } },
  ],
  P15: [
    { inputs: { participants: ["alice", "carol", "frank"], duration_minutes: 60, ...W("16", "18") } }, { inputs: { participants: ["bob", "carol"], duration_minutes: 90, ...W("09", "10") } },
    { inputs: { participants: ["alice", "dave"], duration_minutes: 60, ...W("12", "13") } }, { inputs: { participants: ["frank", "bob"], duration_minutes: 120, ...W("11", "11") }, hard: "offsite day (infeasible)" },
    { inputs: { participants: ["carol", "heidi"], duration_minutes: 60, ...W("23", "24") } }, { inputs: { participants: ["alice", "bob", "carol"], duration_minutes: 180, ...W("19", "19") }, hard: "long meeting vs lunch break" },
    { inputs: { participants: ["dave", "heidi"], duration_minutes: 60, ...W("17", "17") } }, { inputs: { participants: ["alice", "erin"], duration_minutes: 30, ...W("18", "19") }, hard: "no common working hours" },
    { inputs: { participants: ["bob", "dave"], duration_minutes: 60, ...W("26", "27") } }, { inputs: { participants: ["carol", "frank"], duration_minutes: 30, ...W("30", "30") } },
  ],
};

const DEV_IDX = [1, 3, 8];

function withBudget(spec: PilotSpec, b: Base) {
  const inputs = { ...b.inputs };
  if (spec.category !== "C1") return inputs;
  const probe = solveC1(spec, { ...inputs, budget: 1e12 });
  const min = probe.min_cost ?? 10000;
  const f = b.f ?? 1.4;
  inputs.budget = f >= 1 ? Math.ceil((min * f) / 100) * 100 : Math.floor((min * f) / 100) * 100;
  return inputs;
}

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
function taskText(spec: PilotSpec, i: any): string {
  switch (spec.id) {
    case "P01": return `Plan ${i.nights} night(s) in ${i.city} from ${i.checkin} with two attractions, total under ${inr(i.budget)}.`;
    case "P02": return `Business trip ${i.origin} → ${i.city} on ${i.date}, ${i.nights} night(s), hotel rated ≥ ${i.min_rating}, under ${inr(i.budget)}.`;
    case "P03": return `Cheapest getaway ${i.origin} → ${i.city} on ${i.date} (train or flight) plus ${i.nights} night(s) of hotel, under ${inr(i.budget)}.`;
    case "P04": return `Pick ${i.count} vegetarian restaurants in ${i.city} with combined cost-for-two under ${inr(i.budget)}.`;
    case "P05": return `Family outing in ${i.city} on ${i.checkin}: veg-friendly hotel (1 night), 1 attraction, 1 veg restaurant, under ${inr(i.budget)}.`;
    case "P06": return `Average daily high in °F for ${i.city} over the next ${i.days} day(s).`;
    case "P07": return `How much warmer is ${i.city_a} than ${i.city_b} (avg daily max, °C) over the next ${i.days} day(s)?`;
    case "P08": return `Total forecast rain in ${i.city} over the next ${i.days} day(s), in ${i.unit}.`;
    case "P09": return `Average nightly price in USD of hotels in ${i.city} rated ≥ ${i.min_rating}.`;
    case "P10": return `Average PM2.5 in ${i.city} over the next ${i.days} day(s).`;
    default: return `${i.duration_minutes}-min meeting for ${i.participants.join(", ")} between ${i.window_start.slice(0, 10)} and ${i.window_end.slice(0, 10)}${i.title ? ` ("${i.title}")` : ""}.`;
  }
}

export function buildTasks(): Task[] {
  const out: Task[] = [];
  for (const spec of PILOT) {
    BASES[spec.id].forEach((b, k) => {
      const inputs = withBudget(spec, b);
      out.push({ id: `${spec.id}-T${String(k + 1).padStart(2, "0")}`, spec_id: spec.id, split: DEV_IDX.includes(k) ? "dev" : "heldout", hard: !!b.hard, hard_reason: b.hard, text: taskText(spec, inputs), inputs, truth: computeTruth(spec, inputs) });
    });
  }
  return out;
}

export function datasetHash(tasks: Task[]) { return sha(stableStringify(tasks.map((t) => ({ id: t.id, split: t.split, inputs: t.inputs, truth: t.truth }))), 16); }
