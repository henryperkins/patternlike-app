# Pre-production review — Pattern/Like

**Date:** 2026-11-10
**Commit reviewed:** `67a894f` (`perf/api-test-setup`)
**Working tree at review time:** two modified test-harness files (`apps/api/test/apply-migrations.ts`, `apps/api/vitest.config.ts`); no production code modified.
**Review type:** static, whole-codebase. No servers, tests, or live requests were run.

**Disposition (2026-11-10, `dbd3292`):** H1 and H2 are addressed on `perf/api-test-setup`. The Worker sign-out DELETE now has a 4-second deadline and one retry, which is the logout-specific part of M3. H3 is addressed in the working tree after `dbd3292`: session activity no longer writes `next_due_at`, that cursor only moves forward, and `reserveInitial` refuses any existing user-day row. No other finding in this review has been changed.

---

**Merge-preparation follow-up (2026-11-10):** The blanket monotonic H3 cursor guard was too broad: it delayed timezone changes and newly restored eligibility. The merge-preparation correction retains consumed-day protection and the session-activity removal, permits earlier scheduling only for an unreserved target day, and advances consumed days in the current timezone. The original review and its other open findings remain preserved below. See [merge-preparation verification](2026-11-10-api-test-merge-preparation.md) for current evidence and limitations.

## 1. Scope and method

### 1.1 System map

| Area | What it is | Entry points |
| --- | --- | --- |
| `apps/api` | Hono Cloudflare Worker | `src/index.ts` (`fetch`), `src/queue.ts` (four consumers), `src/scheduled.ts` (two cron lanes) |
| `apps/web` | React/Vite SPA | `src/main.tsx`, `src/App.tsx`, `src/lib/api-client.ts`, `public/sw.js` |
| `apps/calc-stub` | AGPL Swiss Ephemeris HTTP service | `src/server.ts` (`/v1/calculate`, `/v1/cycles`, `/v1/daily-sky`, `/health`) |
| `apps/codex-runner` | Outbound-polling CLI runner | `src/index.ts`, `src/runner.ts`, `src/isolated-codex-json.ts` |
| `apps/ontology-signer` | Isolated signing Worker | `src/index.ts` (`signOntology` RPC) |
| `packages/shared` | Contracts, canonicalization, timezone primitives | — |
| `packages/reading-engine` | Deterministic Daily selection and validation | `constrained-input.ts`, `eligibility.ts`, `assemble.ts` |
| `packages/pattern-engine` | Deterministic Pattern plan/candidate/ontology rules | `plan-validate.ts`, `candidate-validate.ts`, `ontology.ts`, `selection.ts` |

### 1.2 Authority planes in `apps/api`

1. **Consumer session** — `/v1/*`: `configGuard` → `authenticate` → `accountStateGate`.
2. **Service token** — `/internal/*`: `configGuard` → `serviceAuth`.
3. **Cloudflare Access** — `/admin/*`: `configGuard` → `adminAuth`.
4. **Codex runner** — `/codex-provider/*`: `configGuard` → `codexRunnerAuth`.
5. **Crypto operator** — `/crypto-operator/*`: `configGuard` → `cryptoOperatorAuth`.

Unauthenticated by design: `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/account/deletion-status`, `/health`, `/v1/meta`.

### 1.3 Critical paths traced

- OIDC ID token → `verifyIdToken` → `linkIdentity` → `createSession` → cookie/bearer → `resolveSession` → route.
- Birth profile → `birth_calc_reservations` claim protocol → `invokeCalc` → chart publication batch → `reconcilePatternAfterChartCorrection`.
- Scheduler → `selectReadingScheduleTarget` → `enqueueConstrainedReading` → queue → `generateDailyReadingV5` → publication.
- Privacy export/deletion → queue → R2 envelope / row deletion / DEK destruction.
- Admin artifact access → audit event → domain key unwrap → R2 read.
- Codex claim → artifact unwrap → runner → terminal write → owner nudge.
- DEK rotation and KEK rewrap campaigns.
- Web auth bootstrap, API client, logout, polling, consent panels.
- Calc request validation, daily-sky, cycles.
- Reading-engine constrained input and pattern-engine validation.

### 1.4 Confidence legend

- **Confirmed** — the code path is directly readable and unambiguous. Not a reproduction.
- **Needs verification** — the code is consistent with the concern, but a trigger, external configuration, or threat model was not established.

### 1.5 Evidence caveats

- The web and calc/engine sections originated in parallel static passes; the High and most Medium claims were independently re-read against the files.
- The pattern-engine and reading-engine rule tables were sampled, not exhaustively audited.
- External systems (Cloudflare Access policy, Fly host configuration, moment-timezone data vintage) were not inspected.

---

## 2. Executive summary

No Critical finding. No unauthenticated RCE, cross-user read, or SQL injection was found.

The highest risks at review time were:

1. **Account-session persistence after a failed logout** on a shared device. **Addressed in `dbd3292`.**
2. **A destructive UI path** that can erase all topic exclusions after a transient read failure. **Addressed in `dbd3292`.**
3. **Scheduler cursor arithmetic** that re-armed the due lane for a day that already had a row. **Addressed in the working tree after `dbd3292`.**
4. **A frozen-contract violation** in the chart uncertainty report on a normal no-coordinates flow.
5. **A writer validator that can silently omit a planned chapter or signature** from the published document.
6. **Time-zone-dependent day windows** in the calc service.
7. **Availability coupling**: auth depends on schedule math; the global config guard depends on unrelated optional knobs; the calc service has no body cap or timeout.

The dominant complexity liabilities are `routes/birth.ts` (1,688 lines, hand-rolled concurrency protocol), `middleware/config-guard.ts` (649 lines, ten subsystems per request), and the `assertion_probe` exception-as-assertion pattern.

---

## 3. Finding index

### 3.1 High

| ID | Area | Finding | Confidence | Status |
| --- | --- | --- | --- | --- |
| H1 | Web / API | Failed logout leaves a live 30-day session cookie | Confirmed | Addressed in `dbd3292` |
| H2 | Web | Failed exclusions load arms a one-click wipe | Confirmed | Addressed in `dbd3292` |
| H3 | API | Session activity rewinds the scheduler cursor; duplicate reservation and budget bypass | Confirmed | Addressed in the working tree after `dbd3292` |
| H4 | Calc / contract | `birthplace_unavailable` is outside the frozen M0 chart schema | Confirmed | Open |
| H5 | Calc | `daily-sky` accepts offsetless/date-only instants; day window depends on host TZ | Confirmed | Open |
| H6 | Pattern engine | Writer validator can drop a planned chapter/signature | Confirmed | Open |
| H7 | Calc | Unknown-accuracy angle/Moon inputs accepted when suppression list is empty | Confirmed | Open |
| H8 | Calc | No body cap, no timeout, blocking cycles scan | Confirmed (impact unmeasured) | Open |

