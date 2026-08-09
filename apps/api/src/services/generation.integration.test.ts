import { env, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3AssemblyIdentity from "../../../../contracts/m3/assembly-identity.schema.json";
import m3GenerationCommand from "../../../../contracts/m3/generation-command.schema.json";
import worker from "../index.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { CYCLE_FP_EMPTY, CYCLE_FP_UNAVAILABLE } from "../../test/mock-calc-service.js";
import { decryptPayload } from "../db/users.js";
import { claimJob } from "../db/generation.js";
import {
  enqueueDailyReading,
  enqueueReissue,
  replaceFailedCommand,
  type GenerationMessage,
} from "./enqueue.js";
import { generateDailyReading } from "./generate-daily-reading.js";
import type { GenerateDailyReadingCommandV1 } from "./generation-command.js";
import type { StoredReading } from "./generate-daily-reading.js";

const QUEUE = "patternlike-daily-readings-dev";

/**
 * The contract, applied to what the runtime actually froze.
 *
 * `contracts/validate_schemas.py` proves the fixtures conform; nothing proved
 * that the object this Worker encrypts into `jobs.payload_enc` does. Phase 5
 * reads that object, so a drift between the two would surface as an
 * unassemblable reading rather than as a failing test.
 */
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
for (const schema of [m0Common, m3Common, m3AssemblyIdentity, m3GenerationCommand]) {
  ajv.addSchema(schema);
}
const validateCommand = ajv.getSchema(
  `${m3GenerationCommand.$id}#/$defs/generateDailyReadingCommandV1`,
)!;

interface ReadingRow {
  id: string;
  status: string;
  revision: number;
  command_generation: number;
  local_date: string;
  release_version: string;
  reading_key: string;
  supersedes_reading_id: string | null;
  active_generation_job_id: string | null;
  reading_enc: ArrayBuffer | null;
  reading_key_version: number | null;
  reading_nonce: string | null;
}

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  dispatched_at: string | null;
  claim_token: string | null;
  result_class: string | null;
  payload_enc: ArrayBuffer | null;
  payload_json: string | null;
  idempotency_key: string;
}

const readings = () =>
  rows<ReadingRow>(
    `SELECT id, status, revision, command_generation, local_date, release_version,
            reading_key, supersedes_reading_id, active_generation_job_id,
            reading_enc, reading_key_version, reading_nonce
     FROM daily_readings WHERE user_id = ? ORDER BY revision`,
    USER_A,
  );

const jobs = () =>
  rows<JobRow>(
    `SELECT id, status, attempts, dispatched_at, claim_token, result_class,
            payload_enc, payload_json, idempotency_key
     FROM jobs WHERE user_id = ? ORDER BY created_at, id`,
    USER_A,
  );

async function decryptCommand(jobId: string): Promise<GenerateDailyReadingCommandV1> {
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
  return decryptPayload<GenerateDailyReadingCommandV1>(
    env,
    IDENTITY_A,
    {
      key_version: row!.payload_key_version,
      nonce: row!.payload_nonce,
      ciphertext: btoa(binary),
    },
    { subject: IDENTITY_A.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
  );
}

async function decryptReading(readingId: string): Promise<StoredReading> {
  const [row] = await rows<{
    reading_enc: ArrayBuffer;
    reading_key_version: number;
    reading_nonce: string;
  }>(
    `SELECT reading_enc, reading_key_version, reading_nonce FROM daily_readings WHERE id = ?`,
    readingId,
  );
  let binary = "";
  for (const byte of new Uint8Array(row!.reading_enc)) binary += String.fromCharCode(byte);
  return decryptPayload<StoredReading>(
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

/** Drive the real queue handler the way the platform does. */
async function deliver(messages: GenerationMessage[]) {
  const batch = createMessageBatch<GenerationMessage>(
    QUEUE,
    messages.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date(0),
      attempts: 1,
      body,
    })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, ctx);
}

async function seedEverything() {
  await resetDb();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, "America/Chicago");
  await seedChart(IDENTITY_A);
  return seedActiveRelease();
}

