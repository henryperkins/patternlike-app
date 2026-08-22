# Timing Live Surface Design

> **ARCHIVED 2026-08-22 — implemented.** Index: [`../README.md`](../README.md).

**Date:** 2026-08-09

**Revised:** 2026-08-10

**Status:** Implemented and archived 2026-08-22 — `apps/api/src/routes/timing.ts`
and `apps/web/src/components/TimingView.tsx`. Read "Approved for implementation
planning" when written.

**Scope:** Authenticated `GET /v1/timing`, its additive M3 response contract,
and the responsive Timing screen that renders persisted cycle facts

## Goal

An authenticated reader can open Timing and see the active cycle arcs that are
already persisted for their account, together with every exact pass, the
server-recomputed current phase, the full start-to-end envelope, and an honest
statement of when the underlying daily-reading scan last ran.

Timing is a read surface. Loading it must not call the calculation service,
enqueue a reading, mutate D1, or imply that a background refresh exists. Today
preparation remains the only current writer of persisted cycles. A stale or
absent scan is visible and links the reader to Today instead of silently doing
work from a GET request.

The surface remains calculated, not invented. It presents cycle facts and
contract phase names; it does not synthesize interpretation, promise an event,
or assign a life domain that the data model cannot support.

## Chosen architecture

### Selected: read persisted cycles

`GET /v1/timing` reads the authenticated user's immutable first-scan artifact
from `cycle_instances.cycle_json`, parses it as a `NormalizedCycle`, and calls
the existing `computePhase(cycle, asOf)` function for the response instant. The
stored `cycle_instances.phase` column is never read as authority.

`cycle_passes` is not a Timing read source. A refined scan may keep the same
cycle identity while moving a pass timestamp, and both tables use
`INSERT OR IGNORE` under different uniqueness rules. Reconstructing a cycle from
the pass table could therefore combine a first-scan envelope with a different
pass list and make Timing disagree with the exact `cycle_json` artifact Today
assembled from.

The route is deterministic for one database snapshot and one `as_of` instant.
It returns active cycles first and any already-persisted upcoming cycles second.
It cannot promise complete future coverage because the current Today scan is
the only population path; the calculation-status object makes that limitation
explicit.

### Alternatives not selected

1. **Refresh from GET.** A missing or stale read could call the calculation
   service and persist a new scan. This is rejected because browser prefetch,
   retries, and ordinary navigation would create work and writes, and because it
   would make route availability depend on the calculation service.
2. **Implement scheduled refresh first.** A cron-triggered horizon scan would
   provide stronger upcoming-cycle coverage. This is deferred because the
   scheduled M3 refresh phase remains unfinished and is not required to make
   already-persisted cycle facts useful.
3. **Return stored phase.** This would make filtering cheap, but the column is
   intentionally null for current writes and becomes wrong as time advances.
   Recomputing with the versioned reading-engine state machine is the only
   authoritative option.

## M3 contract and M0 supersession

Add `contracts/m3/timing-response.schema.json`, valid and invalid fixtures, a
validator mapping, an additive manifest amendment, and a `200` response in
`contracts/m3/openapi/openapi.yaml`. Remove only `/v1/timing` from the
manifest's list of response bodies left outside the original freeze. Nothing
under `contracts/m0/` changes.

M0 did specify a `TimingResponse`, a `200`, and `phase`, `domain`, and `duration`
query parameters in `contracts/m0/openapi/openapi.yaml`. Its response is
`{items, calculation_status:{last_refresh_at, stale}}` and cannot represent the
M3 design below. The M3 amendment must therefore say explicitly that
`timing-response.schema.json` supersedes the frozen M0 placeholder for
`GET /v1/timing`, including these incompatibilities:

- `items` becomes the modelled `cycles` collection with exact passes and
  active/upcoming state;
- the boolean `stale` becomes `current | stale | not_scanned` with a scan
  receipt date;
- `schema_version`, `as_of`, applied filters, and unreadable-cycle reporting are
  added; and
- `domain` is removed because neither M0 nor M3 supplies an authoritative
  cycle-to-domain mapping.

