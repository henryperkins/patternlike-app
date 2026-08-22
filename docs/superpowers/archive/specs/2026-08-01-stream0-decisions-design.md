# Stream 0 — Decision Record

> **ARCHIVED 2026-08-22 — decided and implemented.** Streams 1, 2, 4, and 5 all
> landed. Kept as the rationale record: decision 0.2's `crypto_subject` split is
> still cited from `apps/api/src/db/users.ts`. Index: [`../README.md`](../README.md).

> **Status when written: DECIDED, not implemented.** This resolves the five open decisions in
> [`../../plans/2026-08-01-backend-completion-roadmap.md`](../../plans/2026-08-01-backend-completion-roadmap.md)
> §"Stream 0", plus one sub-decision that surfaced while resolving them. Each
> affected stream still needs its own task-level plan per `superpowers:writing-plans`.

**Scope:** what to build and why. Not how — no step-by-step, no test bodies.

**Why these five were blocking:** Streams 1, 2, 4, and 5 each depend on an answer
that is a product, legal, or architectural call rather than an engineering one.
Decision 0.2 additionally cannot be revisited after the first real user, because
`users.id` is bound into every ciphertext at rest.

---

## The correction that reorders everything

The roadmap states that outside `AUTH_STUB=1` a request reaches `authStub` and
receives a 401 or a 501. **It does not.** `internal` is mounted at the root
prefix (`apps/api/src/index.ts:30`) *before* `api` (`:31`), so its
`use("*", serviceAuth)` matches every path in the application.

Executed against the repo's installed Hono 4.12.32, reproducing `index.ts`'s
exact registration order:

```
GET  /health                     -> chain: (none)
GET  /v1/meta                    -> chain: (none)
GET  /v1/chart                   -> configGuard(internal) -> serviceAuth -> configGuard(api) -> authStub
POST /v1/birth-profiles          -> configGuard(internal) -> serviceAuth -> configGuard(api) -> authStub
POST /internal/content-releases  -> configGuard(internal) -> serviceAuth
```

Consequences:

- In production with `SERVICE_AUTH_TOKEN` set — which `.env.example` and
  `wrangler.toml:51` both instruct — **every** `/v1/*` request is checked against
  the *service* token. A consumer bearer token is compared to `SERVICE_AUTH_TOKEN`
  and rejected with `401 unauthorized` before any identity middleware runs.
- Without `SERVICE_AUTH_TOKEN`, every `/v1/*` request outside development gets
  `503 service_auth_not_configured` (`auth.ts:70-85`), not the documented 501.
- Following the repo's own written deploy steps therefore breaks the consumer API.
- Roadmap Stream 3 task 1 proposes reusing `SERVICE_AUTH_TOKEN` for the calc
  service — a third consumer of a variable whose blast radius is already wrong.

**This is a prerequisite for Stream 1, not part of it.** `internalRoutes`
declares absolute paths, so both halves move together:

| File | From | To |
|---|---|---|
| `apps/api/src/routes/stubs.ts:65` | `"/internal/content-releases"` | `"/content-releases"` |
| `apps/api/src/index.ts:30` | `app.route("/", internal)` | `app.route("/internal", internal)` |

Verified by the same probe:

```
GET  /v1/chart                   -> configGuard(api) -> authenticate
POST /internal/content-releases  -> configGuard(internal) -> serviceAuth
```

It must land with a regression test **before** Stream 1, or Stream 1's tests
encode the defect as expected behaviour.

---

## Verified facts these decisions depend on

Confirmed by executing code or reading the cited line, not by inference.

