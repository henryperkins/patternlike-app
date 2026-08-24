import { canonicalJson, contentHash } from "@patternlike/shared";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDb, rows } from "../../test/helpers.js";
import {
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
} from "../db/ontology-pipeline.js";
import {
  claimCodexProviderJob,
  codexProviderJobId,
  completeCodexProviderJob,
  enqueueCodexProviderJob,
  reserveCodexProviderResponseUpload,
} from "../db/codex-provider-jobs.js";
import {
  putCodexProviderArtifact,
  type CodexProviderArtifactCoordinate,
} from "../services/codex-provider-artifacts.js";
import type { CodexProviderInvocation } from "../services/codex-provider-contract.js";
import { maintainCodexProviderJobs } from "../services/codex-provider-maintenance.js";

const RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";
const FIXTURE_AT = "2026-08-24T00:00:00.000Z";
const textEncoder = new TextEncoder();
const HASH = `sha256:${"a".repeat(64)}`;

function enableOntologyCodex(): void {
  env.ONTOLOGY_PIPELINE_ROLLOUT = "internal";
  env.ONTOLOGY_PIPELINE_PUBLISHER = "codex";
  env.ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS = "1";
  env.OPENAI_ONTOLOGY_GENERATOR_MODEL = "gpt-5.6-sol";
  env.OPENAI_ONTOLOGY_GENERATOR_REASONING = "high";
  env.OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION = "1.0.5";
  env.OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS = "900000";
  env.OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS = "8000";
  env.OPENAI_ONTOLOGY_EVALUATOR_MODEL = "gpt-5.6-sol";
  env.OPENAI_ONTOLOGY_EVALUATOR_REASONING = "high";
  env.OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION = "1.0.0-evaluator";
  env.OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS = "900000";
  env.OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS = "4000";
  env.ONTOLOGY_PIPELINE_INPUT_MAX_BYTES = "98304";
  env.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = "500";
  env.ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS = "7";
}

const invocation: CodexProviderInvocation = {
  schema_version: "codex-provider-invocation/v1",
  prompt: "Follow the policy.\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n{}",
  output_schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: { answer: { type: "string" } },
  },
};

async function seedOntologyOwner(ownerId: string): Promise<void> {
  const at = FIXTURE_AT;
  const suffix = ownerId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const fixtureHash = await contentHash(suffix);
  await env.DB.prepare(
    `INSERT INTO pattern_source_corpus_releases (
       corpus_release_id, corpus_hash, locale, object_key, fragment_count,
       license_class, public_capable, created_at, registered_at
     ) VALUES (?, ?, 'en-US', ?, 1, 'internal_synthetic', 0, ?, ?)`,
  ).bind(
    `corpus_${suffix}`,
    fixtureHash,
    `ontology-corpora/${suffix}.json.enc`,
    at,
    at,
  ).run();
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pipeline_runs (
       run_id, idempotency_key, corpus_release_id, corpus_hash,
       candidate_ontology_version, configuration_json, configuration_hash,
       stage, stage_generation, stage_cursor, stage_attempt,
       claim_token, lease_expires_at, available_at, dispatched_at,
       failure_class, candidate_hash, compilation_report_hash,
       evaluation_report_hash, regression_report_hash, bundle_hash,
       failed_artifact_expires_at, created_at, updated_at,
       finished_at, succeeded_at, failed_at
     ) VALUES (
       ?, ?, ?, ?, ?, '{}', ?, 'reserved', 0, 0, 0,
       NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, ?, ?, NULL, NULL, NULL
     )`,
  ).bind(
    ownerId,
    `idem_${suffix}`,
    `corpus_${suffix}`,
    fixtureHash,
    `ontology-${suffix}-v1`,
    fixtureHash,
    at,
    at,
    at,
  ).run();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = 'corpus_reading', stage_generation = 1, updated_at = ?
     WHERE run_id = ?`,
  ).bind(at, ownerId).run();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET stage = 'generating', stage_generation = 2, updated_at = ?
     WHERE run_id = ?`,
  ).bind(at, ownerId).run();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET dispatched_at = ?, updated_at = ?
     WHERE run_id = ?`,
  ).bind(at, at, ownerId).run();
}

