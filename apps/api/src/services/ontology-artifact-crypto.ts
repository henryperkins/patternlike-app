const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_KEYRING_BYTES = 8 * 1024;
const MAX_KEYS = 8;
const KEYRING_FIELDS = new Set(["version", "keys"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

export function encodeOntologyArtifactBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeOntologyArtifactBase64Url(
  value: string,
): Uint8Array | null {
  if (!BASE64URL.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
    return encodeOntologyArtifactBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

export async function hashOntologyArtifactBytes(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Parses the secret-only v1 ontology artifact keyring without logging it. */
export function parseOntologyArtifactKeyring(
  raw: string | undefined,
): Map<string, Uint8Array> | null {
  if (!raw || raw.length > MAX_KEYRING_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !hasExactFields(parsed, KEYRING_FIELDS) ||
    parsed.version !== 1 ||
    !isRecord(parsed.keys)
  ) {
    return null;
  }
  const entries = Object.entries(parsed.keys);
  if (entries.length === 0 || entries.length > MAX_KEYS) return null;
  const result = new Map<string, Uint8Array>();
  for (const [keyId, encoded] of entries) {
    if (!KEY_ID.test(keyId) || typeof encoded !== "string") return null;
    const key = decodeOntologyArtifactBase64Url(encoded);
    if (!key || key.byteLength !== 32) return null;
    result.set(keyId, key);
  }
  return result;
}

/** Stable selection keeps encryption deterministic across keyring JSON ordering. */
export function selectOntologyArtifactEncryptionKey(
  keyring: ReadonlyMap<string, Uint8Array>,
): { keyId: string; rawKey: Uint8Array } | null {
  const keyId = [...keyring.keys()].sort()[0];
  if (!keyId) return null;
  const rawKey = keyring.get(keyId);
  return rawKey ? { keyId, rawKey } : null;
}

export async function encryptOntologyArtifact(
  rawKey: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData,
      tagLength: 128,
    },
    key,
    plaintext,
  ));
}

export async function decryptOntologyArtifact(
  rawKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return new Uint8Array(await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData,
      tagLength: 128,
    },
    key,
    ciphertext,
  ));
}