| Fact | Evidence |
|---|---|
| `serviceAuth` runs on every `/v1/*` request, before `authStub`; the `/internal` prefix fix isolates it | Hono 4.12.32 probe reproducing `index.ts:12,:16-21,:25-31` |
| The AAD binds ciphertext to `["patternlike.aead", 1, userId, field, recordId, keyVersion]` | `apps/api/src/crypto.ts:136-147` |
| DEK wrapping binds to a second, distinct array `["patternlike.dek", 2, userId, keyVersion]` | `apps/api/src/crypto.ts:150-159` |
| `userId` enters both as a raw UTF-8 string — never hashed, padded, or parsed. Format and length are cryptographically free; only byte-stability matters | `crypto.ts:136-159`; `aead.test.ts:68-79` |
| `users.status` already permits `'frozen'`, `'pending_deletion'`, `'deleted'`, and nothing reads it | `db/d1/0001_m0_core.sql:19-20`; `db/users.ts:16-31` |
| `chart_snapshots.status` permits only `active`/`superseded`/`invalid` | `db/d1/0001_m0_core.sql:157-158` |
| AST-01 birth profile is `status: required`, permission tier 0 `default: required`, `raw_retention: Until account deletion or profile replacement` | `spec-bundle/…data_source_registry_v0.2.yaml:84-96, :122-150` |
| Spec: `"Revocation is immediate for future jobs; show completion state."` | `spec-bundle/_docx_extract.txt:139` |
| Spec: `"Disable route, invalidate sessions, review affected IDs."` is a required recovery control | `spec-bundle/_docx_extract.txt:578` |
| Spec: `"Choose an OIDC/passkey/magic-link implementation. Do not require a WordPress.com account for ordinary users."` | `spec-bundle/_docx_extract.txt:807` |
| Spec: `"Unencrypted user exports or direct public database access."` is prohibited | `spec-bundle/_docx_extract.txt:618` |
| Spec: deletion is `"Freeze jobs, revoke tokens, delete rows/objects, destroy DEK, audit."` | `spec-bundle/_docx_extract.txt:440` |
| Spec: `chart_snapshots` retention is `"Immutable; active plus lineage."`; `audit_events` `"13 months minimum target."` | `spec-bundle/_docx_extract.txt:466, :494` |
| `apps/api` has exactly two runtime deps (`hono`, `@patternlike/shared`); installed Hono is 4.12.32 | `apps/api/package.json`; `node_modules/hono/package.json` |
| Identity needs **no new runtime dependency** — `Jwt.verifyWithJwks` and `hono/cookie` both ship in the installed Hono 4.12.32 | `node_modules/hono/dist/types/utils/jwt/jwt.d.ts`; package exports |
| **But the declared `^4.7.10` floor is too low and must be raised to `^4.12.32`.** At 4.7.10 the function is named `verifyFromJwks`, there is no `allowedAlgorithms` option, and `verify` takes only `alg?` — so it **cannot check `iss` or `aud` at all**. The subpath exports exist at the floor; the API does not | unpacked `hono@4.7.10` tarball: `verify: (token, publicKey, alg?)`, `verifyFromJwks` |
| `verifyWithJwks` **re-fetches the JWKS on every call** when given `jwks_uri`. The spec's module-scope cache requirement therefore means fetching the key set ourselves and passing `keys:`, not `jwks_uri:` | `node_modules/hono/dist/utils/jwt/jwt.js`, `verifyWithJwks` body |
| `isDevEnvironment` returns true for **both** `"development"` and `"test"` | `apps/api/src/crypto.ts:56-58` |
| The schema has 21 tables and **16** of them carry `REFERENCES users(id)` — so an id change is a 16-table cascade, several into unique indexes | `grep -c` over `db/d1/0001_m0_core.sql` |

Read but not independently re-executed; the implementation plans must re-verify
line numbers before editing:

| Fact | Evidence |
|---|---|
| Nothing in `apps/` reads or writes `identities`, `consents`, `export_requests`, or `deletion_requests` | grep over `apps/` |
| No sessions table and no credential table exist anywhere in the schema, so `identities` does **not** "already model either" 0.1 option as the roadmap claims — it has no column for credential material | `db/d1/0001_m0_core.sql:49-59` |
| `chart.ts` imports nothing from `db/users.js` and never touches the DEK | `apps/api/src/routes/chart.ts:1-85` |
| `wrapDek`/`unwrapDek` have six call sites, all in `db/users.ts` (`:120, :182, :333` / `:97, :174, :272`) | `apps/api/src/db/users.ts` |
| `cryptoRandom` falls back to `Math.random` when `getRandomValues` is absent | `packages/shared/src/index.ts:101-103` |
| `daily_readings.reading_key` uses `:` as a delimiter under a contract-pinned pattern, while `opaqueId` permits `:` | `contracts/m0/reading-evidence.schema.json:323`; `common.schema.json:16` |
| The frozen OpenAPI declares document-level `bearerAuth` (`type: http, scheme: bearer, bearerFormat: JWT`) | `contracts/m0/openapi/openapi.yaml:370-380, :903-904` |
| `SCHEMA_MANIFEST.json` makes only required fields, enums, and `$id` breaking | `contracts/m0/SCHEMA_MANIFEST.json:95-98` |
| `MIGRATIONS.json:12` records that `0001` is edited **in place** pre-production | `db/d1/MIGRATIONS.json:11-14` |
| `wrangler.toml:29` records that named environments do not inherit top-level bindings | `apps/api/wrangler.toml:29` |
| `apps/web` is entirely untracked while root `package.json` already references `-w @patternlike/web` | `git ls-files apps/web` → 0; `package.json:11-13` |

---

## 0.1 — Identity provider

**Decision: hosted OIDC provider, verified once at a session-exchange endpoint,
then a Worker-minted opaque session bearer.**

The spec names three mechanisms, not two, and prohibits requiring a WordPress.com
account for ordinary users — which rules out the cheapest IdP already in the stack.

Two facts eliminate the roadmap's stateless-JWKS framing:

1. `"invalidate sessions"` is a **required** recovery control. A statelessly
   verified IdP access token gives the Worker no way to invalidate anything;
   revocation would depend entirely on the IdP's admin API and on token TTL.
2. The platform topology declares a native `mobile` component. A cookie-only
   session design cannot serve it.

A local session satisfies both: the Worker owns revocation, and the token is a
bearer that any client can present.

### Shape

- **`POST /v1/sessions`** — body carries an OIDC ID token. Verify signature
  against cached JWKS, plus `iss`, `aud`, `exp`, `nbf`. Reject with the standard
  error envelope, never the underlying library message.
- Resolve `identities(provider, provider_subject)` → `user_id`. On first sight,
  mint the identifiers (§0.2) and insert `users` + `identities` in one D1 batch.
  Identity linking is an implicit side effect of the first successful exchange,
  not a separate client call.
- Mint a session: store `sha256(token)` in a new `sessions` table, **never** the
  raw token. Return the token and its expiry.
- **`authenticate`** replaces `authStub`. The `AUTH_STUB=1` development branch is
  kept verbatim; the 501 becomes a session lookup returning
  `{ userId, cryptoSubject, status }` in a single read.
- Session revocation is a row update. Revoking every session for a user is one
  statement — that is what discharges the recovery control.

**`POST /v1/sessions` mounts outside the authenticated router.** It cannot sit
behind `authenticate`, which would require the session it exists to create. It
still sits behind `configGuard`.

### Configuration

New: `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`. Each must be added to
`env.ts`, `wrangler.toml`, **and** `checkSecureConfig`. `SE_LICENSE_MODE` is
already set in `wrangler.toml:27` and absent from `Env` — the interface does not
stay in sync on its own, and a missing JWKS URL that fails per-request inside the
verifier instead of at the guard is a bad failure mode.

### Deployment rule

**A staging environment must not be named `test`.** `isDevEnvironment` returns
true for `"development"` and `"test"` alike, so `ENVIRONMENT=test` fully bypasses
`configGuard` and re-enables header-trusted auth. `README.md:68` and
`.env.example:3` state this correctly; the roadmap's "outside development" is loose.

### Rejected

- **Stateless JWKS verification of IdP tokens.** Cheapest to build — zero tables,
  zero deps, zero contract change — but fails the invalidate-sessions control.
