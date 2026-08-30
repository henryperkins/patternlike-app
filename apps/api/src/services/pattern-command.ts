import type { BirthTimeAccuracy } from "@patternlike/shared";
import type { Env } from "../env.js";
import { hasPatternProviderCallCapacity } from "../db/pattern-provider-usage.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";

export const PATTERN_COMMAND_VERSION_V1 = "GeneratePatternCommandV1" as const;
export const PATTERN_COMMAND_VERSION_V2 = "GeneratePatternCommandV2" as const;
export const PATTERN_COMMAND_VERSION = PATTERN_COMMAND_VERSION_V2;
export const PATTERN_JOB_TYPE = "generate_pattern" as const;

export type PatternReservationReason =
  | "first_open"
  | "first_open_retry"
  | "failed_attempt_retry"
  | "chart_correction"
  | "source_update";

export interface GeneratePatternCommandV1 {
  command_version: typeof PATTERN_COMMAND_VERSION_V1;
  schema_version: "0.7.0";
  generation_id: string;
  job_id: string;
  claim_id: string;
  user_id: string;
  chart_id: string;
  chart_fingerprint: string;
  chart_fingerprint_hash: string;
  profile_version: number;
  calc_contract_id: string;
  calc_contract_version: string;
  feature_set_id: string;
  feature_set_hash: string;
  feature_policy_version: string;
  selection_policy_id: "pattern-selection-policy";
  selection_policy_version: "1.0.0";
  locale: string;
  locale_revision: number;
  consent_id: string;
  consent_policy_version: string;
  ontology_version: string;
  ontology_bundle_hash: string;
  corpus_release_hash: string;
  reservation_reason: PatternReservationReason;
  publisher: PatternPublisherPin;
  /**
   * Inclusive provider-call ceiling for the planner pass across this job.
   * `planner_attempts` is the zero-based NEXT-attempt index checked before call.
   */
  planner_attempts_max: 2;
  /**
   * Inclusive writer-call ceiling across one job and its frozen plan.
   * `writer_attempts` is the zero-based NEXT-attempt index checked before call.
   */
  writer_attempts_max: 2 | 3;
  /**
   * Inclusive verifier-call ceiling per candidate, reset on candidate entry.
   * `verifier_attempts` is the zero-based NEXT-attempt index checked before call.
   */
  verifier_attempts_max: 2;
  artifact_retention_days: number;
}

export interface GeneratePatternCommandV2
  extends Omit<GeneratePatternCommandV1, "command_version" | "schema_version"> {
  command_version: typeof PATTERN_COMMAND_VERSION_V2;
  schema_version: "0.9.0";
  pattern_source_hash: string;
}

export type GeneratePatternCommand = GeneratePatternCommandV1 | GeneratePatternCommandV2;

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;

export function isPatternCommand(value: unknown): value is GeneratePatternCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as {
    command_version?: unknown;
    schema_version?: unknown;
    pattern_source_hash?: unknown;
    planner_attempts_max?: unknown;
    writer_attempts_max?: unknown;
    verifier_attempts_max?: unknown;
  };
  const sharedShape =
    record.planner_attempts_max === 2 &&
    (record.writer_attempts_max === 2 || record.writer_attempts_max === 3) &&
    record.verifier_attempts_max === 2;
  if (!sharedShape) return false;
  if (record.command_version === PATTERN_COMMAND_VERSION_V1) {
    return record.schema_version === "0.7.0";
  }
  return record.command_version === PATTERN_COMMAND_VERSION_V2 &&
    record.schema_version === "0.9.0" &&
    typeof record.pattern_source_hash === "string" &&
    CONTENT_HASH.test(record.pattern_source_hash);
}

/** Budget failures are retryable only when the current shared ledger has room. */
export async function patternFailureIsRetryable(
  env: Env,
  failureClass: string | null,
  now = new Date(),
): Promise<boolean> {
  if (failureClass !== "publisher_budget_exhausted") return true;
  return hasPatternProviderCallCapacity(env, now);
}

export type { BirthTimeAccuracy };
