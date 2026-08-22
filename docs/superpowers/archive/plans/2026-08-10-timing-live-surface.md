# Timing Live Surface Implementation Plan

> **ARCHIVED 2026-08-22 — complete.** Shipped as `apps/api/src/routes/timing.ts`
> and `apps/web/src/components/TimingView.tsx`; `GET /v1/timing` no longer
> returns 501. Do not execute. Index: [`../README.md`](../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated `GET /v1/timing` 501 and its placeholder screen with a schema-valid, user-scoped, read-only view of persisted active and upcoming cycle facts.

**Architecture:** Add an additive M3 response contract, read immutable first-scan `cycle_instances.cycle_json` artifacts plus the latest user-owned daily-reading scan receipt, validate each cycle independently, and project phases at one request-scoped `as_of` through the existing reading engine. Keep calculation, persistence, queueing, cron, interpretation, and domain inference out of the read path. Give the web client strict wire types and a dedicated Operate-mode Timing view while leaving `ApiFirstFeatureView` in place for Time Travel.

**Tech Stack:** JSON Schema 2020-12, OpenAPI 3.1, Python contract validation, Cloudflare Workers/D1, Hono, strict TypeScript ES modules, `@patternlike/reading-engine`, React 19, Vite 8, Vitest 4, Testing Library, axe-core, incumbent CSS tokens, Impeccable, Playwright CLI, Wrangler 4.

## Global Constraints

- Treat `docs/superpowers/archive/specs/2026-08-09-timing-live-surface-design.md` as the approved design authority. If code and this plan disagree, stop and reconcile against that document before editing behavior.
- `GET /v1/timing` is read-only: no calculation-service fetch, queue send, D1 mutation, refresh flag, date override, user-id input, or request body.
- Read passes only from `cycle_instances.cycle_json`. Never join or reconstruct from `cycle_passes`; a refined scan can legitimately make the two storage projections diverge.
- Push ownership and aging into SQL with `user_id = ? AND status = 'active' AND end_at >= ?`. Do not load another user's rows or every historical cycle for TypeScript filtering.
- Capture one `Date` per request. Use its ISO string for SQL eligibility, phase, sorting, filters, and `as_of`, and the same `Date` for the scheduling-zone local date.
- Validate the stored blob as a closed `NormalizedCycle` and enforce row/blob identity, row/blob `end_at`, envelope ordering, first-exact equality, ordered contiguous passes, and `pass_count`. Do not use `cycleHash` as an integrity substitute when no expected digest exists.
- Omit and count a malformed cycle independently. Fail the complete request only for D1 failure, missing authenticated user state, an unresolvable stored scheduling zone, or malformed scan-receipt state.
- Select the receipt with `ORDER BY local_date DESC, created_at DESC LIMIT 1` and no status predicate. A receipt on or after the current local date is current; a later date is legal after a time-zone change.
- Do not edit any file under `contracts/m0/`. The M3 amendment must explicitly supersede M0's incompatible Timing placeholder and remove `domain`.
- Do not add a migration. `cycle_instances.phase` stays untouched and non-authoritative.
- Preserve square geometry, warm paper layers, one-pixel rules, the incumbent serif/sans/mono roles, restrained Signal Coral, semantic dates, keyboard focus, mounted status messaging, reduced motion, and WCAG 2.2 AA.
- Do not add interpretive phase prose, related-reading links, a life-domain mapping, scheduled refresh, a cycle-detail page, or changes to Today, Time Travel, Pattern, privacy, cycle identity, scan policy, or phase policy.
- Use Node 20+ and Python 3.11+. Match two-space TypeScript indentation, double quotes, trailing commas, `.js` local imports, and snake_case wire fields.
- Keep API Vitest files serialized through the existing `fileParallelism: false`; do not weaken shared-D1 isolation or remove `resetDb()` setup.
- Preserve unrelated worktree changes. Stage each task with an explicit path allowlist, inspect `git diff --cached`, and never use a destructive reset or checkout.
- Production deployment and certification are separate from local implementation. Preserve Worker version `24742282-6531-49c7-905a-47370bef4004` as the rollback target, and remember that rollback does not revert D1.

---

### Task 1: Pin the additive M3 Timing contract

**Files:**
- Create: `contracts/m3/timing-response.schema.json`
- Modify: `contracts/m3/fixtures/generate_fixtures.py`
- Generate: `contracts/m3/fixtures/valid/timing-response.current-empty.json`
- Generate: `contracts/m3/fixtures/valid/timing-response.not-scanned.json`
- Generate: `contracts/m3/fixtures/valid/timing-response.active-multi-pass.json`
- Generate: `contracts/m3/fixtures/invalid/timing-response.active-null-phase.json`
- Generate: `contracts/m3/fixtures/invalid/timing-response.upcoming-with-phase.json`
- Generate: `contracts/m3/fixtures/invalid/timing-response.current-null-receipt.json`
- Generate: `contracts/m3/fixtures/invalid/timing-response.noncontiguous-passes.json`
- Generate: `contracts/m3/fixtures/invalid/timing-response.unsupported-filter.json`
- Modify: `contracts/validate_schemas.py`
- Modify: `contracts/m3/openapi/openapi.yaml`
- Modify: `contracts/m3/SCHEMA_MANIFEST.json`
- Read-only proof: `contracts/m0/openapi/openapi.yaml`

**Interfaces:**
- Defines: `m3:timing-response.schema.json#/$defs/timingResponse`.
- Documents: `GET /v1/timing` query parameters `phase` and `duration`, plus `200`, `400`, `401`, and `500`.
- Supersedes without editing: M0 `TimingResponse`, `items`, `calculation_status.stale`, and the M0 `domain` parameter.

- [ ] **Step 1: Add generated fixture cases before enforcing the schema**

In `generate_fixtures.py`, add a `TIMING_CURRENT_EMPTY` fixture with this exact root shape:

```python
TIMING_CURRENT_EMPTY = {
    "schema_version": SV,
    "as_of": "2026-08-10T05:15:00Z",
    "calculation_status": {
        "mode": "persisted_daily_reading_scan",
        "state": "current",
        "last_refresh_at": "2026-08-10T05:01:12Z",
        "last_refresh_local_date": "2026-08-10",
    },
    "applied_filters": {"phase": None, "duration": None},
    "unreadable_cycle_count": 0,
    "cycles": [],
}
write(V + "timing-response.current-empty.json", TIMING_CURRENT_EMPTY)

TIMING_NOT_SCANNED = copy.deepcopy(TIMING_CURRENT_EMPTY)
TIMING_NOT_SCANNED["calculation_status"] = {
    "mode": "persisted_daily_reading_scan",
    "state": "not_scanned",
    "last_refresh_at": None,
    "last_refresh_local_date": None,
}
write(V + "timing-response.not-scanned.json", TIMING_NOT_SCANNED)
```

Add the valid multi-pass twin exactly:

```python
TIMING_ACTIVE_MULTI_PASS = copy.deepcopy(TIMING_CURRENT_EMPTY)
TIMING_ACTIVE_MULTI_PASS["unreadable_cycle_count"] = 1
TIMING_ACTIVE_MULTI_PASS["cycles"] = [
    {
        "cycle_id": "cyc_0123456789abcdef0123456789abcdef",
        "technique": "transit",
        "body": "saturn",
        "target": "sun",
        "aspect": "square",
        "status": "active",
        "phase": "reconsidering",
        "start_at": "2026-07-19T05:22:10Z",
        "exact_at": "2026-08-02T14:11:07Z",
        "end_at": "2027-01-26T18:44:02Z",
        "duration_days": 191.55685185185186,
        "orb_deg": 3,
        "passes": [
            {
                "pass_index": 1,
                "direction": "direct",
                "exact_at": "2026-08-02T14:11:07Z",
            },
            {
                "pass_index": 2,
                "direction": "retrograde",
                "exact_at": "2026-10-19T03:52:44Z",
            },
            {
                "pass_index": 3,
                "direction": "direct",
                "exact_at": "2027-01-11T21:07:19Z",
            },
        ],
    }
]
write(V + "timing-response.active-multi-pass.json", TIMING_ACTIVE_MULTI_PASS)
```

The fixture uses the exact elapsed-day calculation; the shorter `191.56` in
the design is presentation rounding.

Generate each invalid fixture as exactly one `copy.deepcopy()` mutation:

```python
bad = copy.deepcopy(TIMING_ACTIVE_MULTI_PASS)
bad["cycles"][0]["phase"] = None
write(I + "timing-response.active-null-phase.json", bad)

bad = copy.deepcopy(TIMING_ACTIVE_MULTI_PASS)
cycle = bad["cycles"][0]
cycle["status"] = "upcoming"
cycle["start_at"] = "2027-02-01T00:00:00Z"
cycle["exact_at"] = "2027-02-10T00:00:00Z"
cycle["end_at"] = "2027-03-01T00:00:00Z"
cycle["passes"] = [
    {"pass_index": 1, "direction": "direct", "exact_at": cycle["exact_at"]}
]
cycle["duration_days"] = 28.0
write(I + "timing-response.upcoming-with-phase.json", bad)

bad = copy.deepcopy(TIMING_CURRENT_EMPTY)
bad["calculation_status"]["last_refresh_at"] = None
bad["calculation_status"]["last_refresh_local_date"] = None
write(I + "timing-response.current-null-receipt.json", bad)

bad = copy.deepcopy(TIMING_ACTIVE_MULTI_PASS)
bad["cycles"][0]["passes"][1]["pass_index"] = 3
write(I + "timing-response.noncontiguous-passes.json", bad)

bad = copy.deepcopy(TIMING_CURRENT_EMPTY)
bad["applied_filters"]["duration"] = "annual"
write(I + "timing-response.unsupported-filter.json", bad)
```

- [ ] **Step 2: Add a deliberately permissive test seam and verify RED**

Create `timing-response.schema.json` with the correct `$id` and a temporary permissive definition:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://patternlike.app/contracts/m3/timing-response.schema.json",
  "$defs": { "timingResponse": { "type": "object" } },
  "$ref": "#/$defs/timingResponse"
}
```

Add this longest-prefix mapping to `FIXTURE_SCHEMA`:

```python
"timing-response": "https://patternlike.app/contracts/m3/timing-response.schema.json#/$defs/timingResponse",
```

Add `timing-response.noncontiguous-passes` to `POLICY_ONLY`, run the generator, then run:

```powershell
python contracts/m3/fixtures/generate_fixtures.py
python contracts/validate_schemas.py
```

Expected: the validator fails because the four schema-invalid fixtures pass the permissive definition and the noncontiguous policy fixture has no Timing policy failure yet. This is the contract RED, not a completed schema.

- [ ] **Step 3: Replace the seam with the closed Timing response schema**

Define these closed `$defs`, all with `additionalProperties: false` where they are objects:

- `timingPhaseFilter`: the five `m0:common.schema.json#/$defs/cyclePhase` values plus `upcoming`.
- `durationFilter`: `short | medium | long`.
- `calculationStatus`: required mode, state, `last_refresh_at`, and `last_refresh_local_date`; use conditional schema rules so `not_scanned` requires both receipt fields to be null and `current | stale` requires both to be formatted strings.
- `appliedFilters`: required nullable `phase` and nullable `duration`.
- `timingPass`: required positive `pass_index`, `direct | retrograde`, and formatted `exact_at`; deliberately omit speed.
- `timingCycle`: require every field in the approved response. Use a status conditional so `active` requires a non-null cycle phase and `upcoming` requires `phase: null`. Require `duration_days >= 0`, `orb_deg` in `[0, 12]`, at least one pass, and a `cyc_` identifier.
- `timingResponse`: require exactly `schema_version`, `as_of`, `calculation_status`, `applied_filters`, `unreadable_cycle_count`, and `cycles`.

