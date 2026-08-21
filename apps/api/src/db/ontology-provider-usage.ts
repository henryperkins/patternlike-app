import type { Env } from "../env.js";
import type { ClaimedOntologyPipelineRun } from "./ontology-pipeline.js";
import type {
  OntologyProviderPass,
  OntologyProviderReservationOutcome,
} from "../services/ontology-publisher.js";

export type OntologyProviderStageClass = OntologyProviderPass | "regression";

export type OntologyProviderBudgetOutcome =
  | { ok: true; used: number }
  | { ok: false; reason: "exhausted" };

export const ONTOLOGY_PROVIDER_PERSISTENCE_MARGIN_MS = 30_000;

interface ClaimedOntologyProviderReservationOptions {
  expectedPass: OntologyProviderPass;
  dailyLimit: number;
  runLimit: number;
  timeoutMs: number;
  now?: () => Date;
}

export function utcDateForOntologyProviderUsage(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) &&
    utcDateForOntologyProviderUsage(instant) === value;
}

/**
 * Atomically reserve one provider call against the pipeline's shared UTC-day
 * ceiling while attributing it to exactly one closed stage class.
 *
 * This is intentionally consumption, not a refundable lease. The caller
 * invokes it immediately before fetch; once this statement returns `ok`, a
 * provider failure or timeout still owns the unit.
 */
export async function consumeOntologyProviderCallBudget(
  env: Pick<Env, "DB">,
  utcDate: string,
  limit: number,
  stageClass: OntologyProviderStageClass,
): Promise<OntologyProviderBudgetOutcome> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !isUtcDate(utcDate) ||
    !["generator", "evaluator", "regression"].includes(stageClass)
  ) {
    return { ok: false, reason: "exhausted" };
  }

  const now = new Date().toISOString();
  const generatorIncrement = stageClass === "generator" ? 1 : 0;
  const evaluatorIncrement = stageClass === "evaluator" ? 1 : 0;
  const regressionIncrement = stageClass === "regression" ? 1 : 0;
  const row = await env.DB.prepare(
    `INSERT INTO pattern_ontology_provider_daily_usage (
       utc_date, used_calls, generator_calls, evaluator_calls,
       regression_calls, created_at, updated_at
     ) VALUES (?1, 1, ?4, ?5, ?6, ?2, ?2)
     ON CONFLICT (utc_date) DO UPDATE
       SET used_calls = used_calls + 1,
           generator_calls = generator_calls + ?4,
           evaluator_calls = evaluator_calls + ?5,
           regression_calls = regression_calls + ?6,
           updated_at = ?2
       WHERE used_calls < ?3
     RETURNING used_calls`,
  )
    .bind(
      utcDate,
      now,
      limit,
      generatorIncrement,
      evaluatorIncrement,
      regressionIncrement,
    )
    .first<{ used_calls: number }>();

  if (!row) return { ok: false, reason: "exhausted" };
  return { ok: true, used: row.used_calls };
}

/** The Task 4 publisher's single accounting injection point. */
export function createOntologyProviderCallReservation(
  env: Pick<Env, "DB">,
  limit: number,
  now: () => Date = () => new Date(),
): (stageClass: OntologyProviderPass) => Promise<OntologyProviderBudgetOutcome> {
  return async (stageClass) => {
    const operationAt = now();
    return consumeOntologyProviderCallBudget(
      env,
      utcDateForOntologyProviderUsage(operationAt),
      limit,
      stageClass,
    );
  };
}

function requestArtifactClass(pass: OntologyProviderPass):
  | "generator_request"
  | "evaluator_request" {
  return pass === "generator" ? "generator_request" : "evaluator_request";
}

