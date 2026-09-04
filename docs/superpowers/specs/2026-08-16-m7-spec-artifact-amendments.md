# M7 Spec-Artifact Amendments

**Date:** 2026-08-16

**Status:** Approved decisions for remaining M7 work. The 2026-08-14 design is
amended in place where this document says so. `contracts/m7` stays at
`schema_version: 0.7.0`; every change below is additive or is a design edit
that yields to the already-frozen wire.

**Subject:** [`docs/reviews/2026-08-16-m7-unimplemented-spec-artifacts.md`](../../reviews/2026-08-16-m7-unimplemented-spec-artifacts.md)

**Normative authorities after this amendment:** the approved 2026-08-14 M7
design, this amendment, and the frozen `contracts/m7` wire documents.

This document does the spec work the review inserted in front of slices A–D.
It does not implement a publisher, an ontology pipeline, administrator OIDC,
or a restore drill.

## Decision rule

Where the 2026-08-14 design and the shipped `contracts/m7` / `0007` freeze
disagree, **the freeze wins**, unless a real product reason exists to break
0.7.0. Additive optional properties and new documents are recorded in the
manifest `amendments` array. Required fields, `$id`s, and existing enum
members do not change.

The product specification outranks both design documents. v0.6 is that
amendment.

> **Retirement note (2026-09-04).** The v0.6 product-spec restatement has been
> removed from `spec-bundle/`; its immutability rule was superseded by
> `2026-08-29-pattern-source-regeneration-design.md`, and its Your Pattern
> language lives in `apps/web/PRODUCT.md`. The authorities are now the
> 2026-08-14 design as amended here and by the regeneration design, plus the
> frozen `contracts/m7` and `contracts/m9` wire documents. Section 1 below
> records the decision as it was made.

## Settled findings

### 1. Product specification — v0.6

**Decision.** Your Pattern is restated in product-spec v0.6. The language is
the language already shipped in `apps/web/PRODUCT.md`:

- AI-written Pattern chapters do not expose claim-level evidence. Inspectability
  is the chart facts, uncertainty, consent, and data controls.
- Your Pattern is a separate publication contract: planner, frozen plan, writer,
  deterministic validation, and an independent semantic verifier, published
  only as a complete document.
- Daily readings use `ai_synthesis`. Your Pattern uses `pattern_generation`.
- There is no editorial fallback, no previous-Pattern reuse, and no reroll
  after a successful publication or after deletion.
- Account export carries accepted Patterns in a `patterns` section.

v0.5 section 10 remains the daily-reading contract. The sentence “there is no
second model reviewing the first” is scoped to daily readings. Pattern is the
exception.

Until v0.6, the remaining slices would have implemented a product the
normative specification rejected. That is no longer true.

### 2. Ontology authorization — honesty, provenance, and §23.9

**Decision.** The evaluation document tells the truth. Authorization is a
signed provenance marker on the release, not a lie in the three booleans.

- `pattern-ontology-evaluation` keeps its required booleans and `verdict`.
  `verdict: "pass"` still requires `unevaluated_fixture_count === 0`. The
  three booleans are **not** required to be true for that verdict. A
  synthetic internal release ships `evaluator_passed: false` and
  `regression_passed: false`.
- `pattern-ontology-release` gains an optional `provenance` object:

  ```text
  origin: synthetic_internal | machine_pipeline
  authored_by?: string
  reviewed_at?: date-time
  ```

- Absence of `provenance` is read as **internal-only**. Slice B must
  positively assert `origin: "machine_pipeline"`.
- §23.9 “authorized for external readers” means all three of: provenance
  origin is `machine_pipeline`, `evaluator_passed` is true, and
  `regression_passed` is true. The compiler continues to accept a truthful
  internal attestation. Reservation, not compilation, is the containment
  gate.
- Optional `evaluation_report_hash` and `regression_report_hash` land on
  the evaluation object so ingest can verify the hashes §23.9 already
  named. Slice A leaves them absent. Slice B populates them.

This is the Slice A / Slice B decision, ratified here so the first author
does not invent a third shape. The valid evaluation fixture that attests
all three pipeline booleans remains a **schema example**, not production
authorization evidence.

### 3. Ontology record classes — shipped flattened record

**Decision.** `pattern-ontology-record.schema.json` is authoritative.
§23.3 is amended to that flattened record.

Class-specific requirements are **compiler policy**, not new required
schema fields:

| Class | Compiler requires | Compiler refuses |
|---|---|---|
| `source_supported` | non-empty `source_fragment_ids`; `input_meaning_ids` empty; `transformation_class` null | empty source termination |
| `derived_synthesis` | at least two `input_meaning_ids`; non-null `transformation_class`; acyclic graph ending in `source_supported` | a missing input; a cycle |
| `expression_guidance` | no body, sign, house, aspect, life event, diagnosis, prediction, or psychological assertion in `normalized_proposition`, `tensions`, or `counter_expressions` | any astrological proposition |

