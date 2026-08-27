# Account-Wide Codex Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Pattern's rollout/cohort/allowlist admission policy so every authenticated eligible account enters the generated Pattern flow, while retaining explicit consent, the exact confirmation phrase, one-Pattern claim semantics, public ontology integrity, and Codex-only live publishing.

**Architecture:** Pattern state and generation admission become account-independent. The API evaluates chart, locale, current consent, public-capable ontology, claim state, and configured Codex service in that order. Existing Codex Pattern stages and durable provider jobs remain the execution path; rollout-paused rows are handled by a bounded unconditional compatibility repair rather than a replacement feature flag.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/Queues/D1/R2, React, Vitest, Node test, M7/M8 JSON Schema/OpenAPI, and the existing Pattern stage/Codex provider protocols.

**Spec:** [`../specs/2026-08-27-codex-daily-pattern-design.md`](../specs/2026-08-27-codex-daily-pattern-design.md)

## Global Constraints

- This is plan 2 of 3. Begin only after [`2026-08-27-codex-daily-control-plane.md`](./2026-08-27-codex-daily-control-plane.md) is complete on the same implementation branch.
- Start from an isolated, clean worktree and preserve unrelated edits. Do not apply `0017`, merge, deploy, change secrets, activate an ontology, or invoke a real provider here.
- Do not replace `PATTERN_AI_ROLLOUT` with another cohort, percentage, allowlist, account class, experiment, product flag, or hidden admission condition.
- Budget ceilings are spend controls, not user admission. Public-capable ontology evidence is a content-integrity invariant, not a cohort gate.
- Keep explicit Pattern consent, request idempotency, exact `GENERATE MY PATTERN`, accepted/consumed claim protection, deletion, withdrawal, recall, and chart-correction behavior.
- Existing editorial data and historical OpenAI/synthetic evidence are preserved. The authenticated Pattern flow simply stops selecting editorial content as an admission outcome.
- Development tests may inject a deterministic publisher directly. No deployable configuration may select OpenAI, Workers AI, or synthetic for Pattern generation.
- Use tests first, observe the expected failure, stage only listed files, and make the named focused commit after each task.

---

## Task 1: Delete Pattern rollout and account admission

**Files:**

- Delete: `apps/api/src/services/pattern-rollout.ts`
- Delete: `apps/api/src/services/pattern-rollout.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`
- Modify: `apps/api/src/services/pattern-state.ts`
- Modify: `apps/api/src/routes/pattern-ai.ts`
- Modify: `apps/api/src/routes/pattern.ts`
- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/codex-provider-domain.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/routes/pattern.test.ts`
- Modify: `apps/api/src/services/pattern-execute-codex.test.ts`

**Interfaces:**

- Consumes: existing authenticated Pattern state/read/enqueue/execute surfaces and durable Pattern claim semantics.
- Produces: account-independent generated-flow admission with no rollout, allowlist, cohort, or editorial-catalog fallback decision.

- [ ] Add failing tests showing two authenticated users with identical eligible state receive the same generated Pattern state even when one was not in the former allowlist and an editorial release exists.
- [ ] Add failing tests showing `GET /v1/pattern` no longer falls through to the editorial catalogue for an account with no prior AI claim.
- [ ] Run and confirm failures still report `editorial_catalog` or `pattern_generation_unavailable`:

      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/routes/pattern.test.ts src/services/pattern-execute-codex.test.ts

- [ ] Delete all exported rollout concepts and remove both bindings from `Env`:

      PATTERN_AI_ROLLOUT
      PATTERN_INTERNAL_ACCOUNT_IDS
      readPatternAiRollout
      patternRolloutAllows
      readInternalAccountIds
      isInternalPatternAccount
      consumerAdmissionEntry
      isPatternAiCohort

- [ ] Make `buildPatternState` enter the generated flow for every authenticated identity. Keep the `editorial_catalog` wire enum for backward compatibility, but stop emitting it as an account-admission decision.
- [ ] Make the authenticated `GET /v1/pattern` route always use the generated-Pattern reader. Remove the nullable `tryServeAiPattern` cohort escape; preserve M4 rows and privacy/export handling without using them to select the product path.
- [ ] Remove rollout checks from enqueue, Pattern execution, and Codex current-owner checks. Do not add a new environment lookup at those call sites.
- [ ] Preserve this eligibility order in state and enqueue tests:

      active chart
      -> user-confirmed locale
      -> current Pattern consent
      -> public-capable active ontology
      -> unused chart-fingerprint claim
      -> exact request confirmation
      -> configured Codex publisher/provider budget at invocation claim

- [ ] Keep `PATTERN_STATES`/M7/M8 enum compatibility unless a test proves removal is required; dead historical wire values are safer than an unnecessary schema break.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/routes/pattern.test.ts src/services/pattern-execute-codex.test.ts
      npm run typecheck -w @patternlike/api
      rg -n "PATTERN_AI_ROLLOUT|PATTERN_INTERNAL_ACCOUNT_IDS|patternRolloutAllows|isPatternAiCohort|isInternalPatternAccount" apps/api/src apps/api/test

- [ ] Confirm the final search returns no runtime/test-helper consumer.
- [ ] Commit: `api: remove Pattern account admission gates`

## Task 2: Make the deployable Pattern publisher Codex-only

**Files:**

- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/services/pattern-publisher.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-execute-codex.test.ts`
- Delete: `apps/api/src/services/pattern-execute-openai.test.ts`
- Create: `apps/api/src/services/pattern-execute-injected.test.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/services/pattern-publisher-factory.ts`
- Delete: `apps/api/src/services/workers-ai-pattern-publisher.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`

