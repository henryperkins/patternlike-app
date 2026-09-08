# Slices 4 and 5: reader relationships, provenance, and feedback effects

Date: 2026-09-08

Status: specification for review; proposed interfaces are not implemented endpoints.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Quality criteria: [Slice 3 baseline](2026-09-08-interpretation-quality-baseline-design.md). This specification settles the shared relationship/feedback contracts; Slice 4 and Slice 5 retain separate implementation and release boundaries.

Source review: commit `6e706741f03253f2807d33380afb529161f3481f` and local files inspected on 2026-09-08. Proposed contracts below are additive design decisions, not claims about existing endpoints.

## Current source and consequences

[Daily evidence projection](../../../apps/api/src/routes/readings.ts) exposes edition/content identity and paragraph fact/context references. [History](../../../packages/shared/src/m8-reading-history-types.ts) identifies Daily editions by reading ID, revision, date, and status. [Pattern state](../../../apps/api/src/services/pattern-state.ts) serves the active Pattern and can retain an accepted document while source regeneration is pending or failed. Pattern storage does not establish an indefinitely retained library of every earlier Pattern edition.

Consequently, the first journey ends at an earlier saved **Daily** reading. A link to a replaced or erased Pattern may become unavailable; it must not silently open the latest Pattern and claim it is the original edition. The inspected Daily command/evidence does not by itself establish a first-class, durable Pattern-chapter relationship. Similar prose or matching labels are not sufficient evidence to add one.

[Feedback storage](../../../apps/api/src/db/feedback.ts) currently accepts resonance, relevance labels, and an optional encrypted note. Its [first-party source helper](../../../apps/api/src/db/first-party-sources.ts) creates/reuses the bounded USR-12 grant on submission. The allowed-use declaration includes content quality, repetition control, and theme ranking; the [context compiler](../../../apps/api/src/services/context-compiler.ts) offers structured resonance/labels for the latter two, not note text. USR-12 is not a switch in the closed USR-06/USR-09 context-sources document.

Preserve that actual grant model and explain it clearly. Do not describe current submission as having no grant effect, add USR-12 to a frozen context-sources enum, or convert feedback into unrestricted personal-context/training permission.

## Slice 4: one supported journey

The first complete path is Today paragraph → exact Pattern chapter → relevant calculated Timing result → earlier saved Daily edition → existing feedback. Use a small fictional, manually inspected relationship set first. This prototype needs no new model, regeneration of saved readings, graph database, or claim that every day has a supported connection.

Implement a pure relationship resolver and an owner-scoped loading adapter. The resolver receives already authorized document/evidence inputs and returns a closed relationship view. The adapter uses existing read/access/recall rules. Source-based automatic relationships are allowed only when the supplied inputs contain enough canonical evidence to prove the relationship. If evidence has expired or cannot be reconstructed, return no supported connection; do not recover it from word similarity or manufacture historical evidence.

### Exact target identity

Use a discriminated target reference, with these required coordinates:

| Kind | Identity and optional unit |
| --- | --- |
| `daily` | `reading_id`, integer `revision`, stored `content_hash`; optional actual `paragraph_id` |
| `pattern` | `pattern_id`, `document_revision`, stored `content_hash`; optional zero-based `chapter_index` and exact chapter source-text SHA-256 |
| `timing` | Stored `cycle_id`, full `cycle_hash`, applicable one-based pass index, UTC envelope, displayed local date/time zone, and stored cycle policy identity |

Pattern `document_revision` follows the existing schema/pattern/generated-at identity used by portrait binding. The Worker validates whole-document hashes against stored metadata; do not pretend the client can recompute an internal-document hash from an evidence-free public projection. Chapter text hashes use the existing canonical chapter-source serialization. Ordinals identify a chapter only within that exact document revision.

Timing uses [the existing content-addressed cycle and full envelope hash](../../../apps/api/src/db/cycles.ts), verified from stored normalized cycle bytes through the existing cycle-hash function. Keep chart/owner identity in the authorized loading boundary. The [current Timing snapshot](../../../apps/api/src/db/timing.ts) exposes active cycles and a latest-reading date receipt; that receipt alone is not a calculation-request identity or evidence of historical model/calculation pins. Expose only pins actually retained in the bound source.

