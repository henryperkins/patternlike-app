# Task 3 implementation: dependency refresh

## Candidate

- Worktree: `/home/henry/patternlike-app/.worktrees/dependency-refresh-20260907`
- Branch: `codex/dependency-refresh-20260907`
- Starting commit: `cefc97981981dfde7a36ce050e7fb33367c830be`
- Node/npm used: Node `v22.23.2`, npm `10.9.8`
- Status: implementation and bounded verification complete; no commit, push, full `ci:local`, broad API suite, deployment, or production/provider call was performed.

The candidate recreates the substance of old Dependabot commit `d06fba3` against the current lockfile and refreshes the selected packages to the current stable releases observed on 2026-09-07. It preserves the existing range style in API/web and the signer workspace's exact pin style.

## Files changed

- `apps/api/package.json`
  - `hono`: `^4.12.32` -> `^4.13.7`
  - `@cloudflare/vitest-pool-workers`: `^0.19.1` -> `^0.22.0`
  - `wrangler`: `^4.16.1` -> `^4.129.0`
  - `@cloudflare/workers-types`: `^4.20250525.0` -> `^5.20260903.1` (required Wrangler peer companion)
- `apps/web/package.json`
  - `wrangler`: `^4.116.0` -> `^4.129.0`
- `apps/ontology-signer/package.json`
  - Root-authorized scope expansion after the first resolved graph showed its old exact pins retained vulnerable Undici 7.28.0.
  - `@cloudflare/vitest-pool-workers`: `0.19.1` -> `0.22.0`
  - `wrangler`: `4.116.0` -> `4.129.0`
  - `@cloudflare/workers-types`: `4.20260702.1` -> `5.20260907.1`
  - TypeScript `5.9.3` and Vitest `4.1.11` remain unchanged.
- `package-lock.json`
  - Reconciled from the current `cefc979` lockfile with npm 10; the old PR lockfile was not restored.

No source, Vitest config, license, contract, generated artifact, or unrelated manifest changed. Current diff is 4 files, 240 insertions, and 85 deletions. The lockfile expansion is npm's representation of the pool's exact Wrangler 4.124.0/Miniflare 5.20260815 branch alongside direct Wrangler 4.129.0/Miniflare 5.20260903; it is not an unrelated package-family sweep.

## Release and compatibility decision

Registry metadata and primary release notes support the selected versions:

- Hono 4.13.7 is the latest stable tag, has Node `>=16.9.0`, no runtime or peer dependencies, and retains MIT. Its release fixes unsafe escaping of untrusted plain strings in specific JSX boundary/server-rendering paths. Primary release: https://github.com/honojs/hono/releases/tag/v4.13.7
- Wrangler 4.129.0 is the latest stable tag, requires Node `>=22.0.0` (satisfied by `.nvmrc` value `22` and the observed Node `v22.23.2`), and retains `MIT OR Apache-2.0`. It declares optional peer `@cloudflare/workers-types ^5.20260903.1`; because API already installed an incompatible 4.x workers-types package, npm treats that optional peer as a real constraint. Primary release: https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.129.0
- `@cloudflare/vitest-pool-workers` 0.22.0 is the latest stable tag, retains MIT, and peers on Vitest/runner/snapshot `^4.1.0`; the lock resolves all three to 4.1.11. It depends on Wrangler 4.124.0 and Miniflare 5.20260815.0-alpha. Its MSW migration only affects projects using MSW >=2.14; this repository has no MSW dependency or imports. Primary release: https://github.com/cloudflare/workers-sdk/releases/tag/%40cloudflare/vitest-pool-workers%400.22.0
- The pool 0.21.0 migration warning about auxiliary workers with relative imports was checked against `apps/api/vitest.config.ts` and `apps/api/vitest.probe.config.ts`; both already supply the signer as an explicit `ESModule` manifest, and the real signer RPC probe passed without config edits. Primary release: https://github.com/cloudflare/workers-sdk/releases/tag/%40cloudflare/vitest-pool-workers%400.21.0
- Undici 7.29.0 requires Node `>=20.18.1`, retains MIT, and contains the security fixes that motivated the old 7.28 -> 7.29 lock intent. All Cloudflare/Miniflare paths now resolve Undici 7.29.0; jsdom separately resolves Undici 8.9.0. No 7.28.0 node remains. Primary release: https://github.com/nodejs/undici/releases/tag/v7.29.0

