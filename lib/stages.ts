// Pipeline stages: spec intake (US-1), tool retrieval (US-2), code generation (US-4), task parsing.
import vm from "vm";
import { CAPABILITIES, TOOLS, ToolMeta, toolCard, Wrapper } from "./tools";
import { complete, cosine, embed, LlmCall, ROUTES, Role } from "./llm";
import { ANSWER_SCHEMAS, CONTRACT_TEXT, contractCheck, ContractReport } from "./contract";
import { InputField } from "./specs";
import { sha } from "./util";
import { apiForCapability } from "./openapi";

export const CAP_DESC: Record<string, string> = {
  geocoding: "resolve place names to coordinates", weather_forecast: "daily temperature/precipitation forecast", air_quality: "PM2.5 / AQI forecast",
  hotel_search: "find hotels and nightly prices", flight_search: "find flights", train_search: "find trains", attraction_search: "tourist attractions and entry fees",
  restaurant_search: "restaurants, cost, veg flag", calendar_lookup: "people's busy times", person_profile: "timezone and working hours of a person",
  hotel_booking: "book a hotel (side effect)", send_invite: "send calendar invites (side effect)", currency_conversion: "convert between currencies",
  public_holidays: "public holiday calendars by country", elevation: "terrain elevation for coordinates", sun_times: "sunrise/sunset/day length",
};
export const CATEGORY_DESC: Record<string, string> = {
  C1: "Constrained planning — choose items (hotels, transport, attractions, restaurants) satisfying hard constraints such as a budget",
  C2: "Lookup + compute — fetch data and compute a single numeric answer with a unit",
  C3: "Scheduling — find a time slot for people that satisfies calendar and time constraints",
  C4: "Multi-source aggregation — combine results from several sources into a sorted/filtered list",
};

// ------------------------------ intake ------------------------------
export interface IntakeResult { task_category: string; required_capabilities: string[]; constraints: string[]; input_fields: InputField[]; confidence: number; clarifying_question: string | null; needs_clarification: boolean; latency_ms: number }
export const CLARIFY_THRESHOLD = 0.6;
export const INTAKE_PROMPT_VERSION = "intake-v2";

export async function intake(text: string, calls: LlmCall[], opts: { noCache?: boolean } = {}): Promise<IntakeResult> {
  const t0 = Date.now();
  const sys = `You are the spec-intake stage of an agent-assembly system. Convert a natural-language AGENT SPEC into a structured intermediate spec.
Categories:\n${Object.entries(CATEGORY_DESC).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
Capability vocabulary (use ONLY these ids):\n${CAPABILITIES.map((c) => `- ${c}: ${CAP_DESC[c]}`).join("\n")}
Return JSON: {"task_category":"C1|C2|C3|C4","required_capabilities":[ids],"constraints":[short strings],"input_fields":[{"name":snake_case,"type":"string|number|integer|boolean|array","description":str,"required":bool}],"confidence":0..1,"clarifying_question":string|null}
If the spec is too vague to know what the agent must do, which data it needs, or what a correct answer looks like, set confidence below ${CLARIFY_THRESHOLD} and ask exactly ONE clarifying question. Otherwise clarifying_question = null and confidence >= 0.8.
Only list capabilities the agent cannot do without (e.g. geocoding is needed before any coordinate-based lookup).`;
  const r = await complete("intake", [{ role: "system", content: sys }, { role: "user", content: `AGENT SPEC:\n${text}` }], { json: true, calls, stage: "intake", noCache: opts.noCache });
  const j = r.json ?? {};
  const caps = (Array.isArray(j.required_capabilities) ? j.required_capabilities : []).filter((c: string) => (CAPABILITIES as readonly string[]).includes(c));
  const conf = typeof j.confidence === "number" ? j.confidence : 0.5;
  const q = typeof j.clarifying_question === "string" && j.clarifying_question.trim() ? j.clarifying_question.trim() : null;
  return {
    task_category: ["C1", "C2", "C3", "C4"].includes(j.task_category) ? j.task_category : "C2",
    required_capabilities: [...new Set<string>(caps)], constraints: Array.isArray(j.constraints) ? j.constraints.map(String).slice(0, 10) : [],
    input_fields: Array.isArray(j.input_fields) ? j.input_fields.filter((f: any) => f && f.name).map((f: any) => ({ name: String(f.name), type: String(f.type ?? "string"), description: String(f.description ?? ""), required: f.required !== false })) : [],
    confidence: conf, clarifying_question: q, needs_clarification: conf < CLARIFY_THRESHOLD, latency_ms: Date.now() - t0,
  };
}

// ------------------------------ retrieval ------------------------------
export interface Ranked { tool: string; similarity: number; rank_sim: number; relevant?: boolean; why?: string }
export interface RetrievalResult { ranked: Ranked[]; ranked_sim_only: string[]; selected: string[]; completed?: string[]; coverage_gaps: string[]; synth_candidates: { capability: string; api_id: string }[]; latency_ms: number; library_version: string }

