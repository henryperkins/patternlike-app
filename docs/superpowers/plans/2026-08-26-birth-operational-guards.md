# Birth Operational Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound synchronous birth calculation, enforce an exact per-user invocation ceiling without charging requests that perform no calculation, and record the evidence needed to decide whether the birth workflow should become asynchronous.

**Architecture:** `invokeCalc` returns a response plus closed transport metadata and aborts after a validated Worker-configured deadline. A D1 allocator mints collision-free profile versions before encryption; an atomic attempt reservation conditionally writes the profile/job and charges one of five UTC-day units only when that request is authorized to call calc. Structured safe logs provide latency, timeout, and budget-denial signals while product errors remain generic.

**Tech Stack:** TypeScript strict ESM, Hono, Cloudflare Workers, D1, Vitest/workerd, OpenAPI 3.1

## Global Constraints

- Keep calculation inline and preserve the existing `202` workflow response.
- Initial production values are `CALC_FETCH_TIMEOUT_MS = "10000"` and `BIRTH_CALC_DAILY_LIMIT = "5"`.
- Reject calc response bodies above 1 MiB before JSON parsing.
- Production accepts integer timeouts from 1,000 through 30,000 ms and daily limits from 1 through 50, but both variables are required and malformed values fail closed.
- A “charged attempt” is every request authorized to call `/v1/calculate`, including a retry of a failed job.
- Validation failures and succeeded/running/queued/concurrent replays that perform no calc do not charge another unit.
- A failed-job retry must match the original encrypted birth request and consumes the next job attempt plus one new budget unit.
- A charged timeout, transport failure, invalid calc result, or duplicate fingerprint is not refunded because upstream spend already occurred.
- Never return `calc.error_message` except for `invalid_birth_profile`.
- Never log user id, job id, idempotency key/hash, birth fields, coordinates, place labels, upstream messages, URLs, or stacks.
- New operational tables are deleted with the account and classified non-portable.

## File Map

- `apps/api/src/services/birth-operational-config.ts`: validated timeout and daily-limit configuration.
- `apps/api/src/services/calc-client.ts`: bounded fetch and transport metadata.
- `apps/api/src/db/birth-calc-usage.ts`: exact reservation and UTC-day counter.
- `apps/api/src/routes/birth.ts`: replay-aware reservation, telemetry, and 429 response.
- `db/d1/0016_birth_calc_usage.sql`: usage and reservation tables.
- `apps/api/src/services/safe-log.ts`: closed operational events.
- `docs/deploy/birth-calc-slo.md`: async-migration evidence and thresholds.

---

### Task 1: Bound the calc transport and expose safe invocation metadata

**Files:**
- Create: `apps/api/src/services/birth-operational-config.ts`
- Create: `apps/api/src/services/birth-operational-config.test.ts`
- Create: `apps/api/src/services/calc-client.test.ts`
- Modify: `apps/api/src/services/calc-client.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/src/services/safe-log.test.ts`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/test/hermetic-bindings.ts`

**Interfaces:**
- Produces: `resolveBirthOperationalConfig` and `CalcInvocation`.
- Consumed by: Task 3’s birth-route integration.

- [ ] **Step 1: Write failing config and timeout tests**

Cover development defaults, required production values, integer/range rejection, successful calc, timeout, malformed JSON, misleading `Content-Length`, chunked overflow above 1 MiB, and ordinary transport failure:

```ts
expect(resolveBirthOperationalConfig({
  ENVIRONMENT: "production",
  CALC_FETCH_TIMEOUT_MS: "10000",
  BIRTH_CALC_DAILY_LIMIT: "5",
})).toEqual({
  ok: true,
  value: { fetchTimeoutMs: 10_000, dailyLimit: 5 },
});