The root must be:

```json
{
  "title": "Timing Response (GET /v1/timing)",
  "$ref": "#/$defs/timingResponse"
}
```

Use absolute M0 refs for `isoDate`, `isoDateTime`, `celestialBody`, `aspectType`, and `cyclePhase`, and the M3 common ref for `schemaVersion`.

- [ ] **Step 4: Add policy checks for relationships JSON Schema cannot express**

Add `timing_response_policy(doc)` and dispatch it from `policy_errors()` when the fixture name starts with `timing-response`. It must return errors for:

- noncontiguous pass indexes beginning at one;
- unordered pass timestamps;
- `exact_at != passes[0].exact_at`;
- any pass outside `[start_at, end_at]`;
- inverted envelopes;
- an active cycle outside `as_of` or an upcoming cycle not after `as_of`;
- `duration_days` differing from elapsed milliseconds divided by `86_400_000` beyond a small floating-point tolerance; and
- response ordering other than active by next exact pass/fallback end, then upcoming by start, with cycle id as tie-breaker.

Use `datetime.fromisoformat(value.replace("Z", "+00:00"))` in a small local parser; add `from datetime import datetime` at the import block. Do not compare timestamp strings inside the policy.

- [ ] **Step 5: Replace the OpenAPI 501 with the exact operation**

On `/v1/timing`:

- add `x-normative-schema: 'm3:timing-response.schema.json#/$defs/timingResponse'`;
- document optional `phase` and `duration` query parameters with the closed enums and duration thresholds;
- state that unknown, duplicate, `domain`, and invalid values return `invalid_filter`;
- document the read-only `cycle_json` source, per-cycle omission count, receipt semantics, and lack of future-horizon guarantee;
- replace `501` with `200`, `400`, `401`, and `500`; and
- point `200` at a new closed `TimingResponse` component that mirrors the normative schema without exposing speed, domain, stored phase, or storage timestamps.

Also update the OpenAPI document-level description from “Two routes change
substantively” to three and name Timing as the M3 replacement for the never-
implemented M0 placeholder. Do not imply compatibility with M0's response.

