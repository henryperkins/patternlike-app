import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  buildTestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  advanceOntologyPipelineCursor,
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
  releaseExpiredOntologyPipelineLeases,
  retryOntologyPipelineStage,
} from "../db/ontology-pipeline.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import {
  buildOntologyPipelineCommand,
  ONTOLOGY_PIPELINE_COMMAND_VERSION,
} from "./ontology-pipeline-command.js";
import {
  dispatchUndispatchedOntologyPipelineRuns,
  enqueueOntologyPipelineRun,
  pauseOntologyPipelineDelivery,
} from "./ontology-pipeline-enqueue.js";
import { registerOntologyCorpus } from "./ontology-corpus.js";

const NOW = new Date("2026-08-21T15:00:00.000Z");

function fakeQueue(failures = 0): {
  queue: Queue<OntologyPipelineMessage>;
  send: ReturnType<typeof vi.fn>;
} {
  let remaining = failures;
  const send = vi.fn(async () => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error("queue unavailable");
    }
  });
  return {
    queue: { send } as unknown as Queue<OntologyPipelineMessage>,
    send,
  };
}

function configuredEnv(queue: Queue<OntologyPipelineMessage>): Env {
  return Object.assign(Object.create(env), {
    ONTOLOGY_PIPELINE_QUEUE: queue,
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
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
    OPENAI_API_KEY: "test-provider-key-never-frozen",
    AI_GATEWAY_ACCOUNT_ID: undefined,
    AI_GATEWAY_ID: undefined,
    AI_GATEWAY_TOKEN: undefined,
  }) as Env;
}

async function registeredCorpus(): Promise<{
  releaseId: string;
  corpusHash: string;
  excerpt: string;
  objectKey: string;
}> {
  const releaseId = `corpus-enqueue-${crypto.randomUUID()}`;
  const manifest = await buildTestCorpusManifest(
    releaseId,
    "en-US",
    "internal_synthetic",
  );
  const registered = await registerOntologyCorpus(env, manifest);
  return {
    releaseId,
    corpusHash: manifest.corpus_hash,
    excerpt: manifest.fragments[0]!.excerpt,
    objectKey: registered.corpus.objectKey,
  };
}

async function reserve(
  pipelineEnv: Env,
  corpusReleaseId: string,
  suffix = crypto.randomUUID(),
) {
  return enqueueOntologyPipelineRun(
    pipelineEnv,
    {
      idempotencyKey: `ontology-enqueue-${suffix}`,
      corpusReleaseId,
      candidateOntologyVersion: `1.0.0-pipeline-${suffix}`,
    },
    NOW,
  );
}

describe("ontology pipeline immutable command", () => {
  it("freezes the full reviewed identity and equal-model 100% threshold", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const command = await buildOntologyPipelineCommand(
      configuredEnv(queue),
      corpus.releaseId,
      "1.0.0-candidate",
    );

    expect(command).toEqual({
      command_version: ONTOLOGY_PIPELINE_COMMAND_VERSION,
      schema_version: "0.7.0",
      provider: "openai",
      candidate_ontology_version: "1.0.0-candidate",
      corpus: {
        corpus_release_id: corpus.releaseId,
        corpus_hash: corpus.corpusHash,
        license_class: "internal_synthetic",
        public_capable: false,
        object_key: corpus.objectKey,
      },
      generator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        prompt_version: "1.0.0",
        timeout_ms: 120000,
        max_output_tokens: 8000,
      },
      evaluator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        prompt_version: "1.0.0-evaluator",
        timeout_ms: 120000,
        max_output_tokens: 4000,
      },
      input_max_bytes: 98304,
      policy: {
        ontology_schema_version: "0.7.0",
        feature_policy_version: "1.0.0",
        compiler_policy_version: "1.0.0",
        regression_policy_version: "1.0.0",
        prohibited_claim_policy_version: "1.0.0",
        selection_policy_id: "pattern-selection-policy",
        selection_policy_version: "1.0.0",
        validation_policy_id: "pattern-validation-policy",
        validation_policy_version: "1.0.0",
        prohibited_claims: [
          "diagnosis",
          "prediction",
          "fate",
          "biographical fact",
        ],
      },
      configuration_equal: true,
      regression: {
        fixture_count: 30,
        maximum_provider_calls_per_fixture: 11,
        minimum_pass_rate: 1,
      },
      daily_provider_call_limit: 500,
      failed_artifact_retention_days: 7,
    });
    const frozen = JSON.stringify(command);
    expect(frozen).not.toContain(corpus.excerpt);
    expect(frozen).not.toContain("test-provider-key-never-frozen");
    expect(frozen).not.toContain("fragments");
  });
});

