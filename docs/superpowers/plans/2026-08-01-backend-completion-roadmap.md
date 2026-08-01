# Backend Completion Roadmap

> **Scope note:** This is a prioritized roadmap across several independent
> subsystems, not a single implementation plan. Per `superpowers:writing-plans`,
> each work stream below should get its own task-level plan
> (`docs/superpowers/plans/YYYY-MM-DD-<stream>.md`) when it is picked up.
> Stream 1 additionally needs a brainstorming pass, because it carries an
> undecided architectural choice.

**Goal:** Take the API from "works only under `AUTH_STUB=1` on localhost" to a
deployable M1 backend that a real user can authenticate against, consent to,
and delete themselves from.

**State as of 2026-08-01:** The birth → chart path is real and tested (87 API
tests inside workerd against local D1). The schema, M0 contracts, envelope
encryption, and key-rotation primitives are all in place. What is missing is
the application code that uses them, plus one undecided architectural choice.

**Tech stack:** Cloudflare Workers (Hono), D1, R2 (not yet bound), Swiss
Ephemeris calc service over HTTP, Vitest + `@cloudflare/vitest-pool-workers`.

---

## The constraint that sets the order

`users.id` is baked into two irreversible places:

- **Key wrapping** — `wrapDek(dek, root, userId, keyVersion)` in
  `apps/api/src/db/users.ts:120`
- **AEAD additional data** — every `encryptPayload` call passes
  `{ userId, field, recordId }` as the encryption context
  (`apps/api/src/routes/birth.ts:206-215`, `:360-370`)

Changing how a user id is derived **after** real data exists means every stored
DEK fails to unwrap and every ciphertext fails to authenticate. There is no
migration short of re-encrypting everything under the old identity, which
requires still having the old ids.

**Therefore: identity lands before the first real user, or not cheaply at all.**
Everything else in this roadmap can move independently.

---

## Stream 0 — Decisions to make before writing code

These are not implementation tasks. They block Streams 1 and 4.

| # | Decision | Why it blocks | Notes |
|---|---|---|---|
| 0.1 | **Identity provider** | Determines the token format, the verification code, and whether Stream 2 needs CORS at all | Options: hosted IdP (Clerk / WorkOS / Auth0 / Stytch) verified by JWKS in the Worker; or passkeys + D1-backed sessions. `identities(provider, provider_subject)` already models either. |
| 0.2 | **Internal user id derivation** | Irreversible, per the constraint above | Recommendation: mint an opaque `usr_*` id at identity-link time and never derive it from the IdP subject, so the IdP can be swapped without touching ciphertext. |
| 0.3 | **Same-origin or CORS** | Cookie sessions want same-origin; bearer tokens tolerate CORS | Same-origin (one Worker serving `apps/web` assets and routing `/v1` to the API) removes the CORS surface entirely and matches the existing Vite proxy shape. |
| 0.4 | **Consent revocation semantics** | Stream 4 cannot be specified without it | If `account_processing` consent is revoked, does the existing chart get suppressed, deleted, or retained-but-unserved? This is a product and legal call, not an engineering one. |
| 0.5 | **Export artifact format** | Stream 5 | What a user receives: the chart snapshot JSON plus decrypted birth details, presumably; whether it is signed; how long the R2 object lives (`export_requests.expires_at` exists). |

---

## Stream 1 — Identity (blocks deployment)

**Why first:** `authStub` returns 501 for any Bearer token
(`middleware/auth.ts:50-60`), and `configGuard` refuses every request if
`AUTH_STUB=1` outside development (`middleware/config-guard.ts:29`). Outside
`ENVIRONMENT=development` there is currently no way to authenticate at all. And
per the constraint above, this cannot be deferred past first real data.

**Files:**
- Modify: `apps/api/src/middleware/auth.ts` — replace the 501 branch
- Create: `apps/api/src/services/identity.ts` — token verification + JWKS cache
- Create: `apps/api/src/db/identities.ts` — `linkIdentity`, `resolveUserId`
- Modify: `apps/api/src/env.ts` — issuer, audience, JWKS URL
- Modify: `apps/api/wrangler.toml` — production vars
- Test: `apps/api/src/middleware/auth.test.ts` (new)

