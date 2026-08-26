# Crypto Operator Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make root-KEK rewrap and per-user DEK rotation safe, authenticated, resumable, auditable, and runnable in production.

**Architecture:** Add a versioned root-key keyring and record the wrapping-key id on every `user_keys` row, allowing old and new root keys to coexist during a resumable fleet campaign. A dedicated crypto-operator API advances durable D1 state machines: root-key rewrap updates one live wrapped DEK atomically; DEK rotation freezes the account, waits for quiescence, persists a root-wrapped candidate DEK, re-encrypts bounded chunks, atomically swaps the live key, and only then unfreezes the account.

**Tech Stack:** TypeScript strict ESM, Hono, Cloudflare Workers Web Crypto, D1, Vitest/workerd, operator Node script

## Global Constraints

- Preserve `AEAD_VERSION` and `KEK_DERIVATION_VERSION`; this plan adds root-key identity, not a crypto-version break.
- Keep `ROOT_KEK` as the legacy fallback until every live row has a non-retired keyring id.
- `ROOT_KEK_KEYRING` is a Worker secret with exact shape:

```json
{
  "version": 1,
  "active_key_id": "root-2026-09",
  "keys": {
    "legacy": "<current ROOT_KEK value>",
    "root-2026-09": "<new root secret>"
  }
}
```

- Never place root secrets, wrapped DEKs, candidate DEKs, ciphertext, nonces, crypto subjects, or crypto exception text in requests, responses, logs, audit detail, or D1 plaintext.
- Operator requests name a target key id; secret material is read only from Worker bindings.
- `CRYPTO_OPERATOR_TOKEN` is unique and cannot equal `SERVICE_AUTH_TOKEN`, `PATTERN_ADMIN_TOKEN`, or `CODEX_RUNNER_TOKEN`.
- `/crypto-operator/*` uses `configGuard` plus dedicated crypto auth. It is not mounted beneath the routers carrying `serviceAuth` or Pattern admin auth.
- DEK rotation begins by freezing an active account and waits exactly 300 seconds before touching ciphertext.
- Rotation start also sets `users.crypto_write_fence` atomically. Every
  user-DEK sealing batch reasserts both `crypto_write_fence IS NULL` and the
  exact live key version at commit time; Hono account state alone is not a
  writer fence.
- After the first ciphertext row is re-encrypted, DEK rotation is forward-only. Recovery resumes the operation; it does not cancel or restore mixed rows.
- A post-progress operational error moves to `blocked`, which remains an active
  unique operation and keeps the account fenced/frozen. Only account deletion
  may supersede it, because deletion erases all keys and user rows.
- Every `step` acquires a revision/lease CAS; concurrent steps cannot generate
  or commit competing candidate keys.
- Process at most 75 ciphertext updates in one step, leaving D1 batch headroom for guards and checkpoint writes.
- Keep the old user key live until every registered ciphertext row has moved to the candidate key version.
- Do not start a root-KEK campaign while a DEK rotation is active, and do not
  start a DEK rotation while a root-KEK campaign is running. Retirement checks
  live `user_keys` and every nonterminal candidate wrapper.
- Add every future encrypted column to `ENCRYPTED_COLUMNS`; the operator path never accepts a caller-supplied column list.

## File Map

- `apps/api/src/services/root-kek-keyring.ts`: strict secret parsing and per-row key resolution.
- `apps/api/src/db/crypto-operations.ts`: durable operation/campaign state.
- `apps/api/src/services/crypto-operations.ts`: state-machine orchestration.
- `apps/api/src/middleware/crypto-operator-auth.ts`: dedicated bearer authority.
- `apps/api/src/routes/internal-crypto.ts`: start/step/status routes.
- `scripts/crypto-operations.mjs`: resumable operator client.
- `db/d1/0017_crypto_operations.sql`: root-key id and operation ledgers.
- `docs/deploy/root-kek-rotation.md`: fleet campaign runbook.
- `docs/deploy/user-dek-rotation.md`: single-user rotation runbook.

---

### Task 1: Add root-key identity and dual-key read compatibility

