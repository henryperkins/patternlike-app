# Ontology regression diagnosis — candidate 0.1.16

**Date:** 2026-08-24
**Status:** Diagnosis complete. Fixes A, B and C applied (see §6).
**Blocks:** creating immutable candidate `pattern-ontology-en-us-0.1.17`.

The internal Codex ontology canary reached the regression gate and failed. This
records what failed, how it was established, and what has to change before
another immutable candidate version is spent.

Both rollouts remain `off`. Nothing here was signed, released, or activated.

## 1. The failed run

| Field | Value |
| --- | --- |
| `run_id` | `oprun_f335b261-8925-491a-b775-bf03ddf8b1fd` |
| `candidate_ontology_version` | `pattern-ontology-en-us-0.1.16` |
| `corpus_release_id` | `pattern-ontology-source-manual-en-us-0.1.0` |
| `corpus_hash` | `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c` |
| `configuration_hash` | `sha256:2f31e1a5205b2031fd2c1d2f51ffd24a802099fa2e5d1629ea9b67bf9b3e5eae` |
| `candidate_hash` | `sha256:c83cca471c837c5f56a86be05b85efe46f4f7c795e30f8db15bd13fb8aceb0ae` |
| `compilation_report_hash` | `sha256:05713a9b0941a9193531488cebe78e8d65f0cc21b98fea49f5debb8c70194f03` |
| `evaluation_report_hash` | `sha256:b3f8a48ed0f5474a9375df62576c0ea76e8f624f5efca6183befe1b4e923f781` |
| `regression_report_hash` | *null* |
| terminal state | `stage=failed`, `failure_class=regression_failed` |
| terminal coordinates | `stage_generation=21`, `stage_cursor=6`, `stage_attempt=0` |
| created / failed | `2026-08-24T07:06:38.105Z` / `2026-08-24T07:22:34.600Z` |
| artifact expiry | `2026-08-31T07:22:34.600Z` |

Generation, compilation, and evaluation all succeeded. `regression_report_hash`
is null because `createCanonicalOntologyRegressionReport` throws before
returning whenever `passed` is false — **a failed regression writes no report.**
The per-pass `regression_result` artifacts and the Worker log line are the only
evidence, and both expire with the run on 2026-08-31.

## 2. What failed, exactly

Workers Logs, `patternlike-api-production` script version
`b34aec4f-e5c3-4b6e-82ff-0c73ebeb3304`, trace
`trc_1bdf43d4a5a3fe1cc78e0241d3786552`, at `2026-08-24T07:22:34.600Z` — the
run's `failed_at` to the millisecond, and the only such event in the window:

```json
{
  "level": "warn",
  "message": "ontology_regression_hard_gate_failed",
  "fixture_index": 0,
  "pass": "verifier",
  "hard_gate_failures": ["prohibited_claim"]
}
```

**The run never got past the first of thirty fixtures.** `fixture_index: 0` is
`m7-exact-01` (`en-US`, `effective_accuracy: exact`, `declared_outcome:
accepted`). Twenty-nine fixtures were never attempted, so this run says nothing
about cohort thresholds — it is a single-fixture stop, not a quality score.

Cross-run context, from the same log source: `0.1.14`
(`oprun_aeb6a1cb-475c-4688-984a-010ab814dab0`) failed at fixture 16 with
`["prohibited_claim", "suppressed_feature_leak"]` — **two** gates, so
`hardGateFailures.length === 1` was false, `writerCorrectableHardGate` was null,
and it terminated with no correction attempt at all. `prohibited_claim` is
present in both observed hard-gate failures. `0.1.11` and `0.1.12` logged no
hard-gate event, so they reached `regression_failed` by a different route and
are not evidence about the gates.

## 3. How the budget was spent

The `regressing` stage occupied `stage_generation` 14–20, one pass per
generation, three artifacts each:

| gen | request | response | result | pass |
| --- | --- | --- | --- | --- |
| 14 | 10371 | 3694 | 2010 | planner |
| 15 | 7372 | 30563 | 16866 | writer 1 |
| 16 | 20824 | 567 | 2577 | verifier |
| 17 | 7956 | 27555 | 15362 | writer 2 |
| 18 | 19320 | 1637 | 2730 | verifier |
| 19 | 8109 | 26071 | 14622 | writer 3 |
| 20 | 18578 | 567 | 2574 | verifier |

Seven passes, `stage_cursor` 6 at the terminal CAS — `failOntologyPipelineRun`
bumps the generation and leaves the cursor, so the failure committed from the
gen-20 claim. One planner call and the **entire three-call writer budget** were
consumed on fixture 0 alone.

The writer request grew 7372 → 7956 → 8109 across the three attempts. That
growth is the correction document being appended, and its size (~584 then ~153
bytes) is the tell for §5.

## 4. The path is proven, not inferred