**Tasks:**

1. **Define the verification seam.** `authStub` becomes `authenticate`, keeping
   the `AUTH_STUB=1` development branch verbatim and replacing the 501 with a
   call into `identity.ts`. The seam is the whole point — it lets 0.1 be
   answered late without rewriting routes.
2. **Verify the token.** Signature against cached JWKS, `iss`, `aud`, `exp`,
   `nbf`. Cache the key set in module scope with a TTL; a Worker isolate will
   reuse it. Reject with the existing error envelope, never with the underlying
   library message.
3. **Map subject → user.** `identities` already has
   `UNIQUE (provider, provider_subject)`. On first sight, mint an opaque
   `usr_*` id, insert `users` and `identities` in one D1 batch, and return it.
   On subsequent requests, look it up and update `last_login_at`.
4. **Move user creation off the write path.** `ensureUser`
   (`db/users.ts:16-31`) currently inserts a user implicitly on the first
   birth-profile POST. Once identities exist, creation belongs at link time and
   `ensureUser` should assert rather than insert.
5. **Delete the `X-User-Id` path from production reachability.** Keep it for
   local development and the integration harness; `configGuard` already
   enforces this, so this is a test that the guard actually fires.

**Done when:** an integration test authenticates with a signed token against a
fixture JWKS, gets a stable `usr_*` id across two requests, and a request with
no token or a token from the wrong issuer gets a 401 with the standard envelope.

**Unblocks:** deployment of anything; Streams 4, 5, 6.

---

## Stream 2 — Reachability from the browser (blocks deployment)

**Why now:** there is no `Access-Control-*` handling anywhere in
`apps/api/src`. The web client works today only because Vite proxies `/v1`
same-origin.

**If 0.3 chooses same-origin:** the work is a router in front of both
Workers — `apps/web`'s asset Worker gains a `main` and forwards `/v1/*` to the
API via a service binding. No CORS code at all. This is the smaller change and
keeps cookies viable.

**If 0.3 chooses CORS:** add a middleware with an explicit origin allowlist
(never `*` alongside credentials), handle `OPTIONS` preflight, and allowlist
`content-type`, `authorization`, `idempotency-key`, `x-request-id`.

**Files:** `apps/api/src/index.ts`, plus either `apps/web/wrangler.jsonc` +
a new `apps/web/src/worker.ts`, or `apps/api/src/middleware/cors.ts`.

**Done when:** the built web bundle reaches the API from a browser with no
dev-server proxy in the path.

---

## Stream 3 — Harden the calc call (independent, ~half a day)

**Why now:** no decisions block it, and both items are live risks.

**Files:** `apps/api/src/services/calc-client.ts`, `apps/calc-stub/src/server.ts`,
`apps/api/src/env.ts`, `apps/api/wrangler.toml`.

**Tasks:**

1. **Authenticate the calc service.** `apps/calc-stub/src/server.ts` has no
   token check and `invokeCalc` sends only `content-type`
   (`calc-client.ts:23-27`). Anything that can reach `CALC_SERVICE_URL` can run
   calculations. Reuse the existing `SERVICE_AUTH_TOKEN` shape and the
   `serviceAuth` semantics already written for `/internal/*` — accept absent
   config only in development, 503 otherwise.
2. **Bound the request.** Add an `AbortSignal.timeout()` to the calc fetch and
   map the abort to the existing `calc_transport_error` class. A hung calc
   service currently holds the request until the Worker's own limit.
3. **Provision the real database id.** `wrangler.toml:10` and `:44` both carry
   the placeholder `00000000-0000-0000-0000-000000000001`.
4. **Refresh `compatibility_date`.** Currently `2025-05-01`, over a year stale.

**Done when:** calc rejects an unauthenticated request; an unresponsive calc
service produces a `502 calc_failed` within the timeout rather than hanging.

---

## Stream 4 — Consent enforcement (completes an M1 privacy claim)

**Why now:** `consent_id` is checked for presence only (`routes/birth.ts:56`)
and then stored inside the encrypted blob (`:200`). The `consents` table is
never read or written, and no endpoint mints a consent, so the id the web
client sends is a hardcoded literal. The M0 contracts define `consentRecord`
and `consentValiditySnapshot` and CI validates them — nothing produces them.

