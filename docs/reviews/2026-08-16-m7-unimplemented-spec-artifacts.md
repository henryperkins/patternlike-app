# Review of unimplemented M7 spec artifacts

> **Historical snapshot.** This review identified gaps at commit `c31d0df`.
> The additive M7 documents, fixed regression corpus, ontology pipeline, and
> signed replay runtime subsequently landed. Its absence claims are preserved
> below as review evidence, not current inventory. The remaining current work is
> the administrator session/decrypt boundary and production evidence gates; see
> [`contracts/m7/SCHEMA_MANIFEST.json`](../../contracts/m7/SCHEMA_MANIFEST.json)
> and [`docs/deploy/openai-pattern-rollout.md`](../deploy/openai-pattern-rollout.md).

**Date:** 2026-08-16
**Subject:** [`docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md`](../superpowers/specs/2026-08-14-ai-generated-pattern-design.md)
**Repository baseline:** `henryperkins/patternlike-app` at `c31d0df74322728a5d8ae04667200f5f6008d494`
**Status:** Review only. No runtime, contract, or product-spec change in this document.

**Resolution (2026-08-16).** The recommended spec work is recorded in
[`docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md`](../superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md)
and product-spec v0.6. The 2026-08-14 design is amended in place. Slice C and
Slice D now have designs. Do not re-litigate the settled enums against this
review’s “two owners” lists; those lists are what the amendment closed.

This is a spec review, not a status report. Six of the ten §31 workstreams are
already built. The remaining work cannot be implemented faithfully from the
artifacts the design named, because several of those artifacts disagree with
each other, with the shipped `contracts/m7` freeze, or with the still-normative
product specification.

Every claim below was re-confirmed against the tree at the time of writing.
Where a later document already recorded a finding, this review cites it and
adds only what opening the named section changes.

Related later documents, not re-litigated here except where they silently
amend the subject:

- [`docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`](../superpowers/specs/2026-08-15-openai-pattern-adapter-design.md)
- [`docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md`](../superpowers/plans/2026-08-15-openai-pattern-adapter.md)
- [`docs/superpowers/archive/plans/2026-08-15-m7-remaining-slices-handoff.md`](../superpowers/archive/plans/2026-08-15-m7-remaining-slices-handoff.md)

---

## What counts as a spec artifact

The design’s own inventory, not a new one:

| Artifact family | Design home | Shipped? | Implements remaining work? |
|---|---|---|---|
| `contracts/m7/` schemas, fixtures, manifest | §7.1–§7.2 | Yes — 23 schemas, predecessor hashes correct | Specifies unimplemented ontology, admin, and export shapes |
| Package-policy checks JSON Schema cannot express | §7.3 | Thin — three packet-key rules, one response leak scan, one evaluation count rule | Most invariants live only in `packages/pattern-engine` |
| OpenAPI amendment | §7.2, §19, §24 | Partial — 7 of 12 design routes | Missing routes are exactly the unimplemented admin/internal ones |
| Fixed synthetic chart/feature corpus | §7.2, §23.8 | Missing from `contracts/m7/` | Blocks Slice B and acceptance criterion 19 |
| Product-spec / brand-language revision | §2.8, §4.5 | `PRODUCT.md` only | Normative `spec-bundle` still describes M4 editorial Pattern |
| Interpretation ontology content | §23, §31.4, §31.10 | Fixtures only | No activated release; no pipeline |
| Administrator identity boundary | §24, §31.9 | Shared `PATTERN_ADMIN_TOKEN` + metadata routes | Role, session, and decrypt paths unspecified in a implementable contract |
| Disaster-recovery replay ledger | §29.11, §31.8, criterion 23 | Absent | Required, but no schema, table, or signed-record shape |
| Provider adapter / live verifier | §12–§14, §31.6 | Synthetic stand-ins; fail-closed on `openai` | Adapter design exists; several M7 numbers still disagree with code |

`0007_ai_generated_pattern.sql` is applied to production. Further schema work
is forward-only. `contracts/m7` is already treated as frozen at
`schema_version: 0.7.0`: later plans forbid changing `$id`s, enums, or
required fields except through the manifest `amendments` array. That freeze
is the constraint the findings below keep hitting.

