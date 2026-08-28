import { describe, expect, it } from "vitest";

import { checkSecureConfig } from "../middleware/config-guard.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  OPENAI_READING_TIMEOUT_MS,
  READING_CONTEXT_MAX_BYTES,
  READING_PUBLISHER_PROVIDER,
  resolvePublisherConfiguration,
} from "./reading-publisher.js";
import type { Env } from "../env.js";

/**
 * Daily publisher configuration after the move to the durable Codex runner.
 *
 * The point of these tests is what the deployment must NOT be able to be. Daily
 * has no fallback: if configuration admits a half-Codex deployment, the failure
 * surfaces as a reader's missing reading rather than as a 503 on the next
 * request, and the interesting cases are all the ones where something is
 * plausibly present.
 */

const STRONG_KEK = "a-real-root-kek-with-enough-entropy-32+";
const RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
const KEYRING = JSON.stringify({
  version: 1,
  keys: { "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc" },
});
// Presence is the whole check: configuration proves a bucket is bound, not that
// any particular object is in it.
const ARTIFACTS = {} as unknown as R2Bucket;

/**
 * Pattern's own configuration, which every deployment carries.
 *
 * Pattern has no rollout and exactly one deployable publisher, so an incomplete
 * Pattern block is a refusal on every path. These cases are about Daily, so
 * they spread this in to keep their refusals about Daily.
 */
const PATTERN: Partial<Env> = {
  PATTERN_PUBLISHER: "codex",
  PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
  PATTERN_INPUT_MAX_BYTES: "98304",
  PATTERN_ARTIFACT_RETENTION_DAYS: "30",
  OPENAI_PATTERN_PLANNER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_PLANNER_REASONING: "high",
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION: "1.0.1",
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_WRITER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_WRITER_REASONING: "high",
  OPENAI_PATTERN_WRITER_PROMPT_VERSION: "1.0.2",
  OPENAI_PATTERN_WRITER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_VERIFIER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_VERIFIER_REASONING: "high",
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION: "1.0.0-verifier",
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS: "32000",
};

const enabled: Partial<Env> = {
  ...PATTERN,
  ENVIRONMENT: "production",
  ROOT_KEK: STRONG_KEK,
  OIDC_ISSUER: "https://issuer.example.com",
  OIDC_AUDIENCE: "patternlike-web",
  OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  READING_V5_ROLLOUT: "hybrid",
  READING_PUBLISHER: "codex",
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING: "high",
  OPENAI_READING_PROMPT_VERSION: "1.0.1",
  OPENAI_READING_TIMEOUT_MS: "900000",
  OPENAI_READING_MAX_OUTPUT_TOKENS: "4000",
  READING_CONTEXT_MAX_BYTES: "98304",
  READING_PREGEN_ACTIVE_DAYS: "30",
  READING_PREGEN_LEAD_MINUTES: "30",
  READING_PREGEN_SPREAD_MINUTES: "45",
  READING_SCHEDULER_BATCH_LIMIT: "100",
  READING_DAILY_PROVIDER_CALL_LIMIT: "10000",
  CODEX_RUNNER_TOKEN: RUNNER_TOKEN,
  CODEX_PROVIDER_ARTIFACT_KEYRING: KEYRING,
  ARTIFACTS,
  TIME_TRAVEL_RECEIPT_EPOCH: "1",
  TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
  CALC_FETCH_TIMEOUT_MS: "10000",
  BIRTH_CALC_DAILY_LIMIT: "5",
};

