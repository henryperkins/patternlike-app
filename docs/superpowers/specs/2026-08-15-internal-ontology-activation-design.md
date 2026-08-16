# Internal-Only Ontology Activation Design (M7 Slice A)

**Date:** 2026-08-15

**Status:** Draft for approval. No plan may be derived until this is approved.

**2026-08-16 amendment.** Product-spec v0.6 and
[`2026-08-16-m7-spec-artifact-amendments.md`](2026-08-16-m7-spec-artifact-amendments.md)
ratify this slice’s provenance marker, honest evaluation booleans, flattened
ontology record, and staff-gated `chart_correction`. Cite those documents, not
the pre-amendment 2026-08-14 lists. `0008` is the replay ledger; a D1
provenance-origin convenience column, if still wanted, takes `0009` or later.

**Scope:** Produce and activate the first Pattern interpretation ontology — a
hand-authored, signed, **internal-only** release — and build the containment that
keeps it away from external readers. This unblocks an end-to-end Pattern for
designated internal accounts and nothing beyond that.

## Decision summary

M7 built every mechanism an ontology needs and shipped no ontology. Ingestion,
compilation, signature verification, activation, recall and the runtime reader
are all complete and verified in the tree; the only ontology material in the
repository is contract fixtures and a test fixture, which are schema examples
rather than content. Without an activated release,
`reservePatternGeneration` refuses at `apps/api/src/services/pattern-enqueue.ts:158-165`
with `ontology_unavailable`, so no Pattern can be produced at all — the adapter
(slice 1) can be finished and still generate nothing.

The approved choices are:

- Slice A produces an **internal-only** release, valid at
  `PATTERN_AI_ROLLOUT=internal` and below. Slice B — the automated pipeline —
  remains the gate for every external reader, and none of the time Slice A saves
  comes off Slice B.
- The release is **hand-authored editorial content**, built, signed and ingested
  through tooling that mirrors the existing M4 editorial release precedent
  (`content/pattern-candidates/` + `scripts/pattern-release/`), not through a
  runtime code path.
- Containment is a **signed provenance marker inside the release body**, added as
  an additive optional property to `pattern-ontology-release.schema.json` and
  recorded in the manifest's `amendments` array. It is not a D1 column alone.
- Absence of the marker is read as **internal-only**, so the gate fails closed
  and Slice B must positively assert its own provenance.
- The evaluation object tells the truth: `evaluator_passed: false` and
  `regression_passed: false`, which the compiler already tolerates.
- The refusal is taken at **reservation**, where §23.11 freezes the ontology into
  the command, and it consults the staff allowlist **directly** rather than
  through `consumerAdmissionEntry`.
- Rollout does not move. Production stays at `PATTERN_AI_ROLLOUT=off` until the
  adapter, this release, and the recorded spend approval are all in place.

## Goal

A designated internal account with Pattern consent can receive a complete Pattern
— selected, planned, written, verified and published — grounded in an activated
ontology, while any account not on `PATTERN_INTERNAL_ACCOUNT_IDS` is refused
before a single provider call.

Success means:

1. an authored ontology release compiles clean through `compileOntologyRelease`,
   verifies against `PATTERN_ONTOLOGY_KEYS`, ingests through
   `POST /internal/pattern-ontology-releases`, and becomes the active pointer;
2. its records cover the launch feature vocabulary densely enough that a real
   chart yields four to six chapters rather than a sparse document;
3. the release declares itself synthetic and internal-only in bytes that are
   covered by its signature, so the declaration cannot be laundered by
   re-ingesting the same content under a different assertion;
4. an internal-only release active while rollout is `first_open` **refuses to
   reserve** for an external account rather than generating against it, and the
   refusal is proved by a test;
5. the evaluation object asserts no run that did not happen; and
6. acceptance criterion 19 is left visibly unmet rather than falsely evidenced —
   this release is not offered as proof of the machine-generated pipeline.

