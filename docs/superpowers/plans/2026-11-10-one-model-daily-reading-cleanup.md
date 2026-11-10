# One-Model Operator Generation and Reissue Plan

Date: November 10, 2026
Status: **Revised plan for review**
Baseline: `22ca2d757587103b354a960e8f20c29b51c2b5e6` (`docs/architecture-map-reconciliation`, PR #84)

## Goal

Finish the remaining code item under the superseded R04 section of [`docs/architecture/source-map/backlog.md`](../../architecture/source-map/backlog.md):

> Make ordinary internal generation and reissue reserve through the configured model, and leave assembler-published editions as historical records.

Today (`PUT /v1/readings/today`), the scheduler (`runReadingScheduler`), and calculation-defect/chart-correction invalidation (`POST /internal/readings/invalidate` + `reserveFactRepair`) already reserve through `enqueueConstrainedReading` and `buildGenerationCommandV2`. Only the two ordinary operator routes—`POST /internal/readings/generate` and `POST /internal/readings/reissue`—still call `buildGenerationCommand` and freeze a deterministic V1 command.

This plan switches those operator reservation paths to the configured model while keeping `StoredReadingV3` (`0.3.0`) decoding, already-frozen V1 job execution, shared content-release utilities, and `patternlike-ops` D1 data untouched.

---

## Global Constraints & Non-Goals

- **No D1 data wipe:** Do not touch `patternlike-ops` or local D1 user/reading tables.
- **Keep historical `0.3.0` editions readable:** Keep `StoredReadingV3` decoding and projection in `apps/api/src/services/stored-reading.ts`, `apps/api/src/db/readings.ts`, `apps/api/src/services/reading-product-projection.ts`, `apps/api/src/routes/readings.ts`, `apps/web`, and `apps/api/test/m3-rollout-compat.test.ts`.
- **Keep frozen V1 execution and shared modules intact:**
  - Keep `apps/api/src/services/generation-command.ts` (`toAssemblyUncertainty` is shared with `daily-sky-client.ts`, `GenerateDailyReadingCommand` is the `V1 | V2` union, and historical-fixture tests still build V1 commands).
  - Keep `apps/api/src/services/generate-daily-reading.ts` so a claimed V1 job still executes under its frozen pin.
  - Keep `apps/api/src/services/content-release.ts` (`hashesEqual` is used by Pattern publication, ontology verification, and the signing client), `apps/api/src/routes/content-releases.ts`, `apps/api/src/db/content-releases.ts`, `apps/api/src/services/release-bundle.ts`, and `apps/api/src/services/pattern-content.ts`.
- **Keep R04 disposition as `Superseded`:** Checking the open checkbox under R04 in `docs/architecture/source-map/backlog.md` records that operator routes now reserve through the configured model; the R04 table disposition remains `Superseded` because the two-family successor was withdrawn.
- **Leave other worktrees and remote branches out of this change:** Do not delete `origin/feat/r04-family-aware-reissue` or modify `/tmp/pl-r04`, `/tmp/pl-r05`, or `/tmp/pl-spec` as part of switching the operator routes.

---

## Task 1: Guard V2 Reservations Against Concurrent `ai_synthesis` Grant Changes

**Files:**
- `apps/api/src/db/consents.ts`
- `apps/api/src/db/generation.ts`

**Changes:**
- [x] In `apps/api/src/db/consents.ts`, export `assertExactCurrentAiSynthesisGrant(env, userId, consentId, policyVersion, now)` using `assertion_probe` and the same `ORDER BY version DESC, created_at DESC, id DESC LIMIT 1` ordering as `loadLatestAiConsent`. It aborts the enclosing D1 batch if the newest `ai_synthesis` row is no longer `consentId` in `status = 'granted'` under `policyVersion` and unexpired at `now`.
- [x] In `apps/api/src/db/generation.ts`, include `assertExactCurrentAiSynthesisGrant` in the `DB.batch` of `reserveInitial` and `reserveReissue` **only when `isCommandV2(command)` is true**, bound to `command.ai_consent.consent_id` and `command.ai_consent.policy_version`. V1 reservations (used by historical-fixture tests) do not run this assertion.

---

## Task 2: Switch Operator Generation and Reissue to the Configured Model

**Files:**
- `apps/api/src/services/enqueue.ts`
- `apps/api/src/routes/internal-generation.ts`

**Changes:**
- [x] **Operator initial generation (`POST /internal/readings/generate`):**
  - Check `readReadingV5Rollout(env)` and `rolloutAllows(rollout, "internal")` first. When `"off"` or invalid, return `{ ok: false, reason: "rollout_disabled", detail: ... }` before any D1, DEK, or calculation work.
  - Load user preferences (`loadPreferences(env, userId)`):
    - Missing preferences or inactive user → `chart_not_found` (`409`).
    - `timezoneSource === "default_unconfirmed"` → `timezone_confirmation_required` (`409`).
    - `localeSource === "default_unconfirmed"` → `locale_confirmation_required` (`409`).
  - Resolve today in the user's confirmed zone via `resolveV5TargetDate(preferences.timezone, now)` (returning `timezone_confirmation_required` if null).
  - Reserve through `enqueueConstrainedReading(env, userId, { entry: "internal", reservationReason: "internal", targetLocalDate, now })`.
- [x] **Operator reissue (`POST /internal/readings/reissue`):**
  - Restrict `REISSUE_REASONS` in `apps/api/src/routes/internal-generation.ts` to `["safety_correction", "defect_repair"]`:
    - `chart_recalculated` already belongs to `POST /internal/readings/invalidate` + `reserveFactRepair`.
    - `consent_revoked` is not an operator reason that starts a new model call.
  - Check `readReadingV5Rollout(env)` and `rolloutAllows(rollout, "internal")` first (`rollout_disabled` when `"off"` or invalid).
  - Load the predecessor row:
    ```sql
    SELECT id, local_date, revision, status, assembly_mode
    FROM daily_readings
    WHERE id = ? AND user_id = ?
    ```
  - If the row is missing or `status !== "published"`, return `{ ok: false, reason: "stale_predecessor", detail: "the expected live reading is not published" }` (`409`).
  - **Leave assembler-published editions as historical records:** If `predecessor.assembly_mode !== "constrained_model"`, return `{ ok: false, reason: "not_replaceable", detail: "assembler-published readings are historical records and cannot be reissued" }` (`409`).
  - **Date scope:** Pass `targetLocalDate: predecessor.local_date` to `enqueueConstrainedReading` without applying the automatic-replacement current-or-next-day window, so an operator can still issue a `safety_correction` or `defect_repair` for a published `constrained_model` edition in History.
  - Reserve through `enqueueConstrainedReading` with:
    - `entry: "internal"`
    - `reservationReason: "manual_reissue"`
    - `targetLocalDate: predecessor.local_date`
    - `revision: predecessor.revision + 1`
    - `revisionReason`
    - `supersedesReadingId: expectedLiveReadingId`
    - `now`
- [x] **Preserve legacy V1 test helper entry points where needed:**
  - Either introduce explicit operator functions (`enqueueInternalDailyReading`, `enqueueInternalReissue`) wired to `POST /internal/readings/generate` and `POST /internal/readings/reissue` while keeping `enqueueDailyReading` / `enqueueReissue` for the existing M3/V1 integration tests, **or** update `enqueueDailyReading` and `enqueueReissue` in place and move the M3/V1 test callers (`generation.integration.test.ts`, `readings.integration.test.ts`, `key-rotation.test.ts`) to a V1 test helper.
- [x] **Status and message mapping in `apps/api/src/routes/internal-generation.ts`:**
  - Add `ai_synthesis_consent_required` and `skipped_local_date` to `CLIENT_ERROR_REASONS` (`409`).
  - In `statusFor(reason)`, return `503` for `rollout_disabled`, `publisher_not_configured`, and `daily_sky_unavailable` (alongside `calc_unavailable` and `release_unreadable`).
  - Keep `conflict`, `policy_unsupported`, and `context_ineligible` on `424`, and add safe fixed messages in `PRIVATE_FAILURE_MESSAGES` so internal D1 or builder details do not leak in responses.

---

## Task 3: Focused Tests for Operator Generation and Reissue

**Files:**
- `apps/api/src/routes/internal-generation.integration.test.ts`
- `apps/api/src/services/generation.integration.test.ts`

**Test cases:**
- [x] `POST /internal/readings/generate`:
  - Reserves a `pending` row with `assembly_mode = 'constrained_model'`, `release_version IS NULL`, and a V2 command (`command_version: "v2"`, `reservation_reason: "internal"`) when `READING_V5_ROLLOUT` admits `"internal"` (`internal`, `first_open`, `hybrid`) and `ai_synthesis` is granted.
  - Returns `200 { status: "duplicate" }` when a reading is already pending or published for that user-day.
  - Returns `503 rollout_disabled` when `READING_V5_ROLLOUT = "off"` (or invalid), with zero rows written to `daily_readings` or `jobs`.
  - Returns `409 ai_synthesis_consent_required` when the user has no active `ai_synthesis` grant.
  - Returns `409 timezone_confirmation_required` / `locale_confirmation_required` when preferences are unconfirmed.
  - Returns `503 calc_unavailable` / `daily_sky_unavailable` on upstream calculation unavailability, and `424` with a sanitized message on D1 conflict.
- [x] `POST /internal/readings/reissue`:
  - Reserves an `r+1` `pending` row with `assembly_mode = 'constrained_model'` and a V2 command (`reservation_reason: "manual_reissue"`, `supersedes_reading_id = expected_live_reading_id`) for a published `constrained_model` reading under `safety_correction` or `defect_repair`, including a published reading on an earlier local date.
  - Rejects `initial`, `consent_revoked`, and `chart_recalculated` with `400 invalid_body`.
  - Returns `503 rollout_disabled` when `READING_V5_ROLLOUT = "off"`.
  - Returns `409 not_replaceable` when the published target has `assembly_mode = 'deterministic'`, leaving the assembler-published edition untouched and readable.
  - Returns `409 stale_predecessor` when the target is not `published` or does not belong to `user_id`.
  - Returns `409 ai_synthesis_consent_required` when the user's `ai_synthesis` grant is missing or revoked, and aborts the reservation batch if the frozen grant changes before commit.

---

## Task 4: Backlog, Source Map, and 16-Lane Local Gate

**Files:**
- `docs/architecture/source-map/backlog.md`
- `docs/architecture/source-map/map.json`
- `docs/architecture/source-map/current.json`
- `docs/architecture/source-map/README.md`
- New snapshot directory under `docs/architecture/source-map/snapshots/`

**Steps:**
- [x] In `docs/architecture/source-map/backlog.md`:
  - Keep R04's table status as `Superseded`.
  - Check the second box under R04: `- [x] Make ordinary internal generation and reissue reserve through the configured model, and leave assembler-published editions as historical records.`
- [x] In `docs/architecture/source-map/map.json`:
  - Update `claim-leaf-operator-generation-and-repair-1` and `claim-leaf-committed-production-switches-5` (and their evidence selectors in `apps/api/src/routes/internal-generation.ts` and `apps/api/src/services/enqueue.ts`) to describe that `POST /internal/readings/generate` and `POST /internal/readings/reissue` pass the `READING_V5_ROLLOUT` (`internal`) gate, freeze V2 `constrained_model` commands, and refuse to reissue `deterministic` historical editions.
- [x] Run focused tests and typecheck (`npm run typecheck`, `npx vitest run src/routes/internal-generation.integration.test.ts`).
- [x] Capture the updated source-map snapshot, update `docs/architecture/source-map/current.json` and `README.md`, and verify `npm run test:source-map` and `npm run map:check:current` (`problem_count: 0`).
- [x] Run the full 16-lane `npm run ci:local` merge gate.
