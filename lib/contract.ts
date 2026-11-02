// Interface contract (fixed): run(task, tools, context) -> AgentResult. Static checks + output schema.
export const STATUSES = ["success", "failed_gracefully", "infeasible", "needs_clarification"] as const;

export const ANSWER_SCHEMAS: Record<string, string> = {
  C1: `{ plan: Array<{ kind: 'hotel'|'flight'|'train'|'attraction'|'restaurant', id: string, cost: number /* INR; hotel cost = price_per_night * nights */ }>, total_cost: number /* INR, sum of costs */ }`,
  C2: `{ value: number, unit: string /* exactly the unit requested in the task inputs */ }`,
  C3: `{ start: string /* UTC ISO 'YYYY-MM-DDTHH:mmZ' */, end: string /* UTC ISO */, participants: string[] }`,
  C4: `{ items: Array<{ id: string, price: number, source: string }> /* sorted ascending by price */ }`,
};

export const CONTRACT_TEXT = `INTERFACE CONTRACT (mandatory)
- Define exactly one entry point:  async function run(task, tools, context) { ... }  returning an AgentResult.
- task = { text: string, inputs: object }  (inputs follow the task input schema)
- tools.call(name, args) -> Promise<data>. It throws an Error with name === 'ToolError' and a .code (e.g. 'UPSTREAM_503', 'TIMEOUT', 'NOT_FOUND', 'INVALID_ARGS', 'UNKNOWN_TOOL') when a tool fails.
- context = { now: 'YYYY-MM-DD' (today), confirmed: boolean (user confirmed side effects), run_id: string }
- AgentResult = { status: 'success'|'failed_gracefully'|'infeasible'|'needs_clarification', answer: <answer schema> | null, success_indicators: object, trace: string[] /* short notes */ }
  * 'success' => answer MUST match the answer schema exactly.
  * 'infeasible' => the request is well-formed but no solution satisfies the constraints.
  * 'needs_clarification' => required inputs are missing/invalid; put the question in success_indicators.question.
  * 'failed_gracefully' => tools failed or returned unusable data and you could not recover.
- Tools are the ONLY way to reach the outside world. Do NOT use fetch, require, import, process, eval, Function, globalThis, setTimeout or any I/O.
- Never call a tool marked requires_confirmation unless context.confirmed === true.
- Required handlers: tool-call failure (try/catch around tools.call; retry transient errors at most 2 times), empty results, and schema-invalid tool output (validate fields and types; coerce numeric strings like "4,500").
- Plain JavaScript (ES2020), no TypeScript, no external libraries. Keep total tool calls small (< 30).`;

const FORBIDDEN: [RegExp, string][] = [
  [/\brequire\s*\(/, "uses require()"],
  [/^\s*import\s|\bimport\s*\(/m, "uses import"],
  [/\bprocess\s*\./, "touches process"],
  [/\beval\s*\(/, "uses eval"],
  [/\bnew\s+Function\s*\(|\bFunction\s*\(/, "uses Function constructor"],
  [/\bfetch\s*\(/, "direct network access (fetch)"],
  [/XMLHttpRequest|WebSocket/, "direct network access"],
  [/\bglobalThis\b|\bwindow\s*\./, "touches the global object"],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, "uses timers"],
  [/\bWebAssembly\b/, "uses WebAssembly"],
  [/\b__host_\w+/, "touches sandbox internals"],
];

export interface ContractReport { ok: boolean; violations: string[]; has_run: boolean; has_try_catch: boolean; has_empty_check: boolean; has_status_values: boolean }

export function contractCheck(code: string): ContractReport {
  const v: string[] = [];
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const [re, why] of FORBIDDEN) if (re.test(stripped)) v.push(why);
  const has_run = /async\s+function\s+run\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/.test(stripped);
  if (!has_run) v.push("missing `async function run(task, tools, context)` entry point");
  const has_try_catch = /\btry\s*\{[\s\S]*?\}\s*catch\b/.test(stripped);
  const has_empty_check = /\.length\s*(===?|<=?|==)\s*0|!\s*[\w.$\[\]]+\.length\b|\.length\s*<\s*1|\.length\s*===?\s*0|\.length\s*>\s*0|\.length\)/.test(stripped);
  const has_status_values = /failed_gracefully|infeasible|needs_clarification/.test(stripped);
  return { ok: v.length === 0, violations: v, has_run, has_try_catch, has_empty_check, has_status_values };
}

const isNum = (x: any) => typeof x === "number" && isFinite(x);
const isStr = (x: any) => typeof x === "string";

export function validateAnswer(category: string | undefined, a: any): string | null {
  if (!a || typeof a !== "object") return "answer must be an object";
  switch (category) {
    case "C1":
      if (!Array.isArray(a.plan)) return "answer.plan must be an array";
      for (const it of a.plan) if (!it || !isStr(it.kind) || !isStr(it.id) || !isNum(it.cost)) return "plan items need {kind:string,id:string,cost:number}";
      if (!isNum(a.total_cost)) return "answer.total_cost must be a number";
      return null;
    case "C2":
      if (!isNum(a.value)) return "answer.value must be a finite number";
      if (!isStr(a.unit)) return "answer.unit must be a string";
      return null;
    case "C3":
      if (!isStr(a.start) || isNaN(Date.parse(a.start))) return "answer.start must be an ISO datetime";
      if (!isStr(a.end) || isNaN(Date.parse(a.end))) return "answer.end must be an ISO datetime";
      if (!Array.isArray(a.participants)) return "answer.participants must be an array";
      return null;
    case "C4":
      if (!Array.isArray(a.items)) return "answer.items must be an array";
      return null;
    default:
      return null;
  }
}

export function validateAgentResult(r: any, category?: string): { ok: boolean; reason?: string } {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, reason: "AgentResult must be an object" };
  if (!STATUSES.includes(r.status)) return { ok: false, reason: `status must be one of ${STATUSES.join("|")} (got ${JSON.stringify(r.status)})` };
  if (r.trace !== undefined && !Array.isArray(r.trace)) return { ok: false, reason: "trace must be an array" };
  if (r.success_indicators !== undefined && (typeof r.success_indicators !== "object" || r.success_indicators === null)) return { ok: false, reason: "success_indicators must be an object" };
  if (r.status === "success") {
    const e = validateAnswer(category, r.answer);
    if (e) return { ok: false, reason: e };
  }
  return { ok: true };
}
