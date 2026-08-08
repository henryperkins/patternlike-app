import test from "node:test";
import assert from "node:assert/strict";
import {
  TZDB_STABLE_FROM_YEAR,
  formatUtcOffset,
  isValidIanaZone,
  parseCivilDateTime,
  resolveLocalWallTime,
  zoneOffsetMinutesAt,
} from "./timezone.js";

const civil = (
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
) => ({ year, month, day, hour, minute, second });

test("accepts IANA zone ids and rejects everything shaped like an offset", () => {
  assert.ok(isValidIanaZone("America/Los_Angeles"));
  assert.ok(isValidIanaZone("UTC"));
  assert.ok(isValidIanaZone("Etc/GMT+5"));
  assert.ok(isValidIanaZone("America/Argentina/Ushuaia"));

  // Intl accepts these; they are fixed offsets with no history, which is
  // exactly the thing a birth chart must not silently be calculated in.
  assert.equal(isValidIanaZone("+05:00"), false);
  assert.equal(isValidIanaZone("-07:00"), false);

  assert.equal(isValidIanaZone("Mars/Olympus_Mons"), false);
  assert.equal(isValidIanaZone(""), false);
  assert.equal(isValidIanaZone(null), false);
  assert.equal(isValidIanaZone(42), false);
});

test("reads the offset that was actually in force, not today's", () => {
  // Daylight time in Los Angeles, May 1990.
  assert.equal(
    zoneOffsetMinutesAt("America/Los_Angeles", Date.UTC(1990, 4, 15, 19, 34)),
    -420,
  );
  // Standard time in New York, November 1985 — DST ended on the 27th of October.
  assert.equal(
    zoneOffsetMinutesAt("America/New_York", Date.UTC(1985, 10, 2, 8, 15)),
    -300,
  );
});

/**
 * The case that makes this a *historical* lookup rather than a current one.
 * The 1973 oil embargo put the United States on daylight time through the
 * winter, so a January 1974 birth in New York is UTC-04:00. Anything reading
 * present-day rules — including the browser's own zone offset — answers -05:00
 * and puts the chart an hour out.
 */
test("honours one-off historical rule changes", () => {
  assert.equal(
    zoneOffsetMinutesAt("America/New_York", Date.UTC(1974, 0, 10, 17, 0)),
    -240,
  );
  assert.equal(
    zoneOffsetMinutesAt("America/New_York", Date.UTC(1973, 0, 10, 17, 0)),
    -300,
  );
});

test("resolves an ordinary wall time to exactly one instant", () => {
  const resolved = resolveLocalWallTime(
    "America/Los_Angeles",
    civil(1990, 5, 15, 12, 34, 0),
  );

  assert.equal(resolved.resolution, "unique");
  assert.equal(resolved.utc_instant, "1990-05-15T19:34:00.000Z");
  assert.equal(resolved.utc_offset_minutes, -420);
  assert.equal(resolved.utc_offset_label, "UTC-07:00");
  assert.equal(resolved.alternate_utc_instant, null);
});

test("reports a wall time the clock ran through twice", () => {
  // 2023-11-05 01:30 happened once on EDT and again an hour later on EST.
  const resolved = resolveLocalWallTime(
    "America/New_York",
    civil(2023, 11, 5, 1, 30, 0),
  );

  assert.equal(resolved.resolution, "ambiguous");
  assert.equal(resolved.utc_instant, "2023-11-05T05:30:00.000Z");
  assert.equal(resolved.utc_offset_minutes, -240);
  assert.equal(resolved.alternate_utc_instant, "2023-11-05T06:30:00.000Z");
  assert.equal(resolved.alternate_utc_offset_minutes, -300);
});

test("reports a wall time the clock skipped, shifting forward across the gap", () => {
  // 2023-03-12 02:30 never existed in New York; 02:00 EST became 03:00 EDT.
  const resolved = resolveLocalWallTime(
    "America/New_York",
    civil(2023, 3, 12, 2, 30, 0),
  );

  assert.equal(resolved.resolution, "nonexistent");
  assert.equal(resolved.utc_instant, "2023-03-12T07:30:00.000Z");
  assert.equal(resolved.utc_offset_minutes, -240);
});

/**
 * Samoa deleted 2011-12-30 outright when it jumped the date line. A gap that is
 * a whole day rather than an hour catches an implementation that assumes DST is
 * the only reason a wall time can be missing.
 */
test("handles a zone that skipped an entire day", () => {
  const resolved = resolveLocalWallTime("Pacific/Apia", civil(2011, 12, 30, 12, 0, 0));
  assert.equal(resolved.resolution, "nonexistent");
  assert.equal(resolved.utc_offset_minutes, 840);
});

test("resolves pre-1970 local mean time without rounding into the wrong minute", () => {
  // Los Angeles ran on local mean time, UTC-07:52:58, until 1883.
  const resolved = resolveLocalWallTime(
    "America/Los_Angeles",
    civil(1880, 6, 1, 12, 0, 0),
  );

  assert.equal(resolved.resolution, "unique");
  assert.equal(resolved.utc_offset_minutes, -473);
  // The instant itself keeps the seconds the rounded label cannot show.
  assert.equal(resolved.utc_instant, "1880-06-01T19:52:58.000Z");
});

test("formats offsets the way the onboarding form shows them", () => {
  assert.equal(formatUtcOffset(0), "UTC+00:00");
  assert.equal(formatUtcOffset(-420), "UTC-07:00");
  assert.equal(formatUtcOffset(330), "UTC+05:30");
  assert.equal(formatUtcOffset(-570), "UTC-09:30");
});

test("parses the birth profile wire format and refuses dates the calendar lacks", () => {
  assert.deepEqual(parseCivilDateTime("1990-05-15", "12:34:00"), {
    year: 1990,
    month: 5,
    day: 15,
    hour: 12,
    minute: 34,
    second: 0,
  });

  // No time means noon, matching the calculation service's unknown-time epoch.
  assert.deepEqual(parseCivilDateTime("1990-05-15", null), {
    year: 1990,
    month: 5,
    day: 15,
    hour: 12,
    minute: 0,
    second: 0,
  });

  assert.equal(parseCivilDateTime("2023-02-30", "12:00"), null);
  assert.equal(parseCivilDateTime("2023-13-01", "12:00"), null);
  assert.equal(parseCivilDateTime("15/05/1990", "12:00"), null);
  assert.equal(parseCivilDateTime("1990-05-15", "24:00"), null);
  assert.equal(parseCivilDateTime("1990-05-15", "noon"), null);
});

test("pins the year tzdb stops guaranteeing a zone matches its location", () => {
  assert.equal(TZDB_STABLE_FROM_YEAR, 1970);
});
