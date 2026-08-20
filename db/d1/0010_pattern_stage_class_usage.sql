-- M7 provider ledgers: record calls by the stage class that spent them.
--
-- `used_calls` remains each ledger's shared total and ceiling quantity. These
-- additive non-negative counters provide the attribution section 25.3 requires
-- without introducing per-stage sub-ceilings or user identity.

PRAGMA foreign_keys = ON;

ALTER TABLE pattern_provider_daily_usage
  ADD COLUMN planner_calls INTEGER NOT NULL DEFAULT 0 CHECK (planner_calls >= 0);
ALTER TABLE pattern_provider_daily_usage
  ADD COLUMN writer_calls INTEGER NOT NULL DEFAULT 0 CHECK (writer_calls >= 0);
ALTER TABLE pattern_provider_daily_usage
  ADD COLUMN verifier_calls INTEGER NOT NULL DEFAULT 0 CHECK (verifier_calls >= 0);

ALTER TABLE pattern_ontology_provider_daily_usage
  ADD COLUMN generator_calls INTEGER NOT NULL DEFAULT 0 CHECK (generator_calls >= 0);
ALTER TABLE pattern_ontology_provider_daily_usage
  ADD COLUMN evaluator_calls INTEGER NOT NULL DEFAULT 0 CHECK (evaluator_calls >= 0);
ALTER TABLE pattern_ontology_provider_daily_usage
  ADD COLUMN regression_calls INTEGER NOT NULL DEFAULT 0 CHECK (regression_calls >= 0);
