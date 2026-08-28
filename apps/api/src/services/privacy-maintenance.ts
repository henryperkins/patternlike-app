import type { Env, PrivacyMessage } from "../env.js";
import { DELETION_ARTIFACT_FAMILIES } from "./deletion-manifest.js";
import { exportObjectKey } from "./export-envelope.js";
import { pruneExpiredPlaceResolutions } from "../db/place-resolutions.js";

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEVICE_PREFERENCE_JOB_RETENTION_DAYS = 35;

type DispatchMessage = (
  env: Env,
  message: PrivacyMessage,
) => Promise<boolean>;

export interface PrivacyMaintenanceOptions {
  batchLimit?: number;
  dispatchMessage?: DispatchMessage;
}

export interface PrivacyMaintenanceSummary {
  signalsExpired: number;
  signalsPurged: number;
  exportsExpired: number;
  failedExportArtifactsCleaned: number;
  deletionArtifactsCleaned: number;
  deletionReceiptsExpired: number;
  devicePreferenceJobsPruned: number;
  placeResolutionsPruned: number;
  privacyJobsDispatched: number;
}

interface ExportExpiryRow {
  id: string;
}

interface RecoveryJobRow {
  id: string;
  job_type: PrivacyMessage["job_type"];
}

interface DeletionArtifactCleanupRow {
  id: string;
  artifact_manifest_json: string;
  artifact_cleanup_until: string | null;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_LIMIT;
  if (!Number.isInteger(value)) return DEFAULT_BATCH_LIMIT;
  return Math.max(1, Math.min(value, MAX_BATCH_LIMIT));
}

async function sendPrivacyMessage(
  env: Env,
  message: PrivacyMessage,
): Promise<boolean> {
  try {
    await env.PRIVACY_QUEUE.send(message);
    return true;
  } catch {
    return false;
  }
}

async function expireSignals(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE context_signals
     SET freshness_status = 'expired', updated_at = ?
     WHERE id IN (
       SELECT id FROM context_signals
       WHERE expires_at IS NOT NULL AND expires_at <= ?
         AND freshness_status != 'expired'
       ORDER BY expires_at, id
       LIMIT ?
     )`,
  )
    .bind(nowIso, nowIso, limit)
    .run();
  return result.meta.changes ?? 0;
}

async function purgeRetainedSignals(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE context_source_permissions
       SET last_signal_id = NULL, updated_at = ?
       WHERE last_signal_id IN (
         SELECT id FROM context_signals
         WHERE retention_expires_at IS NOT NULL AND retention_expires_at <= ?
         ORDER BY retention_expires_at, id
         LIMIT ?
       )`,
    ).bind(nowIso, nowIso, limit),
    env.DB.prepare(
      `DELETE FROM context_signals
       WHERE id IN (
         SELECT id FROM context_signals
         WHERE retention_expires_at IS NOT NULL AND retention_expires_at <= ?
         ORDER BY retention_expires_at, id
         LIMIT ?
       )`,
    ).bind(nowIso, limit),
  ]);
  return results[1]?.meta.changes ?? 0;
}

async function expireExports(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  if (!env.ARTIFACTS) return 0;
  const { results } = await env.DB.prepare(
    `SELECT id FROM export_requests
     WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at, id
     LIMIT ?`,
  )
    .bind(nowIso, limit)
    .all<ExportExpiryRow>();

  let expired = 0;
  for (const row of results) {
    if (await expireExportArtifact(env, row.id, new Date(nowIso))) expired += 1;
  }
  return expired;
}

