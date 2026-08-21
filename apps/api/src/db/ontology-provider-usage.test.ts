import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb, rows } from "../../test/helpers.js";
import {
  consumeOntologyProviderCallBudget,
  createOntologyProviderCallReservation,
  utcDateForOntologyProviderUsage,
} from "./ontology-provider-usage.js";

interface OntologyUsageRow {
  used_calls: number;
  generator_calls: number;
  evaluator_calls: number;
  regression_calls: number;
}

async function usage(utcDate: string): Promise<OntologyUsageRow | undefined> {
  const [row] = await rows<OntologyUsageRow>(
    `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
     FROM pattern_ontology_provider_daily_usage WHERE utc_date = ?`,
    utcDate,
  );
  return row;
}

describe("ontology provider usage", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("increments the shared total and exactly one closed stage class", async () => {
    expect(
      await consumeOntologyProviderCallBudget(env, "2026-08-21", 10, "generator"),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await consumeOntologyProviderCallBudget(env, "2026-08-21", 10, "evaluator"),
    ).toEqual({ ok: true, used: 2 });
    expect(
      await consumeOntologyProviderCallBudget(env, "2026-08-21", 10, "regression"),
    ).toEqual({ ok: true, used: 3 });

    expect(await usage("2026-08-21")).toEqual({
      used_calls: 3,
      generator_calls: 1,
      evaluator_calls: 1,
      regression_calls: 1,
    });
  });

  it("refuses at the shared ceiling without incrementing any class", async () => {
    expect(
      await consumeOntologyProviderCallBudget(env, "2026-08-20", 1, "generator"),
    ).toEqual({ ok: true, used: 1 });
    expect(
      await consumeOntologyProviderCallBudget(env, "2026-08-20", 1, "evaluator"),
    ).toEqual({ ok: false, reason: "exhausted" });

    expect(await usage("2026-08-20")).toEqual({
      used_calls: 1,
      generator_calls: 1,
      evaluator_calls: 0,
      regression_calls: 0,
    });
  });

  it("admits exactly one concurrent caller for the last shared unit", async () => {
    await consumeOntologyProviderCallBudget(env, "2026-08-19", 4, "generator");
    await consumeOntologyProviderCallBudget(env, "2026-08-19", 4, "evaluator");
    await consumeOntologyProviderCallBudget(env, "2026-08-19", 4, "regression");

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        consumeOntologyProviderCallBudget(
          env,
          "2026-08-19",
          4,
          index % 2 === 0 ? "generator" : "evaluator",
        ),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const row = await usage("2026-08-19");
    expect(row?.used_calls).toBe(4);
    expect(
      (row?.generator_calls ?? 0) +
        (row?.evaluator_calls ?? 0) +
        (row?.regression_calls ?? 0),
    ).toBe(4);
  });

  it("does not refund a unit after a failed or timed-out call", async () => {
    const callAfterReservation = async (failure: "failed" | "timed_out") => {
      const reserved = await consumeOntologyProviderCallBudget(
        env,
        "2026-08-18",
        2,
        failure === "failed" ? "generator" : "evaluator",
      );
      expect(reserved.ok).toBe(true);
      throw new Error(failure);
    };

    await expect(callAfterReservation("failed")).rejects.toThrow("failed");
    await expect(callAfterReservation("timed_out")).rejects.toThrow("timed_out");
    expect(await usage("2026-08-18")).toEqual({
      used_calls: 2,
      generator_calls: 1,
      evaluator_calls: 1,
      regression_calls: 0,
    });
  });

  it("refuses invalid ceilings before creating a ledger row", async () => {
    for (const limit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        await consumeOntologyProviderCallBudget(
          env,
          "2026-08-17",
          limit,
          "generator",
        ),
      ).toEqual({ ok: false, reason: "exhausted" });
    }
    expect(await usage("2026-08-17")).toBeUndefined();
  });

  it("refuses non-closed dates and stage classes without a partial charge", async () => {
    await expect(consumeOntologyProviderCallBudget(
      env,
      "not-a-utc-day",
      2,
      "generator",
    )).resolves.toEqual({ ok: false, reason: "exhausted" });
    await expect(consumeOntologyProviderCallBudget(
      env,
      "2026-08-16",
      2,
      "rogue" as "generator",
    )).resolves.toEqual({ ok: false, reason: "exhausted" });
    expect(await usage("not-a-utc-day")).toBeUndefined();
    expect(await usage("2026-08-16")).toBeUndefined();
  });

  it("provides the publisher's sole stage-class reservation callback", async () => {
    const reserve = createOntologyProviderCallReservation(
      env,
      1,
      () => new Date("2026-08-15T23:59:59.000Z"),
    );
    expect(await reserve("generator")).toEqual({ ok: true, used: 1 });
    expect(await reserve("evaluator")).toEqual({ ok: false, reason: "exhausted" });
    expect(await usage("2026-08-15")).toEqual({
      used_calls: 1,
      generator_calls: 1,
      evaluator_calls: 0,
      regression_calls: 0,
    });
  });

  it("keys operational usage by UTC day", () => {
    expect(utcDateForOntologyProviderUsage(new Date("2026-08-21T23:59:59Z")))
      .toBe("2026-08-21");
    expect(utcDateForOntologyProviderUsage(new Date("2026-08-22T00:00:00Z")))
      .toBe("2026-08-22");
  });
});
