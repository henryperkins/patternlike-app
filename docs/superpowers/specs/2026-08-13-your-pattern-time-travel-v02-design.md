# Your Pattern and Time Travel v0.2 Design

**Date:** 2026-08-13

**Status:** Approved in conversation; awaiting committed-spec review

**Baseline:** `main` at `b9bcff6`, with unrelated uncommitted M6 privacy and
context work preserved in the working tree

**Scope:** Implement the full product-v0.2 requirements for the two selected
primary-navigation features: **Your Pattern** and **Time Travel**. Deliver
reviewed Pattern content through the existing signed Cloudflare content-release
ingestion system. WordPress authoring remains a separate feature and is not
introduced by this work.

The work targets a production-grade local candidate. Production D1 migration,
Worker deployment, editorial approval, signing, ingestion, release activation,
rollback execution, and live-account certification remain separate evidence
gates.

## Decision summary

The implementation has two product slices with shared contract and evidence
foundations:

1. **Your Pattern** derives versioned natal features from immutable chart facts,
   matches them against exact eligibility rules in the active signed editorial
   release, and presents only reviewed eligible chapters with their evidence,
   resources, tensions, and counter-expression.
2. **Time Travel** reconstructs the cycle state for a selected local date from
   stored natal facts. It reuses an exact persisted scan when available and
   otherwise invokes the existing calculation service on demand, persists an
   immutable scan receipt, compares the selected state with the present, and
   keeps authorized saved life events visibly separate from calculated
   reconstruction.

The selected architectural decisions are:

- reuse `POST /internal/content-releases`, its signature checks, immutable R2
  artifact, D1 release ledger, atomic active pointer, audit events, and rollback
  behavior;
- introduce an M4 `0.4.0` contract package instead of changing frozen M0
  contracts;
- retain support for signed M3 releases as valid Today-compatible rollback
  targets;
- calculate a missing Time Travel date synchronously through the existing cycle
  calculation boundary using normalized natal positions, never decrypted birth
  data;
- use the registry's dedicated `USR-09` Life-event timeline for saved Time
  Travel context rather than widening the current `USR-06` Daily check-in grant;
- keep all draft Pattern prose outside activatable bundles until distinct human
  author and approver identities have completed editorial review; and
- preserve the existing chart-facts experience while adding integrated Pattern
  chapters, rather than replacing the chart wheel or hiding calculation facts.

The launch editorial target is **24 candidate Pattern families**, within the
product specification's required 20–30 range. They are review candidates, not
reviewed launch content. Code and synthetic fixtures can prove the complete
delivery path, but the production content gate remains incomplete until humans
review, approve, sign, ingest, and activate a release.

## Version terminology

“v0.2” in this document means the product/platform specification in
`spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md`. It does
not mean that all new wire documents should carry M0's frozen
`schema_version: 0.2.0`.

The repository already uses milestone contract packages:

- M0 is frozen at `0.2.0`;
- M3 owns cycle, Timing, reading, and signed-release additions at `0.3.0`;
- M5 owns the current publisher contract at `0.5.0`; and
- the uncommitted privacy candidate introduces M6 documents at `0.6.0` while
  retaining referenced M0 documents unchanged.

Your Pattern and Time Travel are M4 product surfaces. Their new response,
life-event, match-rule, scan-receipt, and OpenAPI amendment documents therefore
live under `contracts/m4/` and carry `schema_version: 0.4.0`. Existing embedded
M0 and M3 documents retain their original versions.

## Existing foundations and current gaps

The implementation extends current systems rather than creating parallel ones:

- `chart_snapshots.snapshot_json` already holds normalized positions, aspects,
  houses, angles, chart patterns, and uncertainty without birth plaintext.
- `natal_features` already exists but has no production writer or completion
  receipt.
- `cycle_instances` and cycle-pass persistence already store normalized cycle
  results produced for daily readings.
- the cycle service accepts only normalized natal longitudes, accuracy,
  suppression flags, and a bounded selection window. It has no birth-data
  decryption path.
- `computePhase()` and the cycle identity policy already provide deterministic
  lifecycle and comparison primitives.
- signed editorial ingestion already validates structure, canonical hashes,
  object hashes, content graphs, distinct author/approver identities, and
  Ed25519 or ES256 signatures before writing immutable R2 bytes and D1 state.
- `loadReleaseBundle()` already re-hashes stored R2 bytes against the D1 record
  before exposing editorial content to trusted application code.
- `/v1/pattern` and `/v1/time-travel` still resolve through honest 501 stubs.
- the existing Your Pattern destination currently renders chart facts only, and
  the Time Travel destination is an API-first placeholder pinned to today.

