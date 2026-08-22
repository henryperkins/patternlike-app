# M5 OpenAI Daily Reading Publisher — Handoff Prompt

> **ARCHIVED 2026-08-22 — superseded, then completed.** Superseded by
> [`2026-08-10-openai-daily-reading-publisher-handoff-tasks-9-17.md`](2026-08-10-openai-daily-reading-publisher-handoff-tasks-9-17.md);
> all seventeen tasks have since landed. "Tasks 5–17 remain", below, was true
> when written. Do not execute. Index: [`../README.md`](../README.md).

Paste everything below the rule into a fresh session. It is written to be read
by the agent picking the work up, not about them.

---

## Your task

Finish implementing the OpenAI daily reading publisher. Phase A (Tasks 1–4) is
landed and green; **Tasks 5–17 remain**.

Read these three, in this order, before touching anything:

1. `docs/superpowers/specs/2026-08-10-openai-daily-reading-publisher-design.md`
   — the approved design. Authoritative. If implementation evidence requires a
   behavioural change, stop and amend the design before changing code.
2. `docs/superpowers/archive/plans/2026-08-10-openai-daily-reading-publisher.md` — the
   task-by-task plan, including 41 Global Constraints that bind every task.
3. `docs/superpowers/archive/plans/2026-08-10-openai-daily-reading-publisher-execution-notes.md`
   — the ledger, the recorded implementation base, and Phase A's deviations.

Also read `CLAUDE.md` and `AGENTS.md`. The invariants in `CLAUDE.md` are real
and several of them are load-bearing for the tasks below.

Work task by task in plan order. Each task's Step 5 (or 6/7/8) names its exact
commit subject — use it. Follow the plan's TDD order: write the named failing
test, run it, record the expected failure, then implement. That discipline
already earned its keep in Phase A: it caught a deterministic +1-second bias in
the daily-sky root finder that a test written after the code would have simply
frozen in place.

## Where things stand

Implementation base (Global Constraint 41 — Task 17 Step 2 diffs against it):

```
PATTERNLIKE_M5_IMPLEMENTATION_BASE = 76541c7a2bb1bb2718fc45543eae757806aeaa43
```

| Commit | Task |
| --- | --- |
| `8853eff` | base recorded |
| `76e3267` | 1 — M5 contract family, `schema_version` 0.5.0 |
| `5e6c497` | 2 — shared M5 wire types, pinned local-day resolver |
| `0fae273` | 3 — daily-sky calculation policy |
| `c070b85` | 4 — `POST /v1/daily-sky`, ephemeris goldens |
| `fdf1b73` | Phase A ledger and deviations |

Everything is green at `fdf1b73`: `python contracts/validate_schemas.py`,
`npm run test:contracts`, shared 57, reading-engine 51, calc-stub 134,
api 525, root `npm run typecheck`, and the production Worker dry-run
(222.72 KiB gzipped).

**No production gate has been touched.** No remote migration, no
`wrangler secret put`, no deploy, no cron, no live OpenAI call. Keep it that
way: Global Constraint and Task 17 Step 7 both require explicit authorization
before any of it, and the plan's rollout sequence is eleven separately gated
steps.

## What Phase A already gives you

Import these rather than rebuilding them. Plan Task 2's interface note is
binding: consumers import the shared types and do **not** redeclare local
lookalikes.

### `@patternlike/shared`

