import type { Env } from "../env.js";

/**
 * The UTC-day ceiling on provider calls, consumed atomically.
 *
 * Every path that can reach OpenAI shares this counter: the scheduler fan-out,
 * an explicit first-open request, and a queue retry. Nothing serialises them, so
 * a read-then-write would admit as many callers as happened to observe the same
 * value — which is precisely the failure mode a spend ceiling exists to prevent.
 * One conditional UPSERT with RETURNING is the whole mechanism: SQLite applies
 * it as a single statement, the `WHERE used_calls < ?` on the conflict branch is
 * the compare, and an empty RETURNING is the refusal.
 *
 * The ledger is keyed ONLY by date. A per-user counter would be a clear-text
 * record of which accounts received a reading on which day, and an operational
 * counter is not worth that.
 */

export type ProviderBudgetOutcome =
  | { ok: true; used: number }
  | { ok: false; reason: "exhausted" };

/** The ledger key for an instant. UTC, never the reader's local day. */
export function utcDateFor(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function consumeProviderCallBudget(
  env: Env,
  utcDate: string,
  limit: number,
): Promise<ProviderBudgetOutcome> {
  // A non-positive ceiling is refused before the INSERT branch can create a
  // row: the conflict clause only guards the SECOND and later calls, so a
  // limit of zero would otherwise admit exactly one.
  if (!Number.isInteger(limit) || limit < 1) return { ok: false, reason: "exhausted" };

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO reading_provider_daily_usage (utc_date, used_calls, created_at, updated_at)
     VALUES (?1, 1, ?2, ?2)
     ON CONFLICT (utc_date) DO UPDATE
       SET used_calls = used_calls + 1, updated_at = ?2
       WHERE used_calls < ?3
     RETURNING used_calls`,
  )
    .bind(utcDate, now, limit)
    .first<{ used_calls: number }>();

  if (!row) return { ok: false, reason: "exhausted" };
  return { ok: true, used: row.used_calls };
}
