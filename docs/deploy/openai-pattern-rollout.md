# OpenAI Pattern generation — rollout and evidence runbook

**Created:** 2026-08-20

**Status:** Core adapter, automated-ontology, and erasure-replay engineering are
present. Gate 6 is open for both provider paths: the historical OpenAI approval
does not cover current pins, and the selected Codex path is not certified. Gate
7B most recently failed closed for Codex candidate
`pattern-ontology-en-us-0.1.17`, which compiled, passed every evaluation, and
reached regression cursor 95 of 30 fixtures before a planner pass ceiling ended
it; no ontology release is active.
Gates 8–10 remain open. This file is the operational source of truth; updating
it does not itself authorize a deployment, secret change, ontology activation,
provider call, or rollout advance.

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

| Area | State / date | Evidence / next owner |
| --- | --- | --- |
| Shared Responses boundary, minimizing packets, prompts, correction document, OpenAI transport, publisher factories, credential modes | Complete | Adapter Tasks 1–5a |
| Executor/provider path and queue-level integration | Engineering complete; prior Gate 3 deployment verified with rollout off | Worker `c20fa0da-273b-4d63-8fdd-7fc53d972c05`; `pattern-execute.ts`, `pattern-execute-openai.test.ts` |
| Artifact-first idempotency, attempts, writer↔verifier correction, 11-call loop | Complete | `pattern-execute.ts`; exact ceiling in `pattern-execute-protocol.test.ts` |
| Executed-pin provenance and per-stage usage | Complete | `pattern-execute.ts`; migration `0010_pattern_stage_class_usage.sql` |
| Historical `0009` / `0010` / `0011` / `0012` | Applied to production in order | 2026-08-22 Gate 2 evidence below; integrity and shape checks clean |
| Current migration inventory (2026-08-25 query) | Production ledger is at `0015`; `wrangler d1 migrations list` reports nothing pending | `0015_ontology_pipeline_regression_evidence.sql` applied `2026-08-25 00:59:51`, ahead of the Worker that reads it. `0013` / `0014` remain applied. |
| Pattern model/strict-schema verification command | Fresh live pass recorded | `gpt-5.6-sol` lookup and strict `pattern` response passed at `2026-08-22T12:32:49.920Z` |
| Internal synthetic ontology content and canary | **Not executed** | Internal ontology plan remains the shortest optional internal-content path |
| Public-capable machine ontology pipeline | Engineering complete; Gate 7B production evidence failed closed | Authorized corpus registered; multiple immutable candidates failed closed at existing validation/regression/configuration boundaries; no machine release is active. See the evidence ledger for individual runs. |
| Rollout declared in committed `wrangler.toml` | default `off`; production `internal` for one allowlisted account | This is repository configuration, not proof of the deployed binding or a successful canary |
| Committed production publisher declaration | `codex` | The dedicated runner path is selected; development remains `synthetic`, and OpenAI gateway ids/key alias remain empty |
| Gate 6 spend certification | Open for OpenAI and Codex | `100` Pattern and `500` ontology calls/day remain enforcement ceilings. The 2026-08-22 OpenAI approval used old 4k/8k/4k output pins and is historical evidence, not authorization for the current mixed ontology/Pattern envelope or Codex. |
| Production DB, secrets, active ontology pointer, deployed Worker version | Re-queried 2026-08-25 | API `097f2646-71c5-4623-b0da-88c1a64fc641` (deployed `2026-08-25T01:00:12Z`); `users` 4, `pattern_ontology_releases` 0, `pattern_generation_jobs` 0, `pattern_documents` 0, `content_releases` 0, `codex_provider_jobs` 124 all terminal; corpus `pattern-ontology-source-manual-en-us-0.1.0` registered `licensed_excerpt`; active ontology pointer is null; observed Pattern rollout `off`, ontology rollout `internal` / `codex`; the Codex runner was polling `/codex-provider/v1/jobs/claim` and answering `ok`. This observed state differs from current committed rollout declarations and must be re-queried before another operation. |

## What remains before the first generated Pattern

The shortest supported route is the internal path. Follow the common gates
first, then choose exactly one ontology branch:

1. pass Gate 1, complete Gate 2's required migration procedure, and deploy the
   compatible Gate 3 Worker with rollout contained;
2. for `synthetic_internal`, execute and activate the signed internal ontology
   without provider Gates 4–6; then close the selected Pattern provider's Gates
   5–6 before Gate 8. A Codex Pattern strict-schema Gate 4 closes only on the
   ordinary Gate 8 planner job, not through a diagnostic job;
3. for machine Gate 7B, close the selected provider's Gates 5–6 before
   reservation. In particular, Codex Gate 6 must close before any durable Codex
   job. Reserve exactly one authorized immutable candidate, co-execute its
   generator-schema Gate 4 evidence with that ordinary job, and activate only
   if every machine gate passes;
4. after an active ontology exists, prepare the one-account internal Pattern
   canary with an active chart, confirmed `en-US` locale, current first-use
   confirmation, and an unconsumed chart fingerprint. The Codex Pattern
   strict-schema Gate 4 evidence closes on that ordinary Gate 8 planner job;
5. set exactly the canary account in `PATTERN_INTERNAL_ACCOUNT_IDS`, move only
   to `internal`, reserve once, and let the machine pipeline reach `ready` or an
   honest terminal failure.

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

