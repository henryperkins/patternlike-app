# Pattern Source Regeneration Implementation Plan

> **Execution:** Implement inline with `superpowers:executing-plans`, `superpowers:test-driven-development`, Cloudflare Worker best practices, and the repository-local merge gate. The design was approved on 2026-08-29.

**Goal:** Let a reader explicitly replace an accepted Pattern only after Pattern-creation source code changes, without hiding the current Pattern during generation or weakening irreversible erasure.

**Architecture:** Compile a deterministic allowlisted source hash into the Worker; freeze it into every command, job, document, provenance record, and publication proof; represent replacement as one pending coordinate on the accepted claim; reuse the existing Pattern queue; publish through one atomic document swap protected by a signed successor replay event.

**Spec:** `docs/superpowers/specs/2026-08-29-pattern-source-regeneration-design.md`

## Global constraints

- Do not edit frozen M7 contracts.
- Do not use environment variables, model/config/ontology changes, UI files, docs, or tests as regeneration identity.
- Do not add a queue, pipeline, automatic generation, visible history, human review, or fallback prose.
- Do not remove the current Pattern on reservation, failure, cancellation, stale delivery, or publication retry.
- Do not commit, push, apply a production migration, merge, or deploy.

### Task 1: Compile the Pattern-creation source fingerprint

**Files:**
- Add: `apps/api/pattern-creation-sources.json`
- Add: `apps/api/scripts/generate-pattern-source-fingerprint.ts`
- Add: `apps/api/scripts/generate-pattern-source-fingerprint.test.ts`
- Add: `apps/api/src/generated/pattern-creation-source.ts`
- Modify: `apps/api/package.json`

- [ ] Write failing generator tests proving byte changes, path changes, ordering/duplicate/traversal rejection, and checked-in output freshness.
- [ ] Implement the length-delimited SHA-256 generator and explicit production-source manifest.
- [ ] Add `generate:pattern-source` and `check:pattern-source`; gate API tests and builds with check mode.
- [ ] Run the focused generator test and freshness check green.

### Task 2: Define the M9 successor wire contract

**Files:**
- Add: `contracts/m9/SCHEMA_MANIFEST.json`
- Add: `contracts/m9/common.schema.json`
- Add: `contracts/m9/pattern-state.schema.json`
- Add: `contracts/m9/pattern-generation-request.schema.json`
- Add: `contracts/m9/pattern-generation-accepted.schema.json`
- Add: `contracts/m9/pattern-generation-status.schema.json`
- Add: `contracts/m9/pattern-regeneration-replay-event.schema.json`
- Add: `contracts/m9/openapi/openapi.yaml`
- Add: `contracts/m9/fixtures/valid/*.json`
- Add: `contracts/m9/fixtures/invalid/*.json`
- Modify: `contracts/validate_schemas.py`
- Modify: `packages/shared/src/m9-types.ts`
- Modify: `packages/shared/src/index.ts`
- Add/modify: `packages/shared/src/m9-types.test.ts`

- [ ] Add failing validator/shared tests for required closed regeneration state, exact confirmation/reason coupling, hash privacy, and the signed replacement event.
- [ ] Implement the minimal additive M9 Pattern successor while retaining M7 public Pattern responses and M7 replay compatibility.
- [ ] Register M9 by absolute `$id`, validate exact fixture inventory, predecessor hashes, manifest inventory, and the OpenAPI overlay.
- [ ] Run shared and contract tests green.

### Task 3: Migrate durable Pattern state

