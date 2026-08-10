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
| 1 | M5 contract family | done — `76e3267` |
| 2 | Shared daily-sky wire types and local-day resolution | done — `5e6c497` |
| 3 | Pure daily-sky calculation policy | done — `0fae273` |
| 4 | Ephemeris goldens and `POST /v1/daily-sky` | done — `c070b85` |
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

## Deviations from the plan, and why

Recorded here rather than silently absorbed, because the plan is authoritative
and a reader comparing the two deserves the reason.

**Task 2 — `moment-timezone` is a data dependency, not a code one.** The plan
says to add it "for the scheduling resolver". Its runtime is a UMD file inside a
CommonJS package, and `@cloudflare/vitest-pool-workers` refuses to load it at
all (`SyntaxError: Unexpected token 'export'`, with and without
`server.deps.inline`). `apps/api/src/services/tzdb.ts` therefore reads only
`data/packed/latest.json` and decodes the packed format itself. The plan's
actual requirement — a `package-lock.json`-pinned tz database version, rather
than the runtime's unversioned `Intl` — is met exactly, and `tzdb.test.ts` pins
the decoder against 280 offsets taken from moment-timezone itself. The Worker
also avoids bundling `moment` to answer two questions.

**Task 3 — `cycles.ts` needed no edit.** The plan lists it as Modify, to
"narrowly export" reuse primitives. `jdFromUnixMs`, `jdToIso`, `EphemerisSource`,
`swissEphemerisSource`, `orientedTargets`, and `wrap180` were already exported;
only `signOf` and `houseNumber` in `engine.ts` were not. `cycles.test.ts` and
`validation.test.ts` needed no edit either and still pass unchanged, which is
the outcome the plan was protecting.

**Task 3 — the root bracket is 0.05 s, not the cycle scanner's 2 s.** A daily-sky
root IS the fact and is rendered to the second, and that second enters the
identity preimage; a two-second bracket rounds to the wrong second about half
the time. The first analytic test run caught this as a clean +1 s bias.

**Task 4 — golden vectors do more than the plan asked.** As well as recording
values, the test recomputes every claimed root directly from the ephemeris and
checks the Sun's 2026 Virgo ingress against a publicly published instant, so an
error present from day one cannot hide behind a self-consistent byte pin.

## Deferred production gates

None of these are performed by implementation work; each is separately
authorized at execution time.

- Remote `0003` migration against `patternlike-ops`.
- `wrangler secret put OPENAI_API_KEY` and the publisher vars.
- Operator approval of `READING_DAILY_PROVIDER_CALL_LIMIT` and its recorded
  worst-case daily spend.
- Production Queue `max_concurrency = 4`.
- `env.production.triggers` cron activation and the `hybrid` rollout state.
