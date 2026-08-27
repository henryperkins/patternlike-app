/**
 * The Task 6 stage protocol: artifact-first, attempt-scoped, conflict-fatal.
 *
 * These drive `executePatternJob` directly rather than through the queue, for
 * the same reason the M7 integration suite does: a delivery is the unit under
 * test, and the queue would hide which delivery did what.
 *
 * Budget is the fetch counter. `consumePatternProviderCallBudget` is charged
 * immediately before each provider call and never refunded, so
 * `pattern_provider_daily_usage.used_calls` counts provider calls exactly --
 * which is the quantity every one of these assertions is actually about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import { contentHash } from "@patternlike/shared";
import type { Env } from "../env.js";

import {
  DETERMINISTIC_PATTERN_PUBLISHER,
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
  transportPatternPublisher,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
  patternReplayTestEnv,
} from "../../test/pattern-replay-fixtures.js";
import {
  OPENAI_MOCK_PATTERN_CANDIDATE_INVALID_ONCE_KEY,
  OPENAI_MOCK_PATTERN_FULL_REJECTION_LOOP_KEY,
  OPENAI_MOCK_PATTERN_PLAN_INVALID_KEY,
  PATTERN_CORRECTION_SMUGGLED_PROSE,
} from "../../test/mock-calc-service.js";
import { findSemanticVerdictProblem } from "./pattern-semantic.js";
import { OPENAI_PATTERN_PLANNER_PROMPT_VERSION } from "./pattern-publisher.js";
import {
  executePatternJob,
  getArtifactAt,
} from "./pattern-execute.js";
import {
  commitPatternTransition,
  loadPatternJob,
  patternArtifactId,
} from "./pattern-stage-protocol.js";
import {
  recoverLegacyPausedPatternJobs,
  sweepPatternJobs,
} from "./pattern-sweep.js";
import {
  insertPatternConsentGrant,
  loadLatestPatternConsent,
} from "../db/pattern-consents.js";
import { PATTERN_JOB_TYPE } from "./pattern-command.js";

const POLICY = "1.0.0";

/**
 * The credential the injected stand-in speaks with. The mocked origin keys its
 * scripted behaviours off it, so this is how a case asks for an invalid plan or
 * a rejection loop. It is a parameter of the stand-in, never a Worker binding.
 */
let standInKey = "sk-test";

async function json(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      "x-user-id": USER_A,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Reserve one generation and return its id. */
async function reserve(key: string): Promise<string> {
  const response = await json("/v1/pattern-generations", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      schema_version: "0.7.0",
      consent_policy_version: POLICY,
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    }),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return (response.body.generation as { generation_id: string }).generation_id;
}

/**
 * Deliver the message the durable row currently names.
 *
 * The publisher is injected rather than configured: `PATTERN_PUBLISHER` selects
 * Codex and nothing else, and Codex answers `publisher_pending` instead of an
 * answer this suite can assert on. The default stand-in speaks the real
 * Responses transport to the mocked origin, which is what the provider-answer
 * cases here are about.
 */
async function deliver(
  generationId: string,
  executionEnv: Env = env,
  overrides = transportPatternPublisher({ source: "worker", apiKey: standInKey }),
) {
  const job = await loadPatternJob(executionEnv, generationId);
  if (!job) throw new Error("pattern job missing");
  return executePatternJob(executionEnv, {
    kind: "pattern_generation",
    job_id: job.job_id,
    generation_id: generationId,
    stage_generation: job.stage_generation,
  }, new Date(), overrides);
}

