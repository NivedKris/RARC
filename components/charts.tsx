"use client";
import { useState, ReactNode } from "react";

export const METHOD_COLOR: Record<string, string> = { rarc: "var(--series-1)", generic: "var(--series-2)", random: "var(--series-3)", none: "var(--series-none)" };
export const METHOD_LABEL: Record<string, string> = { rarc: "RARC (taxonomy-adversarial)", generic: "Generic unit tests", random: "Random perturbation", none: "No testing (prior)" };

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="pointer-events-none absolute z-10 rounded-md border bg-white px-2 py-1 text-xs shadow-sm" style={{ left: x + 12, top: y - 8, borderColor: "var(--border)", whiteSpace: "nowrap" }}>{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <div className="flex flex-wrap gap-4 text-xs muted">{items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>)}</div>;
}

// Grouped horizontal bars with optional CI whiskers. values in [min,max].
export function GroupedBars({ groups, series, min = 0, max = 1, fmt = (v: number) => v.toFixed(2), refLine }: {
  groups: { label: string; values: Record<string, { v: number | null; ci?: (number | null)[] }> }[];
  series: { key: string; label: string; color: string }[]; min?: number; max?: number; fmt?: (v: number) => string; refLine?: { v: number; label: string };
}) {
  const [tip, setTip] = useState<{ x: number; y: number; t: ReactNode } | null>(null);
  const W = 720, labelW = 200, barH = 12, gap = 2, groupGap = 16;
  const gh = series.length * (barH + gap) + groupGap;
  const H = groups.length * gh + 24;
  const sx = (v: number) => labelW + ((v - min) / (max - min)) * (W - labelW - 50);
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }} role="img">
        {ticks.map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={0} y2={H - 20} stroke="var(--grid)" /><text x={sx(t)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-muted)">{fmt(t)}</text></g>)}
        {refLine && <g><line x1={sx(refLine.v)} x2={sx(refLine.v)} y1={0} y2={H - 20} stroke="var(--text-muted)" strokeDasharray="3 3" /><text x={sx(refLine.v) + 3} y={10} fontSize={9} fill="var(--text-muted)">{refLine.label}</text></g>}
        {groups.map((g, gi) => (
          <g key={g.label} transform={`translate(0 ${gi * gh})`}>
            <text x={labelW - 8} y={(series.length * (barH + gap)) / 2 + 3} fontSize={11} textAnchor="end" fill="var(--text-primary)">{g.label}</text>
            {series.map((s, si) => {
              const d = g.values[s.key];
              if (!d || d.v === null || !isFinite(d.v)) return <text key={s.key} x={labelW + 4} y={si * (barH + gap) + barH - 2} fontSize={9} fill="var(--text-muted)">n/a</text>;
              const y = si * (barH + gap);
              const x0 = sx(Math.max(min, Math.min(0, max))), x1 = sx(Math.max(min, Math.min(max, d.v)));
              return (
                <g key={s.key} onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, t: <><b>{g.label}</b> · {s.label}: {fmt(d.v!)}{d.ci && d.ci[0] !== null ? ` [${fmt(d.ci[0]!)}, ${fmt(d.ci[1]!)}]` : ""}</> }); }}>
                  <rect x={0} y={y - 1} width={W} height={barH + 2} fill="transparent" />
                  <rect x={Math.min(x0, x1)} y={y} width={Math.max(1, Math.abs(x1 - x0))} height={barH} rx={3} fill={s.color} />
                  {d.ci && d.ci[0] !== null && d.ci[1] !== null && <g stroke="var(--text-primary)" strokeWidth={1.2}><line x1={sx(Math.max(min, d.ci[0]!))} x2={sx(Math.min(max, d.ci[1]!))} y1={y + barH / 2} y2={y + barH / 2} /><line x1={sx(Math.max(min, d.ci[0]!))} x2={sx(Math.max(min, d.ci[0]!))} y1={y + 2} y2={y + barH - 2} /><line x1={sx(Math.min(max, d.ci[1]!))} x2={sx(Math.min(max, d.ci[1]!))} y1={y + 2} y2={y + barH - 2} /></g>}
                  <text x={Math.max(x0, x1, d.ci?.[1] != null ? sx(Math.min(max, d.ci[1]!)) : 0) + 4} y={y + barH - 2} fontSize={9.5} fill="var(--text-secondary)">{fmt(d.v)}</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {tip && <Tip x={tip.x} y={tip.y}>{tip.t}</Tip>}
    </div>
  );
}

// Scatter of certificate score s(a) vs held-out success Y(a); one small multiple per method.
export function ScatterPanel({ points, color, title, rho }: { points: { agent: string; s: number; Y: number }[]; color: string; title: string; rho: number | null }) {
  const [tip, setTip] = useState<{ x: number; y: number; t: ReactNode } | null>(null);
  const W = 280, H = 240, p = 32;
  const sx = (v: number) => p + v * (W - p - 10), sy = (v: number) => H - p - v * (H - p - 12);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <div className="mb-1 text-xs font-medium">{title} <span className="faint">ρ = {rho === null ? "n/a" : rho.toFixed(2)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={12} y2={H - p} stroke="var(--grid)" /><line x1={p} x2={W - 10} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" /><text x={sx(t)} y={H - p + 12} fontSize={9} textAnchor="middle" fill="var(--text-muted)">{t}</text><text x={p - 4} y={sy(t) + 3} fontSize={9} textAnchor="end" fill="var(--text-muted)">{t}</text></g>)}
        <text x={(W + p) / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">certificate score s(a)</text>
        <text x={8} y={H / 2} fontSize={9} textAnchor="middle" fill="var(--text-secondary)" transform={`rotate(-90 8 ${H / 2})`}>held-out success Y(a)</text>
        {points.map((q) => <circle key={q.agent} cx={sx(q.s)} cy={sy(q.Y)} r={4.5} fill={color} fillOpacity={0.75} stroke="var(--surface-1)" strokeWidth={1.5}
          onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, t: <><b>{q.agent}</b> s={q.s.toFixed(2)} Y={q.Y.toFixed(2)}</> }); }} />)}
      </svg>
      {tip && <Tip x={tip.x} y={tip.y}>{tip.t}</Tip>}
    </div>
  );
}

