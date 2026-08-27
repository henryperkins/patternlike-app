# Codex Daily Reading and Account-Wide Pattern Design

**Date:** 2026-08-27
**Status:** Approved design; implementation not started
**Owner:** Pattern/Like reader-facing generation

## Goal

Use the existing durable Codex runner as the only live model provider for both
daily readings and generated Patterns. Daily readings are generated proactively
for eligible, consented accounts and retain first-open repair. Generated Pattern
is available to every authenticated account that satisfies its product and
integrity prerequisites; no rollout cohort or account allowlist decides who may
use it.

Success means:

- a Daily or Pattern request never calls the OpenAI API directly and never
  falls back from Codex to another provider;
- Daily provider work can wait for the external runner without holding a
  Cloudflare Queue claim or spending a Daily retry;
- scheduled Daily generation and first-open repair converge on the same
  idempotent command and provider job;
- every authenticated account can enter the generated-Pattern flow after the
  existing chart, locale, consent, confirmation, ontology, quota, and
  one-Pattern-per-chart checks pass;
- prompts and raw responses stay out of D1 and logs, and user-owned Codex
  exchange artifacts are deleted after the owning workflow is terminal;
- published evidence identifies Codex truthfully while consent identifies
  OpenAI truthfully as the processor; and
- production remains off until the selected Codex account/workspace is
  contractually authorized for this unattended customer-application use and
  its applicable data controls are verified.

## Approved decisions

1. **Codex only.** Daily and Pattern use the supported local Codex CLI through
   the existing outbound-polling runner. There is no direct-OpenAI, Workers AI,
   or synthetic fallback in a live environment. Synthetic publishers remain
   test/development fixtures only.
2. **One durable control plane.** Extend `codex_provider_jobs`; do not add a
   synchronous Worker call or a second runner protocol.
3. **Account-wide Pattern.** Delete the Pattern rollout/cohort/allowlist
   admission layer. Authentication is the account boundary. Product safety and
   data-integrity checks remain mandatory.
4. **Explicit Pattern action remains.** Keep the dedicated Pattern consent and
   the exact confirmation phrase `GENERATE MY PATTERN`.
5. **Daily is proactive with repair.** Production uses the existing `hybrid`
   Daily mode: the 15-minute scheduler is primary and first-open is the
   fallback for missed or late work.
6. **Durable waiting and bounded retries.** Waiting for Codex consumes neither
   a Daily Queue lease nor a Daily attempt. Each actual new Codex invocation is
   budgeted, and deterministic rejection creates a fresh bounded provider
   attempt.
7. **No Pattern account gate returns under another name.** Provider budgets,
   authentication, consent, one-Pattern-per-chart, and public ontology evidence
   are invariants, not cohort switches.

## Relationship to prior designs

This document extends
`2026-08-24-codex-production-provider-design.md`; its runner security, lease,
encrypted-artifact, and authenticated protocol decisions remain normative.

For the implementation described here, this document supersedes only the
provider-routing, account-admission, consent-copy, and rollout portions of:

- `2026-08-10-openai-daily-reading-publisher-design.md`; and
- `2026-08-14-ai-generated-pattern-design.md`.

Their calculation, constrained-input, deterministic-validation, Pattern stage,
publication, erasure, and one-Pattern-per-chart contracts remain in force.
Deployment runbooks that still describe direct OpenAI or Pattern cohorts must be
updated in the implementation change; they are historical evidence until then,
not current authorization.

## Current gap

The existing pieces are individually functional but are wired for a different
product shape:

- Pattern already has a durable Codex path, but production is set to
  `PATTERN_AI_ROLLOUT="internal"` and names one account in
  `PATTERN_INTERNAL_ACCOUNT_IDS`.
- Daily is set to first-open only, its production cron omits the reading
  scheduler, its frozen command requires `publisher.provider === "openai"`, and
  execution constructs the direct OpenAI publisher.
- `codex_provider_jobs` accepts only `pattern|ontology` pipelines and has no
  Daily publisher pass.
- Codex owner-current checks, budgets, nudge repair, artifact retention, and
  maintenance know only Pattern and ontology.
