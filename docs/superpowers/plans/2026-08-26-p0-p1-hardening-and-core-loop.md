# P0/P1 Hardening and Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P0 production-safety gaps and the P1 onboarding, reading-history, and save gaps without introducing the deferred asynchronous birth workflow.

**Architecture:** Execute four independently reviewable workstreams behind one dependency and migration sequence: birth operational guards, a resumable crypto operator control plane, device/place onboarding, and the reading library. Public additions ship in a new additive M8 contract package; operational state stays in D1; sensitive place and key material remains encrypted; all existing M0–M7 documents remain byte-identical.

**Tech Stack:** TypeScript strict ESM, Hono, Cloudflare Workers, D1, React 19, Vite, Vitest/workerd, JSON Schema 2020-12, OpenAPI 3.1, Python contract validation

## Global Constraints

- Keep `contracts/m0` through `contracts/m7` byte-identical. Add public P0/P1 wire documents under `contracts/m8` with `schema_version: "0.8.0"`.
- Reserve migrations in this exact order: `0016_birth_calc_usage.sql`, `0017_crypto_operations.sql`, `0018_place_resolutions.sql`, `0019_reading_saves.sql`.
- Migration 0016 bumps `db/d1/MIGRATIONS.json.schema_version` to `"0.8.0"`; 0017–0019 retain it.
- Every migration extends `contracts/smoke_check.py` with exact table, column,
  index, CHECK/foreign-key, and clean-apply assertions.
- Apply each migration to the remote database before merging code that queries it. Workers Builds deploys merged Worker code automatically and does not wait for D1 migrations. **Apply from the branch checkout rather than splitting a schema-only PR** — `migrations_dir = "../../db/d1"` is set in both Wrangler blocks, so `wrangler d1 migrations apply` works on an unmerged branch, and this is how `0011` and `0015` were sequenced. Applying additive tables nothing references yet is safe at any time; deploying code ahead of schema is not.
- **A migration that adds a user-owned table cannot be merged apart from its `deletion-manifest.ts` registration.** `deletion-manifest.test.ts` walks `PRAGMA foreign_key_list` and `PRAGMA table_info` over the live test database, so an applied-but-unclassified `users` foreign-key child fails three tests immediately; and `deleteAccountData` runs `DELETE FROM ${table} WHERE user_id = ?` over `DELETED_USER_TABLES`, so a registration that ships before its table exists breaks account deletion. The two must land in the same commit. This was verified against `0016` and applies equally to `0018` (`place_resolutions`) and `0019` (`reading_saves`).
- Do not implement the deferred birth queue/workflow. Keep synchronous calculation and the existing `202` response until the latency thresholds in the birth-guards plan require a separate design.
- Authorize at most five actual birth-calc invocations per user per UTC day. Validation failures and replays that do not invoke calc are free; failed-job retries consume another unit and must match the original encrypted request; spent units are never refunded.
- Bound `/v1/calculate` at 10,000 ms in production and return only the existing generic `calc_failed` product error on timeout.
- Never expose crypto operations through `/v1`, `/internal`, `/admin`, `PATTERN_ADMIN_TOKEN`, or the shared editorial `SERVICE_AUTH_TOKEN`. Use a dedicated `/crypto-operator/*` path family and `CRYPTO_OPERATOR_TOKEN`, and reject secret aliasing.
- Version the root KEK independently from `KEK_DERIVATION_VERSION`; do not make a mixed-key rewrap campaign depend on downtime or an unrecorded “one pass.”
- Require a frozen and quiescent account before DEK rotation. A rotation interrupted after its first ciphertext update is resumable, not cancellable.
- Place-search queries and provider payloads never enter D1, logs, URLs, analytics, or audit detail. Persist only a selected normalized place, encrypted under the user DEK.
- Manual latitude/longitude entry remains available when geocoding is unavailable or declined.
- Treat a Save as revision-specific user state keyed by `reading_id`; do not reinterpret ordinary reading persistence as a Save.
- Saved-reading metadata is portable user data and must appear in account export.
- Use test-first development for every behavior change and preserve the owner-scoped query invariant (`WHERE ... AND user_id = ?`) on every new product read.

## Plan Set

| Workstream | Detailed plan | Deliverable |
| --- | --- | --- |
| P0 birth safety | `docs/superpowers/plans/2026-08-26-birth-operational-guards.md` | Timeout, exact per-user spend guard, safe telemetry, async trigger thresholds |
| P0 crypto operations | `docs/superpowers/plans/2026-08-26-crypto-operator-control-plane.md` | Root-key keyring, fleet rewrap campaign, resumable per-user DEK rotation, runbooks |
| P1 onboarding | `docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md` | Device preference sync, geocoder decision and adapter, selected-place cache, uncertainty propagation |
| P1 reading library | `docs/superpowers/plans/2026-08-26-reading-history-and-save.md` | Reading-by-id, cursor history, revision-specific Save, export, History UI |

## Fixed Cross-Workstream Interfaces

### Migration ownership