---

## Blocking the remaining work

### 1. The product specification still forbids the M7 Pattern product

M7 §2.8 says `apps/web/PRODUCT.md` **and the product specification** must be
revised so “Inspectable by default” no longer claims every AI-written Pattern
paragraph exposes its evidence. §4.5 goes further and replaces the brand line.

`PRODUCT.md` was amended. The normative spec was not.

`spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` §0
amends only daily-reading sections of v0.2. Everything else, including
experience design and the API surface, “remains in force exactly as
published.” v0.2 still requires, for Your Pattern:

> 20-30 reviewed integrated pattern families at launch
> Open chapter evidence and counter-expression

v0.5 §10, still in force for any surface it does not explicitly carve out,
also says:

> There is no human review of prose and no second model reviewing the first.

M7 §14 deliberately introduces an independent semantic verifier. PRODUCT.md
already scopes the “no second model” rule to daily readings. The product spec
does not.

Until a v0.6 (or a dated v0.5 amendment) restates Your Pattern, the remaining
slices implement a product the current specification rejects on inspectability,
editorial catalog shape, failure fallback, consent kind, export shape, no-reroll
lifecycle, and the verifier. The design’s own §35 claim that “no unresolved
product choice remains” is false while this amendment is unwritten.

This outranks every contract finding below. The product spec is the document
the handoff says outranks both design documents where they disagree.

### 2. The evaluation document cannot both authorize a release and tell the truth

`pattern-ontology-evaluation.schema.json` requires `compiler_passed`,
`evaluator_passed`, `regression_passed`, and `verdict`, and does not constrain
them against each other. `_m7_policy_errors` in
`contracts/validate_schemas.py` only refuses `verdict: "pass"` when
`unevaluated_fixture_count !== 0`. `compileOntologyRelease` does the same two
checks and never reads the three booleans
(`packages/pattern-engine/src/ontology.ts`).

The valid fixture attests a pipeline that does not exist:

```json
"verdict": "pass",
"compiler_passed": true,
"evaluator_passed": true,
"regression_passed": true,
"unevaluated_fixture_count": 0
```

The invalid fixture uses `unevaluated_fixture_count: -1`, which the schema
already rejects (`minimum: 0`). It never exercises the policy rule.

Design §23.9 will only sign a candidate “that passes compilation, semantic
evaluation, and fixed-chart regression.” Acceptance criterion 19 requires
that pipeline to be evidenced. Slice B, which would produce those two
passes, is unbuilt.

The remaining-slices handoff already settled Slice A against a dishonest
production attestation: an internal-only synthetic release must ship
`evaluator_passed: false` and `regression_passed: false`. The compiler will
accept that today. §23.9 will not treat it as an authorized release. The
evaluation document therefore cannot simultaneously be:

- the production authorization evidence §23.9 describes, and
- the honest internal-only attestation Slice A needs,

unless the contract grows a provenance or authorization-class marker. The
handoff asked for that marker. Neither the release schema
(`additionalProperties: false`, fixed required set) nor
`pattern_ontology_releases` has a column for it.

Implementing Slice A against the current evaluation fixture, or implementing
§23.9 against honest false booleans, each produces a release the other
artifact refuses to recognize.

### 3. The ontology record schema is a different document from §23.3

`pattern-ontology-record.schema.json` is one flattened record with
`additionalProperties: false`. `meaningClass` allows
`source_supported | derived_synthesis | expression_guidance`, but the required
field set is the same for every class.

Design §23.3 requires fields the schema does not have:

| Class | Design-required field | In the schema? |
|---|---|---|
| `source_supported` | `expression_range` | No (it is a *transformation* enum value) |
| `source_supported` | `uncertainty_compatibility` | No |
| `derived_synthesis` | `derived_proposition` | No — only `normalized_proposition` |
| `derived_synthesis` | `entailment_rationale` | No |
| `derived_synthesis` | `compatible_feature_relationships` | No |
| `derived_synthesis` | `prohibited_extensions` | Partially `prohibited_claims` |
| `derived_synthesis` | `evaluator_verdict` | No |
| `expression_guidance` | “cannot add a body, sign, house, aspect…” | No class-specific shape; no contract policy |

