import type { Env } from "../env.js";
import type { OntologyProviderPass } from "../services/ontology-publisher.js";

export type OntologyProviderStageClass = OntologyProviderPass | "regression";

export type OntologyProviderBudgetOutcome =
  | { ok: true; used: number }
  | { ok: false; reason: "exhausted" };

export function utcDateForOntologyProviderUsage(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) &&
    utcDateForOntologyProviderUsage(instant) === value;
}

/**
 * Atomically reserve one provider call against the pipeline's shared UTC-day
 * ceiling while attributing it to exactly one closed stage class.
 *
 * This is intentionally consumption, not a refundable lease. The caller
 * invokes it immediately before fetch; once this statement returns `ok`, a
 * provider failure or timeout still owns the unit.
 */
export async function consumeOntologyProviderCallBudget(
  env: Pick<Env, "DB">,
  utcDate: string,
  limit: number,
  stageClass: OntologyProviderStageClass,
): Promise<OntologyProviderBudgetOutcome> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !isUtcDate(utcDate) ||
    !["generator", "evaluator", "regression"].includes(stageClass)
  ) {
    return { ok: false, reason: "exhausted" };
  }

  const now = new Date().toISOString();
  const generatorIncrement = stageClass === "generator" ? 1 : 0;
  const evaluatorIncrement = stageClass === "evaluator" ? 1 : 0;
  const regressionIncrement = stageClass === "regression" ? 1 : 0;
  const row = await env.DB.prepare(
    `INSERT INTO pattern_ontology_provider_daily_usage (
       utc_date, used_calls, generator_calls, evaluator_calls,
       regression_calls, created_at, updated_at
     ) VALUES (?1, 1, ?4, ?5, ?6, ?2, ?2)
     ON CONFLICT (utc_date) DO UPDATE
       SET used_calls = used_calls + 1,
           generator_calls = generator_calls + ?4,
           evaluator_calls = evaluator_calls + ?5,
           regression_calls = regression_calls + ?6,
           updated_at = ?2
       WHERE used_calls < ?3
     RETURNING used_calls`,
  )
    .bind(
      utcDate,
      now,
      limit,
      generatorIncrement,
      evaluatorIncrement,
      regressionIncrement,
    )
    .first<{ used_calls: number }>();

  if (!row) return { ok: false, reason: "exhausted" };
  return { ok: true, used: row.used_calls };
}

/** The Task 4 publisher's single accounting injection point. */
export function createOntologyProviderCallReservation(
  env: Pick<Env, "DB">,
  limit: number,
  now: () => Date = () => new Date(),
): (stageClass: OntologyProviderPass) => Promise<OntologyProviderBudgetOutcome> {
  return async (stageClass) => {
    const operationAt = now();
    return consumeOntologyProviderCallBudget(
      env,
      utcDateForOntologyProviderUsage(operationAt),
      limit,
      stageClass,
    );
  };
}
