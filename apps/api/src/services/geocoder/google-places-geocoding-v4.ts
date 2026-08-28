import type {
  PlaceConfidence,
  PlaceQualifier,
  PlaceSearchCandidate,
} from "@patternlike/shared";

import type { GeocoderAdapter } from "./types.js";

export const AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
export const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId," +
  "suggestions.placePrediction.structuredFormat.mainText.text," +
  "suggestions.placePrediction.structuredFormat.secondaryText.text";
export const GEOCODE_PLACE_URL =
  "https://geocode.googleapis.com/v4/geocode/places";
export const GEOCODE_FIELD_MASK =
  "formattedAddress,location,granularity,types," +
  "addressComponents.longText,addressComponents.shortText," +
  "addressComponents.types";

type Fetcher = typeof fetch;

export class GeocoderAdapterError extends Error {
  constructor(
    readonly code:
      | "geocoder_upstream_failed"
      | "geocoder_response_invalid",
  ) {
    super("The place provider could not complete this request");
    this.name = "GeocoderAdapterError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new GeocoderAdapterError("geocoder_upstream_failed");
  try {
    return await response.json();
  } catch {
    throw new GeocoderAdapterError("geocoder_response_invalid");
  }
}

function textAt(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!object(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current.trim() !== ""
    ? current.trim()
    : null;
}

function mapCandidate(value: unknown): PlaceSearchCandidate {
  const candidateId = textAt(value, ["placePrediction", "placeId"]);
  const primaryLabel = textAt(value, [
    "placePrediction",
    "structuredFormat",
    "mainText",
    "text",
  ]);
  const secondaryLabel = textAt(value, [
    "placePrediction",
    "structuredFormat",
    "secondaryText",
    "text",
  ]);
  if (!candidateId || !primaryLabel) {
    throw new GeocoderAdapterError("geocoder_response_invalid");
  }
  return {
    candidate_id: candidateId,
    primary_label: primaryLabel,
    secondary_label: secondaryLabel,
  };
}

function typeStrings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function confidenceFor(value: Record<string, unknown>): PlaceConfidence | null {
  const types = new Set(typeStrings(value.types));
  if (Array.isArray(value.addressComponents)) {
    for (const component of value.addressComponents) {
      if (!object(component)) continue;
      for (const type of typeStrings(component.types)) types.add(type);
    }
  }
  if (types.has("locality") || types.has("postal_town")) return "high";
  if ([...types].some((type) => type === "sublocality" || /^sublocality_level_[1-9]$/.test(type))) {
    return "medium";
  }
  if ([...types].some((type) => /^administrative_area_level_[1-9]$/.test(type))) {
    return "low";
  }
  return null;
}

function finiteCoordinate(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function mapResolution(value: unknown) {
  if (!object(value) || !object(value.location)) {
    throw new GeocoderAdapterError("geocoder_response_invalid");
  }
  const label = typeof value.formattedAddress === "string"
    ? value.formattedAddress.trim()
    : "";
  const latitude = finiteCoordinate(value.location.latitude, -90, 90);
  const longitude = finiteCoordinate(value.location.longitude, -180, 180);
  const granularity = value.granularity;
  const acceptedGranularities = new Set([
    "ROOFTOP",
    "RANGE_INTERPOLATED",
    "GEOMETRIC_CENTER",
    "APPROXIMATE",
  ]);
  const geocodeConfidence = confidenceFor(value);
  if (
    label === "" ||
    latitude === null ||
    longitude === null ||
    typeof granularity !== "string" ||
    !acceptedGranularities.has(granularity) ||
    geocodeConfidence === null
  ) {
    throw new GeocoderAdapterError("geocoder_response_invalid");
  }

  const qualifiers: PlaceQualifier[] = [];
  if (geocodeConfidence === "low") {
    qualifiers.push({
      code: "region_level_match",
      message: "Only a broader administrative region could be resolved.",
    });
  }
  if (granularity === "APPROXIMATE") {
    qualifiers.push({
      code: "approximate_match",
      message: "The provider marked this place as approximate.",
    });
  }
  return {
    label,
    latitude,
    longitude,
    geocode_confidence: geocodeConfidence,
    qualifiers,
  };
}

export function createGooglePlacesGeocoder(input: {
  apiKey: string;
  fetcher?: Fetcher;
}): GeocoderAdapter {
  const apiKey = input.apiKey.trim();
  if (apiKey === "") throw new Error("Google Maps Platform API key is required");
  const fetcher = input.fetcher ?? fetch;
  return {
    async search(search, signal) {
      const body = {
        input: search.query,
        includedPrimaryTypes: ["(cities)"],
        includeQueryPredictions: false,
        ...(search.locale === null ? {} : { languageCode: search.locale }),
      };
      const response = await fetcher(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal,
      });
      const payload = await readJson(response);
      if (!object(payload) || !Array.isArray(payload.suggestions)) {
        throw new GeocoderAdapterError("geocoder_response_invalid");
      }
      return payload.suggestions.slice(0, 8).map(mapCandidate);
    },

    async resolve(resolve, signal) {
      const candidateId = resolve.candidateId.trim();
      if (
        candidateId === "" ||
        candidateId.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(candidateId)
      ) {
        throw new GeocoderAdapterError("geocoder_response_invalid");
      }
      const response = await fetcher(
        `${GEOCODE_PLACE_URL}/${encodeURIComponent(candidateId)}`,
        {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GEOCODE_FIELD_MASK,
          },
          signal,
        },
      );
      return mapResolution(await readJson(response));
    },
  };
}
