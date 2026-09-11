# Slice 3: interpretation-quality baseline and contrasting-chart panel

Date: 2026-09-08

Reconciled: 2026-09-09 against the [updated alignment roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md), especially section 6.3.

Status (2026-09-09): source/record assessment and the twelve-case offline panel are complete; see the [baseline findings](../../reviews/artifacts/interpretation-quality/2026-09-09-baseline/README.md). Six synthetic controls and retained-output compatibility were assessed. The separately approved [counter-expression fix](../../reviews/artifacts/interpretation-quality/2026-09-09-counter-expression-fix/README.md) is locally implemented; its unsigned 0.1.1 candidate preserves the baseline and awaits any later release action. The subsequently approved [applicability fix](../../reviews/artifacts/interpretation-quality/2026-09-09-applicability-fix/README.md) creates unsigned 0.1.2 with 36 records from 35 fragments; its paired selection and [four-sample provider comparison](../../reviews/artifacts/interpretation-quality/2026-09-09-applicability-fix/provider-comparison.md) are recorded separately. Both unknown-time helper chains passed; the exact-time samples exposed a length rejection and an apparent existing prohibited-claim false positive. Human editorial adjudication and a reader study remain outstanding; no quality certification is claimed.

Scope simplified: 2026-09-09. Start with a reviewable quality assessment using existing corpus, selection, and evaluation helpers. This slice adds no verification gate, mandatory report validator, or release-preflight dependency; local verification uses focused tests for changed behavior, and merges retain the existing [repository policy](../../../AGENTS.md).

Subsequent approved follow-up: the [retained-prose diagnosis](../../reviews/artifacts/interpretation-quality/2026-09-09-retained-prose-diagnosis/README.md) confirms the exact-before chapter has 245 counted words and correctly fails the unchanged 250-word minimum. The exact-after phrase “You do not have to predict what…” exposed a lexical false positive, corrected locally under publication-safety 1.0.1 with focused rejection controls. All 22 original comparison artifacts remain unchanged. No new provider call or ontology activation occurred, and the safety correction was excluded from Slice 4’s separate deployment. A [human-review worksheet](../../reviews/artifacts/reader-feedback/2026-09-09-implementation/human-review-worksheet.md) now links the retained samples and comprehension tasks; reviewer decisions and results remain unfilled.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Shared source findings: [Slice 1 specification](2026-09-07-source-truth-map-maintenance-design.md).

Original source review: commit `6e706741f03253f2807d33380afb529161f3481f` and local files inspected on 2026-09-08. The September 9 reconciliation uses `d338b86c9444ebe2f372f2a2f3990f4a1270bc80` and the roadmap's targeted source follow-up. Its sixty-fragment/forty-record mapping and earlier offline results remain dated evidence, not a new evaluation or production observation. The design below defines the assessment and review requirements; the linked baseline report records which work was actually completed and which evidence remains missing.

## Outcome and evidence categories

Produce a complete coverage assessment of the sixty source fragments and forty admitted internal-ontology records, an adjudicated interpretation rubric, and a small panel that can distinguish source-faithful but generic prose from specific, coherent, understandable prose. A useful baseline may find substantial weaknesses; completion means the evidence is recorded, not that every reading is excellent.

Use that baseline to locate weak distinctions in the source material, its admitted predicates, or the generated prose before choosing an editorial, mapping, or generation change. Record uncertainty about the cause when the available evidence cannot distinguish these stages; a low prose score alone does not identify the origin of the weakness.

Keep four results independent: calculation correctness, interpretive source support, reading quality, and reader comprehension/usefulness. A signature, passing model verifier, matching citation vocabulary, or reader agreement cannot substitute for another category or establish validated psychological truth about a reader's traits or events. The [current provenance register](../../../pattern-corpus/provenance.json) records model-generated first-party material and zero certified human-reviewed fragments; preserve that status until real review evidence justifies a change.

## Immutable inputs and artifacts

Record the rubric, selected panel, inputs, and dated findings in a reviewable report under `docs/reviews/artifacts/interpretation-quality/<run-id>/`. Markdown tables are sufficient; separate JSON definitions or a report validator are optional conveniences, not completion requirements. These are evaluation records, not shipped reader prose. Use separate restricted storage for any later private participant material; do not copy private readings into repository fixtures.

