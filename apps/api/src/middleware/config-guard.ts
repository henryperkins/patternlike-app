import type { Context, Next } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";
import { DEV_ROOT_KEK, isDevEnvironment } from "../crypto.js";
import { resolvePublisherConfiguration } from "../services/reading-publisher.js";
import { resolveCheckInRetentionMonths } from "../services/check-in-retention.js";
import { safeLog, type ConfigurationCode } from "../services/safe-log.js";
import { resolvePatternPublisherConfiguration } from "../services/pattern-publisher.js";
import { resolveTimeTravelConfiguration } from "../services/time-travel-config.js";
import {
  resolveAiGatewayRoute,
  resolveProviderCredentialMode,
  type AiGatewayRoute,
  type ProviderCredentialMode,
} from "../services/reading-publisher.js";

export const ONTOLOGY_PIPELINE_ROLLOUT_MODES = ["off", "internal"] as const;
export type OntologyPipelineRollout = (typeof ONTOLOGY_PIPELINE_ROLLOUT_MODES)[number];

export const OPENAI_ONTOLOGY_GENERATOR_MODEL = "gpt-5.6-sol";
export const OPENAI_ONTOLOGY_GENERATOR_REASONING = "high" as const;
export const OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION = "1.0.5";
export const OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS = 120_000;
export const OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS = 8000;

export const OPENAI_ONTOLOGY_EVALUATOR_MODEL = "gpt-5.6-sol";
export const OPENAI_ONTOLOGY_EVALUATOR_REASONING = "high" as const;
export const OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION = "1.0.0-evaluator";
export const OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS = 120_000;
export const OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS = 4000;

export const ONTOLOGY_PIPELINE_INPUT_MAX_BYTES = 98_304;
export const ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = 500;
export const ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS = 7;
export const ONTOLOGY_PIPELINE_DEFAULT_REGRESSION_MINIMUM_PASS_RATE = 0.9;
export const ONTOLOGY_PIPELINE_EQUAL_MODEL_REGRESSION_MINIMUM_PASS_RATE = 1;

export interface OntologyPipelineConfigPin {
  generator_model: string;
  generator_reasoning: "high";
  generator_prompt_version: string;
  generator_max_output_tokens: number;
  evaluator_model: string;
  evaluator_reasoning: "high";
  evaluator_prompt_version: string;
  evaluator_max_output_tokens: number;
  input_max_bytes: number;
}

export interface OntologyPipelineConfiguration {
  pin: OntologyPipelineConfigPin;
  generatorTimeoutMs: number;
  evaluatorTimeoutMs: number;
  dailyProviderCallLimit: number;
  failedArtifactRetentionDays: number;
  /** True only with an explicit acknowledgement, and raises the frozen threshold. */
  configurationEqual: boolean;
  regressionMinimumPassRate: number;
  gatewayRoute: AiGatewayRoute | null;
  credential: ProviderCredentialMode;
}

export type OntologyPipelineConfigurationOutcome =
  | { ok: true; rollout: OntologyPipelineRollout; config: OntologyPipelineConfiguration | null }
  | {
      ok: false;
      code: "ontology_pipeline_rollout_invalid" | "ontology_pipeline_misconfigured";
      message: string;
    };

function ontologyPipelineMisconfigured(message: string): OntologyPipelineConfigurationOutcome {
  return { ok: false, code: "ontology_pipeline_misconfigured", message };
}

function readPipelineInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function checkPipelinePinnedInteger(
  raw: string | undefined,
  expected: number,
  key: string,
): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = readPipelineInteger(raw);
  if (parsed === null) return `${key} must be an integer`;
  if (parsed !== expected) return `${key} must be exactly ${expected}`;
  return null;
}

function checkPipelinePinnedString(
  raw: string | undefined,
  expected: string,
  key: string,
): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (raw.trim() !== expected) return `${key} must be ${expected}`;
  return null;
}

/**
 * Resolve the separately pinned machine-ontology pipeline configuration.
 *
 * A configured typo is rejected while rollout is off; otherwise enablement
 * could turn a dormant typo into a provider call after a run has been reserved.
 * Off itself intentionally has no runnable configuration.
 */
