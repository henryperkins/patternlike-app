-- M7 AI-generated Your Pattern.
-- Contract package: contracts/m7 schema_version 0.7.0.
--
-- Widens consents.kind with pattern_generation (SQLite cannot ALTER a CHECK)
-- and adds the claim, job, document, artifact, ontology, and budget tables.
-- The consents rebuild runs under live FK enforcement; see the note above the
-- reference stash below for why it cannot switch foreign keys off.
-- Encrypted columns registered in apps/api/src/db/users.ts before any writer.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- consents: add pattern_generation without changing existing rows
-- ---------------------------------------------------------------------------

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'consents inbound FK set changed; 0007 stashes only the two known children'
WHERE EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT IN ('consents', 'sqlite_sequence', 'context_source_permissions', 'context_signals')
    AND lower(COALESCE(sql, '')) LIKE '%references consents%'
);

-- Park the two inbound consent references.
--
-- `wrangler d1 migrations apply` sends this file as one batch, which D1 runs as
-- one transaction -- the same atomicity the assertion probes above and below
-- depend on. SQLite ignores PRAGMA foreign_keys inside a transaction, so FK
-- enforcement is live at DROP TABLE consents below and its implicit DELETE FROM
-- would raise FOREIGN KEY constraint failed against any child row that names a
-- consent. PRAGMA defer_foreign_keys does not rescue it either: ALTER TABLE
-- RENAME does not settle the deferred violation counter, so the check still
-- fails at COMMIT.
--
-- Both consent_id columns are nullable (0001:140, 0001:287), so the references
-- are stashed, nulled for the length of the rebuild, and restored once the new
-- table carries the original name. The stash table lives and dies inside this
-- transaction.

CREATE TABLE consents_ref_stash_m7 (
  child_table TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_id TEXT,
  signal_id TEXT,
  consent_id TEXT NOT NULL
);

INSERT INTO consents_ref_stash_m7 (child_table, user_id, source_id, signal_id, consent_id)
SELECT 'context_source_permissions', user_id, source_id, NULL, consent_id
FROM context_source_permissions
WHERE consent_id IS NOT NULL;

INSERT INTO consents_ref_stash_m7 (child_table, user_id, source_id, signal_id, consent_id)
SELECT 'context_signals', user_id, NULL, id, consent_id
FROM context_signals
WHERE consent_id IS NOT NULL;

UPDATE context_source_permissions SET consent_id = NULL WHERE consent_id IS NOT NULL;
UPDATE context_signals SET consent_id = NULL WHERE consent_id IS NOT NULL;

