import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./index.js";
import type { Env, GenerationMessage } from "./env.js";
import {
  IDENTITY_A,
  READING_CODEX_PUBLISHER_VARS,
  SILENT_READING_QUEUE,
  USER_A,
  confirmPreferences,
  enableReadingCodex,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../test/helpers.js";
import {
  candidateFor,
  claimReadingJob,
  completeReadingJob,
} from "../test/codex-reading-runner.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "./db/consents.js";
import { claimJob, releaseClaimForPublisherPending } from "./db/generation.js";
import {
  enqueueConstrainedReading,
  resolveV5TargetDate,
} from "./services/enqueue.js";
import { dispatchGeneration } from "./services/generate-daily-reading.js";
import {
  buildTestCorpusManifest,
  testOntologyPipelineArtifactKeyring,
} from "../test/ontology-pipeline-fixtures.js";
import { registerOntologyCorpus } from "./services/ontology-corpus.js";
import {
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
} from "./db/ontology-pipeline.js";
import { enqueueOntologyPipelineRun } from "./services/ontology-pipeline-enqueue.js";
import {
  createOntologyPipelineArtifactEnvelope,
  ontologyPipelineArtifactIdentity,
  ontologyPipelineArtifactObjectKey,
} from "./services/ontology-pipeline-artifacts.js";

const ONTOLOGY_MAINTENANCE_CRON = "7,22,37,52 * * * *";

function hybridEnv(db: D1Database = env.DB): Env {
  return {
    ...env,
    DB: db,
    READING_V5_ROLLOUT: "hybrid",
    ...READING_CODEX_PUBLISHER_VARS,
  };
}

function ontologyScheduledEnv(
  queue: Queue,
  overrides: Partial<Env> = {},
): Env {
  return Object.assign(Object.create(hybridEnv()), {
    ONTOLOGY_PIPELINE_QUEUE: queue,
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "xhigh",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.5",
    OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS: "8000",
    OPENAI_ONTOLOGY_EVALUATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_EVALUATOR_REASONING: "xhigh",
    OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0-evaluator",
    OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS: "4000",
    ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "98304",
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT: "500",
    ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS: "7",
    ONTOLOGY_PIPELINE_ARTIFACT_KEYRING:
      testOntologyPipelineArtifactKeyring(),
    // The ontology pipeline's own OpenAI transport, named explicitly. It used
    // to arrive by accident through the reading publisher's variables; Daily
    // has no OpenAI credential any more, and one pipeline must not depend on
    // another's configuration to resolve.
    OPENAI_CREDENTIAL_SOURCE: "worker",
    OPENAI_API_KEY: "sk-test-ontology",
    ...overrides,
  }) as Env;
}

/** A Daily reading parked on a real durable Codex job, waiting for a nudge. */
async function parkedReadingFixture(): Promise<{
  jobId: string;
  readingId: string;
}> {
  enableReadingCodex();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, "America/Chicago");
  await seedChart(IDENTITY_A);
  const at = "2026-08-27T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version,
       allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
     VALUES ('cns_scheduled_ai_0001', ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    at,
    at,
    at,
  );
  const targetLocalDate = resolveV5TargetDate("America/Chicago", new Date());
  if (!targetLocalDate) throw new Error("test date did not resolve");
  const enqueued = await enqueueConstrainedReading(
    { ...hybridEnv(), READING_QUEUE: SILENT_READING_QUEUE } as Env,
    USER_A,
    {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate,
    },
  );
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
  const claim = await claimJob(hybridEnv(), enqueued.jobId);
  if (!claim) throw new Error("claim missing");
  const outcome = await dispatchGeneration(hybridEnv(), claim);
  if (outcome.ok || outcome.reason !== "publisher_pending") {
    throw new Error("expected a durable wait");
  }
  if (
    !await releaseClaimForPublisherPending(
      hybridEnv(),
      claim.jobId,
      claim.claimToken,
    )
  ) {
    throw new Error("release did not commit");
  }
  return { jobId: enqueued.jobId, readingId: enqueued.readingId };
}

