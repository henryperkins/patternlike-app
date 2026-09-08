# Patternlike mind-map alignment: 12+1 implementation slices

> **For agentic workers:** Use `superpowers:executing-plans` for an authorized slice after its entry decisions and task plan are concrete. This is the delivery ledger; each slice gets its own implementation and verification boundary, and may span more than one PR.

**Goal:** Deliver a connected, understandable reading experience with stronger interpretation evidence and dependable operations, in twelve core slices and one conditional investigation.

**Architecture:** Extend the existing reading, provenance, state, job, and release-evidence foundations. Separate reader-facing changes from adapter extraction, orchestration changes, and naming migrations. Machine ontology remains outside the critical path.

**Tech stack:** TypeScript, React/Vite, Hono on Cloudflare Workers, D1/R2, the installed Codex runner, Node tooling, and the Swiss Ephemeris calculation service.

**Planning basis:** [Application alignment roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md), especially sections 6–10, and the user's 12+1 slice breakdown.

**Status:** Delivery planning only. No slice is marked implemented or release-ready by this document. The roadmap remains the dated evidence register; these slice numbers replace its broader workstream numbers for subsequent planning.

## Global constraints

- Preserve complete readings, exact source identities, historical attribution, and frozen execution semantics.
- Do not rewrite saved prose or historical provider labels to make a new abstraction look uniform.
- No inference of a causal relationship from thematic similarity or reader agreement.
- No widening of personal context use without the existing consent/allowed-use rules and explicit user-facing consequences.
- Keep recall, invalidation, export, erasure, cancellation, and key handling effective across any new links or caches.
- Do not change attempt or spend ceilings, weaken semantic/safety validation, or reduce regression coverage simply to obtain a passing run.
- Do not claim human authorship, corpus certification, operational readiness, or current production status from names, signatures, configuration, or old observations alone.
- Keep the calculation service's existing licensing and source-offer boundary intact.
- Preserve unrelated working-tree changes. Separate documentation, implementation, commit/push, migration, deployment, and live verification authority.
- Use the Node 22 version pinned by `.nvmrc` and Python 3.11+. The repository's [AGENTS.md](../../../AGENTS.md) governs verification and merges; `npm run ci:local` and its actual PR summary remain mandatory before merging.

## Order and shared release rules

| Slice | Start condition | Completion handed to later work |
| --- | --- | --- |
| 1. Source truth and map maintenance | First | Corrected evidence index and reproducible map checks |
| 2. Release safeguards | Start with 1; establish before implementation merges | Reviewed preflight plus source-bound verification workflow |
| 3. Interpretation-quality baseline | Use 1's corrected source/provenance inventory | Rubric, coverage assessment, and adjudicated evaluation panel |
| 4. Connected reader journey and provenance | Use 1's evidence; agree relationship and access semantics | One complete journey using existing feedback |
| 5. Feedback improvements | Build on 4; use 3's quality dimensions | Compatible categories, permitted effects, and measured outcomes |
| 6. Observatory compatibility | Agree chapter-count and source-identity interfaces | Supported 3/4/5/6-chapter behavior and accessible fallback |
| 7. Readiness and operational visibility | Agree state composition, safe status fields, and response ownership | Reader actions and operator queue/failure visibility |
| 8. Runner fairness | Agree work-class/metric interfaces with 7 | Demonstrated bounded progress without weakened leases or budgets |
| 9. Shared Codex exchange mechanics | Freeze adapter behavior and helper boundary | One narrow helper proven across two adapters |
| 10. Orchestrator simplification | Select an actual stage and establish preservation evidence | One independently reviewable extraction at a time |
| 11. Model/configuration vocabulary | Approve inventory and compatibility rules | Staged source and deployment-variable migration |
| 12. Calculation-service naming | Select target names and inventory packaging consumers | Renamed workspace with reproducible packages and source offer |
| 13. Machine-ontology re-entry | Separate decision to investigate current pins | Evidence-backed go/no-go; activation remains separately authorized |

Slices 3 and 4 proceed alongside each other; the journey prototype does not wait for completed editorial certification. Slices 6–8 can proceed independently once their shared interfaces are recorded. Slices 9–12 do not gate reader-facing work and need not run in numeric order. Slice 13 is conditional.

Slice 2 must be established before any implementation merge, including Slice 1's tooling. Its own bootstrap merge uses the existing release-evidence command and repository merge gate, with its prospective preflight reviewed and exercised locally. Documentation-only preparation can precede that implementation boundary; any merge still follows repository policy.

