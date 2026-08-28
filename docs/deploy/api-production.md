# Deploying the production API

Runbook for `patternlike-api-production`, which serves the PWA and API from one
Cloudflare Worker origin.

Encryption-key maintenance has separate runbooks:
[root KEK rotation](./root-kek-rotation.md) and
[single-user DEK rotation](./user-dek-rotation.md). Apply migration `0021`
before deploying the `/crypto-operator/*` routes, store a dedicated
`CRYPTO_OPERATOR_TOKEN`, and never alias it to service, admin, or Codex-runner
authority.

Repository and recorded live state, reconciled 2026-08-27:

| Step | State |
| --- | --- |
| D1 `patternlike-ops` created (`1305a75d-0a8a-4a21-b201-d94fda0aaf93`, ENAM) | done |
| Migrations through `0017` applied remotely | done — `0017` verified around 17:32 UTC on 2026-08-27; Worker version `287bce63-dece-4911-96db-dd212c2cec33` remains the recorded 0016 birth-guard deployment |
| `database_id` wired into `[[env.production.d1_databases]]` | done |
| Origin decided: PWA ships inside the API Worker (`[env.production.assets]`) | done, dry-run validated |
| Auth0 tenant `dev-lqmwkyo17nm5mdjz.us.auth0.com` + SPA app `Pattern/Like Web` | done |
| `OIDC_*` wired into `[env.production.vars]` | done — `identity_not_configured` cleared |
| Worker deployed | **live** — `https://patternlike-api-production.lfd.workers.dev` |
| `ROOT_KEK` / `CALC_SERVICE_AUTH_TOKEN` secrets | set via `wrangler secret bulk`; calc token rotated on Fly to match |
| Sign-in code in `apps/web` | done — `src/lib/auth.ts`, `components/SignedOut.tsx` |
| `SERVICE_AUTH_TOKEN` (`/internal/*`) | set — the route now answers 401, not 503 |
| `/v1/sessions` in the M0 contract | documented; amendment recorded in `SCHEMA_MANIFEST.json` |
| `patternlike-app` on Fly (superseded PWA) | retired — scaled to 0 machines, no longer serving |
| First real sign-in | done — the 2026-08-22 Auth0 canary created a Worker session |
| `ROOT_KEK` recorded off-machine | operator check — not re-verified by this documentation reconciliation |

> **`ROOT_KEK` is unrecoverable.** Cloudflare secrets are write-only. The
> original 2026-08-08 deployment notes said the generated value still needed to
> move from an owner-only scratch file into a password manager. This document
> does not prove that handoff happened. Confirm the off-machine record directly;
> losing the key makes every birth profile permanently unreadable.

Verified live on 2026-08-08: `/` 200 `text/html`, `/health` 200
`application/json`, `/v1/chart`
401 `application/json` (not a 200 of `index.html`, so `run_worker_first` is
correct), `/v1/sessions` 401 on a malformed token and 400 on a missing one,
and `X-User-Id` refused in production.

---

## 1. Identity provider — provisioned 2026-08-08

| | |
| --- | --- |
| Tenant | `dev-lqmwkyo17nm5mdjz.us.auth0.com` |
| Application | `Pattern/Like Web` (SPA) |
| `OIDC_ISSUER` | `https://dev-lqmwkyo17nm5mdjz.us.auth0.com/` (trailing slash — from discovery) |
| `OIDC_AUDIENCE` | `bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ` (client id) |
| `OIDC_JWKS_URL` | `…/.well-known/jwks.json` — 2 keys, both `RS256`/`use: sig` |
| Grants | `authorization_code`, `refresh_token` — **`implicit` removed** post-create |
| Auth method | `token_endpoint_auth_method: none` (public client + PKCE) |

`checkSecureConfig` no longer reports `identity_not_configured`. It still
returns 503 for `root_kek_not_configured` until §2 runs.

> **This is a `dev-` tenant.** Moving to a production tenant later changes
> `OIDC_ISSUER`, and `db/identities.ts` looks users up by
> `(provider, provider_subject)` where `provider` *is* the issuer string. Every
> returning user would be unrecognised and given a fresh user id and crypto
> subject, leaving their encrypted birth data sealed under the old subject.
> Switch tenants **before the first real user**, or plan an `identities` rewrite.

### How it was created (for reproducing in another tenant)

`configGuard` returns `503 configuration_error` on **every** request while
`OIDC_ISSUER`, `OIDC_AUDIENCE`, or `OIDC_JWKS_URL` is missing or still contains
`issuer.invalid` (`apps/api/src/middleware/config-guard.ts:68-79`). There is no
bypass: setting `ENVIRONMENT=development` to dodge the guard re-enables
`AUTH_STUB` trusting an unauthenticated `X-User-Id` header, which is the exact
failure the guard exists to prevent.

