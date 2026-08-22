# OpenAI Pattern generation — rollout and evidence runbook

**Created:** 2026-08-20

**Status:** Core adapter, automated-ontology, and erasure-replay engineering are
present. Gate 6 is approved. Gate 7B has failed closed through candidate
`pattern-ontology-en-us-0.1.4`; Gates 8–10 remain open. This file is the
operational source of truth; updating it does not itself authorize a deployment,
secret change, ontology activation, provider call, or rollout advance.

**Companion artifacts:**

- adapter design:
  `docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`
- adapter plan:
  `docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md`
- internal ontology plan:
  `docs/superpowers/plans/2026-08-20-internal-ontology-activation.md`
- automated ontology plan:
  `docs/superpowers/plans/2026-08-20-automated-ontology-pipeline.md`
- current ledger:
  `docs/superpowers/plans/2026-08-15-m7-remaining-slices-ledger.md`
- normative product contract:
  `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.6.md`

## Non-negotiable generation rule

An individual Pattern is fully machine-run:

```text
reservation -> selection -> planning -> writing -> deterministic validation
            -> independent semantic verification -> atomic publication
            -> accepted or terminal failure
```

No person reviews, edits, approves, selects, or publishes an individual Pattern.
Operational approvals in this runbook authorize code, credentials, spend,
ontology versions, or rollout state only. They never alter generated prose or
override a failed machine gate.

## Current repository state

This table describes repository evidence, not unqueried live state.

| Area | State at 2026-08-22 | Evidence / next owner |
| --- | --- | --- |
| Shared Responses boundary, minimizing packets, prompts, correction document, OpenAI transport, publisher factories, credential modes | Complete | Adapter Tasks 1–5a |
| Executor/provider path and queue-level integration | Deployed with rollout off | Worker `c20fa0da-273b-4d63-8fdd-7fc53d972c05`; `pattern-execute.ts`, `pattern-execute-openai.test.ts` |
| Artifact-first idempotency, attempts, writer↔verifier correction, 11-call loop | Complete | `pattern-execute.ts`; exact ceiling in `pattern-execute-protocol.test.ts` |
| Executed-pin provenance and per-stage usage | Complete | `pattern-execute.ts`; migration `0010_pattern_stage_class_usage.sql` |
| `0009` / `0010` / `0011` / `0012` | Applied to production in order | Gate 2 evidence below; integrity and shape checks clean |
| Pattern model/strict-schema verification command | Fresh live pass recorded | `gpt-5.6-sol` lookup and strict `pattern` response passed at `2026-08-22T12:32:49.920Z` |
| Internal synthetic ontology content and canary | **Not executed** | Internal ontology plan remains the shortest optional internal-content path |
| Public-capable machine ontology pipeline | Engineering complete; Gate 7B production evidence failed closed | Authorized corpus registered; five immutable candidates failed before compilation/evaluation; no machine release is active |
| Rollout declared in `wrangler.toml` | `off` | Both default and production blocks |
| Production publisher / credential declaration | `openai` / `worker` | Gateway ids and key alias remain empty in committed production config; development remains `synthetic` / `worker` |
| Numeric call-limit value | `100` in committed production config | Gate 6 approved the nine-Pattern/99-call operating ceiling and 100-call hard ceiling |
| Production DB, secrets, active ontology pointer, deployed Worker version | Re-queried through Gate 7B | API `70de1b79-315a-4881-b33e-df61539365d7`; corpus, ontology signing, and replay signing identities are provisioned; active ontology is null; Pattern rollout remains `off` |

## What remains before the first generated Pattern

The shortest supported route is the internal path. In order:

1. pass Gate 1 on the final adapter candidate;
2. execute the internal ontology plan, or run the implemented automated pipeline
   instead, and activate a signed release;
3. inventory production, apply required migrations, and deploy with rollout
   still `off`;
4. freshly prove the model/schema, configure one valid credential mode, and approve the
   worst-case spend ceiling;
5. set exactly the canary account in `PATTERN_INTERNAL_ACCOUNT_IDS`, move only to
   `internal`, and use an account with an active chart, confirmed `en-US` locale,
   valid Pattern consent, and an unconsumed chart fingerprint; and
6. reserve once and let the machine pipeline reach `ready` or an honest terminal
   failure.

