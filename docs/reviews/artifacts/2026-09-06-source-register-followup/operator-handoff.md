# Operator handoff

This follow-up prepared and checked local tools and a standalone runner
candidate. The production runner was not replaced. The authenticated lifecycle,
independent human review, account-owner evidence, usage collection, and alert
delivery remain open. This document is an execution sequence, not a receipt
that those actions occurred.

## 1. Resolve the quality findings without weakening acceptance rules

1. Retain `daily-04`, `pattern-generation-01` and `verifier-02` as failed runs.
   Their private samples are under the service-owned directory
   `/tmp/patternlike-source-register-eval-20260906/output`. Selectively give the
   designated reviewer access to the fictional samples; keep prompts and output
   out of ordinary logs and repository evidence.
2. Adjudicate `exact_control-1` before modifying its expected verdict. Check
   the birth-time constraint and every dependency of the cited synthesis against
   the supplied fact packet. Record the reviewer's identity, input/output hashes,
   decision, rationale, and any versioned fixture correction. A second model
   opinion does not satisfy independent human editorial certification.
3. Reproduce the Daily unknown-ID failure and the Pattern 596/572-word chapter
   failures through the existing bounded correction paths. Keep citation and
   550-word checks. The new chain harness intentionally measures first attempts;
   it must not be described as a measurement of the complete retrying Worker.
4. Before adjusting the prohibited-claim matcher, add the minimal negative,
   affirmative and compound controls from `negation-diagnostic.json`. Limit
   the change to the supported negation grammar; preserve rejection of real
   guarantees and later harmful clauses. Treat a production safety-policy change
   as a versioned source change and run its regressions and `npm run ci:local`.
5. Freeze the resulting source and obtain new bounded provider samples. Use a
   new destination for each run; never replace retained failures. The complete
   Pattern generation command is:

   ```bash
   node scripts/pattern-release/fresh-pattern-evaluation.mjs run /PRIVATE/NEW-RUN /ABSOLUTE/PINNED/CODEX
   ```

   This command makes at most six new calls from two fictional packets, with
   fresh planner/writer/verifier outputs and no stage retry. Run it under the
   already authenticated service account in an access-controlled source copy.
   Do not move that account's credentials into the application checkout.

## 2. Activate and exercise the runner candidate

The candidate package is
`/tmp/patternlike-source-register-runner-candidate-20260906`. Its main bundle
SHA-256 is `edb25e3ce62a69f30d86b50eb3ce1c85b869938ed54d81aedd01d7650fedbf4c`.
The observed installed main bundle is
`3a0139ae4268e03652ab55f5945dab41c0c4e70515cc92e847cf24a81586b708`.
See `standalone-runner-candidate.json` for all package hashes and the successful
Node 22/24 standalone import and native dependency checks.

Before activation, verify the final aggregate receipt and resolve or explicitly
track the quality findings above. Recheck the current installed hash and
provider/owner job state; the earlier empty-queue observation can become stale.
Use the existing [runner rollout procedure](../../../deploy/codex-production-provider.md)
to place the candidate in a fresh immutable release directory with its pinned
production dependencies. Preserve the prior real `dist` directory and environment
for rollback. The installed `dist` must be a real directory, not a symlink,
because entrypoint detection depends on the invoked filename.

Publish the replacement only during a controlled service stop with no unfinished
work being interrupted. Restart, verify the exact installed hash, service process,
CLI 0.153.3, ChatGPT login, restrictive ownership, and clean polling. Retain the
actual activation timestamp and service/process evidence. No D1 migration is
required by the two new operator tools. Do not infer their activation from a
Worker deployment or from importing the candidate locally.

## 3. Dedicated-account lifecycle evidence

Required input: the account ID of a disposable account explicitly designated for
generation, consent withdrawal, and deletion. Authenticate through its normal
product flow. Never infer that an existing account with saved portraits is
disposable. Keep its session credentials in an operator secret store, not chat,
command arguments, Git, or a public report.

| Check | Action | Required evidence |
| --- | --- | --- |
| Baseline and permission | Confirm the selected account, chart, current processing/Pattern/portrait consent and no unrelated in-flight work. Use fictional birth details. | Timestamped account-scoped state, permission versions and source hashes; no birth details or tokens in the report. |
| Generation and publication | Request generation through the product, then follow owner jobs through planner/writer/verifier and publication. For a supported four-chapter Pattern, allow the opted-in portrait flow to finish. | The same owner generation reaches its terminal success state; the published reading is retrievable; expected assets exist with matching source hashes; all complete written chapters remain available. Provider completion alone is insufficient. |
| Saved-asset reuse | Reopen and reload the completed portrait. | Asset identity/hashes remain stable; no new portrait or mesh jobs are created by reopening. |
| Withdrawal during work | Withdraw the relevant consent during an isolated, account-scoped unfinished job. | New work stops and unfinished work becomes cancelled or fails the consent fence. Previously accepted assets follow the documented retention/visibility rule. Preserve the complete written reading where its own consent still permits it. |
| Late upload | Replay the legitimately issued, account-scoped upload/completion coordinates after withdrawal. Keep any lease token only in private process memory. | Rejection is caused by the current consent/ownership fence, not a fabricated token, bad signature or malformed body. No newly accepted asset becomes visible; any temporary object is cleaned up. |
| Deletion | Delete the designated account through the normal flow, then inspect its deletion receipt and scheduled cleanup. | Normal sessions are revoked; reader content and keys become inaccessible; account-owned artifacts/jobs are removed or tombstoned according to policy; late completion remains rejected. Observe physical cleanup before claiming object erasure. |

