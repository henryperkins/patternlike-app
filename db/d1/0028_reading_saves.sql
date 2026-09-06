-- Portable, revision-specific reading Save state.
--
-- This relation stores only the reader's intent and the first time it was
-- saved. The reading artifact remains in daily_readings.reading_enc.
CREATE TABLE reading_saves (
  user_id TEXT NOT NULL REFERENCES users(id),
  reading_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (user_id, reading_id),
  FOREIGN KEY (reading_id, user_id)
    REFERENCES daily_readings(id, user_id)
);

CREATE INDEX idx_reading_saves_user_saved
  ON reading_saves(user_id, saved_at DESC, reading_id DESC);
