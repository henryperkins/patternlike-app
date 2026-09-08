# Patternlike: application alignment and improvement roadmap

Date: 2026-09-07

Source baseline: `6e706741f03253f2807d33380afb529161f3481f`, including the pre-existing local observatory edits captured by the mind map.

Status: consolidated findings and planning brief; not an approved implementation or production rollout plan.

## 1. The central opportunity

Patternlike already has substantial calculation, reading, provenance, privacy, generation, and spatial-exploration capabilities. The largest product opportunity is connecting them into a reading experience that accumulates meaning over time. The engineering opportunity is making those connections and their supporting workflows easier to understand, operate, and verify.

The three reviews contribute complementary perspectives:

- Product: connect Today, Your Pattern, Timing, Time travel, History, feedback, and the observatory around supported relationships.
- Content: distinguish correct calculations, faithful interpretation of admitted sources, and readings that are specific, coherent, and useful.
- Engineering: clarify naming, reduce demonstrated duplication, expose operational state, and make large execution workflows easier to audit without flattening their different safety boundaries.

The resulting direction is **a coherent reader journey supported by stronger quality evidence and targeted infrastructure improvements**. A universal generation framework, an ontology rollout, or a directory rename is not itself the product outcome.

This document consolidates the mind map, the subsequent reviews, their source-verified corrections, and the additional ontology investigation. It records proposed work without authorizing code changes, provider calls, migrations, activation, deployment, or changes to existing readings.

## 2. Evidence and revision boundaries

Use these distinctions throughout planning:

| Evidence class | What it means | What it does not establish |
| --- | --- | --- |
| Verified source | Current local implementation, configuration, callers, or a reproduced offline result | Current production configuration or successful reader use |
| Recorded observation | A dated repository artifact describing a past production query or run | An observation made during this exercise, or a guarantee it remains current |
| Hypothesis | A plausible improvement or failure explanation grounded in inspected source | A measured product benefit or established current production defect |
| Proposed work | A bounded next action with a success condition | Approval to implement or deploy it |

The original [mind map](../../output/mindmaps/2026-09-07-184743/patternlike-source-mindmap.md), [source evidence](../../output/mindmaps/2026-09-07-184743/source-evidence.md), and [snapshot](../../output/mindmaps/2026-09-07-184743/source-snapshot.json) contain eight branches, 34 topics, 68 detail leaves, and 86 distinct source-file hashes. All 86 hashes still matched when this report was prepared. These map files are workspace artifacts; include them when sharing the report outside this checkout.

The third review cited `e02950f1f20bc8d41369f257e7a8ca90a21d7863` as newer than the map. Git establishes the reverse: it is the August 29 commit `api: personalize Daily reading voice`, 33 commits behind the September 7 map revision. Its Windows checkout's uncommitted contents were not available for inspection. Do not use that review's chronology or line counts as a current release receipt.

A map is an index into evidence, not exhaustive proof. Repeated anchors and parallel branch shapes are useful investigation signals. An import is not ownership of an implementation, an omitted topic is not an absent capability, and similar stage names do not establish identical lifecycle semantics.

## 3. What the application currently consists of

| Area | Source-grounded role | Alignment opportunity |
| --- | --- | --- |
| Web application | React/Vite PWA with Today, Pattern, Timing, Time travel, History, account/privacy controls, and optional observatory exploration | Make separate destinations support one understandable reading journey |
| API | Hono Worker handling authentication, account state, calculations, reading access, reservations, publication, and lifecycle operations | Explain readiness and actions consistently without duplicating authority in the client |
| Calculation | `apps/calc-stub` is the real Swiss Ephemeris service, not a mock; deterministic natal, cycle, and daily-sky information feeds interpretation | Clarify its name and keep calculation evidence separate from interpretive claims |
| Daily | Versioned durable commands; deterministic selection and constrained model generation; permitted context and bounded feedback use | Support verified Pattern/history relationships without inventing causal explanations |
| Pattern | Deterministic chart-evidence selection and ontology admission, then planner/writer/verifier stages and publication proof | Improve semantic specificity and make reasons for inclusion, omission, or refusal understandable |
| Ontology | An offline corpus-to-ontology path and a separate, currently disabled machine-production pipeline | Make the actual supply path, coverage, review status, and activation rules explicit |
| Codex execution | Shared text invocation/job/artifact infrastructure for Daily, Pattern, and ontology; installed runner also has separate image and mesh work | Reuse existing mechanics and address scheduling fairness across work classes |
| Portrait/observatory | Source-bound chapter imagery, compiled 3D objects, spatial navigation, and a preserved complete reading | Make space useful for revisiting meaning; support valid document shapes and accessible fallback |
| Trust and operations | Consent, encrypted payloads, source identities, signing, recall, export/deletion, replay, local verification, and release attestation | Surface the right evidence to readers and operators without exposing private payloads |