Adapter Tasks 1–9, including the credential model and queue/idempotency suite,
are complete. Task 10 supplies the reproducible preflight and this handoff;
neither substitutes for a live Gate 4 run. Administrator OIDC and the replay
restore drill are not required to obtain the first internal Pattern; they remain
public-rollout gates below.

## Paths after the common engineering gates

| Path | Ontology accepted | Account scope | Endpoint state reached | Additional blockers |
| --- | --- | --- | --- | --- |
| Internal canary — shortest | signed `synthetic_internal` or `machine_pipeline` | exact allowlist only | `PATTERN_AI_ROLLOUT=internal` | Gate 1, one activated ontology path, and Gates 2–8 |
| Public `first_open` | signed `machine_pipeline` only, backed by authorized `licensed_excerpt` corpus | first-open cohort | `PATTERN_AI_ROLLOUT=first_open` | Automated ontology Task 11 evidence, Gate 9 certification, admin role boundary, replay runtime/drill, sustained metrics |
| Public `enabled` | active `machine_pipeline` release | remaining eligible cohort | `PATTERN_AI_ROLLOUT=enabled` | Separate product authorization after successful first-open observation |

The internal release is never promoted into a public release. The first machine
release recalls it and triggers withdrawal for documents based on it.

---

## Gate 1 — complete and freeze the code candidate

**Current state:** requalified and complete for candidate `611884e` on
2026-08-22 after the first signer upload exposed a missing platform-required
handler. A regression test first reproduced that upload shape, the signer added
an empty-404 `fetch`, and the full command set passed against the corrected
tree. The local verification itself made no provider call or remote change.

Run from the repository root:

```text
npm run typecheck
npm test
npm run build
python contracts/validate_schemas.py
```

Required evidence:

- all commands exit zero from one commit;
- the focused OpenAI Pattern integration suite proves duplicate delivery,
  expired lease, provider-success/D1-failure adoption, bounded attempt
  exhaustion, coarse failures, and no second accepted document;
- the hermetic Pattern-model verification lane proves the live command's model
  lookup, strict `pattern` request, incomplete-output refusal, and prose-free
  failures without making a provider request;
- `contracts/m0` through `contracts/m6` are unchanged;
- M7 changes are only recorded additive amendments and fixtures;
- both Wrangler blocks still declare `PATTERN_AI_ROLLOUT="off"`; and
- no production secret or remote resource changed during this gate.

**Stop:** any failure, unresolved adapter requirement, unrecorded contract
drift, or non-`off` committed rollout.

## Gate 2 — inventory production and apply forward-only migrations

**Current state:** complete on 2026-08-22. The initial production ledger ended
at `0008`. The operator explicitly approved including the unexpected but
additive `0012_ontology_pipeline.sql`; `0009` through `0012` were then applied
in numeric order.

Recorded evidence:

- pre-apply Time Travel bookmark:
  `00000081-00000000-000050cf-14b34dd939ee6e24552c9757f1f197b1`;
- full export outside the repository at
  `~/patternlike-backups/patternlike-ops-pre0009-20260822T1216Z.sql`, mode 0600,
  759,696 bytes, SHA-256
  `01a93877510c89731d1bb2bfed8828f626e802937936ded28950a3e09b609948`;
- post-apply Time Travel bookmark:
  `00000081-0000000a-000050cf-9123939a04ef16532cb26441a249ea2a`;
- no migration remains pending; `foreign_key_check` returned zero rows,
  `quick_check` returned `ok`, and `assertion_probe` remained empty;
- all pre-existing target tables preserved their zero row counts; all four
  `0012` pipeline tables were also empty; and
- the correction artifact class, six stage counters, four pipeline tables, and
  eight required indexes were present after apply.

Before applying anything, record a D1 export path, time-travel bookmark, current
migration list, row counts for every table rebuilt by pending migrations, and:

```text
wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA quick_check"
```

Apply pending migrations in numeric order with the same explicit config and
environment. For adapter rollout, `0009` widens the artifact-class CHECK and
`0010` adds stage-class usage counters. `0011` adds the terminal pipeline
evidence receipt and `0012` adds the automated pipeline control-plane tables.
Preserve populated artifact rows byte-for-byte through the `0009` rebuild.

Afterward, record the migration list, `foreign_key_check` (zero rows),
`quick_check` (`ok`), empty `assertion_probe`, table SQL, and pre/post row counts.

**Stop:** an unexpected pending migration, non-empty assertion probe, integrity
error, row-count/hash drift, or a migration that applied before its compatible
Worker candidate was ready.