export const LIBRARY_VERSION = sha(TOOLS.map((t) => t.name + t.description).join("|"), 8);
const toolDoc = (t: ToolMeta) => `${t.name}: ${t.description} Capabilities: ${t.capabilities.map((c) => CAP_DESC[c]).join("; ")}.`;

export async function retrieve(specText: string, intakeRes: Pick<IntakeResult, "required_capabilities" | "constraints">, calls: LlmCall[], opts: { k?: number; rerank?: boolean; noCache?: boolean } = {}): Promise<RetrievalResult> {
  const t0 = Date.now();
  const k = opts.k ?? 8;
  const query = `${specText}\nNeeds: ${intakeRes.required_capabilities.map((c) => CAP_DESC[c] ?? c).join("; ")}`;
  const [qv, ...tv] = await embed([query, ...TOOLS.map(toolDoc)], calls);
  const sims = TOOLS.map((t, i) => ({ tool: t.name, similarity: Math.round(cosine(qv, tv[i]) * 1e4) / 1e4 })).sort((a, b) => b.similarity - a.similarity || a.tool.localeCompare(b.tool));
  const ranked: Ranked[] = sims.map((s, i) => ({ ...s, rank_sim: i + 1 }));
  const ranked_sim_only = ranked.map((r) => r.tool);
  let final = ranked;
  if (opts.rerank !== false) {
    const cands = ranked.slice(0, k);
    const sys = `You re-rank candidate tools for an agent spec. For EVERY candidate decide whether the agent needs it, and give a one-line justification. Tools with side effects (booking, sending) are relevant only if the spec asks for that action. Return JSON {"ranking":[{"tool":name,"relevant":bool,"why":str}]} ordered from most to least useful.`;
    const user = `SPEC: ${specText}\nRequired capabilities: ${intakeRes.required_capabilities.join(", ") || "(none)"}\nCANDIDATES:\n${cands.map((c) => `- ${toolDoc(TOOLS.find((t) => t.name === c.tool)!)}`).join("\n")}`;
    try {
      const r = await complete("rerank", [{ role: "system", content: sys }, { role: "user", content: user }], { json: true, calls, stage: "rerank", noCache: opts.noCache });
      const rk: any[] = Array.isArray(r.json?.ranking) ? r.json.ranking : [];
      const seen = new Set<string>();
      const ordered: Ranked[] = [];
      for (const x of rk.filter((x) => x?.relevant)) { const c = cands.find((c) => c.tool === x.tool); if (c && !seen.has(c.tool)) { seen.add(c.tool); ordered.push({ ...c, relevant: true, why: String(x.why ?? "") }); } }
      for (const c of cands) if (!seen.has(c.tool)) { const x = rk.find((x) => x?.tool === c.tool); seen.add(c.tool); ordered.push({ ...c, relevant: false, why: x ? String(x.why ?? "") : "not judged relevant" }); }
      for (const c of ranked) if (!seen.has(c.tool)) ordered.push({ ...c, relevant: false });
      final = ordered;
    } catch { /* re-rank unavailable: fall back to similarity order */ }
  }
  return { ranked: final, ranked_sim_only, ...selectTools(final, intakeRes.required_capabilities), latency_ms: Date.now() - t0, library_version: LIBRARY_VERSION };
}

// Selection = re-ranker's relevant tools + coverage completion: a required capability that a library
// tool provides is never left uncovered. Capabilities no library tool has go to wrapper synthesis.
export function selectTools(ranked: Ranked[], required: string[]) {
  const sel = ranked.filter((r) => r.relevant).map((r) => r.tool);
  if (!sel.length) sel.push(...ranked.slice(0, 3).map((r) => r.tool));
  const completed: string[] = [];
  const caps = () => new Set(sel.flatMap((n) => TOOLS.find((t) => t.name === n)!.capabilities));
  for (const c of required) {
    if (caps().has(c)) continue;
    const t = ranked.find((r) => TOOLS.find((x) => x.name === r.tool)!.capabilities.includes(c) && TOOLS.find((x) => x.name === r.tool)!.side_effect !== "requires_confirmation");
    if (t) { sel.push(t.tool); completed.push(t.tool); }
  }
  const covered = caps();
  const coverage_gaps = required.filter((c) => !covered.has(c));
  const synth_candidates = coverage_gaps.map((c) => ({ capability: c, api_id: apiForCapability(c)?.id ?? "" })).filter((x) => x.api_id);
  return { selected: sel, completed, coverage_gaps, synth_candidates };
}

// ------------------------------ code generation ------------------------------
export interface Variant { id: string; role: Role; style: "robust" | "concise"; label: string }
export const VARIANTS: Variant[] = [
  { id: "v1", role: "codegen", style: "robust", label: "Groq gpt-oss-120b, robust prompt, T=0.2" },
  { id: "v2", role: "codegen_alt", style: "concise", label: "Gemini 3.5 Flash-Lite, concise prompt, T=0.9" },
  { id: "v3", role: "codegen_fast", style: "robust", label: "fast-tier model (Groq gpt-oss-20b), T=0.6" },
];
export const CODEGEN_PROMPT_VERSION = "codegen-v3";

