# Pattern-Like Astrology App
## Product, UX, Data, and Platform Design Specification

- **Version:** 0.5
- **Date:** August 11, 2026
- **Status:** Current product and engineering specification
- **Supersedes:** v0.2, for the sections amended below
- **Calculation authority:** Swiss Ephemeris
- **Prose authority:** a configured OpenAI model, under explicit consent, within supplied facts
- **Architecture profile:** Cloudflare-first, Fly.io calculation service, WordPress.com editorial control plane retained as legacy infrastructure

> The app presents private psychological timing as a sequence of inspectable natal patterns, active cycles, and a calculated daily sky. Celestial calculations establish eligibility and supply every fact. A configured model writes the language of a daily reading and may not calculate, invent, or interpolate a fact. User context may rank, frame, or schedule a valid interpretation, but it may not alter chart facts or be presented as something astrology independently discovered.

## 0. How this version relates to v0.2

v0.5 amends v0.2. Sections **3, 7 (daily reading generation), 10, 11, 12, 14, 15, and 16** are restated here in full and replace their v0.2 counterparts. Every other section of v0.2 — the executive architecture decision, product definition, experience design, the automatable data-source model, platform architecture, birth onboarding, content publication, export and deletion, data architecture, the API surface, scale and migration triggers, the data-source registry summary, and the technical references — remains in force exactly as published, and is deliberately not restated here so that the two documents cannot drift into disagreeing about text neither change touched.

`spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md` is kept unedited. It is a truthful record of the editorial-assembly architecture, which produced readings that are still stored and still readable.

## 3. Product and interpretation contract

**Calculated, not invented** is unchanged as the governing promise, and what enforces it has changed.

1. Swiss Ephemeris, normalized through versioned application contracts, establishes chart facts, the daily sky, and interpretation eligibility. No other component may produce an astrological fact.
2. A configured model writes the prose of a daily reading. It receives a closed set of pre-rendered facts and may state a placement, aspect, house, degree, phase, timestamp, or date only when it appears in one of them.
3. Every astrological claim in a published reading resolves to the calculated fact cited beside it. A paragraph may instead be carried by permitted personal context, and then it claims nothing about the sky and is recorded as such.
4. Personal context may shape relevance, emphasis, tone, questions, and suggestions. It may never become evidence for an astrological assertion, and it is never presented as something the calculation discovered.
5. Unknown and approximate birth times suppress houses, angles, and time-sensitive Moon claims. The suppression list crosses to the model, and a reading that would need a suppressed feature says what it cannot say instead.
6. Publication requires deterministic validation. A candidate that fails one check is not partially published, not repaired, and not replaced by standing copy.

### What v0.2 guaranteed and v0.5 does not

These are removed deliberately, and the removal is the substance of this version:

- reviewed editorial fragments no longer supply the language of a new reading;
- an active signed content release is no longer a prerequisite for generating one;
- dual author/approver control no longer governs the prose a reader sees; and
- reviewed deterministic copy is no longer a fallback when generation is unavailable or invalid.

Nothing else was traded. Calculation authority, eligibility partitioning, consent, data minimization, envelope encryption, structured output, deterministic validation, immutable job identity, atomic publication, bounded retries, and the provenance record are unchanged or stronger.

An unavailable reading is now an honest unavailable state. That is the intended consequence: a reader who cannot be told something true about their own day is told that, rather than being shown copy written for nobody.

## 7. Core workflows — daily reading generation

Two transactions, never one, exactly as in v0.2. What each transaction contains has changed.

### Reservation

A scheduled invocation or an authenticated first open builds one immutable `GenerateDailyReadingCommandV2` and reserves a pending reading row that points at it. The command pins, and is encrypted with the reader's own key:

- reading identity, local date, revision, reason, and command generation;
- scheduling zone, locale, and their confirmed provenance;
- the active chart, its fingerprint, contract, calculation versions, and uncertainty;
- the cycle-scan and daily-sky request/response identities and the ordered facts selected from each;
- the AI-synthesis consent id, policy version, and its validity at freeze time;
- the selected context source ids, consent ids, permitted lanes, normalized hashes, and encrypted snapshots;
- the provider, exact model, reasoning level, prompt version, output schema, selection policy, and validation policy; and
- the canonical input manifest hash and the derived `generation_input_id`.

Only an opaque `{job_id, reading_id}` crosses the queue. The durable row is the outbox; the queue is a nudge.

### Execution

A single-message consumer claims the job by compare-and-swap, rechecks consent and context eligibility against live state, re-runs the one eligibility-and-identity entry point over the frozen inputs, and compares both hashes before any provider request. A mismatch is a terminal integrity defect and makes no call.

At most one provider request is made per delivery, with a hard timeout, a hard output ceiling, a hard context-packet ceiling, `store: false`, no tools, no browsing, no retrieval, and a strict output schema. Before calling, execution requires enough claim time left for the timeout plus a publication margin; otherwise it releases the job without calling.