Repository boundaries are documented in [AGENTS.md](../../AGENTS.md). Relevant entry points include [web navigation](../../apps/web/src/App.tsx), [API routing](../../apps/api/src/index.ts), [calculation service](../../apps/calc-stub/src/server.ts), [Daily command construction](../../apps/api/src/services/generation-command-v2.ts), and [Pattern execution](../../apps/api/src/services/pattern-execute.ts).

The written reading and its source identity remain primary. Visual assets are derived representations, not additional evidence for the interpretation. Correct astronomical calculations, faithful use of interpretive source material, and empirical truth about a reader's traits or events are different claims.

## 4. Ontology supply: the now-established picture

### 4.1 The supply chain

The current offline path is:

1. [Authored corpus input](../../pattern-corpus/fragments.json): 60 source fragments with references, locations, excerpts, propositions, rights classifications, and allowed transformations.
2. [Corpus preparation](../../apps/api/scripts/prepare-ontology-corpus.ts): produces the canonical release envelope, stable fragment IDs, and corpus hash.
3. [Internal ontology builder](../../apps/api/scripts/build-internal-ontology.ts): consumes that prepared envelope, maps supported sections into predicates, and compiles a `synthetic_internal` candidate. This script makes no provider call.
4. [Internal signing route](../../apps/api/src/routes/internal-pattern.ts): recomputes the bundle hash and calls `signInternalOntology` through the isolated signer binding. It returns a signed release; it does not ingest or activate it.
5. Separate ingestion at `POST /internal/pattern-ontology-releases`: verifies the release, enforces immutability/recall rules, and delegates the guarded release/status/pointer update to [ontology storage](../../apps/api/src/db/pattern-ontology.ts).
6. Pattern loads and verifies the admitted release. `ontologyServesAccount` admits `synthetic_internal` by origin; `machine_pipeline` additionally requires a re-derived `public` activation scope. Other account, chart, consent, and generation gates still apply.

The signer key remains behind the isolated [ontology-signer Worker](../../apps/ontology-signer/src/index.ts). The two [signing-client functions](../../apps/api/src/services/ontology-signing-client.ts) are deliberately separate: the internal path must not be represented as having the machine path's evaluation evidence.

### 4.2 What the offline builder actually includes

Re-running preparation and the real builder under Node 22.23.2 produced **40 records and 20 skipped fragments**:

| Corpus section | Material | Included records | Skipped fragments |
| --- | --- | ---: | ---: |
| §1 | Bodies | 11 | 0 |
| §2 | Signs | 0 | 12 |
| §3 | Houses, mapped to house-cusp predicates | 12 | 0 |
| §4 | Aspects | 5 | 0 |
| §5 | Angles | 4 | 0 |
| §6 | Pattern-level material | 4 | 0 |
| §7 | Uncertainty | 4 | 0 |
| §8 | Cross-cutting interpretive material | 0 | 8 |
| Total | | 40 | 20 |

All 40 records are `source_supported` and cite exactly one prepared fragment. The candidate uses schema `0.7.0`, version `pattern-ontology-en-us-internal-0.1.0`, and origin `synthetic_internal`.

The missing sign predicate is a real representation boundary. The §8 omissions are also real, but do not prove that every associated safeguard is missing elsewhere: some may be represented in prompts or publication policy. Before extending the grammar, trace where each omitted meaning belongs and assess whether the current mapping loses important distinctions. A sign-specific interpretation must not be attached indiscriminately to every position.

The builder also derives tensions and counter-expressions through sentence matching, falling back to the fragment's proposition when no match is found. That is deterministic and traceable, but not independent editorial evidence that those fields express meaningful contrasts. Include this mapping in the quality evaluation.

### 4.3 Stronger historical evidence than a matching version name

The supplied review cited an August 27 active-pointer observation. A newer [recorded production observation](./artifacts/2026-09-06-source-register-followup/production-observation.json) exists at **2026-09-06T18:49:35.205Z**. It records:

- Active version: `pattern-ontology-en-us-internal-0.1.0`.
- Release status: `active`.
- Matching machine evidence run: `null`.
- Corpus hash: `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`.
- Bundle hash: `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84`.

The locally rebuilt corpus hash and recomputed unsigned ontology bundle hash match those recorded values. This confirms that the inspected source reproduces the recorded release content identity, not merely its version label. It does not re-fetch the live object, verify its current signature, or establish today's active pointer.

The September 6 query was an active-pointer join, not a complete history of every release or evaluation receipt. Do not inflate its null joined evidence into a fresh claim that all pipeline-evidence tables are empty.

