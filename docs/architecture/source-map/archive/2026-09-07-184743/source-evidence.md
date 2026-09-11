# Patternlike mind map source evidence

Source snapshot: branch main at 6e706741f03253f2807d33380afb529161f3481f, with pre-existing local observatory edits. Captured 2026-09-07T18:47:43.524Z; referenced file hashes rechecked 2026-09-07T18:56:19.975Z.

The map has 8 branches, 34 topics, and 68 detailed leaves. It was built from current entry points, route composition, service orchestration, client components, configuration, and verification scripts. Memory supplied investigation leads; current source determines the map's claims.

[Mind map Markdown](/home/henry/patternlike-app/output/mindmaps/2026-09-07-184743/patternlike-source-mindmap.md) can be edited or rendered again. [Source snapshot](/home/henry/patternlike-app/output/mindmaps/2026-09-07-184743/source-snapshot.json) records the 86 referenced file hashes and original checkout status. The commit alone does not reproduce the uncommitted portion.

This is a source representation. Deployment state, remote database migrations, installed runner state, end-to-end behavior, and test results were not verified. No application code, production settings, or existing user files were changed to create these artifacts.

## Interpretation decisions

- Current routing takes precedence over older documentation: GET /v1/pattern serves generated documents. The M4 catalogue is preserved for ingestion and export, and the candidate README's old reader description does not describe the current route.
- The calc-stub name is historical: server.ts invokes real Swiss Ephemeris calculation, cycle scans, and daily-sky computation.
- Legacy stubs are mounted after real routes. Their check-in, context-source, export, and deletion registrations do not mean those features are missing.
- Daily and new Pattern text use the Codex publisher. Retained OpenAI adapters and OPENAI_* variable names do not establish a current direct API generation path.
- The production configuration sets Daily to hybrid, Pattern generation to enabled, portraits and meshes to enabled, and Geoapify to enabled; ontology generation remains off. These are source settings, not proof that a deployed instance has those capabilities.
- Portraits require four source chapters and relevant grants. Generated images and compiled objects are bound to the original reading; the complete text reading is an implemented part of the interface.
- The observatory branch includes the working tree's uncommitted component, navigation, scene, and control changes. Rendered quality and behavior were not audited during map creation.
- Corpus origin, rights classification, review evidence, cryptographic signatures, and public activation are separate properties. None is represented as proving all the others.

## Source anchors

Every topic below maps to existing source files. All 103 anchors resolved, all 86 unique referenced files matched their earlier captured SHA-256 hashes, and the repository HEAD remained unchanged during this inspection.

## Reader experience

| Map topic | Current source anchors |
| --- | --- |
| Application and navigation | [apps/web/src/App.tsx:60](/home/henry/patternlike-app/apps/web/src/App.tsx:60); [apps/web/src/components/AppShell.tsx:6](/home/henry/patternlike-app/apps/web/src/components/AppShell.tsx:6) |
| Today and History | [apps/web/src/components/ReadingArticle.tsx:77](/home/henry/patternlike-app/apps/web/src/components/ReadingArticle.tsx:77); [apps/web/src/components/HistoryView.tsx:43](/home/henry/patternlike-app/apps/web/src/components/HistoryView.tsx:43) |
| Your Pattern | [apps/web/src/components/ChartView.tsx:54](/home/henry/patternlike-app/apps/web/src/components/ChartView.tsx:54); [apps/web/src/components/PatternExperience.tsx:258](/home/henry/patternlike-app/apps/web/src/components/PatternExperience.tsx:258) |
| Timing and Time travel | [apps/api/src/routes/timing.ts:127](/home/henry/patternlike-app/apps/api/src/routes/timing.ts:127); [apps/api/src/services/time-travel.ts:54](/home/henry/patternlike-app/apps/api/src/services/time-travel.ts:54); [apps/web/src/components/TimeTravelView.tsx:681](/home/henry/patternlike-app/apps/web/src/components/TimeTravelView.tsx:681) |

## Calculation authority

