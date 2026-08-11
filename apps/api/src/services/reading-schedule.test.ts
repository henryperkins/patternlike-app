import { describe, expect, it } from "vitest";

import {
  DEFAULT_READING_SCHEDULE_POLICY,
  nextReadingCursor,
  readingDueAt,
  selectReadingScheduleTarget,
} from "./reading-schedule.js";

const DATE = "2026-08-12";

describe("daily-reading schedule math", () => {
  it.each([
    ["usr_bucket_003", 0, "2026-08-11T23:30:00.000Z"],
    ["usr_bucket_000", 1, "2026-08-11T23:15:00.000Z"],
    ["usr_bucket_001", 2, "2026-08-11T23:00:00.000Z"],
    ["usr_bucket_002", 3, "2026-08-11T22:45:00.000Z"],
  ] as const)(
    "uses SHA-256(user_id, date) mod 4 for bucket %s",
    async (userId, bucket, dueAt) => {
      const schedule = await readingDueAt(
        userId,
        DATE,
        "UTC",
        DEFAULT_READING_SCHEDULE_POLICY,
      );

      expect(schedule).toMatchObject({ ok: true, bucket, dueAt });
    },
  );

  it.each([
    ["UTC", "2026-08-11T23:15:00.000Z"],
    ["Asia/Kolkata", "2026-08-11T17:45:00.000Z"],
    ["Asia/Kathmandu", "2026-08-11T17:30:00.000Z"],
    ["Pacific/Chatham", "2026-08-11T10:30:00.000Z"],
  ] as const)(
    "keeps the due instant on the quarter hour for %s",
    async (zone, expectedDueAt) => {
      const schedule = await readingDueAt(
        "usr_bucket_000",
        DATE,
        zone,
        DEFAULT_READING_SCHEDULE_POLICY,
      );

      expect(schedule).toMatchObject({ ok: true, dueAt: expectedDueAt });
    },
  );

  it("subtracts real elapsed minutes from DST-transition day starts", async () => {
    const spring = await readingDueAt(
      "usr_dst_000",
      "2026-03-08",
      "America/Chicago",
      DEFAULT_READING_SCHEDULE_POLICY,
    );
    const fall = await readingDueAt(
      "usr_dst_004",
      "2026-11-01",
      "America/Chicago",
      DEFAULT_READING_SCHEDULE_POLICY,
    );

    expect(spring).toMatchObject({ ok: true, dueAt: "2026-03-08T05:30:00.000Z" });
    expect(fall).toMatchObject({ ok: true, dueAt: "2026-11-01T04:30:00.000Z" });
  });

  it("reports a wholly unrepresentable date instead of inventing a due time", async () => {
    await expect(
      readingDueAt(
        "usr_bucket_003",
        "2011-12-30",
        "Pacific/Apia",
        DEFAULT_READING_SCHEDULE_POLICY,
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "skipped_local_date",
      nextRepresentableDate: "2011-12-31",
    });
  });

  it("advances a cursor to the next representable local date", async () => {
    const next = await nextReadingCursor(
      "usr_dst_000",
      "2011-12-29",
      "Pacific/Apia",
      DEFAULT_READING_SCHEDULE_POLICY,
    );

    expect(next.targetLocalDate).toBe("2011-12-31");
    expect(next.skippedLocalDates).toEqual(["2011-12-30"]);
    expect(Date.parse(next.dueAt)).toBe(Date.parse("2011-12-30T09:30:00.000Z"));
  });

  it("selects the current day before the next pre-generation window", async () => {
    const selected = await selectReadingScheduleTarget(
      "usr_bucket_003",
      "America/Chicago",
      new Date("2026-08-10T15:00:00.000Z"),
      DEFAULT_READING_SCHEDULE_POLICY,
    );

    expect(selected.targetLocalDate).toBe("2026-08-10");
    expect(selected.nextCursor.targetLocalDate).toBe("2026-08-11");
  });

  it("selects the next day once its pre-generation due time has passed", async () => {
    const selected = await selectReadingScheduleTarget(
      "usr_bucket_003",
      "America/Chicago",
      new Date("2026-08-11T04:45:00.000Z"),
      DEFAULT_READING_SCHEDULE_POLICY,
    );

    expect(selected.targetLocalDate).toBe("2026-08-11");
    expect(selected.nextCursor.targetLocalDate).toBe("2026-08-12");
  });

  it("uses invocation time rather than a stale historical cursor to choose a target", async () => {
    const selected = await selectReadingScheduleTarget(
      "usr_bucket_003",
      "America/Chicago",
      new Date("2026-08-10T15:00:00.000Z"),
      DEFAULT_READING_SCHEDULE_POLICY,
    );

    expect(selected.targetLocalDate).toBe("2026-08-10");
    expect(selected.targetLocalDate).not.toBe("2026-08-01");
  });
});
