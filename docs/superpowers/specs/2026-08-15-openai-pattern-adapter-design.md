# OpenAI Pattern Adapter Design

**Date:** 2026-08-15

**Status:** Draft for implementation planning; Q1–Q6 and the human-free
generation invariant approved 2026-08-19. Task 5a's live-reading credential
change was separately approved 2026-08-19; no design sign-off gate remains.

**Scope:** Supply the missing OpenAI provider adapter for M7 Your Pattern — the
planner, writer, and semantic-verifier calls, their prompts, their strict
structured-output derivation, their failure and retry mapping, and their
idempotent interaction with the existing stage machine — without changing the
deterministic selection and validation engine, the frozen wire contracts, or the
current rollout position.

## Decision summary

M7 landed every part of AI-generated Pattern except the part that calls a model.
`apps/api/src/services/pattern-execute.ts:637` fail-closes any publisher pin
that is not `"synthetic"` with the failure class `publisher_unavailable`, and
the three passes run deterministic stand-ins: `buildDeterministicPlan`
(`packages/pattern-engine/src/synthetic.ts:30`), `buildDeterministicWriterOutput`
(`packages/pattern-engine/src/synthetic.ts:113`), and a module-local
`evaluateSemanticVerdict` (`apps/api/src/services/pattern-execute.ts:525`). This
document specifies the adapter that replaces those three stand-ins and nothing
else.

The approved choices are:

- one provider call per queue delivery, per pass, with no retry inside the
  adapter and no second call inside a stage;
- three prompt builders and one adapter module in `apps/api`, behind a
  `PatternPublisher` interface added to `apps/api/src/services/pattern-publisher.ts`,
  so the deterministic stand-ins remain a selectable publisher rather than
  dead code;
- the provider-facing strict schemas are *derived* at module load from the
  normative `contracts/m7/` documents by stripping the two keywords OpenAI
  strict mode does not support, rather than checked in as a second copy;
- the deterministic engine validators run unchanged and afterwards — the model
  proposes, `validatePatternPlan` and `validatePatternCandidate` dispose;
- provider-call budget moves from stage entry to immediately before the fetch,
  so a delivery that never reaches the provider never spends a unit;
- artifact identity gains an attempt component, and every hash advanced into D1
  is computed over the bytes R2 actually committed, so a provider success
  followed by a failed D1 advance converges on the first response instead of a
  second one;
- `compact_provenance.provider` and `model_family` become derived from the pin
  that actually ran, replacing the string literals at
  `apps/api/src/services/pattern-execute.ts:774-781`;
- generation is fully machine-run: no human reviews, edits, approves, releases,
  or otherwise intervenes in an individual Pattern job; and
- rollout does not move. Production stays at `PATTERN_AI_ROLLOUT=off` until the
  adapter, the ontology release, and the recorded worst-case spend are all in
  place.

## Goal

An eligible reader who has granted Pattern consent receives a Pattern whose
chapters were organized, written, and independently checked by a model, inside
the evidence envelope the deterministic selector produced — instead of the
`publisher_unavailable` terminal failure that any non-synthetic pin produces
today.

Success means:

1. the model receives no chart identifier, fingerprint, birth value, consent
   ID, user ID, source-fragment text, previous Pattern, or personal context,
   and the packet builder is structurally incapable of emitting one;
2. every chapter, section, tension, resource, and counter-expression that
   reaches a reader passed `validatePatternPlan` and `validatePatternCandidate`
   unchanged, and a `pass` verdict from a separately configured verifier;
3. one reader's one Pattern claim produces at most one accepted document
   despite duplicate delivery, expired leases, and a provider call that
   succeeded while its D1 advance failed;
4. a provider timeout, refusal, budget exhaustion, or exhausted attempt budget
   produces an honest failed state with a coarse public stage and no prose;
5. the stored provenance names the publisher and model family that actually
   ran;
6. every provider request and response exists as an encrypted, expiring R2
   artifact under a closed `artifact_class`, and nowhere else; and
7. bounded machine retries, deterministic gates, and the independent model
   verifier decide publication or failure without a human review queue or
   per-Pattern approval action.

Explicit non-goals. This design does not change the deterministic selection or
validation engine: `packages/pattern-engine` keeps its purity contract
(`packages/pattern-engine/src/index.ts:1-12`), `selectPatternEvidence`,
`validatePatternPlan`, `validatePatternCandidate`, `stripPrivateEvidence`, and
`projectPublicPattern` keep their current behavior, and the adapter lives in
`apps/api` rather than in the engine or in `packages/shared`, which the AGPL
calc service imports. It does not change a frozen contract: `contracts/m0`
through `contracts/m6` stay byte-identical, and `contracts/m7` changes only in
its `amendments` array and, where noted, in additive ways the manifest already
permits. It does not advance rollout: no environment moves off `off` as a
consequence of merging this code.

## Current state

M7 built the whole pipeline around an adapter-shaped hole.

`pattern-enqueue.ts` freezes a `GeneratePatternCommandV1`
(`apps/api/src/services/pattern-command.ts:25-56`) into `jobs.payload_enc`,
mints a per-generation artifact content key, reserves the reader's one Pattern
claim, inserts a `pattern_generation_jobs` row at `stage='reserved'`,
`stage_generation=0`, and nudges `PATTERN_QUEUE`. The command already pins the
full provider tuple — `planner_model`, `planner_reasoning`,
`planner_prompt_version`, `planner_max_output_tokens`, the same four for writer
and verifier, `input_max_bytes`, `selection_policy_version`, and
`validation_policy_version` (`apps/api/src/services/pattern-publisher.ts:41-59`).

`executePatternJob` claims the stage by compare-and-swap with a five-minute
lease (`CLAIM_LEASE_MS`, `apps/api/src/services/pattern-execute.ts:46`),
decrypts the command, rechecks eligibility, ontology bundle hash, and
feature-set hash, and runs `selectPatternEvidence` to produce the fact packet,
the manifest, and the alias map. Then it stops at the guard:

```ts
// Live OpenAI Pattern calls are not wired yet. Production rollout stays `off`.
if (publisher.config.pin.publisher !== "synthetic") {
  await failJob(env, claimed.job, claimed.token, "publisher_unavailable", …);
  return { ok: false, reason: "terminal", failureClass: "publisher_unavailable" };
}
```

Everything past that guard is a stand-in. The planner stage calls
`buildDeterministicPlan` and hands the result straight to the real
`validatePatternPlan`. The writer stage calls `buildDeterministicWriterOutput`
and hands the result to the real `validatePatternCandidate`. The verifier stage
calls a nineteen-line module-local function that returns `pass` for any
non-empty chapter list and honors `PATTERN_SEMANTIC_FORCE_REJECT` only under
`AUTH_STUB=1`. The validators are real; only their inputs are fake.

Three prompt *versions* are pinned for prompts that do not exist:
`OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "1.0.0"`,
`OPENAI_PATTERN_WRITER_PROMPT_VERSION = "1.0.0"`, and
`OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "1.0.0-verifier"`
(`apps/api/src/services/pattern-publisher.ts:19,25,31`). There is no
`services/pattern-prompt.ts`. `resolvePatternPublisherConfiguration` already
validates all fifteen `OPENAI_PATTERN_*` variables against those compiled
constants by exact equality, already accepts `PATTERN_PUBLISHER=openai`, and
already requires `OPENAI_API_KEY` once rollout leaves `off`
(`apps/api/src/services/pattern-publisher.ts:100-218`).

This produces a configuration deadlock worth stating plainly. Production sets
`PATTERN_PUBLISHER="openai"` (`apps/api/wrangler.toml:270`) because
`synthetic` is refused outside development
(`apps/api/src/services/pattern-publisher.ts:152-154`), while the execute path
fail-closes any pin that is not `synthetic`. Production can therefore only sit
at rollout `off`: moving it to `internal` passes configuration validation and
then fails every job terminally. There is no configuration in which production
runs the deterministic stand-ins as a canary. The adapter is the only thing
that can unblock any non-`off` rollout mode.

The database is ready. `pattern_generation_artifacts` already admits twelve
`artifact_class` values (`db/d1/0007_ai_generated_pattern.sql:328-345`), of
which the runtime writes four: `fact_packet`, `validated_plan`,
`writer_response`, and `semantic_verdict`. The six request/response classes and
`rejected_candidate`, `candidate_validation`, and
`accepted_internal_document` are reserved and unwritten.
`pattern_generation_jobs` already carries `planner_attempts`, `writer_attempts`,
and `verifier_attempts`, which no code path increments, and the command already
carries `planner_attempts_max`, `writer_attempts_max`, and
`verifier_attempts_max`, which no code path reads.
`pattern_provider_daily_usage` and `consumePatternProviderCallBudget` already
exist and are already consumed once per stage. No migration is required for
provider metadata, and none should be added: the M7 design keeps provider and
model pins in the encrypted command and compact provenance, and clear columns
hold only operationally queryable state.

## Chosen architecture

### Three pass adapters behind one publisher interface

`apps/api/src/services/pattern-publisher.ts` gains the interface the reading
path already has at `apps/api/src/services/reading-publisher.ts:255-267`,
widened to three passes because the three have three distinct timeouts, token
ceilings, prompt versions, and output schemas:

```ts
export type PatternPass = "planner" | "writer" | "verifier";

export interface PatternPublishOptions {
  /** The Worker's own correlation id. Never sent to the provider. */
  requestId: string;
  timeoutMs: number;
  pin: PatternPublisherPin;
}

export interface PatternPublisher {
  plan(input: PatternPlannerInput, options: PatternPublishOptions): Promise<PatternPassResult<PatternPlannerOutput>>;
  write(input: PatternWriterInput, options: PatternPublishOptions): Promise<PatternPassResult<PatternWriterOutput>>;
  verify(input: PatternVerifierInput, options: PatternPublishOptions): Promise<PatternPassResult<PatternSemanticVerdict>>;
}
```