Reading wire types (`src/m5-reading-types.ts`) — `M5_SCHEMA_VERSION`,
`M5_OUTPUT_SCHEMA`, `M5_ASSEMBLY_MODE`, `AI_CONSENT_DATA_CATEGORIES` (the
frozen seven, in display order) and `AiConsentDataCategory`, `M5_SUPPORTED_USES`
(the frozen seventeen) with `isM5SupportedUse()`, `M5AllowedUse`,
`GENERATED_PARAGRAPH_ROLES`, `PARAGRAPH_ROLES_V5`, `FactScope`, `LaneRank`,
`M5FactClass`, and the full interface set: `FactAttributes`, `RequestFact`,
`RequestContext`, `PriorReadingExcerpt`, `ReadingComposition`,
`ReadingGenerationRequest`, `GroundedUnit`, `GeneratedParagraph`,
`ReadingGenerationOutput`, `ReadingParagraphV5`, `DailyReadingV5`,
`DailyReadingResponseV5`, `DailyReadingPreparationV5`, `FactRefV5`,
`ContextRefV5`, `ParagraphEvidenceV5`, `CalculationRecordV5`, `ModelRecordV5`,
`ValidationResultV5`, `ReadingEvidenceV5`.

Daily-sky wire types (`src/daily-sky-types.ts`) — `DAILY_SKY_POLICY_ID`,
`DAILY_SKY_POLICY_VERSION`, `LOCAL_DAY_RESOLUTION_POLICY_VERSION`,
`DailySkyRequest`, `DailySkyResponse`, `DailySkyFact`, `DailySkyFactCore`,
`DailySkyFactIdentityV1`, `NormalizedUncertainty`, `LocalDayWindow`,
`DailySkyWindow`, `LocalDateResolution`, `AnchorResolution`,
`DAILY_SKY_FACT_KIND_RANK`, `ANCHOR_SAMPLED_KINDS`, `PERSONALIZED_KINDS`,
`orderDailySkyFacts()`, `buildDailySkyFactIdentity()`,
`renderDailySkyFactId()`, `lunarPhaseOf()`, `zodiacSignOf()`,
`classifyV5CalculationFailure()`. `sealDailySkyFact()` is in `src/index.ts`
(async, WebCrypto).

`src/types.ts` gained `EvidenceLane` and `LifeDomain` as the single M0-derived
source. `packages/reading-engine/src/types.ts` still declares structurally
identical copies. **Task 5 should retire the engine's copies in favour of
shared's** — the comment in `shared/src/types.ts` promises exactly that, and
Task 5 is where reading-engine takes its `@patternlike/shared` type-only
dependency.

### `apps/api`

- `src/services/tzdb.ts` — `TZDB_DATA_VERSION`, `hasZone()`,
  `zoneOffsetMinutesWest()`, `zoneOffsetMillisEast()`, `pinnedLocalDate()`.
- `src/services/local-day.ts` — `TZDB_VERSION` and
  `resolveDailySkyWindow(zone, localDate): LocalDateResolution`. The V1
  functions (`localDayWindow`, `resolveLocalDay`, `isCurrentOrPreviousLocalDay`)
  are untouched and still read `Intl`; V5 uses the pinned database. A test
  asserts the two agree on ordinary days.
- `src/services/daily-sky-client.ts` — `buildDailySkyRequest()`,
  `invokeDailySky()`, `dailySkyFailureCode()`, `DailySkyInvocation`
  (`ok` / `refused` / `unavailable`, the same three-way split as
  `invokeCycles`).
- `test/mock-calc-service.ts` — now dispatches **by host, then path**, and
  fails closed on an unknown host.

### `apps/calc-stub`

- `src/daily-sky.ts` — `validateDailySkyRequest()`, `calculateDailySky()`,
  `handleDailySky()`, `DailySkyOptions` (inject an `EphemerisSource` to test
  without data files).
- `src/daily-sky-policy.ts` — every versioned constant.
- `src/engine.ts` now exports `signOf()` and `houseNumber()`.
- `src/server.ts` serves `POST /v1/daily-sky` behind the shared
  `serviceAuthDenial` guard.
- `src/fixtures/daily-sky-golden-vectors.json` — two real ephemeris days.

## Decisions Phase A made that you must not silently reverse

