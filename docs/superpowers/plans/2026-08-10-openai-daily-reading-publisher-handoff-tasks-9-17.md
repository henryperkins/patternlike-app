# M5 OpenAI Daily Reading Publisher — Handoff Prompt, Tasks 9–17

Paste everything below the rule into a fresh session. It supersedes
`2026-08-10-openai-daily-reading-publisher-handoff.md`, which covered Tasks 5–17
and is now historical.

---

## Your task

Finish implementing the OpenAI daily reading publisher. **Tasks 1–8 are landed
and green; Tasks 9–17 remain.**

Read these three, in this order, before touching anything:

1. `docs/superpowers/specs/2026-08-10-openai-daily-reading-publisher-design.md`
   — the approved design. Authoritative. If implementation evidence requires a
   behavioural change, stop and amend the design before changing code.
2. `docs/superpowers/plans/2026-08-10-openai-daily-reading-publisher.md` — the
   task-by-task plan, including 41 Global Constraints that bind every task.
   Tasks 9–17 start at "### Task 9".
3. `docs/superpowers/plans/2026-08-10-openai-daily-reading-publisher-execution-notes.md`
   — the ledger, the recorded implementation base, and every deviation from
   Tasks 1–8 with its reason.

Also read `CLAUDE.md` and `AGENTS.md`.

Work task by task in plan order. Each task's final step names its exact commit
subject — use it. Follow the plan's TDD order: write the named failing test, run
it, record the expected failure, then implement.

## Where things stand

```
PATTERNLIKE_M5_IMPLEMENTATION_BASE = 76541c7a2bb1bb2718fc45543eae757806aeaa43
```

| Commit | Task |
| --- | --- |
| `76e3267` | 1 — M5 contract family, `schema_version` 0.5.0 |
| `5e6c497` | 2 — shared M5 wire types, pinned local-day resolver |
| `0fae273` | 3 — daily-sky calculation policy |
| `c070b85` | 4 — `POST /v1/daily-sky`, ephemeris goldens |
| `5dd3260` | 5 — constrained input compiler and candidate validation |
| `8645d03` | 6 — M5 storage, 0003, provider budget |
| `e26d0f8` | 7 — configured OpenAI publisher boundary |
| `391a5b0` | 8 — frozen constrained V2 generation commands |

Green at `391a5b0`: `python contracts/validate_schemas.py`,
`python contracts/m0/smoke_check.py`, `python contracts/smoke_check.py`,
shared 57, reading-engine 105, calc-stub 134, **api 626**, root
`npm run typecheck`, and the production Worker dry-run (225.81 KiB gzipped).

**No production gate has been touched.** No remote migration, no
`wrangler secret put`, no deploy, no cron, no live OpenAI call. Keep it that way.

## What Tasks 5–8 give you

### `@patternlike/reading-engine` (new, Task 5)

- `prepareConstrainedReadingInput(input): PreparedConstrainedReadingInput` — the
  ONE eligibility-and-identity entry point. Expands each signal into one pin per
  allowed-use lane, runs the existing `partitionContext()` over the expansion,
  applies suppression through `factSuppressionReason()`, and spends the packet
  budget on context only after every eligible fact is already in. Returns
  `selected_facts`, `selected_context`, `selected_prior_readings`, `rejections`,
  `request`, `packet_bytes`, `input_manifest_canonical`, `identity_canonical`.
- `validateReadingCandidate(candidate, prepared)` — 15 closed checks
  (`CANDIDATE_CHECKS`). On success returns `validation` (the stored
  `ValidationResultV5`) and `units`: the ordered `ValidatedReadingUnit[]` with
  role, order, text, resolved `fact_refs`, and `context_refs`. **Task 10 should
  build `daily-reading-v5` and its evidence straight from `units`** — the
  headline→kicker, lead→`primary_theme`, reflection→`reflection`,
  note→`uncertainty_notice` mapping is already applied there. Only
  `paragraph_id`s are missing, because minting them is impure.
- `SELECTION_POLICY_VERSION`, `VALIDATION_POLICY_VERSION`,
  `MAX_PRIOR_READINGS`, `MAX_FEEDBACK_RECORDS`, `MAX_CONTEXT_TEXT_BYTES`,
  `HEADLINE_MAX_CHARS`/`LEAD_MAX_CHARS`/`PARAGRAPH_MAX_CHARS`/`REFLECTION_MAX_CHARS`,
  `utf8ByteLength`, `normalizeExcerpt`, `ConstrainedInputError`.
- The engine now has a type-only `@patternlike/shared` dependency and no longer
  declares its own `EvidenceLane`/`LifeDomain`.

### `apps/api` (Tasks 6–8)

- `db/provider-usage.ts` — `consumeProviderCallBudget(env, utcDate, limit)` and
  `utcDateFor(now)`. One conditional UPSERT with RETURNING; twelve racing
  consumers against a ceiling of four admit exactly four.
- `services/stored-reading.ts` — `StoredReading = StoredReadingV3 |
  StoredReadingV5`, `isStoredReadingV5`, `claimsSchemaVersionV5`.