### 3.2 Medium

| ID | Area | Finding |
| --- | --- | --- |
| M1 | API | `ensureTodayReading` resolves “today” twice with two engines |
| M2 | Web | `ApiError` throws on a non-conforming error body |
| M3 | Web | No request timeout; logout can block forever. The Worker DELETE now times out; other requests do not |
| M4 | Web | 401 rendered as content error across several panels |
| M5 | API | `configGuard` validates ten unrelated subsystems on every request |
| M6 | API | `calc-client` accepts an unvalidated `CalcResponse` |
| M7 | API | Admin sessions are not a control; table grows per request |
| M8 | API | 500 `request_id` appears in no log |
| M9 | Web | `PatternExperience` defeats its own freshness check |
| M10 | Web | Stale life-event idempotency key blocks the second save |
| M11 | Web | `DailyCheckInCard` reads `sources[0]` |
| M12 | Web | `ContextSourceControl` concurrent CAS with stale document |
| M13 | Web | Feedback load failure presented as “permission off” |
| M14 | Web | `TodayView` computes `retryable` and never uses it |
| M15 | API | `rotateUserDek` is a second, unbounded rotation used only by tests |
| M16 | Web | No error boundary; unchecked response casts |
| M17 | Web | Export id survives logout in `sessionStorage` |
| M18 | Reading engine | Personalized transit-Moon facts dropped, contradicting calc policy |
| M19 | Pattern engine | Derived-record authorization depends on ontology order |
| M20 | Pattern engine | Ontology predicate validation checks `type` only |
| M21 | Reading engine | Unknown body/sign/aspect/fact_class not rejected |
| M22 | Reading engine | One oversized context item exhausts the whole budget |
| M23 | Reading engine | Unsupported locale falls back silently |
| M24 | Calc | `accuracy` not validated in the engine |
| M25 | Calc | House-computation catch-all misattributes failures |
| M26 | Calc | `/v1/calculate` maps server faults to 400 |
| M27 | Reading engine | Manifest hash does not cover context content |
| M28 | Calc | `bodyName in SE_ID_BY_BODY` consults the prototype chain |

### 3.3 Low

Grouped in section 6: API (L1–L10), web (L11–L24), calc (L25–L33), pattern engine (L34–L38), reading engine (L39–L41).

### 3.4 Complexity

C1–C13 in section 7.

---

## 4. High-severity findings

### H1 — A failed logout leaves a valid 30-day session cookie

**Severity:** High · **Confidence:** Confirmed · **Status:** Addressed in `dbd3292`

**Files:** `apps/web/src/App.tsx:339-349`; `apps/web/src/lib/auth.ts:83-94`; `apps/api/src/middleware/auth.ts:41-45`; `apps/api/src/routes/sessions.ts:101-107`.

**Problem.** `endSessionAndSignOut` catches and discards every error from `endSession()`, then `signOut` runs Auth0 logout in `finally`. The inline comment claims the cookie is cleared server-side on the next resolve attempt, but `authenticate` only *reads* the cookie. The only clearing site is the `DELETE /v1/sessions/current` handler. The cookie is `httpOnly`, `path=/v1`, `maxAge` 2,592,000 seconds.

**Failing scenario.** The revoke request fails offline or times out. The UI reports “signed out” and Auth0 clears its session. The next page load's `GET /v1/chart` succeeds against the still-live cookie and the previous user is signed back in. On a shared device this is account takeover by the next person at the browser.

**Fix.** Do not present “signed out” until revocation succeeds, or set a client-side signed-out latch that suppresses the mount probe until the cookie is known dead. Add a short timeout and one retry to `endSession`.

**Addressed.** `endSession` aborts after 4 seconds and retries once. `signOut` calls Auth0 logout only after that DELETE resolves. A failed revoke stays on the signed-in screen, on Privacy, account recovery, and the unavailable-access sign-out control, and says the browser is still signed in. If the cookie was revoked and only the Auth0 redirect fails, the signed-out screen shows that issuer error. The issuer logout itself still has no deadline, and other API calls still have none (M3).

---

### H2 — A failed topic-exclusions load arms a one-click wipe

**Severity:** High · **Confidence:** Confirmed · **Status:** Addressed in `dbd3292`

**Files:** `apps/web/src/components/TopicExclusionsPanel.tsx:43-66,113-140`; `apps/api/src/routes/preferences.ts:288-304`.

**Problem.** Any GET failure sets `problem` and `loaded = true` but leaves `selected` as `[]`. The form then renders every checkbox unchecked with Save enabled (`disabled={busy}` only). `PUT /v1/preferences/topic-exclusions` replaces the set and accepts `[]`.

**Failing scenario.** A transient network failure on load produces an apparently empty exclusion list. One click on “Save exclusions” erases every saved exclusion. The error text sits above an enabled destructive control.

**Fix.** Disable Save until a successful load. On load failure render a retry control instead of the form, or keep the last known values and mark them stale.

**Addressed.** A failed GET leaves `loaded` false, hides the checkboxes, and offers Try again instead of Save. Save is rendered only after a successful load, and submit returns immediately if the list was never loaded. `PUT` still accepts `[]`, so a reader who loaded an empty list can still clear exclusions on purpose.

---

### H3 — Session activity rewinds the scheduler cursor

**Severity:** High · **Confidence:** Confirmed · **Status:** Addressed in the working tree after `dbd3292`

**Files:** `apps/api/src/db/sessions.ts:50,102-121`; `apps/api/src/db/reading-scheduler.ts:525-549`; `apps/api/src/services/reading-schedule.ts:113-146`; `apps/api/src/db/generation.ts:342-349`; `apps/api/src/services/run-reading-scheduler.ts:341-374`; `db/d1/0002_m3_daily_reading_pipeline.sql:312-321`.

**Problem.** `selectReadingScheduleTarget` selects “today” whenever tomorrow's pre-generation time has not arrived, and today's `dueAt` is `local midnight − 30..75 min` — already in the past for most of the day. `recomputeUserNextDueAt` writes that value unconditionally:

```sql
UPDATE users SET next_due_at = ? WHERE id = ? AND status = 'active'
```

It is called from `createSession` and from `touchSessionActivity`, which runs once per hour per active session. Any user activity therefore re-arms the “due” lane with a past timestamp.

The due lane re-targets the same local date and calls `enqueueConstrainedReading`. `reserveInitial` only refuses a duplicate when an existing row is `pending` or `published`:

