"use client";
import { PILOT } from "@/lib/specs";

const TAXONOMY = [
  ["T1", "Ambiguous / under-specified input", "Task with a missing date, unknown city or unsupported unit", "status ∈ {needs_clarification, failed_gracefully, infeasible}"],
  ["T2", "Tool-call failure handling", "Injected error / timeout on the first or every call", "succeeds (transient) or constraints_hold (persistent)"],
  ["T3", "Empty or null results", "Tool returns [] or null", "graceful — no fabricated answer"],
  ["T4", "Malformed parameters / schema drift", "Renamed fields, numbers as strings", "constraints_hold"],
  ["T5", "Constraint violation", "Barely satisfiable budget / window / rating", "constraints_hold"],
  ["T6", "Hallucinated tool or argument", "Inputs implying a capability no attached tool has", "only_known_tools"],
  ["T7", "Resource abuse / looping", "Persistent errors that tempt unbounded retries", "tool_calls_le(15)"],
  ["T8", "Output-format violation", "Clearly satisfiable inputs, strict answer schema", "succeeds"],
];
const ERRORS = [["E_CRASH", "Unhandled exception in generated code"], ["E_TIMEOUT", "Wall-clock budget exceeded; run killed"], ["E_RESOURCE", "Memory / stack / tool-call / output cap hit"], ["E_NET_DENIED", "Network access outside the tool client"], ["E_TOOL", "Tool error the agent didn't handle"], ["E_MALFORMED_OUTPUT", "AgentResult fails schema validation"], ["E_CONTRACT", "Code violates the interface contract (static check / load)"], ["E_CONFIRM_REQUIRED", "requires_confirmation tool called without confirmation"]];

function Arch() {
  const box = (x: number, y: number, w: number, t: string, s: string, c = "#fff") => (
    <g><rect x={x} y={y} width={w} height={46} rx={8} fill={c} stroke="var(--border)" /><text x={x + w / 2} y={y + 19} fontSize={11.5} fontWeight={600} textAnchor="middle" fill="var(--text-primary)">{t}</text><text x={x + w / 2} y={y + 34} fontSize={9.5} textAnchor="middle" fill="var(--text-secondary)">{s}</text></g>
  );
  const arr = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-muted)" strokeWidth={1.3} markerEnd="url(#ah)" />;
  return (
    <svg viewBox="0 0 860 400" className="w-full" role="img" aria-label="RARC architecture">
      <defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)" /></marker></defs>
      {box(10, 20, 120, "NL agent spec", "free text (US-1)", "#f3f2ef")}
      {box(160, 20, 130, "Spec intake", "category · capabilities · Q?")}
      {box(320, 20, 150, "Tool retrieval", "embeddings → LLM re-rank")}
      {box(500, 20, 160, "Wrapper synthesis", "OpenAPI → MCP, validated")}
      {box(690, 20, 160, "Code generation", "contract check · repair ≤2")}
      {arr(130, 43, 158, 43)}{arr(290, 43, 318, 43)}{arr(470, 43, 498, 43)}{arr(660, 43, 688, 43)}
      <rect x={180} y={110} width={500} height={92} rx={10} fill="#eef4fc" stroke="var(--series-1)" strokeDasharray="5 3" />
      <text x={190} y={196} fontSize={9.5} fill="var(--series-1)" fontWeight={600}>Sandbox: QuickJS/WASM VM in a killable worker · tool client is the only bridge · fault injection · side-effect policy</text>
      {box(200, 125, 210, "Reliability certification", "taxonomy tests T1–T8 → score S")}
      {box(450, 125, 210, "Real task execution", "same path · live trace")}
      <polyline points="770,66 770,90 305,90 305,123" fill="none" stroke="var(--text-muted)" strokeWidth={1.3} markerEnd="url(#ah)" />
      <line x1={555} y1={90} x2={555} y2={123} stroke="var(--text-muted)" strokeWidth={1.3} markerEnd="url(#ah)" />
      {box(200, 232, 210, "Certificate + report", "per-category, weakest 3, basis")}
      {box(450, 232, 210, "Programmatic checker", "ground truth from recordings")}
      {arr(305, 171, 305, 230)}{arr(555, 171, 555, 230)}
      {box(200, 330, 460, "Logging store", "every run · every LLM call · code hash · dataset hash", "#f3f2ef")}
      {arr(305, 278, 305, 328)}{arr(555, 278, 555, 328)}
      {box(10, 330, 160, "Evaluation", "s(a) vs Y(a): ρ, AUROC, …", "#f3f2ef")}
      {arr(198, 353, 172, 353)}
    </svg>
  );
}