async function cleanupFailedExportArtifacts(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  if (!env.ARTIFACTS) return 0;
  const { results } = await env.DB.prepare(
    `SELECT id FROM export_requests
     WHERE status = 'failed' AND artifact_deleted_at IS NULL
     ORDER BY status_updated_at, id
     LIMIT ?`,
  )
    .bind(limit)
    .all<ExportExpiryRow>();

  let cleaned = 0;
  for (const row of results) {
    try {
      await env.ARTIFACTS.delete(exportObjectKey(row.id));
      const updated = await env.DB.prepare(
        `UPDATE export_requests SET artifact_deleted_at = ?
         WHERE id = ? AND status = 'failed' AND artifact_deleted_at IS NULL`,
      )
        .bind(nowIso, row.id)
        .run();
      cleaned += updated.meta.changes ?? 0;
    } catch {
      // The failed row remains the durable cleanup obligation for the next run.
    }
  }
  return cleaned;
}

async function expireDeletionReceipts(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE deletion_requests
     SET receipt_hash = NULL, receipt_expires_at = NULL
     WHERE id IN (
       SELECT id FROM deletion_requests
       WHERE receipt_hash IS NOT NULL AND receipt_expires_at <= ?
       ORDER BY receipt_expires_at, id
       LIMIT ?
     )`,
  )
    .bind(nowIso, limit)
    .run();
  return result.meta.changes ?? 0;
}

async function pruneDevicePreferenceJobs(
  env: Env,
  now: Date,
  limit: number,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - DEVICE_PREFERENCE_JOB_RETENTION_DAYS * DAY_MS,
  ).toISOString();
  const result = await env.DB.prepare(
    `DELETE FROM jobs
     WHERE id IN (
       SELECT id FROM jobs
       WHERE status = 'succeeded'
         AND job_type IN ('preference_timezone', 'preference_locale')
         AND idempotency_key LIKE 'web-device-%'
         AND finished_at IS NOT NULL AND finished_at <= ?
       ORDER BY finished_at, id
       LIMIT ?
     )`,
  )
    .bind(cutoff, limit)
    .run();
  return result.meta.changes ?? 0;
}

function parseDeletionArtifactManifest(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return null;
    }
    const keys = [...new Set(parsed)];
    if (
      keys.some((key) =>
        !DELETION_ARTIFACT_FAMILIES.some((family) => key.startsWith(family.prefix))
      )
    ) {
      return null;
    }
    return keys.sort();
  } catch {
    return null;
  }
}

async function cleanupDeletionArtifacts(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<number> {
  if (!env.ARTIFACTS) return 0;
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.artifact_manifest_json, d.artifact_cleanup_until
     FROM deletion_requests d
     JOIN users u ON u.id = d.user_id
     WHERE d.artifact_manifest_json != '[]'
       AND u.status IN ('pending_deletion', 'deleted')
     ORDER BY d.artifact_cleanup_until, d.id
     LIMIT ?`,
  )
    .bind(limit)
    .all<DeletionArtifactCleanupRow>();

  let cleaned = 0;
  for (const row of results) {
    const keys = parseDeletionArtifactManifest(row.artifact_manifest_json);
    if (!keys) continue;
    try {
      for (let offset = 0; offset < keys.length; offset += 1000) {
        await env.ARTIFACTS.delete(keys.slice(offset, offset + 1000));
      }
    } catch {
      continue;
    }
    cleaned += keys.length;
    if (
      row.artifact_cleanup_until !== null &&
      row.artifact_cleanup_until <= nowIso
    ) {
      await env.DB.prepare(
        `UPDATE deletion_requests
         SET artifact_manifest_json = '[]', artifact_cleanup_until = NULL
         WHERE id = ? AND artifact_manifest_json = ?
           AND artifact_cleanup_until = ?`,
      )
        .bind(
          row.id,
          row.artifact_manifest_json,
          row.artifact_cleanup_until,
        )
        .run();
    }
  }
  return cleaned;
}

/**
 * Delete one elapsed artifact before erasing the only recoverable key metadata.
 *
 * Shared by cron and read-time fail-closed expiry. R2 deletion is idempotent,
 * and the guarded update means concurrent observers converge without either
 * one treating a zero-row update as a failure worth exposing to the caller.
 */