describe("enqueue", () => {
  beforeEach(seedEverything);

  it("reserves one pending reading and one encrypted queued job", async () => {
    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);

    const [reading] = await readings();
    expect(reading).toMatchObject({
      status: "pending",
      revision: 1,
      command_generation: 1,
      supersedes_reading_id: null,
      active_generation_job_id: result.jobId,
    });
    expect(reading!.reading_enc).toBeNull();
    expect(reading!.reading_key).toBe(
      `user:${USER_A}:${reading!.local_date}:${reading!.release_version}:r1`,
    );

    const [job] = await jobs();
    expect(job).toMatchObject({ id: result.jobId, status: "queued" });
    // The command never travels or rests in the clear.
    expect(job!.payload_json).toBeNull();
    expect(job!.payload_enc).not.toBeNull();
    expect(job!.dispatched_at).not.toBeNull();

    const command = await decryptCommand(result.jobId);
    expect(command.command_version).toBe("v1");
    expect(command.assembly_id).toMatch(/^asm_[a-f0-9]{32}$/);
    expect(command.target_timezone).toBe("America/Chicago");
    expect(command.cycle_scan.cycles).toHaveLength(2);
    expect(command.cycle_scan.cycles[0]!.pass_ids).toHaveLength(3);
    expect(command.cycle_scan.cycles[0]!.cycle_hash).toMatch(/^[a-f0-9]{64}$/);

    // The scan it paid for is persisted, so the executor never re-scans.
    expect(await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A)).toHaveLength(2);
    expect(await rows("SELECT id FROM cycle_passes WHERE user_id = ?", USER_A)).toHaveLength(4);
  });

  it("freezes a command that validates against generation-command.schema.json", async () => {
    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const command = await decryptCommand(result.jobId);
    const valid = validateCommand(command);
    expect(validateCommand.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("freezes a reissue command that validates too", async () => {
    const initial = await enqueueDailyReading(env, USER_A);
    if (!initial.ok) return;
    await deliver([{ job_id: initial.jobId, reading_id: initial.readingId }]);

    // The generation-1 branch and the revision > 1 branch are separate
    // conditional subschemas, so a valid initial command proves nothing here.
    const reissued = await enqueueReissue(env, USER_A, initial.readingId, "defect_repair");
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;

    const command = await decryptCommand(reissued.jobId);
    expect(command.revision).toBe(2);
    expect(command.supersedes_reading_id).toBe(initial.readingId);
    validateCommand(command);
    expect(validateCommand.errors ?? []).toEqual([]);
  });

  it("replaying an enqueue creates no second reservation and changes no command", async () => {
    const first = await enqueueDailyReading(env, USER_A);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const frozen = await decryptCommand(first.jobId);

    const second = await enqueueDailyReading(env, USER_A);
    expect(second).toMatchObject({ ok: false, reason: "duplicate" });

    expect(await readings()).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
    expect(await decryptCommand(first.jobId)).toEqual(frozen);
  });

  it("is withheld until the scheduling zone and locale are owned values", async () => {
    await rows(
      `UPDATE users SET timezone_source = 'default_unconfirmed' WHERE id = ?`,
      USER_A,
    );
    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "timezone_confirmation_required",
    });

    await rows(
      `UPDATE users SET timezone_source = 'user_confirmed', locale_source = 'default_unconfirmed'
       WHERE id = ?`,
      USER_A,
    );
    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "locale_confirmation_required",
    });

    expect(await readings()).toHaveLength(0);
  });

  it("reserves nothing when the calculation service is unreachable", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_UNAVAILABLE });
    await seedActiveRelease();

    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "calc_unavailable",
    });
    expect(await readings()).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
  });

  it("resolves the target day in the scheduling zone, not UTC", async () => {
    // 2026-08-09T02:00Z is still 8 August in Chicago.
    const result = await enqueueDailyReading(env, USER_A, new Date("2026-08-09T02:00:00Z"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const command = await decryptCommand(result.jobId);
    expect(command.target_local_date).toBe("2026-08-08");
    expect(command.day_start_at).toBe("2026-08-08T05:00:00Z");
    expect(command.day_end_at).toBe("2026-08-09T05:00:00Z");
  });
});

