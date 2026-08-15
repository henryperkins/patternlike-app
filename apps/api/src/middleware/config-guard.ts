import type { Context, Next } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";
import { DEV_ROOT_KEK, isDevEnvironment } from "../crypto.js";
import { resolvePublisherConfiguration } from "../services/reading-publisher.js";
import { resolveCheckInRetentionMonths } from "../services/check-in-retention.js";
import { safeLog, type ConfigurationCode } from "../services/safe-log.js";
import { resolvePatternPublisherConfiguration } from "../services/pattern-publisher.js";
import { resolveTimeTravelConfiguration } from "../services/time-travel-config.js";

export interface ConfigFailure {
  /**
   * Shared with the log union deliberately: a code the guard can produce but
   * safeLog cannot name would be a 503 with no record of why.
   */
  code: ConfigurationCode;
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
        | "CHECK_IN_RETENTION_MONTHS"
        | "TIME_TRAVEL_RECEIPT_EPOCH"
        | "TIME_TRAVEL_DAILY_SCAN_LIMIT"
      >
    | Partial<Env>,
): ConfigFailure | null {
  const checkInRetention = resolveCheckInRetentionMonths(
    env.CHECK_IN_RETENTION_MONTHS,
  );
  if (!checkInRetention.ok) {
    return {
      code: "check_in_retention_misconfigured",
      message: "CHECK_IN_RETENTION_MONTHS must be an integer from 1 through 13",
    };
  }

  // Before the development short-circuit, deliberately. The local canary runs
  // with ENVIRONMENT=development and a real key, so a half-configured local run
  // would otherwise reach a provider with values no frozen command described.
  // While the rollout is off this costs nothing: every publisher value may be
  // absent, and only a value that is PRESENT and malformed is rejected.
  const publisher = resolvePublisherConfiguration(env);
  if (!publisher.ok) {
    return { code: publisher.code, message: publisher.message };
  }

  const patternPublisher = resolvePatternPublisherConfiguration(env);
  if (!patternPublisher.ok) {
    return { code: patternPublisher.code, message: patternPublisher.message };
  }

  if (isDevEnvironment(env.ENVIRONMENT)) {
    // Unit callers that exercise unrelated config rules may omit the M4 pair,
    // but a real local Worker declares both. If either is present, the pair is
    // validated exactly as production is.
    if (env.TIME_TRAVEL_RECEIPT_EPOCH !== undefined || env.TIME_TRAVEL_DAILY_SCAN_LIMIT !== undefined) {
      const timeTravel = resolveTimeTravelConfiguration(env);
      if (!timeTravel.ok) return { code: "time_travel_misconfigured", message: timeTravel.message };
    }
    return null;
  }

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
  const timeTravel = resolveTimeTravelConfiguration(env);
  if (!timeTravel.ok) {
    return { code: "time_travel_misconfigured", message: timeTravel.message };
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
    safeLog({ event: "insecure_configuration", config_code: failure.code });
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
