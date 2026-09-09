# Patternlike source-map verification

**Review date:** September 8, 2026 (America/Chicago)  
**Repository:** henryperkins/patternlike-app  
**Branch and commit:** main @ `c98ecf0e141289f507cd16799ae37c133c344ce7`  
**Tree:** `d1c45a7769e10a4d0e471f27fc5ecdb6dfb13f91`  
**Commit date:** 2026-09-08 23:49:37 UTC  
**Input:** `patternlike-source-mindmap.with-anchors.md`  
**Input SHA-256:** `9ae4c67e2a809728e6321b02e1913c437620480846f9049cf39ee5ffdb2a6863`

## Verdict and scope

The inspected architecture broadly matches the map. One concrete implementation overstatement was found in signed editorial release delivery: declared scenario fixtures are not executed by that ingestion route. Other material changes concern evidence status, especially corpus certification, procedural CI, runtime configuration, and deployment adoption.

This was a targeted static-source audit across all eight map branches, supplemented by inspection of regression-test source and fresh GitHub check metadata. It was not a line-by-line certification of every assertion or source anchor. The complete test suites, live generation, physical-device graphics, and deployed account flows were not executed. Several source reads were bounded excerpts rather than complete modules. The section ledger below distinguishes support from incomplete tracing.

The uploaded outline contains **8 main branches, 34 sections, 70 claim bullets, and 108 anchor occurrences across 86 distinct paths**. These are mechanical counts of the input, not verification coverage percentages. All 34 sections are accounted for below; no blanket pass is assigned to all 108 source anchors.

The repository's main branch was rechecked at the end of source review and still pointed at this commit. Repository and rendered mind map were not modified.

## Findings

### 1. Correct the editorial-fixture execution claim

The map's first bullet under “Signed editorial release delivery” says ingestion runs declared checks before activation. The implementation performs built-in signature, graph-integrity and object-hash checks, but `pendingFixtureIds` returns the IDs of every declared scenario fixture. Such bundles are held rather than evaluated. The route stores a pending release and does not move the active pointer when fixtures remain.