**Files:**
- Add: `db/d1/0023_pattern_source_regeneration.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `contracts/smoke_check.py`
- Modify: `apps/api/src/db/pattern-claim-transitions.ts`
- Modify: `apps/api/src/db/pattern-claims.ts`
- Modify: `apps/api/src/db/pattern-claim-transitions.test.ts`

- [ ] Write failing smoke/transition tests for the new columns, legacy-hash backfill, accepted pending ownership, concurrency convergence, terminal blocking, and populated-row preservation.
- [ ] Add the forward-only migration, widening only the job and replay tables whose `CHECK` expressions change and recreating every index/guard.
- [ ] Add `reservePatternRegeneration`, matching release, and completion statements as the sole live pending-coordinate writers.
- [ ] Run D1 smoke and focused claim tests green.

### Task 4: Freeze and recheck the source coordinate

**Files:**
- Modify: `apps/api/src/services/pattern-command.ts`
- Modify: `apps/api/src/services/pattern-command.test.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-publication-proof.ts`
- Modify: `apps/api/src/services/pattern-publication-proof.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: affected Pattern execution fixtures/tests

- [ ] Write failing tests for strict V2 command decoding, historical V1 read compatibility, job/hash coordinate mismatch, stale-source cancellation before provider work, and pending-coordinate release on every terminal non-publication path.
- [ ] Freeze the compiled hash in V2 commands/jobs and add it to stage rows and publication proof.
- [ ] Recheck the compiled hash on every queue delivery and inside publication authorization.
- [ ] Make terminal transitions release either the initial active coordinate or accepted pending coordinate based on reservation reason.
- [ ] Run focused command, stage, and execution tests green.

### Task 5: Reserve and expose regeneration without hiding the Pattern

**Files:**
- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `apps/api/src/services/pattern-state.ts`
- Modify: `apps/api/src/routes/pattern-ai.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`

- [ ] Write failing route/state tests for ineligible current source, eligible legacy/different source, exact M9 request, missing accepted document, revoked consent, one pending job, same-key replay, different-key convergence, and ready-plus-progress/failure state.
- [ ] Add the `source_update` admission branch and keep initial generation behavior compatible.
- [ ] Return M9 state with a private-hash-free regeneration block while `GET /v1/pattern` remains M7.
- [ ] Reuse `PATTERN_QUEUE` and ordinary domain jobs; add no second control plane.
- [ ] Run focused route/state tests green.

### Task 6: Atomically replace and erase the prior Pattern

**Files:**
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-publication-proof.ts`
- Modify: `apps/api/src/services/pattern-replay-ledger.ts`
- Modify: `apps/api/src/services/pattern-replay-ledger.test.ts`
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.ts` only if shared erasure helpers are required

- [ ] Write failing tests proving the prior document remains on replay-intent/D1 failure, a successful batch swaps exactly one document, the old key/command are destroyed, the pending coordinate clears, and old R2 keys are physically deleted after commit.
- [ ] Add the M9 signed `pattern_regenerated` intent and dual-schema verifier.
- [ ] Implement the closed initial/regeneration publication branches and atomic swap.
- [ ] Make replay erase only the named old generation/document, preserve the replacement, clear matching pending state, and converge idempotently.
- [ ] Run publication, lifecycle, and replay suites green.

### Task 7: Add the reader action and retained-content progress UI

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/PatternExperience.tsx`
- Modify: `apps/web/src/components/PatternExperience.test.tsx`
- Modify: the existing Pattern stylesheet only as needed with existing tokens

- [ ] Write failing UI tests for absent action, eligible action, exact phrase confirmation, one POST on duplicate activation, retained chapters during progress/failure, retry, keyboard naming, and live status.
- [ ] Implement the inline secondary regeneration panel without changing the current chapter/delete structure.
- [ ] Poll while `regeneration.generation` is active even though top-level state remains `ready`.
- [ ] Run the focused web tests and the Impeccable detector green.

### Task 8: Verify the complete change

- [ ] Review `git status`, scoped diff, and `git diff --check` for unrelated changes or generated drift.
- [ ] Run source freshness, contracts, D1 smoke, focused API suites, focused web suites, typecheck, and build.
- [ ] Load the frontend testing/debugging and Playwright skills, verify ready/eligible/active/failed states at desktop and mobile widths, and record any unverified runtime boundary honestly.
- [ ] Run `npm run ci:local` from the worktree-local real `.venv` and preserve its paste-ready summary.
- [ ] Report exact verification and state explicitly that nothing was committed, pushed, migrated, merged, or deployed.
