import { describe, it, expect } from "vitest";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { DEV_ROOT_KEK, resolveRootKey, isDevEnvironment } from "./crypto.js";
import {
  OPENAI_READING_MODEL,
  resolveAiGatewayRoute,
  resolvePublisherConfiguration,
} from "./services/reading-publisher.js";

const STRONG_KEK = "a-real-root-kek-with-enough-entropy-32+";

describe("secure configuration guard", () => {
  it("passes in development with no secrets set", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "development", AUTH_STUB: "1" })).toBeNull();
  });

  it("accepts a fully configured production environment", () => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "production",
        ROOT_KEK: STRONG_KEK,
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_AUDIENCE: "patternlike-web",
        OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
        TIME_TRAVEL_RECEIPT_EPOCH: "1",
        TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
      }),
    ).toBeNull();
  });

  it("refuses production without ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production" });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with the development placeholder as ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: DEV_ROOT_KEK });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with AUTH_STUB enabled", () => {
    const err = checkSecureConfig({
      ENVIRONMENT: "production",
      AUTH_STUB: "1",
      ROOT_KEK: STRONG_KEK,
    });
    expect(err?.code).toBe("auth_stub_in_production");
  });

  it("treats an unset ENVIRONMENT as non-development", () => {
    expect(checkSecureConfig({})?.code).toBe("root_kek_not_configured");
  });

  it.each(["0", "14", "1.5", "not-a-number"])(
    "refuses an invalid check-in retention value %s in every environment",
    (value) => {
      expect(
        checkSecureConfig({
          ENVIRONMENT: "development",
          AUTH_STUB: "1",
          CHECK_IN_RETENTION_MONTHS: value,
        })?.code,
      ).toBe("check_in_retention_misconfigured");
    },
  );

  it.each([undefined, "", "1", "13"])(
    "accepts a bounded or defaulted check-in retention value %s",
    (value) => {
      expect(
        checkSecureConfig({
          ENVIRONMENT: "development",
          AUTH_STUB: "1",
          CHECK_IN_RETENTION_MONTHS: value,
        }),
      ).toBeNull();
    },
  );
});

describe("identity configuration", () => {
  const configured = {
    ENVIRONMENT: "production",
    ROOT_KEK: "a-real-root-kek-long-enough-to-pass-the-check",
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
    TIME_TRAVEL_RECEIPT_EPOCH: "1",
    TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
  };

  it("passes when every OIDC value is present", () => {
    expect(checkSecureConfig(configured)).toBeNull();
  });

  it.each(["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const)(
    "refuses to serve when %s is missing",
    (key) => {
      const failure = checkSecureConfig({ ...configured, [key]: undefined });
      expect(failure?.code).toBe("identity_not_configured");
    },
  );

  it.each(["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const)(
    "refuses to serve when %s is blank",
    (key) => {
      const failure = checkSecureConfig({ ...configured, [key]: "   " });
      expect(failure?.code).toBe("identity_not_configured");
    },
  );

  it.each(["OIDC_ISSUER", "OIDC_JWKS_URL"] as const)(
    "refuses to serve when %s is still the shipped placeholder",
    (key) => {
      // Presence alone is not configuration. wrangler.toml ships
      // issuer.invalid so the Env interface is satisfied locally; a deploy that
      // never replaced it would otherwise pass the guard and then fail per
      // request inside the verifier as an opaque 401.
      const failure = checkSecureConfig({
        ...configured,
        [key]: key === "OIDC_ISSUER"
          ? "https://issuer.invalid"
          : "https://issuer.invalid/.well-known/jwks.json",
      });
      expect(failure?.code).toBe("identity_not_configured");
    },
  );

  it("does not require OIDC configuration in development", () => {
    expect(
      checkSecureConfig({ ENVIRONMENT: "development", AUTH_STUB: "1" }),
    ).toBeNull();
  });

  it("does not require OIDC configuration under ENVIRONMENT=test", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "test" })).toBeNull();
  });
});