**Interfaces:**

- Consumes: plan 1's shared Codex provider control plane and existing deterministic publisher test injection.
- Produces: a deployable `PatternPublisherConfig` fixed to `codex` and an execution factory with no live OpenAI, Workers AI, or synthetic branch.

- [ ] Add failing configuration tests that reject `PATTERN_PUBLISHER=openai`, `workers_ai`, `synthetic`, empty publisher, missing runner token, missing artifact keyring, missing R2, or any timeout other than `900000`.
- [ ] Add a positive config test requiring Codex with the existing model, reasoning, prompt, output, input, budget, and retention pins and no OpenAI credential/gateway dependency.
- [ ] Run and observe the direct OpenAI/synthetic modes still resolve:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-publisher.test.ts src/config.test.ts src/middleware/config-guard.test.ts

- [ ] Narrow deployable resolution to one live publisher:

      export interface PatternPublisherConfig {
        pin: PatternPublisherPin & { publisher: "codex" };
        plannerTimeoutMs: 900_000;
        writerTimeoutMs: 900_000;
        verifierTimeoutMs: 900_000;
        dailyCallLimit: number;
        artifactRetentionDays: 30;
      }

- [ ] Remove rollout/null-config semantics from `PatternPublisherConfigOutcome`; a healthy product environment has a complete Codex configuration, and malformed/missing configuration fails closed.
- [ ] Remove Pattern's live `apiKey`, gateway, credential, Workers AI binding, and provider branching. `executePatternJob` must construct only `createCodexPatternPublisher(env)`.
- [ ] Keep OpenAI transport/factory code only where the separately configurable ontology regression pipeline still imports it. Ensure no Pattern product route or executor can reach that branch.
- [ ] Keep a deterministic publisher as explicit test injection, not as an environment-selectable runtime value. Move the provider-independent lease, retry, validation, and publication cases from `pattern-execute-openai.test.ts` into `pattern-execute-injected.test.ts`; the renamed suite must inject its publisher directly and carry no OpenAI environment configuration.
- [ ] Delete the Workers AI Pattern adapter. The source inventory shows only `pattern-execute.ts` imports it and no ontology path reads `env.AI`; remove `Env.AI` and the matching test-helper bindings here. Task 7 removes both Wrangler AI binding blocks.
- [ ] Preserve historical `PatternPublisherName` values where stored provenance readers require them; new commands always freeze lowercase `codex` and display `Codex`.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-publisher.test.ts src/services/pattern-execute-codex.test.ts src/services/pattern-execute-injected.test.ts src/config.test.ts src/middleware/config-guard.test.ts
      npm run typecheck -w @patternlike/api
      rg -n "PATTERN_PUBLISHER_(OPENAI|SYNTHETIC|WORKERS_AI)|createOpenAiPatternPublisher|createWorkersAiPatternPublisher" apps/api/src/services/pattern-execute.ts apps/api/src/routes

