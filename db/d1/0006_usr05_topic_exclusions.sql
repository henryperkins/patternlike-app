-- USR-05 sensitive-topic exclusions.
--
-- Standing preference, one current encrypted context_signals row per owner.
-- Values stay in the existing context_signals.value_enc column (already on
-- ENCRYPTED_COLUMNS); this migration only adds the uniqueness the writer
-- relies on so two current rows cannot coexist.
--
-- USR-12 reading feedback uses the existing reading_feedback table and does
-- not need a schema change.

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_signals_usr05_revision
  ON context_signals(user_id, source_id, source_revision)
  WHERE source_id = 'USR-05';

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_signals_usr05_current
  ON context_signals(user_id, source_id)
  WHERE source_id = 'USR-05' AND is_current = 1;
