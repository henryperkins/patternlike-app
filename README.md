# Pattern-Like Astrology App

Cloudflare-first psychological timing product. **Swiss Ephemeris** is calculation authority; editorial content ships via signed WordPress releases; Fly.io is portable compute (not launch-critical).

**Spec:** `spec-bundle/` (v0.2) · **Contracts:** `contracts/m0/` · **D1:** `db/d1/`

**Open contract decisions:** [`docs/reviews/2026-08-01-spec-escalations.md`](docs/reviews/2026-08-01-spec-escalations.md) — twelve reviewed items where the code implements the frozen contract faithfully and the fix belongs in the spec.

## Monorepo

| Path | Role |
| --- | --- |
| `apps/api` | Cloudflare Worker (Hono) — birth/chart M1 path |
| `apps/calc-stub` | Portable AGPL Swiss Ephemeris calculation service |
| `apps/web` | React/Vite PWA — onboarding, chart evidence, and privacy surface |
| `packages/shared` | Shared types, fingerprint helpers, constants |
| `contracts/m0` | Frozen JSON Schema + OpenAPI + fixtures |
| `db/d1` | Operational schema (encrypted birth, idempotent jobs) |

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

# Apply D1 schema locally (terminal 2)
npm run db:local -w @patternlike/api

# API (terminal 2)
npm run dev:api

# Web client (terminal 3)
npm run web:dev
```

The web client opens at `http://127.0.0.1:5173` and proxies `/v1` requests to
the local Worker at `http://127.0.0.1:8787`. Development defaults to
`usr_local_dev_0001`; override `VITE_DEV_USER_ID`, `VITE_CONSENT_ID`, or
`VITE_API_PROXY_TARGET` in `apps/web/.env.local` when needed. These values are
local scaffolding only while production identity and consent APIs remain M1 work.

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

`AUTH_STUB=1` (default `[vars]` in `wrangler.toml`) accepts **`X-User-Id`** for local development only. It is absent from `[env.production]`, and the `configGuard` middleware returns `503 configuration_error` for any request when `AUTH_STUB=1` or `ROOT_KEK` is unset/placeholder outside `ENVIRONMENT=development|test`. `npm run deploy` targets `--env production`.

Idempotency keys are scoped per user, so the static `demo-birth-001` above is safe across local users. Resubmitting the same birth data under a different key returns `409 chart_already_exists` rather than a 500.

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

## M1 status

- [x] Monorepo + green CI on GitHub Actions
- [x] Workers integration tests: `apps/api` runs inside workerd with a real local D1 (`@cloudflare/vitest-pool-workers`)
- [x] M0 contracts validation in CI
- [x] D1 core schema with encryption CHECKs
- [x] Birth profile + chart calculation path
- [x] Unknown birth-time mode: noon is a technical epoch only. It is never stored as the birth instant, and houses, angles, and time-sensitive Moon claims are suppressed whenever no real birth time was supplied — regardless of the accuracy label the caller sends. `birth_time_local` is required for `exact` and `approximate`.
- [x] Real Swiss Ephemeris 2.10.03 + golden fingerprint tests
- [x] SE licensing decision: **AGPL public path** (counsel + store strategy still open)
- [x] Responsive web/PWA shell with birth onboarding, chart facts/evidence, uncertainty, and privacy status
- [x] Production identity: OIDC token exchange, Worker-minted sessions, and a crypto identity decoupled from the user's public id
- [ ] Historical TZ geocode connectors (IANA zone via luxon is local-only)
- [ ] Privacy center export/delete workflows (API stubs 501)

## Authentication

`POST /v1/sessions` exchanges an OIDC ID token for a session. Browsers receive
an httpOnly `pl_session` cookie; native clients use the returned `token` as a
bearer. Both resolve the same session row, so `DELETE /v1/sessions/current`
logs out either. Sessions expire absolutely after 30 days and are revocable by
row update, which is what makes "invalidate sessions" a real control rather
than a wait for token expiry.

Three variables are required outside development — `OIDC_ISSUER`,
`OIDC_AUDIENCE`, and `OIDC_JWKS_URL`. They are configuration, not secrets (the
JWKS document is public), so they belong in `wrangler.toml` `[vars]`. The
shipped values point at `issuer.invalid`; `configGuard` rejects them outside
development, so a deploy that forgets to replace them returns a loud
`503 configuration_error` rather than opaque 401s from inside the verifier.

Local development keeps `AUTH_STUB=1` and the `X-User-Id` header. **That header
now names an existing user — it no longer creates one**, because user creation
moved to identity-link time and a crypto subject can never come from a request.
Seed a user first (see `seedUser` in `apps/api/test/helpers.ts` for the shape:
the `users` row, its `identities` row, and its wrapped DEK must land together).

`ENVIRONMENT=test` counts as development and disables the config guard. Do not
name a staging deployment `test`.

## Deploying to Fly.io (`apps/calc-stub`)

The Swiss Ephemeris calculation service can be deployed to Fly.io using the
root-level `fly.toml`. **All commands must run from the repository root** — the
Docker build context must remain the root so the Dockerfile can copy
`package.json`, `package-lock.json`, and `packages/shared`.

### First deployment

```bash
# Authenticate (one-time)
fly auth login

# Create the app on Fly without deploying yet.
# Change "patternlike-calc" if that name is already taken.
fly launch \
  --name patternlike-calc \
  --dockerfile apps/calc-stub/Dockerfile \
  --no-deploy

# Build the image and deploy (from the repository root).
fly deploy
```

### Subsequent deployments

```bash
# From the repository root:
fly deploy

# If your Fly app has a different name than fly.toml:
fly deploy --app YOUR_EXISTING_FLY_APP_NAME
```

> **Do not** run `fly deploy` from `apps/calc-stub` and do not pass
> `--build-context` pointing to `apps/calc-stub`. The Dockerfile expects
> root-level workspace files.

### Secrets

Set runtime secrets with `fly secrets set` — never commit them to source:

```bash
fly secrets set ROOT_KEK=<value> SOME_API_KEY=<value>
```

### Verify the deployment

```bash
curl https://YOUR_APP.fly.dev/health
curl https://YOUR_APP.fly.dev/v1/engine
```

The `/health` check has a 30-second grace period configured in `fly.toml` to
allow for ephemeris initialisation on first start.

## Architecture profile

`cloudflare-first-wordpress-editorial-fly-portable-v1` — see `spec-bundle/pattern_like_astrology_app_platform_topology_v0.2.yaml`.