describe("root key derivation", () => {
  it("classifies environments", () => {
    expect(isDevEnvironment("development")).toBe(true);
    expect(isDevEnvironment("test")).toBe(true);
    expect(isDevEnvironment("production")).toBe(false);
    expect(isDevEnvironment(undefined)).toBe(false);
  });

  it("throws rather than silently using the dev key outside development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "production" })).rejects.toThrow(
      /ROOT_KEK/,
    );
  });

  it("throws when ROOT_KEK is the repo-committed placeholder outside development", async () => {
    await expect(
      resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: DEV_ROOT_KEK }),
    ).rejects.toThrow(/placeholder/);
  });

  it("uses the dev fallback only in development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "development" })).resolves.toBeDefined();
  });

  it("rejects a ROOT_KEK that is too short to be a real secret", async () => {
    await expect(
      resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: "short" }),
    ).rejects.toThrow(/32/);
  });

  it("derives a usable AES-GCM key via HKDF", async () => {
    const key = await resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK });
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });

  it("derives different keys from different passphrases", async () => {
    const a = await resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK });
    const b = await resolveRootKey({
      ENVIRONMENT: "production",
      ROOT_KEK: `${STRONG_KEK}-different`,
    });
    const iv = new Uint8Array(12);
    const pt = new TextEncoder().encode("probe");
    const ctA = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, pt),
    );
    const ctB = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, b, pt),
    );
    expect(Array.from(ctA)).not.toEqual(Array.from(ctB));
  });
});

/**
 * Publisher configuration, checked in every environment.
 *
 * `off` has to be a real state, not a half-configured one: the schema-compatible
 * deploy that lands the dual readers runs with no publisher variables and no key
 * at all, and it must serve every existing surface. Everything else is pinned to
 * the exact value the code was written for, because "the model is whatever the
 * var says" is how a deployment silently starts publishing prose the frozen
 * input never described.
 */
