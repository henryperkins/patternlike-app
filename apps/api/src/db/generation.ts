import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import { encryptPayload, loadUserKey, type UserIdentity } from "../db/users.js";
import { asCryptoSubject, decryptJson } from "../crypto.js";
import {
  LEASE_RETRY_DELAY_SECONDS,
  MAX_COMMAND_GENERATION,
  type GenerationReplacementReason,
} from "../services/generation-failures.js";
import {
  isCommandV2,
  type GenerateDailyReadingCommand,
  type GenerateDailyReadingCommandV2,
} from "../services/generation-command-v2.js";
import { READING_PUBLISHER_PROVIDER } from "../services/reading-publisher.js";

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

export { MAX_COMMAND_GENERATION, MAX_JOB_ATTEMPTS } from "../services/generation-failures.js";

/** How long a consumer may hold a claim before another may reclaim it. */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

export type ReserveOutcome =
  | { ok: true; readingId: string; jobId: string }
  /** A published or pending reading already exists for this user-day. */
  | { ok: false; reason: "duplicate"; readingId: string | null }
  /** The expected live predecessor is no longer the live row. */
  | { ok: false; reason: "stale_predecessor" }
  | { ok: false; reason: "conflict"; detail: string };

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface InitialGenerationState {
  readingId: string;
  readingStatus: "pending" | "failed";
  commandGeneration: number;
  activeJob: {
    id: string;
    status: GenerationJobStatus;
    resultClass: string | null;
    availableAt: string | null;
    dispatchedAt: string | null;
    leaseExpiresAt: string | null;
  } | null;
}

export interface CurrentGenerationState extends InitialGenerationState {
  assemblyMode: "deterministic" | "constrained_model";
}

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
  command: GenerateDailyReadingCommand,
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

/**
 * The per-user idempotency key for one command.
 *
 * The two families are namespaced apart. A user-day can only ever hold one
 * reservation, so a collision is not reachable through the product — but the key
 * is what a replay is matched on, and two different command shapes answering to
 * one key would make "the same request" mean two different readings.
 */
export function idempotencyKeyFor(command: GenerateDailyReadingCommand): string {
  const family = isCommandV2(command) ? "daily-reading-v5" : "daily-reading";
  return `${family}:${command.target_local_date}:r${command.revision}:g${command.command_generation}`;
}

/**
 * The clear reservation columns a command implies.
 *
 * One place, because these were hardcoded at three call sites. `deterministic`
 * with a non-null release and `constrained_model` with a null one are the two
 * shapes 0003's CHECK admits, and deriving them from the command is what stops a
 * V2 reservation from claiming an editorial release it does not have.
 */
