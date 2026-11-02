import { createHash } from "crypto";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(...parts: (string | number)[]) {
  const h = createHash("sha256").update(parts.join("|")).digest();
  return h.readUInt32LE(0);
}

export function rngFor(...parts: (string | number)[]) {
  return mulberry32(seedOf(...parts));
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(o[k]))
      .join(",") +
    "}"
  );
}

export function sha(s: string, n = 16) {
  return createHash("sha256").update(s).digest("hex").slice(0, n);
}

export function round(x: number, d = 2) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/,/g, ""));
  if (v === null || v === undefined) return 0;
  return NaN;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
