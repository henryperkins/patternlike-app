import assert from "node:assert/strict";
import test from "node:test";

import {
  M7_SCHEMA_VERSION,
  PATTERN_CONSENT_CATEGORIES,
  PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  PATTERN_STATES,
} from "./m7-types.js";

test("M7 schema version is 0.7.0", () => {
  assert.equal(M7_SCHEMA_VERSION, "0.7.0");
});

test("Pattern consent policy is independently versioned", () => {
  assert.equal(PATTERN_GENERATION_CONSENT_POLICY_VERSION, "1.0.0");
  assert.equal(PATTERN_CONSENT_CATEGORIES.length, 5);
  assert.ok(!PATTERN_CONSENT_CATEGORIES.includes("birth_accuracy_and_uncertainty" as never));
});

test("editorial_catalog is a first-open dual-path state, not a generation stage", () => {
  assert.ok(PATTERN_STATES.includes("editorial_catalog"));
  assert.ok(PATTERN_STATES.includes("consent_required"));
  assert.ok(PATTERN_STATES.includes("ready"));
});
