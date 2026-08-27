import {
  newId,
  type NatalFeatureClass,
  type ReadingPublisherProvider,
} from "@patternlike/shared";
import type { EnsureTodayFailureReason } from "./ensure-today-reading.js";
import type { GenerationFailureCode } from "./generation-failures.js";
import type { PublisherSafeDetailCode } from "./reading-publisher.js";
import type { OntologyVerdictDimension } from "./ontology-publisher.js";
import type {
  PatternPublisherFailureCode,
  PatternPublisherSafeDetailCode,
  PatternStageClass,
} from "./pattern-publisher.js";
import type {
  OntologyCandidateSafeDetailCode,
} from "./ontology-candidate-validation.js";
import type {
  OntologyRegressionFailureReason,
  OntologyRegressionHardGateFailure,
} from "./ontology-regression.js";
import type {
  CodexProviderFailureCode,
  CodexProviderPass,
  CodexProviderPipeline,
  CodexProviderSafeDetailCode,
} from "../db/codex-provider-jobs.js";

export type ConfigurationCode =
  | "reading_rollout_invalid"
  | "reading_publisher_misconfigured"
  | "auth_stub_in_production"
  | "root_kek_not_configured"
  | "identity_not_configured"
  | "check_in_retention_misconfigured"
  | "birth_operational_config_invalid"
  | "time_travel_misconfigured"
  | "pattern_rollout_invalid"
  | "pattern_publisher_misconfigured"
  | "ontology_pipeline_rollout_invalid"
  | "ontology_pipeline_misconfigured"
  | "codex_runner_authority_aliased";

type OperationalFailureClass =
  | GenerationFailureCode
  | "payload_undecryptable"
  | "execution_error";

export type DeletionFailureCheckpoint =
  | "accepted"
  | "exports_fenced"
  | "objects_deleted"
  | "rows_deleted"
  | "keys_erased"
  | "completed";

