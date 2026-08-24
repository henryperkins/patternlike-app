# Codex Production Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable outbound-polling provider that runs Pattern and ontology inference through the supported local Codex CLI using the funded ChatGPT subscription.

**Architecture:** The Cloudflare Worker persists encrypted invocation/result artifacts in R2 and non-content lease state in D1. A single-concurrency Node daemon claims work over a dedicated authenticated API, executes `codex exec --output-schema`, and returns exact output plus usage; existing validators, retries, signatures, and publication remain authoritative.

**Tech Stack:** TypeScript strict ESM, Hono, Cloudflare Workers, D1, R2, Vitest, Node 20 child processes, Codex CLI non-interactive mode

**Spec:** `docs/superpowers/specs/2026-08-24-codex-production-provider-design.md`

## Global Constraints

- Never call `chatgpt.com/backend-api/codex/responses` from application code.
- Never copy ChatGPT-managed authentication off the dedicated runner.
- Never put prompt or response plaintext in D1, Queue messages, arguments, or logs.
- Keep the runner off the AGPL calculation service and host.
- Preserve frozen public schemas and wire fields.
- Launch with exactly one concurrent Codex invocation.
- Pending work does not consume a domain attempt; each claimed CLI invocation consumes one existing daily-budget unit.
- Store output create-only and reject conflicting bytes at one immutable coordinate.
- Keep Pattern rollout off until a machine ontology succeeds and is activated.
- Use test-first development for every source behavior change.

## File Map

- `db/d1/0013_codex_provider_jobs.sql`: durable jobs, leases, and encrypted-artifact inventory.
- `apps/api/src/services/codex-provider-contract.ts`: strict wire types, limits, and prompt/schema conversion.
- `apps/api/src/services/codex-provider-artifacts.ts`: AES-GCM R2 storage and adoption.
- `apps/api/src/db/codex-provider-jobs.ts`: enqueue, claim, lease fencing, and terminal CAS.
- `apps/api/src/routes/codex-provider.ts`: authenticated claim/complete/fail endpoints.
- `apps/api/src/services/codex-pattern-publisher.ts`: asynchronous Pattern projection.
- `apps/api/src/services/codex-ontology-publisher.ts`: asynchronous ontology projection.
- `apps/codex-runner/`: production Node daemon and tests.
- `docs/deploy/codex-production-provider.md`: deployment, repair, and rollback runbook.

---

### Task 1: Freeze the job protocol and durable encrypted storage

**Files:**
- Create: `db/d1/0013_codex_provider_jobs.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Create: `apps/api/src/services/codex-provider-contract.ts`
- Create: `apps/api/src/services/codex-provider-contract.test.ts`
- Create: `apps/api/src/services/codex-provider-artifacts.ts`
- Create: `apps/api/src/services/codex-provider-artifacts.test.ts`
- Create: `apps/api/src/db/codex-provider-jobs.ts`
- Create: `apps/api/src/db/codex-provider-jobs.test.ts`

**Interfaces:**
- Produces: `CodexProviderInvocation`, `CodexProviderCompletion`, `CodexProviderFailure`, `enqueueCodexProviderJob`, `claimCodexProviderJob`, `completeCodexProviderJob`, `failCodexProviderJob`, `putCodexProviderArtifact`, and `readCodexProviderArtifact`.
- Consumed by: the publishers and runner HTTP routes in later tasks.

- [ ] **Step 1: Write failing migration and protocol tests**

Require migration 0013 at the ordered tail. Test strict completion parsing:

```ts
expect(parseCodexProviderCompletion({
  lease_token: "lease-token-with-at-least-32-characters",
  output: "{\"ok\":true}",
  provider_request_id: "thread_123",
  input_tokens: 10,
  output_tokens: 4,
})).toMatchObject({ ok: true });
expect(parseCodexProviderCompletion({ output: "secret" })).toEqual({ ok: false });
```

The D1 tests must prove duplicate enqueue adopts one row, expired leases are
reclaimable, stale lease tokens cannot finish, identical completion is
idempotent, and conflicting output hashes fail closed.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run src/services/codex-provider-contract.test.ts src/services/codex-provider-artifacts.test.ts src/db/codex-provider-jobs.test.ts -w @patternlike/api
```

