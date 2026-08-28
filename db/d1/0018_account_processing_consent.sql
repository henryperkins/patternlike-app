-- M8 account-processing consent provenance. Forward-only.
--
-- Existing profiles predate the durable grant and remain NULL rather than
-- acquiring invented authorization history. New writers populate the exact
-- grant that passed the birth-authorization predicate.

PRAGMA foreign_keys = ON;

ALTER TABLE birth_profiles
  ADD COLUMN consent_id TEXT REFERENCES consents(id);
