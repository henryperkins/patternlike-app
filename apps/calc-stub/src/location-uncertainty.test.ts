import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalcRequest } from "@patternlike/shared";

import { calculateChart } from "./engine.js";

function request(overrides: Partial<CalcRequest> = {}): CalcRequest {
  return {
    request_id: "unc_location_1",
    user_id: "usr_location_uncertainty_0001",
    profile_version: 1,
    accuracy: "exact",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    timezone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    place_label: "Los Angeles",
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

describe("location uncertainty", () => {
  it("qualifies a medium-confidence birthplace", async () => {
    const result = await calculateChart(request({ location_confidence: "medium" }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.chart!.uncertainty.qualified_features, [{
      feature_id: "birthplace",
      qualification: "technique_specific",
    }]);
    assert.match(result.chart!.uncertainty.user_facing_summary ?? "", /Location details/);
  });

  it("qualifies civil-time conversion for boundary and transition codes", async () => {
    for (const code of [
      "pre_1970_zone_boundary",
      "near_zone_boundary",
      "local_time_ambiguous",
      "local_time_nonexistent",
    ] as const) {
      const result = await calculateChart(request({
        location_confidence: "high",
        location_qualifier_codes: [code],
      }));
      assert.equal(result.ok, true);
      assert.ok(result.chart!.uncertainty.qualified_features.some(
        (feature) => feature.feature_id === "birth_instant",
      ));
    }
  });

  it("leaves the exact summary unchanged for high confidence without qualifiers", async () => {
    const result = await calculateChart(request({
      location_confidence: "high",
      location_qualifier_codes: [],
    }));
    assert.equal(
      result.chart!.uncertainty.user_facing_summary,
      "Birth time is exact; houses and angles are included (Swiss Ephemeris).",
    );
  });

  it("rejects unknown confidence and qualifier codes", async () => {
    const badConfidence = await calculateChart(request({
      location_confidence: "certain" as never,
    }));
    assert.equal(badConfidence.ok, false);

    const badQualifier = await calculateChart(request({
      location_qualifier_codes: ["provider_guess"] as never,
    }));
    assert.equal(badQualifier.ok, false);
  });
});
