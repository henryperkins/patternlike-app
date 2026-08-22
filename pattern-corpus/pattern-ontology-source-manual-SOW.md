# Pattern Ontology Source Manual — commissioning brief and statement of work

**Status:** `DRAFT` — for counsel review before issue
**Product:** Pattern-Like Astrology App
**Deliverable:** *Pattern Ontology Source Manual*, en-US, 60 source fragments
**Consumes:** `contracts/m7/pattern-source-fragment.schema.json` (schema_version `0.7.0`)
**License class of record:** `licensed_excerpt`
**Date opened:** 2026-08-22
**Owner:** Product (engineering ingests; legal countersigns)

> This is a commissioning document, not legal advice. The rights language in §8 is a drafting starting point and must be reviewed by counsel and adapted to the contractor's jurisdiction and employment status before it is signed.

---

## 1. Decision summary

| Item | Choice |
| --- | --- |
| Corpus origin | Commissioned original work, first party |
| `license_class` | `licensed_excerpt` — uniform across every fragment in the release |
| Basis for that class | The signed rights assignment in §8 is the license of record |
| `license_resolved` | `true`, set at registration on the strength of the countersigned agreement |
| Public activation | Permitted. `licensed_excerpt` is the only class that sets `public_capable = 1` |
| Volume | 60 fragments, supporting a 40–50 record ontology |
| Locale | `en-US` only. Additional locales are separate commissions |
| Schema change required | None |

### Why `licensed_excerpt` rather than a new enum value

`license_class` is not a description of where text came from. It is the flag that decides whether a corpus may be activated publicly. `apps/api/src/services/ontology-corpus.ts` derives `publicCapable` from it directly, and `db/d1/0012_ontology_pipeline.sql` pins the bijection in a `CHECK` constraint with no third arm:

```sql
CHECK (
  (license_class = 'licensed_excerpt' AND public_capable = 1)
  OR
  (license_class = 'internal_synthetic' AND public_capable = 0)
),
```

Commissioned material under a signed assignment is material we are licensed to publish. It belongs on the `public_capable = 1` side, and `licensed_excerpt` is the name that side already has. Adding a value would touch the frozen `contracts/m7` enum, two D1 `CHECK` constraints, and five TypeScript literal unions, to record a distinction the pipeline does not act on.

**What this costs:** the schema carries no field for the licence itself. `title`, `author`, `edition`, and `location` are the only provenance fields, and all four are optional. There is no rights-holder, licence-identifier, date, or URL field, and `source_url` is on the packet builder's `FORBIDDEN_KEYS` list. The rights record therefore lives entirely outside the corpus — in the countersigned agreement and in a decision note under `docs/legal/`. §8 and §11 exist because the schema cannot hold this.

---

## 2. What is being commissioned

A short reference manual of discrete, neutral propositions about astrological factors, written so that each one can be registered as a **source fragment** and cited by generated ontology records.

The writer is producing **source material**, not finished user-facing copy. Nothing written under this agreement is shown to an end user verbatim.

### Volume and shape

| | |
| --- | --- |
| Fragments | 60 |
| Excerpt length | 400–1,400 characters each (hard schema ceiling 2,000) |
| Normalized proposition | One sentence, ≤ 200 characters |
| Total prose | Roughly 8,000–12,000 words |
| Format | One JSON array, UTF-8, plus a separate reviewer-notes file |

---

## 3. The fragment record

Each fragment must supply the following. Column three flags where this brief is stricter than the schema — those fields validate as absent or empty, so the contract has to require them instead.

