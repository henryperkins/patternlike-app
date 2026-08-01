import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateChart,
  goldenExactFixture,
  initSwissEphemeris,
  SE_VERSION,
  resolveUtcInstant,
} from "./engine.js";
import { resolveEphePath, assertEphePresent } from "./ephe-path.js";

describe("Swiss Ephemeris engine", () => {
  it("loads ephemeris data files", () => {
    const p = resolveEphePath();
    assertEphePresent(p);
    initSwissEphemeris(p);
  });

  it("produces stable fingerprint for fixed exact birth inputs", async () => {
    const a = await goldenExactFixture();
    const b = await goldenExactFixture();
    assert.equal(a.fingerprint, b.fingerprint);
    assert.equal(a.contract_id, "calc-contract-launch");
    assert.ok(a.houses);
    assert.ok(a.angles);
    assert.equal(a.uncertainty.accuracy, "exact");
    assert.ok(a.birth.utc_instant);
  });

  it("Sun is in Taurus for 1990-05-15 LA afternoon (~54° tropical)", async () => {
    const chart = await goldenExactFixture();
    const sun = chart.positions.find((p) => p.body === "sun");
    assert.ok(sun);
    // Cross-check: earlier direct sweph calc ≈ 54.70° for 19:34 UTC
    assert.ok(sun!.longitude_deg > 50 && sun!.longitude_deg < 60);
    assert.equal(sun!.sign, "taurus");
  });

  it("uses true node and includes outer planets", async () => {
    const chart = await goldenExactFixture();
    const ids = new Set(chart.positions.map((p) => p.body));
    for (const b of [
      "true_node",
      "uranus",
      "neptune",
      "pluto",
      "ascendant",
      "midheaven",
    ] as const) {
      assert.ok(ids.has(b), `missing ${b}`);
    }
  });

  it("unknown birth time suppresses houses/angles and never stores noon as utc_instant", async () => {
    const res = await calculateChart({
      request_id: "unk_1",
      user_id: "usr_unknown_time_0001",
      profile_version: 1,
      accuracy: "unknown",
      birth_date: "1990-05-15",
      birth_time_local: null,
      timezone: "America/Los_Angeles",
      latitude: 34.0522,
      longitude: -118.2437,
      place_label: "Los Angeles",
      contract_id: "calc-contract-launch",
      contract_version: "0.2.0",
    });
    assert.equal(res.ok, true);
    assert.ok(res.chart);
    assert.equal(res.chart!.houses, null);
    assert.equal(res.chart!.angles, null);
    assert.equal(res.chart!.birth.utc_instant, null);
    assert.ok(
      res.chart!.uncertainty.suppressed_features.some(
        (f: { feature_class: string }) => f.feature_class === "houses",
      ),
    );
    assert.ok(
      !res.chart!.positions.some(
        (p: { body: string }) => p.body === "ascendant",
      ),
    );
    // Planets still calculated (signs available)
    assert.ok(res.chart!.positions.some((p) => p.body === "sun"));
  });

  it("rejects exact accuracy without birth_date", async () => {
    const res = await calculateChart({
      request_id: "bad_1",
      user_id: "usr_bad_0001",
      profile_version: 1,
      accuracy: "exact",
      birth_date: null,
      birth_time_local: "12:00:00",
      timezone: "UTC",
      latitude: 0,
      longitude: 0,
      place_label: null,
      contract_id: "calc-contract-launch",
      contract_version: "0.2.0",
    });
    assert.equal(res.ok, false);
    assert.equal(res.error_class, "invalid_birth_profile");
  });

  it("resolves America/Los_Angeles to correct UTC offset for golden birth", () => {
    const utc = resolveUtcInstant({
      request_id: "tz",
      user_id: "u",
      profile_version: 1,
      accuracy: "exact",
      birth_date: "1990-05-15",
      birth_time_local: "12:34:00",
      timezone: "America/Los_Angeles",
      latitude: 34.05,
      longitude: -118.24,
      place_label: null,
      contract_id: "c",
      contract_version: "0.2.0",
    });
    // PDT = UTC-7 → 19:34 UTC
    assert.equal(utc.year, 1990);
    assert.equal(utc.month, 5);
    assert.equal(utc.day, 15);
    assert.ok(Math.abs(utc.hourDecimal - (19 + 34 / 60)) < 1e-6);
    assert.equal(utc.synthetic_local_noon, false);
  });

  it("reports Swiss Ephemeris version pin", () => {
    assert.equal(SE_VERSION, "2.10.03");
  });
});
