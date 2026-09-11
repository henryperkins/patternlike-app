# Retained Pattern prose diagnosis — 2026-09-09

The exact-time before sample correctly failed the existing 250-word chapter minimum. The exact-time after sample exposed a false positive in the existing generic prohibited-claim check. The bounded fix changes publication-safety policy from `1.0.0` to `1.0.1`; selection, candidate length policy, prompts, provider output, and ontology activation are unchanged.

## Observed failures

The [original before writer](../2026-09-09-applicability-fix/pinned-cli/samples/exact-02-before-writer.json) has 245 counted words in `chapter_04`, “Methods That Repeat and Agreements That Must Be Shared”: 19 in its summary, 64 and 62 in its two sections, 51 in its tension, and 49 in its counter-expression. Its nine-word title is excluded by the existing `chapterWords` implementation. The non-sparse packet requires at least 250 words. Counting that heading would cross the threshold but would change the established policy; there is no evidence to justify doing so. The writer request supplied the 250-word bound. The retained attempt missed it by five words.

The [original after writer](../2026-09-09-applicability-fix/pinned-cli/samples/exact-02-after-writer.json) passed candidate validation. Its [retained verifier result](../2026-09-09-applicability-fix/pinned-cli/samples/exact-02-after-verifier.json) passed semantic review, then received `prohibited_claim` for `chapter_04`. The exact sentence in its counter-expression is:

> You do not have to predict what the attempt will become in order to recognize this experimental space as part of the Pattern.

It follows two sentences about trying an activity before having a justification for it. This language removes an obligation to forecast the result; it does not assert a result, guarantee, or future event. The existing generic check found `predict`, then rejected its prefix because its direct-negation grammar does not admit `not have to`. Replaying the complete retained counter-expression reproduced that failure before the fix.

## Bounded correction

The same validator now recognizes a clause beginning `You do not have to predict what…` or `You don't have to predict what…`. It applies only to the bare verb `predict`, the anchored reader subject, and the `what` complement. Existing text normalization covers whitespace and typographic apostrophes. Questions and rhetorical question tags remain outside this exception.

This does not add `have` or `to` to the general negation grammar or exempt an entire sentence. Every additional trigger in the same clause, every companion clause, and the separate ontology-prohibited phrase check still runs. Tests preserve rejection of direct predictions, assertions embedded after a disclaimer, chart subjects, indirect negation, double negation, nominal predictions, `predict that…`, and compounds separated by commas, conjunctions, semicolons, colons, periods, newlines, or an em dash. This remains a lexical check; the required semantic verifier still assesses meaning and specific future claims.

## Local evidence

[Before replay](replay-before.json) and [after replay](replay-after.json) use the original retained writer bytes, frozen plans, actual panel selections, and ontology versions. Their scope is candidate validation plus the generic prohibited-claim check. They do not rerun a semantic verifier or constitute a new complete publication approval.

| Retained sample | Candidate validation before → after | Generic prohibited-claim check before → after |
| --- | --- | --- |
| Exact before | `chapter_04:245` → unchanged | No finding → unchanged |
| Exact after | Accepted → unchanged | `chapter_04` → no finding |
| Unknown before | Accepted → unchanged | No finding → unchanged |
| Unknown after | Accepted → unchanged | No finding → unchanged |

Length-only diagnostic clones of the exact-before writer still reject at 249 words and pass candidate validation at 250. Those clones exist only in memory; the appended diagnostic words are recorded in the replay outputs and are not a proposed prose revision or semantic approval.

The new tests first produced seven expected false-positive failures with the original validator. After the fix, all 106 safety unit tests and seven proof tests passed. The existing five integration tests then passed after updating their receipt-version expectation to `1.0.1`. API typecheck and the scoped diff check passed. No mandatory verification command or gate was added.

Commands used on Node 22, with Vitest run from `apps/api`:

```sh
npx vitest run src/services/pattern-publication-safety.test.ts src/services/pattern-publication-safety.integration.test.ts src/services/pattern-publication-proof.test.ts
npx vitest run src/services/pattern-publication-safety.integration.test.ts
```

The first combined run passed 117 of 118 tests; the integration failure was its obsolete `1.0.0` receipt expectation. The second command passed all five affected integration tests after that expectation was updated. The safety module was unchanged between these runs.

From the repository root:

```sh
npm run typecheck --workspace @patternlike/api
npx tsx docs/reviews/artifacts/interpretation-quality/2026-09-09-retained-prose-diagnosis/replay.mjs
```

[The hash inventory](retained-artifact-hashes.json) confirms all 22 pre-existing files in the applicability-fix artifact directory remained byte-identical, including original statuses, provider outputs, and comparison reports. Their historical rejection remains recorded. This work made no provider calls, regenerated no prose, activated no ontology, and performed no publication or deployment. The fix does not establish a higher provider success rate from this small retained sample.
