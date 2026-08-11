import { newId } from "@patternlike/shared";

import type { Env } from "../env.js";
import {
  DEFAULT_READING_SCHEDULE_POLICY,
  nextReadingCursor,
  selectReadingScheduleTarget,
} from "../services/reading-schedule.js";
import { nextLocalDate, previousLocalDate } from "../services/local-day.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "./consents.js";

export const INVALIDATED_ORPHAN_BACKOFF_VERSION = "invalidated-orphan-backoff-v1";
export const INVALIDATED_ORPHAN_BACKOFF_MS = 6 * 60 * 60 * 1000;

export interface SchedulerCandidate {
  userId: string;
}

export interface FailedSchedulerCandidate extends SchedulerCandidate {
  readingId: string;
  resultClass: string;
  assemblyMode: "deterministic" | "constrained_model";
}

export interface FactualSchedulerCandidate extends SchedulerCandidate {
  readingId: string;
  localDate: string;
}

export interface RecoverySchedulerCandidate extends SchedulerCandidate {
  jobId: string;
  readingId: string;
}

export interface DueSchedulerCandidate extends SchedulerCandidate {
  timezone: string;
  nextDueAt: string;
}

export interface NullCursorCandidate extends SchedulerCandidate {
  timezone: string;
}

export interface SchedulerEligibility {
  eligible: boolean;
  timezone: string;
  hasActiveChart: boolean;
  preferencesConfirmed: boolean;
  hasAiConsent: boolean;
  hasRecentSession: boolean;
}

function excludedSql(excludedCount: number, column = "u.id"): string {
  return excludedCount > 0
    ? ` AND ${column} NOT IN (${Array.from({ length: excludedCount }, () => "?").join(", ")})`
    : "";
}

function excludedValues(excluded: ReadonlySet<string>): string[] {
  return [...excluded].sort();
}

function utcLocalDate(scheduledAt: Date): string {
  return scheduledAt.toISOString().slice(0, 10);
}

function factualDateBounds(scheduledAt: Date): readonly [string, string] {
  const utcDate = utcLocalDate(scheduledAt);
  return [previousLocalDate(utcDate), nextLocalDate(utcDate)];
}

function failureDateBounds(scheduledAt: Date): readonly [string, string] {
  const [factualStart, factualEnd] = factualDateBounds(scheduledAt);
  return [previousLocalDate(factualStart), nextLocalDate(factualEnd)];
}

export function invalidatedOrphanDiscoverySql(excludedCount: number): string {
  return `WITH ranked AS (
            SELECT r.id AS reading_id, r.user_id, r.local_date, r.updated_at,
                   ROW_NUMBER() OVER (
                     PARTITION BY r.user_id ORDER BY r.updated_at, r.id
                   ) AS user_rank
            FROM daily_readings r INDEXED BY idx_daily_readings_invalidated_repair
            JOIN users u ON u.id = r.user_id AND u.status = 'active'
            WHERE r.status = 'invalidated' AND r.updated_at <= ?
              AND r.assembly_mode = 'constrained_model'
              AND r.local_date BETWEEN ? AND ?
              AND NOT EXISTS (
                SELECT 1 FROM daily_readings successor
                WHERE successor.supersedes_reading_id = r.id
                  AND successor.user_id = r.user_id
              )${excludedSql(excludedCount, "r.user_id")}
          )
          SELECT reading_id, user_id, local_date
          FROM ranked
          WHERE user_rank = 1
          ORDER BY updated_at, reading_id
          LIMIT ?`;
}

