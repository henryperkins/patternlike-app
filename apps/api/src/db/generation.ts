import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import { encryptPayload, loadUserKey, type UserIdentity } from "../db/users.js";
import { asCryptoSubject, decryptJson } from "../crypto.js";
import type {
  CommandReplacementReason,
  GenerateDailyReadingCommandV1,
} from "../services/generation-command.js";

/**
 * Reservation, claim, and publication — every one a single guarded `DB.batch()`.
 *
 * D1 runs a batch as one transaction, so an aborted assertion or a failed insert
 * rolls the whole thing back. The conditional aborts use the `assertion_probe`
 * table 0002 ships: its only column is constrained `CHECK (id = 0)`, so
 *
 *   INSERT INTO assertion_probe (id, reason) SELECT 1, '<reason>' WHERE <bad>
 *
 * is a no-op when the condition is false and aborts the enclosing transaction
 * when it is true. That is a conditional abort in pure SQL, built from a CHECK
 * constraint and nothing else — no triggers, which ALTER TABLE ... RENAME would
 * have rewritten during the same migration's table rebuilds.
 */

export const JOB_TYPE = "generate_daily_reading";

/** Two automatic attempts after the initial command, then the day stays failed. */
export const MAX_COMMAND_GENERATION = 3;

/** How long a consumer may hold a claim before another may reclaim it. */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** One initial Queue delivery plus the three retries configured in wrangler.toml. */
export const MAX_JOB_ATTEMPTS = 4;

export type ReserveOutcome =
  | { ok: true; readingId: string; jobId: string }
  /** A published or pending reading already exists for this user-day. */
  | { ok: false; reason: "duplicate"; readingId: string | null }
  /** The expected live predecessor is no longer the live row. */
  | { ok: false; reason: "stale_predecessor" }
  | { ok: false; reason: "conflict"; detail: string };

function auditStatement(
  env: Env,
  userId: string,
  action: string,
  readingId: string,
  detailClass: string,
  now: string,
) {
  return env.DB.prepare(
    `INSERT INTO audit_events
       (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
     VALUES (?, 'system', ?, ?, 'daily_reading', ?, 'success', ?, ?)`,
  ).bind(newId("aud"), userId, action, readingId, detailClass, now);
}

/**
 * `jobs.payload_enc`, with AAD bound to
 * `(subject, "jobs.payload_enc", job_id, key_version)`.
 *
 * The job id is part of the AAD, so the command cannot be lifted into another
 * job row even by someone holding the right DEK.
 */
async function encryptedJobInsert(
  env: Env,
  identity: UserIdentity,
  jobId: string,
  command: GenerateDailyReadingCommandV1,
  idempotencyKey: string,
  now: string,
): Promise<D1PreparedStatement> {
  const sealed = await encryptPayload(env, identity, command, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  return env.DB.prepare(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status, payload_json,
        payload_enc, payload_key_version, payload_nonce, attempts, created_at)
     VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?, ?, 0, ?)`,
  ).bind(
    jobId,
    JOB_TYPE,
    identity.userId,
    idempotencyKey,
    Uint8Array.from(atob(sealed.ciphertext), (ch) => ch.charCodeAt(0)),
    sealed.keyVersion,
    sealed.nonce,
    now,
  );
}

export function idempotencyKeyFor(command: GenerateDailyReadingCommandV1): string {
  return `daily-reading:${command.target_local_date}:r${command.revision}:g${command.command_generation}`;
}

async function liveReadingId(
  env: Env,
  userId: string,
  localDate: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT id FROM daily_readings
     WHERE user_id = ? AND local_date = ? AND status IN ('pending', 'published')
     ORDER BY revision DESC LIMIT 1`,
  )
    .bind(userId, localDate)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Reserve the initial reading for a user-day.
 *
 * One batch: the encrypted job, the pending artifact reservation pointing at it,
 * and the audit event. The reservation is what makes the day exist before any
 * work happens, so a duplicate delivery finds it rather than creating a second.
 */
