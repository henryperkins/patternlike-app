import type { PublisherSafeDetailCode } from "./reading-publisher.js";

export const RETRY_DELAY_SECONDS = 60;
export const LEASE_RETRY_DELAY_SECONDS = 305;
export const MAX_JOB_ATTEMPTS = 4;
export const MAX_COMMAND_GENERATION = 3;

export type V1FailureCode =
  | "calc_unavailable"
  | "release_unreadable"
  | "policy_unsupported"
  | "chart_missing"
  | "release_hash_mismatch"
  | "cycle_missing"
  | "cycle_hash_mismatch"
  | "consent_revoked"
  | "assembly_id_mismatch"
  | "assembly_failed"
  | "publication_failed";

export type V5FailureCode =
  | "calc_unavailable"
  | "daily_sky_unavailable"
  | "publisher_unavailable"
  | "publisher_output_invalid"
  | "publisher_refused"
  | "publisher_budget_exhausted"
  | "publisher_not_configured"
  | "publisher_auth_failed"
  | "publisher_model_unavailable"
  | "ai_synthesis_consent_required"
  | "context_ineligible"
  | "generation_input_id_mismatch"
  | "policy_unsupported";

export type GenerationFailureCode = V1FailureCode | V5FailureCode;

export type GenerationSafeDetailCode =
  | PublisherSafeDetailCode
  | "execution_window_exhausted"
  | "calculation_transport_unavailable"
  | "calculation_policy_refused"
  | "provider_budget_exhausted"
  | "publisher_not_configured"
  | "consent_not_active"
  | "context_not_eligible"
  | "input_integrity_mismatch";

export type V5ReplacementReason =
  | "calc_unavailable"
  | "daily_sky_unavailable"
  | "publisher_unavailable"
  | "publisher_output_invalid"
  | "publisher_refused"
  | "consent_regranted";

export type V1ReplacementReason =
  | "calc_unavailable"
  | "release_unreadable"
  | "context_minimized"
  | "policy_upgraded"
  | "defect_repair";

export type GenerationReplacementReason = V1ReplacementReason | V5ReplacementReason;

const V1_FAILURE_CODES: ReadonlySet<V1FailureCode> = new Set([
  "calc_unavailable",
  "release_unreadable",
  "policy_unsupported",
  "chart_missing",
  "release_hash_mismatch",
  "cycle_missing",
  "cycle_hash_mismatch",
  "consent_revoked",
  "assembly_id_mismatch",
  "assembly_failed",
  "publication_failed",
]);

const V5_FAILURE_CODES: ReadonlySet<V5FailureCode> = new Set([
  "calc_unavailable",
  "daily_sky_unavailable",
  "publisher_unavailable",
  "publisher_output_invalid",
  "publisher_refused",
  "publisher_budget_exhausted",
  "publisher_not_configured",
  "publisher_auth_failed",
  "publisher_model_unavailable",
  "ai_synthesis_consent_required",
  "context_ineligible",
  "generation_input_id_mismatch",
  "policy_unsupported",
]);

const V1_REPLACEMENT_REASONS: ReadonlySet<V1ReplacementReason> = new Set([
  "calc_unavailable",
  "release_unreadable",
  "context_minimized",
  "policy_upgraded",
  "defect_repair",
]);

const V5_REPLACEMENT_REASONS: ReadonlySet<V5ReplacementReason> = new Set([
  "calc_unavailable",
  "daily_sky_unavailable",
  "publisher_unavailable",
  "publisher_output_invalid",
  "publisher_refused",
  "consent_regranted",
]);

const V1_AUTOMATIC_REPLACEMENT_FAILURES: ReadonlySet<V1FailureCode> = new Set([
  "calc_unavailable",
  "release_unreadable",
]);

const V5_AUTOMATIC_REPLACEMENT_FAILURES: ReadonlySet<V5FailureCode> = new Set([
  "calc_unavailable",
  "daily_sky_unavailable",
  "publisher_unavailable",
  "publisher_output_invalid",
  "publisher_refused",
]);

export function isGenerationFailureCode(code: string): code is GenerationFailureCode {
  return V1_FAILURE_CODES.has(code as V1FailureCode) || V5_FAILURE_CODES.has(code as V5FailureCode);
}

export function isV1ReplacementReason(code: string): code is V1ReplacementReason {
  return V1_REPLACEMENT_REASONS.has(code as V1ReplacementReason);
}

export function isV5ReplacementReason(code: string): code is V5ReplacementReason {
  return V5_REPLACEMENT_REASONS.has(code as V5ReplacementReason);
}

export function isGenerationReplacementReason(code: string): code is GenerationReplacementReason {
  return isV1ReplacementReason(code) || isV5ReplacementReason(code);
}

export function queueDisposition(
  commandVersion: "v1" | "v2",
  code: GenerationFailureCode,
  attempts: number,
): "retry_60s" | "terminal" {
  if (attempts >= MAX_JOB_ATTEMPTS) return "terminal";
  if (commandVersion === "v1") {
    return code === "calc_unavailable" || code === "release_unreadable"
      ? "retry_60s"
      : "terminal";
  }
  if (
    code === "calc_unavailable" ||
    code === "daily_sky_unavailable" ||
    code === "publisher_unavailable"
  ) {
    return "retry_60s";
  }
  return (code === "publisher_output_invalid" || code === "publisher_refused") && attempts === 1
    ? "retry_60s"
    : "terminal";
}

export function leaseDisposition(
  attempts: number,
  remainingMs: number,
  providerTimeoutMs: number,
): "continue" | "lease_retry_305s" | "terminal_calc_unavailable" {
  if (remainingMs >= providerTimeoutMs + 60_000) return "continue";
  return attempts >= MAX_JOB_ATTEMPTS ? "terminal_calc_unavailable" : "lease_retry_305s";
}

export function isAutomaticReplacementFailure(
  commandVersion: "v1" | "v2",
  code: GenerationFailureCode,
): boolean {
  return commandVersion === "v1"
    ? V1_AUTOMATIC_REPLACEMENT_FAILURES.has(code as V1FailureCode)
    : V5_AUTOMATIC_REPLACEMENT_FAILURES.has(code as V5FailureCode);
}