- M5 provider contracts accept only `openai`, even though historical OpenAI
  evidence must remain readable after new Codex evidence is published.
- the current Daily and Pattern consent copy promises API-specific
  `store:false` behavior and says training is off. Those claims cannot be
  carried unchanged to a ChatGPT-authenticated Codex runner.

## Scope and non-goals

This design changes provider routing, durable Daily orchestration, Pattern
admission, consent wording/versioning, additive M5 provider contracts,
production scheduling, migration/runbook evidence, and affected tests.

It does not:

- weaken authentication, consent, chart ownership, locale confirmation,
  ontology activation, semantic validation, one-Pattern-per-chart, quotas,
  erasure, or publication integrity;
- replace or overwrite an accepted generated Pattern for the current chart;
- restore OpenAI as a fallback during a Codex outage;
- give the Codex runner database, R2, Cloudflare, application, browser, or
  calculation-service credentials;
- expose prompts, raw responses, reasoning, user ids, birth inputs, coordinates,
  or timezones in D1 or logs;
- add per-pipeline runner pools, priority scheduling, or autoscaling before
  queue-age evidence requires them;
- change frozen M0 contracts; or
- claim that a technically successful Codex CLI call is permission to run a
  production customer application under a consumer subscription.

## System boundaries

### Worker remains authoritative

The API Worker continues to own:

- authentication and user ownership;
- current consent and policy-version checks;
- Daily command freeze and Pattern stage commands;
- provider-call budgets;
- prompt-packet construction and exact JSON Schema;
- Codex job identity, leases, encrypted artifact inventory, and terminal state;
- deterministic output and semantic validation;
- Pattern ontology checks and signature/provenance verification;
- publication, invalidation, deletion, and retry decisions; and
- opaque queue nudges and scheduled repair.

The runner performs inference only. It receives one already-authorized prompt
and schema, invokes the supported `codex exec` surface, and reports structured
output or one closed safe failure.

### Runner isolation

Keep the current dedicated non-AGPL runner host and outbound-only HTTP model.
For every invocation the runner:

1. claims one job over authenticated TLS;
2. creates an owner-only temporary directory containing no repository or user
   files;
3. runs `codex exec --ephemeral --sandbox read-only --output-schema ... --json`
   with the prompt on stdin;
4. captures only the final structured result, safe request/thread metadata, and
   integer usage;
5. completes or fails the lease; and
6. deletes the temporary directory in a `finally` path.

`--ephemeral` prevents local session persistence. It is not represented to a
reader as an OpenAI server-side no-storage or retention guarantee.

The runner receives no user identifier. Daily's existing constrained provider
packet already omits the reading key, chart fingerprint, birth instant,
coordinates, timezone name, consent id, and storage ids. Pattern retains its
reviewed minimized packet. The empty working directory prevents Codex from
discovering unrelated host content through read-only tools.

## Account-wide generated Pattern

### Remove admission policy

Delete `pattern-rollout.ts` and all consumers of:

- `PATTERN_AI_ROLLOUT`;
- `PATTERN_INTERNAL_ACCOUNT_IDS`;
- `readPatternAiRollout`;
- `patternRolloutAllows`;
- `readInternalAccountIds`;
- `isInternalPatternAccount`;
- `consumerAdmissionEntry`; and
- `isPatternAiCohort`.

Remove those vars from `Env`, both Wrangler var blocks, the config guard,
health/config projections, tests, and deployment instructions. Pattern state no
longer branches to `editorial_catalog` because of an account cohort or active
editorial release. Existing editorial release data is not deleted, rewritten,
or used as authorization for model generation. The `editorial_catalog` wire
enum may remain for backward compatibility, but the authenticated Pattern state
path no longer emits it as an admission decision.

All authenticated accounts follow the same generated-Pattern state machine.
The resulting order is:

1. active chart required;
2. user-confirmed locale required;
3. active Pattern consent under the current policy required;
4. active public-capable ontology required;
5. no accepted/consumed Pattern claim for the current chart fingerprint;
6. exact confirmation phrase required at generation request; and
7. a configured Codex publisher and available provider budget required before
   an invocation can be claimed.

