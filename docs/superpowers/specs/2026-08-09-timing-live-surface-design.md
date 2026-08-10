# Timing Live Surface Design

**Date:** 2026-08-09

**Status:** Approved for implementation planning

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

`GET /v1/timing` reads user-owned `cycle_instances` and `cycle_passes`, rebuilds
each cycle from those relational facts, and calls the existing
`computePhase(cycle, asOf)` function for the response instant. The stored
`cycle_instances.phase` column is never read as authority.

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

## Additive M3 contract

Add `contracts/m3/timing-response.schema.json`, valid and invalid fixtures, a
validator mapping, an additive manifest amendment, and a `200` response in
`contracts/m3/openapi/openapi.yaml`. Remove only `/v1/timing` from the
manifest's list of response bodies left outside the original freeze. Nothing
under `contracts/m0/` changes, and the M3 schema version remains `0.3.0` because
this is a new response document for a path whose success body was deliberately
unspecified.

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
- A row is eligible when it belongs to the authenticated user, has
  `status = active`, and has not ended before `as_of`.
- `status` is `active` when `start_at <= as_of <= end_at`; it is `upcoming` when
  `start_at > as_of`.
- `phase` is the exact value returned by `computePhase` for an active cycle and
  is null only for an upcoming cycle.
- `duration_days` is `(end_at - start_at) / 86_400_000`, without calendar-month
  arithmetic.
- Passes are ordered by `pass_index`, indices are contiguous from one, and the
  count equals the stored `pass_count`. A malformed stored cycle fails the
  request closed instead of emitting a partial or misleading cycle.
- Active cycles sort by their next exact pass, falling back to `end_at` after
  the final pass. Upcoming cycles follow, sorted by `start_at`. `cycle_id` is
  the final tie-breaker.
- The response projects named fields. It does not spread `cycle_json`, expose
  `speed_deg_per_day`, or return storage timestamps as cycle facts.

### Calculation status

Cycle persistence completes immediately before a daily-reading reservation is
created. The latest user-owned `daily_readings` row is therefore the existing
receipt that a complete scan reached the persistence boundary, including an
empty scan. `last_refresh_at` is that row's `created_at`, and
`last_refresh_local_date` is its `local_date`.

The state is:

- `current` when the latest scan receipt names the reader's current local date;
- `stale` when a receipt exists but names an earlier local date; or
- `not_scanned` when no receipt exists.

A malformed receipt timestamp, malformed local date, or receipt dated after the
reader's current local date is an invariant failure and produces the safe `500`
response. The route never relabels corrupt or future-dated state as current.

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
- `500 application/json`: the standard safe error envelope when persisted data
  cannot be reconstructed consistently.

The former `501` is removed from the Timing operation and remains on the other
stubs.

## D1 read model

Create `apps/api/src/db/timing.ts` as the read side of cycle persistence. Keep
`apps/api/src/db/cycles.ts` focused on derivation and writes.

The reader performs bounded set queries rather than one pass query per cycle:

1. select eligible cycle-instance columns with `WHERE user_id = ?`;
2. select pass rows through an owner-constrained join on both `cycle_id` and
   `user_id`;
3. select the latest daily-reading scan receipt with `WHERE user_id = ?`; and
4. rebuild, validate, phase, filter, and sort in TypeScript.

Ownership is always a query predicate. No cycle or pass from another user can
be loaded and filtered after the fact. A foreign cycle identifier and an
unknown one therefore never become distinguishable through this endpoint.

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
   stale / not-scanned state, and the last refresh time when known.
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
- **Current with no cycles:** say that no stored cycles overlap the current scan
  window; do not claim the user has no astrological activity beyond that window.
- **Stale:** keep the latest facts visible, add a clear stale notice, and link to
  Today to prepare the current local day.
- **Not scanned:** explain that Timing has no persisted scan yet and link to
  Today. Do not offer an in-place refresh button.
- **Filtered empty:** retain filters and status, state that no persisted cycles
  match the selected filters, and offer a reset control.
- **Older deployment (`501`):** preserve the honest not-active message and
  request ID during rollout or rollback.
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
- validate the OpenAPI `200`, `400`, `401`, and `500` shapes; and
- prove `contracts/m0/` remains byte-for-byte unchanged.

### D1 and API

- current, stale, and not-scanned calculation status, including a current empty
  scan receipt;
- active and upcoming inclusion with completed rows excluded;
- phase recomputation at fixed instants for all five phases and a multi-pass
  retrograde cycle;
- exact duration-boundary behavior at 90 and 365 days;
- deterministic ordering and pass reconstruction;
- phase, upcoming, and duration filters plus duplicate/unknown query rejection;
- another user's cycles and passes never appear;
- malformed nullable instance fields, pass gaps, and count mismatches fail
  closed;
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

Production acceptance is separate from local verification:

1. make an authenticated unfiltered request and validate its 200 body against
   the new schema;
2. make phase and duration requests and verify their returned cycles obey the
   documented predicates;
3. use a second authenticated account and prove it receives only its own cycle
   IDs;
4. open the production Timing UI and confirm real cycle data, exact passes,
   status, filters, empty/stale handling, and responsive layout; and
5. confirm rollback readiness without changing D1, noting that Worker rollback
   never rewinds database data.

If the configured environment does not expose both authenticated test sessions,
stop at that acceptance gate and report the missing proof explicitly. Do not
manufacture users, extract credentials, or treat local ownership tests as
production evidence.
