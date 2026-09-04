# Birth calculation SLO and asynchronous-workflow entry criteria

**Created:** 2026-08-27

**Status:** Thresholds and the measurement procedure below are decided. **No
measurement has been taken.** The guards they measure — the bounded calc
transport, the per-user UTC-day invocation budget, and the two telemetry events
— are deployed on `patternlike-api-production` as Worker version
`287bce63-dece-4911-96db-dd212c2cec33` (2026-08-27T06:36:13Z). Migration
`0016_birth_calc_usage.sql` is applied to the remote database. This file records
what would justify building the asynchronous birth workflow. It does not
authorize a configuration change or the asynchronous implementation itself.

Everything below that describes configuration or telemetry describes
**repository evidence, not unqueried live state.** Where a claim is about the
live account, the preconditions section says how to verify it.

**Companion artifacts:**

- implementation plan:
  `docs/superpowers/plans/2026-08-26-birth-operational-guards.md`
- umbrella plan:
  `docs/superpowers/plans/2026-08-26-p0-p1-hardening-and-core-loop.md`
- deferred workstream:
  `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md` § Stream 8

---

## The decision this document defers

`POST /v1/birth-profiles` answers `202` with a job id, but the Swiss Ephemeris
call runs **inline** inside the request. The `jobs` row is written `running`,
the calc round trip happens, and the row reaches `succeeded` or `failed` before
the response is written — the success body even carries `status: "succeeded"`,
not `"accepted"`. The `202` is vestigial.

Nothing on that path is queued. `apps/api/wrangler.toml` declares no
`[[workflows]]` block, and none of its four queues (`READING_QUEUE`,
`PRIVACY_QUEUE`, `PATTERN_QUEUE`, `ONTOLOGY_PIPELINE_QUEUE`) is a birth queue.
`jobs.available_at` is never written by the birth route; `jobs.attempts` is used
only as an optimistic-concurrency token and as an input to the reservation hash,
never as a backoff counter. The web client compensates by polling
`GET /v1/chart` at most five times at a fixed 700 ms interval
(`apps/web/src/App.tsx:269-292`) — every iteration waits, including the last, so
worst case is 3.5 s of waiting before it gives up with "not ready yet".

Turning that into a real asynchronous workflow means a queue, a durable state
machine, a client contract that replaces the poll, and a second place where a
birth can fail. That is a design, not a patch. **It is deferred until one of the
triggers below is measured in production.** Until then the synchronous path is
bounded instead: a hard deadline on the transport and a hard ceiling on how many
times one account can pay for a calculation per UTC day.

---

## What is emitted

Two closed events, both from `apps/api/src/services/safe-log.ts`. Neither can
carry a birth field, coordinate, place label, upstream message, URL, or stack —
every arm of `SafeLogEvent` projects named fields and the switch never spreads
its input. `safe-log.test.ts:345-398` proves it by feeding a hostile object and
asserting the emitted key set exactly (`:369` and `:396`).

| Event | Console level | Emitted fields |
| --- | --- | --- |
| `birth_calc_completed` | `console.info` | `trace_id`, `outcome`, `latency_ms`, `timeout_ms` |
| `birth_calc_budget_exhausted` | `console.warn` | `trace_id`, `daily_limit` |

> **These events carry no user, job, chart, or request identifier.** `trace_id`
> is minted per `safeLog` call and discarded by both call sites, so it
> correlates nothing. **No rate below can be sliced by user, and no event can be
> joined to an HTTP status.** Every figure in a review is computed from event
> counts and `latency_ms` alone. If a future investigation needs per-user
> attribution, that is a telemetry change with its own privacy review — do not
> improvise one during an incident.

Both are logged as `console.<method>(<event name>, { …fields })`, so **the event
name is a positional message token, not a field called `event`**. Queries filter
on the message for the event name and on fields for `outcome` and `latency_ms`.

### `outcome`

Exactly four literals, derived at `apps/api/src/routes/birth.ts:760-766`:

| `outcome` | Set when |
| --- | --- |
| `timeout` | `CalcInvocation.timedOut` — the request's `AbortSignal` had fired |
| `success` | not timed out and calc returned `ok: true` |
| `invalid_input` | calc returned `error_class: "invalid_birth_profile"` |
| `upstream_failure` | any other calc refusal, including a non-abort transport error |

