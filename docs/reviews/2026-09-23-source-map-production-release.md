# Source-map production release verification — September 23, 2026

The final source gate ran on `b57bc84fde6385beca3080811d2eaaf3dc0d75e0`, incorporating main `28fd3d642761cc59b6036b4cdc55daa8bd11876f`. The user authorized committing and pushing to main and deploying to production. Follow-up changes to this tested revision are confined to excluded review evidence.

The release updates the maintained map and preserves all earlier snapshots. The new publication includes the current Pattern writer and retained correction-history behavior. It also fixes the CI success-line encoding that prevented valid release receipts; the regression executes the committed shell runner with stubbed expensive commands. Application, contract, migration, runner, and build configuration match the incorporated main baseline.

- [Local gate receipt](artifacts/2026-09-23-source-map-release/local-gate.json): all 14 lanes passed; fresh `release-evidence.mjs verify` passed with zero problems.
- `npm run test:source-map`: 69 passed; the current snapshot check verified 172 claims, 943 selectors, 995 citations, and 251 referenced files with zero problems.
- `release-evidence.test.mjs`: 11 passed. The new regression was first observed failing on the malformed success line and passed after the one-line correction.
- Full gate: 2,762 main API tests, 1 API compatibility test, 901 web tests, and 80 content tests passed, along with all other recorded lanes.
- [Independent release review](artifacts/2026-09-23-source-map-release/code-review.json): no findings; previous snapshot/archive trees were unchanged and all 18 README links resolved.

Included source identity: `41c7daa6016633015b542f57de051fdf0eb6bd3d13c70164644df92bab5221dc`. Gate output hash: `efb308ad52778d83085a042cd5965738031a26389eb16b22c0dfd97ce1b19d97`. The full console log is retained locally at `output/verification/source-map-release-2026-09-23/ci-local.log` (SHA-256 `8d1321e64555868ae1918fd7a123bd0f1409127ce56d92394b81165381ac8d6d`).

[Pre-release production observation](artifacts/2026-09-23-source-map-release/production-before.json) records main 28fd3d6 at 100% traffic on Worker version b01692d7-2a39-4cec-ad8a-d4841896450d, and the existing main/nonproduction trigger commands. Both inject the build commit SHA; the build command runs the repository build with its generated-validator checks. These are dated observations before this release, not evidence that the new revision is already deployed. The final live build, metadata, health, and traffic observations are recorded separately after the main push.

The local receipt deliberately leaves deployment unverified. It does not certify provider execution, installed-runner state, or account workflows. Python 3.14.4 differs from the workflow's 3.12 pin, while Node 22.23.2 matches `.nvmrc`. The existing Fly app-name mismatch remains outside this Worker release.

## Actual local CI summary

ANSI color codes removed; summary characters are otherwise unchanged.

```text
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUMMARY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
commit  b57bc84 on claude/source-map-refresh-2026-09-23
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

ALL STEPS PASSED — safe to merge on local evidence.
```
