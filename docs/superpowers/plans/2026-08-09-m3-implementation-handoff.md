# M3 Implementation — Handoff

> **Read this with** [`2026-08-09-m3-daily-reading-pipeline.md`](./2026-08-09-m3-daily-reading-pipeline.md),
> which is the design. **The design has now been reconciled with the code**
> (2026-08-09): the nine corrections in §4 and the divergences in §10 are folded
> into it, so it no longer lags. This document remains the record of how that
> happened and what was decided along the way.

**Task:** implement the M3 daily-reading pipeline design, with nine corrections
found by verifying the design against the tree first.

**Status: phases 0, 1, 2, and 3 complete and verified. Phases 4–7 not started.**

---

## 1. Where to pick up

Phase 4 — immutable enqueue, durable outbox dispatch, reissue and command
replacement, claim leases, cycle persistence, and atomic completion. Design §5
is the specification and is current.

Phase 4 also carries the Worker-side calc client: `POST /v1/cycles` exists and
nothing in `apps/api` calls it. `invokeCycles` beside `invokeCalc` in
`apps/api/src/services/calc-client.ts`, plus a `/v1/cycles` branch in
`apps/api/test/mock-calc-service.ts` (which must be dispatched **before** the
`endsWith("/v1/calculate")` guard, since anything else 404s today), belong with
the writer that needs them.

Two identity gaps must be pinned before a pass row can be persisted: `cyp_` has
no preimage document or golden vector, and `cyclePin.cycle_hash` has no stated
normalization. Both are named in design §7.

## 2. Verify the current state first

```bash
npm run typecheck            # 5 workspaces, clean
npm run test:contracts       # M0 frozen + M3 package + both smoke checks
npm run test -w @patternlike/shared           # 23 tests
npm run test -w @patternlike/reading-engine   # 51 tests
npm run test -w @patternlike/calc-stub        # 96 tests (46 pre-existing + 50 cycle)
npm run test -w @patternlike/api              # 305 tests, 18 files
```

All of the above pass as of this handoff. If one does not, that is a
regression, not a starting condition.

`@patternlike/calc-stub`'s `pretest` downloads ephemeris data pinned by commit
and SHA-256 into `apps/calc-stub/data/ephe` — note `data/ephe`, not `ephe`. The
first test run needs network.

## 3. What landed

### Phase 0 — `contracts/m3/` at `schema_version 0.3.0`

Ten JSON Schema documents, two OpenAPI documents, a manifest, ~50 fixtures, and
a repo-level validator. `contracts/m0/` is **byte-frozen and untouched** — this
is enforced two ways on every validator run: the M0 manifest's SHA-256 is
recorded in the M3 manifest's `predecessor` block, and `git status --porcelain`
over the directory must be empty.

| File | Holds |
| --- | --- |
| `common.schema.json` | M3 vocabulary; everything unchanged is `$ref`d from M0 by absolute `$id` |
| `daily-reading.schema.json` | **`daily-reading-v3`** — the output schema M0 named but never shipped |
| `assembly-identity.schema.json` | The closed `assemblyIdentityInputV1` hash preimage |
| `generation-command.schema.json` | `generateDailyReadingCommandV1` |
| `reading-assembly.schema.json` | `assemblyRequest` — `assembly_id` replaces `reading_key` |
| `reading-evidence.schema.json` | `readingEvidenceGraph` v0.3 |
| `cycle-identity.schema.json` | `cycleIdentityV1` (branch + winding preimage) |
| `cycle-request.schema.json` / `cycle-response.schema.json` | `POST /v1/cycles` |
| `content-release.schema.json` | M0 bundle + timing templates + universal fallbacks |
| `openapi/openapi.yaml` | Complete successor public API (18 paths) |
| `openapi/calc.openapi.yaml` | Calc service (4 paths), separate so `/v1/cycles` is not advertised on the Worker origin |

- `contracts/validate_schemas.py` — repo-level. Runs the **unmodified** M0
  validator as a subprocess, then validates M3: schema meta, every fixture,
  policy rules JSON Schema cannot express, both OpenAPI documents, and the JCS
  vectors. Every rejection fixture was checked to fail for its *intended*
  reason, not incidentally.
- `contracts/m3/fixtures/generate_fixtures.py` — regenerates every fixture so
  each invalid one stays exactly one mutation from its valid twin. Carries a
  **second, independent** RFC 8785 implementation; `jcs.test.ts` asserts byte
  equality against it, so the two cross-check.
- `x-normative-schema` pointers in both OpenAPI documents are *resolved* by the
  validator. An OpenAPI `$ref` to an `https://` schema id would be silently
  skipped offline — this fails on a definition nobody ships.