| Field | Schema constraint | Required by this SOW |
| --- | --- | --- |
| `ref` | *not in schema* | **Yes.** Stable kebab-case slug, unique. Used to mint the `srcf_` id at registration. The writer does not generate ids |
| `title` | optional string, no `minLength` | **Yes.** Constant: `Pattern Ontology Source Manual` |
| `author` | optional string, no `minLength` | **Yes.** Contractor's legal or professional name, identical on every fragment |
| `edition` | optional, `minLength 1` | **Yes.** `1.0 (2026)` |
| `location` | optional, `minLength 1` | **Yes.** Section reference within the manual, e.g. `§2.7 Saturn` |
| `locale` | BCP 47 | `en-US` |
| `normalized_proposition` | required, `minLength 1`, no ceiling | One sentence stating the tendency in plain language |
| `excerpt` | required, 1–2,000 chars | The authored passage the proposition is drawn from |
| `exclusions` | optional array | **Yes, ≥ 2 per fragment.** See §5 |
| `license_class` | required enum | `licensed_excerpt` on every fragment. A mixed corpus is refused with `ontology_corpus_manifest_invalid` |
| `allowed_transformations` | required array, empty validates | **Yes, ≥ 1.** See §6 |

`corpus_release_id` and `id` are set by ingestion. The writer supplies neither.

Note that the schema sets `additionalProperties: false`, so the delivered file is *not* itself a valid corpus manifest and is not meant to be. Registration strips `ref`, mints the `srcf_` id from it, and injects `corpus_release_id`. Validation happens after that transform.

### Worked example

```json
{
  "ref": "saturn-position-weight",
  "title": "Pattern Ontology Source Manual",
  "author": "A. N. Contractor",
  "edition": "1.0 (2026)",
  "location": "§2.7 Saturn",
  "locale": "en-US",
  "license_class": "licensed_excerpt",
  "normalized_proposition": "Saturn is associated with slowing down and testing a commitment before accepting it.",
  "excerpt": "Where Saturn sits, the reported experience is usually one of weight and delay. Work in that area tends to feel effortful out of proportion to its size, and easy agreement tends to feel suspect. People often describe holding back until something has been checked, and describe the check as reassuring rather than reluctant. The same tendency read from the other side is durability: what is accepted slowly is frequently what is still being maintained years later. Neither reading is more correct than the other, and the same person commonly reports both at different times.",
  "exclusions": [
    "clinical depression",
    "a guaranteed outcome",
    "a medical condition"
  ],
  "allowed_transformations": ["intersection", "contrast", "tension", "counterbalance", "developmental_arc", "expression_range"]
}
```

---

## 4. Writing rules

These are not style preferences. Ontology records derived from a fragment inherit its vocabulary, and the pipeline rejects records deterministically. A fragment written with the wrong words produces records that cannot be compiled, and the compiler fails the whole release rather than dropping a record.

### 4.1 Prohibited vocabulary — hard rejection

`apps/api/src/services/ontology-candidate-validation.ts` refuses any record whose proposition, tensions, or counter-expressions match:

```
diagnosis | diagnose | diagnosed | diagnosing
predict | prediction | predicts | predicted | predicting | predictive
cause | causes | caused | causing | causation | causal
inevitable | inevitably | inevitability
fate
biography | biographical | biographic
life event | life events
```

Word-boundary matched, case-insensitive. **Do not use any of these words, in any grammatical form, anywhere in a fragment** — not in the proposition, not in the excerpt, not to deny them. "This does not cause anxiety" fails exactly as "this causes anxiety" fails.

Substitutes that pass: *is associated with*, *tends toward*, *often reported alongside*, *shows up as*, *the usual description is*.

### 4.2 Named prohibited-claim policy

Policy `1.0.0` enumerates four classes the corpus must never support: **diagnosis, prediction, fate, biographical fact.**

Concretely, a fragment may not assert or imply:

- any health, mental-health, or clinical state, or anything that reads as one
- a specific future event, or that anything is certain, guaranteed, or unavoidable
- biography — childhood, family, profession, relationship status, trauma, or current circumstances
- legal, financial, or medical advice, or anything framed as a substitute for a professional
- physical appearance, or any protected characteristic

The last two are **not** caught by the deterministic regex — only by an LLM evaluator dimension. They will pass the cheap gate and fail the expensive one, or worse, pass both. Treat them as the writer's responsibility.

### 4.3 Voice

