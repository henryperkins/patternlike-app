import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateChart, resolveUtcInstant } from "./engine.js";
import type { CalcRequest } from "@patternlike/shared";

function req(overrides: Partial<CalcRequest> = {}): CalcRequest {
  return {
    request_id: "val_1",
    user_id: "usr_validation_0001",
    profile_version: 1,
    accuracy: "exact",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    timezone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    place_label: "Los Angeles, CA, US",
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

describe("calculation input validation", () => {
  it("rejects calendar dates that do not exist", async () => {
    for (const birth_date of ["2023-02-30", "2023-02-29", "2023-13-01", "2023-00-10"]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${birth_date} should not produce a chart`);
      assert.equal(res.chart, null);
      assert.equal(res.error_class, "invalid_birth_profile", `${birth_date} error_class`);
    }
  });

  it("accepts a real leap day", async () => {
    const res = await calculateChart(req({ birth_date: "2024-02-29" }));
    assert.equal(res.ok, true);
    assert.ok(res.chart);
  });

  it("rejects malformed date strings instead of coercing them", async () => {
    for (const birth_date of ["1990-5-15", "15/05/1990", "1990-05-15T12:00:00Z", ""]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${JSON.stringify(birth_date)} should be rejected`);
    }
  });

  it("rejects an unknown IANA zone instead of silently computing in UTC", async () => {
    const res = await calculateChart(req({ timezone: "Mars/Olympus" }));
    assert.equal(res.ok, false);
    assert.equal(res.error_class, "invalid_birth_profile");
    assert.match(res.error_message ?? "", /timezone/i);
  });

  it("rejects malformed or out-of-range local times", async () => {
    for (const birth_time_local of ["25:00", "12:60:00", "noon", "12"]) {
      const res = await calculateChart(req({ birth_time_local }));
      assert.equal(res.ok, false, `${birth_time_local} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
    }
  });

  it("rejects coordinates outside the valid range or of the wrong type", async () => {
    const bad: Array<Partial<CalcRequest>> = [
      { latitude: 999 },
      { latitude: -91 },
      { longitude: 181 },
      { longitude: -180.5 },
      { latitude: Number.POSITIVE_INFINITY },
      { latitude: "34.05" as unknown as number },
      { longitude: "-118.24" as unknown as number },
    ];
    for (const patch of bad) {
      const res = await calculateChart(req(patch));
      assert.equal(res.ok, false, `${JSON.stringify(patch)} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
    }
  });

  it("rejects dates outside the pinned ephemeris range without leaking a filesystem path", async () => {
    for (const birth_date of ["1799-12-31", "2400-01-01"]) {
      const res = await calculateChart(req({ birth_date }));
      assert.equal(res.ok, false, `${birth_date} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
      const message = res.error_message ?? "";
      assert.ok(!/[A-Za-z]:\\|\/(home|Users|app)\//.test(message), `path leaked: ${message}`);
    }
  });

  it("never returns a chart containing a null longitude", async () => {
    const res = await calculateChart(req({ birth_date: "2023-02-30" }));
    assert.equal(res.chart, null);
  });

  it("does not poison Swiss Ephemeris for every subsequent request", async () => {
    // A NaN Julian day corrupts sweph's internal ephemeris file cache for the
    // life of the process: every later calc_ut then fails with
    // "error in ephemeris file ...semo_18.se1: 18 coefficients instead of 0".
    // In a long-lived calculation service one malformed birth date therefore
    // takes chart calculation down for every user until the process restarts.
    for (const birth_date of ["2023-02-30", "2023-02-29", "2023-13-01"]) {
      await calculateChart(req({ birth_date }));
    }
    const after = await calculateChart(req({ birth_date: "2024-02-29" }));
    assert.equal(after.ok, true, `process poisoned: ${after.error_message}`);
    const sun = after.chart?.positions.find((p) => p.body === "sun");
    assert.ok(sun, "sun position missing");
    assert.ok(
      Number.isFinite(sun.longitude_deg),
      `sun longitude not finite: ${sun.longitude_deg}`,
    );
  });

  it("resolveUtcInstant throws rather than falling back to UTC on a bad zone", () => {
    assert.throws(
      () => resolveUtcInstant(req({ timezone: "Mars/Olympus" })),
      /timezone/i,
    );
  });
});