There is no valid fixture for `derived_synthesis` or `expression_guidance`.
§7.3’s “expression guidance contains no astrological proposition” is enforced
nowhere — not in the contract validator, not in `compileOntologyRelease`.

Slice B cannot compile §23.3 as written onto this schema. Adding those fields
as **required** is a breaking change to a frozen 0.7.0 document. Adding them
as **optional** is an allowed amendment, but then §23.3’s “required fields
include” becomes compiler policy, and the design must say so.

Decide before authoring ontology content: either amend §23.3 to the shipped
flattened record, or add optional fields and enforce class-specific
requirements in the compiler. Do not let the first Slice A author invent a
third shape.

### 4. Admin `purpose_class` is already frozen against §24.4

Design §24.4:

```text
quality_investigation
user_report_investigation
safety_review
provider_incident
integrity_reconciliation
legal_privacy_request
```

Shipped contract, D1 CHECK, valid fixture, and runtime insert all use a
different closed set:

```text
quality_review
safety_investigation
incident_response
retention_audit
```

Evidence: `contracts/m7/pattern-admin-access-event.schema.json`,
`db/d1/0007_ai_generated_pattern.sql` (`CHECK` on
`pattern_admin_access_events.purpose_class`), and
`apps/api/src/routes/admin-pattern.ts` which hardcodes
`'quality_review'`.

Changing the enum breaks the M7 freeze and requires a forward-only `0008`
CHECK rebuild on a table that can already hold rows. Implementing §24.4 as
written is therefore a contract revision, not an admin-auth task.

The shipped list is also missing `legal_privacy_request`, which is the one
purpose that is not an engineering investigation. Slice C cannot add that
purpose without an amendment. The design cannot keep listing six values the
wire will reject.

Pick one list and amend the other. Do not implement administrator OIDC on
top of a purpose enum that still has two owners.

### 5. OpenAPI does not describe the unimplemented routes, and it documents the auth the design forbids

§7.2 requires “an OpenAPI amendment for the consumer and internal
administrative routes.” §19.8 names twelve surfaces. The shipped
`contracts/m7/openapi/openapi.yaml` has seven paths.

Present: `GET /v1/pattern-state`, Pattern consent GET/DELETE,
`POST /v1/pattern-generations`, generation status, `GET`/`DELETE /v1/pattern`,
`POST /internal/pattern-ontology-releases`,
`GET /admin/pattern-generations/{generation_id}`.

Absent from OpenAPI:

```text
POST /internal/pattern-ontology-releases/{version}/recall
POST /internal/pattern-generations/{generation_id}/reconcile
GET  /admin/pattern-generations/{generation_id}/artifacts
GET  /admin/pattern-generations/{generation_id}/artifacts/{artifact_id}
GET  /admin/pattern-ontology-releases/{version}
```

Recall, reconcile, and the admin artifact *list* already exist on the
Worker (`apps/api/src/routes/internal-pattern.ts`,
`apps/api/src/routes/admin-pattern.ts`) and are undescribed. The artifact
*decrypt* route and the admin ontology-release route do not exist at all.
Those two are Slice C. The contract package is therefore behind the
Worker on three paths and ahead of no path that would let an auditor
open content.

The one admin path that is documented uses `security: [adminToken]` and
defines `adminToken` as an HTTP bearer scheme. Design §24.2 forbids a bearer
token returned to browser JavaScript and requires administrator OIDC plus
`HttpOnly` / `Secure` / `SameSite=Strict` cookies. The remaining-slices
handoff already said the shared token must be removed, not complemented.

If Slice C implements §24.2 and leaves this OpenAPI scheme in place, the
frozen amendment will keep specifying the path criterion 18 is trying to
delete. The OpenAPI artifact has to change with the identity boundary, as an
explicit amendment, or Slice C will ship a second source of truth for admin
auth.

### 6. The fixed-chart corpus the design treats as a contract artifact does not exist