describe("Codex-only Daily publisher configuration", () => {
  it("accepts a complete hybrid Codex deployment with no OpenAI credential", () => {
    expect(checkSecureConfig(enabled)).toBeNull();
    const resolved = resolvePublisherConfiguration(enabled);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.rollout).toBe("hybrid");
    expect(resolved.config?.pin.provider).toBe("codex");
    expect(resolved.config?.pin.model).toBe(OPENAI_READING_MODEL);
    expect(resolved.config?.pin.reasoning_effort).toBe("high");
    expect(resolved.config?.pin.prompt_version).toBe("1.0.1");
    expect(resolved.config?.pin.output_schema).toBe("daily-reading-v5");
    expect(resolved.config?.pin.max_output_tokens).toBe(
      OPENAI_READING_MAX_OUTPUT_TOKENS,
    );
    expect(resolved.config?.pin.context_max_bytes).toBe(READING_CONTEXT_MAX_BYTES);
    // The runner's own deadline, not the ninety seconds a synchronous Worker
    // call could afford. Nothing waits inside a Queue lease for it any more.
    expect(resolved.config?.timeoutMs).toBe(900_000);
    expect(OPENAI_READING_TIMEOUT_MS).toBe(900_000);
    expect(resolved.config?.dailyCallLimit).toBe(10_000);
    // The credential is gone from the resolved shape entirely. A field that
    // still existed would be a field some later caller could read as
    // permission to open a direct connection.
    expect(resolved.config).not.toHaveProperty("credential");
  });

  it("names Codex as the only live Daily publisher", () => {
    expect(READING_PUBLISHER_PROVIDER).toBe("codex");
    for (const value of ["openai", "workers_ai", "synthetic", "anthropic", ""]) {
      const failure = checkSecureConfig({ ...enabled, READING_PUBLISHER: value });
      expect(failure?.code).toBe("reading_publisher_misconfigured");
    }
  });

  it("refuses an enabled Daily rollout without the Codex runner posture", () => {
    for (const key of [
      "CODEX_RUNNER_TOKEN",
      "CODEX_PROVIDER_ARTIFACT_KEYRING",
    ] as const) {
      for (const value of [undefined, ""]) {
        const failure = checkSecureConfig({ ...enabled, [key]: value });
        expect(failure?.code).toBe("reading_publisher_misconfigured");
        expect(failure?.message).toContain(key);
      }
    }
    // A short or shape-invalid runner token is refused rather than sent: an
    // ambiguous 401 discovered mid-generation costs a reader their reading.
    expect(
      checkSecureConfig({ ...enabled, CODEX_RUNNER_TOKEN: "too-short" })?.code,
    ).toBe("reading_publisher_misconfigured");

    const withoutBucket = { ...enabled };
    delete withoutBucket.ARTIFACTS;
    const failure = checkSecureConfig(withoutBucket);
    expect(failure?.code).toBe("reading_publisher_misconfigured");
    expect(failure?.message).toContain("ARTIFACTS");
  });

  it("refuses a deployment configured only for the direct OpenAI transport", () => {
    // Exactly the shape the previous release shipped: a key, a credential mode,
    // an AI Gateway, and the ninety-second deadline. Every one of those values
    // is now either irrelevant or wrong, and none of them can generate a
    // reading, so the deployment must refuse rather than look configured.
    const gatewayOnly: Partial<Env> = {
      ...enabled,
      READING_PUBLISHER: "openai",
      OPENAI_READING_TIMEOUT_MS: "90000",
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_CREDENTIAL_SOURCE: "worker",
      AI_GATEWAY_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      AI_GATEWAY_ID: "patternlike",
      CODEX_RUNNER_TOKEN: "",
      CODEX_PROVIDER_ARTIFACT_KEYRING: "",
    };
    expect(checkSecureConfig(gatewayOnly)?.code).toBe(
      "reading_publisher_misconfigured",
    );
  });

  it("pins the runner deadline rather than accepting the old one", () => {
    for (const value of ["90000", "900001", "0", "900000.0", "not-a-number"]) {
      const failure = checkSecureConfig({
        ...enabled,
        OPENAI_READING_TIMEOUT_MS: value,
      });
      expect(failure?.code).toBe("reading_publisher_misconfigured");
    }
  });

  it("needs no runnable Daily provider at all while the rollout is off", () => {
    // The kill switch has to be a real state: turning Daily off in an incident
    // must leave every Daily publisher value absent and still resolve. The
    // Codex posture in this fixture belongs to Pattern, which has no off state
    // and therefore requires it whatever Daily is doing.
    const off: Partial<Env> = {
      ...PATTERN,
      CODEX_RUNNER_TOKEN: RUNNER_TOKEN,
      CODEX_PROVIDER_ARTIFACT_KEYRING: KEYRING,
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
    expect(resolved.ok && resolved.config).toBeNull();
  });

  it("still rejects a present-but-wrong pinned value while off", () => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "production",
        ROOT_KEK: STRONG_KEK,
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_AUDIENCE: "patternlike-web",
        OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
        READING_V5_ROLLOUT: "off",
        OPENAI_READING_TIMEOUT_MS: "90000",
      })?.code,
    ).toBe("reading_publisher_misconfigured");
  });

  it("names no secret value in the message it returns to a caller", () => {
    const failure = checkSecureConfig({ ...enabled, CODEX_RUNNER_TOKEN: "" });
    expect(failure?.message ?? "").not.toContain(RUNNER_TOKEN);
    expect(failure?.message ?? "").not.toContain("codex-test-key");
  });
});
