# Codex Daily Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Daily v5 generation from a synchronous OpenAI Worker call to the existing durable Codex runner, while preserving frozen-command truth, four-attempt retry semantics, first-open/scheduled convergence, encrypted artifacts, and historical OpenAI readability.

**Architecture:** Extend `codex_provider_jobs` with the closed `reading/publisher` coordinate. A Daily Queue claim prepares the frozen request, creates or adopts one encrypted Codex job, and releases its own lease as `publisher_pending`. Provider terminalization nudges the ordinary opaque Daily Queue message; the next claim adopts and validates the response or advances to a fresh Daily/provider attempt under the existing retry policy.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/Queues/D1/R2/Cron Triggers, Vitest, Node test, JSON Schema/OpenAPI, Python contract validators, and the existing `@patternlike/codex-runner` protocol.

**Spec:** [`../specs/2026-08-27-codex-daily-pattern-design.md`](../specs/2026-08-27-codex-daily-pattern-design.md)

## Global Constraints

- This is plan 1 of 3. Complete it before the account-wide Pattern plan, then execute the production rollout plan last.
- Start from an isolated, clean worktree. Preserve unrelated edits in the planning checkout, especially the existing `db/d1/MIGRATIONS.json` production note.
- Do not apply `0017` to production, merge to `main`, deploy, change Worker secrets, or invoke a real provider in this plan. Those actions belong to [`2026-08-27-codex-reader-rollout.md`](./2026-08-27-codex-reader-rollout.md).
- Daily and Pattern have no live OpenAI, Workers AI, or synthetic fallback. Ontology's separately configured provider remains outside this plan.
- Keep `READING_V5_ROLLOUT` as Daily's kill switch. Keep Queue messages at exactly `{job_id, reading_id}`.
- Never put provider job ids, prompts, responses, lease tokens, artifact keys, user ids, birth facts, consent ids, or generated prose in Queue messages or logs.
- Use tests first for every behavior change. Observe the named test fail for the expected reason before editing production code.
- After each task, review `git diff --check`, stage only the listed files, and make the named focused commit.

---

## Task 1: Widen M5 provenance without rewriting history

**Files:**

- Modify: `packages/shared/src/m5-reading-types.ts`
- Modify: `packages/shared/src/m5-reading-types.test.ts`
- Modify: `contracts/m5/common.schema.json`
- Modify: `contracts/m5/generation-command.schema.json`
- Modify: `contracts/m5/reading-evidence.schema.json`
- Modify: `contracts/m5/daily-reading.schema.json`
- Modify: `contracts/m5/openapi/openapi.yaml`
- Modify: `contracts/m5/fixtures/generate_fixtures.py`
- Modify: `contracts/m5/fixtures/valid/generation-command.v2.json`
- Modify: `contracts/m5/fixtures/valid/daily-reading.published.json`
- Modify: `contracts/m5/fixtures/valid/reading-evidence.daily.json`
- Create: `contracts/m5/fixtures/valid/generation-command.codex.json`
- Create: `contracts/m5/fixtures/valid/daily-reading.codex.json`
- Create: `contracts/m5/fixtures/valid/reading-evidence.codex.json`
- Create: `contracts/m5/fixtures/invalid/generation-command.unknown-provider.json`
- Create: `contracts/m5/fixtures/invalid/reading-evidence.unknown-provider.json`
- Modify: `apps/api/src/services/stored-reading.ts`
- Modify: `apps/api/src/services/generation-command-v2.test.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`
- Modify: `apps/api/src/routes/readings.integration.test.ts`
- Modify: `apps/api/src/routes/privacy-export.integration.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.test.ts`
- Modify: `apps/web/src/test/reading-fixture.ts`
- Modify: `apps/web/src/components/TodayView.test.tsx`

**Interfaces:**

- Consumes: existing M5 `PublisherConfigPin`, `ModelRecordV5`, JSON Schemas, OpenAPI components, and fixture generator.
- Produces: `READING_PUBLISHER_PROVIDERS`, `ReadingPublisherProvider`, and matching wire contracts that accept exactly historical `openai` plus new `codex` provenance.

- [x] Add failing shared/API/web tests proving both historical `openai` and new `codex` commands, stored readings, evidence responses, privacy exports, and browser fixtures are accepted, while `anthropic` is rejected.
- [x] Run the narrow tests and confirm the Codex cases fail because the provider is still a literal `openai`:

      npm run test -w @patternlike/shared
      npm exec -w @patternlike/api -- vitest run src/services/generation-command-v2.test.ts src/services/generation.integration.test.ts src/routes/readings.integration.test.ts src/routes/privacy-export.integration.test.ts
      npm exec -w @patternlike/web -- vitest run src/lib/api-client.test.ts src/components/TodayView.test.tsx

- [x] Introduce one shared closed vocabulary and use it in `PublisherConfigPin` and `ModelRecordV5`:

      export const READING_PUBLISHER_PROVIDERS = ["openai", "codex"] as const;
      export type ReadingPublisherProvider =
        (typeof READING_PUBLISHER_PROVIDERS)[number];

- [x] Change JSON Schema provider constraints from `const: "openai"` to the exact enum `["openai", "codex"]`; do not change `$id` or schema version `0.5.0`.
- [x] Keep the existing OpenAI fixtures valid. Generate separate Codex fixtures with disclosure exactly:

      Generated with Codex by OpenAI from your calculated chart and enabled context.

- [x] Update `isModelRecord` in `stored-reading.ts` to admit only the two known lowercase values:

      if (value.provider !== "openai" && value.provider !== "codex") return false;

