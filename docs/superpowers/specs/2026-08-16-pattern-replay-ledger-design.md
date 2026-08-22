# Pattern Erasure Replay Ledger (M7 §29.11 / `0008`)

**Date:** 2026-08-16

**Status:** Approved and implemented. Migration `0008`, the signed R2-first
runtime writer, D1 receipt, service-authenticated replayer/sweeper, and lifecycle
integration are present. The production restore exercise remains the existing
Gate 9 drill criterion; this design does not satisfy that operational evidence
by itself.

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
- The create-only R2 object (`pattern-erasure-replay/`) is the durable
  write-ahead and restore authority. It is **outside** D1 Time Travel. The D1
  row is a live receipt written only after the R2 put succeeds. Replaying from
  the restored D1 table would prove nothing: the snapshot contains the
  pre-deletion rows.
- R2-first ordering is deliberately privacy-conservative. A crash after the
  R2 put but before the D1 batch leaves a signed intent that replay may apply
  even though the lost live database never committed the transition. That can
  suppress content or consume a claim; it cannot resurrect content or permit
  a reroll. The reverse ordering has an unrecoverable window in which D1
  commits an erasure that never reaches the only store surviving a restore.
- Records are signed with a dedicated
  `PATTERN_REPLAY_LEDGER_SIGNING_KEY` and verified through the
  `PATTERN_REPLAY_LEDGER_KEYS` allowlist, canonicalized as JCS over the record
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

Explicit non-goals. This design does not run the Gate 9 drill. It does not
change `PATTERN_AI_ROLLOUT`. It does not store content. It does not replace
`pattern_admin_access_events`.

## Events

Closed `event_class` set:

| Class | Written when | Replay effect |
|---|---|---|
| `claim_consumed` | a fingerprint claim leaves `available`/`reserved` for a terminal status | set `consumed_at` if null; set status to `next_claim_status` |
| `pattern_deleted` | the reader deletes an accepted Pattern | erase the document and artifact key; move `accepted` to `deleted` |
| `chart_correction_erased` | a chart correction erases the prior Pattern | erase the document and artifact key; move `accepted` to `superseded` |
| `pattern_withdrawn` | critical ontology recall withdraws an accepted Pattern | erase the document and artifact key; move `accepted` to `withdrawn` |
| `ontology_recalled` | a release is recalled (may name many users via follow-up `pattern_withdrawn` rows) | mark the release recalled, clear its active pointer, and retain a version tombstone |
| `account_deleted` | account erasure begins | run the full account-deletion object, manifest, row, key-erasure, and tombstone workflow; Pattern claims are deleted with the other user-owned rows |

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
- `ontology_version` (non-null for `ontology_recalled`, otherwise nullable)
- `prior_claim_status` (nullable)
- `next_claim_status` (nullable exactly when `event_class` is
  `ontology_recalled`)
- `content_hash`
- `signing_key_id`
- `signature`

No other properties. No content fields.

## Signing and replica

1. Before creating bytes, the Worker derives `event_id` as `prel_` plus the
   first 32 lowercase hex characters of SHA-256 over the JCS array
   `["pattern-erasure-replay-event-v1", event_class, semantic_operation_key]`.
   The semantic key is stable: the claim/generation identity for consumption,
   the owner-scoped idempotency record for reader deletion, the chart-correction
   operation ID, recall-event-plus-claim for withdrawal, `ontology_version` for
   recall, and the deletion-request ID for account deletion.
2. The Worker first reads the deterministic R2 key. If an object exists, it
   verifies the hash and signature and requires every semantic field to match,
   then adopts the stored bytes, including `occurred_at` and `signing_key_id`.
   A mismatch is an integrity defect. If no object exists, the Worker pins
   `occurred_at`, chooses the active signing key, and creates the record. A
   create race is resolved by reading and adopting the winning identical object.
3. The Worker canonicalizes the record minus `content_hash` and `signature`.
4. `content_hash` is `sha256:` plus the hex digest of those bytes.
5. `signature` is Ed25519 over the same bytes. `signing_key_id` selects a
   public key from `PATTERN_REPLAY_LEDGER_KEYS`; the active private key comes
   from `PATTERN_REPLAY_LEDGER_SIGNING_KEY`. Production refuses to write when
   the signer is missing or does not match its allowlisted public key, and
   refuses to replay an unknown key ID. Development may skip signing only when
   `ENVIRONMENT` is `development` or `test`.
6. After authorization and lifecycle preconditions pass, but before any D1
   mutation, the Worker puts the signed JSON to R2 at
   `pattern-erasure-replay/{event_id}.json` with create-only semantics. A
   failed conditional create always returns to step 2: a valid object with the
   same deterministic semantic fields wins and is adopted even when its
   timestamp or signing key differs from the losing candidate. Invalid bytes
   or a semantic mismatch are integrity defects.
7. Only after that put succeeds does one guarded D1 batch mutate live state and
   insert the matching receipt with non-null `replica_put_at`. No R2 operation
   occurs inside a D1 batch; Cloudflare provides no cross-service transaction.
