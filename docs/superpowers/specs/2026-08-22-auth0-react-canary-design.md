# Auth0 React SDK and Pattern Canary Design

**Date:** 2026-08-22

**Status:** Approved in chat; awaiting review of this written specification

## 1. Goal

Replace the web application's direct `@auth0/auth0-spa-js` integration with
the official `@auth0/auth0-react` 2.x SDK while preserving the existing
Pattern/Like Worker-session security boundary and signed-out UI. Then establish
`hello@hperkins.blog` as the dedicated authenticated canary identity needed for
the production Pattern rollout evidence, without enabling Pattern generation or
consuming its once-per-chart claim prematurely.

## 2. Existing architecture that must remain true

Auth0 authenticates the reader; the Worker authorizes product access. After an
Auth0 redirect, the browser sends the encoded ID token once to
`POST /v1/sessions`. The Worker verifies it and returns an HTTP-only
`pl_session` cookie. All product reads and writes continue to use that Worker
session. API `401` responses, not Auth0's `isAuthenticated` value, remain the
source of truth for whether the product session is valid.

The following properties are load-bearing:

- the Worker receives the raw encoded ID token and independently verifies its
  signature, issuer, audience, expiry, and subject;
- the browser does not persist an Auth0 token in local storage or session
  storage;
- refresh tokens remain disabled;
- the browser ignores the Worker session token in the JSON response and uses
  only the HTTP-only cookie;
- logout revokes the Worker session before redirecting through Auth0 logout;
- the domain and client ID remain aligned with the production Worker's
  `OIDC_ISSUER` and `OIDC_AUDIENCE`; and
- no custom OAuth or OIDC protocol implementation is introduced.

## 3. Scope

### 3.1 Included

- install `@auth0/auth0-react@2.x` in `@patternlike/web`;
- remove the web workspace's direct dependency on `@auth0/auth0-spa-js`;
- wrap the React application in `Auth0Provider`;
- use `useAuth0()` for login, SDK initialization/callback state, ID-token
  claims, and logout;
- preserve the existing single **Sign in** button and signed-out content;
- preserve the ID-token-to-Worker-session exchange;
- make the Vite development command explicitly bind
  `127.0.0.1:5173` with `--strictPort`;
- migrate and extend auth tests before changing production behavior;
- update repository guidance that currently describes a dynamically imported
  SPA client;
- use official Auth0 tooling and Universal Login to find or create
  `hello@hperkins.blog`;
- obtain a short-lived authenticated production session without emitting
  credentials or tokens into logs;
- verify and, with explicit human confirmation, prepare the canary's active
  chart and confirmed `en-US` locale through normal product APIs; and
- update the Pattern rollout evidence with facts actually observed.

### 3.2 Excluded

- changing the Auth0 tenant, client ID, application type, or token endpoint
  authentication method;
- adding a separate signup button or user-profile display;
- switching the application to Auth0 access-token authorization;
- persisting Auth0 tokens or enabling refresh tokens;
- adding a production test-auth endpoint, bypass header, password grant, or
  hand-written OAuth exchange;
- inserting a Pattern consent directly into D1;
- setting `PATTERN_AI_ROLLOUT` to `internal`, `first_open`, or `enabled`;
- changing `PATTERN_INTERNAL_ACCOUNT_IDS`;
- activating an ontology, invoking a Pattern provider, or consuming a Pattern
  claim; and
- claiming that canary preparation closes Gate 7, Gate 8, Gate 9, or Gate 10.

Those rollout mutations remain separate operational decisions governed by
`docs/deploy/openai-pattern-rollout.md`.

## 4. SDK integration design

### 4.1 Provider configuration

`apps/web/src/main.tsx` will wrap `App` with the official `Auth0Provider` and
pass:

- `domain`: `VITE_AUTH0_DOMAIN` with the existing tenant as its public default;
- `clientId`: `VITE_AUTH0_CLIENT_ID` with the existing SPA client ID as its
  public default;
- `authorizationParams.redirect_uri`: `window.location.origin`;
- `authorizationParams.scope`: `openid`, matching the existing exchange's
  least-privilege request;
- in-memory caching; and
- refresh tokens disabled.

The current application is a client-rendered Vite SPA, not an SSR application.
Browser objects therefore remain in the browser entry point and client-side
helpers only. No server module will import or evaluate them.

The React provider initializes its underlying Auth0 client on application
mount. This replaces the current dynamic-import optimization and may perform an
Auth0 session check during a cold load. Product rendering will not wait for
that check on an ordinary non-callback load: the Worker chart/session probe may
proceed immediately, and its result remains authoritative.

### 4.2 Redirect detection and callback ownership

The React SDK owns Authorization Code + PKCE processing. The application must
still know whether the page originally contained an Auth0 callback so it can
perform the Worker-session exchange after the provider has processed and
cleaned the URL.