### 4.4 Authored does not mean independently human-authored or reviewed

The [corpus provenance register](../../pattern-corpus/provenance.json) records `model_generated_first_party`, 60 fragments, and zero certified human-reviewed fragments. Exact historical generating provider/model/account details remain unverified. `licensed_excerpt` is the recorded rights classification; it does not establish independent human authorship, scholarly authority, or editorial certification.

The offline builder makes no model call, but that does not mean the corpus from which it builds was created without a model.

The internal candidate also contains `evaluator_passed: true` and `unevaluated_fixture_count: 0` alongside `regression_passed: false`, without running an independent evaluator. These are compatibility fields in this path, not evaluation receipts. Reader explanations, source registers, and admin status must interpret them together with origin and actual evidence, never as a generic “quality certified” badge.

This makes the ontology a product-quality investigation, not merely a parked automation project. Review all source material intended for future use, while explicitly tracking the 40 records that the current builder admits.

## 5. Machine ontology: what blocks it and what remains unproven

### 5.1 Current code-enforced boundaries

Both committed Wrangler blocks set `ONTOLOGY_PIPELINE_ROLLOUT = "off"`. The mode vocabulary is `off | internal`; it controls production work, not reader activation. Reader admission is a separate decision.

| Boundary | Current mechanism | Planning consequence |
| --- | --- | --- |
| Compilation | [Pattern-engine ontology compiler](../../packages/pattern-engine/src/ontology.ts) validates structure and meaning dependencies | Do not bypass missing dependencies or cycles to get a candidate through |
| Rule evaluation | [Pipeline execution](../../apps/api/src/services/ontology-pipeline-execute.ts) rejects the run when an evaluated rule is rejected | A high average score does not override a rejected rule |
| Regression | The frozen [pipeline command](../../apps/api/src/services/ontology-pipeline-command.ts) names 30 fixtures and 11 maximum provider calls per fixture | Preserve the fixture set, frozen identity, and accounting while investigating failures |
| Hard safety gates | [Shared publication safety](../../apps/api/src/services/pattern-publication-safety.ts) covers suppressed-feature leakage, uncited claims, source dependencies, prohibited claims, mandatory omissions, private projection, and semantic refusal | Apply the relevant safety checks consistently; do not dilute them to complete a run |
| Pass-rate floor | [Configuration guard](../../apps/api/src/middleware/config-guard.ts) sets 0.9 normally and 1.0 when generator and evaluator models are equal | Current equal-model configuration requires 100%; a floor does not waive hard failures |
| Per-fixture attempts | Two planner calls, three writer calls, and up to two verifier calls for each writer candidate: 11 worst-case calls | Separate malformed plans, provider failures, writer corrections, and verifier outcomes when accounting for exhaustion |
| Provider boundary | [Pattern packet](../../apps/api/src/services/pattern-packet.ts) constrains the material sent to a provider | Cross-feature work must not leak identity, withheld facts, or unpermitted context into prompts |
| Machine activation | [Activation-scope SQL](../../apps/api/src/db/pattern-ontology.ts) checks committed evidence, corpus authorization, report/hash agreement, and release receipts | An operator-facing toggle or stored scope value alone cannot make a release public-capable |
| Per-document publication | [Publication proof](../../apps/api/src/services/pattern-publication-proof.ts) binds the actual candidate and applies shared safety in current Pattern execution | A passed document is not whole-corpus certification; the internal origin does not exempt new documents from these checks |

Code-enforced means the current implementation refuses violations. It does not mean the code is infallible or can never be changed. Changes require the applicable contract, policy-version, fixture, and release review; not every internal refactor requires a schema bump.

The existing 30-fixture corpus is duplicated across command literals and static imports in [regression execution](../../apps/api/src/services/ontology-regression.ts) and [report verification](../../apps/api/src/services/ontology-regression-report.ts). Do not shrink it or change one constant independently. This review did not independently prove the supplied combinatorial claim that seven fixtures are the minimum coverage set.

### 5.2 The historical planner failure is a lead, not a current diagnosis

The [rollout ledger](../deploy/openai-pattern-rollout.md) describes candidate `0.1.17` on August 25 as compiling, passing ten evaluations, and stopping at regression cursor 95 after 96 regression calls: 40 planner, 31 writer, and 25 verifier. It attributes the stop to planner closure and an exhausted pass ceiling; the recorded run lacked a named hard-gate event.

Keep four qualifications attached to this evidence:

