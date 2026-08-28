import {
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT,
  ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION,
  type AccountProcessingConsentResponse,
} from "@patternlike/shared";

export const ACCOUNT_PROCESSING_CONSENT_PATH =
  "/v1/consents/account-processing";

export const accountProcessingNotGranted = {
  schema_version: "0.8.0",
  kind: "account_processing",
  source_id: "AST-01",
  permission_tier: 0,
  allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"],
  provider: null,
  scopes: [],
  connector_account_id: null,
  status: "not_granted",
  consent_id: null,
  account_status: "active",
  has_active_chart: false,
  regrant_will_restore_access: false,
  policy_version: ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION,
  granted_at: null,
  ui_surface: null,
  disclosure: {
    text: ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT,
    links: {
      patternlike_terms: "/terms.html",
      patternlike_privacy: "/privacy.html",
    },
  },
} satisfies AccountProcessingConsentResponse;

export const accountProcessingGranted = {
  ...accountProcessingNotGranted,
  status: "granted",
  consent_id: "cns_account_processing_0001",
  granted_at: "2026-08-28T12:00:00.000Z",
  ui_surface: "onboarding",
} satisfies AccountProcessingConsentResponse;

export const accountProcessingRevokedFreeze = {
  ...accountProcessingNotGranted,
  account_status: "frozen",
  has_active_chart: true,
  regrant_will_restore_access: true,
} satisfies AccountProcessingConsentResponse;

export const accountProcessingUnexplainedFreeze = {
  ...accountProcessingNotGranted,
  account_status: "frozen",
  has_active_chart: true,
  regrant_will_restore_access: false,
} satisfies AccountProcessingConsentResponse;
