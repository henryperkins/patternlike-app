-- M7 automated ontology pipeline durable control plane. Forward-only.
--
-- D1 carries immutable identities, frozen pins, closed state, counts, hashes,
-- and R2 pointers only. Corpus prose, provider payloads, generated records,
-- evaluator rationales, report bodies, user identifiers, and plaintext key
-- material do not belong in these tables.
--
-- This migration is additive. It deliberately does not rebuild or reinterpret
-- the byte-frozen 0011 terminal evidence receipt; a terminal transition may
-- copy the pinned values from these tables into that receipt in one later batch.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Immutable, verified source-corpus release inventory
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_source_corpus_releases (
  corpus_release_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(corpus_release_id) BETWEEN 1 AND 200),
  corpus_hash TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 35),
  object_key TEXT NOT NULL UNIQUE
    CHECK (length(object_key) BETWEEN 1 AND 1024),
  fragment_count INTEGER NOT NULL CHECK (fragment_count > 0),
  license_class TEXT NOT NULL
    CHECK (license_class IN ('licensed_excerpt', 'internal_synthetic')),
  public_capable INTEGER NOT NULL CHECK (public_capable IN (0, 1)),
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  registered_at TEXT NOT NULL CHECK (unixepoch(registered_at) IS NOT NULL),
  UNIQUE (corpus_release_id, corpus_hash),
  UNIQUE (corpus_hash),
  CHECK (
    length(corpus_hash) = 71
    AND substr(corpus_hash, 1, 7) = 'sha256:'
    AND substr(corpus_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    (license_class = 'licensed_excerpt' AND public_capable = 1)
    OR
    (license_class = 'internal_synthetic' AND public_capable = 0)
  ),
  CHECK (unixepoch(registered_at) >= unixepoch(created_at))
);

CREATE TRIGGER pattern_source_corpus_releases_identity_immutable
BEFORE UPDATE ON pattern_source_corpus_releases
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'registered ontology source corpus is immutable');
END;

-- SQLite REPLACE may remove a conflicting row without invoking DELETE
-- triggers, so reject every occupied corpus identity before conflict handling.
CREATE TRIGGER pattern_source_corpus_releases_no_reuse
BEFORE INSERT ON pattern_source_corpus_releases
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pattern_source_corpus_releases corpus
  WHERE corpus.corpus_release_id = NEW.corpus_release_id
    OR corpus.corpus_hash = NEW.corpus_hash
    OR corpus.object_key = NEW.object_key
)
BEGIN
  SELECT RAISE(ABORT, 'registered ontology source corpus identity cannot be reused');
END;

CREATE TRIGGER pattern_source_corpus_releases_no_delete
BEFORE DELETE ON pattern_source_corpus_releases
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'registered ontology source corpus cannot be deleted');
END;

