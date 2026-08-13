import { newId, sha256Hex } from "@patternlike/shared";
import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import type { AccountStatus, UserIdentity } from "./users.js";
import { recomputeUserNextDueAt } from "./reading-scheduler.js";

/**
 * 30 days, absolute — not sliding. A sliding window on a bearer that unlocks
 * highly_sensitive birth data lets a stolen token renew itself indefinitely.
 */
export const SESSION_TTL_SECONDS = 2_592_000;

export interface SessionPrincipal extends UserIdentity {
  sessionId: string;
  /** users.status — the account-state gate reads this. */
  status: AccountStatus;
}

/** 32 random bytes, base64url. Returned once; only its hash is stored. */
function mintToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const token = mintToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions
       (id, user_id, token_sha256, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId("ses"),
      userId,
      await sha256Hex(token),
      now.toISOString(),
      expiresAt,
      now.toISOString(),
    )
    .run();
  await recomputeUserNextDueAt(env, userId, now);

  return { token, expiresAt };
}

/**
 * Resolve a bearer to its principal, or null.
 *
 * Null covers unknown, revoked, and expired alike: the caller gets one
 * undifferentiated 401, because telling an attacker which of the three it was is
 * free information.
 */
export async function resolveSession(
  env: Env,
  token: string,
  now = new Date(),
): Promise<SessionPrincipal | null> {
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.crypto_subject AS crypto_subject,
            u.status AS status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_sha256 = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), now.toISOString())
    .first<{
      session_id: string;
      user_id: string;
      crypto_subject: string;
      status: AccountStatus;
    }>();

  if (!row) return null;

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
    status: row.status,
  };
}

export const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Persist qualifying activity at most once per hour per session.
 *
 * The cursor recompute happens only when the guarded write lands, so a hot API
 * session cannot turn every authenticated request into two extra D1 writes.
 */
export async function touchSessionActivity(
  env: Env,
  sessionId: string,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const cutoff = new Date(
    now.getTime() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS,
  ).toISOString();
  const result = await env.DB.prepare(
    `UPDATE sessions SET last_seen_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
       AND (last_seen_at IS NULL OR last_seen_at < ?)`,
  )
    .bind(now.toISOString(), sessionId, userId, now.toISOString(), cutoff)
    .run();
  if (result.meta.changes !== 1) return false;
  await recomputeUserNextDueAt(env, userId, now);
  return true;
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(new Date().toISOString(), sessionId)
    .run();
}

/**
 * Invalidate every live session for a user. This is the primitive behind the
 * spec's "invalidate sessions" recovery control, and is why identity is a local
 * session rather than a statelessly verified IdP token.
 */
export async function revokeAllSessions(env: Env, userId: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
  )
    .bind(new Date().toISOString(), userId)
    .run();
  return result.meta.changes ?? 0;
}
