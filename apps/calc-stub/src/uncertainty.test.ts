import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateChart } from "./engine.js";
import type { CalcRequest, ChartSnapshot } from "@patternlike/shared";

function req(overrides: Partial<CalcRequest> = {}): CalcRequest {
  return {
    request_id: "unc_1",
    user_id: "usr_uncertainty_0001",
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

const suppressed = (chart: ChartSnapshot) =>
  new Set(chart.uncertainty.suppressed_features.map((f) => f.feature_class));

describe("uncertainty reporting", () => {
  it("never claims angles are suppressed while also returning them", async () => {
    for (const patch of [
      {},
      { birth_time_local: null },
      { accuracy: "approximate" as const },
      { accuracy: "unknown" as const, birth_time_local: null },
      { latitude: null, longitude: null },
    ]) {
      const res = await calculateChart(req(patch));
      assert.equal(res.ok, true, JSON.stringify(patch));
      const chart = res.chart!;
      const claimsSuppressed = suppressed(chart).has("angles");
      const actuallyReturned = chart.angles !== null;
      assert.notEqual(
        claimsSuppressed,
        actuallyReturned,
        `${JSON.stringify(patch)}: suppressed=${claimsSuppressed} returned=${actuallyReturned}`,
      );
    }
  });

  it("suppresses angles when accuracy is exact but no birth time was supplied", async () => {
    const res = await calculateChart(req({ birth_time_local: null }));
    assert.equal(res.ok, true);
    const chart = res.chart!;
    assert.equal(chart.angles, null, "angles must not be computed from synthetic noon");
    assert.equal(chart.houses, null);
    assert.equal(chart.birth.utc_instant, null);
    assert.ok(!chart.positions.some((p) => p.body === "ascendant"));
    assert.ok(!chart.positions.some((p) => p.body === "midheaven"));
    assert.ok(chart.positions.every((p) => p.house === null));
  });

  it("keeps birth.accuracy and uncertainty.accuracy consistent", async () => {
    for (const patch of [
      {},
      { birth_time_local: null },
      { accuracy: "approximate" as const },
      { accuracy: "unknown" as const, birth_time_local: null },
    ]) {
      const res = await calculateChart(req(patch));
      const chart = res.chart!;
      assert.equal(
        chart.birth.accuracy,
        chart.uncertainty.accuracy,
        `${JSON.stringify(patch)} disagreed`,
      );
    }
  });

  it("honours the caller's approximate window instead of hardcoding 30 minutes", async () => {
    for (const minutes of [15, 90, 360]) {
      const res = await calculateChart(
        req({ accuracy: "approximate", approximate_window_minutes: minutes }),
      );
      assert.equal(res.ok, true);
      assert.equal(
        res.chart!.uncertainty.window?.plus_minus_minutes,
        minutes,
        `window for ${minutes}`,
      );
    }
  });

  it("defaults the approximate window to 30 minutes when the caller omits it", async () => {
    const res = await calculateChart(req({ accuracy: "approximate" }));
    assert.equal(res.chart!.uncertainty.window?.plus_minus_minutes, 30);
  });

  it("suppresses angles when a birthplace is missing even with an exact time", async () => {
    const res = await calculateChart(req({ latitude: null, longitude: null }));
    assert.equal(res.ok, true);
    const chart = res.chart!;
    assert.equal(chart.angles, null);
    const reasons = chart.uncertainty.suppressed_features.map((f) => f.reason);
    assert.ok(
      reasons.includes("birthplace_unavailable"),
      `expected birthplace_unavailable, got ${reasons.join(",")}`,
    );
    // The birth time was real, so time-sensitive Moon claims stay available.
    assert.ok(!suppressed(chart).has("moon_time_sensitive"));
  });
});