Identify the source revision, corpus and ontology versions/hashes, assessment rubric, selected cases, and exact outputs being reviewed using the existing records. Retain selection/validation/publication-safety and provider/model/prompt/transport pins when comparing generated samples; missing historical details remain unknown rather than inferred from current defaults. No new candidate-tree capture or release receipt is required for this assessment.

Build a sixty-row fragment register with these logical fields: original `ref`, raw fragment hash, prepared fragment ID, section, admitted record IDs, disposition, omission reason, meaning/support review, tension/counter-expression review, rights/authorship classification, reviewer decision, and evidence references. Use these closed dispositions: `admitted`, `omitted_no_sign_predicate`, `omitted_crosscutting_mapping`, or `unexpected_mapping`.

The expected current mapping is 40 admitted / 20 omitted: eleven §1 bodies, twelve §3 houses, five §4 aspects, four §5 angles, four §6 pattern items, four §7 uncertainty items; twelve §2 and eight §8 omissions. Check these against the real builder; never silently edit the expected total to accept a different release. Each of the forty records receives its own assessment of predicate breadth, proposition support, and contrast-field usefulness. Source text review can identify a needed future corpus amendment without making that amendment in this slice.

## Locating weak distinctions and comparing changes

For each weak contrast, trace the same material through the following stages and attach exact fragment, record, selected-feature, and output references where available:

| Stage | Question | Evidence to retain |
| --- | --- | --- |
| Source material | Does the fragment itself supply a specific meaning, useful tension, and distinct counter-expression? | Reviewed source spans, repeated propositions, and a recorded editorial rationale |
| Admitted predicates and mapping | Does admission preserve that distinction and apply it only to supported features? | Predicate scope, omission disposition, selection results, and the builder's mapped fields |
| Generated prose | Does the reading express the admitted distinction coherently and without unsupported additions? | Bound selected meanings and claim-level output judgments across contrasting cases |

The [internal builder](../../../apps/api/scripts/build-internal-ontology.ts) uses sentence matching for tensions and counter-expressions and can fall back to the same normalized proposition in both fields. Record where that happens and whether a useful distinction existed in the source; successful compilation alone does not answer either question. Trace omitted cross-cutting meanings into prompts or publication policy before concluding that an omission removes a safeguard. A missing sign predicate does not authorize attaching sign-specific meaning to an unrelated broad predicate.

Freeze the baseline before assessing a proposed improvement. For a separately scoped comparison, state the hypothesis and vary one layer at a time: source editorial material, predicate/mapping behavior, or prose-generation instructions. Keep the chart panel, rubric, selection and safety policies, and provider/model/transport settings stable except for the explicitly tested change and its necessary derived identities. Record all changed hashes and any unavoidable additional differences; such differences limit attribution. Preserve original baseline outputs and assess paired outcomes with the same adjudication rules. Do not treat an uncontrolled new sample or a changed panel as proof that the intervention improved quality.

An improved written Pattern may provide better material for chapter images and meshes, but artwork requires separate fidelity measures. Assess image correspondence to the exact source chapter and approved visual metaphor, mesh correspondence to its accepted image, and preservation of source/revision identity separately from the prose rubric. Authored reading folios are navigation furniture, not generated interpretations. Neither faithful artwork nor visual appeal establishes interpretation quality or psychological validity; artwork generation is not required to complete this baseline.

## Panel selection

Use twelve existing fictional chart seeds: `exact`, `approximate`, and `unknown`, each with suffixes `01`, `02`, `05`, and `06` under [the M7 fixture corpus](../../../contracts/m7/fixtures/corpus/manifest.json). These are chosen to investigate sparse/dense inputs and conflict/gap cases across all three accuracy classes. The frozen manifest remains at thirty fixtures; the smaller quality panel does not replace or reduce machine activation regression coverage.

Consume each seed's `chart_snapshot` and deterministic features. Re-derive/verify features and run selection against the actual forty-record internal release. Do not import the fixture's embedded ontology, writer output, or declared chain outcome as if it evaluated the current internal release. In particular, a fixture's declared conflict/gap axis describes its authored chain; record whether that condition actually appears after current-source selection. Report an unexercised quality condition as a gap instead of relabeling it covered.

For each accuracy class, compare `01` with `02` for the sparse/dense contrast and `05` with `06` for the supported-meaning/coverage investigation. These are distinct chart cases, not controlled birth-time perturbations of one person. Record the actual distinguishing admitted features before judging specificity.

