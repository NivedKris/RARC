"use client";
import { Check, X } from "./icons";
import { GroupedBars, Legend, LineChart, METHOD_COLOR, METHOD_LABEL, MiniBar, Reliability, ScatterPanel } from "./charts";

const f = (v: any, d = 2) => (v === null || v === undefined || (typeof v === "number" && !isFinite(v)) ? "–" : typeof v === "number" ? v.toFixed(d) : String(v));
const ci = (c: any, d = 2) => (Array.isArray(c) && c[0] !== null ? `[${f(c[0], d)}, ${f(c[1], d)}]` : "");
const P = (v: any) => (v === null || v === undefined ? "–" : `${Math.round(v * 1000) / 10}%`);
const M = ["rarc", "generic", "random", "none"];

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return <section id={id} className="card scroll-mt-24 p-6"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{sub && <span className="text-xs faint">{sub}</span>}</div><div className="mt-4">{children}</div></section>;
}
function Pass({ v }: { v: boolean | null }) {
  if (v === null) return <span className="badge badge-neutral">reported</span>;
  return <span className={`badge ${v ? "badge-good" : "badge-bad"}`}>{v ? <Check size={12} /> : <X size={12} />}{v ? "pass" : "not met"}</span>;
}
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: accent ? "#c7cbff" : "var(--border)", background: accent ? "var(--accent-soft)" : "var(--surface-1)" }}><div className="text-xs font-medium faint">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" style={accent ? { color: "var(--accent-ink)" } : undefined}>{value}</div>{sub && <div className="mt-0.5 text-xs faint">{sub}</div>}</div>;
}
const NAV = [["t1", "Scorecard"], ["t4", "Main result"], ["f3", "Score vs outcome"], ["f1", "Calibration"], ["t5", "Seeded faults"], ["t6", "Per category"], ["t3", "Task completion"], ["t2", "Retrieval"], ["t7", "Sandbox"], ["t8", "Cost"], ["m8", "Test quality"]];