```sql
WHERE EXISTS (SELECT 1 FROM daily_readings
              WHERE user_id = ? AND local_date = ? AND status IN ('pending','published'))
```

A `failed` row does not match, and no unique index covers `failed`. A new generation-1 reservation is inserted for a day that already exhausted its replacements. `loadCurrentGenerationState` resolves the two `revision = 1` rows with `ORDER BY r.revision DESC LIMIT 1` — arbitrarily.

**Failing scenario.** Day D's reading fails. The reader opens the app. Within 15 minutes the cron re-reserves D from scratch, resetting the documented two-attempt replacement budget and leaving two `daily_readings` rows for one user-day.

**Fix.** Make the cursor monotonic (`WHERE next_due_at IS NULL OR next_due_at < ?`), stop recomputing it from session activity, and make `reserveInitial` refuse any existing row for the user-day, delegating repair to `replaceFailedCommand`. Add a regression test: failed reading + user activity + cron ⇒ exactly one row.

**Addressed.** `createSession` and `touchSessionActivity` no longer call `recomputeUserNextDueAt`. That function writes `next_due_at` only when it is null or earlier than the selected due time, and it records skipped dates only when that write lands. `reserveInitial` now probes for any `daily_readings` row on the user-day and returns `duplicate` with that row's id. A second initial enqueue of a failed, budget-exhausted day therefore does not insert a row.

A direct replay showed the second revision-1 insert was already rejected before this change, by `UNIQUE (user_id, local_date, revision)` and by `uq_jobs_scope_key` on the generation-1 idempotency key. That rejection came back as `conflict` after `enqueueConstrainedReading` had already built the command. The live defect is the rewind: one sign-in moved a cursor from `2026-08-20T00:00:00.000Z` to `2026-08-11T04:00:00.000Z`, which puts the user back on the due lane. The due lane still builds a command before `reserveInitial`, so one past cursor can still pay for a build that then returns `duplicate`. It cannot be re-armed by session activity or by a later recompute.

---

### H4 — `birthplace_unavailable` is outside the frozen M0 chart schema

**Severity:** High · **Confidence:** Confirmed

**Files:** `apps/calc-stub/src/engine.ts:431-439`; `contracts/m0/chart-contract.schema.json` (`$defs/uncertaintyReport/.../reason`); `packages/shared/src/m5-reading-types.ts:51`; `apps/api/src/routes/birth.ts:140-151`.

**Problem.** When angles are suppressed the engine chooses:

```ts
const reason = syntheticNoon ? "unknown_birth_time" : "birthplace_unavailable";
```

The frozen M0 enum is `unknown_birth_time | unstable_across_window | insufficient_accuracy | policy_disabled`. `birthplace_unavailable` exists only in the M5 daily-uncertainty type, which is why this survived.

**Failing scenario.** An exact or approximate birth time with no coordinates is a supported flow: `validateBirthProfileRequest` allows coordinates to be absent, `suppressAngles = housesMeta === null`, and the chart is returned with an out-of-contract uncertainty report. `birth.ts` stores it in `uncertainty_json` and serves it.

**Fix.** Map to `insufficient_accuracy`, or add the reason to the contract with a schema-version bump and freeze note.

---

### H5 — `daily-sky` accepts offsetless and date-only instants

**Severity:** High · **Confidence:** Confirmed

**Files:** `apps/calc-stub/src/daily-sky.ts:136-141,255-257,888-890`; contrast `apps/calc-stub/src/cycles.ts:693-765`.

**Problem.** `requireInstant` is `Date.parse(value)`. `YYYY-MM-DD` parses as UTC midnight; `YYYY-MM-DDTHH:MM:SS` with no offset parses as **host-local** time. The raw string is echoed back into the response.

**Failing scenario.** Two calc hosts in different `TZ` produce different `day_start_at`/`day_end_at` for the same request. The API's echo check compares against its own request values, so a same-host match hides the drift; a different host produces a mismatch classified as `daily_sky_unavailable`.

**Fix.** Require an explicit offset or `Z`, normalize before use, and echo the normalized instant.

---

### H6 — The writer validator can silently drop a planned chapter or signature

**Severity:** High · **Confidence:** Confirmed

**Files:** `packages/pattern-engine/src/candidate-validate.ts:60-125,130-136,137-160`.

**Problem.** The validator checks `output.chapters.length === plan.chapters.length` and that each *output* key exists in the plan. It never checks that every *plan* key appears in the output. A writer that emits `chapter_01` twice and omits `chapter_04` passes both checks. The omitted chapter's aliases are never coverage-checked because the coverage loop iterates only the output chapters. The identical gap exists for `additional_signatures`.

**Failing scenario.** A chapter or signature the planner committed to is silently absent from the published document, and no downstream check notices.

**Fix.** Compare key sets, reject duplicate keys explicitly, and assert `planKeys ⊆ outputKeys`.

---

### H7 — Unknown-accuracy angle/Moon inputs accepted when the suppression list is empty

**Severity:** High/Medium · **Confidence:** Confirmed

**Files:** `apps/calc-stub/src/daily-sky.ts:347-369`; contrast `apps/calc-stub/src/cycles.ts:974-986`.

**Problem.** Angle targets, natal Moon, and house cusps are rejected only when `suppressed_features` contains the matching class. `effective_accuracy` is never consulted. A request with `effective_accuracy: "unknown"` and an empty suppression list is accepted with Ascendant/Midheaven/Moon targets and cusps — the exact combination `cycles.ts` refuses.

**Fix.** Derive the forbidden set from `effective_accuracy` as well, or reject inconsistent `(accuracy, suppressed_features)` pairs.

---

### H8 — The calc service has no body cap, no timeout, and a blocking scan

**Severity:** High availability · **Confidence:** Confirmed for the code; impact unmeasured

**Files:** `apps/calc-stub/src/server.ts:73-80,95-169,213-241`.

**Problem.** `readBody` buffers every chunk with no size limit and no `aborted`/`close` handler; a disconnect leaves the promise pending. The body is parsed synchronously. `/v1/cycles` runs a synchronous Swiss Ephemeris scan on the same single `node:http` event loop, so one large window blocks `/health` and every other request. There is no request deadline anywhere.

**Fix.** Cap at a few hundred KB, destroy on `aborted`, and bound the scan or move it to a worker thread.

---

## 5. Medium-severity findings

### M1 — `ensureTodayReading` resolves “today” twice with two engines

**Files:** `apps/api/src/services/ensure-today-reading.ts:135,383,391,398`.