export function Reliability({ series }: { series: { key: string; label: string; color: string; bins: { lo: number; hi: number; n: number; conf: number | null; acc: number | null }[] }[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; t: ReactNode } | null>(null);
  const W = 460, H = 320, p = 38;
  const sx = (v: number) => p + v * (W - p - 10), sy = (v: number) => H - p - v * (H - p - 12);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full" style={{ maxWidth: W }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={p} x2={W - 10} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" /><text x={p - 4} y={sy(t) + 3} fontSize={9} textAnchor="end" fill="var(--text-muted)">{t}</text><text x={sx(t)} y={H - p + 12} fontSize={9} textAnchor="middle" fill="var(--text-muted)">{t}</text></g>)}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--text-muted)" strokeDasharray="4 3" />
        <text x={(W + p) / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">predicted success (certificate score)</text>
        <text x={9} y={H / 2} fontSize={9} textAnchor="middle" fill="var(--text-secondary)" transform={`rotate(-90 9 ${H / 2})`}>observed success rate</text>
        {series.map((s) => { const pts = s.bins.filter((b) => b.n > 0 && b.conf !== null); return (
          <g key={s.key}>
            <polyline points={pts.map((b) => `${sx(b.conf!)},${sy(b.acc!)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} />
            {pts.map((b, i) => <circle key={i} cx={sx(b.conf!)} cy={sy(b.acc!)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, t: <>{s.label}: bin {b.lo.toFixed(1)}–{b.hi.toFixed(1)} · n={b.n} · predicted {b.conf!.toFixed(2)} · observed {b.acc!.toFixed(2)}</> }); }} />)}
          </g>); })}
      </svg>
      {tip && <Tip x={tip.x} y={tip.y}>{tip.t}</Tip>}
    </div>
  );
}

export function LineChart({ xs, series, yMin = 0.4, yMax = 1, xLabel, yLabel }: { xs: number[]; series: { key: string; label: string; color: string; ys: (number | null)[] }[]; yMin?: number; yMax?: number; xLabel: string; yLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 480, H = 320, p = 40;
  const sx = (i: number) => p + (i / Math.max(1, xs.length - 1)) * (W - p - 60), sy = (v: number) => H - p - ((v - yMin) / (yMax - yMin)) * (H - p - 12);
  const ticks = Array.from({ length: 4 }, (_, i) => yMin + ((yMax - yMin) * i) / 3);
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full" style={{ maxWidth: W }} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; let best = 0; xs.forEach((_, i) => { if (Math.abs(sx(i) - x) < Math.abs(sx(best) - x)) best = i; }); setHover(best); }}>
        {ticks.map((t) => <g key={t}><line x1={p} x2={W - 60} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" /><text x={p - 4} y={sy(t) + 3} fontSize={9} textAnchor="end" fill="var(--text-muted)">{t.toFixed(2)}</text></g>)}
        {xs.map((x, i) => <text key={x} x={sx(i)} y={H - p + 13} fontSize={9} textAnchor="middle" fill="var(--text-muted)">{x}</text>)}
        <text x={(W - 24) / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">{xLabel}</text>
        <text x={9} y={H / 2} fontSize={9} textAnchor="middle" fill="var(--text-secondary)" transform={`rotate(-90 9 ${H / 2})`}>{yLabel}</text>
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={12} y2={H - p} stroke="var(--text-muted)" />}
        {series.map((s) => { const pts = s.ys.map((y, i) => (y === null ? null : [sx(i), sy(y)])).filter(Boolean) as number[][]; const last = pts[pts.length - 1]; return (
          <g key={s.key}>
            <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} />
            {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />)}
            {last && <text x={last[0] + 7} y={last[1] + 3} fontSize={9.5} fill="var(--text-secondary)">{s.key}</text>}
          </g>); })}
      </svg>
      {hover !== null && <div className="pointer-events-none absolute right-2 top-2 rounded-md border bg-white px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}><b>{xs[hover]} tests</b>{series.map((s) => <div key={s.key}><span className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: s.color }} />{s.label}: {s.ys[hover]?.toFixed(3) ?? "n/a"}</div>)}</div>}
    </div>
  );
}

// Small inline percentage bar for per-category breakdowns.
export function MiniBar({ v, color = "var(--series-1)", w = 90 }: { v: number | null; color?: string; w?: number }) {
  return <span className="inline-flex items-center gap-1.5"><svg width={w} height={8}><rect width={w} height={8} rx={4} fill="var(--grid)" />{v !== null && <rect width={Math.max(2, v * w)} height={8} rx={4} fill={color} />}</svg><span className="text-xs tabular-nums muted">{v === null ? "–" : Math.round(v * 100) + "%"}</span></span>;
}
