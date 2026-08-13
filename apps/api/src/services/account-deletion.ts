import { sha256Hex } from "@patternlike/shared";
import type { Env, PrivacyMessage } from "../env.js";
import {
  DELETE_JOB_TYPE,
  type DeletionClaim,
  advanceDeletionCheckpoint,
  claimDeletionJob,
  recordDeletionArtifactManifest,
  releaseDeletionClaim,
} from "../db/deletion-jobs.js";
import { EXPORT_JOB_TYPE } from "../db/privacy-jobs.js";
import {
  collectDeletionArtifactKeys,
  deleteUserRows,
} from "./deletion-manifest.js";

export const DELETION_RETRY_DELAY_SECONDS = 60;
export const DELETION_MAX_RETRY_DELAY_SECONDS = 60 * 60;

export function deletionRetryDelaySeconds(attempts: number): number {
  const exponent = Math.max(0, Math.min(6, Math.trunc(attempts) - 1));
  return Math.min(
    DELETION_MAX_RETRY_DELAY_SECONDS,
    DELETION_RETRY_DELAY_SECONDS * 2 ** exponent,
  );
}

async function fenceExports(
  env: Env,
  claim: DeletionClaim,
  now: Date,
): Promise<"ready" | "wait"> {
  const live = await env.DB.prepare(
    `SELECT 1 AS present FROM jobs
     WHERE user_id = ? AND job_type = ? AND status = 'running'
       AND lease_expires_at >= ? LIMIT 1`,
  )
    .bind(claim.request.user_id, EXPORT_JOB_TYPE, now.toISOString())
    .first<{ present: number }>();
  if (live) return "wait";

  await env.DB.prepare(
    `UPDATE jobs
     SET status = 'cancelled', result_class = 'account_pending_deletion',
         finished_at = ?, claim_token = NULL, lease_expires_at = NULL
     WHERE user_id = ? AND job_type = ? AND status IN ('queued', 'running')`,
  )
    .bind(now.toISOString(), claim.request.user_id, EXPORT_JOB_TYPE)
    .run();
  const keys = await collectDeletionArtifactKeys(env, claim.request.user_id);
  if (!(await recordDeletionArtifactManifest(env, claim, keys, now))) {
    throw new Error("deletion artifact manifest lost its claim");
  }
  return "ready";
}

async function deleteRegisteredObjects(env: Env, userId: string): Promise<void> {
  const keys = await collectDeletionArtifactKeys(env, userId);
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await env.ARTIFACTS!.delete(keys.slice(offset, offset + 1000));
  }
}

