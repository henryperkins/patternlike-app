# Daily reading: where context and quality are actually constrained

Date: 2026-09-13
Source inspected: `00f361e21f5df3d9be4119136c45931559bf643f` (`claude/improve-reading-context-quality-mqyn31`, branched from `main`).

## What this is, and what it is not

This is a **source reading** of the constrained-model Daily path, looking for the places where the product's ceiling on reading quality is set by the shape of its inputs rather than by the model. Every claim below is a statement about code at the commit above. Nothing here is a production observation, a measurement of live readings, or an editorial judgement of any prose the product has actually published.

Two existing documents cover adjacent ground and are deliberately not repeated here:

- [Interpretation-quality baseline](../superpowers/specs/2026-09-08-interpretation-quality-baseline-design.md) assesses **Pattern** — the 60-fragment corpus, the 40 admitted ontology records, and chapter prose. It does not examine the Daily packet.
- [Reading assurance corrections](../superpowers/specs/2026-09-06-reading-assurance-design.md) hardened Daily **correctness** — the bounded factual grammar, role preservation, and claim support. It made wrong readings fail closed. It did not widen what a correct reading can know.

The gap between them is this document's subject: a Daily reading can now be reliably *not wrong* while still being thin, and most of the reasons are upstream of the model.

Quantities marked "modelled" are arithmetic over the repository's own constant tables under a uniform-longitude assumption, not measurements of real charts. The script is in [`artifacts/2026-09-13-daily-packet-size/`](artifacts/2026-09-13-daily-packet-size/README.md).

## How a Daily reading is built today

`enqueue` freezes a `GenerateDailyReadingCommandV2`; `execute` reconstructs it and calls the provider once. Between them, `prepareConstrainedReadingInput()` ([`packages/reading-engine/src/constrained-input.ts:765`](../../packages/reading-engine/src/constrained-input.ts)) is the single place that decides what the model may see. It:

1. projects cycles, daily-sky facts, and natal facts into one `ConstrainedFact[]`;
2. drops any fact whose consent category is not granted, and any fact the chart's uncertainty suppresses;
3. sorts the survivors by `(lane_rank, fact_id)`;
4. appends up to 7 prior-reading excerpts and as much eligible context as the 96 KiB packet budget allows;
5. returns the request plus the canonical bytes that both enqueue and execute hash.

`buildResponsesRequest()` ([`apps/api/src/services/reading-prompt.ts:133`](../../apps/api/src/services/reading-prompt.ts)) sends that packet as a single JSON string under a fixed system policy, with no tools, no browsing, and `store: false`. `validateReadingCandidate()` then accepts or rejects the result against fifteen mechanical checks.

The architecture is sound. The findings below are about what flows through it.

---

## Findings: context

### C1 — The packet is unranked, and the ranker that exists is not called

`facts` is sorted by `lane_rank`, then by `fact_id` ([`constrained-input.ts:830`](../../packages/reading-engine/src/constrained-input.ts)). `fact_id` is a truncated SHA-256 of the fact's own content, so ordering **within** a lane is arbitrary with respect to meaning.

Modelled packet size for an exact-birth-time chart, from `ORB_DEFAULTS` in [`apps/calc-stub/src/engine.ts:95`](../../apps/calc-stub/src/engine.ts) and `TRANSIT_ORBS` in [`apps/calc-stub/src/cycle-policy.ts:244`](../../apps/calc-stub/src/cycle-policy.ts) ([reproducible arithmetic](artifacts/2026-09-13-daily-packet-size/README.md)):

| Lane | Fact classes | Modelled count |
| --- | --- | --- |
| 1 | `cycle_instance` | ~21 |
| 2 | `house_placement`, `transit_natal_contact` | ~10 + occasional |
| 3 | `anchor_position`, `lunar_phase`, ingress, collective aspect | ~11 + occasional |
| 4 | `natal_position`, `natal_aspect` | 13 + ~15 |
| | **total** | **~69** |

The composition allows one lead, at most four paragraphs, and one reflection — roughly six prose units. So the model chooses about six facts from roughly sixty-nine, with lane rank as the only ordering signal and ~28 lane-4 facts ordered by hash prefix.

Meanwhile `packages/reading-engine/src/ranking.ts` implements DER-02: ten named factors, each recorded with its weight, total tie-breaks, and an explicit refusal to admit an engagement signal. It is called by `assemble.ts` (the retired deterministic V1 path) and by `time-travel.ts`. **It is not called by the V5 path.** The product has a reviewed, auditable selection policy and does not apply it where readings are now generated.