export function resolveOntologyPipelineConfiguration(
  env: Partial<Env>,
): OntologyPipelineConfigurationOutcome {
  const rolloutRaw = env.ONTOLOGY_PIPELINE_ROLLOUT?.trim() ?? "";
  if (
    rolloutRaw !== "" &&
    rolloutRaw !== "off" &&
    rolloutRaw !== "internal"
  ) {
    return {
      ok: false,
      code: "ontology_pipeline_rollout_invalid",
      message: "ONTOLOGY_PIPELINE_ROLLOUT must be off or internal",
    };
  }
  const rollout: OntologyPipelineRollout = rolloutRaw === "internal" ? "internal" : "off";

  const integerPins: Array<[string | undefined, number, string]> = [
    [
      env.OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS,
      OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS,
      "OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS,
      OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS,
      "OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS,
      OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS,
      "OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS,
      OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS,
      "OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS",
    ],
    [
      env.ONTOLOGY_PIPELINE_INPUT_MAX_BYTES,
      ONTOLOGY_PIPELINE_INPUT_MAX_BYTES,
      "ONTOLOGY_PIPELINE_INPUT_MAX_BYTES",
    ],
    [
      env.ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS,
      ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS,
      "ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS",
    ],
  ];
  for (const [raw, expected, key] of integerPins) {
    const problem = checkPipelinePinnedInteger(raw, expected, key);
    if (problem) return ontologyPipelineMisconfigured(problem);
  }

  const stringPins: Array<[string | undefined, string, string]> = [
    [
      env.OPENAI_ONTOLOGY_GENERATOR_MODEL,
      OPENAI_ONTOLOGY_GENERATOR_MODEL,
      "OPENAI_ONTOLOGY_GENERATOR_MODEL",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_REASONING,
      OPENAI_ONTOLOGY_GENERATOR_REASONING,
      "OPENAI_ONTOLOGY_GENERATOR_REASONING",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
      OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
      "OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_MODEL,
      OPENAI_ONTOLOGY_EVALUATOR_MODEL,
      "OPENAI_ONTOLOGY_EVALUATOR_MODEL",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_REASONING,
      OPENAI_ONTOLOGY_EVALUATOR_REASONING,
      "OPENAI_ONTOLOGY_EVALUATOR_REASONING",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION,
      OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION,
      "OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION",
    ],
  ];
  for (const [raw, expected, key] of stringPins) {
    const problem = checkPipelinePinnedString(raw, expected, key);
    if (problem) return ontologyPipelineMisconfigured(problem);
  }

  const dailyLimitRaw = env.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT?.trim();
  let dailyProviderCallLimit: number | null = null;
  if (dailyLimitRaw) {
    dailyProviderCallLimit = readPipelineInteger(dailyLimitRaw);
    if (dailyProviderCallLimit === null || dailyProviderCallLimit < 1) {
      return ontologyPipelineMisconfigured(
        "ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT must be a positive integer",
      );
    }
  }

  // String() preserves this check if a future compiled pin stops being a
  // literal. The comparison is intentionally runtime-visible: equal pins are
  // permitted only with the acknowledgement below and a stricter command.
  const equalModels =
    String(OPENAI_ONTOLOGY_GENERATOR_MODEL) === String(OPENAI_ONTOLOGY_EVALUATOR_MODEL);
  const equalModelsAcknowledgement = env.ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS?.trim();
  if (
    equalModelsAcknowledgement !== undefined &&
    equalModelsAcknowledgement !== "" &&
    equalModelsAcknowledgement !== "1"
  ) {
    return ontologyPipelineMisconfigured(
      "ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS must be 1 when set",
    );
  }

  if (
    String(OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION) ===
    String(OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION)
  ) {
    return ontologyPipelineMisconfigured(
      "OPENAI ontology generator and evaluator prompt versions must differ",
    );
  }

  const gateway = resolveAiGatewayRoute(env);
  if (!gateway.ok) return ontologyPipelineMisconfigured(gateway.message);

  if (rollout === "off") return { ok: true, rollout, config: null };

  const required: Array<[string | number | null | undefined, string]> = [
    [
      env.OPENAI_ONTOLOGY_GENERATOR_MODEL?.trim(),
      "OPENAI_ONTOLOGY_GENERATOR_MODEL",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_REASONING?.trim(),
      "OPENAI_ONTOLOGY_GENERATOR_REASONING",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION?.trim(),
      "OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS?.trim(),
      "OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS",
    ],
    [
      env.OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS?.trim(),
      "OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_MODEL?.trim(),
      "OPENAI_ONTOLOGY_EVALUATOR_MODEL",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_REASONING?.trim(),
      "OPENAI_ONTOLOGY_EVALUATOR_REASONING",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION?.trim(),
      "OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS?.trim(),
      "OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS",
    ],
    [
      env.OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS?.trim(),
      "OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS",
    ],
    [
      env.ONTOLOGY_PIPELINE_INPUT_MAX_BYTES?.trim(),
      "ONTOLOGY_PIPELINE_INPUT_MAX_BYTES",
    ],
    [dailyProviderCallLimit, "ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT"],
    [
      env.ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS?.trim(),
      "ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS",
    ],
  ];
  if (equalModels && equalModelsAcknowledgement !== "1") {
    return ontologyPipelineMisconfigured(
      "ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS=1 is required while model pins are equal",
    );
  }
  const credential = resolveProviderCredentialMode(env, gateway.route);
  if (!credential.ok) return ontologyPipelineMisconfigured(credential.message);
  const missing = required.filter(([value]) => value === undefined || value === null || value === "");
  if (missing.length > 0) {
    return ontologyPipelineMisconfigured(
      `The ontology pipeline is enabled but not configured: ${missing.map(([, key]) => key).join(", ")}`,
    );
  }

  return {
    ok: true,
    rollout,
    config: {
      pin: {
        generator_model: OPENAI_ONTOLOGY_GENERATOR_MODEL,
        generator_reasoning: OPENAI_ONTOLOGY_GENERATOR_REASONING,
        generator_prompt_version: OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
        generator_max_output_tokens: OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS,
        evaluator_model: OPENAI_ONTOLOGY_EVALUATOR_MODEL,
        evaluator_reasoning: OPENAI_ONTOLOGY_EVALUATOR_REASONING,
        evaluator_prompt_version: OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION,
        evaluator_max_output_tokens: OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS,
        input_max_bytes: ONTOLOGY_PIPELINE_INPUT_MAX_BYTES,
      },
      generatorTimeoutMs: OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS,
      evaluatorTimeoutMs: OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS,
      dailyProviderCallLimit: dailyProviderCallLimit!,
      failedArtifactRetentionDays: ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS,
      configurationEqual: equalModels,
      regressionMinimumPassRate: equalModels
        ? ONTOLOGY_PIPELINE_EQUAL_MODEL_REGRESSION_MINIMUM_PASS_RATE
        : ONTOLOGY_PIPELINE_DEFAULT_REGRESSION_MINIMUM_PASS_RATE,
      gatewayRoute: gateway.route,
      credential: credential.mode,
    },
  };
}

