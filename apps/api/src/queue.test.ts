import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  buildTestCorpusManifest,
} from "../test/ontology-pipeline-fixtures.js";
import type {
  Env,
  OntologyPipelineMessage,
} from "./env.js";
import { isOntologyPipelineMessage, queue } from "./queue.js";
import { enqueueOntologyPipelineRun } from "./services/ontology-pipeline-enqueue.js";
import { registerOntologyCorpus } from "./services/ontology-corpus.js";

const ONTOLOGY_QUEUE = "patternlike-ontology-pipeline-dev";
const WRONG_QUEUE = "patternlike-daily-readings-dev";
const NOW = new Date("2026-08-21T15:10:00.000Z");

function fakeQueue(): Queue<OntologyPipelineMessage> {
  return { send: vi.fn(async () => {}) } as unknown as Queue<OntologyPipelineMessage>;
}

function pipelineEnv(
  rollout: "off" | "internal",
  overrides: Partial<Env> = {},
): Env {
  return Object.assign(Object.create(env), {
    ONTOLOGY_PIPELINE_QUEUE: fakeQueue(),
    ONTOLOGY_PIPELINE_ROLLOUT: rollout,
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "high",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.0",
    OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS: "8000",
    OPENAI_ONTOLOGY_EVALUATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_EVALUATOR_REASONING: "high",
    OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0-evaluator",
    OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS: "4000",
    ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "98304",
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT: "500",
    ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS: "7",
    OPENAI_CREDENTIAL_SOURCE: "worker",
    OPENAI_API_KEY: "test-key",
    AI_GATEWAY_ACCOUNT_ID: undefined,
    AI_GATEWAY_ID: undefined,
    AI_GATEWAY_TOKEN: undefined,
    ...overrides,
  }) as Env;
}

async function reserveRun(): Promise<{
  runId: string;
  message: OntologyPipelineMessage;
}> {
  const releaseId = `corpus-queue-${crypto.randomUUID()}`;
  const manifest = await buildTestCorpusManifest(
    releaseId,
    "en-US",
    "internal_synthetic",
  );
  await registerOntologyCorpus(env, manifest);
  const result = await enqueueOntologyPipelineRun(
    pipelineEnv("internal"),
    {
      idempotencyKey: `queue-${crypto.randomUUID()}`,
      corpusReleaseId: releaseId,
      candidateOntologyVersion: `1.0.0-queue-${crypto.randomUUID()}`,
    },
    NOW,
  );
  return {
    runId: result.runId,
    message: { run_id: result.runId, stage_generation: 0 },
  };
}

async function deliver(
  queueName: string,
  bodies: unknown[],
  deliveryEnv: Env,
) {
  const batch = createMessageBatch<unknown>(
    queueName,
    bodies.map((body, index) => ({
      id: `ontology-message-${index}-${crypto.randomUUID()}`,
      timestamp: NOW,
      attempts: 1,
      body,
    })),
  );
  const context = createExecutionContext();
  await queue(batch, deliveryEnv);
  return getQueueResult(batch, context);
}

describe("ontology queue admission", () => {
  it("accepts only an exact structured-clone-safe two-field message", () => {
    expect(isOntologyPipelineMessage({
      run_id: "oprun_valid-1",
      stage_generation: 0,
    })).toBe(true);
    for (const invalid of [
      null,
      [],
      { run_id: "oprun_valid-1" },
      { run_id: "", stage_generation: 0 },
      { run_id: "oprun_valid-1", stage_generation: -1 },
      { run_id: "oprun_valid-1", stage_generation: 1.5 },
      { run_id: "oprun_valid-1", stage_generation: 0, kind: "ontology_pipeline" },
      { run_id: "PRIVATE corpus text", stage_generation: 0 },
    ]) {
      expect(isOntologyPipelineMessage(invalid)).toBe(false);
    }
  });

  it("acks malformed and unknown bodies closed without throwing", async () => {
    const result = await deliver(
      ONTOLOGY_QUEUE,
      [null, { kind: "ontology_pipeline" }, {
        run_id: "oprun_valid-1",
        stage_generation: 0,
        private_prompt: "must not route",
      }],
      pipelineEnv("off"),
    );
    expect(result.retryMessages).toEqual([]);
  });

  it("rejects a valid ontology body arriving on another queue", async () => {
    const result = await deliver(
      WRONG_QUEUE,
      [{ run_id: "oprun_valid-1", stage_generation: 0 }],
      pipelineEnv("off"),
    );
    expect(result.retryMessages).toEqual([]);
  });

  it("durably pauses rollout-off before R2, keyring, decryption, or budget", async () => {
    const reserved = await reserveRun();
    const noSensitiveAccess = pipelineEnv("off");
    Object.defineProperties(noSensitiveAccess, {
      ARTIFACTS: {
        get: () => { throw new Error("R2 accessed while off"); },
      },
      ONTOLOGY_PIPELINE_ARTIFACT_KEYRING: {
        get: () => { throw new Error("keyring accessed while off"); },
      },
    });

    const result = await deliver(
      ONTOLOGY_QUEUE,
      [reserved.message],
      noSensitiveAccess,
    );
    expect(result.retryMessages).toEqual([]);
    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, stage_attempt, claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual({
      stage: "reserved",
      stage_generation: 0,
      stage_attempt: 0,
      claim_token: null,
      dispatched_at: null,
    });
    expect(await env.DB.prepare(
      `SELECT used_calls FROM pattern_ontology_provider_daily_usage
       WHERE utc_date = '2026-08-21'`,
    ).first()).toBeNull();
  });

  it("routes enabled work through the ontology executor and acks committed progress", async () => {
    const reserved = await reserveRun();
    const result = await deliver(
      ONTOLOGY_QUEUE,
      [reserved.message],
      pipelineEnv("internal"),
    );
    expect(result.retryMessages).toEqual([]);
    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, claim_token, stage_attempt
       FROM pattern_ontology_pipeline_runs
       WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual({
      stage: "corpus_reading",
      stage_generation: 1,
      claim_token: null,
      stage_attempt: 0,
    });
  });
});
