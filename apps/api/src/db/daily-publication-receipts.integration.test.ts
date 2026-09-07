import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CODEX_TEST_ARTIFACT_KEYRING,
  IDENTITY_A,
  READING_CODEX_PUBLISHER_VARS,
  SILENT_READING_QUEUE,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  candidateFor,
  claimReadingJob,
  completeReadingJob,
} from "../../test/codex-reading-runner.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "./consents.js";
import { completeReading, type PublicationInput, claimJob } from "./generation.js";
import {
  loadCodexProviderJob,
  type CodexProviderJob,
} from "./codex-provider-jobs.js";
import { buildDailyPublicationReceiptInsert, proveDailyPublication } from "./daily-publication-receipts.js";
import {
  enqueueConstrainedReading,
  resolveV5TargetDate,
} from "../services/enqueue.js";
import { dispatchGeneration } from "../services/generate-daily-reading.js";
import { deleteUserRows } from "../services/deletion-manifest.js";
import { maintainCodexProviderJobs } from "../services/codex-provider-maintenance.js";
import { DEVELOPMENT_RELEASE_GIT_SHA } from "../services/release-attestation.js";
import { OPENAI_READING_MODEL } from "../services/reading-publisher.js";
import { READING_PROMPT_VERSION } from "../services/reading-prompt.js";

// Hermetic runner fixtures validate the recorded exchange/publication chain.
// They do not call or certify a live model, account, or installed runner.

const ZONE = "America/Chicago";

function enabledEnv(overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "hybrid",
    ...READING_CODEX_PUBLISHER_VARS,
    ...overrides,
  };
}

async function receipts(readingId?: string) {
  return await rows<{
    receipt_id: string;
    reading_id: string;
    job_id: string;
    command_generation: number;
    provider: string;
    provider_job_id: string;
    stage_generation: number;
    stage_attempt: number;
    model: string;
    reasoning_effort: string;
    prompt_version: string;
    request_hash: string;
    response_hash: string;
    input_tokens: number;
    output_tokens: number;
    provider_completed_at: string;
    worker_version_id: string;
    release_git_sha: string;
    published_at: string;
  }>(
    readingId
      ? "SELECT * FROM daily_publication_receipts WHERE reading_id = ?"
      : "SELECT * FROM daily_publication_receipts",
    ...(readingId ? [readingId] : []),
  );
}

interface PublishedReading {
  jobId: string;
  readingId: string;
  /** The provider row as it was before any sweep could reach it. */
  providerJob: CodexProviderJob;
  /** Retained so a duplicate delivery can be replayed against a stale claim. */
  claim: Awaited<ReturnType<typeof claimJob>>;
}

async function publishedReading(publish = true): Promise<PublishedReading> {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  const at = "2026-08-28T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version,
       allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
     VALUES ('cns_receipt_ai_0001', ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    at,
    at,
    at,
  );
  const targetLocalDate = resolveV5TargetDate(ZONE, new Date());
  if (!targetLocalDate) throw new Error("test date did not resolve");
  const enqueued = await enqueueConstrainedReading(
    enabledEnv({ READING_QUEUE: SILENT_READING_QUEUE }),
    USER_A,
    { entry: "internal", reservationReason: "internal", targetLocalDate },
  );
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

  const claim = await claimJob(enabledEnv(), enqueued.jobId);
  if (!claim) throw new Error("claim missing");

  // First pass creates the durable provider job and waits.
  const pending = await dispatchGeneration(enabledEnv(), claim);
  if (pending.ok || pending.reason !== "publisher_pending") {
    throw new Error("expected a durable wait");
  }

  const claimed = await claimReadingJob();
  if (!claimed) throw new Error("provider job missing");
  await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));

  // Second pass adopts the runner's answer and publishes.
  if (publish) {
    const published = await dispatchGeneration(enabledEnv(), claim);
    if (!published.ok) throw new Error(`publication failed: ${published.reason}`);
  }

  const providerJob = await loadCodexProviderJob(env, claimed.job.id);
  if (!providerJob) throw new Error("provider job vanished before the assertions");
  return {
    jobId: enqueued.jobId,
    readingId: enqueued.readingId,
    providerJob,
    claim,
  };
}

