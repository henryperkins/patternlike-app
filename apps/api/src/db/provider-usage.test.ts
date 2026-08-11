import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { consumeProviderCallBudget, utcDateFor } from "./provider-usage.js";
import { resetDb, rows } from "../../test/helpers.js";

/**
 * The only thing standing between a bug and an unbounded provider bill.
 *
 * Admission has to be exact under concurrency, because the callers are a cron
 * fan-out, a first-open request, and a queue retry, and nothing serialises
 * them. A read-then-write would admit as many callers as happened to read the
 * same value.
 */
describe("provider call budget", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("counts up from zero and reports what it consumed", async () => {
    expect(await consumeProviderCallBudget(env, "2026-08-10", 3)).toEqual({
      ok: true,
      used: 1,
    });
    expect(await consumeProviderCallBudget(env, "2026-08-10", 3)).toEqual({
      ok: true,
      used: 2,
    });
    expect(await consumeProviderCallBudget(env, "2026-08-10", 3)).toEqual({
      ok: true,
      used: 3,
    });
    expect(await consumeProviderCallBudget(env, "2026-08-10", 3)).toEqual({
      ok: false,
      reason: "exhausted",
    });
  });

  it("does not advance the counter once the ceiling is reached", async () => {
    await consumeProviderCallBudget(env, "2026-08-10", 1);
    await consumeProviderCallBudget(env, "2026-08-10", 1);
    await consumeProviderCallBudget(env, "2026-08-10", 1);

    const [row] = await rows<{ used_calls: number }>(
      "SELECT used_calls FROM reading_provider_daily_usage WHERE utc_date = ?",
      "2026-08-10",
    );
    expect(row?.used_calls).toBe(1);
  });

  it("admits exactly the configured count when consumers race", async () => {
    const limit = 4;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeProviderCallBudget(env, "2026-08-11", limit)),
    );

    const admitted = results.filter((r) => r.ok);
    expect(admitted).toHaveLength(limit);
    // Every admitted caller must have been handed a distinct slot, or two of
    // them read the same value and one of the calls is unaccounted for.
    expect(new Set(admitted.map((r) => (r.ok ? r.used : 0))).size).toBe(limit);

    const [row] = await rows<{ used_calls: number }>(
      "SELECT used_calls FROM reading_provider_daily_usage WHERE utc_date = ?",
      "2026-08-11",
    );
    expect(row?.used_calls).toBe(limit);
  });

  it("keeps a separate ceiling per UTC day", async () => {
    expect(await consumeProviderCallBudget(env, "2026-08-10", 1)).toEqual({ ok: true, used: 1 });
    expect(await consumeProviderCallBudget(env, "2026-08-10", 1)).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect(await consumeProviderCallBudget(env, "2026-08-11", 1)).toEqual({ ok: true, used: 1 });
  });

  it("refuses every call when the ceiling is zero or negative", async () => {
    for (const limit of [0, -1]) {
      expect(await consumeProviderCallBudget(env, "2026-08-12", limit)).toEqual({
        ok: false,
        reason: "exhausted",
      });
    }
    const created = await rows("SELECT utc_date FROM reading_provider_daily_usage");
    expect(created).toEqual([]);
  });

  it("keys the ledger by UTC date, never by user or local day", async () => {
    // 23:30 in New York on the 10th is already the 11th in UTC. The budget is
    // an operational ceiling, not a reader-facing day.
    expect(utcDateFor(new Date("2026-08-11T03:30:00Z"))).toBe("2026-08-11");
    expect(utcDateFor(new Date("2026-08-10T23:59:59Z"))).toBe("2026-08-10");

    await consumeProviderCallBudget(env, "2026-08-13", 2);
    const [row] = await rows<Record<string, unknown>>(
      "SELECT * FROM reading_provider_daily_usage WHERE utc_date = ?",
      "2026-08-13",
    );
    expect(Object.keys(row ?? {})).not.toContain("user_id");
  });
});
