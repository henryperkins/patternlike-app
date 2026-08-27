-- M8 synchronous birth-calculation operational guards. Forward-only.
--
-- These tables hold owner-scoped spend, invocation-claim, and profile-version
-- allocation state only. They add no encrypted column and do not alter either
-- the AEAD version or the KEK derivation version.

PRAGMA foreign_keys = ON;

CREATE TABLE birth_calc_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  utc_date TEXT NOT NULL,
  reserved_calc_count INTEGER NOT NULL
    CHECK (reserved_calc_count BETWEEN 0 AND 50),
  last_reservation_hash TEXT NOT NULL
    CHECK (last_reservation_hash GLOB 'sha256:[0-9a-f]*'
      AND length(last_reservation_hash) = 71),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, utc_date)
);

CREATE TABLE birth_calc_reservations (
  user_id TEXT NOT NULL REFERENCES users(id),
  reservation_hash TEXT NOT NULL
    CHECK (reservation_hash GLOB 'sha256:[0-9a-f]*'
      AND length(reservation_hash) = 71),
  utc_date TEXT NOT NULL,
  claim_token_hash TEXT NOT NULL
    CHECK (claim_token_hash GLOB 'sha256:[0-9a-f]*'
      AND length(claim_token_hash) = 71),
  status TEXT NOT NULL CHECK (status IN ('pending', 'charged', 'denied')),
  created_at TEXT NOT NULL,
  charged_at TEXT,
  PRIMARY KEY (user_id, reservation_hash),
  CHECK (
    (status = 'pending' AND charged_at IS NULL)
    OR (status = 'charged' AND charged_at IS NOT NULL)
    OR (status = 'denied' AND charged_at IS NULL)
  )
);

CREATE INDEX idx_birth_calc_reservations_user_date
  ON birth_calc_reservations(user_id, utc_date);

CREATE TABLE birth_profile_version_counters (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  last_allocated_version INTEGER NOT NULL CHECK (last_allocated_version >= 0),
  updated_at TEXT NOT NULL
);