Line 135 uses `localDateIn` (Intl). Line 383 uses `resolveV5TargetDate` (pinned moment-timezone). It reserves for the second and reconciles against the first. On divergence the reservation is for a day the caller never reads, producing `reading_generation_failed` on every retry until the day rolls over. The codebase's own argument is that the pinned database is authoritative for V5, so the Intl lookup contradicts the design.

**Fix:** derive the lookup date from the pinned resolver on the V5 path.

---

### M2 — `ApiError` throws on a non-conforming error body

**Files:** `apps/web/src/lib/api-client.ts:84-98`.

The constructor dereferences `body.error.request_id`, `body.error.code`, and `body.error.message` unconditionally after casting `await response.json()` to `ErrorBody`. A proxy, captive portal, or Worker returning `{}`, `null`, or `{ "message": ... }` with a non-2xx status throws a `TypeError` inside the error constructor and loses the real status.

**Fix:** guard `body?.error` with a generic fallback message.

---

### M3 — No request timeout; logout can block forever

**Files:** `apps/web/src/lib/api-client.ts:145-157,193-203,1446-1449`; `apps/web/src/lib/auth.ts:87-93`.

`request`, `requestNoContentStatus`, and `requestPortraitBlob` rely solely on caller-supplied signals, and most callers pass none. `endSession()` has no timeout, and `signOut` awaits it before calling Auth0 logout, so a stalled DELETE blocks sign-out indefinitely. A half-open connection leaves `App.tsx:484-491` on “Checking your chart” with no error or retry.

**Partial, via H1 (`dbd3292`).** The Worker sign-out DELETE now uses a 4-second `AbortSignal.timeout` and one retry. A stalled revoke surfaces the still-signed-in error instead of hanging. Auth0 logout after a successful revoke still has no deadline, and the other request helpers still have no default timeout.

**Fix:** a default `AbortSignal.timeout` with explicit overrides, and a short timeout on logout.

---

### M4 — 401 rendered as a content error across several panels

**Files:** `apps/web/src/App.tsx:351-411`; `Onboarding.tsx:344-369`; `PrivacyView.tsx:62-200,212-439,452-612`; `TopicExclusionsPanel.tsx:43-66`; `AccountDataControls.tsx:67-93`; `DeletionStatusView.tsx:45-55`.

Birth create/correct throws 401 into the form. Four privacy panels have no `onUnauthorized`; only the Pattern-consent panel and portrait automation do. Export polling and deletion status also swallow 401.

**Fix:** one `onUnauthorized` contract threaded through every panel.

---

### M5 — `configGuard` validates ten unrelated subsystems on every request

**Files:** `apps/api/src/middleware/config-guard.ts:460-619`; `apps/api/src/index.ts:59-60`.

A typo in `ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS` or `PATTERN_ARTIFACT_RETENTION_DAYS` returns 503 for login and every product route. There is no way to disable one misconfigured feature without taking down the API.

**Fix:** a small core guard (identity, KEK, release attestation, auth mode) applied globally; per-subsystem validation at the boundary that uses it, memoised per isolate.

---

### M6 — `calc-client` accepts an unvalidated `CalcResponse`

**Files:** `apps/api/src/services/calc-client.ts:71-72,113`; `apps/api/src/routes/birth.ts:1034-1127`.

The client never checks `res.ok` and casts the parsed body. `birth.ts` persists `contract_id`, `contract_version`, `calculated_at`, `fingerprint`, and uses `chart.id` as both primary key and AEAD `recordId`. `invokeDailySky` validates its echo field by field; the birth path does not.

**Fix:** check `res.ok`, validate against the generated schema, and reject a contract id/version different from the request's constants.

---

### M7 — Admin sessions are not a control; table grows per request

**Files:** `apps/api/src/middleware/admin-auth.ts:150-158`; `apps/api/src/services/admin-access.ts:111-116`.

Every request re-verifies the Cloudflare Access JWT (the real authority). When the local cookie is absent, expired, or revoked, the middleware **mints a new session** and proceeds. Revocation has no effect while the JWT is valid. A header-only client inserts one row per request indefinitely. The verified identity is assigned `role: "pattern_generation_auditor"` without reading any role claim.

**Fix:** require the local session (no auto-mint) and enforce a group claim, or delete the cookie/table.

---

### M8 — The 500 `request_id` appears in no log

**Files:** `apps/api/src/index.ts:145-161`.

`safeLog({ event: "unhandled_error" })` records no request id, route, or exception class. Every 500 hands the user an id that cannot be correlated server-side.

**Fix:** log `request_id` (opaque, safe) plus `safeExceptionClass(err)`.

---

### M9 — `PatternExperience` defeats its own freshness check

**Files:** `apps/web/src/components/PatternExperience.tsx:706-714`; `apps/web/src/lib/reader-readiness.ts:63-68`.

It passes `now: observation?.observedAt ?? Date.now()`, so the `now - observedAt > 60_000` test is always zero and `stale_observation` is unreachable. A status observed hours ago still yields `can_start`/`retry_generation` actions. `TodayView.tsx:310` passes `Date.now()` correctly. The server re-reads before writing, so this is a UI-truthfulness bug, not a write hazard.

---

### M10 — Stale life-event idempotency key blocks the second save

**Files:** `apps/web/src/components/LifeEventTimeline.tsx:429-437`; `apps/api/src/routes/life-events.ts:100`.

The key is retained on failure (`keys.current[keyId] ??= ...`), and there is no draft-change reset. Edit the draft after a failed save and resubmit: same key, different body, `idempotency_conflict` until the component remounts. `Onboarding.tsx:114-126` clears keys on draft change; this component does not.

---

### M11 — `DailyCheckInCard` reads `sources[0]`

**Files:** `apps/web/src/components/DailyCheckInCard.tsx:146`; `apps/web/src/lib/api-client.ts:432-437`.

`api-client.ts` exports `findContextSource` precisely because indexing “silently reads or writes the wrong grant.” Today USR-06 happens to be first (asserted in `apps/api/src/routes/context-sources-m4.test.ts:61`); adding or reordering a source makes Today report the life-event grant as the check-in grant.

---

### M12 — `ContextSourceControl` concurrent CAS with a stale document

**Files:** `apps/web/src/components/ContextSourceControl.tsx:241-278`.

Only the source being changed is guarded (`busyId`), so USR-09 stays enabled while USR-06 saves. The second click uses the pre-update `state.document` captured in its closure, so its `updated_at` precondition is stale and the server answers 409. On success `keys.current = {}` also discards the other source's in-flight key.

---

### M13 — Feedback load failure presented as “permission off”

**Files:** `apps/web/src/components/ReadingFeedbackCard.tsx:81-93,175-179`.

Every non-401/404 error sets `existing = null` silently. The form then renders the “turning it back on if you had turned it off” copy. A transient failure looks like a revoked permission, and submitting may re-grant it.

