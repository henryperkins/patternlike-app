# Reversible Pattern generation pause

`PATTERN_GENERATION_ENABLED` is the Worker control for pausing generation for
every account. It changes no account cohort, consent, model pin, ontology,
accepted document, or database schema.

| Worker value | Behavior |
| --- | --- |
| `1` | Permit eligible generation, provider claims and publication. |
| `0` | Pause new generation, provider claims, stage execution and publication. |
| Absent | Preserve the enabled behavior of Workers predating this control. |
| Any other value, including empty | Configuration error; direct service checks also fail closed. |

Both development and production Wrangler blocks explicitly declare `1`.
Keep the flag in the correct environment: Cloudflare does not inherit variables
from the top-level configuration into a named environment. See the
[Workers environment variable documentation](https://developers.cloudflare.com/workers/configuration/environment-variables/).
Existing publisher configuration and keys remain required; removing them is
not the pause mechanism.

## What a pause preserves

New first-open, retry, chart-correction and source-update reservations return
`503 pattern_generation_paused` before creating a grant, claim, job or artifact.
Replaying an existing idempotency key still returns its stored reservation.
Accepted Pattern reads and exports, generation-status reads, consent withdrawal,
Pattern deletion, account deletion, ontology recall and artifact cleanup retain
their normal authorization and lifecycle rules. Retry and regeneration
eligibility are false while paused. Daily and ontology provider claims continue.

Queue deliveries park eligible queued work using the existing generic job's
`result_class = 'pattern_generation_paused'`. They are acknowledged without
advancing the domain stage or any provider attempt counter. Existing backoff is
preserved. A pause never takes another executor's lease or resets an exhausted
expired lease into the queued lane. The normal expired-lease recovery applies
again after resume. The Pattern sweep and operator reconcile do not dispatch
while paused, including historical `rollout_paused` rows.

A runner may already hold a leased invocation when the pause takes effect.
Its valid completion can still be saved as an encrypted provider artifact under
the existing lease and source checks. Saving that receipt does not publish a
Pattern: provider nudges, domain adoption and publication remain paused. A
matching completed receipt remains available to its current owner; resume
adopts it instead of spending another provider call. Existing failure receipts
are retained in the same way. A stale, withdrawn, deleted or obsolete source
does not become current merely because the switch is re-enabled.

If an unfinished runner lease expires, the pending or expired provider job is
not claimed during the pause. On resume it may receive a fresh lease and spend
another call under the ordinary daily ceiling. The old lease token cannot
complete that new lease. Pausing cannot recover model output that the runner
never committed.

Artifact retention is not extended by pausing. If required domain artifacts or
their keys expire during a long pause, cleanup still erases them. A resumed
generation that needs erased material fails safely without publishing; an
eligible reader may start a fresh attempt after resume. Paused completed
provider artifacts remain subject to the existing rule retaining results still
needed by a current owner. Invalid owners continue through stale cancellation
and the ordinary cleanup path.

## Pause and resume procedure

1. Record the current Worker version, traffic allocation, runner identity,
   source fingerprint, flag and nonterminal Pattern/provider counts. Retain the
   normal publisher pins and secrets.
2. For an authorized pause, set the production flag to `0` and deploy the
   verified Worker version with that value. Ensure the next Workers Build will
   preserve the intended value rather than restoring a temporary override.
3. Verify that all new request and queue traffic uses the paused version.
   Observe a new Pattern reservation refused, no new Pattern provider claims,
   no new Pattern publication, and accepted reading access plus a separately
   authorized lifecycle operation still working.
4. Allow old-version Worker invocations to finish and inspect their outcomes.
   Worker environment variables are version-bound; deploying this flag is not
   an instantaneous global database fence and cannot retract an invocation
   already handed to a runner. Do not declare a completed pause from one HTTP
   response or from a runner process merely appearing stopped.
5. To resume, deploy the verified compatible Worker with the flag set to `1`
   and confirm traffic allocation. The bounded maintenance sweep returns up to
   50 jobs from each pause class to the outbox and repairs valid terminal
   provider nudges. Operator reconcile can also nudge a nonterminal job.
6. Observe actual domain outcomes. Execution rechecks the frozen source,
   consent, active account, chart, locale, ontology and claim ownership before
   using artifacts or publishing. Source-update work must still own the pending
   regeneration of an accepted document. Cancelled and terminal jobs are never
   reopened. A source-changing deployment may cancel old queued work instead
   of resuming it; retry creates a new command against the current source.

An environment change is an operational deployment requiring its own current
version, allocation and account evidence. The local regressions do not claim
that production has been paused or resumed.

## Local verification

`apps/api/src/services/pattern-generation-control.integration.test.ts` exercises
admission, repeated queue parking, live and expired leases, provider completion
retention and adoption, the final publication boundary, cleanup, accepted reads,
consent withdrawal, deletion, and stale-source/claim cancellation. Provider DB,
adapter, queue and configuration suites cover the shared claim selector and
compatibility defaults. Run the final repository `npm run ci:local` gate after
source fingerprint generation; this document does not substitute for that gate
or for deployed observations.
