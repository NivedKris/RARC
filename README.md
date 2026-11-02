# RARC — Real-Time Agent Assembly with Reliability Certification

Research prototype (IIT Kharagpur, CSE). Describe an agent in plain English; RARC assembles a spec-specific
tool-using agent (intake → tool retrieval → OpenAPI wrapper synthesis → code generation), certifies it with
taxonomy-driven adversarial tests in a sandbox, runs real tasks through the same sandbox, and measures whether
the certificate predicts real task success.

One Next.js app = frontend + backend (API routes). Four tabs:

| Tab | What it shows |
| --- | --- |
| **Live Demo** | The full pipeline, stage by stage, with LLM calls, retrieval "why", generated code, certification tests streaming in, and live task traces with checker results. |
| **Methodology** | The method, written like a paper: architecture, contract, sandbox, taxonomy, baselines, benchmark, protocol, threats to validity. |
| **Evaluation** | Every metric from the plan (§6) and tables T1–T8 + figures F1–F3, regenerated from logged runs. |
| **Datasets & Logs** | Benchmark tasks and ground truth, all 45 generated agents (code), the run log, your session's runs and flags, the tool library. |

## Run locally

```bash
cd app
npm install
# keys (server-side only; never sent to the browser or into the sandbox)
printf 'GROQ_API_KEY=...\nGOOGLE_AI_STUDIO_API_KEY=...\n' > .env.local
npm run dev          # http://localhost:3000
```

Pilot specs (P01–P15) are served largely from the committed LLM response cache (`data/llm-cache.json`), so
the demo is fast and reproduces the logged evaluation. Custom specs and "live APIs" mode call the providers.

## Reproduce the evaluation

```bash
cd app
npx tsx scripts/build-tasks.ts                                   # D-Tasks + dataset hash
RARC_CACHE_WRITE=1 npx tsx --env-file=.env.local scripts/eval.ts all   # phases A–I, checkpointed to eval/out/
npx tsx scripts/analyze.ts                                       # → public/results.json (+ determinism check)
```

`scripts/analyze.ts` makes no LLM calls. It recomputes every number from `eval/out/*.json` twice and checks that
the hashes match (M12.1). Re-run a phase with `--force=<phase>` (intake, retrieval, wrappers, agents, tests, runs,
faults, sandbox, tags).

## Deploy on Vercel (GUI)

1. Push this folder to GitHub (`.env*` files are git-ignored).
2. Vercel → Add New Project → import the repo. If `app/` is a subfolder of the repo, set **Root Directory = `app`**.
3. Framework preset: Next.js (auto). Add environment variables `GROQ_API_KEY` and `GOOGLE_AI_STUDIO_API_KEY`.
4. Deploy. The API routes use up to 180 s (`maxDuration`), and the sandbox uses Node worker threads plus
   QuickJS WebAssembly, which are traced into the function bundle by `next.config.ts`.

## Layout

```
lib/       llm.ts (provider layer)  stages.ts (intake/retrieval/codegen)  openapi.ts (wrapper synthesis)
           sandbox.ts (QuickJS in a killable worker)  runtime.ts (execution, taxonomy, test generation, scoring)
           tools.ts (tool library, record/replay, fault injection)  world.ts (simulated providers)
           checkers.ts (checkers, solvers, oracle-free verifier)  specs.ts / tasks.ts (datasets)
           attacks.ts (sandbox attack suite, error-mapping suite, seeded faults)  metrics.ts (statistics)
app/api/   intake · retrieve · synthesize · generate · certify (NDJSON stream) · execute (NDJSON stream) · parse-task · tools
scripts/   record.ts · build-tasks.ts · eval.ts · analyze.ts
data/      recordings.json (replay) · tasks.json · llm-cache.json · embeddings.json
eval/out/  logged runs for every phase (input to analyze.ts)
```