| Map topic | Current source anchors |
| --- | --- |
| Birth data and place resolution | [apps/api/src/routes/birth.ts:355](/home/henry/patternlike-app/apps/api/src/routes/birth.ts:355); [apps/api/src/services/geocoder/index.ts:9](/home/henry/patternlike-app/apps/api/src/services/geocoder/index.ts:9); [apps/web/src/components/Onboarding.tsx:1](/home/henry/patternlike-app/apps/web/src/components/Onboarding.tsx:1) |
| Time zones and uncertainty | [apps/api/src/services/timezone.ts:155](/home/henry/patternlike-app/apps/api/src/services/timezone.ts:155); [apps/calc-stub/src/engine.ts:476](/home/henry/patternlike-app/apps/calc-stub/src/engine.ts:476) |
| Swiss Ephemeris compute service | [apps/calc-stub/src/server.ts:95](/home/henry/patternlike-app/apps/calc-stub/src/server.ts:95); [apps/calc-stub/src/engine.ts:689](/home/henry/patternlike-app/apps/calc-stub/src/engine.ts:689) |
| Shared factual inputs | [apps/api/src/services/natal-features.ts:1](/home/henry/patternlike-app/apps/api/src/services/natal-features.ts:1); [apps/api/src/services/daily-sky-client.ts:1](/home/henry/patternlike-app/apps/api/src/services/daily-sky-client.ts:1); [apps/api/src/services/birth-operational-config.ts:1](/home/henry/patternlike-app/apps/api/src/services/birth-operational-config.ts:1) |

## Daily reading pipeline

| Map topic | Current source anchors |
| --- | --- |
| Reserve and schedule | [apps/api/src/routes/readings.ts:269](/home/henry/patternlike-app/apps/api/src/routes/readings.ts:269); [apps/api/src/services/ensure-today-reading.ts:107](/home/henry/patternlike-app/apps/api/src/services/ensure-today-reading.ts:107); [apps/api/src/services/run-reading-scheduler.ts:1](/home/henry/patternlike-app/apps/api/src/services/run-reading-scheduler.ts:1) |
| Compile permitted context | [apps/api/src/services/context-compiler.ts:82](/home/henry/patternlike-app/apps/api/src/services/context-compiler.ts:82); [packages/reading-engine/src/constrained-input.ts:1](/home/henry/patternlike-app/packages/reading-engine/src/constrained-input.ts:1); [apps/api/src/routes/stubs.ts:40](/home/henry/patternlike-app/apps/api/src/routes/stubs.ts:40) |
| Generate and validate | [apps/api/src/services/generate-daily-reading-v5.ts:723](/home/henry/patternlike-app/apps/api/src/services/generate-daily-reading-v5.ts:723); [packages/reading-engine/src/candidate-validation.ts:291](/home/henry/patternlike-app/packages/reading-engine/src/candidate-validation.ts:291); [packages/reading-engine/src/claim-support.ts:1](/home/henry/patternlike-app/packages/reading-engine/src/claim-support.ts:1) |
| Publication and historical compatibility | [apps/api/src/services/generate-daily-reading-v5.ts:842](/home/henry/patternlike-app/apps/api/src/services/generate-daily-reading-v5.ts:842); [apps/api/src/routes/readings.ts:521](/home/henry/patternlike-app/apps/api/src/routes/readings.ts:521); [apps/api/src/services/ensure-today-reading.ts:157](/home/henry/patternlike-app/apps/api/src/services/ensure-today-reading.ts:157) |

## Pattern generation and ontology

| Map topic | Current source anchors |
| --- | --- |
| Select chart evidence | [apps/api/src/services/pattern-execute.ts:10](/home/henry/patternlike-app/apps/api/src/services/pattern-execute.ts:10); [apps/api/src/services/pattern-command.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-command.ts:1); [packages/pattern-engine/src/selection.ts:1](/home/henry/patternlike-app/packages/pattern-engine/src/selection.ts:1) |
| Plan, write, and verify | [apps/api/src/services/pattern-execute.ts:11](/home/henry/patternlike-app/apps/api/src/services/pattern-execute.ts:11); [apps/api/src/services/pattern-publication-proof.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-publication-proof.ts:1); [apps/api/src/services/pattern-publication-safety.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-publication-safety.ts:1) |
| Read, regenerate, and erase | [apps/api/src/routes/pattern.ts:19](/home/henry/patternlike-app/apps/api/src/routes/pattern.ts:19); [apps/api/src/routes/pattern-ai.ts:82](/home/henry/patternlike-app/apps/api/src/routes/pattern-ai.ts:82); [apps/api/src/services/pattern-state.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-state.ts:1) |
| Ontology preparation pipeline | [apps/api/src/services/ontology-pipeline-execute.ts:3154](/home/henry/patternlike-app/apps/api/src/services/ontology-pipeline-execute.ts:3154); [apps/api/src/db/pattern-ontology.ts:1](/home/henry/patternlike-app/apps/api/src/db/pattern-ontology.ts:1); [apps/api/wrangler.toml:276](/home/henry/patternlike-app/apps/api/wrangler.toml:276) |
| Source provenance and rights | [pattern-corpus/README.md:1](/home/henry/patternlike-app/pattern-corpus/README.md:1); [pattern-corpus/validate-fragments.mjs:1](/home/henry/patternlike-app/pattern-corpus/validate-fragments.mjs:1); [apps/api/src/services/pattern-publication-safety.ts:189](/home/henry/patternlike-app/apps/api/src/services/pattern-publication-safety.ts:189) |

