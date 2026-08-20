/** Service-binding RPC into the isolated ontology-signer Worker. */
export interface OntologySignerBinding {
  signOntology(request: {
    payload: string;
    payload_hash: string;
    key_id: string;
  }): Promise<unknown>;
}

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

export type WorkerMessage = GenerationMessage | PrivacyMessage | PatternGenerationMessage;

/** Opaque Pattern-generation nudge. The encrypted command remains in D1. */
export interface PatternGenerationMessage {
  kind: "pattern_generation";
  job_id: string;
  generation_id: string;
  stage_generation: number;
}

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
  /**
   * Dedicated Pattern-generation queue. Long-form jobs must not contend with
   * daily-reading latency. The message is opaque; the frozen command stays in
   * jobs.payload_enc.
   */
  PATTERN_QUEUE: Queue<PatternGenerationMessage>;
  /**
   * Service-binding-only ontology signer. The private signing key is absent
   * from this Env by construction and exists only in the signer Worker.
   */
  ONTOLOGY_SIGNER: OntologySignerBinding;
  /**
   * Secret v1 JSON keyring for decrypting ontology evaluation artifacts:
   * `{"version":1,"keys":{"<key_id>":"<base64url 32-byte AES key>"}}`.
   * Configure only with `wrangler secret put`; never add it to wrangler vars.
   */
  ONTOLOGY_PIPELINE_ARTIFACT_KEYRING?: string;
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
  /**
   * `worker` | `gateway_stored`. Required whenever a rollout is not `off`.
   * Never inferred from whether OPENAI_API_KEY is set -- inference cannot tell
   * "stored key in use" from "worker key forgotten", and those need opposite
   * outcomes. See resolveProviderCredentialMode.
   */
  OPENAI_CREDENTIAL_SOURCE?: string;
  /** The BYOK alias, sent as cf-aig-byok-alias. Required for gateway_stored. */
  OPENAI_GATEWAY_KEY_ALIAS?: string;

  /**
   * Cloudflare AI Gateway, in front of the provider. Optional: absent means the
   * adapter calls api.openai.com with nothing in between.
   *
   * Both ids or neither. One without the other is refused by checkSecureConfig
   * rather than quietly falling back to the direct endpoint, which would look
   * like a working deployment with an empty gateway dashboard. Both are
   * interpolated into a URL path, so both are shape-checked.
   */
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /**
   * Secret. The `cf-aig-authorization` credential, needed only while the
   * gateway has Authenticated Gateway on — not the provider key, which still
   * rides `Authorization` for the gateway to forward. Set without the two ids
   * it is a misconfiguration, not a no-op.
   */
  AI_GATEWAY_TOKEN?: string;

  // -------------------------------------------------------------------------
  // M7 AI-generated Pattern
  // -------------------------------------------------------------------------

  /**
   * Staged rollout: `off` | `internal` | `first_open`.
   *
   * Named PATTERN_AI_ROLLOUT in the M7 spec. Default `off` in every wrangler
   * block. There is no scheduler hybrid at launch — Pattern is first-open.
   */
  PATTERN_AI_ROLLOUT?: string;
  /**
   * Designated internal accounts for `PATTERN_AI_ROLLOUT=internal`. JSON array
   * or comma-separated user ids. Missing or malformed is an empty allowlist.
   */
  PATTERN_INTERNAL_ACCOUNT_IDS?: string;
  /**
   * Test-only semantic reject hook. Honored only when AUTH_STUB=1 so a
   * production deploy cannot accidentally refuse every Pattern.
   */
  PATTERN_SEMANTIC_FORCE_REJECT?: string;
  /** `openai` in production; `synthetic` is refused outside development. */
  PATTERN_PUBLISHER?: string;
  OPENAI_PATTERN_PLANNER_MODEL?: string;
  OPENAI_PATTERN_PLANNER_REASONING?: string;
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION?: string;
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS?: string;
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS?: string;
  OPENAI_PATTERN_WRITER_MODEL?: string;
  OPENAI_PATTERN_WRITER_REASONING?: string;
  OPENAI_PATTERN_WRITER_PROMPT_VERSION?: string;
  OPENAI_PATTERN_WRITER_TIMEOUT_MS?: string;
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS?: string;
  OPENAI_PATTERN_VERIFIER_MODEL?: string;
  OPENAI_PATTERN_VERIFIER_REASONING?: string;
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION?: string;
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS?: string;
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS?: string;
  PATTERN_INPUT_MAX_BYTES?: string;
  PATTERN_DAILY_PROVIDER_CALL_LIMIT?: string;
  PATTERN_ARTIFACT_RETENTION_DAYS?: string;
  /**
   * Public keys trusted to sign ontology releases, same shape as
   * CONTENT_RELEASE_KEYS. Ingestion fails closed while unset.
   */
  PATTERN_ONTOLOGY_KEYS?: string;
  /** Separate from SERVICE_AUTH_TOKEN and from consumer sessions. */
  PATTERN_ADMIN_TOKEN?: string;
}
