import {
  GEOCODER_CONSENT_ALLOWED_USES,
  GEOCODER_CONSENT_DISCLOSURE_LINKS,
  GEOCODER_CONSENT_DISCLOSURE_TEXT,
  GEOCODER_CONSENT_POLICY_VERSION,
  type GeocoderConsentResponse,
} from "@patternlike/shared";

export const GEOCODER_CONSENT_PATH = "/v1/consents/geocoder";

/** Field-for-field `contracts/m8/fixtures/valid/geocoder-consent.not-granted.json`. */
export const geocoderNotGranted = {
  schema_version: "0.8.0",
  kind: "product_source",
  source_id: "AST-02",
  permission_tier: 0,
  allowed_uses: [...GEOCODER_CONSENT_ALLOWED_USES],
  provider: "google_places_geocoding_v4",
  scopes: [],
  connector_account_id: null,
  status: "not_granted",
  policy_version: GEOCODER_CONSENT_POLICY_VERSION,
  granted_at: null,
  ui_surface: null,
  disclosure: {
    text: GEOCODER_CONSENT_DISCLOSURE_TEXT,
    links: { ...GEOCODER_CONSENT_DISCLOSURE_LINKS },
  },
} satisfies GeocoderConsentResponse;

export const geocoderGranted = {
  ...geocoderNotGranted,
  status: "granted",
  granted_at: "2026-08-26T18:30:00Z",
  ui_surface: "onboarding",
} satisfies GeocoderConsentResponse;

export const geocoderGrantedFromPrivacy = {
  ...geocoderGranted,
  granted_at: "2026-09-04T09:00:00Z",
  ui_surface: "privacy_center",
} satisfies GeocoderConsentResponse;