### C2 — No measured orb reaches the model for any active transit

`projectCycleFact` writes `attributes.degrees = [cycle.orb_deg]` and labels it `configured orb limit N°` ([`constrained-input.ts:250`](../../packages/reading-engine/src/constrained-input.ts)). That value is the **envelope width** for that body class and aspect, not today's angular separation, and the system policy correctly forbids reading it as one: *"Cycle `degrees` describe the configured envelope limit, not a measured angular separation."*

`transit_natal_contact` facts carry no orb either, and exist only when a contact's exact root falls **inside the local day** ([`packages/shared/src/daily-sky-types.ts:245`](../../packages/shared/src/daily-sky-types.ts)) — which is rare.

So on an ordinary day the model cannot distinguish a Saturn square that is 0.2° from exact from one that is 4.5° away and drifting out. The only proxies are `phase`, whose `peak` band is ±36 hours around any pass ([`phase.ts:32`](../../packages/reading-engine/src/phase.ts)), and the exact-pass date in the label. The single most reader-meaningful timing quantity in transit astrology is calculated upstream and then not carried.

### C3 — Pattern is absent from Daily generation

`AI_CONSENT_DATA_CATEGORIES` has seven members and none of them is Pattern ([`packages/shared/src/m5-reading-types.ts:75`](../../packages/shared/src/m5-reading-types.ts)). Grepping the V5 command builder and executor for Pattern returns nothing.

`reader_relationship_supports` does connect the two surfaces — but [`reader-relationship-support.ts`](../../apps/api/src/services/reader-relationship-support.ts) runs at **publication time**, matching the finished Daily paragraph's cited features against Pattern chapters after the prose is written. It is a navigation affordance layered over two independently authored texts.

The consequence is that the product can tell a reader "this paragraph connects to your Pattern chapter on Saturn" while the two describe the same natal placement in unrelated language. The [alignment roadmap](2026-09-07-mind-map-alignment-roadmap.md) already names this ("the missing work may be semantic relationships as much as navigation"); this is the concrete mechanism.

### C4 — Prior readings carry prose but not their citations

[`context-compiler.ts:239`](../../apps/api/src/services/context-compiler.ts) decrypts up to seven prior readings and keeps `headline`, the `primary_theme` paragraph, and the reflection. The same decrypted envelope also holds `evidence_header.paragraphs[].fact_refs[].fact_id`, and that is discarded.

`nat_` ids are derived from chart contract plus fact content, and `cyc_` ids commit to the physical encounter, so **both are stable across days**. The exact signal "you built yesterday's reading on this cycle and this natal aspect" is already durable, already decrypted in the same loop, and thrown away. Repetition control is currently the model eyeballing three prose fragments per prior day — and it never sees which facts the other two-to-four paragraphs rested on.

### C5 — The context lanes that reach a reading are narrow, and the richest is walled off

Eligibility is the intersection of the signal's allowed uses, the grant's allowed uses, and `M5_SUPPORTED_USES`:

| Source | Granted uses | Reaches a reading |
| --- | --- | --- |
| USR-06 check-in | `theme_ranking`, `tone`, `reflection_prompt`, `notification_timing` | first three |
| USR-05 topic exclusions | `theme_filtering`, `notification_timing` | `theme_filtering` |
| USR-12 categorical feedback | `content_quality`, `repetition_control`, `theme_ranking` | last two |
| USR-09 life events | `time_travel` | **none** |

`USR09_ALLOWED_USES = ["time_travel"]` ([`apps/api/src/db/context-sources.ts:16`](../../apps/api/src/db/context-sources.ts)), and `time_travel` is not in `M5_SUPPORTED_USES`. The reader's dated life events — the most specific personal material the product stores, already encrypted under the user DEK, already surfaced in `LifeEventTimeline` — cannot shape a reading under any current grant.

That is a defensible consent decision. It should be a *decided* one rather than an inherited one: USR-09 was scoped for Time Travel and nothing has revisited whether a reader who wants their events to inform a reading has a way to say so.

### C6 — A check-in cannot affect the day it describes

`readingDueAt` computes `dueAt = dayStartAt − (30 + 15 × bucket) minutes` ([`reading-schedule.ts:70`](../../apps/api/src/services/reading-schedule.ts)). Day D's reading is therefore frozen 30–75 minutes **before** local midnight on D−1.

The UI states this plainly — *"this may be selected for a later reading… Today's chapter stays as it is"* ([`DailyCheckInCard.tsx:240`](../../apps/web/src/components/DailyCheckInCard.tsx)). The honesty is not in question; the product shape is. The reader is asked how they are, and the answer applies to tomorrow.

