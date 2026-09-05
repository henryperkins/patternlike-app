-- Widen Codex reasoning from high to high/xhigh for the approved Sol upgrade.
-- Forward-only: applied migrations 0013, 0014, and 0017 remain immutable.
--
-- New commands use xhigh. Existing rows retain their original reasoning, every
-- artifact coordinate, lease, lifecycle field, and response upload. This uses
-- the proven 0017 parent/child rebuild because SQLite cannot alter a CHECK.
-- The only schema change is the reasoning CHECK; all other constraints and
-- indexes are preserved. No encrypted content or key is read or rewritten.
-- Apply before the Worker starts creating xhigh jobs and update the runner
-- first so it accepts both efforts. The D1 file runs as one transaction.

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Stage every child row.
-- ---------------------------------------------------------------------------
-- Deliberately no REFERENCES clause: this copy has to outlive the parent it
-- describes, which is the entire reason it exists.
CREATE TABLE codex_provider_response_uploads_xhigh_staging (
  job_id TEXT NOT NULL,
  lease_token_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO codex_provider_response_uploads_xhigh_staging (
  job_id, lease_token_hash, object_key, created_at
)
SELECT job_id, lease_token_hash, object_key, created_at
FROM codex_provider_response_uploads;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'staged response uploads do not match the live child table'
WHERE (SELECT COUNT(*) FROM codex_provider_response_uploads_xhigh_staging)
   <> (SELECT COUNT(*) FROM codex_provider_response_uploads);

-- ---------------------------------------------------------------------------
-- 2. Prove the inbound foreign-key inventory is exactly what this file knows.
-- ---------------------------------------------------------------------------
-- Dropping the parent silently breaks any other table that references it. The
-- repository ships exactly one such table; if a later migration adds a second
-- without updating this file, the rebuild must stop rather than orphan it.
INSERT INTO assertion_probe (id, reason)
SELECT 1, 'an unrecorded table references codex_provider_jobs'
WHERE EXISTS (
  SELECT 1 FROM sqlite_master
  WHERE type = 'table'
    AND name NOT IN (
      'codex_provider_jobs',
      'codex_provider_response_uploads',
      'codex_provider_response_uploads_xhigh_staging',
      'codex_provider_jobs_xhigh'
    )
    AND sql LIKE '%codex_provider_jobs%'
);

-- ---------------------------------------------------------------------------
-- 3. The widened parent.
-- ---------------------------------------------------------------------------
CREATE TABLE codex_provider_jobs_xhigh (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 38 AND substr(id, 1, 6) = 'cpjob_'
    AND substr(id, 7) NOT GLOB '*[^0-9a-f]*'
  ),
  pipeline TEXT NOT NULL CHECK (pipeline IN ('pattern', 'ontology', 'reading')),
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  user_id TEXT REFERENCES users(id),
  pass TEXT NOT NULL CHECK (
    pass IN (
      'planner', 'writer', 'verifier', 'generator', 'evaluator', 'publisher'
    )
  ),
  stage_generation INTEGER NOT NULL CHECK (stage_generation >= 0),
  stage_attempt INTEGER NOT NULL CHECK (stage_attempt >= 0),

  request_hash TEXT NOT NULL,
  request_object_key TEXT NOT NULL UNIQUE CHECK (
    length(request_object_key) BETWEEN 1 AND 1024
    AND substr(request_object_key, 1, 20) = 'codex-provider-jobs/'
  ),
  request_envelope_hash TEXT NOT NULL,
  request_ciphertext_hash TEXT NOT NULL,
  request_key_id TEXT NOT NULL CHECK (length(request_key_id) BETWEEN 1 AND 128),
  request_nonce TEXT NOT NULL CHECK (length(request_nonce) BETWEEN 16 AND 128),
  request_byte_length INTEGER NOT NULL CHECK (request_byte_length >= 0),

  response_hash TEXT,
  response_object_key TEXT UNIQUE CHECK (
    response_object_key IS NULL OR (
      length(response_object_key) BETWEEN 1 AND 1024
      AND substr(response_object_key, 1, 20) = 'codex-provider-jobs/'
    )
  ),
  response_envelope_hash TEXT,
  response_ciphertext_hash TEXT,
  response_key_id TEXT CHECK (
    response_key_id IS NULL OR length(response_key_id) BETWEEN 1 AND 128
  ),
  response_nonce TEXT CHECK (
    response_nonce IS NULL OR length(response_nonce) BETWEEN 16 AND 128
  ),
  response_byte_length INTEGER CHECK (
    response_byte_length IS NULL OR response_byte_length >= 0
  ),

  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  reasoning_effort TEXT NOT NULL CHECK (reasoning_effort IN ('high', 'xhigh')),
  prompt_version TEXT NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 200),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms = 900000),
  daily_call_limit INTEGER NOT NULL CHECK (daily_call_limit > 0),

  status TEXT NOT NULL CHECK (
    status IN ('pending', 'leased', 'completed', 'failed', 'cancelled')
  ),
  lease_token_hash TEXT,
  lease_expires_at TEXT CHECK (
    lease_expires_at IS NULL OR unixepoch(lease_expires_at) IS NOT NULL
  ),
  provider_request_id TEXT CHECK (
    provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 200
  ),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code IN (
      'publisher_unavailable', 'publisher_output_invalid', 'publisher_refused',
      'publisher_auth_failed', 'publisher_model_unavailable',
      'publisher_budget_exhausted'
    )
  ),
  safe_detail_code TEXT CHECK (
    safe_detail_code IS NULL OR safe_detail_code IN (
      'request_timeout', 'network_error', 'rate_limited', 'provider_5xx',
      'authentication_failed', 'model_not_available', 'provider_refusal',
      'max_output_tokens_exhausted', 'missing_output_text',
      'multiple_output_text', 'invalid_json', 'schema_mismatch',
      'daily_call_limit_reached'
    )
  ),
  available_at TEXT NOT NULL CHECK (unixepoch(available_at) IS NOT NULL),
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (unixepoch(updated_at) IS NOT NULL),
  completed_at TEXT CHECK (
    completed_at IS NULL OR unixepoch(completed_at) IS NOT NULL
  ),

  UNIQUE (pipeline, owner_id, pass, stage_generation, stage_attempt),
  UNIQUE (
    pipeline, owner_id, pass, stage_generation, stage_attempt, request_hash
  ),
  UNIQUE (request_key_id, request_nonce),
  UNIQUE (response_key_id, response_nonce),

  -- Reading work is owned by a reader exactly as Pattern work is, so account
  -- erasure can find and delete its encrypted exchange artifacts. Ontology work
  -- is not user-owned and must stay that way.
  CHECK (
    (pipeline IN ('pattern', 'reading') AND user_id IS NOT NULL)
    OR (pipeline = 'ontology' AND user_id IS NULL)
  ),
  -- One closed relationship rather than two independent enums. Widening
  -- `pipeline` and `pass` separately would have admitted reading/planner and
  -- ontology/publisher as a side effect, and neither has an owner loader, a
  -- budget ledger, or a current-owner check behind it.
  CHECK (
    (pipeline = 'pattern' AND pass IN ('planner', 'writer', 'verifier'))
    OR (pipeline = 'ontology' AND pass IN (
      'planner', 'writer', 'verifier', 'generator', 'evaluator'
    ))
    OR (pipeline = 'reading' AND pass = 'publisher')
  ),
  CHECK (unixepoch(updated_at) >= unixepoch(created_at)),
  CHECK (
    completed_at IS NULL OR unixepoch(completed_at) >= unixepoch(created_at)
  ),
  CHECK (
    (failure_code IS NULL AND safe_detail_code IS NULL)
    OR (failure_code = 'publisher_unavailable' AND safe_detail_code IN (
      'request_timeout', 'network_error', 'rate_limited', 'provider_5xx'
    ))
    OR (failure_code = 'publisher_output_invalid' AND safe_detail_code IN (
      'max_output_tokens_exhausted', 'missing_output_text',
      'multiple_output_text', 'invalid_json', 'schema_mismatch'
    ))
    OR (failure_code = 'publisher_refused'
        AND safe_detail_code = 'provider_refusal')
    OR (failure_code = 'publisher_auth_failed'
        AND safe_detail_code = 'authentication_failed')
    OR (failure_code = 'publisher_model_unavailable'
        AND safe_detail_code = 'model_not_available')
    OR (failure_code = 'publisher_budget_exhausted'
        AND safe_detail_code = 'daily_call_limit_reached')
  ),
  CHECK (
    lease_token_hash IS NULL OR (
      length(lease_token_hash) = 71
      AND substr(lease_token_hash, 1, 7) = 'sha256:'
      AND substr(lease_token_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(request_envelope_hash) = 71
    AND substr(request_envelope_hash, 1, 7) = 'sha256:'
    AND substr(request_envelope_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(request_ciphertext_hash) = 71
    AND substr(request_ciphertext_hash, 1, 7) = 'sha256:'
    AND substr(request_ciphertext_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    response_hash IS NULL OR (
      length(response_hash) = 71
      AND substr(response_hash, 1, 7) = 'sha256:'
      AND substr(response_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    response_envelope_hash IS NULL OR (
      length(response_envelope_hash) = 71
      AND substr(response_envelope_hash, 1, 7) = 'sha256:'
      AND substr(response_envelope_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    response_ciphertext_hash IS NULL OR (
      length(response_ciphertext_hash) = 71
      AND substr(response_ciphertext_hash, 1, 7) = 'sha256:'
      AND substr(response_ciphertext_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (
      response_hash IS NULL AND response_object_key IS NULL
      AND response_envelope_hash IS NULL AND response_ciphertext_hash IS NULL
      AND response_key_id IS NULL AND response_nonce IS NULL
      AND response_byte_length IS NULL
    ) OR (
      response_hash IS NOT NULL AND response_object_key IS NOT NULL
      AND response_envelope_hash IS NOT NULL
      AND response_ciphertext_hash IS NOT NULL
      AND response_key_id IS NOT NULL AND response_nonce IS NOT NULL
      AND response_byte_length IS NOT NULL
    )
  ),
  CHECK (
    (
      status = 'pending' AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL AND response_hash IS NULL
      AND provider_request_id IS NULL AND input_tokens IS NULL
      AND output_tokens IS NULL AND failure_code IS NULL
      AND safe_detail_code IS NULL AND completed_at IS NULL
    ) OR (
      status = 'leased' AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL AND response_hash IS NULL
      AND provider_request_id IS NULL AND input_tokens IS NULL
      AND output_tokens IS NULL AND failure_code IS NULL
      AND safe_detail_code IS NULL AND completed_at IS NULL
    ) OR (
      status = 'completed' AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL AND response_hash IS NOT NULL
      AND provider_request_id IS NOT NULL AND input_tokens IS NOT NULL
      AND output_tokens IS NOT NULL AND failure_code IS NULL
      AND safe_detail_code IS NULL AND completed_at IS NOT NULL
    ) OR (
      status = 'failed' AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL AND response_hash IS NULL
      AND provider_request_id IS NULL AND input_tokens IS NULL
      AND output_tokens IS NULL AND failure_code IS NOT NULL
      AND safe_detail_code IS NOT NULL AND completed_at IS NOT NULL
    ) OR (
      status = 'cancelled' AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL AND response_hash IS NULL
      AND provider_request_id IS NULL AND input_tokens IS NULL
      AND output_tokens IS NULL AND failure_code IS NULL
      AND safe_detail_code IS NULL AND completed_at IS NOT NULL
    )
  )
);

-- ---------------------------------------------------------------------------
-- 4. Copy every parent column explicitly, then prove the copy is complete.
-- ---------------------------------------------------------------------------
INSERT INTO codex_provider_jobs_xhigh (
  id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
  request_hash, request_object_key, request_envelope_hash,
  request_ciphertext_hash, request_key_id, request_nonce, request_byte_length,
  response_hash, response_object_key, response_envelope_hash,
  response_ciphertext_hash, response_key_id, response_nonce,
  response_byte_length, model, reasoning_effort, prompt_version, timeout_ms,
  daily_call_limit, status, lease_token_hash, lease_expires_at,
  provider_request_id, input_tokens, output_tokens, failure_code,
  safe_detail_code, available_at, created_at, updated_at, completed_at
)
SELECT
  id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
  request_hash, request_object_key, request_envelope_hash,
  request_ciphertext_hash, request_key_id, request_nonce, request_byte_length,
  response_hash, response_object_key, response_envelope_hash,
  response_ciphertext_hash, response_key_id, response_nonce,
  response_byte_length, model, reasoning_effort, prompt_version, timeout_ms,
  daily_call_limit, status, lease_token_hash, lease_expires_at,
  provider_request_id, input_tokens, output_tokens, failure_code,
  safe_detail_code, available_at, created_at, updated_at, completed_at
FROM codex_provider_jobs;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'the widened parent copy is not row-complete'
WHERE (SELECT COUNT(*) FROM codex_provider_jobs_xhigh)
   <> (SELECT COUNT(*) FROM codex_provider_jobs);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'the reasoning upgrade changed an existing provider job'
WHERE EXISTS (
  SELECT * FROM codex_provider_jobs
  EXCEPT SELECT * FROM codex_provider_jobs_xhigh
) OR EXISTS (
  SELECT * FROM codex_provider_jobs_xhigh
  EXCEPT SELECT * FROM codex_provider_jobs
);

-- ---------------------------------------------------------------------------
-- 5. Drop in dependency order, child first, so no cascade ever fires.
-- ---------------------------------------------------------------------------
DROP TABLE codex_provider_response_uploads;
DROP TABLE codex_provider_jobs;

ALTER TABLE codex_provider_jobs_xhigh RENAME TO codex_provider_jobs;

-- ---------------------------------------------------------------------------
-- 6. Rebuild the child exactly as 0014 declared it, then restore every row.
-- ---------------------------------------------------------------------------
CREATE TABLE codex_provider_response_uploads (
  job_id TEXT NOT NULL
    REFERENCES codex_provider_jobs(id) ON DELETE CASCADE,
  lease_token_hash TEXT NOT NULL CHECK (
    length(lease_token_hash) = 71
    AND substr(lease_token_hash, 1, 7) = 'sha256:'
    AND substr(lease_token_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  object_key TEXT NOT NULL UNIQUE CHECK (
    length(object_key) BETWEEN 1 AND 1024
    AND substr(object_key, 1, 20) = 'codex-provider-jobs/'
  ),
  created_at TEXT NOT NULL CHECK (unixepoch(created_at) IS NOT NULL),
  PRIMARY KEY (job_id, lease_token_hash)
);

INSERT INTO codex_provider_response_uploads (
  job_id, lease_token_hash, object_key, created_at
)
SELECT job_id, lease_token_hash, object_key, created_at
FROM codex_provider_response_uploads_xhigh_staging;

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'restored response uploads do not match the staged inventory'
WHERE (SELECT COUNT(*) FROM codex_provider_response_uploads)
   <> (SELECT COUNT(*) FROM codex_provider_response_uploads_xhigh_staging);

-- ---------------------------------------------------------------------------
-- 7. Indexes, recreated with their 0013/0014 definitions.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_codex_provider_jobs_claimable
  ON codex_provider_jobs(available_at, lease_expires_at, created_at, id)
  WHERE status IN ('pending', 'leased');

CREATE INDEX idx_codex_provider_jobs_owner
  ON codex_provider_jobs(
    pipeline, owner_id, pass, stage_generation, stage_attempt
  );

CREATE INDEX idx_codex_provider_jobs_user
  ON codex_provider_jobs(user_id, id)
  WHERE user_id IS NOT NULL;

CREATE INDEX idx_codex_provider_response_uploads_created
  ON codex_provider_response_uploads(created_at, job_id);

-- ---------------------------------------------------------------------------
-- 8. Remove staging state.
-- ---------------------------------------------------------------------------
DROP TABLE codex_provider_response_uploads_xhigh_staging;