1. Cursor 95 is an execution/result cursor, not 95 completed fixtures out of 30. The executor tracks fixture index separately.
2. More than 30 planner calls implies repeated planner work under the reported 30-fixture execution, but counts and nonempty byte lengths alone do not prove ten semantically complete plans were rejected specifically by `validatePatternPlan`.
3. No recorded hard-gate event in that run does not establish that the remaining fixtures would pass, nor that the ontology is useful or correct. Earlier candidates did fail content gates, including prohibited claims and suppressed-feature leakage; others failed before regression.
4. The shared planner prompt already includes `PLAN_CLOSURE_RULES`, and execution already emits named regression-failure events. The historical run used different pins. Reproduce the remaining issue under an explicitly frozen current configuration before calling it today's binding constraint.

The defensible next experiment is a small offline/retained-input planner evaluation with per-attempt rejection reasons, followed only if justified by an authorized, bounded provider evaluation. A new immutable machine candidate is not the first diagnostic step. Do not change the attempt ceilings or reduce the fixture corpus to manufacture success.

### 5.3 Operational decision

Maintain the explicit parked producer state while its evaluation, budget, and operational prerequisites are unresolved. Retain the independent release-loading, signature, recall, evidence, and cleanup responsibilities that remain necessary.

The decision is not “activate everything or remove everything.” Record the producer's owner, the evidence required to reopen it, and a review trigger. Do not restore machine-only reader admission as a cleanup: that would reject the currently supported internal-origin supply path.

Historical Gate 6 spend approvals do not automatically cover newer model/output/transport combinations. The runbook's Gate 8–10 language also mixes an older cohort rollout with later account-wide behavior. Reconcile each gate against current code and dated lifecycle evidence; do not blanket-label all gates open, passed, or not applicable.

## 6. The reader-facing improvements

### 6.1 One supported journey across the application

Proposed first slice: **Today passage → supported Pattern chapter → relevant calculated timing → an earlier saved reading → scoped feedback**.

The inspected Daily V2 command pins calculation, policy, context, and publication inputs, but does not establish a first-class Pattern-document/chapter relationship. Existing screens and IDs provide useful building blocks; the missing work may be semantic relationships as much as navigation.

Start with existing documents and a small, manually verified relationship set. Do not add a graph database, regenerate readings, or introduce another model merely to demonstrate the journey.

Each connection needs a defined relationship and its supporting evidence:

- Which exact document edition and chapter are being linked?
- Is the relation a shared calculated feature, an editorially supported interpretation, a dated occurrence, or the reader's own reflection?
- Which chart version, uncertainty policy, dates/time zone, source IDs, and permissions apply?
- What happens when birth details change, a release is recalled, consent is withdrawn, or an account is erased?

A shared keyword must not imply that a transit caused a personal event or explains a natal interpretation. Keep thematic association, calculation, interpretation, and reflection visibly distinguishable. Where no supported connection exists, say so rather than filling the gap with plausible prose.

Success: readers can find the next meaningful item, explain why it is connected, return to the exact earlier edition, and distinguish a calculation from an interpretation. Measure navigation completion and comprehension before treating increased engagement as improvement.

Source starting points: [Daily command](../../apps/api/src/services/generation-command-v2.ts), [ReadingArticle](../../apps/web/src/components/ReadingArticle.tsx), [History](../../apps/web/src/components/HistoryView.tsx), [Timing](../../apps/web/src/components/TimingView.tsx), and [Time travel](../../apps/web/src/components/TimeTravelView.tsx).

### 6.2 Provenance that answers reader questions

The application already preserves substantial provenance. The opportunity is consistent, useful presentation at the point of reading or action:

- “What information contributed to this passage?”
- “What was withheld because my birth time is uncertain?”
- “Was this topic influenced by permitted feedback or another personal source?”
- “What will changing these birth details affect, and which saved edition am I viewing?”

Use a concise explanation first, with optional deeper evidence. Do not display raw operational payloads or imply that a signature certifies editorial quality. If the system cannot identify which permitted input affected a specific passage, distinguish “available to generation” from “used here.”

Birth corrections must explain actual lifecycle consequences from source. Do not promise that an invalidated or erased document remains accessible merely because history links exist.

Success: one consistent explanation pattern across Daily, Pattern, timing, and visual derivatives; explicit unknown/withheld states; source links honor the same access controls as their destination documents.

### 6.3 Separate quality questions and evidence

Evaluate these independently:

| Question | Appropriate evidence |
| --- | --- |
| Are calculations correct? | Deterministic fixtures/goldens, chart versions, uncertainty and time-zone handling |
| Does prose stay within its admitted sources? | Citation membership plus claim-level support, dependency checks, editorial entailment review, and negative controls |
| Is the reading specific and coherent? | Blind comparison across materially different charts, contradiction review, useful tensions/counter-expressions, repetition assessment |
| Is it useful to readers? | Consented comprehension/usability work and granular feedback, with agreement kept separate from validity |

