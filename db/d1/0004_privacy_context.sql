-- Pattern-Like M6 privacy lifecycle and USR-06 daily check-in.
-- Contract amendment: contracts/m6 schema_version 0.6.0.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- user_keys: distinguish ordinary rotation retirement from account erasure
-- ---------------------------------------------------------------------------

-- Dropping/rebuilding a table with inbound references can silently rewrite or
-- invalidate those references. user_keys intentionally has none; prove that
-- invariant before touching it rather than relying on a schema assumption.
INSERT INTO assertion_probe (id, reason)
SELECT 1, 'user_keys gained an inbound foreign key; review 0004 before rebuilding it'
WHERE EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT IN ('user_keys', 'sqlite_sequence')
    AND lower(COALESCE(sql, '')) LIKE '%references user_keys%'
);

CREATE TABLE user_keys_m6_copy (
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  kek_version INTEGER NOT NULL DEFAULT 1,
  wrapped_dek BLOB,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  destroyed_at TEXT,
  erased_at TEXT,
  PRIMARY KEY (user_id, key_version),
  CHECK (
    (destroyed_at IS NULL AND erased_at IS NULL AND wrapped_dek IS NOT NULL)
    OR
    (destroyed_at IS NOT NULL AND erased_at IS NULL AND wrapped_dek IS NOT NULL)
    OR
    (destroyed_at IS NOT NULL AND erased_at IS NOT NULL AND wrapped_dek IS NULL)
  )
);

INSERT INTO user_keys_m6_copy (
  user_id, key_version, kek_version, wrapped_dek, created_at,
  rotated_at, destroyed_at, erased_at
)
SELECT
  user_id, key_version, kek_version, wrapped_dek, created_at,
  rotated_at, destroyed_at, NULL
FROM user_keys;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'user_keys copy count mismatch while applying 0004'
WHERE (SELECT COUNT(*) FROM user_keys_m6_copy)
   != (SELECT COUNT(*) FROM user_keys);

DROP INDEX IF EXISTS uq_user_keys_active;
DROP TABLE user_keys;

CREATE TABLE user_keys (
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  kek_version INTEGER NOT NULL DEFAULT 1,
  wrapped_dek BLOB,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  destroyed_at TEXT,
  erased_at TEXT,
  PRIMARY KEY (user_id, key_version),
  CHECK (
    (destroyed_at IS NULL AND erased_at IS NULL AND wrapped_dek IS NOT NULL)
    OR
    (destroyed_at IS NOT NULL AND erased_at IS NULL AND wrapped_dek IS NOT NULL)
    OR
    (destroyed_at IS NOT NULL AND erased_at IS NOT NULL AND wrapped_dek IS NULL)
  )
);

INSERT INTO user_keys (
  user_id, key_version, kek_version, wrapped_dek, created_at,
  rotated_at, destroyed_at, erased_at
)
SELECT
  user_id, key_version, kek_version, wrapped_dek, created_at,
  rotated_at, destroyed_at, erased_at
FROM user_keys_m6_copy;

DROP TABLE user_keys_m6_copy;

CREATE UNIQUE INDEX uq_user_keys_active
  ON user_keys(user_id) WHERE destroyed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Export and deletion durable state
-- ---------------------------------------------------------------------------

ALTER TABLE export_requests ADD COLUMN job_id TEXT;
ALTER TABLE export_requests ADD COLUMN wrapped_export_key BLOB;
ALTER TABLE export_requests ADD COLUMN export_key_nonce TEXT;
ALTER TABLE export_requests ADD COLUMN export_kek_version INTEGER
  CHECK (export_kek_version IS NULL OR export_kek_version > 0);
ALTER TABLE export_requests ADD COLUMN artifact_nonce TEXT;
ALTER TABLE export_requests ADD COLUMN object_size_bytes INTEGER
  CHECK (object_size_bytes IS NULL OR object_size_bytes >= 0);
ALTER TABLE export_requests ADD COLUMN status_updated_at TEXT;
ALTER TABLE export_requests ADD COLUMN error_class TEXT;
ALTER TABLE export_requests ADD COLUMN artifact_deleted_at TEXT;

UPDATE export_requests
SET status_updated_at = COALESCE(completed_at, created_at)
WHERE status_updated_at IS NULL;

