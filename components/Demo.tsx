"use client";
import { useMemo, useRef, useState } from "react";
import { PILOT, INTAKE_EXTRA } from "@/lib/specs";
import tasksFile from "@/data/tasks.json";
import { MiniBar, METHOD_COLOR, METHOD_LABEL } from "./charts";
import { Alert, Check, Chevron, Code, FileText, Flag, Loader, Play, Plug, Search, Shield, Sparkles, StatusIcon, Terminal, X } from "./icons";

const TASKS: any[] = (tasksFile as any).tasks;
const TAX: Record<string, string> = { T1: "Ambiguous / under-specified input", T2: "Tool-call failure handling", T3: "Empty or null results", T4: "Schema drift", T5: "Constraint violation", T6: "Hallucinated tool / argument", T7: "Resource abuse / looping", T8: "Output-format violation" };
const VARIANTS = [{ id: "v1", label: "v1 · Groq gpt-oss-120b · robust prompt" }, { id: "v2", label: "v2 · Gemini 3.5 Flash-Lite · concise, T=0.9" }, { id: "v3", label: "v3 · Groq gpt-oss-20b · fast tier" }];

async function post(url: string, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}
async function stream(url: string, body: any, on: (ev: any) => void) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.body) throw new Error("no stream");
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) on(JSON.parse(line)); }
  }
}

type St = "idle" | "running" | "done" | "error" | "skipped";
interface Stage { st: St; ms?: number; data?: any; calls?: any[]; err?: string }
const empty: Stage = { st: "idle" };

function Calls({ calls }: { calls?: any[] }) {
  const [open, setOpen] = useState(false);
  if (!calls?.length) return null;
  const tokens = calls.reduce((a, c) => a + (c.tokens_in || 0) + (c.tokens_out || 0), 0);
  return (
    <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--grid)" }}>
      <button className="inline-flex items-center gap-1 text-xs faint hover:text-[var(--text-primary)]" onClick={() => setOpen(!open)}>
        <Chevron size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
        {calls.length} LLM call{calls.length > 1 ? "s" : ""} · {Math.round(tokens).toLocaleString()} tokens · {calls.filter((c) => c.cache_hit).length} cached
      </button>
      {open && <div className="mt-2 flex flex-wrap gap-1.5">{calls.map((c, i) => <span key={i} className="chip" title={`prompt ${c.prompt_hash}`}>{c.stage} · {c.model_id} · {c.cache_hit ? "cache hit" : `${(c.latency_ms / 1000).toFixed(1)}s`}{c.fallback_used ? " · fallback" : ""}{c.error ? " · error" : ""}</span>)}</div>}
    </div>
  );
}

const STATE_BADGE: Record<St, { cls: string; label: string }> = {
  idle: { cls: "badge-neutral", label: "waiting" }, running: { cls: "badge-warn", label: "running" }, done: { cls: "badge-good", label: "done" }, error: { cls: "badge-bad", label: "failed" }, skipped: { cls: "badge-neutral", label: "not needed" },
};