Explicit non-goals. This slice does not build the generator, the independent
evaluator, the fixed-chart regression corpus, or the source-corpus contract
reader; those are Slice B and acceptance criterion 19 depends on all six of its
components. It does not serve any external reader. It does not change
`packages/pattern-engine`'s compilation or matching behavior, and it does not
change `contracts/m7`'s `schema_version`, any `$id`, any enum, or any required
field.

## Current state

Verified by inspection on 2026-08-15.

**Everything mechanical is built.** `compileOntologyRelease`
(`packages/pattern-engine/src/ontology.ts:205`) runs a structural gate and then a
semantic gate covering duplicate ids, canonical aspect ordering, source
termination for `source_supported`, two-input and transformation-class
requirements for `derived_synthesis`, an acyclic synthesis graph, and unknown
input-meaning references. `pattern-ontology-verify.ts` recomputes the bundle hash
over `canonicalJson(release − bundle_hash − signature)` and verifies the
signature against `PATTERN_ONTOLOGY_KEYS`. `storeOntologyRelease`
(`apps/api/src/db/pattern-ontology.ts:119-213`) compiles, verifies, writes the
immutable bundle to R2 create-only, inserts the D1 row, supersedes every other
active release, and moves `pattern_ontology_pointer` — all in one guarded batch
opened by an `assertion_probe` that aborts if the version is recalled.
`loadActiveOntology` re-verifies hash, signature and compilation on every read.

**Ingestion is activation.** There is no candidate-then-promote path:
`storeOntologyRelease` writes `status = 'active'` and moves the pointer in the
same batch. Ingesting a release publishes it. This is a fact the runbook must
respect — there is no staging step in which a release exists but is not live.

**The content is absent, and the tables that would ground it do not exist.**
`0007` creates `pattern_ontology_releases`, `pattern_ontology_pointer`,
`pattern_ontology_evaluation_runs`, `pattern_ontology_recall_events`, and
`pattern_ontology_provider_daily_usage`. It creates **no source-fragment or
source-corpus table**. `source_fragment_ids` are validated for grammar
(`^srcf_[0-9a-f]{32}$`) and for non-emptiness on `source_supported` records, and
are never resolved against anything. `corpus_release_hash` is a free content hash
that nothing cross-checks.

**Amendment (2026-08-15), from the Slice B research.** The above is right about
the tables and wrong about the only available option.
`pattern-source-fragment.schema.json` types `license_class` as an enum of exactly
`licensed_excerpt` and `internal_synthetic`, and there is already a valid fixture
at `contracts/m7/fixtures/valid/pattern-source-corpus-release.synthetic.json`. So
this slice should author a real **synthetic source-corpus release** —
`license_class: "internal_synthetic"`, `license_resolved: true`, which is honest
because we wrote the propositions and own them — and mint its ontology records'
`source_fragment_ids` from fragments that actually exist in that document. It
costs one more authored artifact and replaces orphan identifiers with a
reviewable chain. It does **not** change this slice's internal-only status: an
internally written corpus is still not §23.2's curated corpus with resolved
third-party license and usage metadata, and Slice B remains the external gate.
The paragraph below stands as the reason for containment, with "do not exist"
narrowed to "are not curated source material."

That is the whole reason this slice is internal-only, and it should be stated
without euphemism: **a hand-authored release rests on propositions we wrote
ourselves, under a corpus release that was never curated.** §23.1 makes the ontology
the model's only authority for astrological meaning and requires every runtime
statement to resolve through source-supported meanings to immutable curated
source fragments; §23.2 puts those fragments behind an out-of-scope curation
process that resolves license and usage metadata and refuses "a corpus release
lacking explicit machine-readable authorization." Hand-authoring cannot
manufacture that chain. It can only assert it.

**The evaluation object is where the assertion becomes concrete.**
`pattern-ontology-evaluation.schema.json` requires `compiler_passed`,
`evaluator_passed`, `regression_passed`, `verdict`, and
`unevaluated_fixture_count`. `compileOntologyRelease` reads exactly two of them:
it refuses a `verdict` other than `pass` and an `unevaluated_fixture_count` other
than `0` (`ontology.ts:220-225`). The three booleans are contract-required and
compiler-ignored, and the schema types them as plain booleans with no `const`, so
`false` is contract-valid. The existing test fixture sets all three to `true`
(`packages/pattern-engine/src/fixtures.ts:91-97`), which is correct for a fixture
and disqualifying for anything a reader is served from.