From `apps/web/PRODUCT.md`:

> The voice is calm, precise, direct, and non-mystifying. It leads with ordinary language, makes uncertainty visible, and avoids cosmic spectacle, prediction, diagnosis, gamification, and generic sign-based filler.

In practice:

- Ordinary words over technical or mystical ones. "Slows down" over "restricts the native's initiative."
- Possibility stays possibility. Never a tendency stated as a certainty.
- No second-person prophecy. Write about what the factor is associated with, not about what the reader will do.
- **Banned as hype:** *amazing, incredible, unlock, manifest, destiny, magical, epic, game-changing*. Exclamation marks are refused outright downstream.
- Do not write a fragment that only works if the reader already believes astrology is predictive.

### 4.4 Two-sidedness

Every fragment must carry both a tension and a genuine counter-expression, and they must be different possibilities rather than the same claim restated. `source_supported` records require non-empty `tensions`, `counter_expressions`, and `prohibited_claims`, and they are drawn from the fragment. A one-sided fragment cannot produce a valid record.

The evaluator scores nine dimensions and passes only if all nine pass. Three of them — `one_sided_or_essentialist_framing`, `tension_counter_expression_balance`, `unsupported_expansion` — are about exactly this.

### 4.5 Uncertainty

Some charts arrive without a birth time, which suppresses houses, angles, and time-sensitive Moon claims. A fragment about a house or an angle must be written so that its absence is unremarkable, not so that a reading missing it reads as broken.

---

## 5. Exclusions — how they actually work

`exclusions` is a **literal, case-insensitive substring denylist**, not a semantic one. If the full text of a derived record contains an exclusion string anywhere, the record is refused. An empty or blank string refuses unconditionally, so never ship one.

This has two consequences the writer must be briefed on:

**Too broad and you block good records.** An exclusion of `"anxious"` refuses any record that uses the word at all, including one using it correctly.

**Too narrow and you block nothing.** An exclusion of `"this is a medical diagnosis"` only fires on that exact sentence, which no drifting record would produce anyway.

Aim for two- to four-word noun phrases that appear only when drift has happened: `"clinical depression"`, `"a guaranteed outcome"`, `"your career will"`, `"a medical condition"`. Supply at least two per fragment, and expect a round of tuning after the pilot batch when we can see what real records look like.

The reference fixtures use `"medical diagnosis"` and `"certain future event"` as a baseline. Both are reasonable defaults to include.

---

## 6. `allowed_transformations`

Each fragment declares which derivations it may participate in. A `derived_synthesis` record is refused unless **every** terminal fragment it descends from permits that transformation class, so an under-declared fragment quietly shrinks what the ontology can express.

| Value | Grant it when the fragment... |
| --- | --- |
| `intersection` | describes something that can meaningfully co-occur with another factor |
| `contrast` | has a clear opposite worth naming |
| `tension` | contains an internal pull in two directions |
| `counterbalance` | describes something that offsets or moderates another tendency |
| `developmental_arc` | describes something that changes over time or with practice |
| `expression_range` | admits a spectrum from understated to pronounced |
| `shared_motif` | shares a theme with structurally unrelated factors |

Declare every class the fragment genuinely supports. Do not declare all seven reflexively — the writer's judgement here is part of what is being bought.

---

## 7. Coverage

Sixty fragments allocated against the frozen `contracts/m0` enums, so that every predicate type the ontology can express has source support.

| Area | Enum members | Fragments |
| --- | --- | --- |
| Bodies | `sun, moon, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto, true_node` | 11 |
| Angles | `ascendant, midheaven` (+ descendant, IC as counterpoints) | 4 |
| Signs | the twelve, written as modes of expression rather than character types | 12 |
| Houses | the twelve, written as areas of life rather than fixed outcomes | 12 |
| Aspects | `conjunction, sextile, square, trine, opposition` | 5 |
| Chart patterns | multi-body configurations | 4 |
| Uncertainty | how to speak when a factor is suppressed or the birth time is unknown | 4 |
| Cross-cutting | material seeding tension and counterbalance across the above | 8 |
| **Total** | | **60** |

