import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3AssemblyIdentity from "../../../../contracts/m3/assembly-identity.schema.json";
import m3GenerationCommand from "../../../../contracts/m3/generation-command.schema.json";
import m5Common from "../../../../contracts/m5/common.schema.json";
import m5GenerationCommand from "../../../../contracts/m5/generation-command.schema.json";
import m5ReadingGenerationOutput from "../../../../contracts/m5/reading-generation-output.schema.json";
import m5ReadingGenerationRequest from "../../../../contracts/m5/reading-generation-request.schema.json";
import dailyUncertainty from "../../../../contracts/daily-uncertainty-v1/uncertainty.schema.json";
import dailyGenerationRequest from "../../../../contracts/daily-uncertainty-v1/reading-generation-request.schema.json";
import dailyGenerationCommand from "../../../../contracts/daily-uncertainty-v1/generation-command.schema.json";
import editionReissueContract from "../../../../contracts/daily-edition-reissue-v1/daily-edition-reissue.schema.json";

import worker, { app } from "../index.js";
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
  READING_CODEX_PUBLISHER_VARS,
  SILENT_READING_QUEUE,
} from "../../test/helpers.js";
import {
  candidateFor,
  claimReadingJob,
  completeReadingJob,
  readingProviderJobCount,
} from "../../test/codex-reading-runner.js";
import { AI_SYNTHESIS_POLICY_VERSION, assertExactCurrentAiSynthesisGrant } from "../db/consents.js";
import { claimJob, failReading } from "../db/generation.js";
import { decryptPayload, encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import {
  enqueueDailyReading,
  enqueueConstrainedReading,
  replaceFailedCommand,
  resolveV5TargetDate,
} from "./enqueue.js";
import { dispatchGeneration } from "./generate-daily-reading.js";
import type { GenerateDailyReadingCommand } from "./generation-command-v2.js";
import { resolveLocalDay } from "./local-day.js";
import { invalidatePublishedReading, reserveFactRepair } from "./reading-invalidation.js";
import type { StoredReadingV5 } from "./stored-reading.js";
import {
  EDITION_REISSUE_MESSAGES,
  EDITION_REISSUE_STATUS,
  reissuePublishedEdition,
  type DailyEditionReissueRequest,
  type EditionReissueReason,
  type GenerationFamily,
} from "./edition-reissue.js";

const QUEUE = "patternlike-daily-readings-dev";
const ZONE = "America/Chicago";
/** 10:00 on 2026-08-10 in the reader's zone. */
const NOW = new Date("2026-08-10T15:00:00.000Z");
const YESTERDAY = "2026-08-09";
const TODAY = "2026-08-10";
const TOMORROW = "2026-08-11";
const DAY_AFTER = "2026-08-12";
const AI_CONSENT_ID = "cns_edition_reissue_ai_0001";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
for (const schema of [
  m0Common,
  m3Common,
  m3AssemblyIdentity,
  m3GenerationCommand,
  m5Common,
  m5ReadingGenerationOutput,
  m5ReadingGenerationRequest,
  m5GenerationCommand,
  dailyUncertainty,
  dailyGenerationRequest,
  dailyGenerationCommand,
  editionReissueContract,
]) {
  ajv.addSchema(schema);
}
const validateCommandV1 = ajv.getSchema(
  `${m3GenerationCommand.$id}#/$defs/generateDailyReadingCommandV1`,
)!;
const validateCommandV2 = ajv.getSchema(
  `${dailyGenerationCommand.$id}#/$defs/generateDailyReadingCommandV2`,
)!;
const validateAccepted = ajv.getSchema(`${editionReissueContract.$id}#/$defs/accepted`)!;
const validateError = ajv.getSchema(`${editionReissueContract.$id}#/$defs/errorResponse`)!;

/** Constrained-model generation enabled for the internal entry, with no real Queue delivery. */
function v5Env(overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "internal",
    ...READING_CODEX_PUBLISHER_VARS,
    READING_QUEUE: SILENT_READING_QUEUE,
    ...overrides,
  };
}

/** The hermetic baseline (rollout off), with no real Queue delivery. */
function quietEnv(): typeof env {
  return { ...env, READING_QUEUE: SILENT_READING_QUEUE };
}

async function grantAiSynthesis(): Promise<void> {
  const at = "2026-08-09T00:00:00.000Z";
  await rows(
    `INSERT INTO consents
       (id, user_id, kind, status, policy_version, allowed_uses_json,
        scopes_json, version, granted_at, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', 1, ?, ?, ?)`,
    AI_CONSENT_ID,
    USER_A,
    AI_SYNTHESIS_POLICY_VERSION,
    at,
    at,
    at,
  );
}

async function revokeAiSynthesis(): Promise<void> {
  await rows(
    "UPDATE consents SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?",
    NOW.toISOString(),
    NOW.toISOString(),
    AI_CONSENT_ID,
  );
}

/** Withdraw the grant without freezing: an active account with no live grant. */
async function revokeAccountProcessing(): Promise<void> {
  await rows(
    `UPDATE consents SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE user_id = ? AND kind = 'account_processing'`,
    NOW.toISOString(),
    NOW.toISOString(),
    USER_A,
  );
}

