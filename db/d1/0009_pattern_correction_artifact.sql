-- M7 Pattern adapter: admit the closed writer correction document artifact.
--
-- 0007 is applied and immutable. Rebuild only the R2 inventory table, copying
-- every column explicitly while foreign-key enforcement remains live. The
-- migration runs as one D1 transaction, so either the complete inventory and
-- both indexes survive or the pre-migration table remains untouched.

PRAGMA foreign_keys = ON;

CREATE TABLE pattern_generation_artifacts_m7_correction (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  artifact_class TEXT NOT NULL
    CHECK (artifact_class IN (
      'fact_packet', 'planner_request', 'planner_response', 'validated_plan',
      'writer_request', 'writer_response', 'rejected_candidate',
      'candidate_validation', 'correction_document',
      'verifier_request', 'verifier_response',
      'semantic_verdict', 'accepted_internal_document'
    )),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL,
  plaintext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO pattern_generation_artifacts_m7_correction (
  id, generation_id, user_id, artifact_class, object_key,
  ciphertext_sha256, plaintext_sha256, byte_length,
  created_at, expires_at, deleted_at
)
SELECT
  id, generation_id, user_id, artifact_class, object_key,
  ciphertext_sha256, plaintext_sha256, byte_length,
  created_at, expires_at, deleted_at
FROM pattern_generation_artifacts;

DROP TABLE pattern_generation_artifacts;
ALTER TABLE pattern_generation_artifacts_m7_correction
  RENAME TO pattern_generation_artifacts;

CREATE INDEX idx_pattern_artifacts_generation
  ON pattern_generation_artifacts(generation_id, artifact_class, id);
CREATE INDEX idx_pattern_artifacts_expiry
  ON pattern_generation_artifacts(expires_at, id)
  WHERE deleted_at IS NULL;