Expected: imports/migration missing, not an unrelated setup error.

- [ ] **Step 3: Add the additive D1 schema**

Create `codex_provider_jobs` with closed `pipeline` (`pattern|ontology`), `pass`
(`planner|writer|verifier|generator|evaluator`), and status
(`pending|leased|completed|failed|cancelled`). Store owner/user coordinate,
stage generation/attempt, frozen model/reasoning/prompt/timeout/daily limit,
request and response R2 pointers plus hashes, lease-token hash/expiry, safe
terminal metadata, and lifecycle timestamps. Enforce:

```sql
UNIQUE (pipeline, owner_id, pass, stage_generation, stage_attempt, request_hash)
```

Add full repository-style SHA-256/timestamp/cross-column CHECKs, a partial FIFO
index on `(available_at, created_at, id)` for claimable rows, and an erasure
index on `(user_id, id)`. Extend the clean and populated migration lanes and
require zero `PRAGMA foreign_key_check` rows.

- [ ] **Step 4: Implement strict protocol conversion**

Expose:

```ts
export const CODEX_PROVIDER_TIMEOUT_MS = 900_000;
export const CODEX_PROVIDER_LEASE_MS = 1_200_000;
export const CODEX_PROVIDER_MAX_REQUEST_BYTES = 256 * 1024;
export const CODEX_PROVIDER_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface CodexProviderInvocation {
  schema_version: "codex-provider-invocation/v1";
  prompt: string;
  output_schema: Record<string, unknown>;
}
```

`invocationFromResponsesRequest` accepts only the repository's one-system / one
`input_text` shape, combines them with an explicit delimiter, and returns the
exact strict `text.format.schema`. Reject extra parts, missing strict schema,
and model/pin mismatch.

- [ ] **Step 5: Implement encrypted create-only R2 artifacts**

Reuse reviewed AES-GCM/keyring primitives but define Codex-specific AAD and
envelope version. Expose:

```ts
putCodexProviderArtifact(env, coordinate, plaintext): Promise<CodexProviderArtifactRecord>
readCodexProviderArtifact(env, record): Promise<Uint8Array>
```

Use conditional create, adopt only byte-identical existing envelopes, and throw
closed unavailable/conflict/integrity errors. Never log plaintext or crypto
exceptions.

- [ ] **Step 6: Implement D1 enqueue, lease, and terminal CAS**

Hash lease tokens before persistence. Claim one eligible FIFO row using a CAS.
Completion/failure must match job id, `leased` state, unexpired lease, and
lease-token hash. First terminal bytes win; replay with the same hash adopts.

- [ ] **Step 7: Run focused verification**

```bash
npx vitest run src/services/codex-provider-contract.test.ts src/services/codex-provider-artifacts.test.ts src/db/codex-provider-jobs.test.ts -w @patternlike/api
npm run test:contracts
```

Expected: all pass.

- [ ] **Step 8: Commit the protocol slice**

```bash
git add db/d1/0013_codex_provider_jobs.sql db/d1/MIGRATIONS.json apps/api/test/apply-migrations.ts apps/api/src/services/codex-provider-contract.ts apps/api/src/services/codex-provider-contract.test.ts apps/api/src/services/codex-provider-artifacts.ts apps/api/src/services/codex-provider-artifacts.test.ts apps/api/src/db/codex-provider-jobs.ts apps/api/src/db/codex-provider-jobs.test.ts
git commit -m "api: add durable Codex provider jobs"
```

---

### Task 2: Expose the dedicated runner control plane

**Files:**
- Create: `apps/api/src/middleware/codex-runner-auth.ts`
- Create: `apps/api/src/middleware/codex-runner-auth.test.ts`
- Create: `apps/api/src/routes/codex-provider.ts`
- Create: `apps/api/src/routes/codex-provider.integration.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`