Existing accepted, deleted, withdrawn, superseded, and recalled claim semantics
remain unchanged. Removing an account cohort must not create a reroll or replace
an accepted Pattern. An unfinished legacy generation pinned to the superseded
`1.0.0` consent is cancelled by the ordinary current-consent check and can
restart only after the reader grants the new policy.

### Keep the public ontology integrity gate

The allowlist currently doubles as a bypass for internal ontology evidence.
That bypass is removed with the allowlist. Account-wide Pattern may use only an
active ontology that `ontologyServesAccount` can prove is public-capable from
machine-pipeline activation evidence.

An internal/synthetic release, an unevaluated release, a release missing passed
regression evidence, or a recalled release returns `ontology_unavailable` for
every account. This is a content-integrity invariant, not a replacement rollout
gate. Production cannot be described as account-wide working until this
precondition is proven on the deployed D1 state.

### Legacy paused rows

`rollout_paused` is removed as a normal Pattern transition. A bounded migration
or unconditional sweep repair clears legacy `rollout_paused` Pattern jobs after
their lease expires, moves them back to `queued`, clears the claim lease, and
lets normal current-owner checks decide whether to continue or cancel them.
This compatibility lane is idempotent and remains only while legacy rows can
exist; it does not read a new flag.

### Live publisher policy

In production and other non-development environments, Pattern configuration
accepts only `PATTERN_PUBLISHER="codex"`. A live `openai`, `workers_ai`, or
`synthetic` value is a configuration error. Development tests may inject a
synthetic publisher without making it a deployable fallback.

The compiled Pattern model, prompt, reasoning, timeout, and output-token pins
remain unchanged in this change. Their historical `OPENAI_PATTERN_*` names may
remain temporarily because they are model-family pins, not credentials; comments
must clarify this. Renaming them is cleanup, not a prerequisite.

## Daily over the durable Codex control plane

### New provider coordinate

Extend the closed provider vocabulary with:

- pipeline: `reading`;
- pass: `publisher`.

A Daily Codex job uses:

| Field | Value |
| --- | --- |
| `pipeline` | `reading` |
| `owner_id` | generic Daily `jobs.id` |
| `user_id` | Daily owner user id; required |
| `pass` | `publisher` |
| `stage_generation` | frozen `command.command_generation` |
| `stage_attempt` | zero-based provider attempt, derived as `jobs.attempts - 1` |
| `model` | frozen Daily model pin |
| `reasoning_effort` | frozen Daily reasoning pin |
| `prompt_version` | frozen Daily prompt pin |
| `timeout_ms` | `900000` |
| `daily_call_limit` | frozen positive Daily UTC-day ceiling |

The existing unique coordinate remains the idempotency authority. A duplicate
Queue delivery in one provider attempt adopts the same job. A deterministic
rejection or retryable terminal provider failure advances the Daily attempt and
therefore creates a new Codex coordinate.

### Daily state machine

`publisher_pending` becomes an internal generic-job control marker, not a public
failure class.

```text
Daily queued
  -> claim Daily lease and increment attempt
  -> prepare and verify frozen packet
  -> create/adopt Codex reading/publisher job
     -> pending or leased
        -> Daily running -> queued(publisher_pending), release Daily lease
        -> runner claims, budgets, invokes, completes/fails
        -> nudge clears dispatch marker and sends opaque Daily message
        -> repair cron does the same if send failed
     -> completed
        -> adopt, validate, publish, terminalize Daily
     -> failed
        -> map failure; retry with a fresh Daily/Codex attempt or terminalize
```

The Daily Queue message remains opaque: `{job_id, reading_id}`. Provider job ids,
prompts, and responses do not enter Queue messages.

### Attempt accounting

The generic Daily claim operation changes as follows:

- a normal queued claim increments `jobs.attempts`;
- a queued row with `result_class = 'publisher_pending'` reacquires the Daily
  publication lease without incrementing attempts;
- the first real provider attempt therefore has `jobs.attempts = 1` and
  `stage_attempt = 0`;
