import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity } from "./identities.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessions,
} from "./sessions.js";

describe("sessions", () => {
  beforeEach(resetDb);

  it("issues a token that resolves to the user's two identifiers", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const principal = await resolveSession(env, token);
    expect(principal?.userId).toBe(id.userId);
    expect(principal?.cryptoSubject).toBe(id.cryptoSubject);
    expect(principal?.status).toBe("active");
  });

  it("stores a hash, never the token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const stored = await rows<{ token_sha256: string }>(
      "SELECT token_sha256 FROM sessions",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_sha256).not.toBe(token);
    expect(stored[0]!.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The raw token must appear in no column of the row.
    const whole = await rows<Record<string, unknown>>("SELECT * FROM sessions");
    expect(JSON.stringify(whole)).not.toContain(token);
  });

  it("rejects an unknown token", async () => {
    expect(await resolveSession(env, "not-a-real-token")).toBeNull();
  });

  it("rejects a revoked token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    const principal = await resolveSession(env, token);

    await revokeSession(env, principal!.sessionId);
    expect(await resolveSession(env, token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'",
    ).run();
    expect(await resolveSession(env, token)).toBeNull();
  });

  it("revokes every session for a user at once", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const a = await createSession(env, id.userId);
    const b = await createSession(env, id.userId);

    expect(await revokeAllSessions(env, id.userId)).toBe(2);
    expect(await resolveSession(env, a.token)).toBeNull();
    expect(await resolveSession(env, b.token)).toBeNull();
  });

  it("does not revoke another user's sessions", async () => {
    const alice = await linkIdentity(env, "oidc", "sub-alice");
    const bob = await linkIdentity(env, "oidc", "sub-bob");
    const aliceSession = await createSession(env, alice.userId);
    const bobSession = await createSession(env, bob.userId);

    expect(await revokeAllSessions(env, alice.userId)).toBe(1);
    expect(await resolveSession(env, aliceSession.token)).toBeNull();
    expect(await resolveSession(env, bobSession.token)).not.toBeNull();
  });

  it("issues distinct tokens for distinct sessions", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const a = await createSession(env, id.userId);
    const b = await createSession(env, id.userId);
    expect(a.token).not.toBe(b.token);
  });

  it("does not leak one user's session to another", async () => {
    const alice = await linkIdentity(env, "oidc", "sub-alice");
    const bob = await linkIdentity(env, "oidc", "sub-bob");
    const { token } = await createSession(env, alice.userId);

    const principal = await resolveSession(env, token);
    expect(principal?.userId).toBe(alice.userId);
    expect(principal?.userId).not.toBe(bob.userId);
  });

  it("reports the account status, so a frozen account can be gated on read", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?")
      .bind(id.userId)
      .run();

    const principal = await resolveSession(env, token);
    expect(principal?.status).toBe("frozen");
  });

  it("expires absolutely rather than sliding", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token, expiresAt } = await createSession(env, id.userId);

    await resolveSession(env, token);
    const [row] = await rows<{ expires_at: string }>(
      "SELECT expires_at FROM sessions",
    );
    // Resolving must not push the expiry out: a stolen bearer that renews
    // itself on every use is indistinguishable from a permanent credential.
    expect(row!.expires_at).toBe(expiresAt);
  });
});
