import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  loadUserKey,
  rewrapUserKey,
  rotateUserDek,
} from "./users.js";
import type { EncryptionContext } from "../crypto.js";
import { resetDb, rows } from "../../test/helpers.js";
import {
  ALICE,
  USER_A,
  USER_OTHER,
  SUBJECT_A,
  IDENTITY_A,
  IDENTITY_OTHER,
  confirmPreferences,
  postBirthProfile,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { claimJob } from "./generation.js";
import { enqueueDailyReading } from "../services/enqueue.js";
import { dispatchGeneration } from "../services/generate-daily-reading.js";

const NEW_ROOT_KEK = "a-rotated-root-kek-with-enough-entropy-01";

const CTX: EncryptionContext = {
  subject: SUBJECT_A,
  field: "birth_profiles.payload_enc",
  recordId: "1",
};

// Users are created at identity-link time now, not implicitly on first write,
// so every suite seeds the users it authenticates as. seedUser is a bare
// INSERT rather than an upsert, so seed here and nowhere else.
beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_OTHER);
});

describe("KEK rewrap", () => {
  it("keeps the DEK usable after the root secret changes", async () => {
    const sealed = await encryptPayload(env, IDENTITY_A, { birth_date: "1990-05-15" }, CTX);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, IDENTITY_A, env);

    const out = await decryptPayload<{ birth_date: string }>(
      rotated,
      IDENTITY_A,
      sealed,
      CTX,
    );
    expect(out.birth_date).toBe("1990-05-15");
  });

  it("makes the old root secret unable to unwrap the key", async () => {
    await encryptPayload(env, IDENTITY_A, { birth_date: "1990-05-15" }, CTX);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, IDENTITY_A, env);

    await expect(loadUserKey(env, IDENTITY_A)).rejects.toThrow();
  });

  it("does not change the DEK version — only the wrapping", async () => {
    const before = await loadUserKey(env, IDENTITY_A);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, IDENTITY_A, env);

    // `rotated`, not `env`: after the rewrap the DEK is sealed under the NEW
    // root secret, so reading it back with the old one would throw.
    const after = await loadUserKey(rotated, IDENTITY_A);
    expect(after.keyVersion).toBe(before.keyVersion);
    expect(Array.from(after.dek)).toEqual(Array.from(before.dek));
  });

  it("stamps rotated_at and keeps exactly one live key", async () => {
    await loadUserKey(env, IDENTITY_A);

    const rotated = { ...env, ROOT_KEK: NEW_ROOT_KEK } as Env;
    await rewrapUserKey(rotated, IDENTITY_A, env);

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
    const result = await rotateUserDek(env, IDENTITY_A);
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
    await rotateUserDek(env, IDENTITY_A);

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
    const out = await decryptPayload<{
      schema_version: string;
      submitted: { birth_date: string };
    }>(
      env,
      IDENTITY_A,
      {
        key_version: r.payload_key_version,
        nonce: r.payload_nonce,
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(r.payload_enc))),
      },
      {
        subject: SUBJECT_A,
        field: "birth_profiles.payload_enc",
        recordId: String(r.version),
      },
    );
    expect(out.schema_version).toBe("birth-calc-command/v1");
    expect(out.submitted.birth_date).toBe("1990-05-15");
  });

  it("bumps payload_key_version on every re-encrypted row", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    await rotateUserDek(env, IDENTITY_A);

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
    await rotateUserDek(env, IDENTITY_A);

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
    await rotateUserDek(env, IDENTITY_A);
    const second = await rotateUserDek(env, IDENTITY_A);
    expect(second.keyVersion).toBe(3);

    const live = await rows(
      "SELECT key_version FROM user_keys WHERE user_id = ? AND destroyed_at IS NULL",
      USER_A,
    );
    expect(live).toHaveLength(1);
  });

  it("leaves other users untouched", async () => {
    await postBirthProfile(USER_A, "rotate-key-01", ALICE);
    // USER_OTHER, not a bare literal: resetDb truncates users, so an unseeded
    // id would 401 at the route, leave `other` empty, and make the assertion
    // below pass vacuously — [].every(...) is true.
    await postBirthProfile(USER_OTHER, "rotate-key-02", {
      ...ALICE,
      birth_date: "1988-03-03",
    });

    await rotateUserDek(env, IDENTITY_A);

    const other = await rows<{ payload_key_version: number }>(
      "SELECT payload_key_version FROM birth_profiles WHERE user_id = ?",
      USER_OTHER,
    );
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((p) => p.payload_key_version === 1)).toBe(true);
  });
});

/**
 * The three columns M3 added, rotated through a real generated reading.
 *
 * `encrypted-columns.test.ts` proves each is registered; this proves the walk
 * actually reaches them. The distinction matters because all three reach the
 * walker through a `user_id` the rotation query filters on, and
 * `reading_sources.user_id` exists for exactly that reason — a column that is
 * registered but unreachable would still leave its data under a destroyed key.
 */