async function reserveOntologyRun(
  pipelineEnv: Env,
  now: Date,
  suffix = crypto.randomUUID(),
) {
  const corpus = await buildTestCorpusManifest(
    `corpus-scheduled-${suffix}`,
    "en-US",
    "internal_synthetic",
  );
  await registerOntologyCorpus(pipelineEnv, corpus);
  return enqueueOntologyPipelineRun(
    pipelineEnv,
    {
      idempotencyKey: `ontology-scheduled-${suffix}`,
      corpusReleaseId: corpus.corpus_release_id,
      candidateOntologyVersion: `ontology-scheduled-${suffix}`,
    },
    now,
  );
}

beforeEach(resetDb);

describe("scheduled Worker entry point", () => {
  it("exports scheduled beside the incumbent fetch and queue handlers", () => {
    expect(worker.fetch).toBeTypeOf("function");
    expect(worker.queue).toBeTypeOf("function");
    expect(worker.scheduled).toBeTypeOf("function");
  });

  it("uses ScheduledController.scheduledTime as the scheduler clock", async () => {
    await env.DB.prepare(
      `INSERT INTO users
         (id, crypto_subject, status, locale, timezone, entitlement_tier,
          next_due_at, created_at, updated_at)
       VALUES ('usr_scheduled_clock', 'cs_scheduled_clock', 'active', 'en-US',
               'UTC', 'free', NULL, '2031-01-01T00:00:00.000Z',
               '2031-01-01T00:00:00.000Z')`,
    ).run();
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");
    const controller = createScheduledController({
      scheduledTime,
      cron: "*/15 * * * *",
    });
    const ctx = createExecutionContext();

    await worker.scheduled(controller, hybridEnv(), ctx);

    const [row] = await rows<{ next_due_at: string | null }>(
      "SELECT next_due_at FROM users WHERE id = 'usr_scheduled_clock'",
    );
    expect(Date.parse(row!.next_due_at!)).toBeGreaterThan(Date.parse("2031-01-01T00:00:00.000Z"));
  });

  it("checks secure configuration before the first scheduler query", async () => {
    const prepare = vi.fn(() => {
      throw new Error("scheduler queried before configuration was checked");
    });
    const guardedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") return prepare;
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const controller = createScheduledController({
      scheduledTime: Date.parse("2031-01-02T12:00:00.000Z"),
      cron: "*/15 * * * *",
    });
    const ctx = createExecutionContext();
    const invalid = {
      ...hybridEnv(guardedDb),
      READING_PUBLISHER: undefined,
    };

    await expect(worker.scheduled(controller, invalid, ctx)).resolves.toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("recovers a legacy paused Pattern job on the ordinary maintenance tick", async () => {
    // `result_class = 'rollout_paused'` is historical: nothing creates one now.
    // The repair has to ride the tick every deployment already runs, or the
    // rows a prior deployment parked would need an operator to find them.
    await seedUser(IDENTITY_A);
    await rows(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, result_class, attempts,
          available_at, dispatched_at, created_at)
       VALUES ('job_scheduled_legacy_pause', 'generate_pattern', ?,
               'idem-scheduled-legacy-pause', 'queued', 'rollout_paused', 0,
               NULL, NULL, '2031-01-01T00:00:00.000Z')`,
      USER_A,
    );
    const controller = createScheduledController({
      scheduledTime: Date.parse("2031-01-02T12:00:00.000Z"),
      cron: "*/15 * * * *",
    });
    const ctx = createExecutionContext();

    await worker.scheduled(controller, hybridEnv(), ctx);
    await waitOnExecutionContext(ctx);

    const [row] = await rows<{ status: string; result_class: string | null }>(
      "SELECT status, result_class FROM jobs WHERE id = 'job_scheduled_legacy_pause'",
    );
    expect(row).toEqual({ status: "queued", result_class: null });
  });

  it("redrives an undispatched privacy outbox job on the scheduled clock", async () => {
    await seedUser(IDENTITY_A);
    await rows("UPDATE users SET status = 'frozen' WHERE id = ?", USER_A);
    await rows(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at)
       VALUES ('job_scheduled_export', 'export_account', ?, 'idem-scheduled-export',
               'queued', 0, '2031-01-01T00:00:00.000Z')`,
      USER_A,
    );
    const send = vi.fn(async () => undefined);
    const privacyQueue = { send } as unknown as Queue;
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");

    await worker.scheduled(
      createScheduledController({ scheduledTime, cron: "*/15 * * * *" }),
      { ...hybridEnv(), PRIVACY_QUEUE: privacyQueue },
      createExecutionContext(),
    );

    expect(send).toHaveBeenCalledWith({
      kind: "privacy",
      job_id: "job_scheduled_export",
      job_type: "export_account",
    });
    expect(
      await rows("SELECT dispatched_at FROM jobs WHERE id = 'job_scheduled_export'"),
    ).toEqual([{ dispatched_at: "2031-01-02T12:00:00.000Z" }]);
  });

  it("attempts privacy maintenance even when the reading lane fails", async () => {
    await seedUser(IDENTITY_A);
    await rows("UPDATE users SET status = 'frozen' WHERE id = ?", USER_A);
    await rows(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at)
       VALUES ('job_scheduled_after_failure', 'export_account', ?,
               'idem-scheduled-after-failure', 'queued', 0,
               '2031-01-01T00:00:00.000Z')`,
      USER_A,
    );
    let readingLaneFailed = false;
    const db = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (query: string) => {
            if (!readingLaneFailed) {
              readingLaneFailed = true;
              throw new Error("reading lane unavailable");
            }
            return target.prepare(query);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const send = vi.fn(async () => undefined);
    const scheduledTime = Date.parse("2031-01-02T12:00:00.000Z");

    await expect(
      worker.scheduled(
        createScheduledController({ scheduledTime, cron: "*/15 * * * *" }),
        {
          ...hybridEnv(db),
          PRIVACY_QUEUE: { send } as unknown as Queue,
        },
        createExecutionContext(),
      ),
    ).rejects.toThrow("reading lane unavailable");

    expect(send).toHaveBeenCalledWith({
      kind: "privacy",
      job_id: "job_scheduled_after_failure",
      job_type: "export_account",
    });
  });

  it("repairs a lost Daily nudge on the incumbent cron", async () => {
    // The state this recovers is invisible to every other sweep: the Daily job
    // is queued, unclaimed, and still marked dispatched, so the outbox query
    // skips it and the expired-lease query cannot see it. Without this pass a
    // lost nudge is a reader who never gets a reading.
    const parked = await parkedReadingFixture();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));
    await rows("UPDATE jobs SET dispatched_at = ? WHERE id = ?", "2020-01-01T00:00:00.000Z", parked.jobId);

    const sent: GenerationMessage[] = [];
    const cronEnv = {
      ...hybridEnv(),
      READING_QUEUE: {
        send: async (message: GenerationMessage) => {
          sent.push(message);
        },
      } as unknown as typeof env.READING_QUEUE,
    } as Env;
    const ctx = createExecutionContext();
    await worker.scheduled(
      createScheduledController({
        scheduledTime: Date.now(),
        cron: "*/15 * * * *",
      }),
      cronEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(sent).toEqual([
      { job_id: parked.jobId, reading_id: parked.readingId },
    ]);
    const [job] = await rows<{ dispatched_at: string | null }>(
      "SELECT dispatched_at FROM jobs WHERE id = ?",
      parked.jobId,
    );
    expect(job!.dispatched_at).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("recovers an ontology send failure only after rollout is re-enabled", async () => {
    let failures = 1;
    const send = vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("ontology queue unavailable");
      }
    });
    const queue = { send } as unknown as Queue;
    const now = new Date("2026-08-21T15:00:00.000Z");
    const pipelineEnv = ontologyScheduledEnv(queue);
    const run = await reserveOntologyRun(pipelineEnv, now);
    expect(run.dispatched).toBe(false);

    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "off";
    await worker.scheduled(
      createScheduledController({
        scheduledTime: now.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      pipelineEnv,
      createExecutionContext(),
    );
    expect(send).toHaveBeenCalledTimes(1);

    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "internal";
    await worker.scheduled(
      createScheduledController({
        scheduledTime: now.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      pipelineEnv,
      createExecutionContext(),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(run.runId).first()).toEqual({ dispatched_at: now.toISOString() });
  });

  it("recovers an expired ontology claim through the bounded scheduled path", async () => {
    const send = vi.fn(async () => undefined);
    const queue = { send } as unknown as Queue;
    const claimedAt = new Date("2026-08-21T14:00:00.000Z");
    const recoveredAt = new Date("2026-08-21T14:05:01.000Z");
    const pipelineEnv = ontologyScheduledEnv(queue);
    const run = await reserveOntologyRun(pipelineEnv, claimedAt);
    const claim = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: run.runId, stage_generation: 0 },
      claimedAt,
      "ontology-scheduled-expired-owner",
    );
    expect(claim.status).toBe("claimed");
    let totalD1Calls = 0;
    const countedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          totalD1Calls += 1;
          return target.prepare(query);
        };
      },
    }) as D1Database;

    await worker.scheduled(
      createScheduledController({
        scheduledTime: recoveredAt.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      ontologyScheduledEnv(queue, { DB: countedDb }),
      createExecutionContext(),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare(
      `SELECT claim_token, lease_expires_at, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(run.runId).first()).toEqual({
      claim_token: null,
      lease_expires_at: null,
      dispatched_at: recoveredAt.toISOString(),
    });
    expect(totalD1Calls).toBeLessThanOrEqual(12);
  });

  it("isolates ontology maintenance from incumbent scheduler failure", async () => {
    let failures = 1;
    const send = vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("ontology queue unavailable");
      }
    });
    const queue = { send } as unknown as Queue;
    const now = new Date("2026-08-21T15:00:00.000Z");
    const pipelineEnv = ontologyScheduledEnv(queue);
    const run = await reserveOntologyRun(pipelineEnv, now);
    expect(run.dispatched).toBe(false);
    let incumbentQueryAttempted = false;
    const isolatedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          if (
            query.includes("FROM users") ||
            query.includes("FROM jobs") ||
            query.includes("pattern_generation_jobs")
          ) {
            incumbentQueryAttempted = true;
            throw new Error("incumbent D1 quota unavailable");
          }
          return target.prepare(query);
        };
      },
    }) as D1Database;

    await expect(worker.scheduled(
      createScheduledController({
        scheduledTime: now.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      ontologyScheduledEnv(queue, { DB: isolatedDb }),
      createExecutionContext(),
    )).resolves.toBeUndefined();
    expect(incumbentQueryAttempted).toBe(false);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(send).toHaveBeenCalledWith({
      run_id: run.runId,
      stage_generation: 0,
    });
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(run.runId).first()).toEqual({ dispatched_at: now.toISOString() });
  });

  it("deletes and tombstones expired failed artifacts exactly, retrying R2 failures", async () => {
    const send = vi.fn(async () => undefined);
    const queue = { send } as unknown as Queue;
    const recoveredAt = new Date(Date.now() - 1_000);
    const expiresAt = new Date(recoveredAt.getTime() - 15 * 60_000);
    const failedAt = new Date(
      expiresAt.getTime() - 7 * 24 * 60 * 60 * 1_000,
    );
    const artifactAt = new Date(failedAt.getTime() - 60_000);
    const startedAt = new Date(artifactAt.getTime() - 2 * 60_000);
    // Event chronology stays historical so the retention deadline is expired,
    // while each owned setup write holds a lease live against D1's real clock.
    const liveClaimedAt = new Date(Date.now() - 30_000);
    const pipelineEnv = ontologyScheduledEnv(queue);
    const run = await reserveOntologyRun(pipelineEnv, startedAt);
    const reserved = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: run.runId, stage_generation: 0 },
      liveClaimedAt,
      "ontology-retention-reserved",
    );
    if (reserved.status !== "claimed") throw new Error("retention reserved claim failed");
    expect(await advanceOntologyPipelineStage(
      pipelineEnv,
      reserved,
      "corpus_reading",
      {},
      new Date(startedAt.getTime() + 1),
    )).toBe(true);
    const corpus = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: run.runId, stage_generation: 1 },
      new Date(liveClaimedAt.getTime() + 1),
      "ontology-retention-corpus",
    );
    if (corpus.status !== "claimed") throw new Error("retention corpus claim failed");
    expect(await advanceOntologyPipelineStage(
      pipelineEnv,
      corpus,
      "generating",
      {},
      new Date(startedAt.getTime() + 2),
    )).toBe(true);
    const generating = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: run.runId, stage_generation: 2 },
      new Date(liveClaimedAt.getTime() + 2),
      "ontology-retention-generating",
    );
    if (generating.status !== "claimed") throw new Error("retention generating claim failed");
    const coordinate = {
      runId: run.runId,
      stage: "generating" as const,
      stageGeneration: 2,
      stageAttempt: 0,
      artifactClass: "candidate_chunk" as const,
    };
    const runIdentity = await env.DB.prepare(
      `SELECT candidate_ontology_version FROM pattern_ontology_pipeline_runs
       WHERE run_id = ?`,
    ).bind(run.runId).first<{ candidate_ontology_version: string }>();
    if (!runIdentity) throw new Error("retention run identity missing");
    const sealed = await createOntologyPipelineArtifactEnvelope(
      pipelineEnv.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      {
        ...coordinate,
        ontologyVersion: runIdentity.candidate_ontology_version,
      },
      new TextEncoder().encode("failed candidate"),
    );
    const artifactId = await ontologyPipelineArtifactIdentity(coordinate);
    const objectKey = await ontologyPipelineArtifactObjectKey(coordinate);
    await pipelineEnv.ARTIFACTS!.put(objectKey, sealed.envelopeBytes);
    await env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_artifacts (
         id, run_id, stage, stage_generation, stage_attempt, artifact_class,
         object_key, plaintext_sha256, envelope_sha256, ciphertext_sha256,
         envelope_key_id, envelope_nonce, byte_length, created_at,
         expires_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      artifactId,
      coordinate.runId,
      coordinate.stage,
      coordinate.stageGeneration,
      coordinate.stageAttempt,
      coordinate.artifactClass,
      objectKey,
      sealed.plaintextSha256,
      sealed.envelopeSha256,
      sealed.ciphertextSha256,
      sealed.envelopeKeyId,
      sealed.envelopeNonce,
      sealed.byteLength,
      artifactAt.toISOString(),
    ).run();
    expect(await failOntologyPipelineRun(
      pipelineEnv,
      generating,
      "execution_error",
      failedAt,
    )).toBe(true);
    const unmarkedOrphanKey =
      `pattern-ontology/pipeline/${run.runId}/r2-only-unmarked.enc`;
    await env.ARTIFACTS!.put(unmarkedOrphanKey, "orphan");

    // Keep one previously completed failed run in the rescan lane. Together
    // with the unmarked run above, this exercises both bounded prefix pages in
    // the same real ontology-maintenance invocation.
    const markedRun = await reserveOntologyRun(
      pipelineEnv,
      startedAt,
      "retention-marked",
    );
    const markedClaim = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: markedRun.runId, stage_generation: 0 },
      new Date(liveClaimedAt.getTime() + 3),
      "ontology-retention-marked-owner",
    );
    if (markedClaim.status !== "claimed") {
      throw new Error("marked retention claim failed");
    }
    expect(await failOntologyPipelineRun(
      pipelineEnv,
      markedClaim,
      "execution_error",
      failedAt,
    )).toBe(true);
    await env.DB.prepare(
      `INSERT INTO audit_events (
         id, actor_type, actor_id, action, resource_type, resource_id,
         result, detail_class, created_at
       ) VALUES (?, 'service', 'ontology-pipeline-maintenance',
                 'ontology_pipeline.artifacts_purge_verified',
                 'ontology_pipeline_run', ?, 'success',
                 'retention_complete', ?)`,
    ).bind(
      `ontology_pipeline_artifacts_purged:${markedRun.runId}`,
      markedRun.runId,
      expiresAt.toISOString(),
    ).run();
    const markedOrphanKey =
      `pattern-ontology/pipeline/${markedRun.runId}/r2-only-marked.enc`;
    await env.ARTIFACTS!.put(markedOrphanKey, "late orphan");

    const failingBucket = new Proxy(env.ARTIFACTS!, {
      get(target, property, receiver) {
        if (property === "delete") {
          return async () => { throw new Error("R2 unavailable"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    let failedPassD1Calls = 0;
    const failedPassDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          failedPassD1Calls += 1;
          return target.prepare(query);
        };
      },
    }) as D1Database;
    await worker.scheduled(
      createScheduledController({
        scheduledTime: expiresAt.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      ontologyScheduledEnv(queue, {
        ARTIFACTS: failingBucket,
        DB: failedPassDb,
      }),
      createExecutionContext(),
    );
    expect(failedPassD1Calls).toBeLessThan(50);
    expect(await env.ARTIFACTS!.get(objectKey)).not.toBeNull();
    expect(await env.DB.prepare(
      `SELECT deleted_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(artifactId).first()).toEqual({ deleted_at: null });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_attempted'`,
    ).first()).toEqual({ count: 2 });

    // A retry of the same cron occurrence replays the durable assignments but
    // cannot create more receipts, repeat prefix deletes, or select new runs.
    await worker.scheduled(
      createScheduledController({
        scheduledTime: expiresAt.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      ontologyScheduledEnv(queue, { ARTIFACTS: failingBucket }),
      createExecutionContext(),
    );
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_attempted'`,
    ).first()).toEqual({ count: 2 });
    expect(await env.ARTIFACTS!.head(unmarkedOrphanKey)).not.toBeNull();
    expect(await env.ARTIFACTS!.head(markedOrphanKey)).not.toBeNull();

    // Add real lease and outbox work only after the failed R2 pass, so the
    // measured retry covers the maximum work of every ontology lane together.
    const expiredStartedAt = new Date(recoveredAt.getTime() - 10 * 60_000);
    const expiredClaimedAt = new Date(
      recoveredAt.getTime() - 5 * 60_000 - 1_000,
    );
    const expiredRun = await reserveOntologyRun(
      pipelineEnv,
      expiredStartedAt,
      "retention-expired-claim",
    );
    const expiredClaim = await claimOntologyPipelineRun(
      pipelineEnv,
      { run_id: expiredRun.runId, stage_generation: 0 },
      expiredClaimedAt,
      "ontology-retention-expired-owner",
    );
    if (expiredClaim.status !== "claimed") {
      throw new Error("expired retention claim failed");
    }

    let totalD1Calls = 0;
    const countedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          totalD1Calls += 1;
          return target.prepare(query);
        };
      },
    }) as D1Database;
    await worker.scheduled(
      createScheduledController({
        scheduledTime: recoveredAt.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      ontologyScheduledEnv(queue, { DB: countedDb }),
      createExecutionContext(),
    );
    expect(await env.ARTIFACTS!.get(objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT deleted_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(artifactId).first()).toEqual({
      deleted_at: recoveredAt.toISOString(),
    });
    expect(await env.ARTIFACTS!.head(unmarkedOrphanKey)).toBeNull();
    expect(await env.ARTIFACTS!.head(markedOrphanKey)).toBeNull();
    expect(totalD1Calls).toBeLessThan(50);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_attempted'`,
    ).first()).toEqual({ count: 4 });

    await expect(worker.scheduled(
      createScheduledController({
        scheduledTime: recoveredAt.getTime(),
        cron: ONTOLOGY_MAINTENANCE_CRON,
      }),
      pipelineEnv,
      createExecutionContext(),
    )).resolves.toBeUndefined();
  });
});