- **Passkeys + D1 sessions.** No vendor and native invalidation, but a new
  dependency, at least two new tables, and an account-recovery path that would
  likely be magic-link anyway. The roadmap's claim that `identities` "already
  models either" is wrong: it has no column for credential material.
- **Magic-link.** Named by the spec and absent from the roadmap. Rejected on
  operational grounds — email deliverability becomes availability — and because
  it introduces an email address as a new PII class with no registry entry.

---

## 0.2 — Internal user id derivation

**Decision: two identifiers. A mutable `users.id` label and an immutable
`users.crypto_subject` that alone feeds the AEAD context and DEK wrapping.**

```
users.id             usr_<32 hex>   label: logs, calc service requests, reading_key
users.crypto_subject cs_<32 hex>    immutable: AAD + wrapDek/unwrapDek only
```

### Why two

The format question was never open. Three independent written policies already
require an opaque, non-derived identifier:

- `platform_topology_v0.2.yaml:88` forbids `stable direct identifiers` at the LLM
  boundary.
- `spec.md:229`: `"Error events use opaque user/job IDs and source error classes."`
- `packages/shared/src/index.ts:70`: `/** Opaque ids safe for app data plane (not LLM prompts). */`

What *was* open is whether the crypto binding is reversible. Today it is not, and
the failure is worse than the roadmap documents: `readLiveKey` is keyed on
`user_id`, so a rename that does not cascade into `user_keys` causes
`ensureUserKey` to **silently mint a fresh DEK** and return 200, orphaning all
prior ciphertext with no error anywhere. Only the cascaded case fails loudly.

The indirection costs nothing to add now and cannot be added later. Its runtime
cost is zero because 0.1's session lookup already returns both values in one read.
It converts an id change from "decrypt and re-encrypt everything under the old
identity, across 16 foreign-key tables, via a `migrateUserId` that does not exist"
into an `UPDATE`.

This matters more than it appears because `users.id` leaks by design: it is sent
in cleartext to the calc service (`routes/birth.ts:267`), and
`UserKeyDestroyedError`/`NoUserKeyError` interpolate it into `err.message`
(`db/users.ts:36, :55`), which `onError` logs (`index.ts:44-45`). Leaking is
precisely the reason one would want to rotate it — and that error fires on the
first request from a *deleted* account, writing that user's id into logs.

### Consequences

- A branded `CryptoSubject` type, so `encryptPayload(userId, …)` is a compile
  error rather than a silent AAD mismatch. `encryptPayload` currently takes the
  key-lookup id and the AAD context as separate arguments with no cross-check.
- `cryptoRandom` must hard-require `getRandomValues`. The `Math.random` fallback
  is acceptable for job ids and not for a permanent primary key.
- Both formats **exclude `:`** — `daily_readings.reading_key` uses `:` as a field
  delimiter over a UNIQUE column with a contract-pinned grammar, while `opaqueId`
  permits it. `newId(prefix)` already emits a conforming `prefix_<32hex>` shape.
- `ensureUser` asserts rather than inserts; creation moves to identity-link time.
  This also removes its non-atomic SELECT-then-INSERT race.
- `ensureUserKey` **fails closed** when a `users` row exists with no `user_keys`
  row, instead of minting. This is what makes a botched migration loud.
- `ENCRYPTED_COLUMNS` and `assertNoUnrotatedCiphertext` cover 2 and 1 of the six
  declared `*_enc` columns respectively. `MIGRATIONS.json:14` already records the
  rule that new encrypted columns must be registered; nothing enforces it. The
  gap is enforcement, and it belongs in CI.

---

## 0.3 — Same-origin or CORS

**Decision: same-origin. `apps/web`'s asset Worker gains a router that forwards
`/v1/*` to the API over a service binding. No CORS code.**

The web client is already written for it: `apiBaseUrl` defaults to `""`, every
path is relative, and `apps/web/public/sw.js:25` guards `/v1/` as same-origin.
Choosing same-origin requires **zero client change**. Choosing CORS requires a
build-time `VITE_API_BASE_URL` that is undocumented and unset, an origin
allowlist that cannot be written because neither wrangler config declares a
hostname, and — because `Authorization` is a non-simple header — a preflight on
every request.

