import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  IDENTITY_B,
  READING_CODEX_PUBLISHER_VARS,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { claimJob } from "../db/generation.js";
import type { CodexProviderJob } from "../db/codex-provider-jobs.js";
import { enqueueConstrainedReading, resolveV5TargetDate } from "./enqueue.js";
import {
  loadCurrentDailyOwner,
  readingProviderOwnerIsCurrent,
} from "./reading-current-owner.js";
import { codexProviderOwnerIsCurrent } from "./codex-provider-domain.js";
import {
  OPENAI_READING_MODEL,
  READING_PROMPT_VERSION,
} from "./reading-publisher.js";

const ZONE = "America/Chicago";

function enabledEnv(overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "hybrid",
    ...READING_CODEX_PUBLISHER_VARS,
    ...overrides,
  };
}

async function grantAiSynthesis(consentId = "cns_owner_ai_0001"): Promise<void> {
  const now = "2026-08-27T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version,
       allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    consentId,
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    now,
    now,
    now,
  );
}

async function reserve(): Promise<{ jobId: string; readingId: string }> {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  await grantAiSynthesis();
  const targetLocalDate = resolveV5TargetDate(ZONE, new Date());
  if (!targetLocalDate) throw new Error("test date did not resolve");
  const enqueued = await enqueueConstrainedReading(enabledEnv(), USER_A, {
    entry: "internal",
    reservationReason: "internal",
    targetLocalDate,
  });
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
  return { jobId: enqueued.jobId, readingId: enqueued.readingId };
}

/**
 * A reservation whose first real Daily attempt has been claimed.
 *
 * `jobs.attempts` is 1 after the first claim, which is what makes
 * `stage_attempt = 0` the legal provider coordinate. A reserved-but-unclaimed
 * job has attempts 0 and therefore no legal coordinate at all — the provider
 * work does not exist until the Queue has actually taken the job.
 */
async function reserveClaimed(): Promise<{ jobId: string; readingId: string }> {
  const reserved = await reserve();
  const claim = await claimJob(enabledEnv(), reserved.jobId);
  if (!claim) throw new Error("job did not claim");
  return reserved;
}

/**
 * A provider job that matches the owner exactly, built from the owner's own
 * command rather than from constants. Anything a test wants to be stale, it
 * makes stale explicitly.
 */
