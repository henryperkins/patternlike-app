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
| 5 | Constrained-input compiler and candidate validator | done — `5dd3260` |
| 6 | Empty-state M5 migration and storage primitives | done — `8645d03` |
| 7 | Configured provider-neutral OpenAI boundary | done — `e26d0f8` |
| 8 | Frozen V2 commands | done — `391a5b0` |
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

**Task 5 — `npm install` was already broken at HEAD.** `apps/api/package.json`
carried its `//moment-timezone` note INSIDE the `dependencies` object, and npm
validates every key there as a package name: `npm install`, `npm ci`, and
`npm install --package-lock-only` all failed with `EINVALIDPACKAGENAME`. The lock
file was consistent because npm strips `//` keys when writing it, which is why
nothing caught it. Task 5 has to touch `package-lock.json`, so the note moved to
the top level of the same file, verbatim.

**Task 5 — `PreparedConstrainedReadingInput` is a superset of the planned
interface.** It adds `selected_prior_readings` and `packet_bytes`. Task 8 writes
the command's `prior_readings` pin from the survivors of the packet ceiling, and
reconstructing which ones survived by matching prose would be worse than
returning them; `packet_bytes` is what makes the ceiling testable as an exact
boundary rather than an approximation.

**Task 5 — the identity preimage excludes rejections.** Execute re-runs the
compiler over the command's frozen SUBSET, which no longer contains the corpus
the rejections described, so a preimage naming them could never be reproduced and
the mismatch would read as an integrity defect. A test proves re-running over the
selected output reproduces both hashes.

**Task 5 — `nat_` handles are supplied, not derived in the engine.** The engine's
purity contract has no crypto. `projectNatalFacts()` in
`services/generation-command-v2.ts` seals them, and both enqueue and execute call
that one function.

**Task 5 — cycle-phase vocabulary is only checked inside an explicit phase
construction.** "building" and "peak" are ordinary English words; scanning for the
bare terms would reject a sentence about a building. Lunar phase names are
multiword astrology terms and are scanned directly.

**Task 6 — `users.next_due_at` already existed.** 0001 declared it and nothing
ever wrote it, so 0003 adds only the two partial indexes. The first smoke run
caught the plan's implication as `duplicate column name`.

**Task 6 — the v5 Today and evidence PROJECTIONS landed here, not in Task 13.**
Task 10 publishes v5 rows and Task 13 adds the dual reader, so the plan's own
ordering leaves a window in which a published v5 reading 500s on read.
`db/readings.ts` returns a discriminated `StoredReading`, `ReadingEvidence` became
a discriminated union, and `routes/readings.ts` gained `projectReadingV5` and
`projectEvidenceV5`. Task 13 still owns consent gating and status mapping.

**Task 6 — `completeReading` takes a `PredecessorTransition`.** Task 6's
Interfaces section declares the type and Task 11 adds `retain_invalidated`;
wiring it with the storage change avoided two shapes of one publication
authority. Both the opening and the closing assertion branch on it.

**Task 6 — 0003 enforces the reading_key namespace with a CHECK.** The design
argues the two grammars are disjoint; a CHECK is what makes that true rather than
assumed, and the collision it prevents would be a cross-format overwrite of a
global UNIQUE column.

**Task 7 — an absent `READING_V5_ROLLOUT` resolves to `off`.** A value that is
PRESENT and unrecognised is rejected in every environment, but absence defaults to
the kill switch. Both wrangler blocks declare it explicitly, so absence means a
hand-built environment, and a hard 503 on every request over a var whose absence
means "feature disabled" would be a worse outage than the feature staying off.

**Task 7 — the publisher check runs before `checkSecureConfig`'s development
short-circuit.** The local canary runs with `ENVIRONMENT=development` and a real
key. While the rollout is off this costs nothing: every publisher value may be
absent, and only a present-and-malformed value is rejected.

**Task 7 — the OpenAI fake is keyed on the MODEL, not on a header.** The plan says
"scenario header/request ID". The adapter deliberately sends the Worker no
correlation header, and the model is the one field it must send verbatim from the
frozen pin; keying on anything else would assert a request shape the real adapter
never produces. `network_error` is proven with a stubbed `fetch` instead, because
miniflare turns a throwing `outboundService` into a 5xx RESPONSE — a different
failure from "nothing reached the provider".

**Task 7 — `PublisherConfigPin` lives in `apps/api`.** It is an API-internal
command type, and `m5-reading-types.ts` says those stay out of the package the
AGPL calculation service imports.

**Task 8 — `generation-command-v2.ts` was written before its test.** A departure
from Global Constraint 2, recorded rather than absorbed. Its shape had to be
settled against three frozen contracts at once — the command, the provider
request, and the publisher pin — and a test written against a guessed shape would
have been rewritten rather than run. Every other module in Tasks 5-8 followed the
plan's order, and `generation-command-v2.test.ts` validates the result against
`contracts/m5/generation-command.schema.json` itself rather than against a shape
somebody typed twice.

**Task 8 — reading feedback reaches a packet through the ordinary source gate.**
`context-compiler.ts` offers `reading_feedback` rows as signals under USR-12, the
registry source that describes them. With no `context_source_permissions` surface
they are rejected like any other ungranted source, so the twenty-record cap the
engine implements is currently unreachable in production — and becomes reachable
with no code change when M4 adds the permission row.

**Task 8 — prior readings come only from stored v5 artifacts.** A v3 reading has
no headline, and manufacturing one from its prose would invent a repetition
signal rather than record one.

**Task 8 — `dispatchGeneration` answers `policy_unsupported` for a V2 command.**
Not a placeholder: it is the design's own rule for a frozen command version a
deployment does not implement. Task 10 extends the same seam.

## Deferred production gates

None of these are performed by implementation work; each is separately
authorized at execution time.

- Remote `0003` migration against `patternlike-ops`.
- `wrangler secret put OPENAI_API_KEY` and the publisher vars.
- Operator approval of `READING_DAILY_PROVIDER_CALL_LIMIT` and its recorded
  worst-case daily spend.
- Production Queue `max_concurrency = 4`.
- `env.production.triggers` cron activation and the `hybrid` rollout state.
