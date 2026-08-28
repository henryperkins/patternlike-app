import { describe, expect, it } from "vitest";

import { combineLocationUncertainty } from "./location-uncertainty.js";

describe("combineLocationUncertainty", () => {
  it("uses the weaker selected-place and timezone confidence", () => {
    expect(combineLocationUncertainty({
      geocodeConfidence: "medium",
      timezoneConfidence: "high",
      placeQualifierCodes: [],
      timezoneQualifierCodes: [],
    })).toEqual({ confidence: "medium", qualifierCodes: [] });

    expect(combineLocationUncertainty({
      geocodeConfidence: "high",
      timezoneConfidence: "low",
      placeQualifierCodes: [],
      timezoneQualifierCodes: [],
    })).toEqual({ confidence: "low", qualifierCodes: [] });
  });

  it("keeps manual-location confidence when no geocoder result exists", () => {
    expect(combineLocationUncertainty({
      geocodeConfidence: null,
      timezoneConfidence: "high",
      placeQualifierCodes: [],
      timezoneQualifierCodes: [],
    })).toEqual({ confidence: "high", qualifierCodes: [] });
  });

  it("deduplicates qualifiers while preserving stable source order", () => {
    expect(combineLocationUncertainty({
      geocodeConfidence: "low",
      timezoneConfidence: "medium",
      placeQualifierCodes: ["approximate_match", "region_level_match"],
      timezoneQualifierCodes: ["near_zone_boundary", "near_zone_boundary"],
    })).toEqual({
      confidence: "low",
      qualifierCodes: [
        "approximate_match",
        "region_level_match",
        "near_zone_boundary",
      ],
    });
  });
});
