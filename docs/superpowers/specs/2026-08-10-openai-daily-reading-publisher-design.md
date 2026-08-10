# OpenAI Daily Reading Publisher Design

**Date:** 2026-08-10

**Status:** Approved for implementation planning

**Scope:** Replace the active-editorial-release dependency in per-user daily
reading generation with an autonomous, configured OpenAI publisher; add the
calculated daily-sky facts required to keep every reading genuinely daily; and
preserve consent, calculation authority, provenance, encryption, queue safety,
and fail-closed behavior.

## Decision summary

The product will generate one personalized reading per user and local day with
OpenAI `gpt-5.6-sol`. The model is the sole prose publisher: a valid response is
published immediately without a human editor, a second model, or an active
signed editorial release.

This deliberately removes the existing dual-control safeguard over prose. It
does not remove the controls around factual calculation, user consent, private
data, structured output, deterministic validation, immutable job identity,
atomic publication, auditability, or bounded retries.

The approved choices are:

- use the existing D1 outbox and Cloudflare Queue consumer rather than creating
  a second Worker;
- generate proactively before the user's local day, with the existing
  first-open ensure path as an idempotent fallback;
- configure the provider and exact model in the Worker environment, with the
  OpenAI API key held only as a Worker secret;
- use all consented, reading-relevant information while always excluding
  identity, security, and operational fields that cannot improve a reading;
- keep calculated astrology facts authoritative and allow personal context to
  affect emphasis, tone, and reflection only;
- publish only output that passes deterministic validation; and
- fail closed after bounded retries, with no previous-day, deterministic,
  editorial-release, or alternate-model fallback.

## Goal

An eligible user can open Today and receive a coherent reading for their own
local day without an operator first authoring, signing, ingesting, and activating
an editorial bundle. The reading changes daily because it is grounded in a
versioned set of calculated day-specific sky facts as well as any eligible
longer personal cycles.

Success means:

1. the model never calculates or invents a placement, aspect, phase, date,
   degree, house, or birth-time-sensitive claim;
2. every astrological statement in the published artifact resolves to supplied
   calculation evidence;
3. all personal context was explicitly consented, source-eligible at execution,
   and used only in its permitted lane;
4. one user/local-day produces at most one live reading despite scheduler,
   first-open, retry, and duplicate-delivery races;
5. an unavailable provider or rejected draft produces an honest unavailable
   state rather than generic or stale prose; and
6. the user can inspect the calculation facts, categories of personal context,
   and exact generation configuration behind the reading.

## Product-contract change

“Calculated, not invented” remains the governing promise. Swiss Ephemeris and
the versioned application policies still establish the factual substrate and
eligibility boundaries. The model supplies interpretation and prose only.

The following incumbent guarantees are intentionally superseded for new v5
readings:

- reviewed editorial fragments no longer supply the reading language;
- an active signed content release is no longer a prerequisite;
- dual author/approver control no longer governs generated prose; and
- reviewed deterministic copy is no longer a fallback when generation is
  unavailable or invalid.

`apps/web/PRODUCT.md`, the normative product specification, and the Today
Impeccable surface brief must be amended explicitly when the feature is
implemented. Historical M3 documents remain truthful descriptions of the v3
path and are not rewritten as if the old architecture never existed.

## Chosen architecture

### Existing queue consumer with an OpenAI publisher adapter

The current durable flow remains the backbone:

1. A scheduler or authenticated first-open request builds and reserves an
   immutable generation command in D1.
2. D1 remains the durable outbox. Only the opaque `{job_id, reading_id}` message
   crosses Cloudflare Queues.
3. The existing single-message consumer claims the job with its compare-and-swap
   lease.
4. The consumer decrypts the command, rechecks consent, verifies every pinned
   input, invokes the calculation and OpenAI adapters, validates the result,
   encrypts the reading and evidence, and publishes them in the existing guarded
   D1 batch.
5. Duplicate deliveries, expired leases, and a crash between D1 and Queue send
   continue to converge through the existing claim and idempotency machinery.

The OpenAI adapter is a narrow provider boundary owned by the API workspace. It
accepts a closed, provider-neutral generation request and returns either a
validated candidate object or a typed provider failure. The reading service,
not the adapter, owns consent, context selection, astrology policy, publication,
and retry classification.

### Alternatives not selected