- [ ] Confirm no live Pattern product execution match remains; ontology-only imports and historical-read labels are allowed.
- [ ] Commit: `api: require Codex for Pattern generation`

## Task 3: Remove the internal ontology bypass

**Files:**

- Modify: `apps/api/src/db/pattern-ontology.ts`
- Modify: `apps/api/src/services/pattern-ontology-evidence.test.ts`
- Modify: `apps/api/src/services/pattern-state.ts`
- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `apps/api/src/routes/pattern-ai.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/services/codex-provider-domain.ts`
- Modify: `apps/api/src/services/codex-pattern-publisher.test.ts`
- Create: `apps/api/scripts/verify-active-ontology-bundle.ts`
- Create: `apps/api/scripts/verify-active-ontology-bundle.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**

- Consumes: Task 1's account-wide flow, Task 2's Codex-only execution, the evidence-derived `activationScope`, and existing signing/compiler helpers.
- Produces: single-argument `ontologyServesAccount`, uniform `ontology_unavailable` behavior, and `ontology:release:verify` for rollout plan 3.

- [ ] Add failing predicate tests proving internal/synthetic origin, internal activation scope, missing evaluation, missing regression evidence, recalled release, and null release return false for every caller.
- [ ] Add a passing case containing machine-pipeline origin, public activation, licensed-excerpt/public-capable corpus, committed evaluation, passed compiler/evaluator/regression evidence, live artifact coordinate, and non-recalled active pointer.
- [ ] Run the predicate and verifier tests before production edits; confirm the two-argument bypass still admits internal evidence and the verifier entry point is missing:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-ontology-evidence.test.ts src/routes/pattern-ai.integration.test.ts src/services/codex-pattern-publisher.test.ts
      npm exec -w @patternlike/api -- tsx --test scripts/verify-active-ontology-bundle.test.ts
- [ ] Remove the bypass parameter and make the name describe the invariant:

      export function ontologyServesAccount(
        ontology: ActiveOntology | null,
      ): ontology is ActiveOntology {
        return ontology?.release.provenance?.origin === "machine_pipeline" &&
          ontology.activationScope === "public";
      }

- [ ] Keep the existing `ONTOLOGY_ACTIVATION_SCOPE_SQL` evidence joins/checks as the source of `activationScope`; do not trust a client claim or a new boolean variable.
- [ ] Update state, enqueue, read, execute/current-owner, and tests to call the single-argument predicate. All surfaces must return `ontology_unavailable` consistently.
- [ ] Prove an account that was formerly internal cannot generate from an internal release, while a formerly non-allowlisted account can generate from a public release.
- [ ] Add a production-safe offline verifier for a downloaded active bundle. Require explicit `--bundle`, `--keys-file`, `--expected-version`, `--expected-bundle-hash`, and `--expected-corpus-hash` arguments; reject unknown/missing arguments; reuse `computeOntologyBundleHash`, `verifyOntologySignature`, and `compileOntologyRelease`; require `provenance.origin="machine_pipeline"`; and print only version, hashes, signing key id, origin, and pass/fail codes.
- [ ] Test valid signed machine input plus malformed JSON, wrong version/hash/corpus hash, internal provenance, unknown key, invalid signature, and compiler rejection. The verifier must never print release rules or prose on either success or failure.
- [ ] Register it as `ontology:release:verify` in the API workspace.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-ontology-evidence.test.ts src/routes/pattern-ai.integration.test.ts src/services/codex-pattern-publisher.test.ts
      npm run ontology:release:verify -w @patternlike/api -- --help
      npm exec -w @patternlike/api -- tsx --test scripts/verify-active-ontology-bundle.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: require public ontology evidence for every Pattern`

## Task 4: Recover legacy rollout-paused Pattern rows without a flag

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-sweep.ts`
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts`
- Modify: `apps/api/src/scheduled.integration.test.ts`
- Modify: `apps/api/src/queue.test.ts`

**Interfaces:**