**Files:**
- Create: `db/d1/0017_crypto_operations.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Modify: `contracts/smoke_check.py`
- Create: `apps/api/src/services/root-kek-keyring.ts`
- Create: `apps/api/src/services/root-kek-keyring.test.ts`
- Modify: `apps/api/src/crypto.ts`
- Modify: `apps/api/src/crypto.test.ts`
- Modify: `apps/api/src/db/users.ts`
- Modify: `apps/api/src/db/key-rotation.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`

**Interfaces:**
- Produces: `readRootKekKeyring`, `resolveRootKeyById`, `resolveActiveRootKey`, and `user_keys.root_kek_id`.
- Consumed by: every key load/create plus later operator tasks.

- [ ] **Step 1: Write failing keyring and migration tests**

Cover:

- No keyring + valid `ROOT_KEK` resolves active id `legacy`.
- A valid keyring resolves both `legacy` and `root-2026-09`.
- Active id absent from `keys`, malformed JSON, duplicate/invalid ids, short secrets, or more than four retained keys fail closed.
- A live row naming an absent key id raises `root_kek_id_unavailable`.
- Existing pre-0017 rows acquire `root_kek_id = 'legacy'`.
- A user created under a configured keyring stores the active id.
- Two users wrapped under different ids decrypt in the same Worker invocation.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/services/root-kek-keyring.test.ts src/crypto.test.ts src/db/key-rotation.test.ts src/middleware/config-guard.test.ts
```

Expected: missing `root_kek_id`/keyring APIs.

- [ ] **Step 3: Add the schema-first migration**

The first statement adds:

```sql
ALTER TABLE user_keys ADD COLUMN root_kek_id TEXT NOT NULL DEFAULT 'legacy'
  CHECK (
    length(root_kek_id) BETWEEN 1 AND 64
    AND root_kek_id NOT GLOB '*[^A-Za-z0-9._-]*'
  );

CREATE INDEX idx_user_keys_live_root_kek
  ON user_keys(root_kek_id, user_id)
  WHERE destroyed_at IS NULL;
```

The same migration creates the operation tables specified in Task 2 so no later runtime commit needs a second schema number. Append the non-crypto-break explanation to `MIGRATIONS.json` and prove populated `user_keys` rows retain byte-identical wrapped DEKs and gain only `root_kek_id = 'legacy'`.
Extend `contracts/smoke_check.py` with the new `users`/`user_keys` columns,
operation/campaign tables, active-operation/index predicates, and foreign-key
checks.

- [ ] **Step 4: Implement strict keyring parsing**

Expose:

```ts
export interface ResolvedRootKekKeyring {
  activeKeyId: string;
  keyIds: readonly string[];
  resolve(keyId: string): Promise<CryptoKey>;
}

export function readRootKekKeyring(
  env: Pick<Env, "ROOT_KEK" | "ROOT_KEK_KEYRING">,
): { ok: true; value: ResolvedRootKekKeyring } | {
  ok: false;
  code: "root_kek_not_configured" | "root_kek_keyring_invalid";
};
```

Parse fields explicitly; do not spread secret JSON. Permit 1–4 keys. A key id matches `^[A-Za-z0-9._-]{1,64}$`; every secret meets the existing root-key minimum. When no keyring exists, synthesize `{ activeKeyId: "legacy" }` from `ROOT_KEK`.

- [ ] **Step 5: Thread `root_kek_id` through key reads and writes**

Update live-key selectors and `loadUserKey` to select the id and resolve that specific root key. New user keys and new DEK versions use `activeKeyId`. Existing `rewrapUserKey` becomes:

```ts
export async function rewrapUserKey(
  env: Env,
  id: UserIdentity,
  targetRootKekId: string,
): Promise<{ keyVersion: number; rootKekId: string; changed: boolean }>;
```

It unwraps with the row’s current id, wraps with the target id, and performs one guarded update:

```sql
UPDATE user_keys
SET wrapped_dek = ?, root_kek_id = ?, rotated_at = ?
WHERE user_id = ? AND key_version = ? AND destroyed_at IS NULL
  AND root_kek_id = ? AND wrapped_dek = ?
```