`RequestContext.observed_on` is a calendar date, not an instant, so the model also cannot tell a two-hour-old check-in from a twenty-two-hour-old one.

### C7 — `domain_preference` is wired end to end and permanently null

The field exists in `ReadingGenerationRequest`, in `DailyReadingV5`, and in the product projection. Both construction sites hardcode `null` ([`generation-command-v2.ts:708,772`](../../apps/api/src/services/generation-command-v2.ts)). `READING_SYSTEM_POLICY` never mentions it. The ranker's `domain_match` factor — the one place a user preference enters DER-02 — is unreachable on this path for two independent reasons.

---

## Findings: quality

### Q1 — A rejected candidate is never told why

[`generate-daily-reading-v5.ts:722`](../../apps/api/src/services/generate-daily-reading-v5.ts) validates once. On failure it logs a precise `code` plus `detail_code` and fails the job. `generation-failures.ts` may then replace the command (bounded at `MAX_COMMAND_GENERATION = 3`), but the replacement rebuilds the **same packet** and sends the **same prompt**. The request carries no temperature and `store: false`.

So a systematic failure mode — one banned construction the model reliably reaches for on a particular chart shape — consumes every retry and ends with the reader having no reading. The validator already computes exactly the constraint that would fix it, and that string never crosses back to the model.

### Q2 — The quality screen exists and does not run in production

`qualitativeFindings()` ([`reading-evaluation.ts:156`](../../apps/api/src/services/reading-evaluation.ts)) checks six things worth knowing: the reflection is a question, the lead is not thin, **supplied context was actually used**, the headline or lead does not repeat a recent reading, no exclamation marks, no hype vocabulary.

It runs only over the frozen offline corpus. Nothing observes these on published prose. `context_supplied_but_unused` is precisely "the reader gave us context and the reading ignored it" — the failure mode C5 and C6 make most likely — and in production it is invisible.

These are content-free counters by construction. Emitting them as aggregate observations alongside `daily_publication_receipts` would require no new prose exposure.

### Q3 — Reader feedback can only subtract

The categorical vocabulary is `repetitive | not_relevant_today | unclear` ([`contracts/reading-feedback-v1/reading-feedback.schema.json`](../../contracts/reading-feedback-v1/reading-feedback.schema.json)). Every category is negative, and the two that reach a packet do so as suppression (`repetition_control`) or de-emphasis (`theme_ranking`).

`ranking.ts` deliberately excludes resonance to avoid hidden engagement-only ranking, and that reasoning is sound. It is a different decision from declining an explicit, consented, reader-declared "this one landed" — which is what would let the product learn a reader's register rather than only their irritations. Worth separating the two questions before treating the first answer as settling the second.

### Q4 — Nothing exercises a realistic packet

The evaluation corpus base carries **1 cycle, 4 daily-sky facts, 1 natal fact** across six profiles and 31 cases (`apps/api/test/fixtures/reading-evaluation-corpus.json`). The contract fixtures are comparably small; the largest `aspects` array anywhere under `contracts/` has five entries.

The pressure that dominates production — choose six units from ~69 unranked facts, without repeating the last seven days — is not exercised by the vitest lanes, the offline corpus, or the promptfoo daily lane. Every test runs against a packet small enough that selection is trivial.

### Q5 — A ranker defect that does reach a live surface

`exactness()` hardcodes `const configured = 3; // configured orb ceiling for launch transit policy` ([`ranking.ts:101`](../../packages/reading-engine/src/ranking.ts)). The actual table ranges 1.5°–6° by body class and aspect. Exactness therefore saturates at zero for any contact wider than 3° — every luminary conjunction and opposition at 6°, every personal-body conjunction at 5° — and over-credits outer-body sextiles whose real orb is 1.5°.

V5 does not call it. [`time-travel.ts:147`](../../apps/api/src/services/time-travel.ts) does, and Time Travel is a live reader surface, so this is a present-tense ordering defect there regardless of what happens to Daily.

---

## Candidate changes

Ordered by value against cost and blast radius. None of these is proposed for implementation here; each needs its own scoped decision.

### Tier 1 — contained, no new consent

**1. Rank facts within lane before they enter the packet (C1, Q5).**
Fix `exactness()` to read the real orb for the fact's body class and aspect, then order each lane by `scoreFact`. The engine stays pure — `computePhase` already runs on the same midpoint — so enqueue and execute still agree and `generation_input_id` stays reproducible.

