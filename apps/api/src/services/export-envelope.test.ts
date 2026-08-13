import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { openExport, sealExport } from "./export-envelope.js";

describe("account export envelope", () => {
  it("round-trips only with the bound export identity and creation time", async () => {
    const exportId = `exp_${"a".repeat(32)}`;
    const createdAt = "2026-08-12T12:00:00.000Z";
    const plaintext = new TextEncoder().encode('{"private":"value"}');
    const sealed = await sealExport(env, exportId, createdAt, plaintext);

    await expect(
      openExport(env, exportId, createdAt, {
        ciphertext: sealed.ciphertext,
        artifactNonce: sealed.artifactNonce,
        wrappedExportKey: sealed.wrappedExportKey,
        exportKeyNonce: sealed.exportKeyNonce,
        exportKekVersion: sealed.exportKekVersion,
      }),
    ).resolves.toEqual(plaintext);

    await expect(
      openExport(env, `exp_${"b".repeat(32)}`, createdAt, {
        ciphertext: sealed.ciphertext,
        artifactNonce: sealed.artifactNonce,
        wrappedExportKey: sealed.wrappedExportKey,
        exportKeyNonce: sealed.exportKeyNonce,
        exportKekVersion: sealed.exportKekVersion,
      }),
    ).rejects.toThrow();
  });
});
