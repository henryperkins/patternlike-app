import type { Env } from "../env.js";
import {
  b64,
  generateUserDek,
  resolveRootKey,
  wrapDek,
  unwrapDek,
  encryptJson,
  decryptJson,
  KEK_DERIVATION_VERSION,
  type EncryptedPayload,
  type EncryptionContext,
  type RootKeyEnv,
} from "../crypto.js";

export async function ensureUser(db: D1Database, userId: string): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM users WHERE id = ?")
    .bind(userId)
    .first();
  if (existing) return;

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, status, locale, timezone, entitlement_tier, created_at, updated_at)
       VALUES (?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
    )
    .bind(userId, now, now)
    .run();
}

export class UserKeyDestroyedError extends Error {
  readonly code = "user_key_destroyed";
  constructor(userId: string) {
    super(`Encryption key for ${userId} has been destroyed`);
    this.name = "UserKeyDestroyedError";
  }
}

export class UnsupportedKekVersionError extends Error {
  readonly code = "kek_version_unsupported";
  constructor(found: number) {
    super(
      `user_keys.kek_version ${found} predates KEK derivation v${KEK_DERIVATION_VERSION}; ` +
        "recreate the local database with: npm run db:local -w @patternlike/api",
    );
    this.name = "UnsupportedKekVersionError";
  }
}

export class NoUserKeyError extends Error {
  readonly code = "user_key_missing";
  constructor(userId: string) {
    super(`No encryption key exists for ${userId}`);
    this.name = "NoUserKeyError";
  }
}