- [ ] **Step 6: Record the M0 supersession honestly**

In `SCHEMA_MANIFEST.json`:

- remove only `/v1/timing` from the `out_of_scope_for_this_freeze` entry;
- append an `additive_schema` amendment dated `2026-08-10`;
- name the M0 `{items, calculation_status:{last_refresh_at, stale}}` shape and its phase/domain/duration query surface;
- state that M3 replaces `items` with `cycles`, replaces `stale` with a three-state receipt, adds exact passes and omission reporting, and removes `domain` because no authoritative mapping exists;
- state that M0 remains byte-frozen and M3 already carries the successor schema version; and
- list the new schema, generated fixtures, and OpenAPI file.

- [ ] **Step 7: Run the focused contract gate and verify GREEN**

Run:

```powershell
python contracts/m3/fixtures/generate_fixtures.py
python contracts/validate_schemas.py
npm run test:contracts
git status --short -- contracts/m0
```

Expected: all valid Timing fixtures pass, every invalid twin fails for its named reason, both OpenAPI documents validate, every normative pointer resolves, the M0 manifest hash matches, and `git status` prints nothing for `contracts/m0`.

- [ ] **Step 8: Commit the contract with an explicit allowlist**

Run:

```powershell
git add contracts/m3/timing-response.schema.json contracts/m3/fixtures/generate_fixtures.py contracts/m3/fixtures/valid/timing-response.current-empty.json contracts/m3/fixtures/valid/timing-response.not-scanned.json contracts/m3/fixtures/valid/timing-response.active-multi-pass.json contracts/m3/fixtures/invalid/timing-response.active-null-phase.json contracts/m3/fixtures/invalid/timing-response.upcoming-with-phase.json contracts/m3/fixtures/invalid/timing-response.current-null-receipt.json contracts/m3/fixtures/invalid/timing-response.noncontiguous-passes.json contracts/m3/fixtures/invalid/timing-response.unsupported-filter.json contracts/validate_schemas.py contracts/m3/openapi/openapi.yaml contracts/m3/SCHEMA_MANIFEST.json
git diff --cached --check
git diff --cached --stat
git commit -m "contracts: define M3 Timing response"
```

Expected: one contract-focused commit and no staged M0 file.

---

### Task 2: Build the user-scoped D1 Timing reader

**Files:**
- Create: `apps/api/src/db/timing.test.ts`
- Create: `apps/api/src/db/timing.ts`
- Modify: `apps/api/test/helpers.ts`
- Read-only reference: `apps/api/src/db/cycles.ts`
- Read-only reference: `apps/api/src/services/generate-daily-reading.ts`

**Interfaces:**

```ts
export interface TimingScanReceipt {
  localDate: string;
  createdAt: string;
}

export interface TimingSnapshot {
  cycles: NormalizedCycle[];
  unreadableCycleIds: string[];
  receipt: TimingScanReceipt | null;
}

export async function loadTimingSnapshot(
  env: Env,
  userId: string,
  asOf: string,
): Promise<TimingSnapshot>;
```

Add a test-only `seedTimingReceipt(options)` export to
`apps/api/test/helpers.ts`. It must insert every required clear
`daily_readings` column, derive a unique `reading_key` from the supplied id,
default revision 1 to `initial` with no predecessor, and require callers of a
later revision to supply its non-initial reason and predecessor. This is shared
test setup, not production code.

```ts
export interface SeedTimingReceiptOptions {
  id: string;
  userId: string;
  localDate: string;
  releaseVersion: string;
  status?: "pending" | "failed" | "superseded";
  revision?: number;
  revisionReason?: "initial" | "defect_repair";
  supersedesReadingId?: string | null;
  createdAt: string;
}

export async function seedTimingReceipt(
  options: SeedTimingReceiptOptions,
): Promise<void>;
```

Use `assembly_mode: "deterministic"`, the launch calculation contract id, a
valid fixed chart fingerprint, `command_generation: 1`, and
`updated_at = created_at`. Do not create ciphertext for these non-published
test receipts.

- [ ] **Step 1: Write failing D1 reader tests**

Create `timing.test.ts` with `beforeEach` that calls `resetDb()`, seeds Alice
and Bob, confirms their preferences, seeds both charts, and calls
`seedActiveRelease("release-timing-tests")`. Every receipt helper must bind that
returned version so the `daily_readings.release_version` foreign key is real.

Add helpers that:

- construct closed `NormalizedCycle` objects with fixed `cyc_` ids and fixed ISO instants;
- call the real `persistCycles()` to create first-scan artifacts; and
- insert a daily-reading receipt with explicit user, local date, status, revision, predecessor, created time, and updated time.

Write tests proving:

1. eligible rows return parsed `cycle_json` and the latest receipt;
2. Bob's rows never appear in Alice's result;
3. ended and hand-seeded non-active rows are excluded before JSON parsing, even when their blob is malformed;
4. a malformed eligible sibling is omitted and its id appears once in `unreadableCycleIds` while a valid sibling remains;
5. a deliberately changed or extra `cycle_passes` row cannot alter returned pass timestamps or count;
6. receipt selection uses greatest `local_date`, then greatest `created_at` within that date, without filtering status; and
7. malformed receipt dates or timestamps reject the entire reader call.

For the within-date ordering case, insert revision 1 as `superseded`, then
revision 2 as `failed` with `revision_reason: "defect_repair"` and
`supersedes_reading_id` pointing at revision 1. For the cross-date case, insert
an older local date with a later `created_at` and assert the newer local date
wins. These states satisfy the real table checks while proving that neither
status nor creation time outranks local date.

Run:

```powershell
npm test --workspace apps/api -- src/db/timing.test.ts
```

Expected: FAIL because `./timing.js` does not exist.

- [ ] **Step 2: Implement the two bounded SELECT queries**

In `timing.ts`, use exactly these predicates:

```ts
const cycleResult = await env.DB.prepare(
  `SELECT id, end_at, cycle_json
   FROM cycle_instances
   WHERE user_id = ? AND status = 'active' AND end_at >= ?`,
)
  .bind(userId, asOf)
  .all<CycleInstanceRow>();

const receipt = await env.DB.prepare(
  `SELECT local_date, created_at
   FROM daily_readings
   WHERE user_id = ?
   ORDER BY local_date DESC, created_at DESC
   LIMIT 1`,
)
  .bind(userId)
  .first<ReceiptRow>();
```

Do not select `phase`, join `cycle_passes`, or add a reading-status predicate.

- [ ] **Step 3: Validate each stored cycle independently**

Implement a private `parseStoredCycle(row): NormalizedCycle | null` that:

