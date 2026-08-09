export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_STUB: string;
  CALC_SERVICE_URL: string;
  CALC_SERVICE_AUTH_TOKEN?: string;
  SCHEMA_VERSION: string;
  /** Set in wrangler.toml; was previously absent from this interface. */
  SE_LICENSE_MODE: string;
  /** Expected `iss` on an ID token, e.g. "https://issuer.example.com". */
  OIDC_ISSUER: string;
  /** Expected `aud` on an ID token — this application's client id. */
  OIDC_AUDIENCE: string;
  /** Absolute URL of the issuer's JWKS document. */
  OIDC_JWKS_URL: string;
  ROOT_KEK?: string;
  SERVICE_AUTH_TOKEN?: string;
  /**
   * Public keys trusted to sign editorial release bundles, as JSON:
   * `{"<key_id>": {"alg": "Ed25519"|"ES256", "public_key": "<base64url raw>"}}`.
   * Public material, so it is a var rather than a secret — same reasoning as
   * OIDC_JWKS_URL. Ingestion fails closed while it is unset.
   */
  CONTENT_RELEASE_KEYS?: string;
  ARTIFACTS?: R2Bucket;
  /**
   * Daily-reading generation. The message is opaque — job id and reserved
   * reading id only; the immutable command itself lives encrypted in
   * `jobs.payload_enc`, because a queue message is not a place to put a user's
   * frozen chart, cycle, and context state.
   */
  READING_QUEUE: Queue<{ job_id: string; reading_id: string }>;
}