The current working tree also contains an uncommitted M6 privacy/context
candidate. This design treats those edits as separately owned work. It depends
on the resulting account-state guard, export/deletion manifest, encrypted
context primitives, and context-source consent behavior, but it does not claim
that candidate is merged or certified. Before implementation edits an
overlapping file, it must re-read the live diff and preserve the M6 behavior.

## System overview

```text
Pattern candidates
      |
      v
human review manifest --> release builder --> external signer
                                             |
                                             v
                           POST /internal/content-releases
                                             |
                              +--------------+--------------+
                              |                             |
                        immutable R2                  D1 release ledger
                                                        + active pointer
                              |                             |
                              +--------------+--------------+
                                             |
active chart --> natal-feature writer --> exact matcher --> GET /v1/pattern

selected local date --> scan-receipt lookup --miss--> cycle calculation service
       |                        |                          |
       |                        +<-- atomic result/receipt-+
       |
       +--> selected/present comparison <-- authorized USR-09 life events
                                      |
                                      v
                            GET /v1/time-travel
```

WordPress is absent from both runtime paths. A later WordPress feature may
produce the same signed M4 bundle, but it cannot read chart, cycle, event,
journal, or user records.

## M4 contract package

`contracts/m4/` contains:

- a common M4 schema with `schemaVersion` pinned to `0.4.0`;
- an M4 signed content-release schema;
- a structured natal-feature and Pattern-match-rule schema;
- `pattern-response.schema.json`;
- `time-travel-response.schema.json`;
- life-event request, response, and list schemas;
- a cycle-scan-receipt schema;
- valid and invalid fixtures for every new document;
- an OpenAPI amendment defining the implemented public routes and all response
  statuses; and
- a manifest that records M0/M3 references and the exact supersession boundary.

The contract validator registers the existing absolute `$id` documents before
M4. It validates fixture directories and enforces policy invariants that JSON
Schema alone cannot express, including:

- every Pattern match has at least one positive predicate;
- symmetric aspect predicates use canonical body ordering;
- a house or angle predicate requires an accuracy/house eligibility gate;
- an M4 release contains every M3 object collection required by Today;
- a production-shaped Pattern object cannot carry a draft review state;
- life-event end dates cannot precede start dates;
- comparison cycle IDs belong to exactly one declared comparison group; and
- cached empty scans remain valid receipts rather than missing data.

Nothing under `contracts/m0/` changes. M3 schemas remain valid and byte-stable.

## Signed release compatibility

### Version dispatch

The ingestion parser becomes a discriminated, bounded dispatcher:

- `schema_version: 0.3.0` validates through the existing M3 schema and retains
  current behavior;
- `schema_version: 0.4.0` validates through the new M4 schema; and
- every other version fails closed as unsupported before hashing, signing, R2,
  or D1 work.

The existing request-size bound, body/header idempotency match, key allowlist,
signature algorithms, canonical-hash procedure, immutable object key, version
reservation, bundle-hash uniqueness, fixture hold, audit behavior, and atomic
activation remain unchanged. Schema selection cannot weaken any integrity
check.

M4 releases are supersets of the M3 editorial collections needed by Today.
`loadReleaseBundle()` projects either M3 or M4 into the existing reading-engine
shape and deliberately ignores M4-only Pattern matching fields for daily
reading assembly.

### One active pointer

The existing single active release pointer remains authoritative. There is no
second Pattern-only pointer that could drift from Today content.

- An active M4 release can serve Today and Your Pattern.
- Rolling back to an M3 release keeps Today available but makes Your Pattern
  explicitly unavailable because the active release has no M4 matching
  contract.
- A missing, unreadable, or hash-mismatched artifact is never replaced with a
  draft, stale in-memory copy, or generic Sun-sign text.

This tradeoff preserves the already-audited activation and rollback mechanism
and makes the reduced capability after an M3 rollback visible.

## Editorial candidate and promotion boundary

### Candidate source

The repository gains a non-ingestable candidate area, separate from signed
release fixtures. Candidate records carry an explicit draft/review-candidate
state and omit production signature metadata. The initial 24 families are
distributed across integrated aspect structures, elemental/modal emphasis,
calculated multi-body patterns, and accuracy-gated angular/house patterns. The
catalog must not collapse into generic Sun-sign descriptions.

Each candidate includes:

- stable candidate and future content IDs;
- locale and content version;
- title, summary, body, resources, tensions, and counter-expression;
- explicit prohibited claims;
- human-readable evidence requirements;
- structured M4 match predicates;
- display priority and tags; and
- reviewer notes that are never shipped to the client.