- catches JSON parse failures;
- requires a plain object with only `id`, `technique`, `body`, `target`, `aspect`, `start_at`, `exact_at`, `end_at`, `pass_count`, `passes`, `orb_deg`, and optional `importance_score`;
- requires each pass to contain only `pass_index`, `direction`, `exact_at`, and `speed_deg_per_day`;
- validates closed technique, body, aspect, direction, finite numeric fields, `cyc_` id shape, non-empty target, and parseable instants;
- requires `row.id === cycle.id` and `row.end_at === cycle.end_at`;
- requires `start_at <= exact_at <= end_at`, every pass within the envelope, strictly increasing pass instants, indexes `1..N`, `pass_count === N`, and `exact_at === passes[0].exact_at`; and
- returns a newly projected object rather than the parsed object itself.

Use `LAUNCH_BODIES` and `LAUNCH_ASPECTS` from `@patternlike/shared` as the runtime enum authorities. Keep `speed_deg_per_day` inside the validated stored object because `computePhase` accepts the complete `NormalizedCycle`; the route will omit it from the response.

Validate a receipt as a real calendar date and a parseable instant. Throw a generic `StoredTimingReceiptInvalidError` without embedding the date or user id when either field is malformed.

- [ ] **Step 4: Run the focused reader suite and API typecheck**

Run:

```powershell
npm test --workspace apps/api -- src/db/timing.test.ts
npm run typecheck --workspace apps/api
```

Expected: PASS. The divergent-pass test must prove the returned list still matches `cycle_json`, not merely that the request succeeds.

- [ ] **Step 5: Commit the read model**

Run:

```powershell
git add apps/api/src/db/timing.ts apps/api/src/db/timing.test.ts apps/api/test/helpers.ts
git diff --cached --check
git commit -m "api: read persisted Timing cycles"
```

---

### Task 3: Serve the real authenticated Timing response

**Files:**
- Create: `apps/api/src/routes/timing.test.ts`
- Create: `apps/api/src/routes/timing.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/stubs.ts`
- Modify: `apps/api/src/routes/stubs.test.ts`
- Reuse: `apps/api/test/helpers.ts`
- Reuse: `apps/api/src/db/preferences.ts`
- Reuse: `apps/api/src/services/local-day.ts`
- Reuse: `packages/reading-engine/src/phase.ts`

**Interfaces:**

```ts
export type TimingPhaseFilter = CyclePhase | "upcoming";
export type TimingDurationFilter = "short" | "medium" | "long";
export interface TimingFilters {
  phase: TimingPhaseFilter | null;
  duration: TimingDurationFilter | null;
}

export function projectTimingResponse(input: {
  asOf: string;
  currentLocalDate: string;
  snapshot: TimingSnapshot;
  filters: TimingFilters;
}): TimingResponse;

export const timingRoutes: Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>;
```

- [ ] **Step 1: Write the route and pure-projector tests first**

In `timing.test.ts`, compile `contracts/m3/timing-response.schema.json` with AJV alongside M0 and M3 common schemas. Declare the response wire shape locally in the test so assertions do not accidentally validate the implementation against its own TypeScript type.

Add fixed-instant pure tests for:

- each of the five `computePhase` outputs and one upcoming cycle;
- active-before-upcoming ordering, next exact-pass ordering, fallback-to-end ordering, and cycle-id ties;
- duration classification immediately below 90, at 90, immediately below 365, and at 365 days; and
- phase, upcoming, and duration filters with echoed `applied_filters`.

Add Worker integration tests for:

- a schema-valid authenticated 200 and an ordinary current empty receipt;
- `current`, `stale`, and `not_scanned` calculation states;
- a Tokyo receipt remaining current after changing the stored scheduling zone to Los Angeles;
- another user's cycle never appearing;
- one malformed eligible cycle being logged by opaque cycle id and request id, omitted, and counted without losing its valid sibling;
- `?phase=...`, `?duration=...`, and both together;
- `domain`, an unknown key, an empty value, a duplicate value, and an unsupported value returning `400 invalid_filter` with the request id;
- unauthenticated `401`;
- a malformed receipt and a simulated D1 read failure returning the standard safe `500` envelope; and
- no outbound fetch and no D1 mutation during an ordinary Timing request.

Run:

```powershell
npm test --workspace apps/api -- src/routes/timing.test.ts
```

Expected: FAIL because the route module and handler do not exist and the Worker still answers 501.

- [ ] **Step 2: Implement exact filter parsing**

Use `c.req.queries()` so duplicates remain visible. Accept only `phase` and `duration`, require exactly one non-empty value for each present key, and check the closed sets. Return:

```json
{
  "error": {
    "code": "invalid_filter",
    "message": "Timing filters are invalid",
    "request_id": "<request id>"
  }
}
```

with status 400 for every invalid case. Do not echo the rejected key or value, and do not silently ignore `domain`.

- [ ] **Step 3: Implement the deterministic response projector**

For every readable cycle:

1. parse `start_at`, `end_at`, and each pass once;
2. classify `active` when `start <= asOf <= end`, otherwise `upcoming` when `start > asOf`;
3. call `computePhase(cycle, asOf)` only for active cycles and assert its result is non-null;
4. calculate `(end - start) / 86_400_000`;
5. project named wire fields and pass fields without spread syntax and without speed; and
6. apply phase/duration filters after recomputation.

Sort before filtering with this conceptual key:

```ts
const key = cycle.status === "active"
  ? [0, nextPassAtOrAfterAsOf ?? endAt, cycle.cycle_id]
  : [1, startAt, cycle.cycle_id];
```

Build `calculation_status` from the validated receipt:

- no receipt: `not_scanned` and both refresh fields null;
- receipt local date before the current local date: `stale`;
- receipt local date on or after current local date: `current`.

Always set mode to `persisted_daily_reading_scan`, echo the filters, and set `unreadable_cycle_count` before filtering.

- [ ] **Step 4: Implement the route with one clock read**

The handler body must follow this order:

```ts
const requestId = c.get("requestId");
const now = new Date();
const asOf = now.toISOString();
const filters = parseTimingFilters(c.req.queries());
const preferences = await loadPreferences(c.env, c.get("userId"));
const currentLocalDate = localDateIn(preferences.timezone, now);
const snapshot = await loadTimingSnapshot(c.env, c.get("userId"), asOf);
```

If preferences are absent, return the established 401 envelope. If local-day resolution fails, log only the request id and error class, then return the safe 500 envelope. Let a D1 or receipt invariant exception reach the existing `app.onError`, which already logs detail and returns a safe 500.

When `snapshot.unreadableCycleIds` is non-empty, emit one structured error log:

```ts
console.error("timing_cycles_unreadable", {
  request_id: requestId,
  cycle_ids: snapshot.unreadableCycleIds,
});
```

Return the projector result with 200. Await every operation and introduce no mutable module-level request state.

- [ ] **Step 5: Register before stubs and narrow the stub suite**

Import `timingRoutes` in `apps/api/src/index.ts` and register it after `readingRoutes` and before `stubRoutes`. Delete only this line from `stubs.ts`:

```ts
stubRoutes.get("/v1/timing", (c) => notImplemented(c, "Timing cycles (M3)"));
```