**Nothing distinguishes a synthetic release from a pipeline one once stored.**
`pattern-ontology-release.schema.json` is `additionalProperties: false` over
exactly eight required properties, none of which is provenance, and
`pattern_ontology_releases` has columns for version, bundle hash, corpus release
hash, locale, status, object key, evaluation JSON and timestamps — and no
provenance column.

**Rollout mode is not containment.** A release outlives the mode that admitted
it, and `consumerAdmissionEntry` (`apps/api/src/services/pattern-rollout.ts:81-88`)
returns `chart_correction` for any chart-correction reason **without consulting
`PATTERN_INTERNAL_ACCOUNT_IDS`**, while `ADMITS.internal` includes
`chart_correction`. So at `PATTERN_AI_ROLLOUT=internal` an external account whose
chart was corrected is already admitted. Any containment check that routes
through `consumerAdmissionEntry` inherits that hole.

## Chosen architecture

### The marker travels in the signed bytes

Add an optional `provenance` property to the release body:

```jsonc
"provenance": {
  "type": "object",
  "additionalProperties": false,
  "required": ["origin"],
  "properties": {
    "origin": { "type": "string", "enum": ["synthetic_internal", "machine_pipeline"] },
    "authored_by": { "type": "string", "minLength": 1, "maxLength": 200 },
    "reviewed_at": { "type": "string", "format": "date-time" }
  }
}
```

Three properties of this choice matter.

**It is signed.** `ontologySigningPayload` canonicalizes the release minus
`bundle_hash` and `signature`, so a new body property is inside the signature and
inside the bundle hash automatically. No new crypto, no second signing path.

**It cannot be laundered.** The alternative the handoff offered — a forward-only
D1 column and no contract change — is cheaper but weaker, because the value has
to come from somewhere at ingest. The ingest route receives only the release
body, so a column would need a separate request field or route parameter: an
unsigned assertion by whoever called the route, on bytes that say nothing. Since
`storeOntologyRelease` re-activates an existing version when the version and
bundle hash match, that assertion could be changed on a later call over identical
content. A signed body property makes provenance part of what the release *is*.

**It is additive.** A new optional property changes no required field, no enum,
no `$id`, and no `schema_version`. That is precisely what the manifest's
`amendments` array exists to record, and there is a worked precedent — the single
existing amendment dated 2026-08-15 added `patternConsentRevocation` and closed
with an explicit purely-additive assertion. This one follows its shape.

A D1 column mirroring `provenance.origin` is **operational convenience, not the
gate**. `loadActiveOntology` already returns the full `release`, so the runtime
refusal reads the signed value directly and needs no column. If a migration is
being written anyway — the adapter plan proposes `0008` for the per-stage-class
usage ledger — mirroring the column there is nearly free and makes admin listing
and operator queries legible. If no migration is being written, defer it. **Note
the numbering collision:** whichever of these lands first takes `0008`.

### Absence is internal-only

Existing and future releases that carry no `provenance` object are treated as
`synthetic_internal`. The gate therefore fails closed, and Slice B must
positively declare `origin: "machine_pipeline"` to serve anyone. This is the
opposite of the convenient default and is the point: an unmarked release is
exactly the case where nobody recorded what it was.

### The evaluation object stops asserting runs that did not happen

The authored release sets:

```jsonc
"evaluation": {
  "verdict": "pass",
  "compiler_passed": true,
  "evaluator_passed": false,
  "regression_passed": false,
  "unevaluated_fixture_count": 0
}
```

`compiler_passed: true` is true — the deterministic compiler is the one gate that
does run. `evaluator_passed` and `regression_passed` are false because §23.7's
independent evaluator and §23.8's fixed-chart corpus are Slice B and do not
exist.

