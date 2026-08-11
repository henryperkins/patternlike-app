import { describe, expect, it } from "vitest";
import {
  LocalDayError,
  isCurrentOrPreviousLocalDay,
  localDateIn,
  localDayWindow,
  nextLocalDate,
  previousLocalDate,
  resolveDailySkyWindow,
  resolveLocalDay,
  TZDB_VERSION,
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
  });

  it("rejects calendar dates that only look ISO-formatted", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29"]) {
      expect(() => localDayWindow("UTC", date)).toThrow(LocalDayError);
    }
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

describe("resolveDailySkyWindow", () => {
  const ok = (zone: string, date: string) => {
    const resolution = resolveDailySkyWindow(zone, date);
    if (!resolution.ok) throw new Error(`expected ${zone} ${date} to resolve`);
    return resolution.window;
  };

  it("anchors on local noon and pins the tz database that resolved it", () => {
    const window = ok("America/Los_Angeles", "2026-07-30");
    expect(window).toEqual({
      targetLocalDate: "2026-07-30",
      dayStartAt: "2026-07-30T07:00:00Z",
      dayEndAt: "2026-07-31T07:00:00Z",
      anchorAt: "2026-07-30T19:00:00Z",
      anchorResolution: "unique",
      tzdbVersion: TZDB_VERSION,
      localDayResolutionPolicyVersion: "1.0.0",
    });
    // Pinned, not inherited: `Intl` carries whatever database the platform
    // shipped, and a runtime that silently updated it would move a reader's day
    // boundaries without changing any value the command records.
    expect(TZDB_VERSION).toMatch(/^\d{4}[a-z]$/);
  });

  it("keeps the anchor inside its own half-open day on 23-, 24-, and 25-hour days", () => {
    for (const [date, length] of [
      ["2026-03-08", 23],
      ["2026-07-30", 24],
      ["2026-11-01", 25],
    ] as const) {
      const window = ok("America/Los_Angeles", date);
      expect(hours(window)).toBe(length);
      expect(Date.parse(window.dayStartAt)).toBeLessThanOrEqual(Date.parse(window.anchorAt));
      expect(Date.parse(window.anchorAt)).toBeLessThan(Date.parse(window.dayEndAt));
    }
  });

  it("handles quarter-hour zones on both sides of the date line", () => {
    expect(ok("Asia/Kathmandu", "2026-07-30").anchorAt).toBe("2026-07-30T06:15:00Z");
    // Chatham is +12:45 in its winter and +13:45 in its summer, so its noon
    // anchor lands on the PREVIOUS UTC date in both.
    expect(ok("Pacific/Chatham", "2026-07-30").anchorAt).toBe("2026-07-29T23:15:00Z");
    expect(ok("Pacific/Chatham", "2026-01-30").anchorAt).toBe("2026-01-29T22:15:00Z");
  });

  it("takes the earlier offset when a nominal noon happened twice", () => {
    // 1883-11-18: US railroads adopted standard time and Chicago's clock fell
    // back through noon, so 12:00:00 local happened twice that day.
    const window = ok("America/Chicago", "1883-11-18");
    expect(window.anchorResolution).toBe("ambiguous_earlier");
    expect(window.anchorAt).toBe("1883-11-18T17:50:36Z");
  });

  it("shifts forward to the first valid instant when noon never happened", () => {
    // Sudan moved from UTC+2 to UTC+3 at noon on 2000-01-15, so 12:00:00 local
    // has no instant. The first instant after the gap is the transition itself.
    const window = ok("Africa/Khartoum", "2000-01-15");
    expect(window.anchorResolution).toBe("nonexistent_shift_forward");
    expect(window.anchorAt).toBe("2000-01-15T10:00:00Z");
    expect(hours(window)).toBe(23);
  });

  it("refuses a local date the zone never had, and names the next one", () => {
    // Pacific/Apia jumped the date line at the end of 2011: there was no
    // 2011-12-30 at all. There is no defensible reading for a day that did not
    // happen, so the scheduler skips rather than approximating one.
    expect(resolveDailySkyWindow("Pacific/Apia", "2011-12-30")).toEqual({
      ok: false,
      reason: "skipped_local_date",
      nextRepresentableDate: "2011-12-31",
    });
  });

  it("leaves no gap and no overlap across a skipped date", () => {
    const before = ok("Pacific/Apia", "2011-12-29");
    const after = ok("Pacific/Apia", "2011-12-31");
    expect(before.dayEndAt).toBe(after.dayStartAt);
    expect(hours(before)).toBe(24);
    expect(hours(after)).toBe(24);
  });

  it("agrees with the incumbent V1 resolver on ordinary days", () => {
    // The two are allowed to be different implementations — V1 reads the
    // runtime's `Intl` database and V5 reads a pinned one — but a disagreement
    // on an ordinary day would mean one of them is wrong, not that they are
    // versioned differently.
    for (const [zone, date] of [
      ["America/Los_Angeles", "2026-07-30"],
      ["America/Los_Angeles", "2026-03-08"],
      ["America/Los_Angeles", "2026-11-01"],
      ["Asia/Kathmandu", "2026-07-30"],
      ["Pacific/Chatham", "2026-01-30"],
      ["Australia/Lord_Howe", "2026-04-05"],
    ] as const) {
      const v1 = localDayWindow(zone, date);
      const v5 = ok(zone, date);
      expect({ start: v5.dayStartAt, end: v5.dayEndAt }).toEqual({
        start: v1.dayStartAt,
        end: v1.dayEndAt,
      });
    }
  });

  it("rejects a malformed or impossible calendar date", () => {
    expect(() => resolveDailySkyWindow("UTC", "2026-13-01")).toThrow(LocalDayError);
    expect(() => resolveDailySkyWindow("UTC", "2026-02-30")).toThrow(LocalDayError);
    expect(() => resolveDailySkyWindow("Not/AZone", "2026-07-30")).toThrow(LocalDayError);
  });
});
