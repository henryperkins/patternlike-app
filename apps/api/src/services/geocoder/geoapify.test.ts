import { describe, expect, it, vi } from "vitest";

import { createGeoapifyGeocoder } from "./geoapify.js";

// Documented Geoapify JSON and GeoJSON shapes; unused provider fields must not
// escape the adapter. Details categories, not address.city, identify the place.
const CITY = {
  place_id: "51aabbcc",
  result_type: "city",
  address_line1: "London",
  address_line2: "United Kingdom",
  formatted: "London, UK",
  lat: 51.5074,
  lon: -0.1278,
  categories: ["administrative", "administrative.city_level"],
  datasource: {
    sourcename: "openstreetmap", attribution: "© OpenStreetMap contributors",
    license: "Open Database License", url: "https://www.openstreetmap.org/copyright",
    raw: { private: "discard" },
  },
};

function details(properties: Record<string, unknown> = CITY) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { feature_type: "details", ...properties } }],
  };
}

function responding(payload: unknown) {
  return vi.fn<typeof fetch>(async (input, init) => {
    // Keep Workers request-option validation real; only the external response
    // is mocked. Otherwise unsupported redirect modes pass every happy path.
    new Request(input, init);
    return Response.json(payload);
  });
}

describe("Geoapify geocoder", () => {
  it("uses city autocomplete with header authentication and returns at most eight minimal candidates", async () => {
    const fetcher = responding({ results: Array.from({ length: 9 }, (_, i) => ({ ...CITY, place_id: `city-${i}` })) });
    const signal = new AbortController().signal;
    const result = await createGeoapifyGeocoder({ apiKey: " secret ", fetcher })
      .search({ query: "Lon & Paris", locale: "en-GB" }, signal);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe("https://api.geoapify.com/v1/geocode/autocomplete");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      text: "Lon & Paris", type: "city", format: "json", limit: "8", lang: "en",
    });
    expect(init).toEqual({ method: "GET", headers: { "x-api-key": "secret" }, redirect: "manual", signal });
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual({ candidate_id: "city-0", primary_label: "London", secondary_label: "United Kingdom" });
  });

  it.each(["eng", "zu-ZA", "xx-XX", null])("omits unsupported locale %s and excludes non-city suggestions", async (locale) => {
    const fetcher = responding({ results: [{ ...CITY, result_type: "country" }, CITY] });
    const result = await createGeoapifyGeocoder({ apiKey: "secret", fetcher })
      .search({ query: "Lon", locale });
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.has("lang")).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0]?.candidate_id).toBe(CITY.place_id);
  });

  it("retains a supported non-English browser language", async () => {
    const fetcher = responding(details());
    await createGeoapifyGeocoder({ apiKey: "secret", fetcher })
      .resolve({ candidateId: CITY.place_id, locale: "xh-ZA" });
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get("lang")).toBe("xh");
  });

  it.each([
    undefined,
    { ...CITY.datasource, sourcename: "geonames" },
    { ...CITY.datasource, attribution: "Additional attribution is required" },
    { ...CITY.datasource, license: "Different license" },
    { ...CITY.datasource, url: "https://unreviewed.example/license" },
  ])("refuses content whose attribution is not covered by the fixed OSM notice: %j", async (datasource) => {
    const unsupported = { ...CITY, place_id: "unsupported-source", datasource };
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding({ results: [unsupported, CITY] }) });
    expect(await adapter.search({ query: "Lon", locale: null }))
      .toEqual([{ candidate_id: CITY.place_id, primary_label: "London", secondary_label: "United Kingdom" }]);
    const resolver = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding(details(unsupported)) });
    await expect(resolver.resolve({ candidateId: unsupported.place_id, locale: "zu-ZA" }))
      .rejects.toMatchObject({ code: "geocoder_response_invalid" });
  });

  it("resolves only the selected ID through details with no coordinates or session token", async () => {
    const fetcher = responding(details());
    const result = await createGeoapifyGeocoder({ apiKey: "secret", fetcher })
      .resolve({ candidateId: "a/b?c&features=other", locale: "de-DE" });
    const [url, init] = fetcher.mock.calls[0]!;
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe("https://api.geoapify.com/v2/place-details");
    expect(Object.fromEntries(request.searchParams)).toEqual({ id: "a/b?c&features=other", features: "details", lang: "de" });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("x-api-key")).toBe("secret");
    expect(result).toEqual({
      label: "London, UK", latitude: 51.5074, longitude: -0.1278,
      geocode_confidence: "high",
      qualifiers: [{ code: "approximate_match", message: "Coordinates represent the selected place, not an exact birth address." }],
    });
  });

  it.each([
    ["populated_place.village", "high"],
    ["administrative.suburb_level", "medium"],
    ["administrative.state_level", "low"],
  ])("maps %s conservatively to %s confidence", async (category, confidence) => {
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding(details({ ...CITY, categories: [category] })) });
    const result = await adapter.resolve({ candidateId: CITY.place_id, locale: null });
    expect(result.geocode_confidence).toBe(confidence);
    expect(result.qualifiers.some((q) => q.code === "region_level_match")).toBe(confidence === "low");
  });

  it.each([
    { ...CITY, categories: ["sport.stadium"], city: "London" },
    { ...CITY, categories: ["administrative.country_level"] },
    { ...CITY, categories: [] },
    { ...CITY, lat: 91 },
    { ...CITY, lon: "-0.12" },
    { ...CITY, formatted: "" },
  ])("rejects unsupported or malformed details: %j", async (properties) => {
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding(details(properties)) });
    await expect(adapter.resolve({ candidateId: CITY.place_id, locale: null }))
      .rejects.toMatchObject({ code: "geocoder_response_invalid" });
  });

  it.each([
    {}, { type: "FeatureCollection", features: [] },
    { type: "FeatureCollection", features: [...details().features, ...details().features] },
  ])("requires exactly one details feature", async (payload) => {
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding(payload) });
    await expect(adapter.resolve({ candidateId: CITY.place_id, locale: null }))
      .rejects.toMatchObject({ code: "geocoder_response_invalid" });
  });

  it.each([{ results: [{ ...CITY, place_id: "x".repeat(513) }] }, { results: [null] }, {}])(
    "rejects malformed autocomplete responses", async (payload) => {
      const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: responding(payload) });
      await expect(adapter.search({ query: "Lon", locale: null }))
        .rejects.toMatchObject({ code: "geocoder_response_invalid" });
    },
  );

  it("does not leak upstream errors containing URLs, keys, or query text", async () => {
    const adapter = createGeoapifyGeocoder({
      apiKey: "secret", fetcher: async () => { throw new Error("https://api.geoapify.com/?text=private&apiKey=secret"); },
    });
    await expect(adapter.search({ query: "private", locale: null }))
      .rejects.toThrow("The place provider could not complete this request");
  });

  it.each([403, 429, 500])("fails closed on upstream HTTP %i", async (status) => {
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher: async () => new Response("private", { status }) });
    await expect(adapter.search({ query: "Lon", locale: null }))
      .rejects.toMatchObject({ code: "geocoder_upstream_failed" });
  });

  it.each([301, 302, 303, 307, 308])("refuses upstream HTTP %i without forwarding the key", async (status) => {
    const requests: Request[] = [];
    const adapter = createGeoapifyGeocoder({
      apiKey: "secret",
      fetcher: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return new Response(null, {
          status,
          headers: { location: "https://untrusted.example/redirected" },
        });
      },
    });

    await expect(adapter.search({ query: "Lon", locale: null }))
      .rejects.toMatchObject({ code: "geocoder_upstream_failed" });
    await expect(adapter.resolve({ candidateId: CITY.place_id, locale: null }))
      .rejects.toMatchObject({ code: "geocoder_upstream_failed" });
    expect(requests.map((request) => ({
      origin: new URL(request.url).origin,
      redirect: request.redirect,
    }))).toEqual([
      { origin: "https://api.geoapify.com", redirect: "manual" },
      { origin: "https://api.geoapify.com", redirect: "manual" },
    ]);
  });

  it("does not call the provider for missing keys or invalid IDs", async () => {
    const fetcher = responding(details());
    expect(() => createGeoapifyGeocoder({ apiKey: " ", fetcher })).toThrow("Geoapify API key is required");
    const adapter = createGeoapifyGeocoder({ apiKey: "secret", fetcher });
    for (const candidateId of ["", "x".repeat(513), "x\nkey"]) {
      await expect(adapter.resolve({ candidateId, locale: null })).rejects.toMatchObject({ code: "geocoder_response_invalid" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