`PatternPassResult<T>` mirrors `PublisherResult`
(`apps/api/src/services/reading-publisher.ts:236-253`): either
`{ ok: true; output: T; metadata: PatternProviderMetadata }` or
`{ ok: false; code: PublisherFailureCode; safe_detail_code: PatternSafeDetailCode; retry_after_seconds: number | null }`.
`PatternProviderMetadata` carries `provider`, `model`, `pass`,
`provider_request_id`, `input_tokens`, `output_tokens`, and
`provider_response_hash`. Every member is a closed scalar. No header, URL,
provider prose, or exception string crosses back, exactly as the reading
adapter's module doc requires
(`apps/api/src/services/openai-reading-publisher.ts:15-17`).

Two implementations satisfy the interface. `createOpenAiPatternPublisher(env, route)`
performs the real calls. `createSyntheticPatternPublisher()` wraps
`buildDeterministicPlan`, `buildDeterministicWriterOutput`, and the current
`evaluateSemanticVerdict` and always returns `ok: true`. Making the stand-ins an
implementation rather than a branch is what lets the whole stage machine —
budget, artifacts, attempts, retries, publication — be exercised by the existing
hermetic suite without a provider, and lets the two paths differ in exactly one
place.

### Module layout

- `apps/api/src/services/openai-responses-adapter.ts` (new, shared). Lifted
  verbatim from `openai-reading-publisher.ts`: `extractOutputText`
  (`:57-106`), `retryAfterSeconds` (`:47-55`), the `failure()` helper, the
  `PublisherFailureCode` and safe-detail unions, and re-exports of
  `resolveAiGatewayRoute` / `responsesUrlFor` / `AiGatewayRoute`. These
  functions contain no reading semantics; the only reading-specific line in
  `extractOutputText` is its return type. Importing them from
  `reading-publisher.ts` instead would make Pattern depend on the reading
  module, and copying them would let the two drift on the one behavior — a
  refusal part accompanied by text, two text parts, reasoning items ahead of
  the message — that is expensive to rediscover. They must not move to
  `packages/shared`, which the AGPL calc service imports.
- `apps/api/src/services/pattern-prompt.ts` (new). The three system policies,
  the three request builders, the three output-schema names, and the strict
  schema derivation. Exports `PATTERN_PLANNER_PROMPT_VERSION`,
  `PATTERN_WRITER_PROMPT_VERSION`, and `PATTERN_VERIFIER_PROMPT_VERSION` as
  compiled constants.
- `apps/api/src/services/openai-pattern-publisher.ts` (new). The provider
  boundary: headers, one `AbortController`, one fetch, hash-before-parse, the
  ordered post-200 gauntlet, typed failures.
- `apps/api/src/services/pattern-packet.ts` (new). The minimizing builders that
  produce the three provider-visible input documents from the packet, the
  frozen plan, the authorized ontology records, and nothing else.
- `apps/api/src/services/pattern-publisher.ts` (edited). The interface, the two
  factories, and the additional configuration refusals.
- `apps/api/src/services/pattern-execute.ts` (edited). The four edit points
  below.
- `apps/api/src/services/safe-log.ts` (edited). Two new closed arms.

### Rewiring `pattern-execute.ts`

Four edit points, and nothing else in the file changes semantics.

1. `:637-640`. The fail-closed guard is replaced by publisher selection:
   `const publisherImpl = pin.publisher === "openai" ? createOpenAiPatternPublisher(env, gateway.route) : createSyntheticPatternPublisher();`
   The gateway route is resolved before this point and a half-configured
   gateway is a terminal `publisher_not_configured`, not a fallback to the
   direct origin.
2. `:648`. `buildDeterministicPlan(selected.packet, records)` becomes
   `publisherImpl.plan(plannerInput, { requestId, timeoutMs: config.plannerTimeoutMs, pin })`.
   `validatePatternPlan(planner, selected.packet, records)` at `:649` stays
   verbatim.
3. `:685`. `buildDeterministicWriterOutput(plan, selected.packet, records)`
   becomes `publisherImpl.write(writerInput, …)`.
   `validatePatternCandidate(writer, plan, selected.packet, records)` at `:686`
   stays verbatim.
4. `:717`. `evaluateSemanticVerdict(env, writer)` becomes
   `publisherImpl.verify(verifierInput, …)`. The `PATTERN_SEMANTIC_FORCE_REJECT`
   escape moves into the synthetic implementation and keeps its `AUTH_STUB=1`
   condition.

Everything the existing file does around those four lines is load-bearing and
must not be touched: `claimStage`'s three-statement batch and its
`assertion_probe` abort (`:136-179`), the `stageMovedOn` fallback that refuses
to report a transient D1 throw as a duplicate (`:180-191`), `ownershipProbes` at
the head of every mutating batch (`:350-370`), `advance`'s
`stage_generation + 1` guard and its `dispatched_at = NULL` (`:372-416`),
`nudgeNextStage(..., claimed.job.stage_generation + 1)`, the `try` that opens
above `selectPatternEvidence` so a `SelectionCapacityError` fails the job
instead of wedging the claim (`:600`), the eligibility and ontology rechecks
that run before any spend (`:587-618`), `publishPattern`'s single guarded batch
(`:795-856`), and the rule that `selected.aliasMap` never leaves the Worker
(`packages/pattern-engine/src/types.ts:23`).

### Alternatives not selected

1. **One stage running all three passes.** This would make a Pattern one queue
   delivery and remove two stage hops, but each pass is pinned at a 120,000 ms
   timeout (`apps/api/src/services/pattern-publisher.ts:22,28,34`) against a
   300,000 ms claim lease. Three sequential passes plus validation cannot fit,
   and §15.5 of the M7 design forbids pairing a provider timeout with a lease
   that can expire first. Keeping one call per delivery also makes the
   already-shipped per-stage claim the unit of recovery.
2. **Splitting the dormant `planning` / `plan_validating` /
   `candidate_validating` / `publishing` stages into real transitions.** The
   stage vocabulary already admits them and the CHECK constraint already
   accepts them, so this costs no migration. It costs one extra queue hop and
   one extra `stage_generation` increment per split, for a distinction the
   public stage map collapses anyway: `reserved`, `planning`, and
   `plan_validating` all render as `organizing_evidence`
   (`apps/api/src/services/pattern-command.ts:64-75`). The four names stay
   accepted as dispatcher inputs and unassigned as durable state. A later
   change may adopt them without a schema change.
3. **An in-stage retry loop.** Retrying the provider inside one claim would
   avoid a queue round trip per attempt, but it puts two 120-second calls inside
   one 300-second lease with no headroom for R2 and D1, and it hides the attempt
   count from the durable row that already exists to hold it. Retries are
   re-deliveries at the same `stage_generation` with an incremented
   `<pass>_attempts`, which reuses the durable outbox and the sweeper unchanged.
4. **A separate Pattern provider credential.** A second key would isolate
   Pattern spend at the provider, but `OPENAI_API_KEY` is already a Worker
   secret and the M7 design states that sharing it as a transport credential
   does not authorize Pattern — rollout, publisher, model, prompt, policy,
   ontology, and budget gates each gate independently. The isolation that
   matters is `pattern_provider_daily_usage`, which is already a separate
   ledger.

## Provider configuration and request boundary

The adapter is constructed as
`createOpenAiPatternPublisher(env: Pick<Env, "OPENAI_API_KEY">, route: AiGatewayRoute | null)`.
`route` is required rather than defaulted, for the reason the reading adapter
records at `apps/api/src/services/openai-reading-publisher.ts:122-129`: a
default would let a new call site route around the gateway, and the spend and
log records it exists to produce, by saying nothing at all. The URL is computed
once at construction with `responsesUrlFor(route)`; note that the gateway base
replaces `https://api.openai.com/v1` whole, so the path is `…/openai/responses`
and never `…/openai/v1/responses`, which 404s — and 404 is the one status read
as terminal `publisher_model_unavailable`.

Headers are exactly:

```
authorization: Bearer <OPENAI_API_KEY>
content-type: application/json
```

plus, when routed through the gateway, `cf-aig-collect-log: false`,
`cf-aig-max-attempts: 1`, `cf-aig-skip-cache: true`, and
`cf-aig-authorization: Bearer <AI_GATEWAY_TOKEN>` when the token is set. All
three apply to Pattern for the same reasons they apply to the reading: gateway
logs store prompt and response verbatim, which here is the reader's fact packet
and their Pattern prose outside the Worker's encryption boundary; a gateway
retry turns one queue delivery into up to five provider calls that
`pattern_provider_daily_usage` counts as one; and a cache hit would give two
generations the same `provider_request_id` and `provider_response_hash`, which
is stored evidence naming a generation that did not happen. No `OpenAI-Beta`,
no `idempotency-key`, no `user`, and no organization header is sent. A missing
API key is refused before any fetch rather than sent as an empty
`Authorization`.

The body is built by naming every field, never by spreading a configuration
object, so a request cannot acquire a field nobody reviewed:

```ts
{
  model: pin[`${pass}_model`],
  store: false,
  instructions: PATTERN_SYSTEM_POLICY[pass],
  input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(document) }] }],
  reasoning: { effort: pin[`${pass}_reasoning`] },
  text: {
    verbosity: pass === "writer" ? "medium" : "low",
    format: { type: "json_schema", name: PATTERN_OUTPUT_SCHEMA_NAME[pass], strict: true, schema: STRICT_SCHEMA[pass] },
  },
  max_output_tokens: pin[`${pass}_max_output_tokens`],
}
```

`temperature`, `top_p`, `seed`, `tools`, `tool_choice`, `parallel_tool_calls`,
`previous_response_id`, `metadata`, `user`, `service_tier`, `background`,
`include`, and `stream` are absent. Their absence is the determinism posture,
not an omission. The M7 design never mentions temperature, seed, top_p,
reproducibility, or refusals — verified by exhaustive search of all 3,174 lines
— because it locates determinism in the validators and the selector rather than
in sampling: ranking "is deterministic" and may not use model judgment (§11.4),
and §12.4 states outright that "the second attempt may propose a different plan
because no plan has been frozen yet." Non-identical output across attempts is
expected and legal. What is frozen is the *first valid* plan, by hash. Sending
a seed would purchase a reproducibility the architecture does not rely on and
would create the false impression that a redelivery reproduces prose; the
idempotency section below is what actually guarantees convergence.