- [x] Type the browser's `EvidenceModelRecordV5.provider` with the shared `ReadingPublisherProvider` union. Give the Codex browser fixture the exact Codex disclosure and prove Today, Why this, saved-reading, and export projections preserve that provider rather than relabeling it.

- [x] Update descriptions that equate nondeterminism with OpenAI specifically; describe the frozen external publisher instead.
- [x] Regenerate fixtures and run every M5 validation lane:

      python contracts/m5/fixtures/generate_fixtures.py
      npm run test -w @patternlike/shared
      npm run test:contracts
      npm exec -w @patternlike/api -- vitest run src/services/generation-command-v2.test.ts src/services/generation.integration.test.ts src/routes/readings.integration.test.ts src/routes/privacy-export.integration.test.ts
      npm exec -w @patternlike/web -- vitest run src/lib/api-client.test.ts src/components/TodayView.test.tsx

- [x] Confirm the checked-in historical OpenAI fixture bytes were not silently converted to Codex.
- [x] Commit: `contracts: admit Codex Daily provenance`

## Task 2: Add the forward-only `reading/publisher` D1 coordinate

**Files:**

- Create: `db/d1/0017_codex_reading_provider.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Create: `apps/api/src/db/codex-provider-schema.test.ts`

**Interfaces:**

- Consumes: the exact `0013_codex_provider_jobs.sql` parent and `0014_codex_provider_response_uploads.sql` child definitions.
- Produces: migration `0017`, under which `reading/publisher` with a non-null user is legal while every other newly possible pipeline/pass/user combination remains illegal.

- [x] Add a failing clean-apply test asserting `reading/publisher` is legal and every cross-pipeline pass mismatch is rejected.
- [x] Add a failing populated-upgrade lane. Seed legal Pattern and ontology parents spanning `pending`, `leased`, `completed`, `failed`, and `cancelled`; include every nullable terminal field, two response-upload child rows, and all referenced users before applying `0017`.
- [x] Snapshot every parent and child column before upgrade with stable ordering, then assert deep equality after upgrade.
- [x] Run the new test and confirm it fails because `0017` does not exist:

      npm exec -w @patternlike/api -- vitest run src/db/codex-provider-schema.test.ts

- [x] Write `0017` as one forward-only rebuild with `PRAGMA foreign_keys = ON` and `PRAGMA defer_foreign_keys = ON`. Stage child rows before dropping the child and parent, copy every parent column explicitly, recreate the child and index, restore every child, assert counts, and remove staging state.
- [x] Preserve every lifecycle, envelope, lease, timestamp, nonce, hash, safe-failure, and uniqueness constraint from `0013`/`0014`. Widen only these relationships:

      CHECK (pipeline IN ('pattern', 'ontology', 'reading'))
      CHECK (pass IN (
        'planner', 'writer', 'verifier', 'generator', 'evaluator', 'publisher'
      ))
      CHECK (
        (pipeline = 'pattern' AND pass IN ('planner', 'writer', 'verifier'))
        OR (pipeline = 'ontology' AND pass IN (
          'planner', 'writer', 'verifier', 'generator', 'evaluator'
        ))
        OR (pipeline = 'reading' AND pass = 'publisher')
      )
      CHECK (
        (pipeline IN ('pattern', 'reading') AND user_id IS NOT NULL)
        OR (pipeline = 'ontology' AND user_id IS NULL)
      )

- [x] Make assertion-probe failures occur before destructive drops. Assert staged child count, parent copy count, restored child count, and the exact known inbound foreign-key inventory.
- [x] Recreate `idx_codex_provider_jobs_claimable`, `idx_codex_provider_jobs_owner`, `idx_codex_provider_jobs_user`, and `idx_codex_provider_response_uploads_created` with their original definitions.
- [x] Add the manifest entry describing the rebuild, absence of ciphertext rewrite, unchanged AEAD/KEK versions, and migration-before-Worker requirement. Preserve any existing production notes already present in `MIGRATIONS.json`.
- [x] Prove clean and populated paths, cascades, index inventory, rejection cases, and integrity:

      npm exec -w @patternlike/api -- vitest run src/db/codex-provider-schema.test.ts
      npm test -w @patternlike/api

- [x] Assert `PRAGMA foreign_key_check` returns zero rows and `PRAGMA quick_check` returns `ok` in both lanes.
- [x] Commit: `db: add the Codex reading provider coordinate`

## Task 3: Extend provider types, artifact identities, and runner protocol tests

**Files:**

- Modify: `apps/api/src/db/codex-provider-jobs.ts`
- Modify: `apps/api/src/db/codex-provider-jobs.test.ts`
- Modify: `apps/api/src/services/codex-provider-artifacts.ts`
- Modify: `apps/api/src/services/codex-provider-artifacts.test.ts`
- Modify: `apps/api/src/services/codex-provider-contract.test.ts`
- Create: `apps/codex-runner/src/protocol.test.ts`
- Modify: `apps/codex-runner/src/codex-cli.test.ts`
- Create: `apps/codex-runner/probes/sentinel-output.schema.json`

**Interfaces:**

- Consumes: Task 2's D1 coordinate and the existing Codex claim/completion wire protocol.
- Produces: `CodexProviderPipeline`, `CodexProviderPass`, `validCodexProviderCoordinate`, deterministic reading artifact identity, and the packaged sentinel schema used by rollout Task 4.

- [x] Add failing tests for a deterministic `reading/publisher` id, create/adopt identity, encrypted request/response round trip, and AAD mismatch rejection.
- [x] Add failing tests that reject `reading/planner`, `pattern/publisher`, `ontology/publisher`, null reading users, and non-null ontology users before a D1 write is attempted.
- [x] Run the new cases before production edits and confirm they fail on the missing `reading`/`publisher` vocabulary or sentinel asset:

      npm exec -w @patternlike/api -- vitest run src/db/codex-provider-jobs.test.ts src/services/codex-provider-artifacts.test.ts src/services/codex-provider-contract.test.ts
      npm test -w @patternlike/codex-runner
- [x] Extend the closed TypeScript unions:

      export type CodexProviderPipeline = "pattern" | "ontology" | "reading";
      export type CodexProviderPass =
        | "planner"
        | "writer"
        | "verifier"
        | "generator"
        | "evaluator"
        | "publisher";

- [x] Add one pair guard shared by enqueue and artifact code so illegal pairs fail before R2 is touched:

      export function validCodexProviderCoordinate(
        pipeline: CodexProviderPipeline,
        pass: CodexProviderPass,
      ): boolean {
        return (pipeline === "pattern" && ["planner", "writer", "verifier"].includes(pass)) ||
          (pipeline === "ontology" && ["planner", "writer", "verifier", "generator", "evaluator"].includes(pass)) ||
          (pipeline === "reading" && pass === "publisher");
      }

- [x] Keep user ownership as a second pre-write guard: Pattern and reading require non-null `userId`; ontology requires null. Artifact coordinates omit user identity, so they call only the pair guard.
- [x] Keep the deterministic id preimage exactly `(pipeline, owner_id, pass, stage_generation, stage_attempt, request_hash)`.
- [x] Prove artifact AAD and object identity include `reading`, the generic Daily job id, `publisher`, command generation, and zero-based provider attempt. Cross-owner, cross-attempt, and cross-pipeline reads must fail authentication.
- [x] Do not add pipeline/pass fields to the runner claim wire shape; the runner executes the already-closed invocation and does not need user/domain identity.
- [x] Add a checked-in, content-free strict-schema preflight asset for the production host. It accepts exactly `{ "status": "ok" }`, has `additionalProperties: false`, and contains no application or reader data. Parse it in `protocol.test.ts` so malformed JSON or a widened schema fails locally.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/db/codex-provider-jobs.test.ts src/services/codex-provider-artifacts.test.ts src/services/codex-provider-contract.test.ts
      npm test -w @patternlike/codex-runner
      npm run typecheck -w @patternlike/api -w @patternlike/codex-runner

- [x] Commit: `api: extend Codex provider coordinates to Daily`

## Task 4: Make Daily publisher configuration Codex-only

**Files:**

- Modify: `apps/api/src/services/reading-publisher.ts`
- Create: `apps/api/src/services/reading-publisher.test.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`
- Modify: `apps/api/test/helpers.ts`
- Delete: `apps/api/src/services/openai-reading-publisher.ts`
- Delete: `apps/api/src/services/openai-reading-publisher.test.ts`
- Delete: `apps/api/scripts/verify-openai-reading-model.ts`
- Delete: `apps/api/scripts/run-openai-reading-eval.ts`
- Modify: `apps/api/package.json`

**Interfaces:**

- Consumes: Task 3's closed provider coordinate and the existing fixed Daily model/prompt/output/input pins.
- Produces: a Codex-only `PublisherConfig`, fail-closed enabled-Daily configuration, and an `off` mode that needs no runnable provider.

- [x] Add failing config tests for enabled Daily with `openai`, missing Codex runner token, missing artifact keyring, missing R2, wrong timeout, and an AI Gateway-only configuration.
- [x] Add a positive test for `READING_V5_ROLLOUT=hybrid`, `READING_PUBLISHER=codex`, exact pins, a runner token, artifact keyring, R2, queue, and a positive call limit without any OpenAI credential or gateway values.
- [x] Run and observe the expected failures:

      npm exec -w @patternlike/api -- vitest run src/config.test.ts src/middleware/config-guard.test.ts

- [x] Change the live provider and timeout constants while preserving the approved model/prompt/output/input pins:

      export const READING_PUBLISHER_PROVIDER = "codex" as const;
      export const OPENAI_READING_MODEL = "gpt-5.6-sol";
      export const OPENAI_READING_REASONING = "high" as const;
      export const OPENAI_READING_TIMEOUT_MS = 900_000;
      export const OPENAI_READING_MAX_OUTPUT_TOKENS = 4000;
      export const READING_CONTEXT_MAX_BYTES = 98_304;

- [x] Remove `credential` and gateway routing from `PublisherConfig`. `resolvePublisherConfiguration` must not call `resolveProviderCredentialMode` or require `OPENAI_API_KEY`, `OPENAI_CREDENTIAL_SOURCE`, AI Gateway ids/token, or a gateway alias for Daily.
- [x] When Daily is enabled, require the same `CODEX_RUNNER_TOKEN`, `CODEX_PROVIDER_ARTIFACT_KEYRING`, and `ARTIFACTS` posture already used by Codex Pattern/ontology. Keep `off` valid without runnable provider configuration.
- [x] Delete the direct OpenAI Daily adapter and live OpenAI-only scripts/package entries after `rg` proves no runtime import remains. Keep the shared Responses envelope/parser only where ontology or contract conversion still uses it.
- [x] Update `Env` comments: historical `OPENAI_READING_*` names are model-family pins, not proof of direct API routing.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/config.test.ts src/middleware/config-guard.test.ts
      npm run test:wrangler-config -w @patternlike/api
      npm run typecheck -w @patternlike/api
      rg -n "createOpenAiReadingPublisher|OPENAI_API_KEY" apps/api/src apps/api/scripts apps/api/package.json

- [x] Confirm the final `rg` has no Daily runtime or script caller; ontology-only credential use may remain.
- [x] Commit: `api: require Codex for Daily publishing`

## Task 5: Add a read-only Daily owner/command boundary

**Files:**

- Modify: `apps/api/src/db/generation.ts`
- Create: `apps/api/src/services/reading-current-owner.ts`
- Create: `apps/api/src/services/reading-current-owner.test.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.ts`
- Modify: `apps/api/src/services/codex-provider-domain.ts`
- Create: `apps/api/src/services/codex-provider-domain.test.ts`

**Interfaces:**

- Consumes: Task 3's `reading/publisher` provider job and Task 4's frozen Codex publisher configuration.
- Produces: `loadCurrentDailyOwner(env, jobId)` and `readingProviderOwnerIsCurrent(env, job, now)` for provider admission, terminalization, and maintenance.

- [x] Write failing owner tests for missing job, wrong job type, terminal job, non-pending reading, wrong active generation id, wrong user, inactive user, undecryptable command, V1 command, OpenAI command, command-generation mismatch, attempt mismatch, stale publisher pin, stale consent, rollout off, invalidated/superseded/deleted reading, and the one valid Codex owner.
- [x] Run the new owner suite and confirm it fails because `loadCurrentDailyOwner` and reading dispatch do not exist:

      npm exec -w @patternlike/api -- vitest run src/services/reading-current-owner.test.ts src/services/generate-daily-reading-v5.test.ts src/services/codex-provider-domain.test.ts
- [x] Add a read-only loader that derives identity from D1, decrypts `jobs.payload_enc` with the existing AAD, and returns no mutable claim:

      export interface CurrentDailyOwner {
        jobId: string;
        userId: string;
        readingId: string;
        attempts: number;
        command: GenerateDailyReadingCommandV2;
      }

      export async function loadCurrentDailyOwner(
        env: Env,
        jobId: string,
      ): Promise<CurrentDailyOwner | null>;

- [x] Extract the current-consent comparison used by `generate-daily-reading-v5.ts` into `reading-current-owner.ts`; both execution and provider admission must compare the frozen id, version, policy, categories, and active grant without copying them to clear columns.
- [x] Implement `readingProviderOwnerIsCurrent(env, job, now)` with all of these equalities:

      job.pipeline === "reading"
      job.pass === "publisher"
      job.ownerId === owner.jobId
      job.userId === owner.userId
      job.stageGeneration === owner.command.command_generation
      job.stageAttempt === owner.attempts - 1
      owner.command.publisher.provider === "codex"

- [x] Compare the full frozen publisher pin, timeout, and call ceiling to current approved configuration. Do not accept a command merely because its model string matches.
- [x] Extend `codexProviderOwnerIsCurrent` to dispatch `reading` to this predicate. A stale reading owner returns false and is cancelled through the existing provider CAS.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/services/reading-current-owner.test.ts src/services/generate-daily-reading-v5.test.ts src/services/codex-provider-domain.test.ts
      npm run typecheck -w @patternlike/api

- [x] Commit: `api: verify current owners for Codex Daily jobs`

## Task 6: Build the encrypted Codex reading publisher adapter

**Files:**

- Create: `apps/api/src/services/codex-reading-publisher.ts`
- Create: `apps/api/src/services/codex-reading-publisher.test.ts`
- Modify: `apps/api/src/services/reading-publisher.ts`
- Modify: `apps/api/src/services/reading-prompt.test.ts`

**Interfaces:**

- Consumes: Task 3's encrypted provider-job/artifact APIs, Task 4's `PublisherConfig`, Task 5's owner boundary, and the existing Responses-shaped Daily prompt builder.
- Produces: `ReadingCodexCoordinate`, `createCodexReadingPublisher`, and the internal `publisher_pending` outcome consumed by the Daily executor.

- [x] Write failing adapter tests for deterministic request bytes, create/adopt, pending, leased, completed, safe failed, malformed JSON, schema-invalid output, missing metadata, wrong timeout, R2 put/read failure, and immutable-coordinate conflict.
- [x] Run the new adapter suite and confirm it fails because `createCodexReadingPublisher` does not exist:

      npm exec -w @patternlike/api -- vitest run src/services/codex-reading-publisher.test.ts src/services/reading-prompt.test.ts src/services/codex-provider-artifacts.test.ts
- [x] Add a Daily-specific coordinate to publish options; never derive it from request content:

      export interface ReadingCodexCoordinate {
        pipeline: "reading";
        ownerId: string;
        userId: string;
        stageGeneration: number;
        stageAttempt: number;
        dailyCallLimit: number;
      }

- [x] Add an internal pending result that carries only the provider control id back to the Worker executor:

      | { ok: false; code: "publisher_pending"; job_id: string }

- [x] Build the existing strict Responses-shaped request with `buildResponsesRequest`, convert it with `invocationFromResponsesRequest`, serialize via `canonicalJson`, hash it, and write it through `putCodexProviderArtifact` before enqueue.
- [x] Enqueue exactly this coordinate:

      pipeline: "reading"
      pass: "publisher"
      ownerId: claim.jobId
      userId: claim.userId
      stageGeneration: command.command_generation
      stageAttempt: claim.attempts - 1

- [x] Return `publisher_pending` for pending/leased, the stored closed failure for failed, and a parsed candidate plus Codex metadata for completed. Read response bytes only through `readCodexProviderArtifact` and reject invalid UTF-8/JSON.
- [x] Set successful metadata `provider: "codex"`; use the provider job's safe thread/request id, token counts, model, prompt version, and response plaintext hash. Never expose the Codex provider job id as `provider_request_id`.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/services/codex-reading-publisher.test.ts src/services/reading-prompt.test.ts src/services/codex-provider-artifacts.test.ts
      npm run typecheck -w @patternlike/api

- [x] Commit: `api: add the Codex Daily publisher adapter`

## Task 7: Release Daily leases while Codex is pending

**Files:**

- Modify: `apps/api/src/db/generation.ts`
- Modify: `apps/api/src/services/generate-daily-reading.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.ts`
- Modify: `apps/api/src/queue.ts`
- Modify: `apps/api/src/queue.test.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.test.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`

**Interfaces:**

- Consumes: Task 6's `publisher_pending` result and existing Daily claim fencing.
- Produces: `releaseClaimForPublisherPending(env, jobId, claimToken)` plus Queue behavior that acknowledges durable waiting without incrementing the Daily attempt.

- [x] Add failing DB/Queue tests proving first claim increments attempts to 1, a `publisher_pending` reacquisition stays at 1, a true provider retry advances to 2, and attempts never become 0 or negative.
- [x] Add race tests for provider completion before release, after release, duplicate Queue delivery while pending, release CAS failure, and failed nudge send.
- [x] Run the focused suite and confirm pending currently consumes or strands the ordinary claim:

      npm exec -w @patternlike/api -- vitest run src/queue.test.ts src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts
- [x] Change the generic claim update to preserve actual attempt identity on pending reacquisition:

      attempts = CASE
        WHEN result_class = 'publisher_pending' THEN attempts
        ELSE attempts + 1
      END

- [x] Add a claim-fenced release that keeps the dispatch marker set so the outbox does not spin:

      export async function releaseClaimForPublisherPending(
        env: Env,
        jobId: string,
        claimToken: string,
      ): Promise<boolean>;

      -- state transition
      status = 'queued'
      result_class = 'publisher_pending'
      claim_token = NULL
      lease_expires_at = NULL
      available_at = NULL
      -- dispatched_at intentionally unchanged

- [x] Extend the internal execution outcome with `reason: "publisher_pending"`, `detail: "codex_provider_pending"`, and `providerJobId`. It is a Queue control result, not a public `GenerationFailureCode` and never reaches `failReading`.
- [x] Replace the synchronous budget/gateway/OpenAI call in `generate-daily-reading-v5.ts` with `createCodexReadingPublisher`. Remove the 900-second provider timeout from Daily's five-minute lease arithmetic; the external call no longer runs inside that lease.
- [x] In `queue.ts`, on pending: release the owned Daily claim, acknowledge only after release succeeds, reload the Codex job, and immediately nudge if it became terminal in the enqueue/release race. If release cannot be proven, retry beyond the original lease.
- [x] Ensure duplicate pending delivery creates/adopts no new coordinate and consumes no provider budget.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/queue.test.ts src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts
      npm run typecheck -w @patternlike/api

- [x] Commit: `api: wait durably for Codex Daily output`

## Task 8: Nudge, budget, repair, and clean up reading provider jobs

**Files:**

- Modify: `apps/api/src/db/generation.ts`
- Modify: `apps/api/src/routes/codex-provider.ts`
- Modify: `apps/api/src/routes/codex-provider.integration.test.ts`
- Modify: `apps/api/src/services/codex-provider-domain.ts`
- Modify: `apps/api/src/services/codex-provider-maintenance.ts`
- Create: `apps/api/src/services/codex-provider-maintenance.test.ts`
- Modify: `apps/api/src/scheduled.ts`
- Modify: `apps/api/src/scheduled.integration.test.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`
- Modify: `apps/api/src/services/account-deletion.ts`

**Interfaces:**

- Consumes: Task 5's owner predicate, Task 7's pending Daily state, existing provider terminal routes, and the `reading_provider_daily_usage` ledger.
- Produces: reading budget selection, `nudgeCurrentDailyOwner`, scheduled nudge repair, safe metrics, and user-owned provider artifact erasure.

- [x] Add failing integration tests proving reading claims charge `reading_provider_daily_usage` exactly once per runner lease, including reclaimed leases, and never at provider job creation/adoption/polling/publication.
- [x] Add failing terminal nudge tests for completed, failed, stale owner, command-generation mismatch, successful Queue send, failed Queue send, and scheduled repair.
- [x] Run the focused suite and confirm it fails because reading budget routing, terminal nudging, and cleanup are absent:

      npm exec -w @patternlike/api -- vitest run src/routes/codex-provider.integration.test.ts src/services/codex-provider-maintenance.test.ts src/scheduled.integration.test.ts src/services/deletion-manifest.test.ts
- [x] Extend claim-route budget selection:

      if (job.pipeline === "reading") {
        return consumeProviderCallBudget(
          env,
          utcDateFor(now),
          job.dailyCallLimit,
        );
      }

- [x] Add `nudgeCurrentDailyOwner`: clear `jobs.dispatched_at` only for the same nonterminal Daily job, active pending reading, user, and command generation; send only `{job_id, reading_id}`; call `markDispatched` after successful send.
- [x] Extend provider terminal routing and maintenance to `reading`. Repair terminal jobs whose current Daily owner remains `publisher_pending`, and cancel provider work whose encrypted owner check is stale.
- [x] Preserve same-coordinate provider lease reclamation. Every runner lease consumes one budget unit because the preceding invocation may have happened even if completion did not commit.
- [x] Delete terminal user-owned request, response, and stale response-upload objects/rows only after the owning Daily workflow has adopted the provider result and safely published, failed, cancelled, been revoked, or been deleted. A provider `completed`/`failed` status while the Daily owner is still `publisher_pending` is nudge-eligible, not cleanup-eligible. Never delete an active lease or ontology-owned artifact under the reading rule.
- [x] Extend account-deletion tests with a reading provider request, committed response, and stale response upload. Assert all objects and D1 rows are removed before the user row, while published encrypted readings follow existing deletion semantics.
- [x] Add safe counters by pipeline/pass/status/age and nudge outcome. Assert captured logs never contain prompt/output text, runner stderr, user ids, chart ids, consent ids, birth facts, or prose.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/routes/codex-provider.integration.test.ts src/services/codex-provider-maintenance.test.ts src/scheduled.integration.test.ts src/services/deletion-manifest.test.ts
      npm run typecheck -w @patternlike/api

- [x] Commit: `api: repair and erase Codex Daily provider work`

## Task 9: Preserve retry policy and supersede frozen OpenAI commands

**Files:**

- Modify: `apps/api/src/services/generation-failures.ts`
- Modify: `apps/api/src/services/generation-failures.test.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.test.ts`
- Modify: `apps/api/src/services/generation-command-v2.ts`
- Modify: `apps/api/src/services/generation-command-v2.test.ts`
- Modify: `apps/api/src/services/enqueue.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`
- Modify: `apps/api/src/db/reading-scheduler.integration.test.ts`

**Interfaces:**

- Consumes: Task 6's Codex-only executor and Task 7's actual-attempt identity.
- Produces: the closed `publisher_superseded` failure/replacement reason and a bounded immutable-command replacement path.

- [x] Add failing tests that an unpublished OpenAI command is failed as `publisher_superseded`, never submitted to Codex, and replaced once with a newly frozen Codex command.
- [x] Add retry matrix tests proving `publisher_unavailable` permits four actual attempts, invalid/refused permits one fresh attempt, auth/model/budget is terminal, and stale/revoked/deleted owners create no replacement provider call.
- [x] Run the focused suite and confirm the new closed failure/replacement code is rejected or unhandled:

      npm exec -w @patternlike/api -- vitest run src/services/generation-failures.test.ts src/services/generation-command-v2.test.ts src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts src/db/reading-scheduler.integration.test.ts
- [x] Extend the closed vocabularies:

      export type V5FailureCode =
        | "calc_unavailable"
        | "daily_sky_unavailable"
        | "publisher_unavailable"
        | "publisher_output_invalid"
        | "publisher_refused"
        | "publisher_budget_exhausted"
        | "publisher_not_configured"
        | "publisher_auth_failed"
        | "publisher_model_unavailable"
        | "publisher_superseded"
        | "ai_synthesis_consent_required"
        | "context_ineligible"
        | "generation_input_id_mismatch"
        | "policy_unsupported";

      export type V5ReplacementReason =
        | "calc_unavailable"
        | "daily_sky_unavailable"
        | "publisher_unavailable"
        | "publisher_output_invalid"
        | "publisher_refused"
        | "publisher_superseded"
        | "consent_regranted";

- [x] Add `publisher_superseded` to `V5_FAILURE_CODES`, `V5_REPLACEMENT_REASONS`, and `V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES`. Leave it out of `queueDisposition`'s retry branches so the frozen command terminalizes before the existing bounded replacement path runs. Keep `MAX_COMMAND_GENERATION` and idempotency guards unchanged.
- [x] Detect `command.publisher.provider === "openai"` before packet construction or R2 access, fail the claimed reading with the safe class, and let scheduler/first-open repair freeze a new command from current Codex configuration.
- [x] Never edit an encrypted frozen command in place. Published historical OpenAI readings and evidence must remain readable and unchanged.
- [x] Verify a schema-valid but semantically invalid completed candidate advances to a fresh Daily attempt and therefore a new `stage_attempt`; a pending or reclaimed provider lease retains the old coordinate.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/services/generation-failures.test.ts src/services/generation-command-v2.test.ts src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts src/db/reading-scheduler.integration.test.ts
      npm run typecheck -w @patternlike/api

- [x] Commit: `api: supersede unpublished OpenAI Daily commands`

## Task 10: Require fresh Daily consent and truthful Codex disclosure

**Files:**

- Modify: `apps/api/src/db/consents.ts`
- Modify: `apps/api/src/routes/consents.ts`
- Modify: `apps/api/src/routes/consents.integration.test.ts`
- Modify: `apps/web/src/components/AiConsent.tsx`
- Create: `apps/web/src/components/AiConsent.test.tsx`
- Modify: `apps/web/src/test/reading-fixture.ts`
- Modify: `apps/web/src/lib/reading-state.test.ts`

**Interfaces:**

- Consumes: the existing append-only Daily consent chain and server-owned consent category map.
- Produces: current policy `1.1.0`, old-grant fail-closed behavior, and reader copy that names OpenAI as processor and Codex as generation service.

- [x] Add failing API tests proving policy `1.0.0` is no longer an active grant, `1.1.0` can be granted/revoked, and old rows remain in the audit chain without update.
- [x] Add failing component tests for the exact labels `Processor` and `Codex`, and for absence of the old `provider-side storage turned off`, `up to 30 days`, and `granting this leaves both of them off` claims.
- [x] Run the focused API and web tests and confirm they fail on policy `1.0.0` and the old disclosure copy:

      npm exec -w @patternlike/api -- vitest run src/routes/consents.integration.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/AiConsent.test.tsx src/lib/reading-state.test.ts
- [x] Bump only the current policy constant and server-owned category map:

      export const AI_SYNTHESIS_POLICY_VERSION = "1.1.0";

- [x] Keep the consent wire field and D1 row `provider: "OpenAI"` for compatibility. Render it under `Processor`, and separately state that Codex by OpenAI writes the Daily reading.
- [x] Replace the retention/training text with bounded copy that states account/workspace controls and agreement determine OpenAI training/retention; the reader's grant does not change those settings; Pattern/Like deletes its encrypted exchange artifacts after terminal ownership.
- [x] Preserve the named categories, purpose limitation, free-text warning, and revocation semantics.
- [x] Run:

      npm exec -w @patternlike/api -- vitest run src/routes/consents.integration.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/AiConsent.test.tsx src/lib/reading-state.test.ts
      npm run typecheck -w @patternlike/api -w @patternlike/web

- [x] Obtain privacy/legal copy review before the rollout plan enables real user packets. Code may land with `READING_V5_ROLLOUT=off`; unreviewed copy is a hard production stop.
- [x] Commit: `privacy: disclose Codex Daily processing`

## Task 11: Enable scheduled plus first-open Codex Daily in source configuration

**Files:**

- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/scripts/wrangler-config.test.ts`
- Modify: `apps/api/src/scheduled.integration.test.ts`
- Modify: `apps/api/src/routes/readings.integration.test.ts`
- Modify: `apps/api/src/db/reading-scheduler.integration.test.ts`
- Modify: `docs/deploy/openai-daily-reading-rollout.md`
- Modify: `docs/deploy/codex-production-provider.md`