`hard_gate_failures` is only ever non-empty on one return in
`applyOntologyRegressionPass` — the final `finishRegressionFixture`, reached
only after `evaluateOntologyRegressionHardGates`, which is reached only when
`verdict.verdict === "pass"`. The `verdict !== "pass"` branch returns earlier
and finishes with an **empty** array.

Two consequences follow, and they are the load-bearing part of this diagnosis:

- **The semantic verifier accepted all three candidates.** This was not a
  semantic refusal. A refusal would have produced empty `hard_gate_failures`,
  no log line, and `advanceCursor` to fixture 1.
- **The gate that fired is deterministic, not model-judged.**
  `containsUnqualifiedProhibitedClaim` is a hardcoded English regex in
  `apps/api/src/services/ontology-regression.ts:413`. It is the sole caller
  site (`:496`) and is **not** on the reader-serving Pattern path.

The three writer→verifier round trips are themselves proof of the branch taken:
the only route back to the writer from a *passing* verdict is
`writerCorrectableHardGate`, which requires `hardGateFailures.length === 1` and
the single gate being `prohibited_claim` (or a writer-only
`suppressed_feature_leak`, impossible on an `exact` fixture). It matches
`["prohibited_claim"]` exactly. On the third candidate `state.writer_calls >= 3`,
the correction branch was no longer available, and the same gate became
terminal.

## 5. Defects

### A. The correction loop is blind — this is why the budget burned

`ontology-regression.ts:929-937` builds the retry correction as:

```ts
buildCorrectionDocument(state.plan, { deterministic: [{ code: writerCorrectableHardGate, message: "" }] }, state.writer_calls)
```

`buildCorrectionDocument` reads `message` as a locator —
`target_key: safeKey(failure.message)` — and `safeKey("")` fails
`CORRECTION_KEY_SHAPE` and returns `null`. The writer therefore received
`{code: "prohibited_claim", origin: "deterministic", target_key: null,
feature_aliases: [], ontology_rule_ids: []}`: *"there is a prohibited claim
somewhere in this multi-chapter document"*, with no chapter, no section, no
sentence. The ~153-byte correction at attempt 3 is that emptiness on the wire.

Every other producer of a deterministic failure puts a chapter key in `message`
(see the comment in `pattern-packet.ts`). The regression harness is the only
caller that passes `""`. Three rewrites against a blind correction converged on
nothing, which is the expected outcome, not bad luck.

`evaluateOntologyRegressionHardGates` cannot supply a key today because
`containsUnqualifiedProhibitedClaim` runs over `allWriterText(writer)` — every
unit flattened and `"\n"`-joined — so the offending unit is discarded before the
gate returns.

### B. The detector flags compliant hedging

The qualifier escape list is `not|never|cannot|can't|does not|isn't|rather
than|without`. It omits the ordinary negators an English writer reaches for.
Measured against the committed regex:

```
FLAGGED "Nothing here is fated."
FLAGGED "This doesn't predict your future."
FLAGGED "There are no guarantees here."
FLAGGED "None of this is inevitable."
FLAGGED "Neither outcome is fated."
FLAGGED "You won't find a prediction here."
FLAGGED "No part of this is a diagnosis."
clean   "This is not a prediction."
clean   "Your chart never guarantees an outcome."
clean   "This describes a tendency, not a prediction."
clean   "This is a description rather than a prediction."
```

Eight of twelve hedged, *compliant* sentences trip the gate. `doesn't`, `no`,
`nothing`, `none`, `neither`, `won't`, and `avoid` are all unrecognised, while
`does not` and `isn't` are recognised. An ontology that teaches "describe
patterns, do not predict" pushes the writer into exactly this register, so the
gate can punish the writer for complying with the corpus.

Two aggravating details:

- Sentence splitting is `/(?<=[.!?])\s+/`. Titles carry no terminal
  punctuation, so a title merges with the following unit's first sentence.
  Whether a trigger word and its qualifier land in the same "sentence" then
  depends on the punctuation of an unrelated heading.
- The gate is hardcoded English and never consults the ontology's own
  `prohibited_claims` / `prohibited_claim_policy_version`, which the compiled
  records already carry (`ontology-packet.ts:45,47`). The machine gate and the
  corpus policy are independent statements of the same rule.

**Note this is a genuine trade-off, not a pure bug.** Widening the qualifier
list weakens a safety gate. It is scoped — the function is regression-only and
cannot affect a reader — but it changes what a machine-ingested ontology has to
survive, so it is a decision to take deliberately.

### C. Codex regression output is labelled `synthetic` (unrelated to this failure)

`ontology-regression.ts:895`:

```ts
provider: input.metadata.provider === "openai" ? "OpenAI" : "synthetic",
```