The existing [claim-support code](../../packages/reading-engine/src/claim-support.ts), semantic verifier, and deterministic safety policies are foundations, not replacements for independent editorial judgment. Generic prose can comply with a source while saying little; a source-linked claim can still be a weak interpretation.

Begin with the actual 40-record internal release and its 60-fragment source register. Assess omitted sign/cross-cutting coverage, broad predicates, and the builder's tension/counter-expression fallback. Include exact-, approximate-, and unknown-time inputs and substantially different charts. Retained [fictional evaluation reports](./2026-09-06-source-register-followup.md) provide regression seeds, not current production success/failure certification; some findings received subsequent changes.

Appoint an editorial reviewer explicitly. Do not attribute review to the corpus's title, the operator, a model verifier, or an unsigned checklist by implication.

### 6.4 Feedback with understandable, bounded effects

Feedback is implemented, not absent. The [feedback store](../../apps/api/src/db/feedback.ts) supports resonance, relevance labels, and an optional note. The [context compiler](../../apps/api/src/services/context-compiler.ts) offers structured feedback through the existing permission/consent path with `repetition_control` and `theme_ranking` uses. The deterministic [ranking policy](../../packages/reading-engine/src/ranking.ts) deliberately excludes hidden engagement-only resonance scoring.

Proposed UX distinctions should lead to different, documented responses:

| Reader feedback | Intended response to investigate |
| --- | --- |
| Repetitive | Adjust permitted repetition control; show that bounded effect |
| Unclear | Flag comprehension/editorial work; do not silently change the underlying calculation |
| Not relevant today | Record relevance without treating disagreement as disproving or validating an interpretation |
| My birth details are wrong | Route to the birth-profile correction flow and explain consequences |

These are proposed categories, not claims about the current wire contract. Adding them needs a compatible mapping or versioned change. Test grant absence, revocation, duplicate submission, old reading editions, and deletion. Optional reflections need explicit storage and use boundaries; they are not automatically training data or future prompt context.

Success: readers understand what their feedback can affect, and evaluation shows benefits beyond merely rotating which themes recur.

### 6.5 An observatory that follows the reading

The observatory already has chapter stations, reading desks, source-linked material, and graphics recovery. Its continuing purpose should be returning to meaningful material and exploring supported relationships—not producing more decorative assets.

A concrete contract mismatch exists: Pattern selection supports 4–6 core chapters, or 3 for sparse inputs, while [portrait admission](../../apps/api/src/services/pattern-portrait.ts) and the [client manifest loader](../../apps/web/src/lib/pattern-portrait.ts) require exactly four. A valid text Pattern can therefore be ineligible for the current portrait path. This is a source-level compatibility limitation, not a measured production failure rate.

Choose a content-respecting approach: adaptive stations for supported counts, or an explicit reader-selected subset with the full reading preserved and selection made clear. Do not force every Pattern to have four chapters to satisfy a renderer. Any contract change must carry document/chapter identities through image, mesh, cache, revision, and cancellation paths.

Success: test 3/4/5/6 chapters, long text, changed source editions, non-WebGL fallback, keyboard navigation, reduced motion, mobile framing, and recovery. Demonstrate improved comprehension and return navigation before further visual-fidelity investment. This exercise did not perform a new rendered UX or device audit.

## 7. Engineering alignment that supports the product

### 7.1 Extend the shared infrastructure that already exists

Daily, Pattern, and ontology already use [Codex invocation/completion contracts](../../apps/api/src/services/codex-provider-contract.ts), [durable jobs](../../apps/api/src/db/codex-provider-jobs.ts), and [encrypted exchange artifacts](../../apps/api/src/services/codex-provider-artifacts.ts). The three adapters still repeat serialization, request identity, enqueue, pending/failure handling, and response-adoption mechanics.

Pilot one narrow helper across two adapters. Preserve exact request bytes, job identity, encryption coordinates, idempotency, failure vocabulary, timeouts, and accounting. Compare behavior with regression tests before expanding it.

Keep domain publication and erasure rules explicit: Daily/Pattern work is user-owned; ontology work is not. Image assets and compiled meshes also have different output and validation contracts. A common interface may eventually model these differences, but the map does not establish that every lane can safely become configuration of one lifecycle.

The [Pattern resolver](../../apps/api/src/services/pattern-publisher.ts) admits only Codex for deployment. Historical `openai`, `synthetic`, and retired `workers_ai` names are not four live choices. Likewise, [Daily dispatch](../../apps/api/src/services/generate-daily-reading.ts) intentionally executes historical V1 commands under their original contract rather than rerouting them to V2.

### 7.2 Decompose by behavior and ownership, not file size alone