export type SafeLogEvent =
  | { event: "unhandled_error" }
  | { event: "generation_claim_release_failed" }
  | { event: "insecure_configuration"; config_code: ConfigurationCode }
  | { event: "generation_message_malformed" }
  | {
      event: "deletion_processing_failed";
      checkpoint: DeletionFailureCheckpoint;
    }
  | { event: "generation_retryable_failure"; failure_class: GenerationFailureCode }
  | { event: "generation_failed"; failure_class: OperationalFailureClass }
  | { event: "generation_threw"; failure_class: "payload_undecryptable" | "execution_error" }
  | {
      event: "birth_calc_completed";
      outcome: "success" | "invalid_input" | "upstream_failure" | "timeout";
      latency_ms: number;
      timeout_ms: number;
    }
  | { event: "birth_calc_budget_exhausted"; daily_limit: number }
  | { event: "calc_failed" }
  | { event: "content_release_keys_misconfigured" }
  | {
      event: "content_release_held_for_fixtures";
      release_version: string;
      fixture_count: number;
    }
  | { event: "internal_generation_failed" }
  | {
      event: "id_token_rejected";
      reason:
        | "jwks_unavailable"
        | "signature_or_claims"
        | "missing_expiry"
        | "missing_subject"
        | "unknown";
    }
  /**
   * Projects the reason because the response deliberately does not. Several
   * distinct outcomes still share one error code by design — naming which
   * dependency is degraded is not something an unauthenticated-shaped answer
   * should teach a caller — so without this field nothing anywhere recorded
   * what produced a given 503 on Today. Every member of the union is a closed
   * literal code: no identifier, message, or upstream prose can reach here.
   */
  | { event: "ensure_today_failed"; reason: EnsureTodayFailureReason }
  | { event: "local_day_unresolvable" }
  | { event: "generation_dispatch_failed" }
  | { event: "fact_repair_reconciliation_failed" }
  | { event: "scheduler_repair_quota_exhausted" }
  | { event: "timing_local_day_unresolvable" }
  | { event: "timing_cycles_unreadable"; unreadable_count: number }
  | { event: "jwks_refresh_failed_using_stale" }
  // ---------------------------------------------------------------------
  // M4 Your Pattern and Time Travel.
  //
  // Every arm below is a closed literal. Pattern evidence, life-event prose,
  // selected dates, and receipt bodies are private by construction and none of
  // them has a field here to travel through.
  // ---------------------------------------------------------------------
  /** The eager post-chart feature write failed; the chart itself committed. */
  | { event: "natal_feature_cache_write_failed" }
  | { event: "pattern_dispatch_failed" }
  | { event: "pattern_stage_failed" }
  | {
      event: "ontology_candidate_rejected";
      reason: OntologyCandidateSafeDetailCode;
      /** Accepted + proposed record count. A count, never a record or an id. */
      record_count?: number;
    }
  | {
      event: "ontology_evaluation_rejected";
      /** Position in candidate order. Never the rule id. */
      rule_index: number;
      rejected_dimensions: OntologyVerdictDimension[];
    }
  | {
      event: "ontology_generation_stalled";
      safe_detail_code:
        | "coverage_no_progress"
        | "generation_chunk_limit_exhausted";
      remaining_feature_classes: NatalFeatureClass[];
    }
  | {
      event: "ontology_regression_hard_gate_failed";
      fixture_index: number;
      pass: PatternStageClass;
      hard_gate_failures: OntologyRegressionHardGateFailure[];
    }
  /**
   * Why the regressing stage failed, when no hard gate did.
   *
   * `regression_failed` is raised from eleven places in
   * `ontology-pipeline-execute.ts` and only the hard gate ever said anything.
   * A run that ends on a pass ceiling writes no artifact at its final stage
   * generation, so without this the only evidence is provider-call arithmetic.
   * Every field is a closed reason, a pass name, or a counter.
   */
  | {
      event: "ontology_regression_failed";
      reason: OntologyRegressionFailureReason;
      fixture_index?: number;
      pass?: PatternStageClass;
      planner_calls?: number;
      writer_calls?: number;
      verifier_calls_for_candidate?: number;
      delivery_attempt?: number;
    }
  /** A stage exhausted its claim ceiling and the sweep failed the job. */
  | { event: "pattern_stage_terminal_failure" }
  /** That repair could not commit, so the jobs row is still holding a slot. */
  | { event: "pattern_stage_terminal_failure_write_failed" }
  /** Retention prune or expired-artifact cleanup could not complete. */
  | { event: "pattern_artifact_cleanup_failed" }
  /** Lazy derivation could not produce a receipted set for a Pattern read. */
  | { event: "natal_feature_derivation_failed" }
  /** Two derivations of one (chart, policy) disagreed. Never an overwrite. */
  | { event: "natal_feature_set_hash_conflict" }
  /** The active release could not be verified for a Pattern read. */
  | { event: "release_unreadable" }
  | { event: "release_hash_mismatch" }
  /** A stored scan receipt failed its own integrity checks on read. */
  | { event: "time_travel_receipt_unreadable" }
  /**
   * Two calculations under one receipt key produced different semantic
   * results. Almost always an unbumped TIME_TRAVEL_RECEIPT_EPOCH across a
   * result-changing calc deployment. Fails closed rather than overwriting.
   */
  | { event: "time_travel_receipt_semantic_conflict" }
  /** The calculation service echoed a policy, contract, or pin we did not send. */
  | { event: "time_travel_calc_echo_rejected" }
  /** Transport, configuration, or upstream 5xx on the cycle boundary. */
  | { event: "calc_unavailable" }
  /** A normalized result exceeded the application cap before any D1 write. */
  | { event: "time_travel_result_oversized"; byte_length: number }
  /** An unexpected throw inside the Time Travel route. */
  | { event: "time_travel_unhandled_failure" }
  | { event: "time_travel_integrity_failure" }
  | { event: "time_travel_configuration_error" }
  /** One saved event failed to decrypt; the count is all that is projected. */
  | { event: "life_event_unreadable"; unreadable_count: number }
  /** The life-event list could not be decrypted or normalized. */
  | { event: "life_event_list_integrity_failure" }
  | {
      event: "codex_provider_job_claimed";
      job_id: string;
      pipeline: CodexProviderPipeline;
      pass: CodexProviderPass;
      model: string;
    }
  | {
      event: "codex_provider_job_completed";
      job_id: string;
      pipeline: CodexProviderPipeline;
      pass: CodexProviderPass;
      model: string;
      input_tokens: number;
      output_tokens: number;
      response_hash: string;
    }
  | {
      event: "codex_provider_job_failed";
      job_id: string;
      pipeline: CodexProviderPipeline;
      pass: CodexProviderPass;
      model: string;
      failure_code: CodexProviderFailureCode;
      safe_detail_code: CodexProviderSafeDetailCode;
    }
  | {
      event: "codex_provider_job_conflict";
      job_id: string;
      operation: "claim" | "complete" | "fail";
    }
  | {
      event: "codex_provider_dispatch_failed";
      job_id: string;
      pipeline: CodexProviderPipeline;
    }
  /**
   * The provider CALL finished and returned a parseable candidate. Not an
   * acceptance: schema and candidate validation run after this, and a rejected
   * candidate still costs tokens. Emitted here on purpose — moving it past
   * validation would leave a rejected reading with no cost record at all, and
   * cost and validation rate are exactly what the rollout watches.
   */
  | {
      event: "publisher_call_completed";
      provider: ReadingPublisherProvider;
      model: string;
      prompt_version: string;
      latency_ms: number;
      input_tokens: number;
      output_tokens: number;
      provider_response_hash: string;
    }
  | {
      event: "publisher_attempt_failed";
      provider: ReadingPublisherProvider;
      model: string;
      prompt_version: string;
      latency_ms: number;
      failure_class: GenerationFailureCode;
      safe_detail_code: PublisherSafeDetailCode | "schema_mismatch";
    }
  | {
      event: "pattern_publisher_call_completed";
      provider: "openai" | "codex" | "workers_ai";
      pass: PatternStageClass;
      model: string;
      prompt_version: string;
      latency_ms: number;
      input_tokens: number;
      output_tokens: number;
      provider_response_hash: string;
    }
  | {
      event: "pattern_publisher_attempt_failed";
      provider: "openai" | "codex" | "workers_ai";
      pass: PatternStageClass;
      model: string;
      prompt_version: string;
      latency_ms: number;
      attempt: number;
      failure_class: PatternPublisherFailureCode;
      safe_detail_code: PatternPublisherSafeDetailCode;
    };