Remove Timing from the parameterized 501 list. Point the caller-supplied request-id stub assertion at `/v1/time-travel?date=2026-08-08` so the shared 501 correlation behavior remains covered.

- [ ] **Step 6: Run focused and complete API gates**

Run:

```powershell
npm test --workspace apps/api -- src/db/timing.test.ts src/routes/timing.test.ts src/routes/stubs.test.ts
npm run typecheck --workspace apps/api
npm test --workspace apps/api
```

Expected: PASS. The full API suite remains serialized, and no Today, content-release, queue, preference, auth, or migration test regresses.

- [ ] **Step 7: Commit the route**

Run:

```powershell
git add apps/api/src/routes/timing.ts apps/api/src/routes/timing.test.ts apps/api/src/index.ts apps/api/src/routes/stubs.ts apps/api/src/routes/stubs.test.ts
git diff --cached --check
git commit -m "api: serve persisted Timing cycles"
```

---

### Task 4: Give the web client strict Timing types and factual formatting

**Files:**
- Modify: `apps/web/src/lib/api-client.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/timing-format.test.ts`
- Create: `apps/web/src/lib/timing-format.ts`

**Interfaces:**

```ts
export type TimingPhase =
  | "emerging"
  | "building"
  | "peak"
  | "reconsidering"
  | "integrating";
export type TimingPhaseFilter = TimingPhase | "upcoming";
export type TimingDurationFilter = "short" | "medium" | "long";

export interface TimingFilters {
  phase?: TimingPhaseFilter;
  duration?: TimingDurationFilter;
}

export interface TimingResponse {
  schema_version: "0.3.0";
  as_of: string;
  calculation_status: {
    mode: "persisted_daily_reading_scan";
    state: "current" | "stale" | "not_scanned";
    last_refresh_at: string | null;
    last_refresh_local_date: string | null;
  };
  applied_filters: {
    phase: TimingPhaseFilter | null;
    duration: TimingDurationFilter | null;
  };
  unreadable_cycle_count: number;
  cycles: TimingCycle[];
}
```

`TimingCycle` must exactly mirror the contract: opaque `cycle_id`, `transit`, body, target, aspect, `active | upcoming`, nullable phase, three cycle instants, `duration_days`, `orb_deg`, and pass index/direction/exact time. It must not contain domain or speed.

- [ ] **Step 1: Write client-query and formatting tests**

Add API-client tests proving:

- `getTiming({ phase: "peak", duration: "medium" })` requests `?phase=peak&duration=medium` in that order;
- omitted filters produce no `?`;
- a `TimingFilters` object containing `domain` is guarded by an
  `@ts-expect-error` assertion, so restoring that member makes the test build
  fail with an unused directive; and
- the resolved value is usable as a `TimingResponse`, not `unknown`.

Add `timing-format.test.ts` cases for:

- `timingCycleTitle("saturn", "square", "sun") === "Saturn square your Sun"`;
- known and future body/target/aspect tokens have deterministic labels;
- all phase, duration-band, and direction labels;
- `formatTimingDuration(191.55685185185186) === "191.6 days"` and
  `formatTimingOrb(3) === "3.0°"`; and
- valid and malformed instants.

Run:

```powershell
npm test --workspace apps/web -- src/lib/api-client.test.ts src/lib/timing-format.test.ts
```

Expected: FAIL because the strict response and formatting module do not exist.

- [ ] **Step 2: Implement the strict client boundary**

Remove `domain` and replace the loose filter strings with the closed unions. Construct the query explicitly rather than iterating an open object:

```ts
const query = new URLSearchParams();
if (filters.phase) query.set("phase", filters.phase);
if (filters.duration) query.set("duration", filters.duration);
```

Return `request<TimingResponse>` from `getTiming`.

- [ ] **Step 3: Implement deterministic factual labels**

In `timing-format.ts`, export:

```ts
export const PHASE_OPTIONS;
export const DURATION_OPTIONS;
export function timingCycleTitle(body: string, aspect: string, target: string): string;
export function timingPhaseLabel(phase: TimingPhase | null, status: "active" | "upcoming"): string;
export function timingDirectionLabel(direction: "direct" | "retrograde"): string;
export function formatTimingInstant(value: string): string;
export function formatTimingDuration(days: number): string;
export function formatTimingOrb(degrees: number): string;
```

Use closed `Record` maps where the contract is closed and a local slug-humanizer only for open string targets/future-safe display. Format real instants in the browser's locale. Keep phase output to the contract token label; do not author interpretation.
Use one fractional digit for elapsed days and orb degrees so the test values
above are stable across browsers.

- [ ] **Step 4: Run focused web library tests and typecheck**

Run:

```powershell
npm test --workspace apps/web -- src/lib/api-client.test.ts src/lib/timing-format.test.ts
npm run typecheck --workspace apps/web
```

Expected: PASS with no `unknown` Timing payload and no domain filter.

- [ ] **Step 5: Commit the client boundary**

Run:

```powershell
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts apps/web/src/lib/timing-format.ts apps/web/src/lib/timing-format.test.ts
git diff --cached --check
git commit -m "web: type Timing cycle data"
```

---

### Task 5: Record the approved Timing surface before UI edits

**Files:**
- Create: `apps/web/.impeccable/surfaces/apps-web-src-components-timingview-tsx.md`
- Read-only reference: `apps/web/PRODUCT.md`
- Read-only reference: `apps/web/DESIGN.md`
- Read-only reference: `apps/web/.impeccable/surfaces/apps-web-src-components-todayview-tsx.md`

**Interfaces:**
- Defines the Operate-mode UI contract for `TimingView.tsx` and Timing-scoped CSS.
- Does not change runtime behavior.

- [ ] **Step 1: Create the named surface brief**

Use this front matter:

```yaml
---
version: 1
slug: "apps-web-src-components-timingview-tsx"
primary_target: "apps/web/src/components/TimingView.tsx"
related_targets: ["apps/web/src/lib/timing-format.ts","apps/web/src/styles.css"]
---
```

The brief must record:

- visitor mode `Operate`;
- audience job: inspect active and already-persisted upcoming cycle arcs without specialist knowledge or predictive claims;
- data ranges: zero or many cycles, one or many exact passes, all five phases plus upcoming, current/stale/not-scanned receipt, zero or many unreadable artifacts, and both filters;
- hierarchy: factual page header, scan-status strip, two filters, editorial cycle list, progressive timeline, semantic exact-pass list, evidence metadata;
- states: loading, current, current empty, stale with visible facts, not scanned, filtered empty, unreadable count, rollback 501, network/server error, unauthorized;
- exclusions: interpretation, domain, refresh from GET, cron promises, related readings, development JSON, and milestone placeholder;
- incumbent authority: `PRODUCT.md`, `DESIGN.md`, current shell, paper/forest/coral tokens, square flat components, serif/sans/mono roles; and
- responsive proof at 1440x1000 and 390x844 with semantic `<time>` values and CSS-independent pass order.

