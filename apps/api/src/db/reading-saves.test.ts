import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  IDENTITY_B,
  resetDb,
  rows,
  seedUser,
  USER_A,
  USER_B,
} from "../../test/helpers.js";
import {
  getReadingSaveState,
  saveReading,
  unsaveReading,
} from "./reading-saves.js";

const SAVED_AT = new Date("2026-09-06T08:00:00.000Z");

async function seedReading(
  id: string,
  userId: string,
  status: "pending" | "published" | "failed" | "superseded" | "invalidated",
): Promise<void> {
  const readable = ["published", "superseded", "invalidated"].includes(status);
  const localDate = status === "pending"
    ? "2026-09-04"
    : status === "failed"
    ? "2026-09-05"
    : "2026-09-06";
  await env.DB.prepare(
    `INSERT INTO daily_readings (
       id, user_id, local_date, release_version, reading_key, chart_fingerprint,
       contract_id, assembly_mode, status, revision, revision_reason,
       command_generation, invalidated_at, reading_enc, reading_key_version,
       reading_nonce, created_at, updated_at
     ) VALUES (?, ?, ?, NULL, ?, 'sha256:test', 'contract-test',
               'constrained_model', ?, 1, 'initial', 1, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    userId,
    localDate,
    `reading-v5:${userId}:${localDate}:r1:${id}`,
    status,
    status === "invalidated" ? SAVED_AT.toISOString() : null,
    readable ? new Uint8Array([1]) : null,
    readable ? 1 : null,
    readable ? "nonce" : null,
    SAVED_AT.toISOString(),
    SAVED_AT.toISOString(),
  ).run();
}

describe("reading Save state", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
  });

  it.each(["published", "superseded", "invalidated"] as const)(
    "saves an owned readable %s revision and returns its exact state",
    async (status) => {
      const readingId = `rdr_save_${status}`;
      await seedReading(readingId, USER_A, status);

      expect(await getReadingSaveState(env, USER_A, readingId)).toEqual({
        schema_version: "0.8.0",
        reading_id: readingId,
        saved: false,
        saved_at: null,
      });
      expect(await saveReading(env, USER_A, readingId, SAVED_AT)).toEqual({
        schema_version: "0.8.0",
        reading_id: readingId,
        saved: true,
        saved_at: SAVED_AT.toISOString(),
      });
      expect(await getReadingSaveState(env, USER_A, readingId)).toEqual({
        schema_version: "0.8.0",
        reading_id: readingId,
        saved: true,
        saved_at: SAVED_AT.toISOString(),
      });
    },
  );

  it("preserves the first saved_at across repeated PUT semantics", async () => {
    const readingId = "rdr_save_repeat";
    await seedReading(readingId, USER_A, "published");
    await saveReading(env, USER_A, readingId, SAVED_AT);

    expect(
      await saveReading(
        env,
        USER_A,
        readingId,
        new Date("2026-09-07T08:00:00.000Z"),
      ),
    ).toMatchObject({ saved_at: SAVED_AT.toISOString() });
  });

  it("does not disclose unknown, foreign, pending, or failed readings", async () => {
    await seedReading("rdr_save_foreign", USER_B, "published");
    await seedReading("rdr_save_pending", USER_A, "pending");
    await seedReading("rdr_save_failed", USER_A, "failed");

    for (const readingId of [
      "rdr_save_unknown",
      "rdr_save_foreign",
      "rdr_save_pending",
      "rdr_save_failed",
    ]) {
      expect(await getReadingSaveState(env, USER_A, readingId)).toBeNull();
      expect(await saveReading(env, USER_A, readingId, SAVED_AT)).toBeNull();
    }
    expect(await rows("SELECT * FROM reading_saves")).toEqual([]);
    expect(await rows("SELECT * FROM assertion_probe")).toEqual([]);
  });

  it("refuses corrupt pending ciphertext and readable status without ciphertext", async () => {
    await env.DB.prepare("PRAGMA ignore_check_constraints = ON").run();
    try {
      const createdAt = SAVED_AT.toISOString();
      await env.DB.prepare(
        `INSERT INTO daily_readings (
           id, user_id, local_date, release_version, reading_key,
           chart_fingerprint, contract_id, assembly_mode, status, revision,
           revision_reason, command_generation, reading_enc,
           reading_key_version, reading_nonce, created_at, updated_at
         ) VALUES
           ('rdr_save_pending_ciphertext', ?, '2026-09-03', NULL, ?,
            'sha256:test', 'contract-test', 'constrained_model', 'pending', 1,
            'initial', 1, X'01', 1, 'nonce', ?, ?),
           ('rdr_save_published_no_ciphertext', ?, '2026-09-02', NULL, ?,
            'sha256:test', 'contract-test', 'constrained_model', 'published', 1,
            'initial', 1, NULL, NULL, NULL, ?, ?)`,
      ).bind(
        USER_A,
        `reading-v5:${USER_A}:2026-09-03:r1`,
        createdAt,
        createdAt,
        USER_A,
        `reading-v5:${USER_A}:2026-09-02:r1`,
        createdAt,
        createdAt,
      ).run();
    } finally {
      await env.DB.prepare("PRAGMA ignore_check_constraints = OFF").run();
    }

    for (const readingId of [
      "rdr_save_pending_ciphertext",
      "rdr_save_published_no_ciphertext",
    ]) {
      expect(await getReadingSaveState(env, USER_A, readingId)).toBeNull();
      expect(await saveReading(env, USER_A, readingId, SAVED_AT)).toBeNull();
    }
    expect(await rows("SELECT * FROM reading_saves")).toEqual([]);
  });

  it("unsaves idempotently without disclosing unknown or foreign ids", async () => {
    await seedReading("rdr_save_delete", USER_A, "published");
    await seedReading("rdr_save_delete_foreign", USER_B, "published");
    await saveReading(env, USER_A, "rdr_save_delete", SAVED_AT);

    await expect(unsaveReading(env, USER_A, "rdr_save_delete")).resolves.toBeUndefined();
    await expect(unsaveReading(env, USER_A, "rdr_save_delete")).resolves.toBeUndefined();
    await expect(unsaveReading(env, USER_A, "rdr_save_unknown")).resolves.toBeUndefined();
    await expect(
      unsaveReading(env, USER_A, "rdr_save_delete_foreign"),
    ).resolves.toBeUndefined();
    expect(await rows("SELECT * FROM reading_saves")).toEqual([]);
  });
});
