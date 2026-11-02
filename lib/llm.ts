// Provider abstraction (plan §3): complete(role, messages, opts). Role-based routing, retry with
// backoff, cross-provider fallback, response cache keyed on (provider, model, prompt_hash, params),
// and full per-call logging. Stage code never calls a provider directly.
import fs from "fs";
import path from "path";
import { sha, sleep, stableStringify } from "./util";

export type Provider = "groq" | "gemini";
export type Role = "intake" | "rerank" | "codegen" | "codegen_alt" | "codegen_fast" | "wrapper" | "testgen" | "judge_for_gemini" | "judge_for_groq" | "task_parse";

export interface Route { provider: Provider; model: string; temperature: number; max_tokens: number; extra?: Record<string, any> }

// Frozen for the evaluation (plan §3.3). Model IDs are recorded on every logged call.
export const ROUTES: Record<Role, { primary: Route; fallback: Route }> = {
  intake: { primary: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0, max_tokens: 1500 }, fallback: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0, max_tokens: 1500 } },
  rerank: { primary: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0, max_tokens: 1500 }, fallback: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0, max_tokens: 1500 } },
  task_parse: { primary: { provider: "groq", model: "openai/gpt-oss-120b", temperature: 0, max_tokens: 1500 }, fallback: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0, max_tokens: 1500 } },
  // gemini-3.5-flash free tier is 20 requests/day: v1 code generation runs on Groq gpt-oss-120b (frozen after the quota hit)
  codegen: { primary: { provider: "groq", model: "openai/gpt-oss-120b", temperature: 0.2, max_tokens: 6000 }, fallback: { provider: "gemini", model: "gemini-2.5-flash", temperature: 0.2, max_tokens: 8000 } },
  codegen_alt: { primary: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0.9, max_tokens: 8000 }, fallback: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0.9, max_tokens: 6000 } },
  codegen_fast: { primary: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0.6, max_tokens: 4500 }, fallback: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0.6, max_tokens: 6000 } },
  wrapper: { primary: { provider: "gemini", model: "gemini-3.5-flash", temperature: 0, max_tokens: 4000 }, fallback: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0, max_tokens: 4000 } },
  testgen: { primary: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0.3, max_tokens: 8000 }, fallback: { provider: "gemini", model: "gemini-2.5-flash", temperature: 0.3, max_tokens: 8000 } },
  judge_for_gemini: { primary: { provider: "groq", model: "openai/gpt-oss-120b", temperature: 0, max_tokens: 3000 }, fallback: { provider: "groq", model: "openai/gpt-oss-20b", temperature: 0, max_tokens: 3000 } },
  judge_for_groq: { primary: { provider: "gemini", model: "gemini-3.5-flash-lite", temperature: 0, max_tokens: 3000 }, fallback: { provider: "gemini", model: "gemini-3.5-flash", temperature: 0, max_tokens: 3000 } },
};

export interface Msg { role: "system" | "user" | "assistant"; content: string }
export interface LlmCall { stage: string; provider: Provider; model_id: string; params: any; prompt_hash: string; tokens_in: number; tokens_out: number; latency_ms: number; cache_hit: boolean; fallback_used: boolean; retries: number; error?: string; ts: string }
export interface CompleteOpts { json?: boolean; seed?: string; temperature?: number; noCache?: boolean; stage?: string; calls?: LlmCall[]; forceProvider?: Provider }

// ------------------------------ cache ------------------------------
const CACHE_FILE = path.join(process.cwd(), "data", "llm-cache.json");
let cache: Record<string, { text: string; tokens_in: number; tokens_out: number; provider: Provider; model: string }> | null = null;
let dirty = false;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
  return cache!;
}
export function flushCache() {
  if (!dirty || process.env.RARC_CACHE_WRITE !== "1") return;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  dirty = false;
}
if (process.env.RARC_CACHE_WRITE === "1") setInterval(flushCache, 10000).unref?.();

