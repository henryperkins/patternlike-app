# Source-map refresh verification — September 23, 2026

Verified branch: `claude/source-map-refresh-2026-09-23` at `0184ca93ed26cadcad6cc12dd5d6d9443e76a60d`. The imported refresh was reconciled with main at `c31cf41877dbd517b0b772619dc1647e7e3df166`. The only follow-up to this tested commit is this verification record.

The supplied patches have the same stable patch ID. The original snapshot passed its check against `77c6c0012cf3c8ff506c63ea422fa7830865f289` and remains byte-for-byte unchanged. Reconciliation updates the AppShell navigation selector and records the changed AppShell and Onboarding file identities in a new snapshot; all 172 authored claims remain unchanged.

- `npm run test:source-map`: 69 passed, 0 failed.
- `npm run map:check -- docs/architecture/source-map/snapshots/2026-09-23-main-c31cf41`: verified, 0 problems. Eight branches, 49 topics, 172 claims, 938 unique selectors, 991 claim citations, and 249 referenced files.
- `npm run ci:local`: exit 0, all 14 lanes passed. The main API suite passed 2,749 tests, its compatibility suite passed 1 test, and the web suite passed 901 tests.
- `git diff --check origin/main..HEAD`: passed.

Toolchain: Node 22.23.2, npm 10.9.8, Python 3.14.4. Node matches `.nvmrc`; Python differs from the workflow's 3.12 pin, as the gate summary reports.

The documented CI summary encoding defect was reproduced using the actual log: `parseCiSummary` found all 14 passing lanes but returned `passed: false` and `final_success: false`. Replacing only the malformed dash in memory made parsing pass; neither the script nor the saved log was changed. This record is not a verified `release-evidence.mjs` receipt. The Fly configuration mismatch also remains unchanged.

Full raw log retained locally at `output/verification/source-map-refresh-2026-09-23/ci-local.log`; SHA-256: `eeb16dcec61d26f71b59410c589d1bf7735d156bb934ad7598e88c3e779090ee`. This record documents local source and test verification, not deployed settings, artifact Share pins, or production behavior.

## Paste-ready local CI summary

The following is the actual summary with ANSI color codes removed; its malformed characters are preserved.

```text
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUMMARY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
commit  0184ca9 on claude/source-map-refresh-2026-09-23
node    v22.23.2   npm 10.9.8   python 3.14.4
note    local 3.14.4, ci.yml pinned 3.12

  pass   contracts: npm run test:contracts
  pass   monorepo: npm ci --dry-run (lockfile agrees with package.json)
  pass   monorepo: ephemeris download
  pass   monorepo: npm run typecheck
  pass   monorepo: test @patternlike/shared
  pass   monorepo: test @patternlike/reading-engine
  pass   monorepo: test @patternlike/calc-stub
  pass   monorepo: test @patternlike/ontology-signer
  pass   monorepo: test @patternlike/api
  pass   monorepo: test @patternlike/web
  pass   monorepo: npm run build
  pass   extra: test @patternlike/pattern-engine
  pass   extra: test @patternlike/codex-runner
  pass   extra: npm run test:content

ALL STEPS PASSED â€” safe to merge on local evidence.
```
