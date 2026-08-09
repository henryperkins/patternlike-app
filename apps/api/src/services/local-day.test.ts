import { describe, expect, it } from "vitest";
import {
  LocalDayError,
  isCurrentOrPreviousLocalDay,
  localDateIn,
  localDayWindow,
  nextLocalDate,
  previousLocalDate,
  resolveLocalDay,
} from "./local-day.js";

const hours = (window: { dayStartAt: string; dayEndAt: string }) =>
  (Date.parse(window.dayEndAt) - Date.parse(window.dayStartAt)) / 3_600_000;

describe("localDayWindow", () => {
  it("gives an ordinary 24-hour day in a fixed-offset zone", () => {
    const window = localDayWindow("America/Chicago", "2026-08-09");
    expect(window).toEqual({
      targetLocalDate: "2026-08-09",
      dayStartAt: "2026-08-09T05:00:00Z",
      dayEndAt: "2026-08-10T05:00:00Z",
    });
    expect(hours(window)).toBe(24);
  });

  it("is 23 hours on a spring-forward day and 25 on a fall-back day", () => {
    // US DST transitions happen at 02:00 local, so midnight itself is ordinary
    // and the whole irregularity lands inside the interval — which is exactly
    // why the interval is computed once at enqueue instead of assumed to be 24h.
    expect(hours(localDayWindow("America/Chicago", "2026-03-08"))).toBe(23);
    expect(hours(localDayWindow("America/Chicago", "2026-11-01"))).toBe(25);
  });

  it("starts the day after the gap when the zone springs forward at midnight", () => {
    // Santiago moves 00:00 -> 01:00 on 2026-09-06. Local midnight never occurs.
    const window = localDayWindow("America/Santiago", "2026-09-06");
    expect(localDateIn("America/Santiago", new Date(window.dayStartAt))).toBe("2026-09-06");
    expect(hours(window)).toBe(23);
    // And the previous day must end exactly where this one starts: no instant
    // may fall in a crack between two consecutive local days.
    expect(localDayWindow("America/Santiago", "2026-09-05").dayEndAt).toBe(window.dayStartAt);
  });

  it("takes the first occurrence when midnight happens twice", () => {
    // Havana falls back 01:00 -> 00:00 on 2026-11-01, so local midnight occurs
    // twice: once at 04:00Z under -04:00 and again at 05:00Z under -05:00.
    // Taking the first makes the day 25 hours; taking the second would start it
    // an hour late and leave that hour belonging to no day at all.
    const window = localDayWindow("America/Havana", "2026-11-01");
    expect(window.dayStartAt).toBe("2026-11-01T04:00:00Z");
    expect(hours(window)).toBe(25);
    expect(localDayWindow("America/Havana", "2026-10-31").dayEndAt).toBe(window.dayStartAt);
  });

  it("starts after the gap when a zone springs forward at midnight", () => {
    // Havana skips 00:00 -> 01:00 on 2026-03-08: local midnight never happens.
    const window = localDayWindow("America/Havana", "2026-03-08");
    expect(window.dayStartAt).toBe("2026-03-08T05:00:00Z");
    expect(hours(window)).toBe(23);
    expect(localDayWindow("America/Havana", "2026-03-07").dayEndAt).toBe(window.dayStartAt);
  });

  it("handles a zone whose offset is not a whole hour", () => {
    const window = localDayWindow("Asia/Kolkata", "2026-08-09");
    expect(window.dayStartAt).toBe("2026-08-08T18:30:00Z");
    expect(hours(window)).toBe(24);
  });

  it("keeps consecutive days contiguous across a whole transition week", () => {
    let cursor = "2026-03-05";
    let previousEnd = localDayWindow("America/Chicago", cursor).dayStartAt;
    for (let i = 0; i < 7; i++) {
      const window = localDayWindow("America/Chicago", cursor);
      expect(window.dayStartAt).toBe(previousEnd);
      previousEnd = window.dayEndAt;
      cursor = nextLocalDate(cursor);
    }
  });

  it("rejects a malformed date", () => {
    expect(() => localDayWindow("UTC", "2026-8-9")).toThrow(LocalDayError);
    expect(() => localDayWindow("UTC", "not-a-date")).toThrow(LocalDayError);
    expect(() => localDayWindow("UTC", "2026-13-45")).toThrow(LocalDayError);
    expect(() => localDayWindow("UTC", "2026-02-29")).toThrow(LocalDayError);
    expect(localDayWindow("UTC", "2024-02-29").targetLocalDate).toBe("2024-02-29");
  });
});

describe("resolveLocalDay", () => {
  it("picks the day the scheduling zone is in, not the day UTC is in", () => {
    // 04:30Z on 9 August is still 8 August in Chicago and already 9 August in
    // Tokyo. Substituting a birthplace zone here is how a reader gets a reading
    // dated to a day they are not living in.
    const instant = new Date("2026-08-09T04:30:00Z");
    expect(resolveLocalDay("America/Chicago", instant).targetLocalDate).toBe("2026-08-08");
    expect(resolveLocalDay("Asia/Tokyo", instant).targetLocalDate).toBe("2026-08-09");
    expect(resolveLocalDay("UTC", instant).targetLocalDate).toBe("2026-08-09");
  });

  it("brackets the instant it was resolved from", () => {
    const instant = new Date("2026-11-01T07:30:00Z");
    const window = resolveLocalDay("America/Chicago", instant);
    expect(Date.parse(window.dayStartAt)).toBeLessThanOrEqual(instant.getTime());
    expect(Date.parse(window.dayEndAt)).toBeGreaterThan(instant.getTime());
  });
});

describe("calendar arithmetic", () => {
  it("crosses month, year, and leap-day boundaries", () => {
    expect(nextLocalDate("2026-08-31")).toBe("2026-09-01");
    expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
    expect(previousLocalDate("2026-01-01")).toBe("2025-12-31");
    expect(nextLocalDate("2028-02-28")).toBe("2028-02-29");
    expect(previousLocalDate("2027-03-01")).toBe("2027-02-28");
  });
});

describe("isCurrentOrPreviousLocalDay", () => {
  const now = new Date("2026-08-09T18:00:00Z");

  it("accepts today and yesterday in the scheduling zone", () => {
    expect(isCurrentOrPreviousLocalDay("America/Chicago", "2026-08-09", now)).toBe(true);
    expect(isCurrentOrPreviousLocalDay("America/Chicago", "2026-08-08", now)).toBe(true);
  });

  it("refuses older history and a day that has not happened", () => {
    expect(isCurrentOrPreviousLocalDay("America/Chicago", "2026-07-19", now)).toBe(false);
    expect(isCurrentOrPreviousLocalDay("America/Chicago", "2026-08-10", now)).toBe(false);
  });

  it("answers in the user's zone, not UTC", () => {
    // 2026-08-09T18:00Z is already the 10th in Tokyo.
    expect(isCurrentOrPreviousLocalDay("Asia/Tokyo", "2026-08-10", now)).toBe(true);
    expect(isCurrentOrPreviousLocalDay("Asia/Tokyo", "2026-08-08", now)).toBe(false);
  });
});
