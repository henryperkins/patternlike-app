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
