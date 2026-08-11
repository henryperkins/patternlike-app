-- Pattern-Like Astrology App
-- M5 constrained-model reading publisher (Cloudflare D1 / SQLite)
-- Contract package: contracts/m5 schema_version 0.5.0
--
-- FORWARD-ONLY. 0001 and 0002 are immutable: both are applied to the live
-- database (ledger 2026-08-09), and editing either could not change production.
--
-- What this migration does, and why:
--
--  * daily_readings.release_version becomes NULLABLE and is required exactly
--    for deterministic rows. A v5 reading has no editorial release behind it,
--    so NOT NULL REFERENCES content_releases(version) makes the row
--    unrepresentable. The legacy catalogue, its R2 objects, its signing
--    configuration, and its ingestion routes all stay: they are readable
--    history, and their removal is a later migration with its own retention
--    review.
--
--  * status gains `invalidated`. Consent revocation, new context, and ordinary
--    preference changes must NOT rewrite prose a reader has already seen — but
--    a birth-profile correction or a calculation defect makes the artifact
--    factually wrong, and it has to stop being live immediately rather than
--    waiting for a successor to succeed. `invalidated` is that state, and
--    because uq_daily_readings_live is scoped to `status = 'published'` the
--    row leaves Today the instant the compare-and-swap commits while its
--    ciphertext stays in revision history.
--
--  * reading_provider_daily_usage bounds spend. Every provider call — scheduled,
--    first-open, and retry — consumes one unit of a UTC-day ceiling before the
--    request is made. It is keyed ONLY by date: a per-user counter would be a
--    clear-text record of who received a reading on which day.
--
--  * users.next_due_at is the scheduling cursor, with two partial indexes so a
--    cron invocation reads a bounded slice rather than the table.
--
-- EMPTY-TABLE REBUILD. Production has no content release, and
-- daily_readings.release_version is NOT NULL REFERENCES content_releases —
-- therefore production can hold no reading row, and the rollout gate proves
-- that with counts before this runs. The pre-flight below turns that proof into
-- a constraint: a dependent row stops the migration BEFORE either table is
-- dropped, because AAD-bound ciphertext can only be re-shaped by an application
-- layer holding the per-user DEK.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Pre-flight: refuse to destroy rows this migration cannot convert
-- ---------------------------------------------------------------------------

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'daily_readings contains rows - convert them with an application-layer encrypted backfill before applying 0003'
WHERE EXISTS (SELECT 1 FROM daily_readings);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'reading_sources contains rows - convert them with an application-layer encrypted backfill before applying 0003'
WHERE EXISTS (SELECT 1 FROM reading_sources);

-- reading_feedback references daily_readings, which is dropped below.
INSERT INTO assertion_probe (id, reason)
SELECT 1, 'reading_feedback contains rows referencing daily_readings - back them up before applying 0003'
WHERE EXISTS (SELECT 1 FROM reading_feedback);

-- ---------------------------------------------------------------------------
-- users: index the scheduling cursor
-- ---------------------------------------------------------------------------
--
-- `users.next_due_at` already exists — 0001 declared it and nothing has ever
-- written it, so every row is null and no backfill is required. What is new is
-- that it acquires a reader, and a cron that examines at most 100 accounts per
-- invocation has to reach them through an index rather than a table scan.
--
-- NULL means "never evaluated", not "never due". An ineligible active account
-- still receives a next check time after its first evaluation, so a null value
-- can never become an unbounded rescan sentinel — which is why the two indexes
-- below partition on exactly that distinction.

CREATE INDEX IF NOT EXISTS idx_users_next_due_at
  ON users(next_due_at, id)
  WHERE status = 'active' AND next_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_unseeded_due
  ON users(created_at, id)
  WHERE status = 'active' AND next_due_at IS NULL;

-- ---------------------------------------------------------------------------
-- Provider call budget
-- ---------------------------------------------------------------------------
--
-- Deliberately not keyed by user. A per-user row would record, in clear text,
-- which accounts received a reading on which day — an operational counter is
-- not worth that. The row is created on first use and only ever counts up.

