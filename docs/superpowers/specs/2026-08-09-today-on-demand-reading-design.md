# Today On-Demand Reading Design

**Date:** 2026-08-09

**Status:** Approved for implementation planning

**Scope:** Authenticated Today-page loading and the product API path that ensures the current local day's reading

## Goal

An authenticated reader who has an active chart, confirmed scheduling time zone,
confirmed content locale, and an active editorial release receives today's
reading by loading Today. The page starts generation itself when no published
reading exists, waits without requiring a button press, and replaces the
preparing state with the published reading as soon as the queue consumer commits
it.

The page-load path must not depend on a cron having run. Cron remains useful for
pre-generation, but it is not a correctness dependency for Today.

## Product invariant

Loading Today means “ensure and return my reading for the server-resolved current
local day,” not “look once and tell me to check again.” A healthy, fully
provisioned production system therefore has only these reader-visible outcomes:

1. the reading is returned immediately;
2. the reading is being prepared and appears automatically;
3. the reader must complete chart or preference setup; or
4. a genuine terminal or infrastructure failure is shown with a request ID.

`reading_not_generated` and the manual **Check again** state are not part of the
Today-page experience after this change.

## Chosen architecture

### Product API

Add an authenticated, idempotent `PUT /v1/readings/today` operation beside the
existing read-only `GET /v1/readings/today`.

`PUT` expresses the desired state: after the operation converges, today's
reading exists. It is safe to repeat because the existing reservation and job
keys already enforce one pending or published initial reading per user and local
day. The operation derives the user from authentication and the date from the
user's confirmed scheduling zone; it accepts no body, user ID, date, release, or
generation inputs.

The existing `GET` remains read-only and contract-compatible for clients that
only want to inspect publication state. Generation is not added as a side effect
of `GET`, avoiding browser prefetch, cache, and retry behavior unexpectedly
creating work.

### PUT responses

- `200 application/json`: the existing M3 `dailyReadingResponse` when a
  published reading already exists or becomes visible during a race.
- `202 application/json`: a new M3 preparation object:

  ```json
  {
    "schema_version": "0.3.0",
    "status": "preparing",
    "local_date": "2026-08-09"
  }
  ```

- `401`: existing `unauthorized` behavior.
- `404 chart_not_found`: onboarding is incomplete.
- `409 timezone_confirmation_required` or
  `locale_confirmation_required`: preserve the existing actionable preference
  flow, with time zone evaluated first.
- `503 release_not_active`, `calc_unavailable`, or `release_unreadable`: the
  deployment or an infrastructure dependency cannot currently produce the
  reading. The response uses the standard error envelope and request ID; it does
  not expose private command, job, chart, or release details.
- `424 reading_generation_failed`: a terminal generation result that cannot be
  repaired automatically. The server logs the stored result class and returns a
  generic reader-safe message plus request ID.

The new preparation object is defined in
`contracts/m3/daily-reading.schema.json`, represented in the M3 OpenAPI document,
covered by a valid fixture, and recorded in the M3 manifest. Nothing under
`contracts/m0/` changes.

## Server flow

Introduce a focused ensure service used by the PUT route. One call performs the
following sequence:

1. Load the authenticated user's preferences. Refuse unconfirmed time zone or
   locale using the existing error codes.
2. Resolve the current local date on the server.
3. Load the published reading for that user/date. If present, project and return
   the existing `dailyReadingResponse`.
4. Verify that an active chart exists. If not, return `chart_not_found`.
5. Inspect any initial reservation and its active generation job for that exact
   user/date.
6. If no reservation exists, call the existing immutable
   `enqueueDailyReading`. A successful reservation or a race reported as
   `duplicate` converges to `202 preparing` unless a fresh publication read now
   finds a `200`.
7. If the reservation is pending:
   - return `202` when its queued job is already dispatched or its running lease
     is still live;
   - redispatch only that reservation's queued job when it is due and
     `dispatched_at` is null;
   - redispatch only that reservation's running job when its lease has expired.
     The existing claim compare-and-swap absorbs duplicate delivery.
8. If the reservation failed with `calc_unavailable` or `release_unreadable`,
   invoke the existing `replaceFailedCommand(..., "scheduler")` path. Its
   command-generation budget and current-day guard remain authoritative. A
   successful replacement returns `202 preparing`.
9. If the automatic replacement budget is exhausted, or the stored result class
   is not one of those two infrastructure classes, return the terminal generic
   error. Do not rewrite the failed row and do not widen automatic-repair policy.

The ensure lookup is owner- and local-date-scoped. It does not call the existing
global sweep queries from a product request, so one reader cannot cause work for
other accounts.

