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

### What landed

1. **Calc authentication — deployed.** `POST /v1/calculate` requires a bearer
   token outside development, answering `503 service_auth_not_configured`
   without configuration and `401` on a bad token, while `/health` and
   `/v1/engine` stay public. `docs/deploy/api-production.md` records the token as
   set on both sides in its 2026-08-26 reconciliation — a ledger row, not a
   queried inventory.
2. **Bounding the request — deployed as Worker version
   `287bce63-dece-4911-96db-dd212c2cec33`.**
   `invokeCalc` now takes an explicit `timeoutMs`, sets
   `signal: AbortSignal.timeout(timeoutMs)`, refuses a declared or streamed body
   over 1 MiB before parsing, and returns a `CalcInvocation` carrying
   `latencyMs` and `timedOut`. `timedOut` is read from the signal's own state
   rather than matched against exception text, so a dropped connection is not
   miscounted as a deadline. The deadline is
   `CALC_FETCH_TIMEOUT_MS` (`"10000"` in both Wrangler var blocks, accepted
   range 1,000–30,000, required outside development and fail-closed through
   `configGuard`). A timeout still returns the generic `502 calc_failed` — no
   upstream message, path, or URL reaches the caller.
3. **Production database id — done.** `[[env.production.d1_databases]]` carries
   the real `patternlike-ops` id. The top-level placeholder is the development
   block and is intentionally left alone.

Timeout behaviour is covered by `apps/api/src/services/calc-client.test.ts` and
by the `TRIGGER_CALC_TIMEOUT` sentinel in
`apps/api/src/routes/birth.integration.test.ts`. Detailed plan:
[`2026-08-26-birth-operational-guards.md`](2026-08-26-birth-operational-guards.md)
Task 1.

### What is still open

- **`compatibility_date` is still `2025-05-01`** in `apps/api/wrangler.toml`.
  Item 4 of this stream has not been done.

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

**Status: the timezone half is done; the provider decision is approved; place
search and selected-place resolution are not implemented.**

The approved decision is the composite Google Places Autocomplete (New) plus
Geocoding API v4 adapter in
[`2026-08-26-geocoder-provider.md`](../../decisions/2026-08-26-geocoder-provider.md).
Its durable provider id is `google_places_geocoding_v4`. The repository owner
explicitly supplied product/privacy/legal approval in this Cursor
implementation session on 2026-08-26; implementation remains pending.

The ADR evaluates both billing-account regimes. Non-EEA Geocoding §6.3.2 and
EEA Geocoding §6.2.2 both permit the selected, logically isolated
account-lifetime cache; pure Places coordinates fail under the non-EEA §14.3
and EEA §15.4 30-day limits. EEA permitted use (1) expressly permits address
lookup and autocompletion. The operator must record the production billing
account's `EEA`/`non-EEA` region before provisioning, but the decision passes
under either result.