**Depends on:** Stream 1 (a consent belongs to an authenticated user), 0.4.

**Files:**
- Create: `apps/api/src/routes/consents.ts`, `apps/api/src/db/consents.ts`
- Modify: `apps/api/src/routes/birth.ts:48-109` (validation), `:195-201` (payload)
- Test: `apps/api/src/routes/consents.integration.test.ts`

**Tasks:**

1. **Mint consent records.** `POST /v1/consents` writing `kind`,
   `status='granted'`, `policy_version`, `granted_at`. All three columns are
   `NOT NULL` in the schema; `policy_version` in particular has no default, so
   the caller or the server must supply a real policy version string.
2. **Enforce at the birth route.** Replace the presence check with a lookup:
   the consent must exist, belong to the caller, be `status='granted'`, be of
   kind `account_processing`, and not be past `expires_at`. Return
   `403 consent_invalid` — a new code, distinct from `invalid_body`.
3. **Record which consent authorized the profile — needs a migration.**
   Neither `birth_profiles` (`0001_m0_core.sql:122-146`) nor `chart_snapshots`
   (`:148-179`) has a `consent_id` column; the id currently survives only
   inside the encrypted `payload_enc` blob, so "which consent authorized this
   chart" cannot be answered without decrypting the user's data. Add
   `db/d1/0002_consent_link.sql` introducing
   `birth_profiles.consent_id TEXT REFERENCES consents(id)` and populate it on
   insert (`routes/birth.ts:224-241`). Only `context_signals` carries a
   `consent_id` FK today (`:256`), which is an M4 surface.
4. **Revocation.** `PATCH /v1/consents/:id` setting `revoked_at` and status,
   then whatever 0.4 decided about existing charts.
5. **Update the web client.** `onboardingConsentId()` in
   `apps/web/src/lib/api-client.ts:111-113` returns a literal; it becomes a
   real call, and the onboarding checkbox becomes the thing that mints the
   record.

**Done when:** a birth profile referencing an unknown, revoked, or another
user's consent is rejected, and the granted path stamps `chart_snapshots.consent_id`.

---

## Stream 5 — Export and deletion (completes M1)

**Why now:** the last two `[ ]` items in the README's M1 status, and the UI
already ships disabled controls that say "M1 pending" — which stays honest only
so long.

**Depends on:** Stream 1. Independent of Stream 4.

**Files:**
- Modify: `apps/api/src/routes/stubs.ts:47-52` (remove the two 501s)
- Create: `apps/api/src/routes/privacy.ts`, `apps/api/src/db/privacy.ts`
- Modify: `apps/api/wrangler.toml:13-16` (uncomment the R2 binding)
- Test: `apps/api/src/routes/privacy.integration.test.ts`

**Tasks:**

1. **Provision R2.** `Env.ARTIFACTS?: R2Bucket` is already declared
   (`env.ts:9`); the binding is commented out in `wrangler.toml`.
2. **`POST /v1/exports`.** Require `Idempotency-Key` the way the birth route
   does — `export_requests` has `UNIQUE (user_id, idempotency_key)` and the
   per-user scoping is already proven by the schema smoke test. Assemble what
   0.5 specified, write to R2, set `r2_uri` and `expires_at`, status `ready`.
3. **`GET /v1/exports/:id`.** Status plus a short-lived download. Not currently
   in the OpenAPI paths — add it to the contract first.
4. **`DELETE /v1/account`.** Write `deletion_requests`, then crypto-shred. The
   primitive already exists and is defensive: `ensureUserKey` refuses to mint a
   fresh DEK once one has been destroyed (`db/users.ts:110-117`), so a shredded
   account cannot silently resurrect. Set `dek_destroyed=1` and
   `status='completed'` in the same batch that destroys the key.
5. **Re-enable the UI controls.** `apps/web/src/components/PrivacyView.tsx:95-102`.

**Done when:** an export round-trips to R2 and back; a deletion destroys the
DEK, and a subsequent `GET /v1/chart` for that user fails closed rather than
returning plaintext or minting a new key.

