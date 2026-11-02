// Records live API responses once, so evaluation runs in replay mode are reproducible (US-15).
import { writeFileSync } from "fs";
import { CITIES } from "../lib/world";

async function get(url: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      return { status: r.status, body: JSON.parse(t) };
    } catch (e) { if (i === 2) return { status: 0, body: { error: String(e) } }; }
  }
}

async function main() {
  const http: Record<string, any> = {};
  const rec = async (url: string) => { http[url] = await get(url); console.log(http[url]?.status, url); };
  for (const c of CITIES) {
    await rec(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.name)}&count=5`);
    await rec(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.name)}&count=5&countryCode=IN`);
  }
  for (const n of ["Atlantis", "Springfield", "Panaji"]) await rec(`https://geocoding-api.open-meteo.com/v1/search?name=${n}&count=5`);
  const geos: Record<string, { lat: number; lon: number }> = {};
  for (const [url, v] of Object.entries(http)) {
    if (!url.includes("countryCode=IN") && !url.includes("Atlantis") && !url.includes("Springfield") && !url.includes("Panaji")) {
      for (const r of v.body.results ?? []) geos[`${r.latitude},${r.longitude}`] = { lat: r.latitude, lon: r.longitude };
    } else for (const r of (v.body.results ?? []).slice(0, 2)) geos[`${r.latitude},${r.longitude}`] = { lat: r.latitude, lon: r.longitude };
  }
  const weather: any[] = [], aq: any[] = [];
  for (const g of Object.values(geos)) {
    const w = await get(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=16`);
    if (w?.status === 200) weather.push({ lat: g.lat, lon: g.lon, daily: w.body.daily });
    const a = await get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.lat}&longitude=${g.lon}&hourly=pm2_5,us_aqi&forecast_days=5&timezone=auto`);
    if (a?.status === 200) aq.push({ lat: g.lat, lon: g.lon, hourly: a.body.hourly });
    console.log("wx", g, w?.status, a?.status);
  }
  for (const u of [
    "https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD",
    "https://api.frankfurter.dev/v1/latest?base=INR&symbols=EUR",
    "https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD,EUR,GBP",
    "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR",
    "https://api.frankfurter.dev/v1/latest?base=INR",
    "https://date.nager.at/api/v3/PublicHolidays/2026/US",
    "https://date.nager.at/api/v3/PublicHolidays/2026/GB",
    "https://date.nager.at/api/v3/PublicHolidays/2026/DE",
    "https://api.sunrise-sunset.org/json?lat=18.52&lng=73.86&date=2026-11-10&formatted=0",
    "https://api.open-meteo.com/v1/elevation?latitude=18.52&longitude=73.86",
  ]) await rec(u);
  writeFileSync(new URL("../data/recordings.json", import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), http, weather, aq }));
}
main();
