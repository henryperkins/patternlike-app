import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EPHEMERIS_COVERAGE_MAX_JD,
  EPHEMERIS_COVERAGE_MIN_JD,
  SE_ID_BY_BODY,
  calcBody,
  calculateChart,
  resolveUtcInstant,
} from "./engine.js";
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

  it("rejects an in-range local date whose UT instant the files cannot answer", async () => {
    // Each of these carries a local year inside 1800-2399, so the year test in
    // resolveUtcInstant passes them. The instant that reaches swe_calc_ut does
    // not: 1800-01-01 in Asia/Tokyo is 1799-12-31 in UT, and 1800-01-01T02:00Z
    // is still ahead of Neptune's and Pluto's first segment in sepl_18.se1.
    // Without the instant-level guard these come back as a generic calc_error,
    // which the Worker reduces to `calc_failed` — the caller is told nothing.
    for (const overrides of [
      { birth_date: "1800-01-01", birth_time_local: "06:00:00", timezone: "Asia/Tokyo" },
      { birth_date: "1800-01-01", birth_time_local: "02:00:00", timezone: "UTC" },
      { birth_date: "2399-12-31", birth_time_local: "23:30:00", timezone: "UTC" },
    ]) {
      const res = await calculateChart(req(overrides));
      assert.equal(res.ok, false, `${JSON.stringify(overrides)} should be rejected`);
      assert.equal(res.error_class, "invalid_birth_profile");
      const message = res.error_message ?? "";
      assert.ok(!/[A-Za-z]:\\|\/(home|Users|app|srv)\//.test(message), `path leaked: ${message}`);
      assert.ok(!/sepl_|semo_/.test(message), `ephemeris filename leaked: ${message}`);
    }
  });

  it("still accepts the first and last fully covered days", async () => {
    for (const overrides of [
      { birth_date: "1800-01-02", birth_time_local: "12:00:00", timezone: "UTC" },
      { birth_date: "2399-12-30", birth_time_local: "12:00:00", timezone: "UTC" },
    ]) {
      const res = await calculateChart(req(overrides));
      assert.equal(res.ok, true, `${JSON.stringify(overrides)}: ${res.error_message}`);
      assert.equal(res.chart?.positions.length, 13);
    }
  });
});

describe("pinned ephemeris coverage", () => {
  const SE_IDS = Object.values(SE_ID_BY_BODY).filter(
    (id): id is number => typeof id === "number",
  );

  it("declares bounds that every launch body actually answers", () => {
    for (const seId of SE_IDS) {
      assert.doesNotThrow(
        () => calcBody(EPHEMERIS_COVERAGE_MIN_JD, seId),
        `body ${seId} is not covered at EPHEMERIS_COVERAGE_MIN_JD`,
      );
      assert.doesNotThrow(
        () => calcBody(EPHEMERIS_COVERAGE_MAX_JD, seId),
        `body ${seId} is not covered at EPHEMERIS_COVERAGE_MAX_JD`,
      );
    }
  });

  it("keeps those bounds covered after an out-of-range call has been served", () => {
    // Swiss Ephemeris remembers that a neighbouring file was missing, and then
    // falls back to Moshier for edge-segment instants it answered correctly on
    // a cold process. That is why the declared bounds carry hours of margin
    // rather than sitting on the measured edge: without it, whether a chart
    // could be calculated would depend on what the container served before it.
    assert.throws(() => calcBody(EPHEMERIS_COVERAGE_MIN_JD - 400, SE_ID_BY_BODY.sun!));
    assert.throws(() => calcBody(EPHEMERIS_COVERAGE_MAX_JD + 400, SE_ID_BY_BODY.sun!));
    for (const seId of SE_IDS) {
      assert.doesNotThrow(
        () => calcBody(EPHEMERIS_COVERAGE_MIN_JD, seId),
        `body ${seId} stopped resolving at the lower bound after a fallback`,
      );
      assert.doesNotThrow(
        () => calcBody(EPHEMERIS_COVERAGE_MAX_JD, seId),
        `body ${seId} stopped resolving at the upper bound after a fallback`,
      );
    }
  });

  it("refuses a Moshier substitution instead of returning it as Swiss Ephemeris", () => {
    // swe_calc_ut does not fail here — it succeeds with SEFLG_SWIEPH cleared
    // and returns plausible longitudes. Accepting them would stamp a different
    // theory with this build's ephemeris_data_version.
    assert.throws(
      () => calcBody(EPHEMERIS_COVERAGE_MIN_JD - 400, SE_ID_BY_BODY.pluto!),
      (err: unknown) =>
        err instanceof Error &&
        /flag \d+/.test(err.message) &&
        !/sepl_|semo_|\/(home|Users|app|srv)\//.test(err.message),
    );
  });
});
