# Ontology corpus `license_class` decision (M7)

**Status:** `APPROVED FOR PIPELINE` — public activation conditions remain open
**Product:** Pattern-Like Astrology App
**Question:** May a model-generated source corpus be activated publicly?
**Decision sought:** Yes — `license_class` is a rights flag, not a provenance flag
**Schema impact:** None. `contracts/m7` is unchanged
**Date opened:** 2026-08-22
**Owner:** Product (engineering implements; legal reviews §5)

> This document is an engineering decision record, not legal advice. §5 in particular should be reviewed by counsel before public activation.

---

## 1. Decision summary

| Item | Choice |
| --- | --- |
| Corpus origin | Model-generated, first party |
| `license_class` | `licensed_excerpt` |
| `license_resolved` | `true` |
| Public activation | Permitted |
| `provenance.origin` on an automated release | `machine_pipeline` |
| Schema / migration change | **None required** |
| Documents amended | `LICENSING.md`, the M7 pipeline design spec, the source-manual SOW |

---

## 2. What was actually blocking this

Nothing in the codebase was. The constraint existed only in prose written around the schema, and in the connotation of an enum value's name.

`license_class` is inspected in exactly one place that matters, `apps/api/src/services/ontology-corpus.ts`:

```ts
    licenseClass,
    // This is derived from a validated all-fragment class, never caller input.
    publicCapable: licenseClass === "licensed_excerpt",
```

Nothing anywhere inspects how the text was written. There is no authorship field, no human-author assertion, and no check that could detect one. The design spec's statement of the rule is about authorization, not authorship:

> Public activation additionally requires an immutable corpus release whose fragments are authorized as `licensed_excerpt` with machine-readable license and usage metadata.

And §23.2 is explicit that the flag is asserted rather than inferred:

> A corpus release lacking `license_resolved: true` is refused. That flag is the machine-readable authorization; it is not inferred from title or author.

The name `internal_synthetic` reads like a statement about provenance. Its only behaviour is a statement about publication. That mismatch is the defect, and it is a naming and documentation defect rather than a code one.

---

## 3. The decision

**`license_class` records whether the project holds the right to publish the material. It does not record how the material was produced.**

| Value | Means | `public_capable` |
| --- | --- | --- |
| `licensed_excerpt` | Material the project is entitled to publish — commissioned, licensed, or first-party original, including model-generated | 1 |
| `internal_synthetic` | Material deliberately withheld from public activation — fixtures, experiments, unreviewed drafts | 0 |

Under this reading `internal_synthetic` keeps a real and useful meaning: it is the class for things we do not want users to see, which is what the test fixtures already are. It stops being a trap that reclassifies a corpus on the basis of how it was drafted.

Provenance is not lost, but the release field cannot carry corpus authorship. `provenance.origin` on the ontology release distinguishes a hand-assembled internal release from an automated pipeline release. A release produced by the automated writer/evaluator/signer path therefore remains `machine_pipeline`, as required by Gate 7B. The corpus's model-generated origin is recorded in this decision, its immutable manifest metadata, and the release evidence record; it must not be relabelled as a hand-assembled `synthetic_internal` release.

### Why not widen the enum

Adding a third value would touch the frozen `contracts/m7` enum (requiring a `schema_version` bump, a freeze note, a `SCHEMA_MANIFEST.json` amendment entry, and paired valid/invalid fixtures), the `license_class` ↔ `public_capable` bijection `CHECK` in `db/d1/0012_ontology_pipeline.sql` (a forward-only rebuild migration, since `0012` is applied), the `CHECK` in `0011`, and five TypeScript literal unions — to encode a distinction the runtime does not branch on.

---

## 4. Tradeoffs accepted

Recorded so that these are decisions rather than drift.

