// Sandboxed execution of generated agent code.
// Two layers: (1) a fresh QuickJS WebAssembly VM per run — no network, filesystem, process, timers or
// host objects; the only bridge out is the tool client; heap + stack limits and an interrupt deadline.
// (2) the VM lives in a disposable worker thread that the host hard-kills at the wall-clock deadline,
// so even native operations that never yield to the interrupt handler cannot hang the server.
// Each failure maps to exactly one error code (plan §2.6).
import { Worker } from "worker_threads";
import path from "path";
import { contractCheck, validateAgentResult } from "./contract";

export type ErrorCode = "E_CRASH" | "E_TIMEOUT" | "E_RESOURCE" | "E_NET_DENIED" | "E_TOOL" | "E_MALFORMED_OUTPUT" | "E_CONTRACT" | "E_CONFIRM_REQUIRED";
export const ERROR_CODES: Record<ErrorCode, string> = {
  E_CRASH: "Unhandled exception in generated code",
  E_TIMEOUT: "Wall-clock budget exceeded; run killed",
  E_RESOURCE: "CPU / memory / stack / tool-call cap hit",
  E_NET_DENIED: "Network call to a non-allow-listed target",
  E_TOOL: "Tool returned an error the agent didn't handle",
  E_MALFORMED_OUTPUT: "AgentResult fails schema validation",
  E_CONTRACT: "Generated code violates the interface contract",
  E_CONFIRM_REQUIRED: "Attempted a requires_confirmation action without confirmation",
};

export interface Limits { wallMs: number; memBytes: number; stackBytes: number; maxOutputBytes: number }
export const DEFAULT_LIMITS: Limits = { wallMs: 4000, memBytes: 32 * 1024 * 1024, stackBytes: 512 * 1024, maxOutputBytes: 200_000 };

export interface HostToolResult { data?: any; error?: { code: string; message: string }; fatal?: string }
export interface SandboxRun {
  code: string;
  task: any;
  context: Record<string, any>;
  category?: string;
  toolCall: (name: string, args: any) => Promise<HostToolResult>;
  limits?: Partial<Limits>;
  skipStatic?: boolean;
}
export interface SandboxResult {
  status: string;
  error_code: ErrorCode | null;
  error_message?: string;
  answer: any;
  raw?: any;
  logs: string[];
  duration_ms: number;
  violations: { net: string[]; confirm: number; call_cap: boolean };
  terminated_within_budget: boolean;
  killed: boolean;
}

const PRELUDE = `
"use strict";
var console = { log: function(){ var a=[]; for (var i=0;i<arguments.length;i++){ var x=arguments[i]; a.push(typeof x==='string'?x:JSON.stringify(x)); } __host_log(a.join(' ')); } };
console.error = console.log; console.warn = console.log; console.info = console.log;
var tools = Object.freeze({ call: async function(name, args) {
  var raw = await __host_call(String(name), JSON.stringify(args === undefined ? {} : args));
  var o = JSON.parse(raw);
  if (o.fatal) { var e1 = new Error(o.error.message); e1.name = o.fatal; e1.code = o.error.code; throw e1; }
  if (o.error) { var e = new Error(o.error.message); e.name = 'ToolError'; e.code = o.error.code; e.tool = String(name); throw e; }
  return o.data;
}});
function fetch(url) { __host_net(String(url)); var e = new Error('network access denied: ' + url); e.name = 'NetDenied'; return Promise.reject(e); }
var XMLHttpRequest = function(){ __host_net('xhr'); var e = new Error('network access denied'); e.name='NetDenied'; throw e; };
`;

