# Task 2 implementation report

Implemented `scripts/source-map/model.mjs`, `snapshot.mjs`, `cli.mjs`, and fixture regression tests; added `map:capture`, `map:check`, `test:source-map` and appended the new glob to serial `test:content`. Existing fourteen-lane gate and candidates helper unchanged. No runtime dependencies, application edits, commits, pushes, merges, or subagents.

## Interface and scope

`run(command, argument, { cwd, beforeRecheck, writeFile, now })` returns `{ exitCode, result }`. Optional callbacks are filesystem/clock boundaries for deterministic drift/interrupted-publication tests. CLI emits one JSON object and the specified exit code. Closed model validation, safe paths and secret/ignored/symlink refusal, UTF-8 literal selectors, deterministic escaped Markdown, fixed tooling identities, scoped dirty paths, canonical identity digest, exclusive completion-marker publication, closed snapshot validation, independent membership/count/anchor/output reconstruction, buffered identity and HEAD rechecks, clone relocation, and bounded diagnostics are covered.

Snapshot metadata `worktree_has_changes` means scoped `dirty_paths` is nonempty. Definition executable identity is retained independently of copied `map-input.json` mode; exact copied bytes and each output identity are independently verified. Every referenced file is hashed once per read pass; all runtime imports are within the fixed normative manifest (Node built-ins excepted).

## Red/green evidence

All commands run from `/home/henry/patternlike-app-source-map`, after:

```sh
source /home/henry/.nvm/nvm.sh
nvm use 22
```

Node: v22.23.2, npm10.9.8.

