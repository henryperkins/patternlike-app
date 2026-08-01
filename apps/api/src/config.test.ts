import { describe, it, expect } from "vitest";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { DEV_ROOT_KEK, resolveRootKey, isDevEnvironment } from "./crypto.js";

const STRONG_KEK = "a-real-root-kek-with-enough-entropy-32+";

describe("secure configuration guard", () => {
  it("passes in development with no secrets set", () => {
    expect(checkSecureConfig({ ENVIRONMENT: "development", AUTH_STUB: "1" })).toBeNull();
  });

  it("passes in production with a real ROOT_KEK and no AUTH_STUB", () => {
    expect(
      checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK }),
    ).toBeNull();
  });

  it("refuses production without ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production" });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with the development placeholder as ROOT_KEK", () => {
    const err = checkSecureConfig({ ENVIRONMENT: "production", ROOT_KEK: DEV_ROOT_KEK });
    expect(err?.code).toBe("root_kek_not_configured");
  });

  it("refuses production with AUTH_STUB enabled", () => {
    const err = checkSecureConfig({
      ENVIRONMENT: "production",
      AUTH_STUB: "1",
      ROOT_KEK: STRONG_KEK,
    });
    expect(err?.code).toBe("auth_stub_in_production");
  });

  it("treats an unset ENVIRONMENT as non-development", () => {
    expect(checkSecureConfig({})?.code).toBe("root_kek_not_configured");
  });
});

describe("root key derivation", () => {
  it("classifies environments", () => {
    expect(isDevEnvironment("development")).toBe(true);
    expect(isDevEnvironment("test")).toBe(true);
    expect(isDevEnvironment("production")).toBe(false);
    expect(isDevEnvironment(undefined)).toBe(false);
  });

  it("throws rather than silently using the dev key outside development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "production" })).rejects.toThrow(
      /ROOT_KEK/,
    );
  });

  it("throws when ROOT_KEK is the repo-committed placeholder outside development", async () => {
    await expect(
      resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: DEV_ROOT_KEK }),
    ).rejects.toThrow(/placeholder/);
  });

  it("uses the dev fallback only in development", async () => {
    await expect(resolveRootKey({ ENVIRONMENT: "development" })).resolves.toBeDefined();
  });

  it("rejects a ROOT_KEK that is too short to be a real secret", async () => {
    await expect(
      resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: "short" }),
    ).rejects.toThrow(/32/);
  });

  it("derives a usable AES-GCM key via HKDF", async () => {
    const key = await resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK });
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });

  it("derives different keys from different passphrases", async () => {
    const a = await resolveRootKey({ ENVIRONMENT: "production", ROOT_KEK: STRONG_KEK });
    const b = await resolveRootKey({
      ENVIRONMENT: "production",
      ROOT_KEK: `${STRONG_KEK}-different`,
    });
    const iv = new Uint8Array(12);
    const pt = new TextEncoder().encode("probe");
    const ctA = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, pt),
    );
    const ctB = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, b, pt),
    );
    expect(Array.from(ctA)).not.toEqual(Array.from(ctB));
  });
});