async function providerCalls(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(used_calls), 0) AS n FROM pattern_provider_daily_usage`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function clearBackoff(generationId: string): Promise<void> {
  const job = await loadPatternJob(env, generationId);
  if (!job) throw new Error("pattern job missing");
  await env.DB.prepare(`UPDATE jobs SET available_at = NULL WHERE id = ?`)
    .bind(job.job_id)
    .run();
}

async function stageOf(generationId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<{ stage: string }>();
  return row?.stage ?? "missing";
}

describe("Pattern stage protocol", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    standInKey = "sk-test";
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => {
    disablePatternAi();
    vi.restoreAllMocks();
  });

  it("runs the transport and logs the frozen pin's provenance for the pass", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-transport-reached");
    const job = await loadPatternJob(env, generationId);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const outcome = await deliver(generationId);

    // Three independent traces show a pass actually ran: the stage advanced,
    // the ledger was charged, and the request bytes were committed first.
    expect(outcome).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("writing");
    // Charged immediately before the fetch, so this counts the fetch.
    expect(await providerCalls()).toBe(1);
    // Steps 5 and 6: the exact bytes sent, committed before the call.
    const request = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_request",
      job!.stage_generation,
      0,
    );
    expect(request).not.toBeNull();
    expect(info).toHaveBeenCalledWith(
      "pattern_publisher_call_completed",
      expect.objectContaining({
        // The frozen pin, which is what `runPublisherPass` checks the executed
        // provenance against. A stand-in answers under it rather than under its
        // own name, or it would fail that check instead of exercising it.
        provider: "codex",
        pass: "planner",
        model: "gpt-5.6-sol",
        // Read the pin rather than restate it: a hardcoded literal here fails
        // on the next prompt-version bump without saying anything about the
        // behaviour this test is actually about.
        prompt_version: OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
      }),
    );
  });

  it("fails closed when the publisher returns a schema-valid plan the packet cannot support", async () => {
    enablePatternAi();
    standInKey = OPENAI_MOCK_PATTERN_PLAN_INVALID_KEY;
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-plan-invalid");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect((await loadPatternJob(env, generationId))?.planner_attempts).toBe(1);
    expect(await stageOf(generationId)).toBe("reserved");
    expect(await providerCalls()).toBe(1);

    await clearBackoff(generationId);
    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "plan_invalid",
    });
    expect(await stageOf(generationId)).toBe("failed");
    expect(await providerCalls()).toBe(2);
  });

  it("logs a closed failed-attempt event with its pass and durable attempt", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-openai-budget-log");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO pattern_provider_daily_usage (utc_date, used_calls, created_at, updated_at)
       VALUES (?, 100, ?, ?)`,
    )
      .bind(now.slice(0, 10), now, now)
      .run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "publisher_budget_exhausted",
    });
    expect(warn).toHaveBeenCalledWith(
      "pattern_publisher_attempt_failed",
      expect.objectContaining({
        provider: "codex",
        pass: "planner",
        attempt: 0,
        failure_class: "publisher_budget_exhausted",
        safe_detail_code: "daily_call_limit_reached",
      }),
    );
  });

  it("still produces the deterministic document from an injected stand-in", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-deterministic");

    expect(await deliver(generationId, env, DETERMINISTIC_PATTERN_PUBLISHER))
      .toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("writing");
    // The ledger counts provider calls, and a stand-in is not a provider.
    expect(await providerCalls()).toBe(0);
  });

  it("keeps publication reserved when the replay replica is unavailable", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-replay-unavailable");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("semantic_verifying");

    const unavailableBucket = new Proxy(env.PATTERN_REPLAY_LEDGER!, {
      get(target, property, receiver) {
        if (property === "get") return async () => null;
        if (property === "put") {
          return async () => {
            throw new Error("injected replay outage");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const outcome = await deliver(
      generationId,
      patternReplayTestEnv(env, { PATTERN_REPLAY_LEDGER: unavailableBucket }),
    );

    expect(outcome).toEqual({
      ok: false,
      reason: "retry",
      failureClass: "replay_replica_unavailable",
    });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_generation_claims WHERE active_generation_id = ?`,
    ).bind(generationId).first<{ status: string }>()).toEqual({ status: "reserved" });
    expect(await env.DB.prepare(
      `SELECT status FROM jobs WHERE id = (
         SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?
       )`,
    ).bind(generationId).first<{ status: string }>()).toEqual({ status: "queued" });
    expect(await stageOf(generationId)).toBe("publishing");
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("adopts the write-ahead publication intent after a D1 failure", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-replay-d1-retry");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const beforePublication = await loadPatternJob(env, generationId);

    let failPublicationBatch = true;
    let publicationPrepared = false;
    const failingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (query: string) => {
            if (query.includes("INSERT INTO pattern_documents")) {
              publicationPrepared = true;
            }
            return target.prepare(query);
          };
        }
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (failPublicationBatch && publicationPrepared) {
              failPublicationBatch = false;
              publicationPrepared = false;
              throw new Error("injected publication transaction failure");
            }
            publicationPrepared = false;
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    const retryEnv = patternReplayTestEnv(env, { DB: failingDb });

    expect(await deliver(generationId, retryEnv)).toEqual({
      ok: false,
      reason: "retry",
      failureClass: "publication_commit_failed",
    });
    const publishing = await loadPatternJob(env, generationId);
    expect(publishing).toMatchObject({
      stage: "publishing",
      stage_generation: beforePublication!.stage_generation,
      planner_attempts: beforePublication!.planner_attempts,
      writer_attempts: beforePublication!.writer_attempts,
      verifier_attempts: beforePublication!.verifier_attempts,
      candidate_hash: beforePublication!.candidate_hash,
    });
    expect((await env.PATTERN_REPLAY_LEDGER!.list({
      prefix: "pattern-erasure-replay/",
    })).objects).toHaveLength(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_erasure_replay_events WHERE generation_id = ?`,
    ).bind(generationId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_generation_claims WHERE active_generation_id = ?`,
    ).bind(generationId).first<{ status: string }>()).toEqual({ status: "reserved" });

    await clearBackoff(generationId);
    expect(await deliver(generationId, retryEnv)).toEqual({ ok: true, terminal: true });
    const succeeded = await loadPatternJob(env, generationId);
    expect(succeeded).toMatchObject({
      stage: "succeeded",
      stage_generation: beforePublication!.stage_generation + 1,
      candidate_hash: beforePublication!.candidate_hash,
      semantic_verdict_hash: expect.any(String),
    });
    expect((await env.PATTERN_REPLAY_LEDGER!.list({
      prefix: "pattern-erasure-replay/",
    })).objects).toHaveLength(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_erasure_replay_events WHERE generation_id = ?`,
    ).bind(generationId).first<{ n: number }>()).toEqual({ n: 1 });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("stores the frozen pin's provenance for the passes that ran", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-frozen-provenance");

    for (const expectedStage of ["writing", "semantic_verifying", "succeeded"]) {
      expect(await deliver(generationId)).toEqual({ ok: true, terminal: expectedStage === "succeeded" });
      expect(await stageOf(generationId)).toBe(expectedStage);
    }

    const stored = await env.DB.prepare(
      `SELECT compact_provenance_json FROM pattern_documents WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ compact_provenance_json: string }>();
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!.compact_provenance_json)).toEqual(
      expect.objectContaining({
        provider: "Codex",
        model_family: "gpt",
      }),
    );
    expect(await providerCalls()).toBe(3);
    const usage = await env.DB.prepare(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage`,
    ).first<{
      used_calls: number;
      planner_calls: number;
      writer_calls: number;
      verifier_calls: number;
    }>();
    expect(usage).toEqual({
      used_calls: 3,
      planner_calls: 1,
      writer_calls: 1,
      verifier_calls: 1,
    });
  });

  it("fails closed rather than publishing under a configuration it cannot run", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-configuration-lost");

    // The command froze a complete Codex configuration. A deployment that can
    // no longer resolve one must fail the job closed rather than publish prose
    // under provenance the frozen command never described.
    env.PATTERN_PUBLISHER = "openai";
    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "publisher_not_configured",
    });
    expect(await stageOf(generationId)).toBe("failed");
    const documents = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ n: number }>();
    expect(documents?.n).toBe(0);
    expect(await providerCalls()).toBe(0);
  });

  it("spends no budget on a delivery whose ontology recheck fails", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-ontology-recheck");

    // Recall the release the command froze. `eligibility` sees the active
    // pointer no longer resolves and the frozen version is recalled, and cancels
    // before the publisher is ever constructed.
    await env.DB.prepare(`UPDATE pattern_ontology_releases SET status = 'recalled'`).run();
    await env.DB.prepare(`UPDATE pattern_ontology_pointer SET active_version = NULL WHERE id = 1`).run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({ ok: true, terminal: true });
    expect(await stageOf(generationId)).toBe("cancelled");
    expect(await providerCalls()).toBe(0);
  });

  it("adopts the stored response on a redelivery, spending no second call", async () => {
    // The planner pass runs once through the real provider seam, which commits
    // a `planner_response` at (stage_generation, attempt 0). Before redelivery we
    // remove the request artifact. If the response probe misses, rerunning the
    // publisher must rebuild that request; adoption leaves it absent. This
    // keeps the assertion meaningful now that the frozen command pin wins over
    // a live publisher change.
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-adoption");

    const before = await loadPatternJob(env, generationId);
    expect(before).not.toBeNull();
    const stageGeneration = before!.stage_generation;

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const advanced = await loadPatternJob(env, generationId);
    const firstPlanHash = advanced!.plan_hash;
    expect(firstPlanHash).toEqual(expect.any(String));
    expect(await providerCalls()).toBe(1);
    expect(advanced!.planner_attempts).toBe(0);

    // The hash advanced into D1 names bytes that exist in R2.
    const stored = await getArtifactAt<{ schema_version: string }>(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      0,
    );
    expect(stored).not.toBeNull();
    expect(stored!.plaintextHash).toBe(firstPlanHash);

    const requestRow = await env.DB.prepare(
      `SELECT object_key FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_request'`,
    )
      .bind(generationId)
      .first<{ object_key: string }>();
    expect(requestRow).not.toBeNull();
    expect(env.ARTIFACTS).toBeDefined();
    await env.ARTIFACTS!.delete(requestRow!.object_key);
    await env.DB.prepare(
      `DELETE FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_request'`,
    )
      .bind(generationId)
      .run();

    // Rewind exactly what a lost `advance` leaves behind: the artifact is on
    // disk, the durable row never moved.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'planning', stage_generation = ?, plan_hash = NULL WHERE generation_id = ?`,
    )
      .bind(stageGeneration, generationId)
      .run();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
              dispatched_at = NULL WHERE id = ?`,
    )
      .bind(before!.job_id)
      .run();

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    // Same attempt index, no publisher rerun, and the same committed response
    // bytes named again.
    expect(await providerCalls()).toBe(1);
    expect(
      await getArtifactAt(
        env,
        IDENTITY_A,
        generationId,
        "planner_request",
        stageGeneration,
        0,
      ),
    ).toBeNull();
    const redelivered = await loadPatternJob(env, generationId);
    expect(redelivered!.plan_hash).toBe(firstPlanHash);
    expect(redelivered!.planner_attempts).toBe(0);
    expect(await stageOf(generationId)).toBe("writing");
  });

  it("writes a genuine retry at k+1 rather than colliding with attempt k", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-retry-k-plus-one");

    const job = await loadPatternJob(env, generationId);
    const stageGeneration = job!.stage_generation;

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const atZero = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      0,
    );
    expect(atZero).not.toBeNull();

    // Rewind and hand the same stage back through the typed retry transition, which holds the
    // stage generation and moves the durable attempt index.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = 'planning', stage_generation = ?, plan_hash = NULL WHERE generation_id = ?`,
    )
      .bind(stageGeneration, generationId)
      .run();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = 'clm_test_retry',
              lease_expires_at = ?, dispatched_at = NULL WHERE id = ?`,
    )
      .bind(new Date(Date.now() + 300_000).toISOString(), job!.job_id)
      .run();

    const rewound = await loadPatternJob(env, generationId);
    expect(await commitPatternTransition(
      env,
      rewound!,
      "clm_test_retry",
      { kind: "retry", pass: "planner", availableAt: null },
    )).not.toBeNull();

    const retried = await loadPatternJob(env, generationId);
    expect(retried!.planner_attempts).toBe(1);
    expect(retried!.stage_generation).toBe(stageGeneration);
    expect(retried!.stage).toBe("planning");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    const atOne = await getArtifactAt(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      stageGeneration,
      1,
    );
    expect(atOne).not.toBeNull();
    // Two coordinates, two artifacts: the second attempt is allowed to differ
    // and the three-component identity would have discarded it.
    expect(await patternArtifactId(generationId, "planner_response", stageGeneration, 0)).not.toBe(
      await patternArtifactId(generationId, "planner_response", stageGeneration, 1),
    );
  });

  it("retries a deterministic candidate rejection in place with a closed correction", async () => {
    enablePatternAi();
    standInKey = OPENAI_MOCK_PATTERN_CANDIDATE_INVALID_ONCE_KEY;
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-candidate-correction");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const writing = await loadPatternJob(env, generationId);
    expect(writing?.stage).toBe("writing");

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    const retry = await loadPatternJob(env, generationId);
    expect(retry).toEqual(
      expect.objectContaining({
        stage: "writing",
        stage_generation: writing!.stage_generation,
        writer_attempts: 1,
        verifier_attempts: 0,
      }),
    );
    const correction = await getArtifactAt<{
      attempt: number;
      items: Array<{ origin: string }>;
    }>(
      env,
      IDENTITY_A,
      generationId,
      "correction_document",
      writing!.stage_generation,
      1,
    );
    expect(correction?.value.attempt).toBe(1);
    expect(correction?.value.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin: "deterministic" })]),
    );

    await clearBackoff(generationId);
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await loadPatternJob(env, generationId)).toEqual(
      expect.objectContaining({
        stage: "semantic_verifying",
        writer_attempts: 1,
        verifier_attempts: 0,
      }),
    );
    expect(await providerCalls()).toBe(3);
  });

  it("runs all three candidates with two verifier calls each and stops at exactly 11 fetches", async () => {
    enablePatternAi();
    standInKey = OPENAI_MOCK_PATTERN_FULL_REJECTION_LOOP_KEY;
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-full-rejection-loop");

    // Planner attempt 0 is deterministically rejected; attempt 1 succeeds.
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    await clearBackoff(generationId);
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    for (let candidate = 0; candidate < 3; candidate += 1) {
      const writing = await loadPatternJob(env, generationId);
      expect(writing).toEqual(
        expect.objectContaining({
          stage: "writing",
          writer_attempts: candidate,
        }),
      );
      expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
      const verifying = await loadPatternJob(env, generationId);
      expect(verifying).toEqual(
        expect.objectContaining({
          stage: "semantic_verifying",
          writer_attempts: candidate,
          verifier_attempts: 0,
        }),
      );
      const writerRequest = await getArtifactAt<unknown>(
        env,
        IDENTITY_A,
        generationId,
        "writer_request",
        writing!.stage_generation,
        candidate,
      );
      expect(writerRequest).not.toBeNull();
      expect(JSON.stringify(writerRequest?.value)).not.toContain(
        PATTERN_CORRECTION_SMUGGLED_PROSE,
      );

      expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
      expect(await loadPatternJob(env, generationId)).toEqual(
        expect.objectContaining({
          stage: "semantic_verifying",
          writer_attempts: candidate,
          verifier_attempts: 1,
        }),
      );
      await clearBackoff(generationId);

      const rejection = await deliver(generationId);
      if (candidate < 2) {
        expect(rejection).toEqual({ ok: true, terminal: false });
        const returned = await loadPatternJob(env, generationId);
        expect(returned).toEqual(
          expect.objectContaining({
            stage: "writing",
            writer_attempts: candidate + 1,
            // The verifier result did not consume a verifier attempt. Entry
            // into the next candidate resets this index, not the return itself.
            verifier_attempts: 1,
          }),
        );
        const correction = await getArtifactAt<{ attempt: number; items: unknown[] }>(
          env,
          IDENTITY_A,
          generationId,
          "correction_document",
          returned!.stage_generation,
          candidate + 1,
        );
        expect(correction?.value.attempt).toBe(candidate + 1);
        expect(JSON.stringify(correction?.value)).not.toContain(
          "REJECTED PROSE MUST NEVER ENTER THE CORRECTION DOCUMENT",
        );
        expect(JSON.stringify(correction?.value)).not.toContain(
          PATTERN_CORRECTION_SMUGGLED_PROSE,
        );
      } else {
        expect(rejection).toEqual({
          ok: false,
          reason: "terminal",
          failureClass: "semantic_verification_failed",
        });
      }
    }

    const terminal = await env.DB.prepare(
      `SELECT stage, planner_attempts, writer_attempts, verifier_attempts,
              failure_class, public_failure_stage
       FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{
        stage: string;
        planner_attempts: number;
        writer_attempts: number;
        verifier_attempts: number;
        failure_class: string;
        public_failure_stage: string;
      }>();
    expect(terminal).toEqual({
      stage: "failed",
      planner_attempts: 1,
      writer_attempts: 2,
      verifier_attempts: 1,
      failure_class: "semantic_verification_failed",
      public_failure_stage: "checking_claims",
    });
    expect(await providerCalls()).toBe(11);
    const usage = await env.DB.prepare(
      `SELECT used_calls, planner_calls, writer_calls, verifier_calls
       FROM pattern_provider_daily_usage`,
    ).first<{
      used_calls: number;
      planner_calls: number;
      writer_calls: number;
      verifier_calls: number;
    }>();
    expect(usage).toEqual({
      used_calls: 11,
      planner_calls: 2,
      writer_calls: 3,
      verifier_calls: 6,
    });
  });

  it("fails terminally rather than overwriting a reserved identity holding other bytes", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-identity-conflict");

    const job = await loadPatternJob(env, generationId);
    const artifactId = await patternArtifactId(
      generationId,
      "planner_request",
      job!.stage_generation,
      0,
    );
    const objectKey = `pattern-generations/${generationId}/${artifactId}.json.enc`;

    // Somebody else's bytes under the coordinate this delivery is about to
    // reserve. `head()` used to return silently here.
    await env.ARTIFACTS!.put(objectKey, new Uint8Array(64));
    await env.DB.prepare(
      `INSERT INTO pattern_generation_artifacts (
         id, generation_id, user_id, artifact_class, object_key, ciphertext_sha256,
         plaintext_sha256, byte_length, created_at, expires_at, deleted_at
       ) VALUES (?, ?, ?, 'planner_request', ?, ?, ?, 64, ?, ?, NULL)`,
    )
      .bind(
        artifactId,
        generationId,
        USER_A,
        objectKey,
        `sha256:${"ab".repeat(32)}`,
        `sha256:${"cd".repeat(32)}`,
        new Date().toISOString(),
        new Date(Date.now() + 86400_000).toISOString(),
      )
      .run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "execution_error",
    });
    expect(await stageOf(generationId)).toBe("failed");
  });

  it("fails terminally without a provider call when the pass attempt index is spent", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-attempts-exhausted");

    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET planner_attempts = 2 WHERE generation_id = ?`,
    )
      .bind(generationId)
      .run();

    const outcome = await deliver(generationId);
    expect(outcome).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "planner_attempts_exhausted",
    });
    expect(await providerCalls()).toBe(0);
    expect(await stageOf(generationId)).toBe("failed");
  });

  it.each([
    {
      pass: "writer",
      column: "writer_attempts",
      maximum: 3,
      setupCalls: 1,
      publicStage: "writing",
    },
    {
      pass: "verifier",
      column: "verifier_attempts",
      maximum: 2,
      setupCalls: 2,
      publicStage: "checking_claims",
    },
  ] as const)(
    "fails terminally before another $pass fetch when its next-attempt index is spent",
    async ({ pass, column, maximum, setupCalls, publicStage }) => {
      enablePatternAi();
      await seedActiveOntology();
      const generationId = await reserve(`idem-protocol-${pass}-attempts-exhausted`);

      for (let call = 0; call < setupCalls; call += 1) {
        expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
      }
      expect(await providerCalls()).toBe(setupCalls);
      await env.DB.prepare(
        `UPDATE pattern_generation_jobs SET ${column} = ? WHERE generation_id = ?`,
      )
        .bind(maximum, generationId)
        .run();

      expect(await deliver(generationId)).toEqual({
        ok: false,
        reason: "terminal",
        failureClass: `${pass}_attempts_exhausted`,
      });
      expect(await providerCalls()).toBe(setupCalls);
      const terminal = await env.DB.prepare(
        `SELECT stage, failure_class, public_failure_stage
         FROM pattern_generation_jobs WHERE generation_id = ?`,
      )
        .bind(generationId)
        .first<{
          stage: string;
          failure_class: string;
          public_failure_stage: string;
        }>();
      expect(terminal).toEqual({
        stage: "failed",
        failure_class: `${pass}_attempts_exhausted`,
        public_failure_stage: publicStage,
      });
    },
  );

  it("refuses to verify a candidate the job row does not name", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-candidate-binding");

    // Planner, then writer. The job now sits at semantic_verifying with a
    // candidate_hash naming the committed writer_response.
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });
    expect(await stageOf(generationId)).toBe("semantic_verifying");

    // `getArtifact` selects the NEWEST writer_response, which on a tie or a
    // second writer attempt need not be the one the writer stage advanced with.
    // The binding is what stops a different candidate reaching the verifier and
    // then publication.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET candidate_hash = ? WHERE generation_id = ?`,
    )
      .bind(`sha256:${"ef".repeat(32)}`, generationId)
      .run();

    expect(await deliver(generationId)).toEqual({
      ok: false,
      reason: "terminal",
      failureClass: "candidate_missing",
    });
    expect(await stageOf(generationId)).toBe("failed");
  });

  it("hashes the committed artifact bytes rather than the in-memory response", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-protocol-committed-bytes");
    const job = await loadPatternJob(env, generationId);

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: false });

    const advanced = await loadPatternJob(env, generationId);
    const row = await env.DB.prepare(
      `SELECT plaintext_sha256 FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'planner_response'`,
    )
      .bind(generationId)
      .first<{ plaintext_sha256: string }>();

    expect(advanced!.plan_hash).toBe(row?.plaintext_sha256);

    const stored = await getArtifactAt<unknown>(
      env,
      IDENTITY_A,
      generationId,
      "planner_response",
      job!.stage_generation,
      0,
    );
    expect(await contentHash(JSON.stringify(stored!.value))).toBe(advanced!.plan_hash);
  });
});

