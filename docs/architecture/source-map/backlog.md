# Architecture corrections backlog

Reconciled on September 28, 2026 against `00299d26b0b27dd5e14887f94287a872a629efb4`, including PR #73. This is the maintained R01–R08 disposition and work order from the [supplied reconciliation](../../reviews/2026-09-28-architecture-map-reconciled-corrections.md). The [map definition](map.json) describes implemented source; this backlog records remaining work and preservation requirements. The original `77c6c0012cf3c8ff506c63ea422fa7830865f289` map remains a historical reference linked from the [publication index](README.md).

These classifications describe source implementation. They do not certify acceptance-test execution, production, installed runners, or completed human review. No whole proposal is refuted; some premises and sub-tasks are superseded.

## Disposition ledger

| Proposal | Source disposition | Current action |
| --- | --- | --- |
| R01 — Private-response caching | Implemented | Preserve and verify the outer policy, explicit public exceptions, error paths, and service-worker restrictions. |
| R02 — Typed Daily uncertainty | Implemented | Preserve and verify the shared disclosure plan, frozen identity, consent, suppression, and validator agreement at the precision retained in storage. |
| R03 — Artwork state, withdrawal, runner admission | Implemented | Preserve and verify state separation, independent withdrawal, and pre-claim compatibility. Qualify configuration, deployment, and installed-runner evidence separately. |
| R04 — Generation-family-aware operator repair | Still needed | Add an explicit successor operation or versioned contract that derives the target's generation family. |
| R05 — Feedback collection versus effect | Partial | Preserve existing activation/category messaging; finish exact-edition effect applicability or explicitly retain collection-only behavior. |
| R06 — Canonical local release evidence | Implemented | Operate the shared producer/parser and sixteen-lane gate; reconcile each receipt to its source and artifacts. |
| R07 — Ontology supply assurance | Partial | Preserve the compile-only repair; complete coverage/exclusion decisions, evaluation, required review, and intentional scope-admission policy. |
| R08 — First-class bounded connections | Still needed | Add published chapter and stored Timing roots, then Daily continuation with a journey-wide traversal budget. |

## Remaining implementation order

**R04 → R05 applicability → R07 wider assurance → R08.** R07 is a prerequisite for any ontology activation, recall-policy change, or expansion of reach it governs. Move that assurance ahead of the other items when such an expansion is imminent. This ordering does not authorize expansion or weaken existing admission controls.

### R04 — Generation-family-aware operator repair

Current source: [operator routes](../../../apps/api/src/routes/internal-generation.ts), [enqueueDailyReading and enqueueReissue](../../../apps/api/src/services/enqueue.ts). Both ordinary entry points call the legacy `buildGenerationCommand`. Reissue reads predecessor ID, revision, and status without selecting a builder from its generation family. Calculation-defect invalidation and failed-command replacement already have separate V2-capable paths with different eligibility and lifecycle rules.

- [ ] Specify an additive successor operation or versioned contract binding the expected published target, generation family, supported reason, date scope, idempotency identity, and live authorization.
- [ ] Derive and validate family from retained target evidence. Preserve legacy route semantics until an intentional migration.
- [ ] Cover stale predecessors, replay/conflict handling, atomic publication, and attempt/spend ceilings. Keep invalidation distinct from replacement; `consent_revoked` alone must never authorize a new model call.

### R05 remainder — Exact-edition effect applicability

Current source: [ReadingResponseCard](../../../apps/web/src/components/ReadingResponseCard.tsx), [supportedTargets](../../../apps/api/src/db/reading-feedback-events.ts), and [feedback compiler](../../../apps/api/src/services/reading-feedback-compiler.ts). The UI already validates and uses `generation_effects_active`, explains each category, and distinguishes eligibility from later use. Its baseline and current Git blob are both `324a892eef678200a43b0f20a5ddc3a26b246cdf`; this is not a new PR #71 change or an open activation-message task. The writer retains fact references but returns `theme_ids: []`, so `not_relevant_today` cannot compile for theme ranking even if global generation use is enabled.

- [ ] Distinguish global activation, this exact edition/event's effect applicability, and observed admission or use in a later generation. Return a supported applicability reason or explicit collection-only state.
- [ ] Decide whether theme ranking remains collection-only for these events or receives retained, versioned theme associations. Never infer themes from notes, labels, or assumed equivalence with fact IDs.
- [ ] Verify active/inactive rollout, supported/unsupported associations, grant withdrawal, expiry, and edition changes while preserving encryption, export, retention, deletion/rotation, and note exclusion. A seven-day eligibility timestamp is not a usage receipt.

### R07 remainder — Coverage, review, and scope admission

