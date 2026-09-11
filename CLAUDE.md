# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the style/PR conventions and is still authoritative for those; this file covers architecture and the invariants that span multiple files.

## Commands

Run from the repository root. Use the Node 22 pinned by `.nvmrc` (the package engine floor is `>=22`) and Python 3.11+ with `pip install jsonschema referencing pyyaml openapi-spec-validator -r spec-bundle/render_v0_5.requirements.txt`.

```bash
npm install
npm run typecheck          # strict tsc --noEmit across every workspace
npm test                   # all eight workspaces, then test:content and test:contracts
npm run test:contracts     # python: deterministic spec rendering + JSON Schema/fixture validation + D1 SQL smoke apply
npm run build              # all eight workspaces in order; web assets before the API production dry-run
npm run ci:local           # the merge gate — GitHub Actions does not run; see below

npm run calc:dev           # calc service      :8080
npm run db:local -w @patternlike/api   # apply the ordered db/d1 migrations to local D1
npm run dev:api            # Wrangler Worker   :8787
npm run web:dev            # Vite PWA          :5173 (proxies /v1 → :8787)
```

Single tests:

```bash
npm test -w @patternlike/api -- src/routes/birth.test.ts   # vitest; also -t "name"
npm test -w @patternlike/web -- src/components/Onboarding.test.tsx
npx tsx --test src/aspects.test.ts        # from apps/calc-stub or packages/shared (node:test)
npm run calc:golden                        # Swiss Ephemeris golden fingerprints only
```

`@patternlike/calc-stub`'s `pretest` runs `scripts/download-ephe.mjs`, which fetches ephemeris data pinned by commit + SHA-256 in `apps/calc-stub/ephemeris.lock.json`. First test run needs network.

There is no linter or formatter — `npm run typecheck` is the only mechanical style gate.

**GitHub Actions is unavailable on this account** — every run fails with a
billing lock, and that is not expected to change. `main` is not branch protected
either, so nothing mechanical stops an unverified merge. `npm run ci:local`
(`scripts/ci-local.sh`) is the replacement gate: it mirrors
`.github/workflows/ci.yml` step for step on the `.nvmrc` Node and prints a
summary to paste into the PR. It needs Node 22 via `nvm` and a repo-local
`.venv`; see `AGENTS.md` for the one-time bootstrap, which is not a plain
`pip install` because this host's Python is externally managed with no
`ensurepip`. The script also covers `pattern-engine`, `codex-runner`, and
`test:content`, three lanes `ci.yml` never listed.

Cloudflare Workers Builds is a **separate** system and is unaffected by the
billing lock, so merging to `main` still deploys. The lost CI removed the check
on a merge, not its consequences — which is why a migration must be applied
remotely *before* the merge that deploys the code reading it. A push to `main`
builds and deploys within about a minute, so "before the merge" means before
the push, not merely before an operator deploy step.

## Architecture

Eight workspaces (`apps/*`, `packages/*`), one product request path plus an isolated signing sidecar and installed runner:

`apps/web` (React 19 + Vite PWA) → `apps/api` (Hono on Cloudflare Workers, D1) → `apps/calc-stub` (Node + Swiss Ephemeris, AGPL, deployed to Fly). The calc binding is plain HTTP (`CALC_SERVICE_URL` + optional `CALC_SERVICE_AUTH_TOKEN`) so the runtime can move without touching contracts. `apps/ontology-signer` is not on that path: the API reaches its `signOntology` RPC through the `ONTOLOGY_SIGNER` service binding. `apps/codex-runner` polls the separately authenticated provider control plane. `packages/shared` holds wire types and shared primitives; `packages/reading-engine` and `packages/pattern-engine` hold deterministic Daily and Pattern rules.

`contracts/m0/` is the frozen baseline (JSON Schema + OpenAPI + valid/invalid fixtures); additive contract packages under `contracts/` extend it without changing frozen wire identities. `db/d1/0001_m0_core.sql` is the core schema and later files in the ordered migration directory extend it. Product-spec v0.2 remains the baseline and v0.5 restates the daily-reading contract; Your Pattern is defined by `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md` as amended by `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md` and `docs/superpowers/specs/2026-08-29-pattern-source-regeneration-design.md`.

### Worker routing

`apps/api/src/index.ts` mounts sub-apps deliberately: a Hono router mounted at `"/"` contributes its `use("*", …)` middleware to **every** path in the parent. That is why `configGuard` is attached to the two `/v1/sessions` paths directly, and why the service-token router is mounted under `/internal` rather than `/`. Adding a router with wildcard middleware at `"/"` re-introduces the bug.

Order on the product API is `configGuard` → `authenticate`. Reading feedback and the M4/M6 privacy surfaces have real handlers. `routes/stubs.ts` is mounted last and contains only legacy fallback registrations shadowed by those handlers; do not use it as a feature-status inventory.

The default export is `{ fetch, queue }`, not the Hono app — tests that drive it with `app.request()` import the named `app` export instead. **A queue message never enters the Hono pipeline, so `configGuard` does not run on it**; `src/queue.ts` calls `checkSecureConfig` itself. Deleting that call would leave the one surface that decrypts a frozen command and writes a user's prose as the only surface a development-shaped deployment could still run.

### Daily reading generation (M3 phase 4)

Two transactions, never one. **Enqueue** (`services/enqueue.ts`) freezes every input into a `GenerateDailyReadingCommandV1`, stores it DEK-encrypted in `jobs.payload_enc`, reserves a `pending` `daily_readings` row pointing at that job, and only then sends an opaque `{job_id, reading_id}`. **Execute** (`services/generate-daily-reading.ts`) claims the job by CAS, dereferences only the versions the command pinned, and publishes in one guarded batch. Queues is at-least-once, so nothing on the execute path may resolve "today" or "active" again — a retry that did would produce different prose under the same `assembly_id`.

