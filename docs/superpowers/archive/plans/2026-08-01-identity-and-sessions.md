# Identity and Sessions Implementation Plan

> **ARCHIVED 2026-08-22 — executed and closed.** Kept as the record of what was
> changed and why. Do not execute. Index: [`../README.md`](../README.md).

> **STATUS: EXECUTED.** All ten tasks implemented and committed, `38e13c9..e758f48`,
> on branch `feat/identity-and-sessions`. Final state: `npm test` exits 0 —
> shared 4, calc-stub 33, **api 164** (from 87), web 12, contracts pass;
> `npm run typecheck` clean across four workspaces; `npm run build` exits 0.
>
> The plan was verified against the tree before execution rather than trusted.
> That pass checked 254 cited claims and found three that would have shipped
> wrong code. All three are corrected below.
>
> The finished branch was then adversarially reviewed across six dimensions
> (auth bypass, crypto, schema, test quality, error leakage, regression), which
> raised 19 findings and refuted 17 under independent verification. The two that
> survived were fixed in `e758f48`, both low severity:
>
> - `linkIdentity` read-then-wrote in two round-trips, so two overlapping first
>   sign-ins for one IdP subject made the loser 500 on the unique index. It now
>   re-reads and returns the winner. The recovery wraps the **whole** batch:
>   `ON CONFLICT DO NOTHING` on the identities insert alone would let the users
>   and `user_keys` inserts commit, orphaning a user who holds a DEK and no
>   identity — and `loadUserKey` refuses to mint, so that account would be
>   permanently broken.
> - `"stamps last_login_at on every link"` linked only once. The creation INSERT
>   already writes that column, so the UPDATE branch the test was named after
>   never ran and could be deleted with the suite green.
>
> Both fixes were mutation-tested: each mutation kills exactly its own test.
>
> **Deviations, all deliberate:**
>
> 1. **Task 4 Step 5 would have changed which PII is encrypted.** The plan's
>    replacement for the `chart_snapshots.birth_enc` call site re-pointed the
>    sealed payload from `chart.birth.*` (the calc service's normalized values)
>    to `body.birthplace?.*` (the raw request). Both are in scope in that
>    handler, so it would have compiled silently. Only the identity argument and
>    the AAD context were changed.
> 2. **Task 4 Step 6(c)'s blanket find-replace was wrong at one site.** Of the
>    four `ensureUserKey` calls in `key-rotation.test.ts`, one passes `rotated`
>    — the post-rewrap env carrying the new root secret — not `env`.
>    Substituting `env` there would have made the test unwrap under the
>    pre-rotation root and throw. The env argument is preserved per call site.
> 3. **Task 4 Step 6(c) under-specified the import edit**, omitting `seedUser`,
>    `IDENTITY_A`, `IDENTITY_OTHER`, `SUBJECT_A`, and `USER_OTHER`.
> 4. **`USER_A`/`USER_B` keep their existing literals.** The plan lengthened
>    them; the CHECK is a prefix rule with no length constraint, so the rename
>    was churn across three more files.
> 5. **Task 9's `wrangler.toml` `[vars]` edit was applied during Task 8.** The
>    vitest pool reads that block, so without it `OIDC_JWKS_URL` was `undefined`
>    and `fetch(undefined)` produced unhandled rejections *behind passing tests*.
> 6. **`checkSecureConfig` also rejects the shipped `issuer.invalid`
>    placeholder**, not just absence — presence alone is not configuration, and a
>    presence-only guard would wave an unreplaced placeholder into production.
>    This mirrors how `ROOT_KEK` already rejects its own committed placeholder.
> 7. **Task 7 requires `exp` explicitly and disables `iat`.** Hono's `exp` check
>    is presence-guarded (`if (exp && payload.exp !== undefined)`), so a token
>    with no `exp` claim verifies and never expires — confirmed by deleting the
>    added guard and watching exactly that one test fail. `iat` is disabled
>    because Hono exposes no clock-skew leeway, so an issuer running a second
>    fast would have every token rejected.
> 8. **CI gained `shared` and `web` test steps.** The `monorepo` job runs
>    explicit per-workspace steps and never invokes the root `test` script, so
>    neither suite would have run there.
>
> **Not done, and why:** the local D1 at `apps/api/.wrangler/state/v3/d1` was not
> recreated — a `wrangler dev` server was holding the file lock, and killing a
> running user process was not worth it. The test suite does not use that
> database (it applies migrations to miniflare's own storage via
> `readD1Migrations`), and `smoke_check.py` executes the real SQL file, so the
> schema is verified either way. Recreate it before the next `npm run dev:api`:
> `rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api`.
>
> **Open item this created:** `apps/web/src/lib/api-client.ts` sends
> `x-user-id: usr_local_dev_0001`, which now 401s because that user does not
> exist and `loadUserKey` refuses to mint. `npm run web:dev` needs a seeded user.
> Documented in README; no seeding mechanism was added, because a SQL-only seed
> cannot produce a valid wrapped DEK.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production authentication reachable and real — fix the middleware
mount that currently claims every `/v1/*` request for the service token, then
replace the 501 auth stub with OIDC verification, a Worker-minted session, and a
crypto identity that is decoupled from the user's public id.

**Architecture:** Three layers change. The **router** stops mounting the internal
service API at the root prefix, so `serviceAuth` guards only `/internal/*`. The
**crypto layer** stops using `users.id` as the AEAD subject and takes a branded
`CryptoSubject` instead, minted once per user and never changed — so a future id
change is an `UPDATE` rather than a full re-encryption. The **identity layer** is
new: `POST /v1/sessions` verifies an OIDC ID token against a cached JWKS, links
the subject to a user (minting the user, its identity row, and its DEK in one D1
batch on first sight), and issues an opaque session token presented as an httpOnly
cookie to browsers and a bearer to native clients.

**Tech Stack:** TypeScript 5.8 (strict), Hono 4 on Cloudflare Workers, D1
(SQLite), Vitest 3 with `@cloudflare/vitest-pool-workers`, Python 3.12 for
contract validators.

**Spec:** [`../specs/2026-08-01-stream0-decisions-design.md`](../specs/2026-08-01-stream0-decisions-design.md)
— decisions 0.1, 0.2, and the token-presentation sub-decision of 0.3.

## Global Constraints

- **Do not change `schema_version`.** It is `0.2.0` everywhere and frozen for M0.
- **Edit `db/d1/0001_m0_core.sql` in place.** This is the documented M0
  pre-production policy (`db/d1/MIGRATIONS.json:12`). Do **not** create a `0002`.
  After any schema edit, **delete and recreate** the local database. Every
  statement in `0001` is `CREATE TABLE IF NOT EXISTS`, so re-running it against an
  existing database changes nothing and still exits 0:
  `rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api`.
- **Every schema edit must keep `python contracts/m0/smoke_check.py` passing.**
- **No new runtime dependencies.** `Jwt.verifyWithJwks` and `hono/cookie` both
  ship in the installed Hono. The `hono` **floor is raised** from `^4.7.10` to
  `^4.12.32` in Task 7 — at 4.7.10 the function is named `verifyFromJwks`, has no
  `allowedAlgorithms` option, and `verify` takes only `alg?`, so it cannot check
  `iss` or `aud`.
- **TypeScript is strict** with `noUnusedLocals` and `noUnusedParameters`
  (`tsconfig.base.json:15-16`). A dead binding is a compile error.
- **API tests use `vitest`**; calc-stub uses `node:test`. Do not mix them.
- **Error responses use the documented envelope**:
  `{ "error": { "code", "message", "request_id" } }`. Never return a library
  message, a stack trace, or a filesystem path in `message`.
- **Never log a raw session token or an ID token.** Log the session id instead.
- **`ENVIRONMENT=test` is a development environment.** `isDevEnvironment`
  (`apps/api/src/crypto.ts:56-58`) returns true for both `"development"` and
  `"test"`. A staging deployment must not be named `test`.
- **Baseline to preserve** (verify green before starting): `npm run typecheck`
  clean; `npm run test -w @patternlike/api` passes; `npm run test:contracts`
  passes.

## Verified Facts This Plan Depends On

Confirmed by executing code or reading the cited line. Do not re-derive them.

| Fact | Evidence |
|---|---|
| `app.route("/", internal)` at `index.ts:30` runs before `app.route("/", api)` at `:31`, so `serviceAuth` matches every path. Probe output: `GET /v1/chart -> configGuard(internal) -> serviceAuth -> configGuard(api) -> authStub` | executed against installed Hono 4.12.32 |
| Mounting `internal` at `/internal` and making its route path relative isolates it. Probe output: `GET /v1/chart -> configGuard(api) -> authenticate`; `POST /internal/content-releases -> configGuard(internal) -> serviceAuth` | same probe, fixed structure |
| `app.request(path, init, env)` accepts bindings as a **third argument**, so a test can override `ENVIRONMENT` per request without a second vitest project | probe: `{ENVIRONMENT:"production"}` reached the middleware as `c.env.ENVIRONMENT` |
| `Jwt.verifyWithJwks(token, { keys?, jwks_uri?, verification?, allowedAlgorithms }, init?)` exists in the installed Hono | `node_modules/hono/dist/types/utils/jwt/jwt.d.ts` |
| `verifyWithJwks` **re-fetches the JWKS on every call** when passed `jwks_uri`, with no caching — so the cache must be ours, passing `keys:` | `node_modules/hono/dist/utils/jwt/jwt.js`, function body |
| `verifyWithJwks` rejects symmetric algorithms and requires a `kid` header before any fetch | same function body |
| `newId(prefix)` returns `` `${prefix}_${32 hex chars}` `` from 16 random bytes | `packages/shared/src/index.ts:70-74` |
| `cryptoRandom` silently falls back to `Math.random` when `getRandomValues` is absent | `packages/shared/src/index.ts:96-105` |
| SQLite `GLOB` treats `_` as a literal (unlike `LIKE`), so `GLOB 'usr_*'` matches the prefix exactly | SQLite GLOB semantics |
| `buildAad`/`buildDekAad` JSON-stringify the *values*, not the field names — renaming the TS property does not change AAD bytes; changing the value does | `apps/api/src/crypto.ts:136-159` |
| `ensureUserKey` mints a DEK when no `user_keys` row exists, and is called from the birth write path | `apps/api/src/db/users.ts:119-129`; `routes/birth.ts:185` |
| `wrapDek` has 3 call sites (`users.ts:120, :182, :333`), `unwrapDek` 3 (`:97, :174, :272`), all in `db/users.ts` | `apps/api/src/db/users.ts` |
| `smoke_check.py` checks `expected - set(tables)` for **missing** tables only, so a new table is not detected unless added to `expected` | `contracts/m0/smoke_check.py:28-50` |
| `test/helpers.ts` `TABLES` currently lists 6 tables and no identity tables | `apps/api/test/helpers.ts:9-16` |
| `vitest.config.ts` loads top-level `[vars]` via `wrangler: { configPath }`, giving every test `ENVIRONMENT=development`, `AUTH_STUB=1` | `apps/api/vitest.config.ts:20`; `wrangler.toml:21-23` |

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `apps/api/src/routes/stubs.ts` | Modify | Internal route path becomes relative to its mount prefix |
| `apps/api/src/index.ts` | Modify | Mounts `internal` under `/internal`; mounts unauthenticated session routes |
| `apps/api/src/middleware/auth.test.ts` | Create | Middleware truth table driven through real HTTP with overridden bindings |
| `packages/shared/src/index.ts` | Modify | `cryptoRandom` refuses to produce non-cryptographic ids |
| `apps/api/src/crypto.ts` | Modify | Owns `CryptoSubject`; AAD and DEK wrapping bind to it, not to `users.id` |
| `db/d1/0001_m0_core.sql` | Modify | `users.crypto_subject`; id shape CHECKs; `sessions` table |
| `db/d1/MIGRATIONS.json` | Modify | Records the in-place edit and the local-reset requirement |
| `contracts/m0/smoke_check.py` | Modify | Asserts `sessions` exists and the id CHECKs fail closed |
| `apps/api/test/helpers.ts` | Modify | Resets the identity tables; seeds a user with a crypto subject |
| `apps/api/src/db/users.ts` | Modify | Key operations take a `UserIdentity`; reads never mint |
| `apps/api/src/db/identities.ts` | Create | Mints ids; links an OIDC subject to a user in one batch |
| `apps/api/src/db/sessions.ts` | Create | Creates, resolves, and revokes sessions; stores only a hash |
| `apps/api/src/services/identity.ts` | Create | OIDC ID-token verification with a module-scope JWKS cache |
| `apps/api/src/routes/sessions.ts` | Create | `POST /v1/sessions`, `DELETE /v1/sessions/current` |
| `apps/api/src/middleware/auth.ts` | Modify | `authenticate` replaces `authStub`; cookie or bearer |
| `apps/api/src/routes/birth.ts` | Modify | Reads the crypto subject from context; no longer creates users |
| `apps/api/src/routes/chart.ts` | Modify | Unchanged behaviour, typed context |
| `apps/api/src/env.ts` | Modify | Declares the OIDC bindings (and the pre-existing `SE_LICENSE_MODE`) |
| `apps/api/src/middleware/config-guard.ts` | Modify | Refuses to serve without OIDC configuration outside development |
| `apps/api/wrangler.toml` | Modify | OIDC vars in both environments |
| `apps/api/package.json` | Modify | Hono floor raised to `^4.12.32` |
| `.env.example`, `README.md` | Modify | Document the new configuration and the staging naming rule |

---

### Task 1: Isolate `serviceAuth` to `/internal`

**Files:**
- Modify: `apps/api/src/routes/stubs.ts:65`
- Modify: `apps/api/src/index.ts:30`
- Test: `apps/api/src/middleware/auth.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `POST /internal/content-releases` still resolves at that absolute
  URL. `/v1/*` no longer passes through `serviceAuth`. Task 8 relies on `/v1/*`
  reaching `authenticate` with the `Authorization` header untouched.

**Why this is first:** with `SERVICE_AUTH_TOKEN` set — which `.env.example` and
`wrangler.toml:51` both instruct — every `/v1/*` request is compared against the
*service* token and 401s before identity middleware runs. Any auth test written
before this fix would encode that as expected behaviour.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/middleware/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../index.js";

/**
 * These drive the real Hono app but override bindings per request via
 * app.request's third argument, so a production-shaped configuration can be
 * exercised without a second vitest project. SELF.fetch cannot do this —
 * it uses wrangler.toml's [vars] for the whole run.
 */
/**
 * AUTH_STUB is typed `string` (required) on Env, so `AUTH_STUB: undefined`
 * would be a type error under strict. Empty string is falsy and !== "1", which
 * is what the non-stub path needs.
 */
function prodEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    ENVIRONMENT: "production",
    AUTH_STUB: "",
    ROOT_KEK: "test-root-kek-that-is-long-enough-to-pass",
    SERVICE_AUTH_TOKEN: "svc-token-for-internal-only",
    ...overrides,
  };
}

