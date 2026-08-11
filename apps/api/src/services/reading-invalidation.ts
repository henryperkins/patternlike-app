import { newId } from "@patternlike/shared";

import type { Env } from "../env.js";
import { asCryptoSubject, fromB64 } from "../crypto.js";
import { persistCycles } from "../db/cycles.js";
import { reserveInvalidatedSuccessor } from "../db/generation.js";
import { loadPreferences } from "../db/preferences.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "../db/users.js";
import { dispatch, resolveV5TargetDate, type EnqueueOutcome } from "./enqueue.js";
import { buildGenerationCommandV2 } from "./generation-command-v2.js";
import { isStoredReadingV5, type StoredReadingV5 } from "./stored-reading.js";

export type FactInvalidationReason = "chart_correction" | "calculation_defect";

export type InvalidationOutcome =
  | {
      ok: true;
      status: "invalidated" | "already_invalidated";
      readingId: string;
    }
  | {
      ok: false;
      reason: "not_found" | "not_published" | "not_supported" | "conflict";
      detail: string;
    };

interface InvalidationRow {
  id: string;
  status: string;
  reading_enc: ArrayBuffer;
  reading_key_version: number;
  reading_nonce: string;
}

function actorClass(reason: FactInvalidationReason): "user_change" | "operator" {
  return reason === "chart_correction" ? "user_change" : "operator";
}

/**
 * Hide one factual artifact and append its private invalidation evidence.
 *
 * The row identity and AAD do not change. Decrypting and resealing before the
 * batch is safe because the batch compares every sealed field it read; if
 * another caller moved the row first, the assertion aborts every statement,
 * including the clear audit event.
 */
export async function invalidatePublishedReading(
  env: Env,
  input: {
    identity: UserIdentity;
    readingId: string;
    reason: FactInvalidationReason;
    now: Date;
  },
): Promise<InvalidationOutcome> {
  const { identity, readingId, reason, now } = input;
  const row = await env.DB.prepare(
    `SELECT id, status, reading_enc, reading_key_version, reading_nonce
     FROM daily_readings
     WHERE id = ? AND user_id = ?`,
  )
    .bind(readingId, identity.userId)
    .first<InvalidationRow>();
  if (!row) {
    return { ok: false, reason: "not_found", detail: "reading was not found" };
  }
  if (row.status === "invalidated") {
    return { ok: true, status: "already_invalidated", readingId };
  }
  if (row.status !== "published") {
    return {
      ok: false,
      reason: "not_published",
      detail: "reading is not currently published",
    };
  }

  let stored: unknown;
  try {
    let binary = "";
    for (const byte of new Uint8Array(row.reading_enc)) binary += String.fromCharCode(byte);
    stored = await decryptPayload<unknown>(
      env,
      identity,
      {
        key_version: row.reading_key_version,
        nonce: row.reading_nonce,
        ciphertext: btoa(binary),
      },
      {
        subject: identity.cryptoSubject,
        field: "daily_readings.reading_enc",
        recordId: readingId,
      },
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      detail: "stored reading could not be opened for invalidation",
    };
  }
  if (!isStoredReadingV5(stored)) {
    return {
      ok: false,
      reason: "not_supported",
      detail: "only constrained-model readings carry factual invalidation evidence",
    };
  }

  const invalidatedAt = now.toISOString();
  const next: StoredReadingV5 = {
    ...stored,
    invalidation: {
      reason,
      actor_class: actorClass(reason),
      invalidated_at: invalidatedAt,
    },
  };
  const sealed = await encryptPayload(env, identity, next, {
    subject: identity.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: readingId,
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'published reading changed before invalidation'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = 'published'
             AND reading_key_version = ? AND reading_nonce = ? AND reading_enc = ?
         )`,
      ).bind(
        readingId,
        identity.userId,
        row.reading_key_version,
        row.reading_nonce,
        row.reading_enc,
      ),
      env.DB.prepare(
        `UPDATE daily_readings
         SET status = 'invalidated', invalidated_at = ?, reading_enc = ?,
             reading_key_version = ?, reading_nonce = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'published'
           AND reading_key_version = ? AND reading_nonce = ? AND reading_enc = ?`,
      ).bind(
        invalidatedAt,
        fromB64(sealed.ciphertext),
        sealed.keyVersion,
        sealed.nonce,
        invalidatedAt,
        readingId,
        identity.userId,
        row.reading_key_version,
        row.reading_nonce,
        row.reading_enc,
      ),
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id,
            result, detail_class, created_at)
         VALUES (?, 'system', ?, 'daily_reading.invalidated', 'daily_reading', ?,
                 'success', 'fact_repair_required', ?)`,
      ).bind(newId("aud"), identity.userId, readingId, invalidatedAt),
    ]);
  } catch {
    const current = await env.DB.prepare(
      `SELECT status FROM daily_readings WHERE id = ? AND user_id = ?`,
    )
      .bind(readingId, identity.userId)
      .first<{ status: string }>();
    if (current?.status === "invalidated") {
      return { ok: true, status: "already_invalidated", readingId };
    }
    return {
      ok: false,
      reason: current ? "not_published" : "not_found",
      detail: "reading changed before invalidation committed",
    };
  }

  return { ok: true, status: "invalidated", readingId };
}

