# Documented but Incompletely Implemented Functionality Audit

> **Snapshot as of `52228ede` (2026-08-28).** Commits on `main` later that day
> closed several rows below: persisted `account_processing` consent
> (`12b1a94`); place search and geocoder consent, and the crypto operator
> control plane with its keyring, write fence, and rotation runbooks
> (`f1c6711`, `docs/deploy/root-kek-rotation.md`,
> `docs/deploy/user-dek-rotation.md`); and Pattern administration through
> Cloudflare Access instead of a shared token (`059aabb`, `b71409d`). Read the
> tables as the state of that baseline, not of the current tree.

At clean `main` SHA `52228edea7ebaceeb3172e4076a6764d89176ad2`, I found nine documented capabilities that are absent or only partly implemented.

## Confirmed implementation gaps

| Capability | Verdict | Evidence |
|---|---|---|
| Persisted `account_processing` consent | **Partial** | Onboarding sends a placeholder consent ID, while the birth route validates only that it is non-empty. Existing consent endpoints cover AI synthesis, not chart-processing consent. [README](../../README.md#L54), [Onboarding.tsx](../../apps/web/src/components/Onboarding.tsx#L199), [birth.ts](../../apps/api/src/routes/birth.ts#L80), [consents.ts](../../apps/api/src/routes/consents.ts#L42) |
| Place-name search and geocoder consent | **Partial** | Coordinate-to-timezone resolution and device preference sync exist, but provider search/resolve routes, encrypted selected-place cache, geocoder consent, autocomplete UI, and low-confidence propagation do not. The form still requests manual latitude/longitude. [implementation plan](../superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md#L5), [M8 OpenAPI](../../contracts/m8/openapi/openapi.yaml#L237), [Onboarding.tsx](../../apps/web/src/components/Onboarding.tsx#L353), [backend status](../superpowers/plans/2026-08-01-backend-completion-roadmap.md#L361) |
| Reading history, detail, Save/Unsave | **Contract-only** | M8 defines list/detail/save endpoints and schemas, but runtime routes only serve Today, evidence, and feedback. There is no `reading_saves` migration, history view, Save button, or History navigation. [implementation plan](../superpowers/plans/2026-08-26-reading-history-and-save.md#L5), [M8 OpenAPI](../../contracts/m8/openapi/openapi.yaml#L346), [readings.ts](../../apps/api/src/routes/readings.ts#L270), [AppShell.tsx](../../apps/web/src/components/AppShell.tsx#L4) |
| Production-safe key rotation | **Partial** | Low-level `rewrapUserKey` and all-at-once `rotateUserDek` helpers exist, but there is no keyring, authenticated operator API, durable/resumable state machine, bounded chunking, operator script, or runbooks. The plan's `0017` migration number is also stale because Codex already owns it. [crypto plan](../superpowers/plans/2026-08-26-crypto-operator-control-plane.md#L5), [users.ts](../../apps/api/src/db/users.ts#L199), [users.ts rotation](../../apps/api/src/db/users.ts#L395), [current roadmap](../superpowers/plans/2026-08-01-backend-completion-roadmap.md#L474) |
| Pattern administrator security and inspection | **Partial and decision-blocked** | Two metadata/inventory routes use shared `PATTERN_ADMIN_TOKEN`, hardcode subject `"admin"` and purpose `quality_review`, and provide no exact-artifact or ontology-release route. The role-separated session remains blocked on choosing Cloudflare Access versus separate OIDC. [admin design](../superpowers/specs/2026-08-16-admin-authorization-design.md#L5), [current implementation](../../apps/api/src/routes/admin-pattern.ts#L12), [hardcoded audit identity](../../apps/api/src/routes/admin-pattern.ts#L29) |
| WordPress editorial authoring | **Receiving half only** | Cloudflare bundle ingestion exists, but the documented WordPress plugin, content types, review flow, release packaging, and signing side are absent from this repository. This is legacy infrastructure for current M5 Daily, so its priority depends on whether the M2 editorial product is retained. [README](../../README.md#L198), [v0.2 editorial model](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#L107) |
| Content-release fixture execution | **Partial** | Signature, graph, and object-hash checks run, but declared fixtures are not evaluated. Fixture-bearing bundles remain stored and inactive indefinitely. [content route](../../apps/api/src/routes/content-releases.ts#L261), [explicit implementation note](../../apps/api/src/services/content-release.ts#L982) |
| Push notifications | **Schema/deferred only** | v0.2 schedules notification after publication and includes `device_tokens`, but runtime code contains no token registration or delivery path. The vendor remains an open decision. [daily workflow](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#L133), [device token table](../../db/d1/0001_m0_core.sql#L460), [open decision](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#L284) |
| Broader context sources/connectors | **Partial/deferred** | Check-ins and Time Travel life events exist; journals, priorities/goals, calendars, health/device integrations, free/busy, and ambient feeds do not. The client currently recognizes only `USR-06` and `USR-09`. [v0.5 status](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md#L165), [client source union](../../apps/web/src/lib/api-client.ts#L354) |

## Explicitly deferred rather than accidental gaps

- Birth calculation still returns `202` while running synchronously; asynchronous processing is intentionally deferred until measured latency/error thresholds are crossed. [roadmap](../superpowers/plans/2026-08-01-backend-completion-roadmap.md#L385)
- Native iOS/Android clients are mentioned in v0.2 but explicitly excluded from M1; the implemented product is a responsive web PWA. [v0.2](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#L15), [frontend roadmap](../superpowers/plans/2026-08-01-frontend-completion-roadmap.md#L285)
- Additional languages, advanced timing techniques, and Bonds remain future scope. [v0.5 language status](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md#L170), [v0.2 Milestone 5](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md#L268)

## Documentation that currently misstates reality

- The Codex design still says "implementation not started," although the implementation is now on `main`. [design header](../superpowers/specs/2026-08-27-codex-daily-pattern-design.md#L1)
- README claims green GitHub Actions, but repository instructions state Actions never execute because of the billing lock and `npm run ci:local` is the real gate. [README](../../README.md#L181), [AGENTS.md](../../AGENTS.md#L31)

The most consequential next work is persisted chart-processing consent, crypto/admin operational boundaries, then M8 contract-to-runtime parity for places and reading history.

## Verification boundary

No files other than this report were changed. Tests, browser checks, `ci:local`, and live Cloudflare verification were not run; this was a source/document/route/migration audit.