1. **Dedicated publisher Worker.** This would isolate the OpenAI credential and
   permissions, but it adds a deployment, service-auth boundary, and a second
   recovery surface while the present Worker already decrypts and assembles the
   same private inputs.
2. **Cloudflare AI Gateway.** This could centralize routing and telemetry, but it
   adds another processing layer and privacy configuration. Direct OpenAI calls
   keep the initial data path smaller. A gateway may be evaluated later without
   changing the provider-neutral adapter.
3. **Synchronous request-path generation.** This would make Today latency and
   availability depend on one long HTTP request and would discard the current
   durable retry semantics. First open therefore enqueues and polls; it never
   waits synchronously for OpenAI.

## Provider configuration and request boundary

The Worker environment gains these bindings:

- `READING_PUBLISHER=openai` — explicit route selection; an unknown or absent
  production value fails configuration validation;
- `OPENAI_READING_MODEL=gpt-5.6-sol` — the exact configured production model;
- `OPENAI_READING_REASONING=high` — the initial quality-first reasoning level;
- `OPENAI_READING_PROMPT_VERSION=<version>` — the deployed prompt contract;
- `OPENAI_READING_TIMEOUT_MS=90000` — one provider-call deadline;
- `OPENAI_READING_MAX_OUTPUT_TOKENS=1800` — a hard candidate ceiling;
- `READING_CONTEXT_MAX_BYTES=98304` — a hard serialized context-packet ceiling;
- `READING_PREGEN_ACTIVE_DAYS=30` — the initial recently-active window;
- `READING_PREGEN_LEAD_MINUTES=30` — generate the next edition thirty minutes
  before its local day; and
- `OPENAI_API_KEY` — a secret, populated from the already-authorized existing
  key through `wrangler secret put`, never a checked-in var.

The provider request uses the Responses API with:

- `store: false`;
- no OpenAI background mode;
- no tools, browsing, file search, code execution, or remote MCP servers;
- a strict JSON output schema;
- high reasoning effort and medium text verbosity; and
- the configured timeout, context-packet, and output-token ceilings.

The adapter does not silently change models, retry on another model, or relax
the output schema. Provider timeouts, 429s, retryable 5xx responses, and transient
network failures are typed as retryable. Authentication failure, an unknown
model, invalid configuration, refusal, and a response that cannot pass the
contract are terminal for that immutable command.