**Interfaces:**
- Consumes: Task 1 job/artifact APIs.
- Produces: dedicated claim/complete/fail HTTP protocol and safe domain nudges.

- [ ] **Step 1: Write failing auth and route tests**

Drive the real Hono app. Unauthenticated and `SERVICE_AUTH_TOKEN` requests both
return `401`; only `CODEX_RUNNER_TOKEN` can claim. Assert a successful claim is:

```ts
{
  schema_version: "codex-provider-claim/v1",
  job_id: expect.stringMatching(/^cpjob_/),
  lease_token: expect.any(String),
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  timeout_ms: 900000,
  invocation: {
    schema_version: "codex-provider-invocation/v1",
    prompt: expect.any(String),
    output_schema: expect.any(Object),
  },
}
```

Also cover `204` no-work, same-hash replay `200`, conflicting completion `409`,
stale lease `409`, strict size limits, and error bodies that never echo output.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run src/middleware/codex-runner-auth.test.ts src/routes/codex-provider.integration.test.ts -w @patternlike/api
```

Expected: missing middleware/routes.

- [ ] **Step 3: Implement digest-based dedicated auth**

Add `CODEX_RUNNER_TOKEN` and `CODEX_PROVIDER_ARTIFACT_KEYRING` to `Env`. Require
exactly one Bearer token, hash expected and presented UTF-8 bytes, compare the
fixed-length digests, and provide no development/service/consumer fallback.

- [ ] **Step 4: Implement claim, complete, and fail**

Mount `/codex-provider/v1` outside consumer and `/internal` service auth. On
claim: prove the domain coordinate current, lease, consume its existing budget,
decrypt the request, then respond. On complete: persist exact output before D1
completion. On failure: persist only closed safe metadata. After either terminal
commit, clear the domain outbox marker and send its existing opaque Queue
message; a send failure remains repairable and does not undo completion.

- [ ] **Step 5: Add closed operational events**

Add exhaustive safe-log variants for job claimed/completed/failed/conflict and
dispatch failure. Permit only job id, pipeline, pass, model, latency, token
counts, hashes, and closed codes.

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run src/middleware/codex-runner-auth.test.ts src/routes/codex-provider.integration.test.ts src/services/safe-log.test.ts -w @patternlike/api
```

Expected: all pass without content in console output.

- [ ] **Step 7: Commit the control plane**

```bash
git add apps/api/src/middleware/codex-runner-auth.ts apps/api/src/middleware/codex-runner-auth.test.ts apps/api/src/routes/codex-provider.ts apps/api/src/routes/codex-provider.integration.test.ts apps/api/src/index.ts apps/api/src/env.ts apps/api/src/services/safe-log.ts apps/api/test/hermetic-bindings.ts
git commit -m "api: expose Codex runner control plane"
```

---

### Task 3: Integrate asynchronous Codex work with Pattern generation

**Files:**
- Create: `apps/api/src/services/codex-pattern-publisher.ts`
- Create: `apps/api/src/services/codex-pattern-publisher.test.ts`
- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/services/pattern-publisher-factory.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Create: `apps/api/src/services/pattern-execute-codex.test.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/config.test.ts`

**Interfaces:**
- Consumes: Task 1 enqueue/adopt APIs and Task 2 completion nudge.
- Produces: planner/writer/verifier jobs that pause and resume at the exact attempt coordinate.

- [ ] **Step 1: Write failing publisher and executor tests**

First publisher call returns:

```ts
{ ok: false, code: "publisher_pending", job_id: expect.stringMatching(/^cpjob_/) }
```