Final relevant resolved graph:

- Hono: `4.13.7`
- direct API/web/signer Wrangler: `4.129.0`
- pool-internal Wrangler: `4.124.0` (the pool's exact declared dependency)
- pool-workers: `0.22.0`
- workers-types: `5.20260907.1`
- Vitest: `4.1.11`
- pool Miniflare/workerd: `5.20260815.0-alpha` / `1.20260815.1`
- direct Wrangler Miniflare/workerd: `5.20260903.0-alpha` / `1.20260903.1`
- Cloudflare/Miniflare Undici: `7.29.0`

## Install and root-cause record

The first `npm install` with Wrangler 4.129.0 and the existing API workers-types floor failed reproducibly with `ERESOLVE`: Wrangler's optional peer requires `@cloudflare/workers-types ^5.20260903.1`, while API supplied a present and therefore incompatible 4.x peer. Root authorized the minimal companion API floor update. The second install succeeded.

The second graph still retained Undici 7.28.0 through the ontology signer's exact pool 0.19.1/Wrangler 4.116.0 pins. `npm audit` still reported the old pool/Wrangler/Miniflare/Undici advisories. Root then authorized a narrow signer-manifest expansion within the same Cloudflare toolchain family. After alignment, install removed that old graph and audit fell from 6 findings (3 moderate, 3 high) to 2 high findings.

The two remaining audit findings are outside this batch and unchanged from the base lockfile:

- `fast-uri 3.1.5` via `ajv 8.20.0` (`fast-uri ^3.0.1`); base and candidate both resolve 3.1.5.
- `nanoid 3.3.16` via `postcss 8.5.25`/Vite; base and candidate both resolve 3.3.16.

No `npm audit fix`, override, or unrelated dependency update was applied.

## Verification receipts

All commands ran from the dependency worktree under Node 22.

- `npm ci`
  - exit 0; added 225 packages and audited 234.
  - `package-lock.json` SHA-256 remained `72db0ea74f9ccf1176c066f02ed7b53fd201408f39c807ceb3a7ea9feaa0c095` before and after, proving clean lock reconstruction did not rewrite it.
- `npm ls --all --json >/dev/null`
  - exit 0; no invalid/missing peer graph.
- `npm run typecheck --workspace @patternlike/api`
  - exit 0; both Worker and scripts TypeScript configs passed with workers-types 5.
- `PROBE_REMOTE=0 PROBE_FILES='src/harness.test.ts,src/services/ontology-signing-client.test.ts' npm exec --workspace @patternlike/api -- vitest run --config vitest.probe.config.ts`
  - exit 0; 2 files, 18 tests passed.
  - Exercises real D1 setup, real Hono `/health` dispatch, hermetic outbound service routing, and the explicit auxiliary signer module/RPC.
- `npm run test:wrangler-config --workspace @patternlike/api`
  - exit 0; 6/6 tests passed through Wrangler 4.129.0's `unstable_readConfig`.
- `npm run typecheck --workspace @patternlike/ontology-signer`
  - exit 0.
- `npm test --workspace @patternlike/ontology-signer`
  - exit 0; 1 file, 19 tests passed under pool 0.22.0.
- `npm run build --workspace @patternlike/ontology-signer`
  - exit 0; Wrangler 4.129.0 production-environment dry run, 12.25 KiB / gzip 3.99 KiB, `--dry-run: exiting now`.
- `npm exec --workspace @patternlike/{api,web,ontology-signer} -- wrangler --version`
  - each printed `4.129.0`.
- `git diff --check`
  - exit 0.

The final full `npm run ci:local`, broad API/full-workspace suites, commit, push, PR, merge, deployment, and runtime production verification remain root-owned after integration onto the approved Task 2 main revision.

