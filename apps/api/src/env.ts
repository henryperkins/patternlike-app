/** Opaque queue nudge; the encrypted generation command remains in D1. */
export interface GenerationMessage {
  job_id: string;
  reading_id: string;
}

/** Opaque privacy nudge; the encrypted command and checkpoints remain in D1. */
export interface PrivacyMessage {
  kind: "privacy";
  job_id: string;
  job_type: "export_account" | "delete_account";
}

export type WorkerMessage = GenerationMessage | PrivacyMessage;

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
  READING_QUEUE: Queue<GenerationMessage>;
  PRIVACY_QUEUE: Queue<PrivacyMessage>;
  /** Raw USR-06 retention in calendar months; integer 1..13, default 13. */
  CHECK_IN_RETENTION_MONTHS?: string;
  /** Positive cache epoch; bump before any result-changing calculation deploy. */
  TIME_TRAVEL_RECEIPT_EPOCH?: string;
  /** Launch outbound scan ceiling. Configuration guard requires exactly 32. */
  TIME_TRAVEL_DAILY_SCAN_LIMIT?: string;

  // -------------------------------------------------------------------------
  // M5 constrained-model publisher
  // -------------------------------------------------------------------------

  /**
   * Staged rollout: `off` | `internal` | `first_open` | `hybrid`.
   *
   * Declared in every wrangler block, for the same reason AUTH_STUB is written
   * out as "0" rather than omitted. `off` is the kill switch and the default.
   */
  READING_V5_ROLLOUT?: string;
  /** Explicit route selection. Must be "openai" whenever the rollout is not off. */
  READING_PUBLISHER?: string;
  /** The exact production model, verified against the account before deployment. */
  OPENAI_READING_MODEL?: string;
  OPENAI_READING_REASONING?: string;
  OPENAI_READING_PROMPT_VERSION?: string;
  /** One provider-call deadline, in milliseconds. */
  OPENAI_READING_TIMEOUT_MS?: string;
  OPENAI_READING_MAX_OUTPUT_TOKENS?: string;
  /** Hard ceiling on the serialized provider packet, in UTF-8 bytes. */
  READING_CONTEXT_MAX_BYTES?: string;
  READING_PREGEN_ACTIVE_DAYS?: string;
  READING_PREGEN_LEAD_MINUTES?: string;
  READING_PREGEN_SPREAD_MINUTES?: string;
  READING_SCHEDULER_BATCH_LIMIT?: string;
  /**
   * The operator-approved UTC-day ceiling on provider calls. There is no
   * unlimited or unset production mode: request bytes and output tokens are
   * separately capped, so this number is what makes the worst-case daily spend
   * computable.
   */
  READING_DAILY_PROVIDER_CALL_LIMIT?: string;
  /** Secret. Never a var, and never written to wrangler.toml. */
  OPENAI_API_KEY?: string;
}