```text
0016  birth_calc_daily_usage + birth_calc_reservations
0017  user_keys.root_kek_id + crypto_operations + crypto_kek_rewrap_campaigns/items
0018  place_resolutions
0019  reading_saves
```

No workstream may opportunistically consume another number. If an emergency migration lands first, renumber all four reservations together before any of them merges and update every detailed plan in the same commit.

### M8 contract ownership

`contracts/m8` is created once, in the onboarding workstream’s contract task, and then extended by the reading-library contract task before the package is frozen. It contains:

```text
common.schema.json
place-search.schema.json
place-resolution.schema.json
reading-history.schema.json
reading-save-state.schema.json
account-export.schema.json
openapi/openapi.yaml
fixtures/valid/*
fixtures/invalid/*
SCHEMA_MANIFEST.json
```

The M8 OpenAPI amendment also records `429 birth_calc_budget_exhausted` on `POST /v1/birth-profiles`. Internal crypto routes are intentionally absent from the consumer OpenAPI document.

### Shared public types

Create focused files and re-export them from `packages/shared/src/index.ts`:

```ts
export * from "./m8-place-types.js";
export * from "./m8-reading-history-types.js";
```

Do not grow the already broad root `index.ts` with inline M8 structures.

## Dependency Order

| Order | Gate | Can run in parallel |
| --- | --- | --- |
| 1 | Approve geocoder rights/provider decision | Birth timeout tests; crypto keyring design tests; device sync |
| 2 | Assemble and freeze M8 type/endpoint shapes once | Land/apply `0016` |
| 3 | Ship birth timeout, budget, and telemetry | Land/apply `0017` |
| 4 | Ship root-key keyring and crypto operator routes | Reading-history implementation |
| 5 | Land/apply `0018`; ship place API | Reading-history read-only API |
| 6 | Ship autocomplete and uncertainty | Land/apply `0019` |
| 7 | Ship Save API/export and History UI | None |
| 8 | Full repository verification and staged production checks | None |

P1 may be developed while P0 is under review, but production rollout of P1 waits until the P0 verification gates pass.

---

### Task 1: Freeze the additive M8 consumer contract

**Source tasks:**
- Execute first: onboarding plan Task 2 (provider decision).
- Execute once: onboarding plan Task 3 (M8 place/common foundation).
- Extend that same uncommitted package: reading-library plan Task 1.
- Extend that same OpenAPI file: birth-guards plan Task 3’s 429 response.

**Interfaces:**
- Produces: the exact public request/response types consumed by both P1 workstreams.
- Records: the P0 birth-route `429` without changing M0.

- [ ] **Step 1: Approve the geocoder decision**

Do not create provider-shaped contract fields before the rights/privacy/caching
gate names the provider and permitted persisted projection.

- [ ] **Step 2: Create M8 exactly once**

Follow onboarding Task 3 to create common/place schemas and shared types. Before
committing, follow reading Task 1 to add reading/history/export schemas and
types, then add the birth `429`. Do not let each subplan create a separate M8
manifest or OpenAPI copy.

- [ ] **Step 3: Add failing validation before implementation**

Extend `contracts/validate_schemas.py` additively. Register `M8_BASE`, map every
fixture prefix, verify exact predecessor hashes, all required route/method
pairs, M8 export supersession of M7, and the birth `429`.

- [ ] **Step 4: Run contract and shared verification**

```bash
npm run test:contracts
npm test -w @patternlike/shared
npm run typecheck -w @patternlike/shared
```

Expected: all pass; M0–M7 bytes and recorded hashes remain unchanged. M8 does
not supersede stored M3/M5 reading artifacts, but its account-export document
does supersede newly generated M7 exports.

- [ ] **Step 5: Commit**

```bash
git add contracts/m8 contracts/validate_schemas.py packages/shared/src/m8-place-types.ts packages/shared/src/m8-reading-history-types.ts packages/shared/src/index.ts
git commit -m "contracts: add M8 core-loop amendments"
```

---

### Task 2: Execute the P0 birth operational-guards plan

**Plan:** `docs/superpowers/plans/2026-08-26-birth-operational-guards.md`

- [ ] Implement its timeout and telemetry task.
- [ ] Land and apply `0016_birth_calc_usage.sql` using the schema-first sequence.
- [ ] Implement the reservation-aware five-per-UTC-day budget.
- [ ] Add the M8 `429` response projection and web-facing error copy.
- [ ] Run every focused and full verification command in the detailed plan.
- [ ] Record production thresholds without enabling asynchronous birth processing.

Completion gate: a hanging calc returns generic `502` within the configured
deadline; the sixth actual calc invocation in one UTC day returns `429`;
succeeded/running/concurrent replays are free, while a failed-job retry is body
bound and charged.

---

### Task 3: Execute the P0 crypto operator-control-plane plan

**Plan:** `docs/superpowers/plans/2026-08-26-crypto-operator-control-plane.md`

