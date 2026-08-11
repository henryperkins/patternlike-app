import { newId } from "@patternlike/shared";
import type { EnsureTodayFailureReason } from "./ensure-today-reading.js";
import type { GenerationFailureCode } from "./generation-failures.js";
import type { PublisherSafeDetailCode } from "./reading-publisher.js";

type ConfigurationCode =
  | "reading_rollout_invalid"
  | "reading_publisher_misconfigured"
  | "auth_stub_in_production"
  | "root_kek_not_configured"
  | "identity_not_configured";

type OperationalFailureClass =
  | GenerationFailureCode
  | "payload_undecryptable"
  | "execution_error";

export type SafeLogEvent =
  | { event: "unhandled_error" }
  | { event: "generation_claim_release_failed" }
  | { event: "insecure_configuration"; config_code: ConfigurationCode }
  | { event: "generation_message_malformed" }
  | { event: "generation_retryable_failure"; failure_class: GenerationFailureCode }
  | { event: "generation_failed"; failure_class: OperationalFailureClass }
  | { event: "generation_threw"; failure_class: "payload_undecryptable" | "execution_error" }
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
  /**
   * The provider CALL finished and returned a parseable candidate. Not an
   * acceptance: schema and candidate validation run after this, and a rejected
   * candidate still costs tokens. Emitted here on purpose — moving it past
   * validation would leave a rejected reading with no cost record at all, and
   * cost and validation rate are exactly what the rollout watches.
   */
  | {
      event: "publisher_call_completed";
      provider: "openai";
      model: string;
      prompt_version: string;
      latency_ms: number;
      input_tokens: number;
      output_tokens: number;
      provider_response_hash: string;
    }
  | {
      event: "publisher_attempt_failed";
      provider: "openai";
      model: string;
      prompt_version: string;
      latency_ms: number;
      failure_class: GenerationFailureCode;
      safe_detail_code: PublisherSafeDetailCode | "schema_mismatch";
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
      console.error(input.event, { trace_id });
      break;
  }

  return trace_id;
}