// ------------------------------ throttling ------------------------------
const lanes: Record<string, { active: number; queue: (() => void)[]; next: number }> = {};
const LANE_LIMIT: Record<Provider, { conc: number; gapMs: number }> = { groq: { conc: 2, gapMs: 1500 }, gemini: { conc: 4, gapMs: 300 } };
async function acquire(p: Provider, model: string) {
  const k = p + ":" + model;
  const l = (lanes[k] ??= { active: 0, queue: [], next: 0 });
  if (l.active >= LANE_LIMIT[p].conc) await new Promise<void>((r) => l.queue.push(r));
  l.active++;
  const wait = l.next - Date.now();
  l.next = Math.max(Date.now(), l.next) + LANE_LIMIT[p].gapMs;
  if (wait > 0) await sleep(wait);
  return () => { l.active--; l.queue.shift()?.(); };
}

class HttpErr extends Error { constructor(public status: number, msg: string, public retryAfter?: number) { super(msg); } }

async function callGroq(r: Route, messages: Msg[], json: boolean, temperature: number) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new HttpErr(401, "GROQ_API_KEY missing");
  const body: any = { model: r.model, messages, temperature, max_completion_tokens: r.max_tokens };
  if (json) body.response_format = { type: "json_object" };
  if (r.model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
  if (r.model.startsWith("qwen/")) body.reasoning_effort = "none";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const t = await res.text();
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    // some models reject reasoning_effort=none; retry once without it
    if (res.status === 400 && /reasoning_effort/.test(t) && body.reasoning_effort) { delete body.reasoning_effort; const r2 = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); const t2 = await r2.text(); if (r2.ok) { const d2 = JSON.parse(t2); return { text: d2.choices[0].message.content ?? "", tokens_in: d2.usage?.prompt_tokens ?? 0, tokens_out: d2.usage?.completion_tokens ?? 0 }; } }
    throw new HttpErr(res.status, t.slice(0, 300), isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  const d = JSON.parse(t);
  return { text: d.choices?.[0]?.message?.content ?? "", tokens_in: d.usage?.prompt_tokens ?? 0, tokens_out: d.usage?.completion_tokens ?? 0 };
}

async function callGemini(r: Route, messages: Msg[], json: boolean, temperature: number) {
  const key = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!key) throw new HttpErr(401, "GOOGLE_AI_STUDIO_API_KEY missing");
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  // Gemini 3.x accepts thinkingLevel; 2.5 models reject it (HTTP 400) and take thinkingBudget instead
  const generationConfig: any = { temperature, maxOutputTokens: r.max_tokens, thinkingConfig: /^gemini-2\./.test(r.model) ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" } };
  if (json) generationConfig.responseMimeType = "application/json";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${r.model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: sys ? { parts: [{ text: sys }] } : undefined, contents, generationConfig }), signal: AbortSignal.timeout(120000) });
  const t = await res.text();
  if (!res.ok) throw new HttpErr(res.status, t.slice(0, 300));
  const d = JSON.parse(t);
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
  if (!text) throw new HttpErr(502, "empty completion: " + (d.candidates?.[0]?.finishReason ?? JSON.stringify(d).slice(0, 200)));
  return { text, tokens_in: d.usageMetadata?.promptTokenCount ?? 0, tokens_out: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0) };
}

async function callRoute(r: Route, messages: Msg[], json: boolean, temperature: number) {
  return r.provider === "groq" ? callGroq(r, messages, json, temperature) : callGemini(r, messages, json, temperature);
}

export interface Completion { text: string; json?: any; call: LlmCall }

