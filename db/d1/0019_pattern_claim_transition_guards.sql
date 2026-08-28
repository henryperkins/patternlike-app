-- Guard the monotonic Pattern claim lifecycle in D1 as well as application
-- code. Forward-only; no table rebuild, backfill, encrypted column, or crypto
-- version change. Replay may still insert an absent terminal tombstone, while
-- updates to an existing row must move through the live transition graph.

CREATE TRIGGER pattern_claim_transition_guard
BEFORE UPDATE ON pattern_generation_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'available' AND NEW.status = 'reserved')
      OR (OLD.status = 'reserved' AND NEW.status = 'available')
      OR (OLD.status = 'reserved' AND NEW.status = 'accepted')
      OR (
        OLD.status = 'accepted'
        AND NEW.status IN ('deleted', 'superseded', 'withdrawn')
      )
    )
    THEN RAISE(ABORT, 'illegal pattern claim transition')
  END;

  SELECT CASE
    WHEN NEW.id IS NOT OLD.id
      OR NEW.user_id IS NOT OLD.user_id
      OR NEW.chart_fingerprint_hash IS NOT OLD.chart_fingerprint_hash
      OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'pattern claim identity is immutable')
  END;

  SELECT CASE
    WHEN OLD.status = 'reserved' AND NEW.status = 'accepted'
      AND (NEW.consumed_at IS NULL OR NEW.accepted_at IS NULL)
    THEN RAISE(ABORT, 'accepted pattern claim requires consumption timestamps')
    WHEN NOT (OLD.status = 'reserved' AND NEW.status = 'accepted')
      AND (
        NEW.consumed_at IS NOT OLD.consumed_at
        OR NEW.accepted_at IS NOT OLD.accepted_at
      )
    THEN RAISE(ABORT, 'pattern claim consumption is immutable')
  END;

  SELECT CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'deleted'
      AND NEW.deleted_at IS NULL
    THEN RAISE(ABORT, 'deleted pattern claim requires deleted_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'deleted')
      AND NEW.deleted_at IS NOT OLD.deleted_at
    THEN RAISE(ABORT, 'pattern claim deleted_at is immutable')
  END;

  SELECT CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'superseded'
      AND NEW.superseded_at IS NULL
    THEN RAISE(ABORT, 'superseded pattern claim requires superseded_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'superseded')
      AND NEW.superseded_at IS NOT OLD.superseded_at
    THEN RAISE(ABORT, 'pattern claim superseded_at is immutable')
  END;

  SELECT CASE
    WHEN OLD.status = 'accepted' AND NEW.status = 'withdrawn'
      AND NEW.withdrawn_at IS NULL
    THEN RAISE(ABORT, 'withdrawn pattern claim requires withdrawn_at')
    WHEN NOT (OLD.status = 'accepted' AND NEW.status = 'withdrawn')
      AND NEW.withdrawn_at IS NOT OLD.withdrawn_at
    THEN RAISE(ABORT, 'pattern claim withdrawn_at is immutable')
  END;

  SELECT CASE
    WHEN NEW.status = OLD.status
      AND NEW.active_generation_id IS NOT OLD.active_generation_id
    THEN RAISE(ABORT, 'same-state pattern claim cannot change generation owner')
  END;
END;
