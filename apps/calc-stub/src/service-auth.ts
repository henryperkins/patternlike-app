import { createHash, timingSafeEqual } from "node:crypto";

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/**
 * Constant-time bearer-token check. Both sides are digested first so
 * timingSafeEqual always receives equal-length buffers, whatever the caller
 * sent.
 */
export function isServiceAuthorized(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return false;
  if (!authorization?.startsWith("Bearer ")) return false;

  const suppliedToken = authorization.slice("Bearer ".length);
  return timingSafeEqual(tokenDigest(suppliedToken), tokenDigest(expectedToken));
}