`PatternPassProvenance.provider` is `PatternPublisherName`, so `codex` and
`workers_ai` both collapse to `"synthetic"`. With
`ONTOLOGY_PIPELINE_PUBLISHER="codex"` the harness projects a public Pattern
whose provenance claims synthetic authorship, through `projectPublicPattern` —
the function whose job is reasserting the public contract.

This did not cause the failure: nothing gates on the field, the projection is
never served, and `{"type": "string"}` accepts it. It is a missed spot in the
same de-hardcoding that produced `regressionPublisherName` and the
`regressionPatternPin` comment ("Still exact, just no longer hardcoded to one
provider") two functions away.

## 6. Fixes applied

A new candidate version is immutable and single-use. Re-running 0.1.17 against
the code as it stood would have re-entered the same blind three-attempt loop, so
all three defects are fixed before a version is spent.

**A — the correction loop now points somewhere.** `ontology-regression.ts` gains
`KeyedWriterUnit`: the two flattened joins (`allWriterText`, `coreWriterText`)
become `allWriterUnits` / `coreWriterUnits`, each unit tagged with its
`chapter_key`, `section_key`, or `signature_key`. Both writer-correctable gates
now report the unit they fired on, and
`writerCorrectableHardGateTargetKey` feeds it to `buildCorrectionDocument` as
`message`, which is read as a locator. A correction that used to say
`{code: "prohibited_claim", target_key: null}` now says
`{code: "prohibited_claim", target_key: "chapter_01_section_01"}`.

The suppression gate was restructured to iterate units rather than the joined
chapter text. That is behaviour-preserving: the joined form split on `\n+` too,
so no sentence ever spanned two units and no `[^.!?\n]{0,80}` window ever
crossed one. Only what the gate can *report* changed.

**B — the qualifier list is widened.** `PROHIBITED_CLAIM_QUALIFIER` now
recognises `no`, `none`, `nothing`, `neither`, `nor`, `doesn't`, `don't`,
`won't`, `aren't` and `avoid` alongside the original eight. All twelve measured
sentences in §5B now classify correctly. This is a deliberate loosening of a
safety gate, taken with its scope in view: the function is reachable only from
the regression harness and never runs on a reader-serving path.

The cost is named rather than hidden: a broader negator set widens the
false-negative surface. "No matter what, your chart predicts success." now
escapes on the bare `no`. That is the same class of hole the list already had —
bare `not` and `never` were always in it, so "It is not impossible that your
chart predicts success." always escaped — and the gate is a coarse lexical net
in front of an independent semantic verifier that runs first and passed all
three 0.1.16 candidates. Extending an existing weakness to more tokens, to fix a
demonstrated and blocking false positive, is the trade taken here. Tightening it
properly means scoping the negator to the trigger's clause rather than its
sentence, which is a separate change with its own false-positive risk.

Per-unit evaluation is itself a small behaviour change in the other direction —
a title, which carries no terminal punctuation, no longer merges with the next
unit's first sentence, so it can no longer borrow that sentence's qualifier.
That is the correct reading and it is now the only one.

**C — one provider label, not two.** `patternProviderDisplayName` in
`pattern-publisher.ts` is now the single definition; `provenanceFromExecutedPin`
and the regression projection both resolve through it. The harness's local
`provider === "openai" ? "OpenAI" : "synthetic"` is gone.

### Tests

- `ontology-regression.test.ts`: the two correction-loop cases asserted
  `target_key: null` — they encoded the defect, and now assert the correction
  names the section the test broke. A new case pins the qualifier list in both
  directions: nine hedged sentences must not fire, three unqualified ones must.
- `pattern-publisher.test.ts`: two new cases pin the labels and assert no real
  provider is ever reported as `synthetic`.

### Still open

- **Re-run against a throwaway candidate version before spending 0.1.17.** The
  fixes are verified by unit tests; they have not been exercised against a live
  provider.
- `compact_provenance.model_family` in the regression projection carries
  `metadata.model` — the exact model id — where the live path
  (`pattern-execute.ts`) maps to a coarse family and keeps the id in the
  encrypted artifact. Left alone deliberately: the projection is never served,
  nothing gates on it, and changing it moves a recorded
  `public_projection_hash`. Worth folding into the next deliberate change to
  that projection.
- Localizing a hard gate is per-gate work. `uncited_astrological_claim`,
  `source_dependency_failure`, `mandatory_feature_omission` and
  `private_projection_leak` are not writer-correctable today, so they still
  terminate without a correction attempt — correct, but it means a corpus defect
  in those classes still costs a whole run to discover.

## 7. Evidence handling

Read-only D1 queries (runbook §10) and Workers Logs only. No artifact was
decrypted; no prompt or response prose was read, exported, or reproduced here.
Artifact byte lengths, hashes, and closed state codes are the whole basis of §3.
The encrypted evidence expires 2026-08-31 — capture anything further before
then.