async function body(
  res: Response,
): Promise<{ error?: { code?: string; message?: string; request_id?: string } }> {
  return (await res.json()) as {
    error?: { code?: string; message?: string; request_id?: string };
  };
}

describe("service auth is scoped to /internal", () => {
  /**
   * These two assertions must DISCRIMINATE. Before the fix, serviceAuth answers
   * `/v1/chart` with 401 + code "unauthorized" — the same code the consumer path
   * uses — so asserting on the code alone passes both before and after and
   * guards nothing. The `message` is what differs: "Invalid service token" comes
   * only from serviceAuth (auth.ts:92), and no consumer path ever emits it,
   * including `authenticate` after Task 8.
   */
  it("does not gate GET /v1/chart on the service token", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect((await body(res)).error?.message).not.toBe("Invalid service token");
  });

  it("does not 503 GET /v1/chart when the service token is unset", async () => {
    // Before the fix this is 503 service_auth_not_configured — the failure mode
    // that makes the documented deploy steps break the consumer API.
    const res = await app.request(
      "/v1/chart",
      {},
      prodEnv({ SERVICE_AUTH_TOKEN: undefined }),
    );
    expect(res.status).not.toBe(503);
    expect((await body(res)).error?.code).not.toBe("service_auth_not_configured");
  });

  it("does not gate POST /v1/birth-profiles on the service token", async () => {
    const res = await app.request(
      "/v1/birth-profiles",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      prodEnv(),
    );
    expect((await body(res)).error?.message).not.toBe("Invalid service token");
  });

  it("still gates POST /internal/content-releases on the service token", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST" },
      prodEnv(),
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("accepts the internal route with the correct service token", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST", headers: { authorization: "Bearer svc-token-for-internal-only" } },
      prodEnv(),
    );
    // The handler is an honest 501 stub; reaching it proves serviceAuth passed.
    expect(res.status).toBe(501);
  });

  it("returns 503 on the internal route when the service token is unset", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST" },
      prodEnv({ SERVICE_AUTH_TOKEN: undefined }),
    );
    expect(res.status).toBe(503);
    expect((await body(res)).error?.code).toBe("service_auth_not_configured");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/middleware/auth.test.ts`

Expected: FAIL, exactly 3 of 6 — and check *which*:

| Test | Before the fix | Why |
|---|---|---|
| does not gate GET /v1/chart | **FAIL** | `serviceAuth` answers with message `"Invalid service token"` |
| does not 503 GET /v1/chart when the service token is unset | **FAIL** | `serviceAuth` returns 503 `service_auth_not_configured` |
| does not gate POST /v1/birth-profiles | **FAIL** | same as the first |
| still gates POST /internal/content-releases | pass | already true; guards against over-correcting |
| accepts the internal route with the correct token | pass | same |
| returns 503 on the internal route when the token is unset | pass | same |

If all six pass, the test file is not discriminating and the rest of this task is
worthless — stop and fix the assertions before continuing. The last three are
expected to pass both before and after; they exist to catch a fix that breaks the
internal route while isolating it.

- [ ] **Step 3: Make the internal route path relative to its mount**

In `apps/api/src/routes/stubs.ts`, change line 65 from:

```ts
internalRoutes.post("/internal/content-releases", (c) =>
```

to:

```ts
internalRoutes.post("/content-releases", (c) =>
```

Then update the doc comment above `internalRoutes` (lines 54-59) to read:

```ts
/**
 * Internal service-to-service surfaces. Paths here are relative to the
 * `/internal` mount prefix in index.ts — NOT absolute. Mounting this router at
 * "/" made its `use("*", serviceAuth)` match every path in the application, so
 * the service token gated the whole consumer API and any consumer bearer token
 * was compared against SERVICE_AUTH_TOKEN and rejected.
 */
```

- [ ] **Step 4: Mount the internal router under its own prefix**

In `apps/api/src/index.ts`, change line 30 from:

```ts
app.route("/", internal);
```

to:

```ts
// Mounted under a prefix, not "/". A sub-app routed at "/" contributes its
// `use("*", ...)` middleware to every path in the parent.
app.route("/internal", internal);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api -- src/middleware/auth.test.ts`
Expected: PASS, 6 tests.

Run: `npm run test -w @patternlike/api`
Expected: PASS. The pre-existing suites must stay green — they run under
`AUTH_STUB=1`, which this change does not touch.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/stubs.ts apps/api/src/index.ts apps/api/src/middleware/auth.test.ts
git commit -m "fix(api): scope serviceAuth to /internal instead of every route"
```

---

### Task 2: Refuse to mint non-cryptographic identifiers

**Files:**
- Modify: `packages/shared/src/index.ts:96-105`
- Test: `packages/shared/src/index.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `newId(prefix: string): string` unchanged in signature, but now
  throws `Error("Web Crypto getRandomValues unavailable")` rather than falling
  back to `Math.random`. Task 3 relies on `newId` for permanent identifiers.

**Why:** `cryptoRandom` silently degrades to `Math.random`. That is acceptable for
a job id and not for a value that becomes a primary key and an encryption subject.

- [ ] **Step 1: Give the shared package a test runner and wire it into CI**

`packages/shared` has **no** `test` script and no `tsx` devDependency today, and
neither the root `test` script nor CI invokes it. All four need changing or the
test written below never runs anywhere.

In `packages/shared/package.json`, add to `scripts` (matching the calc-stub
convention — `node:test` via `tsx`, **not** vitest):

```json
"test": "tsx --test src/**/*.test.ts"
```

and add to `devDependencies`:

```json
"tsx": "^4.19.4"
```

In the root `package.json`, change the `test` script from:

```json
"test": "npm run test -w @patternlike/calc-stub -w @patternlike/api -w @patternlike/web && npm run test:contracts"
```

to:

```json
"test": "npm run test -w @patternlike/shared -w @patternlike/calc-stub -w @patternlike/api -w @patternlike/web && npm run test:contracts"
```

In `.github/workflows/ci.yml`, add a step to the `monorepo` job immediately
before `- run: npm run test -w @patternlike/calc-stub`:

```yaml
      - run: npm run test -w @patternlike/shared
```

Run: `npm install`
Expected: `tsx` is installed for the shared workspace.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/index.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId } from "./index.js";

describe("newId", () => {
  it("produces prefix_<32 lowercase hex>", () => {
    const id = newId("usr");
    assert.match(id, /^usr_[0-9a-f]{32}$/);
  });

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newId("usr")));
    assert.equal(seen.size, 200);
  });

  it("contains no ':' — reading_key uses it as a field delimiter", () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(!newId("usr").includes(":"));
    }
  });

  it("throws rather than falling back to Math.random when getRandomValues is absent", () => {
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: { subtle: real.subtle },
        configurable: true,
      });
      assert.throws(() => newId("usr"), /getRandomValues/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @patternlike/shared`
Expected: FAIL on the last test — `newId` currently returns a `Math.random`-derived
string instead of throwing.

- [ ] **Step 4: Make the fallback a hard failure**

In `packages/shared/src/index.ts`, replace the body of `cryptoRandom`
(lines 96-105) with:

```ts
function cryptoRandom(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c?.getRandomValues) {
    // These ids become primary keys and AEAD subjects. A Math.random fallback
    // would be predictable and is never an acceptable substitute here.
    throw new Error("Web Crypto getRandomValues unavailable; cannot mint an id");
  }
  c.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @patternlike/shared`
Expected: PASS, 4 tests.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run test -w @patternlike/api` and `npm run test -w @patternlike/calc-stub`
Expected: PASS. Both call `newId`; Workers and Node 22 both provide
`getRandomValues`, so nothing should change.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts \
        packages/shared/package.json package.json package-lock.json .github/workflows/ci.yml
git commit -m "fix(shared): refuse to mint ids from Math.random"
```

---

### Task 3: Schema — crypto subject, id shape, and the sessions table

**Files:**
- Modify: `db/d1/0001_m0_core.sql:17-28` (`users`), and add `sessions` after the
  `identities` block (`:49-62`)
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `contracts/m0/smoke_check.py:28-50` (new checks) **and `:55-58`, `:79-82`**
  (existing `INSERT INTO users` statements that this schema change breaks)
- Modify: `apps/api/test/helpers.ts:9-16`
- Modify: `apps/api/src/harness.test.ts:69-72` (direct `users` insert)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `users.crypto_subject TEXT NOT NULL UNIQUE`; CHECK constraints
  rejecting a `users.id` that is not `usr_*` or that contains `:`; a `sessions`
  table with columns `id`, `user_id`, `token_sha256`, `created_at`, `expires_at`,
  `last_seen_at`, `revoked_at`. Tasks 4, 5, and 6 depend on all of these.

- [ ] **Step 1: Write the failing checks**

In `contracts/m0/smoke_check.py`, add `"sessions"` to the `expected` set
(alphabetical position does not matter; put it after `"identities"`).

Do **not** touch the existing `INSERT INTO users` statements yet — naming a
`crypto_subject` column that the schema does not have would fail with
`OperationalError` instead of the missing-table failure this step is proving.
They are repaired in Step 3, together with the schema change that breaks them.

Then add this block immediately after the `missing` check
(`raise SystemExit(f"Missing tables: {sorted(missing)}")`), at the same
indentation:

```python
    # Identity shape constraints (spec 0.2: opaque, non-derived, colon-free)
    def insert_user(uid, subject):
        con.execute(
            "INSERT INTO users (id, crypto_subject, status, locale, timezone, "
            "entitlement_tier, created_at, updated_at) "
            "VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', "
            "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            (uid, subject),
        )

    insert_user("usr_0123456789abcdef0123456789abcdef", "cs_0123456789abcdef0123456789abcdef")
    print("D1 OK  users accepts a well-formed usr_/cs_ pair")

    for bad_id, why in [
        ("auth0|abcdef12", "an IdP subject is not an opaque usr_ id"),
        ("usr:0123456789abcdef", "':' collides with reading_key's delimiter"),
        ("0123456789abcdef", "missing the usr_ prefix"),
    ]:
        try:
            insert_user(bad_id, f"cs_{bad_id}")
            raise SystemExit(f"users.id CHECK accepted {bad_id!r}: {why}")
        except sqlite3.IntegrityError:
            pass
    print("D1 OK  users.id CHECK rejects derived, colon-bearing, and unprefixed ids")

    try:
        insert_user("usr_ffffffffffffffffffffffffffffffff", "not_a_crypto_subject")
        raise SystemExit("users.crypto_subject CHECK accepted a non-cs_ value")
    except sqlite3.IntegrityError:
        print("D1 OK  users.crypto_subject CHECK requires the cs_ prefix")

    # One crypto subject per user, forever
    try:
        insert_user("usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "cs_0123456789abcdef0123456789abcdef")
        raise SystemExit("crypto_subject is not UNIQUE across users")
    except sqlite3.IntegrityError:
        print("D1 OK  crypto_subject is unique across users")

    # Sessions store a hash, never a token, and one hash maps to one session
    con.execute(
        "INSERT INTO sessions (id, user_id, token_sha256, created_at, expires_at) "
        "VALUES ('ses_a', 'usr_0123456789abcdef0123456789abcdef', 'hash-a', "
        "'2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO sessions (id, user_id, token_sha256, created_at, expires_at) "
            "VALUES ('ses_b', 'usr_0123456789abcdef0123456789abcdef', 'hash-a', "
            "'2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
        )
        raise SystemExit("sessions.token_sha256 is not UNIQUE")
    except sqlite3.IntegrityError:
        print("D1 OK  sessions.token_sha256 is unique")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python contracts/m0/smoke_check.py`
Expected: FAIL with `Missing tables: ['sessions']`. That `SystemExit` fires
before any of the file's `INSERT INTO users` statements run, so this is the only
failure at this point.

- [ ] **Step 3: Add the crypto subject and the id CHECKs**

In `db/d1/0001_m0_core.sql`, replace the `users` table (lines 17-28) with:

```sql
CREATE TABLE IF NOT EXISTS users (
  -- Public label. Appears in logs, in calc-service requests, and inside
  -- daily_readings.reading_key. Opaque and server-minted: the spec forbids
  -- "stable direct identifiers" at the LLM boundary and requires opaque ids in
  -- telemetry, so this is never derived from an IdP subject. GLOB treats '_' as
  -- a literal, so 'usr_*' matches the prefix exactly. ':' is excluded because
  -- reading_key uses it as a field delimiter over a UNIQUE column.
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'usr_*' AND id NOT GLOB '*:*'),
  -- The cryptographic identity. Bound into every AEAD additional-data blob and
  -- into every wrapped DEK, so it must NEVER change once ciphertext exists.
  -- Separate from id precisely so that id CAN change without re-encryption.
  crypto_subject TEXT NOT NULL UNIQUE
    CHECK (crypto_subject GLOB 'cs_*' AND crypto_subject NOT GLOB '*:*'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'pending_deletion', 'deleted')),
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  entitlement_tier TEXT NOT NULL DEFAULT 'free',
  next_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

**In the same step, repair the two inserts this breaks.** `smoke_check.py`
contains `INSERT INTO users (...)` statements at `contracts/m0/smoke_check.py:55-58`
(`'usr_t'`) and `:79-82` (`'usr_b'`) that supply no `crypto_subject`. Neither is
inside a `try`, so the script would die with an uncaught
`IntegrityError: NOT NULL constraint failed: users.crypto_subject`, making every
later assertion in the file unreachable — the `birth_profiles` CHECK, the
content-release dual control, the jobs idempotency regression, and the
`user_keys` rotation check.

Rewrite both. For `'usr_t'`:

```python
    con.execute(
        "INSERT INTO users (id, crypto_subject, status, locale, timezone, "
        "entitlement_tier, created_at, updated_at) "
        "VALUES ('usr_t0000000000000000000000000000', "
        "'cs_t0000000000000000000000000000000', 'active', 'en-US', 'UTC', "
        "'free', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    )
```

and the same for `'usr_b'` with `usr_b…`/`cs_b…`.

**The id literals change**, and the bare old values (`'usr_t'`, `'usr_b'`) no
longer satisfy `CHECK (id GLOB 'usr_*')`. Run:

```bash
grep -n "usr_t\|usr_b" contracts/m0/smoke_check.py
```

and update **every** line it prints — do not work from a list in this plan, which
may be incomplete. `PRAGMA foreign_keys = ON` is set at `0001_m0_core.sql:11`, so
any `jobs`, `user_keys`, `birth_profiles`, `export_requests`, or
`deletion_requests` row still pointing at a now-nonexistent `'usr_t'` fails with
`FOREIGN KEY constraint failed` rather than being silently ignored.

- [ ] **Step 4: Add the sessions table**

In `db/d1/0001_m0_core.sql`, immediately after
`CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);`, add:

```sql
-- Worker-minted sessions. The IdP proves who the user is once, at
-- POST /v1/sessions; this table is what every subsequent request checks, and
-- what makes "invalidate sessions" a row update rather than a wait for token
-- expiry.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  -- SHA-256 hex of the bearer, never the bearer. A database disclosure must not
  -- hand the reader a set of usable session tokens.
  token_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_live
  ON sessions(user_id) WHERE revoked_at IS NULL;
```

- [ ] **Step 5: Run the checks to verify they pass**

Run: `python contracts/m0/smoke_check.py`
Expected: PASS, including these five new `D1 OK` lines:

```
D1 OK  users accepts a well-formed usr_/cs_ pair
D1 OK  users.id CHECK rejects derived, colon-bearing, and unprefixed ids
D1 OK  users.crypto_subject CHECK requires the cs_ prefix
D1 OK  crypto_subject is unique across users
D1 OK  sessions.token_sha256 is unique
```

Run: `python contracts/m0/validate_schemas.py`
Expected: PASS (unchanged — no JSON Schema was touched).

- [ ] **Step 6: Record the in-place edit**

In `db/d1/MIGRATIONS.json`, extend the `0001_m0_core` description with
`; users.crypto_subject + id shape CHECKs; sessions table` and add to `notes`:

```json
"2026-08-01: 0001 edited in place to add users.crypto_subject (the immutable AEAD/DEK subject, separate from the mutable users.id label), CHECK constraints on both id shapes, and the sessions table. AEAD_VERSION and KEK_DERIVATION_VERSION are both bumped in the same change because the AAD subject value changes from users.id to users.crypto_subject. Local databases must be DELETED and recreated, not just re-applied — every statement is CREATE TABLE IF NOT EXISTS, so re-running 0001 over an existing database adds no column and still exits 0: rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api. Pre-existing local rows are not readable."
```

- [ ] **Step 7: Reset the identity tables between tests**

In `apps/api/test/helpers.ts`, replace the `TABLES` array (lines 9-16) with:

```ts
/**
 * Tables the API writes, in foreign-key-safe delete order. Storage is not
 * isolated per test in this pool version, so tests clear explicitly rather than
 * relying on rollback. A table missing from this list leaks rows between suites
 * and makes tests pass for the wrong reason.
 */
const TABLES = [
  "natal_features",
  "chart_snapshots",
  "birth_profiles",
  "sessions",
  "identities",
  "export_requests",
  "deletion_requests",
  "consents",
  "user_keys",
  "jobs",
  "users",
];
```

`consents`, `export_requests`, and `deletion_requests` have no writer until
Streams 4 and 5. Listing them now is free — `DELETE FROM` an empty table — and
means those streams cannot forget and start leaking rows between suites.

**In the same step, fix the direct `users` insert in `harness.test.ts.**
`apps/api/src/harness.test.ts:69-72` inserts a row with no `crypto_subject`,
which is now a `NOT NULL` violation. Replace that statement with:

```ts
      await env.DB.prepare(
        "INSERT INTO users (id, crypto_subject, status, locale, timezone," +
          " entitlement_tier, created_at, updated_at)" +
          " VALUES ('usr_reset_probe_100000000000000'," +
          "'cs_reset_probe_1000000000000000','active','en-US','UTC','free'," +
          "'2026-01-01','2026-01-01')",
      ).run();
```

The id gains length so it still reads as a probe while satisfying
`CHECK (id GLOB 'usr_*')`. The two assertions around it are unchanged.

- [ ] **Step 8: Recreate the local database and confirm the suite still runs**

**Delete the local database first.** `db:local` runs
`wrangler d1 execute --file=0001_m0_core.sql`, and every statement in that file is
`CREATE TABLE IF NOT EXISTS` — it will **not** add `crypto_subject` to a `users`
table that already exists, and will report success while doing nothing. Remove
the local D1 state, then re-apply:

```bash
rm -rf apps/api/.wrangler/state/v3/d1
npm run db:local -w @patternlike/api
```

Expected: exits 0. Confirm the column actually landed rather than trusting the
exit code:

```bash
npx wrangler d1 execute patternlike-ops --local \
  --command "SELECT name FROM pragma_table_info('users') WHERE name='crypto_subject'"
```

Expected: one row. If it returns nothing, the old database was still in place.

Run: `npm run test -w @patternlike/api`
Expected: FAIL — `ensureUser` inserts into `users` without `crypto_subject`,
which is `NOT NULL`, and the test user ids (`usr_test_alice_00001`) satisfy the
new CHECK but the insert has no subject. **This failure is expected and is
resolved in Task 4.** Record the failing test names; Task 4 Step 7 must show them
green again.

- [ ] **Step 9: Commit**

```bash
git add db/d1/0001_m0_core.sql db/d1/MIGRATIONS.json contracts/m0/smoke_check.py \
        apps/api/test/helpers.ts apps/api/src/harness.test.ts
git commit -m "feat(db): add users.crypto_subject, id shape checks, and sessions"
```

---

### Task 4: Bind ciphertext to a crypto subject, not to the user id

**Files:**
- Modify: `apps/api/src/crypto.ts:36`, `:116`, `:123-192`
- Modify: `apps/api/src/db/users.ts` (whole file)
- Modify: `apps/api/src/middleware/auth.ts` — `AppVariables` gains
  `cryptoSubject`, and `authStub`'s success branch resolves the user from the row
  instead of trusting the header. Task 8 replaces `authStub` entirely; this is the
  minimum that keeps the tree green in between.
- Modify: `apps/api/src/routes/birth.ts:185`, `:206-215`, `:360-370`
- Modify: `apps/api/test/helpers.ts`

**Every existing consumer of the changed symbols.** This list was built by
grepping for `ensureUser|ensureUserKey|EncryptionContext|wrapDek|unwrapDek|encryptPayload|decryptPayload|aead_version`.
Missing one is a build break under strict:

- Modify: `apps/api/src/crypto.test.ts:11-15`, `:31`, `:41`, `:48`, `:56` —
  builds an `EncryptionContext` with `userId` and passes `CTX.userId` to
  `wrapDek`/`unwrapDek` in three tests
- Modify: `apps/api/src/aead.test.ts:10`, `:27`, `:72`, `:77`, `:86` — context
  literals plus an assertion that `aead_version` is `1`
- Modify: `apps/api/src/db/key-rotation.test.ts:4-11` — imports **`ensureUser`
  and `ensureUserKey`**, both of which this task deletes; also drives the birth
  route via `postBirthProfile` for users nothing seeds any more

**Interfaces:**
- Consumes: `users.crypto_subject` from Task 3.
- Produces, from `apps/api/src/crypto.ts`:
  - `export type CryptoSubject = string & { readonly __cryptoSubject: unique symbol }`
  - `export function asCryptoSubject(value: string): CryptoSubject`
  - `export interface EncryptionContext { subject: CryptoSubject; field: string; recordId: string }`
  - `wrapDek(dek, rootKey, subject: CryptoSubject, keyVersion)` and
    `unwrapDek(packed, rootKey, subject: CryptoSubject, keyVersion)`
  - `AEAD_VERSION = 2`, `KEK_DERIVATION_VERSION = 3`
- Produces, from `apps/api/src/db/users.ts`:
  - `export interface UserIdentity { userId: string; cryptoSubject: CryptoSubject }`
  - `export async function loadUserIdentity(env: Env, userId: string): Promise<UserIdentity | null>`
  - `export async function loadUserKey(env, id: UserIdentity): Promise<{ dek: Uint8Array; keyVersion: number }>`
  - `export async function buildUserKeyInsert(env, id: UserIdentity): Promise<D1PreparedStatement>`
  - `encryptPayload(env, id: UserIdentity, value, ctx)`,
    `decryptPayload<T>(env, id: UserIdentity, payload, ctx)`,
    `rewrapUserKey(env, id: UserIdentity, previous)`,
    `rotateUserDek(env, id: UserIdentity)`
  - `ensureUser` is **removed**. Tasks 5 and 8 depend on all of these.

**Why one task:** splitting the type change from its call sites leaves
`npm run typecheck` broken, so no intermediate commit is independently testable.

- [ ] **Step 1: Write the failing test**

Replace `apps/api/src/aead.test.ts`'s context-binding cases by adding this
`describe` block to the end of that file (keep everything already there, adapting
any `userId:` context literals to `subject: asCryptoSubject("cs_...")`):

```ts
import { asCryptoSubject } from "./crypto.js";

describe("the AEAD subject is the crypto subject, not the user label", () => {
  const dek = new Uint8Array(32).fill(7);
  const A = asCryptoSubject("cs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const B = asCryptoSubject("cs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  it("cannot decrypt a blob sealed under a different subject", async () => {
    const sealed = await encryptJson({ secret: 1 }, dek, 1, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    await expect(
      decryptJson(sealed, dek, {
        subject: B,
        field: "birth_profiles.payload_enc",
        recordId: "1",
      }),
    ).rejects.toThrow();
  });

  it("round-trips under the same subject", async () => {
    const sealed = await encryptJson({ secret: 2 }, dek, 1, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    const out = await decryptJson<{ secret: number }>(sealed, dek, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    expect(out.secret).toBe(2);
  });

  it("records AEAD version 2, since the subject's meaning changed", async () => {
    const sealed = await encryptJson({ x: 1 }, dek, 1, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    expect(sealed.aead_version).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/aead.test.ts`
Expected: FAIL — `asCryptoSubject` is not exported, and `EncryptionContext` has
no `subject` property.

- [ ] **Step 3: Introduce the branded subject in `crypto.ts`**

In `apps/api/src/crypto.ts`, change line 36 from `= 2` to:

```ts
/**
 * Bumped to 2 when the derivation moved to HKDF-SHA256, and to 3 when the DEK
 * AAD subject changed from users.id to users.crypto_subject. Ciphertext is not
 * cross-readable between versions; M0 is pre-production, so local databases are
 * recreated rather than migrated. See db/d1/MIGRATIONS.json.
 */
export const KEK_DERIVATION_VERSION = 3;
```

Change line 116 from `= 1` to:

```ts
/** Bumped to 2 when the AAD subject changed from users.id to crypto_subject. */
export const AEAD_VERSION = 2;
```

Replace the `EncryptionContext` interface and both AAD builders (lines 118-159)
with:

```ts
/**
 * The immutable cryptographic identity of a user. Distinct from `users.id`,
 * which is a mutable public label. Branded so that passing a user id where a
 * subject is expected is a compile error rather than a silent AAD mismatch that
 * only surfaces as an unreadable blob later.
 */
export type CryptoSubject = string & { readonly __cryptoSubject: unique symbol };

/**
 * Assert that a value is a crypto subject. The ONLY place a plain string
 * becomes a CryptoSubject. Callers must have read it from users.crypto_subject
 * or just minted it — never from a request.
 */
export function asCryptoSubject(value: string): CryptoSubject {
  if (!value.startsWith("cs_") || value.length < 8 || value.includes(":")) {
    throw new Error("not a crypto subject");
  }
  return value as CryptoSubject;
}

/**
 * Where a ciphertext belongs. Bound into the AES-GCM additional authenticated
 * data, so a blob lifted from one row, column, or user cannot be decrypted in
 * another position even when the attacker holds the right DEK.
 */
export interface EncryptionContext {
  subject: CryptoSubject;
  /** `table.column`, e.g. "birth_profiles.payload_enc". */
  field: string;
  /** Identifies the row within that table, e.g. a profile version or chart id. */
  recordId: string;
}

/**
 * JSON array encoding, not concatenation: JSON escapes the delimiter, so no
 * choice of subject/field/recordId can produce the same AAD as a different
 * triple.
 */
function buildAad(ctx: EncryptionContext, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      "patternlike.aead",
      AEAD_VERSION,
      ctx.subject,
      ctx.field,
      ctx.recordId,
      keyVersion,
    ]),
  );
}

/** AAD for the wrapped DEK itself, binding it to its subject and KEK generation. */
function buildDekAad(subject: CryptoSubject, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      "patternlike.dek",
      KEK_DERIVATION_VERSION,
      subject,
      keyVersion,
    ]),
  );
}
```

Change the `userId: string` parameter of `wrapDek` (line 164) and `unwrapDek`
(line 180) to `subject: CryptoSubject`, and update the two `buildDekAad(userId, keyVersion)`
call sites (lines 170 and 187) to `buildDekAad(subject, keyVersion)`.

- [ ] **Step 4: Split the row identity from the crypto identity in `db/users.ts`**

In `apps/api/src/db/users.ts`:

**(a)** Delete `ensureUser` entirely (lines 16-31). User creation moves to
identity-link time in Task 5.

**(b)** Add to the import from `../crypto.js`: `asCryptoSubject`, and the types
`CryptoSubject`.

**(c)** Add immediately after the imports:

```ts
/**
 * A user's two identifiers. `userId` addresses rows; `cryptoSubject` addresses
 * ciphertext. They are deliberately not interchangeable — see
 * docs/superpowers/archive/specs/2026-08-01-stream0-decisions-design.md §0.2.
 */
export interface UserIdentity {
  userId: string;
  cryptoSubject: CryptoSubject;
}

/** Read both identifiers for a user, or null if the user does not exist. */
export async function loadUserIdentity(
  env: Env,
  userId: string,
): Promise<UserIdentity | null> {
  const row = await env.DB.prepare(
    "SELECT id, crypto_subject FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ id: string; crypto_subject: string }>();
  if (!row) return null;
  return { userId: row.id, cryptoSubject: asCryptoSubject(row.crypto_subject) };
}
```

**(d)** Change the three error classes (lines 33-58) to take a `userId` and keep
it **out** of the message, since `onError` logs messages:

```ts
export class UserKeyDestroyedError extends Error {
  readonly code = "user_key_destroyed";
  constructor(readonly userId: string) {
    super("Encryption key has been destroyed for this account");
    this.name = "UserKeyDestroyedError";
  }
}
```

Apply the identical shape to `NoUserKeyError`:

```ts
export class NoUserKeyError extends Error {
  readonly code = "user_key_missing";
  constructor(readonly userId: string) {
    super("No encryption key exists for this account");
    this.name = "NoUserKeyError";
  }
}
```

Leave `UnsupportedKekVersionError` as it is — it carries no user id.

**(e)** Replace `ensureUserKey` (lines 86-130) with a read-only `loadUserKey`
plus a separate minting statement builder:

```ts
/**
 * Load a user's live DEK. Never mints.
 *
 * Minting moved to identity-link time (db/identities.ts), so a user row that
 * exists without a key row is a real fault, not a first-use case. The previous
 * behaviour — mint on miss — meant that a user id change which failed to cascade
 * into user_keys silently produced a fresh DEK and orphaned every prior
 * ciphertext with a 200 response and no error anywhere.
 */
export async function loadUserKey(
  env: Env,
  id: UserIdentity,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const active = await readLiveKey(env, id.userId);

  if (!active) {
    const destroyed = await env.DB.prepare(
      "SELECT 1 AS present FROM user_keys WHERE user_id = ? LIMIT 1",
    )
      .bind(id.userId)
      .first<{ present: number }>();
    throw destroyed
      ? new UserKeyDestroyedError(id.userId)
      : new NoUserKeyError(id.userId);
  }

  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  const root = await resolveRootKey(env);
  const dek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    root,
    id.cryptoSubject,
    active.key_version,
  );
  return { dek, keyVersion: active.key_version };
}

/**
 * Build the user_keys INSERT for a brand-new user, so it can be batched with the
 * users and identities inserts. Returning a statement rather than running it is
 * what makes account creation atomic.
 */
export async function buildUserKeyInsert(
  env: Env,
  id: UserIdentity,
): Promise<D1PreparedStatement> {
  const root = await resolveRootKey(env);
  const dek = await generateUserDek();
  const { wrapped_b64, nonce_b64 } = await wrapDek(dek, root, id.cryptoSubject, 1);
  return env.DB.prepare(
    `INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
     VALUES (?, 1, ?, ?, ?)`,
  ).bind(
    id.userId,
    KEK_DERIVATION_VERSION,
    packWrapped(nonce_b64, wrapped_b64),
    new Date().toISOString(),
  );
}
```

**(f)** Change `encryptPayload` and `decryptPayload` (lines 132-151) to take a
`UserIdentity`:

```ts
export async function encryptPayload(
  env: Env,
  id: UserIdentity,
  value: unknown,
  ctx: EncryptionContext,
): Promise<EncryptedPayload & { keyVersion: number }> {
  const { dek, keyVersion } = await loadUserKey(env, id);
  const enc = await encryptJson(value, dek, keyVersion, ctx);
  return { ...enc, keyVersion: enc.key_version };
}

export async function decryptPayload<T = unknown>(
  env: Env,
  id: UserIdentity,
  payload: Pick<EncryptedPayload, "key_version" | "nonce" | "ciphertext">,
  ctx: EncryptionContext,
): Promise<T> {
  const { dek } = await loadUserKey(env, id);
  return decryptJson<T>(payload, dek, ctx);
}
```

**(g)** In `rewrapUserKey` and `rotateUserDek`, change the `userId: string`
parameter to `id: UserIdentity`; replace every `readLiveKey(env, userId)` with
`readLiveKey(env, id.userId)`; every `new NoUserKeyError(userId)` with
`new NoUserKeyError(id.userId)`; every `wrapDek(..., userId, ...)` /
`unwrapDek(..., userId, ...)` with `id.cryptoSubject`; every SQL `.bind(...)`
that binds the user id with `id.userId`; and the `EncryptionContext` literal in
`rotateUserDek` (lines 300-304) with:

```ts
      const ctx: EncryptionContext = {
        subject: id.cryptoSubject,
        field: `${col.table}.${col.encColumn}`,
        recordId: String(row.record_id),
      };
```

Also change `assertNoUnrotatedCiphertext(env, userId, ...)` to take
`id: UserIdentity` and bind `id.userId`.

- [ ] **Step 5: Update the two route call sites**

**First declare the context variable the route is about to read.** `birth.ts`
below calls `c.get("cryptoSubject")`, which does not typecheck until
`AppVariables` declares it. Task 8 rewrites the rest of that file; this is the
one line it needs now. In `apps/api/src/middleware/auth.ts`, add the import and
the field:

```ts
import type { CryptoSubject } from "../crypto.js";

export type AppVariables = {
  userId: string;
  /** The immutable AEAD/DEK subject. Never a request-supplied value. */
  cryptoSubject: CryptoSubject;
  requestId: string;
};
```

`authStub` does not yet set it — under `AUTH_STUB=1` the value comes from the
row, which is what Step 6's `seedUser` provides and what Task 8 wires up. So also
change `authStub`'s success branch (`auth.ts:31`) from:

```ts
    c.set("userId", userId);
```

to:

```ts
    const identity = await loadUserIdentity(c.env, userId);
    if (!identity) {
      return c.json(
        {
          error: {
            code: "unauthorized",
            message: "Provide X-User-Id header when AUTH_STUB=1",
            request_id: requestId,
          },
        },
        401,
      );
    }
    c.set("userId", identity.userId);
    c.set("cryptoSubject", identity.cryptoSubject);
```

adding `import { loadUserIdentity } from "../db/users.js";` at the top. The
header now *names* an existing user rather than conjuring one — see the
deviation note in Task 8.

In `apps/api/src/routes/birth.ts`:

Change the import on line 12 from:

```ts
import { ensureUser, encryptPayload } from "../db/users.js";
```

to:

```ts
import { encryptPayload, type UserIdentity } from "../db/users.js";
```

Delete line 185 (`await ensureUser(c.env.DB, userId);`) entirely — the user now
exists before any request reaches this route.

After `const userId = c.get("userId");` (line 128), add:

```ts
  const identity: UserIdentity = {
    userId,
    cryptoSubject: c.get("cryptoSubject"),
  };
```

Change the `encryptPayload` call at lines 206-215 to pass `identity` and the new
context field name:

```ts
  const { keyVersion, nonce, ciphertext } = await encryptPayload(
    c.env,
    identity,
    sensitive,
    {
      subject: identity.cryptoSubject,
      field: "birth_profiles.payload_enc",
      recordId: String(profileVersion),
    },
  );
```

Change the second `encryptPayload` call at lines 360-370 the same way:

```ts
  const birthEnc = await encryptPayload(
    c.env,
    identity,
    {
      utc_instant: chart.birth.utc_instant,
      place_label: body.birthplace?.label ?? null,
      latitude: body.birthplace?.latitude ?? null,
      longitude: body.birthplace?.longitude ?? null,
    },
    {
      subject: identity.cryptoSubject,
      field: "chart_snapshots.birth_enc",
      recordId: chart.id,
    },
  );
```

Leave every other `userId` binding in `birth.ts` as-is — those address rows, and
rows are still keyed on `users.id`.

`apps/api/src/routes/chart.ts` needs no change: it addresses rows only.

- [ ] **Step 6: Update every existing test that consumes a changed symbol**

Do these in order. Each is a build break until fixed.

**(a) `apps/api/src/crypto.test.ts`** — three tests use `CTX.userId` as a
`wrapDek`/`unwrapDek` argument. Replace lines 11-15 with:

```ts
const SUBJECT = asCryptoSubject("cs_crypto_test_00000000000000001");

const CTX: EncryptionContext = {
  subject: SUBJECT,
  field: "birth_profiles.payload_enc",
  recordId: "1",
};
```

and add `asCryptoSubject` to the import from `./crypto.js`. Then change
`CTX.userId` to `CTX.subject` at lines 31, 41, and 48, and line 56 from:

```ts
    await expect(unwrapDek(packed, root, "usr_someone_else_01", 1)).rejects.toThrow();
```

to:

```ts
    await expect(
      unwrapDek(packed, root, asCryptoSubject("cs_someone_else_000000000000001"), 1),
    ).rejects.toThrow();
```

The test name "refuses to unwrap another user's DEK" stays accurate — it is now
another user's *subject*.

**(b) `apps/api/src/aead.test.ts`** — change the version assertion at line 86:

```ts
    expect(enc.aead_version).toBe(2);
```

Then convert the context literals at lines 10, 27, 72, and 77 from `userId:` to
`subject:`, wrapping each value in `asCryptoSubject` and renaming it to a `cs_`
form of at least 8 characters. **The delimiter-collision test at lines 72-77 must
keep its property**: it proves that a context split differently across the
delimiter cannot collide. Preserve the shape, not the literals — encrypt under
`{ subject: asCryptoSubject("cs_a00000"), field: "b.c", recordId: "d" }` and
assert that `{ subject: asCryptoSubject("cs_a00000b.c"), field: "", recordId: "d" }`
fails. `asCryptoSubject` requires `cs_` and length ≥ 8, and both literals satisfy
that.

**(c) `apps/api/src/db/key-rotation.test.ts`** — this file imports **`ensureUser`
and `ensureUserKey` at lines 4-11**, and Step 4 deleted both.

Seed in exactly **one** place. `seedUser` is a bare `INSERT`, not idempotent like
the `ensureUser` it replaces, so seeding in both the `beforeEach` and the test
bodies throws `UNIQUE constraint failed: users.id`.

- Remove `ensureUser` and `ensureUserKey` from the import; add `loadUserKey`.
- Replace `beforeEach(resetDb);` at line 24 with:

  ```ts
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_OTHER);
  });
  ```

- **Delete** the four `await ensureUser(env.DB, USER_A);` calls at lines 28, 39,
  49, and 61. Do not replace them — the `beforeEach` now covers every test.
- Replace every `ensureUserKey(env, USER_A)` call with `loadUserKey(env, IDENTITY_A)`.
- Pass `IDENTITY_A` (not `USER_A`) to `rotateUserDek`, `rewrapUserKey`,
  `encryptPayload`, and `decryptPayload`.
- **There are TWO `EncryptionContext` literals**, not one: the module-level `CTX`
  near line 20, and an inline literal at lines 122-126. Change `userId: USER_A`
  to `subject: SUBJECT_A` in **both**.
- **`"leaves other users untouched"` (lines 177-191) would pass vacuously.** It
  calls `postBirthProfile("usr_test_other_00001", ...)`, which now 401s because
  nothing seeds that user — leaving `other` empty, and `[].every(...)` is `true`,
  so the test goes green while asserting nothing. Replace the two string literals
  at lines 179 and 188 with `USER_OTHER`, which the `beforeEach` above seeds.
  Then confirm the test still fails if you comment out the `rotateUserDek` call —
  if it does not, it is still vacuous.

**(d) `apps/api/test/helpers.ts`** — add a seeding helper and export the subjects,
so integration tests have a user that exists before they call the API:

```ts
import { asCryptoSubject } from "../src/crypto.js";
import { buildUserKeyInsert } from "../src/db/users.js";
import type { UserIdentity } from "../src/db/users.js";

export const USER_A = "usr_test_alice_00000000000000001";
export const USER_B = "usr_test_bob_0000000000000000001";
/** A third party, used to prove per-user isolation in the rotation tests. */
export const USER_OTHER = "usr_test_other_00000000000000001";
export const SUBJECT_A = asCryptoSubject("cs_test_alice_0000000000000000001");
export const SUBJECT_B = asCryptoSubject("cs_test_bob_00000000000000000001");
export const SUBJECT_OTHER = asCryptoSubject("cs_test_other_0000000000000000001");

/**
 * Create a user the way identity linking does — row plus key, one batch — so
 * integration tests exercise the same shape production does.
 */
export async function seedUser(id: UserIdentity): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, crypto_subject, status, locale, timezone,
                          entitlement_tier, created_at, updated_at)
       VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
    ).bind(id.userId, id.cryptoSubject, now, now),
    await buildUserKeyInsert(env, id),
  ]);
}

export const IDENTITY_A: UserIdentity = { userId: USER_A, cryptoSubject: SUBJECT_A };
export const IDENTITY_B: UserIdentity = { userId: USER_B, cryptoSubject: SUBJECT_B };
export const IDENTITY_OTHER: UserIdentity = {
  userId: USER_OTHER,
  cryptoSubject: SUBJECT_OTHER,
};
```

Replace the existing `USER_A`/`USER_B` constant declarations (lines 87-88) with
the block above. Note the ids changed length to satisfy the `usr_*` CHECK while
staying inside `opaqueId`'s 8–128 bound — update any test that hardcodes the old
literals.

**(e) `apps/api/src/routes/birth.integration.test.ts`** — there is exactly one
`beforeEach`, file-level at line 19. Replace it with:

```ts
beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
});
```

Seed both unconditionally: `resetDb()` truncates `users`, so any suite
authenticating as `USER_B` without a seeded row now 401s where it asserts a
route-level status.

**Then repair the one test that depends on an unseeded user.**
`"404s for a user with no chart"` at lines 341-345 calls
`getChart("usr_test_nobody_0001")` — a deliberately non-existent id — and asserts
`404 chart_not_found`. Under Step 5's change that id no longer resolves to a
user, so it returns `401 unauthorized` and the test fails.

Change line 342 to:

```ts
    const res = await getChart(USER_B);
```

`USER_B` is now seeded and has no chart in that suite, so the assertion keeps its
original meaning — an *authenticated* user with no chart gets `404
chart_not_found`. The "no such user" case it used to conflate is a different
concern and is covered separately by Task 8's `authenticate` tests.

- [ ] **Step 7: Run tests to verify they pass**

Run: `rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api`
Expected: exits 0.

Run: `npm run test -w @patternlike/api`
Expected: PASS — including the suites that Task 3 Step 8 left failing.

Run: `npm run typecheck`
Expected: clean. In particular, confirm that passing a `userId` where a
`CryptoSubject` is required is a compile error: temporarily change one
`subject: identity.cryptoSubject` to `subject: identity.userId`, re-run
`npm run typecheck`, confirm it fails, then change it back.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/crypto.ts apps/api/src/db/users.ts apps/api/src/middleware/auth.ts \
        apps/api/src/routes/birth.ts apps/api/src/crypto.test.ts apps/api/src/aead.test.ts \
        apps/api/src/db/key-rotation.test.ts apps/api/src/routes/birth.integration.test.ts \
        apps/api/test/helpers.ts
git commit -m "feat(crypto): bind ciphertext to an immutable subject, not the user id"
```

---

### Task 5: Link an OIDC subject to a user

**Files:**
- Create: `apps/api/src/db/identities.ts`
- Test: `apps/api/src/db/identities.test.ts` (create)

**Interfaces:**
- Consumes: `UserIdentity`, `buildUserKeyInsert`, `loadUserIdentity` from Task 4;
  `users.crypto_subject` and the CHECKs from Task 3.
- Produces:
  - `export function newUserId(): string` — `usr_<32 hex>`
  - `export function newCryptoSubject(): CryptoSubject` — `cs_<32 hex>`
  - `export async function linkIdentity(env: Env, provider: string, providerSubject: string): Promise<UserIdentity>`
    — resolves an existing link or creates user + identity + key in one batch,
    and updates `last_login_at` on every call.
  Task 7 depends on `linkIdentity`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/identities.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity, newUserId, newCryptoSubject } from "./identities.js";
import { loadUserKey } from "./users.js";

describe("identity minting", () => {
  it("mints ids that satisfy the schema CHECKs", () => {
    expect(newUserId()).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(newCryptoSubject()).toMatch(/^cs_[0-9a-f]{32}$/);
  });
});

describe("linkIdentity", () => {
  beforeEach(resetDb);

  it("creates the user, the identity, and the key on first sight", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");

    expect(id.userId).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(id.cryptoSubject).toMatch(/^cs_[0-9a-f]{32}$/);

    expect(await rows("SELECT id FROM users")).toHaveLength(1);
    expect(await rows("SELECT id FROM identities")).toHaveLength(1);
    // The DEK must exist immediately: loadUserKey never mints.
    await expect(loadUserKey(env, id)).resolves.toHaveProperty("keyVersion", 1);
  });

  it("returns the same user on a second sight, without creating another", async () => {
    const first = await linkIdentity(env, "oidc", "sub-alice");
    const second = await linkIdentity(env, "oidc", "sub-alice");

    expect(second.userId).toBe(first.userId);
    expect(second.cryptoSubject).toBe(first.cryptoSubject);
    expect(await rows("SELECT id FROM users")).toHaveLength(1);
    expect(await rows("SELECT id FROM identities")).toHaveLength(1);
  });

  it("stamps last_login_at on every link", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const [before] = await rows<{ last_login_at: string }>(
      "SELECT last_login_at FROM identities WHERE user_id = ?",
      id.userId,
    );
    expect(before.last_login_at).not.toBeNull();
  });

  it("gives different subjects different users", async () => {
    const a = await linkIdentity(env, "oidc", "sub-alice");
    const b = await linkIdentity(env, "oidc", "sub-bob");
    expect(a.userId).not.toBe(b.userId);
    expect(a.cryptoSubject).not.toBe(b.cryptoSubject);
    expect(await rows("SELECT id FROM users")).toHaveLength(2);
  });

  it("treats the same subject from a different provider as a different user", async () => {
    const a = await linkIdentity(env, "oidc", "shared-subject");
    const b = await linkIdentity(env, "other", "shared-subject");
    expect(a.userId).not.toBe(b.userId);
  });

  it("never reuses a crypto subject across users", async () => {
    await linkIdentity(env, "oidc", "sub-a");
    await linkIdentity(env, "oidc", "sub-b");
    const subjects = await rows<{ crypto_subject: string }>(
      "SELECT crypto_subject FROM users",
    );
    expect(new Set(subjects.map((s) => s.crypto_subject)).size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/db/identities.test.ts`
Expected: FAIL — `./identities.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/db/identities.ts`:

```ts
import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject, type CryptoSubject } from "../crypto.js";
import { buildUserKeyInsert, type UserIdentity } from "./users.js";

/** `usr_<32 hex>`. Opaque, server-minted, never derived from an IdP subject. */
export function newUserId(): string {
  return newId("usr");
}

/** `cs_<32 hex>`. Minted once per user and never changed thereafter. */
export function newCryptoSubject(): CryptoSubject {
  return asCryptoSubject(newId("cs"));
}

/**
 * Resolve an OIDC subject to our user, creating the account on first sight.
 *
 * Creation is one D1 batch — user, identity, and wrapped DEK together — so a
 * partial failure cannot leave a user without a key. `loadUserKey` refuses to
 * mint, which makes that atomicity load-bearing rather than merely tidy.
 */
export async function linkIdentity(
  env: Env,
  provider: string,
  providerSubject: string,
): Promise<UserIdentity> {
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT u.id AS user_id, u.crypto_subject AS crypto_subject
     FROM identities i
     JOIN users u ON u.id = i.user_id
     WHERE i.provider = ? AND i.provider_subject = ?`,
  )
    .bind(provider, providerSubject)
    .first<{ user_id: string; crypto_subject: string }>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE identities SET last_login_at = ? WHERE provider = ? AND provider_subject = ?",
    )
      .bind(now, provider, providerSubject)
      .run();
    return {
      userId: existing.user_id,
      cryptoSubject: asCryptoSubject(existing.crypto_subject),
    };
  }

  const identity: UserIdentity = {
    userId: newUserId(),
    cryptoSubject: newCryptoSubject(),
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, crypto_subject, status, locale, timezone,
                          entitlement_tier, created_at, updated_at)
       VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
    ).bind(identity.userId, identity.cryptoSubject, now, now),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, provider, provider_subject, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId("idn"), identity.userId, provider, providerSubject, now, now),
    await buildUserKeyInsert(env, identity),
  ]);

  return identity;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api -- src/db/identities.test.ts`
Expected: PASS, 7 tests.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/identities.ts apps/api/src/db/identities.test.ts
git commit -m "feat(api): link OIDC subjects to users, minting account and key atomically"
```

