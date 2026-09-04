import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_PROCESSING_ALLOWED_USES,
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS,
  ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT,
  ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION,
  GEOCODER_CONSENT_ALLOWED_USES,
  GEOCODER_CONSENT_POLICY_VERSION,
  GEOCODER_CONSENT_SCHEMA_VERSION,
  GEOCODER_PROVIDER,
  M8_SCHEMA_VERSION,
  type AccountProcessingConsentResponse,
  type PlaceSearchRequest,
  type ReadingHistoryResponse,
} from "./index.js";

test("place requests retain M8 while Geoapify consent uses its explicit successor", () => {
  assert.equal(M8_SCHEMA_VERSION, "0.8.0");
  assert.equal(GEOCODER_CONSENT_SCHEMA_VERSION, "0.8.1");
  assert.equal(GEOCODER_PROVIDER, "geoapify");
  assert.equal(
    GEOCODER_CONSENT_POLICY_VERSION,
    "geoapify-2026-09-04",
  );
  assert.deepEqual(GEOCODER_CONSENT_ALLOWED_USES, [
    "chart_fact",
    "timezone_resolution",
  ]);
});

test("account-processing consent exports the current immutable recovery contract", () => {
  assert.equal(
    ACCOUNT_PROCESSING_CONSENT_POLICY_VERSION,
    "account-processing-v1-2026-08-28",
  );
  assert.deepEqual(ACCOUNT_PROCESSING_ALLOWED_USES, [
    "chart_fact",
    "cycle_detection",
    "uncertainty_model",
  ]);
  assert.equal(
    ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS.patternlike_terms,
    "/terms.html",
  );
  assert.match(ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT, /freezing the account/);

  const response = {
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
    account_status: "frozen",
    has_active_chart: true,
    regrant_will_restore_access: true,
    policy_version: "account-processing-v1-2026-08-28",
    granted_at: null,
    ui_surface: null,
    disclosure: {
      text: ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_TEXT,
      links: ACCOUNT_PROCESSING_CONSENT_DISCLOSURE_LINKS,
    },
  } satisfies AccountProcessingConsentResponse;

  assert.equal(response.regrant_will_restore_access, true);
});

test("public place requests stay provider-neutral", () => {
  const request = {
    query: "São Paulo",
    locale: "pt-BR",
    session_token: "3f70c334-b6f4-41c6-87f0-fdf3afb80da8",
  } satisfies PlaceSearchRequest;

  assert.equal("provider" in request, false);
  assert.equal("provider_id" in request, false);
});

test("reading history exposes revision-specific Save metadata", () => {
  const response = {
    schema_version: "0.8.0",
    view: "saved",
    items: [],
    next_cursor: null,
  } satisfies ReadingHistoryResponse;

  assert.equal(response.view, "saved");
});
