# Runtime health and scoped diagnostics

The read-only operator command runs on the repository's pinned Node 22, using the existing `tsx` dependency. Set `PATTERNLIKE_API_ORIGIN` to the HTTPS API origin and `CF_ACCESS_JWT_ASSERTION` to an existing administrator Access assertion through the local environment. Do not put credentials in command arguments or committed files.

```sh
npx tsx apps/api/scripts/runtime-health.ts aggregate
npx tsx apps/api/scripts/runtime-health.ts pattern pgen_0123456789abcdef0123456789abcdef incident_response
```

The aggregate command makes one GET to `/admin/runtime-health?purpose=incident_response`, prints the server's counts, reservation ages, accepted-completion quantiles, measurement coverage and durable publication-safety failure inventory, and shows uncollected observations explicitly. It does not accept generation identifiers. Dispatchable work meets stored scheduling and attempt predicates; actual claims still check their own authority. Accepted provider output does not certify published reader content. Installed runner enablement and operational alert adoption remain unknown/unconfigured.

Pattern inspection requires an explicitly supplied generation identifier and exactly one existing administrator purpose: `quality_review`, `safety_investigation`, `incident_response`, or `retention_audit`. Its GET uses the separate additive `/admin/pattern-generations/{generation_id}/diagnostics` endpoint. Existing Cloudflare Access role/session checks apply; every successful or missing-record read is audited against the exact generation with an empty artifact-class list. Audit failure returns no facts. Responses, including authorization errors, use `Cache-Control: no-store`. Health permission does not establish a right to inspect an arbitrary workflow. Treat the scoped command's terminal output as private inspection material.

This route projects one Pattern reservation and the matching current provider pass, stage generation and attempt. It never reads encrypted commands, provider exchanges, or artifact bodies, and does not search an owner's history. A missing provider coordinate is uncollected evidence. Stored attempts and schedule clocks are facts, not retry authority. Closed durable validation failures can identify validation; `publication_safety_failed` can identify publication. The public `checking_claims` label alone cannot distinguish validation, semantic verification, or publication. Transient publication commit/authorization retry reasons are not durably stored and remain uncollected. A historical `succeeded` transition does not establish present reader access after lifecycle changes.

The presentation separates permission/admission, reservation, runner execution, validation and publication. Permission/admission is uncollected under this projection; scoped Daily, ontology, portrait and mesh diagnostics are unsupported. Missing, unauthorized, stale, malformed and contradictory snapshots do not assert a blocker. Observation age is based on the fetch timestamp; source age uses actual `updated_at`, never `created_at`. The five-minute presentation freshness limit only controls the interpretation of cached observations and is not an operational latency SLO.

A visible recovery suggestion is only `reload_status`, with `read_only` authority. It performs no repair, force release, consent renewal or generation retry. Any such action still belongs to its existing domain service and authorization flow. Pattern's `first_open_retry` and `failed_attempt_retry` reservation metadata identify retry origin. Other reservations show unknown retry origin; `revision_reason` is separately uncollected. Daily automatic command replacement cannot be diagnosed from this Pattern scope, including cases that preserve `revision_reason: initial`.

## Safe reporting boundary

Runner stdout now passes every event through `serializeRunnerLogEvent`: only exact lifecycle/idle/processed/poll-failed events, work classes, the compiled scheduling policy and a valid timestamp survive. Private extras, errors, accessor properties, symbols, unexpected prototypes, proxies and serialization hooks become a fixed `codex_runner_log_rejected` event. `job_processed` stays distinct from success. The newly added aggregate parser rejects unknown fields at all levels. This work does not claim to harden every pre-existing API logging call.

## Inactive alert policy

`runtime-health-policy/v1` is a separate strict policy contract. It requires positive safe-integer per-class pending-age and expired-lease-persistence limits, sampling interval and consecutive count, plus explicit responder, destination, baseline and provider-work-envelope references. There are no numeric production defaults. The committed `runtime-health-policy.synthetic.json` fixture is synthetic local test data and is not production configuration.

The pure evaluator produces safe event candidates only. Pending-age streaks and expired-lease persistence are separate conditions. Unknown observations break continuous evidence; gaps restart streaks, duplicate/reversed timestamps are discarded, and a changed policy ID invalidates prior evidence. Use a new immutable policy ID when changing a policy's contents. Responder/destination references never enter candidate payloads. No timer, alert sender, installed-runner restart or provider mutation is configured.

Local tests establish projection, authorization and synthetic policy behavior. Human time-to-diagnosis, human recovery completion and production incident performance remain unmeasured. Operational alert closure still requires a baseline-derived policy, named responder, configured destination and dated evidence that the signal was received and acted on. Record any automated diagnostic timings separately as synthetic harness evidence.
