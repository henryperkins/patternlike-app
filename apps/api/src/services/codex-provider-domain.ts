import type { Env } from "../env.js";
import type { CodexProviderJob } from "../db/codex-provider-jobs.js";
import { loadClaimForFingerprint, isConsumedStatus } from "../db/pattern-claims.js";
import { loadPatternGenerationGrant } from "../db/pattern-consents.js";
import { loadPreferences } from "../db/preferences.js";
import { loadUserIdentity } from "../db/users.js";
import { resolveOntologyPipelineConfiguration } from "../middleware/config-guard.js";
import {
  loadPatternJob,
  patternStageOwner,
} from "./pattern-stage-protocol.js";
import {
  PATTERN_PUBLISHER_CODEX,
  resolvePatternPublisherConfiguration,
  type PatternStageClass,
} from "./pattern-publisher.js";
import {
  consumerAdmissionEntry,
  patternRolloutAllows,
} from "./pattern-rollout.js";
import { ONTOLOGY_REGRESSION_PATTERN_PIN } from "./ontology-regression.js";
import { CODEX_PROVIDER_TIMEOUT_MS } from "./codex-provider-contract.js";
import { readingProviderOwnerIsCurrent } from "./reading-current-owner.js";

interface PatternOwnerRow {
  generation_id: string;
  job_id: string;
  user_id: string;
  claim_id: string;
  chart_id: string;
  chart_fingerprint_hash: string;
  locale: string;
  locale_revision: number;
  consent_id: string;
  ontology_version: string;
  reservation_reason:
    | "first_open"
    | "first_open_retry"
    | "failed_attempt_retry"
    | "chart_correction";
  stage: string;
  stage_generation: number;
  planner_attempts: number;
  writer_attempts: number;
  verifier_attempts: number;
}

interface OntologyOwnerRow {
  stage: string;
  stage_generation: number;
  stage_attempt: number;
  candidate_ontology_version: string;
  claim_token: string | null;
  lease_expires_at: string | null;
}

async function loadPatternOwner(
  env: Pick<Env, "DB">,
  generationId: string,
): Promise<PatternOwnerRow | null> {
  return env.DB.prepare(
    `SELECT generation_id, job_id, user_id, claim_id, chart_id,
            chart_fingerprint_hash, locale, locale_revision, consent_id,
            ontology_version, reservation_reason, stage, stage_generation,
            planner_attempts, writer_attempts, verifier_attempts
     FROM pattern_generation_jobs WHERE generation_id = ?`,
  ).bind(generationId).first<PatternOwnerRow>();
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
            lease_expires_at, candidate_ontology_version
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(runId).first<OntologyOwnerRow>();
}

function patternConfigurationIsCurrent(
  env: Env,
  job: CodexProviderJob,
  owner: PatternOwnerRow,
): boolean {
  if (
    job.userId === null ||
    job.pass === "generator" ||
    job.pass === "evaluator" ||
    job.pass === "publisher"
  ) {
    return false;
  }
  const resolved = resolvePatternPublisherConfiguration(env);
  if (
    !resolved.ok ||
    !resolved.config ||
    resolved.config.pin.publisher !== PATTERN_PUBLISHER_CODEX ||
    !patternRolloutAllows(
      resolved.rollout,
      consumerAdmissionEntry(env, owner.user_id, owner.reservation_reason),
    )
  ) {
    return false;
  }
  const pass: PatternStageClass = job.pass;
  return job.model === resolved.config.pin[`${pass}_model`] &&
    job.promptVersion === resolved.config.pin[`${pass}_prompt_version`] &&
    job.timeoutMs === resolved.config[`${pass}TimeoutMs`] &&
    job.dailyCallLimit === resolved.config.dailyCallLimit;
}

