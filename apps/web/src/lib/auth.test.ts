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
