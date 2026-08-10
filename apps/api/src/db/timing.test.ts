import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CyclePass, NormalizedCycle } from "@patternlike/shared";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  seedActiveRelease,
  seedChart,
  seedTimingReceipt,
  seedUser,
} from "../../test/helpers.js";
import { persistCycles } from "./cycles.js";
import {
  StoredTimingReceiptInvalidError,
  loadTimingSnapshot,
} from "./timing.js";

const AS_OF = "2026-08-10T12:00:00Z";

function cycleId(hexDigit: string): string {
  return `cyc_${hexDigit.repeat(32)}`;
}

function makeCycle(options: {
  id: string;
  startAt?: string;
  endAt?: string;
  passes?: CyclePass[];
}): NormalizedCycle {
  const passes = options.passes ?? [
    {
      pass_index: 1,
      direction: "direct",
      exact_at: "2026-08-01T12:00:00Z",
      speed_deg_per_day: 0.04,
    },
  ];
  return {
    id: options.id,
    technique: "transit",
    body: "saturn",
    target: "sun",
    aspect: "square",
    start_at: options.startAt ?? "2026-07-01T12:00:00Z",
    exact_at: passes[0]!.exact_at,
    end_at: options.endAt ?? "2026-12-01T12:00:00Z",
    pass_count: passes.length,
    passes,
    orb_deg: 3,
    importance_score: null,
  };
}

