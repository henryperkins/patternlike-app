/**
 * Pattern publisher configuration pins.
 *
 * Conservative launch defaults (spec §25 left exact figures to operators):
 * 120s timeouts, planner 4000 / writer 8000 / verifier 4000 tokens, 100 UTC-day
 * provider calls, 98_304 input bytes, 30-day artifact retention. The verifier
 * prompt version is deliberately not the writer prompt version.
 */

import type { Env } from "../env.js";
import { resolveAiGatewayRoute } from "./reading-publisher.js";
import type {
  PatternPlan,
  PatternSemanticVerdict,
  PatternWriterOutput,
} from "@patternlike/shared";
import type {
  PublisherFailureCode,
  PublisherSafeDetailCode,
} from "./openai-responses-adapter.js";
import { CODEX_PROVIDER_TIMEOUT_MS } from "./codex-provider-contract.js";

export const PATTERN_PUBLISHER_OPENAI = "openai" as const;
export const PATTERN_PUBLISHER_SYNTHETIC = "synthetic" as const;
/**
 * The Codex Responses backend on a ChatGPT subscription.
 *
 * A real provider, not a stand-in: a constrained model authors the prose, so
 * unlike `synthetic` this is permitted outside development. It is a distinct
 * publisher rather than an OpenAI credential mode because the document must be
 * able to say truthfully who wrote it -- see `provenanceFromExecutedPin`.
 */
export const PATTERN_PUBLISHER_CODEX = "codex" as const;
/**
 * The retired Cloudflare Workers AI publisher.
 *
 * Kept as a name only. No adapter, no binding, and no configuration can select
 * it, but `patternProviderDisplayName` still has to label provenance stored
 * while it existed.
 */
export const PATTERN_PUBLISHER_WORKERS_AI = "workers_ai" as const;

export const OPENAI_PATTERN_PLANNER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_PLANNER_REASONING = "xhigh" as const;
/**
 * `1.0.1` adds `PLAN_CLOSURE_RULES` -- the closure properties
 * `validatePatternPlan` enforces -- to the planner policy. See the comment
 * above `PLAN_CLOSURE_RULES` in `pattern-prompt.ts`.
 */
export const OPENAI_PATTERN_PLANNER_PROMPT_VERSION = "1.0.1";
export const OPENAI_PATTERN_PLANNER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS = 32000;

export const OPENAI_PATTERN_WRITER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_WRITER_REASONING = "xhigh" as const;
/**
 * `1.0.2` adds the warm, direct, emotionally attentive voice contract while
 * keeping emotion traceable to authorized material. See `WRITER_POLICY` in
 * `pattern-prompt.ts`; the pin moves with the text because provenance that
 * names one version for two different prompts is provenance that proves
 * nothing.
 */
export const OPENAI_PATTERN_WRITER_PROMPT_VERSION = "1.0.2";
export const OPENAI_PATTERN_WRITER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS = 32000;

export const OPENAI_PATTERN_VERIFIER_MODEL = "gpt-5.6-sol";
export const OPENAI_PATTERN_VERIFIER_REASONING = "xhigh" as const;
export const OPENAI_PATTERN_VERIFIER_PROMPT_VERSION = "1.0.0-verifier";
export const OPENAI_PATTERN_VERIFIER_TIMEOUT_MS = 120_000;
export const OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS = 32000;

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

export type PatternPublisherName =
  | typeof PATTERN_PUBLISHER_OPENAI
  | typeof PATTERN_PUBLISHER_SYNTHETIC
  | typeof PATTERN_PUBLISHER_CODEX
  | typeof PATTERN_PUBLISHER_WORKERS_AI;

/**
 * The reader-facing provider label for a publisher.
 *
 * One definition on purpose. Two places publish this string -- the executed pin
 * in `pattern-execute.ts` and the ontology regression projection in
 * `ontology-regression.ts` -- and the second was a hand-copied
 * `provider === "openai" ? "OpenAI" : "synthetic"`, which labelled every Codex
 * pass "synthetic" for the whole internal Codex canary. A duplicated mapping is
 * the defect; the labels belong here.
 */