- The D1 job row is the **durable outbox**; the queue is a nudge. `dispatched_at` is advisory, `POST /internal/readings/sweep` re-sends what committed but never went out, and a zero-row claim does no work. No code treats a send response as proof of anything.
- `assembly_id` is computed by *running* `assembleReading` and hashing `identity_canonical`, at enqueue and again at execute. Calling `buildAssemblyIdentity` directly would re-implement the eligibility partition the assembler applies internally, and drift would surface on a real reader's reading rather than in a test.
- Conditional aborts inside a batch use the `assertion_probe` table (`0002:50`), whose only column is `CHECK (id = 0)`. `completeReading` opens *and closes* with one: a guarded `UPDATE` that merely affects zero rows would let later statements commit anyway.
- Generation is withheld while `users.timezone_source` or `locale_source` reads `default_unconfirmed`. `PUT /v1/preferences/{timezone,locale}` are the only writers; a `device_derived` write over a `user_confirmed` value is `409 preference_locked`.
- The scheduler may replace its own terminal failure only for `calc_unavailable`/`release_unreadable`, only while `command_generation < 3`, and only for the current or preceding local day. Everything else is operator-only.
- `cyp_` pass ids and `cyclePin.cycle_hash` are derived in the Worker (`packages/shared/src/cycle-types.ts`), keyed on the parent `cyc_` because `oriented_branch`/`winding` never leave the calc service. `cycle_hash` deliberately excludes `importance_score`. Contract: `contracts/m3/cycle-derivation.schema.json`.
- `persistCycles` is `INSERT OR IGNORE` throughout. A refined rescan does **not** overwrite a stored envelope — the pinned `cycle_hash` fails the claimed job closed instead, which is a state an operator can see.
- `CYCLE_POLICY_ID`/`VERSION` and the orb policy pair live in `@patternlike/shared` and are re-exported by `apps/calc-stub/src/cycle-policy.ts`. Calc refuses any request naming a policy it does not implement, so a second hand-copied pair would turn a version bump into a silent scan refusal on every reading.

### Your Pattern and Time Travel (M4)

`contracts/m4/` is the additive `0.4.0` package. `POST /internal/content-releases` dispatches on `schema_version` through an explicit bounded map in `services/content-release.ts` — `0.3.0` → M3 schema, `0.4.0` → M4 schema, anything else fails closed **before** hashing, signing, R2, or D1 work. There is no fallback to the M3 handler; adding one would let an M4-shaped body reserve an immutable release version under a contract it was never checked against.

**The M4 editorial catalogue is preserved data, not a product path.** Releases still ingest and still verify, but no reader reaches them: `GET /v1/pattern` hands every authenticated account to `serveGeneratedPattern` (M7), and the admission decision that could route a reader onto matched chapters is gone. The paginated M4 reader contract went with it — its cursor, its `limit`, and its omission counters have no caller, and `pattern_release_not_active`, `pattern_cursor_stale`, and the Pattern `release_unreadable` no longer exist in runtime source. `services/pattern-content.ts` and `services/pattern-matcher.ts` are likewise callerless outside tests. What remains true is that **no code path reads `content/pattern-candidates/`** — draft prose is never a runtime fallback, and `scripts/pattern-release/build.test.mjs` asserts it by scanning every runtime source.

- **Canonical aspect-pair order is `LAUNCH_BODIES` rank, not alphabetical.** `canonicalAspectPair`/`isCanonicalAspectPair` in `@patternlike/shared` is the one definition; the feature derivation, the matcher, the release narrower, and `scripts/pattern-release/candidates.mjs` all use it. The frozen contract settles the question — `contracts/m4/fixtures/invalid/natal-feature.aspect-noncanonical.json` is `{body_a: "moon", body_b: "sun"}`, so a `[a, b].sort()` anywhere writes exactly the shape the contract rejects. Changing this changes every `nft_` id and every feature-set hash.
- `natal_features` rows are meaningless without a `natal_feature_sets` receipt. `POST /v1/birth-profiles` writes them eagerly *after* the chart commits and swallows the failure (`natal_feature_cache_write_failed`); `ensureNatalFeatureSet` repairs the same receipt lazily from Pattern enqueue and execute, which is where the read moved when the M4 reader path was removed. Concurrent derivations converge on one receipt only when the set hash is identical — a different hash under the same chart and policy fails closed.

Time Travel never touches `cycle_instances` or `cycle_passes`. Its only durable state is `cycle_scan_receipts`, keyed on the lookup tuple in `0005` — including `local_date`, `scheduling_timezone`, and `receipt_epoch`.

- `TIME_TRAVEL_RECEIPT_EPOCH` is a required positive integer under `configGuard`. An operator bumps it before any calculation-container, ephemeris, policy, or defect change that can alter results; an unchanged epoch keeps serving its cache by design. `persistScanReceipt` refuses when one epoch would span two container/ephemeris vintages, which is what surfaces a forgotten bump.
- Race convergence compares the **semantic** result hash — JCS over the validated response with `request_id` removed. `raw_response_sha256` is retained for audit and is deliberately not what convergence is decided on.
- `TIME_TRAVEL_DAILY_SCAN_LIMIT` is pinned to `32`. `reserveScanBudget` reserves all misses (0, 1, or 2) or none, before any outbound call, and never refunds — the bound is on calculation spend, not on success. Receipts are capped at 256 per user and the usage ledger at 35 UTC days, both pruned inside the same batch that writes.
- The `/v1/cycles` request carries normalized natal longitudes, accuracy, suppression flags, policy identity, and a window. Nothing else: no user id, no chart id, no zone, no saved context.

USR-09 Life-event timeline is a **separate consent** from USR-06, granted only `["time_travel"]`. Both ride M0's frozen `contextSourcesDocument`; `PUT /v1/context-sources` is a one-source compare-and-set on both the document's and the source's `updated_at`, and an omitted source is untouched rather than disabled. Events live in `context_signals` under the existing per-user DEK — no new encrypted column, so `ENCRYPTED_COLUMNS` already covers them. `normalized_hash` is salted from a random value stored *inside* the ciphertext, and `buildAccountExport` strips `hash_salt` from **both** sources before it writes. Pause/resume mints a new `consent_id`; Time Travel follows `supersedes_consent_id` so events written under the prior grant reappear after resume, and stay hidden while the source is paused or revoked.

`services/deletion-manifest.ts` now classifies every directly user-owned table as portable or non-portable in addition to deleted or retained. `natal_feature_sets`, `cycle_scan_receipts`, and `time_travel_daily_usage` are non-portable derived or operational state; a new user-owned table missing from either list fails `deletion-manifest.test.ts`.