- pending/leased provider re-entry continues to use that coordinate;
- a retryable provider failure clears `publisher_pending`, records the actual
  safe failure class, and releases the Daily job through its existing retry
  policy; and
- the next normal claim increments attempts, so a new Codex job is used.

This separation is essential. A completed but schema-valid/semantically-invalid
candidate cannot be adopted forever, while an external runner wait cannot
consume all four Daily retries without making a call.

### Waiting without a Queue lease

When the provider job is pending or leased, the executor atomically returns the
Daily row to `queued`, sets `publisher_pending`, clears its claim token and
lease, and leaves `dispatched_at` set. It then acknowledges the current Queue
message. The outbox cannot redeliver continuously while the runner works.

Provider completion or failure performs a domain nudge:

1. recheck the provider lease and terminal commit;
2. clear the owning Daily job's `dispatched_at` only if that owner and command
   generation are still current;
3. send the ordinary opaque Daily Queue message; and
4. leave an undispatched marker for scheduled repair if Queue send fails.

As in Pattern, close the enqueue/completion race by reloading the provider job
after the Daily lease-release transaction. If it became terminal between the
initial read and release, nudge immediately. A duplicate message arriving before
completion safely sees `publisher_pending`, releases again, and spends nothing.

### Current-owner checks

A reading provider job is claimable and adoptable only when all are true:

- the generic owner job exists, is nonterminal, and has `job_type` for the
  Daily v5 generator;
- `daily_readings.active_generation_job_id` still names it;
- the user is active and owns both rows;
- the encrypted command decrypts and validates;
- its command generation and publisher pin match the provider coordinate;
- its pinned AI consent is still the current active grant;
- the reading has not been invalidated, superseded, or deleted; and
- Daily rollout/configuration still permits execution.

Because command and consent pins contain private values, the current-owner
check uses a read-only encrypted-command loader. It does not copy consent ids or
command content into clear D1 columns. If revocation, account deletion, command
replacement, or rollout-off makes the owner stale, cancel the provider job and
transition or nudge the Daily owner so it cannot remain stranded.

### Retry mapping

Retain the existing Daily policy:

- `publisher_unavailable`: retry at 60-second intervals up to the existing four
  actual provider attempts;
- `publisher_output_invalid` and `publisher_refused`: one fresh provider retry;
- authentication failure, unavailable model, and exhausted Daily budget:
  terminal, non-retryable for that command; and
- stale command, revoked consent, deleted user, or invalidated reading: cancel,
  with no replacement provider call.

There is no OpenAI fallback in any case. Runner lease expiry reclaims the same
Codex job. Every lease handed to a runner represents a possible real invocation
and consumes one provider-budget unit at claim, including a reclaimed lease;
creating, observing, or adopting a provider job is free.

### Legacy OpenAI commands

Published OpenAI readings and evidence remain readable. An unpublished frozen
command with `publisher.provider = "openai"` must never be executed through
Codex, because doing so would falsify its pin.

Add `publisher_superseded` to the internal M5 command-replacement reasons. On
encountering a legacy OpenAI command, terminalize it with that safe class and
use the existing automatic replacement path to freeze a new Codex command.
Replacement remains subject to current consent, command-generation limits, and
idempotency. No legacy command is silently edited in place.

For a published Codex Daily, `ModelRecordV5.provider_request_id` records the
safe Codex thread/request identifier already committed on the provider job. It
does not expose the provider job id, lease token, or artifact key.

## Scheduler and production configuration

Production changes to:

```toml
[env.production.triggers]
crons = ["*/15 * * * *", "7,22,37,52 * * * *"]

[env.production.vars]
READING_V5_ROLLOUT = "hybrid"
READING_PUBLISHER = "codex"
PATTERN_PUBLISHER = "codex"
```

`READING_V5_ROLLOUT` remains the Daily service kill switch because Daily already
has a reviewed pause/resume contract. `hybrid` enables both `scheduled` and
`first_open` entries. The existing scheduler eligibility, local-day resolution,
30-day activity window, lead/spread window, bounded batch, fact repair, and
idempotent reservation logic do not change.