describe("Daily publication receipts", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = CODEX_TEST_ARTIFACT_KEYRING;
  });

  it("writes exactly one receipt, carrying the exchange and the release", async () => {
    const { jobId, readingId, providerJob } = await publishedReading();

    const written = await receipts();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      reading_id: readingId,
      job_id: jobId,
      provider: "codex",
      provider_job_id: providerJob.id,
      stage_generation: providerJob.stageGeneration,
      stage_attempt: providerJob.stageAttempt,
      model: OPENAI_READING_MODEL,
      reasoning_effort: "xhigh",
      prompt_version: READING_PROMPT_VERSION,
      // The hashes are of the bytes that actually crossed, not of anything
      // restated from configuration.
      request_hash: providerJob.request.plaintextHash,
      response_hash: providerJob.response!.plaintextHash,
      input_tokens: providerJob.inputTokens,
      output_tokens: providerJob.outputTokens,
      provider_completed_at: providerJob.completedAt,
      release_git_sha: DEVELOPMENT_RELEASE_GIT_SHA,
    });
    expect(written[0]!.receipt_id).toMatch(/^dpr_[0-9a-f]{32}$/);
    expect(written[0]!.worker_version_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(Date.parse(written[0]!.published_at)).toBeGreaterThanOrEqual(
      Date.parse(written[0]!.provider_completed_at),
    );
  });

  it("carries no prose, no reader, and no calendar position", async () => {
    const { readingId } = await publishedReading();
    const claimed = await claimReadingJob();
    // Whatever the runner returned for this reading, none of it may appear here.
    const [row] = await receipts(readingId);
    const serialized = JSON.stringify(row);

    for (const forbidden of [
      "headline",
      "paragraph",
      "reflection",
      USER_A,
      IDENTITY_A.cryptoSubject,
      // A local date is a fact about the reader's day, not about the release.
      "local_date",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Every column is a coordinate, a pin, a hash, a count, an instant, or a
    // deployment identity. No column holds free text from the model.
    expect(claimed).toBeNull();
    expect(Object.keys(row!).sort()).toEqual([
      "command_generation",
      "input_tokens",
      "job_id",
      "model",
      "output_tokens",
      "prompt_version",
      "provider",
      "provider_completed_at",
      "provider_job_id",
      "published_at",
      "reading_id",
      "reasoning_effort",
      "receipt_id",
      "release_git_sha",
      "request_hash",
      "response_hash",
      "stage_attempt",
      "stage_generation",
      "worker_version_id",
    ]);
  });

  it("stays at one receipt when a duplicate delivery replays the same claim", async () => {
    const { readingId, claim } = await publishedReading();
    const [first] = await receipts(readingId);

    // The same claim token, delivered again. The publication batch's opening
    // assertion refuses because the reservation is no longer pending, so the
    // whole batch — receipt included — rolls back.
    const replay = await dispatchGeneration(enabledEnv(), claim!);
    expect(replay).toMatchObject({ ok: false, reason: "duplicate" });

    const after = await receipts(readingId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(first);
  });

  it("survives the provider sweep that erases the encrypted exchange", async () => {
    const { readingId, providerJob } = await publishedReading();

    const summary = await maintainCodexProviderJobs(enabledEnv());

    // The bytes are gone: both R2 objects and the control row itself.
    expect(summary.purged).toBe(1);
    expect(await loadCodexProviderJob(env, providerJob.id)).toBeNull();
    expect(await env.ARTIFACTS!.head(providerJob.request.objectKey)).toBeNull();
    expect(await env.ARTIFACTS!.head(providerJob.response!.objectKey)).toBeNull();

    // The receipt is not, and it still names the row that was collected.
    const [receipt] = await receipts(readingId);
    expect(receipt).toMatchObject({
      provider_job_id: providerJob.id,
      request_hash: providerJob.request.plaintextHash,
      response_hash: providerJob.response!.plaintextHash,
    });
  });

  it("proves receipt -> succeeded job -> published reading, before and after cleanup", async () => {
    const { jobId, readingId, providerJob } = await publishedReading();

    const before = await proveDailyPublication(env, readingId);
    expect(before).toMatchObject({
      reading_id: readingId,
      job_id: jobId,
      provider_job_id: providerJob.id,
      release_git_sha: DEVELOPMENT_RELEASE_GIT_SHA,
    });

    await maintainCodexProviderJobs(enabledEnv());
    expect(await proveDailyPublication(env, readingId)).toEqual(before);
  });

  it("is not deleted by account erasure, and afterwards resolves to nobody", async () => {
    // The reviewed consequence of having no user_id and no foreign keys, made
    // executable. The technical receipt is retained by design, but must not resolve
    // through deleted account rows. Once the reading and job rows are gone the coordinates are opaque
    // text that resolves to nothing.
    const { jobId, readingId } = await publishedReading();

    await rows("INSERT INTO reading_saves (user_id, reading_id, saved_at) VALUES (?, ?, ?)",
      USER_A, readingId, new Date().toISOString());
    await deleteUserRows(enabledEnv(), USER_A, "job_not_a_real_deletion_job");
    expect(await rows("SELECT * FROM reading_saves WHERE user_id = ?", USER_A)).toEqual([]);

    expect(
      await rows("SELECT id FROM daily_readings WHERE id = ?", readingId),
    ).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE id = ?", jobId)).toEqual([]);

    const [receipt] = await receipts(readingId);
    expect(receipt).toBeDefined();
    expect(receipt).toMatchObject({ reading_id: readingId, job_id: jobId });
    // It no longer walks anywhere: the chain needs a succeeded job and a
    // published reading, and neither exists.
    expect(await proveDailyPublication(env, readingId)).toBeNull();
  });

  it("refuses to answer for a job that did not succeed or a reading that is not published", async () => {
    const { jobId, readingId } = await publishedReading();

    await rows("UPDATE jobs SET result_class = 'failed' WHERE id = ?", jobId);
    expect(await proveDailyPublication(env, readingId)).toBeNull();

    await rows("UPDATE jobs SET result_class = 'published' WHERE id = ?", jobId);
    await rows(
      "UPDATE daily_readings SET status = 'invalidated', invalidated_at = ? WHERE id = ?",
      new Date().toISOString(),
      readingId,
    );
    expect(await proveDailyPublication(env, readingId)).toBeNull();
  });
});

async function publicationInput(): Promise<PublicationInput> {
  const { readingId, jobId, providerJob: job, claim } = await publishedReading(false);
  if (!claim) throw new Error("missing claim");
  return {
    identity: IDENTITY_A, readingId, jobId, claimToken: claim.claimToken,
    commandGeneration: claim.command.command_generation,
    predecessor: { kind: "none" },
    reading: { ciphertext: new Uint8Array([1, 2, 3]), keyVersion: 1, nonce: "test-reading" },
    evidence: [{ id: "src_atomic_receipt", paragraphId: "p1", paragraphOrder: 0,
      ciphertext: new Uint8Array([4, 5, 6]), keyVersion: 1, nonce: "test-evidence" }],
    receipt: {
      readingId, jobId, commandGeneration: claim.command.command_generation,
      providerJobId: job.id, stageGeneration: job.stageGeneration, stageAttempt: job.stageAttempt,
      model: job.model, reasoningEffort: "xhigh", promptVersion: job.promptVersion,
      requestHash: job.request.plaintextHash, responseHash: job.response!.plaintextHash,
      inputTokens: job.inputTokens!, outputTokens: job.outputTokens!,
      providerCompletedAt: job.completedAt!, workerVersionId: env.CF_VERSION_METADATA.id,
      releaseGitSha: env.RELEASE_GIT_SHA,
    },
  };
}

async function expectUnpublished(input: PublicationInput) {
  expect(await rows("SELECT status, reading_enc FROM daily_readings WHERE id = ?", input.readingId))
    .toEqual([{ status: "pending", reading_enc: null }]);
  expect(await rows("SELECT status, result_class, claim_token FROM jobs WHERE id = ?", input.jobId))
    .toEqual([{ status: "running", result_class: null, claim_token: input.claimToken }]);
  expect(await rows("SELECT id FROM reading_sources WHERE reading_id = ?", input.readingId)).toEqual([]);
  expect(await rows("SELECT id FROM audit_events WHERE action = 'daily_reading.published' AND resource_id = ?", input.readingId)).toEqual([]);
  expect(await rows("SELECT * FROM assertion_probe")).toEqual([]);
}

describe("atomic Daily receipt publication", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = CODEX_TEST_ARTIFACT_KEYRING;
  });

  it.each(["readingId", "jobId", "commandGeneration", "stageGeneration"] as const)(
    "rejects mismatched %s before publication", async (field) => {
      const input = await publicationInput();
      const receipt = { ...input.receipt! };
      if (field === "readingId" || field === "jobId") receipt[field] = "wrong-coordinate";
      else receipt[field] += 1;
      await expect(completeReading(env, { ...input, receipt })).rejects.toThrow("publication receipt names");
      await expectUnpublished(input);
      expect(await receipts()).toEqual([]);
    },
  );

  it("requires a receipt for the persisted constrained-model reservation", async () => {
    const input = await publicationInput();
    expect(await completeReading(env, { ...input, receipt: null })).toMatchObject({ ok: false, reason: "conflict" });
    await expectUnpublished(input);
  });

  it("rolls back ciphertext, evidence, audit, and job on a receipt CHECK failure", async () => {
    const input = await publicationInput();
    expect(await completeReading(env, { ...input, receipt: { ...input.receipt!, responseHash: "bad-hash" } }))
      .toMatchObject({ ok: false, reason: "conflict" });
    await expectUnpublished(input);
    expect(await receipts()).toEqual([]);
  });

  it("rolls back when the required migration is absent", async () => {
    const input = await publicationInput();
    await rows("ALTER TABLE daily_publication_receipts RENAME TO receipt_schema_withheld");
    try {
      expect(await completeReading(env, input)).toMatchObject({ ok: false, reason: "conflict" });
      await expectUnpublished(input);
    } finally {
      await rows("ALTER TABLE receipt_schema_withheld RENAME TO daily_publication_receipts");
    }
    expect(await receipts()).toEqual([]);
  });

  it("rolls back a uniqueness collision without changing the existing receipt", async () => {
    const input = await publicationInput();
    await buildDailyPublicationReceiptInsert(env, input.receipt!, new Date().toISOString()).run();
    const before = await receipts();
    expect(await completeReading(env, input)).toMatchObject({ ok: false, reason: "conflict" });
    await expectUnpublished(input);
    expect(await receipts()).toEqual(before);
  });

  it.each(["receipt coordinate", "published job result"] as const)(
    "closing assertion rejects a changed %s inside the batch", async (target) => {
      const input = await publicationInput();
      const trigger = target === "receipt coordinate"
        ? "CREATE TRIGGER break_publication AFTER INSERT ON daily_publication_receipts BEGIN UPDATE daily_publication_receipts SET job_id = 'wrong-job' WHERE receipt_id = NEW.receipt_id; END"
        : "CREATE TRIGGER break_publication AFTER UPDATE OF status ON jobs WHEN NEW.status = 'succeeded' BEGIN UPDATE jobs SET result_class = 'failed' WHERE id = NEW.id; END";
      await rows(trigger);
      try {
        expect(await completeReading(env, input)).toMatchObject({ ok: false, reason: "conflict" });
        await expectUnpublished(input);
        expect(await receipts()).toEqual([]);
      } finally {
        await rows("DROP TRIGGER break_publication");
      }
    },
  );
});
