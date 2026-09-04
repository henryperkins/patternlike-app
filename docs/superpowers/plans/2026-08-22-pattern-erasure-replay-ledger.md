# Pattern Erasure Replay Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Pattern claim consumption and erasure durable outside D1, then replay those signed intents after a pre-erasure restore before consumer traffic starts.

**Architecture:** Each lifecycle boundary first creates or adopts one deterministic, signed, content-free event in a dedicated R2 bucket. The caller then includes the matching immutable D1 receipt in the same guarded batch that changes live state. A service-authenticated replayer verifies every R2 object, applies events monotonically, and never moves a claim to `available`.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, R2 conditional writes, WebCrypto Ed25519, TypeScript, Vitest with `@cloudflare/vitest-pool-workers`, JSON Schema/Ajv.

**Spec:** `docs/superpowers/specs/2026-08-16-pattern-replay-ledger-design.md`

## Global Constraints

- R2 key prefix is exactly `pattern-erasure-replay/`; the bucket is a new `PATTERN_REPLAY_LEDGER` binding and is not `ARTIFACTS`.
- R2 create/adopt completes before any D1 lifecycle mutation.
- Events contain identifiers and closed statuses only—never prose, prompts, packets, plans, chart data, ciphertext, or provider output.
- Event bytes are canonical JSON. `content_hash` and Ed25519 signature cover the canonical event without `content_hash` and `signature`.
- Event identity is `prel_` plus 32 lowercase hex characters derived from the semantic operation key.
- `PATTERN_REPLAY_LEDGER_SIGNING_KEY` is private writer material; `PATTERN_REPLAY_LEDGER_KEYS` contains public verification keys and is sufficient for a restore environment.
- Replay may suppress content or consume a claim conservatively; it may never restore content, reset a consumed claim, or assign `available`.
- All behavior changes follow red/green TDD. Production remains rollout-off until the full repository gate passes and runtime secrets are provisioned.

---

### Task 1: Signed create-only replica boundary

**Files:**
- Create: `apps/api/src/services/pattern-replay-ledger.ts`
- Create: `apps/api/src/services/pattern-replay-ledger.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/hermetic-bindings.ts`
- Modify: `apps/api/wrangler.toml`

**Interfaces:**
- Consumes: `jcsCanonicalize`, `contentHash`, the frozen M7 replay-event schema, `Env.PATTERN_REPLAY_LEDGER`, `PATTERN_REPLAY_LEDGER_SIGNING_KEY`, and `PATTERN_REPLAY_LEDGER_KEYS`.
- Produces:

```ts
export type PatternReplayEventClass =
  | "claim_consumed"
  | "pattern_deleted"
  | "chart_correction_erased"
  | "pattern_withdrawn"
  | "ontology_recalled"
  | "account_deleted";

export interface PatternReplayIntentInput {
  eventClass: PatternReplayEventClass;
  semanticOperationKey: string;
  targetUserId: string | null;
  chartFingerprintHash: string | null;
  claimId: string | null;
  generationId: string | null;
  patternId: string | null;
  ontologyVersion: string | null;
  priorClaimStatus: PatternClaimStatus | null;
  nextClaimStatus: Exclude<PatternClaimStatus, "available" | "reserved"> | null;
}

export async function writePatternReplayIntent(
  env: Env,
  input: PatternReplayIntentInput,
  now?: Date,
): Promise<PreparedPatternReplayEvent>;
```

- `PreparedPatternReplayEvent.receiptStatements(env)` returns an idempotent receipt insert plus an assertion statement proving every stored D1 field matches the signed event.

- [ ] **Step 1: Write failing parsing and signature tests**