expect(resolveBirthOperationalConfig({
  ENVIRONMENT: "production",
  CALC_FETCH_TIMEOUT_MS: "0",
  BIRTH_CALC_DAILY_LIMIT: "5",
})).toMatchObject({ ok: false });
```

Mock `fetch` with a promise that rejects with an abort error when the supplied signal fires. Assert:

```ts
expect(invocation).toMatchObject({
  response: { ok: false, error_class: "calc_transport_error" },
  timedOut: true,
});
expect(invocation.latencyMs).toBeGreaterThanOrEqual(0);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/services/birth-operational-config.test.ts src/services/calc-client.test.ts
```

Expected: missing module/type errors or an assertion that the fetch signal is absent.

- [ ] **Step 3: Implement the pure configuration resolver**

Expose:

```ts
export const DEFAULT_CALC_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_BIRTH_CALC_DAILY_LIMIT = 5;

export type BirthOperationalConfigResult =
  | { ok: true; value: { fetchTimeoutMs: number; dailyLimit: number } }
  | { ok: false; code: "birth_operational_config_invalid" };

export function resolveBirthOperationalConfig(
  env: Partial<Pick<
    Env,
    "ENVIRONMENT" | "CALC_FETCH_TIMEOUT_MS" | "BIRTH_CALC_DAILY_LIMIT"
  >>,
): BirthOperationalConfigResult;
```

Development/test may omit the values and receive defaults. Every other environment requires both. Reject decimals, signs, whitespace-only values, timeout outside `1_000..30_000`, and limit outside `1..50`.

- [ ] **Step 4: Implement the bounded invocation**

Replace the plain `CalcResponse` return with:

```ts
export interface CalcInvocation {
  response: CalcResponse;
  latencyMs: number;
  timedOut: boolean;
}

export const MAX_CALC_RESPONSE_BYTES = 1024 * 1024;

export async function invokeCalc(
  env: Env,
  req: CalcRequest,
  timeoutMs: number,
): Promise<CalcInvocation>;
```

Measure with `performance.now()`, set `signal: AbortSignal.timeout(timeoutMs)`,
reject an oversized declared `Content-Length`, and stream at most
`MAX_CALC_RESPONSE_BYTES + 1` bytes before parsing JSON. Cancel the body on
overflow. Map every thrown transport/parse/size error to
`calc_transport_error`. Determine timeout with the abort signal’s state rather
than matching exception text.

- [ ] **Step 5: Add closed safe-log events and configuration refusal**

Add:

```ts
| {
    event: "birth_calc_completed";
    outcome: "success" | "invalid_input" | "upstream_failure" | "timeout";
    latency_ms: number;
    timeout_ms: number;
  }
| { event: "birth_calc_budget_exhausted"; daily_limit: number }
```

Add `birth_operational_config_invalid` to `ConfigurationCode`. `checkSecureConfig` calls the resolver before the development short-circuit when either variable is present, and requires both outside development.

- [ ] **Step 6: Declare hermetic and production values**

Add both fields to `Env`, both Wrangler var blocks, and `test/hermetic-bindings.ts`. They are non-secret numeric configuration and must not be put in `.dev.vars`.

- [ ] **Step 7: Run focused and type verification**

```bash
npm exec -w @patternlike/api -- vitest run src/services/birth-operational-config.test.ts src/services/calc-client.test.ts src/middleware/config-guard.test.ts src/services/safe-log.test.ts
npm run typecheck -w @patternlike/api
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/birth-operational-config.ts apps/api/src/services/birth-operational-config.test.ts apps/api/src/services/calc-client.ts apps/api/src/services/calc-client.test.ts apps/api/src/env.ts apps/api/src/middleware/config-guard.ts apps/api/src/middleware/config-guard.test.ts apps/api/src/services/safe-log.ts apps/api/src/services/safe-log.test.ts apps/api/wrangler.toml apps/api/test/hermetic-bindings.ts
git commit -m "api: bound birth calculation transport"
```

---

### Task 2: Add the exact reservation-aware daily budget

**Files:**
- Create: `db/d1/0016_birth_calc_usage.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Modify: `contracts/smoke_check.py`
- Create: `apps/api/src/db/birth-calc-usage.ts`
- Create: `apps/api/src/db/birth-calc-usage.test.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`

