// Minimal stroke icon set (Lucide-style paths), so the UI never relies on emoji or text glyphs.
type P = { size?: number; className?: string; style?: React.CSSProperties };
const base = (size = 16) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const Check = (p: P) => <svg {...base(p.size)} {...p}><path d="M20 6 9 17l-5-5" /></svg>;
export const X = (p: P) => <svg {...base(p.size)} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Flag = (p: P) => <svg {...base(p.size)} {...p}><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 8 2a6 6 0 0 0 4-1.5V14a6 6 0 0 1-4 1.5c-3 0-5-2-8-2a6 6 0 0 0-4 1.5" /></svg>;
export const Play = (p: P) => <svg {...base(p.size)} {...p}><path d="M6 4l14 8-14 8z" /></svg>;
export const Sparkles = (p: P) => <svg {...base(p.size)} {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 3v4M17 5h4" /></svg>;
export const Loader = (p: P) => <svg {...base(p.size)} {...p} className={`spin ${p.className ?? ""}`}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>;
export const Shield = (p: P) => <svg {...base(p.size)} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>;
export const Code = (p: P) => <svg {...base(p.size)} {...p}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>;
export const Search = (p: P) => <svg {...base(p.size)} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
export const Plug = (p: P) => <svg {...base(p.size)} {...p}><path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z" /></svg>;
export const FileText = (p: P) => <svg {...base(p.size)} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>;
export const Terminal = (p: P) => <svg {...base(p.size)} {...p}><path d="m4 17 6-6-6-6M12 19h8" /></svg>;
export const Alert = (p: P) => <svg {...base(p.size)} {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>;
export const Beaker = (p: P) => <svg {...base(p.size)} {...p}><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" /><path d="M7 15h10" /></svg>;
export const Book = (p: P) => <svg {...base(p.size)} {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></svg>;
export const Chart = (p: P) => <svg {...base(p.size)} {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>;
export const Database = (p: P) => <svg {...base(p.size)} {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
export const Download = (p: P) => <svg {...base(p.size)} {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>;
export const Trash = (p: P) => <svg {...base(p.size)} {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>;
export const Chevron = (p: P) => <svg {...base(p.size)} {...p}><path d="m9 18 6-6-6-6" /></svg>;

export function StatusIcon({ ok, size = 14 }: { ok: boolean; size?: number }) {
  return ok ? <Check size={size} style={{ color: "var(--good)" }} /> : <X size={size} style={{ color: "var(--bad)" }} />;
}
