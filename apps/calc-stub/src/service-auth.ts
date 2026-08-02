import { createHash, timingSafeEqual } from "node:crypto";

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function isServiceAuthorized(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return false;
  const prefix = ["Bear", "er "].join("");
  if (!authorization?.startsWith(prefix)) return false;

  const suppliedToken = authorization.slice(prefix.length);
  return timingSafeEqual(tokenDigest(suppliedToken), tokenDigest(expectedToken));
}