Assistant-authored candidate prose remains visibly unreviewed. Merely passing
schema, copy, or safety tests does not make it approved.

### Promotion and signing

A local release-builder command may consume candidates only with a separate
human review manifest. It refuses to produce a production-shaped M4 body unless:

- every included candidate is individually marked approved in that manifest;
- each approval names a human author and human approver;
- author and approver are distinct;
- the content and match-rule hashes equal the reviewed bytes;
- all referenced prompt/safety objects resolve; and
- all required contract and semantic fixtures pass.

The builder emits an unsigned canonical release body. A separate signing command
uses an externally supplied private key and emits the signed ingestion request.
Private signing keys are never written to the repository, candidate files,
logs, or test snapshots. Test bundles use clearly synthetic test keys and
synthetic content.

The implementation may prove building, signing, ingestion, activation, reading,
and rollback locally. It does not fabricate human approval, use a production
key, ingest production content, or activate a remote release without separate
authorization.

## Your Pattern data model

### Natal feature policy

Introduce a versioned `natal-feature-policy` owned by trusted application code.
It derives only from `chart_snapshots.snapshot_json` and
`uncertainty_json`. It never decrypts `birth_enc`.

The writer normalizes:

- natal positions with body, longitude, sign, and house only when houses are
  eligible;
- natal aspects with canonical body ordering, aspect, and orb;
- calculation-produced multi-body patterns and their member bodies;
- eligible angles and house cusps; and
- uncertainty/suppression facts needed to prove why a pattern was omitted.

Every row receives a deterministic ID derived with JCS and SHA-256 from the
chart fingerprint, feature-policy ID/version, fact class, and canonical fact.
The feature JSON includes the derivation policy and enough normalized detail to
evaluate a predicate and render mechanical evidence. It contains no birth date,
time, place, coordinates, free text, or editorial prose.

### Completion receipts and migration

An additive D1 migration creates a `natal_feature_sets` receipt keyed by chart,
feature-policy ID, and feature-policy version. It also adds the minimal policy
and feature-set linkage/indexing needed to select one complete feature set from
`natal_features`. Existing rows remain readable but are not treated as a
complete current-policy set without a receipt.

For a newly calculated chart, the existing chart activation transaction remains
authoritative and commits first. The request then awaits an eager feature write
whose feature rows and completion receipt commit atomically with each other. A
feature-cache failure is logged safely but does not roll back a valid chart or
turn successful chart onboarding into a Pattern dependency failure. For an
existing chart, or after an interrupted/failed eager write, `GET /v1/pattern`
performs the same lazy, idempotent repair when the current receipt is absent.

Concurrent lazy requests may derive the same deterministic set. A unique
receipt permits one winner; a loser reloads and accepts the winner only when the
set hash is identical. A different hash under the same chart and policy is an
invariant failure, not an overwrite.

The migration number is selected only after the uncommitted M6 migration ledger
is reconciled. `0005_m4_pattern_time_travel.sql` is the expected filename if
M6's current `0004_privacy_context.sql` lands unchanged; implementation must not
assume that number without rechecking.

## Pattern matching contract

M4 defines an exact `match` object in addition to the existing coarse
eligibility concepts:

```json
{
  "all_of": ["zero or more typed natal predicates"],
  "any_of": ["zero or more typed natal predicates"],
  "none_of": ["zero or more typed natal predicates"]
}
```

At least one predicate must appear in `all_of` or `any_of`. Matching semantics
are closed and deterministic:

- every `all_of` predicate must match;
- at least one `any_of` predicate must match when `any_of` is non-empty;
- no `none_of` predicate may match;
- coarse birth-accuracy, required-body, required-aspect, and house gates run
  before exact matching; and
- deprecated objects never match.

Typed predicates cover natal positions, natal aspects, calculated natal
patterns, houses/angles, and uncertainty facts. They may constrain only fields
that exist in the corresponding normalized fact. Aspect pairs are symmetric
and canonicalized. Optional maximum-orb constraints can narrow an aspect but
cannot exceed the calculation contract's admitted orb.

For every positive clause that contributes to eligibility, the matcher returns
the exact matched feature IDs. `any_of` records which alternatives matched.
Negative predicates affect eligibility but are not presented as affirmative
evidence. The matcher's output is pure, sorted by stable IDs, and independent of
database row order.

Pattern chapters are sorted by editorial display priority and then stable
content ID. Every eligible chapter is returned; the application does not impose
an arbitrary personalized chapter cap.