async function seedAccount(): Promise<void> {
  await resetDb();
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A, ZONE);
  await seedChart(IDENTITY_A);
  await grantAiSynthesis();
}

/** Drive one claimed constrained-model job through the durable provider path. */
async function runConstrained(jobId: string): Promise<unknown> {
  const claim = await claimJob(v5Env(), jobId);
  if (!claim) throw new Error(`job ${jobId} did not claim`);
  const first = await dispatchGeneration(v5Env(), claim);
  if ((first as { reason?: string }).reason !== "publisher_pending") return first;
  const claimed = await claimReadingJob();
  if (!claimed) throw new Error("provider job missing");
  await completeReadingJob(claimed, JSON.stringify(candidateFor(claimed.packet)));
  return dispatchGeneration(v5Env(), claim);
}

async function publishConstrained(localDate = TODAY, at = NOW): Promise<string> {
  const enqueued = await enqueueConstrainedReading(v5Env(), USER_A, {
    entry: "internal",
    reservationReason: "internal",
    targetLocalDate: localDate,
    now: at,
  });
  if (!enqueued.ok) throw new Error(`target enqueue failed: ${enqueued.reason}`);
  expect(await runConstrained(enqueued.jobId)).toMatchObject({ ok: true });
  return enqueued.readingId;
}

