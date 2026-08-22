# Auth0 React SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web workspace's direct Auth0 SPA client with the official Auth0 React SDK while preserving the existing UI and Worker-cookie authorization boundary.

**Architecture:** `Auth0Provider` owns the authorization-code callback and `useAuth0()` supplies login, initialization, ID-token claims, and logout. A small adapter in `lib/auth.ts` keeps URL cleanup and the one-shot ID-token-to-Worker-session exchange testable; `App` treats Worker API responses as authoritative and waits for Auth0 only when the initial URL was a callback.

**Tech Stack:** React 19, TypeScript 5.8, Vite 8, Vitest 4, Testing Library, `@auth0/auth0-react` 2.x

**Spec:** `docs/superpowers/specs/2026-08-22-auth0-react-canary-design.md`

## Global Constraints

- Use only official `@auth0/auth0-react` APIs; do not parse or exchange authorization codes in application code.
- Keep tenant `dev-lqmwkyo17nm5mdjz.us.auth0.com` and client ID `bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ` as public defaults with the existing Vite environment overrides.
- Keep Auth0 cache in memory and set `useRefreshTokens={false}`.
- Set `authorizationParams.scope` to `openid`; the SDK always includes
  `openid`, and this explicit value omits its optional `profile email` default.
- Keep the Worker `pl_session` cookie and API `401` responses as the product authorization source of truth.
- Preserve the current signed-out layout, copy, and single **Sign in** button; signup remains inside Universal Login.
- Revoke the Worker session before invoking Auth0 logout, even when Worker revocation fails.
- The supported login origin is exactly `http://127.0.0.1:5173/`.
- The Vite development command must include `--host 127.0.0.1 --port 5173 --strictPort`.
- Do not change frozen contracts, Worker identity verification, database migrations, Pattern rollout configuration, or Pattern-generation code.
- Preserve unrelated workspace changes, including `pattern-ontology-corpus.zip`.

## File Map

- `apps/web/src/lib/auth.ts`: public Auth0 provider options plus pure callback, Worker exchange, and logout adapters.
- `apps/web/src/lib/auth.test.ts`: boundary tests for URL handling, raw ID-token exchange, provider options, and logout order.
- `apps/web/src/main.tsx`: browser entry point that captures callback state and mounts `Auth0Provider`.
- `apps/web/src/App.tsx`: hook-driven callback orchestration while preserving Worker-authoritative UI state.
- `apps/web/src/App.test.tsx`: controlled official hook context and application sequencing tests.
- `apps/web/src/vite-config.test.ts`: resolved Vite-server behavior test.
- `apps/web/vite.config.ts`: strict development port.
- `apps/web/package.json`, `package-lock.json`: official React SDK dependency and explicit Vite command.
- `CLAUDE.md`: accurate repository-level sign-in guidance.

---

