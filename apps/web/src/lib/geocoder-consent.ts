import type { GeocoderConsentResponse } from "@patternlike/shared";

export function isGeocoderConsentResponse(
  value: unknown,
): value is GeocoderConsentResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<GeocoderConsentResponse>;
  const disclosure = record.disclosure as GeocoderConsentResponse["disclosure"] | undefined;
  return record.schema_version === "0.8.0" &&
    record.kind === "product_source" &&
    record.source_id === "AST-02" &&
    record.provider === "google_places_geocoding_v4" &&
    (record.status === "granted" || record.status === "not_granted") &&
    !!disclosure && typeof disclosure.text === "string" &&
    !!disclosure.links &&
    typeof disclosure.links.patternlike_terms === "string" &&
    typeof disclosure.links.patternlike_privacy === "string" &&
    typeof disclosure.links.google_maps_terms === "string" &&
    typeof disclosure.links.google_privacy === "string";
}
