import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { resolveLocalWallTime, type CivilDateTime } from "@patternlike/shared";
import { resolveUtcInstant } from "./engine.js";
import type { CalcRequest } from "@patternlike/shared";

/**
 * The API resolves a birthplace to a zone and previews the offset for the
 * onboarding form using `@patternlike/shared`'s `Intl`-backed helpers, because
 * a Worker cannot load luxon's tz handling cheaply and has no ephemeris. This
 * service then calculates the chart with luxon.
 *
 * Two implementations of the same question is a bug waiting to happen: a user
 * confirms "UTC-08:00" in the form and gets a chart built an hour away from it.
 * These cases pin the two together on the edges where they could diverge —
 * daylight transitions, a skipped day, and pre-tzdb local mean time.
 */

interface Case {
  zone: string;
  civil: CivilDateTime;
  why: string;
}

const CASES: Case[] = [
  {
    zone: "America/Los_Angeles",
    civil: { year: 1990, month: 5, day: 15, hour: 12, minute: 34, second: 0 },
    why: "the golden fixture",
  },
  {
    zone: "America/New_York",
    civil: { year: 2023, month: 3, day: 12, hour: 2, minute: 30, second: 0 },
    why: "a wall time the spring-forward skipped",
  },
  {
    zone: "America/New_York",
    civil: { year: 2023, month: 11, day: 5, hour: 1, minute: 30, second: 0 },
    why: "a wall time the fall-back ran through twice",
  },
  {
    zone: "America/New_York",
    civil: { year: 1974, month: 1, day: 10, hour: 6, minute: 0, second: 0 },
    why: "the winter the United States stayed on daylight time",
  },
  {
    zone: "Europe/Lisbon",
    civil: { year: 1992, month: 9, day: 27, hour: 1, minute: 30, second: 0 },
    why: "a zone that changed its standard offset, not just its DST rule",
  },
  {
    zone: "Pacific/Apia",
    civil: { year: 2011, month: 12, day: 30, hour: 12, minute: 0, second: 0 },
    why: "the day Samoa deleted when it crossed the date line",
  },
  {
    zone: "Asia/Kolkata",
    civil: { year: 1985, month: 6, day: 1, hour: 8, minute: 15, second: 0 },
    why: "a half-hour offset",
  },
  {
    zone: "Australia/Lord_Howe",
    civil: { year: 2019, month: 10, day: 6, hour: 2, minute: 15, second: 0 },
    why: "the only zone whose DST shift is half an hour",
  },
  {
    zone: "America/Los_Angeles",
    civil: { year: 1880, month: 6, day: 1, hour: 12, minute: 0, second: 0 },
    why: "local mean time, which is not a whole number of minutes",
  },
  {
    zone: "Europe/Amsterdam",
    civil: { year: 1935, month: 3, day: 1, hour: 9, minute: 0, second: 0 },
    why: "Amsterdam Time, UTC+00:19:32",
  },
];

describe("timezone agreement between the API preview and this engine", () => {
  for (const { zone, civil, why } of CASES) {
    it(`agrees with luxon on ${zone}: ${why}`, () => {
      const shared = resolveLocalWallTime(zone, civil);
      const fromLuxon = DateTime.fromObject(
        {
          year: civil.year,
          month: civil.month,
          day: civil.day,
          hour: civil.hour,
          minute: civil.minute,
          second: civil.second,
        },
        { zone },
      );

      assert.ok(fromLuxon.isValid, `luxon rejected ${zone} ${JSON.stringify(civil)}`);
      assert.equal(shared.utc_instant, fromLuxon.toUTC().toISO(), why);
      // The instant is the fact; the offset is a label. Local mean times are not
      // whole minutes — Los Angeles was UTC-07:52:58 — and luxon reports the
      // fraction where the shared helper rounds for display.
      assert.equal(shared.utc_offset_minutes, Math.round(fromLuxon.offset), why);
    });
  }

  /**
   * The same agreement through the actual calculation entry point, so a future
   * change to `resolveUtcInstant` that stops going through luxon still has to
   * keep the preview honest.
   */
  it("agrees with the instant a chart is actually calculated from", () => {
    for (const { zone, civil, why } of CASES) {
      if (civil.year < 1800) continue;

      const request = {
        request_id: "tz_agreement",
        user_id: "usr_tz_agreement_0001",
        profile_version: 1,
        accuracy: "exact",
        birth_date: `${String(civil.year).padStart(4, "0")}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`,
        birth_time_local: `${String(civil.hour).padStart(2, "0")}:${String(civil.minute).padStart(2, "0")}:${String(civil.second).padStart(2, "0")}`,
        timezone: zone,
        latitude: null,
        longitude: null,
        place_label: null,
        contract_id: "calc-contract-launch",
        contract_version: "0.2.0",
      } satisfies CalcRequest;

      assert.equal(
        resolveLocalWallTime(zone, civil).utc_instant,
        resolveUtcInstant(request).iso,
        `${zone}: ${why}`,
      );
    }
  });
});
