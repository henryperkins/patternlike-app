import type { BirthTimeAccuracy } from "@patternlike/shared";
import type { PatternPublisherPin } from "./pattern-publisher.js";

export const PATTERN_COMMAND_VERSION = "GeneratePatternCommandV1" as const;
export const PATTERN_JOB_TYPE = "generate_pattern" as const;

export type PatternReservationReason =
  | "first_open"
  | "first_open_retry"
  | "failed_attempt_retry"
  | "chart_correction";

export type PatternDomainStage =
  | "reserved"
  | "planning"
  | "plan_validating"
  | "writing"
  | "candidate_validating"
  | "semantic_verifying"
  | "publishing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GeneratePatternCommandV1 {
  command_version: typeof PATTERN_COMMAND_VERSION;
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

export function isPatternCommand(value: unknown): value is GeneratePatternCommandV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as {
    command_version?: unknown;
    planner_attempts_max?: unknown;
    writer_attempts_max?: unknown;
    verifier_attempts_max?: unknown;
  };
  return (
    record.command_version === PATTERN_COMMAND_VERSION &&
    record.planner_attempts_max === 2 &&
    (record.writer_attempts_max === 2 || record.writer_attempts_max === 3) &&
    record.verifier_attempts_max === 2
  );
}

export function publicStageFor(stage: PatternDomainStage): "organizing_evidence" | "writing" | "checking_claims" | null {
  if (stage === "reserved" || stage === "planning" || stage === "plan_validating") return "organizing_evidence";
  if (stage === "writing") return "writing";
  if (
    stage === "candidate_validating" ||
    stage === "semantic_verifying" ||
    stage === "publishing"
  ) {
    return "checking_claims";
  }
  return null;
}

/** Idempotent POST replay: in-progress public stage, or ready once accepted. */
export type PatternAcceptedReplayStage = NonNullable<ReturnType<typeof publicStageFor>> | "ready";

export function acceptedReplayStage(stage: PatternDomainStage): PatternAcceptedReplayStage {
  const pub = publicStageFor(stage);
  if (pub) return pub;
  if (stage === "succeeded") return "ready";
  return "organizing_evidence";
}

export type { BirthTimeAccuracy };