If a legitimate in-flight test cannot be isolated from other accounts, prepare
that part in staging and retain production status as unverified. Application
erasure evidence never establishes deletion from upstream provider systems.

## 4. Human corpus and account-owner evidence

Give the named independent reviewer
[`human-review-packet/packet.md`](./human-review-packet/packet.md),
[`packet.json`](./human-review-packet/packet.json), and
[`review-draft.json`](./human-review-packet/review-draft.json). They must review all
60 fragments against all five criteria and supply decisions, rationale and
evidence. Enrollment and signature verification follow the existing
[corpus review instructions](../../../../pattern-corpus/README.md#attributable-review-evidence).
Only the reviewer's own attributable signature may close review coverage.
Do not turn the assistant's code review into corpus certification.

The actual account owner completes
[`account-owner-evidence-draft.json`](./account-owner-evidence-draft.json) from
dated account/workspace settings and the applicable agreement. Confirm each
text/image/mesh path. Keep supporting account records private and retain an
opaque reference plus SHA-256 in the reviewable summary. Unknown historical
generation provenance remains unknown even if today's account is verified.

## 5. Configure useful canaries and account-wide usage alerts

The [canary implementation](../../../../scripts/pattern-release/operational-canary.mjs)
accepts only an HTTPS origin. The live origin checked here is
`https://patternlike-api-production.lfd.workers.dev`. The operator command is:

```bash
node scripts/pattern-release/operational-canary.mjs https://patternlike-api-production.lfd.workers.dev
```

Supply the following through the scheduler's private environment/secret facility:

| Input | Purpose |
| --- | --- |
| `PATTERNLIKE_CANARY_SESSION_TOKEN` | Normal session for the designated canary account with current geocoder consent. |
| `PATTERNLIKE_CANARY_READING_ID` | The exact published Daily expected for that account and day. |
| `PATTERNLIKE_CANARY_LOCAL_DATE` | Expected `YYYY-MM-DD` in that account's local calendar. |
| `GEOAPIFY_ACCOUNT_USAGE_FILE` | Private path to a fresh account-wide provider credit observation in the format below. |

The script reads a specified Daily; it does not request Today or initiate a
generation. Update the reading ID/date from the dedicated account's publisher
completion record for each expected day. A missing or stale publication must
stay an alert condition. It performs one fixed fictional city search when the
session is present, without selecting/resolving a place or modifying a chart.
Include those search credits in the monitor's planned usage.

The Geoapify observation must cover the account, not just this app's per-user
limiter or one project. Use the actual account dashboard/provider export and
allowance; no account-usage API endpoint was established in this review.
Geoapify accounts for API usage in credits; counting application requests is
not sufficient across different API costs. See the provider's
[credit explanation](https://www.geoapify.com/pricing-details/).

```json
{
  "schema_version": "geoapify-account-usage.v1",
  "scope": "account",
  "source": "account_dashboard",
  "evidence_sha256": "SHA256_OF_PRIVATE_PROVIDER_OBSERVATION",
  "observed_at": "UTC_OBSERVATION_TIME",
  "period_start": "UTC_ALLOWANCE_PERIOD_START",
  "period_end": "UTC_ALLOWANCE_PERIOD_END",
  "used_credits": null,
  "allowance_credits": null
}
```

This is a template, not valid usage evidence. The checker refuses absent,
future, expired, older-than-one-hour, invalid, or project-only observations.
It warns at 80% and fails at 100% of the supplied allowance. The source label
and checksum are an operator assertion about the input, not direct API
verification by this script.

Once the allowance, reliable refresh source and alert destination are supplied,
wire the command into the chosen scheduler. A five-minute cadence is a proposed
starting point; account for the corresponding geocoder cost. Route exit 1
(failure or warning) and exit 2 (incomplete/configuration failure) to the chosen
operator destination, retain the structured per-check statuses, and define a
missing-run alert separately. Test notification delivery with synthetic inputs
in a private environment. Verify one received notification and recovery before
claiming monitoring is active. No external message or alert was sent here.