### Daily claim support (validation policy 1.1.1)

Daily prompt `1.0.3`, selection policy `1.1.0`, and validation policy `1.1.1` preserve role-bearing calculation records internally. `packages/reading-engine/src/claim-support.ts` matches each factual sentence against a bounded English grammar and one cited record: participant/frame, placement, measured natal orb versus configured cycle orb limit, UTC event role, and collective scope. Reflection uses separate sentences; there is no general psychological entailment claim. Whole uncertainty disclosures also use bounded, evidence-matching forms. Old stored readings remain historical records; queued commands with old pins fail `policy_unsupported` rather than executing new semantics under an old identity. Public/provider JSON shapes are unchanged. The synthetic evaluation corpus `1.1.0` retains prior candidate strings and labels changed acceptance; it is not a fresh provider sample.

Constrained-model Daily publication also writes one success-only,
content-free `daily_publication_receipts` row in the same guarded D1 batch as
the encrypted reading and succeeded job. It binds the exact job/stage and
executed model, prompt, effort, request/response hashes, token counts, provider
completion time, declared release SHA, and Cloudflare version id without a user
id, prose, chart fact, local date, consent, or provider request handle.
Deterministic V1 supplies `null` and requires zero receipts. Migration support,
application of that migration, deployed release metadata, installed runner,
provider execution, and an active reader lifecycle are separate evidence
layers; [`docs/deploy/release-attestation.md`](docs/deploy/release-attestation.md)
defines the release boundary.

### AI Pattern generation (M7)

The M7 Pattern path is planner → deterministic plan validation → writer → deterministic candidate validation → separate semantic verifier → shared deterministic publication safety → guarded publication. Pattern is **account-wide**: `PATTERN_AI_ROLLOUT` and `PATTERN_INTERNAL_ACCOUNT_IDS` were removed, so there is no rollout variable, cohort, or allowlist, and `wrangler-config.test.ts` asserts the variable stays absent. Committed configuration declares `PATTERN_PUBLISHER = "codex"`. That declaration is not evidence of the deployed binding, credential health, ontology activation, or a completed canary; `docs/deploy/openai-pattern-rollout.md` records the separately observed live state.

`PATTERN_GENERATION_ENABLED=0` is a reversible operational pause for every account. It stops new claims, execution and publication while preserving accepted reads, deletion and valid leased provider completions. Missing or `1` preserves enabled behavior; invalid values fail closed. See `docs/deploy/pattern-generation-pause.md` for deployment and resume boundaries. `READING_V5_ROLLOUT` contains Daily only.

