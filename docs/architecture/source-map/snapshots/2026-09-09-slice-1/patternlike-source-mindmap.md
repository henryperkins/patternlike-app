# Patternlike application

Scope: referenced files and map inputs only. This is not repository, release, editorial, or production certification. See [capture context and complete file identities](source-snapshot.json).

## Reader experience

### Application and navigation

<a id="claim-leaf-application-and-navigation-1"></a>
- App\.tsx and AppShell\.tsx connect six authenticated views: Today, History, Your Pattern, Timing, Time travel, and Privacy\. [evidence-apps-web-app-tsx](source-evidence.md#evidence-evidence-apps-web-app-tsx) [evidence-apps-web-components-appshell-tsx](source-evidence.md#evidence-evidence-apps-web-components-appshell-tsx)

<a id="claim-leaf-application-and-navigation-2"></a>
- Onboarding collects birth details and calculation consent; account recovery, sign out, and deletion status have dedicated interface states\. [evidence-apps-web-app-tsx](source-evidence.md#evidence-evidence-apps-web-app-tsx) [evidence-apps-web-components-appshell-tsx](source-evidence.md#evidence-evidence-apps-web-components-appshell-tsx) [evidence-onboarding-form](source-evidence.md#evidence-evidence-onboarding-form) [evidence-deletion-status-view](source-evidence.md#evidence-evidence-deletion-status-view) [evidence-app-sign-out](source-evidence.md#evidence-evidence-app-sign-out)

### Today and History

<a id="claim-leaf-today-and-history-1"></a>
- Today presents the current local day's reading, reflection, evidence explanation, saving, and an optional personal check\-in\. [evidence-apps-web-components-readingarticle-tsx](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx) [evidence-apps-web-components-readingarticle-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx-2) [evidence-apps-web-components-historyview-tsx](source-evidence.md#evidence-evidence-apps-web-components-historyview-tsx) [evidence-today-view](source-evidence.md#evidence-evidence-today-view)

<a id="claim-leaf-today-and-history-2"></a>
- History provides chronological and saved reading lists, reopening published reading documents with their own dates and preserved evidence\. [evidence-apps-web-components-readingarticle-tsx](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx) [evidence-apps-web-components-readingarticle-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx-2) [evidence-apps-web-components-historyview-tsx](source-evidence.md#evidence-evidence-apps-web-components-historyview-tsx)

<a id="claim-leaf-today-and-history-3"></a>
- One shared article serves both surfaces, and the check\-in and the structured feedback control are the two arms of a single switch, so feedback is offered on a reopened History reading rather than on Today\. [evidence-apps-web-components-readingarticle-tsx](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx) [evidence-apps-web-components-readingarticle-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-readingarticle-tsx-2) [evidence-apps-web-components-historyview-tsx](source-evidence.md#evidence-evidence-apps-web-components-historyview-tsx) [evidence-history-feedback-switch](source-evidence.md#evidence-evidence-history-feedback-switch) [evidence-today-check-in-switch](source-evidence.md#evidence-evidence-today-check-in-switch)

### Your Pattern

<a id="claim-leaf-your-pattern-1"></a>
- ChartView leads with the generated Pattern reading and follows it with normalized chart positions, aspects, houses, uncertainty, and calculation provenance\. [evidence-apps-web-components-chartview-tsx](source-evidence.md#evidence-evidence-apps-web-components-chartview-tsx) [evidence-apps-web-components-chartview-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-chartview-tsx-2) [evidence-apps-web-components-patternexperience-tsx](source-evidence.md#evidence-evidence-apps-web-components-patternexperience-tsx)

<a id="claim-leaf-your-pattern-2"></a>
- PatternExperience preserves chapter summaries, sections, tensions, resources, alternative expressions, additional signatures, and uncertainty alongside portrait entry points\. [evidence-apps-web-components-chartview-tsx](source-evidence.md#evidence-evidence-apps-web-components-chartview-tsx) [evidence-apps-web-components-chartview-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-chartview-tsx-2) [evidence-apps-web-components-patternexperience-tsx](source-evidence.md#evidence-evidence-apps-web-components-patternexperience-tsx)

### Timing and Time travel

<a id="claim-leaf-timing-and-time-travel-1"></a>
- Timing displays calculated transit cycles with phase and duration filters; Time travel explores a selected date and personal life events\. [evidence-apps-api-routes-timing-ts](source-evidence.md#evidence-evidence-apps-api-routes-timing-ts) [evidence-apps-api-services-time-travel-ts](source-evidence.md#evidence-evidence-apps-api-services-time-travel-ts) [evidence-apps-web-components-timetravelview-tsx](source-evidence.md#evidence-evidence-apps-web-components-timetravelview-tsx)

<a id="claim-leaf-timing-and-time-travel-2"></a>
- Time travel uses bounded calculation scans, cached receipts, scheduling time zones, and uncertainty rules to assemble dated results\. [evidence-apps-api-routes-timing-ts](source-evidence.md#evidence-evidence-apps-api-routes-timing-ts) [evidence-apps-api-services-time-travel-ts](source-evidence.md#evidence-evidence-apps-api-services-time-travel-ts) [evidence-apps-web-components-timetravelview-tsx](source-evidence.md#evidence-evidence-apps-web-components-timetravelview-tsx)

## Calculation authority

### Birth data and place resolution

<a id="claim-leaf-birth-data-and-place-resolution-1"></a>
- Birth submission validates accuracy, consent, coordinates, and idempotency before invoking calculation; correction updates the chart and invalidates dependent readings\. [evidence-apps-api-routes-birth-ts](source-evidence.md#evidence-evidence-apps-api-routes-birth-ts) [evidence-apps-api-services-geocoder-index-ts](source-evidence.md#evidence-evidence-apps-api-services-geocoder-index-ts) [evidence-apps-web-components-onboarding-tsx](source-evidence.md#evidence-evidence-apps-web-components-onboarding-tsx)

<a id="claim-leaf-birth-data-and-place-resolution-2"></a>
- Geoapify supplies consented place search and resolution through the Worker; manual birthplace coordinates and time zone remain available\. [evidence-apps-api-routes-birth-ts](source-evidence.md#evidence-evidence-apps-api-routes-birth-ts) [evidence-apps-api-services-geocoder-index-ts](source-evidence.md#evidence-evidence-apps-api-services-geocoder-index-ts) [evidence-apps-web-components-onboarding-tsx](source-evidence.md#evidence-evidence-apps-web-components-onboarding-tsx) [evidence-place-search-route](source-evidence.md#evidence-evidence-place-search-route)

### Time zones and uncertainty

<a id="claim-leaf-time-zones-and-uncertainty-1"></a>
- Coordinate lookup establishes the birthplace time zone, while historical time resolution and recorded qualifiers preserve normalization assumptions\. [evidence-apps-api-services-timezone-ts](source-evidence.md#evidence-evidence-apps-api-services-timezone-ts) [evidence-apps-calc-stub-engine-ts](source-evidence.md#evidence-evidence-apps-calc-stub-engine-ts)

<a id="claim-leaf-time-zones-and-uncertainty-2"></a>
- Exact, approximate, and unknown birth times change which houses, angles, Moon claims, and other sensitive features may appear\. [evidence-apps-api-services-timezone-ts](source-evidence.md#evidence-evidence-apps-api-services-timezone-ts) [evidence-apps-calc-stub-engine-ts](source-evidence.md#evidence-evidence-apps-calc-stub-engine-ts)

### Swiss Ephemeris compute service

<a id="claim-leaf-swiss-ephemeris-compute-service-1"></a>
- Despite its calc\-stub directory name, this Node service invokes Swiss Ephemeris through sweph for real chart calculations\. [evidence-apps-calc-stub-server-ts](source-evidence.md#evidence-evidence-apps-calc-stub-server-ts) [evidence-apps-calc-stub-engine-ts-2](source-evidence.md#evidence-evidence-apps-calc-stub-engine-ts-2)

<a id="claim-leaf-swiss-ephemeris-compute-service-2"></a>
- The authenticated service exposes chart, cycle, and daily\-sky computation; normalized output includes tropical positions, aspects, calculation identity, and uncertainty\. [evidence-apps-calc-stub-server-ts](source-evidence.md#evidence-evidence-apps-calc-stub-server-ts) [evidence-apps-calc-stub-engine-ts-2](source-evidence.md#evidence-evidence-apps-calc-stub-engine-ts-2)

### Shared factual inputs

<a id="claim-leaf-shared-factual-inputs-1"></a>
- Natal features support Pattern selection; transit cycles supply timing and Daily inputs; daily\-sky facts provide another distinct reading input\. [evidence-apps-api-services-natal-features-ts](source-evidence.md#evidence-evidence-apps-api-services-natal-features-ts) [evidence-apps-api-services-daily-sky-client-ts](source-evidence.md#evidence-evidence-apps-api-services-daily-sky-client-ts) [evidence-apps-api-services-birth-operational-config-ts](source-evidence.md#evidence-evidence-apps-api-services-birth-operational-config-ts)

<a id="claim-leaf-shared-factual-inputs-2"></a>
- The Worker bounds birth calculation with a timeout and daily invocation budget, and persists calculation provenance with chart snapshots\. [evidence-apps-api-services-natal-features-ts](source-evidence.md#evidence-evidence-apps-api-services-natal-features-ts) [evidence-apps-api-services-daily-sky-client-ts](source-evidence.md#evidence-evidence-apps-api-services-daily-sky-client-ts) [evidence-apps-api-services-birth-operational-config-ts](source-evidence.md#evidence-evidence-apps-api-services-birth-operational-config-ts) [evidence-bounded-calc-client](source-evidence.md#evidence-evidence-bounded-calc-client) [evidence-birth-budget-exhaustion](source-evidence.md#evidence-evidence-birth-budget-exhaustion)

## Daily reading pipeline

### Reserve and schedule

<a id="claim-leaf-reserve-and-schedule-1"></a>
- The current Today creation route explicitly requests constrained\-model V5 generation for the user's confirmed local date and preferences\. [evidence-apps-api-routes-readings-ts](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts) [evidence-apps-api-services-ensure-today-reading-ts](source-evidence.md#evidence-evidence-apps-api-services-ensure-today-reading-ts) [evidence-apps-api-services-run-reading-scheduler-ts](source-evidence.md#evidence-evidence-apps-api-services-run-reading-scheduler-ts)

<a id="claim-leaf-reserve-and-schedule-2"></a>
- First opening and scheduled preparation converge through durable reservations; frozen commands pin chart facts, content versions, policies, and provider settings\. [evidence-apps-api-routes-readings-ts](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts) [evidence-apps-api-services-ensure-today-reading-ts](source-evidence.md#evidence-evidence-apps-api-services-ensure-today-reading-ts) [evidence-apps-api-services-run-reading-scheduler-ts](source-evidence.md#evidence-evidence-apps-api-services-run-reading-scheduler-ts)

### Compile permitted context

<a id="claim-leaf-compile-permitted-context-1"></a>
- Context loading combines authorized source signals, previous readings, and structured feedback; deterministic rules enforce freshness, allowed uses, and packet limits\. [evidence-apps-api-services-context-compiler-ts](source-evidence.md#evidence-evidence-apps-api-services-context-compiler-ts) [evidence-packages-reading-engine-constrained-input-ts](source-evidence.md#evidence-evidence-packages-reading-engine-constrained-input-ts) [evidence-apps-api-routes-stubs-ts](source-evidence.md#evidence-evidence-apps-api-routes-stubs-ts)

<a id="claim-leaf-compile-permitted-context-2"></a>
- Feedback can inform repetition control and theme ranking under its source grant; it does not alter calculated astrology facts\. [evidence-context-expansion](source-evidence.md#evidence-evidence-context-expansion) [evidence-reading-feedback-write](source-evidence.md#evidence-evidence-reading-feedback-write) [evidence-apps-api-services-context-compiler-ts](source-evidence.md#evidence-evidence-apps-api-services-context-compiler-ts)

### Generate and validate

<a id="claim-leaf-generate-and-validate-1"></a>
- Codex supplies a structured prose candidate; reading\-engine validates output shape, selected evidence, citation\-specific fact support, uncertainty, and content constraints\. [evidence-apps-api-services-generate-daily-reading-v5-ts](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts) [evidence-packages-reading-engine-candidate-validation-ts](source-evidence.md#evidence-evidence-packages-reading-engine-candidate-validation-ts) [evidence-packages-reading-engine-claim-support-ts](source-evidence.md#evidence-evidence-packages-reading-engine-claim-support-ts)

<a id="claim-leaf-generate-and-validate-2"></a>
- The Worker owns consent checks, budgets, retries, encryption, and publication; a model response alone cannot publish a reading\. [evidence-apps-api-services-generate-daily-reading-v5-ts](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts) [evidence-packages-reading-engine-candidate-validation-ts](source-evidence.md#evidence-evidence-packages-reading-engine-candidate-validation-ts) [evidence-packages-reading-engine-claim-support-ts](source-evidence.md#evidence-evidence-packages-reading-engine-claim-support-ts) [evidence-apps-api-services-generate-daily-reading-v5-ts-3](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-3)

### Publication and historical compatibility

<a id="claim-leaf-publication-and-historical-compatibility-1"></a>
- Published prose and paragraph evidence retain their source identity; owned history, feedback, save, and evidence endpoints expose reader functions\. [evidence-apps-api-services-generate-daily-reading-v5-ts-2](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-2) [evidence-apps-api-routes-readings-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts-2)

<a id="claim-leaf-publication-and-historical-compatibility-2"></a>
- Frozen Daily V1 commands execute deterministic V3 assembly, while V2 commands execute constrained\-model V5; dispatch follows the frozen command rather than current rollout settings, and Today explicitly requests V5\. [evidence-apps-api-services-generate-daily-reading-ts](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-ts) [evidence-apps-api-routes-readings-ts](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts)

## Pattern generation and ontology

### Select chart evidence

<a id="claim-leaf-select-chart-evidence-1"></a>
- Natal feature extraction and a versioned ontology feed deterministic evidence selection before Pattern prose is generated\. [evidence-apps-api-services-natal-features-ts](source-evidence.md#evidence-evidence-apps-api-services-natal-features-ts) [evidence-packages-pattern-engine-selection-ts-2](source-evidence.md#evidence-evidence-packages-pattern-engine-selection-ts-2) [evidence-apps-api-services-pattern-execute-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts)

<a id="claim-leaf-select-chart-evidence-2"></a>
- Pattern commands pin chart fingerprints, consent, source revision, ontology, selection policy, and publisher settings for durable generation ownership\. [evidence-apps-api-services-pattern-command-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-command-ts-2) [evidence-apps-api-services-pattern-execute-ts-4](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-4)

### Plan, write, and verify

<a id="claim-leaf-plan-write-and-verify-1"></a>
- Planner, writer, and semantic verifier passes run through guarded stages with bounded retries and correction handling\. [evidence-apps-api-services-pattern-execute-ts-5](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-5) [evidence-apps-api-services-pattern-execute-ts-6](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-6)

<a id="claim-leaf-plan-write-and-verify-2"></a>
- Owning deterministic plan and candidate validators are called by the executor before publication proof, source support checks, prohibited\-claim screening, and public projection\. [evidence-packages-pattern-engine-plan-validate-ts](source-evidence.md#evidence-evidence-packages-pattern-engine-plan-validate-ts) [evidence-packages-pattern-engine-candidate-validate-ts](source-evidence.md#evidence-evidence-packages-pattern-engine-candidate-validate-ts) [evidence-apps-api-services-pattern-execute-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-2) [evidence-apps-api-services-pattern-execute-ts-7](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-7) [evidence-apps-api-services-pattern-publication-proof-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-publication-proof-ts-2) [evidence-apps-api-services-pattern-publication-safety-ts-3](source-evidence.md#evidence-evidence-apps-api-services-pattern-publication-safety-ts-3)

### Read, regenerate, and erase

<a id="claim-leaf-read-regenerate-and-erase-1"></a>
- GET /v1/pattern serves generated Pattern documents; the older editorial catalogue remains preserved data outside the current product reader\. [evidence-apps-api-routes-pattern-ts](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ts) [evidence-apps-api-routes-pattern-ai-ts](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ai-ts) [evidence-apps-api-services-pattern-state-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-state-ts)

<a id="claim-leaf-read-regenerate-and-erase-2"></a>
- Generation claims govern chart ownership, source\-change regeneration, cancellation, and erasure; the interface exposes progress and eligible regeneration actions\. [evidence-apps-api-routes-pattern-ts](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ts) [evidence-apps-api-routes-pattern-ai-ts](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ai-ts) [evidence-apps-api-services-pattern-state-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-state-ts)

### Offline ontology supply

<a id="claim-leaf-offline-ontology-supply-1"></a>
- The offline builder transforms prepared corpus fragments into an unsigned compilable synthetic\_internal candidate without a provider call, separately from the parked machine producer\. [evidence-apps-api-scripts-build-internal-ontology-ts](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts) [evidence-apps-api-scripts-build-internal-ontology-ts-2](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts-2) [evidence-offline-compile](source-evidence.md#evidence-evidence-offline-compile)

<a id="claim-leaf-offline-ontology-supply-2"></a>
- Against the committed 60\-fragment corpus, the predicate mapping emits 40 records and omits the twelve section 2 sign fragments and eight section 8 cross\-cutting fragments; sentence matching and proposition fallback are traceable transformations rather than editorial adjudication\. [evidence-apps-api-scripts-build-internal-ontology-ts-2](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts-2) [evidence-apps-api-scripts-build-internal-ontology-ts-3](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts-3) [evidence-apps-api-scripts-build-internal-ontology-ts-4](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts-4) [evidence-corpus-fragments](source-evidence.md#evidence-evidence-corpus-fragments)

<a id="claim-leaf-offline-ontology-supply-3"></a>
- The builder actually compiles the candidate; evaluator\_passed = true and unevaluated\_fixture\_count = 0 are compatibility fields, while regression\_passed = false records no regression rehearsal\. These fields do not establish independent evaluation or completed human review\. [evidence-apps-api-scripts-build-internal-ontology-ts-5](source-evidence.md#evidence-evidence-apps-api-scripts-build-internal-ontology-ts-5) [evidence-pattern-corpus-provenance-json](source-evidence.md#evidence-evidence-pattern-corpus-provenance-json) [evidence-offline-compile](source-evidence.md#evidence-evidence-offline-compile)

<a id="claim-leaf-offline-ontology-supply-4"></a>
- Internal signing returns a signature and does not ingest or activate the release; admitted internal releases can serve eligible readers, and signatures do not certify interpretation quality\. [evidence-apps-api-services-ontology-signing-client-ts](source-evidence.md#evidence-evidence-apps-api-services-ontology-signing-client-ts) [evidence-apps-api-db-pattern-ontology-ts](source-evidence.md#evidence-evidence-apps-api-db-pattern-ontology-ts)

<a id="claim-leaf-offline-ontology-supply-5"></a>
- The September 6 active\-pointer join recorded internal release 0\.1\.0 with bundle hash sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84, corpus hash sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c, and a null joined machine evidence run; it does not prove a current signature, current activation, or a complete evidence census\. (Recorded observation: 2026-09-06T18:49:35.205Z) [evidence-recorded-ontology-pointer](source-evidence.md#evidence-evidence-recorded-ontology-pointer)

### Parked machine\-ontology producer

<a id="claim-leaf-parked-machine-ontology-producer-1"></a>
- The implemented machine producer advances a registered corpus through generation, compilation, evaluation, regression, isolated signing, and ingestion; committed production rollout is off\. [evidence-apps-api-services-ontology-pipeline-execute-ts](source-evidence.md#evidence-evidence-apps-api-services-ontology-pipeline-execute-ts) [evidence-apps-api-wrangler-toml](source-evidence.md#evidence-evidence-apps-api-wrangler-toml)

<a id="claim-leaf-parked-machine-ontology-producer-2"></a>
- A valid synthetic\_internal release is admitted by origin; machine\_pipeline requires public activation scope, while account, chart, locale, consent, pause, and claim gates still apply\. [evidence-apps-api-db-pattern-ontology-ts](source-evidence.md#evidence-evidence-apps-api-db-pattern-ontology-ts) [evidence-apps-api-services-pattern-execute-ts-4](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-4) [evidence-apps-api-services-pattern-state-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-state-ts)

### Source provenance and rights

<a id="claim-leaf-source-provenance-and-rights-1"></a>
- Corpus records and integrity tooling retain model\-generated origin, rights classifications, fragment hashes, and a place to record attributable human review\. [evidence-pattern-corpus-readme-md](source-evidence.md#evidence-evidence-pattern-corpus-readme-md) [evidence-pattern-corpus-provenance-json](source-evidence.md#evidence-evidence-pattern-corpus-provenance-json) [evidence-pattern-corpus-reviewers-json](source-evidence.md#evidence-evidence-pattern-corpus-reviewers-json) [evidence-pattern-corpus-validate-fragments-mjs](source-evidence.md#evidence-evidence-pattern-corpus-validate-fragments-mjs) [evidence-apps-api-services-pattern-publication-safety-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-publication-safety-ts-2) [evidence-corpus-hash-format](source-evidence.md#evidence-evidence-corpus-hash-format)

<a id="claim-leaf-source-provenance-and-rights-2"></a>
- The committed evidence is incomplete by its own account: 60 model\-generated fragments, provider and model and generation time all recorded as unverified, zero certified fragments, an empty reviewer registry, and public activation listing five outstanding items\. [evidence-pattern-corpus-readme-md](source-evidence.md#evidence-evidence-pattern-corpus-readme-md) [evidence-pattern-corpus-provenance-json](source-evidence.md#evidence-evidence-pattern-corpus-provenance-json) [evidence-pattern-corpus-reviewers-json](source-evidence.md#evidence-evidence-pattern-corpus-reviewers-json) [evidence-pattern-corpus-validate-fragments-mjs](source-evidence.md#evidence-evidence-pattern-corpus-validate-fragments-mjs) [evidence-apps-api-services-pattern-publication-safety-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-publication-safety-ts-2) [evidence-corpus-generation-status](source-evidence.md#evidence-evidence-corpus-generation-status) [evidence-corpus-public-activation](source-evidence.md#evidence-evidence-corpus-public-activation)

<a id="claim-leaf-source-provenance-and-rights-3"></a>
- Rights classifications and source\-supported labels do not establish independent authorship; hash and signature consistency is not completed human review or activation approval\. [evidence-pattern-corpus-readme-md](source-evidence.md#evidence-evidence-pattern-corpus-readme-md) [evidence-pattern-corpus-provenance-json](source-evidence.md#evidence-evidence-pattern-corpus-provenance-json) [evidence-pattern-corpus-reviewers-json](source-evidence.md#evidence-evidence-pattern-corpus-reviewers-json) [evidence-pattern-corpus-validate-fragments-mjs](source-evidence.md#evidence-evidence-pattern-corpus-validate-fragments-mjs) [evidence-apps-api-services-pattern-publication-safety-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-publication-safety-ts-2)

## Portrait and 3D observatory

### Images derived from chapters

<a id="claim-leaf-images-derived-from-chapters-1"></a>
- Eligible four\-chapter Patterns can create private portraits; complete chapter source text guides native image generation without replacing the original document\. [evidence-apps-api-services-pattern-portrait-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-ts) [evidence-apps-api-services-pattern-portrait-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-ts-2) [evidence-apps-codex-runner-portrait-invocation-ts](source-evidence.md#evidence-evidence-apps-codex-runner-portrait-invocation-ts) [evidence-portrait-four-chapters](source-evidence.md#evidence-evidence-portrait-four-chapters)

<a id="claim-leaf-images-derived-from-chapters-2"></a>
- Portrait state binds images to the owning account, chart, document revision, source text, and content hashes before serving them\. [evidence-apps-api-services-pattern-portrait-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-ts) [evidence-apps-api-services-pattern-portrait-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-ts-2) [evidence-apps-codex-runner-portrait-invocation-ts](source-evidence.md#evidence-evidence-apps-codex-runner-portrait-invocation-ts) [evidence-portrait-completion](source-evidence.md#evidence-evidence-portrait-completion)

### Compiled and inspected 3D objects

<a id="claim-leaf-compiled-and-inspected-3d-objects-1"></a>
- The runner authors a constrained geometry program from the image and chapter, compiles GLB assets, and evaluates four rendered inspection views\. [evidence-apps-codex-runner-portrait-mesh-invocation-ts](source-evidence.md#evidence-evidence-apps-codex-runner-portrait-mesh-invocation-ts) [evidence-apps-api-services-pattern-portrait-mesh-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-mesh-ts) [evidence-apps-web-components-accountportraitexplorer-tsx](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx)

<a id="claim-leaf-compiled-and-inspected-3d-objects-2"></a>
- Worker and browser checks bind each model to its chapter, source image, source text, document revision, compiler provenance, and hashes\. [evidence-apps-codex-runner-portrait-mesh-invocation-ts](source-evidence.md#evidence-evidence-apps-codex-runner-portrait-mesh-invocation-ts) [evidence-apps-api-services-pattern-portrait-mesh-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-mesh-ts) [evidence-apps-web-components-accountportraitexplorer-tsx](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx)

### Interactive observatory

<a id="claim-leaf-interactive-observatory-1"></a>
- The Three\.js observatory builds one reading station per published chapter, three through six, with reading desks, object inspection, comparison, guided reading, and a chart\-informed zodiac instrument\. [evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx) [evidence-apps-web-components-portrait-explorer-observatory-world-ts](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatory-world-ts) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx) [evidence-apps-web-components-accountportraitexplorer-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx-2) [evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx)

<a id="claim-leaf-interactive-observatory-2"></a>
- It is the default presentation of a matching published Pattern and needs no generated artwork: a chapter without a verified asset renders an authored reading folio in the same station\. [evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx) [evidence-apps-web-components-portrait-explorer-observatory-world-ts](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatory-world-ts) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx) [evidence-apps-web-components-accountportraitexplorer-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx-2) [evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx)

<a id="claim-leaf-interactive-observatory-3"></a>
- The observatory offers daylight and dusk, roof controls, object turns, desk interactions, and navigation through source\-linked chapter passages\. [evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx) [evidence-apps-web-components-portrait-explorer-observatory-world-ts](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatory-world-ts) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx) [evidence-apps-web-components-accountportraitexplorer-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx-2) [evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-observatorycontrols-tsx)

### Complete reading and graphics recovery

<a id="claim-leaf-complete-reading-and-graphics-recovery-1"></a>
- The full reading retains chapter perspectives, additional signatures, and uncertainty; unavailable, generating, failed, and unverified\-artwork states discard the artwork and leave the reading standing rather than swapping in a separate view\. [evidence-apps-web-lib-pattern-portrait-ts](source-evidence.md#evidence-evidence-apps-web-lib-pattern-portrait-ts) [evidence-apps-web-components-portrait-explorer-explorerreader-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-explorerreader-tsx) [evidence-apps-web-components-accountportraitexplorer-tsx-3](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx-3) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx-2) [evidence-apps-web-components-portrait-explorer-use-explorer-navigation-ts](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-use-explorer-navigation-ts)

<a id="claim-leaf-complete-reading-and-graphics-recovery-2"></a>
- Navigation preserves reading and camera state; reduced motion, low\-power graphics, authenticated asset verification, and WebGL cleanup support the experience\. [evidence-apps-web-lib-pattern-portrait-ts](source-evidence.md#evidence-evidence-apps-web-lib-pattern-portrait-ts) [evidence-apps-web-components-portrait-explorer-explorerreader-tsx](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-explorerreader-tsx) [evidence-apps-web-components-accountportraitexplorer-tsx-3](source-evidence.md#evidence-evidence-apps-web-components-accountportraitexplorer-tsx-3) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx-2) [evidence-apps-web-components-portrait-explorer-use-explorer-navigation-ts](source-evidence.md#evidence-evidence-apps-web-components-portrait-explorer-use-explorer-navigation-ts)

### Portrait automation permissions

<a id="claim-leaf-portrait-automation-permissions-1"></a>
- Privacy exposes an explicit chart\-bound portrait automation grant, distinct from general Pattern generation consent\. [evidence-apps-web-components-privacyview-tsx-2](source-evidence.md#evidence-evidence-apps-web-components-privacyview-tsx-2) [evidence-apps-api-services-pattern-portrait-mesh-ts-2](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-mesh-ts-2)

<a id="claim-leaf-portrait-automation-permissions-2"></a>
- Publication triggers enqueue portrait automation work; the automation service and separate image and mesh runner lanes coordinate that work subject to source identity and live grants\. [evidence-db-d1-0027-portrait-mesh-automation-sql](source-evidence.md#evidence-evidence-db-d1-0027-portrait-mesh-automation-sql) [evidence-apps-api-services-pattern-portrait-mesh-ts-3](source-evidence.md#evidence-evidence-apps-api-services-pattern-portrait-mesh-ts-3) [evidence-apps-codex-runner-runner-ts-2](source-evidence.md#evidence-evidence-apps-codex-runner-runner-ts-2)

<a id="claim-leaf-portrait-automation-permissions-3"></a>
- Withdrawing automation cancels unfinished outbox, image, and mesh work without rewriting the reading or asserting that every completed asset has been erased; broader deletion paths have separate effects\. [evidence-db-d1-0027-portrait-mesh-automation-sql-2](source-evidence.md#evidence-evidence-db-d1-0027-portrait-mesh-automation-sql-2)

## Runtime and generation services

### Worker, web assets, and PWA

<a id="claim-leaf-worker-web-assets-and-pwa-1"></a>
- apps/api runs the Hono Worker with HTTP, queue, and scheduled entry points; production configuration bundles the React web assets\. [evidence-apps-api-index-ts](source-evidence.md#evidence-evidence-apps-api-index-ts) [evidence-apps-api-wrangler-toml-2](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-2) [evidence-apps-web-public-sw-js](source-evidence.md#evidence-evidence-apps-web-public-sw-js) [evidence-production-web-assets](source-evidence.md#evidence-evidence-production-web-assets)

<a id="claim-leaf-worker-web-assets-and-pwa-2"></a>
- API and control routes run before asset fallback; the PWA service worker caches shell assets and bypasses /v1 requests\. [evidence-apps-api-index-ts](source-evidence.md#evidence-evidence-apps-api-index-ts) [evidence-apps-api-wrangler-toml-2](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-2) [evidence-apps-web-public-sw-js](source-evidence.md#evidence-evidence-apps-web-public-sw-js)

### Durable work and maintenance

<a id="claim-leaf-durable-work-and-maintenance-1"></a>
- Dedicated queues carry Daily, Pattern, ontology, and privacy jobs; claim leases, idempotency, retry budgets, and cancellation checks coordinate execution\. [evidence-apps-api-queue-ts](source-evidence.md#evidence-evidence-apps-api-queue-ts) [evidence-apps-api-scheduled-ts](source-evidence.md#evidence-evidence-apps-api-scheduled-ts) [evidence-apps-api-wrangler-toml-3](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-3)

<a id="claim-leaf-durable-work-and-maintenance-2"></a>
- Scheduled maintenance prepares readings and recovers jobs, while separate ontology maintenance handles expired leases, undispatched work, and retained artifacts\. [evidence-apps-api-queue-ts](source-evidence.md#evidence-evidence-apps-api-queue-ts) [evidence-apps-api-scheduled-ts](source-evidence.md#evidence-evidence-apps-api-scheduled-ts) [evidence-apps-api-wrangler-toml-3](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-3)

### Codex runner and host dependency

<a id="claim-leaf-codex-runner-and-host-dependency-1"></a>
- apps/codex\-runner polls the authenticated provider control plane, executes isolated ChatGPT\-authenticated Codex jobs, and returns bounded outputs for Worker validation\. [evidence-apps-codex-runner-index-ts](source-evidence.md#evidence-evidence-apps-codex-runner-index-ts) [evidence-apps-codex-runner-runner-ts](source-evidence.md#evidence-evidence-apps-codex-runner-runner-ts) [evidence-apps-codex-runner-codex-cli-ts](source-evidence.md#evidence-evidence-apps-codex-runner-codex-cli-ts) [evidence-apps-codex-runner-isolated-codex-json-ts](source-evidence.md#evidence-evidence-apps-codex-runner-isolated-codex-json-ts) [evidence-apps-api-routes-codex-provider-ts](source-evidence.md#evidence-evidence-apps-api-routes-codex-provider-ts)

<a id="claim-leaf-codex-runner-and-host-dependency-2"></a>
- Text generation, native portrait images, and compiled portrait meshes have distinct execution paths; image and mesh lanes require runner enablement\. [evidence-apps-codex-runner-index-ts](source-evidence.md#evidence-evidence-apps-codex-runner-index-ts) [evidence-apps-codex-runner-runner-ts](source-evidence.md#evidence-evidence-apps-codex-runner-runner-ts) [evidence-apps-codex-runner-codex-cli-ts](source-evidence.md#evidence-evidence-apps-codex-runner-codex-cli-ts) [evidence-apps-codex-runner-isolated-codex-json-ts](source-evidence.md#evidence-evidence-apps-codex-runner-isolated-codex-json-ts) [evidence-apps-api-routes-codex-provider-ts](source-evidence.md#evidence-evidence-apps-api-routes-codex-provider-ts)

<a id="claim-leaf-codex-runner-and-host-dependency-3"></a>
- One process polls those lanes strictly in order, text first and meshes last, each checked only when the lane above it is idle, so distinct job types are not fair or parallel and sustained text work can delay artwork\. This code is present in the repository; no installation or liveness on a host is claimed\. [evidence-apps-codex-runner-index-ts](source-evidence.md#evidence-evidence-apps-codex-runner-index-ts) [evidence-apps-codex-runner-runner-ts](source-evidence.md#evidence-evidence-apps-codex-runner-runner-ts) [evidence-apps-codex-runner-codex-cli-ts](source-evidence.md#evidence-evidence-apps-codex-runner-codex-cli-ts) [evidence-apps-codex-runner-isolated-codex-json-ts](source-evidence.md#evidence-evidence-apps-codex-runner-isolated-codex-json-ts) [evidence-apps-api-routes-codex-provider-ts](source-evidence.md#evidence-evidence-apps-api-routes-codex-provider-ts)

### Operator generation and repair

<a id="claim-leaf-operator-generation-and-repair-1"></a>
- The internal readings reissue route requires the expected live reading identity and a permitted revision reason; the reason describes revision purpose rather than whether an operator or scheduler initiated it\. [evidence-apps-api-routes-internal-generation-ts](source-evidence.md#evidence-evidence-apps-api-routes-internal-generation-ts) [evidence-apps-api-services-generation-command-v2-ts-2](source-evidence.md#evidence-evidence-apps-api-services-generation-command-v2-ts-2)

<a id="claim-leaf-operator-generation-and-repair-2"></a>
- Fact invalidation can select defect\_repair, the scheduler can reserve that repair, and retry reconstruction preserves the reserved reason in frozen command provenance\. [evidence-apps-api-services-reading-invalidation-ts-2](source-evidence.md#evidence-evidence-apps-api-services-reading-invalidation-ts-2) [evidence-apps-api-services-run-reading-scheduler-ts-2](source-evidence.md#evidence-evidence-apps-api-services-run-reading-scheduler-ts-2) [evidence-apps-api-services-enqueue-ts](source-evidence.md#evidence-evidence-apps-api-services-enqueue-ts)

### Storage and isolated signing

<a id="claim-leaf-storage-and-isolated-signing-1"></a>
- D1 stores account state, chart snapshots, permissions, readings, and durable job records; R2 stores releases and protected generation artifacts\. [evidence-apps-api-wrangler-toml-4](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-4) [evidence-apps-api-wrangler-toml-5](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-5) [evidence-apps-ontology-signer-index-ts](source-evidence.md#evidence-evidence-apps-ontology-signer-index-ts) [evidence-production-artifacts](source-evidence.md#evidence-evidence-production-artifacts)

<a id="claim-leaf-storage-and-isolated-signing-2"></a>
- A separate R2 replay ledger supports erasure recovery; ontology signing uses a service\-bound Worker that holds its own signing keys\. [evidence-apps-api-wrangler-toml-4](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-4) [evidence-apps-api-wrangler-toml-5](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-5) [evidence-apps-ontology-signer-index-ts](source-evidence.md#evidence-evidence-apps-ontology-signer-index-ts)

### Committed production switches

<a id="claim-leaf-committed-production-switches-1"></a>
- Source configuration enables hybrid Daily preparation, Pattern generation, portraits, meshes, and Geoapify; automated ontology generation remains switched off\. [evidence-apps-api-wrangler-toml-6](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-6) [evidence-apps-api-services-reading-publisher-ts](source-evidence.md#evidence-evidence-apps-api-services-reading-publisher-ts) [evidence-apps-api-services-pattern-execute-ts-3](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-3) [evidence-production-daily-rollout](source-evidence.md#evidence-evidence-production-daily-rollout) [evidence-production-geocoder](source-evidence.md#evidence-evidence-production-geocoder) [evidence-pattern-generation-switch](source-evidence.md#evidence-evidence-pattern-generation-switch)

<a id="claim-leaf-committed-production-switches-2"></a>
- New Daily and Pattern text generation select Codex with gpt\-5\.6\-sol and xhigh reasoning; older adapters remain in source\. [evidence-apps-api-wrangler-toml-6](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-6) [evidence-apps-api-services-reading-publisher-ts](source-evidence.md#evidence-evidence-apps-api-services-reading-publisher-ts) [evidence-apps-api-services-pattern-execute-ts-3](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-3) [evidence-daily-model-pins](source-evidence.md#evidence-evidence-daily-model-pins) [evidence-production-pattern-model-pins](source-evidence.md#evidence-evidence-production-pattern-model-pins)

<a id="claim-leaf-committed-production-switches-3"></a>
- These are committed settings only\. They do not establish deployed secrets, runner health, an active ontology, applied migrations, granted consent, or which release production is serving\. [evidence-apps-api-wrangler-toml-6](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-6) [evidence-apps-api-services-reading-publisher-ts](source-evidence.md#evidence-evidence-apps-api-services-reading-publisher-ts) [evidence-apps-api-services-pattern-execute-ts-3](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-3)

### Shared Codex exchange mechanics

<a id="claim-leaf-shared-codex-exchange-mechanics-1"></a>
- Daily and Pattern adapters share durable Codex job coordinates, authenticated runner claim and completion routes, encrypted request and response artifacts, leases, and bounded response envelopes\. [evidence-apps-api-services-codex-reading-publisher-ts](source-evidence.md#evidence-evidence-apps-api-services-codex-reading-publisher-ts) [evidence-apps-api-services-codex-pattern-publisher-ts](source-evidence.md#evidence-evidence-apps-api-services-codex-pattern-publisher-ts) [evidence-apps-api-db-codex-provider-jobs-ts](source-evidence.md#evidence-evidence-apps-api-db-codex-provider-jobs-ts) [evidence-apps-api-services-codex-provider-artifacts-ts](source-evidence.md#evidence-evidence-apps-api-services-codex-provider-artifacts-ts) [evidence-apps-api-routes-codex-provider-ts](source-evidence.md#evidence-evidence-apps-api-routes-codex-provider-ts)

<a id="claim-leaf-shared-codex-exchange-mechanics-2"></a>
- Shared exchange mechanics do not merge domain ownership: Daily owns constrained context and candidate publication, while Pattern owns selection, planning, writing, semantic verification, and its publication proof\. [evidence-apps-api-services-generate-daily-reading-v5-ts-3](source-evidence.md#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-3) [evidence-apps-api-services-pattern-execute-ts-5](source-evidence.md#evidence-evidence-apps-api-services-pattern-execute-ts-5)

### Observability and release identity

<a id="claim-leaf-observability-and-release-identity-1"></a>
- Committed production observability has top\-level enabled = false, nested logs enabled = true, and nested traces enabled = false; these are source settings rather than evidence of collected production telemetry\. [evidence-apps-api-wrangler-toml-7](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-7) [evidence-apps-api-wrangler-toml-8](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-8) [evidence-apps-api-wrangler-toml-9](source-evidence.md#evidence-evidence-apps-api-wrangler-toml-9)

<a id="claim-leaf-observability-and-release-identity-2"></a>
- Health reports liveness and meta reports configured release Git SHA and Worker version identity; neither proves successful provider execution or installed runner adoption\. [evidence-apps-api-routes-health-ts](source-evidence.md#evidence-evidence-apps-api-routes-health-ts) [evidence-apps-api-routes-health-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-health-ts-2)

## Identity and privacy

### Route authority zones

<a id="claim-leaf-route-authority-zones-1"></a>
- Health and meta routes mount outside configGuard; session exchange has path\-specific configuration guards and validates its own identity proof\. [evidence-apps-api-index-ts-6](source-evidence.md#evidence-evidence-apps-api-index-ts-6) [evidence-apps-api-index-ts-7](source-evidence.md#evidence-evidence-apps-api-index-ts-7) [evidence-apps-api-routes-sessions-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-sessions-ts-2)

<a id="claim-leaf-route-authority-zones-2"></a>
- Deletion status is configuration guarded and requires its dedicated deletion\-receipt cookie after the normal session is revoked\. [evidence-apps-api-index-ts-8](source-evidence.md#evidence-evidence-apps-api-index-ts-8) [evidence-apps-api-routes-privacy-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-privacy-ts-2)

<a id="claim-leaf-route-authority-zones-3"></a>
- The product API applies configGuard, authenticate, and accountStateGate; internal service, Cloudflare Access admin, Codex runner, and crypto\-operator zones apply their own distinct credentials and configuration guards before the product wildcard mount\. [evidence-apps-api-index-ts-2](source-evidence.md#evidence-evidence-apps-api-index-ts-2) [evidence-apps-api-index-ts-9](source-evidence.md#evidence-evidence-apps-api-index-ts-9) [evidence-apps-api-index-ts-3](source-evidence.md#evidence-evidence-apps-api-index-ts-3) [evidence-apps-api-index-ts-10](source-evidence.md#evidence-evidence-apps-api-index-ts-10) [evidence-apps-api-index-ts-4](source-evidence.md#evidence-evidence-apps-api-index-ts-4) [evidence-apps-api-index-ts-5](source-evidence.md#evidence-evidence-apps-api-index-ts-5)

### Administrator inspection and audit

<a id="claim-leaf-administrator-inspection-and-audit-1"></a>
- Pattern administration is a Cloudflare Access boundary rather than a shared bearer: adminAuth validates the Access assertion against the configured team and application audience, then binds the verified subject to a short\-lived hashed session\. [evidence-apps-api-middleware-admin-auth-ts](source-evidence.md#evidence-evidence-apps-api-middleware-admin-auth-ts) [evidence-apps-api-routes-admin-pattern-ts](source-evidence.md#evidence-evidence-apps-api-routes-admin-pattern-ts) [evidence-apps-api-routes-admin-pattern-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-admin-pattern-ts-2)

<a id="claim-leaf-administrator-inspection-and-audit-2"></a>
- Every inspection declares exactly one purpose from a closed set and writes a pattern\_admin\_access\_events row naming the admin subject, target account, scope hash, and generation\. This is privileged access to generation evidence, recorded separately from ordinary reader access\. [evidence-apps-api-middleware-admin-auth-ts](source-evidence.md#evidence-evidence-apps-api-middleware-admin-auth-ts) [evidence-apps-api-routes-admin-pattern-ts](source-evidence.md#evidence-evidence-apps-api-routes-admin-pattern-ts) [evidence-apps-api-routes-admin-pattern-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-admin-pattern-ts-2)

### Sessions and account state

<a id="claim-leaf-sessions-and-account-state-1"></a>
- Auth0 OIDC sign\-in exchanges identity proof for the Worker's secure, HttpOnly, SameSite Strict session cookie used by product routes\. [evidence-apps-api-routes-sessions-ts](source-evidence.md#evidence-evidence-apps-api-routes-sessions-ts) [evidence-apps-api-middleware-auth-ts](source-evidence.md#evidence-evidence-apps-api-middleware-auth-ts)

<a id="claim-leaf-sessions-and-account-state-2"></a>
- Account\-state middleware restricts frozen accounts to recovery operations, preserving access to renewed calculation consent, export, and account deletion\. [evidence-apps-api-routes-sessions-ts](source-evidence.md#evidence-evidence-apps-api-routes-sessions-ts) [evidence-apps-api-middleware-auth-ts](source-evidence.md#evidence-evidence-apps-api-middleware-auth-ts)

### Explicit processing permissions

<a id="claim-leaf-explicit-processing-permissions-1"></a>
- Account processing, Daily AI synthesis, Pattern generation, and geocoding have distinct consent policies; context sources carry their own allowed uses\. [evidence-apps-api-routes-account-processing-consents-ts](source-evidence.md#evidence-evidence-apps-api-routes-account-processing-consents-ts) [evidence-apps-api-routes-consents-ts](source-evidence.md#evidence-evidence-apps-api-routes-consents-ts) [evidence-apps-web-components-privacyview-tsx](source-evidence.md#evidence-evidence-apps-web-components-privacyview-tsx) [evidence-apps-api-services-context-compiler-ts](source-evidence.md#evidence-evidence-apps-api-services-context-compiler-ts)

<a id="claim-leaf-explicit-processing-permissions-2"></a>
- Privacy controls expose source permissions and topic exclusions; revocation is rechecked by generation and publication paths before protected work proceeds\. [evidence-apps-api-routes-account-processing-consents-ts](source-evidence.md#evidence-evidence-apps-api-routes-account-processing-consents-ts) [evidence-apps-api-routes-consents-ts](source-evidence.md#evidence-evidence-apps-api-routes-consents-ts) [evidence-apps-web-components-privacyview-tsx](source-evidence.md#evidence-evidence-apps-web-components-privacyview-tsx) [evidence-apps-api-services-context-compiler-ts](source-evidence.md#evidence-evidence-apps-api-services-context-compiler-ts)

### Protected personal payloads

<a id="claim-leaf-protected-personal-payloads-1"></a>
- Envelope encryption uses AES\-256\-GCM and wrapped per\-user data keys; Pattern content and generation artifacts have additional key ownership rules\. [evidence-apps-api-crypto-ts](source-evidence.md#evidence-evidence-apps-api-crypto-ts) [evidence-apps-api-services-pattern-crypto-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-crypto-ts) [evidence-apps-api-services-safe-log-ts](source-evidence.md#evidence-evidence-apps-api-services-safe-log-ts) [evidence-apps-api-routes-readings-ts-3](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts-3) [evidence-wrap-user-dek](source-evidence.md#evidence-evidence-wrap-user-dek)

<a id="claim-leaf-protected-personal-payloads-2"></a>
- Owner\-scoped queries, private response projections, no\-store headers, and restricted logging limit how personal content crosses storage and API boundaries\. [evidence-apps-api-crypto-ts](source-evidence.md#evidence-evidence-apps-api-crypto-ts) [evidence-apps-api-services-pattern-crypto-ts](source-evidence.md#evidence-evidence-apps-api-services-pattern-crypto-ts) [evidence-apps-api-services-safe-log-ts](source-evidence.md#evidence-evidence-apps-api-services-safe-log-ts) [evidence-apps-api-routes-readings-ts-3](source-evidence.md#evidence-evidence-apps-api-routes-readings-ts-3)

### Export, deletion, and key maintenance

<a id="claim-leaf-export-deletion-and-key-maintenance-1"></a>
- Queued exports provide owned status and download routes; deletion progresses through artifact removal, row erasure, key destruction, and receipt access\. [evidence-apps-api-routes-privacy-ts](source-evidence.md#evidence-evidence-apps-api-routes-privacy-ts) [evidence-apps-api-services-account-deletion-ts](source-evidence.md#evidence-evidence-apps-api-services-account-deletion-ts) [evidence-apps-api-routes-internal-crypto-ts](source-evidence.md#evidence-evidence-apps-api-routes-internal-crypto-ts) [evidence-apps-api-db-crypto-write-fence-ts](source-evidence.md#evidence-evidence-apps-api-db-crypto-write-fence-ts)

<a id="claim-leaf-export-deletion-and-key-maintenance-2"></a>
- Cryptographic operators use separate authentication and guarded maintenance routes; write fences coordinate key operations with concurrent account and generation work\. [evidence-apps-api-routes-privacy-ts](source-evidence.md#evidence-evidence-apps-api-routes-privacy-ts) [evidence-apps-api-services-account-deletion-ts](source-evidence.md#evidence-evidence-apps-api-services-account-deletion-ts) [evidence-apps-api-routes-internal-crypto-ts](source-evidence.md#evidence-evidence-apps-api-routes-internal-crypto-ts) [evidence-apps-api-db-crypto-write-fence-ts](source-evidence.md#evidence-evidence-apps-api-db-crypto-write-fence-ts)

## Contracts, content, and verification

### Schemas and ordered migrations

<a id="claim-leaf-schemas-and-ordered-migrations-1"></a>
- Frozen baseline contracts and additive Daily, privacy, Pattern, history, portrait, and mesh schemas define wire formats alongside OpenAPI and fixtures\. [evidence-contracts-validate-schemas-py](source-evidence.md#evidence-evidence-contracts-validate-schemas-py) [evidence-db-d1-migrations-json](source-evidence.md#evidence-evidence-db-d1-migrations-json) [evidence-packages-shared-index-ts](source-evidence.md#evidence-evidence-packages-shared-index-ts)

<a id="claim-leaf-schemas-and-ordered-migrations-2"></a>
- Ordered D1 migrations evolve operational tables; shared TypeScript packages carry wire types, canonical identities, fingerprints, and protocol definitions\. [evidence-contracts-validate-schemas-py](source-evidence.md#evidence-evidence-contracts-validate-schemas-py) [evidence-db-d1-migrations-json](source-evidence.md#evidence-evidence-db-d1-migrations-json) [evidence-packages-shared-index-ts](source-evidence.md#evidence-evidence-packages-shared-index-ts)

### Signed editorial release delivery

<a id="claim-leaf-signed-editorial-release-delivery-1"></a>
- Internal content ingestion verifies signed WordPress bundles, validates their content graph and object hashes, and stores immutable artifacts\. [evidence-apps-api-routes-content-releases-ts](source-evidence.md#evidence-evidence-apps-api-routes-content-releases-ts) [evidence-apps-api-services-content-release-ts](source-evidence.md#evidence-evidence-apps-api-services-content-release-ts) [evidence-apps-api-routes-pattern-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ts-2) [evidence-apps-api-routes-stubs-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-stubs-ts-2) [evidence-editorial-signature](source-evidence.md#evidence-evidence-editorial-signature) [evidence-editorial-object-hashes](source-evidence.md#evidence-evidence-editorial-object-hashes) [evidence-editorial-content-graph](source-evidence.md#evidence-evidence-editorial-content-graph)

<a id="claim-leaf-signed-editorial-release-delivery-2"></a>
- A bundle declaring scenario fixtures is held at accepted\_pending\_tests with the active pointer unmoved, because this route cannot evaluate declared fixtures and reports every one of them as pending\. Only fixture\-free releases can activate\. [evidence-apps-api-routes-content-releases-ts](source-evidence.md#evidence-evidence-apps-api-routes-content-releases-ts) [evidence-apps-api-services-content-release-ts](source-evidence.md#evidence-evidence-apps-api-services-content-release-ts) [evidence-apps-api-routes-pattern-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ts-2) [evidence-apps-api-routes-stubs-ts-2](source-evidence.md#evidence-evidence-apps-api-routes-stubs-ts-2)

<a id="claim-leaf-signed-editorial-release-delivery-3"></a>
- Legacy editorial Pattern content remains preserved outside the generated product reader, and real product handlers mount before legacy stubs\. [evidence-apps-api-routes-pattern-ts](source-evidence.md#evidence-evidence-apps-api-routes-pattern-ts) [evidence-legacy-stub-order](source-evidence.md#evidence-evidence-legacy-stub-order)

### Pure engines and licensing boundary

<a id="claim-leaf-pure-engines-and-licensing-boundary-1"></a>
- reading\-engine and pattern\-engine isolate deterministic product rules from network and storage access; shared contains the cross\-service wire vocabulary\. [evidence-packages-reading-engine-index-ts](source-evidence.md#evidence-evidence-packages-reading-engine-index-ts) [evidence-packages-pattern-engine-index-ts](source-evidence.md#evidence-evidence-packages-pattern-engine-index-ts) [evidence-apps-calc-stub-package-json](source-evidence.md#evidence-evidence-apps-calc-stub-package-json) [evidence-packages-shared-package-json](source-evidence.md#evidence-evidence-packages-shared-package-json)

<a id="claim-leaf-pure-engines-and-licensing-boundary-2"></a>
- The Swiss Ephemeris service declares AGPL\-3\.0\-or\-later while packages/shared declares UNLICENSED pending the boundary decision, so the repository records that question as open rather than settled\. [evidence-packages-reading-engine-index-ts](source-evidence.md#evidence-evidence-packages-reading-engine-index-ts) [evidence-packages-pattern-engine-index-ts](source-evidence.md#evidence-evidence-packages-pattern-engine-index-ts) [evidence-apps-calc-stub-package-json](source-evidence.md#evidence-evidence-apps-calc-stub-package-json) [evidence-packages-shared-package-json](source-evidence.md#evidence-evidence-packages-shared-package-json) [evidence-shared-license-decision](source-evidence.md#evidence-evidence-shared-license-decision) [evidence-unresolved-license-boundary](source-evidence.md#evidence-evidence-unresolved-license-boundary)

### Release assurance tooling

<a id="claim-leaf-release-assurance-tooling-1"></a>
- The operational canary performs native HTTP readbacks by default and can POST an authenticated place search that exercises geocoding; injected fetch supports tests, and source presence alone is not execution evidence\. [evidence-scripts-pattern-release-operational-canary-mjs-2](source-evidence.md#evidence-evidence-scripts-pattern-release-operational-canary-mjs-2)

<a id="claim-leaf-release-assurance-tooling-2"></a>
- Fresh Daily, Pattern, and semantic\-verifier evaluation runs invoke Codex by default; supported Daily and verifier preparation modes construct inputs without those invocations\. [evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2](source-evidence.md#evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2) [evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs](source-evidence.md#evidence-evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs) [evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2](source-evidence.md#evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2) [evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3](source-evidence.md#evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3) [evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3](source-evidence.md#evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3)

<a id="claim-leaf-release-assurance-tooling-3"></a>
- Release evidence captures and verifies a local gate receipt; release reconciliation consumes supplied records offline, and neither command grants deployment authority or certifies provider\-account state\. [evidence-scripts-pattern-release-release-evidence-mjs-2](source-evidence.md#evidence-evidence-scripts-pattern-release-release-evidence-mjs-2) [evidence-scripts-pattern-release-release-evidence-mjs-3](source-evidence.md#evidence-evidence-scripts-pattern-release-release-evidence-mjs-3) [evidence-scripts-pattern-release-release-reconciliation-mjs](source-evidence.md#evidence-evidence-scripts-pattern-release-release-reconciliation-mjs)

### Local verification and release gate

<a id="claim-leaf-local-verification-and-release-gate-1"></a>
- Repository checks cover TypeScript, workspace tests, calculation goldens, schema fixtures, OpenAPI, D1 smoke checks, content integrity, and production build preparation\. [evidence-package-json](source-evidence.md#evidence-evidence-package-json) [evidence-scripts-ci-local-sh](source-evidence.md#evidence-evidence-scripts-ci-local-sh) [evidence-agents-md](source-evidence.md#evidence-evidence-agents-md)

<a id="claim-leaf-local-verification-and-release-gate-2"></a>
- Repository guidance identifies ci:local as the procedural merge gate, records unavailable GitHub Actions and unprotected main, and requires its actual summary in the PR before merging\. [evidence-agents-md-2](source-evidence.md#evidence-evidence-agents-md-2)

<a id="claim-leaf-local-verification-and-release-gate-3"></a>
- Repository guidance states that merging main triggers separate Cloudflare Workers Builds; a trigger alone does not establish a successful production release\. [evidence-agents-md-3](source-evidence.md#evidence-evidence-agents-md-3)