The current deployed failure mode is worse than a CORS error: `apps/web`'s Worker
is assets-only with `not_found_handling: "single-page-application"`, so a deployed
web Worker answers `GET /v1/chart` with `index.html` at HTTP 200.

### Scope the roadmap's file list misses

- **`run_worker_first: ["/v1/*"]` is mandatory.** With SPA fallback set, `/v1/*`
  otherwise resolves to `index.html` and the router never runs.
- **Per-environment service names.** The API is `patternlike-api-production` under
  `[env.production]`, so the binding target differs per environment. This likely
  forces `--env production` onto `apps/web`'s deploy script, which changes the
  deployed Worker name — a deliberate choice, not a mechanical one.
- **The router cannot live in `apps/web/src/`.** That tsconfig includes `src`
  wholesale with DOM-only types and no `@cloudflare/workers-types`, and `build`
  runs `tsc --noEmit` first. Put it outside `src` with its own tsconfig.
- **`apps/api/src/index.ts` needs no change at all.** The roadmap lists it as a
  Stream 2 file; that is true only in the CORS branch.
- **The commit is coupled.** Root `package.json` already references
  `-w @patternlike/web` while `apps/web` is untracked. Committing either alone
  breaks CI on `npm run typecheck`.
- CI never builds or tests `apps/web`, so the done-condition needs a real check
  rather than a green pipeline.

A public `api.patternlike.app` for the native client can be added later without
disturbing this, so it is not a Stream 0 decision. The OpenAPI already records
that hostname as an explicit placeholder.

### Session token presentation

**Decision: httpOnly cookie for the browser, bearer for native clients, one
session row behind both.**

`POST /v1/sessions` sets `HttpOnly; Secure; SameSite=Strict; Path=/v1` **and**
returns the token in the body. `authenticate` reads the cookie first, then
`Authorization: Bearer`. Both resolve the same `sessions` row.

Rationale: the data is classified `highly_sensitive`, and an httpOnly token is
unreadable to JavaScript, so an XSS on the PWA cannot exfiltrate a session.
Same-origin makes the cookie work with no CORS, and `SameSite=Strict` means
cross-site requests carry no credential at all. `hono/cookie` ships in-package,
so this costs no dependency. `api-client.ts:63` already hard-sets
`credentials: "include"` on every request — under this decision that line is
finally correct rather than a liability.

The OpenAPI gains a second `securityScheme`. Additive, therefore non-breaking.

---

## 0.4 — Consent revocation semantics

**Decision: revoking `account_processing` freezes the account. Data is retained,
unserved, and the state is reversible. Deletion remains a separate explicit act.**

### Why this and not per-chart suppression

`account_processing` maps to AST-01, which is permission tier 0
(`default: required`) and `status: required`. It is not an optional source a user
can switch off and keep using the product — the product *is* the chart. An
"active account with no chart" is an undefined state.

The spec's revocation language — `"Revocation is immediate for future jobs"` — is
written for context sources and answers them cleanly. A natal chart has no next
job; `GET /v1/chart` serves an existing row. So the answer must live at the
account level, and the spec supplies the vocabulary: the deletion workflow's
failure response is `"keep account frozen"`, and `users.status` has carried
`'frozen'` since the schema was written, unused.

`chart_snapshots` is declared immutable in two places — the contract enum
description and the retention table's `"Immutable; active plus lineage"` — so a
status-flip suppression would contradict a written commitment *and* cost a
`schema_version` bump, since enum changes are breaking.

### Behaviour

| Surface | Frozen account |
|---|---|
| `GET /v1/chart` | `403` — fails closed |
| `POST /v1/birth-profiles` | `403` |
| `POST /v1/exports` | **allowed** — portability is a right that survives revocation |
| `DELETE /v1/account` | **allowed** |
| `POST`/`PATCH /v1/consents` | **allowed** — re-granting unfreezes |

