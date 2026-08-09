# M3 Daily Reading Pipeline — Design

> **Status: DESIGN, not implemented.** Scope: what to build and why, and the
> five contract decisions that have to land before any of it compiles honestly.
> Not a task list — each phase in §7 still needs its own plan per
> `superpowers:writing-plans`.

**Goal:** one user, one local date, one published reading, traceable paragraph
by paragraph to calculated facts and a reviewed editorial release — produced by
a function that can be run in a unit test with no network, no clock, and no
database.

**Why contract-first:** `GET /v1/readings/today` is four lines of SQL over a
table nothing writes. Building it first produces a route that returns `404` for
every real user. Building the scheduler first schedules a generation engine that
does not exist. The deterministic core is the only piece that has no upstream
dependency — and it is the piece that four unresolved data-model decisions
currently block.

---

## 1. Verified starting state

Confirmed against the tree, not inferred.

**Exists and is usable as-is:**

| Thing | Where |
| --- | --- |
| Immutable natal chart + fingerprint + uncertainty report | `chart_snapshots` (`db/d1/0001_m0_core.sql:179`), `GET /v1/chart` |
| Signed editorial bundles: verified, stored in R2, atomically activated | `apps/api/src/routes/content-releases.ts`, `content_release_pointer` (`:354`) |
| Envelope encryption with AAD bound to `(subject, table.column, record_id, key_version)` | `apps/api/src/crypto.ts`, `apps/api/src/db/users.ts` |
| Per-user idempotency scoping | `uq_jobs_scope_key` (`:497`) |
| Evidence graph and assembly-request schemas + canonical fixtures | `contracts/m0/reading-evidence.schema.json` |
| Reading storage tables | `daily_readings` (`:364`), `reading_sources` (`:400`) |

**Does not exist:**

- Any writer for `daily_readings`, `reading_sources`, `cycle_instances`, or
  `natal_features`. All four tables are empty by construction.
- Any date-specific calculation. `CalcRequest`
  (`packages/shared/src/chart-types.ts:81-97`) takes birth inputs and returns a
  natal chart; there is no target date and no cycle request.
- Any reading assembly code. `GET /v1/readings/today` is a 501
  (`apps/api/src/routes/stubs.ts:32`).
- Any cron trigger. `apps/api/wrangler.toml` has no `[triggers]` block and
  `src/index.ts` exports no `scheduled` handler.

**Blocked on this milestone:** a bundle declaring `fixtures` is stored but held
inactive because nothing can evaluate them (`services/content-release.ts:724-731`,
`README.md:152`). That hold is honest today and stops being honest the moment
the assembly engine exists.

---

## 2. Part 1 — Contract decisions

Four of these are open items in
[`docs/reviews/2026-08-01-spec-escalations.md`](../../reviews/2026-08-01-spec-escalations.md)
(§2, §3, §4). Each is a data-model decision the code cannot make for itself,
because the code currently implements the frozen contract faithfully.

### D1 — A daily reading gets a revision component

**Decision.** `daily_readings` gains `revision INTEGER NOT NULL DEFAULT 1`,
`supersedes_reading_id`, and `revision_reason`. Uniqueness moves to
`(user_id, local_date, release_version, revision)`, and a *partial* unique index
enforces the product invariant the current constraint does not:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_live
  ON daily_readings(user_id, local_date) WHERE status = 'published';
