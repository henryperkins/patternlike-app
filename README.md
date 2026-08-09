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
- [x] Historical timezone resolution: birthplace coordinates resolve to an IANA zone (`POST /v1/timezone-lookup`), and the chart is calculated in that zone rather than the browser's current one
- [ ] Place-name geocoding: typing "Los Angeles" still requires entering coordinates by hand
- [ ] Privacy center export/delete workflows (API stubs 501)

## M2 status — editorial control plane

- [x] Cloudflare ingestion: `POST /internal/content-releases` verifies, stores, and activates signed bundles (see below)
- [x] Release rollback by re-posting a stored bundle; activation and rollback are one D1 transaction with their audit row
- [ ] WordPress.com plugin and content types — the authoring side that produces the bundles
- [ ] Smoke-test fixtures: a bundle declaring `fixtures` is stored but held inactive until M3 can evaluate them

## Content release ingestion

`POST /internal/content-releases` is the Cloudflare half of the editorial
pipeline. WordPress authors and reviews content, then signs a release bundle and
posts it here; the Worker verifies the signature, stores the immutable bundle in
R2, runs the smoke tests it can, and atomically activates the release pointer.

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

## Deploying to Fly.io

Two Fly apps deploy from this repo. **All commands run from the repository
root** — the Docker build context must remain the root so the Dockerfiles can
copy `package.json`, `package-lock.json`, `tsconfig.base.json`, and
`packages/shared`. The API is not on Fly; it remains a Cloudflare Worker
backed by D1.

| App | Serves | Config | Deploy |
| --- | --- | --- | --- |
| `patternlike-calc` | Swiss Ephemeris calc service (`apps/calc-stub`) | `fly.toml` | `fly deploy` |
| `patternlike-app` | Web PWA (`apps/web`, static nginx) | `fly.web.toml` | `fly deploy -c fly.web.toml` |

> **Do not** run `fly deploy` from inside an app directory and do not pass
> `--build-context`. Both Dockerfiles expect root-level workspace files.
> To recreate an app from scratch: `fly apps create <name> --org personal`.

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

# Worker side (when the production API deploys):
npx wrangler secret put CALC_SERVICE_AUTH_TOKEN --env production
```

### Verify the deployment

```bash
curl --fail https://patternlike-calc.fly.dev/health
curl --fail https://patternlike-calc.fly.dev/v1/engine
curl --fail https://patternlike-app.fly.dev/

# 401 proves the calculate gate is enforcing:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://patternlike-calc.fly.dev/v1/calculate
```

The calc `/health` check has a 30-second grace period configured in `fly.toml`
to allow for ephemeris initialisation on first start.

## Architecture profile

`cloudflare-first-wordpress-editorial-fly-portable-v1` — see `spec-bundle/pattern_like_astrology_app_platform_topology_v0.2.yaml`.