§7.2 requires “fixed synthetic chart/feature fixtures for selection, planning,
writing, and verification.” §23.8 makes that corpus an activation gate for
every ontology candidate: exact / approximate / unknown birth time, sparse and
dense sets, houses on and off, adversarial fragments, maximum-depth derived
synthesis, every suppression class, every supported locale.

`contracts/m7/` has stage-shaped examples with unrelated placeholder IDs. It
does not have a linked chart → feature set → selection manifest → fact packet
→ plan → writer output → verdict → public response chain. Runtime tests use
an inline five-feature array in `packages/pattern-engine/src/engine.test.ts`
and `syntheticOntologyRelease()` in `packages/pattern-engine/src/fixtures.ts`.

Slice B cannot run the regression §23.8 describes against those fixtures.
Criterion 19 cannot be evidenced. A later author who invents a corpus in
`packages/pattern-engine` only will leave the contract package that §7.2
named as the home of that corpus empty, and the next freeze will not know
which charts the ontology was evaluated against.

This is content-and-contract work, not an implementation detail of the
evaluator adapter.

### 7. Most §7.3 invariants are not package-policy checks

§7.3 says “the M7 validator enforces” twenty cross-document rules. The
contract validator implements three:

- forbidden keys anywhere in a fact packet;
- consumer response must not contain `feature_aliases`, `ontology_rule_ids`,
  `claim_class`, or `nft_`;
- `verdict: "pass"` implies `unevaluated_fixture_count === 0`.

The rest are either runtime-only in `packages/pattern-engine` (plan bounds,
claim ledgers, alias resolution, acyclic synthesis) or nowhere
(expression-guidance propositions; deleted/superseded/withdrawn versus an
active document; a consumed tombstone returning to `available`).

That would be an acceptable deferral if the manifest said so. It does not.
An implementer of Slice B or of the disaster-recovery ledger will reasonably
assume a failing contract fixture exists for each §7.3 bullet. Today a
schema-valid, policy-invalid `verdict: "pass"` with
`unevaluated_fixture_count: 1` cannot even be filed under `fixtures/invalid/`
as a policy-only case — `POLICY_ONLY["m7"]` only lists fact-packet PII stems.

Either extend `_m7_policy_errors` and add policy-only fixtures for the
invariants that are truly contract-level, or amend §7.3 so it names the
runtime validators that own the rest. Leaving the list as “the M7 validator
enforces” is a false inventory.

### 8. Disaster recovery is a hard gate with no artifact

§29.11 and acceptance criterion 23 block external rollout until a restore
drill proves that a pre-deletion snapshot cannot resurrect Pattern content or
reset a consumed claim. The replay source “must be outside the restored
snapshot and contain only signed or authenticated non-content lifecycle
records.”

There is no schema, no table, no signed-record shape, no OpenAPI, and no
row in `SCHEMA_MANIFEST.json`. Grep finds no `replay_ledger` /
`deletion_replay` / `erasure_replay` in runtime code. `0008` does not exist.

§31.8 called this out as work “when the repository does not already provide
it.” The repository does not. The remaining-slices handoff already said a
drill against absent runtime support proves nothing.

This is the one unimplemented artifact that is not even a stub. Slice D
cannot be a runbook-only exercise until the ledger is specified: which
events are recorded, what is signed, where the replica lives, what a
forward-only `0008` looks like, and how replay interacts with
`pattern_generation_claims` so a restored `available` row cannot regenerate
a consumed fingerprint.

### 9. Reservation reason is three different enums

The encrypted command (§10.1) pins:

```text
first_open | chart_correction | manual_retry
```

The consumer request and `common.schema.json#generationReason` allow:

```text
first_open | first_open_retry | failed_attempt_retry
```

`0007` `reservation_reason` CHECK allows the union:

```text
first_open | first_open_retry | failed_attempt_retry | chart_correction
```

Chart correction is a real reservation reason and must not appear on
`POST /v1/pattern-generations`. That split is fine. Calling both “the
reason enum” is not. The adapter and Slice A containment both freeze a
reason into the command; `consumerAdmissionEntry` already special-cases
`chart_correction` and, at `PATTERN_AI_ROLLOUT=internal`, admits that
entry for **any** user (`apps/api/src/services/pattern-rollout.ts`).

