# API test branch: canonical gate investigation

Date: 2026-11-10.

## Result

**The complete required `npm run ci:local` passed: all 16 lanes, process exit 0, no skipped lanes, unchanged source, and observed build artifacts.** The release-evidence recorder and a separate verification both returned `passed: true` with no problems. No global warning suppression or supplemental command substitution was used in this final run.

- [Exact passing summary](artifacts/2026-11-10-local-gate-portability/local-gate-summary.txt)
- [Source-bound gate receipt](artifacts/2026-11-10-local-gate-portability/local-gate.json)
- [Receipt verification](artifacts/2026-11-10-local-gate-portability/local-gate-verification.json)
- [Initial failed run and branch review](2026-11-10-api-test-merge-preparation.md), retained as historical evidence

This prepares `perf/api-test-setup` for review in a draft PR. It does not authorize a merge or certify production readiness. No merge, deployment, live migration, credential change, or paid provider call occurred. Other findings still open in the [pre-production review](2026-11-10-pre-production-review.md) remain open.

## Root causes and corrections

### 1. The tsx CLI requires an unavailable Unix IPC listener

Seven initial lanes failed before their checks could finish because the installed tsx CLI starts a Unix socket server even for non-watch commands. This host rejects that listener with `listen EPERM` on `/tmp/tsx-1000/<pid>.pipe`. A minimal Unix-listen probe reproduced the host restriction; localhost TCP was available. This was a runner portability issue, not seven independent application failures.

Changed only non-watch test/check scripts in six workspace manifests to invoke the installed TypeScript loader directly with `node --import tsx`. The original test files, quoted globs, flags, and npm lifecycle chains remain intact. Watch commands, generators, operational commands, lockfile, and dependencies are unchanged. API pretest and prebuild still check schema-dump freshness, generated validators, and the pattern-source fingerprint. No gate lane or assertion was removed.

### 2. The release recorder mixed stderr diagnostics into a stdout protocol

The initial content lane had seven fixture failures: runtime `UNDICI-EHPA` diagnostics could arrive on stderr after an otherwise complete stdout summary. The strict summary parser correctly rejected the mixed stream, but the recorder should not have presented stderr as summary protocol data.

The recorder now parses only the child's stdout tail while continuing to display and hash both stdout and stderr. Process exit, complete ordered 16-lane summary, source stability, build artifact identity, and repository identity checks are unchanged. The parser remains strict about unexpected trailing stdout.

Added regression coverage proving that a valid stdout summary with trailing stderr succeeds, a summary emitted only on stderr fails, trailing stdout fails, and the stored output hash includes the observed diagnostics. The full content lane now passes all 85 tests with normal warnings enabled.

### 3. Earlier branch corrections are included

The preparation also fixes the logout mock's TypeScript typing, narrows the scheduler's overly broad no-rewind rule while retaining consumed-day protection, adds timezone/eligibility regressions, and corrects the unit-suite membership comment. The [initial review](2026-11-10-api-test-merge-preparation.md#corrections) gives the detailed changes. The selected immutable architecture map was refreshed again after the manifest and recorder changes; its 966 selectors across 254 files verify with no problems.

## Canonical verification and provenance

Command:

```sh
node scripts/pattern-release/release-evidence.mjs gate docs/reviews/artifacts/2026-11-10-local-gate-portability/local-gate.json
node scripts/pattern-release/release-evidence.mjs verify docs/reviews/artifacts/2026-11-10-local-gate-portability/local-gate.json
```

The recorder ran the real `npm run ci:local` with Node 22.23.4, npm 11.9.0, Python 3.12.14, a real checkout-local `.venv` containing mandatory OpenAPI/renderer dependencies, and all five digest-verified ephemeris files. The run began at 21:02:41 UTC and finished at 21:14:07 UTC on 2026-11-10.

- Tested local commit: `0a63056e808e2f207a1f53e82f179a4d9c86158f`.
- Identical published preparation commit: `4c3e8780785c3d03dddfea6c1df9b7a1a6f97925`.
- Both commits' complete Git tree: `cd327154e4686fd5dc7ed5911c610e9d7b9e22b3`.
- Source digest: `8dbeb3d6f161bfd59fecf00929901cfb2e0ee3aa65ecc88d6d8884cd8a3264e3`.
- Build artifact digest: `720de19e7784d18468e717d93b8f2aee3e2e876ddfd0d3180426b401a1807dc2`.
- Combined process-output digest: `a7a50d679f0715fe73895759035477ac5c6945936003cfcfa7d6d7a72af0f154`.

The two commit IDs differ because the connected GitHub publisher created a consolidated preparation commit on the original branch history. Their tree identity was verified before publication. The final commit adds only review documentation and evidence under `docs/reviews/`, an explicitly excluded evidence path; verification still passes against that final checkout. The receipt reports worktree changes because its reserved, untracked output file already existed in that excluded directory when source capture began. No consumed source changed during the run.

The API lane includes the Node unit project, complete Worker integration project, pre-0003 compatibility project, and operator/generated-validator tests. The actual D1 migration upgrade proof remains in the Worker project. The web lane passed 964 tests; content passed 85; source-map tooling passed 74. Production Worker builds were dry runs only.

## Remaining review decision

The required local gate is now satisfied. Review the production behavior changes and the separate unresolved pre-production findings before approving a merge. GitHub Actions is documented as billing-locked in this repository, so the full local summary is pasted in the draft PR. Merging to `main` still triggers Cloudflare production deployment and requires separate authorization.