function reservationColumns(command: GenerateDailyReadingCommand): {
  assemblyMode: "deterministic" | "constrained_model";
  releaseVersion: string | null;
} {
  return isCommandV2(command)
    ? { assemblyMode: "constrained_model", releaseVersion: null }
    : { assemblyMode: "deterministic", releaseVersion: command.release_version };
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
 * The initial reservation and active job for one owner's local day.
 *
 * This is intentionally not a sweeper query: a product request may inspect and
 * recover only the day it authenticated for. Published rows are loaded through
 * `db/readings.ts`; this projection names only the two states whose generation
 * job still determines the next action.
 */
export async function loadInitialGenerationState(
  env: Env,
  userId: string,
  localDate: string,
): Promise<InitialGenerationState | null> {
  const row = await env.DB.prepare(
    `SELECT r.id AS reading_id, r.status AS reading_status, r.command_generation,
            j.id AS job_id, j.status AS job_status, j.result_class,
            j.available_at, j.dispatched_at, j.lease_expires_at
     FROM daily_readings r
     LEFT JOIN jobs j
       ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
     WHERE r.user_id = ? AND r.local_date = ?
       AND r.revision = 1 AND r.revision_reason = 'initial'
       AND r.status IN ('pending', 'failed')
     LIMIT 1`,
  )
    .bind(userId, localDate)
    .first<{
      reading_id: string;
      reading_status: "pending" | "failed";
      command_generation: number;
      job_id: string | null;
      job_status: GenerationJobStatus | null;
      result_class: string | null;
      available_at: string | null;
      dispatched_at: string | null;
      lease_expires_at: string | null;
    }>();

  if (!row) return null;

  return {
    readingId: row.reading_id,
    readingStatus: row.reading_status,
    commandGeneration: row.command_generation,
    activeJob:
      row.job_id === null || row.job_status === null
        ? null
        : {
            id: row.job_id,
            status: row.job_status,
            resultClass: row.result_class,
            availableAt: row.available_at,
            dispatchedAt: row.dispatched_at,
            leaseExpiresAt: row.lease_expires_at,
          },
  };
}

/**
 * The newest live generation state for an owner-day, including its command
 * family. Unlike the frozen M3 reader above, this sees an r2+ fact-repair
 * successor so the M5 product path cannot mistake it for an absent day.
 */
export async function loadCurrentGenerationState(
  env: Env,
  userId: string,
  localDate: string,
): Promise<CurrentGenerationState | null> {
  const row = await env.DB.prepare(
    `SELECT r.id AS reading_id, r.status AS reading_status, r.assembly_mode,
            r.command_generation, j.id AS job_id, j.status AS job_status,
            j.result_class, j.available_at, j.dispatched_at, j.lease_expires_at
     FROM daily_readings r
     LEFT JOIN jobs j
       ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
     WHERE r.user_id = ? AND r.local_date = ?
       AND r.status IN ('pending', 'failed')
     ORDER BY r.revision DESC
     LIMIT 1`,
  )
    .bind(userId, localDate)
    .first<{
      reading_id: string;
      reading_status: "pending" | "failed";
      assembly_mode: "deterministic" | "constrained_model";
      command_generation: number;
      job_id: string | null;
      job_status: GenerationJobStatus | null;
      result_class: string | null;
      available_at: string | null;
      dispatched_at: string | null;
      lease_expires_at: string | null;
    }>();
  if (!row) return null;
  return {
    readingId: row.reading_id,
    readingStatus: row.reading_status,
    assemblyMode: row.assembly_mode,
    commandGeneration: row.command_generation,
    activeJob:
      row.job_id === null || row.job_status === null
        ? null
        : {
            id: row.job_id,
            status: row.job_status,
            resultClass: row.result_class,
            availableAt: row.available_at,
            dispatchedAt: row.dispatched_at,
            leaseExpiresAt: row.lease_expires_at,
          },
  };
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
  command: GenerateDailyReadingCommand,
): Promise<ReserveOutcome> {
  const now = new Date().toISOString();
  const jobId = newId("job");
  const columns = reservationColumns(command);

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, ?, ?, ?)`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.target_local_date,
        columns.releaseVersion,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        columns.assemblyMode,
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
  command: GenerateDailyReadingCommand,
  expectedLiveReadingId: string,
): Promise<ReserveOutcome> {
  const now = new Date().toISOString();
  const jobId = newId("job");
  const columns = reservationColumns(command);

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.target_local_date,
        columns.releaseVersion,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        columns.assemblyMode,
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

/**
 * Reserve the first successor to a named factually invalidated reading.
 *
 * This is intentionally not a mode on `reserveReissue`: an ordinary reissue
 * requires a published predecessor, while a fact repair must refuse until the
 * predecessor has already stopped being live. Keeping separate assertions is
 * what prevents a caller from accidentally weakening both paths at once.
 */
export async function reserveInvalidatedSuccessor(
  env: Env,
  identity: UserIdentity,
  command: GenerateDailyReadingCommand,
  invalidatedReadingId: string,
): Promise<ReserveOutcome> {
  const now = new Date().toISOString();
  const jobId = newId("job");
  const columns = reservationColumns(command);
  const predecessor = await env.DB.prepare(
    `SELECT id, revision, status, local_date
     FROM daily_readings WHERE id = ? AND user_id = ?`,
  )
    .bind(invalidatedReadingId, identity.userId)
    .first<{ id: string; revision: number; status: string; local_date: string }>();
  if (
    !predecessor ||
    predecessor.status !== "invalidated" ||
    predecessor.local_date !== command.target_local_date ||
    predecessor.revision + 1 !== command.revision ||
    command.supersedes_reading_id !== invalidatedReadingId ||
    !isCommandV2(command) ||
    command.reservation_reason !== "fact_repair"
  ) {
    return { ok: false, reason: "stale_predecessor" };
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'expected predecessor is not invalidated at the expected revision'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND local_date = ?
             AND status = 'invalidated' AND revision = ?
         )`,
      ).bind(
        invalidatedReadingId,
        identity.userId,
        command.target_local_date,
        command.revision - 1,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'invalidated predecessor already has a successor'
         WHERE EXISTS (
           SELECT 1 FROM daily_readings WHERE supersedes_reading_id = ?
         )`,
      ).bind(invalidatedReadingId),
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        command.reading_id,
        identity.userId,
        command.target_local_date,
        columns.releaseVersion,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        columns.assemblyMode,
        command.revision,
        command.revision_reason,
        invalidatedReadingId,
        command.command_generation,
        jobId,
        now,
        now,
      ),
      auditStatement(
        env,
        identity.userId,
        "daily_reading.fact_repair_reserved",
        command.reading_id,
        "fact_repair",
        now,
      ),
    ]);
  } catch (err) {
    const successor = await env.DB.prepare(
      `SELECT id FROM daily_readings
       WHERE supersedes_reading_id = ? AND user_id = ?`,
    )
      .bind(invalidatedReadingId, identity.userId)
      .first<{ id: string }>();
    if (successor) {
      return { ok: false, reason: "duplicate", readingId: successor.id };
    }
    const stillInvalidated = await env.DB.prepare(
      `SELECT 1 AS present FROM daily_readings
       WHERE id = ? AND user_id = ? AND status = 'invalidated'`,
    )
      .bind(invalidatedReadingId, identity.userId)
      .first<{ present: number }>();
    if (!stillInvalidated) return { ok: false, reason: "stale_predecessor" };
    return {
      ok: false,
      reason: "conflict",
      detail: err instanceof Error ? err.message : "fact repair reservation failed",
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
 * Prove that one maxed-out failed reservation is carrying the retired OpenAI
 * transport pin before granting its single migration replacement.
 *
 * The provider pin stays inside the encrypted command, so neither the public
 * route nor a clear D1 column may make this decision. The joins prove current
 * ownership and active-job identity before decryption; the command fields then
 * prove that the encrypted payload agrees with the reservation.
 */
export async function loadPublisherMigrationSourceCommand(
  env: Env,
  identity: UserIdentity,
  readingId: string,
  expectedFailedJobId: string,
): Promise<GenerateDailyReadingCommandV2 | null> {
  const row = await env.DB.prepare(
    `SELECT j.payload_enc, j.payload_key_version, j.payload_nonce
     FROM daily_readings r
     JOIN jobs j ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
     JOIN users u ON u.id = r.user_id AND u.status = 'active'
     WHERE r.id = ? AND r.user_id = ? AND r.status = 'failed'
       AND r.assembly_mode = 'constrained_model'
       AND r.command_generation = ? AND r.active_generation_job_id = ?
       AND j.job_type = ? AND j.status = 'failed'
       AND j.result_class IN ('publisher_unavailable', 'publisher_superseded')
       AND u.crypto_subject = ?`,
  )
    .bind(
      readingId,
      identity.userId,
      MAX_COMMAND_GENERATION,
      expectedFailedJobId,
      JOB_TYPE,
      identity.cryptoSubject,
    )
    .first<{
      payload_enc: ArrayBuffer | null;
      payload_key_version: number | null;
      payload_nonce: string | null;
    }>();
  if (
    !row ||
    row.payload_enc === null ||
    row.payload_key_version === null ||
    row.payload_nonce === null
  ) {
    return null;
  }

  try {
    const { dek } = await loadUserKey(env, identity);
    const command = await decryptJson<GenerateDailyReadingCommand>(
      {
        key_version: row.payload_key_version,
        nonce: row.payload_nonce,
        ciphertext: bytesToBase64(new Uint8Array(row.payload_enc)),
      },
      dek,
      {
        subject: identity.cryptoSubject,
        field: "jobs.payload_enc",
        recordId: expectedFailedJobId,
      },
    );
    if (
      !isCommandV2(command) ||
      command.reading_id !== readingId ||
      command.command_generation !== MAX_COMMAND_GENERATION ||
      command.publisher?.provider !== "openai"
    ) {
      return null;
    }
    return command;
  } catch {
    return null;
  }
}

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
  command: GenerateDailyReadingCommand,
  expectedFailedJobId: string,
  reason: GenerationReplacementReason,
): Promise<ReplaceOutcome> {
  const exceedsStandardBudget = command.command_generation > MAX_COMMAND_GENERATION;
  const publisherMigrationRecovery =
    exceedsStandardBudget &&
    command.command_generation === MAX_COMMAND_GENERATION + 1 &&
    reason === "publisher_superseded" &&
    isCommandV2(command) &&
    command.command_replacement_reason === "publisher_superseded" &&
    command.replaces_job_id === expectedFailedJobId &&
    command.publisher.provider === READING_PUBLISHER_PROVIDER &&
    env.READING_PUBLISHER?.trim() === READING_PUBLISHER_PROVIDER &&
    (await loadPublisherMigrationSourceCommand(
      env,
      identity,
      command.reading_id,
      expectedFailedJobId,
    )) !== null;
  if (exceedsStandardBudget && !publisherMigrationRecovery) {
    return {
      ok: false,
      reason: "budget_exhausted",
      detail: `command_generation ${command.command_generation} exceeds the ${MAX_COMMAND_GENERATION}-generation budget`,
    };
  }

  const now = new Date().toISOString();
  const jobId = newId("job");
  const columns = reservationColumns(command);
  const predecessorStatus =
    isCommandV2(command) && command.reservation_reason === "fact_repair"
      ? "invalidated"
      : "published";

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
      // An ordinary reissue's predecessor must still be live. A fact repair's
      // predecessor must stay invalidated through every command replacement.
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'reissue predecessor is no longer in its required state'
         WHERE ? IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = ?
         )`,
      ).bind(
        command.supersedes_reading_id,
        command.supersedes_reading_id,
        identity.userId,
        predecessorStatus,
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
             contract_id = ?, assembly_mode = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'failed'
           AND active_generation_job_id = ?`,
      ).bind(
        command.command_generation,
        jobId,
        columns.releaseVersion,
        command.reading_key,
        command.chart.fingerprint,
        command.chart.contract_id,
        columns.assemblyMode,
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
               AND predecessor.status = ?
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
        predecessorStatus,
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
  /** Read back as the union it was sealed as; the dispatcher branches on it. */
  command: GenerateDailyReadingCommand;
  /**
   * When another consumer may reclaim this lease.
   *
   * Carried on the claim because V5 execution has to decide, before it spends
   * money, whether enough of the lease remains for a 90-second provider call
   * plus a publication margin.
   */
  leaseExpiresAt: string;
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
 *
 * `attempts` counts ACTUAL Daily attempts, which is not the same as claims. A
 * row marked `publisher_pending` is one this consumer already worked: it built
 * the packet, created the provider job, and handed the lease back so an
 * external runner could take as long as it needs. Reacquiring it to look at the
 * result is not a second attempt, and counting it as one would let a slow
 * runner exhaust all four Daily retries without a single extra provider call
 * having been made.
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
         available_at = NULL,
         started_at = COALESCE(started_at, ?),
         attempts = CASE
           WHEN result_class = 'publisher_pending' THEN attempts
           ELSE attempts + 1
         END,
         dispatched_at = COALESCE(dispatched_at, ?)
     WHERE id = ? AND job_type = ?
       AND (available_at IS NULL OR available_at <= ?)
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
       AND EXISTS (
         SELECT 1 FROM users
         WHERE users.id = jobs.user_id AND users.status = 'active'
       )`,
  )
    .bind(claimToken, leaseExpiresAt, nowIso, nowIso, jobId, JOB_TYPE, nowIso, nowIso)
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
    const command = await decryptJson<GenerateDailyReadingCommand>(
      {
        key_version: row.payload_key_version,
        nonce: row.payload_nonce,
        ciphertext: bytesToBase64(new Uint8Array(row.payload_enc)),
      },
      dek,
      { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
    );

    return {
      jobId,
      claimToken,
      userId: row.user_id,
      attempts: row.attempts,
      command,
      leaseExpiresAt,
    };
  } catch (err) {
    throw new ClaimLoadError(jobId, claimToken, attempts, err);
  }
}

