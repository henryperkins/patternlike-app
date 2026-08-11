import { newId } from "@patternlike/shared";

import type { Env } from "../env.js";
import {
  DEFAULT_READING_SCHEDULE_POLICY,
  nextReadingCursor,
  selectReadingScheduleTarget,
} from "../services/reading-schedule.js";
import { nextLocalDate, previousLocalDate } from "../services/local-day.js";
import {
  V1_AUTOMATIC_REPLACEMENT_FAILURE_CODES,
  V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES,
} from "../services/generation-failures.js";
import { pinnedLocalDateIndexJson } from "../services/tzdb.js";
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

interface FactualSchedulerRow {
  reading_id: string;
  user_id: string;
  local_date: string;
}

/**
 * D1 binds at most 100 parameters per statement.
 *
 * The scheduler's own batch limit is 100 and each lane runs while the quota is
 * unspent, so the already-seen set reaches 99 while a lane is still executing.
 * Add a lane's own fixed parameters and the LIMIT and the statement crosses the
 * ceiling, which D1 rejects — out of the uncaught scheduled(), taking the due
 * and null-seed lanes with it. The local miniflare D1 the test pool uses does
 * not enforce the limit, so no integration test can ever see this; the cap and
 * its unit test are the only places the platform bound exists in this repo.
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * The exclusion ids a lane may bind, given how many parameters it binds itself.
 *
 * Truncating the list is safe: it is a de-duplication hint, not a correctness
 * boundary. Every lane still calls `claimUser` per candidate, which refuses a
 * user another lane already took, so a user who slips past the truncated NOT IN
 * is skipped one step later instead.
 */
export function excludedBudget(fixedParameters: number): number {
  return Math.max(0, D1_MAX_BOUND_PARAMETERS - fixedParameters);
}

function excludedSql(excludedCount: number, column = "u.id"): string {
  return excludedCount > 0
    ? ` AND ${column} NOT IN (${Array.from({ length: excludedCount }, () => "?").join(", ")})`
    : "";
}

