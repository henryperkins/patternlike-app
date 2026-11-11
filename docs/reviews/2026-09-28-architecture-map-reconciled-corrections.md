# Patternlike — Reconciled Architecture Corrections

**Review date:** September 28, 2026.  
**Proposal reviewed:** `patternlike-architecture-map-proposed-corrections.md`, including its R01–R08 recommendations.  
**Historical basis:** `77c6c0012cf3c8ff506c63ea422fa7830865f289`.  
**Current main inspected:** `00299d26b0b27dd5e14887f94287a872a629efb4`.  
**Scope:** source reconciliation, not a deployment certification or a new test run.

Current main was rechecked at the end of source inspection. It is the merge of PR #73, not merely the post-#71 tree. The production adaptive-artwork setting therefore needs to be read from this newer snapshot. All current-code links below are immutable links to that snapshot. [Main identity][main] · [Configuration][config]

The original proposal and its preserved historical map remain historical evidence. This document replaces their recommended work order; it does not silently relabel their old line references as current. No repository code, branch, deployment, consent, data, or Library original was changed in this review.

## Verdict

Four proposals are implemented in the inspected source: **R01, R02, R03, R06**. Two are **partial: R05, R07**. Two are **still needed: R04, R08**. No entire proposal is refuted, but several premises or sub-tasks must be removed rather than implemented again.

“Implemented” means the proposed behavior is present in the relevant inspected code paths. It does not mean every acceptance case was executed here, that production serves these bytes, or that an installed runner is compatible. Test-source inspection and retained execution artifacts are identified separately below.

| ID | Classification | Revised disposition |
| --- | --- | --- |
| R01 | Implemented | Keep the outer private-response policy and service-worker restriction. Remove the boundary repair from the implementation queue. |
| R02 | Implemented | Keep the typed disclosure plan, frozen identity, and validator agreement. Do not invent diagnostic precision absent from the stored report. |
| R03 | Implemented | Keep state/capability separation, independent withdrawal, and pre-claim image compatibility checks. Separate production configuration from installed-runtime proof. |
| R04 | Still needed | Add an explicit family-aware contract for operator generation/reissue. Do not reinterpret legacy operations silently. |
| R05 | Partial | Retain the existing truthful activation/category explanation. Finish exact-edition effect applicability and supported theme mapping, or keep the category explicitly collection-only. |
| R06 | Implemented | Keep canonical producer/parser, required lanes/dependencies, source-map checks, and snapshot-bound receipts. Reconcile evidence scope separately. |
| R07 | Partial | Close the compile-only misrepresentation. Retain wider coverage, review, evidence, and scope-admission work. |
| R08 | Still needed | Add first-class Pattern/Timing roots and budget-preserving onward traversal through a compatible contract extension. |

## Revised order

**First: refresh the map and retain the closed repairs.** Replace the blanket “proposed / not implemented” status with this item-level ledger. R01, R02, R03, R06, and the immediate R07 compile-only repair are maintenance and regression constraints, not fresh implementation projects. Preserve the old map as an explicitly dated baseline.

**1. R04 — family-aware operator repair.** This is the clearest remaining operational mismatch. The published-target reissue entry point still uses the legacy builder. Specify and test the supported family, exact predecessor, allowed reason, date scope, consent, idempotency, and publication constraints before adding another generic repair button or endpoint.

**2. R05 — exact-edition effect applicability.** Do not spend another change merely wiring `generation_effects_active` into the UI; that already exists. Decide whether “Not relevant today” remains collection-only or gains verified, retained theme associations. Expose actual applicability separately from global rollout and from observed later use.

**3. R07 — wider ontology assurance.** Complete the coverage/exclusion ledger, required review evidence, and explicit internal/public admission policy. This ordering is not permission to expand ontology reach first: **the remaining R07 assurance is a prerequisite for the corresponding activation, recall-policy change, or public expansion**. Move it ahead of other feature work when such an expansion is imminent. Existing safety and scope guards must not be relaxed in the meantime.

**4. R08 — additive reader entry points.** Extend the source contract once ownership, exact-edition identity, and journey-wide traversal limits are specified. Reuse the resolver and target views; do not introduce separate view-specific graph implementations.

**Keep M01/M02 measurement-first.** This review does not establish that calculation replay is redundant or that higher runner concurrency is safe. The inspected runner still has bounded concurrency and weighted work classes; image admission checks are not service-time or capacity measurements. [Runner][runner]