Cost: `SELECTION_POLICY_VERSION` bump, which fails frozen in-flight commands closed through the designed `policy_unsupported` path. The frozen m5 request schema states the `(lane_rank, fact_id)` ordering in a `description` only, so the change is schema-valid but contradicts documented semantics and needs an `amendments` entry, not a silent edit. Fixing `exactness()` also changes Time Travel ordering — that is a correction, and it should be stated as one.

This is the highest-value item on the list: it is the difference between the model choosing among sixty-nine equals and choosing from a ranked shortlist the product can defend.

**2. Observe `qualitativeFindings` on published readings (Q2).**
Content-free counters only, alongside the existing publication receipt. No contract change, no prose exposure, no new consent. It answers "is supplied context actually reaching the prose", which nothing currently answers.

**3. Build one realistic packet fixture (Q4).**
A ~69-fact exact-time profile plus its unknown-time counterpart, added to the evaluation corpus. Cheap, and it is the precondition for believing any later measurement of items 1, 4, or 6.

### Tier 2 — moderate, contract or calc work

**4. Carry today's measured separation on each active cycle (C2).**
The calc service already solves the geometry. Adding a sampled separation at the day anchor is a cycle-contract addition and a policy-version bump, with the strict rule that it be labelled as a measurement distinct from the envelope limit, and a corresponding bounded grammar form so the validator can check it.

**5. Feed the validator's reason into one bounded repair attempt (Q1).**
One extra provider call per job, carrying the failed `code`/`detail_code` as an added constraint, under the existing attempt ceilings. The validator must still be the only authority on what publishes.

**6. Close the check-in latency (C6).**
Either move generation later in the local day, or admit a same-day regeneration when a check-in lands before the reader has opened the reading. Both interact with pre-generation, revision chains, and the `MAX_COMMAND_GENERATION` bound, so this is a design question, not a config change.

**7. Carry prior readings' cited fact ids (C4).**
The data is loaded and discarded. The obstacle is purely contractual: `priorReadingExcerpt` is `additionalProperties: false` in a frozen package. The repo-idiomatic route is a narrow-successor overlay, as `geocoder-v2` is to m0 — not an edit to frozen m5.

### Tier 3 — product decisions before engineering

**8. Pattern-aware Daily (C3).** Would need a new `AI_CONSENT_DATA_CATEGORIES` member, a new consent policy version, and fresh grants; a reader who agreed to seven categories has not agreed to an eighth. The provider-boundary question is real but tractable — Pattern prose the reader has already been shown is not the same disclosure class as a raw chart identifier.

**9. A positive reader signal (Q3).** New feedback category, new grant, and an explicit written statement of how it may and may not act, so it does not become the engagement ranking `ranking.ts` was built to exclude.

**10. Decide USR-09 (C5).** Either widen life events into M5-eligible uses under a new consent version, or write down that readings deliberately never see them. The current state is neither.

**11. Feed or delete `domain_preference` (C7).** A field that is structurally present, contractually carried, and permanently null is worse than either alternative.

## What would count as evidence

Per [roadmap §6.3](2026-09-07-mind-map-alignment-roadmap.md#63-separate-quality-questions-and-evidence), keep these apart:

| Change | Evidence that it helped | Evidence it must not be confused with |
| --- | --- | --- |
| Fact ranking (1) | Blind paired comparison on the same chart and date, baseline vs ranked, scored on chart specificity | Hard-gate pass rate — both arms should pass |
| Context observation (2) | Rate of `context_supplied_but_unused` on published readings | Reader satisfaction |
| Measured orb (4) | Whether timing sentences distinguish near-exact from wide contacts | Calculation correctness, which goldens already cover |
| Repair attempt (5) | Reduction in terminal `publisher_output_invalid` per reader-day | Any claim about prose being better |
| Pattern-aware Daily (8) | Whether the two surfaces describe one placement consistently, adjudicated by a named reviewer | Relationship-support coverage, which is navigation |

Freeze a baseline before assessing any of these, vary one layer at a time, and record every changed hash. A reading that passes fifteen mechanical checks has been shown not to be wrong; it has not been shown to be worth reading.

## Not verified

- No production data was queried. No live reading, packet, or failure rate was observed.
- Fact counts are modelled arithmetic over the repository's orb tables under uniform longitudes. Real charts cluster Mercury and Venus near the Sun, which raises conjunction counts; the true figure is probably higher than 69, not lower.
- No test was run and no code was changed for this document.
- No editorial judgement of published prose is offered or implied.
