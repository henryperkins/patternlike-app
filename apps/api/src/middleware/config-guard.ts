import type { Context, Next } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";
import { DEV_ROOT_KEK, isDevEnvironment } from "../crypto.js";

export interface ConfigFailure {
  code: string;
  message: string;
}

/**
 * Refuse to serve on a development-shaped configuration in a non-development
 * environment.
 *
 * Workers have no startup hook with access to bindings, so the closest thing to
 * "fail startup" is refusing every request. Cheap enough to run per request.
 *
 * This is the backstop for two review findings: AUTH_STUB="1" sits in the only
 * [vars] block in wrangler.toml with no production override, so a bare
 * `wrangler deploy` published a Worker whose auth middleware trusts an
 * unauthenticated X-User-Id header; and ROOT_KEK silently defaulted to a string
 * committed in this repository.
 */
/**
 * The identity placeholder shipped in wrangler.toml. `.invalid` is reserved and
 * can never resolve, so it is safe to ship and unusable in production.
 */
export const PLACEHOLDER_OIDC_HOST = "issuer.invalid";

export function checkSecureConfig(
  env:
    | Pick<
        Env,
        | "ENVIRONMENT"
        | "AUTH_STUB"
        | "ROOT_KEK"
        | "OIDC_ISSUER"
        | "OIDC_AUDIENCE"
        | "OIDC_JWKS_URL"
      >
    | Partial<Env>,
): ConfigFailure | null {
  if (isDevEnvironment(env.ENVIRONMENT)) return null;

  if (env.AUTH_STUB === "1") {
    return {
      code: "auth_stub_in_production",
      message:
        "AUTH_STUB=1 trusts an unauthenticated X-User-Id header and must not be set outside development",
    };
  }
  const kek = env.ROOT_KEK?.trim();
  if (!kek || kek === DEV_ROOT_KEK) {
    return {
      code: "root_kek_not_configured",
      message: "ROOT_KEK must be configured with a real secret outside development",
    };
  }

  // Identity is not optional outside development. Without these the verifier
  // fails per request as an opaque 401; a deploy that forgot a value should
  // fail loudly at the guard instead.
  //
  // The placeholder check matters as much as the presence check: wrangler.toml
  // ships issuer.invalid so the Env interface is satisfied locally, and a
  // deploy that never replaced it would otherwise sail past a presence-only
  // guard. This mirrors how ROOT_KEK rejects its own committed placeholder.
  const identityKeys = ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const;
  const unusable = identityKeys.filter((k) => {
    const value = env[k]?.trim();
    return !value || value.includes(PLACEHOLDER_OIDC_HOST);
  });
  if (unusable.length > 0) {
    return {
      code: "identity_not_configured",
      message:
        "Identity provider configuration is incomplete; the API cannot authenticate anyone",
    };
  }
  return null;
}

export async function configGuard(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const failure = checkSecureConfig(c.env);
  if (failure) {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    // The specific code goes to logs, not to the client: which secret is
    // missing is not something an unauthenticated caller needs to learn.
    console.error("insecure_configuration", { code: failure.code });
    return c.json(
      {
        error: {
          code: "configuration_error",
          message: failure.message,
          request_id: requestId,
        },
      },
      503,
    );
  }
  await next();
}
