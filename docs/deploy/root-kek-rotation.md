# Root KEK rotation

This runbook rewraps live user DEKs; it does not decrypt or re-encrypt product
payloads. Keep every old root key available until the retirement checks are
zero. Cloudflare secrets are write-only, so the password-manager copy is part
of the recovery system.

## Preconditions

- An external, mode-0600 D1 SQL export and a Time Travel bookmark exist.
- `CRYPTO_OPERATOR_TOKEN` is stored on the Worker and available to the operator
  only through the operator environment.
- `CRYPTO_OPERATOR_ORIGIN` names the HTTPS Worker origin.
- Migration `0021_crypto_operations.sql` is applied before the Worker exposing
  `/crypto-operator/*` is deployed.

Record the pre-change Worker version, D1 bookmark, export location, active root
key id, and intended target id in the change ticket. Never record root secrets.

## Forward rotation

1. Build `ROOT_KEK_KEYRING` in the password manager. It must contain `legacy`
   plus the new root key, with the new id in `active_key_id`. Retain the
   existing `ROOT_KEK` secret during this phase.
2. Store the JSON as the `ROOT_KEK_KEYRING` Worker secret and deploy. Do not put
   the JSON or either secret on a command line.
3. Verify one pre-change user and one newly created canary can decrypt their
   chart and reading data.
4. Start and drain the campaign:

   ```bash
   node scripts/crypto-operations.mjs kek-campaign \
     --target-root-key root-2026-09
   ```

   If the process is interrupted, resume the persisted campaign id:

   ```bash
   node scripts/crypto-operations.mjs resume --campaign-id ckc_<id>
   ```

   Restore a missing source key in `ROOT_KEK_KEYRING`, deploy it, then retry
   resolvable blocked items with:

   ```bash
   node scripts/crypto-operations.mjs retry-blocked --campaign-id ckc_<id>
   ```

5. Require all three D1 checks to be zero. Substitute the reviewed target id:

   ```sql
   SELECT blocked_count
   FROM crypto_kek_rewrap_campaigns
   WHERE id = 'ckc_<id>';

   SELECT COUNT(*) AS live_keys_on_another_root
   FROM user_keys
   WHERE destroyed_at IS NULL AND root_kek_id <> 'root-2026-09';

   SELECT COUNT(*) AS candidate_wrappers_on_another_root
   FROM crypto_operations
   WHERE stage IN ('quiescing','reencrypting','finalizing','verifying','blocked')
     AND candidate_root_kek_id IS NOT NULL
     AND candidate_root_kek_id <> 'root-2026-09';
   ```

6. Remove the old id from `ROOT_KEK_KEYRING`, store the revised secret, deploy,
   and repeat the old/new user decrypt smoke test.
7. Remove legacy `ROOT_KEK` only after there are zero live `legacy` rows and a
   full product smoke test succeeds on the deployed Worker.

## Rollback

Before old-key retirement, deploy the keyring with the old id restored as
`active_key_id`, then start a campaign targeting that id. After retirement,
first restore the retired secret and deploy a keyring containing it and naming
it active; only then create the rollback campaign. A campaign cannot recover a
secret that is absent from the keyring.