- **The provider boundary is a runtime allowlist, not a TypeScript promise.** `services/pattern-packet.ts` rebuilds planner, writer, and verifier documents field by field, serializes them, then walks the serialized value through `findPatternInputViolation`. Do not spread a wider object or remove the post-serialization walk: TypeScript permits a wider variable to flow into a narrower parameter, and `fact` is deliberately open. TypeScript and the Python contract validator consume the versioned deny bytes in `contracts/policies/pattern-provider-boundary-v1.json`; update that policy rather than duplicating keys or opaque-id prefixes. No chart/user/consent identifier, birth value, source fragment, prior reading/Pattern, journal, check-in, life event, or alias map may cross this boundary.
- **Pattern serves from an authored ontology, and that is a decision, not a gap.** `ontologyServesAccount` in `db/pattern-ontology.ts` admits `provenance.origin === "synthetic_internal"` on origin alone; only the `machine_pipeline` branch additionally requires `activationScope === "public"`. Do not "restore" this to machine-only. The dated runbook records failures at candidate validation, coverage, record policy, configuration, regression safety, deadline, quota, and pass-ceiling boundaries; it does not show that every candidate reached regression. Account, chart, confirmed locale, current consent, generation pause, and claim gates still apply. The origin is enumerated rather than defaulted so a third origin added later fails closed until someone decides what assurance it carries.
- **Authored admission and document safety carry different evidence.** An authored release still skips the machine evaluator and release regression corpus. Every newly published Pattern, from either admitted origin, now runs `evaluatePatternPublicationSafety` under policy `1.0.0`; the regression harness reuses it. The shared categories are `suppressed_feature_leak`, `uncited_astrological_claim`, `source_dependency_failure`, `prohibited_claim`, `mandatory_feature_omission`, `private_projection_leak`, and `semantic_refusal`. Checks cover titles, summaries, signatures, and uncertainty text as well as sections. Source dependencies resolve against verified registered corpus bytes; missing corpus evidence fails publication. These bounded deterministic checks supplement the semantic verifier and do not establish arbitrary prose entailment or certify an entire ontology release. The supplied 60-fragment corpus is model-generated first-party material: `licensed_excerpt` records asserted rights, and `source_supported` is consistency with fixed material, not independent authorship. `pattern-corpus/provenance.json` preserves unknown generation details and incomplete human certification.
- **The machine ontology pipeline is parked, and shrinking its regression gate is a trap.** `ONTOLOGY_PIPELINE_ROLLOUT = "off"` in committed production configuration; `build-internal-ontology.ts` supplies ontologies instead. If someone reopens the pipeline: `ONTOLOGY_REGRESSION_FIXTURE_COUNT` is duplicated as a hardcoded `30` inside the frozen command's *literal type* (`ontology-pipeline-command.ts`) and again in `commandIsExecutable`, and the 30 fixture documents are statically imported by **two** files — `ontology-regression.ts` and `ontology-regression-report.ts` — each with its own list. Changing the constant alone fails `loadOntologyRegressionCorpus` on a length mismatch. Keep all thirty frozen fixtures. No fixture reduction or new minimum is authorized; the previous minimum-seven claim was not verified.
- **Provider schemas are derived, never copied.** `services/pattern-prompt.ts` imports the frozen M7 schemas and `toStrictProviderSchema` strips only `minLength` and `maxLength`; every other keyword is checked against the closed supported set. The Worker validators still enforce the stripped bounds. A model-tier change requires a fresh `publisher:pattern:model:verify` run proving the compiled model exists and accepts the retained `pattern` keyword.
- **Q1 uses inclusive, differently scoped ceilings:** at most 2 planner calls per job, 3 writer calls per job against one frozen plan, and 2 verifier calls per candidate. The worst case is `2 + 3 + (3 × 2) = 11`, not 7 or 14. `isPatternCommand` validates the frozen maxima, each pass checks its zero-based next-attempt index before any provider call, and the `advance` transition into `semantic_verifying` resets `verifier_attempts` for the new candidate.
- **The durable stage machine is one pure function.** `planPatternTransition` in `services/pattern-stage-protocol.ts` maps `(current row, transition)` to the next `pattern_generation_jobs` row plus the job-level effects; `buildPatternTransitionStatements` turns that into `{guards, mutations}` and `commitPatternTransition` batches them. The transition *kinds* — `advance`, `retry`, `return_to_writer`, `publication_retry`, `fail`, `cancel`, `publish` — are the vocabulary; there are no per-transition helper functions to call instead. `planPatternTransition` throws on a terminal input, so any caller that reaches it with an already-terminal row must decide what still has to run: `failExhaustedPatternJob` in `services/pattern-sweep.ts` drops only the domain-stage statement and still commits the `jobs` repair and the claim release, because the expired-lease selector filters on the `jobs` row alone.
- **No transition writes the counter of the pass whose result it is committing.** Every counter write commits in the same guarded D1 batch as the transition that authorizes the next call. The `advance` kind commits success without incrementing that pass; the `retry` kind increments the same pass for a genuine retry; the `return_to_writer` kind crosses from verifier to writer and increments `writer_attempts`, not `verifier_attempts`. Do not summarize this as “`retry` is the sole incrementer.”
- **Artifact-first adoption depends on that counter rule.** Provider request/response identity is `(generation_id, artifact_class, stage_generation, attempt)` via `patternArtifactId`. Every pass calls `getArtifactAt` before budget reservation or fetch; a crash after the create-only response write therefore reuses the same attempt coordinate and spends no second call. Changing a success transition to increment its pass counter would silently defeat adoption.
- **Publication accepts one narrow proof, not an orchestrator-sized argument list.** `services/pattern-publication-proof.ts` rereads fact-packet, planner, validated-plan, writer, and current verifier-attempt artifacts, recomputes their hashes, binds them to the durable job and frozen executed writer pin, and builds the exact document/public projection before checking shared safety. `PatternPublicationProof` includes the candidate and safety-result hashes; `compact_provenance_json.publication_safety` retains the receipt. The publication batch rechecks account, active chart, confirmed locale revision, exact current Pattern consent, non-recalled ontology, reserved claim ownership, and running job before it inserts the document, accepts the claim, and succeeds the job. Safety rejection follows bounded correction/terminal transitions and preserves the prior readable document during failed source replacement.
- **Live claim transitions have one repository and a D1 backstop.** `db/pattern-claim-transitions.ts` is the only live writer for reserve, release, accept, delete, supersede, and withdraw. Migration `0019_pattern_claim_transition_guards.sql` rejects shortcuts, consumed-claim reopening, terminal-reason changes, identity mutation, and consumption timestamp rewrites. Replay remains the explicit recovery exception, but it advances an existing row through legal forward edges.
- **Pattern administration is a Cloudflare Access boundary.** `/admin/*` validates `Cf-Access-Jwt-Assertion` against the configured Access team certs and dedicated application AUD on every request, binds the verified subject to a short-lived hashed `pl_admin_session`, requires a closed audit purpose, and never accepts the retired shared administrator bearer. Migration `0020_pattern_admin_sessions.sql` must precede the compatible Worker.
- **Executed provenance is checked, not trusted.** `runPublisherPass` rejects metadata whose provider, pass, model, or prompt version differs from the frozen pin, and `provenanceFromExecutedPin` maps only the closed compiled writer-model allowlist into public `model_family`.
- **Q3 keeps the frozen `assembly_mode: "constrained_model"`.** Synthetic stand-ins do not add a second wire value. `resolvePatternPublisherConfiguration` refuses `PATTERN_PUBLISHER=synthetic` outside development, `checkSecureConfig` runs on product requests and in `queue()`, and `projectPublicPattern` reasserts the contract literal. A synthetic-authored document must remain structurally unreachable in a reader-serving environment.

### Pattern portraits

The Pattern surface (`#pattern`) opens its observatory by default for published Patterns with three to six chapters, using local reading folios until verified optional artwork is available. Complete reading and observatory presentation do not depend on artwork-generation eligibility, flags, or automation consent. See `docs/reviews/2026-09-08-default-pattern-observatory.md`.

Two D1 artwork pipelines share that surface. Images (`0026`, `PATTERN_PORTRAIT_ENABLED`) write four `pattern_portrait_jobs` claimed at `/codex-provider/v1/portraits/*`. Meshes (`0027`, `PATTERN_PORTRAIT_MESH_ENABLED`) write `portrait_mesh_jobs` claimed at `/codex-provider/v1/portrait-meshes/*`. Image creation requires the exact flag `"1"` and `ARTIFACTS`; mesh enablement additionally requires its own flag. Default wrangler `[vars]` omit both flags, while `[env.production.vars]` sets `"1"`. `PATTERN_GENERATION_ENABLED` does not gate these artwork pipelines.

Portrait work uses D1 job rows rather than a Cloudflare Queue binding. The runner polls text → image → mesh, one claim at a time; `maintainPortraits` / `maintainPortraitMeshes` on the `*/15` lane recover leases and drain `portrait_start_outbox`. Artwork creation still requires an accepted four-chapter Pattern and live `account_processing` and `pattern_generation` grants. The request validates `consent_policy_version: "1.0.0"` and `confirm: "CREATE MY PORTRAIT"`; these do not create a new consent kind. Automation is a separate per-chart grant at policy `1.1.0`. Disabling automation cancels unfinished/future work; source and account access checks still govern retained artwork.

Assets encrypt under the accepted Pattern document content key (`patternlike.portrait` / `patternlike.portrait-mesh` AAD), not the user DEK. All seven portrait tables are user-owned for deletion; downloads are non-portable. `gpt-image-2` is the configured image-tool pin — not a provider-observed model identity. See `docs/deploy/portrait-image-model-provenance.md` and `apps/codex-runner/README.md`.

