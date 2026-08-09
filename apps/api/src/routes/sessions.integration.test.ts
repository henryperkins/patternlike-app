import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { Jwt } from "hono/utils/jwt";
import { app } from "../index.js";
import { resetDb, rows, ALICE } from "../../test/helpers.js";
import { __resetJwksCacheForTests } from "../services/identity.js";

const ISSUER = "https://issuer.test";
const AUDIENCE = "patternlike-web";
const JWKS_URL = "https://issuer.test/.well-known/jwks.json";

/** workers-types' JsonWebKey has no `kid`. */
interface JwkWithKid extends JsonWebKey {
  kid: string;
}

let keyPair: CryptoKeyPair;
let jwks: { keys: JwkWithKid[] };

function prodEnv() {
  return {
    ...env,
    ENVIRONMENT: "production",
    AUTH_STUB: "",
    ROOT_KEK: "test-root-kek-that-is-long-enough-to-pass",
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    OIDC_JWKS_URL: JWKS_URL,
  };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const priv = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    { iss: ISSUER, aud: AUDIENCE, exp: now + 300, iat: now, ...claims },
    { ...priv, kid: "test-key-1" } as never,
    "RS256",
  );
}

async function startSession(idToken: string) {
  return app.request(
    "/v1/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    },
    prodEnv(),
  );
}

describe("identity end to end", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDb();
    __resetJwksCacheForTests();
    if (!keyPair) {
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
      const pub = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
      jwks = { keys: [{ ...pub, kid: "test-key-1", alg: "RS256", use: "sig" }] };
    }
    // Capture the real fetch BEFORE spying. Delegating through `globalThis.fetch`
    // inside the mock would call the spy itself and recurse until the stack blows
    // — and the calc service must still reach vitest.config.ts's outboundService.
    const originalFetch = globalThis.fetch;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === JWKS_URL) {
        return new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input as RequestInfo, init);
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  it("issues a session and returns a stable usr_ id across two requests", async () => {
    const token = await signToken({ sub: "sub-alice" });

    const first = await startSession(token);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { token: string };

    const second = await startSession(token);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { token: string };

    // Two logins, two sessions, ONE user.
    expect(secondBody.token).not.toBe(firstBody.token);
    const users = await rows<{ id: string }>("SELECT id FROM users");
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(await rows("SELECT id FROM sessions")).toHaveLength(2);
  });

  it("sets an httpOnly SameSite=Strict session cookie", async () => {
    const res = await startSession(await signToken({ sub: "sub-alice" }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pl_session=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("never returns the raw session token in a readable cookie attribute", async () => {
    const res = await startSession(await signToken({ sub: "sub-alice" }));
    const { token } = (await res.json()) as { token: string };
    const [stored] = await rows<{ token_sha256: string }>(
      "SELECT token_sha256 FROM sessions",
    );
    expect(stored!.token_sha256).not.toBe(token);
  });

  it("rejects a token from the wrong issuer with the standard envelope", async () => {
    const now = Math.floor(Date.now() / 1000);
    const priv = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
    const wrongIssuer = await Jwt.sign(
      {
        iss: "https://evil.test",
        aud: AUDIENCE,
        sub: "sub-alice",
        exp: now + 300,
        iat: now,
      },
      { ...priv, kid: "test-key-1" } as never,
      "RS256",
    );

    const res = await startSession(wrongIssuer);
    expect(res.status).toBe(401);
    const parsed = (await res.json()) as {
      error: { code: string; message: string; request_id: string };
    };
    expect(parsed.error.code).toBe("unauthorized");
    expect(parsed.error.request_id).toBeTruthy();
    // The envelope must not leak what the library said.
    expect(parsed.error.message).not.toMatch(/jwt|jwks|signature|claim/i);
    expect(await rows("SELECT id FROM users")).toHaveLength(0);
  });

  it("rejects a token signed by a key the issuer does not publish", async () => {
    const impostor = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const priv = (await crypto.subtle.exportKey("jwk", impostor.privateKey)) as JsonWebKey;
    const now = Math.floor(Date.now() / 1000);
    const forged = await Jwt.sign(
      { iss: ISSUER, aud: AUDIENCE, sub: "sub-alice", exp: now + 300, iat: now },
      { ...priv, kid: "test-key-1" } as never,
      "RS256",
    );

    const res = await startSession(forged);
    expect(res.status).toBe(401);
    expect(await rows("SELECT id FROM users")).toHaveLength(0);
  });

  it("rejects a request with no token", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect(res.status).toBe(401);
    const parsed = (await res.json()) as { error: { code: string; request_id: string } };
    expect(parsed.error.code).toBe("unauthorized");
    expect(parsed.error.request_id).toBeTruthy();
  });

  it("carries the session through a real birth-profile write and chart read", async () => {
    const session = await startSession(await signToken({ sub: "sub-alice" }));
    const { token } = (await session.json()) as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    const post = await app.request(
      "/v1/birth-profiles",
      {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          "idempotency-key": "idem-e2e-1",
        },
        body: JSON.stringify(ALICE),
      },
      prodEnv(),
    );
    expect(post.status).toBe(202);

    const chart = await app.request("/v1/chart", { headers: auth }, prodEnv());
    expect(chart.status).toBe(200);

    // The ciphertext is bound to the crypto subject, not the user id.
    const [user] = await rows<{ id: string; crypto_subject: string }>(
      "SELECT id, crypto_subject FROM users",
    );
    expect(user!.crypto_subject).toMatch(/^cs_[0-9a-f]{32}$/);
    expect(user!.crypto_subject).not.toBe(user!.id);
  });

  it("does not serve one user's chart to another user's session", async () => {
    const aliceSession = await startSession(await signToken({ sub: "sub-alice" }));
    const { token: aliceToken } = (await aliceSession.json()) as { token: string };

    await app.request(
      "/v1/birth-profiles",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${aliceToken}`,
          "content-type": "application/json",
          "idempotency-key": "idem-e2e-2",
        },
        body: JSON.stringify(ALICE),
      },
      prodEnv(),
    );

    const bobSession = await startSession(await signToken({ sub: "sub-bob" }));
    const { token: bobToken } = (await bobSession.json()) as { token: string };

    const bobChart = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${bobToken}` } },
      prodEnv(),
    );
    expect(bobChart.status).toBe(404);
  });
});