export interface ConfigFailure {
  /**
   * Shared with the log union deliberately: a code the guard can produce but
   * safeLog cannot name would be a 503 with no record of why.
   */
  code: ConfigurationCode;
  message: string;
}

/**
 * Refuse to serve on a development-shaped configuration in a non-development
 * environment.
 *
 * Workers have no startup hook with access to bindings, so the closest thing to
 * "fail startup" is refusing every request. Cheap enough to run per request.
 *
 * This is the backstop for two review findings: AUTH_STUB="1" sits in the only
 * [vars] block in wrangler.toml with no production override, so a bare
 * `wrangler deploy` published a Worker whose auth middleware trusts an
 * unauthenticated X-User-Id header; and ROOT_KEK silently defaulted to a string
 * committed in this repository.
 */
/**
 * The identity placeholder shipped in wrangler.toml. `.invalid` is reserved and
 * can never resolve, so it is safe to ship and unusable in production.
 */
export const PLACEHOLDER_OIDC_HOST = "issuer.invalid";

export function checkSecureConfig(
  env:
    | Pick<
        Env,
        | "ENVIRONMENT"
        | "AUTH_STUB"
        | "ROOT_KEK"
        | "OIDC_ISSUER"
        | "OIDC_AUDIENCE"
        | "OIDC_JWKS_URL"
        | "CHECK_IN_RETENTION_MONTHS"
        | "TIME_TRAVEL_RECEIPT_EPOCH"
        | "TIME_TRAVEL_DAILY_SCAN_LIMIT"
      >
    | Partial<Env>,
): ConfigFailure | null {
  const checkInRetention = resolveCheckInRetentionMonths(
    env.CHECK_IN_RETENTION_MONTHS,
  );
  if (!checkInRetention.ok) {
    return {
      code: "check_in_retention_misconfigured",
      message: "CHECK_IN_RETENTION_MONTHS must be an integer from 1 through 13",
    };
  }

  // Before the development short-circuit, deliberately. The local canary runs
  // with ENVIRONMENT=development and a real key, so a half-configured local run
  // would otherwise reach a provider with values no frozen command described.
  // While the rollout is off this costs nothing: every publisher value may be
  // absent, and only a value that is PRESENT and malformed is rejected.
  const publisher = resolvePublisherConfiguration(env);
  if (!publisher.ok) {
    return { code: publisher.code, message: publisher.message };
  }

  const patternPublisher = resolvePatternPublisherConfiguration(env);
  if (!patternPublisher.ok) {
    return { code: patternPublisher.code, message: patternPublisher.message };
  }

  const ontologyPipeline = resolveOntologyPipelineConfiguration(env);
  if (!ontologyPipeline.ok) {
    return { code: ontologyPipeline.code, message: ontologyPipeline.message };
  }

  if (isDevEnvironment(env.ENVIRONMENT)) {
    // Unit callers that exercise unrelated config rules may omit the M4 pair,
    // but a real local Worker declares both. If either is present, the pair is
    // validated exactly as production is.
    if (env.TIME_TRAVEL_RECEIPT_EPOCH !== undefined || env.TIME_TRAVEL_DAILY_SCAN_LIMIT !== undefined) {
      const timeTravel = resolveTimeTravelConfiguration(env);
      if (!timeTravel.ok) return { code: "time_travel_misconfigured", message: timeTravel.message };
    }
    return null;
  }

  if (env.AUTH_STUB === "1") {
    return {
      code: "auth_stub_in_production",
      message:
        "AUTH_STUB=1 trusts an unauthenticated X-User-Id header and must not be set outside development",
    };
  }
  const kek = env.ROOT_KEK?.trim();
  if (!kek || kek === DEV_ROOT_KEK) {
    return {
      code: "root_kek_not_configured",
      message: "ROOT_KEK must be configured with a real secret outside development",
    };
  }

  // Identity is not optional outside development. Without these the verifier
  // fails per request as an opaque 401; a deploy that forgot a value should
  // fail loudly at the guard instead.
  //
  // The placeholder check matters as much as the presence check: wrangler.toml
  // ships issuer.invalid so the Env interface is satisfied locally, and a
  // deploy that never replaced it would otherwise sail past a presence-only
  // guard. This mirrors how ROOT_KEK rejects its own committed placeholder.
  const identityKeys = ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"] as const;
  const unusable = identityKeys.filter((k) => {
    const value = env[k]?.trim();
    return !value || value.includes(PLACEHOLDER_OIDC_HOST);
  });
  if (unusable.length > 0) {
    return {
      code: "identity_not_configured",
      message:
        "Identity provider configuration is incomplete; the API cannot authenticate anyone",
    };
  }
  const timeTravel = resolveTimeTravelConfiguration(env);
  if (!timeTravel.ok) {
    return { code: "time_travel_misconfigured", message: timeTravel.message };
  }
  return null;
}

export async function configGuard(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const failure = checkSecureConfig(c.env);
  if (failure) {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    // The specific code goes to logs, not to the client: which secret is
    // missing is not something an unauthenticated caller needs to learn.
    safeLog({ event: "insecure_configuration", config_code: failure.code });
    return c.json(
      {
        error: {
          code: "configuration_error",
          message: failure.message,
          request_id: requestId,
        },
      },
      503,
    );
  }
  await next();
}