Cover exact key shape, malformed base64url, unknown public key, wrong signature, changed semantic field, changed `content_hash`, and any schema-extra field. Generate Ed25519 keys inside the tests; never hard-code private material.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm exec -w @patternlike/api -- vitest run src/services/pattern-replay-ledger.test.ts`

Expected: FAIL because `pattern-replay-ledger.ts` does not exist.

- [ ] **Step 3: Implement closed key parsing and event verification**

Use these secret shapes:

```json
{"version":1,"key_id":"replay-2026-08","private_key_pkcs8":"<base64url>"}
```

```json
{"replay-2026-08":{"alg":"Ed25519","public_key":"<32-byte-base64url>"}}
```

Import PKCS#8 with WebCrypto and verify that the configured private key's public signature validates through the public allowlist before accepting it as a writer.

- [ ] **Step 4: Write failing create/adopt tests**

Prove R2 stores under `pattern-erasure-replay/{event_id}.json`, exact retry adopts the original timestamp/key/bytes, a conditional-put race adopts the valid winner, and mismatched existing bytes fail closed.

- [ ] **Step 5: Implement deterministic identity and R2-first write/adopt**

Derive the ID from JCS of:

```ts
["pattern-erasure-replay-event-v1", eventClass, semanticOperationKey]
```

Read before create; use `onlyIf: new Headers({ "if-none-match": "*" })`; read back after the put; verify stored bytes before returning.

- [ ] **Step 6: Add bindings and run verification**

Declare separate dev and production R2 bucket names, and add the three binding/key fields to `Env`. Run:

```text
npm exec -w @patternlike/api -- vitest run src/services/pattern-replay-ledger.test.ts
npm run test:wrangler-config -w @patternlike/api
npm run typecheck -w @patternlike/api
```

- [ ] **Step 7: Commit**

```text
git add apps/api/src/services/pattern-replay-ledger.ts apps/api/src/services/pattern-replay-ledger.test.ts apps/api/src/env.ts apps/api/test/hermetic-bindings.ts apps/api/wrangler.toml
git commit -m "api: add the signed Pattern replay replica"
```

---

### Task 2: Monotonic receipt and replay application

**Files:**
- Modify: `apps/api/src/services/pattern-replay-ledger.ts`
- Modify: `apps/api/src/services/pattern-replay-ledger.test.ts`
- Modify: `apps/api/src/db/pattern-ontology.ts`
- Modify: `apps/api/src/db/pattern-ontology.test.ts`

**Interfaces:**
- Consumes: verified `PatternErasureReplayEvent` objects from Task 1.
- Produces:

```ts
export async function applyPatternReplayEvent(
  env: Env,
  event: PatternErasureReplayEvent,
  appliedAt?: Date,
): Promise<"applied" | "replay">;

export async function applyPatternReplayReplica(
  env: Env,
  now?: Date,
): Promise<{ listed: number; applied: number; replayed: number }>;
```

- [ ] **Step 1: Write failing D1 receipt tests**

Assert a matching replay is idempotent, while the same `event_id` with any changed field arms `assertion_probe` and rolls back the lifecycle batch.

- [ ] **Step 2: Implement immutable receipt statements**

Insert every `0008` column only after the R2 write. The receipt uses the R2 adoption timestamp as `replica_put_at` and stores no source bytes.

- [ ] **Step 3: Write failing claim replay tests**

Cover `available` and `reserved` moving forward, already-terminal claims remaining terminal, absent claims receiving a terminal tombstone when the user exists, and no path assigning `available`.

- [ ] **Step 4: Write failing erasure replay tests**

For `pattern_deleted`, `chart_correction_erased`, and `pattern_withdrawn`, start from a readable `pattern_documents` row and live wrapped artifact key; assert replay deletes the document, erases the key, and leaves the pinned terminal claim.

- [ ] **Step 5: Write failing ontology recall tests**

Assert replay recalls an existing release, clears the active pointer, records a tombstone when the restored snapshot predates the release, and makes later ingestion of that version fail.

- [ ] **Step 6: Implement the monotonic handlers**

Order normal events by `(occurred_at, event_id)` and apply `account_deleted` last. Every batch begins and ends with `assertion_probe` checks. Updates may target `available`, `reserved`, or `accepted` as allowed by the event; no statement names `available` as a new value.

- [ ] **Step 7: Run verification and commit**

```text
npm exec -w @patternlike/api -- vitest run src/services/pattern-replay-ledger.test.ts src/db/pattern-ontology.test.ts
npm run typecheck -w @patternlike/api
git add apps/api/src/services/pattern-replay-ledger.ts apps/api/src/services/pattern-replay-ledger.test.ts apps/api/src/db/pattern-ontology.ts apps/api/src/db/pattern-ontology.test.ts
git commit -m "api: replay Pattern erasure events monotonically"
```

---

### Task 3: Write-ahead every Pattern lifecycle transition

**Files:**
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.test.ts`
- Modify: `apps/api/src/routes/pattern-ai.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/routes/birth.ts`

**Interfaces:**
- Consumes: `writePatternReplayIntent()` and `receiptStatements()`.
- Produces no new public response fields.

- [ ] **Step 1: Write failing publication-order tests**

Make `PATTERN_REPLAY_LEDGER.put` fail and assert `publishPattern` leaves the claim reserved, writes no document, and does not mark either job succeeded. Then let R2 succeed and force D1 failure; assert the intent remains and an exact retry adopts it without a second object.

- [ ] **Step 2: Add `claim_consumed` before publication**

Use `generation_id` as the semantic operation key, pin the newly minted `pattern_id`, and include receipt statements in the existing atomic publication batch.

- [ ] **Step 3: Write failing reader-deletion order tests**

Pass the route's idempotency key into `deleteCurrentPattern`. A failed R2 put must leave the document readable and claim accepted; a successful put must commit the receipt with the existing deletion batch.

- [ ] **Step 4: Add `pattern_deleted` before deletion**

