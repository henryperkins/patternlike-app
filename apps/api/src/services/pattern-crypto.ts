import {
  b64,
  decryptJson,
  encryptJson,
  fromB64,
  type CryptoSubject,
} from "../crypto.js";
import type { Env } from "../env.js";
import { encryptPayload, loadUserKey, type UserIdentity } from "../db/users.js";

export const PATTERN_ARTIFACT_AAD_LABEL = "patternlike.pattern-artifact";

export async function wrapContentKey(
  env: Env,
  identity: UserIdentity,
  recordId: string,
  field: string,
  key: Uint8Array,
  extra: Record<string, string>,
) {
  return encryptPayload(env, identity, { key: b64(key), ...extra }, {
    subject: identity.cryptoSubject,
    field,
    recordId,
  });
}

export async function unwrapContentKey(
  env: Env,
  identity: UserIdentity,
  recordId: string,
  field: string,
  payload: { key_version: number; nonce: string; ciphertext: string },
): Promise<Uint8Array> {
  const { dek } = await loadUserKey(env, identity);
  const plain = await decryptJson<{ key: string }>(payload, dek, {
    subject: identity.cryptoSubject,
    field,
    recordId,
  });
  return fromB64(plain.key);
}

export async function encryptUnderContentKey(
  value: unknown,
  contentKey: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, pt);
  return new Uint8Array(ct);
}

export async function decryptUnderContentKey<T>(
  ciphertext: Uint8Array,
  contentKey: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Promise<T> {
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export function artifactAad(
  generationId: string,
  artifactId: string,
  artifactClass: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([PATTERN_ARTIFACT_AAD_LABEL, 1, generationId, artifactId, artifactClass]),
  );
}

export function randomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

export function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  return nonce;
}

export { b64, encryptJson, decryptJson };
export type { CryptoSubject };
