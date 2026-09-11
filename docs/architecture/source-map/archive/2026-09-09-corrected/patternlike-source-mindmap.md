# Patternlike application

## Reader experience

### Application and navigation

- App.tsx and AppShell.tsx connect six authenticated views: Today, History, Your Pattern, Timing, Time travel, and Privacy.
- Onboarding collects birth details and calculation consent; account recovery, sign out, and deletion status have dedicated interface states.

### Today and History

- Today presents the current local day's reading, reflection, evidence explanation, saving, and an optional personal check-in.
- History provides chronological and saved reading lists, reopening published reading documents with their own dates and preserved evidence.
- One shared article serves both surfaces, and the check-in and the structured feedback control are the two arms of a single switch, so feedback is offered on a reopened History reading rather than on Today.

### Your Pattern

- ChartView leads with the generated Pattern reading and follows it with normalized chart positions, aspects, houses, uncertainty, and calculation provenance.
- PatternExperience preserves chapter summaries, sections, tensions, resources, alternative expressions, additional signatures, and uncertainty alongside portrait entry points.

### Timing and Time travel

- Timing displays calculated transit cycles with phase and duration filters; Time travel explores a selected date and personal life events.
- Time travel uses bounded calculation scans, cached receipts, scheduling time zones, and uncertainty rules to assemble dated results.

## Calculation authority

### Birth data and place resolution

- Birth submission validates accuracy, consent, coordinates, and idempotency before invoking calculation; correction updates the chart and invalidates dependent readings.
- Geoapify supplies consented place search and resolution through the Worker; manual birthplace coordinates and time zone remain available.

### Time zones and uncertainty

- Coordinate lookup establishes the birthplace time zone, while historical time resolution and recorded qualifiers preserve normalization assumptions.
- Exact, approximate, and unknown birth times change which houses, angles, Moon claims, and other sensitive features may appear.

### Swiss Ephemeris compute service

- Despite its calc-stub directory name, this Node service invokes Swiss Ephemeris through sweph for real chart calculations.
- The authenticated service exposes chart, cycle, and daily-sky computation; normalized output includes tropical positions, aspects, calculation identity, and uncertainty.

### Shared factual inputs

- Natal features support Pattern selection; transit cycles supply timing and Daily inputs; daily-sky facts provide another distinct reading input.
- The Worker bounds birth calculation with a timeout and daily invocation budget, and persists calculation provenance with chart snapshots.

## Daily reading pipeline

### Reserve and schedule

- The current Today creation route explicitly requests constrained-model V5 generation for the user's confirmed local date and preferences.
- First opening and scheduled preparation converge through durable reservations; frozen commands pin chart facts, content versions, policies, and provider settings.

### Compile permitted context

- Context loading combines authorized source signals, previous readings, and structured feedback; deterministic rules enforce freshness, allowed uses, and packet limits.
- Feedback can inform repetition control and theme ranking under its source grant; it does not alter calculated astrology facts.

### Generate and validate

- Codex supplies a structured prose candidate; reading-engine validates output shape, selected evidence, citation-specific fact support, uncertainty, and content constraints.
- The Worker owns consent checks, budgets, retries, encryption, and publication; a model response alone cannot publish a reading.

### Publication and historical compatibility

- Published prose and paragraph evidence retain their source identity; owned history, feedback, save, and evidence endpoints expose reader functions.
- Historical V3 readings and deterministic assembly code remain supported; today's product generation does not fall back to that older pipeline.

## Pattern generation and ontology

### Select chart evidence

- Natal feature extraction and a versioned ontology feed deterministic evidence selection, defining eligible material before any Pattern prose is generated.
- Pattern commands bind chart fingerprints, consent, source revision, ontology, selection policy, and publisher pins to durable generation ownership.

### Plan, write, and verify

- Separate planner, writer, and semantic verifier passes produce a structured Pattern through guarded stages, bounded retries, and correction handling.
- Deterministic plan and candidate checks precede publication proof, source support checks, prohibited-claim screening, and removal of private evidence.

### Read, regenerate, and erase