`verdict` must remain `"pass"`, because `compileOntologyRelease` refuses anything
else and the release would be un-ingestible. The design must be honest about what
that costs: **on a synthetic release, `verdict: "pass"` means only "the gates
that ran, passed."** It is not a claim that the release was evaluated. The
provenance marker is what carries that truth, which is another reason the marker
belongs in signed bytes rather than in an operator's memory.

`unevaluated_fixture_count: 0` is likewise forced by the compiler and is honest
under a narrow reading — there is no fixture corpus, so no fixture is
unevaluated. That reading is thin, and it is recorded as an open question below
rather than smoothed over.

### The refusal is taken at reservation

§23.11 makes reservation the point where the active ontology is read once,
verified, and frozen into the command. That is the correct place for the gate:
it is before any job row exists, before any provider call, and it means a frozen
command can never name an internal-only release for an external account.

In `reservePatternGeneration`, immediately after the existing
`ontology_unavailable` refusal:

```ts
if (ontologyOriginOf(ontology.release) !== "machine_pipeline" &&
    !isInternalPatternAccount(env, identity.userId)) {
  safeLog(env, { event: "pattern_ontology_release_withheld", origin: <closed> });
  return {
    ok: false,
    status: 409,
    code: "ontology_unavailable",
    message: "No activated Pattern ontology is available",
  };
}
```

Three details are load-bearing.

**The caller is told nothing new.** The refusal reuses the existing
`ontology_unavailable` code and message verbatim, so an external reader cannot
distinguish "no ontology is active" from "an ontology is active and is not for
you." A distinct code — `ontology_not_released_for_account` was the first draft —
would publish the existence and the containment state of an internal release to
anyone who asked. That is the same discipline the adapter design applies to
provider failure classes, which never reach a reader, and the same discipline
`CLAUDE.md` records for the error envelope: the specific reason is logged
server-side and deliberately not returned. The operator learns the real reason
from the safe-log arm below.

It calls `isInternalPatternAccount` **directly**, never `consumerAdmissionEntry`,
for the reason given above: `chart_correction` bypasses the allowlist, and a
chart correction is exactly the path that would otherwise let an external reader
in through the side door.

It is independent of `PATTERN_AI_ROLLOUT`. The rollout mode gates entry; this
gates the release. A release that was ingested under `internal` and is still
active when someone advances the mode to `first_open` must keep refusing, because
the mode moved and the release did not.

### Content: what has to be authored

The release must cover the launch feature vocabulary densely enough for a real
chart to produce four to six chapters, each with at least one tension and one
counter-expression, and enough `source_supported` records for derived syntheses
to have two or more inputs.

The existing test fixture establishes the shape but not the substance: it uses
class-level partial predicates — `{type: "aspect", aspect: "square"}` matches any
square — which is what keeps the record count bounded against 13 launch bodies
and 5 aspect types. Its prose ("The sun position describes a standing emphasis.")
is placeholder.

The authored set is expected to be roughly:

| Class | Coverage | Approx. count |
| --- | --- | --- |
| `source_supported` — positions | one per launch body | 13 |
| `source_supported` — aspects | one per aspect type, plus a small set of named pairs that carry real meaning | 5 + 8–12 |
| `source_supported` — angles, houses, patterns, uncertainty | ascendant, midheaven, house cusp, multi-body pattern, uncertainty | 5 |
| `derived_synthesis` | two or more inputs each, closed transformation classes, acyclic | 6–10 |
| `expression_guidance` | voice, pacing, plain-language rendering | 5–8 |

Call it forty to fifty records. This is an editorial job of real but bounded
size, and it is the part of the slice that is not engineering.

Every `source_supported` record must carry `tensions`, `counter_expressions`, and
`prohibited_claims` that a validator can enforce against, because
`validatePatternCandidate` rejects a chapter with no tension or
counter-expression, and rejects an astrological prose unit supported only by
expression-guidance references. Expression guidance alone cannot carry a Pattern.

### Authoring, build, sign, ingest

