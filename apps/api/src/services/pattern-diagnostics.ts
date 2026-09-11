import {
  PATTERN_DIAGNOSTIC_CANCELLATIONS, PATTERN_DIAGNOSTIC_FAILURES,
  PATTERN_DIAGNOSTIC_RESERVATIONS, PATTERN_DIAGNOSTIC_STAGES,
  type PatternDiagnosticsResponse,
} from "@patternlike/shared";
import type { Env } from "../env.js";

type Row = Record<string, unknown> & { generation_id: string; user_id: string };
const closed = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === "string" && values.includes(value as T) ? value as T : fallback;
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const canonical = new Date(value).toISOString();
  return canonical === (value.length === 20 ? value.replace("Z", ".000Z") : value) ? canonical : null;
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** One exact generation, matching current provider coordinate, no encrypted fields. */
export async function readPatternDiagnostics(env: Env, generationId: string, now: string): Promise<{ userId: string; response: PatternDiagnosticsResponse } | null> {
  const row = await env.DB.prepare(`
    SELECT p.generation_id, p.user_id, p.stage, p.stage_generation,
      p.created_at, p.updated_at, p.finished_at, p.failure_class, p.public_failure_stage,
      p.cancellation_reason, p.reservation_reason, p.planner_attempts, p.writer_attempts, p.verifier_attempts,
      j.status AS schedule_status, j.available_at AS schedule_available_at, j.lease_expires_at AS schedule_lease_expires_at,
      c.pass AS provider_pass, c.status AS provider_status, c.available_at AS provider_available_at,
      c.lease_expires_at AS provider_lease_expires_at, c.completed_at AS provider_completed_at
    FROM pattern_generation_jobs p JOIN jobs j ON j.id = p.job_id
    LEFT JOIN codex_provider_jobs c ON c.pipeline = 'pattern' AND c.owner_id = p.generation_id
      AND c.user_id = p.user_id AND c.stage_generation = p.stage_generation
      AND c.pass = CASE
        WHEN p.stage IN ('reserved', 'planning', 'plan_validating') THEN 'planner'
        WHEN p.stage IN ('writing', 'candidate_validating') THEN 'writer'
        WHEN p.stage IN ('semantic_verifying', 'publishing') THEN 'verifier' ELSE NULL END
      AND c.stage_attempt = CASE
        WHEN c.pass = 'planner' THEN p.planner_attempts
        WHEN c.pass = 'writer' THEN p.writer_attempts
        WHEN c.pass = 'verifier' THEN p.verifier_attempts ELSE NULL END
    WHERE p.generation_id = ? LIMIT 1
  `).bind(generationId).first<Row>();
  if (!row) return null;
  const response: PatternDiagnosticsResponse = {
    schema_version: "pattern-diagnostics/v1", generation_id: row.generation_id, observed_at: now,
    stage: closed(row.stage, PATTERN_DIAGNOSTIC_STAGES, "unknown"), stage_generation: integer(row.stage_generation),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), finished_at: timestamp(row.finished_at),
    failure_class: row.failure_class === null ? null : closed(row.failure_class, PATTERN_DIAGNOSTIC_FAILURES, "unknown_failure"),
    public_failure_stage: row.public_failure_stage === null ? null : closed(row.public_failure_stage, ["organizing_evidence", "writing", "checking_claims", "unknown"] as const, "unknown"),
    cancellation_reason: row.cancellation_reason === null ? null : closed(row.cancellation_reason, PATTERN_DIAGNOSTIC_CANCELLATIONS, "unknown"),
    reservation_reason: closed(row.reservation_reason, PATTERN_DIAGNOSTIC_RESERVATIONS, "unknown"), revision_reason: null,
    planner_attempts: integer(row.planner_attempts), writer_attempts: integer(row.writer_attempts), verifier_attempts: integer(row.verifier_attempts),
    schedule: { status: closed(row.schedule_status, ["queued", "running", "succeeded", "failed", "cancelled", "unknown"] as const, "unknown"), available_at: timestamp(row.schedule_available_at), lease_expires_at: timestamp(row.schedule_lease_expires_at) },
    provider: row.provider_pass === null ? null : {
      pass: closed(row.provider_pass, ["planner", "writer", "verifier"] as const, "planner"),
      status: closed(row.provider_status, ["pending", "leased", "completed", "failed", "cancelled"] as const, "failed"),
      lease_expires_at: timestamp(row.provider_lease_expires_at), available_at: timestamp(row.provider_available_at), completed_at: timestamp(row.provider_completed_at),
    },
  };
  return { userId: row.user_id, response };
}