/**
 * The verdict is a model document now, so `verdict !== "pass"` is no longer a
 * sufficient read of it. These pin the three ways one can be unhonourable.
 */
describe("semantic verdict validation", () => {
  const finding = (over: Record<string, unknown> = {}) => ({
    code: "claim_not_entailed",
    severity: "error",
    target_key: null,
    feature_aliases: [],
    ontology_rule_ids: [],
    rationale: "",
    ...over,
  });

  it("accepts the shapes the contract and the closed vocabulary allow", () => {
    expect(
      findSemanticVerdictProblem({ schema_version: "0.7.0", verdict: "pass", findings: [] }),
    ).toBeNull();
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "reject",
        findings: [finding()],
      }),
    ).toBeNull();
    // A warning does not make a pass incoherent -- only an error does.
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "pass",
        findings: [finding({ severity: "warning" })],
      }),
    ).toBeNull();
  });

  it("refuses a pass that carries an error finding as incoherent", () => {
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "pass",
        findings: [finding()],
      }),
    ).toBe("verdict_incoherent");
  });

  it("refuses a code outside the closed vocabulary", () => {
    // Free-form in `contracts/m7` on purpose; the vocabulary is enforced here,
    // because the writer correction path cannot act on a code it has no rule for.
    expect(
      findSemanticVerdictProblem({
        schema_version: "0.7.0",
        verdict: "reject",
        findings: [finding({ code: "vibes_were_off" })],
      }),
    ).toBe("verdict_finding_code_unknown");
  });

  it.each([
    ["a body that is not an object", "not a verdict"],
    ["a missing verdict", { schema_version: "0.7.0", findings: [] }],
    ["pass_with_changes, which the contract has no member for", {
      schema_version: "0.7.0",
      verdict: "pass_with_changes",
      findings: [],
    }],
    ["a wrong schema version", { schema_version: "0.6.0", verdict: "pass", findings: [] }],
    ["findings that are not an array", { schema_version: "0.7.0", verdict: "pass", findings: {} }],
  ])("refuses %s", (_name, document) => {
    expect(findSemanticVerdictProblem(document)).toBe("verdict_shape_invalid");
  });

  it("refuses a finding whose required members are the wrong type", () => {
    for (const broken of [
      finding({ severity: "fatal" }),
      finding({ target_key: 7 }),
      finding({ feature_aliases: "alias_1" }),
      finding({ ontology_rule_ids: [1] }),
      finding({ rationale: "x".repeat(601) }),
      finding({ code: "" }),
    ]) {
      expect(
        findSemanticVerdictProblem({
          schema_version: "0.7.0",
          verdict: "reject",
          findings: [broken],
        }),
      ).toBe("verdict_shape_invalid");
    }
  });
});

