import { describe, it, expect } from "vitest";
import {
  asCryptoSubject,
  generateUserDek,
  encryptJson,
  resolveRootKey,
  unwrapDek,
  wrapDek,
  type EncryptionContext,
} from "./crypto.js";

const CTX: EncryptionContext = {
  subject: asCryptoSubject("cs_crypto_test_0001"),
  field: "birth_profiles.payload_enc",
  recordId: "1",
};

const TEST_KEK = { ENVIRONMENT: "test", ROOT_KEK: "a-test-root-key-long-enough-to-pass-32" };

describe("envelope encryption helpers", () => {
  it("encrypts JSON with AES-GCM", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    expect(enc.alg).toBe("AES-256-GCM");
    expect(enc.ciphertext.length).toBeGreaterThan(8);
    expect(enc.nonce.length).toBeGreaterThan(8);
  });

  it("wraps and unwraps a DEK with the root key", async () => {
    const root = await resolveRootKey(TEST_KEK);
    const dek = await generateUserDek();
    const wrapped = await wrapDek(dek, root, CTX.subject, 1);
    expect(wrapped.wrapped_b64).toBeTruthy();
    expect(wrapped.nonce_b64).toBeTruthy();

    const nonce = Uint8Array.from(atob(wrapped.nonce_b64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(wrapped.wrapped_b64), (c) => c.charCodeAt(0));
    const packed = new Uint8Array(nonce.length + ct.length);
    packed.set(nonce, 0);
    packed.set(ct, nonce.length);

    const out = await unwrapDek(packed, root, CTX.subject, 1);
    expect(Array.from(out)).toEqual(Array.from(dek));
  });

  it("refuses to unwrap another user's DEK", async () => {
    // "another user" is now another *subject* — the DEK AAD binds to
    // users.crypto_subject rather than to the mutable users.id label.
    const root = await resolveRootKey(TEST_KEK);
    const dek = await generateUserDek();
    const wrapped = await wrapDek(dek, root, CTX.subject, 1);

    const nonce = Uint8Array.from(atob(wrapped.nonce_b64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(wrapped.wrapped_b64), (c) => c.charCodeAt(0));
    const packed = new Uint8Array(nonce.length + ct.length);
    packed.set(nonce, 0);
    packed.set(ct, nonce.length);

    await expect(
      unwrapDek(packed, root, asCryptoSubject("cs_someone_else_001"), 1),
    ).rejects.toThrow();
  });
});