export default function Evaluation({ results: r }: { results: any }) {
  if (!r) return <div className="card p-10 text-center muted">Loading results…</div>;
  const m7 = r.M7, meth = m7.methods;
  const series = M.map((k) => ({ key: k, label: METHOD_LABEL[k], color: METHOD_COLOR[k] }));
  return (
    <div className="space-y-6">
      <div className="card p-6" style={{ boxShadow: "var(--shadow-md)" }}>
        <div className="eyebrow">Evaluation</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Does the certificate predict real task success?</h1>
        <p className="mt-1 text-sm muted">Every number below is regenerated from the logged runs by <code>scripts/analyze.ts</code>. No number is typed by hand.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="agents assembled" value={String(r.meta.n_agents)} sub={`${r.meta.n_specs} specs × 3 variants`} />
          <Stat label="benchmark tasks" value={String(r.meta.n_tasks)} sub={`${r.meta.n_heldout} held-out`} />
          <Stat label="task runs logged" value={String(r.meta.n_runs_logged)} sub="3 replays each" />
          <Stat label="certification runs" value={String(r.meta.n_cert_runs)} sub="rarc + generic + random" />
          <Stat accent label="AUROC (RARC)" value={f(meth.rarc.auroc)} sub={ci(meth.rarc.auroc_ci)} />
          <Stat label="held-out task success" value={P(r.M5.M5_1.overall.tsr)} sub={ci(r.M5.M5_1.overall.ci)} />
        </div>
        <nav className="mt-5 flex flex-wrap gap-1.5">{NAV.map(([id, l]) => <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }} className="chip hover:border-[var(--accent)] hover:text-[var(--accent-ink)]">{l}</a>)}</nav>
        <p className="mt-4 text-xs faint">Dataset hash <code>{r.meta.dataset_hash}</code> · results hash <code>{r.M12.hash}</code> · reproduction determinism (M12.1): {r.M12.M12_1_identical ? "identical across two runs" : "MISMATCH"} · mode {r.meta.mode} · generated {r.generated_at?.slice(0, 16).replace("T", " ")} UTC</p>
      </div>

      <Section id="t1" title="T1 · Capability scorecard" sub="gate metrics from the delivery plan">
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>capability</th><th>metric</th><th className="num">value</th><th>target</th><th>status</th></tr></thead><tbody>
          {r.T1.map((x: any) => <tr key={x.metric}><td>{x.capability}</td><td>{x.metric}</td><td className="num">{f(x.value, 3)}</td><td className="faint">{x.target}</td><td><Pass v={x.pass} /></td></tr>)}
        </tbody></table></div>
      </Section>

      <Section id="t4" title="T4 · Main result: does the certificate predict real success?" sub={`${m7.n_agents} agents · ${m7.n_runs} held-out runs · positive class = run fails · 95% bootstrap CIs over agents`}>
        <div><div className="tbl-wrap"><table className="tbl"><thead><tr><th>method</th><th className="num">Spearman ρ</th><th className="num">Pearson r</th><th className="num">AUROC</th><th className="num">AUPRC</th><th className="num">Brier ↓</th><th className="num">ECE ↓</th><th className="num">τ (dev)</th><th className="num">P</th><th className="num">R</th><th className="num">F1</th></tr></thead><tbody>
          {M.map((k) => { const x = meth[k]; return <tr key={k}><td><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5" style={{ background: METHOD_COLOR[k] }} />{METHOD_LABEL[k]}</td><td className="num">{f(x.spearman)} <span className="faint">{ci(x.spearman_ci)}</span></td><td className="num">{f(x.pearson)} <span className="faint">{ci(x.pearson_ci)}</span></td><td className="num"><b>{f(x.auroc)}</b> <span className="faint">{ci(x.auroc_ci)}</span></td><td className="num">{f(x.auprc)} <span className="faint">{ci(x.auprc_ci)}</span></td><td className="num">{f(x.brier, 3)}</td><td className="num">{f(x.ece, 3)}</td><td className="num">{f(x.tau)}</td><td className="num">{f(x.precision)}</td><td className="num">{f(x.recall)}</td><td className="num">{f(x.f1)}</td></tr>; })}
        </tbody></table></div></div>
        <p className="mt-1 text-xs faint">Base failure rate on held-out runs: {P(meth.rarc.base_failure_rate)} (AUPRC of a random scorer). Excluded (failed the contract gate, never deployed): {m7.excluded_agents.length ? m7.excluded_agents.join(", ") : "none"}.</p>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div><div className="mb-1 text-sm font-medium">AUROC with 95% CI</div><GroupedBars groups={[{ label: "AUROC", values: Object.fromEntries(M.map((k) => [k, { v: meth[k].auroc, ci: meth[k].auroc_ci }])) }]} series={series} min={0.3} max={1} refLine={{ v: 0.5, label: "chance" }} /></div>
          <div><div className="mb-1 text-sm font-medium">Spearman ρ with 95% CI</div><GroupedBars groups={[{ label: "ρ(s, Y)", values: Object.fromEntries(M.map((k) => [k, { v: meth[k].spearman, ci: meth[k].spearman_ci }])) }]} series={series} min={-0.4} max={1} refLine={{ v: 0, label: "0" }} /></div>
        </div>
        <Legend items={series} />
        <div className="mt-4 text-sm font-medium">Paired comparisons (same agents, same resamples)</div>
        <div className="tbl-wrap mt-2"><table className="tbl"><thead><tr><th>comparison</th><th className="num">ΔAUROC</th><th>95% CI</th><th className="num">p (one-sided)</th><th className="num">Δρ</th><th>95% CI</th><th className="num">p</th><th>verdict</th></tr></thead><tbody>
          {Object.entries(m7.paired).map(([k, x]: any) => { const win = x.auroc_ci[0] > 0; const inc = x.auroc_ci[0] <= 0 && x.auroc_ci[1] >= 0; return <tr key={k}><td>{k.replace(/_/g, " ")}</td><td className="num">{f(x.d_auroc, 3)}</td><td>{ci(x.auroc_ci, 3)}</td><td className="num">{f(x.auroc_p, 3)}</td><td className="num">{f(x.d_spearman, 3)}</td><td>{ci(x.spearman_ci, 3)}</td><td className="num">{f(x.spearman_p, 3)}</td><td>{win ? <span className="badge badge-good">RARC better · CI excludes 0</span> : inc ? <span className="badge badge-neutral">inconclusive</span> : <span className="badge badge-bad">baseline better</span>}</td></tr>; })}
        </tbody></table></div>
      </Section>

      <Section id="f3" title="F3 · Certificate score vs. real outcome" sub="one dot per agent; small multiples so each method has its own panel">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{M.map((k) => <ScatterPanel key={k} points={meth[k].scatter} color={METHOD_COLOR[k]} title={k} rho={meth[k].spearman} />)}</div>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section id="f1" title="F1 · Calibration" sub="10-bin reliability diagram (run level)">
          <Reliability series={["rarc", "generic", "random"].map((k) => ({ key: k, label: k, color: METHOD_COLOR[k], bins: meth[k].calibration }))} />
          <Legend items={["rarc", "generic", "random"].map((k) => ({ label: `${k} (ECE ${f(meth[k].ece, 3)})`, color: METHOD_COLOR[k] }))} />
        </Section>
        <Section id="f2" title="F2 · Test-budget curve (M8.7)" sub="mean AUROC over 100 random subsamples">
          <LineChart xs={r.M8.M8_7.map((x: any) => x.tests_per_agent)} series={["rarc", "generic", "random"].map((k) => ({ key: k, label: k, color: METHOD_COLOR[k], ys: r.M8.M8_7.map((x: any) => x[k]) }))} xLabel="tests per agent" yLabel="AUROC" yMin={0.3} yMax={1} />
          <Legend items={["rarc", "generic", "random"].map((k) => ({ label: k, color: METHOD_COLOR[k] }))} />
        </Section>
      </div>

      <Section id="t5" title="T5 · Ablation: seeded-fault detection (M8.4)" sub={`${r.M8.M8_4.n} faulty agents (5 bug types × working agents); detected = ≥1 new test failure vs. the unfaulted agent`}>
        <GroupedBars groups={[{ label: "all faults", values: Object.fromEntries(["rarc", "generic", "random"].map((k) => [k, { v: r.M8.M8_4[k] }])) }, ...r.M8.M8_4.per_fault.map((x: any) => ({ label: `${x.fault} ${x.name}`, values: Object.fromEntries(["rarc", "generic", "random"].map((k) => [k, { v: x[k] }])) }))]} series={series.slice(0, 3)} fmt={(v) => `${Math.round(v * 100)}%`} />
        <Legend items={series.slice(0, 3)} />
      </Section>

      <Section id="t6" title="T6 · Per-category predictiveness (M7.8) and leave-one-category-out (M8.6)" sub="agent level: fails a T_c certification test → has a real held-out failure tagged T_c">
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>category</th><th className="num">agents flagged</th><th className="num">agents with real T_c failures</th><th className="num">precision</th><th className="num">recall</th><th>failure-discovery rate (M8.3)</th><th>cert pass rate</th><th className="num">ΔAUROC if dropped</th></tr></thead><tbody>
          {m7.per_category.map((x: any, i: number) => <tr key={x.category}><td><b>{x.category}</b> {x.name}</td><td className="num">{x.predicted_agents}</td><td className="num">{x.actual_agents}</td><td className="num">{f(x.precision)}</td><td className="num">{f(x.recall)}</td><td><MiniBar v={r.M8.M8_3[i].rate} /></td><td><MiniBar v={r.M8.M8_3[i].pass_rate} color="var(--series-3)" /></td><td className="num" style={{ color: r.M8.M8_6[i].delta < 0 ? "var(--good)" : "inherit" }}>{f(r.M8.M8_6[i].delta, 3)}</td></tr>)}
        </tbody></table></div>
        <p className="mt-1 text-xs faint">Negative ΔAUROC means dropping the category hurts prediction, so the category contributes. Real failures were tagged by an LLM judge from the provider that did not generate the agent ({r.M9.judges.join(", ")}).</p>
      </Section>

      <Section id="t3" title="T3 · Task completion (M5)" sub="held-out tasks, replay mode, programmatic checkers">
        <div className="grid gap-6 md:grid-cols-2">
          <div><div className="mb-1 text-sm font-medium">Task success rate with 95% CI</div>
            <GroupedBars groups={[["overall", r.M5.M5_1.overall], ["C1 planning", r.M5.M5_1.per_category.C1], ["C2 lookup+compute", r.M5.M5_1.per_category.C2], ["C3 scheduling", r.M5.M5_1.per_category.C3], ["normal tasks", r.M5.M5_1.normal], ["hard tasks", r.M5.M5_1.hard]].map(([l, b]: any) => ({ label: l, values: { tsr: { v: b.tsr, ci: b.ci } } }))} series={[{ key: "tsr", label: "TSR", color: "var(--series-1)" }]} fmt={(v) => `${Math.round(v * 100)}%`} /></div>
          <div><div className="mb-1 text-sm font-medium">By code-generation variant</div>
            <GroupedBars groups={r.M4.per_variant.map((v: any) => ({ label: `${v.variant} ${v.model?.replace("openai/", "")}`, values: { tsr: { v: r.M5.M5_1.per_variant[v.variant].tsr, ci: r.M5.M5_1.per_variant[v.variant].ci } } }))} series={[{ key: "tsr", label: "TSR", color: "var(--series-1)" }]} fmt={(v) => `${Math.round(v * 100)}%`} />
            <div className="tbl-wrap mt-3"><table className="tbl"><tbody>
              <tr><td>M5.2 partial score (mean fraction of checks met)</td><td className="num">{f(r.M5.M5_2)}</td></tr>
              <tr><td>M5.3 tool-call accuracy (attached tool + schema-valid args)</td><td className="num">{P(r.M5.M5_3)}</td></tr>
              <tr><td>M5.4 graceful-failure rate among failures</td><td className="num">{P(r.M5.M5_4)}</td></tr>
              <tr><td>M5.5 run-to-run stability (3 replays) · target ≥ 90%</td><td className="num">{P(r.M5.M5_5)}</td></tr>
              <tr><td>M5.6 mean tool calls / wall time per task</td><td className="num">{f(r.M5.M5_6.tool_calls, 1)} / {Math.round(r.M5.M5_6.wall_ms)} ms</td></tr>
            </tbody></table></div></div>
        </div>
        <div className="mt-4"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>spec</th><th>category</th><th>v1</th><th>v2</th><th>v3</th></tr></thead><tbody>
          {r.M5.per_spec.map((s: any) => <tr key={s.spec}><td><b>{s.spec}</b> {s.title}</td><td>{s.category}</td>{["v1", "v2", "v3"].map((v) => <td key={v}><MiniBar v={s[v]} /></td>)}</tr>)}
        </tbody></table></div></div>
        <div className="mt-2 text-xs faint">Outcome distribution: {r.M5.error_codes.map(([k, n]: any) => `${k} ${n}`).join(" · ")}</div>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section id="t2" title="T2 · Tool retrieval (M2)" sub={`${r.M2.n} specs, k = 5, graded relevance`}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>metric</th><th className="num">sim + re-rank</th><th className="num">similarity only</th></tr></thead><tbody>
            {[["hit-rate@5 (M2.1, gate ≥ 0.90)", "hit_rate_at5"], ["P@3", "p_at3"], ["R@3", "r_at3"], ["P@5", "p_at5"], ["R@5", "r_at5"], ["MRR (M2.3)", "mrr"], ["nDCG@5 (M2.4)", "ndcg_at5"]].map(([l, k]) => <tr key={k}><td>{l}</td><td className="num">{f(r.M2.rerank[k], 3)}</td><td className="num">{f(r.M2.similarity_only[k], 3)}</td></tr>)}
            <tr><td>re-rank lift (ΔnDCG@5)</td><td className="num" colSpan={2}>{f(r.M2.rerank_lift_ndcg, 3)}</td></tr>
            <tr><td>M2.5 reproducibility (Jaccard, 3 runs) — with response cache / cache disabled</td><td className="num" colSpan={2}>{f(r.M2.M2_5_with_cache, 2)} / {f(r.M2.M2_5_cache_disabled, 3)}</td></tr>
          </tbody></table></div>
        </Section>
        <Section id="m1" title="Spec intake (M1) · wrappers (M3) · code generation (M4)">
          <div className="tbl-wrap"><table className="tbl"><tbody>
            <tr><td>M1.1 category accuracy (≥ 90%)</td><td className="num">{P(r.M1.M1_1)}</td></tr>
            <tr><td>M1.2 capability micro-F1 (≥ 0.80)</td><td className="num">{f(r.M1.M1_2, 3)}</td></tr>
            <tr><td>M1.3 clarification precision / recall (≥ 0.7)</td><td className="num">{f(r.M1.M1_3.precision)} / {f(r.M1.M1_3.recall)}</td></tr>
            <tr><td>M1.4 intake latency p50 / p95 (p95 ≤ 5 s)</td><td className="num">{f(r.M1.M1_4.p50)} / {f(r.M1.M1_4.p95)} s</td></tr>
            <tr><td>M3.1 wrapper validity (gate 2/2)</td><td className="num">{r.M3.M3_1.valid}/{r.M3.M3_1.attempted}</td></tr>
            <tr><td>M3.3 mean repairs until valid</td><td className="num">{f(r.M3.M3_3)}</td></tr>
            <tr><td>M3.4 tasks using a synthesized tool that succeed</td><td className="num">{P(r.M3.M3_4)} <span className="faint">(n={r.M3.M3_4_n})</span></td></tr>
            <tr><td>M4.1 contract conformance (final / first attempt)</td><td className="num">{P(r.M4.M4_1)} / {P(r.M4.M4_1_first_attempt)}</td></tr>
            <tr><td>M4.2 load success</td><td className="num">{P(r.M4.M4_2)}</td></tr>
            <tr><td>M4.3 specs with ≥1 nominal task solved (gate 100%)</td><td className="num">{r.M4.M4_3.specs}/{r.M4.M4_3.of}</td></tr>
            <tr><td>M4.4 pass@1 / pass@3 (nominal task)</td><td className="num">{f(r.M4.M4_4.pass_at_1)} / {f(r.M4.M4_4.pass_at_3)}</td></tr>
            <tr><td>M4.5 error-handling presence (static + fault injection)</td><td className="num">{P(r.M4.M4_5)}</td></tr>
            <tr><td>M4.6 generations needing ≥1 repair</td><td className="num">{P(r.M4.M4_6)}</td></tr>
            <tr><td>M4.7 spec-specificity: 3-gram distance within / between specs</td><td className="num">{f(r.M4.M4_7.within_spec, 3)} / {f(r.M4.M4_7.between_spec, 3)}</td></tr>
          </tbody></table></div>
        </Section>
      </div>

      <Section id="t7" title="T7 · Sandbox safety (M6)" sub={`${r.M6.n_attacks} hostile programs through the full path, and again with the static check disabled (runtime layer only)`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="M6.1 escapes" value={String(r.M6.M6_1)} sub={`runtime-only: ${r.M6.M6_1_runtime_only}`} />
          <Stat label="M6.2 blocked as intended" value={`${r.M6.M6_2.reduce((a: number, c: any) => a + c.blocked, 0)}/${r.M6.n_attacks}`} />
          <Stat label="M6.3 error mapping" value={`${r.M6.M6_3.ok}/${r.M6.M6_3.n}`} />
          <Stat label="M6.4 hangs" value={String(r.M6.M6_4)} sub={`of ${r.M6.M6_4_runs_checked} runs`} />
          <Stat label="M6.5 false kills" value={P(r.M6.M6_5)} sub={`${r.M6.M6_5_n} reference runs`} />
          <Stat label="M6.6 overhead p50" value={`${Math.round(r.M6.M6_6.overhead_ms_p50)} ms`} sub={`bare ${Math.round(r.M6.M6_6.bare_ms_p50)} ms`} />
        </div>
        <div className="mt-3"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>class</th><th>attack</th><th>error code</th><th>intended</th><th className="num">ms</th><th>runtime-only</th><th>result</th></tr></thead><tbody>
          {r.M6.attacks.map((a: any) => <tr key={a.id}><td>{a.cls}</td><td className="font-mono text-xs">{a.id}</td><td className="font-mono text-xs">{a.error_code ?? "none (blocked inside)"}</td><td className="font-mono text-xs faint">{a.expected.map((x: any) => x ?? "any").join(" | ")}</td><td className="num">{a.ms}</td><td className="font-mono text-xs faint">{a.runtime_only ?? "none"}{a.runtime_only_escaped ? " ESCAPED" : ""}</td><td>{a.escaped ? <span className="badge badge-bad">escaped</span> : a.ok ? <span className="badge badge-good"><Check size={12} />blocked</span> : <span className="badge badge-warn">blocked, other code</span>}</td></tr>)}
        </tbody></table></div></div>
      </Section>

      <Section id="t8" title="T8 · Performance & cost (M10)">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>stage (M10.1)</th><th className="num">p50 s</th><th className="num">p95 s</th></tr></thead><tbody>{r.M10.M10_1.map((x: any) => <tr key={x.stage}><td>{x.stage}</td><td className="num">{f(x.p50)}</td><td className="num">{f(x.p95)}</td></tr>)}</tbody></table></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>provider (M10.4)</th><th className="num">calls</th><th className="num">retries</th><th className="num">errors</th><th className="num">fallbacks</th><th className="num">cache hits</th><th className="num">p50 s</th></tr></thead><tbody>{r.M10.M10_4.map((x: any) => <tr key={x.provider}><td>{x.provider}</td><td className="num">{x.calls}</td><td className="num">{x.retries}</td><td className="num">{x.errors}</td><td className="num">{x.fallback_used}</td><td className="num">{x.cache_hits}</td><td className="num">{f(x.p50_latency_s)}</td></tr>)}</tbody></table></div>
        </div>
        <div className="tbl-wrap mt-3"><table className="tbl"><thead><tr><th>stage (M10.3)</th><th className="num">calls</th><th className="num">live</th><th className="num">tokens in</th><th className="num">tokens out</th><th>models</th></tr></thead><tbody>{r.M10.M10_3.map((x: any) => <tr key={x.stage}><td>{x.stage}</td><td className="num">{x.calls}</td><td className="num">{x.live_calls}</td><td className="num">{x.tokens_in.toLocaleString()}</td><td className="num">{x.tokens_out.toLocaleString()}</td><td className="text-xs faint">{x.providers.join(", ")}</td></tr>)}</tbody></table></div>
      </Section>

      <Section id="m8" title="Test generator quality (M8) & failure tagging (M9)">
        <div className="tbl-wrap"><table className="tbl"><tbody>
          <tr><td>M8.1 taxonomy coverage: (spec × category) cells with ≥ 3 valid tests (gate 100%)</td><td className="num">{P(r.M8.M8_1)} <span className="faint">(≥1: {P(r.M8.M8_1_at_least_1)}, {r.M8.cells} cells)</span></td></tr>
          <tr><td>M8.2 test validity — rarc / generic (≥ 90%)</td><td className="num">{P(r.M8.M8_2.rarc)} / {P(r.M8.M8_2.generic)}</td></tr>
          <tr><td>M8.5 duplicate rate (≤ 10%)</td><td className="num">{P(r.M8.M8_5)}</td></tr>
          <tr><td>Leakage audit: generator prompts containing held-out task text</td><td className="num">{r.M8.leakage_audit.leaked} of {r.M8.leakage_audit.prompts_checked} prompts</td></tr>
          <tr><td>M9.1 failures with exactly one primary tag</td><td className="num">{P(r.M9.M9_1)} <span className="faint">({r.M9.n_failures} failures)</span></td></tr>
          <tr><td>M9.2 tagged "Other" (≤ 15%)</td><td className="num">{P(r.M9.M9_2)}</td></tr>
          <tr><td>M9.3 / M9.4 auto-tag vs. human κ, inter-annotator κ</td><td className="num faint">pending human annotation</td></tr>
        </tbody></table></div>
        <div className="mt-2 text-xs faint">Primary tag distribution: {r.M9.distribution.map(([k, n]: any) => `${k} ${n}`).join(" · ")}</div>
      </Section>
    </div>
  );
}