Three things this mapping does **not** mean:

- **`success` is not "the caller got a chart."** The branch tests `calc.ok`
  alone. A response with `ok: true` and `chart: null` is logged `success` and
  then fails the very next check (`if (!calc.ok || !calc.chart)`), returning
  `502`. The same is true further downstream: a `409 chart_already_exists` or a
  `503 pattern_invalidation_failed` both follow a `success` event. Treat
  `success` as "calc answered affirmatively", which is the right population for
  a latency percentile and the wrong one for a user-facing success rate.
- **`timedOut` short-circuits everything.** A timeout is always `timeout`, never
  `upstream_failure`, even though its `error_class` is `calc_transport_error`.
- **`upstream_failure` is a wide bucket.** A connection reset, a DNS failure, a
  non-2xx body that will not parse, a missing body, a 1 MiB overflow, and an
  unset `CALC_SERVICE_URL` all land here. So does every calc-stub refusal that
  is not `invalid_birth_profile`. From `/v1/calculate` those are `calc_error`
  (the engine's catch-all, and the one an investigator is most likely to find
  in `jobs.result_class`), `bad_request`, `unauthorized`, and
  `service_auth_not_configured`. `calculation_failed` is **not** among them — it
  belongs to `/v1/daily-sky` and `/v1/cycles` and cannot reach the birth path.

  One signature is worth recognising: **`upstream_failure` at a `latency_ms`
  near zero means `CALC_SERVICE_URL` is unset.** `configGuard` does not check
  that variable, so it is a live production failure mode rather than a startup
  one.

**The event carries no failure reason.** The only durable record of *why* a 502
happened is `jobs.result_class`, written on the same request. A review that
finds an `upstream_failure` spike must go to D1 for the class.

### `latency_ms`

The whole `invokeCalc` round trip measured with `performance.now()` — request
serialization, fetch, the bounded body read, and `JSON.parse` — rounded and
clamped to a non-negative integer. It is not network time alone.

The deadline covers the body read as well as the connection, so a timed-out
invocation reports a `latency_ms` **at or slightly above** `timeout_ms` rather
than exactly at it. `timeout_ms` is the resolved integer in force for that
request, not the raw configured string.

### The denominator

One `birth_calc_completed` is emitted per **actual** `/v1/calculate`
invocation, immediately after `invokeCalc` returns
(`apps/api/src/routes/birth.ts:767-772`). It sits after the reservation commit,
the claim-winner check, and the durable-job check. Everything below returns
earlier and emits nothing:

- missing or invalid `Idempotency-Key`, unparseable body, failed request
  validation
- replays of a `succeeded`, `queued`, or `running` job
- an existing job in a state that is none of those (`409 idempotency_conflict`)
- a failed-job retry whose decrypted birth command disagrees with the submitted
  one (`409 idempotency_conflict`)
- a failed job whose stored command predates `birth-calc-command/v1`
  (`409 idempotency_conflict`)
- a unique-constraint race on the commit batch, which returns the existing job
- the losing side of a concurrent claim on one attempt coordinate
- a charged, claim-winning request whose post-commit job re-read disagrees on
  id, status, attempts, or profile version, which returns the existing job
- a failed-job retry whose stored command claims `v1` but does not parse, which
  is internal corruption and reaches the generic 500 boundary
- budget denials, which emit `birth_calc_budget_exhausted` instead

So `count(birth_calc_completed)` is exactly: **requests that were charged a
budget unit, won their claim, and reached the calc transport.** That is the
right denominator for a timeout rate and the right population for a latency
percentile. It is **not** the request count for `POST /v1/birth-profiles`.

The two events have **disjoint denominators** — charged attempts versus denied
ones. Their sum is neither the POST count nor the number of requests that
reached the reservation: a concurrent claim loser reaches the reservation, is
not charged, and emits nothing at all. Never mix the two into one ratio.

---

## Configuration under measurement

| Variable | Value in both var blocks | Accepted range | Default |
| --- | --- | --- | --- |
| `CALC_FETCH_TIMEOUT_MS` | `"10000"` | 1,000–30,000 inclusive, integer | 10,000 |
| `BIRTH_CALC_DAILY_LIMIT` | `"5"` | 1–50 inclusive, integer | 5 |

