import {
  ACCOUNT_PROCESSING_ALLOWED_USES,
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT,
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS,
  ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION,
} from "@patternlike/shared";
import type { AccountProcessingConsentDocument } from "./api-client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function isCanonicalInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

const RESPONSE_KEYS = [
  "schema_version",
  "kind",
  "source_id",
  "permission_tier",
  "allowed_uses",
  "provider",
  "scopes",
  "connector_account_id",
  "status",
  "consent_id",
  "account_status",
  "has_active_chart",
  "regrant_will_restore_access",
  "policy_version",
  "granted_at",
  "ui_surface",
  "disclosure",
] as const;

export function isAccountProcessingConsentResponse(
  value: unknown,
): value is AccountProcessingConsentDocument {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RESPONSE_KEYS) ||
    !isRecord(value.disclosure) ||
    !hasExactKeys(value.disclosure, ["text", "links"])
  ) return false;
  const links = value.disclosure.links;
  if (
    !isRecord(links) ||
    !hasExactKeys(links, ["patternlike_terms", "patternlike_privacy"])
  ) return false;

  const grantedFieldsAreConsistent = value.status === "granted"
    ? typeof value.consent_id === "string" &&
      value.consent_id.length >= 8 &&
      value.consent_id.length <= 128 &&
      isCanonicalInstant(value.granted_at) &&
      (value.ui_surface === "onboarding" || value.ui_surface === "privacy_center")
    : value.status === "not_granted" &&
      value.consent_id === null &&
      value.granted_at === null &&
      value.ui_surface === null;

  return (
    value.schema_version === "0.8.0" &&
    value.kind === "account_processing" &&
    value.source_id === "AST-01" &&
    value.permission_tier === 0 &&
    Array.isArray(value.allowed_uses) &&
    value.allowed_uses.length === ACCOUNT_PROCESSING_ALLOWED_USES.length &&
    value.allowed_uses.every(
      (use, index) => use === ACCOUNT_PROCESSING_ALLOWED_USES[index],
    ) &&
    value.provider === null &&
    Array.isArray(value.scopes) &&
    value.scopes.length === 0 &&
    value.connector_account_id === null &&
    grantedFieldsAreConsistent &&
    (value.account_status === "active" || value.account_status === "frozen") &&
    typeof value.has_active_chart === "boolean" &&
    typeof value.regrant_will_restore_access === "boolean" &&
    (value.status !== "granted" || !value.regrant_will_restore_access) &&
    (!value.regrant_will_restore_access ||
      (value.account_status === "frozen" && value.status === "not_granted")) &&
    value.policy_version === ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION &&
    value.disclosure.text === ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT &&
    links.patternlike_terms ===
      ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS.patternlike_terms &&
    links.patternlike_privacy ===
      ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS.patternlike_privacy
  );
}
