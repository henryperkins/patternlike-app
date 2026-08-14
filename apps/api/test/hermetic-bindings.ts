/**
 * Worker bindings that keep the test suite independent from a developer's
 * ignored `.dev.vars` file and process environment.
 *
 * Integration tests opt into publisher credentials or trusted signing keys by
 * mutating the in-isolate `env` binding for the duration of the test. The
 * baseline intentionally exposes neither capability.
 */
export const HERMETIC_TEST_BINDINGS = {
  ENVIRONMENT: "development",
  AUTH_STUB: "1",
  CALC_SERVICE_URL: "http://127.0.0.1:8080",
  CALC_SERVICE_AUTH_TOKEN: "",
  SCHEMA_VERSION: "0.2.0",
  SE_LICENSE_MODE: "agpl",
  OIDC_ISSUER: "https://issuer.invalid",
  OIDC_AUDIENCE: "patternlike-dev",
  OIDC_JWKS_URL: "https://issuer.invalid/.well-known/jwks.json",
  ROOT_KEK: "",
  SERVICE_AUTH_TOKEN: "",
  CONTENT_RELEASE_KEYS: "",
  READING_V5_ROLLOUT: "off",
  READING_PUBLISHER: "",
  OPENAI_READING_MODEL: "",
  OPENAI_READING_REASONING: "",
  OPENAI_READING_PROMPT_VERSION: "",
  OPENAI_READING_TIMEOUT_MS: "",
  OPENAI_READING_MAX_OUTPUT_TOKENS: "",
  READING_CONTEXT_MAX_BYTES: "",
  READING_PREGEN_ACTIVE_DAYS: "",
  READING_PREGEN_LEAD_MINUTES: "",
  READING_PREGEN_SPREAD_MINUTES: "",
  READING_SCHEDULER_BATCH_LIMIT: "",
  READING_DAILY_PROVIDER_CALL_LIMIT: "",
  OPENAI_API_KEY: "",
  CHECK_IN_RETENTION_MONTHS: "13",
  TIME_TRAVEL_RECEIPT_EPOCH: "1",
  TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
} as const;
