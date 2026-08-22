# M3 Daily Reading Pipeline — Design

> **Status: phases 0–3 implemented; 4–7 still design.** Scope: what to build and
> why, and the five contract decisions that have to land before any of it
> compiles honestly. Not a task list — each remaining phase in §7 still needs its
> own plan per `superpowers:writing-plans`.
>
> This document has been reconciled with the code as of 2026-08-09. Where a
> section describes something the implementation decided differently, the
> section now says what the code does and why — the nine review corrections and
> the implementation divergences are folded in rather than appended.
> [`2026-08-09-m3-implementation-handoff.md`](../archive/plans/2026-08-09-m3-implementation-handoff.md)
> remains the record of *how* that reconciliation happened.

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
`supersedes_reading_id`, `revision_reason`, `active_generation_job_id`, and
`command_generation`. Revision numbers are monotonic within a user's local day,
so uniqueness moves to
`(user_id, local_date, revision)` rather than resetting when the editorial
release changes. A *partial* unique index enforces the product invariant the
current constraint does not:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_live
  ON daily_readings(user_id, local_date) WHERE status = 'published';

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_pending
  ON daily_readings(user_id, local_date) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_readings_successor
  ON daily_readings(supersedes_reading_id)
  WHERE supersedes_reading_id IS NOT NULL;
