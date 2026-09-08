# Slices 7 and 8: composed readiness, operational metrics, and runner fairness

Date: 2026-09-08

Status: specification for review; proposed states, metrics, and scheduling policy are not implemented.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Chapter/protocol compatibility: [Slice 6](2026-09-08-adaptive-observatory-contract-design.md). Slice 7 owns presentation/visibility; Slice 8 owns scheduling. They share work-class and timing definitions but can ship separately.

Source review: commit `6e706741f03253f2807d33380afb529161f3481f` and local files inspected on 2026-09-08. Queue demand, installed-runner identity, and production latency were not observed in this review.

## Current authority and decisions

[Pattern state](../../../apps/api/src/services/pattern-state.ts) already decides chart/locale/consent readiness, generation status, and whether an accepted Pattern remains readable during regeneration. Preserve that authority and the separate `regeneration` member of [M9](../../../packages/shared/src/m9-types.ts). Do not collapse a ready reading and failed replacement into a single failed-reading state.

The [runner poll loop](../../../apps/codex-runner/src/runner.ts) currently tries text first, then portraits only if text is empty, then meshes only if both are empty. With continuous text demand, optional classes have no polling opportunity. Its configured concurrency is one. Replace the ordering with bounded weighted rotation while keeping one job in flight and the existing domain-specific claim/execute/complete functions.

Use the shared work classes `text | portrait | mesh`. Text includes the existing Daily, Pattern, and ontology exchange jobs; this slice does not promise fairness among pipelines within that class or enable ontology work. A portrait/mesh job is one chapter job, not a whole reading. Increased chapter counts affect backlog size, not a job's budget or scheduling weight.

## Slice 7: reader state composition

Create a pure presentation selector whose inputs are the existing authorized birth/chart, Daily, Pattern/M9, and optional-asset responses. Its output is a client view model, not a new backend state machine or replacement wire enum. It contains independent availability for each reading, background-work status, optional-asset status, and typed next actions.

Use these closed presentation codes and fixed, localizable copy:

| Presentation | Required evidence | Next action |
| --- | --- | --- |
| `needs_input` | Actual chart/birth or confirmed-locale requirement | Open the corresponding existing correction/confirmation flow |
| `needs_permission` | Current service response requires the applicable consent | Open the existing explicit consent flow |
| `can_start` | Service reports generation available and eligible | Offer the existing generation action with its confirmation |
| `queued` / `working` | Actual job/stage response | Wait/refresh status; retain any already available reading |
| `ready` | Authorized accepted reading is available | Read the complete edition |
| `retryable_failure` | Backend explicitly permits retry for this operation | Offer that operation's existing guarded retry flow |
| `paused` | Explicit disabled/paused control or permission state | Explain the actual available settings/consent action; do not infer a pause from silence |
| `unavailable` | Missing, inaccessible, unsupported, or unreachable service/resource | Explain the closed reason and offer a status reload or valid return route |

An unavailable network observation is not proof of a failed backend job. A terminal failure with no permitted retry uses `unavailable` with a safe failure reason; it never grows a retry button from a guessed error category. A status reload only performs a read. Creating work, renewing consent, and retrying generation remain deliberate mutations through existing guarded endpoints.

The selector may combine `ready` text with `queued`, `working`, or failed regeneration/graphics. Show the reading first and explain the secondary work beside its own control. Source replacement, recall, account deletion, and current read-authorization rules still determine whether earlier content may be displayed. Consent withdrawal alone must not be invented as an erasure rule for an otherwise eligible accepted reading.

Use a closed action union: `open_birth_details`, `confirm_locale`, `review_consent`, `start_generation`, `retry_generation`, `read_edition`, and `reload_status`, each with the appropriate typed target. Resolve actions through the client's route registry and authoritative service eligibility; never accept executable URLs/HTML in a status payload. Preserve idempotency and recheck mutation eligibility server-side.

