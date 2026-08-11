import { Jwt } from "hono/utils/jwt";
import type { Env } from "../env.js";
import { safeLog } from "./safe-log.js";

export interface VerifiedToken {
  /** The issuer, stored as identities.provider. */
  provider: string;
  /** The `sub` claim, stored as identities.provider_subject. */
  subject: string;
}

/**
 * Every verification failure, flattened.
 *
 * The message is deliberately constant: an unauthenticated caller learns only
 * that the token was rejected, never which claim failed or what the underlying
 * library said. The reason is kept as a field, for logs.
 */
export class TokenVerificationError extends Error {
  readonly code = "unauthorized";
  constructor(
    readonly reason:
      | "jwks_unavailable"
      | "signature_or_claims"
      | "missing_expiry"
      | "missing_subject",
    options?: { cause?: unknown },
  ) {
    super("Token verification failed", options);
    this.name = "TokenVerificationError";
  }
}

/** Only asymmetric signatures. A symmetric alg would let the token sign itself. */
const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"] as const;

/** Key sets change rarely; an isolate lives minutes to hours. */
const JWKS_TTL_MS = 10 * 60 * 1000;

interface JwksCacheEntry {
  keys: JsonWebKey[];
  fetchedAt: number;
}

// Module scope: a Worker isolate reuses this across requests, so verification
// costs one JWKS fetch per isolate per TTL rather than one per request.
// Jwt.verifyWithJwks re-fetches jwks_uri on EVERY call, which is why we fetch
// ourselves and hand it `keys` instead.
let jwksCache: JwksCacheEntry | null = null;

/** Test seam. Never called by production code. */
export function __resetJwksCacheForTests(): void {
  jwksCache = null;
}

/**
 * Test seam: age the cache past its TTL without discarding it, so the
 * stale-on-refresh-failure path can be exercised. Never called by production
 * code.
 */
export function __expireJwksCacheForTests(): void {
  if (jwksCache) jwksCache.fetchedAt = 0;
}

async function loadJwks(url: string): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  let keys: JsonWebKey[];
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`JWKS endpoint returned ${res.status}`);
    }
    const doc = (await res.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
      throw new Error("JWKS document has no keys");
    }
    keys = doc.keys;
  } catch (err) {
    // Serve a stale key set rather than locking every user out of the product
    // because the issuer had a bad minute. Keys are long-lived; staleness here
    // is far less harmful than a total auth outage.
    if (jwksCache) {
      safeLog({ event: "jwks_refresh_failed_using_stale" });
      return jwksCache.keys;
    }
    throw new TokenVerificationError("jwks_unavailable", { cause: err });
  }

  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verify an OIDC ID token and return the identity it asserts.
 *
 * Checks the signature against the issuer's published keys, plus `iss`, `aud`,
 * `exp`, and `nbf`. Throws TokenVerificationError for every failure mode.
 *
 * Two deliberate departures from Hono's defaults:
 *
 * - `exp` is required explicitly. Hono's check is presence-guarded
 *   (`if (exp && payload.exp !== undefined)`), so a token carrying no `exp`
 *   claim would verify and never expire.
 * - `iat` verification is disabled. Hono enables it by default and offers no
 *   clock-skew leeway, so an issuer whose clock runs a second fast would have
 *   every one of its tokens rejected. `exp` is what bounds a token's life; a
 *   future `iat` is a skew artifact, not a forgery signal.
 */
export async function verifyIdToken(
  env: Env,
  token: string,
): Promise<VerifiedToken> {
  const keys = await loadJwks(env.OIDC_JWKS_URL);

  let payload: Record<string, unknown>;
  try {
    payload = (await Jwt.verifyWithJwks(token, {
      keys: keys as never,
      verification: {
        iss: env.OIDC_ISSUER,
        aud: env.OIDC_AUDIENCE,
        nbf: true,
        exp: true,
        iat: false,
      },
      allowedAlgorithms: [...ALLOWED_ALGORITHMS],
    })) as Record<string, unknown>;
  } catch (err) {
    throw new TokenVerificationError("signature_or_claims", { cause: err });
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new TokenVerificationError("missing_expiry");
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new TokenVerificationError("missing_subject");
  }

  return { provider: env.OIDC_ISSUER, subject };
}
