-- Versioned root wrapping-key identity and durable, content-free crypto
-- operation state. This is not an AEAD or KEK-derivation version change.

ALTER TABLE user_keys ADD COLUMN root_kek_id TEXT NOT NULL DEFAULT 'legacy'
  CHECK (
    length(root_kek_id) BETWEEN 1 AND 64
    AND root_kek_id NOT GLOB '*[^A-Za-z0-9._-]*'
  );

CREATE INDEX idx_user_keys_live_root_kek
  ON user_keys(root_kek_id, user_id)
  WHERE destroyed_at IS NULL;

ALTER TABLE users ADD COLUMN crypto_write_fence TEXT
  CHECK (
    crypto_write_fence IS NULL
    OR (
      crypto_write_fence GLOB 'cop_[0-9a-f]*'
      AND length(crypto_write_fence) = 36
    )
  );

CREATE TABLE crypto_operations (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'cop_[0-9a-f]*' AND length(id) = 36),
  kind TEXT NOT NULL CHECK (kind = 'dek_rotate'),
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_hash TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'quiescing', 'reencrypting', 'finalizing', 'verifying',
    'blocked', 'succeeded', 'failed', 'abandoned_to_deletion'
  )),
  original_account_status TEXT NOT NULL CHECK (
    original_account_status IN ('active', 'frozen')
  ),
  previous_key_version INTEGER,
  candidate_key_version INTEGER,
  candidate_wrapped_dek BLOB,
  candidate_root_kek_id TEXT,
  reencrypted_count INTEGER NOT NULL DEFAULT 0
    CHECK (reencrypted_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  not_before TEXT NOT NULL,
  error_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (kind, user_id, idempotency_hash),
  CHECK (stage != 'failed' OR reencrypted_count = 0),
  CHECK (
    (lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CHECK (
    candidate_root_kek_id IS NULL
    OR (
      length(candidate_root_kek_id) BETWEEN 1 AND 64
      AND candidate_root_kek_id NOT GLOB '*[^A-Za-z0-9._-]*'
    )
  )
);

CREATE UNIQUE INDEX uq_crypto_operations_active_user
  ON crypto_operations(user_id)
  WHERE stage IN (
    'quiescing','reencrypting','finalizing','verifying','blocked'
  );

CREATE TABLE crypto_kek_rewrap_campaigns (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'ckc_[0-9a-f]*' AND length(id) = 36),
  singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1),
  idempotency_hash TEXT NOT NULL UNIQUE,
  target_root_kek_id TEXT NOT NULL
    CHECK (
      length(target_root_kek_id) BETWEEN 1 AND 64
      AND target_root_kek_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
  status TEXT NOT NULL CHECK (status IN ('running','blocked','completed')),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_crypto_kek_rewrap_active
  ON crypto_kek_rewrap_campaigns(singleton)
  WHERE status IN ('running','blocked');

CREATE TABLE crypto_kek_rewrap_items (
  campaign_id TEXT NOT NULL REFERENCES crypto_kek_rewrap_campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source_root_kek_id TEXT NOT NULL
    CHECK (
      length(source_root_kek_id) BETWEEN 1 AND 64
      AND source_root_kek_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','blocked')),
  error_class TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX idx_crypto_kek_rewrap_items_pending
  ON crypto_kek_rewrap_items(campaign_id, status, user_id);
