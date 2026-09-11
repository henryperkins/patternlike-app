# Interpretation-quality baseline

Date: 2026-09-09. **Offline assessment complete; human editorial adjudication, compatible generated prose, and reader comprehension remain unassessed.** This is model-assisted source analysis and deterministic execution, not corpus certification or a claim of improved production readings.

The clearest improvement is to preserve distinctions already present in the source before asking the writer to produce better prose. The builder loses explicit counter-expressions, and selection attaches several meanings without establishing the conditions those meanings describe. These are concrete upstream defects to address; their effect on generated readings remains to be measured.

## Findings and next changes

| Priority | Observed problem | Smallest useful next change | Expected reader benefit and limit |
| --- | --- | --- | --- |
| 1 | **17/40 counter-expression fields repeat the proposition**, although those excerpts contain an explicit alternative expression. The matcher does not recognize the literal `counter-expression` label. | Correct extraction in the internal builder so it retains the source’s actual alternative expression, with focused regression cases for labeled spans and ambiguous matches. Preserve the old baseline and create a separately versioned candidate if the output changes. | Give the writer a meaningful alternative instead of repeated material. Source extraction is measurable offline; improved reader prose still needs a matched comparison. |
| 2 | **Four distinct pattern meanings match every pattern; two uncertainty meanings match every accuracy class.** In the panel, `grand_trine` and `aspect_chain` each receive all four pattern records. Sparse and qualified-location material is selected even for dense exact-time input. | Establish each meaning’s applicability using supported feature conditions. Where the current facts cannot establish the condition, retain an honest omission or clearly scoped guidance rather than assert the condition about the reader. | Reduce unsupported or contradictory framing. A general citation does not prove the specific configuration is present. |
| 3 | **Twelve sign meanings are omitted**, while body rules ignore signs. Actual sign-boundary changes in the panel leave each body’s admitted meaning unchanged. | Design a bounded sign-aware mapping after the extraction/applicability fixes; preserve frozen contracts through an explicit compatible or versioned change. | Improve supported distinctions between charts. The raw sign in the fact packet is not permission to invent missing interpretive support. |
| 4 | **Selection coverage is incomplete:** 34/40 records are exercised; four outer-body/node inputs are absent, and current derivation emits neither Descendant nor Imum coeli angle features. The authored conflict/gap labels also do not transfer to this release. | Add a small, separately identified comparison set when evaluating the chosen fix; investigate whether the two additional angle meanings should be supported or explicitly omitted. | Test the proposed improvement against meaningful contrasts without treating fixture labels or broad matches as quality evidence. |

Priority 1 is the recommended first implementation: it recovers supplied meaning with a narrow builder change. Priority 2 addresses applicability, with distinct source and feature decisions. Neither calls for a new gate, a general verification framework, more permissive safety policy, or a fresh machine-ontology rollout.

## What was completed

| Assessment | Result | Evidence |
| --- | --- | --- |
| Source inventory | All 60 fragments dispositioned: 40 admitted, 12 signs omitted, 8 cross-cutting fragments omitted | [Fragment register](fragment-register.md) |
| Admitted meanings | All 40 records reviewed for predicate scope, proposition support, and retained contrasts; human decisions pending | [Record assessment and policy trace](record-assessment.md) |
| Chart panel | All 12 fixture hashes and regenerated feature sets matched; selection repeated identically; no refusals or capacity omissions; 34 distinct records exercised | [Chart panel](chart-panel.md), [observed data](chart-panel.json) |
| Synthetic controls | All six structurally valid; withheld-angle assertion rejected by deterministic safety. Wrong citation, swapped participant and misapplied sign meaning require semantic judgment; generic duplication and repeated contrasts expose quality gaps | [Controls](controls.md), [exact observations](controls.json) |
| Retained prose | No compatible provider-written bodies available in this checkout; historical runs used a separate 26-record reference ontology | [Retained-output review](retained-output-review.md) |
| Focused existing tests | Pattern engine 7/7; publication safety 78/78 | Commands and scope in [controls](controls.md#focused-verification) |

The rubric remains the five ordinal dimensions in the [Slice 3 specification](../../../../superpowers/specs/2026-09-08-interpretation-quality-baseline-design.md#rubric-and-adjudication): support, specificity, coherence/contrasts, uncertainty explanation, and comprehensibility. No aggregate quality percentage or invented prose score is assigned. Calculation correctness, model agreement, source support, and reader usefulness remain separate questions.

## Limits and handoff

Source base: `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`, with the existing Slice 1 documentation/comment changes. The offline build reproduces corpus `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c` and canonical unsigned ontology payload `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84`. The report attachments retain exact source/record/case identities; the builder’s placeholder hash is not used as evidence.

The panel uses authored fake-calculation snapshots. Re-derivation checks feature extraction, not astronomy. The six controls use explicitly synthetic writer output and a hypothetical semantic pass to isolate deterministic checks; their results do not establish what the real verifier or publication flow would accept.

Human primary and second reviewers remain unassigned. Source judgments, the rubric, and the disputed historical positive control are unadjudicated. Compatible current-panel prose and reader-study evidence are absent. The source coverage and offline panel portions of Slice 3 are complete; the full adjudicated quality baseline remains open. Slice 4 can use the findings and proceed with its fictional connected-journey prototype.

This assessment changes documentation only. No corpus, prompt, policy, application code, gate, package command, provider invocation, or production state was changed. The full local gate was not run, as directed by the user. Existing baseline artifacts and historical results remain intact.
