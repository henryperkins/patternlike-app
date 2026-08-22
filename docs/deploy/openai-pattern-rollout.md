# OpenAI Pattern generation — rollout and evidence runbook

**Created:** 2026-08-20

**Status:** Core adapter and automated-ontology engineering are present;
operational rollout and public-readiness work are not complete. This file is the
operational source of truth; updating it does not authorize a deployment,
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
| Executor/provider path and queue-level integration | Complete in repository; not live | `pattern-execute.ts`, `pattern-execute-openai.test.ts`; rollout `off` prevents provider work |
| Artifact-first idempotency, attempts, writer↔verifier correction, 11-call loop | Complete | `pattern-execute.ts`; exact ceiling in `pattern-execute-protocol.test.ts` |
| Executed-pin provenance and per-stage usage | Complete | `pattern-execute.ts`; migration `0010_pattern_stage_class_usage.sql` |
| `0009` / `0010` | Present in repository; remote state unqueried | Apply only through Gate 2 |
| Pattern model/strict-schema verification command | Present; no fresh live run recorded | `npm run publisher:pattern:model:verify -w @patternlike/api`; Gate 4 remains open |
| Internal synthetic ontology content and canary | **Not executed** | Internal ontology plan remains the shortest optional internal-content path |
| Public-capable machine ontology pipeline | Engineering complete through Task 10; rollout evidence open | Automated ontology plan Task 11 and Gates 2–10 remain operational work |
| Rollout declared in `wrangler.toml` | `off` | Both default and production blocks |
| Production publisher / credential declaration | `openai` / `worker` | Gateway ids and key alias remain empty in committed production config; development remains `synthetic` / `worker` |
| Numeric call-limit value | `100` in committed production config | A value is not spend approval; Gate 6 remains open |
| Production DB, secrets, active ontology pointer, deployed Worker version | **Not re-queried by this documentation change** | Gates 2–5 must record live evidence |

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

**Current state:** Task 10 implementation is present. This gate stays open until
the full command set has passed against the final candidate revision and that
revision is recorded below.

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

**Current state:** not started. Do not infer migration state from files in the
repository.

Before applying anything, record a D1 export path, time-travel bookmark, current
migration list, row counts for every table rebuilt by pending migrations, and:

```text
wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA quick_check"
```

Apply pending migrations in numeric order with the same explicit config and
environment. For adapter rollout, `0009` widens the artifact-class CHECK and
`0010` adds stage-class usage counters. Preserve populated artifact rows
byte-for-byte through the `0009` rebuild.

Afterward, record the migration list, `foreign_key_check` (zero rows),
`quick_check` (`ok`), empty `assertion_probe`, table SQL, and pre/post row counts.

**Stop:** an unexpected pending migration, non-empty assertion probe, integrity
error, row-count/hash drift, or a migration that applied before its compatible
Worker candidate was ready.

## Gate 3 — deploy the compatible Worker with rollout off

**Current state:** not started.

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

Enabling the production cron is its own configuration change with its own gate
(see `docs/deploy/openai-daily-reading-rollout.md`), because the same schedule
drives the daily-reading scheduler. Either enable it before Gate 8, or record
here, explicitly, that no Pattern provider retry can recover until it is on.

**Stop:** any product regression, wrong binding, non-off rollout, or provider
traffic. Roll back the Worker version; do not roll back the forward migration.

## Gate 4 — fresh model and strict-schema preflight

**Current state:** the reproducible command is implemented and hermetically
tested. Repository evidence exists from 2026-08-19, but no fresh live run is
recorded for this candidate.

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

**Current state:** committed mode is `worker`; gateway ids and alias are empty.
The operator has already chosen the existing AI Gateway whose literal id and
stored-key alias are both `default`, with BYOK and no custom domain or Access.
No cutover is performed by this document.

Allowed final states are exact:

| Mode | Required | Forbidden |
| --- | --- | --- |
| `worker` | `OPENAI_API_KEY`; either both gateway ids or neither | BYOK alias without stored mode; half-configured gateway |
| `gateway_stored` | both gateway ids, `AI_GATEWAY_TOKEN`, pinned `OPENAI_GATEWAY_KEY_ALIAS` | `OPENAI_API_KEY`, missing alias, missing token |

For the intended stored-key cutover, prepare and verify one Worker version in
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
| Gateway identity | existing reviewed id `default`; prove it already exists before sending | pending |
| Authenticated Gateway | on | pending |
| Stored provider key | OpenAI, alias `default` | pending |
| Guardrails | absent/off | pending |
| DLP | absent/off | pending |
| Dynamic Routes / fallbacks | none | pending |
| Retry default | record it; every request overrides to `1` | pending |
| Cache default | record it; every request sets skip-cache | pending |
| Spend-limit action | `Block` if configured; never fallback | pending |
| Gateway logging / Logpush | record actual state | pending |
| Automatic Log Deletion | record actual state | pending |
| Zero Data Retention | record actual state; it does not protect BYOK traffic | pending |
| OpenAI upstream retention | record the authorized account/project posture separately | pending |

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

**Current state:** open. The committed value `100` is configuration, not approval.

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
output cap, attempt maximum, or cohort-size change.

**Stop:** missing input bound, stale price, arithmetic not based on 11, or no
written ceiling approval.

## Gate 7 — activate an ontology on the selected path

**Current state:** no release artifact or current live-pointer evidence is
recorded here.

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

**Current state:** not started. This is the first point a generated Pattern may
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

**Current state:** not started.

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

**Current state:** not started.

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
|  | 1 |  |  |  |  | pending |
|  | 2 |  |  |  |  | pending |
|  | 3 |  |  |  |  | pending |
|  | 4 |  |  |  |  | pending |
|  | 5 |  |  |  |  | pending |
|  | 6 |  |  |  |  | pending |
|  | 7A or 7B |  |  |  |  | pending |
|  | 8 |  |  |  |  | pending |
|  | 9 |  |  |  |  | pending |
|  | 10 |  |  |  |  | pending |