### Task 1: Official SDK dependency and auth boundary adapter

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/src/lib/auth.test.ts`
- Modify: `apps/web/src/lib/auth.ts`

**Interfaces:**
- Consumes: `createSession(idToken: string): Promise<SessionResponse>` from `apps/web/src/lib/api-client.ts`.
- Produces: `auth0ProviderOptions(origin: string): Auth0ProviderWithConfigOptions`, `isRedirectCallback(search?: string): boolean`, `clearAuth0CallbackParams(): void`, `completeSignIn(getIdTokenClaims: GetIdTokenClaims): Promise<void>`, `signOut(endWorkerSession: () => Promise<void>, auth0Logout: Auth0Logout): Promise<void>`, and `SignInError`.

- [ ] **Step 1: Record the focused baseline before changing dependencies**

Run:

```bash
npm run test -w @patternlike/web -- src/lib/auth.test.ts src/App.test.tsx
npm run typecheck -w @patternlike/web
```

Expected: both commands pass on the pre-migration implementation. If either fails, stop and diagnose the pre-existing failure before editing.

- [ ] **Step 2: Install the official React SDK, then remove the direct SPA SDK dependency**

Run from the repository root, in this order:

```bash
npm install @auth0/auth0-react@2.x -w @patternlike/web
npm uninstall @auth0/auth0-spa-js -w @patternlike/web
```

Expected: `apps/web/package.json` lists `@auth0/auth0-react` under `dependencies` and no longer directly lists `@auth0/auth0-spa-js`. The lockfile may still contain `@auth0/auth0-spa-js` transitively because the official React SDK uses it internally.

- [ ] **Step 3: Replace the auth tests with failing tests for the new adapter**

Replace `apps/web/src/lib/auth.test.ts` with:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH0_CLIENT_ID,
  AUTH0_DOMAIN,
  auth0ProviderOptions,
  clearAuth0CallbackParams,
  completeSignIn,
  isRedirectCallback,
  SignInError,
  signOut,
} from "./auth.js";

function setUrl(path: string): void {
  window.history.replaceState({}, "", path);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        token: "sess_test_only",
        expires_at: "2026-09-07T00:00:00Z",
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" },
      },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  setUrl("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUrl("/");
});

describe("Auth0 provider options", () => {
  it("keeps the configured SPA identity, exact redirect origin, and memory-only session", () => {
    const options = auth0ProviderOptions("http://127.0.0.1:5173");

    expect(options).toMatchObject({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      cacheLocation: "memory",
      useRefreshTokens: false,
      authorizationParams: {
        redirect_uri: "http://127.0.0.1:5173",
        scope: "openid",
      },
    });
    expect(options.onRedirectCallback).toBe(clearAuth0CallbackParams);
  });
});

describe("isRedirectCallback", () => {
  it("recognises successful and refused Auth0 returns", () => {
    expect(isRedirectCallback("?code=abc&state=xyz")).toBe(true);
    expect(isRedirectCallback("?error=access_denied&state=xyz")).toBe(true);
  });

  it("ignores normal navigation and incomplete callback parameters", () => {
    expect(isRedirectCallback("")).toBe(false);
    expect(isRedirectCallback("?view=pattern")).toBe(false);
    expect(isRedirectCallback("?code=abc")).toBe(false);
    expect(isRedirectCallback("?state=xyz")).toBe(false);
  });
});

describe("clearAuth0CallbackParams", () => {
  it("removes a successful callback without losing path, unrelated query, or hash", () => {
    setUrl("/reader?view=pattern&code=abc&state=xyz#today");

    clearAuth0CallbackParams();

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/reader?view=pattern#today");
  });

  it("removes a refused callback without losing unrelated navigation state", () => {
    setUrl("/reader?error=access_denied&error_description=No&state=xyz&view=privacy#privacy");

    clearAuth0CallbackParams();

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/reader?view=privacy#privacy");
  });
});

describe("completeSignIn", () => {
  it("exchanges exactly the raw encoded ID token for a Worker session", async () => {
    const getIdTokenClaims = vi.fn().mockResolvedValue({
      __raw: "header.payload.signature",
      sub: "auth0|test-only",
    });

    await completeSignIn(getIdTokenClaims);

    expect(getIdTokenClaims).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id_token: "header.payload.signature",
    });
    expect(init.credentials).toBe("include");
  });

  it("refuses a missing encoded ID token without calling the Worker", async () => {
    const getIdTokenClaims = vi.fn().mockResolvedValue(undefined);

    await expect(completeSignIn(getIdTokenClaims)).rejects.toThrow(/no id_token/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a rejected Worker exchange as a sign-in failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Authentication required" },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      completeSignIn(async () => ({ __raw: "header.payload.signature" })),
    ).rejects.toThrow(SignInError);
  });
});

describe("signOut", () => {
  it("revokes the Worker session before redirecting through Auth0", async () => {
    const order: string[] = [];
    const auth0Logout = vi.fn().mockImplementation(async () => {
      order.push("auth0");
    });

    await signOut(async () => {
      order.push("worker");
    }, auth0Logout);

    expect(order).toEqual(["worker", "auth0"]);
    expect(auth0Logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("still invokes Auth0 logout when Worker revocation throws", async () => {
    const auth0Logout = vi.fn().mockResolvedValue(undefined);

    await expect(
      signOut(async () => {
        throw new Error("network");
      }, auth0Logout),
    ).rejects.toThrow("network");

    expect(auth0Logout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run the new tests and observe the expected red state**

Run:

```bash
npm run test -w @patternlike/web -- src/lib/auth.test.ts
```

Expected: FAIL because `auth0ProviderOptions` and `clearAuth0CallbackParams` are not exported and the old `completeSignIn`/`signOut` signatures still own an `Auth0Client`.

- [ ] **Step 5: Implement the minimal official-SDK adapter**

Replace `apps/web/src/lib/auth.ts` with:

```typescript
import type {
  Auth0ProviderWithConfigOptions,
  IdToken,
  LogoutOptions,
} from "@auth0/auth0-react";
import { createSession } from "./api-client.js";