**Interfaces:**

- Consumes: Tasks 4-10's Codex-only Daily path and the existing first-open/scheduler convergence logic.
- Produces: source configuration `hybrid`, the combined production cron set, and current operational instructions consumed by rollout plan 3.

- [x] Add failing config tests for the exact production cron set and Daily pins:

      [env.production.triggers]
      crons = ["*/15 * * * *", "7,22,37,52 * * * *"]

      [env.production.vars]
      READING_V5_ROLLOUT = "hybrid"
      READING_PUBLISHER = "codex"
      OPENAI_READING_TIMEOUT_MS = "900000"

- [x] Run the focused config and scheduling tests and confirm they fail on the current first-open/OpenAI production declaration and missing Daily cron:

      npm run test:wrangler-config -w @patternlike/api
      npm exec -w @patternlike/api -- vitest run src/scheduled.integration.test.ts src/routes/readings.integration.test.ts src/db/reading-scheduler.integration.test.ts

- [x] Preserve scheduler eligibility, 30-day activity window, local-day calculation, lead/spread window, batch limit, fact repair, idempotent reservation, and first-open repair logic.
- [x] Add integration coverage showing scheduled and first-open requests for the same user/day converge on one reading reservation, one Daily job, and one Codex provider coordinate.
- [x] Update the active runbooks to describe Codex Daily, `publisher_pending`, the retained Daily kill switch, shared runner FIFO/concurrency one, and content-free queue-age/status evidence. Mark the old OpenAI rollout procedure as superseded; preserve dated historical evidence as history, not instructions.
- [x] Do not delete `OPENAI_API_KEY` in this task. Secret deletion creates a Worker version and is a separate post-rollout action.
- [x] Run:

      npm run test:wrangler-config -w @patternlike/api
      npm exec -w @patternlike/api -- vitest run src/scheduled.integration.test.ts src/routes/readings.integration.test.ts src/db/reading-scheduler.integration.test.ts
      npm run build