State that Today may require chart, scheduling-zone, locale, or active-release setup; the link must not promise immediate population.

- [ ] **Step 2: Inspect and commit the brief before component edits**

Run:

```powershell
Get-Content apps/web/.impeccable/surfaces/apps-web-src-components-timingview-tsx.md
git add apps/web/.impeccable/surfaces/apps-web-src-components-timingview-tsx.md
git diff --cached --check
git commit -m "docs(web): define Timing surface brief"
```

Expected: the brief is committed before `TimingView.tsx` or `styles.css` changes.

---

### Task 6: Replace the placeholder with the owned Timing experience

**Files:**
- Create: `apps/web/src/test/timing-fixture.ts`
- Create: `apps/web/src/components/TimingView.test.tsx`
- Modify: `apps/web/src/components/TimingView.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Read-only reference: `apps/web/src/components/TodayView.tsx`
- Read-only reference: `apps/web/src/components/ApiFirstFeatureView.tsx`

**Interfaces:**

```ts
interface TimingViewProps {
  onUnauthorized: () => void;
}
```

- [ ] **Step 1: Add a representative web fixture and failing behavior tests**

Create a strict `TimingResponse` fixture containing:

- one active Saturn-square-Sun three-pass cycle in `reconsidering`;
- one upcoming Jupiter-trine-Moon one-pass cycle;
- a current scan receipt;
- no filters; and
- a separate helper for current-empty, stale, not-scanned, and unreadable-count variants.

In `TimingView.test.tsx`, use the shared API mock and render `TimingView` directly with a spy `onUnauthorized`. Add tests for:

1. one page `h1`, factual title/lede, both cycle titles, status/phase, envelope dates, exact pass numbers/directions, semantic `<time dateTime>`, technique, orb, duration, and cycle id;
2. current empty copy that limits the claim to the stored scan window;
3. stale facts remaining visible with a Today link;
4. not-scanned copy naming possible chart/time-zone/locale/release setup without promising success;
5. filtered-empty copy and a reset control;
6. a nonzero unreadable count alongside valid facts and the alternate no-readable-cycles copy;
7. phase and duration selects issuing abortable, contract-shaped requests and reset returning to the unfiltered URL;
8. initial loading with a mounted heading and polite status region;
9. 501 rollback copy and request id without development JSON or a milestone stamp;
10. network and server error copy, request id, and retry button retaining focus while disabled during the retry;
11. a 401 calling `onUnauthorized` and rendering no cycle data; and
12. a focused axe scan with color contrast disabled only because JSDOM cannot calculate the real CSS colors.

Run:

```powershell
npm test --workspace apps/web -- src/components/TimingView.test.tsx
```

Expected: FAIL because the current component is the generic placeholder and accepts no unauthorized callback.

- [ ] **Step 2: Implement one abortable state owner**

Replace `ApiFirstFeatureView` usage with a dedicated component. Keep filters as controlled state and issue `getTiming(filters, controller.signal)` from one effect. Abort on unmount and every filter change.

Use a state model that can keep the retry control mounted during a retry:

```ts
type TimingFailure =
  | { kind: "not_implemented"; requestId: string | null }
  | { kind: "error"; message: string; requestId: string | null };

const [response, setResponse] = useState<TimingResponse | null>(null);
const [failure, setFailure] = useState<TimingFailure | null>(null);
const [busy, setBusy] = useState(true);
const [attempt, setAttempt] = useState(0);
```

On 401, call `onUnauthorized()` and return. On 501, use `isNotImplemented()` and the existing request-id-safe message. On other errors, preserve `ApiError.requestId`. On retry, increment `attempt` without removing the error button before the request settles.

- [ ] **Step 3: Implement semantic status, filters, cycles, and empty states**

Render:

- a stable header with eyebrow `Timing / Active cycles`, the existing whole-arc headline, and present-tense factual lede;
- a status strip naming persisted daily-reading scan, current/stale/not-scanned, last refresh when present, and the exact unreadable count;
- labeled native phase and duration selects with blank `All phases` and `All durations` options plus the approved labels;
- an ordered editorial cycle list;
- each cycle as an `<article>` with an `h2`, mechanical phase/upcoming marker, start/end `<time>` values, an `aria-hidden` timeline, a visible ordered pass list with `<time>` values, and a compact definition list for technique/orb/duration/id; and
- state-specific empty/error sections using the exact distinctions in the approved design.

The timeline position must be derived only from `(instant - start) / (end - start)` and clamped to `[0, 100]`. Mark the current position and next exact pass with Signal Coral; leave the semantic pass list authoritative.

- [ ] **Step 4: Hand unauthorized state back to App and narrow App tests**

Change App's Timing branch to:

```tsx
content = <TimingView onUnauthorized={handleSignedOut} />;
```

Move Timing's generic 501/retry/live assertions out of `App.test.tsx`; retain Time Travel coverage through `ApiFirstFeatureView`. Add one App-level assertion that a Timing 401 reaches the existing signed-out screen so the prop integration is covered once.

- [ ] **Step 5: Run focused and complete web behavior suites**

Run:

```powershell
npm test --workspace apps/web -- src/components/TimingView.test.tsx src/App.test.tsx src/lib/api-client.test.ts src/lib/timing-format.test.ts
npm run typecheck --workspace apps/web
npm test --workspace apps/web
```

Expected: PASS. Time Travel remains a generic future route; Timing renders no raw JSON or successful-route placeholder.

- [ ] **Step 6: Commit the behavior before visual polish**

Run:

```powershell
git add apps/web/src/test/timing-fixture.ts apps/web/src/components/TimingView.tsx apps/web/src/components/TimingView.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git diff --cached --check
git commit -m "web: render live Timing states"
```

---

### Task 7: Apply the incumbent visual system and verify the candidate

**Files:**
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/.impeccable/harnesses/timing-live-surface.js`
- Inspect: all files changed by Tasks 1–6
- Use OS-temp captures: `%TEMP%\patternlike-timing-live\`

**Interfaces:**
- Produces responsive CSS and bounded visual evidence only; no wire or database change.

- [ ] **Step 1: Read the Impeccable craft floor immediately before CSS editing**

Re-read the Impeccable skill's UI craft reference, the new Timing surface brief, and `apps/web/DESIGN.md`. This is the required pre-edit design checkpoint; do not silently reuse the Today composition.

- [ ] **Step 2: Add Timing-scoped structural CSS**

Create only `.timing-*` rules plus narrow shared-selector additions when unavoidable. Implement:

- a wide but bounded page column aligned to the existing shell;
- compact status and filter strips separated by Graphite Rules;
- two square native selects with at least 44px control height and Cobalt focus rings through the existing focus system;
- a one-column editorial cycle list with no card grid, rounded corners, or shadows;
- a proportional one-pixel timeline with square pass ticks, a Coral current/next tick, and text that does not depend on the line;
- a responsive metadata definition grid that collapses before labels become cramped;
- mobile stacking, no horizontal overflow, safe-area clearance, and 44px targets at 390x844; and
- a reduced-motion-safe loading/update treatment.

Use `clamp()` for the page headline and cycle title, `minmax(0, 1fr)` on grid tracks that carry long ids, `overflow-wrap: anywhere` on the cycle id, and square borders. Do not alter future-route, Today, Chart, Time Travel, or Privacy styling to make Timing fit.

- [ ] **Step 3: Add the browser harness**

Create `timing-live-surface.js` as a Playwright `run-code` function. It must:

- read `timing=(live|not-scanned)-<port>` from `about:blank`;
- set viewport 1440x1000;
- route `/v1/chart` to a schema-shaped 200 so App enters the authenticated shell;
- route `/v1/timing` to either the representative two-cycle response with `unreadable_cycle_count: 1` or a not-scanned empty response;
- navigate to `http://127.0.0.1:<port>/#timing`;
- wait for the exact page heading and state-specific content; and
- return mode, URL, cycle count, and horizontal overflow proof (`document.documentElement.scrollWidth <= innerWidth`).