Parsing is strict `/^\d+$/` plus `Number.isSafeInteger`, so `"10_000"`, `"1e4"`,
`" 10000"`, `"10.0"`, `"-1"`, and `""` are all rejected. The defaults apply
**only** when the variable is absent *and* `ENVIRONMENT` is `development` or
`test`.

Two details that matter when reading a 503:

- **A malformed value fails closed in development too.** `checkSecureConfig`
  validates the pair *before* the development short-circuit whenever either
  variable is present. Only the both-absent case is deferred past that
  short-circuit, which is what makes absence tolerable locally and fatal in
  production. Setting one and omitting the other is still fine in development —
  the resolver defaults each variable independently — and fails in production,
  where nothing is defaulted.
- **The client never sees `birth_operational_config_invalid`.** `configGuard`
  returns `503` with code `configuration_error`, and logs
  `insecure_configuration` with `config_code: "birth_operational_config_invalid"`.
  An operator diagnosing a blanket 503 must correlate to that log line.

**Any review that reports a percentile must record the `timeout_ms` value the
events carried**, not the value in `wrangler.toml` at review time. The event
carries the deadline that was actually in force; the file may have moved since.

---

## Entry criteria

Crossing **any** row opens a separate asynchronous-workflow design. It does not
authorize implementation by itself — it authorizes the design task.

| Signal | Window | Trigger |
| --- | --- | --- |
| Successful calc p95 latency | rolling 7 days | `>= 8,000 ms` for 3 consecutive UTC days |
| Calc timeout rate | rolling 24 hours, at least 100 attempts | `>= 1%` |
| Successful calc p99 latency | rolling 7 days | `>= 9,000 ms` |
| Worker termination correlated with the birth route | any | one confirmed production event |

Read precisely:

- **p95 and p99 are computed over `outcome: "success"` only.** A timeout sits at
  the deadline and an `invalid_input` refusal returns fast; including either
  moves the percentile for reasons a queue would not fix. Remember that
  `success` here means calc answered `ok: true`, not that a chart reached the
  reader.
- The p95 row needs the rolling-7-day p95 at or above 8,000 ms **on three
  consecutive UTC days** — three daily readings of a 7-day window, not one
  reading of a 3-day window.
- The timeout rate is
  `count(outcome = "timeout") / count(birth_calc_completed)` over 24 hours, and
  is only meaningful at **100 or more** attempts in that window. Below that,
  record the count and take no action; two timeouts out of nine is noise, not a
  1% breach. The count is exact rather than estimated because head sampling is
  1 — see the preconditions.
- 8,000 ms and 9,000 ms are deliberately below the 10,000 ms deadline. A
  percentile that has already reached the deadline *is* the timeout rate, not a
  latency signal, and by then readers are already failing.
- "Worker termination correlated with the birth route" means one confirmed
  **Exceeded resources** invocation status (Workers error `1102`/`1027`,
  GraphQL `exceededResources`, shown in the dashboard under **Metrics** >
  **Errors** > **Invocation Statuses**) on an invocation that reached
  `POST /v1/birth-profiles`. One is enough, and no timeout change tunes it away.

  Read it correctly: **waiting on the calc `fetch` does not accrue CPU time.**
  This signal is not "the calc was slow". It is the Worker's own work on this
  path — envelope encryption, the guarded D1 batches, chart and aspect
  persistence, feature derivation — running out of budget inside a request that
  is also holding a calc round trip open. That is exactly the failure a queue
  fixes, by giving the work its own invocation instead of sharing one with the
  request.

  Because the events carry no request id, correlating a termination to this
  route is a dashboard exercise on invocation metadata, not a log join. Record
  how the correlation was established.

### What is not a trigger

- **A high `birth_calc_budget_exhausted` rate.** It says five authorized
  calculations a day was the wrong product number, or that one account is being
  abused. Either way the remedy is an abuse and product review that may change
  `BIRTH_CALC_DAILY_LIMIT`; a queue would not reduce the spend the limit exists
  to bound. Do not cite it in an async decision.
- **`invalid_input` volume.** That is onboarding validation quality, and those
  requests are already refused fast.
- **`upstream_failure` volume that is not timeouts.** That is calc service
  health, transport, or configuration — addressed on Fly or in the binding, not
  by moving the call off the request path. Check `jobs.result_class` and the
  near-zero-latency signature before concluding anything.