A case has one of `selected`, `omitted_by_policy`, `generation_failed`, or `output_available`. All twelve cases remain in the report, including refusals/failures. A valid omission is reviewed for honesty and usefulness; it is not assigned a fabricated prose score. A missing sample is not a zero-quality sample or a successful baseline observation.

Offline work may use retained outputs only when their source/pin identity is known and compatible, or clearly labeled synthetic examples to check the rubric. An actual fresh generation panel requires separate bounded provider authorization. A missing sample does not trigger a provider call.

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

Choose and record the additional sample before the second review, using a simple reproducible rule over the fixed unit inventory, such as every fifth unit in stable ID order. Include at least one unit when any remain. Preserve the chosen list so a reviewer cannot silently select only convenient claims; no sampling tool is required.

Blind the initial prose comparison to chart label and provider label where practical. Then reveal the bound feature/source records for support adjudication. Do not ask readers to infer their actual chart or treat successful matching as empirical validation of astrology. A contrast result is an editorial assessment of whether different inputs produced meaningfully different, supportable prose.

## Controls and reader comprehension

Retain six separate negative controls: wrong citation with similar vocabulary; swapped chart participant/role; suppressed unknown-time house/angle assertion; omitted sign fragment attached to an unrelated predicate; generic text duplicated across contrasting charts; and a proposition repeated as both tension and counter-expression. Define each control's expected decision separately for source/safety and quality. Generic-but-supported material can pass the former and score poorly on the latter.

Record the actual existing checker and reviewer decisions beside those expectations. A missed control is a baseline finding, not grounds to relabel the control or silently tune publication policy. Preserve that distinction and all mismatches in the report; fixing discovered product defects belongs to a separately scoped change. Synthetic reviewer examples are explicitly test-only and cannot count as human adjudication.

For the connected-journey study, use fictional material first and record five task answers: identify the edition; explain a connection; distinguish calculation from interpretation; identify withheld/unknown information; and explain the effect of feedback. Record task success, observed difficulty, and participant explanation separately from resonance/usefulness ratings. Recruitment, consent, sample size, and private evidence storage are defined in the study record before involving participants; they are not fabricated by a report or authorized by this spec.

## Review-mode decision — 2026-09-11

The user selected AI primary and independent secondary editorial reviews for this integration. Apply the existing claim-level rubric and preserve disagreements, output identities and hard defects in a separately labeled AI assessment. The earlier human-review procedure remains a possible later study, not a prerequisite for this authorized AI assessment. AI walkthrough answers may assess the information presented by the fictional journey; they are not participant explanations, observed human comprehension, independent empirical validation, or corpus certification. Do not fill the historical human worksheet with invented people or sessions.

## Result and completion model

State separately whether source coverage, panel execution, editorial review, and reader study are complete, with links to the work actually performed. The baseline report is complete when all sixty fragments and forty records are dispositioned, all twelve cases and six controls have explicit outcomes, applicable output judgments are adjudicated or disputed, and remaining sample/study gaps are stated. A report can be complete while reader benefit and public readiness remain unproven. These are assessment notes, not a new release checklist or machine-enforced schema.

Publish a prioritized findings list tied to precise records, claims, or omissions, with the implicated source/mapping/prose stage and unresolved attribution recorded. No blanket corpus certification or shipped quality badge follows automatically. A future quality-improvement claim must use the controlled comparison above, report the same dimensions, and disclose changed panels/pins. Visual-fidelity results remain separately labeled evidence.

## Verification and release boundary

Use existing corpus preparation, selection, and evaluation helpers for the assessment. Review coverage, source/output identity, missing or incompatible cases, evidence categories, and disputed findings in the report. A new harness, automatic report validator, test lane, or addition to `test:content` is not required. Any optional helper remains a focused manual tool.

For a behavior change arising from a finding, add or run focused regression tests in the owning suite, including affected deterministic selection, claim-support, or publication-safety behavior. Assessment-only edits need source/report review. Follow the existing repository merge policy when merging; the quality report is not an additional merge gate.

The coverage assessment and editorial findings are separately reviewable deliverables within Slice 3; neither depends on building new verification infrastructure. Provider sampling, participant work, corpus changes, policy changes, and ontology activation retain their own authority and release boundaries. Slice 4 can prototype its journey using labeled fictional relationships while these reviews proceed.
