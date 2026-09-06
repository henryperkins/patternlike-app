import { describe, expect, it } from "vitest";
import type { PublishedReading } from "../db/readings.js";
import { projectReadingResponse } from "./reading-product-projection.js";

describe("reading product projection", () => {
  it("projects a v3 artifact field by field", () => {
    const published = {
      record: { id: "rdg_v3_0001" },
      stored: {
        reading: {
          schema_version: "0.3.0",
          output_schema: "daily-reading-v3",
          reading_id: "rdg_v3_0001",
          local_date: "2026-08-09",
          generated_at: "2026-08-09T12:00:00.000Z",
          assembly_mode: "deterministic",
          revision: 1,
          locale: "en-US",
          domain_preference: undefined,
          paragraphs: [{
            paragraph_id: "par_v3_0001",
            role: "primary_theme",
            order: 1,
            text: "A bounded paragraph.",
            private_extra: "must not escape",
          }],
          fallback_used: false,
          private_extra: "must not escape",
        },
      },
    } as unknown as PublishedReading;

    expect(projectReadingResponse(published)).toEqual({
      schema_version: "0.3.0",
      reading: {
        schema_version: "0.3.0",
        output_schema: "daily-reading-v3",
        reading_id: "rdg_v3_0001",
        local_date: "2026-08-09",
        generated_at: "2026-08-09T12:00:00.000Z",
        assembly_mode: "deterministic",
        revision: 1,
        locale: "en-US",
        domain_preference: null,
        paragraphs: [{
          paragraph_id: "par_v3_0001",
          role: "primary_theme",
          order: 1,
          text: "A bounded paragraph.",
        }],
        fallback_used: false,
      },
      evidence_url: "/v1/readings/rdg_v3_0001/evidence",
    });
  });

  it("projects a v5 artifact through the guarded M5 response assertion", () => {
    const published = {
      record: { id: "rdg_v5_0001" },
      stored: {
        schema_version: "0.5.0",
        reading: {
          schema_version: "0.5.0",
          output_schema: "daily-reading-v5",
          reading_id: "rdg_v5_0001",
          local_date: "2026-08-09",
          generated_at: "2026-08-09T12:00:00.000Z",
          assembly_mode: "constrained_model",
          revision: 2,
          locale: "en-US",
          domain_preference: null,
          headline: "A narrower commitment",
          disclosure: "Generated with OpenAI from calculated facts.",
          paragraphs: [{
            paragraph_id: "par_v5_0001",
            role: "primary_theme",
            order: 1,
            text: "A bounded paragraph.",
          }],
        },
        evidence_header: {
          schema_version: "0.5.0",
          reading_id: "rdg_v5_0001",
          revision: 2,
          revision_reason: "safety_correction",
          generated_at: "2026-08-09T12:00:00.000Z",
          generation_input_id: `gin_sha256_${"1".repeat(64)}`,
          input_manifest_hash: `sha256:${"2".repeat(64)}`,
          content_hash: `sha256:${"3".repeat(64)}`,
          provider_response_hash: `sha256:${"4".repeat(64)}`,
          calculation: {
            chart_contract_id: "calc-contract-launch",
            cycle_policy_version: "1.4.0",
            daily_sky_policy_version: "1.0.0",
            ephemeris_data_version: "swisseph-2.10.03",
            container_digest: `sha256:${"5".repeat(64)}`,
            tzdb_version: "2025b",
            local_day_resolution_policy_version: "1.0.0",
          },
          model: {
            provider: "openai",
            model: "gpt-5.4",
            prompt_version: "1.0.0",
            selection_policy_version: "1.0.0",
            validation_policy_version: "1.0.0",
            provider_request_id: "resp_projection_0001",
            input_tokens: 100,
            output_tokens: 20,
          },
          validation: {
            status: "passed",
            policy_version: "1.0.0",
            checks: [{ code: "grounding", passed: true }],
          },
        },
        invalidation: null,
      },
    } as unknown as PublishedReading;

    expect(projectReadingResponse(published)).toEqual({
      schema_version: "0.5.0",
      reading: published.stored.reading,
      evidence_url: "/v1/readings/rdg_v5_0001/evidence",
    });
  });
});