---

### M14 — `TodayView` computes `retryable` and never uses it

**Files:** `apps/web/src/components/TodayView.tsx:289-292,405-421`; `apps/web/src/components/TodayView.test.tsx:766-781`.

`retryable` is stored but the error branch always offers “Check again,” while the comment says the control is offered only where the server said it can succeed. The test enshrines the mismatch by asserting the button for non-retryable cases.

---

### M15 — `rotateUserDek` is a second, unbounded rotation used only by tests

**Files:** `apps/api/src/db/users.ts:486-591`.

No production caller (only `*.test.ts`). It loads every encrypted row into memory and emits one `DB.batch` — beyond D1 limits for a real account — and ignores the crypto write fence and operator lease that `apps/api/src/services/crypto-operations.ts` implements. Two implementations of the most dangerous operation in the system.

**Fix:** delete it and port its tests to `crypto-operations`, or make it a thin wrapper over the chunked path.

---

### M16 — No error boundary; unchecked response casts

**Files:** `apps/web/src/main.tsx`; `apps/web/src/lib/api-client.ts:174-175`; `apps/web/src/components/ChartView.tsx:57-58`; `apps/web/src/components/ConnectedTimingReading.tsx:4-6`; `apps/web/src/components/PatternExperience.tsx:355-358`.

`App` is mounted with no boundary, and `request<T>` casts without validation. Consumers dereference immediately: `chart.positions.map`, `reading.paragraphs`, `Intl.DateTimeFormat` with a server-supplied zone (`RangeError`), and `toLocaleDateString(document.locale)`. A proxy or rollback returning valid JSON of the wrong shape white-screens the PWA.

---

### M17 — Export id survives logout in `sessionStorage`

**Files:** `apps/web/src/components/AccountDataControls.tsx:14,54-56,124`.

`patternlike.account-export-id` is never cleared on sign-out. After A signs out and B signs in, B's Privacy page polls A's export id. The API scopes the read to B, so this should be a permanent “failed” panel rather than a leak — but it depends on the server check; add an explicit test.

---

### M18 — Personalized transit-Moon facts dropped, contradicting calc policy

**Files:** `apps/calc-stub/src/cycles.ts:1005-1008`; `apps/calc-stub/src/daily-sky.test.ts:387-399`; `packages/reading-engine/src/constrained-input.ts:564-595`; `packages/reading-engine/src/eligibility.ts:43-56`.

`cycles.ts` states: “The TRANSITING Moon stays valid against stable natal targets, because the transit instant is known even when the birth instant is not,” and the test asserts it. `constrained-input.ts` probes every `attributes.bodies` entry as a `target`; for a personalized fact whose bodies include the transiting Moon, `factSuppressionReason` returns `moon_time_sensitive` and the whole fact is dropped. The rule is duplicated, and the two layers disagree.

**Confidence:** the divergence is confirmed; the trigger depends on the fact's `bodies` including the transiting body — add a fixture test.

**Fix:** probe only the natal target, not the transiting body, for personalized contacts.

---

### M19 — Derived-record authorization depends on ontology order

**Files:** `packages/pattern-engine/src/plan-validate.ts:16-33`.

`authorizedRules` adds a derived record only when every `input_meaning_ids` entry is already in `ids`, while iterating `ontology` once. A derived record whose parent appears later is never authorized, so a valid plan is rejected depending on corpus order.

**Fix:** iterate to a fixed point or sort topologically (the `acyclic` check already builds the graph).

---

### M20 — Ontology predicate validation checks `type` only

**Files:** `packages/pattern-engine/src/ontology.ts:160-198,33-42`.

`feature_predicate.type` is validated, but not the fields for each type. The matcher reads `pred.body_a`/`pred.body_b` for aspects and ignores a bare `body`, so a record shaped `{type:"aspect", aspect:"square", body:"saturn"}` matches every square. Malformed records compile, then over-match or silently become `ontology_unsupported`.

**Fix:** validate predicate fields per type and reject unknown keys.

---

### M21 — Unknown enums in constrained input are not rejected

**Files:** `packages/reading-engine/src/constrained-input.ts:186-188,255-295,303-341,357-379`; `packages/reading-engine/src/ranking.ts:233-248`.

`asBody` returns null for unknown bodies, labels interpolate raw values, and `LANE_RANK`/`FACT_CATEGORY` become undefined (the fact is then rejected as a consent failure, not an invalid fact). Ranking defaults unknown bodies/aspects to 0.25/0.5.

**Fix:** reject unknown body/sign/aspect/fact_class at the boundary.

---

### M22 — One oversized context item exhausts the whole budget

**Files:** `packages/reading-engine/src/constrained-input.ts:1093-1131`.

A single item that does not fit sets global `exhausted = true`, so every later item — even one that would fit — is rejected without being tried. Selection becomes order-dependent rather than budget-fit.

**Fix:** `continue` to the next item instead of setting a global flag.

---

### M23 — Unsupported locale falls back silently

**Files:** `packages/reading-engine/src/assemble.ts:75-88`; `apps/api/src/services/generation-command-v2.ts:548`.

`assemble.ts` falls back to `locale_default`; `prepareConstrainedReadingInput` never calls `isSupportedReadingLocale` (only the API does), so package callers can freeze a locale the validator cannot judge.

**Fix:** validate in the engine, not only in the API.

---

### M24 — `accuracy` not validated in the calc engine

**Files:** `apps/calc-stub/src/engine.ts:323-343,866-868`; `apps/api/src/routes/birth.ts:94-96`.

`accuracy` is only compared to `"unknown"`; any other value is copied into `chart.birth.accuracy` (or downgraded to `unknown` when no time). The API validates the enum, so this is a library/direct-caller gap, but the calc service is the stated authority and accepts a bearer token.

**Fix:** validate the enum in `calculateChart`.

---

### M25 — House-computation catch-all misattributes failures

**Files:** `apps/calc-stub/src/engine.ts:804-810,582-597`.

Any engine failure becomes `houses: null`, and `buildUncertainty` then reports `birthplace_unavailable` even when coordinates were supplied. The function also checks only `.length`, not 12 cusps or 2 angle points, so a short sweph result can yield missing/NaN cusps.

**Fix:** distinguish “no birthplace” from “house computation failed,” and validate the result shape.

---

### M26 — `/v1/calculate` maps server faults to 400

**Files:** `apps/calc-stub/src/server.ts:155-169`.

Every `ok:false` becomes HTTP 400, including `calc_error` from Moshier refusal, missing ephemeris, or an internal exception; the `catch` also maps any throw to 400 `bad_request`. A genuine outage looks like caller error.

