import type { Env, OntologyPipelineMessage } from "../env.js";

export type OntologyPipelineStage =
  | "reserved"
  | "corpus_reading"
  | "generating"
  | "compiling"
  | "evaluating"
  | "regressing"
  | "signing"
  | "ingesting"
  | "succeeded"
  | "failed";

export type OntologyPipelineFailureClass =
  | "corpus_unavailable"
  | "corpus_invalid"
  | "corpus_hash_mismatch"
  | "configuration_invalid"
  | "provider_not_configured"
  | "provider_budget_exhausted"
  | "provider_refusal"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_response_invalid"
  | "artifact_conflict"
  | "artifact_unavailable"
  | "artifact_integrity_failed"
  | "candidate_invalid"
  | "compilation_failed"
  | "evaluation_rejected"
  | "regression_failed"
  | "regression_budget_exceeded"
  | "signing_failed"
  | "ingestion_failed"
  | "attempts_exhausted"
  | "execution_error";

interface OntologyPipelineRunRow {
  run_id: string;
  stage: OntologyPipelineStage;
  stage_generation: number;
  stage_cursor: number;
  stage_attempt: number;
  claim_token: string | null;
  lease_expires_at: string | null;
  available_at: string;
  dispatched_at: string | null;
}

export interface ClaimedOntologyPipelineRun {
  status: "claimed";
  runId: string;
  stage: Exclude<OntologyPipelineStage, "succeeded" | "failed">;
  stageGeneration: number;
  stageCursor: number;
  stageAttempt: number;
  claimToken: string;
  leaseExpiresAt: string;
}

export type ClaimOntologyPipelineRunResult =
  | ClaimedOntologyPipelineRun
  | { status: "parked" }
  | { status: "duplicate" };

export type OntologyPipelineClaimOwnership = "all" | "task6";

const CLAIM_LEASE_MS = 5 * 60 * 1_000;
export const MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS = 16;
export const ONTOLOGY_PIPELINE_RECOVERY_LIMIT = 4;

/** Stable, range-queryable receipt prefix expressed against a runs-table alias. */
function claimReceiptPrefixSql(alias: string): string {
  return `'ontology_pipeline_claim/' || length(${alias}.run_id) || ':' ||
    ${alias}.run_id || '/' || ${alias}.stage || '/' ||
    ${alias}.stage_generation || '/' || ${alias}.stage_cursor || '/' ||
    ${alias}.stage_attempt || '/'`;
}

function toClaim(row: OntologyPipelineRunRow): ClaimedOntologyPipelineRun {
  if (
    row.stage === "succeeded" ||
    row.stage === "failed" ||
    row.claim_token === null ||
    row.lease_expires_at === null
  ) {
    throw new Error("ontology_pipeline_claim_integrity_failed");
  }
  return {
    status: "claimed",
    runId: row.run_id,
    stage: row.stage,
    stageGeneration: row.stage_generation,
    stageCursor: row.stage_cursor,
    stageAttempt: row.stage_attempt,
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at,
  };
}

