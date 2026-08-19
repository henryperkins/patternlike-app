import {
  contentHash,
  newId,
  sha256Hex,
  type PatternPlan,
  type PatternSemanticVerdict,
  type PatternWriterOutput,
} from "@patternlike/shared";
import {
  buildDeterministicPlan,
  buildDeterministicWriterOutput,
  selectPatternEvidence,
  validatePatternCandidate,
  validatePatternPlan,
} from "@patternlike/pattern-engine";
import type { Env, PatternGenerationMessage } from "../env.js";
import { b64 } from "../crypto.js";
import { decryptPayload, loadUserIdentity, type UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { ensureNatalFeatureSet } from "../db/natal-features.js";
import { loadActiveOntology, loadOntologyByVersion } from "../db/pattern-ontology.js";
import { loadPatternGenerationGrant } from "../db/pattern-consents.js";
import { isConsumedStatus, loadClaimForFingerprint } from "../db/pattern-claims.js";
import { consumePatternProviderCallBudget, utcDateFor } from "../db/pattern-provider-usage.js";
import {
  PATTERN_JOB_TYPE,
  isPatternCommand,
  publicStageFor,
  type GeneratePatternCommandV1,
  type PatternDomainStage,
} from "./pattern-command.js";
import { hashesEqual } from "./content-release.js";
import { resolvePatternPublisherConfiguration } from "./pattern-publisher.js";
import { readPatternAiRollout } from "./pattern-rollout.js";
import {
  evaluateSemanticVerdict as evaluateSemanticVerdictImpl,
  resolveSemanticForceReject,
} from "./pattern-semantic.js";
import {
  artifactAad,
  decryptUnderContentKey,
  encryptUnderContentKey,
  randomNonce,
  unwrapContentKey,
  wrapContentKey,
  randomKey,
} from "./pattern-crypto.js";
import { safeLog } from "./safe-log.js";

const CLAIM_LEASE_MS = 5 * 60 * 1000;

async function nudgeNextStage(
  env: Env,
  job: PatternJobRow,
  nextStageGeneration: number,
): Promise<void> {
  try {
    await env.PATTERN_QUEUE.send({
      kind: "pattern_generation",
      job_id: job.job_id,
      generation_id: job.generation_id,
      stage_generation: nextStageGeneration,
    });
  } catch {
    safeLog({ event: "pattern_dispatch_failed" });
  }
}

export interface PatternJobRow {
  generation_id: string;
  job_id: string;
  user_id: string;
  claim_id: string;
  stage: PatternDomainStage;
  stage_generation: number;
  planner_attempts: number;
  writer_attempts: number;
  verifier_attempts: number;
  plan_hash: string | null;
  candidate_hash: string | null;
  locale: string;
  locale_revision: number;
}

export type PatternExecuteOutcome =
  | { ok: true; terminal: boolean }
  | { ok: false; reason: "duplicate" | "retry" | "terminal"; failureClass: string };

async function loadJob(env: Env, generationId: string): Promise<PatternJobRow | null> {
  return env.DB.prepare(
    `SELECT generation_id, job_id, user_id, claim_id, stage, stage_generation,
            planner_attempts, writer_attempts, verifier_attempts, plan_hash,
            candidate_hash, locale, locale_revision
     FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<PatternJobRow>();
}

const TERMINAL_STAGES: ReadonlySet<PatternDomainStage> = new Set<PatternDomainStage>([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Did this message name a stage the job has already moved past?
 *
 * Read from durable state rather than from the thrown error: the abort the
 * assertion probe raises and a transient D1 failure both surface as a rejected
 * batch, and only the job row can tell them apart. Anything this cannot prove
 * is a duplicate is treated as retryable.
 */
async function stageMovedOn(env: Env, message: PatternGenerationMessage): Promise<boolean> {
  try {
    const job = await loadJob(env, message.generation_id);
    if (!job) return true;
    if (job.stage_generation !== message.stage_generation) return true;
    return TERMINAL_STAGES.has(job.stage);
  } catch {
    return false;
  }
}

type StageClaim =
  | { status: "claimed"; token: string; job: PatternJobRow }
  | { status: "duplicate" }
  | { status: "retry" };

async function claimStage(
  env: Env,
  message: PatternGenerationMessage,
  now: Date,
): Promise<StageClaim> {
  const token = newId("clm");
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  let result: D1Result[];
  try {
    result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'pattern stage generation mismatch'
       WHERE NOT EXISTS (
         SELECT 1 FROM pattern_generation_jobs
         WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')
       )`,
    ).bind(message.generation_id, message.job_id, message.stage_generation),
    env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', claim_token = ?, lease_expires_at = ?,
           available_at = NULL, started_at = COALESCE(started_at, ?),
           attempts = attempts + 1, dispatched_at = COALESCE(dispatched_at, ?)
       WHERE id = ? AND job_type = ?
         AND (available_at IS NULL OR available_at <= ?)
         AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
         AND EXISTS (SELECT 1 FROM users WHERE users.id = jobs.user_id AND users.status = 'active')
         AND EXISTS (
           SELECT 1 FROM pattern_generation_jobs
           WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
             AND stage NOT IN ('succeeded', 'failed', 'cancelled')
         )`,
    ).bind(
      token,
      lease,
      nowIso,
      nowIso,
      message.job_id,
      PATTERN_JOB_TYPE,
      nowIso,
      nowIso,
      message.generation_id,
      message.job_id,
      message.stage_generation,
    ),
    env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET updated_at = ?
       WHERE generation_id = ? AND job_id = ? AND stage_generation = ?
         AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
    ).bind(nowIso, message.generation_id, message.job_id, message.stage_generation),
  ]);
  } catch {
    // The probe at the head of this batch aborts on purpose when the message
    // names a stage generation the job has moved past -- that is a duplicate
    // delivery and acking it is correct. Every other reason the batch can
    // throw is transient, and reporting those as duplicates acked the message
    // away with nothing committed: enqueue leaves the row status='queued' with
    // dispatched_at set, which the undispatched sweep (dispatched_at IS NULL)
    // and the expired-lease sweep (status='running') both miss. The durable
    // outbox that exists to catch exactly this cannot see the row, and the
    // reader sits on organizing_evidence indefinitely.
    return (await stageMovedOn(env, message)) ? { status: "duplicate" } : { status: "retry" };
  }
  const jobUpdate = result[1];
  // Zero rows means someone else holds the lease, the account is not active, or
  // the job is parked or terminal. All of those are handled elsewhere, so the
  // message is done here.
  if (!jobUpdate?.meta.changes) return { status: "duplicate" };
  const job = await loadJob(env, message.generation_id);
  if (!job || job.stage_generation !== message.stage_generation) return { status: "duplicate" };
  return { status: "claimed", token, job };
}

async function loadCommand(
  env: Env,
  identity: UserIdentity,
  jobId: string,
): Promise<GeneratePatternCommandV1> {
  const row = await env.DB.prepare(
    `SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ? AND user_id = ?`,
  )
    .bind(jobId, identity.userId)
    .first<{ payload_enc: ArrayBuffer; payload_key_version: number; payload_nonce: string }>();
  if (!row?.payload_enc) throw new Error("pattern command missing");
  const command = await decryptPayload<unknown>(
    env,
    identity,
    {
      ciphertext: b64(row.payload_enc),
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
    },
    { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
  );
  if (!isPatternCommand(command)) throw new Error("pattern command invalid");
  return command;
}

async function putArtifact(
  env: Env,
  identity: UserIdentity,
  job: PatternJobRow,
  artifactClass: string,
  value: unknown,
  expiresAt: string,
): Promise<void> {
  if (!env.ARTIFACTS) throw new Error("ARTIFACTS binding missing");
  const wrapped = await env.DB.prepare(
    `SELECT wrapped_key_enc, wrapped_key_version, wrapped_key_nonce
     FROM pattern_generation_artifact_keys
     WHERE generation_id = ? AND user_id = ? AND erased_at IS NULL`,
  )
    .bind(job.generation_id, identity.userId)
    .first<{ wrapped_key_enc: ArrayBuffer; wrapped_key_version: number; wrapped_key_nonce: string }>();
  if (!wrapped) throw new Error("pattern artifact key missing");
  const key = await unwrapContentKey(
    env,
    identity,
    job.generation_id,
    "pattern_generation_artifact_keys.wrapped_key_enc",
    {
      key_version: wrapped.wrapped_key_version,
      nonce: wrapped.wrapped_key_nonce,
      ciphertext: b64(wrapped.wrapped_key_enc),
    },
  );
  const digest = await sha256Hex(`${job.generation_id}:${artifactClass}:${job.stage_generation}`);
  const artifactId = `part_${digest.slice(0, 32)}`;
  const nonce = randomNonce();
  const aad = artifactAad(job.generation_id, artifactId, artifactClass);
  const ciphertext = await encryptUnderContentKey(value, key, nonce, aad);
  const objectKey = `pattern-generations/${job.generation_id}/${artifactId}.json.enc`;
  // Nonce is prepended so writer/verifier retries can decrypt the frozen
  // artifact without a schema column for it.
  const stored = new Uint8Array(nonce.length + ciphertext.length);
  stored.set(nonce, 0);
  stored.set(ciphertext, nonce.length);
  const put = await env.ARTIFACTS.put(objectKey, stored, {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!put) {
    if (await env.ARTIFACTS.head(objectKey)) return;
    throw new Error("pattern artifact create failed");
  }
  const now = new Date().toISOString();
  const plainHash = await contentHash(JSON.stringify(value));
  const cipherHash = await contentHash(b64(stored));
  await env.DB.prepare(
    `INSERT INTO pattern_generation_artifacts (
       id, generation_id, user_id, artifact_class, object_key, ciphertext_sha256,
       plaintext_sha256, byte_length, created_at, expires_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(object_key) DO NOTHING`,
  )
    .bind(
      artifactId,
      job.generation_id,
      identity.userId,
      artifactClass,
      objectKey,
      cipherHash,
      plainHash,
      stored.byteLength,
      now,
      expiresAt,
    )
    .run();
}

async function unwrapArtifactKey(
  env: Env,
  identity: UserIdentity,
  generationId: string,
): Promise<Uint8Array> {
  const wrapped = await env.DB.prepare(
    `SELECT wrapped_key_enc, wrapped_key_version, wrapped_key_nonce
     FROM pattern_generation_artifact_keys
     WHERE generation_id = ? AND user_id = ? AND erased_at IS NULL`,
  )
    .bind(generationId, identity.userId)
    .first<{ wrapped_key_enc: ArrayBuffer; wrapped_key_version: number; wrapped_key_nonce: string }>();
  if (!wrapped) throw new Error("pattern artifact key missing");
  return unwrapContentKey(
    env,
    identity,
    generationId,
    "pattern_generation_artifact_keys.wrapped_key_enc",
    {
      key_version: wrapped.wrapped_key_version,
      nonce: wrapped.wrapped_key_nonce,
      ciphertext: b64(wrapped.wrapped_key_enc),
    },
  );
}

export async function getArtifact<T>(
  env: Env,
  identity: UserIdentity,
  generationId: string,
  artifactClass: string,
): Promise<T | null> {
  if (!env.ARTIFACTS) return null;
  const row = await env.DB.prepare(
    `SELECT id, object_key FROM pattern_generation_artifacts
     WHERE generation_id = ? AND user_id = ? AND artifact_class = ? AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(generationId, identity.userId, artifactClass)
    .first<{ id: string; object_key: string }>();
  if (!row) return null;
  const object = await env.ARTIFACTS.get(row.object_key);
  if (!object) return null;
  const stored = new Uint8Array(await object.arrayBuffer());
  if (stored.byteLength <= 12) return null;
  const nonce = stored.slice(0, 12);
  const ciphertext = stored.slice(12);
  const key = await unwrapArtifactKey(env, identity, generationId);
  const aad = artifactAad(generationId, row.id, artifactClass);
  return decryptUnderContentKey<T>(ciphertext, key, nonce, aad);
}

function ownershipProbes(env: Env, job: PatternJobRow, token: string) {
  return [
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'pattern job token no longer owns running lease'
       WHERE NOT EXISTS (
         SELECT 1 FROM jobs
         WHERE id = ? AND claim_token = ? AND status = 'running' AND job_type = ?
       )`,
    ).bind(job.job_id, token, PATTERN_JOB_TYPE),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'pattern domain stage no longer owned'
       WHERE NOT EXISTS (
         SELECT 1 FROM pattern_generation_jobs
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')
       )`,
    ).bind(job.generation_id, job.stage_generation),
  ];
}

async function advance(
  env: Env,
  job: PatternJobRow,
  token: string,
  next: PatternDomainStage,
  extra: Record<string, string | number | null> = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  const terminal = next === "succeeded" || next === "failed" || next === "cancelled";
  const jobStatus = next === "succeeded" ? "succeeded" : next === "cancelled" ? "cancelled" : next === "failed" ? "failed" : "queued";
  try {
    await env.DB.batch([
      ...ownershipProbes(env, job, token),
      env.DB.prepare(
        `UPDATE jobs SET status = ?, claim_token = NULL, lease_expires_at = NULL,
                dispatched_at = NULL, finished_at = CASE WHEN ? THEN ? ELSE finished_at END
         WHERE id = ? AND claim_token = ? AND status = 'running'`,
      ).bind(jobStatus, terminal ? 1 : 0, now, job.job_id, token),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = ?, stage_generation = stage_generation + 1, plan_hash = COALESCE(?, plan_hash),
             candidate_hash = COALESCE(?, candidate_hash), updated_at = ?,
             finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
             public_failure_stage = COALESCE(?, public_failure_stage),
             failure_class = COALESCE(?, failure_class)
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(
        next,
        extra.plan_hash ?? null,
        extra.candidate_hash ?? null,
        now,
        terminal ? 1 : 0,
        now,
        extra.public_failure_stage ?? null,
        extra.failure_class ?? null,
        job.generation_id,
        job.stage_generation,
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function failJob(
  env: Env,
  job: PatternJobRow,
  token: string,
  failureClass: string,
  publicStage: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      ...ownershipProbes(env, job, token),
      env.DB.prepare(
        `UPDATE jobs SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
                finished_at = ?, result_class = ?
         WHERE id = ? AND claim_token = ? AND status = 'running'`,
      ).bind(now, failureClass, job.job_id, token),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'failed', stage_generation = stage_generation + 1, updated_at = ?,
             finished_at = ?, public_failure_stage = ?, failure_class = ?, retention_expires_at = ?
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(
        now,
        now,
        publicStage,
        failureClass,
        new Date(Date.now() + 30 * 86400_000).toISOString(),
        job.generation_id,
        job.stage_generation,
      ),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'available', active_generation_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'reserved' AND consumed_at IS NULL
           AND active_generation_id = ?`,
      ).bind(now, job.claim_id, job.generation_id),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function cancelJob(env: Env, job: PatternJobRow, token: string, reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      ...ownershipProbes(env, job, token),
      env.DB.prepare(
        `UPDATE jobs SET status = 'cancelled', claim_token = NULL, lease_expires_at = NULL, finished_at = ?
         WHERE id = ? AND claim_token = ? AND status = 'running'`,
      ).bind(now, job.job_id, token),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'cancelled', cancellation_reason = ?, updated_at = ?, finished_at = ?
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(reason, now, now, job.generation_id, job.stage_generation),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'available', active_generation_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'reserved' AND consumed_at IS NULL
           AND active_generation_id = ?`,
      ).bind(now, job.claim_id, job.generation_id),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function eligibility(
  env: Env,
  identity: UserIdentity,
  command: GeneratePatternCommandV1,
  now: Date,
): Promise<"ok" | "cancel_consent" | "cancel_stale" | "cancel_ontology"> {
  const grant = await loadPatternGenerationGrant(env, identity.userId, now);
  if (!grant || grant.consentId !== command.consent_id) return "cancel_consent";
  const chart = await env.DB.prepare(
    `SELECT id, fingerprint FROM chart_snapshots WHERE user_id = ? AND status = 'active' ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(identity.userId)
    .first<{ id: string; fingerprint: string }>();
  if (!chart || chart.id !== command.chart_id || chart.fingerprint !== command.chart_fingerprint) {
    return "cancel_stale";
  }
  const prefs = await loadPreferences(env, identity.userId);
  const localeRevision = prefs?.localeUpdatedAt ? Date.parse(prefs.localeUpdatedAt) || 1 : 1;
  if (!prefs || prefs.locale !== command.locale || localeRevision !== command.locale_revision) {
    return "cancel_stale";
  }
  const ontology = await loadActiveOntology(env);
  if (!ontology || ontology.version !== command.ontology_version) {
    const frozen = await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind(command.ontology_version)
      .first<{ status: string }>();
    if (!frozen || frozen.status === "recalled") return "cancel_ontology";
  }
  const claim = await loadClaimForFingerprint(env, identity.userId, command.chart_fingerprint_hash);
  if (!claim || (isConsumedStatus(claim.status) && claim.status !== "accepted")) return "cancel_stale";
  return "ok";
}

/**
 * Thin wrapper over the extracted evaluator, kept until Task 6 rewires the
 * stage machine onto the publisher interface. The logic lives in
 * `pattern-semantic.ts`; duplicating it here would be two copies of the one
 * thing that decides whether prose is publishable.
 */
function evaluateSemanticVerdict(env: Env, writer: PatternWriterOutput): PatternSemanticVerdict {
  return evaluateSemanticVerdictImpl(writer, {
    forceReject: resolveSemanticForceReject(env),
  });
}

export async function executePatternJob(
  env: Env,
  message: PatternGenerationMessage,
  now = new Date(),
): Promise<PatternExecuteOutcome> {
  const rollout = readPatternAiRollout(env);
  if (rollout === "off") {
    await env.DB.prepare(
      `UPDATE jobs SET available_at = ?, dispatched_at = NULL, result_class = 'rollout_paused'
       WHERE id = ? AND job_type = ? AND status IN ('queued', 'running')`,
    )
      .bind(new Date(now.getTime() + 3600_000).toISOString(), message.job_id, PATTERN_JOB_TYPE)
      .run();
    return { ok: true, terminal: false };
  }

  const claim = await claimStage(env, message, now);
  if (claim.status === "retry") {
    return { ok: false, reason: "retry", failureClass: "claim_failed" };
  }
  if (claim.status !== "claimed") return { ok: false, reason: "duplicate", failureClass: "duplicate" };
  const claimed = claim;
  const stage = claimed.job.stage;

  const identityRow = await loadUserIdentity(env, (await loadJob(env, message.generation_id))!.user_id);
  if (!identityRow) {
    await failJob(env, claimed.job, claimed.token, "account_inactive", "organizing_evidence");
    return { ok: false, reason: "terminal", failureClass: "account_inactive" };
  }
  const identity: UserIdentity = { userId: identityRow.userId, cryptoSubject: identityRow.cryptoSubject };
  let command: GeneratePatternCommandV1;
  try {
    command = await loadCommand(env, identity, claimed.job.job_id);
  } catch {
    await failJob(env, claimed.job, claimed.token, "payload_undecryptable", "organizing_evidence");
    return { ok: false, reason: "terminal", failureClass: "payload_undecryptable" };
  }

  const gate = await eligibility(env, identity, command, now);
  if (gate !== "ok") {
    await cancelJob(env, claimed.job, claimed.token, gate);
    return { ok: true, terminal: true };
  }

  // The try opens here rather than below the selection call. selectPatternEvidence
  // throws SelectionCapacityError deterministically for a chart whose mandatory
  // set exceeds the packet cap, and the chart-accuracy read and expiry
  // computation can throw too. Outside the try nothing marks the job failed:
  // the queue retried, the message reached the DLQ after max_retries, and the
  // job stayed mid-pipeline with its claim still reserved -- the reader's one
  // Pattern opportunity held by a job that can neither finish nor fail.
  try {
    const publisher = resolvePatternPublisherConfiguration(env);
    if (!publisher.ok || !publisher.config) {
      await failJob(env, claimed.job, claimed.token, "publisher_unavailable", "organizing_evidence");
      return { ok: false, reason: "terminal", failureClass: "publisher_unavailable" };
    }

    const ontology = await loadOntologyByVersion(env, command.ontology_version);
    if (!ontology || !hashesEqual(ontology.bundleHash, command.ontology_bundle_hash)) {
      await cancelJob(env, claimed.job, claimed.token, "cancel_ontology");
      return { ok: true, terminal: true };
    }
    const frozenOntology = ontology;

    const features = await ensureNatalFeatureSet(env, identity.userId, command.chart_id, now);
    if (features.featureSetHash !== command.feature_set_hash) {
      await cancelJob(env, claimed.job, claimed.token, "cancel_stale");
      return { ok: true, terminal: true };
    }

    const selected = selectPatternEvidence({
      locale: command.locale,
      effectiveAccuracy: (await env.DB.prepare(
        `SELECT birth_accuracy FROM chart_snapshots WHERE id = ? AND user_id = ?`,
      )
        .bind(command.chart_id, identity.userId)
        .first<{ birth_accuracy: "exact" | "approximate" | "unknown" }>())?.birth_accuracy ?? "exact",
      featureSetHash: features.featureSetHash,
      features: features.features,
      ontology: frozenOntology.release.records,
    });

    const expiresAt = new Date(now.getTime() + publisher.config.artifactRetentionDays * 86400_000).toISOString();

    // Live OpenAI Pattern calls are not wired yet. Production rollout stays `off`.
    // Development and tests use the deterministic synthetic publisher; an openai
    // pin without an adapter is fail-closed rather than a silent synthetic stand-in.
    if (publisher.config.pin.publisher !== "synthetic") {
      await failJob(env, claimed.job, claimed.token, "publisher_unavailable", publicStageFor(stage) ?? "organizing_evidence");
      return { ok: false, reason: "terminal", failureClass: "publisher_unavailable" };
    }

    if (stage === "reserved" || stage === "planning" || stage === "plan_validating") {
      const budget = await consumePatternProviderCallBudget(env, utcDateFor(now), publisher.config.dailyCallLimit);
      if (!budget.ok) {
        await failJob(env, claimed.job, claimed.token, "publisher_budget_exhausted", "organizing_evidence");
        return { ok: false, reason: "terminal", failureClass: "publisher_budget_exhausted" };
      }
      const planner = buildDeterministicPlan(selected.packet, frozenOntology.release.records);
      const planCheck = validatePatternPlan(planner, selected.packet, frozenOntology.release.records);
      if (!planCheck.ok) {
        await failJob(env, claimed.job, claimed.token, "plan_invalid", "organizing_evidence");
        return { ok: false, reason: "terminal", failureClass: "plan_invalid" };
      }
      const planHash = await contentHash(JSON.stringify(planner));
      const plan: PatternPlan = {
        ...planner,
        plan_hash: planHash,
        sparse_pattern: selected.packet.selection_constraints.sparse_pattern,
      };
      await putArtifact(env, identity, claimed.job, "fact_packet", selected.packet, expiresAt);
      await putArtifact(env, identity, claimed.job, "validated_plan", plan, expiresAt);
      if (!(await advance(env, claimed.job, claimed.token, "writing", { plan_hash: planHash }))) {
        return { ok: false, reason: "duplicate", failureClass: "duplicate" };
      }
      await nudgeNextStage(env, claimed.job, claimed.job.stage_generation + 1);
      return { ok: true, terminal: false };
    }

    if (stage === "writing" || stage === "candidate_validating") {
      const budget = await consumePatternProviderCallBudget(env, utcDateFor(now), publisher.config.dailyCallLimit);
      if (!budget.ok) {
        await failJob(env, claimed.job, claimed.token, "publisher_budget_exhausted", "writing");
        return { ok: false, reason: "terminal", failureClass: "publisher_budget_exhausted" };
      }
      const planHash = claimed.job.plan_hash;
      if (!planHash) {
        await failJob(env, claimed.job, claimed.token, "plan_missing", "writing");
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }
      const plan = await getArtifact<PatternPlan>(env, identity, command.generation_id, "validated_plan");
      if (!plan || plan.plan_hash !== planHash) {
        await failJob(env, claimed.job, claimed.token, "plan_missing", "writing");
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }
      const writer = buildDeterministicWriterOutput(plan, selected.packet, frozenOntology.release.records);
      const candidate = validatePatternCandidate(writer, plan, selected.packet, frozenOntology.release.records);
      if (!candidate.ok) {
        await failJob(env, claimed.job, claimed.token, "candidate_invalid", "writing");
        return { ok: false, reason: "terminal", failureClass: "candidate_invalid" };
      }
      const candidateHash = await contentHash(JSON.stringify(writer));
      await putArtifact(env, identity, claimed.job, "writer_response", writer, expiresAt);
      if (!(await advance(env, claimed.job, claimed.token, "semantic_verifying", { candidate_hash: candidateHash }))) {
        return { ok: false, reason: "duplicate", failureClass: "duplicate" };
      }
      await nudgeNextStage(env, claimed.job, claimed.job.stage_generation + 1);
      return { ok: true, terminal: false };
    }

    if (stage === "semantic_verifying" || stage === "publishing") {
      const budget = await consumePatternProviderCallBudget(env, utcDateFor(now), publisher.config.dailyCallLimit);
      if (!budget.ok) {
        await failJob(env, claimed.job, claimed.token, "publisher_budget_exhausted", "checking_claims");
        return { ok: false, reason: "terminal", failureClass: "publisher_budget_exhausted" };
      }
      const plan = await getArtifact<PatternPlan>(env, identity, command.generation_id, "validated_plan");
      const writer = await getArtifact<PatternWriterOutput>(
        env,
        identity,
        command.generation_id,
        "writer_response",
      );
      if (!plan || !writer) {
        await failJob(env, claimed.job, claimed.token, "plan_missing", "checking_claims");
        return { ok: false, reason: "terminal", failureClass: "plan_missing" };
      }
      const verdict = evaluateSemanticVerdict(env, writer);
      const verdictHash = await contentHash(JSON.stringify(verdict));
      const candidateHash = await contentHash(JSON.stringify(writer));
      await putArtifact(env, identity, claimed.job, "semantic_verdict", verdict, expiresAt);
      if (verdict.verdict !== "pass") {
        await failJob(env, claimed.job, claimed.token, "semantic_verification_failed", "checking_claims");
        return { ok: false, reason: "terminal", failureClass: "semantic_verification_failed" };
      }
      const published = await publishPattern(env, identity, command, claimed, writer, plan, candidateHash, verdictHash, now);
      if (!published) {
        await cancelJob(env, claimed.job, claimed.token, "stale_publication");
        return { ok: true, terminal: true };
      }
      return { ok: true, terminal: true };
    }

    await failJob(env, claimed.job, claimed.token, "unknown_stage", publicStageFor(stage) ?? "organizing_evidence");
    return { ok: false, reason: "terminal", failureClass: "unknown_stage" };
  } catch (error) {
    safeLog({ event: "pattern_stage_failed" });
    await failJob(env, claimed.job, claimed.token, "execution_error", publicStageFor(stage) ?? "organizing_evidence");
    return { ok: false, reason: "terminal", failureClass: "execution_error" };
  }
}

async function publishPattern(
  env: Env,
  identity: UserIdentity,
  command: GeneratePatternCommandV1,
  claimed: { token: string; job: PatternJobRow },
  writer: PatternWriterOutput,
  plan: PatternPlan,
  candidateHash: string,
  verdictHash: string,
  now: Date,
): Promise<boolean> {
  const patternId = newId("pat");
  const generatedAt = now.toISOString();
  const documentKey = randomKey();
  const nonce = randomNonce();
  const internal = {
    schema_version: "0.7.0" as const,
    pattern_id: patternId,
    generation_id: command.generation_id,
    locale: command.locale,
    effective_accuracy: (await env.DB.prepare(
      `SELECT birth_accuracy FROM chart_snapshots WHERE id = ? AND user_id = ?`,
    )
      .bind(command.chart_id, identity.userId)
      .first<{ birth_accuracy: "exact" | "approximate" | "unknown" }>())?.birth_accuracy ?? "exact",
    plan_hash: plan.plan_hash,
    candidate_hash: candidateHash,
    semantic_verdict_hash: verdictHash,
    artifact: writer,
    compact_provenance: {
      assembly_mode: "constrained_model" as const,
      provider: "OpenAI",
      model_family: "gpt",
      raw_birth_details_sent: false as const,
      ontology_version: command.ontology_version,
      selection_policy_version: command.selection_policy_version,
    },
  };
  const aad = new TextEncoder().encode(
    JSON.stringify(["patternlike.pattern-document", 1, patternId, command.generation_id]),
  );
  const documentEnc = await encryptUnderContentKey(internal, documentKey, nonce, aad);
  const wrapped = await wrapContentKey(
    env,
    identity,
    patternId,
    "pattern_documents.wrapped_document_key_enc",
    documentKey,
    { claim_id: command.claim_id, generation_id: command.generation_id },
  );
  const content = await contentHash(JSON.stringify(internal));
  const accuracy = internal.effective_accuracy;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'pattern claim no longer reserved'
         WHERE NOT EXISTS (
           SELECT 1 FROM pattern_generation_claims
           WHERE id = ? AND status = 'reserved' AND active_generation_id = ? AND consumed_at IS NULL
         )`,
      ).bind(command.claim_id, command.generation_id),
      ...ownershipProbes(env, claimed.job, claimed.token),
      env.DB.prepare(
        `DELETE FROM pattern_documents WHERE user_id = ? AND chart_fingerprint_hash != ?`,
      ).bind(identity.userId, command.chart_fingerprint_hash),
      env.DB.prepare(
        `INSERT INTO pattern_documents (
           id, user_id, claim_id, generation_id, chart_fingerprint_hash, ontology_version,
           ontology_bundle_hash, locale, effective_accuracy, document_enc, document_nonce,
           wrapped_document_key_enc, wrapped_document_key_version, wrapped_document_key_nonce,
           content_hash, compact_provenance_json, generated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        patternId,
        identity.userId,
        command.claim_id,
        command.generation_id,
        command.chart_fingerprint_hash,
        command.ontology_version,
        command.ontology_bundle_hash,
        command.locale,
        accuracy,
        documentEnc,
        b64(nonce),
        Uint8Array.from(atob(wrapped.ciphertext), (ch) => ch.charCodeAt(0)),
        wrapped.keyVersion,
        wrapped.nonce,
        content,
        JSON.stringify(internal.compact_provenance),
        generatedAt,
        generatedAt,
      ),
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'accepted', active_generation_id = NULL, consumed_at = ?, accepted_at = ?, updated_at = ?
         WHERE id = ? AND status = 'reserved'`,
      ).bind(generatedAt, generatedAt, generatedAt, command.claim_id),
      env.DB.prepare(
        `UPDATE jobs SET status = 'succeeded', claim_token = NULL, lease_expires_at = NULL, finished_at = ?
         WHERE id = ? AND claim_token = ? AND status = 'running'`,
      ).bind(generatedAt, command.job_id, claimed.token),
      env.DB.prepare(
        `UPDATE pattern_generation_jobs
         SET stage = 'succeeded', stage_generation = stage_generation + 1, candidate_hash = ?,
             semantic_verdict_hash = ?, updated_at = ?, finished_at = ?
         WHERE generation_id = ? AND stage_generation = ?
           AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).bind(candidateHash, verdictHash, generatedAt, generatedAt, command.generation_id, claimed.job.stage_generation),
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
         VALUES (?, 'system', ?, 'pattern_generation.published', 'pattern', ?, 'success', 'accepted', ?)`,
      ).bind(newId("aud"), identity.userId, patternId, generatedAt),
    ]);
    return true;
  } catch {
    return false;
  }
}

export { loadJob as loadPatternJob };
