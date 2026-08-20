import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

import { resetDb, rows } from "../../test/helpers.js";
import { consumePatternProviderCallBudget } from "./pattern-provider-usage.js";

interface PatternUsageRow {
  used_calls: number;
  planner_calls: number;
  writer_calls: number;
  verifier_calls: number;
}

describe("Pattern provider usage by stage class", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("increments each pass counter beside the shared total", async () => {
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-20", 10, "planner"),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-20", 10, "writer"),
    ).toEqual({ ok: true, used: 2 });
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-20", 10, "verifier"),
    ).toEqual({ ok: true, used: 3 });

    const [usage] = await rows<PatternUsageRow>(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage WHERE utc_date = ?`,
      "2026-08-20",
    );
    expect(usage).toEqual({
      used_calls: 3,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 1,
    });
  });

  it("enforces one shared ceiling against used_calls", async () => {
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-21", 2, "planner"),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-21", 2, "writer"),
    ).toEqual({ ok: true, used: 2 });
    expect(
      await consumePatternProviderCallBudget(env, "2026-08-21", 2, "verifier"),
    ).toEqual({ ok: false, reason: "exhausted" });

    const [usage] = await rows<PatternUsageRow>(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage WHERE utc_date = ?`,
      "2026-08-21",
    );
    expect(usage).toEqual({
      used_calls: 2,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 0,
    });
  });

  it("keeps the shared ceiling exact when stage classes race", async () => {
    const stages = [
      "planner",
      "writer",
      "verifier",
      "planner",
      "writer",
      "verifier",
      "planner",
      "writer",
      "verifier",
    ] as const;
    const outcomes = await Promise.all(
      stages.map((stage) =>
        consumePatternProviderCallBudget(env, "2026-08-22", 4, stage),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(4);

    const [usage] = await rows<PatternUsageRow>(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage WHERE utc_date = ?`,
      "2026-08-22",
    );
    expect(usage?.used_calls).toBe(4);
    expect(
      (usage?.planner_calls ?? 0) +
        (usage?.writer_calls ?? 0) +
        (usage?.verifier_calls ?? 0),
    ).toBe(4);
  });
});
