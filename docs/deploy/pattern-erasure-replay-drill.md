# Pattern erasure replay restore drill

**Gate:** Existing Gate 9 restore-drill criterion

**Status:** Procedure ready; execution awaits the accepted Gate 8 canary whose
deletion and consumed claim must be restored and replayed.

This drill proves that restoring D1 to a point before a Pattern lifecycle
erasure cannot resurrect readable Pattern content or make its fingerprint
eligible for another generation. Keep `PATTERN_AI_ROLLOUT=off` throughout the
drill and route no production traffic to the disposable restore environment.

## Evidence boundaries

Record only Worker versions, D1 bookmarks, event/object hashes, aggregate
counts, HTTP statuses, terminal claim states, and the before/after provider-call
counter. Do not record account IDs, chart facts, fingerprints, packets, plans,
prompts, generated prose, verifier rationale, secrets, or signing keys.

Use:

- a pre-erasure D1 bookmark from the accepted Gate 8 canary;
- disposable D1 and artifact-store clones that receive no traffic;
- the durable production replay bucket, which is outside D1 Time Travel; and
- a traffic-disabled replay Worker that has only the replay public keyring,
  service authentication, and bindings required to verify and apply events.

The restore Worker must not hold the replay private signing key or an OpenAI
credential.

## Procedure

1. Record the production Worker version, the pre-erasure D1 bookmark, replay
   bucket inventory hash/count, and Pattern provider-call counter.
2. Delete the accepted Gate 8 Pattern through its normal reader route. Confirm
   the signed `pattern_deleted` object exists before its D1 receipt and record
   only the event hash and resulting terminal state.
3. Restore the pre-erasure bookmark into the disposable D1 clone and copy the
   corresponding encrypted artifacts into the disposable artifact clone. Do
   not attach either clone to a traffic-serving Worker.
4. Deploy the traffic-disabled replay Worker against the disposable clones and
   the durable replay bucket. Call
   `POST /internal/pattern-erasure-replay/apply` with exact body `{}`.
5. Call the same route again. Both applications must succeed idempotently, and
   every replica object must pass its content-hash and Ed25519 verification
   before any D1 mutation.
6. Against the disposable restore, prove the Pattern read refuses, Pattern
   state is terminal rather than `available`, the affected artifact key is no
   longer wrapped, and a reservation for the same fingerprint returns
   `409 pattern_already_consumed`.
7. Confirm the provider-call counter did not change.
8. Repeat the restore-and-apply assertion for the existing
   `chart_correction_erased`, `pattern_withdrawn`/`ontology_recalled`, and
   `account_deleted` event classes using their normal lifecycle operations.
   Account events must apply last and leave only the normal deletion proof and
   replay receipt.
9. Record the final replica inventory hash/count, applied/replayed counts,
   terminal-state assertions, HTTP statuses, provider-call delta, and Worker
   version in the Gate 9 evidence row.
10. Destroy only the disposable drill Worker, D1 clone, and artifact clone.
    Retain the production replay objects and normal deletion evidence.

## Pass criteria

The existing Gate 9 replay criterion passes only when:

- every replay object verifies before mutation;
- applying all objects twice is idempotent;
- no erased Pattern is readable after restore;
- no affected claim is `available` and the prior fingerprint cannot reserve;
- no affected artifact key remains wrapped;
- recalled ontology versions are not active;
- account deletion cannot be reversed by the restored snapshot; and
- the provider-call delta is zero.

Any failed signature/hash, readable restored Pattern, available affected claim,
wrapped erased key, active recalled ontology, non-idempotent application, or
provider call fails the existing Gate 9 criterion. Keep rollout off and retain
the disposable environment for diagnosis.