The backend is vendor-neutral — it verifies `iss`, `aud`, and a JWKS signature
and nothing else — so the provider is swappable later. **Auth0 is the
recommendation** for M1: it issues standard OIDC ID tokens, which is precisely
what `verifyIdToken` consumes. Clerk and WorkOS mint their own session JWTs and
need a JWT-template detour; Cloudflare Access is zero-trust gating for internal
apps, not consumer sign-up.

### What the verifier requires

From `apps/api/src/services/identity.ts`:

| Requirement | Where | Note |
| --- | --- | --- |
| `RS256/384/512` or `ES256/384` | `:30` | Symmetric algs rejected — a symmetric token could sign itself |
| `iss` **exactly** equals `OIDC_ISSUER` | `:120` | See the trailing-slash trap below |
| `aud` **exactly** equals `OIDC_AUDIENCE` | `:121` | For an ID token this is the **client id** |
| `exp` present and numeric | `:132` | Checked explicitly; Hono's own check is presence-guarded and would let a no-`exp` token live forever |
| `nbf` honoured | `:123` | |
| `iat` **not** checked | `:124` | Deliberate: no skew leeway upstream, and `exp` is what bounds token life |
| `sub` non-empty string | `:136` | Stored as `identities.provider_subject` |

> **Trailing-slash trap.** Auth0's `iss` claim is
> `https://<tenant>.<region>.auth0.com/` **with** a trailing slash. `OIDC_ISSUER`
> is compared with strict equality, so omitting it rejects every token with an
> opaque 401 (the reason is logged as `id_token_rejected`, never returned).

> **Audience trap.** The code verifies an **ID token**, so `aud` is the SPA
> client id. Auth0's separate "API Audience" (the `audience` request parameter)
> produces an access token with a different `aud` and will not verify.

### Auth0 console steps

1. Create a tenant.
2. **Applications → Create Application → Single Page Web Application.**
3. Set all three of these lists to the same two values — the deployed Worker
   origin and the Vite dev server:
   - Allowed Callback URLs
   - Allowed Logout URLs
   - Allowed Web Origins

   ```
   https://patternlike-api-production.lfd.workers.dev
   http://127.0.0.1:5173
   ```

   `auth0-spa-js` defaults `redirect_uri` to `window.location.origin`, so the
   bare origin is the right value — no `/callback` path. Note this is the
   **Worker** origin, not `patternlike-app.fly.dev`: the PWA moved into the
   Worker when the origin decision changed.
4. Leave the signing algorithm at RS256 and the grant at Authorization Code + PKCE.
5. Copy the domain and client id into `apps/api/wrangler.toml`:

```toml
[env.production.vars]
OIDC_ISSUER   = "https://<tenant>.us.auth0.com/"   # trailing slash
OIDC_AUDIENCE = "<SPA client id>"
OIDC_JWKS_URL = "https://<tenant>.us.auth0.com/.well-known/jwks.json"
```

These are configuration, not secrets — the JWKS document is public — so they
belong in `[vars]`, not `wrangler secret put`.

### Or use the Auth0 CLI