**Interfaces:**
- Produces: `buildBirthCalcReservationStatements` and `readBirthCalcBudget`.
- Consumed by: Task 3.

- [ ] **Step 1: Write failing migration, budget, concurrency, and deletion tests**

Tests must prove:

1. A new reservation increments the UTC-day count once.
2. Replaying the same reservation hash returns success without increment.
3. Five distinct hashes succeed and the sixth is denied.
4. Two concurrent calls with the same hash consume one unit.
5. A denied reservation commits as `denied` without a profile/job row.
6. Two distinct idempotency keys receive distinct monotonically increasing profile versions.
7. User deletion removes all three tables.
8. Rows older than 35 UTC days are pruned only for that user.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/db/birth-calc-usage.test.ts src/services/deletion-manifest.test.ts
```

Expected: missing migration/table/module failures.

- [ ] **Step 3: Add migration 0016**

Create:

```sql
CREATE TABLE birth_calc_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  utc_date TEXT NOT NULL,
  reserved_calc_count INTEGER NOT NULL
    CHECK (reserved_calc_count BETWEEN 0 AND 50),
  last_reservation_hash TEXT NOT NULL
    CHECK (last_reservation_hash GLOB 'sha256:[0-9a-f]*'
      AND length(last_reservation_hash) = 71),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, utc_date)
);

CREATE TABLE birth_calc_reservations (
  user_id TEXT NOT NULL REFERENCES users(id),
  reservation_hash TEXT NOT NULL
    CHECK (reservation_hash GLOB 'sha256:[0-9a-f]*'
      AND length(reservation_hash) = 71),
  utc_date TEXT NOT NULL,
  claim_token_hash TEXT NOT NULL
    CHECK (claim_token_hash GLOB 'sha256:[0-9a-f]*'
      AND length(claim_token_hash) = 71),
  status TEXT NOT NULL CHECK (status IN ('pending', 'charged', 'denied')),
  created_at TEXT NOT NULL,
  charged_at TEXT,
  PRIMARY KEY (user_id, reservation_hash),
  CHECK (
    (status = 'pending' AND charged_at IS NULL)
    OR (status = 'charged' AND charged_at IS NOT NULL)
    OR (status = 'denied' AND charged_at IS NULL)
  )
);

CREATE INDEX idx_birth_calc_reservations_user_date
  ON birth_calc_reservations(user_id, utc_date);

CREATE TABLE birth_profile_version_counters (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  last_allocated_version INTEGER NOT NULL CHECK (last_allocated_version >= 0),
  updated_at TEXT NOT NULL
);
```

Append an explicit non-crypto-break entry to `MIGRATIONS.json`, bump its
package schema version to `0.8.0`, and extend the clean/populated migration
lanes plus `contracts/smoke_check.py` with all three tables and indexes. Do not
edit `0001`.

- [ ] **Step 4: Implement atomic reservation**

Expose:

```ts
export async function allocateBirthProfileVersion(
  env: Env,
  userId: string,
  now?: Date,
): Promise<number>;

export interface PreparedBirthCalcAttempt {
  reservationHash: string;
  claimTokenHash: string;
  utcDate: string;
  statements: D1PreparedStatement[];
}

export async function prepareBirthCalcAttempt(
  env: Env,
  userId: string,
  idempotencyKey: string,
  attempt: number,
  claimToken: string,
  limit: number,
  now?: Date,
): Promise<PreparedBirthCalcAttempt>;

