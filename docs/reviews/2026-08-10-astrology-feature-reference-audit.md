# Audit against the astrology product feature reference (2026-08-10)

The reference note is a generic checklist for a **deterministic chart engine +
LLM presentation** product. This repository is audited against it row by row
below, at the tree as of `1d5ea80`.

Statuses are the note's own: **Done** (shipped and matches the "must"),
**Partial** (related capability exists but is incomplete or violates a
non-negotiable), **Planned** (roadmap only), **N/A** (out of scope for this
product). Every claim was confirmed against a file, and the file is cited.

---

## The one structural divergence: there is no LLM

The reference's architecture is three layers — Calculation → Interpretation
retrieval → **LLM synthesis** — and most of its checklist exists to constrain
that third layer. This product does not have it. No model runs anywhere in the
request path; a repository-wide search for a model provider, an inference call,
or an embedding returns nothing.

`packages/reading-engine/src/assemble.ts:1` states the contract explicitly:

> Purity contract: no fetch, no D1, no `Date.now()`, no crypto. […] The renderer
> writes **NO** original prose. Every paragraph is a reviewed string or a
> reviewed template from the signed bundle, selected and ordered, never joined
> with connective sentences authored here.

Readings are assembled by ranking calculated facts
(`packages/reading-engine/src/ranking.ts`), selecting reviewed editorial objects
from a signed release bundle, and emitting them in a fixed role order. The
output is byte-reproducible: identical inputs yield an identical `assembly_id`
(`assemble.test.ts:182`).

This changes how the reference reads, in three ways:

1. **The non-negotiables are met by a stronger mechanism than the one
   prescribed.** "LLM must not invent placements, aspects, houses, or timing" is
   not enforced by prompt discipline and grounding evals here — it is
   unreachable, because nothing in the pipeline can produce a sentence that was
   not reviewed and version-pinned before it shipped. The tests assert the
   property directly: `assemble.test.ts:75` ("the renderer writes no original
   prose") and `:115` ("every paragraph resolves to an approved content
   version").
2. **A block of the checklist is genuinely N/A**, not skipped: prompt fact caps,
   chat grounding windows, tone/consistency evals over generated text, and
   `mustContain`/`mustNotContain` JSONL suites all presuppose a generator.
3. **Some capability the reference expects from an LLM is simply absent** and is
   not on the roadmap in that form — the conversational reader most of all.
   Determinism was bought with flexibility, and where the reference would reach
   for a model (style controls, reading modes, ask-a-question), this product has
   nothing and no stub.

The rest of this audit reads the checklist through that lens.

---

## Product surfaces

| Feature | Status | Evidence |
|---|---|---|
| Daily horoscope (sun sign, public, low-friction) | **N/A** | Deliberately rejected. `apps/web/PRODUCT.md:46` commits the voice to avoiding "generic sign-based filler"; there is no unauthenticated content surface — every product path sits behind `authenticate` (`apps/api/src/index.ts:36`). |
| Natal-chart reader | **Done** | `POST /v1/birth-profiles` → `apps/calc-stub/src/engine.ts` → `GET /v1/chart` (`apps/api/src/routes/chart.ts:11`); rendered by `ChartView.tsx` and `ChartWheel.tsx`. |
| Transit reader | **Partial** | The *engine* is done and is the strongest component in the repo (`apps/calc-stub/src/cycles.ts` — oriented-branch root-finding, lifted longitude, multi-pass retrograde encounters), and it feeds the daily reading. But the user-facing surface is not: `TimingView.tsx` is an 18-line placeholder, `GET /v1/timing` returns 501 (`routes/stubs.ts:42`), and reading against an arbitrary selected date (Time Travel) is 501/M4 (`stubs.ts:43`). |
| Conversational reader | **Absent** | No chat surface, no endpoint, no stub. Unlike Timing and Time Travel, it is not deferred to a milestone — it is not in the product. |

---

## Architecture checklist

| Layer | Status | Evidence |
|---|---|---|
| Calculation — planets, houses, aspects, transits, exact degrees; **no prose** | **Done** | `engine.ts` and `cycles.ts` return numbers and identifiers only. The AGPL boundary keeps this a separate service reachable over plain HTTP. |
| Interpretation — retrieve curated meanings; **do not recalculate** | **Done** | Retrieval is object lookup from a signed bundle by symbolic key (`assemble.ts:359-420`). The assembler cannot recalculate: it is pure and takes facts as input. |
| LLM — synthesize cited facts; **do not fabricate** | **N/A** | No model in the path. See above. |

| Platform piece | Status | Evidence |
|---|---|---|
| Web / WordPress UI | **Partial** | React 19 PWA is real (`apps/web/src/components/`). The WordPress authoring half that *produces* the bundles is unbuilt — README M2 open item. |
| API / Worker — auth, rate limits, orchestration, validation | **Partial** | Auth, orchestration, and validation are thorough. **Rate limiting does not exist** — no limiter, quota, or throttle anywhere in `apps/api`. See gap 3. |
| Geocode + timezone | **Partial** | Historical timezone resolution is excellent and correct (`packages/shared/src/timezone.ts`, `POST /v1/timezone-lookup`): coordinates decide the zone, the browser's hint is ignored, and pre-1970 local mean time resolves without rounding. **Place-name geocoding is missing** — the user types latitude and longitude by hand. See gap 1. |
| Chart calculation service | **Done** | Swiss Ephemeris 2.10.03 via `sweph@2.10.3-7`, data files pinned by commit + SHA-256 in `ephemeris.lock.json`. |
| Chart store — versioned, encrypted | **Done** | `chart_snapshots` with `status active/superseded` and `profile_version`; AES-256-GCM envelope encryption with per-user DEKs and AAD binding `(subject, table.column, recordId, key_version)` (`apps/api/src/crypto.ts`). |
| Interpretation retrieval — symbolic first, semantic second | **Partial** | Symbolic-first is done. There is no embedding or vector store, so the "semantic second" rank never happens. Given a cycle-centric corpus keyed by exact symbolic identity, this is a defensible omission rather than a hole. |
| LLM orchestration | **N/A** | — |

---

## Data contract

The reference asks for a versioned, model-independent `Chart` as the only
source of truth. `packages/shared/src/chart-types.ts` is that object, and this
is the best-matching section of the audit.

| Contract item | Status | Evidence |
|---|---|---|
| `schemaVersion` explicit | **Done** | `schema_version: "0.2.0"`, a literal type (`chart-types.ts:46`). |
| Subject birth inputs | **Done** | `birth.{accuracy, utc_instant, timezone, place_label, latitude, longitude}`. `accuracy` is the note's `timePrecision`, as a three-value enum rather than a boolean. |
| Settings snapshot — zodiac, house system, orbs, ephemeris version | **Done** | Split across the snapshot (`contract_id`, `contract_version`, `container_digest`, `tzdb_version`, `houses.system_used`, per-aspect `orb_policy_id`/`orb_policy_version`) and the frozen calculation contract it names (`contracts/m0/fixtures/valid/calculation-contract.launch.json`), which pins `zodiac: tropical`, `coordinates: geocentric`, `ecliptic: of_date`, `node: true`, the Placidus/Porphyry pair, and every orb default. |
| Placements — body, sign, degree, house, retrograde | **Done** | `LongitudePosition` (`chart-types.ts:23`) carries all five plus `latitude_deg`, `distance_au`, and `speed_longitude_deg_per_day`. |
| Aspects — from/to, type, orb, applying | **Done** | `NatalAspect` (`chart-types.ts:34`), with the orb policy stamped on each row so a policy bump is visible per aspect. |
| Transits (optional) | **Done** | Modelled richer than asked: a cycle carries an envelope (`start_at`/`end_at`), an `orb_deg`, an ordered `passes[]` with an `exact_at` per pass, a direction, and a phase — so a retrograde triple-crossing is three addressable events, not one. |
| Unknown birth time — omit/downgrade houses, ASC/MC; explicit notice | **Done** | The strongest invariant in the repo. Noon is a computation epoch only, never stored as the birth instant; `engine.ts` recomputes an *effective* accuracy and suppresses houses, angles, and time-sensitive Moon claims regardless of the label the caller sent. `UncertaintyReport.suppressed_features` records each suppression with a reason, and the reading surfaces it as an `uncertainty_notice` paragraph. Covered by `golden.test.ts:54`. |
| Engine metadata on response | **Done** | `GET /v1/engine` on the calc service; `container_digest` and `tzdb_version` ride every snapshot. |
| Reproducibility — persist UTC, TZ DB version, original local input | **Done** | `utc_instant` and `tzdb_version` on the snapshot; the original local input is retained encrypted in `birth_profiles.payload_enc`. |
| Normalize library output | **Done** | No `sweph` object reaches the wire; `engine.ts` maps into `ChartSnapshot`. |

One deliberate divergence: `GET /v1/chart` **nulls every birth field** in the
response (`routes/chart.ts:70-78`) even though the contract type carries them.
The birth instant and coordinates stay encrypted at rest and are never
re-served. That is stricter than the reference and is the right call.

---

## Calculation features

| Feature | Status | Evidence |
|---|---|---|
| Natal positions | **Done** | 11 bodies — Sun through Pluto plus true node — exceeding the Sun–Saturn minimum (`engine.ts:76`). |
| Houses | **Done** | Placidus primary, Porphyry fallback, `fallback_applied` reported. |
| Angles | **Done** | Ascendant and Midheaven, suppressed when time is unknown. |
| Aspects | **Done** | Five majors; orbs 8/4/6/6/8; applying/separating from speed. |
| Retrograde flags | **Done** | From `SEFLG_SPEED` longitude speed. |
| Transits | **Done** | `cycles.ts`, with exact pass times. |
| Chart wheel artifact | **Done** | `ChartWheel.tsx` renders SVG client-side from the contract. Note this is a component, not a server-produced artifact — there is no shareable image URL. |
| Synastry | **N/A** | Not in the spec; the product is explicitly single-subject self-reflection (`PRODUCT.md:11`). |
| Self-hosted Python path | **N/A** | Node was chosen instead. |
| Hosted astrology API path | **N/A** | Rejected — birth-data privacy is a product commitment. |
| JS/Node path | **Done** | `sweph` on Node, deployed to Fly. |
| Licensing gate | **Done** | Decision recorded as `DECIDED`/AGPL (`docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md`), `LICENSE`/`COPYRIGHT`/`NOTICE` intact, source offer published, `SE_LICENSE_MODE=pending` refuses to boot. Counsel review of AGPL network obligations and app-store strategy remains open before public launch — flagged in README, not resolved. |
| *(not in the note)* Natal patterns | **Partial** | `natal_patterns` is declared in `techniques_enabled` and `natal_pattern` is a valid `fact_type`, but `engine.ts:766` returns `patterns: []`. Declared, unimplemented. |

---

## Interpretation corpus & retrieval

| Feature | Status | Evidence |
|---|---|---|
| Curated KB, not fine-tuning | **Done** | Signed editorial bundles ingested at `POST /internal/content-releases`, verified through nine ordered checks, with dual-control review enforced (`dual_control_violation`). |
| Unit types — placement, placement_house, aspect, transit, theme, style | **Partial** | The bundle has `astrology_cycle`, `astrology_phase`, `astrology_modifier`, `astrology_prompt`, `astrology_safety_rule`, `timing_template`, and `fallback_copy`. **There is no placement or placement-in-house unit**, so no natal placement has interpretation text behind it. The corpus is cycle-centric: it can say what a transit means, not what your Venus in the 7th means. See gap 4. |
| Chunk metadata | **Done** | `id`, `content_version`, `locale`, `object_hash`, `status`, `eligibility`, `tags`, plus release version and bundle hash on every reference. |
| Symbolic-first retrieval | **Done** | Deterministic keys from cycle + phase; no similarity search anywhere. |
| Semantic second | **Absent** | No embeddings. Defensible given the above. |
| Applicability rules (e.g. skip house text when time unknown) | **Done** | `packages/reading-engine/src/eligibility.ts` partitions facts *before* ranking, so an ineligible theme is never a candidate. Covered by `assemble.test.ts:170` — "unknown birth time suppresses an angle theme rather than filtering it later". |

---

## LLM / reading features

Read this table as: *what the reference wants from the model layer, and what
this product does instead.*

| Feature | Status | Evidence |
|---|---|---|
| Structured assembly, not freeform | **Done** (stronger) | There is no freeform path to fall back to. |
| Fact selection caps | **Done** (much tighter) | Exactly one `primary_theme` and at most one `supporting_theme`, which must be distinct from the primary (`assemble.ts:359-420`). Not a cap on prompt size — a cap on what a reading is. |
| System rules — entertainment only, no med/legal/financial/emergency | **Partial** | The vocabulary is real and specific: `trigger_class` enumerates `fatalism`, `diagnosis`, `guaranteed_event`, `crisis_topic`, `third_party_claim`, `unsupported_placement`, `source_laundering`, `medical_legal_financial`. Ingestion enforces that every rule's fallback resolves (`content-release.ts:830`). But **no rule is evaluated at assembly time** — `action: reject_model_output` has no model output to reject. Enforcement is editorial review plus the no-original-prose invariant, which is sound; the runtime half of the vocabulary is currently inert. |
| No certainty / fear claims | **Done** by construction | Bounded language is an editorial property of reviewed copy, not a generation-time constraint. |
| Missing data behavior | **Done** | `uncertainty_notice` role, populated from the suppression report. |
| Typed reading output | **Partial** | `contracts/m3/reading-evidence.schema.json` is a close and in places better match: `chartObservations` with `sourceFactIds` → paragraphs with `facts[]` carrying `fact_type`, `orb_deg`, `phase`, `pass_index`, `chart_fingerprint`; `themes` with `interpretationIds` → `content[]` carrying `fragment_id`, `content_version`, `release_version`, `bundle_hash`; `reflectionPrompts` → the `reflection` role. **`disclaimer` has no counterpart** — no role, no field, no rendered element. See gap 5. |
| Provenance UI — "Why this reading?" | **Done** | `WhyThisDrawer.tsx` renders per-paragraph facts, content refs, evidence lane, and named ranking factors, in reading order. |
| Reading modes (overview, relationships, work, transits, ask) | **Absent** | One mode: the daily reading. `GET /v1/pattern` (the natal overview) is 501. |
| Chat grounding | **N/A** | No chat. |
| Style controls | **Absent** | No style or tone parameter exists in the contract or the corpus. |

---

## UX & data-rights features

| Feature | Status | Evidence |
|---|---|---|
| Birth form explains why time matters | **Done** | `Onboarding.tsx:236` ("Precision matters, but certainty is never assumed…"), `:336` ("houses and angles require coordinates and a real time"), plus a dedicated note when accuracy is `unknown`. |
| Place → lat/lon + historical timezone | **Partial** | Historical TZ resolution is done and unusually careful — boundary proximity, pre-1970 births, skipped and repeated local times, and open-water coordinates all come back qualified, graded onto `birth_profiles.geocode_confidence`. The place-name → coordinate half does not exist. See gap 1. |
| User-selectable tradition/settings saved with chart | **Absent** | One fixed policy: tropical, Placidus, launch orb set. The chart records which policy produced it, so adding alternatives later is a contract extension rather than a rewrite — but nothing is selectable today. |
| Chart wheel + factual summary **before** prose | **Done** | `ChartView` presents positions, aspects, and uncertainty as facts; interpretation lives on Today behind its own surface. This matches the product's stated principle "facts before meaning". |
| Edit birth data | **Partial** | The API supports it — profile versioning with supersede-in-one-transaction (`routes/birth.ts:369`, `:446`). **The UI has no path to it**: `App.tsx:208` renders `Onboarding` only when no chart exists, and no navigation item reaches it. A user who mistypes their birth time cannot correct it. See gap 6. |
| Export birth/chart data | **Partial** | `PrivacyView.tsx` ships a complete request-export flow with idempotency keys, focus management, and status handling — against `POST /v1/exports`, which returns 501 (`stubs.ts:51`). The UI is honest about it (it renders a "not implemented" state and shows the request id), but the capability does not exist. See gap 2. |
| Delete birth/chart data | **Partial** | Same shape: confirmation flow implemented, `DELETE /v1/account` returns 501 (`stubs.ts:54`). See gap 2. |
| Separate raw birth inputs from derived chart JSON | **Done** | `birth_profiles.payload_enc` holds the raw inputs; `chart_snapshots.snapshot_json` holds derived facts, with `birth_enc`/`snapshot_enc` alongside. Different rows, different AAD, different columns. |
| Auth + rate limiting + abuse controls | **Partial** | Auth is production-grade: Auth0 authorization-code + PKCE, a Worker-minted httpOnly `SameSite=Strict` session cookie, absolute 30-day expiry, revocation by row update, and a crypto subject decoupled from the public user id. **Rate limiting and abuse controls are entirely absent.** See gap 3. |
| Clear AI-assisted / entertainment labeling | **Partial** | "AI-assisted" is inapplicable and its absence is correct — labelling this output as AI-generated would be false. But no entertainment-or-reflection framing is surfaced to the user either. See gap 5. |

---

## Transparency & safety (anti-patterns to block)

| Must block | Status | How |
|---|---|---|
| Deterministic life predictions | **Done** by construction | Only reviewed copy can be published; there is no generator to produce an unreviewed prediction. |
| Medical/diagnosis claims | **Done** by construction | Same, with `diagnosis` and `medical_legal_financial` as named trigger classes in the editorial vocabulary. |
| Investment / buy-sell directives | **Done** by construction | Same. |
| Coercive relationship directives | **Done** by construction | Same. |
| Claims about another person's secret feelings | **Done** by construction | `third_party_claim` is a named trigger class; the product is single-subject and has no second chart. |
| Quiet invention of rising/houses without birth time | **Done**, enforced in code | Not merely blocked — structurally impossible. Suppression happens in the engine before assembly, and the reason is reported to the user. |

The caveat worth stating plainly: every "by construction" above rests on the
editorial review process being real, because the runtime has no independent
check on the content of an approved string. The mechanism that makes that
credible is dual control at ingestion (`dual_control_violation`) plus signature
verification against a pinned key — a compromised CMS cannot publish, and a
single author cannot self-approve. That is a strong guarantee about *process*,
not about *text*.

---

## Evaluation features

### Calculation tests

| Test | Status | Evidence |
|---|---|---|
| Golden fixtures | **Done** | `apps/calc-stub/src/golden.test.ts` — stable fingerprints, a known Sun position, outer planets and true node, and the unknown-time suppression case. Run standalone via `npm run calc:golden`. |
| Leap days, DST, ambiguous local times, TZ changes, date line | **Done** — the strongest test lane in the repo | `packages/shared/src/timezone.test.ts` covers the offset actually in force rather than today's, one-off historical rule changes, a wall time the clock ran through twice, a wall time the clock skipped, a zone that skipped an entire day, and pre-1970 local mean time. Leap-day handling is covered in `validation.test.ts:34` and `local-day.test.ts:113`. |
| Metamorphic: same UTC instant → same planets across TZ representations | **Partial** | `timezone-agreement.test.ts` checks the resolver against Luxon across zones and asserts agreement with the instant a chart is actually calculated from — which is adjacent to the property but not a statement of it. A direct metamorphic test (construct the same instant from several zone/offset representations, assert identical positions) would be cheap and is not present. |
| Config versioning | **Done** | Contract id and version, container digest, tzdb version, orb policy id and version, ephemeris data version — all stamped on outputs and hashed into cycle ids. |
| Cross-check vs JPL Horizons | **Absent** (note marks it optional) | No external cross-check. Golden fingerprints pin against regression, not against ground truth. |

### Generation tests

| Test | Status | Evidence |
|---|---|---|
| JSONL cases with mustContain / mustNotContain | **N/A** | No generated text to constrain. The structural equivalent — declared fixtures evaluated at ingestion — exists (`assemble.test.ts:337`, `:348`), and an unresolvable fixture id fails closed. |
| Grounding: every claimed placement present in input chart JSON | **Done** | `assemble.test.ts:115` asserts every paragraph resolves to an approved content version, and `:98` that a timing paragraph carries both its calculated facts and its signed template. |
| Coverage of dominant placements/transits | **Partial** | Ranking is deterministic and its factors are recorded, and the primary/supporting selection is tested — but there is no test asserting the dominant fact of a chart is the one that surfaced. |
| Consistency across repeated calls | **Done** (exceeds) | Not "consistent" — byte-identical. `assemble.test.ts:182` and the `assembly_id` recomputation at both enqueue and execute. |
| Tone: reflective, not alarmist | **N/A** at runtime | An editorial review property. |
| Safety: no treatment/investment/legal/coercive direction | **Partial** | Enforced editorially and at ingestion; no runtime assertion. |
| Unknown birth time → cannot determine rising/houses | **Done** | `golden.test.ts:54` and `assemble.test.ts:170`. |

---

## Practical MVP phasing

| Week | Status | Notes |
|---|---|---|
| 1 — birth form, geocode/TZ, calculator, normalized JSON, factual summary | **Done** except geocoding | Everything but place-name → coordinates. |
| 2 — corpus (12 signs, 10 bodies, 5 aspects, 12 houses), retrieval, natal overview reading | **Partial** | Retrieval is done; the corpus covers cycles and phases, not signs/houses/placements; the natal overview (`GET /v1/pattern`) is 501. |
| 3 — transits, provenance, saved profiles, export/delete, regression fixtures | **Partial** | Transits, provenance, saved profiles, and fixtures are done. Export/delete are 501. |
| 4 — chat, style controls, feedback, rate limits, editorial dashboard | **Absent** | Chat and style controls are not in the product; feedback is 501; rate limits do not exist; there is no editorial dashboard (the WordPress authoring half of M2 is unbuilt). |

The note's quality-lever order is *typed chart contract → retrieval taxonomy →
evaluation suite → model choice*. This repository has executed the first three
to an unusually high standard and skipped the fourth entirely. The result is
that the levers the note treats as foundational are the levers that are done,
and what remains is mostly product surface.

---

## Stack reference

| Use case | Decision |
|---|---|
| Production Western calc | Swiss Ephemeris via `sweph` — **chosen**, pinned to 2.10.03. |
| Higher-level charts + SVG | Kerykeion not used; the wheel is rendered in the client from the contract. |
| Browser/Worker-only MVP | Not taken — calculation is a separate service, which is also what keeps the AGPL boundary clean. |
| Astronomy-first (Skyfield/JPL) | Not taken. |
| Suggested deploy split | **Matches, with Node in place of Python**: React PWA + Worker orchestration + separate calc service + D1. No vector corpus, by design. |

---

## The six gaps that matter

Ordered by how much they block a real user, not by effort.

1. **Place-name geocoding does not exist.** A user must enter latitude and
   longitude by hand to get houses and angles. Every other part of the birth
   path — historical timezone resolution, confidence grading, uncertainty
   reporting — is built to a standard this one omission undercuts, because most
   people do not know their birth coordinates to four decimal places. Tracked as
   an open M1 item in the README.

2. **Export and delete are 501 behind a finished UI.** `PRODUCT.md:40` commits
   that "users must be able to understand active data sources and request export
   or deletion without hidden state or misleading success messages." The UI
   honours the second half — it does not fake success — but the capability is
   absent, and for a product holding encrypted birth data as its core asset,
   this is the gap with the clearest external obligation attached.

3. **No rate limiting or abuse controls anywhere.** The reference lists it as a
   Worker responsibility; the Worker has none. The exposure is concrete rather
   than theoretical: `POST /v1/birth-profiles` fans out to a paid always-on Fly
   service, and reading generation enqueues work. Idempotency keys bound
   accidental duplication, not deliberate volume.

4. **The corpus cannot say anything about a natal placement.** There is no
   `placement` or `placement_house` content type, so "Your Pattern" — the natal
   reading, which the reference treats as the MVP centre — has no text to draw
   on and returns 501. What ships today is the *daily* slice only. This is the
   largest distance between the reference's recommended MVP and the product.

5. **No disclaimer and no framing anywhere in the reading.** The typed output
   has roles for theme, timing, reflection, uncertainty, and safety fallback,
   but nothing for the standing "reflection, not advice" boundary, and no
   element renders one. The reference asks for this twice (typed output;
   labelling). "AI-assisted" labelling is correctly absent — there is no AI —
   but the entertainment/reflection framing is a genuine omission.

6. **Birth data cannot be edited from the UI.** The API supports versioning and
   supersede correctly; the client never calls it after the first chart exists.
   A mistyped birth time is permanent from the user's side.

Two of these — 1 and 2 — are already tracked as open items in the README. The
other four are not recorded anywhere in the repository's own status lists.

---

## What the audit found in the product's favour

Stated plainly, because a gap list read alone would misrepresent the tree:

- The **unknown-birth-time** handling is better than the reference asks for.
  The reference says "omit/downgrade houses, ASC/MC; show explicit 'birth time
  unknown'". This product recomputes an effective accuracy server-side and
  ignores the caller's label, suppresses time-sensitive Moon claims as well as
  houses and angles, records a reason per suppressed feature, and surfaces the
  result as its own paragraph role.
- The **provenance chain is end-to-end**. The reference asks for a "Why this
  reading?" view from fact and interpretation ids. Here every paragraph resolves
  to specific facts (with orb, phase, and which pass of a retrograde loop) and
  specific content versions (with release version and bundle hash), and the
  drawer renders it in reading order.
- **Reproducibility exceeds the brief.** Readings are not merely consistent;
  they are byte-identical under a recomputed `assembly_id`, and the generation
  pipeline is built so that a queue retry cannot produce different prose under
  the same identity.
- The **ranking function has nowhere to put an engagement signal** — a
  structural refusal rather than a policy, documented as such in
  `ranking.ts:1`.