```

`revision_reason` is a closed set: `initial`, `chart_recalculated`,
`consent_revoked`, `safety_correction`, `defect_repair`.

**Why.** Escalation §2: `UNIQUE (user_id, local_date, release_version)`
(`0001_m0_core.sql:385`) offers no way to correct a reading without violating
the constraint or overwriting history. The table already has a `superseded`
status (`:375`) that nothing can ever reach — the schema half-anticipated
revision and the uniqueness key blocked it.

**A second defect this fixes.** The existing key is scoped by `release_version`,
so activating a release mid-day permits *two* published readings for the same
user and day. The product contract is "one coherent daily chapter"
(spec §2). The live-row index is on `(user_id, local_date)` with no release
component precisely so that cannot happen.

**What it deliberately does not do.** A release activation does **not**
retroactively revise published readings. The spec's rollback semantics are
"changes the active release pointer; it does not require editing previously
published readings" (spec §7). `content_release_change` is therefore absent
from `revision_reason` — a reissue after a release change is a
`safety_correction` or `defect_repair` decided by a human, never an automatic
consequence of the pointer moving.

**Why this costs nothing elsewhere.** `reading_key` becomes
`user:<user_id>:<local_date>:<release_version>:r<revision>`, which still matches
the frozen pattern `^user:[A-Za-z0-9_.:-]+:[0-9]{4}-[0-9]{2}-[0-9]{2}:.+$`
(`reading-evidence.schema.json:323`) — the trailing `.+` absorbs the revision
suffix. `users.id` excludes `:` by CHECK (`0001_m0_core.sql:25`), so the parse
stays unambiguous. And because the generation job keys its idempotency on
`reading_key`, a deliberate reissue is a *new* key in the existing
`uq_jobs_scope_key` namespace rather than a bypass of it.

### D2 — Cycles are modelled as a cycle with an ordered list of passes

**Decision.** A new `cycle_passes` table; `cycle_instances` keeps the envelope.

```sql
CREATE TABLE IF NOT EXISTS cycle_passes (
  id           TEXT PRIMARY KEY NOT NULL,
  cycle_id     TEXT NOT NULL REFERENCES cycle_instances(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  pass_index   INTEGER NOT NULL,              -- 1-based, chronological
  direction    TEXT NOT NULL CHECK (direction IN ('direct', 'retrograde')),
  exact_at     TEXT NOT NULL,
  speed_deg_per_day REAL,
  created_at   TEXT NOT NULL,
  UNIQUE (cycle_id, pass_index)
);
CREATE INDEX IF NOT EXISTS idx_cycle_passes_user_exact
  ON cycle_passes(user_id, exact_at);
```

`cycle_instances.start_at` / `end_at` become the outer envelope (orb entry of
the first pass to orb exit of the last). `exact_at` is redefined as the **first**
pass's exact time — stable and immutable — with `pass_count` added alongside.
The existing index `idx_cycle_instances_user_phase` (`:260`) keeps working.

**`phase` stops being authoritative.** DER-01 defines cycle lifecycle state as a
deterministic state machine over event timestamps, recomputed "at each daily
reading". A stored `phase` column is therefore a *scan-time cache* for
`GET /v1/timing` filtering. The reading engine recomputes phase from
`cycle_passes` for the target local date, so a reading is reproducible from
immutable facts rather than from a column that has since been overwritten.

**Why this matters beyond tidiness.** The phase vocabulary
(`common.schema.json:168`) contains `reconsidering`. Under a one-pass model that
state is unreachable — it is precisely the interior of a retrograde loop,
between the first and final exact pass. The current schema cannot express the
product's own phase language. Mapping, computed for date *D*:

| Phase | Condition |
| --- | --- |
| `emerging` | inside the envelope, before pass 1, orb still wide |
| `building` | applying toward pass 1, inside the peak orb band |
| `peak` | within the peak window of any pass |
| `reconsidering` | after pass 1 and before the final pass (multi-pass only) |
| `integrating` | after the final pass, separating to orb exit |

Thresholds live in one versioned constant block in the engine, not scattered at
call sites, and `horizon_version` (`:254`) records which scan policy produced the
rows so a threshold change re-scans rather than mixing vintages.

### D3 — The assembly request carries an opaque `assembly_id`, never `reading_key`

**Decision.** Replace it, do not merely document it.

**Why not "document it".** Escalation §4 offers two ways out: state that the key
never crosses into a prompt, or make it opaque. The first is unenforceable —
`readingAssemblyRequest` is the model-boundary object (it carries
`output_schema` and `approved_fragments` and says the model "may not introduce
fragments outside this set"), and its `reading_key` is *required*, with a
canonical fixture reading literally
`"user:usr_01JAMPLEUSER00000001:2026-07-30:release-12"`
(`fixtures/valid/reading-assembly.request.json:3`). Spec §10 forbids "stable
direct identifiers" in the model request. A contract whose required field
violates the spec's own prohibition is not fixed by a comment.

**Shape.**

```
assembly_id = "asm_" + sha256Hex(canonicalJson(<the assembly input itself>))[0:32]
```

Content-addressed, not user-addressed. Three properties fall out:

1. No user identifier, no crypto subject, no session — nothing that names a
   person crosses the boundary.
2. It is not a stable pseudonym: the fact set changes daily, so the same user
   gets an unrelated id each day. A hash *of* the user id would not have this
   property, which is why the input is the request, not the identity.
3. Identical inputs produce an identical id, which makes it a legitimate cache
   key and a reproducibility handle at the same time.

`daily_readings` gains `assembly_id TEXT`; the `assembly_id → reading_key`
mapping stays server-side, in the trusted plane where `readingEvidenceGraph`
already carries `user_id` legitimately.

**Enforced mechanically.** A test asserts the serialized assembly request
contains neither `usr_` nor `cs_` nor any `local_date`-shaped substring. The
prohibition becomes a failing test rather than a paragraph.

### D4 — Version the contract; leave `contracts/m0` byte-frozen

**Decision.** A new package `contracts/m3/` at `schema_version 0.3.0`. No file
under `contracts/m0/` changes except one `amendments` entry in
`SCHEMA_MANIFEST.json` pointing at the successor — the precedent that already
exists there (`SCHEMA_MANIFEST.json:105-120`).

| New document | Contains |
| --- | --- |
| `reading-assembly.schema.json` | `assemblyRequest` — D3's `assembly_id` replaces `reading_key` |
| `reading-evidence.schema.json` | `readingEvidenceGraph` v0.3 — adds `revision`, `supersedes_reading_id`, `assembly_id` |
| `cycle-instance.schema.json` | Normalized cycle with `passes[]` — D2's wire shape |

M3 documents `$ref` M0's `common.schema.json` by absolute `$id` for the shared
vocabulary (`cyclePhase`, `evidenceLane`, `allowedUse`, `celestialBody`,
`aspectType`, `ianaTimeZone`) and override only `schemaVersion`. The frozen
enums are reused rather than forked; only the package version moves.

**Why a package and not an in-place edit.** D3 removes a required field —
squarely inside `breaking_change_policy` ("any change to required fields, enums,
or `$id` requires a schema_version bump and a new freeze note"). D1's `revision`
would have to be added under `"additionalProperties": false`
(`reading-evidence.schema.json:299`), which is additive in intent but is still
an edit to a frozen schema document, and the amendment precedent so far covers
OpenAPI only. Versioning once is cheaper than arguing the boundary twice.

`validate_schemas.py` extends to register both directories in one registry and
to map `contracts/m3/fixtures/` by prefix. Per `AGENTS.md`, each new document
ships a fixture under `fixtures/valid/` and a rejection case under
`fixtures/invalid/` — for `assemblyRequest`, the rejection case is a request
carrying a `reading_key`-shaped identifier.

### D5 — Fixture ids resolve against a repo-owned catalogue

**Decision.** `contracts/m3/fixtures/assembly/<fixture_id>.json` holds the input
side (chart snapshot + cycles + context + expected outcome). Ingestion resolves
each declared `fixture_id` against that catalogue; an unknown id is a rejection
(`fixtures_unknown`), not a pass.

**Why this is part of the contract work.** `content-release.schema.json:612-627`
lets a bundle declare `{fixture_id, expect}` with no payload — the ids name
something the bundle does not carry. Today that is inert because nothing
evaluates them. The moment the engine exists, an unresolvable id must fail
closed, or a compromised CMS activates a release by naming fixtures nobody has.

---

## 3. Part 2 — The deterministic assembly core

**A new workspace: `packages/reading-engine`.** Not `packages/shared`.

`apps/calc-stub` imports `@patternlike/shared`, and `LICENSING.md` records that
boundary as the open legal question — Corresponding Source for the AGPL service
reaches into whatever it imports. Ranking weights, eligibility rules, and
editorial assembly are the product; they must not land inside the package that
the AGPL service pulls in. Only the *wire types* for the cycle request/response
go in `packages/shared`, because calc-stub needs to deserialize them, and that
widening is unavoidable and minimal.

**Purity contract.** No `fetch`, no D1, no `Date.now()`, no `crypto`. The
signature is synchronous:

```ts
export function assembleReading(input: AssemblyInput): AssemblyOutcome;
```

Hashing is deliberately outside. `text_hash`, `assembly_id`, and `content_hash`
all need SHA-256, which is async WebCrypto in Workers; making the engine async
to accommodate it would cost the property that matters most — that the whole
core runs under `node:test` with no mocks and no harness. The caller fills the
hash slots after assembly returns.

**Inputs.** `{ local_date, generated_at, chart: { fingerprint, effective_accuracy, uncertainty, natal_features }, cycles: NormalizedCycle[], release: VerifiedBundle, context: NormalizedContextSignal[], locale, domain_preference, release_version, revision }`.

Note `effective_accuracy`, not the stored label. The repo's standing invariant
is that `engine.ts` recomputes an effective accuracy and suppresses houses,
angles, and time-sensitive Moon claims whenever no real birth time was supplied,
*regardless of the accuracy the caller sent*. The reading engine must gate on
the same recomputed value or it reintroduces the bug one layer up.

**Stages, in order, each emitting a reason code on rejection:**

1. **Normalize.** Total ordering on every collection (cycles by
   `(first_exact_at, cycle_id)`, fragments by id). Output must be byte-stable or
   `content_hash` is meaningless.
2. **Eligibility (DER-18).** Each editorial object's `eligibility` block
   (`content-release.schema.json:60-102`) checked against the fact set:
   `required_fact_classes`, `required_bodies`, `required_aspects`, `techniques`,
   `requires_houses`, `min_birth_time_accuracy`. Rejections are retained with
   reason codes — the registry requires storing "selected and rejected reason
   codes", and the evidence drawer is the reason.
3. **Uncertainty constraints.** Anything depending on a feature class listed in
   `uncertainty.suppressed_features` is dropped; anything in
   `qualified_features` survives with a qualification that forces an
   `uncertainty_notice` paragraph.
4. **Consent and freshness (DER-15).** A context signal enters only if
   `permission_state='active'`, `freshness_status='fresh'`, and the specific
   `allowed_use` the slot needs is in the signal's own allowed set. **The source
   gate is an explicit allowlist**, generated from
   `spec-bundle/…data_source_registry_v0.2.yaml` at build time, with a test that
   regenerates and diffs. Escalation §6 is exactly this: the `NOT GLOB 'NO-*'`
   prefix rule misses AMB-12, which is excluded by *status*, and nothing keeps
   the `allowedUse` enum in sync with the registry. "No source outside the
   registry can enter reading assembly" is a launch acceptance criterion, and
   M3 is the first code that can violate it.
5. **Ranking (DER-02).** Named factors only, from the frozen `rankingFactor`
   enum (`reading-evidence.schema.json:119-153`): exactness, body/target
   importance, rarity, angularity, phase, technique weight, domain match,
   continuity, repetition penalty. Every component is recorded with its weight.
   No engagement signal exists as an input — the registry's note is "no hidden
   engagement-only ranking", and the way to keep that true is to give the
   function nowhere to put one. Tie-breaks are total and terminate on cycle id.
6. **Selection.** One primary, at most one supporting. A supporting influence is
   suppressed unless it is *distinct* — different `(body, target, aspect)` and a
   different parent cycle — so the reading cannot say the same thing twice.
7. **Assembly.** Fixed role order: `primary_theme`, `supporting_theme?`,
   `phase_context`, `timing?`, `reflection`, `uncertainty_notice?`,
   `context_label?`.

   **The renderer writes no prose.** Every paragraph is a reviewed string from
   the bundle — `phase.summary`, `constructive_expression`,
   `shadow_expression`, `prompt.prompt_text`, `modifier.body` — selected and
   ordered, never joined with connective sentences authored in code. Connective
   prose would be unreviewed content in a product whose acceptance criterion is
   that every paragraph resolves to an approved content version. The one
   exception is the `timing` paragraph, which is a locale-formatted rendering of
   calculated values (pass dates, orb, phase name) in a fixed non-prose shape,
   and whose evidence is the facts themselves.
8. **Validation (DER-22).** Runs the frozen `validationResult` checks
   (`reading-evidence.schema.json:250-295`). In deterministic mode several
   checks are structurally impossible to fail — they still run and record
   `pass`, cheaply. Only the checks that need a classifier (`fatalism`,
   `diagnosis`) record `skip` with `detail_code: "deterministic_mode"`, so the
   validation log distinguishes "verified" from "not applicable here".
9. **Fallback.** If nothing survives eligibility — the common case, not the
   exotic one, since most days have no cycle inside orb — the engine builds the
   reading from the release's safety-rule fallback path
   (`fallback_fragment_id` / `fallback_text`) and sets
   `validation.fallback_used = true`. "Never show a blank day" is a screen
   requirement (spec §4), and `safety_rules` already has `minItems: 1`
   (`content-release.schema.json:604-607`) so the path can always be taken.

**Second entry point:** `evaluateFixture(bundle, fixtureCatalogue, fixtureId) →
"eligible" | "ineligible" | "fallback"`. This is what lets
`POST /internal/content-releases` stop returning `accepted_pending_tests` for
fixture-bearing bundles (`routes/content-releases.ts:425-440`). It is a pure
call over the same core, which is why it costs nothing extra.

**Done when:** the canonical fixtures round-trip — `reading-evidence.daily.json`
is reproduced from its inputs, the assembly request validates against the M3
schema, and `content-release.bundle.json`'s declared fixture evaluates to
`eligible` — with the engine imported into a plain `node:test` file.

---

## 4. Part 3 — Cycle inputs

**New calc endpoint: `POST /v1/cycles`.** `POST /v1/calculate` stays exactly as
it is; this is additive, and the calc binding is already plain HTTP so nothing
about the deployment shape changes.

**The request carries natal positions, never birth data.**

```ts
interface CycleRequest {
  request_id: string;
  chart_fingerprint: string;
  natal_positions: LongitudePosition[];
  natal_accuracy: BirthTimeAccuracy;   // effective
  window: { from: string; to: string };  // UTC instants
  techniques: ["transits"];              // launch scope
  orb_policy_id: string;
  orb_policy_version: string;
  contract_id: string;
  contract_version: string;
}
```

Transit-to-natal contacts need natal longitudes and nothing else. Sending them
instead of the birth instant means the calculation service never needs a
decryption path, and the "birth stays encrypted at rest" invariant survives the
new surface untouched. (This does not *improve* escalation §11 — `snapshot_json`
precision remains the open product question — but it does not worsen it either,
and the cycle scan must inherit whatever precision policy §11 settles on rather
than inventing a third one.)

**Algorithm.** Interval scan plus numerical root refinement, which is what
AST-08 specifies: sample the transiting body's longitude on a fixed grid
anchored to a fixed epoch (6 h for fast bodies, 1 d for slow), compute the
signed difference from exact aspect against each natal target, bracket sign
changes, refine by bisection to ±1 second. Retrograde loops fall out as three or
five roots with no special casing — that is the whole reason D2's pass list is
the natural storage shape rather than a concession to it. `angularSeparation`
and `isApplying` (`apps/calc-stub/src/engine.ts:127`, `:506`) already exist and
are reused.

**Upstream's crossing functions cover the opposite half of the problem.** Swiss
Ephemeris exports `swe_solcross_ut` and `swe_mooncross_ut`, which return the
exact instant a body crosses a given ecliptic longitude, and `sweph@2.10.3-7`
exposes both (`solcross_ut`, `mooncross_ut`, `mooncross_node_ut`,
`helio_cross_ut`, `rise_trans`). They apply to the Sun and the Moon only — the
two launch bodies that never retrograde geocentrically and therefore can only
ever produce a single pass. For planets the sole crossing helper is
`swe_helio_cross_ut`, which is **heliocentric** and so cannot answer a
geocentric transit question at all. Mercury through Pluto and the true node —
exactly where multi-pass exists — have no upstream root finder.

Two consequences. The scan-and-refine loop above is required rather than a
reinvention. And Sun/Moon passes should be computed with `solcross_ut` /
`mooncross_ut` anyway, not because it is faster but because it gives the golden
tests an **independent oracle**: our bisection must agree with upstream's own
crossing result to within tolerance on the two bodies where both methods apply,
which is the only cheap way to validate the general scanner.

**Deterministic ids.** `cyc_` + sha256 of
`(chart_fingerprint, technique, body, target, aspect, first_exact_at)`.
Content-addressed, so tomorrow's horizon scan rediscovering the same cycle
produces the same row id and the upsert is a no-op — idempotency without a
dedupe query.

**Suppression at the source.** Under `unknown` effective accuracy, transits to
`ascendant` and `midheaven` are not computed at all rather than computed and
filtered later. A fact that must never be shown should not exist as a row.

**Done when:** a golden fixture chart produces a byte-stable cycle set over a
fixed window, a known retrograde cycle yields exactly three passes with correct
directions, and the scan is provably idempotent across two runs.

---

## 5. Part 4 — Persistence: `GenerateDailyReading`

Idempotency key = `reading_key` (which now carries the revision), so the
existing `uq_jobs_scope_key` machinery covers reissue with no new concept.

1. **Resolve the local date** from `users.timezone` — DEV-01's
   `local_day_boundary` use. Never from a request clock and never from a
   client-supplied date; that would make the endpoint a time-travel oracle, and
   Time Travel is M4 with its own route and its own contract.
2. **Load** the active chart snapshot, the cycles overlapping that local date
   with their passes, consent and permission state, fresh context signals, and
   the active release. The release bundle is read from R2 **and its
   `bundle_hash` recomputed** — ingestion verified it once, and a bundle read
   back from storage is an input like any other.
3. **Assemble** — the pure call from §3.
4. **Encrypt the prose** with the user's DEK, AAD bound to
   `(subject, "daily_readings.reading_enc", reading_id, key_version)`, then
   **add `daily_readings.reading_enc` to `ENCRYPTED_COLUMNS`**
   (`apps/api/src/db/users.ts:243-258`). This is the repo's tightest standing
   invariant: a new encrypted column outside that list is data left under a
   destroyed key at the next rotation, and `rotateUserDek` throws when it finds
   ciphertext it does not cover.
5. **Write atomically** — supersede any live row, insert `daily_readings`,
   insert every `reading_sources` row, write the `audit_events` entry, in one
   `DB.batch()`. `audit_events` has had no writer at all; this is the first
   thing worth auditing that M3 introduces.

**Migration policy.** Per `CLAUDE.md`, M0 is pre-production and
`0001_m0_core.sql` is edited **in place**, with a note in
`db/d1/MIGRATIONS.json` and `rm -rf apps/api/.wrangler/state/v3/d1 && npm run
db:local -w @patternlike/api`. No `AEAD_VERSION` or `KEK_DERIVATION_VERSION`
bump is needed: no existing ciphertext changes meaning, and `reading_enc` is a
column nothing has ever written.

**Done when:** running the job twice for the same user and date produces one
published reading and one `duplicate` job outcome; a `revision: 2` run
supersedes the first and leaves both rows queryable; a user with no eligible
content still gets a published fallback reading rather than nothing.

---

## 6. Part 5 — Retrieval

`GET /v1/readings/today` — resolve the local date from `users.timezone`, select
`WHERE user_id = ? AND local_date = ? AND status = 'published'` (the partial
unique index from D1 guarantees at most one), decrypt, return
`DailyReadingResponse`.

Two distinct 404s, because the client's next action differs:
`chart_not_found` (finish onboarding) versus `reading_not_generated` (check
back). Both inside the standard envelope; the OpenAPI 404 already covers the
status.

`GET /v1/readings/{id}/evidence` lands in the same phase. It is a read of
`reading_sources` filtered by owner, and it is the "Why this?" element the Today
screen is specified to require — shipping Today without it ships the surface
without the property that distinguishes this product.

Both routes come off `stubs.ts` (`:32-37`), and `run_worker_first` in
`wrangler.toml` already covers `/v1/*`, so no asset-routing change is needed.

---

## 7. Order of work

| Phase | Lands | Unblocks |
| --- | --- | --- |
| 0 | D1–D5: `contracts/m3/`, fixtures, validator, escalations marked resolved | everything |
| 1 | `packages/reading-engine` + fixture evaluation | release activation of fixture-bearing bundles |
| 2 | `0001_m0_core.sql` in place: revision, `cycle_passes`, `assembly_id`, `ENCRYPTED_COLUMNS` | 3, 4 |
| 3 | calc `POST /v1/cycles` + scan/refine + goldens; cycle persistence | 4, `/v1/timing` |
| 4 | `GenerateDailyReading` | 5 |
| 5 | `GET /v1/readings/today`, `GET /v1/readings/{id}/evidence` | 6 |
| 6 | Real Today page (`apps/web/src/components/TodayView.tsx`) | 7 |
| 7 | `[triggers]` + `scheduled` handler enqueuing before each notification window | — |

Phase 0 is documents and schemas — no runtime code, and it is the phase that
unsticks the other six. Phase 1 has value on its own even if nothing after it
ships this quarter: it turns `accepted_pending_tests` from a permanent state
into a transient one.

---

## 8. Out of scope, deliberately

- **Constrained-model editing.** `assembly_mode` stays `deterministic`. The M5
  boundary is why D3 exists; nothing calls a model in M3.
- **`GET /v1/pattern`, `/v1/timing`, `/v1/time-travel`, `/v1/check-ins`.**
  `/v1/timing` becomes nearly free after phase 3 and `/v1/pattern` after
  `natal_features` has a writer, but neither is on the daily loop's critical
  path.
- **Notifications.** Phase 7 schedules generation; delivery is a separate
  vendor decision still listed open in spec §16.
- **Reading feedback.** `reading_feedback.notes_enc` will need the same
  `ENCRYPTED_COLUMNS` treatment when it lands.

## 9. Escalations this does not resolve

Named so they are not mistaken for handled:

- **§1 crypto-shredding vs D1 Time Travel** — wrapped DEK and ciphertext still
  share a database. Readings add more ciphertext to that database.
- **§5 cascading revocation** — there is still no `derived_features` table and
  no `invalidated_at`. D1's revision model gives revocation somewhere to *land*
  for readings specifically (a `consent_revoked` reissue), which is narrower
  than the general problem.
- **§8 `canonicalJson` has no named standard** — no longer latent. It now has a
  second caller in the release bundle hash (`services/content-release.ts:149`),
  and D3's `assembly_id` would be a third. Number representation and Unicode
  normalization should be pinned before that happens.
- **§11 `snapshot_json` precision** — unresolved, and the cycle scan inherits
  whatever it settles on.
- **§9 `techniques_enabled` overstates the engine** — phase 3 implements
  `transits`, closing one of the five. `stations_ingresses` and
  `lunations_eclipses` stay declared-but-absent.