export async function readBirthCalcAttempt(
  env: Env,
  userId: string,
  reservationHash: string,
  claimTokenHash: string,
  now?: Date,
): Promise<{
  status: "charged" | "denied";
  winner: boolean;
  resetsAt: string;
  retryAfterSeconds: number;
} | null>;
```

Allocate versions with one UPSERT/`RETURNING`, seeding a new counter from the
current `MAX(birth_profiles.version)`. Allocation is monotonic but intentionally
allows gaps when a later budget check denies the request; uniqueness and AAD
stability matter, contiguity does not.

Hash one actual invocation coordinate as:

```ts
const reservationHash = await contentHash(
  `patternlike.birth-calc-reservation.v1|${utcDate}|${attempt}|${idempotencyKey}`,
);
const claimTokenHash = await contentHash(
  `patternlike.birth-calc-claim.v1|${claimToken}`,
);
```

Return statements intended to be prepended to the profile/job start batch:

1. `INSERT OR IGNORE` a `pending` reservation carrying this request’s claim-token hash.
2. UPSERT the daily counter only when that reservation is still pending and the increment remains `<= limit`; set `last_reservation_hash` to this hash.
3. Mark the reservation `charged` only when the daily row’s `last_reservation_hash` matches.
4. Mark any still-pending reservation `denied`.
5. Prune this user’s usage/reservations older than 35 UTC days.

The route writes profile/job statements as `INSERT ... SELECT` or guarded
`UPDATE` statements whose `WHERE EXISTS` names this exact charged reservation
and claim-token hash. A concurrent caller that reuses the same attempt
coordinate observes `winner: false`, writes no profile/job, and must not call
calc.
The batch therefore succeeds with no profile/job on denial, while an unrelated
constraint/D1 error throws and rolls back the charge. Read the committed
reservation status to choose 429 versus calc; never infer denial from a caught
exception.

- [ ] **Step 5: Register lifecycle classifications**

Insert all three tables in dependency-safe order in `DELETED_USER_TABLES` and
`NON_PORTABLE_USER_TABLES`. They carry spend/idempotency/version-allocation
state, not reader content.

- [ ] **Step 6: Run migration and focused verification**

```bash
npm exec -w @patternlike/api -- vitest run src/db/birth-calc-usage.test.ts src/services/deletion-manifest.test.ts
npm run test:contracts
```

Expected: all pass; clean/populated migration checks report no FK violations.

- [ ] **Step 7: Commit and deploy schema before runtime**

```bash
git add db/d1/0016_birth_calc_usage.sql db/d1/MIGRATIONS.json apps/api/test/apply-migrations.ts contracts/smoke_check.py
git commit -m "db: add birth calculation usage ledger"
```

Merge/apply that schema-only commit, then commit the runtime/helper registration:

```bash
git add apps/api/src/db/birth-calc-usage.ts apps/api/src/db/birth-calc-usage.test.ts apps/api/test/helpers.ts apps/api/src/services/deletion-manifest.ts apps/api/src/services/deletion-manifest.test.ts
git commit -m "api: prepare birth calculation budget reservations"
```

---

### Task 3: Integrate budget, timeout, and telemetry into the birth route

**Files:**
- Create: `apps/api/src/services/birth-command.ts`
- Create: `apps/api/src/services/birth-command.test.ts`
- Modify: `apps/api/src/routes/birth.ts`
- Modify: `apps/api/src/routes/birth.integration.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: product-visible `429 birth_calc_budget_exhausted`.

- [ ] **Step 1: Write failing route tests**

Drive `SELF.fetch()` and prove:

- Five distinct keys reach calc; the sixth returns `429`, `Retry-After`, and `details.resets_at`.
- No profile/job row is written for the denied key.
- Replaying succeeded/running jobs does not increment usage or invoke calc.
- Retrying a failed job with the same normalized request consumes one new unit.
- Retrying a failed job with changed birth data returns `409 idempotency_conflict` without calc.
- Changed accuracy, approximate window, timezone hint, place id/manual
  coordinates, birth date/time, or consent id conflicts under the same failed
  key.
- A legacy or unknown-version failed command returns
  `409 idempotency_conflict` instructing the client to submit a new
  Idempotency-Key; malformed known-v1 plaintext fails through the generic 500
  boundary. Neither path charges, writes, or invokes calc.
