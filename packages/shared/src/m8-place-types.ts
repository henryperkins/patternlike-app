/**
 * M8 consumer place, consent, and birth-budget wire types.
 *
 * Normative definitions live in `contracts/m8`, with the geocoder consent
 * successor in `contracts/geocoder-v2`. Request fields remain
 * provider-neutral; provider identity appears only in the consent document.
 */

export const M8_SCHEMA_VERSION = "0.8.0" as const;
export type M8SchemaVersion = typeof M8_SCHEMA_VERSION;

export interface PlaceSearchRequest {
  /** Trimmed, 2..120 Unicode code points. */
  query: string;
  locale?: string | null;
  /** App-generated search-session token; never sent to the provider. */
  session_token: string;
}

export interface PlaceSearchCandidate {
  candidate_id: string;
  primary_label: string;
  secondary_label: string | null;
}

export interface PlaceSearchResponse {
  schema_version: M8SchemaVersion;
  candidates: PlaceSearchCandidate[];
}

export type PlaceConfidence = "high" | "medium" | "low";

export type PlaceQualifierCode =
  | "approximate_match"
  | "region_level_match";

export interface PlaceQualifier {
  code: PlaceQualifierCode;
  message: string;
}

export interface PlaceResolutionRequest {
  candidate_id: string;
  locale?: string | null;
  session_token: string;
}

export interface PlaceResolutionResponse {
  schema_version: M8SchemaVersion;
  place_id: string;
  label: string;
  latitude: number;
  longitude: number;
  geocode_confidence: PlaceConfidence;
  qualifiers: PlaceQualifier[];
}

export const GEOCODER_PROVIDER = "geoapify" as const;
export const GEOCODER_CONSENT_SCHEMA_VERSION = "0.8.1" as const;

export const GEOCODER_CONSENT_POLICY_VERSION =
  "geoapify-2026-09-04" as const;

export const GEOCODER_CONSENT_DISCLOSURE_TEXT =
  "Geoapify birthplace search is optional. If you enable it, Pattern/Like sends the city or place text you type and your language preference (when available) to Geoapify. After you choose a suggestion, it sends the selected Geoapify place identifier and language preference to retrieve the place. Pattern/Like does not send your birth date or time, device location, user, account, birth-profile, or consent identifiers, or the app-owned search session token. Geoapify also receives Pattern/Like's API credential and network metadata such as the server IP. Geoapify logs API requests for access control, usage counting, troubleshooting, and performance; its privacy policy says successful request logs are generally kept no longer than 24 hours. Pattern/Like does not store your query or unselected suggestions. It encrypts the selected place and coordinates under your account key, retaining the selection handoff for up to 24 hours and the saved values in your birth profile. Deleting your Pattern/Like account does not delete Geoapify's separate records. You can decline or withdraw this permission and enter the place, coordinates, and time zone manually." as const;

export const GEOCODER_CONSENT_ALLOWED_USES = [
  "chart_fact",
  "timezone_resolution",
] as const;

export const GEOCODER_CONSENT_DISCLOSURE_LINKS = {
  patternlike_terms: "/terms.html",
  patternlike_privacy: "/privacy.html",
  geoapify_terms: "https://www.geoapify.com/terms-and-conditions/",
  geoapify_privacy: "https://www.geoapify.com/privacy-policy/",
} as const;

export type GeocoderConsentUiSurface = "onboarding" | "privacy_center";

export interface GeocoderConsentGrantRequest {
  policy_version: typeof GEOCODER_CONSENT_POLICY_VERSION;
}

export interface GeocoderConsentResponse {
  schema_version: typeof GEOCODER_CONSENT_SCHEMA_VERSION;
  kind: "product_source";
  source_id: "AST-02";
  permission_tier: 0;
  allowed_uses: ["chart_fact", "timezone_resolution"];
  provider: typeof GEOCODER_PROVIDER;
  scopes: [];
  connector_account_id: null;
  status: "granted" | "not_granted";
  policy_version: typeof GEOCODER_CONSENT_POLICY_VERSION;
  granted_at: string | null;
  ui_surface: GeocoderConsentUiSurface | null;
  disclosure: {
    text: typeof GEOCODER_CONSENT_DISCLOSURE_TEXT;
    links: {
      patternlike_terms: "/terms.html";
      patternlike_privacy: "/privacy.html";
      geoapify_terms: "https://www.geoapify.com/terms-and-conditions/";
      geoapify_privacy: "https://www.geoapify.com/privacy-policy/";
    };
  };
}

export const ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION =
  "account-processing-v1-2026-08-28" as const;

export const ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT =
  "Pattern/Like uses the birth date, local birth time, accuracy choice, place label, coordinates, and timezone you submit to calculate your natal chart, timing cycles, and uncertainty. The API sends those values to Pattern/Like's calculation service; it does not send them to a generative model. Pattern/Like encrypts the submitted profile and retained birth fields under your account key while retaining the calculated chart facts needed by the product. Separate permissions govern generated readings, Your Pattern, research, and model training. You may withdraw this permission at any time. Withdrawal retains the account data but stops serving it by freezing the account; regrant, export, and account deletion remain available." as const;

export const ACCOUNT_PROCESSING_ALLOWED_USES = [
  "chart_fact",
  "cycle_detection",
  "uncertainty_model",
] as const;

export const ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS = {
  patternlike_terms: "/terms.html",
  patternlike_privacy: "/privacy.html",
} as const;

export type AccountProcessingConsentUiSurface =
  | "onboarding"
  | "privacy_center";

export type AccountProcessingAccountStatus = "active" | "frozen";

export interface AccountProcessingConsentGrantRequest {
  policy_version: typeof ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION;
}

interface AccountProcessingConsentResponseBase {
  schema_version: M8SchemaVersion;
  kind: "account_processing";
  source_id: "AST-01";
  permission_tier: 0;
  allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"];
  provider: null;
  scopes: [];
  connector_account_id: null;
  has_active_chart: boolean;
  policy_version: typeof ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION;
  disclosure: {
    text: typeof ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT;
    links: {
      patternlike_terms: "/terms.html";
      patternlike_privacy: "/privacy.html";
    };
  };
}

export type AccountProcessingConsentResponse =
  AccountProcessingConsentResponseBase & (
    | {
      status: "granted";
      consent_id: string;
      account_status: AccountProcessingAccountStatus;
      regrant_will_restore_access: false;
      granted_at: string;
      ui_surface: AccountProcessingConsentUiSurface;
    }
    | {
      status: "not_granted";
      consent_id: null;
      account_status: "active";
      regrant_will_restore_access: false;
      granted_at: null;
      ui_surface: null;
    }
    | {
      status: "not_granted";
      consent_id: null;
      account_status: "frozen";
      regrant_will_restore_access: boolean;
      granted_at: null;
      ui_surface: null;
    }
  );

export interface BirthCalcBudgetExhausted {
  error: {
    code: "birth_calc_budget_exhausted";
    message: "The daily birth calculation limit has been reached";
    request_id: string;
    details: {
      resets_at: string;
    };
  };
}
