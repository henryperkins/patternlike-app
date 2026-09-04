import { describe, expect, it } from "vitest";
import { geocoderGranted, geocoderNotGranted } from "../test/geocoder-consent-fixture.js";
import { isGeocoderConsentResponse } from "./geocoder-consent.js";

describe("Geoapify consent document", () => {
  it("accepts the current grant and refusal documents", () => {
    expect(isGeocoderConsentResponse(geocoderGranted)).toBe(true);
    expect(isGeocoderConsentResponse(geocoderNotGranted)).toBe(true);
  });

  it.each([
    { provider: "google_places_geocoding_v4" },
    { schema_version: "0.8.0" },
    { policy_version: "google-places-geocoding-v4-2026-08-26" },
    { allowed_uses: ["model_training"] },
    { disclosure: { ...geocoderGranted.disclosure, text: "Unreviewed disclosure" } },
    { disclosure: { ...geocoderGranted.disclosure, links: { ...geocoderGranted.disclosure.links, geoapify_terms: "https://untrusted.example/terms" } } },
  ])("refuses stale or unrecognized consent terms: %j", (override) => {
    expect(isGeocoderConsentResponse({ ...geocoderGranted, ...override })).toBe(false);
  });
});