export interface DailyJobSnapshot {
  jobId: string;
  userId: string;
  readingId: string;
  status: GenerationJobStatus;
  resultClass: string | null;
  attempts: number;
  command: GenerateDailyReadingCommand;
}

/**
 * Read the live Daily job, its reservation, and its frozen command WITHOUT
 * claiming anything.
 *
 * This exists because provider admission has to answer "is this still the work
 * the reader is waiting for?" from outside the Queue. It takes no lease, sets
 * no claim token, and increments no attempt: an external runner asking whether
 * its job is still current must never be able to consume the Daily retry the
 * reader's reading depends on.
 *
 * The join is the ownership proof, not a convenience. The reservation must
 * still name this job as its active generation, the reader must still own both
 * rows, and the account must still be active -- a query that looked only at
 * `jobs` would happily describe work whose reading was invalidated,
 * superseded, or deleted underneath it.
 *
 * The command is decrypted under the same AAD `claimJob` uses. Nothing derived
 * from it is copied into a clear column: the consent id and the pinned context
 * are private values, and the whole point of the envelope is that they stay
 * inside it.
 */
export async function loadDailyJobSnapshot(
  env: Env,
  jobId: string,
): Promise<DailyJobSnapshot | null> {
  const row = await env.DB.prepare(
    `SELECT j.user_id, j.status, j.result_class, j.attempts,
            j.payload_enc, j.payload_key_version, j.payload_nonce,
            r.id AS reading_id, u.crypto_subject
     FROM jobs j
     JOIN users u ON u.id = j.user_id AND u.status = 'active'
     JOIN daily_readings r
       ON r.active_generation_job_id = j.id AND r.user_id = j.user_id
     WHERE j.id = ? AND j.job_type = ?
       AND j.status IN ('queued', 'running')
       AND r.status = 'pending'
       AND r.assembly_mode = 'constrained_model'
       AND r.invalidated_at IS NULL`,
  )
    .bind(jobId, JOB_TYPE)
    .first<{
      user_id: string;
      status: GenerationJobStatus;
      result_class: string | null;
      attempts: number;
      payload_enc: ArrayBuffer | null;
      payload_key_version: number | null;
      payload_nonce: string | null;
      reading_id: string;
      crypto_subject: string;
    }>();
  if (
    !row ||
    row.payload_enc === null ||
    row.payload_key_version === null ||
    row.payload_nonce === null
  ) {
    return null;
  }

  const identity: UserIdentity = {
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
  };
  let command: GenerateDailyReadingCommand;
  try {
    const { dek } = await loadUserKey(env, identity);
    command = await decryptJson<GenerateDailyReadingCommand>(
      {
        key_version: row.payload_key_version,
        nonce: row.payload_nonce,
        ciphertext: bytesToBase64(new Uint8Array(row.payload_enc)),
      },
      dek,
      {
        subject: identity.cryptoSubject,
        field: "jobs.payload_enc",
        recordId: jobId,
      },
    );
  } catch {
    // An unreadable command is not an error to propagate to a provider caller:
    // it is simply not a current owner, and the ordinary Queue path already
    // has a failure class for it.
    return null;
  }

  return {
    jobId,
    userId: row.user_id,
    readingId: row.reading_id,
    status: row.status,
    resultClass: row.result_class,
    attempts: row.attempts,
    command,
  };
}