without budget usage. A later call adopts a completed artifact with exact
`codex` model/prompt provenance, thread id, integer token counts, and response
hash. For planner, writer, and verifier, a pending executor result must leave
stage, stage generation, and pass attempt unchanged, clear its domain claim,
and acknowledge the Queue delivery. Redelivery after completion must apply the
existing validator and advance normally.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run src/services/codex-pattern-publisher.test.ts src/services/pattern-stage-protocol.test.ts src/services/pattern-execute-codex.test.ts -w @patternlike/api
```

Expected: `publisher_pending` and same-coordinate wait transition missing.

- [ ] **Step 3: Add a pending control arm**

Extend `PatternPassOutcome<T>` with:

```ts
{ ok: false; code: "publisher_pending"; job_id: string }
```

It has no origin/retry/detail because no provider call occurred. Exclude it from
provider failure telemetry and retry mapping.

- [ ] **Step 4: Implement `createCodexPatternPublisher`**

Build the same strict Responses document as the OpenAI publisher, convert it to
the generic invocation, and enqueue using the executor's immutable coordinate.
Adopt completed/failed rows before enqueue. Parse successful output without
repair and project truthful `codex` provenance; project stored failures through
the existing closed provider-failure arm.

- [ ] **Step 5: Add `await_provider` to the Pattern protocol**

The guarded transition releases generic and Pattern job ownership, clears
claim/lease, and marks its outbox already dispatched without changing stage,
generation, attempt, or hashes. Completion later clears `dispatched_at` and
sends the opaque existing nudge.

- [ ] **Step 6: Select the supported publisher and configuration**

When a frozen pin names `codex`, construct the asynchronous publisher instead
of the Responses transport. Remove Worker requirements for `CODEX_AUTH_TOKEN`
and `CODEX_ACCOUNT_ID`; require runner token, artifact keyring, ARTIFACTS, and no
AI Gateway. Use 900000 ms only for Codex while preserving OpenAI's 120000 ms.

- [ ] **Step 7: Run focused Pattern verification**

```bash
npx vitest run src/services/codex-pattern-publisher.test.ts src/services/pattern-stage-protocol.test.ts src/services/pattern-execute-codex.test.ts src/services/pattern-execute-openai.test.ts src/services/pattern-publisher.test.ts src/config.test.ts -w @patternlike/api
```

Expected: Codex wait/adoption and unchanged OpenAI/synthetic behavior pass.

- [ ] **Step 8: Commit the Pattern integration**

```bash
git add apps/api/src/services/codex-pattern-publisher.ts apps/api/src/services/codex-pattern-publisher.test.ts apps/api/src/services/pattern-publisher.ts apps/api/src/services/pattern-publisher-factory.ts apps/api/src/services/pattern-stage-protocol.ts apps/api/src/services/pattern-stage-protocol.test.ts apps/api/src/services/pattern-execute.ts apps/api/src/services/pattern-execute-codex.test.ts apps/api/src/middleware/config-guard.ts apps/api/src/config.test.ts
git commit -m "api: run Pattern passes through Codex jobs"
```

---

### Task 4: Integrate ontology generation, evaluation, and regression

**Files:**
- Create: `apps/api/src/services/codex-ontology-publisher.ts`
- Create: `apps/api/src/services/codex-ontology-publisher.test.ts`
- Modify: `apps/api/src/services/ontology-publisher.ts`
- Modify: `apps/api/src/db/ontology-pipeline.ts`
- Modify: `apps/api/src/db/ontology-pipeline.test.ts`
- Modify: `apps/api/src/services/ontology-pipeline-execute.ts`
- Create: `apps/api/src/services/ontology-pipeline-codex.integration.test.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`

**Interfaces:**
- Consumes: generic jobs and the Pattern Codex publisher.
- Produces: generator/evaluator plus all regression calls through the same runner.

- [ ] **Step 1: Write failing wait/adoption tests**

Cover one generator, evaluator, and regression planner job. First delivery
creates one work row and defers without incrementing `stage_attempt`. Completion
redelivers, adopts exact bytes, writes the existing domain response artifact,
and continues validation. Duplicate Queue delivery creates no second work row
and consumes no second budget unit.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run src/services/codex-ontology-publisher.test.ts src/db/ontology-pipeline.test.ts src/services/ontology-pipeline-codex.integration.test.ts -w @patternlike/api
```

Expected: missing publisher/defer behavior.