/**
 * Public SPA configuration. These values must match OIDC_ISSUER and
 * OIDC_AUDIENCE in apps/api/wrangler.toml.
 */
export const AUTH0_DOMAIN =
  import.meta.env.VITE_AUTH0_DOMAIN ?? "dev-lqmwkyo17nm5mdjz.us.auth0.com";
export const AUTH0_CLIENT_ID =
  import.meta.env.VITE_AUTH0_CLIENT_ID ?? "bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ";
const AUTH0_SCOPE = "openid";

export type GetIdTokenClaims = () => Promise<IdToken | undefined>;
export type Auth0Logout = (options?: LogoutOptions) => Promise<void>;

export function auth0ProviderOptions(
  origin: string,
): Auth0ProviderWithConfigOptions {
  return {
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    authorizationParams: {
      redirect_uri: origin,
      scope: AUTH0_SCOPE,
    },
    cacheLocation: "memory",
    useRefreshTokens: false,
    onRedirectCallback: clearAuth0CallbackParams,
  };
}

export function isRedirectCallback(
  search: string = window.location.search,
): boolean {
  const params = new URLSearchParams(search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

export function clearAuth0CallbackParams(): void {
  const url = new URL(window.location.href);
  for (const key of ["code", "state", "error", "error_description"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export class SignInError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SignInError";
  }
}

/** Exchange the SDK-cached raw ID token once for the Worker session cookie. */
export async function completeSignIn(
  getIdTokenClaims: GetIdTokenClaims,
): Promise<void> {
  try {
    const claims = await getIdTokenClaims();
    const idToken = claims?.__raw;
    if (!idToken) throw new SignInError("Auth0 returned no id_token.");
    await createSession(idToken);
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError(
      error instanceof Error ? error.message : "Sign-in could not be completed.",
      { cause: error },
    );
  }
}

/** Revoke the Worker session before clearing the Auth0 session. */
export async function signOut(
  endWorkerSession: () => Promise<void>,
  auth0Logout: Auth0Logout,
): Promise<void> {
  try {
    await endWorkerSession();
  } finally {
    await auth0Logout({
      logoutParams: { returnTo: window.location.origin },
    });
  }
}
```

- [ ] **Step 6: Run focused tests and type checking**

Run:

```bash
npm run test -w @patternlike/web -- src/lib/auth.test.ts
npm run typecheck -w @patternlike/web
```

Expected: PASS. Confirm that type checking imports `IdToken` and `LogoutOptions` from `@auth0/auth0-react`, not from its transitive SPA package.

- [ ] **Step 7: Commit the dependency and adapter migration**

```bash
git add apps/web/package.json package-lock.json apps/web/src/lib/auth.ts apps/web/src/lib/auth.test.ts
git commit -m "web: add Auth0 React SDK adapter"
```

---

### Task 2: Provider entry point and hook-driven application bootstrap

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: all exports from Task 1 and the official `useAuth0()` hook.
- Produces: `App({ isAuth0Redirect?: boolean })`; `main.tsx` captures `isRedirectCallback()` before `Auth0Provider` initializes and supplies the immutable prop.

- [ ] **Step 1: Add a complete controlled Auth0 context to the application tests**

At the top of `apps/web/src/App.test.tsx`:

1. Add `import { StrictMode } from "react";`.
2. Change the Testing Library import to `import { render, screen, waitFor } from "@testing-library/react";`.
3. Remove the `Auth0Client` and `__setAuthClientForTests` imports.
4. Add `beforeEach` to the existing Vitest named imports.
5. Import `initialContext` and the context types:

```typescript
import {
  initialContext,
  type Auth0ContextInterface,
  type IdToken,
} from "@auth0/auth0-react";
```

Add this module mock and harness after the imports:

```typescript
const auth0Harness = vi.hoisted(() => ({
  current: null as Auth0ContextInterface | null,
}));

vi.mock("@auth0/auth0-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auth0/auth0-react")>();
  return {
    ...actual,
    useAuth0: () => {
      if (!auth0Harness.current) throw new Error("Auth0 test context missing");
      return auth0Harness.current;
    },
  };
});

function setAuth0(
  overrides: Partial<Auth0ContextInterface> = {},
): Auth0ContextInterface {
  const current = {
    ...initialContext,
    isLoading: false,
    error: undefined,
    getIdTokenClaims: vi.fn().mockResolvedValue({
      __raw: "header.payload.signature",
      sub: "auth0|test-only",
    } as IdToken),
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Auth0ContextInterface;
  auth0Harness.current = current;
  return current;
}
```

Replace the old auth-client `afterEach` block with:

```typescript
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  setAuth0();
  mockApiResponses({});
});

