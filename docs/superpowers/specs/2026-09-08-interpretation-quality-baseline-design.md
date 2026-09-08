# Slice 3: interpretation-quality baseline and contrasting-chart panel

Date: 2026-09-08

Status: specification for review; no editorial certification, provider evaluation, or reader study performed.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Shared source findings: [Slice 1 specification](2026-09-07-source-truth-map-maintenance-design.md).

Source review: commit `6e706741f03253f2807d33380afb529161f3481f` and local files inspected on 2026-09-08. Counts below describe that source; no current production or provider observation is inferred.

## Outcome and evidence categories

Produce a complete coverage assessment of the sixty source fragments and forty admitted internal-ontology records, an adjudicated interpretation rubric, and a small panel that can distinguish source-faithful but generic prose from specific, coherent, understandable prose. A useful baseline may find substantial weaknesses; completion means the evidence is recorded, not that every reading is excellent.

Keep four results independent: calculation correctness, interpretive source support, reading quality, and reader comprehension/usefulness. A signature, passing model verifier, matching citation vocabulary, or reader agreement cannot substitute for another category. The [current provenance register](../../../pattern-corpus/provenance.json) records model-generated first-party material and zero certified human-reviewed fragments; preserve that status until real review evidence justifies a change.

## Immutable inputs and artifacts

Create a versioned evaluation definition under `content/evaluations/interpretation-quality/` with `rubric.json`, `panel.json`, and a README. These are evaluation inputs, not shipped reader prose. Place dated results under `docs/reviews/artifacts/interpretation-quality/<run-id>/`, with separate restricted storage for any later private participant material. Do not copy private readings into repository fixtures.

Every run binds source commit and included file manifest, raw corpus/provenance hashes, prepared corpus identity, recomputed ontology bundle identity, builder source, selection/validation/publication-safety pins, rubric/panel hashes, and exact evaluated output hashes. Provider/model/prompt/transport pins are required for an actual provider sample; missing historical details remain null and unverified rather than inferred from current defaults.

Build a sixty-row fragment register with these logical fields: original `ref`, raw fragment hash, prepared fragment ID, section, admitted record IDs, disposition, omission reason, meaning/support review, tension/counter-expression review, rights/authorship classification, reviewer decision, and evidence references. Use these closed dispositions: `admitted`, `omitted_no_sign_predicate`, `omitted_crosscutting_mapping`, or `unexpected_mapping`.

The expected current mapping is 40 admitted / 20 omitted: eleven §1 bodies, twelve §3 houses, five §4 aspects, four §5 angles, four §6 pattern items, four §7 uncertainty items; twelve §2 and eight §8 omissions. Check these against the real builder; never silently edit the expected total to accept a different release. Each of the forty records receives its own assessment of predicate breadth, proposition support, and contrast-field usefulness. Source text review can identify a needed future corpus amendment without making that amendment in this slice.

## Panel selection

Use twelve existing fictional chart seeds: `exact`, `approximate`, and `unknown`, each with suffixes `01`, `02`, `05`, and `06` under [the M7 fixture corpus](../../../contracts/m7/fixtures/corpus/manifest.json). These are chosen to investigate sparse/dense inputs and conflict/gap cases across all three accuracy classes. The frozen manifest remains at thirty fixtures; the smaller quality panel does not replace or reduce machine activation regression coverage.

Consume each seed's `chart_snapshot` and deterministic features. Re-derive/verify features and run selection against the actual forty-record internal release. Do not import the fixture's embedded ontology, writer output, or declared chain outcome as if it evaluated the current internal release. In particular, a fixture's declared conflict/gap axis describes its authored chain; record whether that condition actually appears after current-source selection. Report an unexercised quality condition as a gap instead of relabeling it covered.

For each accuracy class, compare `01` with `02` for the sparse/dense contrast and `05` with `06` for the supported-meaning/coverage investigation. These are distinct chart cases, not controlled birth-time perturbations of one person. Record the actual distinguishing admitted features before judging specificity.

A case has one of `selected`, `omitted_by_policy`, `generation_failed`, or `output_available`. All twelve cases remain in the report, including refusals/failures. A valid omission is reviewed for honesty and usefulness; it is not assigned a fabricated prose score. A missing sample is not a zero-quality sample or a successful baseline observation.

Offline work may use retained outputs only when their source/pin identity is known and compatible, or clearly labeled synthetic outputs for harness tests. An actual fresh generation panel requires separate bounded provider authorization. The harness never invokes a provider merely because a sample is missing.

## Rubric and adjudication

Use the following dimensions. Scores are ordinal 0–3; do not collapse them into a single quality percentage.