No root secret crosses the function boundary.

- [ ] **Step 6: Extend secure configuration**

Add `ROOT_KEK_KEYRING?: string` to `Env`. Outside development, accept a valid legacy root, a valid keyring, or both; reject a keyring that cannot resolve its active id. Keep `ROOT_KEK` required until the operator runbook has retired `legacy`.

- [ ] **Step 7: Run focused verification**

```bash
npm exec -w @patternlike/api -- vitest run src/services/root-kek-keyring.test.ts src/crypto.test.ts src/db/key-rotation.test.ts src/middleware/config-guard.test.ts
npm run typecheck -w @patternlike/api
```

Expected: all pass.

- [ ] **Step 8: Commit and apply migration before runtime**

Commit the SQL/manifest/test-harness changes separately:

```bash
git add db/d1/0017_crypto_operations.sql db/d1/MIGRATIONS.json apps/api/test/apply-migrations.ts contracts/smoke_check.py
git commit -m "db: add crypto operation state"
```

After 0017 is applied, commit keyring runtime:

```bash
git add apps/api/src/services/root-kek-keyring.ts apps/api/src/services/root-kek-keyring.test.ts apps/api/src/crypto.ts apps/api/src/crypto.test.ts apps/api/src/db/users.ts apps/api/src/db/key-rotation.test.ts apps/api/src/env.ts apps/api/src/middleware/config-guard.ts apps/api/src/middleware/config-guard.test.ts apps/api/test/hermetic-bindings.ts
git commit -m "api: resolve versioned root encryption keys"
```

---

### Task 2: Freeze the durable crypto-operation state machines

**Files:**
- Create: `apps/api/src/db/crypto-operations.ts`
- Create: `apps/api/src/db/crypto-operations.test.ts`
- Create: `apps/api/src/services/crypto-operations.ts`
- Create: `apps/api/src/services/crypto-operations.test.ts`
- Create: `apps/api/src/db/crypto-write-fence.ts`
- Create: `apps/api/src/db/crypto-write-fence.test.ts`
- Modify: `apps/api/src/db/users.ts`
- Modify: `apps/api/src/routes/birth.ts`
- Modify: `apps/api/src/db/generation.ts`
- Modify: `apps/api/src/db/feedback.ts`
- Modify: `apps/api/src/db/check-ins.ts`
- Modify: `apps/api/src/db/context-sources.ts`
- Modify: `apps/api/src/db/consents.ts`
- Modify: `apps/api/src/db/preferences.ts`
- Modify: `apps/api/src/db/life-events.ts`
- Modify: `apps/api/src/db/topic-exclusions.ts`
- Modify: `apps/api/src/db/privacy-jobs.ts`
- Modify: `apps/api/src/db/deletion-jobs.ts`
- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `apps/api/src/services/reading-invalidation.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/account-deletion.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`

**Interfaces:**
- Produces: `startDekRotation`, `stepDekRotation`, `createKekRewrapCampaign`, `stepKekRewrapCampaign`.
- Consumed by: Task 4’s routes.

- [ ] **Step 1: Complete the 0017 schema**

`crypto_operations` carries no plaintext key material:

```sql
ALTER TABLE users ADD COLUMN crypto_write_fence TEXT
  CHECK (
    crypto_write_fence IS NULL
    OR (
      crypto_write_fence GLOB 'cop_[0-9a-f]*'
      AND length(crypto_write_fence) = 36
    )
  );

CREATE TABLE crypto_operations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'dek_rotate'),
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_hash TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'quiescing', 'reencrypting', 'finalizing', 'verifying',
    'blocked', 'succeeded', 'failed', 'abandoned_to_deletion'
  )),
  original_account_status TEXT NOT NULL CHECK (
    original_account_status IN ('active', 'frozen')
  ),
  previous_key_version INTEGER,
  candidate_key_version INTEGER,
  candidate_wrapped_dek BLOB,
  candidate_root_kek_id TEXT,
  reencrypted_count INTEGER NOT NULL DEFAULT 0
    CHECK (reencrypted_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  not_before TEXT NOT NULL,
  error_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (kind, user_id, idempotency_hash),
  CHECK (stage != 'failed' OR reencrypted_count = 0),
  CHECK (
    (lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_crypto_operations_active_user
  ON crypto_operations(user_id)
  WHERE stage IN (
    'quiescing','reencrypting','finalizing','verifying','blocked'
  );
```