export async function reserveInitial(
  env: Env,
  identity: UserIdentity,
  command: GenerateDailyReadingCommandV1,
): Promise<ReserveOutcome> {
  const now = new Date().toISOString();
  const jobId = newId("job");

  try {
    await env.DB.batch([
      // Not merely an optimisation over the partial unique indexes: those would
      // abort with a constraint error that reads identically to a real fault,
      // and this names the state so the caller can answer `duplicate` instead of
      // converting it into an unconditional supersession.
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'a pending or published reading already exists for this user-day'
         WHERE EXISTS (
           SELECT 1 FROM daily_readings
           WHERE user_id = ? AND local_date = ? AND status IN ('pending', 'published')
         )`,
      ).bind(identity.userId, command.target_local_date),
      await encryptedJobInsert(
        env,
        identity,
        jobId,
        command,
        idempotencyKeyFor(command),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO daily_readings
           (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
            contract_id, assembly_mode, status, revision, revision_reason,
            supersedes_reading_id, command_generation, active_generation_job_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'deterministic', 'pending', ?, ?, NULL, ?, ?, ?, ?)`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.target_local_date,
        command.release_version,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        command.revision,
        command.revision_reason,
        command.command_generation,
        jobId,
        now,
        now,
      ),
      auditStatement(
        env,
        identity.userId,
        "daily_reading.reserved",
        command.reading_id,
        "initial",
        now,
      ),
    ]);
  } catch (err) {
    const existing = await liveReadingId(env, identity.userId, command.target_local_date);
    if (existing) return { ok: false, reason: "duplicate", readingId: existing };
    return {
      ok: false,
      reason: "conflict",
      detail: err instanceof Error ? err.message : "reservation failed",
    };
  }

  return { ok: true, readingId: command.reading_id, jobId };
}

/**
 * Reserve a successor to a specific published reading.
 *
 * The predecessor is named, not looked up: a reissue that resolved "whatever is
 * live now" would supersede a row the caller never saw. Its revision must be
 * exactly one higher, so two concurrent reissues cannot both succeed —
 * `uq_daily_readings_successor` refuses the second claim on the same predecessor
 * even if both pass the assertion.
 */
export async function reserveReissue(
  env: Env,
  identity: UserIdentity,
  command: GenerateDailyReadingCommandV1,
  expectedLiveReadingId: string,
): Promise<ReserveOutcome> {
  const now = new Date().toISOString();
  const jobId = newId("job");

  const predecessor = await env.DB.prepare(
    `SELECT id, revision, status FROM daily_readings WHERE id = ? AND user_id = ?`,
  )
    .bind(expectedLiveReadingId, identity.userId)
    .first<{ id: string; revision: number; status: string }>();
  if (
    !predecessor ||
    predecessor.status !== "published" ||
    predecessor.revision + 1 !== command.revision
  ) {
    return { ok: false, reason: "stale_predecessor" };
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'expected predecessor is no longer the live reading at the expected revision'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND local_date = ?
             AND status = 'published' AND revision = ?
         )`,
      ).bind(
        expectedLiveReadingId,
        identity.userId,
        command.target_local_date,
        command.revision - 1,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'a successor is already pending for this user-day'
         WHERE EXISTS (
           SELECT 1 FROM daily_readings
           WHERE user_id = ? AND local_date = ? AND status = 'pending'
         )`,
      ).bind(identity.userId, command.target_local_date),
      await encryptedJobInsert(
        env,
        identity,
        jobId,
        command,
        idempotencyKeyFor(command),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO daily_readings
           (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
            contract_id, assembly_mode, status, revision, revision_reason,
            supersedes_reading_id, command_generation, active_generation_job_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'deterministic', 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.target_local_date,
        command.release_version,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        command.revision,
        command.revision_reason,
        expectedLiveReadingId,
        command.command_generation,
        jobId,
        now,
        now,
      ),
      auditStatement(
        env,
        identity.userId,
        "daily_reading.reissue_reserved",
        command.reading_id,
        command.revision_reason,
        now,
      ),
    ]);
  } catch (err) {
    const stillLive = await env.DB.prepare(
      `SELECT 1 AS present FROM daily_readings
       WHERE id = ? AND user_id = ? AND local_date = ?
         AND status = 'published' AND revision = ?`,
    )
      .bind(
        expectedLiveReadingId,
        identity.userId,
        command.target_local_date,
        command.revision - 1,
      )
      .first<{ present: number }>();
    const pending = await env.DB.prepare(
      `SELECT 1 AS present FROM daily_readings
       WHERE user_id = ? AND local_date = ? AND status = 'pending' LIMIT 1`,
    )
      .bind(identity.userId, command.target_local_date)
      .first<{ present: number }>();
    if (!stillLive || pending) {
      return { ok: false, reason: "stale_predecessor" };
    }
    return {
      ok: false,
      reason: "conflict",
      detail: err instanceof Error ? err.message : "reissue reservation failed",
    };
  }

  return { ok: true, readingId: command.reading_id, jobId };
}

