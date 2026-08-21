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
import {
  resolveAiGatewayRoute,
  resolveProviderCredentialMode,
  type AiGatewayRoute,
  type ProviderCredentialMode,
} from "./reading-publisher.js";
import type {
  PatternPlan,
  PatternSemanticVerdict,
  PatternWriterOutput,
} from "@patternlike/shared";
import type {
  PublisherFailureCode,
  PublisherSafeDetailCode,
} from "./openai-responses-adapter.js";

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

/**
 * Section 14.2: the verifier configuration must not be identical to the
 * writer's, and at minimum `(provider, model, prompt_version)` must differ.
 *
 * Checked against the COMPILED CONSTANTS, not the environment. The environment
 * values are already pinned to these constants for equality, so an operator
 * cannot make them collide -- but nothing stopped a source edit from making the
 * two constants equal, and then one model configuration would be sole author and
 * judge of the same prose with every pin check still passing. The separation was
 * an accident of two literals; this makes it a checked relationship.
 *
 * Both passes share a provider, so the separation has to come from the model or
 * the prompt version. Today it is the prompt version.
 */
export function verifierIndependenceProblem(
  writerModel: string,
  writerPromptVersion: string,
  verifierModel: string,
  verifierPromptVersion: string,
): string | null {
  if (writerModel === verifierModel && writerPromptVersion === verifierPromptVersion) {
    return "The Pattern verifier configuration must differ from the writer's in model or prompt version (design section 14.2)";
  }
  return null;
}

export const PATTERN_INPUT_MAX_BYTES = 98_304;
export const PATTERN_DAILY_PROVIDER_CALL_LIMIT = 100;
export const PATTERN_ARTIFACT_RETENTION_DAYS = 30;

export type PatternPublisherName = typeof PATTERN_PUBLISHER_OPENAI | typeof PATTERN_PUBLISHER_SYNTHETIC;

/** Closed failures returned by either Pattern publisher implementation. */
export type PatternPublisherFailureCode =
  | PublisherFailureCode
  | "publisher_budget_exhausted";

/** Closed, prose-free detail codes safe to project into operational logs. */
export type PatternPublisherSafeDetailCode =
  | PublisherSafeDetailCode
  | "gateway_cache_hit"
  | "gateway_dlp_match"
  | "provider_4xx"
  | "response_too_large"
  | "daily_call_limit_reached";

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
  /**
   * The gateway the Pattern passes travel through, or `null` for the direct
   * origin.
   *
   * Carried here rather than resolved at the call site so the adapter is handed
   * a route explicitly instead of defaulting to one. A half-configured pair is
   * refused above, never quietly downgraded to the direct origin -- an operator
   * who set one of the two ids meant to route through a gateway, and billing the
   * passes directly instead looks like a working deployment with an empty
   * dashboard.
   */
  gatewayRoute: AiGatewayRoute | null;
  /**
   * How this deployment authenticates to OpenAI, or `null` under the synthetic
   * pin, which authenticates to nothing.
   *
   * Resolved from `OPENAI_CREDENTIAL_SOURCE` rather than inferred from whether
   * `OPENAI_API_KEY` happens to be set: inference cannot tell "the gateway holds
   * the key" from "the worker key was forgotten", and those two need opposite
   * outcomes.
   */
  credential: ProviderCredentialMode | null;
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
    // `OPENAI_API_KEY` is deliberately NOT in this list. Under
    // `OPENAI_CREDENTIAL_SOURCE=gateway_stored` the key must be ABSENT -- a key
    // on the request wins over the gateway-stored one -- so requiring it here
    // made BYOK, the approved credential model, unreachable for Pattern.
    // `resolveProviderCredentialMode` below owns the whole question.
    const required = [
      env.OPENAI_PATTERN_PLANNER_MODEL,
      env.OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
      env.OPENAI_PATTERN_WRITER_MODEL,
      env.OPENAI_PATTERN_WRITER_PROMPT_VERSION,
      env.OPENAI_PATTERN_VERIFIER_MODEL,
      env.OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
    ];
    if (required.some((value) => !value?.trim())) {
      return misconfigured("The Pattern openai publisher is enabled but not fully configured");
    }
  }

  let gatewayRoute: AiGatewayRoute | null = null;
  let credential: ProviderCredentialMode | null = null;

  // Section 14.2: the verifier configuration must not be identical to the
  // writer's, and at minimum (provider, model, prompt_version) must differ.
  // Today only the prompt version separates them, and nothing checked that it
  // stayed separate -- so one model configuration could become sole author and
  // judge of the same prose through a one-character edit. Now the deployment
  // refuses instead.
  if (publisherName === PATTERN_PUBLISHER_OPENAI) {
    const independence = verifierIndependenceProblem(
      OPENAI_PATTERN_WRITER_MODEL,
      OPENAI_PATTERN_WRITER_PROMPT_VERSION,
      OPENAI_PATTERN_VERIFIER_MODEL,
      OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
    );
    if (independence) return misconfigured(independence);

    // A half-configured gateway pair is a refusal, never a quiet fall back to
    // the direct origin: an operator who set one of the two ids meant to route
    // through a gateway, and billing and logging the Pattern passes directly
    // instead would look like a working deployment with an empty dashboard.
    const gateway = resolveAiGatewayRoute(env);
    if (!gateway.ok) return misconfigured(gateway.message);
    gatewayRoute = gateway.route;

    const resolved = resolveProviderCredentialMode(env, gatewayRoute);
    if (!resolved.ok) return misconfigured(resolved.message);
    credential = resolved.mode;
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
      gatewayRoute,
      credential,
    },
  };
}