Sign and house fragments are where "generic sign-based filler" is most likely to appear. They will be reviewed hardest.

Life-domain vocabulary, where a fragment reaches for one, should use the `lifeDomain` enum: `self, relationships, work, creativity, home, body_energy, money_resources, learning, community, caregiving, spirituality_meaning`. It is not a clinical taxonomy and must not be used as one.

---

## 8. Rights

The operative point: **the rollout approval authorises execution; it does not create the rights the corpus needs.** This section is what does that, and setting `license_resolved: true` without it in hand would be an assertion rather than a fact.

### 8.1 Assignment

The contractor assigns to the client, absolutely and by way of present assignment of future rights, all right, title, and interest worldwide in the deliverables and all copyright and database rights in them, for the full term including all renewals, extensions, and reversions.

Where any right does not vest by assignment or as work made for hire, the contractor grants instead a **perpetual, irrevocable, worldwide, non-exclusive, royalty-free, fully paid-up, sublicensable, and transferable licence** to the same effect.

### 8.2 Permitted uses — enumerate, do not imply

The licence expressly permits, without further consent, payment, or notice:

- **excerpting** — reproducing any portion, including single sentences, out of surrounding context
- **modification and adaptation** — editing, rewriting, condensing, expanding, restructuring, and normalising, including changes that alter meaning
- **translation and localisation** into any language
- **automated processing** — storing, hashing, indexing, embedding, tokenising, and submitting the deliverables to machine-learning systems, including third-party model providers, for the purpose of generating derived records
- **derivative works** — creating ontology records, propositions, tensions, counter-expressions, and user-facing readings that are derived from the deliverables and that carry no attribution to the source
- **commercial distribution** in any medium now known or later developed, including public activation in a paid consumer product
- **sublicensing and assignment** to affiliates, successors, and acquirers

Counsel should confirm the automated-processing clause is drafted broadly enough to cover model providers who retain inputs transiently.

### 8.3 Attribution and moral rights

The corpus records `author` internally, but nothing in the product surfaces it and no reading cites a source. The contractor therefore waives, to the fullest extent permissible, all moral rights including the right to be identified as author, and agrees that no attribution is required in any end-user-facing output. Where waiver is not permissible, the contractor agrees not to assert those rights.

### 8.4 Warranties

For edition 0.1, the project records that the deliverables are model-generated first-party material rather than human-authored contractor copy. Before public activation, the project must retain evidence that:

- no unpublished third-party source text was supplied for copying, adaptation, or paraphrase
- the generating provider's applicable terms permit the project's commercial use of the output
- the exact provider, model/version, account context, and generation date are recorded with the edition
- a human editor reviewed every fragment for third-party copying, stereotyping, protected-characteristic claims, safety, and product voice

Under `ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md`, `licensed_excerpt` is the publication-rights class, not a claim of human authorship. `internal_synthetic` remains the class for experiments and unreviewed drafts intentionally withheld from public activation. The corpus origin must remain explicit in the decision and review evidence; it must not be rewritten as human-authored provenance.

Add an indemnity for third-party IP claims arising from breach, and require the contractor to disclose any prior publication of substantially similar material.

### 8.5 Licence of record

For a commissioned human-authored edition, the countersigned agreement is the licence referenced by `license_class: "licensed_excerpt"` and `license_resolved: true`. For model-generated first-party edition 0.1, `ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md` is the authorization record and `LICENSING.md` links it.

Neither record substitutes for counsel review. Public activation retains the conditions listed in the decision record.

---

## 9. Acceptance

A fragment is accepted when all of the following hold.

**Machine checks** — run by us, on delivery, before review:

- [ ] validates against `contracts/m7/pattern-source-fragment.schema.json` once `ref` is stripped and ids are injected
- [ ] `license_class` is `licensed_excerpt` on every fragment, with no exceptions
- [ ] `excerpt` within 400–2,000 characters
- [ ] zero matches against the §4.1 prohibited-vocabulary regex
- [ ] zero hype terms, zero exclamation marks
- [ ] `allowed_transformations` non-empty; `exclusions` has ≥ 2 entries, none blank
- [ ] `ref` unique across the corpus

