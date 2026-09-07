import { describe, expect, it } from "vitest";
import type { ChartResponse } from "./api-client.js";
import { createPortraitSky } from "./portrait-sky.js";

function chart(overrides: Partial<ChartResponse> = {}): ChartResponse {
  return {
    schema_version: "0.2.0", id: "chart-current", user_id: "private-user", profile_version: 1,
    fingerprint: "private-fingerprint", contract_id: "calc-contract-launch", contract_version: "0.2.0",
    container_digest: "private-container", tzdb_version: "2026a", calculated_at: "2026-09-06T12:00:00Z", status: "active",
    birth: { accuracy: "exact", utc_instant: null, timezone: null, place_label: null, latitude: null, longitude: null },
    positions: [
      { body: "sun", longitude_deg: 390, sign: "aries", house: 2, retrograde: false, latitude_deg: 0.1 },
      { body: "moon", longitude_deg: -15, sign: "aries", house: 12, retrograde: false, distance_au: 0.002 },
      { body: "ascendant", longitude_deg: 10, house: 1 },
      { body: "jupiter", longitude_deg: 90, house: 4 },
    ],
    angles: { ascendant_deg: 262.5, midheaven_deg: 172.5 },
    houses: { system_used: "placidus", fallback_applied: false, cusps_deg: [262.5] }, aspects: [],
    uncertainty: {
      accuracy: "exact", window: null, suppressed_features: [], qualified_features: [],
      user_facing_summary: "Calculated facts are available.",
    },
    ...overrides,
  };
}

describe("portrait sky projection", () => {
  it("projects only supported chart facts and derives sign and degree from normalized longitude", () => {
    const input = chart();
    input.uncertainty.window = { earliest_local: "private-local-time", latest_local: "private-latest-time" };
    const original = structuredClone(input);
    expect(createPortraitSky(input, input.id)).toEqual({
      chartId: "chart-current", uncertainty: "Calculated facts are available.", unavailable: {},
      placements: [
        { body: "sun", longitude: 30, sign: "taurus", degree: 0, house: 2 },
        { body: "moon", longitude: 345, sign: "pisces", degree: 15, house: 12 },
        { body: "ascendant", longitude: 262.5, sign: "sagittarius", degree: 22.5 },
      ],
    });
    expect(input).toEqual(original);
  });

  it.each(["superseded", "invalid"] as const)("rejects a %s chart", status => {
    expect(createPortraitSky(chart({ status }), "chart-current")).toBeNull();
  });

  it("rejects mismatched or empty chart identities", () => {
    expect(createPortraitSky(chart(), "another-chart")).toBeNull();
    expect(createPortraitSky(chart({ id: "" }), "")).toBeNull();
  });

  it("withholds Moon, rising and houses for unknown birth time even when numeric positions remain", () => {
    const input = chart();
    input.uncertainty.accuracy = "unknown";
    expect(createPortraitSky(input, input.id)).toMatchObject({
      placements: [{ body: "sun", longitude: 30, sign: "taurus", degree: 0 }],
      unavailable: { moon: "unknown_birth_time", ascendant: "unknown_birth_time" },
    });
  });

  it("withholds a time-sensitive Moon even when the chart reports exact accuracy", () => {
    const input = chart();
    input.uncertainty.suppressed_features = [{ feature_class: "moon_time_sensitive", reason: "unknown_birth_time" }];
    const sky = createPortraitSky(input, input.id)!;
    expect(sky.placements.map(position => position.body)).toEqual(["sun", "ascendant"]);
    expect(sky.unavailable).toEqual({ moon: "suppressed" });
  });

  it("withholds suppressed angles and house numbers while retaining ordinary planetary positions", () => {
    const input = chart();
    input.uncertainty.suppressed_features = [
      { feature_class: "angles", reason: "birthplace_unavailable" },
      { feature_class: "houses", reason: "birthplace_unavailable" },
    ];
    const sky = createPortraitSky(input, input.id)!;
    expect(sky.placements.map(position => position.body)).toEqual(["sun", "moon"]);
    expect(sky.placements.every(position => position.house === undefined)).toBe(true);
    expect(sky.unavailable).toEqual({ ascendant: "suppressed" });
  });

  it("requires actual angle and house calculations instead of reconstructing them from position fields", () => {
    const sky = createPortraitSky(chart({ angles: null, houses: null }), "chart-current")!;
    expect(sky.unavailable).toEqual({ ascendant: "missing" });
    expect(sky.placements.map(position => position.body)).toEqual(["sun", "moon"]);
    expect(sky.placements.every(position => position.house === undefined)).toBe(true);
  });

  it.each([0, 13, 1.5, Number.NaN])("omits invalid house number %s", house => {
    const input = chart(); input.positions[0].house = house;
    expect(createPortraitSky(input, input.id)!.placements[0]).not.toHaveProperty("house");
  });

  it("qualifies approximate placements and preserves the supplied uncertainty summary", () => {
    const input = chart();
    input.uncertainty = {
      accuracy: "approximate", window: { plus_minus_minutes: 30, earliest_local: "private-time" },
      suppressed_features: [], qualified_features: [{ feature_id: "moon", qualification: "low_confidence_moon" }, { feature_id: "houses", qualification: "approximate_only" }],
      user_facing_summary: "Birth time is approximate; affected placements are qualified.",
    };
    const sky = createPortraitSky(input, input.id)!;
    expect(sky.placements).toHaveLength(3);
    expect(sky.placements.every(position => /approximate/i.test(position.qualification ?? ""))).toBe(true);
    expect(sky.uncertainty).toBe(input.uncertainty.user_facing_summary);
    expect(JSON.stringify(sky)).not.toContain("private-time");
  });

  it("retains a Moon-specific confidence qualification even with exact chart accuracy", () => {
    const input = chart();
    input.uncertainty.qualified_features = [{ feature_id: "moon", qualification: "low_confidence_moon" }];
    const sky = createPortraitSky(input, input.id)!;
    expect(sky.placements.find(position => position.body === "moon")?.qualification).toMatch(/confidence|qualified/i);
    expect(sky.placements.find(position => position.body === "sun")?.qualification).toBeUndefined();
  });

  it("qualifies facts affected by unresolved civil-time conversion", () => {
    const input = chart();
    input.uncertainty.qualified_features = [{ feature_id: "birth_instant", qualification: "technique_specific" }];
    expect(createPortraitSky(input, input.id)!.placements.every(position => Boolean(position.qualification))).toBe(true);
  });

  it("omits nonfinite longitudes and never substitutes zero-degree placements", () => {
    const input = chart({ angles: { ascendant_deg: Number.NEGATIVE_INFINITY, midheaven_deg: 0 } });
    input.positions[0].longitude_deg = Number.NaN;
    input.positions[1].longitude_deg = Number.POSITIVE_INFINITY;
    expect(createPortraitSky(input, input.id)).toMatchObject({
      placements: [], unavailable: { sun: "missing", moon: "missing", ascendant: "missing" },
    });
  });

  it("keeps a genuine zero-degree Aries position and leaves absent bodies missing", () => {
    const input = chart({ positions: [{ body: "sun", longitude_deg: 0 }], angles: null });
    input.uncertainty.user_facing_summary = null;
    expect(createPortraitSky(input, input.id)).toEqual({
      chartId: input.id, placements: [{ body: "sun", longitude: 0, sign: "aries", degree: 0 }],
      unavailable: { moon: "missing", ascendant: "missing" },
    });
  });
});