**Fix:** 400 only for `invalid_birth_profile`; 5xx for `calc_error`.

---

### M27 — Manifest hash does not cover context content

**Files:** `packages/reading-engine/src/constrained-input.ts:1157-1187,1226-1239`.

`selection.context` records `snapshot_kind` but not the snapshot bytes or a content hash; `input_manifest_canonical` adds only `packet_bytes`. Two context payloads of the same length produce the same manifest hash. Execution re-prepares from the encrypted command, so AEAD still protects the stored content — this is a defense-in-depth/provenance gap, not a live tamper path. **Needs threat-model confirmation.**

**Fix:** include a per-item content digest in the manifest.

---

### M28 — `bodyName in SE_ID_BY_BODY` consults the prototype chain

**Files:** `apps/calc-stub/src/daily-sky.ts:336`.

`Object.fromEntries` produces a normal object, so `"toString"`, `"constructor"`, and `"__proto__"` pass the check. The value is then used as a planet id, which crashes or yields NaN rather than a clean `unsupported_body`.

**Fix:** `Object.hasOwn`.

---

## 6. Low-severity findings

### 6.1 API

- **L1 — Dead V1 branch.** `apps/api/src/services/generation-failures.ts:238-249`: `isAutomaticReplacementFailure` runs before the `execution_error` case, and V1's set (`:126-134`) excludes it, so `return "publisher_unavailable"` is unreachable for V1.
- **L2 — Unchecked array in daily-sky echo.** `apps/api/src/services/daily-sky-client.ts:229`: `[...json.suppressed_features]` throws if a broken calc returns `ok: true` without it.
- **L3 — Runner cleanup masks the real outcome.** `apps/codex-runner/src/isolated-codex-json.ts:78-80`: a throw from `rm` in `finally` replaces a successful return (or a specific error) with `cleanup`, `fatal: true`; `runner.ts:136,192` exits the poll loop.
- **L4 — Admin audit gaps.** `apps/api/src/routes/admin-pattern.ts:359-395` has no `recordAccess`, unlike every sibling; `:158-219` accepts an unvalidated `:generation_id` and writes it into `pattern_admin_access_events`.
- **L5 — Health metadata by position.** `apps/api/src/services/runtime-health.ts:45` uses `rows.pop()` on a `UNION ALL` with no `ORDER BY`.
- **L6 — `serviceAuth` uses `!==`** (`apps/api/src/middleware/auth.ts:179`) while the other two authorities do constant-time compares.
- **L7 — `/v1/meta` discloses `auth_stub` unauthenticated** (`apps/api/src/routes/health.ts:29-38`).
- **L8 — `PUT /v1/readings/:id/save` ignores Idempotency-Key** (`apps/api/src/routes/readings.ts:665-681`).
- **L9 — Feedback error envelope** (`apps/api/src/routes/feedback-events.ts:34-37`) returns the same generic message for several distinct conflicts.
- **L10 — `void`-ed import.** `apps/api/src/routes/pattern-ai.ts:287` keeps a dead import alive with `void`.

### 6.2 Web

- **L11 — Rejected Auth0 exchange cached forever.** `apps/web/src/App.tsx:251` uses `??=` on a promise; a rejection is retained until reload.
- **L12 — `access-unavailable` dead end.** `apps/web/src/App.tsx:175-190,451-478` enters it for any non-401 consent failure and offers no retry.
- **L13 — Preference sync ignores its abort signal** and drops `unavailable` silently (`apps/web/src/lib/device-preference-sync.ts:46-111`; `App.tsx:287-298`).
- **L14 — `Onboarding` can stick on “Calculating…”** — early returns at `:301,:345` skip `setSubmitting(false)`.
- **L15 — Portrait creation does nothing when stale.** `AccountPatternPortrait.tsx:139-140` returns early but `mayGenerate` (`:177-179`) does not include freshness, so the button stays enabled and silent.
- **L16 — Portrait explorer swallows 404/503** (`AccountPortraitExplorer.tsx:85-89`).
- **L17 — `PlaceAutocomplete` swallows resolve errors and never escalates 401** (`:202-204`).
- **L18 — `ContextSourceControl` never clears `restoreFocusId`** (`:261`), so unrelated updates steal focus.
- **L19 — `ReadingConnections` leaves inert history entries** on unmount (`:166-177`).
- **L20 — `TopicExclusionsPanel` shows “Saved.” after edits** (`:132-134`).
- **L21 — Service worker cache write is not in `waitUntil`** (`public/sw.js:44-46`); caching is best-effort.
- **L22 — PWA install assets incomplete** — SVG-only manifest, no `apple-touch-icon`.
- **L23 — Duplicate/dead API surface.** `getPattern()` (`api-client.ts:1372-1386`) has no production caller; `AccountProcessingConsentDocument` is a pure alias; `LegacyAccountPatternPortrait` is test-only.
- **L24 — `JSON.stringify` as render identity** (`AccountPatternPortrait.tsx:212,217`; `AccountPortraitExplorer.tsx:30,79-82,101`).

### 6.3 Calc

- **L25 — Rounding can emit 360.** `engine.ts:826,843-850,938-947` and `daily-sky.ts:486-490,681-698`: `Number(norm360(x).toFixed(6))` yields `360` for `x ≥ 359.9999995`, violating `exclusiveMaximum: 360`; `signOf` uses the unrounded value, so `longitude_deg: 360` can coexist with `sign: "pisces"`.
- **L26 — `house_system` unvalidated** (`daily-sky.ts:362-369`) — any string echoed into a field the schema pins to `placidus|porphyry`.
- **L27 — Error envelope unbounded** (`daily-sky.ts:312,337,862-878`) — raw `request_id` and caller strings exceed the schema's 128/300 caps.
- **L28 — Request `ephemeris_data_version` ignored** (`daily-sky.ts:287,901`) — presence-checked, then stamped with the engine constant.
- **L29 — Cycles range edges unusable.** `cycles.ts:1154-1165` checks the year after including lookaround, so mid-2399 windows are refused because Pluto's lookaround leaves 2399; `cycles.test.ts:800-808` codifies it.
- **L30 — Leap-second comment is wrong.** `cycles.ts:752-754` says `:60` is accepted; `Date.parse("...:60Z")` is `NaN`.
- **L31 — Station direction at zero speed.** `cycles.ts:399-406`: `b.speed > 0 ? "direct" : "retrograde"` labels a zero-speed direct station retrograde.
- **L32 — Duplicate `suppressed_features` accepted** (`daily-sky.ts:306-315`) — `Set` deduplicates for validation but the sorted echo retains duplicates, violating `uniqueItems: true`.
- **L33 — Accuracy bypass at the engine boundary** (see M24).

