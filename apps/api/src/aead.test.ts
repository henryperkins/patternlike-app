import { describe, it, expect } from "vitest";
import {
  decryptJson,
  encryptJson,
  generateUserDek,
  type EncryptionContext,
} from "./crypto.js";

const CTX: EncryptionContext = {
  userId: "usr_aead_test_000001",
  field: "birth_profiles.payload_enc",
  recordId: "1",
};

describe("authenticated encryption with associated data", () => {
  it("round-trips a value under the matching context", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    const out = await decryptJson<{ birth_date: string }>(enc, dek, CTX);
    expect(out.birth_date).toBe("1990-05-15");
  });

  it("refuses a ciphertext moved to another user's row", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    await expect(
      decryptJson(enc, dek, { ...CTX, userId: "usr_someone_else_01" }),
    ).rejects.toThrow();
  });

  it("refuses a ciphertext moved to another record", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    await expect(decryptJson(enc, dek, { ...CTX, recordId: "2" })).rejects.toThrow();
  });

  it("refuses a ciphertext moved to another column", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    await expect(
      decryptJson(enc, dek, { ...CTX, field: "chart_snapshots.birth_enc" }),
    ).rejects.toThrow();
  });

  it("refuses a ciphertext decrypted under a different DEK", async () => {
    const dek = await generateUserDek();
    const other = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    await expect(decryptJson(enc, other, CTX)).rejects.toThrow();
  });

  it("refuses a ciphertext whose recorded key_version was altered", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    await expect(decryptJson({ ...enc, key_version: 2 }, dek, CTX)).rejects.toThrow();
  });

  it("refuses tampered ciphertext", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ birth_date: "1990-05-15" }, dek, 1, CTX);
    const bytes = atob(enc.ciphertext).split("");
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 0xff);
    await expect(
      decryptJson({ ...enc, ciphertext: btoa(bytes.join("")) }, dek, CTX),
    ).rejects.toThrow();
  });

  it("cannot be defeated by splitting the context across the delimiter", async () => {
    const dek = await generateUserDek();
    // If the AAD were naive concatenation, these two contexts would collide.
    const a = await encryptJson("x", dek, 1, {
      userId: "usr_a",
      field: "b.c",
      recordId: "d",
    });
    await expect(
      decryptJson(a, dek, { userId: "usr_ab.c", field: "", recordId: "d" }),
    ).rejects.toThrow();
  });

  it("records the algorithm and key version it used", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ a: 1 }, dek, 7, CTX);
    expect(enc.alg).toBe("AES-256-GCM");
    expect(enc.key_version).toBe(7);
    expect(enc.aead_version).toBe(1);
  });
});
