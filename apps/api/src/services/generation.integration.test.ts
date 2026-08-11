import { env, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3AssemblyIdentity from "../../../../contracts/m3/assembly-identity.schema.json";
import m3GenerationCommand from "../../../../contracts/m3/generation-command.schema.json";
import worker from "../index.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  rows,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { CYCLE_FP_EMPTY, CYCLE_FP_UNAVAILABLE } from "../../test/mock-calc-service.js";
import { decryptPayload } from "../db/users.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import {
  MAX_COMMAND_GENERATION,
  claimJob,
  completeReading,
  findUndispatched,
  loadInitialGenerationState,
} from "../db/generation.js";
import {
  dispatch,
  enqueueConstrainedReading,
  enqueueDailyReading,
  enqueueReissue,
  replaceFailedCommand,
  resolveV5TargetDate,
  type GenerationMessage,
} from "./enqueue.js";
import { OPENAI_READING_MODEL } from "./reading-publisher.js";
import { dispatchGeneration } from "./generate-daily-reading.js";
import { ensureTodayReading } from "./ensure-today-reading.js";
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
  available_at: string | null;
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
    `SELECT id, status, attempts, available_at, dispatched_at, claim_token, result_class,
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
async function deliver(messages: GenerationMessage[], attempts = 1) {
  const batch = createMessageBatch<GenerationMessage>(
    QUEUE,
    messages.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date(0),
      attempts,
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

function enabledV5Env() {
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

async function grantAiSynthesis() {
  await rows(
    `INSERT INTO consents (id, user_id, kind, status, policy_version, allowed_uses_json,
       scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    "cns_ai_synthesis_0001",
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    "2026-08-09T00:00:00.000Z",
    "2026-08-09T00:00:00.000Z",
    "2026-08-09T00:00:00.000Z",
  );
}

async function seedContextSignal(
  options: {
    consentStatus?: string;
    consentVersion?: number;
    sourceId?: string;
    signalAllowedUses?: string[];
    consentAllowedUses?: string[];
  } = {},
): Promise<void> {
  const now = "2026-08-09T12:00:00.000Z";
  const consentId = "cns_context_0000000001";
  const sourceId = options.sourceId ?? "USR-03";
  const signalAllowedUses = options.signalAllowedUses ?? [
    "life_domain_selection",
    "theme_ranking",
  ];
  const consentAllowedUses = options.consentAllowedUses ?? signalAllowedUses;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO consents
         (id, user_id, kind, status, source_id, permission_tier,
          allowed_uses_json, scopes_json, policy_version, granted_at, version,
          created_at, updated_at)
       VALUES (?, ?, 'product_source', ?, ?, 2, ?, '[]', 'policy-v1', ?, ?, ?, ?)`,
    ).bind(
      consentId,
      USER_A,
      options.consentStatus ?? "granted",
      sourceId,
      JSON.stringify(consentAllowedUses),
      now,
      options.consentVersion ?? 7,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, evidence_lane, allowed_uses_json, confidence,
          sensitivity, permission_state, conflict_status, consent_id,
          freshness_status, observed_at, ingested_at, value_encoding, value_json,
          normalized_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'user_and_context', ?, 'user_confirmed',
               'personal', 'active', 'none', ?, 'fresh', ?, ?, 'structured', '{}',
               ?, ?, ?)`,
    ).bind(
      "sig_context_0000000001",
      USER_A,
      sourceId,
      JSON.stringify(signalAllowedUses),
      consentId,
      now,
      now,
      "5".repeat(64),
      now,
      now,
    ),
  ]);
}

