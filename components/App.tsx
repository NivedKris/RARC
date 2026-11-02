"use client";
import { useEffect, useState } from "react";
import Demo from "./Demo";
import Methodology from "./Methodology";
import Evaluation from "./Evaluation";
import Data from "./Data";
import { Beaker, Book, Chart, Database, Shield } from "./icons";

const TABS = [
  { id: "Live Demo", icon: Beaker },
  { id: "Methodology", icon: Book },
  { id: "Evaluation", icon: Chart },
  { id: "Datasets & Logs", icon: Database },
] as const;
type Tab = (typeof TABS)[number]["id"];
const slug = (t: string) => t.toLowerCase().replace(/\W+/g, "-");

export default function App() {
  const [tab, setTab] = useState<Tab>("Live Demo");
  const [results, setResults] = useState<any>(null);
  useEffect(() => { fetch("/results.json").then((r) => (r.ok ? r.json() : null)).then(setResults).catch(() => {}); }, []);
  useEffect(() => { const h = decodeURIComponent(location.hash.slice(1)); const t = TABS.find((x) => slug(x.id) === h); if (t) setTab(t.id); }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", "#" + slug(t)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const rm = results?.M7?.methods?.rarc;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.78)" }}>
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: "linear-gradient(135deg, #6366f1, #4338ca)" }}><Shield size={18} /></div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">RARC</div>
              <div className="text-[11px] faint">Agent assembly · reliability certification</div>
            </div>
          </div>
          <nav className="seg ml-auto" role="tablist" aria-label="Sections">
            {TABS.map(({ id, icon: I }) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)} className="inline-flex items-center gap-1.5">
                <I size={15} /><span className="hidden sm:inline">{id}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-5 pb-20">
        {tab === "Live Demo" && (
          <section className="fade-in pt-10 pb-8">
            <div className="flex flex-wrap items-end gap-8">
              <div className="max-w-3xl">
                <span className="badge badge-accent">IIT Kharagpur · CSE · research prototype</span>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
                  Build an agent from one sentence.<br /><span style={{ color: "var(--accent)" }}>Know if it will work before it runs.</span>
                </h1>
                <p className="mt-3 text-base muted">RARC retrieves tools, synthesizes missing API wrappers and generates spec-specific code. It then stress-tests the agent with taxonomy-driven adversarial tests in a sandbox and issues a reliability certificate. The research question is whether that certificate predicts real task success.</p>
              </div>
              {rm && (
                <div className="ml-auto grid grid-cols-3 gap-3">
                  {[["agents evaluated", String(results.meta.n_agents)], ["held-out runs", String(results.M7.n_runs)], ["AUROC (RARC)", rm.auroc?.toFixed(2) ?? "–"]].map(([l, v]) => (
                    <div key={l} className="card px-4 py-3"><div className="text-2xl font-semibold tabular-nums tracking-tight">{v}</div><div className="text-xs faint">{l}</div></div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {tab !== "Live Demo" && <div className="pt-8" />}
        <main key={tab} className="fade-in">
          {tab === "Live Demo" && <Demo />}
          {tab === "Methodology" && <Methodology results={results} />}
          {tab === "Evaluation" && <Evaluation results={results} />}
          {tab === "Datasets & Logs" && <Data results={results} />}
        </main>
        <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-6 text-xs faint" style={{ borderColor: "var(--border)" }}>
          <span>RARC prototype · Nived Krishna, Srishanth Guguloth · Advisor: Prof. Pawan Goyal</span>
          <span className="sm:ml-auto">LLMs: Groq + Google AI Studio · Sandbox: QuickJS/WASM in a killable worker · Data: Open-Meteo, Frankfurter, Nager.Date (recorded)</span>
        </footer>
      </div>
    </div>
  );
}