---

### Task 6: Session storage

**Files:**
- Create: `apps/api/src/db/sessions.ts`
- Test: `apps/api/src/db/sessions.test.ts` (create)

**Interfaces:**
- Consumes: the `sessions` table from Task 3; `UserIdentity` from Task 4;
  `linkIdentity` from Task 5.
- Produces:
  - `export const SESSION_TTL_SECONDS = 2_592_000` (30 days)
  - `export interface SessionPrincipal extends UserIdentity { sessionId: string; status: string }`
  - `export async function createSession(env, userId: string): Promise<{ token: string; expiresAt: string }>`
  - `export async function resolveSession(env, token: string): Promise<SessionPrincipal | null>`
  - `export async function revokeSession(env, sessionId: string): Promise<void>`
  - `export async function revokeAllSessions(env, userId: string): Promise<number>`
  Task 7 depends on all of these.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/sessions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity } from "./identities.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessions,
} from "./sessions.js";

describe("sessions", () => {
  beforeEach(resetDb);

  it("issues a token that resolves to the user's two identifiers", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const principal = await resolveSession(env, token);
    expect(principal?.userId).toBe(id.userId);
    expect(principal?.cryptoSubject).toBe(id.cryptoSubject);
    expect(principal?.status).toBe("active");
  });

  it("stores a hash, never the token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const stored = await rows<{ token_sha256: string }>(
      "SELECT token_sha256 FROM sessions",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].token_sha256).not.toBe(token);
    expect(stored[0].token_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The raw token must appear in no column of the row.
    const whole = await rows<Record<string, unknown>>("SELECT * FROM sessions");
    expect(JSON.stringify(whole)).not.toContain(token);
  });

  it("rejects an unknown token", async () => {
    expect(await resolveSession(env, "not-a-real-token")).toBeNull();
  });

  it("rejects a revoked token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    const principal = await resolveSession(env, token);

    await revokeSession(env, principal!.sessionId);
    expect(await resolveSession(env, token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'",
    ).run();
    expect(await resolveSession(env, token)).toBeNull();
  });

  it("revokes every session for a user at once", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const a = await createSession(env, id.userId);
    const b = await createSession(env, id.userId);

    expect(await revokeAllSessions(env, id.userId)).toBe(2);
    expect(await resolveSession(env, a.token)).toBeNull();
    expect(await resolveSession(env, b.token)).toBeNull();
  });

  it("issues distinct tokens for distinct sessions", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const a = await createSession(env, id.userId);
    const b = await createSession(env, id.userId);
    expect(a.token).not.toBe(b.token);
  });

  it("does not leak one user's session to another", async () => {
    const alice = await linkIdentity(env, "oidc", "sub-alice");
    const bob = await linkIdentity(env, "oidc", "sub-bob");
    const { token } = await createSession(env, alice.userId);

    const principal = await resolveSession(env, token);
    expect(principal?.userId).toBe(alice.userId);
    expect(principal?.userId).not.toBe(bob.userId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/db/sessions.test.ts`
Expected: FAIL — `./sessions.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/db/sessions.ts`:

```ts
import { newId, sha256Hex } from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import type { UserIdentity } from "./users.js";

/**
 * 30 days, absolute — not sliding. A sliding window on a bearer that unlocks
 * highly_sensitive birth data lets a stolen token renew itself indefinitely.
 */
export const SESSION_TTL_SECONDS = 2_592_000;

export interface SessionPrincipal extends UserIdentity {
  sessionId: string;
  /** users.status — the account-state gate reads this. */
  status: string;
}

/** 32 random bytes, base64url. Returned once; only its hash is stored. */
function mintToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(
  env: Env,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = mintToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_sha256, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(newId("ses"), userId, await sha256Hex(token), now.toISOString(), expiresAt)
    .run();

  return { token, expiresAt };
}

/**
 * Resolve a bearer to its principal, or null.
 *
 * Null covers unknown, revoked, and expired alike: the caller gets one
 * undifferentiated 401, because telling an attacker which of the three it was is
 * free information.
 */
export async function resolveSession(
  env: Env,
  token: string,
): Promise<SessionPrincipal | null> {
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.crypto_subject AS crypto_subject,
            u.status AS status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_sha256 = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{
      session_id: string;
      user_id: string;
      crypto_subject: string;
      status: string;
    }>();

  if (!row) return null;

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
    status: row.status,
  };
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(new Date().toISOString(), sessionId)
    .run();
}

/**
 * Invalidate every live session for a user. This is the primitive behind the
 * spec's "invalidate sessions" recovery control, and is why identity is a local
 * session rather than a statelessly verified IdP token.
 */
export async function revokeAllSessions(env: Env, userId: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
  )
    .bind(new Date().toISOString(), userId)
    .run();
  return result.meta.changes ?? 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api -- src/db/sessions.test.ts`
Expected: PASS, 8 tests.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/sessions.ts apps/api/src/db/sessions.test.ts
git commit -m "feat(api): add session storage keyed on a token hash"
```

---

### Task 7: Verify OIDC ID tokens against a cached JWKS

**Files:**
- Create: `apps/api/src/services/identity.ts`
- Test: `apps/api/src/services/identity.test.ts` (create)
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/package.json` (Hono floor)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface VerifiedToken { provider: string; subject: string }`
  - `export class TokenVerificationError extends Error` with `readonly code = "unauthorized"`
  - `export async function verifyIdToken(env: Env, token: string): Promise<VerifiedToken>`
  - `export function __resetJwksCacheForTests(): void`
  - `Env` gains `OIDC_ISSUER: string`, `OIDC_AUDIENCE: string`,
    `OIDC_JWKS_URL: string`, and the previously undeclared `SE_LICENSE_MODE: string`.
  Task 8 depends on `verifyIdToken` and `TokenVerificationError`.

**Why the cache is ours:** `Jwt.verifyWithJwks` re-fetches `jwks_uri` on **every**
call. Passing `keys:` from a module-scope cache is what makes verification one
network round trip per isolate per TTL instead of one per request.

- [ ] **Step 1: Raise the Hono floor**

In `apps/api/package.json`, change the `hono` dependency from `"^4.7.10"` to
`"^4.12.32"`.

At 4.7.10 the function is named `verifyFromJwks`, there is no `allowedAlgorithms`
option, and `verify` takes only `alg?` — so it cannot check `iss` or `aud` at all.

Run: `npm install`
Expected: no change to `package-lock.json`'s resolved `hono` version (4.12.32 is
already installed and satisfies the new range).

- [ ] **Step 2: Declare the configuration**

Replace `apps/api/src/env.ts` entirely with:

```ts
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_STUB: string;
  CALC_SERVICE_URL: string;
  SCHEMA_VERSION: string;
  /** Set in wrangler.toml; was previously absent from this interface. */
  SE_LICENSE_MODE: string;
  /** Expected `iss` on an ID token, e.g. "https://issuer.example.com". */
  OIDC_ISSUER: string;
  /** Expected `aud` on an ID token — this application's client id. */
  OIDC_AUDIENCE: string;
  /** Absolute URL of the issuer's JWKS document. */
  OIDC_JWKS_URL: string;
  ROOT_KEK?: string;
  SERVICE_AUTH_TOKEN?: string;
  ARTIFACTS?: R2Bucket;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/api/src/services/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Jwt } from "hono/utils/jwt";
import {
  verifyIdToken,
  TokenVerificationError,
  __resetJwksCacheForTests,
} from "./identity.js";
import type { Env } from "../env.js";

const ISSUER = "https://issuer.test";
const AUDIENCE = "patternlike-web";
const JWKS_URL = "https://issuer.test/.well-known/jwks.json";

/**
 * workers-types' JsonWebKey has NO `kid` member, so a bare
 * `JsonWebKey[]` rejects the fixture with TS2353. Verified against this repo's
 * tsconfig. Extending it is accepted.
 */
interface JwkWithKid extends JsonWebKey {
  kid: string;
}

let keyPair: CryptoKeyPair;
let jwks: { keys: JwkWithKid[] };

async function makeKeys() {
  keyPair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwks = { keys: [{ ...pub, kid: "test-key-1", alg: "RS256", use: "sig" }] };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const priv = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return Jwt.sign({ ...claims }, { ...priv, kid: "test-key-1" } as never, "RS256");
}

function testEnv(): Env {
  return {
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    OIDC_JWKS_URL: JWKS_URL,
  } as unknown as Env;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifyIdToken", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    __resetJwksCacheForTests();
    if (!keyPair) await makeKeys();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === JWKS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("accepts a correctly signed token and returns its subject", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    const verified = await verifyIdToken(testEnv(), token);
    expect(verified.subject).toBe("sub-alice");
    expect(verified.provider).toBe(ISSUER);
  });

  it("caches the key set across calls within one isolate", async () => {
    const token = await signToken({
      iss: ISSUER, aud: AUDIENCE, sub: "sub-alice",
      exp: nowSeconds() + 300, iat: nowSeconds(),
    });
    await verifyIdToken(testEnv(), token);
    await verifyIdToken(testEnv(), token);
    // Annotate the callback parameter: mock.calls is loosely typed and an
    // implicit `any` is a compile error under this repo's strict config.
    const jwksCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]) === JWKS_URL,
    );
    expect(jwksCalls).toHaveLength(1);
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await signToken({
      iss: "https://evil.test", aud: AUDIENCE, sub: "sub-alice",
      exp: nowSeconds() + 300, iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a token for the wrong audience", async () => {
    const token = await signToken({
      iss: ISSUER, aud: "some-other-app", sub: "sub-alice",
      exp: nowSeconds() + 300, iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await signToken({
      iss: ISSUER, aud: AUDIENCE, sub: "sub-alice",
      exp: nowSeconds() - 10, iat: nowSeconds() - 300,
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a token with no subject", async () => {
    const token = await signToken({
      iss: ISSUER, aud: AUDIENCE,
      exp: nowSeconds() + 300, iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects garbage that is not a JWT", async () => {
    await expect(verifyIdToken(testEnv(), "not.a.jwt")).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("never surfaces the underlying library message", async () => {
    try {
      await verifyIdToken(testEnv(), "not.a.jwt");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("Token verification failed");
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/services/identity.test.ts`
Expected: FAIL — `./identity.js` does not exist.

- [ ] **Step 5: Write the implementation**

Create `apps/api/src/services/identity.ts`:

```ts
import { Jwt } from "hono/utils/jwt";
import type { Env } from "../env.js";

export interface VerifiedToken {
  /** The issuer, stored as identities.provider. */
  provider: string;
  /** The `sub` claim, stored as identities.provider_subject. */
  subject: string;
}

/**
 * Every verification failure, flattened.
 *
 * The message is deliberately constant: an unauthenticated caller learns only
 * that the token was rejected, never which claim failed or what the underlying
 * library said. The cause is kept for logs.
 */
export class TokenVerificationError extends Error {
  readonly code = "unauthorized";
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super("Token verification failed", options);
    this.name = "TokenVerificationError";
  }
}

/** Only asymmetric signatures. A symmetric alg would let the token sign itself. */
const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"] as const;

/** Key sets change rarely; an isolate lives minutes to hours. */
const JWKS_TTL_MS = 10 * 60 * 1000;

interface JwksCacheEntry {
  keys: JsonWebKey[];
  fetchedAt: number;
}

// Module scope: a Worker isolate reuses this across requests, so verification
// costs one JWKS fetch per isolate per TTL rather than one per request.
// Jwt.verifyWithJwks re-fetches jwks_uri on EVERY call, which is why we fetch
// ourselves and hand it `keys` instead.
let jwksCache: JwksCacheEntry | null = null;

/** Test seam. Never called by production code. */
export function __resetJwksCacheForTests(): void {
  jwksCache = null;
}

async function loadJwks(url: string): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  let keys: JsonWebKey[];
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`JWKS endpoint returned ${res.status}`);
    }
    const doc = (await res.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
      throw new Error("JWKS document has no keys");
    }
    keys = doc.keys;
  } catch (err) {
    // Serve a stale key set rather than locking every user out of the product
    // because the issuer had a bad minute. Keys are long-lived; staleness here
    // is far less harmful than a total auth outage.
    if (jwksCache) {
      console.error("jwks_refresh_failed_using_stale", {
        message: err instanceof Error ? err.message : String(err),
      });
      return jwksCache.keys;
    }
    throw new TokenVerificationError("jwks_unavailable", { cause: err });
  }

  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verify an OIDC ID token and return the identity it asserts.
 *
 * Checks the signature against the issuer's published keys, plus `iss`, `aud`,
 * `exp`, and `nbf`. Throws TokenVerificationError for every failure mode.
 */
export async function verifyIdToken(
  env: Env,
  token: string,
): Promise<VerifiedToken> {
  const keys = await loadJwks(env.OIDC_JWKS_URL);

  let payload: Record<string, unknown>;
  try {
    payload = (await Jwt.verifyWithJwks(token, {
      keys: keys as never,
      verification: {
        iss: env.OIDC_ISSUER,
        aud: env.OIDC_AUDIENCE,
        nbf: true,
        exp: true,
      },
      allowedAlgorithms: [...ALLOWED_ALGORITHMS],
    })) as Record<string, unknown>;
  } catch (err) {
    throw new TokenVerificationError("signature_or_claims", { cause: err });
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new TokenVerificationError("missing_subject");
  }

  return { provider: env.OIDC_ISSUER, subject };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api -- src/services/identity.test.ts`
Expected: PASS, 8 tests.

If `Jwt.sign` will not accept an exported JWK private key in this runtime,
replace `signToken` with a direct `crypto.subtle.sign` over
`base64url(header) + "." + base64url(payload)` — the assertions are unchanged.
Do not weaken any assertion to make the harness easier.

Run: `npm run typecheck`
Expected: **clean.** Nothing typechecks `wrangler.toml` against `Env` — the
interface is a declaration, not a validated schema, and `apps/api/test/env.d.ts`
merely extends it into `Cloudflare.Env`. Adding required fields therefore breaks
nothing at compile time, which is exactly why the runtime guard in Task 9 is
necessary rather than optional.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/identity.ts apps/api/src/services/identity.test.ts \
        apps/api/src/env.ts apps/api/package.json package-lock.json
git commit -m "feat(api): verify OIDC id tokens against a module-scope JWKS cache"
```

---

### Task 8: `authenticate` and the session routes

**Files:**
- Modify: `apps/api/src/middleware/auth.ts` — the whole of `authStub`, which
  Task 4 Step 5 already edited; `serviceAuth` is untouched
- Create: `apps/api/src/routes/sessions.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/middleware/auth.test.ts`

**Interfaces:**
- Consumes: `linkIdentity` (Task 5); `createSession`, `resolveSession`,
  `revokeSession` (Task 6); `verifyIdToken`, `TokenVerificationError` (Task 7).
- Produces:
  - `AppVariables` gains `cryptoSubject: CryptoSubject` and `sessionId?: string`
  - `export async function authenticate(c, next)` replaces `authStub`
  - `export const SESSION_COOKIE = "pl_session"`
  - `export const sessionRoutes: Hono<{ Bindings: Env; Variables: AppVariables }>`
    serving `POST /v1/sessions` and `DELETE /v1/sessions/current`
  Task 9 depends on nothing here; Task 10 exercises all of it.

**Deviation from the spec, deliberate.** The spec says the `AUTH_STUB=1` branch
is "kept verbatim". It cannot be, and the spec contradicts itself one paragraph
later by requiring that `ensureUser` stop inserting. With user creation moved to
identity-link time, an `X-User-Id` header can no longer conjure an account, and
there is no header the crypto subject could safely come from — fabricating one
would produce ciphertext nobody can read. So the dev branch keeps trusting the
header to *name* a user and now looks the row up, returning 401 if it does not
exist. Tests seed users via `seedUser` (Task 4) or `linkIdentity` (Task 5). This
is strictly safer than the old behaviour and is still refused outside development
by `configGuard`.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/middleware/auth.test.ts`, first **merge** these into the existing
import block at the top of the file — do not add a second `from "vitest"` import
lower down:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../index.js";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity } from "../db/identities.js";
import { createSession } from "../db/sessions.js";
```

Then append the following describe blocks to the end of the file. They reuse
`prodEnv` and `body` from Task 1:

```ts
describe("authenticate", () => {
  beforeEach(resetDb);

  it("rejects a request with no credential", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("rejects an unknown bearer", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: "Bearer totally-made-up" } },
      prodEnv(),
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("never answers 501 auth_not_configured again", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: "Bearer anything" } },
      prodEnv(),
    );
    expect(res.status).not.toBe(501);
    expect((await body(res)).error?.code).not.toBe("auth_not_configured");
  });

  it("accepts a live session presented as a bearer", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    // No chart exists for this user yet, so 404 — but authentication passed.
    // The code is `chart_not_found` (routes/chart.ts), NOT the router's
    // `not_found`: reaching the handler at all is what proves auth succeeded.
    expect(res.status).toBe(404);
    expect((await body(res)).error?.code).toBe("chart_not_found");
  });

  it("accepts the same session presented as a cookie", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const res = await app.request(
      "/v1/chart",
      { headers: { cookie: `pl_session=${token}` } },
      prodEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns the same request id it was given", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { "x-request-id": "req-abc-123" } },
      prodEnv(),
    );
    expect((await body(res)).error?.request_id).toBe("req-abc-123");
  });

  it("still trusts X-User-Id under AUTH_STUB=1 in development", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const res = await app.request(
      "/v1/chart",
      { headers: { "x-user-id": id.userId } },
      { ...env, ENVIRONMENT: "development", AUTH_STUB: "1" },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/sessions", () => {
  beforeEach(resetDb);

  it("is reachable without an existing session", async () => {
    const res = await app.request(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_token: "not-a-real-token" }),
      },
      prodEnv(),
    );
    // 401 because the token is bad — NOT 401 because a session was required.
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("rejects a body with no id_token", async () => {
    const res = await app.request(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
      prodEnv(),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("invalid_body");
  });

  it("revokes the current session on DELETE and stops accepting its token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const del = await app.request(
      "/v1/sessions/current",
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    expect(del.status).toBe(204);

    const after = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    expect(after.status).toBe(401);

    const live = await rows("SELECT id FROM sessions WHERE revoked_at IS NULL");
    expect(live).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/middleware/auth.test.ts`
Expected: FAIL — `/v1/chart` with a bearer returns `501 auth_not_configured`, and
`/v1/sessions` returns 404.

- [ ] **Step 3: Replace `authStub` with `authenticate`**

In `apps/api/src/middleware/auth.ts`, replace **everything from the top of the
file through the closing brace of `authStub`** with the code below, leaving
`serviceAuth` untouched. Do not use the original line numbers — Task 4 Step 5
already lengthened `authStub`, so `1-61` no longer delimits it.

```ts
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../env.js";
import type { CryptoSubject } from "../crypto.js";
import { resolveSession } from "../db/sessions.js";
import { loadUserIdentity } from "../db/users.js";

export type AppVariables = {
  userId: string;
  /** The immutable AEAD/DEK subject. Never a request-supplied value. */
  cryptoSubject: CryptoSubject;
  requestId: string;
  /** Present only when a real session authenticated the request. */
  sessionId?: string;
};

/** Same-origin browsers present the session here; native clients use Bearer. */
export const SESSION_COOKIE = "pl_session";

function unauthorized(c: Context, requestId: string) {
  return c.json(
    {
      error: {
        code: "unauthorized",
        message: "Authentication required",
        request_id: requestId,
      },
    },
    401,
  );
}

/** Cookie first — a browser sends both only if something is misconfigured. */
export function readSessionToken(c: Context): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return null;
}

/**
 * Resolve the caller.
 *
 * The AUTH_STUB=1 branch is unchanged development behaviour and is refused
 * outside development by configGuard. Everything else resolves an opaque
 * session token — issued by POST /v1/sessions after an OIDC exchange — to a
 * user id and a crypto subject in a single read.
 */
export async function authenticate(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);

  if (c.env.AUTH_STUB === "1") {
    const userId = c.req.header("x-user-id");
    if (!userId || userId.length < 8) {
      return c.json(
        {
          error: {
            code: "unauthorized",
            message: "Provide X-User-Id header when AUTH_STUB=1",
            request_id: requestId,
          },
        },
        401,
      );
    }
    // The header names a user; it does not create one. The crypto subject is
    // read from the row, never fabricated from the header.
    const identity = await loadUserIdentity(c.env, userId);
    if (!identity) return unauthorized(c, requestId);
    c.set("userId", identity.userId);
    c.set("cryptoSubject", identity.cryptoSubject);
    await next();
    return;
  }

  const token = readSessionToken(c);
  if (!token) return unauthorized(c, requestId);

  const principal = await resolveSession(c.env, token);
  // Unknown, revoked, and expired are one answer: which it was is free
  // information for an attacker.
  if (!principal) return unauthorized(c, requestId);

  c.set("userId", principal.userId);
  c.set("cryptoSubject", principal.cryptoSubject);
  c.set("sessionId", principal.sessionId);
  await next();
}
```

Leave `serviceAuth` (lines 63-100) untouched.

- [ ] **Step 4: Add the session routes**

Create `apps/api/src/routes/sessions.ts`:

```ts
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../env.js";
import {
  SESSION_COOKIE,
  readSessionToken,
  type AppVariables,
} from "../middleware/auth.js";
import { verifyIdToken, TokenVerificationError } from "../services/identity.js";
import { linkIdentity } from "../db/identities.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  SESSION_TTL_SECONDS,
} from "../db/sessions.js";

