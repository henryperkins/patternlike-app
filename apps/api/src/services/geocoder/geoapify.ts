import type { PlaceConfidence, PlaceQualifier, PlaceSearchCandidate } from "@patternlike/shared";
import type { GeocoderAdapter } from "./types.js";

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const PLACE_DETAILS_URL = "https://api.geoapify.com/v2/place-details";
// Shared lang enum in both official endpoint OpenAPI documents, checked 2026-09-04.
// A syntactically valid ISO subtag (for example zu) is not necessarily accepted.
const SUPPORTED_LANGUAGES = new Set((
  "ab aa af ak sq am ar an hy as av ae ay az bm ba eu be bn bh bi bs br bg my ca ch ce ny zh cv kw co cr " +
  "hr cs da dv nl en eo et ee fo fj fi fr ff gl ka de el gn gu ht ha he hz hi ho hu ia id ie ga ig ik io " +
  "is it iu ja jv kl kn kr ks kk km ki rw ky kv kg ko ku kj la lb lg li ln lo lt lu lv gv mk mg ms ml mt " +
  "mi mr mh mn na nv nb nd ne ng nn no ii nr oc oj cu om or os pa pi fa pl ps pt qu rm rn ro ru sa sc sd " +
  "se sm sg sr gd sn si sk sl so st es su sw ss sv ta te tg th ti bo tk tl tn to tr ts tt tw ty ug uk ur " +
  "uz ve vi vo wa cy wo fy xh yi yo za"
).split(" "));

export class GeocoderAdapterError extends Error {
  constructor(readonly code: "geocoder_upstream_failed" | "geocoder_response_invalid") {
    super("The place provider could not complete this request");
    this.name = "GeocoderAdapterError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  throw new GeocoderAdapterError("geocoder_response_invalid");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function candidateId(value: unknown): string {
  const id = text(value);
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) return invalid();
  return id;
}

function hasSupportedAttribution(value: unknown): boolean {
  // Only content covered by our fixed linked notice can cross the frozen place
  // contract. Do not silently discard other datasets' attribution requirements.
  return object(value) && value.sourcename === "openstreetmap" &&
    value.attribution === "© OpenStreetMap contributors" &&
    value.license === "Open Database License" &&
    value.url === "https://www.openstreetmap.org/copyright";
}

function mapCandidate(value: unknown): PlaceSearchCandidate | null {
  if (!object(value)) return invalid();
  // A city-only search must never offer an address, country, or POI.
  if (typeof value.result_type !== "string") return invalid();
  if (value.result_type !== "city") return null;
  if (!hasSupportedAttribution(value.datasource)) return null;
  const primaryLabel = text(value.address_line1) ?? text(value.city) ?? text(value.name);
  const secondaryLabel = text(value.address_line2);
  if (!primaryLabel || [...primaryLabel].length > 512 ||
      (secondaryLabel && [...secondaryLabel].length > 512)) return invalid();
  return { candidate_id: candidateId(value.place_id), primary_label: primaryLabel, secondary_label: secondaryLabel };
}

function confidenceFor(value: unknown): PlaceConfidence | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  const categories = new Set(value);
  if (categories.has("administrative.country_level") || categories.has("administrative.continent_level")) return null;
  const levels: [PlaceConfidence, string[]][] = [
    ["high", ["administrative.city_level", "populated_place.city", "populated_place.town",
      "populated_place.village", "populated_place.hamlet", "populated_place.municipality", "populated_place.township"]],
    ["medium", ["administrative.district_level", "administrative.suburb_level", "administrative.neighbourhood_level",
      "populated_place.borough", "populated_place.district", "populated_place.subdistrict", "populated_place.suburb",
      "populated_place.neighbourhood", "populated_place.quarter"]],
    ["low", ["administrative.county_level", "administrative.state_level", "administrative.country_part_level",
      "populated_place.county", "populated_place.province", "populated_place.region", "populated_place.state"]],
  ];
  return levels.find(([, names]) => names.some((name) => categories.has(name)))?.[0] ?? null;
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) return invalid();
  return value;
}

function mapResolution(payload: unknown) {
  if (!object(payload) || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) return invalid();
  const features = payload.features.filter((feature) => object(feature) && feature.type === "Feature" &&
    object(feature.properties) && feature.properties.feature_type === "details");
  if (features.length !== 1) return invalid();
  const value = features[0].properties as Record<string, unknown>;
  if (!hasSupportedAttribution(value.datasource)) return invalid();
  const label = text(value.formatted);
  // address.city describes the containing city even for a stadium or building.
  // Only the feature's own documented locality categories establish confidence.
  const geocodeConfidence = confidenceFor(value.categories);
  if (!label || [...label].length > 512 || !geocodeConfidence) return invalid();
  const qualifiers: PlaceQualifier[] = [];
  if (geocodeConfidence === "low") {
    qualifiers.push({ code: "region_level_match", message: "Only a broader administrative region could be resolved." });
  }
  qualifiers.push({ code: "approximate_match", message: "Coordinates represent the selected place, not an exact birth address." });
  return {
    label, latitude: coordinate(value.lat, 90), longitude: coordinate(value.lon, 180),
    geocode_confidence: geocodeConfidence, qualifiers,
  };
}

function language(locale: string | null): string | null {
  const code = locale?.split("-")[0]?.toLowerCase();
  return code && SUPPORTED_LANGUAGES.has(code) ? code : null;
}

export function createGeoapifyGeocoder(input: { apiKey: string; fetcher?: typeof fetch }): GeocoderAdapter {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("Geoapify API key is required");
  const fetcher = input.fetcher ?? fetch;

  async function request(endpoint: string, params: Record<string, string>, locale: string | null, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const lang = language(locale);
    if (lang) url.searchParams.set("lang", lang);
    let response: Response;
    try {
      // Current Geoapify OpenAPI supports x-api-key for server-to-server use.
      // No forwarded user headers, client IP, session identifiers, or cookies.
      // Never log this URL: text / selected place ID are personal data.
      response = await fetcher(url, { method: "GET", headers: { "x-api-key": apiKey }, redirect: "error", signal });
    } catch {
      // Fetch exceptions can embed the URL. Do not propagate provider details.
      throw new GeocoderAdapterError("geocoder_upstream_failed");
    }
    if (!response.ok) throw new GeocoderAdapterError("geocoder_upstream_failed");
    try {
      return await response.json();
    } catch {
      return invalid();
    }
  }

  return {
    async search(search, signal) {
      const payload = await request(AUTOCOMPLETE_URL, { text: search.query, type: "city", format: "json", limit: "8" }, search.locale, signal);
      if (!object(payload) || !Array.isArray(payload.results)) return invalid();
      return payload.results.slice(0, 8).map(mapCandidate).filter((item): item is PlaceSearchCandidate => item !== null);
    },
    async resolve(resolve, signal) {
      return mapResolution(await request(PLACE_DETAILS_URL, { id: candidateId(resolve.candidateId), features: "details" }, resolve.locale, signal));
    },
  };
}
