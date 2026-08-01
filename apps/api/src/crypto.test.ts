import { describe, it, expect } from "vitest";
import { generateUserDek, encryptJson, resolveRootKey, wrapDek } from "./crypto.js";

describe("envelope encryption helpers", () => {
  it("encrypts JSON with AES-GCM", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1);
    expect(enc.alg).toBe("AES-256-GCM");
    expect(enc.ciphertext.length).toBeGreaterThan(8);
    expect(enc.nonce.length).toBeGreaterThan(8);
  });

  it("wraps DEK with root key", async () => {
    const root = await resolveRootKey("test-root");
    const dek = await generateUserDek();
    const wrapped = await wrapDek(dek, root);
    expect(wrapped.wrapped_b64).toBeTruthy();
    expect(wrapped.nonce_b64).toBeTruthy();
  });
});
