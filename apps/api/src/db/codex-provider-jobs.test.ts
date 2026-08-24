import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb, rows } from "../../test/helpers.js";
import {
  claimCodexProviderJob,
  completeCodexProviderJob,
  enqueueCodexProviderJob,
  failCodexProviderJob,
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
});