afterEach(() => {
  auth0Harness.current = null;
});
```

- [ ] **Step 2: Add failing application tests for the approved sequencing**

Add the following tests near the existing signed-out and logout tests. Keep the existing accessibility and product tests unchanged.

```typescript
it("loads a valid Worker session without waiting for Auth0 initialization", async () => {
  const auth0 = setAuth0({ isLoading: true });
  mockApiResponses({
    "/v1/chart": { status: 200, body: chart },
  });

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: /architecture of your chart/i }),
  ).toBeInTheDocument();
  expect(capturedFor("/v1/sessions")).toHaveLength(0);
  expect(auth0.getIdTokenClaims).not.toHaveBeenCalled();
});

it("ignores an ordinary Auth0 initialization error when the Worker session is valid", async () => {
  setAuth0({ error: new Error("issuer unavailable") });
  mockApiResponses({
    "/v1/chart": { status: 200, body: chart },
  });

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: /architecture of your chart/i }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sign in/i })).not.toBeInTheDocument();
});

it("waits for the SDK callback and exchanges one session before probing the chart", async () => {
  const sessionGate = deferred();
  setAuth0({ isLoading: true });
  mockApiResponses({
    "/v1/sessions": {
      status: 201,
      gate: sessionGate.promise,
      body: {
        token: "sess_test_only",
        expires_at: "2026-09-07T00:00:00Z",
      },
    },
    "/v1/chart": { status: 200, body: chart },
  });

  const { rerender } = render(
    <StrictMode>
      <App isAuth0Redirect />
    </StrictMode>,
  );

  expect(capturedFor("/v1/sessions")).toHaveLength(0);
  expect(capturedFor("/v1/chart")).toHaveLength(0);

  setAuth0({ isLoading: false });
  rerender(
    <StrictMode>
      <App isAuth0Redirect />
    </StrictMode>,
  );

  await waitFor(() => expect(capturedFor("/v1/sessions")).toHaveLength(1));
  expect(capturedFor("/v1/sessions")[0].body).toEqual({
    id_token: "header.payload.signature",
  });
  expect(capturedFor("/v1/chart")).toHaveLength(0);

  sessionGate.release();
  expect(
    await screen.findByRole("heading", { name: /architecture of your chart/i }),
  ).toBeInTheDocument();
  expect(capturedFor("/v1/sessions")).toHaveLength(1);
  expect(capturedFor("/v1/chart")).toHaveLength(1);
});

it("cleans a refused callback and shows its SDK error on the existing signed-out surface", async () => {
  window.history.replaceState(
    {},
    "",
    "/?error=access_denied&error_description=User%20declined&state=xyz#pattern",
  );
  setAuth0({ error: new Error("User declined") });

  render(<App isAuth0Redirect />);

  expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
  expect(screen.getByText(/User declined/i)).toBeInTheDocument();
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("#pattern");
  expect(capturedFor("/v1/chart")).toHaveLength(0);
});