## Gate 3 — deploy the compatible Worker with rollout off

**Current state:** API version
`d784b0ea-625d-4c8c-84ce-4e27f71ec9d0` (version 135) is deployed at 100%.
The compatible Gate 3 deployment and unauthenticated operational checks passed.
A reusable production Auth0 canary now exists, and its deployed React SDK login
created a live Worker session. The CLI loopback namespace was unavailable, so
this preflight did not capture the required authenticated `/v1/pattern`
before/after pair. Leave this gate open until that replay is recorded around an
authorized deployment.

Recorded evidence:

- prior deployed version `99847321-0679-480c-ab31-5299d0c37444` was recorded
  before the change;
- signer version `9533269b-08e8-4ece-9418-928405a16449` was deployed first as
  the private service-binding target; it has only the empty-404 `fetch` and
  `signOntology` handlers, and its signing secret is deliberately still absent;
- `/health` returned 200 with `environment=production`; unauthenticated
  `/v1/pattern` and `/v1/pattern-state` remained 401;
- the deployed binding reports `PATTERN_AI_ROLLOUT=off`, publisher `openai`,
  queue `patternlike-pattern-generation`, and the expected signer service;
- the Pattern consumer reports DLQ `patternlike-pattern-generation-dlq`, batch
  size 1, three retries, five-second wait, and bounded concurrency 2; and
- after health/auth smoke, `pattern_provider_daily_usage` still contained zero
  rows and zero planner/writer/verifier calls; there were no Pattern claims or
  artifacts; and
- the Auth0 SPA callback, logout, and web-origin lists were restored exactly
  after the interrupted CLI loopback attempt; the subsequent deployed SDK login
  created a live Worker session without exporting its bearer.

Deploy the exact Gate 1 commit:

```text
npm run deploy:api
```

Record the Worker version id and prove:

- `/health` succeeds;
- authenticated Pattern state/read behavior is unchanged;
- the Pattern queue and DLQ names, `max_batch_size=1`, and bounded concurrency
  match committed configuration;
- `PATTERN_AI_ROLLOUT=off` in the deployed version; and
- no Pattern queue delivery decrypts a command or calls a provider while off.

**Also decide the scheduler here, and record the decision.**
`[env.production.triggers]` is an explicit `crons = []` override in
`apps/api/wrangler.toml`, so **no cron runs in production today** and
`sweepPatternJobs` never fires there. That was harmless while every Pattern
delivery either advanced or died. Since Task 6 it is not: a retryable provider
failure calls `retryStage`, which returns the job to `queued` with
`available_at` set to the backoff floor and re-nudges immediately — and that
immediate nudge is *deliberately* refused by `claimStage`'s
`available_at <= now` condition. The undispatched lane of `sweepPatternJobs` is
what re-sends it. With no cron, a backed-off Pattern job waits forever, holding
the reader's one claim.

**Scheduler decision for this run:** keep production `crons = []` through Gates
2–5. Therefore a backed-off Pattern provider retry cannot recover until the
scheduler is enabled. It must be enabled or separately resolved before Gate 8.

Enabling the production cron is its own configuration change with its own gate
(see `docs/deploy/openai-daily-reading-rollout.md`), because the same schedule
drives the daily-reading scheduler. Either enable it before Gate 8, or record
here, explicitly, that no Pattern provider retry can recover until it is on.

**Stop:** any product regression, wrong binding, non-off rollout, or provider
traffic. Roll back the Worker version; do not roll back the forward migration.

## Gate 4 — fresh model and strict-schema preflight

**Current state:** complete for candidate `611884e` on 2026-08-22. A fresh live
run passed model lookup for `gpt-5.6-sol` and the minimal strict `pattern`
schema. It recorded response id
`resp_0c0e06d21cb2a7f3016a8996efc86887d09b15a9fbe285e27c`, response SHA-256
`sha256:047754291268ee488b96fe19fc26087af468a30748e35a0af707e358ac7ce517`,
and completion time `2026-08-22T12:32:49.920Z`; no provider prose was printed.

Run from the repository root only when the provider call is authorized:

```text
npm run publisher:pattern:model:verify -w @patternlike/api
```

It must prove both:

1. the pinned model exists for the authorized OpenAI account; and
2. a minimal strict `json_schema` response carrying the contract's `pattern`
   keyword is accepted.