// ---------------------------------------------------------------------------
// The publisher interface
//
// Types only, and deliberately no import from the adapter or the prompt module.
// `openai-pattern-publisher.ts` and `pattern-prompt.ts` both import from here at
// runtime, so an import back would close a cycle -- the temporal-dead-zone
// hazard `reading-prompt.ts` documents. The two factories therefore live in
// `pattern-publisher-factory.ts`, which may import in one direction freely.
// ---------------------------------------------------------------------------

/** The stage class a provider call is charged against in the usage ledger. */
export type PatternStageClass = "planner" | "writer" | "verifier";

export interface PatternPassOptions {
  /** The Worker's own correlation id. Never sent to the provider. */
  requestId: string;
  timeoutMs: number;
  pin: PatternPublisherPin;
  /**
   * Charged immediately before the fetch, by the publisher rather than the call
   * site. Resolves `ok: false` when the day's ceiling is spent, and the
   * publisher must then make no request at all.
   *
   * A synthetic publisher is constructed with a reserve that always succeeds and
   * never charges: the ledger counts provider calls, and there is no provider.
   */
  reserve: (stageClass: PatternStageClass) => Promise<{ ok: boolean }>;
}

/**
 * One pass, resolved.
 *
 * `raw` is the exact provider response bytes, which Task 6 writes to the
 * encrypted response artifact and a redelivery may adopt. It is `null` for a
 * synthetic pass, where no provider spoke. It must never reach a log.
 */
export type PatternPassOutcome<T> =
  | { ok: true; value: T; raw: string | null; metadata: PatternPassProvenance }
  | {
      ok: false;
      code: PatternPublisherFailureCode;
      safe_detail_code: PatternPublisherSafeDetailCode;
      retry_after_seconds: number | null;
      origin_layer: "provider" | "gateway" | "unknown" | "none";
    };

/** Closed provenance for one pass. No provider prose, ever. */
export interface PatternPassProvenance {
  provider: PatternPublisherName;
  pass: PatternStageClass;
  model: string;
  prompt_version: string;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  provider_response_hash: string | null;
}

export interface PatternPublisher {
  plan(input: unknown, options: PatternPassOptions): Promise<PatternPassOutcome<PatternPlan>>;
  write(input: unknown, options: PatternPassOptions): Promise<PatternPassOutcome<PatternWriterOutput>>;
  verify(input: unknown, options: PatternPassOptions): Promise<PatternPassOutcome<PatternSemanticVerdict>>;
}
