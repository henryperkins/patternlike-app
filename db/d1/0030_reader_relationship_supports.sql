-- Private support for exact accepted passages. No backfill of older readings.
-- Deleting a document (including Pattern replacement or restore replay) erases
-- its support in the same transaction. Coordinates and evidence stay encrypted.
CREATE UNIQUE INDEX idx_pattern_documents_id_owner
  ON pattern_documents(id, user_id);

CREATE TABLE reader_relationship_supports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  document_kind TEXT NOT NULL CHECK (document_kind IN ('daily', 'pattern')),
  document_id TEXT NOT NULL,
  reading_id TEXT,
  pattern_id TEXT,
  support_enc BLOB NOT NULL,
  support_key_version INTEGER NOT NULL,
  support_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (document_kind, document_id),
  CHECK ((document_kind = 'daily' AND reading_id IS NOT NULL AND reading_id = document_id AND pattern_id IS NULL)
      OR (document_kind = 'pattern' AND pattern_id IS NOT NULL AND pattern_id = document_id AND reading_id IS NULL)),
  FOREIGN KEY (reading_id, user_id) REFERENCES daily_readings(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (pattern_id, user_id) REFERENCES pattern_documents(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_reader_relationship_supports_owner
  ON reader_relationship_supports(user_id, document_kind, document_id);
