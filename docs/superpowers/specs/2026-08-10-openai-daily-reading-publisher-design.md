# OpenAI Daily Reading Publisher Design

**Date:** 2026-08-10

**Status:** Approved for implementation planning on 2026-08-10

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
- use all consented, reading-relevant information while excluding direct
  account identifiers, raw birth data, security material, and operational
  fields that cannot improve a reading;
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
- `OPENAI_READING_PROMPT_VERSION=1.0.1` — the deployed prompt contract;
- `OPENAI_READING_TIMEOUT_MS=90000` — one provider-call deadline;
- `OPENAI_READING_MAX_OUTPUT_TOKENS=4000` — a hard response ceiling shared by
  reasoning and visible structured output; `output_tokens` includes both, so
  this is not a 4,000-token prose allowance;
- `READING_CONTEXT_MAX_BYTES=98304` — a hard serialized context-packet ceiling;
- `READING_PREGEN_ACTIVE_DAYS=30` — the initial recently-active window;
- `READING_PREGEN_LEAD_MINUTES=30` — generate the next edition thirty minutes
  before its local day;
- `READING_PREGEN_SPREAD_MINUTES=45` — deterministically advance reservations
  into one of four 15-minute buckets from zero through forty-five additional
  minutes, spreading common `:00` zones without cron-rounding away the lead;
- `READING_SCHEDULER_BATCH_LIMIT=100` — the maximum users examined by one cron
  invocation;
- `READING_DAILY_PROVIDER_CALL_LIMIT=<approved positive integer>` — a required
  UTC-day ceiling shared by scheduled, first-open, and retry calls; production
  configuration is invalid until an operator approves and sets the number; and
- `OPENAI_API_KEY` — a secret, populated from the already-authorized existing
  key through `wrangler secret put`, never a checked-in var.

