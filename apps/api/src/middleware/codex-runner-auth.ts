import type { Context, Next } from "hono";

import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";

const RUNNER_AUTHORIZATION = /^Bearer ([A-Za-z0-9._-]{32,512})$/;

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function credentialsMatch(
  expected: string,
  presented: string,
): Promise<boolean> {
  const [expectedDigest, presentedDigest] = await Promise.all([
    digest(expected),
    digest(presented),
  ]);
  let different = 0;
  for (let index = 0; index < expectedDigest.byteLength; index += 1) {
    different |= expectedDigest[index]! ^ presentedDigest[index]!;
  }
  return different === 0;
}

function error(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  requestId: string,
  status: 401 | 503,
  code: "unauthorized" | "codex_runner_auth_not_configured",
  message: string,
) {
  return c.json(
    { error: { code, message, request_id: requestId } },
    status,
  );
}

/** Dedicated authority; it never falls back to consumer or service auth. */
export async function codexRunnerAuth(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const expected = c.env.CODEX_RUNNER_TOKEN?.trim() ?? "";
  if (expected.length < 32 || expected.length > 512) {
    return error(
      c,
      requestId,
      503,
      "codex_runner_auth_not_configured",
      "Codex runner authentication is unavailable",
    );
  }
  const match = RUNNER_AUTHORIZATION.exec(c.req.header("authorization") ?? "");
  if (!match || !await credentialsMatch(expected, match[1]!)) {
    return error(
      c,
      requestId,
      401,
      "unauthorized",
      "Invalid runner token",
    );
  }
  await next();
}
