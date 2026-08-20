import type { Env } from "../env.js";

export async function consumePatternProviderCallBudget(
  env: Env,
  utcDate: string,
  limit: number,
  stageClass: "planner" | "writer" | "verifier",
): Promise<{ ok: true; used: number } | { ok: false; reason: "exhausted" }> {
  if (!Number.isInteger(limit) || limit < 1) return { ok: false, reason: "exhausted" };
  const now = new Date().toISOString();
  const plannerIncrement = stageClass === "planner" ? 1 : 0;
  const writerIncrement = stageClass === "writer" ? 1 : 0;
  const verifierIncrement = stageClass === "verifier" ? 1 : 0;
  const row = await env.DB.prepare(
    `INSERT INTO pattern_provider_daily_usage (
       utc_date, used_calls, planner_calls, writer_calls, verifier_calls,
       created_at, updated_at
     ) VALUES (?1, 1, ?4, ?5, ?6, ?2, ?2)
     ON CONFLICT (utc_date) DO UPDATE
       SET used_calls = used_calls + 1,
           planner_calls = planner_calls + ?4,
           writer_calls = writer_calls + ?5,
           verifier_calls = verifier_calls + ?6,
           updated_at = ?2
       WHERE used_calls < ?3
     RETURNING used_calls`,
  )
    .bind(
      utcDate,
      now,
      limit,
      plannerIncrement,
      writerIncrement,
      verifierIncrement,
    )
    .first<{ used_calls: number }>();
  if (!row) return { ok: false, reason: "exhausted" };
  return { ok: true, used: row.used_calls };
}

export function utcDateFor(now: Date): string {
  return now.toISOString().slice(0, 10);
}
