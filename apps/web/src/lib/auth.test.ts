import type { Auth0Client } from "@auth0/auth0-spa-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setAuthClientForTests,
  completeSignIn,
  isRedirectCallback,
  SignInError,
  signOut,
} from "./auth.js";

/**
 * Auth0Client is a wide interface and this module touches four of its methods.
 * Stubbing the whole surface would assert nothing extra and would rot the first
 * time the SDK grows a method.
 */
function stubClient(overrides: Partial<Auth0Client> = {}): Auth0Client {
  return {
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn().mockResolvedValue({}),
    getIdTokenClaims: vi.fn().mockResolvedValue({ __raw: "header.payload.signature" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Auth0Client;
}

function setUrl(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ token: "sess_abc", expires_at: "2026-09-07T00:00:00Z" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  __setAuthClientForTests(null);
  vi.unstubAllGlobals();
  setUrl("");
});

describe("isRedirectCallback", () => {
  it("recognises a successful authorization-code return", () => {
    expect(isRedirectCallback("?code=abc&state=xyz")).toBe(true);
  });

  it("recognises a refusal, which carries error instead of code", () => {
    // A user who declines consent comes back with error/state and no code.
    // Reading that as "not a callback" would leave the parameters in the
    // address bar and show the signed-out page with no explanation.
    expect(isRedirectCallback("?error=access_denied&state=xyz")).toBe(true);
  });

  it("ignores ordinary navigation and half-formed callbacks", () => {
    expect(isRedirectCallback("")).toBe(false);
    expect(isRedirectCallback("?view=pattern")).toBe(false);
    expect(isRedirectCallback("?code=abc")).toBe(false);
    expect(isRedirectCallback("?state=xyz")).toBe(false);
  });
});

describe("completeSignIn", () => {
  it("exchanges the raw id_token for a session and clears the callback", async () => {
    setUrl("?code=abc&state=xyz");
    __setAuthClientForTests(stubClient());

    await completeSignIn();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/sessions");
    expect(init.method).toBe("POST");
    // The encoded JWT, not the decoded claims: the Worker re-verifies the
    // signature and trusts nothing the browser has already parsed.
    expect(JSON.parse(init.body as string)).toEqual({
      id_token: "header.payload.signature",
    });
    // Credentials must be included or the Set-Cookie is dropped.
    expect(init.credentials).toBe("include");

    // A spent authorization code left in the URL turns a reload into a retry
    // Auth0 will refuse.
    expect(window.location.search).toBe("");
  });

  it("reports an issuer refusal without calling the API", async () => {
    setUrl("?error=access_denied&error_description=User%20declined&state=xyz");
    __setAuthClientForTests(stubClient());

    await expect(completeSignIn()).rejects.toThrow(SignInError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("surfaces the issuer's own description of the refusal", async () => {
    setUrl("?error=access_denied&error_description=User%20declined&state=xyz");
    __setAuthClientForTests(stubClient());

    await expect(completeSignIn()).rejects.toThrow("User declined");
  });

  it("fails loudly when Auth0 returns no id_token", async () => {
    setUrl("?code=abc&state=xyz");
    __setAuthClientForTests(
      stubClient({ getIdTokenClaims: vi.fn().mockResolvedValue(undefined) }),
    );

    await expect(completeSignIn()).rejects.toThrow(/no id_token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the callback parameters even when the exchange fails", async () => {
    setUrl("?code=abc&state=xyz");
    __setAuthClientForTests(stubClient());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "unauthorized", message: "no" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(completeSignIn()).rejects.toThrow(SignInError);
    expect(window.location.search).toBe("");
  });
});

describe("signOut", () => {
  it("revokes the Worker session before clearing Auth0", async () => {
    const order: string[] = [];
    const logout = vi.fn().mockImplementation(async () => {
      order.push("auth0");
    });
    __setAuthClientForTests(stubClient({ logout }));

    await signOut(async () => {
      order.push("worker");
    });

    expect(order).toEqual(["worker", "auth0"]);
  });

  it("still clears Auth0 when revoking the Worker session throws", async () => {
    // The cookie is what grants access to birth data. A failed revoke must not
    // abandon the logout half-done on a device the user is walking away from.
    const logout = vi.fn().mockResolvedValue(undefined);
    __setAuthClientForTests(stubClient({ logout }));

    await expect(
      signOut(async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
