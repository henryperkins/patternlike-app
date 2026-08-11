import { env, SELF, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3DailyReading from "../../../../contracts/m3/daily-reading.schema.json";
import m3ReadingEvidence from "../../../../contracts/m3/reading-evidence.schema.json";
import m5Common from "../../../../contracts/m5/common.schema.json";
import m5DailyReading from "../../../../contracts/m5/daily-reading.schema.json";
import m5ReadingEvidence from "../../../../contracts/m5/reading-evidence.schema.json";
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
} from "../../test/helpers.js";
import {
  CYCLE_FP_EMPTY,
  CYCLE_FP_REFUSED,
  CYCLE_FP_UNAVAILABLE,
} from "../../test/mock-calc-service.js";
import { encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import { localDateIn } from "../services/local-day.js";
import { loadPublishedReadingForDate } from "../db/readings.js";
import {
  enqueueConstrainedReading,
  enqueueDailyReading,
  enqueueReissue,
  type GenerationMessage,
} from "../services/enqueue.js";
import type { StoredReading } from "../services/generate-daily-reading.js";
import {
  invalidatePublishedReading,
  reconcileCurrentFactRepair,
} from "../services/reading-invalidation.js";
import { AI_SYNTHESIS_POLICY_VERSION } from "../db/consents.js";
import { OPENAI_READING_MODEL } from "../services/reading-publisher.js";

const QUEUE = "patternlike-daily-readings-dev";
const ZONE = "America/Chicago";

/**
 * The frozen contract, applied to what the routes actually emit.
 *
 * `contracts/validate_schemas.py` proves the fixtures conform. Nothing proved
 * that a response assembled from a decrypted artifact does — and both response
 * schemas are `additionalProperties: false`, so this is what makes the explicit
 * projection in `routes/readings.ts` load-bearing rather than a discipline
 * nobody checks.
 */
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
for (const schema of [
  m0Common,
  m3Common,
  m3DailyReading,
  m3ReadingEvidence,
  m5Common,
  m5DailyReading,
  m5ReadingEvidence,
]) {
  ajv.addSchema(schema);
}
const validateTodayResponse = ajv.getSchema(
  `${m3DailyReading.$id}#/$defs/dailyReadingResponse`,
)!;
const validateEvidenceGraph = ajv.getSchema(
  `${m3ReadingEvidence.$id}#/$defs/readingEvidenceGraph`,
)!;
const validateTodayResponseV5 = ajv.getSchema(
  `${m5DailyReading.$id}#/$defs/dailyReadingResponseV5`,
)!;
const validateEvidenceGraphV5 = ajv.getSchema(
  `${m5ReadingEvidence.$id}#/$defs/readingEvidenceGraphV5`,
)!;

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string | null;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

/** Declared here rather than imported: the point is to assert the wire shape. */
interface TodayBody {
  schema_version: string;
  reading: {
    schema_version: string;
    output_schema: string;
    reading_id: string;
    local_date: string;
    generated_at: string;
    assembly_mode: string;
    revision: number;
    locale: string;
    domain_preference: string | null;
    fallback_used: boolean;
    paragraphs: Array<{ paragraph_id: string; role: string; order: number; text: string }>;
  };
  evidence_url: string | null;
}

interface PreparationBody {
  schema_version: string;
  status: "preparing";
  local_date: string;
}

interface EvidenceBody {
  schema_version: string;
  reading_id: string;
  reading_key: string;
  user_id: string;
  assembly_id: string;
  revision: number;
  revision_reason: string;
  supersedes_reading_id: string | null;
  validation: { passed: boolean };
  paragraphs: Array<{ paragraph_id: string; role: string; order: number }>;
}

async function get<T = unknown>(path: string, userId: string | null = USER_A) {
  const res = await SELF.fetch(`http://api.test${path}`, {
    headers: userId ? { "x-user-id": userId } : {},
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function putToday<T = unknown>(userId: string | null = USER_A) {
  const res = await SELF.fetch("http://api.test/v1/readings/today", {
    method: "PUT",
    headers: userId ? { "x-user-id": userId } : {},
  });
  return { status: res.status, body: (await res.json()) as T };
}

function enabledEnv(
  overrides: Partial<typeof env> = {},
): typeof env {
  return {
    ...env,
    READING_V5_ROLLOUT: "first_open",
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
    ...overrides,
  };
}

async function putTodayWithEnv<T = unknown>(
  requestEnv: typeof env,
  userId = USER_A,
) {
  const response = await app.request(
    "/v1/readings/today",
    { method: "PUT", headers: { "x-user-id": userId } },
    requestEnv,
  );
  return { status: response.status, body: (await response.json()) as T };
}

async function getTodayWithEnv<T = unknown>(requestEnv: typeof env, userId = USER_A) {
  const response = await app.request(
    "/v1/readings/today",
    { headers: { "x-user-id": userId } },
    requestEnv,
  );
  return { status: response.status, body: (await response.json()) as T };
}

async function grantAiSynthesis(userId = USER_A, suffix = "route") {
  const now = new Date().toISOString();
  await rows(
    `INSERT INTO consents
       (id, user_id, kind, status, policy_version, allowed_uses_json,
        scopes_json, granted_at, version, created_at, updated_at)
     VALUES (?, ?, 'ai_synthesis', 'granted', ?, '[]', '[]', ?, 1, ?, ?)`,
    `cns_ai_synthesis_${suffix}`,
    userId,
    AI_SYNTHESIS_POLICY_VERSION,
    now,
    now,
    now,
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

/** Enqueue and deliver in one step, returning the reserved reading id. */
async function publish(userId: string, now?: Date): Promise<string> {
  const enqueued = await enqueueDailyReading(env, userId, now);
  if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason} ${enqueued.detail}`);
  await deliver([{ job_id: enqueued.jobId, reading_id: enqueued.readingId }]);
  return enqueued.readingId;
}

const PHASES = ["emerging", "building", "peak", "reconsidering", "integrating"] as const;

/**
 * A release that can speak about the mock scanner's encounter on any date.
 *
 * The contract fixture ships exactly one phase fragment — `building` — while the
 * mock's saturn/square/sun encounter runs from 2026-07-19 to 2027-01-26 and
 * moves through phases as the wall clock advances. Seeding only the fixture
 * makes every reading a safety fallback outside the fortnight before the first
 * exact pass, which would leave the multi-paragraph shape these routes exist to
 * serve untested on almost every run date.
 */
async function seedReleaseForAnyPhase() {
  return seedActiveRelease("release-12", (bundle) => {
    const template = bundle.objects.phases[0]!;
    bundle.objects.phases = PHASES.map((phase) => ({
      ...template,
      id: `phase.saturn-square-sun.${phase}`,
      phase,
      title: `Saturn square Sun - ${phase}`,
    }));
    bundle.objects.cycles[0]!.phase_ids = bundle.objects.phases.map((entry) => entry.id);
  });
}

async function seedBoth() {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
  await confirmPreferences(USER_A, ZONE);
  await confirmPreferences(USER_B, ZONE);
  await seedChart(IDENTITY_A);
  await seedChart(IDENTITY_B);
  return seedReleaseForAnyPhase();
}

/** The route resolves today itself; assert against the same helper it uses. */
const today = () => localDateIn(ZONE, new Date());

describe("PUT /v1/readings/today", () => {
  beforeEach(seedBoth);

  it("returns an existing published reading through the same wire projection", async () => {
    const readingId = await publish(USER_A);

    const { status, body } = await putToday<TodayBody>();

    expect(status).toBe(200);
    expect(body.reading.reading_id).toBe(readingId);
    expect(validateTodayResponse(body)).toBe(true);
    expect(validateTodayResponse.errors ?? []).toEqual([]);
  });

  it("reserves an absent day only as V2 and returns the V5 preparation contract", async () => {
    await grantAiSynthesis();
    const requestEnv = enabledEnv();
    const { status, body } = await putTodayWithEnv<PreparationBody>(requestEnv);

    expect(status).toBe(202);
    expect(body).toEqual({
      schema_version: "0.5.0",
      status: "preparing",
      local_date: today(),
    });

    const [counts] = await rows<{
      reading_count: number;
      job_count: number;
      release_count: number;
      constrained_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ?) AS reading_count,
         (SELECT COUNT(*) FROM jobs WHERE user_id = ? AND job_type = 'generate_daily_reading') AS job_count,
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ? AND release_version IS NOT NULL) AS release_count,
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ? AND assembly_mode = 'constrained_model') AS constrained_count`,
      USER_A,
      USER_A,
      USER_A,
      USER_A,
    );
    expect(counts).toEqual({
      reading_count: 1,
      job_count: 1,
      release_count: 0,
      constrained_count: 1,
    });
  });

  it("converges repeated and concurrent PUTs on one reservation and job", async () => {
    await grantAiSynthesis();
    const requestEnv = enabledEnv();
    const responses = await Promise.all([
      putTodayWithEnv(requestEnv),
      putTodayWithEnv(requestEnv),
      putTodayWithEnv(requestEnv),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    const [counts] = await rows<{ reading_count: number; job_count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ?) AS reading_count,
         (SELECT COUNT(*) FROM jobs WHERE user_id = ? AND job_type = 'generate_daily_reading') AS job_count`,
      USER_A,
      USER_A,
    );
    expect(counts).toEqual({ reading_count: 1, job_count: 1 });
  });

  it("does not consult an active release or R2 on the V2 public path", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedChart(IDENTITY_A);
    await grantAiSynthesis();

    const { status, body } = await putTodayWithEnv<PreparationBody>(enabledEnv());

    expect(status).toBe(202);
    expect(body.schema_version).toBe("0.5.0");
    expect(
      await rows(
        "SELECT assembly_mode, release_version FROM daily_readings WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ assembly_mode: "constrained_model", release_version: null }]);
  });

  it("keeps chart and preference setup gates actionable and time-zone-first", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedActiveRelease();

    expect(await putToday<ErrorEnvelope>()).toMatchObject({
      status: 404,
      body: { error: { code: "chart_not_found" } },
    });

    await seedChart(IDENTITY_A);
    await rows(
      `UPDATE users
       SET timezone_source = 'default_unconfirmed', locale_source = 'default_unconfirmed'
       WHERE id = ?`,
      USER_A,
    );
    expect(await putToday<ErrorEnvelope>()).toMatchObject({
      status: 409,
      body: { error: { code: "timezone_confirmation_required" } },
    });

    await rows(
      `UPDATE users SET timezone_source = 'user_confirmed' WHERE id = ?`,
      USER_A,
    );
    expect(await putToday<ErrorEnvelope>()).toMatchObject({
      status: 409,
      body: { error: { code: "locale_confirmation_required" } },
    });
  });

  it("requires authentication", async () => {
    const { status, body } = await putToday<ErrorEnvelope>(null);

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns a reader-safe terminal failure without stored generation detail", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error(`enqueue failed: ${enqueued.reason}`);
    await rows(
      `UPDATE daily_readings SET status = 'failed' WHERE id = ?`,
      enqueued.readingId,
    );
    await rows(
      `UPDATE jobs
       SET status = 'failed', result_class = 'payload_undecryptable'
       WHERE id = ?`,
      enqueued.jobId,
    );

    const { status, body } = await putToday<ErrorEnvelope>();
    const serialized = JSON.stringify(body);

    expect(status).toBe(424);
    expect(body.error).toMatchObject({
      code: "reading_generation_failed",
      message: "Today's reading could not be prepared",
      request_id: expect.any(String),
    });
    for (const privateValue of [
      "payload_undecryptable",
      enqueued.jobId,
      enqueued.readingId,
      USER_A,
      "release-12",
      "reading_key",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});

describe("V5 Today rollout and status projection", () => {
  async function seedV5Ready(options: { fingerprint?: string } = {}) {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedChart(IDENTITY_A, { fingerprint: options.fingerprint });
    await grantAiSynthesis();
  }

  function capturedEnv(mode: "off" | "internal" | "first_open" | "hybrid") {
    const messages: GenerationMessage[] = [];
    return {
      messages,
      requestEnv: enabledEnv({
        READING_V5_ROLLOUT: mode,
        READING_QUEUE: {
          send: async (message: GenerationMessage) => {
            messages.push(message);
          },
        } as unknown as typeof env.READING_QUEUE,
      }),
    };
  }

  it("enforces off/internal/first_open/hybrid without a V1 or release fallback", async () => {
    for (const mode of ["off", "internal"] as const) {
      await seedV5Ready();
      const { requestEnv, messages } = capturedEnv(mode);
      const blocked = await putTodayWithEnv<ErrorEnvelope>(requestEnv);
      expect(blocked).toMatchObject({
        status: 503,
        body: {
          error: { code: "publisher_not_configured", retryable: false },
        },
      });
      expect(messages).toEqual([]);
      expect(
        await rows(
          "SELECT id FROM jobs WHERE user_id = ? AND job_type = 'generate_daily_reading'",
          USER_A,
        ),
      ).toEqual([]);
      expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toEqual([]);
    }

    for (const mode of ["first_open", "hybrid"] as const) {
      await seedV5Ready();
      const { requestEnv, messages } = capturedEnv(mode);
      const accepted = await putTodayWithEnv<PreparationBody>(requestEnv);
      expect(accepted).toMatchObject({
        status: 202,
        body: { schema_version: "0.5.0", status: "preparing" },
      });
      expect(messages).toHaveLength(1);
      expect(
        await rows(
          "SELECT assembly_mode, release_version FROM daily_readings WHERE user_id = ?",
          USER_A,
        ),
      ).toEqual([{ assembly_mode: "constrained_model", release_version: null }]);
    }
  });

  it("keeps GET read-only with zero reservation or enqueue in every rollout mode", async () => {
    for (const mode of ["off", "internal", "first_open", "hybrid"] as const) {
      await seedV5Ready();
      const { requestEnv, messages } = capturedEnv(mode);
      const response = await getTodayWithEnv<ErrorEnvelope>(requestEnv);
      expect(response).toMatchObject({
        status: 404,
        body: { error: { code: "reading_not_generated" } },
      });
      expect(messages).toEqual([]);
      expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toEqual([]);
      expect(
        await rows(
          "SELECT id FROM jobs WHERE user_id = ? AND job_type = 'generate_daily_reading'",
          USER_A,
        ),
      ).toEqual([]);
    }
  });

  it("maps missing consent and deterministic/transient pre-command failures safely", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedChart(IDENTITY_A);
    expect(await putTodayWithEnv<ErrorEnvelope>(enabledEnv())).toMatchObject({
      status: 409,
      body: { error: { code: "ai_synthesis_consent_required" } },
    });

    await seedV5Ready({ fingerprint: CYCLE_FP_UNAVAILABLE });
    expect(await putTodayWithEnv<ErrorEnvelope>(enabledEnv())).toMatchObject({
      status: 503,
      body: { error: { code: "calc_unavailable", retryable: true } },
    });

    await seedV5Ready({ fingerprint: CYCLE_FP_REFUSED });
    expect(await putTodayWithEnv<ErrorEnvelope>(enabledEnv())).toMatchObject({
      status: 503,
      body: { error: { code: "policy_unsupported", retryable: false } },
    });

    await seedV5Ready();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/v1/daily-sky")) {
        return new Response(
          JSON.stringify({ error: { code: "unavailable", message: "safe fixture" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      expect(await putTodayWithEnv<ErrorEnvelope>(enabledEnv())).toMatchObject({
        status: 503,
        body: { error: { code: "daily_sky_unavailable", retryable: true } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("projects queued/running as V5 preparation and terminal command states without internals", async () => {
    await seedV5Ready();
    const { requestEnv } = capturedEnv("first_open");
    const enqueued = await enqueueConstrainedReading(requestEnv, USER_A, {
      entry: "first_open",
      reservationReason: "first_open",
      targetLocalDate: today(),
    });
    if (!enqueued.ok) throw new Error(`V5 enqueue failed: ${enqueued.reason}`);

    expect(await putTodayWithEnv<PreparationBody>(requestEnv)).toMatchObject({
      status: 202,
      body: { schema_version: "0.5.0", status: "preparing" },
    });
    await rows(
      `UPDATE jobs SET status = 'running', claim_token = 'claim-status-test',
                       lease_expires_at = ? WHERE id = ?`,
      new Date(Date.now() + 60_000).toISOString(),
      enqueued.jobId,
    );
    expect(await putTodayWithEnv<PreparationBody>(requestEnv)).toMatchObject({
      status: 202,
      body: { schema_version: "0.5.0", status: "preparing" },
    });

    for (const testCase of [
      {
        code: "generation_input_id_mismatch",
        generation: 1,
        status: 424,
        wire: "reading_generation_failed",
        retryable: false,
      },
      {
        code: "publisher_unavailable",
        generation: 3,
        status: 424,
        wire: "reading_generation_failed",
        retryable: false,
      },
      {
        code: "publisher_budget_exhausted",
        generation: 1,
        status: 503,
        wire: "publisher_budget_exhausted",
        retryable: false,
      },
    ] as const) {
      await rows(
        `UPDATE daily_readings SET status = 'failed', command_generation = ? WHERE id = ?`,
        testCase.generation,
        enqueued.readingId,
      );
      await rows(
        `UPDATE jobs SET status = 'failed', result_class = ?, claim_token = NULL,
                         lease_expires_at = NULL WHERE id = ?`,
        testCase.code,
        enqueued.jobId,
      );
      const response = await putTodayWithEnv<ErrorEnvelope>(requestEnv);
      expect(response.status).toBe(testCase.status);
      expect(response.body.error).toMatchObject({
        code: testCase.wire,
        retryable: testCase.retryable,
        request_id: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toContain(enqueued.jobId);
    }
  });

  it("owner-scoped PUT redrives only an undispatched or expired pending job", async () => {
    await seedV5Ready();
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B, ZONE);
    await seedChart(IDENTITY_B);
    await grantAiSynthesis(USER_B, "owner-b");
    const { requestEnv, messages } = capturedEnv("first_open");
    const alice = await enqueueConstrainedReading(requestEnv, USER_A, {
      entry: "first_open",
      reservationReason: "first_open",
      targetLocalDate: today(),
    });
    const bob = await enqueueConstrainedReading(requestEnv, USER_B, {
      entry: "first_open",
      reservationReason: "first_open",
      targetLocalDate: today(),
    });
    if (!alice.ok || !bob.ok) throw new Error("owner recovery setup failed");
    messages.length = 0;
    await rows("UPDATE jobs SET dispatched_at = NULL WHERE id IN (?, ?)", alice.jobId, bob.jobId);

    expect((await putTodayWithEnv(requestEnv, USER_A)).status).toBe(202);
    expect(messages).toEqual([{ job_id: alice.jobId, reading_id: alice.readingId }]);

    messages.length = 0;
    await rows(
      `UPDATE jobs SET status = 'running', claim_token = 'expired-owner-claim',
                       lease_expires_at = ?, dispatched_at = ? WHERE id = ?`,
      new Date(Date.now() - 1_000).toISOString(),
      new Date().toISOString(),
      alice.jobId,
    );
    expect((await putTodayWithEnv(requestEnv, USER_A)).status).toBe(202);
    expect(messages).toEqual([{ job_id: alice.jobId, reading_id: alice.readingId }]);
    expect(
      await rows("SELECT dispatched_at FROM jobs WHERE id = ?", bob.jobId),
    ).toEqual([{ dispatched_at: null }]);
  });
});

describe("GET /v1/readings/today", () => {
  beforeEach(seedBoth);

  it("serves the published reading for the caller's local date", async () => {
    const readingId = await publish(USER_A);

    const { status, body } = await get<TodayBody>("/v1/readings/today");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      schema_version: "0.3.0",
      evidence_url: `/v1/readings/${readingId}/evidence`,
    });
    expect(body.reading).toMatchObject({
      output_schema: "daily-reading-v3",
      assembly_mode: "deterministic",
      reading_id: readingId,
      local_date: today(),
      revision: 1,
      locale: "en-US",
      fallback_used: false,
    });
    expect(body.reading.paragraphs.length).toBeGreaterThan(0);
    for (const [index, paragraph] of body.reading.paragraphs.entries()) {
      expect(paragraph.order).toBe(index + 1);
      expect(paragraph.text.length).toBeGreaterThan(0);
    }
  });

  it("keeps an immutable V3 reading readable after the active chart changes", async () => {
    const readingId = await publish(USER_A);
    const [before] = await rows<{
      reading_enc: ArrayBuffer;
      reading_key_version: number;
      reading_nonce: string;
    }>(
      `SELECT reading_enc, reading_key_version, reading_nonce
       FROM daily_readings WHERE id = ? AND user_id = ?`,
      readingId,
      USER_A,
    );

    await rows(
      `UPDATE chart_snapshots SET fingerprint = ?
       WHERE user_id = ? AND status = 'active'`,
      `sha256:${"9c".repeat(32)}`,
      USER_A,
    );
    expect(
      await invalidatePublishedReading(env, {
        identity: IDENTITY_A,
        readingId,
        reason: "chart_correction",
        now: new Date("2026-08-10T15:00:00.000Z"),
      }),
    ).toMatchObject({ ok: false, reason: "not_supported" });
    expect(
      await reconcileCurrentFactRepair(env, IDENTITY_A, "chart_correction", new Date()),
    ).toEqual({ ok: true, status: "current" });
    expect(
      await rows(
        "SELECT id FROM daily_readings WHERE supersedes_reading_id = ?",
        readingId,
      ),
    ).toEqual([]);

    const { status, body } = await get<TodayBody>("/v1/readings/today");
    expect(status).toBe(200);
    expect(body.reading).toMatchObject({
      output_schema: "daily-reading-v3",
      assembly_mode: "deterministic",
      reading_id: readingId,
    });

    const [after] = await rows<{
      reading_enc: ArrayBuffer;
      reading_key_version: number;
      reading_nonce: string;
    }>(
      `SELECT reading_enc, reading_key_version, reading_nonce
       FROM daily_readings WHERE id = ? AND user_id = ?`,
      readingId,
      USER_A,
    );
    expect(new Uint8Array(after!.reading_enc)).toEqual(new Uint8Array(before!.reading_enc));
    expect(after!.reading_key_version).toBe(before!.reading_key_version);
    expect(after!.reading_nonce).toBe(before!.reading_nonce);
  });

  it("conforms to the frozen daily-reading response schema", async () => {
    await publish(USER_A);
    const { body } = await get("/v1/readings/today");

    expect(validateTodayResponse(body)).toBe(true);
    expect(validateTodayResponse.errors ?? []).toEqual([]);
  });

  it("never puts reading_key or the raw user id on the wire", async () => {
    await publish(USER_A);
    const { body } = await get<TodayBody>("/v1/readings/today");

    expect(body).not.toHaveProperty("reading_key");
    expect(body.reading).not.toHaveProperty("reading_key");
    // reading_key is `user:<user_id>:...`, so the raw application user id is the
    // fingerprint of a leak anywhere in the tree — including inside a paragraph.
    expect(JSON.stringify(body)).not.toContain(USER_A);
  });

  it("serves a fallback reading as the whole reading", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_EMPTY });
    await seedActiveRelease();
    await publish(USER_A);

    const { status, body } = await get<TodayBody>("/v1/readings/today");
    expect(status).toBe(200);
    expect(body.reading.fallback_used).toBe(true);
    expect(body.reading.paragraphs).toHaveLength(1);
    expect(body.reading.paragraphs[0].role).toBe("safety_fallback");
    expect(validateTodayResponse(body)).toBe(true);
  });

  it("requires authentication", async () => {
    await publish(USER_A);
    const { status, body } = await get("/v1/readings/today", null);
    expect(status).toBe(401);
    expect((body as ErrorEnvelope).error.code).toBe("unauthorized");
  });

  it("answers reading_not_generated when nothing has been published", async () => {
    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    const envelope = body as ErrorEnvelope;
    expect(envelope.error.code).toBe("reading_not_generated");
    expect(envelope.error.request_id).toBeTruthy();
    // The client's only honest copy needs the date it is being told to wait for.
    expect(envelope.error.details).toEqual({ local_date: today() });
    expect(await rows(`SELECT id FROM daily_readings WHERE user_id = ?`, USER_A)).toEqual([]);
    expect(await rows(`SELECT id FROM jobs WHERE user_id = ?`, USER_A)).toEqual([]);
  });

  it("answers chart_not_found when onboarding is unfinished", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedActiveRelease();

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("chart_not_found");
  });

  it("does not serve a reservation that has not been published", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error("enqueue failed");
    // Deliberately not delivered: the row is `pending` and carries no ciphertext.

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_generated");
  });

  it("does not serve a failed reservation", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error("enqueue failed");
    await rows(
      "UPDATE daily_readings SET status = 'failed', active_generation_job_id = NULL WHERE id = ?",
      enqueued.readingId,
    );

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_generated");
  });

  it("addresses today's date rather than the most recent reading", async () => {
    await publish(USER_A, new Date(Date.now() - 24 * 60 * 60 * 1000));

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_generated");
  });

  it("withholds a published reading while the scheduling zone is unconfirmed", async () => {
    await publish(USER_A);
    await rows("UPDATE users SET timezone_source = 'default_unconfirmed' WHERE id = ?", USER_A);

    // The reading exists and is still refused: only the 409 names the action
    // that unblocks generation, and a 404 would say "check back" forever.
    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(409);
    expect((body as ErrorEnvelope).error.code).toBe("timezone_confirmation_required");
  });

  it("withholds a published reading while the content locale is unconfirmed", async () => {
    await publish(USER_A);
    await rows("UPDATE users SET locale_source = 'default_unconfirmed' WHERE id = ?", USER_A);

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(409);
    expect((body as ErrorEnvelope).error.code).toBe("locale_confirmation_required");
  });

  it("reports the time zone first when both preferences are unconfirmed", async () => {
    await rows(
      `UPDATE users SET timezone_source = 'default_unconfirmed',
                        locale_source = 'default_unconfirmed' WHERE id = ?`,
      USER_A,
    );

    const { body } = await get("/v1/readings/today");
    expect((body as ErrorEnvelope).error.code).toBe("timezone_confirmation_required");
  });

  it("does not serve one user's reading to another", async () => {
    await publish(USER_A);
    const mine = await get<TodayBody>("/v1/readings/today");

    const { status, body } = await get("/v1/readings/today", USER_B);
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_generated");
    for (const paragraph of mine.body.reading.paragraphs) {
      expect(JSON.stringify(body)).not.toContain(paragraph.text);
    }
  });

  it("fails closed rather than laundering unreadable ciphertext into a 404", async () => {
    const readingId = await publish(USER_A);
    const [row] = await rows<{ reading_enc: ArrayBuffer }>(
      "SELECT reading_enc FROM daily_readings WHERE id = ?",
      readingId,
    );
    const corrupted = new Uint8Array(row!.reading_enc);
    corrupted[0] = corrupted[0]! ^ 0xff;
    await rows("UPDATE daily_readings SET reading_enc = ? WHERE id = ?", corrupted, readingId);

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
    expect((body as ErrorEnvelope).error.request_id).toBeTruthy();
  });

  it("refuses a stored reading sealed under a later schema version", async () => {
    const readingId = await publish(USER_A);
    const stored = await loadPublishedReadingForDate(env, IDENTITY_A, today());
    if (!stored) throw new Error("expected a published reading");

    // A row this repo cannot otherwise author: sealed by a future engine. It
    // decrypts perfectly and still cannot be represented under 0.3.0.
    const v3 = stored.stored as StoredReading;
    const drifted: StoredReading = {
      ...v3,
      reading: { ...v3.reading, schema_version: "0.4.0" as "0.3.0" },
    };
    const sealed = await encryptPayload(env, IDENTITY_A, drifted, {
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

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });

  it("serves the live revision after a reissue", async () => {
    const first = await publish(USER_A);
    const reissued = await enqueueReissue(env, USER_A, first, "defect_repair");
    if (!reissued.ok) throw new Error(`reissue failed: ${reissued.reason}`);
    await deliver([{ job_id: reissued.jobId, reading_id: reissued.readingId }]);

    const { status, body } = await get<TodayBody>("/v1/readings/today");
    expect(status).toBe(200);
    expect(body.reading.reading_id).toBe(reissued.readingId);
    expect(body.reading.revision).toBe(2);
  });
});

describe("GET /v1/readings/:id/evidence", () => {
  beforeEach(seedBoth);

  it("serves the provenance graph for a published reading", async () => {
    const readingId = await publish(USER_A);
    const [row] = await rows<{ reading_key: string; release_version: string }>(
      "SELECT reading_key, release_version FROM daily_readings WHERE id = ?",
      readingId,
    );

    const { status, body } = await get<EvidenceBody>(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      schema_version: "0.3.0",
      reading_id: readingId,
      reading_key: row!.reading_key,
      user_id: USER_A,
      local_date: today(),
      release_version: row!.release_version,
      revision: 1,
      revision_reason: "initial",
      supersedes_reading_id: null,
    });
    expect(body.assembly_id).toMatch(/^asm_[a-f0-9]{32}$/);
    expect(body.validation.passed).toBe(true);
    expect(body.paragraphs.length).toBeGreaterThan(0);
  });

  it("conforms to the frozen evidence-graph schema", async () => {
    const readingId = await publish(USER_A);
    const { body } = await get(`/v1/readings/${readingId}/evidence`);

    expect(validateEvidenceGraph(body)).toBe(true);
    expect(validateEvidenceGraph.errors ?? []).toEqual([]);
  });

  it("joins to the reading's paragraphs in order", async () => {
    const readingId = await publish(USER_A);
    const reading = await get<TodayBody>("/v1/readings/today");
    const { body } = await get<EvidenceBody>(`/v1/readings/${readingId}/evidence`);

    const evidenceIds = body.paragraphs.map((p) => p.paragraph_id);
    const readingIds = reading.body.reading.paragraphs.map((p) => p.paragraph_id);
    // Equality, not a prefix. `assembleReading` writes both lists from one call
    // site, so anything short of every paragraph in the same order is a graph
    // that has lost rows — and a prefix assertion is exactly the shape that
    // would pass while it happened.
    expect(evidenceIds).toEqual(readingIds);
    expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
  });

  it("answers identically for an unknown id and another account's id", async () => {
    const readingId = await publish(USER_A);

    const unknown = await get("/v1/readings/rdg_does_not_exist_0001/evidence");
    const foreign = await get(`/v1/readings/${readingId}/evidence`, USER_B);

    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    // Only request_id may differ. Ownership is a query predicate, so there is no
    // branch that could answer 403 or confirm the id exists.
    const strip = (body: ErrorEnvelope) => ({ ...body.error, request_id: null });
    expect(strip(foreign.body as ErrorEnvelope)).toEqual(strip(unknown.body as ErrorEnvelope));
    expect((unknown.body as ErrorEnvelope).error.code).toBe("reading_not_found");
  });

  it("does not serve evidence for a reservation with no artifact", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    if (!enqueued.ok) throw new Error("enqueue failed");

    const { status, body } = await get(`/v1/readings/${enqueued.readingId}/evidence`);
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_found");
  });

  it("still serves evidence for a superseded reading", async () => {
    const first = await publish(USER_A);
    const reissued = await enqueueReissue(env, USER_A, first, "safety_correction");
    if (!reissued.ok) throw new Error(`reissue failed: ${reissued.reason}`);
    await deliver([{ job_id: reissued.jobId, reading_id: reissued.readingId }]);

    // A client holding the pre-reissue id must still be able to open "Why this?"
    // for the reading on its screen; the graph is how it learns to refresh.
    const previous = await get<EvidenceBody>(`/v1/readings/${first}/evidence`);
    expect(previous.status).toBe(200);
    expect(previous.body).toMatchObject({ revision: 1, revision_reason: "initial" });

    const current = await get<EvidenceBody>(`/v1/readings/${reissued.readingId}/evidence`);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({
      revision: 2,
      revision_reason: "safety_correction",
      supersedes_reading_id: first,
    });
  });

  it("requires authentication", async () => {
    const readingId = await publish(USER_A);
    const { status } = await get(`/v1/readings/${readingId}/evidence`, null);
    expect(status).toBe(401);
  });

  it("fails closed on one unreadable evidence row rather than dropping it", async () => {
    const readingId = await publish(USER_A);
    const [source] = await rows<{ id: string; evidence_enc: ArrayBuffer }>(
      "SELECT id, evidence_enc FROM reading_sources WHERE reading_id = ? ORDER BY paragraph_order",
      readingId,
    );
    const corrupted = new Uint8Array(source!.evidence_enc);
    corrupted[0] = corrupted[0]! ^ 0xff;
    await rows("UPDATE reading_sources SET evidence_enc = ? WHERE id = ?", corrupted, source!.id);

    const { status, body } = await get(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });

  it("refuses a graph whose rows disagree with their sealed paragraphs", async () => {
    const readingId = await publish(USER_A);
    const [source] = await rows<{ id: string }>(
      "SELECT id FROM reading_sources WHERE reading_id = ? ORDER BY paragraph_order",
      readingId,
    );

    // evidence_enc's AAD binds only its own row id, not the reading it belongs
    // to, so a row re-pointed or re-ordered under a reading still decrypts
    // cleanly. Comparing the sealed paragraph against its row is what catches
    // it — nothing in the crypto can.
    await rows(
      "UPDATE reading_sources SET paragraph_order = paragraph_order + 100 WHERE id = ?",
      source!.id,
    );

    const { status, body } = await get(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });

  it("refuses a graph that no longer covers the reading's paragraphs", async () => {
    const readingId = await publish(USER_A);
    const before = await get<EvidenceBody>(`/v1/readings/${readingId}/evidence`);
    // Otherwise a deletion lands on the zero-row branch, which is a different
    // check answering a different question.
    expect(before.body.paragraphs.length).toBeGreaterThan(1);

    // `completeReading` asserts the row count inside the publishing batch;
    // nothing holds it afterwards. A row lost to a retention sweep or an
    // operator leaves a graph that decrypts, agrees with every row it still
    // has, and answers 200 while omitting the paragraph a reader opened the
    // drawer to ask about.
    await rows(
      `DELETE FROM reading_sources WHERE id = (
         SELECT id FROM reading_sources WHERE reading_id = ?
         ORDER BY paragraph_order DESC LIMIT 1
       )`,
      readingId,
    );

    const { status, body } = await get(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });

  it("refuses a sealed paragraph whose references cannot be projected", async () => {
    const readingId = await publish(USER_A);
    const [source] = await rows<{
      id: string;
      paragraph_id: string;
      paragraph_order: number;
    }>(
      `SELECT id, paragraph_id, paragraph_order FROM reading_sources
       WHERE reading_id = ? ORDER BY paragraph_order`,
      readingId,
    );

    // Decrypts cleanly, agrees with its row, and every nested field is an
    // array. `projectEvidence` copies each fact field by name, so a fact
    // reference with nothing in it reaches the wire as `{}` — against a schema
    // that requires `id` and `fact_type` and forbids everything else.
    const malformed = {
      paragraph_id: source!.paragraph_id,
      role: "primary_theme",
      order: source!.paragraph_order,
      evidence_lane: "celestial_facts",
      text_hash: null,
      facts: [{}],
      content: [],
      context_signals: [],
      ranking_factors: [],
      model_output: null,
    };
    const sealed = await encryptPayload(env, IDENTITY_A, malformed, {
      subject: IDENTITY_A.cryptoSubject,
      field: "reading_sources.evidence_enc",
      recordId: source!.id,
    });
    await rows(
      `UPDATE reading_sources
       SET evidence_enc = ?, evidence_key_version = ?, evidence_nonce = ?
       WHERE id = ?`,
      fromB64(sealed.ciphertext),
      sealed.keyVersion,
      sealed.nonce,
      source!.id,
    );

    const { status, body } = await get(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });
});

/**
 * The v5 storage envelope, before anything writes one.
 *
 * Task 10 is what publishes these; this suite seeds one directly, because the
 * migration and the readers have to be right before the publisher exists. A
 * stored artifact is written once and never rewritten, so "fix the reader
 * later" is not an option: whatever the first row is sealed with is what every
 * later reader has to understand.
 */
describe("v5 stored readings", () => {
  beforeEach(seedBoth);

  const HEX32 = "a".repeat(32);
  const HEX64 = "b".repeat(64);

  async function seedV5Reading(options: {
    status?: "published" | "invalidated";
    headline?: string;
    factLabel?: string;
    paragraphRole?: string;
    duplicateFactRef?: boolean;
    emptyFactRefs?: boolean;
    contextOnlyParagraph?: boolean;
    contextCategory?: string;
    allowedUse?: string;
  } = {}) {
    const status = options.status ?? "published";
    const localDate = today();
    const readingId = "rdg_v5_fixture_0001";
    const paragraphId = "par_v5_fixture_0001";
    const sourceId = "rsr_v5_fixture_0001";
    const contextOnlyParagraphId = "par_v5_fixture_0002";
    const contextOnlySourceId = "rsr_v5_fixture_0002";
    const [activeChart] = await rows<{ fingerprint: string }>(
      "SELECT fingerprint FROM chart_snapshots WHERE user_id = ? AND status = 'active'",
      USER_A,
    );
    if (!activeChart) throw new Error("active chart fixture missing");

    const reading = {
      schema_version: "0.5.0" as const,
      output_schema: "daily-reading-v5" as const,
      reading_id: readingId,
      local_date: localDate,
      generated_at: "2026-08-09T23:30:00Z",
      assembly_mode: "constrained_model" as const,
      revision: 1,
      locale: "en-US",
      domain_preference: null,
      headline: options.headline ?? "A narrower commitment",
      disclosure: "Generated with OpenAI from your calculated chart and enabled context.",
      paragraphs: [
        {
          paragraph_id: paragraphId,
          role: options.paragraphRole ?? "primary_theme",
          order: 1,
          text: "Saturn is square your Sun today, and the pressure asks for a smaller promise.",
        },
        // A supporting paragraph that names no body, sign, aspect, phase,
        // house, or degree and cites no fact. validateReadingCandidate accepts
        // exactly this: it demands grounding of the lead and of any unit that
        // makes an astrological claim, and lets personal context shape the
        // rest. The reader has to serve what its own writer may publish.
        ...(options.contextOnlyParagraph
          ? [
              {
                paragraph_id: contextOnlyParagraphId,
                role: "supporting_theme",
                order: 2,
                text: "Your note about the deadline suggests keeping the promise small this week.",
              },
            ]
          : []),
      ],
    };

    const stored = {
      schema_version: "0.5.0" as const,
      reading,
      evidence_header: {
        schema_version: "0.5.0" as const,
        reading_id: readingId,
        revision: 1,
        revision_reason: "initial" as const,
        generated_at: "2026-08-09T23:30:00Z",
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
          tzdb_version: "2025b",
          local_day_resolution_policy_version: "1.0.0",
        },
        model: {
          provider: "openai" as const,
          model: "gpt-5.6-sol",
          prompt_version: "1.0.0",
          selection_policy_version: "1.0.0",
          validation_policy_version: "1.0.0",
          provider_request_id: "resp_fixture_0001",
          input_tokens: 4210,
          output_tokens: 512,
        },
        validation: {
          status: "passed" as const,
          policy_version: "1.0.0",
          checks: [{ code: "grounding", passed: true as const }],
        },
      },
      invalidation:
        status === "invalidated"
          ? {
              reason: "chart_correction" as const,
              actor_class: "user_change" as const,
              invalidated_at: "2026-08-10T09:00:00Z",
            }
          : null,
    };

    const sealedReading = await encryptPayload(env, IDENTITY_A, stored, {
      subject: IDENTITY_A.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: readingId,
    });
    const sealedEvidence = await encryptPayload(
      env,
      IDENTITY_A,
      {
        paragraph_id: paragraphId,
        role: options.paragraphRole ?? "primary_theme",
        order: 1,
        fact_refs: options.emptyFactRefs
          ? []
          : Array.from({ length: options.duplicateFactRef ? 2 : 1 }, () => ({
              fact_id: `cyc_${HEX32}`,
              fact_class: "cycle_instance",
              label: options.factLabel ?? "Saturn square your Sun, building",
              scope: "personalized",
            })),
        context_refs: [
          {
            private_ref: "ctx_1",
            category: options.contextCategory ?? "enabled_personal_context",
            allowed_use: options.allowedUse ?? "tone",
          },
        ],
      },
      {
        subject: IDENTITY_A.cryptoSubject,
        field: "reading_sources.evidence_enc",
        recordId: sourceId,
      },
    );

    await rows(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, invalidated_at, reading_enc, reading_key_version,
          reading_nonce, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'calc-contract-launch',
               'constrained_model', ?, 1, 'initial', 1, ?, ?, ?, ?, ?, ?)`,
      readingId,
      USER_A,
      localDate,
      `reading-v5:${USER_A}:${localDate}:r1`,
      activeChart.fingerprint,
      status,
      status === "invalidated" ? "2026-08-10T09:00:00Z" : null,
      fromB64(sealedReading.ciphertext),
      sealedReading.keyVersion,
      sealedReading.nonce,
      "2026-08-09T23:30:00Z",
      "2026-08-10T00:00:00Z",
    );
    await rows(
      `INSERT INTO reading_sources
         (id, reading_id, user_id, paragraph_id, paragraph_order,
          evidence_enc, evidence_key_version, evidence_nonce, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      sourceId,
      readingId,
      USER_A,
      paragraphId,
      fromB64(sealedEvidence.ciphertext),
      sealedEvidence.keyVersion,
      sealedEvidence.nonce,
      "2026-08-09T23:30:00Z",
    );

    if (options.contextOnlyParagraph) {
      const sealedContextOnly = await encryptPayload(
        env,
        IDENTITY_A,
        {
          paragraph_id: contextOnlyParagraphId,
          role: "supporting_theme",
          order: 2,
          fact_refs: [],
          context_refs: [
            {
              private_ref: "ctx_2",
              category: "enabled_personal_context",
              allowed_use: "tone",
            },
          ],
        },
        {
          subject: IDENTITY_A.cryptoSubject,
          field: "reading_sources.evidence_enc",
          recordId: contextOnlySourceId,
        },
      );
      await rows(
        `INSERT INTO reading_sources
           (id, reading_id, user_id, paragraph_id, paragraph_order,
            evidence_enc, evidence_key_version, evidence_nonce, created_at)
         VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?)`,
        contextOnlySourceId,
        readingId,
        USER_A,
        contextOnlyParagraphId,
        fromB64(sealedContextOnly.ciphertext),
        sealedContextOnly.keyVersion,
        sealedContextOnly.nonce,
        "2026-08-09T23:30:00Z",
      );
    }

    return { readingId, localDate };
  }

  it("round-trips a v5 envelope through the same loader that reads a v3 one", async () => {
    const { readingId, localDate } = await seedV5Reading();

    const published = await loadPublishedReadingForDate(env, IDENTITY_A, localDate);
    expect(published).not.toBeNull();
    expect(published!.record.releaseVersion).toBeNull();
    expect(published!.record.assemblyMode).toBe("constrained_model");
    expect(published!.record.readingKey.startsWith("reading-v5:")).toBe(true);
    expect(published!.stored.reading.reading_id).toBe(readingId);
    expect("fallback_used" in published!.stored.reading).toBe(false);
  });

  it("serves the v5 artifact against its own frozen response contract", async () => {
    await seedV5Reading();

    const { status, body } = await get<Record<string, unknown>>("/v1/readings/today");
    expect(status).toBe(200);
    expect(body.schema_version).toBe("0.5.0");
    expect(validateTodayResponseV5(body)).toBe(true);
    expect(validateTodayResponseV5.errors ?? []).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("release_version");
    expect(JSON.stringify(body)).not.toContain("fallback_used");
  });

  it("serves the v5 provenance graph with its model record", async () => {
    const { readingId } = await seedV5Reading();

    const { status, body } = await get<Record<string, unknown>>(
      `/v1/readings/${readingId}/evidence`,
    );
    expect(status).toBe(200);
    expect(validateEvidenceGraphV5(body)).toBe(true);
    expect(validateEvidenceGraphV5.errors ?? []).toEqual([]);
    expect((body.model as Record<string, unknown>).provider).toBe("openai");
    // Trusted-plane fields the v3 graph inherited from M0 and v5 never had.
    expect(body).not.toHaveProperty("user_id");
    expect(body).not.toHaveProperty("reading_key");
  });

  it("hides an invalidated reading from Today while keeping its ciphertext", async () => {
    const { readingId, localDate } = await seedV5Reading({ status: "invalidated" });

    expect(await loadPublishedReadingForDate(env, IDENTITY_A, localDate)).toBeNull();

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(404);
    expect((body as ErrorEnvelope).error.code).toBe("reading_not_generated");

    const [row] = await rows<{ status: string; invalidated_at: string; sealed: number }>(
      `SELECT status, invalidated_at, reading_enc IS NOT NULL AS sealed
       FROM daily_readings WHERE id = ?`,
      readingId,
    );
    expect(row!.status).toBe("invalidated");
    expect(row!.invalidated_at).toBe("2026-08-10T09:00:00Z");
    expect(row!.sealed).toBe(1);
  });

  it.each([
    {
      name: "unknown context category",
      options: { contextCategory: "private_journal_entry" },
      forbidden: "private_journal_entry",
    },
    {
      name: "unsupported allowed use",
      options: { allowedUse: "content_quality" },
      forbidden: "content_quality",
    },
    {
      name: "oversized fact label",
      options: { factLabel: "x".repeat(201) },
      forbidden: "x".repeat(201),
    },
  ])("fails closed for V5 evidence with an $name", async ({ options, forbidden }) => {
    const { readingId } = await seedV5Reading(options);
    const { status, body } = await get<ErrorEnvelope>(
      `/v1/readings/${readingId}/evidence`,
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain(forbidden);
  });

  it("fails closed when a V5 Today projection violates a frozen wire constraint", async () => {
    const oversizedHeadline = "h".repeat(201);
    await seedV5Reading({ headline: oversizedHeadline });

    const { status, body } = await get<ErrorEnvelope>("/v1/readings/today");
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain(oversizedHeadline);
  });

  it("fails closed when a V5 Today projection does not open with its primary lead", async () => {
    await seedV5Reading({ paragraphRole: "supporting_theme" });

    const { status, body } = await get<ErrorEnvelope>("/v1/readings/today");
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });

  it("serves a context-only supporting paragraph its own validator accepts", async () => {
    const { readingId } = await seedV5Reading({ contextOnlyParagraph: true });

    const today = await get<Record<string, unknown>>("/v1/readings/today");
    expect(today.status).toBe(200);
    expect(validateTodayResponseV5(today.body)).toBe(true);

    const { status, body } = await get<Record<string, unknown>>(
      `/v1/readings/${readingId}/evidence`,
    );
    expect(status).toBe(200);
    expect(validateEvidenceGraphV5(body)).toBe(true);
    expect(
      (body.paragraphs as Array<Record<string, unknown>>).map((paragraph) => [
        paragraph.role,
        (paragraph.fact_refs as unknown[]).length,
        (paragraph.context_refs as unknown[]).length,
      ]),
    ).toEqual([
      ["primary_theme", 1, 1],
      ["supporting_theme", 0, 1],
    ]);
  });

  it.each([
    { name: "duplicate fact references", options: { duplicateFactRef: true } },
    { name: "an ungrounded lead", options: { emptyFactRefs: true } },
  ])("fails closed for V5 evidence with $name", async ({ options }) => {
    const { readingId } = await seedV5Reading(options);
    const { status, body } = await get<ErrorEnvelope>(
      `/v1/readings/${readingId}/evidence`,
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });

  it("hides published prose when its chart pin no longer matches the active chart", async () => {
    const { readingId } = await seedV5Reading();
    await rows(
      `UPDATE daily_readings
       SET chart_fingerprint = (SELECT fingerprint FROM chart_snapshots WHERE user_id = ?) || '-stale'
       WHERE id = ?`,
      USER_A,
      readingId,
    );

    const { status, body } = await get<ErrorEnvelope>("/v1/readings/today");
    expect(status).toBe(404);
    expect(body.error.code).toBe("reading_not_generated");
  });

  it("uses explicit PUT to invalidate a stale current-day V5 row and reserve one fact repair", async () => {
    const { readingId } = await seedV5Reading();
    await grantAiSynthesis();
    await rows(
      `UPDATE chart_snapshots SET fingerprint = ?
       WHERE user_id = ? AND status = 'active'`,
      `sha256:${"7d".repeat(32)}`,
      USER_A,
    );

    const response = await putTodayWithEnv<PreparationBody>(enabledEnv());
    expect(response).toMatchObject({
      status: 202,
      body: { schema_version: "0.5.0", status: "preparing" },
    });
    expect(
      await rows(
        `SELECT status, revision, revision_reason, supersedes_reading_id
         FROM daily_readings WHERE user_id = ? ORDER BY revision`,
        USER_A,
      ),
    ).toEqual([
      {
        status: "invalidated",
        revision: 1,
        revision_reason: "initial",
        supersedes_reading_id: null,
      },
      {
        status: "pending",
        revision: 2,
        revision_reason: "chart_recalculated",
        supersedes_reading_id: readingId,
      },
    ]);
  });

  it("recovers an invalidated current-day orphan once and maps an exhausted repair to 424", async () => {
    const { readingId } = await seedV5Reading({ status: "invalidated" });
    await grantAiSynthesis();
    const requestEnv = enabledEnv();

    expect(await putTodayWithEnv<PreparationBody>(requestEnv)).toMatchObject({
      status: 202,
      body: { schema_version: "0.5.0", status: "preparing" },
    });
    const [successor] = await rows<{ id: string; active_generation_job_id: string }>(
      `SELECT id, active_generation_job_id FROM daily_readings
       WHERE supersedes_reading_id = ?`,
      readingId,
    );
    expect(successor).toBeTruthy();
    expect((await putTodayWithEnv<PreparationBody>(requestEnv)).status).toBe(202);
    expect(
      await rows("SELECT id FROM daily_readings WHERE supersedes_reading_id = ?", readingId),
    ).toHaveLength(1);

    await rows(
      "UPDATE daily_readings SET status = 'failed', command_generation = 3 WHERE id = ?",
      successor!.id,
    );
    await rows(
      "UPDATE jobs SET status = 'failed', result_class = 'publisher_unavailable' WHERE id = ?",
      successor!.active_generation_job_id,
    );
    expect(await putTodayWithEnv<ErrorEnvelope>(requestEnv)).toMatchObject({
      status: 424,
      body: {
        error: {
          code: "reading_generation_failed",
          retryable: false,
        },
      },
    });
  });

  it("still answers the evidence drawer for an invalidated reading", async () => {
    // The reader may hold the id from a session that started before the
    // invalidation. Hiding the provenance would leave them with prose they can
    // no longer explain.
    const { readingId } = await seedV5Reading({ status: "invalidated" });
    const { status } = await get(`/v1/readings/${readingId}/evidence`);
    expect(status).toBe(200);
  });

  it("refuses a v5 envelope whose evidence cannot name the model that wrote it", async () => {
    const { readingId, localDate } = await seedV5Reading();
    const published = await loadPublishedReadingForDate(env, IDENTITY_A, localDate);
    if (!published) throw new Error("expected a published reading");

    const header = (published.stored as { evidence_header: Record<string, unknown> })
      .evidence_header;
    const withoutModel: Record<string, unknown> = { ...header };
    delete withoutModel.model;
    const sealed = await encryptPayload(
      env,
      IDENTITY_A,
      { ...published.stored, evidence_header: withoutModel },
      {
        subject: IDENTITY_A.cryptoSubject,
        field: "daily_readings.reading_enc",
        recordId: readingId,
      },
    );
    await rows(
      `UPDATE daily_readings SET reading_enc = ?, reading_key_version = ?, reading_nonce = ?
       WHERE id = ?`,
      fromB64(sealed.ciphertext),
      sealed.keyVersion,
      sealed.nonce,
      readingId,
    );

    const { status, body } = await get("/v1/readings/today");
    expect(status).toBe(500);
    expect((body as ErrorEnvelope).error.code).toBe("internal_error");
  });
});