function providerJob(
  overrides: Partial<CodexProviderJob> & { ownerId: string },
): CodexProviderJob {
  const id = `cpjob_${"7".repeat(32)}`;
  return {
    id,
    pipeline: "reading",
    userId: USER_A,
    pass: "publisher",
    stageGeneration: 1,
    stageAttempt: 0,
    request: {
      objectKey: `codex-provider-jobs/${id}/request.json.enc`,
      plaintextHash: `sha256:${"1".repeat(64)}`,
      envelopeHash: `sha256:${"2".repeat(64)}`,
      ciphertextHash: `sha256:${"3".repeat(64)}`,
      keyId: "codex-test-key",
      nonce: "AAAAAAAAAAAAAAAA",
      byteLength: 1024,
    },
    response: null,
    model: OPENAI_READING_MODEL,
    reasoningEffort: "high",
    promptVersion: READING_PROMPT_VERSION,
    timeoutMs: 900_000,
    dailyCallLimit: 250,
    status: "pending",
    leaseExpiresAt: null,
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    failureCode: null,
    safeDetailCode: null,
    availableAt: "2026-08-27T00:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("the read-only current Daily owner", () => {
  beforeEach(resetDb);

  it("loads the reserved job, its reading, and its frozen V2 command", async () => {
    const { jobId, readingId } = await reserve();

    const owner = await loadCurrentDailyOwner(enabledEnv(), jobId);
    expect(owner).not.toBeNull();
    expect(owner!.jobId).toBe(jobId);
    expect(owner!.userId).toBe(USER_A);
    expect(owner!.readingId).toBe(readingId);
    // Reserved, never claimed. Loading an owner must not spend an attempt.
    expect(owner!.attempts).toBe(0);
    expect(owner!.command.publisher.provider).toBe("codex");
    expect(owner!.command.command_generation).toBe(1);

    const [job] = await rows<{ status: string; attempts: number; claim_token: string | null }>(
      "SELECT status, attempts, claim_token FROM jobs WHERE id = ?",
      jobId,
    );
    expect(job).toEqual({ status: "queued", attempts: 0, claim_token: null });
  });

  it("answers null for every shape that is not a live Daily owner", async () => {
    const { jobId, readingId } = await reserve();
    const current = enabledEnv();

    expect(await loadCurrentDailyOwner(current, "job_does_not_exist")).toBeNull();

    // A job of another type, even with a real id.
    await rows("UPDATE jobs SET job_type = 'export_account' WHERE id = ?", jobId);
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows("UPDATE jobs SET job_type = 'generate_daily_reading' WHERE id = ?", jobId);
    expect(await loadCurrentDailyOwner(current, jobId)).not.toBeNull();

    // A terminal job. The reader is no longer waiting on it.
    for (const status of ["succeeded", "failed", "cancelled"]) {
      await rows("UPDATE jobs SET status = ? WHERE id = ?", status, jobId);
      expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    }
    await rows("UPDATE jobs SET status = 'queued' WHERE id = ?", jobId);

    // A reading that is no longer pending means a provider result has nowhere
    // to go. `published` and `invalidated` additionally require the sealed
    // artifact, so they are exercised with one.
    for (const status of ["failed", "superseded"]) {
      await rows("UPDATE daily_readings SET status = ? WHERE id = ?", status, readingId);
      expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    }
    await rows("UPDATE daily_readings SET status = 'pending' WHERE id = ?", readingId);

    await rows(
      `UPDATE daily_readings
       SET status = 'published', reading_enc = X'00',
           reading_key_version = 1, reading_nonce = 'AAAAAAAAAAAAAAAA'
       WHERE id = ?`,
      readingId,
    );
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows(
      `UPDATE daily_readings SET status = 'invalidated', invalidated_at = ?
       WHERE id = ?`,
      "2026-08-27T01:00:00.000Z",
      readingId,
    );
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows(
      `UPDATE daily_readings
       SET status = 'pending', invalidated_at = NULL, reading_enc = NULL,
           reading_key_version = NULL, reading_nonce = NULL
       WHERE id = ?`,
      readingId,
    );

    // The reservation no longer names this job as its active generation.
    await rows(
      "UPDATE daily_readings SET active_generation_job_id = NULL WHERE id = ?",
      readingId,
    );
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows(
      "UPDATE daily_readings SET active_generation_job_id = ? WHERE id = ?",
      jobId,
      readingId,
    );

    // A reading and its job cannot even be made to disagree about the reader:
    // the composite foreign key (active_generation_job_id, user_id) -> jobs
    // (id, user_id) refuses it, so cross-user adoption is structural rather
    // than a check this loader could forget.
    await seedUser(IDENTITY_B);
    await expect(
      rows("UPDATE daily_readings SET user_id = ? WHERE id = ?", USER_B, readingId),
    ).rejects.toThrow(/FOREIGN KEY/);

    // The account is no longer active. Deletion and suspension both land here.
    await rows("UPDATE users SET status = 'deleted' WHERE id = ?", USER_A);
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows("UPDATE users SET status = 'active' WHERE id = ?", USER_A);

    expect(await loadCurrentDailyOwner(current, jobId)).not.toBeNull();
  });

  it("answers null for an undecryptable payload", async () => {
    const { jobId } = await reserve();
    const current = enabledEnv();

    const [original] = await rows<{ payload_nonce: string }>(
      "SELECT payload_nonce FROM jobs WHERE id = ?",
      jobId,
    );
    await rows(
      "UPDATE jobs SET payload_nonce = ? WHERE id = ?",
      "AAAAAAAAAAAAAAAA",
      jobId,
    );
    // Not a thrown error: an unreadable command is simply not a current owner,
    // and the ordinary Queue path already has a failure class for it.
    expect(await loadCurrentDailyOwner(current, jobId)).toBeNull();
    await rows(
      "UPDATE jobs SET payload_nonce = ? WHERE id = ?",
      original!.payload_nonce,
      jobId,
    );
    expect(await loadCurrentDailyOwner(current, jobId)).not.toBeNull();
  });
});