Add an owner-authorized exact-cycle loader for links, with proposed `GET /v1/timing/cycles/:cycle_id` and required `cycle_hash`, `local_date`, and validated `time_zone` query parameters. Its additive `timing-cycle-detail/v1` representation identifies the stored envelope/policy and computes display phase for the requested date without changing that envelope. It may show a retained past cycle when existing chart/access/retention rules allow it, even though the current Timing list filters it out. Recalculation is a separately identified refresh; an erased, ineligible, or hash-mismatched result is unavailable. Do not silently rescan on link open or widen retention to make a link succeed.

### Relationship record

The logical record is `reader-relationship/v1` with `id`, `from`, `to`, `kind`, `reason_code`, `support_digest`, and `evidence_identity`. Derive IDs by SHA-256 over the existing canonical-JSON encoding of schema version, coordinates, kind, and support digest, prefixed with the relationship domain name. Labels are not identity inputs. Targets use the union above; reasons come from fixed presentation copy, not arbitrary server-provided HTML or URLs.

| Kind | Required support | Permitted explanation |
| --- | --- | --- |
| `shared_calculated_feature` | Same chart context and exact normalized factual feature identity, including participant roles/frame and applicable uncertainty policy | Both passages refer to this calculated feature |
| `shared_natal_participant` | Same natal chart/body identity with explicit, different fact roles | This transit and this natal interpretation both involve the named natal participant; they describe different facts |
| `dated_occurrence` | The event's UTC/local-time interpretation and the target reading's actual date/edition | This event falls on the date of this saved reading |
| `editorial_relation` | A versioned, attributable relationship review tied to both exact editions and admitted source meanings | An editorially supported connection, identified as interpretation |
| `reader_reflection` | An explicitly stored, permitted reader statement tied to its targets | A connection recorded by the reader |

The initial production resolver supports the first three only. Editorial and reader-reflection forms are reserved logical cases and cannot be emitted without their respective evidence and storage/consent implementation. Fictional demonstrations of those forms remain labeled demonstrations. Do not make a shared participant look like an identical feature, a dated coincidence look causal, or a reader's reflection look like calculation evidence.

Compare factual identities through typed adapters, not raw opaque ID equality across unrelated source namespaces. Label strings, overlapping vocabulary, and pooled citations never form a join key. Keep any chart/source coordinates needed for this comparison inside the Worker boundary; provider packets do not gain these relationships or wider personal context.

### Loading and presentation contract

A proposed additive `GET /v1/readings/:id/relationships` requires expected `revision` and `content_hash`, and returns `reader-relationships/v1`: the requested Daily edition, an `items` array, and a result status `available | no_supported_connection | unavailable`. An optional `paragraph_id` must exist in that exact reading. The response is a bounded path graph rooted at that edition: up to three hops and twelve edges, including Pattern → Timing and Timing → saved Daily edges where supported. Every endpoint of every edge is authorized. Keep at most four outgoing edges per node, sort by the supported kind order above then canonical destination identity, and expose `truncated` when supported candidates exceed the bound. This supports the complete journey without arbitrary recursive loading or a graph database.

Items contain only authorized target coordinates, kind, closed reason code, and the evidence identity needed by the explanation view. The browser maps those coordinates through its own route registry. A source revision/hash mismatch is unavailable; do not resolve against the newest revision instead.

First build this contract against fictional fixtures and the pure resolver. Then add the production adapter and the durable support described below. The prototype's completion is recorded separately from production relationship availability. Existing evidence can be used where sufficient; lack of new support on an old edition remains an explicit gap.

Revalidate source and destination eligibility on request and destination open. Foreign-owner and nonexistent targets use the same inaccessible behavior. Do not expose an erased target's prose, existence, private failure reason, or stale preview through a relationship response. Existing in-memory links are cleared on sign-out/account change and revalidated after source/consent changes.

The explanation has two levels: a short reason beside the link, and optional evidence details naming the edition, relation kind, calculation/source boundaries, and uncertainty. For personal input provenance, distinguish `available_to_generation` from `supports_this_passage`; require a passage-specific reference for the latter.

