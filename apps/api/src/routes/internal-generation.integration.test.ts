import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env, GenerationMessage } from "../env.js";
import { app } from "../index.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  READING_CODEX_PUBLISHER_VARS,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { CYCLE_FP_UNAVAILABLE } from "../../test/mock-calc-service.js";
import {
  candidateFor,
  claimReadingJob,
  completeReadingJob,
} from "../../test/codex-reading-runner.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { claimJob, reserveInitial, reserveReissue } from "../db/generation.js";
import { decryptPayload, type UserIdentity } from "../db/users.js";
import {
  enqueueConstrainedReading,
  enqueueDailyReading,
} from "../services/enqueue.js";
import { dispatchGeneration } from "../services/generate-daily-reading.js";
import {
  buildGenerationCommandV2,
  type GenerateDailyReadingCommandV2,
} from "../services/generation-command-v2.js";

interface Envelope {
  status?: string;
  reading_id?: string;
  job_id?: string;
  dispatched?: boolean;
  undispatched?: number;
  expired_leases?: number;
  redispatched?: number;
  predecessor_id?: string;
  error?: { code: string; message: string; request_id: string | null };
}

/**
 * Every send lands here instead of Miniflare's queue. Its consumer runs
 * concurrently with the test body, so a delivered message could claim a job
 * between an assertion's read and the request that assertion is checking.
 */
const sent: GenerationMessage[] = [];

async function grantAiSynthesis(
  userId = USER_A,
  consentId = "cns_internal_ai_0001",
  version = 1,
): Promise<void> {
  const now = "2026-08-09T00:00:00.000Z";
  await rows(
    `INSERT INTO consents (
       id, user_id, kind, status, policy_version, allowed_uses_json,
       scopes_json, version, granted_at, created_at, updated_at
     ) VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', ?, ?, ?, ?)`,
    consentId,
    userId,
    AI_SYNTHESIS_POLICY_VERSION,
    version,
    now,
    now,
    now,
  );
}

async function decryptV2Command(
  jobId: string,
  identity: UserIdentity = IDENTITY_A,
): Promise<GenerateDailyReadingCommandV2> {
  const [row] = await rows<{
    payload_enc: ArrayBuffer;
    payload_key_version: number;
    payload_nonce: string;
  }>(
    `SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ?`,
    jobId,
  );
  let binary = "";
  for (const byte of new Uint8Array(row!.payload_enc)) binary += String.fromCharCode(byte);
  return decryptPayload<GenerateDailyReadingCommandV2>(
    env,
    identity,
    {
      key_version: row!.payload_key_version,
      nonce: row!.payload_nonce,
      ciphertext: btoa(binary),
    },
    { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
  );
}

function internalEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    READING_V5_ROLLOUT: "internal",
    ...READING_CODEX_PUBLISHER_VARS,
    READING_QUEUE: {
      send: async (message: GenerationMessage) => {
        sent.push(message);
      },
    } as unknown as typeof env.READING_QUEUE,
    ...overrides,
  };
}

async function publishV5Reading(
  identity: UserIdentity = IDENTITY_A,
  targetLocalDate = "2026-08-09",
): Promise<string> {
  const v5Env = internalEnv();
  const enqueued = await enqueueConstrainedReading(v5Env, identity.userId, {
    entry: "internal",
    reservationReason: "internal",
    targetLocalDate,
  });
  if (!enqueued.ok) throw new Error(`V5 enqueue failed: ${enqueued.reason}`);
  const claim = await claimJob(v5Env, enqueued.jobId);
  if (!claim) throw new Error("V5 claim missing");
  expect(await dispatchGeneration(v5Env, claim)).toMatchObject({
    ok: false,
    reason: "publisher_pending",
  });
  const providerJob = await claimReadingJob();
  if (!providerJob) throw new Error("provider job missing");
  await completeReadingJob(providerJob, JSON.stringify(candidateFor(providerJob.packet)));
  expect(await dispatchGeneration(v5Env, claim)).toMatchObject({
    ok: true,
    readingId: enqueued.readingId,
  });
  return enqueued.readingId;
}

