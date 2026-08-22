# Frontend Completion Roadmap

> **Scope note:** This is a prioritized roadmap across independent work streams,
> not a single implementation plan. Per `superpowers:writing-plans`, each stream
> should get its own task-level plan (`docs/superpowers/plans/YYYY-MM-DD-<stream>.md`)
> when picked up. It is the web-side counterpart of
> [`2026-08-01-backend-completion-roadmap.md`](2026-08-01-backend-completion-roadmap.md)
> and assumes the identity work recorded in
> [`2026-08-01-identity-and-sessions.md`](../archive/plans/2026-08-01-identity-and-sessions.md)
> (executed, `38e13c9..e758f48`).

**Goal:** Take `apps/web` from "renders only under `AUTH_STUB=1` behind the Vite
proxy" to a deployable M1 client that a real user can sign in to, consent
through, export from, and delete themselves with.

**State as of 2026-08-01:** The M1 shell is built and tested — onboarding
(3-step form with accuracy/consent gating), chart view with wheel and
uncertainty, privacy status page, PWA manifest + service worker, 12 vitest
tests, axe-core in devDependencies. What is missing is every client half of the
account lifecycle: there is **zero auth code in `apps/web`** (no sign-in, no
sign-out, no 401 handling), the consent id is a hardcoded literal, the
export/delete buttons ship disabled, and birthplace entry is raw decimals plus
a browser-guessed timezone.

**Tech stack:** React 19 + Vite 8, vitest + testing-library (jsdom), deployed as
a Cloudflare assets-only Worker (`apps/web/wrangler.jsonc` — no `main` yet).
Hash-based routing (`App.tsx:22-27`). API calls are relative paths with
`credentials: "include"` already set (`src/lib/api-client.ts:44, :63`).

---

## The two facts that set the order

1. **Local development is broken right now.** The client sends
   `x-user-id: usr_local_dev_0001` (`api-client.ts:50-53`), but after the
   identity work that header *names* a user instead of creating one
   (`README.md:139-143`), no such user exists, and a SQL-only seed cannot
   produce a valid wrapped DEK. Every `npm run web:dev` API call 401s. Nothing
   else on this list can be built or manually verified until F1 lands.

2. **The backend session API is live with no client.** `POST /v1/sessions`
   (OIDC id_token → httpOnly `pl_session` cookie, `Path=/v1`,
   `SameSite=Strict`) and `DELETE /v1/sessions/current` exist and are tested
   (`apps/api/src/routes/sessions.ts`). The auth streams below consume what is
   already served; streams F5–F7 are blocked on backend Streams 4, 5, and 7
   respectively and can only be prepared, not finished.

