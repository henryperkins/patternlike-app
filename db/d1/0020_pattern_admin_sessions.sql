-- Short-lived server-side sessions for the Cloudflare Access protected
-- Pattern administrator path. The browser receives only the opaque token;
-- D1 stores its SHA-256 digest and the Access identity/audience it is bound to.

CREATE TABLE pattern_admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (
      length(token_hash) = 71
      AND substr(token_hash, 1, 7) = 'sha256:'
      AND substr(token_hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
  admin_subject TEXT NOT NULL CHECK (length(admin_subject) BETWEEN 1 AND 512),
  role TEXT NOT NULL
    CHECK (role = 'pattern_generation_auditor'),
  audience TEXT NOT NULL CHECK (length(audience) BETWEEN 1 AND 512),
  access_expires_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (expires_at <= access_expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_pattern_admin_sessions_expiry
  ON pattern_admin_sessions(expires_at, id)
  WHERE revoked_at IS NULL;
