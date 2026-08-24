# Pattern-Like Astrology App

Cloudflare-first psychological timing product. **Swiss Ephemeris** is calculation authority; editorial and Pattern content ships via signed releases; Fly.io hosts the portable calc service.

**Spec:** `spec-bundle/` (v0.6 Pattern / v0.5 daily reading; v0.2 is the superseded editorial baseline) · **Contracts:** `contracts/m0/`, `m3/`, `m4/` · **D1:** `db/d1/` (migrations `0001`–`0012`)

**Architecture invariants** (Worker routing, encryption, Pattern stage protocol, fail-closed config): [`CLAUDE.md`](CLAUDE.md). **PR/style conventions:** [`AGENTS.md`](AGENTS.md).

**Open contract decisions:** [`docs/reviews/2026-08-01-spec-escalations.md`](docs/reviews/2026-08-01-spec-escalations.md) — items where the code implements the frozen contract faithfully and the fix belongs in the spec.

## Monorepo

| Path | Role |
| --- | --- |
| `apps/api` | Cloudflare Worker (Hono) — product API, queues, D1, R2 |
| `apps/ontology-signer` | Isolated no-route Worker; holds the ontology signing key |
| `apps/calc-stub` | Portable AGPL Swiss Ephemeris calculation service |
| `apps/web` | React 19 / Vite PWA — Auth0 sign-in, Today, Pattern, Timing, Time Travel, privacy |
| `packages/shared` | Wire types, id minting, canonical JSON, launch body/aspect lists |
| `packages/reading-engine` | Deterministic daily-reading assembly |
| `packages/pattern-engine` | Pattern ontology compile / match |
| `contracts/m0` | Frozen JSON Schema + OpenAPI + fixtures (identity, birth, chart) |
| `contracts/m3`, `contracts/m4` | Frozen daily-reading (0.3.0) and Pattern/Time Travel (0.4.0) packages |
| `db/d1` | Operational schema (encrypted birth, jobs, readings, Pattern, privacy) |

## Prerequisites

- Node 20+
- Python 3.11+ (`pip install jsonschema referencing pyyaml openapi-spec-validator`)
- Wrangler 4+ (via workspace)

## Quick start

```bash
npm install
npm run test:contracts
npm run typecheck
npm run test

# Calculation stub (terminal 1)
npm run calc:dev

# Apply every ordered migration under db/d1, then seed AUTH_STUB's local user
npm run db:local -w @patternlike/api
node scripts/dev/seed-dev-user.mjs

# API (terminal 2) — Wrangler :8787
npm run dev:api

# Web client (terminal 3) — Vite binds 127.0.0.1:5173 strictly
npm run web:dev
```

Cloud Agent / Cursor environment bootstrap is `scripts/cloud-agent-install.sh`
(declared in `.cursor/environment.json`). It is idempotent: `npm ci`, pinned
ephemeris download, `db:local`, and the same seed script.

The web client **must** be `http://127.0.0.1:5173/` — Vite sets
`--host 127.0.0.1 --port 5173 --strictPort`, and that origin is the Auth0
callback allowlist. `localhost`, another port, or a LAN bind will start the
app but Universal Login cannot return. `/v1` is proxied to
`http://127.0.0.1:8787`.

Local product requests default to `usr_local_dev_0001` via `X-User-Id` while
`AUTH_STUB=1`. **That header names an existing user; it never creates one.**
A fresh D1 answers `401` until `seed-dev-user.mjs` inserts the `users` row and
its wrapped DEK. Override `VITE_DEV_USER_ID` or `VITE_API_PROXY_TARGET` in
`apps/web/.env.local` only after seeding a matching row.

### Birth → chart (local)

```bash
curl -s http://127.0.0.1:8787/health

curl -s -X POST http://127.0.0.1:8787/v1/birth-profiles \
  -H "content-type: application/json" \
  -H "x-user-id: usr_local_dev_0001" \
  -H "idempotency-key: demo-birth-001" \
  -d "{\"accuracy\":\"exact\",\"consent_id\":\"cns_local_dev_0001\",\"birth_date\":\"1990-05-15\",\"birth_time_local\":\"12:34:00\",\"timezone_hint\":\"America/Los_Angeles\",\"birthplace\":{\"label\":\"Los Angeles\",\"latitude\":34.05,\"longitude\":-118.24}}"

curl -s http://127.0.0.1:8787/v1/chart \
  -H "x-user-id: usr_local_dev_0001"
```

`AUTH_STUB=1` (default `[vars]` in `wrangler.toml`) accepts **`X-User-Id`** for local development only. `[env.production]` sets `AUTH_STUB = "0"` explicitly. `configGuard` returns `503 configuration_error` on every request when `AUTH_STUB=1` or `ROOT_KEK` is unset/placeholder outside `ENVIRONMENT=development|test`. `npm run deploy:api` always passes `--env production`.

