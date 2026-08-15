/**
 * Pattern publisher configuration pins.
 *
 * Conservative launch defaults (spec §25 left exact figures to operators):
 * 120s timeouts, planner 4000 / writer 8000 / verifier 4000 tokens, 100 UTC-day
 * provider calls, 98_304 input bytes, 30-day artifact retention. The verifier
 * prompt version is deliberately not the writer prompt version.
 */

import type { Env } from "../env.js";
import { isDevEnvironment } from "../crypto.js";
import { readPatternAiRollout, type PatternAiRollout } from "./pattern-rollout.js";

export const PATTERN_PUBLISHER_OPENAI = "openai" as const;
export const PATTERN_PUBLISHER_SYNTHETIC = "synthetic" as const;

export const OPENAI_PATTERN_PLANNER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_PLANNER_REASONING = "high" as const;
export const OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "1.0.0";
export const OPENAI_PATTERN_PLANNER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS = 4000;

export const OPENAI_PATTERN_WRITER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_WRITER_REASONING = "high" as const;
export const OPENAI_PATTERN_WRITER_PROMPT_VERSION = "1.0.0";
export const OPENAI_PATTERN_WRITER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS = 8000;

export const OPENAI_PATTERN_VERIFIER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_VERIFIER_REASONING = "high" as const;
export const OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "1.0.0-verifier";
export const OPENAI_PATTERN_VERIFIER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS = 4000;

export const PATTERN_INPUT_MAX_BYTES = 98_304;
export const PATTERN_DAILY_PROVIDER_CALL_LIMIT = 100;
export const PATTERN_ARTIFACT_RETENTION_DAYS = 30;

export type PatternPublisherName = typeof PATTERN_PUBLISHER_OPENAI | typeof PATTERN_PUBLISHER_SYNTHETIC;

export interface PatternPublisherPin {
  publisher: PatternPublisherName;
  planner_model: string;
  planner_reasoning: "high";
  planner_prompt_version: string;
  planner_max_output_tokens: number;
  writer_model: string;
  writer_reasoning: "high";
  writer_prompt_version: string;
  writer_max_output_tokens: number;
  verifier_model: string;
  verifier_reasoning: "high";
  verifier_prompt_version: string;
  verifier_max_output_tokens: number;
  input_max_bytes: number;
  selection_policy_version: "1.0.0";
  validation_policy_version: "1.0.0";
}

export interface PatternPublisherConfig {
  pin: PatternPublisherPin;
  plannerTimeoutMs: number;
  writerTimeoutMs: number;
  verifierTimeoutMs: number;
  dailyCallLimit: number;
  artifactRetentionDays: number;
  apiKey: string | null;
}

export type PatternPublisherConfigOutcome =
  | { ok: true; rollout: PatternAiRollout; config: PatternPublisherConfig | null }
  | { ok: false; code: "pattern_rollout_invalid" | "pattern_publisher_misconfigured"; message: string };

function misconfigured(message: string): PatternPublisherConfigOutcome {
  return { ok: false, code: "pattern_publisher_misconfigured", message };
}

function readInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function checkPinnedInteger(raw: string | undefined, expected: number, key: string): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = readInteger(raw);
  if (parsed === null) return `${key} must be an integer`;
  if (parsed !== expected) return `${key} must be exactly ${expected}`;
  return null;
}

function checkPinnedString(raw: string | undefined, expected: string, key: string): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (raw.trim() !== expected) return `${key} must be ${expected}`;
  return null;
}