async function enqueueFixture(options: {
  ownerId?: string;
  dailyCallLimit?: number;
  stageGeneration?: number;
} = {}): Promise<string> {
  const ownerId = options.ownerId ?? "oprun_codex_route_fixture";
  await seedOntologyOwner(ownerId);
  const serialized = canonicalJson(invocation);
  const requestHash = await contentHash(serialized);
  const stageGeneration = options.stageGeneration ?? 2;
  const jobId = await codexProviderJobId({
    pipeline: "ontology",
    ownerId,
    pass: "generator",
    stageGeneration,
    stageAttempt: 0,
    requestHash,
  });
  const coordinate: CodexProviderArtifactCoordinate = {
    jobId,
    pipeline: "ontology",
    ownerId,
    pass: "generator",
    stageGeneration,
    stageAttempt: 0,
    role: "request",
  };
  const request = await putCodexProviderArtifact(
    env,
    coordinate,
    textEncoder.encode(serialized),
  );
  await enqueueCodexProviderJob(
    env,
    {
      pipeline: "ontology",
      ownerId: coordinate.ownerId,
      userId: null,
      pass: "generator",
      stageGeneration: coordinate.stageGeneration,
      stageAttempt: coordinate.stageAttempt,
      request: request.artifact,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      promptVersion: "1.0.5",
      timeoutMs: 900_000,
      dailyCallLimit: options.dailyCallLimit ?? 500,
    },
    new Date(FIXTURE_AT),
  );
  return jobId;
}

async function claim(body = "{}") {
  return SELF.fetch("https://worker.test/codex-provider/v1/jobs/claim", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RUNNER_TOKEN}`,
      "content-type": "application/json",
    },
    body,
  });
}

async function claimedFixture(): Promise<{
  jobId: string;
  leaseToken: string;
  ownerId: string;
}> {
  const ownerId = `oprun_codex_route_${crypto.randomUUID()}`;
  const jobId = await enqueueFixture({
    ownerId,
  });
  const response = await claim();
  expect(response.status).toBe(200);
  const body = await response.json<{
    job_id: string;
    lease_token: string;
  }>();
  return { jobId, leaseToken: body.lease_token, ownerId };
}

async function complete(
  jobId: string,
  document: Record<string, unknown>,
) {
  return SELF.fetch(
    `https://worker.test/codex-provider/v1/jobs/${jobId}/complete`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${RUNNER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(document),
    },
  );
}

async function fail(
  jobId: string,
  document: Record<string, unknown>,
) {
  return SELF.fetch(
    `https://worker.test/codex-provider/v1/jobs/${jobId}/fail`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${RUNNER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(document),
    },
  );
}