/**
 * Return an owned running claim to the same immutable command after a delay.
 *
 * Clears a `publisher_pending` marker on the way out. This IS a real retry — a
 * provider result was observed and rejected, or the packet could not be built —
 * so the next claim must count as an attempt. Leaving the marker set would
 * freeze `attempts` and let the same failure retry forever inside a bound that
 * never advances.
 */
export async function releaseClaimForRetry(
  env: Env,
  jobId: string,
  claimToken: string,
  retryAt: Date,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
         available_at = ?, dispatched_at = NULL,
         result_class = CASE
           WHEN result_class = 'publisher_pending' THEN NULL
           ELSE result_class
         END
     WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
  )
    .bind(retryAt.toISOString(), jobId, JOB_TYPE, claimToken)
    .run();
  return result.meta.changes === 1;
}

/**
 * Hand the Daily lease back while an external Codex job is still being worked.
 *
 * The distinction from `releaseClaimForRetry` is the whole point of the durable
 * wait, and it shows up in three columns:
 *
 *  - `result_class = 'publisher_pending'` tells the next claim not to spend an
 *    attempt, because no new provider call will be made;
 *  - `available_at = NULL` means the row is immediately claimable, since the
 *    thing being waited on is a nudge rather than a delay; and
 *  - `dispatched_at` is deliberately left SET. The outbox sweep finds only
 *    undispatched rows, so leaving the marker is what stops it re-offering this
 *    job every cycle for the entire life of a fifteen-minute provider call. The
 *    terminal nudge clears it exactly once, when there is something to see.
 *
 * Claim-fenced like every other transition: a consumer whose lease was already
 * reclaimed cannot park a job somebody else now owns.
 */