The off-state requirements below are evidence conditions for that historical
candidate. Current committed production configuration has since advanced to
`internal`; this section does not assert otherwise and must not be used to
revert or infer the deployed state.

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

**Historical state (2026-08-22):** complete. The initial production ledger ended
at `0008`. The operator explicitly approved including the unexpected but
additive `0012_ontology_pipeline.sql`; `0009` through `0012` were then applied
in numeric order.

**Later state (2026-08-25):** `0013`, `0014`, and
`0015_ontology_pipeline_regression_evidence` are applied in production; the
migration list reports nothing pending. `0015` performed no backfill: legacy
committed `0011` receipts retain NULL regression pins and fail closed for machine
public activation. New machine receipts require the complete regression evidence
tuple.

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
Those four files were the complete 2026-08-22 Gate 2 execution. During the later
2026-08-24 follow-up, `0015_ontology_pipeline_regression_evidence` became the
known reviewed pending migration. It added the full regression evidence tuple
and no-delete/complete-tuple guards without backfilling legacy receipts and was
applied on 2026-08-25 with its compatible Worker. Preserve populated artifact
rows byte-for-byte through any future CHECK rebuild and preserve populated
`0011` evidence rows.

After each migration window, record the migration list, `foreign_key_check`
(zero rows), `quick_check` (`ok`), empty `assertion_probe`, table SQL, and
pre/post row counts. The later `0015` window additionally required proof that
populated `0011` rows were preserved, legacy regression pins remained all NULL,
the full regression tuple was accepted only when complete, and the
no-delete/immutability guards were exercised. Record that no rollout change or
provider call occurred during a migration step.

**Stop:** an unexpected pending migration, non-empty assertion probe, integrity
error, row-count/hash drift, failed tuple/no-delete guard, a rollout/provider
call during this migration step, or a migration that applied before its
compatible Worker candidate was ready.

## Gate 3 — deploy the compatible Worker with rollout off

**Historical Gate 3 state (2026-08-22):** API version
`d784b0ea-625d-4c8c-84ce-4e27f71ec9d0` (version 135) was deployed at 100%.
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

Production currently runs only the separately routed ontology-pipeline
maintenance cron. The incumbent reading/privacy/Pattern scheduler remains off,
so `sweepPatternJobs` does not automatically re-send a Pattern job after its
provider backoff expires. This is not a Gate 8 prerequisite. For the single
Gate 8 canary, an operator uses the existing service-authenticated
`POST /internal/pattern-generations/:generation_id/reconcile` route after the
job's `available_at` time if a retry leaves it queued. Do not enable the
incumbent scheduler as part of the Pattern rollout; its separate daily-reading
rollout remains unchanged.

**Stop:** any product regression, wrong binding, non-off rollout, or provider
traffic. Roll back the Worker version; do not roll back the forward migration.

## Gate 4 — fresh model and strict-schema preflight

**Provider selection:** Gates 4–6 apply to the publisher selected for the
candidate. The OpenAI procedures below are required for `openai`. A `codex`
candidate uses the Codex equivalents in each gate; it does not claim OpenAI
model lookup, Responses strict-schema acceptance, AI Gateway state, upstream
retention, or token-priced billing evidence. These alternatives preserve the
same hard gate. The selected provider's Gate 6 must close before the first
durable Gate 7B job; these procedures do not otherwise authorize a provider call
or rollout change.

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

### Codex equivalent

Complete Gates 1–3 and the Codex Gate 5–6 equivalents first. The runner claims
only ordinary durable jobs; there is no standalone invocation route and no
diagnostic job. Co-execute this evidence with the first provider step of the
one authorized immutable Gate 7B candidate (the generator schema), and with
the Gate 8 Pattern planner job (the Pattern strict schema). For each schema,
close Gate 4 evidence only when the runner's normal claimed job reaches a
terminal schema-valid response within timeout with the pinned model/prompt and
safe request id, hashes, and counters. Authentication failure, an unavailable
pin, schema failure, or timeout stops that candidate or canary; do not create a
second diagnostic job.

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

### Codex equivalent

Verify that the Worker holds only `CODEX_RUNNER_TOKEN` and
`CODEX_PROVIDER_ARTIFACT_KEYRING` for the Codex provider, while the runner host
alone holds the interactive ChatGPT credential. Verify outbound-only polling,
no listening socket, rejection of an invalid runner bearer, encrypted R2
request/response envelopes, and runner health with the applicable rollout(s)
off. AI Gateway and OpenAI retention checks do not apply; runner-host credential
isolation and encrypted artifact handling are hard requirements.

## Gate 6 — approve the numeric spend ceiling

**Current provider state:** Gate 6 is open. The 2026-08-22 OpenAI approval is
historical only: it covered 4,000 planner, 8,000 writer, and 4,000 verifier
output bounds, not the current effective envelope of 8,000 ontology-generator,
4,000 ontology-evaluator, and 32,000 Pattern/regression
planner/writer/verifier output limits. Before an OpenAI provider job, re-cost
that current envelope using a freshly verified official rate and obtain explicit
written approval; do not infer current pricing or dollars from the historical
calculation. The selected Codex path is also not certified; its required written
approval is stated in the Codex equivalent below.

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

### Historical 2026-08-22 approval — old pins, not current authorization

**Non-authorizing historical record:** the following rate observation and
arithmetic apply only to the 4k/8k/4k bounds recorded here. They do not approve
the current mixed ontology/Pattern envelope, any current OpenAI price, or any
Codex job.

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