- Consumes: Task 1's removal of new rollout-paused transitions and existing Pattern current-owner checks/outbox.
- Produces: `recoverLegacyPausedPatternJobs(env, limit, now)`, an unconditional bounded repair for historical rows only.

- [ ] Add failing tests for queued legacy pause, expired running legacy pause, live running pause, stale consent, inactive user, terminal domain owner, repeated sweep, and more rows than one bounded batch.
- [ ] Run the focused repair tests and confirm they fail because recovery is still conditional on the removed rollout transition:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-execute-protocol.test.ts src/scheduled.integration.test.ts src/queue.test.ts
- [ ] Delete the rollout-off transition from `executePatternJob`; no new Pattern row may acquire `result_class='rollout_paused'`.
- [ ] Replace `resumePausedPatternJobsAfterRollout` with an unconditional bounded compatibility repair:

      export async function recoverLegacyPausedPatternJobs(
        env: Env,
        limit = 50,
        now = new Date(),
      ): Promise<number>;

- [ ] Select at most `limit` Pattern jobs with `result_class='rollout_paused'` whose status is queued or whose running lease has expired. Reset them to queued, clear claim/lease, clear the result class, set `available_at=now`, and leave `dispatched_at=NULL` for the ordinary outbox.
- [ ] Do not steal a live running lease. Do not decide consent/ontology/user state in the repair; ordinary Pattern current-owner/eligibility checks decide continue versus cancel after redelivery.
- [ ] Keep outbox exclusions for `rollout_paused` while compatibility rows can still exist, so rows beyond the bounded batch cannot bypass recovery.
- [ ] Call the repair from `sweepPatternJobs` on every scheduled maintenance tick. Repeated calls must converge and spend no provider budget by themselves.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-execute-protocol.test.ts src/scheduled.integration.test.ts src/queue.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: recover legacy paused Pattern jobs`

## Task 5: Require Pattern consent 1.1 and disclose Codex truthfully

**Files:**

- Modify: `packages/shared/src/m7-types.ts`
- Modify: `packages/shared/src/m7-types.test.ts`
- Modify: `apps/api/src/db/pattern-consents.ts`
- Create: `apps/api/src/db/pattern-consents.test.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.test.ts`
- Modify: `apps/web/src/components/PatternConsent.tsx`
- Create: `apps/web/src/components/PatternConsent.test.tsx`
- Modify: `apps/web/src/components/PatternExperience.test.tsx`
- Modify: `apps/web/src/components/PrivacyView.tsx`
- Modify: `contracts/m7/openapi/openapi.yaml`
- Modify: `contracts/m8/openapi/openapi.yaml`

**Interfaces:**

- Consumes: existing append-only Pattern consent rows and exact generation confirmation semantics.
- Produces: current Pattern policy `1.1.0`, old-grant fail-closed behavior, and reviewed processor/Codex disclosure across API, contracts, and web.

- [ ] Add failing shared/API tests proving a stored `1.0.0` grant loads as no active grant and a new `1.1.0` grant appends to, rather than rewrites, the consent chain.
- [ ] Add failing execution/current-owner tests proving unfinished jobs pinned to `1.0.0` cancel before provider claim and can restart only after a fresh `1.1.0` grant.
- [ ] Run the focused shared/API/web cases and confirm they fail on policy `1.0.0` or the old provider/storage/training copy:

      npm run test -w @patternlike/shared
      npm exec -w @patternlike/api -- vitest run src/db/pattern-consents.test.ts src/routes/pattern-ai.integration.test.ts src/services/pattern-lifecycle.test.ts src/services/pattern-execute-codex.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/PatternConsent.test.tsx src/components/PatternExperience.test.tsx
- [ ] Bump the current policy constant:

      export const PATTERN_GENERATION_CONSENT_POLICY_VERSION = "1.1.0" as const;

- [ ] Keep D1 and the wire field `provider: "OpenAI"` unchanged for processor compatibility. Change the UI label from `Provider` to `Processor`, and name Codex separately as the generation service.
- [ ] Remove the claims that provider-side storage is off, retention is necessarily 30 days, or the reader's grant turns model training off.
- [ ] State the reviewed facts: minimized calculated/optional content sent to Codex by OpenAI for one Pattern; account/workspace controls and agreement govern training/retention; Pattern/Like deletes its encrypted exchange artifacts after terminal ownership; withdrawal stops unfinished/future work; accepted Pattern retention/deletion semantics remain unchanged.
- [ ] Preserve the explicit input/exclusion lists, one-Pattern/no-reroll warning, permanent deletion warning, and exact generation purpose.
- [ ] Run:

      npm run test -w @patternlike/shared
      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/services/pattern-lifecycle.test.ts src/services/pattern-execute-codex.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/PatternConsent.test.tsx src/components/PatternExperience.test.tsx
      npm run test:contracts
      npm run typecheck

- [ ] Obtain privacy/legal copy review before production enablement. A green test is not approval of the account/workspace retention statement.
- [ ] Commit: `privacy: disclose Codex Pattern processing`

## Task 6: Prove account-wide UX and one-Pattern invariants end to end

**Files:**

- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/services/pattern-execute-codex.test.ts`
- Modify: `apps/api/src/services/pattern-state.ts`
- Modify: `apps/web/src/components/PatternExperience.tsx`
- Modify: `apps/web/src/components/PatternExperience.test.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `packages/shared/src/m7-types.test.ts`
- Delete: `apps/web/src/components/PatternChapters.tsx`
- Delete: `apps/web/src/components/PatternChapters.test.tsx`

**Interfaces:**

- Consumes: Tasks 1, 3, and 5's account-wide admission, public ontology invariant, and current consent.
- Produces: one end-to-end non-allowlisted product flow while preserving exact confirmation, claim idempotency, and no-reroll rules.

- [ ] Add an integration scenario for an authenticated user that was never in the former allowlist: chart -> locale -> fresh consent -> exact confirm -> accepted generation -> Codex stages -> ready Pattern.
- [ ] In the same scenario, prove missing/wrong confirmation is 400, missing consent is blocked, public ontology absence is blocked, and provider rows/budgets remain untouched before eligibility completes.
- [ ] Prove exact idempotency replay, reserved claim replay, accepted claim no-reroll, deleted claim no-reroll, failed-attempt retry, chart-correction new fingerprint, ontology recall, and consent withdrawal remain unchanged.
- [ ] Run the focused API/web flow before removing the editorial branch and confirm the formerly non-allowlisted case still resolves through the old cohort decision:

      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/services/pattern-execute-codex.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/PatternExperience.test.tsx src/App.test.tsx
- [ ] Remove the `PatternChapters` import and `editorial_catalog` branch from `PatternExperience`. The source inventory shows no other production consumer, so delete `PatternChapters.tsx` and its isolated test; preserve the underlying M4 data and privacy/export handling.
- [ ] Keep chart/locale/ontology/consent/error/progress/ready/deleted/withdrawn states accessible and keyboard/screen-reader coherent. Do not add automatic Pattern generation; the reader still activates the reviewed action.
- [ ] Assert the client request continues to send exactly:

      {
        schema_version: "0.7.0",
        consent_policy_version: "1.1.0",
        confirm: "GENERATE MY PATTERN",
        reason: "first_open" | "first_open_retry" | "failed_attempt_retry"
      }

- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/services/pattern-execute-codex.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/PatternExperience.test.tsx src/App.test.tsx
      npm run typecheck -w @patternlike/api -w @patternlike/web

- [ ] Commit: `web: make generated Pattern account-wide`

## Task 7: Remove rollout bindings and supersede active instructions

**Files:**

- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/scripts/wrangler-config.test.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `docs/deploy/codex-production-provider.md`
- Modify: `docs/deploy/openai-pattern-rollout.md`
- Modify: `docs/deploy/2026-08-23-pattern-generation-handoff.md`
- Modify: `docs/deploy/pattern-erasure-replay-drill.md`
- Modify: `docs/deploy/api-production.md`

**Interfaces:**

- Consumes: Tasks 1-6's source behavior and plan 1's Codex provider/Daily runbook changes.
- Produces: Wrangler/runtime configuration with no Pattern gate variables and active instructions that use whole-Worker rollback.

- [ ] Add failing Wrangler tests proving neither block defines `PATTERN_AI_ROLLOUT` nor `PATTERN_INTERNAL_ACCOUNT_IDS`, and both deployable blocks use `PATTERN_PUBLISHER="codex"` with all three `900000` timeouts.
- [ ] Run configuration tests and confirm they fail because the rollout variables and development synthetic publisher remain:

      npm run test:wrangler-config -w @patternlike/api
      npm exec -w @patternlike/api -- vitest run src/config.test.ts
- [ ] Remove both obsolete vars from top-level and production Wrangler configuration. Do not leave empty strings; absence is the contract.
- [ ] Ensure development source configuration is also Codex-only. Hermetic tests that need deterministic output inject a publisher in test code rather than selecting `synthetic` in Wrangler.
- [ ] Rewrite active runbook steps that tell operators to set a Pattern rollout or allowlist. Preserve dated historical observations only when clearly labeled non-actionable history.
- [ ] Replace rollback instructions with the approved behavior: roll back the Worker/config version, stop the runner for provider containment, and rely on current-owner checks. Do not introduce an account gate. Budget exhaustion may stop spend but is not advertised as a product switch.
- [ ] Update erasure replay instructions so they no longer require keeping a removed flag off; instead require the runner stopped or the known-good Worker version during a destructive drill.
- [ ] Reconcile `api-production.md` with its pre-existing user edit before staging. The current `README.md` contains no Pattern rollout/allowlist instruction, so leave that user-owned file untouched.
- [ ] Run:

      npm run test:wrangler-config -w @patternlike/api
      npm exec -w @patternlike/api -- vitest run src/config.test.ts
      rg -n "PATTERN_AI_ROLLOUT|PATTERN_INTERNAL_ACCOUNT_IDS" apps packages contracts db scripts README.md docs/deploy

- [ ] Inspect every remaining documentation match. Immutable historical reviews/specs/plans may retain the old names as evidence; current source, configuration, helper defaults, and actionable deployment instructions may not.
- [ ] Commit: `ops: remove Pattern rollout configuration`

## Task 8: Integrated Pattern verification and handoff

**Files:**

- No file changes expected. Stop and return to the owning task if this gate exposes a defect.
- Record command summaries in the eventual pull request; do not commit provider content or generated logs.

**Interfaces:**

- Consumes: every deliverable from Tasks 1-7 plus the completed Daily plan.
- Produces: a clean, locally verified combined implementation candidate for the production rollout plan; it performs no remote mutation.

- [ ] Run forbidden-path searches:

      rg -n "PATTERN_AI_ROLLOUT|PATTERN_INTERNAL_ACCOUNT_IDS|readPatternAiRollout|patternRolloutAllows|isInternalPatternAccount|isPatternAiCohort" apps packages contracts db scripts
      rg -n "PATTERN_PUBLISHER\s*=\s*\"(openai|workers_ai|synthetic)\"" apps/api/wrangler.toml docs/deploy
      rg -n "ontologyServesAccount\([^\n]*," apps/api/src

- [ ] Confirm source/config searches are empty and remaining documentation hits are explicitly historical, not executable guidance.
- [ ] Run the focused integrated set:

      npm run test -w @patternlike/shared
      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts src/routes/pattern.test.ts src/services/pattern-execute-codex.test.ts src/services/pattern-execute-protocol.test.ts src/services/pattern-ontology-evidence.test.ts src/services/pattern-lifecycle.test.ts src/services/codex-provider-domain.test.ts src/scheduled.integration.test.ts src/queue.test.ts src/config.test.ts src/middleware/config-guard.test.ts
      npm exec -w @patternlike/web -- vitest run src/components/PatternExperience.test.tsx src/components/PatternConsent.test.tsx src/App.test.tsx
      npm run test:contracts
      npm run typecheck
      npm run build

- [ ] Run `git diff --check` and inspect `git status --short`. Confirm no user-owned edit, secret, provider output, local database, backup, or Wrangler state is staged.
- [ ] Confirm the combined Daily+Pattern branch contains `0017` but has not applied it remotely or merged/deployed.
- [ ] Hand off the immutable implementation candidate to [`2026-08-27-codex-reader-rollout.md`](./2026-08-27-codex-reader-rollout.md). That plan owns `npm run ci:local`, the exact-account external gates, production D1 ordering, canaries, and rollback.
