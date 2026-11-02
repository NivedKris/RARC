// Hand-written reference agents (plan Phase 2): checker sanity tests and the sandbox false-kill /
// overhead baseline (M6.5, M6.6).
export const REFERENCE_AGENTS: Record<string, { tools: string[]; code: string }> = {
  P01: {
    tools: ["search_hotels", "list_attractions"],
    code: `async function run(task, tools, context) {
  const i = (task && task.inputs) || {};
  const nights = Number(i.nights), budget = Number(i.budget);
  if (!i.city || !(nights > 0) || !(budget > 0)) return { status: 'needs_clarification', answer: null, success_indicators: { question: 'Please give city, nights and budget.' }, trace: [] };
  const num = (v) => typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : (v == null ? 0 : NaN);
  async function call(n, a) { for (let k = 0; ; k++) { try { return await tools.call(n, a); } catch (e) { if (k >= 2 || !/UPSTREAM|TIMEOUT/.test(String(e.code))) throw e; } } }
  let hotels, attrs;
  try { hotels = await call('search_hotels', { city: i.city, checkin: i.checkin, nights }); attrs = await call('list_attractions', { city: i.city }); }
  catch (e) { return { status: 'failed_gracefully', answer: null, success_indicators: { error: String(e.code || e.message) }, trace: [] }; }
  if (!Array.isArray(hotels) || !Array.isArray(attrs)) return { status: 'failed_gracefully', answer: null, success_indicators: { error: 'unexpected tool output' }, trace: [] };
  const hs = hotels.map((h) => ({ id: h && h.id, cost: num(h && h.price_per_night) * nights })).filter((h) => h.id && isFinite(h.cost) && h.cost > 0).sort((a, b) => a.cost - b.cost);
  const as = attrs.map((a) => ({ id: a && a.id, cost: num(a && a.entry_fee) })).filter((a) => a.id && isFinite(a.cost) && a.cost >= 0).sort((a, b) => a.cost - b.cost);
  if (!hs.length || as.length < 2) return { status: hotels.length || attrs.length ? 'infeasible' : 'failed_gracefully', answer: null, success_indicators: {}, trace: ['not enough options'] };
  const plan = [{ kind: 'hotel', id: hs[0].id, cost: hs[0].cost }, { kind: 'attraction', id: as[0].id, cost: as[0].cost }, { kind: 'attraction', id: as[1].id, cost: as[1].cost }];
  const total = plan.reduce((s, p) => s + p.cost, 0);
  if (total > budget) return { status: 'infeasible', answer: null, success_indicators: { cheapest: total }, trace: [] };
  return { status: 'success', answer: { plan, total_cost: total }, success_indicators: { within_budget: true }, trace: [] };
}`,
  },
  P06: {
    tools: ["geocode_city", "weather_forecast"],
    code: `async function run(task, tools, context) {
  const i = (task && task.inputs) || {};
  const days = Number(i.days);
  if (!i.city || !Number.isInteger(days) || days < 1 || days > 16) return { status: 'needs_clarification', answer: null, success_indicators: { question: 'Which Indian city, and how many days (1-16)?' }, trace: [] };
  async function call(n, a) { for (let k = 0; ; k++) { try { return await tools.call(n, a); } catch (e) { if (k >= 2 || !/UPSTREAM|TIMEOUT/.test(String(e.code))) throw e; } } }
  try {
    const g = await call('geocode_city', { city: String(i.city), country_code: 'IN' });
    if (!Array.isArray(g) || !g.length) return { status: 'needs_clarification', answer: null, success_indicators: { question: 'City not found in India.' }, trace: [] };
    const lat = Number(g[0].latitude), lon = Number(g[0].longitude);
    if (!isFinite(lat) || !isFinite(lon)) return { status: 'failed_gracefully', answer: null, success_indicators: {}, trace: ['bad coordinates'] };
    const w = await call('weather_forecast', { latitude: lat, longitude: lon, days });
    const d = (w && Array.isArray(w.daily) ? w.daily : []).map((x) => Number(x.temp_max_c)).filter((x) => isFinite(x));
    if (!d.length) return { status: 'failed_gracefully', answer: null, success_indicators: {}, trace: ['no forecast'] };
    const c = d.reduce((a, b) => a + b, 0) / d.length;
    return { status: 'success', answer: { value: Math.round((c * 9 / 5 + 32) * 100) / 100, unit: 'F' }, success_indicators: { days_used: d.length }, trace: [] };
  } catch (e) { return { status: 'failed_gracefully', answer: null, success_indicators: { error: String(e.code || e.message) }, trace: [] }; }
}`,
  },
  P11: {
    tools: ["get_calendar", "get_person_profile"],
    code: `async function run(task, tools, context) {
  const i = (task && task.inputs) || {};
  const ps = Array.isArray(i.participants) ? i.participants.map(String) : [];
  const dur = Number(i.duration_minutes);
  const P = (s) => Date.parse(/T\\d\\d:\\d\\dZ$/.test(s) ? s.replace('Z', ':00Z') : s);
  const ws = P(String(i.window_start)), we = P(String(i.window_end));
  if (!ps.length || !(dur > 0) || !isFinite(ws) || !isFinite(we)) return { status: 'needs_clarification', answer: null, success_indicators: { question: 'participants, duration and window are required' }, trace: [] };
  async function call(n, a) { for (let k = 0; ; k++) { try { return await tools.call(n, a); } catch (e) { if (k >= 2 || !/UPSTREAM|TIMEOUT/.test(String(e.code))) throw e; } } }
  const people = [];
  try {
    for (const p of ps) {
      const prof = await call('get_person_profile', { person: p });
      const cal = await call('get_calendar', { person: p, start: i.window_start, end: i.window_end });
      const off = Number(prof.utc_offset_minutes) || 0;
      const busy = (cal && Array.isArray(cal.busy) ? cal.busy : []).map((b) => b.all_day ? [Date.parse(b.start + 'T00:00:00Z') - off * 60000, Date.parse(b.end + 'T00:00:00Z') - off * 60000] : [P(b.start), P(b.end)]).filter((x) => isFinite(x[0]) && isFinite(x[1]));
      people.push({ off, busy });
    }
  } catch (e) {
    if (String(e.code) === 'NOT_FOUND') return { status: 'needs_clarification', answer: null, success_indicators: { question: 'Unknown participant: ' + e.message }, trace: [] };
    return { status: 'failed_gracefully', answer: null, success_indicators: { error: String(e.code || e.message) }, trace: [] };
  }
  const step = 30 * 60000, D = dur * 60000;
  for (let t = Math.ceil(ws / step) * step; t + D <= we; t += step) {
    let ok = true;
    for (const p of people) {
      const ls = new Date(t + p.off * 60000), sm = ls.getUTCHours() * 60 + ls.getUTCMinutes(), dow = ls.getUTCDay();
      if (dow === 0 || dow === 6 || sm < 540 || sm + dur > 1020) { ok = false; break; }
      if (p.busy.some((b) => b[0] < t + D && b[1] > t)) { ok = false; break; }
    }
    if (ok) { const iso = (x) => new Date(x).toISOString().slice(0, 16) + 'Z'; return { status: 'success', answer: { start: iso(t), end: iso(t + D), participants: ps }, success_indicators: {}, trace: [] }; }
  }
  return { status: 'infeasible', answer: null, success_indicators: {}, trace: ['no slot'] };
}`,
  },
};