A returned candidate is validated deterministically and published in one guarded batch that asserts the job, claim token, command generation, and pending reading state. At most one candidate can win. A late or duplicate response that loses any assertion is discarded without comparison.

### The calculated daily sky

`POST /v1/daily-sky` supplies the facts that make a reading daily. The API resolves the reader's local day as a half-open UTC interval anchored at local noon, using the pinned IANA database and a closed disambiguation rule, and sends no user id, chart id, birth instant, birthplace, or zone name. The response carries ordered, opaque-id facts for anchor positions, lunar phase, exact transit-to-natal contacts inside the interval, sign ingresses and exact collective events, and — only where accuracy permits — transit house placements.

Anchor positions and lunar phase are always present when calculation succeeds. A day with no eligible cycle is therefore still a factual day, which is what makes removing the reviewed fallback possible at all.

### Failure

Provider unavailability, calculation unavailability, and daily-sky unavailability retry the same command on the existing schedule. An invalid or refused candidate gets one fresh delivery. An exhausted daily provider budget makes no call and gets no retry. Configuration, authentication, model availability, consent, context eligibility, identity mismatch, and unsupported policy are terminal.

A scheduler-replaceable failure may install at most two automatic replacement commands. After the third, the reading is unavailable for that local day and the interface stops offering a control that cannot succeed.

There is no alternate model, no previous-day reuse, no deterministic copy, and no editorial-release fallback on this path.

## 10. Reading assembly and the AI boundary

### What crosses the boundary

The provider request carries the birth-accuracy label, the derived uncertainty and suppression list, eligible calculated natal facts, longer transit cycles, the calculated daily sky, the confirmed local date and locale, an optional stored domain preference, the personal context the reader enabled, recent reading excerpts for repetition control, and the composition contract.

### What never crosses it

Email, name, application user id, provider account id, session id; the birth date, time, instant, place, coordinates, or scheduling zone; authentication tokens, keys, connector credentials, cookies, or encryption material; audit events, request logs, exception details, queue leases, or storage identifiers; and any source that is disabled, paused, revoked, stale, or ineligible for the lane it would occupy.

Raw birth instant and coordinates are the most identifying fields in the account and remain inside the encrypted calculation boundary. `store: false` is not treated as a mitigation for sending them.

### Consent

`ai_synthesis` is a distinct, explicit, account-level consent. It is not `research`, not `model_training`, and granting it enables neither. Before the first call the reader is shown the processor, the exact categories that may be sent, the purpose, the applicable policy version, the fact that enabled free text can name people and places and is not claimed to be anonymous, the fact that provider-side storage is disabled but that abuse-monitoring retention may still apply, and how to withdraw.

Consent is checked twice: when the command is frozen, and again after the queue claim before any private content is sent. Withdrawal after reservation therefore prevents the call. Withdrawal stops future processing; it does not erase a reading already published, for which export and deletion remain the controls.

### Allowed-use composition

For each candidate signal and use, eligibility is the intersection of the signal's declared uses, the active source consent's uses, and the closed M5 supported set. One lane is pinned per selected signal, and execution proves that exact lane is still present in both arrays before the shared eligibility partition runs. `ai_synthesis` is the outer purpose consent; it is not a lane and cannot make an ineligible signal eligible.

### Untrusted text

User-authored text is serialized as data inside a closed object. It cannot add instructions, change the output contract, enable tools, or override the system policy. A candidate that echoes an instruction found in that text is rejected by the deterministic validator, and the evaluation corpus keeps a profile whose only purpose is to prove it.

### Validation

Publication requires all of: exact schema conformance with closed objects; correct echoed date, locale, role order, paragraph count, and length bounds; every fact and context reference present in the frozen input and permitted for that unit's lane; a calculated fact behind the lead and behind every unit that makes an astrological claim; no body, sign, aspect, house, degree, phase, or timestamp outside the supplied facts; uncertainty-required features suppressed or qualified; collective facts not described as uniquely personal; personal context not described as an astrological discovery; no prompt, schema, identifier, or private-source leakage; no diagnosis, causal medical claim, guarantee, fatalistic prediction, or instruction to replace professional advice; and agreement between the canonical hashes and evidence counts.

There is no human review of prose and no second model reviewing the first.

### Provenance

Every published reading carries an evidence graph recording the calculated facts behind each paragraph and whether each is personal or collective, the categories of context used and the lane each was permitted, the provider and exact model, the prompt, selection, validation and calculation versions, the ephemeris and time-zone database versions, token counts, the provider request id, the integrity hashes, and the validation result. It does not store the prompt or repeat the reader's own text.

The reader sees this in three progressively technical layers. A quiet, always-present line on the reading itself says that a model wrote it.