Current source: [offline builder](../../../apps/api/scripts/build-internal-ontology.ts), [candidate/release compilers](../../../packages/pattern-engine/src/ontology.ts), [release admission](../../../apps/api/src/db/pattern-ontology.ts), [provenance](../../../pattern-corpus/provenance.json), and [reviewer registry](../../../pattern-corpus/reviewers.json). The compile-only candidate now emits `verdict: reject`, `evaluator_passed: false`, and `regression_passed: false`; signing does not make it admissible. Fixed section mappings and an aggregate skip count remain. The committed records describe sixty model-generated first-party fragments, incomplete human review, zero certified fragments, an empty reviewer registry, and five outstanding public-activation items. These records do not identify the active production ontology or establish whether review occurred elsewhere.

- [ ] Record reviewed mapping and exclusion decisions per fragment and supported feature. Do not force a rule for every fragment or treat fragment counts as feature coverage.
- [ ] Supply actual evaluation/regression results and the required review evidence, separately from structural compilation and signatures.
- [ ] Define intentional internal/public admission policy across origins. Preserve existing committed-evidence, corpus-eligibility, hash, receipt, signature, and recall checks; admission controls already exist.
- [ ] Preview affected releases and readers before corresponding activation, recall-policy changes, or public expansion. Keep the isolated signer and immutable evidence boundaries.

The zero fixture count in the builder describes compiler inputs, not completed evaluation coverage. The immediate false-success repair is closed; the wider assurance work remains open and gates its corresponding expansion.

### R08 — First-class bounded reader connections

Current source: [relationship routes](../../../apps/api/src/routes/reader-relationships.ts), [authorization and loading](../../../apps/api/src/services/reader-relationships.ts), [resolver](../../../apps/api/src/services/reader-relationship-resolver.ts), and [ReadingConnections](../../../apps/web/src/components/ReadingConnections.tsx). HTTP relationship roots still construct a Daily target. The standalone Timing route serves stored detail; it is not a relationship-root contract. The resolver accepts the broader target union, but the UI omits outgoing links after a connected Daily destination.

- [ ] Extend the typed source contract additively for published Pattern chapters and stored Timing passes, with ownership and exact-edition validation before entry-point UI.
- [ ] Reuse the existing resolver, authorization, and target rendering. Carry the visited set and remaining three-hop, four-links-per-item, twelve-overall budget through Daily continuation; mounting another article must not reset it.
- [ ] Verify live owner/consent/save eligibility, saved-only Daily destinations, uncertainty restrictions, stale/unavailable targets, terminal explanations, and Back/position restoration. Never substitute a newer edition or recalculate a stored Timing pass.

## Preserve and verify

| Item | Regression and operational boundary |
| --- | --- |
| R01 | Keep `/health` and `/v1/meta` public, retain distinct authorities, and exercise private policy across success/refusal/exception paths. Retain the larger status matrix, including 410 and 429; inspection of the dedicated test source alone does not execute that matrix. Keep private API bodies out of service-worker storage. |
| R02 | Keep exact birth time exact when qualified. Stored `birth_instant / technique_specific` does not identify a more specific historical-zone, border, ambiguous-time, or nonexistent-time diagnostic. Richer detail needs retained evidence and a compatible contract change. |
| R03 | Keep unreadable permission unknown and withdrawal independent of generation admission when ownership, storage, and write checks permit. The image CLI pin remains `0.153.3`. Committed adaptive settings are default `0`, production `1`; verify live deployment, migrations, installed runner, consent races, protocols, attempt budgets, and an artwork canary separately. |
| R06 | Keep zero process exit, complete ordered lane validation, mandatory dependencies, current-map checks, source inventory, and build identities. A dirty checkout or different merge SHA alone neither invalidates nor proves equivalence of a receipt; run its verifier and reconcile consumed bytes. Deployment stays separate. |
| R07 immediate | Preserve truthful compile-only fields and rejection by release admission. Structural compilation is not evaluation, completed human review, signing, or activation. |

M01 calculation replay and M02 runner concurrency remain measurement-first. This reconciliation supplies no evidence that replay is redundant or higher concurrency is safe. Preserve current work-class, attempt, lease, and concurrency limits.

## Verification and historical scope

The supplied reconciliation is preserved unchanged in the review archive, including its source-only verification limits. Older maps, plans, test receipts, and production observations retain their dates and source identities. This backlog does not promote retained gate evidence into exact-current-source or production proof.

Any implementation must refresh the maintained map when consumed source changes and satisfy the current repository gate. The current rule is all sixteen lanes through `npm run ci:local`, with a snapshot-bound receipt and the actual summary before merging; older statements that source-map checks are optional do not override [AGENTS.md](../../../AGENTS.md).
