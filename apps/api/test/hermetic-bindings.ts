/**
 * Worker bindings that keep the test suite independent from a developer's
 * ignored `.dev.vars` file and process environment.
 *
 * Daily and the ontology pipeline stay off: a suite that forgets to enable one
 * gets a configuration refusal rather than a provider job it did not mean to
 * create. Pattern cannot work that way any more. It has no rollout and exactly
 * one deployable publisher, so an incomplete Pattern configuration is a
 * `checkSecureConfig` refusal on every request rather than a dormant state --
 * which means the baseline has to be the complete Codex posture a real
 * deployment carries. What keeps a suite from creating provider work it did not
 * intend is the eligibility ladder (chart, locale, consent, public ontology,
 * unused claim), not an absent variable.
 */
export const HERMETIC_TEST_BINDINGS = {
  ENVIRONMENT: "development",
  AUTH_STUB: "1",
  CALC_SERVICE_URL: "http://127.0.0.1:8080",
  CALC_SERVICE_AUTH_TOKEN: "",
  CALC_FETCH_TIMEOUT_MS: "10000",
  BIRTH_CALC_DAILY_LIMIT: "5",
  SCHEMA_VERSION: "0.2.0",
  SE_LICENSE_MODE: "agpl",
  OIDC_ISSUER: "https://issuer.invalid",
  OIDC_AUDIENCE: "patternlike-dev",
  OIDC_JWKS_URL: "https://issuer.invalid/.well-known/jwks.json",
  ROOT_KEK: "",
  ROOT_KEK_KEYRING: "",
  GEOCODER_ROLLOUT: "off",
  GOOGLE_MAPS_PLATFORM_API_KEY: "",
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
  PATTERN_SEMANTIC_FORCE_REJECT: "",
  PATTERN_PUBLISHER: "codex",
  OPENAI_PATTERN_PLANNER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_PLANNER_REASONING: "high",
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION: "1.0.1",
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_WRITER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_WRITER_REASONING: "high",
  OPENAI_PATTERN_WRITER_PROMPT_VERSION: "1.0.1",
  OPENAI_PATTERN_WRITER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS: "32000",
  OPENAI_PATTERN_VERIFIER_MODEL: "gpt-5.6-sol",
  OPENAI_PATTERN_VERIFIER_REASONING: "high",
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION: "1.0.0-verifier",
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS: "900000",
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS: "32000",
  PATTERN_INPUT_MAX_BYTES: "98304",
  PATTERN_DAILY_PROVIDER_CALL_LIMIT: "100",
  PATTERN_ARTIFACT_RETENTION_DAYS: "30",
  PATTERN_ONTOLOGY_KEYS: "",
  PATTERN_REPLAY_LEDGER_SIGNING_KEY: "",
  PATTERN_REPLAY_LEDGER_KEYS: "",
  ONTOLOGY_PIPELINE_ARTIFACT_KEYRING: "",
  // Shared by Pattern, Daily, and the ontology pipeline. Pattern's baseline
  // needs them present; the other two select their own publisher separately.
  CODEX_PROVIDER_ARTIFACT_KEYRING:
    '{"version":1,"keys":{"codex-test-key":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}}',
  CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
  CRYPTO_OPERATOR_TOKEN: "",
  ADMIN_ACCESS_TEAM_DOMAIN: "",
  ADMIN_ACCESS_POLICY_AUD: "",
} as const;