Use the owner-scoped route idempotency identity as the semantic key. Keep physical Pattern artifact deletion after the D1/key-erasure commit.

- [ ] **Step 5: Write failing correction and recall tests**

Use the newly active chart id as the correction semantic operation key. For recall, require one `ontology_recalled` intent plus one `pattern_withdrawn` intent per affected generation before the corresponding guarded batches.

- [ ] **Step 6: Integrate correction and recall**

Refactor `recallOntologyVersion` so release status, pointer clearing, recall event, and replay receipt are one batch. Preserve existing idempotent recall behavior.

- [ ] **Step 7: Run verification and commit**

```text
npm exec -w @patternlike/api -- vitest run src/services/pattern-execute-protocol.test.ts src/services/pattern-lifecycle.test.ts src/routes/pattern-ai.integration.test.ts
npm run typecheck -w @patternlike/api
git add apps/api/src/services/pattern-execute.ts apps/api/src/services/pattern-execute-protocol.test.ts apps/api/src/services/pattern-lifecycle.ts apps/api/src/services/pattern-lifecycle.test.ts apps/api/src/routes/pattern-ai.ts apps/api/src/routes/pattern-ai.integration.test.ts apps/api/src/routes/birth.ts apps/api/src/db/pattern-ontology.ts
git commit -m "api: write Pattern lifecycle intents before D1"
```

---

### Task 4: Account deletion and service-authenticated replay routes

**Files:**
- Modify: `apps/api/src/services/account-deletion.ts`
- Modify: `apps/api/src/services/account-deletion.test.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Create: `apps/api/src/routes/internal-pattern-replay.ts`
- Create: `apps/api/src/routes/internal-pattern-replay.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- `POST /internal/pattern-erasure-replay/sweep` lists and applies missing intents.
- `POST /internal/pattern-erasure-replay/apply` verifies and applies the complete replica before traffic.
- Both return only counts and a completion timestamp.

- [ ] **Step 1: Write failing account-deletion tests**

Before the first destructive checkpoint, require an `account_deleted` R2 event keyed by deletion-request id. A failed R2 write leaves all account rows and keys intact. Replay over a pre-deletion snapshot removes user-owned rows, erases DEKs, produces the normal deleted user/deletion-request tombstones, and retains the replay receipt.

- [ ] **Step 2: Implement account replay primitives**

Reuse `DELETED_USER_TABLES`, key erasure, and tombstone rules. When the snapshot predates the deletion request, use `event_id` as the deletion proof identity exactly as the design specifies.

- [ ] **Step 3: Write failing route tests**

Prove service-token enforcement, malformed body refusal, signature failure refusal with zero D1 changes, empty replica success, ordered application, and content-free response bodies.

- [ ] **Step 4: Implement the internal routes**

Mount them only under the existing `/internal` service-authenticated sub-app. The apply route accepts no caller-supplied event bytes; R2 is the authority.

- [ ] **Step 5: Run verification and commit**

```text
npm exec -w @patternlike/api -- vitest run src/services/account-deletion.test.ts src/routes/internal-pattern-replay.integration.test.ts src/services/pattern-replay-ledger.test.ts
npm run typecheck -w @patternlike/api
git add apps/api/src/services/account-deletion.ts apps/api/src/services/account-deletion.test.ts apps/api/src/services/deletion-manifest.ts apps/api/src/routes/internal-pattern-replay.ts apps/api/src/routes/internal-pattern-replay.integration.test.ts apps/api/src/index.ts
git commit -m "api: restore Pattern erasures from the replay replica"
```

---

### Task 5: Restore drill and full gate

**Files:**
- Modify: `docs/deploy/openai-pattern-rollout.md`
- Modify: `docs/superpowers/specs/2026-08-16-pattern-replay-ledger-design.md`

**Interfaces:**
- Consumes the Task 4 apply route and a traffic-disabled D1 clone.
- Produces a content-free evidence record with bookmark, event hashes, response classes, and Worker version.

- [ ] **Step 1: Document exact pre-traffic drill commands**

Cover accepted Pattern creation, deletion, pre-delete restore, replay apply, read refusal, consumed-claim refusal, chart correction, and account deletion. Never paste signed event bodies, user ids, or content.

- [ ] **Step 2: Run the complete repository gate**

```text
npm run typecheck
npm test
npm run build
python contracts/validate_schemas.py
git diff --check
```

- [ ] **Step 3: Provision only after the code gate passes**

Create distinct development and production replay buckets. Generate one Ed25519 key offline, set the private writer secret and public keyring without printing either, deploy rollout-off, and verify the old Pattern behavior is unchanged before running the clone drill.

- [ ] **Step 4: Record evidence and commit**

```text
git add docs/deploy/openai-pattern-rollout.md docs/superpowers/specs/2026-08-16-pattern-replay-ledger-design.md
git commit -m "docs: record the Pattern replay restore gate"
```