**The grounding becomes self-referential.** `meaning_class: "source_supported"` will mean "supported by a source we generated." The `source_support` evaluator dimension still does real work — it checks a record does not exceed its fragment — but it no longer connects a claim to anything outside the system. The pipeline's guarantee narrows from *this traces to a source* to *this traces to a fixed, hashed, reviewable text*. That second guarantee is worth having, and it is not the first one.

**External claims must match.** "Grounded in astrological tradition," "drawn from established sources," or similar would be inaccurate under this decision. Marketing, App Store copy, and the privacy/methodology surface should be checked against it. "Calculated, not invented" remains true and is about the ephemeris path, which is unaffected.

**The corpus is probably not a protectable asset.** Model output is generally not copyrightable in the US absent sufficient human authorship. This does not restrict publishing it — it means the corpus cannot be asserted against a competitor who copies it. If the corpus is intended as a moat, that reasoning does not survive this decision.

**Provider terms still apply.** Publishing model output commercially depends on the generating provider's terms permitting it. Confirm before activation, and record which provider and model produced each edition.

**Review carries the whole load.** With no external source, the only thing standing between a generated claim and a user is the deterministic gate, the nine evaluator dimensions, and human editorial review. The first two are already load-bearing. The third now matters more than it did, and there is no deterministic check at all for appearance, stereotyping, or protected characteristics — only an LLM-judged dimension.

---

## 5. Decision record

| Field | Value |
| --- | --- |
| Decision | `license_class` is a rights flag; model-generated first-party corpora are `licensed_excerpt` |
| Decided by | Repository operator, by explicit rollout approval in the implementation session |
| Date | 2026-08-22 |
| Counsel reviewed | Not recorded; outstanding before public activation |
| Provider terms confirmed | OpenAI public terms reviewed on 2026-08-22; the exact generating account/model record remains outstanding |
| Generating model + version | Not recorded in the supplied corpus; outstanding before public activation |
| Corpus edition authorized | `0.1 (2026)`, 60 fragments, packaged as `pattern-ontology-source-manual-en-us-0.1.0` |
| Public activation authorized | Conditional on Gate 7B, human editorial review, Gates 9–10, and the outstanding counsel/provider record |
| Notes | Packaged corpus hash: `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c` |

### Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Product | Repository operator (explicit session approval) | 2026-08-22 |
| Engineering | Implemented under repository-operator authorization | 2026-08-22 |
| Legal / counsel | Outstanding | |

---

## 6. Implementation checklist

### No change required

- [x] `contracts/m7/pattern-source-fragment.schema.json` — enum unchanged
- [x] `db/d1/0011`, `db/d1/0012` — `CHECK` constraints unchanged
- [x] `apps/api/src/services/ontology-corpus.ts` — `publicCapable` derivation unchanged
- [x] TypeScript literal unions — unchanged

### Documentation to amend

- [x] `LICENSING.md` — add the first-party corpus position
- [x] M7 pipeline design spec — state that `license_class` is publication authority, not authorship provenance
- [x] `pattern-ontology-source-manual-SOW.md` §8.4 — replace the superseded no-AI warranty for this model-generated edition
- [x] Add the `license_class` semantics to `CLAUDE.md` under contracts and licensing

### Before public activation

- [x] Preserve `provenance.origin: "machine_pipeline"` on the automated release; record corpus authorship separately
- [ ] Confirm generating provider's terms permit commercial publication
- [ ] Check user-facing and marketing copy for source-provenance claims that are no longer accurate
- [ ] Human editorial review of every fragment, recorded — this is now the primary control

---

## 7. Related paths

| Path | Role |
| --- | --- |
| `contracts/m7/pattern-source-fragment.schema.json` | `license_class` enum |
| `contracts/m7/pattern-ontology-release.schema.json` | `provenance.origin` |
| `db/d1/0012_ontology_pipeline.sql` | `license_class` ↔ `public_capable` CHECK |
| `apps/api/src/services/ontology-corpus.ts` | `publicCapable` derivation, uniform-class check |
| `LICENSING.md` | Needs a `content/` row |
| `docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md` | Format precedent for this document |