The M3 schema version remains `0.3.0`: M3 is already the versioned successor to
M0, and its current OpenAPI deliberately carries no Timing success body. Adding
the new M3 document is additive within that package even though it supersedes an
incompatible M0 placeholder. `check_m0_frozen()` continues to prove both the M0
manifest hash and a clean `contracts/m0/` working tree.

The response shape is:

```json
{
  "schema_version": "0.3.0",
  "as_of": "2026-08-10T05:15:00.000Z",
  "calculation_status": {
    "mode": "persisted_daily_reading_scan",
    "state": "current",
    "last_refresh_at": "2026-08-10T05:01:12.000Z",
    "last_refresh_local_date": "2026-08-10"
  },
  "applied_filters": {
    "phase": null,
    "duration": null
  },
  "unreadable_cycle_count": 0,
  "cycles": [
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
      "duration_days": 191.56,
      "orb_deg": 3,
      "passes": [
        {
          "pass_index": 1,
          "direction": "direct",
          "exact_at": "2026-08-02T14:11:07Z"
        },
        {
          "pass_index": 2,
          "direction": "retrograde",
          "exact_at": "2026-10-19T03:52:44Z"
        },
        {
          "pass_index": 3,
          "direction": "direct",
          "exact_at": "2027-01-11T21:07:19Z"
        }
      ]
    }
  ]
}
```

### Response invariants

- `as_of` is one server instant captured once per request and used for every
  inclusion, phase, ordering, and filter decision.
- Eligibility is pushed into SQL with
  `WHERE user_id = ? AND status = 'active' AND end_at >= ?`. The time predicate
  does the real lifecycle work: `persistCycles` hardcodes `active`, and no
  production writer currently changes it to `completed`.
- `status` is `active` when `start_at <= as_of <= end_at`; it is `upcoming` when
  `start_at > as_of`.
- `phase` is the exact value returned by `computePhase` for an active cycle and
  is null only for an upcoming cycle.
- `duration_days` is `(end_at - start_at) / 86_400_000`, without calendar-month
  arithmetic.
- Each eligible row's `cycle_json` is parsed and checked against the closed
  `NormalizedCycle` shape and semantic rules: row/blob identity, envelope,
  first-exact consistency, ordered contiguous passes, and
  `pass_count === passes.length`. The pass list comes only from that artifact.
- An unreadable stored artifact is omitted without taking down the reader's
  other valid cycles. `unreadable_cycle_count` reports how many eligible rows
  were omitted before filters were applied, and the Worker logs their cycle IDs
  with the request ID. A D1 query failure still fails the whole request.
- Active cycles sort by their next exact pass, falling back to `end_at` after
  the final pass. Upcoming cycles follow, sorted by `start_at`. `cycle_id` is
  the final tie-breaker.
- The response projects named fields from the validated artifact. It does not
  spread `cycle_json`, expose `speed_deg_per_day`, or return storage timestamps
  as cycle facts. Reading the artifact is distinct from putting the blob on the
  wire.

### Calculation status

Cycle persistence completes immediately before a daily-reading reservation is
created. A user-owned `daily_readings` row is therefore the existing receipt
that a complete scan reached the persistence boundary, including an empty scan.

The selected receipt is the greatest `local_date`, then the newest `created_at`
within that date: `ORDER BY local_date DESC, created_at DESC LIMIT 1`. It is not
filtered by reading `status`. Pending, failed, superseded, and published rows
all follow a successful `persistCycles` call, while filtering to the latest
creation time alone would let a reissue for yesterday make a current receipt
look stale. `last_refresh_at` and `last_refresh_local_date` come from this
selected row.

The state is:

- `current` when the latest scan receipt names the reader's current local date
  or a later date;
- `stale` when a receipt exists but names an earlier local date; or
- `not_scanned` when no receipt exists.

A later receipt is legal: a reader can prepare Today in an ahead time zone and
then change to a behind time zone. A malformed receipt timestamp or malformed
local date remains an invariant failure and produces the safe `500` response.

Both refresh fields are required strings for `current` and `stale`, and both
are null for `not_scanned`. The mode is always
`persisted_daily_reading_scan`. The response never calls this a scheduled or
complete future-horizon scan.