Verbosity is `"low"` for the planner and the verifier, whose outputs are keys,
identifiers, and codes rather than prose, and `"medium"` for the writer. Word
bounds are enforced by `validatePatternCandidate`, not by verbosity; verbosity
only shapes how hard the model pushes against the token ceiling.

One risk must be measured rather than asserted.
`OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS` is pinned at 8,000
(`apps/api/src/services/pattern-publisher.ts:29`), and `output_tokens` on the
Responses API includes reasoning tokens. The document contract permits up to
4,500 reader-facing words, and every prose unit additionally carries
`feature_aliases`, `ontology_rule_ids`, and `derived_synthesis_ids` arrays. At
high reasoning effort, 8,000 is unlikely to be sufficient for a maximum-length
document. The observable is `publisher_output_invalid` with
`safe_detail_code: max_output_tokens_exhausted`. The first internal-lane run
must record observed `output_tokens` against document length, and the pin is
expected to need an increase — which is a change to the compiled constant and
both `wrangler.toml` blocks, not a contract change.

## Provider-visible packet and input minimization

The exclusion list is a hard boundary, restated here so it is enforceable in
one place. The provider sees no `user_id`, chart ID, chart fingerprint, birth
date, local birth time, birthplace, coordinates, birth timezone, consent ID,
generation ID, job ID, claim ID, session material, source-fragment text, raw
source corpus, personal context of any kind, previous Pattern, or M4 `nft_`
feature ID. Current M4 feature IDs are derived partly from the chart
fingerprint, which is why they are aliased rather than sent; the
alias-to-feature map stays in the Worker and in the encrypted administrative
record (`packages/pattern-engine/src/types.ts:23`). Only activated ontology
records required for the selected facts are included — never the corpus.

Enforcement is mechanical, in three layers.

First, a packet builder that can only emit approved fields.
`apps/api/src/services/pattern-packet.ts` exports
`buildPlannerInput`, `buildWriterInput`, and `buildVerifierInput`. Each returns
a closed TypeScript object literal constructed field by field from named
sources; none of them accepts the command, the identity, the job row, or the
alias map as a parameter, so the values they must not emit are not in scope.
The M7 design states the rule as a unit boundary: planner and writer modules do
not query D1 directly and receive already-minimized request documents (§6.3).
Passing the whole packet through a filter would be the wrong shape — a filter
can be wrong by omission, a builder that never sees the value cannot.

Second, a runtime ban-list check over the serialized document, mirroring
`FORBIDDEN_IN_PATTERN_PACKET_KEYS` in `contracts/validate_schemas.py:1109-1160`
at every depth: `user_id`, `chart_id`, `chart_fingerprint`, `fingerprint`,
`birth_date`, `birth_time`, `birthplace`, `consent_id`, `check_in`,
`check_ins`, `journal`, `life_event`, `life_events`, `reading`, `readings`,
`daily_reading`, `latitude`, and `longitude` — with `longitude` permitted only
at the exact path `features[i].fact.longitude`. This is a runtime obligation and
not merely a contract one, because `packetFeature.fact` is an open
`{"type": "object"}` in `contracts/m7/pattern-fact-packet.schema.json`; the
schema will not catch a forbidden key inside a fact. A hit is a terminal
`pattern_input_forbidden_key` before any fetch, and it consumes no budget.

Third, a byte cap. The serialized document is measured as UTF-8 bytes and
compared against `pin.input_max_bytes`, which
`resolvePatternPublisherConfiguration` pins to `PATTERN_INPUT_MAX_BYTES = 98304`
(`apps/api/src/services/pattern-publisher.ts:35`). Over the cap is a terminal
`pattern_input_too_large` before any fetch and before any budget consume. The
alias caps — at most 40 eligible and at most 12 mandatory — are already applied
by the selector, and exceeding mandatory capacity is already
`pattern_selection_capacity_exceeded` rather than a silent demotion. The byte
cap is therefore mostly a bound on the *ontology* half of the writer input,
which is the largest of the three documents and the one most likely to trip it.

The three documents are:

- **Planner input.** The `PatternFactPacket` exactly as
  `selectPatternEvidence` produced it, plus the activated ontology records for
  the aliases it contains. The planner sees only eligible features and the
  closed omission counts required for plan validation; it never sees
  `redundant`, `suppressed`, `ontology_unsupported`, or `capacity_omitted`
  features.
- **Writer input.** The frozen plan; the aliases and normalized facts assigned
  to each plan unit; the ontology records authorized for those aliases; the
  required tensions, resources, counter-expressions, and derived syntheses; the
  effective accuracy and required uncertainty rules; the confirmed locale; the
  voice and prohibited-claim policy; and the section and word bounds. It does
  not receive unassigned features, omitted features, the raw corpus, previous
  drafts, previous Pattern prose, or any correction content beyond structured
  codes.
- **Verifier input.** The validated candidate; the frozen plan; the exact
  normalized facts; the exact authorized ontology records; the
  derived-synthesis dependency graph; and the uncertainty policy.

Every ontology and source value in all three is a JSON string value under a
top-level immutable instructions string. Source fragments and ontology prose are
data, not instructions: the packet is the only element of `input`, and it is one
JSON document, so text inside it that appears to address the model cannot become
another message, another role, or another field — there is no syntax available
to it that `JSON.stringify` would not escape. Each of the three system policies
carries the inertness clause explicitly, in the shape
`reading-prompt.ts:50-70` established.

## Pass one: the chapter planner

**What the model is given.** The planner input above, under a system policy that
states its permissions and prohibitions as rules about what may be produced.
It may merge candidate clusters where the supplied compatibility rules permit,
assign mandatory and eligible aliases to chapters or signatures, choose four to
six chapter titles, define chapter purposes, choose chapter order, identify
which supplied tensions, resources, counter-expressions, and derived syntheses
each chapter must use, and explicitly omit non-mandatory eligible features under
closed reasons. It may not create or modify chart facts, introduce an alias not
in the packet, introduce an ontology rule not authorized for the cited alias,
create new astrological meanings, assign a suppressed or unsupported feature,
omit mandatory evidence, use personal context, write reader-facing prose, or
alter the chapter-count and signature-count bounds. The policy also states that
the planner may not declare a chart sparse — `sparse_pattern` comes from
`selected.packet.selection_constraints`, and the Worker sets it on the plan
from that source and never from the model
(`apps/api/src/services/pattern-execute.ts:654-659`).

**Output contract.** `contracts/m7/pattern-planner-output.schema.json`, root
object, `additionalProperties: false`, all four declared properties required:
`schema_version` (enum `["0.7.0"]`), `chapters` (3–6 items),
`additional_signatures` (0–8), and `omissions`. A chapter requires all nine of
`chapter_key` (`^chapter_[0-9]{2}$`), `working_title` (1–90),
`purpose` (1–400), `feature_aliases` (≥1, `^f[0-9]{3}$`), `ontology_rule_ids`
(≥1), `derived_synthesis_ids`, `required_tension_ids` (≥1),
`required_resource_ids`, and `required_counter_expression_ids` (≥1). An omission
requires `feature_alias`, `reason` (enum `redundant_with_chapter`,
`capacity_omitted`, `cluster_incompatible`, `sparse_document`), and a nullable
`covered_by`. The TypeScript mirror is `PatternPlannerOutput`
(`packages/shared/src/m7-types.ts:262-300`).

Note that the schema's `minItems: 3` on `chapters` is deliberately wider than
the ordinary 4–6 policy bound, because the sparse-chart case permits three. The
narrower bound is a validator rule keyed on `sparse_pattern`, not a schema rule.

**Structured-output declaration.** `text.format = { type: "json_schema", name: "patternlike_pattern_plan_v7", strict: true, schema: <derived> }`.
The derivation is described under Contracts below.

**Attempt budget.** At most two provider attempts per generation job, counted
durably in `pattern_generation_jobs.planner_attempts`. Attempt index `k` is read
from the claimed row; the ceiling is `command.publisher.planner_attempts_max`
cross-checked against the compiled constant. A transport or provider-unavailable
failure retries the same request. A provider-schema failure or a
deterministic-validation failure retries with a closed list of validator codes
and no rejected content. The second attempt may legitimately propose a different
plan, because no plan is frozen yet. Once a plan validates, planner attempts
stop, later stages cannot invoke the planner, `plan_hash` is pinned into the job
row, and every writer attempt must match it. If no plan validates, the job fails
at the public `organizing_evidence` stage.

**What invalidates the output.** Two tiers, in order. The adapter rejects a
response that is not one JSON document, does not parse, lacks a required
top-level key, is not a plain object, or violates the length bounds that had to
be stripped for strict mode. Then the engine runs unchanged.
`validatePatternPlan` verifies exact schema and closed keys, four to six
chapters, no duplicate chapter or signature key, no unknown feature alias, no
unknown ontology/synthesis/tension/resource/counter-expression ID, that every
rule is authorized for at least one cited feature, that every mandatory feature
is assigned according to its coverage class, that every remaining eligible
feature is assigned or omitted under an allowed reason, that no feature is both
assigned and omitted, that no feature appears in incompatible chapter groups,
that every chapter has enough distinct evidence for its purpose, that no chapter
is supported only by an uncertainty record or absence claim, that every chapter
has at least one required tension and counter-expression, that the ontology
compatibility graph permits every requested merge, that titles and purposes
contain no prohibited claim classes or packet identifiers, that Additional
signatures do not absorb `mandatory_core` evidence, that omission links refer to
real chapters, and that the serialized plan stays under its byte bound.

**Engine validation is not replaced.** `validatePatternPlan(planner, selected.packet, records)`
at `apps/api/src/services/pattern-execute.ts:649` is called with the same
arguments and the same result handling as today. The only change is where
`planner` came from. A strict schema proves shape, and shape is the cheapest of
the checks a plan has to pass.

## Pass two: the Pattern writer

**What the model is given.** The writer input above, plus — on a correction
attempt — a closed correction document containing finding codes, affected
chapter and section keys, the policy rule violated, and the instruction to
preserve the frozen plan and evidence assignments. Rejected prose is never
echoed into a correction prompt. The correction document is built from the
stored `candidate_validation` and `semantic_verdict` artifacts and carries each
finding's `code`, `severity`, `target_key`, `feature_aliases`, and
`ontology_rule_ids` — and deliberately not its `rationale`, which is a
free-text field bounded at 600 characters that could quote the prose the
correction path exists to avoid re-showing.