async function consumeClaimedOntologyProviderCallBudget(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  utcDate: string,
  operationAt: Date,
  options: Omit<ClaimedOntologyProviderReservationOptions, "now">,
): Promise<OntologyProviderReservationOutcome> {
  if (
    !isUtcDate(utcDate) ||
    !Number.isSafeInteger(options.dailyLimit) ||
    options.dailyLimit < 1 ||
    !Number.isSafeInteger(options.runLimit) ||
    options.runLimit < 1 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    (options.expectedPass === "generator" && claim.stage !== "generating") ||
    (options.expectedPass === "evaluator" && claim.stage !== "evaluating")
  ) {
    return { ok: false, reason: "claim_unavailable" };
  }

  const artifactClass = requestArtifactClass(options.expectedPass);
  const generatorIncrement = options.expectedPass === "generator" ? 1 : 0;
  const evaluatorIncrement = options.expectedPass === "evaluator" ? 1 : 0;
  const minimumLeaseSeconds = Math.ceil(
    (options.timeoutMs + ONTOLOGY_PROVIDER_PERSISTENCE_MARGIN_MS) / 1_000,
  );
  const operationAtIso = operationAt.toISOString();

  // One SQLite statement is both the exact-claim fence and the daily-ledger
  // increment. A request artifact is the immutable, run-scoped physical-call
  // identity; the <= boundary admits exactly the final allowed artifact.
  const row = await env.DB.prepare(
    `INSERT INTO pattern_ontology_provider_daily_usage (
       utc_date, used_calls, generator_calls, evaluator_calls,
       regression_calls, created_at, updated_at
     )
     SELECT ?1, 1, ?4, ?5, 0, ?2, ?2
     FROM pattern_ontology_pipeline_runs run
     WHERE run.run_id = ?6 AND run.stage = ?7
       AND run.stage_generation = ?8 AND run.stage_cursor = ?9
       AND run.stage_attempt = ?10 AND run.claim_token = ?11
       AND run.lease_expires_at = ?12
       AND unixepoch(run.lease_expires_at) >=
         unixepoch('now') + ?13
       AND EXISTS (
         SELECT 1 FROM pattern_ontology_pipeline_artifacts artifact
         WHERE artifact.run_id = run.run_id
           AND artifact.stage = run.stage
           AND artifact.stage_generation = run.stage_generation
           AND artifact.stage_attempt = run.stage_attempt
           AND artifact.artifact_class = ?14
           AND artifact.deleted_at IS NULL
       )
       AND (
         SELECT COUNT(*) FROM pattern_ontology_pipeline_artifacts inventory
         WHERE inventory.run_id = run.run_id
           AND inventory.artifact_class = ?14
       ) <= ?15
     ON CONFLICT (utc_date) DO UPDATE
       SET used_calls = used_calls + 1,
           generator_calls = generator_calls + ?4,
           evaluator_calls = evaluator_calls + ?5,
           updated_at = ?2
       WHERE used_calls < ?3
     RETURNING used_calls`,
  ).bind(
    utcDate,
    operationAtIso,
    options.dailyLimit,
    generatorIncrement,
    evaluatorIncrement,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
    minimumLeaseSeconds,
    artifactClass,
    options.runLimit,
  ).first<{ used_calls: number }>();

  if (row) return { ok: true, used: row.used_calls };

  const diagnostic = await env.DB.prepare(
    `SELECT
       (
         SELECT COUNT(*) FROM pattern_ontology_pipeline_artifacts inventory
         WHERE inventory.run_id = ?1 AND inventory.artifact_class = ?2
       ) AS request_count,
       EXISTS (
         SELECT 1 FROM pattern_ontology_pipeline_runs run
         WHERE run.run_id = ?1 AND run.stage = ?3
           AND run.stage_generation = ?4 AND run.stage_cursor = ?5
           AND run.stage_attempt = ?6 AND run.claim_token = ?7
           AND run.lease_expires_at = ?8
           AND unixepoch(run.lease_expires_at) >=
             unixepoch('now') + ?9
           AND EXISTS (
             SELECT 1 FROM pattern_ontology_pipeline_artifacts artifact
             WHERE artifact.run_id = run.run_id
               AND artifact.stage = run.stage
               AND artifact.stage_generation = run.stage_generation
               AND artifact.stage_attempt = run.stage_attempt
               AND artifact.artifact_class = ?2
               AND artifact.deleted_at IS NULL
           )
       ) AS claim_available`,
  ).bind(
    claim.runId,
    artifactClass,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
    minimumLeaseSeconds,
  ).first<{ request_count: number; claim_available: number }>();

  if ((diagnostic?.request_count ?? 0) > options.runLimit) {
    return { ok: false, reason: "run_exhausted" };
  }
  if (diagnostic?.claim_available !== 1) {
    return { ok: false, reason: "claim_unavailable" };
  }
  return { ok: false, reason: "exhausted" };
}

/**
 * The Task 6 publisher's sole reservation seam. It admits a call only while
 * the exact D1 claim still owns enough lease to cover provider timeout plus
 * response persistence, and only for an already-persisted request identity.
 */
export function createClaimedOntologyProviderCallReservation(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  options: ClaimedOntologyProviderReservationOptions,
): (stageClass: OntologyProviderPass) => Promise<OntologyProviderReservationOutcome> {
  const now = options.now ?? (() => new Date());
  return async (stageClass) => {
    if (stageClass !== options.expectedPass) {
      return { ok: false, reason: "claim_unavailable" };
    }
    const operationAt = now();
    return consumeClaimedOntologyProviderCallBudget(
      env,
      claim,
      utcDateForOntologyProviderUsage(operationAt),
      operationAt,
      options,
    );
  };
}
