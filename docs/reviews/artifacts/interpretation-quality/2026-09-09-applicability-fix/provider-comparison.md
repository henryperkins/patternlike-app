# Paired fictional prose comparison

Date: 2026-09-09. The bounded comparison completed with **four generated writer samples and two accepted helper chains**. Both accepted chains are the unknown-time case, one per ontology version. Neither exact-time chain reached complete acceptance. No candidate was activated, no account reading was generated or saved, and no publication policy was changed.

The [completed run](pinned-cli/comparison.json) retains stage outcomes, exact pins, invocation/output hashes, usage, and references to every request document and output. The [source/input identities](comparison-source.json), [candidate](candidate.json), and [paired offline panel](chart-panel.json) identify the changed material. This is an optional evaluation record, not a new gate or release prerequisite.

## Scope and execution

The same two authored fictional snapshots, `exact-02` and `unknown-02`, were rederived and selected against the preserved 0.1.1 and new 0.1.2 candidates. Their selected calculated facts remain the same across versions: 27 for the exact case and 13 for the unknown-time case. Neither sampled case contains pattern features; narrowing stellium applicability is covered by the offline cases/tests, not these generated samples. The source corpus, feature/selection/validation/publication policies, prompts, and models are unchanged. Candidate content and its version-derived identities change; independently generated plans and prose consequently differ too.

The disposable local comparison reused the existing packet builders, Pattern prompts, Codex invocation runner, schemas, plan/candidate validators, semantic-verdict checks, and publication-safety function. It did not add a package command, persistent evaluation framework, or production retry loop. Each stage received one attempt; a rejected stage stopped that chain. Eleven generation invocations ran within the stated twelve-generation ceiling, with no generated-output retries. Observed usage totals were 136,311 input and 54,840 output tokens; these are CLI-reported counts, not independently reconciled billing.

The installed host CLI, 0.153.4, first failed the runner's existing exact-version check before generation. That [local refusal](comparison.json) is preserved separately; its broad error classification says `publisher_auth_failed`, while source inspection established the 0.153.3 requirement. A temporary installation of the required 0.153.3 ran the comparison using the existing ChatGPT login. The global installation and runner policy were unchanged. There were twelve runner invocation attempts including that local pre-generation refusal, and eleven generation calls.

The successful CLI run lasted from `2026-09-09T05:19:38.685Z` to `2026-09-09T05:32:37.364Z`. All passes requested `gpt-5.6-sol`, `xhigh`, with planner prompt `1.0.1`, writer prompt `1.0.3`, verifier prompt `1.0.0-verifier`, and existing text isolation `1.0.0`. Full pins are in the run JSON. These observations establish output from an explicitly configured local CLI process; they are not an independent provider attestation or a durable application publication receipt.

## Outcomes

| Case | 0.1.1 | 0.1.2 |
| --- | --- | --- |
| Exact time | Planner accepted; [writer rejected](pinned-cli/samples/exact-02-before-writer.json): chapter 4 has 245 words against the existing 250-word minimum. No verifier requested. | Planner and [writer accepted](pinned-cli/samples/exact-02-after-writer.json); [semantic verifier passed but publication safety rejected](pinned-cli/samples/exact-02-after-verifier.json) `prohibited_claim` in chapter 4. |
| Unknown time | Planner, [writer](pinned-cli/samples/unknown-02-before-writer.json), [semantic verifier and publication safety](pinned-cli/samples/unknown-02-before-verifier.json) accepted. | Planner, [writer](pinned-cli/samples/unknown-02-after-writer.json), [semantic verifier and publication safety](pinned-cli/samples/unknown-02-after-verifier.json) accepted. |

The exact-time 0.1.2 publication rejection points to: “You do not have to predict what the attempt will become.” The existing deterministic guard admits a limited set of direct negations, and `not have to predict` does not fit them. In context, this appears to be a false positive, not an asserted prediction. That diagnosis comes from source inspection and model-assisted reading; the rejection remains recorded and the guard remains unchanged. A separately scoped fix can investigate this observed negation case without adding another check or dropping prohibited-claim protection.

## What changed in the prose

An unblinded, model-assisted review compared the actual requests and writers. No human reviewer adjudicated scores, and no reader study occurred.

For exact time, both versions correctly say the time is exact and no calculation classes were withheld. The old sample did **not** plainly mislabel the chart as sparse or location-qualified. Its supplied uncertainty rules nevertheless came from sparse-chart and qualified-location fragments, and chapter 2 carried qualification discussion without a supporting location fact. The new candidate removes those rules. Its uncertainty note instead says, “exact timing does not authorize a guess wherever information is absent,” following the conditional methodology from §7.1 without asserting an actual missing factor.

That is a correction in admitted support, not proof of improved personal specificity. The new exact-time sample still repeats general methodological guidance in its note and chapter 5. The independently generated plans and wording prevent attributing the differing validation outcomes to the mapping change alone.

For unknown time, the old request admitted three uncertainty rules even though `sparse_pattern` is false; the new request retains only the unknown-time rule. Both preserve the same four suppressed classes, respect withheld calculations, and avoid explicitly asserting an imprecise birthplace. The revised sample drops repeated length/padding discussion. Chapter prose units citing uncertainty fall from six to three, though general methodology still appears alongside interpretation. Both helper chains accepted; this small pair does not establish improved overall quality or reader comprehension.

## Remaining work

The applicability correction is locally implemented and has retained comparison evidence. The most concrete generation follow-up is the observed negation false positive; the samples also motivate examining repeated methodological commentary before claiming more specific readings. Human editorial adjudication and reader comprehension remain open. Any production activation or deployment still requires its own actual operation; these local artifacts do not change what readers currently receive.
