import type {
  PlaceConfidence,
  PlaceQualifier,
  PlaceResolutionResponse,
  PlaceSearchCandidate,
} from "@patternlike/shared";

export { GEOCODER_PROVIDER } from "@patternlike/shared";
export const GEOCODER_POLICY_VERSION = "1.0.0" as const;
export const GEOCODER_TIMEOUT_MS = 5_000;

export interface GeocoderSearchInput {
  query: string;
  locale: string | null;
}

export interface GeocoderResolveInput {
  candidateId: string;
  locale: string | null;
}

export interface GeocoderAdapter {
  search(input: GeocoderSearchInput, signal?: AbortSignal): Promise<PlaceSearchCandidate[]>;
  resolve(input: GeocoderResolveInput, signal?: AbortSignal): Promise<Omit<PlaceResolutionResponse, "schema_version" | "place_id">>;
}

export interface StoredPlaceResolution {
  label: string;
  latitude: number;
  longitude: number;
  geocode_confidence: PlaceConfidence;
  qualifiers: PlaceQualifier[];
}