- `db/readings.ts` — `ReadingRecord` has `releaseVersion: string | null`,
  `invalidatedAt`, and `status` including `invalidated`. `ReadingEvidence` is a
  discriminated union with `schemaVersion`.
- `routes/readings.ts` — `projectReadingV5` and `projectEvidenceV5` already
  exist and are contract-validated. **Task 13 adds consent gating and status
  mapping around them, not the projections themselves.**
- `db/generation.ts` — `PredecessorTransition` (`none` |
  `supersede_published` | `retain_invalidated`; Task 11 uses the third),
  `reservationColumns()`, `Claim.leaseExpiresAt`, union-typed commands.
- `services/reading-rollout.ts` — `rolloutAllows(mode, entry)`,
  `readReadingV5Rollout(env)`.
- `services/reading-publisher.ts` — `PublisherConfigPin`, `PublisherResult`,
  `resolvePublisherConfiguration(env)`, and every pinned constant
  (`OPENAI_READING_TIMEOUT_MS = 90_000`, `READING_SCHEDULER_BATCH_LIMIT = 100`,
  `READING_PREGEN_LEAD_MINUTES = 30`, `READING_PREGEN_SPREAD_MINUTES = 45`,
  `READING_PREGEN_ACTIVE_DAYS = 30`, …).
- `services/reading-prompt.ts` — `buildResponsesRequest(request, pin)`.
- `services/openai-reading-publisher.ts` —
  `createOpenAiReadingPublisher(env).publish(request, options)`.
- `db/consents.ts` — `loadAiSynthesisGrant`, `loadContextSourceGrants`,
  `AI_SYNTHESIS_POLICY_VERSION`, `AI_SYNTHESIS_CATEGORIES_BY_POLICY`.
  **Task 13 adds grant/revoke here.**
- `services/context-compiler.ts` — `loadConstrainedContext(env, identity, date)`.
- `services/generation-command-v2.ts` — `buildGenerationCommandV2`,
  `GenerateDailyReadingCommandV2`, `GenerateDailyReadingCommand`, `isCommandV2`,
  `buildV5ReadingKey`, `projectNatalFacts`, `renderGenerationInputId`.
- `services/enqueue.ts` — `enqueueConstrainedReading(env, userId, options)` and
  `resolveV5TargetDate(zone, now)`.
- `services/generate-daily-reading.ts` — `dispatchGeneration(env, claim)` routes
  on the command's own version and currently answers `policy_unsupported` for
  v2. **Task 10 replaces that branch with `generateDailyReadingV5`.**
- `test/mock-calc-service.ts` — the OpenAI Responses fake is installed. It is
  keyed on the MODEL: `OPENAI_MOCK_TIMEOUT`, `_NETWORK_ERROR`, `_RATE_LIMITED`,
  `_SERVER_ERROR`, `_AUTH_FAILED`, `_FORBIDDEN`, `_MODEL_MISSING`, `_REFUSAL`,
  `_NO_TEXT`, `_TWO_TEXTS`, `_INVALID_JSON`, `_WRONG_SHAPE`,
  `_ECHO_WRONG_DATE`, `_UNGROUNDED`. The happy path reads the packet and returns
  a grounded candidate echoing the request's own date, locale, and fact ids.

### Database

`db/d1/0003_m5_openai_reading_publisher.sql` exists and is applied by every test
run. Nullable `release_version` required exactly for deterministic rows,
`invalidated` status with `invalidated_at` required exactly then, the
`reading-v5:` namespace CHECK, `reading_provider_daily_usage`, and five partial
indexes: `idx_users_next_due_at`, `idx_users_unseeded_due`,
`idx_daily_readings_failed_generation`, `idx_daily_readings_invalidated_repair`,
`idx_jobs_failed_result_class`. **It has NOT been applied to production.**

## Decisions you must not silently reverse

**`generation_anchor` is the freeze instant, not the day anchor.** V2 carries
both `anchor_at` (local noon, inside the half-open day) and `generation_anchor`
(when the command was frozen, published as `generated_at`). A pre-generated
edition is frozen before its own local day starts.

**The identity preimage excludes rejections.** Execute re-runs the compiler over
the command's frozen SUBSET. A preimage naming what was rejected could never be
reproduced, and the mismatch would read as an integrity defect.

**The rollout gate runs before anything costs anything.**
`enqueueConstrainedReading` checks it before the command is built — before any
calculation call, context decryption, or consent read. A test asserts `off`
leaves no reading, no job, and no cycle row.

**`factAttributes` is the whole point of the provider packet.** The candidate
validator freezes its accepted vocabulary from the union of those arrays. Do not
replace it with a regex over prose.

**Two identities, not one.** `generation_input_id` (`gin_sha256_` + the FULL
64-hex digest) names the frozen eligible input and policy. `content_hash` and
`provider_response_hash` name the candidate that won publication.
`completeReading()`'s claim CAS is the only publication authority.

**The adapter decides nothing.** No retry on any status, ever — one queue
delivery is one provider call, and the shared failure policy (Task 9) owns retry
class and command replacement.