Every slice retains four distinct completion states: implementation verified locally, approved for merge, deployed when applicable, and operationally verified when applicable. A missing later state does not erase earlier evidence, and an earlier state does not imply a later one. Record the candidate source identity, commands, exit codes, evidence paths, known gaps, and required follow-up at each release boundary.

Freeze final source before the full gate. Keep the actual `ci:local` summary in the PR. A focused suite, a stale receipt, an interrupted aggregate run, or a GitHub billing failure cannot substitute for that summary. Merging to `main` can trigger Workers Builds even while GitHub Actions is unavailable.

## Detailed specification coverage

The following designs settle the major implementation interfaces and verification boundaries. They are specifications for review, not implementation, merge, spending, migration, or deployment approval. Shared documents retain separate slice acceptance and release records.

| Slices | Specification | Decisions made concrete |
| --- | --- | --- |
| 1 | [Source truth and map maintenance](../specs/2026-09-07-source-truth-map-maintenance-design.md) | Correction inventory, source manifest, reproducible map checks |
| 2 | [Release preflight](../specs/2026-09-08-release-preflight-design.md) | Candidate-tree mapping, exact gate summary, PR/base checks, migration/runner prerequisites |
| 3 | [Interpretation-quality baseline](../specs/2026-09-08-interpretation-quality-baseline-design.md) | 60-fragment/40-record review, twelve-chart panel, rubric, controls, adjudication |
| 4–5 | [Reader relationships and feedback](../specs/2026-09-08-reader-relationships-feedback-design.md) | Exact editions/cycles, passage-support storage, bounded grants, categories and expiry |
| 6 | [Adaptive Observatory](../specs/2026-09-08-adaptive-observatory-contract-design.md) | All chapters, v1/v2 negotiation, constrained-table migration, consent and rollout order |
| 7–8 | [Readiness and runner fairness](../specs/2026-09-08-readiness-runner-fairness-design.md) | Composed states/actions, safe metrics/clocks, 4:1:1 sequential scheduling |

Slices 9–12 and conditional 13 retain the charters below; their implementation designs can be prepared when their concrete entry inventories/decisions are ready. They do not delay these reader and runtime contracts.

## Slice 1 — Source truth and map maintenance

**Specification:** [Source truth and map maintenance](../specs/2026-09-07-source-truth-map-maintenance-design.md).

**Scope and deliverable:** Correct present-tense explanations, preserve dated observations, and make the map's source checks repeatable from a documented command. Deliver a correction record, a maintainable map/evidence source, and fresh snapshots that identify the exact local bytes they describe.

**Starting files:** [Internal builder](../../../apps/api/scripts/build-internal-ontology.ts), [signing client](../../../apps/api/src/services/ontology-signing-client.ts), [rollout runbook](../../deploy/openai-pattern-rollout.md), [CLAUDE.md](../../../CLAUDE.md), and the roadmap's linked map artifacts. Place maintained map inputs and tooling in tracked repository paths; retain the original `output/mindmaps/2026-09-07-184743/` artifacts as historical inputs.

**Work boundaries:** Correct the documentation/comments as one reviewable unit. Add map snapshot/check tooling as another. The tooling does not infer semantic correctness from matching file hashes and does not change runtime behavior or ontology content.

**Acceptance criteria:**

- Explain the offline 60-fragment input, 40 admitted records, and 20 skips: twelve sign fragments and eight cross-cutting fragments. Describe the predicate boundary and tension/counter-expression fallback without claiming independent editorial evaluation.
- Correct internal-origin admission, the distinction between signing and activation, and the machine path's separate evidence requirements. Preserve both signing functions and the existing admission behavior.
- Replace blanket failed-candidate/regression assertions with dated, individually classified evidence. Distinguish execution cursor 95 from completed fixture count, existing closure rules from a current diagnosis, and document-level safety from whole-corpus evaluation.
- Cite the September 6 pointer observation with its timestamp and query scope. Do not turn a null joined receipt into a census of all evidence tables or call that record a live read.
- Describe current Codex deployment admission, shared exchange foundations, frozen Daily V1/V2 ownership, observability settings, and release-identity limitations. Label historical provider names and rollout instructions as historical.
- Snapshot metadata binds the map/evidence inputs, base commit, referenced file paths/hashes, and whether captured bytes include local changes. Verification reports changed/missing files, invalid anchors, and changed map inputs with a failing exit code; an incomplete check never reports success.
- Capture and verify are documented, repeatable, and offline. Stable inputs produce the same content identities; capture timestamps may differ. Refresh creates a new dated snapshot and preserves the older one. Semantic edits still require source review.
- Sharing the maintained map includes its inputs, evidence, snapshot, and verification command; no optional renderer service is required to check it.

