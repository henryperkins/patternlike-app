import { newId } from "@patternlike/shared";
import { asCryptoSubject, b64 } from "../crypto.js";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";
import type { ExportOptions } from "../services/account-export.js";
import type { SealedExport } from "../services/export-envelope.js";

export const EXPORT_JOB_TYPE = "export_account" as const;
export const PRIVACY_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const PRIVACY_MAX_JOB_ATTEMPTS = 3;

export interface WorkflowAccepted {
  schema_version: "0.2.0";
  workflow: "ExportAccount";
  status: "queued";
  idempotency_key: string;
  job_id: string;
  resource_id: string;
}

export interface ExportJobCommand {
  command_version: 1;
  job_type: typeof EXPORT_JOB_TYPE;
  request: ExportOptions;
  accepted_response: WorkflowAccepted;
  accepted_at: string;
}

interface EncryptedJobRow {
  id: string;
  user_id: string;
  payload_enc: ArrayBuffer;
  payload_key_version: number;
  payload_nonce: string;
  crypto_subject: string;
}

async function loadCommand(
  env: Env,
  row: EncryptedJobRow,
): Promise<ExportJobCommand> {
  const identity: UserIdentity = {
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
  };
  return decryptPayload<ExportJobCommand>(
    env,
    identity,
    {
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
      ciphertext: b64(row.payload_enc),
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
}

async function existingExportCommand(
  env: Env,
  userId: string,
  idempotencyKey: string,
): Promise<ExportJobCommand | null> {
  const row = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.payload_enc, j.payload_key_version,
            j.payload_nonce, u.crypto_subject
     FROM jobs j JOIN users u ON u.id = j.user_id
     WHERE j.job_type = ? AND j.user_id = ? AND j.idempotency_key = ?`,
  )
    .bind(EXPORT_JOB_TYPE, userId, idempotencyKey)
    .first<EncryptedJobRow>();
  return row ? loadCommand(env, row) : null;
}

export type ReserveExportOutcome =
  | { kind: "created"; response: WorkflowAccepted }
  | { kind: "duplicate"; response: WorkflowAccepted }
  | { kind: "conflict" };

function sameRequest(a: ExportOptions, b: ExportOptions): boolean {
  return (
    a.include_readings === b.include_readings &&
    a.include_journal === b.include_journal
  );
}

function replayOutcome(
  command: ExportJobCommand,
  request: ExportOptions,
): ReserveExportOutcome {
  return sameRequest(command.request, request)
    ? { kind: "duplicate", response: command.accepted_response }
    : { kind: "conflict" };
}

export async function reserveAccountExport(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  request: ExportOptions,
  now = new Date(),
): Promise<ReserveExportOutcome> {
  const existing = await existingExportCommand(
    env,
    identity.userId,
    idempotencyKey,
  );
  if (existing) return replayOutcome(existing, request);

  const jobId = newId("job");
  const exportId = newId("exp");
  const acceptedAt = now.toISOString();
  const response: WorkflowAccepted = {
    schema_version: "0.2.0",
    workflow: "ExportAccount",
    status: "queued",
    idempotency_key: idempotencyKey,
    job_id: jobId,
    resource_id: exportId,
  };
  const command: ExportJobCommand = {
    command_version: 1,
    job_type: EXPORT_JOB_TYPE,
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
         SELECT 1, 'account cannot reserve export'
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
        EXPORT_JOB_TYPE,
        identity.userId,
        idempotencyKey,
        Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0)),
        sealed.keyVersion,
        sealed.nonce,
        acceptedAt,
      ),
      env.DB.prepare(
        `INSERT INTO export_requests
           (id, user_id, status, idempotency_key, created_at, job_id,
            status_updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
      ).bind(
        exportId,
        identity.userId,
        idempotencyKey,
        acceptedAt,
        jobId,
        acceptedAt,
      ),
    ]);
    return { kind: "created", response };
  } catch (error) {
    // A concurrent reservation can win the unique key after the pre-read. Its
    // encrypted command is the authority for duplicate versus conflict.
    const winner = await existingExportCommand(
      env,
      identity.userId,
      idempotencyKey,
    );
    if (winner) return replayOutcome(winner, request);
    throw error;
  }
}