CREATE TABLE IF NOT EXISTS reading_provider_daily_usage (
  utc_date   TEXT PRIMARY KEY NOT NULL,
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK (used_calls >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- daily_readings + reading_sources: rebuild under their final names
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated under their FINAL names rather than built alongside and
-- renamed, for the same reason 0002 gave: ALTER TABLE ... RENAME rewrites
-- REFERENCES clauses in other tables only when foreign key enforcement is on at
-- that moment, and reading_sources(reading_id, user_id) is a composite child. A
-- rename-based rebuild would silently produce a dangling reference wherever
-- that assumption does not hold. The pre-flight assertions above are what make
-- dropping safe: both tables are provably empty, so there is nothing to copy.

DROP TABLE reading_sources;
DROP TABLE daily_readings;

CREATE TABLE IF NOT EXISTS daily_readings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  local_date TEXT NOT NULL,
  -- Nullable, and required exactly for the deterministic rows that have one.
  release_version TEXT REFERENCES content_releases(version),
  reading_key TEXT NOT NULL,
  chart_fingerprint TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  assembly_mode TEXT NOT NULL
    CHECK (assembly_mode IN ('deterministic', 'constrained_model')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'superseded', 'invalidated')),

  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  revision_reason TEXT NOT NULL DEFAULT 'initial'
    CHECK (revision_reason IN (
      'initial', 'chart_recalculated', 'consent_revoked',
      'safety_correction', 'defect_repair'
    )),
  supersedes_reading_id TEXT REFERENCES daily_readings(id),

  command_generation INTEGER NOT NULL DEFAULT 1 CHECK (command_generation >= 1),
  active_generation_job_id TEXT,

  -- Set exactly when the row is invalidated, so "when did this stop being
  -- true?" is answerable without decrypting anything.
  invalidated_at TEXT,

  reading_enc BLOB,
  reading_key_version INTEGER,
  reading_nonce TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (reading_key),
  UNIQUE (user_id, local_date, revision),
  UNIQUE (id, user_id),

  -- A v5 row has no release; a deterministic row still must have one.
  CHECK (
    (assembly_mode = 'constrained_model' AND release_version IS NULL)
    OR (assembly_mode = 'deterministic' AND release_version IS NOT NULL)
  ),

  -- The two reading_key grammars are disjoint by namespace, which is what lets
  -- the global UNIQUE (reading_key) span both: a three-value
  -- `reading-v5:<user>:<date>:r<n>` key cannot collide with a four-value
  -- `user:<user>:<date>:<release>:r<n>` one. Enforced here rather than trusted,
  -- because the collision it prevents would be a cross-format overwrite.
  CHECK (
    (assembly_mode = 'constrained_model' AND reading_key LIKE 'reading-v5:%')
    OR (assembly_mode = 'deterministic' AND reading_key NOT LIKE 'reading-v5:%')
  ),

  -- An invalidated row keeps the artifact it invalidated: revision history is
  -- the record of what a reader was actually shown.
  CHECK (
    status NOT IN ('published', 'invalidated')
    OR (
      reading_enc IS NOT NULL
      AND reading_key_version IS NOT NULL
      AND reading_nonce IS NOT NULL
    )
  ),
  CHECK (
    (status = 'invalidated' AND invalidated_at IS NOT NULL)
    OR (status != 'invalidated' AND invalidated_at IS NULL)
  ),
  CHECK (
    (revision_reason = 'initial' AND revision = 1 AND supersedes_reading_id IS NULL)
    OR (revision_reason != 'initial' AND revision > 1 AND supersedes_reading_id IS NOT NULL)
  ),
  FOREIGN KEY (active_generation_job_id, user_id) REFERENCES jobs(id, user_id)
);

CREATE TABLE IF NOT EXISTS reading_sources (
  id TEXT PRIMARY KEY NOT NULL,
  reading_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  paragraph_id TEXT NOT NULL,
  paragraph_order INTEGER NOT NULL CHECK (paragraph_order >= 1),

  evidence_enc BLOB NOT NULL,
  evidence_key_version INTEGER NOT NULL,
  evidence_nonce TEXT NOT NULL,

  created_at TEXT NOT NULL,
  UNIQUE (reading_id, paragraph_id),
  UNIQUE (reading_id, paragraph_order),
  FOREIGN KEY (reading_id, user_id) REFERENCES daily_readings(id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_readings_user_date
  ON daily_readings(user_id, local_date DESC);

-- At most ONE published reading per user per local day. `invalidated` is not
-- `published`, so an invalidated row leaves Today without waiting for its
-- successor and without violating this index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_live
  ON daily_readings(user_id, local_date) WHERE status = 'published';

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_pending
  ON daily_readings(user_id, local_date) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_successor
  ON daily_readings(supersedes_reading_id) WHERE supersedes_reading_id IS NOT NULL;

-- The scheduler's repair lane. The literal 3 is MAX_COMMAND_GENERATION in
-- apps/api/src/db/generation.ts; a partial index cannot read a constant, so the
-- two move together or the index silently stops matching the query.
CREATE INDEX IF NOT EXISTS idx_daily_readings_failed_generation
  ON daily_readings(updated_at, user_id)
  WHERE status = 'failed' AND command_generation < 3;

-- Invalidated rows with no successor yet. Ordered by (updated_at, id) so the
-- repair sweep is stable and one stuck row cannot consume every invocation.
CREATE INDEX IF NOT EXISTS idx_daily_readings_invalidated_repair
  ON daily_readings(updated_at, id)
  WHERE status = 'invalidated';

CREATE INDEX IF NOT EXISTS idx_reading_sources_reading
  ON reading_sources(reading_id, paragraph_order);

CREATE INDEX IF NOT EXISTS idx_reading_sources_user
  ON reading_sources(user_id);

-- ---------------------------------------------------------------------------
-- jobs: failure-class discovery
-- ---------------------------------------------------------------------------
--
-- Advancing next_due_at after the original reservation would otherwise hide a
-- 23:30 provider failure from automatic repair: the cursor has already moved
-- past the day the failure belongs to.

CREATE INDEX IF NOT EXISTS idx_jobs_failed_result_class
  ON jobs(result_class, finished_at, id)
  WHERE status = 'failed';

-- ---------------------------------------------------------------------------
-- Migration self-check
-- ---------------------------------------------------------------------------

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'assertion_probe must be empty - a guard row survived'
WHERE EXISTS (SELECT 1 FROM assertion_probe);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'daily_readings must be empty after the rebuild'
WHERE EXISTS (SELECT 1 FROM daily_readings);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'reading_sources must be empty after the rebuild'
WHERE EXISTS (SELECT 1 FROM reading_sources);

INSERT INTO assertion_probe (id, reason)
SELECT 1, 'reading_provider_daily_usage must start empty'
WHERE EXISTS (SELECT 1 FROM reading_provider_daily_usage);
