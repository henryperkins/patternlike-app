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
  // 1.1.0 is the Codex disclosure. `loadPatternGenerationGrant` returns null for
  // any other stored version, so bumping this is what makes an old grant stop
  // authorising generation -- the reader is asked again under the copy that
  // describes what actually happens.
  assert.equal(PATTERN_GENERATION_CONSENT_POLICY_VERSION, "1.1.0");
  assert.equal(PATTERN_CONSENT_CATEGORIES.length, 5);
  assert.ok(!PATTERN_CONSENT_CATEGORIES.includes("birth_accuracy_and_uncertainty" as never));
});

test("editorial_catalog stays in the wire enum although nothing emits it", () => {
  // Account-wide Pattern has no editorial admission outcome. The value remains
  // for clients and stored documents written while it did: a dead historical
  // wire value is safer than a schema break nothing needed.
  assert.ok(PATTERN_STATES.includes("editorial_catalog"));
  assert.ok(PATTERN_STATES.includes("consent_required"));
  assert.ok(PATTERN_STATES.includes("ready"));
});
