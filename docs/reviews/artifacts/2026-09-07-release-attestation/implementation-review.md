# Task 4 implementation handoff — frozen 2026-09-07

## Status and ownership

Implemented in `/home/henry/patternlike-app/.worktrees/release-attestation-20260907`, branch `codex/release-attestation-20260907`, on unchanged base `532032824820b2ca54454e39286fede944cb9427`. Source is frozen and uncommitted. No other worktree was edited except this explicitly requested report. No agents were spawned, secrets accessed, external services contacted, providers called, commits made, deployments attempted, or broad API/full ci:local gate run.

Root owns integration of final preceding commits, independent review, the final source gate, staging/commit/PR/merge, trigger changes, production migration sequencing, and all external observations. The later root-supplied dependency candidate `24e66d74d2f91372bcbec1ba928c44c81717818b` was not integrated here; root must preserve this port while rebasing/integrating it and rerun the full gate on final included bytes.

## Frozen source identity

- Base commit: `532032824820b2ca54454e39286fede944cb9427`.
- Included source file count: `1263`.
- Repository source manifest `files_sha256`: `ca0c337c2c9ec104061140ff154c7c0beea8540da9a81adaf353da3f3cef0f93`.
- Before checks: `output/task-4-source-freeze.json`.
- After checks: `output/task-4-source-after-checks.json`.
- Exact `files` mappings and base commits compare equal before/after. Dirty status is intentional and recorded; this is not a claim that the base commit contains the port.
- These snapshots use the existing release-evidence tool's source scope and excluded evidence prefixes. They are source snapshots, **not** full-gate receipts or deployment attestations.

## Implementation and spec self-review

1. **Migration:** Rechecked the ordered tail through 0028 and added only `0029_daily_publication_receipts.sql`. The table has the closed technical column allowlist, no user_id or foreign keys, one receipt per reading, and two named indexes. It admits `high` and `xhigh`, binds the supplied durable effort, and validates full lowercase Worker UUID shape. Existing migrations 0023–0028 are untouched. `MIGRATIONS.json` contains a prospective entry and explicitly says schema must precede compatible runtime and is not applied by source changes.
2. **Publisher boundary:** `CodexPublisherResult` adds a private exchange only to its success arm. Model/prompt/effort/stage/attempt, request/response hashes, usage, and completion timestamp come from the loaded durable job. A missing completedAt refuses publication. `ProviderMetadata` and `CodexProviderCompletion` runtime contract are unchanged. Tests cover legacy high/current xhigh success, exact public metadata keys, rejection of internal coordinates in completion packets, and no cpjob coordinate in stored reading evidence.
3. **Atomicity:** V5 resolves both attestation halves after supported-command validation and before calculation/R2/provider work. `completeReading` checks receipt reading/job/command/stage against publication input before preparing the batch. The opening assertion also checks persisted assembly_mode, so constrained publication cannot pass null. Receipt insert is inside the existing ciphertext/evidence/audit/job/predecessor D1 batch. Closing assertions require succeeded/published job, exact command generation, total receipt count, and exact reading/job/command/provider-job/stage/attempt count. Deterministic V1 explicitly supplies null and requires zero receipts.
4. **Retry/replacement:** Existing stale claims, provider waits, candidate rejection logging, supported legacy routing, supersede_published and retain_invalidated branches remain in place. Tests show duplicate delivery preserves the first receipt, ordinary replacement supersedes its predecessor, fact repair retains invalidation, and each successor has its own correctly bound receipt/proof.
5. **Retention/privacy:** Receipt is absent from deletion-manifest's user-owned tables and has no foreign keys. Tests sweep both encrypted provider artifacts and the control row while retaining hashes and active publication proof; account row deletion retains receipt while removing reading/job/Save join targets and proof resolves null. Invalidation/supersession also stop active proof. Test reset plumbing alone clears receipts between tests.
6. **Attestation/config:** Strict lowercase 40-hex SHA and lowercase Worker UUID readers return null for malformed values. Production rejects missing/empty/placeholder/malformed SHA; malformed present values are checked before development's shortcut. `/v1/meta` remains outside configGuard and reports each half independently. HTTP/queue/scheduled tests exercise actual guarded entry points, and missing Worker metadata prevents any Daily fetch/R2/provider work.
7. **Deployment/runbooks:** Default and production each declare CF_VERSION_METADATA plus the reserved all-zero placeholder. Existing deploy package scripts and historical release-api.sh were not introduced or altered. Runbook requires appending root's guarded `--var "RELEASE_GIT_SHA:${WORKERS_CI_COMMIT_SHA:?Missing Workers Builds commit SHA}"` suffix to both existing Builds deploy/upload commands, describes the bare manual npm deploy limitation, and supplies an explicitly reviewed-source manual Wrangler command. It does not claim trigger changes or deployment adoption. Static evidence/runbook docs were completed before freeze.

