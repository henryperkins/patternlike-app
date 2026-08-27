import { PATTERN_JOB_TYPE } from "./pattern-command.js";
import {
  planPatternTransition,
  patternStageOwner,
  publicStageFor,
  type PatternDomainStage,
  type PatternStageState,
} from "./pattern-stage-protocol.js";
import { markDispatched } from "../db/generation.js";
import type { Env } from "../env.js";
import { safeLog } from "./safe-log.js";

/**
 * Claims one job may take across every stage before the sweep stops re-arming
 * it and fails it instead. The approved worst case makes 11 provider calls,
 * each in its own delivery, plus the publishing delivery: 12 claims before any
 * churn. Four further claims cover bounded lease expiry, artifact-adopting
 * redeliveries that spend nothing, and `{kind: "retry"}` returns: 12 + 4 = 16.
 * Provider spend is bounded independently by PATTERN_DAILY_PROVIDER_CALL_LIMIT.
 */
const MAX_STAGE_CLAIMS = 16;

export type PatternReconcileResult =
  | { ok: false; status: 404; code: "not_found" }
  | {
      ok: true;
      status: 202;
      body: { generation_id: string; status: "accepted" | "already_complete"; stage: string };
    };

/**
 * Operator recovery for a stuck Pattern job: re-nudge the queue when the
 * generic jobs row is still queued or running. Cancelled and other terminal
 * rows are not re-queued.
 */
export async function reconcilePatternGeneration(
  env: Env,
  generationId: string,
): Promise<PatternReconcileResult> {
  const row = await env.DB.prepare(
    `SELECT p.generation_id, p.stage, p.stage_generation, j.id AS job_id, j.status AS job_status
     FROM pattern_generation_jobs p
     JOIN jobs j ON j.id = p.job_id
     WHERE p.generation_id = ?`,
  )
    .bind(generationId)
    .first<{
      generation_id: string;
      stage: PatternDomainStage;
      stage_generation: number;
      job_id: string;
      job_status: string;
    }>();
  if (!row) return { ok: false, status: 404, code: "not_found" };

  const terminal =
    patternStageOwner(row.stage) === "terminal" ||
    row.job_status === "succeeded" ||
    row.job_status === "failed" ||
    row.job_status === "cancelled";
  if (terminal) {
    return {
      ok: true,
      status: 202,
      body: { generation_id: row.generation_id, status: "already_complete", stage: row.stage },
    };
  }

  if (row.job_status === "queued" || row.job_status === "running") {
    try {
      await env.PATTERN_QUEUE.send({
        kind: "pattern_generation",
        job_id: row.job_id,
        generation_id: row.generation_id,
        stage_generation: row.stage_generation,
      });
      if (row.job_status === "queued") {
        await markDispatched(env, row.job_id);
      }
    } catch {
      safeLog({ event: "pattern_dispatch_failed" });
    }
  }

  return {
    ok: true,
    status: 202,
    body: { generation_id: row.generation_id, status: "accepted", stage: row.stage },
  };
}

/**
 * Recover Pattern jobs that committed but were never sent, and drop expired
 * generation artifacts. Cron does not enter Hono, so the caller already ran
 * checkSecureConfig.
 */
/**
 * Compatibility repair for Pattern jobs parked by the removed rollout switch.
 *
 * No new row can acquire `result_class = 'rollout_paused'`; these are the rows
 * a prior deployment left behind. The outbox lane skips that class forever, so
 * clearing it returns the row to the ordinary undispatched query.
 *
 * A job parked mid-flight is parked while `status = 'running'`, so resuming
 * only `'queued'` rows left it in the running lane. Those rows come back to
 * `'queued'` here, and only once their lease has lapsed, so a consumer still
 * working the stage is never robbed of its claim.
 */
export async function resumePausedPatternJobsAfterRollout(
  env: Env,
  now = new Date(),
): Promise<number> {
  const nowIso = now.toISOString();
  const updated = await env.DB.prepare(
    `UPDATE jobs
     SET available_at = ?, result_class = NULL, status = 'queued',
         claim_token = NULL, lease_expires_at = NULL
     WHERE job_type = ? AND result_class = 'rollout_paused'
       AND (
         status = 'queued'
         OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?))
       )`,
  )
    .bind(nowIso, PATTERN_JOB_TYPE, nowIso)
    .run();
  return updated.meta.changes ?? 0;
}