### Codex equivalent

**Current state: not certified.** Before the first Codex durable Gate 7B job,
obtain explicit written approval naming the authorized account/plan, the 100
Pattern and 500 ontology D1 call ceilings, the effective output envelope of 8k
ontology-generator, 4k ontology-evaluator, and 32k Pattern/regression
planner/writer/verifier limits, 900000-ms timeout, runner concurrency 1, and
every applicable attempt and input limit. A ChatGPT login does not provide a
trustworthy per-token price feed, so do not invent dollar arithmetic. A missing
approval or change to any listed limit keeps this gate open.

## Gate 7 — activate an ontology on the selected path

**Current state:** Gate 7B is blocked on an accepted machine candidate. The authorized 60-fragment
`licensed_excerpt` corpus release
`pattern-ontology-source-manual-en-us-0.1.0` is registered with corpus hash
`sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`.
The isolated signing identity, API verification keyring, and pipeline artifact
keyring are provisioned. Multiple immutable production candidates have failed
closed; see the evidence ledger for the complete historical sequence. Versions
`0.1.0` through `0.1.4` exposed completion, record-policy, and
bounded-coverage failures. `0.1.5` then failed candidate validation after two
generator calls. The first reviewed source bridge allowed `0.1.6` to compile
and pass six independent evaluator calls, but the existing regression gate
failed after seven fixtures. A transient nine-hint V4 command for `0.1.7`
reached regression before the scoped eight-hint Worker rejected its frozen
identity; the exact-eight `0.1.8` V4 command was inversely rejected before any
artifact or provider call when a concurrent deployment restored the nine-hint
Worker. Both incompatible commands had reused V4. Commit `9381693` separated
the exact-eight command as V5. Candidates `0.1.9` and `0.1.10` then reached the
existing regression hard gates; commits `4494d30` and `23b9485` restored the
already-bounded writer correction path for the two proven writer-origin finding
classes. Candidate `0.1.11` passed generation, compilation, and all ten
independent evaluations, then failed closed after 71 regression results when
its second and final planner call produced no response artifact; the terminal
transition 121.077 seconds after request creation is consistent with the fixed
120-second deadline.
API deployment `ca84f4f7-ebbc-4140-a4b3-dbfcee150ef2` (code upload
`baa82c35-7eef-4bb9-9c4e-0ae06645e703`) is at 100% with prompt `1.0.5`, the
unchanged pass and 16-chunk limits, ontology rollout `internal`, and Pattern
rollout `off`. Candidate `0.1.12` subsequently passed generation, compilation,
and all ten evaluations, then failed closed at regression cursor 14 after two
identical request attempts produced no response. The daily ledger is now
214/500 calls (6 generator, 57 evaluator, 151 regression). A content-free strict-
schema probe after the run reproduced the provider condition as HTTP `429`, type
`insufficient_quota`, code `credit_balance_exhausted`. No regression report or
bundle exists, and no machine release is active. A candidate must still pass
every existing 7B criterion before activation.

**Observed 2026-08-23, later the same day.** Two further candidates ran.
`0.1.13` failed `evaluation_rejected` at cursor 0. `0.1.14` failed
`regression_failed` at cursor 68 — the furthest any candidate has reached
against a 30-fixture set. Counting the stored regression artifacts per run
separates the recorded failures into two classes that had been reported as one:

| candidate | failure | cursor | requests | responses |
| --- | --- | --- | --- | --- |
| `0.1.14` | `regression_failed` | 68 | 69 | 69 |
| `0.1.12` | `regression_failed` | 14 | 17 | 14 |
| `0.1.11` | `regression_failed` | 71 | 73 | 71 |
| `0.1.10` | `regression_failed` | 45 | 46 | 46 |
| `0.1.9` | `regression_failed` | 2 | 3 | 3 |
| `0.1.6` | `regression_failed` | 6 | 7 | 7 |

Where requests equal responses the model answered and a regression hard gate
rejected the *content*. Where requests exceed responses the provider returned
no output text at all. Only the second class is a transport or configuration
condition; the first is the gate doing its job.

The no-response class has a cause independent of billing.
`ONTOLOGY_REGRESSION_PATTERN_PIN` prices the regression Pattern passes at the
Pattern max-output-token pins, which were `4000` planner, `8000` writer, `4000`
verifier while `reasoning` is pinned `high`. A real planner call at those values
was reproduced locally against the live Responses API: it consumed the entire
4000-token allowance on reasoning tokens and returned `status: "incomplete"`,
`incomplete_details.reason: "max_output_tokens"`, with no output text, after
55.8 seconds. That is precisely the "identical request attempts produced no
response" signature recorded for `0.1.11` and `0.1.12`. The regression Pattern
pins are now `32000` for all three passes, and
`ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS` derives
from them rather than restating `2 * 4_000 + 3 * 8_000 + 3 * 2 * 4_000` as
literals — that duplication silently mispriced the budget the moment a pin
moved. Deployed as version `1aaed29c-29eb-436b-86f3-990379ce94c4` with Pattern
rollout still `off`. The regression output-token *cap* rises from 1,680,000 to
10,560,000; actual spend rises only insofar as passes now complete instead of
truncating.

The pass timeouts were deliberately **not** raised.
`consumeClaimedOntologyProviderCallBudget` admits a reservation only while the
run's remaining lease covers `timeoutMs` plus a persistence margin, so raising
`OPENAI_PATTERN_*_TIMEOUT_MS` to `600000` makes every regression reservation
refuse and reschedule instead of advancing. They remain `120000`.