Idempotency keys are scoped per user, so the static `demo-birth-001` above is safe across local users. Resubmitting the same birth data under a different key returns `409 chart_already_exists` rather than a 500.

### Historical timezone lookup

When `birthplace` carries coordinates they decide the zone, and `timezone_hint`
is ignored — a browser reports the zone the user is in *now*, which is wrong for
anyone who has moved. The 202 response's `timezone` block reports what was
actually used. The same resolution is available on its own so a client can show
it before committing:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/timezone-lookup \
  -H "content-type: application/json" \
  -H "x-user-id: usr_local_dev_0001" \
  -d '{"latitude":40.7128,"longitude":-74.006,"birth_date":"1974-01-10","birth_time_local":"06:00:00"}'
# → America/New_York at UTC-04:00: the winter the United States stayed on
#   daylight time. Present-day rules would answer UTC-05:00.
```

Coordinates near a zone boundary, births before 1970 (the first year tzdb
guarantees a zone matches its location), local times a daylight change skipped
or repeated, and coordinates that land in open water all come back qualified
rather than silently trusted. The grade is stored on
`birth_profiles.geocode_confidence`.

## Swiss Ephemeris (`apps/calc-stub`)

| Pin | Value |
| --- | --- |
| Engine | Swiss Ephemeris **2.10.03** via `sweph@2.10.3-7` |
| Flags | `SEFLG_SWIEPH \| SEFLG_SPEED` |
| Houses | Placidus primary, Porphyry fallback |
| Node | True lunar node |
| Data | `data/ephe/sepl_18.se1`, `semo_18.se1` (1800–2400) |
| Data pin | `apps/calc-stub/ephemeris.lock.json` — upstream commit + SHA-256 per file |

Birth dates outside 1800-01-01 … 2399-12-31 are rejected as
`invalid_birth_profile` rather than reaching Swiss Ephemeris.

```bash
npm run ephe:download -w @patternlike/calc-stub   # pinned commit, digest-verified
npm run calc:dev
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/engine
```

**License (M0 — decided):** **AGPL public Swiss Ephemeris** path.

**This repository is not under a single license** — see [`LICENSING.md`](LICENSING.md) for per-directory terms. Only `apps/calc-stub` is AGPL.

| Item | Value |
| --- | --- |
| Per-directory terms | [`LICENSING.md`](LICENSING.md) — start here |
| Decision | [`docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md`](docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md) — **`DECIDED` / AGPL** |
| Calc service | [`apps/calc-stub/LICENSE`](apps/calc-stub/LICENSE) — full **AGPL-3.0** text · [`COPYRIGHT`](apps/calc-stub/COPYRIGHT) |
| Source offer | [`docs/legal/AGPL_SOURCE_OFFER.md`](docs/legal/AGPL_SOURCE_OFFER.md) |
| Notices | [`NOTICE`](NOTICE) |
| Runtime | `SE_LICENSE_MODE=agpl` (default) |

Counsel should still review AGPL network obligations and app-store strategy before public end-user launch. Production boot still refuses `SE_LICENSE_MODE=pending`.

## Current status

Engineering through M7 is in the repository. Production (`patternlike-api-production`) has served the Worker + PWA on one origin since 2026-08-08. What is **not** live is generation: no active content release, `PATTERN_AI_ROLLOUT=off`, and machine ontology Gate 7B has failed closed. Implemented provider code is not evidence of a completed canary.

| Area | In repo | Typical local pitfall |
| --- | --- | --- |
| Birth → chart, unknown-time suppression, historical timezone | yes | `401` until `seed-dev-user.mjs`; `409 chart_already_exists` on a second idempotency key with the same data |
| Today (M3/M5), Timing, Time Travel (M4), life events, check-ins, context sources | yes | Generation withheld until timezone/locale are confirmed (`default_unconfirmed`) |
| Privacy export / account deletion | yes — `routes/privacy.ts`, not the leftover 501 stubs | Mutating calls need `Idempotency-Key` |
| Auth0 Universal Login + Worker `pl_session` cookie | yes (`@auth0/auth0-react`) | Origin must be exactly `http://127.0.0.1:5173/` |
| Your Pattern (M4 editorial + M7 AI path) | yes | `GET /v1/pattern` is `503 pattern_release_not_active` without an M4 release; AI generation stays off until rollout + ontology |
| Place-name geocoding | **open** — coordinates are still entered by hand | — |
| WordPress authoring plugin | **open** — Cloudflare ingestion exists; the CMS that produces bundles does not | — |

Operator runbooks: [`docs/deploy/api-production.md`](docs/deploy/api-production.md), [`docs/deploy/openai-pattern-rollout.md`](docs/deploy/openai-pattern-rollout.md), [`docs/deploy/openai-daily-reading-rollout.md`](docs/deploy/openai-daily-reading-rollout.md).

