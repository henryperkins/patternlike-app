# Readiness, runtime metrics, and prose guidance implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation and review tasks. Checkboxes track the deliverables and verification.

**Goal:** Explain reading availability and permitted actions accurately, expose bounded administrator diagnostics, and prepare source-faithful future writer guidance.

**Architecture:** Compose existing authorized responses in a pure client selector; retain domain endpoints as mutation authorities. Capture successful asset completion times in their existing guarded transactions, and expose three aggregate work classes through a purpose-scoped administrator route. Keep richer Pattern inspection separately authorized and audited, preserve old prompt behavior, and prepare an explicitly selected offline writer version.

**Tech Stack:** React/Vite, strict TypeScript, Hono, Cloudflare D1, Vitest/node:test; existing Node 22 and local CI.

**Spec:** [Slices 7–8](../specs/2026-09-08-readiness-runner-fairness-design.md), [AI editorial reconciliation](../../reviews/artifacts/interpretation-quality/2026-09-11-ai-review/README.md).

## Global constraints

- User authorization: “Proceed with next steps,” following reviewed integration PR 54. Base is `b38d87c76167f60bcce86fb5443a34b9ae6dc4c3`; worktree is `.worktrees/readiness-metrics`, branch `codex/readiness-metrics`.
- Preserve the existing P2 feedback-draft behavior and accepted-reading availability during failed regeneration or optional graphics work.
- Presentation codes: `needs_input | needs_permission | can_start | queued | working | ready | retryable_failure | paused | unavailable`.
- Closed actions: `open_birth_details | confirm_locale | review_consent | start_generation | retry_generation | read_edition | reload_status`. A reload is a read; an unknown/stale observation cannot authorize a mutation.
- Work classes remain `text | portrait | mesh`; concurrency remains one. No ontology activation, generation-effect enablement, live provider generation, installed-runner restart, or alert delivery.
- Runtime metrics use existing administrator authentication and only `purpose=incident_response`; `Cache-Control: no-store`. Aggregate payloads/logs carry no account/job/reading IDs, chart facts, prompts, prose, object keys, or raw errors.
- New aggregate audit records follow the existing 13-calendar-month admin audit policy. Do not alter historical M7 inspection response shapes.
- Latency uses immutable reservation time to guarded successful acceptance, nearest-rank p50/p95 over the last 24 hours. Never backfill completion time from `updated_at`; missing history remains explicit.
- Keep all retained prose/candidate artifacts and default writer 1.0.3 unchanged. New Pattern writer 1.0.4 is request-builder opt-in only and remains rejected by current production configuration.
- Use the existing `npm run ci:local` merge gate and paste its real summary in the PR. Apply additive storage before deploying writes; no additional release-gate framework.

## Task 1: Completion capture and bounded aggregate metrics

**Files:** create `db/d1/0032_runtime_health.sql`, `packages/shared/src/runtime-health.ts`, `apps/api/src/services/runtime-health.ts`, `apps/api/src/routes/admin-runtime-health.ts`, colocated tests and additive schema/fixtures/OpenAPI; modify shared exports, guarded completion updates in `pattern-portrait.ts`/`pattern-portrait-mesh.ts`, `index.ts`, and scheduled audit maintenance.

**Interfaces:** `RuntimeHealthResponse` contains `schema_version: "runtime-health/v1"`, `sampled_at`, and `work_classes`. Each class contains `work_class`, `observation`, closed `reason`, the spec's count/age fields, and `completion_latency` with `successful_count`, `p50_ms`, `p95_ms`, `missing_timestamp_count`, `measurement_started_at`, `window_started_at`, and `coverage: "complete" | "partial" | "unavailable"`. `sampleRuntimeHealth(env, now)` returns this response. Publication failure counts use only explicit durable closed failure codes; unsupported observations are `not_collected`.

- [x] Add regressions for completion timestamp adoption and replay preservation before editing the guarded updates. Example assertion:

  ```ts
  const first = await db.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id = ?").bind(jobId).first();
  await replayAcceptedCompletion();
  expect(await db.prepare("SELECT completed_at FROM portrait_mesh_jobs WHERE id = ?").bind(jobId).first()).toEqual(first);
  ```

- [x] Add nullable timestamps, capture-start metadata, restricted aggregate-access audit table/index, and bounded-query indexes in migration 0032. Leave historical completion timestamps null. Capture new timestamps in the same successful adoption transaction; preserve them through replay.
- [x] Implement per-class consistent reads using one server observation time. Bound materialized metric inputs; report `sample_limit_exceeded` rather than an incomplete count if the configured fixed implementation ceiling is exceeded. Index current-state/window reads; test a large historical backlog outside the measurement window.
- [x] Verify empty, delayed, exhausted, expired, invalid/future timestamp, retry-age, quantile, historical missing-time, partial-query and missing-schema cases. Unknown classes/fields must not escape the response projection.
- [x] Mount `/admin/runtime-health` before the existing Pattern router's broad purpose middleware. Audit granted/denied/unavailable decisions without fabricating a target generation. Reject reader/runner credentials and wrong/repeated purposes; fail closed if the audit cannot be written.
- [x] Enforce 13-calendar-month audit expiry with bounded deletion in existing scheduled maintenance; test month-end boundaries and no unrelated deletion.
- [x] Add strict additive contract fixtures and explicit schema-version/compatibility notes. Run affected API, contract, and migration tests; record a synthetic query-plan/row-bound experiment.

## Task 2: Composed reader presentation and consequences