The current local date is resolved with the user's stored scheduling time zone.
Timing does not add a new preference gate: an unconfirmed server default can
still name the freshness date, while the status and Today link explain that no
current preparation has occurred.

### Filter semantics

The route accepts at most one value for each of two query parameters. Unknown
parameters, duplicate parameters, and invalid values return `400 invalid_filter`
with the standard request-ID error envelope.

- `phase`: `emerging`, `building`, `peak`, `reconsidering`, `integrating`, or
  `upcoming`. The five engine phases are compared only after recomputation;
  `upcoming` selects cycles whose recomputed phase is null and whose start lies
  after `as_of`.
- `duration`: `short`, `medium`, or `long`. Short means less than 90 elapsed
  days; medium means at least 90 and less than 365 elapsed days; long means at
  least 365 elapsed days. The UI labels these bands explicitly as “Under 3
  months,” “3–12 months,” and “1 year or longer.”

With no parameters, no filter is applied. `applied_filters` echoes the accepted
values so a response is inspectable without reconstructing its URL.

The existing placeholder client's `domain` filter is removed. No persisted or
editorial contract currently supplies an authoritative life-domain assignment
for a cycle. Ignoring `domain` or inferring it from body, target, or a reading
preference would violate the product's factual boundary. A caller that still
sends it receives `400 invalid_filter` rather than an apparently filtered 200.

### Documented responses

- `200 application/json`: the new timing response, including an ordinary empty
  `cycles` array;
- `400 application/json`: invalid or duplicate filters;
- `401 application/json`: the existing authentication error; and
- `500 application/json`: the standard safe error envelope for a D1 query
  failure or unreadable global scan-receipt state. One unreadable cycle is a
  counted omission in a 200, not a surface-wide 500.

The former `501` is removed from the Timing operation and remains on the other
stubs.

## D1 read model

Create `apps/api/src/db/timing.ts` as the read side of cycle persistence. Keep
`apps/api/src/db/cycles.ts` focused on derivation and writes.

The reader performs two user-scoped queries:

1. select `id`, `end_at`, and `cycle_json` from `cycle_instances` with
   `WHERE user_id = ? AND status = 'active' AND end_at >= ?`; and
2. select the scan receipt from `daily_readings` with `WHERE user_id = ? ORDER
   BY local_date DESC, created_at DESC LIMIT 1`, without a status predicate.

The first query uses the existing `(user_id, status, ...)` index prefix and does
not load every historical cycle into the Worker just to age it out in
TypeScript. The selected row ID and `end_at` must agree with the parsed artifact
used for projection.

Each artifact is validated independently. Timing does not call `cycleHash` as a
pseudo-integrity check: there is no clear stored expected digest on this read
path, and `cycleHash` hashes an explicit projection but does not itself enforce
the schema's enums or semantic rules. Closed-shape and semantic validation are
what determine readability. Generation retains its stronger pin-to-digest
comparison for the encrypted command it executes.

Ownership is always a query predicate. No cycle from another user is loaded and
filtered after the fact. A foreign cycle identifier and an unknown one therefore
never become distinguishable through this endpoint.

No migration is needed. The implementation neither repopulates
`cycle_instances.phase` nor changes the idempotent first-write-wins behavior of
`persistCycles`.

## Worker route

Create `apps/api/src/routes/timing.ts` with a dedicated `timingRoutes` Hono
router. Register it after authentication and before `stubRoutes` in
`apps/api/src/index.ts`. Remove only the `/v1/timing` handler and matching 501
expectations from the stub module.

The handler captures `as_of` once, validates the query, resolves the user's
current local date, calls the D1 reader, and projects the contract response. It
does not accept a user ID, chart ID, date override, refresh flag, or request
body. It awaits every D1 operation and introduces no request-global mutable
state or floating promise.

## Web experience

`TimingView` becomes a real Operate-mode surface and owns its modelled payload
and state handling. `ApiFirstFeatureView` remains the generic future-route
surface for Time Travel and other unmodelled responses.

