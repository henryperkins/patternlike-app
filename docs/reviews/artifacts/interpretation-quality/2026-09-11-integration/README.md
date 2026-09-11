# Quality implementation integration review

Date: 2026-09-11. Reviewed the recovered builder and publication-safety changes on integration base `69a4f78`. This is a technical review and offline verification record. The retained September 9 artifacts remain historical evidence; this note does not revise their observed outcomes or provide editorial adjudication.

## Candidate identities

Prepared the unchanged source corpus and ran the builder from historical source revision `d338b86c9444ebe2f372f2a2f3990f4a1270bc80` to reproduce the baseline. Independently recomputed each canonical signing-payload hash with the existing helper and compiled all three unsigned releases.

| Release | Records / represented fragments | Canonical signing-payload hash |
| --- | --- | --- |
| Baseline 0.1.0 | 40 / 40 | `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84` |
| Counter-expression candidate 0.1.1 | 40 / 40 | `sha256:98297b1d7a45e7a5fc89807bcc0fe311fa882bb978b0340c472fc7deadc4b0c4` |
| Applicability candidate 0.1.2 | 36 / 35 | `sha256:4fd1e939a53ad2eef59e95463b2ed3ac4132261e3449c9087bb2b64062e08c57` |

The prepared corpus is still `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`. Running the recovered current builder reproduces the complete retained 0.1.2 candidate object. Comparison by source-fragment identity confirms 36 changed counter-expression arrays between baseline and 0.1.1, with other record content unchanged apart from version-derived IDs. The 0.1.2 change narrows one retained predicate, omits five source fragments, and adds the exact-time methodology variant; the other retained content agrees with 0.1.1.

These are unsigned candidate identities. The placeholder `bundle_hash` is not the canonical payload hash, and compatibility evaluation fields remain distinct from independent evaluation.

## Safety scope and frozen commands

The reviewed safety 1.0.1 change recognizes anchored reader optionality with the bare `predict` verb and a `what` complement. Existing tests retain question, assertion, compound-clause, additional-trigger, and ontology-prohibited-phrase rejection controls. No additional production-code correction was identified in this technical review.

Added an integration regression that places the same historical source hash in both the encrypted command and its generation row. Execution records `cancel_source_changed`, consumes no planner or writer attempts, publishes no document, and releases the unconsumed claim before a provider can start. This verifies deployment drift for a consistent older command as well as the existing checks for disagreement between stored hashes. The historical hash is the generated source identity at integration base `69a4f78`, which used safety 1.0.0. The integration owner regenerates the combined creation-source fingerprint after all production changes settle.

All 22 files in the retained-prose hash inventory match their recorded SHA-256 values. Every recovered quality artifact present in the source checkout remained byte-identical before this new note was added. Offline replay of the four retained writer samples equals the stored after-replay result except for checkout-dependent absolute paths: exact-before still fails the 250-word chapter minimum at 245 words; the other three pass candidate validation; none has a generic prohibited-claim finding under 1.0.1. The replay remains narrower than complete publication approval.

## Verification

Node 22.23.2, npm 10.9.8:

- `npm run test:ontology-corpus-prepare -w @patternlike/api`: 7/7 passed.
- From `apps/api`, `npx vitest run src/services/pattern-publication-safety.test.ts src/services/pattern-publication-safety.integration.test.ts src/services/pattern-publication-proof.test.ts`: 119/119 passed.
- `npm run typecheck -w @patternlike/api`: both configurations passed.
- Existing retained-prose `replay.mjs`, temporary identity comparison, hash inventory, and scoped whitespace checks passed.

The added integration test's first run incorrectly inspected `failure_class`; source tracing confirmed cancellation uses `cancellation_reason`, and the corrected assertion passed. No production behavior was changed to satisfy it. The repository-wide merge gate belongs to the integration owner and is reported separately. This review invoked no live provider, signing, activation, publication, or deployment operation.
