# AI-Generated Your Pattern — Product and Engineering Design

**Date:** 2026-08-14  
**Status:** Proposed after repository review; **amended in place 2026-08-16**  
**Repository baseline:** `henryperkins/patternlike-app` at `bd4ea0f20c46b77468e151599f477c34f01bea6d`  
**Intended repository path:** `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md`  
**Scope:** Replace the current shared, human-authored Your Pattern catalog with one private, AI-generated Pattern for each accepted chart fingerprint. Preserve deterministic chart calculation, feature derivation, privacy, consent, provenance, export, deletion, and fail-closed publication controls. Define the machine-generated interpretation ontology that authorizes the model’s meanings. Source discovery, licensing, and source selection remain out of scope.

**2026-08-16 amendment.** Where this document and the shipped `contracts/m7` / `0007` freeze disagreed, the freeze wins. The decisions, and the product-spec v0.6 restatement of Your Pattern, are recorded in [`2026-08-16-m7-spec-artifact-amendments.md`](2026-08-16-m7-spec-artifact-amendments.md). Sections 7.3, 9.1, 10.1, 19.4, 23.2, 23.3, 23.8, 23.9, 24.3, and 24.4 below are the amended text. Do not implement the pre-amendment lists.

## Contents

- [1. Decision summary](#1-decision-summary)
- [2. Repository review and baseline corrections](#2-repository-review-and-baseline-corrections)
- [3. Relationship to existing specifications](#3-relationship-to-existing-specifications)
- [4. Product contract](#4-product-contract)
- [5. Scope and deliberate exclusions](#5-scope-and-deliberate-exclusions)
- [6. System architecture](#6-system-architecture)
- [7. M7 contract package](#7-m7-contract-package)
- [8. Consent model](#8-consent-model)
- [9. Pattern state and reader experience](#9-pattern-state-and-reader-experience)
- [10. Input minimization and fact packet](#10-input-minimization-and-fact-packet)
- [11. Deterministic selection and clustering](#11-deterministic-selection-and-clustering)
- [12. Pass one: chapter planner](#12-pass-one-chapter-planner)
- [13. Pass two: Pattern writer](#13-pass-two-pattern-writer)
- [14. Independent semantic verification](#14-independent-semantic-verification)
- [15. Durable job state machine](#15-durable-job-state-machine)
- [16. Publication transaction](#16-publication-transaction)
- [17. Data model and migration](#17-data-model-and-migration)
- [18. Encrypted generation artifacts and retention](#18-encrypted-generation-artifacts-and-retention)
- [19. Public API design](#19-public-api-design)
- [20. Web application design](#20-web-application-design)
- [21. Lifecycle and invalidation](#21-lifecycle-and-invalidation)
- [22. Account export and portability](#22-account-export-and-portability)
- [23. Interpretation ontology](#23-interpretation-ontology)
- [24. Administrative inspection](#24-administrative-inspection)
- [25. Provider configuration, budgets, and rollout controls](#25-provider-configuration-budgets-and-rollout-controls)
- [26. Observability and safe logging](#26-observability-and-safe-logging)
- [27. Compatibility, migration, and rollout](#27-compatibility-migration-and-rollout)
- [28. Test and evaluation design](#28-test-and-evaluation-design)
- [29. Security and threat model](#29-security-and-threat-model)
- [30. Retention matrix](#30-retention-matrix)
- [31. Implementation decomposition](#31-implementation-decomposition)
- [32. Acceptance criteria](#32-acceptance-criteria)
- [33. Resolved decisions and intentional non-decisions](#33-resolved-decisions-and-intentional-non-decisions)
- [34. Repository evidence reviewed](#34-repository-evidence-reviewed)
- [35. Specification self-review](#35-specification-self-review)

## 1. Decision summary

Your Pattern becomes a private, immutable, model-written artifact generated from one active natal chart. The calculation service remains the authority for chart facts. The existing M4 natal-feature layer remains the authority for normalized, accuracy-gated facts. A new deterministic selection policy and a versioned machine-generated interpretation ontology define what may be interpreted. Models may organize and express that permitted material; they may not calculate, invent chart facts, use personal context, or introduce uncatalogued astrological meanings.

The selected product decisions are:

1. One accepted Pattern is allowed for one user and one chart fingerprint. Failed, cancelled, or superseded attempts do not consume the opportunity. A successful artifact cannot be rerolled.
2. The first visit to Your Pattern is the consent surface. The reader explicitly selects **Generate my Pattern** after reviewing exactly what will and will not be sent.
3. Only calculated chart facts, uncertainty constraints, a confirmed locale, and activated ontology records may influence generation. Check-ins, life events, journal entries, prior readings, current priorities, relationships, health data, device data, and inferred biography are excluded.
4. The final artifact is layered: four to six core synthesis chapters, followed by zero or more shorter Additional signatures. Every eligible feature is accounted for internally as used, summarized, redundant, suppressed, unsupported, or omitted under a closed reason.
5. Planning is a bounded hybrid. Trusted code selects and clusters eligible evidence. A model may merge compatible clusters, title and order chapters, and assign allowed evidence, but it cannot add facts, remove mandatory coverage, or bypass uncertainty.
6. Generation is a validated two-pass process: planner, deterministic plan validation and freeze, writer, deterministic candidate validation, independent semantic verification, and atomic publication.
7. Generation is durable and asynchronous. The reader may leave and return. No partial chapter is ever published.
8. Automatic retries are bounded. Planner output may change only until one plan passes and is frozen. Every writer retry uses the same frozen plan. After the retry budget, the reader may start a new job because no artifact was accepted.
9. Revoking Pattern-generation consent stops unfinished and future generation, but does not hide or delete an already accepted Pattern.
10. **Delete this Pattern** permanently erases the artifact and blocks another generation for the same chart fingerprint. Only a minimal non-content tombstone remains until account deletion.
11. Correcting birth details permanently erases any accepted Pattern tied to the superseded chart. If standing Pattern consent remains active, the corrected chart automatically reserves a new generation job after activation. If consent is inactive, the new chart waits at the contextual consent state.
12. Meanings come from a closed, versioned interpretation ontology. The ontology is generated and authorized by machines, not manually approved record by record.
13. The ontology begins with an already curated, licensed, immutable source corpus. Source acquisition and licensing are not part of this design.
14. Model creativity is limited to traceable semantic synthesis. A higher-level theme may combine source-supported meanings, but it must retain a dependency graph to those meanings and cannot create a new unsupported correspondence.
15. Readers see minimal provenance: the artifact is AI-generated, its generation date, its Pattern ID, and a clear statement that raw birth details were not sent. Exact evidence, prompts, plans, source citations, model responses, and validator records remain private.
16. A dedicated authorized administrative role may routinely inspect complete generation artifacts during their retention window. Every inspection is audited.
17. Exact prompts, plans, raw responses, rejected drafts, and validator feedback are retained for 30 days after a job reaches a terminal state. The accepted Pattern and compact provenance remain until deletion, chart correction, critical ontology recall, or account deletion.

## 2. Repository review and baseline corrections

This design follows the repository’s current implementation rather than the earlier conceptual baseline. The following findings materially change the recommended architecture.

### 2.1 The current Pattern path is a signed editorial catalog, not a generation pipeline

`apps/api/src/routes/pattern.ts` currently:

- loads the active chart and confirmed locale;
- loads the single active signed content release;
- verifies the immutable R2 bundle against its D1 hash;
- reads approved `PatternContentObject` records;
- calls `ensureNatalFeatureSet()`;
- calls `matchPatternObject()` for every locale-compatible record;
- projects the human-authored title, summary, body, resources, tensions, and counter-expression; and
- paginates the resulting catalog with a cursor bound to chart fingerprint, feature-set hash, bundle hash, and editorial order.

The AI design should reuse the chart and feature foundations but should not preserve the release-catalog matching loop, catalog pagination, release-version projection, or dynamic recomputation of prose on every `GET`.

### 2.2 The existing M4 natal-feature layer is the correct fact boundary

`apps/api/src/services/natal-features.ts` already derives normalized, deterministic feature records from `chart_snapshots.snapshot_json` and `uncertainty_json`. It accuracy-gates houses and angles, canonicalizes aspect body order, emits an uncertainty feature, derives IDs from the chart fingerprint plus a versioned policy, sorts by stable ID, and hashes the complete set.

`apps/api/src/db/natal-features.ts` already provides the needed completion-receipt behavior: feature rows and the receipt commit atomically, concurrent derivations must converge on the same set hash, and a partial set is never treated as current. This layer remains unchanged in responsibility. The AI feature introduces a second policy on top of it for interpretation selection and clustering; it does not teach the natal-feature derivation layer about prose, ontology, or models.

### 2.3 The M5 daily-reading pipeline supplies the operational pattern to reuse

The constrained-model daily-reading implementation already demonstrates the repository’s preferred shape for private AI work:

- immutable inputs frozen before execution;
- encrypted commands in `jobs.payload_enc`;
- a D1 row as the durable outbox;
- opaque queue messages;
- compare-and-swap claims with leases;
- execution-time revalidation of mutable consent and eligibility;
- pinned provider, model, prompt, selection, validation, calculation, and output-schema versions;
- a global UTC-day provider-call budget;
- strict structured output;
- deterministic candidate validation;
- encrypted publication;
- safe, payload-free logs;
- fixed synthetic evaluation corpora; and
- fail-closed behavior with no unvalidated prose fallback.

Your Pattern should extend these conventions rather than creating a second orchestration philosophy. It still needs a dedicated queue, tables, contracts, prompts, budgets, and state machine because a multi-stage, once-per-chart artifact is not a daily reading revision.

### 2.4 The existing account-level AI consent cannot safely be reused

The current `ai_synthesis` consent is explicitly presented as authorization for daily-reading generation and carries the daily-reading category policy. Its loader selects the newest consent solely by `kind = 'ai_synthesis'`. Reusing that kind for Pattern would conflate two different purposes and could cause the daily-reading loader to observe a Pattern-specific grant or revocation.

M7 therefore adds a distinct consent kind, `pattern_generation`, with its own policy, endpoint, copy, category list, cursor/reconciliation hooks, and lineage. The D1 `consents.kind` CHECK must be rebuilt in migration `0007`; overloading `source_id`, `ui_surface`, or policy-version naming is rejected as an implicit purpose expansion.

### 2.5 M4, M5, and M6 contracts are already established boundaries

The current repository treats milestone contract packages as immutable once frozen. M4 owns the existing Pattern and Time Travel documents. M5 owns constrained-model daily readings. M6 owns the closed account-export and privacy lifecycle documents.

This feature therefore introduces `contracts/m7/` with `schema_version: 0.7.0`. It must not edit M4’s Pattern response in place, widen M5’s daily-reading consent or generation command, or append fields to M6’s closed export document. M7 explicitly supersedes only the consumer Your Pattern success contract and introduces an M7 account-export successor that includes accepted Pattern content.

### 2.6 The next D1 migration is `0007`, not a renumbered M4 migration

`db/d1/MIGRATIONS.json` currently ends at `0006_usr05_topic_exclusions`. The additive database work in this feature is `0007_ai_generated_pattern.sql`. The product milestone is M7 even though M4 remains the source of natal-feature types.

### 2.7 The signed release subsystem must remain intact

The existing content-release system is shared infrastructure and historical evidence. Today and compatibility paths may still depend on release artifacts. The AI Pattern rollout must decouple Your Pattern from the active editorial pointer without deleting `content_releases`, the active pointer, release ingestion, candidate files, signing scripts, or M4 readers prematurely.

During rollout, the application supports both implementations by cohort. Once an account enters the AI path, it never falls back to human-authored Pattern prose. Turning generation off may stop new jobs, but it must continue to serve already accepted AI artifacts.

### 2.8 The current reader experience exposes evidence; the selected design does not

`PatternChapters.tsx` currently renders a **Why this?** disclosure containing feature labels and IDs plus editorial release metadata. The current product description also says users can inspect the facts and editorial sources behind an interpretation.

The selected minimal-provenance design intentionally removes claim-level Pattern evidence from the consumer response. That is a product-contract change, not a styling change. `apps/web/PRODUCT.md` and the product specification must be revised so “Inspectable by default” continues to apply to calculated chart facts, uncertainty, data controls, and retained system provenance, without claiming that every AI-written Pattern paragraph exposes its evidence to the reader.

### 2.9 M6 export is closed and cannot honestly absorb Pattern content

`assembleAccountExport()` produces the frozen M6 document with fixed top-level sections. An accepted Pattern is portable derived content belonging to the reader. Projecting it into `readings`, `context_signals`, or chart snapshots would misclassify it. M7 must define and serve an account-export successor with an explicit `patterns` section. Raw prompts, rejected drafts, validator discussions, and administrative artifacts remain non-portable operational records.

### 2.10 Chart correction already has a factual-invalidation precedent

`reading-invalidation.ts` demonstrates the required race posture: owner-scoped lookup, encrypted lineage, guarded D1 batches, assertion-probe aborts, and reconciliation after an interrupted chart-change workflow. Pattern correction should use the same principles, but the selected lifecycle is stricter than Today: the old Pattern is erased rather than retained in an invalidated state.

Because D1 and R2 cannot be deleted in one transaction, “immediate deletion” means that the publication ciphertext and the wrapped artifact key become irrecoverable in the guarded D1 transaction. Physical R2 deletion follows asynchronously and idempotently.

### 2.11 Launch cannot assume calculated multi-body pattern features exist

The M4 predicate and feature types support calculation-produced multi-body patterns, but the current candidate documentation records that `apps/calc-stub` emits `patterns: []`. The existing editorial candidates therefore express configurations through exact aspect predicates instead of relying on a `pattern` fact.

M7 may cluster connected aspects for document organization, but it must not name a grand trine, T-square, yod, or other calculated configuration unless the frozen M4 feature set contains that explicit pattern fact or a later versioned deterministic feature policy adds it. Ontology coverage and launch regression thresholds must reflect the facts the active calculation contract actually emits, not the broader type system’s theoretical vocabulary.

## 3. Relationship to existing specifications

This document supersedes only the **Your Pattern** portions of `docs/superpowers/specs/2026-08-13-your-pattern-time-travel-v02-design.md` once the AI rollout reaches the applicable cohort.

It does not supersede:

- Time Travel date reconstruction, cycle receipts, budgets, comparison, or USR-09 behavior;
- M4 natal-feature derivation and completion receipts;
- M5 daily-reading generation and validation;
- M6 export/deletion mechanics except where M7 explicitly provides successor documents and table classifications;
- the signed content-release system for Today, historical compatibility, or rollback evidence; or
- the chart-facts UI.

The previous human Pattern catalog remains a truthful historical implementation. Its candidate area, review manifest, signing scripts, release bundles, and M4 response fixtures are not relabeled as AI artifacts.

This design deliberately introduces an independent semantic verifier for Pattern. It does not change the M5 daily-reading rule that no second model reviews the first. `apps/web/PRODUCT.md` must scope that statement to daily readings and describe Pattern’s separate two-pass-plus-verifier publication contract rather than presenting one product-wide rule that the runtime no longer follows.

## 4. Product contract

### 4.1 Purpose

Your Pattern is a stable, private interpretation of one calculated natal chart. It synthesizes durable chart structures into ordinary language without pretending to know the reader’s biography, current circumstances, health, relationships, future, or inner state.

The Pattern is not a chat response, a daily forecast, a professional diagnosis, a prediction, a deterministic personality verdict, or an automatically updating profile.

### 4.2 Facts before meaning

The authority chain is strict:

1. Swiss Ephemeris and the calculation contract establish chart facts.
2. M4 natal-feature policy normalizes and suppresses facts according to birth-time accuracy.
3. M7 selection policy determines which normalized facts are eligible, mandatory, redundant, unsupported, or suppressed for Pattern generation.
4. The active M7 ontology release defines the permitted meanings, tensions, counter-expressions, and semantic combinations for those facts.
5. The planner may organize only that eligible material.
6. The writer may express only the frozen plan and authorized meanings.
7. Deterministic validation and independent semantic verification decide whether the artifact may publish.

No later stage may repair or reinterpret an earlier authority boundary.

### 4.3 Stability

An accepted Pattern is immutable for its chart fingerprint. The following do not regenerate it:

- model upgrades;
- prompt changes;
- selection-policy changes;
- a new ontology version;
- feedback;
- locale changes;
- check-ins;
- life-event changes;
- consent revocation;
- ordinary preference changes; or
- repeated requests.

Only a different active chart fingerprint is eligible for a new Pattern. A critical ontology recall may erase an accepted Pattern but does not grant another generation for that same fingerprint.

### 4.4 Reader-facing provenance

The consumer experience shows only:

- that the Pattern was generated by AI from calculated chart facts;
- the generation date;
- an opaque Pattern ID;
- the artifact locale;
- the effective birth-time accuracy; and
- a statement that birth date, birth time, birthplace, and coordinates were not sent to the model.

The consumer API does not expose feature IDs, ontology IDs, source-fragment citations, prompts, plans, provider request IDs, raw responses, validator output, or administrative access history.

### 4.5 Updated brand language

The product may continue to say **Calculated, not invented** only with an explanation: chart facts are calculated; interpretation is model-written within a closed, traceable meaning system.

The product commitment should be revised to:

> Private by design. Calculated facts are inspectable. Generated interpretations are bounded, versioned, and auditable.

The prior claim that every reader can inspect the evidence and editorial sources behind every Pattern paragraph is removed for this surface.

## 5. Scope and deliberate exclusions

This feature includes:

- M7 contracts and schemas;
- a separate Pattern-generation consent;
- a per-chart generation claim and tombstone model;
- deterministic feature selection and clustering;
- a two-pass planner/writer pipeline;
- independent semantic verification;
- encrypted publication and administrative artifacts;
- reader state, generation, failure, deletion, correction, and revocation flows;
- admin inspection APIs and access auditing;
- M7 export and account-deletion coverage;
- an automated ontology-generation and activation pipeline; and
- rollout, evaluation, migration, and operational gates.

The following are excluded:

- source discovery, source acquisition, licensing negotiation, source-quality adjudication, and source editorial selection;
- human approval of individual ontology records or individual user Patterns;
- use of user context, journal, life events, feedback, prior readings, current goals, or inferred biography in Pattern generation;
- conversational regeneration, follow-up questions, alternate drafts, style sliders, or “try another” controls;
- translation or regeneration after an accepted artifact;
- public sharing, public profiles, Bonds, social discovery, or professional astrologer workspaces;
- fine-tuning or model-training consent;
- using generated Pattern content as training data;
- a polished administrative frontend in the initial runtime slice; and
- deletion or refactoring of the signed editorial subsystem unrelated to Your Pattern.

## 6. System architecture

### 6.1 Runtime overview

```text
Your Pattern first open
        |
        v
GET Pattern state + current consent terms
        |
        v
Generate my Pattern
        |
        +--> guarded D1 batch
                - grant/confirm Pattern consent
                - reserve chart claim
                - freeze encrypted generation command
                - create domain job state
                - create audit event
        |
        v
opaque PATTERN_QUEUE nudge
        |
        v
planner stage
        - load and verify frozen facts
        - load frozen ontology records
        - call planner
        - validate and freeze plan
        |
        v
writer stage
        - call writer with frozen plan
        - validate strict schema and claim ledger
        |
        v
semantic-verifier stage
        - independently review every claim
        - pass/fail only; cannot rewrite
        |
        v
publication stage
        - recheck active chart, consent, locale, ontology recall, account state
        - encrypt accepted document
        - atomically publish or refuse stale output
        |
        v
GET /v1/pattern returns one immutable reader projection
```

The queue message contains no user data, chart data, prompt, plan, or prose. It contains only a closed message kind, the generic job ID, the generation ID, and a monotonically increasing stage generation used to reject stale deliveries.

### 6.2 Why each model stage is a separate durable step

A planner call, writer call, and semantic-verifier call can each consume substantial wall time and provider budget. One Queue delivery should not hold a five-minute claim while performing three unrelated calls and multiple validations. Each stage therefore:

1. claims the current job stage with compare-and-swap;
2. verifies the encrypted command and current mutable gates;
3. consumes a provider-call budget unit only immediately before a provider call;
4. stores the exact stage artifacts encrypted;
5. transitions the job to the next queued stage or a bounded retry state;
6. clears the claim lease; and
7. dispatches the next opaque nudge through the same durable-outbox pattern.

A duplicate nudge performs a zero-row claim and acknowledges. A crash before queue send is recovered by the undispatched sweeper. A crash after send may duplicate delivery, which converges through the stage claim.

### 6.3 Architecture boundaries

The implementation is divided into small units with one responsibility each:

- **Natal feature loader:** reads or derives the current M4 feature set and verifies its receipt.
- **Pattern selection policy:** classifies and clusters features without prose.
- **Ontology loader:** loads and hash-verifies one immutable active or frozen ontology release.
- **Generation command builder:** produces the minimized provider-independent fact packet and pins every version.
- **Planner publisher:** performs one strict structured-output planner call.
- **Plan validator:** deterministically checks coverage, compatibility, and bounds.
- **Writer publisher:** performs one strict structured-output writing call.
- **Pattern candidate validator:** verifies structure, evidence references, uncertainty, policy, and leakage.
- **Semantic verifier:** produces an independent structured verdict and no prose mutation.
- **Pattern publication repository:** atomically publishes one accepted encrypted artifact.
- **Lifecycle service:** handles revocation, deletion, chart correction, ontology recall, and account erasure.
- **Admin artifact repository:** grants audited, authorized access to retained exact artifacts.
- **Ontology control plane:** builds, evaluates, signs, activates, recalls, and rolls back ontology releases.

No unit may fetch or infer data outside its declared input. In particular, planner and writer modules do not query D1 directly; they receive already minimized request documents.

## 7. M7 contract package

### 7.1 Package identity

`contracts/m7/` carries `schema_version: 0.7.0` and includes a manifest that pins the exact hashes of the frozen M4, M5, and M6 manifests it depends on.

M7 is additive. Existing files under `contracts/m0/`, `contracts/m3/`, `contracts/m4/`, `contracts/m5/`, and `contracts/m6/` remain byte-for-byte unchanged.

### 7.2 Required M7 documents

The package contains:

- `pattern-state.schema.json`
- `pattern-consent.schema.json`
- `pattern-generation-request.schema.json`
- `pattern-generation-accepted.schema.json`
- `pattern-generation-status.schema.json`
- `pattern-fact-packet.schema.json`
- `pattern-selection-manifest.schema.json`
- `pattern-planner-output.schema.json`
- `pattern-plan.schema.json`
- `pattern-writer-output.schema.json`
- `pattern-semantic-verdict.schema.json`
- `pattern-document-internal.schema.json`
- `pattern-response.schema.json`
- `pattern-delete-request.schema.json`
- `pattern-admin-artifact.schema.json`
- `pattern-admin-access-event.schema.json`
- `pattern-source-corpus-release.schema.json`
- `pattern-source-fragment.schema.json`
- `pattern-ontology-release.schema.json`
- `pattern-ontology-record.schema.json`
- `pattern-ontology-evaluation.schema.json`
- `account-export.schema.json`, as the M7 successor to M6
- valid and invalid fixtures for every document
- fixed synthetic chart/feature fixtures for selection, planning, writing, and verification, housed at `contracts/m7/fixtures/corpus/`
- an OpenAPI amendment for the consumer and internal administrative routes
- package-policy checks that JSON Schema alone cannot express; and
- a manifest recording predecessor hashes and explicit supersession boundaries.

### 7.3 Contract policy invariants

Cross-document invariants have named owners. “The M7 validator enforces” is not a single inventory.

The contract validator (`contracts/validate_schemas.py` `_m7_policy_errors`) enforces:

- forbidden keys anywhere in a fact packet;
- consumer response must not contain `feature_aliases`, `ontology_rule_ids`, `claim_class`, or `nft_`;
- `verdict: "pass"` implies `unevaluated_fixture_count === 0`.

`packages/pattern-engine` enforces alias resolution, plan bounds, claim ledgers, acyclic synthesis, expression-guidance propositions, and coverage accounting.

The Worker enforces:

- a deleted, superseded, or withdrawn claim cannot also have an active document;
- a generation-consumed tombstone cannot return to `available`;
- the M7 export includes only active accepted Pattern artifacts and compact provenance.

The remaining bullets that earlier drafts listed as validator rules — every alias resolving to one M4 feature, every ontology rule existing in the pinned release, four-to-six chapters, tensions and counter-expressions, uncertainty representation — are runtime or compiler checks. A schema-valid fixture that fails one of those is not filed under `fixtures/invalid/` unless a policy-only stem exists for it.

### 7.4 OpenAPI supersession

M7 explicitly supersedes M4’s successful `GET /v1/pattern` response for accounts in the AI cohort. It does not mutate the M4 document.

During rollout, the server dispatches by a trusted cohort decision:

- editorial cohort: existing M4 cursor/limit semantics and M4 response;
- AI cohort: M7 no-query semantics and one immutable M7 document.

The same-origin web deployment and Worker must be deployed together before any cohort is moved. Unknown query parameters are rejected in the AI path; old cursor semantics are never silently ignored.

## 8. Consent model

### 8.1 New consent purpose

M7 adds `pattern_generation` to `consents.kind`. It is separate from:

- `account_processing` for chart calculation;
- `ai_synthesis` for daily-reading generation;
- context-source permissions;
- research consent; and
- model-training consent.

The launch Pattern consent policy is versioned independently, for example `PATTERN_GENERATION_CONSENT_POLICY_VERSION = "1.0.0"`.

### 8.2 Server-owned category list

The Pattern consent category list is closed and server-owned per policy version. The terms state that generation may use separate model calls to organize the calculated evidence, write the document, and verify the finished claims; every call is limited to the same disclosed category boundary. It contains only:

- normalized natal positions selected for Pattern;
- normalized natal aspects selected for Pattern;
- eligible calculated multi-body patterns;
- eligible houses and angles when birth-time accuracy permits them;
- the effective birth-time accuracy and suppression boundary;
- the confirmed output locale; and
- ontology meaning records and expression guidance attached to those facts; and
- the machine-generated chapter plan and draft when sent to the independent verifier for the same Pattern job.

It explicitly excludes:

- raw birth date;
- raw birth time;
- birthplace label;
- coordinates;
- birth timezone;
- account or identity identifiers;
- chart ID or chart fingerprint;
- device, session, or security data;
- current location;
- check-ins;
- life events;
- journal entries;
- daily readings;
- feedback;
- preferences other than the confirmed output locale; and
- any source text not already compiled into the activated ontology release.

The consent copy distinguishes raw inputs from derived sensitivity. Birth date, time, place, and coordinates are not transmitted as fields, but a natal feature set—especially eligible houses and angles—is still sensitive derived data and may support inferences about birth timing. Pattern/Like does not describe the provider packet as anonymous or impossible to reverse.

Adding or removing a category, changing the external provider, or materially changing the stated purpose requires a new policy version and a fresh grant. A model change within the same disclosed provider and purpose does not by itself require a new consent version, but it remains pinned in provenance. A deployment that encounters a grant under an unknown policy treats it as absent.

### 8.3 First-open grant and reservation

The reader first requests current Pattern state and current consent terms. The page displays the exact policy version and category list.

The **Generate my Pattern** action sends one idempotent `POST /v1/pattern-generations` request containing only:

```json
{
  "schema_version": "0.7.0",
  "consent_policy_version": "1.0.0",
  "confirm": "GENERATE MY PATTERN",
  "reason": "first_open"
}
```

The server resolves the active chart, feature set, locale, active ontology, and current account state. The client does not supply chart facts, chart ID, user ID, ontology version, model configuration, or selection policy.

The guarded reservation batch either:

- writes a new Pattern consent lineage row and reserves the job; or
- observes an already active Pattern consent and reserves the job; or
- returns the existing in-progress or accepted state for an exact replay.

Consent grant, claim reservation, encrypted command insertion, domain job insertion, and audit event commit in one D1 batch. The user cannot end with a newly granted first-use Pattern consent and no corresponding reservation merely because a process crashed between two requests.

### 8.4 Standing consent after the first grant

Once granted, Pattern consent remains active until revoked. It authorizes automatic generation for a later corrected chart, subject to the current policy version being implemented and all other gates passing.

It does not authorize regeneration of an already consumed chart fingerprint.

### 8.5 Revocation

Revocation creates a new consent lineage row and takes effect immediately for unfinished work.

A queued or running job checks consent:

- when it claims a stage;
- immediately before each provider call; and
- inside the publication transaction.

If consent no longer matches the frozen pin, the job becomes `cancelled`, the claim returns to an unconsumed `available` state, and no provider call or publication occurs. Regranting later may start a new job for the same chart because no artifact was accepted.

An already accepted Pattern remains readable after revocation. Revocation is not deletion.

### 8.6 Consent API

M7 adds:

```text
GET    /v1/consents/pattern-generation
DELETE /v1/consents/pattern-generation
```

Granting occurs through the first generation reservation so the consent and initial job are atomic. The `GET` response reports current terms and current grant state. `DELETE` is idempotent and requires an idempotency key.

## 9. Pattern state and reader experience

### 9.1 Consolidated state document

`GET /v1/pattern-state` returns one closed state and enough safe metadata for the web client to render without probing multiple failure-prone endpoints.

The state enum is:

- `chart_required`
- `locale_confirmation_required`
- `consent_required`
- `ontology_unavailable`
- `available`
- `organizing_evidence`
- `writing`
- `checking_claims`
- `ready`
- `failed`
- `deleted`
- `withdrawn`
- `editorial_catalog`

`editorial_catalog` is the dual-path rollout state: the account has not entered the AI path and the client keeps rendering M4 `PatternChapters`. It is a member of the closed enum, not drift.

The document may include a generation ID, Pattern ID, public stage, safe failure class, retryable flag, generation timestamp, locale, and effective accuracy. It never contains provider errors, prompt text, source citations, evidence IDs, or private content.

### 9.2 First-open screen

When state is `consent_required`, Your Pattern preserves the existing chart-facts experience above it and replaces the current reviewed-content section with a contextual generation panel.

The panel explains:

- the chart is already calculated;
- the model will receive calculated features, not birth details;
- no current-life context is used;
- the output will be generated once for this chart;
- the reader cannot reroll it after successful publication;
- deleting it is permanent; and
- correction of birth details erases it and may generate a successor for the corrected chart while consent remains active.

The primary action is **Generate my Pattern**. The secondary action is to leave without granting.

### 9.3 Progress states

Internal states map to reader copy as follows:

| Internal stage | Public state | Reader copy |
|---|---|---|
| `reserved`, `planning`, `plan_validating`, planner retry | `organizing_evidence` | Organizing the evidence |
| `writing`, writer correction retry | `writing` | Writing your Pattern |
| `candidate_validating`, `semantic_verifying`, verifier retry, `publishing` | `checking_claims` | Checking every claim |
| terminal success | `ready` | Your Pattern is ready |

The page polls with bounded backoff and may also refresh on navigation. Closing the page has no effect on the job.

No percentage is shown because the stages are not linearly measurable. The page does not imply the model is thinking continuously while the job is queued or retry-delayed.

### 9.4 Ready artifact

The reader projection contains:

- an artifact title;
- four to six core chapters;
- zero to eight Additional signatures;
- a visible uncertainty boundary when required;
- minimal provenance; and
- a separate irreversible deletion control.

Each core chapter contains:

- title;
- summary;
- two to six prose sections;
- one or more tensions;
- one or more resources or constructive expressions; and
- one explicit counter-expression.

An Additional signature contains a title and one short interpretation. It cannot carry a major theme that the selection policy marked mandatory for a core chapter.

The consumer projection does not include the private claim ledger. The existing **Why this?** feature-ID disclosure and editorial release code do not appear in AI mode.

### 9.5 Failed state

Automatic retries are exhausted before the reader sees a terminal `failed` state. The page shows only the broad failed stage and a safe explanation.

Examples:

- “The evidence could not be organized into a valid Pattern.”
- “The Pattern could not be written within its evidence boundaries.”
- “The completed draft did not pass its claim checks.”
- “Generation is temporarily unavailable.”

A **Try again** action creates a new job for the current chart. It does not mutate the failed job or reuse a rejected plan. It is available only while no accepted Pattern or consumed tombstone exists.

### 9.6 Deleted and withdrawn states

`deleted` states that the reader permanently removed this chart’s Pattern and another cannot be generated from the same chart.

`withdrawn` states that Pattern/Like removed the interpretation basis after a critical ontology defect. It does not expose the defect or source content. Another Pattern cannot be generated for the same chart fingerprint.

## 10. Input minimization and fact packet

### 10.1 Frozen server-side command

The encrypted generation command pins:

- M7 command version;
- generation ID and job identity;
- chart snapshot ID, fingerprint, profile version, calculation contract, and container digest, for server-side verification only;
- M4 feature-set ID, policy version, set hash, and selected feature hashes;
- M7 selection-policy ID and version;
- confirmed locale and locale revision;
- Pattern consent ID, policy version, and validation time;
- ontology version, bundle hash, corpus-release hash, and recall status at reservation;
- planner, writer, and verifier provider/model/reasoning/prompt/output-schema pins;
- retry budgets;
- input-manifest hash;
- artifact-retention policy version; and
- reservation reason from the four-value `reservationReason` enum: `first_open`, `first_open_retry`, `failed_attempt_retry`, or `chart_correction`.

`reservationReason` is not the consumer `generationReason`. The consumer request cannot send `chart_correction`. `chart_correction` at `PATTERN_AI_ROLLOUT=internal` is staff-gated against `PATTERN_INTERNAL_ACCOUNT_IDS`; it is not admitted for every user.

This command is encrypted under the user DEK in `jobs.payload_enc`, following the current AAD convention. Nothing copies the command into queue messages or logs.

### 10.2 Provider-visible packet

The provider-visible packet is a fresh, minimized projection. It contains no server IDs with stable user or chart meaning.

Current M4 feature IDs are derived partly from the chart fingerprint. They are therefore not sent to the provider. The command builder assigns generation-local aliases in stable canonical order:

```json
{
  "schema_version": "0.7.0",
  "locale": "en-US",
  "effective_accuracy": "exact",
  "uncertainty": {
    "suppressed_classes": [],
    "required_language_rule_ids": []
  },
  "features": [
    {
      "alias": "f001",
      "feature_class": "aspect",
      "fact": {
        "body_a": "sun",
        "body_b": "mars",
        "aspect": "square",
        "orb": 2.3
      },
      "coverage": "mandatory",
      "ontology_rule_ids": ["ont_..."],
      "cluster_ids": ["clu_..."]
    }
  ],
  "selection_constraints": {
    "core_chapters_min": 4,
    "core_chapters_max": 6,
    "additional_signatures_max": 8
  }
}
```

The alias-to-feature mapping remains encrypted in the administrative record and is used by validators. The provider sees no `user_id`, chart ID, chart fingerprint, birth value, consent ID, source-fragment text, or previous Pattern.

### 10.3 Provider request posture

Planner, writer, and verifier requests follow the safe request posture already established by `reading-prompt.ts`:

- immutable top-level instructions;
- exactly one JSON document as user input;
- user or source text always represented as escaped JSON values, never as additional messages or roles;
- strict JSON Schema structured output;
- `store: false`;
- no tools;
- no browsing;
- no file search;
- no code execution;
- no MCP servers;
- no background mode;
- no provider-side conversation state; and
- an explicit maximum output-token bound.

The source corpus itself is never sent to the per-user writer. Only activated ontology records required for the selected facts are included.

## 11. Deterministic selection and clustering

### 11.1 Separate policy from M4 feature derivation

M4 answers “what calculated facts exist and are permitted by accuracy?” M7 selection answers “which of those facts are eligible and how must they be accounted for in a bounded Pattern?” These are separate versioned policies.

Launch constants are:

```text
PATTERN_SELECTION_POLICY_ID      = pattern-selection-policy
PATTERN_SELECTION_POLICY_VERSION = 1.0.0
```

### 11.2 Ontology eligibility

A feature becomes interpretation-eligible only when the active ontology contains a compatible, activated meaning record for its exact normalized class and constraints.

A feature with no compatible ontology record is not sent to a model. It receives the internal accounting reason `ontology_unsupported`. The system does not ask the model to fill the gap from pretrained knowledge.

### 11.3 Coverage classes

The selection compiler assigns each feature one class:

- `mandatory_core`: must appear in a core chapter;
- `mandatory_any`: must appear in a core chapter or Additional signature;
- `eligible`: may appear when it improves coherence;
- `redundant`: semantically covered by stronger selected evidence;
- `suppressed`: prohibited by uncertainty or calculation policy;
- `ontology_unsupported`: no activated meaning authority exists; or
- `capacity_omitted`: valid but below the bounded document capacity after deterministic ranking.

A `capacity_omitted` result is allowed only for non-mandatory features and must record the policy comparison that placed it below the boundary.

### 11.4 Ranking inputs

Ranking is deterministic and comes from the versioned selection policy plus ontology metadata. It may consider only:

- ontology-declared presentation priority;
- ontology-declared salience band;
- feature class;
- aspect type and orb, when present in the calculated fact;
- membership in a calculated multi-body pattern;
- whether a feature is angular or house-dependent and eligible;
- graph connectivity to other eligible features;
- explicit ontology cluster tags;
- redundancy relationships declared by the ontology; and
- uncertainty constraints.

It may not use user behavior, engagement, current context, feedback, inferred personality, or model judgment.

The launch policy bounds the provider packet to at most 40 eligible feature aliases and at most 12 mandatory aliases. If a valid chart and active ontology produce more mandatory evidence than the document contract can represent, generation refuses with `pattern_selection_capacity_exceeded`. It does not silently demote a mandatory feature.

### 11.5 Candidate cluster graph

Trusted code builds a graph whose nodes are eligible features. An edge may exist only when one of these closed relationships holds:

- the features share a celestial body;
- both participate in the same calculated multi-body pattern;
- their ontology records share an explicit cluster tag;
- one ontology record declares the other a compatible synthesis partner; or
- a versioned selection rule creates a documented structural relationship.

Connected components become candidate clusters. A component larger than the policy maximum is split deterministically by weighted edge order and stable feature alias. The planner receives candidate clusters and compatibility rules; it does not receive an unstructured list and permission to discover arbitrary themes.

### 11.6 Complete accounting

The selection manifest records every M4 feature in one and only one terminal accounting state. This record is private and retained with compact provenance after publication.

The writer never sees `redundant`, `suppressed`, `ontology_unsupported`, or `capacity_omitted` features. The planner sees only eligible features and the closed omission counts required for plan validation.

## 12. Pass one: chapter planner

### 12.1 Planner responsibility

The planner chooses a coherent document structure inside the deterministic evidence envelope. It may:

- merge candidate clusters when the supplied compatibility rules permit it;
- assign mandatory and eligible aliases to chapters or signatures;
- choose four to six chapter titles;
- define chapter purposes;
- choose chapter order;
- identify which supplied tensions, resources, counter-expressions, and derived syntheses each chapter must use; and
- explicitly omit non-mandatory eligible features under closed reasons.

It may not:

- create or modify chart facts;
- introduce an alias not in the packet;
- introduce an ontology rule not authorized for the cited alias;
- create new astrological meanings;
- assign a suppressed or unsupported feature;
- omit mandatory evidence;
- use personal context;
- write reader-facing chapter prose; or
- alter chapter-count and signature-count bounds.

### 12.2 Planner output

The strict planner output is shaped like:

```json
{
  "schema_version": "0.7.0",
  "chapters": [
    {
      "chapter_key": "chapter_01",
      "working_title": "Pressure toward independent direction",
      "purpose": "Integrate initiative, resistance, and disciplined action without presenting conflict as inevitable.",
      "feature_aliases": ["f001", "f006"],
      "ontology_rule_ids": ["ont_004", "ont_019"],
      "derived_synthesis_ids": ["syn_012"],
      "required_tension_ids": ["ten_008"],
      "required_resource_ids": ["res_003"],
      "required_counter_expression_ids": ["ctr_007"]
    }
  ],
  "additional_signatures": [
    {
      "signature_key": "signature_01",
      "working_title": "A quieter form of persistence",
      "feature_aliases": ["f014"],
      "ontology_rule_ids": ["ont_041"]
    }
  ],
  "omissions": [
    {
      "feature_alias": "f021",
      "reason": "redundant_with_chapter",
      "covered_by": "chapter_03"
    }
  ]
}
```

The planner output contains no final prose.

### 12.3 Deterministic plan validation

The plan validator verifies:

- exact schema and closed keys;
- four to six chapters;
- no duplicate chapter or signature key;
- no unknown feature alias;
- no unknown ontology, synthesis, tension, resource, or counter-expression ID;
- every rule is authorized for at least one cited feature;
- every mandatory feature is assigned according to its required coverage class;
- every remaining eligible feature is assigned or omitted under an allowed reason;
- no feature is both assigned and omitted;
- no feature appears in incompatible chapter groups;
- every chapter has enough distinct evidence to support its purpose;
- no chapter is supported only by an uncertainty record or absence claim;
- every chapter has at least one required tension and counter-expression;
- the ontology compatibility graph permits every model-requested merge;
- the title and purpose do not contain prohibited claim classes or packet identifiers;
- Additional signatures do not absorb evidence designated `mandatory_core`;
- omission links refer to real chapters; and
- the serialized plan remains below its byte bound.

A valid plan is canonicalized and hashed. The hash and exact encrypted plan become immutable for that job.

### 12.4 Planner retry policy

The planner receives at most two provider attempts per generation job.

A transport or provider-unavailable failure may retry the same request. A schema or deterministic-validation failure may retry with a closed list of validator codes and no rejected prose. The second attempt may propose a different plan because no plan has been frozen yet.

Once a plan passes validation:

- planner attempts stop;
- later stages cannot invoke the planner;
- the plan hash is pinned in the command state; and
- every writer retry must match the same plan hash.

If no plan validates, the job fails at the public `organizing_evidence` stage.

## 13. Pass two: Pattern writer

### 13.1 Writer input

The writer receives only:

- the frozen plan;
- the feature aliases and normalized facts assigned to each plan unit;
- the ontology records authorized for those aliases;
- required tensions, resources, counter-expressions, and derived syntheses;
- the effective accuracy and required uncertainty rules;
- the confirmed locale;
- the product voice and prohibited-claim policy;
- exact section and word bounds; and
- the strict internal output schema.

It does not receive unassigned features, omitted features, raw source corpus, previous drafts except structured correction codes, previous Pattern prose, user context, or user identity.

### 13.2 Writer output

The internal writer output carries reader prose plus a private claim ledger:

```json
{
  "schema_version": "0.7.0",
  "title": "Your Pattern",
  "chapters": [
    {
      "chapter_key": "chapter_01",
      "title": "Pressure toward independent direction",
      "summary": "A recurring negotiation between immediate movement and forces that ask for control, timing, or endurance.",
      "sections": [
        {
          "section_key": "chapter_01_section_01",
          "text": "You may experience momentum most clearly when something resists it...",
          "claim_class": "reflective_interpretation",
          "feature_aliases": ["f001"],
          "ontology_rule_ids": ["ont_004"],
          "derived_synthesis_ids": ["syn_012"]
        }
      ],
      "tensions": [
        {
          "text": "Decisiveness can become reactivity when urgency goes unexamined.",
          "feature_aliases": ["f001"],
          "ontology_rule_ids": ["ten_008"]
        }
      ],
      "resources": [
        {
          "text": "Resistance can clarify which actions deserve sustained effort.",
          "feature_aliases": ["f001", "f006"],
          "ontology_rule_ids": ["res_003"]
        }
      ],
      "counter_expression": {
        "text": "The same structure can appear as disciplined courage rather than continual conflict.",
        "feature_aliases": ["f001", "f006"],
        "ontology_rule_ids": ["ctr_007"]
      }
    }
  ],
  "additional_signatures": [],
  "uncertainty_note": null
}
```

Every sentence-bearing unit has evidence references. The references are removed only when creating the consumer projection.

### 13.3 Length and structure bounds

The launch writer policy requires:

- four to six core chapters;
- two to six sections per core chapter;
- 250 to 550 words per core chapter, including its lists and counter-expression;
- zero to eight Additional signatures;
- 70 to 160 words per Additional signature;
- one uncertainty note of 40 to 140 words when required;
- 1,500 to 4,500 total reader-facing words;
- no paragraph longer than 180 words;
- no title longer than 90 characters; and
- no list with more than five items.

A shorter document is allowed only when the deterministic selector produces fewer eligible meanings than the minimum ordinary document requires. In that case, a dedicated sparse-chart schema permits three core chapters, but the selector must set `sparse_pattern: true` before planning. The model cannot declare a chart sparse.

### 13.4 Deterministic candidate validation

The candidate validator checks:

- strict schema and closed keys;
- exact chapter and signature keys from the frozen plan;
- exact evidence assignment boundaries from the plan;
- no unknown feature, ontology, or synthesis reference;
- no missing mandatory reference;
- no prose unit without a claim ledger;
- no astrological prose unit with only expression-guidance references;
- every derived synthesis is authorized for the cited source-supported meanings;
- exact locale support under the current validation policy;
- required uncertainty language and prohibited time-sensitive claims;
- no raw birth details, chart identifiers, account identifiers, provider identifiers, packet aliases, prompt language, schema language, or internal instructions in reader prose;
- no HTML, Markdown, links, code, or executable instructions;
- no predictions, guarantees, inevitability, fate, diagnosis, medical causation, legal or financial advice, or replacement-of-professional-advice framing;
- no unsupported biography, childhood event, profession, relationship state, trauma, health condition, or current-life assertion;
- no statement that context confirmed or revealed astrology;
- no claim that a collective or generic meaning is unique proof about the individual;
- balanced tension, resource, and counter-expression treatment;
- no direct contradiction inside one chapter;
- no materially duplicated chapter summaries;
- word and byte bounds; and
- canonical content hash generation.

The validator returns codes and safe detail codes, not rewritten prose.

### 13.5 Writer retry policy

The writer receives at most three attempts against one frozen plan.

A transport failure retries the same request. A deterministic rejection or semantic rejection may trigger another writer attempt with a closed correction document containing:

- finding codes;
- affected chapter and section keys;
- the policy rule violated; and
- the instruction to preserve the frozen plan and evidence assignments.

Rejected prose is not echoed into the correction prompt. The writer may rephrase and reorganize sections inside a chapter, but it cannot change chapter membership, chapter count, omitted features, or ontology authorization.

After the third failed writer attempt, the job reaches terminal failure.

## 14. Independent semantic verification

### 14.1 Role

The semantic verifier is an additional publication gate. It is not an editor and cannot rewrite, patch, or approve conditionally.

It receives:

- the validated candidate;
- the frozen plan;
- the exact normalized facts;
- the exact authorized ontology records;
- derived-synthesis dependency graphs;
- the uncertainty policy; and
- a strict verdict schema.

It returns only a verdict and finding records.

### 14.2 Separation of duties

The verifier configuration must not be identical to the writer configuration. At minimum, the tuple `(provider, model, prompt_version)` must differ. Production activation should prefer a different model snapshot or provider family so one model configuration is not the sole semantic author and judge.

The verifier cannot browse, use tools, retrieve sources, or rely on model memory. It judges only the supplied facts and ontology.

### 14.3 Verdict schema

```json
{
  "schema_version": "0.7.0",
  "verdict": "pass",
  "findings": []
}
```

A finding contains only:

- finding code;
- severity;
- chapter or section key;
- cited feature aliases;
- cited ontology rules; and
- a bounded rationale used for administrative inspection and writer correction.

Allowed verdicts are `pass` and `reject`. There is no `pass_with_changes`.

### 14.4 Verification checks

The verifier checks whether:

- each claim is entailed by or is a reasonable traceable synthesis of its cited ontology records;
- a metaphor introduces a new astrological proposition;
- a derived synthesis exceeds its dependencies;
- a paragraph turns possibility into certainty;
- a chapter implies a diagnosis, cause, fate, guarantee, or specific future event;
- a chapter invents biography or current circumstances;
- collective or generic material is falsely presented as uniquely proven;
- uncertainty is honored in meaning, not only mentioned in a footer;
- chapters materially contradict one another;
- chapters collapse into one-sided labeling;
- tension and counter-expression remain genuinely different possibilities; and
- prose exceeds the calm, non-mystifying voice boundary in a way deterministic vocabulary checks could not capture.

### 14.5 Retry behavior

A verifier transport failure retries the identical candidate at most twice.

A semantic rejection does not retry the verifier against unchanged prose. It returns to the writer correction path if writer attempts remain. The same frozen plan is retained.

A verifier `pass` does not publish by itself. Trusted application code performs all final deterministic and mutable-state checks before committing.

## 15. Durable job state machine

### 15.1 Generic job status and domain stage

The existing `jobs.status` enum remains unchanged:

```text
queued | running | succeeded | failed | cancelled
```

A new `pattern_generation_jobs.stage` supplies the domain state:

```text
reserved
planning
plan_validating
writing
candidate_validating
semantic_verifying
publishing
succeeded
failed
cancelled
```

The generic job ID is the claim and outbox identity. The public generation ID is a separate opaque `pgen_...` value.

### 15.2 Queue message

```ts
interface PatternGenerationMessage {
  kind: "pattern_generation";
  job_id: string;
  generation_id: string;
  stage_generation: number;
}
```

`WorkerMessage` widens additively to `GenerationMessage | PrivacyMessage | PatternGenerationMessage`. The existing daily-reading message remains byte-compatible and does not acquire a new discriminator. The queue handler checks privacy first, then the closed Pattern discriminator, and otherwise applies the existing daily-reading parser.

Pattern uses a dedicated `PATTERN_QUEUE`, not `READING_QUEUE`, so long-form generation does not contend with daily-reading latency or privacy jobs. The consumer verifies the queue binding name and refuses a Pattern message delivered on an unexpected queue rather than silently routing it through the reading path.

Like the current reading and privacy consumers, the Pattern consumer runs the fail-closed secure-configuration check before claim, command decryption, artifact read, or provider work. Pattern-specific rollout and publisher configuration are validated in that same preflight.

### 15.3 Stage claim

Each stage claim performs a guarded update requiring:

- matching job ID and job type;
- matching current stage generation;
- `queued`, or `running` with an expired lease;
- due `available_at`;
- active account;
- claim not consumed, deleted, superseded, or withdrawn; and
- no current cancellation reason.

The update sets `running`, a new claim token, a stage-specific lease expiry, and increments the relevant stage-attempt counter.

A zero-row update means duplicate, stale stage, cancellation, terminal state, or a live competing claim. The message is acknowledged.

### 15.4 Stage transition

R2 and D1 cannot share a transaction. A successful stage first writes each encrypted artifact with conditional-create semantics under a deterministic artifact identity. It then commits one guarded D1 batch that:

- asserts the current claim token and stage generation;
- records the create-only artifact inventory, metadata, and hashes;
- updates stage and increments stage generation;
- returns `jobs.status` to `queued`;
- clears claim token and lease;
- clears `dispatched_at`; and
- records a safe audit event.

A crash before the D1 batch may leave an unregistered encrypted object. The retry may adopt it only when its deterministic identity, envelope, and hashes match the stage output exactly; otherwise maintenance quarantines it as an orphan. A crash after the D1 batch is recovered by the undispatched sweep.

Queue dispatch follows the D1 commit. The undispatched sweep finds the new stage if dispatch fails.

### 15.5 Retry timing

Recommended launch delays are:

- first retry: 30 seconds;
- second retry: 2 minutes;
- final infrastructural retry: 10 minutes; and
- expired-lease recovery: later than the stage’s full lease window.

Retry timing is stage-aware. A long provider timeout is never paired with a lease that can expire first.

### 15.6 Terminal failure

A terminal failure:

- sets generic job status to `failed`;
- sets domain stage to `failed`;
- records a closed failure class and broad public stage;
- clears claim token and lease;
- sets the generation claim back to `available` because no artifact was accepted;
- records raw retained artifacts under the 30-day policy; and
- permits a new manually requested job for the current chart.

A terminal cancellation caused by consent revocation, chart change, account state, or ontology recall behaves similarly but records `cancelled` and does not show a generic retry until the blocking state changes.

Provider-budget exhaustion is terminal for the current job and receives no automatic retry. The unconsumed claim remains available, but the public retryable flag stays false until a later UTC date has budget and every other eligibility gate passes. Turning rollout `off` parks or cancels stage advancement without converting an otherwise valid job into a user-visible content failure.

### 15.7 Manual retry

**Try again** creates a new generic job and public generation ID. It freezes current chart, feature set, locale, consent, ontology, and model configuration again. It does not mutate the old job or promise the same plan.

The generation opportunity remains available because no Pattern was accepted.

## 16. Publication transaction

### 16.1 Final mutable checks

Immediately before publication, the application rechecks:

- the user remains active;
- the generation claim still names this job and remains unconsumed;
- the active chart ID, fingerprint, profile version, calculation contract, and feature-set hash match the frozen command;
- the confirmed locale still matches the frozen locale revision;
- Pattern consent remains the exact active grant pinned by the command;
- the frozen ontology version is still valid and not recalled;
- the plan hash and candidate hash match the stored stage artifacts;
- deterministic validation remains successful under the pinned policy;
- semantic verdict is `pass` for the exact candidate hash;
- no accepted document already exists for the chart fingerprint; and
- the job still owns the publication claim.

A locale change before publication is treated as a stale generation, not as permission to publish in an obsolete language. The job is cancelled without consuming the chart. The reader may start a new job in the newly confirmed locale.

### 16.2 Atomic effects

The publication D1 batch:

1. inserts assertion-probe guards for every required current state;
2. inserts the encrypted accepted Pattern document;
3. updates the claim from `reserved` to `accepted` and sets `consumed_at`;
4. marks the generic job `succeeded` and domain stage `succeeded`;
5. stores compact provenance hashes and pinned versions;
6. records an audit event; and
7. asserts that exactly one active Pattern document now exists and the job is terminal.

No existing row is edited from rejected prose into accepted prose. The accepted document is created only by the successful publication transaction.

### 16.3 Stale publication

If any guard fails, the complete batch rolls back. The candidate remains an encrypted retained artifact but never appears in the consumer API.

A stale claim caused by another successful publisher is acknowledged as duplicate. A stale chart, locale, consent, or recalled ontology cancels the job without consuming the chart unless another accepted Pattern already did.

## 17. Data model and migration

### 17.1 Migration identity

The database change is:

```text
db/d1/0007_ai_generated_pattern.sql
```

`db/d1/MIGRATIONS.json` advances to `schema_version: 0.7.0` and records that M7 adds new encrypted columns. Every new column encrypted directly under the user DEK—including wrapped Pattern document keys, wrapped generation-artifact keys, and the generic encrypted command—is added to the repository’s key-rotation registry before any writer ships. `pattern_documents.document_enc` is encrypted under its random document key rather than the user DEK, so rotation rewraps the document key and does not re-encrypt the long document body.

### 17.2 Consent-table rebuild

SQLite cannot widen the existing `consents.kind` CHECK in place. Migration `0007` rebuilds `consents` with the existing columns and data plus `pattern_generation` in the allowed kind set.

The migration:

- creates `consents_m7` with the widened CHECK;
- copies all existing rows exactly;
- validates row counts and foreign keys;
- drops and renames in the same migration transaction;
- recreates indexes; and
- leaves consent IDs, versions, lineage, and timestamps unchanged.

No consent payload is encrypted, so this rebuild does not require application-level decryption.

### 17.3 `pattern_generation_claims`

Purpose: enforce one accepted Pattern opportunity per user and chart fingerprint, independently of job retention and document deletion.

Recommended columns:

```text
id                         TEXT PRIMARY KEY
user_id                    TEXT NOT NULL REFERENCES users(id)
chart_fingerprint_hash     TEXT NOT NULL
last_chart_id               TEXT
status                     TEXT NOT NULL
active_generation_id       TEXT
consumed_at                TEXT
accepted_at                TEXT
deleted_at                 TEXT
superseded_at              TEXT
withdrawn_at               TEXT
created_at                 TEXT NOT NULL
updated_at                 TEXT NOT NULL
UNIQUE (user_id, chart_fingerprint_hash)
```

Allowed status values:

```text
available | reserved | accepted | deleted | superseded | withdrawn
```

Rules:

- `accepted`, `deleted`, `superseded`, and `withdrawn` require `consumed_at`.
- `available` and `reserved` require `consumed_at IS NULL`.
- only `reserved` may have `active_generation_id`.
- consumed states can never return to `available` or `reserved`.
- `chart_fingerprint_hash` is a domain-separated full SHA-256 value, not the raw fingerprint.
- the row is retained after Pattern deletion, chart correction, or ontology withdrawal to enforce no-reroll behavior.
- account deletion removes it.

A generation that never accepted an artifact may return to `available` even if its chart later becomes inactive. If the same chart fingerprint becomes active again, it remains eligible because its one successful generation was never consumed.

### 17.4 `pattern_generation_jobs`

Purpose: store non-content domain state for one generation job.

Recommended columns include:

```text
generation_id              TEXT PRIMARY KEY
job_id                     TEXT NOT NULL UNIQUE REFERENCES jobs(id)
user_id                    TEXT NOT NULL REFERENCES users(id)
claim_id                   TEXT NOT NULL REFERENCES pattern_generation_claims(id)
chart_id                   TEXT NOT NULL
chart_fingerprint_hash     TEXT NOT NULL
feature_set_id             TEXT NOT NULL
feature_set_hash           TEXT NOT NULL
feature_policy_version     TEXT NOT NULL
selection_policy_version   TEXT NOT NULL
locale                     TEXT NOT NULL
locale_revision            INTEGER NOT NULL
consent_id                 TEXT NOT NULL
consent_policy_version     TEXT NOT NULL
ontology_version           TEXT NOT NULL
ontology_bundle_hash       TEXT NOT NULL
corpus_release_hash        TEXT NOT NULL
reservation_reason         TEXT NOT NULL
stage                      TEXT NOT NULL
stage_generation           INTEGER NOT NULL
planner_attempts           INTEGER NOT NULL DEFAULT 0
writer_attempts            INTEGER NOT NULL DEFAULT 0
verifier_attempts          INTEGER NOT NULL DEFAULT 0
plan_hash                  TEXT
candidate_hash             TEXT
semantic_verdict_hash      TEXT
public_failure_stage       TEXT
failure_class              TEXT
retention_expires_at       TEXT
created_at                 TEXT NOT NULL
updated_at                 TEXT NOT NULL
finished_at                TEXT
```

Provider/model/prompt pins remain in the encrypted command and compact provenance. Clear columns hold only operationally queryable version and state fields.

### 17.5 `pattern_documents`

Purpose: store only the currently active accepted reader artifact. Terminal lifecycle state belongs to `pattern_generation_claims`; a deleted, superseded, or withdrawn Pattern leaves no document row.

```text
id                           TEXT PRIMARY KEY
user_id                      TEXT NOT NULL REFERENCES users(id)
claim_id                     TEXT NOT NULL UNIQUE REFERENCES pattern_generation_claims(id)
generation_id                TEXT NOT NULL UNIQUE REFERENCES pattern_generation_jobs(generation_id)
chart_fingerprint_hash       TEXT NOT NULL
ontology_version             TEXT NOT NULL
ontology_bundle_hash         TEXT NOT NULL
locale                       TEXT NOT NULL
effective_accuracy           TEXT NOT NULL
document_enc                 BLOB NOT NULL
document_nonce               TEXT NOT NULL
wrapped_document_key_enc     BLOB NOT NULL
wrapped_document_key_version INTEGER NOT NULL
wrapped_document_key_nonce   TEXT NOT NULL
content_hash                 TEXT NOT NULL
compact_provenance_json      TEXT NOT NULL
generated_at                 TEXT NOT NULL
created_at                   TEXT NOT NULL
```

The reader document is encrypted under a random per-document 256-bit content key. That key is wrapped under the user DEK with AAD bound to the Pattern ID, claim ID, generation ID, and key version. This permits Pattern-specific key erasure without destroying the account DEK.

All ciphertext, wrapped-key, hash, and compact-provenance fields are required because every row is active. Explicit deletion, chart correction, critical recall, and account deletion first make the wrapped key unusable in the guarded lifecycle mutation and then delete the document row. The claim row is the only retained no-reroll tombstone.

A unique index on `user_id` permits at most one active Pattern document for the user. An index on `ontology_version` supports bounded recall selection.

### 17.6 `pattern_generation_artifact_keys`

Purpose: make retained R2 artifacts cryptographically erasable without destroying the user’s account DEK.

One random 256-bit content-encryption key is generated per generation job. It is wrapped under the user DEK with AAD bound to the generation ID and key version.

The table stores:

```text
generation_id              TEXT PRIMARY KEY
user_id                    TEXT NOT NULL
wrapped_key_enc            BLOB
wrapped_key_version        INTEGER
wrapped_key_nonce          TEXT
created_at                 TEXT NOT NULL
erased_at                  TEXT
```

The wrapped-key triplet is present exactly while any generation artifact is readable. Clearing it makes every R2 artifact for that generation unrecoverable immediately. Physical object deletion is still required and retried.

This new encrypted column family must be registered for user DEK rotation.

### 17.7 `pattern_generation_artifacts`

Purpose: inventory exact retained artifacts without storing their content in D1.

```text
id                         TEXT PRIMARY KEY
generation_id              TEXT NOT NULL
user_id                    TEXT NOT NULL
artifact_class             TEXT NOT NULL
object_key                 TEXT NOT NULL UNIQUE
ciphertext_sha256          TEXT NOT NULL
plaintext_sha256           TEXT NOT NULL
byte_length                INTEGER NOT NULL
created_at                 TEXT NOT NULL
expires_at                 TEXT NOT NULL
deleted_at                 TEXT
```

Allowed classes include:

- `fact_packet`
- `planner_request`
- `planner_response`
- `validated_plan`
- `writer_request`
- `writer_response`
- `rejected_candidate`
- `candidate_validation`
- `verifier_request`
- `verifier_response`
- `semantic_verdict`
- `accepted_internal_document`

Object keys use a closed prefix such as:

```text
pattern-generations/<generation_id>/<artifact_id>.json.enc
```

No user ID or chart fingerprint appears in the object key.

### 17.8 `pattern_admin_access_events`

Purpose: audit every administrative view of sensitive generation material.

```text
id                         TEXT PRIMARY KEY
admin_subject              TEXT NOT NULL
target_user_id             TEXT
target_scope_hash          TEXT NOT NULL
generation_id              TEXT NOT NULL
purpose_class              TEXT NOT NULL
artifact_classes_json      TEXT NOT NULL
result                     TEXT NOT NULL
created_at                 TEXT NOT NULL
```

No prose, prompt, source citation, finding rationale, IP address, or arbitrary administrator note is stored in this table.

On account deletion, `target_user_id` is cleared and the pseudonymous `target_scope_hash` remains for the 13-month administrator-accountability window. The hash is keyed or domain-separated so it cannot be joined to ordinary product identifiers outside the admin boundary.

### 17.9 Ontology tables

M7 adds non-user tables:

- `pattern_ontology_releases`
- `pattern_ontology_pointer`
- `pattern_ontology_evaluation_runs`
- `pattern_ontology_recall_events`
- `pattern_provider_daily_usage`
- `pattern_ontology_provider_daily_usage`

Ontology bodies and source-fragment mappings are immutable R2 artifacts. D1 stores release identity, hashes, signatures, status, evaluation summary, active pointer, and recall state.

### 17.10 Indexes

The migration provides indexed paths for:

- current claim by user and active chart fingerprint hash;
- active or failed generation by claim;
- queued undispatched Pattern jobs;
- expired Pattern claims;
- terminal jobs requiring artifact cleanup;
- active Pattern document by user;
- Pattern documents by ontology version for recall;
- artifacts by generation and expiry;
- admin access by generation and time; and
- active ontology pointer and recalled releases.

Every scheduler and cleanup query must demonstrate an indexed `EXPLAIN QUERY PLAN` fixture before rollout.

## 18. Encrypted generation artifacts and retention

### 18.1 Why exact artifacts live in R2

The planner and writer inputs, raw provider responses, rejected candidates, and semantic-verifier records are too large and too numerous for clear D1 JSON columns. They are also sensitive derived personal data because they describe one person’s chart and may contain prose that was never accepted for display.

D1 therefore stores only the encrypted-key envelope, inventory, hashes, state, and retention metadata. R2 stores the encrypted artifact bytes. The runtime never writes an exact prompt, fact packet, plan, draft, source excerpt, validator rationale, or accepted internal document to console output, ordinary audit rows, analytics, traces, queue messages, or provider-usage ledgers.

### 18.2 Artifact envelope

Each artifact uses AES-256-GCM under the per-generation artifact key described in `pattern_generation_artifact_keys`.

The additional authenticated data is the canonical JSON encoding of:

```json
[
  "patternlike.pattern-artifact",
  1,
  "<generation_id>",
  "<artifact_id>",
  "<artifact_class>",
  "<artifact_key_version>"
]
```

The encrypted object contains an envelope such as:

```json
{
  "envelope_version": 1,
  "algorithm": "AES-256-GCM",
  "generation_id": "pgen_...",
  "artifact_id": "part_...",
  "artifact_class": "planner_response",
  "key_version": 1,
  "nonce": "...",
  "ciphertext": "..."
}
```

The clear object key and R2 custom metadata may identify only artifact class, envelope version, ciphertext digest, and retention deadline. They do not contain user, chart, feature, consent, ontology-content, source-citation, or prose values.

### 18.3 Create-only storage

Artifacts are immutable. The service writes each object with conditional-create semantics. A retry may reuse an artifact only when:

- its inventory row names the same class and object key;
- its plaintext and ciphertext hashes match;
- its envelope metadata matches the expected generation and artifact identity; and
- the corresponding stage still owns the job.

A different artifact under an already-reserved identity is an integrity conflict. It is never overwritten.

### 18.4 Retention clock

The 30-day retention clock begins when the generation reaches `succeeded`, `failed`, `cancelled`, `superseded`, or `withdrawn`.

For an accepted active Pattern:

- the reader document remains in `pattern_documents` until its lifecycle ends;
- the exact fact packet, requests, plans, responses, rejected candidates, and detailed validator records expire after 30 days;
- compact provenance and hashes remain with the active document; and
- the accepted reader document remains available to the administrator through the same encrypted D1 artifact the reader uses.

For a failed generation:

- exact artifacts expire after 30 days;
- non-content failure metadata remains for 90 days; and
- aggregate, de-identified cost and quality metrics may remain after job cleanup.

Explicit Pattern deletion, chart correction, critical ontology recall, and account deletion override the ordinary retention window and erase the relevant exact artifacts immediately.

### 18.5 Cleanup process

A scheduled cleanup process:

1. selects expired artifact inventory rows through an indexed query;
2. claims a bounded cleanup batch;
3. deletes the corresponding R2 objects;
4. verifies that every known object is absent;
5. clears the per-generation wrapped artifact key;
6. marks inventory rows deleted; and
7. prunes terminal job metadata after its applicable retention period.

Key erasure happens only after the cleanup transaction has durably recorded the object set it intends to remove. If object deletion is temporarily unavailable, the key may be erased first only for a lifecycle operation that requires immediate cryptographic erasure. The physical-object deletion task then continues from the inventory without needing plaintext access.

### 18.6 Orphan detection

R2 listing is not the ownership source of truth. The D1 inventory is. A maintenance check may compare the closed `pattern-generations/` prefix with inventory rows and quarantine an unexpected object, but it must not infer ownership from the object key or delete an object merely because one listing pass did not find its D1 row.

The deployment gate includes a synthetic orphan fixture and proves that maintenance reports the condition without exposing object content.

## 19. Public API design

### 19.1 `GET /v1/pattern-state`

This is the first request made by the Your Pattern surface. It accepts no query parameters.

The response is a closed M7 state document:

```json
{
  "schema_version": "0.7.0",
  "state": "consent_required",
  "chart": {
    "chart_id": "cht_...",
    "effective_accuracy": "exact",
    "feature_policy_version": "1.0.0"
  },
  "consent": {
    "kind": "pattern_generation",
    "status": "not_granted",
    "policy_version": "1.0.0",
    "provider": "OpenAI",
    "enabled_categories": [
      "calculated_natal_features",
      "accuracy_and_suppression",
      "confirmed_content_locale",
      "activated_interpretation_ontology",
      "generated_pattern_plan_and_draft_for_validation"
    ]
  },
  "generation": null,
  "pattern": null
}
```

When a generation exists, `generation` contains only consumer-safe operational state:

```json
{
  "generation_id": "pgen_...",
  "stage": "writing",
  "status_updated_at": "2026-08-14T00:00:00Z",
  "started_at": "2026-08-14T00:00:00Z",
  "retryable": false,
  "request_id": null
}
```

When a Pattern is ready, `pattern` contains:

```json
{
  "pattern_id": "pat_...",
  "generated_at": "2026-08-14T00:00:00Z",
  "locale": "en-US",
  "effective_accuracy": "exact"
}
```

The state values are:

```text
chart_required
locale_confirmation_required
consent_required
ontology_unavailable
available
organizing_evidence
writing
checking_claims
ready
failed
deleted
withdrawn
```

`available` means consent exists and the current chart is eligible but no generation has been reserved. It is normally transient: the first-open grant reserves immediately, and a corrected chart with standing consent reserves automatically. It remains useful for recovery when reservation dispatch fails after consent succeeds.

A stale or unknown standing consent policy is projected as `consent_required` with the current terms; it is not treated as an active grant. A missing or recalled active ontology with no eligible successor is projected as `ontology_unavailable`.

The route returns:

- `200` for every recognized product state, including missing-chart and unconfirmed-locale states;
- `401` for no valid session; and
- `500 pattern_state_inconsistent` only when stored state violates an invariant.

A disabled rollout, exhausted provider budget, or temporarily unavailable queue does not make the state route fail. Those conditions are projected into `available`, `ontology_unavailable`, or the durable generation state as appropriate.

### 19.2 `GET /v1/consents/pattern-generation`

This route returns the current server-owned terms and current standing grant state. It accepts no query parameters.

Example response:

```json
{
  "schema_version": "0.7.0",
  "kind": "pattern_generation",
  "status": "not_granted",
  "provider": "OpenAI",
  "purpose": "one_pattern_per_chart",
  "policy_version": "1.0.0",
  "enabled_categories": [
    "calculated_natal_features",
    "accuracy_and_suppression",
    "confirmed_content_locale",
    "activated_interpretation_ontology",
    "generated_pattern_plan_and_draft_for_validation"
  ],
  "granted_at": null
}
```

The route never grants consent and never reserves generation. It exists so the first-open surface can display the exact current policy before the reader acts.

### 19.3 `DELETE /v1/consents/pattern-generation`

The route requires an `Idempotency-Key` and an empty body. It appends a revoked consent version and cancels an unfinished Pattern generation in the same durable mutation or through an immediately recoverable cancellation checkpoint.

An accepted Pattern remains readable. The response explicitly says so:

```json
{
  "schema_version": "0.7.0",
  "consent": {
    "kind": "pattern_generation",
    "status": "not_granted",
    "policy_version": "1.0.0",
    "revoked_at": "..."
  },
  "existing_pattern_retained": true
}
```

### 19.4 `POST /v1/pattern-generations`

This is both the contextual first-open grant and the recovery/manual-retry endpoint. It is the only consumer route that grants Pattern-generation consent, so the first consent and initial reservation can commit atomically.

Request:

```json
{
  "schema_version": "0.7.0",
  "consent_policy_version": "1.0.0",
  "confirm": "GENERATE MY PATTERN",
  "reason": "first_open"
}
```

Allowed consumer reasons are the three-value `generationReason` enum:

```text
first_open | first_open_retry | failed_attempt_retry
```

`chart_correction` is a `reservationReason` only. It is never accepted on this route. The command and the `0007` CHECK use the four-value union; this request does not.

The route requires an idempotency key. It never accepts a chart ID, chart fingerprint, locale, ontology version, model, prompt, feature list, or provider option from the client.

For `first_open`, the guarded D1 batch:

- verifies that the displayed policy version is still current;
- appends a Pattern consent grant when no active grant exists;
- reserves or observes the one claim for the current chart fingerprint;
- stores the encrypted frozen command;
- creates the generic and Pattern-domain job records;
- records the safe audit event; and
- returns one durable generation identity.

When standing consent is already active, the same route reserves generation without creating a redundant grant. `failed_attempt_retry` is accepted only after a terminal failed job and before the chart claim is consumed.

Successful response:

```json
{
  "schema_version": "0.7.0",
  "consent": {
    "kind": "pattern_generation",
    "status": "granted",
    "policy_version": "1.0.0",
    "granted_at": "..."
  },
  "generation": {
    "generation_id": "pgen_...",
    "stage": "organizing_evidence"
  }
}
```

The same exact replay returns the same consent and generation identities. Reusing the key with a different body returns `409 idempotency_conflict`. A live duplicate returns the existing generation identity. An accepted or otherwise consumed claim returns `409 pattern_already_consumed`. A stale policy version returns `409 consent_policy_version_stale` before any new consent or job is written.

### 19.5 `GET /v1/pattern-generations/:generation_id`

This route returns the consumer-safe status for one owner-scoped generation. It accepts no query parameters.

It returns `404 not_found` for another user’s generation, not `403`, so identifier probing cannot establish that the record exists. Internal error detail, provider request IDs, attempts, model output, hashes, ontology IDs, and source references are omitted.

### 19.6 `GET /v1/pattern`

M7 supersedes M4’s paginated editorial response for AI-cohort accounts.

The M7 endpoint accepts no query parameters. An accepted Pattern is one bounded document, so `cursor` and `limit` are no longer meaningful in the M7 shape. During staged compatibility, the server dispatches by the durable claim mode:

- accounts with an AI Pattern claim receive the M7 document or its M7 state refusal;
- accounts still in the editorial cohort continue to use the M4 implementation and M4 query contract; and
- a client never receives an M4 editorial fallback after an AI claim exists.

The M7 response contains:

```json
{
  "schema_version": "0.7.0",
  "pattern_id": "pat_...",
  "generated_at": "...",
  "locale": "en-US",
  "effective_accuracy": "exact",
  "provenance": {
    "assembly_mode": "constrained_model",
    "provider": "OpenAI",
    "model_family": "gpt",
    "raw_birth_details_sent": false
  },
  "core_chapters": [],
  "additional_signatures": [],
  "uncertainty": null
}
```

The public chapter projection excludes all internal aliases, feature IDs, ontology IDs, source fragments, claim ledgers, prompts, validator output, hashes, token counts, and model request IDs.

The route returns:

- `200` only for an active accepted document;
- `404 pattern_not_generated` when no accepted document exists;
- `410 pattern_deleted` after explicit deletion;
- `410 pattern_withdrawn` after critical ontology recall;
- `409 pattern_generation_in_progress` with the public stage when work is active;
- `409 pattern_generation_failed` with a retryable flag after terminal failure; and
- `409 pattern_generation_consent_required` when the chart is eligible but standing consent is absent.

The web client should normally use `GET /v1/pattern-state` first rather than building its state machine from these refusals.

### 19.7 `DELETE /v1/pattern`

Request:

```json
{
  "confirm": "DELETE PATTERN"
}
```

The route requires an idempotency key. It is owner-scoped and accepts no Pattern ID from the client; it acts on the current active Pattern.

A successful request:

- makes the Pattern inaccessible immediately;
- destroys the wrapped Pattern document key and deletes the active document row;
- moves the claim to `deleted` while preserving its consumed state;
- clears the generation artifact key;
- records the exact artifact deletion manifest;
- schedules physical R2 deletion; and
- emits a content-free audit event.

It returns `202` when physical artifact deletion remains in progress and `204` when all associated objects are already absent. Exact replay remains successful. A different body under the same key returns `409 idempotency_conflict`.

### 19.8 Internal and administrative APIs

The consumer API does not expose ontology releases or exact generation artifacts.

Internal service routes include:

```text
POST /internal/pattern-ontology-releases
POST /internal/pattern-ontology-releases/:version/recall
POST /internal/pattern-generations/:generation_id/reconcile
```

Administrative read routes live behind the separate administrator boundary described in Section 24:

```text
GET /admin/pattern-generations/:generation_id
GET /admin/pattern-generations/:generation_id/artifacts
GET /admin/pattern-generations/:generation_id/artifacts/:artifact_id
GET /admin/pattern-ontology-releases/:version
```

No consumer session can authorize those routes.

## 20. Web application design

### 20.1 Replace the catalog loader, not the chart view

`ChartView` remains responsible for chart facts and chart correction. `PatternChapters.tsx` is replaced by a state-oriented component family that no longer drains M4 pagination for AI-cohort accounts.

Recommended component boundaries:

```text
PatternExperience
├── PatternConsentGate
├── PatternGenerationProgress
├── PatternGenerationFailure
├── GeneratedPatternDocument
├── PatternDeletedState
└── PatternWithdrawnState
```

Each component consumes a closed state projection. None decides whether generation is eligible from local storage, route hashes, or stale client memory.

### 20.2 First-open consent screen

The first-open screen says, in ordinary language:

- the chart is already calculated;
- Pattern/Like will send calculated chart features, accuracy limits, confirmed language, and approved interpretation rules;
- it will not send birth date, birth time, birthplace, coordinates, identity, check-ins, life events, journal material, prior readings, or current circumstances as fields;
- calculated chart features remain sensitive derived data and may permit inferences even without those raw fields;
- the result is written once for this chart and cannot be rerolled; and
- deletion is permanent for this chart.

The screen displays the exact server-returned policy version and categories. The grant button echoes that version and uses one idempotency key for the lifetime of the visible intent.

The button label is **Generate my Pattern**.

### 20.3 Progress experience

The page keeps chart facts usable while Pattern work continues. The Pattern region shows one stable heading and replaces only its body.

The visible stages are:

- **Organizing the evidence**
- **Writing your Pattern**
- **Checking every claim**

The page polls `GET /v1/pattern-state` with bounded backoff while visible. It pauses polling when the document is hidden and immediately refreshes when visibility returns. It does not hold an open request or require a background browser tab for generation to continue.

Progress copy never invents a numeric percentage. Stage transitions are durable facts; elapsed-time estimates are not.

### 20.4 Ready document

The ready document renders:

- four to six core chapters;
- an Additional signatures section when present;
- an uncertainty note when required;
- a compact AI-generation disclosure; and
- a privacy/settings link for consent and deletion controls.

The existing `Why this?` disclosure and raw feature IDs are removed from the normal reader projection under the chosen minimal-provenance decision. Chart facts remain separately inspectable in the existing chart panels.

The final provenance line is similar to:

> AI-generated from your calculated chart · 14 August 2026 · Pattern `pat_…`

A secondary sentence states:

> Your birth date, time, birthplace, and coordinates were not sent to the model.

The reader-facing model label uses a stable family name supplied by the server rather than a deployment-specific model identifier that may confuse readers or reveal operational configuration.

### 20.5 Failure experience

A terminal failure names only the broad stage:

- evidence could not be organized;
- the Pattern could not be written; or
- the finished Pattern did not pass its checks.

The **Try again** control appears only when:

- no accepted Pattern exists;
- the claim is not consumed;
- consent remains active;
- the chart is still active; and
- the server marks the state retryable.

The client does not infer retryability from HTTP status.

### 20.6 Delete control

The Pattern’s privacy controls contain a separate **Delete this Pattern** action. It is not bundled into AI-consent revocation.

The confirmation explains:

- the Pattern and retained generation material will be permanently erased;
- it cannot be regenerated for the same chart; and
- correcting birth details creates a different chart that may receive a new Pattern when consent remains active.

The user must type or explicitly confirm the server-declared phrase `DELETE PATTERN`. A generic browser confirm dialog is insufficient.

### 20.7 Chart correction transition

During chart correction, the Pattern section enters a blocking transition only for the interpretive artifact; chart correction itself retains its existing workflow.

After the corrected chart activates:

- the old Pattern disappears immediately;
- the UI says it was removed because its underlying chart changed;
- standing consent starts a new progress state automatically; or
- inactive consent presents the first-open consent screen for the corrected chart.

The old prose is never shown beside the corrected chart, even while physical artifact deletion is retrying.

### 20.8 Accessibility

The web candidate must prove:

- a single logical `h1` for the chart page and correctly nested Pattern headings;
- polite status announcements only when the durable stage changes;
- no repeated polling announcements;
- keyboard access to consent, retry, and deletion workflows;
- focus restoration after failed actions and modal dismissal;
- visible focus under every state;
- reduced-motion behavior for any progress ornament;
- text equivalents for stage marks;
- no color-only state distinction; and
- no horizontal overflow at 320px, 390px, tablet widths, or desktop.

## 21. Lifecycle and invalidation

### 21.1 Consent revocation during generation

Revocation wins over generation.

The revocation mutation marks the current Pattern job cancellation-requested and removes its next dispatch eligibility. Every stage executor checks the current consent lineage before reading an artifact, before any provider call, and immediately before committing a stage transition or publication.

A provider response that returns after revocation may be encrypted for short-lived forensic evidence only when the job still owns a valid stage claim and retention policy permits it. It can never advance the job or publish a Pattern. Prefer discarding it without persistence when no investigation value is required.

The claim returns to `available` because no accepted artifact consumed it. If the user grants again for the same active chart, a new generation may be reserved.

### 21.2 Consent revocation after acceptance

The accepted Pattern remains active and readable. The consent record changes only future eligibility. No prose is rewritten, no artifact becomes hidden, and no automatic deletion is implied.

The privacy UI distinguishes:

- **Allow future Pattern generation** — standing consent; and
- **Delete this Pattern** — irreversible content deletion for the current chart.

### 21.3 Explicit Pattern deletion

Explicit deletion is a consumed terminal state. It removes:

- the accepted Pattern document row and wrapped document key;
- compact private provenance not required by the tombstone;
- exact generation artifacts regardless of their ordinary retention deadline;
- the per-generation artifact key; and
- any pending administrator-access cache.

The immediate lifecycle mutation also clears `jobs.payload_enc` and scrubs the Pattern-domain job to the minimum cleanup checkpoint needed to remove registered R2 objects. After physical cleanup, the generic and Pattern-domain generation job rows are deleted. The minimal claim tombstone remains until account deletion. It stores no prose, feature set, plan, prompt, ontology or source references, model response, provider identity, or generation configuration.

### 21.4 Chart correction

Chart correction is a factual invalidation and erasure event, not an ordinary supersession that archives the old artifact.

The chart-activation flow extends its current post-commit reconciliation sequence. After the new chart becomes active, an owner-scoped Pattern reconciliation operation:

1. finds the claim and document tied to the superseded chart;
2. cancels unfinished jobs for that chart;
3. moves an accepted claim to `superseded` while retaining `consumed_at`;
4. destroys the wrapped document key and deletes the active document row;
5. erases exact generation-artifact keys and clears the encrypted generic command;
6. inventories and schedules physical artifact deletion, retaining only a scrubbed cleanup checkpoint until it completes;
7. emits a safe audit event;
8. derives or confirms the new chart’s M4 feature-set receipt; and
9. reserves a new Pattern when standing Pattern consent and rollout allow it.

The new chart activation does not roll back if Pattern cleanup or enqueue temporarily fails. Reconciliation is durable and owner-scoped, following the repository’s current daily-reading fact-repair model. Until reconciliation completes, the Pattern consumer route checks the active chart against the document’s chart fingerprint hash and refuses the stale artifact.

### 21.5 Returning to a previously used chart fingerprint

The no-reroll rule follows the fingerprint history, not merely the current chart row.

If a later correction recreates a fingerprint whose Pattern was previously accepted, deleted, superseded, or withdrawn, the retained claim is already consumed. The product does not generate another Pattern for it. The reader sees a non-retryable state explaining that this chart has already used its one Pattern generation and that the earlier artifact is no longer retained.

If the earlier attempt never accepted an artifact, the claim remains unconsumed and the chart may generate normally when it becomes active again.

### 21.6 Locale changes

Before publication, the confirmed locale is a mutable eligibility fact. A locale change cancels the current job without consuming the chart. The user may start a new generation in the newly confirmed locale.

After publication, changing locale does not translate or regenerate the accepted Pattern. It remains in the locale in which it was generated. The interface displays that locale and does not silently machine-translate the document.

### 21.7 Ordinary ontology supersession

Activating a newer ontology version affects only jobs reserved afterward. Running jobs retain their frozen ontology version. Accepted Patterns remain unchanged and readable.

No product control offers an ontology-version upgrade for an unchanged chart.

### 21.8 Critical ontology recall

A recall is reserved for an activated ontology version that is found to authorize materially unsafe, unsupported, or corrupted interpretations.

Recall is a separate signed internal action that:

- marks the ontology release recalled;
- prevents new reservations and stage execution against it;
- selects affected active Pattern documents through an indexed query;
- moves their claims to `withdrawn` while preserving consumption;
- destroys the wrapped document key, deletes the active document row, erases generation artifact keys, and clears encrypted commands;
- schedules physical artifact deletion and removes scrubbed generation jobs after cleanup; and
- records safe withdrawal audit events.

A withdrawn Pattern cannot be regenerated for the same fingerprint. The consumer state says that the interpretation basis was withdrawn; it does not expose the unsafe ontology record or former prose.

Rollback to an earlier ontology version affects only future unconsumed claims. It does not reconstruct withdrawn Patterns.

### 21.9 Account deletion

Account deletion removes:

- Pattern documents;
- Pattern claims and their no-reroll tombstones;
- Pattern generation jobs and generic job rows;
- artifact-key envelopes;
- artifact inventory;
- all registered Pattern R2 objects;
- Pattern-generation consents;
- user-scoped generation provider metadata; and
- direct user references in administrator-access events.

The Pattern tables and R2 prefix are added to the deletion manifest before any production writer ships. The dependency-safe row order is documents and artifact inventory, artifact-key envelopes, Pattern-domain jobs, claims, Pattern consents, and finally the generic user jobs handled by the existing deletion path. Key destruction remains the final cryptographic erasure backstop.

Administrator-access events retain only the pseudonymous accountability fields described in Section 24.8 for their bounded 13-month window.

## 22. Account export and portability

### 22.1 Pattern is portable user content

An accepted Pattern is derived personal content presented to the user and must be included in a complete account export. It is not classified as a recomputable cache merely because a model produced it; the no-reroll rule means the exact artifact cannot be reconstructed later.

### 22.2 M7 export successor

M6’s account-export schema is closed. M7 introduces a successor export document rather than mutating M6 or forcing Pattern into the `readings` section.

The M7 export adds:

```json
{
  "patterns": {
    "status": "included",
    "items": [
      {
        "pattern_id": "pat_...",
        "status": "active",
        "generated_at": "...",
        "locale": "en-US",
        "effective_accuracy": "exact",
        "artifact": {}
      }
    ]
  }
}
```

Only active retained Pattern content is exported. A deleted, superseded, or withdrawn Pattern contributes no prose. The export may include a minimal lifecycle statement that such a Pattern once existed only when that statement is already visible to the user and belongs to the portable claim projection.

### 22.3 Portable and non-portable classifications

Portable:

- `pattern_documents` active reader artifact;
- reader-visible compact provenance; and
- `pattern_generation` consent lineage.

Non-portable operational or security state:

- provider budgets;
- stage leases and dispatch timestamps;
- raw prompts and provider responses;
- rejected drafts;
- internal claim ledgers;
- detailed validator findings;
- semantic-verifier records;
- admin-access events;
- source corpus and global ontology releases; and
- no-reroll tombstones after their content has been erased.

The export classification is explicit in `deletion-manifest.ts` and covered by a completeness test. “Non-portable” never means “not deleted with the account.”

### 22.4 Export consistency

An export reserves a consistent account snapshot. If Pattern deletion or chart correction races the export, the export either:

- includes the active Pattern that was still readable at the snapshot boundary; or
- excludes it after erasure committed.

It must not emit metadata for an active Pattern with missing ciphertext or include prose whose lifecycle state was already terminal at the export boundary.

## 23. Interpretation ontology

### 23.1 Authority boundary

The activated Pattern ontology is the model’s only authority for astrological meaning. The model’s pretrained associations may help it write grammatical prose, but they are not accepted as evidence for a correspondence.

A runtime statement is authorized only when its private claim ledger resolves through:

```text
reader prose
  -> ontology meaning or derived synthesis
  -> source-supported meaning nodes
  -> immutable curated source fragments
  -> calculated natal feature
```

Expression guidance may shape wording without asserting additional astrology.

### 23.2 Source corpus boundary

The ontology pipeline begins with an immutable source-corpus release supplied by an out-of-scope curation process.

A source-corpus release contains the shipped required fields: corpus release ID and hash, locale, `license_resolved: true`, and a non-empty fragment list. Each fragment is the shipped flattened record: id, corpus release id, locale, normalized proposition, excerpt, `license_class` (`licensed_excerpt` or `internal_synthetic`), and allowed transformation classes. Title and author are optional strings. Edition, location, and source-specific exclusions are optional additive properties so a later licensed excerpt can carry them; a synthetic fragment may omit them.

The ontology pipeline does not search the web, acquire books, determine copyright status, infer a license, or decide whether a source is trustworthy. A corpus release lacking `license_resolved: true` is refused. That flag is the machine-readable authorization; it is not inferred from title or author.

### 23.3 Ontology record classes

Every ontology rule is one flattened `patternOntologyRecord`. The required field set is the same for every `meaning_class`. Class-specific requirements are compiler policy, not extra schema fields.

The shipped required fields are: `id`, `meaning_class`, `locale`, `feature_predicate`, `normalized_proposition`, `source_fragment_ids`, `input_meaning_ids`, `transformation_class`, `tensions`, `counter_expressions`, `prohibited_claims`, `salience_band`, `presentation_priority`, and `cluster_tags`.

#### `source_supported`

A normalized meaning directly supported by cited source fragments. The compiler requires a non-empty `source_fragment_ids` array, an empty `input_meaning_ids` array, and a null `transformation_class`.

#### `derived_synthesis`

A higher-order theme derived from two or more activated source-supported meanings. The compiler requires at least two `input_meaning_ids` and a non-null `transformation_class`. `normalized_proposition` is the shipped field for the derived claim; `prohibited_claims` is the shipped field for prohibited extensions. The design-only names `derived_proposition`, `entailment_rationale`, `compatible_feature_relationships`, and `evaluator_verdict` are not on the record.

Allowed transformation classes are the shipped closed set:

```text
intersection
contrast
tension
counterbalance
developmental_arc
expression_range
shared_motif
```

A synthesis graph must be acyclic and must terminate exclusively in source-supported meanings.

#### `expression_guidance`

Non-claim-bearing suggestions for titles, metaphors, examples, pacing, and plain-language rendering. The compiler refuses a body, sign, house, aspect, life event, diagnosis, prediction, or psychological assertion in `normalized_proposition`, `tensions`, or `counter_expressions`. There is no class-specific schema shape.

### 23.4 Feature predicates

Ontology rules target the normalized M4 feature vocabulary and may additionally express bounded combinations that the deterministic selector can prove.

Predicates may reference:

- one position;
- one natal aspect;
- one calculation-produced multi-body pattern;
- an eligible angle;
- an eligible house cusp;
- an uncertainty or suppression fact; or
- a closed relationship between two or more selected features, such as a shared body or an explicitly admitted configuration.

The ontology cannot define its own chart calculations, orb policy, sign derivation, house system, aspect identity, or birth-time eligibility.

### 23.5 Ontology generator

The generator receives:

- one immutable corpus release;
- the ontology schema and policy versions;
- the closed M4 feature vocabulary;
- existing active ontology records when producing a successor;
- required coverage targets; and
- regression and prohibited-claim policy.

It produces a complete candidate release, not an incremental stream that can partially activate.

The provider request follows the same hard posture as runtime generation: top-level instructions, one escaped JSON input, strict schema, no tools, no browsing, no file search, no remote MCP, no code execution, `store: false`, and bounded tokens.

### 23.6 Deterministic ontology compiler

The compiler is the first authorization gate. It verifies:

- exact schema and size bounds;
- canonical IDs and hashes;
- source-fragment existence and corpus-release identity;
- license/usage flags supplied by the curated corpus;
- feature-predicate validity;
- canonical aspect ordering;
- house/angle and uncertainty compatibility;
- complete dependency graphs;
- acyclic derived synthesis;
- no model-originated meaning node without source termination;
- closed transformation classes;
- prohibited-claim vocabulary;
- no prediction, diagnosis, causation, inevitability, or biographical fact;
- tension and counter-expression coverage;
- locale support;
- duplicate or contradictory rules;
- deterministic priority and conflict resolution; and
- coverage thresholds for supported runtime features.

A candidate with one unreadable or invalid record is refused as a whole. The compiler does not skip records to make a release pass.

### 23.7 Independent ontology evaluator

A separately pinned semantic evaluator receives the candidate rule, all cited source-supported meanings, the permitted source fragments, and the deterministic compiler summary.

It returns a structured verdict for:

- source support;
- entailment;
- contradiction;
- unsupported expansion;
- diagnostic or predictive drift;
- one-sided or essentialist framing;
- tension/counter-expression balance;
- uncertainty compatibility; and
- cross-record conflict.

The evaluator cannot edit a rule. A failing rule fails the release.

The generator and evaluator do not share the same prompt. Production should use different model configurations or model snapshots when operationally available. Configuration equality is not automatically unsafe, but it must be explicit in the release evidence and may require stricter regression thresholds.

### 23.8 Fixed-chart regression

Every ontology candidate is exercised through the real deterministic selector, planner, writer, and validators against a synthetic fixed-chart corpus. The corpus lives at `contracts/m7/fixtures/corpus/`. Runtime tests may keep inline fixtures; those are not the activation corpus.

The corpus includes:

- exact, approximate, and unknown birth-time profiles;
- sparse and dense feature sets;
- charts with and without houses and angles;
- repeated-body aspect networks;
- calculation-produced multi-body patterns;
- conflicting source meanings;
- unsupported ontology gaps;
- every suppression class;
- adversarial source fragments containing instruction-like text;
- derived synthesis at the maximum allowed dependency depth; and
- multilingual fixtures for each supported locale.

Activation gates include:

- zero suppressed-feature leaks;
- zero uncited astrological claims;
- zero source-dependency failures;
- zero prohibited claim classes;
- complete mandatory-feature accounting;
- structural acceptance above the pinned threshold for every chart class;
- no regression in deterministic refusal behavior; and
- bounded token and cost estimates below the approved ceilings.

### 23.9 Machine signing and activation

A candidate that passes compilation, semantic evaluation, and fixed-chart regression, and that declares `provenance.origin: "machine_pipeline"`, is an authorized external release. It is canonicalized and signed by a dedicated ontology-release service identity. The signing key is not available to the generator or evaluator and is never stored in the repository, model prompt, R2 object body, or test snapshot.

An internal-only synthetic release may compile with `verdict: "pass"`, `evaluator_passed: false`, and `regression_passed: false`. That attestation is honest and is not an authorized external release. Absence of `provenance` is treated as internal-only. Reservation, not compilation, withholds it from accounts that are not on `PATTERN_INTERNAL_ACCOUNT_IDS`.

The internal ingestion route verifies:

- source-corpus release identity;
- canonical bundle hash;
- object hashes;
- evaluation report hashes;
- regression report hash;
- signing-key allowlist;
- signature;
- version immutability; and
- no active recall for the candidate’s source corpus.

It stores the immutable bundle in R2, records the release in D1, and atomically moves the active ontology pointer only after every gate passes.

### 23.10 Rollback and recall

An ordinary rollback moves the active pointer to an earlier non-recalled version. It affects only future reservations.

A critical recall marks a version unsafe and triggers the runtime withdrawal process in Section 21.8. A recalled version can never become active again under the same release identity.

### 23.11 Runtime freeze

Pattern reservation reads the active ontology release once, verifies its artifact hash, resolves the eligible ontology records for the derived feature set, and freezes:

- ontology version;
- ontology bundle hash;
- corpus release hash;
- selected rule IDs and content hashes; and
- source dependency hashes.

Execution reopens the same immutable ontology artifact and compares those pins before any provider call. A later pointer change has no effect on the job. A recall does: every executor checks recall state and terminates the job before advancing.

## 24. Administrative inspection

### 24.1 Dedicated authorization boundary

Full routine inspection is available only to a dedicated `pattern_generation_auditor` role.

Generic application administrators, support agents, editorial identities, repository collaborators, service tokens, and consumer users do not inherit this permission. The role is assigned through a separate administrator identity provider or Cloudflare Access policy and is not represented by the consumer `pl_session` cookie.

### 24.2 Separate route and session

Administrative routes are served on a separate protected hostname or path with:

- administrator OIDC authentication;
- short-lived server-side administrator sessions;
- explicit role and audience checks;
- `HttpOnly`, `Secure`, `SameSite=Strict` cookies;
- no bearer token returned to browser JavaScript;
- CSRF protection on any future mutation route;
- strict content-security and framing headers; and
- no cross-origin access from the consumer application.

This specification permits read-only admin inspection. Ontology activation and recall remain service-authorized internal operations, not buttons in the inspection UI.

### 24.3 Inspection scope

While retained, an auditor may inspect:

- frozen fact packet;
- planner request and raw response;
- validated chapter plan;
- writer request and every response;
- rejected candidates and deterministic findings;
- verifier request, response, and verdict;
- accepted internal document with claim ledgers;
- accepted reader projection;
- corpus, ontology, prompt, policy, and model pins;
- attempt, timing, token, and failure metadata; and
- lifecycle state and consent pin.

The interface defaults to metadata. Opening exact content is still routine authorized access, but it is a separate auditable action rather than content automatically rendered in a generation list.

Those are three documents, not one:

- `GET /admin/pattern-generations/:generation_id` returns generation metadata and does not open content;
- `GET /admin/pattern-generations/:generation_id/artifacts` returns the artifact inventory and does not open content;
- `GET /admin/pattern-generations/:generation_id/artifacts/:artifact_id` returns `pattern-admin-artifact` and is the decrypt path.

Every admin route requires a closed `purpose` query parameter. The consumer `patternGenerationStatus` document is not an admin document.

### 24.4 Purpose classes

Every artifact read requires one closed purpose class. The shipped, frozen list is authoritative:

```text
quality_review
safety_investigation
incident_response
retention_audit
```

`legal_privacy_request` and the six-value draft list are withdrawn. A legal-privacy purpose is a future additive amendment if the product needs it.

The administrator cannot enter arbitrary free text that might itself contain user data. A case-reference field, when required, is an opaque internal identifier with a constrained format.

### 24.5 Access audit

Before decrypting any exact artifact, the server writes an access-intent record. After the read, it records success or denial. The event names artifact classes, not content.

An access failure is also retained. The audit path must not depend on successfully decrypting the target artifact.

### 24.6 Download and copy controls

The initial admin interface renders text for investigation but does not provide bulk export, “download all,” clipboard instrumentation, or browser-cached offline access. It sends:

```text
Cache-Control: no-store
Pragma: no-cache
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

The product cannot technically prevent an authorized administrator from copying visible text, so policy and audit—not a false DRM claim—are the control. The interface visibly marks the material as sensitive derived personal data.

### 24.7 Retention-aware behavior

After the 30-day exact-artifact window, the admin API returns `410 artifact_expired` for raw artifacts. It may still show:

- non-content job metadata within 90 days;
- compact provenance while the accepted Pattern remains active;
- the accepted reader document while active; and
- access-history records within 13 months.

It must not reconstruct an expired prompt or draft from hashes or provider logs.

### 24.8 Account deletion and admin audit

Account deletion clears the direct user ID from retained admin-access events. The domain-separated `target_scope_hash`, administrator identity, purpose class, artifact classes, result, and timestamp remain for 13 months to preserve administrator accountability.

The hash cannot be used to fetch product content, reverse the deleted user ID, or join to the ordinary user table. No generation artifact remains decryptable after account deletion.

## 25. Provider configuration, budgets, and rollout controls

### 25.1 Separate Pattern configuration

Pattern generation does not reuse the daily-reading provider tuple implicitly. It has separately pinned settings:

```text
PATTERN_AI_ROLLOUT
PATTERN_PUBLISHER
OPENAI_PATTERN_PLANNER_MODEL
OPENAI_PATTERN_PLANNER_REASONING
OPENAI_PATTERN_PLANNER_PROMPT_VERSION
OPENAI_PATTERN_PLANNER_TIMEOUT_MS
OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS
OPENAI_PATTERN_WRITER_MODEL
OPENAI_PATTERN_WRITER_REASONING
OPENAI_PATTERN_WRITER_PROMPT_VERSION
OPENAI_PATTERN_WRITER_TIMEOUT_MS
OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS
OPENAI_PATTERN_VERIFIER_MODEL
OPENAI_PATTERN_VERIFIER_REASONING
OPENAI_PATTERN_VERIFIER_PROMPT_VERSION
OPENAI_PATTERN_VERIFIER_TIMEOUT_MS
OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS
PATTERN_INPUT_MAX_BYTES
PATTERN_DAILY_PROVIDER_CALL_LIMIT
PATTERN_GENERATION_MAX_AGE_MINUTES
PATTERN_ARTIFACT_RETENTION_DAYS
PATTERN_FAILED_METADATA_RETENTION_DAYS
```

Ontology generation has its own independent tuple and budget:

```text
PATTERN_ONTOLOGY_ROLLOUT
OPENAI_ONTOLOGY_GENERATOR_*
OPENAI_ONTOLOGY_EVALUATOR_*
PATTERN_ONTOLOGY_DAILY_PROVIDER_CALL_LIMIT
```

Every value that influences output is frozen into the encrypted command and compared to compiled supported constants at execution.

### 25.2 Provider secrets

The existing `OPENAI_API_KEY` may be shared as a transport credential, but its presence does not authorize Pattern. Rollout, publisher, model, prompt, policy, ontology, and budget gates must all pass independently.

No provider credential enters an encrypted user artifact, compact provenance, admin response, or log.

### 25.3 Global provider budgets

Runtime Pattern calls use `pattern_provider_daily_usage`, keyed only by UTC date. The ledger records used calls by stage class in bounded integer columns or separate rows without user identity.

The reservation is atomic and consumed immediately before each provider call. Failed, timed-out, and rejected responses still consume a unit. Retries do not receive a refund.

Planner, writer, and verifier share the approved Pattern ceiling unless the operator explicitly configures separate sub-ceilings. Worst-case spend is computable as:

```text
maximum new Pattern jobs per UTC day
× maximum stage calls per job
× pinned input/output token bounds and current provider rates
```

The rollout document must record that calculation before enabling external users.

### 25.4 Queue and concurrency

Pattern uses a dedicated `PATTERN_QUEUE` and `patternlike-pattern-generation-dlq`.

Launch settings use batch size one. Concurrency is capped to the smaller of:

- the approved provider throughput;
- the D1/R2 write budget;
- the maximum daily call budget divided by the minimum recovery interval; and
- the measured rate that preserves acceptable queue latency.

The queue message contains only closed opaque identifiers and a `kind: "pattern"` discriminator. The encrypted command remains in D1.

### 25.5 Rollout values

`PATTERN_AI_ROLLOUT` accepts only:

```text
off | internal | first_open | enabled
```

- `off`: no new AI Pattern claim or provider work. Existing accepted AI Patterns remain readable; cleanup, deletion, revocation, and correction reconciliation continue.
- `internal`: designated internal accounts may grant and generate.
- `first_open`: eligible external accounts enter AI mode when they explicitly grant on Your Pattern. Existing editorial-cohort accounts remain editorial until they opt in.
- `enabled`: every eligible account without an existing editorial-only compatibility hold receives the AI first-open state.

A malformed value fails secure configuration. Pulling the switch to `off` parks queued jobs without decrypting them and prevents in-flight jobs from entering a new provider stage.

## 26. Observability and safe logging

### 26.1 Closed safe-log events

`SafeLogEvent` gains closed Pattern events such as:

```text
pattern_reservation_failed
pattern_dispatch_failed
pattern_stage_retryable_failure
pattern_stage_terminal_failure
pattern_stage_threw
pattern_plan_validation_failed
pattern_candidate_validation_failed
pattern_semantic_verification_failed
pattern_publication_stale
pattern_artifact_cleanup_failed
pattern_chart_reconciliation_failed
pattern_ontology_release_rejected
pattern_ontology_recalled
pattern_admin_access_denied
```

Allowed fields are limited to closed failure classes, stage names, provider/model/prompt versions, latency, token counts, and byte counts. Pattern response hashes, candidate hashes, plan hashes, generation IDs, and other high-cardinality integrity values stay in D1 and the encrypted artifact inventory rather than ordinary logs.

The union has no field for generation ID, user ID, chart ID, chart fingerprint, feature ID, Pattern ID, source fragment, ontology rule, prompt text, prose, request URL, arbitrary error message, or administrator reason text.

### 26.2 Cost and quality metrics

Safe aggregate metrics include:

- reservation counts;
- stage completion and failure counts;
- retry counts by closed failure class;
- stage latency distributions;
- token counts;
- provider-call totals;
- deterministic-validation finding counts by code;
- semantic-verdict counts by code;
- queue age;
- artifact bytes and cleanup lag; and
- ontology regression pass rates.

No metric label is user-scoped. High-cardinality generation identifiers are not sent to ordinary telemetry.

### 26.3 Operational reconciliation

A protected operator report may query D1 for concrete generation IDs when reconciling failures. This is not a log stream and requires administrative authorization. Its results are not persisted to console output.

## 27. Compatibility, migration, and rollout

### 27.1 Keep M4 editorial Pattern intact during migration

The initial M7 implementation does not delete:

- M4 Pattern contracts;
- M4 route logic;
- `PatternContentObject` types;
- content candidates;
- release builder and signing tools; or
- signed release compatibility required by Today.

Instead, the Pattern route selects the consumer mode from durable state.

This avoids making the M7 rollout depend on deleting a subsystem that still supports current users and historical evidence.

### 27.2 Sticky cohort boundary

An account becomes AI-cohort for a chart when a `pattern_generation_claims` row is first reserved. That boundary is durable for the fingerprint.

After that point:

- M4 editorial prose is never used as fallback for the chart;
- disabling rollout does not reveal an editorial interpretation in place of a failed AI job;
- deletion, withdrawal, or supersession does not return the chart to M4; and
- another generation is governed only by the claim rules.

Before that point, first-open rollout may leave the account on the existing M4 path.

### 27.3 Web and Worker compatibility

The M7 web bundle recognizes both M4 editorial and M7 AI Pattern responses during rollout. The Worker continues serving M4 to editorial-cohort accounts.

An older cached web bundle that asks for paginated M4 Pattern against an AI-cohort account receives an explicit compatibility refusal rather than HTML or an M7 document cast into an M4 shape. The service worker version is bumped so the new state client becomes available promptly, but authenticated API responses remain uncached.

### 27.4 Migration deployment order

The safe production order is:

1. merge and deploy read-compatible shared types and contract validation;
2. apply `0007_ai_generated_pattern.sql` remotely and verify foreign keys, row counts, and indexes;
3. deploy the Worker with Pattern rollout `off` and no provider path reachable;
4. deploy the web bundle that understands both M4 and M7;
5. configure Pattern queue, DLQ, R2 permissions, provider tuple, budgets, admin identity boundary, and ontology signing keys;
6. ingest and activate a fully evaluated ontology release;
7. enable `internal` for designated accounts;
8. complete authenticated end-to-end, deletion, correction, and admin-access certification;
9. advance to `first_open`; and
10. advance to `enabled` only after the rollout gates pass.

A migration, deploy, ontology activation, and rollout change are separate evidence gates.

### 27.5 Rollback

Code rollback must preserve read compatibility with rows written by M7. A release incapable of understanding M7 state cannot be deployed after external claims exist.

The operational rollback is therefore normally:

- set `PATTERN_AI_ROLLOUT=off`;
- stop new reservations and provider stage advancement;
- keep accepted Pattern reads, deletion, revocation, cleanup, correction reconciliation, and admin inspection working; and
- deploy a prior M7-compatible Worker if needed.

Database rollback by dropping M7 tables is prohibited after any real user claim exists.

## 28. Test and evaluation design

### 28.1 Contract tests

Contract tests must:

- validate every M7 public, internal, ontology, export, and admin document;
- reject unknown fields and unsupported enum values;
- prove prior contract packages remain byte-for-byte unchanged;
- prove M7 supersession is explicit and bounded;
- validate every OpenAPI status and error shape;
- reject provider packets containing prohibited identity or birth fields;
- validate sparse and dense Pattern documents; and
- validate deleted, superseded, withdrawn, and consumed claim projections.

### 28.2 Deterministic unit tests

Unit tests cover:

- fingerprint hashing and claim identity;
- local feature aliases;
- feature ranking and mandatory thresholds;
- ontology eligibility;
- cluster graph construction;
- sparse-chart policy;
- complete feature accounting;
- plan bounds and compatibility;
- frozen-plan hashing;
- paragraph claim-ledger validation;
- uncertainty requirements;
- prohibited language;
- public projection stripping;
- artifact-envelope AAD;
- retention deadlines;
- lifecycle state transitions; and
- rollout gating before any data decryption or provider work.

### 28.3 Provider boundary tests

Provider tests prove:

- one top-level instructions string;
- exactly one JSON input document;
- strict JSON schema output;
- `store: false`;
- no tools, browsing, file search, code execution, MCP, or background mode;
- exact model, prompt, reasoning, timeout, and token pins;
- safe handling of transport errors and malformed responses;
- provider response hashes over canonical accepted bytes; and
- no raw provider error prose reaches logs or consumer errors.

### 28.4 Integration tests

Using fake planner, writer, verifier, queue, R2, and D1 boundaries, integration tests cover:

- grant plus atomic reservation;
- duplicate grant and reservation replay;
- encrypted command storage;
- outbox recovery after queue-send failure;
- stage-by-stage claims and leases;
- planner retry before freeze;
- writer retries against the same plan hash;
- verifier transport retry against the same candidate hash;
- deterministic rejection and terminal failure;
- successful atomic publication;
- no partial document reads;
- raw artifact retention and cleanup;
- export projection;
- Pattern deletion and cryptographic erasure;
- chart correction and automatic successor reservation;
- consent revocation before every stage;
- critical ontology recall; and
- account deletion coverage.

### 28.5 Concurrency tests

Required races include:

- two first-open consent submissions;
- consent grant versus revoke;
- two manual retry requests;
- duplicate queue delivery for every stage;
- expired-lease reclaim versus original worker completion;
- planner validation freeze versus cancellation;
- writer completion versus locale change;
- verifier completion versus chart correction;
- publication versus Pattern deletion;
- publication versus ontology recall;
- chart correction versus account deletion;
- two reconciler executions for one corrected chart;
- artifact cleanup versus admin inspection;
- export versus Pattern deletion; and
- returning to a previously consumed fingerprint.

Every race must converge through a database invariant or compare-and-swap, not by relying on one expected execution order.

### 28.6 Privacy tests

Privacy tests prove:

- no birth date, local birth time, birthplace, coordinates, birth timezone, user ID, chart ID, raw fingerprint, consent ID, or session material enters a provider packet;
- no personal context source is loaded by Pattern generation;
- local feature aliases cannot be joined to ordinary product identifiers outside the encrypted command;
- exact prompts and drafts are encrypted in R2;
- Pattern content is encrypted in D1;
- logs and telemetry accept only safe closed fields;
- admin access is role-separated and audited;
- export includes only portable Pattern content;
- Pattern deletion removes every exact artifact;
- chart correction removes old prose before the new chart can read Pattern; and
- deletion-manifest completeness fails when any new table, encrypted column, or R2 prefix is unclassified.

### 28.7 Fixed synthetic evaluation corpus

The runtime evaluation corpus is separate from the ontology regression corpus but shares synthetic chart fixtures.

It contains accepted and rejected planner, writer, and verifier cases for:

- every feature class;
- every accuracy class;
- every omission reason;
- duplicate and conflicting chapters;
- uncited prose;
- unsupported source synthesis;
- excessive certainty;
- diagnosis, prediction, fate, and causal language;
- collective versus personal chart confusion;
- essentialist personality verdicts;
- omitted counter-expression;
- adversarial ontology text;
- alias fabrication;
- invented biography or current circumstances;
- locale mismatch; and
- total length and section bounds.

The offline lane freezes candidates and expected findings. A live-provider lane runs only synthetic data and uses the actual prompt builders and validators.

### 28.8 Absolute release gates

The local candidate must demonstrate:

- 100% schema-valid accepted artifacts;
- 100% mandatory-feature accounting;
- 100% claim-ledger references resolving to frozen feature and ontology aliases;
- 0 suppressed-feature leaks;
- 0 prohibited claim classes;
- 0 identity or raw birth-detail leaks;
- 0 untraceable derived syntheses;
- 0 publication after consent revocation, chart change, locale change, or ontology recall;
- 100% no-reroll enforcement across deletion and chart history;
- 100% lifecycle artifact-inventory coverage;
- 100% owner isolation; and
- 100% admin artifact reads with corresponding access events.

Qualitative thresholds—coherence, repetition, warmth, usefulness, and reading level—may block rollout but never replace the hard gates.

### 28.9 Repository verification commands

Before claiming a local implementation candidate, run fresh:

```text
npm ci
npm run typecheck
npm test
npm run test:contracts
npm run build
```

Also run:

- D1 migration smoke validation from the prior production schema shape;
- `PRAGMA foreign_key_check` after migration;
- contract-manifest hash verification;
- production-environment Wrangler dry run;
- Pattern provider offline evaluation;
- synthetic live-provider evaluation under an explicitly approved key and budget;
- R2 artifact cleanup simulation; and
- responsive browser and accessibility acceptance.

## 29. Security and threat model

### 29.1 Prompt injection through ontology or sources

Source fragments and ontology prose are data, not instructions. They appear only as JSON values under a top-level immutable policy. The provider receives no tools or external retrieval capability.

The ontology compiler rejects instruction-like fields outside their declared schema. Runtime writer and verifier prompts explicitly treat every ontology and source value as inert evidence.

### 29.2 Hallucinated chart facts

The model cannot create evidence aliases. Every private claim-ledger reference must resolve to a frozen alias, and every astrological prose unit must cite one or more aliases. The deterministic validator checks named bodies, signs, aspects, houses, degrees, and patterns against the referenced fact attributes.

### 29.3 Unsupported meaning expansion

Every ontology meaning terminates in source-supported nodes. Every runtime derived synthesis is pre-activated in the ontology. The writer may combine authorized meanings only within the frozen plan; it cannot create a new ontology node during user generation.

### 29.4 Cross-user data access

Every D1 lookup is owner-scoped before decryption. R2 object keys are resolved from owner-scoped inventory rows. Admin reads use a separate privileged path and write an access event before decryption.

An opaque generation ID is not authorization.

### 29.5 Stale or replayed provider responses

Stage publication binds response hashes to the owned job, stage generation, frozen plan or candidate hash, provider configuration, and claim token. A late response from a stale lease cannot advance the job.

### 29.6 Queue duplication and worker failure

The D1 job row is the durable outbox and state authority. Queue sends are nudges. Claims use compare-and-swap leases, and every final mutation asserts that the same stage generation still owns the job.

### 29.7 Cost amplification

Global atomic provider budgets, bounded stage retries, one accepted Pattern per fingerprint, no arbitrary rerolls, dedicated queue concurrency, input/output byte bounds, and rollout controls cap the amplification surface.

### 29.8 Sensitive rejected drafts

Rejected drafts receive the same encryption and administrator controls as accepted internal artifacts. They are never exposed to the reader, ordinary support tools, logs, or account export and expire after 30 days unless lifecycle erasure occurs sooner.

### 29.9 Administrator misuse

A dedicated role, separate identity boundary, per-artifact access events, closed purpose classes, no bulk download, no browser caching, and 13-month accountability logs make access visible and bounded. This does not claim to make authorized viewing impossible; it makes the authority narrow and auditable.

### 29.10 Data deletion gaps

Every new user-owned table, encrypted column, and R2 family is registered before rollout. Cleanup uses a durable inventory. Cryptographic key erasure prevents a temporarily undeleted object from remaining readable in the active service.

### 29.11 Backup restore and non-resurrection

“Immediate erasure” in this document describes the active serving database, active wrapped keys, and active R2 access path. Provider-managed database time-travel or disaster-recovery snapshots may retain earlier encrypted bytes for their bounded platform retention window.

Production restore procedures must therefore replay every privacy deletion, chart-correction erasure, and ontology withdrawal that occurred after the selected restore point before the Worker receives traffic. The replay source must be outside the restored snapshot and contain only signed or authenticated non-content lifecycle records. It must not depend on ordinary application logs, which intentionally omit user and generation identifiers.

External rollout is blocked until a restore drill demonstrates that restoring a snapshot from before Pattern deletion cannot make the Pattern readable or eligible for regeneration. If the broader repository does not yet have a deletion-replay ledger that meets this requirement, implementing that ledger is a prerequisite workstream rather than a reason to weaken the deletion claim.

## 30. Retention matrix

| Material | Ordinary retention | Explicit Pattern deletion | Chart correction | Critical ontology recall | Account deletion |
|---|---:|---|---|---|---|
| Active reader Pattern | Until lifecycle event | Erase immediately | Erase immediately | Erase immediately | Erase immediately |
| Compact active provenance | With active Pattern | Erase except minimal tombstone | Erase except consumed claim | Erase except consumed claim | Erase |
| Fact packet and exact prompts | 30 days after terminal job | Erase immediately | Erase immediately | Erase immediately | Erase immediately |
| Plans and raw responses | 30 days after terminal job | Erase immediately | Erase immediately | Erase immediately | Erase immediately |
| Rejected candidates and detailed findings | 30 days after terminal job | Erase immediately | Erase immediately | Erase immediately | Erase immediately |
| Failed-job non-content metadata | 90 days | May erase immediately | May erase immediately | May erase immediately | Erase |
| No-reroll claim/tombstone | Until account deletion | Retain consumed | Retain consumed | Retain consumed | Erase |
| Admin access events | 13 months | Retain bounded audit | Retain bounded audit | Retain bounded audit | Clear user link; retain pseudonymous audit to deadline |
| Aggregate non-user metrics | Per operations policy | Unchanged | Unchanged | Unchanged | Unchanged |
| Ontology release artifacts | Indefinite immutable release history unless legally removed | Not user-scoped | Not user-scoped | Retain recalled release evidence, deny runtime use | Not user-scoped |

## 31. Implementation decomposition

The implementation should proceed as focused workstreams, each with its own tests and review checkpoint.

### 31.1 M7 contracts and shared types

Likely areas:

- `contracts/m7/`
- `contracts/validate_schemas.py`
- `contracts/smoke_check.py`
- `packages/shared/src/m7-types.ts`
- shared exports and contract fixtures

Deliverable: frozen M7 wire and storage-document contracts with no runtime behavior change.

### 31.2 Migration, deletion, export, and crypto registration

Likely areas:

- `db/d1/0007_ai_generated_pattern.sql`
- `db/d1/MIGRATIONS.json`
- `apps/api/src/db/users.ts`
- `apps/api/src/services/deletion-manifest.ts`
- `apps/api/src/services/account-export.ts`
- M7 export envelope and tests

Deliverable: schema and privacy lifecycle foundations, rollout still off.

### 31.3 Pattern consent and claim reservation

Likely areas:

- new Pattern consent DB module or focused additions beside `db/consents.ts`
- `routes/consents.ts` or a dedicated Pattern-consent route
- Pattern claim and job DB module
- idempotency tests

Deliverable: contextual grant, revoke, claim, and state APIs without provider calls.

### 31.4 Ontology ingestion and runtime reader

Likely areas:

- ontology contracts and DB module
- R2 immutable bundle loader
- internal ingestion/recall routes
- signing verification
- active pointer and recall checks

Deliverable: manually supplied synthetic ontology fixtures can be ingested and frozen by runtime jobs. Automated generation remains separate.

### 31.5 Deterministic selection and planning contracts

Likely areas:

- new `packages/pattern-engine/` workspace, recommended to keep pure logic outside Hono and D1;
- selection policy;
- cluster construction;
- planner packet and validation;
- evaluation fixtures

Deliverable: deterministic fact packet and validated plan from synthetic planner outputs.

### 31.6 Provider adapters and stage execution

Likely areas:

- Pattern provider configuration;
- planner, writer, and verifier prompt builders;
- strict provider adapters;
- Pattern queue dispatcher;
- stage claims, retries, budgets, and R2 artifact writing;
- publication transaction

Deliverable: full two-pass asynchronous generation with fake and live synthetic providers.

### 31.7 Web experience

Likely areas:

- replace or refactor `PatternChapters.tsx`;
- add Pattern state, consent, progress, ready, failed, delete, and withdrawn components;
- API client methods and types;
- responsive and accessibility tests

Deliverable: complete reader lifecycle while preserving chart facts.

### 31.8 Correction, cleanup, recall, and reconciliation

Likely areas:

- `routes/birth.ts` post-activation reconciliation;
- Pattern reconciliation service;
- scheduled cleanup and undispatched/expired-lease sweeps;
- ontology recall withdrawal;
- account-deletion checkpoints; and
- privacy-erasure replay support for disaster recovery when the repository does not already provide it

Deliverable: recovery-complete lifecycle with no stale publication or backup resurrection.

### 31.9 Administrative inspection

Likely areas:

- separate admin authentication middleware and hostname;
- read-only admin routes;
- artifact decryption and access auditing;
- small protected admin UI or API-first acceptance harness

Deliverable: full routine inspection during retention, with every access audited.

### 31.10 Automated ontology pipeline

Likely areas:

- source-corpus contract reader;
- generator prompt and provider adapter;
- deterministic ontology compiler;
- independent evaluator;
- fixed-chart regression runner;
- machine signing and internal ingestion client

Deliverable: a source-corpus release can produce, validate, sign, ingest, and activate an ontology version without human record approval.

## 32. Acceptance criteria

The feature is locally complete only when all of the following are evidenced:

1. The M7 contracts, migration, shared types, and OpenAPI validate from a fresh checkout.
2. Existing M4 editorial Pattern remains compatible for accounts that have not entered AI mode.
3. The first-open screen grants a separate Pattern consent and reserves exactly one job.
4. The provider packet contains only generation-local calculated facts, uncertainty, locale, and activated ontology material.
5. Planner output is deterministically validated and frozen before writer execution.
6. Writer retries cannot change the frozen plan.
7. Independent semantic verification cannot edit or publish a candidate.
8. Publication is atomic and rechecks chart, feature set, locale, consent, ontology recall, user state, and claim ownership.
9. No partial or unvalidated Pattern is ever reader-visible.
10. One accepted Pattern consumes one user/fingerprint claim permanently until account deletion.
11. Revocation stops unfinished and future generation but preserves an accepted Pattern.
12. Explicit Pattern deletion erases all content and blocks regeneration for that fingerprint.
13. Chart correction makes the old Pattern inaccessible immediately, erases it, and automatically starts a new job only when standing consent remains active.
14. A return to a previously consumed fingerprint cannot generate again.
15. Critical ontology recall withdraws and erases affected Patterns without permitting reroll.
16. Active Pattern content appears in M7 account export; raw generation artifacts do not.
17. Every Pattern table, encrypted column, and R2 object family participates in account deletion and key rotation.
18. Full administrator inspection is role-separated, retention-aware, and audited per artifact class.
19. The machine-generated ontology pipeline proves source dependency, deterministic compilation, independent evaluation, regression, signing, and activation.
20. All hard evaluation and privacy gates pass with zero exceptions.
21. Root tests, contracts, build, migration smoke, Wrangler dry run, browser accessibility, and responsive acceptance are green.
22. Production migration, deploy, ontology activation, rollout, and real-account certification remain separately reported evidence gates.
23. A disaster-recovery restore drill proves that pre-deletion snapshots cannot resurrect Pattern content or reset a consumed claim.

## 33. Resolved decisions and intentional non-decisions

This specification contains no product-design placeholder requiring implementation to choose among alternatives.

Resolved:

- unique per-chart AI Pattern;
- contextual first-open consent;
- chart facts only;
- layered document;
- bounded-hybrid planning;
- validated two-pass generation;
- independent semantic verification;
- durable asynchronous execution;
- bounded retries;
- one accepted artifact per fingerprint;
- accepted artifact retained after consent revocation;
- permanent no-reroll deletion;
- permanent erasure on chart correction;
- automatic corrected-chart generation under standing consent;
- closed interpretation ontology;
- fully machine-authorized ontology releases;
- curated-source boundary out of scope;
- traceable model creativity;
- minimal reader provenance;
- full routine authorized admin inspection;
- 30-day exact-artifact retention;
- 90-day failed metadata retention; and
- 13-month administrator-access audit retention.

Intentionally left to implementation-time measurement, but bounded here:

- exact model identifiers, provided they are pinned and pass evaluation;
- exact queue concurrency, provided it stays under the approved cost and reliability gates;
- exact deterministic ranking weights, provided they are versioned and satisfy the fixed-chart coverage rules;
- exact UI ornamentation, provided the state semantics and accessibility contract remain unchanged; and
- exact daily provider-call ceiling, provided the documented worst-case spend is approved before rollout.

These are configuration and calibration values, not permission to change the architecture or product behavior.

## 34. Repository evidence reviewed

This design was refined against the current implementation of:

- M4 Pattern route, response, matcher, content reader, candidate catalog, release builder, shared types, contracts, web renderer, and natal-feature storage;
- M5 constrained-model command freezing, queue reservation, encrypted jobs, provider adapter, prompt posture, deterministic candidate validation, evaluation corpus, provider budgets, publication, and factual invalidation;
- M6 consent, export, deletion, context, encryption, safe-log, and account lifecycle systems;
- the current D1 migration ledger through `0006_usr05_topic_exclusions`;
- the current Product and v0.5 platform contracts; and
- the production-shaped Cloudflare Worker configuration and queue model.

The central refinement from the earlier baseline is that Pattern should not be designed as a new greenfield AI subsystem. It should preserve the M4 deterministic feature authority and adopt the M5 frozen-command, encrypted-outbox, claim-lease, strict-provider, deterministic-validation, atomic-publication, and evaluation patterns—while remaining a separate consent purpose, queue, budget, document lifecycle, contract package, and no-reroll claim domain.

## 35. Specification self-review

The 2026-08-16 amendment writes the product-spec restatement this section claimed was already done, and reconciles the frozen enums this document had listed incorrectly. After that amendment, the remaining operator questions are administrator identity (Access versus a separate OIDC tenant) and whether a later additive purpose class is needed for legal-privacy requests.

This document was checked for:

- unfinished markers and unassigned decisions;
- contradictions with the approved product decisions;
- accidental reuse of daily-reading AI consent;
- mutation of frozen M4, M5, or M6 contracts;
- missing deletion, export, key-rotation, or R2 classifications;
- publication races involving consent, chart correction, locale, recall, and account deletion;
- implicit human review inside the machine-authorized ontology pipeline;
- model-originated astrological authority outside the curated corpus;
- reader-facing evidence that contradicts the selected minimal-provenance design;
- regeneration paths that would bypass the one-Pattern rule; and
- operational values that were left unbounded.

No unresolved product choice remains. The next step after approval is a separate implementation plan, not direct coding from this document.