## R01 — Uniform private-response boundary

### Verified current behavior

`privateResponsePolicy` sets `Cache-Control: private, no-store` before downstream work and again after it. Its explicit exceptions are `/health` and `/v1/meta`. The application mounts it at the outer request boundary, before the relevant configuration and authorization paths. This is not a collection of route-local success-only headers. Separate session, deletion-receipt, administrator, service, runner, and crypto-operator authorities remain separate. [Boundary][boundary] · [Application wiring][index]

The service worker bypasses `/v1/` requests. Its asset-cache path also refuses to write fetched responses whose cache policy contains `private` or `no-store`. This matters because a Cache API write is not itself prevented by the HTTP policy. [Service worker][sw]

### Evidence and remaining constraint

The dedicated middleware test source covers representative configuration refusals, successful responses, authentication/account failures, missing routes, conflicts, and an internal exception. It is source evidence for intended regression coverage, not a fresh execution result. The dedicated file inspected does not by itself establish execution of every status in the proposal's larger acceptance list, including 410 and 429. [Tests][boundary-tests]

**Map replacement:** “A shared private-response boundary covers private application responses, with explicit public exceptions. Preserve it across raw responses and error paths. Keep private API bodies outside service-worker storage.”

**Disposition:** implemented. Preserve the broader status matrix as regression acceptance; do not reopen the boundary implementation merely because this review did not run it.

## R02 — Typed Daily uncertainty

### Verified current behavior

The new uncertainty module validates a closed input vocabulary and builds a deterministic disclosure plan. `prepareConstrainedReadingInput` normalizes the stored uncertainty, rejects an accuracy mismatch, requires uncertainty consent, continues to suppress disallowed calculated facts, and carries the plan into both the provider request and the canonical frozen identity/manifest. [Normalizer and plan][uncertainty] · [Input preparation][input]

Candidate uncertainty text is checked against that same prepared plan through `validateFactSupport`. Unsupported, repeated, or incomplete disclosure text is not accepted merely because it resembles a disclaimer. The V2 generation-command path imports and uses the shared typed uncertainty machinery; the additive contract documents the successor request/command boundary rather than rewriting the older published Daily format. [Claim support][support] · [Generation command][command] · [Contract][uncertainty-contract]

### Important precision boundary

An exact birth time can remain exact while its stored qualification is disclosed. A stored `birth_instant / technique_specific` qualification does not prove which of the more specific historical-zone, border, ambiguous-time, or nonexistent-time diagnostics caused it. The correct implementation discloses what the stored input supports, rather than inventing a specific cause or relabeling an exact time as unknown.

**Map replacement:** “Daily generation uses a typed, deterministic disclosure plan derived from stored uncertainty. The plan participates in the frozen input identity and constrains candidate validation. Exactness and qualification are separate; unsupported inputs remain fail-closed.”

**Disposition:** implemented at the stored report's available precision. Richer diagnostic granularity would require additional retained evidence and a compatible contract change, not more permissive validation.

## R03 — Artwork state, withdrawal, and runner admission

### Verified current behavior

Artwork responses now separate supported protocols, generation availability, and allowed actions. Automation responses additionally expose actual grant status and policy. Failure to observe a grant is represented as unknown, not silently disabled. [Portrait state][portrait] · [Automation state][automation]

The disable mutation is checked before generation/adaptive availability. It still requires the grant/cancellation storage, current owner/chart, and safe write conditions. Missing storage or failed confirmation does not become a successful revocation. The UI renders unknown permission explicitly, uses allowed actions, retains the legacy-policy distinction, and can offer withdrawal even when new generation is unavailable. [Automation service][automation] · [Automation control][automation-ui]

The image runner invokes `checkPortraitCompatibility` before `claim`. The production entry point wires that check into the polling path. Incompatibility or a failed preflight returns without claiming an image job and therefore without spending that claim's attempt. The preflight checks local executable/authentication and effective isolation configuration without starting a reading-bearing model turn. [Runner][runner] · [Entry-point wiring][runner-entry] · [Image invocation][image-invocation]

### Corrections to the old map

The exact image CLI pin **still exists: `0.153.3`**. The repair moves known incompatibility before claim; it does not remove this pin or prove that an installed host satisfies it. [Image invocation][image-invocation]

The old assertion that both committed adaptive-admission settings are off is now stale. At this main snapshot the default setting is `0`, while `[env.production.vars]` is `1`. A committed production value is not evidence of the live Worker version, applied migrations, installed runner artifact, or a successful end-to-end artwork canary. [Configuration][config]