export const sessionRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function requestId(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header("x-request-id") ?? crypto.randomUUID();
}

/**
 * Exchange an OIDC ID token for a session.
 *
 * Mounted OUTSIDE the authenticated router in index.ts: requiring a session to
 * create a session is a deadlock. It still sits behind configGuard.
 */
sessionRoutes.post("/v1/sessions", async (c) => {
  const rid = requestId(c);

  let body: { id_token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  if (typeof body.id_token !== "string" || body.id_token.length === 0) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: "id_token is required",
          request_id: rid,
        },
      },
      400,
    );
  }

  let verified;
  try {
    verified = await verifyIdToken(c.env, body.id_token);
  } catch (err) {
    // The reason is a log-only detail; the caller gets one flat 401.
    console.error("id_token_rejected", {
      request_id: rid,
      reason: err instanceof TokenVerificationError ? err.reason : "unknown",
    });
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required",
          request_id: rid,
        },
      },
      401,
    );
  }

  const identity = await linkIdentity(c.env, verified.provider, verified.subject);
  const { token, expiresAt } = await createSession(c.env, identity.userId);

  // Browsers get an httpOnly cookie so XSS cannot read the token; native
  // clients use the body value as a bearer. Both resolve the same session row.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1",
    maxAge: SESSION_TTL_SECONDS,
  });

  return c.json({ token, expires_at: expiresAt }, 201);
});

