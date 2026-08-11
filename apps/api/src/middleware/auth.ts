import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../env.js";
import type { CryptoSubject } from "../crypto.js";
import { resolveSession, touchSessionActivity } from "../db/sessions.js";
import { loadUserIdentity } from "../db/users.js";

export type AppVariables = {
  userId: string;
  /** The immutable AEAD/DEK subject. Never a request-supplied value. */
  cryptoSubject: CryptoSubject;
  requestId: string;
  /** Present only when a real session authenticated the request. */
  sessionId?: string;
};

/** Same-origin browsers present the session here; native clients use Bearer. */
export const SESSION_COOKIE = "pl_session";

function unauthorized(c: Context, requestId: string) {
  return c.json(
    {
      error: {
        code: "unauthorized",
        message: "Authentication required",
        request_id: requestId,
      },
    },
    401,
  );
}

/** Cookie first — a browser sends both only if something is misconfigured. */
export function readSessionToken(c: Context): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return null;
}

/**
 * Resolve the caller.
 *
 * The AUTH_STUB=1 branch is development-only and is refused outside development
 * by configGuard. It trusts the header to *name* a user but no longer to create
 * one: the crypto subject is read from the row, because fabricating one from a
 * request header would produce ciphertext nobody can read.
 *
 * Everything else resolves an opaque session token — issued by POST /v1/sessions
 * after an OIDC exchange — to a user id and a crypto subject in a single read.
 */
export async function authenticate(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);

  if (c.env.AUTH_STUB === "1") {
    const userId = c.req.header("x-user-id");
    if (!userId || userId.length < 8) {
      return c.json(
        {
          error: {
            code: "unauthorized",
            message: "Provide X-User-Id header when AUTH_STUB=1",
            request_id: requestId,
          },
        },
        401,
      );
    }
    const identity = await loadUserIdentity(c.env, userId);
    if (!identity) return unauthorized(c, requestId);
    c.set("userId", identity.userId);
    c.set("cryptoSubject", identity.cryptoSubject);
    await next();
    return;
  }

  const token = readSessionToken(c);
  if (!token) return unauthorized(c, requestId);

  const now = new Date();
  const principal = await resolveSession(c.env, token, now);
  // Unknown, revoked, and expired are one answer: which it was is free
  // information for an attacker.
  if (!principal) return unauthorized(c, requestId);

  c.set("userId", principal.userId);
  c.set("cryptoSubject", principal.cryptoSubject);
  c.set("sessionId", principal.sessionId);
  await touchSessionActivity(c.env, principal.sessionId, principal.userId, now);
  await next();
}

export async function serviceAuth(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const expected = c.env.SERVICE_AUTH_TOKEN;
  if (!expected) {
    if (c.env.ENVIRONMENT === "development" || c.env.AUTH_STUB === "1") {
      await next();
      return;
    }
    return c.json(
      {
        error: {
          code: "service_auth_not_configured",
          message: "SERVICE_AUTH_TOKEN missing",
          request_id: requestId,
        },
      },
      503,
    );
  }
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${expected}`) {
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Invalid service token",
          request_id: requestId,
        },
      },
      401,
    );
  }
  await next();
}
