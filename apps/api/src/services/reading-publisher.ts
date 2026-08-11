/**
 * The provider-neutral publisher boundary and its configuration.
 *
 * The adapter behind this interface owns exactly one thing: turning a closed
 * request into a candidate or a typed failure. Consent, context selection,
 * astrology policy, retry classification, budget, publication, and logging all
 * stay in the Worker. That division is what lets the provider be replaced
 * without touching anything that decides what a reader is allowed to see.
 *
 * Every configured value below is pinned to the exact number the code was
 * written for rather than merely parsed. "The model is whatever the var says" is
 * how a deployment silently starts publishing prose that the frozen input never
 * described, and the same argument applies to the timeout the lease arithmetic
 * assumes and the ceilings the packet compiler enforces.
 */

import type { ReadingGenerationOutput, ReadingGenerationRequest } from "@patternlike/shared";
import {
  SELECTION_POLICY_VERSION,
  VALIDATION_POLICY_VERSION,
} from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { readReadingV5Rollout, type ReadingV5Rollout } from "./reading-rollout.js";

// ---------------------------------------------------------------------------
// Pinned configuration
// ---------------------------------------------------------------------------

export const READING_PUBLISHER_PROVIDER = "openai" as const;

/**
 * The exact production model.
 *
 * Verified against the authorized account's model endpoint before it is allowed
 * to gate production configuration, and again for every later model change —
 * `npm run publisher:model:verify -w @patternlike/api` is that check.
 */
export const OPENAI_READING_MODEL = "gpt-5.6-sol";
export const OPENAI_READING_REASONING = "high" as const;
export const OPENAI_READING_TIMEOUT_MS = 90_000;
export const OPENAI_READING_MAX_OUTPUT_TOKENS = 4000;
export const READING_CONTEXT_MAX_BYTES = 98_304;
export const READING_PREGEN_ACTIVE_DAYS = 30;
export const READING_PREGEN_LEAD_MINUTES = 30;
export const READING_PREGEN_SPREAD_MINUTES = 45;
export const READING_SCHEDULER_BATCH_LIMIT = 100;

/** The provider endpoint. Direct, with no gateway between. */
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/**
 * The deployed prompt contract. Bump for ANY wording change.
 *
 * Lives here rather than beside the prompt so `resolvePublisherConfiguration`
 * can pin the deployed variable against it without a circular import;
 * `reading-prompt.ts` re-exports it, so every caller still reads it from there.
 */
export const READING_PROMPT_VERSION = "1.0.1";

// ---------------------------------------------------------------------------
// Frozen configuration pin
// ---------------------------------------------------------------------------

/**
 * The exact publisher configuration a claimed job must use, frozen at enqueue.
 *
 * Execution passes this to the adapter instead of rereading the environment: a
 * model or prompt change between enqueue and claim would otherwise publish
 * prose under an identity that promises different prose.
 */
export interface PublisherConfigPin {
  provider: typeof READING_PUBLISHER_PROVIDER;
  model: string;
  reasoning_effort: "low" | "medium" | "high";
  prompt_version: string;
  output_schema: "daily-reading-v5";
  selection_policy_version: string;
  validation_policy_version: string;
  max_output_tokens: number;
  context_max_bytes: number;
}

export interface PublisherConfig {
  pin: PublisherConfigPin;
  timeoutMs: number;
  dailyCallLimit: number;
  pregenActiveDays: number;
  pregenLeadMinutes: number;
  pregenSpreadMinutes: number;
  schedulerBatchLimit: number;
  apiKey: string;
}

export type PublisherConfigOutcome =
  | { ok: true; rollout: ReadingV5Rollout; config: PublisherConfig | null }
  | { ok: false; code: "reading_rollout_invalid" | "reading_publisher_misconfigured"; message: string };

// ---------------------------------------------------------------------------
// Provider result
// ---------------------------------------------------------------------------

export type PublisherFailureCode =
  | "publisher_unavailable"
  | "publisher_output_invalid"
  | "publisher_refused"
  | "publisher_auth_failed"
  | "publisher_model_unavailable";

/**
 * The closed vocabulary a failure may carry.
 *
 * No provider response text, header, URL, or exception message is ever copied
 * into a result or a log line. A metric needs to distinguish a timeout from a
 * refusal; it does not need the sentence the provider used to say so.
 */
