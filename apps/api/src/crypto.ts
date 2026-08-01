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

/** Dev-only KEK derivation — replace with Secrets Store in production. */
export async function resolveRootKey(rootKek?: string): Promise<CryptoKey> {
  const material = rootKek ?? "patternlike-dev-only-root-kek-change-me!!";
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return importAesKey(new Uint8Array(hash));
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
