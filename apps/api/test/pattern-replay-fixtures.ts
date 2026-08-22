import type { Env } from "../src/env.js";

export interface PatternReplayTestKeys {
  signingSecret: string;
  publicKeyring: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePatternReplayTestKeys(
  keyId = "replay-test-2026-08",
): Promise<PatternReplayTestKeys> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKeyPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer,
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer,
  );
  return {
    signingSecret: JSON.stringify({
      version: 1,
      key_id: keyId,
      private_key_pkcs8: toBase64Url(privateKeyPkcs8),
    }),
    publicKeyring: JSON.stringify({
      [keyId]: {
        alg: "Ed25519",
        public_key: toBase64Url(publicKey),
      },
    }),
  };
}

export function installPatternReplayTestKeys(
  target: Env,
  keys: PatternReplayTestKeys,
): void {
  target.PATTERN_REPLAY_LEDGER_SIGNING_KEY = keys.signingSecret;
  target.PATTERN_REPLAY_LEDGER_KEYS = keys.publicKeyring;
}

export function patternReplayTestEnv(
  target: Env,
  overrides: Partial<Env>,
): Env {
  return new Proxy(target, {
    get(base, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property, overrides);
      }
      return Reflect.get(base, property, receiver);
    },
  });
}

export async function clearPatternReplayObjects(bucket: R2Bucket): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: "pattern-erasure-replay/",
      cursor,
    });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
