import type { Env } from "../env.js";
import {
  cancelStaleCodexProviderJob,
  loadCodexProviderJob,
  type CodexProviderJob,
  type CodexProviderPipeline,
} from "../db/codex-provider-jobs.js";
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
    if (!job || await codexProviderOwnerIsCurrent(env, job)) continue;
    if (await cancelStaleCodexProviderJob(env, id, now)) cancelled += 1;
  }
  return cancelled;
}

async function repairTerminalNudges(
  env: Env,
  now: Date,
  pipeline: CodexProviderPipeline,
): Promise<number> {
  const sql = pipeline === "pattern"
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
    if (await nudgeCodexProviderOwner(env, job, now) === "sent") repaired += 1;
  }
  return repaired;
}

function objectKeys(job: CodexProviderJob): string[] {
  return job.response === null
    ? [job.request.objectKey]
    : [job.request.objectKey, job.response.objectKey];
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
  const ids = pipeline === "pattern"
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
      await codexProviderOwnerIsCurrent(env, job)
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

/** Bounded repair, stale cancellation, and retention for both provider domains. */
export async function maintainCodexProviderJobs(
  env: Env,
  now = new Date(),
): Promise<CodexProviderMaintenanceSummary> {
  let cancelled = 0;
  let repaired = 0;
  let purged = 0;
  for (const pipeline of ["pattern", "ontology"] as const) {
    if (!await hasPipelineJobs(env, pipeline)) continue;
    cancelled += await cancelStaleJobs(env, now, pipeline);
    repaired += await repairTerminalNudges(env, now, pipeline);
    purged += await purgeTerminalJobs(env, now, pipeline);
  }
  return { repaired, cancelled, purged };
}
