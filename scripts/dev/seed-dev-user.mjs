#!/usr/bin/env node
/**
 * Seed a local development user so the AUTH_STUB=1 `X-User-Id` loop works.
 *
 * Since account creation moved to identity-link time, the `X-User-Id` header
 * names an existing user but never creates one (apps/api/src/middleware/auth.ts).
 * The local birth->chart curl flow and the PWA both default to
 * `usr_local_dev_0001`, so a fresh local D1 answers 401 until that user, its
 * crypto subject, and a wrapped DEK exist together.
 *
 * This inserts exactly that shape into the LOCAL D1 (`--local`), reproducing the
 * envelope encryption the Worker performs at link time. It reuses the shipped
 * dev ROOT_KEK derivation so the wrapped DEK the Worker later unwraps matches.
 * Idempotent: `INSERT OR IGNORE` never overwrites an existing DEK, so re-running
 * cannot orphan encrypted birth data.
 *
 * Usage (from the repository root):
 *   node scripts/dev/seed-dev-user.mjs [userId] [cryptoSubject]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

const userId = process.argv[2] ?? "usr_local_dev_0001";
const cryptoSubject = process.argv[3] ?? "cs_local_dev_00000001";

if (userId.length < 8) throw new Error("userId must be at least 8 characters");
if (!cryptoSubject.startsWith("cs_") || cryptoSubject.length < 8 || cryptoSubject.includes(":")) {
  throw new Error("cryptoSubject must start with cs_, be >= 8 chars, and contain no colon");
}

// Mirrors apps/api/src/crypto.ts. Kept in lockstep with the KEK derivation and
// AAD there; a drift would produce a DEK the Worker cannot unwrap, which surfaces
// immediately as a decrypt failure on the first chart read rather than silently.
const DEV_ROOT_KEK = "patternlike-dev-only-root-kek-change-me!!";
const KEK_DERIVATION_VERSION = 3;
const KEK_HKDF_SALT = new TextEncoder().encode("patternlike/kek/v2");
const KEK_HKDF_INFO = new TextEncoder().encode("patternlike:root-kek:aes-256-gcm");

async function deriveKek(material) {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: KEK_HKDF_SALT, info: KEK_HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function buildDekAad(subject, keyVersion) {
  return new TextEncoder().encode(
    JSON.stringify(["patternlike.dek", KEK_DERIVATION_VERSION, subject, keyVersion]),
  );
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const rootKey = await deriveKek(DEV_ROOT_KEK);
const dek = crypto.getRandomValues(new Uint8Array(32));
const nonce = crypto.getRandomValues(new Uint8Array(12));
const wrapped = new Uint8Array(
  await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: buildDekAad(cryptoSubject, 1) },
    rootKey,
    dek,
  ),
);

// user_keys.wrapped_dek is nonce(12) || ciphertext, stored as a BLOB.
const packed = new Uint8Array(nonce.length + wrapped.length);
packed.set(nonce, 0);
packed.set(wrapped, nonce.length);

const now = new Date().toISOString();
const sql = `
INSERT OR IGNORE INTO users (id, crypto_subject, status, locale, timezone,
                             entitlement_tier, created_at, updated_at)
VALUES ('${userId}', '${cryptoSubject}', 'active', 'en-US', 'UTC', 'free', '${now}', '${now}');

INSERT OR IGNORE INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at)
VALUES ('${userId}', 1, ${KEK_DERIVATION_VERSION}, X'${toHex(packed)}', '${now}');
`;

const dir = mkdtempSync(join(tmpdir(), "seed-dev-user-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql);

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "patternlike-ops", "--local", `--file=${file}`],
  { cwd: join(process.cwd(), "apps", "api"), stdio: "inherit" },
);

console.log(`\nseeded local dev user: ${userId} (crypto_subject ${cryptoSubject})`);