- Two concurrent retries of one failed attempt produce one claim winner, one
  new profile/job attempt, one budget unit, and one calc invocation.
- Concurrent requests with one key consume one unit and converge on one job response.
- Concurrent requests with distinct keys allocate distinct profile versions and AAD.
- Two users have independent budgets.
- `TRIGGER_CALC_TIMEOUT` returns generic `502`, marks the job failed/profile invalid, and emits no upstream text.
- Success and `invalid_birth_profile` preserve existing behavior.

- [ ] **Step 2: Run the route test and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/routes/birth.integration.test.ts
```

Expected: sixth request is not 429 and timeout sentinel does not abort.

- [ ] **Step 3: Reserve only after validation/idempotency short-circuits**

In `birth.ts`:

1. Parse and validate the body.
2. Load `existingJob`.
3. Return immediately for `succeeded`, `queued`, or `running`.
4. For a failed job, decrypt the prior `birth_profiles.payload_enc` version
   named by its existing `payload_json`; decode the versioned birth command,
   compare its normalized submitted request field-by-field, and return
   `409 idempotency_conflict` on disagreement. Reuse its stored effective input
   without rerunning place or timezone resolution.
5. Capture one `now` and use it for UTC date, reset headers, profile/job
   timestamps, timeout telemetry, and every helper call.
6. For a new job, resolve the authoritative birthplace/timezone and build:

   ```ts
   type BirthLocationQualifierCode =
     | TimezoneQualifier["code"]
     | "approximate_match"
     | "region_level_match";

   interface BirthCalcCommandV1 {
     schema_version: "birth-calc-command/v1";
     submitted: {
       accuracy: BirthTimeAccuracy;
       consent_id: string;
       birth_date: string | null;
       birth_time_local: string | null;
       approximate_window_minutes: number | null;
       timezone_hint: string | null;
       birthplace: BirthProfileRequest["birthplace"] | null;
     };
     effective: {
       accuracy: BirthTimeAccuracy;
       birth_date: string | null;
       birth_time_local: string | null;
       approximate_window_minutes: number | null;
       timezone: string;
       birthplace: {
         place_id: string | null;
         label: string | null;
         latitude: number | null;
         longitude: number | null;
       };
       location_confidence: TimezoneConfidence;
       location_qualifier_codes: BirthLocationQualifierCode[];
     };
   }
   ```

   Store this command in `birth_profiles.payload_enc`. Its decoder must still
   read legacy profile payloads for export, but a legacy/unknown-version failed
   job may not be retried automatically because it lacks a complete canonical
   command. Return existing `409 idempotency_conflict` with
   “This failed request predates retry-safe birth commands; submit it with a
   new Idempotency-Key.” A malformed document claiming v1 is internal
   corruption and reaches the generic 500 handler. Both decisions happen
   before version allocation or budget reservation.
7. Allocate a collision-free profile version.
8. Prepare attempt `1` for a new job or `existingJob.attempts + 1` for a failed
   retry, then prepend its reservation statements to the profile/job batch.
9. Generate a random per-request claim token. Make profile insert and the
   `status='failed' AND attempts=?` job CAS conditional on the exact reservation
   being `charged` and owned by that token.
10. Commit the batch and read the reservation outcome. On `denied`, set
   `Retry-After` and return:

```json
{
  "error": {
    "code": "birth_calc_budget_exhausted",
    "message": "The daily birth calculation limit has been reached",
    "request_id": "req_...",
    "details": { "resets_at": "2026-08-27T00:00:00.000Z" }
  }
}
```

11. On `charged && winner`, invoke calc. On `charged && !winner`, re-read the
    owner-scoped job and return its running/duplicate state without calc.

Wrap the profile/job batch’s unique-key race: on conflict, re-read the
owner-scoped job and return its current duplicate/running state instead of a
500. Distinct keys cannot collide on profile version because allocation no
longer uses `MAX(version) + 1` in application code.

- [ ] **Step 4: Emit one closed completion event**

After `invokeCalc` returns, map only:

```ts
const outcome =
  invocation.timedOut ? "timeout"
  : invocation.response.ok ? "success"
  : invocation.response.error_class === "invalid_birth_profile"
    ? "invalid_input"
    : "upstream_failure";
