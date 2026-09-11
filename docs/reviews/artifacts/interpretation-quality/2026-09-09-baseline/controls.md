# Six synthetic quality controls

Date: 2026-09-09. These are explicit test-only mutations of the existing deterministic writer, using the twelve-chart panel’s actual internal ontology and selected evidence. They are not provider output, reader material, human adjudication, or additional release requirements. Exact target text, coordinates, attributions, expected judgments, output hashes, and observed checks are retained in [controls.json](controls.json).

## Method

The [existing deterministic planner/writer](../../../../../packages/pattern-engine/src/synthetic.ts) supplies the baseline. The planner and writer validate unchanged for the selected control inputs, and their unmodified documents pass deterministic publication safety. Each mutation preserves the existing plan and updates only the recorded text or attribution. The public projection is regenerated using the existing helper before checking it.

Run the existing [candidate validator](../../../../../packages/pattern-engine/src/candidate-validate.ts) and [publication-safety evaluator](../../../../../apps/api/src/services/pattern-publication-safety.ts) over each mutated document. Supply an explicitly **hypothetical semantic pass** to isolate deterministic behavior. No model verifier was run. A passing result here is not an observed semantic approval or evidence that the live publication path would accept the claim.

## Observations

| Control | Explicit mutation | Expected support/quality judgment, pending human review | Actual structural result | Actual deterministic safety result |
| --- | --- | --- | --- | --- |
| C1: wrong citation | Keep Sun-derived prose but cite only the allowed Moon feature and Moon rule | Citation is valid syntactically but does not support the organizing-motive claim | Pass | Pass; no semantic entailment determination |
| C2: swapped participant | Assert “The Moon is in Aries” while the fixture’s Moon is in Gemini and its Sun is in Aries; retain only Sun attribution for that unit | Contradicted by the bound chart; reject the factual substitution | Pass | Pass; general chart-fact truth is not established by this deterministic check |
| C3: suppressed placement | Add “Your Ascendant is in Aries” to the unknown-time case | Reject the withheld angle assertion | Pass | Reject: `suppressed_feature_leak` at `chapter_01_section_01` |
| C4: omitted sign meaning | Attach the omitted Virgo improvement meaning to general Mercury material and a Cancer placement | The admitted general body rule does not authorize that sign-specific interpretation | Pass | Pass; valid existing attribution does not establish meaning support |
| C5: generic duplicate | Insert the same bounded reflection into exact-01 and exact-02 while retaining each case’s attribution | The wording supplies no distinction between the contrasting inputs; score specificity poorly | Pass for both | Pass for both; safety does not measure specificity |
| C6: repeated contrast | Repeat the Sun proposition under both tension and counter-expression labels | Source-supported repetition supplies no useful alternative expression | Pass | Pass; contrast usefulness is an editorial question |

All six controls have explicit outcomes. C3 is the only deterministic rejection in this set. C1, C2, and C4 require semantic source/fact judgment; C5 and C6 expose quality dimensions that structural and safety checks do not measure. These are observed boundaries of the existing checks, not six new tests added to the gate. Expected judgments above are model-assisted analysis, with human editorial review pending.

## Interpretation

The important distinction is between a valid citation and a supported claim. The current [verifier prompt](../../../../../apps/api/src/services/pattern-prompt.ts) already asks for claim entailment, correct participants, and respect for supplied evidence. The controls do not establish its actual success rate: their provider verification was not executed. Likewise, a reader study is needed to measure comprehension and usefulness.

Preserve these examples as comparison inputs for later authorized quality work. Do not silently tune publication policy to make this assessment look successful, count synthetic prose as a current reading sample, or turn this report into a mandatory validator.

## Focused verification

Under Node 22.23.2, the existing pattern-engine test file passed 7/7 tests and the existing publication-safety test file passed 78/78 tests. These support the deterministic baseline used here; they do not fill the semantic or human-review gaps.

```sh
node_modules/.bin/tsx --test packages/pattern-engine/src/engine.test.ts
# From apps/api:
../../node_modules/.bin/vitest run src/services/pattern-publication-safety.test.ts
```
