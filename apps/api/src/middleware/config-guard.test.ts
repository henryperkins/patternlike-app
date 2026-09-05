import { describe, expect, it } from "vitest";

import {
  checkAdminAccessConfig,
  checkSecureConfig,
} from "./config-guard.js";

/**
 * The complete Codex Pattern posture every deployment carries.
 *
 * Pattern has no rollout and exactly one deployable publisher, so an incomplete
 * Pattern block is a refusal on every path. Cases about an unrelated rule spread
 * this in so their refusal names the rule they are actually about.
 */
const PATTERN_CODEX_VARS = {
  PATTERN_PUBLISHER: "codex",
  PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
  PATTERN_INPUT_MAX_BYTES: "98304",
  PATTERN_ARTIFACT_RETENTION_DAYS: "30",
  CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
  CODEX_PROVIDER_ARTIFACT_KEYRING:
    '{"version":1,"keys":{"k":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}}',
  ARTIFACTS: {} as never,
  OPENAI_PATTERN_PLANNER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_PLANNER_REASONING: "xhigh",
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION: "1.0.1",
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_WRITER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_WRITER_REASONING: "xhigh",
  OPENAI_PATTERN_WRITER_PROMPT_VERSION: "1.0.2",
  OPENAI_PATTERN_WRITER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_VERIFIER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_VERIFIER_REASONING: "xhigh",
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION: "1.0.0-verifier",
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS: "32000",
};

/** `checkSecureConfig` over a deployment whose Pattern block is complete. */
function guard(environment: Record<string, unknown>) {
  return checkSecureConfig({ ...PATTERN_CODEX_VARS, ...environment } as never);
}

const configuredProduction = {
  ENVIRONMENT: "production",
  AUTH_STUB: "0",
  ROOT_KEK: "a-real-root-kek-with-enough-entropy-32+",
  OIDC_ISSUER: "https://issuer.example.com",
  OIDC_AUDIENCE: "patternlike-web",
  OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  TIME_TRAVEL_RECEIPT_EPOCH: "1",
  TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
};

describe("root encryption key configuration", () => {
  it("accepts the retained legacy root without a keyring", () => {
    expect(guard({
      ...configuredProduction,
      CALC_FETCH_TIMEOUT_MS: "10000",
      BIRTH_CALC_DAILY_LIMIT: "5",
    })).toBeNull();
  });

  it("accepts a valid keyring while the legacy root remains configured", () => {
    expect(
      guard({
        ...configuredProduction,
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
        ROOT_KEK_KEYRING: JSON.stringify({
          version: 1,
          active_key_id: "root-2026-09",
          keys: {
            legacy: configuredProduction.ROOT_KEK,
            "root-2026-09": "b-real-root-kek-with-enough-entropy-32+",
          },
        }),
      }),
    ).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify({
      version: 1,
      active_key_id: "missing",
      keys: { legacy: configuredProduction.ROOT_KEK },
    }),
  ])("rejects a malformed configured keyring before the development short-circuit", (keyring) => {
    expect(
      guard({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
        ROOT_KEK_KEYRING: keyring,
      })?.code,
    ).toBe("root_kek_keyring_invalid");
  });

  it("retains the production legacy-root requirement during migration", () => {
    expect(
      guard({
        ...configuredProduction,
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
        ROOT_KEK: undefined,
        ROOT_KEK_KEYRING: JSON.stringify({
          version: 1,
          active_key_id: "root-2026-09",
          keys: {
            "root-2026-09": "b-real-root-kek-with-enough-entropy-32+",
          },
        }),
      })?.code,
    ).toBe("root_kek_not_configured");
  });
});

describe("geocoder rollout configuration", () => {
  it("keeps unrelated routes healthy while rollout is off without a key", () => {
    expect(guard({
      ENVIRONMENT: "development",
      AUTH_STUB: "1",
      GEOCODER_ROLLOUT: "off",
    })).toBeNull();
  });

  it("rejects unknown rollout values before the development short-circuit", () => {
    expect(guard({
      ENVIRONMENT: "development",
      AUTH_STUB: "1",
      GEOCODER_ROLLOUT: "partial",
    })?.code).toBe("geocoder_rollout_invalid");
  });

  it("does not make an optional geocoder credential load-bearing for the product", () => {
    expect(guard({
      ...configuredProduction,
      CALC_FETCH_TIMEOUT_MS: "10000",
      BIRTH_CALC_DAILY_LIMIT: "5",
      GEOCODER_ROLLOUT: "enabled",
    })).toBeNull();
    expect(guard({
      ENVIRONMENT: "development",
      AUTH_STUB: "1",
      GEOCODER_ROLLOUT: "enabled",
    })).toBeNull();
    expect(guard({
      ENVIRONMENT: "development",
      AUTH_STUB: "1",
      GEOCODER_ROLLOUT: "enabled",
      GEOAPIFY_API_KEY: "configured-test-key",
    })).toBeNull();
  });
});

describe("Cloudflare Access administrator configuration", () => {
  it("accepts an HTTPS team domain and a distinct application audience", () => {
    expect(checkAdminAccessConfig({
      ADMIN_ACCESS_TEAM_DOMAIN: "https://patternlike.cloudflareaccess.com",
      ADMIN_ACCESS_POLICY_AUD: "admin-audience-tag",
      OIDC_AUDIENCE: "consumer-audience",
    })).toBeNull();
  });

  it.each([
    {},
    {
      ADMIN_ACCESS_TEAM_DOMAIN: "https://team.invalid",
      ADMIN_ACCESS_POLICY_AUD: "admin-audience-tag",
    },
    {
      ADMIN_ACCESS_TEAM_DOMAIN: "http://patternlike.cloudflareaccess.com",
      ADMIN_ACCESS_POLICY_AUD: "admin-audience-tag",
    },
    {
      ADMIN_ACCESS_TEAM_DOMAIN: "https://patternlike.cloudflareaccess.com/path",
      ADMIN_ACCESS_POLICY_AUD: "admin-audience-tag",
    },
    {
      ADMIN_ACCESS_TEAM_DOMAIN: "https://patternlike.cloudflareaccess.com",
      ADMIN_ACCESS_POLICY_AUD: "consumer-audience",
      OIDC_AUDIENCE: "consumer-audience",
    },
  ])("rejects an unusable administrator authority: %j", (values) => {
    expect(checkAdminAccessConfig(values)?.code).toBe("admin_auth_not_configured");
  });
});

describe("birth operational configuration guard", () => {
  it("allows development to omit both values", () => {
    expect(
      guard({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
      }),
    ).toBeNull();
  });

  it("allows development to set one valid value and default the other", () => {
    expect(
      guard({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
        CALC_FETCH_TIMEOUT_MS: "12000",
      }),
    ).toBeNull();
  });

  it.each([
    { CALC_FETCH_TIMEOUT_MS: "0" },
    { BIRTH_CALC_DAILY_LIMIT: "5.5" },
  ])("rejects malformed present values before the development short-circuit: %j", (values) => {
    expect(
      guard({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
        ...values,
      })?.code,
    ).toBe("birth_operational_config_invalid");
  });

  it.each([
    {},
    { CALC_FETCH_TIMEOUT_MS: "10000" },
    { BIRTH_CALC_DAILY_LIMIT: "5" },
  ])("requires both values outside development: %j", (values) => {
    expect(
      guard({
        ...configuredProduction,
        ...values,
      })?.code,
    ).toBe("birth_operational_config_invalid");
  });

  it("accepts both bounded values in production", () => {
    expect(
      guard({
        ...configuredProduction,
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
      }),
    ).toBeNull();
  });
});