export interface GenSpec { id: string; text: string; category: string; input_schema: InputField[] }
export interface Agent {
  agent_id: string; spec_id: string; variant: string; category: string; code: string; code_hash: string; tools: string[]; wrappers: Wrapper[];
  model_id: string; provider: string; prompt_version: string; params: any; contract: ContractReport; load_ok: boolean; repairs: number; ok: boolean; error?: string; gen_latency_ms: number; attempts: { ok: boolean; problems: string[] }[];
}

export function extractCode(t: string) {
  const blocks = [...t.matchAll(/```(?:javascript|js)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim();
  return t.trim();
}

export function loadTest(code: string): string | null {
  try { new vm.Script(code + "\n;typeof run;", { filename: "agent.js" }); } catch (e: any) { return "syntax error: " + e.message; }
  return null;
}

export async function generateAgent(spec: GenSpec, toolNames: string[], wrappers: Wrapper[], variant: Variant, calls: LlmCall[], opts: { noCache?: boolean; maxRepairs?: number } = {}): Promise<Agent> {
  const t0 = Date.now();
  const tools = toolNames.map((n) => TOOLS.find((t) => t.name === n)!).filter(Boolean);
  const cards = [...tools.map(toolCard), ...wrappers.map((w) => toolCard(w.tool) + " [synthesized from OpenAPI]")].join("\n");
  const guide = variant.style === "robust"
    ? `Write production-quality, defensive code specific to THIS spec: validate inputs (return needs_clarification for missing/invalid ones), wrap every tool call in try/catch with up to 2 retries for transient errors, handle empty results, coerce and validate tool output fields, and enforce every constraint before returning success.`
    : `Write concise, straightforward code for this spec. Keep it short.`;
  const sys = `You generate the orchestration code of a tool-using agent. Output ONLY one \`\`\`javascript code block.\n\n${CONTRACT_TEXT}`;
  const user = `AGENT SPEC (${spec.category}): ${spec.text}

TASK INPUT SCHEMA (task.inputs):
${spec.input_schema.map((f) => `- ${f.name}: ${f.type}${f.required ? "" : " (optional)"} — ${f.description}`).join("\n")}

ANSWER SCHEMA (AgentResult.answer when status='success'):
${ANSWER_SCHEMAS[spec.category] ?? "{ ... }"}

ATTACHED TOOLS (the only tools you may call):
${cards}

${guide}`;
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: sys }, { role: "user", content: user }];
  const attempts: { ok: boolean; problems: string[] }[] = [];
  const maxRepairs = opts.maxRepairs ?? 2;
  let code = "", contract = contractCheck(""), load_ok = false, lastCall: LlmCall | undefined, err: string | undefined;
  for (let a = 0; a <= maxRepairs; a++) {
    try {
      const r = await complete(variant.role, msgs, { calls, stage: a ? "codegen_repair" : "codegen", noCache: opts.noCache, seed: `${spec.id}-${variant.id}` });
      lastCall = r.call;
      code = extractCode(r.text);
      msgs.push({ role: "assistant", content: "```javascript\n" + code + "\n```" });
    } catch (e: any) { err = e.message; attempts.push({ ok: false, problems: ["LLM: " + e.message] }); break; }
    contract = contractCheck(code);
    const le = loadTest(code);
    load_ok = !le;
    const problems = [...contract.violations, ...(le ? [le] : [])];
    attempts.push({ ok: !problems.length, problems });
    if (!problems.length) break;
    msgs.push({ role: "user", content: `The code failed the static contract check / load test:\n- ${problems.join("\n- ")}\nReturn the full corrected code in one javascript block.` });
  }
  const ok = contract.ok && load_ok;
  const route = lastCall ? { provider: lastCall.provider, model: lastCall.model_id, params: lastCall.params } : { provider: ROUTES[variant.role].primary.provider, model: ROUTES[variant.role].primary.model, params: {} };
  return {
    agent_id: `${spec.id}-${variant.id}`, spec_id: spec.id, variant: variant.id, category: spec.category, code, code_hash: sha(code, 12), tools: toolNames, wrappers,
    model_id: route.model, provider: route.provider, prompt_version: CODEGEN_PROMPT_VERSION, params: route.params, contract, load_ok, repairs: Math.max(0, attempts.length - 1), ok, error: err, gen_latency_ms: Date.now() - t0, attempts,
  };
}

// ------------------------------ task parsing (demo) ------------------------------
export async function parseTask(text: string, schema: InputField[], calls: LlmCall[]) {
  const sys = `Extract structured task inputs from the user's request. Schema:\n${schema.map((f) => `- ${f.name}: ${f.type}${f.required ? "" : " (optional)"} — ${f.description}`).join("\n")}\nToday is ${new Date().toISOString().slice(0, 10)}. Use UTC ISO 'YYYY-MM-DDTHH:mmZ' for datetimes. Omit fields the user did not give (do not invent). Return JSON {"inputs":{...}}.`;
  const r = await complete("task_parse", [{ role: "system", content: sys }, { role: "user", content: text }], { json: true, calls, stage: "task_parse" });
  return (r.json?.inputs ?? {}) as Record<string, any>;
}
