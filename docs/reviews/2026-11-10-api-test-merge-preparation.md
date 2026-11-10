# API test branch merge preparation

Date: 2026-11-10.

## Scope and disposition

Reviewed `perf/api-test-setup` at `11eb23a46eec9b41d2225e3963479527b5a95d8c` against `main` at `38acb3ff9c21370c394b785edce054e0c45c57ae`: 11 commits ahead, none behind. The preparation branch preserves that history and adds focused corrections. The API production changes, test split/schema migration proof, web behavior, calculation ambiguity handling, and maintained map were reviewed.

**Draft only; the mandatory merge gate has not passed.** No merge, deployment, live migration, credential changes, or paid provider calls were performed. The pre-existing whole-codebase findings still marked open in [the pre-production review](2026-11-10-pre-production-review.md) remain open and are not certified by this branch review.

## Corrections

- Fixed `App.test.tsx`'s logout mock typing with `vi.mocked`, resolving the TypeScript failure.
- Narrowed the scheduler's blanket no-rewind guard. An unreserved day can be scheduled earlier after a timezone or eligibility change. A consumed day uses the current timezone's next cursor. The write checks timezone consistency and target-day absence before rewinding. Login and session touches still do not reschedule.
- Added regression coverage for consent restoration, eastward timezone changes with and without a consumed current day, and published/failed-day protection. Updated the invalidated-orphan expectation to avoid a redundant due-lane evaluation.
- Corrected the unit-test membership comment to match the publisher unit suites actually included.
- Repaired the two stale map selectors and broadened its initial-reservation claim to every existing user-day status. Published and checked a new immutable map snapshot; historical snapshots remain unchanged.

## Exact required gate

Ran the unchanged `npm run ci:local` through the release-evidence recorder on source commit `1bbf6abac23d85a1127481992b76560d3819f112`, Node 22.23.4, npm 11.9.0, and Python 3.12.14. A real checkout-local `.venv` contains the required pinned renderer and OpenAPI dependencies. Installed the locked npm dependencies and verified all five pinned ephemeris downloads.

The process exited **1** with **8 of 16 lanes passing**. Source identity was unchanged throughout the gate.

- [Exact ASCII gate summary](artifacts/2026-11-10-api-test-merge-preparation/local-gate-summary.txt)
- [Machine-readable failed gate receipt](artifacts/2026-11-10-api-test-merge-preparation/local-gate.json)
- [Failure context](artifacts/2026-11-10-api-test-merge-preparation/failure-context.txt)

Seven lanes stop at `tsx`'s IPC listener with `listen EPERM` on `/tmp/tsx-1000/<pid>.pipe`: shared, reading-engine, calc-stub, API pretest, API prebuild, pattern-engine, and codex-runner. The content lane's seven failed fixture assertions are caused by runtime `UNDICI-EHPA` startup warnings arriving after the fixture's summary end marker; the strict parser correctly rejects that contaminated stream.

The canonical passing lanes include all-workspace typecheck, contracts, lockfile consistency, ephemeris verification, ontology-signer tests, all web tests (66 files / 964 tests), source-map tooling (74 tests), and the selected-map check (966 evidence selectors / 254 files).

## Supplemental checks

These checks provide additional diagnostic evidence, **not a replacement passing gate**. The repository's scripts and gate were not weakened or replaced.

- API Node unit project: 52 files / 995 tests passed.
- Full API Worker project: 104 files / 1,824 tests passed; pre-0003 compatibility project: 1 test passed. The operator-script and generated-validator suites also passed with the Node loader.
- Focused scheduler Worker integration: 37 tests passed. Related session, preference, and consent suites: 63 passed.
- Dedicated migration proof in actual D1 Worker runtime: 2 tests passed, including populated upgrade preservation and schema/seed equivalence.
- `node --import tsx --test "src/**/*.test.ts"` passed in shared (107), reading-engine (177), pattern-engine (7), calc-stub (144), and codex-runner (193). The loader avoids the CLI's IPC listener.
- The schema-dump freshness check, generated validators, and pattern-source fingerprint passed through the same Node loader.
- `NODE_NO_WARNINGS=1 npm run test:content`: all 84 tests passed, confirming startup-warning contamination of the original fixture summaries.
- The API production dry-run build passed after the generated-source checks. This used `wrangler deploy --dry-run --outdir=dist --env production`; no deployment occurred. The original receipt still truthfully records that the canonical build lane did not finish.
- `git diff --check` passed. Source identities still match the gate's recorded source after documentation-only updates.

## Before merge

Run the unchanged full gate on a compatible Linux host with Node 22 and its own real `.venv`, record a new receipt, and paste the complete 16-lane passing summary in the PR. Do not substitute the supplemental counts for that evidence. Resolve or consciously disposition the separate existing pre-production findings before treating this as production sign-off. Merging to `main` triggers Cloudflare production deployment and requires separate authorization.