export async function markPrivacyDispatched(
  env: Env,
  jobId: string,
  jobType: "export_account" | "delete_account" = EXPORT_JOB_TYPE,
  now = new Date(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE jobs SET dispatched_at = COALESCE(dispatched_at, ?)
     WHERE id = ? AND job_type = ? AND status = 'queued'`,
  )
    .bind(now.toISOString(), jobId, jobType)
    .run();
}

export interface ExportClaim {
  jobId: string;
  exportId: string;
  claimToken: string;
  attempts: number;
  identity: UserIdentity;
  command: ExportJobCommand;
  createdAt: string;
}

export async function claimExportJob(
  env: Env,
  jobId: string,
  now = new Date(),
): Promise<ExportClaim | null> {
  const claimToken = newId("clm");
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(
    now.getTime() + PRIVACY_CLAIM_LEASE_MS,
  ).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'running', claim_token = ?, lease_expires_at = ?,
         available_at = NULL, started_at = COALESCE(started_at, ?),
         attempts = attempts + 1, dispatched_at = COALESCE(dispatched_at, ?)
     WHERE id = ? AND job_type = ?
       AND (available_at IS NULL OR available_at <= ?)
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
       AND EXISTS (
         SELECT 1 FROM users u
         WHERE u.id = jobs.user_id AND u.status IN ('active', 'frozen')
       )`,
  )
    .bind(
      claimToken,
      leaseExpiresAt,
      nowIso,
      nowIso,
      jobId,
      EXPORT_JOB_TYPE,
      nowIso,
      nowIso,
    )
    .run();
  if (claimed.meta.changes !== 1) return null;

  await env.DB.prepare(
    `UPDATE export_requests SET status = 'running', status_updated_at = ?
     WHERE job_id = ? AND status = 'queued'`,
  )
    .bind(nowIso, jobId)
    .run();

  const row = await env.DB.prepare(
    `SELECT j.id, j.user_id, j.payload_enc, j.payload_key_version,
            j.payload_nonce, j.attempts, u.crypto_subject,
            e.id AS export_id, e.created_at
     FROM jobs j
     JOIN users u ON u.id = j.user_id
     JOIN export_requests e ON e.job_id = j.id AND e.user_id = j.user_id
     WHERE j.id = ? AND j.job_type = ? AND j.status = 'running'
       AND j.claim_token = ?`,
  )
    .bind(jobId, EXPORT_JOB_TYPE, claimToken)
    .first<EncryptedJobRow & {
      attempts: number;
      export_id: string;
      created_at: string;
    }>();
  if (!row) throw new Error("claimed export job disappeared");
  const identity: UserIdentity = {
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
  };
  return {
    jobId,
    exportId: row.export_id,
    claimToken,
    attempts: row.attempts,
    identity,
    command: await loadCommand(env, row),
    createdAt: row.created_at,
  };
}

