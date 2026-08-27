import type { Env } from "../env.js";
import {
  cancelStaleCodexProviderJob,
  loadCodexProviderJob,
  type CodexProviderJob,
  type CodexProviderJobStatus,
  type CodexProviderPass,
  type CodexProviderPipeline,
} from "../db/codex-provider-jobs.js";
import { safeLog } from "./safe-log.js";
import { PATTERN_ARTIFACT_RETENTION_DAYS } from "./pattern-publisher.js";
import {
  codexProviderOwnerIsCurrent,
  nudgeCodexProviderOwner,
} from "./codex-provider-domain.js";

const MAINTENANCE_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface CodexProviderMaintenanceSummary {
  repaired: number;
  cancelled: number;
  purged: number;
  uploadsPurged: number;
}

async function candidateJobs(
  env: Pick<Env, "DB">,
  sql: string,
  bindings: unknown[],
): Promise<string[]> {
  const { results } = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

async function hasPipelineJobs(
  env: Pick<Env, "DB">,
  pipeline: CodexProviderPipeline,
): Promise<boolean> {
  return await env.DB.prepare(
    "SELECT 1 AS present FROM codex_provider_jobs WHERE pipeline = ? LIMIT 1",
  ).bind(pipeline).first<{ present: number }>() !== null;
}

async function cancelStaleJobs(
  env: Env,
  now: Date,
  pipeline: CodexProviderPipeline,
): Promise<number> {
  const ids = await candidateJobs(
    env,
    `SELECT id FROM codex_provider_jobs
     WHERE pipeline = ? AND (
       status = 'pending'
       OR (status = 'leased' AND lease_expires_at <= ?)
     )
     ORDER BY created_at, id LIMIT ?`,
    [pipeline, now.toISOString(), MAINTENANCE_LIMIT],
  );
  let cancelled = 0;
  for (const id of ids) {
    const job = await loadCodexProviderJob(env, id);
    if (!job || await codexProviderOwnerIsCurrent(env, job, now)) continue;
    if (await cancelStaleCodexProviderJob(env, id, now)) cancelled += 1;
  }
  return cancelled;
}

/**
 * Terminal provider jobs whose Daily owner is still parked waiting for them.
 *
 * `result_class = 'publisher_pending'` is the whole selector. A Daily job in
 * that state is queued, unclaimed, and marked dispatched — deliberately
 * invisible to the outbox sweep — so if its nudge was lost nothing else will
 * ever wake it. The dispatch-marker comparison is what distinguishes a nudge
 * that landed from one that did not: a successful nudge stamps `dispatched_at`
 * after the provider's completion instant.
 */
const READING_NUDGE_REPAIR_SQL = `SELECT provider.id
   FROM codex_provider_jobs provider
   JOIN jobs daily ON daily.id = provider.owner_id
   JOIN daily_readings reading
     ON reading.active_generation_job_id = daily.id
     AND reading.user_id = daily.user_id
   WHERE provider.pipeline = 'reading'
     AND provider.status IN ('completed', 'failed')
     AND provider.completed_at IS NOT NULL
     AND daily.job_type = 'generate_daily_reading'
     AND daily.status = 'queued'
     AND daily.claim_token IS NULL
     AND daily.result_class = 'publisher_pending'
     AND reading.status = 'pending'
     AND reading.assembly_mode = 'constrained_model'
     AND (
       daily.dispatched_at IS NULL
       OR julianday(daily.dispatched_at) <= julianday(provider.completed_at)
     )
   ORDER BY provider.completed_at, provider.id LIMIT ?`;

/**
 * Reading work whose owner has finished with it, one way or another.
 *
 * A terminal provider job whose Daily owner is STILL nonterminal with a pending
 * reservation is nudge-eligible, not cleanup-eligible: deleting its response
 * object would destroy the candidate the owner is about to adopt. Only once no
 * live owner remains — published, failed, cancelled, superseded, revoked, or
 * deleted — do the encrypted exchange artifacts become garbage.
 */
const READING_PURGE_SQL = `SELECT provider.id
   FROM codex_provider_jobs provider
   WHERE provider.pipeline = 'reading'
     AND provider.status IN ('completed', 'failed', 'cancelled')
     AND provider.completed_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM jobs daily
       JOIN daily_readings reading
         ON reading.active_generation_job_id = daily.id
         AND reading.user_id = daily.user_id
       WHERE daily.id = provider.owner_id
         AND daily.job_type = 'generate_daily_reading'
         AND daily.status IN ('queued', 'running')
         AND reading.status = 'pending'
     )
   ORDER BY provider.completed_at, provider.id LIMIT ?`;

async function repairTerminalNudges(
  env: Env,
  now: Date,
  pipeline: CodexProviderPipeline,
): Promise<number> {
  const sql = pipeline === "reading"
    ? READING_NUDGE_REPAIR_SQL
    : pipeline === "pattern"
    ? `SELECT provider.id
       FROM codex_provider_jobs provider
       JOIN pattern_generation_jobs pattern
         ON pattern.generation_id = provider.owner_id
       JOIN jobs pattern_job ON pattern_job.id = pattern.job_id
       WHERE provider.pipeline = 'pattern'
         AND provider.status IN ('completed', 'failed')
         AND provider.completed_at IS NOT NULL
         AND (
           pattern_job.dispatched_at IS NULL
           OR julianday(pattern_job.dispatched_at) <= julianday(provider.completed_at)
         )
       ORDER BY provider.completed_at, provider.id LIMIT ?`
    : `SELECT provider.id
       FROM codex_provider_jobs provider
       JOIN pattern_ontology_pipeline_runs ontology
         ON ontology.run_id = provider.owner_id
       WHERE provider.pipeline = 'ontology'
         AND provider.status IN ('completed', 'failed')
         AND provider.completed_at IS NOT NULL
         AND (
           ontology.dispatched_at IS NULL
           OR julianday(ontology.dispatched_at) <= julianday(provider.completed_at)
         )
       ORDER BY provider.completed_at, provider.id LIMIT ?`;
  const ids = await candidateJobs(
    env,
    sql,
    [MAINTENANCE_LIMIT],
  );
  let repaired = 0;
  for (const id of ids) {
    const job = await loadCodexProviderJob(env, id);
    if (!job) continue;
    const outcome = await nudgeCodexProviderOwner(env, job, now);
    safeLog({
      event: "codex_provider_nudge_observed",
      pipeline,
      outcome,
    });
    if (outcome === "sent") repaired += 1;
  }
  return repaired;
}

function objectKeys(job: CodexProviderJob): string[] {
  return job.response === null
    ? [job.request.objectKey]
    : [job.request.objectKey, job.response.objectKey];
}

async function hasUncommittedResponseUploads(
  env: Pick<Env, "DB">,
  job: CodexProviderJob,
): Promise<boolean> {
  const committedKey = job.response?.objectKey ?? null;
  const pending = await env.DB.prepare(
    `SELECT 1 AS present FROM codex_provider_response_uploads
     WHERE job_id = ? AND (? IS NULL OR object_key != ?) LIMIT 1`,
  ).bind(job.id, committedKey, committedKey).first<{ present: number }>();
  return pending !== null;
}

async function purgeTerminalJobs(
  env: Env,
  now: Date,
  pipeline: CodexProviderPipeline,
): Promise<number> {
  if (!env.ARTIFACTS) return 0;
  const patternCutoff = new Date(
    now.getTime() - PATTERN_ARTIFACT_RETENTION_DAYS * DAY_MS,
  ).toISOString();
  const ids = pipeline === "reading"
    ? await candidateJobs(env, READING_PURGE_SQL, [MAINTENANCE_LIMIT])
    : pipeline === "pattern"
    ? await candidateJobs(
      env,
      `SELECT id FROM codex_provider_jobs
       WHERE pipeline = 'pattern'
         AND status IN ('completed', 'failed', 'cancelled')
         AND completed_at IS NOT NULL AND completed_at <= ?
       ORDER BY completed_at, id LIMIT ?`,
      [patternCutoff, MAINTENANCE_LIMIT],
    )
    : await candidateJobs(
      env,
      `SELECT provider.id
       FROM codex_provider_jobs provider
       JOIN pattern_ontology_pipeline_runs ontology
         ON ontology.run_id = provider.owner_id
       WHERE provider.pipeline = 'ontology'
         AND provider.status IN ('completed', 'failed', 'cancelled')
         AND provider.completed_at IS NOT NULL
         AND ontology.stage = 'failed'
         AND ontology.failed_artifact_expires_at IS NOT NULL
         AND ontology.failed_artifact_expires_at <= ?
       ORDER BY provider.completed_at, provider.id LIMIT ?`,
      [now.toISOString(), MAINTENANCE_LIMIT],
    );
  let purged = 0;
  for (const id of ids) {
    const job = await loadCodexProviderJob(env, id);
    if (
      !job ||
      job.completedAt === null ||
      await codexProviderOwnerIsCurrent(env, job, now) ||
      await hasUncommittedResponseUploads(env, job)
    ) {
      continue;
    }
    const keys = objectKeys(job);
    try {
      await env.ARTIFACTS.delete(keys);
      const remaining = await Promise.all(
        keys.map((key) => env.ARTIFACTS!.head(key)),
      );
      if (remaining.some((object) => object !== null)) continue;
      const deleted = await env.DB.prepare(
        `DELETE FROM codex_provider_jobs
         WHERE id = ? AND status = ? AND completed_at = ?`,
      ).bind(job.id, job.status, job.completedAt).run();
      if (deleted.meta.changes === 1) purged += 1;
    } catch {
      // The immutable D1 pointers remain the retry inventory.
    }
  }
  return purged;
}

async function purgeStaleResponseUploads(
  env: Env,
  now: Date,
): Promise<number> {
  if (!env.ARTIFACTS) return 0;
  const nowIso = now.toISOString();
  const { results } = await env.DB.prepare(
    `SELECT upload.job_id, upload.lease_token_hash, upload.object_key
     FROM codex_provider_response_uploads upload
     JOIN codex_provider_jobs job ON job.id = upload.job_id
     WHERE NOT (
       job.status = 'completed'
       AND job.response_object_key = upload.object_key
     ) AND NOT (
       job.status = 'leased'
       AND job.lease_token_hash = upload.lease_token_hash
       AND job.lease_expires_at > ?
     )
     ORDER BY upload.created_at, upload.job_id LIMIT ?`,
  ).bind(nowIso, MAINTENANCE_LIMIT).all<{
    job_id: string;
    lease_token_hash: string;
    object_key: string;
  }>();
  let purged = 0;
  for (const upload of results) {
    try {
      await env.ARTIFACTS.delete(upload.object_key);
      if (await env.ARTIFACTS.head(upload.object_key)) continue;
      const deleted = await env.DB.prepare(
        `DELETE FROM codex_provider_response_uploads
         WHERE job_id = ? AND lease_token_hash = ? AND object_key = ?
           AND NOT EXISTS (
             SELECT 1 FROM codex_provider_jobs job
             WHERE job.id = codex_provider_response_uploads.job_id
               AND (
                 (
                   job.status = 'completed'
                   AND job.response_object_key =
                     codex_provider_response_uploads.object_key
                 ) OR (
                   job.status = 'leased'
                   AND job.lease_token_hash =
                     codex_provider_response_uploads.lease_token_hash
                   AND job.lease_expires_at > ?
                 )
               )
           )`,
      ).bind(
        upload.job_id,
        upload.lease_token_hash,
        upload.object_key,
        nowIso,
      ).run();
      if (deleted.meta.changes === 1) purged += 1;
    } catch {
      // The upload row remains the retry inventory.
    }
  }
  return purged;
}

/** Bounded repair, stale cancellation, and retention for both provider domains. */
export async function maintainCodexProviderJobs(
  env: Env,
  now = new Date(),
): Promise<CodexProviderMaintenanceSummary> {
  let cancelled = 0;
  let repaired = 0;
  let purged = 0;
  const uploadsPurged = await purgeStaleResponseUploads(env, now);
  for (const pipeline of ["pattern", "ontology", "reading"] as const) {
    if (!await hasPipelineJobs(env, pipeline)) continue;
    cancelled += await cancelStaleJobs(env, now, pipeline);
    repaired += await repairTerminalNudges(env, now, pipeline);
    purged += await purgeTerminalJobs(env, now, pipeline);
    await observePipeline(env, now, pipeline);
  }
  return { repaired, cancelled, purged, uploadsPurged };
}

/**
 * Content-free operational counters, one line per pipeline per pass.
 *
 * Everything here is a count, an age, or a closed status. Nothing carries a
 * prompt, an output, runner stderr, a user id, a chart id, a consent id, or a
 * word of generated prose — a metric is not a place to leak what a metric
 * exists to summarise.
 */
async function observePipeline(
  env: Env,
  now: Date,
  pipeline: CodexProviderPipeline,
): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT pass, status, COUNT(*) AS count,
            MIN(created_at) AS oldest_created_at
     FROM codex_provider_jobs
     WHERE pipeline = ?
     GROUP BY pass, status`,
  ).bind(pipeline).all<{
    pass: CodexProviderPass;
    status: CodexProviderJobStatus;
    count: number;
    oldest_created_at: string;
  }>();
  for (const row of results) {
    const waiting = row.status === "pending" || row.status === "leased";
    safeLog({
      event: "codex_provider_pipeline_observed",
      pipeline,
      pass: row.pass,
      status: row.status,
      count: row.count,
      oldest_age_seconds: waiting
        ? Math.max(
          0,
          Math.round((now.getTime() - Date.parse(row.oldest_created_at)) / 1000),
        )
        : null,
    });
  }
}
