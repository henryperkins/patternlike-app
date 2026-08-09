import baseFixture from "../../../contracts/m0/fixtures/valid/content-release.bundle.json";
import { SCHEMA_VERSION } from "@patternlike/shared";
import {
  RELEASE_OBJECT_COLLECTIONS,
  bundleSigningPayload,
  computeBundleHash,
  computeObjectHash,
  type ContentReleaseBundle,
  type SignatureAlgorithm,
} from "../src/services/content-release.js";

/**
 * Signed test bundles, built from the frozen contract fixture.
 *
 * The base body is `contracts/m0/fixtures/valid/content-release.bundle.json`
 * rather than a copy of it, so a change to the frozen fixture reaches these
 * tests instead of leaving them asserting against a shape the contract no
 * longer describes. Its hashes and signature are placeholders — this module
 * recomputes both, which is why no key material is committed anywhere: every
 * run mints an ephemeral keypair.
 */

export interface ReleaseSigningKey {
  keyId: string;
  alg: SignatureAlgorithm;
  /** Raw public key, base64url — the form CONTENT_RELEASE_KEYS carries. */
  publicKeyB64Url: string;
  privateKey: CryptoKey;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mirrors the runtime's import fallback so tests run on either workerd spelling. */
function keyGenParams(alg: SignatureAlgorithm): SubtleCryptoGenerateKeyAlgorithm[] {
  if (alg === "ES256") return [{ name: "ECDSA", namedCurve: "P-256" }];
  return [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }];
}

function signParams(alg: SignatureAlgorithm, key: CryptoKey): SubtleCryptoSignAlgorithm {
  if (alg === "ES256") return { name: "ECDSA", hash: "SHA-256" };
  return { name: key.algorithm.name };
}

export async function generateSigningKey(
  keyId: string,
  alg: SignatureAlgorithm = "Ed25519",
): Promise<ReleaseSigningKey> {
  let lastError: unknown;
  for (const params of keyGenParams(alg)) {
    try {
      const pair = (await crypto.subtle.generateKey(params, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
      return {
        keyId,
        alg,
        publicKeyB64Url: toBase64Url(new Uint8Array(raw)),
        privateKey: pair.privateKey,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Runtime cannot generate ${alg} keys: ${String(lastError)}`);
}

export function releaseKeysVar(keys: ReleaseSigningKey[]): string {
  return JSON.stringify(
    Object.fromEntries(
      keys.map((key) => [key.keyId, { alg: key.alg, public_key: key.publicKeyB64Url }]),
    ),
  );
}

/**
 * A mutable deep copy of the contract fixture, before hashing and signing.
 * Mutate it to build the rejection cases; `signBundle` then produces a bundle
 * that is cryptographically sound and wrong in exactly one way, which is the
 * only way to prove a policy check is what rejected it.
 */
export function draftBundle(
  mutate: (bundle: ContentReleaseBundle) => void = () => {},
): ContentReleaseBundle {
  const bundle = JSON.parse(JSON.stringify(baseFixture)) as ContentReleaseBundle;
  mutate(bundle);
  return bundle;
}

export async function signBundle(
  bundle: ContentReleaseBundle,
  key: ReleaseSigningKey,
): Promise<ContentReleaseBundle> {
  // Object hashes first: they are part of the body the bundle hash covers.
  for (const collection of RELEASE_OBJECT_COLLECTIONS) {
    for (const object of bundle.objects[collection]) {
      object.object_hash = await computeObjectHash(object);
    }
  }

  const bundleHash = await computeBundleHash(bundle);
  bundle.release.bundle_hash = bundleHash;

  const payload = new TextEncoder().encode(bundleSigningPayload(bundle));
  const signature = await crypto.subtle.sign(
    signParams(key.alg, key.privateKey),
    key.privateKey,
    payload,
  );

  bundle.signature = {
    alg: key.alg,
    key_id: key.keyId,
    signature: toBase64Url(new Uint8Array(signature)),
    signed_payload_hash: bundleHash,
  };
  return bundle;
}

/**
 * Re-hash a tampered bundle without re-signing it.
 *
 * This is the attacker with write access to the CMS but not to the signing key:
 * they can recompute every hash the bundle asserts about itself, so the hash
 * checks pass and only the signature stands between them and the runtime.
 */
export async function resealWithoutSigning(
  bundle: ContentReleaseBundle,
): Promise<ContentReleaseBundle> {
  for (const collection of RELEASE_OBJECT_COLLECTIONS) {
    for (const object of bundle.objects[collection]) {
      object.object_hash = await computeObjectHash(object);
    }
  }
  const bundleHash = await computeBundleHash(bundle);
  bundle.release.bundle_hash = bundleHash;
  bundle.signature.signed_payload_hash = bundleHash;
  return bundle;
}

/** Sign a fresh copy of the fixture in one step. */
export async function signedBundle(
  key: ReleaseSigningKey,
  mutate: (bundle: ContentReleaseBundle) => void = () => {},
): Promise<ContentReleaseBundle> {
  return signBundle(draftBundle(mutate), key);
}

/** The fixture declares smoke-test fixtures; most cases want a bundle without them. */
export function withoutFixtures(bundle: ContentReleaseBundle): void {
  delete bundle.fixtures;
}

export interface IngestionOptions {
  idempotencyKey?: string;
  activate?: boolean;
}

export function ingestionBody(
  bundle: ContentReleaseBundle,
  options: IngestionOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    bundle,
    idempotency_key: options.idempotencyKey ?? "release-ingest-key-0001",
  };
  if (options.activate !== undefined) body.activate = options.activate;
  return body;
}
