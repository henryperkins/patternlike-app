# Pattern-Like Astrology App
## Product, UX, Data, and Platform Design Specification

- **Version:** 0.6
- **Date:** August 16, 2026
- **Status:** Current product and engineering specification
- **Supersedes:** the Your Pattern portions of v0.2 that v0.5 left in force, and the Pattern-scoped sentences of v0.5 named below
- **Calculation authority:** Swiss Ephemeris
- **Prose authority:** a configured OpenAI model, under explicit consent, within supplied facts
- **Architecture profile:** Cloudflare-first, Fly.io calculation service, WordPress.com editorial control plane retained as legacy infrastructure for Today and for accounts still on the editorial Pattern catalog

> The app presents private psychological timing as a sequence of natal patterns, active cycles, and a calculated daily sky. Celestial calculations establish eligibility and supply every fact. A configured model writes the language of a daily reading and of an AI-generated Pattern, and may not calculate, invent, or interpolate a fact. User context may rank, frame, or schedule a valid daily reading, but it may not alter chart facts or be presented as something astrology independently discovered. Your Pattern uses no personal context.

## 0. How this version relates to v0.5 and v0.2

v0.5 amended daily-reading generation and left every other v0.2 section “in force exactly as published.” Those leftover sections still describe Your Pattern as a reviewed editorial catalog with open chapter evidence. That description is false for the AI-generated Pattern product, and it is the document that outranks both M7 design documents where they disagree.

v0.6 restates **sections 2 and 4** in full, adds **Pattern generation** and the **export successor** under section 7, restates the **API surface** in section 9, and adds a **Pattern publication** clause to section 10. Every other section of v0.5 — and every v0.2 section v0.5 already replaced — remains in force exactly as published.

`spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` and `…_v0.2.md` are kept unedited. v0.2 remains a truthful record of the editorial-assembly architecture. v0.5 remains the daily-reading contract.

The inspectability and second-model language below is the language already shipped in `apps/web/PRODUCT.md`. This version does not invent a third formulation.

The engineering decisions that reconcile the frozen `contracts/m7` package with the 2026-08-14 design are recorded in `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md`. This product specification states the reader-facing contract; that amendment states the wire and authorization contract.

## 2. Product definition

The app combines stable natal patterns, temporary developmental cycles, today's most relevant expression, and a visible timeline. The interface is plain-language first. Calculated chart facts, uncertainty, consent, and data controls are inspectable. AI-written Pattern chapters do not expose claim-level evidence to the reader.

### Primary navigation

| Surface | Purpose | Required elements |
| --- | --- | --- |
| Today | One coherent daily chapter | Primary theme, supporting influence, reflection, cycle phase, Why this? |
| Your Pattern | One private interpretation of the active natal chart | Four to six core chapters, tensions, counter-expression, compact provenance, irreversible deletion |
| Timing | Active and upcoming cycles | Start, exact pass(es), end, phase, related readings |
| Time Travel | Reconstruct a selected date | Dominant cycles, phase state, saved context, comparison to present |
| Context & Privacy | User control | Permissions, source freshness, memory, export, deletion, AI settings |

Your Pattern is a stable, private, model-written artifact generated once for one accepted chart fingerprint. It is not a chat response, a daily forecast, a professional diagnosis, a prediction, a deterministic personality verdict, or an automatically updating profile. Accounts that have not entered the AI path continue to see the historical editorial catalog.

## 4. Experience design

The design should feel private, quiet, and precise rather than cosmic, predictive, or gamified. It uses restrained motion, generous whitespace, a readable serif for interpretations, sans-serif for controls, and monospaced technical evidence.

### Core screen requirements

| Screen | Primary content | Key interaction | Failure/uncertainty treatment |
| --- | --- | --- | --- |
| Today | One major cycle and at most one supporting influence | Save, reflect, open evidence | An unavailable reading is an honest unavailable state; never generic or stale prose |
| Cycle detail | Long-form phase-aware interpretation | Move across exact passes and related readings | Expose missing birth-time effects |
| Your Pattern | One private AI-generated document, or the editorial catalog for accounts that have not entered the AI path | Generate once; delete permanently; inspect chart facts and data controls | Do not fill gaps with generic Sun-sign copy; do not fall back to editorial chapters; do not expose claim-level “Why this?” on AI-written paragraphs |
| Timing | Active, approaching, exact, reconsidering, integrating | Filter by domain and duration | Show calculation status and last refresh |
| Time Travel | Cycle state for a chosen date | Compare date to now | Distinguish saved context from retrospective reconstruction |
| Privacy center | All active sources and allowed uses | Pause, revoke, delete, reset personalization | Revocation takes effect before the next generation of that kind |

### Inspectability

**Inspectable by default** continues to apply to calculated chart facts, uncertainty, consent, and data controls. AI-written Pattern paragraphs do not carry a claim-level “Why this?” disclosure. The chart facts, uncertainty, and data controls remain inspectable.

The product may continue to say **Calculated, not invented** with this explanation: chart facts are calculated; interpretation is model-written within a closed, traceable meaning system.

The product commitment for this surface is:

> Private by design. Calculated facts are inspectable. Generated interpretations are bounded, versioned, and auditable.

The prior claim that every reader can inspect the evidence and editorial sources behind every Pattern paragraph is removed for the AI-generated Pattern.

## 7. Core workflows — Pattern generation and export

v0.5 section 7 remains the daily-reading generation contract. This section adds Your Pattern and restates export and deletion so an accepted Pattern has a home.

### Pattern generation

Your Pattern is a separate publication contract: a planner pass, a frozen plan, a writer pass, deterministic validation, and an independent semantic verifier, published only as a complete document.

