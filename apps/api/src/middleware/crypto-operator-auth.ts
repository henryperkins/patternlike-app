import type { Context, Next } from "hono";

import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";

const OPERATOR_AUTHORIZATION = /^Bearer ([A-Za-z0-9._-]{32,512})$/;

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function credentialsMatch(expected: string, presented: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(expected), digest(presented)]);
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index]! ^ right[index]!;
  }
  return different === 0;
}

/** Dedicated authority; it never falls back to consumer, service, or runner auth. */
export async function cryptoOperatorAuth(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const expected = c.env.CRYPTO_OPERATOR_TOKEN?.trim() ?? "";
  const aliasesAnotherAuthority = expected !== "" && [
    c.env.SERVICE_AUTH_TOKEN,
    c.env.CODEX_RUNNER_TOKEN,
  ].some((value) => value?.trim() === expected);
  if (expected.length < 32 || expected.length > 512 || aliasesAnotherAuthority) {
    return c.json({
      error: {
        code: "crypto_operator_auth_not_configured",
        message: "Crypto operator authentication is unavailable",
        request_id: requestId,
      },
    }, 503);
  }
  const presented = OPERATOR_AUTHORIZATION.exec(c.req.header("authorization") ?? "");
  if (!presented || !await credentialsMatch(expected, presented[1]!)) {
    return c.json({
      error: {
        code: "unauthorized",
        message: "Invalid crypto operator token",
        request_id: requestId,
      },
    }, 401);
  }
  await next();
}
