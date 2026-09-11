import { diagnosticInteger, diagnosticRecord, diagnosticTimestamp } from "./diagnostic-data.js";

export const PATTERN_DIAGNOSTIC_STAGES = ["reserved", "planning", "plan_validating", "writing", "candidate_validating", "semantic_verifying", "publishing", "succeeded", "failed", "cancelled", "unknown"] as const;
export const PATTERN_DIAGNOSTIC_FAILURES = ["plan_invalid", "candidate_invalid", "semantic_verification_failed", "publication_safety_failed", "planner_attempts_exhausted", "writer_attempts_exhausted", "verifier_attempts_exhausted", "execution_error", "unknown_failure"] as const;
export const PATTERN_DIAGNOSTIC_RESERVATIONS = ["first_open", "first_open_retry", "failed_attempt_retry", "chart_correction", "source_update", "unknown"] as const;
export const PATTERN_DIAGNOSTIC_CANCELLATIONS = ["cancel_consent", "cancel_stale", "cancel_ontology", "cancel_source_changed", "unknown"] as const;
export interface PatternDiagnosticsResponse {
  schema_version: "pattern-diagnostics/v1";
  generation_id: string;
  observed_at: string;
  stage: (typeof PATTERN_DIAGNOSTIC_STAGES)[number];
  stage_generation: number;
  created_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  failure_class: (typeof PATTERN_DIAGNOSTIC_FAILURES)[number] | null;
  public_failure_stage: "organizing_evidence" | "writing" | "checking_claims" | "unknown" | null;
  cancellation_reason: (typeof PATTERN_DIAGNOSTIC_CANCELLATIONS)[number] | null;
  reservation_reason: (typeof PATTERN_DIAGNOSTIC_RESERVATIONS)[number];
  /** Not collected from encrypted command metadata under this projection. */
  revision_reason: null;
  planner_attempts: number;
  writer_attempts: number;
  verifier_attempts: number;
  schedule: { status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown"; available_at: string | null; lease_expires_at: string | null };
  provider: { pass: "planner" | "writer" | "verifier"; status: "pending" | "leased" | "completed" | "failed" | "cancelled"; lease_expires_at: string | null; available_at: string | null; completed_at: string | null } | null;
}
const KEYS = ["schema_version", "generation_id", "observed_at", "stage", "stage_generation", "created_at", "updated_at", "finished_at", "failure_class", "public_failure_stage", "cancellation_reason", "reservation_reason", "revision_reason", "planner_attempts", "writer_attempts", "verifier_attempts", "schedule", "provider"];
const member = (value: unknown, list: readonly string[]) => typeof value === "string" && list.includes(value);
const timestampOrNull = (value: unknown) => value === null || diagnosticTimestamp(value);
export function parsePatternDiagnostics(input: unknown): PatternDiagnosticsResponse | null {
  const value = diagnosticRecord(input, KEYS);
  if (!value || value.schema_version !== "pattern-diagnostics/v1" || typeof value.generation_id !== "string"
    || !/^pgen_[a-f0-9]{32}$/.test(value.generation_id) || !diagnosticTimestamp(value.observed_at)
    || !member(value.stage, PATTERN_DIAGNOSTIC_STAGES) || !member(value.reservation_reason, PATTERN_DIAGNOSTIC_RESERVATIONS)
    || value.revision_reason !== null) return null;
  for (const field of ["stage_generation", "planner_attempts", "writer_attempts", "verifier_attempts"]) if (!diagnosticInteger(value[field])) return null;
  for (const field of ["created_at", "updated_at", "finished_at"]) if (!timestampOrNull(value[field])) return null;
  if (value.failure_class !== null && !member(value.failure_class, PATTERN_DIAGNOSTIC_FAILURES)) return null;
  if (value.public_failure_stage !== null && !member(value.public_failure_stage, ["organizing_evidence", "writing", "checking_claims", "unknown"])) return null;
  if (value.cancellation_reason !== null && !member(value.cancellation_reason, PATTERN_DIAGNOSTIC_CANCELLATIONS)) return null;
  const schedule = diagnosticRecord(value.schedule, ["status", "available_at", "lease_expires_at"]);
  if (!schedule || !member(schedule.status, ["queued", "running", "succeeded", "failed", "cancelled", "unknown"])
    || !timestampOrNull(schedule.available_at) || !timestampOrNull(schedule.lease_expires_at)) return null;
  let provider: Record<string, unknown> | null = null;
  if (value.provider !== null) {
    provider = diagnosticRecord(value.provider, ["pass", "status", "lease_expires_at", "available_at", "completed_at"]);
    if (!provider || !member(provider.pass, ["planner", "writer", "verifier"]) || !member(provider.status, ["pending", "leased", "completed", "failed", "cancelled"])) return null;
    for (const field of ["lease_expires_at", "available_at", "completed_at"]) if (!timestampOrNull(provider[field])) return null;
  }
  return { ...value, schedule: { ...schedule }, provider: provider ? { ...provider } : null } as unknown as PatternDiagnosticsResponse;
}
export type DiagnosticStage = "permission_admission" | "reservation" | "runner_execution" | "validation" | "publication";
export type DiagnosticReason = "observed_stage" | "recorded" | "not_collected" | "unsupported_domain" | "scope_not_authorized" | "record_missing" | "stale_observation" | "contradictory_record" | "invalid_timestamp" | "unknown_failure" | NonNullable<PatternDiagnosticsResponse["failure_class"]>;
export interface PatternDiagnosticReport {
  domain: "pattern" | "unsupported";
  reason: DiagnosticReason;
  observed_at: string | null;
  source_updated_at: string | null;
  observation_age_ms: number | null;
  source_age_ms: number | null;
  blocking_stage: DiagnosticStage | null;
  stages: { stage: DiagnosticStage; observation: "known" | "not_collected" | "unavailable"; reason: DiagnosticReason; blocking: boolean | null }[];
  lease_expires_at: string | null;
  retry_at: string | null;
  retry_origin: "first_open_retry" | "failed_attempt_retry" | "unknown";
  revision_reason: null;
  reservation_reason: PatternDiagnosticsResponse["reservation_reason"] | null;
  provider_output: "accepted" | "not_collected";
  publication: "historically_published" | "not_published" | "not_collected";
  current_reader_access: "not_collected";
  recovery: { action: "reload_status"; authority: "read_only" } | null;
}
/** Freshness window is presentation evidence, never a production latency SLO. */
export function diagnosePattern(input: { domain: string; authorized: boolean; snapshot: unknown }, now: string): PatternDiagnosticReport {
  const result: PatternDiagnosticReport = {
    domain: input.domain === "pattern" ? "pattern" : "unsupported", reason: "not_collected", observed_at: null, source_updated_at: null,
    observation_age_ms: null, source_age_ms: null, blocking_stage: null,
    stages: (["permission_admission", "reservation", "runner_execution", "validation", "publication"] as const).map((stage) => ({ stage, observation: "not_collected", reason: "not_collected", blocking: null })),
    lease_expires_at: null, retry_at: null, retry_origin: "unknown", revision_reason: null, reservation_reason: null,
    provider_output: "not_collected", publication: "not_collected", current_reader_access: "not_collected", recovery: null,
  };
  const unavailable = (reason: DiagnosticReason) => { result.reason = reason; return result; };
  if (input.domain !== "pattern") return unavailable("unsupported_domain");
  if (!input.authorized) return unavailable("scope_not_authorized");
  const value = parsePatternDiagnostics(input.snapshot);
  if (!value) return unavailable("record_missing");
  result.recovery = { action: "reload_status", authority: "read_only" };
  if (!diagnosticTimestamp(now)) return unavailable("invalid_timestamp");
  const clock = Date.parse(now);
  const observed = Date.parse(value.observed_at);
  result.observed_at = value.observed_at;
  result.source_updated_at = value.updated_at;
  if (observed > clock || !value.created_at || !value.updated_at || Date.parse(value.updated_at) > observed
    || Date.parse(value.created_at) > Date.parse(value.updated_at)
    || (value.finished_at !== null && (Date.parse(value.finished_at) < Date.parse(value.created_at) || Date.parse(value.finished_at) > observed))) return unavailable("invalid_timestamp");
  result.observation_age_ms = clock - observed;
  result.source_age_ms = clock - Date.parse(value.updated_at);
  if (clock - observed > 300_000) return unavailable("stale_observation");
  const terminal = ["succeeded", "failed", "cancelled"].includes(value.stage);
  if (value.stage === "unknown" || terminal !== (value.finished_at !== null)
    || (value.stage !== "failed" && value.failure_class !== null)
    || (value.stage !== "cancelled" && value.cancellation_reason !== null)
    || (terminal && value.schedule.status !== value.stage)
    || (!terminal && !["queued", "running"].includes(value.schedule.status))
    || ([value.schedule.lease_expires_at, value.provider?.lease_expires_at].some((lease) => lease != null && Date.parse(lease) < Date.parse(value.created_at!)))
    || (value.provider !== null && ["completed", "failed", "cancelled"].includes(value.provider.status) !== (value.provider.completed_at !== null))
    || (value.provider?.completed_at && (Date.parse(value.provider.completed_at) > observed || Date.parse(value.provider.completed_at) < Date.parse(value.created_at)))
    || (value.provider?.status === "leased" && !value.provider.lease_expires_at)) return unavailable("contradictory_record");
  result.reason = value.stage === "failed" ? "unknown_failure" : "observed_stage";
  result.reservation_reason = value.reservation_reason;
  result.retry_origin = ["first_open_retry", "failed_attempt_retry"].includes(value.reservation_reason) ? value.reservation_reason as "first_open_retry" | "failed_attempt_retry" : "unknown";
  result.provider_output = value.provider?.status === "completed" && value.provider.completed_at !== null ? "accepted" : "not_collected";
  result.publication = value.stage === "succeeded" ? "historically_published" : "not_published";
  result.lease_expires_at = value.provider?.status === "leased" ? value.provider.lease_expires_at : value.schedule.status === "running" ? value.schedule.lease_expires_at : null;
  result.retry_at = value.schedule.status === "queued" ? value.schedule.available_at : null;
  const stageForFailure: Partial<Record<NonNullable<PatternDiagnosticsResponse["failure_class"]>, DiagnosticStage>> = {
    plan_invalid: "validation", candidate_invalid: "validation", semantic_verification_failed: "validation",
    publication_safety_failed: "publication", planner_attempts_exhausted: "runner_execution", writer_attempts_exhausted: "runner_execution", verifier_attempts_exhausted: "runner_execution",
  };
  if (value.stage === "failed" && value.failure_class && stageForFailure[value.failure_class]) {
    result.blocking_stage = stageForFailure[value.failure_class]!; result.reason = value.failure_class;
  }
  for (const stage of result.stages) {
    if (stage.stage === "permission_admission") continue;
    const known = stage.stage === "reservation" || stage.stage === result.blocking_stage
      || (stage.stage === "runner_execution" && value.provider !== null)
      || (stage.stage === "validation" && ["plan_validating", "candidate_validating", "semantic_verifying"].includes(value.stage))
      || (stage.stage === "publication" && ["publishing", "succeeded"].includes(value.stage));
    if (known) { stage.observation = "known"; stage.reason = stage.stage === result.blocking_stage ? result.reason : "recorded"; stage.blocking = stage.stage === result.blocking_stage ? true : null; }
  }
  return result;
}