## 11. Security, privacy, and governance

v0.2's controls are unchanged: envelope encryption with per-user data keys, AAD binding every payload to its subject, table, column, record, and key version; least-privilege service tokens; fail-closed configuration; and export and deletion as first-class product actions.

v0.5 adds:

- the provider API key exists only as a deployed secret, never as a checked-in variable;
- the exact model must be verified against the authorized account's live model endpoint before it may gate production configuration, and again for every later model change;
- a required, operator-approved ceiling on provider calls per UTC day, consumed atomically before each call, with no unlimited or unset production mode;
- logs limited to request id, provider and model version, timing, token counts, typed result class, and hashes — the prompt, the context, the birth data, and the prose are never logged; and
- a versioned evaluation corpus that a model, prompt, selection-policy, or validation-policy change must pass before deployment.

Consent revocation, source disablement, and account deletion are the reader's controls over all of this, and each is reachable from the privacy surface without hidden state.

## 12. Reliability and observability

The durable outbox, compare-and-swap claim, at-least-once queue semantics, and idempotent reservation from v0.2 are unchanged, and now protect a nondeterministic prose step. Because two legitimate deliveries against one frozen command can return different candidates, the publication compare-and-swap — not textual comparison — is what makes exactly one of them the reading.

Operational metrics are limited to generation counts, queue age, latency, attempts, token use, validation and failure classes, model and prompt versions, call-budget consumption, and hash-only integrity fields. Alerting covers growing queue age, sustained provider failures, validation-rate change, generation latency, and unexpected token growth. Prompt, context, and prose logging is prohibited.

## 14. Delivery sequence — Milestone 5

Milestone 5 replaces "optional intelligence" as v0.2 described it. It is not an optional layer over an editorial product; it is the daily reading's publisher.

M5 delivers: the M5 contract family; the calculated daily-sky endpoint and its ephemeris goldens; one pure constrained-input compiler shared by reservation and execution; the empty-state storage migration; the configured provider boundary; frozen V2 commands; centralized failure and replacement policy; validated atomic publication; explicit factual invalidation and repair; bounded hybrid scheduling; the consent API and dual-version product projections; the reader experience; and the evaluation gates.

Content-release tables, objects, signing configuration, ingestion routes, and historical audit records remain in place as legacy infrastructure. They cannot influence a V2 command or a v5 read. Their removal is a later migration with its own retention and rollback review.

## 15. Launch acceptance criteria

A deployment is acceptable when all of the following hold:

1. no published reading contains a placement, aspect, phase, date, degree, house, or birth-time-sensitive claim that is absent from its supplied facts;
2. every astrological statement resolves to cited calculation evidence, and every paragraph that does not is recorded as context-carried;
3. all personal context used was explicitly consented, eligible at execution, and used only in a lane it was permitted;
4. one reader and one local day produce at most one live reading under scheduler, first-open, retry, and duplicate-delivery races;
5. an unavailable provider or a rejected candidate produces an honest unavailable state, never generic or stale prose;
6. the reader can inspect the calculated facts, the categories of context, and the exact generation configuration behind their reading;
7. no request, log line, or stored operational field contains a birth instant, birthplace, coordinate, scheduling zone, account identifier, or credential;
8. the evaluation corpus passes offline and against the live provider at the exact deployed versions; and
9. readings published by the earlier editorial pipeline remain readable and unmodified.

## 16. Open decisions

1. **Removal of the editorial control plane.** The content-release infrastructure is retained but inert for new readings. Whether to retire it, and on what retention terms, is undecided.
2. **M4 context sources.** The publisher consumes every eligible source present when it runs. Journals, check-ins, and connectors remain unimplemented, and the privacy surface exposes only categories that genuinely exist. No provider-specific ingestion path will be added for them.
3. **Provider routing.** Direct provider calls keep the initial data path small. A gateway may be evaluated later without changing the provider-neutral adapter boundary.
4. **Reading language.** The deterministic validator's rules — the body, sign,
   aspect, phase, and house vocabularies, the month names, the safety and
   personalization rules, the uncertainty terms — are English. A confirmed
   locale it cannot judge is therefore refused before a command is frozen,
   rather than publishing prose nothing verified. Supporting another language
   means translating the rule tables, not widening the list. Until then the
   product answers a non-English reader honestly instead of quietly.
5. **Consent policy versioning.** One policy version is implemented. When a second is added, the consent read must also report which version the live grant is under, so a reader holding the older grant is not shown the newer category list as though they had agreed to it.
6. **Shared-library licensing.** Unchanged from v0.2: `packages/shared` is imported by the AGPL calculation service, and that boundary remains the open legal question.

## Implementation note

This document is normative for the sections it restates. Where implementation and specification disagree and the implementation is faithful to the approved design, the specification is what needs correcting; such cases are tracked in `docs/reviews/`.