### 6.4 Pattern engine

- **L34 — Missing minimums.** `candidate-validate.ts:66-68,87-89,115-119` checks only maximum lengths; empty titles, empty section text, and section/tension/resource `claim_class` values are unchecked though the schema requires `minLength`/closed enums.
- **L35 — `featureSetHash` not validated** (`selection.ts:359-369`) — only the `sha256:` prefix is normalized.
- **L36 — Selection ignores record locale** (`selection.ts:81-86,210-229`) — a mixed-locale ontology can match a foreign-language record.
- **L37 — Omission `covered_by` not checked for content** (`plan-validate.ts:171-189`) — only that the key exists, not that the chapter mentions the alias.
- **L38 — Self-certifying checks.** `assemble.ts:640-683` records `schema`, `eligibility_allowlist`, `uncertainty_constraints`, `consent_freshness` as pass without checking them.

### 6.5 Reading engine

- **L39 — Canonicalization aborts the whole reading.** `constrained-input.ts:127-139,914-916` plus `jcs.ts:52-55,79-89`: `1e-7`/`1e21` or a lone surrogate in context text throws `CanonicalizationError` instead of rejecting that record.
- **L40 — Malformed prior date/timestamp aborts the whole reading.** `constrained-input.ts:919-926,966,1049-1052`; an invalid day window throws `IdentityConsistencyError` outside the `ConstrainedInputError` contract.
- **L41 — Feedback redaction is narrow.** `constrained-input.ts:890-904` redacts only when the selection version is categorized, `source_id === "USR-12"`, category is `reading_feedback`, and the snapshot schema is exactly `reading-feedback-signal/v1`; otherwise the full structured snapshot goes to the provider. Needs verification against the consent contract.

---

## 7. Unnecessary complexity

### C1 — `routes/birth.ts`: 1,688 lines, one handler, a hand-rolled concurrency protocol

**Files:** `apps/api/src/routes/birth.ts`.

A per-user daily budget, a claim-token table, ~30 SQL statements with 10–18 repeated `EXISTS` predicates, positional `publication[2]` indexing (`:1268`), and `assertion_probe` inserts used as control flow (`:1295-1453`, `:1463-1608`).

A boring alternative exists: the `UNIQUE(user_id, idempotency_key)` on `jobs` already provides idempotency; one `INSERT … ON CONFLICT DO NOTHING` per logical row plus a `SELECT` of today's usage gives the same guarantees in roughly 150 lines. The current form is correct only while every hand-written predicate stays in sync, and it is unreviewable at a glance.

### C2 — `middleware/config-guard.ts`: 649 lines, ten subsystems, global scope

**Files:** `apps/api/src/middleware/config-guard.ts`.

Five copies of the same “pinned value equals compiled constant” loop, each with its own integer parser, trim, and error string. One `pinnedEnv(env, { KEY: expected })` helper removes ~200 lines. The scope is the larger problem: see M5.

### C3 — `assertion_probe` as an exception-based assertion primitive

**Files:** `db/d1/0002_m3_daily_reading_pipeline.sql:30-53`; `apps/api/src/services/pattern-execute.ts:367-378`; `apps/api/src/routes/birth.ts:763-774`.

It converts a business-rule violation into a CHECK-constraint abort, then relies on `catch` + re-read to distinguish “expected abort” from “real fault.” `INSERT … WHERE EXISTS` + `changes === 0` provides conditional writes without exceptions or a second query. It earns its keep only in migration pre-flights.

### C4 — Two JWKS verifiers

**Files:** `apps/api/src/services/identity.ts`; `apps/api/src/services/admin-access.ts`.

Near-identical module cache, stale-on-refresh-failure behaviour, error reason union, and `Jwt.verifyWithJwks` call. One parameterised verifier would do.

### C5 — Duplicated primitives

- Two DEK rotations (M15).
- Two byte-identical `credentialsMatch` implementations (`crypto-operator-auth.ts`, `codex-runner-auth.ts`).
- Five spellings of “exact object keys” (`internal-crypto.ts`, `pattern-portrait.ts`, `privacy.ts`, `places.ts`, `reading-history-cursor.ts`).
- Two suppression rules (`eligibility.ts` vs `constrained-input.ts`) — already disagreeing (M18).

### C6 — `routes/pattern-portrait.ts`: dense one-liners

**Files:** `apps/api/src/routes/pattern-portrait.ts:22,52`.

Line 22 is a `for(;;)` with four statements; line 52 is a ~1,000-character boolean validating a dozen fields. A missing `&&` would be invisible in review.

### C7 — Three copies of the web error mapping

**Files:** `apps/web/src/lib/api-client.ts:145-186,193-220,1450-1453`.

The copies have already diverged: `request` flattens `AbortError` into a generic message; `requestPortraitBlob` lets the raw `DOMException` escape.

### C8 — Three independent pollers during a Pattern generation

**Files:** `apps/web/src/components/PatternExperience.tsx:642-659`; `AccountPatternPortrait.tsx:83-93`; `AccountPortraitExplorer.tsx:92-98`; `AccountDataControls.tsx:72-81`.

Three pollers run concurrently during generation, plus an unbounded 1.5s export poll with no visibility pause or attempt cap.

### C9 — `JSON.stringify` as render-time identity

**Files:** `apps/web/src/components/AccountPatternPortrait.tsx:212,217`; `AccountPortraitExplorer.tsx:30,79-82,101`.

Whole documents are serialized on every render (including inside a 3-second poll) where `pattern_id + generated_at + revision` already exist.

### C10 — Three duplicated consent state machines

**Files:** `apps/web/src/components/PrivacyView.tsx:242-315`; `AccountAccessRecovery.tsx:41-103`; `Onboarding.tsx:128-155`.

Each implements fetch/grant/error/policy-refresh with its own reload counter and different 401 behaviour.

### C11 — Two bisection scanners in calc

**Files:** `apps/calc-stub/src/cycles.ts:550-573`; `apps/calc-stub/src/daily-sky.ts:516-583`.

Independent root scanners with different tolerances.

### C12 — Dead code kept alive

`rotateUserDek` (M15); `getPattern()` (`api-client.ts:1372-1386`); `LegacyAccountPatternPortrait` (test-only); `void PATTERN_GENERATION_CONSENT_POLICY_VERSION` (`pattern-ai.ts:287`); `void predicateBodies` (`ontology.ts:273`).

### C13 — Scheduler builds a ~600-zone JSON map six times per cron invocation

**Files:** `apps/api/src/db/reading-scheduler.ts:215,260,301`; `apps/api/src/services/tzdb.ts:182-191`.

