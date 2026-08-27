import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb, rows, seedUser, IDENTITY_A, USER_A } from "../../test/helpers.js";
import {
  claimCodexProviderJob,
  codexProviderJobId,
  completeCodexProviderJob,
  enqueueCodexProviderJob,
  failCodexProviderJob,
  reserveCodexProviderResponseUpload,
  validCodexProviderCoordinate,
  validCodexProviderOwnership,
  type CodexProviderPass,
  type CodexProviderPipeline,
} from "./codex-provider-jobs.js";

const REQUEST_HASH = `sha256:${"11".repeat(32)}`;
const RESPONSE_HASH = `sha256:${"22".repeat(32)}`;

function requestArtifact(hash = REQUEST_HASH) {
  return {
    objectKey: "codex-provider-jobs/cpjob_fixture/request.json.enc",
    plaintextHash: hash,
    envelopeHash: `sha256:${"33".repeat(32)}`,
    ciphertextHash: `sha256:${"44".repeat(32)}`,
    keyId: "codex-test-key",
    nonce: "AAAAAAAAAAAAAAAA",
    byteLength: 512,
  };
}

function responseArtifact(hash = RESPONSE_HASH) {
  return {
    objectKey: "codex-provider-jobs/cpjob_fixture/response.json.enc",
    plaintextHash: hash,
    envelopeHash: `sha256:${"55".repeat(32)}`,
    ciphertextHash: `sha256:${"66".repeat(32)}`,
    keyId: "codex-test-key",
    nonce: "BBBBBBBBBBBBBBBB",
    byteLength: 128,
  };
}

function enqueueInput(requestHash = REQUEST_HASH) {
  return {
    pipeline: "ontology" as const,
    ownerId: "oprun_codex_provider_fixture",
    userId: null,
    pass: "generator" as const,
    stageGeneration: 2,
    stageAttempt: 0,
    request: requestArtifact(requestHash),
    model: "gpt-5.6-sol",
    reasoningEffort: "high" as const,
    promptVersion: "1.0.5",
    timeoutMs: 900_000,
    dailyCallLimit: 500,
  };
}

function readingEnqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    pipeline: "reading" as CodexProviderPipeline,
    ownerId: "job_reading_codex_fixture",
    userId: USER_A as string | null,
    pass: "publisher" as CodexProviderPass,
    stageGeneration: 1,
    stageAttempt: 0,
    request: requestArtifact(),
    model: "gpt-5.6-sol",
    reasoningEffort: "high" as const,
    promptVersion: "1.0.1",
    timeoutMs: 900_000,
    dailyCallLimit: 10_000,
    ...overrides,
  };
}

describe("the closed Codex provider coordinate", () => {
  it("admits exactly the pipeline passes that have an owner behind them", () => {
    const legal: Array<[CodexProviderPipeline, CodexProviderPass]> = [
      ["pattern", "planner"],
      ["pattern", "writer"],
      ["pattern", "verifier"],
      ["ontology", "planner"],
      ["ontology", "writer"],
      ["ontology", "verifier"],
      ["ontology", "generator"],
      ["ontology", "evaluator"],
      ["reading", "publisher"],
    ];
    for (const [pipeline, pass] of legal) {
      expect(validCodexProviderCoordinate(pipeline, pass)).toBe(true);
    }
    const illegal: Array<[CodexProviderPipeline, CodexProviderPass]> = [
      ["reading", "planner"],
      ["reading", "writer"],
      ["reading", "verifier"],
      ["reading", "generator"],
      ["reading", "evaluator"],
      ["pattern", "publisher"],
      ["pattern", "generator"],
      ["pattern", "evaluator"],
      ["ontology", "publisher"],
    ];
    for (const [pipeline, pass] of illegal) {
      expect(validCodexProviderCoordinate(pipeline, pass)).toBe(false);
    }
  });

  it("requires an owner on user work and refuses one on ontology work", () => {
    expect(validCodexProviderOwnership("reading", USER_A)).toBe(true);
    expect(validCodexProviderOwnership("pattern", USER_A)).toBe(true);
    expect(validCodexProviderOwnership("ontology", null)).toBe(true);
    expect(validCodexProviderOwnership("reading", null)).toBe(false);
    expect(validCodexProviderOwnership("pattern", null)).toBe(false);
    expect(validCodexProviderOwnership("ontology", USER_A)).toBe(false);
  });
});

