-- Durable, content-free proof that a Daily reading was published, by which
-- model, from which release. Forward-only; adds one table and two indexes and
-- rewrites nothing.
--
-- Records a validated provider/job exchange and the release that published it.
-- Local fixtures do not certify a live provider call or installed runner.
--
-- Technical metadata only: coordinates, model/prompt/effort pins, hashes,
-- usage counts, completion/publication instants, Worker version and release SHA.
-- No prose, user id, crypto subject, chart facts, calendar position, locale,
-- consent, or provider request handle.
--
-- No foreign keys: provider maintenance deletes encrypted artifacts and its
-- control row. Account erasure deletes reading/job join targets and Save state.
-- The receipt survives both; proof of an active publication stops resolving
-- when the reading is erased, invalidated, or superseded.

CREATE TABLE daily_publication_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(receipt_id) = 36 AND substr(receipt_id, 1, 4) = 'dpr_'
    AND substr(receipt_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),

  -- The publication coordinate. One receipt per published reading is the whole
  -- invariant: `completeReading` inserts this inside the publication batch, so
  -- a receipt cannot exist without the publication and the publication cannot
  -- commit without it.
  reading_id TEXT NOT NULL UNIQUE
    CHECK (length(reading_id) BETWEEN 1 AND 64),
  job_id TEXT NOT NULL CHECK (length(job_id) BETWEEN 1 AND 64),
  command_generation INTEGER NOT NULL CHECK (command_generation >= 0),

  -- The provider exchange, as it was before the sweep removed it.
  provider TEXT NOT NULL CHECK (provider = 'codex'),
  provider_job_id TEXT NOT NULL CHECK (
    length(provider_job_id) = 38 AND substr(provider_job_id, 1, 6) = 'cpjob_'
    AND substr(provider_job_id, 7) NOT GLOB '*[^0-9a-f]*'
  ),
  stage_generation INTEGER NOT NULL CHECK (stage_generation >= 0),
  stage_attempt INTEGER NOT NULL CHECK (stage_attempt >= 0),

  -- The frozen pins the command promised, recorded as executed.
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  reasoning_effort TEXT NOT NULL CHECK (reasoning_effort IN ('high', 'xhigh')),
  prompt_version TEXT NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 200),

  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  response_hash TEXT NOT NULL CHECK (
    length(response_hash) = 71 AND substr(response_hash, 1, 7) = 'sha256:'
    AND substr(response_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  provider_completed_at TEXT NOT NULL
    CHECK (unixepoch(provider_completed_at) IS NOT NULL),

  -- The deployment that did it. Both halves are required: the Cloudflare
  -- version says which upload ran, and only the release commit says what that
  -- upload was built from.
  worker_version_id TEXT NOT NULL CHECK (
    length(worker_version_id) = 36
    AND substr(worker_version_id, 9, 1) = '-'
    AND substr(worker_version_id, 14, 1) = '-'
    AND substr(worker_version_id, 19, 1) = '-'
    AND substr(worker_version_id, 24, 1) = '-'
    AND length(replace(worker_version_id, '-', '')) = 32
    AND replace(worker_version_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  release_git_sha TEXT NOT NULL CHECK (
    length(release_git_sha) = 40 AND release_git_sha NOT GLOB '*[^0-9a-f]*'
  ),

  -- Deliberately NOT constrained to be at or after `provider_completed_at`.
  -- Both instants are stamped by this Worker, so the ordering holds in
  -- practice, but an assertion over two clocks that could differ by
  -- milliseconds would abort a publication and cost a reader their reading to
  -- protect a fact nothing depends on. The ordering is recorded, not enforced.
  published_at TEXT NOT NULL CHECK (unixepoch(published_at) IS NOT NULL)
);

-- "What did release X publish, and when" — the query the attestation exists to
-- make answerable.
CREATE INDEX idx_daily_publication_receipts_release
  ON daily_publication_receipts(release_git_sha, published_at, receipt_id);

-- The join back to the Daily job, for receipt -> succeeded job -> published
-- reading.
CREATE INDEX idx_daily_publication_receipts_job
  ON daily_publication_receipts(job_id);
