# Dependency update review and verification

Date: November 11, 2026. PR: [#85](https://github.com/henryperkins/patternlike-app/pull/85).

The API now uses Hono 4.13.11. The separate Promptfoo lockfile updates fast-uri to 3.1.9, brace-expansion to 5.0.12, and transitive Hono to 4.13.17. The API imports only `hono`, `hono/cookie`, and `hono/utils/jwt`; its imports are unaffected by the adapter split.

## Review corrections

The first complete gate on the dependency update merged with main failed typecheck and the current-map check. All its test and build lanes passed. The failed log remains in the operator scratch evidence; it is not a passing receipt.

- `fe24fe9` adds `Promise<Response | void>` to seven exported middleware signatures. Under Hono 4.13.11 their inferred declarations otherwise reference a package path that exports do not expose (TS2742). These annotations are the only middleware changes; no control flow or response construction changed.
- `7fc88e1` selects a new immutable source-map capture, taken from clean `fe24fe9`. Among consumed inputs, only `apps/api/package.json`, `admin-auth.ts`, `auth.ts`, and `config-guard.ts` changed from the preceding capture. The two other edited middleware files are outside that consumed set. No claim, anchor, selector, or generated map/evidence content changed.
- `f7b5599` preserves main's history in the dependency branch, so the candidate includes the corrections merged with #86.

## Complete gate

The source-bound recorder ran exactly `npm run ci:local` on clean commit `7fc88e1963477b393697d4fb947d2cca759748d9`, starting 2026-11-11T07:38:49.419Z and completing 2026-11-11T07:48:10.451Z. All 16 required lanes passed and the actual process exited 0. Node was v22.23.2, npm 10.9.8, and Python 3.14.4 (the gate explicitly notes CI's Python 3.12 pin). Installed Hono 4.13.11 matched the lockfile.

The source manifest remained unchanged at `4bcd28e367cf83ea811b7730f298fb2c1d783929f9e2b1604123d4835eb7474d`. Receipt verification returned `passed: true` with no problems. The recorder log is retained outside the repository; the receipt binds child-process output with SHA-256 `e9fe816124fbcae156ab8635e0e41a862993bf92fae3ffe2422d30073bb26f48`. The receipt, exact summary, verifier result, and content-free offline-check output are retained in [artifacts/2026-11-11-dependency-update](artifacts/2026-11-11-dependency-update/).

```text
PATTERNLIKE_CI_SUMMARY_V1_BEGIN
node v22.23.2 npm 10.9.8 python 3.14.4
pass	contracts: npm run test:contracts
pass	monorepo: npm ci (install or dry-run)
pass	monorepo: ephemeris download
pass	monorepo: npm run typecheck
pass	monorepo: test @patternlike/shared
pass	monorepo: test @patternlike/reading-engine
pass	monorepo: test @patternlike/calc-stub
pass	monorepo: test @patternlike/ontology-signer
pass	monorepo: test @patternlike/api
pass	monorepo: test @patternlike/web
pass	monorepo: npm run build
pass	extra: test @patternlike/pattern-engine
pass	extra: test @patternlike/codex-runner
pass	extra: npm run test:content
pass	extra: npm run test:source-map
pass	extra: npm run map:check:current
PATTERNLIKE_CI_SUMMARY_V1_PASSED
PATTERNLIKE_CI_SUMMARY_V1_END
```

This documentation and its evidence are excluded from the recorder's source manifest. The verifier is rerun after committing them. A local gate does not establish deployment, applied migrations, installed-runner state, or authenticated live behavior.

## Promptfoo boundary

`npm run check --prefix evals/promptfoo` passed without invoking a provider. It checks the offline harness and corpus agreement; it does not load Promptfoo or exercise the three changed dependency packages.

The previous investigation verified the three changed entries against published npm integrity and their consumers' version ranges. It also reproduced a pre-existing npm 10 lockfile issue beginning in #78: `npm ci --dry-run` reports a missing optional-peer `gcp-metadata@7.0.1` entry. npm 11 accepts the lockfile. This PR neither introduces nor repairs that issue. Promptfoo is outside the deployed workspaces and outside the 16-lane gate.

## Release scope

Merging this PR triggers the configured Cloudflare production build. There is no migration, Worker configuration change, provider call, runner restart, or Fly calc deployment in this change. Production build and serving evidence are checked separately after the merge. R05 remains the separate design draft #87.