- [x] Commit: `api: configure hybrid Codex Daily generation`

## Task 12: Integrated Daily verification and handoff

**Files:**

- No file changes expected. Stop and return to the owning task if this gate exposes a defect.
- Record execution evidence in the eventual pull-request body; do not add generated logs or private artifacts to the repository.

**Interfaces:**

- Consumes: every deliverable from Tasks 1-11.
- Produces: a verified Daily commit range and focused evidence handoff to the account-wide Pattern plan; it performs no deployment or provider call.

- [x] Search for forbidden live routes and stale configuration dependencies:

      rg -n "createOpenAiReadingPublisher|READING_PUBLISHER\s*=\s*\"openai\"|READING_PUBLISHER must be openai" apps packages contracts docs/deploy
      rg -n "publisher_pending|pipeline: \"reading\"|pass: \"publisher\"" apps/api/src

- [x] Inspect every remaining OpenAI match. Historical fixtures/evidence and ontology-only code are allowed; a runnable Daily path or current instruction is not.
- [x] Run the focused regression set once more:

      npm run test -w @patternlike/shared
      npm test -w @patternlike/codex-runner
      npm exec -w @patternlike/api -- vitest run src/db/codex-provider-schema.test.ts src/db/codex-provider-jobs.test.ts src/services/codex-reading-publisher.test.ts src/services/reading-current-owner.test.ts src/routes/codex-provider.integration.test.ts src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts src/queue.test.ts src/scheduled.integration.test.ts src/routes/consents.integration.test.ts
      npm run test:contracts
      npm run typecheck
      npm run build