- [ ] **Step 3: Add ontology pending and defer APIs**

Add the same `publisher_pending` control arm and:

```ts
export async function deferOntologyPipelineForProvider(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  now: Date,
): Promise<boolean>;
```

The CAS clears the claim and holds the outbox without changing stage,
generation, cursor, attempt, or evidence.

- [ ] **Step 4: Implement generator/evaluator adoption**

Use existing strict request builders and the generic invocation converter.
Return truthful `codex` metadata; widen `OntologyPassMetadata.provider` and its
exact check to the frozen publisher rather than hardcoding `openai`.

- [ ] **Step 5: Route regression through Pattern Codex jobs**

Coordinate regression planner/writer/verifier jobs by run, stage generation,
stage attempt, and pass. Preserve existing regression artifacts and scoring. A
pending pass defers the same cursor; completion is wrapped in the existing
`ontology-regression-response/v1` format.

- [ ] **Step 6: Run focused ontology verification**

```bash
npx vitest run src/services/codex-ontology-publisher.test.ts src/db/ontology-pipeline.test.ts src/services/ontology-pipeline-codex.integration.test.ts src/services/ontology-pipeline.integration.test.ts -w @patternlike/api
```

Expected: all pass, including unchanged OpenAI test publishers.

- [ ] **Step 7: Commit ontology integration**

```bash
git add apps/api/src/services/codex-ontology-publisher.ts apps/api/src/services/codex-ontology-publisher.test.ts apps/api/src/services/ontology-publisher.ts apps/api/src/db/ontology-pipeline.ts apps/api/src/db/ontology-pipeline.test.ts apps/api/src/services/ontology-pipeline-execute.ts apps/api/src/services/ontology-pipeline-codex.integration.test.ts apps/api/src/middleware/config-guard.ts
git commit -m "api: run ontology passes through Codex jobs"
```

---

### Task 5: Build the unattended Codex CLI runner