/** Drive the real Queue handler, the way the platform delivers a V1 job. */
async function deliver(message: { job_id: string; reading_id: string }) {
  const batch = createMessageBatch<{ job_id: string; reading_id: string }>(QUEUE, [
    { id: "msg-edition-reissue", timestamp: new Date(0), attempts: 1, body: message },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, ctx);
}

async function publishDeterministic(at = NOW): Promise<string> {
  const enqueued = await enqueueDailyReading(quietEnv(), USER_A, at);
  if (!enqueued.ok) throw new Error(`target enqueue failed: ${enqueued.reason}`);
  await deliver({ job_id: enqueued.jobId, reading_id: enqueued.readingId });
  expect(await statusOf(enqueued.readingId)).toBe("published");
  return enqueued.readingId;
}

function request(
  readingId: string,
  family: GenerationFamily,
  reason: EditionReissueReason,
  overrides: Partial<DailyEditionReissueRequest["target"]> = {},
): DailyEditionReissueRequest {
  return {
    schema_version: "daily-edition-reissue/v1",
    user_id: USER_A,
    target: {
      reading_id: readingId,
      revision: 1,
      local_date: TODAY,
      generation_family: family,
      ...overrides,
    },
    revision_reason: reason,
  };
}

async function statusOf(readingId: string): Promise<string | undefined> {
  const [row] = await rows<{ status: string }>(
    "SELECT status FROM daily_readings WHERE id = ?",
    readingId,
  );
  return row?.status;
}

async function successorsOf(readingId: string) {
  return rows<{
    id: string;
    status: string;
    revision: number;
    revision_reason: string;
    assembly_mode: string;
    local_date: string;
    reading_key: string;
    command_generation: number;
    active_generation_job_id: string;
  }>(
    `SELECT id, status, revision, revision_reason, assembly_mode, local_date,
            reading_key, command_generation, active_generation_job_id
     FROM daily_readings WHERE supersedes_reading_id = ?`,
    readingId,
  );
}

async function jobCount(): Promise<number> {
  const [row] = await rows<{ count: number }>(
    `SELECT COUNT(*) AS count FROM jobs
     WHERE user_id = ? AND job_type = 'generate_daily_reading'`,
    USER_A,
  );
  return row!.count;
}

/** Everything a reissue could have created, so a refusal can be shown to create none of it. */
async function reservationFootprint() {
  return {
    jobs: await jobCount(),
    providerJobs: await readingProviderJobCount(),
    readings: (await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).length,
  };
}

async function frozenCommand(jobId: string): Promise<GenerateDailyReadingCommand> {
  const [row] = await rows<{
    payload_enc: ArrayBuffer;
    payload_key_version: number;
    payload_nonce: string;
  }>(
    "SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ?",
    jobId,
  );
  let binary = "";
  for (const byte of new Uint8Array(row!.payload_enc)) binary += String.fromCharCode(byte);
  return decryptPayload<GenerateDailyReadingCommand>(
    env,
    IDENTITY_A,
    { key_version: row!.payload_key_version, nonce: row!.payload_nonce, ciphertext: btoa(binary) },
    { subject: IDENTITY_A.cryptoSubject, field: "jobs.payload_enc", recordId: jobId },
  );
}

async function storedReading(readingId: string): Promise<StoredReadingV5> {
  const [row] = await rows<{
    reading_enc: ArrayBuffer;
    reading_key_version: number;
    reading_nonce: string;
  }>(
    "SELECT reading_enc, reading_key_version, reading_nonce FROM daily_readings WHERE id = ?",
    readingId,
  );
  let binary = "";
  for (const byte of new Uint8Array(row!.reading_enc)) binary += String.fromCharCode(byte);
  return decryptPayload<StoredReadingV5>(
    env,
    IDENTITY_A,
    { key_version: row!.reading_key_version, nonce: row!.reading_nonce, ciphertext: btoa(binary) },
    { subject: IDENTITY_A.cryptoSubject, field: "daily_readings.reading_enc", recordId: readingId },
  );
}

async function resealReading(readingId: string, value: unknown): Promise<void> {
  const sealed = await encryptPayload(env, IDENTITY_A, value, {
    subject: IDENTITY_A.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: readingId,
  });
  await rows(
    `UPDATE daily_readings SET reading_enc = ?, reading_key_version = ?, reading_nonce = ?
     WHERE id = ?`,
    fromB64(sealed.ciphertext),
    sealed.keyVersion,
    sealed.nonce,
    readingId,
  );
}

/**
 * Observe the Worker's calculation calls, optionally acting on one.
 *
 * The mock calculation service is miniflare's outbound service and runs
 * outside this isolate, but the Worker's own `fetch` runs here, which is where
 * a concurrent revocation or a racing peer can be placed deterministically.
 */
function watchCalculation(onRequest?: (path: string) => Promise<void>): string[] {
  const paths: string[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    paths.push(path);
    if (onRequest) await onRequest(path);
    return realFetch(input as never, init as never);
  });
  return paths;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("family-aware edition reissue", () => {
  beforeEach(async () => {
    await seedAccount();
    // The whole suite reasons about one fixed reader day. Both resolvers must
    // agree on it or every date assertion below is about something else.
    expect(resolveV5TargetDate(ZONE, NOW)).toBe(TODAY);
    expect(resolveLocalDay(ZONE, NOW).targetLocalDate).toBe(TODAY);
  });

  describe("family selection", () => {
    it("freezes a constrained-model successor for a constrained-model edition", async () => {
      const target = await publishConstrained();
      const before = await reservationFootprint();

      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction"),
        NOW,
      );

      expect(outcome).toMatchObject({
        ok: true,
        status: "reserved",
        successor: { revision: 2, revisionReason: "safety_correction", status: "pending" },
        dispatched: true,
      });
      if (!outcome.ok) throw new Error("unreachable");
      const [successor] = await successorsOf(target);
      expect(successor).toEqual({
        id: outcome.successor.readingId,
        status: "pending",
        revision: 2,
        revision_reason: "safety_correction",
        assembly_mode: "constrained_model",
        local_date: TODAY,
        reading_key: `reading-v5:${USER_A}:${TODAY}:r2`,
        command_generation: 1,
        active_generation_job_id: outcome.successor.jobId,
      });

      const command = await frozenCommand(outcome.successor.jobId);
      expect(command).toMatchObject({
        command_version: "v2",
        assembly_mode: "constrained_model",
        reservation_reason: "manual_reissue",
        reading_id: outcome.successor.readingId,
        revision: 2,
        revision_reason: "safety_correction",
        supersedes_reading_id: target,
        target_local_date: TODAY,
        command_generation: 1,
        replaces_job_id: null,
        command_replacement_reason: null,
        ai_consent: { consent_id: AI_CONSENT_ID },
      });
      validateCommandV2(command);
      expect(validateCommandV2.errors ?? []).toEqual([]);

      // Reservation spends nothing: one job, and no provider job until execution.
      expect(await reservationFootprint()).toEqual({
        jobs: before.jobs + 1,
        providerJobs: before.providerJobs,
        readings: before.readings + 1,
      });
      expect(await statusOf(target)).toBe("published");
    });

    it("freezes a deterministic successor for a deterministic edition with the rollout off", async () => {
      await seedActiveRelease();
      const target = await publishDeterministic();

      // quietEnv keeps READING_V5_ROLLOUT=off: a deterministic reissue reaches no model.
      const outcome = await reissuePublishedEdition(
        quietEnv(),
        request(target, "deterministic", "consent_revoked"),
        NOW,
      );

      expect(outcome).toMatchObject({ ok: true, status: "reserved" });
      if (!outcome.ok) throw new Error("unreachable");
      const [successor] = await successorsOf(target);
      expect(successor).toMatchObject({
        assembly_mode: "deterministic",
        revision: 2,
        revision_reason: "consent_revoked",
        local_date: TODAY,
        reading_key: `user:${USER_A}:${TODAY}:release-12:r2`,
      });
      const command = await frozenCommand(outcome.successor.jobId);
      expect(command).toMatchObject({
        command_version: "v1",
        revision: 2,
        revision_reason: "consent_revoked",
        supersedes_reading_id: target,
        target_local_date: TODAY,
        release_version: "release-12",
      });
      validateCommandV1(command);
      expect(validateCommandV1.errors ?? []).toEqual([]);
      expect(await readingProviderJobCount()).toBe(0);
    });

    it.each([
      ["a constrained-model edition named deterministic", "constrained_model", "deterministic"],
      ["a deterministic edition named constrained-model", "deterministic", "constrained_model"],
    ] as const)("refuses %s", async (_label, actual, stated) => {
      if (actual === "deterministic") await seedActiveRelease();
      const target = actual === "deterministic"
        ? await publishDeterministic()
        : await publishConstrained();
      const before = await reservationFootprint();
      const calculation = watchCalculation();

      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, stated, "defect_repair"),
        NOW,
      );

      expect(outcome).toMatchObject({ ok: false, reason: "family_mismatch" });
      expect(calculation).toEqual([]);
      expect(await reservationFootprint()).toEqual(before);
    });

    it.each([
      [
        "a row relabeled deterministic over a constrained-model artifact",
        async (target: string) => {
          await seedActiveRelease();
          await rows(
            `UPDATE daily_readings
             SET assembly_mode = 'deterministic', release_version = 'release-12',
                 reading_key = ?
             WHERE id = ?`,
            `user:${USER_A}:${TODAY}:release-12:r1`,
            target,
          );
        },
        "deterministic" as const,
      ],
      [
        "an artifact whose identity names another revision",
        async (target: string) => {
          const stored = await storedReading(target);
          await resealReading(target, { ...stored, reading: { ...stored.reading, revision: 7 } });
        },
        "constrained_model" as const,
      ],
      [
        "an artifact whose evidence names another reading",
        async (target: string) => {
          const stored = await storedReading(target);
          await resealReading(target, {
            ...stored,
            evidence_header: { ...stored.evidence_header, reading_id: "rdg_someone_else_0001" },
          });
        },
        "constrained_model" as const,
      ],
      [
        "an artifact that no longer decrypts",
        async (target: string) => {
          await rows(
            "UPDATE daily_readings SET reading_nonce = ? WHERE id = ?",
            btoa("x".repeat(12)),
            target,
          );
        },
        "constrained_model" as const,
      ],
    ])("fails closed on %s", async (_label, tamper, stated) => {
      const target = await publishConstrained();
      await tamper(target);
      const before = await reservationFootprint();
      const calculation = watchCalculation();

      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, stated, "safety_correction"),
        NOW,
      );

      expect(outcome).toMatchObject({ ok: false, reason: "target_evidence_invalid" });
      expect(calculation).toEqual([]);
      expect(await reservationFootprint()).toEqual(before);
    });
  });

  describe("reasons, authorization, and consent", () => {
    it.each(["consent_revoked", "chart_recalculated"] as const)(
      "never starts a constrained-model generation for %s",
      async (reason) => {
        const target = await publishConstrained();
        const before = await reservationFootprint();
        const calculation = watchCalculation();

        const outcome = await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", reason),
          NOW,
        );

        expect(outcome).toMatchObject({ ok: false, reason: "reason_not_supported" });
        expect(calculation).toEqual([]);
        expect(await reservationFootprint()).toEqual(before);
        expect(await statusOf(target)).toBe("published");
      },
    );

    it("refuses a frozen account", async () => {
      const target = await publishConstrained();
      await rows("UPDATE users SET status = 'frozen' WHERE id = ?", USER_A);
      const before = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "account_not_active" });
      expect(await reservationFootprint()).toEqual(before);
    });

    it("refuses an active account without a current account-processing grant", async () => {
      const target = await publishConstrained();
      await revokeAccountProcessing();
      const before = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "account_processing_required" });
      expect(await reservationFootprint()).toEqual(before);
    });

    it("requires a live ai_synthesis grant for a constrained-model successor", async () => {
      const target = await publishConstrained();
      await revokeAiSynthesis();
      const before = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "defect_repair"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "ai_synthesis_consent_required" });
      expect(await reservationFootprint()).toEqual(before);
    });

    it("keeps the rollout kill switch ahead of any calculation", async () => {
      const target = await publishConstrained();
      const before = await reservationFootprint();
      const calculation = watchCalculation();

      expect(
        await reissuePublishedEdition(
          v5Env({ READING_V5_ROLLOUT: "off" }),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "rollout_disabled" });
      expect(calculation).toEqual([]);
      expect(await reservationFootprint()).toEqual(before);
    });

    it.each([
      ["an ai_synthesis revocation", revokeAiSynthesis, "ai_synthesis_consent_required"],
      ["an account-processing withdrawal", revokeAccountProcessing, "account_processing_required"],
      [
        "a factual invalidation of the edition",
        async () => {
          const [target] = await rows<{ id: string }>(
            "SELECT id FROM daily_readings WHERE user_id = ? AND status = 'published'",
            USER_A,
          );
          await invalidatePublishedReading(env, {
            identity: IDENTITY_A,
            readingId: target!.id,
            reason: "calculation_defect",
            now: NOW,
          });
        },
        "stale_target",
      ],
    ] as const)(
      "re-asserts the admission inside the reservation batch when %s commits mid-flight",
      async (_label, change, reason) => {
        const target = await publishConstrained();
        const before = await reservationFootprint();
        let changed = false;
        // After the grants were read and the command pinned them, before the
        // reservation batch: the last calculation call is the widest window.
        watchCalculation(async (path) => {
          if (path.endsWith("/v1/daily-sky") && !changed) {
            changed = true;
            await change();
          }
        });

        const outcome = await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        );

        expect(changed).toBe(true);
        expect(outcome).toMatchObject({ ok: false, reason });
        expect(await successorsOf(target)).toEqual([]);
        expect(await reservationFootprint()).toEqual(before);
      },
    );

    it("aborts a batch once the pinned ai_synthesis grant is no longer current", async () => {
      const guard = () => assertExactCurrentAiSynthesisGrant(
        env,
        USER_A,
        AI_CONSENT_ID,
        AI_SYNTHESIS_POLICY_VERSION,
        NOW,
      );
      await env.DB.batch([guard()]);

      // A regrant is a different consent, and the frozen one is no longer current.
      await rows(
        `INSERT INTO consents
           (id, user_id, kind, status, policy_version, allowed_uses_json,
            scopes_json, version, granted_at, created_at, updated_at)
         VALUES ('cns_edition_reissue_ai_0002', ?, 'ai_synthesis', 'granted', ?,
                 '[]', '[]', 2, ?, ?, ?)`,
        USER_A,
        AI_SYNTHESIS_POLICY_VERSION,
        NOW.toISOString(),
        NOW.toISOString(),
        NOW.toISOString(),
      );
      await expect(env.DB.batch([guard()])).rejects.toThrow();

      await rows("DELETE FROM consents WHERE id = 'cns_edition_reissue_ai_0002'");
      await revokeAiSynthesis();
      await expect(env.DB.batch([guard()])).rejects.toThrow();
    });
  });

  describe("target binding and date scope", () => {
    it.each([
      ["another revision", { revision: 2 }],
      ["another local date", { local_date: TOMORROW }],
    ] as const)("refuses a request naming %s of the stored edition", async (_label, overrides) => {
      const target = await publishConstrained();
      const before = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction", overrides),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "target_mismatch" });
      expect(await reservationFootprint()).toEqual(before);
    });

    it("does not reveal or reissue another account's edition", async () => {
      const target = await publishConstrained();
      await seedUser(IDENTITY_B);
      await confirmPreferences(USER_B, ZONE);

      expect(
        await reissuePublishedEdition(
          v5Env(),
          { ...request(target, "constrained_model", "safety_correction"), user_id: USER_B },
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "target_not_found" });
      expect(await successorsOf(target)).toEqual([]);
      expect(await statusOf(target)).toBe("published");
    });

    it.each([
      ["pending", "pending"],
      ["failed", "failed"],
    ] as const)("refuses a %s edition as stale", async (_label, status) => {
      const target = await publishConstrained();
      await rows(
        `UPDATE daily_readings
         SET status = ?, reading_enc = NULL, reading_key_version = NULL, reading_nonce = NULL
         WHERE id = ?`,
        status,
        target,
      );

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "stale_target" });
    });

    it("refuses an invalidated edition, which only fact repair may succeed", async () => {
      const target = await publishConstrained();
      await invalidatePublishedReading(env, {
        identity: IDENTITY_A,
        readingId: target,
        reason: "calculation_defect",
        now: NOW,
      });

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "defect_repair"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "stale_target" });
      expect(await successorsOf(target)).toEqual([]);
    });

    it("reissues tomorrow's pre-generated constrained-model edition for exactly that day", async () => {
      const target = await publishConstrained(TOMORROW);

      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction", { local_date: TOMORROW }),
        NOW,
      );

      expect(outcome).toMatchObject({ ok: true, status: "reserved" });
      if (!outcome.ok) throw new Error("unreachable");
      const command = await frozenCommand(outcome.successor.jobId);
      expect(command).toMatchObject({
        command_version: "v2",
        target_local_date: TOMORROW,
        reading_key: `reading-v5:${USER_A}:${TOMORROW}:r2`,
      });
    });

    it.each([
      ["yesterday", YESTERDAY],
      ["two days ahead", DAY_AFTER],
    ])("keeps a constrained-model edition from %s out of scope", async (_label, localDate) => {
      const target = await publishConstrained(localDate);
      const before = await reservationFootprint();
      const calculation = watchCalculation();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction", { local_date: localDate }),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "day_out_of_scope" });
      expect(calculation).toEqual([]);
      expect(await reservationFootprint()).toEqual(before);
    });

    it("keeps a deterministic edition to the day its builder resolves", async () => {
      await seedActiveRelease();
      const target = await publishDeterministic();
      const before = await reservationFootprint();
      const calculation = watchCalculation();
      const nextMorning = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

      expect(
        await reissuePublishedEdition(
          quietEnv(),
          request(target, "deterministic", "safety_correction"),
          nextMorning,
        ),
      ).toMatchObject({ ok: false, reason: "day_out_of_scope" });
      expect(calculation).toEqual([]);
      expect(await reservationFootprint()).toEqual(before);
    });

    it("refuses before any calculation while the scheduling zone is unconfirmed", async () => {
      const target = await publishConstrained();
      await rows("UPDATE users SET timezone_source = 'default_unconfirmed' WHERE id = ?", USER_A);
      const calculation = watchCalculation();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "timezone_confirmation_required" });
      expect(calculation).toEqual([]);
    });

    it("never hands the corrected edition back to the model as a prior reading", async () => {
      await publishConstrained(YESTERDAY);
      const target = await publishConstrained(TODAY);

      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction"),
        NOW,
      );

      expect(outcome).toMatchObject({ ok: true });
      if (!outcome.ok) throw new Error("unreachable");
      const command = await frozenCommand(outcome.successor.jobId);
      if (command.command_version !== "v2") throw new Error("expected a V2 command");
      expect(command.prior_readings.map((reading) => reading.local_date)).toEqual([YESTERDAY]);
    });
  });

  describe("replay, conflict, and concurrency", () => {
    it("replays an identical request as the one successor, freezing nothing new", async () => {
      const target = await publishConstrained();
      const body = request(target, "constrained_model", "safety_correction");
      const first = await reissuePublishedEdition(v5Env(), body, NOW);
      if (!first.ok) throw new Error(`first reissue failed: ${first.reason}`);
      const footprint = await reservationFootprint();
      const frozen = await frozenCommand(first.successor.jobId);

      const second = await reissuePublishedEdition(v5Env(), body, NOW);

      expect(second).toEqual({ ...first, status: "replayed" });
      expect(await reservationFootprint()).toEqual(footprint);
      expect(await frozenCommand(first.successor.jobId)).toEqual(frozen);
      expect(await successorsOf(target)).toHaveLength(1);
    });

    it("refuses a different reason for the same edition as a conflict", async () => {
      const target = await publishConstrained();
      const first = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction"),
        NOW,
      );
      expect(first).toMatchObject({ ok: true });
      const footprint = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "defect_repair"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "reissue_conflict" });
      expect(await reservationFootprint()).toEqual(footprint);
    });

    it("refuses to adopt a fact-repair successor as a replay", async () => {
      const target = await publishConstrained();
      await invalidatePublishedReading(env, {
        identity: IDENTITY_A,
        readingId: target,
        reason: "calculation_defect",
        now: NOW,
      });
      // The repair records defect_repair as well; only its frozen reservation
      // reason says it is not an ordinary reissue of this edition.
      const repair = await reserveFactRepair(v5Env(), target, NOW);
      expect(repair).toMatchObject({ ok: true });
      const footprint = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "defect_repair"),
          NOW,
        ),
      ).toMatchObject({ ok: false, reason: "reissue_conflict" });
      expect(await reservationFootprint()).toEqual(footprint);
    });

    it("converges two concurrent identical requests on one successor", async () => {
      const target = await publishConstrained();
      const before = await reservationFootprint();
      // Hold both requests at their last calculation call so that each has
      // passed every read-time check before either reservation commits.
      const waiting: Array<() => void> = [];
      watchCalculation(async (path) => {
        if (!path.endsWith("/v1/daily-sky")) return;
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length === 2) for (const release of waiting.splice(0)) release();
          else setTimeout(resolve, 5_000);
        });
      });
      const body = request(target, "constrained_model", "safety_correction");

      const outcomes = await Promise.all([
        reissuePublishedEdition(v5Env(), body, NOW),
        reissuePublishedEdition(v5Env(), body, NOW),
      ]);

      expect(outcomes.map((outcome) => outcome.ok && outcome.status).sort()).toEqual([
        "replayed",
        "reserved",
      ]);
      const ids = new Set(outcomes.map((outcome) => outcome.ok && outcome.successor.readingId));
      expect(ids.size).toBe(1);
      expect(await successorsOf(target)).toHaveLength(1);
      expect(await reservationFootprint()).toEqual({
        jobs: before.jobs + 1,
        providerJobs: before.providerJobs,
        readings: before.readings + 1,
      });
    });

    it("lets exactly one of two concurrent conflicting requests reserve", async () => {
      const target = await publishConstrained();
      const waiting: Array<() => void> = [];
      watchCalculation(async (path) => {
        if (!path.endsWith("/v1/daily-sky")) return;
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length === 2) for (const release of waiting.splice(0)) release();
          else setTimeout(resolve, 5_000);
        });
      });

      const outcomes = await Promise.all([
        reissuePublishedEdition(v5Env(), request(target, "constrained_model", "safety_correction"), NOW),
        reissuePublishedEdition(v5Env(), request(target, "constrained_model", "defect_repair"), NOW),
      ]);

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({ reason: "reissue_conflict" });
      expect(await successorsOf(target)).toHaveLength(1);
    });
  });

  describe("publication and ceilings", () => {
    it("keeps the edition published until the successor's publication supersedes it", async () => {
      const target = await publishConstrained();
      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction"),
        NOW,
      );
      if (!outcome.ok) throw new Error(`reissue failed: ${outcome.reason}`);
      expect(await statusOf(target)).toBe("published");

      expect(await runConstrained(outcome.successor.jobId)).toMatchObject({
        ok: true,
        readingId: outcome.successor.readingId,
      });

      expect(await statusOf(target)).toBe("superseded");
      expect(await statusOf(outcome.successor.readingId)).toBe("published");
      const stored = await storedReading(outcome.successor.readingId);
      expect(stored.reading).toMatchObject({ revision: 2, assembly_mode: "constrained_model" });
      expect(stored.evidence_header).toMatchObject({ revision: 2, revision_reason: "safety_correction" });
      expect(
        await rows(
          "SELECT job_id FROM daily_publication_receipts WHERE reading_id = ?",
          outcome.successor.readingId,
        ),
      ).toEqual([{ job_id: outcome.successor.jobId }]);

      // A replay after publication reports it and freezes nothing.
      const footprint = await reservationFootprint();
      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({
        ok: true,
        status: "replayed",
        successor: { readingId: outcome.successor.readingId, status: "published" },
      });
      expect(await reservationFootprint()).toEqual(footprint);
    });

    it("publishes a deterministic successor through the V1 executor with no receipt", async () => {
      await seedActiveRelease();
      const target = await publishDeterministic();
      const outcome = await reissuePublishedEdition(
        quietEnv(),
        request(target, "deterministic", "defect_repair"),
        NOW,
      );
      if (!outcome.ok) throw new Error(`reissue failed: ${outcome.reason}`);

      await deliver({ job_id: outcome.successor.jobId, reading_id: outcome.successor.readingId });

      expect(await statusOf(target)).toBe("superseded");
      expect(await statusOf(outcome.successor.readingId)).toBe("published");
      expect(
        await rows("SELECT job_id FROM daily_publication_receipts WHERE reading_id = ?", outcome.successor.readingId),
      ).toEqual([]);
    });

    it("leaves the edition published when the successor fails, and never re-freezes it on replay", async () => {
      const target = await publishConstrained();
      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "safety_correction"),
        NOW,
      );
      if (!outcome.ok) throw new Error(`reissue failed: ${outcome.reason}`);
      const claim = await claimJob(v5Env(), outcome.successor.jobId);
      if (!claim) throw new Error("successor did not claim");
      expect(
        await failReading(
          env,
          IDENTITY_A,
          outcome.successor.readingId,
          outcome.successor.jobId,
          claim.claimToken,
          "publisher_refused",
        ),
      ).toEqual({ ok: true });
      expect(await statusOf(target)).toBe("published");
      const footprint = await reservationFootprint();

      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({
        ok: true,
        status: "replayed",
        successor: { readingId: outcome.successor.readingId, status: "failed", jobId: outcome.successor.jobId },
      });
      expect(await reservationFootprint()).toEqual(footprint);

      // Recovery is the bounded replacement path's decision, and the successor's
      // identity survives it even though the replacement records its own reason.
      const replaced = await replaceFailedCommand(
        v5Env(),
        USER_A,
        outcome.successor.readingId,
        "publisher_refused",
        "scheduler",
        NOW,
      );
      if (!replaced.ok) throw new Error(`replacement failed: ${replaced.reason}`);
      expect(await frozenCommand(replaced.jobId)).toMatchObject({
        command_generation: 2,
        reservation_reason: "automatic_replacement",
      });
      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction"),
          NOW,
        ),
      ).toMatchObject({
        ok: true,
        status: "replayed",
        successor: { readingId: outcome.successor.readingId, status: "pending", jobId: replaced.jobId },
      });
    });

    it("cannot publish over an edition invalidated after the reservation", async () => {
      const target = await publishConstrained();
      const outcome = await reissuePublishedEdition(
        v5Env(),
        request(target, "constrained_model", "defect_repair"),
        NOW,
      );
      if (!outcome.ok) throw new Error(`reissue failed: ${outcome.reason}`);
      await invalidatePublishedReading(env, {
        identity: IDENTITY_A,
        readingId: target,
        reason: "calculation_defect",
        now: NOW,
      });

      await expect(runConstrained(outcome.successor.jobId)).rejects.toThrow(
        "V5 publication transaction did not commit",
      );

      expect(await statusOf(target)).toBe("invalidated");
      expect(await statusOf(outcome.successor.readingId)).toBe("pending");
      expect(
        await rows("SELECT job_id FROM daily_publication_receipts WHERE reading_id = ?", outcome.successor.readingId),
      ).toEqual([]);
    });
  });

  describe("the legacy operation", () => {
    it("still freezes a deterministic successor whatever the edition's family", async () => {
      // Preserved on purpose until an intentional migration: this is the gap
      // the family-aware route exists to close, not behaviour it endorses.
      await seedActiveRelease();
      const at = new Date();
      const today = resolveV5TargetDate(ZONE, at)!;
      const target = await publishConstrained(today, at);

      const legacy = await app.request(
        "/internal/readings/reissue",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: USER_A,
            expected_live_reading_id: target,
            revision_reason: "safety_correction",
          }),
        },
        quietEnv(),
      );
      expect(legacy.status).toBe(202);
      const [successor] = await successorsOf(target);
      expect(successor).toMatchObject({ assembly_mode: "deterministic", revision: 2 });

      // The family-aware route will not adopt a successor of another family.
      expect(
        await reissuePublishedEdition(
          v5Env(),
          request(target, "constrained_model", "safety_correction", { local_date: today }),
          at,
        ),
      ).toMatchObject({ ok: false, reason: "reissue_conflict" });
    });

    it("answers a legacy deterministic successor with the same reason as the same reissue", async () => {
      await seedActiveRelease();
      const at = new Date();
      const today = resolveV5TargetDate(ZONE, at)!;
      const target = await publishDeterministic(at);
      const legacy = await app.request(
        "/internal/readings/reissue",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: USER_A,
            expected_live_reading_id: target,
            revision_reason: "defect_repair",
          }),
        },
        quietEnv(),
      );
      expect(legacy.status).toBe(202);
      const footprint = await reservationFootprint();

      // A deterministic command records no reservation reason, so an identical
      // legacy successor is indistinguishable from this operation's own.
      expect(
        await reissuePublishedEdition(
          quietEnv(),
          request(target, "deterministic", "defect_repair", { local_date: today }),
          at,
        ),
      ).toMatchObject({ ok: true, status: "replayed", successor: { revision: 2 } });
      expect(
        await reissuePublishedEdition(
          quietEnv(),
          request(target, "deterministic", "safety_correction", { local_date: today }),
          at,
        ),
      ).toMatchObject({ ok: false, reason: "reissue_conflict" });
      expect(await reservationFootprint()).toEqual(footprint);
    });
  });
});