**Verification:** Reproduce the corpus preparation/builder result offline and compare canonical content identity with the dated record, without signing or ingestion. Check Markdown links and line anchors. Exercise snapshot checks in a temporary fixture repository with unchanged files, changed dirty bytes under the same HEAD, missing files, stale anchors, and edited map inputs. Verify that documentation/comment changes preserve executable behavior and do not accidentally change generated Pattern source identity. Run the affected tooling lanes and the full merge gate for the final implementation candidate.

**Release boundary:** Documentation and local tooling only. No corpus amendment, generation, activation, deployed-variable change, or reading migration is part of this slice. The map snapshot remains source evidence, separate from the release receipt in Slice 2.

**Responsible role / next handoff:** Repository maintainer. Hand the corrected inventory to 3/4 and the snapshot identity rules to 2.

## Slice 2 — Release safeguards

**Specification:** [Source-bound release preflight](../specs/2026-09-08-release-preflight-design.md).

**Scope and deliverable:** Extend [release-evidence.mjs](../../../scripts/pattern-release/release-evidence.mjs) and its [runbook](../../deploy/repository-release-evidence.md) with an explicit, reviewable release preflight. Reuse the existing source manifest, gate parser, artifact inventories, and offline reconciliation; do not create a competing receipt format without a compatibility reason.

**Entry decisions:** Define the supported release command, how a verified source manifest maps to the intended commit/merge result, and who records release sign-off. Specify the boundary between an offline preflight and later authorized remote observations or mutations.

**Acceptance criteria:**

- Refuse absent, malformed, failed, incomplete, or stale receipts; changed source, lockfiles, fingerprints, artifacts, or pins; and an unproven mapping to the intended release candidate. A dirty snapshot's base commit is never represented as containing its local edits.
- Require all fourteen current gate lanes in order, their successful execution, the pinned toolchain, and unchanged included source across the run. Verify the actual proposed release content, accounting explicitly for a merge result that differs from the tested branch.
- Preserve the existing documented evidence exclusions and disclose their scope. A map receipt or excluded documentation change cannot stand in for executable-source verification.
- Produce a content-free preflight result identifying source, receipt, command outcomes, required PR summary, responsible sign-off, and unresolved operational prerequisites. Missing deployment, runner, migration, or provider evidence remains unverified.
- Prevent the supported command from proceeding when a required local check fails. Document that raw Git pushes/merges can bypass a local command; it is not branch protection or an authenticated attestation of the person running it.
- Keep migration ordering, recovery evidence, serving SHA/version, installed runner adoption, provider execution, and reader lifecycle checks separate. Determine applicable operations from the actual candidate, not historical migration numbers or spend approvals.

**Verification:** Extend [release-evidence tests](../../../scripts/pattern-release/release-evidence.test.mjs) and [reconciliation tests](../../../scripts/pattern-release/release-reconciliation.test.mjs) with missing/stale/failed receipt, source drift during the gate, changed candidate/merge mapping, changed artifact, incomplete lane list, and documented bypass cases. Use fake Git repositories and fake command execution for failure paths; no test pushes or deploys. Run `npm run test:content`, then a real final source-bound `ci:local` gate.

**Release boundary:** Preflight/tooling and its documented use can be reviewed separately from operational adoption. The bootstrap PR includes a real gate summary; subsequent implementation PRs use the adopted preflight. No command should infer authority to merge or deploy from a passing receipt.

**Responsible role / next handoff:** Release maintainer, explicitly identified in the release record. All subsequent implementation merges consume this workflow.

## Slice 3 — Interpretation-quality baseline

**Specification:** [Interpretation-quality baseline and contrasting-chart panel](../specs/2026-09-08-interpretation-quality-baseline-design.md).

**Scope and deliverable:** A versioned review rubric, a complete 60-fragment coverage register identifying the 40 admitted records, and a small contrasting-chart evaluation panel. Use [corpus provenance](../../../pattern-corpus/provenance.json), the actual builder mapping, and [retained fictional evaluations](../../reviews/2026-09-06-source-register-followup.md) as inputs.

**Entry decisions:** Name the editorial reviewer and evaluation owner; freeze rubric dimensions, panel cases, scoring anchors, and escalation rules before judging outputs. Begin inventory and harness work while reviewer assignment is outstanding, but do not claim adjudicated certification.

**Acceptance criteria:**