Verified against production the same day: `pattern_ontology_releases` is empty
and `pattern_ontology_pointer.active_version` is `NULL`; `content_releases` is
empty; `users` is 4; `pattern_documents` and `pattern_generation_jobs` are both
0. Corpus `pattern-ontology-source-manual-en-us-0.1.0` is registered with 60
fragments, `licensed_excerpt`, `public_capable = 1`. Contrary to earlier notes,
both `ONTOLOGY_PIPELINE_ARTIFACT_KEYRING` (API) and
`PATTERN_ONTOLOGY_SIGNING_KEY` (signer) **are** provisioned.

**Historical direct-OpenAI-path blocker evidence (2026-08-23):** provider
credit exhaustion was confirmed on production rather than inferred. Run
`oprun_ae8a9369-94e5-467c-ac19-07aa260acc54`
(candidate `pattern-ontology-en-us-0.1.15`, configuration
`sha256:dd76aa95016d82d2b4776778d877f70da30cd28d7002ae9a2ef7c9a9ecab3484` —
which differs from earlier runs precisely because the max-output-token pins are
part of the command identity) was reserved and dispatched against the deployed
Worker. It reached `generating` and consumed generator calls 9 through 13 across
five attempts, every one failing and rescheduling behind a backoff, never
producing a candidate hash. The Worker's own `OPENAI_API_KEY` therefore reached
the same exhausted account as the local probe. The run was bounded by
`MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS = 16` and failed closed.

> **Superseded 2026-08-24:** the direct Worker transport described in the next
> paragraphs was removed. Production Codex inference now uses the durable,
> outbound-polling CLI runner documented in
> [`codex-production-provider.md`](./codex-production-provider.md). Its ChatGPT
> login never enters Worker configuration.

**Historical diagnosis:** `PATTERN_PUBLISHER=codex`
and `ONTOLOGY_PIPELINE_PUBLISHER=codex` now exist: a real provider with its own
fixed endpoint, its own subscription credential (`CODEX_AUTH_TOKEN` /
`CODEX_ACCOUNT_ID`, both secrets), and truthful provenance — a Pattern authored
this way records `provider: "Codex"`, not `"OpenAI"`. The frozen contract types
`provenance.provider` as a plain string, so that honest second value costs no
schema-version bump. The Codex surface differs in two measured ways, both
handled: it refuses `stream: false`, and it rejects `max_output_tokens` outright.
Its terminal `response.completed` event carries an **empty** `output` array, so
the adapter reassembles the message from the `response.output_item.done` events
before the existing envelope logic runs — reading only the completed event would
be indistinguishable from a provider that returned no text.

It is nevertheless unusable here. Measured from workerd on 2026-08-23 with valid
credentials, `chatgpt.com/backend-api/codex/responses` answers `403` with a
Cloudflare challenge page for **every** request — no User-Agent, the Codex CLI's,
and a browser's all alike — while the identical request from an ordinary host
answers `200`. The credential and request shape are fine; the edge refuses the
caller. A Cloudflare Worker naming either codex publisher therefore fails every
pass as `publisher_auth_failed`. That is an access control and is not to be
worked around. The provider remains in the tree, tested, and documented as
unreachable from Workers.

Historical direct-OpenAI-path probe evidence recorded HTTP `429`
`insufficient_quota` / `credit_balance_exhausted`. That evidence blocks the
historical direct OpenAI path; it does not describe the selected Codex runner
path. The current operational blockers are the failed Codex regression candidate
and resulting absence of an active signed ontology release, plus the open
selected-provider Gate 6. A new Codex candidate must pass every existing hard
gate before activation; there is no manual or credit-free shortcut to a signed
active release.

**Fixcheck-04 evidence (2026-08-24):** Codex run
`oprun_a342be36-0460-4644-9669-6c8a51cc9a6c` failed closed at
`2026-08-24T12:53:26.613Z`. Trace
`trc_4a69607fb3641e8e27c3c22db92bce5b` records verifier failure on fixture
index 21, `m7-unknown-02`, with the sole hard gate
`suppressed_feature_leak`. No regression report, bundle, or ontology-pointer
change occurred. This safe event identifies the failed verifier gate only; it
does not establish which upstream component introduced the condition.

### Gate 7A — shortest internal path

Execute `docs/superpowers/plans/2026-08-20-internal-ontology-activation.md`.
Required evidence: signed `synthetic_internal` bundle hash, compiler pass,
signature/key id, active pointer, allowlisted reservation success, and an
unallowlisted authenticated account receiving the normal
`503 pattern_generation_unavailable` containment response while
`PATTERN_AI_ROLLOUT=internal`. The denied request must leave zero claim,
consent, generation-job, provider-budget, or artifact side effects.
`evaluator_passed` and `regression_passed` remain honestly false.

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

#### The recurring `suppressed_feature_leak` failure, and what was changed

Two of the fourteen failed candidates died on the same gate rather than on
their own content: attempt 11 (`0.1.10`, 46 regression results) and
`fixcheck-04` (`0.1.16-fixcheck-04`, 89 regression results, verifier fixture
index 21 `m7-unknown-02`), each with `suppressed_feature_leak` as the sole hard
gate. Neither is an ontology defect. `hasSuppressedPacketFeatureLeak` was false
in both cases — the frozen fixtures carry no `house_cusp` or `angle` feature and
no position with a non-null house — so the leak was writer-origin, and the
bounded three-attempt writer correction was spent without closing it.