The fixture data must match the TypeScript web fixture rather than inventing a third response shape.

- [ ] **Step 4: Run focused verification after CSS**

Run:

```powershell
npm test --workspace apps/web -- src/components/TimingView.test.tsx src/App.test.tsx
npm run typecheck
npm run build --workspace apps/web
```

Expected: PASS; Vite produces the app, and strict TypeScript accepts CSS custom-property typing used by timeline markers.

- [ ] **Step 5: Run the Impeccable detector once**

Run:

```powershell
node "C:\Users\htper\.agents\skills\impeccable\scripts\detect.mjs" --json apps/web/src/components/TimingView.tsx apps/web/src/styles.css
```

Expected: no blocking finding in the changed Timing targets. Record advisories; do not start an unbounded polish loop.

- [ ] **Step 6: Capture one bounded desktop/mobile browser round**

Run this PowerShell sequence from the repository root. It uses fixed port
`5188`, starts Vite with `--strictPort` in a hidden process, keeps Playwright
state and captures under `%TEMP%\patternlike-timing-live\`, validates the
recursive-clean target before removing it, and stops the exact Vite process in
`finally`:

```powershell
$repoRoot = (Resolve-Path ".").Path
$port = 5188
$baseUrl = "http://127.0.0.1:$port"
$artifactRoot = Join-Path ([System.IO.Path]::GetTempPath()) "patternlike-timing-live"
$playwrightRoot = Join-Path $artifactRoot "playwright-work"
$harness = Join-Path $repoRoot "apps/web/.impeccable/harnesses/timing-live-surface.js"
$liveSession = "timing-live"
$emptySession = "timing-not-scanned"
$liveDesktop = Join-Path $artifactRoot "live-desktop-1440x1000.png"
$liveMobile = Join-Path $artifactRoot "live-mobile-390x844.png"
$emptyDesktop = Join-Path $artifactRoot "not-scanned-desktop-1440x1000.png"
$viteStdout = Join-Path $artifactRoot "vite.stdout.log"
$viteStderr = Join-Path $artifactRoot "vite.stderr.log"
$viteProcess = $null

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is already in use; stop that listener before running this gate."
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$artifactFullPath = [System.IO.Path]::GetFullPath($artifactRoot).TrimEnd("\")
$playwrightFullPath = [System.IO.Path]::GetFullPath($playwrightRoot)
if (-not $playwrightFullPath.StartsWith(
    $artifactFullPath + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw "Refusing to clean Playwright state outside $artifactFullPath"
}
if (Test-Path -LiteralPath $playwrightRoot) {
  Remove-Item -LiteralPath $playwrightRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $playwrightRoot | Out-Null

@($liveDesktop, $liveMobile, $emptyDesktop, $viteStdout, $viteStderr) |
  ForEach-Object {
    if (Test-Path -LiteralPath $_) {
      Remove-Item -LiteralPath $_ -Force
    }
  }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$viteEntry = (Resolve-Path "node_modules/vite/bin/vite.js").Path
$webRoot = (Resolve-Path "apps/web").Path

function Invoke-TimingPlaywright {
  param([string[]]$Arguments)

  & $npx "playwright-cli" @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "playwright-cli failed: $($Arguments -join ' ')"
  }
}

try {
  $viteProcess = Start-Process `
    -FilePath $node `
    -ArgumentList @($viteEntry, "--host", "127.0.0.1", "--port", "$port", "--strictPort") `
    -WorkingDirectory $webRoot `
    -RedirectStandardOutput $viteStdout `
    -RedirectStandardError $viteStderr `
    -WindowStyle Hidden `
    -PassThru

  $ready = $false
  $deadline = (Get-Date).AddSeconds(30)
  while (-not $ready -and (Get-Date) -lt $deadline) {
    if ($viteProcess.HasExited) {
      throw "Vite exited early. Inspect $viteStderr"
    }
    try {
      $response = Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing -TimeoutSec 2
      $ready = $response.StatusCode -eq 200
    } catch {
      $ready = $false
    }
    if (-not $ready) {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) {
    throw "Vite did not become ready within 30 seconds. Inspect $viteStderr"
  }

  Push-Location $playwrightRoot
  try {
    Invoke-TimingPlaywright @("install")

    Invoke-TimingPlaywright @(
      "-s=$liveSession", "open", "about:blank?timing=live-$port"
    )
    Invoke-TimingPlaywright @(
      "-s=$liveSession", "run-code", "--filename", $harness
    )
    Invoke-TimingPlaywright @(
      "-s=$liveSession", "screenshot", "--filename", $liveDesktop
    )
    Invoke-TimingPlaywright @("-s=$liveSession", "resize", "390", "844")
    Invoke-TimingPlaywright @(
      "-s=$liveSession", "screenshot", "--filename", $liveMobile
    )

    Invoke-TimingPlaywright @(
      "-s=$emptySession", "open", "about:blank?timing=not-scanned-$port"
    )
    Invoke-TimingPlaywright @(
      "-s=$emptySession", "run-code", "--filename", $harness
    )
    Invoke-TimingPlaywright @(
      "-s=$emptySession", "screenshot", "--filename", $emptyDesktop
    )
  } finally {
    Pop-Location
  }

  @($liveDesktop, $liveMobile, $emptyDesktop) | ForEach-Object {
    $capture = Get-Item -LiteralPath $_ -ErrorAction Stop
    if ($capture.Length -lt 1000) {
      throw "Capture is unexpectedly small: $($capture.FullName)"
    }
    $capture | Select-Object FullName, Length, LastWriteTime
  }
} finally {
  if (Test-Path -LiteralPath $playwrightRoot) {
    Push-Location $playwrightRoot
    try {
      & $npx "playwright-cli" "-s=$liveSession" close 2>$null | Out-Null
      & $npx "playwright-cli" "-s=$emptySession" close 2>$null | Out-Null
    } finally {
      Pop-Location
    }
  }

  if ($null -ne $viteProcess -and -not $viteProcess.HasExited) {
    Stop-Process -Id $viteProcess.Id -Force
    Wait-Process -Id $viteProcess.Id -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $playwrightRoot) {
    Remove-Item -LiteralPath $playwrightRoot -Recurse -Force
  }
}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is still listening after teardown."
}
```

Create these named captures:

- `live-desktop-1440x1000.png`;
- `live-mobile-390x844.png`; and
- `not-scanned-desktop-1440x1000.png`.

In one live session, capture desktop, resize to 390x844, and capture mobile. In a second not-scanned session, capture desktop. Verify the harness returns no horizontal overflow in both modes. Inspect the three images together and confirm:

- headline, status, filters, and first cycle establish the desktop first viewport;
- the timeline is legible but subordinate to textual dates and pass order;
- the multi-pass cycle reads in chronological order;
- the unreadable warning is exact and does not hide valid facts;
- the not-scanned state does not promise Today will populate Timing;
- labels, ids, selects, shell navigation, and bottom navigation do not overflow at 390px; and
- Coral marks state/next pass only.

If the round exposes a material mismatch, batch one correction in `TimingView.tsx`, `TimingView.test.tsx`, or Timing-scoped CSS, rerun the focused web gate, and capture one final round. Do not start a third visual iteration.

- [ ] **Step 7: Run the fresh root candidate gate**

Run from the repository root, in order:

```powershell
npm run typecheck
npm test
npm run build
git diff --check
git status --short
```

Expected: every command exits 0. The test run includes contract/OpenAPI validation and the serialized API D1 suites. No browser output appears under the repository.

- [ ] **Step 8: Commit visual verification support and prove the candidate head**

Run:

```powershell
git add apps/web/src/styles.css apps/web/.impeccable/harnesses/timing-live-surface.js apps/web/src/components/TimingView.tsx apps/web/src/components/TimingView.test.tsx
git diff --cached --check
git commit -m "web: finish responsive Timing surface"
git status --short --branch
git log -6 --oneline --decorate
```

Expected: clean branch `codex/timing-live-surface`, with contract, API reader, API route, client types, surface brief, web behavior, and visual commits all present.

---

### Task 8: Deploy and certify the reachable production state

**Files:**
- No repository edits expected.
- Read-only: `package.json`
- Read-only: `apps/api/wrangler.toml`
- Read-only: `contracts/m3/timing-response.schema.json`

**Interfaces:**
- Deploys the committed Worker/PWA candidate to the named Cloudflare production environment.
- Produces deployment and runtime evidence; it does not migrate or rewrite D1.

- [ ] **Step 1: Reconfirm the exact deploy candidate**

Immediately before deployment, run:

```powershell
git status --short --branch
git rev-parse HEAD
npm run typecheck
npm test
npm run build
```

Expected: clean worktree and a fresh all-green gate at the exact candidate head. If anything changed after Task 7, rerun rather than reusing older evidence.

- [ ] **Step 2: Confirm Cloudflare preconditions without mutation**

Using the Cloudflare and Wrangler skills, inspect the named production environment, existing D1 migration state, configured secret names, and current deployments. Record rollback version `24742282-6531-49c7-905a-47370bef4004`. Do not rotate secrets, ingest a release, create users, or change D1 as part of this check.

- [ ] **Step 3: Deploy from the repository root**

Run:

```powershell
npm run deploy:api
Set-Location apps/api
npx wrangler deployments list --env production
Set-Location ../..
```

Expected: the web build completes, Wrangler deploys the production environment, and the new deployment reaches 100% traffic. Record the new version id and candidate Git head separately because the deployment record may not expose the SHA.

- [ ] **Step 4: Validate the immediately reachable authenticated 200**

Use an already-authorized production session through the app/browser rather than extracting cookies or credentials. Make a same-origin authenticated request to `/v1/timing`, record the HTTP status and body, and validate that body against `timing-response.schema.json`.

With the currently known production precondition—no active signed M3 release—the expected honest result is:

- HTTP 200;
- `calculation_status.state === "not_scanned"`;
- both refresh fields null;
- `cycles: []`; and
- `unreadable_cycle_count: 0` unless production contains an independently explainable malformed eligible row.

If the endpoint is not schema-valid, stop and preserve the prior version as the rollback option. Do not accept a visually plausible response as contract proof.

- [ ] **Step 5: Verify the production UI at the honest state**

Open production Timing in the existing authenticated session and verify the not-scanned copy, filters, responsive layout, and absence of the milestone/payload placeholder. Check desktop and mobile-sized layouts. Confirm the Today link describes possible setup gates rather than promising immediate cycle data.

- [ ] **Step 6: Gate live-cycle and cross-user certification on real prerequisites**

Before attempting live cycle proof, verify all of these exist:

1. a configured release signing key;
2. an ingested and activated signed M3 bundle;
3. a successful Today preparation for the test account;
4. at least one eligible persisted cycle; and
5. two authorized authenticated test sessions.

Only when all five are present:

- require a schema-valid cycle-bearing 200;
- verify phase and duration predicates against returned cycles;
- prove the second account cannot read the first account's cycle ids; and
- confirm the production UI renders the actual envelope and exact passes.

If any precondition is absent, stop and report the missing proof. Do not create accounts, ingest or activate content, repurpose credentials, treat an empty filter result as ownership proof, or claim local tests as production evidence.

- [ ] **Step 7: Close the deployment evidence**

Report separately:

- exact local candidate head and fresh gate results;
- deployed Worker version and 100% traffic proof;
- schema-valid authenticated production result;
- production UI result;
- whether live-cycle/cross-user proof ran or which prerequisite blocked it; and
- rollback target `24742282-6531-49c7-905a-47370bef4004`, with the explicit warning that rollback does not revert D1.

Do not label the feature production-certified beyond the evidence actually obtained.

---

## Final self-review checklist

- [ ] Every approved design invariant has a named implementation step and test.
- [ ] No task reads Timing from `cycle_passes`, trusts stored phase, calls calc, writes D1, or adds cron.
- [ ] M0 remains byte-frozen and the M3 amendment names the incompatible supersession.
- [ ] Receipt ordering is local date first, creation time second, with no status filter and later dates current.
- [ ] Malformed cycles are omitted and counted; malformed receipts and D1 failures fail safely.
- [ ] Query parsing rejects unknown, duplicate, empty, invalid, and `domain` parameters.
- [ ] Web success states render facts, not raw JSON or interpretive copy, and 501 is retained only as rollback compatibility.
- [ ] Unauthorized state returns to the existing signed-out screen.
- [ ] The Timing surface brief is committed before component styling.
- [ ] Focus, live regions, semantic time values, axe, desktop, mobile, and overflow all have explicit proof.
- [ ] The full root gate runs fresh before completion and again at the exact deploy head.
- [ ] Production not-scanned proof is not confused with live-cycle, filtering, or ownership proof.
- [ ] A placeholder scan over the plan finds no unresolved marker, and every referenced interface is internally type-consistent.