- Each fragment has an explicit included/omitted disposition and reason; every admitted record is traceable to its prepared fragment. Assess broad predicates, signs, cross-cutting meanings, and repeated proposition fallbacks.
- Score calculation correctness, source entailment, chart specificity, coherence/contradictions, useful tensions, repetition, and reader comprehension separately. Model agreement and reader resonance are separate observations, not validity measures.
- The panel contains materially contrasting charts and exact-, approximate-, and unknown-time cases. Retain blind identifiers, exact input/source/policy pins, outputs, negative controls, reviewer decisions, and disagreements with their resolution status.
- Distinguish synthetic fixtures, historical retained provider outputs, new authorized provider samples, and consented reader studies. Coverage and authorship labels follow evidence rather than corpus titles or compatibility fields.
- Publish baseline findings and prioritized changes, including unresolved findings. This slice can complete with documented weaknesses; it does not silently rewrite the corpus or certify unsupported quality claims.

**Verification:** Reconcile register totals to the prepared corpus and built release, repeat deterministic evaluations, and verify claim-to-source links plus rejection controls. Run relevant existing evaluation/claim-support tests. Editorial adjudication and reader comprehension require recorded review evidence in addition to automated results.

**Release boundary:** Rubric, register, harness, and evaluation report. Any new corpus release, predicate grammar, prompt/policy change, provider spending, or reader recruitment is a separate scoped action. No production activation is needed for the baseline.

**Responsible role / next handoff:** Editorial reviewer and evaluation owner. Supply criteria to 4/5 and an evidence baseline to any later 13 investigation.

## Slice 4 — Connected reader journey and provenance

**Specification:** [Reader relationships, exact editions, and durable passage support](../specs/2026-09-08-reader-relationships-feedback-design.md).

**Scope and deliverable:** One complete Today → Pattern chapter → calculated Timing → earlier saved reading/History → existing feedback journey. Start from [ReadingArticle](../../../apps/web/src/components/ReadingArticle.tsx), [TodayView](../../../apps/web/src/components/TodayView.tsx), [HistoryView](../../../apps/web/src/components/HistoryView.tsx), [TimingView](../../../apps/web/src/components/TimingView.tsx), and the [Daily V2 command](../../../apps/api/src/services/generation-command-v2.ts).

**Entry decisions:** Select an inspectable example set and define a minimal relationship representation: relation kind, supporting evidence, exact document edition/chapter, chart/source identity, dates/time zone where relevant, and access/invalidity behavior. Agree the interface before parallel frontend/backend work.

**Acceptance criteria:**

- Every connection explains its reason: shared calculated feature, supported editorial relation, dated occurrence, or the reader's own reflection. Unsupported thematic resemblance does not become a causal statement.
- Links return to exact editions and preserve the complete authored reading. Missing, recalled, replaced, invalidated, or erased destinations produce an honest explanation and valid next action, with no automatic substitution of another edition.
- Authorization follows the destination and source permissions. No wider personal context crosses provider boundaries; distinguish inputs available to generation from inputs proven to support a passage.
- One concise provenance pattern covers Daily, Pattern, Timing, and visual derivatives, with uncertainty and withheld/unknown states explained.
- Keyboard, mobile, history/back navigation, and fallback journeys work. Existing feedback remains usable at the end of the journey without requiring Slice 5's new categories.
- A recorded comprehension exercise checks whether a reader can finish the journey, explain the connections, identify the edition, and distinguish calculation from interpretation. Interaction tests establish navigation behavior; they do not substitute for comprehension evidence.

**Verification:** Component tests for the four destinations and relationship states; API/access tests for edition and permission handling; rendered browser checks with screenshots at narrow and wide viewports. Test source change/recall, grant revocation, uncertainty, and deletion. Run affected API/web suites and the final full gate.

**Release boundary:** First prove the journey locally using a small manually verified relationship set with clear attribution. A shipped relationship contract or persistence change gets its own compatibility review, fixtures, and migration if needed. No graph database, reading regeneration, or new model is required.

**Responsible role / next handoff:** Product owner plus frontend/backend implementers. Supply the journey and relationship contract to 5 and share source/edition handling with 6/7.

## Slice 5 — Feedback improvements

**Specification:** [Feedback categories, grant preconditions, and bounded effects](../specs/2026-09-08-reader-relationships-feedback-design.md).

**Scope and deliverable:** Distinct feedback categories with understandable, permitted effects, building on 4. Extend the existing [feedback store](../../../apps/api/src/db/feedback.ts), [context compiler](../../../apps/api/src/services/context-compiler.ts), [ranking policy](../../../packages/reading-engine/src/ranking.ts), and reader controls.

**Entry decisions:** Specify a compatible mapping or versioned contract for repetitive, unclear, not relevant today, and incorrect birth details. Define each effect and the measurement that could show improvement before collecting the category.

