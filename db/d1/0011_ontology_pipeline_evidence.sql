-- M7 automated ontology pipeline: terminal evidence handoff only.
--
-- Tasks 1-7 of the full pipeline are intentionally absent on this branch. This
-- table is the smallest durable receipt Task 9 can verify before activation.
-- It deliberately does NOT claim the future Task 2 table names
-- (pattern_source_corpus_releases, pattern_ontology_pipeline_runs, or
-- pattern_ontology_pipeline_artifacts). Those tables can be added without
-- rebuilding or reinterpreting this receipt. A future terminal transition may
-- copy their pinned columns here in the same batch.
--
-- `run_id`, corpus identity, and artifact identity use the same values that the
-- future tables will own. There is no premature FK to an absent table.

PRAGMA foreign_keys = ON;

CREATE TABLE pattern_ontology_pipeline_evidence (
  run_id TEXT PRIMARY KEY NOT NULL,
  ontology_version TEXT NOT NULL UNIQUE,
  corpus_release_id TEXT NOT NULL CHECK (length(corpus_release_id) BETWEEN 1 AND 200),
  corpus_release_hash TEXT NOT NULL,
  corpus_license_class TEXT NOT NULL
    CHECK (corpus_license_class IN ('licensed_excerpt', 'internal_synthetic')),
  corpus_public_capable INTEGER NOT NULL
    CHECK (corpus_public_capable IN (0, 1)),
  activation_scope TEXT NOT NULL
    CHECK (activation_scope IN ('internal', 'public')),
  bundle_hash TEXT NOT NULL,
  evaluation_report_hash TEXT NOT NULL,
  evaluation_artifact_object_key TEXT NOT NULL UNIQUE,
  evaluation_artifact_ciphertext_hash TEXT NOT NULL,
  evaluation_artifact_status TEXT NOT NULL
    CHECK (evaluation_artifact_status IN ('pending', 'committed')),
  signing_key_id TEXT NOT NULL CHECK (length(signing_key_id) BETWEEN 1 AND 128),
  run_status TEXT NOT NULL CHECK (run_status IN ('succeeded', 'failed')),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('pending', 'committed')),
  compiler_passed INTEGER NOT NULL CHECK (compiler_passed IN (0, 1)),
  evaluator_passed INTEGER NOT NULL CHECK (evaluator_passed IN (0, 1)),
  unevaluated_fixture_count INTEGER NOT NULL CHECK (unevaluated_fixture_count >= 0),
  created_at TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  CHECK (
    (corpus_license_class = 'licensed_excerpt' AND corpus_public_capable = 1)
    OR
    (corpus_license_class = 'internal_synthetic' AND corpus_public_capable = 0)
  )
);

CREATE INDEX idx_pattern_ontology_evidence_activation
  ON pattern_ontology_pipeline_evidence(
    ontology_version, bundle_hash, evidence_status, run_status
  );