**Files:**
- Create: `apps/codex-runner/package.json`
- Create: `apps/codex-runner/tsconfig.json`
- Create: `apps/codex-runner/src/protocol.ts`
- Create: `apps/codex-runner/src/client.ts`
- Create: `apps/codex-runner/src/codex-cli.ts`
- Create: `apps/codex-runner/src/codex-cli.test.ts`
- Create: `apps/codex-runner/src/runner.ts`
- Create: `apps/codex-runner/src/runner.test.ts`
- Create: `apps/codex-runner/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 2 protocol and a locally authenticated `codex` binary.
- Produces: `runCodexInvocation`, `CodexProviderClient`, and daemon entry point.

- [ ] **Step 1: Write failing process and poll-loop tests**

Use a fake executable that reads stdin, emits `thread.started` and
`turn.completed` JSONL, and writes schema-valid output to `-o`. Assert exact
safe arguments:

```ts
[
  "exec", "--ephemeral", "--sandbox", "read-only", "--json",
  "--model", "gpt-5.6-sol",
  "--config", "model_reasoning_effort=\"high\"",
  "--output-schema", schemaPath,
  "-o", outputPath,
  "-",
]
```

Prompt appears only on stdin; temp files are `0600`; cleanup always happens;
oversized output and missing usage/thread fail; timeout terminates the child;
logs never include prompt/output/stdout/stderr. Poll-loop tests prove one claim
maps to exactly one complete or fail call and `204` uses bounded jitter.

- [ ] **Step 2: Run runner tests and verify RED**

```bash
npm test -w @patternlike/codex-runner
```

Expected: workspace/modules missing.

- [ ] **Step 3: Implement strict HTTP client and process wrapper**

Use Node global `fetch`, Bearer auth, bounded reads, abort deadlines, and exact
response parsing. Spawn without a shell, pipe prompt stdin, capture bounded
JSONL, require one thread id and integer usage, read bounded output, and remove
the owner-only temp directory in `finally`. Map failures only to the Worker's
closed codes; discard stderr text.

- [ ] **Step 4: Implement single-concurrency daemon**

Validate `PATTERNLIKE_API_ORIGIN`, `CODEX_RUNNER_TOKEN`, `CODEX_BIN`, and poll
interval at startup. Reject concurrency other than `1`. Poll, jitter after 204,
execute one claim, submit its terminal result, and honor SIGINT/SIGTERM after
the active invocation.

- [ ] **Step 5: Add workspace to root gates and verify**

Add `@patternlike/codex-runner` to root typecheck/test/build, then run:

```bash
npm install
npm run typecheck -w @patternlike/codex-runner
npm test -w @patternlike/codex-runner
npm run build -w @patternlike/codex-runner
```

Expected: all pass and `dist/index.js` runs on Node 20.

- [ ] **Step 6: Commit the runner**

```bash
git add apps/codex-runner package.json package-lock.json
git commit -m "runner: add unattended Codex inference daemon"
```

---

### Task 6: Remove the private backend and close lifecycle/security gaps

**Files:**
- Modify: `apps/api/src/services/reading-publisher.ts`
- Modify: `apps/api/src/services/openai-responses-adapter.ts`
- Modify: `apps/api/src/services/openai-pattern-publisher.ts`
- Modify: `apps/api/src/services/openai-ontology-publisher.ts`
- Modify: `apps/api/src/services/codex-publisher.test.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`
- Modify: `apps/api/src/services/pattern-sweep.ts`
- Modify: `apps/api/src/services/ontology-pipeline-artifacts.ts`
- Modify: `apps/api/wrangler.toml`
- Create: `docs/deploy/codex-production-provider.md`

**Interfaces:**
- Consumes: completed Worker and runner implementation.
- Produces: one supported Codex path, bounded repair/retention, erasure, and deployment operations.

- [ ] **Step 1: Write failing absence, erasure, and repair tests**

Assert the Worker bundle contains neither
`chatgpt.com/backend-api/codex/responses` nor `chatgpt-account-id`, and config has
no `CODEX_AUTH_TOKEN`/`CODEX_ACCOUNT_ID`. User deletion must collect both Codex
R2 objects and delete the D1 job before its Pattern owner. Scheduled repair must
re-dispatch completed jobs after a nudge failure, cancel stale jobs, and expire
ontology-owned artifacts with the run's retention.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run src/services/codex-publisher.test.ts src/services/deletion-manifest.test.ts src/services/pattern-sweep.test.ts src/services/ontology-pipeline-artifacts.test.ts -w @patternlike/api
```

Expected: direct endpoint/credentials remain and lifecycle coverage is absent.

- [ ] **Step 3: Delete direct Codex transport behavior**

Remove `CODEX_RESPONSES_URL`, Codex request headers, SSE assembly, and the Codex
branch from the OpenAI adapter. Preserve OpenAI behavior byte-for-byte. Replace
direct-backend tests with durable-job selection and forbidden-literal tests.

- [ ] **Step 4: Register deletion, retention, and repair**

Add a deletion artifact family under `codex-provider-jobs/`, classify the
user-owned D1 rows in dependency-safe order, and collect request/response keys.
Add bounded sweeps for stale/terminal jobs and objects. Never delete a leased or
domain-current pending job.

- [ ] **Step 5: Update configuration and write the runbook**

Document migration-before-deploy, interactive `wrangler secret put`, local
`codex login`, a mode-0600 service environment file, systemd start/stop/status,
rollout-off smoke checks, ontology activation, Pattern canary, budget queries,
repair, credential expiry, and rollback. No secret value appears in an argument
or example.

- [ ] **Step 6: Run hardening verification**

```bash
npx vitest run src/services/codex-publisher.test.ts src/services/deletion-manifest.test.ts src/services/pattern-sweep.test.ts src/services/ontology-pipeline-artifacts.test.ts -w @patternlike/api
npm run test:wrangler-config -w @patternlike/api
npm run build -w @patternlike/api
```

Expected: all pass and the dry-run bundle has no private backend literal.

- [ ] **Step 7: Commit hardening and operations**

