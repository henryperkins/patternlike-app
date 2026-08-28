import { Jwt } from "hono/utils/jwt";

import type { Env } from "../env.js";
import { safeLog } from "./safe-log.js";

export const PATTERN_ADMIN_ROLE = "pattern_generation_auditor" as const;

export interface VerifiedAdminAccess {
  subject: string;
  audience: string;
  role: typeof PATTERN_ADMIN_ROLE;
  expiresAt: number;
}

export class AdminAccessVerificationError extends Error {
  readonly code = "unauthorized";

  constructor(
    readonly reason:
      | "not_configured"
      | "jwks_unavailable"
      | "signature_or_claims"
      | "missing_expiry"
      | "missing_subject",
    options?: { cause?: unknown },
  ) {
    super("Administrator identity verification failed", options);
    this.name = "AdminAccessVerificationError";
  }
}

const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"] as const;
const JWKS_TTL_MS = 10 * 60 * 1000;

interface JwksCacheEntry {
  url: string;
  keys: JsonWebKey[];
  fetchedAt: number;
}

let jwksCache: JwksCacheEntry | null = null;

export function __resetAdminAccessJwksCacheForTests(): void {
  jwksCache = null;
}

async function loadJwks(url: string): Promise<JsonWebKey[]> {
  if (
    jwksCache?.url === url &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Access certs endpoint returned ${response.status}`);
    const document = (await response.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(document.keys) || document.keys.length === 0) {
      throw new Error("Access certs document has no keys");
    }
    jwksCache = { url, keys: document.keys, fetchedAt: Date.now() };
    return document.keys;
  } catch (cause) {
    if (jwksCache?.url === url) {
      safeLog({ event: "jwks_refresh_failed_using_stale" });
      return jwksCache.keys;
    }
    throw new AdminAccessVerificationError("jwks_unavailable", { cause });
  }
}

export async function verifyCloudflareAccessToken(
  env: Env,
  token: string,
): Promise<VerifiedAdminAccess> {
  const teamDomain = env.ADMIN_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ADMIN_ACCESS_POLICY_AUD?.trim();
  if (!teamDomain || !audience) {
    throw new AdminAccessVerificationError("not_configured");
  }
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  const keys = await loadJwks(certsUrl);

  let payload: Record<string, unknown>;
  try {
    payload = (await Jwt.verifyWithJwks(token, {
      keys: keys as never,
      verification: {
        iss: teamDomain,
        aud: audience,
        nbf: true,
        exp: true,
        iat: false,
      },
      allowedAlgorithms: [...ALLOWED_ALGORITHMS],
    })) as Record<string, unknown>;
  } catch (cause) {
    throw new AdminAccessVerificationError("signature_or_claims", { cause });
  }

  const expiresAt = payload.exp;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new AdminAccessVerificationError("missing_expiry");
  }
  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new AdminAccessVerificationError("missing_subject");
  }

  return {
    subject,
    audience,
    role: PATTERN_ADMIN_ROLE,
    expiresAt,
  };
}
