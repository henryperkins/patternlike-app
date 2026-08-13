import { newId, sha256Hex } from "@patternlike/shared";
import { asCryptoSubject, b64 } from "../crypto.js";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";

export const DELETE_JOB_TYPE = "delete_account" as const;
export const DELETION_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DELETION_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const DELETION_ARTIFACT_FENCE_TTL_SECONDS = 8 * 24 * 60 * 60;

export interface DeleteRequest {
  confirm: "DELETE";
  reason: string | null;
}

export interface DeleteWorkflowAccepted {
  schema_version: "0.2.0";
  workflow: "DeleteAccount";
  status: "queued";
  idempotency_key: string;
  job_id: string;
  resource_id: string;
}

export interface DeletionJobCommand {
  command_version: 1;
  job_type: typeof DELETE_JOB_TYPE;
  request: DeleteRequest;
  accepted_response: DeleteWorkflowAccepted;
  accepted_at: string;
}

interface EncryptedDeletionJobRow {
  id: string;
  user_id: string;
  payload_enc: ArrayBuffer | readonly number[];
  payload_key_version: number;
  payload_nonce: string;
  crypto_subject: string;
}

function base64Url(bytes: Uint8Array): string {
  return b64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mintReceipt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function decryptCommand(
  env: Env,
  row: EncryptedDeletionJobRow,
): Promise<DeletionJobCommand> {
  const identity: UserIdentity = {
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
  };
  return decryptPayload<DeletionJobCommand>(
    env,
    identity,
    {
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
      ciphertext: b64(
        Array.isArray(row.payload_enc)
          ? Uint8Array.from(row.payload_enc)
          : new Uint8Array(row.payload_enc),
      ),
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
}

async function loadExistingCommand(
  env: Env,
  userId: string,
  idempotencyKey: string,
): Promise<DeletionJobCommand | null> {
  const row = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.payload_enc, j.payload_key_version,
            j.payload_nonce, u.crypto_subject
     FROM jobs j JOIN users u ON u.id = j.user_id
     WHERE j.job_type = ? AND j.user_id = ? AND j.idempotency_key = ?`,
  )
    .bind(DELETE_JOB_TYPE, userId, idempotencyKey)
    .first<EncryptedDeletionJobRow>();
  return row ? decryptCommand(env, row) : null;
}

function sameDeleteRequest(a: DeleteRequest, b: DeleteRequest): boolean {
  return a.confirm === b.confirm && a.reason === b.reason;
}

export type ReserveDeletionOutcome =
  | {
      kind: "created";
      response: DeleteWorkflowAccepted;
      receipt: string;
    }
  | { kind: "duplicate"; response: DeleteWorkflowAccepted }
  | { kind: "conflict" };

function replayOutcome(
  command: DeletionJobCommand,
  request: DeleteRequest,
): ReserveDeletionOutcome {
  return sameDeleteRequest(command.request, request)
    ? { kind: "duplicate", response: command.accepted_response }
    : { kind: "conflict" };
}

export async function reserveAccountDeletion(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  request: DeleteRequest,
  now = new Date(),
): Promise<ReserveDeletionOutcome> {
  const existing = await loadExistingCommand(env, identity.userId, idempotencyKey);
  if (existing) return replayOutcome(existing, request);

  const jobId = newId("job");
  const deletionId = newId("del");
  const acceptedAt = now.toISOString();
  const receipt = mintReceipt();
  const receiptHash = await sha256Hex(receipt);
  const receiptExpiresAt = new Date(
    now.getTime() + DELETION_RECEIPT_TTL_SECONDS * 1000,
  ).toISOString();
  const response: DeleteWorkflowAccepted = {
    schema_version: "0.2.0",
    workflow: "DeleteAccount",
    status: "queued",
    idempotency_key: idempotencyKey,
    job_id: jobId,
    resource_id: deletionId,
  };
  const command: DeletionJobCommand = {
    command_version: 1,
    job_type: DELETE_JOB_TYPE,
    request,
    accepted_response: response,
    accepted_at: acceptedAt,
  };
  const sealed = await encryptPayload(env, identity, command, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'account cannot start deletion'
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND status IN ('active', 'frozen')
         )`,
      ).bind(identity.userId),
      env.DB.prepare(
        `INSERT INTO jobs
           (id, job_type, user_id, idempotency_key, status, payload_json,
            payload_enc, payload_key_version, payload_nonce, attempts, created_at)
         VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?, ?, 0, ?)`,
      ).bind(
        jobId,
        DELETE_JOB_TYPE,
        identity.userId,
        idempotencyKey,
        Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0)),
        sealed.keyVersion,
        sealed.nonce,
        acceptedAt,
      ),
      env.DB.prepare(
        `INSERT INTO deletion_requests
           (id, user_id, status, dek_destroyed, idempotency_key, created_at,
            job_id, receipt_hash, receipt_expires_at, checkpoint,
            status_updated_at)
         VALUES (?, ?, 'queued', 0, ?, ?, ?, ?, ?, 'accepted', ?)`,
      ).bind(
        deletionId,
        identity.userId,
        idempotencyKey,
        acceptedAt,
        jobId,
        receiptHash,
        receiptExpiresAt,
        acceptedAt,
      ),
      env.DB.prepare(
        `UPDATE users SET status = 'pending_deletion', updated_at = ?
         WHERE id = ? AND status IN ('active', 'frozen')`,
      ).bind(acceptedAt, identity.userId),
      env.DB.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      ).bind(acceptedAt, identity.userId),
      env.DB.prepare(
        `UPDATE context_source_permissions
         SET enabled = 0, permission_state = 'revoked', updated_at = ?
         WHERE user_id = ?`,
      ).bind(acceptedAt, identity.userId),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'cancelled', result_class = 'account_pending_deletion',
             finished_at = ?
         WHERE user_id = ? AND id != ? AND status = 'queued'`,
      ).bind(acceptedAt, identity.userId, jobId),
    ]);
    return { kind: "created", response, receipt };
  } catch (error) {
    const winner = await loadExistingCommand(env, identity.userId, idempotencyKey);
    if (winner) return replayOutcome(winner, request);
    throw error;
  }
}

export interface DeletionRow {
  id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed";
  job_id: string | null;
  receipt_expires_at: string | null;
  checkpoint:
    | "accepted"
    | "exports_fenced"
    | "objects_deleted"
    | "rows_deleted"
    | "keys_erased"
    | "completed"
    | null;
  created_at: string;
  status_updated_at: string;
  completed_at: string | null;
  error_class: string | null;
  artifact_manifest_json: string;
  artifact_cleanup_until: string | null;
}

export async function loadDeletionByReceipt(
  env: Env,
  receipt: string,
  now = new Date(),
): Promise<DeletionRow | null> {
  const hash = await sha256Hex(receipt);
  return env.DB.prepare(
    `SELECT id, user_id, status, job_id, receipt_expires_at, checkpoint,
            created_at, status_updated_at, completed_at, error_class,
            artifact_manifest_json, artifact_cleanup_until
     FROM deletion_requests
     WHERE receipt_hash = ? AND receipt_expires_at > ?`,
  )
    .bind(hash, now.toISOString())
    .first<DeletionRow>();
}

export interface DeletionClaim {
  request: DeletionRow;
  jobId: string;
  claimToken: string | null;
  attempts: number;
  identity: UserIdentity | null;
  command: DeletionJobCommand | null;
}

export async function claimDeletionJob(
  env: Env,
  jobId: string,
  now = new Date(),
): Promise<DeletionClaim | null> {
  const terminal = await env.DB.prepare(
    `SELECT id, user_id, status, job_id, receipt_expires_at, checkpoint,
            created_at, status_updated_at, completed_at, error_class,
            artifact_manifest_json, artifact_cleanup_until
     FROM deletion_requests WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<DeletionRow>();
  if (!terminal) return null;
  if (terminal.status === "completed" || terminal.checkpoint === "completed") {
    return {
      request: terminal,
      jobId,
      claimToken: null,
      attempts: 0,
      identity: null,
      command: null,
    };
  }

  const claimToken = newId("clm");
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(
    now.getTime() + DELETION_CLAIM_LEASE_MS,
  ).toISOString();
  const result = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'running', claim_token = ?, lease_expires_at = ?,
         available_at = NULL, started_at = COALESCE(started_at, ?),
         attempts = attempts + 1, dispatched_at = COALESCE(dispatched_at, ?)
     WHERE id = ? AND job_type = ?
       AND (available_at IS NULL OR available_at <= ?)
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
       AND EXISTS (
         SELECT 1 FROM users u
         WHERE u.id = jobs.user_id AND u.status = 'pending_deletion'
       )`,
  )
    .bind(
      claimToken,
      leaseExpiresAt,
      nowIso,
      nowIso,
      jobId,
      DELETE_JOB_TYPE,
      nowIso,
      nowIso,
    )
    .run();
  if (result.meta.changes !== 1) return null;
  await env.DB.prepare(
    `UPDATE deletion_requests SET status = 'running', status_updated_at = ?
     WHERE job_id = ? AND status = 'queued'`,
  )
    .bind(nowIso, jobId)
    .run();

  const row = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.payload_enc, j.payload_key_version,
            j.payload_nonce, j.attempts, u.crypto_subject
     FROM jobs j JOIN users u ON u.id = j.user_id
     WHERE j.id = ? AND j.claim_token = ?`,
  )
    .bind(jobId, claimToken)
    .first<EncryptedDeletionJobRow & { attempts: number }>();
  if (!row) throw new Error("claimed deletion job disappeared");
  const request = await env.DB.prepare(
    `SELECT id, user_id, status, job_id, receipt_expires_at, checkpoint,
            created_at, status_updated_at, completed_at, error_class,
            artifact_manifest_json, artifact_cleanup_until
     FROM deletion_requests WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<DeletionRow>();
  if (!request) throw new Error("claimed deletion request disappeared");
  const identity: UserIdentity = {
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
  };
  const needsCommand = request.checkpoint !== "keys_erased";
  return {
    request,
    jobId,
    claimToken,
    attempts: row.attempts,
    identity,
    command: needsCommand ? await decryptCommand(env, row) : null,
  };
}

export async function advanceDeletionCheckpoint(
  env: Env,
  claim: DeletionClaim,
  checkpoint: NonNullable<DeletionRow["checkpoint"]>,
  now = new Date(),
): Promise<boolean> {
  if (!claim.claimToken) return false;
  const result = await env.DB.prepare(
    `UPDATE deletion_requests SET checkpoint = ?, status_updated_at = ?
     WHERE id = ? AND job_id = ? AND status = 'running'
       AND EXISTS (
         SELECT 1 FROM jobs j WHERE j.id = deletion_requests.job_id
           AND j.status = 'running' AND j.claim_token = ?
       )`,
  )
    .bind(
      checkpoint,
      now.toISOString(),
      claim.request.id,
      claim.jobId,
      claim.claimToken,
    )
    .run();
  if (result.meta.changes === 1) claim.request.checkpoint = checkpoint;
  return result.meta.changes === 1;
}

export async function recordDeletionArtifactManifest(
  env: Env,
  claim: DeletionClaim,
  objectKeys: readonly string[],
  now = new Date(),
): Promise<boolean> {
  if (!claim.claimToken) return false;
  const keys = [...new Set(objectKeys)].sort();
  const cleanupUntil = keys.length > 0
    ? new Date(
        now.getTime() + DELETION_ARTIFACT_FENCE_TTL_SECONDS * 1000,
      ).toISOString()
    : null;
  const result = await env.DB.prepare(
    `UPDATE deletion_requests
     SET checkpoint = 'exports_fenced', status_updated_at = ?,
         artifact_manifest_json = ?, artifact_cleanup_until = ?
     WHERE id = ? AND user_id = ? AND job_id = ? AND status = 'running'
       AND EXISTS (
         SELECT 1 FROM jobs j WHERE j.id = deletion_requests.job_id
           AND j.status = 'running' AND j.claim_token = ?
       )`,
  )
    .bind(
      now.toISOString(),
      JSON.stringify(keys),
      cleanupUntil,
      claim.request.id,
      claim.request.user_id,
      claim.jobId,
      claim.claimToken,
    )
    .run();
  if (result.meta.changes === 1) {
    claim.request.checkpoint = "exports_fenced";
    claim.request.artifact_manifest_json = JSON.stringify(keys);
    claim.request.artifact_cleanup_until = cleanupUntil;
  }
  return result.meta.changes === 1;
}

export async function releaseDeletionClaim(
  env: Env,
  claim: DeletionClaim,
  retryAt: Date,
): Promise<boolean> {
  if (!claim.claimToken) return false;
  const retryIso = retryAt.toISOString();
  const releasedIso = new Date().toISOString();
  const ownsClaim = async (): Promise<boolean> => {
    const current = await env.DB.prepare(
      `SELECT 1 AS present
       FROM deletion_requests d
       JOIN jobs j ON j.id = d.job_id AND j.user_id = d.user_id
       WHERE d.id = ? AND d.user_id = ? AND d.job_id = ?
         AND d.status = 'running'
         AND j.job_type = ? AND j.status = 'running' AND j.claim_token = ?`,
    )
      .bind(
        claim.request.id,
        claim.request.user_id,
        claim.jobId,
        DELETE_JOB_TYPE,
        claim.claimToken,
      )
      .first<{ present: number }>();
    return current !== null;
  };
  if (!(await ownsClaim())) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'deletion release lost its claim'
         WHERE NOT EXISTS (
           SELECT 1
           FROM deletion_requests d
           JOIN jobs j ON j.id = d.job_id AND j.user_id = d.user_id
           WHERE d.id = ? AND d.user_id = ? AND d.job_id = ?
             AND d.status = 'running'
             AND j.job_type = ? AND j.status = 'running'
             AND j.claim_token = ?
         )`,
      ).bind(
        claim.request.id,
        claim.request.user_id,
        claim.jobId,
        DELETE_JOB_TYPE,
        claim.claimToken,
      ),
      env.DB.prepare(
        `UPDATE deletion_requests SET status = 'queued', status_updated_at = ?
         WHERE id = ? AND user_id = ? AND job_id = ? AND status = 'running'`,
      ).bind(
        releasedIso,
        claim.request.id,
        claim.request.user_id,
        claim.jobId,
      ),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
             available_at = ?, dispatched_at = NULL
         WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
      ).bind(retryIso, claim.jobId, DELETE_JOB_TYPE, claim.claimToken),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'deletion release did not commit atomically'
         WHERE NOT EXISTS (
           SELECT 1
           FROM deletion_requests d
           JOIN jobs j ON j.id = d.job_id AND j.user_id = d.user_id
           WHERE d.id = ? AND d.user_id = ? AND d.job_id = ?
             AND d.status = 'queued'
             AND j.status = 'queued' AND j.available_at = ?
             AND j.dispatched_at IS NULL AND j.claim_token IS NULL
             AND j.lease_expires_at IS NULL
         )`,
      ).bind(
        claim.request.id,
        claim.request.user_id,
        claim.jobId,
        retryIso,
      ),
    ]);
    claim.request.status = "queued";
    return true;
  } catch (error) {
    if (!(await ownsClaim())) return false;
    throw error;
  }
}
