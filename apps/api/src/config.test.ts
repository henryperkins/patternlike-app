import { describe, it, expect } from "vitest";
import {
  checkSecureConfig,
  resolveOntologyPipelineConfiguration,
} from "./middleware/config-guard.js";
import { DEV_ROOT_KEK, resolveRootKey, isDevEnvironment } from "./crypto.js";
import {
  OPENAI_READING_MODEL,
  resolveAiGatewayRoute,
  resolvePublisherConfiguration,
  resolveProviderCredentialMode,
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
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
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
    CALC_FETCH_TIMEOUT_MS: "10000",
    BIRTH_CALC_DAILY_LIMIT: "5",
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
    READING_PUBLISHER: "codex",
    OPENAI_READING_MODEL: OPENAI_READING_MODEL,
    OPENAI_READING_REASONING: "high",
    OPENAI_READING_PROMPT_VERSION: "1.0.1",
    OPENAI_READING_TIMEOUT_MS: "900000",
    OPENAI_READING_MAX_OUTPUT_TOKENS: "4000",
    READING_CONTEXT_MAX_BYTES: "98304",
    READING_PREGEN_ACTIVE_DAYS: "30",
    READING_PREGEN_LEAD_MINUTES: "30",
    READING_PREGEN_SPREAD_MINUTES: "45",
    READING_SCHEDULER_BATCH_LIMIT: "100",
    READING_DAILY_PROVIDER_CALL_LIMIT: "250",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    CODEX_PROVIDER_ARTIFACT_KEYRING: JSON.stringify({
      version: 1,
      keys: { "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc" },
    }),
    ARTIFACTS: {} as unknown as R2Bucket,
    TIME_TRAVEL_RECEIPT_EPOCH: "1",
    TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
    CALC_FETCH_TIMEOUT_MS: "10000",
    BIRTH_CALC_DAILY_LIMIT: "5",
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
    expect(resolved.config?.pin.provider).toBe("codex");
    expect(resolved.config?.timeoutMs).toBe(900_000);
    expect(resolved.config?.dailyCallLimit).toBe(250);
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
      CALC_FETCH_TIMEOUT_MS: "10000",
      BIRTH_CALC_DAILY_LIMIT: "5",
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
    // The transport Daily used to run on. It has no adapter behind it any more,
    // so naming it is a configuration error rather than a rollback.
    ["READING_PUBLISHER", "openai"],
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
    ["OPENAI_READING_TIMEOUT_MS", "90000"],
    ["OPENAI_READING_TIMEOUT_MS", "900000.5"],
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
    ["CODEX_RUNNER_TOKEN", undefined],
    ["CODEX_PROVIDER_ARTIFACT_KEYRING", undefined],
  ] as const)("refuses an enabled rollout when %s is %s", (key, value) => {
    const failure = checkSecureConfig({ ...enabled, [key]: value });
    expect(failure?.code).toBe("reading_publisher_misconfigured");
  });

  it("names no secret value in the message it returns to a caller", () => {
    const failure = checkSecureConfig({ ...enabled, CODEX_RUNNER_TOKEN: undefined });
    expect(failure?.message ?? "").not.toContain("runner_0123456789");
    expect(failure?.message ?? "").not.toContain("codex-test-key");
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
    CALC_FETCH_TIMEOUT_MS: "10000",
    BIRTH_CALC_DAILY_LIMIT: "5",
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

describe("provider credential mode", () => {
  const base = {
    ENVIRONMENT: "production",
    ROOT_KEK: STRONG_KEK,
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  };
  const route = { accountId: "a".repeat(32), gatewayId: "patternlike", token: "gw" };

  it("refuses an absent or unknown source", () => {
    expect(resolveProviderCredentialMode(base as never, null).ok).toBe(false);
    const bad = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "somehow_else" } as never,
      null,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toContain("must be worker or gateway_stored");
  });

  it("resolves worker mode to today's behaviour", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "worker", OPENAI_API_KEY: "sk-live" } as never,
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toEqual({ source: "worker", apiKey: "sk-live" });
  });

  it("refuses worker mode with no key", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "worker" } as never,
      null,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("OPENAI_API_KEY is required");
  });

  it("refuses gateway_stored without a gateway, because a stored key only exists behind one", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "gateway_stored", OPENAI_GATEWAY_KEY_ALIAS: "primary" } as never,
      null,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("AI_GATEWAY_ACCOUNT_ID and AI_GATEWAY_ID");
  });

  it("refuses gateway_stored without a gateway token", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "gateway_stored", OPENAI_GATEWAY_KEY_ALIAS: "primary" } as never,
      { ...route, token: null },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // BYOK requires an authenticated gateway; an ambiguous 401 mid-generation
    // is far too late to learn that.
    expect(outcome.message).toContain("AI_GATEWAY_TOKEN");
  });

  it("refuses gateway_stored while OPENAI_API_KEY is still set, naming both variables and neither value", () => {
    const outcome = resolveProviderCredentialMode(
      {
        ...base,
        OPENAI_CREDENTIAL_SOURCE: "gateway_stored",
        OPENAI_GATEWAY_KEY_ALIAS: "primary",
        OPENAI_API_KEY: "sk-should-not-be-here",
      } as never,
      route,
    );
    // A request key wins over BYOK, so tolerating both would silently bypass
    // the stored alias this mode exists to use.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("OPENAI_API_KEY");
    expect(outcome.message).toContain("gateway_stored");
    expect(outcome.message).not.toContain("sk-should-not-be-here");
  });

  it("refuses gateway_stored with no alias rather than falling back to the implicit default", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "gateway_stored" } as never,
      route,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("OPENAI_GATEWAY_KEY_ALIAS");
  });

  it("resolves a complete gateway_stored configuration", () => {
    const outcome = resolveProviderCredentialMode(
      { ...base, OPENAI_CREDENTIAL_SOURCE: "gateway_stored", OPENAI_GATEWAY_KEY_ALIAS: "primary" } as never,
      route,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toEqual({ source: "gateway_stored", alias: "primary" });
  });
});