describe("ontology pipeline reservation and outbox", () => {
  it("replays an exact immutable command without rewriting or redispatching", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const first = await reserve(pipelineEnv, corpus.releaseId, suffix);
    const replay = await reserve(pipelineEnv, corpus.releaseId, suffix);

    expect(first.status).toBe("reserved");
    expect(replay).toEqual({ ...first, status: "replay" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      run_id: first.runId,
      stage_generation: 0,
    });
    expect(Object.keys(send.mock.calls[0]![0] as object).sort()).toEqual([
      "run_id",
      "stage_generation",
    ]);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first()).toEqual({ count: 1 });
  });

  it("refuses a duplicate key when any frozen command field differs", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    await reserve(pipelineEnv, corpus.releaseId, suffix);
    pipelineEnv.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = "501";

    await expect(reserve(pipelineEnv, corpus.releaseId, suffix))
      .rejects.toMatchObject({ code: "ontology_pipeline_command_conflict" });
    expect(await env.DB.prepare(
      `SELECT configuration_json FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first<{ configuration_json: string }>())
      .toMatchObject({ configuration_json: expect.stringContaining('"daily_provider_call_limit":500') });
  });

  it("admits one durable row under a concurrent last-writer reservation race", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const results = await Promise.all([
      reserve(pipelineEnv, corpus.releaseId, suffix),
      reserve(pipelineEnv, corpus.releaseId, suffix),
    ]);

    expect(results.map((result) => result.status).sort())
      .toEqual(["replay", "reserved"]);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first()).toEqual({ count: 1 });
  });

  it("leaves a failed send durable and the undispatched sweep repairs it", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue(1);
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    expect(result.dispatched).toBe(false);
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({ dispatched_at: null });

    expect(await dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({ dispatched_at: NOW.toISOString() });
  });

  it("does not dispatch an exact replay before retry backoff expires", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const result = await reserve(pipelineEnv, corpus.releaseId, suffix);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-backoff",
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await retryOntologyPipelineStage(
      env,
      claim,
      new Date("2026-08-21T15:20:00.000Z"),
    )).toBe(true);

    await expect(reserve(pipelineEnv, corpus.releaseId, suffix)).resolves
      .toMatchObject({ status: "replay", dispatched: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a rollout-paused outbox quiet until rollout resumes", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    expect(await pauseOntologyPipelineDelivery(
      pipelineEnv,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
    )).toBe(true);
    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "off";

    await expect(dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .resolves.toEqual({ dispatched: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);

    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "internal";
    await expect(dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .resolves.toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("ontology pipeline generation and claim CAS", () => {
  it("claims exactly five minutes and rejects claim theft", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const message = { run_id: result.runId, stage_generation: 0 };
    const claim = await claimOntologyPipelineRun(env, message, NOW, "claim-owner-a");
    expect(claim).toMatchObject({
      status: "claimed",
      claimToken: "claim-owner-a",
      leaseExpiresAt: "2026-08-21T15:05:00.000Z",
    });
    await expect(claimOntologyPipelineRun(env, message, NOW, "claim-thief"))
      .resolves.toEqual({ status: "duplicate" });
    if (claim.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        claim,
        "execution_error",
        new Date("2026-08-21T15:00:01.000Z"),
      );
    }
  });

  it("rejects a stale owner and retries at the same generation", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-live",
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await retryOntologyPipelineStage(
      env,
      { ...claim, claimToken: "claim-stale" },
      new Date("2026-08-21T15:00:10.000Z"),
    )).toBe(false);
    expect(await retryOntologyPipelineStage(
      env,
      claim,
      new Date("2026-08-21T15:00:10.000Z"),
    )).toBe(true);
    expect(await env.DB.prepare(
      `SELECT stage_generation, stage_attempt, claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage_generation: 0,
      stage_attempt: 1,
      claim_token: null,
      dispatched_at: null,
    });
    const cleanup = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      new Date("2026-08-21T15:00:10.000Z"),
      "claim-retry-cleanup",
    );
    if (cleanup.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        cleanup,
        "execution_error",
        new Date("2026-08-21T15:00:11.000Z"),
      );
    }
  });

  it("advances iterative cursors and named stages by successor generation", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const reserved = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-reserved",
    );
    expect(reserved.status).toBe("claimed");
    if (reserved.status !== "claimed") return;
    expect(await advanceOntologyPipelineStage(
      env,
      reserved,
      "corpus_reading",
      {},
      new Date("2026-08-21T15:00:01.000Z"),
    )).toBe(true);
    const corpusClaim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 1 },
      new Date("2026-08-21T15:00:01.000Z"),
      "claim-corpus",
    );
    expect(corpusClaim.status).toBe("claimed");
    if (corpusClaim.status !== "claimed") return;
    expect(await advanceOntologyPipelineStage(
      env,
      corpusClaim,
      "generating",
      {},
      new Date("2026-08-21T15:00:02.000Z"),
    )).toBe(true);
    const generating = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 2 },
      new Date("2026-08-21T15:00:02.000Z"),
      "claim-generating",
    );
    expect(generating.status).toBe("claimed");
    if (generating.status !== "claimed") return;
    expect(await advanceOntologyPipelineCursor(
      env,
      generating,
      new Date("2026-08-21T15:00:03.000Z"),
    )).toBe(true);
    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, stage_cursor, stage_attempt,
              claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage: "generating",
      stage_generation: 3,
      stage_cursor: 1,
      stage_attempt: 0,
      claim_token: null,
      dispatched_at: null,
    });
    const cleanup = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 3 },
      new Date("2026-08-21T15:00:03.000Z"),
      "claim-cursor-cleanup",
    );
    if (cleanup.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        cleanup,
        "execution_error",
        new Date("2026-08-21T15:00:04.000Z"),
      );
    }
  });

  it("recovers an expired lease without spending an attempt and redelivers", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-crashed",
    );
    expect(claim.status).toBe("claimed");

    const afterExpiry = new Date("2026-08-21T15:05:01.000Z");
    expect(await releaseExpiredOntologyPipelineLeases(env, afterExpiry)).toBe(1);
    expect(await dispatchUndispatchedOntologyPipelineRuns(
      pipelineEnv,
      afterExpiry,
    )).toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const recovered = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      afterExpiry,
      "claim-redelivery",
    );
    expect(recovered).toMatchObject({
      status: "claimed",
      stageGeneration: 0,
      stageAttempt: 0,
      claimToken: "claim-redelivery",
    });
  });
});