it("starts Universal Login from the existing Sign in button", async () => {
  const auth0 = setAuth0();
  mockApiResponses({
    "/v1/chart": {
      status: 401,
      body: { error: { code: "unauthorized", message: "Authentication required" } },
    },
  });
  const user = userEvent.setup();

  render(<App />);
  await user.click(await screen.findByRole("button", { name: /Sign in/i }));

  expect(auth0.loginWithRedirect).toHaveBeenCalledTimes(1);
  expect(auth0.loginWithRedirect).toHaveBeenCalledWith();
});
```

Replace the existing logout test with the stronger ordering test:

```typescript
it("revokes the Worker session before handing off to the issuer's logout", async () => {
  const user = userEvent.setup();
  const revokeGate = deferred();
  const auth0 = setAuth0();
  mockApiResponses({
    "/v1/chart": { status: 200, body: chart },
    "/v1/sessions/current": { status: 204, gate: revokeGate.promise, body: null },
    "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
    "GET /v1/preferences/topic-exclusions": emptyTopics,
  });

  render(<App />);
  await screen.findByRole("heading", { name: /architecture of your chart/i });
  await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
  await user.click(screen.getByRole("button", { name: /Sign out/i }));

  await waitFor(() => {
    expect(capturedFor("/v1/sessions/current")).toHaveLength(1);
  });
  expect(auth0.logout).not.toHaveBeenCalled();

  revokeGate.release();
  await waitFor(() => expect(auth0.logout).toHaveBeenCalledTimes(1));
  expect(auth0.logout).toHaveBeenCalledWith({
    logoutParams: { returnTo: window.location.origin },
  });
});