describe("enqueue", () => {
  beforeEach(seedEverything);

  it("reserves one pending reading and one encrypted queued job", async () => {
    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
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
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);

    const command = await decryptCommand(result.jobId);
    const valid = validateCommand(command);
    expect(validateCommand.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("pins the actual version of the granted consent for eligible context", async () => {
    await seedContextSignal({ consentVersion: 7 });

    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
    const command = await decryptCommand(result.jobId);

    expect(command.context).toEqual([
      expect.objectContaining({
        signal_id: "sig_context_0000000001",
        consent_id: "cns_context_0000000001",
        consent_version: 7,
        allowed_use: "life_domain_selection",
      }),
    ]);
  });

  it("does not freeze context whose consent is not currently granted", async () => {
    await seedContextSignal({ consentStatus: "revoked", consentVersion: 8 });

    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
    expect((await decryptCommand(result.jobId)).context).toEqual([]);
  });

  it.each([
    ["an excluded source", { sourceId: "AMB-12", signalAllowedUses: ["theme_ranking"] }],
    [
      "a use the source registry does not permit",
      { sourceId: "USR-03", signalAllowedUses: ["rendering"] },
    ],
    [
      "a use the granted consent does not permit",
      {
        sourceId: "USR-03",
        signalAllowedUses: ["life_domain_selection"],
        consentAllowedUses: [],
      },
    ],
  ])("does not freeze context from %s", async (_label, options) => {
    await seedContextSignal(options);

    const result = await enqueueDailyReading(env, USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
    expect((await decryptCommand(result.jobId)).context).toEqual([]);
  });

  it("freezes a reissue command that validates too", async () => {
    const initial = await enqueueDailyReading(env, USER_A);
    if (!initial.ok) throw new Error(`initial enqueue failed: ${initial.reason}`);
    await deliver([{ job_id: initial.jobId, reading_id: initial.readingId }]);

    // The generation-1 branch and the revision > 1 branch are separate
    // conditional subschemas, so a valid initial command proves nothing here.
    const reissued = await enqueueReissue(env, USER_A, initial.readingId, "defect_repair");
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) throw new Error(`reissue failed: ${reissued.reason}`);

    const command = await decryptCommand(reissued.jobId);
    expect(command.revision).toBe(2);
    expect(command.supersedes_reading_id).toBe(initial.readingId);
    validateCommand(command);
    expect(validateCommand.errors ?? []).toEqual([]);
  });

  it("replaying an enqueue creates no second reservation and changes no command", async () => {
    const first = await enqueueDailyReading(env, USER_A);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`enqueue failed: ${first.reason}`);
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
    if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
    const command = await decryptCommand(result.jobId);
    expect(command.target_local_date).toBe("2026-08-08");
    expect(command.day_start_at).toBe("2026-08-08T05:00:00Z");
    expect(command.day_end_at).toBe("2026-08-09T05:00:00Z");
  });

  it("refuses a chart whose stored uncertainty JSON is malformed", async () => {
    await rows(
      "UPDATE chart_snapshots SET uncertainty_json = '{not-json' WHERE user_id = ?",
      USER_A,
    );

    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "chart_not_found",
    });
    expect(await readings()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  it("refuses a chart whose stored snapshot has no position array", async () => {
    await rows(
      "UPDATE chart_snapshots SET snapshot_json = '{\"positions\":null}' WHERE user_id = ?",
      USER_A,
    );

    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "chart_not_found",
    });
    expect(await readings()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  it("refuses a chart whose stored uncertainty feature entries are malformed", async () => {
    await rows(
      `UPDATE chart_snapshots
       SET uncertainty_json = json_set(uncertainty_json, '$.suppressed_features', json('[null]'))
       WHERE user_id = ?`,
      USER_A,
    );

    expect(await enqueueDailyReading(env, USER_A)).toMatchObject({
      ok: false,
      reason: "chart_not_found",
    });
    expect(await readings()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});

describe("initial generation state", () => {
  const now = new Date("2026-08-09T18:00:00.000Z");
  const localDate = "2026-08-09";

  beforeEach(seedEverything);

  it("returns null when this user has no initial reservation for the local day", async () => {
    expect(await loadInitialGenerationState(env, USER_A, localDate)).toBeNull();
  });

  it("projects the pending reservation and every active-job recovery timestamp", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    expect(await loadInitialGenerationState(env, USER_A, localDate)).toEqual({
      readingId: enqueued.readingId,
      readingStatus: "pending",
      commandGeneration: 1,
      activeJob: {
        id: enqueued.jobId,
        status: "queued",
        resultClass: null,
        availableAt: null,
        dispatchedAt: expect.any(String),
        leaseExpiresAt: null,
      },
    });
  });

  it("projects a failed reservation's terminal class and command generation", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE daily_readings
       SET status = 'failed', command_generation = 2
       WHERE id = ?`,
      enqueued.readingId,
    );
    await rows(
      `UPDATE jobs
       SET status = 'failed', result_class = 'calc_unavailable'
       WHERE id = ?`,
      enqueued.jobId,
    );

    expect(await loadInitialGenerationState(env, USER_A, localDate)).toMatchObject({
      readingId: enqueued.readingId,
      readingStatus: "failed",
      commandGeneration: 2,
      activeJob: {
        id: enqueued.jobId,
        status: "failed",
        resultClass: "calc_unavailable",
      },
    });
  });

  it("cannot return another user's reservation for the same local day", async () => {
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B, "America/Chicago");
    await seedChart(IDENTITY_B);
    const theirs = await enqueueDailyReading(env, USER_B, now);
    if (!theirs.ok) throw new Error(`enqueue failed: ${theirs.reason}`);

    expect(await loadInitialGenerationState(env, USER_A, localDate)).toBeNull();
    expect(await loadInitialGenerationState(env, USER_B, localDate)).toMatchObject({
      readingId: theirs.readingId,
    });
  });
});

describe("ensure today", () => {
  const now = new Date("2026-08-09T18:00:00.000Z");

  beforeEach(seedEverything);

  it("returns the published reading without reserving another command", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    const outcome = await ensureTodayReading(env, IDENTITY_A, { now });

    expect(outcome).toMatchObject({
      ok: true,
      status: "ready",
      published: { record: { id: enqueued.readingId } },
    });
    expect(await readings()).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  it("reserves one pending reading and encrypted job when the day is absent", async () => {
    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toEqual({
      ok: true,
      status: "preparing",
      localDate: "2026-08-09",
    });

    const allReadings = await readings();
    const allJobs = await jobs();
    expect(allReadings).toHaveLength(1);
    expect(allReadings[0]).toMatchObject({ status: "pending", local_date: "2026-08-09" });
    expect(allJobs).toHaveLength(1);
    expect(allJobs[0]).toMatchObject({ status: "queued", payload_json: null });
    expect(allJobs[0]!.payload_enc).not.toBeNull();
  });

  it("converges concurrent ensures on one initial reservation and job", async () => {
    const outcomes = await Promise.all([
      ensureTodayReading(env, IDENTITY_A, { now }),
      ensureTodayReading(env, IDENTITY_A, { now }),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(["ready", "preparing"]).toContain(outcome.status);
    }
    expect(await readings()).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  it("does not redispatch a pending queued job already handed to Queues", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    const dispatchJob = vi.fn(async () => true);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toEqual({
      ok: true,
      status: "preparing",
      localDate: "2026-08-09",
    });
    expect(dispatchJob).not.toHaveBeenCalled();
  });
});

describe("ensure today recovery", () => {
  const now = new Date("2026-08-09T18:00:00.000Z");

  beforeEach(seedEverything);

  async function failCurrentDay(resultClass: string, commandGeneration = 1) {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE daily_readings
       SET status = 'failed', command_generation = ?
       WHERE id = ?`,
      commandGeneration,
      enqueued.readingId,
    );
    await rows(
      `UPDATE jobs
       SET status = 'failed', result_class = ?, claim_token = NULL,
           lease_expires_at = NULL
       WHERE id = ?`,
      resultClass,
      enqueued.jobId,
    );
    return enqueued;
  }

  it("redispatches only the due queued job whose outbox marker is absent", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE jobs
       SET dispatched_at = NULL, available_at = '2026-08-09T17:59:00.000Z'
       WHERE id = ?`,
      enqueued.jobId,
    );
    const dispatchJob = vi.fn(dispatch);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toEqual({
      ok: true,
      status: "preparing",
      localDate: "2026-08-09",
    });
    expect(dispatchJob).toHaveBeenCalledOnce();
    expect(dispatchJob).toHaveBeenCalledWith(env, {
      job_id: enqueued.jobId,
      reading_id: enqueued.readingId,
    });
    expect((await jobs())[0]!.dispatched_at).not.toBeNull();
  });

  it("does not redispatch an undispatched retry before its available time", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE jobs
       SET dispatched_at = NULL, available_at = '2026-08-09T18:01:00.000Z'
       WHERE id = ?`,
      enqueued.jobId,
    );
    const dispatchJob = vi.fn(dispatch);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toMatchObject({
      ok: true,
      status: "preparing",
    });
    expect(dispatchJob).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({
      available_at: "2026-08-09T18:01:00.000Z",
      dispatched_at: null,
    });
  });

  it("redispatches the active job when its running lease has expired", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    expect(await claimJob(env, enqueued.jobId, now)).not.toBeNull();
    await rows(
      `UPDATE jobs SET lease_expires_at = '2026-08-09T17:59:00.000Z' WHERE id = ?`,
      enqueued.jobId,
    );
    const dispatchJob = vi.fn(dispatch);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toMatchObject({
      ok: true,
      status: "preparing",
    });
    expect(dispatchJob).toHaveBeenCalledOnce();
    expect(dispatchJob).toHaveBeenCalledWith(env, {
      job_id: enqueued.jobId,
      reading_id: enqueued.readingId,
    });
  });

  it("does not redispatch a running job while its claim lease is live", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    expect(await claimJob(env, enqueued.jobId, now)).not.toBeNull();
    const dispatchJob = vi.fn(dispatch);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toMatchObject({
      ok: true,
      status: "preparing",
    });
    expect(dispatchJob).not.toHaveBeenCalled();
  });

  it.each(["calc_unavailable", "release_unreadable"] as const)(
    "re-freezes one bounded replacement after %s",
    async (resultClass) => {
      const failed = await failCurrentDay(resultClass);

      expect(await ensureTodayReading(env, IDENTITY_A, { now })).toEqual({
        ok: true,
        status: "preparing",
        localDate: "2026-08-09",
      });

      expect(await readings()).toEqual([
        expect.objectContaining({
          id: failed.readingId,
          status: "pending",
          revision: 1,
          command_generation: 2,
        }),
      ]);
      const allJobs = await jobs();
      expect(allJobs).toHaveLength(2);
      expect(allJobs[0]).toMatchObject({ id: failed.jobId, status: "failed" });
      expect(allJobs[1]).toMatchObject({ status: "queued" });
    },
  );

  it("leaves a retryable failure terminal when its command budget is spent", async () => {
    const failed = await failCurrentDay("calc_unavailable", MAX_COMMAND_GENERATION);

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
    expect(await readings()).toEqual([
      expect.objectContaining({
        id: failed.readingId,
        status: "failed",
        command_generation: MAX_COMMAND_GENERATION,
      }),
    ]);
    expect(await jobs()).toHaveLength(1);
  });

  it("does not replace a terminal result outside the scheduler allowlist", async () => {
    await failCurrentDay("payload_undecryptable");

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
    expect(await jobs()).toHaveLength(1);
  });

  it("does not rebuild a failed reservation whose active job is not terminal", async () => {
    const failed = await failCurrentDay("calc_unavailable");
    await rows(`UPDATE jobs SET status = 'queued' WHERE id = ?`, failed.jobId);
    await rows(
      `UPDATE chart_snapshots SET fingerprint = ? WHERE user_id = ? AND status = 'active'`,
      CYCLE_FP_UNAVAILABLE,
      USER_A,
    );

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
    expect(await jobs()).toHaveLength(1);
  });

  it("fails closed when a pending reservation has no active job", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE daily_readings SET active_generation_job_id = NULL WHERE id = ?`,
      enqueued.readingId,
    );

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
  });

  it("fails closed when a terminal job is still attached to a pending reservation", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE jobs
       SET status = 'failed', result_class = 'payload_undecryptable'
       WHERE id = ?`,
      enqueued.jobId,
    );

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
  });

  it("fails closed when a running job has no claim lease", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A, now);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE jobs SET status = 'running', lease_expires_at = NULL WHERE id = ?`,
      enqueued.jobId,
    );

    expect(await ensureTodayReading(env, IDENTITY_A, { now })).toMatchObject({
      ok: false,
      reason: "reading_generation_failed",
    });
  });

  it("never redispatches another user's due job", async () => {
    const mine = await enqueueDailyReading(env, USER_A, now);
    if (!mine.ok) throw new Error(`enqueue failed: ${mine.reason}`);
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B, "America/Chicago");
    await seedChart(IDENTITY_B);
    const theirs = await enqueueDailyReading(env, USER_B, now);
    if (!theirs.ok) throw new Error(`enqueue failed: ${theirs.reason}`);
    await rows(
      `UPDATE jobs SET dispatched_at = NULL WHERE id = ?`,
      theirs.jobId,
    );
    const dispatchJob = vi.fn(dispatch);

    expect(await ensureTodayReading(env, IDENTITY_A, { now, dispatchJob })).toMatchObject({
      ok: true,
      status: "preparing",
    });
    expect(dispatchJob).not.toHaveBeenCalled();
    const [theirJob] = await rows<{ dispatched_at: string | null }>(
      `SELECT dispatched_at FROM jobs WHERE id = ?`,
      theirs.jobId,
    );
    expect(theirJob!.dispatched_at).toBeNull();
  });
});

describe("queue delivery", () => {
  beforeEach(seedEverything);

  it("publishes the reading, its evidence, and closes the job", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

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
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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

  it("retries when the terminal failure transition itself cannot commit", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error("enqueue failed");
    await rows("DELETE FROM cycle_passes WHERE user_id = ?", USER_A);
    await rows("DELETE FROM cycle_instances WHERE user_id = ?", USER_A);
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      const delivery = await deliver([
        { job_id: enqueued.jobId, reading_id: enqueued.readingId },
      ]);
      expect(delivery.retryMessages).toHaveLength(1);
      expect((await jobs())[0]).toMatchObject({ status: "queued", claim_token: null });
      expect((await readings())[0]!.status).toBe("pending");
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
  });

  it("keeps the final failed transition reclaimable when D1 cannot commit it", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows("DELETE FROM cycle_passes WHERE user_id = ?", USER_A);
    await rows("DELETE FROM cycle_instances WHERE user_id = ?", USER_A);
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      const delivery = await deliver(
        [{ job_id: enqueued.jobId, reading_id: enqueued.readingId }],
        4,
      );
      expect(delivery.retryMessages).toHaveLength(1);
      expect((await jobs())[0]).toMatchObject({ status: "running" });
      expect((await jobs())[0]!.claim_token).not.toBeNull();
      expect((await readings())[0]!.status).toBe("pending");
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
  });

  it("holds a retryable claim out of the sweeper until its retry is due", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    const key = "content-releases/release-12.json";
    const stored = await env.ARTIFACTS!.get(key);
    expect(stored).not.toBeNull();
    const bytes = await stored!.arrayBuffer();
    const options = {
      httpMetadata: stored!.httpMetadata,
      customMetadata: stored!.customMetadata,
    };
    await env.ARTIFACTS!.delete(key);

    const message = { job_id: enqueued.jobId, reading_id: enqueued.readingId };
    const first = await deliver([message]);
    expect(first.retryMessages).toHaveLength(1);
    const [released] = await jobs();
    expect(released).toMatchObject({
      status: "queued",
      claim_token: null,
      dispatched_at: null,
    });
    expect(released!.available_at).not.toBeNull();
    const attemptsBeforeDeadline = released!.attempts;
    expect(await claimJob(env, enqueued.jobId)).toBeNull();
    expect((await jobs())[0]).toMatchObject({
      status: "queued",
      attempts: attemptsBeforeDeadline,
      available_at: released!.available_at,
    });
    expect(await findUndispatched(env)).not.toContainEqual({
      id: enqueued.jobId,
      reading_id: enqueued.readingId,
    });
    expect((await readings())[0]!.status).toBe("pending");

    await env.ARTIFACTS!.put(key, bytes, options);
    await rows(
      "UPDATE jobs SET available_at = '2000-01-01T00:00:00Z' WHERE id = ?",
      enqueued.jobId,
    );
    expect(await findUndispatched(env)).toContainEqual({
      id: enqueued.jobId,
      reading_id: enqueued.readingId,
    });
    const second = await deliver([message], 2);
    expect(second.retryMessages).toEqual([]);
    expect((await jobs())[0]!.status).toBe("succeeded");
    expect((await readings())[0]!.status).toBe("published");
  });

  it("fails a persistently unreadable encrypted command after bounded deliveries", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    const [stored] = await rows<{ payload_enc: ArrayBuffer }>(
      "SELECT payload_enc FROM jobs WHERE id = ?",
      enqueued.jobId,
    );
    const corrupted = new Uint8Array(stored!.payload_enc);
    corrupted[0] = corrupted[0]! ^ 0xff;
    await rows("UPDATE jobs SET payload_enc = ? WHERE id = ?", corrupted, enqueued.jobId);

    const message = { job_id: enqueued.jobId, reading_id: enqueued.readingId };
    const first = await deliver([message]);
    expect(first.retryMessages).toHaveLength(1);
    expect((await jobs())[0]).toMatchObject({ status: "queued", claim_token: null });

    // Queue's second delivery occurs after the persisted retry deadline; make
    // that time explicit rather than letting this direct harness bypass it.
    await rows(
      "UPDATE jobs SET available_at = '2000-01-01T00:00:00Z' WHERE id = ?",
      enqueued.jobId,
    );
    const final = await deliver([message], 4);
    expect(final.retryMessages).toEqual([]);
    expect((await jobs())[0]).toMatchObject({
      status: "failed",
      claim_token: null,
      result_class: "payload_undecryptable",
    });
    expect((await readings())[0]!.status).toBe("failed");
  });

  it("publishes the locale's universal fallback when no cycle is in orb", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_EMPTY });
    await seedActiveRelease();

    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
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

  it("fails closed when a pinned cycle's stored JSON is malformed", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    const frozen = await decryptCommand(enqueued.jobId);

    await rows(
      "UPDATE cycle_instances SET cycle_json = '{not-json' WHERE id = ?",
      frozen.cycle_scan.cycles[0]!.cycle_id,
    );
    const result = await deliver([
      { job_id: enqueued.jobId, reading_id: enqueued.readingId },
    ]);

    expect(result.retryMessages).toEqual([]);
    expect((await readings())[0]!.status).toBe("failed");
    expect((await jobs())[0]!.result_class).toBe("cycle_hash_mismatch");
  });

  it("fails closed when the pinned consent is revoked after enqueue", async () => {
    await seedContextSignal({ consentVersion: 7 });
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    const now = new Date().toISOString();
    await rows(
      `UPDATE consents SET status = 'revoked', version = 8, revoked_at = ?, updated_at = ?
       WHERE id = 'cns_context_0000000001'`,
      now,
      now,
    );
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    expect((await readings())[0]!.status).toBe("failed");
    expect((await jobs())[0]!.result_class).toBe("consent_revoked");
  });

  it("fails closed when the signal no longer permits its pinned use", async () => {
    await seedContextSignal({ consentVersion: 7 });
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    await rows(
      "UPDATE context_signals SET allowed_uses_json = '[]' WHERE id = 'sig_context_0000000001'",
    );
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    expect((await readings())[0]!.status).toBe("failed");
    expect((await jobs())[0]!.result_class).toBe("consent_revoked");
  });

  it("fails closed when consent no longer permits the pinned use", async () => {
    await seedContextSignal({ consentVersion: 7 });
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    await rows(
      "UPDATE consents SET allowed_uses_json = '[]' WHERE id = 'cns_context_0000000001'",
    );
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    expect((await readings())[0]!.status).toBe("failed");
    expect((await jobs())[0]!.result_class).toBe("consent_revoked");
  });

  it("fails closed when a pinned consent moves to another source", async () => {
    await seedContextSignal({ consentVersion: 7 });
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    await rows(
      "UPDATE consents SET source_id = 'AMB-12' WHERE id = 'cns_context_0000000001'",
    );
    await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);

    expect((await readings())[0]!.status).toBe("failed");
    expect((await jobs())[0]!.result_class).toBe("consent_revoked");
  });
});

describe("claims", () => {
  beforeEach(seedEverything);

  it("dispatches a V2 claim through its executor without changing the V1 seam", async () => {
    await grantAiSynthesis();
    const targetLocalDate = resolveV5TargetDate("America/Chicago", new Date());
    if (!targetLocalDate) throw new Error("target day did not resolve");
    const enqueued = await enqueueConstrainedReading(enabledV5Env() as typeof env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate,
    });
    if (!enqueued.ok) throw new Error(`V2 enqueue failed: ${enqueued.reason}`);

    const claim = await claimJob(env, enqueued.jobId);
    expect(claim?.command.command_version).toBe("v2");
    expect(await dispatchGeneration(enabledV5Env() as typeof env, claim!)).toMatchObject({
      ok: true,
      readingId: enqueued.readingId,
    });

    const [reading] = await rows<{ status: string; assembly_mode: string }>(
      "SELECT status, assembly_mode FROM daily_readings WHERE id = ?",
      enqueued.readingId,
    );
    expect(reading).toEqual({ status: "published", assembly_mode: "constrained_model" });
  });

  it("a stale claim cannot publish", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

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

    const stale = await dispatchGeneration(env, first!);
    expect(stale).toMatchObject({ ok: false, reason: "duplicate" });

    const [reading] = await readings();
    expect(reading!.status).toBe("pending");

    const winner = await dispatchGeneration(env, second!);
    expect(winner.ok).toBe(true);
    expect((await readings())[0]!.status).toBe("published");
  });

  it("a losing claim cannot overwrite the winner's published artifact", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);

    const loser = await claimJob(env, enqueued.jobId);
    await rows(
      `UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE id = ?`,
      enqueued.jobId,
    );
    const winner = await claimJob(env, enqueued.jobId);
    expect(await dispatchGeneration(env, winner!)).toMatchObject({ ok: true });

    const published = await decryptReading(enqueued.readingId);

    // OpenAI is nondeterministic, so two deliveries against one frozen command
    // can legitimately produce different prose. The claim CAS is the only
    // publication authority: the loser's candidate is discarded without any
    // textual comparison, and nothing about the winner changes.
    const outcome = await completeReading(env, {
      identity: IDENTITY_A,
      readingId: enqueued.readingId,
      jobId: enqueued.jobId,
      claimToken: loser!.claimToken,
      commandGeneration: 1,
      predecessor: { kind: "none" },
      reading: { ciphertext: new Uint8Array([1, 2, 3]), keyVersion: 1, nonce: "loser" },
      evidence: [],
    });

    expect(outcome).toMatchObject({ ok: false, reason: "stale_claim" });
    expect(await decryptReading(enqueued.readingId)).toEqual(published);

    const [row] = await rows<{ status: string; reading_nonce: string }>(
      "SELECT status, reading_nonce FROM daily_readings WHERE id = ?",
      enqueued.readingId,
    );
    expect(row!.status).toBe("published");
    expect(row!.reading_nonce).not.toBe("loser");
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
    if (!reissued.ok) throw new Error(`reissue failed: ${reissued.reason}`);

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

  it("does not misclassify an infrastructure failure as a stale predecessor", async () => {
    const first = await publishInitial();
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      expect(await enqueueReissue(env, USER_A, first, "defect_repair")).toMatchObject({
        ok: false,
        reason: "conflict",
      });
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
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
    if (!replaced.ok) throw new Error(`replacement failed: ${replaced.reason}`);

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

  it("does not misclassify an infrastructure failure as a stale replacement", async () => {
    const failed = await failTheDay();
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      expect(
        await replaceFailedCommand(
          env,
          USER_A,
          failed.readingId,
          "defect_repair",
          "operator",
        ),
      ).toMatchObject({ ok: false, reason: "conflict" });
      expect((await readings())[0]!.status).toBe("failed");
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
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

  it("logs retryable generation failures without the job identifier", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    const key = "content-releases/release-12.json";
    const stored = await env.ARTIFACTS!.get(key);
    expect(stored).not.toBeNull();
    await env.ARTIFACTS!.delete(key);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);
      expect(error).toHaveBeenCalledWith(
        "generation_retryable_failure",
        expect.objectContaining({
          trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
          failure_class: "release_unreadable",
        }),
      );
    } finally {
      error.mockRestore();
      await env.ARTIFACTS!.put(key, await stored!.arrayBuffer(), {
        httpMetadata: stored!.httpMetadata,
        customMetadata: stored!.customMetadata,
      });
    }
  });

  it("uses the V2 replacement policy for seeded constrained-model terminal rows", async () => {
    await grantAiSynthesis();
    const v5Env = enabledV5Env();
    const seeded = await enqueueConstrainedReading(v5Env, USER_A, {
      entry: "internal",
      reservationReason: "internal",
      targetLocalDate: "2026-08-09",
      now: new Date("2026-08-09T18:00:00.000Z"),
    });
    if (!seeded.ok) throw new Error(`v2 enqueue failed: ${seeded.reason}`);
    await rows(`UPDATE daily_readings SET status = 'failed' WHERE id = ?`, seeded.readingId);
    await rows(`UPDATE jobs SET status = 'failed' WHERE id = ?`, seeded.jobId);

    expect(
      await replaceFailedCommand(
        v5Env,
        USER_A,
        seeded.readingId,
        "publisher_unavailable",
        "scheduler",
        new Date("2026-08-09T18:00:00.000Z"),
      ),
    ).toMatchObject({ ok: true });
    expect((await readings())[0]).toMatchObject({
      command_generation: 2,
      status: "pending",
    });

    await rows(`UPDATE daily_readings SET status = 'failed' WHERE id = ?`, seeded.readingId);
    const [active] = await rows<{ active_generation_job_id: string }>(
      `SELECT active_generation_job_id FROM daily_readings WHERE id = ?`,
      seeded.readingId,
    );
    await rows(`UPDATE jobs SET status = 'failed' WHERE id = ?`, active!.active_generation_job_id);

    await expect(
      replaceFailedCommand(v5Env, USER_A, seeded.readingId, "release_unreadable", "scheduler"),
    ).resolves.toMatchObject({ ok: false, reason: "not_replaceable" });
    await expect(
      replaceFailedCommand(v5Env, USER_A, seeded.readingId, "consent_regranted", "scheduler"),
    ).resolves.toMatchObject({ ok: false, reason: "not_replaceable" });

    const replaced = await replaceFailedCommand(
      v5Env,
      USER_A,
      seeded.readingId,
      "publisher_unavailable",
      "scheduler",
      new Date("2026-08-09T18:00:00.000Z"),
    );
    expect(replaced).toMatchObject({ ok: true });
    expect((await readings())[0]).toMatchObject({ command_generation: 3, status: "pending" });
    if (!replaced.ok) throw new Error(`V2 g3 replacement failed: ${replaced.reason}`);
    await rows(`UPDATE daily_readings SET status = 'failed' WHERE id = ?`, seeded.readingId);
    await rows(`UPDATE jobs SET status = 'failed' WHERE id = ?`, replaced.jobId);

    await expect(
      replaceFailedCommand(v5Env, USER_A, seeded.readingId, "publisher_unavailable", "scheduler"),
    ).resolves.toMatchObject({ ok: false, reason: "budget_exhausted" });
  });

  it("refuses to silently regenerate a day the reader has moved past", async () => {
    const failed = await failTheDay();
    await rows(`UPDATE daily_readings SET local_date = '2026-01-01' WHERE id = ?`, failed.readingId);

    expect(
      await replaceFailedCommand(env, USER_A, failed.readingId, "calc_unavailable", "scheduler"),
    ).toMatchObject({ ok: false, reason: "day_too_old" });
  });
});
