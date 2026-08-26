import assert from "node:assert/strict";
import test from "node:test";

import {
  GEOCODER_CONSENT_ALLOWED_USES,
  GEOCODER_CONSENT_POLICY_VERSION,
  M8_SCHEMA_VERSION,
  type PlaceSearchRequest,
  type ReadingHistoryResponse,
} from "./index.js";

test("M8 consumer constants pin the frozen package and consent policy", () => {
  assert.equal(M8_SCHEMA_VERSION, "0.8.0");
  assert.equal(
    GEOCODER_CONSENT_POLICY_VERSION,
    "google-places-geocoding-v4-2026-08-26",
  );
  assert.deepEqual(GEOCODER_CONSENT_ALLOWED_USES, [
    "chart_fact",
    "timezone_resolution",
  ]);
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
