import { contentHash, newId } from "@patternlike/shared";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import type { Env } from "../env.js";
import {
  AdminAccessVerificationError,
  verifyCloudflareAccessToken,
} from "../services/admin-access.js";
import type { AppVariables } from "./auth.js";

export const ADMIN_SESSION_COOKIE = "pl_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 15 * 60;

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

function adminError(
  c: AdminContext,
  requestId: string,
  status: 401 | 503,
  code: "unauthorized" | "admin_auth_not_configured",
  message: string,
) {
  return c.json(
    { error: { code, message, request_id: requestId } },
    status,
  );
}

async function sessionIsCurrent(
  env: Env,
  token: string | undefined,
  identity: {
    subject: string;
    audience: string;
    role: "pattern_generation_auditor";
  },
  now: string,
): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS present
     FROM pattern_admin_sessions
     WHERE token_hash = ?
       AND admin_subject = ?
       AND audience = ?
       AND role = ?
       AND revoked_at IS NULL
       AND expires_at > ?
       AND access_expires_at > ?
     LIMIT 1`,
  )
    .bind(
      await contentHash(token),
      identity.subject,
      identity.audience,
      identity.role,
      now,
      now,
    )
    .first<{ present: number }>();
  return row?.present === 1;
}

async function mintAdminSession(
  c: AdminContext,
  identity: {
    subject: string;
    audience: string;
    role: "pattern_generation_auditor";
    expiresAt: number;
  },
  nowDate: Date,
): Promise<void> {
  const token = newId("pas");
  const accessExpiry = new Date(identity.expiresAt * 1000);
  const sessionExpiry = new Date(Math.min(
    accessExpiry.getTime(),
    nowDate.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000,
  ));
  const maxAge = Math.max(
    1,
    Math.floor((sessionExpiry.getTime() - nowDate.getTime()) / 1000),
  );
  await c.env.DB.prepare(
    `INSERT INTO pattern_admin_sessions (
       id, token_hash, admin_subject, role, audience, access_expires_at,
       expires_at, created_at, revoked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      newId("pads"),
      await contentHash(token),
      identity.subject,
      identity.role,
      identity.audience,
      accessExpiry.toISOString(),
      sessionExpiry.toISOString(),
      nowDate.toISOString(),
    )
    .run();
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/admin",
    maxAge,
  });
}

export async function adminAuth(c: AdminContext, next: Next) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const assertion = c.req.header("cf-access-jwt-assertion");
  if (!assertion) {
    return adminError(
      c,
      requestId,
      401,
      "unauthorized",
      "Cloudflare Access authentication required",
    );
  }

  let identity;
  try {
    identity = await verifyCloudflareAccessToken(c.env, assertion);
  } catch (cause) {
    if (
      cause instanceof AdminAccessVerificationError &&
      cause.reason === "not_configured"
    ) {
      return adminError(
        c,
        requestId,
        503,
        "admin_auth_not_configured",
        "Administrator authentication is unavailable",
      );
    }
    return adminError(
      c,
      requestId,
      401,
      "unauthorized",
      "Cloudflare Access authentication required",
    );
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const current = await sessionIsCurrent(
    c.env,
    getCookie(c, ADMIN_SESSION_COOKIE),
    identity,
    now,
  );
  if (!current) await mintAdminSession(c, identity, nowDate);

  c.set("adminSubject", identity.subject);
  c.set("adminRole", identity.role);
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  await next();
}
