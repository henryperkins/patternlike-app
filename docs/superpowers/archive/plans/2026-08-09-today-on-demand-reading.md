# Today On-Demand Reading Implementation Plan

> **ARCHIVED 2026-08-22 — complete.** Shipped as `PUT /v1/readings/today`
> (`apps/api/src/routes/readings.ts`) and
> `apps/api/src/services/ensure-today-reading.ts`. The Windows implementation
> workspace named below no longer exists. Do not execute. Index: [`../README.md`](../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an authenticated, fully configured reader's Today-page load idempotently create or recover the current local day's reading and render it automatically when publication completes.

**Architecture:** Add an authenticated `PUT /v1/readings/today` desired-state operation while preserving the existing read-only GET. A focused ensure service reads only the caller's current-day initial reservation and active job, delegates new commands and bounded failed-command replacement to the existing enqueue service, and redispatches only that reservation's due job. The React Today surface repeatedly calls PUT with abortable capped backoff until it receives the existing published-reading response.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1, Cloudflare Queues, React 19, Vitest, Testing Library, JSON Schema 2020-12, OpenAPI 3.1, Python 3.11 jsonschema validation.

**Approved design:** `docs/superpowers/archive/specs/2026-08-09-today-on-demand-reading-design.md`

**Implementation workspace:** `C:\Users\htper\patternlike-app-today-on-demand` on branch `m3-today-on-demand`, based on `91da5bfcd2eb71032e2b9aaa38e27f02afda7bf4`.

## Global Constraints

- Run all commands from the isolated implementation workspace, never from `C:\Users\htper\patternlike-app`.
- Preserve the main checkout's untracked `.playwright-cli/`, `apps/web/.impeccable/`, `apps/web/DESIGN.md`, and `apps/web/PRODUCT.md` files.
- Keep every file under `contracts/m0/` byte-for-byte unchanged.
- Keep `GET /v1/readings/today` read-only. Browser prefetch or cache behavior must never enqueue work.
- `PUT /v1/readings/today` derives user identity from authentication and local date from the confirmed server-side scheduling zone. It has no request body and accepts no user, date, release, or command input.
- Keep queue messages opaque: `{ job_id, reading_id }` only. Do not put chart, release, context, command, or reading data in a Queue message.
- Keep queue execution as the only path that decrypts a frozen command and publishes a reading.
- Do not call the global `findUndispatched` or `findExpiredLeases` sweepers from a product request. Recovery must remain scoped to the authenticated user and resolved local date.
- Automatic command replacement remains limited to `calc_unavailable` and `release_unreadable`, the existing `MAX_COMMAND_GENERATION` budget, and the current-day guard in `replaceFailedCommand`.
- Do not add built-in reading prose or weaken the signed active-release requirement. The universal fallback remains reviewed release content.
- Do not add a cron trigger, `scheduled` export, notification path, generation revision, or new database migration in this slice.
- Do not deploy, change production bindings or secrets, ingest or activate content, push, open a PR, or merge without separate user authorization.
- Use `apply_patch` for hand edits, stage an explicit allowlist for each commit, and inspect staged diff before committing.
- Before writing Workers code, retrieve the current official Cloudflare guidance required by the loaded `cloudflare:workers-best-practices` skill and check generated runtime types/config rather than relying on remembered APIs.
- Immediately before editing the Today UI, read `C:\Users\htper\.agents\skills\impeccable\reference\craft-floor.md`. After the UI edits, run the Impeccable detector exactly once over the changed web targets.

## Response Matrix

| Condition | PUT result | Reader behavior |
| --- | --- | --- |
| Published reading exists | `200 DailyReadingResponse` | Render immediately |
| New or recoverable work is pending | `202 DailyReadingPreparation` | Show preparation state and poll |
| No authenticated identity/preferences row | `401 unauthorized` | Enter signed-out flow |
| No active chart | `404 chart_not_found` | Continue onboarding |
| Time zone unconfirmed | `409 timezone_confirmation_required` | Confirm time zone first |
| Locale unconfirmed | `409 locale_confirmation_required` | Confirm locale second |
| No active release | `503 release_not_active` | Stop polling; show retryable infrastructure error |
| Calculation service unavailable | `503 calc_unavailable` | Stop polling; show retryable infrastructure error |
| Active release cannot be read | `503 release_unreadable` | Stop polling; show retryable infrastructure error |
| Terminal result, exhausted replacement budget, or corrupt state | `424 reading_generation_failed` | Stop polling; show generic failure and request ID |
| Stored time zone can no longer resolve | `500 internal_error` | Stop polling; show generic failure and request ID |

---

### Task 1: Define the additive M3 preparation response

**Files:**

- Modify: `contracts/m3/fixtures/generate_fixtures.py`
- Create: `contracts/m3/fixtures/valid/daily-reading-preparation.preparing.json`
- Modify: `contracts/validate_schemas.py`
- Modify: `contracts/m3/daily-reading.schema.json`
- Modify: `contracts/m3/openapi/openapi.yaml`
- Modify: `contracts/m3/SCHEMA_MANIFEST.json`

**Interfaces:**

- Add `dailyReadingPreparation` at `https://patternlike.app/contracts/m3/daily-reading.schema.json#/$defs/dailyReadingPreparation`.
- Wire shape is exactly `{ schema_version: "0.3.0", status: "preparing", local_date: "YYYY-MM-DD" }` with `additionalProperties: false`.
- Add a body-less `PUT /v1/readings/today` operation with `200`, `202`, `401`, `404`, `409`, `424`, and `503` responses.
- Record this as an additive schema/OpenAPI amendment; do not change M3's `$id` or `schema_version` and do not touch M0.

- [ ] **Step 1: Add the preparation fixture source and its specific validator mapping before adding the schema definition.**

Add to the fixture generator:

```python
PREPARATION_DOC = {
    "schema_version": SV,
    "status": "preparing",
    "local_date": DATE,
}
write(V + "daily-reading-preparation.preparing.json", PREPARATION_DOC)
```

Add this longer-prefix mapping before the existing `daily-reading` mapping:

```python
"daily-reading-preparation": "https://patternlike.app/contracts/m3/daily-reading.schema.json#/$defs/dailyReadingPreparation",
```

- [ ] **Step 2: Generate fixtures and prove the contract is RED because the definition does not exist yet.**

Run:

```powershell
python contracts/m3/fixtures/generate_fixtures.py
python contracts/validate_schemas.py
```

Expected: generation creates `daily-reading-preparation.preparing.json`; validation fails resolving `dailyReadingPreparation`.

- [ ] **Step 3: Add the closed JSON Schema definition and include it in the root union.**

Add under `$defs`:

```json
"dailyReadingPreparation": {
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "status", "local_date"],
  "properties": {
    "schema_version": { "$ref": "common.schema.json#/$defs/schemaVersion" },
    "status": { "type": "string", "const": "preparing" },
    "local_date": {
      "$ref": "https://patternlike.app/contracts/m0/common.schema.json#/$defs/isoDate"
    }
  }
}
```

Add `{ "title": "DailyReadingPreparation", "$ref": "#/$defs/dailyReadingPreparation" }` to the document's root `oneOf`.

- [ ] **Step 4: Document the operation and component in M3 OpenAPI.**

Under `/v1/readings/today`, retain GET unchanged and add a PUT operation with no `requestBody`. Point its `200` response at `DailyReadingResponse`, its `202` response at a new `DailyReadingPreparation` component, and every error response at `ErrorResponse`. State explicitly that the server derives identity/date, repeated PUTs converge on one user-day reservation, and GET stays read-only.

Because PUT has two success schemas, attach both resolvable contract pointers:

```yaml
x-normative-reading-schema: 'm3:daily-reading.schema.json#/$defs/dailyReadingResponse'
x-normative-preparation-schema: 'm3:daily-reading.schema.json#/$defs/dailyReadingPreparation'
```

The component must be:

```yaml
DailyReadingPreparation:
  type: object
  additionalProperties: false
  required: [schema_version, status, local_date]
  properties:
    schema_version: { type: string, const: '0.3.0' }
    status: { type: string, const: preparing }
    local_date: { type: string, format: date }
```

- [ ] **Step 5: Record the additive amendment in the M3 manifest.**

Add `dailyReadingPreparation` to the `daily-reading.schema.json` `defines` list. Append one `amendments` entry dated `2026-08-09`, with `kind: "additive_schema"`, naming the schema, fixture, and OpenAPI files and explaining that no existing required field, enum, `$id`, or M0 file changed.

- [ ] **Step 6: Run contract validation and prove GREEN.**

Run:

```powershell
python contracts/validate_schemas.py
git diff --exit-code 91da5bfcd2eb71032e2b9aaa38e27f02afda7bf4 -- contracts/m0
```

Expected: every M0/M3 schema, fixture, policy, normative pointer, and OpenAPI document passes; the M0 diff is empty.

- [ ] **Step 7: Review and commit the contract amendment.**

Stage only the six files listed for this task. Run `git diff --cached --check` and inspect `git diff --cached`. Commit:

```powershell
git commit -m "contracts: define Today preparation response"
```

---

### Task 2: Add an owner-scoped current-day generation-state read

**Files:**

- Modify: `apps/api/src/db/generation.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`

**Interfaces:**

```ts
export type GenerationJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface InitialGenerationState {
  readingId: string;
  readingStatus: "pending" | "failed";
  commandGeneration: number;
  activeJob: {
    id: string;
    status: GenerationJobStatus;
    resultClass: string | null;
    availableAt: string | null;
    dispatchedAt: string | null;
    leaseExpiresAt: string | null;
  } | null;
}

export async function loadInitialGenerationState(
  env: Env,
  userId: string,
  localDate: string,
): Promise<InitialGenerationState | null>;
```

- [ ] **Step 1: Write failing D1 integration tests for absence, projection, and ownership.**

Add tests that prove:

1. no initial reservation for `(USER_A, localDate)` returns `null`;
2. a pending initial reservation projects its active queued job and every recovery timestamp;
3. a failed reservation projects its terminal `result_class` and `command_generation`; and
4. querying `USER_A` cannot return a reservation owned by `USER_B` on the same date.

- [ ] **Step 2: Run the focused API suite and verify RED on the missing export.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts
```

Expected: TypeScript/test collection fails because `loadInitialGenerationState` is not implemented.

- [ ] **Step 3: Implement one owner/date-scoped LEFT JOIN.**

Use this predicate and no global sweep query:

```sql
SELECT r.id AS reading_id, r.status AS reading_status, r.command_generation,
       j.id AS job_id, j.status AS job_status, j.result_class,
       j.available_at, j.dispatched_at, j.lease_expires_at
FROM daily_readings r
LEFT JOIN jobs j
  ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
WHERE r.user_id = ? AND r.local_date = ?
  AND r.revision = 1 AND r.revision_reason = 'initial'
  AND r.status IN ('pending', 'failed')
LIMIT 1
```

Project snake_case database fields to the camelCase interface explicitly. Preserve `activeJob: null` so the ensure service can fail closed on an impossible reservation instead of hiding corruption as absence.

- [ ] **Step 4: Re-run the focused API suite and typecheck.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts
npm run typecheck -w @patternlike/api
```

- [ ] **Step 5: Review and commit the scoped query.**

Stage only the two task files, inspect the cached diff, then commit:

```powershell
git commit -m "api: read scoped Today generation state"
```

---

### Task 3: Implement the ensure service's ready, create, and idempotent paths

**Files:**

- Create: `apps/api/src/services/ensure-today-reading.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`

**Interfaces:**

```ts
export type EnsureTodayFailureReason =
  | CommandBuildFailure
  | "unauthorized"
  | "reading_generation_failed"
  | "internal_error";

export type EnsureTodayOutcome =
  | { ok: true; status: "ready"; published: PublishedReading }
  | { ok: true; status: "preparing"; localDate: string }
  | { ok: false; reason: EnsureTodayFailureReason; detail: string };

export interface EnsureTodayOptions {
  now?: Date;
  dispatchJob?: typeof dispatch;
}

export async function ensureTodayReading(
  env: Env,
  identity: UserIdentity,
  options?: EnsureTodayOptions,
): Promise<EnsureTodayOutcome>;
```

`dispatchJob` is a test seam for proving a targeted redispatch; production uses the existing awaited `dispatch` function. It must not be stored globally.

- [ ] **Step 1: Write failing integration tests for the healthy convergence paths.**

Use a fixed `Date` passed through `EnsureTodayOptions` and prove:

- a published reading returns `{ ok: true, status: "ready" }` without creating another row or job;
- an eligible day with no reservation returns `preparing` and creates exactly one pending reading and one encrypted queued job;
- two concurrent `ensureTodayReading` calls converge on one reservation/job and both return `ready` or `preparing`, never a conflict; and
- a pending, already-dispatched queued job returns `preparing` without calling an injected `dispatchJob` spy.

- [ ] **Step 2: Run the named tests and verify RED because the service does not exist.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts -t "ensure today"
```

- [ ] **Step 3: Implement the ordered readiness gates.**

The function must:

1. load preferences and return `unauthorized` if absent;
2. return time-zone confirmation first, then locale confirmation;
3. resolve `localDateIn(preferences.timezone, now)` and normalize an `Intl` failure to `internal_error` without returning the stored zone;
4. load and return a published reading before probing the current chart;
5. return `chart_not_found` when the published-read miss has no active chart; and
6. call `loadInitialGenerationState` for only `identity.userId` and the resolved date.

- [ ] **Step 4: Implement absence and reservation-race convergence.**

When state is absent, call `enqueueDailyReading(env, identity.userId, now)`. For success or `duplicate`, immediately re-read the published artifact and scoped generation state:

- return `ready` if publication won the race;
- return `preparing` if a pending reservation now exists;
- return `reading_generation_failed` if the duplicate cannot be reconciled to either state; and
- return the original command-build failure for non-duplicate enqueue failures.

Do not loop on a D1 conflict and do not create a fresh revision.

- [ ] **Step 5: Re-run the ensure tests and API typecheck.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts -t "ensure today"
npm run typecheck -w @patternlike/api
```

- [ ] **Step 6: Review and commit the ensure core.**

Stage only the new service and its integration test. Inspect the staged diff and commit:

```powershell
git commit -m "api: ensure Today reading on demand"
```

---

### Task 4: Add targeted recovery and bounded failure handling

**Files:**

- Modify: `apps/api/src/services/ensure-today-reading.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`

**Interfaces:** Preserve Task 3's public outcome types. No recovery-only state is returned to the HTTP client.

- [ ] **Step 1: Add failing tests for every recoverable and terminal stored state.**

Prove all of the following with real D1 rows and an injected `vi.fn(dispatch)` wrapper where a send must be observed:

- queued + `dispatched_at IS NULL` + due -> dispatches exactly `{ job_id, reading_id }` for that reservation;
- queued + future `available_at` -> returns `preparing` without dispatching early;
- running + live lease -> returns `preparing` without dispatch;
- running + expired lease -> redispatches exactly that job;
- failed job with `calc_unavailable` -> calls existing scheduler replacement, increments `command_generation`, and returns `preparing`;
- failed job with `release_unreadable` follows the same bounded replacement path;
- `command_generation = MAX_COMMAND_GENERATION` plus a retryable terminal result -> `reading_generation_failed` and no new job;
- a non-replaceable terminal `result_class` -> `reading_generation_failed` and no new job;
- missing active job, mismatched job state, or a terminal job attached to a pending reservation -> `reading_generation_failed`; and
- a different user's due job is never inspected or dispatched.

- [ ] **Step 2: Run the recovery tests and verify RED.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts -t "ensure today recovery"
```

- [ ] **Step 3: Implement the pending-state decision table.**

Use ISO timestamps derived from the injected `now`:

```ts
const due = job.availableAt === null || job.availableAt <= now.toISOString();
const leaseExpired =
  job.leaseExpiresAt !== null && job.leaseExpiresAt < now.toISOString();
```

- queued, already dispatched -> `preparing`;
- queued, undispatched, not due -> `preparing`;
- queued, undispatched, due -> await `dispatchJob(env, message)`, then `preparing`;
- running with a non-expired lease -> `preparing`;
- running with an expired lease -> await `dispatchJob(env, message)`, then `preparing`;
- every other pending/job combination -> `reading_generation_failed`.

The Queue send result does not claim publication. A false send result leaves the outbox marker unset so the next PUT can retry the same job.

- [ ] **Step 4: Implement failed-state replacement without widening policy.**

Only when the active terminal job's `resultClass` is exactly `calc_unavailable` or `release_unreadable`, call:

```ts
replaceFailedCommand(
  env,
  identity.userId,
  state.readingId,
  state.activeJob.resultClass,
  "scheduler",
  now,
)
```

On success, re-read publication once and otherwise return `preparing`. Preserve actionable command-build failures from the replacement. Normalize `budget_exhausted`, `not_replaceable`, `stale_job`, `day_too_old`, `conflict`, and non-replaceable result classes to `reading_generation_failed`, retaining detail for server logs only.

- [ ] **Step 5: Re-run the complete generation integration suite and API typecheck.**

Run:

```powershell
npm test -w @patternlike/api -- src/services/generation.integration.test.ts
npm run typecheck -w @patternlike/api
```

- [ ] **Step 6: Review and commit recovery behavior.**

Stage the two task files, inspect the cached diff, then commit:

```powershell
git commit -m "api: recover stranded Today generation"
```

---

### Task 5: Expose the authenticated PUT route without changing GET semantics

**Files:**

- Modify: `apps/api/src/routes/readings.integration.test.ts`
- Modify: `apps/api/src/routes/readings.ts`

**Interfaces:**

- Add `PUT /v1/readings/today`, no request body.
- Preserve `GET /v1/readings/today` byte-for-byte behavior at its response boundary, including `reading_not_generated` on a read-only miss.
- Both operations use the same explicit published-reading projection.

- [ ] **Step 1: Add a PUT test helper and failing route integration tests.**

Add a helper that calls `SELF.fetch` with method `PUT` and only the auth header. Test:

- existing publication -> `200` and valid `dailyReadingResponse`;
- no reservation -> exact `202` preparation object that validates against `dailyReadingPreparation`;
- repeated and concurrent PUTs -> one initial reading and one job;
- no active release -> `503 release_not_active` with zero reading/job rows;
- missing chart -> `404 chart_not_found`;
- unconfirmed preferences preserve time-zone-first `409` ordering;
- unauthenticated PUT -> `401 unauthorized`;
- terminal stored failure -> `424 reading_generation_failed`, a request ID, and no raw `result_class`, job id, reading key, user id, chart data, or release detail in the body; and
- GET on an unpublished day still returns `404 reading_not_generated` and creates zero rows/jobs.

Register an Ajv validator for `#/$defs/dailyReadingPreparation` beside `validateTodayResponse`.

- [ ] **Step 2: Run the reading-route suite and verify the new PUT tests are RED.**

Run:

```powershell
npm test -w @patternlike/api -- src/routes/readings.integration.test.ts
```

Expected: PUT is not implemented and currently falls through to the stub/not-found behavior.

- [ ] **Step 3: Extract one explicit published-response projector.**

Refactor the current GET success object into a local helper that accepts `PublishedReading` and returns only:

```ts
{
  schema_version: M3_SCHEMA_VERSION,
  reading: projectReading(published.stored.reading),
  evidence_url: evidenceUrl(published.record),
}
```

Use it from GET and PUT so the two successful response paths cannot drift.

- [ ] **Step 4: Register PUT and map service outcomes to the approved response matrix.**

Call `ensureTodayReading(c.env, identity)`. Return `200` for `ready` and the exact three-field `202` object for `preparing`.

For failures:

- return original public codes only for `unauthorized`, `chart_not_found`, the two confirmation codes, `release_not_active`, `calc_unavailable`, and `release_unreadable`;
- map all other generation failures to public code `reading_generation_failed` and status `424`;
- map `internal_error` to `500`;
- log `{ request_id, reason, detail }` as `ensure_today_failed`; and
- never put `detail` in the response.

- [ ] **Step 5: Run route, generation, contract, and type checks.**

Run:

```powershell
npm test -w @patternlike/api -- src/routes/readings.integration.test.ts
npm test -w @patternlike/api -- src/services/generation.integration.test.ts
python contracts/validate_schemas.py
npm run typecheck -w @patternlike/api
```

- [ ] **Step 6: Review and commit the product API.**

Stage only the two route files. Inspect the cached diff and commit:

```powershell
git commit -m "api: expose idempotent Today ensure route"
```

---

### Task 6: Add the web client desired-state method

**Files:**

- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/api-client.test.ts`

**Interfaces:**

```ts
export interface DailyReadingPreparation {
  schema_version: string;
  status: "preparing";
  local_date: string;
}

export type EnsureTodayReadingResponse =
  | DailyReadingResponse
  | DailyReadingPreparation;

export function ensureTodayReading(
  signal?: AbortSignal,
): Promise<EnsureTodayReadingResponse>;
```

- [ ] **Step 1: Write failing client tests for both success variants and the HTTP method.**

Stub one `202 DailyReadingPreparation` and one `200 DailyReadingResponse`. Prove both bodies are returned unchanged, then assert the preparation request boundary:

```ts
const response = await ensureTodayReading();
expect(response).toEqual(preparationResponse);
const [request] = capturedFor(TODAY);
expect(request.method).toBe("PUT");
expect(request.body).toBeNull();
```

- [ ] **Step 2: Run the client test and verify RED because the method and response union do not exist.**

Run:

```powershell
npm test -w @patternlike/web -- src/lib/api-client.test.ts
```

- [ ] **Step 3: Add the response union and PUT client method.**

Implement:

```ts
export function ensureTodayReading(
  signal?: AbortSignal,
): Promise<EnsureTodayReadingResponse> {
  return request<EnsureTodayReadingResponse>("/v1/readings/today", {
    method: "PUT",
    headers: requestHeaders(),
    signal,
  });
}
```

Retain `getTodayReading` as the read-only client method. Update its stale `ApiError.details` comment so it does not describe the removed Today-page wait state as the sole reason details exist.

- [ ] **Step 4: Re-run the focused test and web typecheck.**

Run:

```powershell
npm test -w @patternlike/web -- src/lib/api-client.test.ts
npm run typecheck -w @patternlike/web
```

- [ ] **Step 5: Review and commit the client boundary.**

Stage only `apps/web/src/lib/api-client.ts` and `apps/web/src/lib/api-client.test.ts`. Inspect the cached diff and commit:

```powershell
git commit -m "web: add Today ensure client"
```

---

### Task 7: Replace manual checking with an abortable capped polling loop

**Files:**

- Modify: `apps/web/src/components/TodayView.tsx`
- Modify: `apps/web/src/components/TodayView.test.tsx`
- Modify: `apps/web/src/lib/reading-state.ts`
- Modify: `apps/web/src/test/api-mock.ts`
- Verify: `apps/web/src/App.test.tsx`

**Interfaces and timing:**

- Poll delays: `500 ms`, `1,000 ms`, `2,000 ms`, then `5,000 ms` for every later attempt.
- Long-running status threshold: `15,000 ms` from the first `202` in the current mounted loop.
- One `AbortController` owns both fetches and delays for a mounted loop.
- `TodayState` replaces `not_generated` with `{ status: "preparing"; localDate: string; takingLonger: boolean }`.

- [ ] **Step 1: Load the UI craft floor immediately before editing.**

Read the complete file:

```powershell
Get-Content C:\Users\htper\.agents\skills\impeccable\reference\craft-floor.md
```

Apply it as a narrow refinement: preserve the incumbent Today visual system and existing notice component; do not redesign the page.

- [ ] **Step 2: Replace the obsolete schedule test with failing automatic-preparation tests.**

Use `vi.useFakeTimers()` inside `try/finally` blocks that always restore real timers. Add tests proving:

- the first mounted request is a body-less `PUT /v1/readings/today`;
- `202` renders **Preparing your reading.** with the server's `local_date` and no **Check again** control;
- after 500 ms, a second response changed to `200` renders the reading without a click;
- consecutive `202`s occur only after cumulative delays `500`, `1,000`, `2,000`, `5,000`, `5,000`;
- a `200` response produces no later poll;
- the live-region message does not change on each poll and changes once after 15 seconds;
- unmount during a held fetch aborts its captured `AbortSignal`;
- unmount while waiting prevents another request after timers advance;
- preference save starts a fresh PUT ensure loop;
- `401` still calls `onUnauthorized`;
- a `424`, a `503`, and a network rejection each stop polling and render one retry action with the request ID when present;
- clicking retry while the error repeats keeps the same button mounted and focused; and
- neither the old “once per local day, on a schedule” text nor **Check again** exists.

Extend `CapturedRequest` in `api-mock.ts` with `signal: AbortSignal | null` and record `init?.signal ?? null` so abort cleanup is asserted directly.

- [ ] **Step 3: Run the focused suite and verify RED.**

Run:

```powershell
npm test -w @patternlike/web -- src/components/TodayView.test.tsx
```

- [ ] **Step 4: Implement an abortable delay with listener cleanup.**

The helper must clear its timeout and remove its abort listener on either resolution path. Abort may resolve the wait; the loop checks `signal.aborted` before issuing another request.

```ts
const POLL_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;
const SLOW_PREPARATION_MS = 15_000;
```

Do not use `setInterval`, a floating promise, module-level mutable state, or an unbounded zero-delay loop.

- [ ] **Step 5: Refactor the effect into one mounted ensure loop.**

For each effect generation:

1. create one `AbortController`;
2. replace the `getTodayReading` import/call with `ensureTodayReading` and call it immediately;
3. on `200`, set `ready` and return;
4. on the first `202`, set `preparing` once and start one 15-second status timer;
5. wait for the indexed capped delay, increment the poll index, and repeat;
6. on an error, classify once, set the dedicated state, and return;
7. in cleanup, abort the controller and clear the long-running timer; and
8. in `finally`, do not update state after abort.

The long-running timer uses a functional state update that changes only an existing `preparing` state. Repeated `202`s must not replace the live-region text.

- [ ] **Step 6: Render the hardened states and remove the obsolete one.**

- Initial request: retain a concise loading status.
- Preparing: title `Preparing your reading.`; status text names the resolved local date using `formatLocalDate`; after 15 seconds, acknowledge that preparation is taking longer without promising an ETA.
- Terminal/network error: retain the existing `TodayNotice` retry slot and `busy` behavior so a repeated failure preserves focus.
- Delete `TodayState.status = "not_generated"`, its switch branch, schedule commentary/copy, and manual **Check again** action.
- Remove `not_generated` from `TodayFailure` and `classifyTodayError`, because no Today caller uses the read-only GET after this task. Retain the read-only `getTodayReading` client method itself.

- [ ] **Step 7: Run web component, app, type, and accessibility tests.**

Run:

```powershell
npm test -w @patternlike/web -- src/components/TodayView.test.tsx
npm test -w @patternlike/web -- src/App.test.tsx
npm run typecheck -w @patternlike/web
```

The existing App axe test must still pass with a published response. The preparing state reuses the already-tested `TodayNotice` structure, so do not duplicate that axe assertion in this slice.

- [ ] **Step 8: Run the Impeccable detector once over the changed web targets.**

Run exactly once:

```powershell
node C:\Users\htper\.agents\skills\impeccable\scripts\detect.mjs --json apps/web/src/components/TodayView.tsx apps/web/src/lib/reading-state.ts apps/web/src/lib/api-client.ts
```

Resolve only confirmed findings within this slice, in one batch, then rerun the focused web tests. Do not rerun the detector.

- [ ] **Step 9: Review and commit the complete Today loop.**

Stage only `apps/web/src/components/TodayView.tsx`, `apps/web/src/components/TodayView.test.tsx`, `apps/web/src/lib/reading-state.ts`, and `apps/web/src/test/api-mock.ts`. Inspect the cached diff, then commit:

```powershell
git commit -m "web: render Today reading without manual refresh"
```

---

### Task 8: Final exact-scope verification and handoff

**Files:**

- Verify all implementation and documentation files committed by Tasks 1-7.
- Modify no production configuration, secret, database, R2 object, or deployment.

- [ ] **Step 1: Inspect scope and whitespace before claiming success.**

Run:

```powershell
git status --short
git diff --check 91da5bfcd2eb71032e2b9aaa38e27f02afda7bf4..HEAD
git diff --name-status 91da5bfcd2eb71032e2b9aaa38e27f02afda7bf4..HEAD
git diff --exit-code 91da5bfcd2eb71032e2b9aaa38e27f02afda7bf4 -- contracts/m0
```

Expected: clean worktree; only approved docs, M3 contracts, API, and Today web files changed; no M0 diff.

- [ ] **Step 2: Run focused evidence gates on the final head.**

Run:

```powershell
python contracts/validate_schemas.py
npm test -w @patternlike/api -- src/services/generation.integration.test.ts
npm test -w @patternlike/api -- src/routes/readings.integration.test.ts
npm test -w @patternlike/web -- src/components/TodayView.test.tsx src/App.test.tsx
```

- [ ] **Step 3: Run the repository-wide gates.**

Run:

```powershell
npm run typecheck
npm test
npm run build
```

`npm run build` must reach `@patternlike/api`'s `wrangler deploy --dry-run --outdir=dist --env production` after building `apps/web/dist`; record the Wrangler success output as the production-environment dry-run evidence.

- [ ] **Step 4: Perform an in-thread source review against the approved design.**

Review the final base-to-head diff for:

- GET remaining write-free;
- PUT identity/date derivation and exact response mapping;
- owner-scoped queries and Queue messages;
- concurrency convergence;
- due/lease comparisons and replacement budget preservation;
- no private detail on the wire;
- polling cap, abort cleanup, live-region stability, and focus behavior;
- no reading prose or fallback bypass; and
- no production, cron, M0, or unrelated surface changes.

If review changes code, commit the focused fix and rerun every affected focused gate plus Steps 1-3 on the new head.

- [ ] **Step 5: Record the local implementation handoff.**

Report:

- branch and exact final SHA;
- commits and changed-file allowlist;
- focused and full verification commands with pass/fail results;
- confirmation that the build included the production Wrangler dry run;
- confirmation that `contracts/m0/` is unchanged;
- confirmation that no deployment or production mutation occurred; and
- the still-separate operational gates: configure `CONTENT_RELEASE_KEYS`, ingest/activate a signed M3 editorial bundle, deploy the reviewed SHA, then certify authenticated PUT -> Queue -> 200/evidence plus duplicate and D1/R2 safety proof.