/** Confirm the owner and exact claim may still publish immediately before PUT. */
export async function canPublishExport(
  env: Env,
  claim: ExportClaim,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS allowed
     FROM export_requests e
     JOIN users u ON u.id = e.user_id
     JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
     WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
       AND e.status = 'running'
       AND u.status IN ('active', 'frozen')
       AND j.job_type = ? AND j.status = 'running' AND j.claim_token = ?`,
  )
    .bind(
      claim.exportId,
      claim.identity.userId,
      claim.jobId,
      EXPORT_JOB_TYPE,
      claim.claimToken,
    )
    .first<{ allowed: number }>();
  return row !== null;
}

export async function publishExport(
  env: Env,
  claim: ExportClaim,
  objectUri: string,
  sealed: SealedExport,
  completedAt: Date,
  expiresAt: Date,
): Promise<boolean> {
  const completedIso = completedAt.toISOString();
  const expiresIso = expiresAt.toISOString();
  if (!(await canPublishExport(env, claim))) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export publication lost its claim'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN users u ON u.id = e.user_id
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'running'
             AND u.status IN ('active', 'frozen')
             AND j.job_type = ? AND j.status = 'running'
             AND j.claim_token = ?
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        EXPORT_JOB_TYPE,
        claim.claimToken,
      ),
      env.DB.prepare(
        `UPDATE export_requests
         SET status = 'ready', r2_uri = ?, expires_at = ?, completed_at = ?,
             wrapped_export_key = ?, export_key_nonce = ?, export_kek_version = ?,
             artifact_nonce = ?, object_size_bytes = ?, status_updated_at = ?,
             error_class = NULL, artifact_deleted_at = NULL
         WHERE id = ? AND user_id = ? AND job_id = ? AND status = 'running'`,
      ).bind(
        objectUri,
        expiresIso,
        completedIso,
        sealed.wrappedExportKey,
        sealed.exportKeyNonce,
        sealed.exportKekVersion,
        sealed.artifactNonce,
        sealed.ciphertext.byteLength,
        completedIso,
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
      ),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'succeeded', result_class = 'export_ready', finished_at = ?,
             claim_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
      ).bind(completedIso, claim.jobId, EXPORT_JOB_TYPE, claim.claimToken),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export publication did not commit atomically'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'ready' AND e.r2_uri = ?
             AND e.expires_at = ? AND e.completed_at = ?
             AND j.status = 'succeeded' AND j.result_class = 'export_ready'
             AND j.claim_token IS NULL AND j.lease_expires_at IS NULL
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        objectUri,
        expiresIso,
        completedIso,
      ),
    ]);
    return true;
  } catch (error) {
    if (!(await canPublishExport(env, claim))) return false;
    throw error;
  }
}

export async function failExportClaim(
  env: Env,
  claim: ExportClaim,
  errorClass: "export_too_large" | "artifact_write_failed" | "invariant_failed",
  now = new Date(),
): Promise<boolean> {
  const nowIso = now.toISOString();
  if (!(await canPublishExport(env, claim))) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export failure lost its claim'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN users u ON u.id = e.user_id
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'running'
             AND u.status IN ('active', 'frozen')
             AND j.job_type = ? AND j.status = 'running'
             AND j.claim_token = ?
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        EXPORT_JOB_TYPE,
        claim.claimToken,
      ),
      env.DB.prepare(
        `UPDATE export_requests
         SET status = 'failed', error_class = ?, status_updated_at = ?,
             wrapped_export_key = NULL, export_key_nonce = NULL,
             export_kek_version = NULL, artifact_nonce = NULL,
             object_size_bytes = NULL, r2_uri = NULL, expires_at = NULL,
             artifact_deleted_at = NULL
         WHERE id = ? AND user_id = ? AND job_id = ? AND status = 'running'`,
      ).bind(
        errorClass,
        nowIso,
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
      ),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'failed', result_class = ?, finished_at = ?,
             claim_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
      ).bind(errorClass, nowIso, claim.jobId, EXPORT_JOB_TYPE, claim.claimToken),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export failure did not commit atomically'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'failed' AND e.error_class = ?
             AND e.r2_uri IS NULL AND e.wrapped_export_key IS NULL
             AND j.status = 'failed' AND j.result_class = ?
             AND j.claim_token IS NULL AND j.lease_expires_at IS NULL
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        errorClass,
        errorClass,
      ),
    ]);
    return true;
  } catch (error) {
    if (!(await canPublishExport(env, claim))) return false;
    throw error;
  }
}

export async function markFailedExportArtifactDeleted(
  env: Env,
  exportId: string,
  now = new Date(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE export_requests SET artifact_deleted_at = ?
     WHERE id = ? AND status = 'failed' AND artifact_deleted_at IS NULL`,
  )
    .bind(now.toISOString(), exportId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function releaseExportClaim(
  env: Env,
  claim: ExportClaim,
  retryAt: Date,
): Promise<boolean> {
  const retryIso = retryAt.toISOString();
  const releasedIso = new Date().toISOString();
  if (!(await canPublishExport(env, claim))) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export release lost its claim'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN users u ON u.id = e.user_id
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'running'
             AND u.status IN ('active', 'frozen')
             AND j.job_type = ? AND j.status = 'running'
             AND j.claim_token = ?
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        EXPORT_JOB_TYPE,
        claim.claimToken,
      ),
      env.DB.prepare(
        `UPDATE export_requests SET status = 'queued', status_updated_at = ?
         WHERE id = ? AND user_id = ? AND job_id = ? AND status = 'running'`,
      ).bind(
        releasedIso,
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
      ),
      env.DB.prepare(
        `UPDATE jobs
         SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
             available_at = ?, dispatched_at = NULL
         WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
      ).bind(retryIso, claim.jobId, EXPORT_JOB_TYPE, claim.claimToken),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'export release did not commit atomically'
         WHERE NOT EXISTS (
           SELECT 1
           FROM export_requests e
           JOIN jobs j ON j.id = e.job_id AND j.user_id = e.user_id
           WHERE e.id = ? AND e.user_id = ? AND e.job_id = ?
             AND e.status = 'queued'
             AND j.status = 'queued' AND j.available_at = ?
             AND j.dispatched_at IS NULL AND j.claim_token IS NULL
             AND j.lease_expires_at IS NULL
         )`,
      ).bind(
        claim.exportId,
        claim.identity.userId,
        claim.jobId,
        retryIso,
      ),
    ]);
    return true;
  } catch (error) {
    if (!(await canPublishExport(env, claim))) return false;
    throw error;
  }
}

export interface ExportStatusRow {
  id: string;
  user_id: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  r2_uri: string | null;
  expires_at: string | null;
  created_at: string;
  completed_at: string | null;
  status_updated_at: string;
  error_class: string | null;
  wrapped_export_key: ArrayBuffer | null;
  export_key_nonce: string | null;
  export_kek_version: number | null;
  artifact_nonce: string | null;
  object_size_bytes: number | null;
}

export async function loadOwnedExport(
  env: Env,
  userId: string,
  exportId: string,
): Promise<ExportStatusRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, status, r2_uri, expires_at, created_at, completed_at,
            status_updated_at, error_class, wrapped_export_key,
            export_key_nonce, export_kek_version, artifact_nonce,
            object_size_bytes
     FROM export_requests WHERE id = ? AND user_id = ?`,
  )
    .bind(exportId, userId)
    .first<ExportStatusRow>();
}
