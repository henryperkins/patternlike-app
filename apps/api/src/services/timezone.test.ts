import { describe, expect, it } from "vitest";
import { resolveTimezone, zoneFromCoordinates } from "./timezone.js";

describe("zoneFromCoordinates", () => {
  it("resolves well-known places", () => {
    expect(zoneFromCoordinates(34.0522, -118.2437)?.timezone).toBe("America/Los_Angeles");
    expect(zoneFromCoordinates(40.7128, -74.006)?.timezone).toBe("America/New_York");
    expect(zoneFromCoordinates(51.5072, -0.1276)?.timezone).toBe("Europe/London");
    expect(zoneFromCoordinates(-33.8688, 151.2093)?.timezone).toBe("Australia/Sydney");
    expect(zoneFromCoordinates(35.6762, 139.6503)?.timezone).toBe("Asia/Tokyo");
  });

  it("does not flag a boundary in the middle of a zone", () => {
    expect(zoneFromCoordinates(34.0522, -118.2437)?.boundaryNearby).toBe(false);
  });

  /**
   * A raster lookup is exact in the middle of a zone and can land on the wrong
   * side within a few kilometres of a border. Wendover straddles the Nevada /
   * Utah line, which is also the Pacific / Mountain line.
   */
  it("flags a birthplace sitting on a timezone boundary", () => {
    const wendover = zoneFromCoordinates(40.7377, -114.0372);
    expect(wendover).not.toBeNull();
    expect(wendover?.boundaryNearby).toBe(true);
  });

  it("survives coordinates at the poles and across the antimeridian", () => {
    // The probe steps east and west; at latitude 89 a tenth of a degree of
    // longitude is metres, so the step has to widen or every polar coordinate
    // would look like it was nowhere near a boundary.
    expect(() => zoneFromCoordinates(89.9, 0)).not.toThrow();
    expect(() => zoneFromCoordinates(-89.9, 179.99)).not.toThrow();
    expect(() => zoneFromCoordinates(0, -179.99)).not.toThrow();
  });

  it("returns null rather than throwing on unusable coordinates", () => {
    expect(zoneFromCoordinates(Number.NaN, 0)).toBeNull();
    expect(zoneFromCoordinates(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("resolveTimezone", () => {
  it("prefers the birthplace over the client's hint", () => {
    const resolved = resolveTimezone({
      latitude: 34.0522,
      longitude: -118.2437,
      birthDate: "1990-05-15",
      birthTimeLocal: "12:34:00",
      // What a browser in London reports for someone born in Los Angeles.
      timezoneHint: "Europe/London",
    });

    expect(resolved.timezone).toBe("America/Los_Angeles");
    expect(resolved.source).toBe("coordinates");
    expect(resolved.hintOverridden).toBe("Europe/London");
    expect(resolved.confidence).toBe("high");
    expect(resolved.local?.utc_instant).toBe("1990-05-15T19:34:00.000Z");
    expect(resolved.local?.utc_offset_label).toBe("UTC-07:00");
    expect(resolved.qualifiers.map((q) => q.code)).toContain("hint_replaced");
  });

  it("says nothing about a hint that already agrees with the coordinates", () => {
    const resolved = resolveTimezone({
      latitude: 34.0522,
      longitude: -118.2437,
      birthDate: "1990-05-15",
      birthTimeLocal: "12:34:00",
      timezoneHint: "America/Los_Angeles",
    });

    expect(resolved.hintOverridden).toBeNull();
    expect(resolved.qualifiers).toEqual([]);
  });

  it("falls back to the hint when there are no coordinates, and grades it as unverified", () => {
    const resolved = resolveTimezone({
      birthDate: "1990-05-15",
      birthTimeLocal: "12:34:00",
      timezoneHint: "America/Los_Angeles",
    });

    expect(resolved.timezone).toBe("America/Los_Angeles");
    expect(resolved.source).toBe("hint");
    expect(resolved.confidence).toBe("none");
    expect(resolved.qualifiers.map((q) => q.code)).toContain("no_coordinates");
  });

  it("falls back to UTC when there is neither a place nor a usable hint", () => {
    const resolved = resolveTimezone({ birthDate: "1990-05-15", timezoneHint: "Nowhere/Real" });

    expect(resolved.timezone).toBe("UTC");
    expect(resolved.source).toBe("default");
    expect(resolved.confidence).toBe("none");
  });

  it("qualifies a birth from before tzdb guarantees the zone matches the place", () => {
    const resolved = resolveTimezone({
      latitude: 40.7128,
      longitude: -74.006,
      birthDate: "1952-03-04",
      birthTimeLocal: "09:00:00",
    });

    expect(resolved.timezone).toBe("America/New_York");
    expect(resolved.confidence).toBe("medium");
    expect(resolved.qualifiers.map((q) => q.code)).toContain("pre_1970_zone_boundary");
  });

  it("drops to low confidence when a pre-1970 birth is also near a boundary", () => {
    const resolved = resolveTimezone({
      latitude: 40.7377,
      longitude: -114.0372,
      birthDate: "1952-03-04",
      birthTimeLocal: "09:00:00",
    });

    expect(resolved.confidence).toBe("low");
    expect(resolved.qualifiers.map((q) => q.code)).toEqual(
      expect.arrayContaining(["near_zone_boundary", "pre_1970_zone_boundary"]),
    );
  });

  /**
   * The 1973 oil embargo kept the United States on daylight time through the
   * winter. Anything reading present-day rules answers UTC-05:00 and puts the
   * chart an hour out — this is the whole reason the lookup is historical.
   */
  it("uses the rules in force on the birth date, not today's", () => {
    const resolved = resolveTimezone({
      latitude: 40.7128,
      longitude: -74.006,
      birthDate: "1974-01-10",
      birthTimeLocal: "06:00:00",
    });

    expect(resolved.local?.utc_offset_label).toBe("UTC-04:00");
    expect(resolved.local?.utc_instant).toBe("1974-01-10T10:00:00.000Z");
  });

  it("reports a birth time the clock ran through twice", () => {
    const resolved = resolveTimezone({
      latitude: 40.7128,
      longitude: -74.006,
      birthDate: "2023-11-05",
      birthTimeLocal: "01:30:00",
    });

    expect(resolved.local?.resolution).toBe("ambiguous");
    expect(resolved.qualifiers.map((q) => q.code)).toContain("local_time_ambiguous");
  });

  it("reports a birth time the clock skipped", () => {
    const resolved = resolveTimezone({
      latitude: 40.7128,
      longitude: -74.006,
      birthDate: "2023-03-12",
      birthTimeLocal: "02:30:00",
    });

    expect(resolved.local?.resolution).toBe("nonexistent");
    expect(resolved.qualifiers.map((q) => q.code)).toContain("local_time_nonexistent");
  });

  it("flags coordinates that land in open water", () => {
    // Mid-Atlantic: a swapped latitude and longitude, or a dropped minus sign.
    const resolved = resolveTimezone({
      latitude: 30,
      longitude: -40,
      birthDate: "1990-05-15",
      birthTimeLocal: "12:34:00",
    });

    expect(resolved.qualifiers.map((q) => q.code)).toContain("nautical_zone");
  });

  it("resolves the zone without a birth date, and offers no offset for one", () => {
    const resolved = resolveTimezone({ latitude: 34.0522, longitude: -118.2437 });

    expect(resolved.timezone).toBe("America/Los_Angeles");
    expect(resolved.local).toBeNull();
    // No date means no year to compare against 1970, so the grade is the
    // boundary result alone rather than a guess.
    expect(resolved.confidence).toBe("high");
  });
});