[`auth0-cli`](https://github.com/auth0/auth0-cli) does steps 2–5 in one command.
It is **not in winget** (checked 2026-08-08); on Windows install via
`scoop install auth0`, or grab the release binary and put it on `$PATH`:

```bash
gh release download --repo auth0/auth0-cli --pattern "*Windows_x86_64.zip"
```

Creating the tenant is *not* a CLI operation — sign up in the dashboard first,
then:

> `auth0 login` prompts with an arrow-key TUI and must be run in a **real
> terminal**. Through a non-interactive wrapper (a CI step, or Claude Code's `!`
> bridge) it dies with `An unexpected error occurred: Incorrect function.` — the
> Windows console API rejecting a handle it cannot make raw. There is no flag to
> pick "As a user" non-interactively; the prompt only disappears on the machine
> path below.
>
> For CI, create a Machine-to-Machine app authorized for the Auth0 Management
> API and use:
> `auth0 login --domain <d> --client-id <id> --client-secret <secret>`

```bash
auth0 login          # device-authorization flow; opens a browser

URLS="https://patternlike-api-production.lfd.workers.dev,http://127.0.0.1:5173"
auth0 apps create \
  --name "Pattern/Like Web" \
  --type spa \
  --callbacks   "$URLS" \
  --logout-urls "$URLS" \
  --origins     "$URLS" \
  --web-origins "$URLS" \
  --json
```

The JSON output carries the `client_id` for `OIDC_AUDIENCE`. Confirm the URL
lists landed as intended with `auth0 apps show <client-id> --json`.

To get a real token for the verification ladder in §3:

```bash
auth0 test login <client-id>     # runs Universal Login, returns an ID token
```

> **Use `test login`, not `test token`.** `auth0 test token` requests an
> **access token** for an API identifier — its `aud` is the API, not the client
> id, so it fails `verifyIdToken` exactly like the audience trap above. The
> session exchange wants the **ID token** that `test login` produces.

## 2. Deploy the signer, apply 0011, then deploy the API

The API Worker now declares `ONTOLOGY_SIGNER`. Cloudflare refuses that upload
until `patternlike-ontology-signer-production` exists. Secrets cannot be put
on a Worker that does not exist yet.

```bash
# 1. Create the signer Worker (no routes, workers_dev off).
npm run deploy:signer

# 2. Signing key lives only here. Named environments do not inherit secrets.
npx wrangler secret put PATTERN_ONTOLOGY_SIGNING_KEY \
  --config apps/ontology-signer/wrangler.toml --env production

# 3. Terminal evidence table. Bookmark and export first, same as 0002/0008.
npx wrangler d1 migrations apply patternlike-ops --env production --remote \
  --config apps/api/wrangler.toml

# 4. Evaluation-artifact AES keyring on the API Worker (already exists).
# Shape: {"version":1,"keys":{"<key_id>":"<unpadded base64url 32-byte AES key>"}}
npx wrangler secret put ONTOLOGY_PIPELINE_ARTIFACT_KEYRING \
  --config apps/api/wrangler.toml --env production

# 5. API + PWA. This is the deploy that first names the signer binding.
npm run deploy:api
```

Then, from `apps/api/`, the existing API secrets if they are not already set:

```bash
# ROOT_KEK — >=32 chars, must not be the dev placeholder. Record it in a
# password manager BEFORE real users exist: it is the root of the envelope
# encryption tree, and losing it makes every birth profile unreadable.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put ROOT_KEK --env production

# CALC_SERVICE_AUTH_TOKEN — must match the value already on Fly.
npx wrangler secret put CALC_SERVICE_AUTH_TOKEN --env production
```

`SERVICE_AUTH_TOKEN` (internal WordPress → CF content releases) is not on the
M1 chart path. Leaving it unset makes `/internal/*` return
`503 service_auth_not_configured`, which is the correct closed state.

### The calc token has to be rotated

Fly secrets are write-only — the value behind digest `d343ce595a78ef8b` on
`patternlike-calc` cannot be read back. Unless it was saved somewhere, generate
a new one and set it on both sides:

```bash
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
fly secrets set CALC_SERVICE_AUTH_TOKEN="$TOKEN" -a patternlike-calc   # restarts machines
npx wrangler secret put CALC_SERVICE_AUTH_TOKEN --env production        # paste same value
```

`fly secrets set` restarts the calc machines. The service is currently healthy
and serving, so schedule it deliberately.

## 3. The origin

**The PWA ships inside the API Worker.** One Worker serves the static app and
`/v1`, so there is a single origin at
`https://patternlike-api-production.lfd.workers.dev` — no proxy, no custom
domain, no second platform.

Why same-origin is a requirement rather than a preference: sessions ride an
httpOnly cookie with `SameSite=Strict` and `Path=/v1`
(`apps/api/src/routes/sessions.ts:82-88`). Cross-origin makes it a third-party
cookie, which Safari's ITP blocks — and the live traffic in the Fly logs is iOS
Safari. `Path=/v1` matches the API prefix exactly, so the cookie goes out on
every API call and nothing else.

The configuration lives in `[env.production.assets]` in
`apps/api/wrangler.toml`. Three things about it are load-bearing:

- **`run_worker_first` must list every path the Hono app serves.** A path
  missing from that array is not a 404: static assets answer first, and
  `not_found_handling = "single-page-application"` returns `index.html` with a
  **200**, so a forgotten route silently serves HTML to an API client. It
  currently reads `["/health", "/v1/*", "/internal/*", "/admin/*",
  "/codex-provider/*"]` — keep it in sync with `apps/api/src/index.ts`.
- **`assets` is scoped to `[env.production]`, not top-level.**
  `@cloudflare/vitest-pool-workers` loads this file, and a top-level
  `assets.directory` pointing at an unbuilt `apps/web/dist` would break the API
  test suite.
- **`apps/web` must be built before the Worker is uploaded.** Deploy with the
  root script, which sequences it:

```bash
npm run deploy:api     # builds @patternlike/web, then wrangler deploy --env production
```

Requests that match a static asset never invoke the Worker and are free and
unlimited; only `/v1/*`, `/internal/*`, `/admin/*`, `/codex-provider/*`, and
`/health` cost a request. A useful consequence: a `503 configuration_error`
from `configGuard` degrades the API only — the app shell still loads.

Verify:

```bash
BASE=https://patternlike-api-production.lfd.workers.dev
curl -s $BASE/            -o /dev/null -w 'shell  %{http_code}\n'   # 200 = assets serving
curl -s $BASE/v1/chart    -o /dev/null -w 'api    %{http_code}\n'   # 401 = API enforcing auth
curl -s $BASE/health      -o /dev/null -w 'health %{http_code}\n'   # 200 = Worker reached

# A 200 with an HTML content-type on /v1/* means run_worker_first is missing a
# path and static assets answered instead:
curl -sI $BASE/v1/chart | grep -i content-type   # expect application/json
```

`503` on `/v1/*` means `configGuard` is still refusing — an OIDC var or
`ROOT_KEK` is unset.

### What this supersedes

`patternlike-app` on Fly (`fly.web.toml`, `apps/web/Dockerfile`,
`apps/web/nginx.conf`) was the second, staler copy of the PWA with no API behind
it. It was retired on 2026-08-08 by scaling to zero machines and is no longer
publicly serving. The Fly app and name still exist; `fly deploy -c
fly.web.toml` would resurrect the superseded service, while `fly apps destroy
patternlike-app` would release the name. `apps/web/wrangler.jsonc` (the
standalone `patternlike-web` assets Worker) is likewise redundant and was never
deployed.

The calc service on Fly (`fly.toml`, `patternlike-calc`) is **unaffected** and
stays where it is.

## 4. Cloudflare-native alternatives

Investigated 2026-08-08 against the live account
(`a77e479f6736120eadd99973dbeb705e`, "Henry Flare"). Account facts that decide
these: **Workers Paid is active** ($5/mo), workers.dev subdomain is `lfd`, seven
active zones (none named for this product), a Zero Trust org already exists
(`hperkins.cloudflareaccess.com`) on the **free** `teams_free` plan, and
wrangler is 4.116.0 across every workspace.

### Origin: rejected, an nginx proxy on Fly

The first plan kept the Fly web app and replaced its hardcoded 503 with
`proxy_pass` to the Worker. It works, and it was chosen before this
investigation established that Workers Static Assets gives same-origin hosting
with **no custom domain required** — which had been the assumed blocker.

| | Single Worker + assets (adopted) | nginx proxy on Fly |
| --- | --- | --- |
| Extra network hop | none | Fly ord → Cloudflare |
| Platforms to operate | Cloudflare only | Cloudflare + Fly |
| Custom domain needed | no (`*.lfd.workers.dev`) | no |
| Blast radius of a bad API deploy | takes the shell down too | shell unaffected |
| Build coupling | API deploy bundles `apps/web/dist` | independent |
| Cost | $0 extra | 2 Fly machines (scale-to-zero) |

Isolation is the one axis where the proxy wins: with a single Worker, a bad API
deploy also takes down the shell. Everything else favoured consolidation, and
the "cloudflare-first" architecture profile in `spec-bundle/` points the same
way.

Two traps the proxy design carried, recorded in case it is ever revisited:

- Do **not** set `proxy_set_header Host $host`. workers.dev routes by Host, so
  forwarding the browser's host makes Cloudflare fail to find the Worker.
  nginx's default `Host: $proxy_host` is correct, plus `proxy_ssl_server_name on`
  for SNI.
- A literal hostname in `proxy_pass` is resolved by nginx **at startup**.
  Shipping that block before the Worker exists means nginx will not boot, taking
  the whole web app down — strictly worse than the honest 503 it replaced.

### Identity: Cloudflare has no consumer IdP

Cloudflare Access **can** technically satisfy `verifyIdToken`. An Access for
SaaS OIDC application exposes per-client endpoints:

| Endpoint | URL |
| --- | --- |
| Authorization | `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/authorization` |
| Token | `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/token` |
| JWKS (`OIDC_JWKS_URL`) | `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/jwks` |

**It is still the wrong tool.** Access is seat-billed: every end user consumes a
Zero Trust seat and keeps consuming it until explicitly removed. This account is
on the free 50-seat tier. That is a hard ceiling on a consumer product, so
Auth0 (§1) remains the recommendation.

Access *is* worth using for something else: gating a preview/staging origin.
`patternlike-app.fly.dev` is currently public and half-built — the logs show
real iOS Safari traffic hitting a shell that cannot load a chart. An Access
policy in front of a preview hostname costs nothing at this seat count.

### Calc service: Cloudflare Containers is viable but not obviously better

`apps/calc-stub/Dockerfile` already advertises portability to Containers, and
Containers are available on Workers Paid. The ephemeris payload is ~2.1 MB
total, so image size is a non-issue, and the `lite` instance type (1/16 vCPU,
256 MiB, 2 GB disk) matches the `shared-cpu-1x:256MB` the service runs on today.

Two genuine wins:

- Containers are reached through a Durable Object binding, not a public URL.
  That deletes the `CALC_SERVICE_AUTH_TOKEN` shared-secret problem outright —
  including the rotation described above — because there is no public
  `/v1/calculate` to defend.
- Billing is per-10ms-active with sleep-on-idle, against two always-on Fly
  machines today.

The blocker is **cold start**. `fly.toml` grants `/health` a 30-second
`grace_period` for ephemeris initialisation, and Containers sleep on idle. Every
cold request would pay Node boot plus Swiss Ephemeris init. Fly's current
`auto_stop_machines = 'off'` with `min_machines_running = 2` exists precisely to
avoid that. Migrating means either accepting the latency or keeping instances
warm, which erodes the cost win.

Recommendation: leave the calc service on Fly for M1. Revisit if the shared
secret or the two-platform footprint becomes the thing that hurts.

## 5. Identity and consent follow-up

The web app uses the official Auth0 React SDK for sign-in and logout, exchanges
the raw ID token through `POST /v1/sessions`, and treats Worker API 401 responses
as the product-session authority. The 2026-08-22 canary exercised that path.

Local development deliberately keeps the separate `AUTH_STUB=1` path.
`X-User-Id` names an existing user, so after applying local D1 migrations run
`node scripts/dev/seed-dev-user.mjs`; the script creates the user, crypto
subject, and wrapped DEK together.

One M1 consent gap remains separate from authentication: onboarding still sends
the local `cns_local_web_0001` placeholder, and the birth route checks only that
`consent_id` is present. Persisted `account_processing` consent and its
grant/revoke enforcement are not implemented.

## 6. The daily reading publisher

Daily readings are no longer assembled from a signed editorial release. A model
writes them, under an explicit per-account consent, from calculated facts the
model is never allowed to produce itself. The controls over calculation,
consent, minimization, validation, publication, and provenance are unchanged or
stronger; the reviewed-copy control over prose was removed deliberately. See
[`../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md`](../../spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md).

Since 2026-08-27 that model is reached through the **durable Codex runner**, not
a direct OpenAI call. The direct adapter is deleted and `READING_PUBLISHER`
accepts only `codex`, so this Worker holds no OpenAI credential for Daily.
Operate it from [`codex-production-provider.md`](codex-production-provider.md);
[`openai-daily-reading-rollout.md`](openai-daily-reading-rollout.md) is
superseded as a procedure and retained only as dated evidence.

That means three things for this runbook:

- **Repository configuration has advanced beyond this runbook's original
  baseline.** Migration `0003` is applied. Committed production configuration
  now declares `READING_V5_ROLLOUT=hybrid` with `READING_PUBLISHER=codex` and
  both production crons (`*/15 * * * *` and `7,22,37,52 * * * *`).
- **Migration `0017` reached D1 before any compatible Worker can write reading
  provider rows.** It rebuilt `codex_provider_jobs` to admit the
  `reading`/`publisher` coordinate and was verified applied around 17:32 UTC on
  2026-08-27. The schema is necessary but not Daily certification: the Codex
  runner was stopped before the export and remains stopped pending a compatible
  Worker deployment.
- **Configuration is not certification.** The evidence table in
  [`openai-daily-reading-rollout.md`](openai-daily-reading-rollout.md) does not
  record a complete ordered rollout, and the `hybrid` declaration above is a
  source statement rather than an observation of the deployed Worker. Re-query
  the deployed Worker, secrets, usage, cron bindings, and D1 state before any
  further change rather than replaying either runbook from its historical
  assumptions.
- **`release_not_active` applies only to the retained editorial paths.** M5
  constrained-model daily readings do not use a content release. The legacy M3
  daily-reading path and M4 editorial Pattern still require one.

The content-release tables, R2 objects, ingestion routes, and historical audit
records remain for legacy editorial serving. They cannot influence a new M5
command or reading. Removing them is a later migration with its own retention
and rollback review.