The gate lives in `authenticate`, which already reads `users.status` in the
session lookup. This is the same read-time gate Stream 5 needs, because
crypto-shredding alone leaves `GET /v1/chart` serving plaintext (see 0.5). Streams
4 and 5 therefore share a primitive, which the roadmap's dependency graph calls
independent.

### Consequences

- `POST /v1/consents` and `PATCH /v1/consents/:id` are new paths on the frozen
  OpenAPI. Additive, therefore non-breaking.
- `policy_version` is `NOT NULL` with no default and has no owner anywhere in the
  repo. It becomes a server-supplied constant, versioned alongside the policy text.
  The client does not choose it.
- **The consent link goes on `birth_profiles`, not `chart_snapshots`.** The
  roadmap contradicts itself here — task 3 says one, the done-condition says the
  other, and neither column exists. `birth_profiles` is what the consent
  authorized, and `chart_snapshots` already carries
  `FOREIGN KEY (user_id, profile_version)` into it, so the authorizing consent is
  one join away rather than a duplicated column.
- Revoked consent rows are **retained**. `audit_events` has a 13-month minimum
  retention target, and proof-of-consent and proof-of-revocation are the same
  record.
- The spec's `"show completion state"` obligation has no affordance today —
  `PrivacyView.tsx` has no revoke control at all. That is UI scope for Stream 4.

### Rejected

- **Chart-level suppression.** Leaves the user in a state with no working surface,
  and contradicts tier-0 `required`.
- **Revocation triggers deletion.** Collapses two actions the spec defines
  separately, makes revocation silently destructive in a way the onboarding
  checkbox never warned of, and inherits both open escalations in
  `docs/reviews/2026-08-01-spec-escalations.md` — the cascade that has nowhere to
  land, and crypto-shredding whose effectiveness is unproven while the wrapped DEK
  shares a D1 database with the ciphertext.

---

## 0.5 — Export artifact format

**Decision: a single AES-GCM-sealed JSON document, sealed at rest in R2, unsealed
by the Worker at download and streamed as readable JSON over TLS.**

The spec prohibits `"Unencrypted user exports"`, which is a statement about
objects at rest — a portability artifact the user cannot open is not portable.

### Shape

```
POST /v1/exports              -> 202 { resource_id }
  assemble -> AES-GCM seal under a per-export random key
  key wrapped by ROOT_KEK, not the user DEK
  -> R2  exports/{request_id}.json.enc
  -> expires_at

GET  /v1/exports/{id}          -> status
GET  /v1/exports/{id}/download -> unseal, stream JSON
```

- **Not the user's DEK.** Deletion destroys it, and an export that becomes
  unopenable the moment the user exercises erasure defeats the purpose.
- **The object key carries no user id** — `request_id` only. This avoids making
  R2 paths a third irreversible identity binding. It also sidesteps
  `user_partition`, which appears in the spec's object layout and in one
  contract description string and is defined nowhere.
- **An authenticated route, not a presigned URL**, so account state governs the
  download itself rather than a URL that outlives it. A **frozen** account may
  download — portability survives revocation, per 0.4. A **deleted** account
  cannot, because the objects are gone.
- **`.json.enc`, not `.zip.enc`.** The spec names `.zip.enc`, but the export
  currently covers five tables — only five have any writer — and fits one
  document. `apps/api` has no archive dependency and Workers have no zip writer;
  a hand-rolled central directory is ~100 lines of code and a test for no present
  benefit. Revisit when readings, journal, and rendered artifacts land. Note the
  spec is already internally inconsistent here: it names `.json.enc` for charts
  while `chart-contract.schema.json:563` says `.json`.

### Corrections to the roadmap that Stream 5 must carry

1. **`destroyUserKey` does not exist.** The roadmap says "the primitive already
   exists and is defensive." The *guard* exists — `ensureUserKey` throws on a
   destroyed key. The destroying primitive was never written. `rotateUserDek` sets
   `destroyed_at` but reinserts a replacement in the same batch, which is
   rotation. `uq_user_keys_active` permits a destroy-without-reinsert, since it
   only constrains rows where `destroyed_at IS NULL`.