CREATE TABLE consents_m7 (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL
    CHECK (kind IN (
      'account_processing', 'product_source', 'os_permission', 'oauth_scope',
      'ai_synthesis', 'pattern_generation', 'research', 'model_training',
      'export', 'support_access'
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

INSERT INTO consents_m7 (
  id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
  scopes_json, provider, connector_account_id, policy_version, ui_surface,
  granted_at, revoked_at, paused_at, expires_at, version, supersedes_consent_id,
  created_at, updated_at
)
SELECT
  id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
  scopes_json, provider, connector_account_id, policy_version, ui_surface,
  granted_at, revoked_at, paused_at, expires_at, version, supersedes_consent_id,
  created_at, updated_at
FROM consents;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'consents copy count mismatch while applying 0007'
WHERE (SELECT COUNT(*) FROM consents_m7) != (SELECT COUNT(*) FROM consents);

DROP INDEX IF EXISTS idx_consents_user_source;
DROP TABLE consents;
ALTER TABLE consents_m7 RENAME TO consents;

-- Restore the parked references. Every id is carried through the copy above, so
-- each restored value names a row that exists and the constraint is satisfied
-- immediately rather than deferred. A value that cannot be restored is
-- pre-existing corruption and fails the batch here rather than being dropped.

UPDATE context_source_permissions
SET consent_id = (
  SELECT s.consent_id FROM consents_ref_stash_m7 s
  WHERE s.child_table = 'context_source_permissions'
    AND s.user_id = context_source_permissions.user_id
    AND s.source_id = context_source_permissions.source_id
)
WHERE EXISTS (
  SELECT 1 FROM consents_ref_stash_m7 s
  WHERE s.child_table = 'context_source_permissions'
    AND s.user_id = context_source_permissions.user_id
    AND s.source_id = context_source_permissions.source_id
);

UPDATE context_signals
SET consent_id = (
  SELECT s.consent_id FROM consents_ref_stash_m7 s
  WHERE s.child_table = 'context_signals'
    AND s.signal_id = context_signals.id
)
WHERE EXISTS (
  SELECT 1 FROM consents_ref_stash_m7 s
  WHERE s.child_table = 'context_signals'
    AND s.signal_id = context_signals.id
);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'consent references not fully restored while applying 0007'
WHERE (SELECT COUNT(*) FROM consents_ref_stash_m7) != (
  (SELECT COUNT(*) FROM context_source_permissions WHERE consent_id IS NOT NULL)
  + (SELECT COUNT(*) FROM context_signals WHERE consent_id IS NOT NULL)
);

DROP TABLE consents_ref_stash_m7;

CREATE INDEX idx_consents_user_source
  ON consents(user_id, source_id, status);
CREATE INDEX idx_consents_user_kind_version
  ON consents(user_id, kind, version DESC, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- One Pattern opportunity per user and chart fingerprint
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_generation_claims (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  chart_fingerprint_hash TEXT NOT NULL,
  last_chart_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN (
      'available', 'reserved', 'accepted', 'deleted', 'superseded', 'withdrawn'
    )),
  active_generation_id TEXT,
  consumed_at TEXT,
  accepted_at TEXT,
  deleted_at TEXT,
  superseded_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, chart_fingerprint_hash),
  CHECK (
    (
      status IN ('available', 'reserved')
      AND consumed_at IS NULL
    )
    OR (
      status IN ('accepted', 'deleted', 'superseded', 'withdrawn')
      AND consumed_at IS NOT NULL
    )
  ),
  CHECK (
    (status = 'reserved' AND active_generation_id IS NOT NULL)
    OR (status != 'reserved' AND active_generation_id IS NULL)
  )
);

CREATE INDEX idx_pattern_claims_user_status
  ON pattern_generation_claims(user_id, status, updated_at);
CREATE INDEX idx_pattern_claims_fingerprint
  ON pattern_generation_claims(user_id, chart_fingerprint_hash);

-- ---------------------------------------------------------------------------
-- Domain job state (generic encrypted command stays on jobs.payload_enc)
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_generation_jobs (
  generation_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  claim_id TEXT NOT NULL REFERENCES pattern_generation_claims(id),
  chart_id TEXT NOT NULL,
  chart_fingerprint_hash TEXT NOT NULL,
  feature_set_id TEXT NOT NULL,
  feature_set_hash TEXT NOT NULL,
  feature_policy_version TEXT NOT NULL,
  selection_policy_version TEXT NOT NULL,
  locale TEXT NOT NULL,
  locale_revision INTEGER NOT NULL,
  consent_id TEXT NOT NULL,
  consent_policy_version TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  ontology_bundle_hash TEXT NOT NULL,
  corpus_release_hash TEXT NOT NULL,
  reservation_reason TEXT NOT NULL
    CHECK (reservation_reason IN (
      'first_open', 'first_open_retry', 'failed_attempt_retry', 'chart_correction'
    )),
  stage TEXT NOT NULL
    CHECK (stage IN (
      'reserved', 'planning', 'plan_validating', 'writing',
      'candidate_validating', 'semantic_verifying', 'publishing',
      'succeeded', 'failed', 'cancelled'
    )),
  stage_generation INTEGER NOT NULL DEFAULT 0,
  planner_attempts INTEGER NOT NULL DEFAULT 0,
  writer_attempts INTEGER NOT NULL DEFAULT 0,
  verifier_attempts INTEGER NOT NULL DEFAULT 0,
  plan_hash TEXT,
  candidate_hash TEXT,
  semantic_verdict_hash TEXT,
  public_failure_stage TEXT,
  failure_class TEXT,
  cancellation_reason TEXT,
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (generation_id, user_id)
);

CREATE INDEX idx_pattern_jobs_claim
  ON pattern_generation_jobs(claim_id, stage, updated_at);
CREATE INDEX idx_pattern_jobs_user_stage
  ON pattern_generation_jobs(user_id, stage, updated_at);
CREATE INDEX idx_pattern_jobs_retention
  ON pattern_generation_jobs(retention_expires_at, generation_id)
  WHERE retention_expires_at IS NOT NULL AND finished_at IS NOT NULL;

CREATE INDEX idx_jobs_pattern_undispatched
  ON jobs(created_at, id)
  WHERE job_type = 'generate_pattern' AND status = 'queued' AND dispatched_at IS NULL;
CREATE INDEX idx_jobs_pattern_expired_lease
  ON jobs(lease_expires_at, id)
  WHERE job_type = 'generate_pattern' AND status = 'running';

-- ---------------------------------------------------------------------------
-- Active accepted reader artifact
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_documents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  claim_id TEXT NOT NULL UNIQUE REFERENCES pattern_generation_claims(id),
  generation_id TEXT NOT NULL UNIQUE REFERENCES pattern_generation_jobs(generation_id),
  chart_fingerprint_hash TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  ontology_bundle_hash TEXT NOT NULL,
  locale TEXT NOT NULL,
  effective_accuracy TEXT NOT NULL,
  document_enc BLOB NOT NULL,
  document_nonce TEXT NOT NULL,
  wrapped_document_key_enc BLOB NOT NULL,
  wrapped_document_key_version INTEGER NOT NULL,
  wrapped_document_key_nonce TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  compact_provenance_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id)
);

