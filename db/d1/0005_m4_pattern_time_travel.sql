-- M4 Your Pattern and Time Travel.
--
-- This migration adds only derived caches, an operational spend ledger, and
-- USR-09 uniqueness constraints. Life-event values continue to use the
-- existing encrypted context_signals.value_enc column; no new plaintext
-- personal-data column or encrypted-column rotation registration is needed.

-- M0's single-column primary key assumed a derived feature ID could be global.
-- M4 deliberately derives it from chart fingerprint rather than user identity,
-- so two owners with the same normalized chart must be able to store the same
-- safe feature ID without colliding. Rebuild to scope physical identity to the
-- owner/chart while preserving every pre-M4 row as readable legacy data.
CREATE TABLE natal_features_m4 (
  id TEXT NOT NULL,
  chart_id TEXT NOT NULL REFERENCES chart_snapshots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL
    CHECK (feature_type IN (
      'position', 'aspect', 'pattern', 'angle', 'house_cusp', 'other'
    )),
  body_a TEXT,
  body_b TEXT,
  aspect TEXT,
  feature_json TEXT NOT NULL,
  orb_policy_id TEXT,
  orb_policy_version TEXT,
  created_at TEXT NOT NULL,
  feature_policy_id TEXT,
  feature_policy_version TEXT,
  feature_set_hash TEXT,
  PRIMARY KEY (id, user_id, chart_id)
);

INSERT INTO natal_features_m4 (
  id, chart_id, user_id, feature_type, body_a, body_b, aspect,
  feature_json, orb_policy_id, orb_policy_version, created_at
)
SELECT
  id, chart_id, user_id, feature_type, body_a, body_b, aspect,
  feature_json, orb_policy_id, orb_policy_version, created_at
FROM natal_features;

DROP TABLE natal_features;
ALTER TABLE natal_features_m4 RENAME TO natal_features;

CREATE INDEX idx_natal_features_chart
  ON natal_features(chart_id, feature_type);

CREATE TABLE natal_feature_sets (
  id TEXT NOT NULL,
  chart_id TEXT NOT NULL REFERENCES chart_snapshots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_policy_id TEXT NOT NULL,
  feature_policy_version TEXT NOT NULL,
  feature_set_hash TEXT NOT NULL,
  feature_count INTEGER NOT NULL CHECK (feature_count >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE UNIQUE INDEX uq_natal_feature_sets_policy
  ON natal_feature_sets(chart_id, user_id, feature_policy_id, feature_policy_version);

CREATE INDEX idx_natal_features_feature_set
  ON natal_features(
    user_id, chart_id, feature_policy_id, feature_policy_version, feature_set_hash, id
  );

CREATE TABLE cycle_scan_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chart_id TEXT NOT NULL REFERENCES chart_snapshots(id) ON DELETE CASCADE,
  chart_fingerprint TEXT NOT NULL,
  local_date TEXT NOT NULL,
  scheduling_timezone TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  tzdb_version TEXT NOT NULL,
  local_day_resolution_policy_version TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  cycle_policy_id TEXT NOT NULL,
  cycle_policy_version TEXT NOT NULL,
  orb_policy_id TEXT NOT NULL,
  orb_policy_version TEXT NOT NULL,
  receipt_epoch INTEGER NOT NULL CHECK (receipt_epoch > 0),
  container_version TEXT NOT NULL,
  ephemeris_data_version TEXT NOT NULL,
  semantic_request_hash TEXT NOT NULL,
  semantic_result_hash TEXT NOT NULL,
  raw_response_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (window_from < window_to),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX uq_cycle_scan_receipts_lookup
  ON cycle_scan_receipts(
    user_id, chart_fingerprint, window_from, window_to,
    contract_id, contract_version, cycle_policy_id, cycle_policy_version,
    orb_policy_id, orb_policy_version, tzdb_version,
    local_day_resolution_policy_version, receipt_epoch
  );

CREATE INDEX idx_cycle_scan_receipts_user_prune
  ON cycle_scan_receipts(user_id, receipt_epoch, created_at, id);

CREATE TABLE time_travel_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  utc_date TEXT NOT NULL,
  reserved_scan_count INTEGER NOT NULL DEFAULT 0
    CHECK (reserved_scan_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, utc_date)
);

CREATE UNIQUE INDEX uq_time_travel_daily_usage_user_date
  ON time_travel_daily_usage(user_id, utc_date);

CREATE UNIQUE INDEX uq_context_signals_usr09_revision
  ON context_signals(
    user_id, source_id, COALESCE(source_window, ''), source_revision
  )
  WHERE source_id = 'USR-09';

CREATE UNIQUE INDEX uq_context_signals_usr09_current
  ON context_signals(user_id, source_id, COALESCE(source_window, ''))
  WHERE source_id = 'USR-09' AND is_current = 1;