Before rendering `Auth0Provider`, `main.tsx` will capture a boolean identifying
an Auth0 return (`state` plus either `code` or `error`) and pass that immutable
fact to `App`. The application will not parse, exchange, or otherwise handle
the authorization code itself. `Auth0Provider` will receive a stable
`onRedirectCallback` that removes only Auth0 callback parameters and preserves
the existing path, unrelated query parameters, and hash. The same cleanup
helper will run after a refused or otherwise failed callback, because the SDK
does not invoke the success callback in that case.

For a captured callback, `App` will:

1. wait for the Auth0 provider to finish initialization, including the SDK's
   code exchange and successful-callback URL cleanup;
2. on failure, run the same URL cleanup helper and surface the provider's
   normalized callback error;
3. call the hook's `getIdTokenClaims()` on success;
4. take only the encoded `__raw` ID token;
5. call the existing `createSession(idToken)` API client; and
6. only after that exchange succeeds, probe the Worker for chart/product state.

A ref or equivalent one-shot guard will prevent React Strict Mode from issuing
two Worker-session exchanges for the same callback. An ordinary reload without
callback parameters will never mint a new Worker session merely because the
Auth0 provider reports an authenticated SSO session.

### 4.3 Login and signup

The existing `SignedOut` component and its single **Sign in** button remain
unchanged in appearance and copy. Its callback will call the hook's
`loginWithRedirect()` method. New users can select signup within Auth0 Universal
Login; the product does not add a second local signup control.

The pending and start-error behavior already owned by `SignedOut` remains in
place. A successful call navigates away. A failure to start returns control to
the component and produces its existing inline error.

### 4.4 Logout

The current ordering remains mandatory:

1. call `DELETE /v1/sessions/current` to revoke the product session;
2. even if that request fails, call the hook's `logout()` method; and
3. pass `logoutParams.returnTo = window.location.origin`.

This preserves the user's intent to leave Auth0 while ensuring the credential
that authorizes private product data is revoked first whenever the Worker is
reachable.

## 5. Vite origin design

The web workspace's `dev` script will explicitly invoke Vite with:

```text
vite --host 127.0.0.1 --port 5173 --strictPort
```

`vite.config.ts` will also set `server.strictPort = true`. This makes a busy
port an immediate error instead of silently choosing a callback-incompatible
origin. The supported Auth0 development URL remains exactly
`http://127.0.0.1:5173/`.

The existing root `npm run web:dev` script delegates to this workspace command,
so no second port definition is needed. Vite preview on port 4173 is not an
Auth0 test path and must not be used for login under the current Auth0
configuration.

## 6. Error handling

- An Auth0 callback refusal uses the SDK-provided error message and is shown on
  the existing signed-out surface.
- A successful callback with no encoded ID token becomes a `SignInError` and
  never calls the Worker session endpoint.
- A rejected Worker exchange remains a flat sign-in failure; issuer-verification
  detail remains server-log-only.
- Callback parameters are removed on success and failure so a reload cannot
  replay a spent code.
- Auth0 initialization failure on an ordinary load does not override a valid
  Worker session or block the normal API probe.
- A product-session `401` at mount or during a view returns to the existing
  signed-out surface.
- Logout still reaches Auth0 when Worker revocation throws.

## 7. Tests and verification

Implementation follows red-green-refactor. Tests will be migrated before the
production auth wrapper is replaced.

### 7.1 Focused auth tests

`apps/web/src/lib/auth.test.ts` will cover:

- successful and refused callback recognition;
- extracting the encoded ID token from the official hook method;
- posting that token once to `/v1/sessions`;
- refusing a missing ID token;
- clearing callback parameters after success and failure;
- preserving unrelated path/query/hash state; and
- Worker-first logout, including Worker-revocation failure.

### 7.2 Application tests

`apps/web/src/App.test.tsx` will provide a controlled `useAuth0()` test context
and cover:

- an ordinary Worker-session check does not wait for Auth0 initialization;
- a real callback does wait for Auth0 initialization;
- the Worker session exchange completes before the first chart probe;
- a provider callback error returns to the existing signed-out surface;
- clicking the existing **Sign in** button calls `loginWithRedirect()`;
- signing out revokes the Worker session before Auth0 logout; and
- all pre-existing signed-out and accessibility expectations remain unchanged.

### 7.3 Configuration and repository checks

Verification will include:

```text
npm run test -w @patternlike/web
npm run typecheck -w @patternlike/web
npm run build -w @patternlike/web
npm run typecheck
npm test
npm run build
```

A development-server smoke test will prove that port 5173 starts and that a
second process fails instead of moving to another port. Live Auth0 verification
requires the interactive handoff described below.

## 8. Canary identity and session design

### 8.1 Identity lookup and creation

The canary email is `hello@hperkins.blog`. After installing the official Auth0
CLI outside the repository, the operator will complete `auth0 login` through
Auth0's supported interactive flow. The CLI will search for the email before
any creation attempt.

If the identity exists, it will be reused and no duplicate will be created. If
it does not exist, the operator will use Universal Login's signup path for the
configured SPA application. The password is entered only into Auth0 Universal
Login. It is not sent through chat, placed in a command argument, written to the
repository, or retained by the implementation.