**Editorial review:**

- [ ] tension and counter-expression are genuinely distinct possibilities
- [ ] no health, biographical, appearance, or protected-characteristic content
- [ ] voice matches §4.3 and does not read as fortune-telling
- [ ] sign and house fragments say something specific rather than generic

**Pipeline review**, on the pilot batch and again on final delivery:

- [ ] a trial ontology generation produces records that pass deterministic validation
- [ ] the evaluator returns `pass` on all nine dimensions
- [ ] `compileValidatedRelease` succeeds

Fragments that fail machine checks are returned for correction at no charge. Fragments that fail editorial or pipeline review get one revision round within scope; further rounds are billable.

---

## 10. Milestones

| # | Deliverable | Gate | Payment |
| --- | --- | --- | --- |
| 0 | Briefing call — walk through §4, §5, §6 and the AI warranty | — | — |
| 1 | **Pilot: 8 fragments** spanning one body, one sign, one house, one aspect, one angle, one pattern, one uncertainty, one cross-cutting | Full §9 acceptance including a trial pipeline run | 20% |
| 2 | 30 further fragments | Machine + editorial | 40% |
| 3 | Final 22 fragments, plus revisions from 1 and 2 | Full §9 on the complete 60 | 40% |

**Do not skip the pilot.** It is where we discover that an exclusion string is too broad, that a transformation class was under-declared, or that a whole category of phrasing trips the regex. Finding that at fragment 8 costs a week; finding it at fragment 60 costs the commission.

### Delivery format

- `fragments.json` — a single UTF-8 JSON array, in the shape of §3
- `reviewer-notes.md` — one short paragraph per fragment: what tension it is carrying, why those exclusions, why those transformation classes. Not ingested; used for review, in the idiom of the `reviewer_notes` field in `content/pattern-candidates/candidates.json`
- Delivered by direct file transfer. Not via a third-party service whose terms claim any licence in uploaded content

---

## 11. Out of scope

The contractor is **not** being asked to:

- determine copyright status of anything, or advise on licensing
- source, quote, or adapt existing published astrological texts — including public-domain ones
- write user-facing readings or marketing copy
- generate `srcf_` ids, hashes, `corpus_release_id`, or any manifest field
- author ontology records — those are generated and evaluated by the pipeline

The pipeline explicitly does not acquire sources or assess licences; `license_resolved` is an authorisation we assert, never something inferred from a title or an author. This SOW is the thing that makes that assertion true.

---

## 12. Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Product | | |
| Engineering | | |
| Legal / counsel | | |
| Contractor | | |

---

## 13. Related paths

| Path | Role |
| --- | --- |
| `contracts/m7/pattern-source-fragment.schema.json` | Fragment schema, `license_class` enum |
| `contracts/m7/pattern-source-corpus-release.schema.json` | `license_resolved`, corpus hash |
| `contracts/m7/common.schema.json` | `transformationClass` enum |
| `contracts/m0/common.schema.json` | `celestialBody`, `aspectType`, `lifeDomain` |
| `db/d1/0012_ontology_pipeline.sql` | `license_class` ↔ `public_capable` CHECK |
| `apps/api/src/services/ontology-candidate-validation.ts` | Prohibited-vocabulary regex, exclusions matching |
| `apps/api/src/services/ontology-pipeline-command.ts` | Prohibited-claim policy `1.0.0` |
| `apps/api/src/services/ontology-prompt.ts` | Nine evaluator dimensions |
| `apps/api/src/services/ontology-corpus.ts` | `publicCapable` derivation, uniform-class check |
| `apps/web/PRODUCT.md` | Editorial voice |
| `content/pattern-candidates/` | Reviewer-notes idiom |
| `docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md` | House format for the decision note |
