import { describe, expect, it } from "vitest";
import {
  TZDB_DATA_VERSION,
  hasZone,
  pinnedLocalDate,
  zoneOffsetMillisEast,
  zoneOffsetMinutesWest,
} from "./tzdb.js";

/**
 * Offsets taken from moment-timezone itself, running in Node, at the version
 * `package-lock.json` pins.
 *
 * `tzdb.ts` reimplements moment-timezone's packed format because its runtime is
 * a UMD file inside a CommonJS package that the Workers test pool refuses to
 * load. That is a reasonable trade only while the reimplementation is pinned
 * against the thing it replaces, so these vectors are the pin: twenty zones
 * across fourteen instants, deliberately including pre-1900 local mean times
 * (fractional minutes), a mid-day transition, a date-line jump, and both
 * quarter-hour and three-quarter-hour offsets.
 *
 * Format is `zone|instant|minutesWestOfUtc`, in moment-timezone's own sign
 * convention so a row can be compared against the library without a mental flip.
 */
const VECTORS = `
UTC|1883-11-18T18:00:00Z|0
UTC|1900-01-01T00:00:00Z|0
UTC|1945-06-01T00:00:00Z|0
UTC|1969-12-31T23:59:59Z|0
UTC|1970-01-01T00:00:00Z|0
UTC|2000-01-15T09:00:00Z|0
UTC|2000-01-15T11:00:00Z|0
UTC|2011-12-30T09:00:00Z|0
UTC|2011-12-30T11:00:00Z|0
UTC|2026-01-15T12:00:00Z|0
UTC|2026-03-08T10:00:00Z|0
UTC|2026-07-30T19:00:00Z|0
UTC|2026-11-01T09:00:00Z|0
UTC|2040-06-01T00:00:00Z|0
America/Los_Angeles|1883-11-18T18:00:00Z|472.96666666666664
America/Los_Angeles|1900-01-01T00:00:00Z|480
America/Los_Angeles|1945-06-01T00:00:00Z|420
America/Los_Angeles|1969-12-31T23:59:59Z|480
America/Los_Angeles|1970-01-01T00:00:00Z|480
America/Los_Angeles|2000-01-15T09:00:00Z|480
America/Los_Angeles|2000-01-15T11:00:00Z|480
America/Los_Angeles|2011-12-30T09:00:00Z|480
America/Los_Angeles|2011-12-30T11:00:00Z|480
America/Los_Angeles|2026-01-15T12:00:00Z|480
America/Los_Angeles|2026-03-08T10:00:00Z|420
America/Los_Angeles|2026-07-30T19:00:00Z|420
America/Los_Angeles|2026-11-01T09:00:00Z|480
America/Los_Angeles|2040-06-01T00:00:00Z|420
America/Chicago|1883-11-18T18:00:00Z|360
America/Chicago|1900-01-01T00:00:00Z|360
America/Chicago|1945-06-01T00:00:00Z|300
America/Chicago|1969-12-31T23:59:59Z|360
America/Chicago|1970-01-01T00:00:00Z|360
America/Chicago|2000-01-15T09:00:00Z|360
America/Chicago|2000-01-15T11:00:00Z|360
America/Chicago|2011-12-30T09:00:00Z|360
America/Chicago|2011-12-30T11:00:00Z|360
America/Chicago|2026-01-15T12:00:00Z|360
America/Chicago|2026-03-08T10:00:00Z|300
America/Chicago|2026-07-30T19:00:00Z|300
America/Chicago|2026-11-01T09:00:00Z|360
America/Chicago|2040-06-01T00:00:00Z|300
America/New_York|1883-11-18T18:00:00Z|300
America/New_York|1900-01-01T00:00:00Z|300
America/New_York|1945-06-01T00:00:00Z|240
America/New_York|1969-12-31T23:59:59Z|300
America/New_York|1970-01-01T00:00:00Z|300
America/New_York|2000-01-15T09:00:00Z|300
America/New_York|2000-01-15T11:00:00Z|300
America/New_York|2011-12-30T09:00:00Z|300
America/New_York|2011-12-30T11:00:00Z|300
America/New_York|2026-01-15T12:00:00Z|300
America/New_York|2026-03-08T10:00:00Z|240
America/New_York|2026-07-30T19:00:00Z|240
America/New_York|2026-11-01T09:00:00Z|300
America/New_York|2040-06-01T00:00:00Z|240
Europe/London|1883-11-18T18:00:00Z|0
Europe/London|1900-01-01T00:00:00Z|0
Europe/London|1945-06-01T00:00:00Z|-120
Europe/London|1969-12-31T23:59:59Z|-60
Europe/London|1970-01-01T00:00:00Z|-60
Europe/London|2000-01-15T09:00:00Z|0
Europe/London|2000-01-15T11:00:00Z|0
Europe/London|2011-12-30T09:00:00Z|0
Europe/London|2011-12-30T11:00:00Z|0
Europe/London|2026-01-15T12:00:00Z|0
Europe/London|2026-03-08T10:00:00Z|0
Europe/London|2026-07-30T19:00:00Z|-60
Europe/London|2026-11-01T09:00:00Z|0
Europe/London|2040-06-01T00:00:00Z|-60
Europe/Berlin|1883-11-18T18:00:00Z|-53.46666666666667
Europe/Berlin|1900-01-01T00:00:00Z|-60
Europe/Berlin|1945-06-01T00:00:00Z|-180
Europe/Berlin|1969-12-31T23:59:59Z|-60
Europe/Berlin|1970-01-01T00:00:00Z|-60
Europe/Berlin|2000-01-15T09:00:00Z|-60
Europe/Berlin|2000-01-15T11:00:00Z|-60
Europe/Berlin|2011-12-30T09:00:00Z|-60
Europe/Berlin|2011-12-30T11:00:00Z|-60
Europe/Berlin|2026-01-15T12:00:00Z|-60
Europe/Berlin|2026-03-08T10:00:00Z|-60
Europe/Berlin|2026-07-30T19:00:00Z|-120
Europe/Berlin|2026-11-01T09:00:00Z|-60
Europe/Berlin|2040-06-01T00:00:00Z|-120
Europe/Lisbon|1883-11-18T18:00:00Z|36.75
Europe/Lisbon|1900-01-01T00:00:00Z|36.75
Europe/Lisbon|1945-06-01T00:00:00Z|-120
Europe/Lisbon|1969-12-31T23:59:59Z|-60
Europe/Lisbon|1970-01-01T00:00:00Z|-60
Europe/Lisbon|2000-01-15T09:00:00Z|0
Europe/Lisbon|2000-01-15T11:00:00Z|0
Europe/Lisbon|2011-12-30T09:00:00Z|0
Europe/Lisbon|2011-12-30T11:00:00Z|0
Europe/Lisbon|2026-01-15T12:00:00Z|0
Europe/Lisbon|2026-03-08T10:00:00Z|0
Europe/Lisbon|2026-07-30T19:00:00Z|-60
Europe/Lisbon|2026-11-01T09:00:00Z|0
Europe/Lisbon|2040-06-01T00:00:00Z|-60
Africa/Khartoum|1883-11-18T18:00:00Z|-130.13333333333333
Africa/Khartoum|1900-01-01T00:00:00Z|-130.13333333333333
Africa/Khartoum|1945-06-01T00:00:00Z|-120
Africa/Khartoum|1969-12-31T23:59:59Z|-120
Africa/Khartoum|1970-01-01T00:00:00Z|-120
Africa/Khartoum|2000-01-15T09:00:00Z|-120
Africa/Khartoum|2000-01-15T11:00:00Z|-180
Africa/Khartoum|2011-12-30T09:00:00Z|-180
Africa/Khartoum|2011-12-30T11:00:00Z|-180
Africa/Khartoum|2026-01-15T12:00:00Z|-120
Africa/Khartoum|2026-03-08T10:00:00Z|-120
Africa/Khartoum|2026-07-30T19:00:00Z|-120
Africa/Khartoum|2026-11-01T09:00:00Z|-120
Africa/Khartoum|2040-06-01T00:00:00Z|-120
Asia/Kathmandu|1883-11-18T18:00:00Z|-341.26666666666665
Asia/Kathmandu|1900-01-01T00:00:00Z|-341.26666666666665
Asia/Kathmandu|1945-06-01T00:00:00Z|-330
Asia/Kathmandu|1969-12-31T23:59:59Z|-330
Asia/Kathmandu|1970-01-01T00:00:00Z|-330
Asia/Kathmandu|2000-01-15T09:00:00Z|-345
Asia/Kathmandu|2000-01-15T11:00:00Z|-345
Asia/Kathmandu|2011-12-30T09:00:00Z|-345
Asia/Kathmandu|2011-12-30T11:00:00Z|-345
Asia/Kathmandu|2026-01-15T12:00:00Z|-345
Asia/Kathmandu|2026-03-08T10:00:00Z|-345
Asia/Kathmandu|2026-07-30T19:00:00Z|-345
Asia/Kathmandu|2026-11-01T09:00:00Z|-345
Asia/Kathmandu|2040-06-01T00:00:00Z|-345
Asia/Kolkata|1883-11-18T18:00:00Z|-321.1666666666667
Asia/Kolkata|1900-01-01T00:00:00Z|-321.1666666666667
Asia/Kolkata|1945-06-01T00:00:00Z|-390
Asia/Kolkata|1969-12-31T23:59:59Z|-330
Asia/Kolkata|1970-01-01T00:00:00Z|-330
Asia/Kolkata|2000-01-15T09:00:00Z|-330
Asia/Kolkata|2000-01-15T11:00:00Z|-330
Asia/Kolkata|2011-12-30T09:00:00Z|-330
Asia/Kolkata|2011-12-30T11:00:00Z|-330
Asia/Kolkata|2026-01-15T12:00:00Z|-330
Asia/Kolkata|2026-03-08T10:00:00Z|-330
Asia/Kolkata|2026-07-30T19:00:00Z|-330
Asia/Kolkata|2026-11-01T09:00:00Z|-330
Asia/Kolkata|2040-06-01T00:00:00Z|-330
Asia/Tokyo|1883-11-18T18:00:00Z|-558.9833333333333
Asia/Tokyo|1900-01-01T00:00:00Z|-540
Asia/Tokyo|1945-06-01T00:00:00Z|-540
Asia/Tokyo|1969-12-31T23:59:59Z|-540
Asia/Tokyo|1970-01-01T00:00:00Z|-540
Asia/Tokyo|2000-01-15T09:00:00Z|-540
Asia/Tokyo|2000-01-15T11:00:00Z|-540
Asia/Tokyo|2011-12-30T09:00:00Z|-540
Asia/Tokyo|2011-12-30T11:00:00Z|-540
Asia/Tokyo|2026-01-15T12:00:00Z|-540
Asia/Tokyo|2026-03-08T10:00:00Z|-540
Asia/Tokyo|2026-07-30T19:00:00Z|-540
Asia/Tokyo|2026-11-01T09:00:00Z|-540
Asia/Tokyo|2040-06-01T00:00:00Z|-540
Australia/Lord_Howe|1883-11-18T18:00:00Z|-636.3333333333334
Australia/Lord_Howe|1900-01-01T00:00:00Z|-600
Australia/Lord_Howe|1945-06-01T00:00:00Z|-600
Australia/Lord_Howe|1969-12-31T23:59:59Z|-600
Australia/Lord_Howe|1970-01-01T00:00:00Z|-600
Australia/Lord_Howe|2000-01-15T09:00:00Z|-660
Australia/Lord_Howe|2000-01-15T11:00:00Z|-660
Australia/Lord_Howe|2011-12-30T09:00:00Z|-660
Australia/Lord_Howe|2011-12-30T11:00:00Z|-660
Australia/Lord_Howe|2026-01-15T12:00:00Z|-660
Australia/Lord_Howe|2026-03-08T10:00:00Z|-660
Australia/Lord_Howe|2026-07-30T19:00:00Z|-630
Australia/Lord_Howe|2026-11-01T09:00:00Z|-660
Australia/Lord_Howe|2040-06-01T00:00:00Z|-630
Pacific/Chatham|1883-11-18T18:00:00Z|-735
Pacific/Chatham|1900-01-01T00:00:00Z|-735
Pacific/Chatham|1945-06-01T00:00:00Z|-735
Pacific/Chatham|1969-12-31T23:59:59Z|-765
Pacific/Chatham|1970-01-01T00:00:00Z|-765
Pacific/Chatham|2000-01-15T09:00:00Z|-825
Pacific/Chatham|2000-01-15T11:00:00Z|-825
Pacific/Chatham|2011-12-30T09:00:00Z|-825
Pacific/Chatham|2011-12-30T11:00:00Z|-825
Pacific/Chatham|2026-01-15T12:00:00Z|-825
Pacific/Chatham|2026-03-08T10:00:00Z|-825
Pacific/Chatham|2026-07-30T19:00:00Z|-765
Pacific/Chatham|2026-11-01T09:00:00Z|-825
Pacific/Chatham|2040-06-01T00:00:00Z|-765
Pacific/Apia|1883-11-18T18:00:00Z|-753.0666666666667
Pacific/Apia|1900-01-01T00:00:00Z|686.9333333333333
Pacific/Apia|1945-06-01T00:00:00Z|690
Pacific/Apia|1969-12-31T23:59:59Z|660
Pacific/Apia|1970-01-01T00:00:00Z|660
Pacific/Apia|2000-01-15T09:00:00Z|660
Pacific/Apia|2000-01-15T11:00:00Z|660
Pacific/Apia|2011-12-30T09:00:00Z|600
Pacific/Apia|2011-12-30T11:00:00Z|-840
Pacific/Apia|2026-01-15T12:00:00Z|-780
Pacific/Apia|2026-03-08T10:00:00Z|-780
Pacific/Apia|2026-07-30T19:00:00Z|-780
Pacific/Apia|2026-11-01T09:00:00Z|-780
Pacific/Apia|2040-06-01T00:00:00Z|-780
Pacific/Kiritimati|1883-11-18T18:00:00Z|629.3333333333334
Pacific/Kiritimati|1900-01-01T00:00:00Z|629.3333333333334
Pacific/Kiritimati|1945-06-01T00:00:00Z|640
Pacific/Kiritimati|1969-12-31T23:59:59Z|640
Pacific/Kiritimati|1970-01-01T00:00:00Z|640
Pacific/Kiritimati|2000-01-15T09:00:00Z|-840
Pacific/Kiritimati|2000-01-15T11:00:00Z|-840
Pacific/Kiritimati|2011-12-30T09:00:00Z|-840
Pacific/Kiritimati|2011-12-30T11:00:00Z|-840
Pacific/Kiritimati|2026-01-15T12:00:00Z|-840
Pacific/Kiritimati|2026-03-08T10:00:00Z|-840
Pacific/Kiritimati|2026-07-30T19:00:00Z|-840
Pacific/Kiritimati|2026-11-01T09:00:00Z|-840
Pacific/Kiritimati|2040-06-01T00:00:00Z|-840
America/Sao_Paulo|1883-11-18T18:00:00Z|186.46666666666667
America/Sao_Paulo|1900-01-01T00:00:00Z|186.46666666666667
America/Sao_Paulo|1945-06-01T00:00:00Z|180
America/Sao_Paulo|1969-12-31T23:59:59Z|180
America/Sao_Paulo|1970-01-01T00:00:00Z|180
America/Sao_Paulo|2000-01-15T09:00:00Z|120
America/Sao_Paulo|2000-01-15T11:00:00Z|120
America/Sao_Paulo|2011-12-30T09:00:00Z|120
America/Sao_Paulo|2011-12-30T11:00:00Z|120
America/Sao_Paulo|2026-01-15T12:00:00Z|180
America/Sao_Paulo|2026-03-08T10:00:00Z|180
America/Sao_Paulo|2026-07-30T19:00:00Z|180
America/Sao_Paulo|2026-11-01T09:00:00Z|180
America/Sao_Paulo|2040-06-01T00:00:00Z|180
Asia/Tehran|1883-11-18T18:00:00Z|-205.73333333333332
Asia/Tehran|1900-01-01T00:00:00Z|-205.73333333333332
Asia/Tehran|1945-06-01T00:00:00Z|-210
Asia/Tehran|1969-12-31T23:59:59Z|-210
Asia/Tehran|1970-01-01T00:00:00Z|-210
Asia/Tehran|2000-01-15T09:00:00Z|-210
Asia/Tehran|2000-01-15T11:00:00Z|-210
Asia/Tehran|2011-12-30T09:00:00Z|-210
Asia/Tehran|2011-12-30T11:00:00Z|-210
Asia/Tehran|2026-01-15T12:00:00Z|-210
Asia/Tehran|2026-03-08T10:00:00Z|-210
Asia/Tehran|2026-07-30T19:00:00Z|-210
Asia/Tehran|2026-11-01T09:00:00Z|-210
Asia/Tehran|2040-06-01T00:00:00Z|-210
America/St_Johns|1883-11-18T18:00:00Z|210.86666666666667
America/St_Johns|1900-01-01T00:00:00Z|210.86666666666667
America/St_Johns|1945-06-01T00:00:00Z|150
America/St_Johns|1969-12-31T23:59:59Z|210
America/St_Johns|1970-01-01T00:00:00Z|210
America/St_Johns|2000-01-15T09:00:00Z|210
America/St_Johns|2000-01-15T11:00:00Z|210
America/St_Johns|2011-12-30T09:00:00Z|210
America/St_Johns|2011-12-30T11:00:00Z|210
America/St_Johns|2026-01-15T12:00:00Z|210
America/St_Johns|2026-03-08T10:00:00Z|150
America/St_Johns|2026-07-30T19:00:00Z|150
America/St_Johns|2026-11-01T09:00:00Z|210
America/St_Johns|2040-06-01T00:00:00Z|150
Antarctica/Troll|1883-11-18T18:00:00Z|0
Antarctica/Troll|1900-01-01T00:00:00Z|0
Antarctica/Troll|1945-06-01T00:00:00Z|0
Antarctica/Troll|1969-12-31T23:59:59Z|0
Antarctica/Troll|1970-01-01T00:00:00Z|0
Antarctica/Troll|2000-01-15T09:00:00Z|0
Antarctica/Troll|2000-01-15T11:00:00Z|0
Antarctica/Troll|2011-12-30T09:00:00Z|0
Antarctica/Troll|2011-12-30T11:00:00Z|0
Antarctica/Troll|2026-01-15T12:00:00Z|0
Antarctica/Troll|2026-03-08T10:00:00Z|0
Antarctica/Troll|2026-07-30T19:00:00Z|-120
Antarctica/Troll|2026-11-01T09:00:00Z|0
Antarctica/Troll|2040-06-01T00:00:00Z|-120
Asia/Shanghai|1883-11-18T18:00:00Z|-485.71666666666664
Asia/Shanghai|1900-01-01T00:00:00Z|-485.71666666666664
Asia/Shanghai|1945-06-01T00:00:00Z|-540
Asia/Shanghai|1969-12-31T23:59:59Z|-480
Asia/Shanghai|1970-01-01T00:00:00Z|-480
Asia/Shanghai|2000-01-15T09:00:00Z|-480
Asia/Shanghai|2000-01-15T11:00:00Z|-480
Asia/Shanghai|2011-12-30T09:00:00Z|-480
Asia/Shanghai|2011-12-30T11:00:00Z|-480
Asia/Shanghai|2026-01-15T12:00:00Z|-480
Asia/Shanghai|2026-03-08T10:00:00Z|-480
Asia/Shanghai|2026-07-30T19:00:00Z|-480
Asia/Shanghai|2026-11-01T09:00:00Z|-480
Asia/Shanghai|2040-06-01T00:00:00Z|-480
`
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const [zone, instant, offset] = line.split("|");
    return { zone: zone!, instant: instant!, offsetWest: Number(offset) };
  });