Add:

```sql
CREATE TABLE crypto_kek_rewrap_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1),
  idempotency_hash TEXT NOT NULL UNIQUE,
  target_root_kek_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','blocked','completed')),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_crypto_kek_rewrap_active
  ON crypto_kek_rewrap_campaigns(singleton)
  WHERE status IN ('running','blocked');

CREATE TABLE crypto_kek_rewrap_items (
  campaign_id TEXT NOT NULL REFERENCES crypto_kek_rewrap_campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source_root_kek_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','blocked')),
  error_class TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
```

Index pending items by `(campaign_id, status, user_id)`.

- [ ] **Step 2: Write failing state-machine tests**

Prove:

- Starting a DEK rotation freezes one active user, records original status, and is idempotent by hash.
- Rotation start sets the user’s write fence in the same batch.
- `pending_deletion` and `deleted` users are refused.
- A step before `not_before` does no work.
- Queued jobs do not deadlock quiescence and remain available after unfreeze.
- Unexpired running/leased jobs keep the operation in `quiescing`; expired
  leases do not block and remain untouched for ordinary reclaim after unfreeze.
- 150+ encrypted rows complete over multiple 75-row steps.
- A crash after a committed chunk resumes without re-encrypting that chunk.
- Concurrent step calls acquire one lease/revision winner and cannot persist two candidate keys.
- A pre-progress failure may become `failed`; a post-progress failure becomes active `blocked` and can resume.
- The old user key remains live through every re-encryption step.
- Finalization refuses any registered row still naming the old version.
- Finalization swaps keys and operation stage in one D1 batch.
- Root campaign steps converge under replay and never count a user twice.
- The database refuses a second running/blocked campaign.
- Restoring a missing source key and explicitly retrying moves only resolvable
  blocked items back to pending.
- Root campaigns and DEK rotations refuse to overlap.
- Campaign completion/retirement counts both live user keys and nonterminal candidate wrappers.
- A missing target/source key id fails the item without exposing why publicly.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/db/crypto-operations.test.ts src/services/crypto-operations.test.ts
```

Expected: missing modules/state.

- [ ] **Step 4: Fence every user-DEK sealing batch**

Expose:

```ts
export function buildCryptoWriteFence(
  env: Env,
  input: {
    userId: string;
    keyVersion: number;
    allowedStatuses: readonly AccountStatus[];
  },
): D1PreparedStatement;

export function requireSingleCryptoWriteVersion(
  versions: readonly number[],
): number;
```

The `assertion_probe` statement requires, at commit time:

```sql
users.crypto_write_fence IS NULL
AND user_keys.key_version = ?
AND user_keys.destroyed_at IS NULL
AND users.status IN (...)
```

Prepend it to every batch that commits newly sealed user-DEK bytes:

- `routes/birth.ts`;
- `db/generation.ts`;
- `db/feedback.ts`;
- `db/check-ins.ts`;
- `db/context-sources.ts`;
- `db/consents.ts`;
- `db/preferences.ts`;
- `db/life-events.ts`;
- `db/topic-exclusions.ts`;
- `db/privacy-jobs.ts`;
- `db/deletion-jobs.ts`;
- `services/pattern-enqueue.ts`;
- `services/reading-invalidation.ts`;
- `services/pattern-execute.ts`.

For batches that seal more than one payload, first call
`requireSingleCryptoWriteVersion`. Mixed versions mean rotation crossed the
encryption phase; discard those in-memory ciphertexts and retry the whole
domain operation after the fence clears. Never guard only the maximum version.

Use `active` for ordinary product/generation publication. Export may retain its
existing `active|frozen` account policy only when no crypto fence exists.
Account deletion is the sole exception: its reservation batch may atomically
change the account to `pending_deletion`, mark any active rotation
`abandoned_to_deletion`, and then write its deletion command. Before
`deleteUserRows`, the deletion path must null every candidate wrapped DEK under
a deletion-only CHECK, then erase every `user_keys` row; only afterwards may it
delete operation rows.

Add a source-inventory test that enumerates the production writers for every
`ENCRYPTED_COLUMNS` entry and fails when a new sealing writer is not registered
with a fence policy. Queue and scheduled callers are covered at their shared DB
write functions, not in Hono middleware.

- [ ] **Step 5: Implement DEK rotation start and quiescence**

Expose:

```ts
export const DEK_ROTATION_QUIESCENCE_MS = 300_000;
export const DEK_ROTATION_BATCH_SIZE = 75;

