-- Preserve historical Google handoffs and their encryption AAD while admitting
-- Geoapify. Old grants/rows are not reclassified or used by the new adapter.
-- Apply before the Geoapify Worker. The old Worker remains schema-compatible.
CREATE TABLE place_resolutions_geoapify (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'plc_[0-9a-f]*' AND length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google_places_geocoding_v4', 'geoapify')),
  policy_version TEXT NOT NULL,
  payload_enc BLOB NOT NULL,
  payload_key_version INTEGER NOT NULL CHECK (payload_key_version >= 1),
  payload_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (user_id, id)
);

INSERT INTO place_resolutions_geoapify
  (id, user_id, provider, policy_version, payload_enc, payload_key_version,
   payload_nonce, created_at, expires_at, consumed_at)
SELECT id, user_id, provider, policy_version, payload_enc, payload_key_version,
       payload_nonce, created_at, expires_at, consumed_at
FROM place_resolutions;

DROP TABLE place_resolutions;
ALTER TABLE place_resolutions_geoapify RENAME TO place_resolutions;

CREATE INDEX idx_place_resolutions_expiry ON place_resolutions(expires_at, id);
CREATE INDEX idx_place_resolutions_user_expiry ON place_resolutions(user_id, expires_at, id);