## Content release ingestion

`POST /internal/content-releases` is the Cloudflare half of the editorial
pipeline. WordPress authors and reviews content, then signs a release bundle and
posts it here; the Worker verifies the signature, stores the immutable bundle in
R2, runs the smoke tests it can, and atomically activates the release pointer.

Accepted `schema_version` values are **`0.3.0` (M3 Today)** and **`0.4.0` (M4
Pattern / Time Travel)**. Dispatch is an explicit bounded map in
`services/content-release.ts` — anything else, including a 0.2.0 bundle, fails
closed *before* hashing, signing, R2, or D1 work. One active release pointer
serves both Today and Your Pattern; rolling back to an M3-only bundle keeps
Today working and makes `GET /v1/pattern` answer `503 pattern_release_not_active`.

The threat model is that WordPress can be compromised, so nothing is trusted
because the bundle asserts it. In order:

| Step | Refusal |
| --- | --- |
| `Idempotency-Key` header, matching the body's `idempotency_key` | `idempotency_key_required` / `idempotency_key_mismatch` |
| Structural validation against `content-release.schema.json` | `invalid_body`, `schema_version_unsupported`, `objects_incomplete` |
| `release.bundle_hash` recomputed from the canonical body | `bundle_hash_mismatch` |
| Signature verified against a configured public key | `signature_invalid`, `signature_key_unknown`, `signature_alg_mismatch` |
| Content graph: dual control, phase/cycle resolution, prompt and safety-fallback resolution | `dual_control_violation`, `orphan_phase`, `incomplete_cycle`, `unresolved_prompt`, `unresolved_safety_fallback` |
| Per-object `object_hash` recomputed | `object_hash_mismatch` |
| Version immutability | `release_version_immutable` (409) |
| Bundle-bytes uniqueness — the same hash under a different version | `bundle_hash_conflict` (409) |
| Request body exceeds the 8 MiB ingestion limit | `request_too_large` (413) |

Refusals return the standard error envelope and write an `audit_events` row
carrying the opaque reason class — never bundle content. Nothing is stored until
every check above passes.

Accepted bundles answer `202` with one of three statuses:

- `active` — verified, stored at `r2://artifacts/content-releases/<version>.json`, pointer moved, previous release marked `superseded`.
- `accepted_pending_tests` — stored but not live, either because `activate: false` was sent or because the bundle declares eligibility `fixtures` that need the M3 assembly engine to evaluate. Activating on tests nobody ran would be a claim, not a result.
- `duplicate` — an unchanged replay of an already stored release, whether it is
  active or still pending activation.

**Rollback** needs no separate endpoint: re-post a bundle that is already stored
and the pointer moves back to it, which is what the spec means by "rollback
changes the active release pointer; it does not require editing previously
published readings". The audit row distinguishes `activate` from `rollback`.

Two pieces of configuration are required, and ingestion fails closed without
either — in development too, so the path that must never be wrong is never the
path that went unexercised:

```bash
# The signing keys. PUBLIC material, so a var rather than a secret.
# Ed25519 (32 raw bytes) or ES256 (65-byte uncompressed point), base64url.
CONTENT_RELEASE_KEYS='{"wp-release-key-1":{"alg":"Ed25519","public_key":"<base64url raw>"}}'

# The bundle store is pre-provisioned in production.
# R2 bucket: pattern-artifacts
```

Without keys the endpoint returns `503 release_keys_not_configured`; a malformed
key entry returns `503 release_keys_misconfigured`; without the R2 binding it
returns `503 object_storage_not_configured`. The algorithm is pinned per key
rather than read from the bundle: the bundle names one too, and honouring that
name would let a compromised CMS choose which primitive its bytes are checked
under.

## Authentication

Auth0 authenticates; the Worker authorises. `apps/web` mounts
`@auth0/auth0-react`. After Universal Login returns, `apps/web/src/lib/auth.ts`
exchanges the one-shot encoded `id_token` for a `pl_session` cookie via
`POST /v1/sessions`. Auth0 in-memory state never grants product data — a 401
from the API is “signed out,” even if the SDK still has a cached session.
Refresh tokens stay disabled.

`POST /v1/sessions` mints that session. Browsers receive an httpOnly
`pl_session` cookie (`SameSite=Strict`, `Path=/v1`); native clients use the
returned `token` as a bearer. Both resolve the same session row, so
`DELETE /v1/sessions/current` logs out either. Sessions expire absolutely after
30 days and are revocable by row update.

`VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` in the PWA must match
`OIDC_ISSUER` / `OIDC_AUDIENCE` in `apps/api/wrangler.toml`. A mismatch is a
flat browser 401; detailed verification reasons stay server-only.
`identities.provider` stores the **issuer string itself** — changing
`OIDC_ISSUER` orphans every existing account.

