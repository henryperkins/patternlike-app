/** Types-only public boundary for ontology generator and evaluator providers. */

import type { PatternOntologyRecord } from "@patternlike/shared";
import type { OntologyPipelineConfigPin } from "../middleware/config-guard.js";
import type {
  PublisherFailureCode,
  PublisherSafeDetailCode,
} from "./openai-responses-adapter.js";
import type {
  OntologyEvaluatorPacket,
  OntologyGeneratorPacket,
} from "./ontology-packet.js";

export type OntologyProviderPass = "generator" | "evaluator";
export type OntologyProviderReservationFailureReason =
  | "exhausted"
  | "claim_unavailable"
  | "run_exhausted";

export type OntologyProviderReservationOutcome =
  | { ok: true; used: number }
  | { ok: false; reason: OntologyProviderReservationFailureReason };

export interface OntologyGenerationChunk {
  schema_version: "0.7.0";
  records: PatternOntologyRecord[];
  complete: boolean;
}

export type OntologyDimensionVerdict = "pass" | "reject";

export interface OntologyRuleVerdict {
  schema_version: "0.7.0";
  rule_id: string;
  verdict: "pass" | "reject";
  dimensions: {
    source_support: OntologyDimensionVerdict;
    entailment: OntologyDimensionVerdict;
    contradiction: OntologyDimensionVerdict;
    unsupported_expansion: OntologyDimensionVerdict;
    diagnostic_or_predictive_drift: OntologyDimensionVerdict;
    one_sided_or_essentialist_framing: OntologyDimensionVerdict;
    tension_counter_expression_balance: OntologyDimensionVerdict;
    uncertainty_compatibility: OntologyDimensionVerdict;
    cross_record_conflict: OntologyDimensionVerdict;
  };
}

export interface OntologyPassOptions {
  /** Worker's internal correlation only; never provider-visible. */
  requestId: string;
  timeoutMs: number;
  configuration: OntologyPipelineConfigPin;
  /** Canonical credential-free body persisted before this provider pass. */
  requestBody?: string;
  /** Awaited inside the adapter immediately before its one permitted fetch. */
  reserve: (
    stageClass: OntologyProviderPass,
  ) => Promise<OntologyProviderReservationOutcome>;
  codexJob?: {
    ownerId: string;
    stageGeneration: number;
    stageAttempt: number;
    dailyCallLimit: number;
  };
}

export interface OntologyPassMetadata {
  provider: "openai" | "codex";
  pass: OntologyProviderPass;
  model: string;
  prompt_version: string;
  provider_request_id: string;
  input_tokens: number;
  output_tokens: number;
  provider_response_hash: string;
}

export type OntologyPublisherFailureCode =
  | PublisherFailureCode
  | "publisher_budget_exhausted"
  | "publisher_claim_unavailable"
  | "publisher_run_call_limit_exhausted";

export type OntologyPublisherSafeDetailCode =
  | PublisherSafeDetailCode
  | "gateway_cache_hit"
  | "gateway_dlp_match"
  | "provider_4xx"
  | "response_too_large"
  | "daily_call_limit_reached"
  | "claim_fence_refused"
  | "run_call_limit_reached";

export type OntologyPassOutcome<T> =
  | {
      ok: true;
      value: T;
      /** Exact provider response bytes. Encrypt before persistence; never log. */
      raw: string;
      metadata: OntologyPassMetadata;
    }
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
      code: OntologyPublisherFailureCode;
      safe_detail_code: OntologyPublisherSafeDetailCode;
      retry_after_seconds: number | null;
      origin_layer: "provider" | "gateway" | "unknown" | "none";
    };

export interface OntologyPublisher {
  generate(
    packet: OntologyGeneratorPacket,
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyGenerationChunk>>;
  evaluate(
    packet: OntologyEvaluatorPacket,
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyRuleVerdict>>;
}
