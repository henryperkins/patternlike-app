import type { BirthTimeAccuracy } from "@patternlike/shared";
import { createPortraitSky } from "../lib/portrait-sky.js";

/** Explicitly fictional natal placements for the standalone study; never used by the account. */
export function fictionalPortraitSky(accuracy: BirthTimeAccuracy) {
  return createPortraitSky({
    id: "fictional-sky-study", status: "active",
    positions: [
      { body: "sun", longitude_deg: 115, house: 10 },
      { body: "moon", longitude_deg: 42.5, house: 8 },
    ],
    angles: accuracy === "unknown" ? null : { ascendant_deg: 193, midheaven_deg: 105 },
    houses: accuracy === "unknown" ? null : { system_used: "placidus", fallback_applied: false, cusps_deg: [] },
    uncertainty: {
      accuracy, window: null,
      suppressed_features: accuracy === "unknown" ? [
        { feature_class: "moon_time_sensitive", reason: "Fictional unknown-time example" },
        { feature_class: "angles", reason: "Fictional unknown-time example" },
        { feature_class: "houses", reason: "Fictional unknown-time example" },
      ] : [],
      qualified_features: [],
      user_facing_summary: accuracy === "unknown" ? "Example chart: the Moon and rising placements are unavailable without a birth time."
        : accuracy === "approximate" ? "Example chart: an approximate birth time qualifies time-sensitive placements." : null,
    },
  }, "fictional-sky-study");
}