**Acceptance criteria:**

- Repetition feedback can influence permitted repetition control; unclear feedback records a comprehension/editorial issue; relevance records relevance; incorrect birth details routes to profile correction with actual lifecycle consequences explained.
- Grant absence/revocation blocks future context use as required. Current deliberate submission creates/reuses the bounded USR-12 first-party grant; explain that effect and any renewal before sending. A stale categorical form cannot silently renew a subsequently revoked grant. Submission does not grant unrestricted context or training-data permission. Optional notes have explicit storage, export/deletion, and use rules.
- Preserve old feedback documents and historical editions; define duplicate/idempotent submission behavior and compatibility for older clients. Do not widen frozen M0 enums in place.
- Explain effects before submission and after success. Measure comprehension and quality changes against 3's baseline; increased theme rotation or resonance alone does not establish improvement.

**Verification:** Extend [feedback integration tests](../../../apps/api/src/routes/feedback.integration.test.ts), context-compiler tests, and reader interaction tests. Cover no grant, revocation, duplicates, old editions, birth correction, note deletion/export, and unsupported old/new wire values. Run contracts when changed, affected suites, rendered checks, and the full gate.

**Release boundary:** Contract/storage support and client rollout may be separate PRs with backward compatibility maintained. Activation of a new allowed use requires its explicit consent and explanation; it is not bundled into category storage.

**Responsible role / next handoff:** Product and reading-policy owners. Retain a measurable feedback-effects record for later evaluation.

## Slice 6 — Observatory compatibility

**Specification:** [Adaptive chapter support and staged compatibility](../specs/2026-09-08-adaptive-observatory-contract-design.md).

**Scope and deliverable:** Support valid 3/4/5/6-chapter readings through a content-respecting portrait/Observatory policy. Coordinate [API portrait admission](../../../apps/api/src/services/pattern-portrait.ts), [mesh generation](../../../apps/api/src/services/pattern-portrait-mesh.ts), the [client manifest loader](../../../apps/web/src/lib/pattern-portrait.ts), and `apps/web/src/components/portrait-explorer/`.

**Entry decisions:** The detailed spec selects adaptive stations for every source chapter. Use its versioned chapter identity/count semantics across manifests, image/mesh jobs, caches, revision, and cancellation. Reconcile the pre-existing local Observatory work before editing those files.

**Acceptance criteria:**

- All four valid chapter counts have explicit tested behavior, with one station per source chapter in source order. Never add/remove/rewrite text chapters to satisfy a four-slot renderer.
- Existing four-chapter assets and source bindings remain readable. A changed source edition cannot silently adopt an earlier edition's image or mesh.
- Complete text stays available through pending, failed, unavailable, and non-WebGL states. Optional graphics do not block a valid reading.
- Preserve keyboard navigation, focus/reading position, reduced motion, long text, mobile framing, and graphics-loss recovery. The preserved reading and its source identity remain primary.

**Verification:** Count-matrix contract/admission/manifest tests, image/mesh identity and cancellation tests, fixture asset checks, and portrait navigation/runtime tests. Capture rendered desktop/mobile fallback, reduced-motion, keyboard, and recovery evidence. Run affected API/runner/web lanes and the full gate; mark physical-device or assistive-technology checks separately.

**Release boundary:** Stage any manifest/API compatibility before the client starts emitting new shapes. Keep accepted older assets readable and define forward recovery/rollback. This slice need not change visual style or request provider generation to prove local compatibility.

**Responsible role / next handoff:** Product, frontend, and portrait-runtime owners. Share optional-asset state behavior with 7.

## Slice 7 — Readiness and operational visibility

**Specification:** [Composed reader states and operational metric contracts](../specs/2026-09-08-readiness-runner-fairness-design.md).

**Scope and deliverable:** Consistent reader explanations/actions plus content-free operator status, using [Pattern state](../../../apps/api/src/services/pattern-state.ts) as the existing authority. Include queue age and failure visibility by text, portrait, and mesh work class.

**Entry decisions:** Agree presentation states and their mapping from existing domain states, metric names/units and age origin, closed failure categories, and operator access. Assign the responder and alert destination before claiming operational closure.

**Acceptance criteria:**