### Phase 1 — `packages/reading-engine`

New workspace, **deliberately not `packages/shared`**: `apps/calc-stub` is
AGPL-3.0-or-later and imports shared, so ranking weights and editorial assembly
must not land where the AGPL service's Corresponding Source reaches. Its
`tsconfig.json` omits the DOM lib, so `crypto` and `fetch` are not even in
scope — the purity contract is type-enforced, not just documented.

`assembleReading(input): AssemblyOutcome` is synchronous and pure. Hashing is
outside (`finalizeReading` stamps the digests), which is what lets the whole
core run under `node:test` with no mocks.

`scripts/generate_source_allowlist.py` generates
`src/source-allowlist.generated.ts` from the data source registry, and
`source-allowlist.test.ts` regenerates and diffs. **This closes escalation §6
completely** — confirmed empirically: 25 of 139 sources are excluded, 24 by the
`NO-` prefix and exactly one (AMB-12) by status alone, so the `NOT GLOB 'NO-*'`
rule used by the D1 CHECKs really does let it through. A second test asserts
M0's `allowedUse` enum still matches `allowed_use_vocabulary`.

### Phase 2 — `db/d1/0002_m3_daily_reading_pipeline.sql`

Forward-only. 25 tables after apply. Verified three ways: `contracts/smoke_check.py`
(sqlite3, fresh + populated-0001 + abort paths), the API suite in workerd, and
`wrangler d1 migrations apply --local` (39 statements, idempotent on re-run).

Also: `apps/api/src/db/users.ts` gains the three new encrypted columns in
`ENCRYPTED_COLUMNS`, a new `UNWRITTEN_ENCRYPTED_COLUMNS` list, and a
**generalized** tripwire (it previously hardcoded `chart_snapshots.snapshot_enc`
— a tripwire for one past mistake rather than the class).
`apps/api/src/db/encrypted-columns.test.ts` reads the live schema and proves
every `*_enc` column is registered exactly once.

## 4. The nine review corrections, and where each landed

| # | Correction | Landed as |
| --- | --- | --- |
| 1 | Crypto-shredding criterion was false — cycles, `snapshot_json`, and the R2 bundle let a pure engine recompute the prose after DEK destruction | Claim scoped honestly in the M3 manifest's `unresolved_escalations`, and the design §5 acceptance bullet plus the §9 escalation now say so outright |
| 2 | `facts`/`approved_fragments` `minItems: 1` made the commonest day unrepresentable | `minItems: 0` in `reading-assembly.schema.json`; `reading-assembly.zero-facts.json` fixture |
| 3 | `daily-reading-v3` pinned in a hash but never defined | New `daily-reading.schema.json` |
| 4 | Terminal failure permanently bricks a user-day; only an operator can recover | **Decided, not yet built.** The scheduler may perform the replacement CAS itself for `calc_unavailable` and `release_unreadable` only, while `command_generation < 3`, and only for the current or immediately preceding local date. The other three replacement reasons stay operator-only. Design §5 carries the rule and the reasoning; Phase 4 implements it. |
| 5 | `daily_readings` rebuild left four columns unaddressed | `content_hash`, `primary_cycle_id`, `supporting_cycle_id`, `validation_json` dropped; that data moved inside `reading_enc` |
| 6 | `rankingFactor` still had `resonance_feedback` | Dropped, with `user_priority`; `reading-evidence.engagement-ranking.json` pins the rejection |
| 7 | Locale had the same unowned-default defect as timezone | `PUT /v1/preferences/locale`; `users.locale_source` |
| 8 | `peak` vs `reconsidering` precedence undefined | `peak` wins, explicit in `phase.ts`, pinned by a test |
| 9 | Triggers must come after table rebuilds; D1 trigger support unproven | **Triggers removed entirely** — see §10.1 |

## 5. Gotchas discovered (do not re-derive these)

- **Wrangler's SQL splitter** handles `BEGIN…END`, but `isCompoundStatementEnd`
  is `/\sEND[;\s]$/` — **no `i` flag**. Lowercase `end;` would break splitting.
- **Semicolons inside SQL string literals** were deliberately removed from 0002.
  Every naive splitter that ever reads that file is now safe.
- **`Intl.DateTimeFormat` is not deterministic** across runtimes (ICU version).
  Output is hashed into `content_hash`, so timing dates render ISO-8601 and the
  reviewed template supplies the locale's phrasing around them.
- **`referencing` resolves relative `$ref`s against the containing `$id`**, so
  two packages both shipping `common.schema.json` do *not* collide. I tested
  this rather than assuming it; the repo-level validator registers by `$id`
  only regardless.