export type PublisherSafeDetailCode =
  | "request_timeout"
  | "network_error"
  | "rate_limited"
  | "provider_5xx"
  | "authentication_failed"
  | "model_not_available"
  | "provider_refusal"
  | "max_output_tokens_exhausted"
  | "missing_output_text"
  | "multiple_output_text"
  | "invalid_json"
  | "schema_mismatch";

export interface ProviderMetadata {
  provider: typeof READING_PUBLISHER_PROVIDER;
  model: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
  /** Digest of the exact response bytes, taken before they were discarded. */
  provider_response_hash: string;
}

export type PublisherResult =
  | { ok: true; candidate: ReadingGenerationOutput; metadata: ProviderMetadata }
  | {
      ok: false;
      code: PublisherFailureCode;
      safe_detail_code: PublisherSafeDetailCode;
      retry_after_seconds: number | null;
    };

export interface PublishOptions {
  /** The Worker's own correlation id. Never sent to the provider. */
  requestId: string;
  timeoutMs: number;
  configuration: PublisherConfigPin;
}

export interface ReadingPublisher {
  publish(
    request: ReadingGenerationRequest,
    options: PublishOptions,
  ): Promise<PublisherResult>;
}

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

function misconfigured(message: string): PublisherConfigOutcome {
  return { ok: false, code: "reading_publisher_misconfigured", message };
}

/** An exact integer, or null. A float or a non-numeric string is not "close enough". */
function readInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** A value that is pinned to one number, checked whether or not it is required. */
function checkPinnedInteger(
  raw: string | undefined,
  expected: number,
  key: string,
): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = readInteger(raw);
  if (parsed === null) return `${key} must be an integer`;
  if (parsed !== expected) return `${key} must be exactly ${expected}`;
  return null;
}

/**
 * Resolve the rollout and, when it is not `off`, the complete publisher
 * configuration.
 *
 * The `off` branch is a real state rather than a half-configured one: the
 * schema-compatible deploy that lands the dual readers carries no publisher
 * variables and no key at all and must still serve every existing surface. A
 * value that IS present is validated regardless of the mode, so a typo does not
 * lie dormant until the day someone enables the feature.
 */