## Quality self-review

- Reviewed the current lifecycle and config context before selectively porting additive reviewed hunks; hand-reconciled V5 imports/execution, receipt binding, migration tail, config blocks, and deployment docs instead of replacing current files with stale originals.
- Strengthened the original design's receipt coordinate assertion and added a persisted assembly-mode assertion. The latter prevents a model caller from silently passing null even though the input type is explicitly nullable for V1.
- Receipt writes do not introduce a new asynchronous side effect: the batch remains the sole publication commit boundary. No private exchange metadata is spread into reader evidence.
- Preserved provider-isolation source, current sol/xhigh/prompt 1.0.3 constants, current consent/context and legacy-OpenAI handling, source-register behavior, Save-aware deletion, and existing crypto write fences.
- Focused tests include actual D1 rollback, not SQL string mirroring: bad CHECK, absent table, uniqueness collision, injected post-insert coordinate mutation, and injected succeeded-job result mutation all leave pending reading/running claim/evidence/audit state intact.
- D1's environment prohibits PRAGMA integrity_check; D1 tests use supported quick_check plus foreign-key/assertion checks. A separate fresh/populated-0028 SQLite rehearsal runs full integrity_check and preserves every prior application row including populated Save metadata. D1 migration setup compares every pre-0029 application table, excluding protected _cf_* metadata and migration bookkeeping.
- Local tests validate recorded provider/job exchange and release identity; comments/runbooks do not certify live provider execution, account settings, runner installation, or deployment from those tests.

## Verification (actual completed results)

All final Node commands below ran with `PATH=/home/henry/.nvm/versions/node/v22.23.2/bin:$PATH`, matching `.nvmrc` major 22. Earlier exploratory runs used shell Node 24.19.0; they are superseded by these pinned-Node results.

From the worktree root:

```bash
./node_modules/.bin/vitest run \
  src/routes/health.test.ts \
  src/services/release-attestation.test.ts \
  src/db/daily-publication-receipts.integration.test.ts \
  src/db/daily-publication-receipts-schema.test.ts \
  src/services/codex-reading-publisher.test.ts \
  src/services/codex-provider-contract.test.ts \
  src/services/generate-daily-reading-v5.test.ts \
  src/middleware/config-guard.test.ts \
  src/services/generation.integration.test.ts \
  src/config.test.ts \
  src/services/reading-publisher.test.ts \
  src/middleware/auth.test.ts \
  src/routes/sessions.integration.test.ts --root apps/api
```

Exit 0: **13 files, 400 tests passed**, 97.58 seconds. Log: `output/task-4-node22-focused.log`.

Additional completed checks:

| Command | Result | Log |
| --- | --- | --- |
| `npm run typecheck --workspace @patternlike/api` | Exit 0; Worker and scripts TypeScript configs | `output/task-4-node22-typecheck.log` |
| `npm run test:wrangler-config --workspace @patternlike/api` | Exit 0; 7 tests passed | `output/task-4-node22-wrangler.log` |
| In apps/api: `../../node_modules/.bin/vitest run --config vitest.m3-compat.config.ts` | Exit 0; 1 file/1 test passed | `output/task-4-node22-m3-compat.log` |
| `.venv/bin/python contracts/smoke_check.py` | Exit 0; 29 migrations, including new full-integrity/populated preservation probe | `output/task-4-migration-smoke.log` |
| `npm run check:pattern-source --workspace @patternlike/api` | Exit 0; PASS pattern_source_fingerprint_current | `output/task-4-node22-pattern-source.log` |
| `git diff --check` | Exit 0; clean | terminal result |
| Before/after release-evidence source snapshots | Exact source/base equality | `output/task-4-source-{freeze,after-checks}.json` |

