# Task 5 documentation consolidation implementation

## State and freeze

- Worktree: `/home/henry/patternlike-app/.worktrees/documentation-consolidation-20260907`
- Branch: `codex/documentation-consolidation-20260907`
- Base/HEAD: `29af8d2bef354a6b3c6a3ac15ee360cf34227ea5`
- Source diff SHA-256: `a83186cdccca9afc7e9c2446c083846b0240c47e53de6197905bcd0abcda0520`
- Freeze status: nine owned files modified and uncommitted; no other worktree path changed.

## Implemented paths

- `README.md`
  - Rebuilt the workspace and contract overview from the current inventory.
  - Pinned setup to Node 22 and durable ordered local migrations.
  - Replaced `VITE_CONSENT_ID` scaffolding with a source-backed grant-first
    account-processing curl flow and exact returned consent id.
  - Corrected local seed semantics, exact `127.0.0.1` Auth0 origin, recovery
    access, withdrawal/freeze/regrant, and generative-permission separation.
  - Documented current Geoapify configuration, missing-key behavior, and manual
    entry fallback without claiming live credential or provider proof.
  - Added the automatic Workers Builds release path, explicit-SHA manual
    procedure, release metadata/receipt semantics, and separate evidence layers.
- `AGENTS.md`
  - Updated the repository map, Node floor, ordered migration command, and Git
    history statement while preserving the billing-lock/local-gate discipline.
- `CLAUDE.md`
  - Updated Node, workspace, contract, and migration guidance.
  - Added the landed content-free Daily receipt and release-evidence boundary.
  - Corrected Worker release guidance and the complete `run_worker_first` list.
  - Replaced stale rollback scheduling claims with current two-lane source and
    bounded Daily, Pattern, Codex, pause, recovery, failure, and retention rules.
- `.env.example`
  - Removed only the obsolete consent scaffolding and corrected comments; no
    environment value changed.
- `docs/deploy/openai-pattern-rollout.md`
  - Replaced the insufficient bare deploy command with Workers Builds and the
    explicit-SHA manual procedure reference.
  - Replaced the stale single-cron account with both configured lanes and the
    exact service-authenticated recovery boundaries.
- `docs/reviews/2026-08-26-documentation-drift-reconciliation-design.md`
  - Prepended a dated six-line snapshot notice linking current authorities. The
    original historical body is byte-identical.
- `apps/api/wrangler.toml`
  - Corrected two documentation comments only. All TOML values are unchanged.
- `apps/api/src/routes/internal-generation.ts`
  - Corrected the two stale route comments only. Runtime TypeScript is unchanged.
- `fly.toml`
  - Corrected the PWA deployment comment only. All TOML values are unchanged.

## Source authority and provenance map

The selective correction map came from historical PR 32 commit
`eefefb5d6b0d3b4d33fd4ca3730b3ccb6124a389` and PR 38 commit
`58a9d956da17d6aa2085b41c1143f13d2b435be7`, through
`task-5-doc-analysis.md`. Neither historical commit was cherry-picked. Useful
setup, consent, deployment, recovery, and snapshot-notice corrections were
rewritten against the integrated candidate; obsolete migration ceilings,
Google behavior, rollout names, prompt pins, and live claims were dropped.

| Documentation claim | Current authority inspected |
| --- | --- |
| Node/workspaces/scripts/migrations | `.nvmrc`, root and workspace `package.json` files, `db/d1/MIGRATIONS.json` |
| Local seed and account-processing grant | `scripts/dev/seed-dev-user.mjs`, `account-processing-policies.ts`, `account-processing-consents.ts`, `account-processing-consents.ts` DB module, `auth.ts`, `birth.ts`, web onboarding/API client |
| Exact local/Auth0 origin | `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/lib/auth.ts` |
| Geoapify posture and fallback | `apps/api/wrangler.toml`, geocoder adapter/index and place/consent routes, current Geoapify decision and rollout runbook |
| Scheduled and manual recovery | `apps/api/wrangler.toml`, `scheduled.ts`, `run-reading-scheduler.ts`, `pattern-sweep.ts`, `internal-generation.ts`, `internal-pattern.ts`, `codex-provider-maintenance.ts` |
| Release attestation and Daily receipts | `docs/deploy/release-attestation.md`, release-attestation service/health/config guard, `0029_daily_publication_receipts.sql`, receipt DB/publication source |
| API/PWA and Fly topology | root/API deploy scripts, `[env.production.assets]`, exact `run_worker_first`, `fly.toml` |

