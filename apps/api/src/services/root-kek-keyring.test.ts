import { describe, expect, it } from "vitest";
import {
  readRootKekKeyring,
} from "./root-kek-keyring.js";

const LEGACY = "legacy-root-key-material-long-enough-0001";
const NEXT = "next-root-key-material-long-enough-0000002";

describe("root KEK keyring", () => {
  it("resolves the legacy ROOT_KEK when no keyring is configured", async () => {
    const outcome = readRootKekKeyring({ ROOT_KEK: LEGACY });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.activeKeyId).toBe("legacy");
    expect(outcome.value.keyIds).toEqual(["legacy"]);
    await expect(outcome.value.resolve("legacy")).resolves.toBeInstanceOf(
      CryptoKey,
    );
  });

  it("resolves old and active keys from a closed version-one keyring", async () => {
    const outcome = readRootKekKeyring({
      ROOT_KEK: LEGACY,
      ROOT_KEK_KEYRING: JSON.stringify({
        version: 1,
        active_key_id: "root-2026-09",
        keys: {
          legacy: LEGACY,
          "root-2026-09": NEXT,
        },
      }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.activeKeyId).toBe("root-2026-09");
    expect(outcome.value.keyIds).toEqual(["legacy", "root-2026-09"]);
    await expect(outcome.value.resolve("legacy")).resolves.toBeInstanceOf(
      CryptoKey,
    );
    await expect(
      outcome.value.resolve("root-2026-09"),
    ).resolves.toBeInstanceOf(CryptoKey);
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "an absent active key",
      JSON.stringify({ version: 1, active_key_id: "missing", keys: { legacy: LEGACY } }),
    ],
    [
      "an invalid key id",
      JSON.stringify({ version: 1, active_key_id: "bad key", keys: { "bad key": LEGACY } }),
    ],
    [
      "a short secret",
      JSON.stringify({ version: 1, active_key_id: "short", keys: { short: "too-short" } }),
    ],
    [
      "more than four retained keys",
      JSON.stringify({
        version: 1,
        active_key_id: "a",
        keys: { a: LEGACY, b: LEGACY, c: LEGACY, d: LEGACY, e: LEGACY },
      }),
    ],
  ])("fails closed for %s", (_label, keyring) => {
    expect(readRootKekKeyring({ ROOT_KEK: LEGACY, ROOT_KEK_KEYRING: keyring })).toEqual({
      ok: false,
      code: "root_kek_keyring_invalid",
    });
  });

  it("does not disclose which configured key is unavailable", async () => {
    const outcome = readRootKekKeyring({ ROOT_KEK: LEGACY });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    await expect(outcome.value.resolve("retired")).rejects.toMatchObject({
      code: "root_kek_id_unavailable",
    });
  });
});
