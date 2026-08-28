# User DEK rotation

Use this procedure for a single account. The operation freezes the account,
installs an atomic ciphertext-write fence, waits five minutes for live work,
and re-encrypts at most 75 rows per step. Once re-encryption has committed,
recovery is forward-only; do not restore an old database snapshot over a
partially rotated live database.

## Preconditions

- Record an external, mode-0600 D1 SQL export and Time Travel bookmark.
- Record the user id, current account status, current live key version, Worker
  version, and audit window. Do not record wrapped key bytes.
- Confirm migration `0021_crypto_operations.sql` is applied and the deployed
  Worker serves `/crypto-operator/*` only through `CRYPTO_OPERATOR_TOKEN`.
- Check that no root-KEK campaign is running or blocked.

## Start and drain

```bash
node scripts/crypto-operations.mjs dek-rotate \
  --user-id usr_<id> \
  --reason scheduled
```

The CLI persists the operation id in an owner-only state file outside the
repository. On interruption, resume explicitly:

```bash
node scripts/crypto-operations.mjs resume --operation-id cop_<id>
```

During `quiescing`, verify the account is frozen and
`users.crypto_write_fence` equals the operation id. An unexpired running job
must keep the operation quiescing. Expired work remains available for normal
reclaim after the account is restored.

If the operation reports `blocked`, preserve the database and both root keys,
repair the reported closed error class, and resume the same operation id. Never
start a replacement rotation for that user.

## Completion checks

Require all of the following before closing the change:

```sql
SELECT stage, reencrypted_count, error_class, completed_at
FROM crypto_operations WHERE id = 'cop_<id>';

SELECT status, crypto_write_fence
FROM users WHERE id = 'usr_<id>';

SELECT key_version, destroyed_at, erased_at
FROM user_keys WHERE user_id = 'usr_<id>' ORDER BY key_version;

SELECT action, result, detail_class, created_at
FROM audit_events
WHERE resource_id = 'cop_<id>'
ORDER BY created_at;
```

The operation must be `succeeded`; the fence must be null; account status must
match its pre-rotation active/frozen state; exactly one newest key must be live;
and the prior key must be destroyed. Finish with an authenticated chart,
reading, preferences, and Pattern decrypt smoke test for the account.

Account deletion is the sole exception: it atomically changes the account to
`pending_deletion`, marks the active rotation `abandoned_to_deletion`, clears
candidate wrapped bytes, and proceeds with cryptographic erasure.