The production config guard requires the Codex runner token, artifact keyring,
R2 binding, queues, positive budgets, and exact compiled pins. It no longer
requires `OPENAI_CREDENTIAL_SOURCE`, `OPENAI_API_KEY`, AI Gateway ids/token, or
an OpenAI gateway alias for Daily or Pattern. An unused OpenAI key is removed
only in a separate verified production action because deleting a Worker secret
immediately deploys a new version.

Daily uses model `gpt-5.6-sol`, reasoning `high`, prompt `1.0.1`, output ceiling
`4000`, input ceiling `98304`, provider timeout `900000`, and the existing
`10000` UTC-day call ceiling unless a separately reviewed pin or spend decision
changes them. The `OPENAI_READING_*` names may remain temporarily as model pins;
comments must stop describing them as proof of direct API routing.

The runner remains concurrency one for initial account-wide operation. Pattern,
Daily, and ontology share FIFO claim ordering. This is intentionally simple,
not a scale claim. Record oldest pending age and completed/failed counts by
pipeline. Add fairness or concurrency only after real queue-age evidence and a
separate capacity review.

## D1 migration

Create forward-only migration `0017` to rebuild both
`codex_provider_jobs` and its `codex_provider_response_uploads` child while
foreign keys remain enabled.

The migration:

1. creates a transaction-scoped staging table for every child upload row;
2. copies and asserts the child count;
3. creates the widened parent table;
4. copies every parent column explicitly and asserts the count;
5. drops the old child and parent in dependency order;
6. renames the widened parent;
7. recreates the child with its `ON DELETE CASCADE` foreign key and index;
8. restores child rows explicitly and asserts the count; and
9. removes staging state.

The widened checks are:

- `pipeline IN ('pattern', 'ontology', 'reading')`;
- `pass IN ('planner', 'writer', 'verifier', 'generator', 'evaluator',
  'publisher')`;
- `reading` permits only `publisher`;
- `pattern` permits only `planner|writer|verifier`;
- `ontology` retains its current five-pass vocabulary;
- `pattern|reading` require non-null `user_id`; and
- `ontology` requires null `user_id`.

All existing lifecycle, hash, encryption-envelope, lease, safe-failure, nonce,
unique-coordinate, and timestamp checks remain byte-for-byte equivalent. The
migration adds no prompt/response content column, changes no AEAD or KEK
version, and performs no ciphertext rewrite.

Update `MIGRATIONS.json` with an explicit forward-only note and add clean and
populated migration tests. Populated tests include every existing pipeline,
completed jobs with response metadata, response-upload children, and account
foreign keys. They compare copied rows byte-for-byte and prove all indexes,
closed checks, `PRAGMA foreign_key_check`, and `PRAGMA quick_check`.

## M5 contracts and provenance

M5 remains schema version `0.5.0`; this is an additive compatibility widening,
not a breaking replacement.

- widen the frozen publisher pin from `"openai"` to `"openai" | "codex"`;
- widen `ModelRecordV5.provider` the same way;
- preserve all old OpenAI valid fixtures and stored-reading guards;
- add valid Codex command, reading, evidence, saved-reading/export, and web
  fixtures;
- retain rejection fixtures for unknown providers; and
- update the M5 freeze note and descriptions that currently equate
  nondeterminism with OpenAI specifically.

New command construction always emits lowercase `codex`. New Daily evidence
and stored-reading validation preserve that value. The reader-facing disclosure
becomes:

> Generated with Codex by OpenAI from your calculated chart and enabled context.

Pattern's existing compact generation provenance continues to record display
provider `Codex`. Historical Daily `openai` and Pattern `OpenAI` provenance is
not rewritten.

## Consent, data controls, and terms gates

### Separate service provenance from processor identity

Codex is the generation service and published provenance. OpenAI is the data
processor/vendor. The existing consent wire field named `provider` remains
`OpenAI` for backward compatibility, but both Daily and Pattern UI label it
**Processor**, not **Provider**, and name **Codex** separately in explanatory
copy. D1 consent rows continue to store `provider = 'OpenAI'`.

