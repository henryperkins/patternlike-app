import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  buildTestCorpusManifest,
} from "../test/ontology-pipeline-fixtures.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  enablePatternAi,
  disablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../test/helpers.js";
import { enqueuePatternGeneration } from "./services/pattern-enqueue.js";
import { loadPatternJob } from "./services/pattern-stage-protocol.js";
import type {
  Env,
  OntologyPipelineMessage,
} from "./env.js";
import { isOntologyPipelineMessage, queue } from "./queue.js";
import {
  ONTOLOGY_PIPELINE_MAINTENANCE_CRON,
  scheduled,
} from "./scheduled.js";
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
  const values = {
    ONTOLOGY_PIPELINE_QUEUE: fakeQueue(),
    ONTOLOGY_PIPELINE_ROLLOUT: rollout,
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "high",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.5",
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
  };
  return Object.create(env, Object.getOwnPropertyDescriptors(values)) as Env;
}

async function reserveRun(reservationEnv = pipelineEnv("internal")): Promise<{
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
    reservationEnv,
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
  attempts = 1,
) {
  const batch = createMessageBatch<unknown>(
    queueName,
    bodies.map((body, index) => ({
      id: `ontology-message-${index}-${crypto.randomUUID()}`,
      timestamp: NOW,
      attempts,
      body,
    })),
  );
  const context = createExecutionContext();
  await queue(batch, deliveryEnv);
  return getQueueResult(batch, context);
}