/** Log out. Idempotent: an already-invalid token still yields 204. */
sessionRoutes.delete("/v1/sessions/current", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const principal = await resolveSession(c.env, token);
    if (principal) await revokeSession(c.env, principal.sessionId);
  }
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1",
    maxAge: 0,
  });
  return c.body(null, 204);
});
```

- [ ] **Step 5: Wire the routes and rename the middleware**

In `apps/api/src/index.ts`:

Change the import on line 3 to:

```ts
import { authenticate, serviceAuth, type AppVariables } from "./middleware/auth.js";
```

Add after line 8:

```ts
import { sessionRoutes } from "./routes/sessions.js";
```

Replace line 18 (`api.use("*", authStub);`) with:

```ts
api.use("*", authenticate);
```

Add immediately after line 12 (`app.route("/", healthRoutes);`):

```ts
// Session exchange is unauthenticated by necessity — it is what mints the
// session everything else requires — but still config-guarded.
//
// configGuard is attached to the two session paths directly rather than via a
// sub-app with use("*", ...) routed at "/". That sub-app pattern is exactly the
// defect Task 1 removed: a router mounted at "/" contributes its wildcard
// middleware to EVERY path in the parent.
app.use("/v1/sessions", configGuard);
app.use("/v1/sessions/*", configGuard);
app.route("/", sessionRoutes);
```

Both `use` lines are needed: Hono matches `"/v1/sessions"` and
`"/v1/sessions/*"` as distinct patterns, and `DELETE /v1/sessions/current` only
matches the second.

`sessionRoutes` must be routed **before** `app.route("/", api)` on line 31, so
`/v1/sessions` resolves to its own handler rather than falling through to the
authenticated router.

Verify the wiring before moving on — the chain for each path must be:

```
POST   /v1/sessions             -> configGuard, configGuard   (no authenticate)
DELETE /v1/sessions/current     -> configGuard                (no authenticate)
GET    /v1/chart                -> configGuard -> authenticate
POST   /internal/content-releases-> configGuard -> serviceAuth
GET    /health                  -> (none)
```

`POST /v1/sessions` matching **both** `use` patterns is expected and harmless —
`checkSecureConfig` is a pure function, so running it twice is idempotent.
Verified by probe against Hono 4.12.32.

What matters is that `GET /v1/chart` shows `configGuard` exactly **once** and
never `serviceAuth`. If it shows `configGuard` twice, a sub-app carrying wildcard
middleware has been routed at `"/"` again — the Task 1 defect, reintroduced.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w @patternlike/api -- src/middleware/auth.test.ts`
Expected: PASS, 16 tests — Task 1's 6, plus 7 in `authenticate` and 3 in
`POST /v1/sessions`.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/routes/sessions.ts \
        apps/api/src/index.ts apps/api/src/middleware/auth.test.ts
