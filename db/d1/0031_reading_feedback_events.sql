-- Additive categorical feedback, separate from the existing resonance records.
-- Request, authored note, receipt, grant binding and derived targets are sealed
-- once in event_enc. The same row owns idempotent replay and retention cleanup.
CREATE TABLE reading_feedback_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  reading_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_enc BLOB NOT NULL,
  event_key_version INTEGER NOT NULL,
  event_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  effect_expires_at TEXT,
  retention_expires_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (reading_id, user_id) REFERENCES daily_readings(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_reading_feedback_events_owner_created
  ON reading_feedback_events(user_id, created_at DESC, id DESC);
CREATE INDEX idx_reading_feedback_events_reading
  ON reading_feedback_events(reading_id, user_id, created_at DESC);
CREATE INDEX idx_reading_feedback_events_retention
  ON reading_feedback_events(retention_expires_at);