/**
 * Terminal state for a job whose stage has been claimed MAX_STAGE_CLAIMS times
 * without completing. Composes the same `{kind: "fail"}` transition the
 * executor commits, but keyed on the expired lease rather than on a claim
 * token the sweep never held.
 *
 * The expired-lease selector filters on the `jobs` row alone, so `row.stage`
 * may already be terminal while `jobs.status` is still `running` -- a torn
 * state this very function produces when `claimStage` steals the lease between
 * the SELECT and the batch below, leaving statement 1 matching zero rows while
 * statement 2 still commits. `planPatternTransition` refuses a terminal input,
 * so only the domain statement drops out: the jobs repair and the claim
 * release must still run, or nothing ever takes the row back out of the
 * recovery window and it occupies a slot on every later tick.
 */
async function failExhaustedPatternJob(
  env: Env,
  row: PatternStageState & {
    job_id: string;
    user_id: string;
    claim_id: string;
  },
  nowIso: string,
): Promise<void> {
  const effect =
    patternStageOwner(row.stage) === "terminal"
      ? null
      : planPatternTransition(
          row,
          {
            kind: "fail",
            failureClass: "stage_attempts_exhausted",
            publicStage: publicStageFor(row.stage) ?? "organizing_evidence",
          },
          new Date(nowIso),
        );
  const repairJobRow = env.DB.prepare(
    `UPDATE jobs SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
            finished_at = ?, result_class = 'stage_attempts_exhausted'
     WHERE id = ? AND job_type = ? AND status = 'running' AND lease_expires_at < ?`,
  ).bind(nowIso, row.job_id, PATTERN_JOB_TYPE, nowIso);

  const failDomainStage = effect
    ? env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = ?, stage_generation = ?,
             planner_attempts = ?, writer_attempts = ?, verifier_attempts = ?,
             plan_hash = ?, candidate_hash = ?, semantic_verdict_hash = ?,
             updated_at = ?, finished_at = ?, public_failure_stage = ?,
             failure_class = ?, retention_expires_at = ?
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(
        effect.next.stage,
        effect.next.stage_generation,
        effect.next.planner_attempts,
        effect.next.writer_attempts,
        effect.next.verifier_attempts,
        effect.next.plan_hash,
        effect.next.candidate_hash,
        effect.next.semantic_verdict_hash,
        nowIso,
        nowIso,
        effect.publicFailureStage!,
        effect.resultClass!,
        effect.retentionExpiresAt!.toISOString(),
        row.generation_id,
        row.stage_generation,
      )
    : null;

  const releaseClaim = env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'available', active_generation_id = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'reserved' AND consumed_at IS NULL
       AND active_generation_id = ?`,
  ).bind(nowIso, row.claim_id, row.user_id, row.generation_id);

  try {
    await env.DB.batch(
      failDomainStage
        ? [repairJobRow, failDomainStage, releaseClaim]
        : [repairJobRow, releaseClaim],
    );
    safeLog({ event: "pattern_stage_terminal_failure" });
  } catch {
    // Distinct from the success event on purpose: routing this path through a
    // planner that can refuse its input made a silent skip indistinguishable
    // from a completed repair in the logs.
    safeLog({ event: "pattern_stage_terminal_failure_write_failed" });
  }
}

/**
 * Spec 15: prune terminal job metadata once its retention period elapses.
 *
 * The `{kind: "fail"}` transition stamps `retention_expires_at` 30 days out
 * (`FAILURE_RETENTION_MS`) and 0007 indexes it, but
 * nothing read the column: the frozen command in `jobs.payload_enc` -- chart
 * id, chart fingerprint hash, feature-set hash, consent id, all under the
 * user's DEK -- was kept for the life of the account. Clearing the column as
 * the ciphertext goes takes the row back out of the partial index so a later
 * tick does no work.
 */
async function prunePatternJobRetention(env: Env, nowIso: string): Promise<void> {
  const { results: expiredJobs } = await env.DB.prepare(
    `SELECT generation_id, job_id FROM pattern_generation_jobs
     WHERE retention_expires_at IS NOT NULL AND finished_at IS NOT NULL
       AND retention_expires_at <= ?
     ORDER BY retention_expires_at, generation_id
     LIMIT 100`,
  )
    .bind(nowIso)
    .all<{ generation_id: string; job_id: string }>();

  for (const row of expiredJobs) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE jobs SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
           WHERE id = ?`,
        ).bind(row.job_id),
        env.DB.prepare(
          `UPDATE pattern_generation_artifact_keys
           SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL,
               erased_at = COALESCE(erased_at, ?)
           WHERE generation_id = ? AND erased_at IS NULL`,
        ).bind(nowIso, row.generation_id),
        env.DB.prepare(
          `UPDATE pattern_generation_jobs SET retention_expires_at = NULL, updated_at = ?
           WHERE generation_id = ?`,
        ).bind(nowIso, row.generation_id),
      ]);
    } catch {
      safeLog({ event: "pattern_artifact_cleanup_failed" });
    }
  }
}