Back navigation restores the originating paragraph and scroll position. Keyboard focus moves to the destination heading/unit and returns to the originating link. Links remain available from the complete text reading, independently of graphics. A stale target offers a clear return and, when authorized, a separately labeled current destination; it never substitutes editions silently.

### Durable passage support

Add an owner-scoped `reader_relationship_supports` table with an opaque primary ID, `user_id`, `document_kind` (`daily | pattern`), document ID, revision key, document content hash, support schema version, encrypted payload/key metadata, and creation time. Enforce one support record per exact owner/document/revision/hash. A new additive migration must enforce the appropriate domain references through guarded writes and deletion hooks; do not invent one foreign key spanning two unrelated document tables.

The encrypted payload `reader-relationship-support/v1` contains units keyed by actual paragraph ID or chapter index/text hash. Each unit may contain canonical natal-feature coordinates `(chart_fingerprint_hash, feature_policy_version, feature_id)`, typed natal-participant roles, and bound cycle IDs/full hashes. A Daily edition also records its actual frozen local date/time zone and UTC day interval. Include only facts tied to that unit by validated evidence/plan references; a fact merely available to generation does not become passage support.

Derive support inside the Worker from validated factual inputs and accepted unit references, before private evidence is stripped from a public projection. Do not ask a provider to create join keys, infer them from prose, or broaden a provider packet. Persist new support in the same guarded publication transaction as the accepted document. Its hash is separate from the existing immutable reading content hash. Unsupported units can have no associations; database/write-fence failures cannot leave a falsely linked publication or an orphaned support record.

Read support only after authorizing the exact document and checking its current eligibility/hash. Register the encrypted field with key rotation, export, erasure, and replay inventory. Document deletion/source replacement deletes the associated support; account deletion fences access immediately and clears it through the established erasure process. Relationship graph responses and browser caches are derived views, never independent authority to retain erased material. Do not backfill old support from a current chart, rewrite historical prose, or claim the publication originally used newly attached evidence.

Release the schema and compatible publication/cleanup code before enabling production relationship reads. Additive storage is a separate Slice 4 review unit with migration/crypto/deletion tests and Slice 2 preflight. Fixture-only work does not depend on applying this migration.

### Slice 4 acceptance and release

Test the complete fictional journey, all relation kinds' admission/rejection rules, exact edition/unit mismatch, wrong chart/role/frame, unsupported label-only matches, unknown-time suppression, time-zone boundary changes, missing retained evidence, graph bounds/order, exact-cycle loading, atomic support adoption, crypto/export/erasure/replay, recall, source replacement, grant withdrawal, account changes, deletion, and browser history/focus restoration. Run the affected API/web/contract suites and rendered narrow/wide, keyboard, and fallback checks. Record a separate comprehension exercise using Slice 3's five task questions.

The pure resolver/fixture journey and production loading adapter are separate review units. Additive route/schema changes must preserve existing Daily/Pattern/History responses. No database or saved-reading change is implied by the fixture prototype. Slice 4 can finish its prototype with existing feedback while Slice 5 is still unimplemented; report any unimplemented production evidence-support work explicitly.

## Slice 5: distinct feedback with bounded effects

### Category and consent semantics

Keep the existing resonance endpoint and stored records compatible. A new categorical event is distinct from resonance, and must not invent a `not_helpful` rating to satisfy the old request shape. Use an additive proposed `POST /v1/readings/:id/feedback-events` endpoint with a closed `reading-feedback-event/v1` body: `category`, expected edition `revision`/`content_hash`, optional `paragraph_id`, optional `note`, `feedback_use_policy_version`, `expected_grant_state`, and literal `confirm_feedback_use: true`. Require the existing idempotency header and owner/edition checks. Retain the current 2,000-character note limit and reject unknown keys.

| Reader action | Recorded event / effect |
| --- | --- |
| Repetitive | `repetitive`; available to permitted repetition control for seven days |
| Not relevant today | `not_relevant_today`; available as a scoped theme-ranking signal for seven days |
| Unclear | `unclear`; content-quality/comprehension follow-up, with no automatic change to calculation or future generation context |
| My birth details are wrong | Navigate to birth correction and explain its actual invalidation consequences; no feedback event or grant merely from opening that route |

