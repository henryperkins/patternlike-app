# Pattern-Like Astrology App

Cloudflare-first psychological timing product. **Swiss Ephemeris** is calculation authority; editorial content ships via signed WordPress releases; Fly.io is portable compute (not launch-critical).

**Spec:** `spec-bundle/` (v0.2) · **Contracts:** `contracts/m0/` · **D1:** `db/d1/`

## Monorepo

| Path | Role |
| --- | --- |
| `apps/api` | Cloudflare Worker (Hono) — birth/chart M1 path |
| `apps/calc-stub` | Portable calc OCI-shaped service (stub until SE licensed) |
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
```

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

`AUTH_STUB=1` (default in `wrangler.toml`) accepts **`X-User-Id`** for local development only.

## Swiss Ephemeris (`apps/calc-stub`)

| Pin | Value |
| --- | --- |
| Engine | Swiss Ephemeris **2.10.03** via `sweph@2.10.3-7` |
| Flags | `SEFLG_SWIEPH \| SEFLG_SPEED` |
| Houses | Placidus primary, Porphyry fallback |
| Node | True lunar node |
| Data | `data/ephe/sepl_18.se1`, `semo_18.se1` (1800–2400) |

```bash
npm run ephe:download -w @patternlike/calc-stub   # official aloistr/swisseph files
npm run calc:dev
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/engine
```

**License (M0 — decided):** **AGPL public Swiss Ephemeris** path.

| Item | Value |
| --- | --- |
| Decision | [`docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md`](docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md) — **`DECIDED` / AGPL** |
| Calc service | [`apps/calc-stub/LICENSE`](apps/calc-stub/LICENSE) — **AGPL-3.0-or-later** |
| Source offer | [`docs/legal/AGPL_SOURCE_OFFER.md`](docs/legal/AGPL_SOURCE_OFFER.md) |
| Notices | [`NOTICE`](NOTICE) |
| Runtime | `SE_LICENSE_MODE=agpl` (default) |

Counsel should still review AGPL network obligations and app-store strategy before public end-user launch. Production boot still refuses `SE_LICENSE_MODE=pending`.

## M1 status

- [x] Monorepo + CI
- [x] M0 contracts validation in CI
- [x] D1 core schema with encryption CHECKs
- [x] Birth profile + chart calculation path
- [x] Unknown birth-time mode (no silent noon as stored instant)
- [x] Real Swiss Ephemeris 2.10.03 + golden fingerprint tests
- [x] SE licensing decision: **AGPL public path** (counsel + store strategy still open)
- [ ] Historical TZ geocode connectors (IANA zone via luxon is local-only)
- [ ] Production identity provider
- [ ] Privacy center export/delete workflows (API stubs 501)

## Architecture profile

`cloudflare-first-wordpress-editorial-fly-portable-v1` — see `spec-bundle/pattern_like_astrology_app_platform_topology_v0.2.yaml`.