```

Log the rounded non-negative latency and configured timeout. Do not add a second log carrying the exception.

- [ ] **Step 5: Add client copy and verify the frozen M8 response**

`ApiError.code === "birth_calc_budget_exhausted"` maps to a clear
retry-tomorrow onboarding error. Preserve the request id. The umbrella M8 task
already owns the OpenAPI response and fixture; this runtime task consumes and
validates them without editing contract bytes.

- [ ] **Step 6: Run focused verification**

```bash
npm exec -w @patternlike/api -- vitest run src/services/birth-command.test.ts src/routes/birth.integration.test.ts src/routes/birth.test.ts src/services/calc-client.test.ts src/db/birth-calc-usage.test.ts
npm exec -w @patternlike/web -- vitest run src/App.test.tsx
npm run test:contracts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/birth-command.ts apps/api/src/services/birth-command.test.ts apps/api/src/routes/birth.ts apps/api/src/routes/birth.integration.test.ts apps/api/test/mock-calc-service.ts apps/web/src/lib/api-client.ts apps/web/src/App.test.tsx
git commit -m "api: guard birth calculation spend and latency"
```

---

### Task 4: Define measured entry criteria for asynchronous birth processing

**Files:**
- Create: `docs/deploy/birth-calc-slo.md`
- Modify: `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: Write the operational decision record**

Document these exact triggers:

| Signal | Window | Trigger |
| --- | --- | --- |
| Successful calc p95 latency | rolling 7 days | `>= 8,000 ms` for 3 consecutive UTC days |
| Calc timeout rate | rolling 24 hours, at least 100 attempts | `>= 1%` |
| Successful calc p99 latency | rolling 7 days | `>= 9,000 ms` |
| Worker termination correlated with birth route | any | one confirmed production event |

Crossing any trigger opens a separate async-workflow design. A high 429 rate changes the configured product limit only after abuse/product review; it is not evidence for a queue.

- [ ] **Step 2: Include the observability query procedure**

Specify how to query `birth_calc_completed` by `outcome`, calculate p95/p99 over `latency_ms`, and compare attempts with `birth_calc_budget_exhausted`. Record the query interval, Worker version, and timeout config in every review.

- [ ] **Step 3: Update roadmap status honestly**

Mark timeout and rate limiting complete only after their tests pass. Keep Stream 8 labeled deferred and link its entry criteria.

- [ ] **Step 4: Validate docs and commit**

```bash
git diff --check
rg -n "T[B]D|T[O]DO|implement la[t]er|fill i[n]" docs/deploy/birth-calc-slo.md
```

Expected: clean diff and no placeholders.

```bash
git add docs/deploy/birth-calc-slo.md docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md README.md
git commit -m "docs: define asynchronous birth workflow triggers"
```

## Definition of Done

- [ ] Calc transport is aborted at the validated deadline.
- [ ] Timeout responses remain generic and no upstream path/message leaks.
- [ ] Five authorized calc invocations per user/UTC day succeed; the sixth is denied.
- [ ] Requests that perform no calc and concurrent copies of one attempt consume no duplicate unit.
- [ ] Every failed-job retry matches the original encrypted request and consumes a new invocation unit.
- [ ] Distinct concurrent keys receive distinct profile versions.
- [ ] Denial writes no profile/job and sets an accurate `Retry-After`.
- [ ] Failed or timed-out charged attempts are not refunded.
- [ ] All three operational tables are migration-tested, deletion-covered, and non-portable.
- [ ] Safe logs contain only closed outcomes and numeric timings.
- [ ] Async migration thresholds are recorded and the async implementation remains out of scope.
