import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ALICE,
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { fromB64 } from "../crypto.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { claimJob, failReading } from "../db/generation.js";
import { loadPublishedReadingForDate } from "../db/readings.js";
import { decryptPayload, encryptPayload } from "../db/users.js";
import {
  enqueueConstrainedReading,
  replaceFailedCommand,
  resolveV5TargetDate,
} from "./enqueue.js";
import { OPENAI_READING_MODEL } from "./reading-publisher.js";
import type { GenerateDailyReadingCommandV2 } from "./generation-command-v2.js";
import { app } from "../index.js";
import {
  invalidatePublishedReading,
  reconcileCurrentFactRepair,
  reserveFactRepair,
} from "./reading-invalidation.js";
import type { StoredReadingV5 } from "./stored-reading.js";

const ZONE = "America/Chicago";
const NOW = new Date("2026-08-10T15:00:00.000Z");
const NEXT_DAY = new Date("2026-08-11T15:00:00.000Z");
const OLD_FINGERPRINT = `sha256:${"1a".repeat(32)}`;
const CORRECTED_FINGERPRINT = `sha256:${"2b".repeat(32)}`;
const HEX64 = "b".repeat(64);

function enabledEnv(): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "internal",
    READING_PUBLISHER: "openai",
    OPENAI_READING_MODEL,
    OPENAI_READING_REASONING: "high",
    OPENAI_READING_PROMPT_VERSION: "1.0.0",
    OPENAI_READING_TIMEOUT_MS: "90000",
    OPENAI_READING_MAX_OUTPUT_TOKENS: "1800",
    READING_CONTEXT_MAX_BYTES: "98304",
    READING_PREGEN_ACTIVE_DAYS: "30",
    READING_PREGEN_LEAD_MINUTES: "30",
    READING_PREGEN_SPREAD_MINUTES: "45",
    READING_SCHEDULER_BATCH_LIMIT: "100",
    READING_DAILY_PROVIDER_CALL_LIMIT: "250",
    OPENAI_API_KEY: "sk-test-key",
  };
}