Current inspection counted 3,205 lines in ontology execution, 1,959 in Pattern execution, and 886 in Daily V5 execution. These are useful candidates for easier navigation and focused tests. Line counts are not proof of bad design or quantified maintenance cost.

The proposed Pattern anchors at lines 10 and 11 are imports from the already-separated deterministic engine. Provider configuration is already separate too. Start from actual stage handlers, transition boundaries, artifact ownership, and call graphs; do not use map topics as automatic extraction instructions.

Extract one stage or shared transition operation at a time, preserving frozen command compatibility, cancellation, retries, budgets, and publication receipts. It should be possible to review the extraction independently of naming cleanup or provider changes.

### 7.3 Clarify names with compatibility-aware migrations

`OPENAI_*` model pins and the `calc-stub` directory are documented sources of confusion. Prefer domain-oriented names such as `READING_MODEL` and `PATTERN_PLANNER_MODEL`, with transport identity represented separately. Do not blanket-replace genuinely historical OpenAI provenance with Codex labels.

Renaming reaches more than TypeScript: deployed variables, scripts, Docker build paths, workspace/lockfile identity, source fingerprints, evidence readers, and source-offer documents. [Release reconciliation](../../scripts/pattern-release/release-reconciliation.mjs) reads constant names dynamically; the [calculation Dockerfile](../../apps/calc-stub/Dockerfile) embeds the current path.

Treat source constant cleanup, deployment-variable migration, and calculation-directory migration as separable changes. Preserve historical receipts and document old/new interpretation. Keep the existing AGPL boundary, notices, and [source-offer documentation](../legal/AGPL_SOURCE_OFFER.md) intact; renaming is not a licensing-policy change.

### 7.4 Scheduling fairness and coherent readiness

The [runner loop](../../apps/codex-runner/src/runner.ts) awaits text work first, tries portraits only when text is empty, and tries meshes only when preceding classes are empty. Under a sustained text backlog, a single process can indefinitely postpone lower-priority work. That is a scheduling risk visible in source; current queue delay, deployment topology, and user impact were not measured.

Evaluate bounded fairness, aging, or separately budgeted execution capacity while retaining text priority. Before adding concurrency, prove lease, spend, cancellation, and ownership behavior under duplicate/overlapping execution. Measure oldest pending age and completion latency by work class; do not infer health from aggregate job counts.

Build coherent reader readiness on the existing [Pattern state service](../../apps/api/src/services/pattern-state.ts), not a competing authority. Compose per-surface status such as needs input, needs permission, queued, working, ready, retryable failure, paused, or unavailable with an explanation and next action. These are proposed presentation categories, not a replacement wire enum.

Birth details, chart calculation, Pattern, Today, portrait, and mesh do not necessarily share one linear state machine. Preserve their individual availability, and do not block a complete reading while an optional asset is pending.

### 7.5 Observability and release discipline

The map omitted observability. Add health, release identity, safe generation events, queue/lease recovery, and logging/tracing configuration under runtime operations.

The checked-in [production observability block](../../apps/api/wrangler.toml) explicitly sets nested logging enabled and tracing disabled, with top-level observability `enabled = false`. Describe the actual settings; do not turn the presence of a tracing block into a claim of active tracing. [Health](../../apps/api/src/routes/health.ts) is basic liveness; `/v1/meta` attests configured release identity, not successful generation, runner adoption, or lifecycle completion.

Use existing closed failure events such as `ontology_regression_failed` before adding new instrumentation. Proposed operational coverage should include queue age, expired leases, failed publication, retry exhaustion, and stale source/permission state. Logs and alerts must remain content-free; do not include prose, prompts, private chart data, or arbitrary errors. An alert destination and an accountable responder still need explicit assignment.

The release gap is enforcement, not literally an ownerless merge gate. [Repository policy](../../AGENTS.md) assigns a real obligation: run `npm run ci:local` on the candidate and put its summary in the PR before merging. GitHub Actions is billing-locked, and merges still trigger Workers Builds. This report did not independently inspect current remote branch settings or deploy timing.

The existing [release-evidence tooling](../../scripts/pattern-release/release-evidence.mjs) captures local command outcomes and source identity but deliberately leaves deployment/provider evidence unverified. A proposed guarded release command could refuse a missing/failed/mismatched receipt and combine pre-push checks. It would reduce omissions, not prevent someone bypassing it with a raw push. Do not present a local hook as branch protection.

For any authorized rollout, resolve the actual pending migration set, preserve recovery evidence, migrate before the compatible Worker, and verify the resulting deployed SHA/version and domain outcome separately. Do not reuse historical migration numbers or budget approvals as current instructions.

## 8. Corrections that belong in the next documentation pass

This report records the corrections; it does not edit the existing files or rewrite historical observations.