Before sending, explain that submission grants bounded feedback use, whether a paused/revoked feedback grant will be renewed, and that notes are stored but not offered as generation context. Use the existing USR-12 first-party grant mechanism for a deliberate submission; background loading, route navigation, retries after a stale form, and automatic migration must not create a new grant. Reuse an active matching consent identity so repeated submissions do not invalidate in-flight commands unnecessarily.

Define a read-only `GET /v1/readings/:id/feedback-options` response with schema `reading-feedback-options/v1`, policy `categorized-feedback-use/v1`, permitted categories, and an opaque grant-state tag computed from the current USR-12 grant/consent identity, permission state, and policy. The tag is a concurrency precondition, not a credential. This explanation policy preserves USR-12's existing allowed uses; it does not silently replace the underlying `usr-12-v1` grant policy.

After checking for an already completed idempotent request, the submission must compare `expected_grant_state` with current state in its guarded write. A changed/revoked grant returns `409 feedback_use_changed` without creating/renewing a grant or storing a new event. Refresh the explanation and obtain a fresh deliberate submission. A completed idempotent replay returns the original receipt even after later revocation and cannot re-enable use. This makes the stated stale-form rule enforceable rather than relying on button copy.

The server pins each event to the exact reading/paragraph, current grant ID/policy, and submission time. Recheck ownership, artifact existence, grant/write fences, and idempotency during the guarded write. Preserve current supported behavior for feedback about superseded/invalidated Daily artifacts while they still exist; reject pending/failed-without-artifact and erased targets. Same key/same request returns the original result; same key/different request conflicts.

Use a separate `reading_feedback_events` table rather than overloading free-form relevance labels. Store the event payload, note, and any derived theme/feature associations encrypted under the account's existing key regime. The exact schema/migration must include owner/reading identity, encryption metadata, creation/expiry coordinates, and the idempotent mutation record. Register the new table with export, deletion, crypto maintenance, and replay classifications before release. Keep old `reading_feedback` rows and API responses unchanged.

### Effect compiler and measurement

Add a versioned compiler for these events. It emits only closed category/target signals, never raw note text or a copied reading. Repetition signals can use `repetition_control`; relevance signals can use `theme_ranking`; unclear events are not offered to generation. A theme target must be derived from the actual reading evidence, not inferred from note prose. Where the reading has no supported theme association, store the response without claiming a theme-specific effect.

Expiry is seven days after submission for generation signals, not seven days after each read/retry. Apply existing packet caps and deterministic ordering; revocation, deleted target, or expired signal makes it ineligible. A category cannot remove calculation facts, bypass evidence/safety checks, become an engagement-only resonance score, or suppress uncertainty. An admitted signal means it was available for its allowed use; only execution evidence can establish that it affected a particular output.

Version any changed selection/context/prompt policy and preserve frozen-command handling. Do not run new semantics under an old pin or rewrite old publication receipts. Existing feedback remains usable through its current path; new categorical signals require the new compiler/policy explicitly. Optional notes remain exportable/deletable stored feedback, not training data or future prompt input by default.

Measure whether the category/effect distinction is understood before claiming benefit. On retained or separately authorized evaluation runs, compare repetition, source support, specificity, and comprehension against Slice 3's baseline. Theme rotation or a higher resonance score alone is not a successful improvement result.

### Slice 5 acceptance and release

Test each category's permitted and forbidden outputs; no target/unsupported theme; expiry boundaries; grant reuse and informed renewal; revocation between form load/write/execution; same-key replay and conflict; old wire requests; historical editions; note encryption/export/deletion; missing table classification; and unchanged factual selection/safety boundaries. Verify copy and interactions in the existing feedback surface and birth-correction route. Run affected suites, contracts, and the full gate.

Release storage/route compatibility before the new client/compiled effects. Apply any necessary migration before the compatible Worker merge/deploy, with the new producer disabled until dependencies are ready. The category UI, compiler activation, and evidence of reader benefit are separate completion states. This spec does not authorize participant recruitment, provider spending, a migration, or a production rollout.