describe("reading provider owner admission", () => {
  beforeEach(resetDb);

  it("admits exactly the coordinate the frozen command describes", async () => {
    const { jobId } = await reserveClaimed();
    const current = enabledEnv();
    const job = providerJob({ ownerId: jobId });

    expect(await readingProviderOwnerIsCurrent(current, job)).toBe(true);
    // The shared dispatcher must route reading work to this predicate rather
    // than falling through to the ontology one.
    expect(await codexProviderOwnerIsCurrent(current, job)).toBe(true);
  });

  it("refuses a coordinate that does not match the owner", async () => {
    const { jobId } = await reserveClaimed();
    const current = enabledEnv();

    for (const drift of [
      { ownerId: "job_not_this_one" },
      { userId: USER_B },
      { userId: null },
      { stageGeneration: 2 },
      { stageAttempt: 1 },
      { pipeline: "pattern" as const, pass: "writer" as const },
      { pass: "planner" as const },
    ]) {
      const job = providerJob({ ownerId: jobId, ...drift });
      expect(
        await readingProviderOwnerIsCurrent(current, job),
        JSON.stringify(drift),
      ).toBe(false);
    }
  });

  it("tracks the actual Daily attempt as the zero-based provider coordinate", async () => {
    const { jobId } = await reserveClaimed();
    const current = enabledEnv();

    expect(
      await readingProviderOwnerIsCurrent(
        current,
        providerJob({ ownerId: jobId, stageAttempt: 0 }),
      ),
    ).toBe(true);
    expect(
      await readingProviderOwnerIsCurrent(
        current,
        providerJob({ ownerId: jobId, stageAttempt: 1 }),
      ),
    ).toBe(false);

    await rows("UPDATE jobs SET attempts = 2 WHERE id = ?", jobId);
    expect(
      await readingProviderOwnerIsCurrent(
        current,
        providerJob({ ownerId: jobId, stageAttempt: 1 }),
      ),
    ).toBe(true);
    // The previous attempt's runner lease must not publish into the new one.
    expect(
      await readingProviderOwnerIsCurrent(
        current,
        providerJob({ ownerId: jobId, stageAttempt: 0 }),
      ),
    ).toBe(false);
  });

  it("refuses a frozen OpenAI command rather than executing it through Codex", async () => {
    const { jobId } = await reserveClaimed();
    const current = enabledEnv();
    const job = providerJob({ ownerId: jobId });
    expect(await readingProviderOwnerIsCurrent(current, job)).toBe(true);

    // The command's own pin says a different service wrote it. Running it here
    // would publish prose that falsifies its own provenance.
    const owner = await loadCurrentDailyOwner(current, jobId);
    expect(owner!.command.publisher.provider).toBe("codex");
    const openAiEnv = enabledEnv({ READING_PUBLISHER: "openai" });
    expect(await readingProviderOwnerIsCurrent(openAiEnv, job)).toBe(false);
  });

  it("refuses when any member of the publisher pin has drifted", async () => {
    const { jobId } = await reserveClaimed();

    for (const drift of [
      { OPENAI_READING_PROMPT_VERSION: "9.9.9" },
      { OPENAI_READING_MAX_OUTPUT_TOKENS: "1800" },
      { READING_CONTEXT_MAX_BYTES: "65536" },
      { READING_DAILY_PROVIDER_CALL_LIMIT: "17" },
    ]) {
      const drifted = enabledEnv(drift as Partial<typeof env>);
      expect(
        await readingProviderOwnerIsCurrent(
          drifted,
          providerJob({ ownerId: jobId }),
        ),
        JSON.stringify(drift),
      ).toBe(false);
    }

    // And when the provider job itself disagrees with the command it claims to
    // be executing.
    const current = enabledEnv();
    for (const drift of [
      { model: "gpt-4o" },
      { promptVersion: "0.9.0" },
      { timeoutMs: 90_000 },
      { dailyCallLimit: 1 },
    ]) {
      expect(
        await readingProviderOwnerIsCurrent(
          current,
          providerJob({ ownerId: jobId, ...drift }),
        ),
        JSON.stringify(drift),
      ).toBe(false);
    }
  });

  it("refuses while the Daily kill switch is off", async () => {
    const { jobId } = await reserveClaimed();
    const job = providerJob({ ownerId: jobId });
    expect(await readingProviderOwnerIsCurrent(enabledEnv(), job)).toBe(true);
    // `off` resolves no configuration at all, so there is no pin to match and
    // no provider work may proceed.
    expect(
      await readingProviderOwnerIsCurrent(
        enabledEnv({ READING_V5_ROLLOUT: "off" }),
        job,
      ),
    ).toBe(false);
  });

  it("refuses once the pinned consent is no longer the active grant", async () => {
    const { jobId } = await reserveClaimed();
    const current = enabledEnv();
    const job = providerJob({ ownerId: jobId });
    expect(await readingProviderOwnerIsCurrent(current, job)).toBe(true);

    await rows(
      "UPDATE consents SET status = 'revoked', revoked_at = ? WHERE id = ?",
      "2026-08-27T02:00:00.000Z",
      "cns_owner_ai_0001",
    );
    expect(await readingProviderOwnerIsCurrent(current, job)).toBe(false);

    // Re-granting mints a NEW consent id. The reader agreed again, but to the
    // policy in front of them at that moment, and the frozen command records
    // which grant it was built under.
    await grantAiSynthesis("cns_owner_ai_0002");
    expect(await readingProviderOwnerIsCurrent(current, job)).toBe(false);
  });
});