CREATE UNIQUE INDEX uq_export_requests_job
  ON export_requests(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_export_requests_expiry
  ON export_requests(expires_at, id)
  WHERE status = 'ready' AND expires_at IS NOT NULL;
CREATE INDEX idx_export_requests_failed_cleanup
  ON export_requests(status_updated_at, id)
  WHERE status = 'failed' AND artifact_deleted_at IS NULL;

ALTER TABLE deletion_requests ADD COLUMN job_id TEXT;
ALTER TABLE deletion_requests ADD COLUMN receipt_hash TEXT
  CHECK (receipt_hash IS NULL OR length(receipt_hash) = 64);
ALTER TABLE deletion_requests ADD COLUMN receipt_expires_at TEXT;
ALTER TABLE deletion_requests ADD COLUMN checkpoint TEXT
  CHECK (
    checkpoint IS NULL OR checkpoint IN (
      'accepted', 'exports_fenced', 'objects_deleted', 'rows_deleted',
      'keys_erased', 'completed'
    )
  );
ALTER TABLE deletion_requests ADD COLUMN status_updated_at TEXT;
ALTER TABLE deletion_requests ADD COLUMN error_class TEXT;
-- Retained only long enough to redrive deletion of a late R2 PUT after the
-- export row and job have been erased. It contains opaque prefix-validated
-- object keys, never user-authored values or export key material.
ALTER TABLE deletion_requests ADD COLUMN artifact_manifest_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE deletion_requests ADD COLUMN artifact_cleanup_until TEXT;

UPDATE deletion_requests
SET checkpoint = CASE WHEN status = 'completed' THEN 'completed' ELSE 'accepted' END,
    status_updated_at = COALESCE(completed_at, created_at)
WHERE checkpoint IS NULL OR status_updated_at IS NULL;

CREATE UNIQUE INDEX uq_deletion_requests_job
  ON deletion_requests(job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX uq_deletion_requests_receipt_hash
  ON deletion_requests(receipt_hash) WHERE receipt_hash IS NOT NULL;
CREATE INDEX idx_deletion_requests_receipt_expiry
  ON deletion_requests(receipt_expires_at, id)
  WHERE receipt_hash IS NOT NULL;
CREATE INDEX idx_deletion_requests_artifact_cleanup
  ON deletion_requests(artifact_cleanup_until, id)
  WHERE artifact_manifest_json != '[]';

-- Privacy jobs share the encrypted jobs/outbox table but never a queue or
-- compare-and-swap namespace with daily reading generation.
CREATE INDEX idx_jobs_privacy_undispatched
  ON jobs(job_type, created_at, id)
  WHERE job_type IN ('export_account', 'delete_account')
    AND status = 'queued'
    AND dispatched_at IS NULL;

CREATE INDEX idx_jobs_privacy_running_lease
  ON jobs(job_type, lease_expires_at, id)
  WHERE job_type IN ('export_account', 'delete_account')
    AND status = 'running';

-- ---------------------------------------------------------------------------
-- USR-06 immutable daily revisions and bounded raw retention
-- ---------------------------------------------------------------------------

ALTER TABLE context_signals ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1
  CHECK (source_revision >= 1);
ALTER TABLE context_signals ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1
  CHECK (is_current IN (0, 1));
ALTER TABLE context_signals ADD COLUMN retention_expires_at TEXT;

-- normalized_hash is evidence, not identity. Repeating low -> high -> low is a
-- valid edit history, so the old uniqueness constraint must not suppress it.
DROP INDEX IF EXISTS uq_context_signals_norm;
CREATE INDEX idx_context_signals_norm_evidence
  ON context_signals(user_id, source_id, normalized_hash);

-- Deterministically number every historical USR-06 row within its local-day
-- window. SQLite's IS comparison deliberately treats two NULL windows as the
-- same window while leaving other source families untouched.
UPDATE context_signals AS target
SET source_revision = (
  SELECT COUNT(*)
  FROM context_signals AS prior
  WHERE prior.user_id = target.user_id
    AND prior.source_id = target.source_id
    AND prior.source_window IS target.source_window
    AND (
      prior.observed_at < target.observed_at
      OR (prior.observed_at = target.observed_at AND prior.id <= target.id)
    )
)
WHERE target.source_id = 'USR-06';

UPDATE context_signals
SET is_current = 0
WHERE source_id = 'USR-06';

UPDATE context_signals AS target
SET is_current = 1
WHERE target.source_id = 'USR-06'
  AND target.conflict_status = 'none'
  AND NOT EXISTS (
    SELECT 1
    FROM context_signals AS later
    WHERE later.user_id = target.user_id
      AND later.source_id = target.source_id
      AND later.source_window IS target.source_window
      AND later.conflict_status = 'none'
      AND (
        later.observed_at > target.observed_at
        OR (later.observed_at = target.observed_at AND later.id > target.id)
      )
  );

CREATE UNIQUE INDEX uq_context_signals_usr06_revision
  ON context_signals(
    user_id, source_id, COALESCE(source_window, ''), source_revision
  )
  WHERE source_id = 'USR-06';

CREATE UNIQUE INDEX uq_context_signals_usr06_current
  ON context_signals(user_id, source_id, COALESCE(source_window, ''))
  WHERE source_id = 'USR-06' AND is_current = 1;

CREATE INDEX idx_context_signals_retention
  ON context_signals(retention_expires_at, id)
  WHERE retention_expires_at IS NOT NULL;