export function resolvePatternPublisherConfiguration(
  env: Partial<Env>,
): PatternPublisherConfigOutcome {
  const rollout = readPatternAiRollout(env);
  if (rollout === null) {
    return {
      ok: false,
      code: "pattern_rollout_invalid",
      message: "PATTERN_AI_ROLLOUT must be one of off, internal, or first_open",
    };
  }

  const pins: Array<[string | undefined, number, string]> = [
    [env.OPENAI_PATTERN_PLANNER_TIMEOUT_MS, OPENAI_PATTERN_PLANNER_TIMEOUT_MS, "OPENAI_PATTERN_PLANNER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS"],
    [env.OPENAI_PATTERN_WRITER_TIMEOUT_MS, OPENAI_PATTERN_WRITER_TIMEOUT_MS, "OPENAI_PATTERN_WRITER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS"],
    [env.OPENAI_PATTERN_VERIFIER_TIMEOUT_MS, OPENAI_PATTERN_VERIFIER_TIMEOUT_MS, "OPENAI_PATTERN_VERIFIER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS"],
    [env.PATTERN_INPUT_MAX_BYTES, PATTERN_INPUT_MAX_BYTES, "PATTERN_INPUT_MAX_BYTES"],
    [env.PATTERN_ARTIFACT_RETENTION_DAYS, PATTERN_ARTIFACT_RETENTION_DAYS, "PATTERN_ARTIFACT_RETENTION_DAYS"],
  ];
  for (const [raw, expected, key] of pins) {
    const problem = checkPinnedInteger(raw, expected, key);
    if (problem) return misconfigured(problem);
  }

  const stringPins: Array<[string | undefined, string, string]> = [
    [env.OPENAI_PATTERN_PLANNER_MODEL, OPENAI_PATTERN_PLANNER_MODEL, "OPENAI_PATTERN_PLANNER_MODEL"],
    [env.OPENAI_PATTERN_PLANNER_REASONING, OPENAI_PATTERN_PLANNER_REASONING, "OPENAI_PATTERN_PLANNER_REASONING"],
    [env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION, OPENAI_PATTERN_PLANNER_PROMPT_VERSION, "OPENAI_PATTERN_PLANNER_PROMPT_VERSION"],
    [env.OPENAI_PATTERN_WRITER_MODEL, OPENAI_PATTERN_WRITER_MODEL, "OPENAI_PATTERN_WRITER_MODEL"],
    [env.OPENAI_PATTERN_WRITER_REASONING, OPENAI_PATTERN_WRITER_REASONING, "OPENAI_PATTERN_WRITER_REASONING"],
    [env.OPENAI_PATTERN_WRITER_PROMPT_VERSION, OPENAI_PATTERN_WRITER_PROMPT_VERSION, "OPENAI_PATTERN_WRITER_PROMPT_VERSION"],
    [env.OPENAI_PATTERN_VERIFIER_MODEL, OPENAI_PATTERN_VERIFIER_MODEL, "OPENAI_PATTERN_VERIFIER_MODEL"],
    [env.OPENAI_PATTERN_VERIFIER_REASONING, OPENAI_PATTERN_VERIFIER_REASONING, "OPENAI_PATTERN_VERIFIER_REASONING"],
    [env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION, OPENAI_PATTERN_VERIFIER_PROMPT_VERSION, "OPENAI_PATTERN_VERIFIER_PROMPT_VERSION"],
  ];
  for (const [raw, expected, key] of stringPins) {
    const problem = checkPinnedString(raw, expected, key);
    if (problem) return misconfigured(problem);
  }

  const publisher = env.PATTERN_PUBLISHER?.trim();
  if (
    publisher !== undefined &&
    publisher !== "" &&
    publisher !== PATTERN_PUBLISHER_OPENAI &&
    publisher !== PATTERN_PUBLISHER_SYNTHETIC
  ) {
    return misconfigured("PATTERN_PUBLISHER must be openai or synthetic");
  }
  if (publisher === PATTERN_PUBLISHER_SYNTHETIC && !isDevEnvironment(env.ENVIRONMENT)) {
    return misconfigured("PATTERN_PUBLISHER=synthetic is refused outside development");
  }

  const callLimitRaw = env.PATTERN_DAILY_PROVIDER_CALL_LIMIT?.trim();
  let callLimit: number | null = null;
  if (callLimitRaw) {
    callLimit = readInteger(callLimitRaw);
    if (callLimit === null || callLimit < 1) {
      return misconfigured("PATTERN_DAILY_PROVIDER_CALL_LIMIT must be a positive integer");
    }
  }

  if (rollout === "off") return { ok: true, rollout, config: null };

  const publisherName = publisher as PatternPublisherName | undefined;
  if (!publisherName) return misconfigured("PATTERN_PUBLISHER is required when Pattern rollout is enabled");
  if (!callLimit) return misconfigured("PATTERN_DAILY_PROVIDER_CALL_LIMIT is required when Pattern rollout is enabled");

  if (publisherName === PATTERN_PUBLISHER_OPENAI) {
    const required = [
      env.OPENAI_PATTERN_PLANNER_MODEL,
      env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
      env.OPENAI_PATTERN_WRITER_MODEL,
      env.OPENAI_PATTERN_WRITER_PROMPT_VERSION,
      env.OPENAI_PATTERN_VERIFIER_MODEL,
      env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
      env.OPENAI_API_KEY,
    ];
    if (required.some((value) => !value?.trim())) {
      return misconfigured("The Pattern openai publisher is enabled but not fully configured");
    }
  }

  const pin: PatternPublisherPin = {
    publisher: publisherName,
    planner_model: OPENAI_PATTERN_PLANNER_MODEL,
    planner_reasoning: OPENAI_PATTERN_PLANNER_REASONING,
    planner_prompt_version: OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
    planner_max_output_tokens: OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
    writer_model: OPENAI_PATTERN_WRITER_MODEL,
    writer_reasoning: OPENAI_PATTERN_WRITER_REASONING,
    writer_prompt_version: OPENAI_PATTERN_WRITER_PROMPT_VERSION,
    writer_max_output_tokens: OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
    verifier_model: OPENAI_PATTERN_VERIFIER_MODEL,
    verifier_reasoning: OPENAI_PATTERN_VERIFIER_REASONING,
    verifier_prompt_version: OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
    verifier_max_output_tokens: OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
    input_max_bytes: PATTERN_INPUT_MAX_BYTES,
    selection_policy_version: "1.0.0",
    validation_policy_version: "1.0.0",
  };

  return {
    ok: true,
    rollout,
    config: {
      pin,
      plannerTimeoutMs: OPENAI_PATTERN_PLANNER_TIMEOUT_MS,
      writerTimeoutMs: OPENAI_PATTERN_WRITER_TIMEOUT_MS,
      verifierTimeoutMs: OPENAI_PATTERN_VERIFIER_TIMEOUT_MS,
      dailyCallLimit: callLimit,
      artifactRetentionDays: PATTERN_ARTIFACT_RETENTION_DAYS,
      apiKey: env.OPENAI_API_KEY?.trim() || null,
    },
  };
}