## `GET /v1/pattern`

The authenticated route replaces the stub before `stubRoutes` is mounted. It:

1. resolves the active user and account-state guard;
2. loads the active immutable chart;
3. loads the user's confirmed content-locale preference;
4. loads the active release row and hash-verified R2 bundle;
5. requires an M4 bundle with Pattern objects and resolves locale through its
   explicit fallback graph;
6. loads or atomically derives the current natal feature set;
7. evaluates eligibility and exact match predicates; and
8. projects the response without exposing the full release bundle.

Loading the release before lazy derivation avoids a D1 cache write when Pattern
content is unavailable. The only GET-side write is the deterministic derived
feature cache; it never changes user-authored or chart source data.

The response contains:

- M4 schema version and response time;
- chart ID, chart fingerprint, effective accuracy, and feature-policy version;
- release version, bundle hash, and resolved locale;
- eligible chapters with content ID/version, title, summary, body, resources,
  tensions, counter-expression, and prohibited-claim-safe presentation data;
- mechanical evidence records naming exact feature IDs and fact classes; and
- aggregate omission reasons for accuracy, houses/angles, locale, or exact
  predicate mismatch.

Evidence labels are deterministic descriptions of calculated facts, not new
interpretive prose. The API does not return draft status, reviewer notes,
candidate paths, signature bytes, or unmatched editorial objects.

### Pattern response states

- `200` with chapters: render the integrated profile.
- `200` with an empty chapter list: no reviewed object in the active release
  matched; this is not replaced with filler.
- `401`: existing signed-out behavior.
- `404 chart_not_found`: route to chart onboarding.
- `409 locale_confirmation_required` or explicit unsupported-locale state:
  reuse the existing preference flow.
- `503 pattern_release_not_active`: no active M4 Pattern release exists,
  including an intentional rollback to M3.
- `503 release_unreadable` or `release_hash_mismatch`: fail closed and expose
  only a request ID and safe error class.
- `500 feature_derivation_failed`: do not partially match an unreceipted feature
  set.

## Your Pattern web experience

The current Your Pattern destination remains the owner of chart setup and chart
facts. After a chart loads, it adds the Pattern request rather than replacing
the chart request.

The page presents:

- the existing chart wheel, positions, aspects, calculation stamp, and
  uncertainty facts;
- a stable Pattern status area that can load independently of the chart-facts
  panel;
- eligible chapter cards with summary visible and body/resources/tensions
  available without requiring astrology expertise;
- an explicit counter-expression in every chapter;
- an expandable **Why this?** disclosure listing matched facts and the release
  version; and
- an accuracy notice explaining when houses, angles, or time-sensitive Moon
  material were omitted.

The launch catalog contains 24 families; that does not mean every reader sees
24 chapters. Each reader sees only the subset proven eligible by their chart and
accuracy.

If chart facts succeed while Pattern content is unavailable, the page keeps the
chart visible and displays a scoped Pattern-content state. A Pattern release
failure never turns the chart page into a total blank or substitutes
application-authored interpretation.

## Time Travel date semantics

`GET /v1/time-travel?date=YYYY-MM-DD` accepts exactly one `date` query value and
no unknown query parameters. The date is interpreted in the user's confirmed
scheduling time zone.

For a past or future date, the representative instant is local noon. Local noon
avoids the usual daylight-saving gap/overlap while giving a stable, documented
date-level reference. If the selected date is the user's current local date,
the representative instant is the response-scoped current instant so Time
Travel and Timing do not disagree about “now.”

The API returns that `reference_at` explicitly. It does not imply knowledge of
an unselected time of day. A future product may add time selection under a new
contract.

The supported date range is owned by the pinned calculation policy and
ephemeris data. The Worker validates syntax and local-date resolvability, while
the calculation service remains authoritative for deterministic
`ephemeris_range` and incomplete-window refusals. The client receives a stable
`date_not_supported` class rather than raw calculation-service detail.

## On-demand cycle reconstruction

The selected and present reference instants use the same flow:

1. load the active chart's normalized positions, effective accuracy, and
   suppression flags;
2. construct a bounded selection interval containing the reference instant;
3. look up an exact successful scan receipt by chart fingerprint, UTC window,
   calculation contract, cycle policy, and orb policy;
4. if present, validate and use its immutable normalized result;
5. if absent, call the existing `/v1/cycles` calculation boundary;
6. validate every echoed policy, contract, fingerprint, and request identifier;
7. atomically persist normalized cycle/pass projections and an immutable scan
   receipt, including a successful empty result; and
8. compute phase at the response's declared reference instant rather than
   trusting a stored `phase` column.