git commit -m "feat(api): replace the auth stub with session-backed authentication"
```

---

### Task 9: Refuse to serve without identity configuration

**Files:**
- Modify: `apps/api/src/middleware/config-guard.ts:24-44`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/src/config.test.ts`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: the `Env` fields from Task 7.
- Produces: `checkSecureConfig` returns `{ code: "identity_not_configured" }`
  when any of `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` is absent outside
  development. No later task depends on this.

**Why:** a deploy that forgets `OIDC_JWKS_URL` would otherwise fail per request
inside the verifier — as an opaque 401 — rather than as a loud 503 at the guard.
`SE_LICENSE_MODE` was already set in `wrangler.toml` and absent from `Env`, which
is the same drift this prevents recurring.

- [ ] **Step 1: Repair the pre-existing assertion this breaks, then write the failing test**

`apps/api/src/config.test.ts:13-15` currently asserts that a production
environment with only a strong `ROOT_KEK` is acceptable:

```ts
    expect(
      checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK }),
    ).toBeNull();
```

After this task that returns `identity_not_configured`, so the assertion is
wrong rather than merely incomplete. Change it to supply the OIDC values, and
rename the test to say what it now proves:

```ts
  it("accepts a fully configured production environment", () => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "production",
        ROOT_KEK: STRONG_KEK,
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_AUDIENCE: "patternlike-web",
        OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
      }),
    ).toBeNull();
  });
```