function excludedValues(excluded: ReadonlySet<string>, budget: number): string[] {
  return [...excluded].sort().slice(0, budget);
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

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

const automaticFailureSql = `(
  (r.assembly_mode = 'deterministic'
    AND j.result_class IN (${placeholders(V1_AUTOMATIC_REPLACEMENT_FAILURE_CODES)}))
  OR
  (r.assembly_mode = 'constrained_model'
    AND j.result_class IN (${placeholders(V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES)}))
)`;

const automaticFailureValues = [
  ...V1_AUTOMATIC_REPLACEMENT_FAILURE_CODES,
  ...V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES,
] as const;

interface FailedSchedulerRow {
  reading_id: string;
  user_id: string;
  assembly_mode: "deterministic" | "constrained_model";
  result_class: string;
}

function failedCandidate(row: FailedSchedulerRow): FailedSchedulerCandidate {
  return {
    readingId: row.reading_id,
    userId: row.user_id,
    assemblyMode: row.assembly_mode,
    resultClass: row.result_class,
  };
}

function factualCandidate(row: FactualSchedulerRow): FactualSchedulerCandidate {
  return {
    readingId: row.reading_id,
    userId: row.user_id,
    localDate: row.local_date,
  };
}

const exactCurrentLocalDateSql = `EXISTS (
  SELECT 1 FROM json_each(?) AS owner_dates
  WHERE owner_dates.key = u.timezone
    AND owner_dates.value = r.local_date
)`;

const exactFailureLocalDateSql = `EXISTS (
  SELECT 1 FROM json_each(?) AS owner_dates
  WHERE owner_dates.key = u.timezone
    AND (
      (r.assembly_mode = 'deterministic'
        AND r.local_date IN (owner_dates.value, date(owner_dates.value, '-1 day')))
      OR
      (r.assembly_mode = 'constrained_model'
        AND r.local_date IN (owner_dates.value, date(owner_dates.value, '+1 day')))
    )
)`;

export function invalidatedOrphanDiscoverySql(excludedCount: number): string {
  return `WITH ranked AS (
            SELECT r.id AS reading_id, r.user_id, r.local_date, r.updated_at,
                   ROW_NUMBER() OVER (
                     PARTITION BY r.user_id ORDER BY r.updated_at, r.id
                   ) AS user_rank
            FROM daily_readings r INDEXED BY idx_daily_readings_invalidated_repair
            JOIN users u ON u.id = r.user_id AND u.status = 'active'
            WHERE r.status = 'invalidated'
              -- The six-hour backoff applies only to an orphan this scheduler
              -- has ALREADY touched. invalidatePublishedReading stamps
              -- updated_at too, so filtering on it alone also hid a freshly
              -- invalidated row - exactly the crash window this lane exists to
              -- converge - until after the owner's local day had rolled and the
              -- current-day scoping excluded it for good. A row whose
              -- updated_at has not moved past its own invalidated_at has never
              -- been backed off, and is admitted at once.
              AND (r.updated_at <= ? OR r.updated_at <= r.invalidated_at)
              AND r.assembly_mode = 'constrained_model'
              AND r.local_date BETWEEN ? AND ?
              AND NOT EXISTS (
                SELECT 1 FROM daily_readings successor
                WHERE successor.supersedes_reading_id = r.id
                  AND successor.user_id = r.user_id
              )
              AND ${exactCurrentLocalDateSql}${excludedSql(excludedCount, "r.user_id")}
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
  const excludedIds = excludedValues(excluded, excludedBudget(12));
  const [earliestLocalDate, latestLocalDate] = failureDateBounds(scheduledAt);
  const ownerLocalDates = pinnedLocalDateIndexJson(scheduledAt.getTime());
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
                   AND ${automaticFailureSql}
                   AND ${exactFailureLocalDateSql}
                   ${excludedSql(excludedIds.length, "r.user_id")}
               )
               SELECT reading_id, user_id, assembly_mode, result_class
               FROM ranked
               WHERE user_rank = 1
               ORDER BY updated_at, user_id, reading_id
               LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(
      earliestLocalDate,
      latestLocalDate,
      ...automaticFailureValues,
      ownerLocalDates,
      ...excludedIds,
      limit,
    )
    .all<FailedSchedulerRow>();
  return result.results.map(failedCandidate);
}

export async function findStalePublishedCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<FactualSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded, excludedBudget(4));
  const [earliestLocalDate, latestLocalDate] = factualDateBounds(scheduledAt);
  const ownerLocalDates = pinnedLocalDateIndexJson(scheduledAt.getTime());
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
                   )
                   AND ${exactCurrentLocalDateSql}${excludedSql(excludedIds.length, "r.user_id")}
               )
               SELECT reading_id, user_id, local_date
               FROM ranked
               WHERE user_rank = 1
               ORDER BY updated_at, reading_id
               LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(earliestLocalDate, latestLocalDate, ownerLocalDates, ...excludedIds, limit)
    .all<FactualSchedulerRow>();
  return result.results.map(factualCandidate);
}

export async function findInvalidatedOrphanCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<FactualSchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded, excludedBudget(5));
  const cutoff = new Date(
    scheduledAt.getTime() - INVALIDATED_ORPHAN_BACKOFF_MS,
  ).toISOString();
  const [earliestLocalDate, latestLocalDate] = factualDateBounds(scheduledAt);
  const ownerLocalDates = pinnedLocalDateIndexJson(scheduledAt.getTime());
  const result = await env.DB.prepare(invalidatedOrphanDiscoverySql(excludedIds.length))
    .bind(cutoff, earliestLocalDate, latestLocalDate, ownerLocalDates, ...excludedIds, limit)
    .all<FactualSchedulerRow>();
  return result.results.map(factualCandidate);
}

export async function findExpiredSchedulerCandidates(
  env: Env,
  scheduledAt: Date,
  limit: number,
  excluded: ReadonlySet<string>,
): Promise<RecoverySchedulerCandidate[]> {
  if (limit <= 0) return [];
  const excludedIds = excludedValues(excluded, excludedBudget(2));
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
  const excludedIds = excludedValues(excluded, excludedBudget(2));
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
  const excludedIds = excludedValues(excluded, excludedBudget(2));
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
  const excludedIds = excludedValues(excluded, excludedBudget(1));
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
            -- The LATEST ai_synthesis row, not any granted row. Consent
            -- history is append-only: a revocation appends a revoked row and
            -- leaves the granted one in place, so an EXISTS matched forever and
            -- every revoked account still read as consented. That disagreed
            -- with loadAiSynthesisGrant, which reads the newest row only and is
            -- the authoritative rule - two implementations of one consent
            -- decision, differing in the permissive direction, one gate away
            -- from a paid provider call. The ordering matches loadLatestAiConsent.
            (
              SELECT c.status = 'granted' AND c.policy_version = ?
                     AND (c.expires_at IS NULL OR c.expires_at > ?)
              FROM consents c
              WHERE c.user_id = u.id AND c.kind = 'ai_synthesis'
              ORDER BY c.version DESC, c.created_at DESC, c.id DESC
              LIMIT 1
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
    // Stamped STRICTLY LATER than invalidated_at, which is what makes
    // `updated_at <= invalidated_at` mean "this scheduler has never backed this
    // orphan off". The two writers share one column and both stamp the same
    // instant when invalidation and backoff happen in one invocation, so
    // equality alone could not tell them apart - and filtering on the six-hour
    // threshold alone hid a freshly invalidated orphan for six hours, which is
    // the crash window this lane exists to converge. One second is inside the
    // six-hour window and affects nothing but this discriminator.
    `UPDATE daily_readings
     SET updated_at = CASE
       WHEN ? > invalidated_at THEN ?
       ELSE strftime('%Y-%m-%dT%H:%M:%fZ', invalidated_at, '+1 second')
     END
     WHERE id = ? AND user_id = ? AND status = 'invalidated'
       AND NOT EXISTS (
         SELECT 1 FROM daily_readings successor
         WHERE successor.supersedes_reading_id = daily_readings.id
       )`,
  )
    .bind(
      scheduledAt.toISOString(),
      scheduledAt.toISOString(),
      readingId,
      userId,
    )
    .run();
  return result.meta.changes === 1;
}