```

`revision_reason` is a closed set: `initial`, `chart_recalculated`,
`consent_revoked`, `safety_correction`, `defect_repair`.
`supersedes_reading_id` is a self-reference to `daily_readings(id)`. Revision 1
requires `revision_reason = 'initial'` and no predecessor; a later revision
requires a predecessor and a non-`initial` reason. Publication additionally
requires the new revision to equal the predecessor's revision plus one. The
pending-row and successor indexes allow one published row and one in-progress
successor while preventing competing reissue chains.

`jobs` gains `UNIQUE (id, user_id)`, and the reservation uses a composite
`FOREIGN KEY (active_generation_job_id, user_id) REFERENCES jobs(id, user_id)`.
A reading therefore cannot point at another user's command even though each id
would satisfy an independent foreign key.

Artifact revision and command generation are different identities. An initial
reservation has `revision = 1`, `revision_reason = 'initial'`, no predecessor,
and `command_generation = 1`. Its first job key is
`daily:<local_date>:initial:g1` inside the existing per-user job namespace. It
is a no-op if any published or pending row already exists for that user/date. A
reissue requires `expected_predecessor_id`,
`revision = predecessor.revision + 1`, and a non-`initial` reason; its first key
is
`daily:<local_date>:reissue:r<revision>:<expected_predecessor_id>:g1`. The
expected predecessor is the compare-and-swap guard, not descriptive metadata.

A retry reuses the exact same immutable job command and `gN` key. A terminally
failed or consent-cancelled command does not consume a new artifact revision and
does not strand the reservation: a separate trusted replacement CAS must name
`expected_failed_job_id` and `command_replacement_reason`, require that job to be
the reservation's current terminal job, increment `command_generation`, freeze
a new command, and point the same reservation at the new `gN` job. It preserves
the reading id, local date, artifact revision/reason, and predecessor, while the
new command may pin corrected chart/release/cycle/context/policy inputs and a new
generation anchor. The prior job and encrypted command remain terminal and
auditable. For a reissue, the originally expected
predecessor must still be the live row; otherwise replacement fails
`stale_predecessor`. This is a new command, never mutation of a retry's inputs.

The pending row is the enqueue-time artifact reservation. It stores the frozen
non-sensitive scheduling/version keys and points to the DEK-encrypted job
command specified in §5; a retry never re-resolves mutable active rows.

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

**The evidence key remains parseable, but is not the job key.** `reading_key`
becomes
`user:<user_id>:<local_date>:<release_version>:r<revision>`, which still matches
the frozen pattern `^user:[A-Za-z0-9_.:-]+:[0-9]{4}-[0-9]{2}-[0-9]{2}:.+$`
(`reading-evidence.schema.json:323`) — the trailing `.+` absorbs the revision
suffix. `users.id` excludes `:` by CHECK (`0001_m0_core.sql:25`), so the parse
stays unambiguous. `reading_key` identifies a published artifact; the command
keys above prevent an editorial pointer change from silently creating a second
generation command for the same day.

### D2 — Cycles are modelled as a cycle with an ordered list of passes

**Decision.** A new `cycle_passes` table; `cycle_instances` keeps the envelope.

```sql
CREATE TABLE IF NOT EXISTS cycle_passes (
  id           TEXT PRIMARY KEY NOT NULL,
  cycle_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  pass_index   INTEGER NOT NULL,              -- 1-based, chronological
  direction    TEXT NOT NULL CHECK (direction IN ('direct', 'retrograde')),
  exact_at     TEXT NOT NULL,
  speed_deg_per_day REAL NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (cycle_id, pass_index),
  FOREIGN KEY (cycle_id, user_id)
    REFERENCES cycle_instances(id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cycle_passes_user_exact
  ON cycle_passes(user_id, exact_at);
```

The migration adds `UNIQUE (id, user_id)` to `cycle_instances`, so the composite
foreign key makes a cross-user pass impossible; two individually valid foreign
keys would not enforce that ownership relation.

`cycle_instances` groups every exact root for the same transiting body, natal
target, aspect, canonical oriented branch, and unwrapped 360° lift. It persists
that stable encounter as the versioned opaque `cyc_` identity defined in §4;
`oriented_branch` (`single`, `plus`, or `minus`) and integer `winding` remain
inside the calc engine's closed identity preimage rather than becoming public
wire or clear storage fields. Overlapping scan windows therefore address the
same physical encounter without deriving identity from whichever pass one
window happened to observe. A direct–retrograde–direct traversal crosses the
same lifted target three times
and therefore produces one cycle with three chronological passes; a later full
revolution crosses the next winding and produces a new cycle. Temporary exits
from the configured orb do not split a multi-pass cycle.

`cycle_instances.start_at` / `end_at` are the outer envelope: the earliest
configured-orb entry before pass 1 and the latest configured-orb exit after the
final pass. `exact_at` is the first pass's exact time — stable and immutable —
and `pass_count` is the length of the ordered pass list. The existing index
`idx_cycle_instances_user_phase` (`:260`) keeps working.

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

The object itself is also renamed and moved. In M0 it lived inside
`reading-evidence.schema.json` as a `$def` called `readingAssemblyRequest`;
M3 gives it its own document, `reading-assembly.schema.json`, under the name
`assemblyRequest`. A model-boundary object nested inside the evidence graph
reads as a detail of provenance rather than as the contract that decides what
crosses into a prompt, and the whole point of this decision is that it is the
latter.

**Why not "document it".** Escalation §4 offers two ways out: state that the key
never crosses into a prompt, or make it opaque. The first is unenforceable —
`assemblyRequest` is the model-boundary object (it carries
`output_schema` and `approved_fragments` and says the model "may not introduce
fragments outside this set"), and its `reading_key` is *required*, with a
canonical fixture reading literally
`"user:usr_01JAMPLEUSER00000001:2026-07-30:release-12"`
(`fixtures/valid/reading-assembly.request.json:3`). Spec §10 forbids "stable
direct identifiers" in the model request. A contract whose required field
violates the spec's own prohibition is not fixed by a comment.

**Canonical identity profile.** `contracts/m3/assembly-identity.schema.json`
freezes the exact hash preimage as a closed `assemblyIdentityInputV1` object:

```ts
interface AssemblyIdentityInputV1 {
  identity_profile: "patternlike.assembly-id.v1";
  schema_version: "0.3.0";
  assembly_policy_id: "daily-reading-deterministic";
  assembly_policy_version: string;
  // Defined by contracts/m3/daily-reading.schema.json. M0 named this schema in
  // three places and never shipped it, so the preimage was pinning a document
  // nobody could validate against; M3 ships it.
  output_schema: "daily-reading-v3";
  local_date: string;
  target_timezone: string;
  generation_anchor: string;        // persisted once; reused on every retry
  chart_fingerprint: string;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
  facts: AssemblyFactInput[];       // normalized, totally ordered
  release_version: string;
  release_bundle_hash: string;
  context: AssemblyContextInput[];  // minimized, normalized, totally ordered
  locale: string;
  domain_preference: LifeDomain | null;
  revision: number;
}
```

`AssemblyFactInput`, `AssemblyContextInput`, and `AssemblyUncertaintyInput` are
defined in that schema with `additionalProperties: false`. The uncertainty
projection contains accuracy, the approximate window values used by rendering,
plus sorted
`suppressed_features` (`feature_class`, `feature_id`, `reason`) and
`qualified_features` (`feature_id`, `qualification`). It deliberately excludes
the chart API's free-form `user_facing_summary`, which cannot enter reviewed
assembly. `effective_accuracy` must equal the projection's `accuracy`; a mismatch
is rejected. No request id, user id, crypto subject, session, job id, storage
row id, attempt count, or audit-only timestamp is permitted.
`generation_anchor` is written into the command before its first attempt and is
never recomputed from `Date.now()`. `target_timezone` is included because it can
change locale-formatted timing dates even when the UTC cycle timestamps are
identical. `assembly_policy_version` changes for any ranking, selection,
rendering, fallback, or validation change that can alter the output for
otherwise identical inputs.

Canonical bytes follow the JSON Canonicalization Scheme
([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)): validated I-JSON
values, ECMAScript number serialization, recursive UTF-16 property-name
ordering, UTF-8 output, and no implicit Unicode normalization. Arrays are put
into their contractually defined total order *before* canonicalization because
JCS deliberately preserves array order. Duplicate keys, non-finite numbers,
`undefined`, lone surrogates, and values outside the schema are rejected rather
than coerced.

```
canonical_bytes = JCS_UTF8(assemblyIdentityInputV1)
full_digest = SHA-256(canonical_bytes)
assembly_id = "asm_" + lowercaseHex(full_digest)[0:32]
```

The `identity_profile` field provides domain separation and versions the exact
preimage. The 128-bit rendered suffix is only the opaque handle; golden vectors
retain the full digest so an implementation cannot silently change canonical
bytes.

Content-addressed, not user-addressed. Three properties fall out:

1. No user identifier, no crypto subject, no session — nothing that names a
   person crosses the boundary.
2. It is not a stable pseudonym: the fact set changes daily, so the same user
   gets an unrelated id each day. A hash *of* the user id would not have this
   property, which is why the input is the closed identity preimage, not the
   account identity.
3. Identical versioned inputs produce an identical id, while an uncertainty or
   engine-policy change that can alter output necessarily produces a different
   id. That provides reproducibility without pretending code version is not part
   of the input.

`assembly_id` is not persisted in a clear `daily_readings` column. An unkeyed
digest of the exact facts, context, release, and anchor would itself be a
dictionary oracle. The id lives only in the DEK-encrypted immutable job command,
encrypted reading result, and encrypted paragraph evidence; the opaque
`daily_readings.id` / `reading_key` provides trusted-plane lookup. If a future
cache needs a clear index, it must use a per-user keyed commitment covered by
rotation, not the raw assembly digest.

**Enforced mechanically.** Golden tests pin the canonical UTF-8 bytes, full
digest, and rendered id for objects containing nested keys, Unicode, integers,
fractional numbers, reordered source objects, and distinct uncertainty
projections. Changing any effective-accuracy, suppression, or qualification
input changes the id; reordering an equivalent set does not. A separate boundary
test asserts that the serialized `assemblyRequest` — which carries the resulting
`assembly_id`, not the trusted-plane preimage — contains no `reading_key`,
`user_id`, `chart_fingerprint`, `local_date`, `target_timezone`, or
`generation_anchor`, and neither `usr_` nor `cs_` appears anywhere. The
prohibition becomes a failing test rather than a paragraph.

### D4 — Version the contract; leave M0 contract files byte-frozen

**Decision.** A new package `contracts/m3/` at `schema_version 0.3.0`. No file
under `contracts/m0/` changes — including its manifest, validator, fixtures, and
OpenAPI. The successor relationship is recorded forward-only in the M3
manifest with the predecessor package, predecessor schema version, and exact
hash of the frozen M0 manifest.

| New document | Contains |
| --- | --- |
| `SCHEMA_MANIFEST.json` | M3 freeze metadata, canonicalization/profile versions, normative files, and the M0 successor pointer |
| `common.schema.json` | M3's `schemaVersion` const `0.3.0`; unchanged vocabulary still references M0 by absolute `$id` |
| `assembly-identity.schema.json` | D3's closed `assemblyIdentityInputV1`, normalized uncertainty projection, and policy version |
| `generation-command.schema.json` | Immutable trusted `GenerateDailyReadingCommandV1`, artifact revision, and command generation |
| `reading-assembly.schema.json` | `assemblyRequest` — D3's `assembly_id` replaces `reading_key` |
| `reading-evidence.schema.json` | `readingEvidenceGraph` v0.3 — adds `revision`, `supersedes_reading_id`, `assembly_id` and the timing/fallback provenance rules below |
| `cycle-identity.schema.json` | Closed `CycleIdentityV1` branch/winding preimage and JCS profile |
| `cycle-request.schema.json` | The complete `POST /v1/cycles` request, including window and policy versions |
| `cycle-response.schema.json` | Normalized cycles with ordered `passes[]`, envelope boundaries, and calculation versions |
| `content-release.schema.json` | M0's signed editorial bundle plus reviewed timing templates and universal daily fallbacks |
| `openapi/openapi.yaml` | Full successor public API, including scheduling-timezone, Today, and evidence success responses |
| `openapi/calc.openapi.yaml` | Complete calc-service API, including `POST /v1/cycles`, authentication, status codes, and normative schema refs |

M3 documents `$ref` M0's `common.schema.json` by absolute `$id` for the shared
vocabulary (`cyclePhase`, `evidenceLane`, `allowedUse`, `celestialBody`,
`aspectType`, `ianaTimeZone`). The frozen enums are reused rather than forked;
M3 owns every changed required field, conditional, `$id`, and wire response.

The M3 OpenAPI is a complete successor document, not a fragment. It adds
authenticated `PUT /v1/preferences/timezone`; the two routes that have never
had a successful implementation — `GET /v1/readings/today` and
`GET /v1/readings/{id}/evidence` — return the M3 `DailyReadingResponse` and
`readingEvidenceGraph` with `schema_version: 0.3.0`. Standard errors remain
compatible, with the timezone-confirmation error added explicitly.
`openapi/calc.openapi.yaml` separately describes the calc-service server so
`/v1/cycles` is not falsely advertised on the public Worker origin. Its request
and response JSON Schemas are normative, and matching TypeScript wire types in
`packages/shared` are generated or compile-time checked against them.

**Reviewed timing provenance.** The M3 content-release contract declares its
`supported_locales` and requires an approved default `timing_template` for each
one. A template is a signed, hashed content object with a closed placeholder set
(`start_date`, `exact_date`, `end_date`, `orb`, `phase`) and no executable or
free-form interpolation. The renderer supplies locale-formatted calculated
values to that template. A `timing` paragraph therefore carries both its
calculated fact refs and the timing-template content ref, satisfying the
celestial-facts invariant instead of creating a facts-only exception.

**Universal fallback contract.** The same release requires exactly one approved
`daily_fallback` for every supported locale and requires `locale_default` to be
one of those locales. Each is a dedicated `fallback_copy` object with non-empty
reviewed text and `eligibility_mode: "universal"`; its schema permits no required
fact class, body, aspect, technique, house, context signal, or minimum accuracy
above `unknown`. It cannot delegate to a cycle/phase fragment. Ingestion rejects
a release with `locale_default_not_supported`,
`timing_template_missing_for_locale`, `fallback_missing_for_locale`,
`fallback_duplicate_for_locale`, `fallback_locale_mismatch`, or
`fallback_not_universal`; the existence of an unrelated safety rule is never
used as proof that a fallback exists.

**Why a package and not an in-place edit.** D3 removes a required field —
squarely inside `breaking_change_policy` ("any change to required fields, enums,
or `$id` requires a schema_version bump and a new freeze note"). D1's `revision`
would have to be added under `"additionalProperties": false`
(`reading-evidence.schema.json:299`), which is additive in intent but is still
an edit to a frozen schema document, and the amendment precedent so far covers
OpenAPI only. Versioning once is cheaper than arguing the boundary twice.

A new repo-level `contracts/validate_schemas.py` registers both frozen packages
without modifying the M0 validator and maps `contracts/m3/fixtures/` by prefix.
Per `AGENTS.md`, each new JSON Schema ships a valid fixture and a rejection case.
The focused invalid set covers an
assembly request carrying a `reading_key`, an identity preimage missing
`assembly_policy_version` or uncertainty, a generation command missing any
frozen dependency version, a cycle response with unordered passes, a timing
paragraph without its content ref, and releases missing either locale-bound
default. `openapi-spec-validator` validates both M3 OpenAPI documents, and route
contract tests validate both successful M3 responses rather than only the
existing 404 envelope. Phase 0 is complete only when all schemas, OpenAPI,
canonicalization vectors, fixtures, cross-document references, and a zero-diff
proof for `contracts/m0/` validate together.

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

**Inputs.** `{ identity_profile, schema_version, output_schema, local_date,
target_timezone, generation_anchor, assembly_policy_id,
assembly_policy_version, chart: { fingerprint, effective_accuracy, uncertainty,
natal_features }, cycles: NormalizedCycle[], release: VerifiedBundle,
release_version, release_bundle_hash, context: NormalizedContextSignal[], locale,
domain_preference, revision }`. Every value is supplied by the frozen command
in §5; the engine does not discover a newer chart, release, context row, date,
zone, schema, or policy version while it runs.

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
   function nowhere to put one. `resonance_feedback` and `user_priority` were
   dropped from the M3 enum for exactly that reason: leaving them declared makes
   the prohibition a convention, and `reading-evidence.engagement-ranking.json`
   pins the rejection. Tie-breaks are total and terminate on cycle id.

   **Phase is timestamp-driven, not orb-driven.** DER-01 specifies a state
   machine over event timestamps, and the engine is pure — it has no ephemeris
   with which to evaluate an instantaneous orb, and giving it one would cost the
   property that the whole core runs with no mocks. Thresholds live in one
   versioned block in `phase.ts`. Where `peak` and `reconsidering` both apply,
   `peak` wins; the design left that undefined and a test now pins it.
6. **Selection.** One primary, at most one supporting. A supporting influence is
   suppressed unless it is *distinct* — different `(body, target, aspect)` and a
   different parent cycle — so the reading cannot say the same thing twice.
7. **Assembly.** Fixed role order: `primary_theme`, `supporting_theme?`,
   `phase_context`, `timing?`, `reflection`, `uncertainty_notice?`,
   `context_label?`.

   **The renderer writes no original prose.** Every paragraph is a reviewed
   string or reviewed template from
   the bundle — `phase.summary`, `constructive_expression`,
   `shadow_expression`, `prompt.prompt_text`, `modifier.body`, or D4's
   locale-specific `timing_template` — selected and ordered, never joined with
   connective sentences authored in code. Connective prose would be unreviewed
   content in a product whose acceptance criterion is that every paragraph
   resolves to an approved content version. The timing renderer may only fill
   the template's closed placeholders with calculated values; its evidence has
   at least one fact ref and the exact signed template content ref.
8. **Validation (DER-22).** Runs the frozen `validationResult` checks
   (`reading-evidence.schema.json:250-295`). In deterministic mode several
   checks are structurally impossible to fail — they still run and record
   `pass`, cheaply. Only the checks that need a classifier (`fatalism`,
   `diagnosis`) record `skip` with `detail_code: "deterministic_mode"`, so the
   validation log distinguishes "verified" from "not applicable here".
9. **Fallback.** `safety_rules.minItems: 1` proves only that a validator rule
   exists; it does not prove that any rule applies to the requested locale or
   that its referenced fragment is eligible without facts.

   Locale resolution occurs before assembly: exact supported locale, then the
   explicitly configured language fallback, then `locale_default`. If nothing
   survives eligibility — the common case, since most days have no cycle inside
   orb — or a required validation check rejects the draft, the engine emits that
   locale's universally eligible D4 `daily_fallback`, sets
   `validation.fallback_used = true`, and records a `safety_fallback` paragraph
   with operational evidence, one fallback content ref, and empty fact/context
   arrays. A missing fallback is an impossible active-release state, not a reason
   to select an unrelated safety rule or publish blank, unprovenanced text.

   The zero-fact day is the *commonest* day, not an edge case, which is why
   `facts` and `approved_fragments` carry `minItems: 0` in the assembly request
   rather than the `minItems: 1` the design first specified. A `minItems: 1`
   there makes the ordinary day structurally unrepresentable, and
   `reading-assembly.zero-facts.json` is the fixture that keeps it that way.

   **A locale with no eligible reflection prompt is a rejection, not a shorter
   reading.** The role order treats `reflection` as part of the daily chapter, so
   the engine emits `no_reflection_prompt_for_locale` and the gap surfaces in the
   evidence drawer. Silently dropping the paragraph would make a content gap
   indistinguishable from an editorial choice.

**Second entry point:** `evaluateFixture(bundle, fixtureCatalogue, fixtureId) →
"eligible" | "ineligible" | "fallback"`. `ineligible` and `fallback` are
deliberately distinct even though both publish the reviewed fallback: "a
candidate existed and was ruled out" is a different editorial fact from "nothing
was offered", and collapsing them would hide which one a release is producing.
This is what lets
`POST /internal/content-releases` stop returning `accepted_pending_tests` for
fixture-bearing bundles (`routes/content-releases.ts:425-440`). It is a pure
call over the same core, which is why it costs nothing extra.

**Done when:** the canonical fixtures round-trip — `reading-evidence.daily.json`
is reproduced from its inputs, the assembly request validates against the M3
schema, and `content-release.bundle.json`'s declared fixture evaluates to
`eligible` — with the engine imported into a plain `node:test` file. Additional
fixtures prove that every timing paragraph carries both fact and template refs,
each supported locale has a byte-stable fallback outcome, and no-cycle and
validation-rejection paths publish reviewed fallback copy rather than an empty
reading.

---

## 4. Part 3 — Cycle inputs

**New calc endpoint: `POST /v1/cycles`.** `POST /v1/calculate` stays exactly as
it is; this is additive, and the calc binding is already plain HTTP so nothing
about the deployment shape changes.

**The request carries natal positions, never birth data.**

```ts
interface CycleRequest {
  schema_version: "0.3.0";
  request_id: string;
  chart_fingerprint: string;
  natal_positions: LongitudePosition[];
  natal_accuracy: BirthTimeAccuracy;   // effective
  window: { from: string; to: string };  // UTC instants
  techniques: ["transits"];              // launch scope
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  contract_id: string;
  contract_version: string;
}
```

**Normative cycle wire shape.** `cycleRequest` is closed. Its
`natal_positions` entries contain only `body` and `longitude_deg`; the request
permits no user id, birth instant, timezone, coordinates, profile id, or storage
id. `cycleResponse` is a discriminated union. Success requires `ok: true`,
echoes request/calculation-policy identifiers plus calculation-container and
ephemeris-data versions, and returns `cycles[]`. Failure requires `ok: false`,
`error_class`, and a payload-free `error_message`; it returns no partial cycle
set.

Each normalized cycle requires `id`, `technique: "transit"`, `body`, `target`,
`aspect`, `start_at`, `exact_at`, `end_at`, `pass_count`, and chronological
`passes[]`. `exact_at` equals `passes[0].exact_at`. Each pass requires 1-based
`pass_index`, `direction`, `exact_at`, and `speed_deg_per_day`. Semantic
validation enforces contiguous indices, `pass_count == passes.length`, strict
chronological order, envelope containment, unique cycle ids, response ordering
by `(exact_at, id)`, and omission of Ascendant/Midheaven targets under unknown
effective accuracy. It also omits natal Moon targets when the chart uncertainty
report suppresses `moon_time_sensitive`; a transiting Moon may still be scanned
against stable natal targets.

`window` is a selection interval, not permission to clip an encounter. The
scanner returns a cycle when its complete orb envelope intersects
`[window.from, window.to)`, but it evaluates beyond both boundaries across the
adjacent stations and orb roots until the first entry, every exact pass, and the
final exit for that oriented branch/lift are known. The maximum look-behind and
look-ahead is body-specific and versioned with the cycle policy. Reaching that
limit without proving both outer boundaries returns
`cycle_window_incomplete` for the whole request; it never emits or persists a
partial cycle. Overlapping request windows that select the same encounter must
therefore return the same complete pass list, envelope, `exact_at`, and id.

**What "proven" has to mean.** Being outside orb at the edge of the scanned span
does *not* prove an encounter has ended, and treating it that way is a real bug
rather than a conservative approximation: a body can exit through `+O`, station
a degree later, and come straight back in — which is precisely the multi-pass
case this endpoint exists to describe. A scanner that stopped at "outside orb at
the edge" would answer a truncated window with a confident single-pass cycle and
a narrow envelope, and it would look right.

What does prove it is a bound on how far a body can travel against its own net
motion. `max_retrograde_arc_deg` is that bound, per body, versioned with the
cycle policy: once `|fT| > O + max_retrograde_arc_deg`, the body cannot return
to within `O` of that lifted target, because doing so would take more retrograde
travel than it has. So the search for the earliest entry is bounded on the left
by the last such point before the first pass, and the search for the latest exit
on the right by the first one after the last pass. Every `lookaround_days` in
the table is derived from that inequality — the time the body needs to cover
`2(O + arc)` of net motion at its widest orb, plus margin — which is why Pluto's
is eight years and the Moon's is six days.

An encounter near the edge of the span is routinely unprovable and routinely
irrelevant, so the cheap bound is applied first: if the proven-left point already
falls after the window closes, or the proven-right point before it opens, the
encounter cannot touch the window and is dropped without being proven. Only an
encounter that could actually intersect the window has to be proven, and only
its failure fails the request. Without that ordering every scan would fail,
because every span has edges.

Transit-to-natal contacts need natal longitudes and nothing else. Sending them
instead of the birth instant means the calculation service never needs a
decryption path, and the "birth stays encrypted at rest" invariant survives the
new surface untouched. (This does not *improve* escalation §11 — `snapshot_json`
precision remains the open product question — but it does not worsen it either,
and the cycle scan must inherit whatever precision policy §11 settles on rather
than inventing a third one.)

**Algorithm.** AST-08 requires interval scanning plus numerical refinement for
exact passes and orb entry/exit. `angularSeparation` is intentionally unsigned
in `[0, 180]`; it remains a chart-aspect/reporting helper, not a cycle root
function. In particular, `angularSeparation - 0` only touches zero at
conjunction and `angularSeparation - 180` only touches zero at opposition, so
sign-change bracketing on that value misses ordinary crossings.

For transiting longitude `λ(t)`, natal longitude `N`, and aspect angle `A`, first
construct the distinct oriented target longitudes:

```text
targets(N, A) = unique(norm360(N + A), norm360(N - A))
```

Conjunction (`A = 0`) has one target. Opposition (`A = 180`) also has one target
because `N + 180` and `N - 180` are the same longitude modulo 360; they must be
deduplicated so one opposition is not emitted twice. Every launch aspect
strictly between 0° and 180° has two distinct oriented branches.

Sample longitude and signed longitudinal speed on the fixed, epoch-anchored
grid (6 h for fast bodies, 1 d for slow). Unwrap successive samples with:

```text
wrap180(x) = x - 360 * floor((x + 180) / 360)   // [-180, 180)
L[unwrapping_epoch] = norm360(λ[unwrapping_epoch])
L[i] = L[i - 1] + wrap180(λ[i] - λ[i - 1])
```

`L` is not reset to `norm360(λ)` at each request boundary. Every body/policy
version has a fixed `unwrapping_epoch`; a verified checkpoint chain derived from
that epoch supplies absolute lifted longitude at the first evaluation sample,
and the recurrence continues forward or backward. Checkpoints are a performance
cache whose values must match epoch recomputation, not an alternate source of
identity. Thus the integer winding for an overlapping encounter is independent
of the requested window.

Adaptively subdivide and refine every signed-speed reversal, inserting the
station time into the grid, until each root interval is on one continuous
motion branch and spans less than 180°. For a normalized target `T0` and integer
lift `k`, let `T = T0 + 360k`. Within a bracket anchored at
`(tᵢ, Lᵢ, λᵢ)`, evaluate:

```text
liftedLongitude(t) = L[i] + wrap180(λ(t) - λ[i])
fT(t) = liftedLongitude(t) - T
```

`fT` is the oriented, continuous root function. Record an endpoint/grid root
once when it is within the versioned angular-zero tolerance; otherwise bracket
a strict sign change and refine it with deterministic bisection until the time
bracket is at most two seconds, yielding a timestamp accurate to ±1 second.
Never normalize each solver evaluation independently, because that reintroduces
a false discontinuity at ±180°. Splitting at refined stations exposes the two
crossings that can otherwise hide inside one base interval. If a refined
station itself satisfies `fT = 0` within tolerance, record one tangent pass, not
an arbitrary “near-zero” minimum; use the outgoing station direction
(`retrograde` for direct→retrograde, `direct` for retrograde→direct) for the
existing two-value direction field.

Group all exact roots for the same `T` into one cycle and order them
chronologically. Direction is the sign of Swiss longitudinal speed at an
ordinary root, with the station rule above as the zero-speed tie-break. This
produces direct–retrograde–direct or longer pass sequences without grouping by
temporal proximity, orb overlap, or scan batch. A root at `T + 360` belongs to
the next cycle.

AST-08 also requires calculated orb entry and exit. For configured orb `O`,
solve the two oriented boundary equations `fT(t) = -O` and `fT(t) = +O` with the
same unwrapped scanner and refiner; do not infer boundaries from sample
timestamps or solve only `abs(fT) - O`. Classify each boundary by evaluating the
inside-orb predicate `abs(fT) <= O` immediately before and after it. A tangent
touch that does not change that predicate is not an entry or exit. For the
grouped cycle, store the earliest outside→inside event before its first pass as
`start_at` and the latest inside→outside event after its final pass as `end_at`;
intervening exits and re-entries remain part of the same lifted-target cycle.

`angularSeparation` and `isApplying` remain available for their existing
reporting/classification contracts, but neither supplies an exact-pass or
orb-boundary root equation.

**Sun/Moon oracle.** Swiss Ephemeris exposes `solcross_ut` and `mooncross_ut`,
which independently find the next geocentric crossing of a requested longitude.
The production cycle result for every body, including the Sun and Moon, must
still come from the general scanner above. In deterministic tests only,
enumerate the Sun/Moon oracle crossings over the fixed fixture window for every
canonical exact target and its two orb-boundary targets, then compare them
one-for-one with scanner results within ±1 second. Oracle timestamps must not
seed scanner brackets, populate production output, or be copied into expected
fixtures. `helio_cross_ut` is excluded because a heliocentric crossing cannot
validate a geocentric transit calculation; no equivalent planetary oracle
exists.

**Deterministic ids.** The private identity projection is a closed
`CycleIdentityV1` containing `identity_profile`, `chart_fingerprint`,
`technique`, transiting `body`, natal `target`, `aspect`, `oriented_branch`,
integer `winding`, contract id/version, cycle-policy id/version, orb-policy
id/version, calculation-container digest, and ephemeris-data version. RFC 8785
canonical bytes are hashed with SHA-256 and rendered as
`cyc_` plus the first 32 lowercase hex characters. Pass timestamps are not in
the identity: complete discovery may refine them, while the epoch-anchored
branch/winding pair names the same physical encounter across shifted horizon
scans. A new calculation-policy version creates a new vintage rather than
overwriting an older interpretation. `cycle_policy_version` must bump whenever
the ephemeris/container, unwrapping epoch/checkpoints, scan grid, station/root
tolerances, or complete-encounter lookaround can alter output; the persisted
`horizon_version` records that same value.

**Suppression at the source.** Under `unknown` effective accuracy, transits to
`ascendant` and `midheaven` are not computed at all. Natal Moon targets are also
omitted when `uncertainty.suppressed_features` contains `moon_time_sensitive`;
the transiting Moon remains valid against stable natal targets because the
transit instant is known. These facts are never created and filtered later.

**What the implementation pinned.** These are decisions the design left open and
Phase 3 had to make; each is now a versioned constant or an explicit rejection.

- **Where the numbers live.** `apps/calc-stub/src/cycle-policy.ts` holds every
  value that can alter output — the unwrapping epoch, the scan and checkpoint
  grids, the root/station/dedupe tolerances, the boundary-classification probe,
  the lookarounds, the retrograde bounds, and the transit orb table. A diff there
  is a diff that must bump `cycle_policy_version`, which is easier to enforce
  when there is one file to look at.
- **The policies are named and matched, not assumed.** This build implements
  `transit-scan-launch@1.4.0` and `orb-launch@1.0.0`, the identifiers the frozen
  fixtures already carry. A request naming any other policy is rejected as
  `invalid_request` rather than answered under a substitute, because the policy
  identifiers are hashed into every cycle id — answering would mint ids claiming
  a vintage the scan did not use.
- **Transit orbs are not natal orbs.** `orb-launch` is a body-class table
  (6°/5°/4°/3° at conjunction from luminaries to outer planets, tighter for
  every other aspect), deliberately not the natal `orb-launch-default` table in
  `engine.ts`. Natal orbs say how wide an aspect may be and still be reported;
  transit orbs say how long an encounter is claimed to *last*, and a natal-width
  orb on Pluto is a decade-long "cycle" that means nothing to a reader.
- **The checkpoint chain is anchored, not accumulated.** Lifted longitude at any
  instant is `checkpoint.lift + wrap180(λ − checkpoint.lon)` against the nearest
  epoch-anchored checkpoint, and root brackets re-anchor at their own start
  sample. That makes every evaluation independent of scan order, which is a
  stronger property than the running recurrence the design sketched and gives the
  same values.
- **The ephemeris is injectable.** `EphemerisSource` is an interface; production
  passes Swiss Ephemeris and the tests pass analytic longitude functions. A
  station-on-target tangent and a controlled 0°/360° unwrap are not reachable by
  waiting for the real sky to produce one on cue, and the acceptance list below
  requires both.
- **`importance_score` is not computed here.** The response schema permits it,
  but ranking is `packages/reading-engine`'s job and must not land in the AGPL
  service. The field is omitted rather than filled with a placeholder.
- **Three semantic rules the contract left to code**, each a decision rather than
  a reading of the schema: `window.from` must precede `window.to`; a body may
  appear at most once in `natal_positions` (duplicates would mint two cycles with
  byte-identical identities, and the response requires unique ids); and an angle
  must not be *sent* when angles are suppressed, whereas a natal Moon under
  `moon_time_sensitive` is *omitted*. The asymmetry is the contract's own: it
  phrases the angle rule as a caller obligation and the Moon rule as service
  behaviour. `angles` and `angle_transits` in `suppressed_features` are treated
  as independent triggers for the angle rule alongside unknown accuracy, which
  the contract does not state — it is the safe direction, since it can only ever
  suppress more.
- **Transport versus engine.** Unparseable JSON, a bad token, and missing
  production configuration are HTTP 400/401/503 with the `{error:{code,message}}`
  envelope, because they never reached the engine. Everything else is HTTP 200
  with a discriminated `ok:false` body, so a caller can tell "the engine ran and
  refused" from "the request never arrived".

**What an adversarial review of the implementation changed.** Six of these were
found by reviewing the finished scanner against this document and the contract,
and each was reproduced before it was believed. They are recorded because every
one of them is a class of mistake that would recur.

- **`window` needs a duration cap, and the contract does not give it one.** The
  handler is synchronous inside a single-threaded server, so a contract-valid
  ten-year window blocks it for ~17 s — past the Fly health check, so the machine
  leaves rotation while it works — and a century-scale one reaches ~450 MB
  against a 256 MB VM. `MAX_WINDOW_DAYS` is 92, a quarter, which is far more than
  the daily reading needs. Raising it should come with making the handler yield,
  not just with moving the number.
- **`Date.parse` is not `format: date-time`.** It accepts `2026-07-30`,
  `Aug 9, 2026`, even `1.4.0`, and — worst — an offset-less instant, which
  ECMAScript resolves in the *host* timezone. The same request answered in
  `America/Chicago` and in UTC returned different cycles. The window instants are
  now gated on an RFC 3339 pattern with a mandatory offset, and the calendar
  fields are checked individually, because `Date.parse` rolls `2026-02-30`
  silently into March rather than rejecting it.
- **Retrograde arcs and lookarounds have to be measured, not reasoned about.**
  Every textbook-shaped estimate was wrong in the dangerous direction: Mercury's
  real arc over 1800–2399 is 16.3° against an assumed 12°, and Pluto near
  aphelion needs a seventeen-year lookaround where its mean rate suggested nine.
  An underestimated arc makes the scanner declare an encounter proven-over while
  the body can still return, dropping whole cycles silently. The requirement is
  also `2(O + arc)` of net travel, not `(O + arc)`: the window can sit at either
  end of the encounter, so one side may have to cover the whole span.
- **The checkpoint anchor can leave the data files even when the scan cannot.**
  Anchoring at the *nearest* epoch-anchored index reaches up to
  `lift_step_days / 2` — 600 days for Neptune and Pluto — beyond the validated
  span, where Swiss Ephemeris substitutes Moshier and the strict `calcBody`
  throws. Requests in 1820 and 2380 failed with `calculation_failed` on a range
  the service declares it supports. The anchor is now clamped to the measured
  Julian-day coverage of the pinned files.
- **A speed-sign comparison cannot tell zero reversals from two.** The true node
  has brief direct episodes — some ten minutes long, about twice a year — so a
  retrograde–direct–retrograde pair hides inside one grid interval, leaves the
  bracket non-monotonic, and silently drops the exact passes it contains. A finer
  fixed grid does not fix it; the episodes are shorter than any grid worth
  paying for. The same-signed case is now a proof obligation: with a measured
  bound on `|d(speed)/dt|`, no zero can lie between two same-signed endpoints
  while `min(|v_a|, |v_b|) > maxSlope · width / 2`, and where that fails the
  interval is halved until it is narrower than the shortest span that can hold
  two stations.
- **`/v1/engine` was serving an absolute filesystem path.** `ephe_path` on a
  deliberately unauthenticated route is the same disclosure the error-envelope
  rule exists to prevent, except on purpose and to anyone. It is replaced by the
  version identifiers a caller actually needs, and `calc.openapi.yaml` now
  describes what `/health` and `/v1/engine` really return rather than a shape
  neither has ever matched.

**Done when all of the following pass on fixed, deterministic fixtures**
(all satisfied; `apps/calc-stub/src/cycles.test.ts`, 50 tests):

- forward and retrograde 0°/360° unwrap cases produce continuous lifted
  longitude;
- conjunction and opposition crossings are each found once, while an
  intermediate aspect's two oriented branches remain distinct;
- an exact grid-point root and a station-on-target tangent are each emitted once,
  with shared-bracket duplicates removed;
- every exact, orb-entry, and orb-exit root meets the declared angular tolerance
  and ±1-second time tolerance;
- a known retrograde encounter is one lifted-target cycle with exactly three
  chronological passes, contiguous indices, `pass_count = 3`, directions
  `direct`, `retrograde`, `direct`, `exact_at = passes[0].exact_at`, and the
  earliest-entry/latest-exit envelope even when the body temporarily leaves orb;
- two shifted windows intersecting that encounter return the same complete
  envelope, passes, first exact time, and cycle id; a deliberately insufficient
  lookaround fails `cycle_window_incomplete` without partial rows;
- Sun and Moon exact and boundary roots agree one-for-one with the test-only
  `solcross_ut` / `mooncross_ut` oracle within ±1 second;
- valid cycle responses pass the M3 schema while unordered passes,
  noncontiguous indices, count mismatch, and first-exact mismatch fail;
- an unknown-time fixture produces no angle or natal-Moon targets while retaining
  a transiting-Moon contact to a stable natal target; and
- two identical scans produce byte-identical normalized cycles and ids, and the
  second persistence run creates no additional cycle or pass rows.

---

## 5. Part 4 — Persistence: `GenerateDailyReading`

Generation has two transactions: enqueue reserves immutable inputs; completion
publishes that reserved result. [Cloudflare Queues is
at-least-once](https://developers.cloudflare.com/queues/reference/delivery-guarantees/),
so neither a retry nor a recovered lease may resolve “today” or “active” inputs
again.

### Scheduling timezone is a persisted input

`users.timezone` is the user's present-day scheduling zone. Identity creation
currently initializes it to `UTC`; that value is marked
`timezone_source = 'default_unconfirmed'`, not treated as a user decision.
`birth_profiles.timezone` is the historical birthplace zone and must never be
substituted for it.

The M3 public OpenAPI therefore adds authenticated
`PUT /v1/preferences/timezone`. It accepts an IANA zone, validates it, records a
user-confirmed override (which wins over device-derived DEV-01 state), increments
`timezone_revision`, and retains the current value plus the registry-required
35-day change log. A device update may refresh a device-derived value but may
not overwrite a user override. Scheduled generation is withheld while the
default is unconfirmed. A timezone change affects only commands enqueued after
the change; an already reserved local day never moves.

**Locale has exactly the same defect and gets exactly the same treatment.**
`users.locale` is initialized to a server default in the same way, and locale
selects the reviewed fallback and the timing template — so an unowned default
silently decides which reviewed prose a reader is shown. M3 therefore also adds
`PUT /v1/preferences/locale` and `users.locale_source`, on the same
`default_unconfirmed` / `device_derived` / `user_confirmed` rules.

### Enqueue freezes the generation command

One consistent enqueue read selects the confirmed scheduling timezone, target
local date, active chart snapshot, exact cycle-scan result, consent/permission
state, fresh context, and active editorial release. Before the queue message is
sent, it creates a closed `GenerateDailyReadingCommandV1`. The local date comes
from the trusted enqueue instant in that stored zone, never from a client date
or from the worker's later attempt time. The command contains:

- `reading_id`, `reading_key`, `revision`, `supersedes_reading_id`, and
  `revision_reason`;
- `target_local_date`, IANA `target_timezone`, `timezone_revision`, and the
  already-computed half-open UTC interval `[day_start_at, day_end_at)`;
- `generation_anchor` (also the response's `generated_at`), resolved locale,
  domain preference, identity profile, schema/output versions, and assembly
  policy id/version;
- exact chart snapshot id/fingerprint/profile version, chart contract/version,
  calculation-container digest, chart `tzdb_version`, effective accuracy, and
  the normalized assembly uncertainty projection;
- exact cycle/pass ids and hashes, cycle-policy id/version (persisted as
  `horizon_version`), orb-policy id/version, cycle calculation-container digest,
  and ephemeris-data version;
- release version and expected release-bundle hash; and
- exact context-signal ids/hashes and the consent, permission, and freshness
  versions under which each was eligible.

The complete immutable command — including `assembly_id` after its D3 preimage
is hashed — is stored as DEK-encrypted `jobs.payload_enc`, with its key version
and nonce and AAD bound to
`(subject, "jobs.payload_enc", job_id, key_version)`. The existing `jobs.user_id`
makes this column compatible with the rotation walk, and a CHECK forbids
`payload_enc` when `user_id IS NULL`. Clear `jobs.payload_json` and the Queue
message contain only command version, job id, and reserved reading id.
`daily_readings.active_generation_job_id` and `command_generation` identify which
immutable job currently owns the reservation; earlier terminal job rows remain
encrypted history. `jobs.payload_enc` is added to `ENCRYPTED_COLUMNS` before its
first writer lands.

Initial enqueue writes one queued encrypted job, one
`daily_readings(status='pending')` reservation pointing to it, and one opaque
audit event in a single `DB.batch()`. It no-ops if a published or pending row
already exists. A trusted reissue requires an allowed reason and
`expected_live_reading_id`; its reservation succeeds only if that exact row is
still published for the same user/day and the new revision is exactly one
higher. Uniqueness/guard failures are re-read and returned as `duplicate` or
`stale_predecessor`, never converted into an unconditional supersession.

The replacement path defined in D1 is a different batch: insert the next `gN`
encrypted job, CAS the same failed reservation from its exact terminal active
job back to `pending`, update `active_generation_job_id` / `command_generation`,
refresh the reservation's frozen clear keys from that command, and audit the
replacement reason. A stale job id, nonterminal job, or stale reissue
predecessor aborts the batch. It never overwrites the earlier command or creates
a competing artifact revision.

### The scheduler may replace its own terminal failure, within a budget

Without this, a terminal failure permanently bricks a user-day. The reservation
sits at `status = 'failed'` with `revision = 1`, and
`UNIQUE (user_id, local_date, revision)` blocks any fresh initial enqueue
forever. Replacement is the only recovery, and describing it as an operator
action does not survive contact with a surface that runs unattended, daily, for
every user: one bad afternoon on the calculation service would leave a silent
hole in a reader's history that only a human ticket could fill.

**Decision: the scheduler performs the replacement CAS itself, under a bounded
budget, and only for failures that are infrastructural.** The split falls
exactly along `commandReplacementReason`, which already distinguishes the two
kinds:

| Reason | Who may replace | Why |
| --- | --- | --- |
| `calc_unavailable` | scheduler | The inputs were fine; a dependency was down. Re-freezing the same day against a working dependency is the obvious repair, and no human judgement is involved. |
| `release_unreadable` | scheduler | Same shape: the R2 bundle or its hash was unreachable, not wrong. |
| `context_minimized` | operator only | Deciding that a reading should be re-frozen with less context is a privacy judgement about a specific person. |
| `policy_upgraded` | operator only | Choosing to re-generate a day under a new policy version is an editorial decision about which vintage a reader should have seen. |
| `defect_repair` | operator only | By definition someone has diagnosed a defect. |

The budget is `command_generation`: auto-replacement is permitted only while
`command_generation < 3`, giving at most two automatic attempts after the
initial command. Two, not more, because each replacement re-freezes a *new*
command — a wider budget turns a persistent dependency outage into a
per-user amplification of load against the thing that is already failing. The
CAS conditions are unchanged; the scheduler simply becomes an allowed caller of
the same guarded batch, and every automatic replacement writes the same audit
event an operator's would, with its reason.

Auto-replacement is additionally scoped to a day that is still current: the
reservation's `target_local_date` must be the user's present or immediately
preceding local date in the confirmed scheduling zone. A failure from three
weeks ago is history, and silently regenerating it would publish a reading
dated to a day the reader has already moved past.

Budget exhaustion is a terminal, visible state: the reservation stays `failed`,
an audit event records that the budget was spent, and the day has no reading.
That is a worse outcome than a reading and a better one than an unbounded retry
loop against a broken dependency — and unlike today's behaviour, it is a state
an operator can see and act on rather than one nobody notices.

D1 and Queue delivery cannot share a transaction, so the D1 job row is also a
durable outbox. Only after the reservation batch commits does a dispatcher send
the opaque `{ job_id, reading_id }` message. `dispatched_at` is advisory: an
undispatched-row sweeper retries a crash before send, and a crash after send may
send twice. Both paths converge through the command idempotency key and claim
CAS; no code treats a Queue send response as proof that generation completed.

### Execute only the frozen reservation

A consumer compare-and-swaps a queued job to `running` with a random
`claim_token` and bounded `lease_expires_at`; a zero-row claim does no work.
The consumer decrypts `GenerateDailyReadingCommandV1`, selects the exact
registered assembly-policy implementation named there, and dereferences only
the exact chart, cycles, release, and context versions in the command. Old
policy implementations are retained for at least the maximum job/lease retry
horizon; an unsupported frozen version fails closed. The R2 bundle's hash is
recomputed with the frozen M0 release-hash procedure — not JCS — and must equal
both the command hash and its trusted D1 release record.

A release activation, newer chart, changed timezone, midnight rollover, or new
cycle scan cannot change the job. A missing or hash-mismatched dependency fails
closed rather than substituting an active row. Consent or permission revoked
after enqueue cancels that job and fails its reservation; it may not silently
delete a frozen input and thereby change the assembly identity. A later
context-minimized reading uses the explicit next-`gN` replacement path, not a
retry. No execution-time read may add a context source. The pure §3 assembler
therefore receives the same values on every retry and reproduces the same
`assembly_id`.

### Encrypt prose and reconstructive provenance

The reading prose is encrypted with AAD bound to
`(subject, "daily_readings.reading_enc", reading_id, key_version)`.
Output-derived metadata capable of identifying the deterministic result — the
`assembly_id`, clear `content_hash`, selected cycle refs, and validation detail —
moves inside that encrypted envelope rather than remaining as a dictionary
oracle. The M3 response reconstructs those fields only after decryption.

Concretely, the `daily_readings` rebuild **drops** `content_hash`,
`primary_cycle_id`, `supporting_cycle_id`, and `validation_json`; all four now
live inside `reading_enc`. Naming them matters because a rebuild that discussed
the new columns and left the old ones standing would have kept exactly the
oracle this paragraph exists to remove — a clear digest of the day's facts, plus
the two cycle ids that produced it, is a reconstruction path that survives DEK
destruction.

`reading_sources` gains `user_id` and a composite
`FOREIGN KEY (reading_id, user_id) REFERENCES daily_readings(id, user_id)`;
`daily_readings` gains the corresponding composite unique key. This both rejects
cross-user evidence and lets the existing rotation walker select/update the
table through `user_id`. The table otherwise retains only owner/opaque
row/reading/paragraph linkage, paragraph order, and timestamps in clear. Each
paragraph's complete evidence object is stored in `evidence_enc`, with
`evidence_key_version` and `evidence_nonce`, using AAD bound to
`(subject, "reading_sources.evidence_enc", reading_source_id, key_version)`.
That encrypted object contains role, evidence lane, `text_hash`, fact refs,
content/fragment refs, context-signal and source refs, ranking factors/reasons,
model linkage, and timing-template provenance. Fragment ids plus a text hash
must not remain clear: a retained D1 backup plus the R2 release catalogue could
otherwise reconstruct deleted prose offline.

`jobs.payload_enc`, `daily_readings.reading_enc`, and
`reading_sources.evidence_enc` are added to `ENCRYPTED_COLUMNS`. Rotation tests
cover every row through a valid user-ownership path; DEK destruction makes the
commands, prose, assembly digest, and reconstructive evidence unavailable.

### Complete the reading and job atomically

Successful completion is one ordered `DB.batch()`:

1. insert a transient publication guard naming the reserved reading, expected
   predecessor, running job, claim token, and expected evidence-row count;
2. for a reissue, supersede the exact expected predecessor;
3. publish the reserved pending row with its ciphertext;
4. insert every encrypted evidence row;
5. insert the opaque completion audit event;
6. transition the same claimed job from `running` to `succeeded`; and
7. delete the transient guard.

The guard is expressed with `assertion_probe`, not with triggers. 0002 ships a
table whose only column is constrained `CHECK (id = 0)` and which therefore can
never hold a row, so

```sql
INSERT INTO assertion_probe (id, reason)
SELECT 1, '<reason>' WHERE <bad condition>;
```

is a no-op when the condition is false and aborts the enclosing transaction when
it is true — a conditional abort in pure SQL, built from a CHECK constraint and
nothing else. The opening assertion aborts unless the pending reservation, exact
live predecessor/revision (or initial no-predecessor state), and associated
running job with the presented claim token all match
`active_generation_job_id` / `command_generation`. The closing assertion aborts
unless the reading is published, the exact predecessor is superseded when
applicable, the evidence count matches, and that same job is succeeded. A guarded
`UPDATE` that merely affects zero rows is insufficient because later statements
could otherwise commit; the closing assertion catches that case. [D1 executes
`batch()` statements as one
transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
so any aborted assertion or failed evidence insert rolls the guard and the
entire publication/job transition back.

The design originally specified `BEFORE INSERT` / `BEFORE DELETE` triggers on a
transient guard table, and 0002 does not use them. Two reasons, both concrete:
SQLite's `ALTER TABLE … RENAME` rewrites table references *inside trigger
bodies*, which collides with the table rebuilds this same migration performs;
and D1's trigger support on the remote path is not something a migration needs
to depend on when a CHECK constraint does the same job.

Failure moves the pending reservation to `failed` and closes the same active
claimed job in an equivalent guarded batch; it never supersedes the live
reading. The Queue message is acknowledged only after a terminal job state
commits; transient failures release or retry with bounded backoff, and an
expired lease is reclaimable. A loser in a completion race re-reads the job and
reports `duplicate` if another claim already committed success.

### Forward-only migration and production order

`0001_m0_core.sql` is immutable from this point forward. The production runbook
records a live Worker bound to D1 `patternlike-ops` with the 22-table M0 schema
already applied, so editing the baseline and deleting only local Wrangler state
cannot change production.

Phase 2 adds `db/d1/0002_m3_daily_reading_pipeline.sql` and appends it to
`MIGRATIONS.json`. It rebuilds `daily_readings` to replace the old uniqueness
constraint and command linkage; extends `jobs` with encrypted immutable command,
outbox, and lease fields; rebuilds `reading_sources` with constrained user
ownership and encrypted evidence; and adds revision/replacement guards, stable
cycle branch/winding identity, ownership-safe cycle passes, timezone
revision/history, partial indexes, and publication guards. It is tested both as
a fresh ordered migration set and as an upgrade of a populated,
production-shaped 0001 database. If production contains an unexpected
reading/evidence row that cannot be converted without its DEK, migration stops
for an application-layer encrypted backfill; it never discards the row.

`daily_readings` and `reading_sources` are **dropped and recreated under their
final names**, not renamed. SQLite only rewrites `REFERENCES` clauses on rename
while foreign-key enforcement is on *at that moment*, so a rename-based rebuild
silently produces a dangling reference wherever that does not hold — and whether
it holds depends on connection state the migration does not own. Pre-flight
assertions prove `daily_readings`, `reading_sources`, and `reading_feedback` are
empty, which is both what makes dropping safe and what implements the
"never discards the row" requirement: a non-empty table aborts the migration
rather than losing anything. Because the rebuild no longer depends on rename
semantics, `PRAGMA defer_foreign_keys` is not needed either.

Two further details the migration has to respect, both discovered the hard way.
Wrangler's SQL splitter understands `BEGIN…END`, but its `isCompoundStatementEnd`
test is `/\sEND[;\s]$/` with **no `i` flag** — a lowercase `end;` breaks
splitting. And every semicolon inside a SQL string literal was removed
deliberately, so that any naive splitter which ever reads this file is safe.

The root/API `db:local` script stops executing only 0001 and instead applies the
ordered migration directory with `wrangler d1 migrations apply
patternlike-ops --local`. The D1 smoke loader uses the same order. Tests cover a
fresh database and a retained 0001 database; deleting local state is an explicit
developer reset, not the migration mechanism.

The production rollout is a separately authorized operation, in this order:

1. disable generation/reissue writers and prove no running daily-generation
   job;
2. verify the configured account/database id, record a [D1 Time Travel
   bookmark](https://developers.cloudflare.com/d1/reference/time-travel/), and
   create a restricted full SQL export outside the repository with a recorded
   checksum;
3. capture pre-migration table counts, migration ledger, table definitions,
   indexes, and foreign keys;
4. on a production clone, prove the transition from the existing schema applied
   by `d1 execute` (including the initially absent migration ledger); then run
   [`npx wrangler d1 migrations apply patternlike-ops --env production
   --remote`](https://developers.cloudflare.com/d1/reference/migrations/) from
   `apps/api`;
5. prove the ledger contains 0002 with no migration pending, expected columns,
   indexes, and foreign keys exist, row counts are unchanged,
   `PRAGMA foreign_key_check` returns zero rows, and `PRAGMA quick_check` is
   `ok`;
6. deploy the Worker without a cron trigger and smoke-test initial generation,
   duplicate delivery, and explicit reissue; and
7. enable the scheduled trigger only after Phase 7's manual proof.

The bookmark/export is the rollback point. A migration error, unexpected row,
or failed schema/FK/integrity proof stops deployment. New schema lands before
new Worker code because the current production stubs do not write these tables;
cron is last.

**Done when:**

- replaying one enqueue produces one pending reading and one job without
  changing the frozen command;
- crashes immediately before and after Queue send are recovered by the durable
  outbox and may duplicate delivery but never the reservation or publication;
- a timezone/release/chart/cycle change or midnight rollover after enqueue does
  not change the claimed job's inputs or `assembly_id`;
- a non-UTC user whose birthplace and scheduling zones differ gets the correct
  target date across a DST transition;
- two concurrent reissues against one expected live reading create one pending
  successor, while the predecessor remains published;
- a failed/cancelled initial or reissue command can be replaced exactly once by
  an expected-job CAS without changing the artifact revision, while a stale job
  or stale predecessor cannot replace it;
- a stale claim cannot publish or mark its job succeeded, and injected failure
  at every completion statement leaves no partial supersession, publication,
  evidence, audit, or succeeded job;
- success leaves exactly one published row, the expected predecessor
  superseded, complete encrypted evidence, and the same job succeeded;
- clear-column inspection of the reading tables cannot recover paragraph text,
  fragment/content refs, assembly ids, per-paragraph hashes, context/source
  refs, ranking reasons, model linkage, or selected-cycle/validation detail
  after DEK destruction — **which is not the same as the prose being
  unrecoverable.** `cycle_instances`, `chart_snapshots.snapshot_json`, and the
  R2 release bundle all survive DEK destruction in clear, and §3's assembler is
  a pure function of exactly those inputs. Anyone holding the surviving rows can
  recompute the reading. Destroying the DEK removes the *stored* artifact and
  its provenance; it does not remove the ability to derive the artifact again,
  and the acceptance criterion must not be read as claiming otherwise. Closing
  that gap means shredding or minimizing the calculated inputs too, which is a
  separate decision this milestone does not make;
- DEK rotation re-encrypts `jobs.payload_enc`, `daily_readings.reading_enc`, and
  every `reading_sources.evidence_enc` through their user-ownership paths, and
  all remain decryptable under the new key;
- cross-user active-job links, cycle-pass inserts, and reading-evidence inserts
  fail their composite foreign keys;
- the forward migration passes fresh-DB and populated-0001 tests, and the
  production evidence captures backup, ledger, schema, index, row-count,
  quick-check, and foreign-key proof; and
- a charted user with zero eligible daily facts gets the locale's universally
  eligible fallback reading.

---

## 6. Part 5 — Retrieval

`GET /v1/readings/today` — load the current confirmed scheduling zone and
resolve its local date. A `default_unconfirmed` zone returns the actionable
standard error `timezone_confirmation_required`; the route never substitutes
`birth_profiles.timezone` or accepts a client-supplied date. Otherwise select
`WHERE user_id = ? AND local_date = ? AND status = 'published'` (the partial
unique index from D1 guarantees at most one), decrypt, and return the M3
`DailyReadingResponse`.

Two distinct 404s, because the client's next action differs:
`chart_not_found` (finish onboarding) versus `reading_not_generated` (check
back). Both inside the standard envelope; the OpenAPI 404 already covers the
status.

`GET /v1/readings/{id}/evidence` lands in the same phase. It joins
`reading_sources` through an owner-filtered reading, decrypts every
`evidence_enc`, reconstructs the M3 evidence graph, and is the "Why this?"
element the Today screen is specified to require — shipping Today without it
ships the surface without the property that distinguishes this product.

Both routes come off `stubs.ts` (`:32-37`), and `run_worker_first` in
`wrangler.toml` already covers `/v1/*`, so no asset-routing change is needed.

---

## 7. Order of work

| Phase | Lands | Unblocks | State |
| --- | --- | --- | --- |
| 0 | D1–D5; complete M3 schemas, both OpenAPI documents, JCS vectors, locale fixtures, a package validator, and zero-diff proof for `contracts/m0/` | everything | **done** |
| 1 | `packages/reading-engine` + fixture evaluation | release activation of fixture-bearing bundles | **done** |
| 2 | Forward `0002_m3_daily_reading_pipeline.sql`; reservation/reissue/replacement guards; ownership FKs; authenticated timezone writer/history; encrypted commands/evidence; `ENCRYPTED_COLUMNS`; local upgrade/runbook proof | 3, 4 | **done** |
| 3 | Calc `POST /v1/cycles` + oriented complete-encounter scan/refine + shifted-window goldens | 4, `/v1/timing` | **done** (endpoint only; versioned cycle persistence moved to 4, where the writer lives) |
| 4 | Immutable enqueue, durable outbox dispatch, explicit reissue/command replacement, bounded scheduler auto-replacement, claim leases, cycle persistence, and atomic `GenerateDailyReading` completion | 5 | **done** |
| 5 | `GET /v1/readings/today` and decrypted `GET /v1/readings/{id}/evidence` | 6 | **done** (`apps/api/src/db/readings.ts`, `apps/api/src/routes/readings.ts`; also answers `409 locale_confirmation_required`, recorded in the m3 manifest's `amendments`) |
| 6 | Real Today page (`apps/web/src/components/TodayView.tsx`) | 7 | **done** (paragraph rendering, the four non-200 affordances, `PreferenceConfirm` for both 409s, and `WhyThisDrawer`) |
| 7 | DEV-01 foreground/system-change sync; `[triggers]` + `scheduled` enqueue; production cron enablement after manual proof | — | next |

Phase 4 also carries the Worker-side client. `POST /v1/cycles` runs on the calc
service and nothing in `apps/api` calls it yet; an `invokeCycles` beside
`invokeCalc`, and its counterpart in `apps/api/test/mock-calc-service.ts`,
belong with the writer that needs them rather than with the endpoint.

Two things Phase 4 must settle before it can persist a pass: the `cyp_`
cycle-pass id has no preimage document, no golden vector, and no wire field —
only the prose "derived from the parent cycle identity plus `pass_index`" — yet
`generation-command.schema.json` requires `pass_ids`. `cyclePin.cycle_hash` is
likewise specified only as a hash "of the normalized cycle row as scanned", with
no stated normalization. Both need pinning the way `cyc_` was pinned, or two
implementations will mint different ids for the same pass.

Phase 0 was documents and schemas — no runtime code, and the phase that unstuck
the other six. Phase 1 had value on its own even if nothing after it ships this
quarter: it turns `accepted_pending_tests` from a permanent state into a
transient one.

Phase 0 was accepted only when:

- exact JCS bytes, full digests, and rendered ids match golden vectors; a retry
  with the same persisted command reproduces its id; changing effective
  accuracy or an uncertainty constraint changes it; and reordering an equivalent
  constraint set does not;
- both OpenAPI documents resolve every external `$ref` and validate;
- valid three-pass cycle responses round-trip, while unordered passes,
  noncontiguous indices, count mismatch, and first-exact mismatch fail;
- timing with facts plus its approved template validates, while facts-only
  timing fails;
- every supported locale has exactly one universal fallback; missing,
  duplicate, locale-mismatched, and fact-gated fallbacks fail, and a zero-fact
  fixture for every locale evaluates to `fallback`; and
- `git diff --exit-code <approved-base> -- contracts/m0` passes.

Phase 2 lands migration code and rehearsable proof tooling; applying 0002 to the
remote database, deploying the Worker, and enabling cron remain separately
authorized operational gates in the order specified in §5.

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

- **§1 crypto-shredding vs D1 Time Travel** — M3 encrypts both prose and every
  reconstructive evidence field, but wrapped DEK and ciphertext still share a
  database. That pre-existing recovery-window question remains. M3 also *widens*
  the gap rather than closing it: `cycle_instances`, `snapshot_json`, and the R2
  bundle stay in clear, and the pure assembler turns them back into the prose.
  Encrypting the reading is therefore a control over the stored artifact, not
  over the derivable content, and the M3 manifest's `unresolved_escalations`
  scopes the claim that way.
- **§5 cascading revocation** — there is still no `derived_features` table and
  no `invalidated_at`. D1's revision model gives revocation somewhere to *land*
  for readings specifically (a `consent_revoked` reissue), which is narrower
  than the general problem.
- **§8 legacy `canonicalJson` has no named standard** — D3 resolves
  canonicalization only for the new `patternlike.assembly-id.v1` profile by
  pinning JCS. Existing M0 release/object/signature hashes remain byte-frozen on
  the repository's legacy `canonicalJson` behavior; M3 must not silently
  reinterpret them as JCS. Naming/versioning that legacy profile is still open.
- **§11 `snapshot_json` precision** — unresolved, and the cycle scan inherits
  whatever it settles on.
- **§9 `techniques_enabled` overstates the engine** — phase 3 implemented
  `transits`, closing one of the five, and `POST /v1/cycles` rejects any other
  value rather than accepting it silently. `stations_ingresses` and
  `lunations_eclipses` stay declared-but-absent.
- **Timezone changes can strand a day** — a user who changes zone can land on a
  "today" that was never reserved. §5's reservation model does not cover it, and
  `users.next_due_at` is still unused even though it is the natural scheduling
  column. Both belong to phase 7, along with the sub-hourly cron that
  `:45`-offset zones need.