Because the processing path and retention promise change materially, bump both
consent policies from `1.0.0` to `1.1.0`:

- `AI_SYNTHESIS_POLICY_VERSION`;
- `PATTERN_GENERATION_CONSENT_POLICY_VERSION`.

The existing loaders already treat an unknown/old policy as no active grant.
Every account therefore reviews and grants the new policy before any Daily or
Pattern packet is sent through Codex. Old consent rows stay in the audit chain;
they are not updated in place.

Remove the claims that requests are sent with provider-side storage disabled
and that granting consent leaves model training off by itself. Replacement copy
must state, in plain language:

- which calculated/optional content may be sent;
- that it is sent to Codex, operated by OpenAI, only for the named generation
  purpose;
- that Pattern/Like requires its production OpenAI account/workspace training
  controls to be off, but the reader's grant is not what controls OpenAI's
  account setting;
- that OpenAI retention follows the selected account/workspace agreement and
  settings and is not equivalent to API `store:false`;
- that Pattern/Like deletes its own encrypted Codex exchange artifacts after
  the owner is terminal; and
- that consent withdrawal stops unfinished and future work under the existing
  product semantics.

Final reader copy requires a privacy/legal review against the actual production
workspace and agreement. The implementation may ship behind
`READING_V5_ROLLOUT="off"`, but it may not be enabled with placeholder or
API-derived promises.

### Data-control evidence gate

Before a real user packet is sent, record evidence for the exact runner account
or workspace:

- account/workspace identity and governing agreement class;
- Codex Local enabled for the runner identity;
- training/data-sharing settings applicable to Codex tasks disabled;
- any separate full-environment Codex training control disabled;
- retention policy and deletion behavior;
- no feedback/evaluation opt-in that would share complete tasks; and
- date, reviewer, and a reminder that these settings can drift.

OpenAI documents that personal ChatGPT/Codex content may be used for training
unless the user opts out, while business products are excluded by default.
OpenAI also documents workspace-dependent retention rather than an API
`store:false` promise for ChatGPT-authenticated Codex. The deployment record
must reflect the actual account, not infer its posture from the CLI login
succeeding.

### Contractual-use gate

This workload is an unattended customer application processing third-party end
user content. A personal ChatGPT account is not presumed authorized: OpenAI's
consumer Terms of Use prohibit automatically or programmatically extracting
data or output. The Business Services Agreement expressly supports customer
applications for the API, but that sentence alone does not establish that a
ChatGPT-authenticated Codex seat may substitute for the API in this product.

Production enablement therefore requires written OpenAI confirmation, an Order
Form, or other governing business agreement that explicitly covers this
Codex-CLI runner pattern and end-user content. A Business/Enterprise login,
available credits, a successful model preflight, or a successful canary is not
contractual evidence. If this gate is not met, both reader-facing Codex paths
remain off; the design does not silently switch to the API because Codex-only
and no-fallback are approved requirements.

This is a release gate, not a claim of legal advice or a code-level check.

### Official sources for the external gates

The review and deployment record must recheck the then-current official pages;
these policies can change independently of the repository:

- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540)
  identifies which agreement and data controls govern a ChatGPT-authenticated
  Codex login.
