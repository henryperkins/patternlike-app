import assert from "node:assert/strict";
import test from "node:test";
import { portraitImageModelProvenance } from "./portrait-image-provenance.js";

test("legacy model projection uses saved identifiers without importing current model or CLI defaults", () => {
  for (const [sample, requested] of [
    [{}, null], [{ image_model: "historical-request" }, "historical-request"],
    [{ image_model: "gpt-image-2" }, "gpt-image-2"], [{ image_model: 42 }, null],
  ] as const) {
    const original = structuredClone(sample);
    assert.deepEqual(portraitImageModelProvenance(sample), {
      schema_version: "portrait-image-model-provenance/v1",
      requested_image_model: requested,
      observed_image_model: null,
      observation_status: "legacy_unrecorded",
      codex_cli_version: null,
    });
    assert.deepEqual(sample, original);
  }
});

test("inconsistent stored model evidence cannot be relabelled as a valid legacy record", () => {
  const recorded = {
    schema_version: "portrait-image-model-provenance/v1", requested_image_model: "gpt-image-2",
    observed_image_model: null, observation_status: "not_exposed", codex_cli_version: "0.153.3",
  } as const;
  assert.deepEqual(portraitImageModelProvenance({ image_model: "gpt-image-2", image_model_provenance: recorded }), recorded);
  for (const sample of [
    { image_model: "other", image_model_provenance: recorded },
    { image_model: "gpt-image-2", image_model_provenance: { ...recorded, observed_image_model: "gpt-image-2" } },
    { image_model: "gpt-image-2", image_model_provenance: null },
  ]) assert.throws(() => portraitImageModelProvenance(sample), /Invalid portrait image-model provenance/);
});