export async function expireExportArtifact(
  env: Env,
  exportId: string,
  now = new Date(),
): Promise<boolean> {
  if (!env.ARTIFACTS) return false;
  const nowIso = now.toISOString();
  try {
    await env.ARTIFACTS.delete(exportObjectKey(exportId));
    const updated = await env.DB.prepare(
      `UPDATE export_requests
       SET status = 'expired', r2_uri = NULL, wrapped_export_key = NULL,
           export_key_nonce = NULL, export_kek_version = NULL,
           artifact_nonce = NULL, object_size_bytes = NULL,
           status_updated_at = ?, artifact_deleted_at = ?
       WHERE id = ? AND status = 'ready'
         AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
      .bind(nowIso, nowIso, exportId, nowIso)
      .run();
    return (updated.meta.changes ?? 0) === 1;
  } catch {
    // The read path still reports expiry. Keeping the recoverable metadata lets
    // a later read or scheduled sweep retry object deletion safely.
    return false;
  }
}

async function recoverPrivacyJobs(
  env: Env,
  nowIso: string,
  limit: number,
  dispatchMessage: DispatchMessage,
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, job_type
     FROM jobs
     WHERE job_type IN ('export_account', 'delete_account')
       AND (
         (status = 'queued' AND dispatched_at IS NULL
           AND (available_at IS NULL OR available_at <= ?))
         OR
         (status = 'running' AND lease_expires_at IS NOT NULL
           AND lease_expires_at < ?)
       )
     ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, created_at, id
     LIMIT ?`,
  )
    .bind(nowIso, nowIso, limit)
    .all<RecoveryJobRow>();

  let dispatched = 0;
  for (const row of results) {
    const message: PrivacyMessage = {
      kind: "privacy",
      job_id: row.id,
      job_type: row.job_type,
    };
    if (!(await dispatchMessage(env, message))) continue;
    const marked = await env.DB.prepare(
      `UPDATE jobs SET dispatched_at = ?
       WHERE id = ? AND job_type = ?
         AND (
           (status = 'queued' AND dispatched_at IS NULL
             AND (available_at IS NULL OR available_at <= ?))
           OR
           (status = 'running' AND lease_expires_at IS NOT NULL
             AND lease_expires_at < ?)
         )`,
    )
      .bind(nowIso, row.id, row.job_type, nowIso, nowIso)
      .run();
    dispatched += marked.meta.changes ?? 0;
  }
  return dispatched;
}

/** Run every privacy lifecycle lane once, with a hard cap per lane. */
export async function runPrivacyMaintenance(
  env: Env,
  now = new Date(),
  options: PrivacyMaintenanceOptions = {},
): Promise<PrivacyMaintenanceSummary> {
  const limit = boundedLimit(options.batchLimit);
  const nowIso = now.toISOString();
  const dispatchMessage = options.dispatchMessage ?? sendPrivacyMessage;

  const signalsExpired = await expireSignals(env, nowIso, limit);
  const signalsPurged = await purgeRetainedSignals(env, nowIso, limit);
  const exportsExpired = await expireExports(env, nowIso, limit);
  const failedExportArtifactsCleaned = await cleanupFailedExportArtifacts(
    env,
    nowIso,
    limit,
  );
  const deletionArtifactsCleaned = await cleanupDeletionArtifacts(
    env,
    nowIso,
    limit,
  );
  const deletionReceiptsExpired = await expireDeletionReceipts(
    env,
    nowIso,
    limit,
  );
  const devicePreferenceJobsPruned = await pruneDevicePreferenceJobs(
    env,
    now,
    limit,
  );
  const placeResolutionsPruned = await pruneExpiredPlaceResolutions(
    env,
    now,
    limit,
  );
  const privacyJobsDispatched = await recoverPrivacyJobs(
    env,
    nowIso,
    limit,
    dispatchMessage,
  );

  return {
    signalsExpired,
    signalsPurged,
    exportsExpired,
    failedExportArtifactsCleaned,
    deletionArtifactsCleaned,
    deletionReceiptsExpired,
    devicePreferenceJobsPruned,
    placeResolutionsPruned,
    privacyJobsDispatched,
  };
}