async function post(
  path: string,
  body: unknown,
  overrides: Partial<Env> = {},
): Promise<{ status: number; body: Envelope }> {
  // The Worker's `fetch` is `app.fetch`; `app.request` runs the same handler
  // but takes the env, which is what lets the queue binding be swapped.
  const res = await app.request(
    `/internal${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    internalEnv(overrides),
  );
  return { status: res.status, body: (await res.json()) as Envelope };
}

describe("POST /internal/readings/*", () => {
  beforeEach(async () => {
    sent.length = 0;
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await seedActiveRelease();
    await grantAiSynthesis(USER_A);
  });

  it.each(["internal", "first_open", "hybrid"] as const)(
    "reserves a constrained-model reading and V2 command when READING_V5_ROLLOUT is %s",
    async (rollout) => {
      await resetDb();
      await seedUser(IDENTITY_A);
      await confirmPreferences(USER_A);
      await seedChart(IDENTITY_A);
      await grantAiSynthesis(USER_A);

      const { status, body } = await post(
        "/readings/generate",
        { user_id: USER_A },
        { READING_V5_ROLLOUT: rollout },
      );
      expect(status).toBe(202);
      expect(body.status).toBe("reserved");
      expect(body.reading_id).toMatch(/^rdg_/);
      expect(body.job_id).toMatch(/^job_/);
      expect(body.dispatched).toBe(true);

      const reserved = await rows<{
        id: string;
        status: string;
        assembly_mode: string;
        release_version: string | null;
      }>(
        "SELECT id, status, assembly_mode, release_version FROM daily_readings WHERE user_id = ?",
        USER_A,
      );
      expect(reserved).toEqual([
        {
          id: body.reading_id!,
          status: "pending",
          assembly_mode: "constrained_model",
          release_version: null,
        },
      ]);

      const command = await decryptV2Command(body.job_id!);
      expect(command.command_version).toBe("v2");
      expect(command.assembly_mode).toBe("constrained_model");
      expect(command.reservation_reason).toBe("internal");
      expect(command.revision).toBe(1);
      expect(command.revision_reason).toBe("initial");
      expect(command.supersedes_reading_id).toBeNull();
    },
  );

  it("reports a replayed day as a duplicate rather than an error", async () => {
    await post("/readings/generate", { user_id: USER_A });
    // A scheduler that re-runs a day it already reserved has done what it was
    // asked to do, so this is 200 rather than a failure the operator must triage.
    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(200);
    expect(body.status).toBe("duplicate");
  });

  it("returns 503 rollout_disabled when READING_V5_ROLLOUT is off without writing rows", async () => {
    const { status, body } = await post(
      "/readings/generate",
      { user_id: USER_A },
      { READING_V5_ROLLOUT: "off" },
    );
    expect(status).toBe(503);
    expect(body.error?.code).toBe("rollout_disabled");
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE user_id = ?", USER_A)).toEqual([]);
  });

  it("returns 409 ai_synthesis_consent_required when the user has no active ai_synthesis grant", async () => {
    await rows("DELETE FROM consents WHERE user_id = ? AND kind = 'ai_synthesis'", USER_A);
    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("ai_synthesis_consent_required");
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE user_id = ?", USER_A)).toEqual([]);
  });

  it("surfaces unconfirmed scheduling zone and locale as actionable 409s", async () => {
    await rows("UPDATE users SET timezone_source = 'default_unconfirmed' WHERE id = ?", USER_A);
    const tzRes = await post("/readings/generate", { user_id: USER_A });
    expect(tzRes.status).toBe(409);
    expect(tzRes.body.error?.code).toBe("timezone_confirmation_required");
    expect(tzRes.body.error?.request_id).toBeTruthy();

    await rows(
      "UPDATE users SET timezone_source = 'user_confirmed', locale_source = 'default_unconfirmed' WHERE id = ?",
      USER_A,
    );
    const localeRes = await post("/readings/generate", { user_id: USER_A });
    expect(localeRes.status).toBe(409);
    expect(localeRes.body.error?.code).toBe("locale_confirmation_required");
  });

  it("separates calc_unavailable and daily_sky_unavailable from caller mistakes", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_UNAVAILABLE });
    await grantAiSynthesis(USER_A);

    const calcRes = await post("/readings/generate", { user_id: USER_A });
    expect(calcRes.status).toBe(503);
    expect(calcRes.body.error?.code).toBe("calc_unavailable");
    expect(calcRes.body.error?.message).toBe("The calculation service is unavailable");

    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await grantAiSynthesis(USER_A);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/v1/daily-sky")) {
        return new Response(
          JSON.stringify({ error: { code: "unavailable", message: "internal detail" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const skyRes = await post("/readings/generate", { user_id: USER_A });
      expect(skyRes.status).toBe(503);
      expect(skyRes.body.error?.code).toBe("daily_sky_unavailable");
      expect(skyRes.body.error?.message).toBe("The daily-sky calculation service is unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates its bodies and restricts reissue to safety_correction and defect_repair", async () => {
    expect((await post("/readings/generate", {})).status).toBe(400);
    expect((await post("/readings/reissue", { user_id: USER_A })).status).toBe(400);
    for (const disallowedReason of ["initial", "consent_revoked", "chart_recalculated"]) {
      const res = await post("/readings/reissue", {
        user_id: USER_A,
        expected_live_reading_id: "rdg_x",
        revision_reason: disallowedReason,
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("invalid_body");
    }
    expect(
      (await post("/readings/replace", { user_id: USER_A, reading_id: "rdg_x", reason: "nope" }))
        .status,
    ).toBe(400);
    expect(
      (
        await post("/readings/replace", {
          user_id: USER_A,
          reading_id: "rdg_x",
          reason: "calc_unavailable",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/readings/replace", {
          user_id: USER_A,
          reading_id: "rdg_x",
          reason: "calc_unavailable",
          actor: "admin",
        })
      ).status,
    ).toBe(400);
    expect((await post("/readings/invalidate", {})).status).toBe(400);
    expect(
      (
        await post("/readings/invalidate", {
          user_id: USER_A,
          reading_id: "rdg_x",
          reason: "chart_correction",
        })
      ).status,
    ).toBe(400);
  });

  it.each(["safety_correction", "defect_repair"] as const)(
    "reissues a published constrained-model reading under %s, including an earlier local date",
    async (revisionReason) => {
      await resetDb();
      await seedUser(IDENTITY_A);
      await confirmPreferences(USER_A);
      await seedChart(IDENTITY_A);
      await grantAiSynthesis(USER_A);

      const earlierLocalDate = "2026-07-15";
      const predecessorId = await publishV5Reading(IDENTITY_A, earlierLocalDate);
      sent.length = 0;

      const { status, body } = await post("/readings/reissue", {
        user_id: USER_A,
        expected_live_reading_id: predecessorId,
        revision_reason: revisionReason,
      });
      expect(status).toBe(202);
      expect(body.status).toBe("reserved");
      expect(body.reading_id).toMatch(/^rdg_/);
      expect(body.job_id).toMatch(/^job_/);
      expect(body.dispatched).toBe(true);

      const [successor] = await rows<{
        id: string;
        local_date: string;
        revision: number;
        revision_reason: string;
        status: string;
        assembly_mode: string;
        release_version: string | null;
        supersedes_reading_id: string | null;
      }>(
        `SELECT id, local_date, revision, revision_reason, status, assembly_mode,
                release_version, supersedes_reading_id
         FROM daily_readings WHERE id = ?`,
        body.reading_id!,
      );
      expect(successor).toEqual({
        id: body.reading_id!,
        local_date: earlierLocalDate,
        revision: 2,
        revision_reason: revisionReason,
        status: "pending",
        assembly_mode: "constrained_model",
        release_version: null,
        supersedes_reading_id: predecessorId,
      });

      const command = await decryptV2Command(body.job_id!);
      expect(command.command_version).toBe("v2");
      expect(command.reservation_reason).toBe("manual_reissue");
      expect(command.revision).toBe(2);
      expect(command.revision_reason).toBe(revisionReason);
      expect(command.supersedes_reading_id).toBe(predecessorId);
      expect(command.target_local_date).toBe(earlierLocalDate);
    },
  );

  it("returns 503 rollout_disabled on reissue when READING_V5_ROLLOUT is off", async () => {
    const { status, body } = await post(
      "/readings/reissue",
      {
        user_id: USER_A,
        expected_live_reading_id: "rdg_any_published_001",
        revision_reason: "defect_repair",
      },
      { READING_V5_ROLLOUT: "off" },
    );
    expect(status).toBe(503);
    expect(body.error?.code).toBe("rollout_disabled");
  });

  it("returns 409 not_replaceable when the published target is a deterministic historical edition", async () => {
    const v1 = await enqueueDailyReading(env, USER_A);
    if (!v1.ok) throw new Error(`V1 enqueue failed: ${v1.reason}`);
    const claim = await claimJob(env, v1.jobId);
    if (!claim) throw new Error("V1 claim missing");
    expect((await dispatchGeneration(env, claim)).ok).toBe(true);

    const { status, body } = await post("/readings/reissue", {
      user_id: USER_A,
      expected_live_reading_id: v1.readingId,
      revision_reason: "defect_repair",
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("not_replaceable");

    const allReadings = await rows<{ id: string; status: string; assembly_mode: string }>(
      "SELECT id, status, assembly_mode FROM daily_readings WHERE user_id = ?",
      USER_A,
    );
    expect(allReadings).toEqual([
      { id: v1.readingId, status: "published", assembly_mode: "deterministic" },
    ]);
  });

  it("returns 409 stale_predecessor when the reissue target is not published or belongs to another user", async () => {
    const generated = await post("/readings/generate", { user_id: USER_A });
    expect(generated.status).toBe(202);

    const pendingRes = await post("/readings/reissue", {
      user_id: USER_A,
      expected_live_reading_id: generated.body.reading_id,
      revision_reason: "safety_correction",
    });
    expect(pendingRes.status).toBe(409);
    expect(pendingRes.body.error?.code).toBe("stale_predecessor");

    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);
    await grantAiSynthesis(USER_B, "cns_internal_ai_b_0001", 1);
    const otherOwnerReadingId = await publishV5Reading(IDENTITY_B, "2026-08-09");

    const wrongOwnerRes = await post("/readings/reissue", {
      user_id: USER_A,
      expected_live_reading_id: otherOwnerReadingId,
      revision_reason: "safety_correction",
    });
    expect(wrongOwnerRes.status).toBe(409);
    expect(wrongOwnerRes.body.error?.code).toBe("stale_predecessor");
  });

  it("requires an active ai_synthesis grant on reissue and aborts the reservation batch if the frozen grant changes before commit", async () => {
    const predecessorId = await publishV5Reading(IDENTITY_A, "2026-08-09");

    const built = await buildGenerationCommandV2(internalEnv(), IDENTITY_A, {
      readingId: "rdg_reissue_consent_race_01",
      revision: 2,
      revisionReason: "safety_correction",
      supersedesReadingId: predecessorId,
      reservationReason: "manual_reissue",
      commandGeneration: 1,
      replacesJobId: null,
      commandReplacementReason: null,
      targetLocalDate: "2026-08-09",
      now: new Date("2026-08-09T18:00:00.000Z"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(`V2 build failed: ${built.reason}`);

    // Supersede the frozen grant with a newer revoked row before the batch commits.
    await rows(
      `INSERT INTO consents (
         id, user_id, kind, status, policy_version, allowed_uses_json,
         scopes_json, version, revoked_at, created_at, updated_at
       ) VALUES ('cns_internal_ai_0002', ?, 'ai_synthesis', 'revoked', ?, '[]', '[]', 2,
                 '2026-08-09T18:01:00.000Z', '2026-08-09T18:01:00.000Z', '2026-08-09T18:01:00.000Z')`,
      USER_A,
      AI_SYNTHESIS_POLICY_VERSION,
    );

    const racedReissue = await reserveReissue(
      internalEnv(),
      IDENTITY_A,
      built.command,
      predecessorId,
    );
    expect(racedReissue).toMatchObject({ ok: false, reason: "conflict" });
    expect(await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", predecessorId)).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE user_id = ? AND status = 'queued'", USER_A)).toEqual([]);

    const routeRes = await post("/readings/reissue", {
      user_id: USER_A,
      expected_live_reading_id: predecessorId,
      revision_reason: "safety_correction",
    });
    expect(routeRes.status).toBe(409);
    expect(routeRes.body.error?.code).toBe("ai_synthesis_consent_required");

    // Also verify initial reservation aborts if the frozen grant is superseded before commit.
    await grantAiSynthesis(USER_A, "cns_internal_ai_0003", 3);
    const builtInitial = await buildGenerationCommandV2(internalEnv(), IDENTITY_A, {
      readingId: "rdg_initial_consent_race_01",
      revision: 1,
      revisionReason: "initial",
      supersedesReadingId: null,
      reservationReason: "internal",
      commandGeneration: 1,
      replacesJobId: null,
      commandReplacementReason: null,
      targetLocalDate: "2026-08-10",
      now: new Date("2026-08-10T18:00:00.000Z"),
    });
    expect(builtInitial.ok).toBe(true);
    if (!builtInitial.ok) throw new Error(`V2 initial build failed: ${builtInitial.reason}`);

    await grantAiSynthesis(USER_A, "cns_internal_ai_0004", 4);
    const racedInitial = await reserveInitial(internalEnv(), IDENTITY_A, builtInitial.command);
    expect(racedInitial).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      await rows("SELECT id FROM daily_readings WHERE id = ?", "rdg_initial_consent_race_01"),
    ).toEqual([]);
  });

  it("offers an authenticated calculation-defect path for one named reading", async () => {
    const { status, body } = await post("/readings/invalidate", {
      user_id: USER_A,
      reading_id: "rdg_named_but_absent_0001",
      reason: "calculation_defect",
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("not_found");
  });

  it("accepts V2 replacement vocabulary before storage rejects it for a V1 row", async () => {
    const reserved = await enqueueDailyReading(env, USER_A);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error(`V1 enqueue failed: ${reserved.reason}`);
    await rows(`UPDATE daily_readings SET status = 'failed' WHERE id = ?`, reserved.readingId);
    await rows(`UPDATE jobs SET status = 'failed' WHERE id = ?`, reserved.jobId);

    const { status, body } = await post("/readings/replace", {
      user_id: USER_A,
      reading_id: reserved.readingId,
      reason: "consent_regranted",
      actor: "scheduler",
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("not_replaceable");
  });

  it("does not expose raw D1 errors in an internal response", async () => {
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      const { status, body } = await post("/readings/generate", { user_id: USER_A });
      expect(status).toBe(424);
      expect(body.error?.code).toBe("conflict");
      expect(body.error?.message).toBe("The reading operation could not be committed");
      expect(body.error?.message).not.toContain("audit_events");
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
  });

  it("re-dispatches what the outbox committed but never sent", async () => {
    const reserved = await post("/readings/generate", { user_id: USER_A });
    expect(reserved.status).toBe(202);
    expect(reserved.body.job_id).toMatch(/^job_/);
    await rows("UPDATE jobs SET dispatched_at = NULL WHERE id = ?", reserved.body.job_id!);

    const [beforeSweep] = await rows<{ status: string; dispatched_at: string | null }>(
      "SELECT status, dispatched_at FROM jobs WHERE id = ?",
      reserved.body.job_id!,
    );
    expect(beforeSweep).toEqual({ status: "queued", dispatched_at: null });

    const { status, body } = await post("/readings/sweep", {});
    expect(status).toBe(200);
    expect(body.undispatched).toBe(1);
    expect(body.redispatched).toBe(1);
    // The reservation's send, then the sweep's re-send of the same message.
    const message = { job_id: reserved.body.job_id, reading_id: reserved.body.reading_id };
    expect(sent).toEqual([message, message]);

    const [job] = await rows<{ dispatched_at: string | null }>(
      "SELECT dispatched_at FROM jobs WHERE id = ?",
      reserved.body.job_id!,
    );
    expect(job!.dispatched_at).not.toBeNull();
  });

  it("is reachable only under /internal, and does not relax the product API", async () => {
    // Without the prefix the handler must not run. It answers 401 rather than
    // 404 because the authenticated product API is mounted at "/" and its
    // wildcard middleware sees every unmatched path first — the point is that
    // generation did not happen, not which refusal was rendered.
    const unprefixed = await SELF.fetch("http://api.test/readings/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: USER_A }),
    });
    expect(unprefixed.status).not.toBe(202);
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toHaveLength(0);

    // And mounting a second router under /internal has not leaked serviceAuth
    // into the product API, which must still demand a session.
    const product = await SELF.fetch("http://api.test/v1/chart");
    expect(product.status).toBe(401);
  });
});