**Output contract.** `contracts/m7/pattern-writer-output.schema.json`, root
object, all five properties required: `schema_version`, `title` (1–90),
`chapters` (3–6), `additional_signatures` (0–8), and `uncertainty_note`, which
is the file's only `anyOf` — a `proseUnit` or `null`, and it is nested rather
than at the root because OpenAI strict mode forbids `anyOf` at the root. A
chapter requires `chapter_key`, `title`, `summary`, `sections` (2–6),
`tensions` (1–5), `resources` (0–5), and a single non-nullable
`counter_expression` object. A section's `claim_class` enum is narrower than a
prose unit's — only `reflective_interpretation` and `structural_description`,
against the prose unit's six. A signature carries no `claim_class` and no
`derived_synthesis_ids`. Every sentence-bearing unit carries evidence
references; they are removed only when creating the consumer projection.

**Structured-output declaration.** `name: "patternlike_pattern_document_v7"`,
`strict: true`, derived schema.

**Attempt budget.** At most three attempts against one frozen plan, counted in
`pattern_generation_jobs.writer_attempts`. A transport failure retries the same
request. A deterministic rejection or a semantic rejection may trigger another
writer attempt with the correction document. The writer may rephrase and
reorganize sections inside a chapter, but it cannot change chapter membership,
chapter count, omitted features, or ontology authorization. After the third
failed writer attempt the job reaches terminal failure.

There is a conflict here that must be resolved before implementation, not
during it. The M7 design states three writer attempts (§13.5), while the frozen
command sets `writer_attempts_max: 2`
(`apps/api/src/services/pattern-command.ts:53`,
`apps/api/src/services/pattern-enqueue.ts:264`). The field is never read today,
so nothing has surfaced the disagreement. It is recorded as an open question
below; the implementation must not silently pick one.

**What invalidates the output.** The adapter tier as before, then
`validatePatternCandidate` unchanged: strict schema and closed keys; the exact
chapter and signature keys from the frozen plan; the exact evidence-assignment
boundaries from the plan; no unknown feature, ontology, or synthesis reference;
no missing mandatory reference; no prose unit without a claim ledger; no
astrological prose unit supported only by expression-guidance references; every
derived synthesis authorized for its cited source-supported meanings; locale
support under the current validation policy; required uncertainty language and
no prohibited time-sensitive claims; no raw birth details, chart identifiers,
account identifiers, provider identifiers, packet aliases, prompt language,
schema language, or internal instructions in reader prose; no HTML, Markdown,
links, code, or executable instructions; no predictions, guarantees,
inevitability, fate, diagnosis, medical causation, legal or financial advice, or
replacement-of-professional-advice framing; no unsupported biography, childhood
event, profession, relationship state, trauma, health condition, or current-life
assertion; no statement that context confirmed or revealed astrology; no claim
that a collective or generic meaning is unique proof about the individual;
balanced tension, resource, and counter-expression treatment; no direct
contradiction inside one chapter; no materially duplicated chapter summaries;
word and byte bounds; and canonical content-hash generation. The validator
returns codes and safe detail codes, never rewritten prose.

Word and section bounds are policy, enforced by the validator: four to six core
chapters, two to six sections per core chapter, 250–550 words per core chapter
including its lists and counter-expression, zero to eight Additional signatures
at 70–160 words each, one uncertainty note of 40–140 words when required,
1,500–4,500 total reader-facing words, no paragraph over 180 words, no title
over 90 characters, and no list over five items. A shorter document is allowed
only when the selector set `sparse_pattern: true` before planning.

**Engine validation is not replaced.**
`validatePatternCandidate(writer, plan, selected.packet, records)` at
`apps/api/src/services/pattern-execute.ts:686` is unchanged. The prompt exists
to make a compliant candidate likely; the validator exists because likely is not
the same as certain.

## Pass three: independent semantic verification

**What the model is given.** The validated candidate, the frozen plan, the exact
normalized facts, the exact authorized ontology records, the derived-synthesis
dependency graphs, the uncertainty policy, and the strict verdict schema. It
receives no corpus, no previous draft, no correction document, no user identity,
no user context, and no chart identifier. It cannot browse, use tools, retrieve
sources, or rely on model memory. It is a fresh call: `store: false` and no
`previous_response_id`, so there is no provider-side conversation state linking
it to the writer call.

**What it judges.** Whether each claim is entailed by, or is a reasonable
traceable synthesis of, its cited ontology records; whether a metaphor
introduces a new astrological proposition; whether a derived synthesis exceeds
its dependencies; whether a paragraph turns possibility into certainty; whether
a chapter implies a diagnosis, cause, fate, guarantee, or specific future event;
whether a chapter invents biography or current circumstances; whether collective
or generic material is falsely presented as uniquely proven; whether uncertainty
is honored in meaning rather than only mentioned in a footer; whether chapters
materially contradict one another; whether chapters collapse into one-sided
labeling; whether tension and counter-expression remain genuinely different
possibilities; and whether prose exceeds the calm, non-mystifying voice boundary
in a way deterministic vocabulary checks could not capture.

**Output contract.** `contracts/m7/pattern-semantic-verdict.schema.json`: root
object, all three properties required, `verdict` an enum of exactly `pass` and
`reject`. There is no `pass_with_changes`, and
`contracts/m7/fixtures/invalid/pattern-semantic-verdict.pass-with-changes.json`
exists to prove it. A finding requires all six of `code` (1–64 characters),
`severity` (`error` or `warning`), nullable `target_key`, `feature_aliases`,
`ontology_rule_ids`, and `rationale` (≤600 characters, no minimum, so an empty
string is schema-valid). `code` is a free-form string in the contract, not an
enum: the finding vocabulary is defined out of band. This design defines it in
`pattern-prompt.ts` as a compiled closed list enumerated in the verifier system
policy, and the Worker rejects a verdict citing a code outside that list as
`publisher_output_invalid` — otherwise the correction path receives codes the
writer prompt cannot act on.

**Structured-output declaration.** `name: "patternlike_pattern_verdict_v7"`,
`strict: true`, derived schema.

**Attempt budget.** A verifier transport failure retries the identical candidate
at most twice, counted in `pattern_generation_jobs.verifier_attempts`. A
semantic rejection does not retry the verifier against unchanged prose: it
returns to the writer correction path if writer attempts remain, keeping the
same frozen plan. Concretely, a `reject` with writer attempts remaining is
`advance(..., "writing")` — a new `stage_generation`, the preserved `plan_hash`,
and an incremented `writer_attempts` — plus the ordinary nudge. A `reject` with
no writer attempts remaining is `failJob("semantic_verification_failed", "checking_claims")`.

**What invalidates the output.** The adapter tier, plus: the verdict must be
bound to the exact `candidate_hash` the job row holds, and a verdict whose
`verdict` is `pass` while any finding carries `severity: "error"` is rejected as
incoherent rather than honored. A verifier `pass` does not publish by itself.
`publishPattern`'s single guarded batch performs every final deterministic and
mutable-state check — user still active, claim still reserved and unconsumed,
chart and feature-set identity still matching the frozen command, locale still
matching the frozen revision, consent still the exact active grant, ontology
still valid and not recalled, plan and candidate hashes matching the stored
artifacts, verdict `pass` for the exact candidate hash, no accepted document
already existing for the chart fingerprint, and the job still owning the
publication claim — and a failed batch is `cancelJob("stale_publication")`,
which returns the reader's claim.

## Verifier independence

Independence here is a property of *configuration and context*, not of
blindness. The M7 design is explicit that the verifier receives the frozen plan
(§14.1). What it must not see is everything else: the raw source corpus, the
writer's rejected candidates, the writer's correction documents, the planner's
prompt or rejected attempts, user identity, user context, chart identifiers, and
any provider-side conversation state. Its whole world is the seven supplied
items.

The configuration requirement is a hard one. The tuple
`(provider, model, prompt_version)` must differ from the writer's. Today only
the prompt version differs — `"1.0.0-verifier"` against `"1.0.0"`
(`apps/api/src/services/pattern-publisher.ts:25,31`) — and nothing enforces
that they *stay* different. `resolvePatternPublisherConfiguration` must
additionally refuse a configuration in which
`OPENAI_PATTERN_VERIFIER_PROMPT_VERSION` equals
`OPENAI_PATTERN_WRITER_PROMPT_VERSION`, because the current separation is an
accident of two constants rather than a checked relationship. Production
activation should prefer a different model snapshot, so that one model
configuration is not the sole semantic author and judge; that is a rollout gate
rather than a code change, since the model pins are already independently
configurable.

The tension worth naming: a verifier that sees the plan inherits the plan's
framing, and can rationalize a claim the plan invited. The reason it sees the
plan anyway is that most of what it exists to catch is a *relationship* between
prose and its assigned evidence — a metaphor that introduced a new proposition,
a synthesis that exceeded its dependencies, a chapter that drifted outside its
assignment. A verifier without the plan could only check prose against the
ontology, which is largely what `validatePatternCandidate` already does
deterministically and better. Removing the plan would trade the defect class the
verifier exists for against a framing bias, and the design accepts the framing
bias. The mitigations are that the verifier never sees the *reasoning* behind
the plan, never sees a rejected attempt, shares no prompt and no conversation
with the writer, and returns only a closed verdict from a closed finding
vocabulary with no ability to patch or approve conditionally. Whether the plan
should instead be projected down to bare evidence assignments — chapter keys,
aliases, and authorized rules, without `working_title` or `purpose` — is
recorded as an open question.

## Failure taxonomy and retry semantics

The adapter returns a typed result and classifies nothing about retry. The
Worker maps it. Two safe detail codes are added to the shared union beyond the
twelve the reading path uses (`apps/api/src/services/reading-publisher.ts:215-234`):
`provider_4xx`, so that a non-200 4xx — a request this adapter built wrong,
which a retry reproduces exactly — is distinguishable from a post-200 shape
failure, which is a model output problem and is retryable; and
`forbidden_key_present`, for the ban-list refusal, which never reaches the
provider at all.