describe("Codex provider reading jobs", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("derives one deterministic id from the coordinate and the request bytes", async () => {
    const base = {
      pipeline: "reading" as const,
      ownerId: "job_reading_codex_fixture",
      pass: "publisher" as const,
      stageGeneration: 1,
      stageAttempt: 0,
      requestHash: REQUEST_HASH,
    };
    const id = await codexProviderJobId(base);
    expect(id).toMatch(/^cpjob_[a-f0-9]{32}$/);
    expect(await codexProviderJobId(base)).toBe(id);
    // Every member of the preimage moves the identity, which is what makes a
    // duplicate delivery adopt and a genuine retry create.
    for (const drift of [
      { ...base, ownerId: "job_reading_codex_other" },
      { ...base, stageGeneration: 2 },
      { ...base, stageAttempt: 1 },
      { ...base, requestHash: RESPONSE_HASH },
      { ...base, pipeline: "pattern" as const, pass: "writer" as const },
    ]) {
      expect(await codexProviderJobId(drift)).not.toBe(id);
    }
  });

  it("creates once and adopts the identical reading coordinate", async () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    const first = await enqueueCodexProviderJob(env, readingEnqueueInput(), now);
    const second = await enqueueCodexProviderJob(env, readingEnqueueInput(), now);

    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "adopted", job: first.job });
    expect(first.job.pipeline).toBe("reading");
    expect(first.job.pass).toBe("publisher");
    expect(first.job.userId).toBe(USER_A);
    expect(first.job.status).toBe("pending");
    expect(await rows("SELECT COUNT(*) AS count FROM codex_provider_jobs"))
      .toEqual([{ count: 1 }]);
  });

  it("refuses an illegal coordinate before any row is written", async () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    const illegal = [
      readingEnqueueInput({ pass: "planner" }),
      readingEnqueueInput({ pipeline: "pattern", pass: "publisher" }),
      readingEnqueueInput({ pipeline: "ontology", pass: "publisher", userId: null }),
      readingEnqueueInput({ userId: null }),
      readingEnqueueInput({ pipeline: "ontology", pass: "generator" }),
    ];
    for (const input of illegal) {
      await expect(enqueueCodexProviderJob(env, input, now)).rejects.toThrow();
    }
    // Nothing reached D1. The same guard runs before the encrypted request
    // object is written, so nothing reached R2 either.
    expect(await rows("SELECT COUNT(*) AS count FROM codex_provider_jobs"))
      .toEqual([{ count: 0 }]);
  });
});

