import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

import { DEV_ROOT_KEK } from "../crypto.js";
import { decryptPayload } from "../db/users.js";
import { storePlaceResolution } from "../db/place-resolutions.js";
import type { Env } from "../env.js";
import {
  ALICE,
  IDENTITY_A,
  IDENTITY_OTHER,
  SUBJECT_A,
  USER_A,
  postBirthProfile,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import {
  createKekRewrapCampaign,
  DEK_ROTATION_QUIESCENCE_MS,
  startDekRotation,
  stepDekRotation,
  stepKekRewrapCampaign,
} from "./crypto-operations.js";

const NEW_ROOT = "root-secret-2026-09-with-at-least-32-chars";

function dualKeyringEnv(): Env {
  return {
    ...env,
    ROOT_KEK_KEYRING: JSON.stringify({
      version: 1,
      active_key_id: "root-2026-09",
      keys: {
        legacy: DEV_ROOT_KEK,
        "root-2026-09": NEW_ROOT,
      },
    }),
  } as Env;
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("resumable DEK rotation", () => {
  it("atomically freezes, fences, and replays a start", async () => {
    const now = new Date("2026-08-28T00:00:00.000Z");
    const first = await startDekRotation(env, {
      userId: USER_A,
      idempotencyKey: "idem-dek-rotation-start-0001",
      now,
    });
    const replay = await startDekRotation(env, {
      userId: USER_A,
      idempotencyKey: "idem-dek-rotation-start-0001",
      now,
    });

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ stage: "quiescing", reencryptedCount: 0 });
    expect(new Date(first.notBefore).getTime() - now.getTime()).toBe(
      DEK_ROTATION_QUIESCENCE_MS,
    );
    expect(await rows<{ status: string; crypto_write_fence: string | null }>(
      "SELECT status, crypto_write_fence FROM users WHERE id = ?",
      USER_A,
    )).toEqual([{ status: "frozen", crypto_write_fence: first.id }]);
  });

  it("waits for quiescence then advances one durable stage per step", async () => {
    const now = new Date("2026-08-28T00:00:00.000Z");
    const started = await startDekRotation(env, {
      userId: USER_A,
      idempotencyKey: "idem-dek-rotation-empty-0001",
      now,
    });

    expect((await stepDekRotation(env, started.id, new Date(
      now.getTime() + DEK_ROTATION_QUIESCENCE_MS - 1,
    ))).stage).toBe("quiescing");
    expect((await stepDekRotation(env, started.id, new Date(
      now.getTime() + DEK_ROTATION_QUIESCENCE_MS,
    ))).stage).toBe("reencrypting");
    expect((await stepDekRotation(env, started.id, new Date(
      now.getTime() + DEK_ROTATION_QUIESCENCE_MS + 1,
    ))).stage).toBe("finalizing");
    expect((await stepDekRotation(env, started.id, new Date(
      now.getTime() + DEK_ROTATION_QUIESCENCE_MS + 2,
    ))).stage).toBe("verifying");
    expect((await stepDekRotation(env, started.id, new Date(
      now.getTime() + DEK_ROTATION_QUIESCENCE_MS + 3,
    ))).stage).toBe("succeeded");

    expect(await rows<{ status: string; crypto_write_fence: string | null }>(
      "SELECT status, crypto_write_fence FROM users WHERE id = ?",
      USER_A,
    )).toEqual([{ status: "active", crypto_write_fence: null }]);
    expect(await rows<{ key_version: number; destroyed_at: string | null }>(
      `SELECT key_version, destroyed_at FROM user_keys
       WHERE user_id = ? ORDER BY key_version`,
      USER_A,
    )).toEqual([
      { key_version: 1, destroyed_at: expect.any(String) },
      { key_version: 2, destroyed_at: null },
    ]);
  });

  it("re-encrypts existing profile bytes before swapping the live key", async () => {
    await postBirthProfile(USER_A, "idem-before-resumable-rotation", ALICE);
    const before = await rows<{ payload_enc: ArrayBuffer }>(
      "SELECT payload_enc FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    const now = new Date("2026-08-28T00:00:00.000Z");
    let operation = await startDekRotation(env, {
      userId: USER_A,
      idempotencyKey: "idem-dek-rotation-data-0001",
      now,
    });
    for (let step = 0; step < 8 && operation.stage !== "succeeded"; step += 1) {
      operation = await stepDekRotation(
        env,
        operation.id,
        new Date(now.getTime() + DEK_ROTATION_QUIESCENCE_MS + step),
      );
    }
    expect(operation.stage).toBe("succeeded");
    expect(operation.reencryptedCount).toBeGreaterThan(0);

    const profile = (await rows<{
      version: number;
      payload_enc: ArrayBuffer;
      payload_key_version: number;
      payload_nonce: string;
    }>(
      `SELECT version, payload_enc, payload_key_version, payload_nonce
       FROM birth_profiles WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      USER_A,
    ))[0]!;
    expect(Array.from(new Uint8Array(profile.payload_enc))).not.toEqual(
      Array.from(new Uint8Array(before[0]!.payload_enc)),
    );
    expect(profile.payload_key_version).toBe(2);
    const decoded = await decryptPayload<{ submitted: { birth_date: string } }>(
      env,
      IDENTITY_A,
      {
        key_version: profile.payload_key_version,
        nonce: profile.payload_nonce,
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(profile.payload_enc))),
      },
      {
        subject: SUBJECT_A,
        field: "birth_profiles.payload_enc",
        recordId: String(profile.version),
      },
    );
    expect(decoded.submitted.birth_date).toBe(ALICE.birth_date);
  });

  it("leases concurrent steps once and checkpoints at 75 ciphertext rows", async () => {
    for (let index = 0; index < 80; index += 1) {
      await storePlaceResolution(env, IDENTITY_A, {
        label: `Place ${index}`,
        latitude: 34 + index / 10_000,
        longitude: -118,
        geocode_confidence: "high",
        qualifiers: [],
      });
    }
    const now = new Date("2026-08-28T00:00:00.000Z");
    const started = await startDekRotation(env, {
      userId: USER_A,
      idempotencyKey: "idem-dek-rotation-bounded-0001",
      now,
    });
    const eligible = new Date(now.getTime() + DEK_ROTATION_QUIESCENCE_MS);
    const concurrent = await Promise.all([
      stepDekRotation(env, started.id, eligible),
      stepDekRotation(env, started.id, eligible),
    ]);
    expect(concurrent.some((result) => result.stage === "reencrypting")).toBe(true);
    expect(await rows(
      `SELECT candidate_key_version FROM crypto_operations
       WHERE id = ? AND candidate_wrapped_dek IS NOT NULL`,
      started.id,
    )).toHaveLength(1);

    const firstChunk = await stepDekRotation(
      env,
      started.id,
      new Date(eligible.getTime() + 1),
    );
    expect(firstChunk).toMatchObject({
      stage: "reencrypting",
      reencryptedCount: 75,
    });
    expect(await rows<{ key_version: number }>(
      `SELECT key_version FROM user_keys
       WHERE user_id = ? AND destroyed_at IS NULL`,
      USER_A,
    )).toEqual([{ key_version: 1 }]);

    const secondChunk = await stepDekRotation(
      env,
      started.id,
      new Date(eligible.getTime() + 2),
    );
    expect(secondChunk.reencryptedCount).toBe(80);
    const replayedCheckpoint = await stepDekRotation(
      env,
      started.id,
      new Date(eligible.getTime() + 3),
    );
    expect(replayedCheckpoint).toMatchObject({
      stage: "finalizing",
      reencryptedCount: 80,
    });
  });
});

describe("root KEK rewrap campaigns", () => {
  it("snapshots and drains live legacy keys without changing DEK versions", async () => {
    await seedUser(IDENTITY_OTHER);
    const rotated = dualKeyringEnv();
    const campaign = await createKekRewrapCampaign(rotated, {
      targetRootKekId: "root-2026-09",
      idempotencyKey: "idem-root-campaign-0001",
      now: new Date("2026-08-28T00:00:00.000Z"),
    });
    expect(campaign).toMatchObject({
      status: "running",
      totalCount: 2,
      completedCount: 0,
    });

    const completed = await stepKekRewrapCampaign(
      rotated,
      campaign.id,
      new Date("2026-08-28T00:00:01.000Z"),
    );
    expect(completed).toMatchObject({
      status: "completed",
      totalCount: 2,
      completedCount: 2,
      blockedCount: 0,
    });
    expect(await rows<{ key_version: number; root_kek_id: string }>(
      `SELECT key_version, root_kek_id FROM user_keys
       WHERE destroyed_at IS NULL ORDER BY user_id`,
    )).toEqual([
      { key_version: 1, root_kek_id: "root-2026-09" },
      { key_version: 1, root_kek_id: "root-2026-09" },
    ]);
  });
});
