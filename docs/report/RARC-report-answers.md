# RARC: Answers for the BTP-I Report

Status as of **2 Nov 2026**. Every number below comes from logged data. Unless stated otherwise, the source is
`public/results.json`, which `scripts/analyze.ts` regenerates from `eval/out/*.json`, the logged runs of the final
evaluation (`eval/log-main3.txt`). Raw CSVs behind each table are in `docs/report/csv/` and figures in `docs/report/figures/`.
All paths are relative to `app/`.

**Read this first: an important correction.** An earlier full run (`eval/log-main2.txt`) reported that RARC
significantly beats generic tests (ΔAUROC +0.145). That result was an **artifact**. Provider quota errors left 4 specs
with incomplete RARC tests and 3 specs with *zero* generic tests, and empty certificates score 0. The final run
(`eval/log-main3.txt`) regenerates the missing tests with an equal, fixed budget (24 tests per method per spec, 100%
taxonomy coverage). In the final run, **RARC vs. generic is inconclusive** (ΔAUROC +0.014, 95% CI [−0.036, 0.073]).
Only the final run is reported below. The superseded run is kept in `eval/out/*.v1-incomplete.json`.

---

## A. Overall Status

### A1. Component status

| Component | Status | What works | Path |
|---|---|---|---|
| Spec intake (NL → structured spec) | Done | LLM maps a spec to `{task_category, required_capabilities[], constraints[], input_fields[], confidence, clarifying_question}` over a fixed 16-capability vocabulary | `lib/stages.ts` (`intake`), `app/api/intake/route.ts` |
| Clarifying-question logic | Done | confidence < 0.6 → one clarifying question; UI lets the user edit the spec or proceed | `lib/stages.ts` (`CLARIFY_THRESHOLD`), `components/Demo.tsx` |
| MCP tool library + metadata store | **Partial** | 12 tools with JSON-schema-style inputs, output shape, side-effect class, capabilities, endpoints. Tools are **in-process TypeScript functions with MCP-style metadata, not MCP servers** (no MCP protocol transport) | `lib/tools.ts` (`TOOLS`), `lib/world.ts` |
| Tool response record/replay | Done | Live API responses recorded once (`scripts/record.ts`) and replayed in eval; record-on-first-use for unrecorded URLs during eval | `lib/tools.ts` (`httpJson`), `data/recordings.json` |
| Retrieval (similarity + LLM re-rank) | Done | Gemini embeddings → cosine top-8 → LLM re-rank with one-line "why" → coverage completion → gaps sent to synthesis | `lib/stages.ts` (`retrieve`, `selectTools`) |
| OpenAPI → MCP wrapper synthesis | Done (declarative wrappers) | LLM writes `{base_url, path_template, query, transform}`; transform runs in the sandbox; validation gate = example call to an allow-listed host + output validator; ≤ 2 repairs | `lib/openapi.ts` |
| Orchestration code generation | Done | JS agent against a fixed contract; static contract check + load test; ≤ 2 repairs; versioned by code hash | `lib/stages.ts` (`generateAgent`), `lib/contract.ts` |
| Sandboxed execution | Done | Fresh QuickJS WebAssembly VM per run inside a disposable worker thread, hard-killed at the deadline; tool client is the only bridge | `lib/sandbox.ts` |
| Failure → error-code mapping | Done | 8 codes; 16/16 on the fault-injection suite | `lib/sandbox.ts` (`mapError`, `ERROR_CODES`) |
| Live execution trace / UI | Done | Streaming (NDJSON) per-tool-call trace, checker result, flagging | `app/api/execute/route.ts`, `components/Demo.tsx` |
| Failure taxonomy | Done (v0) | T1–T8 as in the plan; **not yet refined to v1** from observed failures | `lib/runtime.ts` (`TAXONOMY`) |
| Adversarial test generator | Done | 3 tests per category per spec (24), fault injection, checkable property menu, validity + duplicate filtering, leakage audit | `lib/runtime.ts` (`generateRarcTests`) |
| Certification scoring + report | Done | Uniform-weight mean of per-category pass rates; weakest-3 in plain language; basis label | `lib/runtime.ts` (`scoreCertificate`) |
| Baselines: none / generic / random | Done | All four methods, same agents/tasks/sandbox, equal 24-test budget | `lib/runtime.ts`, `scripts/analyze.ts` (none) |
| Logging store | **Partial** | Every run and every LLM call logged as JSON records in `eval/out/*.json`; demo-session runs in browser `localStorage`. **No database (no Postgres)** | `scripts/eval.ts`, `components/Data.tsx` |
| Evaluation harness / metric scripts | Done | 9 checkpointed phases; all §6 metrics except M9.3/M9.4 and M11.x | `scripts/eval.ts`, `scripts/analyze.ts`, `lib/metrics.ts` |
| Reproduction script | Done | Recomputes all tables twice and compares hashes (identical) | `scripts/analyze.ts` |
| LLM provider layer (routing, fallback, cache) | Done | Role routing, retry with backoff, cross-provider fallback, response cache, per-call logging | `lib/llm.ts` |

### A2. Sprint and gates

This is a compressed prototype. It covers the scope of Sprints 0–5 at the minimum gate sizes, built in a single session.
**No formal gate review has been held.** Against the gate criteria, using measured values:

| Gate | Criterion | Measured | Verdict |
|---|---|---|---|
| 0 | Provider layer + logging verified; checkers pass on examples | Every LLM call logged with all fields; reference agents pass 90/90 checker runs (`eval/out/sandbox.json` → `refRuns`) | Met |
| 1 | M2.1 ≥ 90%, M2.5 = 1.0, M3.1 = 2/2 | M2.1 = **0.875**; M2.5 = 1.0 with cache, 0.991 cache disabled; M3.1 = 4/4 | **Not met** (M2.1) |
| 2 | Every task has a checker; split hashed; taxonomy v0 with examples | 150/150 tasks with checker; split hash `2d19cad5917e61cf`; taxonomy v0 with one example per category | Met |
| 3 | M4.1–M4.3, M6.1–M6.4, M10.1 | All computed; M6.2 = **30/31** (one class not 100%) | Computed; M6.2 not at 100% |
| 4 | M8.1 = 100%, M8.2, M9.1–M9.3, pilot M7.3 on dev | M8.1 = 100%, M8.2 = 100% / 99.7%, M9.1 = 85.5%; **M9.3 not measured**; dev-split pilot M7.3 not computed separately | Partial |
| 5 | All of §6 on held-out with CIs; T1–T8 | All of §6 except M9.3, M9.4, M11.x (QA) | Partial |
| 6 | M10.2 within demo bound; standalone run from README | README exists; no demo bound agreed; no third-party run; not deployed | Partial |
| 7 | M12.1 identical; M12.2 = 100% | M12.1 identical (hash `ddb7227c30090cbd`); M12.2 depends on the report text | Partial |

### A3. Deviations from the plan