async function seedStage(
  runId: string,
  target: "evaluating" | "regressing",
): Promise<void> {
  const stages = [
    "corpus_reading",
    "generating",
    "compiling",
    "evaluating",
    "regressing",
  ] as const;
  const targetIndex = stages.indexOf(target);
  for (let index = 0; index <= targetIndex; index += 1) {
    const stage = stages[index]!;
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = ?, stage_generation = ?, stage_cursor = 0, stage_attempt = 0,
           claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL,
           candidate_hash = COALESCE(candidate_hash, ?),
           compilation_report_hash = COALESCE(compilation_report_hash, ?),
           evaluation_report_hash = COALESCE(evaluation_report_hash, ?)
       WHERE run_id = ?`,
    ).bind(
      stage,
      index + 1,
      stage === "compiling" ? `sha256:${"3".repeat(64)}` : null,
      stage === "evaluating" ? `sha256:${"4".repeat(64)}` : null,
      stage === "regressing" ? `sha256:${"5".repeat(64)}` : null,
      runId,
    ).run();
  }
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = ?, updated_at = ?
     WHERE run_id = ?`,
  ).bind(NOW.toISOString(), NOW.toISOString(), runId).run();
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

  it("claims Task 7 stages and acks a closed terminal refusal without DLQ churn", async () => {
    const send = vi.fn(async () => undefined);
    const deliveryEnv = pipelineEnv("internal", {
      ONTOLOGY_PIPELINE_QUEUE: { send } as unknown as Queue<OntologyPipelineMessage>,
    });
    const reserved = await reserveRun(deliveryEnv);
    await seedStage(reserved.runId, "regressing");
    const message = { run_id: reserved.runId, stage_generation: 5 };

    for (let attempts = 1; attempts <= 4; attempts += 1) {
      const result = await deliver(ONTOLOGY_QUEUE, [message], deliveryEnv, attempts);
      expect(result.retryMessages, `delivery attempt ${attempts}`).toEqual([]);
    }

    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, stage_attempt, claim_token,
              lease_expires_at, dispatched_at, failure_class
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual({
      stage: "failed",
      stage_generation: 6,
      stage_attempt: 0,
      claim_token: null,
      lease_expires_at: null,
      dispatched_at: NOW.toISOString(),
      failure_class: "candidate_invalid",
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE resource_id = ? AND action = 'ontology_pipeline.claim_acquired'`,
    ).bind(reserved.runId).first()).toEqual({ count: 1 });

    await scheduled(
      createScheduledController({
        scheduledTime: NOW.getTime() + 60 * 60_000,
        cron: ONTOLOGY_PIPELINE_MAINTENANCE_CRON,
      }),
      deliveryEnv,
      createExecutionContext(),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("atomically claims a future-generation Task 7 handoff that races admission", async () => {
    const reserved = await reserveRun();
    await seedStage(reserved.runId, "evaluating");
    let raced = false;
    const racingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "batch") return Reflect.get(target, property, receiver);
        return async (statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await env.DB.prepare(
              `UPDATE pattern_ontology_pipeline_runs
               SET stage = 'regressing', stage_generation = 5,
                   stage_cursor = 0, stage_attempt = 0,
                   claim_token = NULL, lease_expires_at = NULL,
                   dispatched_at = NULL,
                   evaluation_report_hash = ?
               WHERE run_id = ?`,
            ).bind(`sha256:${"5".repeat(64)}`, reserved.runId).run();
          }
          return target.batch(statements);
        };
      },
    });
    const deliveryEnv = pipelineEnv("internal", { DB: racingDb });

    const result = await deliver(
      ONTOLOGY_QUEUE,
      [{ run_id: reserved.runId, stage_generation: 5 }],
      deliveryEnv,
    );

    expect(result.retryMessages).toEqual([]);
    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, claim_token, lease_expires_at, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual({
      stage: "failed",
      stage_generation: 6,
      claim_token: null,
      lease_expires_at: null,
      dispatched_at: expect.any(String),
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE resource_id = ? AND action = 'ontology_pipeline.claim_acquired'`,
    ).bind(reserved.runId).first()).toEqual({ count: 1 });
  });

  it("recovers a preclaim D1 failure through scheduled stale-dispatch repair after main retries", async () => {
    const send = vi.fn(async () => undefined);
    const baseEnv = pipelineEnv("internal", {
      ONTOLOGY_PIPELINE_QUEUE: { send } as unknown as Queue<OntologyPipelineMessage>,
    });
    const reserved = await reserveRun(baseEnv);
    const failingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "batch") return Reflect.get(target, property, receiver);
        return async () => { throw new Error("injected claim D1 outage"); };
      },
    });
    const failingEnv = pipelineEnv("internal", { DB: failingDb });
    for (let attempts = 1; attempts <= 3; attempts += 1) {
      const result = await deliver(
        ONTOLOGY_QUEUE,
        [reserved.message],
        failingEnv,
        attempts,
      );
      expect(result.retryMessages).toHaveLength(1);
    }

    const recoveredAt = new Date(NOW.getTime() + 16 * 60_000);
    await scheduled(
      createScheduledController({
        scheduledTime: recoveredAt.getTime(),
        cron: ONTOLOGY_PIPELINE_MAINTENANCE_CRON,
      }),
      baseEnv,
      createExecutionContext(),
    );

    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual({
      stage: "reserved",
      stage_generation: 0,
      claim_token: null,
      dispatched_at: recoveredAt.toISOString(),
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("Pattern queue admission", () => {
  const PATTERN_QUEUE = "patternlike-pattern-generation-dev";

  it("never parks a Pattern delivery as rollout_paused", async () => {
    // The class exists only as historical data. There is no rollout left to
    // pause for, so a delivery either does its stage's work or fails/cancels on
    // an ordinary check — it must never re-create the state the compatibility
    // repair exists to clear.
    await resetDb();
    disablePatternAi();
    try {
      await seedUser(IDENTITY_A);
      await confirmPreferences(USER_A);
      await seedChart(IDENTITY_A);
      await seedActiveOntology();
      enablePatternAi();

      const reserved = await enqueuePatternGeneration(env, IDENTITY_A, {
        idempotencyKey: "idem-queue-no-pause",
        consentPolicyVersion: "1.1.0",
        reason: "first_open",
        requestId: "req-queue-no-pause",
      });
      expect(reserved.ok, JSON.stringify(reserved)).toBe(true);
      if (!reserved.ok) return;
      const generationId = reserved.body.generation.generation_id;
      const job = await loadPatternJob(env, generationId);

      const result = await deliver(
        PATTERN_QUEUE,
        [{
          kind: "pattern_generation",
          job_id: job!.job_id,
          generation_id: generationId,
          stage_generation: job!.stage_generation,
        }],
        env,
      );
      expect(result.retryMessages).toEqual([]);

      expect(await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM jobs WHERE result_class = 'rollout_paused'`,
      ).first<{ n: number }>()).toEqual({ n: 0 });
    } finally {
      disablePatternAi();
    }
  });
});
