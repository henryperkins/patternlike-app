import type { Env } from "../env.js";
import {
  generateUserDek,
  resolveRootKey,
  wrapDek,
  encryptJson,
  KEK_DERIVATION_VERSION,
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

export async function ensureUserKey(
  env: Env,
  userId: string,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const active = await env.DB.prepare(
    `SELECT key_version, kek_version, wrapped_dek FROM user_keys
     WHERE user_id = ? AND destroyed_at IS NULL
     ORDER BY key_version DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ key_version: number; kek_version: number; wrapped_dek: ArrayBuffer }>();

  const root = await resolveRootKey(env);

  if (active) {
    if (active.kek_version !== KEK_DERIVATION_VERSION) {
      throw new UnsupportedKekVersionError(active.kek_version);
    }
    // Stored as nonce(12) || ciphertext
    const wrapped = new Uint8Array(active.wrapped_dek);
    const nonce = wrapped.slice(0, 12);
    const ct = wrapped.slice(12);
    const dekBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      root,
      ct,
    );
    return { dek: new Uint8Array(dekBuf), keyVersion: active.key_version };
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
  const { wrapped_b64, nonce_b64 } = await wrapDek(dek, root);
  // Store nonce||ciphertext as BLOB via base64 decode in JS
  const nonce = Uint8Array.from(atob(nonce_b64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(wrapped_b64), (c) => c.charCodeAt(0));
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
     VALUES (?, 1, ?, ?, ?)`,
  )
    .bind(userId, KEK_DERIVATION_VERSION, packed, now)
    .run();

  return { dek, keyVersion: 1 };
}

export async function encryptPayload(
  env: Env,
  userId: string,
  value: unknown,
): Promise<{
  enc: ReturnType<typeof encryptJson> extends Promise<infer T> ? T : never;
  keyVersion: number;
  nonce: string;
  ciphertext: string;
}> {
  const { dek, keyVersion } = await ensureUserKey(env, userId);
  const enc = await encryptJson(value, dek, keyVersion);
  return {
    enc,
    keyVersion: enc.key_version,
    nonce: enc.nonce,
    ciphertext: enc.ciphertext,
  };
}