export async function releaseClaimForPublisherPending(
  env: Env,
  jobId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'queued', result_class = 'publisher_pending',
         claim_token = NULL, lease_expires_at = NULL, available_at = NULL
     WHERE id = ? AND job_type = ? AND status = 'running' AND claim_token = ?`,
  )
    .bind(jobId, JOB_TYPE, claimToken)
    .run();
  return result.meta.changes === 1;
}

export type RolloutPauseOutcome = "paused" | "already_paused" | "not_v2";

/**
 * Durably pause one opaque Queue nudge while the V5 kill switch is off.
 *
 * The decision uses only clear trusted-plane columns. No user key or encrypted
 * command is loaded, and the guarded update leaves attempts untouched.
 *
 * The state set MUST match what `claimJob` is willing to reclaim, which is
 * `queued` OR `running` with an expired lease. Pausing only `queued` left the
 * second case answering `not_v2`, so `queue.ts` did not acknowledge, the
 * delivery fell through to the claim, and the executor — which never reads the
 * rollout itself — decrypted the command, spent a provider budget unit, and
 * called OpenAI after the switch was pulled. That state is produced
 * deliberately: the 305-second retry runs against a 300-second lease so a
 * crashed execution can be recovered, and the internal sweep re-offers exactly
 * these rows. A stale claim is cleared on the way back to `queued` so the next
 * delivery cannot reclaim it and the owner resume can still find it.
 */
export async function pauseQueuedV2ForRolloutOff(
  env: Env,
  jobId: string,
  now = new Date(),
): Promise<RolloutPauseOutcome> {
  const nowIso = now.toISOString();
  const availableAt = new Date(now.getTime() + LEASE_RETRY_DELAY_SECONDS * 1000).toISOString();
  const paused = await env.DB.prepare(
    `UPDATE jobs
     SET available_at = ?, dispatched_at = NULL, result_class = 'rollout_paused',
         status = 'queued', claim_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND job_type = ?
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
       AND result_class IS NOT 'rollout_paused'
       AND EXISTS (
         SELECT 1 FROM daily_readings r
         WHERE r.active_generation_job_id = jobs.id
           AND r.user_id = jobs.user_id AND r.status = 'pending'
           AND r.assembly_mode = 'constrained_model'
       )
     RETURNING id`,
  )
    .bind(availableAt, jobId, JOB_TYPE, nowIso)
    .first<{ id: string }>();
  if (paused) return "paused";

  const existing = await env.DB.prepare(
    `SELECT 1 AS present
     FROM jobs j JOIN daily_readings r
       ON r.active_generation_job_id = j.id AND r.user_id = j.user_id
     WHERE j.id = ? AND j.job_type = ?
       AND j.status = 'queued' AND j.result_class = 'rollout_paused'
       AND r.status = 'pending' AND r.assembly_mode = 'constrained_model'`,
  )
    .bind(jobId, JOB_TYPE)
    .first<{ present: number }>();
  return existing ? "already_paused" : "not_v2";
}

/**
 * Bounded scheduler resume for rows the kill switch parked.
 *
 * The owner-scoped resume above only runs when that reader opens the app, and
 * the outbox sweep deliberately skips paused rows, so without this a reservation
 * made before the switch was pulled would sit paused forever for anyone who does
 * not come back — holding the one pending row that blocks a new reservation for
 * that user and day. This is the plan's third named recovery route.
 *
 * Safe to call unconditionally from the scheduler because the scheduler itself
 * only runs under `hybrid`: reaching it means the switch has already left `off`.
 * Clearing `result_class` returns the row to the ordinary undispatched lane
 * rather than dispatching it here, so one bounded query does the whole job.
 */
export async function resumePausedV2AfterRollout(
  env: Env,
  limit: number,
  now = new Date(),
): Promise<number> {
  if (limit <= 0) return 0;
  const { results } = await env.DB.prepare(
    `UPDATE jobs
     SET available_at = ?, result_class = NULL
     WHERE id IN (
       SELECT j.id FROM jobs j
       JOIN users u ON u.id = j.user_id AND u.status = 'active'
       JOIN daily_readings r ON r.active_generation_job_id = j.id
         AND r.user_id = j.user_id AND r.status = 'pending'
         AND r.assembly_mode = 'constrained_model'
       WHERE j.job_type = ? AND j.status = 'queued'
         AND j.result_class = 'rollout_paused'
       ORDER BY j.created_at, j.id
       LIMIT ?
     )
     RETURNING id`,
  )
    .bind(now.toISOString(), JOB_TYPE, limit)
    .all<{ id: string }>();
  return results.length;
}

/**
 * Owner-scoped first-open resume for an already-reserved V5 day.
 *
 * Only a row explicitly marked by the rollout pause is advanced; an ordinary
 * provider retry or dispatch failure retains its own schedule.
 */
export async function resumePausedV2ForFirstOpen(
  env: Env,
  userId: string,
  localDate: string,
  now = new Date(),
): Promise<{ jobId: string; readingId: string } | null> {
  const row = await env.DB.prepare(
    `SELECT j.id AS job_id, r.id AS reading_id
     FROM daily_readings r JOIN jobs j
       ON j.id = r.active_generation_job_id AND j.user_id = r.user_id
     WHERE r.user_id = ? AND r.local_date = ? AND r.status = 'pending'
       AND r.assembly_mode = 'constrained_model'
       AND j.status = 'queued' AND j.result_class = 'rollout_paused'
     LIMIT 1`,
  )
    .bind(userId, localDate)
    .first<{ job_id: string; reading_id: string }>();
  if (!row) return null;

  const advanced = await env.DB.prepare(
    `UPDATE jobs
     SET available_at = ?, dispatched_at = NULL, result_class = NULL
     WHERE id = ? AND user_id = ? AND status = 'queued'
       AND result_class = 'rollout_paused'`,
  )
    .bind(now.toISOString(), row.job_id, userId)
    .run();
  return advanced.meta.changes === 1
    ? { jobId: row.job_id, readingId: row.reading_id }
    : null;
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

/**
 * What publication must do to the predecessor it replaces.
 *
 * The two non-empty cases are genuinely different rules, not two spellings of
 * one. An ORDINARY reissue — a safety correction, a defect repair — leaves the
 * predecessor `published` until the successor commits, so a failed successor
 * leaves the reader with the reading they already had. A FACT repair follows an
 * invalidation that already happened: the predecessor stopped being live the
 * moment its inputs were found to be wrong, and completion must leave it
 * `invalidated` rather than quietly marking it superseded as though it had been
 * a valid edition.
 */
export type PredecessorTransition =
  | { kind: "none" }
  | { kind: "supersede_published"; readingId: string }
  | { kind: "retain_invalidated"; readingId: string };

export interface PublicationInput {
  identity: UserIdentity;
  readingId: string;
  jobId: string;
  claimToken: string;
  commandGeneration: number;
  predecessor: PredecessorTransition;
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
         JOIN users u ON u.id = r.user_id
         WHERE r.id = ? AND r.user_id = ? AND r.status = 'pending'
           AND r.command_generation = ?
           AND j.id = ? AND j.status = 'running' AND j.claim_token = ?
           AND u.status = 'active'
       )`,
    ).bind(readingId, identity.userId, input.commandGeneration, jobId, claimToken),
  ];

  const predecessor = input.predecessor;
  if (predecessor.kind === "supersede_published") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'expected predecessor is not published'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = 'published'
         )`,
      ).bind(predecessor.readingId, identity.userId),
      env.DB.prepare(
        `UPDATE daily_readings SET status = 'superseded', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'published'`,
      ).bind(now, predecessor.readingId, identity.userId),
    );
  } else if (predecessor.kind === "retain_invalidated") {
    // Assert and change nothing. The predecessor was invalidated before this
    // successor was reserved, and a successor that quietly re-published or
    // superseded it would be claiming the invalid edition had been fine.
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'expected predecessor is not invalidated'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ? AND status = 'invalidated'
         )`,
      ).bind(predecessor.readingId, identity.userId),
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

  if (predecessor.kind === "supersede_published") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'predecessor was not superseded'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings WHERE id = ? AND status = 'superseded'
         )`,
      ).bind(predecessor.readingId),
    );
  } else if (predecessor.kind === "retain_invalidated") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'predecessor did not stay invalidated'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings WHERE id = ? AND status = 'invalidated'
         )`,
      ).bind(predecessor.readingId),
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
    `UPDATE jobs SET dispatched_at = ?
     WHERE id = ? AND status = 'queued' AND dispatched_at IS NULL
       AND result_class IS NOT 'rollout_paused'`,
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
 *
 * A row parked by the rollout kill switch is excluded. It satisfies every other
 * predicate here permanently — the pause clears `dispatched_at` once and its own
 * `IS NOT 'rollout_paused'` guard stops `available_at` ever advancing again — so
 * including it would let paused rows occupy this whole `LIMIT` window and starve
 * the genuinely undispatched jobs the sweep exists for. The scheduler's twin
 * already excludes them; resuming one is the owner sweep's job, or
 * `resumePausedV2AfterRollout`'s once the switch leaves `off`.
 */
export async function findUndispatched(
  env: Env,
  limit = 50,
  now = new Date(),
): Promise<SweepCandidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT j.id, r.id AS reading_id
     FROM jobs j
     LEFT JOIN daily_readings r ON r.active_generation_job_id = j.id
     WHERE j.job_type = ? AND j.status = 'queued' AND j.dispatched_at IS NULL
       AND j.result_class IS NOT 'rollout_paused'
       AND (j.available_at IS NULL OR j.available_at <= ?)
     ORDER BY j.created_at, j.id
     LIMIT ?`,
  )
    .bind(JOB_TYPE, now.toISOString(), limit)
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
     ORDER BY j.lease_expires_at, j.id
     LIMIT ?`,
  )
    .bind(JOB_TYPE, now.toISOString(), limit)
    .all<SweepCandidate>();
  return results;
}