**Files:** create client readiness/consequence selectors and colocated tests under `apps/web/src/lib/`; integrate in `TodayView.tsx`, `PatternExperience.tsx`, `AccountPortraitExplorer.tsx`, `PortraitAutomationControl.tsx`, `PrivacyView.tsx`, and correction confirmation in `Onboarding.tsx`, plus necessary account/request scoping and tests.

**Interfaces:** selector inputs wrap existing authorized responses with account/chart/source/request-generation and observation time. Output independent Daily/Pattern/background/optional-asset presentations plus the closed action union. Consequence output carries `observedAt`, `evidence: "known" | "unavailable"`, documented content/unfinished/future effects, and null unknown effects. Existing route/actions resolve typed targets locally.

- [x] Test composed ready reading + failed regeneration; explicit versus absent retry eligibility; unavailable optional artwork for 3–6 chapter readings; stale/account-switched/late responses; unknown network outcomes versus terminal backend failures.
- [x] Bind `reload_status` to existing GET functions. In particular, Today refresh/polling must not call the PUT-based `ensureTodayReading`; keep deliberate first generation in its existing guarded action.
- [x] Integrate fixed copy/actions without replacing authoritative M9 or adding backend state. Retain the reading DOM/focus/draft during valid foreground revalidation.
- [x] Show documented consequences at existing correction/withdrawal/deletion/automation confirmations. Distinguish chart supersession, Daily invalidation, Pattern erasure, retained completed artwork, stopped unfinished work, and future permission. A request receipt is not completed asynchronous erasure.
- [x] Run affected web tests and real browser checks on narrow/wide layouts, keyboard, reduced-motion/fallback, long reading, and focus/reading-position preservation. Commit representative screenshots with the report.

## Task 3: Operator diagnostics, safe logs, and inactive alert policy

**Files:** add a read-only operator presentation/tool and pure diagnostic/policy modules with colocated tests; if required, add a separately audited Pattern diagnostic route and additive strict contract. Harden `apps/codex-runner/src/index.ts` logging through a dedicated serializer.

**Interfaces:** consume `RuntimeHealthResponse`; a separate scoped Pattern observation may contain authorized stage/timing/lease/reservation facts, never admitted into the aggregate response. Diagnosis returns closed stage/reason/recovery suggestions and observation age; unknown/contradictory/stale evidence cannot assert a root cause. Policy schema `runtime-health-policy/v1` requires positive per-class pending-age and expired-lease-persistence limits, sample count/interval, responder, destination, and recorded baseline reference.

- [x] Add fixtures showing reservation, execution, validation, and publication distinctions, missing/stale/contradictory data, insufficient authority, accepted provider output without publication, and retry origin independent of revision purpose.
- [x] Implement read-only diagnostics using existing scopes, with a separate additive route only where current inspection lacks needed facts. Keep old M7 shapes and artifact decryption rules unchanged; unknown domains are `not_collected`.
- [x] Add `serializeRunnerLogEvent(unknown)` using own data-descriptor checks, exact event/key/value allowlists, safe integer/timestamp validation and a fixed invalid-event fallback. Hostile getters, `toJSON`, raw errors and private extra keys never enter logs. Keep `processed` distinct from success.
- [x] Implement offline policy validation/evaluation with deterministic breach/persistence tests. Ship no fabricated production SLO/owner/destination and configure no delivery.
- [x] Record measured diagnostic fixture identification/recovery exercises as simulations; do not label them production incidents or completed operational adoption.

## Task 4: Explicit future Pattern prose guidance

**Files:** `apps/api/src/services/pattern-prompt.ts`, its tests, and a dated editorial guidance artifact/report. Preserve all four retained outputs and existing corpus candidates.

**Interface:** export `PATTERN_OFFLINE_WRITER_PROMPT_VERSION = "1.0.4"`; select new writer/correction instructions only when `pass === "writer" && pin.writer_prompt_version === "1.0.4"`. Keep existing policy exports and other pin behavior unchanged, including historically supported older pins. Production configuration remains compiled to 1.0.3.

- [x] Capture existing normal/correction instruction hashes and write regressions that new 1.0.4 instructions differ while existing pins remain byte-identical.
- [x] Add guidance to preserve uncertainty at the disputed clause, avoid invented mechanisms, name only permitted supplied features/participants, label practical suggestions as optional examples, and give sections/tensions/resources/counter-expressions distinct explanatory jobs.
- [x] Retain source-bound examples for disputed delay, trine, blind-spot correction, attention continuity, and maintenance decisions. Do not silently rewrite historical outputs or claim empirical reader improvement.
- [x] Run prompt/publisher/proof tests without network calls. Verify runtime defaults and deployed configuration cannot select the offline version. Refresh the existing creation-source fingerprint once all source changes settle; record implications for old queued commands.

## Task 5: Combined review, verification, and integration

- [x] Review each task against the spec and inspect the whole branch independently. Fix actionable findings and rerun covering checks.
- [x] Update the Slice 7 status and dated results with separate reader presentation, metric capture, diagnostic presentation, and alert-adoption records. Explicitly retain unobserved human outcomes and external operational adoption.
- [ ] Commit focused changes, run the full existing local gate on the frozen final head, and paste its exact summary in the PR.
- [ ] Verify migration compatibility and apply 0032 before merge/deployment. Observe actual build, served commit, protected aggregate-route authentication, and retained default-off configuration. Preserve earlier worktrees/stash.

The final two release steps are recorded in the integration PR after this plan is frozen for the local merge gate. They are not claimed complete by this pre-gate document.