- [x] Run `git diff --check`, inspect `git status --short`, and confirm no secret, generated provider content, backup, Wrangler state, or unrelated user file is staged.
- [x] Do not run `npm run ci:local` yet if the Pattern plan remains unimplemented. The complete immutable-candidate gate belongs after both implementation plans.
- [x] Hand off the resulting commit range and the exact focused command results to [`2026-08-27-account-wide-pattern.md`](./2026-08-27-account-wide-pattern.md).

---

## Execution record (2026-08-27)

Implemented on the isolated worktree `/home/henry/patternlike-codex-daily`,
branch `feat/codex-daily-control-plane`, based on `main` at `77f34e3`. Not
merged, not deployed, `0017` not applied to production, no Worker secret
changed, and no real provider invoked.

### Commit range

    1d8458c db: record the applied 0016 production evidence
    a11d546 contracts: admit Codex Daily provenance                (Task 1)
    97d19f3 db: add the Codex reading provider coordinate          (Task 2)
    703d98c api: extend Codex provider coordinates to Daily        (Task 3)
    02afb93 api: require Codex for Daily publishing                (Task 4)
    95ee324 api: verify current owners for Codex Daily jobs        (Task 5)
    4e7a349 api: add the Codex Daily publisher adapter             (Task 6)
    45a2c66 api: wait durably for Codex Daily output               (Task 7)
    aba2191 api: repair and erase Codex Daily provider work        (Task 8)
    d4be479 api: supersede unpublished OpenAI Daily commands       (Task 9)
    77ac5b8 privacy: disclose Codex Daily processing               (Task 10)
    26ca10f api: configure hybrid Codex Daily generation           (Task 11)

