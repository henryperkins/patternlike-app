-- Pattern-Like Astrology App
-- M0 core D1 schema (Cloudflare D1 / SQLite)
-- Contract package: contracts/m0 schema_version 0.2.0
--
-- Design rules (spec v0.2):
-- - Queryable metadata in clear columns (ids, dates, versions, hashes, status)
-- - Sensitive payloads as encrypted blobs (AES-256-GCM via per-user DEK)
-- - Idempotency uniqueness for at-least-once queues
-- - No user birth/journal/readings in WordPress; those live here + R2

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Account and crypto
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  -- Public label. Appears in logs, in calc-service requests, and inside
  -- daily_readings.reading_key. Opaque and server-minted: the spec forbids
  -- "stable direct identifiers" at the LLM boundary and requires opaque ids in
  -- telemetry, so this is never derived from an IdP subject. GLOB treats '_' as
  -- a literal, so 'usr_*' matches the prefix exactly. ':' is excluded because
  -- reading_key uses it as a field delimiter over a UNIQUE column.
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'usr_*' AND id NOT GLOB '*:*'),
  -- The cryptographic identity. Bound into every AEAD additional-data blob and
  -- into every wrapped DEK, so it must NEVER change once ciphertext exists.
  -- Separate from id precisely so that id CAN change without re-encryption.
  crypto_subject TEXT NOT NULL UNIQUE
    CHECK (crypto_subject GLOB 'cs_*' AND crypto_subject NOT GLOB '*:*'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'pending_deletion', 'deleted')),
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  entitlement_tier TEXT NOT NULL DEFAULT 'free',
  next_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS user_keys (
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  kek_version INTEGER NOT NULL DEFAULT 1,
  wrapped_dek BLOB NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  destroyed_at TEXT,
  -- Keyed by version so a destroyed key does not permanently block the user.
  -- With user_id alone as the primary key, the `destroyed_at IS NULL` lookup
  -- missed while the insert still collided: every request 500ed forever, and
  -- DEK rotation was impossible for the same reason.
  PRIMARY KEY (user_id, key_version)
);

-- At most one live key per user; destroyed rows are retained for audit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_keys_active
  ON user_keys(user_id) WHERE destroyed_at IS NULL;

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

-- Worker-minted sessions. The IdP proves who the user is once, at
-- POST /v1/sessions; this table is what every subsequent request checks, and
-- what makes "invalidate sessions" a row update rather than a wait for token
-- expiry.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  -- SHA-256 hex of the bearer, never the bearer. A database disclosure must not
  -- hand the reader a set of usable session tokens.
  token_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_live
  ON sessions(user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Consent and source permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL
    CHECK (kind IN (
      'account_processing', 'product_source', 'os_permission', 'oauth_scope',
      'ai_synthesis', 'research', 'model_training', 'export', 'support_access'
    )),
  status TEXT NOT NULL
    CHECK (status IN ('granted', 'denied', 'paused', 'revoked', 'expired', 'pending')),
  source_id TEXT,
  permission_tier INTEGER NOT NULL DEFAULT 0
    CHECK (permission_tier BETWEEN 0 AND 4),
  allowed_uses_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  connector_account_id TEXT,
  policy_version TEXT NOT NULL,
  ui_surface TEXT,
  granted_at TEXT,
  revoked_at TEXT,
  paused_at TEXT,
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_consent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_id IS NULL OR source_id NOT GLOB 'NO-*')
);

CREATE INDEX IF NOT EXISTS idx_consents_user_source
  ON consents(user_id, source_id, status);

CREATE TABLE IF NOT EXISTS context_source_permissions (
  user_id TEXT NOT NULL REFERENCES users(id),
  source_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  permission_state TEXT NOT NULL
    CHECK (permission_state IN (
      'active', 'paused', 'revoked', 'expired', 'never_granted'
    )),
  allowed_uses_json TEXT NOT NULL DEFAULT '[]',
  permission_tier INTEGER NOT NULL DEFAULT 0
    CHECK (permission_tier BETWEEN 0 AND 4),
  consent_id TEXT REFERENCES consents(id),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  connector_status TEXT,
  last_signal_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_id),
  CHECK (source_id NOT GLOB 'NO-*')
);

