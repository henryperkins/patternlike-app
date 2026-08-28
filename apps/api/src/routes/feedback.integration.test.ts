import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import { encryptPayload } from "../db/users.js";
import { USR12_SOURCE_ID } from "../db/first-party-sources.js";

const READING_ID = "rdg_feedback_fixture01";

interface Envelope {
  id?: string;
  reading_id?: string;
  created_at?: string;
  resonance?: string;
  relevance_labels?: string[];
  error?: { code: string; message: string; request_id: string | null };
}

async function post(
  readingId: string,
  body: unknown,
  init: { userId?: string; idempotencyKey?: string | null } = {},
): Promise<{ status: number; body: Envelope }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": init.userId ?? USER_A,
  };
  if (init.idempotencyKey !== null) {
    headers["idempotency-key"] = init.idempotencyKey ?? "idem-feedback-0001";
  }
  const res = await SELF.fetch(`http://api.test/v1/readings/${readingId}/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

async function get(
  readingId: string,
  userId = USER_A,
): Promise<{ status: number; body: Envelope }> {
  const res = await SELF.fetch(`http://api.test/v1/readings/${readingId}/feedback`, {
    headers: { "x-user-id": userId },
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

describe("POST /v1/readings/:id/feedback", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    const sealed = await encryptPayload(env, IDENTITY_A, { fixture: true }, {
      subject: IDENTITY_A.cryptoSubject,
      field: "daily_readings.reading_enc",
      recordId: READING_ID,
    });
    const now = "2026-08-14T12:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, reading_enc, reading_key_version, reading_nonce,
          created_at, updated_at)
       VALUES (?, ?, '2026-08-14', NULL, ?, 'sha256:f', 'c',
               'constrained_model', 'published', 1, 'initial', 1, ?, ?, ?, ?, ?)`,
    )
      .bind(
        READING_ID,
        USER_A,
        `reading-v5:${USER_A}:2026-08-14:r1`,
        Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0)),
        sealed.keyVersion,
        sealed.nonce,
        now,
        now,
      )
      .run();
  });

  it("records structured feedback and creates the USR-12 grant", async () => {
    const created = await post(READING_ID, {
      resonance: "helpful",
      relevance_labels: ["work"],
      note: "The timing paragraph was the useful part.",
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^rfb_[0-9a-f]{32}$/);
    expect(created.body.reading_id).toBe(READING_ID);
    expect(created.body.created_at).toBeTruthy();

    const latest = await get(READING_ID);
    expect(latest.status).toBe(200);
    expect(latest.body.resonance).toBe("helpful");
    expect(latest.body.relevance_labels).toEqual(["work"]);

    const [grant] = await rows<{ source_id: string; permission_state: string }>(
      `SELECT source_id, permission_state FROM context_source_permissions
       WHERE user_id = ? AND source_id = ?`,
      USER_A,
      USR12_SOURCE_ID,
    );
    expect(grant).toEqual({ source_id: USR12_SOURCE_ID, permission_state: "active" });

    const [row] = await rows<{ notes_enc: ArrayBuffer | null }>(
      "SELECT notes_enc FROM reading_feedback WHERE id = ?",
      created.body.id,
    );
    expect(row?.notes_enc).not.toBeNull();
  });

  it("does not store feedback while a crypto write fence is installed", async () => {
    await rows(
      `UPDATE users SET crypto_write_fence =
         'cop_00000000000000000000000000000001' WHERE id = ?`,
      USER_A,
    );

    const result = await post(READING_ID, {
      resonance: "helpful",
      note: "must not be committed under a stale key",
    }, { idempotencyKey: "idem-feedback-fenced" });

    expect(result.status).toBe(500);
    expect(await rows("SELECT id FROM reading_feedback WHERE user_id = ?", USER_A))
      .toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE idempotency_key = ?", "idem-feedback-fenced"))
      .toEqual([]);
  });

  it("replays an identical idempotent retry and rejects a conflicting one", async () => {
    const first = await post(READING_ID, { resonance: "neutral" }, { idempotencyKey: "idem-same" });
    expect(first.status).toBe(201);
    const replay = await post(READING_ID, { resonance: "neutral" }, { idempotencyKey: "idem-same" });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await post(
      READING_ID,
      { resonance: "not_helpful" },
      { idempotencyKey: "idem-same" },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");
  });

  it("does not leak another account's reading", async () => {
    const other = await post(
      READING_ID,
      { resonance: "helpful" },
      { userId: USER_B, idempotencyKey: "idem-other" },
    );
    expect(other.status).toBe(404);
    expect(other.body.error?.code).toBe("reading_not_found");
  });

  it("rejects a missing resonance without writing", async () => {
    const missing = await post(READING_ID, { relevance_labels: ["work"] });
    expect(missing.status).toBe(400);
    expect(await rows("SELECT id FROM reading_feedback")).toEqual([]);
  });
});