## Traps that will cost you an hour each

**The Bash tool is Git Bash / POSIX sh.** Use heredocs, not PowerShell
here-strings. **A large `python - <<'PY'` heredoc silently breaks** — two of
them in this session failed with `unexpected EOF while looking for matching "`.
For anything longer than ~50 lines, write the script to the session scratchpad
with the Write tool and run `python <path>`.

**Python is native Windows Python.** `/tmp` resolves to `\tmp`. Use the
scratchpad. Prefer the `Edit`/`Write` tools for TypeScript.

**The Bash working directory persists between calls.** Use absolute paths.

**`apps/api/vitest.config.ts` `fileParallelism: false` must stay.**

**`resetDb()` in `apps/api/test/helpers.ts` deletes from an explicit FK-ordered
list.** Task 12 adds tables; a missing table leaks rows between suites.
`reading_provider_daily_usage` is already registered.

**Every API test must `seedUser()` first.** For a V2 test you also need
`confirmPreferences()`, `seedChart()`, an `ai_synthesis` consent row, and an
enabled publisher env — see `enabledEnv()` and `grantAiSynthesis()` in
`src/services/generation-command-v2.test.ts` and reuse them.

**`checkSecureConfig` now validates publisher configuration BEFORE the
development short-circuit.** A test env with a malformed publisher var 503s
every request in development too.

**`contracts/validate_schemas.py`'s `check_m5_manifest()` requires each schema's
`defines` array to equal its `$defs` keys exactly**, pins the M3 manifest digest,
and rejects a dirty `contracts/m3`.

**`npm test -w @patternlike/calc-stub` runs `pretest`**, which downloads the
pinned ephemeris. Never stage `apps/calc-stub/data/ephe` or `dist`.

## Task-specific pointers

**Task 9 (failure policy).** The five duplicate sites to collapse are
`queue.ts`, `services/enqueue.ts` (`SCHEDULER_REPLACEABLE`),
`services/ensure-today-reading.ts`, `routes/internal-generation.ts`, and
`generate-daily-reading.ts`'s local `ExecutionFailure`. `MAX_JOB_ATTEMPTS = 4`,
`MAX_COMMAND_GENERATION = 3`, `CLAIM_LEASE_MS = 5 * 60 * 1000` are all in
`db/generation.ts` today. The provisional `command_replacement_reason` on
`GenerateDailyReadingCommandV2` is typed `string | null` and should become the
shared `CommandReplacementReasonV2` when this module exists.

**Task 10 (execution).** `dispatchGeneration` is the seam. `Claim.leaseExpiresAt`
is already carried. Build the reading and evidence from
`validateReadingCandidate(...).units`. Pass `command.publisher` to the adapter,
never the current env. `completeReading` already takes a `PredecessorTransition`.
The safe-logging sweep in Step 6 is large and touches every `console.*` in
`apps/api/src` — `routes/readings.ts`, `queue.ts`, `enqueue.ts`,
`index.ts`, `routes/sessions.ts`, `services/identity.ts`, `routes/timing.ts`,
`routes/birth.ts`, `routes/content-releases.ts`, `routes/internal-generation.ts`.

**Task 11 (invalidation).** `PredecessorTransition.retain_invalidated` already
asserts the predecessor is `invalidated` both before and after the batch;
`reserveFactRepair` has to produce a command whose `supersedes_reading_id` names
it. 0003's `idx_daily_readings_invalidated_repair` is the discovery index.

**Task 12 (scheduler).** `resolveDailySkyWindow()` already returns
`{ ok: false, reason: "skipped_local_date", nextRepresentableDate }`.
`users.next_due_at` exists since 0001 and is still null everywhere — 0003 only
indexed it. `resolveV5TargetDate(zone, now)` uses the pinned tz database.

**Task 13 (consent + product API).** `db/consents.ts` has the read side; add
grant/revoke there. The v5 projections already exist in `routes/readings.ts`;
what is missing is consent gating, the 202/409/424/503 status mapping, and the
`vitest.m3-compat.config.ts` pre-migration lane.

**Task 14 (web).** `apps/web/src/lib/reading-format.ts` maps paragraph roles to
kickers and tones. v5 adds `collective_context` and removes `safety_fallback`;
the v3 entry must survive for historical readings.

## Verification

Focused lanes are named per task in the plan. The full gate, from the repository
root:

```bash
python contracts/validate_schemas.py
python contracts/m0/smoke_check.py
python contracts/smoke_check.py
npm run typecheck
npm test
npm run build
```

`npm run build` requires `apps/web/dist`, which the root `build` script builds
first. Task 17 adds seven `rg` invariant searches; a no-match `rg` exit there is
the expected evidence, not a failure.

## When you finish

Task 17 Step 7 is a handoff report, not a deployment. Do not apply the remote
migration, set secrets, deploy, enable first-open, or activate cron unless the
user explicitly authorizes that specific gate.

Update the ledger and the deviations section in
`2026-08-10-openai-daily-reading-publisher-execution-notes.md` as you go.