The command records model id, response id/hash, verdict, and timestamp only. A
live 200 proves that the provider accepts the retained keyword; the command also
confirms locally that the generated object conforms to the regex, but never
prints that object or provider error prose. Repeat this gate for any later
model, model tier, or strict-schema derivation change.

**Stop:** missing model, refused schema keyword, unexpected billing account, or
any output containing provider prose.

## Gate 5 — configure one credential route and verify AI Gateway state

**Current state:** the operator chose to reuse the direct Worker credential
route. Deployed version `c20fa0da-273b-4d63-8fdd-7fc53d972c05` consistently
declares `OPENAI_CREDENTIAL_SOURCE=worker`, has the `OPENAI_API_KEY` secret, and
has empty gateway account/id/alias values with no `AI_GATEWAY_TOKEN`. The Gate 4
live call proves the reusable local credential can reach the pinned model and
schema. No gateway cutover was performed.

The route configuration is verified, but this gate remains open on upstream
retention posture. The project credential received 403 from OpenAI's
organization-retention admin endpoint, no `OPENAI_ADMIN_KEY` or authenticated
dashboard session is available, and a project credential cannot prove the
organization setting or a project override. Record both before Gate 5 closes.

Allowed final states are exact:

| Mode | Required | Forbidden |
| --- | --- | --- |
| `worker` | `OPENAI_API_KEY`; either both gateway ids or neither | BYOK alias without stored mode; half-configured gateway |
| `gateway_stored` | both gateway ids, `AI_GATEWAY_TOKEN`, pinned `OPENAI_GATEWAY_KEY_ALIAS` | `OPENAI_API_KEY`, missing alias, missing token |

For any later stored-key cutover, prepare and verify one Worker version in
which `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID="default"`, alias `default`, and
`AI_GATEWAY_TOKEN` are present while `OPENAI_API_KEY` is absent. Do not expose
traffic to an intermediate combination. Record secret names and version ids,
never values.

The gateway token needs `Run` and is account-scoped: it can reach every gateway
and stored provider key in the Cloudflare account. A Workers AI binding is not a
BYOK substitute for provider-native OpenAI requests.

### Dashboard-state checklist

Reverify immediately before cutover. The 2026-08-19 observation is a baseline,
not permanent evidence.

| Setting | Required / accepted state | Evidence |
| --- | --- | --- |
| Gateway identity | existing reviewed id `default`; prove it already exists before sending | N/A — direct Worker route selected |
| Authenticated Gateway | on | N/A — direct Worker route selected |
| Stored provider key | OpenAI, alias `default` | N/A — direct Worker route selected |
| Guardrails | absent/off | N/A — direct Worker route selected |
| DLP | absent/off | N/A — direct Worker route selected |
| Dynamic Routes / fallbacks | none | N/A — direct Worker route selected |
| Retry default | record it; every request overrides to `1` | N/A — direct Worker route selected |
| Cache default | record it; every request sets skip-cache | N/A — direct Worker route selected |
| Spend-limit action | `Block` if configured; never fallback | N/A — direct Worker route selected |
| Gateway logging / Logpush | record actual state | N/A — direct Worker route selected |
| Automatic Log Deletion | record actual state | N/A — direct Worker route selected |
| Zero Data Retention | record actual state; it does not protect BYOK traffic | N/A — direct Worker route selected |
| OpenAI upstream retention | record the authorized organization and project posture separately | pending — admin key or authenticated dashboard required |

Every routed request must send exact values
`cf-aig-collect-log:false`, `cf-aig-max-attempts:1`, and
`cf-aig-skip-cache:true`. Stored mode additionally sends the pinned alias and no
provider `Authorization`. Guardrails and DLP stay off because either would send
private packet/prose bytes through a second content processor. Gateway logs are
expected to contain no Pattern request entry; that is the designed result of
`collect-log:false`, not an outage.

Gateway ZDR and gateway logging are separate controls. ZDR does not apply to
this BYOK path. A gateway spend limit is a backstop and never replaces the D1
usage ledger. If other traffic later shares this gateway, its calls are outside
the Pattern ledger and must move to a separate gateway or be included in a new
spend model.

**Stop:** any dashboard mismatch, half-configured mode, provider
`Authorization` in stored mode, missing request override, unexpected gateway
log entry, or unrecorded upstream-retention posture.

## Gate 6 — approve the numeric spend ceiling

**Current state:** complete. On 2026-08-22 the operator gave written approval in
this deployment session for the numeric Pattern and ontology-pipeline ceilings
recorded below. The committed value `100` remains only the enforcement value;
the approval is the evidence that authorizes its stated operating envelope.

