import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Jwt } from "hono/utils/jwt";

import type { Env } from "../env.js";
import {
  __resetAdminAccessJwksCacheForTests,
  AdminAccessVerificationError,
  verifyCloudflareAccessToken,
} from "./admin-access.js";

const TEAM_DOMAIN = "https://patternlike.cloudflareaccess.com";
const POLICY_AUD = "admin-audience-tag";
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;

interface JwkWithKid extends JsonWebKey {
  kid: string;
}

let keyPair: CryptoKeyPair;
let jwks: { keys: JwkWithKid[] };

async function makeKeys() {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey,
  )) as JsonWebKey;
  jwks = {
    keys: [{ ...publicKey, kid: "access-key-1", alg: "RS256", use: "sig" }],
  };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const privateKey = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;
  return Jwt.sign(
    claims,
    { ...privateKey, kid: "access-key-1" } as never,
    "RS256",
  );
}

function testEnv(): Env {
  return {
    ADMIN_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ADMIN_ACCESS_POLICY_AUD: POLICY_AUD,
  } as Env;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifyCloudflareAccessToken", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    __resetAdminAccessJwksCacheForTests();
    if (!keyPair) await makeKeys();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === CERTS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("accepts an Access application token and returns the auditor identity", async () => {
    const expiresAt = nowSeconds() + 300;
    const token = await signToken({
      iss: TEAM_DOMAIN,
      aud: POLICY_AUD,
      sub: "access-subject-alice",
      exp: expiresAt,
      iat: nowSeconds(),
    });

    await expect(verifyCloudflareAccessToken(testEnv(), token)).resolves.toEqual({
      subject: "access-subject-alice",
      audience: POLICY_AUD,
      role: "pattern_generation_auditor",
      expiresAt,
    });
    expect(fetchSpy).toHaveBeenCalledWith(CERTS_URL);
  });

  it("rejects a token issued for a different Access application", async () => {
    const token = await signToken({
      iss: TEAM_DOMAIN,
      aud: "consumer-app",
      sub: "access-subject-alice",
      exp: nowSeconds() + 300,
    });

    await expect(verifyCloudflareAccessToken(testEnv(), token)).rejects.toBeInstanceOf(
      AdminAccessVerificationError,
    );
  });

  it("rejects an expired Access token", async () => {
    const token = await signToken({
      iss: TEAM_DOMAIN,
      aud: POLICY_AUD,
      sub: "access-subject-alice",
      exp: nowSeconds() - 1,
    });

    await expect(verifyCloudflareAccessToken(testEnv(), token)).rejects.toBeInstanceOf(
      AdminAccessVerificationError,
    );
  });

  it("rejects a signed token without an administrator subject", async () => {
    const token = await signToken({
      iss: TEAM_DOMAIN,
      aud: POLICY_AUD,
      exp: nowSeconds() + 300,
    });

    await expect(verifyCloudflareAccessToken(testEnv(), token)).rejects.toBeInstanceOf(
      AdminAccessVerificationError,
    );
  });
});