async function patternDomainIsCurrent(
  env: Env,
  job: CodexProviderJob,
  now: Date,
): Promise<boolean> {
  const owner = await loadPatternOwner(env, job.ownerId);
  if (!owner || owner.user_id !== job.userId) return false;
  const attempt = job.pass === "planner"
    ? owner.planner_attempts
    : job.pass === "writer"
      ? owner.writer_attempts
      : job.pass === "verifier"
        ? owner.verifier_attempts
        : -1;
  if (
    patternStageOwner(owner.stage as Parameters<typeof patternStageOwner>[0]) !==
      job.pass ||
    owner.stage_generation !== job.stageGeneration ||
    attempt !== job.stageAttempt ||
    !patternConfigurationIsCurrent(env, job, owner)
  ) {
    return false;
  }

  const identity = await loadUserIdentity(env, owner.user_id);
  if (!identity || identity.status !== "active") return false;
  const grant = await loadPatternGenerationGrant(env, owner.user_id, now);
  if (!grant || grant.consentId !== owner.consent_id) return false;
  const chart = await env.DB.prepare(
    `SELECT id FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  ).bind(owner.user_id).first<{ id: string }>();
  if (!chart || chart.id !== owner.chart_id) return false;
  const preferences = await loadPreferences(env, owner.user_id);
  const localeRevision = preferences?.localeUpdatedAt
    ? Date.parse(preferences.localeUpdatedAt) || 1
    : 1;
  if (
    !preferences ||
    preferences.locale !== owner.locale ||
    localeRevision !== owner.locale_revision
  ) {
    return false;
  }
  const ontology = await env.DB.prepare(
    "SELECT status FROM pattern_ontology_releases WHERE version = ?",
  ).bind(owner.ontology_version).first<{ status: string }>();
  if (!ontology || ontology.status === "recalled") return false;
  const claim = await loadClaimForFingerprint(
    env,
    owner.user_id,
    owner.chart_fingerprint_hash,
  );
  return !!claim &&
    claim.id === owner.claim_id &&
    (!isConsumedStatus(claim.status) || claim.status === "accepted");
}

function ontologyConfigurationIsCurrent(
  env: Env,
  job: CodexProviderJob,
): boolean {
  const resolved = resolveOntologyPipelineConfiguration(env);
  if (
    !resolved.ok ||
    resolved.rollout !== "internal" ||
    !resolved.config ||
    resolved.config.publisher !== "codex" ||
    job.dailyCallLimit !== resolved.config.dailyProviderCallLimit
  ) {
    return false;
  }
  if (job.pass === "generator" || job.pass === "evaluator") {
    const expected = job.pass === "generator"
      ? {
          model: resolved.config.pin.generator_model,
          promptVersion: resolved.config.pin.generator_prompt_version,
          timeoutMs: resolved.config.generatorTimeoutMs,
        }
      : {
          model: resolved.config.pin.evaluator_model,
          promptVersion: resolved.config.pin.evaluator_prompt_version,
          timeoutMs: resolved.config.evaluatorTimeoutMs,
        };
    return job.model === expected.model &&
      job.promptVersion === expected.promptVersion &&
      job.timeoutMs === expected.timeoutMs;
  }
  // The regression lane reuses the Pattern passes. `publisher` belongs to the
  // reading pipeline and has no ontology stage, so it is refused here rather
  // than indexed into a pin that does not describe it.
  if (
    job.pass !== "planner" && job.pass !== "writer" && job.pass !== "verifier"
  ) {
    return false;
  }
  return job.model === ONTOLOGY_REGRESSION_PATTERN_PIN[`${job.pass}_model`] &&
    job.promptVersion ===
      ONTOLOGY_REGRESSION_PATTERN_PIN[`${job.pass}_prompt_version`] &&
    job.timeoutMs === CODEX_PROVIDER_TIMEOUT_MS;
}

async function ontologyDomainIsCurrent(
  env: Env,
  job: CodexProviderJob,
): Promise<boolean> {
  if (!ontologyConfigurationIsCurrent(env, job)) return false;
  const owner = await loadOntologyOwner(env, job.ownerId);
  if (
    owner === null ||
    owner.stage !== ontologyStageFor(job) ||
    owner.stage_generation !== job.stageGeneration ||
    owner.stage_attempt !== job.stageAttempt
  ) {
    return false;
  }
  const recalled = await env.DB.prepare(
    `SELECT 1 AS present
     FROM pattern_erasure_replay_events
     WHERE event_class = 'ontology_recalled'
       AND ontology_version = ?
     UNION ALL
     SELECT 1 AS present
     FROM pattern_ontology_releases
     WHERE version = ? AND status = 'recalled'
     LIMIT 1`,
  ).bind(
    owner.candidate_ontology_version,
    owner.candidate_ontology_version,
  ).first<{ present: number }>();
  return recalled === null;
}

export async function codexProviderOwnerIsCurrent(
  env: Env,
  job: CodexProviderJob,
  now = new Date(),
): Promise<boolean> {
  if (job.pipeline === "pattern") {
    return patternDomainIsCurrent(env, job, now);
  }
  if (job.pipeline === "reading") {
    // The Daily predicate is read-only by construction: it never claims the
    // generic job, so a runner asking whether its work is still wanted cannot
    // consume the retry the reader's reading depends on.
    return readingProviderOwnerIsCurrent(env, job, now);
  }
  return ontologyDomainIsCurrent(env, job);
}

export type CodexProviderNudgeOutcome =
  | "sent"
  | "not_current"
  | "still_owned"
  | "send_failed";

export async function nudgeCodexProviderOwner(
  env: Env,
  job: CodexProviderJob,
  now = new Date(),
): Promise<CodexProviderNudgeOutcome> {
  if (!await codexProviderOwnerIsCurrent(env, job, now)) {
    return "not_current";
  }
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