interface RepairPredecessor {
  id: string;
  user_id: string;
  crypto_subject: string;
  local_date: string;
  revision: number;
  status: string;
  reading_enc: ArrayBuffer;
  reading_key_version: number;
  reading_nonce: string;
}

async function existingRepair(
  env: Env,
  predecessorId: string,
): Promise<EnqueueOutcome | null> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.active_generation_job_id AS job_id, j.dispatched_at
     FROM daily_readings r
     LEFT JOIN jobs j ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
     WHERE r.supersedes_reading_id = ?`,
  )
    .bind(predecessorId)
    .first<{ id: string; job_id: string | null; dispatched_at: string | null }>();
  if (!row) return null;
  if (!row.job_id) {
    return {
      ok: false,
      reason: "conflict",
      detail: "fact repair successor has no active generation job",
    };
  }
  const dispatched =
    row.dispatched_at !== null ||
    (await dispatch(env, { job_id: row.job_id, reading_id: row.id }));
  return { ok: true, readingId: row.id, jobId: row.job_id, dispatched };
}

/** Reserve exactly one r+1 successor to a named invalidated predecessor. */
export async function reserveFactRepair(
  env: Env,
  predecessorId: string,
  now: Date,
): Promise<EnqueueOutcome> {
  const existing = await existingRepair(env, predecessorId);
  if (existing) return existing;

  const predecessor = await env.DB.prepare(
    `SELECT r.id, r.user_id, u.crypto_subject, r.local_date, r.revision, r.status,
            r.reading_enc, r.reading_key_version, r.reading_nonce
     FROM daily_readings r
     JOIN users u ON u.id = r.user_id AND u.status = 'active'
     WHERE r.id = ?`,
  )
    .bind(predecessorId)
    .first<RepairPredecessor>();
  if (!predecessor || predecessor.status !== "invalidated") {
    return {
      ok: false,
      reason: "stale_predecessor",
      detail: "the expected predecessor is not invalidated",
    };
  }
  const identity: UserIdentity = {
    userId: predecessor.user_id,
    cryptoSubject: asCryptoSubject(predecessor.crypto_subject),
  };

  let stored: unknown;
  try {
    let binary = "";
    for (const byte of new Uint8Array(predecessor.reading_enc)) {
      binary += String.fromCharCode(byte);
    }
    stored = await decryptPayload<unknown>(
      env,
      identity,
      {
        key_version: predecessor.reading_key_version,
        nonce: predecessor.reading_nonce,
        ciphertext: btoa(binary),
      },
      {
        subject: identity.cryptoSubject,
        field: "daily_readings.reading_enc",
        recordId: predecessor.id,
      },
    );
  } catch {
    return {
      ok: false,
      reason: "conflict",
      detail: "invalidated predecessor could not be opened",
    };
  }
  if (!isStoredReadingV5(stored) || stored.invalidation === null) {
    return {
      ok: false,
      reason: "conflict",
      detail: "invalidated predecessor has no encrypted repair lineage",
    };
  }

  const revisionReason =
    stored.invalidation.reason === "chart_correction"
      ? "chart_recalculated"
      : "defect_repair";
  const build = await buildGenerationCommandV2(env, identity, {
    readingId: newId("rdg"),
    revision: predecessor.revision + 1,
    revisionReason,
    supersedesReadingId: predecessor.id,
    reservationReason: "fact_repair",
    commandGeneration: 1,
    replacesJobId: null,
    commandReplacementReason: null,
    targetLocalDate: predecessor.local_date,
    now,
  });
  if (!build.ok) return { ok: false, reason: build.reason, detail: build.detail };
  await persistCycles(env, identity.userId, build.chartId, build.cycles);

  const reserved = await reserveInvalidatedSuccessor(
    env,
    identity,
    build.command,
    predecessor.id,
  );
  if (!reserved.ok) {
    if (reserved.reason === "duplicate") {
      const raced = await existingRepair(env, predecessor.id);
      if (raced) return raced;
      return {
        ok: false,
        reason: "conflict",
        detail: "fact repair successor could not be recovered",
      };
    }
    if (reserved.reason === "stale_predecessor") {
      return {
        ok: false,
        reason: "stale_predecessor",
        detail: "the invalidated predecessor changed before repair was reserved",
      };
    }
    return { ok: false, reason: "conflict", detail: reserved.detail };
  }

  const dispatched = await dispatch(env, {
    job_id: reserved.jobId,
    reading_id: reserved.readingId,
  });
  return { ok: true, readingId: reserved.readingId, jobId: reserved.jobId, dispatched };
}

export type ReconcileFactRepairOutcome =
  | { ok: true; status: "current" }
  | ({ ok: true; status: "repair_reserved"; predecessorId: string } & Extract<
      EnqueueOutcome,
      { ok: true }
    >)
  | { ok: false; reason: string; detail: string };

/**
 * Reconcile the current owner-day after chart activation or an interrupted
 * invalidation/reservation sequence. Task 12 discovers scheduler candidates;
 * this owner-scoped primitive performs one indexed recovery only.
 */
export async function reconcileCurrentFactRepair(
  env: Env,
  identity: UserIdentity,
  reason: FactInvalidationReason,
  now: Date,
): Promise<ReconcileFactRepairOutcome> {
  const preferences = await loadPreferences(env, identity.userId);
  const localDate = preferences
    ? resolveV5TargetDate(preferences.timezone, now)
    : null;
  if (!localDate) {
    return { ok: false, reason: "timezone_confirmation_required", detail: "no local date" };
  }

  const published = await env.DB.prepare(
    `SELECT r.id,
            EXISTS (
              SELECT 1 FROM chart_snapshots c
              WHERE c.user_id = r.user_id AND c.status = 'active'
                AND c.fingerprint = r.chart_fingerprint
                AND c.contract_id = r.contract_id
            ) AS authoritative
     FROM daily_readings r
     WHERE r.user_id = ? AND r.local_date = ? AND r.status = 'published'`,
  )
    .bind(identity.userId, localDate)
    .first<{ id: string; authoritative: number }>();
  if (published?.authoritative) return { ok: true, status: "current" };

  let predecessorId = published?.id ?? null;
  if (predecessorId) {
    const invalidated = await invalidatePublishedReading(env, {
      identity,
      readingId: predecessorId,
      reason,
      now,
    });
    if (!invalidated.ok) return invalidated;
  } else {
    const orphan = await env.DB.prepare(
      `SELECT id FROM daily_readings
       WHERE status = 'invalidated' AND user_id = ? AND local_date = ?
         AND NOT EXISTS (
           SELECT 1 FROM daily_readings successor
           WHERE successor.supersedes_reading_id = daily_readings.id
         )
       ORDER BY updated_at, id LIMIT 1`,
    )
      .bind(identity.userId, localDate)
      .first<{ id: string }>();
    predecessorId = orphan?.id ?? null;
  }
  if (!predecessorId) return { ok: true, status: "current" };

  const reserved = await reserveFactRepair(env, predecessorId, now);
  if (!reserved.ok) return reserved;
  return {
    ok: true,
    status: "repair_reserved",
    predecessorId,
    readingId: reserved.readingId,
    jobId: reserved.jobId,
    dispatched: reserved.dispatched,
  };
}