| # | Plan | As built | Why |
|---|---|---|---|
| 1 | 8–10 MCP tools from MCP servers | 12 in-process tools with MCP-style metadata; 3 wrap live public APIs (Open-Meteo geocoding, forecast, air quality), 9 are simulated providers (hotels, flights, trains, attractions, restaurants, calendars, profiles, booking, invites) | No keyless live APIs exist for prices or calendars. Simulated data is deterministic and has deliberate real-world quirks |
| 2 | OpenAPI → MCP wrapper (server) | Declarative wrapper `{base_url, path_template, query, transform}` executed by the tool client | Same validation semantics, much smaller surface |
| 3 | Postgres-style logging store | JSON files (`eval/out/*.json`) + browser `localStorage` | Serverless deployment target, single-session build |
| 4 | Test generation per (agent, category) | Per (spec, category), shared by that spec's 3 variants | Comparable variant scores; free-tier quotas |
| 5 | Code-gen on Google AI Studio | v1: Gemini 3.5 Flash ×10, Groq gpt-oss-120b ×5 (fallback after the 20 req/day Gemini free-tier quota ran out); v3: gpt-oss-20b ×11, Gemini Flash-Lite ×4 (fallback after Groq rate limits) | Provider quotas. The fallback layer logged every switch |
| 6 | RARC test generation on Groq | Gemini 3.5 Flash-Lite for both RARC and generic tests (same model, so the comparison stays fair) | Groq allows 8k tokens/min per model |
| 7 | Property menu v0 | Added `succeeds` (property menu v1) | A v0 pilot showed vacuous passing: an agent that always answered "infeasible" scored 0.88 |
| 8 | 30-spec paper target | 15 specs × 3 variants (gate minimum) | Time / quota |
| 9 | Taxonomy refined to v1 | Still v0 | Not yet done |
| 10 | Human annotation (gold labels, κ) | Gold labels by one annotator (the build agent), written before retrieval ran; no κ | No second annotator yet |
| 11 | `none` baseline reported as ρ = 0, AUROC = 0.5 | Reported with its actual values | More informative; noted in UI |
| 12 | Coverage logic | Added "coverage completion": a required capability that a library tool provides is always attached, even if the re-ranker dropped it | Re-ranker dropped `geocode_city` for P06 although intake required geocoding |

**Build log.** There is no hand-written build log file. Run logs:
- `eval/log-abc.txt`: intake, retrieval, wrapper synthesis.
- `eval/log-main.txt`: first assembly + v0-property certification. Aborted when v0 vacuous passing was found.
- `eval/log-main2.txt`: v1 properties. Superseded because quota failures left test sets incomplete.
- `eval/log-main3.txt`: final run with complete tests. Reported.

---

## B. Environment & Implementation Stack

### B1. Stack (versions read from `node_modules/*/package.json`)

| Item | Value |
|---|---|
| Language | TypeScript 5.9.3 on Node.js 22.22.1 |
| Web framework (UI + API) | Next.js 16.4.3 (App Router, route handlers), React 19.3.0, Tailwind CSS 4.3.3 |
| Sandbox | quickjs-emscripten 0.32.0 (QuickJS compiled to WebAssembly, `RELEASE_SYNC` variant), one VM per run inside a Node `worker_threads` worker |
| Script runner | tsx 4.23.15 |
| Storage / logging | JSON files (`eval/out/`), `data/llm-cache.json` (response cache), browser `localStorage` (demo session). No database |
| Embedding model | Google `gemini-embedding-001`, 256 dimensions, `taskType: SEMANTIC_SIMILARITY` |
| UI | Next.js + React, custom SVG charts (no chart library) |

### B2. LLMs used per stage, counted from the logged calls of the final run

| Stage | Provider / model (successful calls) | Temperature | max tokens |
|---|---|---|---|
| Intake | Groq `openai/gpt-oss-20b` ×27; fallback Gemini `gemini-3.5-flash-lite` ×3 | 0 | 1500 |
| Retrieval re-rank | Groq `openai/gpt-oss-20b` ×61; fallback `gemini-3.5-flash-lite` ×11 | 0 | 1500 |
| Retrieval embedding | Gemini `gemini-embedding-001` | n/a | n/a |
| Wrapper synthesis | Gemini `gemini-3.5-flash` ×4 | 0 | 4000 |
| Code-gen v1 (robust prompt) | `gemini-3.5-flash` ×11; fallback Groq `openai/gpt-oss-120b` ×4 (+1 repair) | 0.2 | 8000 / 6000 |
| Code-gen v2 (concise prompt) | `gemini-3.5-flash-lite` ×15 (+4 repairs) | 0.9 | 8000 |
| Code-gen v3 (fast tier) | Groq `openai/gpt-oss-20b` ×10 (+1 repair); fallback `gemini-3.5-flash-lite` ×5 | 0.6 | 4500 / 6000 |
| RARC test generation | `gemini-3.5-flash-lite` ×30 | 0.3 | 8000 |
| Generic test generation | `gemini-3.5-flash-lite` ×15 (same model as RARC) | 0.3 | 8000 |
| Failure tagging (judge) | `openai/gpt-oss-120b` ×5 for Gemini-built agents; `gemini-3.5-flash-lite` ×4 for Groq-built agents | 0 | 3000 |

Other parameters: Groq gpt-oss `reasoning_effort: "low"`. Gemini 3.x `thinkingLevel: "minimal"`; Gemini 2.5 `thinkingBudget: 0`.
JSON mode is used for structured stages.

- **Retry:** up to 4 attempts with exponential backoff, honouring `retry-after`.
- **Fallback:** across providers, logged as `fallback_used`.
- **Cache:** keyed on (provider, model, prompt hash, params) in `data/llm-cache.json`. All three are implemented in `lib/llm.ts`.
- Source of the counts: per-call logs in `eval/out/{intake,retrieval,wrappers,agents,tests,tags}.json`.

### B3. Machine

All development and experiments ran locally:
- Ubuntu 24.04.4 LTS (Linux 7.0.0-38-generic)
- 11th Gen Intel Core i5-1135G7 @ 2.40 GHz, 8 logical CPUs, 15 GB RAM
- Node 22.22.1

Not yet deployed (Vercel is planned). Source: `lscpu`, `free -g`, `lsb_release`.

---

## C. Task Categories & Spec Intake

### C1. Pilot categories and checkers (C4 is defined but not in the pilot)

All checkers are programmatic, in `lib/checkers.ts` (`checkTask`).

**Ground truth.** Ground truth comes from reference solvers over the same recorded tool data (`computeTruth`). Each task's
expected status is one of:
- `success`
- `infeasible`: no valid plan exists. The agent must answer `infeasible`.
- `invalid_input`: the agent must answer one of `needs_clarification | failed_gracefully | infeasible`.

**Success criterion when success is expected** (every check must pass):

- **C1 Constrained planning** (P01–P05). Answer `{plan[{kind,id,cost}], total_cost}`. Checks:
  - items exist in provider data
  - no duplicates
  - each item cost matches provider data (hotel = price × nights)
  - city / route / date match
  - veg / rating constraints hold
  - exact required counts per kind
  - `total_cost` = sum of items (±1)
  - total ≤ budget

  Partial score = fraction of checks passed.
- **C2 Lookup + compute** (P06–P10). Answer `{value, unit}`. Checks: the unit matches the requested unit, and
  |value − truth| ≤ a spec tolerance (0.5 °F, 0.3 °C, 0.2 mm/in, 0.5 USD, 0.5 µg/m³). Truth is computed from recorded
  Open-Meteo / Frankfurter responses, using geocoding with `countryCode=IN`.