describe("publisher configuration", () => {
  const enabled = {
    ENVIRONMENT: "production",
    ROOT_KEK: STRONG_KEK,
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
    READING_V5_ROLLOUT: "internal",
    READING_PUBLISHER: "openai",
    OPENAI_READING_MODEL: OPENAI_READING_MODEL,
    OPENAI_READING_REASONING: "high",
    OPENAI_READING_PROMPT_VERSION: "1.0.1",
    OPENAI_READING_TIMEOUT_MS: "90000",
    OPENAI_READING_MAX_OUTPUT_TOKENS: "4000",
    READING_CONTEXT_MAX_BYTES: "98304",
    READING_PREGEN_ACTIVE_DAYS: "30",
    READING_PREGEN_LEAD_MINUTES: "30",
    READING_PREGEN_SPREAD_MINUTES: "45",
    READING_SCHEDULER_BATCH_LIMIT: "100",
    READING_DAILY_PROVIDER_CALL_LIMIT: "250",
    OPENAI_API_KEY: "sk-test-key",
    TIME_TRAVEL_RECEIPT_EPOCH: "1",
    TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
  };

  it("accepts a complete enabled configuration", () => {
    expect(checkSecureConfig(enabled)).toBeNull();
    const resolved = resolvePublisherConfiguration(enabled);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.rollout).toBe("internal");
    expect(resolved.config?.pin.model).toBe(OPENAI_READING_MODEL);
    expect(resolved.config?.pin.reasoning_effort).toBe("high");
    expect(resolved.config?.pin.output_schema).toBe("daily-reading-v5");
    expect(resolved.config?.pin.max_output_tokens).toBe(4000);
    expect(resolved.config?.timeoutMs).toBe(90_000);
    expect(resolved.config?.dailyCallLimit).toBe(250);
    expect(resolved.config?.apiKey).toBe("sk-test-key");
  });

  it("permits every publisher value and the key to be absent while off", () => {
    const off = {
      ENVIRONMENT: "production",
      ROOT_KEK: STRONG_KEK,
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "patternlike-web",
      OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
      READING_V5_ROLLOUT: "off",
      TIME_TRAVEL_RECEIPT_EPOCH: "1",
      TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
    };
    expect(checkSecureConfig(off)).toBeNull();
    const resolved = resolvePublisherConfiguration(off);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.rollout).toBe("off");
    // Not a degraded config: there is nothing to configure until a mode needs it.
    expect(resolved.config).toBeNull();
  });

  it("still rejects a malformed optional value while off", () => {
    const off = {
      ENVIRONMENT: "production",
      ROOT_KEK: STRONG_KEK,
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "patternlike-web",
      OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
      READING_V5_ROLLOUT: "off",
      OPENAI_READING_TIMEOUT_MS: "not-a-number",
    };
    expect(checkSecureConfig(off)?.code).toBe("reading_publisher_misconfigured");
  });

  it("rejects an unknown rollout mode in every environment", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "development", READING_V5_ROLLOUT: "on" })?.code).toBe(
      "reading_rollout_invalid",
    );
    expect(checkSecureConfig({ ...enabled, READING_V5_ROLLOUT: "of" })?.code).toBe(
      "reading_rollout_invalid",
    );
  });

  it.each([
    ["READING_PUBLISHER", undefined],
    ["READING_PUBLISHER", "anthropic"],
    ["OPENAI_READING_MODEL", undefined],
    ["OPENAI_READING_MODEL", "gpt-4o"],
    ["OPENAI_READING_REASONING", "medium"],
    ["OPENAI_READING_REASONING", undefined],
    ["OPENAI_READING_PROMPT_VERSION", undefined],
    // Present but stale. Every other pinned value has this row; without it a
    // prompt bump that misses [env.production.vars] passes configuration and
    // fails every reading terminally, after the reservation is already burned.
    ["OPENAI_READING_PROMPT_VERSION", "0.9.0"],
    ["OPENAI_READING_TIMEOUT_MS", "60000"],
    ["OPENAI_READING_TIMEOUT_MS", "90000.5"],
    ["OPENAI_READING_MAX_OUTPUT_TOKENS", "1800"],
    ["READING_CONTEXT_MAX_BYTES", "65536"],
    ["READING_PREGEN_ACTIVE_DAYS", "90"],
    ["READING_PREGEN_LEAD_MINUTES", "15"],
    ["READING_PREGEN_SPREAD_MINUTES", "60"],
    ["READING_SCHEDULER_BATCH_LIMIT", "500"],
    ["READING_DAILY_PROVIDER_CALL_LIMIT", "0"],
    ["READING_DAILY_PROVIDER_CALL_LIMIT", "-5"],
    ["READING_DAILY_PROVIDER_CALL_LIMIT", "12.5"],
    ["READING_DAILY_PROVIDER_CALL_LIMIT", undefined],
    ["OPENAI_API_KEY", undefined],
  ] as const)("refuses an enabled rollout when %s is %s", (key, value) => {
    const failure = checkSecureConfig({ ...enabled, [key]: value });
    expect(failure?.code).toBe("reading_publisher_misconfigured");
  });

  it("names no secret value in the message it returns to a caller", () => {
    const failure = checkSecureConfig({ ...enabled, OPENAI_API_KEY: undefined });
    expect(failure?.message ?? "").not.toContain("sk-");
  });

  it("requires the publisher in development too once the rollout leaves off", () => {
    // isDevEnvironment short-circuits the identity and key checks, and must not
    // short-circuit this one: the local canary runs with ENVIRONMENT=development
    // and a real key, and a half-configured local run would reach a provider
    // with values the frozen command never described.
    const failure = checkSecureConfig({
      ENVIRONMENT: "development",
      AUTH_STUB: "1",
      READING_V5_ROLLOUT: "internal",
    });
    expect(failure?.code).toBe("reading_publisher_misconfigured");
  });
});

