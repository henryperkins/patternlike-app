import {
  ACCOUNT_PROCESSING_ALLOWED_USES,
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS,
} from "@patternlike/shared";
import type { AccountProcessingConsentDocument } from "./api-client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAccountProcessingConsentResponse(
  value: unknown,
): value is AccountProcessingConsentDocument {
  if (!isRecord(value) || !isRecord(value.disclosure)) return false;
  const links = value.disclosure.links;
  if (!isRecord(links)) return false;

  const grantedFieldsAreConsistent = value.status === "granted"
    ? typeof value.consent_id === "string" &&
      value.consent_id.length > 0 &&
      typeof value.granted_at === "string" &&
      value.granted_at.length > 0 &&
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
    typeof value.regrant_will_restore_access === "boolean" &&
    (!value.regrant_will_restore_access ||
      (value.account_status === "frozen" && value.status === "not_granted")) &&
    typeof value.policy_version === "string" &&
    value.policy_version.length > 0 &&
    typeof value.disclosure.text === "string" &&
    value.disclosure.text.length > 0 &&
    links.patternlike_terms ===
      ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS.patternlike_terms &&
    links.patternlike_privacy ===
      ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS.patternlike_privacy
  );
}
