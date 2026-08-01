import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Jwt } from "hono/utils/jwt";
import {
  verifyIdToken,
  TokenVerificationError,
  __resetJwksCacheForTests,
  __expireJwksCacheForTests,
} from "./identity.js";
import type { Env } from "../env.js";

const ISSUER = "https://issuer.test";
const AUDIENCE = "patternlike-web";
const JWKS_URL = "https://issuer.test/.well-known/jwks.json";

/**
 * workers-types' JsonWebKey has no `kid` member, so a bare JsonWebKey[] rejects
 * the fixture. Extending it is accepted.
 */
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
  // exportKey is typed JsonWebKey | ArrayBuffer; the "jwk" format narrows it in
  // practice but not in the type, and spreading the union drags ArrayBuffer
  // members into the literal.
  const pub = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
  jwks = { keys: [{ ...pub, kid: "test-key-1", alg: "RS256", use: "sig" }] };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const priv = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  return Jwt.sign({ ...claims }, { ...priv, kid: "test-key-1" } as never, "RS256");
}

function testEnv(): Env {
  return {
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    OIDC_JWKS_URL: JWKS_URL,
  } as unknown as Env;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifyIdToken", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    __resetJwksCacheForTests();
    if (!keyPair) await makeKeys();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === JWKS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("accepts a correctly signed token and returns its subject", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    const verified = await verifyIdToken(testEnv(), token);
    expect(verified.subject).toBe("sub-alice");
    expect(verified.provider).toBe(ISSUER);
  });

  it("caches the key set across calls within one isolate", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await verifyIdToken(testEnv(), token);
    await verifyIdToken(testEnv(), token);
    const jwksCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]) === JWKS_URL,
    );
    expect(jwksCalls).toHaveLength(1);
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await signToken({
      iss: "https://evil.test",
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a token for the wrong audience", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: "some-other-app",
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() - 10,
      iat: nowSeconds() - 300,
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a token that carries no exp claim at all", async () => {
    // Hono's exp check is presence-guarded — `if (exp && payload.exp !== undefined)`
    // — so a token with no exp verifies and never expires. Without this check an
    // IdP (or a forged-but-signed token) could mint an immortal credential.
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects a token with no subject", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("rejects garbage that is not a JWT", async () => {
    await expect(verifyIdToken(testEnv(), "not.a.jwt")).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });

  it("never surfaces the underlying library message", async () => {
    try {
      await verifyIdToken(testEnv(), "not.a.jwt");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("Token verification failed");
    }
  });

  it("tolerates an issuer clock a little ahead of the edge", async () => {
    // iat defaults to enabled in Hono and there is no leeway option, so an IdP
    // whose clock is a second fast would otherwise reject every token. exp is
    // what bounds the token's life; a future iat is a skew artifact.
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds() + 30,
    });
    const verified = await verifyIdToken(testEnv(), token);
    expect(verified.subject).toBe("sub-alice");
  });

  it("serves a stale key set rather than locking everyone out", async () => {
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await verifyIdToken(testEnv(), token);

    fetchSpy.mockImplementation(async () => new Response("nope", { status: 500 }));
    __expireJwksCacheForTests();
    const verified = await verifyIdToken(testEnv(), token);
    expect(verified.subject).toBe("sub-alice");
  });

  it("fails closed when the key set is unavailable and nothing is cached", async () => {
    fetchSpy.mockImplementation(async () => new Response("nope", { status: 500 }));
    const token = await signToken({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "sub-alice",
      exp: nowSeconds() + 300,
      iat: nowSeconds(),
    });
    await expect(verifyIdToken(testEnv(), token)).rejects.toBeInstanceOf(
      TokenVerificationError,
    );
  });
});
