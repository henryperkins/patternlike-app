-- M9 Pattern regeneration after Pattern-creation source changes.
--
-- Forward-only. Existing ciphertext is copied byte-for-byte. No encryption or
-- root-key version changes. Existing jobs/documents receive the all-zero legacy
-- source coordinate because their creating source cannot be reconstructed.

PRAGMA foreign_keys = ON;

DROP TRIGGER pattern_claim_transition_guard;

ALTER TABLE pattern_generation_claims
  ADD COLUMN pending_regeneration_id TEXT;

CREATE UNIQUE INDEX idx_pattern_claims_pending_regeneration
  ON pattern_generation_claims(pending_regeneration_id)
  WHERE pending_regeneration_id IS NOT NULL;

-- Refuse an unexpected new inbound dependency rather than dropping it during
-- the job/document rebuild below.
INSERT INTO assertion_probe (id, reason)
SELECT 1, 'pattern_generation_jobs inbound FK set changed before 0023'
WHERE EXISTS (
  SELECT 1 FROM sqlite_master
  WHERE type = 'table'
    AND name NOT IN ('pattern_generation_jobs', 'pattern_documents')
    AND lower(COALESCE(sql, '')) LIKE '%references pattern_generation_jobs%'
);

CREATE TABLE pattern_source_regeneration_counts (
  table_name TEXT PRIMARY KEY NOT NULL,
  row_count INTEGER NOT NULL
);

INSERT INTO pattern_source_regeneration_counts (table_name, row_count)
VALUES
  ('pattern_generation_jobs', (SELECT COUNT(*) FROM pattern_generation_jobs)),
  ('pattern_documents', (SELECT COUNT(*) FROM pattern_documents)),
  ('pattern_erasure_replay_events', (SELECT COUNT(*) FROM pattern_erasure_replay_events));

DROP INDEX idx_pattern_documents_ontology;
DROP INDEX idx_pattern_jobs_claim;
DROP INDEX idx_pattern_jobs_user_stage;
DROP INDEX idx_pattern_jobs_retention;

