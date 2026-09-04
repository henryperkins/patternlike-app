import {
  GEOCODER_CONSENT_ALLOWED_USES,
  GEOCODER_CONSENT_DISCLOSURE_LINKS,
  GEOCODER_CONSENT_DISCLOSURE_TEXT,
  GEOCODER_CONSENT_POLICY_VERSION,
  GEOCODER_CONSENT_SCHEMA_VERSION,
  GEOCODER_PROVIDER,
  type GeocoderConsentResponse,
} from "@patternlike/shared";

export function isGeocoderConsentResponse(
  value: unknown,
): value is GeocoderConsentResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<GeocoderConsentResponse>;
  const disclosure = record.disclosure as GeocoderConsentResponse["disclosure"] | undefined;
  return record.schema_version === GEOCODER_CONSENT_SCHEMA_VERSION &&
    record.kind === "product_source" &&
    record.source_id === "AST-02" &&
    record.provider === GEOCODER_PROVIDER &&
    record.policy_version === GEOCODER_CONSENT_POLICY_VERSION &&
    record.permission_tier === 0 &&
    JSON.stringify(record.allowed_uses) === JSON.stringify(GEOCODER_CONSENT_ALLOWED_USES) &&
    Array.isArray(record.scopes) && record.scopes.length === 0 &&
    record.connector_account_id === null &&
    ((record.status === "granted" && typeof record.granted_at === "string" &&
      Number.isFinite(Date.parse(record.granted_at)) &&
      (record.ui_surface === "onboarding" || record.ui_surface === "privacy_center")) ||
     (record.status === "not_granted" && record.granted_at === null && record.ui_surface === null)) &&
    !!disclosure && disclosure.text === GEOCODER_CONSENT_DISCLOSURE_TEXT &&
    !!disclosure.links &&
    Object.entries(GEOCODER_CONSENT_DISCLOSURE_LINKS).every(([key, url]) =>
      disclosure.links[key as keyof typeof GEOCODER_CONSENT_DISCLOSURE_LINKS] === url);
}
