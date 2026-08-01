/**
 * Swiss Ephemeris license mode gate (M0 Milestone 0).
 * See docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md
 */

export type SeLicenseMode = "pending" | "professional" | "agpl";

/** Default follows M0 decision: AGPL public SE path. */
export const DEFAULT_SE_LICENSE_MODE: SeLicenseMode = "agpl";

export function getSeLicenseMode(
  env: NodeJS.ProcessEnv = process.env,
): SeLicenseMode {
  const raw = (env.SE_LICENSE_MODE ?? DEFAULT_SE_LICENSE_MODE)
    .toLowerCase()
    .trim();
  if (raw === "professional" || raw === "agpl" || raw === "pending") {
    return raw;
  }
  return DEFAULT_SE_LICENSE_MODE;
}

/**
 * Production public activation requires an explicit non-pending mode.
 * Local/dev may calculate freely for development and tests.
 */
export function assertPublicActivationAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const environment = (env.ENVIRONMENT ?? env.NODE_ENV ?? "development").toLowerCase();
  if (environment !== "production") return;

  const mode = getSeLicenseMode(env);
  if (mode === "pending") {
    throw new Error(
      "SE_LICENSE_MODE is pending: public production activation blocked until " +
        "Swiss Ephemeris licensing is decided (docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md).",
    );
  }
}

export function licenseStatusPayload(env: NodeJS.ProcessEnv = process.env) {
  const mode = getSeLicenseMode(env);
  const environment = (env.ENVIRONMENT ?? env.NODE_ENV ?? "development").toLowerCase();
  return {
    se_license_mode: mode,
    environment,
    public_activation_allowed: environment !== "production" || mode !== "pending",
    decision: "AGPL",
    decision_record: "docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md",
    source_offer: "docs/legal/AGPL_SOURCE_OFFER.md",
    calc_license: "AGPL-3.0-or-later",
  };
}
