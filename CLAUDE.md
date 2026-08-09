# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the style/PR conventions and is still authoritative for those; this file covers architecture and the invariants that span multiple files.

## Commands

Run from the repository root. Node 20+ (CI uses 22), Python 3.11+ with `pip install jsonschema referencing pyyaml openapi-spec-validator`.

```bash
npm install
npm run typecheck          # strict tsc --noEmit across all four workspaces
npm test                   # shared + calc-stub + api + web, then test:contracts
npm run test:contracts     # python: JSON Schema/fixture validation + D1 SQL smoke apply
npm run build              # shared/calc tsc, Worker dry-run deploy, Vite build

npm run calc:dev           # calc service      :8080
npm run db:local -w @patternlike/api   # apply db/d1/0001_m0_core.sql to local D1
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

## Architecture

Four workspaces (`apps/*`, `packages/*`), one request path:

`apps/web` (React 19 + Vite PWA) → `apps/api` (Hono on Cloudflare Workers, D1) → `apps/calc-stub` (Node + Swiss Ephemeris, AGPL, deployed to Fly). The calc binding is plain HTTP (`CALC_SERVICE_URL` + optional `CALC_SERVICE_AUTH_TOKEN`) so the runtime can move without touching contracts. `packages/shared` holds wire types, id minting, canonical JSON, and the launch body/aspect lists used by both sides.

`contracts/m0/` is the frozen source of truth (JSON Schema + OpenAPI + valid/invalid fixtures); `db/d1/0001_m0_core.sql` is the operational schema; `spec-bundle/` is the normative product spec v0.2.

### Worker routing

`apps/api/src/index.ts` mounts sub-apps deliberately: a Hono router mounted at `"/"` contributes its `use("*", …)` middleware to **every** path in the parent. That is why `configGuard` is attached to the two `/v1/sessions` paths directly, and why the service-token router is mounted under `/internal` rather than `/`. Adding a router with wildcard middleware at `"/"` re-introduces the bug.

Order on the product API is `configGuard` → `authenticate`. Unimplemented product surfaces (readings, timing, time-travel, check-ins, exports, account delete) return 501 from `routes/stubs.ts`.

### Sign-in

Auth0 authenticates; the Worker authorises. `apps/web/src/lib/auth.ts` runs an authorization-code + PKCE redirect, then trades the one-shot `id_token` for a `pl_session` cookie via `POST /v1/sessions`. Auth0 is never consulted again — **the cookie is the only source of truth for "am I signed in", answered by calling the API and watching for a 401**, never by asking the issuer. Nothing from Auth0 is persisted: `cacheLocation` stays in-memory and refresh tokens are off.

`identities.provider` stores the **issuer string itself**, and lookups are `WHERE provider = ? AND provider_subject = ?`. Changing `OIDC_ISSUER` therefore orphans every existing account — new user id, new crypto subject, old ciphertext unreadable. The tenant is currently a `dev-` one; migrating to production must happen before the first real user.

The three `OIDC_*` vars in `wrangler.toml` must stay in step with `AUTH0_DOMAIN`/`AUTH0_CLIENT_ID` in `auth.ts`. A mismatch is a silent 401: the rejection reason is logged server-side and deliberately never returned.

The SDK is a dynamic `import()`, worth ~57 KB gzipped — a third of the bundle. Making it static puts it on the critical path for returning users who never touch it.

### Fail-closed configuration

`middleware/config-guard.ts` returns `503 configuration_error` on every request when the deployment looks development-shaped outside development: `AUTH_STUB=1`, a missing/placeholder `ROOT_KEK`, or `OIDC_ISSUER`/`OIDC_AUDIENCE`/`OIDC_JWKS_URL` still pointing at `issuer.invalid`. Workers have no startup hook with bindings, so per-request refusal is the substitute for failing boot. `isDevEnvironment()` treats `ENVIRONMENT` of `development` **or** `test` as development — never name a staging deployment `test`. `wrangler.toml`'s top-level `[vars]` is the dev block; `[env.production]` sets `AUTH_STUB = "0"` — explicitly off rather than omitted, because omitting it made wrangler warn about the missing var on every production deploy and that noise masks a genuinely forgotten one. Only `"1"` enables the stub. `npm run deploy` always passes `--env production`, and so does `@patternlike/api`'s `build` dry-run: a bare `wrangler deploy --dry-run` validates the *dev* block, so it can never catch a production-only config error, and it trips Workers Builds' Worker-name check — whose offered remedy is a PR renaming the top-level worker to `patternlike-api-production`, which would attach the production name to the `AUTH_STUB`/`issuer.invalid`/placeholder-D1 block. Reject that PR. Because the production dry-run reads `[env.production.assets]`, the root `build` script must build `@patternlike/web` before `@patternlike/api`.

`apps/calc-stub` mirrors this: `/v1/calculate` returns 503 without `CALC_SERVICE_AUTH_TOKEN` in production and 401 on a bad token, while `/health` and `/v1/engine` stay public for health checks. `SE_LICENSE_MODE=pending` refuses to boot.

### Envelope encryption (the tightest constraint in the repo)

`ROOT_KEK` → HKDF-SHA256 → KEK → per-user DEK (AES-256-GCM), in `apps/api/src/crypto.ts` and `src/db/users.ts`.

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

`apps/api` runs inside workerd via `@cloudflare/vitest-pool-workers`: `SELF.fetch()` drives the real Hono app against a real local D1 seeded from `db/d1/` by `test/apply-migrations.ts`. All outbound fetches — including `invokeCalc` — are intercepted by `test/mock-calc-service.ts`, so tests are hermetic. Storage is **not** isolated per test in this pool version; `resetDb()` in `test/helpers.ts` deletes from an explicit FK-ordered table list, and a table missing from that list leaks rows between suites.

Because `X-User-Id` names a user rather than creating one, every API test must `seedUser()` first — the `users` row, its `identities` row, and its wrapped DEK land together.

## Domain invariants

- **Unknown birth time**: noon is a computation epoch only. It is never stored as the birth instant, and houses, angles, and time-sensitive Moon claims are suppressed whenever no real birth time was supplied — regardless of the `accuracy` label the caller sends (`engine.ts` recomputes an effective accuracy). `birth_time_local` is required for `exact` and `approximate`; the API rejects otherwise.
- **Idempotency** is scoped per user (`uq_jobs_scope_key` over `COALESCE(user_id,'')`). A failed job row is reused, not re-inserted. Identical birth data under a new key returns `409 chart_already_exists`, not a 500 from `UNIQUE(user_id, fingerprint)`.
- **Chart PII**: `GET /v1/chart` returns positions/houses/angles/aspects/uncertainty but nulls every birth field — the birth instant and coordinates stay encrypted at rest.
- **Error envelope**: every response is `{ error: { code, message, request_id, details? } }`. Upstream calc messages have leaked absolute filesystem paths, so only `invalid_birth_profile` is echoed to the caller; everything else is logged and returned as a generic `calc_failed`/`internal_error`.
- **Swiss Ephemeris pins**: 2.10.03 via `sweph@2.10.3-7`, `SEFLG_SWIEPH | SEFLG_SPEED`, Placidus with Porphyry fallback, true node, data valid 1800–2399 (outside that range → `invalid_birth_profile` before reaching the engine). Golden fingerprints must stay deterministic.

## Contracts and licensing

`contracts/m0` is frozen. Breaking a required field, an enum, or a schema `$id` needs a schema-version bump and a freeze note; contract changes need a fixture under `fixtures/valid/` and a rejection case under `fixtures/invalid/`. Purely additive changes (a new OpenAPI path, a new inline schema) do not trip that policy — record them in the `amendments` array of `SCHEMA_MANIFEST.json` rather than rewriting `out_of_scope_for_this_freeze`, which is a record of what the freeze covered. Wire format is `snake_case` even though TypeScript is `camelCase`. Open contract questions where the code implements the spec faithfully and the spec is what needs fixing are tracked in `docs/reviews/2026-08-01-spec-escalations.md`.

The repo is **not** under a single license — see `LICENSING.md`. Only `apps/calc-stub` is AGPL-3.0-or-later; it must keep its `LICENSE`, `COPYRIGHT`, `NOTICE`, and source-offer documentation intact. `packages/shared` is imported by the AGPL service, and that boundary is the open legal question.

## Deployment

- **API + PWA are one Worker.** `[env.production.assets]` in `apps/api/wrangler.toml` ships `apps/web/dist` alongside the API, so both live on one origin (`patternlike-api-production.lfd.workers.dev`). Deploy with `npm run deploy:api` from the root — it builds the web app first, which the upload requires. **Live** since 2026-08-08; see `docs/deploy/api-production.md`.
- `run_worker_first` lists every path the Hono app serves (`["/health", "/v1/*", "/internal/*"]`). A path missing from it is **not** a 404 — static assets answer first and `not_found_handling: single-page-application` returns `index.html` with a 200, silently serving HTML to an API client. Keep it in sync with `src/index.ts`.
- `assets` is scoped to `[env.production]` deliberately: the vitest pool loads `wrangler.toml`, and a top-level `assets.directory` pointing at an unbuilt `apps/web/dist` breaks the API suite.
- Same-origin is a requirement, not a preference: sessions ride an httpOnly cookie with `SameSite=Strict` and `Path=/v1`, and cross-origin makes it a third-party cookie that Safari's ITP blocks.
- Calc service: Fly.io, `fly deploy` from the repository root → `patternlike-calc` (iad, always-on, 2 machines). The Dockerfile copies root-level `package.json`, `package-lock.json`, and `packages/shared`, so never `cd` into the app dir or pass `--build-context`.
- `fly.web.toml` / `patternlike-app` is the **superseded** Fly copy of the PWA, retired 2026-08-08 by scaling to 0 machines. The app and its name still exist, so `fly deploy -c fly.web.toml` would resurrect it; `fly apps destroy patternlike-app` releases the name for good.
- The `app`/`primary_region` lines in each Fly config are load-bearing. Fly Launch rewrote `fly.toml` once (commit `5e6acec`), pointing the calc Dockerfile at the web app's name, which turns a bare `fly deploy` into "replace the PWA with the calc service". After anything regenerates a Fly config, diff those two lines and the `[[http_service.checks]]` block before deploying.
- Worker secrets go in after the first deploy (`wrangler secret put` prompts interactively on a Worker that does not exist yet): `ROOT_KEK`, `CALC_SERVICE_AUTH_TOKEN`, and `SERVICE_AUTH_TOKEN` for `/internal/*`.
