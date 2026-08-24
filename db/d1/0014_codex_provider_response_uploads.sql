-- Lease-fenced response upload inventory for Codex provider jobs.
-- A row is committed before its create-only R2 object, so stale uploads remain
-- discoverable by maintenance and account deletion even if terminal D1 CAS loses.

PRAGMA foreign_keys = ON;

CREATE TABLE codex_provider_response_uploads (
  job_id TEXT NOT NULL
    REFERENCES codex_provider_jobs(id) ON DELETE CASCADE,
  lease_token_hash TEXT NOT NULL CHECK (
    length(lease_token_hash) = 71
    AND substr(lease_token_hash, 1, 7) = 'sha256:'
    AND substr(lease_token_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  object_key TEXT NOT NULL UNIQUE CHECK (
    length(object_key) BETWEEN 1 AND 1024
    AND substr(object_key, 1, 20) = 'codex-provider-jobs/'
  ),
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  PRIMARY KEY (job_id, lease_token_hash)
);

CREATE INDEX idx_codex_provider_response_uploads_created
  ON codex_provider_response_uploads(created_at, job_id);