export async function sweepPatternJobs(env: Env, now = new Date()): Promise<void> {
  await resumePausedPatternJobsAfterRollout(env, now);
  const nowIso = now.toISOString();
  const { results: undispatched } = await env.DB.prepare(
    `SELECT j.id AS job_id, p.generation_id, p.stage_generation
     FROM jobs j
     JOIN pattern_generation_jobs p ON p.job_id = j.id
     WHERE j.job_type = ? AND j.status = 'queued' AND j.dispatched_at IS NULL
       AND j.result_class IS NOT 'rollout_paused'
       AND (j.available_at IS NULL OR j.available_at <= ?)
     ORDER BY j.created_at, j.id
     LIMIT 50`,
  )
    .bind(PATTERN_JOB_TYPE, nowIso)
    .all<{ job_id: string; generation_id: string; stage_generation: number }>();

  for (const row of undispatched) {
    try {
      await env.PATTERN_QUEUE.send({
        kind: "pattern_generation",
        job_id: row.job_id,
        generation_id: row.generation_id,
        stage_generation: row.stage_generation,
      });
      await markDispatched(env, row.job_id);
    } catch {
      safeLog({ event: "pattern_dispatch_failed" });
    }
  }

  const { results: expiredLeases } = await env.DB.prepare(
    `SELECT j.id AS job_id, j.attempts, p.generation_id, p.stage, p.stage_generation,
            p.planner_attempts, p.writer_attempts, p.verifier_attempts,
            p.plan_hash, p.candidate_hash, p.semantic_verdict_hash,
            p.user_id, p.claim_id
     FROM jobs j
     JOIN pattern_generation_jobs p ON p.job_id = j.id
     WHERE j.job_type = ? AND j.status = 'running' AND j.lease_expires_at < ?
       AND j.result_class IS NOT 'rollout_paused'
     ORDER BY j.lease_expires_at, j.id
     LIMIT 50`,
  )
    .bind(PATTERN_JOB_TYPE, nowIso)
    .all<{
      job_id: string;
      attempts: number;
      generation_id: string;
      stage: PatternDomainStage;
      stage_generation: number;
      planner_attempts: number;
      writer_attempts: number;
      verifier_attempts: number;
      plan_hash: string | null;
      candidate_hash: string | null;
      semantic_verdict_hash: string | null;
      user_id: string;
      claim_id: string;
    }>();

  for (const row of expiredLeases) {
    if (row.attempts >= MAX_STAGE_CLAIMS) {
      // Re-arming this would charge the provider budget again for a stage that
      // has already failed to complete MAX_STAGE_CLAIMS times. Fail it instead:
      // a job left running holds the reader's one Pattern opportunity, while a
      // failed one returns the claim and gives them a retry affordance.
      await failExhaustedPatternJob(env, row, nowIso);
      continue;
    }
    try {
      await env.PATTERN_QUEUE.send({
        kind: "pattern_generation",
        job_id: row.job_id,
        generation_id: row.generation_id,
        stage_generation: row.stage_generation,
      });
    } catch {
      safeLog({ event: "pattern_dispatch_failed" });
    }
  }

  await prunePatternJobRetention(env, nowIso);

  const { results: expired } = await env.DB.prepare(
    `SELECT object_key, generation_id FROM pattern_generation_artifacts
     WHERE expires_at <= ? AND deleted_at IS NULL
     ORDER BY expires_at, object_key
     LIMIT 100`,
  )
    .bind(nowIso)
    .all<{ object_key: string; generation_id: string }>();

  if (expired.length === 0 || !env.ARTIFACTS) return;

  const deletedKeys: string[] = [];
  const deletedGenerations = new Set<string>();
  for (const row of expired) {
    try {
      await env.ARTIFACTS.delete(row.object_key);
    } catch {
      continue;
    }
    const stillThere = await env.ARTIFACTS.head(row.object_key);
    if (stillThere) continue;
    deletedKeys.push(row.object_key);
    deletedGenerations.add(row.generation_id);
  }

  for (const objectKey of deletedKeys) {
    await env.DB.prepare(
      `UPDATE pattern_generation_artifacts SET deleted_at = ?
       WHERE object_key = ? AND deleted_at IS NULL`,
    )
      .bind(nowIso, objectKey)
      .run();
  }

  for (const generationId of deletedGenerations) {
    const leftover = await env.DB.prepare(
      `SELECT 1 AS present FROM pattern_generation_artifacts
       WHERE generation_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
      .bind(generationId)
      .first<{ present: number }>();
    if (leftover) continue;
    await env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL, wrapped_key_nonce = NULL,
           erased_at = COALESCE(erased_at, ?)
       WHERE generation_id = ?`,
    )
      .bind(nowIso, generationId)
      .run();
  }
}
