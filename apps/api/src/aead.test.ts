import { describe, it, expect } from "vitest";
import {
  asCryptoSubject,
  decryptJson,
  encryptJson,
  generateUserDek,
  type EncryptionContext,
} from "./crypto.js";

const CTX: EncryptionContext = {
  subject: asCryptoSubject("cs_aead_test_000001"),
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
      decryptJson(enc, dek, {
        ...CTX,
        subject: asCryptoSubject("cs_someone_else_001"),
      }),
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
    // If the AAD were naive concatenation, these two contexts would collide:
    // "cs_a00000" + "b.c" reads the same as "cs_a00000b.c" + "".
    const a = await encryptJson("x", dek, 1, {
      subject: asCryptoSubject("cs_a00000"),
      field: "b.c",
      recordId: "d",
    });
    await expect(
      decryptJson(a, dek, {
        subject: asCryptoSubject("cs_a00000b.c"),
        field: "",
        recordId: "d",
      }),
    ).rejects.toThrow();
  });

  it("records the algorithm and key version it used", async () => {
    const dek = await generateUserDek();
    const enc = await encryptJson({ a: 1 }, dek, 7, CTX);
    expect(enc.alg).toBe("AES-256-GCM");
    expect(enc.key_version).toBe(7);
    expect(enc.aead_version).toBe(2);
  });
});

describe("the AEAD subject is the crypto subject, not the user label", () => {
  const A = asCryptoSubject("cs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const B = asCryptoSubject("cs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  it("cannot decrypt a blob sealed under a different subject", async () => {
    const dek = await generateUserDek();
    const sealed = await encryptJson({ secret: 1 }, dek, 1, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    await expect(
      decryptJson(sealed, dek, {
        subject: B,
        field: "birth_profiles.payload_enc",
        recordId: "1",
      }),
    ).rejects.toThrow();
  });

  it("round-trips under the same subject", async () => {
    const dek = await generateUserDek();
    const sealed = await encryptJson({ secret: 2 }, dek, 1, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    const out = await decryptJson<{ secret: number }>(sealed, dek, {
      subject: A,
      field: "birth_profiles.payload_enc",
      recordId: "1",
    });
    expect(out.secret).toBe(2);
  });

  it("rejects a value that is not a crypto subject", () => {
    // The brand is only as good as its one entry point: a users.id label, an
    // IdP subject, a too-short value, and a colon-bearing one must all fail.
    expect(() => asCryptoSubject("usr_test_alice_00001")).toThrow();
    expect(() => asCryptoSubject("auth0|abcdef12")).toThrow();
    expect(() => asCryptoSubject("cs_")).toThrow();
    expect(() => asCryptoSubject("cs_has:colon0001")).toThrow();
  });
});