- Needs input/permission, queued/working, ready, retryable failure, paused, and unavailable presentations explain the actual next action. Compose birth/chart/Daily/Pattern/asset availability; do not invent a single linear backend state machine.
- A complete reading remains accessible while optional assets wait or fail. States and actions remain consistent after refresh, source change, consent withdrawal, and terminal failures.
- Expose oldest pending age and completion latency per work class, lease expiry/recovery, failed publication, and retry exhaustion with defined clocks and reset behavior. Queue counts alone do not imply health.
- Status, logs, and alerts contain closed codes and bounded operational data, without prose, prompts, private chart facts, arbitrary errors, or secrets. Use existing failure events when sufficient.
- `/health` remains liveness and `/v1/meta` remains configured release identity. Neither is labeled provider success, runner adoption, or complete reader lifecycle proof.

**Verification:** State-service and UI mapping tests; fake-clock queue/lease tests; redaction tests using hostile/private error inputs; authorization tests for operator status. Render representative states and actions. Run affected suites and the full gate. Operational completion additionally requires dated evidence that the chosen destination/responder receives the intended signal.

**Release boundary:** State presentation, metrics, and alert wiring may ship independently with their evidence boundaries explicit. An unassigned responder leaves operational adoption open, while locally verified engineering can still be recorded.

**Responsible role / next handoff:** Product and runtime owners, plus an assigned operational responder. Share the metric contract with 8.

## Slice 8 — Runner fairness

**Specification:** [Weighted sequential scheduling and its measurable bounds](../specs/2026-09-08-readiness-runner-fairness-design.md).

**Scope and deliverable:** Demonstrate progress for text, portrait, and mesh workloads under sustained mixed demand. Begin with [runner.ts](../../../apps/codex-runner/src/runner.ts) and [runner tests](../../../apps/codex-runner/src/runner.test.ts).

**Entry decisions:** Reproduce text-first starvation using deterministic fake clients, then implement the spec's 4:1:1 weighted rotation with concurrency one. Preserve its six-slot opportunity bound and explicit in-flight/timeout assumptions. Reuse 7's metric definitions; do not wait for its UI.

**Acceptance criteria:**

- Under continuous demand, every enabled and eligible class gets an opportunity within the declared six-slot bound once earlier calls return. Disabled, empty, and nonfatal failing classes cannot restart priority at text. A stalled in-flight call delays other work until its existing timeout/return; no wall-clock completion or hung-provider isolation guarantee is claimed.
- Preserve lease exclusivity, renewal/expiry, cancellation, account/domain ownership, idempotency, and all existing spend/attempt ceilings. Demonstrate duplicate/overlapping execution safety before introducing concurrency.
- Record deterministic before/after progress and latency by class. Production backlog and user impact remain unmeasured until directly observed; tests establish scheduling behavior.

**Verification:** Runner fake-clock/fake-client regressions for continuous text load, mixed backlogs, no work, each failing class, shutdown, expired leases, cancellation, and duplicate completions. Run `npm run test -w @patternlike/codex-runner`, affected API claim/lease tests, runner build, and the full gate.

**Release boundary:** Runner policy changes are independent of API/UI rollout when compatible. Installation and restart use separate authority; retain installed artifact identity and observed work-class progress before calling the new policy operationally adopted.

**Responsible role / next handoff:** Runtime maintainer. Retain the measured fairness policy and rollback conditions in the runner runbook.

## Slice 9 — Shared Codex exchange mechanics

**Scope and deliverable:** One narrow helper piloted across Daily and Pattern adapters. Start from [Daily adapter](../../../apps/api/src/services/codex-reading-publisher.ts), [Pattern adapter](../../../apps/api/src/services/codex-pattern-publisher.ts), [shared contract](../../../apps/api/src/services/codex-provider-contract.ts), jobs, and encrypted artifacts. Evaluate ontology adoption only after the pilot.

**Entry decisions:** Freeze which serialization, request/job identity, enqueue, pending/failure handling, and response-adoption mechanics are actually equivalent. Write the helper's inputs/outputs and owner boundary from those callers.

**Acceptance criteria:**

- Preserve exact request bytes, invocation/job/artifact identities, encryption coordinates, idempotency, timeout behavior, closed errors, and accounting for both adapters.
- Keep Daily/Pattern publication, consent, erasure, and frozen command semantics in their domains. Ontology's non-user ownership and image/mesh output validation do not become defaults of a universal lifecycle.
- Prove equivalent outcomes for accepted, pending, failed, malformed, cancelled, retried, and already-stored exchanges. No provider or model/configuration migration is hidden in the extraction.

**Verification:** Characterize the two adapters with fixed requests and fake exchange outcomes before extraction. Retain adapter, contract, job, artifact, and cancellation tests; run affected API lanes and the full gate. Live provider calls are unnecessary for a mechanical extraction.

**Release boundary:** Helper plus first two consumers form a reviewable unit, or sequential PRs each preserving behavior. Additional consumers require their own equivalence evidence.