- **D1 `batch()` is one transaction** that rolls back on any statement error
  (confirmed in Cloudflare docs). `PRAGMA defer_foreign_keys` is documented for
  D1 migrations — but 0002 no longer needs it.
- **`readD1Migrations`** sorts by `parseInt(name.split("_")[0])` and ignores
  non-`.sql`, so `MIGRATIONS.json` is skipped and 0002 orders correctly.
- **sweph 2.10.3-7 really does export** `solcross_ut`, `mooncross_ut`,
  `mooncross_node_ut`, and `helio_cross_ut`. Signature:
  `solcross_ut(x2cross, jd_ut, flag) -> Cross`, and the docs' own example
  detects failure via `result.date < jd`.
- **`angularSeparation` (`apps/calc-stub/src/engine.ts:127`) really is unsigned
  `[0,180]`** — the design's critique of sign-change bracketing is correct.

## 6. Known-incomplete, deliberately

**Correction 4 is decided but not built.** After a terminal failure the
reservation sits at `status='failed'` with revision 1, and `UNIQUE (user_id,
local_date, revision)` blocks any fresh initial enqueue forever. The only
recovery is the trusted replacement CAS, which the design described as an
operator action — on a surface that runs unattended, daily, per user.

The decision, now written into design §5: the scheduler becomes an allowed
caller of the same guarded replacement batch, but only for the two
`commandReplacementReason` values that are infrastructural rather than
judgemental — `calc_unavailable` and `release_unreadable` — bounded by
`command_generation < 3`, and only while the reservation's local date is the
user's present or immediately preceding one. `context_minimized`,
`policy_upgraded`, and `defect_repair` stay operator-only, because each encodes
a human decision about why the frozen inputs should change. Budget exhaustion
leaves the day with no reading and an audit event, which is worse than a reading
and better than an unbounded retry loop against a broken dependency. The schema
already supports all of it; Phase 4 wires it up.

Smaller ones still open, all from the review's "Smaller" list, now also recorded
in design §9: `users.next_due_at` is still unused and is the natural scheduling
column; `:45`-offset zones need a sub-hourly cron in Phase 7; a timezone change
can strand "today" on a date that was never reserved.

New, from Phase 3: the `cyp_` cycle-pass id preimage and `cyclePin.cycle_hash`
normalization are both unspecified, and `generation-command.schema.json` already
requires them. Phase 4 cannot persist a pass without pinning both.

### Phase 3 — what landed

`apps/calc-stub/src/cycles.ts` (the scanner and the `POST /v1/cycles` body
handler), `apps/calc-stub/src/cycle-policy.ts` (every versioned constant, in one
file so a diff there is visibly a `cycle_policy_version` bump),
`apps/calc-stub/src/cycles.test.ts` (50 tests), the route in `server.ts` with
`serviceAuthDenial` extracted so it cannot drift from `/v1/calculate`, and
`packages/shared/src/{cycle-types,jcs}.ts`.

Three things worth knowing before touching it:

- **The completeness proof is not "outside orb at the span edge."** That is
  unsound — a body can exit through `+O`, station, and come straight back. The
  bound is `|fT| > O + max_retrograde_arc_deg`, and every `lookaround_days` is
  derived from it. Design §4 now explains this; the test
  "fails the whole request rather than emit a partial cycle" is the one that
  catches a regression.
- **The ephemeris is behind an injectable `EphemerisSource`.** Station tangents
  and controlled 0°/360° unwraps are tested with analytic longitude functions,
  because the real sky will not produce one on cue.
- **`packages/shared/src/jcs.ts` is a second copy** of the reading-engine one, on
  purpose: calc-stub is AGPL and cannot import reading-engine, and inverting the
  dependency would put `crypto` back into reading-engine's scope. Both copies and
  the Python generator are pinned to
  `contracts/m3/fixtures/canonicalization/jcs-golden-vectors.json`, so three
  implementations cross-check on one vector set.

Also added: four `cycle-response` fixtures, because three rules in
`cycle_response_policy()` — ordering by `(exact_at, id)`, id uniqueness, and
`start_at <= end_at` — shipped with no fixture at all (every response fixture
carried zero or one cycle). Recorded in the M3 manifest's `amendments`; no
schema changed.

**An adversarial review of the finished scanner found six more defects, all
reproduced before being believed, all fixed.** Design §4 explains each; the short
version, because each is a class rather than an incident:

| What | Why it mattered |
| --- | --- |
| `window` had no duration cap | The handler is synchronous: a contract-valid 10-year window blocked the server ~17 s, past the Fly health check; a century-scale one hit ~450 MB against a 256 MB VM. `MAX_WINDOW_DAYS` is now 92. |
| `Date.parse` accepted far more than `format: date-time` | An offset-less instant resolved in the **host** timezone, so the same request returned different cycles on different machines. Now an RFC 3339 pattern with a mandatory offset, plus per-field calendar validation — `Date.parse` rolls `2026-02-30` into March rather than rejecting it. |
| `max_retrograde_arc_deg` underestimated four bodies | Mercury's real arc is 16.3° against an assumed 12°. An underestimate lets the scanner declare an encounter over while the body can still return — cycles vanish with no error. All values are now measured over the full 1800–2399 range, as are the lookarounds, which needed `2(O + arc)` rather than `(O + arc)`. |
| The checkpoint anchor could leave the data files | Anchoring at the nearest index reaches `lift_step_days / 2` — 600 days for Pluto — past the validated span. Requests in 1820 and 2380 failed with `calculation_failed` on a range the service claims. The anchor is clamped to the files' measured JD coverage. |
| One speed-sign comparison per interval | It cannot tell zero reversals from two, and the true node reverses twice inside one interval about twice a year, silently dropping the exact passes inside. Now a slope-bounded adaptive descent that *proves* no station is hiding. |
| `/v1/engine` served `ephe_path` | An absolute filesystem path on an unauthenticated route — the same disclosure the error-envelope rule exists to prevent. Removed, and `calc.openapi.yaml` now describes what `/health` and `/v1/engine` actually return. |

One reported defect was refuted rather than fixed: an unbounded `readBody` is not
reachable, because `serviceAuthDenial` returns before any `data` listener is
attached and Node applies TCP backpressure.

Worst measured scan is ~2.3 s (13 natal positions, all bodies, a two-month
window). The fixed cost is not the window — it is proving completeness for Pluto,
which takes a seventeen-year span at its slowest. Phase 4 should call this from
the queue consumer, not from a user-facing request path.

## 7. Phase 3 — everything that was established before it was written

`POST /v1/cycles` on the calc service. Contracts are frozen and fixtures exist:
`cycle-request.transits.json`, `cycle-response.retrograde.json` (the canonical
three-pass encounter), `cycle-response.empty.json`, `cycle-response.incomplete.json`,
plus five rejection cases. `contracts/m3/openapi/calc.openapi.yaml` describes
the endpoint. The semantic rules the response must satisfy are implemented in
`cycle_response_policy()` in `contracts/validate_schemas.py` — reuse those
assertions rather than rewriting them.

The algorithm is specified in design §4 and is the hard part. Non-negotiables:

- `angularSeparation` must **not** supply a root equation. Build oriented
  targets `targets(N, A) = unique(norm360(N+A), norm360(N-A))` — conjunction and
  opposition collapse to one, everything between has two distinct branches.
- Unwrap longitude from a fixed per-policy `unwrapping_epoch`; never reset to
  `norm360(λ)` at a request boundary, or the integer winding — and therefore the
  cycle id — depends on which window happened to observe it.
- `fT(t) = liftedLongitude(t) - T`, bracketed on sign change, refined by
  bisection to a ≤2 s bracket. Split at refined stations first.
- Orb boundaries solve `fT = ±O` with the same scanner. Do not infer them from
  sample timestamps and do not solve `abs(fT) - O`.
- A window is a *selection* interval. Prove both outer boundaries or return
  `cycle_window_incomplete` for the whole request — never a partial cycle.
- Sun/Moon oracle (`solcross_ut`/`mooncross_ut`) is **test-only**. It must not
  seed brackets, populate output, or be copied into expected fixtures.

Wire types for the request/response go in `packages/shared` (calc-stub must
deserialize them) — that widening is unavoidable and should stay minimal. The
engine, ranking, and eligibility stay in `packages/reading-engine`.

Note `apps/calc-stub`'s `pretest` downloads ephemeris data pinned by commit and
SHA-256; the first test run needs network.

## 8. Phases 4–7

Unchanged from design §7. Phase 4 should use the `assertion_probe` primitive
(§10.1) for the publication guard instead of the triggers §5 describes.

## 9. Files touched

**Created:** `contracts/m3/**` (schemas, manifest, both OpenAPI docs, fixtures,
generator), `contracts/validate_schemas.py`, `contracts/smoke_check.py`,
`packages/reading-engine/**`, `db/d1/0002_m3_daily_reading_pipeline.sql`,
`apps/api/src/db/encrypted-columns.test.ts`, `apps/calc-stub/src/cycles.ts`,
`apps/calc-stub/src/cycle-policy.ts`, `apps/calc-stub/src/cycles.test.ts`,
`packages/shared/src/cycle-types.ts`, `packages/shared/src/jcs.ts`,
`packages/shared/src/jcs.test.ts`.

