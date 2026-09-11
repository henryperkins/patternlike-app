-- Forward-only adaptive artwork reservation storage. Apply as ONE D1 migration
-- transaction after 0032, before compatible runtime writes; creation remains off.
-- D1 keeps foreign_keys enabled. Reconstruct the complete incoming-reference
-- closure with temporary FKs pointing at temporary parents; never rename an old
-- table (which would retarget incoming FKs), disable foreign_keys, or drop a
-- referenced parent while its children still exist. DROP leaf tables first.
-- Explicit column copies preserve old identities, leases, assets and completed_at.
-- No encrypted source/object bytes or old grants are rewritten or promoted.
PRAGMA defer_foreign_keys = ON;

-- Refuse unreviewed new inbound references before touching populated tables.
INSERT INTO assertion_probe(id, reason)
SELECT 1, 'portrait inbound FK set changed before 0033'
WHERE EXISTS (
  SELECT 1 FROM sqlite_master AS s
  WHERE s.type = 'table'
    AND (lower(COALESCE(s.sql, '')) LIKE '%references%pattern_portraits%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%portrait_automation_grants%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%pattern_portrait_jobs%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%portrait_mesh_jobs%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%pattern_portrait_assets%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%portrait_mesh_assets%'
      OR lower(COALESCE(s.sql, '')) LIKE '%references%portrait_start_outbox%')
    AND s.name NOT IN ('pattern_portraits','portrait_automation_grants',
      'pattern_portrait_jobs','portrait_mesh_jobs','pattern_portrait_assets',
      'portrait_mesh_assets','portrait_start_outbox')
);

-- Remove all dependent triggers while the table names are temporarily absent.

DROP TRIGGER pattern_portrait_document_erasure;
DROP TRIGGER pattern_portrait_cancel_cleanup;
DROP TRIGGER pattern_portrait_account_fence;
DROP TRIGGER pattern_portrait_consent_revoke_insert;
DROP TRIGGER pattern_portrait_consent_revoke_update;
DROP TRIGGER portrait_automation_publish;
DROP TRIGGER portrait_mesh_cancel_cleanup;
DROP TRIGGER portrait_mesh_parent_cancel;
DROP TRIGGER portrait_mesh_document_erasure;
DROP TRIGGER portrait_automation_withdraw;
DROP TRIGGER portrait_mesh_consent_insert;
DROP TRIGGER portrait_mesh_consent_update;
DROP TRIGGER portrait_mesh_account_delete;
DROP TRIGGER runtime_health_portrait_capture;
DROP TRIGGER runtime_health_mesh_capture;

CREATE TABLE pattern_portraits_adaptive_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pattern_id TEXT NOT NULL UNIQUE,
  generation_id TEXT NOT NULL,
  chart_id TEXT NOT NULL,
  chart_fingerprint_hash TEXT NOT NULL,
  document_revision TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  processing_consent_id TEXT NOT NULL,
  pattern_consent_id TEXT NOT NULL,
  consent_policy_version TEXT NOT NULL CHECK (consent_policy_version IN ('1.0.0','2.0.0')),
  sun_sign TEXT,
  status TEXT NOT NULL CHECK (status IN ('generating','failed','ready','cancelled')),
  graph_asset_id TEXT,
  checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 4
    CHECK (typeof(chapter_count) = 'integer' AND chapter_count BETWEEN 3 AND 6),
  protocol_version TEXT NOT NULL DEFAULT 'v1' CHECK (protocol_version IN ('v1','v2')),
  CHECK ((protocol_version = 'v1' AND chapter_count = 4 AND consent_policy_version = '1.0.0')
    OR (protocol_version = 'v2' AND consent_policy_version = '2.0.0'))
);
INSERT INTO pattern_portraits_adaptive_new (id, user_id, pattern_id, generation_id, chart_id, chart_fingerprint_hash, document_revision, document_hash, generated_at, ontology_version, processing_consent_id, pattern_consent_id, consent_policy_version, sun_sign, status, graph_asset_id, checked_at, created_at, updated_at)
SELECT id, user_id, pattern_id, generation_id, chart_id, chart_fingerprint_hash, document_revision, document_hash, generated_at, ontology_version, processing_consent_id, pattern_consent_id, consent_policy_version, sun_sign, status, graph_asset_id, checked_at, created_at, updated_at FROM pattern_portraits;