export async function findFailedSchedulerCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<FailedSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const [earliestLocalDate, latestLocalDate] = failureDateBounds(scheduledAt);
  const sql = `WITH ranked AS (
                 SELECT r.id AS reading_id, r.user_id, r.assembly_mode,
                        j.result_class, r.updated_at,
                        ROW_NUMBER() OVER (
                          PARTITION BY r.user_id ORDER BY r.updated_at, r.id
                        ) AS user_rank
                 FROM daily_readings r INDEXED BY idx_daily_readings_failed_generation
                 JOIN users u ON u.id = r.user_id AND u.status = 'active'
                 JOIN jobs j ON j.id = r.active_generation_job_id
                   AND j.user_id = r.user_id AND j.status = 'failed'
                 WHERE r.status = 'failed' AND r.command_generation < 3
                   AND r.local_date BETWEEN ? AND ?
                   AND j.result_class IS NOT NULL
                   ${excludedSql(excludedIds.length, "r.user_id")}
               )
               SELECT reading_id, user_id, assembly_mode, result_class
               FROM ranked
               WHERE user_rank = 1
               ORDER BY updated_at, user_id, reading_id
               LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(earliestLocalDate, latestLocalDate, ...excludedIds, limit)
    .all<{
      reading_id: string;
      user_id: string;
      assembly_mode: "deterministic" | "constrained_model";
      result_class: string;
    }>();
  const seen = new Set<string>();
  return result.results.flatMap((row) => {
    if (seen.has(row.user_id)) return [];
    seen.add(row.user_id);
    return [{
      readingId: row.reading_id,
      userId: row.user_id,
      assemblyMode: row.assembly_mode,
      resultClass: row.result_class,
    }];
  });
}

export async function findStalePublishedCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<FactualSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const [earliestLocalDate, latestLocalDate] = factualDateBounds(scheduledAt);
  const sql = `WITH ranked AS (
                 SELECT r.id AS reading_id, r.user_id, r.local_date, r.updated_at,
                        ROW_NUMBER() OVER (
                          PARTITION BY r.user_id ORDER BY r.updated_at, r.id
                        ) AS user_rank
                 FROM daily_readings r
                 JOIN users u ON u.id = r.user_id AND u.status = 'active'
                 WHERE r.status = 'published' AND r.assembly_mode = 'constrained_model'
                   AND r.local_date BETWEEN ? AND ?
                   AND NOT EXISTS (
                     SELECT 1 FROM chart_snapshots c
                     WHERE c.user_id = r.user_id AND c.status = 'active'
                       AND c.fingerprint = r.chart_fingerprint
                       AND c.contract_id = r.contract_id
                   )${excludedSql(excludedIds.length, "r.user_id")}
               )
               SELECT reading_id, user_id, local_date
               FROM ranked
               WHERE user_rank = 1
               ORDER BY updated_at, reading_id
               LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(earliestLocalDate, latestLocalDate, ...excludedIds, limit)
    .all<{ reading_id: string; user_id: string; local_date: string }>();
  return result.results.map((row) => ({
    readingId: row.reading_id,
    userId: row.user_id,
    localDate: row.local_date,
  }));
}

export async function findInvalidatedOrphanCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<FactualSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const cutoff = new Date(
    scheduledAt.getTime() - INVALIDATED_ORPHAN_BACKOFF_MS,
  ).toISOString();
  const [earliestLocalDate, latestLocalDate] = factualDateBounds(scheduledAt);
  const result = await env.DB.prepare(invalidatedOrphanDiscoverySql(excludedIds.length))
    .bind(cutoff, earliestLocalDate, latestLocalDate, ...excludedIds, limit)
    .all<{ reading_id: string; user_id: string; local_date: string }>();
  const seen = new Set<string>();
  return result.results.flatMap((row) => {
    if (seen.has(row.user_id)) return [];
    seen.add(row.user_id);
    return [{
      readingId: row.reading_id,
      userId: row.user_id,
      localDate: row.local_date,
    }];
  });
}

export async function findExpiredSchedulerCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<RecoverySchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const result = await env.DB.prepare(
    `WITH ranked AS (
       SELECT j.id AS job_id, r.id AS reading_id, j.user_id, j.lease_expires_at,
              ROW_NUMBER() OVER (
                PARTITION BY j.user_id ORDER BY j.lease_expires_at, j.id
              ) AS user_rank
       FROM jobs j INDEXED BY idx_jobs_running_lease
       JOIN users u ON u.id = j.user_id AND u.status = 'active'
       JOIN daily_readings r ON r.active_generation_job_id = j.id
         AND r.user_id = j.user_id AND r.status = 'pending'
       WHERE j.job_type = 'generate_daily_reading' AND j.status = 'running'
         AND j.lease_expires_at < ?${excludedSql(excludedIds.length, "j.user_id")}
     )
     SELECT job_id, reading_id, user_id
     FROM ranked
     WHERE user_rank = 1
     ORDER BY lease_expires_at, job_id
     LIMIT ?`,
  )
    .bind(scheduledAt.toISOString(), ...excludedIds, limit)
    .all<{ job_id: string; reading_id: string; user_id: string }>();
  return result.results.map((row) => ({
    jobId: row.job_id,
    readingId: row.reading_id,
    userId: row.user_id,
  }));
}

export async function findUndispatchedSchedulerCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<RecoverySchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const result = await env.DB.prepare(
    `WITH ranked AS (
       SELECT j.id AS job_id, r.id AS reading_id, j.user_id, j.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY j.user_id ORDER BY j.created_at, j.id
              ) AS user_rank
       FROM jobs j INDEXED BY idx_jobs_undispatched
       JOIN users u ON u.id = j.user_id AND u.status = 'active'
       JOIN daily_readings r ON r.active_generation_job_id = j.id
         AND r.user_id = j.user_id AND r.status = 'pending'
       WHERE j.job_type = 'generate_daily_reading' AND j.status = 'queued'
         AND j.dispatched_at IS NULL
         AND j.result_class IS NOT 'rollout_paused'
         AND (j.available_at IS NULL OR j.available_at <= ?)
         ${excludedSql(excludedIds.length, "j.user_id")}
     )
     SELECT job_id, reading_id, user_id
     FROM ranked
     WHERE user_rank = 1
     ORDER BY created_at, job_id
     LIMIT ?`,
  )
    .bind(scheduledAt.toISOString(), ...excludedIds, limit)
    .all<{ job_id: string; reading_id: string; user_id: string }>();
  return result.results.map((row) => ({
    jobId: row.job_id,
    readingId: row.reading_id,
    userId: row.user_id,
  }));
}

export async function findDueSchedulerCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<DueSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const result = await env.DB.prepare(
    `SELECT u.id, u.timezone, u.next_due_at
     FROM users u INDEXED BY idx_users_next_due_at
     WHERE u.status = 'active' AND u.next_due_at IS NOT NULL
       AND u.next_due_at <= ?${excludedSql(excludedIds.length)}
     ORDER BY u.next_due_at, u.id
     LIMIT ?`,
  )
    .bind(scheduledAt.toISOString(), ...excludedIds, limit)
    .all<{ id: string; timezone: string; next_due_at: string }>();
  return result.results.map((row) => ({
    userId: row.id,
    timezone: row.timezone,
    nextDueAt: row.next_due_at,
  }));
}

export async function findNullCursorCandidates(
  env: Env,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<NullCursorCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded);
  const result = await env.DB.prepare(
    `SELECT u.id, u.timezone
     FROM users u INDEXED BY idx_users_unseeded_due
     WHERE u.status = 'active' AND u.next_due_at IS NULL
       ${excludedSql(excludedIds.length)}
     ORDER BY u.created_at, u.id
     LIMIT ?`,
  )
    .bind(...excludedIds, limit)
    .all<{ id: string; timezone: string }>();
  return result.results.map((row) => ({ userId: row.id, timezone: row.timezone }));
}