- GET /v1/pattern serves generated Pattern documents; the older editorial catalogue remains preserved data outside the current product reader.
- Generation claims govern chart ownership, source-change regeneration, cancellation, and erasure; the interface exposes progress and eligible regeneration actions.

### Ontology preparation pipeline

- A registered corpus passes through generation, deterministic compilation, evaluation, regression, isolated signing, and ingestion into versioned ontology storage.
- The pipeline is implemented but its committed production rollout is off; ontology activation and public eligibility remain separate controls.

### Source provenance and rights

- Corpus records and integrity tooling preserve model-generated origin, rights decisions, fragment hashes, and attributable review for the supplied source material.
- The committed evidence is incomplete by its own account: 60 model-generated fragments, provider and model and generation time all recorded as unverified, zero certified fragments, an empty reviewer registry, and public activation listing five outstanding items.
- Rights classifications and source-supported labels do not establish independent authorship; hash and signature consistency is not completed human review or activation approval.

## Portrait and 3D observatory

### Images derived from chapters

- Eligible four-chapter Patterns can create private portraits; complete chapter source text guides native image generation without replacing the original document.
- Portrait state binds images to the owning account, chart, document revision, source text, and content hashes before serving them.

### Compiled and inspected 3D objects

- The runner authors a constrained geometry program from the image and chapter, compiles GLB assets, and evaluates four rendered inspection views.
- Worker and browser checks bind each model to its chapter, source image, source text, document revision, compiler provenance, and hashes.

### Interactive observatory

- The Three.js observatory builds one reading station per published chapter, three through six, with reading desks, object inspection, comparison, guided reading, and a chart-informed zodiac instrument.
- It is the default presentation of a matching published Pattern and needs no generated artwork: a chapter without a verified asset renders an authored reading folio in the same station.
- The observatory offers daylight and dusk, roof controls, object turns, desk interactions, and navigation through source-linked chapter passages.

### Complete reading and graphics recovery

- The full reading retains chapter perspectives, additional signatures, and uncertainty; unavailable, generating, failed, and unverified-artwork states discard the artwork and leave the reading standing rather than swapping in a separate view.
- Navigation preserves reading and camera state; reduced motion, low-power graphics, authenticated asset verification, and WebGL cleanup support the experience.

## Runtime and generation services

### Worker, web assets, and PWA

- apps/api runs the Hono Worker with HTTP, queue, and scheduled entry points; production configuration bundles the React web assets.
- API and control routes run before asset fallback; the PWA service worker caches shell assets and bypasses /v1 requests.

### Durable work and maintenance

- Dedicated queues carry Daily, Pattern, ontology, and privacy jobs; claim leases, idempotency, retry budgets, and cancellation checks coordinate execution.
- Scheduled maintenance prepares readings and recovers jobs, while separate ontology maintenance handles expired leases, undispatched work, and retained artifacts.

### Codex runner and host dependency

- apps/codex-runner polls the authenticated provider control plane, executes isolated ChatGPT-authenticated Codex jobs, and returns bounded outputs for Worker validation.
- Text generation, native portrait images, and compiled portrait meshes have distinct execution paths; image and mesh lanes require runner enablement.
- One process polls those lanes strictly in order, text first and meshes last, each checked only when the lane above it is idle, so distinct job types are not fair or parallel and sustained text work can delay artwork. This code is present in the repository; no installation or liveness on a host is claimed.

### Operator generation and repair

- Internal generation exposes operator action alongside automated scheduling: POST /internal/readings/reissue requires the live reading id and one revision reason drawn from a closed set.
- The revision reason distinguishes a safety correction or defect repair from an automated retry. It is frozen into the command and stored with the published revision, so the record states which kind of act produced it rather than leaving operator repair indistinguishable from scheduled work.

### Storage and isolated signing

- D1 stores account state, chart snapshots, permissions, readings, and durable job records; R2 stores releases and protected generation artifacts.
- A separate R2 replay ledger supports erasure recovery; ontology signing uses a service-bound Worker that holds its own signing keys.

### Committed production switches

- Source configuration enables hybrid Daily preparation, Pattern generation, portraits, meshes, and Geoapify; automated ontology generation remains switched off.
- New Daily and Pattern text generation select Codex with gpt-5.6-sol and xhigh reasoning; older adapters remain in source.
- These are committed settings only. They do not establish deployed secrets, runner health, an active ontology, applied migrations, granted consent, or which release production is serving.