A small `(zone, date)` temp table, or resolving the date in JS for the candidate set, would be simpler and cheaper.

---

## 8. Areas that look solid

- **`apps/api/src/crypto.ts` + encrypted-column registry.** AEAD AAD bound to subject/table.column/record id/key version, per-user DEK, versioned KEK derivation, hard failure on the committed dev key. The `ENCRYPTED_COLUMNS`/`UNWRITTEN_ENCRYPTED_COLUMNS` registry with a schema tripwire test is genuinely good engineering.
- **`apps/ontology-signer`.** Closed request/payload schemas, canonicality check, forbidden-field scan, bounded payload, keyring validation, no private key in the API Worker.
- **`apps/codex-runner/src/isolated-codex-json.ts`** (apart from the cleanup bug). Verifies the CLI's effective config, sandbox mode, disabled tools, model, effort, and thread identity rather than trusting flags. Complexity earned.
- **`apps/api/src/services/openai-responses-adapter.ts`.** Bounded body reads, abort deadline held through consumption, refusal precedence, closed failure vocabulary, no provider prose in logs.
- **The queue/outbox model.** `dispatch` advisory, `claimJob` CAS, expired-lease and undispatched sweeps converge, duplicates normal.
- **`local-day.ts`/`tzdb.ts`.** DST gap/fold policy explicit and versioned; the pinned-tzdb rationale is correct even though M1 shows one place it is not used.
- **`deletion-manifest.ts`.** Portable/non-portable/deleted classification with a test that every table is classified.
- **Calc date handling.** The calendar probe before zone handling (`engine.ts:296-311`) prevents `2023-02-30` from poisoning sweph's cache.
- **Calc fingerprinting.** Content-addressed fingerprint with a canonical payload, and the explicit “never store synthetic noon as birth UTC authority” rule.
- **JCS.** Two implementations deliberately duplicated for licensing, pinned to one golden-vector set, with lone-surrogate rejection.
- **Admin artifact access ordering.** `admin-pattern.ts` writes the access decision before opening keys or R2 bytes.
- **No SQL injection found.** All dynamic SQL uses constant identifiers and bound parameters.
- **No IDOR found** in the routes traced: every reading, export, save, and pattern query is owner-scoped.
- **No birth data, readings, or tokens in `localStorage`/IndexedDB.** Portrait blobs are in-memory and their object URLs are revoked.

---

## 9. Recommended next steps

1. **H1 and H2** — addressed in `dbd3292`. Web suite: 964 tests. A headless Privacy pass confirmed a failed exclusion read hides Save, a retry does not open the form, and a failed revoke sends two DELETEs and stays signed in.
2. **H3** — addressed in the working tree after `dbd3292`. Session activity does not write the cursor, recompute is monotonic, and `reserveInitial` returns `duplicate` for any existing user-day row. Scheduler, session, consent, generation, and preference lanes were run. **H4** remains open: map the uncertainty reason to the frozen enum, or amend that enum with a schema-version bump and freeze note.
3. **Fix H6** — set-equality checks in the writer validator; a test that a duplicated chapter key fails.
4. **Fix H5/H7/H8** — explicit-offset parsing, accuracy-derived suppression, body cap + timeout + non-blocking scan.
5. **Scope `configGuard`** — core vs per-subsystem, with a test that a malformed optional knob cannot 503 `POST /v1/sessions`.
6. **Add request-id logging** — one line in `onError`.
7. **Add a client-wide timeout and one `readResponse` helper** — fixes M2, M3, and the `AbortError` divergence.
8. **Thread `onUnauthorized` through every panel** — M4 is one missing contract repeated.
9. **Delete the duplicates** — one JWKS verifier, one `credentialsMatch`, one DEK rotation, one suppression rule.
10. **Reduce `birth.ts` incrementally** — extract the reservation protocol, pin outcomes with tests, then replace `assertion_probe` control flow with `changes === 0`.
11. **Validate the calc response** — the generated validators already exist.
12. **Fix the small ones opportunistically:** the V1 `execution_error` branch, runner cleanup masking, unvalidated admin id, `TodayView`'s unused `retryable`, the stale life-event key, `sources[0]`, and the `void refreshChart()` rejection.

---

## Appendix A — Verification log

| Claim | Verification |
| --- | --- |
| H1 logout cookie | Re-read `App.tsx`, `auth.ts`, `auth.ts` middleware, `sessions.ts`. Addressed in `dbd3292`: revoke-before-Auth0, 4s timeout, one retry |
| H2 exclusions wipe | Re-read `TopicExclusionsPanel.tsx`, `preferences.ts`. Addressed in `dbd3292`: failed load renders Try again and hides Save |
| H3 cursor rewind | Re-read `sessions.ts`, `reading-scheduler.ts`, `reading-schedule.ts`, `generation.ts`, migration indexes. Addressed after `dbd3292`: no session recompute, monotonic `next_due_at`, `reserveInitial` refuses any user-day row. A second revision 1 was already rejected by `UNIQUE (user_id, local_date, revision)` and `uq_jobs_scope_key`; the rewind was the live defect |
| H4 contract reason | Re-read `engine.ts`, parsed `contracts/m0/chart-contract.schema.json`, compared M5 type |
| H5 offsetless instants | Re-read `daily-sky.ts`, `cycles.ts` |
| H6 dropped chapter | Re-read `candidate-validate.ts` |
| H7 accuracy bypass | Re-read `daily-sky.ts`, `cycles.ts` |
| H8 calc DoS | Re-read `server.ts` `readBody` and handlers; impact not measured |
| M2 `ApiError` | Re-read constructor |
| M9 freshness | Re-read `PatternExperience.tsx`, `reader-readiness.ts` |
| M10 life-event key | Re-read `LifeEventTimeline.tsx`, route |
| M11 `sources[0]` | Re-read `DailyCheckInCard.tsx`, `api-client.ts` |
| M14 `retryable` | Re-read `TodayView.tsx` |
| M16 no boundary | Re-read `main.tsx` |
| M18 transit Moon | Re-read `constrained-input.ts`, `eligibility.ts`, `cycles.ts`, test |
| M20 predicate | Re-read `ontology.ts` matcher and validator |
| M28 `in` | Confirmed with Node |

## Appendix B — Coverage gaps

- No test suite, typecheck, or `ci:local` run.
- Calc service internals (sweph wrapper, ephemeris path handling) sampled, not exhaustively audited.
- Reading-engine and pattern-engine rule tables sampled.
- Cloudflare Access policy, Fly host configuration, and moment-timezone data vintage not inspected.
- The web and calc/engine findings outside the High/Medium set were line-referenced from parallel static passes and not all independently re-read.
