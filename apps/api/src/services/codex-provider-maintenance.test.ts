import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  failReadingJob,
} from "../../test/codex-reading-runner.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { claimJob, releaseClaimForPublisherPending } from "../db/generation.js";
import { loadCodexProviderJob } from "../db/codex-provider-jobs.js";
import { enqueueConstrainedReading, resolveV5TargetDate } from "./enqueue.js";
import { dispatchGeneration } from "./generate-daily-reading.js";
import { maintainCodexProviderJobs } from "./codex-provider-maintenance.js";

/**
 * Scheduled repair for Daily provider work.
 *
 * The parked state this repairs is deliberately invisible to every other
 * recovery path: a `publisher_pending` Daily job is queued, unclaimed, and
 * still marked dispatched, so the outbox sweep skips it and the expired-lease
 * sweep cannot see it either. If its nudge is lost, this is the only thing that
 * will ever wake it, which is why the selector and the retention rule are
 * tested rather than assumed.
 */

const ZONE = "America/Chicago";

function enabledEnv(overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "hybrid",
    ...READING_CODEX_PUBLISHER_VARS,
    ...overrides,
  };
}

function capturingEnv(sent: unknown[]): typeof env {
  return enabledEnv({
    READING_QUEUE: {
      send: async (body: unknown) => {
        sent.push(body);
      },
    } as unknown as typeof env.READING_QUEUE,
  });
}

async function parkedReading(): Promise<{ jobId: string; readingId: string }> {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  const at = "2026-08-27T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version,
       allowed_uses_json, scopes_json, version, granted_at, created_at, updated_at)
     VALUES ('cns_maintenance_ai_0001', ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
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
    {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate,
    },
  );
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

  const claim = await claimJob(enabledEnv(), enqueued.jobId);
  if (!claim) throw new Error("claim missing");
  const outcome = await dispatchGeneration(enabledEnv(), claim);
  if (outcome.ok || outcome.reason !== "publisher_pending") {
    throw new Error("expected a durable wait");
  }
  if (
    !await releaseClaimForPublisherPending(
      enabledEnv(),
      claim.jobId,
      claim.claimToken,
    )
  ) {
    throw new Error("release did not commit");
  }
  return { jobId: enqueued.jobId, readingId: enqueued.readingId };
}

async function dailyJob(jobId: string) {
  const [row] = await rows<{
    status: string;
    result_class: string | null;
    dispatched_at: string | null;
  }>(
    "SELECT status, result_class, dispatched_at FROM jobs WHERE id = ?",
    jobId,
  );
  return row!;
}