Three variables are required outside development — `OIDC_ISSUER`,
`OIDC_AUDIENCE`, and `OIDC_JWKS_URL`. They are configuration, not secrets.
The shipped `[vars]` values point at `issuer.invalid`; `configGuard` rejects
them outside development.

Local development keeps `AUTH_STUB=1` and the `X-User-Id` header. **That header
names an existing user — it never creates one.** Seed with
`node scripts/dev/seed-dev-user.mjs` (local D1) or `seedUser()` in tests
(users row + identities row + wrapped DEK).

`ENVIRONMENT=test` counts as development and disables the config guard. Do not
name a staging deployment `test`.

## Deploying

**API + PWA are one Cloudflare Worker.** `[env.production.assets]` ships
`apps/web/dist` alongside Hono, so both live on
`patternlike-api-production.lfd.workers.dev`. Deploy with `npm run deploy:api`
from the root (it builds the web app first). Same-origin is required: the
session cookie is `SameSite=Strict` / `Path=/v1`. Keep `run_worker_first`
(`["/health", "/v1/*", "/internal/*", "/admin/*"]`) in sync with
`apps/api/src/index.ts` — a path missing from it is served as `index.html`
with HTTP 200.

The calc service is the only Fly app that should be deployed:

| App | Serves | Config | Deploy |
| --- | --- | --- | --- |
| `patternlike-calc` | Swiss Ephemeris (`apps/calc-stub`) | `fly.toml` | `fly deploy` from the **repository root** |

`fly.web.toml` / `patternlike-app` is the **superseded** Fly copy of the PWA,
retired 2026-08-08 (scaled to 0). The app name still exists, so
`fly deploy -c fly.web.toml` would resurrect it. Do not.

> **Do not** run `fly deploy` from inside an app directory and do not pass
> `--build-context`. The calc Dockerfile copies root-level `package.json`,
> `package-lock.json`, and `packages/shared`. After anything regenerates a Fly
> config, diff the `app` / `primary_region` lines — Fly Launch once pointed
> the calc Dockerfile at the web app's name.

### Calc service auth

`POST /v1/calculate` requires a shared bearer token in production:
`503 service_auth_not_configured` until the secret is set, `401 unauthorized`
without a valid token. `/health` and `/v1/engine` stay public so health checks
keep working. Outside `ENVIRONMENT=production` no token is required — the
local dev loop runs unchanged — while setting `CALC_SERVICE_AUTH_TOKEN`
locally enforces auth anywhere.

Configure the same generated token on both sides; never commit it:

```bash
fly secrets set CALC_SERVICE_AUTH_TOKEN="<generated-secret>" -a patternlike-calc

# Worker side:
npx wrangler secret put CALC_SERVICE_AUTH_TOKEN --env production
```

### Verify the deployment

```bash
curl --fail https://patternlike-calc.fly.dev/health
curl --fail https://patternlike-calc.fly.dev/v1/engine

# 401 proves the calculate gate is enforcing:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://patternlike-calc.fly.dev/v1/calculate
```

The calc `/health` check has a 30-second grace period configured in `fly.toml`
to allow for ephemeris initialisation on first start.

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| Local API `401` with `X-User-Id: usr_local_dev_0001` | D1 has no seeded user. Run `node scripts/dev/seed-dev-user.mjs` after `db:local`. |
| Auth0 callback fails / loops | Origin is not exactly `http://127.0.0.1:5173/`. Vite refuses other hosts/ports. |
| `wrangler deploy --dry-run` looks like production | Bare dry-run validates the **dev** `[vars]` block (`AUTH_STUB=1`, `issuer.invalid`). Use `npm run deploy:api` / `--env production`. |
| Ontology RPC 404 locally | `npm run dev:api` does not bind the signer. From the repo root: `npx wrangler dev -c apps/api/wrangler.toml -c apps/ontology-signer/wrangler.toml`. |
| `GET /v1/pattern` → `503 pattern_release_not_active` | No active M4 content release. Draft files under `content/pattern-candidates/` are never a runtime fallback. |
| Production Pattern/Today jobs sit `queued` with `dispatched_at` null | Production cron is ontology-pipeline only (`7,22,37,52 * * * *`). The `*/15` incumbent lane (readings, privacy, Pattern sweep) is off until separately enabled. |

## Architecture profile

`cloudflare-first-wordpress-editorial-fly-portable-v1` — see `spec-bundle/pattern_like_astrology_app_platform_topology_v0.2.yaml`.

Cross-cutting invariants (encryption AAD, Pattern stage protocol, Time Travel receipt epoch, fail-closed config) live in [`CLAUDE.md`](CLAUDE.md), not here.
