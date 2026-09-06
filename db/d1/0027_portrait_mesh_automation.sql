-- Additive: never expands existing Pattern consent or rewrites accepted artifacts.
CREATE TABLE portrait_automation_grants (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), chart_id TEXT NOT NULL,
  chart_fingerprint_hash TEXT NOT NULL, policy_version TEXT NOT NULL CHECK(policy_version='1.1.0'),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX portrait_automation_active ON portrait_automation_grants(user_id,chart_id) WHERE enabled=1;
CREATE INDEX portrait_automation_owner ON portrait_automation_grants(user_id,chart_id,created_at);
CREATE TABLE portrait_start_outbox (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), pattern_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL REFERENCES portrait_automation_grants(id), chart_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','cancelled','unsupported')),
  checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z', created_at TEXT NOT NULL
);
CREATE INDEX portrait_start_dispatch ON portrait_start_outbox(status,checked_at);
CREATE TABLE portrait_mesh_jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), portrait_id TEXT NOT NULL REFERENCES pattern_portraits(id),
  grant_id TEXT NOT NULL REFERENCES portrait_automation_grants(id), image_asset_id TEXT NOT NULL,
  processing_consent_id TEXT NOT NULL, pattern_consent_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL CHECK(chapter_index BETWEEN 0 AND 3), source_text_sha256 TEXT NOT NULL,
  source_image_sha256 TEXT NOT NULL, document_revision TEXT NOT NULL, compiler_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','complete','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_hash TEXT, lease_expires_at TEXT,
  retry_at TEXT NOT NULL, failure_code TEXT, completion_hash TEXT, model_asset_id TEXT, provenance_asset_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(portrait_id,chapter_index,compiler_version),
  CHECK(status!='running' OR (lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(status!='complete' OR (model_asset_id IS NOT NULL AND provenance_asset_id IS NOT NULL AND completion_hash IS NOT NULL))
);
CREATE INDEX portrait_mesh_dispatch ON portrait_mesh_jobs(status,retry_at,lease_expires_at);
CREATE TABLE portrait_mesh_assets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), portrait_id TEXT NOT NULL REFERENCES pattern_portraits(id),
  job_id TEXT NOT NULL REFERENCES portrait_mesh_jobs(id), role TEXT NOT NULL CHECK(role IN ('model','provenance')),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key LIKE 'portrait-meshes/%'), plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=750000), created_at TEXT NOT NULL,
  cleanup_at TEXT, deleted_at TEXT
);
CREATE INDEX portrait_mesh_cleanup ON portrait_mesh_assets(cleanup_at,deleted_at);
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
