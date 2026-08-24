import { canonicalJson } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDb } from "../../test/helpers.js";
import {
  claimCodexProviderJob,
  completeCodexProviderJob,
} from "../db/codex-provider-jobs.js";
import {
  OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS,
  OPENAI_ONTOLOGY_EVALUATOR_MODEL,
  OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION,
  OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS,
  OPENAI_ONTOLOGY_GENERATOR_MODEL,
  OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
  ONTOLOGY_PIPELINE_INPUT_MAX_BYTES,
  type OntologyPipelineConfigPin,
} from "../middleware/config-guard.js";
import { putCodexProviderArtifact } from "./codex-provider-artifacts.js";
import { createCodexOntologyPublisher } from "./codex-ontology-publisher.js";
import type { OntologyGeneratorPacket } from "./ontology-packet.js";
import type { OntologyPassOptions } from "./ontology-publisher.js";

const textEncoder = new TextEncoder();
const pin: OntologyPipelineConfigPin = {
  generator_model: OPENAI_ONTOLOGY_GENERATOR_MODEL,
  generator_reasoning: "high",
  generator_prompt_version: OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
  generator_max_output_tokens: OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS,
  evaluator_model: OPENAI_ONTOLOGY_EVALUATOR_MODEL,
  evaluator_reasoning: "high",
  evaluator_prompt_version: OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION,
  evaluator_max_output_tokens: OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS,
  input_max_bytes: ONTOLOGY_PIPELINE_INPUT_MAX_BYTES,
};

function options(reserve = vi.fn(async () => ({ ok: true as const, used: 1 }))): OntologyPassOptions {
  return {
    requestId: "opreq_codex_publisher_fixture",
    timeoutMs: 900_000,
    configuration: pin,
    reserve,
    codexJob: {
      ownerId: "oprun_codex_ontology_fixture",
      stageGeneration: 2,
      stageAttempt: 0,
      dailyCallLimit: 500,
    },
  };
}

const packet = {
  serialized: canonicalJson({ fixture: true }),
} as OntologyGeneratorPacket;

describe("Codex ontology publisher", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
      version: 1,
      keys: {
        "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      },
    });
  });

  it("waits without reserving, then adopts a validated generator result", async () => {
    const reserve = vi.fn(async () => ({ ok: true as const, used: 1 }));
    const publisher = createCodexOntologyPublisher(env);
    const pending = await publisher.generate(packet, options(reserve));
    expect(pending).toEqual({
      ok: false,
      code: "publisher_pending",
      job_id: expect.stringMatching(/^cpjob_/),
    });
    expect(reserve).not.toHaveBeenCalled();

    const claim = await claimCodexProviderJob(
      env,
      new Date("2030-08-24T00:00:00.000Z"),
    );
    if (claim.status !== "claimed") throw new Error("claim missing");
    const raw = canonicalJson({
      schema_version: "0.7.0",
      records: [],
      complete: true,
    });
    const response = await putCodexProviderArtifact(
      env,
      {
        jobId: claim.job.id,
        pipeline: "ontology",
        ownerId: claim.job.ownerId,
        pass: "generator",
        stageGeneration: 2,
        stageAttempt: 0,
        role: "response",
      },
      textEncoder.encode(raw),
    );
    await completeCodexProviderJob(
      env,
      {
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        response: response.artifact,
        providerRequestId: "thread_ontology_generator_1",
        inputTokens: 100,
        outputTokens: 20,
      },
      new Date("2030-08-24T00:01:00.000Z"),
    );

    expect(await publisher.generate(packet, options(reserve))).toEqual({
      ok: true,
      value: JSON.parse(raw),
      raw,
      metadata: {
        provider: "codex",
        pass: "generator",
        model: OPENAI_ONTOLOGY_GENERATOR_MODEL,
        prompt_version: OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION,
        provider_request_id: "thread_ontology_generator_1",
        input_tokens: 100,
        output_tokens: 20,
        provider_response_hash: response.artifact.plaintextHash,
      },
    });
    expect(reserve).not.toHaveBeenCalled();
  });
});