Nothing here is irreversible (unlike the backend's crypto-subject constraint),
so the order is purely: unblock the dev loop, then build what the backend
already serves, then the streams that land alongside their backend halves.

---

## Stream F0 — Decisions to make before writing code

| # | Decision | Why it blocks | Notes |
|---|---|---|---|
| F0.1 | **Which hosted OIDC provider** | F3 cannot be built without a real issuer; the sign-in UI shape (vendor widget vs. redirect/PKCE) follows from it | Spec decision 0.1 chose "hosted OIDC provider" but named no vendor. The backend is deliberately vendor-neutral — it verifies `iss`/`aud`/JWKS and nothing else — so this is swappable later, but the client code that *acquires* the id_token is vendor-shaped. Options: a vendor SPA SDK (Clerk/Auth0/WorkOS/Stytch), a neutral OIDC code+PKCE client (`oidc-client-ts`, one dependency), or Google Identity Services alone (script tag, no npm dependency, Google-only sign-in at M1). |
| F0.2 | **The signed-out experience** | F2 renders *something* when there is no session | Minimal honest option: the existing wordmark + one sign-in action + the privacy framing already written for onboarding. A marketing landing page is explicitly not M1. |

Neither blocks F1.

---

## Stream F1 — Restore the local dev loop (do first, small)

**Why first:** fact 1 above. Every later stream needs a browser that can reach
an authenticated API locally.

**Recommended shape: a dev-only session mint, not a seed script.** Add
`POST /v1/dev/sessions` to the API, registered next to `sessionRoutes`
(`apps/api/src/index.ts:24`), that refuses with 404 unless
`isDevEnvironment(ENVIRONMENT) && AUTH_STUB === "1"`, then calls the *real*
`linkIdentity(env, "dev", subject)` (which already mints user + identity +
wrapped DEK in one batch and is race-safe) followed by the real
`createSession` + `setCookie`. The web client then authenticates with the same
cookie code path in development and production, and the `x-user-id` header
branch in `requestHeaders()` (`api-client.ts:46-56`) is **deleted** rather than
maintained. The `X-User-Id` stub stays for API integration tests only.

Alternative if touching the API is unwanted: a seed script driving
`linkIdentity` against local D1 via miniflare, keeping the header. More moving
parts, and the client keeps two auth paths — not recommended.

**Files:**
- Create: `apps/api/src/routes/dev-sessions.ts` (+ registration in `index.ts`)
- Modify: `apps/web/src/lib/api-client.ts` — remove the dev-header logic
- Modify: `README.md:44-51` — replace the `VITE_DEV_USER_ID` scaffolding note
- Test: dev route 404s when `ENVIRONMENT=production` is passed as a binding
  override (same technique as `middleware/auth.test.ts`)

**Cautions:**
- The session cookie is set with `Secure` (`sessions.ts:82-88`). Chromium and
  Firefox accept Secure cookies on `http://127.0.0.1`; Safari does not. Either
  drop `Secure` inside this dev-only route or document that local Safari needs
  the Vite https option.
- The cookie must be minted *through the Vite proxy* (`vite.config.ts:13-18`)
  so it lands on the app origin. A sign-in helper in the web UI (dev-only
  button on the signed-out screen, F2) beats telling people to curl.

**Done when:** `npm run dev:api` + `npm run web:dev` + one click yields a chart
onboarding that completes, with no `x-user-id` header anywhere in
`apps/web/src`.

---

## Stream F2 — Session state in the client (backend-ready today)

**Why now:** the app currently collapses "not signed in" into "API unavailable":
`load()` treats any non-404 error as `offline` (`App.tsx:37-53`), so a signed-out
production user would see "The calculation record is out of reach.
Authentication required." — a connectivity message for an auth condition.

**Tasks:**

1. **Add a `signedOut` state to the chart-state machine.** `ApiError` with
   status 401 → `signedOut`, distinct from `offline` and `missing`. The
   existing boot-time `GET /v1/chart` is the session probe — no new "who am I"
   endpoint is needed (401 = signed out, 404 = signed in without a chart).
2. **A `SignIn` view** (per F0.2) rendered for every hash view while signed
   out. In development it carries the F1 dev sign-in button; the production
   action is wired in F3.
3. **Sign-out.** `deleteSession()` in `api-client.ts` calling
   `DELETE /v1/sessions/current` (204, idempotent), a control in the sidebar
   foot (`AppShell.tsx:72-75`) and mobile header, then reset to `signedOut`.
4. **Mid-session expiry.** Sessions expire absolutely at 30 days and revocation
   is server-side; any request can 401. Centralize in `request()`
   (`api-client.ts:58-85`): on 401, surface a typed signal the app maps to
   `signedOut` instead of a thrown-to-red error page.
5. **Shell status.** `StatusMark` (`AppShell.tsx:20-34`) gains a `signedOut`
   variant ("Signed out") so the M1 CONTROL SURFACE framing stays honest.
6. **Tests.** `App.test.tsx` state matrix: 401 → sign-in screen; sign-out
   returns there; 404 after sign-in → onboarding. Run axe on the new view.

**Done when:** with no session, every view shows the sign-in screen; after F1's
dev sign-in, onboarding proceeds; sign-out from the shell returns to the
sign-in screen without a reload.

---

## Stream F3 — Real OIDC sign-in (needs F0.1)

The client half of the session exchange: acquire an id_token from the chosen
IdP (redirect or widget per F0.1), then `createSession(idToken)` posting
`{ id_token }` to `/v1/sessions` (201 `{ token, expires_at }`; the browser
keeps the cookie and **discards the body token** — that field exists for native
clients).

**Tasks:** IdP integration on the F2 sign-in view; exchange + error envelope
handling (one flat 401 for expired/wrong-issuer/garbage — display "sign-in
failed", never the reason); a redirect-return route if F0.1 chooses
code+PKCE (hash routing may need one real path, e.g. `/auth/callback`, added to
the SPA fallback); loading state between IdP return and session mint.

**Configuration:** the IdP's issuer/audience/JWKS go in `apps/api/wrangler.toml`
`[vars]` (replacing the guarded `issuer.invalid` placeholders); the client needs
at most a public client id — document as a `VITE_` var if the F0.1 choice
requires one.

**Done when:** on a deployed preview (needs F4), a fresh browser signs in with
the real IdP, receives the cookie, completes onboarding, signs out, and a token
from the wrong issuer produces the flat failure message.

---

## Stream F4 — Same-origin production router (deploy-blocking, independent)

Backend roadmap Stream 2, decided as same-origin by spec 0.3, executed on the
web side: `apps/web`'s Worker is currently assets-only (`wrangler.jsonc:5-8`),
so the built bundle has no path to the API — production works only behind the
dev proxy today.

**Tasks:**

1. `apps/web/src/worker.ts`: forward `/v1/*` to the API over a service binding
   (preserving method, headers, body — cookies ride along same-origin);
   everything else to the `ASSETS` binding.
2. `wrangler.jsonc`: add `main`, `assets.binding: "ASSETS"`,
   `run_worker_first: ["/v1/*"]`, and a `services` binding to `patternlike-api`.
   **Caution:** the SPA `not_found_handling` must keep serving `index.html` for
   app routes while never swallowing `/v1` — that is what `run_worker_first`
   pins down.
3. No client change: `apiBaseUrl` already defaults to `""` and `sw.js:25`
   already bypasses `/v1/` — verify both stay true rather than re-deriving.

**Done when:** `vite build` + `wrangler dev` (web worker with the API worker
running as a service-binding peer) serves the bundle and completes the F1 dev
sign-in + onboarding with the Vite proxy nowhere in the path.

---

## Stream F5 — Real consent (blocked on backend Stream 4)

`onboardingConsentId()` returns the literal `cns_local_web_0001`
(`api-client.ts:111-113`), and the step-3 checkbox (`Onboarding.tsx:318-344`)
mints nothing. Contract-first per repo convention: the consents endpoints enter
the OpenAPI paths before the client consumes them.

**Tasks (when `POST /v1/consents` exists):**

1. Mint on final submit: create the `account_processing` consent and carry the
   returned id into the same submission's `consent_id` — no dangling records
   from abandoned forms. Delete `onboardingConsentId()` and the
   `VITE_CONSENT_ID` scaffolding.
2. Show the policy version being granted on step 3 — the consent row stores
   `policy_version`; the UI should display what the checkbox binds to.
3. Handle `403 consent_invalid` distinctly from validation errors.
4. **Revocation UI** (spec 0.4: revoking `account_processing` **freezes** the
   account — retained, unserved, reversible): a pause/revoke control in
   `PrivacyView`, plus a frozen-account state in the app shell when the API
   signals it. Deletion stays a separate act (F6).

**Done when:** a fresh user's chart request carries a consent id that exists in
the `consents` table, and revoking from the privacy page lands the account in a
visible, reversible frozen state.

---

## Stream F6 — Privacy center export & delete (blocked on backend Stream 5)

The buttons exist disabled with honest "M1 pending" labels
(`PrivacyView.tsx:95-102`) — the last unchecked M1 README items.

**Tasks (when the privacy routes exist):**

1. **Export:** `POST /v1/exports` with an `Idempotency-Key` (reuse the pattern
   from `createBirthProfile`, `api-client.ts:100-106`), poll
   `GET /v1/exports/:id`, then download. Per spec 0.5 the artifact is sealed in
   R2 and unsealed by the Worker at download — the user receives readable JSON;
   surface the expiry (`expires_at`) in the UI.
2. **Delete:** an explicit type-to-confirm flow (deletion destroys the DEK —
   genuinely irreversible, the copy must say so), then `DELETE /v1/account`,
   then sign out locally and show a terminal completion screen. Pin the
   post-deletion API shape (the `user_key_destroyed` fail-closed path) with the
   backend task plan and render it as "account deleted", never as a generic
   error.
3. Keep the M4 source-control buttons disabled (`PrivacyView.tsx:78`) — those
   are out of scope.

**Done when:** export round-trips to a file the user can open; deletion ends at
the terminal screen and a subsequent sign-in with the same IdP account gets a
fresh, empty account (per backend semantics) or a clear refusal — whichever
Stream 5 specifies — not a broken chart view.

---

## Stream F7 — Birthplace search & timezone resolution (blocked on backend Stream 7)

Today the form asks for raw decimals and hand-typed IANA zones, with the honest
caveat at `Onboarding.tsx:311-313` — and defaults the zone to the **browser's
current** timezone (`systemTimezone()`, `Onboarding.tsx:32-34`), which is wrong
for anyone who has moved since birth.

**Tasks (when the place-search endpoint exists):**

1. An accessible autocomplete on the place field returning
   `{ label, lat, lon, tzid }`; selection fills coordinates and the historical
   zone, shown for confirmation rather than silently trusted.
2. Stop defaulting `timezone_hint` to the browser zone once a place is chosen;
   keep manual coordinate/zone entry as the fallback path (it works today and
   must keep working).
3. Surface low `geocode_confidence` through the uncertainty panel the chart
   view already renders, rather than blocking submission.

**Done when:** typing "Los Angeles" yields `America/Los_Angeles` and correct
coordinates with zero decimals typed, and the resolved zone is confirmed by the
user before submission.

---

## Stream F8 — Hygiene once the above land (small)

- Delete the `VITE_DEV_USER_ID` / `VITE_CONSENT_ID` env scaffolding and the
  README section describing it (`README.md:44-51`) — F1 and F5 remove their
  consumers.
- Update the dev hint copy in the offline error view (`App.tsx:115-117`) to
  mention the dev sign-in instead of header-based auth.
- Error-code audit in `api-client.ts`: 401 (`signedOut`), 403 variants
  (`consent_invalid`, frozen), 5xx (offline) — one mapping table, tested.
- Re-run the axe pass across the new views (sign-in, export/delete dialogs,
  place autocomplete — comboboxes are where a11y regressions live).

---

## Explicitly out of scope

The Today, Timing, and Time-travel views stay as milestone-gate screens
(`UnavailableView`, staged M3/M4 in `AppShell.tsx:6-12`), matching the API's
honest 501s. The native mobile client implied by the platform topology is not
M1. No state-management or routing library is introduced for any of the above —
the hash router and `useState` machine are sufficient at this surface area.

---

## Suggested order

```
F0.1 decide IdP ────────────────┐
                                ▼
F1 dev loop ──► F2 session state ──► F3 OIDC sign-in ──┐
                                                       ├──► M1 frontend complete
F4 same-origin router ── independent, deploy-blocking ─┤
                                                       │
F5 consent    ── starts when API Stream 4 lands ───────┤
F6 export/del ── starts when API Stream 5 lands ───────┤
F7 birthplace ── starts when API Stream 7 lands ───────┘
F8 hygiene    ── trailing, small
```

F1 → F2 is the critical path and needs no decisions. F4 can proceed in
parallel with any of it. F5–F7 are ready to start the day their backend
streams land; nothing in them is worth building against guessed contracts.