async function grantAiSynthesis(
  userId: string = USER_A,
  consentId: string = "cns_fact_repair_0001",
): Promise<void> {
  const at = "2026-08-09T00:00:00.000Z";
  await rows(
    `INSERT INTO consents
       (id, user_id, kind, status, policy_version, allowed_uses_json,
        scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    consentId,
    userId,
    AI_SYNTHESIS_POLICY_VERSION,
    at,
    at,
    at,
  );
}

async function decryptJobCommand(
  jobId: string,
  identity = IDENTITY_A,
): Promise<GenerateDailyReadingCommandV2> {
  const [row] = await rows<{
    payload_enc: ArrayBuffer;
    payload_key_version: number;
    payload_nonce: string;
  }>(
    `SELECT payload_enc, payload_key_version, payload_nonce
     FROM jobs WHERE id = ? AND user_id = ?`,
    jobId,
    identity.userId,
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
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );
}

async function seedPublishedReading(
  at: Date = NOW,
): Promise<{ readingId: string; localDate: string }> {
  const localDate = resolveV5TargetDate(ZONE, at);
  if (!localDate) throw new Error("test local date did not resolve");
  const readingId = "rdg_fact_repair_0001";
  const stored: StoredReadingV5 = {
    schema_version: "0.5.0",
    reading: {
      schema_version: "0.5.0",
      output_schema: "daily-reading-v5",
      reading_id: readingId,
      local_date: localDate,
      generated_at: "2026-08-10T13:00:00.000Z",
      assembly_mode: "constrained_model",
      revision: 1,
      locale: "en-US",
      domain_preference: null,
      headline: "A narrower commitment",
      disclosure: "Generated with OpenAI from your calculated chart and enabled context.",
      paragraphs: [
        {
          paragraph_id: "par_fact_repair_0001",
          role: "primary_theme",
          order: 1,
          text: "The pressure asks for a smaller promise.",
        },
      ],
    },
    evidence_header: {
      schema_version: "0.5.0",
      reading_id: readingId,
      revision: 1,
      revision_reason: "initial",
      generated_at: "2026-08-10T13:00:00.000Z",
      generation_input_id: `gin_sha256_${HEX64}`,
      input_manifest_hash: `sha256:${HEX64}`,
      content_hash: `sha256:${HEX64}`,
      provider_response_hash: `sha256:${HEX64}`,
      calculation: {
        chart_contract_id: "calc-contract-launch",
        cycle_policy_version: "1.4.0",
        daily_sky_policy_version: "1.0.0",
        ephemeris_data_version: "swisseph-2.10.03",
        container_digest: `sha256:${HEX64}`,
        tzdb_version: "2026a",
        local_day_resolution_policy_version: "1.0.0",
      },
      model: {
        provider: "openai",
        model: OPENAI_READING_MODEL,
        prompt_version: "1.0.0",
        selection_policy_version: "1.0.0",
        validation_policy_version: "1.0.0",
        provider_request_id: "resp_fact_repair_0001",
        input_tokens: 100,
        output_tokens: 50,
      },
      validation: {
        status: "passed",
        policy_version: "1.0.0",
        checks: [{ code: "grounding", passed: true }],
      },
    },
    invalidation: null,
  };
  const sealed = await encryptPayload(env, IDENTITY_A, stored, {
    subject: IDENTITY_A.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: readingId,
  });
  const createdAt = "2026-08-10T13:00:00.000Z";
  await rows(
    `INSERT INTO daily_readings
       (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
        contract_id, assembly_mode, status, revision, revision_reason,
        supersedes_reading_id, command_generation, active_generation_job_id,
        invalidated_at, reading_enc, reading_key_version, reading_nonce,
        created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'calc-contract-launch', 'constrained_model',
             'published', 1, 'initial', NULL, 1, NULL, NULL, ?, ?, ?, ?, ?)`,
    readingId,
    USER_A,
    localDate,
    `reading-v5:${USER_A}:${localDate}:r1`,
    OLD_FINGERPRINT,
    fromB64(sealed.ciphertext),
    sealed.keyVersion,
    sealed.nonce,
    createdAt,
    createdAt,
  );
  return { readingId, localDate };
}

async function decryptStored(readingId: string): Promise<StoredReadingV5> {
  const [row] = await rows<{
    reading_enc: ArrayBuffer;
    reading_key_version: number;
    reading_nonce: string;
  }>(
    `SELECT reading_enc, reading_key_version, reading_nonce
     FROM daily_readings WHERE id = ? AND user_id = ?`,
    readingId,
    USER_A,
  );
  let binary = "";
  for (const byte of new Uint8Array(row!.reading_enc)) binary += String.fromCharCode(byte);
  return decryptPayload<StoredReadingV5>(
    env,
    IDENTITY_A,
    {
      key_version: row!.reading_key_version,
      nonce: row!.reading_nonce,
      ciphertext: btoa(binary),
    },
    {
      subject: IDENTITY_A.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: readingId,
    },
  );
}

async function activateCorrectedChart(): Promise<void> {
  await rows(
    "UPDATE chart_snapshots SET status = 'superseded' WHERE user_id = ? AND status = 'active'",
    USER_A,
  );
  await rows(
    "UPDATE birth_profiles SET status = 'superseded' WHERE user_id = ? AND status = 'active'",
    USER_A,
  );
  await seedChart(IDENTITY_A, {
    chartId: "cht_corrected_fact_0001",
    fingerprint: CORRECTED_FINGERPRINT,
    profileVersion: 2,
  });
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A, { fingerprint: OLD_FINGERPRINT });
  await grantAiSynthesis();
});

describe("fact invalidation lifecycle", () => {
  it("CAS-invalidates published prose immediately and reseals private metadata under the same AAD", async () => {
    const { readingId, localDate } = await seedPublishedReading();
    const [before] = await rows<{ reading_enc: ArrayBuffer }>(
      "SELECT reading_enc FROM daily_readings WHERE id = ?",
      readingId,
    );

    expect(
      await invalidatePublishedReading(env, {
        identity: IDENTITY_A,
        readingId,
        reason: "chart_correction",
        now: NOW,
      }),
    ).toEqual({ ok: true, status: "invalidated", readingId });

    const [after] = await rows<{
      status: string;
      invalidated_at: string;
      reading_enc: ArrayBuffer;
    }>(
      "SELECT status, invalidated_at, reading_enc FROM daily_readings WHERE id = ?",
      readingId,
    );
    expect(after).toMatchObject({ status: "invalidated", invalidated_at: NOW.toISOString() });
    expect(new Uint8Array(after!.reading_enc)).not.toEqual(new Uint8Array(before!.reading_enc));
    expect((await decryptStored(readingId)).invalidation).toEqual({
      reason: "chart_correction",
      actor_class: "user_change",
      invalidated_at: NOW.toISOString(),
    });
    expect(await loadPublishedReadingForDate(env, IDENTITY_A, localDate)).toBeNull();

    const audits = await rows<{
      action: string;
      resource_type: string;
      resource_id: string;
      detail_class: string;
    }>(
      `SELECT action, resource_type, resource_id, detail_class
       FROM audit_events WHERE resource_id = ?`,
      readingId,
    );
    expect(audits).toEqual([
      {
        action: "daily_reading.invalidated",
        resource_type: "daily_reading",
        resource_id: readingId,
        detail_class: "fact_repair_required",
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("chart_correction");
    expect(JSON.stringify(audits)).not.toContain("smaller promise");
  });

  it("keeps invalidation owner-scoped and idempotent under repeat or competing calls", async () => {
    const { readingId } = await seedPublishedReading();
    expect(
      await invalidatePublishedReading(env, {
        identity: IDENTITY_B,
        readingId,
        reason: "calculation_defect",
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });

    const first = await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });
    const second = await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(first).toMatchObject({ ok: true, status: "invalidated" });
    expect(second).toMatchObject({ ok: true, status: "already_invalidated" });
    expect((await decryptStored(readingId)).invalidation).toMatchObject({
      reason: "calculation_defect",
      actor_class: "operator",
      invalidated_at: NOW.toISOString(),
    });
    expect(
      await rows("SELECT id FROM audit_events WHERE action = 'daily_reading.invalidated'"),
    ).toHaveLength(1);
  });

  it("reserves exactly one r+1 fact repair against the named invalidated predecessor", async () => {
    const { readingId } = await seedPublishedReading();
    await activateCorrectedChart();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "chart_correction",
      now: NOW,
    });

    const first = await reserveFactRepair(enabledEnv(), readingId, NOW);
    const second = await reserveFactRepair(enabledEnv(), readingId, NOW);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) return;

    const successors = await rows<{
      id: string;
      status: string;
      revision: number;
      revision_reason: string;
      supersedes_reading_id: string;
      chart_fingerprint: string;
    }>(
      `SELECT id, status, revision, revision_reason, supersedes_reading_id,
              chart_fingerprint
       FROM daily_readings WHERE supersedes_reading_id = ?`,
      readingId,
    );
    expect(successors).toEqual([
      {
        id: first.readingId,
        status: "pending",
        revision: 2,
        revision_reason: "chart_recalculated",
        supersedes_reading_id: readingId,
        chart_fingerprint: CORRECTED_FINGERPRINT,
      },
    ]);
    expect(await decryptJobCommand(first.jobId)).toMatchObject({
      command_version: "v2",
      reading_id: first.readingId,
      revision: 2,
      revision_reason: "chart_recalculated",
      supersedes_reading_id: readingId,
      reservation_reason: "fact_repair",
    });
  });

  it("rejects an ordinary reissue that names the invalidated predecessor", async () => {
    const { readingId, localDate } = await seedPublishedReading();
    const ordinary = await enqueueConstrainedReading(enabledEnv(), USER_A, {
      entry: "internal",
      reservationReason: "manual_reissue",
      targetLocalDate: localDate,
      revision: 2,
      revisionReason: "defect_repair",
      supersedesReadingId: readingId,
      now: NOW,
    });
    if (!ordinary.ok) throw new Error(`ordinary reissue failed: ${ordinary.reason}`);
    expect((await decryptJobCommand(ordinary.jobId)).reservation_reason).toBe("manual_reissue");
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });

    expect(await reserveFactRepair(enabledEnv(), readingId, NOW)).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("refuses to recover a fact-repair successor unless its revision is exactly r+1", async () => {
    const { readingId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });
    const repair = await reserveFactRepair(enabledEnv(), readingId, NOW);
    if (!repair.ok) throw new Error(`fact repair failed: ${repair.reason}`);
    await rows(
      `UPDATE daily_readings SET revision = 3, reading_key = ? WHERE id = ?`,
      `reading-v5:${USER_A}:${resolveV5TargetDate(ZONE, NOW)}:r3`,
      repair.readingId,
    );

    expect(await reserveFactRepair(enabledEnv(), readingId, NOW)).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("never recovers another owner's successor as this owner's fact repair", async () => {
    const { readingId, localDate } = await seedPublishedReading();
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B, ZONE);
    await seedChart(IDENTITY_B, { fingerprint: OLD_FINGERPRINT });
    await grantAiSynthesis(USER_B, "cns_fact_repair_owner_b_0001");
    const otherOwner = await enqueueConstrainedReading(enabledEnv(), USER_B, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: localDate,
      now: NOW,
    });
    if (!otherOwner.ok) throw new Error(`other-owner reservation failed: ${otherOwner.reason}`);
    await rows(
      `UPDATE daily_readings
       SET revision = 2, revision_reason = 'defect_repair',
           supersedes_reading_id = ?, reading_key = ?
       WHERE id = ? AND user_id = ?`,
      readingId,
      `reading-v5:${USER_B}:${localDate}:r2`,
      otherOwner.readingId,
      USER_B,
    );
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });

    const outcome = await reserveFactRepair(enabledEnv(), readingId, NOW);
    expect(outcome).toMatchObject({ ok: false, reason: "conflict" });
    if (outcome.ok) expect(outcome.readingId).not.toBe(otherOwner.readingId);
  });

  it("rejects a fact-repair predecessor until it is invalidated", async () => {
    const { readingId } = await seedPublishedReading();
    expect(await reserveFactRepair(enabledEnv(), readingId, NOW)).toMatchObject({
      ok: false,
      reason: "stale_predecessor",
    });
    expect(await rows("SELECT id FROM jobs WHERE job_type = 'generate_daily_reading'")).toEqual([]);
  });

  it("never reserves prior-day repair prose after the owner's local day rolls over", async () => {
    const { readingId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });

    expect(await reserveFactRepair(enabledEnv(), readingId, NEXT_DAY)).toMatchObject({
      ok: false,
      reason: "stale_predecessor",
    });
    expect(await rows("SELECT id FROM jobs WHERE job_type = 'generate_daily_reading'")).toEqual([]);
  });

  it("does not redispatch an existing prior-day repair after local midnight", async () => {
    const { readingId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });
    const repair = await reserveFactRepair(enabledEnv(), readingId, NOW);
    if (!repair.ok) throw new Error(`fact repair failed: ${repair.reason}`);
    await rows("UPDATE jobs SET dispatched_at = NULL WHERE id = ?", repair.jobId);

    expect(await reserveFactRepair(enabledEnv(), readingId, NEXT_DAY)).toMatchObject({
      ok: false,
      reason: "stale_predecessor",
    });
    expect(
      await rows("SELECT dispatched_at FROM jobs WHERE id = ?", repair.jobId),
    ).toEqual([{ dispatched_at: null }]);
  });

  it("leaves the predecessor invalidated when its fact-repair successor fails", async () => {
    const { readingId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });
    const reserved = await reserveFactRepair(enabledEnv(), readingId, NOW);
    if (!reserved.ok) throw new Error(`repair reservation failed: ${reserved.reason}`);
    const claim = await claimJob(enabledEnv(), reserved.jobId, NOW);
    if (!claim) throw new Error("repair claim missing");

    expect(
      await failReading(
        env,
        IDENTITY_A,
        reserved.readingId,
        reserved.jobId,
        claim.claimToken,
        "publisher_refused",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await rows("SELECT status FROM daily_readings WHERE id = ?", readingId),
    ).toEqual([{ status: "invalidated" }]);
  });

  it("replaces a failed fact-repair command only while its predecessor stays invalidated", async () => {
    const { readingId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId,
      reason: "calculation_defect",
      now: NOW,
    });
    const reserved = await reserveFactRepair(enabledEnv(), readingId, NOW);
    if (!reserved.ok) throw new Error(`repair reservation failed: ${reserved.reason}`);
    const claim = await claimJob(enabledEnv(), reserved.jobId, NOW);
    if (!claim) throw new Error("repair claim missing");
    await failReading(
      env,
      IDENTITY_A,
      reserved.readingId,
      reserved.jobId,
      claim.claimToken,
      "publisher_refused",
    );

    const replaced = await replaceFailedCommand(
      enabledEnv(),
      USER_A,
      reserved.readingId,
      "publisher_refused",
      "scheduler",
      NOW,
    );
    if (!replaced.ok) throw new Error(`${replaced.reason}: ${replaced.detail}`);
    expect(replaced).toMatchObject({ ok: true, readingId: reserved.readingId });
    expect(
      await rows(
        "SELECT status, command_generation FROM daily_readings WHERE id = ?",
        reserved.readingId,
      ),
    ).toEqual([{ status: "pending", command_generation: 2 }]);
    expect(
      await rows("SELECT status FROM daily_readings WHERE id = ?", readingId),
    ).toEqual([{ status: "invalidated" }]);
  });

  it("hides a chart-mismatched published row during the activation-to-invalidation crash window", async () => {
    const { localDate } = await seedPublishedReading();
    expect(await loadPublishedReadingForDate(env, IDENTITY_A, localDate)).not.toBeNull();

    await activateCorrectedChart();

    expect(await loadPublishedReadingForDate(env, IDENTITY_A, localDate)).toBeNull();
    expect(
      await rows("SELECT status FROM daily_readings WHERE user_id = ?", USER_A),
    ).toEqual([{ status: "published" }]);
  });

  it("reconciles the activation crash boundary and converges repeated passes on one repair", async () => {
    const { readingId } = await seedPublishedReading();
    await activateCorrectedChart();

    const afterActivationCrash = await reconcileCurrentFactRepair(
      enabledEnv(),
      IDENTITY_A,
      "chart_correction",
      NOW,
    );
    const afterInvalidationCrash = await reconcileCurrentFactRepair(
      enabledEnv(),
      IDENTITY_A,
      "chart_correction",
      NOW,
    );
    expect(afterActivationCrash).toMatchObject({ ok: true, predecessorId: readingId });
    expect(afterInvalidationCrash).toEqual({ ok: true, status: "current" });
    expect(
      await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", readingId),
    ).toHaveLength(1);
  });

  it("recovers the newest invalidated orphan instead of an older repaired predecessor", async () => {
    const { readingId: firstId } = await seedPublishedReading();
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId: firstId,
      reason: "calculation_defect",
      now: NOW,
    });
    const second = await reserveFactRepair(enabledEnv(), firstId, NOW);
    if (!second.ok) throw new Error(`second revision failed: ${second.reason}`);

    const firstStored = await decryptStored(firstId);
    const secondStored: StoredReadingV5 = {
      ...firstStored,
      reading: {
        ...firstStored.reading,
        reading_id: second.readingId,
        revision: 2,
      },
      evidence_header: {
        ...firstStored.evidence_header,
        reading_id: second.readingId,
        revision: 2,
        revision_reason: "defect_repair",
      },
      invalidation: null,
    };
    const sealed = await encryptPayload(env, IDENTITY_A, secondStored, {
      subject: IDENTITY_A.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: second.readingId,
    });
    await rows(
      `UPDATE daily_readings
       SET status = 'published', reading_enc = ?, reading_key_version = ?,
           reading_nonce = ?, updated_at = ? WHERE id = ?`,
      fromB64(sealed.ciphertext),
      sealed.keyVersion,
      sealed.nonce,
      new Date(NOW.getTime() + 60_000).toISOString(),
      second.readingId,
    );
    await invalidatePublishedReading(env, {
      identity: IDENTITY_A,
      readingId: second.readingId,
      reason: "calculation_defect",
      now: new Date(NOW.getTime() + 120_000),
    });

    const recovered = await reconcileCurrentFactRepair(
      enabledEnv(),
      IDENTITY_A,
      "calculation_defect",
      new Date(NOW.getTime() + 180_000),
    );
    expect(recovered).toMatchObject({
      ok: true,
      status: "repair_reserved",
      predecessorId: second.readingId,
    });
    expect(
      await rows(
        "SELECT revision FROM daily_readings WHERE supersedes_reading_id = ?",
        second.readingId,
      ),
    ).toEqual([{ revision: 3 }]);
  });

  it("reconciles an accepted birth-chart correction before returning success", async () => {
    const { readingId } = await seedPublishedReading(new Date());
    const response = await app.request(
      "http://api.test/v1/birth-profiles",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "fact-repair-chart-correction",
        },
        body: JSON.stringify({ ...ALICE, birth_date: "1991-06-16" }),
      },
      enabledEnv(),
    );
    expect(response.status).toBe(202);
    expect(
      await rows("SELECT status FROM daily_readings WHERE id = ?", readingId),
    ).toEqual([{ status: "invalidated" }]);
    expect(
      await rows(
        "SELECT revision, supersedes_reading_id FROM daily_readings WHERE supersedes_reading_id = ?",
        readingId,
      ),
    ).toEqual([{ revision: 2, supersedes_reading_id: readingId }]);
  });

  it("keeps an ordinary safety reissue published until successful atomic supersession", async () => {
    const { readingId, localDate } = await seedPublishedReading();
    const reserved = await enqueueConstrainedReading(enabledEnv(), USER_A, {
      entry: "internal",
      reservationReason: "manual_reissue",
      targetLocalDate: localDate,
      revision: 2,
      revisionReason: "safety_correction",
      supersedesReadingId: readingId,
      now: NOW,
    });
    if (!reserved.ok) throw new Error(`ordinary reissue failed: ${reserved.reason}`);
    const claim = await claimJob(enabledEnv(), reserved.jobId, NOW);
    if (!claim) throw new Error("ordinary reissue claim missing");
    await failReading(
      env,
      IDENTITY_A,
      reserved.readingId,
      reserved.jobId,
      claim.claimToken,
      "publisher_refused",
    );

    expect(
      await rows("SELECT status FROM daily_readings WHERE id = ?", readingId),
    ).toEqual([{ status: "published" }]);
  });
});