describe("queue delivery", () => {
  beforeEach(seedEverything);

  it("publishes the reading, its evidence, and closes the job", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;

    const result = await deliver([
      { job_id: enqueued.jobId, reading_id: enqueued.readingId },
    ]);
    expect(result.retryMessages).toEqual([]);

    const [reading] = await readings();
    expect(reading!.status).toBe("published");
    expect(reading!.reading_enc).not.toBeNull();

    const [job] = await jobs();
    expect(job!.status).toBe("succeeded");
    expect(job!.claim_token).toBeNull();

    const stored = await decryptReading(enqueued.readingId);
    const command = await decryptCommand(enqueued.jobId);
    expect(stored.assembly_id).toBe(command.assembly_id);
    expect(stored.reading.paragraphs.length).toBeGreaterThan(0);
    expect(stored.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const evidence = await rows<{ paragraph_id: string; paragraph_order: number }>(
      `SELECT paragraph_id, paragraph_order FROM reading_sources
       WHERE reading_id = ? ORDER BY paragraph_order`,
      enqueued.readingId,
    );
    expect(evidence).toHaveLength(stored.reading.paragraphs.length);
  });

  it("publishes exactly once under duplicate delivery", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) return;
    const message = { job_id: enqueued.jobId, reading_id: enqueued.readingId };

    await deliver([message]);
    const afterFirst = await rows("SELECT id FROM reading_sources WHERE reading_id = ?", enqueued.readingId);

    // At-least-once delivery is the platform's contract, so this is a normal
    // event rather than an error path.
    const second = await deliver([message]);
    expect(second.retryMessages).toEqual([]);

    expect(await readings()).toHaveLength(1);
    expect(
      await rows("SELECT id FROM reading_sources WHERE reading_id = ?", enqueued.readingId),
    ).toHaveLength(afterFirst.length);
  });

  it("keeps the clear columns free of anything that reconstructs the reading", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) return;
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    const stored = await decryptReading(enqueued.readingId);
    const clear = JSON.stringify(
      await rows(
        `SELECT r.*, s.id AS source_id, s.paragraph_id, s.paragraph_order
         FROM daily_readings r LEFT JOIN reading_sources s ON s.reading_id = r.id
         WHERE r.user_id = ?`,
        USER_A,
      ),
    );

    for (const paragraph of stored.reading.paragraphs) {
      expect(clear).not.toContain(paragraph.text);
    }
    expect(clear).not.toContain(stored.assembly_id);
    expect(clear).not.toContain(stored.content_hash);
    if (stored.primary_cycle_id) expect(clear).not.toContain(stored.primary_cycle_id);
    // 0002 dropped these columns; naming them keeps a re-added one from passing.
    expect(clear).not.toContain("content_hash");
    expect(clear).not.toContain("validation_json");
  });

  it("acks a message whose job no longer exists rather than cycling it", async () => {
    const result = await deliver([{ job_id: "job_missing0000000001", reading_id: "rdg_x" }]);
    expect(result.retryMessages).toEqual([]);
  });

  it("publishes the locale's universal fallback when no cycle is in orb", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_EMPTY });
    await seedActiveRelease();

    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    const [reading] = await readings();
    expect(reading!.status).toBe("published");
    const stored = await decryptReading(enqueued.readingId);
    expect(stored.reading.fallback_used).toBe(true);
    expect(stored.reading.paragraphs.length).toBeGreaterThan(0);
  });
});