The design never writes the four-value CHECK down. An implementer who
copies §10.1 into a new command field will reject `first_open_retry`. An
implementer who copies §19.4 into the command will drop `chart_correction`
and break automatic successor reservation.

Name the two enums separately in the design, and record that
`chart_correction` at `internal` is or is not staff-gated. The handoff
already flagged the allowlist hole; the design still reads as if rollout
mode plus staff list is the whole gate.

---

## Important, before the next design is approved

### 10. `editorial_catalog` is a shipped state the design’s state list omits

§9.1’s closed state enum has twelve values. `common.schema.json#patternState`
has a thirteenth: `editorial_catalog`. The web client uses it to keep
rendering M4 `PatternChapters` for accounts that have not entered the AI
path.

That state is the dual-path rollout the design itself requires in §2.7 and
§27. It is not an accident. It is missing from the design section that
claims to list the closed enum. Amend §9.1, or the next OpenAPI/state
reviewer will treat the extra value as drift.

### 11. Writer attempts, verifier attempts, and artifact classes are already in conflict

§13.5: the writer receives at most **three** attempts against one frozen
plan, and a semantic rejection sends a closed correction document.
`pattern-enqueue.ts` freezes `writer_attempts_max: 2`. The current executor
has no `returnToWriter` primitive and no `correction_document`
`artifact_class`.

`common.schema.json#artifactClass` and the `0007` CHECK are a closed twelve
value set. A correction artifact cannot be stored under a new class without
an additive enum amendment **and** a CHECK rebuild. The adapter design
already needs that class, plus an `:attempt` component in the artifact
identity.

§14.2’s “tuple must differ” rule is not enforced in
`resolvePatternPublisherConfiguration`. Wrangler happens to pin different
prompt versions. That is an accident, not a gate.

The adapter design already recorded Q1 (2 vs 3), Q5 (`MAX_STAGE_CLAIMS`
8 → 16), and Q6 (per-stage-class usage vs one `used_calls` column). Those
are not new. What this review adds is: Q1 is not only a budget question.
The correction document is an **artifact-class** question, and the class
enum is already frozen in both the contract and production D1.

### 12. Source-fragment and corpus schemas are thinner than §23.2

§23.2 requires license and usage metadata, edition and location, allowed
transformation classes, and source-specific exclusions. The shipped fragment
has `title` / `author` as optional strings, `license_class` as
`licensed_excerpt | internal_synthetic`, and `allowed_transformations`. It
has no edition, location, or exclusion fields. The corpus release adds
`license_resolved: true` and refuses `unlicensed` in a fixture; it does not
encode the machine-readable authorization §23.2 says a missing value must
fail closed on.

Slice B’s source-corpus reader will either invent those fields (forbidden
while `additionalProperties` is false) or silently drop exclusions the
design treats as load-bearing. Amend §23.2 to the shipped fragment, or add
optional fields now as a recorded amendment, before anyone authors a
synthetic corpus that later cannot carry a real exclusion.

### 13. Admin inspection, as specified, is three artifacts pretending to be one

§24.3 says an auditor may inspect the fact packet, every raw response, the
internal document with claim ledgers, and the reader projection. The
interface “defaults to metadata. Opening exact content is still routine
authorized access, but it is a separate auditable action.”

What exists:

- `GET /admin/pattern-generations/:id` returns job metadata and is pointed
  at `patternGenerationStatus` in OpenAPI — a consumer status document;
- `GET .../artifacts` is implemented as an inventory list and is absent
  from OpenAPI;
- `pattern-admin-artifact.schema.json` exists, with no route that returns
  it;
- `admin_subject` is the literal `"admin"`;
- no decrypt path, no purpose query parameter, no cookie session.

Slice C is therefore not “add OIDC in front of the existing routes.” The
contract for the decrypt response exists; the contract for the
metadata-versus-open-content split, the purpose parameter, and the session
does not. Specify those three request/response documents before writing
identity middleware, or the first implementation will keep returning the
consumer status schema from an admin URL.

### 14. The live verifier the contracts describe is a stub that always passes