**Modified:** root `package.json` (build/typecheck/test include the new
workspace; `test:contracts` runs all three checkers), `apps/api/package.json`
(`db:local` now applies the ordered migration directory), `db/d1/MIGRATIONS.json`,
`apps/api/src/db/users.ts`, `apps/api/test/helpers.ts` (`resetDb` covers the new
tables and breaks the self-reference before deleting), `apps/calc-stub/src/engine.ts`
(`norm360`, `calcBody`, and a new `SE_ID_BY_BODY` exported for the scanner),
`apps/calc-stub/src/server.ts` (the `/v1/cycles` route and the extracted
`serviceAuthDenial`), `packages/shared/src/index.ts`, and both design/handoff
documents.

**Deliberately unchanged:** everything under `contracts/m0/`.

## 10. Where the implementation diverged from the design document

These are decisions made during implementation. **All six are now folded into
the design document itself** — this list is kept as the record of what changed
and why, not as a list of things the design still gets wrong.

1. **No triggers.** §5 specifies `BEFORE INSERT`/`BEFORE DELETE` triggers on a
   transient publication guard. 0002 instead ships `assertion_probe`, a table
   with `CHECK (id = 0)` that can never hold a row. `INSERT INTO assertion_probe
   (id, reason) SELECT 1, '<reason>' WHERE <bad condition>` is a no-op when the
   condition is false and aborts the enclosing transaction when it is true —
   a conditional abort in pure SQL, using only a CHECK constraint. It avoids two
   real risks: `ALTER TABLE … RENAME` rewrites references inside trigger bodies
   (which collides with table rebuilds), and D1's trigger support on the remote
   path is not something the migration needs to depend on. **Phase 4's
   publication guard should use the same primitive.**
2. **No rename-based rebuild for `daily_readings`/`reading_sources`.** They are
   dropped and recreated under their final names. SQLite only rewrites
   `REFERENCES` clauses on rename when FK enforcement is on *at that moment*, so
   a rename-based rebuild silently produces a dangling reference wherever that
   does not hold. Pre-flight assertions prove both tables (and `reading_feedback`)
   are empty, which is what makes dropping safe — and which also implements the
   design's "never discards the row" requirement.
3. **`readingAssemblyRequest` is split out and renamed.** It lived inside M0's
   `reading-evidence.schema.json` as a `$def`; M3 gives it its own document as
   `assemblyRequest`.
4. **Phase is timestamp-driven, not orb-driven.** DER-01 specifies a state
   machine over event timestamps, and the engine is pure — it has no ephemeris
   with which to evaluate an instantaneous orb. Thresholds live in one versioned
   block in `phase.ts`.
5. **New rejection code `no_reflection_prompt_for_locale`.** The role order
   treats `reflection` as part of the daily chapter, so a locale with no eligible
   prompt is a content gap that must surface in the evidence drawer rather than
   silently producing a shorter reading.
6. **`evaluateFixture` distinguishes `ineligible` from `fallback`.** Both publish
   the reviewed fallback, but "a candidate existed and was ruled out" is a
   different editorial fact from "nothing was offered".
7. **The completeness proof is a retrograde-arc bound, not a span edge.** Design
   §4 said only that the scanner evaluates "until the first entry, every exact
   pass, and the final exit are known", which reads as "keep going until you are
   outside orb". That is unsound: a body can exit through `+O`, station a degree
   later, and come back in. Phase 3 added `max_retrograde_arc_deg` per body, and
   an encounter is proven over only past `|fT| > O + arc`. Every
   `lookaround_days` is derived from that inequality. §4 now says so.
8. **The ephemeris is injectable.** `EphemerisSource` is an interface so a
   station-on-target tangent and a controlled 0°/360° unwrap can be tested
   analytically. The design assumed Swiss Ephemeris throughout.
9. **`importance_score` is omitted from cycle responses.** The schema permits it,
   but ranking is `packages/reading-engine`'s and must not land in the AGPL
   service.
10. **A second RFC 8785 implementation lives in `packages/shared`.** calc-stub
    mints `cyc_` ids and cannot import reading-engine; inverting the dependency
    would put `crypto` back into reading-engine's scope. Both copies and the
    Python generator are pinned to the same golden vectors.

**Task 6 of the original plan — updating the design document to match — is
done** (2026-08-09). Every item in §4 and §10 above is now folded into
`2026-08-09-m3-daily-reading-pipeline.md` itself, so the design no longer lags
the code and this list is history rather than a TODO.