The cycle call contains natal longitudes but no user ID, birth date, birth time,
timezone of birth, location, coordinates, encrypted payload, context signal, or
life-event text.

### Scan receipts

An additive `cycle_scan_receipts` table stores:

- opaque receipt ID and owner/chart IDs;
- chart fingerprint;
- exact UTC selection window and representative instant;
- selected local date and scheduling zone for auditability;
- calculation contract, cycle policy, and orb policy IDs/versions;
- calculation container and ephemeris-data versions;
- request and response hashes;
- bounded normalized result JSON, including `[]`; and
- creation time.

The application cap for result JSON is deliberately below the current D1 row
limit and is verified against the current
[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
during implementation. An oversized result fails before any cycle or receipt
write; the cap is not inferred from whichever Wrangler/Miniflare version
happens to be installed.

The immutable receipt result, not mutable convenience columns in
`cycle_instances`, is the authority for replaying that exact scan. Existing
cycle tables remain useful to Timing and for cross-surface indexing.

No failed or partial calculation creates a success receipt. Concurrent misses
may both calculate, but only one exact key can commit. A loser accepts the
winner only if the response hash is identical; a different result under the
same pinned policy fails closed and emits a payload-free invariant event.

Selected and present scans may execute concurrently. When both references are
the same, the service performs one lookup/calculation and reuses it. One public
request can therefore make at most two calculation subrequests and cannot ask
the Worker to iterate over an arbitrary date span.

## Time Travel projection and comparison

The response contains:

- M4 schema version, response time, confirmed time zone, and calculation-policy
  identity;
- a selected-date state with local date, reference instant, cache/on-demand
  provenance, last calculated time, and ranked cycles;
- a present state with the same shape;
- deterministic comparison groups; and
- authorized saved-context items plus an unreadable-item count.

Each cycle retains its immutable cycle ID, body, target, aspect, complete
envelope, exact passes, orb, phase at the reference instant, and mechanical
status. The same reading-engine ranking primitives used by the rest of the
product assign stable ranks. The response marks the dominant set while
retaining all readable cycles instead of silently discarding lower-ranked
facts.

Comparison uses stable cycle IDs:

- `continuing`: present at both references;
- `selected_only`: present at the selected reference but not now;
- `present_only`: present now but not at the selected reference; and
- `phase_changed`: a continuing cycle whose computed phase differs.

Every cycle ID appears in exactly one primary group. `phase_changed` is
additional metadata on a continuing cycle rather than a duplicate third copy.

A successful empty scan is a complete, useful result. Copy says no calculated
cycle overlaps the selected reference under the pinned policy; it does not say
that “nothing was happening.”

## USR-09 Life-event timeline

### Why USR-09 is separate

The v0.2 registry gives `time_travel` to `USR-09` Life-event timeline. The
current USR-06 Daily check-in grant permits theme ranking, tone, reflection
prompts, and notification timing but not Time Travel. This implementation does
not silently broaden USR-06 or reinterpret an existing consent.

`GET` and `PUT /v1/context-sources` add a separate USR-09 projection and
versioned consent transition. Revoking or pausing USR-09 takes effect before the
next Time Travel read. It does not delete retained events; deletion remains a
separate explicit operation.

The initial M4 grant is the least-privileged registry subset
`["time_travel"]`. This slice does not send USR-09 values into daily-reading
theme ranking or narrative continuity. Adding either use later requires an
explicit policy version, consent transition, publisher design, and derived-data
deletion analysis; it is not inferred from the registry's maximum allowlist.

### Life-event routes

M4 adds authenticated owner-scoped routes:

- `GET /v1/life-events?cursor=&limit=` lists the user's current retained events
  with stable cursor pagination;
- `POST /v1/life-events` creates an event with an idempotency key;
- `PUT /v1/life-events/:id` creates an immutable replacement revision with an
  idempotency key; and
- `DELETE /v1/life-events/:id` deletes every retained revision for that logical
  event after an idempotent owner-scoped request.

Creation and revision require an active USR-09 grant. Listing and deletion
remain available while the source is paused or revoked so users can inspect and
remove their own retained data.

An event includes:

- an opaque stable event ID;
- start date, optional end date, and precision (`day`, `month`, `year`, or
  `range`);
- a closed non-diagnostic category;
- significance (`low`, `medium`, or `high`);
- short title and optional bounded private note;
- explicit `use_in_time_travel`; and
- revision and recording timestamps.

`use_in_time_travel` defaults to false and must be an explicit choice. USR-09
records completed events, not future plans, so an event window ending after the
current local date is rejected by this contract.

The contract caps an account at 500 current life events and a list page at 50.
The cap bounds one Time Travel context read while leaving list management
paginated. A create that would exceed it returns `409 event_limit_reached` and
does not evict or overwrite an older event.

### Storage and provenance

Life events use `context_signals` with `source_id = 'USR-09'`. The stable event
ID occupies the source's logical `source_window`; revision rows receive unique
signal IDs and use the existing supersession chain. The complete value,
including dates, category, significance, title, note, and per-event permission,
is encrypted under the user DEK. Query volume is bounded per user, so Time
Travel loads current owner-scoped USR-09 rows, decrypts them in trusted Worker
code, and filters overlap in memory rather than making sensitive categories or
notes queryable in clear columns.

A small `life_event_mutations` table owns idempotency without retaining a
second copy of event content. It stores the operation, user, idempotency key,
opaque event ID, safe response metadata, and a server-keyed fingerprint of the
canonical request. The fingerprint key is domain-separated and versioned; the
fingerprint is not an unkeyed hash of low-entropy private fields. Event
creation/revision and its mutation receipt commit in one D1 batch, using the
documented transactional behavior of
[D1 `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Time Travel includes an event only when all gates pass:

- account access permits the read;
- the USR-09 source permission and matching consent are active;
- allowed uses include `time_travel`;
- the signal is current, non-conflicted, and readable;
- the event overlaps the selected date under its declared precision; and
- `use_in_time_travel` is true.

The response labels an event `recorded_then` when its `observed_at` lies within
the event's normalized date window and `added_later` when it was recorded after
that window. Calculated cycles are always labeled `reconstructed`. UI copy may
say that an event and cycle overlap in time; it must never claim that astrology
caused, predicted, diagnosed, or proved the event.

Life events participate in account export, retention classification, deletion
manifest coverage, key destruction, and source revocation tests. Because they
reuse `context_signals`, they must not create an untracked private-data table or
R2 prefix.

Deleting an event atomically removes its full signal revision chain, clears or
repoints `context_source_permissions.last_signal_id` when necessary, and marks
every prior mutation receipt for that logical event as tombstoned. An exact
replay of a pre-deletion create/update returns the tombstone response instead of
recreating data; a different request under the old key remains a conflict. The
mutation table is operational metadata, is excluded from portable content, and
is removed during account deletion.

## `GET /v1/time-travel`

The authenticated route replaces the stub before `stubRoutes` is mounted. Its
response states are:

- `200` with selected and present cycles plus any authorized saved events;
- `200` with empty cycles and/or context when the corresponding successful
  result is genuinely empty;
- `400 invalid_date` for missing, duplicate, malformed, or unknown query input;
- `401` for an unauthenticated request;
- `404 chart_not_found` when onboarding is incomplete;
- `409 timezone_confirmation_required` when local-date interpretation is not
  yet authorized;
- `422 date_not_supported` for a deterministic calculation-policy refusal;
- `503 calc_unavailable` for transport, configuration, or upstream 5xx
  failures; and
- `500` for an integrity failure after safe payload-free logging.

One unreadable private-context item does not hide valid calculated cycles. The
response increments `unreadable_context_count` and omits the item. A malformed
or hash-inconsistent scan receipt is different: it invalidates that date state
and fails closed rather than mixing untrusted calculated facts into comparison.

The route accepts no user ID, chart ID, time zone override, calculation policy,
or raw natal facts from the client.

## Time Travel web experience

The Time Travel destination replaces the generic `ApiFirstFeatureView` with a
dedicated, accessible view.

The primary interaction contains:

- an ISO-backed local-date control with a visible label;
- previous-day and next-day controls;
- a **Return to today** control;
- the selected date and its declared representative time;
- a responsive selected-versus-present comparison;
- ranked dominant-cycle summaries and expandable pass/envelope facts;
- a saved-events area visually and semantically separated from reconstructed
  astrology; and
- add, edit, per-event-use, and delete controls for USR-09 events.

On wide screens the selected and present states may sit side by side. At 390px
and 320px they stack in reading order without horizontal overflow. Comparison
groups remain understandable as text without color or a diagram. Date controls
use native semantics and remain contained at both mobile widths.

### Time Travel states

- **Loading:** retain stable headings and a polite status region.
- **Calculated on demand:** disclose that the date was reconstructed now.
- **Cached reconstruction:** disclose the prior calculation time and pinned
  policy without implying saved personal context.
- **No cycles:** render a successful calculated-empty explanation.
- **No saved context:** distinguish “none saved or authorized” from calculation
  failure.
- **Source off:** explain that Life-event timeline is paused/revoked and link to
  the privacy control; do not enable it implicitly.
- **Partial private context:** retain cycles and disclose the exact omitted
  context count.
- **Unsupported date:** preserve the chosen date and explain the calculation
  range without leaking upstream detail.
- **Calculation unavailable:** preserve controls and offer a focused retry.
- **Older Worker (`501`):** preserve the honest not-active compatibility state.
- **Unauthorized or inactive account:** use the central application handling
  before rendering private data.

No development JSON, draft Pattern prose, causal language, or invented event is
rendered.

## Security and privacy invariants

- WordPress and the editorial release path never receive user, chart, event,
  journal, reading, relationship, or health records.
- The calculation service receives normalized natal positions and policy
  metadata only; it never receives birth plaintext or saved context.
- Pattern matching runs inside trusted application code over non-PII calculated
  facts and hash-verified approved content.
- Life-event values are encrypted under the existing per-user DEK and excluded
  from logs, analytics, queue messages, IDs, and error strings.
- Every D1 query is owner-scoped before decryption; data is never selected across
  users and filtered afterward.
- Revocation is checked on each Time Travel request, not cached inside a scan
  receipt. Cycle receipts contain no private context.
- Pattern and cycle evidence cannot be altered by context.
- All request bodies and stored JSON artifacts have explicit application-owned
  size bounds before full parsing or decryption.
- Safe logs contain event names, request IDs, counts, policy versions, and opaque
  record IDs only.
- Account export and deletion coverage must fail if USR-09 introduces an
  unclassified encrypted field or retained object.
- `natal_feature_sets` and `cycle_scan_receipts` are user-owned derived data:
  export includes their portable policy/result projections and account deletion
  removes them. `life_event_mutations` is classified as non-portable operational
  metadata but is still owner-scoped and deleted with the account.

## Concurrency and recovery

- Natal-feature derivation is deterministic and converges through a unique
  feature-set receipt.
- New-chart activation does not depend on Pattern caching. The eager feature
  write is separately atomic and the lazy route repairs any missing receipt.
- Lazy backfill never changes the immutable chart snapshot.
- Scan result and receipt persistence is atomic. An R2 or queue dependency is
  not introduced for synchronous Time Travel calculations.
- Successful empty scans are cached; failures are not cached as empty success.
- A client retry after a calculation timeout may find the receipt committed by
  the first request and return it.
- Life-event create/update idempotency is scoped to operation, user, and key.
  Reusing a key with different normalized input returns `409`.
- Life-event revisions never mutate prior encrypted values. Deletion removes the
  full logical revision chain and tombstones mutation replay without retaining
  event content.
- A source revocation racing a Time Travel read is checked again before response
  projection so the revoked event is not returned.
- An account entering `pending_deletion` wins over Pattern, Time Travel, scan,
  or life-event publication through the central account-state guard.

## Test design

### Contract and editorial release

- validate representative Pattern and Time Travel responses, life-event
  requests, and empty scan receipts;
- reject malformed predicate shapes, empty positive matches, noncanonical
  aspects, impossible date ranges, and inconsistent comparison groups;
- validate all M4 fixtures and OpenAPI response shapes;
- prove M0 and M3 contract files remain byte-for-byte unchanged;
- prove M3 signed bundles remain ingestible and valid rollback targets;
- prove an M4 bundle can still project into the M3 reading-engine input;
- reject unsigned, incorrectly signed, hash-mismatched, same-author/approver,
  draft-shaped, or unresolved-graph M4 releases; and
- keep fixture-bearing releases pending until the repository's runtime fixture
  evaluation gate is genuinely implemented or the release contains no pending
  fixtures.

### Natal feature and Pattern API

- derive deterministic IDs and set hashes independent of input row order;
- normalize symmetric aspects and accuracy-gate houses, angles, and
  time-sensitive Moon facts;
- eagerly write features after a new chart commits, prove a writer failure does
  not roll back that chart, and lazily repair an old or missed chart;
- converge identical concurrent backfills and reject different-hash winners;
- exercise every predicate family and `all_of`/`any_of`/`none_of` combination;
- return exact evidence IDs and stable chapter ordering;
- never match deprecated, unsupported-locale, accuracy-ineligible, or
  negative-predicate content;
- return honest empty, M3 rollback, missing release, tampered R2, and malformed
  feature-set states;
- prove another user's features and chapters cannot be selected; and
- prove no draft candidate file is a runtime fallback.

### Time Travel API and D1

- resolve ordinary, daylight-saving transition, and skipped local dates;
- use local noon for non-current dates and one response-scoped instant for now;
- hit the calculation service once on a miss and zero times on an exact receipt
  hit;
- persist and replay a successful empty scan;
- reject an oversized normalized result before any D1 write;
- validate all calculation echo and policy pins before persistence;
- converge equal concurrent results and reject a differing response hash;
- recompute phase at both references and classify continuing, selected-only,
  present-only, and phase-changed cycles deterministically;
- preserve all readable cycles while marking the dominant subset;
- map deterministic calculation refusal separately from transient
  unavailability;
- prove no birth plaintext or context payload crosses the calc request; and
- prove another user's receipt, chart, or cycle cannot be read.

### USR-09 life events

- require explicit source activation and per-event Time Travel use;
- grant only `time_travel` initially and keep USR-06 authorization unchanged;
- encrypt every private event field and keep logs/persistence projections free
  of plaintext;
- cover day, month, year, and range precision overlap;
- enforce the 500-event account cap and stable 50-item cursor pages;
- reject future-completing and reversed windows;
- label recorded-then and added-later events from immutable timestamps;
- create and revise idempotently, detect key/body conflicts, and delete the
  complete revision chain;
- prove a pre-deletion mutation replay returns a tombstone and cannot recreate
  the event;
- allow listing/deletion while paused or revoked but omit events from Time
  Travel immediately;
- omit one unreadable event with an exact count while retaining valid cycles;
- prove owner isolation; and
- extend export, retention, deletion-manifest, and key-destruction coverage for
  life events, feature-set receipts, scan receipts, and mutation metadata.

### Web

- preserve chart facts while Pattern content loads, succeeds, empties, or
  fails;
- render chapter resources, tensions, counter-expression, uncertainty, and
  exact evidence disclosure;
- render selected and present dates, all comparison groups, pass details, and
  cache/on-demand provenance;
- create, edit, opt in/out, and delete a life event with source-state handling;
- preserve selected input and retry focus across errors;
- preserve the honest 501 rollback state;
- run focused accessibility checks for headings, disclosures, status regions,
  date controls, keyboard flow, and destructive confirmation; and
- inspect desktop plus 390px and 320px layouts with no horizontal overflow.

### Candidate gate

Implementation proceeds with red-green TDD in focused lanes. Before claiming a
local candidate, run fresh root:

- `npm run typecheck`;
- `npm test`;
- `npm run build`;
- `npm run test:contracts`;
- D1 migration/smoke validation; and
- a production-environment Wrangler dry run that performs no deployment.

The current dirty M6 candidate already has known stale expectations in focused
tests. Those failures must be reconciled on their own merits; this work must not
hide, waive, or misattribute them.

## Delivery and evidence gates

Completion evidence is reported separately for:

1. approved design and implementation plan;
2. local code and contract verification;
3. migration candidate validation;
4. human editorial review of all launch Pattern content;
5. signed bundle creation with an authorized non-test key;
6. remote D1 migration;
7. Worker deployment;
8. release ingestion and activation;
9. authenticated runtime and rollback checks; and
10. responsive browser and, if required, physical-device acceptance.

Passing an earlier gate does not imply a later one. In particular:

- synthetic signed fixtures do not prove editorial review;
- a valid local release does not prove production signing configuration;
- a local D1 smoke test does not prove a remote migration;
- a Worker dry run does not deploy;
- deployment does not activate content;
- an active release does not prove a particular user's Pattern eligibility;
  and
- local browser tests do not prove production or physical-device behavior.

## Deliberate exclusions

- WordPress plugin, WordPress content types, editorial UI, or WordPress
  deployment;
- automatic or assistant-declared human approval of Pattern candidates;
- production credentials, signing, ingestion, activation, migration, deploy, or
  rollback;
- generic Sun-sign filler or application-authored interpretive fallback;
- changes to the calculation service's transit technique, identity, orb, phase,
  or ephemeris policy except where a separately versioned defect is discovered;
- raw-birth-data access by Pattern or Time Travel;
- journal authoring/import, weekly reflections, linked calendars, weather,
  health, relationships, or other v0.2 context sources;
- AI synthesis of Pattern chapters, Time Travel explanations, or life-event
  meaning;
- causal claims between saved events and astrology;
- time-of-day selection for historical dates;
- public profiles, sharing, Bonds, social discovery, or guest accounts; and
- any silent change to unrelated dirty M6 work.

These exclusions constrain implementation without weakening the two selected
feature contracts. The full code path is implementable locally; production
launch remains honestly gated on human-reviewed content and separately
authorized operations.