## Portrait and 3D observatory

| Map topic | Current source anchors |
| --- | --- |
| Images derived from chapters | [apps/api/src/services/pattern-portrait.ts:53](/home/henry/patternlike-app/apps/api/src/services/pattern-portrait.ts:53); [apps/api/src/services/pattern-portrait.ts:171](/home/henry/patternlike-app/apps/api/src/services/pattern-portrait.ts:171); [apps/codex-runner/src/portrait-invocation.ts:24](/home/henry/patternlike-app/apps/codex-runner/src/portrait-invocation.ts:24) |
| Compiled and inspected 3D objects | [apps/codex-runner/src/portrait-mesh-invocation.ts:71](/home/henry/patternlike-app/apps/codex-runner/src/portrait-mesh-invocation.ts:71); [apps/api/src/services/pattern-portrait-mesh.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-portrait-mesh.ts:1); [apps/web/src/components/AccountPortraitExplorer.tsx:133](/home/henry/patternlike-app/apps/web/src/components/AccountPortraitExplorer.tsx:133) |
| Interactive observatory including local edits | [apps/web/src/components/portrait-explorer/PortraitExplorer.tsx:18](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx:18); [apps/web/src/components/portrait-explorer/observatory-world.ts:13](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/observatory-world.ts:13); [apps/web/src/components/portrait-explorer/ObservatoryControls.tsx:3](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/ObservatoryControls.tsx:3) |
| Complete reading and graphics recovery | [apps/web/src/lib/pattern-portrait.ts:76](/home/henry/patternlike-app/apps/web/src/lib/pattern-portrait.ts:76); [apps/web/src/components/portrait-explorer/ExplorerReader.tsx:54](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/ExplorerReader.tsx:54); [apps/web/src/components/portrait-explorer/PortraitScene.tsx:685](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitScene.tsx:685); [apps/web/src/components/portrait-explorer/use-explorer-navigation.ts:1](/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/use-explorer-navigation.ts:1) |

## Runtime and generation services

| Map topic | Current source anchors |
| --- | --- |
| Worker, web assets, and PWA | [apps/api/src/index.ts:187](/home/henry/patternlike-app/apps/api/src/index.ts:187); [apps/api/wrangler.toml:559](/home/henry/patternlike-app/apps/api/wrangler.toml:559); [apps/web/public/sw.js:25](/home/henry/patternlike-app/apps/web/public/sw.js:25) |
| Durable work and maintenance | [apps/api/src/queue.ts:161](/home/henry/patternlike-app/apps/api/src/queue.ts:161); [apps/api/src/scheduled.ts:21](/home/henry/patternlike-app/apps/api/src/scheduled.ts:21); [apps/api/wrangler.toml:75](/home/henry/patternlike-app/apps/api/wrangler.toml:75) |
| Installed Codex runner | [apps/codex-runner/src/index.ts:21](/home/henry/patternlike-app/apps/codex-runner/src/index.ts:21); [apps/codex-runner/src/codex-cli.ts:42](/home/henry/patternlike-app/apps/codex-runner/src/codex-cli.ts:42); [apps/codex-runner/src/isolated-codex-json.ts:52](/home/henry/patternlike-app/apps/codex-runner/src/isolated-codex-json.ts:52); [apps/api/src/routes/codex-provider.ts:266](/home/henry/patternlike-app/apps/api/src/routes/codex-provider.ts:266) |
| Storage and isolated signing | [apps/api/wrangler.toml:18](/home/henry/patternlike-app/apps/api/wrangler.toml:18); [apps/api/wrangler.toml:42](/home/henry/patternlike-app/apps/api/wrangler.toml:42); [apps/ontology-signer/src/index.ts:68](/home/henry/patternlike-app/apps/ontology-signer/src/index.ts:68) |
| Committed production switches | [apps/api/wrangler.toml:312](/home/henry/patternlike-app/apps/api/wrangler.toml:312); [apps/api/src/services/reading-publisher.ts:50](/home/henry/patternlike-app/apps/api/src/services/reading-publisher.ts:50); [apps/api/src/services/pattern-execute.ts:123](/home/henry/patternlike-app/apps/api/src/services/pattern-execute.ts:123) |

