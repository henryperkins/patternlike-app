# Pattern-Like Astrology App

Cloudflare-first psychological timing product. **Swiss Ephemeris** is calculation authority; editorial content ships via signed WordPress releases; Fly.io is portable compute (not launch-critical).

**Spec:** `spec-bundle/` (v0.2) · **Contracts:** `contracts/m0/` (frozen baseline; additive packages through `contracts/m8/`) · **D1:** `db/d1/`

**Open contract decisions:** [`docs/reviews/2026-08-01-spec-escalations.md`](docs/reviews/2026-08-01-spec-escalations.md) — twelve reviewed items where the code implements the frozen contract faithfully and the fix belongs in the spec.

## Monorepo

| Path | Role |
| --- | --- |
| `apps/api` | Cloudflare Worker (Hono) — birth/chart M1 path |
| `apps/ontology-signer` | Isolated no-route Worker; holds the ontology signing key |
| `apps/calc-stub` | Portable AGPL Swiss Ephemeris calculation service |
| `apps/web` | React/Vite PWA — onboarding, chart evidence, and privacy surface |
| `packages/shared` | Shared types, fingerprint helpers, constants |
| `contracts/m0` | Frozen JSON Schema + OpenAPI + fixtures |
| `db/d1` | Operational schema (encrypted birth, idempotent jobs) |

## Prerequisites

- Node 20+
- Python 3.11+ (`pip install jsonschema referencing pyyaml openapi-spec-validator -r spec-bundle/render_v0_5.requirements.txt`)
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
node scripts/dev/seed-dev-user.mjs

# API (terminal 2)
npm run dev:api

# Web client (terminal 3)
npm run web:dev
```

The web client opens at `http://127.0.0.1:5173` and proxies `/v1` requests to
the local Worker at `http://127.0.0.1:8787`. Development defaults to
`usr_local_dev_0001`; override `VITE_DEV_USER_ID` or `VITE_API_PROXY_TARGET` in
`apps/web/.env.local` when needed. The seed command above creates that local
user, crypto subject, and wrapped DEK idempotently. It does **not** grant
account-processing consent — onboarding does that itself, and the curl loop
below must too.

### Birth → chart (local)

```bash
curl -s http://127.0.0.1:8787/health

# Grant the current account-processing policy. GET/PUT/DELETE
# /v1/consents/account-processing are recovery routes, so they work before a
# grant exists; every other product path returns 403 account_processing_required.
CONSENT_ID=$(curl -s -X PUT http://127.0.0.1:8787/v1/consents/account-processing \
  -H "content-type: application/json" \
  -H "x-user-id: usr_local_dev_0001" \
  -H "idempotency-key: demo-account-processing-001" \
  -H "x-consent-ui-surface: onboarding" \
  -d '{"policy_version":"account-processing-v1-2026-08-28"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['consent_id'])")

curl -s -X POST http://127.0.0.1:8787/v1/birth-profiles \
  -H "content-type: application/json" \
  -H "x-user-id: usr_local_dev_0001" \
  -H "idempotency-key: demo-birth-001" \
  -d "{\"accuracy\":\"exact\",\"consent_id\":\"${CONSENT_ID}\",\"birth_date\":\"1990-05-15\",\"birth_time_local\":\"12:34:00\",\"timezone_hint\":\"America/Los_Angeles\",\"birthplace\":{\"label\":\"Los Angeles\",\"latitude\":34.05,\"longitude\":-118.24}}"

curl -s http://127.0.0.1:8787/v1/chart \
  -H "x-user-id: usr_local_dev_0001"
```

`AUTH_STUB=1` (default `[vars]` in `wrangler.toml`) accepts **`X-User-Id`** for local development only. It is absent from `[env.production]`, and the `configGuard` middleware returns `503 configuration_error` for any request when `AUTH_STUB=1` or `ROOT_KEK` is unset/placeholder outside `ENVIRONMENT=development|test`. `npm run deploy` targets `--env production`.

The birth route then checks that `consent_id` is the **exact current**
account-processing grant (`loadExactCurrentAccountProcessingGrant`). A
placeholder, a revoked id, or a grant for a different policy is
`400 consent_invalid`. Revoke only from the privacy center
(`DELETE` plus `X-Consent-UI-Surface: privacy_center`); that freezes the
account. Regrant restores access without minting a new user.

Idempotency keys are scoped per user, so the static `demo-birth-001` above is safe across local users. Resubmitting the same birth data under a different key returns `409 chart_already_exists` rather than a 500.

### Birth calculation is bounded, and the bound applies locally too

Calculation runs inline inside `POST /v1/birth-profiles`, so both guards below
are on the request path — including in the local loop, because `[vars]` declares
the same values `[env.production.vars]` does.