**`generation_anchor` is the freeze instant, not the day anchor.** V2 carries
both: `anchor_at` (local noon, inside the half-open day, what the daily-sky
facts were sampled at) and `generation_anchor` (when the command was frozen,
published as the reading's `generated_at`). A pre-generated edition is frozen
30–75 minutes *before* its own local day starts, so `generation_anchor` is
legitimately outside `[day_start_at, day_end_at)`. The validator's
`generation_command_v2_policy` checks `anchor_at` for that containment, never
`generation_anchor`.

**`buildDailySkyRequest` requires an explicit `ephemerisDataVersion`.** Task 8
must pass the value the *cycle scan response* just reported, so both calculation
calls in one freeze are proven to be one ephemeris vintage. `invokeDailySky`
fails closed when the service echoes a different one.

**M5 drops the natal Moon at the request boundary.** The frozen M3 cycle
contract sends the natal Moon and lets the service filter it; M5 refuses the
request. Suppression is enforced by never sending the input. Do not "fix" the
asymmetry — M3 is frozen and M5's boundary is new.

**`reading-generation-output.schema.json`'s ROOT is the strict object.** It is
the only schema in the repo with no titled `oneOf`, because OpenAI strict mode
needs a self-contained root-object schema with no external `$ref`. Task 7 sends
that file verbatim as `text.format.json_schema.schema`. The fixture map in
`contracts/validate_schemas.py` points at the document URI with no `#/$defs/`
pointer, deliberately.

**`factAttributes` is the whole point of the provider packet.** Every body,
aspect, sign, house, phase, lunar phase, degree, timestamp, and date a fact
licenses is enumerated there. Task 5's candidate validator freezes its accepted
vocabulary from the union of those arrays across the selected facts — that is
what turns "the model stated a degree nobody calculated" into a mechanical check
rather than an editorial judgement. Do not replace it with a regex over prose.

**Two identities, not one.** `generation_input_id` (`gin_sha256_` + the **full**
64-hex digest, not truncated) names the frozen eligible input and policy.
`content_hash` and `provider_response_hash` name the candidate that won
publication. OpenAI is nondeterministic; one id cannot answer both questions.
`completeReading()`'s claim compare-and-swap is the only publication authority.

## Traps that will cost you an hour each

**The Bash tool is Git Bash / POSIX sh, not PowerShell.** A PowerShell
here-string (`@'…'@`) is passed through literally and will end up as your commit
subject. Use heredocs: `git commit -F - <<'EOF'`.

**Python is native Windows Python.** `/tmp` resolves to `\tmp`, which does not
exist. Use the session scratchpad directory. `Path.write_text` also translates
newlines — for surgical TypeScript edits prefer the `Edit` tool, which will not
mangle an escaped `\n` inside a string literal.

**The Bash working directory persists between calls.** A `cd apps/calc-stub`
silently breaks every later relative path. Use absolute paths.

**`@cloudflare/vitest-pool-workers` cannot load CJS or UMD from
`node_modules`.** It fails with `SyntaxError: Unexpected token 'export'`, and
`server.deps.inline` does not help. This is why `moment-timezone` is a
**data-only** dependency: `src/services/tzdb.ts` reads
`moment-timezone/data/packed/latest.json` and decodes the packed format itself,
pinned by `tzdb.test.ts` against 280 offsets taken from the library in Node.
Before adding any dependency the Worker imports, check it ships ESM.

**`contracts/validate_schemas.py`'s `check_m5_manifest()` requires each
schema's `defines` array to equal its `$defs` keys exactly.** Add a `$defs`
entry to any `contracts/m5/*.schema.json` and the validator fails until
`SCHEMA_MANIFEST.json` is updated too. It also pins the normalized digest of
`contracts/m3/SCHEMA_MANIFEST.json` and rejects a dirty `contracts/m3` — do not
edit anything under `contracts/m0` or `contracts/m3`.

**`FIXTURE_SCHEMA` and `POLICY_ONLY` in that validator are keyed by package.**
m3 and m5 both ship `generation-command.*`, `daily-reading.*`, and
`reading-evidence.*` fixtures. Never flatten them.

**`apps/api/vitest.config.ts` `fileParallelism: false` must stay.** The suites
share one D1 database and `resetDb()` is not safe across parallel files.

**`resetDb()` in `apps/api/test/helpers.ts` deletes from an explicit
FK-ordered table list.** Task 6 adds tables; a table missing from that list
leaks rows between suites.

**Every API test must `seedUser()` first** — `X-User-Id` names a user, it does
not create one.

**`npm test -w @patternlike/calc-stub` runs `pretest`, which downloads the
pinned ephemeris.** It is cached at `apps/calc-stub/data/ephe` and gitignored.
Never stage it, or `apps/calc-stub/dist`.

**CRLF warnings on commit are normal.** There is no `.gitattributes`; the
manifest digest checks normalize newlines precisely because of it.

## Task-specific pointers

**Task 5 (reading-engine).** `partitionContext()` and the rest already live in
`packages/reading-engine/src/eligibility.ts` — `prepareConstrainedReadingInput()`
must call it internally, not reimplement the partition. Take the type-only
`@patternlike/shared` dependency and retire the duplicate `LifeDomain` /
`EvidenceLane`. The engine's purity contract is real: no fetch, no D1, no
`Date.now()`, no crypto, and tsconfig omits the DOM lib.

**Task 6 (migration).** `contracts/smoke_check.py` is the harness — read
`check_upgrade_over_populated_0001` and `check_refuses_to_destroy_rows` for the
0002 precedent before writing 0003. Move `context_signals.value_enc` from
`UNWRITTEN_ENCRYPTED_COLUMNS` to `ENCRYPTED_COLUMNS` in `apps/api/src/db/users.ts`
before its first writer exists, or DEK rotation destroys the key over live data.

**Task 7 (OpenAI adapter).** The seam is already routed: `mock-calc-service.ts`
exports `OPENAI_HOST` and currently answers `api.openai.com` with a 501
"seam is not installed". Replace that branch — do **not** install a second
fetch interceptor. `verify-openai-reading-model.ts` may be written and
typechecked, but running it against a real key is a production gate.

**Task 8 (V2 commands).** Reuse `toAssemblyUncertainty()` and
`natalPositionsForScan()` from `apps/api/src/services/generation-command.ts`
rather than writing new projections. Read `reserveInitial` / `reserveReissue` /
`replaceCommand` in `src/db/generation.ts` for the exact columns each binds —
the hardcoded `assembly_mode = 'deterministic'` and non-null `release_version`
are what the V1/V2 union has to displace.

**Task 12 (scheduler).** `resolveDailySkyWindow()` already returns
`{ ok: false, reason: "skipped_local_date", nextRepresentableDate }` for a
deleted local date (Pacific/Apia 2011-12-30 is the test case). Consume it; do
not re-derive it.

**Task 14 (web).** `apps/web/src/lib/reading-format.ts` maps paragraph roles to
kickers and tones and already has entries for the M3 roles. v5 adds
`collective_context` and removes `safety_fallback`; the v3 entry must survive
for historical readings.

## Verification

Focused lanes are named per task in the plan. The full gate, from the repository
root:

```bash
python contracts/validate_schemas.py
python contracts/m0/smoke_check.py
python contracts/smoke_check.py
npm run typecheck
npm test
npm run build
```

`npm run build` runs the production Worker dry-run and requires `apps/web/dist`,
which the root `build` script builds first. Task 17 adds seven `rg` invariant
searches and the wrangler config assertions; a no-match `rg` exit there is the
expected evidence, not a failure.

## When you finish

Task 17 Step 7 is a handoff report, not a deployment: the exact final commit,
changed-file scope, local verification results, known rollout prerequisites, and
the separately authorized production gates. Do not apply the remote migration,
set secrets, deploy, enable first-open, or activate cron unless the user
explicitly authorizes that specific gate.

Update the ledger and the deviations section in
`2026-08-10-openai-daily-reading-publisher-execution-notes.md` as you go. Where
you depart from the plan, record why there — the plan is authoritative, and a
reader comparing the two deserves the reason.