**Responsible role / next handoff:** Backend maintainer. Supply a stable mechanics boundary to later stage work only where useful.

## Slice 10 — Orchestrator simplification

**Scope and deliverable:** Extract existing stages incrementally from Pattern, Daily, or ontology execution after inspecting real call/transition boundaries. Begin with [Pattern execution](../../../apps/api/src/services/pattern-execute.ts), [Daily V5 execution](../../../apps/api/src/services/generate-daily-reading-v5.ts), or [ontology execution](../../../apps/api/src/services/ontology-pipeline-execute.ts); select one stage for the first change.

**Entry decisions:** Name the selected stage, its inputs, outputs, side effects, artifact ownership, and transition contracts. Account for already-extracted deterministic engines and the existing Pattern stage protocol.

**Acceptance criteria:**

- Preserve frozen V1/V2 commands and execution pins, artifact-first adoption, counter timing, guarded transitions, retries, cancellation, budgets, and publication receipts.
- Compare observable stage outcomes and durable effects before/after extraction. A smaller file or passing typecheck alone is insufficient.
- Each extraction stands alone and can be reverted without a naming migration, new provider, or universal state framework. Use 9's helper only when it actually belongs in the selected stage.

**Verification:** Characterization/integration tests cover crash-after-artifact adoption, exhausted attempts, writer/verifier corrections where applicable, lease/consent loss, duplicate queue delivery, failed publication, and terminal cleanup. Retain existing stage-protocol tests, run affected suites, and the full gate.

**Release boundary:** One stage or transition operation per independently reviewed change. Do not combine the three large orchestrators into one rewrite.

**Responsible role / next handoff:** Backend maintainer. Record reduced responsibilities and preserved interfaces in the stage's implementation plan.

## Slice 11 — Model/configuration vocabulary

**Scope and deliverable:** Clarify source names and then deployed-variable names through a compatibility-aware migration. Inventory publishers, prompts/policies, `apps/api/src/env.ts`, `apps/api/wrangler.toml`, runner configuration, scripts, and [release reconciliation](../../../scripts/pattern-release/release-reconciliation.mjs).

**Entry decisions:** Approve a name matrix separating domain model role, transport/provider identity, deployed variable, and historical provenance. Define accepted old/new forms, conflict behavior, effective-value observability, and removal criteria before changing consumers.

**Acceptance criteria:**

- New source names describe roles such as reading model or Pattern planner model. Rename only present configuration concepts; preserve original provider/model labels in saved readings, frozen commands, and historical receipts.
- Old-only and new-only configurations resolve as specified during migration; equal dual values are handled explicitly and conflicting dual values fail closed. Missing/invalid inputs remain covered by configuration guards.
- Evidence extraction, source fingerprints, scripts, lock/config consumers, and documentation understand the migrated names. A new name cannot imply a provider execution that was never observed.
- Separate source constant changes, deployed-variable introduction, caller switch, and alias removal. Remove old support only after the documented operational adoption evidence exists.

**Verification:** Configuration resolution/guard tests for old/new/both/missing/invalid values; frozen command and historical receipt fixtures; release-evidence/reconciliation tests; source fingerprint checks and build. Run affected suites and the full gate on each compatible stage.

**Release boundary:** Source cleanup and deployment-variable changes are separate boundaries. A variable rollout requires current environment inventory, the approved compatibility order, and effective-value readback; no model change or historical provenance rewrite is implicit.

**Responsible role / next handoff:** Repository and release maintainers. Leave a dated deprecation/removal record for each variable family.

## Slice 12 — Calculation-service naming

**Scope and deliverable:** Rename the real calculation workspace and update its packaging and operational references. Inventory [apps/calc-stub](../../../apps/calc-stub/package.json), root scripts/lockfile, Docker build paths, CI and release-tool lane names, deployment files, health references, and the [AGPL source offer](../../legal/AGPL_SOURCE_OFFER.md).

**Entry decisions:** Select the directory/package names and decide which public developer commands remain stable. Map every operational consumer before moving files. This slice is independent of model-variable vocabulary work.

**Acceptance criteria:**

- Workspace resolution, lockfile, Docker context/COPY paths, build/test/dev commands, CI lane parsing, artifacts, and source-offer references resolve the same calculation implementation under the selected names.
- Calculation contracts, engine/data pins, goldens, auth behavior, license text, notices, and source availability remain intact. Preserve historical names in dated artifacts with an explanatory mapping.
- Distinguish removable live references from intentional historical references. A stale-path search has an explicit disposition for each remaining occurrence rather than requiring a destructive blanket replacement.

