import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "../../test/helpers.js";
import {
  PATTERN_COMMAND_VERSION,
  isPatternCommand,
  patternFailureIsRetryable,
} from "./pattern-command.js";

function commandWithMaxima(
  writerAttemptsMax: unknown,
  plannerAttemptsMax: unknown = 2,
  verifierAttemptsMax: unknown = 2,
): Record<string, unknown> {
  return {
    command_version: PATTERN_COMMAND_VERSION,
    planner_attempts_max: plannerAttemptsMax,
    writer_attempts_max: writerAttemptsMax,
    verifier_attempts_max: verifierAttemptsMax,
  };
}

describe("Pattern command attempt maxima", () => {
  it.each([2, 3])("decodes a stored writer maximum of %i", (writerAttemptsMax) => {
    expect(isPatternCommand(commandWithMaxima(writerAttemptsMax))).toBe(true);
  });

  it.each([undefined, null, -1, 0, 1, 4, "3"])(
    "rejects writer_attempts_max=%s",
    (writerAttemptsMax) => {
      expect(isPatternCommand(commandWithMaxima(writerAttemptsMax))).toBe(false);
    },
  );

  it.each([
    [null, 2],
    [1, 2],
    [3, 2],
    ["2", 2],
    [2, null],
    [2, 1],
    [2, 3],
    [2, "2"],
  ])(
    "rejects planner_attempts_max=%s and verifier_attempts_max=%s",
    (plannerAttemptsMax, verifierAttemptsMax) => {
      expect(
        isPatternCommand(commandWithMaxima(3, plannerAttemptsMax, verifierAttemptsMax)),
      ).toBe(false);
    },
  );

  it.each(["planner_attempts_max", "verifier_attempts_max"] as const)(
    "rejects a command missing %s",
    (field) => {
      const command = commandWithMaxima(3);
      delete command[field];
      expect(isPatternCommand(command)).toBe(false);
    },
  );
});

describe("Pattern budget failure retryability", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  beforeEach(async () => {
    await resetDb();
    env.PATTERN_DAILY_PROVIDER_CALL_LIMIT = "2";
  });

  afterEach(() => {
    env.PATTERN_DAILY_PROVIDER_CALL_LIMIT = "";
  });

  it("reads current UTC-day capacity without consuming it", async () => {
    expect(await patternFailureIsRetryable(env, "publisher_refused", now)).toBe(true);
    expect(
      await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
    ).toBe(true);

    await env.DB.prepare(
      `INSERT INTO pattern_provider_daily_usage
         (utc_date, used_calls, planner_calls, writer_calls, verifier_calls, created_at, updated_at)
       VALUES ('2026-08-22', 0, 0, 0, 0, ?, ?)`,
    )
      .bind(now.toISOString(), now.toISOString())
      .run();
    expect(
      await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
    ).toBe(true);
    await env.DB.prepare(
      `UPDATE pattern_provider_daily_usage SET used_calls = 1
       WHERE utc_date = '2026-08-22'`,
    ).run();
    expect(
      await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
    ).toBe(true);
    await env.DB.prepare(
      `UPDATE pattern_provider_daily_usage SET used_calls = 2
       WHERE utc_date = '2026-08-22'`,
    ).run();
    expect(
      await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
    ).toBe(false);
    await env.DB.prepare(
      `UPDATE pattern_provider_daily_usage SET used_calls = 3
       WHERE utc_date = '2026-08-22'`,
    ).run();
    expect(
      await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
    ).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT used_calls FROM pattern_provider_daily_usage WHERE utc_date = '2026-08-22'",
      ).first<{ used_calls: number }>(),
    ).toEqual({ used_calls: 3 });
  });

  it.each(["", "0", "1.5", "not-a-limit"])(
    "fails closed for configured ceiling %j",
    async (limit) => {
      env.PATTERN_DAILY_PROVIDER_CALL_LIMIT = limit;
      expect(
        await patternFailureIsRetryable(env, "publisher_budget_exhausted", now),
      ).toBe(false);
    },
  );

  it("fails closed when the capacity query fails", async () => {
    const queryFailureEnv = {
      ...env,
      DB: {
        prepare(): never {
          throw new Error("injected capacity query failure");
        },
      } as unknown as D1Database,
    };
    expect(
      await patternFailureIsRetryable(queryFailureEnv, "publisher_refused", now),
    ).toBe(true);
    expect(
      await patternFailureIsRetryable(
        queryFailureEnv,
        "publisher_budget_exhausted",
        now,
      ),
    ).toBe(false);
  });
});
