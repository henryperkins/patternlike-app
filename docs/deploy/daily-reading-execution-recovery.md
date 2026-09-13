# Daily reading execution recovery

Unexpected Queue exceptions retain the operational `execution_error` result
class. The existing four-attempt job limit still applies. For V2 readings,
the scheduler and first-open recovery also admit terminal execution failures
to the existing bounded command replacement path.

`automaticReplacementReason` maps `execution_error` to the already supported
`publisher_unavailable` replacement reason. This describes recovery from an
unavailable publishing pipeline; it does not diagnose an upstream provider
failure. The failed predecessor job keeps `execution_error`, its attempts,
and its immutable command. The new command records the recovery decision.
Frozen M0 through M9 contracts and their manifest digests remain unchanged.

Replacement preserves the reading ID and local date and advances command
generation only through the existing three-generation cap. Consent,
ownership, rollout, and automatic local-day eligibility checks still apply.
Undecryptable payloads and configuration failures are not newly admitted.
This recovery policy does not fix an underlying execution defect; a persistent
defect can exhaust the same bounded replacement budget.

A retired policy pin is admitted for both command versions since 2026-09-13.
A command frozen by the previous Worker under an `assembly_policy_version`,
`selection_policy_version`, or identity profile this deployment no longer
registers fails `policy_unsupported`; waiting cannot make it executable, so the
scheduler and first-open recovery replace it through the same bounded path.
`automaticReplacementReason` maps that code onto `policy_upgraded` (V1) and
`publisher_superseded` (V2). `replaceFailedCommand` admits a scheduler-actor
replacement only when the requested reason equals what that mapping derives
from the terminal job's own `result_class`, so the scheduler can never apply
`policy_upgraded` to a day that failed for any other reason. The predecessor
keeps its exact `policy_unsupported` record.

After fixing the underlying execution defect, an operator can use
`POST /internal/readings/replace` with `user_id`, `reading_id`,
`actor: "operator"`, and `reason: "publisher_unavailable"`. Authenticate
with `SERVICE_AUTH_TOKEN`, and read the current reservation before submitting
a replacement. A `202 replaced` response establishes dispatch, not publication.
Confirm the successor job, provider state, and published reading separately.

Scheduler candidate exceptions now emit `scheduler_candidate_unprocessable`
with a closed `lane`, a closed `error_class`, and a random trace ID. Queue
`generation_threw` events include the same error category. For example,
`eval_error` identifies an `EvalError` without logging its message or stack.
Neither event includes candidate identifiers, private content, or raw errors.
