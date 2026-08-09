import type { Auth0Client } from "@auth0/auth0-spa-js";
import { createSession } from "./api-client.js";

/**
 * Auth0 SPA sign-in, exchanged immediately for a Worker session.
 *
 * The division of labour matters: Auth0 authenticates, the Worker authorises.
 * `POST /v1/sessions` trades a one-shot OIDC id_token for an httpOnly
 * `pl_session` cookie that lives 30 days and is revocable server-side, and
 * every subsequent request rides that cookie. Auth0 is not consulted again.
 *
 * Two consequences follow, and both are deliberate:
 *
 * - **The cookie, not Auth0, is the source of truth for "am I signed in".**
 *   The app answers that question by calling the API and watching for a 401,
 *   never by asking Auth0. That avoids an issuer round-trip on every cold load
 *   and keeps the signed-in check working while Auth0 is unreachable.
 * - **No Auth0 token is persisted.** `cacheLocation` stays at its in-memory
 *   default and refresh tokens are off, so nothing from the issuer survives a
 *   reload. The id_token is used once, within a second of being issued, and
 *   then forgotten.
 */

/**
 * Public configuration, not secrets: the client id of a public SPA client is
 * an identifier, and the issuer's key set is published. They are baked into the
 * bundle with env overrides so a different tenant can be pointed at without a
 * code change — which is what the production-tenant migration will need.
 *
 * These must stay in step with `OIDC_ISSUER`/`OIDC_AUDIENCE` in
 * apps/api/wrangler.toml. A mismatch is a silent 401: the Worker rejects the
 * token and logs the reason where the browser cannot see it.
 */
const AUTH0_DOMAIN =
  import.meta.env.VITE_AUTH0_DOMAIN ?? "dev-lqmwkyo17nm5mdjz.us.auth0.com";
const AUTH0_CLIENT_ID =
  import.meta.env.VITE_AUTH0_CLIENT_ID ?? "bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ";

/**
 * `openid` alone. The API reads exactly one claim — `sub` — so requesting
 * `profile` or `email` would collect identity data the product never uses,
 * against a spec whose whole posture is data minimisation.
 */
const SCOPE = "openid";

let clientPromise: Promise<Auth0Client> | null = null;

/**
 * Created on first use rather than at module load: constructing the client
 * touches `window`, and importing this module must stay free of side effects so
 * tests can import the API surface without a browser.
 *
 * The SDK is loaded by dynamic import, not a static one, and it is worth ~200 KB
 * raw / ~57 KB gzipped — a third of the whole bundle. Only sign-in, sign-out,
 * and the redirect callback need it, so a returning user whose cookie is still
 * valid never downloads it at all.
 *
 * The options object is passed as a literal rather than a typed constant.
 * `createAuth0Client` is overloaded on `refreshTokenMode`, and annotating the
 * object as `Auth0ClientOptions` widens that field to its full union, which
 * matches neither overload.
 */
function client(): Promise<Auth0Client> {
  clientPromise ??= import("@auth0/auth0-spa-js").then(({ createAuth0Client }) =>
    createAuth0Client({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      useRefreshTokens: false,
      authorizationParams: {
        redirect_uri: window.location.origin,
        scope: SCOPE,
      },
    }),
  );
  return clientPromise;
}

/** Test seam. Never called by production code. */
export function __setAuthClientForTests(stub: Auth0Client | null): void {
  clientPromise = stub ? Promise.resolve(stub) : null;
}

/**
 * True when the current URL is Auth0 handing control back.
 *
 * `error` is checked alongside `code`, because a user who declines consent (or
 * a rule that blocks them) is redirected back with `error`/`error_description`
 * and no `code`. Treating that as "not a callback" would leave the parameters
 * in the address bar and silently show the signed-out page again, with no
 * indication that anything was refused.
 */
export function isRedirectCallback(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

/** Strip the OAuth parameters so a reload cannot replay a spent code. */
function clearCallbackParams(): void {
  const url = new URL(window.location.href);
  for (const key of ["code", "state", "error", "error_description"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export class SignInError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SignInError";
  }
}

/** Send the user to Auth0. Returns only if the redirect fails to start. */
export async function beginSignIn(): Promise<void> {
  const auth0 = await client();
  await auth0.loginWithRedirect();
}

/**
 * Finish the redirect and trade the id_token for a Worker session.
 *
 * Always clears the callback parameters, including on failure: leaving a spent
 * authorisation code in the address bar means a reload retries an exchange that
 * Auth0 will refuse, turning one legible error into a confusing loop.
 */
export async function completeSignIn(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    clearCallbackParams();
    throw new SignInError(
      params.get("error_description") ?? `Sign-in was refused (${error}).`,
    );
  }

  const auth0 = await client();
  try {
    await auth0.handleRedirectCallback();
    const claims = await auth0.getIdTokenClaims();
    // `__raw` is the encoded JWT; the decoded claims are of no use to us,
    // because the Worker re-verifies the signature itself and trusts nothing a
    // browser has already parsed.
    const idToken = claims?.__raw;
    if (!idToken) {
      throw new SignInError("Auth0 returned no id_token.");
    }
    await createSession(idToken);
  } catch (err) {
    if (err instanceof SignInError) throw err;
    throw new SignInError(
      err instanceof Error ? err.message : "Sign-in could not be completed.",
      { cause: err },
    );
  } finally {
    clearCallbackParams();
  }
}

/**
 * Revoke the Worker session first, then clear Auth0's.
 *
 * Order is the point. The `pl_session` cookie is what actually grants access to
 * birth data, so it must die even if the Auth0 redirect never happens — a
 * closed tab or a network failure mid-logout would otherwise leave a live
 * session behind on a device the user believes they signed out of.
 */
export async function signOut(endWorkerSession: () => Promise<void>): Promise<void> {
  try {
    await endWorkerSession();
  } finally {
    const auth0 = await client();
    await auth0.logout({
      logoutParams: { returnTo: window.location.origin },
    });
  }
}