### Hierarchy

1. Keep the established eyebrow and headline, changing the lede from future
   tense to factual present tense. The copy explains that cycle windows are not
   promises about events or outcomes.
2. Show a compact calculation-status strip with persisted-scan mode, current /
   stale / not-scanned state, the last refresh time when known, and an explicit
   warning when `unreadable_cycle_count` is nonzero.
3. Present two square selects: phase and duration. Labels name exactly the
   server semantics; changing one issues an abortable filtered request.
4. Render cycles in an editorial list, not a generic dashboard-card grid. Each
   cycle leads with a plain factual title such as “Saturn square your Sun,” a
   phase or Upcoming marker, and a start-to-end timeline whose exact-pass
   markers are also exposed as a semantic list with `<time>` elements.
5. Show technique, orb, elapsed duration, and cycle ID as restrained evidence
   metadata. The primary experience remains readable without astrology
   expertise, while the underlying facts remain inspectable.

The timeline is a progressive visual aid. Dates, pass order, direction, and
phase remain fully available in text when CSS is absent or assistive technology
is used. Signal Coral marks the current phase or next pass only; it is not used
as a decorative fill. Panels stay square, flat, and aligned to the incumbent
paper-and-rule system.

### States

- **Loading:** retain a mounted polite status region and a stable page heading.
- **Current with cycles:** render the status, filters, and cycle list.
- **Current with no cycles:** when `unreadable_cycle_count` is zero, say that no
  stored cycles overlap the current scan window; do not claim the user has no
  astrological activity beyond that window. When it is nonzero, say instead
  that no stored cycles could be displayed and name the omitted count.
- **Stale:** keep the latest facts visible, add a clear stale notice, and link to
  Today to prepare the current local day.
- **Not scanned:** explain that Timing has no persisted scan yet and link to
  Today as the place where preparation begins. Say that Today may first require
  chart, time-zone, locale, or release setup; do not promise that following the
  link will immediately populate Timing. Do not offer an in-place refresh
  button.
- **Filtered empty:** retain filters and status. With no unreadable rows, state
  that no persisted cycles match the selected filters. With unreadable rows,
  state only that no readable cycles match and that omitted rows could not be
  evaluated against the filters. Offer a reset control in both cases.
- **Unreadable cycles:** keep valid cycles visible and state the exact number of
  stored cycles omitted because their artifacts could not be read.
- **Older Worker (`501`):** preserve the honest not-active message and request
  ID for a cached or installed PWA that outlives a Worker rollback. The API and
  web assets otherwise ship together, so an ordinary rollout is not the reason.
- **Network or server error:** show the existing reader-safe message, request ID
  when present, and a retry button that remains mounted through the retry so
  focus is preserved.
- **Unauthorized:** continue through the app's existing signed-out handling
  rather than rendering cycle data.

The milestone stamp and “route is returning data” placeholder copy disappear
from a successful Timing response. Development JSON is not rendered.

### Client and formatting boundaries

`apps/web/src/lib/api-client.ts` gains strict `TimingResponse`, `TimingCycle`,
and filter types; `getTiming` returns `Promise<TimingResponse>`. A focused
formatting module owns body, target, aspect, phase, duration, and instant labels
with deterministic fallbacks for future open-enum values.

No interpretive phase prose is authored in application code. The UI may
humanize a contract token and describe a date's mechanical role, but long-form
cycle meaning remains reviewed editorial content outside this change.

### Impeccable surface brief

Create
`apps/web/.impeccable/surfaces/apps-web-src-components-timingview-tsx.md` as a
named deliverable before editing the Timing UI. It records the approved
Operate-mode job, data ranges, states, exclusions, incumbent visual authority,
and responsive evidence requirements. The existing Today surface brief is not
silently reused for a different page.

## Deliberate exclusions

- refresh-on-read, calculation-service calls, queue writes, or D1 writes from
  `GET /v1/timing`;
- cron, scheduled refresh, or a complete future-horizon guarantee;
- life-domain filtering until an authoritative cycle-to-domain contract exists;
- related-reading links, because M3 intentionally moved primary and supporting
  cycle IDs into encrypted reading artifacts; adding an efficient, bounded
  decryption-backed index is a separate privacy and retention design;