**Why lower:** the UI is honest about this today ("Historical timezone lookup
is not connected yet. Confirm this value before continuing"), and asking for
coordinates works. But it is the difference between a chart the user typed and
a chart the product computed.

**The gap is narrower than the README states.** luxon resolves the correct
historical offset for a *given* IANA zone, so the DST math is already right.
What is missing is deciding *which* zone: `timezone_hint` is passed through as
authoritative (`routes/birth.ts:235, 270`), and the web client defaults it to
the browser's *current* zone — which is wrong for anyone who has moved.

**Tasks:** implement the approved app-owned search/resolve routes and composite
adapter; transiently search Places, resolve only the selected Google Place ID
through Geocoding API v4, encrypt the narrowed selected result per user, then
feed its coordinates into the existing server-side IANA-zone and historical
offset resolution. Surface the selected place, resolved zone, and confidence
for confirmation. `birth_profiles` already has a `geocode_confidence` column
(`0001_m0_core.sql:134`) that `routes/birth.ts` binds `NULL` — the resolver
should populate it so a low-confidence match can be qualified in the
uncertainty report rather than silently trusted.

Reuse registry source `AST-02` for the versioned `product_source` consent; do
not create a context-source permission or signal because geocoding writes
directly to the encrypted birth normalization path. Land code and public legal
surfaces with `GEOCODER_ROLLOUT = "off"` in development and production.
Production enablement is a separate config commit only after the secret/API
restrictions, billing region, 120/min Autocomplete and 30/min Geocoding quotas,
USD 50 budget with 50/75/90/100% alerts, tests, attribution, exact disclosure,
and internal canary are verified.

**Done when:** a user picks "Los Angeles" and gets `America/Los_Angeles` and
correct coordinates without typing a decimal.

### What landed

Coordinates → IANA zone → historical offset, all server-side:

- `apps/api/src/services/timezone.ts` resolves coordinates against a bundled
  boundary raster (`tz-lookup`, CC0), and probes ~11 km around the point so a
  birthplace near a border is graded rather than silently trusted.
- `packages/shared/src/timezone.ts` maps a civil wall time onto the timeline in
  that zone through the runtime's own tzdb, including the two cases a naive
  conversion gets wrong: a local time a daylight change repeated, and one it
  skipped. `apps/calc-stub/src/timezone-agreement.test.ts` pins it to the luxon
  the calculation service actually uses, so the preview and the chart cannot
  drift apart.
- `POST /v1/timezone-lookup` exposes the same resolution to the onboarding
  form, which now shows the resolved zone and its offset instead of asking the
  user to vouch for the browser's guess.
- `routes/birth.ts` uses the coordinate result over `timezone_hint` and writes
  the grade to `geocode_confidence`. An invalid hint is a 400 rather than a
  calculation failure.

### What is still open

- **Place-search implementation.** `place_label` is still free text and the
  user still types the decimals. The provider choice is no longer open, but no
  adapter, encrypted selected-place cache, routes, consent gate, or
  autocomplete UI has landed. Before the first Google query, public Terms must
  flow down the Google Maps end-user terms, public Privacy must disclose
  Google's independent-controller collection/use and cross-border processing,
  and the UI must show that disclosure and obtain express, prior, revocable
  consent. Declining or revoking must leave manual entry complete. The exact
  requirement and attribution rules are frozen in the linked ADR; the existing
  generic account-processing consent is not a substitute. Unknown or old
  geocoder policies and any rollout state other than the closed `enabled`
  value fail closed with no Google request.
- **The uncertainty report.** Qualifiers reach the client on the lookup and the
  202, and the grade reaches D1, but nothing folds a `low` geocode into
  `uncertainty.qualified_features` yet. The calculation service builds that
  report and does not currently receive the grade.
- **Dataset vintage.** The boundary raster is timezone-boundary-builder 2019b.
  Zones split after 2019 (`America/Ciudad_Juarez`, for one) resolve to their
  pre-split neighbour, which is right until the rules diverge.

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

**Still deferred.** "Actually force it" is now a measured condition rather than
a judgement call. The entry criteria, the telemetry they are computed from, and
the query procedure are recorded in
[`docs/deploy/birth-calc-slo.md`](../../deploy/birth-calc-slo.md):

| Signal | Window | Trigger |
| --- | --- | --- |
| Successful calc p95 latency | rolling 7 days | `>= 8,000 ms` for 3 consecutive UTC days |
| Calc timeout rate | rolling 24 hours, at least 100 attempts | `>= 1%` |
| Successful calc p99 latency | rolling 7 days | `>= 9,000 ms` |
| Worker termination correlated with the birth route | any | one confirmed production event |

Crossing any row opens the design; none has been measured. The telemetry is
deployed as of Worker version `287bce63-dece-4911-96db-dd212c2cec33`; the
review ledger in `docs/deploy/birth-calc-slo.md` is still empty. A high `429` rate is
explicitly **not** a trigger — it is a product and abuse question about
`BIRTH_CALC_DAILY_LIMIT`, and a queue would not reduce the spend that limit
exists to bound.

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

### What landed

**Item 2 — deployed telemetry with an empty review ledger.** `POST /v1/birth-profiles`
now authorizes at most `BIRTH_CALC_DAILY_LIMIT` (`"5"`, accepted range 1–50)
actual `/v1/calculate` invocations per user per UTC day. The sixth returns
`429 birth_calc_budget_exhausted` with `Retry-After` in seconds and
`details.resets_at` at the next UTC midnight, writes no birth profile and no
job row, and never reaches calc. The `429` is recorded in the additive M8
OpenAPI document with valid and invalid fixtures.

The ceiling is exact rather than approximate, which is what the reservation
ledger in `0016` buys:

- Requests that perform no calculation are free — validation failures,
  idempotency conflicts, and replays of a `succeeded`, `queued`, or `running`
  job.
- Concurrent copies of one attempt coordinate consume **one** unit; the loser
  writes no birth profile and no job row, calls nothing, and returns the
  existing job state. It does still advance the profile-version counter, which
  is allocated before the budget decision — see the operator notes in the SLO
  document.
- A failed-job retry must match the original encrypted birth command
  field-by-field and consumes one new unit.
- A charged timeout, transport failure, invalid calc result, or duplicate
  fingerprint is **not** refunded. The bound is on calculation spend, not on
  success.

Budgets are per user and independent. All three tables are deleted with the
account and classified non-portable in `services/deletion-manifest.ts`.
Retention is a 35-UTC-day window inclusive of today, held in TypeScript rather
than in the migration, and the prune rides the same batch that writes a new
reservation — so it is **lazy and per user**: an account that stops submitting
birth profiles is never pruned, because no cron or queue consumer touches these
tables.

Detailed plan:
[`2026-08-26-birth-operational-guards.md`](2026-08-26-birth-operational-guards.md)
Tasks 2 and 3.

> **`db/d1/0016_birth_calc_usage.sql` is applied remotely** (2026-08-27 ~06:35 UTC).
> Workers Builds had already deployed the PR #35 Worker about a minute after
> merge, ahead of the schema; `npm run deploy:api` then uploaded version
> `287bce63-dece-4911-96db-dd212c2cec33` once 0016 was applied.

**Item 1 (key rotation has no caller) is still open** and is the subject of a
separate plan,
[`2026-08-26-crypto-operator-control-plane.md`](2026-08-26-crypto-operator-control-plane.md).
That plan leaves key rotation open. It does not own migration `0017`: that
number is the applied Codex reading-provider migration. Its
`0017_crypto_operations.sql` references are stale and must be renumbered with
downstream reservations before execution.

---

## Explicitly out of scope

The eleven M2–M4 routes in `apps/api/src/routes/stubs.ts` return honest 501s
and should stay that way: daily readings and evidence, feedback, pattern,
timing, time travel, check-ins, and context sources. The web client already
gates those surfaces behind milestone screens rather than faking them.

**Superseded 2026-08-08:** the separate internal stub for
`POST /internal/content-releases` is no longer a stub — it verifies, stores,
and activates signed editorial bundles (`apps/api/src/routes/content-releases.ts`).
It was deferrable for M1 because no M1 surface reads editorial content; it
stopped being deferrable because M3 reading assembly cannot start without an
active release to draw approved fragments from.

---

## Suggested order

```
0.1–0.3  decide  ──┬──► 1. Identity ──┬──► 4. Consent ──┐
                   │                  ├──► 5. Export/Delete ──┼──► M1 complete
                   └──► 2. Reachability                       │
                                       └──► 6. Audit ─────────┘

3. Calc hardening    ── landed except compatibility_date
7. Birthplace        ── zone resolution landed; place search open
8. Async workflow    ── deferred behind measured entry criteria
9. Ops hardening     ── rate limiting landed; key rotation open
```

Streams 3, 8, and 9 each carry a **What landed** section above; read it before
treating an item as outstanding. Stream 8's deferral is now conditional on the
thresholds in [`docs/deploy/birth-calc-slo.md`](../../deploy/birth-calc-slo.md).

Streams 3, 7, and 9 needed no decisions and could run in parallel with the
identity work. Their remaining open items — `compatibility_date`, place search,
and key rotation — still can.