8. If the D1 batch fails, the R2 object remains the durable lifecycle intent.
   An exact retry derives the same key and adopts the stored bytes.
   `POST /internal/pattern-erasure-replay/sweep` lists signed replica objects
   and applies any whose D1 receipt or terminal transition is missing. It never
   tries to reconstruct the write-ahead from D1.
9. The originating request succeeds only after the D1 batch commits. A restore
   still uses the replica, not the table.

The signing key is separate from the verification keyring so a restore
environment need not hold private material. Old public keys remain allowlisted
for at least the longest R2 retention and restore-drill window.
`PATTERN_REPLAY_LEDGER_SIGNING_KEY` and `PATTERN_REPLAY_LEDGER_KEYS` are not
`PATTERN_ONTOLOGY_KEYS` or `ROOT_KEK`.

## Replay procedure

Specified here so Slice D’s runbook has an algorithm rather than a
narrative.

1. Take the D1 restore to the chosen bookmark. Do not route traffic.
2. List `pattern-erasure-replay/` in the replica bucket. Verify every
   object’s signature and `content_hash`. Refuse the drill on one
   failure.
3. Order non-account events by `occurred_at`, then `event_id`. Apply
   `account_deleted` events in a final pass so no older or same-timestamp event
   can recreate user-owned state after account erasure.
4. Apply each event idempotently in a guarded batch opened and closed by
   `assertion_probe`:
   - `ontology_recalled` requires `ontology_version`, marks an existing release
     `recalled`, clears the pointer if it names that version, and leaves the
     replay receipt as a tombstone even when the restored snapshot predates the
     release row. Ontology ingestion must refuse a version named by such a
     tombstone.
   - `claim_consumed` inserts the pinned terminal claim when absent, or moves
     only `available`/`reserved` to `next_claim_status`. It does not rewrite an
     already terminal claim.
   - `pattern_deleted`, `chart_correction_erased`, and `pattern_withdrawn`
     delete the matching `pattern_documents` row and erase the generation
     artifact key before traffic. If the pinned claim is absent, they insert
     its terminal tombstone; otherwise they move `available`, `reserved`, or
     `accepted` to the event’s terminal status. An already-erased claim never
     moves back to `accepted` or `available`, so causal safety does not depend
     on timestamp tie-breaking.
   - `account_deleted` invokes the complete deletion manifest against the
     restored account: fence and delete registered objects; delete sessions,
     identities, jobs, Pattern claims, and every other table in
     `DELETED_USER_TABLES`; null retained administrator references; erase all
     wrapped DEKs; and leave the existing `users` / `user_keys` /
     `deletion_requests` proof state in its normal deleted-tombstone shape.
     When the restored snapshot predates the deletion request, the offline
     replay applies those idempotent primitives directly and uses `event_id` as
     the proof identity; a crash restarts the ordered sequence before traffic.
   Physical R2 artifact deletion may follow, but key erasure and D1 document
   deletion are in the pre-traffic guarded mutation.
5. After all events, assert that no recalled version is active, no erased
   Pattern document is readable, and no affected artifact key remains wrapped.
6. Never set `status = 'available'`.
7. Only then start the Worker.

## Migration

`db/d1/0008_pattern_erasure_replay.sql` is forward-only. It creates the
table and indexes. It does not rebuild a `0007` CHECK. It is not a
crypto break and adds no encrypted column.

`resetDb()` deletes from the table so a leaked test event cannot fail
the next suite’s restore-shaped assertion. The deletion-manifest tests
do not classify it: there is no `user_id` column and no FK to `users`.

## Configuration

- `PATTERN_REPLAY_LEDGER_SIGNING_KEY` — active Ed25519 private key plus
  `signing_key_id`; required for production writers, absent from restore-only
  environments.
- `PATTERN_REPLAY_LEDGER_KEYS` — public verification keyring by
  `signing_key_id`; required outside development.
- Replica R2 binding `PATTERN_REPLAY_LEDGER` — a bucket that operators
  exclude from the D1 restore set by construction (it is not D1).
- `POST /internal/pattern-erasure-replay/sweep` and
  `POST /internal/pattern-erasure-replay/apply` are service-token
  routes. They are specified with the ledger; OpenAPI for them lands
  when the Worker grows the routes, as a later additive amendment.

## Acceptance

A design is implementable when:

1. a signed create-only R2 object commits before the corresponding D1 claim
   transition, and a failed R2 put leaves D1 unchanged;
2. the guarded D1 transition inserts a receipt with non-null `replica_put_at`;
3. a crash between the R2 put and D1 batch leaves an intent that exact retry
   or sweep applies without returning any claim to `available`;
4. a retry derives the same R2 key and adopts the original signed bytes,
   including timestamp and signing-key identity;
5. applying `pattern_deleted` over a restored `accepted` claim erases the
   document and key and leaves the claim `deleted`;
6. applying `ontology_recalled` marks the release recalled, clears its pointer,
   and prevents later ingestion of the tombstoned version;
7. apply never returns a claim to `available`;
8. account deletion writes `account_deleted`, runs the full deletion manifest
   and cryptographic-erasure workflow, removes Pattern claims with the other
   user-owned rows, and leaves only normal proof tombstones plus the replay
   ledger row;
9. `python3 contracts/validate_schemas.py` accepts the event schema
   and its fixtures.

Criterion 23 remains a Slice D drill against this runtime.