ALTER TABLE pattern_documents RENAME TO pattern_documents_m9_old;
ALTER TABLE pattern_generation_jobs RENAME TO pattern_generation_jobs_m9_old;

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
  pattern_source_hash TEXT NOT NULL CHECK (
    length(pattern_source_hash) = 71
    AND substr(pattern_source_hash, 1, 7) = 'sha256:'
    AND substr(pattern_source_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  reservation_reason TEXT NOT NULL
    CHECK (reservation_reason IN (
      'first_open', 'first_open_retry', 'failed_attempt_retry',
      'chart_correction', 'source_update'
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

INSERT INTO pattern_generation_jobs (
  generation_id, job_id, user_id, claim_id, chart_id,
  chart_fingerprint_hash, feature_set_id, feature_set_hash,
  feature_policy_version, selection_policy_version, locale, locale_revision,
  consent_id, consent_policy_version, ontology_version,
  ontology_bundle_hash, corpus_release_hash, pattern_source_hash,
  reservation_reason, stage, stage_generation, planner_attempts,
  writer_attempts, verifier_attempts, plan_hash, candidate_hash,
  semantic_verdict_hash, public_failure_stage, failure_class,
  cancellation_reason, retention_expires_at, created_at, updated_at, finished_at
)
SELECT
  generation_id, job_id, user_id, claim_id, chart_id,
  chart_fingerprint_hash, feature_set_id, feature_set_hash,
  feature_policy_version, selection_policy_version, locale, locale_revision,
  consent_id, consent_policy_version, ontology_version,
  ontology_bundle_hash, corpus_release_hash,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  reservation_reason, stage, stage_generation, planner_attempts,
  writer_attempts, verifier_attempts, plan_hash, candidate_hash,
  semantic_verdict_hash, public_failure_stage, failure_class,
  cancellation_reason, retention_expires_at, created_at, updated_at, finished_at
FROM pattern_generation_jobs_m9_old;

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
  pattern_source_hash TEXT NOT NULL CHECK (
    length(pattern_source_hash) = 71
    AND substr(pattern_source_hash, 1, 7) = 'sha256:'
    AND substr(pattern_source_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id)
);

INSERT INTO pattern_documents (
  id, user_id, claim_id, generation_id, chart_fingerprint_hash,
  ontology_version, ontology_bundle_hash, locale, effective_accuracy,
  document_enc, document_nonce, wrapped_document_key_enc,
  wrapped_document_key_version, wrapped_document_key_nonce, content_hash,
  compact_provenance_json, pattern_source_hash, generated_at, created_at
)
SELECT
  id, user_id, claim_id, generation_id, chart_fingerprint_hash,
  ontology_version, ontology_bundle_hash, locale, effective_accuracy,
  document_enc, document_nonce, wrapped_document_key_enc,
  wrapped_document_key_version, wrapped_document_key_nonce, content_hash,
  compact_provenance_json,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  generated_at, created_at
FROM pattern_documents_m9_old;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'pattern generation rows changed while applying 0023'
WHERE (SELECT row_count FROM pattern_source_regeneration_counts
       WHERE table_name = 'pattern_generation_jobs')
   != (SELECT COUNT(*) FROM pattern_generation_jobs)
   OR (SELECT row_count FROM pattern_source_regeneration_counts
       WHERE table_name = 'pattern_documents')
   != (SELECT COUNT(*) FROM pattern_documents);

DROP TABLE pattern_documents_m9_old;
DROP TABLE pattern_generation_jobs_m9_old;

CREATE INDEX idx_pattern_jobs_claim
  ON pattern_generation_jobs(claim_id, stage, updated_at);
CREATE INDEX idx_pattern_jobs_user_stage
  ON pattern_generation_jobs(user_id, stage, updated_at);
CREATE INDEX idx_pattern_jobs_retention
  ON pattern_generation_jobs(retention_expires_at, generation_id)
  WHERE retention_expires_at IS NOT NULL AND finished_at IS NOT NULL;
CREATE INDEX idx_pattern_documents_ontology
  ON pattern_documents(ontology_version, user_id);

-- Widen the receipt table for one signed accepted-to-accepted replacement
-- event. M7 rows retain null replacement coordinates and remain valid.
DROP INDEX idx_pattern_erasure_replay_occurred;
DROP INDEX idx_pattern_erasure_replay_target;
ALTER TABLE pattern_erasure_replay_events
  RENAME TO pattern_erasure_replay_events_m9_old;

CREATE TABLE pattern_erasure_replay_events (
  event_id TEXT PRIMARY KEY NOT NULL
    CHECK (event_id GLOB 'prel_*' AND length(event_id) = 37),
  event_class TEXT NOT NULL
    CHECK (event_class IN (
      'claim_consumed', 'pattern_deleted', 'chart_correction_erased',
      'pattern_withdrawn', 'ontology_recalled', 'account_deleted',
      'pattern_regenerated'
    )),
  occurred_at TEXT NOT NULL,
  target_user_id TEXT,
  chart_fingerprint_hash TEXT,
  claim_id TEXT,
  generation_id TEXT,
  pattern_id TEXT,
  replacement_generation_id TEXT,
  replacement_pattern_id TEXT,
  ontology_version TEXT,
  prior_claim_status TEXT
    CHECK (
      prior_claim_status IS NULL
      OR prior_claim_status IN (
        'available', 'reserved', 'accepted', 'deleted', 'superseded', 'withdrawn'
      )
    ),
  next_claim_status TEXT,
  pattern_source_hash TEXT CHECK (
    pattern_source_hash IS NULL OR (
      length(pattern_source_hash) = 71
      AND substr(pattern_source_hash, 1, 7) = 'sha256:'
      AND substr(pattern_source_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  content_hash TEXT NOT NULL
    CHECK (content_hash GLOB 'sha256:*' AND length(content_hash) = 71),
  signing_key_id TEXT NOT NULL
    CHECK (length(signing_key_id) BETWEEN 1 AND 128),
  signature TEXT NOT NULL,
  replica_put_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((event_class = 'ontology_recalled') = (next_claim_status IS NULL)),
  CHECK (
    event_class != 'ontology_recalled'
    OR (ontology_version IS NOT NULL AND length(ontology_version) > 0)
  ),
  CHECK (
    (
      event_class = 'ontology_recalled'
      AND next_claim_status IS NULL
    )
    OR (
      event_class = 'claim_consumed'
      AND next_claim_status IN ('accepted', 'deleted', 'superseded', 'withdrawn')
    )
    OR (
      event_class IN ('pattern_deleted', 'account_deleted')
      AND next_claim_status = 'deleted'
    )
    OR (
      event_class = 'chart_correction_erased'
      AND next_claim_status = 'superseded'
    )
    OR (
      event_class = 'pattern_withdrawn'
      AND next_claim_status = 'withdrawn'
    )
    OR (
      event_class = 'pattern_regenerated'
      AND prior_claim_status = 'accepted'
      AND next_claim_status = 'accepted'
    )
  ),
  CHECK (event_class = 'ontology_recalled' OR target_user_id IS NOT NULL),
  CHECK (
    event_class IN ('ontology_recalled', 'account_deleted')
    OR (chart_fingerprint_hash IS NOT NULL AND claim_id IS NOT NULL)
  ),
  CHECK (
    (
      event_class = 'pattern_regenerated'
      AND generation_id IS NOT NULL
      AND pattern_id IS NOT NULL
      AND replacement_generation_id IS NOT NULL
      AND replacement_pattern_id IS NOT NULL
      AND pattern_source_hash IS NOT NULL
    )
    OR (
      event_class != 'pattern_regenerated'
      AND replacement_generation_id IS NULL
      AND replacement_pattern_id IS NULL
      AND pattern_source_hash IS NULL
    )
  )
);

INSERT INTO pattern_erasure_replay_events (
  event_id, event_class, occurred_at, target_user_id,
  chart_fingerprint_hash, claim_id, generation_id, pattern_id,
  replacement_generation_id, replacement_pattern_id, ontology_version,
  prior_claim_status, next_claim_status, pattern_source_hash, content_hash,
  signing_key_id, signature, replica_put_at, created_at
)
SELECT
  event_id, event_class, occurred_at, target_user_id,
  chart_fingerprint_hash, claim_id, generation_id, pattern_id,
  NULL, NULL, ontology_version, prior_claim_status, next_claim_status, NULL,
  content_hash, signing_key_id, signature, replica_put_at, created_at
FROM pattern_erasure_replay_events_m9_old;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'pattern replay rows changed while applying 0023'
WHERE (SELECT row_count FROM pattern_source_regeneration_counts
       WHERE table_name = 'pattern_erasure_replay_events')
   != (SELECT COUNT(*) FROM pattern_erasure_replay_events);

DROP TABLE pattern_erasure_replay_events_m9_old;

CREATE INDEX idx_pattern_erasure_replay_occurred
  ON pattern_erasure_replay_events(occurred_at, event_id);
CREATE INDEX idx_pattern_erasure_replay_target
  ON pattern_erasure_replay_events(target_user_id, occurred_at)
  WHERE target_user_id IS NOT NULL;

DROP TABLE pattern_source_regeneration_counts;

CREATE TRIGGER pattern_claim_pending_insert_guard
BEFORE INSERT ON pattern_generation_claims
FOR EACH ROW
BEGIN
  SELECT (CASE
    WHEN NEW.pending_regeneration_id IS NOT NULL
    THEN RAISE(ABORT, 'new pattern claim cannot start with pending regeneration')
  END);
END;

CREATE TRIGGER pattern_claim_transition_guard
BEFORE UPDATE ON pattern_generation_claims
FOR EACH ROW
BEGIN
  SELECT (CASE
    WHEN NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'available' AND NEW.status = 'reserved')
      OR (OLD.status = 'reserved' AND NEW.status = 'available')
      OR (OLD.status = 'reserved' AND NEW.status = 'accepted')
      OR (
        OLD.status = 'accepted'
        AND NEW.status IN ('deleted', 'superseded', 'withdrawn')
      )
    )
    THEN RAISE(ABORT, 'illegal pattern claim transition')
  END);

  SELECT (CASE
    WHEN NEW.id IS NOT OLD.id
      OR NEW.user_id IS NOT OLD.user_id
      OR NEW.chart_fingerprint_hash IS NOT OLD.chart_fingerprint_hash
      OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'pattern claim identity is immutable')
  END);

  SELECT (CASE
    WHEN OLD.status = 'reserved' AND NEW.status = 'accepted'
      AND (NEW.consumed_at IS NULL OR NEW.accepted_at IS NULL)
    THEN RAISE(ABORT, 'accepted pattern claim requires consumption timestamps')
    WHEN NOT (OLD.status = 'reserved' AND NEW.status = 'accepted')
      AND (
        NEW.consumed_at IS NOT OLD.consumed_at
        OR NEW.accepted_at IS NOT OLD.accepted_at
      )
    THEN RAISE(ABORT, 'pattern claim consumption is immutable')
  END);

  SELECT (CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'deleted'
      AND NEW.deleted_at IS NULL
    THEN RAISE(ABORT, 'deleted pattern claim requires deleted_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'deleted')
      AND NEW.deleted_at IS NOT OLD.deleted_at
    THEN RAISE(ABORT, 'pattern claim deleted_at is immutable')
  END);

  SELECT (CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'superseded'
      AND NEW.superseded_at IS NULL
    THEN RAISE(ABORT, 'superseded pattern claim requires superseded_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'superseded')
      AND NEW.superseded_at IS NOT OLD.superseded_at
    THEN RAISE(ABORT, 'pattern claim superseded_at is immutable')
  END);

  SELECT (CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'withdrawn'
      AND NEW.withdrawn_at IS NULL
    THEN RAISE(ABORT, 'withdrawn pattern claim requires withdrawn_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'withdrawn')
      AND NEW.withdrawn_at IS NOT OLD.withdrawn_at
    THEN RAISE(ABORT, 'pattern claim withdrawn_at is immutable')
  END);

  SELECT (CASE
    WHEN NEW.status = OLD.status
      AND NEW.active_generation_id IS NOT OLD.active_generation_id
    THEN RAISE(ABORT, 'same-state pattern claim cannot change generation owner')
  END);

  SELECT (CASE
    WHEN NEW.status != 'accepted' AND NEW.pending_regeneration_id IS NOT NULL
    THEN RAISE(ABORT, 'only accepted pattern claim may regenerate')
    WHEN OLD.status = 'accepted' AND NEW.status != 'accepted'
      AND OLD.pending_regeneration_id IS NOT NULL
    THEN RAISE(ABORT, 'pending pattern regeneration must finish before terminal transition')
    WHEN NEW.pending_regeneration_id IS NOT OLD.pending_regeneration_id
      AND NOT (
        OLD.status = 'accepted'
        AND NEW.status = 'accepted'
        AND (
          (OLD.pending_regeneration_id IS NULL AND NEW.pending_regeneration_id IS NOT NULL)
          OR (OLD.pending_regeneration_id IS NOT NULL AND NEW.pending_regeneration_id IS NULL)
        )
      )
    THEN RAISE(ABORT, 'illegal pattern regeneration owner transition')
  END);
END;
