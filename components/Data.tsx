"use client";
import { useEffect, useMemo, useState } from "react";
import { PILOT, D_INTAKE } from "@/lib/specs";
import tasksFile from "@/data/tasks.json";
import { Check, Download, Flag, Trash, X } from "./icons";

const TASKS: any[] = (tasksFile as any).tasks;
const SUB = ["Benchmark", "Agents", "Run log (eval)", "Session log", "Tool library", "Intake & retrieval sets"];

export default function Data({ results }: { results: any }) {
  const [sub, setSub] = useState(SUB[0]);
  return (
    <div className="space-y-6">
      <div><div className="eyebrow">Datasets &amp; logs</div><h1 className="mt-1 text-2xl font-semibold tracking-tight">Everything behind the numbers</h1></div>
      <div className="seg flex-wrap">{SUB.map((s) => <button key={s} aria-selected={sub === s} onClick={() => setSub(s)}>{s}</button>)}</div>
      {sub === "Benchmark" && <Bench />}
      {sub === "Agents" && <Agents results={results} />}
      {sub === "Run log (eval)" && <RunLog />}
      {sub === "Session log" && <Session />}
      {sub === "Tool library" && <Tools />}
      {sub === "Intake & retrieval sets" && <Intake results={results} />}
    </div>
  );
}