describe("ontology pipeline configuration", () => {
  const enabled = {
    ENVIRONMENT: "production",
    ROOT_KEK: STRONG_KEK,
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
    TIME_TRAVEL_RECEIPT_EPOCH: "1",
    TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
    CALC_FETCH_TIMEOUT_MS: "10000",
    BIRTH_CALC_DAILY_LIMIT: "5",
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "high",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.5",
    OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS: "8000",
    OPENAI_ONTOLOGY_EVALUATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_EVALUATOR_REASONING: "high",
    OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0-evaluator",
    OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS: "4000",
    ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "98304",
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT: "500",
    ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS: "7",
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_CREDENTIAL_SOURCE: "worker",
    OPENAI_API_KEY: "sk-test-key",
  };

  it("freezes equal acknowledged model pins to the 100% regression threshold", () => {
    expect(checkSecureConfig(enabled)).toBeNull();
    const resolved = resolveOntologyPipelineConfiguration(enabled);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.config) return;
    expect(resolved.rollout).toBe("internal");
    expect(resolved.config.configurationEqual).toBe(true);
    expect(resolved.config.regressionMinimumPassRate).toBe(1);
    expect(resolved.config.credential).toEqual({ source: "worker", apiKey: "sk-test-key" });
  });

  it("permits no pipeline pins while the rollout is off", () => {
    const off = { ...enabled, ONTOLOGY_PIPELINE_ROLLOUT: "off" };
    for (const key of Object.keys(enabled)) {
      if (key.startsWith("OPENAI_ONTOLOGY_") || key.startsWith("ONTOLOGY_PIPELINE_")) {
        delete (off as Record<string, string | undefined>)[key];
      }
    }
    off.ONTOLOGY_PIPELINE_ROLLOUT = "off";
    expect(checkSecureConfig(off)).toBeNull();
    const resolved = resolveOntologyPipelineConfiguration(off);
    expect(resolved.ok && resolved.config).toBeNull();
  });

  it("refuses an unknown pipeline rollout in every environment", () => {
    expect(
      checkSecureConfig({ ENVIRONMENT: "development", ONTOLOGY_PIPELINE_ROLLOUT: "enabled" })?.code,
    ).toBe("ontology_pipeline_rollout_invalid");
    expect(checkSecureConfig({ ...enabled, ONTOLOGY_PIPELINE_ROLLOUT: "external" })?.code).toBe(
      "ontology_pipeline_rollout_invalid",
    );
  });

  it.each([
    ["OPENAI_ONTOLOGY_GENERATOR_MODEL", undefined],
    ["OPENAI_ONTOLOGY_GENERATOR_MODEL", "gpt-4o"],
    ["OPENAI_ONTOLOGY_GENERATOR_REASONING", undefined],
    ["OPENAI_ONTOLOGY_GENERATOR_REASONING", "medium"],
    ["OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION", undefined],
    ["OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION", "0.9.0"],
    ["OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS", undefined],
    ["OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS", "60000"],
    ["OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS", undefined],
    ["OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS", "8000.5"],
    ["OPENAI_ONTOLOGY_EVALUATOR_MODEL", undefined],
    ["OPENAI_ONTOLOGY_EVALUATOR_MODEL", "gpt-4o"],
    ["OPENAI_ONTOLOGY_EVALUATOR_REASONING", undefined],
    ["OPENAI_ONTOLOGY_EVALUATOR_REASONING", "medium"],
    ["OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION", undefined],
    ["OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION", "0.9.0"],
    ["OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS", undefined],
    ["OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS", "60000"],
    ["OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS", undefined],
    ["OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS", "4000.5"],
    ["ONTOLOGY_PIPELINE_INPUT_MAX_BYTES", undefined],
    ["ONTOLOGY_PIPELINE_INPUT_MAX_BYTES", "65536"],
    ["ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT", undefined],
    ["ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT", "0"],
    ["ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS", undefined],
    ["ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS", "30"],
    ["OPENAI_CREDENTIAL_SOURCE", undefined],
    ["OPENAI_API_KEY", undefined],
  ] as const)("refuses an enabled pipeline when %s is %s", (key, value) => {
    expect(checkSecureConfig({ ...enabled, [key]: value })?.code).toBe(
      "ontology_pipeline_misconfigured",
    );
  });

  it("refuses a matching prompt pair before it can make one configuration author and judge", () => {
    expect(
      checkSecureConfig({
        ...enabled,
        OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0",
      })?.code,
    ).toBe("ontology_pipeline_misconfigured");
  });

  it.each([undefined, "", "0", "true", "2"])(
    "refuses equal model pins without the explicit acknowledgement %s",
    (acknowledgement) => {
      expect(
        checkSecureConfig({
          ...enabled,
          ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: acknowledgement,
        })?.code,
      ).toBe("ontology_pipeline_misconfigured");
    },
  );

  it("validates a present pipeline pin while off", () => {
    expect(
      checkSecureConfig({
        ...enabled,
        ONTOLOGY_PIPELINE_ROLLOUT: "off",
        ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "not-a-number",
      })?.code,
    ).toBe("ontology_pipeline_misconfigured");
  });

  it("carries gateway-stored credentials without a provider authorization key", () => {
    const resolved = resolveOntologyPipelineConfiguration({
      ...enabled,
      OPENAI_CREDENTIAL_SOURCE: "gateway_stored",
      OPENAI_API_KEY: undefined,
      OPENAI_GATEWAY_KEY_ALIAS: "ontology-key",
      AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
      AI_GATEWAY_ID: "patternlike",
      AI_GATEWAY_TOKEN: "cf-aig-token",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.config) return;
    expect(resolved.config.credential).toEqual({ source: "gateway_stored", alias: "ontology-key" });
  });
});