## Identity and privacy

| Map topic | Current source anchors |
| --- | --- |
| Sessions and account state | [apps/api/src/routes/sessions.ts:84](/home/henry/patternlike-app/apps/api/src/routes/sessions.ts:84); [apps/api/src/middleware/auth.ts:106](/home/henry/patternlike-app/apps/api/src/middleware/auth.ts:106) |
| Explicit processing permissions | [apps/api/src/routes/account-processing-consents.ts:49](/home/henry/patternlike-app/apps/api/src/routes/account-processing-consents.ts:49); [apps/api/src/routes/consents.ts:95](/home/henry/patternlike-app/apps/api/src/routes/consents.ts:95); [apps/web/src/components/PrivacyView.tsx:724](/home/henry/patternlike-app/apps/web/src/components/PrivacyView.tsx:724); [apps/api/src/services/context-compiler.ts:11](/home/henry/patternlike-app/apps/api/src/services/context-compiler.ts:11) |
| Protected personal payloads | [apps/api/src/crypto.ts:2](/home/henry/patternlike-app/apps/api/src/crypto.ts:2); [apps/api/src/services/pattern-crypto.ts:1](/home/henry/patternlike-app/apps/api/src/services/pattern-crypto.ts:1); [apps/api/src/services/safe-log.ts:1](/home/henry/patternlike-app/apps/api/src/services/safe-log.ts:1); [apps/api/src/routes/readings.ts:46](/home/henry/patternlike-app/apps/api/src/routes/readings.ts:46) |
| Export, deletion, and key maintenance | [apps/api/src/routes/privacy.ts:87](/home/henry/patternlike-app/apps/api/src/routes/privacy.ts:87); [apps/api/src/services/account-deletion.ts:259](/home/henry/patternlike-app/apps/api/src/services/account-deletion.ts:259); [apps/api/src/routes/internal-crypto.ts:1](/home/henry/patternlike-app/apps/api/src/routes/internal-crypto.ts:1); [apps/api/src/db/crypto-write-fence.ts:1](/home/henry/patternlike-app/apps/api/src/db/crypto-write-fence.ts:1) |

## Contracts, content, and verification

| Map topic | Current source anchors |
| --- | --- |
| Schemas and ordered migrations | [contracts/validate_schemas.py:1](/home/henry/patternlike-app/contracts/validate_schemas.py:1); [db/d1/MIGRATIONS.json:1](/home/henry/patternlike-app/db/d1/MIGRATIONS.json:1); [packages/shared/src/index.ts:1](/home/henry/patternlike-app/packages/shared/src/index.ts:1) |
| Signed editorial release delivery | [apps/api/src/routes/content-releases.ts:29](/home/henry/patternlike-app/apps/api/src/routes/content-releases.ts:29); [apps/api/src/routes/pattern.ts:12](/home/henry/patternlike-app/apps/api/src/routes/pattern.ts:12); [apps/api/src/routes/stubs.ts:6](/home/henry/patternlike-app/apps/api/src/routes/stubs.ts:6); [scripts/pattern-release/build.test.mjs:1](/home/henry/patternlike-app/scripts/pattern-release/build.test.mjs:1) |
| Pure engines and licensing boundary | [packages/reading-engine/src/index.ts:13](/home/henry/patternlike-app/packages/reading-engine/src/index.ts:13); [packages/pattern-engine/src/index.ts:9](/home/henry/patternlike-app/packages/pattern-engine/src/index.ts:9); [apps/calc-stub/package.json:5](/home/henry/patternlike-app/apps/calc-stub/package.json:5); [packages/shared/package.json:5](/home/henry/patternlike-app/packages/shared/package.json:5) |
| Local verification and release gate | [package.json:20](/home/henry/patternlike-app/package.json:20); [scripts/ci-local.sh:113](/home/henry/patternlike-app/scripts/ci-local.sh:113); [AGENTS.md:31](/home/henry/patternlike-app/AGENTS.md:31) |

## Verification boundary

The mind map structure was checked for one root, eight main branches, correctly nested headings, substantive bullet lengths, and resolved source anchors. After writing, all 105 local links resolved, the 86 source hashes still matched, and the written Markdown exactly matched Mapify's input. Mapify reported successful rendering of the interactive map. Application tests and ci:local were not run because this task creates documentation and a plugin visualization, without changing application behavior or preparing a merge.