CREATE TABLE portrait_automation_grants_adaptive_new (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), chart_id TEXT NOT NULL,
  chart_fingerprint_hash TEXT NOT NULL, policy_version TEXT NOT NULL CHECK(policy_version IN ('1.1.0','2.0.0')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO portrait_automation_grants_adaptive_new (id, user_id, chart_id, chart_fingerprint_hash, policy_version, enabled, created_at, updated_at)
SELECT id, user_id, chart_id, chart_fingerprint_hash, policy_version, enabled, created_at, updated_at FROM portrait_automation_grants;

CREATE TABLE pattern_portrait_jobs_adaptive_new (
  id TEXT PRIMARY KEY,
  portrait_id TEXT NOT NULL REFERENCES pattern_portraits_adaptive_new(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  chapter_index INTEGER NOT NULL CHECK (typeof(chapter_index) = 'integer' AND chapter_index BETWEEN 0 AND 5),
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_hash TEXT,
  lease_expires_at TEXT,
  retry_at TEXT NOT NULL,
  failure_code TEXT,
  completion_hash TEXT,
  image_asset_id TEXT,
  sample_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(portrait_id, chapter_index),
  CHECK (status != 'running' OR (lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status != 'complete' OR (completion_hash IS NOT NULL AND image_asset_id IS NOT NULL AND sample_asset_id IS NOT NULL))
);
INSERT INTO pattern_portrait_jobs_adaptive_new (id, portrait_id, user_id, chapter_index, source_sha256, status, attempts, lease_hash, lease_expires_at, retry_at, failure_code, completion_hash, image_asset_id, sample_asset_id, created_at, updated_at, completed_at)
SELECT id, portrait_id, user_id, chapter_index, source_sha256, status, attempts, lease_hash, lease_expires_at, retry_at, failure_code, completion_hash, image_asset_id, sample_asset_id, created_at, updated_at, completed_at FROM pattern_portrait_jobs;

CREATE TABLE portrait_mesh_jobs_adaptive_new (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), portrait_id TEXT NOT NULL REFERENCES pattern_portraits_adaptive_new(id),
  grant_id TEXT NOT NULL REFERENCES portrait_automation_grants_adaptive_new(id), image_asset_id TEXT NOT NULL,
  processing_consent_id TEXT NOT NULL, pattern_consent_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL CHECK(typeof(chapter_index) = 'integer' AND chapter_index BETWEEN 0 AND 5), source_text_sha256 TEXT NOT NULL,
  source_image_sha256 TEXT NOT NULL, document_revision TEXT NOT NULL, compiler_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','complete','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_hash TEXT, lease_expires_at TEXT,
  retry_at TEXT NOT NULL, failure_code TEXT, completion_hash TEXT, model_asset_id TEXT, provenance_asset_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(portrait_id,chapter_index,compiler_version),
  CHECK(status!='running' OR (lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(status!='complete' OR (model_asset_id IS NOT NULL AND provenance_asset_id IS NOT NULL AND completion_hash IS NOT NULL))
);
INSERT INTO portrait_mesh_jobs_adaptive_new (id, user_id, portrait_id, grant_id, image_asset_id, processing_consent_id, pattern_consent_id, chapter_index, source_text_sha256, source_image_sha256, document_revision, compiler_version, status, attempts, lease_hash, lease_expires_at, retry_at, failure_code, completion_hash, model_asset_id, provenance_asset_id, created_at, updated_at, completed_at)
SELECT id, user_id, portrait_id, grant_id, image_asset_id, processing_consent_id, pattern_consent_id, chapter_index, source_text_sha256, source_image_sha256, document_revision, compiler_version, status, attempts, lease_hash, lease_expires_at, retry_at, failure_code, completion_hash, model_asset_id, provenance_asset_id, created_at, updated_at, completed_at FROM portrait_mesh_jobs;

CREATE TABLE pattern_portrait_assets_adaptive_new (
  id TEXT PRIMARY KEY,
  portrait_id TEXT NOT NULL REFERENCES pattern_portraits_adaptive_new(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  job_id TEXT REFERENCES pattern_portrait_jobs_adaptive_new(id),
  role TEXT NOT NULL CHECK (role IN ('image','sample','graph')),
  object_key TEXT NOT NULL UNIQUE CHECK (object_key LIKE 'pattern-portraits/%'),
  plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 3145728),
  created_at TEXT NOT NULL,
  cleanup_at TEXT,
  deleted_at TEXT
);
INSERT INTO pattern_portrait_assets_adaptive_new (id, portrait_id, user_id, job_id, role, object_key, plaintext_sha256, byte_length, created_at, cleanup_at, deleted_at)
SELECT id, portrait_id, user_id, job_id, role, object_key, plaintext_sha256, byte_length, created_at, cleanup_at, deleted_at FROM pattern_portrait_assets;

CREATE TABLE portrait_mesh_assets_adaptive_new (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), portrait_id TEXT NOT NULL REFERENCES pattern_portraits_adaptive_new(id),
  job_id TEXT NOT NULL REFERENCES portrait_mesh_jobs_adaptive_new(id), role TEXT NOT NULL CHECK(role IN ('model','provenance')),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key LIKE 'portrait-meshes/%'), plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=750000), created_at TEXT NOT NULL,
  cleanup_at TEXT, deleted_at TEXT
);
INSERT INTO portrait_mesh_assets_adaptive_new (id, user_id, portrait_id, job_id, role, object_key, plaintext_sha256, byte_length, created_at, cleanup_at, deleted_at)
SELECT id, user_id, portrait_id, job_id, role, object_key, plaintext_sha256, byte_length, created_at, cleanup_at, deleted_at FROM portrait_mesh_assets;

CREATE TABLE portrait_start_outbox_adaptive_new (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), pattern_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL REFERENCES portrait_automation_grants_adaptive_new(id), chart_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','cancelled','unsupported')),
  checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z', created_at TEXT NOT NULL
);
INSERT INTO portrait_start_outbox_adaptive_new (id, user_id, pattern_id, grant_id, chart_id, status, checked_at, created_at)
SELECT id, user_id, pattern_id, grant_id, chart_id, status, checked_at, created_at FROM portrait_start_outbox;