`normalized_proposition` is the shipped field for every class, including
what §23.3 called `derived_proposition`. `prohibited_claims` is the shipped
field for what §23.3 called `prohibited_extensions`. The design-only fields
(`expression_range`, `uncertainty_compatibility`, `entailment_rationale`,
`compatible_feature_relationships`, `evaluator_verdict`) are **not** added.
Adding them as required would break the freeze. Adding them as optional
would invent a third shape the first Slice A author would have to guess.

Valid fixtures for `derived_synthesis` and `expression_guidance` are Slice A
authoring work against this flattened record, not a schema change.

### 4. `purpose_class` — shipped four-value list

**Decision.** The shipped list is authoritative:

```text
quality_review
safety_investigation
incident_response
retention_audit
```

§24.4 is amended to that list. The six-value design list is withdrawn.
`legal_privacy_request` is a future additive amendment if the product needs
it; Slice C cannot add it without that amendment. Do not implement
administrator identity on top of two owners of this enum.

### 5. Reservation reason — two named enums

**Decision.** There are two enums, not one.

`generationReason` (consumer request, `POST /v1/pattern-generations`):

```text
first_open | first_open_retry | failed_attempt_retry
```

`reservationReason` (encrypted command and `0007` CHECK):

```text
first_open | first_open_retry | failed_attempt_retry | chart_correction
```

`chart_correction` is a real reservation reason and must not appear on the
consumer request. `common.schema.json` gains the four-value `reservationReason`
def so the command and the CHECK have one named home. §10.1 is amended to
`reservationReason`. §19.4 keeps `generationReason`.

`chart_correction` at `PATTERN_AI_ROLLOUT=internal` is **staff-gated**.
Reservation for that reason consults `PATTERN_INTERNAL_ACCOUNT_IDS` directly.
`consumerAdmissionEntry` admitting `chart_correction` for any user at
`internal` is a defect the Slice A containment work closes; it is not the
specified gate.

### 6. `patternState` — thirteenth value

**Decision.** `editorial_catalog` is a member of the closed state enum.
§9.1 is amended. It is the dual-path rollout §2.7 and §27 already require:
accounts that have not entered the AI path keep rendering M4
`PatternChapters`.

### 7. §7.3 invariants — named owners

**Decision.** “The M7 validator enforces” is replaced by an ownership list.

Contract policy (`contracts/validate_schemas.py` `_m7_policy_errors`):

- forbidden keys anywhere in a fact packet;
- consumer response must not contain `feature_aliases`, `ontology_rule_ids`,
  `claim_class`, or `nft_`;
- `verdict: "pass"` implies `unevaluated_fixture_count === 0`.

A policy-only invalid fixture now exists for the third rule. The previous
invalid evaluation fixture (`unevaluated_fixture_count: -1`) remains a
schema rejection and does not exercise the policy.

Runtime / compiler (`packages/pattern-engine`):

- alias resolution, plan bounds, claim ledgers, acyclic synthesis,
  expression-guidance propositions, coverage accounting.

Runtime / Worker:

- a deleted, superseded, or withdrawn claim cannot also have an active
  document;
- a consumed tombstone cannot return to `available`;
- export includes only active accepted Patterns.

The §23.8 fixed-chart corpus lives at `contracts/m7/fixtures/corpus/`.
That directory is the home §7.2 named. Slice B authors the profiles. This
amendment ships the inventory so the next freeze knows which charts the
ontology must be evaluated against.

### 8. Source-fragment metadata — optional additive fields

**Decision.** The shipped fragment is the required document. §23.2’s edition,
location, and source-specific exclusions become optional properties so a
later licensed excerpt can carry them without inventing fields at authoring
time:

```text
edition?: string
location?: string
exclusions?: string[]
```

`license_class` remains `licensed_excerpt | internal_synthetic`.
`license_resolved: true` on the corpus release remains the machine-readable
authorization a missing value fails closed on. Slice A’s synthetic corpus
uses `internal_synthetic` and may omit the optional fields.

### 9. Writer attempts and artifact class

**Decision.** The adapter plan’s Q1 stands: the writer receives at most
**three** attempts against one frozen plan; the verifier’s two attempts are
per candidate. Worst-case spend is 11 provider calls, not 7 and not 14.

The third writer attempt needs a `correction_document` artifact class that
the frozen twelve-value `artifactClass` enum and the `0007` CHECK do not
contain. That class is **not** added in this amendment. It is an additive
enum amendment that must land with the adapter (Slice 1, Task 8), together
with a forward-only CHECK rebuild. Until then the executor has no
`returnToWriter` primitive to store. Do not cite a synthetic green run as
verifier evidence (finding 14); the stand-in still always passes.

§14.2’s “tuple must differ” rule is a configuration refusal in
`resolvePatternPublisherConfiguration`, not an accident of wrangler pins.

### 10. Admin inspection — three documents, one identity question

**Decision.** Administrative inspection is three request/response documents:

| Document | Route | Opens content? |
|---|---|---|
| Generation metadata | `GET /admin/pattern-generations/{generation_id}` | No |
| Artifact inventory | `GET /admin/pattern-generations/{generation_id}/artifacts` | No |
| Artifact decrypt | `GET /admin/pattern-generations/{generation_id}/artifacts/{artifact_id}` | Yes |