export default function Methodology({ results }: { results: any }) {
  const r = results;
  const rm = r?.M7?.methods?.rarc, gm = r?.M7?.methods?.generic, pv = r?.M7?.paired?.rarc_vs_generic;
  return (
    <article className="paper card mx-auto max-w-4xl px-6 py-10 sm:px-14" style={{ boxShadow: "var(--shadow-md)" }}>
      <div className="text-xs uppercase tracking-wider faint">Prototype · method</div>
      <h1 className="mt-1 font-serif text-3xl font-semibold leading-tight">RARC: Real-Time Agent Assembly with Reliability Certification</h1>
      <p className="muted">IIT Kharagpur, CSE · Nived Krishna (research core), Srishanth Guguloth (product engineering) · Advisor: Prof. Pawan Goyal</p>

      <h2>Abstract</h2>
      <p>Systems that assemble tool-using agents from a natural-language specification can produce an agent in seconds, but the user has no way to know whether that particular agent will work. RARC assembles a spec-specific agent (intake → tool retrieval → OpenAPI wrapper synthesis → orchestration code generation), runs it in a sandbox, and issues a <i>reliability certificate</i> before the agent touches any real task. The certificate is a score built from adversarial tests organised by a failure taxonomy. Our research question is whether this score <b>predicts real task success</b> better than cheaper alternatives: no testing, generic LLM-written unit tests, and random input perturbation with the same test budget.
        {rm && <> On {r.meta.n_agents - (r.M7.excluded_agents?.length ?? 0)} generated agents and {r.M7.n_runs} held-out task runs, RARC reaches AUROC {rm.auroc} (95% CI {rm.auroc_ci?.join("–")}) against {gm.auroc} for generic tests; the paired difference is {pv.d_auroc} (CI {pv.auroc_ci?.join(" to ")}). Full results are in the Evaluation tab.</>}</p>

      <h2>1. System</h2>
      <Arch />
      <h3>1.1 Spec intake (US-1)</h3>
      <p>An LLM maps the spec to a structured intermediate spec <code>{"{task_category, required_capabilities[], constraints[], input_fields[], confidence}"}</code> over a fixed capability vocabulary of 16 ids. When confidence is below τ = 0.6 the system returns exactly one clarifying question instead of guessing.</p>
      <h3>1.2 Tool retrieval (US-2)</h3>
      <p>Stage 1 ranks the library (12 tools: 3 live public APIs and 9 simulated providers, each with schema, endpoints and side-effect class) by cosine similarity of Gemini embeddings between the spec plus its capabilities and each tool's description. Stage 2 asks an LLM to re-rank the top 8 and justify each tool in one line; that justification is shown to the user as the "why". Capabilities left uncovered by the selected tools trigger wrapper synthesis.</p>
      <h3>1.3 OpenAPI → MCP wrapper synthesis (US-3)</h3>
      <p>Given an OpenAPI document and a target tool interface, the LLM writes a declarative wrapper: base URL, path template, query mapping and a pure <code>transform(body, args)</code> function. The transform runs in the same sandbox. Validation gate: the example call must hit an allow-listed host and return output that passes the interface validator. Failures are fed back for up to two repairs; otherwise the wrapper is rejected. Synthesized tools carry a visible badge.</p>
      <h3>1.4 Orchestration code generation (US-4)</h3>
      <p>The generator writes plain JavaScript against a fixed contract: <code>async function run(task, tools, context) → AgentResult</code> with <code>AgentResult = {"{status, answer, success_indicators, trace}"}</code>. Tools are reachable only through <code>tools.call</code>, and handlers for tool failure, empty results and schema-invalid output are required. Each generation passes a static contract check (forbidden constructs, entry point) and a load test, with up to two repairs. Every agent version is stored with its spec version, tool set, prompt version, model ID, parameters and code hash. To get real spread in reliability (§7.3 of the plan), each spec gets three variants: v1 a strong model with a robust prompt (Gemini 3.5 Flash for 10 specs, Groq gpt-oss-120b for 5 after the Gemini quota ran out), v2 Gemini 3.5 Flash-Lite with a concise prompt at T = 0.9, and v3 the fast-tier Groq gpt-oss-20b (Gemini Flash-Lite for 4 specs after Groq rate limits). The exact model behind every agent is logged.</p>
      <h3>1.5 Sandbox (US-5–7)</h3>
      <p>Every run, real task or certification test, takes the same path: a fresh QuickJS WebAssembly VM inside a disposable worker thread. The VM has no network, filesystem, process, timers or host objects. Limits are a heap cap (32 MB), stack cap, interrupt deadline, 40-call tool budget, output cap, and a host-side hard kill at the wall-clock budget. The kill matters because native operations inside the VM can ignore interrupts. Policy violations (network, unconfirmed side effects) are <i>sticky</i>: an agent that catches the error is still flagged. Each failure maps to exactly one code:</p>
      <div className="tbl-wrap my-3"><table className="tbl"><tbody>{ERRORS.map(([c, d]) => <tr key={c}><td className="font-mono">{c}</td><td>{d}</td></tr>)}</tbody></table></div>
      <h3>1.6 Reliability certification (US-8, US-9)</h3>
      <p>For each spec, a test generator that never sees agent code or held-out tasks (enforced, and audited by searching its prompts for held-out task text) writes 3 tests per taxonomy category. Each test is <code>{"{inputs, injected_conditions, expected_property}"}</code>. Fault injections (error, timeout, empty, null, schema drift, slow) are applied by the tool client. Expected properties come from a fixed, programmatically checkable menu. <code>constraints_hold</code> uses an <b>oracle-free verifier</b>: it checks the answer against tool data and the stated constraints (items exist, costs match, budget respected, no calendar conflicts, working hours), never against a solver's ground truth. <b>Pilot finding (property menu v0 → v1).</b> On the pilot we found that v0 properties could be satisfied <i>vacuously</i>: an agent with a bug that made it always answer "infeasible" scored 0.88, because "fail gracefully" and "if you claim success, be correct" both pass when you never succeed. v1 adds <code>succeeds</code> (status success <i>and</i> verifier passes) for clearly satisfiable inputs and transient faults. It is offered to the generic baseline too, since ordinary unit tests check for working answers. The change was made before any predictiveness metric was computed. Scoring v0: per-category pass rate p<sub>c</sub>, overall S = Σ<sub>c</sub> w<sub>c</sub>·p<sub>c</sub> with uniform weights. The report lists the three weakest categories in plain language and labels its basis ("synthetic tests").</p>
      <div className="tbl-wrap my-3"><table className="tbl"><thead><tr><th>ID</th><th>Category</th><th>Example adversarial test</th><th>Expected property</th></tr></thead><tbody>{TAXONOMY.map((t) => <tr key={t[0]}>{t.map((c, i) => <td key={i} className={i === 0 ? "font-mono" : ""}>{c}</td>)}</tr>)}</tbody></table></div>
      <h3>1.7 Baselines (US-13)</h3>
      <p>A single switch changes only the certification step. <b>none</b>: a constant prior, the category's success rate on the dev split. <b>generic</b>: LLM-written, taxonomy-blind, non-adversarial unit tests from the <i>same model</i> with the <i>same budget</i>. <b>random</b>: the same budget of random input perturbations (dropped, nulled, mistyped or rescaled fields).</p>

      <h2>2. Benchmark</h2>
      <p><b>D-Pilot</b>: {PILOT.length} agent specs, 5 per category: C1 constrained planning, C2 lookup + compute, C3 scheduling. <b>D-Tasks</b>: 10 tasks per spec, split 3 dev / 7 held-out and fixed by a dataset hash{r ? <> (<code>{r.meta.dataset_hash}</code>)</> : null}. About 30% are hard: tight or infeasible budgets, a flaky provider, formatted-string prices, ambiguous place names such as "Kochi" (resolves to Japan without a country filter), all-day calendar entries, US holidays, and non-overlapping time zones. Ground truth comes from reference solvers over the same <b>recorded</b> tool responses, and evaluation runs in replay mode so results do not drift with live data. Every task has a programmatic checker: C1 checks items, costs, counts and budget; C2 checks value within tolerance and unit; C3 checks duration, window, conflicts, working hours and earliest slot. <b>D-Intake</b> has 30 specs, 20% deliberately ambiguous. <b>D-Retrieval</b> is the 24 clear specs with gold tool labels written before retrieval ran. <b>D-OpenAPI</b> has 4 real APIs (Frankfurter, Nager.Date, Open-Meteo Elevation, Sunrise-Sunset). <b>D-Sandbox-Attack</b> has 31 hostile programs plus a 16-case error-mapping suite. <b>D-Seeded-Faults</b> has 5 bug types × 10 working agents.</p>

      <h2>3. Protocol</h2>
      <pre className="code">{`for spec in D-Pilot:                          # 15 specs
  for variant in {v1, v2, v3}:                # 45 agents
    agent = assemble(spec, variant)           # cached, versioned, hashed
    for method in [none, generic, random, rarc]:
      s[agent, method] = certify(agent, method)   # uses NO held-out tasks
    for task in D-Tasks[spec].heldout:        # 7 per spec, x3 replays
      y[agent, task] = checker(execute(agent, task, mode=replay))
compute M7.x for each method over the same (agent, task) pairs`}</pre>
      <p>"Positive" means <i>the agent will fail</i>. Agent-level: Spearman ρ and Pearson r between s(a) and Y(a), the held-out success rate. Run-level: AUROC and AUPRC of 1 − s(a) for failing runs, Brier score, and 10-bin ECE. P/R/F1 use a threshold τ tuned on the dev split and applied to held-out. 95% CIs come from 1,000 bootstrap resamples over agents, with tasks resampled within each agent. RARC vs. each baseline uses a <b>paired</b> bootstrap on ΔAUROC and Δρ with a one-sided p-value. "RARC beats a baseline" is claimed only if the CI on the difference excludes 0. Agents that fail the contract gate are excluded from predictiveness, since they would never be deployed, and are reported separately.</p>

      <h2>4. LLM provider strategy</h2>
      <p>All calls go through one interface, <code>complete(role, messages, opts)</code>, which handles role-based routing, retry with backoff, cross-provider fallback (Groq ↔ Google AI Studio), a response cache keyed on (provider, model, prompt hash, params), and logging of model ID, parameters, tokens, latency, cache hit and fallback on every call. Intake and re-rank run on Groq <code>gpt-oss-20b</code>. Code generation was planned on Gemini 3.5 Flash. Its free tier allows only 20 requests a day, so after 10 v1 agents the fallback layer routed the remaining 5 to Groq gpt-oss-120b, and we froze that route for the demo. v2 runs on Gemini 3.5 Flash-Lite and v3 on Groq gpt-oss-20b. Wrapper synthesis runs on Gemini 3.5 Flash. Test generation, generic baseline included, uses the same model, Gemini 3.5 Flash-Lite. Failure tagging uses the provider that did <i>not</i> generate the agent. Model IDs were frozen before the evaluation. API keys stay server-side and never enter the sandbox.</p>

      <h2>5. Threats to validity and deviations from the plan</h2>
      <p>(i) Scale: 15 specs × 3 variants is the gate minimum, not the 30-spec paper target, so CIs are wide. (ii) Tests are generated per spec and shared across that spec's variants, not per agent. This keeps variant scores comparable and the cost within free-tier limits. (iii) Gold labels and taxonomy tags come from one annotator (gold) and an LLM judge (tags). Human agreement (M9.3, M9.4) is not yet measured. (iv) Hotel, flight, train, attraction, restaurant and calendar providers are simulated, though deliberately quirky. Weather, air quality, geocoding, exchange rates and holidays are real recorded API responses. (v) The <code>none</code> baseline is reported with its actual values; the plan's convention would fix ρ = 0 and AUROC = 0.5. (vi) <b>Input leakage:</b> for 10 of 15 specs the example inputs shown to the test generator equal the inputs (never the ground truth) of held-out task T01. A sensitivity analysis excluding those 10 tasks leaves the conclusions unchanged (<code>scripts/leakage-sensitivity.ts</code>). (vii) A first full run lost some test-generation calls to provider quota limits, leaving 4 specs with incomplete RARC tests and 3 with no generic tests. That run produced a spurious 'RARC beats generic' result. The final run regenerates the missing tests with a fixed budget of 24 tests per method per spec and 100% taxonomy coverage; only the final run is reported.</p>
    </article>
  );
}