Leave the other cases alone: `:19`, `:24`, `:29`, and `:38` all assert a
**failure** code, and each still fails for its original reason — `ROOT_KEK` is
checked before the identity block, so those return `root_kek_not_configured`
exactly as before.

Then append:

```ts
describe("identity configuration", () => {
  const configured = {
    ENVIRONMENT: "production",
    ROOT_KEK: "a-real-root-kek-long-enough-to-pass-the-check",
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  };

  it("passes when every OIDC value is present", () => {
    expect(checkSecureConfig(configured)).toBeNull();
  });

  it.each(["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const)(
    "refuses to serve when %s is missing",
    (key) => {
      const failure = checkSecureConfig({ ...configured, [key]: undefined });
      expect(failure?.code).toBe("identity_not_configured");
    },
  );

  it.each(["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const)(
    "refuses to serve when %s is blank",
    (key) => {
      const failure = checkSecureConfig({ ...configured, [key]: "   " });
      expect(failure?.code).toBe("identity_not_configured");
    },
  );

  it("does not require OIDC configuration in development", () => {
    expect(
      checkSecureConfig({ ENVIRONMENT: "development", AUTH_STUB: "1" }),
    ).toBeNull();
  });

  it("does not require OIDC configuration under ENVIRONMENT=test", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "test" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/config.test.ts`