The service awaits every D1 and Queue operation. It introduces no request-scoped
global state and no floating promise. Queue execution remains the only path that
decrypts the frozen command and publishes the reading.

## Client flow

`TodayView` calls a new `ensureTodayReading` client method on mount and after a
successful preference confirmation.

- A `200` renders the existing `TodayReading` unchanged.
- A `202` renders **Preparing your reading.** in the existing live-region notice
  and automatically repeats the PUT after an abortable delay.
- Polling starts at 500 ms and backs off through 1 s and 2 s to a 5 s cap. It
  continues while Today is mounted; there is no manual **Check again** gate.
- Leaving Today aborts both the active fetch and the pending delay. Returning to
  Today starts a fresh ensure loop.
- The accessible status text changes once when preparation begins and once if it
  is taking longer than 15 seconds; it does not announce every poll.
- `401`, chart setup, and both preference confirmations retain their current
  dedicated handling.
- A terminal or non-retryable infrastructure response stops polling and renders
  the existing retry control with the request ID. Pressing retry starts a fresh
  ensure loop.
- A network failure also stops the loop and uses the existing unreachable state;
  the UI never claims generation failed when it could not reach the API.

The old `not_generated` state and schedule copy are removed from `TodayView`.
`GET /v1/readings/today` and its `reading_not_generated` classifier remain for
other callers unless they become unused after implementation review.

## Concurrency and recovery

Concurrent tabs may all issue the PUT. They converge through the existing D1
reservation uniqueness and job idempotency keys. No tab owns the job, and closing
a tab does not cancel generation.

A crash between D1 reservation and Queue send leaves `dispatched_at` null; the
next PUT redispatches that exact job. A dead consumer leaves a running job with an
expired lease; the next PUT redispatches it. Duplicate sends are safe because
`claimJob` permits only one live claim.

The page does not create a new revision merely because it was loaded. Reissues
remain explicit trusted operations. Automatic failed-command replacement stays
limited to the two existing infrastructure reasons and the existing generation
budget.

## Content and production readiness

This change does not weaken the reviewed-content rule and does not add prose to
application code. A universal fallback still comes from the signed active
editorial release; it is a valid reading outcome for a day with no eligible
facts, not an emergency substitute for missing configuration.

Production deployment is not considered operationally complete until all of the
following separate gates pass:

1. `CONTENT_RELEASE_KEYS` is present in the production Worker binding using the
   repository's documented configuration;
2. a valid signed M3 editorial bundle has been ingested and activated;
3. one authenticated manual PUT returns `202`, the queue publishes the reading,
   and a later PUT/GET returns `200` with evidence;
4. duplicate PUTs create no second reservation, job, or publication; and
5. D1/R2 post-request safety checks show only the intended records and objects.

Authoring/signing production editorial content, deploying the Worker, changing
production bindings, ingesting a release, and enabling cron are distinct
operational authorizations. The code change prepares those gates but does not
perform them implicitly.

## Tests

### API integration

Add real D1/Queue integration coverage proving:

- published reading -> `200` with the existing schema;
- no reservation -> one reservation/job plus `202`;
- concurrent or repeated PUT -> one reservation/job;
- pending dispatched job -> `202` without another send;
- due undispatched job -> targeted redispatch;
- expired running lease -> targeted redispatch;
- retryable failed job -> bounded scheduler replacement;
- terminal failed job and exhausted budget -> reader-safe error;
- chart and preference gates preserve existing status/code ordering;
- no active release refuses before reservation;
- one user cannot inspect or redispatch another user's job; and
- unauthenticated PUT -> `401`.

### Web component

Add fake-timer tests proving:

- the first page-load request is `PUT /v1/readings/today`;
- `202`, then `200` automatically renders the reading without a click;
- repeated `202` responses follow the capped backoff;
- unmount aborts fetch and delay;
- preference save restarts the ensure loop;
- `200` does not poll;
- `401` escalates to the signed-out flow;
- terminal and network failures stop polling and retain a focused retry control;
  and
- the former **Check again** state and “not on demand” copy are absent.

### Full verification

Run focused API and web tests during TDD, then root `npm run typecheck`, root
`npm test`, root `npm run build`, and a production-environment Wrangler dry run.
Contract validation must prove `contracts/m0/` is byte-for-byte unchanged.

## Out of scope

- cron-trigger configuration or a `scheduled` handler;
- foreground device-time-zone synchronization beyond the existing confirmed
  preference flow;
- notifications;
- changes to reading assembly, ranking, evidence, or editorial prose;
- automatic repair of terminal policy/data failures;
- production deployment, secret/variable changes, release ingestion, or content
  authorship; and
- any M0 contract change.
