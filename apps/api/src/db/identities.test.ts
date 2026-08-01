import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity, newUserId, newCryptoSubject } from "./identities.js";
import { loadUserKey } from "./users.js";

describe("identity minting", () => {
  it("mints ids that satisfy the schema CHECKs", () => {
    expect(newUserId()).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(newCryptoSubject()).toMatch(/^cs_[0-9a-f]{32}$/);
  });

  it("never mints the same id twice", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newUserId()));
    const subjects = new Set(Array.from({ length: 100 }, () => newCryptoSubject()));
    expect(ids.size).toBe(100);
    expect(subjects.size).toBe(100);
  });
});

describe("linkIdentity", () => {
  beforeEach(resetDb);

  it("creates the user, the identity, and the key on first sight", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");

    expect(id.userId).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(id.cryptoSubject).toMatch(/^cs_[0-9a-f]{32}$/);

    expect(await rows("SELECT id FROM users")).toHaveLength(1);
    expect(await rows("SELECT id FROM identities")).toHaveLength(1);
    // The DEK must exist immediately: loadUserKey never mints.
    await expect(loadUserKey(env, id)).resolves.toHaveProperty("keyVersion", 1);
  });

  it("returns the same user on a second sight, without creating another", async () => {
    const first = await linkIdentity(env, "oidc", "sub-alice");
    const second = await linkIdentity(env, "oidc", "sub-alice");

    expect(second.userId).toBe(first.userId);
    expect(second.cryptoSubject).toBe(first.cryptoSubject);
    expect(await rows("SELECT id FROM users")).toHaveLength(1);
    expect(await rows("SELECT id FROM identities")).toHaveLength(1);
  });

  it("stamps last_login_at on the second link, not just at creation", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");

    // Backdate before re-linking. Comparing two live timestamps would be flaky:
    // both links can land in the same millisecond. Backdating makes the UPDATE
    // branch the only thing that can change this value, so deleting that branch
    // fails this test.
    const STALE = "2020-01-01T00:00:00.000Z";
    await env.DB.prepare("UPDATE identities SET last_login_at = ? WHERE user_id = ?")
      .bind(STALE, id.userId)
      .run();

    await linkIdentity(env, "oidc", "sub-alice");

    const [row] = await rows<{ last_login_at: string }>(
      "SELECT last_login_at FROM identities WHERE user_id = ?",
      id.userId,
    );
    expect(row!.last_login_at).not.toBe(STALE);
    expect(row!.last_login_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("recovers when another request wins the account-creation race", async () => {
    const winner = await linkIdentity(env, "oidc", "sub-alice");

    // Force the interleaving: an env whose first identity lookup misses, so
    // linkIdentity takes the create path and its batch collides with the
    // UNIQUE (provider, provider_subject) index the winner already holds.
    let lookupMissed = false;
    const racingEnv = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (sql.includes("FROM identities i") && !lookupMissed) {
            lookupMissed = true;
            return { bind: () => ({ first: async () => null }) };
          }
          return env.DB.prepare(sql);
        },
        batch: (stmts: D1PreparedStatement[]) => env.DB.batch(stmts),
      },
    } as unknown as typeof env;

    const result = await linkIdentity(racingEnv, "oidc", "sub-alice");

    expect(lookupMissed).toBe(true);
    expect(result.userId).toBe(winner.userId);
    expect(result.cryptoSubject).toBe(winner.cryptoSubject);
    // The loser's inserts must have rolled back entirely — no orphan user, and
    // no orphan wrapped DEK.
    expect(await rows("SELECT id FROM users")).toHaveLength(1);
    expect(await rows("SELECT user_id FROM user_keys")).toHaveLength(1);
    expect(await rows("SELECT id FROM identities")).toHaveLength(1);
  });

  it("gives different subjects different users", async () => {
    const a = await linkIdentity(env, "oidc", "sub-alice");
    const b = await linkIdentity(env, "oidc", "sub-bob");
    expect(a.userId).not.toBe(b.userId);
    expect(a.cryptoSubject).not.toBe(b.cryptoSubject);
    expect(await rows("SELECT id FROM users")).toHaveLength(2);
  });

  it("treats the same subject from a different provider as a different user", async () => {
    const a = await linkIdentity(env, "oidc", "shared-subject");
    const b = await linkIdentity(env, "other", "shared-subject");
    expect(a.userId).not.toBe(b.userId);
  });

  it("never reuses a crypto subject across users", async () => {
    await linkIdentity(env, "oidc", "sub-a");
    await linkIdentity(env, "oidc", "sub-b");
    const subjects = await rows<{ crypto_subject: string }>(
      "SELECT crypto_subject FROM users",
    );
    expect(new Set(subjects.map((s) => s.crypto_subject)).size).toBe(2);
  });

  it("gives each user a distinct DEK", async () => {
    const a = await linkIdentity(env, "oidc", "sub-alice");
    const b = await linkIdentity(env, "oidc", "sub-bob");
    const keyA = await loadUserKey(env, a);
    const keyB = await loadUserKey(env, b);
    expect(Array.from(keyA.dek)).not.toEqual(Array.from(keyB.dek));
  });

  it("never leaves a user without a key", async () => {
    // loadUserKey refuses to mint, so a users row without a user_keys row is a
    // permanently broken account. The batch is what prevents it.
    await linkIdentity(env, "oidc", "sub-alice");
    await linkIdentity(env, "oidc", "sub-bob");
    const orphans = await rows(
      `SELECT u.id FROM users u
       LEFT JOIN user_keys k ON k.user_id = u.id
       WHERE k.user_id IS NULL`,
    );
    expect(orphans).toHaveLength(0);
  });
});