Mirror the M4 editorial release precedent exactly, because it already solved this
shape and `CLAUDE.md` already records its invariant.

```
content/pattern-ontology/          authored records, reviewed by a person
scripts/pattern-ontology/build.mjs compiles authored records into a release body
scripts/pattern-ontology/sign.mjs  signs the canonical payload
scripts/pattern-ontology/build.test.mjs  asserts no runtime source reads content/
```

The last one is not optional. `CLAUDE.md` records that **no code path reads
`content/pattern-candidates/`** and that `scripts/pattern-release/build.test.mjs`
proves it by scanning every runtime source. The same assertion must hold here:
authored ontology drafts are never a runtime fallback, and the only way an
ontology reaches the runtime is as a signed bundle through the ingest route.

The build script sets `provenance.origin: "synthetic_internal"`, the three
evaluation booleans, and `unevaluated_fixture_count: 0`; it does not accept an
override for any of them. The signing key is the dedicated ontology-release
identity of §23.9 and is never in the repository.

### Alternatives not selected

1. **A D1 provenance column and no contract change.** Cheapest, and rejected for
   the reason above: the ingest route receives only the release body, so the
   column's value would be an unsigned assertion by whoever called the route,
   over bytes that say nothing — and `storeOntologyRelease` re-activates an
   existing version whenever version and bundle hash match, so that assertion
   could be changed later over identical content. A mirrored column remains
   useful for operator queries and is deferred, not refused.
2. **Rollout mode as the containment.** Rejected because the release outlives the
   mode. A release ingested under `internal` stays active when an operator
   advances to `first_open`, and `consumerAdmissionEntry` already admits
   `chart_correction` at `internal` without consulting the staff allowlist
   (`pattern-rollout.ts:81-88`).
3. **Making every record `expression_guidance` to avoid citing fragments.**
   Superficially honest — expression guidance asserts no astrology, so it needs
   no source termination. Rejected because `validatePatternCandidate` rejects an
   astrological prose unit supported only by expression-guidance references, so
   such a release compiles and then produces no publishable Pattern. The
   dishonesty of synthetic fragment ids is unavoidable and is contained rather
   than concealed.
4. **A compiler exemption for unevaluated synthetic releases.** Rejected because
   it changes the one authorization gate that actually runs, in order to make a
   release that is not meant for readers easier to produce. The provenance marker
   carries the same information without touching the gate.

## Configuration and observability

**No new environment variable is required.** `PATTERN_ONTOLOGY_KEYS` is already a
declared secret and is already required outside development by both
`storeOntologyRelease` (`pattern-ontology.ts:137-139`) and `readVerifiedRelease`.
`PATTERN_INTERNAL_ACCOUNT_IDS` is already declared (`apps/api/src/env.ts:140`) and
is already read fail-closed — malformed JSON is nobody, not everybody
(`pattern-rollout.ts`). `PATTERN_AI_ROLLOUT` is unchanged. This slice configures
no secret and advances no rollout as a consequence of merging.

**One new closed safe-log arm.** `safe-log.ts` gains

```ts
| { event: "pattern_ontology_release_withheld"; origin: "synthetic_internal" | "absent" }
```

and nothing else. `origin` is a closed two-member union, not the raw value read
from the release, so a future origin string cannot reach a log through it. No
user id, account id, ontology version, bundle hash, or record content is carried:
the operator needs to know that containment fired and why, not who tripped it.
The existing `safe-log.test.ts` discipline extends to the new arm — a hostile
event object carrying extra keys must serialize none of them.

**One type change in `packages/shared`, recorded deliberately.**
`PatternOntologyRelease` is declared at `packages/shared/src/m7-types.ts:220-229`,
so the optional `provenance` property has to be added there. The standing
constraint is that nothing *new* lands in `packages/shared` because the AGPL calc
service imports it; this is an optional field on an M7 wire type that already
lives there, adds no module and no runtime code, and is not reachable from the
calc service. The alternative — a widened structural type in `apps/api` — would
fork the definition the contract describes and let the two drift. Adding the
field is the smaller harm, and it is recorded here so it is a decision rather
than an oversight.

