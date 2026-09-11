-- Forward-only runtime-health/v1 instrumentation. Apply before compatible writes.
-- Historical asset completions remain NULL; updated_at is not completion proof.
ALTER TABLE pattern_portrait_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE portrait_mesh_jobs ADD COLUMN completed_at TEXT;

CREATE TABLE runtime_health_capture (
  work_class TEXT PRIMARY KEY CHECK(work_class IN ('text','portrait','mesh')),
  started_at TEXT NOT NULL CHECK(julianday(started_at) IS NOT NULL)
);
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
CREATE TRIGGER runtime_health_text_capture AFTER UPDATE OF status ON codex_provider_jobs
WHEN NEW.status='completed' AND OLD.status!='completed' AND NEW.completed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO runtime_health_capture VALUES('text',NEW.completed_at);
END;

CREATE INDEX idx_runtime_text_state_time ON codex_provider_jobs(status,julianday(completed_at));
CREATE INDEX idx_runtime_portrait_state_time ON pattern_portrait_jobs(status,julianday(completed_at));
CREATE INDEX idx_runtime_mesh_state_time ON portrait_mesh_jobs(status,julianday(completed_at));
CREATE INDEX idx_runtime_publication_failure ON pattern_generation_jobs(stage,failure_class);

-- Restricted administrator audit, separate from scoped artifact access.
CREATE TABLE runtime_health_access_events (
  id TEXT PRIMARY KEY NOT NULL,
  admin_subject TEXT NOT NULL CHECK(length(admin_subject) BETWEEN 1 AND 200),
  purpose_class TEXT NOT NULL CHECK(purpose_class='incident_response'),
  result TEXT NOT NULL CHECK(result IN ('granted','denied','unavailable')),
  created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at)>julianday(created_at))
);
CREATE INDEX idx_runtime_health_access_expiry ON runtime_health_access_events(expires_at,id);