Keep cached observations scoped to account, chart, source revision, and request generation. Ignore late responses from a previous account or edition. If freshness cannot be established, hide mutation actions until refreshed. Source-specific links use [Slice 4's exact edition contract](2026-09-08-reader-relationships-feedback-design.md).

## Slice 7: operator metric contract

Add a proposed `GET /admin/runtime-health?purpose=incident_response` returning `runtime-health/v1`, under the existing [administrator authentication/session](../../../apps/api/src/middleware/admin-auth.ts) and purpose validation. Reuse the existing auditor role and allow `incident_response` only for this initial route. Record aggregate access without fabricating a generation or target-user ID. It is not authenticated by a reader session or runner token. Use `Cache-Control: no-store`; do not add these data to public `/health` or `/v1/meta`.

Keep this access record in an additive `runtime_health_access_events` table with event ID, authenticated admin subject, fixed purpose, `granted | denied | unavailable` result, and creation time. Apply the existing admin-audit retention/access rules. Admin identity belongs in this restricted audit record, not in the health response or general logs. Do not force these events into the generation-artifact access table by inventing a generation ID.

The response has `sampled_at` (server UTC), `schema_version`, and a fixed array of the three work classes. Each class has `observation: known | unavailable`, a closed observation reason, and the fields below. For an unavailable class, its measurement values are null rather than healthy-looking zeroes; other successfully observed classes remain available.

| Metric | Definition |
| --- | --- |
| `pending_count` | Rows in the domain's pending state, including scheduled retries |
| `scheduled_pending_count` | Pending rows whose `available_at` (text) or `retry_at` (image/mesh) is later than `sampled_at` |
| `dispatchable_pending_count` | Pending rows whose dispatch clock has arrived and whose stored attempt ceiling, where applicable, is not exhausted |
| `active_lease_count` | `leased` text or `running` asset rows with lease expiry after `sampled_at` |
| `expired_lease_count` | Those leased/running rows whose lease expiry has arrived; report separately from pending work |
| `failed_count`, `retry_exhausted_count` | Current terminal-failure inventory; exhaustion is a subset supported by an explicit attempt ceiling/failure code |
| `oldest_pending_age_ms` | `sampled_at - MIN(created_at)` across pending rows, or null if none |
| `oldest_dispatchable_pending_age_ms` | Same age restricted to dispatchable pending rows, or null if none |
| `completion_latency` | Last 24 hours' successful-job count, p50/p95 milliseconds from reservation to accepted completion, measurement start, and coverage status |

Here `dispatchable` means the stored schedule/attempt predicate, not a guarantee of grant, ownership, protocol compatibility, available provider budget, or a successful claim. Existing claim endpoints remain the authority for all those checks. Expired leases are not silently folded into pending counts; existing recovery may subsequently return them to pending or fail them. Disabled producers can still leave visible old work. API configuration alone cannot determine whether the installed runner has enabled a class; report that fact as unknown unless separately observed.

Use immutable reservation `created_at` as the age origin; retry/resume/lease recovery does not reset it. Ages and durations are integer milliseconds derived from the server clock. Invalid timestamps or impossible future reservations make the affected measurement unavailable with `invalid_timestamp`, rather than silently clamping it to zero. Empty queues have zero counts and null oldest ages. All fields in one class use one observation time and a consistent database read; report partial query failure explicitly.

[Text jobs](../../../apps/api/src/db/codex-provider-jobs.ts) have `completed_at`; restrict successful latency to status `completed`. Existing [image](../../../db/d1/0026_pattern_portraits.sql) and [mesh](../../../db/d1/0027_portrait_mesh_automation.sql) job tables have mutable `updated_at`, which is insufficient proof of historical completion time. Add nullable `completed_at` to those tables in an ordered additive migration, populate it in the guarded successful adoption transaction, and preserve it on idempotent completion. Do not backfill from `updated_at`. Historical rows without it remain outside the measured sample and are counted as missing timestamps in coverage.

Agree migration order with Slice 6: either its table reconstruction preserves these columns, or this additive migration follows that reconstruction. Apply required schema compatibility before deploying code that writes the new columns/audit table. A missing schema is an unavailable metric/adoption prerequisite, not an empty queue. This storage boundary is separate from the client presentation work.

Compute quantiles using nearest rank on successful durations in `[sampled_at - 24h, sampled_at]`, with `rank = ceil(p * n)` and no interpolation. No successes means null quantiles, not zero latency. Record a coverage start when capture is enabled; the first 24 hours remain partial. Cancelled/failed jobs are not successful latency samples. Accepted provider output and published reader content are different events: a completed text exchange does not certify publication or an entire reader lifecycle.

Track failed publication separately through existing durable generation/publication failure state, using only closed stage/reason counts and observation time. Prefer existing events to duplicate ledgers. If an event is not recorded, return `not_collected`; do not infer a failure count from arbitrary exception text. Validate needed indexes and bounded query plans with a synthetic backlog before release; historical latency aggregation must not become an unbounded scan on every reader request.

### Safe reporting and operational adoption

Status/log payloads use an allowlist: work class, fixed event/stage/failure code, integer counts/durations, protocol/policy identifiers, and timestamps. Never forward raw errors, provider output, prose, prompts, object keys, account/job/reading identifiers, or private chart facts. Unknown errors map to a fixed code. Log serialization must reject unexpected properties, truncate fixed-format diagnostic metadata, and remain safe with hostile error objects/getters.

Extend the runner's existing idle/processed/poll-failed events with work class and scheduling policy where appropriate; `processed` must not be renamed `succeeded`, because the domain operation may have handled a failure. A safe local completion event is diagnostic evidence, not proof of Worker adoption or publication. Correlate operational results through authorized records rather than adding private IDs to general logs.

Keep alert thresholds in a separate versioned runtime-health policy containing per-class pending-age limits, expired-lease persistence limits, consecutive-breach sample count, sampling interval, responder, and destination. Reject absent/nonpositive limits. No numeric production SLO is established by the source review: choose limits from a recorded baseline and provider timeout/work envelope before activation. A local synthetic threshold test is allowed before real delivery is configured; actual message delivery requires the applicable authorization.

Slice 7 has separate completion records for reader presentation, metric capture, and alert adoption. Operational closure requires named ownership, a configured policy/destination, and dated evidence that the intended signal was received and acted on. Missing alert ownership does not erase local engineering evidence and does not count as operational completion.

## Slice 8: weighted sequential scheduling

Adopt fixed policy `weighted-work-classes/v1` with circular slots:

```text
text, text, text, text, portrait, mesh
```

The cursor is process-local and persists across normal loop iterations, idle sleep, and nonfatal errors. Disabled optional classes are skipped without invoking their clients. Keep `CODEX_RUNNER_CONCURRENCY=1`; no prefetch, second lease, new budget, attempt increase, or automatic enabling of a work class is introduced.

One dispatch pass seeks at most one processed job:

1. Start at the persistent cursor and scan at most six slots. Consume/advance the cursor before awaiting a lane operation so an exception cannot reset priority to text.
2. Skip a disabled class, a class still in its error cooldown, or a class already observed empty/unavailable in this pass. This avoids polling an empty text queue four times in one idle scan.
3. Call that class's unchanged `runOne*` operation. On `processed`, end the pass immediately and start the next pass at the advanced cursor. On `empty`, mark the class empty for this pass and continue.
4. On a nonfatal thrown error, emit the safe poll-failed event, mark the class unavailable for this pass, and set its cooldown to the current monotonic time plus the existing jittered poll delay. Continue seeking work in other classes. Fatal runner errors still terminate the process.
5. If the pass found no processed job, sleep with the existing abortable jitter policy, shortened only to the next future class cooldown expiry if earlier. Use a positive delay and clear per-pass empty observations on the next pass. Preserve the cursor. Never busy-spin through an all-empty/all-cooldown schedule.

Check shutdown before every claim attempt and during idle sleep. Do not abandon a live lease or reinterpret an uncertain completion merely to advance the cursor. The existing domain operation remains responsible for its current execution timeout, renewals, guarded complete/fail, cancellation, and ambiguous network outcomes. Preserve the behavior where a transport error after completion might conceal successful adoption; scheduling must not manufacture a second conflicting failure.

With all three classes continuously dispatchable and returning processed work, every six processed dispatches give four text, one portrait, and one mesh opportunity. From any cursor, every continuously eligible class is offered a turn within six consumed slots, once earlier in-flight calls return. This is a bound on opportunities in a running process, not wall-clock completion time, token share, or a guarantee that all chapters of a reading finish. Longer jobs consume more elapsed time. Cooldown/disabled/ineligible classes are outside that interval until eligible again.

An unresponsive in-flight operation can delay every class until its existing timeout returns. Do not claim that this single-worker policy isolates hung providers, or introduce overlapping work to satisfy that claim. Repeated process crashes/restarts can also reset the cursor; durable cross-restart fairness and fairness within the text class are outside this slice. If measured operations require those properties, record them as further capacity work with independent lease/budget review.

### Slice 8 verification and release

Use deterministic fake clients, injected clock/sleep/randomness, and deferred operations. First reproduce the current starvation: continuous processed text yields zero image/mesh calls over a fixed observation window. Then retain a before/after trace of offered work classes, actual claims, processed outcomes, and elapsed simulated time. A synthetic observation is not a production backlog measurement.

Required cases are continuous three-class demand; every starting cursor; text plus each optional class; disabled classes; all queues empty; a class becoming nonempty after an idle pass; each class returning empty/throwing repeatedly; cooldown expiry; fatal error; shutdown before/after a claim; delayed execution; and ambiguous completion. Assert at most one domain operation is in flight, no empty-loop spin, unchanged attempt/budget requests, preserved fatal termination, and the six-slot opportunity bound under its stated assumptions. Existing API lease/duplicate-completion/cancellation tests remain necessary; scheduler fakes do not prove those transactions.

Run `npm run test -w @patternlike/codex-runner`, runner build, affected API claim/lease suites, and the full source-bound local gate. The implementation is a runner policy change and does not require a public API change or wait for Slice 7's dashboard. Install/restart only when authorized; retain installed artifact hash, effective enabled classes, policy identity, and dated observed progress before calling it adopted. Rollback restores the prior runner artifact and retains current jobs/leases; document that the old starvation behavior returns.

## Combined acceptance boundaries

Slice 7 must pass state/action tests for accepted reading plus failed regeneration, optional-asset failure, chart/locale/consent requirements, source changes, account switching, stale responses, and retry eligibility. Capture rendered narrow/wide, keyboard, fallback, and focus/reading-position behavior. Metric tests cover empty/delayed/expired/exhausted queues, retry age preservation, partial reads, timestamp/quantile boundaries, migration compatibility, completion replay, admin authorization/purpose, and hostile/private error redaction.

Slice 8 must prove its stated scheduling bound and preserve execution/lease/budget behavior. Slice 6 must negotiate compatible work before leasing it. These are complementary checks: a healthy metric endpoint does not prove fairness, a fair loop does not prove adoption, and a protocol-capable runner does not prove reader success. Each slice uses [Slice 2's release preflight](2026-09-08-release-preflight-design.md) for its own implementation merge and records subsequent operational evidence separately.