| Variable | Value | Effect |
| --- | --- | --- |
| `CALC_FETCH_TIMEOUT_MS` | `"10000"` | The calc fetch is aborted at the deadline and answers the generic `502 calc_failed`. Range 1,000–30,000. |
| `BIRTH_CALC_DAILY_LIMIT` | `"5"` | At most five **actual** calc invocations per user per UTC day. Range 1–50. |

Both are required outside `ENVIRONMENT=development|test`. Omitting **both**
locally falls back to the defaults above; setting either one to a malformed or
out-of-range value is a `503 configuration_error` on every request — in
development too, so the parse that must never be wrong is never the parse that
went unexercised.

The sixth calculating request in a UTC day returns `429`, writes no birth
profile and no job row, and never reaches calc:

```json
{
  "error": {
    "code": "birth_calc_budget_exhausted",
    "message": "The daily birth calculation limit has been reached",
    "request_id": "req_...",
    "details": { "resets_at": "2026-08-28T00:00:00.000Z" }
  }
}
```

`Retry-After` carries the seconds remaining until that UTC midnight. Only
requests that actually invoke calc are charged — validation failures,
idempotency conflicts, and replays of a `succeeded`, `queued`, or `running` job
are free, and two concurrent copies of one attempt consume one unit between
them. A retry of a *failed* job must match the original encrypted birth request
and does consume another unit; a charged timeout or upstream failure is not
refunded, because the upstream spend already happened.

Latency and denial are recorded as the closed `birth_calc_completed` and
`birth_calc_budget_exhausted` events. Making the workflow asynchronous is
deliberately deferred behind measured thresholds — see
[`docs/deploy/birth-calc-slo.md`](docs/deploy/birth-calc-slo.md).

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

### Place-name search stays off until an operator flips it

`POST /v1/places/search` and `POST /v1/places/resolve` exist, plus a separate
geocoder consent (`AST-02`). The browser never calls Google; the Worker talks
to Places Autocomplete (New) and Geocoding API v4. Committed configuration
keeps `GEOCODER_ROLLOUT = "off"` in both the development block and
`[env.production.vars]`, so those routes — and the consent GET — answer
`503 geocoder_unavailable`. Manual label + coordinates remain the complete
fallback. Enabling it is a configuration change, not missing code: see
[`docs/decisions/2026-08-26-geocoder-provider.md`](docs/decisions/2026-08-26-geocoder-provider.md).

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

- [x] Monorepo + local merge gate (`npm run ci:local`; GitHub Actions is billing-locked on this account)
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
- [x] Privacy center export/delete workflows, including encrypted artifacts and terminal deletion status
- [x] Bounded birth calculation: a validated fetch deadline, a 1 MiB response ceiling, and an exact per-user UTC-day invocation budget that charges only requests which actually call calc. Entry criteria for making the workflow asynchronous are recorded in [`docs/deploy/birth-calc-slo.md`](docs/deploy/birth-calc-slo.md) and none has been measured
- [x] Migration `0016_birth_calc_usage.sql` applied to the remote database 2026-08-27. Worker version `287bce63-dece-4911-96db-dd212c2cec33` serves the budget guard.
- [x] Place-name geocoding: Worker adapter and consent exist; committed `GEOCODER_ROLLOUT = "off"` in development and production, so typing a city still requires coordinates until an operator enables it
- [x] Persisted `account_processing` consent: onboarding grants policy `account-processing-v1-2026-08-28`; `accountStateGate` requires the current grant on every product path except the enumerated recovery routes; birth stores that exact `consent_id`

## M2 status — editorial control plane

- [x] Cloudflare ingestion: `POST /internal/content-releases` verifies, stores, and activates signed bundles (see below)
- [x] Release rollback by re-posting a stored bundle; activation and rollback are one D1 transaction with their audit row
- [ ] WordPress.com plugin and content types — the authoring side that produces the bundles
- [ ] Smoke-test fixture ingestion: the M3 evaluator exists in `packages/reading-engine`, but the ingestion route does not call it, so a bundle declaring `fixtures` remains inactive

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
- `accepted_pending_tests` — stored but not live, either because `activate: false` was sent or because the bundle declares eligibility `fixtures`. The evaluator exists, but it is not wired into ingestion; activating on tests the route did not run would be a claim, not a result.
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

## Deploying the calculation service to Fly.io

One active Fly app deploys from this repo. **Run the command from the repository
root** — the Docker build context must remain the root so the Dockerfile can copy
`package.json`, `package-lock.json`, `tsconfig.base.json`, and
`packages/shared`. The API and PWA ship together as one Cloudflare Worker backed
by D1.

| App | Serves | Config | Deploy |
| --- | --- | --- | --- |
| `patternlike-calc` | Swiss Ephemeris calc service (`apps/calc-stub`) | `fly.toml` | `fly deploy` |

> **Do not** run `fly deploy` from inside an app directory and do not pass
> `--build-context`. The calc Dockerfile expects root-level workspace files.
> `fly.web.toml` is the retired PWA deployment; using it would resurrect the
> superseded `patternlike-app` service.

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