The cause is a mismatch between two rules that were never reconciled.
`suppressedUnitLeaks` in `ontology-regression.ts` is a **lexical** scan of
chapter prose for the vocabulary of each class in
`uncertainty.suppressed_classes` — the bare word "house", "Ascendant",
"Gemini Moon". The writer document supplies the class *names* and nothing else,
and the shipped writer policy said only "Honor the supplied uncertainty rules in
the meaning of the prose". A writer that complies with the stated rule about
meaning still fails the unstated rule about words, and a correction naming a
code and a section key cannot teach a vocabulary the policy never gave it. The
exposure is wide: 20 of the 30 fixtures suppress `moon_time_sensitive` and
`angle_transits`, and the 10 `unknown` fixtures add `angles` and `houses`.

`OPENAI_PATTERN_WRITER_PROMPT_VERSION` `1.0.1` states each gated class and the
words the scan matches, and confines the disclosure to the uncertainty note,
which is the one writer field `coreWriterUnits` does not scan. The pin moves
with the text because provenance naming one version for two prompts proves
nothing. This changes the odds; it does not remove the gate. Fixtures 22–29
have never been reached by any candidate, and a candidate can still fail closed
on this or any other hard gate.

#### What `0.1.17` showed, and the planner defect it exposed

Candidate `pattern-ontology-en-us-0.1.17`
(`oprun_4d24bc8b-83c8-465d-8877-05c6daffcb34`, config
`sha256:9794799e8cf22fe5e9d6d43227594522784e835b29cf652a8fe0f99b81ca2e9e`,
candidate `sha256:94fedb74c671dc3076307de4368791e0dd4e88fbca73b17c9ae24cd23c07c556`,
evaluation `sha256:fac9c30ec60c498c7a3365f06c51c48d6ce1c507d4c12f6e661b9845b2b2ddfd`)
ran against writer prompt `1.0.1` on API `e1700d61-9160-41eb-87ee-849f9232d922`.
It compiled first try, passed all ten evaluations, and reached regression cursor
95 — further than any prior candidate — before failing `regression_failed`.

**No hard gate fired.** The `ontology_regression_hard_gate_failed` event that
named `fixcheck-04`'s failure does not appear anywhere in this run's logs, and
the final stage generation wrote no artifact at all. Both facts point at a pass
ceiling refused before any provider call, which is `regression_failed` raised
with nothing recorded.

The provider-call arithmetic identifies it. The run spent 96 regression calls:
**40 planner, 31 writer, 25 verifier**. There are only 30 fixtures and the
planner ceiling is an inclusive two per fixture, so at least ten complete plans
were rejected by `validatePatternPlan` — and every planner response was between
1,527 and 3,270 bytes, so none was empty, truncated, or a refusal. The model
returns plans; the plans do not close.

That is the defect `WORKERS_AI_PLANNER_POLICY` was written against and measured
to fix on `@cf/openai/gpt-oss-120b`, left on that pin alone so the OpenAI prompt
stayed frozen. Its rules are now `PLAN_CLOSURE_RULES` in the shared planner
policy under `OPENAI_PATTERN_PLANNER_PROMPT_VERSION` `1.0.1`, so the Codex pin
gets them too.

The run also exposed a fourth instance of this repository's recurring silent
failure defect, after the blind correction loop, the silent chunk rejection, and
the silent evaluator verdict: eleven call sites raise `regression_failed` and
only the hard gate said anything. `failRegression` now emits a closed
`ontology_regression_failed` event carrying the reason, the pass, and the pass
counters — no fixture id, rule id, plan, candidate, verdict, or prose. The next
failure of this class names itself instead of being inferred from arithmetic.

**Stop:** hash/signature mismatch, recalled version, compiler/evaluator/
regression failure, missing source authorization, wrong provenance, or an
attempt to make Slice A public.

## Gate 8 — enable and certify the first internal Pattern

**Current state:** blocked before reservation. Production has four active
accounts, four active charts, and four confirmed `en-US` locales. Canary
`usr_3ca4f7c2f2498c4eab97511fc3c6ff97` is active with one
active chart, confirmed `en-US` from `user_confirmed`, and a live Worker
session. It has zero Pattern claims, generation jobs, documents, and grants; no
claim was reserved. This is expected before first use: the normal authenticated,
confirmed request creates the current grant and reservation atomically. The
account is prepared but not designated. Gate 8 remains blocked on an eligible
active ontology and separate authorization and deployment of the exact internal
allowlist/rollout change. This is the first point a generated Pattern may exist
outside hermetic tests.

For a Codex canary, deploy one atomic production change that sets
`PATTERN_PUBLISHER=codex`, all of
`OPENAI_PATTERN_PLANNER_TIMEOUT_MS`, `OPENAI_PATTERN_WRITER_TIMEOUT_MS`, and
`OPENAI_PATTERN_VERIFIER_TIMEOUT_MS` to `900000`, one exact
`PATTERN_INTERNAL_ACCOUNT_IDS` entry, and `PATTERN_AI_ROLLOUT=internal`.
Follow the Codex publisher and lease procedure in
[`codex-production-provider.md`](./codex-production-provider.md); do not leave
the Pattern path on its production `openai` / `120000` pins. The account must
have:

