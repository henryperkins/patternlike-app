# R05: exact-edition feedback applicability

Date: September 28, 2026; revised October 1 after review. Status: **design for review; nothing is implemented.** Branch: `feat/r05-feedback-applicability`, stacked on the unmerged `feat/r04-family-aware-reissue` at `21386bd`, so the shared backlog, map, and snapshot pointer do not conflict. Scope: backlog item R05, option A.

Owner decisions (September 28):

- Implement truthful applicability (option A). `not_relevant_today` stays collection-only.
- `repetitive` responses without fact targets stay eligible, matching the current compiler. There is no selection-policy or prompt change.
- Write this design for review before any implementation.

Parents: the [R05 remainder in the backlog](../../architecture/source-map/backlog.md), the [reconciliation's R05 section](../../reviews/2026-09-28-architecture-map-reconciled-corrections.md), and the [Slice 5 design](2026-09-08-reader-relationships-feedback-design.md). The Slice 5 category, grant, window, retention, and measurement requirements stay in force; this design changes none of them.

## Summary

Today the response card can learn only whether categorical generation use is switched on for the whole deployment. This design adds a negotiated v2 of the two categorical responses:

- The **options** response reports, for each category before sending, whether a response would be offered to later readings.
- The **submission** response reports the same for the event just recorded or replayed.

Each result is `eligible` or `collection_only`, with one reason from a closed, ordered vocabulary. The v2 options response reports the latest response the same way.

The reasons come from the functions the generation path already runs. The compiler is refactored to return typed refusals instead of `null`, so no rule exists twice. `not_relevant_today` remains collection-only because no retained evidence supplies theme associations. Both responses state explicitly that the product does not report whether a later reading admitted or used a particular response.

Unchanged:

- stored events and v1 receipts
- account exports and retention
- prompts, selection policies, and compiled signals
- migrations, generated validators, and the Pattern creation-source hash

## Verified baseline

Checked against source on this branch. R04 changed two files cited here: `apps/api/src/db/consents.ts` gained a reservation guard (`loadAiSynthesisGrant` behaves identically), and `contracts/validate_schemas.py` gained its package registration. Every feedback file is unchanged from `00299d2`.

- **Theme ranking cannot apply.** [`supportedTargets`](../../../apps/api/src/db/reading-feedback-events.ts) stores the edition's retained fact IDs and always an empty `theme_ids`. V5 evidence retains `fact_refs`; no retained evidence format carries theme IDs. The [compiler](../../../apps/api/src/services/reading-feedback-compiler.ts) returns `null` for `not_relevant_today` without themes, and always for `unclear`.
- **`repetitive` compiles with or without fact targets.** It needs only the category, a live window, and the live grant it was recorded under.
- **Every non-`unclear` receipt carries a seven-day `effect_expires_at`.** The v1 receipt schema requires it, so a `not_relevant_today` receipt shows a window that can never apply. Stored receipts, replay, and the export embed that v1 shape.
- **The only applicability signal is global.** `generation_effects_active` is true only when the publisher configuration pins prompt `1.1.1` with selection `1.6.0`, which happens only with `CATEGORIZED_FEEDBACK_EFFECTS_ENABLED=1`. Committed production configuration pins `1.1.0` and omits the flag. The investigation's read-only query found the same on live version `057a6438` built from `00299d2`; this design did not repeat that query.
- **Categorical signals are compiled only for commands frozen under selection `1.6.0`** ([context compiler](../../../apps/api/src/services/context-compiler.ts)). They are rechecked against the live grant at execution, at runner admission, and inside the publication batch, all through `compileReadingFeedbackEvent`.

## Findings beyond the investigation report

1. **A reader-level consent gate is missing from the global flag.** The V2 command builder freezes `consent_categories` from the reader's current `ai_synthesis` grant. [`prepareConstrainedReadingInput`](../../../packages/reading-engine/src/constrained-input.ts) then rejects any signal whose category is not granted (`consent_category_not_granted`), and every feedback signal has category `reading_feedback`. Without a current AI-synthesis grant, no constrained-model reading is built at all (`ai_synthesis_consent_required`). So for a reader without that grant, `generation_effects_active: true` and today's copy both overstate what the response can do. The current policy's category list always includes `reading_feedback` ([`AI_SYNTHESIS_CATEGORIES_BY_POLICY`](../../../apps/api/src/db/consents.ts)), but a later policy could omit it. This design reports the reader-level gate as its own reason.
2. **"Edition unavailable" cannot surface through these endpoints.** Both answer `404 reading_not_found` when the exact edition is not readable, and a retained event's target always matches its readable edition. The reason is therefore not in the vocabulary; unavailability stays a 404.
3. **Feedback permission cannot currently end inside the product.** No route withdraws USR-12. Only an account deletion request revokes it, and that request also moves the account to `pending_deletion` and revokes its sessions, so these routes become unreachable. [`ensureFirstPartyGrant`](../../../apps/api/src/db/first-party-sources.ts) and the categorical writer always mint a new consent ID when they renew. A response whose grant has ended can therefore never compile again. Its permission reason is permanent for that event. Today it is reachable only through out-of-band changes; a future `usr-12-v1` policy bump would reach it for every outstanding response at once. One reader control stops use without ending the permission: withdrawing AI synthesis (`DELETE /v1/consents/ai-synthesis`) stops constrained-model readings, and with them every feedback use (finding 1, row 6). Granting it again re-admits responses still inside their window. The card's sentence "Turning permission off stops future use" describes a control that does not exist for feedback permission; see open question 2.
4. **Later use is partly visible, but never per response.** When a later V5 paragraph cites a feedback context, that reading's [“Why this?”](../../../apps/web/src/components/WhyThisDrawer.tsx) lists "Feedback you have given on readings" and its lane. The packet alias it exposes does not identify which response, and resonance and categorical feedback share that category. The link from an event to a reading exists only in encrypted frozen command pins. The accurate statement is that later use is **not reported**, not that it is not recorded.
5. **Responses reach only readings prepared after them.** The compiler excludes an event created after a command's generation anchor. A scheduled reading is due 30, 45, 60, or 75 minutes before the reader's local day, chosen by a bucket derived from the reader and the local date ([`readingDueAt`](../../../apps/api/src/services/reading-schedule.ts)), and is prepared on the next 15-minute scheduled pass. A reading opened before one was scheduled is prepared on demand. The copy says "readings prepared after you send it", not "later readings".
6. **Target-less `repetitive` is an edge case.** The web card sends only whole-reading responses, so fact targets are empty only when the edition's evidence cannot be read or cites more than 64 distinct facts. The compiled signal still enters a `1.6.0` packet as a repetition signal, which the `1.1.1` instructions permit for repetition control. It is reported as eligible, per the owner decision.
7. **A response whose window closes in flight fails the reading.** A command compiles categorical feedback at its generation anchor, but execution rechecks the frozen signals at the current time: before calculation and again before the provider call (both through [`pinnedContextEligible`](../../../apps/api/src/services/generate-daily-reading-v5.ts)), and in the [publication guard](../../../apps/api/src/db/reading-feedback-publication.ts), which requires `effect_expires_at` to be later than the publication instant. [Runner admission](../../../apps/api/src/services/reading-current-owner.ts) refuses the provider work on the same check. If a pinned response's seven-day window ends between the anchor and publication, the job fails `context_ineligible`. That failure is not automatically replaceable ([`V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES`](../../../apps/api/src/services/generation-failures.ts)), and [`replaceFailedCommand`](../../../apps/api/src/services/enqueue.ts) lets a first-open replacement record only `consent_regranted` or `publisher_superseded`, so the reader has no reading that day until an operator replaces it. Provider retries widen the interval. No test or document covers this. It is dormant while categorical effects are off. R05 does not change it: both candidate fixes, listed under [Compatibility and rollout](#compatibility-and-rollout), change frozen-command or guard behavior that this design leaves unchanged, so it is an activation prerequisite instead.

## Three states, reported separately

| State | Meaning | Where it is reported |
| --- | --- | --- |
| Global activation | The configuration a new command freezes under selects the categorical selection policy. | `generation_effects_active` (v1 and v2; one predicate) |
| Applicability | This category, or this recorded response, would be offered to the input selection of constrained-model readings prepared while it stays eligible. | v2 `applicability` on each category and on the latest or submitted event |
| Later admission or use | Whether a particular later reading admitted the response, or its prose was shaped by it. | Not reported: `later_use: "not_reported"` |

Eligibility comes before admission and is not admission. Each reading still applies these limits, and none of them is reported:

- the newest-100 candidate window
- the 20-record feedback cap shared with resonance feedback
- the packet byte and item budgets

Applicability also does not predict whether a later reading will be prepared at all. That depends on:

- account state
- timezone and locale confirmation, and locale support
- an active chart and calculation availability
- the rollout entry point

It covers exactly three things:

- the event itself
- the two permissions that govern feedback use (the USR-12 grant and the `reading_feedback` category of the AI-synthesis grant)
- deployment activation

## Reason vocabulary

`eligible` carries no reason. `collection_only` carries exactly one reason. The reported reason is the first applicable row in this table:

| # | Reason | Scope | Condition | Can change later? |
| --- | --- | --- | --- | --- |
| 1 | `content_quality_only` | category, event | The category is `unclear`. | No |
| 2 | `no_supported_theme_associations` | category, event | `not_relevant_today`, and the edition's retained evidence supplies no theme association. The writer supplies none today. | No, for an event. Yes for a category, only if a future writer derives associations (option B). |
| 3 | `effect_window_ended` | event | The evaluation instant is at or after `effect_expires_at`. | No |
| 4 | `feedback_permission_ended` | event | The live USR-12 grant is absent or is not the grant the event was recorded under. This covers revocation, expiry, a renewal with a new consent ID, a changed policy, a removed use, or a permission and consent that disagree. | No: a renewal never re-admits an older event. |
| 5 | `generation_use_off` | category, event | Global activation is false. | Yes, by operator configuration |
| 6 | `ai_synthesis_consent_required` | category, event | The reader holds no current `ai_synthesis` grant whose category list includes `reading_feedback`. | Yes, by the reader |

The order puts durable reasons first, so an explanation never implies that turning something on would help when it would not. For example, a `not_relevant_today` response says "no supported theme associations" whether or not generation is on, and an expired response says the window ended rather than that generation is off. Rows 3 and 4 cannot apply before sending: submission starts the window and creates, reuses, or renews the grant the event is bound to.

## One eligibility rule

No check is written twice. Each applicability input calls the function that the generation path already runs.

**Compiler refactor** ([`reading-feedback-compiler.ts`](../../../apps/api/src/services/reading-feedback-compiler.ts)):

- `categoricalFeedbackUse(category, targets)` returns a use (`repetition_control` or `theme_ranking`) or a refusal: `category_not_offered` or `no_theme_associations`. It reads only the category and targets, never a timestamp. It is the assessment's first step and the entire compiler-side part of the category-level check.
- `assessReadingFeedbackEvent(event, source, anchor)` returns `{ ok: true, signal }` or `{ ok: false, refusal }`. It runs these checks in order:
  1. the use check above
  2. `malformed_event`: non-finite timestamps, a window that is not exactly seven days, or an invalid target. This must follow the use check: an `unclear` receipt has a null window and would otherwise be misread as malformed. `decryptEvent` already rejects malformed stored events, so this step is defensive.
  3. `before_submission`
  4. `effect_window_ended`
  5. `retention_ended`
  6. `grant_not_event_grant`
  7. `use_not_permitted`
- `compileReadingFeedbackEvent` becomes `result.ok ? result.signal : null`. Reordering the checks changes only which refusal is named, never whether a signal is produced. The produced signal is byte-identical, so its normalized hash, frozen pins, runner admission, and publication guards are unchanged.

**Global activation.** `categoricalFeedbackGenerationActive(env)` is true only when `resolvePublisherConfiguration(env)` succeeds with a configuration whose pin selects `CATEGORIZED_FEEDBACK_SELECTION_VERSION`. That is the context compiler's own test, applied to the configuration a new command would freeze. The configuration pairs prompt `1.1.1` with selection `1.6.0` and refuses a mismatched prompt, so the predicate gives the same answer as today's inline check. The v1 `generation_effects_active` switches to it with identical output.

**Consent.** The consent check is `loadAiSynthesisGrant` followed by `categories.includes(<compiled signal category>)`. These are the builder's grant loader and the membership test the engine applies to `consent_categories`.

**Source agreement.** Export the engine's existing `sourceRejection` (renamed `contextSourceRejection`; a pure function with unchanged behavior) and apply it to the live grant from `loadCurrentCategoricalFeedbackGrant`. The engine rejects a USR-12 source whose permission and consent use sets differ, a case the compiler's per-use check alone does not catch. No product writer creates that state, so this check only guards against manual database edits. The engine applies the function to the USR-12 entry from [`loadContextSourceGrants`](../../../apps/api/src/db/consents.ts), not to this loader's result. Both read the same joined permission and consent row, so the answers agree whenever the categorical grant exists; when it does not, the event already reports `feedback_permission_ended`.

**Hold by construction.** Freshness (compiled signals are `fresh`), the registry allowlist (USR-12 admits both uses), and the M5 supported-use set hold for every categorical signal by construction. A test asserts them rather than re-checking them per request.

**Before sending.** The category check runs `categoricalFeedbackUse` over `supportedTargets(target)`, the writer's own derivation, and then checks global activation and consent. If option B later gives the writer theme associations, pre-send applicability follows without change. This adds an evidence read and decryption and an AI-synthesis grant read to every options request, which the card makes on every reading view; a latest event adds the categorical grant read. Today the theme answer is constant. The evidence read is kept so that option B needs no route change and pre-send applicability stays tied to the writer's derivation.

**After sending.** An event is assessed from its *stored* targets. `assessReadingFeedbackEvent` runs at the evaluation instant with the grant from `loadCurrentCategoricalFeedbackGrant`, which is the loader the context compiler uses. Source agreement, global activation, and consent follow.

**One instant per request.** The instant that filters the options query by retention is the instant passed to `loadCurrentCategoricalFeedbackGrant` and `assessReadingFeedbackEvent`, and it is the reported `evaluated_at`. A second clock reading could place a retention boundary between the query and the assessment and turn a retained event into the `500` described below. A new submission is evaluated at the instant that stamped its `created_at`, and a replay at the replay request's instant.

**Map to public reasons:**

- `category_not_offered` becomes `content_quality_only`.
- `no_theme_associations` becomes `no_supported_theme_associations`.
- `effect_window_ended` keeps its name.
- `grant_not_event_grant`, `use_not_permitted`, and a source rejection become `feedback_permission_ended`.
- `before_submission`, `retention_ended`, and `malformed_event` cannot occur for a retained, readable event evaluated after its own creation. They fail closed with the existing `500` rather than being reported as a reason. `decryptEvent` already throws for invalid stored events.

## Wire contract

### Negotiation

Clients opt in with `X-Patternlike-Feedback-Protocol: v2` on either categorical route. This mirrors [`X-Patternlike-Portrait-Protocol`](../../../contracts/portrait-v2/README.md):

- **Header missing:** byte-identical v1 behavior, so cached clients keep working.
- **`v2`:** the v2 responses below.
- **Any other value:** `400 unsupported_feedback_protocol`, returned before any read of reading, grant, or event state, and before any write.

The header is a capability. It grants nothing and does not take part in idempotency, so a same-key, same-body replay returns the same stored receipt under either protocol. Responses stay `private, no-store` through the existing boundary, and the service worker already bypasses `/v1/`. Both routes also send `Vary: X-Patternlike-Feedback-Protocol`, as the [portrait-mesh routes](../../../apps/api/src/routes/pattern-portrait-mesh.ts) do for their header; with `no-store` this is hygiene, not a cache fix. A new client that receives v1, for example after a rollback, uses the v1 path unchanged.

The request body stays `reading-feedback-event/v1`, and `feedback_use_policy_version` stays `categorized-feedback-use/v1`. Reporting applicability does not change what a submission grants.

### Options v2

`GET /v1/readings/{id}/feedback-options` with the header:

```json
{
  "schema_version": "reading-feedback-options/v2",
  "target": { "reading_id": "rdg_…", "revision": 1, "content_hash": "sha256:…", "paragraph_id": null },
  "feedback_use_policy_version": "categorized-feedback-use/v1",
  "expected_grant_state": "feedback-grant:…",
  "grant_action": "reuse",
  "categories": [
    { "category": "repetitive", "applicability": { "state": "eligible", "reason": null } },
    { "category": "not_relevant_today", "applicability": { "state": "collection_only", "reason": "no_supported_theme_associations" } },
    { "category": "unclear", "applicability": { "state": "collection_only", "reason": "content_quality_only" } }
  ],
  "effect_window_days": 7,
  "retention_months": 24,
  "generation_effects_active": true,
  "evaluated_at": "2026-10-02T09:00:00.000Z",
  "latest_event": {
    "receipt": { "schema_version": "reading-feedback-event-receipt/v1", "…": "unchanged v1 receipt" },
    "applicability": { "state": "eligible", "reason": null, "effect_window_ends_at": "2026-10-08T08:12:00.000Z" }
  },
  "later_use": "not_reported"
}
```

### Submission v2

`POST /v1/readings/{id}/feedback-events` with the header returns `201` for a new event or a completed replay:

```json
{
  "schema_version": "reading-feedback-event-response/v2",
  "receipt": { "schema_version": "reading-feedback-event-receipt/v1", "…": "the stored receipt, unchanged" },
  "applicability": { "state": "collection_only", "reason": "generation_use_off", "effect_window_ends_at": null },
  "evaluated_at": "2026-10-01T08:12:00.000Z",
  "later_use": "not_reported"
}
```

Applicability is evaluated after the commit, or at replay time, from the payload that was sealed or decrypted. The target's readability was established inside the committed batch, or by the replay path's own target check, so no "edition unavailable" reason is needed. If the evaluation fails after the batch has committed, the route answers `500` and the event stands. The card keeps the attempt, its retry sends the same idempotency key, and the replay path returns the stored receipt and evaluates it again. Replay is therefore part of how a submission completes, not only a duplicate guard. A replay after the permission ends returns the original receipt with `feedback_permission_ended`, and, as in v1, renews nothing. Error codes and statuses are unchanged, apart from the added `400 unsupported_feedback_protocol`.

### Schema rules

The v2 schemas enforce:

- `eligible` exactly when `reason` is null.
- Category reasons limited to rows 1, 2, 5, and 6; event reasons may use all six.
- `content_quality_only` exactly for `unclear`, and `no_supported_theme_associations` only for `not_relevant_today`. `not_relevant_today` is not forbidden from being `eligible`, so option B would need no schema change.
- For an event, `effect_window_ends_at` is a date-time exactly when `eligible`.
- In the options response, no `eligible` applicability, for a category or the latest event, when `generation_effects_active` is false. The submission response has no activation flag, so a runtime test holds it to the same rule.
- `later_use` is the constant `"not_reported"`; recording later use would require a new version.
- The v1 `target` and `receipt` are reused by cross-package `$ref`, the pattern `daily-uncertainty-v1` and `geocoder-v2` already use.

Runtime tests enforce what JSON Schema cannot express:

- the eligible window end equals the receipt's `effect_expires_at`
- `evaluated_at` falls on or after the receipt's `created_at` and, when eligible, before the window end
- the `categories` order matches v1
- a submission response is never `eligible` while global activation is false

## Contract package

New `contracts/reading-feedback-v2/`, status `additive_local_implementation` like v1:

- `reading-feedback.schema.json`, with `$defs` `categoryApplicability`, `eventApplicability`, `optionsResponse`, and `eventResponse`. Its `$id` is under `https://patternlike.app/contracts/reading-feedback-v2/`.
- `openapi/openapi.yaml`, covering both paths with the required header and `oneOf` v2/v1 responses, as `portrait-v2` does.
- `SCHEMA_MANIFEST.json` and a `README.md` that records the semantics, the boundary between applicability and admission, and the activation order (see [Rollout](#compatibility-and-rollout)).

Fixtures:

- Valid: options with generation off, repetition eligible, consent required, and an expired latest event; submission responses for eligible, a replay after the permission ended, and `unclear`.
- Invalid:
  - `eligible` with a reason, or `collection_only` without one
  - an unknown reason, or an event-only reason at category level
  - `unclear` eligible
  - `eligible` while `generation_effects_active` is false
  - an eligible event without a window end, or a collection-only event with one
  - `later_use` other than `not_reported`
  - `evaluated_at` missing
  - a bare v1 receipt as `latest_event`
  - an extra key
  - a wrong embedded receipt version

Register the package in [`contracts/validate_schemas.py`](../../../contracts/validate_schemas.py) at every point R04 used:

- the path constant and base URL
- the `load_registry` tuple
- the `FIXTURE_SCHEMA` prefixes and the `POLICY_ONLY` entry
- the policy-dispatch tuple
- the OpenAPI tuple and base map
- the `validate_package` and `check_openapi` calls in `main()`

No request schema changes, so `generate:validators` output stays identical and nothing is added to the generated Worker validators.

## Worker changes

- `services/reading-feedback-compiler.ts`: the refactor above.
- `services/reading-feedback-applicability.ts` (new): the global-activation, consent, and source predicates; `assessCategoryApplicability`; `assessEventApplicability`; and the ordered mapping from refusals to reasons. It never loads what the calling route has already loaded; the route passes the loaded target and event in.
- `db/reading-feedback-events.ts`:
  - `generation_effects_active` comes from the predicate.
  - `supportedTargets` is exported and derived once per options request.
  - The options builder takes a protocol argument and emits the v2 document.
  - `storeReadingFeedbackEvent` also returns the sealed or decrypted payload, so the route can assess the exact event without decrypting it again.
- `routes/feedback-events.ts`: parses the header first, before query or body validation, then projects v1 or v2.
- `packages/reading-engine/src/constrained-input.ts` and `index.ts`: export `contextSourceRejection` with unchanged behavior.
- `packages/shared/src/reading-feedback-types.ts`: the v2 document types, the ordered reason tuple, the state tuple, and the header constant.

None of these files is in [`pattern-creation-sources.json`](../../../apps/api/pattern-creation-sources.json), so accepted Patterns do not become stale.

## Web changes

`getReadingFeedbackOptions` and `submitReadingFeedbackEvent` send the header and accept either version, discriminated by `schema_version`. [`ReadingResponseCard`](../../../apps/web/src/components/ReadingResponseCard.tsx) adds `validOptionsV2` and `validEventResponseV2`, beside the unchanged v1 validators.

It keeps each category's applicability and the applicability of the latest or submitted event. The explanation is chosen by `(state, reason)` instead of by category plus the global boolean. "Possible generation use expires …" renders only when the event is eligible, using `effect_window_ends_at`, so a collection-only `not_relevant_today` receipt no longer shows a window. The v1 rendering path stays byte-for-byte as it is for v1 documents.

Three rendering rules carry over from v1:

- **Clock downgrade.** As v1 does with `effect_expires_at`, an `eligible` event whose `effect_window_ends_at` has passed by the browser clock renders as `effect_window_ended`. The clock never upgrades a collection-only state.
- **Before a category is selected.** The card shows the `generation_use_off` sentence only while `generation_effects_active` is false, and otherwise nothing; the selected category's explanation then appears in the existing live region.
- **Instants.** Window ends render with `formatInstant`, date and time, because the window ends at an instant rather than a date.

Proposed copy (final wording belongs to implementation review; the grant, storage, and birth-correction paragraphs are unchanged, except for open question 2):

| Reason | Before sending (selected category) | Recorded response |
| --- | --- | --- |
| eligible | Repetition control may use this response in readings prepared during the next seven days while feedback permission remains active. | It may be offered to readings prepared until {instant} while feedback permission remains active. |
| `content_quality_only` | Unclear responses are recorded for content quality and are not offered to later readings. | (same) |
| `no_supported_theme_associations` | This reading has no supported theme associations, so this response is stored without being offered to theme ranking. | This reading has no supported theme associations, so the response is stored without being offered to theme ranking. |
| `effect_window_ended` | — | Its seven-day window for later readings has ended. The stored response remains available until its retention limit or deletion. |
| `feedback_permission_ended` | — | The feedback permission it was sent under has ended, so it is no longer offered to later readings. A new response uses renewed permission. |
| `generation_use_off` | Generation use is currently off, so responses are stored without being offered to later readings. | (same, for this response) |
| `ai_synthesis_consent_required` | AI synthesis is not enabled for your readings, so responses are stored without being offered to later readings. | (same, for this response) |

Every eligible explanation ends with: "Later use is not reported, so eligibility does not show that a later reading used it."

## Compatibility and rollout

- **Nothing stored or frozen changes.** There is no migration, no change to stored data or the export, no new encrypted column, no prompt or selection version, and no generated-validator or Pattern-hash change. Frozen `1.6.0` commands and their publication guards are unaffected because compiled signals are byte-identical.
- **One merge ships the Worker and the PWA together.** Cached older clients keep the v1 path. A newer client served v1 after a rollback falls back to its v1 path.
- **Activation order.** Deploy R05 before anyone sets `CATEGORIZED_FEEDBACK_EFFECTS_ENABLED=1` with prompt `1.1.1`. No operator runbook covers that flag today, so the v2 contract README records the order.
- **Activation prerequisite outside R05.** Before the flag is set, resolve finding 7. One option rechecks the window against the frozen generation anchor, which matches what the copy promises: use by readings *prepared* before the window ends. The other makes a `context_ineligible` failure caused by categorical feedback automatically replaceable; re-freezing drops the expired response, so replacement converges. Both change frozen-command or guard behavior, so they belong to a separate change. The v2 README records this prerequisite beside the deployment order.
- **Residual after activation.** A client still cached at the v1 build keeps today's hedged copy, including the `not_relevant_today` window line. It is accurate only while generation is off, and it disappears as clients update.
- **Production today.** With the flag off, every category reports `collection_only`: `repetitive` says `generation_use_off`, and the other two report their own reasons. That matches today's "Generation use is currently off" message, now per category.

## Verification plan

**Compiler.** Before the refactor, add a table-driven characterization test that records `compileReadingFeedbackEvent` output across:

- category and target combinations
- window boundaries (created, expiry, and retention instants, plus one millisecond either side)
- grant states: absent, revoked, renewed, wrong version or policy, and missing use

The test must pass unchanged after the refactor. Then add one test per refusal code.

**Applicability.** A precedence matrix over category × window × permission × activation × consent. Plus an agreement test that drives real `loadConstrainedContext` and `prepareConstrainedReadingInput`, using the existing `prepareFeedbackContext` helper, and shows:

- an eligible event is selected when no cap binds
- every collection-only event is either absent from the context or rejected

**Routes:**

- Each pre-send reason, and each event reason, including the exact expiry boundary, revocation, renewal to a new consent, a removed AI-synthesis grant, and generation off.
- `evaluated_at` and `later_use`.
- A v1 response without the header that is byte-identical to a captured current response.
- Unknown header values rejected before any grant or event write.
- A v2 submission for each category.
- A replay after revocation that returns the original receipt, reports `feedback_permission_ended`, and renews nothing.
- `private, no-store` and `Vary: X-Patternlike-Feedback-Protocol` on every new path.
- Edition changes, which the backlog requires: a response on a superseded or invalidated edition is still assessed, as Slice 5 requires for those artifacts, and an edition whose artifact is gone answers `404` from both routes, never a reason.
- Key rotation: after [`rotateUserDek`](../../../apps/api/src/db/users.ts), the latest event and a replay assess identically.
- Note exclusion: applicability is identical with and without a note, and no v2 response contains note text.
- One instant: an event at its exact retention boundary is consistently absent, never a `500`.
- A failure injected after the commit returns `500`, and a retry with the same key returns `201` with the stored receipt and its applicability.

**Export.** `account-export-feedback/v1` output is byte-identical before and after R05; applicability never enters it.

**Contract.** Every fixture validates or fails for its intended reason, and the OpenAPI dependencies resolve.

**Web:**

- the copy for each reason, before and after sending
- no window line unless eligible
- the header sent on both calls
- v2 applicability shown immediately after submission
- the v1 fallback unchanged
- the existing axe checks
- the clock downgrade from eligible to `effect_window_ended`, and never the reverse
- before selection, the `generation_use_off` sentence only while generation is off
- window ends rendered as instants
- Today and History: the same edition's receipt and applicability agree on both surfaces

**Mutations.** Each of these should be caught by a specific test:

- dropping the consent check
- dropping the activation predicate
- reordering reasons
- assessing an event from recomputed targets instead of stored ones
- reading `not_relevant_today` theme IDs from anything other than the writer's derivation
- removing the header's unknown-value rejection
- assessing at a second clock reading instead of the request's instant
- removing the client clock downgrade

**Documentation and gate.** Same discipline as R04:

- Update the R05 backlog section; record theme ranking as retained collection-only, and finding 7 as an activation prerequisite outside R05.
- Refresh the categorical-feedback map leaves 1, 4, and 5, the compile-context leaf 3 wording on refusal types, and the contracts package list.
- Add a `CLAUDE.md` sentence and a README index line.
- Capture a clean snapshot, run all sixteen `npm run ci:local` lanes, and write the snapshot-bound receipt and review record.

Expected size: slightly smaller than R04.

## Out of scope

- **Option B, theme associations.** It needs retained, versioned associations; one candidate is the `reader-coordinate/v1` supports written since `0030`, and earlier editions have none. It also needs a join to the next day's facts that means something to the model, selection and prompt version bumps, a provider-boundary review, and authorized evaluation spend before any effect is claimed. The v2 schema and the `supportedTargets` path would carry such associations without a contract change.
- **Per-response admission reporting.** This would need a record written when a command freezes or publishes (a migration), or a scan that decrypts commands.
- **A USR-12 withdrawal control.** No route exists; see open question 2.
- **Finding 7's fix.** It changes frozen-command or guard behavior; it is an activation prerequisite, not part of R05.
- **The resonance card ("Say how it landed overall").** Its permission copy has the same reader-level gap as finding 1. The context compiler offers resonance records to the engine under both selection policies, and the engine admits them only with an active USR-12 grant and the `reading_feedback` AI-synthesis category. Submitting a categorical response creates or renews that same grant. That path is unchanged.
- **The legacy `POST /internal/readings/reissue` decision from R04.**

## Open questions for review

1. **Submission v2, or options-only v2?** Recommended: submission v2. The alternative keeps the POST at v1 and re-reads options after sending. That is one fewer schema, but it costs an extra request and a window in which the displayed state can lag.
2. **The "Turning permission off stops future use" sentence.** No product control turns feedback permission off. Withdrawing AI synthesis does stop use, reversibly, and also stops AI-written readings (finding 3), so replacement copy must not imply a USR-12 toggle. Options:
   - (a) In R05, replace it with an accurate sentence about permission ending and stored feedback. Recommended.
   - (b) Add a USR-12 withdrawal control, a privacy change larger than R05.
   - (c) Leave it.
3. **`ai_synthesis_consent_required`.** Recommended: include it. Without it, readers who never granted AI synthesis are told their response is eligible. Slice 5's acceptance criteria already require "accurate copy for source/category disagreement", which this reason provides.
4. **Engine source-agreement export.** Recommended: include it. It is a small, pure export that keeps the one-rule claim complete for a state only manual database edits can create.
5. **Names:**
   - the header `X-Patternlike-Feedback-Protocol`
   - the identities `reading-feedback-options/v2` and `reading-feedback-event-response/v2`. The second has no `/v1` predecessor because the v1 POST returns the bare receipt; its `v2` follows the negotiated protocol, and the README says so.
   - the state `collection_only` (the backlog's term; Slice 5 said "recorded-only")
   - `later_use: "not_reported"`