1. `node --test scripts/source-map/source-map.test.mjs` initial failing capture/check behavior: 1 test, 0 pass, 1 fail (CLI absent, assertion expected capture exit0). Full output `/tmp/source-map-red.log`.
2. Same command with initial failure matrix before implementation:34 tests,0 pass,34 fail. Full output `/tmp/source-map-matrix-red.log`.
3. After implementation and correcting bundle stability classification:34 tests,34 pass,0 fail. `/tmp/source-map-green.log`.
4. Extended independently exercised protocol regressions:50 tests,50 pass,0 fail. `/tmp/source-map-extended.log`.
5. `node --test --test-name-pattern='initial executable|bundle entries added' scripts/source-map/source-map.test.mjs`:2 tests,0 pass,2 fail, independently reproducing review findings. `/tmp/source-map-review-red.log`.
6. `npm run test:source-map` after fixes:52 tests,52 pass,0 fail.
7. `node --test --test-name-pattern='committed punctuation|local credential' scripts/source-map/source-map.test.mjs`:5 tests,1 pass,4 fail. Explicit .envrc/.npmrc/.ssh/*.pem refusal was missing. `/tmp/source-map-secrets-red.log`.
8. Final `npm run test:source-map`:57 tests,57 pass,0 fail; duration6702.635459ms. `/tmp/source-map-final.log`.
9. `git diff --check -- package.json scripts/source-map`:exit0.

## Integration status

First `npm run test:content` while repository authors were still active:131 tests,124 pass,7 fail; all seven failures are existing `scripts/pattern-release/fresh-pattern-evaluation.test.mjs` tests36–42, with expected stage/accepted counts2/6 versus observed0/1. All52 source-map tests in that run passed. Full output `/tmp/source-map-content.log`. Existing evaluation captures loaded/current source and refuses stage calls if the repository changes; concurrent documentation/tooling edits are a plausible cause, not yet a proven attribution. No existing release tests/tooling were modified.

The second `npm run test:content` run (already started before root requested waiting for all-source freeze) passed:136 tests,136 pass,0 fail, duration21719.613436ms; output `/tmp/source-map-content-final.log`. Root owns the authoritative content and full local gate after all-source freeze. Tooling/package are frozen at57-test revision pending independent review.

The tests use temporary repositories outside the checkout and do not require the real authored map or a current historical snapshot. They cover all section8 rows, including recomputed receipt digests with missing memberships, moved/deleted/duplicated selectors, source/definition/HEAD drift in both commands, two concurrent captures, interrupted exclusive output, later commits and relocation, escaped links in a path containing spaces, and60 reported failures truncated to50 without payload disclosure. Tests assert mechanical identity and structure only; semantic correctness and production readiness remain outside scope.

## Review fixes: fd-bound filesystem access and evidence/tooling overlap

Addressed P1/P2 from `task-2-review.md`. Only `scripts/source-map/snapshot.mjs` and `source-map.test.mjs` changed after the initial tooling freeze. Package scripts and the fixed runtime manifest are unchanged.

P1: filesystem access is now descriptor-bound. Starting with a held filesystem-root directory handle, each repository component is opened through `/proc/self/fd/<parent-fd>/<single-component>` using `O_DIRECTORY | O_NOFOLLOW`. File reads use an opened `O_NOFOLLOW` file descriptor, validate regular-file status with `fstat`, and read that descriptor. `O_NONBLOCK` prevents a substituted FIFO from blocking before regular-file validation. Output parent creation and exclusive snapshot-directory reservation are relative to validated parent handles. Each output file is opened exclusively through the held snapshot-directory handle, then written via that file descriptor. The directory's device/inode is rechecked against its current repository path before and after every write, so the reproduced parent replacement fails without redirecting bytes to the outside directory. All owned descriptors close on success and failure via `finally`; a regression exercises repeated checks and failed publications and asserts unchanged open-descriptor counts.

The `openFile` boundary receives fd-relative paths; `readFile`/`writeFile` callbacks receive already opened descriptors. Ownership remains with `run`. These seams reproduce mutations immediately before final file open and immediately before reading/writing without replacing the actual filesystem operation with a mock assertion. The existing race, interrupted-write, static-symlink, and exclusive-owner tests remain green.

**Precise supported environment:** Node22 on Linux with mounted, accessible procfs descriptor links at `/proc/self/fd`, and functioning `O_NOFOLLOW`/`O_DIRECTORY`. The implementation detects platform/constants and probes the bound descriptor capability before any source read or snapshot publication. Unsupported platforms or unavailable procfs return bounded `io_failed`, exit2, without fallback to path-based I/O. Node22 does not expose `openat`; this Linux mechanism avoids native dependencies. Root explicitly approved this platform tradeoff and owns README/execution-note documentation. The inode capability remains the authorized object if renamed; substitution of its old pathname cannot redirect an operation to a different outside inode. This is not a sandbox against an actor that already has authority to relocate the authorized inode itself.

P2: `evidencePaths` is derived directly from every model citation and used independently of tooling membership for initial and final reads. A cited ignored `package.json` now fails with `path_unsafe`; making it ignored during recheck produces the appropriate concurrent-drift failure.

### Exact verification

All commands used Nodev22.23.2 from the explicit isolated worktree.

- `node --test --test-name-pattern='swapped output parent|ignored cited tooling|replaced source parent' scripts/source-map/source-map.test.mjs` before fixes:3 tests,0 pass,3 fail. `/tmp/source-map-boundary-red.log`.
- Same command after initial boundary fixes:3 tests,3 pass,0 fail. `/tmp/source-map-boundary-green.log`.
- `npm run test:source-map`:63 tests,63 pass,0 fail; duration6882.696116ms. `/tmp/source-map-boundary-suite.log`.
- `node --test --test-name-pattern='unavailable procfs|immediately before file open' scripts/source-map/source-map.test.mjs` before the additional open boundary/environment handling:2 tests,0 pass,2 fail. `/tmp/source-map-proc-red.log`.
- Same command after implementation:2 tests,2 pass,0 fail; duration147.113822ms. `/tmp/source-map-proc-green.log`.
- Final `npm run test:source-map`:65 tests,65 pass,0 fail; duration7214.018151ms. `/tmp/source-map-boundary-final.log`.
- `git diff --check -- scripts/source-map package.json`:exit0.

No content-suite rerun after these review fixes, as requested; root owns post-freeze integration. Tooling is now frozen at the65-test revision for scoped re-review. No commit, network request, dependency, or runtime application change was made.

## Final output-error classification correction

Root identified `ENOENT` incorrectly becoming `source_missing`/exit1 in output operations. Added four targeted failing regressions: injected ordinary `writeFile` ENOENT and ENOENT while opening the output parent, opening the newly reserved directory, and observing its identity. All four reproduced the defect before the fix. Output contexts now explicitly choose `io_failed`/exit2, including parent creation, directory open/observation, and file open/write. Missing source/input contexts retain exit1 and their existing codes. No filesystem-boundary or publication semantics changed.

Exact verification (Nodev22.23.2, isolated worktree):

- `node --test --test-name-pattern='missing output' scripts/source-map/source-map.test.mjs`:before fix4 tests,0 pass,4 fail. `/tmp/source-map-output-red.log`.
- Same command after fix:4 tests,4 pass,0 fail; duration302.726557ms. `/tmp/source-map-output-green.log`.
- `npm run test:source-map`:69 tests,69 pass,0 fail; duration7350.034393ms. `/tmp/source-map-output-suite.log`.
- `git diff --check -- scripts/source-map package.json`:exit0.

Tooling frozen at69-test revision. Only snapshot implementation/tests and this report changed. No `ci:local` run; user explicitly waived the full gate, and root owns the final serial content check.
