import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  ensureUser,
  ensureUserKey,
  rewrapUserKey,
  rotateUserDek,
} from "./users.js";
import type { EncryptionContext } from "../crypto.js";
import { resetDb, rows } from "../../test/helpers.js";
import { ALICE, USER_A, postBirthProfile } from "../../test/helpers.js";

const NEW_ROOT_KEK = "a-rotated-root-kek-with-enough-entropy-01";

const CTX: EncryptionContext = {
  userId: USER_A,
  field: "birth_profiles.payload_enc",
  recordId: "1",
};

beforeEach(resetDb);

describe("KEK rewrap", () => {
  it("keeps the DEK usable after the root secret changes", async () => {
    await ensureUser(env.DB, USER_A);
    const sealed = await encryptPayload(env, USER_A, { birth_date: "1990-05-15" }, CTX);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, USER_A, env);

    const out = await decryptPayload<{ birth_date: string }>(rotated, USER_A, sealed, CTX);
    expect(out.birth_date).toBe("1990-05-15");
  });

  it("makes the old root secret unable to unwrap the key", async () => {
    await ensureUser(env.DB, USER_A);
    await encryptPayload(env, USER_A, { birth_date: "1990-05-15" }, CTX);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, USER_A, env);

    await expect(ensureUserKey(env, USER_A)).rejects.toThrow();
  });

  it("does not change the DEK version — only the wrapping", async () => {
    await ensureUser(env.DB, USER_A);
    const before = await ensureUserKey(env, USER_A);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, USER_A, env);

    const after = await ensureUserKey(rotated, USER_A);
    expect(after.keyVersion).toBe(before.keyVersion);
    expect(Array.from(after.dek)).toEqual(Array.from(before.dek));
  });

  it("stamps rotated_at and keeps exactly one live key", async () => {
    await ensureUser(env.DB, USER_A);
    await ensureUserKey(env, USER_A);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, USER_A, env);

    const keys = await rows<{ rotated_at: string | null; destroyed_at: string | null }>(
      "SELECT rotated_at, destroyed_at FROM user_keys WHERE user_id = ?",
      USER_A,
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]!.rotated_at).toBeTruthy();
    expect(keys[0]!.destroyed_at).toBeNull();
  });
});

describe("DEK rotation", () => {
  it("re-encrypts stored birth data under a new key", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);

    const before = await rows<{ payload_enc: ArrayBuffer }>(
      "SELECT payload_enc FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    const result = await rotateUserDek(env, USER_A);
    const after = await rows<{ payload_enc: ArrayBuffer }>(
      "SELECT payload_enc FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );

    expect(result.keyVersion).toBe(2);
    expect(result.reencrypted).toBeGreaterThan(0);
    // Bytes must actually differ; a no-op rotation would silently pass a
    // decryptability check while leaving the old key material load-bearing.
    expect(Array.from(new Uint8Array(after[0]!.payload_enc))).not.toEqual(
      Array.from(new Uint8Array(before[0]!.payload_enc)),
    );
  });

  it("leaves the re-encrypted data readable under the new key", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await rotateUserDek(env, USER_A);

    const row = await rows<{
      version: number;
      payload_key_version: number;
      payload_nonce: string;
      payload_enc: ArrayBuffer;
    }>(
      "SELECT version, payload_key_version, payload_nonce, payload_enc FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    const r = row[0]!;
    const out = await decryptPayload<{ birth_date: string }>(
      env,
      USER_A,
      {
        key_version: r.payload_key_version,
        nonce: r.payload_nonce,
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(r.payload_enc))),
      },
      {
        userId: USER_A,
        field: "birth_profiles.payload_enc",
        recordId: String(r.version),
      },
    );
    expect(out.birth_date).toBe("1990-05-15");
  });

  it("bumps payload_key_version on every re-encrypted row", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await rotateUserDek(env, USER_A);

    const profiles = await rows<{ payload_key_version: number }>(
      "SELECT payload_key_version FROM birth_profiles WHERE user_id = ?",
      USER_A,
    );
    const charts = await rows<{ birth_key_version: number }>(
      "SELECT birth_key_version FROM chart_snapshots WHERE user_id = ?",
      USER_A,
    );
    expect(profiles.every((p) => p.payload_key_version === 2)).toBe(true);
    expect(charts.every((c) => c.birth_key_version === 2)).toBe(true);
  });

  it("destroys the superseded key and keeps exactly one live", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await rotateUserDek(env, USER_A);

    const keys = await rows<{
      key_version: number;
      rotated_at: string | null;
      destroyed_at: string | null;
    }>("SELECT key_version, rotated_at, destroyed_at FROM user_keys WHERE user_id = ? ORDER BY key_version", USER_A);

    expect(keys).toHaveLength(2);
    expect(keys[0]!.destroyed_at).toBeTruthy();
    expect(keys[0]!.rotated_at).toBeTruthy();
    expect(keys[1]!.destroyed_at).toBeNull();
    expect(keys.filter((k) => k.destroyed_at === null)).toHaveLength(1);
  });

  it("rotates twice without collision", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await rotateUserDek(env, USER_A);
    const second = await rotateUserDek(env, USER_A);
    expect(second.keyVersion).toBe(3);

    const live = await rows(
      "SELECT key_version FROM user_keys WHERE user_id = ? AND destroyed_at IS NULL",
      USER_A,
    );
    expect(live).toHaveLength(1);
  });

  it("leaves other users untouched", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await postBirthProfile("usr_test_other_00001", "rotate-key-02", {
      ...ALICE,
      birth_date: "1988-03-03",
    });

    await rotateUserDek(env, USER_A);

    const other = await rows<{ payload_key_version: number }>(
      "SELECT payload_key_version FROM birth_profiles WHERE user_id = ?",
      "usr_test_other_00001",
    );
    expect(other.every((p) => p.payload_key_version === 1)).toBe(true);
  });
});
