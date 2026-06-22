# Debug Session: generate-block-timeout

- Status: OPEN
- Symptom: `POST /api/generate-block` returns `504 Gateway Timeout` on Vercel with `FUNCTION_INVOCATION_TIMEOUT`.
- Expected: the endpoint should complete the Gemini call and return `{ markdown }` without timing out.
- Scope: deployed app on Vercel, route `api/generate-block.ts`.
- Notes: no business logic changes applied yet in this session.

## Hypotheses

- H1: the Vercel `edge` function exceeds the platform timeout because the Gemini request itself is taking too long.
- H2: the retry behavior inside `api/generate-block.ts` causes the function to wait longer than the serverless time budget.
- H3: the route is blocking on the Supabase RPC after the Gemini response and that pushes total duration past the limit.
- H4: the `@google/genai` call path used in the `edge` runtime is slower or less compatible in Vercel than in the local Node server.
- H5: payload size or prompt assembly is increasing request latency enough to trigger the platform timeout.

## Evidence Plan

- Add instrumentation around request start, Gemini call start/end, Supabase consume start/end, and final response.
- Reproduce in deploy and compare which stage is the last emitted event before timeout.
- Decide minimal fix only after confirming the slow stage.

## Current Evidence

- User-provided runtime evidence shows Vercel returning `FUNCTION_INVOCATION_TIMEOUT` for `POST /api/generate-block`.
- The failing route was explicitly configured as `runtime: "edge"`.
- The same route performs a full Gemini generation request before responding, which is exactly the kind of long-running task Vercel recommends moving to Node.js rather than Edge.
- After switching the file to `config.runtime = "nodejs"`, the symptom changed immediately to `FUNCTION_INVOCATION_FAILED`, which indicates the timeout path was bypassed and the new failure likely happens during invocation/bootstrap rather than after a long Gemini wait.
- Vercel's current Node.js docs state Node is the default runtime for `/api` functions, so explicit `config.runtime = "nodejs"` is unnecessary and potentially the source of the bootstrap failure.

## Applied Changes

- Added instrumentation points in `api/generate-block.ts` for request entry, Gemini start/end, Supabase RPC start/end, success response, and catch path.
- Added `vercel.json` with `maxDuration` for `api/generate-block.ts`.
- Removed `config.runtime = "nodejs"` from `api/generate-block.ts` and left the function on the default Node.js runtime path with duration controlled by `vercel.json`.
