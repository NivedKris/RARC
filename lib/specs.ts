// D-Pilot (15 agent specs, C1–C3), D-Intake (30 specs, 20% ambiguous), D-Retrieval (gold tools).
export interface InputField { name: string; type: string; description: string; required: boolean }
export interface C1Cfg { required: Partial<Record<"hotel" | "attraction" | "restaurant" | "flight" | "transport", number | string>>; hotel_veg?: boolean; restaurant_veg?: boolean; min_rating?: boolean; fixed_nights?: number }
export interface C3Cfg { earliest: boolean; working_hours: boolean; lunch?: boolean; us_holidays?: boolean; invite?: boolean }
export interface PilotSpec {
  id: string;
  category: "C1" | "C2" | "C3";
  title: string;
  text: string;
  gold_capabilities: string[];
  gold_tools: { required: string[]; useful: string[] };
  input_schema: InputField[];
  example_inputs: Record<string, any>;
  c1?: C1Cfg;
  c2?: { kind: "avg_tmax_f" | "tmax_diff_c" | "precip" | "hotel_usd" | "pm25"; tol: number };
  c3?: C3Cfg;
}

const F = (name: string, type: string, description: string, required = true): InputField => ({ name, type, description, required });

export const PILOT: PilotSpec[] = [
  // ---------------- C1 constrained planning ----------------
  {
    id: "P01", category: "C1", title: "Weekend city-break planner",
    text: "Build an agent that plans a short city break: pick one hotel for the given number of nights plus two different attractions in that city, keeping the total cost (hotel nights + entry fees) within the user's budget in INR. If nothing fits the budget, say it is infeasible.",
    gold_capabilities: ["hotel_search", "attraction_search"], gold_tools: { required: ["search_hotels", "list_attractions"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("checkin", "string", "YYYY-MM-DD"), F("nights", "integer", "number of nights"), F("budget", "number", "total budget in INR")],
    example_inputs: { city: "Pune", checkin: "2026-11-13", nights: 2, budget: 15000 },
    c1: { required: { hotel: 1, attraction: 2 } },
  },
  {
    id: "P02", category: "C1", title: "Business-trip planner",
    text: "Create an agent for business travel: book-ready plan with one flight from the origin city to the destination on the travel date and one hotel rated at least the minimum rating for the stay, with flight + hotel total within budget (INR). Report infeasible if no combination fits.",
    gold_capabilities: ["flight_search", "hotel_search"], gold_tools: { required: ["search_flights", "search_hotels"], useful: [] },
    input_schema: [F("origin", "string", "departure city"), F("city", "string", "destination city"), F("date", "string", "travel date YYYY-MM-DD (also hotel check-in)"), F("nights", "integer", "hotel nights"), F("budget", "number", "INR"), F("min_rating", "number", "minimum hotel rating (records without a rating do not qualify)")],
    example_inputs: { origin: "Pune", city: "Delhi", date: "2026-11-16", nights: 2, budget: 20000, min_rating: 4 },
    c1: { required: { flight: 1, hotel: 1 }, min_rating: true },
  },
  {
    id: "P03", category: "C1", title: "Cheapest getaway (train or flight)",
    text: "I want an agent that finds the cheapest way to do a getaway: choose either a train or a flight from origin to destination on the date (whichever makes the plan cheapest) plus one hotel for the nights, total within budget in INR, otherwise infeasible.",
    gold_capabilities: ["flight_search", "train_search", "hotel_search"], gold_tools: { required: ["search_flights", "search_trains", "search_hotels"], useful: [] },
    input_schema: [F("origin", "string", "departure city"), F("city", "string", "destination city"), F("date", "string", "YYYY-MM-DD"), F("nights", "integer", "hotel nights"), F("budget", "number", "INR")],
    example_inputs: { origin: "Mumbai", city: "Jaipur", date: "2026-11-20", nights: 2, budget: 12000 },
    c1: { required: { transport: 1, hotel: 1 } },
  },
  {
    id: "P04", category: "C1", title: "Vegetarian food tour",
    text: "Make an agent that plans a vegetarian food crawl: choose the requested number of distinct vegetarian restaurants in the city so that the sum of their average cost for two stays within the budget (INR). If there are not enough veg places or the budget is too low, return infeasible.",
    gold_capabilities: ["restaurant_search"], gold_tools: { required: ["search_restaurants"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("count", "integer", "number of restaurants"), F("budget", "number", "INR, compared against the sum of avg_cost_for_two")],
    example_inputs: { city: "Bengaluru", count: 3, budget: 5000 },
    c1: { required: { restaurant: "count" }, restaurant_veg: true },
  },
  {
    id: "P05", category: "C1", title: "Family day-out with overnight stay",
    text: "Build an agent that plans a family outing: one night at a veg-friendly hotel, one attraction and one vegetarian restaurant (cost = average cost for two), all in the same city, total within the budget in INR, or infeasible.",
    gold_capabilities: ["hotel_search", "attraction_search", "restaurant_search"], gold_tools: { required: ["search_hotels", "list_attractions", "search_restaurants"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("checkin", "string", "YYYY-MM-DD"), F("budget", "number", "INR")],
    example_inputs: { city: "Chennai", checkin: "2026-11-21", budget: 9000 },
    c1: { required: { hotel: 1, attraction: 1, restaurant: 1 }, hotel_veg: true, restaurant_veg: true, fixed_nights: 1 },
  },
  // ---------------- C2 lookup + compute ----------------
  {
    id: "P06", category: "C2", title: "Average high temperature in °F",
    text: "I need an agent that tells me the average daily maximum temperature in Fahrenheit for an Indian city over the next N days (starting today), using a live forecast.",
    gold_capabilities: ["geocoding", "weather_forecast"], gold_tools: { required: ["geocode_city", "weather_forecast"], useful: [] },
    input_schema: [F("city", "string", "city in India"), F("days", "integer", "1..16")],
    example_inputs: { city: "Pune", days: 5 },
    c2: { kind: "avg_tmax_f", tol: 0.5 },
  },
  {
    id: "P07", category: "C2", title: "Which city is warmer?",
    text: "Build an agent that compares two Indian cities: the difference between their average daily maximum temperatures (city_a minus city_b) in Celsius over the next N days.",
    gold_capabilities: ["geocoding", "weather_forecast"], gold_tools: { required: ["geocode_city", "weather_forecast"], useful: [] },
    input_schema: [F("city_a", "string", "Indian city"), F("city_b", "string", "Indian city"), F("days", "integer", "1..16")],
    example_inputs: { city_a: "Chennai", city_b: "Delhi", days: 7 },
    c2: { kind: "tmax_diff_c", tol: 0.3 },
  },
  {
    id: "P08", category: "C2", title: "Rain total for trip planning",
    text: "Create an agent that totals the forecast precipitation for an Indian city over the next N days and reports it in the unit the user asks for (mm or in).",
    gold_capabilities: ["geocoding", "weather_forecast"], gold_tools: { required: ["geocode_city", "weather_forecast"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("days", "integer", "1..16"), F("unit", "string", "'mm' or 'in'")],
    example_inputs: { city: "Mumbai", days: 7, unit: "mm" },
    c2: { kind: "precip", tol: 0.2 },
  },
  {
    id: "P09", category: "C2", title: "Hotel prices in US dollars",
    text: "I want an agent that reports the average nightly price, converted to US dollars at today's exchange rate, of hotels in an Indian city whose rating is at least a minimum (hotels without a rating are excluded).",
    gold_capabilities: ["hotel_search", "currency_conversion"], gold_tools: { required: ["search_hotels"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("min_rating", "number", "minimum rating")],
    example_inputs: { city: "Mumbai", min_rating: 3.5 },
    c2: { kind: "hotel_usd", tol: 0.5 },
  },
  {
    id: "P10", category: "C2", title: "Air-quality outlook",
    text: "Make an agent that gives the average of the daily mean PM2.5 concentration (ug/m3) for an Indian city over the next N days (max 5).",
    gold_capabilities: ["geocoding", "air_quality"], gold_tools: { required: ["geocode_city", "air_quality"], useful: [] },
    input_schema: [F("city", "string", "Indian city"), F("days", "integer", "1..5")],
    example_inputs: { city: "Delhi", days: 3 },
    c2: { kind: "pm25", tol: 0.5 },
  },
  // ---------------- C3 scheduling ----------------
  {
    id: "P11", category: "C3", title: "Team meeting finder",
    text: "Build an agent that finds a meeting slot of the requested length for a group of colleagues inside a date window, with zero calendar conflicts and inside everyone's local working hours. Slots start on :00 or :30 (UTC). If no slot exists, say infeasible.",
    gold_capabilities: ["calendar_lookup", "person_profile"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: [] },
    input_schema: [F("participants", "array", "usernames"), F("duration_minutes", "integer", "meeting length"), F("window_start", "string", "UTC ISO start of search window"), F("window_end", "string", "UTC ISO end of search window")],
    example_inputs: { participants: ["alice", "bob", "carol"], duration_minutes: 60, window_start: "2026-11-09T00:00Z", window_end: "2026-11-13T23:59Z" },
    c3: { earliest: false, working_hours: true },
  },
  {
    id: "P12", category: "C3", title: "Earliest cross-timezone sync",
    text: "Create an agent that schedules the EARLIEST possible meeting (slots on :00/:30 UTC) for participants spread across time zones: no calendar conflicts, entirely inside every participant's local working hours, within the given window; infeasible if none.",
    gold_capabilities: ["calendar_lookup", "person_profile"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: [] },
    input_schema: [F("participants", "array", "usernames"), F("duration_minutes", "integer", "meeting length"), F("window_start", "string", "UTC ISO"), F("window_end", "string", "UTC ISO")],
    example_inputs: { participants: ["alice", "dave"], duration_minutes: 30, window_start: "2026-11-10T00:00Z", window_end: "2026-11-12T23:59Z" },
    c3: { earliest: true, working_hours: true },
  },
  {
    id: "P13", category: "C3", title: "Holiday-aware planning meeting",
    text: "I need an agent that books the earliest slot (on :00/:30 UTC) of the requested length for a team, with no conflicts, inside everyone's working hours, and never on a United States public holiday (judged by the US Eastern date), because part of the team is in New York.",
    gold_capabilities: ["calendar_lookup", "person_profile", "public_holidays"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: [] },
    input_schema: [F("participants", "array", "usernames"), F("duration_minutes", "integer", "meeting length"), F("window_start", "string", "UTC ISO"), F("window_end", "string", "UTC ISO")],
    example_inputs: { participants: ["erin", "dave"], duration_minutes: 60, window_start: "2026-11-25T00:00Z", window_end: "2026-11-27T23:59Z" },
    c3: { earliest: true, working_hours: true, us_holidays: true },
  },
  {
    id: "P14", category: "C3", title: "Find-and-invite assistant",
    text: "Build an agent that finds the earliest conflict-free slot (on :00/:30 UTC, within working hours and the window) for the participants and sends the calendar invite — but only if the user has confirmed; otherwise just return the proposed slot.",
    gold_capabilities: ["calendar_lookup", "person_profile", "send_invite"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: ["send_invite"] },
    input_schema: [F("participants", "array", "usernames"), F("duration_minutes", "integer", "meeting length"), F("window_start", "string", "UTC ISO"), F("window_end", "string", "UTC ISO"), F("title", "string", "invite title", false)],
    example_inputs: { participants: ["bob", "frank"], duration_minutes: 45, window_start: "2026-11-11T00:00Z", window_end: "2026-11-13T23:59Z", title: "Sync" },
    c3: { earliest: true, working_hours: true, invite: true },
  },
  {
    id: "P15", category: "C3", title: "Lunch-respecting scheduler",
    text: "Make an agent that finds the earliest meeting slot (on :00/:30 UTC) for the group within the window: no calendar conflicts, inside working hours, and never overlapping anyone's local lunch break from 12:30 to 14:00.",
    gold_capabilities: ["calendar_lookup", "person_profile"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: [] },
    input_schema: [F("participants", "array", "usernames"), F("duration_minutes", "integer", "meeting length"), F("window_start", "string", "UTC ISO"), F("window_end", "string", "UTC ISO")],
    example_inputs: { participants: ["alice", "carol", "frank"], duration_minutes: 60, window_start: "2026-11-16T00:00Z", window_end: "2026-11-18T23:59Z" },
    c3: { earliest: true, working_hours: true, lunch: true },
  },
];

// D-Intake extras: 9 clear + 6 ambiguous. gold_tools only for clear ones (D-Retrieval).
export interface IntakeItem { id: string; text: string; ambiguous: boolean; category: string | null; capabilities: string[]; gold_tools?: { required: string[]; useful: string[] } }
export const INTAKE_EXTRA: IntakeItem[] = [
  { id: "X01", ambiguous: false, category: "C4", text: "Give me an agent that lists the three cheapest ways to travel from one city to another on a date across both flights and trains, sorted by price.", capabilities: ["flight_search", "train_search"], gold_tools: { required: ["search_flights", "search_trains"], useful: [] } },
  { id: "X02", ambiguous: false, category: "C4", text: "Agent that compares hotel options across two cities and returns the 5 cheapest overall, sorted ascending.", capabilities: ["hotel_search"], gold_tools: { required: ["search_hotels"], useful: [] } },
  { id: "X03", ambiguous: false, category: "C2", text: "Build an agent that reports how high above sea level a given city is, in metres.", capabilities: ["geocoding", "elevation"], gold_tools: { required: ["geocode_city"], useful: [] } },
  { id: "X04", ambiguous: false, category: "C2", text: "An agent that tells me how many hours of daylight a city gets on a specific date.", capabilities: ["geocoding", "sun_times"], gold_tools: { required: ["geocode_city"], useful: [] } },
  { id: "X05", ambiguous: false, category: "C1", text: "Plan a trip: a flight there and a train back, plus a hotel, all under my budget in rupees.", capabilities: ["flight_search", "train_search", "hotel_search"], gold_tools: { required: ["search_flights", "search_trains", "search_hotels"], useful: [] } },
  { id: "X06", ambiguous: false, category: "C3", text: "Find a 2-hour workshop slot next week for five engineers that avoids everyone's meetings and stays within office hours.", capabilities: ["calendar_lookup", "person_profile"], gold_tools: { required: ["get_calendar", "get_person_profile"], useful: [] } },
  { id: "X07", ambiguous: false, category: "C2", text: "What's the worst air quality index expected in Delhi over the next few days? I want an agent that reports the maximum US AQI.", capabilities: ["geocoding", "air_quality"], gold_tools: { required: ["geocode_city", "air_quality"], useful: [] } },
  { id: "X08", ambiguous: false, category: "C1", text: "Agent that books a hotel within my nightly budget with at least a 4-star rating once I confirm, after showing me the best option.", capabilities: ["hotel_search", "hotel_booking"], gold_tools: { required: ["search_hotels", "book_hotel"], useful: [] } },
  { id: "X09", ambiguous: false, category: "C2", text: "Agent that converts the cost of a 3-night stay at the cheapest hotel in Goa into euros.", capabilities: ["hotel_search", "currency_conversion"], gold_tools: { required: ["search_hotels"], useful: [] } },
  { id: "A01", ambiguous: true, category: null, text: "Make me an agent that helps with my travel stuff.", capabilities: [] },
  { id: "A02", ambiguous: true, category: null, text: "I need something that checks things for the team every week.", capabilities: [] },
  { id: "A03", ambiguous: true, category: null, text: "Build an agent for the weather.", capabilities: [] },
  { id: "A04", ambiguous: true, category: null, text: "An assistant that finds good options under a limit.", capabilities: [] },
  { id: "A05", ambiguous: true, category: null, text: "Agent that sorts out the meeting thing.", capabilities: [] },
  { id: "A06", ambiguous: true, category: null, text: "Can you make a bot that handles prices for me?", capabilities: [] },
];

export const D_INTAKE: IntakeItem[] = [
  ...PILOT.map((p) => ({ id: p.id, text: p.text, ambiguous: false, category: p.category, capabilities: p.gold_capabilities, gold_tools: p.gold_tools })),
  ...INTAKE_EXTRA,
];
export const D_RETRIEVAL = D_INTAKE.filter((x) => !x.ambiguous);

export const specById = (id: string) => PILOT.find((p) => p.id === id);
