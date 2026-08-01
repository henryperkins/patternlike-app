import type { Context, Next } from "hono";
import type { Env } from "../env.js";
import type { CryptoSubject } from "../crypto.js";
import { loadUserIdentity } from "../db/users.js";

export type AppVariables = {
  userId: string;
  /** The immutable AEAD/DEK subject. Never a request-supplied value. */
  cryptoSubject: CryptoSubject;
  requestId: string;
};

export async function authStub(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);

  // Open decision: real IdP later. Local/dev stub only.
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
    // The header now *names* an existing user rather than conjuring one: the
    // crypto subject is read from the row, because it is the AEAD subject and
    // must never come from a request.
    const identity = await loadUserIdentity(c.env, userId);
    if (!identity) {
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
    c.set("userId", identity.userId);
    c.set("cryptoSubject", identity.cryptoSubject);
    await next();
    return;
  }

  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Bearer token required",
          request_id: requestId,
        },
      },
      401,
    );
  }

  // Placeholder until identity provider is chosen (M0 open decision).
  return c.json(
    {
      error: {
        code: "auth_not_configured",
        message: "Production auth not configured; set AUTH_STUB=1 for local",
        request_id: requestId,
      },
    },
    501,
  );
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