- **C3 Scheduling** (P11–P15). Answer `{start, end, participants}`. Checks:
  - valid datetimes
  - exact duration
  - inside the window
  - exact participant set
  - zero calendar conflicts, including all-day entries
  - inside every participant's local working hours (09:00–17:00, Mon–Fri)
  - spec-specific: no lunch overlap (12:30–14:00 local) for P15; not on a US public holiday (US-Eastern date) for P13
  - earliest feasible :00/:30 slot (P12–P15)

### C2. Real example (from `eval/out/intake.json`, id P01, model `openai/gpt-oss-20b`)

Input spec:
> Build an agent that plans a short city break: pick one hotel for the given number of nights plus two different attractions in that city, keeping the total cost (hotel nights + entry fees) within the user's budget in INR. If nothing fits the budget, say it is infeasible.

Output:
```json
{
 "task_category": "C1",
 "required_capabilities": ["geocoding", "hotel_search", "attraction_search", "currency_conversion"],
 "constraints": ["budget_inr", "nights", "city"],
 "input_fields": [
  {"name": "city", "type": "string", "description": "Name of the city for the break", "required": true},
  {"name": "nights", "type": "integer", "description": "Number of nights to stay", "required": true},
  {"name": "budget_inr", "type": "integer", "description": "Maximum total cost in Indian Rupees (INR) for hotel nights plus attraction entry fees", "required": true}
 ],
 "confidence": 0.9,
 "clarifying_question": null,
 "needs_clarification": false,
 "latency_ms": 1161
}
```
The category is correct. Two capabilities are over-extracted: `geocoding`, and `currency_conversion` (triggered by
"INR"). Over-extraction like this is what keeps M1.2 below 1.

### C3. Low-confidence detection

The intake LLM returns a `confidence` value. When `confidence < 0.6` (`CLARIFY_THRESHOLD` in `lib/stages.ts`), the system
returns one clarifying question instead of guessing. The threshold was **set by hand, not tuned on a dev set.** Examples
from `eval/out/intake.json`:
- A01 "Make me an agent that helps with my travel stuff." → confidence 0.4 → *"What specific travel tasks would you like the agent to help with (e.g., booking flights, finding hotels, planning itineraries, etc.)?"*
- A03 "Build an agent for the weather." → 0.4 → *"Do you want the forecast for a specific date or for the current day, and should the location be specified by name or coordinates?"*

### C4. Intake numbers (D-Intake: 30 specs, 6 ambiguous; source `results.json → M1`, CSV `csv/intake_per_spec.csv`)

| Metric | Value |
|---|---|
| M1.1 category accuracy (24 clear specs) | 1.000 |
| M1.2 capability micro-F1 (24 clear specs) | 0.875 |
| M1.3 clarification precision / recall (positive = asked a question) | 0.857 / 1.000 |
| M1.4 latency p50 / p95 (uncached calls) | 3.14 s / 12.03 s |

The p95 exceeds the 5 s target; it is inflated by Groq rate-limit retries.

---

## D. Tool Library

### D1. Integrated tools

Source: `lib/tools.ts`, CSV via the UI's Tool library tab or `GET /api/tools`.

| Tool | Source | Description | Side effect | Endpoint domain |
|---|---|---|---|---|
| geocode_city | live API (recorded) | City name → coordinates (≤ 5 matches; optional country filter) | read-only | geocoding-api.open-meteo.com |
| weather_forecast | live API (recorded) | Daily max/min °C and precipitation, ≤ 16 days | read-only | api.open-meteo.com |
| air_quality | live API (recorded) | Daily mean PM2.5 and max US AQI, ≤ 5 days | read-only | air-quality-api.open-meteo.com |
| search_hotels | simulated | Hotels by city, INR per night (some string prices, some missing ratings; Jaipur 503 on first call) | read-only | hotels.sim.rarc |
| search_flights | simulated | One-way flights by route/date | read-only | flights.sim.rarc |
| search_trains | simulated | Trains by route/date | read-only | trains.sim.rarc |
| list_attractions | simulated | Attractions with entry fee (null = free) | read-only | attractions.sim.rarc |
| search_restaurants | simulated | Restaurants, cost for two, veg flag | read-only | restaurants.sim.rarc |
| get_calendar | simulated | Busy intervals (UTC); all-day entries as dates | read-only | calendar.sim.rarc |
| get_person_profile | simulated | Timezone, UTC offset, working hours | read-only | directory.sim.rarc |
| book_hotel | simulated | Books a hotel | requires_confirmation | hotels.sim.rarc |
| send_invite | simulated | Sends a calendar invite | requires_confirmation | calendar.sim.rarc |

No tool is in the `reversible` class.

### D2. Metadata per tool

The `ToolMeta` interface in `lib/tools.ts` stores:
- `name`, `description`, `capabilities[]`
- `input {properties: {type, description, enum?, items?}, required[]}`
- `output` (shape string), `side_effect`, `endpoints[]`, `source` (`live_api | simulated | synthesized`)
- `emptyShape` (how an empty result looks, used by fault injection)

Embeddings are computed from `name + description + capability descriptions` and cached in `data/embeddings.json`.

### D3. OpenAPI wrapper synthesis

Source: `results.json → M3`, CSV `csv/wrapper_synthesis.csv`.

| API | Target tool | Passed validation call | Repairs |
|---|---|---|---|
| Frankfurter (ECB rates) | convert_currency | Yes | 0 |
| Nager.Date | public_holidays | Yes | 0 |
| Open-Meteo Elevation | get_elevation | Yes | 0 |
| Sunrise-Sunset | sun_times | Yes | 0 |

- **M3.1 validity:** 4/4.
- **M3.2 endpoint coverage:** 1.0. Each API has one target endpoint in this design; the other endpoints in each OpenAPI document were not wrapped.
- **M3.4 success of tasks that use a synthesized tool:** 0.730, over n = 63 held-out runs (P09 uses `convert_currency`, P13 uses `public_holidays`).

---

## E. Retrieval

### E1. Method