## Reconciliation with the adapter design

The OpenAI Pattern adapter design
(`docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`) is
normative for slice 1 and its rollout ladder assumes this slice's output. Two of
its gates need amendment once this design is approved, and neither is a change
this document may make unilaterally:

- **Its rollout gate 7** reads "ingest and activate a **fully evaluated** ontology
  release." A Slice A release is deliberately not fully evaluated —
  `evaluator_passed: false`, `regression_passed: false` — so gate 7 must split
  into an internal-only path, satisfied by this slice, and an external path,
  satisfied only by Slice B.
- **Its rollout gate 10** advances to `first_open` on sustained success and spend
  metrics alone. Under this design that is unreachable without a
  `machine_pipeline` release, because the reservation gate refuses every external
  account regardless of metrics. Gate 10 needs Slice B named as a precondition.

Nothing else in the adapter design conflicts with this one. Its out-of-scope list
already excludes the ontology generation and evaluation pipeline, and its
statement that production "has no ontology release today, so generation would
otherwise cancel with `cancel_ontology` before reaching a provider" is exactly the
condition this slice removes.

## Contracts

One additive amendment to `contracts/m7`:

- `pattern-ontology-release.schema.json` gains the optional `provenance` object
  described above. `schema_version` stays `0.7.0`; no `$id`, enum, or required
  field changes.
- `SCHEMA_MANIFEST.json` gains one `amendments` entry in the shape of the
  existing one — `date`, `change`, `reason` — with the reason closing on an
  explicit purely-additive assertion naming what did not change.
- A fixture under `contracts/m7/fixtures/valid/` carrying
  `provenance.origin: "synthetic_internal"`, and a rejection case under
  `fixtures/invalid/` carrying an unknown origin value, per the repository's
  contract-change rule.
- `contracts/m0` through `contracts/m6` stay byte-identical.

The runtime structural gate in `ontology.ts` does not check unknown keys, so an
un-amended contract would tolerate the property at runtime while the frozen
contract rejected it. That divergence is the reason the amendment is mandatory
rather than cosmetic.

## Verification strategy

**Compilation and ingest.** The authored release compiles clean through
`compileOntologyRelease`; a release with a cycle, a missing input meaning, a
non-canonical aspect pair, or a `source_supported` record with no fragments is
refused as a whole; the bundle hash and signature verify; re-ingesting identical
bytes is idempotent; re-ingesting different bytes under the same version is
`ontology_version_immutable`; a recalled version cannot be revived.

**Containment — the tests this slice exists for.**

- An internal-only release active while `PATTERN_AI_ROLLOUT=first_open` refuses
  to reserve for an account **not** on `PATTERN_INTERNAL_ACCOUNT_IDS`, and
  creates no job row.
- That refusal is **byte-identical** to the no-ontology refusal — same status,
  same code, same message — so an external caller cannot distinguish the two
  states. Asserted by comparing both responses in one test.
- The withheld reservation emits exactly one `pattern_ontology_release_withheld`
  safe-log arm carrying a closed `origin` and no identifier, and a hostile event
  object carrying extra keys serializes none of them.
- The same release reserves normally for an account **on** the allowlist.
- The refusal holds for a `chart_correction` reservation by an external account —
  the `consumerAdmissionEntry` bypass — which is the case that a naive
  implementation passes and this one must not.
- A release carrying `provenance.origin: "machine_pipeline"` reserves for an
  external account, proving the gate is on provenance rather than on rollout.
- A release carrying **no** `provenance` object is treated as internal-only.
- No provider call and no budget unit is consumed on any refusal.

**Honesty.** The authored release's evaluation carries
`evaluator_passed: false` and `regression_passed: false` and still compiles; a
test pins those two values so that flipping them to `true` breaks deliberately.

**Content quality.** The authored release drives a complete Pattern end to end
against the synthetic publisher for at least one exact-birth-time chart and one
unknown-birth-time chart, producing four to six chapters in the first case and
degrading correctly in the second — with houses, angles and time-sensitive Moon
claims suppressed.