-- Every old inbound child is removed before its old parent.
DROP TABLE portrait_start_outbox;
DROP TABLE portrait_mesh_assets;
DROP TABLE pattern_portrait_assets;
DROP TABLE portrait_mesh_jobs;
DROP TABLE pattern_portrait_jobs;
DROP TABLE portrait_automation_grants;
DROP TABLE pattern_portraits;

-- SQLite rewrites the temporary child FKs as each new parent is renamed.
ALTER TABLE pattern_portraits_adaptive_new RENAME TO pattern_portraits;
ALTER TABLE portrait_automation_grants_adaptive_new RENAME TO portrait_automation_grants;
ALTER TABLE pattern_portrait_jobs_adaptive_new RENAME TO pattern_portrait_jobs;
ALTER TABLE portrait_mesh_jobs_adaptive_new RENAME TO portrait_mesh_jobs;
ALTER TABLE pattern_portrait_assets_adaptive_new RENAME TO pattern_portrait_assets;
ALTER TABLE portrait_mesh_assets_adaptive_new RENAME TO portrait_mesh_assets;
ALTER TABLE portrait_start_outbox_adaptive_new RENAME TO portrait_start_outbox;

-- Restore every original named index and trigger, including 0032 telemetry.
CREATE INDEX pattern_portraits_user ON pattern_portraits(user_id, status);
CREATE INDEX pattern_portraits_maintenance ON pattern_portraits(checked_at, id);
CREATE INDEX pattern_portrait_jobs_dispatch ON pattern_portrait_jobs(status, retry_at, lease_expires_at);
CREATE INDEX pattern_portrait_assets_cleanup ON pattern_portrait_assets(cleanup_at, id);
CREATE INDEX pattern_portrait_assets_user ON pattern_portrait_assets(user_id);
CREATE UNIQUE INDEX portrait_automation_active ON portrait_automation_grants(user_id,chart_id) WHERE enabled=1;
CREATE INDEX portrait_automation_owner ON portrait_automation_grants(user_id,chart_id,created_at);
CREATE INDEX portrait_start_dispatch ON portrait_start_outbox(status,checked_at);
CREATE INDEX portrait_mesh_dispatch ON portrait_mesh_jobs(status,retry_at,lease_expires_at);
CREATE INDEX portrait_mesh_cleanup ON portrait_mesh_assets(cleanup_at,deleted_at);
CREATE INDEX idx_runtime_portrait_state_time ON pattern_portrait_jobs(status,julianday(completed_at));
CREATE INDEX idx_runtime_mesh_state_time ON portrait_mesh_jobs(status,julianday(completed_at));
CREATE TRIGGER pattern_portrait_document_erasure AFTER DELETE ON pattern_documents
BEGIN
  UPDATE pattern_portraits SET status = 'cancelled', graph_asset_id = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE pattern_id = OLD.id;
  UPDATE pattern_portrait_jobs SET status = 'cancelled', lease_hash = NULL, lease_expires_at = NULL
    WHERE portrait_id IN (SELECT id FROM pattern_portraits WHERE pattern_id = OLD.id);
  UPDATE pattern_portrait_assets SET cleanup_at = COALESCE(cleanup_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE portrait_id IN (SELECT id FROM pattern_portraits WHERE pattern_id = OLD.id);
END;
CREATE TRIGGER pattern_portrait_cancel_cleanup AFTER UPDATE OF status ON pattern_portraits
WHEN NEW.status = 'cancelled'
BEGIN
  UPDATE pattern_portrait_jobs SET status = 'cancelled', lease_hash = NULL, lease_expires_at = NULL
    WHERE portrait_id = NEW.id;
  UPDATE pattern_portrait_assets SET cleanup_at = COALESCE(cleanup_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE portrait_id = NEW.id;
END;
CREATE TRIGGER pattern_portrait_account_fence AFTER UPDATE OF status ON users
WHEN NEW.status IN ('pending_deletion','deleted')
BEGIN
  UPDATE pattern_portraits SET status = 'cancelled', graph_asset_id = NULL
    WHERE user_id = NEW.id;
END;
CREATE TRIGGER pattern_portrait_consent_revoke_insert AFTER INSERT ON consents
WHEN NEW.kind IN ('pattern_generation','account_processing') AND NEW.status != 'granted'
BEGIN
  UPDATE pattern_portraits SET status = 'cancelled', graph_asset_id = NULL
    WHERE user_id = NEW.user_id AND status != 'ready';
END;
CREATE TRIGGER pattern_portrait_consent_revoke_update AFTER UPDATE OF status ON consents
WHEN NEW.kind IN ('pattern_generation','account_processing') AND NEW.status != 'granted'
BEGIN
  UPDATE pattern_portraits SET status = 'cancelled', graph_asset_id = NULL
    WHERE user_id = NEW.user_id AND status != 'ready';
END;
CREATE TRIGGER portrait_automation_publish AFTER INSERT ON pattern_documents
BEGIN
  INSERT OR IGNORE INTO portrait_start_outbox(id,user_id,pattern_id,grant_id,chart_id,status,created_at)
  SELECT 'ppstart_'||lower(hex(randomblob(16))),NEW.user_id,NEW.id,g.id,g.chart_id,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM portrait_automation_grants g JOIN chart_snapshots c ON c.id=g.chart_id AND c.user_id=g.user_id AND c.status='active'
  WHERE g.user_id=NEW.user_id AND g.chart_fingerprint_hash=NEW.chart_fingerprint_hash AND g.enabled=1;
END;
CREATE TRIGGER portrait_mesh_cancel_cleanup AFTER UPDATE OF status ON portrait_mesh_jobs WHEN NEW.status='cancelled'
BEGIN
  UPDATE portrait_mesh_assets SET cleanup_at=COALESCE(cleanup_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE job_id=NEW.id;
END;
CREATE TRIGGER portrait_mesh_parent_cancel AFTER UPDATE OF status ON pattern_portraits WHEN NEW.status='cancelled'
BEGIN
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE portrait_id=NEW.id;
END;
CREATE TRIGGER portrait_mesh_document_erasure AFTER DELETE ON pattern_documents
BEGIN
  UPDATE portrait_start_outbox SET status='cancelled' WHERE pattern_id=OLD.id;
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE portrait_id IN(SELECT id FROM pattern_portraits WHERE pattern_id=OLD.id);
END;
CREATE TRIGGER portrait_automation_withdraw AFTER UPDATE OF enabled ON portrait_automation_grants WHEN NEW.enabled=0
BEGIN
  UPDATE portrait_start_outbox SET status='cancelled' WHERE grant_id=NEW.id AND status='pending';
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE grant_id=NEW.id AND status!='complete';
  UPDATE pattern_portrait_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE status!='complete' AND portrait_id IN(SELECT id FROM pattern_portraits WHERE pattern_id IN(SELECT pattern_id FROM portrait_start_outbox WHERE grant_id=NEW.id));
  UPDATE pattern_portraits SET status='failed' WHERE status IN('generating','failed') AND pattern_id IN(SELECT pattern_id FROM portrait_start_outbox WHERE grant_id=NEW.id);
END;
CREATE TRIGGER portrait_mesh_consent_insert AFTER INSERT ON consents WHEN NEW.kind IN('pattern_generation','account_processing') AND NEW.status!='granted'
BEGIN
  UPDATE portrait_automation_grants SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=NEW.user_id AND enabled=1;
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE user_id=NEW.user_id AND status!='complete';
END;
CREATE TRIGGER portrait_mesh_consent_update AFTER UPDATE OF status ON consents WHEN NEW.kind IN('pattern_generation','account_processing') AND NEW.status!='granted'
BEGIN
  UPDATE portrait_automation_grants SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=NEW.user_id AND enabled=1;
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE user_id=NEW.user_id AND status!='complete';
END;
CREATE TRIGGER portrait_mesh_account_delete AFTER UPDATE OF status ON users WHEN NEW.status IN('pending_deletion','deleted')
BEGIN
  UPDATE portrait_automation_grants SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=NEW.id AND enabled=1;
  UPDATE portrait_start_outbox SET status='cancelled' WHERE user_id=NEW.id;
  UPDATE portrait_mesh_jobs SET status='cancelled',lease_hash=NULL,lease_expires_at=NULL WHERE user_id=NEW.id;
END;
CREATE TRIGGER runtime_health_portrait_capture AFTER UPDATE OF status ON pattern_portrait_jobs
WHEN NEW.status='complete' AND OLD.status!='complete' AND NEW.completed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO runtime_health_capture VALUES('portrait',NEW.completed_at);
END;
CREATE TRIGGER runtime_health_mesh_capture AFTER UPDATE OF status ON portrait_mesh_jobs
WHEN NEW.status='complete' AND OLD.status!='complete' AND NEW.completed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO runtime_health_capture VALUES('mesh',NEW.completed_at);
END;

-- Reservation identity cannot change after it has been accepted, even before jobs.
CREATE TRIGGER pattern_portrait_adaptive_identity_immutable
BEFORE UPDATE OF chapter_count, protocol_version ON pattern_portraits
WHEN NEW.chapter_count IS NOT OLD.chapter_count OR NEW.protocol_version IS NOT OLD.protocol_version
BEGIN
  SELECT RAISE(ABORT, 'portrait count and protocol are immutable');
END;

CREATE TRIGGER pattern_portrait_jobs_chapter_insert
BEFORE INSERT ON pattern_portrait_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM pattern_portraits p WHERE p.id = NEW.portrait_id
    AND typeof(NEW.chapter_index) = 'integer'
    AND NEW.chapter_index >= 0 AND NEW.chapter_index < p.chapter_count
)
BEGIN
  SELECT RAISE(ABORT, 'portrait chapter index is outside frozen count');
END;
CREATE TRIGGER pattern_portrait_jobs_chapter_update
BEFORE UPDATE OF portrait_id, chapter_index ON pattern_portrait_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM pattern_portraits p WHERE p.id = NEW.portrait_id
    AND typeof(NEW.chapter_index) = 'integer'
    AND NEW.chapter_index >= 0 AND NEW.chapter_index < p.chapter_count
)
BEGIN
  SELECT RAISE(ABORT, 'portrait chapter index is outside frozen count');
END;
CREATE TRIGGER portrait_mesh_jobs_chapter_insert
BEFORE INSERT ON portrait_mesh_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM pattern_portraits p WHERE p.id = NEW.portrait_id
    AND typeof(NEW.chapter_index) = 'integer'
    AND NEW.chapter_index >= 0 AND NEW.chapter_index < p.chapter_count
)
BEGIN
  SELECT RAISE(ABORT, 'portrait chapter index is outside frozen count');
END;
CREATE TRIGGER portrait_mesh_jobs_chapter_update
BEFORE UPDATE OF portrait_id, chapter_index ON portrait_mesh_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM pattern_portraits p WHERE p.id = NEW.portrait_id
    AND typeof(NEW.chapter_index) = 'integer'
    AND NEW.chapter_index >= 0 AND NEW.chapter_index < p.chapter_count
)
BEGIN
  SELECT RAISE(ABORT, 'portrait chapter index is outside frozen count');
END;

-- The migration transaction must commit with foreign keys still enabled. Keep
-- defer_foreign_keys enabled until commit: toggling it off can hide violations.
-- Local recovery: any statement/commit failure rolls back the ENTIRE migration;
-- rerun only after confirming 0033 is unrecorded and original tables are intact.
-- Before an authorized production application, take an external export/bookmark
-- and rehearse populated data in D1. Local sqlite3 proof is not D1 apply evidence.
-- After v2 rows exist, disable adaptive admission for recovery and retain a v2
-- compatible reader/terminal/cleanup Worker. Do not reverse this schema or retag
-- v2 rows/leases as v1; repair forward, preserving grants and cleanup inventory.