## Identity and privacy

### Route authority zones

- Six authorities share one Worker: unauthenticated health, session exchange and deletion status; the product API behind authenticate and the account-state gate; service-token /internal; Cloudflare Access /admin; the runner's /codex-provider; and /crypto-operator for key maintenance.
- configGuard precedes every authority, and the product API mounts last so its wildcard middleware cannot reach the named zones. Each zone's credential must stay distinct: crypto-operator authority is deliberately neither service nor runner authority.

### Administrator inspection and audit

- Pattern administration is a Cloudflare Access boundary rather than a shared bearer: adminAuth validates the Access assertion against the configured team and application audience, then binds the verified subject to a short-lived hashed session.
- Every inspection declares exactly one purpose from a closed set and writes a pattern_admin_access_events row naming the admin subject, target account, scope hash, and generation. This is privileged access to generation evidence, recorded separately from ordinary reader access.

### Sessions and account state

- Auth0 OIDC sign-in exchanges identity proof for the Worker's secure, HttpOnly, SameSite Strict session cookie used by product routes.
- Account-state middleware restricts frozen accounts to recovery operations, preserving access to renewed calculation consent, export, and account deletion.

### Explicit processing permissions

- Account processing, Daily AI synthesis, Pattern generation, and geocoding have distinct consent policies; context sources carry their own allowed uses.
- Privacy controls expose source permissions and topic exclusions; revocation is rechecked by generation and publication paths before protected work proceeds.

### Protected personal payloads

- Envelope encryption uses AES-256-GCM and wrapped per-user data keys; Pattern content and generation artifacts have additional key ownership rules.
- Owner-scoped queries, private response projections, no-store headers, and restricted logging limit how personal content crosses storage and API boundaries.

### Export, deletion, and key maintenance

- Queued exports provide owned status and download routes; deletion progresses through artifact removal, row erasure, key destruction, and receipt access.
- Cryptographic operators use separate authentication and guarded maintenance routes; write fences coordinate key operations with concurrent account and generation work.

## Contracts, content, and verification

### Schemas and ordered migrations

- Frozen baseline contracts and additive Daily, privacy, Pattern, history, portrait, and mesh schemas define wire formats alongside OpenAPI and fixtures.
- Ordered D1 migrations evolve operational tables; shared TypeScript packages carry wire types, canonical identities, fingerprints, and protocol definitions.

### Signed editorial release delivery

- Internal content ingestion verifies signed WordPress bundles, validates their content graph and object hashes, and stores immutable artifacts.
- A bundle declaring scenario fixtures is held at accepted_pending_tests with the active pointer unmoved, because this route cannot evaluate declared fixtures and reports every one of them as pending. Only fixture-free releases can activate.
- Legacy editorial Pattern content remains preserved; draft candidate files are outside runtime delivery, and mounted product handlers precede legacy stubs.

### Pure engines and licensing boundary

- reading-engine and pattern-engine isolate deterministic product rules from network and storage access; shared contains the cross-service wire vocabulary.
- The Swiss Ephemeris service declares AGPL-3.0-or-later while packages/shared declares UNLICENSED pending the boundary decision, so the repository records that question as open rather than settled.

### Release assurance tooling

- scripts/pattern-release/ holds distinct harnesses beyond the release builder: fresh reading, fresh Pattern, and verifier evaluation, plus an operational canary, release-evidence assembly, and release reconciliation, each with its own tests.
- They are offline by construction — release-evidence cannot deploy or certify a provider account, and reconciliation makes no platform, provider, or database call. Their presence in the repository is not a record of any having been run.

### Local verification and release gate

- Repository checks cover TypeScript, workspace tests, calculation goldens, schema fixtures, OpenAPI, D1 smoke checks, content integrity, and production build preparation.
- ci:local is the documented procedural merge gate, not an enforced one: main is unprotected and returns no rulesets, so nothing mechanical blocks an unverified merge.
- Merging main triggers the separate Cloudflare build system, and a triggered build is not a successful production release.
