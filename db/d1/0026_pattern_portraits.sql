-- Additive private portrait outbox. Content remains encrypted in ARTIFACTS
-- under the accepted Pattern key; no new user-DEK ciphertext column is added.
-- Deliberately no FK to pattern_documents: cleanup inventory must survive erasure.
CREATE TABLE pattern_portraits (
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
  consent_policy_version TEXT NOT NULL CHECK (consent_policy_version = '1.0.0'),
  sun_sign TEXT,
  status TEXT NOT NULL CHECK (status IN ('generating','failed','ready','cancelled')),
  graph_asset_id TEXT,
  checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX pattern_portraits_user ON pattern_portraits(user_id, status);
CREATE INDEX pattern_portraits_maintenance ON pattern_portraits(checked_at, id);
CREATE TABLE pattern_portrait_jobs (
  id TEXT PRIMARY KEY,
  portrait_id TEXT NOT NULL REFERENCES pattern_portraits(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  chapter_index INTEGER NOT NULL CHECK (chapter_index BETWEEN 0 AND 3),
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
  updated_at TEXT NOT NULL,
  UNIQUE(portrait_id, chapter_index),
  CHECK (status != 'running' OR (lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status != 'complete' OR (completion_hash IS NOT NULL AND image_asset_id IS NOT NULL AND sample_asset_id IS NOT NULL))
);
CREATE INDEX pattern_portrait_jobs_dispatch ON pattern_portrait_jobs(status, retry_at, lease_expires_at);
CREATE TABLE pattern_portrait_assets (
  id TEXT PRIMARY KEY,
  portrait_id TEXT NOT NULL REFERENCES pattern_portraits(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  job_id TEXT REFERENCES pattern_portrait_jobs(id),
  role TEXT NOT NULL CHECK (role IN ('image','sample','graph')),
  object_key TEXT NOT NULL UNIQUE CHECK (object_key LIKE 'pattern-portraits/%'),
  plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 3145728),
  created_at TEXT NOT NULL,
  cleanup_at TEXT,
  deleted_at TEXT
);
CREATE INDEX pattern_portrait_assets_cleanup ON pattern_portrait_assets(cleanup_at, id);
CREATE INDEX pattern_portrait_assets_user ON pattern_portrait_assets(user_id);

-- Every existing Pattern erasure path (including source replacement and signed
-- replay) deletes the accepted document. Invalidation commits with that delete.
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
-- Revocation cancels unfinished work, consistently retaining an accepted portrait.
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