| Claim or omission | Corrected interpretation | Follow-up |
| --- | --- | --- |
| The map became stale at `e02950f` | That commit predates the map by 33 commits; all 86 mapped source hashes still match locally | Bind regenerated maps to source and dirty-file hashes |
| No shared generation contract exists | Shared Codex text transport, jobs, and artifacts exist; all-lane lifecycle unification is unproven | Show shared foundations and distinct domain boundaries |
| Pattern offers four deployment providers | Codex is the only admitted deployment provider; other names retain historical meaning | Separate current configuration from history in docs and UI |
| Both Daily command files are accidental duplication | Frozen V1/V2 execution compatibility is deliberate | Document version ownership before extracting common preparation |
| Only twelve fragments are skipped | The real builder skips twelve §2 fragments and eight §8 fragments | Correct the builder's partial comments and any dependent documentation |
| Internal signing excludes every reader | The signing-client comment contradicts current internal-origin admission | Update the present-tense comment while preserving the historical decision |
| Internal activation serves nobody | The runbook's activation table contradicts its superseding decision and source | Replace its current-state table; retain dated older observations |
| August 27 is the latest recorded active-pointer read | A September 6 artifact records the same pointer and content hashes | Cite the newer record with its date and query scope |
| Every machine candidate reached regression | The ledger itself records earlier compilation/candidate, evaluation, and configuration failures | Classify failures individually; do not repeat the blanket header assertion |
| The internal path has no shared hard safety checks | Current Pattern publication applies shared document safety; it does not run the machine corpus's full regression process | Correct the runbook's outdated distinction |
| No hard-gate event proves content quality is not the blocker | Incomplete evaluation and missing events cannot certify quality | Retain planner closure as a dated diagnosis/hypothesis, then reproduce |
| Evaluator fields alone certify the offline release | The internal builder populates compatibility fields without an independent evaluation run | Explain origin and actual receipts together |
| Observability is absent | It was omitted from the map; health and logging configuration exist, tracing is disabled | Add runtime evidence and distinguish configuration from observation |
| The legacy stub layer is a structural priority | It is 60 lines and deliberately mounted after real routes | Keep a route-order regression; do not prioritize a rewrite |

Primary drift locations: [builder comments](../../apps/api/scripts/build-internal-ontology.ts), [signing-client comment](../../apps/api/src/services/ontology-signing-client.ts), and [rollout runbook](../deploy/openai-pattern-rollout.md). Check dependent [CLAUDE.md guidance](../../CLAUDE.md) for inherited explanations rather than assuming every supplied line reference is current.

Preserve the earlier evidence documents and their attribution. A corrected current-state summary should point to history, not silently rewrite what was observed then.

## 9. A practical sequence for the next planning round

The work should become several independently reviewable plans, not one application-wide refactor. Owner labels below are responsibilities to assign, not claims that another person has accepted them.

| Order / workstream | First bounded deliverable | Success condition | Responsible role / dependency |
| --- | --- | --- | --- |
| 0. Current-state alignment | Correct the documented supply/admission/gate distinctions; retain a dated evidence index and update map coverage | No current-state statement contradicts its source; historical observations remain dated | Repository owner; this report provides the initial evidence |
| 1. Reader journey | Prototype one supported Today → Pattern → timing → saved-reading → feedback path | Every edge has a reason and exact source edition; uncertainty and revoked/changed sources behave honestly; comprehension is tested | Product owner plus frontend/backend implementer; no machine rollout prerequisite |
| 2. Interpretation quality | Review the actual 40-record release and 60-fragment source register; build a small contrasting-chart evaluation panel | Recorded editorial adjudications, citation/contradiction checks, and specificity/usefulness results are separate from model agreement | Named editorial reviewer plus evaluation owner; can run alongside the journey prototype |
| 3. Visual compatibility/readiness | Decide how 3/4/5/6-chapter readings map into the observatory and show explicit optional-asset states | No valid reading is silently reshaped or blocked for graphics; source identity and fallback survive | Product/frontend owner; supported-count contract decision first |
| 4. Runner reliability | Reproduce mixed-work scheduling behavior with deterministic fake clients and inspect bounded status metrics | A proposed fairness policy demonstrates progress for all enabled work classes without violating budgets or leases | Runtime owner; measure before choosing concurrency |
| 5. Targeted maintainability | One shared Codex exchange helper across two adapters, then one behavior-preserving stage extraction | Request/job/artifact identity, error outcomes, replay, cancellation, and ownership tests remain equivalent | Backend owner; separate from provider/configuration changes |
| 6. Vocabulary migration | Inventory names across source, config, tools, artifacts, and calculation packaging; migrate one category | No broken deployment variables, evidence extraction, source-offer paths, or historical provenance | Repository/release owner; compatibility strategy before rename |
| 7. Release safeguards | Define a source-bound local receipt/preflight workflow and accountable release sign-off | Missing, failed, or mismatched local evidence blocks the supported release workflow; bypass limitations are explicit | Release owner; do not assume Actions will recover |
| Conditional: machine ontology | Reproduce planner behavior under current frozen pins and satisfy the selected path's quality, spend, and lifecycle requirements | Complete evidence chain and explicit activation authorization, without weakened fixtures or gates | Operator and evaluation owner; not required to prototype the reader journey |