`pattern-admin-artifact.schema.json` is the decrypt response. The metadata
and inventory documents are new additive schemas. The consumer
`patternGenerationStatus` document is not an admin document.

Every admin route requires a closed `purpose` query parameter from the
shipped `purpose_class` list. Opening exact content is a separate auditable
action from listing metadata.

The OpenAPI `adminToken` bearer scheme is **transitional**. The specified
scheme is an `HttpOnly` / `Secure` / `SameSite=Strict` cookie
(`pl_admin_session`). Slice C removes the shared `PATTERN_ADMIN_TOKEN`
comparison; it does not complement it. The identity provider that mints
that cookie — Cloudflare Access versus a separate administrator OIDC
tenant — remains an **operator decision**. This amendment does not pick
one. Slice C sizes both and stops at the decision gate.

**2026-08-28 operator decision:** Cloudflare Access was selected. Slice C now
validates the Access application assertion and dedicated AUD, then mints the
short-lived server-side `pl_admin_session`; the separate-admin-OIDC path is not
implemented.

`GET /admin/pattern-ontology-releases/{version}` returns release metadata
(version, hashes, provenance origin, evaluation booleans, record count).
It does not return record bodies.

### 11. Replay ledger — specified, numbered `0008`

**Decision.** The disaster-recovery replay source is specified in
[`2026-08-16-pattern-replay-ledger-design.md`](2026-08-16-pattern-replay-ledger-design.md).
`0008` is that ledger. The adapter plan’s per-stage-class usage ledger and
the `correction_document` CHECK rebuild do not share it:
`correction_document` takes `0009`, while per-stage-class usage and any D1
provenance-origin convenience column take `0010` or later.

The ledger is not user-owned. Account deletion **writes** a ledger event;
it does not delete ledger rows. A create-only R2 object is the durable
write-ahead and restore authority outside D1 Time Travel. The D1 table stores
the live receipt only after that put succeeds, so no D1-to-R2 crash window can
drop an erasure from the restore source.

Event IDs are deterministic from a domain-separated semantic operation key;
an exact retry adopts the already signed R2 bytes and their timestamp. Each
record names its Ed25519 `signing_key_id`. Replay is not claim-only:
`pattern_deleted` over a restored accepted claim erases the document and key,
and `ontology_recalled` clears the active pointer and leaves an ingestion
tombstone for that version. Destructive claim events materialize a terminal
claim when it is absent, and `account_deleted` runs the full deletion manifest
and cryptographic-erasure workflow in a final replay pass.

### 12. OpenAPI — twelve surfaces

**Decision.** The M7 OpenAPI amendment describes all twelve §19.8 surfaces.
Recall, reconcile, and the artifact inventory catch the Worker up. Decrypt
and the admin ontology-release route are specified ahead of Slice C.

Admin paths document `adminSession` as the specified scheme and keep
`adminToken` defined as deprecated transitional. Slice C deletes it from the
current M8 projection; the byte-frozen M7 artifact remains historical evidence.

### 13. Human-free Pattern generation

**Decision approved 2026-08-19.** Individual Pattern generation has no human
review, editing, moderation, approval, or release step. Deterministic selection
and validation, the model planner and writer, an independently configured model
verifier, and trusted application publication checks alone decide whether a job
publishes or fails. Exhausted machine retries end in terminal failure rather
than a manual review queue.

Reader consent and reader-requested retry authorize work but do not approve
content. Operational rollout controls and audited incident inspection remain
outside the generation path and cannot modify a candidate, override a verdict,
or authorize publication. A design or deployment sign-off is not a per-Pattern
runtime gate.

## Operator questions this amendment does not answer

- Cloudflare Access was selected for `pattern_generation_auditor` on
  2026-08-28; the prior Slice C decision gate is closed.
- Whether a later additive amendment should add `legal_privacy_request`.
  Not needed to implement Slice C against the shipped list.

Writer attempts 2 versus 3 is **answered**: 3, with `correction_document`
deferred to the adapter’s additive enum amendment.

## What later slices cite

| Slice | Cite |
|---|---|
| A | Provenance marker, honest evaluation booleans, flattened record, staff-gated `chart_correction`, corpus home |
| B | `machine_pipeline` provenance, report hashes, compiler policy for class-specific fields, `contracts/m7/fixtures/corpus/` |
| C | Shipped `purpose_class`, three admin documents, `adminSession`, token removal, identity decision gate |
| D | Replay ledger design and `0008`; criterion 23 is a drill against that runtime, not a runbook against a missing table |
| 1 | Writer attempts = 3; `correction_document` additive enum; §14.2 configuration refusal; human-free generation invariant |

## Verification

- `python3 contracts/validate_schemas.py` on the amended M7 package.
- Product-spec v0.6 renderer writes the sibling DOCX, PDF, and manifest.
- No rollout var moves. `0007` is not edited.
