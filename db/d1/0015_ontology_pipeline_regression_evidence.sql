-- M7 ontology pipeline: fail-closed regression evidence receipt pins.
--
-- Existing committed 0011 receipts intentionally remain all-NULL: there is no
-- trustworthy backfill for evidence that was not recorded. The application
-- rejects those legacy receipts for machine activation, while the original
-- committed-row immutability trigger continues to prohibit mutation.

PRAGMA foreign_keys = ON;

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_report_hash TEXT
  CHECK (
    regression_report_hash IS NULL
    OR (
      length(regression_report_hash) = 71
      AND substr(regression_report_hash, 1, 7) = 'sha256:'
      AND substr(regression_report_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_artifact_object_key TEXT
  CHECK (
    regression_artifact_object_key IS NULL
    OR length(regression_artifact_object_key) BETWEEN 1 AND 1024
  );

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_artifact_envelope_hash TEXT
  CHECK (
    regression_artifact_envelope_hash IS NULL
    OR (
      length(regression_artifact_envelope_hash) = 71
      AND substr(regression_artifact_envelope_hash, 1, 7) = 'sha256:'
      AND substr(regression_artifact_envelope_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_artifact_ciphertext_hash TEXT
  CHECK (
    regression_artifact_ciphertext_hash IS NULL
    OR (
      length(regression_artifact_ciphertext_hash) = 71
      AND substr(regression_artifact_ciphertext_hash, 1, 7) = 'sha256:'
      AND substr(regression_artifact_ciphertext_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_artifact_stage_generation INTEGER
  CHECK (
    regression_artifact_stage_generation IS NULL
    OR regression_artifact_stage_generation > 0
  );

ALTER TABLE pattern_ontology_pipeline_evidence
ADD COLUMN regression_artifact_stage_attempt INTEGER
  CHECK (
    regression_artifact_stage_attempt IS NULL
    OR regression_artifact_stage_attempt >= 0
  );

CREATE UNIQUE INDEX uq_pattern_ontology_evidence_regression_object
  ON pattern_ontology_pipeline_evidence(regression_artifact_object_key)
  WHERE regression_artifact_object_key IS NOT NULL;

CREATE TRIGGER pattern_ontology_pipeline_regression_evidence_insert_shape
BEFORE INSERT ON pattern_ontology_pipeline_evidence
FOR EACH ROW
WHEN NOT (
  (
    NEW.regression_report_hash IS NULL
    AND NEW.regression_artifact_object_key IS NULL
    AND NEW.regression_artifact_envelope_hash IS NULL
    AND NEW.regression_artifact_ciphertext_hash IS NULL
    AND NEW.regression_artifact_stage_generation IS NULL
    AND NEW.regression_artifact_stage_attempt IS NULL
  )
  OR (
    NEW.regression_report_hash IS NOT NULL
    AND NEW.regression_artifact_object_key IS NOT NULL
    AND NEW.regression_artifact_envelope_hash IS NOT NULL
    AND NEW.regression_artifact_ciphertext_hash IS NOT NULL
    AND NEW.regression_artifact_stage_generation IS NOT NULL
    AND NEW.regression_artifact_stage_attempt IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ontology regression evidence tuple must be complete');
END;

CREATE TRIGGER pattern_ontology_pipeline_evidence_no_delete
BEFORE DELETE ON pattern_ontology_pipeline_evidence
FOR EACH ROW
WHEN OLD.evidence_status = 'committed'
BEGIN
  SELECT RAISE(ABORT, 'committed ontology pipeline evidence cannot be deleted');
END;

CREATE TRIGGER pattern_ontology_pipeline_regression_evidence_update_shape
BEFORE UPDATE ON pattern_ontology_pipeline_evidence
FOR EACH ROW
WHEN NOT (
  (
    NEW.regression_report_hash IS NULL
    AND NEW.regression_artifact_object_key IS NULL
    AND NEW.regression_artifact_envelope_hash IS NULL
    AND NEW.regression_artifact_ciphertext_hash IS NULL
    AND NEW.regression_artifact_stage_generation IS NULL
    AND NEW.regression_artifact_stage_attempt IS NULL
  )
  OR (
    NEW.regression_report_hash IS NOT NULL
    AND NEW.regression_artifact_object_key IS NOT NULL
    AND NEW.regression_artifact_envelope_hash IS NOT NULL
    AND NEW.regression_artifact_ciphertext_hash IS NOT NULL
    AND NEW.regression_artifact_stage_generation IS NOT NULL
    AND NEW.regression_artifact_stage_attempt IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ontology regression evidence tuple must be complete');
END;