2. **Crypto-shredding cannot satisfy the stated done-condition.** `chart.ts` never
   touches the DEK. After a shred it still returns 200 with the complete plaintext
   geometry — positions, house cusps, ascendant, midheaven, aspects — from which
   birth date, time, and longitude are largely derivable. The spec's own workflow
   says `"delete rows/objects"`, not shred alone. Deletion must delete rows, sweep
   the user's R2 objects, set `users.status='deleted'` and `deleted_at`, and
   destroy the DEK.
3. **The R2 binding must be declared twice.** `wrangler.toml:29` records that
   named environments do not inherit top-level bindings. Uncommenting `:13-16`
   binds `ARTIFACTS` in development only; production would deploy with
   `Env.ARTIFACTS` undefined and every export would fail at runtime. `env.ts:9`
   declares it optional, so TypeScript stays silent.
4. **The export cannot reuse the `GET /v1/chart` projection.** That response is
   not a contract-valid `chartSnapshot`: `chart.ts:70-78` hardcodes
   `birth.timezone: null`, but `timezone` is required inside `birth` and resolves
   to `{type: "string", minLength: 1}`. A contract-valid export must repopulate it
   from `birth_profiles.timezone` (clear) and decrypt `chart_snapshots.birth_enc`
   for the rest. The projection also silently drops `patterns`, which is written
   to `snapshot_json` and never served.
5. **`include_readings` and `include_journal` toggle data that does not exist.**
   `daily_readings` has no writer and there is no journal table in the schema.
   For M1 they are honoured trivially and the artifact carries explicit empty
   sections; the export schema documents this rather than implying coverage.

### Durations and residual semantics

These are reversible — unlike 0.2, they can be changed after launch — so they are
set here as concrete defaults rather than left open.

- **Export TTL: 7 days.** Nothing in schema, contract, README, or spec states a
  number; the spec says only `"short-lived"`. Seven days is long enough for a user
  to act on an email and short enough that a stale link is not a standing
  liability. Written to `export_requests.expires_at` by the application — the
  column has no default and the schema enforces nothing.
- **Session TTL: 30 days absolute, not sliding.** A sliding window on a bearer
  that unlocks `highly_sensitive` data means a stolen token renews itself
  indefinitely. Absolute expiry bounds the damage without a refresh-token
  mechanism the OpenAPI does not model.
- **Deletion removes in-flight exports.** The spec's workflow says
  `"delete rows/objects"`, and the user's R2 objects include any export not yet
  expired. A user who wants their data exports first; the ordering is theirs to
  choose. The download route fails closed afterwards regardless, since the account
  is gone.
- **The deletion proof record** is one `audit_events` row: `detail_class`
  `account_deleted`, the `users.id` label, the `deletion_request_id`, and a
  timestamp. No payload, no counts, nothing derived from the deleted data — the
  schema's own comment constrains `detail_class` to opaque classes, and under 0.2
  `users.id` is a label rather than the crypto identity.

---

## Cross-cutting consequences

### Migrations go into `0001`, in place

`MIGRATIONS.json:12` records this as the pre-production policy, and two in-place
edits were already performed on 2026-08-01. The roadmap's
`db/d1/0002_consent_link.sql` contradicts it.

This has a scheduling consequence the roadmap's graph does not show: **the schema
shape for 0.4 and 0.5 shares 0.2's deadline.** Adding `users.crypto_subject`, the
`sessions` table, and `birth_profiles.consent_id` are all one-line edits today and
all require a rewrite migration once real data exists.

Every schema edit must keep `python contracts/m0/smoke_check.py` passing, and
local databases must be recreated with `npm run db:local -w @patternlike/api`.

### Contract changes are additive

`GET /v1/exports/{id}`, the download path, `POST`/`PATCH /v1/consents`, the
`cookieAuth` security scheme, and an export-artifact schema plus a valid fixture.
`SCHEMA_MANIFEST.json:95-98` makes only required fields, enums, and `$id`
breaking, so none of this bumps `schema_version` — which stays `0.2.0`.

