# OpenAI Daily Reading Publisher — Execution Notes

Companion to `2026-08-10-openai-daily-reading-publisher.md` (the plan) and
`../specs/2026-08-10-openai-daily-reading-publisher-design.md` (the approved
design). This file records the facts a later shell cannot re-derive.

## Implementation base

Global Constraint 41 requires the pre-Task-1 commit to be recorded so the final
whitespace and candidate-range checks cover the whole implementation range
rather than a single clean worktree.

```
PATTERNLIKE_M5_IMPLEMENTATION_BASE = 76541c7a2bb1bb2718fc45543eae757806aeaa43
```

That commit is `docs: approve and plan OpenAI reading publisher`, the last
commit before any M5 runtime change. Restore it in a new shell with:

```powershell
$env:PATTERNLIKE_M5_IMPLEMENTATION_BASE = "76541c7a2bb1bb2718fc45543eae757806aeaa43"
```

Task 17 Step 2 runs `git diff --check "$env:PATTERNLIKE_M5_IMPLEMENTATION_BASE..HEAD"`.

## Task ledger

| Task | Subject | Status |
| --- | --- | --- |
| 1 | M5 contract family | pending |
| 2 | Shared daily-sky wire types and local-day resolution | pending |
| 3 | Pure daily-sky calculation policy | pending |
| 4 | Ephemeris goldens and `POST /v1/daily-sky` | pending |
| 5 | Constrained-input compiler and candidate validator | pending |
| 6 | Empty-state M5 migration and storage primitives | pending |
| 7 | Configured provider-neutral OpenAI boundary | pending |
| 8 | Frozen V2 commands | pending |
| 9 | Centralized generation failure policy | pending |
| 10 | V5 execution and atomic publication | pending |
| 11 | Fact invalidation and repair | pending |
| 12 | Bounded hybrid scheduler | pending |
| 13 | AI consent routes and dual-version projections | pending |
| 14 | Today, provenance, Context & Privacy | pending |
| 15 | Evaluation lanes | pending |
| 16 | Product truth and production runbook | pending |
| 17 | Final candidate gate and review | pending |

## Deferred production gates

None of these are performed by implementation work; each is separately
authorized at execution time.

- Remote `0003` migration against `patternlike-ops`.
- `wrangler secret put OPENAI_API_KEY` and the publisher vars.
- Operator approval of `READING_DAILY_PROVIDER_CALL_LIMIT` and its recorded
  worst-case daily spend.
- Production Queue `max_concurrency = 4`.
- `env.production.triggers` cron activation and the `hybrid` rollout state.