-- ---------------------------------------------------------------------------
-- Durable stage machine, CAS lease, and Queue outbox
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_ontology_pipeline_runs (
  run_id TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  corpus_release_id TEXT NOT NULL,
  corpus_hash TEXT NOT NULL,
  candidate_ontology_version TEXT NOT NULL UNIQUE
    CHECK (length(candidate_ontology_version) BETWEEN 1 AND 200),
  configuration_json TEXT NOT NULL
    CHECK (json_valid(configuration_json) AND json_type(configuration_json) = 'object'),
  configuration_hash TEXT NOT NULL,
  stage TEXT NOT NULL
    CHECK (stage IN (
      'reserved', 'corpus_reading', 'generating', 'compiling', 'evaluating',
      'regressing', 'signing', 'ingesting', 'succeeded', 'failed'
    )),
  stage_generation INTEGER NOT NULL DEFAULT 0 CHECK (stage_generation >= 0),
  stage_cursor INTEGER NOT NULL DEFAULT 0 CHECK (stage_cursor >= 0),
  stage_attempt INTEGER NOT NULL DEFAULT 0 CHECK (stage_attempt >= 0),
  claim_token TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL CHECK (unixepoch(available_at) IS NOT NULL),
  dispatched_at TEXT,
  failure_class TEXT
    CHECK (
      failure_class IS NULL
      OR failure_class IN (
        'corpus_unavailable', 'corpus_invalid', 'corpus_hash_mismatch',
        'configuration_invalid', 'provider_not_configured',
        'provider_budget_exhausted', 'provider_refusal', 'provider_timeout',
        'provider_unavailable', 'provider_response_invalid',
        'artifact_conflict', 'artifact_unavailable',
        'artifact_integrity_failed', 'candidate_invalid',
        'compilation_failed', 'evaluation_rejected', 'regression_failed',
        'regression_budget_exceeded', 'signing_failed', 'ingestion_failed',
        'attempts_exhausted', 'execution_error'
      )
    ),
  candidate_hash TEXT,
  compilation_report_hash TEXT,
  evaluation_report_hash TEXT,
  regression_report_hash TEXT,
  bundle_hash TEXT,
  failed_artifact_expires_at TEXT,
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (unixepoch(updated_at) IS NOT NULL),
  finished_at TEXT,
  succeeded_at TEXT,
  failed_at TEXT,
  FOREIGN KEY (corpus_release_id, corpus_hash)
    REFERENCES pattern_source_corpus_releases(corpus_release_id, corpus_hash),
  CHECK (
    length(corpus_hash) = 71
    AND substr(corpus_hash, 1, 7) = 'sha256:'
    AND substr(corpus_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(configuration_hash) = 71
    AND substr(configuration_hash, 1, 7) = 'sha256:'
    AND substr(configuration_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    candidate_hash IS NULL
    OR (
      length(candidate_hash) = 71
      AND substr(candidate_hash, 1, 7) = 'sha256:'
      AND substr(candidate_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    compilation_report_hash IS NULL
    OR (
      length(compilation_report_hash) = 71
      AND substr(compilation_report_hash, 1, 7) = 'sha256:'
      AND substr(compilation_report_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    evaluation_report_hash IS NULL
    OR (
      length(evaluation_report_hash) = 71
      AND substr(evaluation_report_hash, 1, 7) = 'sha256:'
      AND substr(evaluation_report_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    regression_report_hash IS NULL
    OR (
      length(regression_report_hash) = 71
      AND substr(regression_report_hash, 1, 7) = 'sha256:'
      AND substr(regression_report_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    bundle_hash IS NULL
    OR (
      length(bundle_hash) = 71
      AND substr(bundle_hash, 1, 7) = 'sha256:'
      AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (unixepoch(updated_at) >= unixepoch(created_at)),
  CHECK (
    (claim_token IS NULL AND lease_expires_at IS NULL)
    OR (
      claim_token IS NOT NULL
      AND length(claim_token) BETWEEN 1 AND 256
      AND lease_expires_at IS NOT NULL
      AND unixepoch(lease_expires_at) IS NOT NULL
      AND unixepoch(lease_expires_at) > unixepoch(updated_at)
      AND dispatched_at IS NOT NULL
      AND stage NOT IN ('succeeded', 'failed')
    )
  ),
  CHECK (dispatched_at IS NULL OR unixepoch(dispatched_at) IS NOT NULL),
  CHECK (
    stage NOT IN ('compiling', 'evaluating', 'regressing', 'signing', 'ingesting', 'succeeded')
    OR candidate_hash IS NOT NULL
  ),
  CHECK (
    stage NOT IN ('evaluating', 'regressing', 'signing', 'ingesting', 'succeeded')
    OR compilation_report_hash IS NOT NULL
  ),
  CHECK (
    stage NOT IN ('regressing', 'signing', 'ingesting', 'succeeded')
    OR evaluation_report_hash IS NOT NULL
  ),
  CHECK (
    stage NOT IN ('signing', 'ingesting', 'succeeded')
    OR regression_report_hash IS NOT NULL
  ),
  CHECK (
    stage NOT IN ('ingesting', 'succeeded')
    OR bundle_hash IS NOT NULL
  ),
  CHECK (
    (
      stage = 'succeeded'
      AND failure_class IS NULL
      AND claim_token IS NULL
      AND lease_expires_at IS NULL
      AND failed_artifact_expires_at IS NULL
      AND finished_at IS NOT NULL
      AND succeeded_at IS NOT NULL
      AND failed_at IS NULL
      AND dispatched_at IS NOT NULL
      AND unixepoch(finished_at) IS NOT NULL
      AND unixepoch(succeeded_at) IS NOT NULL
      AND finished_at = succeeded_at
      AND unixepoch(finished_at) >= unixepoch(created_at)
    )
    OR (
      stage = 'failed'
      AND failure_class IS NOT NULL
      AND claim_token IS NULL
      AND lease_expires_at IS NULL
      AND failed_artifact_expires_at IS NOT NULL
      AND finished_at IS NOT NULL
      AND succeeded_at IS NULL
      AND failed_at IS NOT NULL
      AND dispatched_at IS NOT NULL
      AND unixepoch(finished_at) IS NOT NULL
      AND unixepoch(failed_at) IS NOT NULL
      AND unixepoch(failed_artifact_expires_at) IS NOT NULL
      AND finished_at = failed_at
      AND unixepoch(finished_at) >= unixepoch(created_at)
      AND unixepoch(failed_artifact_expires_at) - unixepoch(failed_at) = 604800
    )
    OR (
      stage NOT IN ('succeeded', 'failed')
      AND failure_class IS NULL
      AND failed_artifact_expires_at IS NULL
      AND finished_at IS NULL
      AND succeeded_at IS NULL
      AND failed_at IS NULL
    )
  )
);

CREATE INDEX idx_pattern_ontology_runs_corpus
  ON pattern_ontology_pipeline_runs(corpus_release_id, corpus_hash, created_at);

CREATE INDEX idx_pattern_ontology_runs_undispatched
  ON pattern_ontology_pipeline_runs(available_at, run_id)
  WHERE stage NOT IN ('succeeded', 'failed')
    AND dispatched_at IS NULL
    AND claim_token IS NULL;

CREATE INDEX idx_pattern_ontology_runs_expired_lease
  ON pattern_ontology_pipeline_runs(lease_expires_at, run_id)
  WHERE stage NOT IN ('succeeded', 'failed')
    AND claim_token IS NOT NULL;

-- Reservation is the only creation boundary. Every later state must be reached
-- through the guarded transition machine below, including terminal states.
CREATE TRIGGER pattern_ontology_pipeline_runs_initial_state
BEFORE INSERT ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN NOT (
  NEW.stage = 'reserved'
  AND NEW.stage_generation = 0
  AND NEW.stage_cursor = 0
  AND NEW.stage_attempt = 0
  AND NEW.claim_token IS NULL
  AND NEW.lease_expires_at IS NULL
  AND NEW.dispatched_at IS NULL
  AND NEW.failure_class IS NULL
  AND NEW.candidate_hash IS NULL
  AND NEW.compilation_report_hash IS NULL
  AND NEW.evaluation_report_hash IS NULL
  AND NEW.regression_report_hash IS NULL
  AND NEW.bundle_hash IS NULL
  AND NEW.failed_artifact_expires_at IS NULL
  AND NEW.finished_at IS NULL
  AND NEW.succeeded_at IS NULL
  AND NEW.failed_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'new ontology pipeline run must start reserved');
END;

CREATE TRIGGER pattern_ontology_pipeline_runs_no_reuse
BEFORE INSERT ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pattern_ontology_pipeline_runs run
  WHERE run.run_id = NEW.run_id
    OR run.idempotency_key = NEW.idempotency_key
    OR run.candidate_ontology_version = NEW.candidate_ontology_version
)
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline command identity cannot be reused');
END;

-- Frozen reservation inputs never change once inserted. Operational fields are
-- updated by the stage CAS, so immutability is enforced on the exact pin set.
CREATE TRIGGER pattern_ontology_pipeline_runs_command_immutable
BEFORE UPDATE ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN
  OLD.run_id IS NOT NEW.run_id
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.corpus_release_id IS NOT NEW.corpus_release_id
  OR OLD.corpus_hash IS NOT NEW.corpus_hash
  OR OLD.candidate_ontology_version IS NOT NEW.candidate_ontology_version
  OR OLD.configuration_json IS NOT NEW.configuration_json
  OR OLD.configuration_hash IS NOT NEW.configuration_hash
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline command pins are immutable');
END;

-- Each evidence hash is write-once. A stage may publish its hash while it owns
-- the row, but no retry or later stage can replace or clear accepted evidence.
CREATE TRIGGER pattern_ontology_pipeline_runs_evidence_immutable
BEFORE UPDATE ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN
  (OLD.candidate_hash IS NOT NULL AND OLD.candidate_hash IS NOT NEW.candidate_hash)
  OR (
    OLD.compilation_report_hash IS NOT NULL
    AND OLD.compilation_report_hash IS NOT NEW.compilation_report_hash
  )
  OR (
    OLD.evaluation_report_hash IS NOT NULL
    AND OLD.evaluation_report_hash IS NOT NEW.evaluation_report_hash
  )
  OR (
    OLD.regression_report_hash IS NOT NULL
    AND OLD.regression_report_hash IS NOT NEW.regression_report_hash
  )
  OR (OLD.bundle_hash IS NOT NULL AND OLD.bundle_hash IS NOT NEW.bundle_hash)
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline evidence hashes are immutable');
END;

-- Stage changes are monotonic and advance the generation exactly once. A true
-- retry stays at the same stage generation and advances stage_attempt instead.
CREATE TRIGGER pattern_ontology_pipeline_runs_stage_sequence
BEFORE UPDATE ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN NOT (
  (
    OLD.stage = NEW.stage
    AND OLD.stage_generation = NEW.stage_generation
    AND NEW.stage_cursor = OLD.stage_cursor
    AND (
      -- Outbox scheduling or metadata work while nobody owns the delivery.
      (
        OLD.claim_token IS NULL
        AND OLD.lease_expires_at IS NULL
        AND NEW.claim_token IS NULL
        AND NEW.lease_expires_at IS NULL
        AND NEW.stage_attempt = OLD.stage_attempt
      )
      -- A delivery may acquire one unowned row. It preserves an existing
      -- dispatch receipt or atomically fills a still-null outbox receipt.
      OR (
        OLD.claim_token IS NULL
        AND OLD.lease_expires_at IS NULL
        AND NEW.claim_token IS NOT NULL
        AND NEW.lease_expires_at IS NOT NULL
        AND NEW.stage_attempt = OLD.stage_attempt
        AND NEW.dispatched_at IS NOT NULL
        AND (
          OLD.dispatched_at IS NULL
          OR NEW.dispatched_at IS OLD.dispatched_at
        )
        AND NEW.available_at IS OLD.available_at
      )
      -- Work under a live claim cannot replace or renew its ownership tuple.
      OR (
        OLD.claim_token IS NOT NULL
        AND NEW.claim_token IS OLD.claim_token
        AND NEW.lease_expires_at IS OLD.lease_expires_at
        AND NEW.stage_attempt = OLD.stage_attempt
        AND NEW.dispatched_at IS OLD.dispatched_at
        AND NEW.available_at IS OLD.available_at
      )
      -- Owned retry (k+1) and expired-lease recovery (same k) both return the
      -- row to the undispatched lane before another delivery can claim it.
      OR (
        OLD.claim_token IS NOT NULL
        AND OLD.lease_expires_at IS NOT NULL
        AND NEW.claim_token IS NULL
        AND NEW.lease_expires_at IS NULL
        AND NEW.stage_attempt IN (OLD.stage_attempt, OLD.stage_attempt + 1)
        AND NEW.dispatched_at IS NULL
      )
    )
  )
  OR (
    OLD.stage = NEW.stage
    AND OLD.stage IN ('generating', 'evaluating', 'regressing')
    AND NEW.stage_generation = OLD.stage_generation + 1
    AND NEW.stage_cursor = OLD.stage_cursor + 1
    AND NEW.stage_attempt = 0
    AND NEW.claim_token IS NULL
    AND NEW.lease_expires_at IS NULL
    AND NEW.dispatched_at IS NULL
  )
  OR (
    NEW.stage_generation = OLD.stage_generation + 1
    AND (
      (
        (
          (OLD.stage = 'reserved' AND NEW.stage = 'corpus_reading')
          OR (OLD.stage = 'corpus_reading' AND NEW.stage = 'generating')
          OR (OLD.stage = 'generating' AND NEW.stage = 'compiling')
          OR (OLD.stage = 'compiling' AND NEW.stage = 'evaluating')
          OR (OLD.stage = 'evaluating' AND NEW.stage = 'regressing')
          OR (OLD.stage = 'regressing' AND NEW.stage = 'signing')
          OR (OLD.stage = 'signing' AND NEW.stage = 'ingesting')
        )
        AND NEW.stage_cursor = 0
        AND NEW.stage_attempt = 0
        AND NEW.claim_token IS NULL
        AND NEW.lease_expires_at IS NULL
        AND NEW.dispatched_at IS NULL
      )
      OR (OLD.stage = 'ingesting' AND NEW.stage = 'succeeded')
      OR (
        OLD.stage NOT IN ('succeeded', 'failed')
        AND NEW.stage = 'failed'
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid ontology pipeline stage transition');
END;

CREATE TRIGGER pattern_ontology_pipeline_runs_terminal_immutable
BEFORE UPDATE ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN OLD.stage IN ('succeeded', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'terminal ontology pipeline run is immutable');
END;

CREATE TRIGGER pattern_ontology_pipeline_runs_no_delete
BEFORE DELETE ON pattern_ontology_pipeline_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline run cannot be deleted');
END;

-- ---------------------------------------------------------------------------
-- Attempt-scoped create-only encrypted R2 artifact inventory
-- ---------------------------------------------------------------------------

CREATE TABLE pattern_ontology_pipeline_artifacts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  run_id TEXT NOT NULL REFERENCES pattern_ontology_pipeline_runs(run_id),
  stage TEXT NOT NULL
    CHECK (stage IN (
      'generating', 'compiling', 'evaluating', 'regressing', 'signing', 'ingesting'
    )),
  stage_generation INTEGER NOT NULL CHECK (stage_generation > 0),
  stage_attempt INTEGER NOT NULL CHECK (stage_attempt >= 0),
  artifact_class TEXT NOT NULL
    CHECK (artifact_class IN (
      'generator_request', 'generator_response', 'candidate_chunk',
      'candidate_release', 'compilation_report',
      'evaluator_request', 'evaluator_response', 'evaluator_verdict',
      'evaluation_report', 'regression_request', 'regression_response',
      'regression_result', 'regression_report', 'unsigned_bundle',
      'signed_bundle', 'ingestion_receipt'
    )),
  object_key TEXT NOT NULL UNIQUE
    CHECK (length(object_key) BETWEEN 1 AND 1024),
  plaintext_sha256 TEXT NOT NULL,
  envelope_sha256 TEXT NOT NULL,
  ciphertext_sha256 TEXT NOT NULL,
  envelope_key_id TEXT NOT NULL
    CHECK (length(envelope_key_id) BETWEEN 1 AND 128),
  envelope_nonce TEXT NOT NULL
    CHECK (length(envelope_nonce) BETWEEN 16 AND 128),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  expires_at TEXT
    CHECK (expires_at IS NULL OR unixepoch(expires_at) IS NOT NULL),
  deleted_at TEXT,
  UNIQUE (run_id, stage, stage_generation, stage_attempt, artifact_class),
  UNIQUE (envelope_key_id, envelope_nonce),
  CHECK (
    length(plaintext_sha256) = 71
    AND substr(plaintext_sha256, 1, 7) = 'sha256:'
    AND substr(plaintext_sha256, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(envelope_sha256) = 71
    AND substr(envelope_sha256, 1, 7) = 'sha256:'
    AND substr(envelope_sha256, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(ciphertext_sha256) = 71
    AND substr(ciphertext_sha256, 1, 7) = 'sha256:'
    AND substr(ciphertext_sha256, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    expires_at IS NULL
    OR unixepoch(expires_at) > unixepoch(created_at)
  ),
  CHECK (
    deleted_at IS NULL
    OR (
      unixepoch(deleted_at) IS NOT NULL
      AND unixepoch(deleted_at) >= unixepoch(created_at)
    )
  ),
  CHECK (
    (stage = 'generating' AND artifact_class IN (
      'generator_request', 'generator_response', 'candidate_chunk'
    ))
    OR (stage = 'compiling' AND artifact_class IN (
      'candidate_release', 'compilation_report'
    ))
    OR (stage = 'evaluating' AND artifact_class IN (
      'evaluator_request', 'evaluator_response', 'evaluator_verdict',
      'evaluation_report'
    ))
    OR (stage = 'regressing' AND artifact_class IN (
      'regression_request', 'regression_response', 'regression_result',
      'regression_report'
    ))
    OR (stage = 'signing' AND artifact_class IN (
      'unsigned_bundle', 'signed_bundle'
    ))
    OR (stage = 'ingesting' AND artifact_class = 'ingestion_receipt')
  )
);

CREATE INDEX idx_pattern_ontology_artifacts_run
  ON pattern_ontology_pipeline_artifacts(
    run_id, stage_generation, stage_attempt, artifact_class
  );

CREATE INDEX idx_pattern_ontology_artifacts_expiry
  ON pattern_ontology_pipeline_artifacts(expires_at, id)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER pattern_ontology_pipeline_artifacts_stage_owner
BEFORE INSERT ON pattern_ontology_pipeline_artifacts
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM pattern_ontology_pipeline_runs run
  WHERE run.run_id = NEW.run_id
    AND run.stage = NEW.stage
    AND run.stage_generation = NEW.stage_generation
    AND run.stage_attempt = NEW.stage_attempt
)
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline artifact stage owner is stale');
END;

CREATE TRIGGER pattern_ontology_pipeline_artifacts_no_reuse
BEFORE INSERT ON pattern_ontology_pipeline_artifacts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM pattern_ontology_pipeline_artifacts artifact
  WHERE artifact.id = NEW.id
    OR artifact.object_key = NEW.object_key
    OR (
      artifact.run_id = NEW.run_id
      AND artifact.stage = NEW.stage
      AND artifact.stage_generation = NEW.stage_generation
      AND artifact.stage_attempt = NEW.stage_attempt
      AND artifact.artifact_class = NEW.artifact_class
    )
    OR (
      artifact.envelope_key_id = NEW.envelope_key_id
      AND artifact.envelope_nonce = NEW.envelope_nonce
    )
)
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline artifact identity cannot be reused');
END;

-- Failure time is unknown at artifact creation. Only the terminal transition
-- below may assign the exact seven-day deadline; successful evidence has none.
CREATE TRIGGER pattern_ontology_pipeline_artifacts_no_early_expiry
BEFORE INSERT ON pattern_ontology_pipeline_artifacts
FOR EACH ROW
WHEN NEW.expires_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline artifact expiry is terminally assigned');
END;

-- Inventory identity is create-only. The only lifecycle mutations are the
-- first live-to-deleted tombstone and the failed-run deadline assignment.
CREATE TRIGGER pattern_ontology_pipeline_artifacts_create_only
BEFORE UPDATE ON pattern_ontology_pipeline_artifacts
FOR EACH ROW
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.run_id IS NEW.run_id
  AND OLD.stage IS NEW.stage
  AND OLD.stage_generation IS NEW.stage_generation
  AND OLD.stage_attempt IS NEW.stage_attempt
  AND OLD.artifact_class IS NEW.artifact_class
  AND OLD.object_key IS NEW.object_key
  AND OLD.plaintext_sha256 IS NEW.plaintext_sha256
  AND OLD.envelope_sha256 IS NEW.envelope_sha256
  AND OLD.ciphertext_sha256 IS NEW.ciphertext_sha256
  AND OLD.envelope_key_id IS NEW.envelope_key_id
  AND OLD.envelope_nonce IS NEW.envelope_nonce
  AND OLD.byte_length IS NEW.byte_length
  AND OLD.created_at IS NEW.created_at
  AND (
    (
      OLD.deleted_at IS NULL
      AND NEW.deleted_at IS NOT NULL
      AND OLD.expires_at IS NEW.expires_at
    )
    OR (
      OLD.expires_at IS NULL
      AND NEW.expires_at IS NOT NULL
      AND OLD.deleted_at IS NEW.deleted_at
      AND EXISTS (
        SELECT 1
        FROM pattern_ontology_pipeline_runs run
        WHERE run.run_id = OLD.run_id
          AND run.stage = 'failed'
          AND run.failed_artifact_expires_at IS NEW.expires_at
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline artifact identity is create-only');
END;

CREATE TRIGGER pattern_ontology_pipeline_runs_expire_failed_artifacts
AFTER UPDATE OF stage, failed_artifact_expires_at
ON pattern_ontology_pipeline_runs
FOR EACH ROW
WHEN OLD.stage IS NOT NEW.stage AND NEW.stage = 'failed'
BEGIN
  UPDATE pattern_ontology_pipeline_artifacts
  SET expires_at = NEW.failed_artifact_expires_at
  WHERE run_id = NEW.run_id
    AND expires_at IS NULL
    AND deleted_at IS NULL;
END;

CREATE TRIGGER pattern_ontology_pipeline_artifacts_no_delete
BEFORE DELETE ON pattern_ontology_pipeline_artifacts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ontology pipeline artifact tombstone cannot be deleted');
END;