export async function complete(role: Role, messages: Msg[], o: CompleteOpts = {}): Promise<Completion> {
  const routes = ROUTES[role];
  const order = o.forceProvider ? [routes.primary.provider === o.forceProvider ? routes.primary : routes.fallback] : [routes.primary, routes.fallback];
  let lastErr: any;
  for (let ri = 0; ri < order.length; ri++) {
    const r = order[ri];
    const temperature = o.temperature ?? r.temperature;
    const params = { temperature, max_tokens: r.max_tokens, json: !!o.json, seed: o.seed ?? null };
    const prompt_hash = sha(stableStringify(messages));
    const key = sha(stableStringify({ p: r.provider, m: r.model, prompt_hash, params }), 32);
    const base = { stage: o.stage ?? role, provider: r.provider, model_id: r.model, params, prompt_hash, fallback_used: ri > 0, ts: new Date().toISOString() };
    const c = loadCache();
    if (!o.noCache && c[key]) {
      const hit = c[key];
      const call: LlmCall = { ...base, tokens_in: hit.tokens_in, tokens_out: hit.tokens_out, latency_ms: 0, cache_hit: true, retries: 0 };
      o.calls?.push(call);
      return { text: hit.text, json: o.json ? parseJsonLoose(hit.text) : undefined, call };
    }
    let retries = 0;
    const t0 = Date.now();
    for (let attempt = 0; attempt < 4; attempt++) {
      const release = await acquire(r.provider, r.model);
      try {
        const out = await callRoute(r, messages, !!o.json, temperature);
        const parsed = o.json ? parseJsonLoose(out.text) : undefined;
        if (o.json && parsed === undefined) throw new HttpErr(422, "invalid JSON from model");
        c[key] = { text: out.text, tokens_in: out.tokens_in, tokens_out: out.tokens_out, provider: r.provider, model: r.model };
        dirty = true;
        const call: LlmCall = { ...base, tokens_in: out.tokens_in, tokens_out: out.tokens_out, latency_ms: Date.now() - t0, cache_hit: false, retries };
        o.calls?.push(call);
        return { text: out.text, json: parsed, call };
      } catch (e: any) {
        lastErr = e;
        retries++;
        const st = e instanceof HttpErr ? e.status : 0;
        const transient = st === 429 || st >= 500 || st === 0 || st === 422;
        if (!transient || attempt === 3) break;
        await sleep(e.retryAfter ?? Math.min(20000, 1500 * 2 ** attempt + Math.random() * 500));
      } finally { release(); }
    }
    o.calls?.push({ ...base, tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - t0, cache_hit: false, retries, error: String(lastErr?.message ?? lastErr).slice(0, 200) });
  }
  throw new Error(`LLM ${role} failed on all providers: ${String(lastErr?.message ?? lastErr).slice(0, 300)}`);
}

export function parseJsonLoose(t: string): any {
  try { return JSON.parse(t); } catch {}
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return undefined;
}

// ------------------------------ embeddings ------------------------------
const EMB_FILE = path.join(process.cwd(), "data", "embeddings.json");
let embCache: Record<string, number[]> | null = null;
export const EMBED_MODEL = "gemini-embedding-001";
export async function embed(texts: string[], calls?: LlmCall[]): Promise<number[][]> {
  if (!embCache) { try { embCache = JSON.parse(fs.readFileSync(EMB_FILE, "utf8")); } catch { embCache = {}; } }
  const out: number[][] = [];
  const missing: string[] = [];
  for (const t of texts) if (!embCache![sha(t, 24)]) missing.push(t);
  if (missing.length) {
    const key = process.env.GOOGLE_AI_STUDIO_API_KEY;
    const t0 = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: missing.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: 256, taskType: "SEMANTIC_SIMILARITY" })) }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error("embedding failed: " + (await res.text()).slice(0, 200));
    const d = await res.json();
    d.embeddings.forEach((e: any, i: number) => (embCache![sha(missing[i], 24)] = e.values.map((x: number) => Math.round(x * 1e5) / 1e5)));
    calls?.push({ stage: "retrieval_embed", provider: "gemini", model_id: EMBED_MODEL, params: { dim: 256 }, prompt_hash: sha(missing.join("\n")), tokens_in: missing.join(" ").length / 4, tokens_out: 0, latency_ms: Date.now() - t0, cache_hit: false, fallback_used: false, retries: 0, ts: new Date().toISOString() });
    if (process.env.RARC_CACHE_WRITE === "1") fs.writeFileSync(EMB_FILE, JSON.stringify(embCache));
  } else calls?.push({ stage: "retrieval_embed", provider: "gemini", model_id: EMBED_MODEL, params: { dim: 256 }, prompt_hash: sha(texts.join("\n")), tokens_in: 0, tokens_out: 0, latency_ms: 0, cache_hit: true, fallback_used: false, retries: 0, ts: new Date().toISOString() });
  for (const t of texts) out.push(embCache![sha(t, 24)]);
  return out;
}

export function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}