`1d8458c` carries the planning checkout's uncommitted `MIGRATIONS.json`
production note (0016 applied 2026-08-27 ~06:35 UTC) so the 0017 entry lands on
top of it rather than replacing it.

### Task 12 gate results

    rg 'createOpenAiReadingPublisher|READING_PUBLISHER = "openai"|
        READING_PUBLISHER must be openai' apps packages contracts docs/deploy
      -> no matches

    npm run test -w @patternlike/shared            67 pass, 0 fail
    npm test -w @patternlike/codex-runner          23 pass, 0 fail
    npm run test -w @patternlike/reading-engine   108 pass, 0 fail
    npm run test -w @patternlike/pattern-engine     7 pass, 0 fail
    npm run test -w @patternlike/ontology-signer   19 pass, 0 fail
    npm run test:content                           18 pass, 0 fail
    npm exec -w @patternlike/web -- vitest run    243 pass, 23 files
    npm test -w @patternlike/api                 2024 pass, 115 files, exit 0
      (+ m3-compat 1, pattern-model-verify 8, ontology-corpus 3,
         wrangler-config 5 — all pass)
    npm run test:contracts                        all contract package checks
                                                  passed; migration smoke passed
    npm run typecheck                             clean
    npm run build                                 exit 0 (production dry-run)
    git diff --check                              clean
    git status --short                            clean

