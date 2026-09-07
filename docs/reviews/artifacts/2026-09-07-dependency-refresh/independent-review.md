# Task 3 independent spec and quality review

## Review target

- Candidate: `/home/henry/patternlike-app/.worktrees/dependency-refresh-20260907`
- Reviewed head: `0dc4efc636fc49d05b224555a24d6c9feeff0c62`
- Dependency implementation: `532032824820b2ca54454e39286fede944cb9427` over review base `f242a3fb8369e7ebb5e56dcb53095108b046c1ac`
- Fix round 1: root `package.json` plus root lock metadata and review receipts; cumulative dependency source scope is `apps/api/package.json`, `apps/ontology-signer/package.json`, `apps/web/package.json`, `package.json`, and `package-lock.json`
- Working tree observed clean before and after review

## Verdicts

- **Spec verdict: PASS.** The selected dependency versions, root-authorized workers-types and signer alignment, old PR #7 intent, exact install-script approvals, truthful Node 22 floor, bounded scope, and lock graph satisfy the approved brief.
- **Code-quality verdict: PASS.** No open Critical or Important findings remain. Fix round 1 resolves the only Important finding without a blanket script approval, dependency-version movement, runtime/config change, or unrelated package-family update.

## Findings

### Critical

None.

### Important

None open.

### Resolved in fix round 1

1. **Exact install-script approvals and Node metadata now match the selected graph.** `package.json:31-40` sets the project floor to `>=22` and approves exactly `workerd@1.20260815.1` and `workerd@1.20260903.1`. `package-lock.json:7-16` carries the same root engine floor, while the two approved versions are the only install-bearing workerd nodes at `package-lock.json:5203-5208` and `package-lock.json:5363-5368`. The obsolete `workerd@1.20260730.1` approval is gone. The supplied npm 11.19.1 strict-policy receipts show RED with exactly those two unapproved scripts before the fix and GREEN with no unreviewed scripts after it. Ordinary npm 11 defaults are correctly described as advisory; the report makes the strict opt-in boundary explicit. Independent re-review also executed both installed binaries and observed `workerd 2026-08-15` and `workerd 2026-09-03`.

## Passing review evidence

- Commit `5320328` has parent and merge base `f242a3fb8369e7ebb5e56dcb53095108b046c1ac`; its diff is four files, 240 insertions, and 85 deletions, and `git diff --check` passed.
- Fix commit `0dc4efc` changes only the root manifest/lock metadata needed by the finding plus the dependency review and raw RED/GREEN receipts. Relative to `5320328`, the source diff is exactly the two workerd approval replacements and root/lock Node floor alignment. `git diff --check 0dc4efc^..0dc4efc` passed for the scoped fix files and receipts.
- The three workspace manifests exactly match their lockfile workspace records. The fixed candidate lock SHA-256 is `f33a1ab50a6bf28b56700e8f4f603d38b1c098e41c334312b3a7ba51f12cc80b`; its only change from the implementation lock is the root engine metadata. The original candidate's pre/post-`npm ci` hash receipt remains valid for the dependency graph.
- Under the pinned Node `v22.23.2` and npm `10.9.8`, targeted offline `npm ls` resolved Hono `4.13.7`, direct Wrangler `4.129.0`, pool-workers `0.22.0`, workers-types `5.20260907.1`, Vitest/runner/snapshot `4.1.11`, pool Wrangler `4.124.0`, pool/direct Miniflare `5.20260815.0-alpha` / `5.20260903.0-alpha`, and Undici `7.29.0` with no invalid or missing peer report.
- An offline semver probe confirmed Node 22 satisfies Wrangler 4.124/4.129 and Miniflare 5 engine floors, Vitest 4.1.11 satisfies every pool `^4.1.0` peer, and workers-types 5.20260907.1 satisfies both Wrangler peer ranges (`^5.20260815.1` and `^5.20260903.1`).
- The duplicate Wrangler/Miniflare/workerd branches are required by pool-workers 0.22.0's exact Wrangler 4.124.0 dependency versus the direct 4.129.0 pin. The semantic lock comparison found no unrelated direct-package movement. Zod 4.4.3 and `@speed-highlight/core` 1.2.24 are dependencies of the selected Cloudflare toolchain. Licenses remain MIT, MIT OR Apache-2.0, Apache-2.0, or the pre-existing CC0-1.0 family represented by those packages.
- The old Dependabot commit `d06fba3` intended to raise Hono, pool-workers, API/web Wrangler, and transitive Undici. This candidate preserves that intent with current compatible releases and removes Undici 7.28.0 from every Cloudflare/Miniflare path; jsdom's separate Undici 8.9.0 branch is unchanged and valid.
- `apps/api/vitest.config.ts:71-96` and `apps/api/vitest.probe.config.ts:47-52` already provide the auxiliary signer as an explicit `ESModule` manifest, satisfying the pool 0.21+ migration requirement. The signer keeps exact pin style at `apps/ontology-signer/package.json:17-21`; API/web retain caret range style at `apps/api/package.json:41-54` and `apps/web/package.json:39`.
- Primary references checked from the implementation record: [Hono 4.13.7](https://github.com/honojs/hono/releases/tag/v4.13.7), [Wrangler 4.129.0](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.129.0), [pool-workers 0.22.0](https://github.com/cloudflare/workers-sdk/releases/tag/%40cloudflare/vitest-pool-workers%400.22.0), [pool-workers 0.21.0 migration](https://github.com/cloudflare/workers-sdk/releases/tag/%40cloudflare/vitest-pool-workers%400.21.0), and [Undici 7.29.0](https://github.com/nodejs/undici/releases/tag/v7.29.0).

## Validation actually run

- Read the implementation brief, research record, implementation report, and supplied frozen diff.
- Inspected `git show`, parent/merge-base identity, `git diff --name-status`, `git diff --numstat`, `git diff --check`, and clean status.
- Read fix-round-1 requirements, the supplied source diff, the corrected merge review, and the committed strict npm 11 RED/GREEN receipts; verified their hashes and exact contents.
- Compared all lockfile package-path additions, removals, and version changes against the base with an offline Node script.
- Compared manifest dependency objects with the lockfile workspace records and inspected relevant lock entries, licenses, engines, dependencies, peers, optional peers, and install-script markers.
- Compared the complete workerd install-script node set with the root approval set and confirmed exact equality; compared root manifest and lock engine metadata with `.nvmrc` and Wrangler's Node floor.
- Ran targeted offline `npm ls` and an offline semver engine/peer probe under Node `v22.23.2` / npm `10.9.8`.
- Inspected the API and signer Vitest configurations, signer Wrangler configuration, `.nvmrc`, the old Dependabot delta, and the history/rationale of the root `allowScripts` policy.
- Executed the two already-installed workerd binaries as a read-only probe; they reported the expected 2026-08-15 and 2026-09-03 versions.
- No install, test suite, build, product-source edit, commit, branch change, network request, or external side effect was performed for either review round. The strict npm 11.19.1 clean-install RED/GREEN result is supplied root evidence inspected here, not an install independently rerun by this reviewer.

## Remaining root-owned gate

No review remediation remains. After integrating this candidate in the approved sequence with the preceding UI merge, root still owns the authoritative `npm run ci:local` run on one frozen final revision, its paste-ready summary, final diff/status review, commit/push/PR/merge, Cloudflare build/deploy observation, and any production verification. The implementer's focused checks and root's strict npm 11 clean-install proof are supporting evidence; neither replaces the final aggregate gate on the integrated revision.
