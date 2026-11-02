// Statistics for the evaluation (plan §6.7): correlation, AUROC/AUPRC, Brier, ECE, bootstrap CIs.
import { mulberry32 } from "./util";

export function ranks(xs: number[]) {
  const idx = xs.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r as number[];
}
export function pearson(x: number[], y: number[]) {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}
export const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

// AUROC of `score` ranking positives (label 1) above negatives; ties count 0.5.
export function auroc(score: number[], label: number[]) {
  const r = ranks(score);
  const pos = label.filter((l) => l === 1).length, neg = label.length - pos;
  if (!pos || !neg) return NaN;
  let sum = 0;
  label.forEach((l, i) => { if (l === 1) sum += r[i]; });
  return (sum - (pos * (pos + 1)) / 2) / (pos * neg);
}
// Average precision with tied scores handled as groups.
export function auprc(score: number[], label: number[]) {
  const pos = label.filter((l) => l === 1).length;
  if (!pos) return NaN;
  const groups = new Map<number, { p: number; n: number }>();
  score.forEach((s, i) => { const g = groups.get(s) ?? { p: 0, n: 0 }; label[i] ? g.p++ : g.n++; groups.set(s, g); });
  let tp = 0, fp = 0, ap = 0, prevR = 0;
  for (const s of [...groups.keys()].sort((a, b) => b - a)) {
    const g = groups.get(s)!;
    tp += g.p; fp += g.n;
    const rec = tp / pos, prec = tp / (tp + fp);
    ap += (rec - prevR) * prec;
    prevR = rec;
  }
  return ap;
}
export const brier = (p: number[], y: number[]) => p.reduce((a, pi, i) => a + (pi - y[i]) ** 2, 0) / p.length;
export function calibration(p: number[], y: number[], bins = 10) {
  const B = Array.from({ length: bins }, (_, b) => ({ lo: b / bins, hi: (b + 1) / bins, n: 0, conf: 0, acc: 0 }));
  p.forEach((pi, i) => { const b = Math.min(bins - 1, Math.floor(pi * bins)); B[b].n++; B[b].conf += pi; B[b].acc += y[i]; });
  let ece = 0;
  for (const b of B) if (b.n) { b.conf /= b.n; b.acc /= b.n; ece += (b.n / p.length) * Math.abs(b.conf - b.acc); }
  return { ece, bins: B };
}
export function prf(pred: number[], label: number[]) {
  let tp = 0, fp = 0, fn = 0;
  pred.forEach((p, i) => { if (p && label[i]) tp++; else if (p && !label[i]) fp++; else if (!p && label[i]) fn++; });
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, tp, fp, fn };
}
export function bestThreshold(score: number[], fail: number[]) {
  const cands = [...new Set(score)].sort((a, b) => a - b);
  const ths = [0, ...cands.map((c, i) => (i + 1 < cands.length ? (c + cands[i + 1]) / 2 : c + 1e-9))];
  let best = { tau: 0.5, f1: -1 };
  for (const t of ths) { const f = prf(score.map((s) => (s < t ? 1 : 0)), fail).f1; if (f > best.f1 + 1e-12) best = { tau: t, f1: f }; }
  return best.tau;
}

export interface Pair { agent: string; s: number; ys: number[] }
// Bootstrap over agents (tasks resampled within each agent). Returns [lo, hi] 95% CI.
export function bootstrap(pairs: Pair[], stat: (p: Pair[]) => number, B = 1000, seed = 7) {
  const rnd = mulberry32(seed);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: Pair[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[Math.floor(rnd() * pairs.length)];
      sample.push({ agent: p.agent, s: p.s, ys: p.ys.map(() => p.ys[Math.floor(rnd() * p.ys.length)]) });
    }
    const v = stat(sample);
    if (isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? [vals[Math.floor(0.025 * vals.length)], vals[Math.min(vals.length - 1, Math.floor(0.975 * vals.length))]] : [NaN, NaN];
}
// Paired bootstrap of stat(A) - stat(B) with identical resamples (same agents, same tasks).
export function pairedBootstrap(a: Pair[], b: Pair[], stat: (p: Pair[]) => number, B = 1000, seed = 11) {
  const rnd = mulberry32(seed);
  const d: number[] = [];
  for (let k = 0; k < B; k++) {
    const sa: Pair[] = [], sb: Pair[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(rnd() * a.length);
      const picks = a[j].ys.map(() => Math.floor(rnd() * a[j].ys.length));
      sa.push({ agent: a[j].agent, s: a[j].s, ys: picks.map((q) => a[j].ys[q]) });
      sb.push({ agent: b[j].agent, s: b[j].s, ys: picks.map((q) => b[j].ys[q]) });
    }
    const v = stat(sa) - stat(sb);
    if (isFinite(v)) d.push(v);
  }
  d.sort((x, y) => x - y);
  return { ci: [d[Math.floor(0.025 * d.length)], d[Math.min(d.length - 1, Math.floor(0.975 * d.length))]], p_one_sided: d.filter((x) => x <= 0).length / Math.max(1, d.length) };
}

export const runLevel = (pairs: Pair[]) => { const score: number[] = [], fail: number[] = [], s: number[] = [], y: number[] = []; for (const p of pairs) for (const v of p.ys) { score.push(1 - p.s); fail.push(v ? 0 : 1); s.push(p.s); y.push(v); } return { score, fail, s, y }; };
export const statAuroc = (p: Pair[]) => { const r = runLevel(p); return auroc(r.score, r.fail); };
export const statSpearman = (p: Pair[]) => spearman(p.map((x) => x.s), p.map((x) => x.ys.reduce((a, b) => a + b, 0) / x.ys.length));
export const statPearson = (p: Pair[]) => pearson(p.map((x) => x.s), p.map((x) => x.ys.reduce((a, b) => a + b, 0) / x.ys.length));

export function cohenKappa(a: string[], b: string[]) {
  const n = a.length;
  if (!n) return NaN;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