describe("POST /internal/readings/edition-reissue", () => {
  // The route resolves its own clock, so these editions are dated today.
  let at: Date;
  let today: string;
  beforeEach(async () => {
    await seedAccount();
    at = new Date();
    today = resolveV5TargetDate(ZONE, at)!;
  });

  async function post(
    body: unknown,
    options: { env?: typeof env; authorization?: string } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.authorization) headers.authorization = options.authorization;
    const response = await app.request(
      "/internal/readings/edition-reissue",
      { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) },
      options.env ?? v5Env(),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  it("answers the contract shapes for reserve, replay, and refusal", async () => {
    const target = await publishConstrained(today, at);
    const body = request(target, "constrained_model", "safety_correction", { local_date: today });

    const reserved = await post(body);
    expect(reserved.status).toBe(202);
    expect(validateAccepted(reserved.json)).toBe(true);
    expect(reserved.json).toMatchObject({
      schema_version: "daily-edition-reissue/v1",
      status: "reserved",
      target: body.target,
      successor: { revision: 2, revision_reason: "safety_correction", status: "pending" },
      dispatched: true,
    });

    const replayed = await post(body);
    expect(replayed.status).toBe(200);
    expect(validateAccepted(replayed.json)).toBe(true);
    expect(replayed.json).toEqual({ ...reserved.json, status: "replayed" });

    const refused = await post(
      request(target, "deterministic", "safety_correction", { local_date: today }),
    );
    expect(refused.status).toBe(409);
    expect(validateError(refused.json)).toBe(true);
    expect(refused.json).toMatchObject({
      error: { code: "family_mismatch", message: EDITION_REISSUE_MESSAGES.family_mismatch },
    });
  });

  it.each([
    ["the legacy body", { user_id: USER_A, expected_live_reading_id: "rdg_legacy_0001", revision_reason: "safety_correction" }],
    ["a constrained-model consent revocation", { ...request("rdg_body_0001", "constrained_model", "safety_correction"), revision_reason: "consent_revoked" }],
    ["an unknown key", { ...request("rdg_body_0001", "deterministic", "safety_correction"), force: true }],
    ["an initial revision reason", { ...request("rdg_body_0001", "deterministic", "safety_correction"), revision_reason: "initial" }],
    ["an impossible date", request("rdg_body_0001", "deterministic", "safety_correction", { local_date: "2026-02-30" })],
    ["a non-object body", "[]"],
    ["malformed JSON", "{"],
  ])("rejects %s before reading any state", async (_label, body) => {
    const before = await reservationFootprint();
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(validateError(response.json)).toBe(true);
    expect(response.json).toMatchObject({ error: { code: "invalid_body" } });
    expect(await reservationFootprint()).toEqual(before);
  });

  it("requires the service token when one is configured", async () => {
    const target = await publishConstrained(today, at);
    const body = request(target, "constrained_model", "safety_correction", { local_date: today });
    const guarded = v5Env({ SERVICE_AUTH_TOKEN: "edition-reissue-service-token-0001" });

    const anonymous = await post(body, { env: guarded });
    expect(anonymous.status).toBe(401);
    expect(await successorsOf(target)).toEqual([]);

    const authorized = await post(body, {
      env: guarded,
      authorization: "Bearer edition-reissue-service-token-0001",
    });
    expect(authorized.status).toBe(202);
  });

  it("answers a commit failure with a fixed message and no D1 detail", async () => {
    const target = await publishConstrained(today, at);
    await rows("ALTER TABLE audit_events RENAME TO audit_events_unavailable");
    try {
      const response = await post(
        request(target, "constrained_model", "safety_correction", { local_date: today }),
      );
      expect(response.status).toBe(424);
      expect(validateError(response.json)).toBe(true);
      expect(response.json).toMatchObject({
        error: { code: "conflict", message: EDITION_REISSUE_MESSAGES.conflict },
      });
      expect(JSON.stringify(response.json)).not.toContain("audit_events");
    } finally {
      await rows("ALTER TABLE audit_events_unavailable RENAME TO audit_events");
    }
    expect(await successorsOf(target)).toEqual([]);
  });

  it("answers exactly the contract's refusal vocabulary, each with a bounded fixed message", () => {
    const contract = [...editionReissueContract.$defs.operationErrorCode.enum].sort();
    expect(Object.keys(EDITION_REISSUE_STATUS).sort()).toEqual(contract);
    expect(Object.keys(EDITION_REISSUE_MESSAGES).sort()).toEqual(contract);
    for (const [code, message] of Object.entries(EDITION_REISSUE_MESSAGES)) {
      expect(validateError({ error: { code, message, request_id: null } })).toBe(true);
    }
  });
});