- **Stage 1:** cosine similarity between `gemini-embedding-001` embeddings (256-d) of the spec text plus intake capabilities, and each tool document. The top **8** go to re-rank.
- **Stage 2:** LLM re-rank, Groq `openai/gpt-oss-20b`, T = 0. Selected tools = those judged relevant, plus coverage completion (A3 #12).
- **Metrics:** computed at k = 3 and 5.

Re-rank system prompt (verbatim, `lib/stages.ts`):
> You re-rank candidate tools for an agent spec. For EVERY candidate decide whether the agent needs it, and give a one-line justification. Tools with side effects (booking, sending) are relevant only if the spec asks for that action. Return JSON {"ranking":[{"tool":name,"relevant":bool,"why":str}]} ordered from most to least useful.

User message: `SPEC: …`, `Required capabilities: …`, `CANDIDATES:` followed by one tool document per line.

### E2. Test set

- **D-Retrieval:** 24 specs (15 pilot + 9 extra; the 6 ambiguous intake specs are excluded).
- **Gold labels:** written by **one annotator** (the build agent) in `lib/specs.ts`, before retrieval was run. Gold required tools are drawn from the library only (synthesized tools are excluded).
- **Agreement:** not measured.

### E3. Results

Source: `results.json → M2`, CSVs `csv/retrieval_metrics.csv`, `csv/retrieval_per_spec.csv`.

| Metric | Similarity + re-rank | Similarity only |
|---|---|---|
| Hit-rate@5 (M2.1) | 0.875 | 0.792 |
| P@3 / R@3 | 0.569 / 0.889 | 0.556 / 0.854 |
| P@5 / R@5 | 0.358 / 0.917 | 0.342 / 0.875 |
| MRR | 0.879 | 0.963 |
| nDCG@5 (graded: required = 2, useful = 1) | 0.871 | 0.882 |

- **Re-rank lift (ΔnDCG@5):** −0.011. Re-ranking improves hit-rate but slightly lowers MRR and nDCG.
- **Reproducibility (mean Jaccard of selected tool sets over 3 runs):** 1.0 with the response cache (the system as deployed). With the cache disabled at T = 0 it is **0.991**.

---

## F. Orchestration Code Generation

### F1. Interface contract

Verbatim from `lib/contract.ts`; this text is given to the generator.
```
INTERFACE CONTRACT (mandatory)
- Define exactly one entry point:  async function run(task, tools, context) { ... }  returning an AgentResult.
- task = { text: string, inputs: object }  (inputs follow the task input schema)
- tools.call(name, args) -> Promise<data>. It throws an Error with name === 'ToolError' and a .code (e.g. 'UPSTREAM_503', 'TIMEOUT', 'NOT_FOUND', 'INVALID_ARGS', 'UNKNOWN_TOOL') when a tool fails.
- context = { now: 'YYYY-MM-DD' (today), confirmed: boolean (user confirmed side effects), run_id: string }
- AgentResult = { status: 'success'|'failed_gracefully'|'infeasible'|'needs_clarification', answer: <answer schema> | null, success_indicators: object, trace: string[] /* short notes */ }
  * 'success' => answer MUST match the answer schema exactly.
  * 'infeasible' => the request is well-formed but no solution satisfies the constraints.
  * 'needs_clarification' => required inputs are missing/invalid; put the question in success_indicators.question.
  * 'failed_gracefully' => tools failed or returned unusable data and you could not recover.
- Tools are the ONLY way to reach the outside world. Do NOT use fetch, require, import, process, eval, Function, globalThis, setTimeout or any I/O.
- Never call a tool marked requires_confirmation unless context.confirmed === true.
- Required handlers: tool-call failure (try/catch around tools.call; retry transient errors at most 2 times), empty results, and schema-invalid tool output (validate fields and types; coerce numeric strings like "4,500").
- Plain JavaScript (ES2020), no TypeScript, no external libraries. Keep total tool calls small (< 30).
```
Answer schemas per category (`ANSWER_SCHEMAS`):
- **C1** `{ plan: Array<{kind, id, cost}>, total_cost }`
- **C2** `{ value: number, unit: string }`
- **C3** `{ start, end, participants[] }`
- **C4** `{ items: Array<{id, price, source}> }`

`validateAgentResult` enforces the status enum and the answer schema on success. A violation maps to `E_MALFORMED_OUTPUT`.

### F2. Generation loop

**Prompt** (`lib/stages.ts`, prompt version `codegen-v3`):
- **System:** "You generate the orchestration code of a tool-using agent. Output ONLY one ```javascript code block." followed by `CONTRACT_TEXT`.
- **User:** agent spec and category; task input schema; answer schema; tool cards (signature, output shape, description, side effect; synthesized tools marked); style guide.
- **Style guide, robust** (v1, v3): "Write production-quality, defensive code specific to THIS spec: validate inputs …, wrap every tool call in try/catch with up to 2 retries …, handle empty results, coerce and validate tool output fields, and enforce every constraint before returning success."
- **Style guide, concise** (v2): "Write concise, straightforward code for this spec. Keep it short."

**Static contract check** (`contractCheck`, run after comments are stripped):
- Forbidden: `require(`, `import`, `process.`, `eval(`, `Function(`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `globalThis`, `window.`, `setTimeout` / `setInterval`, `WebAssembly`, and `__host_*` identifiers.
- Required: an `async function run(a, b, c)` entry point.
- Also recorded: `has_try_catch`, `has_empty_check`.

**Load test:** compile in `vm.Script` (no execution).

**Repairs:** at most **2** rounds. The violations are fed back to the model.

**Versioning:** each agent stores:
- `agent_id = <spec>-<variant>`
- `code_hash` (SHA-256, first 12 hex chars)
- `model_id`, `provider`, `prompt_version`, `params`
- `tools`, `wrappers`, `attempts`

### F3. Numbers

45 agents = 15 specs × 3 variants. Source: `results.json → M4`, CSV `csv/codegen_agents.csv`.

| Metric | Value |
|---|---|
| M4.1 contract conformance (final / first attempt) | 0.956 (43/45) / 0.911 |
| M4.2 load success | 1.000 |
| M4.3 specs completing ≥ 1 nominal task without crashing | 15/15 |
| M4.4 pass@1 / pass@3 (first non-hard held-out task) | 0.756 / 0.867 |
| M4.5 error-handling presence (static try/catch + empty check, and passes ≥ 1 T2 and ≥ 1 T3 test) | 0.884 (of the 43 conformant agents) |
| M4.6 generations needing ≥ 1 repair | 0.089 (P11-v2, P12-v3, P13-v1, P15-v2) |
| M4.7 spec-specificity: token-3-gram Jaccard distance, within-spec vs between-spec | 0.773 vs 0.860 |

The two failures, P11-v2 and P15-v2 (Gemini Flash-Lite), kept using `globalThis` after 2 repairs.

Per variant:

| Variant | Mean lines | Mean generation latency | Contract OK |
|---|---|---|---|
| v1 | 217 | 18.5 s | 15/15 |
| v2 | 157 | 5.0 s | 13/15 |
| v3 | 182 | 28.8 s | 15/15 |

M4.7: the between-spec distance is larger, as expected, but the gap is moderate. Within-spec pairs also differ by model.

### F4. Representative agent

P04-v3 (spec P04 vegetarian food tour, Groq `openai/gpt-oss-20b`, hash in `csv/codegen_agents.csv`, 7/7 held-out tasks
passed). Trimmed from 100 to 50 lines by removing log calls and merging input validation.
```javascript
async function run(task, tools, context) {
  const trace = [];
  const { city, count, budget } = task.inputs || {};
  if (typeof city !== 'string' || city.trim() === '' || !Number.isInteger(count) || count <= 0 ||
      typeof budget !== 'number' || budget <= 0) {
    return { status: 'needs_clarification', answer: null,
             success_indicators: { question: 'Missing or invalid city / count / budget' }, trace };
  }
  async function callWithRetry(toolName, args, retries = 2) {
    let attempt = 0;
    while (attempt <= retries) {
      try { return await tools.call(toolName, args); }
      catch (e) {
        if (e.name === 'ToolError' && ['TIMEOUT', 'UPSTREAM_503'].includes(e.code)) {
          if (attempt === retries) throw e;
        } else { throw e; }
      }
      attempt++;
    }
  }
  let restaurants;
  try { restaurants = await callWithRetry('search_restaurants', { city, veg_only: true }); }
  catch (e) { return { status: 'failed_gracefully', answer: null, success_indicators: { error: e.message }, trace }; }
  if (!Array.isArray(restaurants)) {
    return { status: 'failed_gracefully', answer: null,
             success_indicators: { error: 'search_restaurants did not return an array' }, trace };
  }
  const valid = restaurants.filter(r => typeof r.id === 'string' &&
    typeof r.avg_cost_for_two === 'number' && typeof r.veg === 'boolean');
  if (valid.length < count) return { status: 'infeasible', answer: null, success_indicators: {}, trace };
  valid.sort((a, b) => a.avg_cost_for_two - b.avg_cost_for_two);
  const selected = [];
  let totalCost = 0;
  for (let i = 0; i < count; i++) {
    selected.push({ kind: 'restaurant', id: valid[i].id, cost: valid[i].avg_cost_for_two });
    totalCost += valid[i].avg_cost_for_two;
  }
  if (totalCost > budget) return { status: 'infeasible', answer: null, success_indicators: {}, trace };
  return { status: 'success', answer: { plan: selected, total_cost: totalCost }, success_indicators: {}, trace };
}
```

---

## G. Sandbox

### G1. Enforced limits

Source: `lib/sandbox.ts` (`DEFAULT_LIMITS`, worker options) and `lib/tools.ts` (`MAX_TOOL_CALLS`).

| Limit | Value |
|---|---|
| Wall clock | 4000 ms default; 6000 ms for real tasks, 4000 ms for certification tests, 3000 ms for attacks, 1500 ms for wrapper transforms. The QuickJS interrupt handler stops at the deadline, and the host **terminates the worker** at deadline + 250 ms |
| CPU | **No separate CPU-time cap.** The interrupt deadline is wall-clock based |
| Memory | QuickJS heap 32 MB (`setMemoryLimit`); stack 512 KB (`setMaxStackSize`); worker V8 limits 96 MB old generation / 16 MB young generation |
| Tool calls | 40 per run (`MAX_TOOL_CALLS`) → `E_RESOURCE` |
| Output | 200,000 bytes → `E_RESOURCE` |
| Network | The VM has **no network primitive**. `fetch` / `XMLHttpRequest` are stubs that record the attempt and throw, giving `E_NET_DENIED` (sticky). The only bridge is `tools.call`, which allows only attached tools (others → `UNKNOWN_TOOL`). Wrapper URLs must hit the registry's allow-listed host (checked at synthesis and again server-side in `lib/api.ts → trustedWrappers`). Built-in live tools call fixed endpoints in code. API keys never enter the VM |
| Side effects | `requires_confirmation` tools without `context.confirmed` give `E_CONFIRM_REQUIRED` (sticky even if the agent catches it) |

### G2. Error codes (`ERROR_CODES` in `lib/sandbox.ts`)

- `E_CRASH`: Unhandled exception in generated code
- `E_TIMEOUT`: Wall-clock budget exceeded; run killed
- `E_RESOURCE`: CPU / memory / stack / tool-call cap hit
- `E_NET_DENIED`: Network call to a non-allow-listed target
- `E_TOOL`: Tool returned an error the agent didn't handle
- `E_MALFORMED_OUTPUT`: AgentResult fails schema validation
- `E_CONTRACT`: Generated code violates the interface contract
- `E_CONFIRM_REQUIRED`: Attempted a requires_confirmation action without confirmation

### G3. Stress and escape testing

31 hostile programs (`lib/attacks.ts`), each run through the full path and again with the static check disabled
(runtime layer only). Source: `eval/out/sandbox.json`, `results.json → M6`, CSVs `csv/sandbox_attacks.csv`,
`csv/sandbox_error_mapping.csv`, `csv/sandbox_reference_runs.csv`.

| Attack class | Tried | Blocked by the intended limit |
|---|---|---|
| infinite_loop | 3 | 2 |
| hang | 2 | 2 |
| memory_bomb | 4 | 4 |
| stack_bomb | 2 | 2 |
| network | 4 | 4 |
| filesystem | 3 | 3 |
| process_env (env read, `Function` constructor, spawn) | 3 | 3 |
| credentials | 2 | 2 |
| side_effect | 2 | 2 |
| tool_flood | 2 | 2 |
| output_bomb | 1 | 1 |
| tamper | 3 | 3 |

**Escape detection.** An attack counts as escaped if any canary leaks into its output (an env secret, a canary file, the
real API-key prefixes) or a side effect occurs (a spawn marker file, a host-level fetch).

| Metric | Value |
|---|---|
| M6.1 escapes | **0** (full path), **0** (runtime only) |
| M6.2 blocked by intended limit | 30/31 |
| M6.3 error mapping (fault-injection suite) | 16/16 |
| M6.4 hangs | 0 of 1,381 runs checked (31 attacks + 1,350 task runs) |
| M6.5 false kills | 0 of 90 reference-agent runs |
| M6.6 sandbox overhead | p50 183 ms (sandbox 184 ms vs bare run 1 ms) |

- **The miss in M6.2:** `loop-microtask` (`for(;;) await null`) was stopped without escaping, but it ended as `E_CRASH` instead of `E_TIMEOUT`.
- **M6.5 detail:** 3 hand-written reference agents × 10 tasks × 3 repeats. They also pass their checker 90/90.
- **M6.6 cause:** the overhead is mostly worker and WebAssembly start-up per run.

---

## H. Reliability Certification

### H1. Taxonomy (v0; `TAXONOMY` in `lib/runtime.ts`)

| ID | Name | Definition / generator guide | Example (from generated tests) |
|---|---|---|---|
| T1 | Ambiguous / under-specified input | missing or invalid inputs → expect `status_in [needs_clarification, failed_gracefully, infeasible]` | P01: inputs without `city` |
| T2 | Tool-call failure handling | error/timeout on the first call → `succeeds`; on all calls → `constraints_hold` | P03: `error@search_flights(first)` |
| T3 | Empty or null results | inject `empty`/`null` → `graceful`, or `constraints_hold` if another tool can substitute | P03: `empty@search_flights(all)` |
| T4 | Malformed parameters / schema drift | inject `schema_drift` (renamed fields, numbers as strings) → `constraints_hold` | `schema_drift@search_hotels` |
| T5 | Constraint violation | tight / barely satisfiable constraints → `constraints_hold` | P03: budget 500 |
| T6 | Hallucinated tool or argument | extra input implying an unavailable capability → `only_known_tools` | extra field `include_weather` |
| T7 | Resource abuse / looping | persistent errors / slow tools → `tool_calls_le(15)` | `error@search_hotels(all)` |
| T8 | Output-format violation | clearly satisfiable inputs → `succeeds` | P01 with a generous budget |

**Traced to observed failures:** T5, T1 and T2 appear as primary tags of real held-out failures. That is 3/8, below the
plan's ≥ 50% bar. The taxonomy has **not** been revised to v1.

### H2. Test generator

Source: `results.json → M8`, CSV `csv/generated_tests.csv`.

- **Budget:** 3 tests per category per **spec** (24 per spec), shared by the spec's 3 variants. Generated in 2 LLM calls per spec (T1–T4, T5–T8).
- **Expected properties** are checked by code (`evalProperty`):
  - Any error code fails the test.
  - `succeeds` / `constraints_hold` use an **oracle-free verifier** (`verifyConstraints` in `lib/checkers.ts`). It checks the answer against tool data and stated constraints, never against solver ground truth.
- **Validity (M8.2):** RARC 360/360 (100%); generic 359/360 (99.7%).
- **Duplicate rate (M8.5):** 0%.
- **Coverage (M8.1):** 120/120 cells (100%).
- **Leakage prevention:** the generator never sees agent code or held-out tasks, and its prompts are audited for held-out task text and inputs.
  - **Audit finding:** 30 of 45 generator prompts contain the inputs of one held-out task. For 10 specs (P06–P15) the spec's `example_inputs` equal held-out task T01's inputs. No ground truth leaked.
  - **Sensitivity check:** excluding those 10 tasks (`scripts/leakage-sensitivity.ts` → `eval/out/leakage-sensitivity.json`, CSV `csv/leakage_sensitivity.csv`), RARC AUROC is 0.920 vs generic 0.896 (Δ +0.025, CI [−0.030, 0.095]). The conclusions are unchanged.

### H3. Scoring (verbatim logic, `scoreCertificate` in `lib/runtime.ts`)

```
per_category[c].rate = passed_c / total_c
score(rarc)    = mean over categories c present of per_category[c].rate    # uniform weights w_c = 1/|C|
score(generic) = score(random) = passed / total                            # plain pass rate
weakest        = 3 lowest-rate categories with rate < 1, as "Handles <x> in <p> of <n> tests."
none           = dev-split success rate of the agent's task category (computed in scripts/analyze.ts)
```

### H4. Baselines

All four are implemented: `none`, `generic`, `random`, `rarc`.

- **Budget:** RARC, generic and random each get **24 tests per spec** (360 each overall). Random tests are distinct perturbations: 360 generated, 360 kept.
- **Model:** generic uses the same model as RARC (Gemini 3.5 Flash-Lite, T = 0.3).

### H5. Predictiveness

**Setup:**
- **Agents:** 43, the 45 minus 2 contract failures that would never be deployed.
- **Variants:** 3 per spec.
- **Runs:** 301 (7 held-out tasks per spec, 105 tasks in all).
- **Split:** τ is chosen on the dev split; everything else uses the held-out split.
- **CIs:** 95% bootstrap, 1,000 resamples over agents.
- **Base failure rate:** 0.183.

Source: `results.json → M7`, CSVs `csv/predictiveness.csv`, `csv/predictiveness_paired.csv`.

| Method | Spearman ρ | Pearson r | AUROC | AUPRC | Brier | ECE | τ (dev) | P / R / F1 |
|---|---|---|---|---|---|---|---|---|
| RARC | 0.698 [0.468, 0.819] | 0.755 [0.599, 0.861] | **0.921** [0.847, 0.970] | 0.735 [0.484, 0.886] | 0.106 | 0.103 | 0.813 | 0.750 / 0.764 / 0.757 |
| Generic | 0.624 [0.342, 0.789] | 0.796 [0.581, 0.882] | 0.906 [0.806, 0.972] | 0.738 [0.504, 0.885] | 0.086 | 0.069 | 0.542 | 0.786 / 0.600 / 0.680 |
| Random | 0.015 [−0.246, 0.409] | 0.272 [−0.218, 0.610] | 0.526 [0.421, 0.669] | 0.287 [0.100, 0.508] | 0.177 | 0.177 | 1.000 | 0.183 / 1.000 / 0.309 |
| None (prior) | 0.572 [0.297, 0.757] | 0.668 [0.378, 0.846] | 0.846 [0.739, 0.927] | 0.464 [0.251, 0.670] | 0.104 | 0.009 | 0.710 | 0.505 / 0.836 / 0.630 |

**Paired bootstrap**, run level, same resamples:

| Comparison | ΔAUROC [95% CI], one-sided p | Δρ [95% CI], p | Verdict |
|---|---|---|---|
| RARC vs generic | +0.014 [−0.036, 0.073], p = 0.278 | +0.074 [−0.073, 0.202], p = 0.230 | **inconclusive** |
| RARC vs random | +0.394 [0.256, 0.504], p < 0.001 | +0.683 [0.249, 0.976], p = 0.001 | RARC better |
| RARC vs none | +0.075 [−0.003, 0.161], p = 0.029 | +0.125 [−0.040, 0.254], p = 0.087 | CI includes 0 (borderline) |

**Per-category predictiveness (M7.8).** Agent level: "fails ≥ 1 T_c test" vs "has a held-out failure tagged T_c".
Source: `csv/per_category_predictiveness.csv`.

| Category | Agents flagged | Agents with real T_c failures | Precision | Recall |
|---|---|---|---|---|
| T1 | 15 | 4 | 0.133 | 0.500 |
| T2 | 30 | 1 | 0.033 | 1.000 |
| T3 | 13 | 0 | 0 | 0 |
| T4 | 5 | 0 | 0 | 0 |
| T5 | 2 | 8 | 0 | 0 |
| T6 | 1 | 0 | 0 | 0 |
| T7 | 2 | 0 | 0 | 0 |
| T8 | 13 | 0 | 0 | 0 |

Category-level prediction is weak.

**Leave-one-category-out ΔAUROC (M8.6):** dropping T8 costs −0.115 and dropping T2 costs −0.068. Every other category is
within ±0.022.

**Test-budget curve (M8.7):** mean AUROC over 100 random subsamples.

| Tests per agent | RARC | Generic | Random |
|---|---|---|---|
| 8 | 0.846 | 0.879 | 0.535 |
| 16 | 0.904 | 0.900 | 0.536 |
| 24 | 0.921 | 0.906 | 0.526 |

### H6. Seeded faults

5 bug types × 10 working agents = 50 faulty agents (`lib/attacks.ts → SEEDED_FAULTS`). A fault counts as detected when it
causes ≥ 1 new test failure compared with the unfaulted agent. Source: `results.json → M8.M8_4`, CSV `csv/seeded_faults.csv`.

| Fault | Targets | RARC | Generic | Random |
|---|---|---|---|---|
| F1 crashes on empty results | T3 | 0/10 | 0/10 | 0/10 |
| F2 does not handle tool errors | T2 | 10/10 | 5/10 | 1/10 |
| F3 retries forever on errors | T7 | 10/10 | 0/10 | 0/10 |
| F4 breaks on schema drift | T4 | 5/10 | 5/10 | 0/10 |
| F5 assumes inputs are complete | T1 | 10/10 | 1/10 | 10/10 |
| **All** | | **35/50 (0.70)** | **11/50 (0.22)** | **11/50 (0.22)** |

F1 is never detected by any method. Likely cause: for agents with only one essential tool, the empty-result tests expect
graceful failure, and the injected crash only triggers on the same tool, so the outcome matches the baseline agent. Not
yet investigated.

### H7. Failure tagging

- **Coverage:** 83 of 98 failed runs (repeat 0, all splits) received a tag (`eval/out/tags.json`, CSV `csv/failure_tags.csv`). On held-out: 59 of 69 failures have exactly one primary tag (**M9.1 = 0.855**). The rest were lost in a tagging batch whose output did not include them.
- **"Other" rate (M9.2):** 0.102.
- **Distribution:** T5 37, T1 9, T2 7, Other 6.
- **Judges:** `openai/gpt-oss-120b` for Gemini-built agents, `gemini-3.5-flash-lite` for Groq-built agents.
- **Human agreement:** **not measured** (M9.3 and M9.4 are not computed).

---

## I. Datasets & Benchmark

### I1. Dataset sizes

| Dataset | Size | Status / source |
|---|---|---|
| D-Retrieval | 24 specs | Done; `lib/specs.ts` (`D_RETRIEVAL`) |
| D-Intake | 30 specs (6 ambiguous) | Done; `lib/specs.ts` (`D_INTAKE`) |
| D-OpenAPI | 4 APIs | Done; `lib/openapi.ts` |
| D-Pilot | 15 agent specs (5 each for C1–C3) | Done; `lib/specs.ts` (`PILOT`) |
| D-Tasks | 10 per spec = 150 (3 dev / 7 held-out; 45 dev, 105 held-out); 49 marked hard | Done; `data/tasks.json` |
| D-Sandbox-Attack | 31 programs + 16 error-mapping cases | Done; `lib/attacks.ts` |
| D-Seeded-Faults | 5 fault types × 10 agents = 50 | Done; `lib/attacks.ts`, `eval/out/faults.json` |

### I2. Replay and split

- **Replay:** all evaluation runs use **replay mode**, with tool responses recorded on 2026-11-02 (`data/recordings.json`).
- **Split:** frozen and hashed. The dataset hash `2d19cad5917e61cf` is computed over task ids, splits, inputs and truth (`lib/tasks.ts → datasetHash`) and stored in every run record.

---

## J. Task Completion & Performance

### J1. Task success

Held-out tasks, repeat 0, n = 315 runs, including the 2 contract-failed agents. Source: `results.json → M5`, CSVs
`csv/task_completion_summary.csv`, `csv/task_runs.csv`.

| Group | TSR [95% CI] | Partial score |
|---|---|---|
| Overall | 0.781 [0.733, 0.822] | 0.821 |
| C1 planning | 0.933 [0.876, 0.971] | 0.933 |
| C2 lookup + compute | 0.981 [0.952, 1.000] | 0.981 |
| C3 scheduling | 0.429 [0.343, 0.524] | 0.548 |
| v1 / v2 / v3 | 0.895 / 0.657 / 0.790 | n/a |

- **M5.3 tool-call accuracy:** 1.000. Calls to attached tools with schema-valid arguments; no unknown-tool or invalid-argument calls were logged.
- **M5.4 graceful-failure rate among failures:** 0.899.
- **M5.5 run-to-run stability:** 1.000, the same outcome across **3** replay repeats for every (agent, task).
- **Outcomes:** 246 success, 48 wrong answer or status, 14 `E_CONTRACT`, 7 `E_CRASH`.

### J2. Latency

Source: `results.json → M10.M10_1`, CSV `csv/latency_by_stage.csv`. Live, uncached calls on the dev machine.

| Stage | p50 | p95 |
|---|---|---|
| Intake | 3.14 s | 12.03 s |
| Retrieval (embed + re-rank) | 6.73 s | 16.46 s |
| Code generation (incl. repairs) | 10.68 s | 59.71 s |
| Certification run (24 RARC tests in the sandbox, test generation excluded) | 3.20 s | 4.59 s |
| Task execution (sandbox) | 0.46 s | 0.87 s |
| Test generation (one RARC LLM call; first full run, `eval/out/tests.v1-incomplete.json`) | 4.5 s | 10.0 s |

**End-to-end** (spec → certified agent) is **derived** by summing each agent's logged stage latencies: intake + retrieval
+ code generation + certification run, test generation excluded. Over 43 agents: p50 28.9 s, p95 78.2 s. Production
end-to-end latency has **not been measured directly**, and no demo bound has been agreed (M10.2).

### J3. LLM usage

Source: `results.json → M10`, CSVs `csv/llm_usage_by_stage.csv`, `csv/provider_stats.csv`.

| Stage | Calls | Live calls | Tokens in | Tokens out |
|---|---|---|---|---|
| Intake | 33 | 33 | 17,080 | 6,736 |
| Embedding | 72 | 23 | 1,488 | 0 |
| Re-rank | 83 | 82 | 37,710 | 17,173 |
| Wrapper synthesis | 4 | 4 | 2,726 | 493 |
| Code generation | 54 | 53 | 42,208 | 77,369 |
| Code repair | 7 | 7 | 22,587 | 12,792 |
| RARC test generation | 30 | 5 | 31,046 | 55,647 |
| Generic test generation | 15 | 5 | 10,063 | 44,203 |
| Failure tagging | 9 | 7 | 14,943 | 2,982 |

The "live" counts for test generation are low because the final run reused cached responses from the earlier attempt.

Totals from the call logs: 307 logged call outcomes; 283 succeeded; 24 failed outright (all 24 were rate-limit or quota
errors after retries); 226 retries; 24 successful fallbacks; 88 cache hits; about 397k tokens.

| Provider | Calls | Retries | Failed calls | Fallbacks | Cache hits |
|---|---|---|---|---|---|
| Groq | 128 | 204 | 19 | 5 | 3 |
| Gemini | 179 | 22 | 5 | 19 | 85 |

---

## K. Logging & Reproducibility

### K1. Logging schema as implemented

Records are JSON, not a database.

**Real-task run record** (`scripts/eval.ts`, stored in `eval/out/runs.json → runs[]`):
```
run_id, timestamp, run_type ("real_task"), repeat,
spec_id, spec_version (hash of spec text), task_id, task_category, split, hard, hard_reason,
agent_id, agent_version (variant), code_hash, tool_ids[], synthesized_tool_ids[],
cert_score_at_run_time {rarc, generic, random}, cert_breakdown {T1..T8},
trace[] {tool, ok, ms, fault, err, args}, status, error_code, error_message, answer,
checker_result {success, partial_score, failed[], expected, got},
tool_stats {calls, unknown_tool_calls, invalid_arg_calls, confirm_violations, net_denied, call_cap_hit, side_effect_calls[]},
stage_latencies {execution_ms}, terminated_within_budget, dataset_hash
```

**LLM call record** (`LlmCall` in `lib/llm.ts`). It is attached to the stage output that made the call: intake rows,
retrieval rows, agents, test sets, tags.
```
stage, provider, model_id, params {temperature, max_tokens, json, seed}, prompt_hash,
tokens_in, tokens_out, latency_ms, cache_hit, fallback_used, retries, error?, ts
```

**Certification records:** `eval/out/runs.json → certs[]` has per agent and method `{score, per_category, weakest, basis, outcomes[] {test_id, category, pass, why, status, error_code, tool_calls, ms}}`.

**Not stored per run** (fields from the plan): `llm_calls[]` on task runs (agents make no LLM calls at run time),
`taxonomy_primary` (stored separately in `tags.json`), `flagged`/`flag_note` (demo session only, in `localStorage`),
and `sandbox_resource_peak` (not measured).

### K2. Reproduction script

Yes: `scripts/analyze.ts`. It makes no LLM calls.
- **Input:** `eval/out/*.json` and `data/tasks.json`.
- **Computation:** every metric in §6 except M9.3, M9.4 and M11.x, plus tables T1–T8 and the data for figures F1–F3. Bootstrap seeds are fixed.
- **Determinism check:** it runs the whole computation **twice** and compares hashes. Result: identical, hash `ddb7227c30090cbd`.
- **Outputs:** `public/results.json`, `public/agents-public.json`, `public/runs-sample.json`.
- **Companion scripts:** `scripts/leakage-sensitivity.ts`, `scripts/export-csv.ts`.

---

## L. Figures & Artifacts

### L1. Figures and CSVs

Figures are PNG exports of the live Evaluation tab, in `docs/report/figures/`:
`T1-capability-scorecard.png`, `T2-retrieval.png`, `T3-task-completion.png`, `T4-main-result.png`,
`T5-seeded-fault-detection.png`, `T6-per-category.png`, `T7-sandbox.png`, `T8-performance-cost.png`,
`F1-calibration.png`, `F2-test-budget-curve.png`, `F3-score-vs-outcome.png`.

Raw CSVs are in `docs/report/csv/`, regenerated by `npx tsx scripts/export-csv.ts`:

| Area | Files |
|---|---|
| Retrieval | `retrieval_metrics.csv`, `retrieval_per_spec.csv` |
| Intake | `intake_per_spec.csv` |
| Wrappers | `wrapper_synthesis.csv` |
| Code-gen | `codegen_agents.csv` |
| Sandbox | `sandbox_attacks.csv`, `sandbox_error_mapping.csv`, `sandbox_reference_runs.csv` |
| Task completion | `task_runs.csv` (all 1,350 runs), `task_completion_summary.csv` |
| Certification | `certification_scores.csv`, `certification_test_outcomes.csv` (3,237 test executions), `generated_tests.csv` |
| Predictiveness | `predictiveness.csv`, `predictiveness_paired.csv`, `predictiveness_scatter.csv`, `calibration_bins.csv`, `per_category_predictiveness.csv`, `test_budget_curve.csv`, `leakage_sensitivity.csv` |
| Faults / tags | `seeded_faults.csv`, `failure_tags.csv` |
| Latency / cost | `latency_by_stage.csv`, `llm_usage_by_stage.csv`, `provider_stats.csv` |

### L2. UI screenshots (`docs/report/figures/`)

- `ui-1-spec-to-tools.png`: spec → retrieved and selected tools, with re-rank justifications and the coverage gap sent to synthesis.
- `ui-2-live-execution-trace.png`: live tool-call trace, answer and checker result for task P01-T01.
- `ui-3-reliability-report.png`: certificate score, per-category bars, weakest areas, and the test table.
- `ui-0-full-demo.png`: the full Live Demo page.

### L3. Delivery Plan diagrams vs. as-built

**Postgres is not used.** Logging is JSON files plus browser `localStorage`.

| Diagram | Still matches? | Changes |
|---|---|---|
| User journey | Mostly | Spec → (clarifying question) → assemble → certificate → run task → flag. Flags stay in the browser only. There is no account or persistence across devices |
| System architecture | Partly | No MCP servers (in-process tools with MCP-style metadata). Declarative wrappers instead of generated MCP servers. JSON logs instead of Postgres. One Next.js app holds both UI and API. Sandbox = QuickJS/WASM in a worker thread |
| Orchestrator / sandbox / tool sequence | Yes, with detail | Agent code → worker → QuickJS VM → `tools.call` → host tool client (allow-list, side-effect policy, fault injection, replay) → result back into the VM. The host enforces the deadline by killing the worker |
| Certification pipeline | Mostly | Tests are generated per spec (not per agent). The property menu has `succeeds` added. The verifier is oracle-free |
| Evaluation design | Yes | 15 specs × 3 variants, 4 methods, held-out replay, paired bootstrap. Sizes are at the gate minimum, not the paper target |

---

## M. Limitations

### M1. Known issues, bugs and limitations

1. **Main hypothesis not yet supported.** RARC vs generic ΔAUROC = +0.014, CI [−0.036, 0.073]. RARC beats random clearly, and beats no-testing only borderline.
2. **Input leakage** from `example_inputs` into the test-generator prompt for 10 specs (inputs only; the sensitivity analysis shows no effect).
3. **Retrieval below gate:** hit-rate@5 = 0.875 < 0.90. Re-ranking slightly lowers MRR and nDCG.
4. **One sandbox mis-mapping:** `loop-microtask` gives `E_CRASH`, not `E_TIMEOUT`. No CPU-time cap separate from wall clock. No per-run peak-memory logging.
5. **Category-level predictiveness is weak** (M7.8). Real failures are dominated by T5; certification failures by T2/T8.
6. **Seeded fault F1 is never detected** by any method. Not investigated.
7. **Provider quotas shaped the run.**
   - The intended v1 model (Gemini 3.5 Flash) covered only 10 of 15 v1 agents. The rest came from fallbacks, so variants mix models.
   - A first run lost tests to quota errors. That run was superseded (A3).
   - The Gemini 2.5 fallback was misconfigured (HTTP 400); it is fixed now.
8. **Scale:** 15 specs, 43 evaluated agents, 301 held-out runs, so CIs are wide.
9. **Data realism:** 9 of 12 tools are simulated providers.
10. **Annotation:** gold labels and tags have one annotator or an LLM judge. Taxonomy v0 is not refined.
11. **Untested in production:** clarification threshold not tuned on a dev set; no production build or deployment yet; logging is file-based.
12. **Harmless display bug:** a progress-log line printed the wrong agent's scores during parallel runs. Fixed; data unaffected.
13. **Intake latency:** p95 is 12 s, above the 5 s target, because of Groq rate-limit retries.

### M2. Planned, not started (Future Work)

- Scale to the paper target: 30+ specs, 3–5 variants, 10 held-out tasks per spec. Power check (plan §7.4).
- Re-sample `example_inputs` so they never coincide with held-out tasks; rerun.
- Taxonomy v1 from observed failures; human verification of auto-tags (M9.3); second annotator for gold labels (M9.4, E2).
- Learned category weights on the dev split (scoring v1); a dev-split pilot predictiveness check (Gate 4).
- Provider-sensitivity check: regenerate a subset of agents with code-gen swapped to the other provider (plan §3.3).
- Real MCP servers and protocol transport; more live APIs; OpenAPI synthesis on more endpoints (target 4–5 APIs × multiple endpoints).
- Persistent logging store (e.g. Postgres) and server-side flag queue (US-11).
- CPU-time cap and resource-peak logging in the sandbox; fix the microtask-loop mapping.
- Internal QA sessions (M11.1–M11.3); demo latency bound (M10.2); production deployment on Vercel.
- C4 multi-source aggregation category in the pilot.