CREATE INDEX idx_pattern_documents_ontology
  ON pattern_documents(ontology_version, user_id);

-- ---------------------------------------------------------------------------
-- Per-generation artifact key (erasable without destroying the account DEK)
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_generation_artifact_keys (
  generation_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  wrapped_key_enc BLOB,
  wrapped_key_version INTEGER,
  wrapped_key_nonce TEXT,
  created_at TEXT NOT NULL,
  erased_at TEXT,
  CHECK (
    (
      wrapped_key_enc IS NOT NULL
      AND wrapped_key_version IS NOT NULL
      AND wrapped_key_nonce IS NOT NULL
      AND erased_at IS NULL
    )
    OR (
      wrapped_key_enc IS NULL
      AND wrapped_key_version IS NULL
      AND wrapped_key_nonce IS NULL
      AND erased_at IS NOT NULL
    )
  )
);

-- ---------------------------------------------------------------------------
-- R2 inventory for exact generation artifacts
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_generation_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  artifact_class TEXT NOT NULL
    CHECK (artifact_class IN (
      'fact_packet', 'planner_request', 'planner_response', 'validated_plan',
      'writer_request', 'writer_response', 'rejected_candidate',
      'candidate_validation', 'verifier_request', 'verifier_response',
      'semantic_verdict', 'accepted_internal_document'
    )),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL,
  plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_pattern_artifacts_generation
  ON pattern_generation_artifacts(generation_id, artifact_class, id);
CREATE INDEX idx_pattern_artifacts_expiry
  ON pattern_generation_artifacts(expires_at, id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Administrator access audit
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_admin_access_events (
  id TEXT PRIMARY KEY NOT NULL,
  admin_subject TEXT NOT NULL,
  target_user_id TEXT,
  target_scope_hash TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  purpose_class TEXT NOT NULL
    CHECK (purpose_class IN (
      'quality_review', 'safety_investigation', 'incident_response', 'retention_audit'
    )),
  artifact_classes_json TEXT NOT NULL,
  result TEXT NOT NULL
    CHECK (result IN ('granted', 'denied', 'not_found', 'expired')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pattern_admin_access_generation
  ON pattern_admin_access_events(generation_id, created_at DESC);
CREATE INDEX idx_pattern_admin_access_retention
  ON pattern_admin_access_events(created_at, id);

-- ---------------------------------------------------------------------------
-- Ontology control plane (not user-owned)
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_ontology_releases (
  version TEXT PRIMARY KEY NOT NULL,
  bundle_hash TEXT NOT NULL UNIQUE,
  corpus_release_hash TEXT NOT NULL,
  locale TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('candidate', 'active', 'superseded', 'recalled')),
  object_key TEXT NOT NULL,
  evaluation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recalled_at TEXT
);

CREATE TABLE pattern_ontology_pointer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_version TEXT REFERENCES pattern_ontology_releases(version),
  updated_at TEXT NOT NULL
);

INSERT INTO pattern_ontology_pointer (id, active_version, updated_at)
VALUES (1, NULL, '1970-01-01T00:00:00Z');

CREATE TABLE pattern_ontology_evaluation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  ontology_version TEXT NOT NULL REFERENCES pattern_ontology_releases(version),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'reject')),
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pattern_ontology_recall_events (
  id TEXT PRIMARY KEY NOT NULL,
  ontology_version TEXT NOT NULL REFERENCES pattern_ontology_releases(version),
  reason_class TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pattern_provider_daily_usage (
  utc_date TEXT PRIMARY KEY NOT NULL,
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK (used_calls >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pattern_ontology_provider_daily_usage (
  utc_date TEXT PRIMARY KEY NOT NULL,
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK (used_calls >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