- **Aggregate p50.** A median under a 10-second deadline says nothing about the
  tail that terminates Workers.

---

## Measurement procedure

### Preconditions — verify before trusting any number

Run these in order. If any fails, the review records "not measurable" and no
threshold is evaluated.

1. **The guards are deployed.** The reviewed Worker version must contain
   `birth_calc_completed`. Record the version id:

   ```bash
   npx wrangler deployments list --config apps/api/wrangler.toml --env production
   ```

2. **Migration `0016` is applied remotely.** Without `birth_calc_daily_usage`,
   `birth_calc_reservations`, and `birth_profile_version_counters` the route
   cannot reserve an attempt and the budget guard does not exist:

   ```bash
   npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
   ```

3. **The events are reaching Workers Logs.** `apps/api/wrangler.toml` declares
   `[env.production.observability.logs]` with `enabled = true`,
   `head_sampling_rate = 1`, `persist = true`, and `invocation_logs = true`. The
   parent `[env.production.observability]` carries `enabled = false` **by
   design**: the nested `logs` and `traces` tables govern their own signals, so
   logs are on and traces are off. That is the repository's intent, and the
   repository also claims it mirrors live settings — **a claim, not a
   verification.** Search the Workers Logs dashboard for one
   `birth_calc_completed` event and confirm it is present. If none appears after
   a known invocation, the observability configuration is the finding and every
   threshold below is unmeasurable until it is fixed.
4. **Head sampling is still 1.** At 1 there is no sampling loss, so event counts
   are exact and the "at least 100 attempts" minimum means what it says. Any
   lower value makes a rate valid and a raw count meaningless. Record the value
   in force.

5. **The account's retention covers a 7-day window.** On a 3-day retention both
   7-day triggers are structurally unevaluable, and the daily ledger below
   cannot reconstruct them after the fact. Record that as the finding rather
   than substituting a shorter window.

Because observability is uploaded as Worker metadata, `npm run deploy:api`
reasserts this block on every deploy and a dashboard-side toggle is silently
reset. Change it in `wrangler.toml` or not at all.

### Query surface

`apps/api/wrangler.toml` declares **no Analytics Engine binding, no Logpush
configuration, no tail consumer, and no OpenTelemetry destination** in either
environment, and `[env.production.observability.traces]` is `enabled = false`.
An account-side Logpush job would not appear in this repository, so confirm the
account before asserting one does not exist. On the repository's evidence the
surfaces are:

- the **Workers Observability dashboard** (Investigate / Query Builder), which
  filters on the message token `birth_calc_completed` and on the `outcome` and
  `latency_ms` fields, and groups by `outcome`;