-- ---------------------------------------------------------------------------
-- Birth and chart (immutable snapshots)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS birth_profiles (
  user_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  accuracy TEXT NOT NULL
    CHECK (accuracy IN ('exact', 'approximate', 'unknown')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'superseded', 'invalid')),
  timezone TEXT,
  -- Encrypted: date/time/place/coordinates/corrections (required for pending/active)
  payload_enc BLOB,
  payload_key_version INTEGER,
  payload_nonce TEXT,
  geocode_confidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, version),
  CHECK (
    status NOT IN ('pending', 'active')
    OR (
      payload_enc IS NOT NULL
      AND payload_key_version IS NOT NULL
      AND payload_nonce IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS chart_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  container_digest TEXT NOT NULL,
  tzdb_version TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'invalid')),
  calculated_at TEXT NOT NULL,
  -- Non-PII normalized facts only (positions, aspects, houses, patterns).
  -- Must NOT contain birth date/time/place plaintext.
  snapshot_json TEXT NOT NULL,
  -- Birth accuracy is queryable; sensitive birth payload always encrypted.
  birth_accuracy TEXT NOT NULL
    CHECK (birth_accuracy IN ('exact', 'approximate', 'unknown')),
  birth_enc BLOB NOT NULL,
  birth_key_version INTEGER NOT NULL,
  birth_nonce TEXT NOT NULL,
  -- Optional full immutable artifact ciphertext in D1; primary large artifacts in R2
  snapshot_enc BLOB,
  snapshot_key_version INTEGER,
  snapshot_nonce TEXT,
  r2_uri TEXT,
  uncertainty_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, fingerprint),
  FOREIGN KEY (user_id, profile_version)
    REFERENCES birth_profiles(user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_chart_snapshots_user_status
  ON chart_snapshots(user_id, status, calculated_at DESC);

CREATE TABLE IF NOT EXISTS natal_features (
  id TEXT PRIMARY KEY NOT NULL,
  chart_id TEXT NOT NULL REFERENCES chart_snapshots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  feature_type TEXT NOT NULL
    CHECK (feature_type IN (
      'position', 'aspect', 'pattern', 'angle', 'house_cusp', 'other'
    )),
  body_a TEXT,
  body_b TEXT,
  aspect TEXT,
  feature_json TEXT NOT NULL,
  orb_policy_id TEXT,
  orb_policy_version TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_natal_features_chart
  ON natal_features(chart_id, feature_type);

CREATE TABLE IF NOT EXISTS cycle_instances (
  id TEXT PRIMARY KEY NOT NULL,
  chart_id TEXT NOT NULL REFERENCES chart_snapshots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  technique TEXT NOT NULL,
  phase TEXT
    CHECK (phase IS NULL OR phase IN (
      'emerging', 'building', 'peak', 'reconsidering', 'integrating'
    )),
  body TEXT,
  target TEXT,
  aspect TEXT,
  start_at TEXT,
  exact_at TEXT,
  end_at TEXT,
  orb_deg REAL,
  importance_score REAL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'superseded')),
  horizon_version TEXT,
  cycle_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cycle_instances_user_phase
  ON cycle_instances(user_id, status, phase, exact_at);

-- ---------------------------------------------------------------------------
-- Context signals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS context_signals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_id TEXT NOT NULL,
  source_window TEXT,
  evidence_lane TEXT NOT NULL
    CHECK (evidence_lane IN (
      'celestial_facts', 'user_and_context', 'operational'
    )),
  allowed_uses_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  permission_state TEXT NOT NULL
    CHECK (permission_state IN (
      'active', 'paused', 'revoked', 'expired', 'never_granted'
    )),
  conflict_status TEXT NOT NULL DEFAULT 'none'
    CHECK (conflict_status IN (
      'none', 'conflict', 'superseded', 'unconfirmed'
    )),
  consent_id TEXT REFERENCES consents(id),
  freshness_status TEXT NOT NULL
    CHECK (freshness_status IN ('fresh', 'stale', 'expired', 'unknown')),
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  expires_at TEXT,
  -- Structured minimized JSON or encrypted blob metadata (mutually exclusive pairing)
  value_encoding TEXT NOT NULL CHECK (value_encoding IN ('structured', 'encrypted')),
  value_json TEXT,
  value_enc BLOB,
  value_key_version INTEGER,
  value_nonce TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT,
  supersedes_signal_id TEXT,
  normalized_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_id NOT GLOB 'NO-*'),
  CHECK (
    (
      value_encoding = 'structured'
      AND value_json IS NOT NULL
      AND value_enc IS NULL
      AND value_key_version IS NULL
      AND value_nonce IS NULL
    )
    OR (
      value_encoding = 'encrypted'
      AND value_enc IS NOT NULL
      AND value_key_version IS NOT NULL
      AND value_nonce IS NOT NULL
      AND value_json IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_context_signals_user_source
  ON context_signals(user_id, source_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_signals_norm
  ON context_signals(user_id, source_id, normalized_hash);

-- ---------------------------------------------------------------------------
-- Editorial releases (metadata; immutable bundle in R2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_releases (
  version TEXT PRIMARY KEY NOT NULL,
  bundle_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN (
      'submitted', 'active', 'rejected', 'superseded'
    )),
  r2_uri TEXT,
  approver_id TEXT NOT NULL,
  last_author_id TEXT NOT NULL,
  changelog TEXT NOT NULL,
  calc_contract_id TEXT,
  activated_at TEXT,
  rejected_at TEXT,
  rejection_reason_class TEXT,
  created_at TEXT NOT NULL,
  CHECK (approver_id <> last_author_id)
);

-- Single-row active pointer (id forced to 1)
CREATE TABLE IF NOT EXISTS content_release_pointer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_version TEXT NOT NULL REFERENCES content_releases(version),
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Readings and evidence
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_readings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  local_date TEXT NOT NULL,
  release_version TEXT NOT NULL REFERENCES content_releases(version),
  reading_key TEXT NOT NULL,
  chart_fingerprint TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  assembly_mode TEXT NOT NULL
    CHECK (assembly_mode IN ('deterministic', 'constrained_model')),
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('pending', 'published', 'failed', 'superseded')),
  content_hash TEXT,
  -- Generated prose encrypted at rest (required when published)
  reading_enc BLOB,
  reading_key_version INTEGER,
  reading_nonce TEXT,
  primary_cycle_id TEXT,
  supporting_cycle_id TEXT,
  validation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, local_date, release_version),
  UNIQUE (reading_key),
  CHECK (
    status != 'published'
    OR (
      reading_enc IS NOT NULL
      AND reading_key_version IS NOT NULL
      AND reading_nonce IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_readings_user_date
  ON daily_readings(user_id, local_date DESC);

CREATE TABLE IF NOT EXISTS reading_sources (
  id TEXT PRIMARY KEY NOT NULL,
  reading_id TEXT NOT NULL REFERENCES daily_readings(id),
  paragraph_id TEXT NOT NULL,
  role TEXT NOT NULL,
  evidence_lane TEXT NOT NULL
    CHECK (evidence_lane IN (
      'celestial_facts', 'user_and_context', 'operational'
    )),
  text_hash TEXT,
  facts_json TEXT NOT NULL DEFAULT '[]',
  content_json TEXT NOT NULL DEFAULT '[]',
  context_json TEXT NOT NULL DEFAULT '[]',
  ranking_json TEXT NOT NULL DEFAULT '[]',
  model_output_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (reading_id, paragraph_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_sources_reading
  ON reading_sources(reading_id);

CREATE TABLE IF NOT EXISTS reading_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  reading_id TEXT NOT NULL REFERENCES daily_readings(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  resonance TEXT
    CHECK (resonance IS NULL OR resonance IN (
      'helpful', 'neutral', 'not_helpful', 'off'
    )),
  relevance_labels_json TEXT NOT NULL DEFAULT '[]',
  notes_enc BLOB,
  notes_key_version INTEGER,
  notes_nonce TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (reading_id, user_id, created_at)
);

-- ---------------------------------------------------------------------------
-- Connectors, devices, jobs, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  -- Token material lives in secrets store; only reference here
  token_ref TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN (
      'connected', 'needs_reauth', 'revoked', 'error'
    )),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token_hash TEXT NOT NULL,
  permission_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (user_id, token_hash)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'succeeded', 'failed', 'cancelled'
    )),
  payload_json TEXT,
  result_class TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

-- Idempotency is scoped to (job_type, user, key). A global (job_type, key)
-- namespace let a client-supplied string collide across tenants: the second
-- user's write was silently dropped and the first user's job and resource ids
-- were handed back to them.
--
-- user_id is nullable for system jobs, and SQLite treats NULLs as distinct in a
-- UNIQUE constraint, so COALESCE keeps system jobs in a single namespace rather
-- than silently skipping deduplication for them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_scope_key
  ON jobs(job_type, COALESCE(user_id, ''), idempotency_key);

CREATE INDEX IF NOT EXISTS idx_jobs_status_available
  ON jobs(status, available_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('user', 'system', 'support', 'editorial', 'service')),
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  -- Never store private payloads; opaque classes only
  detail_class TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created
  ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS export_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'ready', 'failed', 'expired'
    )),
  r2_uri TEXT,
  expires_at TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  -- Per-user, for the same reason as uq_jobs_scope_key.
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'completed', 'failed'
    )),
  dek_destroyed INTEGER NOT NULL DEFAULT 0 CHECK (dek_destroyed IN (0, 1)),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  -- Per-user, for the same reason as uq_jobs_scope_key.
  UNIQUE (user_id, idempotency_key)
);
