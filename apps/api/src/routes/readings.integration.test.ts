import { env, SELF, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3DailyReading from "../../../../contracts/m3/daily-reading.schema.json";
import m3ReadingEvidence from "../../../../contracts/m3/reading-evidence.schema.json";
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
import { CYCLE_FP_EMPTY } from "../../test/mock-calc-service.js";
import { encryptPayload } from "../db/users.js";
import { fromB64 } from "../crypto.js";
import { localDateIn } from "../services/local-day.js";
import { loadPublishedReadingForDate } from "../db/readings.js";
import {
  enqueueDailyReading,
  enqueueReissue,
  type GenerationMessage,
} from "../services/enqueue.js";
import type { StoredReading } from "../services/generate-daily-reading.js";

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
for (const schema of [m0Common, m3Common, m3DailyReading, m3ReadingEvidence]) {
  ajv.addSchema(schema);
}
const validateTodayResponse = ajv.getSchema(
  `${m3DailyReading.$id}#/$defs/dailyReadingResponse`,
)!;
const validatePreparation = ajv.getSchema(
  `${m3DailyReading.$id}#/$defs/dailyReadingPreparation`,
)!;
const validateEvidenceGraph = ajv.getSchema(
  `${m3ReadingEvidence.$id}#/$defs/readingEvidenceGraph`,
)!;

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string | null;
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

  it("reserves an absent day and returns the exact preparation contract", async () => {
    const { status, body } = await putToday<PreparationBody>();

    expect(status).toBe(202);
    expect(body).toEqual({
      schema_version: "0.3.0",
      status: "preparing",
      local_date: today(),
    });
    expect(validatePreparation(body)).toBe(true);
    expect(validatePreparation.errors ?? []).toEqual([]);

    const [counts] = await rows<{ reading_count: number; job_count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ?) AS reading_count,
         (SELECT COUNT(*) FROM jobs WHERE user_id = ?) AS job_count`,
      USER_A,
      USER_A,
    );
    expect(counts).toEqual({ reading_count: 1, job_count: 1 });
  });

  it("converges repeated and concurrent PUTs on one reservation and job", async () => {
    const responses = await Promise.all([putToday(), putToday(), putToday()]);

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    const [counts] = await rows<{ reading_count: number; job_count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM daily_readings WHERE user_id = ?) AS reading_count,
         (SELECT COUNT(*) FROM jobs WHERE user_id = ?) AS job_count`,
      USER_A,
      USER_A,
    );
    expect(counts).toEqual({ reading_count: 1, job_count: 1 });
  });

  it("refuses without an active release before reserving anything", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, ZONE);
    await seedChart(IDENTITY_A);

    const { status, body } = await putToday<ErrorEnvelope>();

    expect(status).toBe(503);
    expect(body.error.code).toBe("release_not_active");
    expect(await rows(`SELECT id FROM daily_readings`)).toEqual([]);
    expect(await rows(`SELECT id FROM jobs`)).toEqual([]);
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
    const drifted: StoredReading = {
      ...stored.stored,
      reading: { ...stored.stored.reading, schema_version: "0.4.0" as "0.3.0" },
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