There is no reviewed-copy fallback, no previous-Pattern reuse, no alternate model, and no editorial-catalog substitution when generation is unavailable or invalid. A Pattern that cannot be produced and validated says so honestly instead.

Sending anything to a model requires an explicit consent for that purpose. Daily readings use AI-synthesis consent. Your Pattern uses a separate Pattern-generation consent. Both are separate from research and model-training consent and are revocable at any time. Revoking stops future generation of that kind; it does not rewrite a reading or Pattern already published.

An accepted Pattern is immutable for its chart fingerprint. Model upgrades, prompt changes, a new ontology version, feedback, locale changes, check-ins, life-event changes, consent revocation, ordinary preference changes, and repeated requests do not regenerate it. Only a different active chart fingerprint is eligible for a new Pattern. Deleting an accepted Pattern is permanent: another cannot be generated from the same chart. A critical ontology recall may erase an accepted Pattern and does not grant another generation for that fingerprint.

The model receives calculated natal features, the accuracy label, the derived uncertainty, the confirmed locale, and the activated interpretation ontology. It never receives the birth instant, birthplace, coordinates, scheduling zone, account identifiers, journal, check-in, or life-event text.

### Export and deletion

1. The reader requests export or deletion from the privacy center.
2. Export composes a portable archive whose M7 successor includes an explicit `patterns` section. That section carries only the active accepted Pattern and compact provenance. Raw prompts, rejected drafts, validator discussions, and administrative artifacts are not portable.
3. Deletion of an accepted Pattern is permanent and consumes the chart-fingerprint claim. Deletion of the account removes user-owned Pattern rows and destroys the per-user data-encryption key. Control-plane ontology tables and both provider-usage ledgers are not user-owned. Administrator access events are nullified, not deleted.
4. A disaster-recovery restore must replay every privacy deletion, chart-correction erasure, and ontology withdrawal that occurred after the selected restore point before the Worker receives traffic. A pre-deletion snapshot must not make a deleted Pattern readable or eligible for regeneration.

## 9. API surface

v0.2 section 9 remains the baseline table. M7 adds these consumer surfaces and does not mutate the M4 editorial `GET /v1/pattern` document for accounts still on the editorial catalog:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /v1/pattern-state | Closed Pattern state, including `editorial_catalog` for accounts that have not entered the AI path |
| GET | /v1/consents/pattern-generation | Current Pattern-generation terms and grant |
| DELETE | /v1/consents/pattern-generation | Revoke Pattern-generation consent |
| POST | /v1/pattern-generations | Grant or observe consent and reserve generation |
| GET | /v1/pattern-generations/{generation_id} | Owner-scoped generation status |
| GET | /v1/pattern | One immutable AI Pattern document for the AI cohort; the frozen M4 document for the editorial cohort |
| DELETE | /v1/pattern | Permanently erase the accepted Pattern |

Internal ontology ingestion, recall, and reconciliation, and administrative inspection, are not consumer surfaces. They are specified in the M7 OpenAPI amendment and are not authorized by the consumer session.

All mutating endpoints require an idempotency key.

## 10. Pattern publication and the second-model exception

v0.5 section 10 remains the daily-reading assembly contract, including the rule that there is no human review of daily-reading prose and no second model reviewing the first daily reading.

Your Pattern is a separate publication contract. Publication of a Pattern requires deterministic validation **and** an independent semantic verifier. The verifier is not an editor: it cannot rewrite, patch, or approve conditionally. A Pattern that fails either gate is not partially published, not repaired, and not replaced by editorial copy.

This is the Pattern-scoped exception to “no second model.” It does not weaken the daily-reading rule.

## 15. Launch acceptance for Your Pattern

v0.5 section 15 remains the daily-reading launch bar. A deployment that serves AI-generated Pattern to any external reader is acceptable only when all of the following also hold:

1. no published Pattern contains a placement, aspect, house, or birth-time-sensitive claim that is absent from its supplied facts;
2. every astrological statement in a published Pattern resolves through the activated ontology to a calculated natal feature;
3. Pattern-generation consent was explicit, current at reservation and at execution, and is a different kind from `ai_synthesis`;
4. one reader and one chart fingerprint produce at most one live Pattern under first-open, retry, chart-correction, and duplicate-delivery races;
5. an unavailable or rejected generation produces an honest failed or unavailable state, never editorial chapters and never a previous Pattern;
6. the reader can inspect the calculated chart facts, uncertainty, consent, and data controls, and cannot inspect claim-level Pattern evidence;
7. deleting an accepted Pattern consumes the claim and cannot be undone by asking again;
8. account export includes the accepted Pattern in a `patterns` section and omits prompts, drafts, and administrative artifacts; and
9. a restore drill has proved that a pre-deletion snapshot cannot resurrect Pattern content or reset a consumed claim.

An internal-only synthetic ontology may be used to produce a Pattern for a designated internal account. It is not evidence that the machine-generated ontology pipeline has passed, and it is not a route to external readers.

## 16. Open decisions

v0.5 section 16 remains in force. This version adds:

1. **Administrator identity for Pattern inspection.** The role is `pattern_generation_auditor`. Assignment is either a separate administrator identity provider or a Cloudflare Access policy. The AI Gateway Access refusal does not decide this. Until the operator picks one, Slice C cannot implement the session.
2. **A legal-privacy purpose class.** The shipped administrator purpose list is `quality_review`, `safety_investigation`, `incident_response`, and `retention_audit`. A `legal_privacy_request` purpose is a future additive amendment if the product needs it; it is not in the frozen 0.7.0 enum.

## Implementation note

This document is normative for the sections it restates. Where implementation and specification disagree and the implementation is faithful to the approved design, the specification is what needs correcting; such cases are tracked in `docs/reviews/`. The 2026-08-16 M7 spec-artifact amendments are the engineering companion to this version.