describe("frozen inputs", () => {
  beforeEach(seedEverything);

  it("ignores a release activated after the command was frozen", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) return;
    const frozen = await decryptCommand(enqueued.jobId);

    await seedActiveRelease("release-13");

    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);
    const [reading] = await readings();
    expect(reading!.status).toBe("published");
    expect(reading!.release_version).toBe(frozen.release_version);
    expect((await decryptReading(enqueued.readingId)).assembly_id).toBe(frozen.assembly_id);
  });

  it("ignores a timezone change and a midnight rollover after enqueue", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, new Date("2026-08-09T18:00:00Z"));
    if (!enqueued.ok) return;
    const frozen = await decryptCommand(enqueued.jobId);
    expect(frozen.target_local_date).toBe("2026-08-09");

    await confirmPreferences(USER_A, "Asia/Tokyo");

    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);
    const [reading] = await readings();
    expect(reading!.status).toBe("published");
    expect(reading!.local_date).toBe("2026-08-09");
    expect((await decryptReading(enqueued.readingId)).assembly_id).toBe(frozen.assembly_id);
  });

  it("fails closed when a pinned cycle's envelope changed under it", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) return;
    const frozen = await decryptCommand(enqueued.jobId);

    const pinned = frozen.cycle_scan.cycles[0]!.cycle_id;
    const [row] = await rows<{ cycle_json: string }>(
      "SELECT cycle_json FROM cycle_instances WHERE id = ?",
      pinned,
    );
    const tampered = JSON.parse(row!.cycle_json) as { end_at: string };
    tampered.end_at = "2030-01-01T00:00:00Z";
    await rows("UPDATE cycle_instances SET cycle_json = ? WHERE id = ?", JSON.stringify(tampered), pinned);

    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    const [reading] = await readings();
    expect(reading!.status).toBe("failed");
    expect(reading!.reading_enc).toBeNull();
    const [job] = await jobs();
    expect(job!.status).toBe("failed");
    expect(job!.result_class ?? "").toBe("cycle_hash_mismatch");
  });
});

describe("claims", () => {
  beforeEach(seedEverything);

  it("a stale claim cannot publish", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) return;

    const first = await claimJob(env, enqueued.jobId);
    expect(first).not.toBeNull();

    // A second consumer reclaims the lease as if the first had died, then the
    // first tries to finish. Its token no longer owns the job.
    await rows(
      `UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE id = ?`,
      enqueued.jobId,
    );
    const second = await claimJob(env, enqueued.jobId);
    expect(second).not.toBeNull();
    expect(second!.claimToken).not.toBe(first!.claimToken);

    const stale = await generateDailyReading(env, first!);
    expect(stale).toMatchObject({ ok: false, reason: "duplicate" });

    const [reading] = await readings();
    expect(reading!.status).toBe("pending");

    const winner = await generateDailyReading(env, second!);
    expect(winner.ok).toBe(true);
    expect((await readings())[0]!.status).toBe("published");
  });
});