/**
 * The AI Gateway route.
 *
 * Optional in every mode, which is exactly why it is validated in every mode: a
 * value that is present and wrong must fail on the next request rather than at
 * the fetch, where the reading fails for a reason no failure class describes.
 * Both ids reach a URL path, so both are shape-checked rather than trusted.
 */
describe("AI Gateway configuration", () => {
  const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  const base = {
    ENVIRONMENT: "production",
    ROOT_KEK: STRONG_KEK,
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
    READING_V5_ROLLOUT: "off",
    CHECK_IN_RETENTION_MONTHS: "13",
    TIME_TRAVEL_RECEIPT_EPOCH: "1",
    TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
  };

  it("treats an absent gateway as the direct route", () => {
    expect(checkSecureConfig(base)).toBeNull();
    const resolved = resolveAiGatewayRoute(base);
    expect(resolved.ok && resolved.route).toBeNull();
  });

  it("treats empty strings as absent, so the shipped wrangler block is valid", () => {
    const resolved = resolveAiGatewayRoute({
      ...base,
      AI_GATEWAY_ACCOUNT_ID: "",
      AI_GATEWAY_ID: "",
    });
    expect(resolved.ok && resolved.route).toBeNull();
  });

  it("resolves a complete route", () => {
    const resolved = resolveAiGatewayRoute({
      ...base,
      AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID,
      AI_GATEWAY_ID: "patternlike",
      AI_GATEWAY_TOKEN: "cf-aig-token",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.route).toEqual({
      accountId: ACCOUNT_ID,
      gatewayId: "patternlike",
      token: "cf-aig-token",
    });
  });

  it("refuses one id without the other rather than falling back to direct", () => {
    // The fallback is the dangerous branch: an operator who set one of the two
    // meant to route through a gateway, and a deployment that quietly kept
    // calling the provider directly looks healthy while its dashboard, spend
    // limits, and fallbacks are all silently inert.
    for (const half of [
      { AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID },
      { AI_GATEWAY_ID: "patternlike" },
    ]) {
      const failure = checkSecureConfig({ ...base, ...half });
      expect(failure?.code).toBe("reading_publisher_misconfigured");
      expect(failure?.message).toContain("must be set together");
    }
  });

  it("refuses a token with nowhere to send it", () => {
    const failure = checkSecureConfig({ ...base, AI_GATEWAY_TOKEN: "cf-aig-token" });
    expect(failure?.code).toBe("reading_publisher_misconfigured");
    expect(failure?.message ?? "").not.toContain("cf-aig-token");
  });

  it("refuses ids that are not one safe URL path segment", () => {
    // Both are interpolated into the gateway path. Rejecting the shape here is
    // what lets responsesUrlFor be total.
    const malformed = [
      { AI_GATEWAY_ACCOUNT_ID: "not-hex", AI_GATEWAY_ID: "patternlike" },
      { AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID.toUpperCase(), AI_GATEWAY_ID: "patternlike" },
      { AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID, AI_GATEWAY_ID: "../openai" },
      { AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID, AI_GATEWAY_ID: "gate way" },
      { AI_GATEWAY_ACCOUNT_ID: ACCOUNT_ID, AI_GATEWAY_ID: "Patternlike" },
    ];
    for (const vars of malformed) {
      const failure = checkSecureConfig({ ...base, ...vars });
      expect(failure?.code, JSON.stringify(vars)).toBe("reading_publisher_misconfigured");
    }
  });

  it("validates the gateway while the rollout is off", () => {
    // Same argument as every pinned publisher value: a typo must not lie
    // dormant until the day someone enables generation.
    const failure = checkSecureConfig({
      ...base,
      READING_V5_ROLLOUT: "off",
      AI_GATEWAY_ACCOUNT_ID: "not-hex",
      AI_GATEWAY_ID: "patternlike",
    });
    expect(failure?.code).toBe("reading_publisher_misconfigured");
  });
});