describe("loadTimingSnapshot", () => {
  let aliceChartId: string;
  let bobChartId: string;
  let releaseVersion: string;

  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_A);
    await confirmPreferences(USER_B);
    ({ chartId: aliceChartId } = await seedChart(IDENTITY_A));
    ({ chartId: bobChartId } = await seedChart(IDENTITY_B));
    ({ version: releaseVersion } = await seedActiveRelease("release-timing-tests"));
  });

  it("returns eligible cycle_json artifacts and the latest user-owned receipt", async () => {
    const cycle = makeCycle({ id: cycleId("a") });
    await persistCycles(env, USER_A, aliceChartId, [cycle]);
    await seedTimingReceipt({
      id: "rdg_timing_alice_current",
      userId: USER_A,
      localDate: "2026-08-10",
      releaseVersion,
      createdAt: "2026-08-10T12:01:00Z",
    });

    await expect(loadTimingSnapshot(env, USER_A, AS_OF)).resolves.toEqual({
      cycles: [cycle],
      unreadableCycleIds: [],
      receipt: {
        localDate: "2026-08-10",
        createdAt: "2026-08-10T12:01:00Z",
      },
    });
  });

  it("keeps another user's cycles outside the result at the query boundary", async () => {
    const aliceCycle = makeCycle({ id: cycleId("a") });
    const bobCycle = makeCycle({ id: cycleId("b") });
    await persistCycles(env, USER_A, aliceChartId, [aliceCycle]);
    await persistCycles(env, USER_B, bobChartId, [bobCycle]);

    const snapshot = await loadTimingSnapshot(env, USER_A, AS_OF);

    expect(snapshot.cycles).toEqual([aliceCycle]);
    expect(snapshot.cycles.map((cycle) => cycle.id)).not.toContain(bobCycle.id);
  });

  it("excludes ended and non-active rows before attempting to parse their blobs", async () => {
    const ended = makeCycle({
      id: cycleId("a"),
      startAt: "2026-07-01T12:00:00Z",
      endAt: "2026-08-09T12:00:00Z",
    });
    const completed = makeCycle({ id: cycleId("b") });
    await persistCycles(env, USER_A, aliceChartId, [ended, completed]);
    await env.DB.prepare(
      `UPDATE cycle_instances
       SET cycle_json = '{', status = CASE WHEN id = ? THEN 'completed' ELSE status END
       WHERE id IN (?, ?)`,
    )
      .bind(completed.id, ended.id, completed.id)
      .run();

    await expect(loadTimingSnapshot(env, USER_A, AS_OF)).resolves.toEqual({
      cycles: [],
      unreadableCycleIds: [],
      receipt: null,
    });
  });

  it("omits one malformed eligible artifact without hiding its valid sibling", async () => {
    const valid = makeCycle({ id: cycleId("a") });
    const malformed = makeCycle({ id: cycleId("b") });
    await persistCycles(env, USER_A, aliceChartId, [valid, malformed]);
    await env.DB.prepare("UPDATE cycle_instances SET cycle_json = '{' WHERE id = ?")
      .bind(malformed.id)
      .run();

    await expect(loadTimingSnapshot(env, USER_A, AS_OF)).resolves.toEqual({
      cycles: [valid],
      unreadableCycleIds: [malformed.id],
      receipt: null,
    });
  });

  it("ignores changed and extra cycle_passes rows in favor of cycle_json", async () => {
    const cycle = makeCycle({
      id: cycleId("c"),
      endAt: "2026-10-01T12:00:00Z",
      passes: [
        {
          pass_index: 1,
          direction: "direct",
          exact_at: "2026-08-01T12:00:00Z",
          speed_deg_per_day: 0.04,
        },
        {
          pass_index: 2,
          direction: "retrograde",
          exact_at: "2026-09-01T12:00:00Z",
          speed_deg_per_day: -0.03,
        },
      ],
    });
    await persistCycles(env, USER_A, aliceChartId, [cycle]);
    await env.DB.prepare(
      "UPDATE cycle_passes SET exact_at = '2026-08-05T12:00:00Z' WHERE cycle_id = ? AND pass_index = 1",
    )
      .bind(cycle.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO cycle_passes
         (id, cycle_id, user_id, pass_index, direction, exact_at,
          speed_deg_per_day, created_at)
       VALUES (?, ?, ?, 3, 'direct', '2026-09-15T12:00:00Z', 0.02, ?)`,
    )
      .bind(`cyp_${"f".repeat(32)}`, cycle.id, USER_A, AS_OF)
      .run();

    const snapshot = await loadTimingSnapshot(env, USER_A, AS_OF);

    expect(snapshot.cycles).toEqual([cycle]);
    expect(snapshot.cycles[0]!.passes).toEqual(cycle.passes);
    expect(snapshot.cycles[0]!.pass_count).toBe(2);
  });

  it("orders receipts by local date then creation time without filtering status", async () => {
    await seedTimingReceipt({
      id: "rdg_timing_current_v1",
      userId: USER_A,
      localDate: "2026-08-10",
      releaseVersion,
      status: "superseded",
      createdAt: "2026-08-10T01:00:00Z",
    });
    await seedTimingReceipt({
      id: "rdg_timing_current_v2",
      userId: USER_A,
      localDate: "2026-08-10",
      releaseVersion,
      status: "failed",
      revision: 2,
      revisionReason: "defect_repair",
      supersedesReadingId: "rdg_timing_current_v1",
      createdAt: "2026-08-10T02:00:00Z",
    });
    await seedTimingReceipt({
      id: "rdg_timing_older_late_write",
      userId: USER_A,
      localDate: "2026-08-09",
      releaseVersion,
      status: "failed",
      createdAt: "2026-08-11T23:00:00Z",
    });

    const snapshot = await loadTimingSnapshot(env, USER_A, AS_OF);

    expect(snapshot.receipt).toEqual({
      localDate: "2026-08-10",
      createdAt: "2026-08-10T02:00:00Z",
    });
  });

  it.each([
    {
      label: "calendar date",
      localDate: "2026-02-30",
      createdAt: "2026-08-10T12:01:00Z",
    },
    {
      label: "receipt timestamp",
      localDate: "2026-08-10",
      createdAt: "not-an-instant",
    },
  ])("rejects a malformed $label without exposing receipt or user values", async (receipt) => {
    await seedTimingReceipt({
      id: `rdg_timing_malformed_${receipt.label.replace(" ", "_")}`,
      userId: USER_A,
      localDate: receipt.localDate,
      releaseVersion,
      status: "failed",
      createdAt: receipt.createdAt,
    });

    try {
      await loadTimingSnapshot(env, USER_A, AS_OF);
      throw new Error("malformed receipt unexpectedly loaded");
    } catch (error) {
      expect(error).toBeInstanceOf(StoredTimingReceiptInvalidError);
      expect((error as Error).message).not.toContain(USER_A);
      expect((error as Error).message).not.toContain(receipt.localDate);
      expect((error as Error).message).not.toContain(receipt.createdAt);
    }
  });
});