describe("Codex provider durable jobs", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates once and adopts an identical immutable coordinate", async () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    const first = await enqueueCodexProviderJob(env, enqueueInput(), now);
    const second = await enqueueCodexProviderJob(env, enqueueInput(), now);

    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "adopted", job: first.job });
    expect(first.job.id).toMatch(/^cpjob_[a-f0-9]{32}$/);

    const stored = await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    );
    expect(stored).toEqual([{ count: 1 }]);
  });

  it("refuses different request bytes at an occupied stage attempt", async () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    await enqueueCodexProviderJob(env, enqueueInput(), now);

    await expect(
      enqueueCodexProviderJob(
        env,
        {
          ...enqueueInput(`sha256:${"99".repeat(32)}`),
          request: {
            ...requestArtifact(`sha256:${"99".repeat(32)}`),
            objectKey:
              "codex-provider-jobs/cpjob_other/request.json.enc",
          },
        },
        now,
      ),
    ).rejects.toThrow("codex provider job identity conflict");
  });

  it("leases one job and reclaims it only after expiry", async () => {
    const createdAt = new Date("2026-08-24T00:00:00.000Z");
    await enqueueCodexProviderJob(env, enqueueInput(), createdAt);

    const first = await claimCodexProviderJob(env, createdAt);
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("claim missing");

    expect(
      await claimCodexProviderJob(
        env,
        new Date("2026-08-24T00:19:59.999Z"),
      ),
    ).toEqual({ status: "empty" });

    const reclaimed = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T00:20:00.001Z"),
    );
    expect(reclaimed.status).toBe("claimed");
    if (reclaimed.status !== "claimed") throw new Error("reclaim missing");
    expect(reclaimed.job.id).toBe(first.job.id);
    expect(reclaimed.leaseToken).not.toBe(first.leaseToken);
  });

  it("fences completion and adopts only byte-identical replay", async () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    await enqueueCodexProviderJob(env, enqueueInput(), now);
    const claim = await claimCodexProviderJob(env, now);
    if (claim.status !== "claimed") throw new Error("claim missing");

    const completion = {
      jobId: claim.job.id,
      leaseToken: claim.leaseToken,
      response: responseArtifact(),
      providerRequestId: "thread_123",
      inputTokens: 10,
      outputTokens: 4,
    };
    expect(
      await completeCodexProviderJob(
        env,
        { ...completion, leaseToken: "lease_wrong_0123456789abcdefghijklmnop" },
        new Date("2026-08-24T00:01:00.000Z"),
      ),
    ).toEqual({ status: "stale" });

    expect(
      await completeCodexProviderJob(
        env,
        completion,
        new Date("2026-08-24T00:01:00.000Z"),
      ),
    ).toEqual({ status: "completed" });
    expect(
      await completeCodexProviderJob(
        env,
        completion,
        new Date("2026-08-24T00:02:00.000Z"),
      ),
    ).toEqual({ status: "adopted" });
    expect(
      await completeCodexProviderJob(
        env,
        {
          ...completion,
          response: {
            ...responseArtifact(`sha256:${"77".repeat(32)}`),
            objectKey:
              "codex-provider-jobs/cpjob_fixture/conflict.json.enc",
          },
        },
        new Date("2026-08-24T00:02:00.000Z"),
      ),
    ).toEqual({ status: "conflict" });
  });

  it("records one closed failure under the active lease", async () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    await enqueueCodexProviderJob(env, enqueueInput(), now);
    const claim = await claimCodexProviderJob(env, now);
    if (claim.status !== "claimed") throw new Error("claim missing");

    expect(
      await failCodexProviderJob(
        env,
        {
          jobId: claim.job.id,
          leaseToken: claim.leaseToken,
          code: "publisher_unavailable",
          safeDetailCode: "request_timeout",
        },
        new Date("2026-08-24T00:15:00.000Z"),
      ),
    ).toEqual({ status: "failed" });

    const [row] = await rows<{
      status: string;
      failure_code: string;
      safe_detail_code: string;
    }>(
      `SELECT status, failure_code, safe_detail_code
       FROM codex_provider_jobs`,
    );
    expect(row).toEqual({
      status: "failed",
      failure_code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
    });
  });

  it("fences response uploads by lease and gives a reclaimed lease a distinct key", async () => {
    const startedAt = new Date("2026-08-24T00:00:00.000Z");
    await enqueueCodexProviderJob(env, enqueueInput(), startedAt);
    const first = await claimCodexProviderJob(env, startedAt);
    if (first.status !== "claimed") throw new Error("claim missing");

    const reserved = await reserveCodexProviderResponseUpload(
      env,
      { jobId: first.job.id, leaseToken: first.leaseToken },
      new Date("2026-08-24T00:19:59.000Z"),
    );
    expect(reserved).toEqual({
      status: "reserved",
      objectKey: expect.stringMatching(
        new RegExp(`^codex-provider-jobs/${first.job.id}/responses/[a-f0-9]{64}\\.json\\.enc$`),
      ),
    });
    if (reserved.status !== "reserved") throw new Error("reservation missing");
    expect(await claimCodexProviderJob(
      env,
      new Date("2026-08-24T00:20:01.000Z"),
    )).toEqual({ status: "empty" });

    const second = await claimCodexProviderJob(
      env,
      new Date("2026-08-24T00:25:00.001Z"),
    );
    if (second.status !== "claimed") throw new Error("reclaim missing");
    const secondReservation = await reserveCodexProviderResponseUpload(
      env,
      { jobId: second.job.id, leaseToken: second.leaseToken },
      new Date("2026-08-24T00:25:01.000Z"),
    );
    expect(secondReservation.status).toBe("reserved");
    if (secondReservation.status !== "reserved") return;
    expect(secondReservation.objectKey).not.toBe(reserved.objectKey);
    expect(await rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM codex_provider_response_uploads",
    )).toEqual([{ count: 2 }]);
  });
});