`validate_schemas.py` maps fixtures to schemas by filename prefix, so a new
artifact schema without a conforming fixture name is validated by nothing.

### Testing

- **Auth tests do *not* need a second vitest project.**
  `docs/reviews/2026-08-01-spec-escalations.md:195-197` records that `ENVIRONMENT`
  comes from `wrangler.toml` at config time and cannot be varied per test. That is
  true of `SELF.fetch`, which drives the deployed Worker with wrangler's vars — but
  not of the Hono app imported directly. `app.request(path, init, env)` takes
  bindings as its third argument, so a test can spread the real `env` from
  `cloudflare:test` and override `ENVIRONMENT`/`AUTH_STUB` per request, keeping
  real D1 with a production-shaped config. Verified by probe against Hono 4.12.32.
  The review's note should be narrowed to `SELF.fetch` rather than treated as a
  blanket limitation.
- **`test/helpers.ts`'s `TABLES` reset list must gain** `identities`, `consents`,
  `sessions`, `export_requests`, and `deletion_requests`, or integration rows leak
  between suites.
- The mount fix needs its own regression test asserting `serviceAuth` does not
  run for `/v1/*`.
- Per-user idempotency scoping is currently proven only against SQLite via Python,
  never inside workerd against D1.

### Audit (Stream 6) is no longer optional

The spec requires a `"Deletion proof record without payload"` as a detective
control, retained under `audit_events`' 13-month minimum. `audit_events` has no
writer. The helper must take a `detail_class` enum rather than a free-form string,
per the schema's own comment.

---

## Open items this record does **not** resolve

These are outside Stream 0 but were surfaced while resolving it, and each needs an
owner:

1. **`/v1/meta` is public and unauthenticated.** It is mounted before
   `configGuard` and reports `auth_stub` and `environment` to any caller
   (`index.ts:12`; `routes/health.ts:16-24`). Worth closing while auth is being
   touched anyway.
2. **`serviceAuth` uses a narrower dev predicate than `configGuard`** —
   `ENVIRONMENT === "development" || AUTH_STUB === "1"` rather than
   `isDevEnvironment`. Under `ENVIRONMENT=test` the two disagree. This should be
   reconciled before Stream 3 makes the calc service a third consumer.
3. **Error messages interpolate `users.id` and are logged.** Under 0.2 the id is a
   label rather than a crypto secret, which softens this, but it still contradicts
   the spec's `"Error events use opaque user/job IDs"` rule if the value is ever
   considered PII-adjacent.
4. **Data residency is an open spec decision** (`_docx_extract.txt:814-815`) and
   the R2 bucket name is about to be committed to `wrangler.toml`.
5. **Roadmap Stream 4's done-condition is unsatisfiable by its own task list** —
   it names `chart_snapshots.consent_id` while the task adds
   `birth_profiles.consent_id`. Resolved above; the roadmap should be amended.

---

## Suggested order, revised

```
§0 mount fix ──► 1. Identity ──┬──► 4. Consent + freeze ──┐
  (prerequisite)               │        └── shared ──┐    │
                               │           read-time │    ├──► M1 complete
                               ├──► 5. Export/Delete ┘    │
                               │                          │
                               └──► 6. Audit ─────────────┘

2. Same-origin router  ── independent of 1 to BUILD; needs 1 to OBSERVE,
                          because the current bundle carries no credential
                          to send and can only produce a 401

3. Calc hardening      ── independent, needs no decision
7. Birthplace          ── independent, product quality
8. Async workflow      ── deferred
9. Ops hardening       ── independent, small
```

Three changes from the roadmap's graph:

1. The mount fix precedes everything, including Stream 1.
2. Streams 4 and 5 are **coupled** by the shared read-time account-state gate,
   not independent as the roadmap states.
3. Stream 2's done-condition should read *"reaches the API and receives the
   standard 401 envelope"*. Vite dead-code-eliminates the dev header from
   production builds, so the built bundle carries no credential at all —
   reachability alone is not a working app.
