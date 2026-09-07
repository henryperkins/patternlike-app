# Task 4 independent spec and code-quality review

Reviewed 2026-09-07. **Spec verdict: PASS for the bounded source port. Quality verdict: PASS. No Critical or Important source findings.** Operational merge acceptance remains conditional on the root-owned prerequisites below; this is not authorization to merge an incompatible trigger or schema configuration.

## Scope and identity

Requirements: `task-4-implementation-brief.md`, `task-4-port-analysis.md`, and `task-4-review-brief.md`. Reviewed the supplied `task-4-review.diff`, all new receipt/attestation files, relevant current callers and lifecycle implementations, and the implementation report and focused logs. Unrelated branch changes were outside scope.

Independently recomputed SHA-256 for all 35 paths in `task-4-review-files.json`: zero mismatches, both before and after root integration. Root committed/rebased the port during review; the final checked HEAD is `29af8d2bef354a6b3c6a3ac15ee360cf34227ea5`, with parent `24e66d74d2f91372bcbec1ba928c44c81717818b` reported by root. The supplied diff remains the reviewed scope. The implementer's before/after snapshot maps, base, file count, and source hash compare equal; only `captured_at` differs. That original focused snapshot is 1263 files at `ca0c337c2c9ec104061140ff154c7c0beea8540da9a81adaf353da3f3cef0f93`, not a gate for the integrated revision.

## Findings

- **Critical:** none found.
- **Important:** none found in reviewed source.

No source correction is requested. The trigger and migration conditions below are mandatory compatibility prerequisites, not optional follow-up or evidence that production adoption has occurred.

## Actual review checks

- Traced durable exchange construction through `codex-reading-publisher.ts:225` and the supporting `codex-provider-jobs.ts:315` immutable-job comparison. Both supported efforts come from the loaded durable row; model, prompt, hashes, stages, usage, and completion time are not inferred from mutable configuration. Missing completion time refuses success. `reading-publisher.ts:477` requires exchange only on the success arm. The runner completion parser is unchanged; reader metadata and V5 stored evidence use their explicit existing fields, without spreading exchange coordinates.
- Inspected `generation.ts:1420` through the batch/catch boundary: receipt reading/job/command/stage prechecks, persisted assembly-mode admission, crypto and claim fences, receipt insert within the publication batch, exact receipt coordinate/count, succeeded/published job, and predecessor closing assertions. V1 explicitly passes null at `generate-daily-reading.ts:459`; its batch asserts zero receipts. Failure-injection tests execute real D1 rollback for malformed receipt, absent schema, uniqueness collision, changed receipt coordinate, and changed terminal job result. Duplicate-delivery tests compare the retained receipt byte-for-byte.
- Traced V5 attestation before calculation/R2/provider execution at `generate-daily-reading-v5.ts:411`, receipt assembly at its publication call, supported legacy routing, and both predecessor branches. Replacement tests retain historical receipts while predecessor proof stops resolving; successors receive their own exact receipt chain.
- Inspected `daily-publication-receipts.ts:112` proof joins against reading status, active job, owner, assembly mode, command generation, and succeeded/published job. The helper does not depend on the short-lived provider row. Reviewed provider purge eligibility and artifact deletion, plus `deletion-manifest.ts:111` and `account-deletion.ts` artifact/row phases: Save rows precede reading deletion; jobs and provider state are erased; the new receipt has no deletion entry or foreign key. Focused receipt tests prove cleanup survival and null proof after row erasure, invalidation, and supersession. They exercise `deleteUserRows`, not a complete live account-deletion journey.
- Inspected migration 0029's exact technical column allowlist, constraints and named indexes, fresh setup, populated-0028 D1 row comparisons, and SQLite rehearsal with populated Save metadata and full integrity checking. Existing 0023–0028 migration files are outside the port's changed scope. The migration ledger entry is prospective.
- Traced `checkSecureConfig` on HTTP namespaces, the queue before queue-specific dispatch, and scheduled execution before either cron lane. Missing/placeholder production SHA and malformed values fail closed; `/v1/meta` is registered before guarded product middleware and independently sanitizes each half. Actual entry-point tests assert refusal before DB work. Default/production config declares both metadata bindings and reserved placeholders; docs require injection and migration ordering without claiming either is live.
- Read completed verification logs: 13 focused files / 400 tests, Wrangler config 7 tests, M3 compatibility 1 test, API/scripts typecheck output, 29-migration smoke success, and current Pattern-source fingerprint. The implementation report records successful exits and pinned Node 22.23.2. I did not rerun tests or treat those focused lanes as the aggregate gate. My executable checks were offline file hashing and snapshot comparison only.

## Root-owned acceptance gaps

1. Freeze the integrated revision and complete `npm run ci:local` with pinned Node and the real per-worktree Python environment; retain and paste its actual summary before merge. The focused snapshot predates integration.
2. Before any compatible main merge, update and read back **both** existing Workers Builds deploy/upload commands with the guarded `--var "RELEASE_GIT_SHA:${WORKERS_CI_COMMIT_SHA:?Missing Workers Builds commit SHA}"` suffix, preserving existing build steps and environment selection. Otherwise the tracked production placeholder makes guarded HTTP, queue, and scheduled work refuse service. This review made no external trigger observation.
3. After the final passing gate, capture the authorized backup/bookmark and rehearse/apply gated migration 0029 before the compatible Worker. Both deterministic and model publication require its table. Verify schema, prior data, integrity, and empty assertion probes; preserve Save-aware erasure during rollback.
4. Keep post-gate operational observations in excluded evidence paths. Observe deployed SHA/version/traffic and reconcile with Builds identity. Valid-shaped values and local fixtures cannot establish live provider execution, account settings, installed runner adoption, or reader lifecycle; those remain separately authorized evidence work.

No source edits, installs, branch changes, external calls, broad suites, or subagents were performed by this reviewer. Only this requested report was written.