function Bench() {
  const [spec, setSpec] = useState("P01");
  const s = PILOT.find((p) => p.id === spec)!;
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">D-Pilot / D-Tasks</h2><span className="text-xs faint">dataset hash {(tasksFile as any).hash} · {TASKS.length} tasks</span>
        <select className="ml-auto" value={spec} onChange={(e) => setSpec(e.target.value)}>{PILOT.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.title}</option>)}</select></div>
      <p className="mt-2 text-sm">{s.text}</p>
      <div className="mt-1 text-xs faint">inputs: {s.input_schema.map((f) => `${f.name}:${f.type}`).join(", ")} · gold tools: {s.gold_tools.required.join(", ")} · gold capabilities: {s.gold_capabilities.join(", ")}</div>
      <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>task</th><th>split</th><th>text</th><th>hard case</th><th>ground truth</th></tr></thead><tbody>
        {TASKS.filter((t) => t.spec_id === spec).map((t) => <tr key={t.id}><td className="font-mono text-xs">{t.id}</td><td>{t.split}</td><td>{t.text}</td><td className="text-xs" style={{ color: "var(--warn)" }}>{t.hard_reason ?? ""}</td><td className="font-mono text-xs">{t.truth.expected_status}{t.truth.value !== undefined && t.truth.value !== null ? ` · ${t.truth.value} ${t.truth.unit}` : ""}{t.truth.min_cost ? ` · min ₹${t.truth.min_cost}` : ""}{t.truth.earliest ? ` · ${t.truth.earliest}` : ""}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function Agents({ results }: { results: any }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [sel, setSel] = useState("P01-v1");
  useEffect(() => { fetch("/agents-public.json").then((r) => r.json()).then(setAgents).catch(() => {}); }, []);
  const a = agents.find((x) => x.agent_id === sel);
  const row = results?.agents?.find((x: any) => x.agent_id === sel);
  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="card max-h-[75vh] overflow-auto p-3"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>agent</th><th className="num">rarc</th><th className="num">generic</th><th className="num">TSR</th></tr></thead><tbody>
        {(results?.agents ?? []).map((x: any) => <tr key={x.agent_id} onClick={() => setSel(x.agent_id)} style={{ cursor: "pointer", background: sel === x.agent_id ? "var(--accent-soft)" : undefined }}><td className="font-mono text-xs">{x.agent_id}{x.ok ? "" : <span className="badge badge-bad ml-1">contract</span>}<div className="faint">{x.model?.replace("openai/", "")}</div></td><td className="num">{x.rarc?.toFixed(2)}</td><td className="num">{x.generic?.toFixed(2)}</td><td className="num">{x.tsr_heldout?.toFixed(2)}</td></tr>)}
      </tbody></table></div></div>
      <div className="card p-6">
        {a ? <>
          <div className="flex flex-wrap gap-1.5 text-xs"><span className="chip">{a.agent_id}</span><span className="chip">{a.model_id}</span><span className="chip">hash {a.code_hash}</span><span className="chip">repairs {a.repairs}</span><span className="chip">tools: {[...a.tools, ...a.wrappers.map((w: any) => w.name + "*")].join(", ")}</span><span className={`badge ${a.ok ? "badge-good" : "badge-bad"}`}>{a.ok ? <Check size={12} /> : <X size={12} />}contract{a.ok ? "" : ": " + a.contract.violations.join("; ")}</span></div>
          {row?.weakest?.length > 0 && <div className="mt-2 text-sm"><b>Certificate weakest areas:</b> {row.weakest.map((w: any) => `${w.name} (${w.sentence})`).join(" · ")}</div>}
          {row && <div className="mt-1 text-xs faint">RARC breakdown: {Object.entries(row.rarc_breakdown).map(([k, v]: any) => `${k} ${Math.round(v * 100)}%`).join(" · ")}</div>}
          <pre className="code mt-3 max-h-[60vh]">{a.code}</pre>
        </> : <div className="faint text-sm">Loading agent code…</div>}
      </div>
    </div>
  );
}

function RunLog() {
  const [runs, setRuns] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [onlyFail, setOnlyFail] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetch("/runs-sample.json").then((r) => r.json()).then(setRuns).catch(() => {}); }, []);
  const rows = useMemo(() => runs.filter((r) => (!onlyFail || !r.checker_result.success) && (!q || `${r.agent_id} ${r.task_id} ${r.error_code} ${r.status}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 300), [runs, q, onlyFail]);
  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">Logging store (US-12)</h2><span className="text-xs faint">{runs.length} real-task runs (replay 1 of 3); every record follows the plan §2.10 schema</span>
        <input type="text" className="ml-auto" placeholder="filter: agent, task, error…" value={q} onChange={(e) => setQ(e.target.value)} /><label className="text-sm flex items-center gap-1"><input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> failures only</label></div>
      <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>run</th><th>agent</th><th>task</th><th>split</th><th>status / error</th><th>checker</th><th className="num">rarc score at run time</th><th className="num">tool calls</th></tr></thead><tbody>
        {rows.map((r) => <>
          <tr key={r.run_id} onClick={() => setOpen(open === r.run_id ? null : r.run_id)} style={{ cursor: "pointer" }}><td className="font-mono text-xs">{r.run_id}</td><td className="font-mono text-xs">{r.agent_id}</td><td className="font-mono text-xs">{r.task_id}{r.hard ? " (hard)" : ""}</td><td>{r.split}</td><td className="text-xs" style={{ color: r.error_code ? "var(--bad)" : undefined }}>{r.error_code ?? r.status}</td><td className="text-xs" style={{ color: r.checker_result.success ? "var(--good)" : "var(--bad)" }}>{r.checker_result.success ? "success" : "fail"} · {Math.round(r.checker_result.partial_score * 100)}%</td><td className="num">{r.cert_score_at_run_time.rarc?.toFixed(2)}</td><td className="num">{r.tool_stats.calls}</td></tr>
          {open === r.run_id && <tr key={r.run_id + "x"}><td colSpan={8}><pre className="code max-h-80">{JSON.stringify(r, null, 1)}</pre></td></tr>}
        </>)}
      </tbody></table></div>
    </div>
  );
}

function Session() {
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => { try { setRuns(JSON.parse(localStorage.getItem("rarc-runs") ?? "[]")); } catch {} }, []);
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">Your session (US-11 flags)</h2><span className="text-xs faint">runs from the Live Demo tab, stored in this browser</span>
        <button className="btn btn-sm ml-auto" onClick={() => { const b = new Blob([JSON.stringify(runs, null, 1)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "rarc-session-runs.json"; a.click(); }}><Download size={14} />Export JSON</button>
        <button className="btn btn-sm" onClick={() => { localStorage.removeItem("rarc-runs"); setRuns([]); }}><Trash size={14} />Clear</button></div>
      {!runs.length ? <p className="mt-3 text-sm faint">No runs yet. Assemble an agent in the Live Demo and run a task.</p> :
        <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>time</th><th>agent</th><th>task</th><th>mode</th><th>status</th><th>checker</th><th className="num">cert</th><th>flag</th></tr></thead><tbody>
          {runs.map((r) => <tr key={r.run_id}><td className="text-xs">{r.timestamp.slice(11, 19)}</td><td className="font-mono text-xs">{r.agent_id} <span className="faint">{r.code_hash}</span></td><td className="text-xs">{r.task_id ?? JSON.stringify(r.inputs).slice(0, 60)}</td><td>{r.mode}</td><td className="text-xs">{r.error_code ?? r.status}</td><td className="text-xs">{r.checker_result ? (r.checker_result.success ? "success" : "fail") : "–"}</td><td className="num">{r.cert_score_at_run_time?.toFixed(2) ?? "–"}</td><td className="text-xs">{r.flagged ? <span className="badge badge-warn"><Flag size={11} />{r.flag_note || "flagged"}</span> : ""}</td></tr>)}
        </tbody></table></div>}
    </div>
  );
}

function Tools() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { fetch("/api/tools").then((r) => r.json()).then(setD).catch(() => {}); }, []);
  if (!d) return <div className="card p-4 faint">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="card p-6"><h2 className="text-lg font-semibold tracking-tight">Tool library & metadata store (US-2)</h2>
        <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>tool</th><th>source</th><th>side effect</th><th>capabilities</th><th>endpoint</th><th>description</th><th>output</th></tr></thead><tbody>
          {d.tools.map((t: any) => <tr key={t.name}><td className="font-mono text-xs">{t.name}</td><td>{t.source.replace("_", " ")}</td><td className="text-xs" style={{ color: t.side_effect === "requires_confirmation" ? "var(--warn)" : undefined }}>{t.side_effect}</td><td className="text-xs">{t.capabilities.join(", ")}</td><td className="font-mono text-xs faint">{t.endpoints.join(", ")}</td><td className="text-xs">{t.description}</td><td className="font-mono text-xs faint">{t.output}</td></tr>)}
        </tbody></table></div></div>
      <div className="card p-6"><h2 className="text-lg font-semibold tracking-tight">D-OpenAPI: APIs available for wrapper synthesis (US-3)</h2>
        <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>API</th><th>capability</th><th>allow-listed host</th><th>target tool</th><th>example call</th></tr></thead><tbody>
          {d.apis.map((a: any) => <tr key={a.id}><td>{a.title}</td><td>{a.capability}</td><td className="font-mono text-xs">{a.allow_host}</td><td className="font-mono text-xs">{a.target.name} → {a.target.output}</td><td className="font-mono text-xs">{JSON.stringify(a.example_args)}</td></tr>)}
        </tbody></table></div></div>
    </div>
  );
}

function Intake({ results }: { results: any }) {
  if (!results) return null;
  return (
    <div className="space-y-4">
      <div className="card p-6"><h2 className="text-lg font-semibold tracking-tight">D-Intake (30 specs, 20% ambiguous) — predictions</h2>
        <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>id</th><th>spec</th><th>gold</th><th>pred</th><th className="num">conf</th><th>asked</th><th>capabilities (pred vs gold)</th></tr></thead><tbody>
          {results.M1.rows.map((x: any) => <tr key={x.id}><td className="font-mono text-xs">{x.id}</td><td className="text-xs">{x.text}{x.question && <div className="faint">Q: {x.question}</div>}</td><td>{x.ambiguous ? "ambiguous" : x.gold_category}</td><td style={{ color: !x.ambiguous && x.pred_category !== x.gold_category ? "var(--bad)" : undefined }}>{x.pred_category}</td><td className="num">{x.confidence?.toFixed(2)}</td><td style={{ color: x.asked === x.ambiguous ? "var(--good)" : "var(--bad)" }}>{x.asked ? "yes" : "no"}</td><td className="text-xs">{(x.pred_caps ?? []).join(", ")}<div className="faint">{x.gold_caps.join(", ")}</div></td></tr>)}
        </tbody></table></div></div>
      <div className="card p-6"><h2 className="text-lg font-semibold tracking-tight">D-Retrieval — top-5 with re-rank justifications</h2>
        <div className="tbl-wrap mt-4"><table className="tbl"><thead><tr><th>id</th><th>gold required</th><th>top-5 (● = selected by re-ranker)</th><th>uncovered → synthesis</th><th>hit</th></tr></thead><tbody>
          {results.M2.rows.map((x: any) => <tr key={x.id}><td className="font-mono text-xs">{x.id}</td><td className="font-mono text-xs">{x.gold_required.join(", ")}</td><td className="text-xs">{x.top5.map((t: any) => <div key={t.tool}><span className="font-mono">{t.relevant ? "● " : "○ "}{t.tool}</span> <span className="faint">{t.sim} · {t.why}</span></div>)}</td><td className="text-xs">{x.gaps.join(", ")}{x.synth.length ? ` → ${x.synth.map((s: any) => s.api_id).join(", ")}` : ""}</td><td>{x.hit ? <Check size={14} style={{ color: "var(--good)" }} /> : <X size={14} style={{ color: "var(--bad)" }} />}</td></tr>)}
        </tbody></table></div></div>
      <div className="card p-6"><h2 className="text-lg font-semibold tracking-tight">Synthesized wrappers (M3)</h2>
        {results.M3.rows.map((w: any) => <div key={w.api} className="mt-3"><div className="text-sm"><b>{w.api}</b> — {w.valid ? `valid after ${w.repairs} repair(s)` : "rejected"} {w.wrapper && <span className="font-mono text-xs faint">{w.wrapper.base_url}{w.wrapper.path_template} {JSON.stringify(w.wrapper.query)}</span>}</div>
          {w.wrapper && <pre className="code mt-1">{w.wrapper.transform}</pre>}
          {w.attempts.map((a: any, i: number) => <div key={i} className="text-xs font-mono faint break-all">#{i} {a.url} → {a.ok ? JSON.stringify(a.output).slice(0, 160) : a.error}</div>)}</div>)}
      </div>
    </div>
  );
}