/**
 * `result_class = 'rollout_paused'` is historical data.
 *
 * Nothing creates one now: the rollout that parked these rows is gone, and the
 * transition that set the class went with it. What remains is a bounded,
 * unconditional repair — unconditional because the condition it used to have
 * ("the rollout is back on") no longer exists, and any replacement condition
 * would be the flag again under another name.
 */
describe("legacy paused Pattern jobs", () => {
  const PAUSED_LEASE = "claim-token-legacy-pause";

  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    standInKey = "sk-test";
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => {
    disablePatternAi();
    vi.restoreAllMocks();
  });

  interface JobRow {
    status: string;
    result_class: string | null;
    available_at: string | null;
    dispatched_at: string | null;
    claim_token: string | null;
    lease_expires_at: string | null;
  }

  async function jobRow(id: string): Promise<JobRow | null> {
    return env.DB.prepare(
      `SELECT status, result_class, available_at, dispatched_at, claim_token,
              lease_expires_at
       FROM jobs WHERE id = ?`,
    ).bind(id).first<JobRow>();
  }

  /** A row a prior deployment parked. No new code path can produce one. */
  async function seedLegacyPause(
    id: string,
    options: {
      status?: "queued" | "running";
      leaseExpiresAt?: string | null;
      createdAt?: string;
    } = {},
  ): Promise<void> {
    const status = options.status ?? "queued";
    const createdAt = options.createdAt ?? new Date(0).toISOString();
    await env.DB.prepare(
      `INSERT INTO jobs (
         id, job_type, user_id, idempotency_key, status, result_class, attempts,
         available_at, dispatched_at, claim_token, lease_expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'rollout_paused', 0, ?, NULL, ?, ?, ?)`,
    ).bind(
      id,
      PATTERN_JOB_TYPE,
      USER_A,
      `idem-${id}`,
      status,
      createdAt,
      status === "running" ? PAUSED_LEASE : null,
      status === "running" ? (options.leaseExpiresAt ?? new Date(0).toISOString()) : null,
      createdAt,
    ).run();
  }

  /** Park a real reserved generation exactly as the removed transition did. */
  async function pauseReserved(generationId: string): Promise<string> {
    const job = await loadPatternJob(env, generationId);
    if (!job) throw new Error("pattern job missing");
    await env.DB.prepare(
      `UPDATE jobs SET result_class = 'rollout_paused', status = 'queued',
                       dispatched_at = NULL, available_at = NULL
       WHERE id = ?`,
    ).bind(job.job_id).run();
    return job.job_id;
  }

  it("returns a queued legacy pause to the outbox lane", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    await seedLegacyPause("job_legacy_queued");

    expect(await recoverLegacyPausedPatternJobs(env, 50, now)).toBe(1);

    expect(await jobRow("job_legacy_queued")).toEqual({
      status: "queued",
      result_class: null,
      available_at: now.toISOString(),
      // The outbox is what sends it. A repair that also claimed to have
      // dispatched would strand the row a second time.
      dispatched_at: null,
      claim_token: null,
      lease_expires_at: null,
    });
  });

  it("returns a running legacy pause whose lease has lapsed, clearing its claim", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    await seedLegacyPause("job_legacy_expired", {
      status: "running",
      leaseExpiresAt: "2026-08-27T11:00:00.000Z",
    });

    expect(await recoverLegacyPausedPatternJobs(env, 50, now)).toBe(1);

    expect(await jobRow("job_legacy_expired")).toMatchObject({
      status: "queued",
      result_class: null,
      claim_token: null,
      lease_expires_at: null,
    });
  });

  it("leaves a live running lease to the consumer that holds it", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    await seedLegacyPause("job_legacy_live", {
      status: "running",
      leaseExpiresAt: "2026-08-27T12:05:00.000Z",
    });

    expect(await recoverLegacyPausedPatternJobs(env, 50, now)).toBe(0);

    expect(await jobRow("job_legacy_live")).toMatchObject({
      status: "running",
      result_class: "rollout_paused",
      claim_token: PAUSED_LEASE,
    });
  });

  it("repairs one bounded batch per call and leaves the rest paused and undispatched", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    for (let index = 0; index < 5; index += 1) {
      await seedLegacyPause(`job_legacy_batch_${index}`, {
        createdAt: new Date(1000 * (index + 1)).toISOString(),
      });
    }

    expect(await recoverLegacyPausedPatternJobs(env, 2, now)).toBe(2);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE result_class = 'rollout_paused'`,
    ).first<{ n: number }>()).toEqual({ n: 3 });

    // The outbox exclusion has to stay while compatibility rows can exist, or
    // the rows beyond the batch would be dispatched without ever being
    // repaired — which is the pause the class was recording.
    await env.DB.prepare(
      `UPDATE jobs SET result_class = 'rollout_paused' WHERE id LIKE 'job_legacy_batch_%'`,
    ).run();
    await sweepPatternJobs(env, now);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE result_class = 'rollout_paused' AND dispatched_at IS NOT NULL`,
    ).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("converges: a repeated sweep repairs nothing and spends no provider budget", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    await seedLegacyPause("job_legacy_converge");

    await sweepPatternJobs(env, now);
    expect(await recoverLegacyPausedPatternJobs(env, 50, now)).toBe(0);
    await sweepPatternJobs(env, now);

    expect(await jobRow("job_legacy_converge")).toMatchObject({ result_class: null });
    expect(await providerCalls()).toBe(0);
  });

  it("decides nothing about consent: recovery redelivers, and the delivery cancels", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-legacy-consent");
    const jobId = await pauseReserved(generationId);
    // The grant the command froze is superseded while the row is parked. The
    // repair must not read consent at all; the delivery is what cancels.
    const nowIso = new Date().toISOString();
    const latest = await loadLatestPatternConsent(env, USER_A);
    await env.DB.batch([
      insertPatternConsentGrant(
        env,
        USER_A,
        "cns_legacy_superseding",
        (latest?.version ?? 1) + 1,
        latest?.id ?? null,
        nowIso,
      ),
    ]);

    expect(await recoverLegacyPausedPatternJobs(env, 50, new Date())).toBe(1);
    expect(await jobRow(jobId)).toMatchObject({ result_class: null, status: "queued" });

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: true });
    expect(await stageOf(generationId)).toBe("cancelled");
    expect(await providerCalls()).toBe(0);
  });

  it("decides nothing about the chart: a corrected chart cancels on redelivery", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-legacy-stale-chart");
    const jobId = await pauseReserved(generationId);
    // A chart correction while the row is parked. Again: the repair returns the
    // row to the lane, and the ordinary eligibility check decides.
    await env.DB.prepare(
      `UPDATE chart_snapshots SET status = 'superseded' WHERE user_id = ?`,
    ).bind(USER_A).run();

    expect(await recoverLegacyPausedPatternJobs(env, 50, new Date())).toBe(1);
    expect(await jobRow(jobId)).toMatchObject({ result_class: null });

    expect(await deliver(generationId)).toEqual({ ok: true, terminal: true });
    expect(await stageOf(generationId)).toBe("cancelled");
    expect(await providerCalls()).toBe(0);
  });

  it("recovers a row whose domain stage is already terminal without reviving it", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const generationId = await reserve("idem-legacy-terminal");
    const jobId = await pauseReserved(generationId);
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET stage = 'cancelled' WHERE generation_id = ?`,
    ).bind(generationId).run();

    expect(await recoverLegacyPausedPatternJobs(env, 50, new Date())).toBe(1);
    expect(await jobRow(jobId)).toMatchObject({ result_class: null });

    const outcome = await deliver(generationId);
    expect(outcome.ok).toBe(false);
    expect(await stageOf(generationId)).toBe("cancelled");
    expect(await providerCalls()).toBe(0);
  });
});