export type ReplaceOutcome =
  | { ok: true; jobId: string }
  | {
      ok: false;
      reason: "stale_job" | "budget_exhausted" | "not_replaceable" | "conflict";
      detail: string;
    };

/**
 * Replace a terminally failed command with the next `gN` against the same
 * reservation.
 *
 * A different identity from artifact revision: the reading id, local date,
 * revision, reason, and predecessor are all preserved, and only the frozen
 * inputs change. Without this a single bad afternoon on the calculation service
 * would leave a permanent hole in a reader's history — `UNIQUE (user_id,
 * local_date, revision)` blocks any fresh initial enqueue forever once the
 * reservation sits at `failed`.
 */
export async function replaceCommand(
  env: Env,
  identity: UserIdentity,
  command: GenerateDailyReadingCommandV1,
  expectedFailedJobId: string,
  reason: CommandReplacementReason,
): Promise<ReplaceOutcome> {
  if (command.command_generation > MAX_COMMAND_GENERATION) {
    return {
      ok: false,
      reason: "budget_exhausted",
      detail: `command_generation ${command.command_generation} exceeds the ${MAX_COMMAND_GENERATION}-generation budget`,
    };
  }

  const now = new Date().toISOString();
  const jobId = newId("job");

  try {
    await env.DB.batch([
      // The CAS: this reservation, in this failed state, pointing at exactly
      // this terminal job, at exactly the previous generation. A stale job id, a
      // non-terminal job, or a generation that has already moved all abort.
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'reservation is not at the expected failed generation for the expected job'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings r
           JOIN jobs j ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
           WHERE r.id = ? AND r.user_id = ? AND r.status = 'failed'
             AND r.command_generation = ?
             AND j.id = ? AND j.status IN ('failed', 'cancelled')
         )`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.command_generation - 1,
        expectedFailedJobId,
      ),
      // A reissue's predecessor must still be the live row, or the replacement
      // would revive a successor to a reading that is no longer published.
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'reissue predecessor is no longer published'
         WHERE ? IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = 'published'
         )`,
      ).bind(
        command.supersedes_reading_id,
        command.supersedes_reading_id,
        identity.userId,
      ),
      await encryptedJobInsert(
        env,
        identity,
        jobId,
        command,
        idempotencyKeyFor(command),
        now,
      ),
      env.DB.prepare(
        `UPDATE daily_readings
         SET status = 'pending', command_generation = ?, active_generation_job_id = ?,
             release_version = ?, reading_key = ?, chart_fingerprint = ?,
             contract_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'failed'
           AND active_generation_job_id = ?`,
      ).bind(
        command.command_generation,
        jobId,
        command.release_version,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        now,
        command.reading_id,
        identity.userId,
        expectedFailedJobId,
      ),
      auditStatement(
        env,
        identity.userId,
        "daily_reading.command_replaced",
        command.reading_id,
        reason,
        now,
      ),
      // A guarded UPDATE that merely affects zero rows is not enough: later
      // statements would still commit. Prove the move actually happened.
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'replacement did not move the reservation to the new generation'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND status = 'pending'
             AND command_generation = ? AND active_generation_job_id = ?
         )`,
      ).bind(command.reading_id, command.command_generation, jobId),
    ]);
  } catch (err) {
    const stillReplaceable = await env.DB.prepare(
      `SELECT 1 AS present
       FROM daily_readings r
       JOIN jobs j ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
       WHERE r.id = ? AND r.user_id = ? AND r.status = 'failed'
         AND r.command_generation = ?
         AND j.id = ? AND j.status IN ('failed', 'cancelled')
         AND (
           ? IS NULL OR EXISTS (
             SELECT 1 FROM daily_readings predecessor
             WHERE predecessor.id = ? AND predecessor.user_id = ?
               AND predecessor.status = 'published'
           )
         )`,
    )
      .bind(
        command.reading_id,
        identity.userId,
        command.command_generation - 1,
        expectedFailedJobId,
        command.supersedes_reading_id,
        command.supersedes_reading_id,
        identity.userId,
      )
      .first<{ present: number }>();
    return {
      ok: false,
      reason: stillReplaceable ? "conflict" : "stale_job",
      detail: err instanceof Error ? err.message : "replacement failed",
    };
  }

  return { ok: true, jobId };
}

export interface Claim {
  jobId: string;
  claimToken: string;
  userId: string;
  attempts: number;
  command: GenerateDailyReadingCommandV1;
}

/**
 * The job was claimed, but its encrypted command could not be loaded.
 *
 * Carrying the claim identity lets the Queue handler release or terminalize the
 * exact lease instead of waiting for it to expire and then acknowledging the
 * next delivery as a duplicate.
 */
export class ClaimLoadError extends Error {
  readonly jobId: string;
  readonly claimToken: string;
  readonly attempts: number | null;
  readonly original: unknown;

  constructor(
    jobId: string,
    claimToken: string,
    attempts: number | null,
    original: unknown,
  ) {
    super(original instanceof Error ? original.message : "claimed command could not be loaded");
    this.name = "ClaimLoadError";
    this.jobId = jobId;
    this.claimToken = claimToken;
    this.attempts = attempts;
    this.original = original;
  }
}

/**
 * Compare-and-swap a job to `running`.
 *
 * A zero-row claim does no work — that is the whole concurrency story, and it is
 * what makes at-least-once delivery safe without a lock. An expired lease is
 * reclaimable so a consumer that died mid-flight does not strand the day.
 */
export async function claimJob(
  env: Env,
  jobId: string,
  now = new Date(),
): Promise<Claim | null> {
  const claimToken = newId("clm");
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();

  const result = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'running', claim_token = ?, lease_expires_at = ?,
         started_at = COALESCE(started_at, ?), attempts = attempts + 1,
         dispatched_at = COALESCE(dispatched_at, ?)
     WHERE id = ? AND job_type = ?
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))`,
  )
    .bind(claimToken, leaseExpiresAt, nowIso, nowIso, jobId, JOB_TYPE, nowIso)
    .run();

  if (!result.meta.changes) return null;

  let attempts: number | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT j.user_id, j.payload_enc, j.payload_key_version, j.payload_nonce,
              j.attempts, u.crypto_subject
       FROM jobs j JOIN users u ON u.id = j.user_id
       WHERE j.id = ?`,
    )
      .bind(jobId)
      .first<{
        user_id: string;
        payload_enc: ArrayBuffer;
        payload_key_version: number;
        payload_nonce: string;
        attempts: number;
        crypto_subject: string;
      }>();
    if (!row) {
      throw new Error("claimed job disappeared before its command was loaded");
    }
    attempts = row.attempts;

    const identity: UserIdentity = {
      userId: row.user_id,
      // Read from the row, never from a request — the only safe source.
      cryptoSubject: asCryptoSubject(row.crypto_subject),
    };
    const { dek } = await loadUserKey(env, identity);
    const command = await decryptJson<GenerateDailyReadingCommandV1>(
      {
        key_version: row.payload_key_version,
        nonce: row.payload_nonce,
        ciphertext: bytesToBase64(new Uint8Array(row.payload_enc)),
      },
      dek,
      { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
    );

    return { jobId, claimToken, userId: row.user_id, attempts: row.attempts, command };
  } catch (err) {
    throw new ClaimLoadError(jobId, claimToken, attempts, err);
  }
}

/** Return an owned running claim to the same immutable queued command. */
export async function releaseClaim(
  env: Env,
  jobId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
         available_at = NULL
     WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
  )
    .bind(jobId, JOB_TYPE, claimToken)
    .run();
  return result.meta.changes === 1;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface EvidenceRow {
  id: string;
  paragraphId: string;
  paragraphOrder: number;
  ciphertext: Uint8Array;
  keyVersion: number;
  nonce: string;
}

export interface PublicationInput {
  identity: UserIdentity;
  readingId: string;
  jobId: string;
  claimToken: string;
  commandGeneration: number;
  supersedesReadingId: string | null;
  reading: { ciphertext: Uint8Array; keyVersion: number; nonce: string };
  evidence: EvidenceRow[];
}

export type PublishOutcome =
  | { ok: true }
  | { ok: false; reason: "stale_claim" | "conflict"; detail: string };

/**
 * Publish a reserved reading and close its job, all or nothing.
 *
 * The opening assertion refuses unless the reservation is still pending at the
 * expected generation and the presented claim token still owns its active job.
 * The closing assertion refuses unless every intended effect actually landed —
 * a guarded UPDATE that affects zero rows would otherwise let the statements
 * after it commit, which is precisely how a "published" reading with no
 * ciphertext and a still-running job would come to exist.
 */
export async function completeReading(
  env: Env,
  input: PublicationInput,
): Promise<PublishOutcome> {
  const now = new Date().toISOString();
  const { identity, readingId, jobId, claimToken } = input;

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'reservation or claim is no longer the one this result was produced for'
       WHERE NOT EXISTS (
         SELECT 1 FROM daily_readings r
         JOIN jobs j ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
         WHERE r.id = ? AND r.user_id = ? AND r.status = 'pending'
           AND r.command_generation = ?
           AND j.id = ? AND j.status = 'running' AND j.claim_token = ?
       )`,
    ).bind(readingId, identity.userId, input.commandGeneration, jobId, claimToken),
  ];

  if (input.supersedesReadingId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'expected predecessor is not published'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = 'published'
         )`,
      ).bind(input.supersedesReadingId, identity.userId),
      env.DB.prepare(
        `UPDATE daily_readings SET status = 'superseded', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'published'`,
      ).bind(now, input.supersedesReadingId, identity.userId),
    );
  }

  statements.push(
    env.DB.prepare(
      `UPDATE daily_readings
       SET status = 'published', reading_enc = ?, reading_key_version = ?,
           reading_nonce = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'pending'`,
    ).bind(
      input.reading.ciphertext,
      input.reading.keyVersion,
      input.reading.nonce,
      now,
      readingId,
      identity.userId,
    ),
  );

  for (const row of input.evidence) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO reading_sources
           (id, reading_id, user_id, paragraph_id, paragraph_order,
            evidence_enc, evidence_key_version, evidence_nonce, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        readingId,
        identity.userId,
        row.paragraphId,
        row.paragraphOrder,
        row.ciphertext,
        row.keyVersion,
        row.nonce,
        now,
      ),
    );
  }

  statements.push(
    auditStatement(env, identity.userId, "daily_reading.published", readingId, "success", now),
    env.DB.prepare(
      `UPDATE jobs SET status = 'succeeded', finished_at = ?, claim_token = NULL,
                       lease_expires_at = NULL, result_class = 'published'
       WHERE id = ? AND status = 'running' AND claim_token = ?`,
    ).bind(now, jobId, claimToken),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'publication did not complete: reading, evidence, or job is not in its final state'
       WHERE NOT EXISTS (
         SELECT 1 FROM daily_readings r
         JOIN jobs j ON j.id = r.active_generation_job_id
         WHERE r.id = ? AND r.status = 'published'
           AND r.reading_enc IS NOT NULL
           AND j.id = ? AND j.status = 'succeeded'
       )
       OR (SELECT COUNT(*) FROM reading_sources WHERE reading_id = ?) != ?`,
    ).bind(readingId, jobId, readingId, input.evidence.length),
  );

  if (input.supersedesReadingId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'predecessor was not superseded'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings WHERE id = ? AND status = 'superseded'
         )`,
      ).bind(input.supersedesReadingId),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    const stillClaimed = await env.DB.prepare(
      `SELECT 1 AS present FROM jobs WHERE id = ? AND status = 'running' AND claim_token = ?`,
    )
      .bind(jobId, claimToken)
      .first<{ present: number }>();
    return {
      ok: false,
      reason: stillClaimed ? "conflict" : "stale_claim",
      detail: err instanceof Error ? err.message : "publication failed",
    };
  }

  return { ok: true };
}

/**
 * Move the reservation and its claimed job to a terminal failed state.
 *
 * Never supersedes the live reading: a failed successor leaves the reader with
 * the reading they already had, which is the whole point of reserving a
 * successor rather than editing the published row.
 */
export async function failReading(
  env: Env,
  identity: Pick<UserIdentity, "userId">,
  readingId: string,
  jobId: string,
  claimToken: string,
  resultClass: string,
): Promise<PublishOutcome> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'claim no longer owns this job'
         WHERE NOT EXISTS (
           SELECT 1 FROM jobs
           WHERE id = ? AND user_id = ? AND status = 'running' AND claim_token = ?
         )`,
      ).bind(jobId, identity.userId, claimToken),
      env.DB.prepare(
        `UPDATE daily_readings SET status = 'failed', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'pending'`,
      ).bind(now, readingId, identity.userId),
      env.DB.prepare(
        `UPDATE jobs SET status = 'failed', finished_at = ?, result_class = ?,
                         claim_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND status = 'running' AND claim_token = ?`,
      ).bind(now, resultClass, jobId, claimToken),
      auditStatement(env, identity.userId, "daily_reading.failed", readingId, resultClass, now),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'failure did not reach a terminal state'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings r JOIN jobs j ON j.id = r.active_generation_job_id
           WHERE r.id = ? AND r.status = 'failed' AND j.id = ? AND j.status = 'failed'
         )`,
      ).bind(readingId, jobId),
    ]);
  } catch (err) {
    const stillClaimed = await env.DB.prepare(
      `SELECT 1 AS present FROM jobs
       WHERE id = ? AND user_id = ? AND status = 'running' AND claim_token = ?`,
    )
      .bind(jobId, identity.userId, claimToken)
      .first<{ present: number }>();
    return {
      ok: false,
      reason: stillClaimed ? "conflict" : "stale_claim",
      detail: err instanceof Error ? err.message : "failure transition failed",
    };
  }
  return { ok: true };
}

/**
 * Fail a claim even when its encrypted payload cannot be read.
 *
 * Ownership and the reservation id are derived from D1, never from the Queue
 * message, so a malformed or mismatched message cannot fail somebody else's
 * reading.
 */
export async function failClaimedJob(
  env: Env,
  jobId: string,
  claimToken: string,
  resultClass: string,
): Promise<PublishOutcome> {
  const row = await env.DB.prepare(
    `SELECT j.user_id, r.id AS reading_id
     FROM jobs j
     JOIN daily_readings r
       ON r.active_generation_job_id = j.id AND r.user_id = j.user_id
     WHERE j.id = ? AND j.job_type = ? AND j.status = 'running'
       AND j.claim_token = ? AND r.status = 'pending'`,
  )
    .bind(jobId, JOB_TYPE, claimToken)
    .first<{ user_id: string; reading_id: string }>();
  if (!row) {
    return {
      ok: false,
      reason: "stale_claim",
      detail: "claim no longer owns a pending reading",
    };
  }
  return failReading(
    env,
    { userId: row.user_id },
    row.reading_id,
    jobId,
    claimToken,
    resultClass,
  );
}

/** Mark a job dispatched. Advisory: the outbox sweeper reads the absence of this. */
export async function markDispatched(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE jobs SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL`,
  )
    .bind(new Date().toISOString(), jobId)
    .run();
}