describe("Codex provider runner routes", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_RUNNER_TOKEN = RUNNER_TOKEN;
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
      version: 1,
      keys: {
        "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      },
    });
    enableOntologyCodex();
  });

  it("leases one encrypted invocation and charges its existing budget", async () => {
    const jobId = await enqueueFixture();
    const response = await claim();

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body).toEqual({
      schema_version: "codex-provider-claim/v1",
      job_id: jobId,
      lease_token: expect.stringMatching(/^cplease_[a-f0-9]{32}$/),
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      prompt_version: "1.0.5",
      timeout_ms: 900000,
      invocation,
    });
    expect(body).not.toHaveProperty("owner_id");
    expect(body).not.toHaveProperty("user_id");

    expect(
      await rows<{
        used_calls: number;
        generator_calls: number;
        evaluator_calls: number;
        regression_calls: number;
      }>(
        `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
         FROM pattern_ontology_provider_daily_usage`,
      ),
    ).toEqual([{
      used_calls: 1,
      generator_calls: 1,
      evaluator_calls: 0,
      regression_calls: 0,
    }]);

    expect((await claim()).status).toBe(204);
  });

  it("maintenance repairs a completed job whose owner nudge never ran", async () => {
    const jobId = await enqueueFixture();
    const claimed = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T02:00:00.000Z"),
    );
    if (claimed.status !== "claimed") throw new Error("fixture claim failed");
    const response = await putCodexProviderArtifact(
      env,
      {
        jobId,
        pipeline: "ontology",
        ownerId: "oprun_codex_route_fixture",
        pass: "generator",
        stageGeneration: 2,
        stageAttempt: 0,
        role: "response",
      },
      textEncoder.encode('{"answer":"ok"}'),
    );
    expect(await completeCodexProviderJob(env, {
      jobId,
      leaseToken: claimed.leaseToken,
      response: response.artifact,
      providerRequestId: "thread_repair",
      inputTokens: 3,
      outputTokens: 2,
    }, new Date("2026-08-24T02:01:00.000Z"))).toMatchObject({
      status: "completed",
    });
    const send = vi.spyOn(env.ONTOLOGY_PIPELINE_QUEUE, "send");

    await maintainCodexProviderJobs(
      env,
      new Date("2026-08-24T02:02:00.000Z"),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      run_id: "oprun_codex_route_fixture",
      stage_generation: 2,
    });
  });

  it("maintenance cancels a stale pending coordinate without invoking it", async () => {
    const jobId = await enqueueFixture({ stageGeneration: 1 });
    await maintainCodexProviderJobs(
      env,
      new Date("2026-08-24T02:00:00.000Z"),
    );
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toEqual({ status: "cancelled" });
  });

  it("maintenance expires ontology provider objects with a failed run", async () => {
    const jobId = await enqueueFixture();
    const claimed = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T02:00:00.000Z"),
    );
    if (claimed.status !== "claimed") throw new Error("fixture claim failed");
    const response = await putCodexProviderArtifact(
      env,
      {
        jobId,
        pipeline: "ontology",
        ownerId: "oprun_codex_route_fixture",
        pass: "generator",
        stageGeneration: 2,
        stageAttempt: 0,
        role: "response",
      },
      textEncoder.encode('{"answer":"ok"}'),
    );
    expect(await completeCodexProviderJob(env, {
      jobId,
      leaseToken: claimed.leaseToken,
      response: response.artifact,
      providerRequestId: "thread_retention",
      inputTokens: 3,
      outputTokens: 2,
    }, new Date("2026-08-24T02:01:00.000Z"))).toMatchObject({
      status: "completed",
    });
    const ownerClaimedAt = new Date();
    const owner = await claimOntologyPipelineRun(
      env,
      { run_id: "oprun_codex_route_fixture", stage_generation: 2 },
      ownerClaimedAt,
      "ontology-retention-owner",
    );
    if (owner.status !== "claimed") throw new Error("owner claim failed");
    const failedAt = new Date(ownerClaimedAt.getTime() + 1_000);
    expect(await failOntologyPipelineRun(
      env,
      owner,
      "execution_error",
      failedAt,
    )).toBe(true);

    await maintainCodexProviderJobs(
      env,
      new Date(failedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
    );

    expect(await env.DB.prepare(
      "SELECT id FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toBeNull();
    expect(await env.ARTIFACTS!.head(
      `codex-provider-jobs/${jobId}/request.json.enc`,
    )).toBeNull();
    expect(await env.ARTIFACTS!.head(
      `codex-provider-jobs/${jobId}/response.json.enc`,
    )).toBeNull();
  });

  it("maintenance deletes an uploaded response after its lease is reclaimed", async () => {
    const jobId = await enqueueFixture({
      ownerId: `oprun_codex_stale_upload_${crypto.randomUUID()}`,
    });
    const first = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T02:00:00.000Z"),
    );
    if (first.status !== "claimed") throw new Error("first claim failed");
    const upload = await reserveCodexProviderResponseUpload(
      env,
      { jobId, leaseToken: first.leaseToken },
      new Date("2026-08-24T02:19:59.000Z"),
    );
    if (upload.status !== "reserved") throw new Error("upload reservation failed");
    const leaseHash = await contentHash(first.leaseToken);
    await putCodexProviderArtifact(
      env,
      {
        jobId,
        pipeline: "ontology",
        ownerId: first.job.ownerId,
        pass: "generator",
        stageGeneration: 2,
        stageAttempt: 0,
        role: "response",
        storageDiscriminator: leaseHash.slice("sha256:".length),
      },
      textEncoder.encode('{"answer":"stale"}'),
    );
    const second = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T02:25:00.001Z"),
    );
    if (second.status !== "claimed") throw new Error("reclaim failed");

    await maintainCodexProviderJobs(
      env,
      new Date("2026-08-24T02:25:01.000Z"),
    );

    expect(await env.ARTIFACTS!.head(upload.objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT object_key FROM codex_provider_response_uploads
       WHERE object_key = ?`,
    ).bind(upload.objectKey).first()).toBeNull();
  });

  it("requires an empty exact-field claim document", async () => {
    await enqueueFixture();
    expect((await claim('{"extra":true}')).status).toBe(400);
    expect((await claim("not-json")).status).toBe(400);

    const [row] = await rows<{ status: string }>(
      "SELECT status FROM codex_provider_jobs",
    );
    expect(row).toEqual({ status: "pending" });
  });

  it("stores encrypted completion and adopts only an exact replay", async () => {
    const { jobId, leaseToken, ownerId } = await claimedFixture();
    const send = vi.spyOn(env.ONTOLOGY_PIPELINE_QUEUE, "send");
    const document = {
      lease_token: leaseToken,
      output: '{"answer":"ok"}',
      provider_request_id: "thread_123",
      input_tokens: 10,
      output_tokens: 4,
    };

    expect((await complete(jobId, document)).status).toBe(200);
    expect(send).toHaveBeenCalledWith({
      run_id: ownerId,
      stage_generation: 2,
    });
    expect((await complete(jobId, document)).status).toBe(200);

    const [row] = await rows<{
      status: string;
      response_object_key: string;
      provider_request_id: string;
      input_tokens: number;
      output_tokens: number;
    }>(
      `SELECT status, response_object_key, provider_request_id,
              input_tokens, output_tokens
       FROM codex_provider_jobs WHERE id = ?`,
      jobId,
    );
    expect(row).toEqual({
      status: "completed",
      response_object_key: expect.stringMatching(
        new RegExp(`^codex-provider-jobs/${jobId}/responses/[a-f0-9]{64}\\.json\\.enc$`),
      ),
      provider_request_id: "thread_123",
      input_tokens: 10,
      output_tokens: 4,
    });
    if (!env.ARTIFACTS) throw new Error("test artifact bucket missing");
    const stored = await env.ARTIFACTS.get(row!.response_object_key);
    expect(stored).not.toBeNull();
    expect(await stored!.text()).not.toContain(document.output);

    const conflict = await complete(jobId, {
      ...document,
      output: '{"answer":"different"}',
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain("different");
  });

  it("rejects stale completion before writing a response object", async () => {
    const { jobId } = await claimedFixture();
    const response = await complete(jobId, {
      lease_token: "cplease_00000000000000000000000000000000",
      output: '{"answer":"must-not-be-stored"}',
      provider_request_id: "thread_stale",
      input_tokens: 1,
      output_tokens: 1,
    });

    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("must-not-be-stored");
    if (!env.ARTIFACTS) throw new Error("test artifact bucket missing");
    expect(
      await env.ARTIFACTS.get(
        `codex-provider-jobs/${jobId}/response.json.enc`,
      ),
    ).toBeNull();
  });

  it("persists only a closed runner failure", async () => {
    const { jobId, leaseToken } = await claimedFixture();
    const document = {
      lease_token: leaseToken,
      code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
    };

    expect((await fail(jobId, document)).status).toBe(200);
    expect((await fail(jobId, document)).status).toBe(200);
    expect((await fail(jobId, {
      ...document,
      safe_detail_code: "network_error",
    })).status).toBe(409);
    expect((await fail(jobId, {
      ...document,
      diagnostic: "secret stderr",
    })).status).toBe(400);

    const [row] = await rows<{
      status: string;
      failure_code: string;
      safe_detail_code: string;
    }>(
      `SELECT status, failure_code, safe_detail_code
       FROM codex_provider_jobs WHERE id = ?`,
      jobId,
    );
    expect(row).toEqual({
      status: "failed",
      failure_code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
    });
  });

  it("enforces strict completion documents and byte limits", async () => {
    const { jobId, leaseToken } = await claimedFixture();
    expect((await complete(jobId, {
      lease_token: leaseToken,
      output: "x".repeat(1024 * 1024 + 1),
      provider_request_id: "thread_large",
      input_tokens: 1,
      output_tokens: 1,
    })).status).toBe(413);
    expect((await complete(jobId, {
      lease_token: leaseToken,
      output: "{}",
      provider_request_id: "thread_extra",
      input_tokens: 1,
      output_tokens: 1,
      extra: true,
    })).status).toBe(400);
  });

  it("cancels work whose immutable domain coordinate is no longer current", async () => {
    const jobId = await enqueueFixture();
    const at = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'compiling', stage_generation = 3,
           candidate_hash = ?, dispatched_at = NULL, updated_at = ?
       WHERE run_id = 'oprun_codex_route_fixture'`,
    ).bind(HASH, at).run();

    expect((await claim()).status).toBe(204);
    const [row] = await rows<{ status: string }>(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
      jobId,
    );
    expect(row).toEqual({ status: "cancelled" });
  });

  it("cancels unclaimed work when the ontology rollout is disabled", async () => {
    const jobId = await enqueueFixture();
    env.ONTOLOGY_PIPELINE_ROLLOUT = "off";

    expect((await claim()).status).toBe(204);
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toEqual({ status: "cancelled" });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_ontology_provider_daily_usage",
    ).first()).toEqual({ count: 0 });
  });

  it("cancels a leased job instead of accepting completion after rollout disablement", async () => {
    const { jobId, leaseToken } = await claimedFixture();
    env.ONTOLOGY_PIPELINE_ROLLOUT = "off";

    const response = await complete(jobId, {
      lease_token: leaseToken,
      output: '{"answer":"must-not-be-stored"}',
      provider_request_id: "thread_disabled",
      input_tokens: 1,
      output_tokens: 1,
    });

    expect(response.status).toBe(409);
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toEqual({ status: "cancelled" });
  });

  it("cancels a leased job instead of accepting failure after rollout disablement", async () => {
    const { jobId, leaseToken } = await claimedFixture();
    env.ONTOLOGY_PIPELINE_ROLLOUT = "off";

    expect((await fail(jobId, {
      lease_token: leaseToken,
      code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
    })).status).toBe(409);
    expect(await env.DB.prepare(
      "SELECT status FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toEqual({ status: "cancelled" });
  });

  it("records exhausted daily budget as a closed terminal result", async () => {
    env.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = "1";
    await enqueueFixture({ dailyCallLimit: 1 });
    expect((await claim()).status).toBe(200);

    const secondId = await enqueueFixture({
      ownerId: "oprun_codex_route_budget_second",
      dailyCallLimit: 1,
    });
    expect((await claim()).status).toBe(204);
    const [row] = await rows<{
      status: string;
      failure_code: string;
      safe_detail_code: string;
    }>(
      `SELECT status, failure_code, safe_detail_code
       FROM codex_provider_jobs WHERE id = ?`,
      secondId,
    );
    expect(row).toEqual({
      status: "failed",
      failure_code: "publisher_budget_exhausted",
      safe_detail_code: "daily_call_limit_reached",
    });
  });
});