OpenAI states that API data is not used to train models unless the customer
opts in, while default abuse-monitoring logs may retain customer content for up
to 30 days. `store: false` avoids persisted Responses application state but does
not replace product-side minimization or consent. See [OpenAI data
controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

## Consent and privacy boundary

### Explicit AI-synthesis consent

The existing `ai_synthesis` consent kind becomes mandatory for v5 generation.
It remains distinct from `research` and `model_training`; enabling a product
reading never opts the user into either of those purposes.

Before the first OpenAI call, the user sees the provider, the categories of data
that may be processed, the purpose, the applicable policy version, and a direct
path to revoke consent. Consent is checked twice:

1. while building and encrypting the immutable command; and
2. immediately after the queue claim, before any private content is sent to
   OpenAI.

Revocation after enqueue therefore prevents the provider call. Revocation stops
future processing but does not silently erase an already-published reading;
existing export and deletion actions remain the controls for stored artifacts.

### Relationship to M4 context sources

The repository currently reserves check-ins and context-source ingestion for
M4, and those product routes are still honest stubs. M5 must implement the
minimum authenticated grant/revoke API required for the existing
`ai_synthesis` consent kind, but it does not manufacture journal, check-in, or
connector data that the product does not yet collect.

The publisher consumes every eligible source actually present when it runs.
When M4 later adds a registered source, that source becomes eligible for M5
through the same permission, allowed-use, freshness, and consent checks; no
provider-specific ingestion path is added. The privacy UI exposes only source
categories that are genuinely implemented and stored.

### Included information

The context compiler may consider the entire consented, reading-relevant corpus:

- exact birth date, time, place, accuracy, and uncertainty when permitted;
- the active natal chart and its calculation fingerprint;
- longer transit cycles and the new calculated daily-sky facts;
- confirmed local date, scheduling zone, locale, and domain preference;
- enabled journal entries, check-ins, saved reflections, and life-context
  signals;
- prior readings and feedback used to reduce repetition and learn preferred
  framing; and
- any later source that has an active source permission whose declared allowed
  uses include daily-reading synthesis.

“Consider” does not mean blindly serialize the whole account into every prompt.
The compiler evaluates the complete eligible corpus, then creates a bounded,
source-labelled packet containing all current calculation facts, recent
personal context, deterministically selected older excerpts and structured
metadata, and a repetition manifest. It does not use a hidden model-generated
summary step. Selection policy and packet-budget changes are versioned because
they can change the output for identical source records.

### Always-excluded information

The provider request never contains:

- email, name, raw application user ID, provider account ID, or session ID;
- authentication tokens, API keys, connector credentials, cookies, encryption
  material, or password-equivalent values;
- audit events, request logs, exception details, queue leases, device history,
  or unrelated operational metadata;
- disabled, paused, revoked, stale, or purpose-ineligible context sources; or
- research-only, support-only, or model-training-only data.

User-authored text is serialized as untrusted data inside a closed context
object. It cannot add instructions, change the output contract, enable tools,
or override the system policy. Logs record only request ID, provider/model
version, timing, token counts, typed result class, and hashes. They never record
the prompt packet, birth data, journal text, or generated prose.

The immutable command and any retained context manifest remain encrypted with
the user's DEK. New encrypted columns must be registered in
`ENCRYPTED_COLUMNS` before their first writer, and their AAD identity must be
covered by the existing rotation tests.

## Calculated daily-sky layer

### Why it is required

The frozen M3 cycle contract correctly permits an empty result and states that
most days may contain no cycle within the configured orb. Removing the reviewed
fallback without adding another factual source would therefore make a daily
reading impossible on ordinary zero-cycle days or tempt the model to manufacture
a day-specific premise.

V5 adds a distinct calculated daily-sky contract. The model still receives no
authority to calculate astrology.

### Calculation endpoint

Add `POST /v1/daily-sky` to the calculation service with closed M5 request and
response schemas. Do not widen or rewrite the frozen M3 `POST /v1/cycles`
contract.

The API resolves the user's local-day interval before calling the service. The
interval is represented as a half-open UTC range `[day_start, day_end)` and may
span 23, 24, or 25 hours across daylight-saving transitions. Local noon is the
stable anchor because it exists on ordinary DST transition days and avoids
using the instant the scheduler happened to run as a reading fact.

The request contains:

- `schema_version`, contract and policy identifiers;
- UTC day start, day end, and anchor instants;
- eligible natal longitudes;
- optional natal house cusps when birth-time accuracy permits them;
- the effective uncertainty and suppression list; and
- the requested zodiac, node, ephemeris, and calculation policy versions.

It contains no user ID, chart ID, birth instant, birthplace, timezone name,
account identifier, or storage identifier.

The response supplies ordered, opaque-ID facts for:

- geocentric planetary and lunar positions at the anchor;
- lunar phase at the anchor;
- exact transit-to-natal contacts whose exact instant lies in the local-day
  interval;
- sign ingresses and exact collective sky events in the interval; and
- transit house placements at the anchor only when the supplied house cusps and
  uncertainty policy allow them.

Anchor positions and lunar phase are always present when calculation succeeds,
so an empty event list does not mean an empty factual day. Every returned fact
carries its fact class, timestamps, applicable precision, policy versions,
ephemeris-data version, container digest, and a reproducible content digest.

### Fact lanes and selection

Reading priority is deterministic:

1. active personalized cycles;
2. exact daily transit-to-natal contacts;
3. collective daily-sky facts and events; and
4. stable natal context.

Personal context may choose emphasis among eligible facts but never promote a
non-fact into an astrological claim. A paragraph supported only by collective
sky is labelled as collective and may not imply that the configuration is
unique to the user. Unknown or approximate birth time suppresses houses, angles,
and time-sensitive natal Moon claims under the existing uncertainty policy.

## Context compiler and immutable command

`GenerateDailyReadingCommandV2` supersedes V1 for new reservations. The
encrypted command pins everything that could make a retry produce a different
reading:

- reading ID, opaque generation ID, local date, revision, reason, and command
  generation;
- scheduling zone, locale, and their confirmed provenance/revisions;
- active chart ID, fingerprint, contract, calculation versions, and uncertainty;
- cycle-scan request/response identity and ordered selected facts;
- daily-sky request/response identity and ordered selected facts;
- AI-synthesis consent ID, policy version, and job-time validity snapshot;
- selected personal-context source IDs, consent IDs, allowed-use lanes,
  normalized hashes, and encrypted text/value snapshots;
- model provider, exact model ID, reasoning level, prompt version, output schema,
  selection policy, and validation policy; and
- input-manifest and assembly-identity hashes.

The model-bound request is a smaller closed projection of that command. It uses
opaque fact and context references and carries no reading key, user ID, chart
fingerprint, storage key, queue ID, or consent record ID.

If a pinned chart or calculation artifact no longer matches, the command fails
without calling OpenAI and may enter the existing bounded command-replacement
path. If consent or a context source is no longer eligible, the source is not
silently dropped from an already-frozen prompt; the command is rejected and a
new command may be built only if the automatic replacement policy explicitly
permits it.

## Model input and output contract

### Input packet

The provider-neutral request has these logical sections:

- immutable system policy and style contract;
- reader locale, local date, and uncertainty instructions;
- calculated facts with pre-rendered factual labels and opaque IDs;
- personal context grouped by source category and allowed-use lane;
- prior-reading repetition signals;
- desired reading roles and length bounds; and
- the strict output schema.

The model is instructed not to compute, repair, reinterpret, or interpolate
missing facts. Degrees, timestamps, placements, aspects, houses, and phase names
may be stated only when present in the supplied fact object. Personal context
may shape relevance, tone, questions, and suggestions but cannot become evidence
for an astrological assertion.

### Structured candidate

The OpenAI response is parsed against a strict schema using [OpenAI Structured
Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). The
candidate contains:

- the echoed local date and locale;
- a short headline and lead, with the headline mapped to the existing quiet
  primary-theme kicker so the lead remains the visual focal point;
- an ordered set of role-bound paragraphs;
- one reflection prompt;
- an uncertainty note when required; and
- for every prose unit, the exact supporting `fact_ids` and optional private
  `context_refs`.

It does not contain provider metadata, raw reasoning, storage identifiers, HTML,
Markdown links, executable content, or instructions for the application.

### Deterministic validation

Publication requires every check to pass:

- exact JSON-schema conformance and closed-object enforcement;
- local date, locale, role order, paragraph count, and length bounds;
- every fact and context reference exists in the frozen input and is permitted
  for that paragraph's lane;
- every substantive astrology paragraph cites at least one calculated fact;
- no new body, target, aspect, house, sign, degree, phase, or timestamp appears
  outside the supplied facts;
- uncertainty-required features are either suppressed or qualified;
- collective facts are not described as uniquely personal;
- personal context is not described as an astrological discovery;
- no prompt, schema, hidden-instruction, identifier, or private-source leakage;
- no diagnosis, causal medical claim, guaranteed outcome, fatalistic prediction,
  or instruction to replace professional medical, legal, or financial advice;
  and
- canonical input/output hashes and evidence counts agree before the guarded
  publication batch executes.

There is no human review and no secondary-model review. A candidate that fails
one check is not partially published or repaired by deterministic prose.

## Contracts and versioning

M0 and M3 remain immutable. The frozen M3 manifest explicitly reserves
constrained-model assembly for M5, while M4 owns context-source ingestion and
Time Travel. Add `contracts/m5/` with schema version `0.5.0` and
an explicit supersession note for the daily-reading family.

The M5 package defines at least:

- `daily-sky-request.schema.json` and `daily-sky-response.schema.json`;
- `generation-command.schema.json` for `GenerateDailyReadingCommandV2`;
- `reading-generation-request.schema.json` for the provider-neutral boundary;
- `reading-generation-output.schema.json` for the strict OpenAI candidate;
- `daily-reading.schema.json` for `daily-reading-v5`;
- `reading-evidence.schema.json` for the v5 provenance graph;
- OpenAPI amendments for the calculation and product APIs;
- valid and invalid fixtures for every document; and
- a manifest that identifies the frozen predecessors and the intentional
  breaking changes.

`daily-reading-v5` keeps the reader-facing paragraph composition familiar but:

- fixes `assembly_mode` to `constrained_model`;
- removes `fallback_used` and the `safety_fallback` role;
- does not expose `release_version` or editorial content references;
- includes a quiet AI-generation disclosure; and
- links to v5 evidence whose model record is required rather than optional.

The v5 evidence graph stores calculated fact references, context categories and
opaque private references, provider and exact model, prompt/selection/validation
versions, calculation versions, hashes, token usage, provider request ID, and
the validation result. It does not store the raw prompt or repeat journal text.

## D1 migration and stored compatibility

Add a forward-only `0003_m5_openai_reading_publisher.sql` migration. It must
preserve non-empty v3 data rather than assume the reading tables are empty.

The migration rebuilds `daily_readings` and its dependent constraints so:

- `release_version` becomes nullable and remains populated for legacy rows;
- new rows use `assembly_mode = 'constrained_model'` and a null
  `release_version`;
- the existing per-user/local-day live and pending uniqueness rules remain;
- the reading key no longer requires a release version for new rows;
- the status model can distinguish an input-invalidated historical reading from
  a currently publishable one; and
- encrypted reading and evidence blobs remain byte-for-byte unchanged with the
  same record IDs and AAD identity.

Provider, prompt, calculation, context, and validation metadata stay inside the
encrypted reading/evidence envelopes unless a clear field is required for a
bounded operational query. Clear operational fields must not form a dictionary
oracle over private inputs.

The content-release tables, R2 objects, signing-key configuration, ingestion
routes, and historical audit records remain intact. They are legacy
infrastructure and cannot influence V2 command construction or v5 Today reads.
Their complete removal is a later migration with its own retention and rollback
review.

The migration proof must start from a populated M3 database, apply through the
normal Wrangler migration ledger, and demonstrate unchanged row counts,
readable legacy ciphertext, valid composite ownership foreign keys, empty
`PRAGMA foreign_key_check`, and `PRAGMA quick_check = ok`.

## Scheduling and reading lifecycle

### Hybrid generation

Add a Worker `scheduled` handler and a sub-hourly cron. A 15-minute cadence is
required because IANA zones include quarter-hour and half-hour offsets.

`users.next_due_at` is the scheduling cursor. After every successful reservation
or evaluated no-op, the scheduler resolves and stores the next pre-generation
instant as thirty minutes before the next local day in the user's confirmed
zone. Timezone changes recompute it. The
scheduler selects bounded rows by `next_due_at`, never scans and converts every
user timezone on each invocation.

Pre-generation applies only when all of these are true:

- account and chart are active;
- timezone and locale are confirmed;
- AI-synthesis consent is granted;
- the account has a non-revoked session seen within
  `READING_PREGEN_ACTIVE_DAYS`; and
- no pending or published current-generation reading exists for the target day.

Inactive but otherwise eligible users are generated on first open. Scheduler
and first open call the same reservation service and converge on the same
user/local-day/generation identity.

### Stable daily edition

A successfully published reading is stable for that local day. New journals,
check-ins, ordinary preference changes, and feedback affect the next day's
context rather than silently rewriting prose already seen.

A birth-profile correction, chart correction, calculation defect, or other
change that invalidates factual inputs is different. The read path must not
serve the old reading as current once its chart/calculation fingerprint is known
to be invalid. The old encrypted artifact remains in revision history, while a
replacement is generated as a new revision. If the replacement fails, Today is
unavailable rather than showing the factually invalid predecessor.

Consent revocation does not retroactively rewrite a valid published reading. It
prevents all later provider calls and is reflected in future source selection.

### Failure and retries

The queue retains its platform retry budget and adds typed application policy:

- transient calculation/provider/network failures retry with bounded
  exponential delay and jitter;
- invalid model output may receive one fresh provider attempt under the same
  frozen command, never a prompt relaxation;
- configuration, consent, integrity, policy, or exhausted-budget failures are
  terminal; and
- a terminal initial reading remains failed and unpublished.

There is no automatic model downgrade, previous-reading reuse, deterministic
copy, or editorial-release fallback. Operational rollback may disable new
generation, but it must not silently reactivate the v3 publisher.

## Product API behavior

Keep the current authenticated route names:

- `PUT /v1/readings/today` ensures the server-resolved current local-day
  reading, enqueuing when required;
- `GET /v1/readings/today` remains read-only; and
- `GET /v1/readings/{id}/evidence` returns the owner-scoped provenance graph.

New v5 results use the existing success/preparation rhythm:

- `200`: a published v3 or v5 response, projected by its own versioned reader;
- `202`: preparation is queued or running;
- `409 ai_synthesis_consent_required`: the user must review and grant the
  OpenAI synthesis consent;
- `409 timezone_confirmation_required` or
  `locale_confirmation_required`: existing preference gates;
- `404 chart_not_found`: onboarding is incomplete;
- `424 reading_generation_failed`: the immutable attempt is terminal; and
- `503 publisher_not_configured`, `publisher_unavailable`, or
  `calc_unavailable`: a safe infrastructure response before a terminal command
  result exists.

`release_not_active` and `release_unreadable` are not possible on the v5 path.
All errors use the existing safe envelope and request ID. Product responses do
not expose job IDs, raw provider errors, prompt contents, or private source
identifiers.

During rollout the API decodes both v3 and v5 encrypted records. New
reservations use V2/v5 only after the feature configuration is enabled. Legacy
records remain readable and are never rewritten merely to make them look new.

## Today and Context & Privacy experience

This feature preserves the approved Today “Lead Line” composition, app shell,
typography, responsive layout, and evidence drawer. It does not introduce a new
visual world.

### Consent gate

Before the first OpenAI reading, Today renders a focused consent state that
names:

- OpenAI as the processor and `gpt-5.6-sol` as the configured model family;
- the enabled data categories;
- the purpose—generating the user's daily reading;
- the fact that API processing is not product model-training consent;
- the ability to change source categories or revoke later; and
- a link to the applicable privacy details.

The primary action grants `ai_synthesis` under the displayed policy version.
Consent is never inferred from chart calculation or existing account-processing
consent.

### Reading states

- **Loading:** retain one mounted polite live region and stable page heading.
- **Preparing:** say the reading is being grounded in the calculated chart,
  daily sky, and enabled context. After the current 15-second threshold, say it
  is taking longer and that the user may leave and return.
- **Ready:** preserve the editorial column and add a restrained disclosure:
  “Generated with OpenAI from your calculated chart and enabled context.”
- **Failed:** say today's reading could not be generated, offer the existing
  stable retry control, and show the request ID. Never mention an active release
  or suggest that generic copy is being substituted.
- **Revised:** preserve the revision chip and disclose why in provenance.
- **Unauthorized, onboarding, timezone, and locale:** retain their dedicated
  flows.

The old reviewed-fallback note and `safety_fallback` rendering disappear for v5
while remaining readable for an historical v3 response.

### Why this reading?

The existing lazy evidence drawer presents three progressively technical
layers:

1. **Calculated facts:** readable labels for the personal cycles, daily
   contacts, or collective sky facts behind each paragraph;
2. **Personal context:** categories and permitted use—never raw journal or
   check-in text; and
3. **Generation record:** OpenAI, exact model, prompt/selection/validation and
   calculation versions, generation time, revision, and integrity identifiers.

The drawer distinguishes personalized and collective facts in plain language.
Opaque fact IDs and provider request IDs remain development or technical-detail
information rather than primary reader copy.

### Context & Privacy

The privacy surface adds controls to:

- grant or revoke AI-synthesis consent;
- enable or disable each context-source category that is actually implemented;
- see the current provider, purpose, and policy version; and
- reach existing export and account-deletion actions.

Controls use the incumbent square, flat, paper-and-rule system, preserve visible
focus, announce status changes, and meet the existing WCAG 2.2 AA target.

## Verification strategy

### Calculation contracts and goldens

- validate the closed daily-sky request and response schemas;
- prove half-open event-boundary behavior;
- cover 23-, 24-, and 25-hour local days and quarter-hour/half-hour zones;
- verify deterministic ordering and stable fact IDs;
- compare positions, lunar phase, ingresses, and exact contacts against pinned
  ephemeris golden vectors;
- suppress houses, angles, and time-sensitive natal Moon facts at the required
  accuracy levels; and
- prove the request carries no user ID or raw birth data.

### Context and provider unit tests

- explicit AI-synthesis consent is mandatory and separate from training or
  research consent;
- revocation after enqueue prevents any provider fetch;
- disabled, stale, or purpose-ineligible sources are excluded;
- all allowed source categories can participate in deterministic selection;
- identifiers, credentials, logs, and encryption material never serialize;
- user text that resembles a prompt remains inert data;
- OpenAI requests set `store: false`, contain no tools, and pin the configured
  model and prompt version;
- every provider and validation failure maps to the intended retry class; and
- no log line contains prompt or response content.

### Model-output and evaluation tests

- accept representative grounded readings for exact, approximate, and unknown
  birth times;
- accept a zero-cycle day grounded in daily-sky facts;
- reject unknown fact/context IDs, unsupported astrology vocabulary, wrong
  dates/degrees/houses, collective-as-personal claims, prompt leakage,
  diagnostic language, guarantees, and malformed role order;
- require every astrological prose unit to cite calculated evidence;
- maintain a synthetic evaluation corpus for grounding, uncertainty, usefulness,
  personalization, repetition, tone, and safety; and
- require any model, prompt, selection, or validation-policy change to pass the
  corpus and increment its version.

The ordinary test suite uses a deterministic fake OpenAI server. A live API
evaluation is an explicit, separately invoked lane using synthetic profiles
only; it never sends real user data from development or production.

### D1 and queue integration

- migrate a populated v3 database without losing or rewriting encrypted rows;
- validate legacy v3 reads and new v5 writes side by side;
- prove scheduler/first-open races create one reservation and job;
- prove duplicate delivery and expired-lease recovery remain safe;
- cover consent revocation, chart invalidation, timezone rollover, provider
  timeout/refusal/429/5xx, malformed output, exhausted retries, and atomic
  publication;
- prove a failed fact-invalidating replacement does not expose the invalidated
  predecessor as today's current reading; and
- prove no release pointer or R2 content bundle is read by a V2 generation job.

### Web

- consent gate content and keyboard flow;
- preparing, delayed, terminal failure, retry, ready, revised, and unauthorized
  states;
- automatic polling without repeated live-region announcements;
- visible OpenAI disclosure and the three provenance layers;
- no raw journal excerpts or technical identifiers in reader-facing evidence;
- v3 historical fallback compatibility and v5 absence of fallback UI;
- focused accessibility checks; and
- desktop and mobile captures at the established 1440x1000 and 390x844
  viewports.

### Full candidate gate

Run focused tests through TDD, then fresh root `npm run typecheck`, `npm test`,
and `npm run build`. Validate both contract manifests and prove
`contracts/m0/` and `contracts/m3/` are unchanged. Run the Impeccable detector
once over the final changed UI targets, inspect desktop and mobile together in
one bounded browser pass, apply one batched correction if required, and confirm
once.

## Rollout and operations

Code completion, migration, secret configuration, deployment, cron activation,
and production acceptance are separate gates.

The production sequence is:

1. back up D1 and record the time-travel bookmark;
2. deploy dual v3/v5 readers and the forward-only migration while v5 generation
   remains disabled;
3. prove schema, ledger, row counts, foreign keys, integrity, and legacy reads;
4. set the existing authorized OpenAI key as `OPENAI_API_KEY` and configure the
   exact publisher/model/prompt variables;
5. run synthetic calculation and OpenAI canaries without real user context;
6. enable v5 generation for an internal consented account and prove one complete
   queue-to-publication-to-evidence flow;
7. enable first-open v5 generation; and
8. enable the 15-minute hybrid scheduler only after first-open production proof.

Operational metrics are limited to generation counts, queue age, latency,
attempts, token use, validation and failure classes, model/prompt versions, and
hashes. Alert on growing queue age, sustained provider failures, validation-rate
changes, generation latency, and unexpected token growth. Prompt, context, and
prose logging is forbidden.

Rollback disables new v5 reservations and the scheduler, then rolls back Worker
code only to a version that understands the migrated schema. It does not rewind
D1, delete v5 artifacts, silently select a different model, or reactivate an
editorial release. Published v5 readings remain readable; users without a valid
reading see the honest unavailable state.

## Out of scope

- using journal or account data to train or fine-tune a model;
- implementing the M4 check-in, journal-ingestion, connector, or Time Travel
  surfaces merely to create additional data for this publisher;
- giving OpenAI tools, live database access, connector access, browsing, or
  autonomous external actions;
- allowing the model to calculate charts or daily sky;
- a second model acting as editor, judge, or fallback;
- automatic provider or model failover;
- deleting historical content-release records, R2 objects, routes, or audits;
- retroactively regenerating every historical reading;
- notifications or email delivery;
- changing neighboring Pattern, Timing, or Time Travel presentation except
  where a shared contract type must remain compatible; and
- production deployment or secret mutation as an implicit consequence of
  implementing the code.