- the **Workers observability REST API** (list telemetry keys, run a query, list
  a key's unique values), for scripted extraction;
- `npx wrangler tail --config apps/api/wrangler.toml --env production --format json`
  for live observation only. Tail is not a history and cannot answer a 7-day
  percentile.

**There is no columnar analytics store, so do not assume a percentile is a
one-click aggregate.** If the Query Builder offers a percentile aggregation over
`latency_ms`, use it and record the exact query. If it does not, export the
matching log lines for the window and compute p95/p99 offline. Either way the
review records the method, not just the number — two reviews that computed a
percentile differently are not comparable.

### Per-review steps

1. Filter to the event name `birth_calc_completed` for the window.
2. Group by `outcome` and record all four counts. These four numbers are the
   review's primary record.
3. Compute the timeout rate as `timeout / (sum of the four)`. Record the
   denominator; under 100 for a 24-hour window, mark the row "insufficient
   volume" and take no action.
4. Restrict to `outcome = "success"` and compute p95 and p99 over `latency_ms`.
   Record how they were computed.
5. Separately count `birth_calc_budget_exhausted` and record `daily_limit`. It
   is context for a product review, not an input to the async decision.
6. Record the query interval in UTC, the Worker version id, the `timeout_ms`
   carried on the events, and the head sampling rate.

### The retention constraint on a 7-day window

**Workers Logs retention is plan-dependent — at most 7 days on Workers Paid and
3 on Free.** That is an external Cloudflare limit; confirm it and the account's
plan as precondition 5 rather than taking this line's word for it. Two of the
four triggers are defined over a rolling 7-day window, which sits exactly at the
Paid ceiling — and the p95 trigger needs three consecutive daily readings of a
7-day window, spanning 9 days of underlying data. **That cannot be reconstructed
retroactively.**

So the p95 trigger is only evaluable if the daily reading is taken and written
down while the data is still in retention. **Append one row to the ledger below
every UTC day the birth route serves production traffic**, from the day the
guards are deployed. A gap in that ledger is a gap in the evidence: a missing
day resets the "3 consecutive days" count rather than being assumed below
threshold.

If the daily-snapshot discipline proves unsustainable, the correct fix is to
export these events off-platform (Logpush or an OTLP exporter to a retained
store) — not to weaken the trigger. Record that as a finding rather than
silently substituting a shorter window.

---

## Review record format

One row per UTC day. `n` is the total `birth_calc_completed` count for that day;
percentiles are over `outcome = "success"` across the trailing 7 days ending
that day.

```text
| UTC date | worker version | timeout_ms | sampling | n | success | invalid_input | upstream_failure | timeout | timeout rate | p95 (7d) | p99 (7d) | 429s | notes |
```

Every row must be filled from a query, not inferred. A day with no traffic is
recorded as `n = 0` with empty percentiles — not omitted, because an omitted day
is indistinguishable from an unmeasured one.

## Review ledger

| UTC date | worker version | timeout_ms | sampling | n | success | invalid_input | upstream_failure | timeout | timeout rate | p95 (7d) | p99 (7d) | 429s | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

*No rows. The guards are deployed and migration `0016` is applied remotely, but
no production birth calculation has been measured under them yet.*

---

## If a trigger fires

1. Record the crossing row in the ledger with the query that produced it and the
   method used to compute the percentile.
2. Confirm it is not a calc-service incident: check
   `https://patternlike-calc.fly.dev/health` and the Fly machine state for the
   window. A single degraded machine is an incident, not a design signal.
3. Confirm it is not a `CALC_FETCH_TIMEOUT_MS` change: compare the `timeout_ms`
   carried on the events across the window. A lowered deadline manufactures
   timeouts.
4. Consider turning traces on before committing to a design.
   `[env.production.observability.traces] enabled = true` is a one-line change
   and gives calc round-trip latency attribution that these two events cannot —
   which sub-step of the request is actually slow. That is cheap evidence to
   have in hand when the design starts.
5. Open a design task under `docs/superpowers/plans/`, citing the ledger rows.
   Reopen Stream 8 in
   `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md`.
6. Leave the synchronous path in place until that design is reviewed. The
   bounded transport and the budget guard remain correct behaviour under load;
   they are not a temporary shim to be removed on the first slow day.

---

## Operator notes that are not triggers

Three behaviours that will look like defects to someone reading production state
for the first time. None of them is a signal about the async decision.

- **A `429` skips a profile version number.** Version allocation runs before the
  budget decision, so a denied request advances
  `birth_profile_version_counters.last_allocated_version` while writing no
  `birth_profiles` row. Versions are opaque and monotonic, not dense; a gap is
  not data loss.
- **Failed-job retries have no ceiling and no backoff.** Nothing schedules a
  retry and there is no maximum-attempts limit. A caller may retry a failed job
  repeatedly, each retry charging one budget unit, bounded only by
  `BIRTH_CALC_DAILY_LIMIT`. The daily limit is the only backstop.
- **Reservation rows are pruned lazily, per user.** The 35-day window
  (`RETAINED_UTC_DAYS`, inclusive of today) lives in TypeScript, not in the
  migration, and the two `DELETE` statements ride the same batch as a new
  reservation. **A user who stops submitting birth profiles is never pruned.**
  No cron or queue consumer touches these tables. Row counts are therefore a
  function of activity, not of time.

## What this document does not cover

- The asynchronous design itself — queue topology, the job state machine, the
  client contract that replaces the five-poll loop, and how a birth failure is
  surfaced after the response has already been sent.
- `BIRTH_CALC_DAILY_LIMIT` as a product number. Five per account per UTC day is
  a spend ceiling chosen to bound abuse, not a researched usage limit. Changing
  it is a product and abuse decision recorded elsewhere.
- The client's handling of `429`. The web client reads neither `Retry-After` nor
  `details.resets_at` and surfaces a generic error; that is a known onboarding
  UX gap, tracked with the onboarding workstream rather than here.
- Calc service capacity planning on Fly.
