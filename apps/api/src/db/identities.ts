import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject, type CryptoSubject } from "../crypto.js";
import { buildUserKeyInsert, type UserIdentity } from "./users.js";

/** `usr_<32 hex>`. Opaque, server-minted, never derived from an IdP subject. */
export function newUserId(): string {
  return newId("usr");
}

/** `cs_<32 hex>`. Minted once per user and never changed thereafter. */
export function newCryptoSubject(): CryptoSubject {
  return asCryptoSubject(newId("cs"));
}

/**
 * Resolve an OIDC subject to our user, creating the account on first sight.
 *
 * Creation is one D1 batch — user, identity, and wrapped DEK together — so a
 * partial failure cannot leave a user without a key. `loadUserKey` refuses to
 * mint, which makes that atomicity load-bearing rather than merely tidy.
 *
 * The IdP subject is stored, never used as an identifier of ours: both the
 * user id and the crypto subject are minted here, so the identity provider can
 * be swapped without touching a single byte of ciphertext.
 */
export async function linkIdentity(
  env: Env,
  provider: string,
  providerSubject: string,
): Promise<UserIdentity> {
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT u.id AS user_id, u.crypto_subject AS crypto_subject
     FROM identities i
     JOIN users u ON u.id = i.user_id
     WHERE i.provider = ? AND i.provider_subject = ?`,
  )
    .bind(provider, providerSubject)
    .first<{ user_id: string; crypto_subject: string }>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE identities SET last_login_at = ? WHERE provider = ? AND provider_subject = ?",
    )
      .bind(now, provider, providerSubject)
      .run();
    return {
      userId: existing.user_id,
      cryptoSubject: asCryptoSubject(existing.crypto_subject),
    };
  }

  const identity: UserIdentity = {
    userId: newUserId(),
    cryptoSubject: newCryptoSubject(),
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, crypto_subject, status, locale, timezone,
                          entitlement_tier, created_at, updated_at)
       VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
    ).bind(identity.userId, identity.cryptoSubject, now, now),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, provider, provider_subject, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId("idn"), identity.userId, provider, providerSubject, now, now),
    await buildUserKeyInsert(env, identity),
  ]);

  return identity;
}