| Outcome | Adapter code / detail | Pattern failure class | Delivery handling |
| --- | --- | --- | --- |
| Timeout, network throw | `publisher_unavailable` / `request_timeout`, `network_error` | `publisher_unavailable` | Retry at the same `stage_generation` with attempt `k+1` while pass attempts remain; terminal otherwise |
| 429, 5xx | `publisher_unavailable` / `rate_limited`, `provider_5xx` | `publisher_unavailable` | As above, with `retry_after_seconds` as the floor on `available_at` |
| Malformed JSON, missing or duplicate output text, post-200 shape failure, `max_output_tokens` incomplete | `publisher_output_invalid` / `invalid_json`, `missing_output_text`, `multiple_output_text`, `schema_mismatch`, `max_output_tokens_exhausted` | `publisher_output_invalid` | Retry with closed validator codes while pass attempts remain; terminal otherwise |
| Deterministic plan rejection | — | `plan_invalid` | Retry with closed validator codes while planner attempts remain; terminal otherwise |
| Deterministic candidate rejection | — | `candidate_invalid` | Writer correction retry while writer attempts remain; terminal otherwise |
| Verdict `reject` | — | `semantic_verification_failed` | Back to `writing` while writer attempts remain; terminal otherwise |
| 401, 403 | `publisher_auth_failed` / `authentication_failed` | `publisher_auth_failed` | Terminal. No retry: the credential is wrong for every attempt |
| 404 | `publisher_model_unavailable` / `model_not_available` | `publisher_model_unavailable` | Terminal. The frozen command names this model and no other |
| Other 4xx | `publisher_output_invalid` / `provider_4xx` | `publisher_request_invalid` | Terminal |
| Refusal part with no text, `content_filter` incomplete | `publisher_refused` / `provider_refusal` | `publisher_refused` | Terminal. Retrying an unchanged request against a refusal reproduces it |
| Budget refused | — | `publisher_budget_exhausted` | Terminal for this job, no automatic retry; the unconsumed claim stays available and `retryable` stays false until a later UTC date has budget |
| Ban-list hit, over byte cap | — | `pattern_input_forbidden_key`, `pattern_input_too_large` | Terminal, before any fetch and before any budget consume |
| Gateway half-configured, missing key | — | `publisher_not_configured` | Terminal |

`pattern_generation_jobs.failure_class` and `jobs.result_class` are plain
`TEXT` with no CHECK constraint (`db/d1/0007_ai_generated_pattern.sql:243`), so
the three new class strings need no migration. None of them reaches a reader:
`contracts/m7/pattern-generation-status.schema.json` has no failure-code field,
and the one place a failure surfaces to a client is
`409 pattern_generation_failed` with `details: {retryable, stage}` where stage
is the coarse `public_failure_stage`.

Retry mechanics. A retryable failure does not call `advance`. It calls a new
`retryStage(env, job, token, pass, availableAt)`, which is `ownershipProbes`
plus `UPDATE jobs SET status='queued', claim_token=NULL, lease_expires_at=NULL,
dispatched_at=NULL, available_at=?` plus
`UPDATE pattern_generation_jobs SET <pass>_attempts = <pass>_attempts + 1`
guarded on the *same* `stage_generation`, followed by
`nudgeNextStage(env, job, job.stage_generation)` — the same value, not the
successor. Because `dispatched_at` is cleared and `status` returns to `queued`,
the undispatched lane of `sweepPatternJobs` recovers a lost nudge exactly as it
does for a normal advance. Backoff follows the M7 stage-aware schedule: 30
seconds, then 2 minutes, then 10 minutes, with `retry_after_seconds` from a 429
or 5xx acting as a floor.

**Amendment (2026-08-15). `retryStage` does not cover the semantic rejection,
and a third primitive is required.** As defined above it holds the stage and the
`stage_generation` and increments the pass that just ran. A verdict of `reject`
does neither: it moves `semantic_verifying` → `writing`, which is a stage change,
and it consumes a **writer** attempt rather than a verifier one. Add
`returnToWriter(env, job, token, availableAt)` — `ownershipProbes`, the correction
document written as an artifact before the batch, `stage='writing'` with
`stage_generation + 1`, `writer_attempts + 1`, and a nudge at the successor
generation. A *deterministic* candidate rejection is not this primitive: its
validation runs inline inside the `writing` delivery, so it stays an ordinary
`retryStage("writer")`. Both consume a writer attempt, which is what §13.5 means
by three attempts against one frozen plan.

The decision between `returnToWriter` and terminal failure is taken in the
verifier delivery and reads `writer_attempts` against `writer_attempts_max`, per
§14.5's "if writer attempts remain". Returning unconditionally and letting the
writing delivery hit its own ceiling records the wrong failure class at the wrong
public stage, and loses `semantic_verification_failed` — the only class that
names the verifier as the reason.

Budget accounting. §25.3 of the M7 design requires the reservation to be
"consumed immediately before each provider call", atomic, with failed,
timed-out, and rejected responses all consuming a unit and no refunds. The
current code consumes at stage entry, before the plan artifact is loaded and
before the packet is built (`apps/api/src/services/pattern-execute.ts:643,670,701`),
so a delivery that fails with `plan_missing` — which makes no provider call —
still spends a unit. **The current per-stage consume is not correct and must
change.** `consumePatternProviderCallBudget` moves to the OpenAI publisher's
call site, immediately before the fetch, after the artifact-presence probe, the
input build, the ban-list check, and the byte cap. The synthetic publisher
consumes nothing, because it makes no provider call and the ledger is named for
provider calls. There is exactly one consume per provider attempt, and still no
refund: the bound is on calculation spend, not on success.

Two consequences follow and must be implemented together with the move. First,
the comment at `apps/api/src/services/pattern-sweep.ts:6-19`, which explains
`MAX_STAGE_CLAIMS` in terms of budget consumed on stage entry, becomes stale and
must be rewritten. Second, `MAX_STAGE_CLAIMS = 8` is now too small. The minimum
successful path is three deliveries. The approved worst case is two planner
calls, three writer calls, and up to three verifier candidates with two calls
each. §14.5's "retries the identical candidate at most twice" is read here as
two calls
*inclusive of the first*, matching the reading applied to §12.4 and §13.5, rather
than as two retries after it. That gives

    2 planner + 3 writer + (3 candidates × 2 verifier) = 11 provider calls

and 11 is the figure the rollout document must carry into the spend approval.
The verifier's scope stays **per candidate**; that part is not amended. An
implementation draft that flattened it to a per-job total of 2 and arrived at 7
is wrong twice over: it understates the ceiling, and a per-job total of 2 caps
the job at two candidates, so §13.5's third writer attempt could never be
verified. With `verifier_attempts` reset by the transition into
`semantic_verifying`, one column holds the per-candidate count, and the per-job
verifier bound is the implied product of the two maxima. `MAX_STAGE_CLAIMS` at 16
is therefore required: 11 provider deliveries plus the publish delivery is a
floor of 12, leaving four bounded claims for lease-expiry or artifact-adopting
recovery. The earlier 14-call reading treated "at most twice" as two retries
after an initial call and is superseded by the approved inclusive counting
rule. The rollout document must multiply the approved 11-call ceiling by the
pinned input/output token bounds and current model rates before external users
are enabled.

## Idempotency and at-least-once safety

This is the part the deterministic stand-ins concealed. Trace the failure today.
A stage completes, `putArtifact` writes R2 and its D1 inventory row, then
`advance()` throws on a transient D1 error and returns `false`
(`apps/api/src/services/pattern-execute.ts:413-415`). The caller returns
`{ok: false, reason: "duplicate"}` and `queue.ts` acknowledges it. Nothing
committed: `jobs` is still `running` with a live claim token, and
`pattern_generation_jobs` still holds the old stage and old `stage_generation`.
The expired-lease lane of `sweepPatternJobs` eventually re-sends the *same*
`stage_generation`. The re-run charges budget again, calls the provider again,
and then `putArtifact` computes the same deterministic artifact id — the digest
is keyed on `generation_id`, `artifact_class`, and `stage_generation` only
(`:255`) — so the create-only R2 put fails, the `head()` check finds the object,
and the function returns silently (`:269-272`). The first response is retained
and the second is discarded, but `advance` then writes `plan_hash` computed over
the *second* response. The next stage loads the stored plan, compares
`plan.plan_hash !== planHash`, and fails `plan_missing`. With deterministic
stand-ins the two responses are identical and this is invisible. With a model it
is a reader whose Pattern dies on a transient D1 blip.

Three changes fix it.

**Artifact-first.** Every pass begins by probing for its own response artifact at
the exact coordinate it is about to write. If it exists, the pass performs no
provider call, consumes no budget, decrypts the stored bytes, and proceeds to
validation and advance with them. This makes a redelivery after a lost advance
free and, more importantly, deterministic.

**Attempt-scoped artifact identity.** The probe requires an identity a redelivery
can recompute and a retry cannot collide with. `putArtifact`'s digest input
becomes `${generation_id}:${artifact_class}:${stage_generation}:${attempt}`,
where `attempt` is the durable `<pass>_attempts` value read from the claimed
row. A redelivery of the same delivery recomputes the same `k` because **no
transition writes the counter of the pass whose provider result it is
committing**, and every write to `<pass>_attempts` commits inside the same
guarded batch as the `(stage, stage_generation)` transition that authorizes the
next call. (An earlier draft stated this as "`retryStage` is the only thing that
increments it". That is no longer true — `returnToWriter` increments
`writer_attempts`, and the `advance` into `semantic_verifying` resets
`verifier_attempts` for the incoming candidate — and the shorter phrasing must
not be carried into `CLAUDE.md`, where it would record an invariant the code does
not hold.) A genuine retry recomputes `k+1`
and therefore writes a fresh artifact rather than being silently discarded — the
planner's second attempt is explicitly allowed to propose a different plan, and
the current three-component identity would have thrown that away. A companion
export `patternArtifactId(generationId, artifactClass, stageGeneration, attempt)`
and a `getArtifactAt(...)` lookup by that id are added beside the existing
`getArtifact`, which continues to select the newest artifact of a class and
remains the right tool for reading `validated_plan` across a stage boundary.
This changes the ids of artifacts written by the current code; that is harmless,
because both `wrangler.toml` blocks hold `PATTERN_AI_ROLLOUT="off"`
(`apps/api/wrangler.toml:151,268`), no production generation exists, and
artifacts expire at 30 days.