**Map replacement:** “Artwork support, generation admission, saved permission, and allowed actions are distinct. Withdrawal remains available independently of generation rollout when ownership and cancellation storage permit. Image-runner compatibility is checked before claim. Production adaptive admission is committed on; installed-runtime and deployment identity require separate evidence.”

**Disposition:** implemented in source. Keep the rollout, protocol, migration, withdrawal-race, and attempt-budget cases as regression/operational acceptance, not claims established by a PR summary.

## R04 — Explicit generation-family-aware operator repair

### Verified current behavior

`/internal/readings/generate` delegates to `enqueueDailyReading`. The ordinary operator reissue route takes an expected live reading and delegates to `enqueueReissue`. Both functions shown use `buildGenerationCommand`, the legacy builder. Reissue loads the predecessor's ID, revision, and status, but does not select a command builder from its generation family. [Operator routes][operator] · [Enqueue functions][enqueue]

V2 functionality elsewhere in the same module does not repair this entry point. The calculation-defect invalidation path calls its separate repair service, while failed-command replacement has its own eligibility, age, reason, and budget rules. Those capabilities must not be reported as a general, version-aware published-target reissue operation. [Operator routes][operator] · [Enqueue functions][enqueue]

**Revised proposal:** add an explicit successor operation or versioned contract. Bind the expected published target and family, supported repair reason, idempotency identity, date scope, and live authorization. Keep legacy route semantics until an intentional migration. Preserve atomic publication, stale-predecessor rejection, ceilings, and the distinction between invalidation and replacement. A consent-revocation reason must not authorize a new model call by itself.

**Disposition:** still needed. Existing guards are useful foundations, not implementation of the proposed family-selection contract.

## R05 — Feedback collection versus actual effect

### Verified current behavior

The premise that activation messaging still needs to be connected is refuted. `ReadingResponseCard` validates and uses `generation_effects_active`. It explains that generation use can be off, that `unclear` is not offered to generation, that repetition use is bounded, and that theme ranking needs supported theme associations. It also says eligibility does not establish later use. [Current UI][feedback-ui]

This is not a new #71 repair: the same explanation exists at the proposal's base SHA. The inspected old and current files have the same Git blob SHA, `324a892eef678200a43b0f20a5ddc3a26b246cdf`. [Baseline UI][feedback-ui-base] · [Current UI][feedback-ui]

The substantive target-to-effect gap remains. `supportedTargets` derives retained fact IDs but returns `theme_ids: []`; the compiler rejects `not_relevant_today` when there are no theme IDs. Its handling of grants, exact target coordinates, expiry, and notes remains restrictive. Therefore global generation availability does not make that category effective for these stored events. [Target extraction][feedback-store] · [Compiler][feedback-compiler]

**Revised proposal:** retain the existing UI explanation. Distinguish three states: global generation use is enabled; this exact edition/event is eligible for a particular effect; a subsequent generation actually admitted or used it. Return an applicability reason or an explicit collection-only state where useful. Add theme mapping only from retained, versioned support—not from note prose, display labels, or assumed equivalence between fact and theme IDs.

Keep encrypted storage, export, retention, deletion/rotation protections, note exclusion, and exact-edition identity. A seven-day effect timestamp is a possible eligibility window, not a usage receipt.

**Disposition:** partial. The missing-activation-messaging sub-task is refuted; verified theme applicability remains needed. “No verified change” is the appropriate delta for the inspected activation explanation.

## R06 — Canonical local release evidence

### Verified current behavior

The CI script and recorder share `ci-summary.mjs`. The producer emits ASCII, versioned delimiters and lane records. The parser requires a zero process exit, exactly the required ordered passing lanes, and a complete success block; missing, duplicated, reordered, skipped, failed, malformed, or trailing output does not become a pass through a success substring. [CI producer][ci] · [Shared formatter/parser][summary]

Source-map tool tests and the current-map check are now required lanes. The contract validator's main entry point checks required OpenAPI dependencies and exits nonzero on dependency errors. The exploratory ephemeris-skip option likewise cannot produce a passing local gate. [CI producer][ci] · [Contract validator][contracts]

