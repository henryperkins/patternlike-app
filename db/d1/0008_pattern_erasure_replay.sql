-- M7 disaster-recovery replay ledger. Forward-only. Not a crypto break.
-- D1 is the live write-ahead. The restore source is the R2 replica
-- pattern-erasure-replay/, which is outside D1 Time Travel.
-- No user_id column and no FK to users: account deletion writes an event
-- and must not delete ledger rows.

CREATE TABLE pattern_erasure_replay_events (
  event_id TEXT PRIMARY KEY NOT NULL
    CHECK (event_id GLOB 'prel_*' AND length(event_id) = 37),
  event_class TEXT NOT NULL
    CHECK (event_class IN (
      'claim_consumed',
      'pattern_deleted',
      'chart_correction_erased',
      'pattern_withdrawn',
      'ontology_recalled',
      'account_deleted'
    )),
  occurred_at TEXT NOT NULL,
  target_user_id TEXT,
  chart_fingerprint_hash TEXT,
  claim_id TEXT,
  generation_id TEXT,
  pattern_id TEXT,
  ontology_version TEXT,
  prior_claim_status TEXT,
  next_claim_status TEXT,
  content_hash TEXT NOT NULL
    CHECK (content_hash GLOB 'sha256:*' AND length(content_hash) = 71),
  signature TEXT NOT NULL,
  replica_put_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (
      event_class = 'ontology_recalled'
      AND next_claim_status IS NULL
    )
    OR (
      event_class != 'ontology_recalled'
      AND next_claim_status IN ('accepted', 'deleted', 'superseded', 'withdrawn')
    )
  )
);

CREATE INDEX idx_pattern_erasure_replay_occurred
  ON pattern_erasure_replay_events(occurred_at, event_id);

CREATE INDEX idx_pattern_erasure_replay_target
  ON pattern_erasure_replay_events(target_user_id, occurred_at)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX idx_pattern_erasure_replay_replica
  ON pattern_erasure_replay_events(event_id)
  WHERE replica_put_at IS NULL;