## Verification performed

All checks were local and used Node `v22.23.2` through `nvm use 22` where Node
was involved.

- `npm run check:pattern-source -w @patternlike/api` — exit 0,
  `PASS pattern_source_fingerprint_current`.
- `git diff --check` — exit 0.
- Python `tomllib` parse of `apps/api/wrangler.toml` and `fly.toml` — exit 0.
- Bash syntax parse of the complete grant-first README example and execution of
  its consent-id JSON extraction against a representative handler response —
  exit 0.
- JSON parse of `package.json` and `db/d1/MIGRATIONS.json`, used as command and
  migration authorities — exit 0.
- Added-local-link/anchor check across the modified Markdown authorities — exit
  0, nine links validated.
- Targeted stale-term absence and protected prompt/source/privacy wording
  presence checks — exit 0.
- Boundary comparisons — exit 0: historical body unchanged after the notice;
  `.env.example`, both TOML files, and TypeScript route source have no
  non-comment changes.
- Final path/status and full diff review — exactly the nine paths listed above.

No new tests were added for this reversible documentation change. Per the
brief, no full test suite, build, `ci:local`, or aggregate merge gate was run;
root owns the post-freeze aggregate gate.

## Specification and quality self-review

- Every required current authority is source-backed and phrases repository
  configuration separately from live observation.
- Setup text has no numeric migration ceiling, and dated historical migration
  ledger facts remain dated and unchanged.
- The account-processing example uses the exact policy, headers, returned id,
  and birth authorization semantics. The privacy disclosure boundary remains
  intact.
- Deployment text consistently rejects bare `npm run deploy:api` as sufficient,
  preserves Workers Builds as the automatic API/PWA path, and sends manual
  releases to the clean/gated explicit-SHA procedure.
- Current cron families, pause controls, service authentication, retry/failure,
  retention, and Codex maintenance scope match inspected source.
- Existing Daily prompt/selection/validation pins and Pattern source,
  provenance, privacy, and bounded-assurance wording were preserved.
- No retired API production document, Google implementation, Fly PWA path,
  obsolete Pattern rollout, old prompt tuple, or current live certification was
  introduced.

## Limits and remaining concerns

- This work establishes documentation/source consistency only. Migration 0029
  application, compatible Worker deployment/version and traffic, installed
  runner, provider execution, and reader lifecycle remain separate operational
  evidence owned by root.
- Root reported that both Workers Builds commands were patched and read back at
  `2026-09-07T08:43:42Z`. The source documentation intentionally records the
  durable required command shape rather than promoting that transient
  observation to deployment proof.
- No external endpoint, Cloudflare account, Auth0 tenant, secret inventory, D1
  database, installed runner, or provider was contacted.
- No runtime/config value, contract, migration, dependency, generated source,
  commit, push, merge, or deployment was performed.

## Scoped fix round 1 — 2026-09-07

Root committed the initial Task 5 candidate before this correction. The fix was
made from clean HEAD `787b8f1767a73a9ea020846ff5409b43bee9c3e6` on
`codex/documentation-consolidation-20260907` after reading
`task-5-fix-brief.md`, `task-5-review.md`, and the exact root `package.json`
scripts.

- Corrected only the `npm test` and `npm run build` annotations at
  `CLAUDE.md:14-16`.
- `npm test` now states that it runs all eight workspace test scripts followed
  by `test:content` and `test:contracts`.
- `npm run build` now states that it runs all eight workspaces in declared order
  with web assets before the API production dry-run.
- Readback against `package.json:11-16`, scoped `git diff`, and
  `git diff --check` all passed with exit 0.
- Final fix scope is one modified file, `CLAUDE.md`; file SHA-256 is
  `3487cb765ae7dc8db4a6abb827074b4d1b1f4e354cc6d152a18021642472d83f`.
- Frozen fix diff SHA-256 is
  `d7d69e00ef10532c2e6a9a836350760a9c5f40f3f1efae4d6287519f7f34d3a8`.
- Per the fix brief and latest user restriction, no test, build, runtime command,
  external call, install, subagent, commit, push, merge, or deployment was run.