```bash
git add apps/api/src/services/reading-publisher.ts apps/api/src/services/openai-responses-adapter.ts apps/api/src/services/openai-pattern-publisher.ts apps/api/src/services/openai-ontology-publisher.ts apps/api/src/services/codex-publisher.test.ts apps/api/src/services/deletion-manifest.ts apps/api/src/services/deletion-manifest.test.ts apps/api/src/services/pattern-sweep.ts apps/api/src/services/ontology-pipeline-artifacts.ts apps/api/wrangler.toml docs/deploy/codex-production-provider.md
git commit -m "api: harden Codex provider operations"
```

---

### Task 7: Verify, deploy, and generate the production canary

**Files:**
- Modify only with observed facts: `docs/deploy/2026-08-23-pattern-generation-handoff.md`
- Generated outside git: owner-only runner environment and installed service unit.

**Interfaces:**
- Consumes: Tasks 1–6, production D1/R2/Queues, signer Worker, and the dedicated non-AGPL host.
- Produces: one active validated ontology and one retrievable Pattern with Codex provenance.

- [ ] **Step 1: Run complete offline verification**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all workspace, contract, migration, calculation, and Worker dry-run
lanes pass. Save command summaries only, not generated prose.

- [ ] **Step 2: Run one local real-protocol canary**

Start the Worker locally with fresh ignored runner/keyring secrets, use the
existing authenticated local Codex CLI, start the compiled runner, enqueue one
synthetic non-reader test job through the real claim protocol, and assert
terminal success plus nonzero usage without printing prompt/output.

- [ ] **Step 3: Apply migration 0013 before deploying code**

After the runbook's read-only preflight and backup:

```bash
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Expected: only 0013 applies, foreign-key check is empty, and existing counts are
unchanged.

- [ ] **Step 4: Provision and deploy with rollouts off**

Pipe fresh `CODEX_RUNNER_TOKEN` and `CODEX_PROVIDER_ARTIFACT_KEYRING` values to
Wrangler secret stdin, deploy, and prove health plus Pattern rollout off. Never
reuse `SERVICE_AUTH_TOKEN`.

- [ ] **Step 5: Install the runner service**

On the approved non-AGPL host, run `codex login` interactively, install the
compiled runner under a dedicated unprivileged account, create its mode-0600
environment, start it, and verify idle `204` polling with no auth/content logs.

- [ ] **Step 6: Generate and activate one production ontology**

Enable only internal ontology rollout and enqueue the next immutable candidate.
Monitor safe state to success. Verify generator/evaluator/regression counters,
signed bundle, evaluation/regression receipts, active pointer, and zero
pending/leased Codex jobs. Restore rollout off on a terminal gate failure; never
ingest the local diagnostic corpus.

- [ ] **Step 7: Generate one production Pattern canary**

Enable internal Pattern rollout for only the approved account, use normal
consent/first-open flow, and monitor opaque status to publication. Verify one
accepted claim/document, planner/writer/verifier usage, `provider: "Codex"`,
encrypted artifact integrity, ontology linkage, word-count validation, and
authenticated reader retrieval.

- [ ] **Step 8: Record observed outcome**

Update the handoff with version ids, safe run/generation ids, counts, timings,
and closed pass/failure codes only; exclude content, credentials, birth data,
decrypted packets, and raw output.

```bash
git add docs/deploy/2026-08-23-pattern-generation-handoff.md
git commit -m "deploy: record Codex Pattern canary"
```

## Plan Self-Review

- Spec coverage: jobs, encryption, auth, budget ordering, pipeline deferral, all
  five pass classes, CLI execution, erasure, retention, repair, rollout, and
  canary verification each have an owning task.
- Placeholder scan: every step names concrete behavior, files, commands, and an
  expected result; no deferred implementation marker remains.
- Type consistency: `publisher_pending`, immutable coordinates, 900000 ms
  timeout, terminal failure codes, and provenance metadata are consistent.
- Scope: no new inbound runner service, public contract change, AGPL component
  change, hidden retry, or alternate ChatGPT endpoint is included.
