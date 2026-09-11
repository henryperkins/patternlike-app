# Meaning applicability fix

Date: 2026-09-09. **Implemented locally; the comparison has documented limits.** The [unsigned 0.1.2 candidate](candidate.json) restricts Concentration to a stellium and omits five meanings whose conditions the existing facts cannot establish. Exact birth-time accuracy retains required uncertainty coverage through a separate, source-verbatim methodological record. See the [specific meaning changes](applicability-changes.md).

The candidate has not been signed, activated, or deployed. Saved readings remain unchanged. No new verification command or gate was added.

## Result and identity

| Measure | Preserved 0.1.1 | New 0.1.2 |
| --- | ---: | ---: |
| Ontology records | 40 | 36 |
| Represented source fragments | 40 | 35 |
| Omitted source fragments | 20 | 25 |
| Pattern meanings matching every pattern | 4 | 0 |
| Uncertainty meanings matching every accuracy | 2 | 0 |
| Counter-expression arrays falling back to their proposition | 0 | 0 |

Comparison by source-fragment identity and accuracy variant confirms exactly five removals, one added exact-time variant, and one retained predicate change. The other 34 retained records are identical except for version-derived IDs. All 35 retained records preserve the previous counter-expression extraction fix.

The corpus remains `pattern-ontology-source-manual-en-us-0.1.0`, hash `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`. Canonical signing-payload hashes, independently recomputed with the existing helper, are:

- Preserved 0.1.1: `sha256:98297b1d7a45e7a5fc89807bcc0fe311fa882bb978b0340c472fc7deadc4b0c4`.
- New 0.1.2: `sha256:4fd1e939a53ad2eef59e95463b2ed3ac4132261e3449c9087bb2b64062e08c57`.

Both candidates compile. The all-zero `bundle_hash` in each unsigned file remains a placeholder. Compatibility evaluation fields do not establish provider or human evaluation. The [baseline](../2026-09-09-baseline/README.md) and [counter-expression report](../2026-09-09-counter-expression-fix/README.md) remain historical records, with their attachments preserved.

## Same-case comparison

The [twelve-case panel](chart-panel.json) uses the same authored fictional calculation snapshots as the baseline: four exact, four approximate, and four unknown-time cases. All twelve derived feature sets and hashes match their authored fixtures. Both ontology versions were applied to each case.

All **24 deterministic plans pass**, and all **24 separate publication-safety checks report no failures**. Candidate validation passes **20 of 24**. Two unknown-time cases fail the existing `total_word_count` check in both versions:

| Case | 0.1.1 word count | 0.1.2 word count | Result in both versions |
| --- | ---: | ---: | --- |
| `unknown-02` | 1,403 | 1,403 | `total_word_count` failure |
| `unknown-06` | 1,446 | 1,450 | `total_word_count` failure |

These synthetic writer outputs are not accepted complete publication chains. The safety-only result cannot override candidate rejection. This bounded change does not modify the writer or its length policy.

Every panel case loses the unsupported sparse/location meanings. The three authored `*-06` cases also stop selecting concentration, axis, loop, and isolated-factor meanings for grand trines and aspect chains. These fixtures exercise matching behavior; the current calculation service emits an empty `patterns` array, so they do not prove live pattern detection or a current reader-facing stellium result.

## Focused verification and limits

The existing [corpus-builder test file](../../../../../apps/api/scripts/prepare-ontology-corpus.test.ts) now contains seven passing tests. Coverage includes stellium versus grand-trine/aspect-chain matching; exact, approximate, and unknown-time selection; deterministic plan/candidate and publication checks on bounded examples; rejection when required uncertainty is missing; and refusal if any exact-time methodology sentence is absent from its prepared source. API typecheck passes both configurations. Verification used Node 22.23.2.

```sh
npm run test:ontology-corpus-prepare --workspace @patternlike/api
npm run typecheck --workspace @patternlike/api
```

The full local gate was not run, as directed. Mechanical comparisons and model-assisted source review do not establish independent human editorial approval, semantic entailment of generated prose, or measured reader benefit.

## Provider comparison

The [paired provider comparison](provider-comparison.md) completed with four generated writer samples across the same exact- and unknown-time cases. Eleven generation calls used the existing runner and fixed pins, without generated-output retries. Both unknown-time chains passed; the old exact-time writer failed chapter length and the new exact-time sample passed semantic review but hit an apparent negation false positive in the existing prohibited-claim check. These are helper-chain outcomes, not durable publication. The revised inputs remove unsupported sparse/location meanings, but this small, unblinded model-assisted comparison does not establish improved overall prose or reader benefit. Raw requests, outputs, and failures are retained; policy and gate definitions remain unchanged.
