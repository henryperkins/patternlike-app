/** Aggregate-only administrator observations; no domain identifiers or content. */
export type RuntimeWorkClass = "text" | "portrait" | "mesh";
export type RuntimeHealthReason = "observed" | "schema_unavailable" | "query_failed" | "sample_limit_exceeded" | "invalid_timestamp";
export interface RuntimeWorkClassHealth {
  work_class: RuntimeWorkClass;
  observation: "known" | "unavailable";
  reason: RuntimeHealthReason;
  runner_enabled: null;
  pending_count: number | null;
  scheduled_pending_count: number | null;
  dispatchable_pending_count: number | null;
  active_lease_count: number | null;
  expired_lease_count: number | null;
  failed_count: number | null;
  /** Null for text: no stored per-exchange retry ceiling. */
  retry_exhausted_count: number | null;
  retry_exhaustion_observation: "known" | "not_collected";
  oldest_pending_age_ms: number | null;
  oldest_dispatchable_pending_age_ms: number | null;
  completion_latency: {
    successful_count: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    missing_timestamp_count: number | null;
    measurement_started_at: string | null;
    window_started_at: string;
    coverage: "complete" | "partial" | "unavailable";
  };
}
export interface RuntimeHealthResponse {
  schema_version: "runtime-health/v1";
  sampled_at: string;
  work_classes: [RuntimeWorkClassHealth, RuntimeWorkClassHealth, RuntimeWorkClassHealth];
  publication: {
    observation: "known" | "unavailable";
    reason: "observed" | "query_failed" | "sample_limit_exceeded";
    publication_safety_failed_count: number | null;
    retry_failures: { observation: "unavailable"; reason: "not_collected"; count: null };
  };
}