**Verification:** Lockfile dry run, workspace typecheck/test/build, deterministic calculation goldens, API calculation-client tests, packaging/container build from the documented context, and source-offer path/license parity checks. Update release-lane tests if the workspace name changes their expected summary. Run the final full gate using the renamed workspace.

**Release boundary:** Land a coherent rename that builds and packages from a clean checkout. Coordinate external build/host paths before operational adoption; do not change calculation behavior or licensing policy in the rename.

**Responsible role / next handoff:** Calculation and release maintainers. Provide old/new path mapping and deployment packaging instructions.

## Slice 13 — Conditional machine-ontology re-entry

**Scope and deliverable:** A current-pin diagnosis and evidence-backed go/no-go decision. Use the roadmap's sections 4/5, the dated [candidate ledger](../../deploy/openai-pattern-rollout.md), planner validation/closure rules, and ontology regression command/executor/report code.

**Entry decisions:** Name the investigation owner and freeze source, command, model/prompt/policy/output/transport pins and retained inputs. Begin with offline retained-input evaluation. Any provider evaluation needs separate bounded authorization for its selected pins and numeric spend ceiling.

**Acceptance criteria:**

- Record per-attempt planner rejection reasons and distinguish provider/configuration, compilation, evaluation, regression, and publication-safety failures. Reproduce or reject the historical planner hypothesis under the frozen current pins.
- Preserve the thirty-fixture corpus, eleven-call per-fixture worst-case envelope, pass-rate rules, dependencies, semantic/safety gates, and accounting. Historical call totals or absent hard-gate events do not certify unfinished fixtures.
- Report evidence gaps and quality findings alongside technical outcomes. A no-go is a valid completed investigation; define its reason, owner, and reopening trigger.
- A go decision identifies the remaining evaluation, corpus authorization, budget, signing/ingestion, activation, and lifecycle prerequisites. It neither creates public eligibility nor authorizes activation.

**Verification:** Deterministic retained-input planner checks and regression/report accounting tests first. Retain exact source/pin identities and safe failure codes. Authorized provider work, if justified, has its own bounded receipt and must not be relabeled as a full candidate/regression run. Any implementation change passes affected suites and the full gate.

**Release boundary:** Diagnosis and decision only. Keep `ONTOLOGY_PIPELINE_ROLLOUT` parked and preserve internal-origin reader admission. New candidate creation, provider calls, rollout configuration, signing/ingestion, and activation each retain their established authority and evidence requirements; activation requires separate approval.

**Responsible role / next handoff:** Operator plus evaluation owner. No core slice waits for this decision.

## Per-slice execution record

Create the concrete task plan only for the slice being taken up. Copy its scope, entry decisions, acceptance criteria, and release boundary from this ledger, then add exact files/interfaces and the smallest independently verifiable tasks. Do not mark a slice complete from checkbox counts alone.

- [ ] Resolve the slice's entry decisions and record who owns acceptance and operational follow-up.
- [ ] Refresh source/runtime evidence applicable to the work; preserve dated earlier observations and unrelated checkout work.
- [ ] Record exact file/interface changes and meaningful regression cases before implementation.
- [ ] Complete focused implementation verification and any required rendered or editorial evidence.
- [ ] Freeze source; run and retain the real full merge gate and Slice 2 preflight when implementation is being merged.
- [ ] Record merge/deployment/operational evidence only for actions actually authorized and performed.

## Evidence checked while preparing this ledger

On 2026-09-07, local HEAD was `6e706741f03253f2807d33380afb529161f3481f`. All 86 files in the original map snapshot matched their recorded SHA-256 hashes; their recorded line anchors resolved, and the map Markdown matched its recorded hash. The roadmap, current comments/runbook, package scripts, and release-evidence implementation were inspected to define the boundaries above.

These checks establish the planning inputs' local identity. They do not implement Slice 1, re-run the editorial baseline, observe production, or constitute `ci:local`. This ledger introduces no application, configuration, corpus, or saved-reading changes.

On 2026-09-08, the five additional specifications were checked against the same HEAD and current local release tooling, feedback/grant compiler, stored cycle identity, portrait contracts/migrations, Pattern state, and runner poll loop. All twelve selected chart-seed files contain the expected accuracy class and a chart snapshot. A design arithmetic check covered every starting cursor of the proposed 4:1:1 rotation; it is not an implemented-runner test. Documentation checks resolved all 88 local links across these five specifications and this ledger. The 134 pre-existing working files were preserved apart from this intended ledger update. No application test suite, provider evaluation, human adjudication, production observation, or release action was performed for this documentation update.
