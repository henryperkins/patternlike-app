import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import { USR05_SOURCE_ID } from "../db/first-party-sources.js";

interface Envelope {
  schema_version?: string;
  excluded_topics?: string[];
  updated_at?: string | null;
  error?: { code: string; message: string; request_id: string | null };
}

async function get(): Promise<{ status: number; body: Envelope }> {
  const res = await SELF.fetch("http://api.test/v1/preferences/topic-exclusions", {
    headers: { "x-user-id": USER_A },
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

async function put(
  body: unknown,
  key = "idem-topics-0001",
): Promise<{ status: number; body: Envelope }> {
  const res = await SELF.fetch("http://api.test/v1/preferences/topic-exclusions", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

describe("PUT /v1/preferences/topic-exclusions", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("starts empty and stores a closed set of named domains", async () => {
    const empty = await get();
    expect(empty.status).toBe(200);
    expect(empty.body.excluded_topics).toEqual([]);
    expect(empty.body.updated_at).toBeNull();

    const saved = await put({ excluded_topics: ["relationships", "work"] });
    expect(saved.status).toBe(200);
    expect(saved.body.excluded_topics).toEqual(["relationships", "work"]);
    expect(saved.body.updated_at).toBeTruthy();

    const [grant] = await rows<{ permission_state: string }>(
      `SELECT permission_state FROM context_source_permissions
       WHERE user_id = ? AND source_id = ?`,
      USER_A,
      USR05_SOURCE_ID,
    );
    expect(grant?.permission_state).toBe("active");

    const [signal] = await rows<{ is_current: number; value_encoding: string }>(
      `SELECT is_current, value_encoding FROM context_signals
       WHERE user_id = ? AND source_id = ? AND is_current = 1`,
      USER_A,
      USR05_SOURCE_ID,
    );
    expect(signal).toEqual({ is_current: 1, value_encoding: "encrypted" });

    const reread = await get();
    expect(reread.body.excluded_topics).toEqual(["relationships", "work"]);
  });

  it("does not store exclusions while a crypto write fence is installed", async () => {
    await rows(
      `UPDATE users SET crypto_write_fence =
         'cop_00000000000000000000000000000001' WHERE id = ?`,
      USER_A,
    );

    const result = await put({ excluded_topics: ["work"] }, "idem-topics-fenced");

    expect(result.status).toBe(409);
    expect(await rows("SELECT id FROM context_signals WHERE user_id = ?", USER_A))
      .toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE idempotency_key = ?", "idem-topics-fenced"))
      .toEqual([]);
  });

  it("clears the current signal when the set is emptied", async () => {
    await put({ excluded_topics: ["home"] }, "idem-topics-set");
    const cleared = await put({ excluded_topics: [] }, "idem-topics-clear");
    expect(cleared.status).toBe(200);
    expect(cleared.body.excluded_topics).toEqual([]);

    const current = await rows(
      `SELECT id FROM context_signals
       WHERE user_id = ? AND source_id = ? AND is_current = 1`,
      USER_A,
      USR05_SOURCE_ID,
    );
    expect(current).toEqual([]);
  });

  it("can set again after a clear without colliding on the superseded revision", async () => {
    await put({ excluded_topics: ["home"] }, "idem-topics-first");
    await put({ excluded_topics: [] }, "idem-topics-empty");
    const restored = await put({ excluded_topics: ["work"] }, "idem-topics-again");
    expect(restored.status).toBe(200);
    expect(restored.body.excluded_topics).toEqual(["work"]);

    const revisions = await rows<{ source_revision: number; is_current: number }>(
      `SELECT source_revision, is_current FROM context_signals
       WHERE user_id = ? AND source_id = ? ORDER BY source_revision`,
      USER_A,
      USR05_SOURCE_ID,
    );
    expect(revisions).toEqual([
      { source_revision: 1, is_current: 0 },
      { source_revision: 2, is_current: 1 },
    ]);
  });

  it("rejects unspecified and duplicate domains", async () => {
    expect((await put({ excluded_topics: ["unspecified"] })).status).toBe(400);
    expect((await put({ excluded_topics: ["work", "work"] })).status).toBe(400);
    expect((await put({ excluded_topics: ["not_a_domain"] })).status).toBe(400);
  });
});