export function patternProviderDisplayName(
  publisher: PatternPublisherName,
): string {
  if (publisher === PATTERN_PUBLISHER_WORKERS_AI) return "Cloudflare Workers AI";
  if (publisher === PATTERN_PUBLISHER_CODEX) return "Codex";
  if (publisher === PATTERN_PUBLISHER_OPENAI) return "OpenAI";
  return "synthetic";
}

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
  planner_reasoning: "high" | "xhigh";
  planner_prompt_version: string;
  planner_max_output_tokens: number;
  writer_model: string;
  writer_reasoning: "high" | "xhigh";
  writer_prompt_version: string;
  writer_max_output_tokens: number;
  verifier_model: string;
  verifier_reasoning: "high" | "xhigh";
  verifier_prompt_version: string;
  verifier_max_output_tokens: number;
  input_max_bytes: number;
  selection_policy_version: "1.0.0";
  validation_policy_version: "1.0.0";
}

/**
 * The one deployable Pattern publisher configuration.
 *
 * There is no credential, key, or gateway route here on purpose: Pattern
 * reaches its model through the durable Codex runner, and this Worker holds no
 * provider credential for it. A field for one would be a place for a deployment
 * to grow a second transport.
 */
export interface PatternPublisherConfig {
  pin: PatternPublisherPin & { publisher: typeof PATTERN_PUBLISHER_CODEX };
  plannerTimeoutMs: typeof CODEX_PROVIDER_TIMEOUT_MS;
  writerTimeoutMs: typeof CODEX_PROVIDER_TIMEOUT_MS;
  verifierTimeoutMs: typeof CODEX_PROVIDER_TIMEOUT_MS;
  dailyCallLimit: number;
  artifactRetentionDays: typeof PATTERN_ARTIFACT_RETENTION_DAYS;
}

/**
 * Complete, or a refusal. There is no third state.
 *
 * A configuration that names no publisher is not "Pattern is off for now" --
 * that was the rollout, and the rollout is gone. It is a deployment that cannot
 * run the product, which `checkSecureConfig` turns into a refusal on every
 * request rather than into a silent per-account outcome.
 */
export type PatternPublisherConfigOutcome =
  | { ok: true; config: PatternPublisherConfig }
  | { ok: false; code: "pattern_publisher_misconfigured"; message: string };

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

function requiredInteger(
  raw: string | undefined,
  expected: number,
  key: string,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return `${key} is required`;
  const parsed = readInteger(trimmed);
  if (parsed === null) return `${key} must be an integer`;
  if (parsed !== expected) return `${key} must be exactly ${expected}`;
  return null;
}

function requiredString(
  raw: string | undefined,
  expected: string,
  key: string,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return `${key} is required`;
  if (trimmed !== expected) return `${key} must be ${expected}`;
  return null;
}

/**
 * Validate every operator-set Pattern value, and nothing else.
 *
 * Separate from `resolvePatternPublisherConfiguration` because a BINDING is not
 * a value. `checkSecureConfig` runs this on every request and inside `queue()`,
 * where reading `env.ARTIFACTS` would be an access rather than a check — an
 * ontology delivery paused before R2 must stay paused before R2. Whether the
 * bucket is bound is settled where the publisher is actually built.
 *
 * Every value is compared for EQUALITY against its compiled constant and every
 * value is required, because a frozen command records the configuration it was
 * built under: a deployed variable that drifts from the code would reach the
 * runner describing something no command actually pinned, and an absent one
 * would let a default stand in for an operator decision.
 */
export function checkPatternPublisherValues(
  env: Partial<Env>,
): { code: "pattern_publisher_misconfigured"; message: string } | null {
  const outcome = resolvePatternPublisherValues(env);
  return outcome.ok ? null : { code: outcome.code, message: outcome.message };
}