### 8.2 Temporary Auth0 callback used by the official CLI

The official `auth0 test login` command uses `http://localhost:8484` while it
runs. When that URL is absent from the SPA application's allowed callbacks, the
CLI asks for permission, adds it through the Auth0 Management API, performs
Universal Login, and removes it afterward.

This temporary mutation is permitted only for the official CLI login test. The
operation will record the application's callback list before the command and
verify afterward that the configured application URLs are restored to the
user-supplied `http://127.0.0.1:5173/` values. If automatic cleanup fails, work
stops and the extra callback is removed with the official CLI before any canary
API call proceeds.

### 8.3 Token and Worker-session handling

CLI JSON output contains tokens and therefore must never be allowed into tool
output or the evidence ledger. Before the login command, a temporary directory
will be created with owner-only permissions. CLI JSON will be redirected into
that directory.

The encoded ID token will be piped from the protected JSON file into
`POST /v1/sessions` without placing it in a command argument. Curl will store
the returned HTTP-only cookie in an owner-only cookie jar. Subsequent production
API checks will use that cookie jar, not a token copied into a shell command.

Temporary token JSON, response bodies containing native session tokens, and the
cookie jar will be deleted when the authenticated checks finish or immediately
on failure. No token value appears in console output, logs, commits, or rollout
evidence.

## 9. Canary preparation and Pattern gates

The canary is prepared only through normal authenticated product boundaries.
No direct production D1 mutation is used to manufacture eligibility.

After the Worker session exists, inspect:

- account state;
- active chart state;
- content locale and its source;
- current Pattern state and consent state; and
- whether the active chart fingerprint already has a consumed or reserved
  Pattern claim.

Existing valid state is preserved. If the account is new or incomplete, the
human operator will complete onboarding with explicitly synthetic, non-personal
birth data and confirm `en-US` through the product UI at the exact configured
Vite origin. The application may proxy `/v1` to the production Worker for this
controlled canary session; it must not send the production session cross-origin
from browser JavaScript.

Pattern-generation consent is deliberately not pre-granted. The normative
Pattern contract makes `POST /v1/pattern-generations` both the first-use consent
grant and the initial reservation so they commit atomically. Therefore:

- canary preparation stops with an active chart, confirmed `en-US`, an unused
  chart fingerprint, and authenticated evidence;
- Gate 8's first explicitly authorized reservation supplies the user's Pattern
  confirmation and writes the grant atomically;
- no script or operator inserts a consent row in advance; and
- no reservation is attempted while rollout is `off` or before an eligible
  ontology is active.

The account can close Gate 3's missing authenticated before/after read evidence.
It can become the single Gate 8 internal allowlist candidate later. It does not
resolve the currently open ontology, upstream-retention, replay-drill, or
administrator-identity requirements.

## 10. Evidence and privacy

Repository evidence may contain only:

- the Auth0 client ID and tenant domain, which are public SPA configuration;
- whether the email lookup found or created the canary;
- opaque Worker/user/version/request identifiers where the rollout runbook
  explicitly permits them;
- HTTP statuses and coarse product states;
- proof that the callback list was restored; and
- test/build command outcomes.

Evidence must not contain:

- the Auth0 password;
- ID, access, refresh, or Worker session tokens;
- the Auth0 authorization code or state value;
- cookie contents;
- birth values, chart facts, fingerprints, packets, prompts, generated prose,
  verifier rationale, or decrypted artifacts; or
- secrets from Auth0, Cloudflare, OpenAI, or the application.

## 11. Files expected to change

- `apps/web/package.json`
- `package-lock.json`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/auth.ts`
- `apps/web/src/lib/auth.test.ts`
- `apps/web/src/App.test.tsx`
- `apps/web/vite.config.ts`
- `CLAUDE.md`
- `docs/deploy/openai-pattern-rollout.md` only when live evidence is obtained

No frozen contract, schema, migration, Worker auth verifier, session route, or
Pattern-generation implementation changes are required.

## 12. Completion criteria

The SDK integration is complete when:

- the web workspace depends on `@auth0/auth0-react` 2.x and not directly on
  `@auth0/auth0-spa-js`;
- `Auth0Provider` wraps `App` with the supplied domain, client ID, and redirect
  origin;
- `useAuth0()` drives the existing sign-in and logout UI;
- one successful callback exchanges exactly one raw ID token for a Worker
  session before product bootstrap;
- ordinary product authorization still follows the Worker cookie and API 401s;
- Vite refuses to change away from port 5173;
- focused and full verification pass; and
- no token or credential is persisted by the repository.

Canary preparation is complete when:

- `hello@hperkins.blog` exists exactly once in the configured Auth0 tenant;
- a fresh official Universal Login produces an ID token accepted by the
  production Worker;
- Gate 3's authenticated Pattern read can be repeated and recorded safely;
- the canary has an active account/chart, confirmed `en-US`, and no consumed or
  reserved Pattern claim; and
- the account's opaque product user ID is known for a later, separately
  authorized one-entry internal allowlist.

Pattern generation itself remains off at completion of this work.
