import { describe, expect, it, vi } from "vitest";

import {
  AUTOCOMPLETE_FIELD_MASK,
  AUTOCOMPLETE_URL,
  GEOCODE_FIELD_MASK,
  GEOCODE_PLACE_URL,
  createGooglePlacesGeocoder,
} from "./google-places-geocoding-v4.js";

describe("Google Places plus Geocoding v4 adapter", () => {
  it("sends only the approved autocomplete body and maps at most eight candidates", async () => {
    const fetcher = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>>(async () => new Response(JSON.stringify({
      suggestions: Array.from({ length: 9 }, (_, index) => ({
        placePrediction: {
          placeId: `candidate-${index}`,
          structuredFormat: {
            mainText: { text: `City ${index}` },
            secondaryText: { text: "Country" },
          },
        },
      })),
    }), { status: 200 }));
    const adapter = createGooglePlacesGeocoder({ apiKey: "secret", fetcher });

    const result = await adapter.search({ query: "Lon", locale: "en-GB" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(AUTOCOMPLETE_URL);
    expect(init).toMatchObject({ method: "POST" });
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("secret");
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(AUTOCOMPLETE_FIELD_MASK);
    expect(JSON.parse(String(init?.body))).toEqual({
      input: "Lon",
      includedPrimaryTypes: ["(cities)"],
      includeQueryPredictions: false,
      languageCode: "en-GB",
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("sessionToken");
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual({
      candidate_id: "candidate-0",
      primary_label: "City 0",
      secondary_label: "Country",
    });
  });

  it("resolves one encoded Place ID with no query or body", async () => {
    const fetcher = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>>(async () => new Response(JSON.stringify({
      formattedAddress: "London, UK",
      location: { latitude: 51.5074, longitude: -0.1278 },
      granularity: "APPROXIMATE",
      types: ["locality", "political"],
      addressComponents: [],
    }), { status: 200 }));
    const adapter = createGooglePlacesGeocoder({ apiKey: "secret", fetcher });

    await expect(adapter.resolve({ candidateId: "a/b?c", locale: "en" }))
      .resolves.toEqual({
        label: "London, UK",
        latitude: 51.5074,
        longitude: -0.1278,
        geocode_confidence: "high",
        qualifiers: [{
          code: "approximate_match",
          message: "The provider marked this place as approximate.",
        }],
      });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${GEOCODE_PLACE_URL}/a%2Fb%3Fc`);
    expect(init).toMatchObject({ method: "GET" });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(GEOCODE_FIELD_MASK);
  });

  it.each([
    { types: ["country"], granularity: "APPROXIMATE" },
    { types: ["locality"], granularity: "UNKNOWN_GRANULARITY" },
  ])("refuses unsupported result semantics: %j", async ({ types, granularity }) => {
    const adapter = createGooglePlacesGeocoder({
      apiKey: "secret",
      fetcher: async () => new Response(JSON.stringify({
        formattedAddress: "Unknown",
        location: { latitude: 1, longitude: 2 },
        granularity,
        types,
        addressComponents: [],
      }), { status: 200 }),
    });
    await expect(adapter.resolve({ candidateId: "candidate", locale: null }))
      .rejects.toMatchObject({ code: "geocoder_response_invalid" });
  });
});
