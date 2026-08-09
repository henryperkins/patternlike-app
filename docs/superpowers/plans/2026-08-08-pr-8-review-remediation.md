# PR 8 Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #8 merge-ready by correcting confirmed ingestion, concurrency, configuration, and operational-safety defects, then merge and deploy the verified head.

**Architecture:** Preserve the existing verify-then-store-then-activate pipeline. Make stored-release activation independent of SQLite connection-local state, converge database-race outcomes on the existing 202/409 contracts, reject oversized JSON before buffering it, and keep default Wrangler commands isolated from production R2.

**Tech Stack:** TypeScript, Hono, Vitest with Cloudflare Workers pool, D1, R2, Wrangler 4, GitHub CLI.

## Global Constraints

- Treat `contracts/m0/` as frozen; only additive OpenAPI response documentation is allowed.
- Preserve Ed25519 and ES256 raw public-key configuration formats.
- Do not weaken immutable R2 artifact verification on retries or rollbacks.
- Stage only files owned by this remediation and preserve unrelated worktree state.
- Merge only the expected verified PR head; deploy only the resulting `main` revision.

---

### Task 1: Race and activation consistency

**Files:**
- Modify: `apps/api/src/db/content-releases.ts`
- Modify: `apps/api/src/routes/content-releases.ts`
- Test: `apps/api/src/routes/content-releases.integration.test.ts`

**Interfaces:**
- Consumes: `activateRelease(env, record, audit, alreadyStored, now)` and the existing 202/409 response envelope.
- Produces: stored activation that uses D1 result metadata for its boolean result and a race-recovery path that returns `release_version_immutable` for a same-version/different-hash winner.

- [x] **Step 1: Add the failing different-hash D1-race test**

  Reuse the existing D1 wrapper pattern, insert a winner with the requested version and a different hash immediately before the request's batch, throw the matching UNIQUE constraint error, and assert HTTP 409 plus `release_version_immutable` and a denied audit row.

- [x] **Step 2: Verify the focused integration test fails as a 500**

  Run: `npm test -w @patternlike/api -- src/routes/content-releases.integration.test.ts`

- [x] **Step 3: Implement deterministic race recovery**

  In the constraint catch, handle `winnerByVersion` with a differing hash before the bundle-hash lookup by calling the existing refusal path with HTTP 409.

- [x] **Step 4: Remove the connection-local `changes()` dependency**

  Generate the stored-transition audit id in Worker code, let the pointer statement depend on that transaction-local audit marker, and continue returning `results[2].meta.changes > 0` as the transition result. Extract the duplicated activation/duplicate response flow into a route-local helper while preserving response data.

- [x] **Step 5: Verify the focused integration lane passes**

  Run: `npm test -w @patternlike/api -- src/routes/content-releases.integration.test.ts`

### Task 2: Validation diagnostics and boundary coverage

**Files:**
- Modify: `apps/api/src/services/content-release.ts`
- Test: `apps/api/src/services/content-release.test.ts`

**Interfaces:**
- Consumes: `parseReleaseKeyConfiguration` and `validateIngestionRequest`.
- Produces: discriminated malformed-key results, pinned 128/129 and 256/257 boundaries, and schema errors that contain only Ajv `instancePath` and `keyword` metadata.

- [x] **Step 1: Add failing tests**

  Import `parseReleaseKeyConfiguration`; assert malformed JSON sets `malformed`, invalid entries populate `invalidKeyIds`, mixed valid/invalid input retains the valid key, 128/256 character boundaries pass, 129/257 fail, and a schema-only failure message includes its path and keyword.

- [x] **Step 2: Verify the focused service lane fails for missing schema diagnostics**

  Run: `npm test -w @patternlike/api -- src/services/content-release.test.ts`

- [x] **Step 3: Return the first safe schema diagnostic**

  Construct Ajv without `allErrors: true`; on schema rejection append the first error's `instancePath` (or `/`) and `keyword`, never request values.

- [x] **Step 4: Verify the focused service lane passes**

  Run: `npm test -w @patternlike/api -- src/services/content-release.test.ts`

### Task 3: Bounded ingestion bodies

**Files:**
- Modify: `apps/api/src/routes/content-releases.ts`
- Modify: `contracts/m0/openapi/openapi.yaml`
- Modify: `README.md`
- Test: `apps/api/src/routes/content-releases.integration.test.ts`

**Interfaces:**
- Consumes: the raw Worker `Request` body stream.
- Produces: an 8 MiB maximum JSON body, HTTP 413 `request_too_large`, and unchanged HTTP 400 `invalid_json` behavior below the limit.

- [x] **Step 1: Add a failing oversized-body integration test**

  Send a request with a body larger than 8 MiB through the real route and assert 413, `request_too_large`, no R2/D1 release state, and a denied audit row.

- [x] **Step 2: Verify the test fails with the current parser**

  Run: `npm test -w @patternlike/api -- src/routes/content-releases.integration.test.ts`

- [x] **Step 3: Implement a bounded stream reader**

  Reject an over-limit `Content-Length` before reading, otherwise read chunks while counting bytes, cancel on overflow, decode only the bounded bytes, and distinguish `too_large` from invalid JSON.

- [x] **Step 4: Document the additive 413 response and operational limit**

  Add the standard error response at 413 in OpenAPI and document `request_too_large` in the README refusal table.

- [x] **Step 5: Verify the focused integration lane passes**

  Run: `npm test -w @patternlike/api -- src/routes/content-releases.integration.test.ts`

### Task 4: Configuration and documentation cleanup

**Files:**
- Modify: `apps/api/wrangler.toml`
- Modify: `README.md`
- Modify: `apps/api/src/routes/content-releases.integration.test.ts`

**Interfaces:**
- Consumes: the existing top-level development and named production Wrangler environments.
- Produces: default `ARTIFACTS` binding `pattern-artifacts-dev`, unchanged production `pattern-artifacts`, documented `bundle_hash_conflict`, and an unshadowed test variable.

- [x] **Step 1: Apply configuration and prose-only fixes**

  Rename the local R2 object key in the test, switch only the top-level bucket name, and add `bundle_hash_conflict` to the refusal table.

- [x] **Step 2: Validate both Wrangler environments without deploying**

  Run: `npm run build -w @patternlike/api`

### Task 5: Finalize, merge, and deploy

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: a clean PR branch and expected GitHub head SHA.
- Produces: a merged commit on `main`, a production Worker version from that merged revision, and fresh public health/representative route evidence.

- [x] **Step 1: Run final local gates**

  Run: `npm run typecheck`, `npm test`, and `npm run build`.

- [ ] **Step 2: Commit and push only the remediation files**

  Stage an explicit allowlist and push without force.

- [ ] **Step 3: Re-check PR head, review state, and all checks**

  Require the remote head to equal the verified local SHA and investigate any non-green check before merge.

- [ ] **Step 4: Merge the expected head and prove ancestry**

  Merge PR #8, fetch `origin/main`, and require `git merge-base --is-ancestor <verified-head> origin/main` to succeed.

- [ ] **Step 5: Deploy the merged main revision**

  Build the web assets and run the production Wrangler deploy from the merged `main` checkout.

- [ ] **Step 6: Verify production**

  Confirm the deployed version id, fetch a fresh public `/health` response, and verify an unauthenticated representative internal request remains denied without mutating D1 or R2.