### Reading History and Save

`GET /v1/readings?view=history|saved` has no separate feature flag; existing authentication and ownership checks apply. Saves are revision-specific `(user_id, reading_id)` rows from `0028`; they hold no ciphertext. `PUT /v1/readings/:id/save` requires an empty body. The authenticated `DELETE` handler returns `204` even when the save does not exist. Only `published|superseded|invalidated` rows with `reading_enc` are saveable. Account deletion deletes `reading_saves` before `daily_readings`. After saves exist, a rollback must keep Save-aware deletion.

### Isolated ontology signing

`apps/ontology-signer` holds `PATTERN_ONTOLOGY_SIGNING_KEY`. The API Worker `Env` has no such field; it only has the `ONTOLOGY_SIGNER` service binding. The signer has no public route and no D1/R2/provider/corpus binding. Its default `WorkerEntrypoint` includes only the platform-required `fetch` handler, which always returns an empty 404, plus the `signOntology` RPC method. Deploy it *before* any API deploy that declares the binding, or the API upload fails on an unknown Worker.

**The offline internal-origin path is supported.** The dated September 6 active-pointer/hash observation is linked in the runbook; it is not a fresh activation or signature check. `signInternalOntology` (`services/ontology-signing-client.ts`) is a *sibling* of `signOntologyCandidate` (in the same file), not a relaxation of it. The machine function's refusals — machine origin only, candidate status only, evaluation report hash required — are the machine path's contract; widening them so one function served both origins is how a synthetic release eventually gets signed as a machine one. Keep them separate. What the sibling retains is the part that matters: canonical payload, bundle hash recomputed rather than trusted, and the isolated signer as the only key holder. `POST /internal/pattern-ontology-releases/sign` signs and returns; it does **not** ingest, because activation stays with the existing route that owns immutability, recall, and the guarded pointer flip. `scripts/build-internal-ontology.ts` derives the records from the registered `licensed_excerpt` corpus, every one `source_supported` and citing its exact fragment. The unsigned builder produces 40 records from 60 prepared fragments, skipping all twelve §2 sign fragments and all eight §8 cross-cutting fragments (no builder mapping). Sign fragments are skipped because `PatternFeaturePredicate` has `body`, `aspect`, `angle`, `house` and `accuracy` and no `sign`, so a sign record could only attach to every position indiscriminately — widening that is a contract change. Sentence matching and proposition fallback are traceable transformations, not editorial adjudication. The synthetic evaluation fields are compatibility metadata: compilation actually runs, but `evaluator_passed=true` and `unevaluated_fixture_count=0` do not prove independent evaluation, while `regression_passed=false` records the absent rehearsal. Neither signing path certifies quality.

Machine ingestions (`provenance.origin === "machine_pipeline"`) compile, verify the signature over the original **candidate** bytes, decrypt the evaluation artifact with `ONTOLOGY_PIPELINE_ARTIFACT_KEYRING`, and only then write. R2 stores those candidate bytes byte-identical; activation is the D1 status/pointer flip in one guarded batch. `regression_passed` / `regression_report_hash` may ride the frozen contract and even be signed — they do not admit or block a release. Missing or malformed artifact-keyring configuration is `503`, not a 409 about the release.

`db/d1/0011_ontology_pipeline_evidence.sql` is the terminal evidence receipt used by machine ingestion (0009/0010 remain reserved for the adapter). `loadActiveOntology` LEFT JOINs that table, so apply 0011 before shipping the Worker that reads it. Bookmark and export first, same as 0002/0008. The repository now contains the automated writer and verifier; that engineering does not establish that 0011 is applied or that a receipt exists in production.

### Sign-in

Auth0 authenticates; the Worker authorises. `apps/web/src/main.tsx` mounts the
official `@auth0/auth0-react` provider, and `App` uses `useAuth0()` for Universal
Login, callback completion, raw ID-token claims, and Auth0 logout. After a
successful callback, `apps/web/src/lib/auth.ts` trades the one-shot encoded
`id_token` for a `pl_session` cookie via `POST /v1/sessions`.

The provider may check the Auth0 session when it initializes, but Auth0 state
never grants access to product data. The Worker cookie remains the source of
truth for “am I signed in”, answered by calling the API and watching for a 401.
Auth0 caching remains in memory and refresh tokens remain disabled; the browser
does not persist issuer tokens.

The `VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID` defaults in `auth.ts` must stay in
step with `OIDC_ISSUER`/`OIDC_AUDIENCE` in `apps/api/wrangler.toml`. A mismatch
is a flat browser 401; detailed token-verification reasons remain server-only.

`identities.provider` stores the **issuer string itself**, and lookups are `WHERE provider = ? AND provider_subject = ?`. Changing `OIDC_ISSUER` therefore orphans every existing account — new user id, new crypto subject, old ciphertext unreadable. The tenant is currently a `dev-` one; migrating to production must happen before the first real user.

### Fail-closed configuration

`middleware/config-guard.ts` returns `503 configuration_error` on every request when the deployment looks development-shaped outside development: `AUTH_STUB=1`, a missing/placeholder `ROOT_KEK`, or `OIDC_ISSUER`/`OIDC_AUDIENCE`/`OIDC_JWKS_URL` still pointing at `issuer.invalid`. Workers have no startup hook with bindings, so per-request refusal is the substitute for failing boot. `isDevEnvironment()` treats `ENVIRONMENT` of `development` **or** `test` as development — never name a staging deployment `test`. `wrangler.toml`'s top-level `[vars]` is the dev block; `[env.production]` sets `AUTH_STUB = "0"` — explicitly off rather than omitted, because omitting it made wrangler warn about the missing var on every production deploy and that noise masks a genuinely forgotten one. Only `"1"` enables the stub. `npm run deploy` always passes `--env production`, and so does `@patternlike/api`'s `build` dry-run: a bare `wrangler deploy --dry-run` validates the *dev* block, so it can never catch a production-only config error, and it trips Workers Builds' Worker-name check — whose offered remedy is a PR renaming the top-level worker to `patternlike-api-production`, which would attach the production name to the `AUTH_STUB`/`issuer.invalid`/placeholder-D1 block. Reject that PR. Because the production dry-run reads `[env.production.assets]`, the root `build` script must build `@patternlike/web` before `@patternlike/api`.