// Worker source (CommonJS). Receives {qjs, code, task, ctx, limits}; talks to host only via messages.
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const { newQuickJSWASMModule, RELEASE_SYNC } = require(workerData.qjs);
const W = workerData;
const pending = new Map(); let seq = 0;
parentPort.on('message', (m) => { if (m.type === 'tool_result') { const f = pending.get(m.id); pending.delete(m.id); f && f(m.result); } });
const send = (m) => parentPort.postMessage(m);
(async () => {
  const mod = await newQuickJSWASMModule(RELEASE_SYNC);
  const rt = mod.newRuntime();
  rt.setMemoryLimit(W.limits.memBytes);
  rt.setMaxStackSize(W.limits.stackBytes);
  const deadline = W.t0 + W.limits.wallMs;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  const pump = () => { try { rt.executePendingJobs(); } catch (e) {} };
  const dumpErr = (h) => { const e = vm.dump(h); h.dispose(); return e && typeof e === 'object' ? { name: e.name, message: e.message } : { name: 'Thrown', message: String(e) }; };
  vm.newFunction('__host_log', (h) => { send({ type: 'log', msg: String(vm.getString(h)).slice(0, 500) }); }).consume((f) => vm.setProp(vm.global, '__host_log', f));
  vm.newFunction('__host_net', (h) => { send({ type: 'net', url: vm.getString(h) }); }).consume((f) => vm.setProp(vm.global, '__host_net', f));
  vm.newFunction('__host_call', (nh, ah) => {
    const name = vm.getString(nh); let args; try { args = JSON.parse(vm.getString(ah)); } catch (e) { args = {}; }
    const d = vm.newPromise(); const id = ++seq;
    pending.set(id, (res) => { const s = vm.newString(JSON.stringify(res)); d.resolve(s); s.dispose(); pump(); });
    send({ type: 'tool', id, name, args });
    return d.handle;
  }).consume((f) => vm.setProp(vm.global, '__host_call', f));
  for (const [k, v] of [['__task_json', W.task], ['__ctx_json', W.ctx]]) { const s = vm.newString(JSON.stringify(v == null ? null : v)); vm.setProp(vm.global, k, s); s.dispose(); }
  const load = vm.evalCode(W.prelude + '\\n' + W.code + '\\n;var __task = JSON.parse(__task_json); var __ctx = Object.freeze(JSON.parse(__ctx_json));\\n typeof run;', 'agent.js');
  if (load.error) return send({ type: 'done', phase: 'load', error: dumpErr(load.error) });
  const kind = vm.dump(load.value); load.value.dispose();
  if (kind !== 'function') return send({ type: 'done', phase: 'load', error: { name: 'Contract', message: 'no run() function defined' } });
  const main = vm.evalCode('(async function(){ var r = await run(__task, tools, __ctx); return JSON.stringify(r === undefined ? null : r); })()');
  if (main.error) return send({ type: 'done', phase: 'run', error: dumpErr(main.error) });
  const settled = vm.resolvePromise(main.value); main.value.dispose(); pump();
  const out = await settled;
  if (out.error) return send({ type: 'done', phase: 'run', error: dumpErr(out.error) });
  const s = vm.dump(out.value); out.value.dispose();
  send({ type: 'done', phase: 'run', output: typeof s === 'string' ? s : null });
})().catch((e) => send({ type: 'done', phase: 'host', error: { name: 'Host', message: String(e && e.message || e) } }));
`;

function qjsPath() {
  if (process.env.RARC_QJS_PATH) return process.env.RARC_QJS_PATH;
  try { const req = (0, eval)("require"); return req.resolve("quickjs-emscripten"); } catch { /* ESM context */ }
  return path.join(process.cwd(), "node_modules", "quickjs-emscripten");
}

export async function runInSandbox(r: SandboxRun): Promise<SandboxResult> {
  const L = { ...DEFAULT_LIMITS, ...r.limits };
  const t0 = Date.now();
  const logs: string[] = [];
  const violations = { net: [] as string[], confirm: 0, call_cap: false };
  let killed = false;
  const done = (o: Partial<SandboxResult>): SandboxResult => {
    const duration_ms = Date.now() - t0;
    let error_code = o.error_code ?? null;
    // policy violations are sticky: catching them inside the agent does not hide them
    if (violations.net.length) error_code = "E_NET_DENIED";
    else if (violations.confirm) error_code = "E_CONFIRM_REQUIRED";
    else if (violations.call_cap && (!error_code || error_code === "E_CRASH" || error_code === "E_TOOL")) error_code = "E_RESOURCE";
    return {
      status: error_code ? "error" : o.status ?? "error", error_code,
      error_message: o.error_message ?? (error_code && !o.error_code ? ERROR_CODES[error_code] : undefined),
      answer: error_code ? null : o.answer ?? null, raw: o.raw, logs, duration_ms, violations,
      terminated_within_budget: duration_ms <= L.wallMs + 1000, killed,
    };
  };

  if (!r.skipStatic) {
    const cc = contractCheck(r.code);
    if (!cc.ok) return done({ error_code: "E_CONTRACT", error_message: cc.violations.join("; ") });
  }

  const msg: any = await new Promise((resolve) => {
    const w = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { qjs: qjsPath(), code: r.code, task: r.task, ctx: r.context, limits: L, t0, prelude: PRELUDE },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
      stdout: true, stderr: true,
    });
    let finished = false;
    const finish = (m: any) => { if (finished) return; finished = true; clearTimeout(timer); w.terminate().catch(() => {}); resolve(m); };
    const timer = setTimeout(() => { killed = true; finish({ type: "done", phase: "kill" }); }, L.wallMs + 250);
    w.on("message", (m: any) => {
      if (m.type === "log") { if (logs.length < 200) logs.push(m.msg); }
      else if (m.type === "net") violations.net.push(m.url);
      else if (m.type === "tool") {
        r.toolCall(m.name, m.args).then(
          (res) => { if (res.fatal === "ConfirmRequired") violations.confirm++; if (res.fatal === "ResourceLimit") violations.call_cap = true; if (!finished) w.postMessage({ type: "tool_result", id: m.id, result: res }); },
          (e) => { if (!finished) w.postMessage({ type: "tool_result", id: m.id, result: { error: { code: "TOOL_FAILURE", message: String(e) } } }); },
        );
      } else if (m.type === "done") finish(m);
    });
    w.on("error", (e) => finish({ type: "done", phase: "host", error: { name: "WorkerError", message: String(e?.message ?? e) } }));
    w.on("exit", () => finish({ type: "done", phase: "host", error: { name: "WorkerExit", message: "sandbox worker exited (resource limit)" } }));
  });

  if (msg.phase === "kill") return done({ error_code: "E_TIMEOUT", error_message: `killed after ${L.wallMs} ms wall-clock budget` });
  if (msg.error) {
    const code = mapError(msg.error);
    if (msg.phase === "load") return done({ error_code: code === "E_CRASH" || msg.error.name === "Contract" ? "E_CONTRACT" : code, error_message: "load failed: " + fmtErr(msg.error) });
    return done({ error_code: code, error_message: fmtErr(msg.error) });
  }
  const s = msg.output;
  if (typeof s !== "string") return done({ error_code: "E_MALFORMED_OUTPUT", error_message: "run() result is not serialisable" });
  if (s.length > L.maxOutputBytes) return done({ error_code: "E_RESOURCE", error_message: `output of ${s.length} bytes exceeds cap` });
  let res: any;
  try { res = JSON.parse(s); } catch { return done({ error_code: "E_MALFORMED_OUTPUT", error_message: "output is not JSON" }); }
  const v = validateAgentResult(res, r.category);
  if (!v.ok) return done({ error_code: "E_MALFORMED_OUTPUT", error_message: v.reason, raw: res });
  return done({ status: res.status, answer: res.answer ?? null, raw: res });
}

function fmtErr(e: any) { return e && typeof e === "object" ? `${e.name ?? "Error"}: ${e.message ?? JSON.stringify(e)}` : String(e); }

export function mapError(e: any): ErrorCode {
  const name = e?.name ?? "", msg = String(e?.message ?? e ?? "");
  if (name === "WorkerExit" || name === "WorkerError") return /memory|heap/i.test(msg) || name === "WorkerExit" ? "E_RESOURCE" : "E_CRASH";
  if (name === "InternalError" && /interrupted/.test(msg)) return "E_TIMEOUT";
  if (/out of memory|string too long|stack overflow|Maximum call stack|invalid array length|allocation failed/i.test(msg)) return "E_RESOURCE";
  if (name === "NetDenied") return "E_NET_DENIED";
  if (name === "ConfirmRequired") return "E_CONFIRM_REQUIRED";
  if (name === "ResourceLimit") return "E_RESOURCE";
  if (name === "ToolError") return "E_TOOL";
  if (name === "Host" && /memory|stack/i.test(msg)) return "E_RESOURCE";
  return "E_CRASH";
}

// Run a synthesized wrapper's transform(body, args): pure function, same sandbox, no tools.
export async function runTransform(src: string, body: any, args: any): Promise<{ ok: boolean; value?: any; error?: string }> {
  const code = `${src}\nasync function run(task, tools, context) { return { status: 'success', answer: { __v: transform(task.inputs.body, task.inputs.args) } }; }`;
  const r = await runInSandbox({ code, task: { inputs: { body, args } }, context: {}, toolCall: async () => ({ error: { code: "UNKNOWN_TOOL", message: "no tools in transforms" } }), limits: { wallMs: 1500, memBytes: 16 * 1024 * 1024 }, skipStatic: true });
  if (r.error_code) return { ok: false, error: `${r.error_code}: ${r.error_message ?? ""}` };
  return { ok: true, value: r.answer?.__v };
}