| Dimension | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Claim-level source support | Unsupported/contradicted material | Citation present but material support missing | Main claims supported with minor ambiguity | Every assessed substantive claim supported with boundaries explicit |
| Chart specificity | Interchangeable or wrong chart evidence | Generic despite selected evidence | Distinguishing features meaningfully shape prose | Contrast with another case is clear and source-explainable |
| Coherence and contrasts | Material contradiction | Repetitive or unexplained tension | Coherent, useful tension with some repetition | Coherent, nuanced contrasts and counter-expression |
| Uncertainty/omission explanation | Suppressed fact asserted or misleading certainty | Vague uncertainty language | Correct restrictions and understandable gaps | Restrictions precisely explain inclusion/omission without deficit framing |
| Comprehensibility | Meaning cannot be recovered | Substantial jargon/ambiguity | Meaning and reflection are understandable | Reader can explain meaning, evidence kind, and limits clearly |

For each scored claim, retain its document/unit identity, output hash, quoted span coordinates, cited fragment/meaning IDs, verdict `supported | ambiguous | unsupported | contradicted`, and a short rationale. Citation membership alone never yields `supported`. A claim can faithfully repeat a source yet receive a low specificity score.

Hard defects are a separate list: factual calculation contradiction, suppressed-feature leakage, uncited/unsupported substantive assertion, prohibited claim, private-payload exposure, or misrepresented authorship/evaluation. Do not average away a hard defect. Existing deterministic publication safety remains unchanged; an editorial finding can be broader than those executable checks.

Assign a named primary editorial reviewer before marking adjudication complete. A second named reviewer independently reviews all hard defects and all 0/1 support scores, plus a deterministic twenty-percent sample of remaining scored units. Resolve disagreement with a recorded rationale or retain `disputed`; a disputed material support/safety finding blocks a positive quality conclusion. Reviewers record identity/role, date, rubric version, reviewed output hashes, and conflicts of interest. A model can assist indexing but cannot fill the human reviewer fields.

Choose the additional sample by sorting the remaining units by SHA-256 of `(panel_hash, rubric_hash, output_hash, unit_id)` under a documented canonical encoding, then taking `ceil(0.2 * remaining_unit_count)`. Freeze the primary unit inventory first; tied hashes use canonical unit ID order. This makes the sample reproducible without letting a reviewer select only convenient claims.

Blind the initial prose comparison to chart label and provider label where practical. Then reveal the bound feature/source records for support adjudication. Do not ask readers to infer their actual chart or treat successful matching as empirical validation of astrology. A contrast result is an editorial assessment of whether different inputs produced meaningfully different, supportable prose.

## Controls and reader comprehension

Retain six separate negative controls: wrong citation with similar vocabulary; swapped chart participant/role; suppressed unknown-time house/angle assertion; omitted sign fragment attached to an unrelated predicate; generic text duplicated across contrasting charts; and a proposition repeated as both tension and counter-expression. Define each control's expected decision separately for source/safety and quality. Generic-but-supported material can pass the former and score poorly on the latter.

Record the actual existing checker and reviewer decisions beside those expectations. A missed control is a mandatory baseline finding, not grounds to relabel the control or silently tune publication policy. The harness must preserve that distinction and all mismatches; fixing discovered product defects belongs to a separately scoped change. Synthetic harness reviewer records are explicitly test-only and cannot count as human adjudication.

For the connected-journey study, use fictional material first and record five task answers: identify the edition; explain a connection; distinguish calculation from interpretation; identify withheld/unknown information; and explain the effect of feedback. Record task success, observed difficulty, and participant explanation separately from resonance/usefulness ratings. Recruitment, consent, sample size, and private evidence storage are defined in the study record before involving participants; they are not fabricated by the harness or authorized by this spec.

## Result and completion model

The report includes `coverage_complete`, `panel_execution_complete`, `editorial_review_complete`, and `reader_study_complete` separately, with evidence links. Each may be false. The baseline report is complete when all sixty fragments and forty records are dispositioned, all twelve cases and six controls have explicit outcomes, applicable output judgments are adjudicated or disputed, and remaining sample/study gaps are stated. A report can be complete while reader benefit and public readiness remain unproven.

Publish a prioritized findings list tied to precise records, claims, or omissions. No blanket corpus certification or shipped quality badge follows automatically. A future quality-improvement claim must compare against this frozen baseline with the same dimensions and disclose changed panels/pins.

## Verification and release boundary

Add offline tooling and adjacent tests under `scripts/pattern-release/` so the existing `test:content` lane covers them. Test incomplete/duplicate coverage, wrong corpus/bundle identity, unsupported fixture substitution, omitted cases, incompatible retained outputs, missing reviewer identity, mixed evidence classes, unresolved material disputes, control classification, and changed output after review.

Run deterministic selection/claim-support/publication-safety tests, focused harness tests, `npm run test:content`, and the full gate for any implementation merge. Evidence review is an additional activity, not a substitute for those tests.

The definition/harness, coverage assessment, and adjudication report are separately reviewable deliverables within Slice 3. Provider sampling, participant work, corpus changes, policy changes, and ontology activation retain their own authority and release boundaries. Slice 4 can prototype its journey using labeled fictional relationships while these reviews proceed.
