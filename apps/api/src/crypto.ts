/**
 * Envelope encryption helpers (AES-256-GCM + per-user DEK).
 * M1: local stub uses ROOT_KEK or a dev-only fixed key material.
 */

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** The placeholder that shipped in the repository. Never valid outside dev. */
export const DEV_ROOT_KEK = "patternlike-dev-only-root-kek-change-me!!";

/**
 * Bumped from 1 when the derivation moved from a bare unsalted SHA-256 of the
 * passphrase to HKDF-SHA256 with a salt and domain separation. Ciphertext
 * produced under v1 is not readable under v2; M0 is pre-production, so local
 * databases are recreated rather than migrated. See db/d1/MIGRATIONS.json.
 */
export const KEK_DERIVATION_VERSION = 2;

const KEK_HKDF_SALT = new TextEncoder().encode("patternlike/kek/v2");
const KEK_HKDF_INFO = new TextEncoder().encode("patternlike:root-kek:aes-256-gcm");

const MIN_ROOT_KEK_LENGTH = 32;

export interface RootKeyEnv {
  ROOT_KEK?: string;
  ENVIRONMENT?: string;
}

export class RootKekError extends Error {
  readonly code = "root_kek_not_configured";
  constructor(message: string) {
    super(message);
    this.name = "RootKekError";
  }
}

export function isDevEnvironment(environment: string | undefined): boolean {
  return environment === "development" || environment === "test";
}

async function deriveKek(material: string): Promise<CryptoKey> {
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

/**
 * Resolve the root KEK.
 *
 * Outside development a missing, placeholder, or implausibly short ROOT_KEK is
 * a hard failure. The previous behaviour was to fall back silently to a string
 * committed in this repository, so a deploy that forgot the secret encrypted
 * every user's birth date, time, and coordinates under a key any reader of the
 * source could derive, with nothing failing or warning.
 */
export async function resolveRootKey(env: RootKeyEnv): Promise<CryptoKey> {
  const configured = env.ROOT_KEK?.trim();
  const dev = isDevEnvironment(env.ENVIRONMENT);

  if (!configured) {
    if (!dev) {
      throw new RootKekError(
        "ROOT_KEK is not configured; set it with `wrangler secret put ROOT_KEK`",
      );
    }
    return deriveKek(DEV_ROOT_KEK);
  }
  if (configured === DEV_ROOT_KEK && !dev) {
    throw new RootKekError("ROOT_KEK is set to the development placeholder");
  }
  if (configured.length < MIN_ROOT_KEK_LENGTH) {
    throw new RootKekError(
      `ROOT_KEK must be at least ${MIN_ROOT_KEK_LENGTH} characters`,
    );
  }
  return deriveKek(configured);
}

export async function generateUserDek(): Promise<Uint8Array> {
  const dek = new Uint8Array(32);
  crypto.getRandomValues(dek);
  return dek;
}

export async function wrapDek(
  dek: Uint8Array,
  rootKey: CryptoKey,
): Promise<{ wrapped_b64: string; nonce_b64: string }> {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    rootKey,
    dek,
  );
  return { wrapped_b64: b64(ct), nonce_b64: b64(nonce) };
}

export async function encryptJson(
  value: unknown,
  dek: Uint8Array,
  keyVersion: number,
): Promise<{
  alg: "AES-256-GCM";
  key_version: number;
  nonce: string;
  ciphertext: string;
}> {
  const key = await importAesKey(dek);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    pt,
  );
  return {
    alg: "AES-256-GCM",
    key_version: keyVersion,
    nonce: b64(nonce),
    ciphertext: b64(ct),
  };
}

export { fromB64, b64 };