describe("reissue", () => {
  beforeEach(seedEverything);

  async function publishInitial() {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error("initial enqueue failed");
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);
    return enqueued.readingId;
  }

  it("supersedes the exact expected predecessor and leaves it published until then", async () => {
    const first = await publishInitial();

    const reissued = await enqueueReissue(env, USER_A, first, "safety_correction");
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;

    // The predecessor stays live while its successor is only reserved.
    const midflight = await readings();
    expect(midflight.find((r) => r.id === first)!.status).toBe("published");
    expect(midflight.find((r) => r.id === reissued.readingId)!.status).toBe("pending");

    await deliver([{ job_id: reissued.jobId, reading_id: reissued.readingId }]);

    const after = await readings();
    expect(after.find((r) => r.id === first)!.status).toBe("superseded");
    const successor = after.find((r) => r.id === reissued.readingId)!;
    expect(successor.status).toBe("published");
    expect(successor.revision).toBe(2);
    expect(successor.supersedes_reading_id).toBe(first);
  });

  it("refuses a second reissue against the same predecessor", async () => {
    const first = await publishInitial();
    expect((await enqueueReissue(env, USER_A, first, "defect_repair")).ok).toBe(true);

    const second = await enqueueReissue(env, USER_A, first, "defect_repair");
    expect(second.ok).toBe(false);

    expect((await readings()).filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("refuses a reissue whose expected predecessor is not live", async () => {
    await publishInitial();
    expect(
      await enqueueReissue(env, USER_A, "rdg_not_a_real_reading", "defect_repair"),
    ).toMatchObject({ ok: false, reason: "stale_predecessor" });
  });
});

describe("command replacement", () => {
  beforeEach(seedEverything);

  /** Drive the day to a terminal failure the way a calc outage would. */
  async function failTheDay() {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error("enqueue failed");
    const claim = await claimJob(env, enqueued.jobId);
    await rows(
      `UPDATE daily_readings SET status = 'failed' WHERE id = ?`,
      enqueued.readingId,
    );
    await rows(
      `UPDATE jobs SET status = 'failed', claim_token = NULL WHERE id = ?`,
      claim!.jobId,
    );
    return enqueued;
  }

  it("re-freezes the day without consuming a revision", async () => {
    const failed = await failTheDay();

    const replaced = await replaceFailedCommand(
      env,
      USER_A,
      failed.readingId,
      "calc_unavailable",
      "scheduler",
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;

    const [reading] = await readings();
    expect(reading).toMatchObject({
      status: "pending",
      revision: 1,
      command_generation: 2,
      active_generation_job_id: replaced.jobId,
    });
    // The earlier command stays terminal and auditable rather than being edited.
    const all = await jobs();
    expect(all).toHaveLength(2);
    expect(all.find((j) => j.id === failed.jobId)!.status).toBe("failed");

    await deliver([{ job_id: replaced.jobId, reading_id: failed.readingId }]);
    expect((await readings())[0]!.status).toBe("published");
  });

  it("refuses a stale expected job", async () => {
    const failed = await failTheDay();
    await rows(
      `UPDATE daily_readings SET active_generation_job_id = NULL WHERE id = ?`,
      failed.readingId,
    );
    expect(
      await replaceFailedCommand(env, USER_A, failed.readingId, "calc_unavailable", "scheduler"),
    ).toMatchObject({ ok: false, reason: "stale_job" });
  });

  it("keeps editorial and privacy judgements away from the scheduler", async () => {
    const failed = await failTheDay();
    for (const reason of ["context_minimized", "policy_upgraded", "defect_repair"] as const) {
      expect(
        await replaceFailedCommand(env, USER_A, failed.readingId, reason, "scheduler"),
      ).toMatchObject({ ok: false, reason: "not_replaceable" });
    }
    // An operator may make exactly the same call.
    expect(
      (await replaceFailedCommand(env, USER_A, failed.readingId, "defect_repair", "operator")).ok,
    ).toBe(true);
  });

  it("stops after two automatic attempts and leaves the day visibly failed", async () => {
    const failed = await failTheDay();

    for (const generation of [2, 3]) {
      const replaced = await replaceFailedCommand(
        env,
        USER_A,
        failed.readingId,
        "calc_unavailable",
        "scheduler",
      );
      expect(replaced.ok).toBe(true);
      expect((await readings())[0]!.command_generation).toBe(generation);
      await rows(`UPDATE daily_readings SET status = 'failed' WHERE id = ?`, failed.readingId);
      await rows(
        `UPDATE jobs SET status = 'failed' WHERE id = ?`,
        replaced.ok ? replaced.jobId : "",
      );
    }

    expect(
      await replaceFailedCommand(env, USER_A, failed.readingId, "calc_unavailable", "scheduler"),
    ).toMatchObject({ ok: false, reason: "budget_exhausted" });

    const [reading] = await readings();
    expect(reading!.status).toBe("failed");
    expect(reading!.command_generation).toBe(3);
  });

  it("refuses to silently regenerate a day the reader has moved past", async () => {
    const failed = await failTheDay();
    await rows(`UPDATE daily_readings SET local_date = '2026-01-01' WHERE id = ?`, failed.readingId);

    expect(
      await replaceFailedCommand(env, USER_A, failed.readingId, "calc_unavailable", "scheduler"),
    ).toMatchObject({ ok: false, reason: "day_too_old" });
  });
});