**Hash the committed bytes, not the response.** `plan_hash`, `candidate_hash`,
and `semantic_verdict_hash` are computed over the artifact plaintext that
`putArtifact` actually committed — obtained by reading the artifact back after
the write, or equivalently by having `putArtifact` return the
`plaintext_sha256` it stored. Never over the in-memory response object. Under
artifact-first this is belt and braces, but it is the property that makes the
invariant checkable: the hash in `jobs` always names bytes that exist in R2.

`putArtifact` also stops swallowing a conflict. §18.3 of the M7 design requires
that a retry may reuse an artifact only when class, object key, plaintext and
ciphertext hashes, envelope metadata, and stage ownership all match, and that a
different artifact under an already-reserved identity is an integrity conflict
that is never overwritten. Today the `head()` path returns silently regardless of
content (`:269-272`). It must instead compare the computed `plaintext_sha256`
against the existing inventory row and, on a mismatch, throw — landing in the
outer catch as a terminal `execution_error`. That converts a silent divergence
into a state an operator can see, which is the same reasoning that makes
`persistCycles` an `INSERT OR IGNORE` whose pinned-hash mismatch fails the job
closed.

Request artifacts are written *before* the provider call, so the exact bytes
sent are recoverable even when the response never arrives. Their presence is
never the skip condition — only the response artifact's presence is. Because the
request document is a pure function of the frozen command, the pinned ontology,
the pinned feature set, and the frozen plan, a redelivery at the same
`(stage_generation, attempt)` reproduces byte-identical request bytes, so the
create-only write is a no-op rather than a conflict.

Exactly-once publication is unchanged and remains the outer guarantee.
`publishPattern`'s single batch carries the claim probe, both ownership probes,
the `pattern_documents` insert under `UNIQUE(user_id)`, `UNIQUE(claim_id)`, and
`UNIQUE(generation_id)`, the claim transition to `accepted`, both job
transitions to `succeeded`, and the audit row, all or nothing. A redelivery
after a committed publish finds `stage='succeeded'`, `claimStage`'s probe
aborts, and the delivery is a duplicate that acknowledges.

The order of operations at every stage, stated once:

1. claim by CAS; a zero-row claim is a duplicate and acknowledges;
2. decrypt the command, recheck eligibility, ontology, and feature-set identity;
3. read the durable attempt index `k` for this pass; if `k >= max`, fail
   terminally without calling the provider;
4. probe the response artifact at `(class, stage_generation, k)`; on a hit,
   skip to step 9 with the stored bytes;
5. build the minimized input document; run the ban-list check and the byte cap;
6. write the request artifact (create-only);
7. consume one budget unit;
8. call the provider once, with one `AbortController` covering both the fetch
   and the body read;
9. run the deterministic validator unchanged;
10. write the response artifact (create-only) and read back its plaintext hash;
11. `advance` with that hash, or `retryStage`, or — after a semantic rejection
    with writer attempts remaining — `returnToWriter`, or `failJob`, each with
    `ownershipProbes` at the head of its batch;
12. nudge, and swallow the send failure — the D1 row is the outbox.

## Provenance honesty

`publishPattern` currently writes a literal object
(`apps/api/src/services/pattern-execute.ts:774-781`) in which only
`ontology_version` and `selection_policy_version` come from the frozen command:

```ts
compact_provenance: {
  assembly_mode: "constrained_model" as const,
  provider: "OpenAI",
  model_family: "gpt",
  raw_birth_details_sent: false as const,
  …
}
```

`projectPublicPattern` then re-hardcodes `assembly_mode` and
`raw_birth_details_sent` at `packages/pattern-engine/src/projection.ts:46,49`
rather than reading them from the document, so even a document whose stored
provenance said something else would project as `constrained_model`.

Three corrections, none of which changes a wire contract.

`provider` and `model_family` become derived from the resolved pin. `provider`
is `pin.publisher === "openai" ? "OpenAI" : "synthetic"`, and `model_family` is
computed from `pin.writer_model` by a compiled `deriveModelFamily()` mapping,
not by a literal. The exact model id stays out of `compact_provenance_json`,
which is a clear column; it lives only inside the encrypted `writer_response`
artifact's metadata envelope, alongside `provider_request_id`, `input_tokens`,
`output_tokens`, and `provider_response_hash`. `pattern_documents.compact_provenance_json`
is deliberately coarse and must stay that way.

`projectPublicPattern` reads `document.compact_provenance.assembly_mode`,
`.provider`, and `.model_family` instead of re-asserting two of them. The public
projection continues to expose only `provider` and `model_family` and continues
to strip every grounding field — `feature_aliases`, `ontology_rule_ids`,
`claim_class`, and `nft_` ids — which `contracts/validate_schemas.py:1161-1165`
already enforces by scanning fixtures for those tokens.

`assembly_mode` stays the literal `constrained_model` on the published contract,
and `publishPattern` gains an assertion that `pin.publisher === "openai"` before
writing it. `raw_birth_details_sent: false` stays, and stops being a bare
assertion: the fact packet contract is `additionalProperties: false` with
exactly `{schema_version, locale, effective_accuracy, uncertainty, features,
clusters?, selection_constraints}`, the packet builder can emit nothing else,
and the runtime ban-list check runs over the serialized document before the
call. The claim is now proved by three independent mechanisms rather than
declared.

One dishonesty survives and is bounded rather than fixed. A synthetic-publisher
run in development or test still publishes a document claiming
`assembly_mode: "constrained_model"`, because that value is a single-member
literal in the TypeScript type and in the contract, and adding a
`deterministic_stand_in` member is a new enum value — which the manifest rules
classify as needing a `schema_version` bump rather than an amendment. Production
cannot reach the state, since `PATTERN_PUBLISHER=synthetic` is refused outside
development. The residue is confined to dev and test artifacts and is recorded
as an open question for the M7-to-M8 contract window.

## Configuration

No new environment variable is required. All fifteen `OPENAI_PATTERN_*`
variables plus `PATTERN_PUBLISHER`, `PATTERN_INPUT_MAX_BYTES`,
`PATTERN_DAILY_PROVIDER_CALL_LIMIT`, and `PATTERN_ARTIFACT_RETENTION_DAYS` are
already declared in `apps/api/src/env.ts:122-173`, already present in both the
top-level `[vars]` and `[env.production.vars]` blocks of
`apps/api/wrangler.toml`, and already validated. All twenty are already present
and empty in `apps/api/test/hermetic-bindings.ts:39-62`, so the baseline
exposes no provider capability.

Pinned by exact equality against compiled constants, refused with
`pattern_publisher_misconfigured` on any other value: the three models
(`gpt-5.6-sol`), the three reasoning levels (`high`), the three prompt versions
(`1.0.0`, `1.0.0`, `1.0.0-verifier`), the three timeouts (120,000 ms each), the
three output-token ceilings (4,000 / 8,000 / 4,000), `PATTERN_INPUT_MAX_BYTES`
(98,304), and `PATTERN_ARTIFACT_RETENTION_DAYS` (30). Operator-tunable:
`PATTERN_DAILY_PROVIDER_CALL_LIMIT`, any positive integer, required once rollout
leaves `off`; and `PATTERN_AI_ROLLOUT`, one of `off`, `internal`, `first_open`,
`enabled`, where a malformed value fails secure configuration and `off` parks
queued jobs without decrypting them. Secrets, never vars, never in
`wrangler.toml`: `OPENAI_API_KEY`, `AI_GATEWAY_TOKEN`, `PATTERN_ADMIN_TOKEN`,
and `PATTERN_ONTOLOGY_KEYS`. `OPENAI_API_KEY` is shared with the daily-reading
publisher as a transport credential and its presence authorizes nothing.

`resolvePatternPublisherConfiguration` must additionally refuse five things it
does not refuse today, each returning `pattern_publisher_misconfigured` and
naming the offending variable without ever naming a value:

1. `PATTERN_PUBLISHER=openai` with a half-configured AI Gateway. Pattern never
   calls `resolveAiGatewayRoute` today; a half-set gateway is caught only
   incidentally by the reading resolver
   (`apps/api/src/services/reading-publisher.ts:353-354`), which is a
   coincidence rather than a guarantee. Pattern must resolve the route itself
   and carry it on `PatternPublisherConfig`, so the adapter is handed one
   explicitly rather than defaulting.
2. `OPENAI_PATTERN_VERIFIER_PROMPT_VERSION` equal to
   `OPENAI_PATTERN_WRITER_PROMPT_VERSION`. Separation of duties is a
   relationship, not two constants that happen to differ.
3. A compiled prompt-builder version in `pattern-prompt.ts` that does not equal
   its pinned environment value. This is the Pattern analogue of the reading
   path's reason for pinning `prompt_version` at configuration time
   (`apps/api/src/services/reading-publisher.ts:385-391`): the execute path
   compares the pin after the job has committed, where a mismatch is terminal;
   pinning at configuration time converts that into a 503 on the first request.
4. `PATTERN_DAILY_PROVIDER_CALL_LIMIT` below the minimum successful path of
   three provider calls, which guarantees no job can ever complete.
5. The stale message at `apps/api/src/services/pattern-publisher.ts:108`, which
   tells an operator that `PATTERN_AI_ROLLOUT` "must be one of off, internal, or
   first_open" while `readPatternAiRollout` also accepts `enabled`. Not a
   refusal, but a correction that belongs in the same change.

`checkSecureConfig` already calls `resolvePatternPublisherConfiguration`
unconditionally, before the `isDevEnvironment()` short-circuit
(`apps/api/src/middleware/config-guard.ts:75-80`), and turns a failure into a
503 `configuration_error` on every path with the specific code going only to
`safeLog`. The queue consumer runs the same preflight before claim, command
decryption, artifact read, or provider work. Neither changes.

