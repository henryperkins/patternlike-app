# Pattern Erasure Replay Ledger (M7 §29.11 / `0008`)

**Date:** 2026-08-16

**Status:** Draft for approval. No restore drill may be scheduled until this
is approved and the migration is applied. This is the blocking dependency of
Slice D criterion 23, not the drill itself.

**Scope:** Specify the signed, non-content lifecycle ledger that a disaster-
recovery restore replays before the Worker receives traffic, so a
pre-deletion snapshot cannot resurrect Pattern content or reset a consumed
claim.

Companion: [`2026-08-16-m7-spec-artifact-amendments.md`](2026-08-16-m7-spec-artifact-amendments.md)
finding 8 / decision 11.

## Decision summary

- `0008` creates `pattern_erasure_replay_events`. Later M7 migrations
  (per-stage-class usage, a D1 provenance-origin convenience column) take
  `0009` or later.
- The D1 table is the live write-ahead. The restore source is a create-only
  R2 replica (`pattern-erasure-replay/`) that is **outside** D1 Time Travel.
  Replaying from the restored D1 table would prove nothing: the snapshot
  contains the pre-deletion rows.
- Records are signed with a dedicated `PATTERN_REPLAY_LEDGER_KEYS` allowlist,
  canonicalized the same way ontology releases are: JCS over the record
  minus `content_hash` and `signature`.
- Records contain identifiers and status transitions only. No prose, packet,
  plan, prompt, or artifact ciphertext.
- The table is **not user-owned**. Account deletion writes an `account_deleted`
  event. It does not delete ledger rows. The column is `target_user_id`, not
  `user_id`, and it has no foreign key to `users`, so a retained tombstone
  or a missing user row cannot prevent replay.
- Replay against `pattern_generation_claims` is forward-only: a restored
  `available` row whose ledger says `deleted`, `superseded`, or `withdrawn`
  is moved to that terminal status with a non-null `consumed_at`. Replay
  never moves a consumed row back to `available`.

## Goal

After a D1 restore to a time before a Pattern deletion, chart-correction
erasure, ontology withdrawal, or account deletion, an operator can replay
the replica and prove:

1. the deleted Pattern is not readable on `GET /v1/pattern`;
2. `GET /v1/pattern-state` is `deleted` or `withdrawn`, not `available`;
3. `POST /v1/pattern-generations` returns `409 pattern_already_consumed`
   for that fingerprint;
4. no provider call is made.

Explicit non-goals. This slice does not run the drill (Slice D). It does
not change `PATTERN_AI_ROLLOUT`. It does not store content. It does not
replace `pattern_admin_access_events`.

## Events

Closed `event_class` set:

| Class | Written when | Claim effect |
|---|---|---|
| `claim_consumed` | a fingerprint claim leaves `available`/`reserved` for a terminal status | set `consumed_at` if null; set status to `next_claim_status` |
| `pattern_deleted` | the reader deletes an accepted Pattern | status `deleted` |
| `chart_correction_erased` | a chart correction erases the prior Pattern | status `superseded` |
| `pattern_withdrawn` | critical ontology recall withdraws an accepted Pattern | status `withdrawn` |
| `ontology_recalled` | a release is recalled (may name many users via follow-up `pattern_withdrawn` rows) | no direct claim write; audit of the recall |
| `account_deleted` | account erasure begins | every claim for `target_user_id` becomes `deleted` if not already terminal |

`next_claim_status` is required for every class except `ontology_recalled`,
and is one of `accepted`, `deleted`, `superseded`, `withdrawn`. `accepted`
appears only on `claim_consumed` when publication wins; it still sets
`consumed_at`, which is what blocks regeneration.

## Record shape

Normative schema: `contracts/m7/pattern-erasure-replay-event.schema.json`.

Required fields:

- `schema_version` (`0.7.0`)
- `event_id` (`prel_` + 32 hex)
- `event_class`
- `occurred_at`
- `target_user_id` (nullable only for `ontology_recalled`)
- `chart_fingerprint_hash` (nullable only for `ontology_recalled` and
  `account_deleted`)
- `claim_id` (nullable only for those two classes)
- `generation_id` (nullable)
- `pattern_id` (nullable)
- `ontology_version` (nullable)
- `prior_claim_status` (nullable)
- `next_claim_status` (nullable exactly when `event_class` is
  `ontology_recalled`)
- `content_hash`
- `signature`

No other properties. No content fields.

## Signing and replica

1. The Worker canonicalizes the record minus `content_hash` and `signature`.
2. `content_hash` is `sha256:` plus the hex digest of those bytes.
3. `signature` is Ed25519 over the same bytes, verified against
   `PATTERN_REPLAY_LEDGER_KEYS`. Production refuses to write or replay
   when the allowlist is missing. Development may skip verification only
   when `ENVIRONMENT` is `development` or `test`.
4. The same guarded batch that mutates a claim inserts the D1 row and
   puts the signed JSON to R2 at
   `pattern-erasure-replay/{event_id}.json` with create-only semantics.
   A colliding object with different bytes is an integrity defect.
5. R2 success is not proof the D1 row committed; the D1 row is the
   outbox. `POST /internal/pattern-erasure-replay/sweep` re-puts rows
   whose replica is missing. A restore uses the replica, not the table.

`PATTERN_REPLAY_LEDGER_KEYS` is a new secret. It is not
`PATTERN_ONTOLOGY_KEYS` and not `ROOT_KEK`.

## Replay procedure

Specified here so Slice D’s runbook has an algorithm rather than a
narrative.

1. Take the D1 restore to the chosen bookmark. Do not route traffic.
2. List `pattern-erasure-replay/` in the replica bucket. Verify every
   object’s signature and `content_hash`. Refuse the drill on one
   failure.
3. Order events by `occurred_at`, then `event_id`.
4. For each event, apply the claim effect in one guarded batch opened
   and closed by `assertion_probe`:
   - if no claim row exists, insert a terminal row with the pinned
     fingerprint and `consumed_at = occurred_at`;
   - if the row is `available` or `reserved`, move it to
     `next_claim_status` and set `consumed_at`;
   - if the row is already terminal, leave it terminal. A status
     mismatch is logged as `pattern_erasure_replay_already_terminal`
     and is not a failure.
5. Never set `status = 'available'`.
6. Only then start the Worker.

## Migration

`db/d1/0008_pattern_erasure_replay.sql` is forward-only. It creates the
table and indexes. It does not rebuild a `0007` CHECK. It is not a
crypto break and adds no encrypted column.

`resetDb()` deletes from the table so a leaked test event cannot fail
the next suite’s restore-shaped assertion. The deletion-manifest tests
do not classify it: there is no `user_id` column and no FK to `users`.

## Configuration

- `PATTERN_REPLAY_LEDGER_KEYS` — required outside development.
- Replica R2 binding `PATTERN_REPLAY_LEDGER` — a bucket that operators
  exclude from the D1 restore set by construction (it is not D1).
- `POST /internal/pattern-erasure-replay/sweep` and
  `POST /internal/pattern-erasure-replay/apply` are service-token
  routes. They are specified with the ledger; OpenAPI for them lands
  when the Worker grows the routes, as a later additive amendment.

## Acceptance

A design is implementable when:

1. a claim transition writes a signed event and a replica object in the
   same batch, or the claim transition does not commit;
2. sweep re-puts a committed row whose replica is missing;
3. apply on a database whose claim is `available` and whose replica
   says `deleted` leaves the claim `deleted` with `consumed_at` set;
4. apply never returns a claim to `available`;
5. account deletion writes `account_deleted` and leaves the ledger
   rows in place;
6. `python3 contracts/validate_schemas.py` accepts the event schema
   and its fixtures.

Criterion 23 remains a Slice D drill against this runtime.
