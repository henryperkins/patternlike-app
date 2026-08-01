import type { Env } from "../env.js";
import {
  generateUserDek,
  resolveRootKey,
  wrapDek,
  encryptJson,
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

export async function ensureUserKey(
  env: Env,
  userId: string,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const row = await env.DB.prepare(
    "SELECT key_version, wrapped_dek FROM user_keys WHERE user_id = ? AND destroyed_at IS NULL",
  )
    .bind(userId)
    .first<{ key_version: number; wrapped_dek: ArrayBuffer }>();

  const root = await resolveRootKey(env.ROOT_KEK);

  if (row) {
    // M1 stub: re-generate session DEK is wrong for real unwrap; store raw DEK wrapped.
    // For local demo we re-derive is not possible without unwrap — generate new only if missing.
    // Production: unwrap with root key. Here we store wrapped DEK and keep in-memory only on create.
  }

  // If key exists we cannot recover DEK without storing unwrap path.
  // M1 approach: store wrapped form of DEK and also keep dek material recoverable via wrap/unwrap.
  if (row) {
    // Unwrap
    const wrapped = new Uint8Array(row.wrapped_dek);
    // Format: nonce(12) || ciphertext
    const nonce = wrapped.slice(0, 12);
    const ct = wrapped.slice(12);
    const dekBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      root,
      ct,
    );
    return { dek: new Uint8Array(dekBuf), keyVersion: row.key_version };
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
     VALUES (?, 1, 1, ?, ?)`,
  )
    .bind(userId, packed, now)
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