- [How your data is used to improve model performance](https://help.openai.com/en/articles/5722486)
  distinguishes individual Codex/ChatGPT training choices from business-product
  defaults and notes separate Codex controls for full environments.
- [Enterprise privacy](https://openai.com/enterprise-privacy/) documents
  business training defaults and workspace-dependent retention.
- [Terms of Use](https://openai.com/policies/terms-of-use/) contains the
  consumer programmatic-extraction restriction.
- [OpenAI Services Agreement](https://openai.com/policies/services-agreement/)
  defines business customer applications, end-user obligations, and the API
  integration right; it does not by itself name this Codex-CLI substitution.

## Budgets, artifacts, and erasure

The Codex claim route chooses the existing ledger by pipeline:

- `pattern` -> Pattern provider usage;
- `ontology` -> ontology provider usage;
- `reading` -> `reading_provider_daily_usage`.

Budget reservation is atomic and immediately precedes returning a plaintext
invocation. No budget is consumed when creating a request artifact, polling,
observing pending state, completing, adopting, validating, or publishing.

Pattern and Daily provider artifacts are user-owned. Account deletion includes
their request object, every response-upload object, committed response object,
and D1 control rows before the user row is removed. Add a Daily deletion-manifest
test; the existing non-null `user_id` relationship is the deletion index.

After the owning Daily or Pattern workflow safely publishes, fails, cancels, is
revoked, or is deleted, best-effort cleanup deletes its Codex request/response
objects and rows. Scheduled maintenance repairs partial cleanup. This retention
is independent of Pattern's domain artifact retention and does not delete
published encrypted readings/documents or their compact provenance.

Ontology provider work remains non-user-owned and follows ontology run artifact
retention.

## Maintenance and observability

Extend Codex maintenance to all three pipelines. For reading it must:

- reclaim expired runner leases through the existing provider lease rules;
- cancel stale owners using the encrypted current-owner check;
- repair a missing Daily nudge after terminal provider completion;
- delete orphan/stale response-upload objects;
- delete terminal user-owned exchange artifacts; and
- emit only safe content-free counters and age metrics.

Required metrics/log fields are pipeline, pass, safe status/failure code, model,
job age, lease age, latency, integer usage, hashes, and queue-nudge outcome.
Never log prompt/output text, runner stderr, user ids, chart identifiers,
consent ids, birth facts, or generated prose.

Operational dashboards/queries distinguish at least:

- oldest pending Codex job by pipeline;
- pending/leased/completed/failed/cancelled counts by pipeline;
- safe failures by pipeline and code;
- Daily scheduler candidates/reservations/repairs;
- provider-budget use by ledger and UTC date; and
- terminal owner rows waiting for artifact cleanup.

## Verification

### Static and unit coverage

- config rejects every live Daily/Pattern publisher except Codex and has no
  OpenAI key/gateway dependency;
- M5 guards accept historical OpenAI and new Codex evidence and reject unknown
  providers;
- command construction emits Codex and never mutates a frozen OpenAI command;
- `publisher_superseded` creates a bounded automatic replacement;
- reading provider identity is stable across duplicate delivery;
- `publisher_pending` reacquisition does not increment Daily attempts;
- a true retry creates the next `stage_attempt`;
- encryption AAD binds reading pipeline/owner/pass/generation/attempt;
- reading current-owner checks reject stale command, consent, reading, and user;
- provider budget is charged exactly once per runner claim and never at
  create/adopt; and
- safe logs contain no content.

### Worker integration coverage

- scheduled Daily and first-open Daily converge on one reading and one Codex
  coordinate;
- pending and leased Codex jobs release the Daily Queue claim;
- completion before and after Daily lease release both nudge correctly;
- failed Queue send is recovered by scheduled maintenance;
- duplicate messages while pending spend nothing and publish at most once;
- runner lease expiry can reclaim the same provider job;
- unavailable output follows four-attempt Daily policy;
- invalid/refused output follows its one-retry policy and creates a fresh Codex
  coordinate after deterministic rejection;
- auth/model/budget failures terminalize without fallback;
- consent revocation and account deletion cancel work and remove artifacts;
- old OpenAI readings remain readable while unpublished OpenAI commands are
  superseded rather than executed;
- every authenticated non-allowlisted account reaches the same Pattern flow;
- Pattern still requires explicit consent and `GENERATE MY PATTERN`;
- accepted/consumed Pattern claims still prevent rerolls;
- internal or regression-incomplete ontology never serves any account;
- a public-capable active ontology admits account-wide Pattern; and
- legacy `rollout_paused` rows resume/cancel without a feature flag.

### Migration and contract coverage

- clean migration apply;
- populated parent/child preservation;
- all old and new CHECK combinations;
- response-upload cascade and index preservation;
- account-deletion foreign-key behavior;
- `foreign_key_check` empty and `quick_check` `ok`;
- every M5 valid and invalid fixture lane; and
- OpenAPI/shared/web type agreement.

### Real provider gate

Run at least one real Daily and one real Pattern through the same packaged
runner/protocol used in production, from the exact authorized account/workspace.
Capture content-free evidence for immutable candidate SHA, CLI version, model,
pipeline, terminal state, usage, hashes, D1 coordinate, encrypted R2 lifecycle,
budget delta, and published provenance. Do not print or attach prompt/response
content.

Finally run `npm run ci:local` on the pinned Node version and paste its complete
summary into the PR. GitHub Actions' billing-locked result is infrastructure
evidence only and does not replace this gate.

## Production sequence

Merging `main` triggers a Cloudflare Workers Build, so schema order is a hard
gate.

1. Freeze one immutable candidate SHA and produce a production dry-run build.
2. Obtain the contractual-use and data-control evidence above. Stop if either is
   missing.
3. Prove the active ontology has current public-capable machine activation and
   complete regression evidence. Stop if it does not.
4. Prove runner login, exact CLI version, claim auth, model availability,
   credits/allowance, and service liveness with no private user packet.
5. Take a production D1 export and time-travel bookmark; record counts and
   foreign-key baseline.
6. Rehearse `0017` against the export, including populated parent/child rows.
7. Apply `0017` to production **before merging**. Verify migration list, row
   preservation, checks, indexes, foreign keys, and quick check.
8. Merge/deploy the exact candidate SHA with Pattern's account gate removed but
   Daily still safely disable-able through `READING_V5_ROLLOUT` during smoke
   sequencing.
9. Verify the Workers Build deployed the exact expected version/SHA and the
   config guard is healthy.
10. Verify one consented scheduled Daily and one first-open repair through
    Codex, including provenance, budgets, D1/R2 state, and cleanup.
11. Verify Pattern from an authenticated account that was not on the old
    allowlist, with fresh consent and exact confirmation, through the public
    ontology and Codex runner.
12. Observe queue ages and failures across Daily, Pattern, and ontology before
    declaring the rollout complete.
13. Remove an unused `OPENAI_API_KEY` only as a separate staged deployment, then
    repeat config/health/provider-path verification.

No step may claim live success from source configuration, local tests, a model
GET preflight, or a prior successful Pattern alone.

## Rollback

- **Daily fault:** set the existing `READING_V5_ROLLOUT="off"`. Pending work
  pauses/cancels through current-owner rules; published readings remain
  readable. Restore `hybrid` only after repair.
- **Pattern fault:** there is intentionally no account cohort or Pattern product
  gate. Roll back the Worker version/config to the last known-good release.
  Existing Codex jobs remain durable and stale-owner checks prevent a rolled-back
  Worker from adopting incompatible work. A provider budget ceiling may stop
  new calls operationally, but it is not presented as a cohort switch.
- **Runner fault:** stop the runner service. Jobs remain pending or reclaimable;
  do not enable an OpenAI fallback.
- **Migration fault before merge:** restore D1 from the captured bookmark/export
  and do not merge. The Worker change must never precede `0017`.
- **Terms/privacy evidence withdrawn or settings drift:** stop the runner and
  disable Daily immediately; roll back the Pattern-capable Worker rather than
  sending another private packet.

Rollback never rewrites historical provenance or runs a frozen command under a
different provider.

## Acceptance criteria

The implementation is complete only when all of these are evidenced against one
immutable candidate:

- no Pattern allowlist/cohort/rollout admission remains in source or deployed
  config;
- every authenticated eligible account can request Pattern with fresh consent
  and exact confirmation;
- non-public ontology evidence blocks everyone;
- Daily scheduler and first-open repair both generate through Codex;
- no live Daily/Pattern OpenAI path or fallback can resolve;
- durable waiting, retry identity, budgets, nudge repair, erasure, and artifact
  cleanup pass their integration tests;
- M5 reads old OpenAI and new Codex evidence truthfully;
- new consent policies and disclosures are deployed and old grants fail closed;
- contractual-use and exact-account data-control gates are documented;
- `0017` precedes the Worker in production;
- real Daily and Pattern canaries pass through the production runner without
  content leakage; and
- the complete `npm run ci:local` summary is attached to the PR.