The Python smoke check completed before the final pinned-Node suite; only comments/formatting changed afterward, and the source was then frozen. The Pattern-source check was repeated under Node 22 after freeze. No test behavior/runtime implementation changed after the frozen snapshot.

Initial red observation: copied the three new receipt/attestation/health regression files before implementation; Vitest failed all three suites because receipt/attestation modules did not exist. This was a module-presence failure, not a behavioral red test. Expanded behavioral failure-injection tests were then added with the implementation and passed. Intermediate hand-port mistakes (duplicate attestation declaration and a TOML comment replacement) were caught and fixed. Migration probes also caught D1's protected _cf_METADATA access and unsupported integrity_check; final probes exclude platform metadata and retain full integrity in SQLite. These failed intermediate runs are not counted as passing evidence.

## Remaining risks and root-owned prerequisites

- **Do not merge the guard until both actual Workers Builds trigger commands inject the real CI SHA.** Root has reported checking installed Wrangler authentication/--var support; this task neither changed nor read back the live triggers.
- Integrate the final preceding UI/source/dependency commits, freeze their combined source, and run `npm run ci:local` with the pinned Node and real per-worktree .venv. Paste its actual summary into the PR before merge. This focused handoff is not the aggregate gate.
- After the passing final gate, root must capture the authorized production backup/bookmark, rehearse/apply the gated additive migration before compatible runtime, verify schema/data/integrity, and retain actual facts only under excluded evidence paths. Do not append applied facts to source-hashed MIGRATIONS.json/static docs after the gate without rerunning it.
- Root must observe deployed `/v1/meta`, actual version/traffic, and any separately authorized provider/reader lifecycle evidence. A valid-shaped injected SHA is a declaration, so reconcile it with actual Builds identity; local tests cannot prove the operator supplied the correct SHA.
- Both deterministic and model publication now require table 0029 to exist. This is intentional migration-before-Worker behavior. Preserve Save-aware erasure on rollback.
- The full API/monorepo/build/provider/live gates were intentionally not run by this bounded task. No unresolved source/test failures remain in the checks above.

## Exact changed source files (35)

- `apps/api/scripts/wrangler-config.test.ts`
- `apps/api/src/config.test.ts`
- `apps/api/src/db/daily-publication-receipts-schema.test.ts`
- `apps/api/src/db/daily-publication-receipts.integration.test.ts`
- `apps/api/src/db/daily-publication-receipts.ts`
- `apps/api/src/db/generation.ts`
- `apps/api/src/env.ts`
- `apps/api/src/middleware/auth.test.ts`
- `apps/api/src/middleware/config-guard.test.ts`
- `apps/api/src/middleware/config-guard.ts`
- `apps/api/src/routes/health.test.ts`
- `apps/api/src/routes/health.ts`
- `apps/api/src/routes/sessions.integration.test.ts`
- `apps/api/src/services/codex-provider-contract.test.ts`
- `apps/api/src/services/codex-reading-publisher.test.ts`
- `apps/api/src/services/codex-reading-publisher.ts`
- `apps/api/src/services/generate-daily-reading-v5.test.ts`
- `apps/api/src/services/generate-daily-reading-v5.ts`
- `apps/api/src/services/generate-daily-reading.ts`
- `apps/api/src/services/generation.integration.test.ts`
- `apps/api/src/services/reading-publisher.test.ts`
- `apps/api/src/services/reading-publisher.ts`
- `apps/api/src/services/release-attestation.test.ts`
- `apps/api/src/services/release-attestation.ts`
- `apps/api/src/services/safe-log.ts`
- `apps/api/test/apply-migrations.ts`
- `apps/api/test/helpers.ts`
- `apps/api/test/hermetic-bindings.ts`
- `apps/api/wrangler.toml`
- `contracts/smoke_check.py`
- `db/d1/0029_daily_publication_receipts.sql`
- `db/d1/MIGRATIONS.json`
- `docs/deploy/codex-production-provider.md`
- `docs/deploy/release-attestation.md`
- `docs/deploy/repository-release-evidence.md`
