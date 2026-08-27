import { contentHash } from "@patternlike/shared";
import type { Env } from "../env.js";

const UTC_DAY_MS = 86_400_000;
const RETAINED_UTC_DAYS = 35;

export interface PreparedBirthCalcAttempt {
  reservationHash: string;
  claimTokenHash: string;
  utcDate: string;
  statements: D1PreparedStatement[];
}

export interface BirthCalcAttempt {
  status: "charged" | "denied";
  winner: boolean;
  resetsAt: string;
  retryAfterSeconds: number;
}

function utcDay(now: Date): {
  utcDate: string;
  cutoffDate: string;
  resetsAt: string;
  retryAfterSeconds: number;
} {
  const instant = now.getTime();
  if (!Number.isFinite(instant)) {
    throw new Error("birth calculation budget requires a valid instant");
  }
  const startToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const resetsAt = new Date(startToday + UTC_DAY_MS).toISOString();
  return {
    utcDate: new Date(startToday).toISOString().slice(0, 10),
    cutoffDate: new Date(
      startToday - (RETAINED_UTC_DAYS - 1) * UTC_DAY_MS,
    ).toISOString().slice(0, 10),
    resetsAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((Date.parse(resetsAt) - instant) / 1000),
    ),
  };
}

export async function allocateBirthProfileVersion(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<number> {
  const updatedAt = now.toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO birth_profile_version_counters (
       user_id, last_allocated_version, updated_at
     ) VALUES (
       ?1,
       COALESCE((
         SELECT MAX(version) FROM birth_profiles WHERE user_id = ?1
       ), 0) + 1,
       ?2
     )
     ON CONFLICT(user_id) DO UPDATE SET
       last_allocated_version = MAX(
         birth_profile_version_counters.last_allocated_version,
         COALESCE((
           SELECT MAX(version) FROM birth_profiles WHERE user_id = ?1
         ), 0)
       ) + 1,
       updated_at = excluded.updated_at
     RETURNING last_allocated_version`,
  ).bind(userId, updatedAt).first<{ last_allocated_version: number }>();
  if (!row || !Number.isInteger(row.last_allocated_version)) {
    throw new Error("birth profile version allocation failed");
  }
  return row.last_allocated_version;
}

export async function prepareBirthCalcAttempt(
  env: Env,
  userId: string,
  idempotencyKey: string,
  attempt: number,
  claimToken: string,
  limit: number,
  now = new Date(),
): Promise<PreparedBirthCalcAttempt> {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error("birth calculation attempt must be a non-negative integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("birth calculation daily limit must be an integer from 1 through 50");
  }
  const { utcDate, cutoffDate } = utcDay(now);
  const createdAt = now.toISOString();
  const reservationHash = await contentHash(
    `patternlike.birth-calc-reservation.v1|${utcDate}|${attempt}|${idempotencyKey}`,
  );
  const claimTokenHash = await contentHash(
    `patternlike.birth-calc-claim.v1|${claimToken}`,
  );

  return {
    reservationHash,
    claimTokenHash,
    utcDate,
    statements: [
      env.DB.prepare(
        `INSERT OR IGNORE INTO birth_calc_reservations (
           user_id, reservation_hash, utc_date, claim_token_hash, status,
           created_at, charged_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, NULL)`,
      ).bind(userId, reservationHash, utcDate, claimTokenHash, createdAt),
      env.DB.prepare(
        `INSERT INTO birth_calc_daily_usage (
           user_id, utc_date, reserved_calc_count, last_reservation_hash,
           created_at, updated_at
         )
         SELECT ?1, ?2, 1, ?3, ?4, ?4
         WHERE EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ?1 AND reservation_hash = ?3
             AND claim_token_hash = ?5 AND status = 'pending'
         )
         ON CONFLICT(user_id, utc_date) DO UPDATE SET
           reserved_calc_count =
             birth_calc_daily_usage.reserved_calc_count + 1,
           last_reservation_hash = excluded.last_reservation_hash,
           updated_at = excluded.updated_at
         WHERE birth_calc_daily_usage.reserved_calc_count + 1 <= ?6
           AND EXISTS (
             SELECT 1 FROM birth_calc_reservations
             WHERE user_id = ?1 AND reservation_hash = ?3
               AND claim_token_hash = ?5 AND status = 'pending'
           )`,
      ).bind(
        userId,
        utcDate,
        reservationHash,
        createdAt,
        claimTokenHash,
        limit,
      ),
      env.DB.prepare(
        `UPDATE birth_calc_reservations
         SET status = 'charged', charged_at = ?4
         WHERE user_id = ?1 AND reservation_hash = ?2
           AND claim_token_hash = ?3 AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM birth_calc_daily_usage
             WHERE user_id = ?1 AND utc_date = ?5
               AND last_reservation_hash = ?2
           )`,
      ).bind(
        userId,
        reservationHash,
        claimTokenHash,
        createdAt,
        utcDate,
      ),
      env.DB.prepare(
        `UPDATE birth_calc_reservations
         SET status = 'denied'
         WHERE user_id = ?1 AND reservation_hash = ?2
           AND claim_token_hash = ?3 AND status = 'pending'`,
      ).bind(userId, reservationHash, claimTokenHash),
      env.DB.prepare(
        `DELETE FROM birth_calc_reservations
         WHERE user_id = ? AND utc_date < ?`,
      ).bind(userId, cutoffDate),
      env.DB.prepare(
        `DELETE FROM birth_calc_daily_usage
         WHERE user_id = ? AND utc_date < ?`,
      ).bind(userId, cutoffDate),
    ],
  };
}

export async function readBirthCalcAttempt(
  env: Env,
  userId: string,
  reservationHash: string,
  claimTokenHash: string,
  now = new Date(),
): Promise<BirthCalcAttempt | null> {
  const row = await env.DB.prepare(
    `SELECT status, claim_token_hash
     FROM birth_calc_reservations
     WHERE user_id = ? AND reservation_hash = ?`,
  ).bind(userId, reservationHash).first<{
    status: "pending" | "charged" | "denied";
    claim_token_hash: string;
  }>();
  if (!row) return null;
  if (row.status === "pending") {
    throw new Error("birth calculation reservation remained pending after commit");
  }
  const { resetsAt, retryAfterSeconds } = utcDay(now);
  return {
    status: row.status,
    winner: row.claim_token_hash === claimTokenHash,
    resetsAt,
    retryAfterSeconds,
  };
}