**Gate.** Fresh root `npm run typecheck`, `npm test`, `npm run build`, and
`python contracts/validate_schemas.py`, plus proof that `contracts/m0`–`m6` are
unchanged and the manifest's `defines`, `id`, and file-inventory checks still
pass.

## Rollout and operations

Ordered gates, each with its own evidence:

1. Author the record set; review it editorially. Gate: a named reviewer signs off
   on the prose, the tensions, the counter-expressions and the prohibited claims.
2. Land the contract amendment, the provenance gate, and the tests, with rollout
   unchanged at `off`. Gate: the full candidate gate passes and production
   behavior is unchanged.
3. Generate and sign the bundle offline. Gate: the signing key is the dedicated
   ontology identity; the key never enters the repository, a prompt, an R2 object
   body, or a test snapshot.
4. Configure `PATTERN_ONTOLOGY_KEYS` in production. Gate: `checkSecureConfig`
   refuses its absence, proven before the value is set.
5. Ingest through `POST /internal/pattern-ontology-releases`. Gate: **ingestion
   activates** — there is no staging state — so this is the step that makes the
   release live, and it must not run before gate 2 has deployed the containment.
6. Set `PATTERN_INTERNAL_ACCOUNT_IDS` and advance to
   `PATTERN_AI_ROLLOUT=internal`. Gate: one complete generation for one internal
   consented account, and one recorded refusal for an external account.

Gate 5 before gate 2 is the sequencing error to avoid: an active release with no
containment deployed is exactly the state where `chart_correction` admits an
external reader.

Rollback is `recallOntologyVersion`, which marks the version unsafe, triggers the
§21.8 withdrawal process, and permanently prevents reactivation under the same
identity — plus `PATTERN_AI_ROLLOUT=off` if generation must stop entirely.

## Open questions

1. **`unevaluated_fixture_count: 0` on a release with no fixture corpus.** The
   compiler requires `0`. Reading "no fixtures exist, therefore none are
   unevaluated" is defensible but thin, and the alternative — a compiler change
   admitting a null or a synthetic exemption — is a change to the one gate that
   does run. This design takes the thin reading and lets the provenance marker
   carry the truth. Worth an explicit decision rather than a silent one.
2. ~~Who authors and who reviews the content.~~ **Resolved 2026-08-15:** drafted
   in this workstream and reviewed editorially by the operator before it is
   built, signed, or ingested. The plan carries an authoring task whose output is
   a review artifact, not a merge-and-ship deliverable.
3. ~~Whether the D1 provenance column lands now or later.~~ **Resolved
   2026-08-15:** the signed release property is the gate and the mirrored D1
   column is **deferred**. Revisit only if operator queries or admin listing need
   provenance without reading the R2 bundle.
4. **Locale.** The authored release is `en-US` only. Whether a second locale is
   in scope for internal certification, or waits for Slice B, is unresolved.
5. **Retirement.** When Slice B produces its first `machine_pipeline` release,
   whether the synthetic release is superseded or recalled. Superseded keeps its
   bytes readable for any job that froze it; recalled triggers withdrawal. The
   answer depends on whether internal Patterns generated against it are kept.

## Out of scope

- the ontology generator, the independent evaluator, the fixed-chart regression
  corpus, the source-corpus contract reader, and machine signing — all Slice B,
  and all six required by acceptance criterion 19;
- serving any external reader, and advancing rollout past `internal`;
- changing `compileOntologyRelease`, `ontologyRecordMatchesFeature`, or any other
  `packages/pattern-engine` behavior;
- changing `contracts/m7`'s `schema_version`, any `$id`, any enum, or any
  required field;
- a source-corpus or source-fragment table, and any attempt to resolve
  `source_fragment_ids` against real content;
- the administrator authorization boundary (Slice C) and the disaster-recovery
  replay ledger (Slice D); and
- the OpenAI provider adapter, which is slice 1 and has its own design.