The receipt binds source inventory, before/after comparison, gate exit/output digest, build artifacts, and repository configuration. Its verification checks current source/artifacts against that evidence while keeping deployment unverified. The test source runs the committed CI producer with expensive lane commands stubbed; it tests formatting/control-flow compatibility without pretending those stubs execute real application tests. [Evidence recorder][evidence] · [Producer/consumer tests][evidence-tests]

### Retained execution evidence and limits

The current repository contains an adaptive-admission receipt captured on September 28, 2026. It records base commit `49062fbded96c88b83a84b2321852835c418cc89`, `worktree_has_changes: true`, source digest `92af8dea231e0b14f2428b7a0fa16fe555ca393dac75c149e178f6a2abb37d89`, unchanged source during the gate, exit 0, and all sixteen lanes passing. Its companion summary records the same branch/base and lanes. These are retained execution artifacts, not a test run performed during this review. [Receipt][gate-receipt] · [Summary][gate-summary]

A changed worktree does not invalidate a byte-inventoried receipt, and a different merge SHA does not by itself prove that tested source differs. This review did not independently compare the entire receipt inventory and artifacts against current main, or execute the receipt verifier. Establish that equivalence before promoting the retained run into exact-current-source release proof; rerun only where equivalence cannot be established or relevant bytes changed. Do not infer deployment from either the local receipt or a merge.

**Disposition:** implemented. Remaining work is evidence reconciliation/operation of the gate, not replacement of the parser or another permissive success regex.

## R07 — Compile-only semantics versus ontology assurance

### Verified current behavior

The internal builder now emits a candidate with `verdict: "reject"`, `evaluator_passed: false`, and `regression_passed: false`. It calls `compileOntologyCandidate`, writes only after successful compilation, and labels the result compile-only and not admissible for release. Its zero fixture count is explicitly the number supplied to that compiler invocation, not an assertion of completed evaluation coverage. [Builder][ontology-builder]

Candidate compilation and release compilation are distinct functions. `compileOntologyRelease` requires a passing evaluation verdict; `storeOntologyRelease` invokes that release compiler before persistence. Thus the newly emitted reject-verdict candidate cannot be made admissible merely by signing it. [Compiler][ontology-compiler] · [Release store][ontology-store]

The wider proposal is not complete. The builder still uses fixed section-to-predicate mappings and an aggregate skipped-fragment count rather than emitting the proposed reviewed per-fragment/per-feature coverage ledger. The release store also retains origin-specific evidence handling: machine-pipeline inputs require bound pipeline evidence; non-machine inputs do not take that same evidence argument. Existing public-scope derivation is already strict about committed evidence, corpus eligibility, matching hashes, and receipts. Do not describe the system as having no admission or scope checks. [Builder][ontology-builder] · [Admission and scope][ontology-store]

**Revised proposal:** close the false evaluation-success emission. Keep explicit mapping/exclusion decisions, actual evaluation/regression and required review evidence, and an intentional internal/public policy across origins. Preserve immutable evidence, signature verification, recall controls, and isolated signing. Preview affected releases and readers before any scope/recall-policy expansion.

The current committed `pattern-corpus/provenance.json` still records 60 model-generated first-party fragments, incomplete human review, zero certified fragments, no certifications, and unverified public activation with five outstanding items. `pattern-corpus/reviewers.json` still has an empty reviewer array. These are verified statements about the committed evidence records—not proof that no review happened elsewhere or that this corpus is the active production ontology. [Provenance record][corpus-provenance] · [Reviewer registry][corpus-reviewers]

The remaining assurance gap is therefore concrete, not inferred solely from missing documentation. It does not establish a production quality incident. Do not force a rule for every fragment or turn a fragment count into a feature-coverage percentage.

**Disposition:** partial: immediate compile-only repair implemented; wider supply assurance remains a release prerequisite for the corresponding expansion.

## R08 — First-class bounded reader connections

### Verified current behavior

The relationship-source, relationship-list, and relationship-target HTTP routes are still rooted at `/v1/readings/:id/…` and construct a `ReaderDailyTarget`. The separate `/v1/timing/cycles/:id` route provides owner-checked stored Timing detail, not a new relationship-root contract. [Routes][relationships-api] · [Authorization and loading][relationships-service]

The pure resolver can accept the general target union, but the public request boundary still needs equivalent admission for a chapter or cycle root. Its traversal retains three hops, four outgoing links per item, twelve overall, and a visited set. Support is restricted to known calculated features, participants, and dated occurrences rather than prose matching or fresh calculation. [Resolver][relationships-resolver]