`apps/calc-stub` mirrors this: `/v1/calculate` returns 503 without `CALC_SERVICE_AUTH_TOKEN` in production and 401 on a bad token, while `/health` and `/v1/engine` stay public for health checks. `SE_LICENSE_MODE=pending` refuses to boot.

### Envelope encryption (the tightest constraint in the repo)

`ROOT_KEK` → HKDF-SHA256 → KEK → per-user DEK (AES-256-GCM), in `apps/api/src/crypto.ts` and `src/db/users.ts`.

Key maintenance is exposed only at the sibling `/crypto-operator/*` namespace
through `CRYPTO_OPERATOR_TOKEN`. It must never be mounted below `/internal` or
`/admin`, and that token must not equal service or Codex-runner authority.
`ROOT_KEK_KEYRING` gives each root key an immutable id while legacy
`ROOT_KEK` remains a migration fallback. Every batch committing newly sealed
user-DEK bytes must prepend `buildCryptoWriteFence` with the exact sealing key
version. Use `scripts/crypto-operations.mjs` and the runbooks under
`docs/deploy/`; never pass root secrets as CLI arguments.

- `users.crypto_subject` (`cs_*`), not `users.id` (`usr_*`), is the AEAD/DEK subject. `id` is a mutable public label; the subject must never change once ciphertext exists. `asCryptoSubject()` is the only string→`CryptoSubject` conversion and must only be fed a value read from the row or freshly minted — never a request header.
- Every payload's AAD binds `(subject, "table.column", recordId, key_version)`; every wrapped DEK binds `(subject, key_version)`. Moving a blob between rows, columns, or users fails authentication even with the right DEK.
- Bumping `AEAD_VERSION` or `KEK_DERIVATION_VERSION` makes existing ciphertext unreadable. `db/d1/MIGRATIONS.json` records each such break in its `notes`.
- **A new encrypted column must be added to `ENCRYPTED_COLUMNS` in `apps/api/src/db/users.ts`**, or DEK rotation leaves its data under a destroyed key. `rotateUserDek` throws when it finds ciphertext outside that list.

### D1 migration policy

M0 is pre-production, so `0001_m0_core.sql` is edited **in place** rather than superseded. Every statement is `CREATE TABLE IF NOT EXISTS`, so re-running it over an existing local database changes nothing and still exits 0. After any schema or crypto-version change, delete and recreate:

```bash
rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api
```

### Tests

`apps/api` runs inside workerd via `@cloudflare/vitest-pool-workers`: `SELF.fetch()` drives the real Hono app against a real local D1 seeded from `db/d1/` by `test/apply-migrations.ts`. All outbound fetches — including `invokeCalc` — are intercepted by `test/mock-calc-service.ts`, so tests are hermetic. Storage is **not** isolated per test in this pool version; `resetDb()` in `test/helpers.ts` deletes from an explicit FK-ordered table list, and a table missing from that list leaks rows between suites. Portrait tables, `reading_saves`, and `daily_publication_receipts` are already on that list — keep new user-owned tables in the same commit as the migration and `deletion-manifest.ts`.

Because `X-User-Id` names a user rather than creating one, every API test must `seedUser()` first — the `users` row, its `identities` row, and its wrapped DEK land together. `confirmPreferences()`, `seedChart()`, and `seedActiveRelease()` supply the rest of what generation needs; a test that skips `confirmPreferences` gets a correct `timezone_confirmation_required` refusal rather than a reading.

`resetDb()` unwinds the `daily_readings` revision chain leaf-first. It cannot null `supersedes_reading_id` to break the self-reference any more: 0002's revision CHECK requires a non-null predecessor whenever `revision > 1`, so clearing it fails the constraint.

Queue handlers are driven with `createMessageBatch` + `getQueueResult` from `cloudflare:test`, calling the worker's `queue()` export directly. `test/mock-calc-service.ts` answers `/v1/cycles` as well as `/v1/calculate`; the `CYCLE_FP_*` sentinel fingerprints steer it, because a cycle request carries no birth data to hang a trigger on.

## Domain invariants

- **Unknown birth time**: noon is a computation epoch only. It is never stored as the birth instant, and houses, angles, and time-sensitive Moon claims are suppressed whenever no real birth time was supplied — regardless of the `accuracy` label the caller sends (`engine.ts` recomputes an effective accuracy). `birth_time_local` is required for `exact` and `approximate`; the API rejects otherwise.
- **Idempotency** is scoped per user (`uq_jobs_scope_key` over `COALESCE(user_id,'')`). A failed job row is reused, not re-inserted. Identical birth data under a new key returns `409 chart_already_exists`, not a 500 from `UNIQUE(user_id, fingerprint)`.
- **Chart PII**: `GET /v1/chart` returns positions/houses/angles/aspects/uncertainty but nulls every birth field — the birth instant and coordinates stay encrypted at rest.
- **Error envelope**: every response is `{ error: { code, message, request_id, details? } }`. Upstream calc messages have leaked absolute filesystem paths, so only `invalid_birth_profile` is echoed to the caller; everything else is logged and returned as a generic `calc_failed`/`internal_error`.
- **Swiss Ephemeris pins**: 2.10.03 via `sweph@2.10.3-7`, `SEFLG_SWIEPH | SEFLG_SPEED`, Placidus with Porphyry fallback, true node, data valid 1800–2399 (outside that range → `invalid_birth_profile` before reaching the engine). Golden fingerprints must stay deterministic.
- **Ephemeris coverage is bounded on the instant, not the year**. `EPHEMERIS_MIN_YEAR`/`MAX_YEAR` read a *local* date, which does not determine the UT instant that reaches `swe_calc_ut` — 1800-01-01 in Asia/Tokyo is 1799-12-31 in UT. `EPHEMERIS_COVERAGE_MIN_JD`/`MAX_JD` bound the resolved Julian day, and both the chart engine and the daily-sky validator check them. They sit hours inside the measured edge because coverage there is **order-dependent**: Swiss Ephemeris remembers that a neighbouring file was missing, so an edge instant that answers from `sepl_18.se1` on a cold container answers from Moshier on a warm one. The interior is unaffected and the goldens are bit-identical either way.
- **A Moshier substitution is a refusal, and the returned flag is how you see it**. `swe_calc_ut` reports a missing data file by *succeeding* — flag `260`, `SEFLG_SWIEPH` cleared, plausible longitudes — so `flag < 0` never fires for the case that matters. `calcBody` requires the exact requested flags back, which also catches a dropped `SEFLG_SPEED` (that returns every speed as `0`, silently making every applying/retrograde claim a coin flip). Its message deliberately carries the flag and not `serr`, which embeds the absolute ephemeris directory.