The 2026-08-22 production preflight pins a conservative `110,000` input-token
planning bound for every Pattern and ontology-pipeline pass. The bound covers
the `98,304`-byte serialized input-document cap, the largest fixed compiled
request envelope in this candidate, framing allowance, and rounding headroom.
It is an approval input, not a new runtime variable. Re-measure it whenever a
prompt policy, strict output schema, or request envelope changes.

The inclusive worst case is exactly:

```text
2 planner calls
+ 3 writer calls per job
+ (3 writer candidates × 2 verifier calls per candidate)
= 11 provider calls per Pattern
```

The former `7` flattened verifier scope and is too low. The former `14` counted
inclusive maxima as retries-after-first and is too high. Neither is an approved
basis.

For each stage, record the measured/pinned input-token bound, configured output
bound, and current price for the exact model. Compute:

```text
pattern_max_cost = 2*planner_call_max
                 + 3*writer_call_max
                 + 6*verifier_call_max

daily_max_cost   = maximum_new_patterns_per_utc_day * pattern_max_cost
daily_calls      = maximum_new_patterns_per_utc_day * 11
```

`daily_calls` must fit `PATTERN_DAILY_PROVIDER_CALL_LIMIT`; the limit remains a
shared total while `0010` records planner/writer/verifier attribution. Failed,
timed-out, refused, and invalid responses consume one call. Adopted response
artifacts consume none.

Record prices, timestamp/source, arithmetic, approved Pattern/day count, call
limit, worst-case cost, and approver. Re-cost on any model, price, input cap,
output cap, prompt/schema envelope, attempt maximum, or cohort-size change.

The current shared ledger limits calls, not stage mix or new Pattern count.
Therefore the approval must cover both the complete-Pattern arithmetic and the
hard call-ledger ceiling. Carry-over work can make a UTC day writer-heavy, so
`maximum_new_patterns_per_utc_day * pattern_max_cost` alone is not the hard
daily spend cap.

### 2026-08-22 approved ceiling

