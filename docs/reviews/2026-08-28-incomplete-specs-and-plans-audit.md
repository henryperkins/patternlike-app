# Incomplete Specs and Plans Audit

> **Snapshot as of `52228ede` (2026-08-28).** Commits on `main` later that day
> closed several rows below: persisted `account_processing` consent
> (`12b1a94`); place search and geocoder consent, and the crypto operator
> control plane with its keyring, write fence, and rotation runbooks
> (`f1c6711`, `docs/deploy/root-kek-rotation.md`,
> `docs/deploy/user-dek-rotation.md`); and Pattern administration through
> Cloudflare Access instead of a shared token (`059aabb`, `b71409d`). Read the
> tables as the state of that baseline, not of the current tree.

Against source SHA `52228edea7ebaceeb3172e4076a6764d89176ad2` and the current documentation working tree, these are the genuinely unfinished specs and plans. Archived plans were excluded, and unchecked boxes alone were not treated as evidence.

## Missing or partial implementation

| Area | Verdict | Outstanding work |
|---|---|---|
| Persisted chart-processing consent | **Missing** | Onboarding still sends a placeholder consent ID, the birth route checks only for presence, and the consent API supports AI synthesis rather than `account_processing`. [Frontend roadmap](../superpowers/plans/2026-08-01-frontend-completion-roadmap.md#stream-f5--real-consent-blocked-on-backend-stream-4), [Onboarding](../../apps/web/src/components/Onboarding.tsx), [birth validation](../../apps/api/src/routes/birth.ts), [consent routes](../../apps/api/src/routes/consents.ts) |
| Place-name search and geocoder consent | **Partial** | Device preference sync and coordinate-to-timezone resolution exist. Search/resolve routes, encrypted selected-place storage, consent, autocomplete, and location-confidence propagation do not. The plan explicitly says implementation remains pending. [Place plan](../superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md#task-2-complete-the-geocoder-rights-privacy-and-provider-decision), [definition of done](../superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md#definition-of-done), [manual inputs](../../apps/web/src/components/Onboarding.tsx) |
| Reading History and Save/Unsave | **Contract-only** | M8 specifies list, detail, and Save endpoints, but runtime still exposes Today, evidence, and feedback only. There is no `0019_reading_saves` migration, History UI, or navigation. [Implementation plan](../superpowers/plans/2026-08-26-reading-history-and-save.md#definition-of-done), [M8 OpenAPI](../../contracts/m8/openapi/openapi.yaml), [runtime routes](../../apps/api/src/routes/readings.ts), [navigation](../../apps/web/src/components/AppShell.tsx) |
| Crypto operator control plane | **Not implemented** | Only low-level rewrap/rotation helpers exist. The keyring, resumable campaigns, write fences, dedicated authentication/routes, operator CLI, and runbooks are absent. Its planned `0017` migration number is already occupied and must be renumbered. [Crypto plan](../superpowers/plans/2026-08-26-crypto-operator-control-plane.md#definition-of-done), [roadmap correction](../superpowers/plans/2026-08-01-backend-completion-roadmap.md#stream-9--operational-hardening-small-do-when-convenient), [current migration manifest](../../db/d1/MIGRATIONS.json) |
| Pattern administrator authorization | **Partial and decision-blocked** | The design still awaits Access-versus-separate-OIDC approval. Runtime uses `PATTERN_ADMIN_TOKEN`, hardcodes subject `admin` and purpose `quality_review`, and lacks exact-artifact and ontology-release routes. [Admin design](../superpowers/specs/2026-08-16-admin-authorization-design.md), [blocking decision](../superpowers/specs/2026-08-16-admin-authorization-design.md#blocking-operator-question), [current route](../../apps/api/src/routes/admin-pattern.ts) |
| Pattern invariant-kernel refactor | **Partial** | PR2's typed stage protocol landed. The approved PR3 publication-proof/claim-transition layer and PR4 shared machine-readable provider policy did not. Direct claim-update SQL and duplicated TypeScript/Python deny policies remain. [PR3 specification](../superpowers/specs/2026-08-23-pattern-invariant-kernel-design.md#pull-request-3-publication-proof-and-claim-transitions), [PR4 specification](../superpowers/specs/2026-08-23-pattern-invariant-kernel-design.md#pull-request-4-provider-boundary-and-documentation), [direct claim update](../../apps/api/src/services/pattern-execute.ts), [duplicated deny policy](../../apps/api/src/services/pattern-packet.ts) |
| M2 editorial publication | **Receiving half only** | Cloudflare bundle ingestion exists, but the WordPress plugin/content types and fixture evaluator integration do not. Fixture-bearing releases remain inactive. This is legacy infrastructure, not the current Codex Daily path. [Current M2 status](../../README.md#m2-status--editorial-control-plane), [fixture limitation](../../apps/api/src/services/content-release.ts) |
| Worker compatibility-date refresh | **Small open roadmap item** | The roadmap still calls for refreshing `compatibility_date`; Wrangler remains at `2025-05-01`. [Roadmap](../superpowers/plans/2026-08-01-backend-completion-roadmap.md#what-is-still-open), [Wrangler configuration](../../apps/api/wrangler.toml) |

## Engineering present, operational closure absent

- The automated ontology pipeline is implemented through its hermetic end-to-end engineering tasks, but Task 11's production-shaped machine candidate and evidence handoff remain open. The current authored-ontology product path no longer depends on that machine release. [Task 11](../superpowers/plans/2026-08-20-automated-ontology-pipeline.md#task-11-full-gate-and-public-rollout-handoff), [current operational distinction](../deploy/openai-pattern-rollout.md)

- Replay-ledger engineering is implemented, but the restore drill and dedicated administrator identity evidence remain unrecorded. [Replay design status](../superpowers/specs/2026-08-16-pattern-replay-ledger-design.md), [restore-drill task](../superpowers/plans/2026-08-22-pattern-erasure-replay-ledger.md#task-5-restore-drill-and-full-gate), [Gate 9 status](../deploy/openai-pattern-rollout.md#gate-9--public-readiness-certification)

- The Codex Daily and account-wide Pattern implementation landed, and migration `0017` is recorded as applied. The release plan still lacks a complete one-SHA record covering contractual/data-control approval, Daily scheduled and first-open canaries, an account-wide Pattern canary, observation, and final `ci:local` evidence. [Rollout acceptance](../superpowers/plans/2026-08-27-codex-reader-rollout.md#rollout-acceptance), [migration record](../../db/d1/MIGRATIONS.json)

## Explicitly deferred or legacy scope

These are documented but should not be mistaken for accidentally unfinished active work:

- Asynchronous birth processing is deliberately deferred until measured production thresholds are crossed. [Birth SLO](../deploy/birth-calc-slo.md#the-decision-this-document-defers)
- Journals and external context connectors remain explicitly unimplemented. [v0.5 open decisions](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md#16-open-decisions)
- Push notifications, native clients, advanced timing, and Bonds remain legacy/future v0.2 scope without active implementation plans. [v0.2 milestones](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#14-delivery-sequence)

Several active documents have stale status text: notably the M7 ledger still describes engineering that later landed, while the Codex Daily/Pattern design still says "implementation not started." The reliable outstanding work is the classified set above, not raw checkbox counts.

## Verification boundary

This was a read-only source/document audit. Tests and live Cloudflare queries were not run. The v0.6 product-spec restatement has been retired, so the surviving active designs and frozen contracts were used as authority.