## Observability and logging

The adapter logs nothing. It contains no `console.*` and no `safeLog` import,
exactly as `openai-reading-publisher.ts` does not. Nothing crosses back except
the parsed output and closed metadata; the response bytes are hashed and
dropped, and no header, URL, error message, or exception string reaches a result
or a log.

All logging happens at the call site through `safeLog`, whose union is closed
and hand-projects every field with no spread anywhere
(`apps/api/src/services/safe-log.ts:153-247`). The existing Pattern arms —
`pattern_dispatch_failed`, `pattern_stage_failed`,
`pattern_stage_terminal_failure`, `pattern_artifact_cleanup_failed` — carry only
`{trace_id}`, so a Pattern provider call would today produce no cost or latency
record at all. Two arms are added:

```ts
| { event: "pattern_publisher_call_completed"; provider: "openai"; pass: PatternPass;
    model: string; prompt_version: string; latency_ms: number;
    input_tokens: number; output_tokens: number; provider_response_hash: string; }
| { event: "pattern_publisher_attempt_failed"; provider: "openai"; pass: PatternPass;
    model: string; prompt_version: string; latency_ms: number; attempt: number;
    failure_class: PatternFailureClass; safe_detail_code: PatternSafeDetailCode; }
```

The `pass` discriminant is required, not decorative: planner and writer share a
model and a prompt version, so without it their costs are unattributable. The
reading arms cannot be reused as they stand, because their `failure_class` is
typed `GenerationFailureCode`, which contains none of `plan_invalid`,
`candidate_invalid`, `semantic_verification_failed`, `plan_missing`, or
`unknown_stage`. `latency_ms` is measured around the publisher call in the
Worker, not inside the adapter. The success arm is emitted before validation, on
purpose: a rejected candidate still costs tokens, and moving the event past
validation would leave a rejected Pattern with no cost record, when cost and
validation rate are exactly what the rollout watches.

What is never logged: prompt text, packet contents, plan, draft, prose, source
excerpts, validator rationales, ontology rules, generation ID, user ID, chart ID,
chart fingerprint, feature ID, Pattern ID, alias map, request URL, provider error
prose, and any arbitrary error message. Plan, candidate, and response hashes stay
in D1 and in the encrypted artifacts, not in ordinary logs. The existing
`safe-log.test.ts` discipline extends to the new arms: a hostile event object
carrying `message`, `stack`, `request_id`, `job_id`, and `response_prose` must
serialize none of them, and the exact key set of
`pattern_publisher_call_completed` is pinned by a test so that adding a field
breaks deliberately.

Administrative inspection gains nothing. `GET /internal/pattern-generations/:id`
and its artifacts listing continue to return metadata only; there is no decrypt
endpoint, and this design does not add one. Every hit continues to write a
`pattern_admin_access_events` row.

## Contracts and schema derivation

No contract file changes shape. The three provider-output documents already
satisfy every OpenAI strict-mode structural rule — root type `object`, every
object closed with `additionalProperties: false`, every declared property in
`required`, nullability expressed as a `["string","null"]` union rather than an
omitted key, and every `$ref` local so nothing needs to resolve at the provider.
The one `anyOf` is nested at `uncertainty_note` rather than at a root.

The only incompatibility is `minLength` and `maxLength`, which are not in the
strict-mode supported keyword set: three plus three in the planner, eight plus
three in the writer, and one plus one in the verdict. `pattern-prompt.ts`
therefore imports each contract document as a JSON module and derives the
provider copy at module load with a `toStrictProviderSchema()` walk that strips
exactly those two keywords and asserts that nothing else outside the supported
set remains. Deriving rather than checking in a second copy keeps the contract
file the single normative source; a checked-in provider-shaped copy would become
a shipped `*.schema.json` that `check_m7_manifest` would demand a `schemas[]`
entry for, and would be a second document to keep in step. The stripped bounds
are re-enforced in the Worker's adapter tier, so `working_title` over 90
characters or an empty `text` is `publisher_output_invalid` rather than a
validator surprise later.

One uncertainty must be settled by preflight rather than by assumption. The
three documents use `pattern` — `^chapter_[0-9]{2}$`, `^signature_[0-9]{2}$`,
`^f[0-9]{3}$` — which is documented as supported, but the shipping M5 precedent
(`contracts/m5/reading-generation-output.schema.json`) uses no `pattern` and no
length bounds at all, so this repository has no live proof that `pattern` is
accepted by the pinned model tier. The implementation must verify a strict
request carrying `pattern` against the authorized account before the model value
is allowed to gate configuration, the same way `gpt-5.6-sol` itself was verified.
If `pattern` is rejected, it is stripped alongside the length keywords and
enforced entirely in the adapter tier; the regexes are already erased in the
TypeScript mirrors (`packages/shared/src/m7-types.ts`), so the runtime validator
is where they have to live regardless.

`contracts/m7/SCHEMA_MANIFEST.json` gains one `amendments` entry in the shape of
the existing one — `date`, `change`, `reason`, with the reason closing on an
explicit purely-additive assertion naming what did not change. Nothing validates
that array mechanically, but the `defines`, `id`, and file-inventory checks in
`check_m7_manifest` are enforced and must continue to pass unchanged.
`contracts/m0` through `contracts/m6` stay byte-identical, proved by the
existing predecessor-freeze checks.

## Verification strategy

### Prompt and packet unit tests

- the three request builders emit only their approved fields, proved by
  comparing the serialized key set against a frozen list;
- no builder accepts the command, the identity, the job row, or the alias map
  as a parameter;
- a fact packet containing a forbidden key at any depth is refused before any
  fetch, with `longitude` permitted only at `features[i].fact.longitude`;
- a document exceeding `PATTERN_INPUT_MAX_BYTES` is refused before any fetch and
  consumes no budget;
- `JSON.stringify(selected.packet)` contains no `nft_`, `usr_`, `cs_`, `chr_`,
  `pgen_`, or `cns_` prefix, extending the existing assertion at
  `packages/pattern-engine/src/engine.test.ts`;
- ontology and source values that read as instructions remain inert JSON string
  values, and the request has exactly one `input` element with one content part;
- `toStrictProviderSchema()` strips `minLength` and `maxLength` and nothing
  else, and the derived schema is structurally identical to the contract
  document otherwise;
- each derived schema round-trips its `contracts/m7/fixtures/valid/` example and
  rejects its `fixtures/invalid/` counterpart, including
  `pattern-semantic-verdict.pass-with-changes.json`; and
- the compiled prompt versions equal the pinned environment values.

### Provider boundary tests

Modelled on `apps/api/src/services/openai-reading-publisher.test.ts`:

- one top-level `instructions` string and exactly one JSON input document;
- `strict: true`, the pinned schema name, and `store: false`;
- no `tools`, `tool_choice`, `background`, `previous_response_id`, `stream`,
  `temperature`, `top_p`, `seed`, `metadata`, or `user` field is present;
- exact model, prompt, reasoning, timeout, and token pins per pass;
- makes exactly one provider request per publish, on every status;
- keeps the timeout active until the response body finishes;
- 401/403, 404, 429, 5xx, other-4xx, refusal, `content_filter`,
  `max_output_tokens`, malformed JSON, missing text, and two text parts each map
  to their intended code and safe detail code;
- `retry_after_seconds` is populated only for 429 and 5xx and only from a
  whole-number header;
- `provider_response_hash` is computed over the raw bytes before parsing, and
  the bytes are not retained;
- never copies provider text into a failure result — the 401 body containing
  `sk-live-REDACTED` must not appear anywhere in the result or the log; and
- the gateway headers `cf-aig-collect-log: false`, `cf-aig-max-attempts: 1`,
  and `cf-aig-skip-cache: true` are present when routed and absent when not.

### Hermetic provider interception

The suite extends the single outbound seam, `apps/api/test/mock-calc-service.ts`,
which miniflare installs as `outboundService` so that every outbound fetch lands
there. No parallel `globalThis.fetch` interceptor is installed as a second seam;
the file's own comment records why — two seams each believe the other covered
the network. Three Pattern passes share the host `api.openai.com` and the path
`/v1/responses`, and all three models are pinned to `gpt-5.6-sol`, so the model
field cannot separate them. The dispatcher therefore gains a pass router keyed on
`text.format.name`: `patternlike_pattern_plan_v7`,
`patternlike_pattern_document_v7`, and `patternlike_pattern_verdict_v7` reach
`patternPlannerResponse`, `patternWriterResponse`, and `patternVerifierResponse`
respectively, and an unrecognized schema name fails closed exactly as an unknown
host does. Each builder derives its output from the packet it was actually sent —
parsing `body.input[0].content[0].text` and echoing back the aliases, chapter
keys, and rule ids the Worker supplied — so the fake cannot drift away from the
request. `responsesEnvelope()` and `outputText()` are pass-agnostic and are
reused unchanged, as are the fifteen existing `OPENAI_MOCK_*` failure sentinels,
which the pass router selects among after deciding which builder produces the
success case. Per-test `globalThis.fetch` wrapping is still used for the three
cases the seam cannot express: counting calls, mutating a real mock response,
and a rejected fetch or a body-phase stall, since miniflare turns a throwing
outbound service into a 5xx response, which is a different thing.

`apps/api/test/helpers.ts` gains `enableOpenAiPattern()` beside the existing
`enablePatternAi()`, setting `PATTERN_PUBLISHER="openai"`, the three model and
prompt-version triples, and `OPENAI_API_KEY`. Because these helpers mutate the
shared `env` object and mutations persist across tests in this pool,
`disablePatternAi()` must be extended in lockstep to clear everything the new
helper sets, or provider credentials leak into later suites.

### Integration tests

Driven through the existing stage pump `drain(generationId)` in
`apps/api/src/routes/pattern-ai.integration.test.ts`, which makes each pass one
explicit `executePatternJob` invocation:

- `publishes a Pattern through three real provider passes` — end to end against
  the fake, asserting three provider calls, three budget units, and one accepted
  document;
- `writes planner, writer, and verifier request and response artifacts` —
  proving the six reserved `artifact_class` values are populated;