export interface SweepCandidate {
  id: string;
  reading_id: string | null;
}

/**
 * Jobs that committed but were never sent, and claims whose lease has expired.
 *
 * The first recovers a crash between the reservation batch and the queue send;
 * the second recovers a consumer that died holding a claim. Both converge
 * through the claim CAS, so a duplicate send is harmless.
 */
export async function findUndispatched(env: Env, limit = 50): Promise<SweepCandidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT j.id, r.id AS reading_id
     FROM jobs j
     LEFT JOIN daily_readings r ON r.active_generation_job_id = j.id
     WHERE j.job_type = ? AND j.status = 'queued' AND j.dispatched_at IS NULL
     ORDER BY j.created_at
     LIMIT ?`,
  )
    .bind(JOB_TYPE, limit)
    .all<SweepCandidate>();
  return results;
}

export async function findExpiredLeases(
  env: Env,
  now = new Date(),
  limit = 50,
): Promise<SweepCandidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT j.id, r.id AS reading_id
     FROM jobs j
     LEFT JOIN daily_readings r ON r.active_generation_job_id = j.id
     WHERE j.job_type = ? AND j.status = 'running' AND j.lease_expires_at < ?
     ORDER BY j.lease_expires_at
     LIMIT ?`,
  )
    .bind(JOB_TYPE, now.toISOString(), limit)
    .all<SweepCandidate>();
  return results;
}