function resolvePatternPublisherValues(
  env: Partial<Env>,
): PatternPublisherConfigOutcome {
  if (env.PATTERN_PUBLISHER?.trim() !== PATTERN_PUBLISHER_CODEX) {
    return misconfigured(
      "PATTERN_PUBLISHER must be codex; Pattern generation has no other deployable publisher",
    );
  }

  const integerPins: Array<[string | undefined, number, string]> = [
    [env.OPENAI_PATTERN_PLANNER_TIMEOUT_MS, CODEX_PROVIDER_TIMEOUT_MS, "OPENAI_PATTERN_PLANNER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS"],
    [env.OPENAI_PATTERN_WRITER_TIMEOUT_MS, CODEX_PROVIDER_TIMEOUT_MS, "OPENAI_PATTERN_WRITER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS"],
    [env.OPENAI_PATTERN_VERIFIER_TIMEOUT_MS, CODEX_PROVIDER_TIMEOUT_MS, "OPENAI_PATTERN_VERIFIER_TIMEOUT_MS"],
    [env.OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS, OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS, "OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS"],
    [env.PATTERN_INPUT_MAX_BYTES, PATTERN_INPUT_MAX_BYTES, "PATTERN_INPUT_MAX_BYTES"],
    [env.PATTERN_ARTIFACT_RETENTION_DAYS, PATTERN_ARTIFACT_RETENTION_DAYS, "PATTERN_ARTIFACT_RETENTION_DAYS"],
  ];
  for (const [raw, expected, key] of integerPins) {
    const problem = requiredInteger(raw, expected, key);
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
    const problem = requiredString(raw, expected, key);
    if (problem) return misconfigured(problem);
  }

  const callLimit = readInteger(env.PATTERN_DAILY_PROVIDER_CALL_LIMIT?.trim() ?? "");
  if (callLimit === null || callLimit < 1) {
    return misconfigured("PATTERN_DAILY_PROVIDER_CALL_LIMIT must be a positive integer");
  }

  // Section 14.2: the verifier configuration must not be identical to the
  // writer's, and at minimum (provider, model, prompt_version) must differ.
  // Checked against the compiled constants, because the environment values are
  // already pinned to them: what this guards is a source edit making the two
  // literals equal, after which one model configuration is sole author and
  // judge of the same prose with every pin check still passing.
  const independence = verifierIndependenceProblem(
    OPENAI_PATTERN_WRITER_MODEL,
    OPENAI_PATTERN_WRITER_PROMPT_VERSION,
    OPENAI_PATTERN_VERIFIER_MODEL,
    OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  );
  if (independence) return misconfigured(independence);

  const runnerToken = env.CODEX_RUNNER_TOKEN?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{32,512}$/.test(runnerToken)) {
    return misconfigured("CODEX_RUNNER_TOKEN is required when PATTERN_PUBLISHER=codex");
  }
  if ((env.CODEX_PROVIDER_ARTIFACT_KEYRING?.trim() ?? "") === "") {
    return misconfigured(
      "CODEX_PROVIDER_ARTIFACT_KEYRING is required when PATTERN_PUBLISHER=codex",
    );
  }
  // AI Gateway config names the OpenAI transport. Refuse the ambiguous
  // combination instead of implying the outbound runner uses that route.
  const gateway = resolveAiGatewayRoute(env);
  if (!gateway.ok) return misconfigured(gateway.message);
  if (gateway.route !== null) {
    return misconfigured("PATTERN_PUBLISHER=codex cannot be routed through AI Gateway");
  }

  return {
    ok: true,
    config: {
      pin: {
        publisher: PATTERN_PUBLISHER_CODEX,
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
      },
      plannerTimeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
      writerTimeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
      verifierTimeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
      dailyCallLimit: callLimit,
      artifactRetentionDays: PATTERN_ARTIFACT_RETENTION_DAYS,
    },
  };
}

/**
 * The complete deployable configuration, values and bindings.
 *
 * Used where a publisher is about to be built or a provider job owned. An
 * unbound `ARTIFACTS` refuses here rather than in `checkSecureConfig`, so a
 * Worker whose bucket is missing still serves every surface that does not need
 * one — which is how `object_storage_not_configured` already behaves.
 */
export function resolvePatternPublisherConfiguration(
  env: Partial<Env>,
): PatternPublisherConfigOutcome {
  const values = resolvePatternPublisherValues(env);
  if (!values.ok) return values;
  if (!env.ARTIFACTS) {
    return misconfigured("ARTIFACTS is required when PATTERN_PUBLISHER=codex");
  }
  return values;
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
  /** Immutable domain coordinate used only by the asynchronous Codex provider. */
  codexJob?: {
    pipeline: "pattern" | "ontology";
    ownerId: string;
    userId: string | null;
    stageGeneration: number;
    stageAttempt: number;
    dailyCallLimit: number;
  };
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
      code: "publisher_pending";
      job_id: string;
      safe_detail_code?: never;
      retry_after_seconds?: never;
      origin_layer?: never;
    }
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
