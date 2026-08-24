import type { Env } from "../env.js";
import type { CodexProviderJob } from "../db/codex-provider-jobs.js";
import {
  loadPatternJob,
  patternStageOwner,
} from "./pattern-stage-protocol.js";

interface OntologyOwnerRow {
  stage: string;
  stage_generation: number;
  stage_attempt: number;
  claim_token: string | null;
  lease_expires_at: string | null;
}

function ontologyStageFor(job: CodexProviderJob): string | null {
  if (job.pass === "generator") return "generating";
  if (job.pass === "evaluator") return "evaluating";
  if (
    job.pass === "planner" ||
    job.pass === "writer" ||
    job.pass === "verifier"
  ) {
    return "regressing";
  }
  return null;
}

async function loadOntologyOwner(
  env: Pick<Env, "DB">,
  runId: string,
): Promise<OntologyOwnerRow | null> {
  return env.DB.prepare(
    `SELECT stage, stage_generation, stage_attempt, claim_token,
            lease_expires_at
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(runId).first<OntologyOwnerRow>();
}

export async function codexProviderOwnerIsCurrent(
  env: Pick<Env, "DB">,
  job: CodexProviderJob,
): Promise<boolean> {
  if (job.pipeline === "pattern") {
    const owner = await loadPatternJob(env, job.ownerId);
    if (!owner || owner.user_id !== job.userId) return false;
    const attempt = job.pass === "planner"
      ? owner.planner_attempts
      : job.pass === "writer"
        ? owner.writer_attempts
        : job.pass === "verifier"
          ? owner.verifier_attempts
          : -1;
    return patternStageOwner(owner.stage) === job.pass &&
      owner.stage_generation === job.stageGeneration &&
      attempt === job.stageAttempt;
  }

  const owner = await loadOntologyOwner(env, job.ownerId);
  return owner !== null &&
    owner.stage === ontologyStageFor(job) &&
    owner.stage_generation === job.stageGeneration &&
    owner.stage_attempt === job.stageAttempt;
}

export type CodexProviderNudgeOutcome =
  | "sent"
  | "not_current"
  | "still_owned"
  | "send_failed";

export async function nudgeCodexProviderOwner(
  env: Pick<Env, "DB" | "PATTERN_QUEUE" | "ONTOLOGY_PIPELINE_QUEUE">,
  job: CodexProviderJob,
  now = new Date(),
): Promise<CodexProviderNudgeOutcome> {
  if (!await codexProviderOwnerIsCurrent(env, job)) return "not_current";
  const at = now.toISOString();

  if (job.pipeline === "pattern") {
    const owner = await loadPatternJob(env, job.ownerId);
    if (!owner) return "not_current";
    const released = await env.DB.prepare(
      `UPDATE jobs SET dispatched_at = NULL
       WHERE id = ? AND status = 'queued' AND claim_token IS NULL
         AND EXISTS (
           SELECT 1 FROM pattern_generation_jobs p
           WHERE p.job_id = jobs.id AND p.generation_id = ?
             AND p.stage_generation = ?
         )`,
    ).bind(owner.job_id, job.ownerId, job.stageGeneration).run();
    if (released.meta.changes !== 1) return "still_owned";
    try {
      await env.PATTERN_QUEUE.send({
        kind: "pattern_generation",
        job_id: owner.job_id,
        generation_id: job.ownerId,
        stage_generation: job.stageGeneration,
      });
    } catch {
      return "send_failed";
    }
    await env.DB.prepare(
      `UPDATE jobs SET dispatched_at = ?
       WHERE id = ? AND status = 'queued' AND claim_token IS NULL
         AND dispatched_at IS NULL`,
    ).bind(at, owner.job_id).run();
    return "sent";
  }

  const expectedStage = ontologyStageFor(job);
  if (!expectedStage) return "not_current";
  const released = await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = NULL, updated_at = ?
     WHERE run_id = ? AND stage = ? AND stage_generation = ?
       AND stage_attempt = ? AND claim_token IS NULL
       AND lease_expires_at IS NULL`,
  ).bind(
    at,
    job.ownerId,
    expectedStage,
    job.stageGeneration,
    job.stageAttempt,
  ).run();
  if (released.meta.changes !== 1) return "still_owned";
  try {
    await env.ONTOLOGY_PIPELINE_QUEUE.send({
      run_id: job.ownerId,
      stage_generation: job.stageGeneration,
    });
  } catch {
    return "send_failed";
  }
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = ?, updated_at = ?
     WHERE run_id = ? AND stage = ? AND stage_generation = ?
       AND stage_attempt = ? AND claim_token IS NULL
       AND lease_expires_at IS NULL AND dispatched_at IS NULL`,
  ).bind(
    at,
    at,
    job.ownerId,
    expectedStage,
    job.stageGeneration,
    job.stageAttempt,
  ).run();
  return "sent";
}