Evidence: [apps/api/src/routes/content-releases.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/content-releases.ts#L244-L445) and the `pendingFixtureIds` implementation in [apps/api/src/services/content-release.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/content-release.ts). A corresponding test explicitly expects the fixture IDs that this milestone cannot evaluate in [apps/api/src/services/content-release.test.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/content-release.test.ts).

**Replacement wording:**

> Internal content ingestion verifies signed WordPress bundles, validates their content graph and object hashes, and stores immutable artifacts. Releases with declared scenario fixtures remain accepted_pending_tests; this route does not execute those fixtures or activate those releases. Fixture-free releases can activate when requested and otherwise eligible.

This correction concerns editorial bundle fixtures, not the separate ontology pipeline's evaluation/regression stages.

### 2. Expose incomplete corpus evidence explicitly

The original map correctly distinguishes source-supported material from independent authorship. Its generic reference to reviewer evidence should nevertheless be replaced or expanded with the actual evidence status.

The committed provenance records 60 model-generated fragments; historical provider, model, model version, account context, and generation time remain unverified. It records zero certified fragments at inventory time, incomplete human review, unverified account-terms/counsel review, and unverified public activation. The committed reviewer registry is empty. This does not establish that nobody has ever read the corpus, nor does it rule out evidence outside the repository.

Evidence: [pattern-corpus/provenance.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/provenance.json#L1-L65), [pattern-corpus/reviewers.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/reviewers.json#L1-L4), and [pattern-corpus/README.md](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/README.md#L1-L128).

**Suggested node:**

> Corpus integrity and attributable-review tooling are implemented. Committed provenance remains incomplete: 60 model-generated fragments, unknown historical generation details, no certified fragments in the original inventory, and no enrolled reviewers in the committed registry. Hash/signature consistency is not completed human review or public-activation approval.

### 3. Label ci:local as a procedural policy

The script implements the documented contract checks, dependency/ephemeris setup, type checks, workspace tests, build, and extra Pattern-engine/runner/content lanes. However, main is not protected and the repository/inherited ruleset query returned an empty result. A required team policy is not a mechanically enforced merge condition.

Evidence: [scripts/ci-local.sh](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/scripts/ci-local.sh#L106-L173), [AGENTS.md](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/AGENTS.md#L31-L49), [branch metadata](https://api.github.com/repos/henryperkins/patternlike-app/branches/main), and [rulesets](https://api.github.com/repos/henryperkins/patternlike-app/rulesets?includes_parents=true).

**Replacement wording:**

> ci:local is the documented procedural merge gate. main is unprotected and has no returned repository/inherited rulesets. Local results must be captured against the reviewed source. Cloudflare builds run independently of GitHub Actions, and a triggered build does not establish successful production adoption.

### 4. Keep source configuration separate from operational state

The map already uses the careful heading “Committed production switches.” The checked values agree: hybrid Daily preparation; enabled Pattern, portrait, mesh, and Geoapify flags; Codex text generation pinned to gpt-5.6-sol with xhigh reasoning; automated ontology rollout off. Those settings are not observations of deployed secrets, runner availability, active ontology, migrated storage, granted consent, or production release identity.

Evidence: [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L312-L334) and [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L380-L535). Geocoder availability, for example, requires both the flag and a nonempty key in [apps/api/src/services/geocoder/index.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/geocoder/index.ts#L1-L12).

“Installed Codex runner” should become “Codex runner implementation and host dependency” unless a separate installation/liveness record is attached. This audit did not observe the host.

### 5. Add the runner's serial-priority dependency

The poll loop awaits a text job first, checks portrait jobs only if the text lane is empty, and checks meshes only if preceding lanes are empty. A processed job immediately restarts the loop.

Evidence: [apps/codex-runner/src/runner.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/codex-runner/src/runner.ts#L223-L271).

**Inference, not an observed incident:** sustained higher-priority work can delay or starve lower-priority lanes on an individual process. Separate logical job types do not imply fair or parallel execution. The map should expose this dependency; no runtime queue-age or load evidence was retrieved.

### 6. Make the licensing boundary's unresolved status visible

The map is correct that the calculation service declares AGPL-3.0-or-later. Its wording about a documented shared-package boundary should not suggest that decision is closed: shared explicitly declares UNLICENSED pending that decision.

Evidence: [apps/calc-stub/package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/calc-stub/package.json#L1-L7) and [packages/shared/package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/shared/package.json#L1-L7). This is a report of repository declarations, not an independent legal-compliance opinion.

## Test and deployment evidence

| Evidence | What was observed | What it establishes |
|---|---|---|
| Local test account in commit message | Reports ci:local, 732 web tests, and 284 Chromium fixture checks, with an asserted exact-source manifest check | Author-reported evidence; not independently rerun here |
| GitHub ci run 34292380620 | Completed, failure; contracts and monorepo jobs failed with no steps returned by the jobs tool | No hosted passing-test evidence from that run |
| Workers Builds: patternlike-api-production | Failure for this exact SHA; build 52bd9c43-f860-4a3d-838e-4fe2f046d4be | The retrieved production build did not succeed; root cause was not available |
| Fly.io | Success check for this SHA, linked to the calculation-service deployment | A successful Fly integration check; not verification of the web/API or full product |
| Inspected regression tests | Daily fact-support rejection cases; account observatory default/missing-artwork/state-retention cases; editorial fixture expectation | Test cases exist in source; not a fresh passing execution |

Sources: [commit](https://github.com/henryperkins/patternlike-app/commit/c98ecf0e141289f507cd16799ae37c133c344ce7), [GitHub workflow](https://github.com/henryperkins/patternlike-app/actions/runs/34292380620), and [check-run collection for the pinned SHA](https://api.github.com/repos/henryperkins/patternlike-app/commits/c98ecf0e141289f507cd16799ae37c133c344ce7/check-runs?per_page=30).

AGENTS.md attributes the GitHub Actions problem to a billing lock. The fresh failed jobs did not expose their failure annotation through the available read path, so the current failure cause is not independently reconfirmed here. The separate Cloudflare failure must not automatically be attributed to that billing issue.

A failed build does not prove the previously deployed application is down, identify the currently serving revision, or rule out a manual deployment. No production-health claim is made.

The account-observatory tests mock the PortraitExplorer renderer and API transport. Their assertions support UI wiring and state behavior, not physical-device WebGL correctness. The Daily tests exercise deterministic relationship/citation validation; passing such checks would still not establish unrestricted semantic correctness of all generated prose. The Pattern safety implementation explicitly makes that distinction.

Test/safety sources: [apps/web/src/components/AccountPortraitExplorer.test.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/AccountPortraitExplorer.test.tsx#L1-L185), [packages/reading-engine/src/candidate-validation.test.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/reading-engine/src/candidate-validation.test.ts#L291-L409), and [apps/api/src/services/pattern-publication-safety.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-publication-safety.ts#L277-L340).

## Section-by-section evidence ledger

**Supported core behavior** means the central statement has direct inspected implementation evidence, with the remaining limits described. **Partial** means the section includes material subclaims not independently traced. Neither label means freshly tested or deployed.

### Reader experience

**1. Application and navigation — Partial.** The six view IDs and account-recovery states are present. The complete onboarding UI was not traced.

Evidence: [apps/web/src/App.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/App.tsx#L1-L215).

**2. Today and History — Partial.** The shared article explicitly switches between Today check-in and History feedback, renders dates, saving, and evidence. History listing/query behavior was not independently traced end to end.

Evidence: [apps/web/src/components/ReadingArticle.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/ReadingArticle.tsx#L55-L180).

**3. Your Pattern — Supported core behavior.** ChartView places PatternExperience before the chart and displays uncertainty and normalized facts. CompleteReading retains chapter facets, signatures, and uncertainty; not every PatternExperience state was inspected.

Evidence: [apps/web/src/components/ChartView.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/ChartView.tsx#L54-L190); [apps/web/src/components/portrait-explorer/ExplorerReader.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/portrait-explorer/ExplorerReader.tsx#L101-L118).

**4. Timing and Time travel — Partial.** Inspected selected/current date comparison, cycle ranking, owner-scoped chart inputs, and receipt identity. Timing filter UI and the complete scan/budget execution path were not independently traced.

Evidence: [apps/api/src/services/time-travel.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/time-travel.ts#L1-L245).

### Calculation authority

**5. Birth data and place resolution — Partial.** Inspected owner-scoped idempotency, exact consent checks, stale Pattern reconciliation, and Geoapify selection. Manual-entry UI and the full correction transaction need additional tracing.

Evidence: [apps/api/src/routes/birth.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/birth.ts#L355-L505); [apps/api/src/services/geocoder/index.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/geocoder/index.ts#L1-L15).

**6. Time zones and uncertainty — Supported in inspected source.** Coordinates override hints when available; hint/UTC fallbacks and historical civil-time qualifications are explicit. Exact, approximate, and unknown-time treatment is implemented.

Evidence: [apps/api/src/services/timezone.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/timezone.ts#L142-L271); [apps/calc-stub/src/engine.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/calc-stub/src/engine.ts#L460-L510).

**7. Swiss Ephemeris compute service — Supported core behavior.** The engine really calls sweph and refuses a silent ephemeris fallback. Chart and cycle service authentication were inspected. The daily-sky HTTP handler was not independently read in this audit.

Evidence: [apps/calc-stub/src/engine.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/calc-stub/src/engine.ts#L512-L548); [apps/calc-stub/src/server.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/calc-stub/src/server.ts#L95-L190).

**8. Shared factual inputs — Partial.** Daily validation consumes distinct natal, cycle, and daily-sky facts; the birth timeout/budget configuration is bounded. Natal extraction, daily-sky client, and actual birth-budget reservation were not fully traced.

Evidence: [packages/reading-engine/src/candidate-validation.test.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/reading-engine/src/candidate-validation.test.ts#L1-L170); [apps/api/src/services/birth-operational-config.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/birth-operational-config.ts#L1-L84).

### Daily reading pipeline

**9. Reserve and schedule — Supported core behavior.** The product PUT route explicitly chooses V5 and first-open admission. ensureTodayReading checks confirmed preferences, published state, durable reservations, and lease-based dispatch. The complete scheduler was not read.

Evidence: [apps/api/src/routes/readings.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/readings.ts#L238-L310); [apps/api/src/services/ensure-today-reading.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/ensure-today-reading.ts#L100-L225).

**10. Compile permitted context — Partial.** Owner-scoped loading and USR-12 feedback uses are explicit. Eligibility is deliberately delegated to prepareConstrainedReadingInput; its complete policy implementation was not independently traced.

Evidence: [apps/api/src/services/context-compiler.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/context-compiler.ts#L1-L260).

**11. Generate and validate — Supported in inspected source.** Output-shape and citation-specific candidate validation precede encryption and claim-bound publication. Inspected regression tests reject swapped placements, irrelevant citations, borrowed facts, and related factual errors. Test source was read, not executed.

Evidence: [apps/api/src/services/generate-daily-reading-v5.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/generate-daily-reading-v5.ts#L670-L911); [packages/reading-engine/src/candidate-validation.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/reading-engine/src/candidate-validation.ts#L291-L475); [packages/reading-engine/src/candidate-validation.test.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/reading-engine/src/candidate-validation.test.ts#L291-L409).

**12. Publication and historical compatibility — Supported core behavior.** Publication retains evidence/provenance and returns fallbackUsed false. The V5 product path refuses to advance historical deterministic reservations while allowing already-published readings. Individual history/save/evidence endpoints were not all traced.

Evidence: [apps/api/src/services/generate-daily-reading-v5.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/generate-daily-reading-v5.ts#L723-L911); [apps/api/src/services/ensure-today-reading.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/ensure-today-reading.ts#L146-L179).

### Pattern generation and ontology

**13. Select chart evidence — Partial.** The executor is wired to deterministic selection, versioned ontology, natal features, commands, and publisher pins. The complete selection algorithm and command constructor were not independently audited.

Evidence: [apps/api/src/services/pattern-execute.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-execute.ts#L1-L137); [apps/api/src/services/pattern-publication-proof.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-publication-proof.ts#L103-L247).

**14. Plan, write, and verify — Supported core behavior.** Inspected pass-specific publisher/provenance handling and publication proof: stored artifacts, coordinates, hashes, semantic verdict, and deterministic publication safety are checked. This is not a proof that all prose is semantically correct or a trace of every retry branch.

Evidence: [apps/api/src/services/pattern-execute.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-execute.ts#L139-L225); [apps/api/src/services/pattern-publication-proof.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-publication-proof.ts#L103-L275); [apps/api/src/services/pattern-publication-safety.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-publication-safety.ts#L277-L340).

**15. Read, regenerate, and erase — Partial.** GET /v1/pattern delegates to the generated reader, not the old editorial catalogue. All regeneration, cancellation, and erasure transitions were not independently traversed.

Evidence: [apps/api/src/routes/pattern.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/pattern.ts#L1-L27).

**16. Ontology preparation pipeline — Supported in inspected source.** The executor has corpus/generate/compile/evaluate/regress/sign/ingest stages. The committed production rollout is off; public activation is separately derived from evidence and receipt agreement.

Evidence: [apps/api/src/services/ontology-pipeline-execute.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/ontology-pipeline-execute.ts#L3120-L3215); [apps/api/src/db/pattern-ontology.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/db/pattern-ontology.ts#L21-L216); [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L468-L496).

**17. Source provenance and rights — Needs explicit evidence status.** The map preserves the authorship distinction, but should expose actual gaps: 60 model-generated fragments, unknown historical generation fields, zero certifications at inventory, an empty reviewer registry, and unverified public activation evidence.

Evidence: [pattern-corpus/provenance.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/provenance.json#L1-L65); [pattern-corpus/reviewers.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/reviewers.json#L1-L4); [pattern-corpus/README.md](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/pattern-corpus/README.md#L1-L128).

### Portrait and 3D observatory

**18. Images derived from chapters — Supported core behavior.** Four-chapter eligibility and complete per-chapter serialized source text are explicit, with chart/document/consent/hash bindings. The native image invocation itself was not independently traced.

Evidence: [apps/api/src/services/pattern-portrait.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-portrait.ts#L47-L169).

**19. Compiled and inspected 3D objects — Supported in inspected source.** The isolated author returns a constrained program; a trusted compiler creates GLB; another invocation judges four rendered views. The browser validates model/source/provenance bindings before using assets. Not all Worker mesh lifecycle code was read.

Evidence: [apps/codex-runner/src/portrait-mesh-invocation.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/codex-runner/src/portrait-mesh-invocation.ts#L1-L115); [apps/web/src/components/AccountPortraitExplorer.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/AccountPortraitExplorer.tsx#L24-L183).

**20. Interactive observatory — Supported core behavior.** Default opening for matching three-to-six-chapter documents is independent of four-chapter artwork eligibility. Navigation, perspective, passage, desk and camera state are present. Complete geometry/rendering and all controls were not inspected.

Evidence: [apps/web/src/components/AccountPortraitExplorer.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/AccountPortraitExplorer.tsx#L49-L106); [apps/web/src/components/portrait-explorer/PortraitExplorer.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L120-L255).

**21. Complete reading and graphics recovery — Supported core behavior.** The full reader keeps uncertainty, all facets, and signatures; artwork absence does not gate the default reader. Session/camera state and URL cleanup are implemented. Actual WebGL context-loss, physical-device recovery, and low-power behavior were not exercised.

Evidence: [apps/web/src/components/portrait-explorer/ExplorerReader.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/portrait-explorer/ExplorerReader.tsx#L101-L118); [apps/web/src/components/AccountPortraitExplorer.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/AccountPortraitExplorer.tsx#L49-L183); [apps/web/src/components/AccountPortraitExplorer.test.tsx](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/src/components/AccountPortraitExplorer.test.tsx#L1-L185).

### Runtime and generation services

**22. Worker, web assets, and PWA — Supported in inspected source.** The Worker exports fetch/queue/scheduled; production bundles same-origin web assets and prioritizes explicit API/control paths. The service worker bypasses /v1/ requests.

Evidence: [apps/api/src/index.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/index.ts#L180-L190); [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L536-L564); [apps/web/public/sw.js](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/web/public/sw.js#L1-L46).

**23. Durable work and maintenance — Supported core behavior.** Queue dispatch, claim/pause/retry handling, and separate maintenance paths are present. Config guards also apply outside Hono. Not a concurrency or load test of every job transition.

Evidence: [apps/api/src/queue.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/queue.ts#L161-L325); [apps/api/src/scheduled.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/scheduled.ts#L1-L137).

**24. Installed Codex runner — Needs evidence label and dependency note.** The polling implementation exists; installation/authentication/liveness on a host was not observed. Per-process dispatch is serial, text first, then portraits, then meshes; sustained higher-priority work can delay lower lanes.

Evidence: [apps/codex-runner/src/runner.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/codex-runner/src/runner.ts#L223-L271); [apps/codex-runner/src/portrait-mesh-invocation.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/codex-runner/src/portrait-mesh-invocation.ts#L1-L115).

**25. Storage and isolated signing — Partial.** D1/R2 configuration, replay-ledger calls in deletion, and the separate signer key binding were inspected. The full replay recovery and signer service-binding deployment were not independently verified.

Evidence: [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L566-L580); [apps/api/src/services/account-deletion.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/account-deletion.ts#L288-L332); [apps/ontology-signer/src/index.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/ontology-signer/src/index.ts#L1-L195).

**26. Committed production switches — Supported as configuration only.** The source contains hybrid Daily, enabled Pattern/portrait/mesh/geocoder settings, Codex gpt-5.6-sol/xhigh pins, and ontology rollout off. Configuration does not prove deployed secrets, runner health, compatible migrations, or current production adoption.

Evidence: [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L312-L334); [apps/api/wrangler.toml](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/wrangler.toml#L380-L535).

### Identity and privacy

**27. Sessions and account state — Supported in inspected source.** OIDC exchange creates a secure HttpOnly SameSite Strict Worker cookie; the opaque session and account-state gates are implemented. Frozen accounts are restricted to the recovery allowlist.

Evidence: [apps/api/src/routes/sessions.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/sessions.ts#L56-L115); [apps/api/src/middleware/auth.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/middleware/auth.ts#L39-L153).

**28. Explicit processing permissions — Partial.** Inspected exact account/Pattern consent guards and context-source grants. The complete set of consent routes and privacy UI was not traced. Portrait-specific authorization/automation deserves its own node rather than an implied exhaustive four-policy inventory.

Evidence: [apps/api/src/services/pattern-portrait.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-portrait.ts#L85-L169); [apps/api/src/services/context-compiler.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/context-compiler.ts#L82-L211); [apps/api/src/middleware/auth.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/middleware/auth.ts#L106-L153).

**29. Protected personal payloads — Supported core behavior.** AES-256-GCM, random per-user keys, contextual AAD, and owner-scoped loading are present. This is not a comprehensive encryption-coverage, logging, or security certification.

Evidence: [apps/api/src/crypto.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/crypto.ts#L1-L165); [apps/api/src/services/context-compiler.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/context-compiler.ts#L82-L260); [apps/api/src/services/generate-daily-reading-v5.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/generate-daily-reading-v5.ts#L815-L911).

**30. Export, deletion, and key maintenance — Supported core behavior.** Exports reserve queued work and owner-scope status/download; deletion is checkpointed through exports, objects, rows, and keys. The complete crypto-operator routes/write-fence implementation was not independently reviewed.

Evidence: [apps/api/src/routes/privacy.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/privacy.ts#L87-L240); [apps/api/src/services/account-deletion.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/account-deletion.ts#L259-L354).

### Contracts, content, and verification

**31. Schemas and ordered migrations — Partial.** Repository scripts invoke schema/OpenAPI/D1 checks and the documented structure separates contracts and migrations. Individual schema files and the full ordered migration manifest were not inspected or executed.

Evidence: [package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/package.json#L10-L29); [AGENTS.md](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/AGENTS.md#L3-L25).

**32. Signed editorial release delivery — Correction required.** Built-in signature, content-graph, and object-hash checks run. Declared scenario fixtures are not executed by this ingestion route: their releases are held accepted_pending_tests with the active pointer unchanged. The generated Pattern route does not use the legacy catalogue.

Evidence: [apps/api/src/routes/content-releases.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/content-releases.ts#L244-L445); [apps/api/src/services/content-release.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/content-release.ts); [apps/api/src/routes/pattern.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/routes/pattern.ts#L8-L26).

**33. Pure engines and licensing boundary — Partial; licensing status qualified.** The calculation package declares AGPL-3.0-or-later; shared explicitly remains UNLICENSED pending the boundary decision. Deterministic engine use is visible, but a complete no-I/O purity audit and source-offer/legal compliance review were not performed.

Evidence: [apps/calc-stub/package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/calc-stub/package.json#L1-L30); [packages/shared/package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/packages/shared/package.json#L1-L24); [apps/api/src/services/pattern-execute.ts](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/apps/api/src/services/pattern-execute.ts#L1-L13).

**34. Local verification and release gate — Procedural gate, not enforced or freshly passed.** ci:local implements the documented lanes. main is unprotected and the ruleset query returned none. Commit-authored test results were not independently rerun; GitHub and deployment checks are reported separately below.

Evidence: [scripts/ci-local.sh](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/scripts/ci-local.sh#L106-L173); [AGENTS.md](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/AGENTS.md#L31-L49); [package.json](https://github.com/henryperkins/patternlike-app/blob/c98ecf0e141289f507cd16799ae37c133c344ce7/package.json#L10-L20).

## Actions for the map

Correct the editorial-fixture statement first. Add the commit SHA and the scope label “targeted source review; not runtime or deployment certification.” Record corpus evidence gaps and the procedural nature of ci:local. Preserve the existing distinction between three-to-six chapter observatory rendering and four-chapter generated artwork. Add the serial runner-priority dependency and distinguish declared licensing from a resolved boundary decision.

A subsequent exhaustive verification would need to trace the subclaims marked Partial, validate each anchor against this exact source snapshot, run the relevant suites, and attach separate deployment/release-identity and runtime evidence. This review does not silently grant those missing proofs.