Remaining `openai` matches were inspected: `OPENAI_READING_*` model-family pin
names (documented as pins, not routing), the `publisher_superseded` detection,
the disclosure sentence naming Codex by OpenAI, historical M5 fixtures and
evidence, and the ontology pipeline's own OpenAI transport. No runnable Daily
OpenAI path and no current instruction to use one.

`npm run ci:local` deliberately NOT run: the immutable-candidate gate belongs
after the account-wide Pattern plan, per Task 12.

### Deviations from the written plan

1. **Task 4 / Task 7 — when the adapter was deleted.** Task 4 lists
   `openai-reading-publisher.ts` (and its test) as deletions, but gates that on
   "after `rg` proves no runtime import remains". At Task 4 the executor still
   imported it. The two live OpenAI-only scripts and their package entries were
   removed in Task 4; the adapter and its test were removed in Task 7, at the
   commit where the last runtime import actually disappeared. Following the
   gate rather than the file list kept the tree compiling throughout.
2. **Task 9 needed a contracts change the plan did not list.**
   `command_replacement_reason` is a frozen M5 wire enum, so
   `publisher_superseded` had to be added to
   `common.schema.json#/$defs/commandReplacementReasonV2` with its own
   amendment; otherwise a replacement command would fail the schema validation
   that `generation-command-v2.test.ts` performs. Additive, no `$id` or
   schema_version change, no existing fixture byte changed.