function StageCard({ n, title, icon: I, stage, children, sub, last }: { n: number; title: string; icon: any; stage: Stage; children?: React.ReactNode; sub?: string; last?: boolean }) {
  const ring = { idle: "var(--border-strong)", running: "var(--warn)", done: "var(--good)", error: "var(--bad)", skipped: "var(--border-strong)" }[stage.st];
  const b = STATE_BADGE[stage.st];
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-white" style={{ borderColor: ring, color: stage.st === "idle" || stage.st === "skipped" ? "var(--text-muted)" : ring }}>
          {stage.st === "running" ? <Loader size={16} /> : stage.st === "done" ? <Check size={16} /> : stage.st === "error" ? <X size={16} /> : <I size={16} />}
        </div>
        {!last && <div className="w-px flex-1" style={{ background: stage.st === "done" ? "var(--good)" : "var(--border)", opacity: stage.st === "done" ? 0.4 : 1 }} />}
      </div>
      <div className={`card card-hover mb-4 flex-1 p-5 ${stage.st === "idle" ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-semibold faint">STEP {n}</span>
          <h3 className="section-title">{title}</h3>
          <span className={`badge ${b.cls} ml-auto`}>{b.label}{stage.st === "done" && stage.ms !== undefined ? ` · ${(stage.ms / 1000).toFixed(1)}s` : ""}</span>
        </div>
        {sub && <div className="mt-0.5 text-xs faint">{sub}</div>}
        {stage.err && <div className="mt-3 flex items-start gap-2 rounded-lg p-3 text-sm badge-bad" style={{ borderRadius: 10 }}><Alert size={16} /><span>{stage.err}</span></div>}
        {children && <div className="mt-4">{children}</div>}
        <Calls calls={stage.calls} />
      </div>
    </div>
  );
}

export default function Demo() {
  const presets = useMemo(() => [
    ...PILOT.map((p) => ({ id: p.id, label: `${p.id} · ${p.title} (${p.category})`, text: p.text, pilot: true })),
    ...INTAKE_EXTRA.filter((x) => ["X03", "X04", "X01", "A01", "A03"].includes(x.id)).map((x) => ({ id: x.id, label: `${x.id} · ${x.ambiguous ? "Ambiguous spec" : "Custom spec"}${x.category ? ` (${x.category})` : ""}`, text: x.text, pilot: false })),
  ], []);
  const [presetId, setPresetId] = useState("P01");
  const [text, setText] = useState(PILOT[0].text);
  const [variant, setVariant] = useState("v1");
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [baselines, setBaselines] = useState(false);
  const [S, setS] = useState<Record<string, Stage>>({ intake: empty, retrieval: empty, synth: empty, codegen: empty, cert: empty });
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<string | null>(null);
  const [agent, setAgent] = useState<any>(null);
  const [showCode, setShowCode] = useState(false);
  const [certs, setCerts] = useState<Record<string, any>>({});
  const [tests, setTests] = useState<Record<string, any[]>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Record<string, any>>>({});
  const [certTab, setCertTab] = useState("rarc");
  const ctx = useRef<any>({});

  const preset = presets.find((p) => p.id === presetId);
  const pilot = preset?.pilot && text === preset.text ? PILOT.find((p) => p.id === presetId) : undefined;
  const set = (k: string, v: Partial<Stage>) => setS((s) => ({ ...s, [k]: { ...s[k], ...v } }));

  async function assemble(skipClarify = false) {
    setBusy(true); setAgent(null); setCerts({}); setTests({}); setOutcomes({}); setClarify(null); setCertTab("rarc");
    setS({ intake: { st: "running" }, retrieval: empty, synth: empty, codegen: empty, cert: empty });
    try {
      let t0 = Date.now();
      const ir = await post("/api/intake", { text });
      set("intake", { st: "done", ms: Date.now() - t0, data: ir.intake, calls: ir.calls });
      if (ir.intake.needs_clarification && !skipClarify && !pilot) { setClarify(ir.intake.clarifying_question ?? "Can you say more about what the agent should do?"); setBusy(false); return; }
      t0 = Date.now(); set("retrieval", { st: "running" });
      const rr = await post("/api/retrieve", { text, intake: ir.intake });
      set("retrieval", { st: "done", ms: Date.now() - t0, data: rr.retrieval, calls: rr.calls });
      const wrappers: any[] = [];
      if (rr.retrieval.synth_candidates.length) {
        t0 = Date.now(); set("synth", { st: "running" });
        const results: any[] = [], calls: any[] = [];
        for (const c of rr.retrieval.synth_candidates) { const w = await post("/api/synthesize", { api_id: c.api_id, mode }); results.push(w); calls.push(...w.calls); if (w.valid) wrappers.push(w.wrapper); }
        set("synth", { st: "done", ms: Date.now() - t0, data: results, calls });
      } else set("synth", { st: "skipped" });
      const spec = pilot ? { pilot_id: pilot.id, id: pilot.id, text: pilot.text, category: pilot.category, input_schema: pilot.input_schema } : { id: "custom", text, category: ir.intake.task_category, input_schema: ir.intake.input_fields };
      ctx.current = { spec, wrappers };
      t0 = Date.now(); set("codegen", { st: "running" });
      const g = await post("/api/generate", { spec, tools: rr.retrieval.selected, wrappers, variant });
      set("codegen", { st: g.agent.ok ? "done" : "error", ms: Date.now() - t0, data: g.agent, calls: g.calls, err: g.agent.ok ? undefined : "Agent failed the contract check after repairs: " + g.agent.contract.violations.join("; ") });
      setAgent(g.agent);
      if (!g.agent.ok) { setBusy(false); return; }
      await certify(g.agent, spec);
    } catch (e: any) {
      setS((s) => { const k = Object.keys(s).find((k) => s[k].st === "running") ?? "intake"; return { ...s, [k]: { ...s[k], st: "error", err: e.message } }; });
    }
    setBusy(false);
  }

  async function certify(a: any, spec: any) {
    const t0 = Date.now(); set("cert", { st: "running" });
    const calls: any[] = [];
    await stream("/api/certify", { agent: a, spec, methods: baselines ? ["rarc", "generic", "random"] : ["rarc"] }, (ev) => {
      if (ev.type === "tests") { setTests((t) => ({ ...t, [ev.method]: ev.tests })); calls.push(...ev.calls); }
      if (ev.type === "outcome") setOutcomes((o) => ({ ...o, [ev.method]: { ...(o[ev.method] ?? {}), [ev.outcome.test_id]: ev.outcome } }));
      if (ev.type === "certificate") setCerts((c) => ({ ...c, [ev.method]: ev.certificate }));
      if (ev.type === "error") set("cert", { st: "error", err: ev.error });
    });
    set("cert", { st: "done", ms: Date.now() - t0, calls });
  }

  const rarc = certs.rarc;
  const scoreColor = (s: number) => (s >= 0.9 ? "var(--good)" : s >= 0.7 ? "var(--warn)" : "var(--bad)");
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="card mb-6 p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <div className="flex items-center gap-2"><Sparkles size={18} style={{ color: "var(--accent)" }} /><h2 className="section-title">Describe the agent you need</h2></div>
          <div className="mt-4">
            <label className="field-label" htmlFor="preset">Start from an example</label>
            <select id="preset" className="w-full" value={presetId} onChange={(e) => { setPresetId(e.target.value); setText(presets.find((p) => p.id === e.target.value)!.text); }}>
              <optgroup label="Pilot benchmark specs (with ground-truth tasks)">{presets.filter((p) => p.pilot).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
              <optgroup label="Custom / ambiguous specs">{presets.filter((p) => !p.pilot).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            </select>
          </div>
          <div className="mt-4">
            <label className="field-label" htmlFor="spec">Agent spec</label>
            <textarea id="spec" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><label className="field-label" htmlFor="variant">Code-generation model</label><select id="variant" className="w-full" value={variant} onChange={(e) => setVariant(e.target.value)}>{VARIANTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></div>
            <div><label className="field-label" htmlFor="mode">Tool data</label><select id="mode" className="w-full" value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="replay">Replay: recorded, reproducible</option><option value="live">Live public APIs</option></select></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm muted"><input type="checkbox" checked={baselines} onChange={(e) => setBaselines(e.target.checked)} /> Also run baseline certifications</label>
            <button className="btn btn-primary ml-auto px-5" disabled={busy || !text.trim()} onClick={() => assemble()}>{busy ? <><Loader size={16} /> Assembling…</> : <><Play size={14} /> Assemble &amp; certify</>}</button>
          </div>
          <p className="mt-4 rounded-lg px-3 py-2 text-xs muted panel-sunken">{pilot ? `Pilot spec ${pilot.id}: benchmark tasks with ground truth are available after assembly. Pilot specs are mostly served from the evaluation's LLM cache, so you see the logged run quickly.` : "Custom spec: intake decides the category and task inputs. Tasks are free-form, with no ground-truth checker."}</p>
        </div>

        {clarify && <div className="card mb-6 p-5 fade-in" style={{ borderColor: "#f3d19c", background: "var(--warn-soft)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--warn)" }}><Alert size={16} /> Intake needs one clarification</div>
          <p className="mt-2 text-[15px]">{clarify}</p>
          <p className="mt-1 text-xs muted">Answer it by editing the spec above and assembling again, or continue with the current reading.</p>
          <button className="btn btn-sm mt-3" onClick={() => assemble(true)}>Proceed anyway</button>
        </div>}

        <StageCard n={1} title="Spec intake" icon={FileText} stage={S.intake} sub="Structured intermediate spec · asks one question when the spec is vague">
          {S.intake.data && <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2"><span className="badge badge-accent">Category {S.intake.data.task_category}</span><span className="badge badge-neutral">confidence {S.intake.data.confidence.toFixed(2)}</span></div>
            <div><div className="field-label">Required capabilities</div><div className="flex flex-wrap gap-1.5">{S.intake.data.required_capabilities.map((c: string) => <span key={c} className="chip">{c}</span>)}</div></div>
            {!!S.intake.data.constraints.length && <div><div className="field-label">Constraints</div><ul className="list-disc space-y-0.5 pl-5 text-[13px] muted">{S.intake.data.constraints.map((c: string) => <li key={c}>{c}</li>)}</ul></div>}
          </div>}
        </StageCard>

        <StageCard n={2} title="Tool retrieval" icon={Search} stage={S.retrieval} sub="Embedding similarity, then LLM re-rank with a one-line justification">
          {S.retrieval.data && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Tool</th><th className="num">Cosine</th><th>Why</th></tr></thead><tbody>
            {S.retrieval.data.ranked.slice(0, 7).map((r: any) => <tr key={r.tool} style={{ opacity: r.relevant || S.retrieval.data.selected.includes(r.tool) ? 1 : 0.5 }}>
              <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5 font-mono text-xs">{S.retrieval.data.selected.includes(r.tool) ? <Check size={13} style={{ color: "var(--good)" }} /> : <span className="inline-block w-[13px]" />}{r.tool}</span></td>
              <td className="num text-xs">{r.similarity.toFixed(3)}</td><td className="text-xs muted">{r.why}</td></tr>)}
          </tbody></table></div>}
          {S.retrieval.data?.coverage_gaps?.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs muted">No library tool covers {S.retrieval.data.coverage_gaps.map((g: string) => <span key={g} className="badge badge-warn">{g}</span>)}, so it goes to wrapper synthesis</div>}
        </StageCard>

        <StageCard n={3} title="API wrapper synthesis" icon={Plug} stage={S.synth} sub="OpenAPI → MCP tool · the example call must pass validation">
          {Array.isArray(S.synth.data) && <div className="space-y-3">{S.synth.data.map((w: any) => <div key={w.api_id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="badge badge-accent"><Sparkles size={12} /> synthesized</span><b className="font-mono text-[13px]">{w.target.name}</b><span className="muted">from {w.title}</span>
              <span className={`badge ml-auto ${w.valid ? "badge-good" : "badge-bad"}`}>{w.valid ? `valid · ${w.repairs} repair${w.repairs === 1 ? "" : "s"}` : "rejected"}</span></div>
            {w.attempts.map((a: any) => <div key={a.attempt} className="mt-1.5 break-all font-mono text-[11px] faint">#{a.attempt} {a.url} → {a.ok ? JSON.stringify(a.output).slice(0, 140) : a.error}</div>)}
          </div>)}</div>}
        </StageCard>

        <StageCard n={4} title="Code generation" icon={Code} stage={S.codegen} sub="Contract check → load test → up to 2 repairs" last>
          {S.codegen.data && <div className="text-sm">
            <div className="flex flex-wrap gap-1.5">
              <span className="chip">{S.codegen.data.model_id}</span><span className="chip font-mono">#{S.codegen.data.code_hash}</span><span className="chip">{S.codegen.data.code.split("\n").length} lines</span><span className="chip">{S.codegen.data.repairs} repairs</span>
              <span className={`badge ${S.codegen.data.contract.ok ? "badge-good" : "badge-bad"}`}><StatusIcon ok={S.codegen.data.contract.ok} size={12} /> contract</span>
              <span className={`badge ${S.codegen.data.contract.has_try_catch ? "badge-good" : "badge-neutral"}`}><StatusIcon ok={S.codegen.data.contract.has_try_catch} size={12} /> error handling</span>
              <span className={`badge ${S.codegen.data.contract.has_empty_check ? "badge-good" : "badge-neutral"}`}><StatusIcon ok={S.codegen.data.contract.has_empty_check} size={12} /> empty-result check</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs muted">Attached tools: {[...S.codegen.data.tools, ...S.codegen.data.wrappers.map((w: any) => w.tool.name + "*")].map((t: string) => <span key={t} className="chip font-mono">{t}</span>)}</div>
            <button className="btn btn-sm mt-3" onClick={() => setShowCode(!showCode)}><Code size={14} /> {showCode ? "Hide" : "View"} generated code</button>
            {showCode && <pre className="code mt-3 max-h-[28rem]">{S.codegen.data.code}</pre>}
          </div>}
        </StageCard>
      </div>

      <div className="space-y-6 xl:sticky xl:top-20">
        <div className="card p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <div className="flex items-center gap-2"><Shield size={18} style={{ color: "var(--accent)" }} /><h2 className="section-title">Reliability certificate</h2>
            <span className={`badge ml-auto ${STATE_BADGE[S.cert.st].cls}`}>{S.cert.st === "running" && <Loader size={12} />}{STATE_BADGE[S.cert.st].label}{S.cert.st === "done" && S.cert.ms ? ` · ${(S.cert.ms / 1000).toFixed(1)}s` : ""}</span></div>
          <p className="mt-1 text-xs faint">Taxonomy-driven adversarial tests run in the same sandbox and tool path as real tasks. Faults are injected by the tool client.</p>
          {S.cert.err && <div className="mt-3 flex items-start gap-2 rounded-lg p-3 text-sm badge-bad"><Alert size={16} />{S.cert.err}</div>}
          {!rarc && S.cert.st !== "running" && <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center" style={{ borderColor: "var(--border-strong)" }}>
            <Shield size={28} style={{ color: "var(--text-muted)" }} /><div className="mt-2 text-sm font-medium">No certificate yet</div><div className="text-xs faint">Assemble an agent to generate and run its tests.</div></div>}
          {!rarc && S.cert.st === "running" && <div className="mt-6 flex items-center gap-2 text-sm muted"><Loader size={16} /> Generating tests and running them in the sandbox…</div>}
          {rarc && <div className="fade-in">
            <div className="mt-5 flex flex-wrap items-end gap-6">
              <div><div className="text-xs faint">RARC score</div><div className="text-5xl font-semibold tabular-nums tracking-tight" style={{ color: scoreColor(rarc.score) }}>{rarc.score.toFixed(2)}</div></div>
              {["generic", "random"].filter((m) => certs[m]).map((m) => <div key={m}><div className="text-xs faint">{m}</div><div className="text-2xl font-medium tabular-nums muted">{certs[m].score.toFixed(2)}</div></div>)}
              <span className="badge badge-neutral ml-auto">based on {rarc.basis}</span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(TAX).map(([k, n]) => <div key={k} className="flex items-center justify-between gap-2 text-[13px]"><span className="truncate"><span className="font-mono text-xs faint">{k}</span> {n}</span><MiniBar v={rarc.per_category[k]?.rate ?? null} w={70} color={rarc.per_category[k]?.rate < 1 ? "var(--warn)" : "var(--good)"} /></div>)}
            </div>
            {rarc.weakest.length > 0 && <div className="mt-5 rounded-xl p-4" style={{ background: "var(--warn-soft)" }}><div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--warn)" }}><Alert size={14} /> Weakest areas</div><ul className="mt-1.5 space-y-1 text-[13px]">{rarc.weakest.map((w: any) => <li key={w.category}><b>{w.name}</b>: {w.sentence}</li>)}</ul></div>}
          </div>}
          {Object.keys(tests).length > 0 && <div className="mt-6">
            <div className="seg">{Object.keys(tests).map((m) => <button key={m} aria-selected={certTab === m} onClick={() => setCertTab(m)}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METHOD_COLOR[m] }} />{m} <span className="faint">{Object.values(outcomes[m] ?? {}).filter((o: any) => o.pass).length}/{tests[m].length}</span></button>)}</div>
            <div className="tbl-wrap mt-3 max-h-[26rem]"><table className="tbl"><thead><tr><th>Test</th><th>Injected</th><th>Expects</th><th>Result</th></tr></thead><tbody>
              {(tests[certTab] ?? []).map((t: any) => { const o = outcomes[certTab]?.[t.id]; return <tr key={t.id}>
                <td className="text-xs"><span className="badge badge-neutral mr-1">{t.category}</span>{t.title}<div className="mt-1 break-all font-mono text-[11px] faint">{JSON.stringify(t.inputs).slice(0, 110)}</div></td>
                <td className="font-mono text-[11px]">{t.injected_conditions.map((c: any) => <div key={c.tool + c.fault}>{c.fault}@{c.tool}</div>)}{!t.injected_conditions.length && <span className="faint">none</span>}</td>
                <td className="text-xs">{t.expected_property.type}{t.expected_property.statuses ? <div className="faint">{t.expected_property.statuses.join(" | ")}</div> : null}{t.expected_property.n ? ` ≤ ${t.expected_property.n}` : ""}</td>
                <td className="text-xs">{o ? <span className={`badge ${o.pass ? "badge-good" : "badge-bad"}`}><StatusIcon ok={o.pass} size={12} />{o.pass ? "pass" : "fail"}</span> : <Loader size={14} />}<div className="mt-1 faint">{o?.why}</div></td>
              </tr>; })}
            </tbody></table></div>
            <p className="mt-2 text-xs faint">{METHOD_LABEL[certTab]}</p>
          </div>}
          <Calls calls={S.cert.calls} />
        </div>
        {agent?.ok && <TaskPanel agent={agent} spec={ctx.current.spec} pilotId={pilot?.id} mode={mode} certScore={rarc?.score} />}
      </div>
    </div>
  );
}

function TaskPanel({ agent, spec, pilotId, mode, certScore }: { agent: any; spec: any; pilotId?: string; mode: "replay" | "live"; certScore?: number }) {
  const tasks = pilotId ? TASKS.filter((t) => t.spec_id === pilotId) : [];
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [free, setFree] = useState("");
  const [inputs, setInputs] = useState<string>(tasks[0] ? JSON.stringify(tasks[0].inputs, null, 1) : "{}");
  const [confirmed, setConfirmed] = useState(false);
  const [steps, setSteps] = useState<any[]>([]);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [flagged, setFlagged] = useState(false);
  const useDataset = !!pilotId && !!taskId && mode === "replay";

  async function parse() {
    setBusy(true);
    try { const r = await post("/api/parse-task", { text: free, schema: spec.input_schema }); setInputs(JSON.stringify(r.inputs, null, 1)); setTaskId(""); } catch (e: any) { alert(e.message); }
    setBusy(false);
  }
  async function runTask() {
    setBusy(true); setSteps([]); setRes(null); setFlagged(false);
    let parsed: any = {};
    try { parsed = JSON.parse(inputs); } catch { alert("Inputs must be valid JSON"); setBusy(false); return; }
    const body = { agent: { code: agent.code, tools: agent.tools, wrappers: agent.wrappers }, spec, mode, confirmed, ...(useDataset ? { task_id: taskId } : { inputs: parsed, text: free }) };
    await stream("/api/execute", body, (ev) => {
      if (ev.type === "step") setSteps((s) => [...s, ev.step]);
      if (ev.type === "result") {
        setRes(ev);
        const rec = { run_id: Math.random().toString(36).slice(2, 10), timestamp: new Date().toISOString(), run_type: "real_task", spec_id: spec.id, task_id: useDataset ? taskId : null, agent_id: `${spec.id}-${agent.variant}`, code_hash: agent.code_hash, mode, cert_score_at_run_time: certScore ?? null, status: ev.run.status, error_code: ev.run.error_code, checker_result: ev.check && { success: ev.check.success, partial_score: ev.check.partial_score }, tool_calls: ev.stats.calls, duration_ms: ev.run.duration_ms, inputs: useDataset ? null : parsed };
        try { const L = JSON.parse(localStorage.getItem("rarc-runs") ?? "[]"); L.unshift(rec); localStorage.setItem("rarc-runs", JSON.stringify(L.slice(0, 200))); localStorage.setItem("rarc-last", rec.run_id); } catch {}
      }
      if (ev.type === "error") setRes({ error: ev.error });
    });
    setBusy(false);
  }
  function flag() {
    try { const L = JSON.parse(localStorage.getItem("rarc-runs") ?? "[]"); const id = localStorage.getItem("rarc-last"); const r = L.find((x: any) => x.run_id === id); if (r) { r.flagged = true; r.flag_note = flagNote; r.trace = steps; } localStorage.setItem("rarc-runs", JSON.stringify(L)); setFlagged(true); } catch {}
  }
  const task = tasks.find((t) => t.id === taskId);
  return (
    <div className="card fade-in p-6" style={{ boxShadow: "var(--shadow-md)" }}>
      <div className="flex items-center gap-2"><Terminal size={18} style={{ color: "var(--accent)" }} /><h2 className="section-title">Run a real task</h2><span className="ml-auto text-xs faint">Live trace from the sandbox</span></div>
      {tasks.length > 0 && <div className="mt-4"><label className="field-label" htmlFor="task">Benchmark task</label><select id="task" className="w-full" value={taskId} onChange={(e) => { setTaskId(e.target.value); const t = tasks.find((t) => t.id === e.target.value); if (t) setInputs(JSON.stringify(t.inputs, null, 1)); }}>
        <option value="">Custom inputs</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.id} [{t.split}{t.hard ? ", hard" : ""}] {t.text}</option>)}
      </select>{task?.hard_reason && <div className="mt-2"><span className="badge badge-warn"><Alert size={12} /> Hard case: {task.hard_reason}</span></div>}</div>}
      <div className="mt-4"><label className="field-label" htmlFor="free">Or describe a task in plain English</label><div className="flex gap-2"><input id="free" type="text" className="flex-1" placeholder="e.g. 2 nights in Jaipur under ₹9,000" value={free} onChange={(e) => setFree(e.target.value)} /><button className="btn" disabled={busy || !free.trim()} onClick={parse}>Parse</button></div></div>
      <div className="mt-4"><label className="field-label" htmlFor="inputs">Task inputs (JSON)</label><textarea id="inputs" className="w-full font-mono text-xs" rows={4} value={inputs} onChange={(e) => { setInputs(e.target.value); setTaskId(""); }} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 text-sm muted"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm side effects (bookings, invites)</label><button className="btn btn-primary ml-auto px-5" disabled={busy} onClick={runTask}>{busy ? <><Loader size={16} /> Running…</> : <><Play size={14} /> Run task</>}</button></div>

      {steps.length > 0 && <div className="mt-5 rounded-xl p-3 panel-sunken"><div className="field-label">Tool calls</div><div className="space-y-1">{steps.map((s) => <div key={s.i} className="fade-in flex items-center gap-2.5 rounded-md bg-white px-2.5 py-1.5 font-mono text-xs shadow-[var(--shadow-sm)]"><span className="w-4 faint">{s.i + 1}</span><StatusIcon ok={s.ok} size={13} /><span className="font-semibold">{s.tool}{s.synthesized ? "*" : ""}</span><span className="truncate faint">{JSON.stringify(s.args)}</span>{s.error && <span className="badge badge-bad">{s.error.code}</span>}<span className="ml-auto shrink-0 faint">{s.ms} ms</span></div>)}</div></div>}

      {res?.run && <div className="fade-in mt-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${res.run.error_code ? "badge-bad" : res.run.status === "success" ? "badge-good" : "badge-warn"}`}>{res.run.error_code ?? res.run.status}</span>
          {res.check && <span className={`badge ${res.check.success ? "badge-good" : "badge-bad"}`}><StatusIcon ok={res.check.success} size={12} /> checker {res.check.success ? "passed" : "failed"} · {Math.round(res.check.partial_score * 100)}%</span>}
          <span className="chip">{res.stats.calls} tool calls</span><span className="chip">{res.run.duration_ms} ms</span><span className="chip">today = {res.now}</span>
        </div>
        {res.run.error_message && <div className="mt-2 text-xs" style={{ color: "var(--bad)" }}>{res.run.error_message}</div>}
        {res.run.answer && <pre className="code mt-3 max-h-56">{JSON.stringify(res.run.answer, null, 2)}</pre>}
        {res.run.raw?.success_indicators && Object.keys(res.run.raw.success_indicators).length > 0 && <div className="mt-2 text-xs faint">Indicators: {JSON.stringify(res.run.raw.success_indicators).slice(0, 300)}</div>}
        {res.check && <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><div className="field-label">Checker</div><ul className="space-y-1 text-[13px]">{res.check.checks.map((c: any) => <li key={c.name} className="flex items-start gap-2"><span className="mt-0.5"><StatusIcon ok={c.ok} size={13} /></span><span>{c.name}{c.detail ? <span className="faint"> ({c.detail})</span> : null}</span></li>)}</ul>
          <div className="mt-2 text-xs faint">Expected {res.check.expected_status}{res.truth?.value !== undefined && res.truth?.value !== null ? ` · truth ${res.truth.value} ${res.truth.unit}` : ""}{res.truth?.earliest ? ` · earliest ${res.truth.earliest}` : ""}{res.truth?.min_cost ? ` · cheapest plan ₹${res.truth.min_cost}` : ""}</div></div>}
        <div className="mt-4 flex gap-2"><input type="text" className="flex-1" aria-label="Flag note" placeholder="Something wrong? Flag this run with a note" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} /><button className="btn" disabled={flagged} onClick={flag}><Flag size={14} /> {flagged ? "Flagged" : "Flag"}</button></div>
      </div>}
      {res?.error && <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: "var(--bad)" }}><Alert size={16} />{res.error}</div>}
    </div>
  );
}