This ordering prioritizes reader value and trustworthy interpretation while allowing bounded reliability work alongside them. Do not make all product progress wait for a universal backend abstraction or an automated ontology release.

### Decisions now answered sufficiently for scoped planning

- The inspected internal builder reproduces the recorded active ontology's content identity.
- Forty of sixty fragments become ontology records; both sign and cross-cutting omissions require accurate documentation.
- The internal-origin admission path is intentional and must not be removed as cleanup.
- Machine production is parked; its absence does not mean Pattern lacks ontology content.
- Shared Codex infrastructure, versioned commands, provenance, and privacy boundaries already exist.
- The first reader-journey prototype does not require a new machine-produced ontology or a broad refactor.

### Decisions or evidence still needed

- Appoint the editor and define the independent quality rubric; the register does not establish completed human certification.
- Select the first concrete reading/chapter relationship and how to represent its supporting evidence.
- Choose adaptive versus explicit-subset portrait behavior for non-four-chapter readings.
- Assign the operational responder, alert destination, and release sign-off responsibility.
- Before an operation, refresh the deployed pointer, release hashes, Worker/runner identities, migration state, and selected provider's budget/account evidence.
- Before another machine candidate, reproduce the alleged remaining planner defect on current pins and reconcile the historical gate labels with the actual account-wide lifecycle.

These are narrow decisions, not reasons to postpone documenting the architecture or preparing a bounded product specification.

## 10. Non-negotiable constraints

- Preserve complete readings, exact source identities, historical attribution, and frozen execution semantics.
- Do not rewrite saved prose or historical provider labels to make a new abstraction look uniform.
- No inference of a causal relationship from thematic similarity or reader agreement.
- No widening of personal context use without the existing consent/allowed-use rules and explicit user-facing consequences.
- Keep recall, invalidation, export, erasure, cancellation, and key handling effective across any new links or caches.
- Do not change attempt or spend ceilings, weaken semantic/safety validation, or reduce regression coverage simply to obtain a passing run.
- Do not claim human authorship, corpus certification, operational readiness, or current production status from names, signatures, configuration, or old observations alone.
- Keep the calculation service's existing licensing and source-offer boundary intact.
- Preserve unrelated working-tree changes. Separate documentation, implementation, commit/push, migration, deployment, and live verification authority.

## 11. Verification performed for this document

Performed locally on 2026-09-07:

- Verified the review/map commit ancestry and the current checkout revision.
- Rechecked the map's 86 recorded source-file hashes.
- Inspected current provider admission, shared job/artifact contracts, Daily version dispatch, ontology admission/signing, publication safety, feedback permissions, portrait chapter constraints, runner scheduling, and observability configuration.
- Read the dated production observation and failed-candidate ledger; did not query production.
- Ran the existing corpus-preparation and internal-ontology builder scripts under Node 22.23.2 with output in a newly created temporary directory outside the repository.
- Checked record counts and section coverage, source references, origin/schema/status, and both rebuilt hashes against the September 6 record.
- Validated all 59 local Markdown links, heading/table/fence structure, and whitespace.
- Compared before/after checkout state: HEAD and the pre-existing tracked diff remained unchanged; this report was the only new repository status entry.

Offline command results:

```text
PASS corpus_release_id=pattern-ontology-source-manual-en-us-0.1.0
corpus_hash=sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c
fragments=60
ok: 40 records, 20 fragments skipped (no predicate), locale en-US
recomputed_bundle_hash=sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84
bundle_matches_recorded=true
corpus_matches_recorded=true
```

The builder's raw output is an unsigned candidate with a placeholder bundle-hash field. Hash comparison used `computeOntologyBundleHash`, the same canonical computation used by the signing route. No signing or ingestion endpoint was invoked.

Not performed: provider generation, production queries or changes, new browser/device QA, a new editorial certification, application test suites, or `ci:local`. Documentation/link checks and the offline build are not a merge gate. Any later implementation or merge must satisfy the repository's actual verification requirements on its final source revision.

The next useful handoff is a bounded specification for the connected reader journey and a separately owned interpretation-quality evaluation, with this document serving as their shared evidence and constraint register.