`ReadingConnections` continues to discover a Daily source and request its graph. It renders outgoing links after Pattern and Timing destinations, but deliberately omits them after a connected Daily destination. Existing revalidation, unavailable-edition messaging, and Back/position restoration are useful retained behavior, not evidence that direct Pattern/Timing graph entry points are implemented. [Reader component][relationships-ui]

**Revised proposal:** add an explicit typed source contract for a published Pattern chapter and a stored Timing pass. Reuse the resolver and target renderers. Carry a journey-wide visited set and the remaining hop/link budget through any connected Daily continuation; mounting a new article must not reset the budget. Preserve saved-only Daily destinations, live owner/consent/save checks, exact revision/hash identity, uncertainty limits, unavailable-target notices, terminal explanations, and Back. Never silently substitute a newer edition.

**Disposition:** still needed as an additive feature. Do not delete the direct Timing endpoint merely because the existing graph UI uses another path.

## Verification boundary

This reconciliation is based on the saved proposal, immutable current-code reads, selected test-source reads, and the explicitly identified retained local-gate artifacts. No application tests, full release gate, live account/artwork canary, production migration query, installed-runner inspection, or complete source-receipt equivalence check was executed in this review. PR descriptions and review prose were used to locate evidence, not as proof of runtime behavior.

The next implementation sequence is **R04 → R05 remainder → R07 wider assurance → R08**, with the R07 activation prerequisite applying immediately to any expansion it governs. Keep the implemented boundaries and regression requirements intact.

## Immutable evidence links

Links are current-snapshot source unless explicitly labeled as the historical UI comparison. Relevant symbols and behavior are identified in the sections above; links intentionally avoid old, drifting line-number anchors.

[main]: https://github.com/henryperkins/patternlike-app/commit/00299d26b0b27dd5e14887f94287a872a629efb4
[boundary]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/middleware/private-response.ts
[index]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/index.ts
[boundary-tests]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/middleware/private-response.test.ts
[sw]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/web/public/sw.js
[uncertainty]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/packages/reading-engine/src/uncertainty-disclosure.ts
[input]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/packages/reading-engine/src/constrained-input.ts
[support]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/packages/reading-engine/src/claim-support.ts
[command]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/generation-command-v2.ts
[uncertainty-contract]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/contracts/daily-uncertainty-v1/README.md
[portrait]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/pattern-portrait.ts
[automation]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/pattern-portrait-mesh.ts
[automation-ui]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/web/src/components/PortraitAutomationControl.tsx
[image-invocation]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/codex-runner/src/portrait-invocation.ts
[runner]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/codex-runner/src/runner.ts
[runner-entry]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/codex-runner/src/index.ts
[config]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/wrangler.toml
[operator]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/routes/internal-generation.ts
[enqueue]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/enqueue.ts
[feedback-ui]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/web/src/components/ReadingResponseCard.tsx
[feedback-ui-base]: https://github.com/henryperkins/patternlike-app/blob/77c6c0012cf3c8ff506c63ea422fa7830865f289/apps/web/src/components/ReadingResponseCard.tsx
[feedback-store]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/db/reading-feedback-events.ts
[feedback-compiler]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/reading-feedback-compiler.ts
[ci]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/scripts/ci-local.sh
[summary]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/scripts/pattern-release/ci-summary.mjs
[evidence]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/scripts/pattern-release/release-evidence.mjs
[evidence-tests]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/scripts/pattern-release/release-evidence.test.mjs
[contracts]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/contracts/validate_schemas.py
[gate-receipt]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/docs/reviews/artifacts/2026-09-28-adaptive-portrait-admission/local-gate.json
[gate-summary]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/docs/reviews/artifacts/2026-09-28-adaptive-portrait-admission/local-gate-summary.txt
[ontology-builder]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/scripts/build-internal-ontology.ts
[ontology-compiler]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/packages/pattern-engine/src/ontology.ts
[ontology-store]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/db/pattern-ontology.ts
[relationships-api]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/routes/reader-relationships.ts
[relationships-service]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/reader-relationships.ts
[relationships-resolver]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/api/src/services/reader-relationship-resolver.ts
[relationships-ui]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/apps/web/src/components/ReadingConnections.tsx
[corpus-provenance]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/pattern-corpus/provenance.json
[corpus-reviewers]: https://github.com/henryperkins/patternlike-app/blob/00299d26b0b27dd5e14887f94287a872a629efb4/pattern-corpus/reviewers.json