async function eraseKeys(
  env: Env,
  claim: DeletionClaim,
  now: Date,
): Promise<void> {
  if (!claim.claimToken) throw new Error("deletion claim has no token");
  const nowIso = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'deletion key set missing'
       WHERE NOT EXISTS (SELECT 1 FROM user_keys WHERE user_id = ?)`,
    ).bind(claim.request.user_id),
    env.DB.prepare(
      `UPDATE jobs
       SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
       WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
    ).bind(claim.jobId, DELETE_JOB_TYPE, claim.claimToken),
    env.DB.prepare(
      `UPDATE user_keys
       SET wrapped_dek = NULL, destroyed_at = COALESCE(destroyed_at, ?), erased_at = ?
       WHERE user_id = ?`,
    ).bind(nowIso, nowIso, claim.request.user_id),
    env.DB.prepare(
      `UPDATE deletion_requests
       SET dek_destroyed = 1, checkpoint = 'keys_erased', status_updated_at = ?
       WHERE id = ? AND job_id = ? AND status = 'running'
         AND EXISTS (
           SELECT 1 FROM jobs j WHERE j.id = deletion_requests.job_id
             AND j.status = 'running' AND j.claim_token = ?
         )`,
    ).bind(nowIso, claim.request.id, claim.jobId, claim.claimToken),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'deletion key erasure incomplete'
       WHERE EXISTS (
         SELECT 1 FROM user_keys
         WHERE user_id = ? AND (
           wrapped_dek IS NOT NULL OR destroyed_at IS NULL OR erased_at IS NULL
         )
       )`,
    ).bind(claim.request.user_id),
  ]);
  claim.request.checkpoint = "keys_erased";
}

async function finalizeDeletion(
  env: Env,
  claim: DeletionClaim,
  now: Date,
): Promise<void> {
  if (!claim.claimToken) throw new Error("deletion claim has no token");
  const nowIso = now.toISOString();
  const proofHash = await sha256Hex(`account-deleted:${claim.request.id}`);
  const auditId = `aud_${proofHash.slice(0, 32)}`;
  const tombstoneSubject = `cs_deleted_${proofHash.slice(0, 24)}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'deletion finalization lost claim'
       WHERE NOT EXISTS (
         SELECT 1 FROM jobs
         WHERE id = ? AND job_type = ? AND status = 'running'
           AND claim_token = ? AND payload_enc IS NULL
       )`,
    ).bind(claim.jobId, DELETE_JOB_TYPE, claim.claimToken),
    env.DB.prepare(
      `UPDATE users
       SET crypto_subject = ?, status = 'deleted', locale = 'und',
           timezone = 'UTC', entitlement_tier = 'none', next_due_at = NULL,
           timezone_source = 'default_unconfirmed', timezone_revision = 0,
           timezone_updated_at = NULL, locale_source = 'default_unconfirmed',
           locale_updated_at = NULL, updated_at = ?, deleted_at = ?
       WHERE id = ? AND status = 'pending_deletion'`,
    ).bind(tombstoneSubject, nowIso, nowIso, claim.request.user_id),
    env.DB.prepare(
      `UPDATE deletion_requests
       SET status = 'completed', checkpoint = 'completed', completed_at = ?,
           status_updated_at = ?, error_class = NULL
       WHERE id = ? AND job_id = ? AND status = 'running' AND dek_destroyed = 1`,
    ).bind(nowIso, nowIso, claim.request.id, claim.jobId),
    env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_type, actor_id, action, resource_type, resource_id,
          result, detail_class, created_at)
       VALUES (?, 'system', ?, 'account_deleted', 'deletion_request', ?,
               'success', 'cryptographic_erasure', ?)`,
    ).bind(auditId, claim.request.user_id, claim.request.id, nowIso),
    env.DB.prepare(
      `DELETE FROM jobs
       WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
    ).bind(claim.jobId, DELETE_JOB_TYPE, claim.claimToken),
  ]);
  claim.request.checkpoint = "completed";
  claim.request.status = "completed";
}

export type DeletionProcessOutcome =
  | "ack"
  | { retryAfterSeconds: number };

export async function processDeletionMessage(
  env: Env,
  message: PrivacyMessage,
  now = new Date(),
): Promise<DeletionProcessOutcome> {
  const claim = await claimDeletionJob(env, message.job_id, now);
  if (!claim) return "ack";
  if (claim.request.status === "completed") return "ack";
  if (
    message.job_type !== DELETE_JOB_TYPE ||
    claim.request.job_id !== claim.jobId ||
    !claim.identity ||
    !claim.claimToken
  ) {
    return "ack";
  }

  if (!env.ARTIFACTS) {
    const retryAfterSeconds = deletionRetryDelaySeconds(claim.attempts);
    await releaseDeletionClaim(
      env,
      claim,
      new Date(now.getTime() + retryAfterSeconds * 1000),
    );
    return { retryAfterSeconds };
  }

  try {
    if (claim.request.checkpoint === "accepted") {
      if ((await fenceExports(env, claim, now)) === "wait") {
        const retryAfterSeconds = deletionRetryDelaySeconds(claim.attempts);
        await releaseDeletionClaim(
          env,
          claim,
          new Date(now.getTime() + retryAfterSeconds * 1000),
        );
        return { retryAfterSeconds };
      }
    }
    if (claim.request.checkpoint === "exports_fenced") {
      await deleteRegisteredObjects(env, claim.request.user_id);
      await advanceDeletionCheckpoint(env, claim, "objects_deleted", now);
    }
    if (claim.request.checkpoint === "objects_deleted") {
      await deleteUserRows(env, claim.request.user_id, claim.jobId);
      await advanceDeletionCheckpoint(env, claim, "rows_deleted", now);
    }
    if (claim.request.checkpoint === "rows_deleted") {
      await eraseKeys(env, claim, now);
    }
    if (claim.request.checkpoint === "keys_erased") {
      await finalizeDeletion(env, claim, now);
    }
    return "ack";
  } catch {
    // If key erasure has committed, the command no longer exists and releasing
    // the job is still safe: the next claim resumes from the clear checkpoint.
    const retryAfterSeconds = deletionRetryDelaySeconds(claim.attempts);
    await releaseDeletionClaim(
      env,
      claim,
      new Date(now.getTime() + retryAfterSeconds * 1000),
    );
    return { retryAfterSeconds };
  }
}
