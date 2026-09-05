import { describe, expect, it } from "vitest";

import { resolvePatternPublisherConfiguration } from "./pattern-publisher.js";
import { resolveOntologyPipelineConfiguration } from "../middleware/config-guard.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";

/** A fully configured Codex Pattern environment, for mutation in each case. */
function env(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "production",
    PATTERN_PUBLISHER: "codex",
    PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
    PATTERN_INPUT_MAX_BYTES: "98304",
    PATTERN_ARTIFACT_RETENTION_DAYS: "30",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    CODEX_PROVIDER_ARTIFACT_KEYRING: '{"version":1,"keys":{"k":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}}',
    ARTIFACTS: {},
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
    ...overrides,
  } as never;
}

describe("Codex publisher configuration", () => {
  it("accepts a fully configured codex deployment outside development", () => {
    const outcome = resolvePatternPublisherConfiguration(env());
    expect(outcome.ok).toBe(true);
    const config = (outcome as { ok: true; config: { pin: PatternPublisherPin } }).config;
    expect(config.pin.publisher).toBe("codex");
  });

  it("requires the durable runner control-plane bindings", () => {
    expect(
      resolvePatternPublisherConfiguration(env({ CODEX_RUNNER_TOKEN: "" })),
    ).toMatchObject({ ok: false });
    expect(
      resolvePatternPublisherConfiguration(env({
        CODEX_PROVIDER_ARTIFACT_KEYRING: "",
      })),
    ).toMatchObject({ ok: false });
    expect(
      resolvePatternPublisherConfiguration(env({ ARTIFACTS: undefined })),
    ).toMatchObject({ ok: false });
  });

  it("keeps the runner provider independent from AI Gateway", () => {
    const outcome = resolvePatternPublisherConfiguration(
      env({
        AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
        AI_GATEWAY_ID: "pattern-gateway",
      }),
    );
    expect(outcome).toMatchObject({ ok: false });
  });

  it("still refuses an unknown publisher name", () => {
    expect(
      resolvePatternPublisherConfiguration(env({ PATTERN_PUBLISHER: "anthropic" })),
    ).toMatchObject({ ok: false });
  });
});

/** A fully configured Codex ontology pipeline, for mutation in each case. */
function pipelineEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "production",
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
    ONTOLOGY_PIPELINE_PUBLISHER: "codex",
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "98304",
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT: "500",
    ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS: "7",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    CODEX_PROVIDER_ARTIFACT_KEYRING: '{"version":1,"keys":{"k":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}}',
    ARTIFACTS: {},
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "xhigh",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.5",
    OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "900000",
    OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS: "8000",
    OPENAI_ONTOLOGY_EVALUATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_EVALUATOR_REASONING: "xhigh",
    OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0-evaluator",
    OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "900000",
    OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS: "4000",
    ...overrides,
  } as never;
}

describe("Codex ontology pipeline configuration", () => {
  it("resolves the durable runner without any OpenAI API key", () => {
    const outcome = resolveOntologyPipelineConfiguration(pipelineEnv());
    expect(outcome.ok).toBe(true);
    const config = (outcome as {
      ok: true;
      config: { publisher: string; credential: unknown };
    }).config;
    expect(config.publisher).toBe("codex");
    expect(config.credential).toBeNull();
  });

  it("still resolves the OpenAI credential when the publisher is unset", () => {
    const outcome = resolveOntologyPipelineConfiguration(
      pipelineEnv({
        ONTOLOGY_PIPELINE_PUBLISHER: undefined,
        OPENAI_CREDENTIAL_SOURCE: "worker",
        OPENAI_API_KEY: "sk-test",
        OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "120000",
        OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "120000",
      }),
    );
    expect(outcome.ok).toBe(true);
    const config = (outcome as {
      ok: true;
      config: { publisher: string; credential: { source: string } };
    }).config;
    expect(config.publisher).toBe("openai");
    expect(config.credential.source).toBe("worker");
  });

  it("requires the durable runner control-plane bindings", () => {
    expect(
      resolveOntologyPipelineConfiguration(pipelineEnv({ CODEX_RUNNER_TOKEN: "" })),
    ).toMatchObject({ ok: false });
    expect(
      resolveOntologyPipelineConfiguration(pipelineEnv({
        CODEX_PROVIDER_ARTIFACT_KEYRING: "",
      })),
    ).toMatchObject({ ok: false });
    expect(
      resolveOntologyPipelineConfiguration(pipelineEnv({ ARTIFACTS: undefined })),
    ).toMatchObject({ ok: false });
  });

  it("refuses an unknown pipeline publisher", () => {
    expect(
      resolveOntologyPipelineConfiguration(
        pipelineEnv({ ONTOLOGY_PIPELINE_PUBLISHER: "anthropic" }),
      ),
    ).toMatchObject({ ok: false });
  });
});