/**
 * The sole console boundary for the API Worker.
 *
 * Every switch arm projects named fields. Runtime callers cannot smuggle an
 * Error, request, identifier, URL, or prose through a spread even if they cast
 * around the TypeScript union.
 */
export function safeLog(input: SafeLogEvent): string {
  const trace_id = newId("trc");

  switch (input.event) {
    case "insecure_configuration":
      console.error(input.event, { trace_id, config_code: input.config_code });
      break;
    case "generation_retryable_failure":
    case "generation_failed":
      console.error(input.event, { trace_id, failure_class: input.failure_class });
      break;
    case "deletion_processing_failed":
      console.error(input.event, { trace_id, checkpoint: input.checkpoint });
      break;
    case "generation_threw":
      console.error(input.event, { trace_id, failure_class: input.failure_class });
      break;
    case "content_release_held_for_fixtures":
      console.warn(input.event, {
        trace_id,
        release_version: input.release_version,
        fixture_count: input.fixture_count,
      });
      break;
    case "id_token_rejected":
    case "ensure_today_failed":
      console.error(input.event, { trace_id, reason: input.reason });
      break;
    case "timing_cycles_unreadable":
      console.error(input.event, { trace_id, unreadable_count: input.unreadable_count });
      break;
    case "birth_calc_completed":
      console.info(input.event, {
        trace_id,
        outcome: input.outcome,
        latency_ms: input.latency_ms,
        timeout_ms: input.timeout_ms,
      });
      break;
    case "birth_calc_budget_exhausted":
      console.warn(input.event, { trace_id, daily_limit: input.daily_limit });
      break;
    case "publisher_call_completed":
      console.info(input.event, {
        trace_id,
        provider: input.provider,
        model: input.model,
        prompt_version: input.prompt_version,
        latency_ms: input.latency_ms,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        provider_response_hash: input.provider_response_hash,
      });
      break;
    case "publisher_attempt_failed":
      console.warn(input.event, {
        trace_id,
        provider: input.provider,
        model: input.model,
        prompt_version: input.prompt_version,
        latency_ms: input.latency_ms,
        failure_class: input.failure_class,
        safe_detail_code: input.safe_detail_code,
      });
      break;
    case "pattern_publisher_call_completed":
      console.info(input.event, {
        trace_id,
        provider: input.provider,
        pass: input.pass,
        model: input.model,
        prompt_version: input.prompt_version,
        latency_ms: input.latency_ms,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        provider_response_hash: input.provider_response_hash,
      });
      break;
    case "codex_provider_job_claimed":
      console.info(input.event, {
        trace_id,
        job_id: input.job_id,
        pipeline: input.pipeline,
        pass: input.pass,
        model: input.model,
      });
      break;
    case "codex_provider_job_completed":
      console.info(input.event, {
        trace_id,
        job_id: input.job_id,
        pipeline: input.pipeline,
        pass: input.pass,
        model: input.model,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        response_hash: input.response_hash,
      });
      break;
    case "codex_provider_job_failed":
      console.warn(input.event, {
        trace_id,
        job_id: input.job_id,
        pipeline: input.pipeline,
        pass: input.pass,
        model: input.model,
        failure_code: input.failure_code,
        safe_detail_code: input.safe_detail_code,
      });
      break;
    case "codex_provider_job_conflict":
      console.warn(input.event, {
        trace_id,
        job_id: input.job_id,
        operation: input.operation,
      });
      break;
    case "codex_provider_dispatch_failed":
      console.error(input.event, {
        trace_id,
        job_id: input.job_id,
        pipeline: input.pipeline,
      });
      break;
    case "pattern_publisher_attempt_failed":
      console.warn(input.event, {
        trace_id,
        provider: input.provider,
        pass: input.pass,
        model: input.model,
        prompt_version: input.prompt_version,
        latency_ms: input.latency_ms,
        attempt: input.attempt,
        failure_class: input.failure_class,
        safe_detail_code: input.safe_detail_code,
      });
      break;
    case "ontology_candidate_rejected":
      console.warn(input.event, { trace_id, reason: input.reason });
      break;
    case "ontology_generation_stalled":
      console.warn(input.event, {
        trace_id,
        safe_detail_code: input.safe_detail_code,
        remaining_feature_classes: input.remaining_feature_classes,
      });
      break;
    case "ontology_regression_hard_gate_failed":
      console.warn(input.event, {
        trace_id,
        fixture_index: input.fixture_index,
        pass: input.pass,
        hard_gate_failures: input.hard_gate_failures,
      });
      break;
    case "ontology_regression_failed":
      console.warn(input.event, {
        trace_id,
        reason: input.reason,
        fixture_index: input.fixture_index,
        pass: input.pass,
        planner_calls: input.planner_calls,
        writer_calls: input.writer_calls,
        verifier_calls_for_candidate: input.verifier_calls_for_candidate,
        delivery_attempt: input.delivery_attempt,
      });
      break;
    case "unhandled_error":
    case "generation_claim_release_failed":
    case "generation_message_malformed":
    case "calc_failed":
    case "content_release_keys_misconfigured":
    case "internal_generation_failed":
    case "local_day_unresolvable":
    case "generation_dispatch_failed":
    case "fact_repair_reconciliation_failed":
    case "scheduler_repair_quota_exhausted":
    case "timing_local_day_unresolvable":
    case "jwks_refresh_failed_using_stale":
    case "natal_feature_cache_write_failed":
    case "pattern_dispatch_failed":
    case "pattern_stage_failed":
    case "pattern_stage_terminal_failure":
    case "pattern_stage_terminal_failure_write_failed":
    case "pattern_artifact_cleanup_failed":
    case "natal_feature_derivation_failed":
    case "natal_feature_set_hash_conflict":
    case "release_unreadable":
    case "release_hash_mismatch":
    case "time_travel_receipt_unreadable":
    case "time_travel_receipt_semantic_conflict":
    case "time_travel_calc_echo_rejected":
    case "calc_unavailable":
    case "time_travel_unhandled_failure":
    case "time_travel_integrity_failure":
    case "time_travel_configuration_error":
    case "life_event_list_integrity_failure":
      console.error(input.event, { trace_id });
      break;
    case "time_travel_result_oversized":
      console.error(input.event, { trace_id, byte_length: input.byte_length });
      break;
    case "life_event_unreadable":
      console.warn(input.event, { trace_id, unreadable_count: input.unreadable_count });
      break;
  }

  return trace_id;
}
