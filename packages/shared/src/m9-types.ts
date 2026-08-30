/**
 * M9 is the additive successor for Pattern source regeneration.
 *
 * The generated reader document remains the frozen M7 public shape. M9 owns
 * only the state/action/status additions and the replacement-erasure event.
 */

import type {
  PatternConsent,
  PatternGenerationReason,
  PatternPublicStage,
  PatternStateDocument,
  PatternStateGeneration,
} from "./m7-types.js";

export const M9_SCHEMA_VERSION = "0.9.0" as const;
export type M9SchemaVersion = typeof M9_SCHEMA_VERSION;

export const PATTERN_GENERATION_REASONS_V9 = [
  "first_open",
  "first_open_retry",
  "failed_attempt_retry",
  "source_update",
] as const satisfies readonly [...readonly PatternGenerationReason[], "source_update"];

export type PatternGenerationReasonV9 =
  (typeof PATTERN_GENERATION_REASONS_V9)[number];

export interface PatternRegenerationState {
  eligible: boolean;
  generation: PatternStateGeneration | null;
  failure: PatternStateGeneration | null;
}

export interface PatternStateDocumentV9
  extends Omit<PatternStateDocument, "schema_version"> {
  schema_version: typeof M9_SCHEMA_VERSION;
  regeneration: PatternRegenerationState | null;
}

export type PatternGenerationRequestV9 =
  | {
      schema_version: typeof M9_SCHEMA_VERSION;
      consent_policy_version: string;
      confirm: "GENERATE MY PATTERN";
      reason: PatternGenerationReason;
    }
  | {
      schema_version: typeof M9_SCHEMA_VERSION;
      consent_policy_version: string;
      confirm: "REGENERATE MY PATTERN";
      reason: "source_update";
    };

export interface PatternGenerationAcceptedV9 {
  schema_version: typeof M9_SCHEMA_VERSION;
  consent: PatternConsent;
  generation: {
    generation_id: string;
    stage: PatternPublicStage | "ready";
  };
}

export interface PatternGenerationStatusV9 {
  schema_version: typeof M9_SCHEMA_VERSION;
  generation_id: string;
  stage: PatternPublicStage;
  status_updated_at: string;
  started_at: string;
  retryable: boolean;
  finished_at?: string | null;
}

export interface PatternRegenerationReplayEvent {
  schema_version: typeof M9_SCHEMA_VERSION;
  event_id: string;
  event_class: "pattern_regenerated";
  occurred_at: string;
  target_user_id: string;
  chart_fingerprint_hash: string;
  claim_id: string;
  generation_id: string;
  pattern_id: string;
  replacement_generation_id: string;
  replacement_pattern_id: string;
  ontology_version: string;
  prior_claim_status: "accepted";
  next_claim_status: "accepted";
  pattern_source_hash: string;
  content_hash: string;
  signing_key_id: string;
  signature: string;
}