/** Atomically takes one five-minute delivery lease for the exact generation. */
export async function claimOntologyPipelineRun(
  env: Pick<Env, "DB">,
  message: OntologyPipelineMessage,
  now = new Date(),
  claimToken = `opclaim_${crypto.randomUUID()}`,
  ownership: OntologyPipelineClaimOwnership = "all",
): Promise<ClaimOntologyPipelineRunResult> {
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const receiptPrefixExpression = claimReceiptPrefixSql("run");
  const ownedStagePredicate = ownership === "task6"
    ? "AND run.stage IN ('reserved', 'corpus_reading', 'generating', 'compiling', 'evaluating')"
    : "";
  const [, claimed, parked] = await env.DB.batch([
    env.DB.prepare(
      `WITH delivery AS (
         SELECT run.*,
                ${receiptPrefixExpression} AS receipt_prefix
         FROM pattern_ontology_pipeline_runs run
         WHERE run.run_id = ? AND run.stage_generation = ?
           AND run.stage NOT IN ('succeeded', 'failed')
           ${ownedStagePredicate}
           AND run.claim_token IS NULL AND run.lease_expires_at IS NULL
           AND unixepoch(run.available_at) <= unixepoch(?)
       ), counted AS (
         SELECT delivery.*,
                (SELECT COUNT(*) FROM audit_events receipt
                 WHERE receipt.id >= delivery.receipt_prefix
                   AND receipt.id < delivery.receipt_prefix || '~'
                   AND receipt.action = 'ontology_pipeline.claim_acquired'
                   AND receipt.resource_type = 'ontology_pipeline_delivery')
                   AS claim_count
         FROM delivery
       )
       INSERT INTO audit_events (
         id, actor_type, actor_id, action, resource_type, resource_id,
         result, detail_class, created_at
       )
       SELECT receipt_prefix || printf('%02d', claim_count + 1),
              'service', ?, 'ontology_pipeline.claim_acquired',
              'ontology_pipeline_delivery', run_id, 'success', stage, ?
       FROM counted
       WHERE claim_count < ?`,
    ).bind(
      message.run_id,
      message.stage_generation,
      nowIso,
      claimToken,
      nowIso,
      MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs AS run
       SET claim_token = ?, lease_expires_at = ?,
           dispatched_at = COALESCE(dispatched_at, ?), updated_at = ?
       WHERE run.run_id = ? AND run.stage_generation = ?
         AND run.stage NOT IN ('succeeded', 'failed')
         ${ownedStagePredicate}
         AND run.claim_token IS NULL AND run.lease_expires_at IS NULL
         AND unixepoch(run.available_at) <= unixepoch(?)
         AND EXISTS (
           SELECT 1 FROM audit_events receipt
           WHERE receipt.id >= ${receiptPrefixExpression}
             AND receipt.id < ${receiptPrefixExpression} || '~'
             AND receipt.actor_id = ?
             AND receipt.action = 'ontology_pipeline.claim_acquired'
             AND receipt.resource_type = 'ontology_pipeline_delivery'
         )`,
    ).bind(
      claimToken,
      leaseExpiresAt,
      nowIso,
      nowIso,
      message.run_id,
      message.stage_generation,
      nowIso,
      claimToken,
    ),
    env.DB.prepare(
      ownership === "task6"
        ? `UPDATE pattern_ontology_pipeline_runs
           SET dispatched_at = NULL, updated_at = ?
           WHERE run_id = ? AND stage_generation = ?
             AND stage IN ('regressing', 'signing', 'ingesting')
             AND claim_token IS NULL AND lease_expires_at IS NULL`
        : `UPDATE pattern_ontology_pipeline_runs SET updated_at = updated_at
           WHERE 0 AND run_id = ? AND stage_generation = ? AND ? IS NOT NULL`,
    ).bind(
      ...(ownership === "task6"
        ? [nowIso, message.run_id, message.stage_generation]
        : [message.run_id, message.stage_generation, nowIso]),
    ),
  ]);
  if (claimed.meta.changes !== 1) {
    return parked.meta.changes === 1
      ? { status: "parked" }
      : { status: "duplicate" };
  }

  const row = await env.DB.prepare(
    `SELECT run_id, stage, stage_generation, stage_cursor, stage_attempt,
            claim_token, lease_expires_at, available_at, dispatched_at
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(message.run_id).first<OntologyPipelineRunRow>();
  if (!row || row.claim_token !== claimToken) {
    throw new Error("ontology_pipeline_claim_integrity_failed");
  }
  return toClaim(row);
}

function claimWhere(): string {
  return `run_id = ? AND stage = ? AND stage_generation = ?
    AND stage_cursor = ? AND stage_attempt = ? AND claim_token = ?
    AND lease_expires_at = ?
    AND julianday('now') < julianday(lease_expires_at)`;
}

/** Terminal failure CAS. Migration triggers assign existing artifacts the exact TTL. */
export async function failOntologyPipelineRun(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  failureClass: OntologyPipelineFailureClass,
  now = new Date(),
): Promise<boolean> {
  const terminalAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = 'failed', stage_generation = stage_generation + 1,
         claim_token = NULL, lease_expires_at = NULL,
         failure_class = ?, failed_artifact_expires_at = ?,
         updated_at = ?, finished_at = ?, failed_at = ?
     WHERE ${claimWhere()}`,
  ).bind(
    failureClass,
    expiresAt,
    terminalAt,
    terminalAt,
    terminalAt,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
  ).run();
  // The migration's AFTER trigger updates every live artifact expiry, so D1's
  // change count may include more than the one CAS-owned run row.
  return result.meta.changes > 0;
}

/** Successful terminal CAS, admitted only from ingesting by migration guards. */
export async function succeedOntologyPipelineRun(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  now = new Date(),
): Promise<boolean> {
  const terminalAt = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = 'succeeded', stage_generation = stage_generation + 1,
         claim_token = NULL, lease_expires_at = NULL,
         updated_at = ?, finished_at = ?, succeeded_at = ?
     WHERE ${claimWhere()}`,
  ).bind(
    terminalAt,
    terminalAt,
    terminalAt,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
  ).run();
  return result.meta.changes === 1;
}

export interface OntologyPipelineEvidenceHashes {
  candidateHash?: string;
  compilationReportHash?: string;
  evaluationReportHash?: string;
  regressionReportHash?: string;
  bundleHash?: string;
}

/** Releases an owned stage as a true retry without advancing generation. */
export async function retryOntologyPipelineStage(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  availableAt = new Date(),
): Promise<boolean> {
  const at = availableAt.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage_attempt = stage_attempt + 1,
         claim_token = NULL, lease_expires_at = NULL,
         dispatched_at = NULL, available_at = ?, updated_at = ?
     WHERE ${claimWhere()}`,
  ).bind(
    at,
    at,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
  ).run();
  return result.meta.changes === 1;
}

/**
 * Releases a live claim while keeping the same provider coordinate parked.
 * The two statements run in one D1 transaction: the first uses the migration's
 * same-attempt recovery transition, and the second restores the outbox hold so
 * only a provider completion (or repair) can redispatch it.
 */
export async function deferOntologyPipelineForProvider(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const [released, held] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET claim_token = NULL, lease_expires_at = NULL,
           dispatched_at = NULL, updated_at = ?
       WHERE ${claimWhere()}`,
    ).bind(
      at,
      claim.runId,
      claim.stage,
      claim.stageGeneration,
      claim.stageCursor,
      claim.stageAttempt,
      claim.claimToken,
      claim.leaseExpiresAt,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET dispatched_at = ?, updated_at = ?
       WHERE run_id = ? AND stage = ? AND stage_generation = ?
         AND stage_cursor = ? AND stage_attempt = ?
         AND claim_token IS NULL AND lease_expires_at IS NULL
         AND dispatched_at IS NULL AND updated_at = ?`,
    ).bind(
      at,
      at,
      claim.runId,
      claim.stage,
      claim.stageGeneration,
      claim.stageCursor,
      claim.stageAttempt,
      at,
    ),
  ]);
  return released.meta.changes === 1 && held.meta.changes === 1;
}

/** Advances one iterative item and creates a new queue generation. */
export async function advanceOntologyPipelineCursor(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage_generation = stage_generation + 1,
         stage_cursor = stage_cursor + 1, stage_attempt = 0,
         claim_token = NULL, lease_expires_at = NULL,
         dispatched_at = NULL, available_at = ?, updated_at = ?
     WHERE ${claimWhere()}`,
  ).bind(
    at,
    at,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
  ).run();
  return result.meta.changes === 1;
}

/** Advances to the next named stage and publishes write-once evidence hashes. */
export async function advanceOntologyPipelineStage(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  nextStage: Exclude<OntologyPipelineStage, "reserved" | "succeeded" | "failed">,
  evidence: OntologyPipelineEvidenceHashes,
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const result = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = ?, stage_generation = stage_generation + 1,
         stage_cursor = 0, stage_attempt = 0,
         claim_token = NULL, lease_expires_at = NULL,
         dispatched_at = NULL, available_at = ?, updated_at = ?,
         candidate_hash = COALESCE(candidate_hash, ?),
         compilation_report_hash = COALESCE(compilation_report_hash, ?),
         evaluation_report_hash = COALESCE(evaluation_report_hash, ?),
         regression_report_hash = COALESCE(regression_report_hash, ?),
         bundle_hash = COALESCE(bundle_hash, ?)
     WHERE ${claimWhere()}`,
  ).bind(
    nextStage,
    at,
    at,
    evidence.candidateHash ?? null,
    evidence.compilationReportHash ?? null,
    evidence.evaluationReportHash ?? null,
    evidence.regressionReportHash ?? null,
    evidence.bundleHash ?? null,
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
    claim.leaseExpiresAt,
  ).run();
  return result.meta.changes === 1;
}

/** Returns expired owners to the same attempt's undispatched lane. */
export async function releaseExpiredOntologyPipelineLeases(
  env: Pick<Env, "DB">,
  now = new Date(),
  limit = ONTOLOGY_PIPELINE_RECOVERY_LIMIT,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return 0;
  const at = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const receiptPrefixExpression = claimReceiptPrefixSql("run");
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = 'failed', stage_generation = stage_generation + 1,
         claim_token = NULL, lease_expires_at = NULL,
         failure_class = 'attempts_exhausted',
         failed_artifact_expires_at = ?, updated_at = ?,
         finished_at = ?, failed_at = ?
     WHERE rowid IN (
       SELECT run.rowid
       FROM pattern_ontology_pipeline_runs run
       WHERE run.stage NOT IN ('succeeded', 'failed')
         AND run.claim_token IS NOT NULL
         AND run.lease_expires_at IS NOT NULL
         AND unixepoch(run.lease_expires_at) <= unixepoch(?)
         AND (SELECT COUNT(*) FROM audit_events receipt
              WHERE receipt.id >= ${receiptPrefixExpression}
                AND receipt.id < ${receiptPrefixExpression} || '~'
                AND receipt.action = 'ontology_pipeline.claim_acquired'
                AND receipt.resource_type = 'ontology_pipeline_delivery') >= ?
       ORDER BY run.lease_expires_at, run.run_id
       LIMIT ?
     )`,
  ).bind(
    expiresAt,
    at,
    at,
    at,
    at,
    MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS,
    limit,
  ).run();
  const released = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET claim_token = NULL, lease_expires_at = NULL,
         dispatched_at = NULL, available_at = ?, updated_at = ?
     WHERE rowid IN (
       SELECT run.rowid
       FROM pattern_ontology_pipeline_runs run
       WHERE run.stage NOT IN ('succeeded', 'failed')
         AND run.claim_token IS NOT NULL
         AND run.lease_expires_at IS NOT NULL
         AND unixepoch(run.lease_expires_at) <= unixepoch(?)
         AND (SELECT COUNT(*) FROM audit_events receipt
              WHERE receipt.id >= ${receiptPrefixExpression}
                AND receipt.id < ${receiptPrefixExpression} || '~'
                AND receipt.action = 'ontology_pipeline.claim_acquired'
                AND receipt.resource_type = 'ontology_pipeline_delivery') < ?
       ORDER BY run.lease_expires_at, run.run_id
       LIMIT ?
     )`,
  ).bind(
    at,
    at,
    at,
    MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS,
    limit,
  ).run();
  return released.meta.changes ?? 0;
}