- `does not call the provider when the response artifact already exists` — the
  artifact-first probe, asserting zero provider calls and zero budget consumed
  on redelivery;
- `converges on the first response when the advance fails` — the critical case:
  force `advance` to throw after the provider succeeds, re-drive at the same
  `stage_generation`, and assert the published prose and `plan_hash` match the
  first response;
- `refuses a request artifact whose bytes differ under a reserved identity` —
  the `putArtifact` integrity conflict;
- `retries the planner at the same stage generation and increments planner_attempts`;
- `fails terminally after the second planner attempt` — `plan_invalid` at public
  stage `organizing_evidence`;
- `returns to writing when the verifier rejects and writer attempts remain`;
- `fails semantic_verification_failed when no writer attempt remains`;
- `does not echo rejected prose into the writer correction document`;
- `consumes no budget when the plan artifact is missing` — the corrected consume
  placement;
- `consumes no budget on the synthetic publisher`;
- `stops the job at stage_attempts_exhausted only after the pinned per-pass
  budgets are spent` — the `MAX_STAGE_CLAIMS` change;
- `refuses an openai pin with a half-configured AI Gateway`;
- `refuses a configuration in which the writer and verifier prompt versions match`;
- `sends no forbidden key in any of the three provider documents` — asserted by
  capturing every request body from the seam across a full generation and
  running the ban list over all three;
- `records derived provider and model_family in compact provenance`; and
- `never surfaces a provider failure class to the reader` — the failed state
  returns only `state`, `stage`, and `retryable`.

### Full candidate gate

Run focused tests through TDD, then a fresh root `npm run typecheck`,
`npm test`, and `npm run build`. Validate all contract manifests and prove
`contracts/m0` through `contracts/m6` unchanged. Assert `run_worker_first` is
unchanged, since no route is added. Assert `ENCRYPTED_COLUMNS`,
`NESTED_CONTENT_CIPHERTEXT_COLUMNS`, and `UNWRITTEN_ENCRYPTED_COLUMNS` still
partition every `*_enc` column exactly once — no new encrypted column is
introduced by this design, and `encrypted-columns.test.ts` proves it. There is no
user-visible UI change, so no Impeccable pass is required.

## Rollout and operations

Code completion, contract amendment, configuration, deployment, ontology
activation, and each rollout advance are separate evidence gates. The ordered
sequence, following §27.4 of the M7 design:

1. merge the adapter with `PATTERN_AI_ROLLOUT` unchanged at `off` in both
   `wrangler.toml` blocks. Gate: the full candidate gate passes and the
   production Worker's behavior is byte-identically unchanged, because rollout
   `off` short-circuits before any publisher work.
2. apply the forward-only adapter migrations after the already-applied `0007`:
   `0009` adds `correction_document` to the artifact-class CHECK, and `0010`
   adds per-stage-class provider-usage counters. Gate: populated artifact rows
   survive the CHECK rebuild byte-for-byte and `PRAGMA foreign_key_check` is
   empty.
3. deploy the Worker with rollout `off` and no provider path reachable. Gate:
   `GET /health` and an authenticated Pattern status read behave as before.
4. verify `gpt-5.6-sol` in the authorized account's live `/v1/models`, and
   verify that a strict `json_schema` request carrying `pattern` is accepted at
   that model tier. Gate: both checks recorded before any model or schema value
   gates configuration.
5. configure `OPENAI_API_KEY` if not already present, the AI Gateway pair and
   token if the gateway is used, `PATTERN_ONTOLOGY_KEYS`, and
   `PATTERN_ADMIN_TOKEN`. Gate: `checkSecureConfig` refuses each variable's
   absence and each half-configured gateway, proven against production
   configuration before the values are set.
6. approve the numeric daily ceiling. Record the worst-case calculation
   explicitly: 11 provider calls per Pattern × the pinned input and output
   token bounds × current model rates × the maximum new Patterns per UTC day,
   against `PATTERN_DAILY_PROVIDER_CALL_LIMIT`. Gate: an approved number, in
   writing, before any non-`off` rollout.
7. ingest and activate a fully evaluated ontology release. Gate: bundle hash and
   signature verified, `compileOntologyRelease` clean, and the release not
   recalled. Production has no ontology release today, so generation would
   otherwise cancel with `cancel_ontology` before reaching a provider.
8. set `PATTERN_AI_ROLLOUT=internal` with `PATTERN_INTERNAL_ACCOUNT_IDS` naming
   designated accounts. Gate: one complete generation for one internal consented
   account, from reservation through three passes to an accepted document, with
   the recorded `output_tokens` compared against the writer ceiling and the
   `OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS` pin raised if the measurement
   requires it.
9. complete authenticated end-to-end, deletion, chart-correction, and
   admin-access certification on that internal account. Gate: artifact erasure
   proven, export boundaries proven, no plaintext reachable by any admin route.
10. advance to `first_open`. Gate: sustained provider success rate, validation
    rate, queue age, and observed spend within the approved ceiling.

`enabled` is out of scope for this design and requires the separate M7 rollout
gates.

Rollback is `PATTERN_AI_ROLLOUT=off`, which parks queued jobs without decrypting
them and prevents in-flight jobs from entering a new provider stage; paused rows
resume through `resumePausedPatternJobsAfterRollout` only once their lease has
lapsed. Accepted Pattern reads, deletion, revocation, cleanup, correction
reconciliation, and admin inspection keep working. Rollback does not drop M7
tables, delete artifacts, silently select a different model, or reactivate the
M4 editorial Pattern for accounts already on the AI path.

Operational metrics are limited to generation counts, per-pass call counts,
queue age, latency, attempts, token use, failure and validation classes,
model and prompt versions, and hashes. Alert on growing queue age, sustained
provider failures, a rising `candidate_invalid` or `semantic_verification_failed`
rate, and unexpected token growth. Prompt, packet, plan, draft, and prose logging
is forbidden.

## Human-free generation invariant

**Approved 2026-08-19.** An individual Pattern job is machine-run from evidence
selection through publication or terminal failure:

```text
deterministic selection
→ model planner
→ deterministic plan validation
→ model writer
→ deterministic candidate validation
→ independently configured model verifier
→ deterministic publish-or-fail checks
```

No human reviews, edits, approves, moderates, releases, or chooses content for an
individual Pattern. A failed job follows only the bounded machine retry and
terminal-failure rules; it never enters a manual moderation or approval queue.
Reader consent and a reader-requested retry authorize a job but do not approve
its content. Operational rollout decisions and audited incident inspection are
outside the generation path and cannot mutate a candidate, change a verdict, or
authorize publication. Design-time sign-off is likewise not a runtime gate.

## Resolved questions

**Approved 2026-08-19.** Q1–Q6 are closed and may not be reinterpreted during
implementation:

1. **Writer attempt ceiling and counting rule.** The planner receives at most
   two provider calls per job, the writer receives at most three per job against
   one frozen plan, and the verifier receives at most two per candidate; every
   maximum includes the first call. New commands freeze
   `writer_attempts_max: 3`, while the type accepts `2 | 3` until pre-approval
   development rows carrying `2` are gone.
   The current `isPatternCommand` checks only `command_version`; implementation
   must make the decoder validate the maxima truthfully while accepting both
   writer values. The worst-case bound is therefore
   `2 + 3 + (3 × 2) = 11` provider calls, not 7 or 14.
2. **Verifier visibility and independence.** Supply the complete frozen plan,
   as §14.1 requires. `resolvePatternPublisherConfiguration` refuses a writer
   and verifier with an identical `(provider, model, prompt_version)` tuple, as
   §14.2 requires. Do not introduce a reduced plan projection in this slice.
3. **Synthetic `assembly_mode`.** Keep the frozen
   `assembly_mode: "constrained_model"` contract and do not bump
   `schema_version`. `PATTERN_PUBLISHER=synthetic` remains development-only and
   is refused in every reader-serving environment.
4. **Verifier finding vocabulary.** Keep the closed finding-code vocabulary in
   `pattern-prompt.ts` and reject unknown codes at runtime. Leave the frozen
   contract's bounded string open until live evaluation evidence stabilizes the
   vocabulary; do not add a `$def` now.
5. **Stage-claim ceiling.** Raise `MAX_STAGE_CLAIMS` from 8 to 16 only after
   provider charging moves to immediately before fetch. Eleven provider-call
   deliveries plus publishing require 12 healthy claims; the remaining four
   claims are bounded recovery headroom for lease expiry and artifact adoption.
   The constant bounds claim churn, while `PATTERN_DAILY_PROVIDER_CALL_LIMIT`
   independently bounds spend.
6. **Cross-pass budget attribution.** Add forward-only migration `0010` with
   bounded planner, writer, and verifier counters beside `used_calls` in
   `pattern_provider_daily_usage`. Continue enforcing the shared daily ceiling
   against `used_calls`; the stage-class counters provide the recording §25.3
   requires and do not create separate sub-ceilings.

## Out of scope

- changing `packages/pattern-engine`'s selection, ranking, plan validation,
  candidate validation, projection, or purity contract;
- changing any frozen contract package, or changing `contracts/m7`'s
  `schema_version`, any `$id`, any enum, or any required field;
- advancing `PATTERN_AI_ROLLOUT` in any environment as a consequence of merging
  this code, and configuring or mutating any Worker secret as an implicit
  consequence;
- the ontology generation and evaluation pipeline, its own provider tuple, its
  own rollout switch, and its own budget ledger;
- giving any Pattern pass tools, browsing, file search, code execution, remote
  MCP servers, background mode, or provider-side conversation state;
- automatic provider or model failover, a second model as editor or fallback,
  and any `pass_with_changes` verdict;
- a human review step, an editorial release fallback, or a deterministic prose
  fallback when generation is unavailable;
- reading personal context, life events, check-ins, journals, or prior daily
  readings into any Pattern pass;
- an admin decrypt endpoint, a provider-metadata clear column, or any new
  encrypted column;
- new reader-facing UI, new public failure detail, or any change to the coarse
  three-value public stage map;
- regenerating existing M4 editorial Patterns or migrating existing accounts
  onto the AI path; and
- the live-provider evaluation lane's corpus content, which the M7 design scopes
  separately and which runs only on synthetic profiles.