`gpt-5.6-sol` was verified on 2026-08-10 both against the
[official model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
and in the authorized account's live `/v1/models` list. The implementation
must repeat the live account check before a model value is allowed to gate
production configuration, and again for every later model change. Runtime
`checkSecureConfig` then checks the exact preflight-approved value; consent copy
names the provider, while the exact model ID belongs in the Generation record.

The provider request uses the Responses API with:

- `store: false`;
- no OpenAI background mode;
- no tools, browsing, file search, code execution, or remote MCP servers;
- a strict JSON output schema;
- high reasoning effort and medium text verbosity; and
- the configured timeout, context-packet, and output-token ceilings.

The adapter does not silently change models, retry on another model, or relax
the output schema. It returns a typed provider result; the shared generation
failure policy below, rather than the adapter, decides queue retry and command
replacement. No queue delivery makes more than one provider call.

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

The local context compiler may consider the entire consented,
reading-relevant corpus, but the provider projection contains only what is
needed to write the reading:

- birth-accuracy label, the derived uncertainty report, and the suppression
  list; never the birth instant, birthplace, or coordinates;
- eligible calculated natal facts, without the chart's storage fingerprint;
- longer transit cycles and the new calculated daily-sky facts;
- confirmed local date, locale, and domain preference, without the IANA
  scheduling-zone name;
- enabled journal entries, check-ins, saved reflections, and life-context
  signals;
- prior readings and feedback used to reduce repetition and learn preferred
  framing; and
- any later source that has an active source permission whose declared allowed
  uses intersect the closed M5 lane set below.

“Consider” does not mean blindly serialize the whole account into every prompt.
The compiler evaluates the complete eligible corpus, then creates a bounded,
source-labelled packet containing all current calculation facts, recent
personal context, deterministically selected older excerpts and structured
metadata, and a repetition manifest. It does not use a hidden model-generated
summary step. Selection policy and packet-budget changes are versioned because
they can change the output for identical source records.

Raw birth instant and coordinates are the account's most identifying fields and
remain inside the envelope-encrypted product/calculation boundary. `store:
false` is not treated as a mitigation for sending them. Any future proposal to
cross that boundary is a new privacy design requiring explicit review and Zero
Data Retention eligibility before implementation.

### Allowed-use composition

M5 does not add `daily-reading synthesis` or any other value to the byte-frozen
M0 `allowedUse` enum. `ai_synthesis` is the outer account-level purpose consent;
it is not an `allowed_use` value and cannot make an otherwise ineligible signal
eligible.

For each possible use, the compiler computes this exact intersection:

`signal.allowed_uses ∩ active source-consent.allowed_uses ∩ M5_SUPPORTED_USES`

It then freezes one `pin.allowed_use` per selected signal/use pair. Execute must
again prove that exact value is still present in both the signal and consent
arrays before it calls the shared eligibility partition.

`M5_SUPPORTED_USES` is this existing M0 subset:
`annual_context`, `environment_context`, `life_domain_selection`,
`narrative_continuity`, `optional_recommendations`, `pattern_profile`,
`reflection_prompt`, `relationship_interpretation`, `repetition_control`,
`routine_context`, `theme_eligibility`, `theme_filtering`, `theme_ranking`,
`tone`, `travel_context`, `user_memory`, and `workload_context`. Theme tokens
control admission and emphasis; context/profile tokens may frame relevance;
continuity/memory tokens may connect or de-duplicate; and recommendation,
reflection, and tone tokens may affect only those response forms. A source may
affect only its exact intersecting lanes. Each lane is pinned and rechecked; M5
never upgrades, aliases, or silently substitutes an allowed-use value.

### Always-excluded information

The provider request never contains:

- email, name, raw application user ID, provider account ID, or session ID;
- raw birth date, time, instant, place, coordinates, timezone name, or birth
  payload;
- authentication tokens, API keys, connector credentials, cookies, encryption
  material, or password-equivalent values;
- audit events, request logs, exception details, queue leases, device history,
  or unrelated operational metadata;
- disabled, paused, revoked, stale, or purpose-ineligible context sources; or
- research-only, support-only, or model-training-only data.

User-authored text is serialized as untrusted data inside a closed context
object. It cannot add instructions, change the output contract, enable tools,
or override the system policy. Because enabled user-authored text may itself
mention a person or place, the product does not claim that free text is
de-identified; the consent UI names that category plainly. Logs record only
request ID, provider/model
version, timing, token counts, typed result class, and hashes. They never record
the prompt packet, birth data, journal text, or generated prose.

The immutable command and any retained context manifest remain encrypted with
the user's DEK. Before the compiler gains its first context-signal writer,
`context_signals.value_enc` moves from `UNWRITTEN_ENCRYPTED_COLUMNS` to
`ENCRYPTED_COLUMNS`; this is a list move, not a new-column registration. Any
other new encrypted column must be registered before its first writer, and all
AAD identities remain covered by rotation tests.

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

The resolver uses the pinned IANA database and a closed disambiguation rule.
For an ambiguous nominal noon it selects the earlier offset; for a missing noon
on an otherwise representable date it selects the first valid instant after
noon and records that resolution in the calculation request. If an entire local
date is unrepresentable after a date-line change, no reading is generated for
that date: the scheduler records `skipped_local_date` and advances to the next
representable date. These decisions are golden-tested and are part of the
daily-sky request identity.

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
encrypted command pins everything that defines the eligible input:

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
- the canonical input-manifest hash and `generation_input_id`.

### One eligibility-and-identity entry point

V5 removes deterministic prose assembly, not deterministic eligibility. Add one
pure exported `prepareConstrainedReadingInput()` entry point in
`packages/reading-engine`. It must call the existing
`packages/reading-engine/src/eligibility.ts` partition internally, apply fact
suppression and deterministic context/fact selection, and return the selected
sets, the closed model projection, `input_manifest_canonical`, and
`identity_canonical`. Callers must not call a lower-level identity builder or
recreate the eligibility partition.

The enqueue path runs the complete entry point and hashes
`input_manifest_canonical` into `input_manifest_hash` and
`identity_canonical` into a domain-separated `gin_sha256_...`
`generation_input_id`. After claim, the execute path reconstructs the frozen
inputs, rechecks their live eligibility, runs the same complete entry point,
and compares both hashes before any provider call. A mismatch is
`generation_input_id_mismatch`, a terminal integrity defect. The existing v3
path retains its assembler-derived `assembly_id`; v5 does not overload that
name.

`generation_input_id` identifies the frozen eligible input and policy, not the
prose. OpenAI is nondeterministic: two legitimate deliveries against one frozen
command may return different candidates. The encrypted artifact's
`content_hash` and provider-response hash identify the candidate that actually
won publication.

That makes the existing guarded `completeReading` claim compare-and-swap
load-bearing. Publication must assert the active job ID, claim token, command
generation, running job state, and pending reading state in the same D1 batch
that stores evidence and marks the reading published. At most one candidate can
win. A late or duplicate response that loses any assertion is discarded; it is
never compared for textual equality and never overwrites the winner.

The model-bound request is a smaller closed projection of that command. It uses
opaque fact and context references and carries no reading key, user ID, chart
fingerprint, storage key, queue ID, or consent record ID.

If a pinned chart or calculation artifact no longer matches, the command fails
without calling OpenAI and may enter the existing bounded command-replacement
path. If consent or a context source is no longer eligible, the source is not
silently dropped from an already-frozen prompt; the command is rejected and a
new command may be built only if the automatic replacement policy explicitly
permits it.

### Reservation and Worker integration changes

The reservation layer must use a discriminated V1/V2 command union. For V2,
both initial and reissue INSERTs bind `assembly_mode = 'constrained_model'` and
`release_version = NULL`; they must stop hardcoding `deterministic`.
`replaceCommand` updates `assembly_mode`, nullable `release_version`, v5
`reading_key`, chart/contract identity, and the active job consistently when it
installs a later command generation. V1 continues to bind `deterministic` and a
release version.

The Worker default export gains `scheduled` alongside `fetch` and `queue`.
Because cron and Queue do not pass through Hono, `scheduled()` must call
`checkSecureConfig` directly before reading a due row or reserving a command,
exactly as `queue()` does. `run_worker_first` needs no change: the new entry
point is not an HTTP route, and existing product routes remain under `/v1/*`.

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

M5 context references reuse the frozen M0 `allowedUse` definition and constrain
it to `M5_SUPPORTED_USES`; they do not copy or extend the closed enum.

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

`contracts/validate_schemas.py` is part of the contract change. It must add M5
paths, the M5 per-file `$defs` map, fixture base-URI mappings, the `m5` package
registry entry, OpenAPI validation, and the third manifest. The existing M0
automated freeze proof remains. M5 also adds an automated M3 predecessor proof
outside the frozen directory: pin the M3 manifest digest and fail when
`contracts/m3/` is dirty. The final gate therefore validates three manifests
and automatically proves both frozen predecessor directories unchanged; it
must not describe today's manual M3 check as if it already existed.

## D1 migration and stored compatibility

Add a forward-only `0003_m5_openai_reading_publisher.sql` migration, but choose
its path from measured production state. Before applying it, record counts for
`content_releases`, `daily_readings`, `reading_sources`, and
`reading_feedback`. Because `daily_readings.release_version` is currently
`NOT NULL REFERENCES content_releases(version)` and production has no content
release, the expected reading-table counts are zero; the deployment gate proves
that expectation rather than assuming it.

When `daily_readings`, `reading_sources`, and `reading_feedback` are all empty,
0003 reuses 0002's safe shape:

1. `assertion_probe` preflights abort if any dependent reading row exists;
2. drop `reading_sources` and `daily_readings` under the same documented foreign
   key procedure as 0002; and
3. create the final table names and dependent indexes directly.

It must not build side tables and rename them: SQLite rewrites REFERENCES on
rename only under the relevant foreign-key setting, and
`reading_sources(reading_id, user_id)` is a composite child. If any dependent
reading row is present, the migration stops before a DROP. A separately
authorized application-layer export/decrypt/re-encrypt/copy and verification
plan is then required; the design does not pretend generic D1 SQL can preserve
those encrypted, AAD-bound rows.

The empty-table rebuild defines:

- nullable `release_version`, populated only for legacy-format rows;
- `assembly_mode = 'constrained_model'` with null `release_version` for v5;
- status values `pending | published | failed | superseded | invalidated`;
- nullable `invalidated_at`, required exactly when status is `invalidated`;
- the existing per-user/local-day revision, live, pending, successor, and
  composite-ownership constraints; and
- the existing encrypted reading/evidence column names and AAD identities.

V5 `reading_key` has the closed shape
`reading-v5:<user_id>:<YYYY-MM-DD>:r<positive-revision>`. It is stable across
command-generation replacements and never enters the model packet. Legacy keys
start with `user:` and contain the release field, so the literal
`reading-v5:` namespace makes the two grammars disjoint under the retained
global `UNIQUE (reading_key)` constraint; a three-value v5 key cannot collide
with a legacy four-value key.

Provider, prompt, calculation, context, and validation metadata stay inside the
encrypted reading/evidence envelopes unless a clear field is required for a
bounded operational query. Clear operational fields must not form a dictionary
oracle over private inputs.

The content-release tables, R2 objects, signing-key configuration, ingestion
routes, and historical audit records remain intact. They are legacy
infrastructure and cannot influence V2 command construction or v5 Today reads.
Their complete removal is a later migration with its own retention and rollback
review.

Migration tests start with an empty M3-shaped reading schema and prove final
constraints, `PRAGMA foreign_key_check`, and `PRAGMA quick_check = ok`. A second
fixture inserts a dependent row and proves the preflight aborts before any table
is dropped. Production proof records the counts, migration ledger, final schema,
foreign-key check, and quick check. The earlier populated-M3 proof claim is
removed unless production counts actually force the separately authorized
backfill path.

## Scheduling and reading lifecycle

### Hybrid generation

Add a Worker `scheduled` handler and a sub-hourly cron. A 15-minute cadence is
required because IANA zones include quarter-hour and half-hour offsets. Cadence
does not solve load concentration: most users share `:00` zones. For target date
`D`, due time is the first instant of `D` in the confirmed zone, minus the
30-minute lead, minus `15 × (SHA-256(user_id, D) mod 4)` minutes. Readings are
therefore reserved in four aligned buckets 30, 45, 60, or 75 minutes early
without changing their factual day.

`users.next_due_at` is the scheduling cursor. 0003 adds
`idx_users_next_due_at` over `(next_due_at, id)` for active non-null rows and
`idx_users_unseeded_due` over `(created_at, id)` for active null rows. Each cron
uses one shared `READING_SCHEDULER_BATCH_LIMIT` in this order: repair eligible
failed commands for the current/next local day, reserve due readings, then seed
null cursors with the remaining quota. 0003 adds
`idx_daily_readings_failed_generation` on `(updated_at, user_id)` for failed
rows below `MAX_COMMAND_GENERATION`, and `idx_jobs_failed_result_class` on
`(result_class, finished_at, id)` for failed jobs; advancing
`next_due_at` after the original reservation therefore cannot hide a 23:30
provider failure from automatic repair. Account creation, timezone
confirmation/change, chart activation, consent change, and qualifying activity
also recompute the cursor. An ineligible account still receives the next daily
check time, so a null value never becomes an unbounded rescan sentinel.

After every successful reservation or evaluated no-op, the scheduler advances
the cursor. It derives a local-day start as an instant and subtracts real elapsed
minutes, rather than constructing an ambiguous wall-clock `23:30`. If a cron
gap leaves a cursor in an older local date, it records skipped dates and
considers only the user's current day and next pre-generation target; it never
backfills stale prose. If an IANA date is wholly unrepresentable, it records
`skipped_local_date` and advances to the next representable date.

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

Wrangler keeps `max_batch_size = 1` and sets the Queue consumer's
`max_concurrency = 4`; it may be raised only after queue-age, OpenAI tier, and
cost canaries. The scheduler dispatch cap is 100 reservations per invocation.
0003 also adds a non-user-keyed `reading_provider_daily_usage` counter. Before
each provider call, D1 atomically consumes one unit from the configured UTC-day
budget; retries and first-open calls use the same counter. Budget exhaustion is
`publisher_budget_exhausted` and makes no provider call. Because request bytes
and output tokens are separately capped, the required call limit gives a
computable worst-case daily spend; rollout records that bound using the then
current model price and refuses scheduler activation until the numeric ceiling
is approved. There is no unlimited or unset production mode.

### Stable daily edition

A successfully published reading is stable for that local day. New journals,
check-ins, ordinary preference changes, and feedback affect the next day's
context rather than silently rewriting prose already seen.

A birth-profile correction, chart correction, calculation defect, or other
change that invalidates factual inputs in a V5 `constrained_model` reading uses
a new, explicit path. As soon as the invalidation is accepted,
`invalidatePublishedReading` compare-and-swaps the live row from `published` to
`invalidated`, sets `invalidated_at`, and writes the reason and actor class to
the DEK-encrypted reading envelope. The clear audit row retains the standard
actor and resource identifiers needed for accountability, but carries no chart
or prose detail. Invalidation does not wait for a successor to succeed. Product
reads hide an active-chart-mismatched row only when its `assembly_mode` is
`constrained_model`, so the invalid artifact remains in encrypted revision
history but immediately stops being live.

Historical V3 deterministic envelopes are immutable compatibility artifacts:
they remain readable under their original envelope and are never rewritten,
factually invalidated, or automatically repaired by this V5 path. An active
chart change therefore does not hide a published V3 reading. Dual-reader
compatibility is a preservation boundary, not permission to retrofit V5 repair
metadata into V3 ciphertext.

`reserveFactRepair` then creates revision `r+1` against that named invalidated
predecessor. Its assertions, `replaceCommand`, and `completeReading` accept the
predecessor only in `invalidated`; completion leaves that status unchanged and
publishes the successor. A failed successor also leaves it invalidated, so
Today is unavailable. The existing ordinary reissue path is deliberately
different: for a safety or non-factual defect correction, its predecessor
stays published until `completeReading` atomically marks it `superseded`. Thus
M5 changes the incumbent “failed successor leaves the live reading alone” rule
only for the explicitly fact-invalidating path.

Automatic orphan repair is limited to the reader's current local day. Once the
confirmed-zone day rolls over, an invalidated prior-day artifact remains hidden
history and no successor prose is reserved for it; factual repair never becomes
historical backfill.

Consent revocation does not retroactively rewrite a valid published reading. It
prevents all later provider calls and is reflected in future source selection.

### Failure and retries

V5 centralizes failure codes and predicates in one shared module imported by
generation, `queue.ts`, enqueue replacement, `ensure-today-reading.ts`, and the
internal replacement-route validator. Those consumers must not maintain
parallel string sets.

| Failure class | Same-command Queue handling | Automatic command replacement |
| --- | --- | --- |
| `calc_unavailable`, `daily_sky_unavailable`, `publisher_unavailable` | Retry after the existing `RETRY_DELAY_SECONDS = 60` while `jobs.attempts < MAX_JOB_ATTEMPTS` | Yes after job exhaustion |
| `publisher_output_invalid`, `publisher_refused` | One fresh delivery only; retry only when the first provider result occurred at `jobs.attempts = 1` | Yes after terminal job failure |
| `publisher_budget_exhausted` | No provider call and no Queue retry | No; operator/configuration gate |
| `publisher_not_configured`, `publisher_auth_failed`, `publisher_model_unavailable`, `ai_synthesis_consent_required`, `context_ineligible`, `generation_input_id_mismatch`, `policy_unsupported` | Terminal | No |

The exact v5 scheduler-replaceable set is therefore
`calc_unavailable | daily_sky_unavailable | publisher_unavailable |
publisher_output_invalid | publisher_refused`. `release_unreadable` remains a
legacy v3 code and is impossible on v5. `MAX_COMMAND_GENERATION = 3` means an
initial command has at most two automatic replacement commands.

`MAX_JOB_ATTEMPTS = 4` remains one initial delivery plus three delivery retries
for the infrastructure classes. The stricter output-invalid/refusal row above
stops after its second provider-bearing delivery even though unused Queue
attempt capacity remains.

`publisher_unavailable` covers provider timeout, 429, retryable 5xx, and
transient network failure. Authentication/authorization responses map to
`publisher_auth_failed`; an unavailable configured model maps to
`publisher_model_unavailable`.

There is no in-invocation provider retry. A claim increments durable
`jobs.attempts`, performs bounded calculation, and makes at most one 90-second
OpenAI call. For output-invalid/refusal, that existing attempts field is also
the durable “one fresh attempt” counter; earlier infrastructure retries may
conservatively consume the allowance rather than adding another counter. Before
calling OpenAI, execution requires enough claim time for the configured timeout
plus a 60-second D1/publication margin; otherwise it releases for the existing
`LEASE_RETRY_DELAY_SECONDS = 305` without a provider call. The five-minute
`CLAIM_LEASE_MS` is never asked to hold two 90-second calls.

While a scheduler-replaceable failure has remaining command generations,
ensure/scheduler reserve the next command and Today remains `202`. After `g3`
fails, the reading is `424` for that local day; calling the same ensure endpoint
cannot re-enter a repair branch, so the terminal UI does not offer a retry
control that can never succeed. A retry control remains appropriate only for a
pre-command `503` where a new request can make progress.

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
- `424 reading_generation_failed`: automatic command repair is exhausted, or a
  fact-invalidated day has no publishable successor; and
- `503 publisher_not_configured`, `publisher_unavailable`, or
  `calc_unavailable`, `daily_sky_unavailable`, or
  `publisher_budget_exhausted`: a safe infrastructure response before a
  terminal command result exists.

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

- OpenAI as the processor, without coupling consent copy to an exact model ID;
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
- **Failed:** say today's reading could not be generated and show the request
  ID. Offer the stable retry control only for a pre-command `503`; omit it for
  exhausted `424`, where the same action cannot make progress. Never mention an
  active release or suggest that generic copy is being substituted.
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
- disabled, stale, or purpose-ineligible sources are excluded, and the exact
  frozen M0 allowed-use intersection controls every lane;
- enqueue and execute both run `prepareConstrainedReadingInput()`, including
  the existing eligibility partition, and a changed input produces
  `generation_input_id_mismatch` before fetch;
- identifiers, credentials, logs, and encryption material never serialize;
- raw birth time/place/coordinates never serialize; only accuracy,
  uncertainty, suppression, and calculated facts cross the provider boundary;
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

The ordinary test suite extends `apps/api/test/mock-calc-service.ts`, which
already intercepts all outbound fetch. Its dispatcher routes by URL host:
calculation hosts retain existing behavior, `api.openai.com` reaches the fake
OpenAI responses, and unknown hosts fail closed. It is not installed as a
parallel fetch interceptor. A live API evaluation is an explicit, separately
invoked lane using synthetic profiles only; it never sends real user data from
development or production.

### D1 and queue integration

- migrate an empty M3-shaped reading database through the final-name
  DROP/CREATE path and prove a non-empty fixture aborts before DROP;
- validate legacy v3 decoding in application tests and new v5 writes without
  claiming production contains legacy rows;
- prove scheduler/first-open races create one reservation and job;
- prove duplicate delivery, nondeterministic competing candidates,
  publication-CAS loss, and expired-lease recovery remain safe;
- cover consent revocation, chart invalidation, timezone rollover, provider
  timeout/refusal/429/5xx, malformed output, exhausted retries, and atomic
  publication;
- prove a failed fact-invalidating replacement does not expose the invalidated
  predecessor as today's current reading; and
- prove no release pointer or R2 content bundle is read by a V2 generation job;
- exercise every shared retry/replacement class through generation, Queue,
  ensure, and the `MAX_COMMAND_GENERATION = 3` ceiling; and
- prove the due indexes, null seeding, `:00` spreading, skipped-date rules,
  Queue concurrency, and atomic daily provider-call ceiling.

### Web

- consent gate content and keyboard flow;
- preparing, delayed, retryable pre-command failure, exhausted terminal failure
  without an ineffective retry, ready, revised, and unauthorized states;
- automatic polling without repeated live-region announcements;
- visible OpenAI disclosure and the three provenance layers;
- no raw journal excerpts or technical identifiers in reader-facing evidence;
- v3 historical fallback compatibility and v5 absence of fallback UI;
- focused accessibility checks; and
- desktop and mobile captures at the established 1440x1000 and 390x844
  viewports.

### Full candidate gate

Run focused tests through TDD, then fresh root `npm run typecheck`, `npm test`,
and `npm run build`. Validate all three contract manifests and use the extended
validator to prove `contracts/m0/` and `contracts/m3/` unchanged. Assert that
`run_worker_first` is unchanged. Run the Impeccable detector
once over the final changed UI targets, inspect desktop and mobile together in
one bounded browser pass, apply one batched correction if required, and confirm
once.

## Rollout and operations

Code completion, migration, secret configuration, deployment, cron activation,
and production acceptance are separate gates.

The production sequence is:

1. back up D1, record the time-travel bookmark, and capture counts for
   `content_releases`, `daily_readings`, `reading_sources`, and
   `reading_feedback`;
2. if any dependent reading table is non-empty, stop before migration and open
   the separately authorized encrypted-backfill design;
3. deploy dual v3/v5 readers and the assertion-guarded forward-only migration
   while v5 generation remains disabled;
4. prove schema, ledger, expected zero row counts, foreign keys, and integrity;
5. with the already-authorized key, verify the exact model through the live
   OpenAI model endpoint, then set `OPENAI_API_KEY` and the approved
   publisher/model/prompt variables;
6. approve the numeric daily call ceiling, record its conservative maximum
   daily spend at current model pricing, set Queue `max_concurrency = 4`, and
   prove `checkSecureConfig` rejects missing limits;
7. run synthetic calculation and OpenAI canaries without real user context;
8. enable v5 generation for an internal consented account and prove one complete
   queue-to-publication-to-evidence flow;
9. enable first-open v5 generation; and
10. enable the 15-minute hybrid scheduler only after first-open production
    proof and a bounded due-row load probe.

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