---

## Stream 6 — Audit trail (cross-cutting, do alongside 4 and 5)

**Why here:** `audit_events` has no writer. The events worth auditing are
exactly the ones Streams 1, 4, and 5 introduce — login, consent grant/revoke,
export, deletion. Writing the helper now and calling it from those streams as
they land is cheaper than retrofitting.

**Files:** Create `apps/api/src/db/audit.ts`; call from `auth.ts`,
`consents.ts`, `privacy.ts`.

**Note the schema's own constraint:** `detail_class` is commented "Never store
private payloads; opaque classes only." The helper's signature should make that
hard to violate — take a `detail_class` enum, not a free-form string.

---

## Stream 7 — Birthplace resolution (product quality, independent)

**Why lower:** the UI is honest about this today ("Historical timezone lookup
is not connected yet. Confirm this value before continuing"), and asking for
coordinates works. But it is the difference between a chart the user typed and
a chart the product computed.

**The gap is narrower than the README states.** luxon resolves the correct
historical offset for a *given* IANA zone, so the DST math is already right.
What is missing is deciding *which* zone: `timezone_hint` is passed through as
authoritative (`routes/birth.ts:235, 270`), and the web client defaults it to
the browser's *current* zone — which is wrong for anyone who has moved.

**Tasks:** a place search returning `{label, lat, lon, tzid}`; server-side
resolution of `place_label` → coordinates → IANA zone at the historical date;
stop trusting `timezone_hint` when coordinates are present; surface the
resolved zone back to the user for confirmation. `birth_profiles` already has
a `geocode_confidence` column (`0001_m0_core.sql:134`) that `routes/birth.ts`
binds `NULL` — a resolver should populate it so a low-confidence match can be
qualified in the uncertainty report rather than silently trusted.

**Done when:** a user picks "Los Angeles" and gets `America/Los_Angeles` and
correct coordinates without typing a decimal.

---

## Stream 8 — Make the workflow actually asynchronous (defer)

`POST /v1/birth-profiles` returns 202 with a job id, but `invokeCalc` runs
inline (`routes/birth.ts:263`) and the job row is written already-succeeded.
The `jobs` table models queueing, attempts, retries, and `available_at` that
nothing exercises, and the web client polls `GET /v1/chart` up to five times
because of the 202 shape.

**Defer until** calc latency or Worker CPU limits actually force it. When it
does: Cloudflare Queues or Workflows, with the job row becoming the real
state machine. Doing it now adds moving parts to a path that currently works.

---

## Stream 9 — Operational hardening (small, do when convenient)

1. **Key rotation has no caller.** `rotateUserDek` and `rewrapUserKey`
   (`db/users.ts:162, 261`) are implemented and well tested, but the only
   references outside their definitions are in `key-rotation.test.ts`.
   Rotating `ROOT_KEK` in production has no runnable path. Needs either a
   scheduled Worker or a `wrangler`-invoked admin route behind `serviceAuth`.
   Note `rewrapUserKey` must run for every user in one pass — there is no
   per-row record of which secret wrapped which key.
2. **Rate limiting.** Nothing throttles `POST /v1/birth-profiles`, which is the
   route that costs a calc invocation.

---

## Explicitly out of scope

The eleven M2–M4 routes in `apps/api/src/routes/stubs.ts` return honest 501s
and should stay that way: daily readings and evidence, feedback, pattern,
timing, time travel, check-ins, context sources, and internal content-release
ingestion. The web client already gates those surfaces behind milestone
screens rather than faking them.

---

## Suggested order

```
0.1–0.3  decide  ──┬──► 1. Identity ──┬──► 4. Consent ──┐
                   │                  ├──► 5. Export/Delete ──┼──► M1 complete
                   └──► 2. Reachability                       │
                                       └──► 6. Audit ─────────┘

3. Calc hardening    ── independent, start any time
7. Birthplace        ── independent, product quality
8. Async workflow    ── deferred
9. Ops hardening     ── independent, small
```

Streams 3, 7, and 9 need no decisions and can run in parallel with the
identity work by anyone not blocked on it.