This is an implementation gap the adapter design already names. It is
listed here because the **spec artifacts** already treat independent
verification as a hard publication gate (criterion 7, §14, writer
correction in §13.5), while the only evaluation function in tree is:

```ts
if (!forceReject && !empty) {
  return { schema_version: "0.7.0", verdict: "pass", findings: [] };
}
```

A Slice A end-to-end on the synthetic publisher will “pass semantic
verification” for any non-empty writer output. That is correct for a
stand-in and disqualifying as evidence of criterion 7. Do not cite a
synthetic green run as verifier evidence. The evaluation corpus in §28.7
is also unbuilt; there is nothing for a live verifier to regress against
except the same placeholder fixtures.

---

## What is already true and should not be reopened

These are not findings. They are the freeze the remaining work has to
respect.

- Predecessor manifest SHA-256 digests for M4, M5, and M6 match the live
  `SCHEMA_MANIFEST.json` bytes.
- Every §7.2 named schema has at least one valid and one invalid fixture.
- `pattern_generation` is a distinct consent kind. Reusing `ai_synthesis`
  remains rejected.
- Fact-packet fixtures already refuse `user_id`, birthplace, coordinates,
  journal, check-in, and life-event keys. Keep that boundary.
- `PRODUCT.md` already scopes inspectability and the second-model rule the
  way M7 §2.8 asked. Copy that language into the product spec; do not
  invent a third formulation.
- Control-plane tables (`pattern_ontology_*`, both usage ledgers) are
  not user-owned. `pattern_admin_access_events` is nullified, not deleted.
  That classification is intentional.
- `PATTERN_AI_ROLLOUT` is `off` in both wrangler blocks. Nothing in the
  remaining slices may move it.
- `0007` is applied. There is no in-place edit path.

---

## Recommended resolution order

The remaining-slices handoff ordered A → B → C → D by product critical
path. This review inserts spec work in front of that path, because several
A/B/C/D tasks would otherwise implement the wrong artifact.

1. **Product-spec amendment** for Your Pattern: inspectability, one private
   artifact, `pattern_generation` consent, no editorial fallback, no-reroll
   deletion, M7 export `patterns` section, and a Pattern-scoped exception
   to “no second model.” Until this lands, M7 remains a proposed design
   that the current specification rejects.
2. **Reconcile the three already-frozen enums** with the design, by
   amending the design in place unless a real product reason exists to
   break 0.7.0: `purpose_class`, `generationReason` / reservation reason,
   and `patternState` (`editorial_catalog`).
3. **Decide the ontology authorization story** as one amendment: evaluation
   honesty, optional provenance marker, class-specific record fields as
   compiler policy or optional schema properties, and where the §23.8
   corpus lives. Slice A and Slice B both consume this decision.
4. **Specify the replay ledger** (schema, signing, replica, `0008`) before
   scheduling the criterion 23 drill.
5. **Complete the OpenAPI amendment** for the five missing routes, and
   replace `adminToken` when Slice C’s identity choice is made.
6. **Then** write the Slice A/B/C/D designs the handoff asked for, citing
   the amended sections rather than the 2026-08-14 text where they
   disagree.

Open questions that still need an operator answer, not an implementer
guess:

- Cloudflare Access versus a separate administrator OIDC tenant for
  `pattern_generation_auditor` (handoff Slice C). The AI Gateway Access
  refusal does not decide this.
- Whether the shipped `purpose_class` list or §24.4 is authoritative.
- Whether §23.3 or `pattern-ontology-record.schema.json` is authoritative.
- Writer attempts 2 versus 3, because the third attempt needs a new
  artifact class the CHECK does not contain.

---

## Verification

Claims in this review were checked by reading the cited files and by
running `python3 contracts/validate_schemas.py` (M7 package: 23 schemas,
valid/invalid fixtures green, predecessor hashes match, OpenAPI
`paths=7`). A read-only probe on the same tree confirmed: shipped
`purpose_class` enum matches the `0007` CHECK; the valid evaluation
fixture attests all three pipeline booleans; `contracts/m7/fixtures`
contains no chart or feature-set corpus; `0008` does not exist. No
runtime behavior was changed.