it("still hands off to Auth0 when Worker revocation is unreachable", async () => {
  const user = userEvent.setup();
  const auth0 = setAuth0();
  mockApiResponses({
    "/v1/chart": { status: 200, body: chart },
    "/v1/sessions/current": { status: 0, body: null, unreachable: true },
    "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
    "GET /v1/preferences/topic-exclusions": emptyTopics,
  });

  render(<App />);
  await screen.findByRole("heading", { name: /architecture of your chart/i });
  await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
  await user.click(screen.getByRole("button", { name: /Sign out/i }));

  await waitFor(() => expect(auth0.logout).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 3: Run the application tests and observe the expected red state**

Run:

```bash
npm run test -w @patternlike/web -- src/App.test.tsx
```

Expected: FAIL because `App` does not accept `isAuth0Redirect`, does not consume `useAuth0()`, and still calls the removed test seam and old auth helpers.

- [ ] **Step 4: Implement callback-aware bootstrap in `App.tsx`**

Make these import changes:

```typescript
import { useAuth0 } from "@auth0/auth0-react";
import { useCallback, useEffect, useRef, useState } from "react";
```

Replace the auth helper import with:

```typescript
import {
  clearAuth0CallbackParams,
  completeSignIn,
  signOut,
} from "./lib/auth.js";
```

Change the component signature and read only the official hook values the app needs:

```typescript
interface AppProps {
  isAuth0Redirect?: boolean;
}

export default function App({ isAuth0Redirect = false }: AppProps) {
  const {
    error: auth0Error,
    getIdTokenClaims,
    isLoading: isAuth0Loading,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();
  const callbackSession = useRef<Promise<void> | null>(null);
```

Wrap the existing `load` function in `useCallback` without changing its body:

```typescript
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const chart = await getChart(signal);
      setAuthState({ status: "signed-in" });
      setChartState({ status: "ready", chart });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        setAuthState({ status: "signed-out" });
        return;
      }
      setAuthState({ status: "signed-in" });
      if (error instanceof ApiError && error.status === 404) {
        setChartState({ status: "missing" });
        return;
      }
      setChartState({
        status: "offline",
        message:
          error instanceof Error
            ? error.message
            : "The chart could not be loaded.",
        requestId: error instanceof ApiError ? error.requestId : null,
      });
    }
  }, []);
```

Replace the single mount bootstrap effect with two effects:

```typescript
  useEffect(() => {
    if (isAuth0Redirect || currentView() === "deletion-status") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [isAuth0Redirect, load]);

  useEffect(() => {
    if (
      !isAuth0Redirect ||
      isAuth0Loading ||
      currentView() === "deletion-status"
    ) {
      return;
    }

    const controller = new AbortController();
    const start = async () => {
      if (auth0Error) {
        clearAuth0CallbackParams();
        setAuthState({
          status: "signed-out",
          error: auth0Error.message || "Sign-in failed.",
        });
        return;
      }

      callbackSession.current ??= completeSignIn(getIdTokenClaims);
      try {
        await callbackSession.current;
      } catch (error) {
        if (!controller.signal.aborted) {
          setAuthState({
            status: "signed-out",
            error: error instanceof Error ? error.message : "Sign-in failed.",
          });
        }
        return;
      }

      if (!controller.signal.aborted) await load(controller.signal);
    };

    void start();
    return () => controller.abort();
  }, [
    auth0Error,
    getIdTokenClaims,
    isAuth0Loading,
    isAuth0Redirect,
    load,
  ]);
```

Pass the hook logout method to the existing Worker-first helper:

```typescript
  const endSessionAndSignOut = async () => {
    await signOut(async () => {
      try {
        await endSession();
      } catch {
        // A failed revoke must not strand the user in a session they asked to
        // leave. Auth0's logout still runs (signOut calls it from `finally`),
        // and the cookie is cleared server-side on the next resolve attempt.
      }
    }, auth0Logout);
  };
```

Keep the `SignedOut` component unchanged and replace only its callback:

```tsx
return (
  <SignedOut
    onSignIn={() => loginWithRedirect()}
    error={authState.error}
  />
);
```

- [ ] **Step 5: Mount the official provider in `main.tsx`**

Update `apps/web/src/main.tsx` to:

```tsx
import { Auth0Provider } from "@auth0/auth0-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import {
  auth0ProviderOptions,
  isRedirectCallback,
} from "./lib/auth.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

const isAuth0Redirect = isRedirectCallback();

createRoot(root).render(
  <StrictMode>
    <Auth0Provider {...auth0ProviderOptions(window.location.origin)}>
      <App isAuth0Redirect={isAuth0Redirect} />
    </Auth0Provider>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
```

- [ ] **Step 6: Run the focused tests and type checker**

Run:

```bash
npm run test -w @patternlike/web -- src/lib/auth.test.ts src/App.test.tsx
npm run typecheck -w @patternlike/web
```

Expected: PASS. The Strict Mode test must record exactly one `POST /v1/sessions`, and the ordinary-load test must reach the chart while `isLoading` is still true.

- [ ] **Step 7: Run the complete web test suite to catch UI regressions**

Run:

```bash
npm run test -w @patternlike/web
```

Expected: PASS with all existing signed-out, onboarding, product, and accessibility tests unchanged.

- [ ] **Step 8: Commit provider and application integration**

```bash
git add apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "web: integrate Auth0 provider"
```

---

### Task 3: Strict Vite login origin

**Files:**
- Create: `apps/web/src/vite-config.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json` only if npm normalizes workspace metadata

**Interfaces:**
- Consumes: the web workspace's `dev` script and Vite config factory.
- Produces: a development server that binds only `127.0.0.1:5173` and exits when that port is occupied.

- [ ] **Step 1: Write a failing resolved-config test**

Create `apps/web/src/vite-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfigFn } from "vite";
import viteConfig from "../vite.config.js";

describe("Vite authentication origin", () => {
  it("fails closed on the configured Auth0 host and port", async () => {
    const environment: ConfigEnv = {
      command: "serve",
      mode: "test",
      isSsrBuild: false,
      isPreview: false,
    };
    const config = await (viteConfig as UserConfigFn)(environment);

    expect(config.server).toMatchObject({
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    });
  });
});
```

- [ ] **Step 2: Run the test and observe the expected red state**

Run:

```bash
npm run test -w @patternlike/web -- src/vite-config.test.ts
```

Expected: FAIL because `server.strictPort` is currently absent.

- [ ] **Step 3: Make both the command and resolved config strict**

In `apps/web/package.json`, change the development script to:

```json
"dev": "vite --host 127.0.0.1 --port 5173 --strictPort"
```

In `apps/web/vite.config.ts`, add `strictPort: true` beside the existing host and port:

```typescript
server: {
  host: "127.0.0.1",
  port: 5173,
  strictPort: true,
  proxy: {
```

- [ ] **Step 4: Run the resolved-config test and build**

Run:

```bash
npm run test -w @patternlike/web -- src/vite-config.test.ts
npm run build -w @patternlike/web
```

Expected: PASS. The production bundle compiles with the provider and contains no SSR evaluation path.

- [ ] **Step 5: Prove the npm script refuses an occupied port**

In terminal A, run:

```bash
npm run dev -w @patternlike/web
```

Expected: Vite reports `http://127.0.0.1:5173/`.

While terminal A remains active, run the same command in terminal B:

```bash
npm run dev -w @patternlike/web
```

Expected: terminal B exits non-zero with a message that port 5173 is already in use. It must not report 5174 or another port. Stop terminal A with Ctrl-C after the check.

- [ ] **Step 6: Commit strict-origin behavior**

```bash
git add apps/web/package.json package-lock.json apps/web/vite.config.ts apps/web/src/vite-config.test.ts
git commit -m "web: enforce Auth0 development origin"
```

---

### Task 4: Repository guidance and full verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: only files from Tasks 1–3 if verification exposes a defect

**Interfaces:**
- Consumes: the completed SDK integration.
- Produces: accurate maintainer guidance and fresh focused/full verification evidence.

- [ ] **Step 1: Update the sign-in guidance without changing product policy**

Replace the `CLAUDE.md` sign-in paragraphs that describe a dynamically imported SPA client with text containing these exact facts:

```markdown
Auth0 authenticates; the Worker authorises. `apps/web/src/main.tsx` mounts the
official `@auth0/auth0-react` provider, and `App` uses `useAuth0()` for Universal
Login, callback completion, raw ID-token claims, and Auth0 logout. After a
successful callback, `apps/web/src/lib/auth.ts` trades the one-shot encoded
`id_token` for a `pl_session` cookie via `POST /v1/sessions`.

The provider may check the Auth0 session when it initializes, but Auth0 state
never grants access to product data. The Worker cookie remains the source of
truth for “am I signed in”, answered by calling the API and watching for a 401.
Auth0 caching remains in memory and refresh tokens remain disabled; the browser
does not persist issuer tokens.

The `VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID` defaults in `auth.ts` must stay in
step with `OIDC_ISSUER`/`OIDC_AUDIENCE` in `apps/api/wrangler.toml`. A mismatch
is a flat browser 401; detailed token-verification reasons remain server-only.
```

- [ ] **Step 2: Verify dependency ownership**

Run:

```bash
npm ls @auth0/auth0-react @auth0/auth0-spa-js -w @patternlike/web
npm pkg get dependencies -w @patternlike/web
```

Expected: `@auth0/auth0-react@2.x` is a direct web dependency. `@auth0/auth0-spa-js` may appear only beneath it in the dependency tree and must not appear in the web workspace's dependency object.

- [ ] **Step 3: Run focused web verification from a clean command invocation**

Run:

```bash
npm run test -w @patternlike/web
npm run typecheck -w @patternlike/web
npm run build -w @patternlike/web
```

Expected: all three commands exit zero.

- [ ] **Step 4: Run repository-wide verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: every workspace and contract lane exits zero. The calculation pretest may download its pinned ephemeris data.

- [ ] **Step 5: Inspect the final diff and commit guidance or verification fixes**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: no whitespace errors, only the planned Auth0/Vite/docs files plus the pre-existing untracked archive, and no credentials or tokens.

Commit the guidance and any narrowly scoped verification fix:

```bash
git add CLAUDE.md
git commit -m "docs: update Auth0 React guidance"
```

Do not add `pattern-ontology-corpus.zip`.

---

### Task 5: Hand off to the canary operation

**Files:**
- Read: `docs/superpowers/plans/2026-08-22-auth0-pattern-canary.md`

**Interfaces:**
- Consumes: all passing deliverables from Tasks 1–4.
- Produces: an explicit checkpoint before any Auth0 tenant login, account creation, or production API session.

- [ ] **Step 1: Report the verified local integration checkpoint**

Report the exact SDK version installed, focused/full command outcomes, commit IDs, and the strict-port smoke result. State explicitly that no Auth0 tenant or production product state has changed yet.

- [ ] **Step 2: Continue only under the canary operations plan**

Read `docs/superpowers/plans/2026-08-22-auth0-pattern-canary.md` in full. Treat its interactive login, callback restoration, token containment, and cleanup steps as mandatory; do not improvise a password grant, manual OAuth exchange, direct D1 write, or Pattern reservation.
