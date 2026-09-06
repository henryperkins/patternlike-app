import type { PortraitImageModelProvenance, RecordedPortraitImageModelProvenance } from "./portrait-types.js";

export function isRecordedPortraitImageModelProvenance(value: unknown): value is RecordedPortraitImageModelProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 5
    && item.schema_version === "portrait-image-model-provenance/v1"
    && item.requested_image_model === "gpt-image-2"
    && item.observed_image_model === null
    && item.observation_status === "not_exposed"
    && item.codex_cli_version === "0.153.3";
}

/** Interpret only saved evidence. Current runtime defaults cannot fill history. */
export function portraitImageModelProvenance(sample: { image_model?: unknown; image_model_provenance?: unknown }): PortraitImageModelProvenance {
  if (sample.image_model_provenance !== undefined) {
    if (!isRecordedPortraitImageModelProvenance(sample.image_model_provenance)
      || sample.image_model !== sample.image_model_provenance.requested_image_model) throw new Error("Invalid portrait image-model provenance");
    return { ...sample.image_model_provenance };
  }
  return {
    schema_version: "portrait-image-model-provenance/v1",
    requested_image_model: typeof sample.image_model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(sample.image_model) ? sample.image_model : null,
    observed_image_model: null,
    observation_status: "legacy_unrecorded",
    codex_cli_version: null,
  };
}