Expected: FAIL — `checkSecureConfig` returns `null` for every missing OIDC value.

- [ ] **Step 3: Extend the guard**

In `apps/api/src/middleware/config-guard.ts`, change the signature on lines 24-26
to accept the new keys, and add the identity check immediately before the final
`return null;`:

```ts
export function checkSecureConfig(
  env:
    | Pick<
        Env,
        | "ENVIRONMENT"
        | "AUTH_STUB"
        | "ROOT_KEK"
        | "OIDC_ISSUER"
        | "OIDC_AUDIENCE"
        | "OIDC_JWKS_URL"
      >
    | Partial<Env>,
): ConfigFailure | null {
```

```ts
  // Identity is not optional outside development. Without these the verifier
  // fails per request as an opaque 401; a deploy that forgot a secret should
  // fail loudly at the guard instead.
  const identityKeys = ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const;
  const missing = identityKeys.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    return {
      code: "identity_not_configured",
      message:
        "Identity provider configuration is incomplete; the API cannot authenticate anyone",
    };
  }
  return null;
```

- [ ] **Step 4: Configure both environments**

In `apps/api/wrangler.toml`, add to the `[vars]` block (after line 27):

```toml
# Identity. Development uses AUTH_STUB=1 and never reaches the verifier, but the
# Env interface requires these, so they carry non-secret placeholders locally.
OIDC_ISSUER = "https://issuer.invalid"
OIDC_AUDIENCE = "patternlike-local"
OIDC_JWKS_URL = "https://issuer.invalid/.well-known/jwks.json"
```

Add to `[env.production.vars]` (after line 37):

```toml
# Replace with the chosen provider's real values before the first deploy.
# These are configuration, not secrets — the JWKS document is public.
OIDC_ISSUER = "https://issuer.patternlike.app"
OIDC_AUDIENCE = "patternlike-web"
OIDC_JWKS_URL = "https://issuer.patternlike.app/.well-known/jwks.json"
```

Update the secrets comment block at the end of the file to add:

```toml
# NOTE ON ENVIRONMENT NAMING: isDevEnvironment() treats BOTH "development" and
# "test" as development, which disables configGuard and re-enables the
# X-User-Id header. A staging deployment must NOT set ENVIRONMENT = "test".
```

- [ ] **Step 5: Document the configuration**

In `.env.example`, add under the existing API section:

```
# Identity provider (OIDC). Required outside development — every request
# returns 503 configuration_error until all three are set.
OIDC_ISSUER=https://issuer.invalid
OIDC_AUDIENCE=patternlike-local
OIDC_JWKS_URL=https://issuer.invalid/.well-known/jwks.json
```

In `README.md`, find the M1 status list containing
`Privacy center export/delete workflows (API stubs 501)` (around line 121) and
mark the identity item complete, adding a short subsection:

```markdown
### Authentication

`POST /v1/sessions` exchanges an OIDC ID token for a session. Browsers receive
an httpOnly `pl_session` cookie; native clients use the returned `token` as a
bearer. Both resolve the same session row, so `DELETE /v1/sessions/current`
logs out either.

Local development keeps `AUTH_STUB=1` and the `X-User-Id` header. That header
names an existing user — it no longer creates one, so seed a user first.

`ENVIRONMENT=test` counts as development and disables the config guard. Do not
name a staging deployment `test`.
```

- [ ] **Step 6: Run everything**

Run: `npm run test -w @patternlike/api`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run test:contracts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/config-guard.ts apps/api/src/config.test.ts \
        apps/api/wrangler.toml .env.example README.md
git commit -m "feat(api): refuse to serve without identity configuration"
```

---

### Task 10: End-to-end identity integration test

**Files:**
- Create: `apps/api/src/routes/sessions.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 3-9.
- Produces: nothing. This is the spec's done-condition, made executable.

**The spec's done-condition:** *an integration test authenticates with a signed
token against a fixture JWKS, gets a stable `usr_*` id across two requests, and a
request with no token or a token from the wrong issuer gets a 401 with the
standard envelope.*

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/sessions.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { Jwt } from "hono/utils/jwt";
import app from "../index.js";
import { resetDb, rows, ALICE } from "../../test/helpers.js";
import { __resetJwksCacheForTests } from "../services/identity.js";

const ISSUER = "https://issuer.test";
const AUDIENCE = "patternlike-web";
const JWKS_URL = "https://issuer.test/.well-known/jwks.json";

/** workers-types' JsonWebKey has no `kid`; see Task 7. */
interface JwkWithKid extends JsonWebKey {
  kid: string;
}

let keyPair: CryptoKeyPair;
let jwks: { keys: JwkWithKid[] };

function prodEnv() {
  return {
    ...env,
    ENVIRONMENT: "production",
    AUTH_STUB: "",
    ROOT_KEK: "test-root-kek-that-is-long-enough-to-pass",
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    OIDC_JWKS_URL: JWKS_URL,
  };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const priv = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    { iss: ISSUER, aud: AUDIENCE, exp: now + 300, iat: now, ...claims },
    { ...priv, kid: "test-key-1" } as never,
    "RS256",
  );
}

async function startSession(idToken: string) {
  return app.request(
    "/v1/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    },
    prodEnv(),
  );
}

describe("identity end to end", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDb();
    __resetJwksCacheForTests();
    if (!keyPair) {
      keyPair = (await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const pub = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      jwks = { keys: [{ ...pub, kid: "test-key-1", alg: "RS256", use: "sig" }] };
    }
    // Capture the real fetch BEFORE spying. Delegating through
    // `globalThis.fetch` inside the mock would call the spy itself and recurse
    // until the stack blows — and the calc service must still reach
    // vitest.config.ts's outboundService mock.
    const originalFetch = globalThis.fetch;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === JWKS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input as RequestInfo, init);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("issues a session and returns a stable usr_ id across two requests", async () => {
    const token = await signToken({ sub: "sub-alice" });

    const first = await startSession(token);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { token: string };

    const second = await startSession(token);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { token: string };

    // Two logins, two sessions, ONE user.
    expect(secondBody.token).not.toBe(firstBody.token);
    const users = await rows<{ id: string }>("SELECT id FROM users");
    expect(users).toHaveLength(1);
    expect(users[0].id).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(await rows("SELECT id FROM sessions")).toHaveLength(2);
  });

  it("sets an httpOnly SameSite=Strict session cookie", async () => {
    const res = await startSession(await signToken({ sub: "sub-alice" }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pl_session=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("rejects a token from the wrong issuer with the standard envelope", async () => {
    const now = Math.floor(Date.now() / 1000);
    const priv = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const wrongIssuer = await Jwt.sign(
      { iss: "https://evil.test", aud: AUDIENCE, sub: "sub-alice", exp: now + 300, iat: now },
      { ...priv, kid: "test-key-1" } as never,
      "RS256",
    );

    const res = await startSession(wrongIssuer);
    expect(res.status).toBe(401);
    const parsed = (await res.json()) as {
      error: { code: string; message: string; request_id: string };
    };
    expect(parsed.error.code).toBe("unauthorized");
    expect(parsed.error.request_id).toBeTruthy();
    // The envelope must not leak what the library said.
    expect(parsed.error.message).not.toMatch(/jwt|jwks|signature|claim/i);
    expect(await rows("SELECT id FROM users")).toHaveLength(0);
  });

  it("rejects a request with no token", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect(res.status).toBe(401);
    const parsed = (await res.json()) as { error: { code: string; request_id: string } };
    expect(parsed.error.code).toBe("unauthorized");
    expect(parsed.error.request_id).toBeTruthy();
  });

  it("carries the session through a real birth-profile write and chart read", async () => {
    const session = await startSession(await signToken({ sub: "sub-alice" }));
    const { token } = (await session.json()) as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    const post = await app.request(
      "/v1/birth-profiles",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", "idempotency-key": "idem-e2e-1" },
        body: JSON.stringify(ALICE),
      },
      prodEnv(),
    );
    expect(post.status).toBe(202);

    const chart = await app.request("/v1/chart", { headers: auth }, prodEnv());
    expect(chart.status).toBe(200);

    // The ciphertext is bound to the crypto subject, not the user id.
    const [user] = await rows<{ id: string; crypto_subject: string }>(
      "SELECT id, crypto_subject FROM users",
    );
    expect(user.crypto_subject).toMatch(/^cs_[0-9a-f]{32}$/);
    expect(user.crypto_subject).not.toBe(user.id);
  });

  it("does not serve one user's chart to another user's session", async () => {
    const aliceSession = await startSession(await signToken({ sub: "sub-alice" }));
    const { token: aliceToken } = (await aliceSession.json()) as { token: string };

    await app.request(
      "/v1/birth-profiles",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${aliceToken}`,
          "content-type": "application/json",
          "idempotency-key": "idem-e2e-2",
        },
        body: JSON.stringify(ALICE),
      },
      prodEnv(),
    );

    const bobSession = await startSession(await signToken({ sub: "sub-bob" }));
    const { token: bobToken } = (await bobSession.json()) as { token: string };

    const bobChart = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${bobToken}` } },
      prodEnv(),
    );
    expect(bobChart.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @patternlike/api -- src/routes/sessions.integration.test.ts`
Expected: FAIL before Tasks 1 and 3-9 are complete. If those tasks are done, this
should pass on the first run — in which case re-run with one assertion inverted to
confirm the file is actually being discovered and executed, then restore it.

- [ ] **Step 3: Fix whatever it surfaces**

Do not weaken an assertion to make it pass. The spy is already written to capture
the real `fetch` before replacing it and to delegate everything except
`JWKS_URL`, so the calc service still reaches `vitest.config.ts:26`'s
`outboundService`. If the calc path still fails, check that the delegation target
is the captured `originalFetch` and **not** `globalThis.fetch` — the latter is
the spy, and calling it recurses until the stack overflows.

- [ ] **Step 4: Run the full suite**

Run: `npm run test -w @patternlike/api`
Expected: PASS, all suites including the 87 pre-existing tests.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run test:contracts`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sessions.integration.test.ts
git commit -m "test(api): prove the identity path end to end"
```

---

## What this plan deliberately does not do

- **No CORS or same-origin router.** That is Stream 2, and it touches only
  `apps/web`. The `apps/web` client still sends no credential; after this plan it
  receives a well-formed 401 instead of a 501.
- **No consent enforcement.** `routes/birth.ts` still checks `consent_id` for
  presence only. That is Stream 4, which also adds the `users.status` gate that
  turns revocation into a freeze — this plan stores `status` on the principal but
  does not yet act on it.
- **No export, deletion, or `destroyUserKey`.** Stream 5.
- **No `audit_events` writer.** Stream 6, which should call from
  `linkIdentity` and the session routes once it exists.
- **No OpenAPI change.** `POST /v1/sessions`, `DELETE /v1/sessions/current`, and
  the `cookieAuth` security scheme are additive contract edits. They are grouped
  with Stream 4's `/v1/consents` additions so the contract is opened once.
- **No CI enforcement that every `*_enc` column is registered in
  `ENCRYPTED_COLUMNS`.** The spec raises this under §0.2 — `MIGRATIONS.json:14`
  already states the rule, and nothing checks it; four of the six declared
  encrypted columns are unregistered and three have no rotation tripwire. It is
  unrelated to identity and belongs with Stream 9 (operational hardening), but it
  should not be lost: a new encrypted column added without registration becomes
  unreadable at the next key rotation, silently.

## Deferred decisions this plan hard-codes

Both are reversible and are called out so a reviewer can object rather than
discover them in a diff.

- **`SESSION_TTL_SECONDS = 2_592_000`** (30 days, absolute, non-sliding), per the
  spec's "Durations and residual semantics".
- **`JWKS_TTL_MS = 10 * 60 * 1000`**, with a documented fallback to a stale key
  set when a refresh fails. The alternative — failing closed on a JWKS blip —
  logs every user out of the product for the duration of an issuer outage, which
  is a worse trade for key material that rotates on the order of months.