export async function startDekRotation(
  env: Env,
  input: {
    userId: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<CryptoOperationView>;

export async function stepDekRotation(
  env: Env,
  operationId: string,
  now?: Date,
): Promise<CryptoOperationView>;
```

`startDekRotation` hashes the idempotency key and atomically creates the
operation, changes `users.status` from `active` to `frozen`, and sets
`users.crypto_write_fence = operation.id`. An already-frozen account remains
frozen after success; pending-deletion/deleted accounts are refused.

At/after `not_before`, query all job/domain tables that can write encrypted
user state. Queue claim predicates must require
`users.crypto_write_fence IS NULL`, so queued work cannot start and does not
block rotation. Remain in `quiescing` only for unexpired running/leased work.
Leave expired rows in their domain state. Their stale executors cannot commit
because claim-token CAS plus the crypto write fence fails, and their ordinary
claim path can reclaim them after the fence clears. Tests must prove expired
daily, Pattern, and export leases remain reclaimable after successful rotation.
Do not rely on the Hono account gate to stop queue consumers.

Every step first claims the operation by CAS on `revision` plus an absent or
expired lease. Every subsequent stage/chunk/finalization statement guards that
revision and the hash of the fresh lease token; release the lease in the same
batch as progress. A zero-row claim does no work.

- [ ] **Step 6: Persist one candidate DEK and re-encrypt bounded chunks**

On the first eligible step:

1. Load the old live key.
2. Generate one candidate DEK and `candidate_key_version = old + 1`.
3. Wrap it under the active root-key id using the existing DEK AAD.
4. Persist only packed wrapped bytes and the wrapping-key id.
5. Move stage to `reencrypting`.

Every later step unwraps that candidate and scans `ENCRYPTED_COLUMNS` in declared order for rows still at `previous_key_version`, collecting at most 75. Reuse the existing AAD field/record-id definitions exactly. Each update guards owner, record id, old key version, ciphertext, nonce, operation lease, and `users.crypto_write_fence = operation.id`. Commit updates plus `reencrypted_count`, revision advance, and lease release in one batch.

Before `reencrypted_count > 0`, a non-retryable error may mark `failed` and
clear the fence/restore account status. Afterwards, every error records a safe
class and moves to `blocked`; it must retain candidate bytes, the fence, the
frozen account, and its active-operation uniqueness so the same operation can
resume.

- [ ] **Step 7: Finalize atomically**

When no old-version rows remain, one D1 batch:

1. Arms `assertion_probe` for each `ENCRYPTED_COLUMNS` entry if an old-version row exists.
2. Runs the existing `UNWRITTEN_ENCRYPTED_COLUMNS` tripwire.
3. Marks the old `user_keys` row destroyed.
4. Inserts the persisted candidate as the one live key with its `root_kek_id`.
5. Moves the operation to `verifying`.

The next leased/idempotent step loads the new live key, re-runs
stale-version/tripwire checks, marks the operation succeeded, clears
`candidate_wrapped_dek`, clears `users.crypto_write_fence`, and restores
`users.status` only when `original_account_status = 'active'`.

- [ ] **Step 8: Implement fleet key rewrap**

Creating a campaign requires `target_root_kek_id === active_key_id`, refuses while
any DEK operation is active, and snapshots every live key whose
`root_kek_id` differs into campaign items. DEK rotation start likewise refuses
while a campaign is running/blocked. Each campaign step reasserts the target is
still the active key, claims one revision lease, selects at most 25 pending
items, calls guarded `rewrapUserKey`, records
item results, and derives aggregate counts from items rather than incrementing
counters optimistically. A blocked item remains blocked until
`retryBlockedKekRewrapItems` verifies both its source id and the campaign target
id resolve in the current keyring, then moves it to pending under campaign
revision CAS. This transition requires the explicit operator confirmation
`RETRY_BLOCKED_KEK_ITEMS`.

Campaign completion requires:

```sql
SELECT COUNT(*) = 0
FROM user_keys
WHERE destroyed_at IS NULL AND root_kek_id <> ?
```

Completion and the runbook’s retirement preflight also require zero nonterminal
`crypto_operations` rows whose `candidate_root_kek_id` differs from the target.
Never delete or retire a key from inside the Worker.

- [ ] **Step 9: Register deletion and portability**

`crypto_operations` and `crypto_kek_rewrap_items` are deleted/non-portable user-owned operational state. `crypto_kek_rewrap_campaigns` has no `user_id` and is retained as system audit state. Terminal operations must hold no candidate wrapped bytes after account deletion or success.

- [ ] **Step 10: Run focused verification and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/db/crypto-operations.test.ts src/db/crypto-write-fence.test.ts src/services/crypto-operations.test.ts src/db/key-rotation.test.ts src/db/encrypted-columns.test.ts src/services/deletion-manifest.test.ts
npm run typecheck -w @patternlike/api
```

```bash
git add apps/api/src/db/crypto-operations.ts apps/api/src/db/crypto-operations.test.ts apps/api/src/db/crypto-write-fence.ts apps/api/src/db/crypto-write-fence.test.ts apps/api/src/services/crypto-operations.ts apps/api/src/services/crypto-operations.test.ts apps/api/src/db/users.ts apps/api/src/routes/birth.ts apps/api/src/db/generation.ts apps/api/src/db/feedback.ts apps/api/src/db/check-ins.ts apps/api/src/db/context-sources.ts apps/api/src/db/consents.ts apps/api/src/db/preferences.ts apps/api/src/db/life-events.ts apps/api/src/db/topic-exclusions.ts apps/api/src/db/privacy-jobs.ts apps/api/src/db/deletion-jobs.ts apps/api/src/services/pattern-enqueue.ts apps/api/src/services/reading-invalidation.ts apps/api/src/services/pattern-execute.ts apps/api/src/services/account-deletion.ts apps/api/test/helpers.ts apps/api/src/services/deletion-manifest.ts apps/api/src/services/deletion-manifest.test.ts
git commit -m "api: add resumable encryption key operations"
```

---

### Task 3: Add dedicated crypto-operator authentication

**Files:**
- Create: `apps/api/src/middleware/crypto-operator-auth.ts`
- Create: `apps/api/src/middleware/crypto-operator-auth.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/src/services/safe-log.test.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`

**Interfaces:**
- Produces: `cryptoOperatorAuth`.
- Consumed by: Task 4 router.

- [ ] **Step 1: Write failing authority-separation tests**

Assert production returns:

- `503 crypto_operator_auth_not_configured` when absent.
- `401 unauthorized` for no token, `SERVICE_AUTH_TOKEN`, `PATTERN_ADMIN_TOKEN`, and `CODEX_RUNNER_TOKEN`.
- Success only for the dedicated token.
- `503 configuration_error` when any two operator authorities alias.

- [ ] **Step 2: Implement the middleware**

Mirror the dedicated Codex-runner middleware shape, including request-id setup and 32–512 character token bounds. Add:

```ts
CRYPTO_OPERATOR_TOKEN?: string;
ROOT_KEK_KEYRING?: string;
```

to `Env`. Add `crypto_operator_authority_aliased` to `ConfigurationCode`. Safe-log auth/config events contain only closed failure classes.

- [ ] **Step 3: Verify and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/middleware/crypto-operator-auth.test.ts src/middleware/config-guard.test.ts src/services/safe-log.test.ts
```

```bash
git add apps/api/src/middleware/crypto-operator-auth.ts apps/api/src/middleware/crypto-operator-auth.test.ts apps/api/src/env.ts apps/api/src/middleware/config-guard.ts apps/api/src/middleware/config-guard.test.ts apps/api/src/services/safe-log.ts apps/api/src/services/safe-log.test.ts apps/api/test/hermetic-bindings.ts
git commit -m "api: isolate crypto operator authority"
```

---

### Task 4: Expose strict start, step, and status routes

**Files:**
- Create: `apps/api/src/routes/internal-crypto.ts`
- Create: `apps/api/src/routes/internal-crypto.integration.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/scripts/wrangler-config.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `POST /crypto-operator/dek-rotations`
  - `POST /crypto-operator/dek-rotations/{operation_id}/step`
  - `GET /crypto-operator/dek-rotations/{operation_id}`
  - `POST /crypto-operator/kek-rewrap-campaigns`
  - `POST /crypto-operator/kek-rewrap-campaigns/{campaign_id}/step`
  - `POST /crypto-operator/kek-rewrap-campaigns/{campaign_id}/retry-blocked`
  - `GET /crypto-operator/kek-rewrap-campaigns/{campaign_id}`

- [ ] **Step 1: Write failing integration tests**

Drive the exported Worker. Verify authority separation, strict bodies, idempotent replay, owner/account eligibility, quiescence, multi-step completion, generic errors, and audit rows.

- [ ] **Step 2: Define strict request bodies**

```ts
interface StartDekRotationRequest {
  schema_version: "crypto-operations/v1";
  user_id: string;
  idempotency_key: string;
  confirm: "ROTATE_USER_DEK";
  reason_class: "scheduled" | "incident_response" | "compliance";
}

interface StartKekCampaignRequest {
  schema_version: "crypto-operations/v1";
  target_root_kek_id: string;
  idempotency_key: string;
  confirm: "REWRAP_ROOT_KEK";
}

interface RetryBlockedKekItemsRequest {
  schema_version: "crypto-operations/v1";
  confirm: "RETRY_BLOCKED_KEK_ITEMS";
}
```

Reject unknown keys. Responses expose operation/campaign id, closed stage/status, counts, timestamps, and safe error class only. They never expose `crypto_subject`, key versions’ wrapped bytes, or key ids other than the explicitly requested root-key id.

- [ ] **Step 3: Mount a sibling router**

In `index.ts`, use a top-level path family so neither `/internal` wildcard
middleware nor the Pattern `/admin` wildcard middleware can acquire authority:

```ts
const cryptoOperator = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();
cryptoOperator.use("*", configGuard);
cryptoOperator.use("*", cryptoOperatorAuth);
cryptoOperator.route("/", internalCryptoRoutes);
app.route("/crypto-operator", cryptoOperator);
```

Add `"/crypto-operator/*"` to production `assets.run_worker_first` and its
exact config test. Do not route through `/internal` or `/admin`.

- [ ] **Step 4: Write audit events**

Write `audit_events` for start, success, refusal, and campaign completion. Use `actor_type = 'service'`, resource id/type, and closed `detail_class`; never place reason text or key material in detail.

- [ ] **Step 5: Run integration verification and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/routes/internal-crypto.integration.test.ts src/middleware/crypto-operator-auth.test.ts src/services/crypto-operations.test.ts
npm run test:wrangler-config -w @patternlike/api
npm run typecheck -w @patternlike/api
```

```bash
git add apps/api/src/routes/internal-crypto.ts apps/api/src/routes/internal-crypto.integration.test.ts apps/api/src/index.ts apps/api/wrangler.toml apps/api/scripts/wrangler-config.test.ts
git commit -m "api: expose resumable crypto operator routes"
```

---

### Task 5: Add resumable operator tooling and runbooks

**Files:**
- Create: `scripts/crypto-operations.mjs`
- Create: `scripts/crypto-operations.test.mjs`
- Create: `docs/deploy/root-kek-rotation.md`
- Create: `docs/deploy/user-dek-rotation.md`
- Modify: `docs/deploy/api-production.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write failing CLI protocol tests**

Test command parsing and HTTP fixtures without real secrets:

```bash
node --test scripts/crypto-operations.test.mjs
```

Support:

```text
node scripts/crypto-operations.mjs dek-rotate --user-id <usr_...> --reason scheduled
node scripts/crypto-operations.mjs kek-campaign --target-root-key root-2026-09
node scripts/crypto-operations.mjs resume --operation-id <cop_...>
node scripts/crypto-operations.mjs resume --campaign-id <ckc_...>
node scripts/crypto-operations.mjs retry-blocked --campaign-id <ckc_...>
```

Read origin/token from environment. Never accept root secrets as CLI flags.

- [ ] **Step 2: Implement bounded polling**

The script persists the returned operation/campaign id to a mode-0600 file outside the repository, sends one `step` at a time, prints only stage/count/timestamps, and exits non-zero on terminal failure. It can resume with the id after process interruption.

- [ ] **Step 3: Write the root-key runbook**

Exact sequence:

1. D1 bookmark and external SQL export.
2. Add `ROOT_KEK_KEYRING` containing `legacy` plus the new key; set the new id active; retain `ROOT_KEK`.
3. Deploy and verify old/new test users decrypt.
4. Start and drain a campaign targeting the new id.
5. Verify campaign blocked items are zero, query zero live keys naming another
   id, and query zero nonterminal candidate wrappers naming another id.
6. Remove the old id from the keyring.
7. Remove legacy `ROOT_KEK` only after zero live `legacy` rows and one full product smoke test.

Rollback before old-key retirement first deploys the keyring with the old id as
`active_key_id`, then starts a campaign targeting that id. After retirement,
restore the retired secret and make its id active before creating the rollback
campaign.

- [ ] **Step 4: Write the DEK runbook**

Require the operation id, D1 bookmark, account status, quiescence, step/resume commands, final key-version check, decrypt smoke test, audit row, and account-status restoration. State explicitly that interruption after re-encryption begins is forward-repair only.

- [ ] **Step 5: Verify docs/tooling and commit**

```bash
node --test scripts/crypto-operations.test.mjs
git diff --check
rg -n "ROOT_KEK.*(echo|console|print)|previous_root|wrapped_dek" scripts/crypto-operations.mjs
```

Expected: tests pass; no secret-printing path.

```bash
git add scripts/crypto-operations.mjs scripts/crypto-operations.test.mjs docs/deploy/root-kek-rotation.md docs/deploy/user-dek-rotation.md docs/deploy/api-production.md CLAUDE.md
git commit -m "ops: add encryption key rotation runbooks"
```

## Definition of Done

- [ ] Existing users decrypt through `root_kek_id = legacy`.
- [ ] Mixed root-key ids decrypt concurrently through the keyring.
- [ ] A fleet rewrap campaign is durable, resumable, idempotent, and reversible before key retirement.
- [ ] Old root-key retirement is blocked while any live row or nonterminal candidate wrapper names it.
- [ ] DEK rotation handles more than 100 encrypted rows in bounded batches.
- [ ] Every user-DEK sealing batch asserts an absent write fence and its exact live key version.
- [ ] Concurrent step calls have one lease/revision winner.
- [ ] The account remains frozen and the old DEK remains live until atomic finalization.
- [ ] Interrupted mixed-version rotation remains active/blocked and resumes to completion.
- [ ] Root-key campaigns and DEK rotations cannot overlap.
- [ ] Dedicated auth rejects every other repository authority.
- [ ] Operator requests/responses/logs contain no key material or crypto exceptions.
- [ ] Account deletion covers user-owned crypto operation rows.
- [ ] Both runbooks are rehearsed against local D1 with two root-key ids.