- cycle-detail interpretation or new editorial copy;
- changes to Today generation, cycle identity, cycle scan policy, phase policy,
  Time Travel, Pattern, privacy routes, or any M0 contract; and
- a D1 migration.

These exclusions are visible product limitations, not silently empty fields.

## Test design

### Contract

- validate an empty current response and a multi-pass active response;
- reject an active cycle with null phase, an upcoming cycle with a non-null
  phase, inconsistent calculation-status nullability, noncontiguous passes, and
  unsupported filter values;
- validate zero and nonzero `unreadable_cycle_count` values;
- validate the OpenAPI `200`, `400`, `401`, and `500` shapes; and
- prove the M3 amendment names its supersession of M0 while `contracts/m0/`
  remains byte-for-byte unchanged.

### D1 and API

- current, stale, and not-scanned calculation status, including a current empty
  scan receipt;
- receipt ordering by greatest local date then newest creation time, with no
  reading-status filter;
- a legal ahead-date receipt remains current after a time-zone change;
- SQL excludes ended rows and non-active hand-seeded rows before parsing;
- phase recomputation at fixed instants for all five phases and a multi-pass
  retrograde cycle;
- exact duration-boundary behavior at 90 and 365 days;
- deterministic ordering from the pass list inside `cycle_json`;
- deliberately divergent `cycle_passes` rows do not change Timing output;
- phase, upcoming, and duration filters plus duplicate/unknown query rejection;
- another user's cycles never appear;
- one malformed artifact is omitted and counted while sibling cycles still
  render;
- authenticated `200`, unauthenticated `401`, and removal of the Timing 501 stub;
  and
- no calculation-service, queue, or write operation occurs during the request.

### Web

- render a typical active cycle and a three-pass retrograde cycle with semantic
  times and phase state;
- render current-empty, stale, not-scanned, and filtered-empty copy without
  overstating coverage;
- issue contract-shaped phase and duration requests and reset filters;
- retain the last successful facts behind a stale notice;
- preserve retry focus and request IDs for network/server failures;
- preserve the 501 rollback state and unauthorized handoff;
- render no development payload or milestone placeholder on success; and
- pass focused axe checks plus desktop and mobile browser captures at the
  established 1440x1000 and 390x844 viewports.

### Full candidate gate

Run focused tests through red-green TDD, then fresh root `npm run typecheck`,
`npm test`, and `npm run build`. Run the Impeccable detector once over the final
changed UI targets, inspect desktop and mobile together in one bounded browser
round, batch any fixes, and confirm once.

## Production cutover

After the local candidate is committed and the full gate is green, deploy from
the repository root with `npm run deploy:api`. Confirm the new production Worker
deployment reaches 100% traffic and preserve version
`24742282-6531-49c7-905a-47370bef4004` as the rollback target.

Production acceptance is separate from local verification. At this design
review, production has no active signed M3 release, so Today cannot create a scan
receipt or persisted cycles. Unless that operational precondition changes, the
honest post-deploy result is `not_scanned` with an empty `cycles` array.

The immediately reachable production checks are:

1. make an authenticated unfiltered request and validate its 200 body against
   the new schema, including the expected not-scanned/empty state when no
   receipt exists;
2. open the production Timing UI and confirm the honest not-scanned state,
   filters, and responsive layout; and
3. confirm rollback readiness without changing D1, noting that Worker rollback
   never rewinds database data.

Live-cycle certification requires all of these additional preconditions: a
configured release signing key, an ingested and activated signed M3 bundle, a
successful Today preparation for the test account, at least one persisted cycle
that survives the as-of predicate, and two authenticated test sessions. Only
then make phase and duration requests, prove the second account cannot see the
first account's cycle IDs, and confirm real cycle/pass rendering in production.

If any precondition is absent, stop at that acceptance gate and report the
missing proof explicitly. Do not manufacture users, extract credentials, treat
vacuous empty-filter results as cycle-filter proof, or treat local ownership
tests as production evidence.