## Contracts and licensing

`contracts/m0` is frozen, and `contracts/m3` is frozen at `schema_version` 0.3.0 with its own `amendments` array. Breaking a required field, an enum, or a schema `$id` needs a schema-version bump and a freeze note; contract changes need a fixture under `fixtures/valid/` and a rejection case under `fixtures/invalid/`.

Editorial bundles are **M3-only**: `POST /internal/content-releases` accepts `schema_version` 0.3.0 and requires `timing_templates`, `daily_fallbacks`, `supported_locales`, and `locale_default`, with exactly one universal fallback and one default timing template per declared locale. A 0.2.0 bundle cannot produce a reading, so accepting one would reserve an immutable release version for bytes that can never be served. Purely additive changes (a new OpenAPI path, a new inline schema) do not trip that policy — record them in the `amendments` array of `SCHEMA_MANIFEST.json` rather than rewriting `out_of_scope_for_this_freeze`, which is a record of what the freeze covered. Wire format is `snake_case` even though TypeScript is `camelCase`. Open contract questions where the code implements the spec faithfully and the spec is what needs fixing are tracked in `docs/reviews/2026-08-01-spec-escalations.md`.

The repo is **not** under a single license — see `LICENSING.md`. Only `apps/calc-stub` is AGPL-3.0-or-later; it must keep its `LICENSE`, `COPYRIGHT`, `NOTICE`, and source-offer documentation intact. `packages/shared` is imported by the AGPL service, and that boundary is the open legal question.

For M7 ontology corpora, `license_class` is a publication-rights flag, not an authorship field: authorized first-party model output may be `licensed_excerpt`, while `internal_synthetic` is deliberately withheld from external readers. An ontology produced by the automated generator/evaluator/signer path still carries `provenance.origin: "machine_pipeline"`; corpus authorship is recorded separately in the immutable corpus and its decision/review evidence. See `pattern-corpus/ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md`.

## Deployment

