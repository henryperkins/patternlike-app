-- Daily reading quality observations, stored content-free beside each
-- publication receipt.
--
-- Adds ONE column to daily_publication_receipts: a JSON array of closed
-- lowercase quality-finding tokens (the seven codes in
-- apps/api/src/services/reading-quality.ts). No prose, no user id, no chart
-- facts, no catalog of reader text. The tokens are computed from the candidate
-- against the frozen packet by the publication path before the batch commits,
-- so the observation cannot exist without the publication it describes.
--
-- Forward-only; rewrites no existing receipt row. Existing rows keep the
-- empty default: absence of observation is not absence of defect, it is
-- absence of instrumentation.

ALTER TABLE daily_publication_receipts ADD COLUMN qualitative_findings_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(qualitative_findings_json) AND
    json_type(qualitative_findings_json) = 'array'
  );