-- Ephemeral, owner-scoped selected-place results. The normalized payload is
-- encrypted under the user's DEK; provider request/response bodies are never
-- stored.

CREATE TABLE place_resolutions (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'plc_[0-9a-f]*' AND length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider = 'google_places_geocoding_v4'),
  policy_version TEXT NOT NULL,
  payload_enc BLOB NOT NULL,
  payload_key_version INTEGER NOT NULL CHECK (payload_key_version >= 1),
  payload_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (user_id, id)
);

CREATE INDEX idx_place_resolutions_expiry
  ON place_resolutions(expires_at, id);

CREATE INDEX idx_place_resolutions_user_expiry
  ON place_resolutions(user_id, expires_at, id);