The exact model is `gpt-5.6-sol`. The
[official model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
fetched on 2026-08-22 reports promotional standard pricing of $4.00 per
million input tokens and $20.00 per million output tokens through at least
2026-11-21. The `110,000` input-token planning bound is below the page's
greater-than-272,000 long-context price boundary.

| Pass | Input bound | Output bound | Maximum call cost |
| --- | ---: | ---: | ---: |
| planner | 110,000 | 4,000 | $0.520000 |
| writer | 110,000 | 8,000 | $0.600000 |
| verifier | 110,000 | 4,000 | $0.520000 |

The inclusive maximum is therefore `$5.960000` per Pattern. The approved
maximum of nine new Patterns per UTC day is 99 calls and `$53.640000`; it fits
the configured 100-call ledger. Because stage mix is not constrained, the hard
100-call daily ceiling is `$60.000000` (100 writer-priced calls). The operator
approved these values in writing in the 2026-08-22 deployment session.

Gate 7B's separate production-shaped pipeline run is at most 16 generator + 64
evaluator + 330 regression calls. At the same bounds, one complete candidate is
at most 410 calls and `$221.680000`; the configured 500-call ledger has an
absolute writer/generator-priced ceiling of `$300.000000`. The operator also
approved that candidate-run ceiling in the same written approval.

**Stop:** missing input bound, stale price, arithmetic not based on 11, or no
written ceiling approval.

## Gate 7 — activate an ontology on the selected path

**Current state:** Gate 7B is blocked on an accepted machine candidate. The authorized 60-fragment
`licensed_excerpt` corpus release
`pattern-ontology-source-manual-en-us-0.1.0` is registered with corpus hash
`sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`.
The isolated signing identity, API verification keyring, and pipeline artifact
keyring are provisioned. Five fresh production candidates failed closed before
compilation, evaluation, signing, or activation. Versions `0.1.0` and `0.1.1`
exposed completion/exclusion ambiguity and `coverage_incomplete`; `0.1.2`
failed deterministic record policy after ten zero-retry chunks. Versions
`0.1.3` and `0.1.4` each durably wrote all 16 zero-retry request/response/chunk
triplets and then failed `candidate_invalid` at the unchanged generation bound,
without a candidate hash. Prompt pins `1.0.2` and `1.0.3` clarified the frozen
record policy and that coverage—not corpus exhaustion—defines completion; no
limit, schema, evaluator rule, or acceptance criterion changed. Daily pipeline
usage ended at 44 generator calls, zero evaluator calls, and zero regression
calls against the approved 500-call ceiling. No machine release is active. A
candidate must still pass every existing 7B criterion before activation.

### Gate 7A — shortest internal path

Execute `docs/superpowers/plans/2026-08-20-internal-ontology-activation.md`.
Required evidence: signed `synthetic_internal` bundle hash, compiler pass,
signature/key id, active pointer, allowlisted reservation success, byte-identical
external `ontology_unavailable` refusal, and zero provider/budget use on that
refusal. `evaluator_passed` and `regression_passed` remain honestly false.

### Gate 7B — public-capable path

Engineering Tasks 1–10 in
`docs/superpowers/plans/2026-08-20-automated-ontology-pipeline.md` are present in
the repository despite the plan's stale checkboxes. Execute Task 11's
production-shaped candidate and rollout handoff.
Required evidence: authorized `licensed_excerpt` corpus identity/hash,
deterministic compiler pass, one independent evaluation per rule, 30-chart
regression report meeting all hard gates and class thresholds, separate signing
Worker identity, report hashes, signed bundle, and atomic activation with
`provenance.origin="machine_pipeline"`.

An `internal_synthetic` corpus can prove engineering but cannot satisfy 7B. No
operator can relabel it or waive a failed record.

**Stop:** hash/signature mismatch, recalled version, compiler/evaluator/
regression failure, missing source authorization, wrong provenance, or an
attempt to make Slice A public.

## Gate 8 — enable and certify the first internal Pattern

**Current state:** blocked before reservation. Production has four active
accounts, four active charts, and four confirmed `en-US` locales, but zero
current Pattern-generation grants and therefore zero currently eligible canary
accounts. Canary `usr_3ca4f7c2f2498c4eab97511fc3c6ff97` is active with one
active chart, confirmed `en-US` from `user_confirmed`, and a live Worker
session. It has zero Pattern claims, generation jobs, documents, and grants; no
claim was reserved. The account is prepared but not designated. Gate 8 remains
blocked on an eligible active ontology, the scheduler decision, separate
authorization and deployment of the exact internal allowlist/rollout change,
and first-use Pattern consent. This is the first point a generated Pattern may
exist outside hermetic tests.

Deploy one exact `PATTERN_INTERNAL_ACCOUNT_IDS` entry and set
`PATTERN_AI_ROLLOUT=internal`. The account must have:

- active account and chart;
- confirmed `en-US` content locale matching the active ontology;
- current Pattern-generation consent;
- no consumed claim for the chart fingerprint; and
- a reservation reason admitted by the internal rollout.

Reserve once. Record opaque generation id, provider request hashes, per-pass
call/token counts, stage timings, ontology version/hash, executed model/prompt
pins, candidate/verdict hashes, and final public state. Do not record chart
facts, packets, plans, candidate prose, verifier rationale, or document prose.

Success is one accepted `ready` document plus one external account receiving the
indistinguishable ontology refusal. A terminal failure is honest evidence of a
failed canary, not permission to edit or approve the Pattern manually.

**Stop:** more than 11 calls, a human content step, unexpected account admitted,
wrong provenance, validation bypass, plaintext log, budget mismatch, or anything
other than one accepted document for the claim.

At this point the original goal — a generated Pattern — is satisfied for an
internal account. Gates 9–10 govern external readers.

## Gate 9 — public-readiness certification

**Current state:** replay engineering and production signing configuration are
complete, while operational certification remains open. Migration `0008`, the
signed create-only R2-first writer, atomic D1 receipts, lifecycle integrations,
service-authenticated replayer/sweeper, replay bucket binding, and the dedicated
`pattern-replay-2026-08` signing identity/keyring are present. The restore drill
in `docs/deploy/pattern-erasure-replay-drill.md` cannot be exercised until Gate
8 supplies an accepted Pattern to erase and restore. The admin route still
accepts the shared static `PATTERN_ADMIN_TOKEN`; the existing dedicated
`pattern_generation_auditor` identity criterion also remains open.

Before `first_open`, record all of the following against the same candidate:

- consent revocation, deletion, chart correction, ontology recall, artifact
  expiry, export boundaries, and publication-race tests;
- no plaintext or content through metadata/admin routes;
- replacement of `PATTERN_ADMIN_TOKEN` with the dedicated
  `pattern_generation_auditor` session/role boundary and rejection of the old
  bearer path;
- runtime emission of signed R2-first erasure replay events and a restore drill
  proving a pre-deletion snapshot cannot resurrect Pattern content or reset a
  consumed claim; and
- every hard privacy/evaluation gate at zero exceptions.

The `0008` table and contract alone do not satisfy the replay item. The runtime
writer, replayer, replica receipt, and drill must exist and be exercised.

**Stop:** any unmet acceptance criterion, shared admin bearer still valid,
restore resurrection, plaintext exposure, or exception waived by a person.

## Gate 10 — advance to `first_open`

**Current state:** not attempted. Gate 6 is complete; Gate 7B failed closed and
Gates 8 and 9 remain open. There is no active machine release or sustained
internal observation interval.

Prerequisites: Gate 7B's active machine release, Gate 9 complete, no active
Slice A release, and sustained internal observations within the approved bounds
for provider success, deterministic validation, semantic rejection, queue age,
attempts, token use, and spend.

Set only `PATTERN_AI_ROLLOUT=first_open`, deploy one version, and record the
cohort rule and version. Monitor the closed operational metrics; never inspect
reader prose to decide whether to publish it. Return to `off` on threshold
breach.

`enabled` is a later, separately authorized product transition. It is not an
automatic consequence of a successful first-open interval.

---

## Rollback

- Set `PATTERN_AI_ROLLOUT=off` to prevent queued or in-flight work from entering
  another provider stage. Do not delete queue rows or undo migrations.
- Recall an unsafe ontology version. Recall is permanent for that version and
  invokes the existing withdrawal path; never reactivate the same identity.
- Roll back the Worker to the last schema-compatible version. Forward-only D1
  migrations remain applied.
- Preserve accepted-claim and erasure replay semantics. Rollback must not grant
  a second generation or resurrect withdrawn content.
- Credential rollback must land as a complete valid mode, not a half-configured
  intermediate state.

Accepted Pattern reads, revocation, deletion, cleanup, recall, and inspection
continue while generation is off.

## Evidence ledger

Do not paste secrets or content. One row per executed gate; leave a gate open
until its evidence exists.

| Date UTC | Gate | Commit / Worker version | Migration state | Ontology version / origin | Evidence summary | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-20 | Foundation only | `8558e82`…`d2975e0`, `31d3621` | unchanged | none | Tasks 1–5a complete; focused seven-file lane passed 222 tests | complete, not a rollout gate |
| 2026-08-22 | 1 | `611884e` | repository migrations through `0012`; remote unchanged during candidate verification | none | corrected signer handler reproduced red then green; typecheck, root tests (including 1,650 API, 207 web, 19 signer, and 8 verifier tests), build/dry-run, frozen contracts, and D1 smoke passed; Pattern rollout remained `off` | complete, corrected candidate |
| 2026-08-22 | 2 | `611884e` | production advanced `0008` → `0012`; nothing pending | none | external 0600 export plus pre/post bookmarks; `0009`–`0012` applied in order; FK/integrity/assertion/shape/count checks clean | complete |
| 2026-08-22 | 3 | `611884e`; signer `9533269b`; API `c20fa0da` | `0012`, compatible | none | health 200; rollout off; Pattern queue/DLQ batch 1/concurrency 2; zero Pattern usage/claims/artifacts; scheduler stays off; authenticated read replay unavailable; signer key absent and fail-closed | deployed; gate open on authenticated replay |
| 2026-08-22 | 4 | `611884e`; API `c20fa0da` | `0012` | none | live `gpt-5.6-sol` lookup and strict `pattern` schema passed; response id/hash/time recorded without prose | complete |
| 2026-08-22 | 5 | `611884e`; API `c20fa0da` | `0012` | none | direct Worker mode is internally consistent; OpenAI secret present and gateway fields/token absent; upstream organization/project retention could not be read with project key (403) | route verified; gate open on retention evidence |
| 2026-08-22 | 6 | `24804ee` | `0012` | none | official promotional rate and 110,000 input-token planning bound; operator approved $5.96/Pattern, nine/99 calls and $53.64 operating day, $60 hard 100-call day, plus $221.68/410-call pipeline candidate and $300 hard 500-call day | complete |
| 2026-08-22 | 7B attempt 1 | API `af2b6cea` | `0012` | candidate `pattern-ontology-en-us-0.1.0`; none active | authorized 60-fragment corpus and signing identities registered; run `oprun_32783057-32b8-4341-b8c9-a0134d104f8a` failed closed as `candidate_invalid` on completion/exclusion ambiguity; no evaluation, signing, or activation | failed closed; prompt corrected |
| 2026-08-22 | 7B attempt 2 | API `af2b6cea` | `0012` | candidate `pattern-ontology-en-us-0.1.1`; none active | run `oprun_26101c6b-1960-4328-bd8a-9f0a20d8e3a7` failed closed as `coverage_incomplete`; provider completion was found advisory while frozen coverage remained; bounded continuation fix and regression coverage committed | failed closed; fresh run required |
| 2026-08-22 | 7B attempt 3 | API `57830965`; prompt `1.0.1` | `0012` | candidate `pattern-ontology-en-us-0.1.2`; none active | run `oprun_9e5a3a4e-335c-4f38-8878-27df47a46c36`, config `sha256:be5a0312d729c3cc9aaf5afa001e2474c6176f503de0929dffbbb74203c06219`, wrote ten zero-retry triplets and failed `record_policy_invalid`; no candidate/report/bundle hash | failed closed; record policy clarified |
| 2026-08-22 | 7B attempt 4 | `400091f`; API `de5520b6`; prompt `1.0.2` | `0012` | candidate `pattern-ontology-en-us-0.1.3`; none active | run `oprun_0c92ac15-458e-4a31-82db-df7e5875dbaf`, config `sha256:83c3111cfa2873255eff2dabab23219ffe96d330fc91ade13f93b9209ebe0767`, wrote 16 zero-retry triplets and failed `candidate_invalid` at the fixed bound; no candidate/report/bundle hash | failed closed; completion scope clarified |
| 2026-08-22 | 7B attempt 5 | `56f49fe`; API `70de1b79`; prompt `1.0.3` | `0012` | candidate `pattern-ontology-en-us-0.1.4`; none active | full verification passed (1,719 API, 207 web, 19 signer, 18 content tests plus contracts/migrations); run `oprun_c97ec6f1-d383-4a5b-aeba-29660e295574`, config `sha256:910ae07a3aa426229b6a7acb6df07c8054ccdd37339b2c06a088c03a90a60533`, wrote 16 zero-retry triplets and failed `candidate_invalid`; daily usage 44/500, all generator | failed closed; Gate 7B remains open |
| 2026-08-22 | 9 replay engineering | `0ed87eb`, `eda31cb`, `3a47565` | `0012` | none active | signed R2-first lifecycle intents, atomic receipts, deterministic adoption, service-authenticated apply/sweep, account-deletion replay, replay bucket, and production `pattern-replay-2026-08` signing key/keyring are deployed; restore procedure recorded without claiming execution | implementation/signing complete; drill and admin identity evidence open |
| 2026-08-22 | 7 preflight | `24804ee` | `0012` | none | full typecheck, tests (including 1,650 API, 207 web, 19 signer), build/dry-run, contracts and 12-migration smoke pass; live corpus/release/pipeline inventories empty; signing, verification, and artifact keys absent | blocked on authorized corpus, keys, and pipeline-spend approval |
| 2026-08-22 | 8 preflight | `24804ee` | `0012` | none | four active accounts/charts and four confirmed en-US locales; zero current Pattern grants and zero eligible canary accounts; no authenticated canary session | blocked before reservation |
| 2026-08-22 | Auth0 canary preflight | `01049cc`, `b4e1770`; API `d784b0ea` (135) | `0012` | none active | existing identity reused through deployed Universal Login; SPA URL lists restored exactly after the unusable CLI loopback; Worker session accepted; canary `usr_3ca4f7c2f2498c4eab97511fc3c6ff97` is active with one chart and confirmed en-US; zero Pattern claims, jobs, documents, or grants; no reservation | canary prepared; Gate 8 remains blocked |
| 2026-08-22 | 9 preflight | `24804ee` | `0012` | none | static admin bearer remains; replay table has zero rows and no runtime writer/replayer/drill implementation; identity path and both draft designs await operator decision/approval | blocked before certification |
| 2026-08-22 | 10 | `56f49fe`; API `70de1b79` | `0012` | none active | Gate 7B has no accepted machine release; Gate 8 has no designated/consented canary; Gate 9 drill and auditor identity remain open; rollout verified `off` | blocked by existing prerequisites; not attempted |