- active account and chart;
- confirmed `en-US` content locale matching the active ontology;
- submission of the current consent-policy version and confirmation through the
  normal authenticated first-use flow, which creates the current grant;
- no consumed claim for the chart fingerprint; and
- a reservation reason admitted by the internal rollout.

Reserve once. Record opaque generation id, provider request hashes, per-pass
call/token counts, stage timings, ontology version/hash, executed model/prompt
pins, candidate/verdict hashes, and final public state. Do not record chart
facts, packets, plans, candidate prose, verifier rationale, or document prose.
If a retryable provider failure leaves the canary queued, wait for its frozen
`available_at` backoff and invoke the existing service-authenticated reconcile
route for that same generation. This recovery is part of operating the one
canary, not a separate rollout gate.

Success is one accepted `ready` document plus the unallowlisted containment
check: `503 pattern_generation_unavailable` with zero claim, consent,
generation-job, provider-budget, or artifact side effects. A terminal failure
is honest evidence of a failed canary, not permission to edit or approve the
Pattern manually.

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

**Current state:** not attempted. Gate 6 is open for the selected provider;
Gate 7B failed closed and Gates 8 and 9 remain open. There is no active machine
release or sustained internal observation interval.

Prerequisites: the selected provider's current Gate 6 approval, Gate 7B's active
machine release, Gate 9 complete, no active Slice A release, and sustained
internal observations within the approved bounds for provider success,
deterministic validation, semantic rejection, queue age, attempts, token use,
and spend.

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
| 2026-08-22 | 6 | `24804ee` | `0012` | none | historical old-pin evidence only: official promotional rate and 110,000 input-token planning bound; operator approved $5.96/Pattern, nine/99 calls and $53.64 operating day, $60 hard 100-call day, plus $221.68/410-call pipeline candidate and $300 hard 500-call day | historical approval; current Gate 6 reopened |
| 2026-08-22 | 7B attempt 1 | API `af2b6cea` | `0012` | candidate `pattern-ontology-en-us-0.1.0`; none active | authorized 60-fragment corpus and signing identities registered; run `oprun_32783057-32b8-4341-b8c9-a0134d104f8a` failed closed as `candidate_invalid` on completion/exclusion ambiguity; no evaluation, signing, or activation | failed closed; prompt corrected |
| 2026-08-22 | 7B attempt 2 | API `af2b6cea` | `0012` | candidate `pattern-ontology-en-us-0.1.1`; none active | run `oprun_26101c6b-1960-4328-bd8a-9f0a20d8e3a7` failed closed as `coverage_incomplete`; provider completion was found advisory while frozen coverage remained; bounded continuation fix and regression coverage committed | failed closed; fresh run required |
| 2026-08-22 | 7B attempt 3 | API `57830965`; prompt `1.0.1` | `0012` | candidate `pattern-ontology-en-us-0.1.2`; none active | run `oprun_9e5a3a4e-335c-4f38-8878-27df47a46c36`, config `sha256:be5a0312d729c3cc9aaf5afa001e2474c6176f503de0929dffbbb74203c06219`, wrote ten zero-retry triplets and failed `record_policy_invalid`; no candidate/report/bundle hash | failed closed; record policy clarified |
| 2026-08-22 | 7B attempt 4 | `400091f`; API `de5520b6`; prompt `1.0.2` | `0012` | candidate `pattern-ontology-en-us-0.1.3`; none active | run `oprun_0c92ac15-458e-4a31-82db-df7e5875dbaf`, config `sha256:83c3111cfa2873255eff2dabab23219ffe96d330fc91ade13f93b9209ebe0767`, wrote 16 zero-retry triplets and failed `candidate_invalid` at the fixed bound; no candidate/report/bundle hash | failed closed; completion scope clarified |
| 2026-08-22 | 7B attempt 5 | `56f49fe`; API `70de1b79`; prompt `1.0.3` | `0012` | candidate `pattern-ontology-en-us-0.1.4`; none active | full verification passed (1,719 API, 207 web, 19 signer, 18 content tests plus contracts/migrations); run `oprun_c97ec6f1-d383-4a5b-aeba-29660e295574`, config `sha256:910ae07a3aa426229b6a7acb6df07c8054ccdd37339b2c06a088c03a90a60533`, wrote 16 zero-retry triplets and failed `candidate_invalid`; daily usage 44/500, all generator | failed closed; Gate 7B remains open |
| 2026-08-22 | 7B attempt 6 | prompt `1.0.3`; command V2 | `0012` | candidate `pattern-ontology-en-us-0.1.5`; none active | run `oprun_33f87369-e73e-462b-8a90-7fd81419404b`, config `sha256:4b144018ac321e4c096eab082b6082589d17183eed934facfdf2e94d3460e2e3`, wrote two generator triplets and failed `candidate_invalid`; no candidate/report/bundle hash | failed closed at candidate validation |
| 2026-08-23 | 7B attempt 7 | API `a6c6e3e5`; prompt `1.0.4`; command V3 | `0012` | candidate `pattern-ontology-en-us-0.1.6`; none active | run `oprun_096cd5d7-4afb-4450-8da5-5d1f109076b5`, config `sha256:ee90697e450f78105743d7dd0cc49c6b1ca1044e5fb3b1ebc2798a9eaa41f66a`, candidate `sha256:17f49b7d72438e563d323adf8eb5a1c08b2181b96a066fbc4996ce76baf4a474`, compiler `sha256:65ed3c63f50fb73922eeff4ff1d1cc961d89f142e801b352c7c4690ebc50acc1`, evaluator `sha256:822a6d012a095ca92fdd0d934079d2ca19570db0d38c940ec6434d83ed800ae9`; 1 generator, 6 evaluator, and 7 regression calls; no regression report or bundle | failed closed at existing regression gate |
| 2026-08-23 | 7B attempt 8 | API `98a22276`; prompt `1.0.5`; command V4 | `0012` | candidate `0.1.7`; none active | run `oprun_5f60bf80-7e7d-4aed-8fc6-940cdd1cf913`, nine-hint config `sha256:aff09b5379586bb71a6a55edd60e0deb972255fef87fb3c92e11a006e824327b`, candidate `sha256:af4aded09b60c677a484d42253484354ecf87f4f8be9f3d50f079d45f6181107`, compiler `sha256:2fb89d0978eeada64b4633430a4771349c40ddad0ba05e3c3a7d31294d747e36`, evaluator `sha256:8f77fbc671d3045531efaf5a0ec4762676b5edd74cb536ca2833c1394ce3813c`; 1 generator, 11 evaluator, and 5 regression calls before the scoped eight-hint deployment rejected the incompatible V4 identity; no regression report or bundle | failed closed as `configuration_invalid`; no activation |
| 2026-08-23 | 7B attempt 9 | `9381693`; API `0aded7f1`; prompt `1.0.5`; command V5 deployed after failure | `0012` | candidate `pattern-ontology-en-us-0.1.8`; none active | run `oprun_c3cb1a82-a7af-44aa-8358-77ea89466399`, exact-eight V4 config `sha256:9983b8c20101d282a63c2450698b960b1dbc6d7c78565186a0d3738d1aa59d56`, failed before artifacts/provider use when a concurrent deployment restored the incompatible nine-hint V4 Worker; command identity was separated as V5, 120 affected tests plus full typecheck/build passed, usage remained 31/500, active pointer remained null, and Pattern rollout stayed `off` | failed closed as `configuration_invalid`; V5 fix deployed; no retry reserved |
| 2026-08-23 | 7B attempt 10 | `4494d30` deployed after failure; prompt `1.0.5`; command V5 | `0012` | candidate `pattern-ontology-en-us-0.1.9`; none active | run `oprun_a6d9b4ca-27ce-4963-8126-1a38e28293df`, config `sha256:26ad231398ebd179b3264d2f494b279b9cf4b33ba0419370a43f81896fb78c25`, candidate `sha256:6835fc4b6e13503ae1b2dd01eaec265ba01f46ae74e118e9cffeb035870877ff`, compiler `sha256:22b7e4e9d702ff428ed7fc84c79ccce2df1c374bdeb795cbdac1c2c5899c9fad`, evaluator `sha256:e37857bdeb59e1ba2ba7d36ccf5c7412419d941d591622252e8dc63d3f533054`; failed at the existing sole `prohibited_claim` regression gate after three regression results; the bounded writer correction route was repaired and verified without changing any ceiling | failed closed; no regression report, bundle, or activation |
| 2026-08-23 | 7B attempt 11 | `23b9485` deployed after failure; prompt `1.0.5`; command V5 | `0012` | candidate `pattern-ontology-en-us-0.1.10`; none active | run `oprun_e2f70a73-6bc2-4df4-8ee5-0be90e1d94ce`, config `sha256:7d020fc4074d7560d09c0bc5a27581e278c8e22ae8e01039125c8a7874c626e8`, candidate `sha256:7cd86c984b42716b7ef0d8ae4bf3ea0cbebbda726c2947aad4073613883222fa`, compiler `sha256:4620e0eac2372546c3490f68247a2cd6367802766c21379be442b16786f9922c`, evaluator `sha256:24e2a71544f80e6b8e20374fe9721d455f35f71cf6529fbf2403e23a6de7ea38`; failed at the existing sole writer-origin `suppressed_feature_leak` regression gate after 46 regression results; the bounded correction route was repaired and verified without changing any ceiling | failed closed; no regression report, bundle, or activation |
| 2026-08-23 | 7B attempt 12 | `23b9485`; API `ca84f4f7` (`baa82c35` code); prompt `1.0.5`; command V5 | `0012` | candidate `pattern-ontology-en-us-0.1.11`; none active | run `oprun_9026280d-067f-4c13-ac62-1f4e1a4b61c3`, config `sha256:24103de2e86eb7fde4d1fcbf7565cec153f35897d7094ea97f221fdd16d973bc`, candidate `sha256:d76fad38a873d86149a3f78e0a7cad7d73f689c0718d9ca7f782fdca22a6554d`, compiler `sha256:6b926310ed04ab5c98eb44339a72f9a04074e5b459d0e2c9134f8525e1326199`, evaluator `sha256:3ef00438683dbf273438f30836c586ea4ac6f10da7186c5b0850f76c8291e6f7`; all ten evaluations passed and regression produced 71 results. The final two planner requests have the same hash; the first was invalid, while the reserved second call produced no response artifact and terminaled 121.077 seconds after request creation, consistent with the fixed 120-second deadline. A third planner call was correctly refused by the unchanged inclusive two-call ceiling | failed closed as `regression_failed`; no regression report, bundle, or activation |
| 2026-08-23 | 7B attempt 13 | `a9a45b7`; API `ca84f4f7` (`baa82c35` code); prompt `1.0.5`; command V5 | `0012` | candidate `pattern-ontology-en-us-0.1.12`; none active | run `oprun_f2013b4f-c09d-40f4-a992-f64a7639d928`, config `sha256:f6c7c04e254f1a04b22d99308e9c94218c3bb08d70bb4fa3ace0e21e9f54be37`, candidate `sha256:c46a5e1a076e4fb3247764a7c0f1f5d4aee9f6a45cbd36da9bcb07255a75442c`, compiler `sha256:f1e7dd4677cb9fd52b7c4f217d01793eead9c0c94d454404f5b39fe763f491ee`, evaluator `sha256:c7ca6052af09f9449885244e81c2c742945cdc021387ee13036c059fef2f2db1`; all ten evaluations passed and regression produced 14 results. Generation 28 persisted two identical planner requests and no response; the first exhausted its deadline and the retry also failed closed. A subsequent content-free strict-schema probe reproduced HTTP `429`, type `insufficient_quota`, code `credit_balance_exhausted`; usage reached 214/500 | failed closed as `regression_failed`; no regression report, bundle, or activation |
| 2026-08-24 | 7B fixcheck-04 | Codex runner; trace `trc_4a69607fb3641e8e27c3c22db92bce5b` | `0013` / `0014` applied | candidate `pattern-ontology-en-us-0.1.16-fixcheck-04`; run `oprun_a342be36-0460-4644-9669-6c8a51cc9a6c`; none active | failed `2026-08-24T12:53:26.613Z` on verifier fixture index 21 `m7-unknown-02` with sole hard gate `suppressed_feature_leak`; no regression report, bundle, or pointer change | failed closed; no activation |
| 2026-08-25 | 7B `0.1.17` | `f8d37ee`; API `e1700d61-9160-41eb-87ee-849f9232d922`; writer prompt `1.0.1` | `0015` applied `2026-08-25 00:59:51` | candidate `pattern-ontology-en-us-0.1.17`; run `oprun_4d24bc8b-83c8-465d-8877-05c6daffcb34`; none active | full gate green from one commit (1,859 API, 214 web, 19 signer, contracts, migration smoke, production dry-run). Config `sha256:9794799e8cf22fe5e9d6d43227594522784e835b29cf652a8fe0f99b81ca2e9e`, candidate `sha256:94fedb74c671dc3076307de4368791e0dd4e88fbca73b17c9ae24cd23c07c556`, compiler `sha256:53eceda56839c89d55b627bc50ba297f103f172d05fef4d3b0a98aa13d117d16`, evaluator `sha256:fac9c30ec60c498c7a3365f06c51c48d6ce1c507d4c12f6e661b9845b2b2ddfd`. Compiled first try, ten of ten evaluations passed, reached regression cursor 95 — the furthest any candidate has come. Failed `regression_failed` at `2026-08-25T19:44:39.582Z` at stage generation 110 with no artifact written and no hard-gate event: a pass ceiling refused before any provider call. 96 regression calls — 40 planner, 31 writer, 25 verifier — against 30 fixtures and an inclusive two-planner-call ceiling, with every planner response between 1,527 and 3,270 bytes, so at least ten complete plans were rejected by `validatePatternPlan`. Daily usage 107/500 | failed closed; planner closure rules and the named-failure event are the response |
| 2026-08-22 | 9 replay engineering | `0ed87eb`, `eda31cb`, `3a47565` | `0012` | none active | signed R2-first lifecycle intents, atomic receipts, deterministic adoption, service-authenticated apply/sweep, account-deletion replay, replay bucket, and production `pattern-replay-2026-08` signing key/keyring are deployed; restore procedure recorded without claiming execution | implementation/signing complete; drill and admin identity evidence open |
| 2026-08-22 | 7 preflight | `24804ee` | `0012` | none | full typecheck, tests (including 1,650 API, 207 web, 19 signer), build/dry-run, contracts and 12-migration smoke pass; live corpus/release/pipeline inventories empty; signing, verification, and artifact keys absent | blocked on authorized corpus, keys, and pipeline-spend approval |
| 2026-08-22 | 8 preflight | `24804ee` | `0012` | none | four active accounts/charts and four confirmed en-US locales; zero current Pattern grants and zero eligible canary accounts; no authenticated canary session | blocked before reservation |
| 2026-08-22 | Auth0 canary preflight | `01049cc`, `b4e1770`; API `d784b0ea` (135) | `0012` | none active | existing identity reused through deployed Universal Login; SPA URL lists restored exactly after the unusable CLI loopback; Worker session accepted; canary `usr_3ca4f7c2f2498c4eab97511fc3c6ff97` is active with one chart and confirmed en-US; zero Pattern claims, jobs, documents, or grants; no reservation | canary prepared; Gate 8 remains blocked |
| 2026-08-22 | 9 preflight | `24804ee` | `0012` | none | static admin bearer remains; replay table has zero rows and no runtime writer/replayer/drill implementation; identity path and both draft designs await operator decision/approval | blocked before certification |
| 2026-08-23 | 10 | `9381693`; API `0aded7f1` | `0012` | none active | Gate 7B has no accepted machine release; Gate 8 has no designated/consented canary; Gate 9 drill and auditor identity remain open; rollout verified `off` | blocked by existing prerequisites; not attempted |
