import assert from "node:assert/strict";
import test from "node:test";

import {
  M9_SCHEMA_VERSION,
  PATTERN_GENERATION_REASONS_V9,
  type PatternStateDocumentV9,
} from "./m9-types.js";

test("M9 owns the source-update request and ready-plus-regeneration state", () => {
  assert.equal(M9_SCHEMA_VERSION, "0.9.0");
  assert.deepEqual(PATTERN_GENERATION_REASONS_V9, [
    "first_open",
    "first_open_retry",
    "failed_attempt_retry",
    "source_update",
  ]);

  const ready: PatternStateDocumentV9 = {
    schema_version: "0.9.0",
    state: "ready",
    chart: null,
    consent: null,
    generation: null,
    pattern: null,
    regeneration: {
      eligible: true,
      generation: null,
      failure: null,
    },
  };
  assert.equal(ready.regeneration?.eligible, true);
  assert.equal(Object.hasOwn(ready.regeneration!, "pattern_source_hash"), false);
});