describe("Codex provider maintenance for Daily", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = CODEX_TEST_ARTIFACT_KEYRING;
  });

  it("repairs a completed reading whose nudge was lost", async () => {
    const { jobId, readingId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));

    const sent: unknown[] = [];
    const summary = await maintainCodexProviderJobs(capturingEnv(sent));

    expect(summary.repaired).toBe(1);
    expect(sent).toEqual([{ job_id: jobId, reading_id: readingId }]);
    expect((await dailyJob(jobId)).dispatched_at).not.toBeNull();
  });

  it("repairs a failed reading too, so a runner failure is not a stranded day", async () => {
    const { jobId, readingId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await failReadingJob(claimed, "publisher_unavailable", "provider_5xx");

    const sent: unknown[] = [];
    expect((await maintainCodexProviderJobs(capturingEnv(sent))).repaired).toBe(1);
    expect(sent).toEqual([{ job_id: jobId, reading_id: readingId }]);
  });

  it("does not repair a nudge that already landed", async () => {
    const { jobId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));

    const first: unknown[] = [];
    expect((await maintainCodexProviderJobs(capturingEnv(first))).repaired).toBe(1);
    // The dispatch marker now sits after the provider's completion instant,
    // which is exactly what the selector reads. A second cron pass must not
    // re-send and stack duplicate deliveries for the whole retention window.
    const second: unknown[] = [];
    expect((await maintainCodexProviderJobs(capturingEnv(second))).repaired).toBe(0);
    expect(second).toEqual([]);
    expect((await dailyJob(jobId)).result_class).toBe("publisher_pending");
  });

  it("does not repair a provider job that is still being worked", async () => {
    const { jobId } = await parkedReading();
    const sent: unknown[] = [];
    expect((await maintainCodexProviderJobs(capturingEnv(sent))).repaired).toBe(0);
    expect(sent).toEqual([]);
    // And it does not cancel it either: pending work with a live owner is
    // exactly what the runner is about to claim.
    const claimed = await claimReadingJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.job.status).toBe("pending");
    expect((await dailyJob(jobId)).result_class).toBe("publisher_pending");
  });

  it("cancels pending work whose owner is no longer current", async () => {
    await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await rows(
      "UPDATE consents SET status = 'revoked', revoked_at = ? WHERE id = ?",
      "2026-08-27T02:00:00.000Z",
      "cns_maintenance_ai_0001",
    );

    const summary = await maintainCodexProviderJobs(enabledEnv());
    expect(summary.cancelled).toBe(1);
    const job = await loadCodexProviderJob(env, claimed.job.id);
    expect(job!.status).toBe("cancelled");
  });

  it("keeps a terminal provider job while its owner is still waiting for it", async () => {
    const { jobId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));

    // Completed, but the owner has not adopted it yet. Deleting the response
    // object now would destroy the candidate the reader is about to be shown.
    const sent: unknown[] = [];
    const summary = await maintainCodexProviderJobs(capturingEnv(sent));
    expect(summary.purged).toBe(0);
    const job = await loadCodexProviderJob(env, claimed.job.id);
    expect(job).not.toBeNull();
    expect(await env.ARTIFACTS!.head(job!.response!.objectKey)).not.toBeNull();
    expect(await env.ARTIFACTS!.head(job!.request.objectKey)).not.toBeNull();
    expect((await dailyJob(jobId)).result_class).toBe("publisher_pending");
  });

  it("erases the encrypted exchange once the owner is terminal", async () => {
    const { jobId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));
    const before = await loadCodexProviderJob(env, claimed.job.id);

    // The owner published. Nothing will ever read these bytes again.
    await rows(
      `UPDATE jobs SET status = 'succeeded', result_class = 'published',
                      finished_at = ? WHERE id = ?`,
      new Date().toISOString(),
      jobId,
    );
    await rows(
      `UPDATE daily_readings
       SET status = 'published', reading_enc = X'00', reading_key_version = 1,
           reading_nonce = 'AAAAAAAAAAAAAAAA'
       WHERE active_generation_job_id = ?`,
      jobId,
    );

    const summary = await maintainCodexProviderJobs(enabledEnv());
    expect(summary.purged).toBe(1);
    expect(await loadCodexProviderJob(env, claimed.job.id)).toBeNull();
    expect(await env.ARTIFACTS!.head(before!.request.objectKey)).toBeNull();
    expect(await env.ARTIFACTS!.head(before!.response!.objectKey)).toBeNull();
  });

  it("emits only content-free counters", async () => {
    const { readingId } = await parkedReading();
    const claimed = await claimReadingJob();
    if (!claimed) throw new Error("provider job missing");
    const candidate = candidateFor(claimed.packet);
    await completeReadingJob(claimed, JSON.stringify(candidate));

    const captured: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((value) => JSON.stringify(value)).join(" "));
      });
    }
    try {
      await maintainCodexProviderJobs(capturingEnv([]));
    } finally {
      vi.restoreAllMocks();
    }

    const joined = captured.join("\n");
    expect(joined).toContain("codex_provider_pipeline_observed");
    expect(joined).toContain("codex_provider_nudge_observed");
    // Not one word of what any of it was about.
    for (const forbidden of [
      candidate.headline,
      candidate.lead.text,
      claimed.packet.facts[0]!.label,
      USER_A,
      readingId,
      "cns_maintenance_ai_0001",
      "prompt",
    ]) {
      expect(joined).not.toContain(forbidden);
    }
  });
});
