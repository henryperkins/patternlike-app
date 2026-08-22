# OpenAI Daily Reading Publisher Implementation Plan

> **ARCHIVED 2026-08-22 — complete.** M5 shipped: `contracts/m5`,
> `db/d1/0003_m5_openai_reading_publisher.sql`, and
> `apps/api/src/services/openai-reading-publisher.ts`. Its design stays in
> `docs/superpowers/specs/` rather than moving here, because the frozen
> `contracts/m5/common.schema.json` names that file a normative source.
> Do not execute. Index: [`../README.md`](../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the active-editorial-release prerequisite for new daily readings with an autonomous OpenAI publisher, grounded in reproducible daily-sky calculations and consented context, while preserving deterministic eligibility, encrypted provenance, bounded retries, and atomic publication.

**Architecture:** Keep the existing Cloudflare Worker, D1 outbox, and single-message Queue consumer. Add a versioned M5 contract family, a Swiss Ephemeris daily-sky endpoint, one pure constrained-input compiler used at enqueue and execute, a provider-neutral OpenAI adapter, V1/V2 command dispatch, dual V3/V5 readers, a bounded pre-generation scheduler, and explicit fact-invalidation semantics. Historical V3 readings and release infrastructure remain readable but cannot influence V2 jobs.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Queues and D1, Vitest with the Workers pool, Node test through tsx, Python jsonschema validation, Swiss Ephemeris, React, OpenAI Responses API, and npm workspaces.

## Global Constraints

- The approved design at docs/superpowers/specs/2026-08-10-openai-daily-reading-publisher-design.md is authoritative. If implementation evidence requires a behavioral change, stop and amend/reapprove the design before changing code.
- Use test-driven development for every runtime task: add the named failing test, run it and record the expected failure, implement the smallest passing change, then rerun the focused lane.
- Do not change any byte under contracts/m0 or contracts/m3. The extended validator must prove both predecessor directories clean and validate all three manifests.
- Keep apps/calc-stub AGPL-compatible. It may import packages/shared but must never import packages/reading-engine or product prompt, ranking, selection, or validation policy.
- Preserve apps/api/vitest.config.ts fileParallelism: false. API test files share one D1 database and resetDb() is not safe across parallel files.
- The Queue message is exactly the incumbent opaque { job_id, reading_id } nudge. Never add a user ID, chart fingerprint, reading key, consent ID, command field, raw birth date/time/place/coordinates/timezone, credential, prompt, context, or prose to it. Provider requests exclude both IDs; product responses may retain the owner-scoped reading_id but never job IDs; logs exclude both IDs and every listed private field.
- Raw context values may be plaintext only inside the already DEK-encrypted V2 job envelope. Do not add nested ciphertext or a second AAD identity for command snapshots.
- Every V2 execution must call prepareConstrainedReadingInput() after live eligibility checks and compare both frozen hashes before any provider request. Callers must not call a lower-level identity builder or duplicate the eligibility partition.
- generation_input_id identifies the eligible input and policy, not the nondeterministic prose. content_hash plus provider_response_hash identify the winning candidate. completeReading() claim CAS remains the only publication authority.
- One Queue delivery may make at most one OpenAI request. It may perform the frozen calculation verification first, then must recheck that the claim has OPENAI_READING_TIMEOUT_MS plus 60 seconds remaining.
- No alternate model, previous-day reading, deterministic copy, signed release, or secondary-model fallback is permitted on the V5 path.
- Use direct fetch for the OpenAI adapter. The Worker owns consent, selection, validation, retry decisions, publication, and logs; the adapter owns only the provider request/response mapping.
- Add one staged configuration value, READING_V5_ROLLOUT, with the closed states off, internal, first_open, and hybrid. off enables dual reads only; internal permits authenticated internal V2 reservations; first_open permits PUT Today; hybrid also permits scheduled reservations. Publisher configuration is mandatory whenever the value is not off.
- off is also the provider kill switch for already-queued V2 work. Before claim, queue.ts joins the opaque message IDs to daily_readings.assembly_mode; for a constrained_model job it atomically leaves status queued, sets available_at to 305 seconds later, clears dispatched_at, leaves attempts unchanged, then acknowledges the current Queue message. D1 is the durable pause; do not spend the platform's max_retries=3 budget while off. Re-enabling resumes through the bounded authenticated sweep after available_at, an owner-scoped pending-job redispatch that may advance only that user's row in first_open, and the scheduled recovery sweep once hybrid is active. Every path performs no decryption, calculation, budget use, or provider call until rollout permits execution. Downgrading among non-off modes gates new entry points while already-claimed work finishes under its frozen command.
- Production cron activation is a separate deployment gate. Land and verify the scheduled handler before adding the production trigger.
- Budget exhaustion is terminal for that command, makes no OpenAI call, receives no Queue retry or command replacement, and is projected as HTTP 503 with retryable: false. It is not folded into the exhausted-generation HTTP 424 state.
- The AI-synthesis API is fixed to GET, PUT, and DELETE /v1/consents/ai-synthesis. PUT grants the displayed server-owned policy version; DELETE revokes the current grant. Neither route can grant research or model_training.
- The initial ordered AI consent categories are exactly birth_accuracy_and_uncertainty, calculated_natal_facts, active_calculated_cycles, calculated_daily_sky, enabled_personal_context, prior_reading_excerpts, and reading_feedback. Every personal provider-packet section maps to one category. Source-specific M4 journal/check-in/connector categories and controls remain absent; the generic enabled_personal_context category permits only signals with an already-active source permission. Adding a distinct category requires a new consent-policy version and a fresh grant.
- An active context source requires an enabled/active context_source_permissions row linked to a granted source consent. Their source ID, consent ID, and allowed-use arrays must agree; disagreement rejects the source. The lane intersection remains signal allowed uses intersect active source-consent allowed uses intersect M5_SUPPORTED_USES.
- M5_SUPPORTED_USES is exactly annual_context, environment_context, life_domain_selection, narrative_continuity, optional_recommendations, pattern_profile, reflection_prompt, relationship_interpretation, repetition_control, routine_context, theme_eligibility, theme_filtering, theme_ranking, tone, travel_context, user_memory, and workload_context. Do not alias, extend, or reopen the frozen M0 enum.
- Context selection policy v1 includes every selected calculation fact; reserves the newest eligible signal from each implemented source; then fills remaining context round-robin by source, ordered by observed_at descending and ID ascending; includes the last seven published reading headline/lead/reflection triples; and includes up to twenty recent structured feedback records. Each free-text excerpt is NFC-normalized and capped at 2,048 UTF-8 bytes on a code-point boundary. Mandatory facts or policy text exceeding the 98,304-byte packet ceiling fails closed.
- Preserve an existing stored domain preference when one is available. The current product has no writer and therefore legitimately pins null; this feature must not invent a preference or add an unrelated preference surface.
- The initial collective-event vocabulary is sign ingress plus exact major transiting conjunction, sextile, square, trine, and opposition. Stations, eclipses, exact lunations, and seasonal points are not silently inferred into V5.
- Lunar phase uses eight closed 45-degree bins centered at 0, 45, 90, 135, 180, 225, 270, and 315 degrees: new_moon, waxing_crescent, first_quarter, waxing_gibbous, full_moon, waning_gibbous, last_quarter, and waning_crescent.
- Session activity is qualifying activity. Update sessions.last_seen_at at most once per hour per session and recompute next_due_at after account creation, timezone confirmation/change, chart activation, AI consent change, and that throttled activity touch.
- A published reading is stable for its local day. New context, feedback, ordinary preferences, and consent revocation affect future provider calls/readings but do not rewrite or hide an otherwise factually valid published artifact. Only the explicit factual invalidation path may remove a published row from Today before a successor exists.
- Keep run_worker_first exactly ["/health", "/v1/*", "/internal/*"] in default and production Wrangler configuration.
- Do not stage generated apps/calc-stub/dist files, downloaded ephemeris data, local D1 state, credentials, screenshots outside the approved evidence location, or unrelated dirty files.
- Before Task 1, record the implementation base with `$env:PATTERNLIKE_M5_IMPLEMENTATION_BASE = (git rev-parse HEAD).Trim()` and copy that exact commit into the execution notes so a later shell can restore it. Final whitespace and candidate-range checks must cover that base through HEAD, not only the then-clean worktree.

## Phase A: Contracts and Calculation Authority

### Task 1: Define and validate the complete M5 contract family

**Files:**

- Create: contracts/m5/common.schema.json
- Create: contracts/m5/daily-sky-request.schema.json
- Create: contracts/m5/daily-sky-response.schema.json
- Create: contracts/m5/generation-command.schema.json
- Create: contracts/m5/reading-generation-request.schema.json
- Create: contracts/m5/reading-generation-output.schema.json
- Create: contracts/m5/daily-reading.schema.json
- Create: contracts/m5/reading-evidence.schema.json
- Create: contracts/m5/openapi/calc.openapi.yaml
- Create: contracts/m5/openapi/openapi.yaml
- Create: contracts/m5/fixtures/generate_fixtures.py
- Create: contracts/m5/fixtures/valid/daily-sky-request.exact.json
- Create: contracts/m5/fixtures/valid/daily-sky-response.zero-events.json
- Create: contracts/m5/fixtures/valid/daily-sky-response.exact-events.json
- Create: contracts/m5/fixtures/valid/generation-command.v2.json
- Create: contracts/m5/fixtures/valid/reading-generation-request.json
- Create: contracts/m5/fixtures/valid/reading-generation-output.json
- Create: contracts/m5/fixtures/valid/daily-reading.published.json
- Create: contracts/m5/fixtures/valid/reading-evidence.daily.json
- Create: contracts/m5/fixtures/invalid/daily-sky-request.carries-birth-data.json
- Create: contracts/m5/fixtures/invalid/daily-sky-request.carries-user-id.json
- Create: contracts/m5/fixtures/invalid/daily-sky-response.missing-anchor-facts.json
- Create: contracts/m5/fixtures/invalid/daily-sky-response.unordered-facts.json
- Create: contracts/m5/fixtures/invalid/daily-sky-response.end-boundary-event.json
- Create: contracts/m5/fixtures/invalid/generation-command.missing-ai-consent.json
- Create: contracts/m5/fixtures/invalid/generation-command.carries-release.json
- Create: contracts/m5/fixtures/invalid/reading-generation-request.carries-storage-id.json
- Create: contracts/m5/fixtures/invalid/reading-generation-output.extra-property.json
- Create: contracts/m5/fixtures/invalid/reading-generation-output.bad-role-order.json
- Create: contracts/m5/fixtures/invalid/daily-reading.fallback.json
- Create: contracts/m5/fixtures/invalid/reading-evidence.missing-model.json
- Create: contracts/m5/SCHEMA_MANIFEST.json
- Modify: contracts/validate_schemas.py

**Interfaces:**

- Schema version is 0.5.0.
- M5 reuses the frozen M0 allowedUse definition by reference and applies the closed M5_SUPPORTED_USES subset through M5 schema constraints and validator policy checks.
- The daily-sky response is an ok-discriminated union with one ordered facts array. Fact kinds are anchor_position, lunar_phase, transit_natal_contact, sign_ingress, collective_exact_aspect, and house_placement.
- Fact order is the frozen kind rank above, then effective_at, then fact_id. The opaque profile is patternlike.daily-sky-fact-id.v1 and renders dsf_ plus the first 32 lowercase SHA-256 hex characters of a closed JCS preimage.
- Every fact carries precision, calculation policy, ephemeris-data version, container digest, and full content digest. The success response must contain anchor positions and one lunar-phase fact even when the event subset is empty.
- daily-reading-v5 fixes assembly_mode to constrained_model, removes fallback_used and safety_fallback, requires an AI disclosure, and requires a model-bearing V5 evidence graph.
- The product OpenAPI defines GET/PUT/DELETE /v1/consents/ai-synthesis, V3/V5 unions for PUT/GET /v1/readings/today and GET /v1/readings/{id}/evidence, and the exact 200/202/404/409/424/503 safe envelopes and retryable flag.
- The manifest pins both predecessor digests and records an explicit daily-reading-family supersession plus the intentional breaks: constrained_model-only V5, required model evidence, removed release/fallback fields, and removed safety_fallback role.

    export interface ReadingEvidenceV5 {
      schema_version: "0.5.0";
      reading_id: string;
      revision: number;
      revision_reason:
        | "initial"
        | "chart_recalculated"
        | "consent_revoked"
        | "safety_correction"
        | "defect_repair";
      generated_at: string;
      generation_input_id: string;
      input_manifest_hash: string;
      content_hash: string;
      provider_response_hash: string;
      calculation: {
        chart_contract_id: string;
        cycle_policy_version: string;
        daily_sky_policy_version: string;
        ephemeris_data_version: string;
        container_digest: string;
        tzdb_version: string;
        local_day_resolution_policy_version: string;
      };
      model: {
        provider: "openai";
        model: string;
        prompt_version: string;
        selection_policy_version: string;
        validation_policy_version: string;
        provider_request_id: string;
        input_tokens: number;
        output_tokens: number;
      };
      paragraphs: Array<{
        paragraph_id: string;
        role: string;
        order: number;
        fact_refs: Array<{
          fact_id: string;
          fact_class: string;
          label: string;
          scope: "personalized" | "collective";
        }>;
        context_refs: Array<{
          private_ref: string;
          category: AiConsentDataCategory;
          allowed_use: string;
        }>;
      }>;
      validation: {
        status: "passed";
        policy_version: string;
        checks: Array<{ code: string; passed: true }>;
      };
    }

- [ ] **Step 1: Make the validator demand a package-scoped M5 registry and second predecessor proof.**

Refactor the current global fixture filename map so keys are (package, filename prefix); otherwise duplicate M3/M5 names such as generation-command resolve to the wrong schema. Add M5 and PACKAGE_BASE["m5"], both M5 OpenAPI documents, and a check that pins the normalized digest of contracts/m3/SCHEMA_MANIFEST.json and rejects git status output under contracts/m3.

- [ ] **Step 2: Run the validator and confirm the new required package is absent.**

Run: python contracts/validate_schemas.py

Expected: non-zero exit naming the missing M5 schema/package or manifest, while the existing M0 freeze check still runs.

- [ ] **Step 3: Add the closed schemas, OpenAPI documents, valid fixtures, and invalid fixtures.**

Use closed objects throughout. Keep engine refusal as HTTP 200 with ok: false; authentication and transport failures remain non-200 safe envelopes. Add custom validator checks for fact order, unique IDs, half-open event bounds, content-digest/ID agreement, required anchor facts, suppression rules, the exact allowed-use subset, consent/OpenAPI status projections, evidence counts/hashes, predecessor digests, and the manifest supersession/breaking-change inventory. Run `python contracts/m5/fixtures/generate_fixtures.py` after the schemas exist. That script writes fixtures only; explicitly author SCHEMA_MANIFEST.json with LF-normalized SHA-256 digests of the frozen M0 and M3 manifests, the supersession note, and the breaking-change inventory.

- [ ] **Step 4: Regenerate fixtures and prove all three packages plus both predecessors.**

Run:

    python contracts/m5/fixtures/generate_fixtures.py
    python contracts/validate_schemas.py

Expected: all M0, M3, and M5 schemas, fixtures, OpenAPI documents, and manifests pass; both contracts/m0 and contracts/m3 are reported unchanged.

- [ ] **Step 5: Commit the contract boundary.**

Commit: contracts: define M5 publisher and daily-sky contracts

### Task 2: Add shared daily-sky wire types and local-day resolution

**Files:**

- Create: packages/shared/src/daily-sky-types.ts
- Create: packages/shared/src/daily-sky-types.test.ts
- Create: packages/shared/src/m5-reading-types.ts
- Create: packages/shared/src/m5-reading-types.test.ts
- Modify: packages/shared/src/index.ts
- Modify: apps/api/src/services/local-day.ts
- Modify: apps/api/src/services/local-day.test.ts
- Create: apps/api/src/services/daily-sky-client.ts
- Create: apps/api/src/services/daily-sky-client.test.ts
- Modify: apps/api/package.json
- Modify: package-lock.json

**Interfaces:**

- packages/shared/src/m5-reading-types.ts is the single TypeScript owner for the schema-derived M5 wire types used across API, reading engine, and web: AiConsentDataCategory, ReadingGenerationRequest, ReadingGenerationOutput, GroundedUnit, DailyReadingV5, and ReadingEvidenceV5. Its exact closed category union is the ordered seven-value list in Global Constraint 30. Consumers import these types; they do not redeclare local lookalikes. API-internal encrypted command/storage types remain owned by their API modules.

    export const M5_SCHEMA_VERSION = "0.5.0" as const;
    export const DAILY_SKY_POLICY_ID = "daily-sky-launch" as const;
    export const DAILY_SKY_POLICY_VERSION = "1.0.0" as const;

    export interface DailySkyRequest {
      schema_version: typeof M5_SCHEMA_VERSION;
      request_id: string;
      day_start_at: string;
      day_end_at: string;
      anchor_at: string;
      anchor_resolution:
        | "unique"
        | "ambiguous_earlier"
        | "nonexistent_shift_forward";
      natal_positions: NatalPositionInput[];
      natal_house_cusps?: NatalHouseCusps;
      effective_accuracy: BirthTimeAccuracy;
      uncertainty: UncertaintyReport;
      suppressed_features: SuppressedFeatureClass[];
      zodiac: "tropical";
      node: "true";
      ephemeris_data_version: string;
      tzdb_version: string;
      local_day_resolution_policy_version: "1.0.0";
      calculation_policy_id: string;
      calculation_policy_version: string;
      contract_id: string;
      contract_version: string;
    }

    export interface DailySkyWindow extends LocalDayWindow {
      anchorAt: string;
      anchorResolution:
        | "unique"
        | "ambiguous_earlier"
        | "nonexistent_shift_forward";
      tzdbVersion: string;
      localDayResolutionPolicyVersion: "1.0.0";
    }

    export type LocalDateResolution =
      | { ok: true; window: DailySkyWindow }
      | { ok: false; reason: "skipped_local_date"; nextRepresentableDate: string };

    export function classifyV5CalculationFailure(
      endpoint: "cycles" | "daily_sky",
      errorClass:
        | "invalid_request"
        | "unsupported_body"
        | "ephemeris_range"
        | "cycle_window_incomplete"
        | "calculation_failed",
    ):
      | "calc_unavailable"
      | "daily_sky_unavailable"
      | "policy_unsupported";

- [ ] **Step 1: Write failing shared identity/type tests and local-day edge tests.**

Cover the schema-derived reading/evidence/category types, exact constants, closed fact identity preimages, stable rendered IDs, stable content digests, serialization without forbidden account/birth fields, equality between effective_accuracy and uncertainty.accuracy, equality between the normalized uncertainty and top-level suppression sets, a package-lock-pinned tzdb version and local-day-resolution policy in the request identity, 23/24/25-hour days, Kathmandu and Chatham offsets, earlier-offset ambiguous noon, shifted nonexistent noon, and a wholly skipped date such as Pacific/Apia 2011-12-30.

- [ ] **Step 2: Run the focused tests and verify the exports and anchor resolver do not exist.**

Run:

    npm exec -w @patternlike/shared -- tsx --test src/daily-sky-types.test.ts src/m5-reading-types.test.ts
    npm exec -w @patternlike/api -- vitest run src/services/local-day.test.ts src/services/daily-sky-client.test.ts

Expected: failures for missing daily-sky exports/client and missing noon/skipped-date resolution.

- [ ] **Step 3: Implement the wire types, domain-separated identities, resolver, and narrow request builder.**

Implement the schema-derived M5 wire types once in m5-reading-types.ts and export them from @patternlike/shared. Add a package-lock-pinned moment-timezone dependency for the scheduling resolver and pin its reported tzdb data version into every DailySkyWindow/request/command identity; do not rely on an unversioned Worker Intl database for M5 day boundaries. Project natal longitudes, optional allowed cusps, accuracy, uncertainty suppression, and calculation versions field by field. Never spread ChartSnapshot because it contains user_id, fingerprint, and raw birth fields. The client calls POST /v1/daily-sky and verifies the closed echo/metadata. Map calculation_failed to the endpoint's retryable unavailable class; map invalid_request, unsupported_body, ephemeris_range, and cycle_window_incomplete to terminal policy_unsupported. Retain cycle_scan_refused only for V1.

Keep daily-sky-client.test.ts isolated with a locally stubbed fetch in Task 2; Task 4 then exercises the shared host dispatcher and reruns the client test after adding the calc mock route.

- [ ] **Step 4: Re-run focused tests and shared/API typechecks.**

Run:

    npm exec -w @patternlike/shared -- tsx --test src/daily-sky-types.test.ts src/m5-reading-types.test.ts
    npm exec -w @patternlike/api -- vitest run src/services/local-day.test.ts src/services/daily-sky-client.test.ts
    npm run typecheck -w @patternlike/shared -w @patternlike/api

Expected: all pass.

- [ ] **Step 5: Commit the shared boundary.**

Commit: shared: add M5 daily-sky wire types

### Task 3: Implement the pure daily-sky calculation policy

**Files:**

- Create: apps/calc-stub/src/daily-sky-policy.ts
- Create: apps/calc-stub/src/daily-sky.ts
- Create: apps/calc-stub/src/daily-sky.test.ts
- Modify: apps/calc-stub/src/cycles.ts
- Modify: apps/calc-stub/src/cycles.test.ts
- Modify: apps/calc-stub/src/engine.ts
- Modify: apps/calc-stub/src/validation.test.ts

**Interfaces:**

    export interface ValidatedDailySkyRequest {
      request: DailySkyRequest;
      dayStartJd: number;
      dayEndJd: number;
      anchorJd: number;
    }

    export interface DailySkyOptions {
      source?: EphemerisSource;
      containerDigest?: string;
      ephemerisDataVersion?: string;
      bodies?: readonly TransitingBody[];
    }

    export function validateDailySkyRequest(
      body: unknown,
    ): ValidatedDailySkyRequest;

    export function calculateDailySky(
      request: ValidatedDailySkyRequest,
      options?: DailySkyOptions,
    ): DailySkyFact[];

    export function handleDailySky(
      body: unknown,
      options?: DailySkyOptions & { requestIdFallback?: string },
    ): DailySkyResponse;

- [ ] **Step 1: Write failing analytic-ephemeris tests.**

Require anchor positions and one phase on a no-event day; start-boundary inclusion and end-boundary exclusion; exact transit-to-natal contacts; sign ingresses; exact collective major aspects; deterministic ordering/IDs/digests; all eight lunar bins; one positive exact-time house placement when allowed cusps are supplied; no house fact without allowed cusps; and suppression of houses, angles, angle transits, and time-sensitive natal Moon claims for approximate/unknown inputs. Require byte-identical output for identical requests.

- [ ] **Step 2: Run the focused test and confirm no daily-sky policy exists.**

Run: npm exec -w @patternlike/calc-stub -- tsx --test src/daily-sky.test.ts

Expected: failure because daily-sky.ts and its exports are absent.

- [ ] **Step 3: Implement validation and calculation using the existing ephemeris primitives.**

Narrowly export jdFromUnixMs, jdToIso, EphemerisSource, swissEphemerisSource, signOf, and houseNumber where reuse is safe. Do not call or modify handleCycleScan behavior. Root-find exact events inside [day_start_at, day_end_at), compute anchor values only at anchor_at, apply the approved uncertainty/suppression policy, then assign canonical IDs and digests after deterministic sorting.

- [ ] **Step 4: Run daily-sky, cycles, validation, and typecheck lanes.**

Run:

    npm exec -w @patternlike/calc-stub -- tsx --test src/daily-sky.test.ts src/cycles.test.ts src/validation.test.ts
    npm run typecheck -w @patternlike/calc-stub

Expected: all pass and the existing M3 cycle tests remain unchanged.

- [ ] **Step 5: Commit the calculation policy.**

Commit: calc: calculate authoritative daily-sky facts

### Task 4: Pin real ephemeris goldens and expose POST /v1/daily-sky

**Files:**

- Create: apps/calc-stub/src/daily-sky-golden.test.ts
- Create: apps/calc-stub/src/fixtures/daily-sky-golden-vectors.json
- Modify: apps/calc-stub/package.json
- Modify: apps/calc-stub/src/server.ts
- Modify: apps/calc-stub/src/service-auth.test.ts
- Modify: apps/api/test/mock-calc-service.ts

**Interfaces:**

- The endpoint uses the existing service-auth check and safe transport envelope.
- Valid calculation responses, including ok: false engine refusals, use HTTP 200. Bad authentication and invalid transport remain non-200.
- The single API test interceptor dispatches by host first, then calc path. Unknown hosts fail closed.

- [ ] **Step 1: Add failing real-ephemeris vectors and endpoint tests.**

Select pinned dates that exercise an ordinary anchor, a sign ingress, a transit-natal exact contact, a collective exact aspect, and an exact-time house placement from supplied cusps. Record independent Swiss Ephemeris values to the schema precision and assert positions, phase, houses, exact timestamps, IDs, digests, container digest, and ephemeris-data version.

- [ ] **Step 2: Run the focused tests and confirm the endpoint/mock route is absent.**

Run:

    npm run ephe:download -w @patternlike/calc-stub
    npm exec -w @patternlike/calc-stub -- tsx --test src/daily-sky-golden.test.ts src/service-auth.test.ts

Expected: endpoint or golden test failure.

- [ ] **Step 3: Add the server route and host-first API mock dispatcher.**

Route the calculation host to /v1/calculate, /v1/cycles, and /v1/daily-sky. Route api.openai.com only to the future Responses fake seam. Reject every other host. Drive daily-sky mock failures with opaque request-ID sentinels, never chart or user identifiers. Expand test:golden so the focused calculation authority lane runs both src/golden.test.ts and src/daily-sky-golden.test.ts.

- [ ] **Step 4: Run calc, contract, and build gates.**

Run:

    npm test -w @patternlike/calc-stub
    npm run test:golden -w @patternlike/calc-stub
    npm exec -w @patternlike/api -- vitest run src/services/daily-sky-client.test.ts
    npm run test:contracts
    npm run build -w @patternlike/calc-stub

Expected: all pass with no generated dist or ephemeris data staged.

- [ ] **Step 5: Commit the authenticated calculation endpoint.**

Commit: calc: expose and pin daily-sky endpoint

## Phase B: Deterministic Input, Storage, and Publishing

### Task 5: Add the pure constrained-input compiler and candidate validator

**Files:**

- Create: packages/reading-engine/src/constrained-types.ts
- Create: packages/reading-engine/src/constrained-input.ts
- Create: packages/reading-engine/src/constrained-input.test.ts
- Create: packages/reading-engine/src/candidate-policy.ts
- Create: packages/reading-engine/src/candidate-validation.ts
- Create: packages/reading-engine/src/candidate-validation.test.ts
- Modify: packages/reading-engine/src/types.ts
- Modify: packages/reading-engine/src/index.ts
- Modify: packages/reading-engine/package.json
- Modify: package-lock.json

**Interfaces:**

    export function prepareConstrainedReadingInput(
      input: ConstrainedReadingInput,
    ): PreparedConstrainedReadingInput;

    export interface PreparedConstrainedReadingInput {
      selected_facts: ConstrainedFact[];
      selected_context: ConstrainedContextRef[];
      rejections: Rejection[];
      request: ReadingGenerationRequest;
      input_manifest_canonical: string;
      identity_canonical: string;
    }

    export function validateReadingCandidate(
      candidate: ReadingGenerationOutput,
      prepared: PreparedConstrainedReadingInput,
    ): CandidateValidationResult;

    import type {
      ReadingGenerationOutput,
    } from "@patternlike/shared";

ReadingGenerationOutput and GroundedUnit are the closed schema-derived types owned by packages/shared/src/m5-reading-types.ts; the reading engine owns only constrained selection and validation policy.

- [ ] **Step 1: Write failing compiler tests around the eligibility invariant.**

Cover every M5 supported-use lane; expansion to one pin per signal/use pair; source registry rejection; disabled/revoked/stale/mismatched permission or consent; a permission/consent allowed-use disagreement rejecting the whole source; permutation-stable output; exact byte boundary; all-facts-always behavior; newest-per-source reservation and round-robin fill; last-seven reading repetition input; twenty-feedback limit; zero-cycle daily-sky input; and exact/approximate/unknown suppression.

- [ ] **Step 2: Write failing candidate-policy tests.**

Freeze the allowed body, sign, aspect, house, phase, date, degree, and timestamp vocabulary from supplied facts. Freeze versioned rules for echoed local date/locale, fixed role order, paragraph/length bounds, context-reference lane authorization, unknown references, collective-as-personal language, context-as-astrological-discovery, HTML, Markdown links, executable/application instructions, prompt/schema leakage, diagnosis, medical causation, guarantees, fatalism, professional-advice replacement, and evidence-count/hash agreement. Require every substantive astrology unit to cite at least one supplied fact.

- [ ] **Step 3: Run the focused engine tests and verify the new entry points are missing.**

Run:

    npm exec -w @patternlike/reading-engine -- tsx --test src/constrained-input.test.ts src/candidate-validation.test.ts

Expected: failures for missing modules/exports.

- [ ] **Step 4: Implement the one pure entry point and versioned validator.**

Add @patternlike/shared as a type-only workspace dependency; this does not move ranking, selection, eligibility, prompt, or validation policy into the AGPL-reachable shared package. Import the schema-derived wire types and call partitionContext() internally after expanding every exact allowed-use intersection. Canonicalize only closed projections. Include all mandatory facts before context budgeting. Normalize/truncate excerpts deterministically; never invoke a model summary. Produce fact/context reference maps so candidate validation never needs mutable D1 state.

- [ ] **Step 5: Prove serialization minimization and unchanged V3 assembly.**

Run:

    npm test -w @patternlike/reading-engine
    npm run typecheck -w @patternlike/reading-engine

Expected: all constrained tests and the existing assemble/eligibility/identity tests pass.

- [ ] **Step 6: Commit the pure product policy.**

Commit: reading-engine: add constrained input and validation

### Task 6: Add the empty-state M5 migration and storage primitives

**Files:**

- Create: db/d1/0003_m5_openai_reading_publisher.sql
- Modify: db/d1/MIGRATIONS.json
- Modify: contracts/smoke_check.py
- Create: apps/api/src/db/provider-usage.ts
- Create: apps/api/src/db/provider-usage.test.ts
- Create: apps/api/src/services/stored-reading.ts
- Modify: apps/api/src/db/users.ts
- Modify: apps/api/src/db/encrypted-columns.test.ts
- Modify: apps/api/src/db/key-rotation.test.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/db/readings.ts
- Modify: apps/api/src/services/generation.integration.test.ts
- Modify: apps/api/src/routes/readings.integration.test.ts

**Interfaces:**

    export async function consumeProviderCallBudget(
      env: Env,
      utcDate: string,
      limit: number,
    ): Promise<
      | { ok: true; used: number }
      | { ok: false; reason: "exhausted" }
    >;

    export type StoredReading = StoredReadingV3 | StoredReadingV5;

    export interface StoredReadingV5 {
      schema_version: "0.5.0";
      reading: DailyReadingV5;
      evidence_header: Omit<ReadingEvidenceV5, "paragraphs">;
      invalidation:
        | null
        | {
            reason: "chart_correction" | "calculation_defect";
            actor_class: "user_change" | "operator";
            invalidated_at: string;
          };
    }

    export type PredecessorTransition =
      | { kind: "none" }
      | { kind: "supersede_published"; readingId: string }
      | { kind: "retain_invalidated"; readingId: string };

- [ ] **Step 1: Add failing empty/non-empty migration smoke cases.**

The empty M3 fixture must migrate through assertion preflight, DROP reading_sources and daily_readings under the documented 0002 foreign-key procedure, recreate final table names directly, and pass PRAGMA foreign_key_check plus PRAGMA quick_check. A fixture containing a dependent daily_readings, reading_sources, or reading_feedback row must abort before either table is dropped.

- [ ] **Step 2: Run the smoke test and verify 0003 is missing.**

Run: python contracts/smoke_check.py

Expected: failure for the missing migration/final schema.

- [ ] **Step 3: Implement 0003 and its migration manifest entry.**

Make release_version nullable and require it exactly for deterministic/V3 rows. Add constrained_model/null-release V5 rows, invalidated status, and invalidated_at iff invalidated. Preserve encrypted column names/AAD identities, revision/live/pending/successor/composite-owner constraints, and global reading_key uniqueness. Add:

    idx_users_next_due_at(next_due_at, id)
      WHERE status = 'active' AND next_due_at IS NOT NULL
    idx_users_unseeded_due(created_at, id)
      WHERE status = 'active' AND next_due_at IS NULL
    idx_daily_readings_failed_generation(updated_at, user_id)
      WHERE status = 'failed' AND command_generation < 3
    idx_daily_readings_invalidated_repair(updated_at, id)
      WHERE status = 'invalidated'
    idx_jobs_failed_result_class(result_class, finished_at, id)
      WHERE status = 'failed'

Add reading_provider_daily_usage keyed only by UTC date, with a non-negative used_calls count.

- [ ] **Step 4: Write failing storage, budget-race, CAS, and rotation tests.**

Cover legacy V3 decrypt; V5 write/read; reading-v5:user:date:rN grammar disjoint from legacy user: keys; nullable release enforcement; invalidated rows excluded from Today; a publication CAS loser unable to overwrite a winner; and simultaneous budget consumers admitting exactly the configured count.

- [ ] **Step 5: Implement storage unions, atomic budget consumption, and encryption registration.**

Move context_signals.value_enc from UNWRITTEN_ENCRYPTED_COLUMNS to ENCRYPTED_COLUMNS and add a real decrypt/re-encrypt rotation regression. Import DailyReadingV5 and ReadingEvidenceV5 from @patternlike/shared. Use one conditional INSERT/UPDATE with RETURNING or an assertion-guarded D1 batch so budget admission cannot overrun under concurrency.

- [ ] **Step 6: Run migration and focused API lanes.**

Run:

    python contracts/smoke_check.py
    npm exec -w @patternlike/api -- vitest run src/db/provider-usage.test.ts src/db/encrypted-columns.test.ts src/db/key-rotation.test.ts src/services/generation.integration.test.ts src/routes/readings.integration.test.ts
    npm run typecheck -w @patternlike/api

Expected: all pass.

- [ ] **Step 7: Commit the forward-only storage foundation.**

Commit: api: add M5 storage and provider budget guards

### Task 7: Add the configured provider-neutral OpenAI boundary

**Files:**

- Create: apps/api/src/services/reading-publisher.ts
- Create: apps/api/src/services/reading-prompt.ts
- Create: apps/api/src/services/reading-prompt.test.ts
- Create: apps/api/src/services/reading-rollout.ts
- Create: apps/api/src/services/reading-rollout.test.ts
- Create: apps/api/src/services/openai-reading-publisher.ts
- Create: apps/api/src/services/openai-reading-publisher.test.ts
- Create: apps/api/scripts/verify-openai-reading-model.ts
- Create: apps/api/tsconfig.scripts.json
- Modify: apps/api/src/env.ts
- Modify: apps/api/src/middleware/config-guard.ts
- Modify: apps/api/src/config.test.ts
- Modify: apps/api/test/mock-calc-service.ts
- Modify: apps/api/wrangler.toml
- Modify: apps/api/package.json
- Modify: package-lock.json

**Interfaces:**

    export interface ReadingPublisher {
      publish(
        request: ReadingGenerationRequest,
        options: {
          requestId: string;
          timeoutMs: number;
          configuration: PublisherConfigPin;
        },
      ): Promise<PublisherResult>;
    }

    export type PublisherResult =
      | {
          ok: true;
          candidate: ReadingGenerationOutput;
          metadata: {
            provider: "openai";
            model: string;
            provider_request_id: string;
            input_tokens: number;
            output_tokens: number;
            provider_response_hash: string;
          };
        }
      | {
          ok: false;
          code: PublisherFailureCode;
          safe_detail_code: PublisherSafeDetailCode;
          retry_after_seconds: number | null;
        };

    export type PublisherFailureCode =
      | "publisher_unavailable"
      | "publisher_output_invalid"
      | "publisher_refused"
      | "publisher_auth_failed"
      | "publisher_model_unavailable";

    export type PublisherSafeDetailCode =
      | "request_timeout"
      | "network_error"
      | "rate_limited"
      | "provider_5xx"
      | "authentication_failed"
      | "model_not_available"
      | "provider_refusal"
      | "max_output_tokens_exhausted"
      | "missing_output_text"
      | "multiple_output_text"
      | "invalid_json"
      | "schema_mismatch";

    export function rolloutAllows(
      mode: ReadingV5Rollout,
      entry: "internal" | "first_open" | "scheduled",
    ): boolean;

- [ ] **Step 1: Write failing configuration and adapter tests.**

Always require READING_V5_ROLLOUT to be one of off/internal/first_open/hybrid. When it is off, permit every V5 publisher, scheduler, cost value, and OPENAI_API_KEY to be absent so the dual-reader compatibility deploy is a real kill-switch state; if any optional value is present, still reject a malformed value. When rollout is not off, require READING_PUBLISHER=openai; exact model gpt-5.6-sol; high reasoning; prompt version; 90,000 ms timeout; 4,000 output tokens shared by reasoning and visible structured output; 98,304 context bytes; active days 30; lead minutes 30; spread minutes 45; scheduler batch limit 100; a positive operator-approved daily call limit; and OPENAI_API_KEY. Reject unknown enums, non-integers, wrong fixed values, zero/negative call limits, and missing required production values.

For the request, assert POST https://api.openai.com/v1/responses, store: false, no background, no tools, no browsing/file search/code/MCP fields, exact model, reasoning effort high, text verbosity medium, max_output_tokens 4000, and text.format with type json_schema, name patternlike_daily_reading_v5, strict true, and the M5 output schema. Assert one fetch maximum.

Assert the closed rollout matrix: off permits no V2 reservation; internal permits only authenticated internal reservations; first_open permits internal plus PUT Today; and hybrid permits internal, PUT Today, and scheduled reservations.

- [ ] **Step 2: Run focused tests and confirm configuration/adapter failure.**

Run:

    npm exec -w @patternlike/api -- vitest run src/config.test.ts src/services/reading-rollout.test.ts src/services/reading-prompt.test.ts src/services/openai-reading-publisher.test.ts

Expected: failures for missing Env/config branches and provider implementation.

- [ ] **Step 3: Implement direct-fetch request/response handling.**

Use AbortController for the configured deadline. With direct HTTP, traverse response.output to a message item, then message.content to exactly one content item of type output_text and parse that item's text; do not rely on the SDK-only response.output_text convenience. Classify a content item of type refusal as publisher_refused. Map timeout/network/429/retryable 5xx to publisher_unavailable, 401/403 to publisher_auth_failed, configured-model not-found/unavailable to publisher_model_unavailable, and malformed/incomplete output to publisher_output_invalid. Hash the exact response-body bytes inside the adapter, then discard them and return only the parsed candidate plus safe ProviderMetadata. Failure results use a closed safe_detail_code and numeric retry-after only; never copy provider response text, headers, URLs, or exception messages into returned detail or logs.

Serialize user-authored text only as values inside the closed untrusted-context object. Add prompt tests proving embedded instruction-like text cannot alter system policy, schema, tools, model, or request fields.

- [ ] **Step 4: Finish the host-first fake and model preflight command.**

The mock routes api.openai.com by URL host and scenario header/request ID; calculation hosts retain existing behavior; unknown hosts fail closed. The preflight script calls the authorized account model endpoint using OPENAI_API_KEY, verifies the exact configured ID, prints only model ID and pass/fail, and never prints the key or response headers. Add npm run publisher:model:verify -w @patternlike/api.

Add tsx and @types/node as explicit API development dependencies. Keep Worker sources on apps/api/tsconfig.json and add tsconfig.scripts.json with Node plus Workers types for scripts/**/*.ts. Change the API typecheck script to run both configs so scripts are checked without adding Node globals to the Worker compilation.

- [ ] **Step 5: Run adapter, config, typecheck, and dry-run build lanes.**

Run:

    npm exec -w @patternlike/api -- vitest run src/config.test.ts src/services/reading-rollout.test.ts src/services/reading-prompt.test.ts src/services/openai-reading-publisher.test.ts
    npm run typecheck -w @patternlike/api
    npm run build -w @patternlike/web
    npm run build -w @patternlike/api

Expected: all pass; run_worker_first is unchanged and wrangler.toml contains no OPENAI_API_KEY assignment.

- [ ] **Step 6: Commit the provider boundary.**

Commit: api: add configured OpenAI reading publisher

### Task 8: Freeze V2 commands through the one compiler

**Files:**

- Create: apps/api/src/db/consents.ts
- Create: apps/api/src/services/context-compiler.ts
- Create: apps/api/src/services/context-compiler.test.ts
- Create: apps/api/src/services/generation-command-v2.ts
- Create: apps/api/src/services/generation-command-v2.test.ts
- Modify: apps/api/src/services/generation-command.ts
- Modify: apps/api/src/services/enqueue.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/services/generation.integration.test.ts

**Interfaces:**

    export type GenerateDailyReadingCommand =
      | GenerateDailyReadingCommandV1
      | GenerateDailyReadingCommandV2;

    export interface GenerateDailyReadingCommandV2 {
      command_version: "v2";
      schema_version: "0.5.0";
      generation_id: string;
      generation_input_id: string;
      input_manifest_hash: string;
      reading_id: string;
      reading_key: string;
      revision: number;
      revision_reason:
        | "initial"
        | "chart_recalculated"
        | "consent_revoked"
        | "safety_correction"
        | "defect_repair";
      supersedes_reading_id: string | null;
      target_local_date: string;
      target_timezone: string;
      timezone_source: "device_derived" | "user_confirmed";
      timezone_revision: number;
      day_start_at: string;
      day_end_at: string;
      generation_anchor: string;
      locale: string;
      locale_source: "device_derived" | "user_confirmed";
      locale_updated_at: string;
      reservation_reason: ReservationReason;
      command_generation: number;
      replaces_job_id: string | null;
      command_replacement_reason: CommandReplacementReasonV2 | null;
      ai_consent: AiConsentPin;
      chart: V5ChartPin & {
        effective_accuracy: BirthTimeAccuracy;
        uncertainty: UncertaintyReport;
      };
      cycle_scan: V5CalculationPin;
      daily_sky: V5CalculationPin;
      context: V5ContextPin[];
      publisher: PublisherConfigPin;
    }

    export interface ReservationTarget {
      targetLocalDate: string;
      reason: ReservationReason;
      now: Date;
    }

    export type ReservationReason =
      | "first_open"
      | "scheduled"
      | "internal"
      | "automatic_replacement"
      | "manual_reissue"
      | "fact_repair";

    export type CommandReplacementReasonV2 =
      | "calc_unavailable"
      | "daily_sky_unavailable"
      | "publisher_unavailable"
      | "publisher_output_invalid"
      | "publisher_refused"
      | "consent_regranted";

- [ ] **Step 1: Write failing consent/context and V2 command tests.**

Require schema_version 0.5.0; a current granted ai_synthesis consent; no equivalence with research/model_training; all context permission/consent checks; all intersecting use pins; owner-scoped decryption of eligible context; plaintext snapshot only inside the encrypted command; frozen prior-reading/feedback projections; revision/revision reason/predecessor/reservation reason; explicit scheduler target date; confirmed zone/locale plus source/revision timestamps; half-open day, anchor, tzdb, and local-day policy; internally consistent effective uncertainty/suppression; daily-sky/cycle request and response identities; exact deterministic calc-refusal mapping; publisher/prompt/selection/validation versions; replacement lineage; and both canonical hashes.

- [ ] **Step 2: Add failing reservation tests for every hardcoded storage site.**

Assert V1 initial/reissue/replacement still bind deterministic plus non-null release_version. Assert V2 initial/reissue/replacement bind constrained_model plus null release_version, update reading_key/chart/contract/assembly mode consistently, and never call getActiveRelease(), loadReleaseBundle(), R2, or content release pointers.

- [ ] **Step 3: Run focused tests and verify V1-only assumptions fail.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/context-compiler.test.ts src/services/generation-command-v2.test.ts src/services/generation.integration.test.ts

Expected: failures because commands, DB claims, and reservation methods accept only V1 and resolve only the current day.

- [ ] **Step 4: Implement the owner-scoped context loader and V2 builder.**

Read the complete eligible corpus, decrypt values with existing AAD, normalize the permission/consent state, and pass one closed ConstrainedReadingInput to prepareConstrainedReadingInput(). Compute input_manifest_hash from input_manifest_canonical and generation_input_id as gin_sha256_ plus a domain-separated hash of identity_canonical. Call the daily-sky and cycle adapters at freeze time and pin canonical request/response digests plus selected facts.

- [ ] **Step 5: Implement the V1/V2 discriminated reservation union.**

Change job encryption/decryption, idempotency keys, reserveInitial(), reserveReissue(), replaceCommand(), and Claim.command to the union. Add buildV5ReadingKey(userId, localDate, revision). Make target date an explicit server-resolved input so tomorrow can be pre-generated; the public first-open path still derives today on the server. Gate internal V2 reservation through rolloutAllows(); off must fail before command construction or calculation access.

- [ ] **Step 6: Run focused tests, full API tests, and API typecheck.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/context-compiler.test.ts src/services/generation-command-v2.test.ts src/services/generation.integration.test.ts
    npm test -w @patternlike/api
    npm run typecheck -w @patternlike/api

Expected: all pass, including unchanged V1 fixtures and release-backed historical tests.

- [ ] **Step 7: Commit the immutable V2 command path.**

Commit: api: freeze constrained V2 generation commands

### Task 9: Centralize generation failure and replacement policy

**Files:**

- Create: apps/api/src/services/generation-failures.ts
- Create: apps/api/src/services/generation-failures.test.ts
- Modify: apps/api/src/queue.ts
- Modify: apps/api/src/services/generate-daily-reading.ts
- Modify: apps/api/src/services/enqueue.ts
- Modify: apps/api/src/services/ensure-today-reading.ts
- Modify: apps/api/src/routes/internal-generation.ts
- Modify: apps/api/src/services/generation.integration.test.ts
- Modify: apps/api/src/routes/internal-generation.integration.test.ts

**Interfaces:**

    export type V1FailureCode =
      | "calc_unavailable"
      | "release_unreadable"
      | "policy_unsupported"
      | "chart_missing"
      | "release_hash_mismatch"
      | "cycle_missing"
      | "cycle_hash_mismatch"
      | "consent_revoked"
      | "assembly_id_mismatch"
      | "assembly_failed"
      | "publication_failed";

    export type V5FailureCode =
      | "calc_unavailable"
      | "daily_sky_unavailable"
      | "publisher_unavailable"
      | "publisher_output_invalid"
      | "publisher_refused"
      | "publisher_budget_exhausted"
      | "publisher_not_configured"
      | "publisher_auth_failed"
      | "publisher_model_unavailable"
      | "ai_synthesis_consent_required"
      | "context_ineligible"
      | "generation_input_id_mismatch"
      | "policy_unsupported";

    export type GenerationFailureCode = V1FailureCode | V5FailureCode;

    export type GenerationSafeDetailCode =
      | PublisherSafeDetailCode
      | "execution_window_exhausted"
      | "calculation_transport_unavailable"
      | "calculation_policy_refused"
      | "provider_budget_exhausted"
      | "publisher_not_configured"
      | "consent_not_active"
      | "context_not_eligible"
      | "input_integrity_mismatch";

    export function queueDisposition(
      commandVersion: "v1" | "v2",
      code: GenerationFailureCode,
      attempts: number,
    ): "retry_60s" | "terminal";

    export function leaseDisposition(
      attempts: number,
      remainingMs: number,
      providerTimeoutMs: number,
    ):
      | "continue"
      | "lease_retry_305s"
      | "terminal_calc_unavailable";

    export function isAutomaticReplacementFailure(
      commandVersion: "v1" | "v2",
      code: GenerationFailureCode,
    ): boolean;

    export type V5ReplacementReason =
      | "calc_unavailable"
      | "daily_sky_unavailable"
      | "publisher_unavailable"
      | "publisher_output_invalid"
      | "publisher_refused"
      | "consent_regranted";

- [ ] **Step 1: Write one table-driven pure failure-policy test.**

Make generation-failures.ts own V1FailureCode, V5FailureCode, GenerationFailureCode, the shared delay constants, and every retry/replacement predicate; generate-daily-reading.ts imports the V1 type rather than defining a second execution-failure union. Exercise every row from the approved design as pure inputs: infrastructure attempts through MAX_JOB_ATTEMPTS=4; output-invalid/refusal only when the first provider result occurred at jobs.attempts=1; exact V5 scheduler-replaceable set; publisher budget/auth/model/config/consent/context/identity/policy terminal behavior; legacy release_unreadable retained only for V1; lease dispositions; and MAX_COMMAND_GENERATION=3.

- [ ] **Step 2: Run the test and demonstrate the five duplicate policy sites drift.**

Run: npm exec -w @patternlike/api -- vitest run src/services/generation-failures.test.ts

Expected: failure because no shared module exists.

- [ ] **Step 3: Implement shared predicates and remove local string sets.**

Move the provisional CommandReplacementReasonV2 union from generation-command-v2.ts into this shared module and import it everywhere; do not leave two copies. Import the module from generation execution, queue.ts, enqueue replacement, ensure-today-reading.ts, and the internal route validator. Keep RETRY_DELAY_SECONDS=60 and LEASE_RETRY_DELAY_SECONDS=305 exported from one place. An insufficient-lease release consumes the already-incremented durable jobs.attempts value, schedules 305 seconds only while attempts is below 4, and terminalizes as calc_unavailable at attempt 4 so it can enter bounded command replacement. This alias is deliberate: the bounded calculation/replay phase failed to leave a safe provider/publication window, no provider call occurred, and the generation-layer safe_detail_code execution_window_exhausted keeps metrics distinct without expanding the approved failure taxonomy. Test that distinction. Do not add provider retries inside one invocation.

- [ ] **Step 4: Add seeded replacement-state tests without executing V2.**

Seed failed V1 and V2 reading/job rows directly and prove the storage/route replacement decisions use the shared predicates: g1 to g2 to g3, no g4, legacy release_unreadable only for V1, the exact V5 automatic set, and consent_regranted excluded from automatic replacement. Do not require Queue delivery, provider results, or live lease handling here; the V2 executor does not exist until Task 10.

- [ ] **Step 5: Run policy and integration lanes.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/generation-failures.test.ts src/services/generation.integration.test.ts src/routes/internal-generation.integration.test.ts

Expected: all pass and rg finds no duplicate V5 retry/replacement sets.

- [ ] **Step 6: Commit the shared policy.**

Commit: api: centralize V5 generation failure policy

### Task 10: Execute, validate, and atomically publish V5 readings

**Files:**

- Create: apps/api/src/services/generate-daily-reading-v5.ts
- Create: apps/api/src/services/generate-daily-reading-v5.test.ts
- Create: apps/api/src/services/safe-log.ts
- Create: apps/api/src/services/safe-log.test.ts
- Modify: apps/api/src/index.ts
- Modify: apps/api/src/middleware/config-guard.ts
- Modify: apps/api/src/services/generate-daily-reading.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/queue.ts
- Modify: apps/api/src/services/enqueue.ts
- Modify: apps/api/src/services/identity.ts
- Modify: apps/api/src/routes/birth.ts
- Modify: apps/api/src/routes/content-releases.ts
- Modify: apps/api/src/routes/internal-generation.ts
- Modify: apps/api/src/routes/readings.ts
- Modify: apps/api/src/routes/sessions.ts
- Modify: apps/api/src/routes/sessions.integration.test.ts
- Modify: apps/api/src/routes/timing.ts
- Modify: apps/api/src/services/generation.integration.test.ts
- Modify: apps/api/src/db/readings.ts

**Interfaces:**

    export async function generateDailyReadingV5(
      env: Env,
      claim: Claim & { command: GenerateDailyReadingCommandV2 },
    ): Promise<ExecutionOutcome>;

- [ ] **Step 1: Write failing pre-provider integrity and privacy tests.**

Before claim, test that rollout off durably pauses a V2 row in D1 for 305 seconds, clears dispatched_at, acknowledges rather than retries the Queue message, leaves attempts unchanged, and requires no key/config, calculation, budget, or provider fetch. After re-enable and the pause deadline, the authenticated sweep redispatches it; in first_open, only the owning user's explicit PUT may advance and redispatch that user's paused row sooner. After claim in an enabled mode, require the current ai_synthesis grant, pinned source eligibility, chart/fingerprint/version, calculation policy support, supported pinned provider/model/reasoning/prompt/output/selection/validation configuration, and exact frozen calculation request replay. Re-run daily-sky and cycle verification from frozen requests; unavailable transport maps to the retry class, while changed canonical calculation output or compiler output maps to generation_input_id_mismatch. Immediately after calculation/compiler replay and before budget consumption, re-read AI consent and every pinned source eligibility row; a revocation or source change during calculation makes zero OpenAI calls. Pass the frozen PublisherConfigPin to the adapter instead of rereading the current model/prompt variables. A deployed supported-config registry may continue an older frozen command; an unimplemented frozen version fails policy_unsupported. Assert every failure occurs before OpenAI fetch.

- [ ] **Step 2: Write failing provider/publication tests.**

Cover a valid grounded candidate, revocation/source ineligibility injected while the calculation mock is running with zero later fetch, wrong echoed local date/locale, wrong role order/count/length, malformed schema, unknown or wrong-lane fact/context refs, unsupported vocabulary, HTML/Markdown links/executable or application instructions, uncertainty failure, collective-as-personal language, context-as-discovery language, evidence-count/hash disagreement, safety failure, calculation_failed transport mapping, deterministic calculation refusal, provider timeout/429/5xx/auth/model errors, budget exhaustion, and two nondeterministic candidates racing for one reading. Exercise durable attempts 1-4, output-invalid/refusal on attempt 1 versus later attempts, insufficient-lease outcomes at attempts 1-4 with 305-second scheduling and zero provider calls, bounded g1 to g2 to g3 replacement with no g4, terminal normal exhaustion as 424, and terminal budget exhaustion as non-retryable 503.

- [ ] **Step 3: Run focused V5 execution tests and verify the dispatcher has no V2 branch.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/generate-daily-reading-v5.test.ts src/services/generation.integration.test.ts

Expected: failure because generation execution is V1-only.

- [ ] **Step 4: Implement the V1/V2 dispatcher and V5 preflight.**

Keep generate-daily-reading.ts as the discriminant dispatcher and leave the V1 function behavior intact. Add a claim-CAS-safe pauseQueuedV2ForRolloutOff() path before claim, driven only by the clear assembly_mode join and never by decrypted command data; commit the D1 pause before acknowledging the Queue message. Import queueDisposition(), leaseDisposition(), and replacement predicates from generation-failures.ts; do not recreate a V5 set in the new executor. Add leaseExpiresAt to Claim. Before OpenAI, require timeout plus 60,000 ms; otherwise follow leaseDisposition() without budget consumption or fetch. Atomically consume the UTC-day provider budget immediately before the request.

- [ ] **Step 5: Validate, encrypt, and publish the winning candidate.**

Parse the strict schema, call validateReadingCandidate(), map headline to the quiet primary-theme kicker, lead to the focal primary_theme paragraph, reflection_prompt to reflection, and uncertainty_note to the conditional uncertainty_notice, then construct daily-reading-v5 and V5 evidence. Hash the canonical output, persist the adapter-supplied provider_response_hash and safe request/token metadata, and encrypt reading/evidence with the existing AAD fields. completeReading() must assert active job ID, claim token, running state, command generation, pending reading state, and predecessor transition in the same D1 batch. A stale loser discards its candidate without textual comparison.

- [ ] **Step 6: Prove one provider call and safe logging.**

Assert every delivery makes zero or one OpenAI fetch. Add one safe structured logging boundary and route every console call under apps/api/src through it; only safe-log.ts may call console. Its event-specific discriminated input unions admit closed operational fields rather than Record<string, unknown> or arbitrary strings, and the helper itself generates an internal trace ID. Never pass the client/response x-request-id into logging. Replace Queue, enqueue-dispatch, internal-generation, top-level onError, configuration, chart calculation, release ingestion, Today, sessions, identity/JWKS, and timing logging of arbitrary err.message/err.stack/detail, raw request paths, and job/reading/cycle/message identifiers. Inject sentinel private text through thrown Error messages, stacks, internal result detail, an owner-scoped evidence URL, and a caller-supplied x-request-id on POST /v1/sessions; assert no API log contains the sentinel, client request ID, job_id, reading_id, Queue message ID, serialized request context, response prose, birth data, consent IDs, cycle IDs, raw route parameter, or private references. Existing non-user release/config event fields may remain only when enumerated by a safe event type. Metrics may contain only the generated internal trace ID, provider/model/prompt versions, latency, token counts, failure class, safe detail code, and hashes.

- [ ] **Step 7: Run focused and complete API lanes.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/generate-daily-reading-v5.test.ts src/services/safe-log.test.ts src/routes/sessions.integration.test.ts src/services/generation.integration.test.ts
    npm test -w @patternlike/api
    npm run typecheck -w @patternlike/api

Expected: all pass.

- [ ] **Step 8: Commit V5 execution.**

Commit: api: execute and publish constrained V5 readings

### Task 11: Add explicit fact invalidation and repair semantics

**Files:**

- Create: apps/api/src/services/reading-invalidation.ts
- Create: apps/api/src/services/reading-invalidation.test.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/db/readings.ts
- Modify: apps/api/src/services/enqueue.ts
- Modify: apps/api/src/routes/birth.ts
- Modify: apps/api/src/routes/internal-generation.ts
- Modify: apps/api/src/routes/internal-generation.integration.test.ts
- Modify: apps/api/src/routes/readings.integration.test.ts

**Interfaces:**

    POST /internal/readings/invalidate

    export async function invalidatePublishedReading(
      env: Env,
      input: {
        identity: UserIdentity;
        readingId: string;
        reason: "chart_correction" | "calculation_defect";
        now: Date;
      },
    ): Promise<InvalidationOutcome>;

    export async function reserveFactRepair(
      env: Env,
      predecessorId: string,
      now: Date,
    ): Promise<EnqueueOutcome>;

- [ ] **Step 1: Write failing lifecycle tests.**

Prove a V5 `constrained_model` fact invalidation CAS changes published to invalidated immediately, sets invalidated_at, hides it from Today, and preserves encrypted history. Prove its r+1 predecessor must be invalidated and remains invalidated if the successor fails. Simulate both crash boundaries: after a corrected chart becomes active but before invalidation, and after invalidation but before reserveFactRepair. A read-only Today lookup must hide an active-chart-mismatched published row only when it is V5/`constrained_model`; a V3 deterministic row remains readable and its encrypted envelope is never rewritten. The indexed, idempotent reconciliation/orphan-reservation primitive must invalidate or recover exactly one current-local-day repair and must not reserve prior-day prose after midnight. Separately prove an ordinary safety/non-factual-defect reissue keeps a valid predecessor published until successful atomic supersession. Task 12 wires this primitive into the scheduler; Task 13 wires it into first-open ensure.

Require the factual invalidation reason and actor class in the DEK-encrypted reading audit/evidence envelope. The minimized clear audit event retains the standard actor and resource identifiers but carries no chart or prose details.

- [ ] **Step 2: Run focused lifecycle tests and confirm current failReading behavior cannot express invalidation.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/reading-invalidation.test.ts src/routes/readings.integration.test.ts src/routes/internal-generation.integration.test.ts

Expected: failures for absent invalidated state and predecessor transition.

- [ ] **Step 3: Implement fact repair and wire accepted chart corrections.**

Use PredecessorTransition retain_invalidated for factual repair and supersede_published for ordinary reissue. On an accepted active-chart correction, immediately reconcile only a current published V5 `constrained_model` reading whose pinned chart is no longer authoritative, then idempotently reserve the named next revision. Because chart activation and DEK resealing cannot safely depend on a pre-read row in one D1 batch, make the read path independently enforce the same active-chart fingerprint/ID guard only for `constrained_model`; a crash after chart activation can never expose stale V5 prose, while V3 deterministic envelopes remain immutable and readable. Decrypt and reseal the existing V5 daily_readings.reading_enc envelope under the same AAD with its invalidation metadata; do not add a clear reason column or new ciphertext identity. Persist enough encrypted repair lineage for the orphan-discovery primitive and its later ensure/scheduler callers to recover an invalidated row with no successor after a crash. Recovery must prove the same-owner successor is exactly revision r+1, is V5 `constrained_model`, owns its joined generation job, and decrypts to `reservation_reason: fact_repair`; an ordinary reissue cannot be accepted by relationship or revision reason alone. Limit discovery and reservation to the reader's current local day and never backfill a prior-day repair after midnight. Add an authenticated internal defect path for a named reading; do not expose arbitrary invalidation to the public client.

- [ ] **Step 4: Run lifecycle and full API tests.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/reading-invalidation.test.ts src/routes/readings.integration.test.ts src/routes/internal-generation.integration.test.ts
    npm test -w @patternlike/api

Expected: all pass.

- [ ] **Step 5: Commit the factual correction path.**

Commit: api: invalidate factually stale readings before repair

## Phase C: Scheduler, Product API, and Reader Experience

### Task 12: Add bounded hybrid scheduling and cursor maintenance

**Files:**

- Create: apps/api/src/services/reading-schedule.ts
- Create: apps/api/src/services/reading-schedule.test.ts
- Create: apps/api/src/db/reading-scheduler.ts
- Create: apps/api/src/db/reading-scheduler.integration.test.ts
- Create: apps/api/src/services/run-reading-scheduler.ts
- Create: apps/api/src/scheduled.ts
- Create: apps/api/src/scheduled.integration.test.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/index.ts
- Modify: apps/api/src/env.ts
- Modify: apps/api/src/middleware/config-guard.ts
- Modify: apps/api/src/db/identities.ts
- Modify: apps/api/src/db/sessions.ts
- Modify: apps/api/src/middleware/auth.ts
- Modify: apps/api/src/db/preferences.ts
- Modify: apps/api/src/routes/preferences.ts
- Modify: apps/api/src/routes/birth.ts
- Modify: apps/api/src/db/consents.ts
- Modify: apps/api/src/services/enqueue.ts
- Modify: apps/api/wrangler.toml

**Interfaces:**

    export type ScheduleResolution =
      | {
          ok: true;
          window: DailySkyWindow;
          dueAt: string;
          bucket: 0 | 1 | 2 | 3;
        }
      | {
          ok: false;
          reason: "skipped_local_date";
          nextRepresentableDate: string;
        };

    export interface ReadingSchedulePolicy {
      leadMinutes: 30;
      spreadMinutes: 45;
    }

    export function readingDueAt(
      userId: string,
      targetLocalDate: string,
      zone: string,
      policy: ReadingSchedulePolicy,
    ): Promise<ScheduleResolution>;

    export async function runReadingScheduler(
      env: Env,
      scheduledAt: Date,
    ): Promise<SchedulerSummary>;

    export default {
      fetch,
      queue,
      scheduled,
    };

- [ ] **Step 1: Write failing pure scheduling tests.**

Verify bucket = SHA-256(user_id, date) mod 4, due offsets of 30/45/60/75 real elapsed minutes, :00/:15/:30/:45 zones, DST transitions, skipped/unrepresentable dates, next cursor, stale cursor skipping without historical backfill, and current/next target selection.

- [ ] **Step 2: Write failing D1 scheduler and handler integration tests.**

Put every recovery and reservation decision under the one configured 100-distinct-user cron ceiling and preserve the approved outer order exactly: repair eligible existing commands/artifacts, reserve due readings, then seed null cursors with what remains. Inside the repair phase, process eligible failed-command replacement first, then factual stale/invalidated orphans, expired leases, and undispatched outbox rows; all consume the same remaining quota and a user seen in one sublane cannot be counted again. This extends recovery within the approved repair lane without adding a competing quota or fairness algorithm. Prove an expired claim or D1-before-Queue-send crash converges without the manual sweep route. Cover active chart/timezone/locale/AI consent/recent non-revoked session eligibility; inactive/ineligible cursor advancement; null seeding; scheduler/first-open race; one reservation; both chart-activation and invalidation/reservation crash recovery; ineligible orphans filtered before command construction and backed off by a versioned six-hour updated_at threshold; failed-generation discovery after next_due_at advanced; rollout modes off/internal/first_open performing no scheduled reservation and hybrid permitting it; and checkSecureConfig before the first recovery query/reservation. Use EXPLAIN QUERY PLAN to prove invalidated-orphan discovery uses idx_daily_readings_invalidated_repair with stable (updated_at, id) ordering and the shared remaining limit.

- [ ] **Step 3: Run focused scheduler tests and verify no scheduled export/cursor behavior exists.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/reading-schedule.test.ts src/db/reading-scheduler.integration.test.ts src/scheduled.integration.test.ts

Expected: failures for missing modules and scheduled export.

- [ ] **Step 4: Implement schedule math, indexed queries, and the shared quota.**

Use ScheduledController.scheduledTime, not Date.now(), as the trusted invocation time. Implement the exact ordered repair -> due -> null-seed sequence above, pass the diminishing remaining limit into every query, deduplicate by user ID, and stop at READING_SCHEDULER_BATCH_LIMIT=100. For an ineligible factual orphan, touch updated_at under a guarded no-op and exclude it for the next six hours so the same row cannot consume every invocation; alert when the repair lane consumes the full quota, because the approved ordering intentionally gives repairs priority over new due work. Advance next_due_at after every evaluated reservation/no-op. Record skipped_local_date without prose backfill. Repair only the exact centralized replaceable failures below command generation 3.

- [ ] **Step 5: Maintain qualifying activity and cursors.**

Touch sessions.last_seen_at only when older than one hour. Recompute next_due_at after identity creation, timezone confirmation/change, chart activation, AI consent grant/revoke, and that throttled activity write. An ineligible active account still receives the next daily check; null is only unseeded state.

- [ ] **Step 6: Add the Worker handler and queue concurrency without activating production cron.**

Add scheduled beside fetch and queue. Keep max_batch_size=1, set max_concurrency=4 only on the default/development consumer for local canaries, and leave the production consumer's concurrency unchanged until the approved model/budget/cost gate. Add a local/development cron if useful for tests, but leave env.production.triggers absent until the rollout gate. Assert run_worker_first remains byte/semantic unchanged.

- [ ] **Step 7: Run scheduler, config, full API, and dry-run build lanes.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/reading-schedule.test.ts src/db/reading-scheduler.integration.test.ts src/scheduled.integration.test.ts src/config.test.ts
    npm test -w @patternlike/api
    npm run build -w @patternlike/web
    npm run build -w @patternlike/api

Expected: all pass.

- [ ] **Step 8: Commit the dormant scheduler.**

Commit: api: add bounded daily reading scheduler

### Task 13: Add AI consent routes and dual-version product projections

**Files:**

- Create: apps/api/src/routes/consents.ts
- Create: apps/api/src/routes/consents.integration.test.ts
- Create: apps/api/test/m3-rollout-compat.test.ts
- Create: apps/api/vitest.m3-compat.config.ts
- Modify: apps/api/src/db/consents.ts
- Modify: apps/api/src/index.ts
- Modify: apps/api/src/routes/readings.ts
- Modify: apps/api/src/routes/readings.integration.test.ts
- Modify: apps/api/src/services/ensure-today-reading.ts
- Modify: apps/api/src/db/generation.ts
- Modify: apps/api/src/db/readings.ts
- Modify: apps/api/tsconfig.json
- Modify: apps/api/package.json

**Interfaces:**

    GET /v1/consents/ai-synthesis
    PUT /v1/consents/ai-synthesis
    DELETE /v1/consents/ai-synthesis

    PUT body: { policy_version: string }
    PUT and DELETE header: Idempotency-Key generated client-side by newIdempotencyKey("web-ai-synthesis")
    DELETE body: none

    interface AiSynthesisConsentResponse {
      kind: "ai_synthesis";
      status: "granted" | "not_granted";
      provider: "OpenAI";
      purpose: "daily_reading_generation";
      policy_version: string;
      enabled_categories: AiConsentDataCategory[];
      granted_at: string | null;
    }

AiConsentDataCategory is imported from @patternlike/shared; the route does not redeclare or reorder the seven-value union.

- [ ] **Step 1: Write failing consent route tests.**

Cover authentication/ownership, exact server policy version, idempotent grant, append-only revocation history, expired/old grants, cursor recompute, safe status read, no research/model_training mutation, exact stable category order, every provider packet section disclosed by one category, category-set changes requiring a policy-version change/fresh grant, and an empty context-source control list while M4 sources remain unimplemented.

Also prove revocation blocks a queued job before provider fetch but leaves an already published, factually valid reading readable until ordinary retention/deletion removes it. Re-grant alone makes no generation call. A later explicit PUT Today may install consent_regranted as a fresh command generation from the current chart/calculation/context and new consent pin, never revive the revoked encrypted packet, and never exceed command generation 3.

- [ ] **Step 2: Write failing V3/V5 projection and status tests.**

Require discriminated encrypted decode; 200 V3 or V5; 202 queued/running; 409 ai_synthesis_consent_required/timezone/locale; 404 chart; 424 exhausted normal generation/fact repair including a terminal post-command policy defect; 503 pre-command publisher/calc/daily-sky/config/policy_unsupported failures with retryable false for deterministic policy refusal; terminal budget 503 with retryable false; invalidated and active-chart-mismatched published rows hidden; release errors impossible for V2; GET Today remaining read-only with zero reservation/enqueue calls in every rollout mode; explicit PUT Today recovering one stale/invalidated current-day orphan and owner-scoped expired/undispatched pending job through the Task 11/storage primitives; and the rollout matrix where off/internal block all public generation and never fall through to V1/release/R2 while first_open/hybrid permit V2 only.

- [ ] **Step 3: Add a failing pre-migration compatibility lane.**

Create a second Workers Vitest config that passes only migrations 0001 and 0002 through TEST_MIGRATIONS and runs test/m3-rollout-compat.test.ts with READING_V5_ROLLOUT=off. Exercise health, authentication, a stored V3 Today response, V3 evidence, read-only GET, and blocked PUT. Assert no query touches 0003-only columns/tables and no generation/release/provider path runs. Add this config to the API test script after the ordinary serial suite.

- [ ] **Step 4: Run focused routes and verify consent/V5 branches are absent.**

Run:

    npm exec -w @patternlike/api -- vitest run src/routes/consents.integration.test.ts src/routes/readings.integration.test.ts
    npm exec -w @patternlike/api -- vitest run --config vitest.m3-compat.config.ts

Expected: missing route/V5 projection failures.

- [ ] **Step 5: Implement grant/revoke/status and mount the route.**

The server owns provider, purpose, policy, and available categories. PUT accepts only the displayed policy version and uses the existing idempotency convention. DELETE revokes only ai_synthesis. Leave M4 /v1/context-sources stubs honest.

- [ ] **Step 6: Implement dual readers and safe status mapping.**

Project each stored schema through its own closed reader. V5 success excludes release_version/fallback and includes a quiet provider disclosure plus evidence URL. Errors retain the existing safe envelope and request ID and expose no job/provider internals.

- [ ] **Step 7: Run route, API, contract, and typecheck lanes.**

Run:

    npm exec -w @patternlike/api -- vitest run src/routes/consents.integration.test.ts src/routes/readings.integration.test.ts
    npm exec -w @patternlike/api -- vitest run --config vitest.m3-compat.config.ts
    npm test -w @patternlike/api
    npm run test:contracts
    npm run typecheck -w @patternlike/api

Expected: all pass.

- [ ] **Step 8: Commit the product API.**

Commit: api: expose AI consent and V5 Today readings

### Task 14: Update Today, provenance, and Context & Privacy

**Files:**

- Modify: apps/web/src/lib/api-client.ts
- Modify: apps/web/src/lib/api-client.test.ts
- Modify: apps/web/src/lib/reading-state.ts
- Create: apps/web/src/lib/reading-state.test.ts
- Modify: apps/web/src/test/api-mock.ts
- Modify: apps/web/src/test/reading-fixture.ts
- Modify: apps/web/src/components/TodayView.tsx
- Modify: apps/web/src/components/TodayView.test.tsx
- Modify: apps/web/src/components/WhyThisDrawer.tsx
- Modify: apps/web/src/components/PrivacyView.tsx
- Create: apps/web/src/components/PrivacyView.test.tsx
- Modify: apps/web/src/App.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**

- DailyReadingResponse becomes a V3/V5 discriminated union.
- ReadingEvidence becomes a V3/V5 discriminated union.
- Today failure state carries retryable from the safe API envelope rather than inferring that every 503 can progress.
- Privacy uses the three fixed AI consent endpoints.

- [ ] **Step 1: Write failing client and state-classification tests.**

Cover V3 historical fallback, V5 no-fallback shape, consent-required 409, preparation 202, retryable pre-command 503, non-retryable budget 503, terminal 424, invalidated/unavailable, and owner-safe V5 evidence.

- [ ] **Step 2: Write failing Today and Privacy interaction tests.**

Require a focused OpenAI consent state before first generation; provider named without exact model; purpose/categories/training distinction/revocation copy; a keyboard-accessible privacy-details link; disclosure that enabled free text may contain people or places and is not claimed to be de-identified; and policy copy explaining that store:false is not Zero Data Retention and provider abuse-monitoring retention may apply. Cover keyboard grant/revoke; stable heading and one polite live region; automatic preparation polling without repeated live-region announcements; new preparation text; 15-second delayed text; V5 disclosure; no retry on 424/non-retryable 503; v3-only fallback note; revised chip; evidence remaining unfetched until the Why this drawer is first opened and then cached; and all existing auth/onboarding/timezone/locale states.

- [ ] **Step 3: Run focused web tests and verify current V3-only assumptions fail.**

Run:

    npm exec -w @patternlike/web -- vitest run src/lib/api-client.test.ts src/lib/reading-state.test.ts src/components/TodayView.test.tsx src/components/PrivacyView.test.tsx src/App.test.tsx

Expected: failures for absent unions, consent controls, and V5 states.

- [ ] **Step 4: Implement the API unions and incumbent visual composition.**

Preserve the Lead Line editorial column, shell, typography, square controls, responsive rules, heading, and live-region behavior. Ready V5 copy is “Generated with OpenAI from your calculated chart and enabled context.” Preparing copy names calculated chart, daily sky, and enabled context.

- [ ] **Step 5: Implement the three-layer V5 provenance drawer.**

Show readable calculated facts; personal-context categories plus allowed-use labels without raw excerpts; and generation record with OpenAI, exact model, prompt/selection/validation/calculation versions, generation time, revision, and integrity IDs. Mark collective facts as collective. Keep provider request ID/opaque source IDs out of primary reader copy.

- [ ] **Step 6: Implement live Privacy controls without inventing M4 sources.**

Show grant/revoke state, provider, purpose, policy, and only actually implemented category controls. Preserve export/delete behavior and visible focus/status announcements.

- [ ] **Step 7: Run focused and full web lanes.**

Run:

    npm exec -w @patternlike/web -- vitest run src/lib/api-client.test.ts src/lib/reading-state.test.ts src/components/TodayView.test.tsx src/components/PrivacyView.test.tsx src/App.test.tsx
    npm test -w @patternlike/web
    npm run typecheck -w @patternlike/web
    npm run build -w @patternlike/web

Expected: all pass.

- [ ] **Step 8: Commit the reader experience.**

Commit: web: add OpenAI daily reading consent and provenance

### Task 15: Add deterministic and live-synthetic evaluation lanes

**Files:**

- Create: apps/api/test/fixtures/reading-evaluation-corpus.json
- Create: apps/api/src/services/reading-evaluation.test.ts
- Create: apps/api/scripts/run-openai-reading-eval.ts
- Modify: apps/api/package.json

**Interfaces:**

- The checked-in corpus contains synthetic exact, approximate, and unknown-time profiles; a zero-cycle day; personalized and collective-only days; injected user text; and accepted/rejected candidate pairs.
- The ordinary suite runs entirely offline against frozen candidates.
- npm run publisher:eval:live -w @patternlike/api is opt-in, requires OPENAI_API_KEY, uses only the synthetic corpus, and never reads D1 or production data.
- A passing live corpus report is a recorded production gate before initial internal enablement and before every later model, prompt, selection-policy, or validation-policy change; the single synthetic canary does not substitute for it.

- [ ] **Step 1: Write the failing offline evaluation suite.**

Score hard pass/fail for grounding, uncertainty, supported references/vocabulary, collective labeling, safety, schema, and privacy. Add bounded qualitative fixtures for usefulness, personalization, repetition, and tone. Require every model, prompt, selection, or validation change to pass the corpus, increment the evaluation-corpus version, and increment or replace the applicable model/prompt/policy identifier stored in Generation evidence.

- [ ] **Step 2: Run the offline suite and confirm missing corpus/evaluator failure.**

Run: npm exec -w @patternlike/api -- vitest run src/services/reading-evaluation.test.ts

Expected: failure for missing corpus/runner.

- [ ] **Step 3: Implement the offline evaluator and live synthetic runner.**

Reuse reading-prompt, OpenAI adapter, and validateReadingCandidate rather than duplicating request or validation rules. The live command reports aggregate IDs/scores/token counts only; never raw prompts or output prose. It exits non-zero for any hard failure or configured quality threshold regression.

- [ ] **Step 4: Run offline evaluation and API typecheck.**

Run:

    npm exec -w @patternlike/api -- vitest run src/services/reading-evaluation.test.ts
    npm run typecheck -w @patternlike/api

Expected: pass. Do not run the live lane in ordinary CI.

- [ ] **Step 5: Commit the evaluation gate.**

Commit: test: gate OpenAI reading quality and grounding

### Task 16: Align product truth and write the production runbook

**Files:**

- Modify: apps/web/PRODUCT.md
- Modify: apps/web/DESIGN.md
- Create: spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md
- Create: spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.docx
- Create: spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.pdf
- Create: spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5_manifest.json
- Modify: docs/deploy/api-production.md
- Create: docs/deploy/openai-daily-reading-rollout.md

**Interfaces:**

- Product truth says calculation is authoritative and OpenAI publishes constrained prose immediately with explicit consent and no editorial fallback.
- Historical M3 plans/specs remain unchanged and truthful for V3.
- The runbook separates local verification, empty-table production preflight, schema-compatible deploy, migration, model/key/config, synthetic canary, internal account, first-open, due-row load probe, production cron activation, monitoring, and rollback.

- [ ] **Step 1: Update the Markdown product sources first.**

Remove present-tense claims that every new reading is reviewed editorial copy or has a deterministic fallback. Document daily-sky authority, context minimization, consent, stable daily editions, fact invalidation, and the three-layer evidence surface.

- [ ] **Step 2: Generate and visually verify the V0.5 DOCX and PDF.**

Use the documents skill for DOCX creation/rendering and the PDF skill for PDF generation/inspection. Render every page, compare headings/tables/page breaks, and update the manifest with source/derived hashes. Do not overwrite the V0.2 artifacts.

- [ ] **Step 3: Write exact production gates and stop conditions.**

The runbook must require:

1. D1 backup/time-travel bookmark and counts for content_releases, daily_readings, reading_sources, reading_feedback.
2. Immediate stop if any dependent reading table is non-empty.
3. Dual-reader/schema-compatible deploy with READING_V5_ROLLOUT=off.
4. 0003 migration, ledger/schema/foreign_key_check/quick_check proof.
5. A separate root-level fly deploy --config fly.toml for app patternlike-calc in primary region iad; verify the deployed image/digest, health, and an authenticated synthetic POST /v1/daily-sky canary before any Worker V2 call.
6. Live exact-model preflight, OPENAI_API_KEY secret, publisher vars, approved daily call ceiling, recorded worst-case spend, and a separate production Queue max_concurrency=4 configuration/deploy.
7. A passing `npm run publisher:eval:live -w @patternlike/api` report against the exact model/prompt/selection/validation versions, plus the synthetic end-to-end calc/OpenAI canary.
8. READING_V5_ROLLOUT=internal, run the existing bounded authenticated recovery sweep, and prove one consented internal flow.
9. READING_V5_ROLLOUT=first_open and bounded observation.
10. Due-row count/load probe.
11. A separate configuration change adding env.production.triggers cron */15 * * * * and switching to hybrid.

Include fully qualified Wrangler commands with --config apps/api/wrangler.toml --env production. State that every later model, prompt, selection-policy, or validation-policy change repeats both the versioned live corpus gate and exact-model preflight before deployment. Remote writes remain separately authorized at execution time.

Define bounded metrics and alerts for queue age, generation latency, attempts, provider/validation failure classes, token counts, model/prompt versions, call-budget use, and hash-only integrity fields. Explicitly prohibit prompt, context, raw birth, and prose logging.

- [ ] **Step 4: Document rollback without unsafe promises.**

Rollback disables V2 reservations and scheduler, then deploys only a Worker version compatible with migrated schema. It does not rewind D1, delete artifacts, change models, or reactivate editorial release fallback.

- [ ] **Step 5: Check documentation consistency and derived-file hashes.**

Run:

    rg -n "reviewed content|active release|deterministic fallback|safety_fallback" apps/web/PRODUCT.md apps/web/DESIGN.md spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md docs/deploy
    git diff --check

Expected: any remaining matches are explicitly historical or describe prohibited fallback behavior; hashes match the manifest.

- [ ] **Step 6: Commit product truth and operations.**

Commit: docs: align product and rollout for OpenAI readings

## Phase D: Candidate Verification and Handoff

### Task 17: Run the final candidate gate and independent review

**Files:**

- Modify: only files from Tasks 1-16 when a confirmed defect requires remediation.

- [ ] **Step 1: Run focused security/invariant searches.**

Run:

    rg -n "sk-(proj-)?[A-Za-z0-9_-]{20,}" . --glob "!node_modules/**" --glob "!.dev.vars"
    rg -n "^OPENAI_API_KEY\s*=" apps/api/wrangler.toml
    rg -n "release_unreadable|release_not_active|getActiveRelease|loadReleaseBundle" apps/api/src/services/generation-command-v2.ts apps/api/src/services/generate-daily-reading-v5.ts
    rg -n '"(user_id|chart_fingerprint|reading_key|consent_id|birth_instant|latitude|longitude|timezone)"' contracts/m5/fixtures/valid/reading-generation-request.json
    rg -n "SCHEDULER_REPLACEABLE|RETRYABLE_FAILURE|publisher_unavailable.*publisher_output_invalid" apps/api/src/queue.ts apps/api/src/services/enqueue.ts apps/api/src/services/ensure-today-reading.ts apps/api/src/routes/internal-generation.ts
    rg -n 'console\.(error|warn|log|info|debug)' apps/api/src --glob '!services/safe-log.ts'
    rg -n -U '(safeError|safeWarn|safeInfo)\([^;]{0,800}(request_id|x-request-id|err\.message|err\.stack|\bdetail\b|job_id|reading_id|cycle_ids|error_message|c\.req\.path|message\.id)' apps/api/src

Expected: all seven searches have no match: no secret-like token or checked-in secret assignment, no V5 release access, no forbidden request field, no duplicated failure set, no console bypass outside safe-log.ts, and no client-controlled/private value passed to safe logging. A no-match rg exit is expected evidence, not a failed candidate gate.

- [ ] **Step 2: Run the complete local candidate gate from the repository root.**

Run:

    if (-not $env:PATTERNLIKE_M5_IMPLEMENTATION_BASE) { throw "Restore the recorded M5 implementation base" }
    git diff --check "$env:PATTERNLIKE_M5_IMPLEMENTATION_BASE..HEAD"
    python contracts/validate_schemas.py
    python contracts/m0/smoke_check.py
    python contracts/smoke_check.py
    npm run typecheck
    npm test
    npm run build

Expected: zero exit for every command, all three contract manifests valid, M0/M3 clean, and the production Worker dry-run successful.

- [ ] **Step 3: Assert deployment/config invariants.**

Compare the final Wrangler diff and prove run_worker_first remains exactly ["/health", "/v1/*", "/internal/*"], max_batch_size remains 1, default/development max_concurrency is 4, production concurrency remains at its incumbent pre-cost-gate setting, no OPENAI_API_KEY assignment is present, and the production cron is still absent until its separate activation gate.

- [ ] **Step 4: Run the bounded UI review.**

Use the Impeccable skill once over Today, Why this reading, and Privacy. Capture 1440x1000 and 390x844 in one browser pass, run focused accessibility/keyboard checks, apply one batched correction if needed, and rerun only affected tests plus the complete final gate.

- [ ] **Step 5: Request an independent source review.**

Use superpowers:requesting-code-review against the approved design and this plan. Require specific review of raw-birth exclusion, consent TOCTOU, one-call enforcement, calculation/identity replay, CAS publication, migration abort-before-DROP, retry/replacement tables, provider budget concurrency, invalidation semantics, scheduler bounds, and V3 compatibility.

- [ ] **Step 6: Remediate confirmed findings and repeat the final gate.**

Do not claim completion from an earlier head after a fix. Re-run every affected focused lane and the full commands in Step 2 on the final head.

- [ ] **Step 7: Prepare the implementation handoff without performing remote operations.**

Report the exact final commit, changed-file scope, local verification results, known rollout prerequisites, and the separately authorized production gates. Do not apply the remote migration, set secrets, deploy, enable first-open, or activate cron unless the user explicitly authorizes that gate.

---

## Dependency and checkpoint map

1. Tasks 1-4 establish the factual M5 boundary and may be reviewed together.
2. Task 5 establishes deterministic eligibility/validation before any provider code consumes private data.
3. Task 6 must land before V2 persistence, and its production migration remains a later gate.
4. Tasks 7-10 establish provider configuration, immutable V2 input, centralized retries, and CAS publication.
5. Task 11 establishes the only path that can hide a previously published reading before a successor succeeds.
6. Tasks 12-14 add dormant scheduling, consent/product APIs, and the reader experience.
7. Tasks 15-17 add model-change gates, product truth, operational separation, and final evidence.

At each checkpoint, preserve a green root typecheck and all previously completed focused lanes. If a task changes a contract or shared interface consumed by a later task, update this plan and its exact interface before parallel implementation begins.