describe("DEK rotation over the M3 pipeline columns", () => {
  beforeEach(async () => {
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await seedActiveRelease();
  });

  it("re-encrypts the command, the prose, and every evidence row", async () => {
    const enqueued = await enqueueDailyReading(env, USER_A);
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    const claim = await claimJob(env, enqueued.jobId);
    expect(await dispatchGeneration(env, claim!)).toMatchObject({ ok: true });

    const before = await rows<{ n: number }>(
      `SELECT
         (SELECT COUNT(*) FROM jobs WHERE user_id = ? AND payload_enc IS NOT NULL)
       + (SELECT COUNT(*) FROM daily_readings WHERE user_id = ? AND reading_enc IS NOT NULL)
       + (SELECT COUNT(*) FROM reading_sources WHERE user_id = ?) AS n`,
      USER_A,
      USER_A,
      USER_A,
    );
    expect(before[0]!.n).toBeGreaterThan(2);

    const result = await rotateUserDek(env, IDENTITY_A);
    expect(result.keyVersion).toBe(2);
    // Birth profile and chart snapshot are covered by the suite above; these
    // three are the M3 additions.
    expect(result.reencrypted).toBeGreaterThanOrEqual(before[0]!.n);

    for (const [table, column] of [
      ["jobs", "payload_key_version"],
      ["daily_readings", "reading_key_version"],
      ["reading_sources", "evidence_key_version"],
    ] as const) {
      const stale = await rows(
        `SELECT rowid FROM ${table} WHERE user_id = ? AND ${column} IS NOT NULL AND ${column} != 2`,
        USER_A,
      );
      expect(stale, `${table}.${column} was not rotated`).toEqual([]);
    }

    // Readable under the new key, which is the part a version bump alone does
    // not prove.
    const [reading] = await rows<{
      id: string;
      reading_enc: ArrayBuffer;
      reading_key_version: number;
      reading_nonce: string;
    }>(
      `SELECT id, reading_enc, reading_key_version, reading_nonce
       FROM daily_readings WHERE user_id = ?`,
      USER_A,
    );
    let binary = "";
    for (const byte of new Uint8Array(reading!.reading_enc)) {
      binary += String.fromCharCode(byte);
    }
    const stored = await decryptPayload<{ assembly_id: string }>(
      env,
      IDENTITY_A,
      {
        key_version: reading!.reading_key_version,
        nonce: reading!.reading_nonce,
        ciphertext: btoa(binary),
      },
      {
        subject: SUBJECT_A,
        field: "daily_readings.reading_enc",
        recordId: reading!.id,
      },
    );
    expect(stored.assembly_id).toMatch(/^asm_[a-f0-9]{32}$/);
  });
});

/**
 * `context_signals.value_enc`, registered before its first writer exists.
 *
 * The column has been declared since 0001 and nothing has ever written it. M5's
 * context compiler is the first writer, so the registration has to land first:
 * a column written while it sits in UNWRITTEN_ENCRYPTED_COLUMNS is left under a
 * destroyed key at the next rotation, and nothing reports that until a reader
 * asks for a value that no longer decrypts.
 *
 * A version bump alone would not prove it. This writes real ciphertext, rotates,
 * and reads the plaintext back under the new key.
 */
describe("DEK rotation over context_signals.value_enc", () => {
  it("decrypts and re-encrypts a stored context value under the new key", async () => {
    const signalId = "sig_ctx_rotation_01";
    const sealed = await encryptPayload(
      env,
      IDENTITY_A,
      { text: "Third week of the migration." },
      {
        subject: SUBJECT_A,
        field: "context_signals.value_enc",
        recordId: signalId,
      },
    );

    await env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, evidence_lane, allowed_uses_json, confidence,
          sensitivity, permission_state, freshness_status, observed_at, ingested_at,
          value_encoding, value_enc, value_key_version, value_nonce, normalized_hash,
          created_at, updated_at)
       VALUES (?, ?, 'USR-02', 'user_and_context', '["life_domain_selection"]', 'high',
               'normal', 'active', 'fresh', ?, ?, 'encrypted', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        signalId,
        USER_A,
        "2026-08-09T10:00:00Z",
        "2026-08-09T10:00:01Z",
        Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0)),
        sealed.keyVersion,
        sealed.nonce,
        "a".repeat(64),
        "2026-08-09T10:00:01Z",
        "2026-08-09T10:00:01Z",
      )
      .run();

    const result = await rotateUserDek(env, IDENTITY_A);
    expect(result.keyVersion).toBe(2);

    const [row] = await rows<{
      value_enc: ArrayBuffer;
      value_key_version: number;
      value_nonce: string;
    }>(
      "SELECT value_enc, value_key_version, value_nonce FROM context_signals WHERE id = ?",
      signalId,
    );
    expect(row?.value_key_version).toBe(2);

    let binary = "";
    for (const byte of new Uint8Array(row!.value_enc)) binary += String.fromCharCode(byte);
    const plain = await decryptPayload<{ text: string }>(
      env,
      IDENTITY_A,
      {
        key_version: row!.value_key_version,
        nonce: row!.value_nonce,
        ciphertext: btoa(binary),
      },
      {
        subject: SUBJECT_A,
        field: "context_signals.value_enc",
        recordId: signalId,
      },
    );
    expect(plain.text).toBe("Third week of the migration.");
  });
});