3. **contracts/m5 edits must be committed before `npm run test:contracts`.**
   `check_frozen` runs `git status --porcelain -- contracts/m5` and fails on any
   working-tree change, so the Task 1 and Task 9 contract validations ran after
   their commits rather than before. Each also required re-pinning the
   contracts/m5 manifest digest in m6, m7, m8 and in the validator's own
   independent hash table.
4. **Task 10 is Daily-only, as scoped.** `PatternConsent.tsx` still carries the
   old `store: false` / 30-day sentences and policy `1.0.0`. Pattern's move to
   Codex and its own policy bump belong to the account-wide Pattern plan;
   Pattern's rollout is off in production until then.
5. **A test-isolation defect was found and fixed.** Miniflare's queue simulator
   delivers produced messages concurrently with the test body, and a delivery
   landing across a `resetDb` boundary leaves a Codex provider job whose owner
   row is gone — which the next suite claims as the oldest work and cancels.
   Fixtures that drive the executor directly now reserve through
   `SILENT_READING_QUEUE`. This was an intermittent cross-file failure, not a
   product defect.

### Open gates before this can be enabled

- privacy/legal review of the new consent copy against the actual production
  OpenAI account/workspace and agreement (hard production stop);
- the contractual-use and data-control evidence in the design spec;
- `0017` applied to production D1 **before** the merge that deploys the Worker;
- a real Daily generation through the production runner.

### Handoff

Continue with `docs/superpowers/plans/2026-08-27-account-wide-pattern.md` on the
same branch, then execute
`docs/superpowers/plans/2026-08-27-codex-reader-rollout.md` last.