/** nonce(12) || ciphertext, as stored in user_keys.wrapped_dek. */
function packWrapped(nonce_b64: string, wrapped_b64: string): Uint8Array {
  const nonce = Uint8Array.from(atob(nonce_b64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(wrapped_b64), (c) => c.charCodeAt(0));
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return packed;
}

interface LiveKeyRow {
  key_version: number;
  kek_version: number;
  wrapped_dek: ArrayBuffer;
}

async function readLiveKey(env: Env, userId: string): Promise<LiveKeyRow | null> {
  return env.DB.prepare(
    `SELECT key_version, kek_version, wrapped_dek FROM user_keys
     WHERE user_id = ? AND destroyed_at IS NULL
     ORDER BY key_version DESC LIMIT 1`,
  )
    .bind(userId)
    .first<LiveKeyRow>();
}

export async function ensureUserKey(
  env: Env,
  userId: string,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const active = await readLiveKey(env, userId);
  const root = await resolveRootKey(env);

  if (active) {
    if (active.kek_version !== KEK_DERIVATION_VERSION) {
      throw new UnsupportedKekVersionError(active.kek_version);
    }
    const dek = await unwrapDek(
      new Uint8Array(active.wrapped_dek),
      root,
      userId,
      active.key_version,
    );
    return { dek, keyVersion: active.key_version };
  }

  // No live key. If one was destroyed the account was crypto-shredded, and
  // minting a fresh DEK would quietly undo that, so refuse instead. Previously
  // this path 500ed forever: the destroyed_at IS NULL lookup missed while the
  // insert still collided on the user_id primary key.
  const destroyed = await env.DB.prepare(
    "SELECT 1 AS present FROM user_keys WHERE user_id = ? LIMIT 1",
  )
    .bind(userId)
    .first<{ present: number }>();
  if (destroyed) {
    throw new UserKeyDestroyedError(userId);
  }

  const dek = await generateUserDek();
  const { wrapped_b64, nonce_b64 } = await wrapDek(dek, root, userId, 1);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
     VALUES (?, 1, ?, ?, ?)`,
  )
    .bind(userId, KEK_DERIVATION_VERSION, packWrapped(nonce_b64, wrapped_b64), now)
    .run();

  return { dek, keyVersion: 1 };
}

export async function encryptPayload(
  env: Env,
  userId: string,
  value: unknown,
  ctx: EncryptionContext,
): Promise<EncryptedPayload & { keyVersion: number }> {
  const { dek, keyVersion } = await ensureUserKey(env, userId);
  const enc = await encryptJson(value, dek, keyVersion, ctx);
  return { ...enc, keyVersion: enc.key_version };
}

export async function decryptPayload<T = unknown>(
  env: Env,
  userId: string,
  payload: Pick<EncryptedPayload, "key_version" | "nonce" | "ciphertext">,
  ctx: EncryptionContext,
): Promise<T> {
  const { dek } = await ensureUserKey(env, userId);
  return decryptJson<T>(payload, dek, ctx);
}

/**
 * Re-wrap a user's DEK under a new root secret.
 *
 * The DEK itself is unchanged, so no stored ciphertext is touched — this is the
 * cheap half of key rotation, for when ROOT_KEK is replaced. `previous` must
 * resolve to the root key the DEK is currently wrapped under; `env` carries the
 * new one. Run it for every user in one pass: there is no per-row record of
 * which secret wrapped which key.
 */
export async function rewrapUserKey(
  env: Env,
  userId: string,
  previous: RootKeyEnv,
): Promise<{ keyVersion: number }> {
  const active = await readLiveKey(env, userId);
  if (!active) throw new NoUserKeyError(userId);
  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  const oldRoot = await resolveRootKey(previous);
  const dek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    oldRoot,
    userId,
    active.key_version,
  );

  const newRoot = await resolveRootKey(env);
  const { wrapped_b64, nonce_b64 } = await wrapDek(
    dek,
    newRoot,
    userId,
    active.key_version,
  );

  await env.DB.prepare(
    `UPDATE user_keys SET wrapped_dek = ?, rotated_at = ?
     WHERE user_id = ? AND key_version = ?`,
  )
    .bind(
      packWrapped(nonce_b64, wrapped_b64),
      new Date().toISOString(),
      userId,
      active.key_version,
    )
    .run();

  return { keyVersion: active.key_version };
}

/**
 * Every column holding DEK-encrypted data, with the identifier that forms the
 * AAD's recordId. Rotation walks this list.
 *
 * Adding a new encrypted column WITHOUT adding it here would leave its data
 * under a destroyed key. `assertNoUnrotatedCiphertext` below is the tripwire.
 */
const ENCRYPTED_COLUMNS = [
  {
    table: "birth_profiles",
    idColumn: "version",
    encColumn: "payload_enc",
    keyVersionColumn: "payload_key_version",
    nonceColumn: "payload_nonce",
  },
  {
    table: "chart_snapshots",
    idColumn: "id",
    encColumn: "birth_enc",
    keyVersionColumn: "birth_key_version",
    nonceColumn: "birth_nonce",
  },
] as const;

async function assertNoUnrotatedCiphertext(
  env: Env,
  userId: string,
  newKeyVersion: number,
): Promise<void> {
  // chart_snapshots.snapshot_enc is declared but nothing writes it yet. If that
  // changes, it must join ENCRYPTED_COLUMNS or its data becomes unreadable at
  // the next rotation. Fail loudly rather than silently orphan it.
  const orphan = await env.DB.prepare(
    `SELECT id FROM chart_snapshots
     WHERE user_id = ? AND snapshot_enc IS NOT NULL
       AND (snapshot_key_version IS NULL OR snapshot_key_version <> ?)
     LIMIT 1`,
  )
    .bind(userId, newKeyVersion)
    .first<{ id: string }>();

  if (orphan) {
    throw new Error(
      `chart_snapshots.snapshot_enc holds ciphertext that key rotation does not cover ` +
        `(chart ${orphan.id}). Add it to ENCRYPTED_COLUMNS in apps/api/src/db/users.ts.`,
    );
  }
}

/**
 * Rotate a user's DEK: generate a new one, re-encrypt everything it protects,
 * and destroy the old key.
 *
 * All reads and re-encryption happen before any write, and the writes go in a
 * single D1 batch, so a failure leaves the old key live and the old ciphertext
 * intact rather than half-rotated and unreadable.
 */
export async function rotateUserDek(
  env: Env,
  userId: string,
): Promise<{ keyVersion: number; reencrypted: number }> {
  const active = await readLiveKey(env, userId);
  if (!active) throw new NoUserKeyError(userId);
  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  const root = await resolveRootKey(env);
  const oldDek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    root,
    userId,
    active.key_version,
  );
  const newKeyVersion = active.key_version + 1;
  const newDek = await generateUserDek();

  const writes: D1PreparedStatement[] = [];
  let reencrypted = 0;

  for (const col of ENCRYPTED_COLUMNS) {
    const found = await env.DB.prepare(
      `SELECT ${col.idColumn} AS record_id, ${col.encColumn} AS enc,
              ${col.keyVersionColumn} AS key_version, ${col.nonceColumn} AS nonce
       FROM ${col.table}
       WHERE user_id = ? AND ${col.encColumn} IS NOT NULL`,
    )
      .bind(userId)
      .all<{
        record_id: string | number;
        enc: ArrayBuffer;
        key_version: number;
        nonce: string;
      }>();

    for (const row of found.results) {
      const ctx: EncryptionContext = {
        userId,
        field: `${col.table}.${col.encColumn}`,
        recordId: String(row.record_id),
      };
      const plain = await decryptJson(
        {
          key_version: row.key_version,
          nonce: row.nonce,
          ciphertext: b64(new Uint8Array(row.enc)),
        },
        oldDek,
        ctx,
      );
      const sealed = await encryptJson(plain, newDek, newKeyVersion, ctx);
      writes.push(
        env.DB.prepare(
          `UPDATE ${col.table}
           SET ${col.encColumn} = ?, ${col.keyVersionColumn} = ?, ${col.nonceColumn} = ?
           WHERE user_id = ? AND ${col.idColumn} = ?`,
        ).bind(
          Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0)),
          newKeyVersion,
          sealed.nonce,
          userId,
          row.record_id,
        ),
      );
      reencrypted++;
    }
  }

  const now = new Date().toISOString();
  const { wrapped_b64, nonce_b64 } = await wrapDek(newDek, root, userId, newKeyVersion);

  // Destroy the old key before inserting the new one: uq_user_keys_active
  // permits only one row with destroyed_at IS NULL.
  writes.push(
    env.DB.prepare(
      `UPDATE user_keys SET rotated_at = ?, destroyed_at = ?
       WHERE user_id = ? AND key_version = ?`,
    ).bind(now, now, userId, active.key_version),
    env.DB.prepare(
      `INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      newKeyVersion,
      KEK_DERIVATION_VERSION,
      packWrapped(nonce_b64, wrapped_b64),
      now,
    ),
  );

  await env.DB.batch(writes);
  await assertNoUnrotatedCiphertext(env, userId, newKeyVersion);

  return { keyVersion: newKeyVersion, reencrypted };
}