- **API + PWA are one Worker.** `[env.production.assets]` in `apps/api/wrangler.toml` ships `apps/web/dist` alongside the API, so both share one origin. Workers Builds is the automatic production release path on `main`; its API trigger builds the web assets and must inject `RELEASE_GIT_SHA` from `WORKERS_CI_COMMIT_SHA`. The bare root `npm run deploy:api` and workspace deploy command omit that attestation and are insufficient outside development. Authorized manual releases use the clean, gated, explicit-SHA procedure in [`docs/deploy/release-attestation.md`](docs/deploy/release-attestation.md).
- `run_worker_first` lists every path family the Hono app serves (`["/health", "/v1/*", "/internal/*", "/admin/*", "/codex-provider/*", "/crypto-operator/*"]`). A path missing from it is **not** a 404 — static assets answer first and `not_found_handling: single-page-application` returns `index.html` with a 200, silently serving HTML to an API client. Keep it in sync with `src/index.ts`.
- `assets` is scoped to `[env.production]` deliberately: the vitest pool loads `wrangler.toml`, and a top-level `assets.directory` pointing at an unbuilt `apps/web/dist` breaks the API suite.
- Same-origin is a requirement, not a preference: sessions ride an httpOnly cookie with `SameSite=Strict` and `Path=/v1`, and cross-origin makes it a third-party cookie that Safari's ITP blocks.
- Calc service: Fly.io, `fly deploy` from the repository root → `patternlike-calc` (iad, always-on, 2 machines). The Dockerfile copies root-level `package.json`, `package-lock.json`, and `packages/shared`, so never `cd` into the app dir or pass `--build-context`.
- `fly.web.toml` / `patternlike-app` is the **superseded** Fly copy of the PWA, retired 2026-08-08 by scaling to 0 machines. The app and its name still exist, so `fly deploy -c fly.web.toml` would resurrect it; `fly apps destroy patternlike-app` releases the name for good.
- The `app`/`primary_region` lines in each Fly config are load-bearing. Fly Launch rewrote `fly.toml` once (commit `5e6acec`), pointing the calc Dockerfile at the web app's name, which turns a bare `fly deploy` into "replace the PWA with the calc service". After anything regenerates a Fly config, diff those two lines and the `[[http_service.checks]]` block before deploying.
- Worker secrets go in after the first deploy (`wrangler secret put` prompts interactively on a Worker that does not exist yet): `ROOT_KEK`, `CALC_SERVICE_AUTH_TOKEN`, and `SERVICE_AUTH_TOKEN` for `/internal/*`. Ontology extras, each on the Worker that owns them: `PATTERN_ONTOLOGY_SIGNING_KEY` on `patternlike-ontology-signer-production` (`npm run deploy:signer` first), and `ONTOLOGY_PIPELINE_ARTIFACT_KEYRING` on the API Worker. Named environments do not inherit secrets.
- **The ontology signer must exist before the first API deploy that declares `ONTOLOGY_SIGNER`.** Production signer version `9533269b-08e8-4ece-9418-928405a16449` exists and holds `PATTERN_ONTOLOGY_SIGNING_KEY`; the API holds `ONTOLOGY_PIPELINE_ARTIFACT_KEYRING`, `CODEX_RUNNER_TOKEN`, and `CODEX_PROVIDER_ARTIFACT_KEYRING` (verified against the live secret inventory 2026-08-25). What no inventory can prove is that the signer's private key matches the `ontology-machine-2026-08` public key in `PATTERN_ONTOLOGY_KEYS` -- the signing stage verifies its own signature against that keyring and fails `signing_failed` if it does not, so a mismatch surfaces only on a run that reaches signing. Locally, `npx wrangler dev -c apps/api/wrangler.toml -c apps/ontology-signer/wrangler.toml` from the repository root resolves the service binding; a lone `npm run dev:api` cannot.
- **Queues must exist before the first deploy that declares them**, or the upload fails on an unknown queue. Production now has distinct daily-reading, privacy, Pattern-generation, and ontology-pipeline queues and DLQs; Pattern generation is bound to batch size 1 and concurrency 2. Named environments do not inherit bindings, so both blocks declare their own producer and consumer.
- `db/d1/0002_m3_daily_reading_pipeline.sql` **is applied** to the remote database (ledger entry 2026-08-09 10:38 UTC). Verified after the fact: the three new tables exist, every new column on `users`/`jobs`/`daily_readings`/`reading_sources`/`cycle_instances` is present, `assertion_probe` is empty, `PRAGMA foreign_key_check` returns zero rows, and `PRAGMA quick_check` is `ok`. Migrations from here go through `wrangler d1 migrations apply patternlike-ops --env production --remote` and the ordered runbook in `docs/superpowers/plans/2026-08-09-m3-daily-reading-pipeline.md` §5 — bookmark and export first.
- Before the Reading History release the remote ledger was at **0027** (`d1_migrations` holds 27 rows; verified read-only 2026-09-06). `0025_codex_xhigh_reasoning.sql` applied 2026-09-05 07:27:35 UTC after its export, bookmark, and local rehearsal. `0026_pattern_portraits.sql` (14 commands) and `0027_portrait_mesh_automation.sql` (18 commands) applied together 2026-09-06 06:41:31–32 UTC, three minutes before the push of `ce52443` that Workers Builds deployed as version `c9f0ec8e-d55a-42fd-8e38-a850e87dbe5e` with `PATTERN_PORTRAIT_ENABLED` and `PATTERN_PORTRAIT_MESH_ENABLED` both `"1"`. All seven portrait tables, their 13 triggers, and their 10 indexes exist; `d1 migrations list` reports nothing pending, `foreign_key_check` is empty, `quick_check` is `ok`, and `assertion_probe` is empty. `db/d1/MIGRATIONS.json` is the ledger of record and carries the bookmarks, export hashes, and post-apply checks for every apply from `0002` onward; `docs/deploy/openai-pattern-rollout.md` Gate 2 holds the 0009–0015 recovery coordinates. A missing pipeline evidence receipt still fails machine ingestion closed.
- **Reading History release (2026-09-06):** Migration `0028_reading_saves.sql` applied at 09:08:54 UTC before the compatible Worker push. The remote ledger has 28 records and nothing pending; the new Save table is empty, existing reading/evidence counts are preserved, foreign-key checks are empty, and quick-check is `ok`. `db/d1/MIGRATIONS.json` records the private backup, bookmarks, rehearsal, and apply receipt. Once saves exist, a rollback must preserve Save-aware account deletion.
- **Daily publication receipts (`0029`).** The prospective source note in `MIGRATIONS.json` requires applying the migration before a compatible Worker. Its subsequent production apply is recorded at 2026-09-07 10:15:26 UTC in the [dated release review](docs/reviews/2026-09-07-release-attestation-merge.md#completed-deployment-prerequisites) and [migration receipt](docs/reviews/artifacts/2026-09-07-release-attestation/production-migration-0029.json). These historical records are separate from a fresh live query. Constrained-model publication inserts one content-free row in the same guarded batch as the encrypted reading; deterministic V1 supplies `null`. Procedure: [`docs/deploy/release-attestation.md`](docs/deploy/release-attestation.md).
- **Current source declares two scheduled lanes.** `*/15 * * * *` runs Codex provider maintenance, Daily scheduling/repair, privacy maintenance, Pattern recovery/retention, portrait maintenance, and portrait-mesh maintenance. `7,22,37,52 * * * *` runs Codex provider maintenance plus ontology lease, dispatch, outbox, and artifact recovery. Codex maintenance covers `pattern`, `ontology`, and `reading` through bounded stale cancellation, owner nudges, retention, and content-free observations. Pattern dispatch/recovery obeys `PATTERN_GENERATION_ENABLED`; even while paused, retention and erasure continue. The service-authenticated one-job Pattern reconcile route remains a nudge only, while the sweep also recovers pause classes and undispatched jobs, re-nudges leases, fails jobs after 16 stage claims, and performs retention cleanup. A rollback can change those bindings and schedules but cannot undo an applied migration, so inspect the target version as its own configuration.
- **`OPENAI_API_KEY` is unused by pin, not by deletion.** No reader path reads it, but both ontology publisher branches select on `resolved.config.publisher === "codex"`; flipping that pin makes the key load-bearing again. `apps/api/scripts/verify-openai-pattern-model.ts` reads `process.env.OPENAI_API_KEY` on an operator machine, never the Worker secret. Retire the secret only as its own change, after proving with `rg`, the config tests, and the deployed inventory that nothing reads it.
- **Geoapify search is optional, never a whole-product credential dependency.** Committed production `GEOCODER_ROLLOUT` is `"enabled"`; default `[vars]` stays `"off"`. A non-empty `GEOAPIFY_API_KEY` is still required for search, resolution, and new grants. Missing credentials or rollout `off` return `503 geocoder_unavailable` only there; consent reads/withdrawal and unrelated routes remain available. Google credentials are not a fallback. `MIGRATIONS.json` has no dedicated 0024 APPLIED receipt (the 0023 note says production was already at 0022). Confirm the live ledger before treating 0024 as pending or re-applying it. Consent uses the `contracts/geocoder-v2` 0.8.1 overlay; M0-M9 remain frozen. See `docs/deploy/geocoder-rollout.md` for live gates and rollback.
- A dated operator observation of `content_releases` (2026-08-27, in `docs/deploy/openai-pattern-rollout.md`) found the table empty and `CONTENT_RELEASE_KEYS` unset. That inventory is not a fresh live query. Without an active release the legacy M3 daily-reading path answers `release_not_active`. This no longer affects Pattern, which reads an ontology rather than a content release, and M5 constrained-model daily readings do not depend on one either.