export async function loadSchedulerEligibility(
  env: Env,
  userId: string,
  scheduledAt: Date,
  activeDays: number,
  requireAiConsent = true,
): Promise<SchedulerEligibility | null> {
  const activeSince = new Date(
    scheduledAt.getTime() - activeDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const row = await env.DB.prepare(
    `SELECT u.timezone,
            EXISTS (
              SELECT 1 FROM chart_snapshots c
              WHERE c.user_id = u.id AND c.status = 'active'
            ) AS has_active_chart,
            (u.timezone_source IN ('device_derived', 'user_confirmed')
             AND u.locale_source IN ('device_derived', 'user_confirmed'))
              AS preferences_confirmed,
            EXISTS (
              SELECT 1 FROM consents c
              WHERE c.user_id = u.id AND c.kind = 'ai_synthesis'
                AND c.status = 'granted' AND c.policy_version = ?
                AND (c.expires_at IS NULL OR c.expires_at > ?)
            ) AS has_ai_consent,
            EXISTS (
              SELECT 1 FROM sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL
                AND s.expires_at > ?
                AND COALESCE(s.last_seen_at, s.created_at) >= ?
            ) AS has_recent_session
     FROM users u
     WHERE u.id = ? AND u.status = 'active'`,
  )
    .bind(
      AI_SYNTHESIS_POLICY_VERSION,
      scheduledAt.toISOString(),
      scheduledAt.toISOString(),
      activeSince,
      userId,
    )
    .first<{
      timezone: string;
      has_active_chart: number;
      preferences_confirmed: number;
      has_ai_consent: number;
      has_recent_session: number;
    }>();
  if (!row) return null;
  const hasActiveChart = row.has_active_chart === 1;
  const preferencesConfirmed = row.preferences_confirmed === 1;
  const hasAiConsent = row.has_ai_consent === 1;
  const hasRecentSession = row.has_recent_session === 1;
  return {
    eligible:
      hasActiveChart &&
      preferencesConfirmed &&
      hasRecentSession &&
      (!requireAiConsent || hasAiConsent),
    timezone: row.timezone,
    hasActiveChart,
    preferencesConfirmed,
    hasAiConsent,
    hasRecentSession,
  };
}

async function recordSkippedDates(
  env: Env,
  userId: string,
  skippedLocalDates: readonly string[],
  at: Date,
): Promise<void> {
  if (skippedLocalDates.length === 0) return;
  await env.DB.batch(
    skippedLocalDates.map((localDate) =>
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id,
            result, detail_class, created_at)
         VALUES (?, 'system', ?, 'daily_reading.schedule_skipped', 'user', ?,
                 'success', 'skipped_local_date', ?)`,
      ).bind(newId("aud"), userId, localDate, at.toISOString()),
    ),
  );
}

export async function recomputeUserNextDueAt(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT timezone FROM users WHERE id = ? AND status = 'active'",
  )
    .bind(userId)
    .first<{ timezone: string }>();
  if (!row) return null;
  const selected = await selectReadingScheduleTarget(
    userId,
    row.timezone,
    now,
    DEFAULT_READING_SCHEDULE_POLICY,
  );
  await env.DB.prepare(
    `UPDATE users SET next_due_at = ? WHERE id = ? AND status = 'active'`,
  )
    .bind(selected.dueAt, userId)
    .run();
  await recordSkippedDates(env, userId, selected.skippedLocalDates, now);
  return selected.dueAt;
}

export async function seedUserNextDueAt(
  env: Env,
  userId: string,
  timezone: string,
  scheduledAt: Date,
): Promise<boolean> {
  const selected = await selectReadingScheduleTarget(
    userId,
    timezone,
    scheduledAt,
    DEFAULT_READING_SCHEDULE_POLICY,
  );
  const result = await env.DB.prepare(
    `UPDATE users SET next_due_at = ?
     WHERE id = ? AND status = 'active' AND next_due_at IS NULL`,
  )
    .bind(selected.dueAt, userId)
    .run();
  if (result.meta.changes === 1) {
    await recordSkippedDates(env, userId, selected.skippedLocalDates, scheduledAt);
    return true;
  }
  return false;
}

export async function advanceUserNextDueAt(
  env: Env,
  input: {
    userId: string;
    timezone: string;
    evaluatedLocalDate: string;
    expectedDueAt: string;
    scheduledAt: Date;
  },
): Promise<boolean> {
  const cursor = await nextReadingCursor(
    input.userId,
    input.evaluatedLocalDate,
    input.timezone,
    DEFAULT_READING_SCHEDULE_POLICY,
  );
  const result = await env.DB.prepare(
    `UPDATE users SET next_due_at = ?
     WHERE id = ? AND status = 'active' AND next_due_at = ?`,
  )
    .bind(cursor.dueAt, input.userId, input.expectedDueAt)
    .run();
  if (result.meta.changes === 1) {
    await recordSkippedDates(
      env,
      input.userId,
      cursor.skippedLocalDates,
      input.scheduledAt,
    );
    return true;
  }
  return false;
}

export async function backoffIneligibleInvalidatedOrphan(
  env: Env,
  readingId: string,
  userId: string,
  scheduledAt: Date,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE daily_readings SET updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'invalidated'
       AND NOT EXISTS (
         SELECT 1 FROM daily_readings successor
         WHERE successor.supersedes_reading_id = daily_readings.id
       )`,
  )
    .bind(scheduledAt.toISOString(), readingId, userId)
    .run();
  return result.meta.changes === 1;
}