- [ ] Land and apply `0017_crypto_operations.sql` using the schema-first sequence.
- [ ] Ship root-key keyring compatibility before any campaign route.
- [ ] Ship dedicated crypto-operator authentication and anti-alias checks.
- [ ] Ship resumable fleet rewrap and per-user DEK-rotation stage machines.
- [ ] Verify more than 100 encrypted rows without exceeding D1’s statement bound.
- [ ] Rehearse both runbooks against local D1 with two root-key ids.

Completion gate: removing an old root key is refused while any live `user_keys` row names it; an interrupted DEK rotation resumes from mixed old/new ciphertext while the account remains frozen; `SERVICE_AUTH_TOKEN` cannot authorize either operation.

---

### Task 4: Execute the P1 device/place onboarding plan

**Plan:** `docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md`

- [ ] Ship device-derived timezone/locale sync independently.
- [ ] Complete the geocoder rights/privacy/caching decision record before adapter code.
- [ ] Land and apply `0018_place_resolutions.sql`.
- [ ] Ship authenticated place search and selected-candidate resolution.
- [ ] Ship the accessible autocomplete with manual fallback.
- [ ] Propagate trusted selected-place and timezone confidence into chart uncertainty.
- [ ] Verify Today retries after the foreground sync settles.

Completion gate: a fresh signed-in account moves from `default_unconfirmed` to `device_derived`; a user-selected preference remains locked; selecting “Los Angeles” fills trusted coordinates and resolves the historical zone; manual coordinates still work; low confidence appears in the stored uncertainty and chart UI.

---

### Task 5: Execute the P1 reading-library plan

**Plan:** `docs/superpowers/plans/2026-08-26-reading-history-and-save.md`

- [ ] Ship owner-scoped reading-by-id and canonical per-day history first.
- [ ] Land and apply `0019_reading_saves.sql`.
- [ ] Ship idempotent Save state and portable export metadata.
- [ ] Ship History navigation, detail reuse, Saved filtering, evidence, and feedback.
- [ ] Verify published, superseded, and invalidated revision behavior.

Completion gate: history pages without duplicates; a specific saved revision survives reload and appears in export; unsaving does not remove prose; foreign ids remain indistinguishable from unknown ids.

---

### Task 6: Run the program-level verification and rollout gates

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/archive/README.md`
- Modify: `docs/deploy/api-production.md`
- Modify: `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md`

- [ ] **Step 1: Update status documentation only after each runtime slice passes**

Mark timeout/rate limiting/rotation caller/device sync/place search/uncertainty/history/save complete only when their acceptance tests pass. Keep Stream 8 asynchronous birth explicitly deferred.

- [ ] **Step 2: Run the full automated gates**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all pass. Review the entire output; warnings about production bindings, migration order, or Worker assets are failures to investigate rather than noise to ignore.

- [ ] **Step 3: Run migration integrity checks**

Against a clean local database and a populated pre-0016 fixture:

```sql
PRAGMA foreign_key_check;
PRAGMA quick_check;
SELECT * FROM assertion_probe;
```

Expected: zero foreign-key rows, `quick_check = ok`, and an empty assertion probe.

- [ ] **Step 4: Perform the UI walkthrough**

Using the real local web/API stack:

1. Sign in with a fresh account and observe device-derived preferences.
2. Create a chart by place search and inspect the resolved zone and uncertainty.
3. Create or seed two dated readings.
4. Save Today, open History, filter Saved, open the reading, evidence, and feedback.
5. Unsave and verify the reading remains in History.

Capture one concise demo video under `/opt/cursor/artifacts`.

- [ ] **Step 5: Roll out schema-first**

For each migration:

1. Export and bookmark production D1.
2. Merge the migration-only PR.
3. Apply the migration remotely from the repository root:

   ```bash
   npx wrangler d1 migrations apply patternlike-ops \
     --config apps/api/wrangler.toml --env production --remote
   ```

4. Verify schema, foreign keys, quick check, and `assertion_probe`.
5. Merge the runtime PR.
6. Exercise only the new route with an internal account.

- [ ] **Step 6: Commit the final status update**

```bash
git add README.md docs/superpowers/archive/README.md docs/deploy/api-production.md docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md
git commit -m "docs: record P0 and P1 completion"
```

## Program Definition of Done

- [ ] Every detailed plan’s focused tests pass.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass from repository root.
- [ ] M0–M7 hashes remain unchanged and M8 validation passes.
- [ ] Migrations 0016–0019 apply in order to clean and populated databases.
- [ ] Every new user-owned table is classified for deletion and portability.
- [ ] Every new encrypted D1 column is registered in `ENCRYPTED_COLUMNS`.
- [ ] No raw place query, provider response, birth value, key material, or crypto exception enters logs.
- [ ] Production runbooks include preflight, execution, verification, rollback/forward-repair, and secret-retirement gates.
- [ ] The deferred async birth workflow remains deferred and has measurable entry criteria.
- [ ] The UI walkthrough demonstrates device sync, place selection, uncertainty, History, Save, evidence, and unsave.