export function resolvePublisherConfiguration(
  env: Partial<Env>,
): PublisherConfigOutcome {
  const rollout = readReadingV5Rollout(env);
  if (rollout === null) {
    return {
      ok: false,
      code: "reading_rollout_invalid",
      message:
        "READING_V5_ROLLOUT must be one of off, internal, first_open, or hybrid",
    };
  }

  const pinned: Array<[string | undefined, number, string]> = [
    [env.OPENAI_READING_TIMEOUT_MS, OPENAI_READING_TIMEOUT_MS, "OPENAI_READING_TIMEOUT_MS"],
    [
      env.OPENAI_READING_MAX_OUTPUT_TOKENS,
      OPENAI_READING_MAX_OUTPUT_TOKENS,
      "OPENAI_READING_MAX_OUTPUT_TOKENS",
    ],
    [env.READING_CONTEXT_MAX_BYTES, READING_CONTEXT_MAX_BYTES, "READING_CONTEXT_MAX_BYTES"],
    [env.READING_PREGEN_ACTIVE_DAYS, READING_PREGEN_ACTIVE_DAYS, "READING_PREGEN_ACTIVE_DAYS"],
    [env.READING_PREGEN_LEAD_MINUTES, READING_PREGEN_LEAD_MINUTES, "READING_PREGEN_LEAD_MINUTES"],
    [
      env.READING_PREGEN_SPREAD_MINUTES,
      READING_PREGEN_SPREAD_MINUTES,
      "READING_PREGEN_SPREAD_MINUTES",
    ],
    [
      env.READING_SCHEDULER_BATCH_LIMIT,
      READING_SCHEDULER_BATCH_LIMIT,
      "READING_SCHEDULER_BATCH_LIMIT",
    ],
  ];
  for (const [raw, expected, key] of pinned) {
    const problem = checkPinnedInteger(raw, expected, key);
    if (problem) return misconfigured(problem);
  }

  const publisher = env.READING_PUBLISHER?.trim();
  if (publisher !== undefined && publisher !== "" && publisher !== READING_PUBLISHER_PROVIDER) {
    return misconfigured("READING_PUBLISHER must be openai");
  }
  const model = env.OPENAI_READING_MODEL?.trim();
  if (model !== undefined && model !== "" && model !== OPENAI_READING_MODEL) {
    return misconfigured("OPENAI_READING_MODEL must be the exact preflight-approved model");
  }
  const reasoning = env.OPENAI_READING_REASONING?.trim();
  if (reasoning !== undefined && reasoning !== "" && reasoning !== OPENAI_READING_REASONING) {
    return misconfigured("OPENAI_READING_REASONING must be high");
  }
  const callLimitRaw = env.READING_DAILY_PROVIDER_CALL_LIMIT?.trim();
  let callLimit: number | null = null;
  if (callLimitRaw !== undefined && callLimitRaw !== "") {
    callLimit = readInteger(callLimitRaw);
    if (callLimit === null) {
      return misconfigured("READING_DAILY_PROVIDER_CALL_LIMIT must be an integer");
    }
    if (callLimit < 1) {
      return misconfigured(
        "READING_DAILY_PROVIDER_CALL_LIMIT must be a positive operator-approved ceiling",
      );
    }
  }

  if (rollout === "off") return { ok: true, rollout, config: null };

  const promptVersion = env.OPENAI_READING_PROMPT_VERSION?.trim();
  // Pinned like every other member of the tuple. Presence alone was not enough:
  // the execute path demands equality with the compiled constant, and it only
  // gets there after the pending reading row is reserved and the job committed —
  // where the mismatch is `policy_unsupported`, which is terminal and NOT
  // automatically replaceable. A prompt bump that misses the deployed variable
  // would 424 every reading for every user until an operator noticed. Refusing
  // here turns that into 503 configuration_error on the first request instead.
  if (promptVersion !== undefined && promptVersion !== "" && promptVersion !== READING_PROMPT_VERSION) {
    return misconfigured(
      "OPENAI_READING_PROMPT_VERSION must be the exact compiled prompt version",
    );
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  const required: Array<[unknown, string]> = [
    [publisher, "READING_PUBLISHER"],
    [model, "OPENAI_READING_MODEL"],
    [reasoning, "OPENAI_READING_REASONING"],
    [promptVersion, "OPENAI_READING_PROMPT_VERSION"],
    [env.OPENAI_READING_TIMEOUT_MS?.trim(), "OPENAI_READING_TIMEOUT_MS"],
    [env.OPENAI_READING_MAX_OUTPUT_TOKENS?.trim(), "OPENAI_READING_MAX_OUTPUT_TOKENS"],
    [env.READING_CONTEXT_MAX_BYTES?.trim(), "READING_CONTEXT_MAX_BYTES"],
    [env.READING_PREGEN_ACTIVE_DAYS?.trim(), "READING_PREGEN_ACTIVE_DAYS"],
    [env.READING_PREGEN_LEAD_MINUTES?.trim(), "READING_PREGEN_LEAD_MINUTES"],
    [env.READING_PREGEN_SPREAD_MINUTES?.trim(), "READING_PREGEN_SPREAD_MINUTES"],
    [env.READING_SCHEDULER_BATCH_LIMIT?.trim(), "READING_SCHEDULER_BATCH_LIMIT"],
    [callLimit, "READING_DAILY_PROVIDER_CALL_LIMIT"],
    // Named, never valued: the message reaches the caller.
    [apiKey, "OPENAI_API_KEY"],
  ];
  const missing = required.filter(([value]) => value === undefined || value === null || value === "");
  if (missing.length > 0) {
    return misconfigured(
      `The reading publisher is enabled but not configured: ${missing
        .map(([, key]) => key)
        .join(", ")}`,
    );
  }

  return {
    ok: true,
    rollout,
    config: {
      pin: {
        provider: READING_PUBLISHER_PROVIDER,
        model: OPENAI_READING_MODEL,
        reasoning_effort: OPENAI_READING_REASONING,
        prompt_version: promptVersion!,
        output_schema: "daily-reading-v5",
        // Filled by the caller that freezes a command; the engine owns both
        // numbers and this pin records which ones a command was built under.
        selection_policy_version: SELECTION_POLICY_VERSION,
        validation_policy_version: VALIDATION_POLICY_VERSION,
        max_output_tokens: OPENAI_READING_MAX_OUTPUT_TOKENS,
        context_max_bytes: READING_CONTEXT_MAX_BYTES,
      },
      timeoutMs: OPENAI_READING_TIMEOUT_MS,
      dailyCallLimit: callLimit!,
      pregenActiveDays: READING_PREGEN_ACTIVE_DAYS,
      pregenLeadMinutes: READING_PREGEN_LEAD_MINUTES,
      pregenSpreadMinutes: READING_PREGEN_SPREAD_MINUTES,
      schedulerBatchLimit: READING_SCHEDULER_BATCH_LIMIT,
      apiKey: apiKey!,
    },
  };
}
