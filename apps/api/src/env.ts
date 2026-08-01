export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_STUB: string;
  CALC_SERVICE_URL: string;
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
  ARTIFACTS?: R2Bucket;
}
