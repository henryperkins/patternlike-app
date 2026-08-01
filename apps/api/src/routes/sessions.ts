import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../env.js";
import {
  SESSION_COOKIE,
  readSessionToken,
  type AppVariables,
} from "../middleware/auth.js";
import { verifyIdToken, TokenVerificationError } from "../services/identity.js";
import { linkIdentity } from "../db/identities.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  SESSION_TTL_SECONDS,
} from "../db/sessions.js";

export const sessionRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function requestId(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header("x-request-id") ?? crypto.randomUUID();
}

/**
 * Exchange an OIDC ID token for a session.
 *
 * Mounted OUTSIDE the authenticated router in index.ts: requiring a session to
 * create a session is a deadlock. It still sits behind configGuard.
 */
sessionRoutes.post("/v1/sessions", async (c) => {
  const rid = requestId(c);

  let body: { id_token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  if (typeof body.id_token !== "string" || body.id_token.length === 0) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: "id_token is required",
          request_id: rid,
        },
      },
      400,
    );
  }

  let verified;
  try {
    verified = await verifyIdToken(c.env, body.id_token);
  } catch (err) {
    // The reason is a log-only detail; the caller gets one flat 401.
    console.error("id_token_rejected", {
      request_id: rid,
      reason: err instanceof TokenVerificationError ? err.reason : "unknown",
    });
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required",
          request_id: rid,
        },
      },
      401,
    );
  }

  const identity = await linkIdentity(c.env, verified.provider, verified.subject);
  const { token, expiresAt } = await createSession(c.env, identity.userId);

  // Browsers get an httpOnly cookie so XSS cannot read the token; native
  // clients use the body value as a bearer. Both resolve the same session row.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1",
    maxAge: SESSION_TTL_SECONDS,
  });

  return c.json({ token, expires_at: expiresAt }, 201);
});

/** Log out. Idempotent: an already-invalid token still yields 204. */
sessionRoutes.delete("/v1/sessions/current", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const principal = await resolveSession(c.env, token);
    if (principal) await revokeSession(c.env, principal.sessionId);
  }
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1",
    maxAge: 0,
  });
  return c.body(null, 204);
});