describe("tzdb", () => {
  it("pins the exact database version every V5 day was resolved against", () => {
    expect(TZDB_DATA_VERSION).toBe("2026c");
  });

  it("reproduces moment-timezone's offsets, fractional minutes included", () => {
    expect(VECTORS).toHaveLength(280);
    for (const { zone, instant, offsetWest } of VECTORS) {
      expect(zoneOffsetMinutesWest(zone, Date.parse(instant))).toBeCloseTo(offsetWest, 9);
    }
  });

  it("reports offsets east of UTC in milliseconds for arithmetic", () => {
    // Kathmandu is UTC+05:45, which is where a whole-hour assumption breaks.
    expect(zoneOffsetMillisEast("Asia/Kathmandu", Date.parse("2026-07-30T06:15:00Z"))).toBe(
      345 * 60_000,
    );
    expect(zoneOffsetMillisEast("America/Los_Angeles", Date.parse("2026-07-30T19:00:00Z"))).toBe(
      -420 * 60_000,
    );
  });

  it("resolves link aliases to their target zone", () => {
    // Links are the tz database's own aliases. A resolver that only knew
    // canonical zones would reject a stored preference nobody typed wrongly.
    expect(hasZone("Asia/Calcutta")).toBe(true);
    expect(zoneOffsetMinutesWest("Asia/Calcutta", Date.parse("2026-07-30T00:00:00Z"))).toBe(
      zoneOffsetMinutesWest("Asia/Kolkata", Date.parse("2026-07-30T00:00:00Z")),
    );
    expect(hasZone("US/Pacific")).toBe(true);
    expect(hasZone("Not/AZone")).toBe(false);
    expect(() => zoneOffsetMinutesWest("Not/AZone", 0)).toThrow(/unknown IANA zone/);
  });

  it("derives the local civil date from the same table that resolved the offset", () => {
    // Reading the date from `Intl` instead would mean an anchor and the date it
    // is checked against could come from two different databases.
    expect(pinnedLocalDate("America/Los_Angeles", Date.parse("2026-07-31T06:59:59Z"))).toBe(
      "2026-07-30",
    );
    expect(pinnedLocalDate("America/Los_Angeles", Date.parse("2026-07-31T07:00:00Z"))).toBe(
      "2026-07-31",
    );
    expect(pinnedLocalDate("Pacific/Kiritimati", Date.parse("2026-07-30T12:00:00Z"))).toBe(
      "2026-07-31",
    );
    // Apia crossed the date line at the end of 2011: 2011-12-30 never existed.
    expect(pinnedLocalDate("Pacific/Apia", Date.parse("2011-12-30T09:59:59Z"))).toBe("2011-12-29");
    expect(pinnedLocalDate("Pacific/Apia", Date.parse("2011-12-30T10:00:00Z"))).toBe("2011-12-31");
  });
});
