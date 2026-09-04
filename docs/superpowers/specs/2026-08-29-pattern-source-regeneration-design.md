# Pattern Source Regeneration Design

**Status:** Approved in conversation on 2026-08-29.

## Goal

Let a reader explicitly regenerate an accepted Pattern when, and only when, the deployed source code that creates Pattern prose has changed since that Pattern was published.

The current Pattern remains readable while its replacement is generated. A failed, cancelled, duplicate, or stale replacement never removes it. A successful replacement atomically becomes the only readable Pattern, and the prior document and its retained generation material are irreversibly erased.

## Product contract

- Regeneration is never automatic. The reader must activate a dedicated action and confirm `REGENERATE MY PATTERN`.
- The action is offered only for an accepted Pattern whose stored Pattern-creation source hash differs from the compiled hash in the running Worker.
- Model names, environment variables, ontology releases, deployment metadata, CSS, UI copy, Daily code, documentation, tests, and unrelated Worker code do not independently make a Pattern eligible.
- One regeneration may be pending for a claim. Concurrent clicks and idempotent retries converge on the same pending generation.
- The existing Pattern remains visible, including while the replacement is organizing evidence, writing, or checking claims.
- A failed or cancelled replacement leaves the current Pattern intact and makes the action retryable when the source hash is still different.
- A successful replacement permanently removes the previous reader document, destroys its generation key and encrypted command, and schedules physical deletion of its retained R2 objects. No user-visible version history is added.
- Deleting a Pattern remains terminal. Regeneration does not reopen deleted, superseded, or withdrawn claims.
- The existing consent, chart, locale, ontology, provider-budget, validator, and human-free publication invariants continue to apply.

## Source identity

`apps/api/pattern-creation-sources.json` is the explicit allowlist of production TypeScript files whose bytes define Pattern creation. It includes the Pattern prompt, packet construction, natal-feature derivation, selection, plan/candidate validation, semantic checking, publisher adapters and pins, execution, and publication proof. Because the manifest is a hand-kept list rather than an import closure, it also names the two files past the adapter that still shape what the model receives: `codex-provider-contract.ts`, which assembles the prompt bytes, and the runner's `codex-cli.ts`, which maps the claim onto CLI flags (the runner must be run from the same commit as the Worker for that entry to mean anything). It excludes test fixtures, UI, styles, documentation, Daily generation, deployment configuration, lifecycle-only code, and three inputs that cannot silently change the bytes of an accepted packet: the frozen `contracts/m7` schemas (a change there is a version bump), the provider-boundary deny policy (an edit flips accept/reject, not content), and the HTTP transport.

`apps/api/scripts/generate-pattern-source-fingerprint.ts` reads that manifest from the repository root, rejects duplicates, non-TypeScript entries, missing files, traversal, and unsorted paths, then hashes a domain-separated, length-delimited stream containing each repository-relative path and the exact bytes of that file. The output is a lowercase `sha256:<64 hex>` value compiled into `apps/api/src/generated/pattern-creation-source.ts`.

The generated module is checked in. API test and build entry points run the generator in `--check` mode, so a source edit cannot ship with a stale compiled hash. The hash cannot be supplied or overridden by an environment variable.

Every newly reserved Pattern command and `pattern_generation_jobs` row freezes this hash. Publication proof rechecks it, and every delivered stage compares it with the currently compiled hash. A mismatch cancels the job before further provider work and releases only that job's reservation coordinate.

Every newly accepted `pattern_documents` row and its compact provenance store the same hash. Existing documents are migrated to a legacy all-zero source hash, making them eligible once under the first deployment of this mechanism without claiming knowledge of the source that created them.

## Contract boundary

The frozen M7 files are not edited. `contracts/m9` is a forward-only Pattern successor package:

- Pattern state is schema `0.9.0` and adds a required nullable `regeneration` block. A ready state always retains `pattern`; the block reports `eligible`, an optional active generation, and an optional last failure. It never exposes either source hash.
- The M9 generation request admits current initial-generation reasons and the new closed `source_update` reason. `source_update` requires the exact confirmation `REGENERATE MY PATTERN`; initial generation retains `GENERATE MY PATTERN`.
- Accepted and status responses use schema `0.9.0` while retaining the established public stage vocabulary.
- A signed M9 `pattern_regenerated` replay event identifies the erased generation/document and the replacement generation/document, and pins the replacement source hash. Existing M7 replay events remain valid and readable.
- `GET /v1/pattern` continues returning the frozen M7 public Pattern document because regeneration does not change reader prose shape.

## Durable state

Migration `0023_pattern_source_regeneration.sql` is forward-only and runs with foreign keys enabled.

- `pattern_generation_claims.pending_regeneration_id` is nullable. It must be null outside `accepted`; an accepted claim may move only from null to one pending id and back to null without changing its consumed identity or timestamps.
- `pattern_generation_jobs.pattern_source_hash` is required and `reservation_reason` admits `source_update`.
- `pattern_documents.pattern_source_hash` is required.
- The replay receipt table admits `pattern_regenerated` and stores nullable replacement ids and source hash.
- The monotonic claim trigger is replaced so terminal transitions still cannot reopen, consumption timestamps remain immutable, and an accepted claim cannot be deleted, superseded, or withdrawn with a pending regeneration.

The migration rebuilds only tables whose frozen `CHECK` expressions must widen, preserves every populated row explicitly, recreates indexes, and is covered both by a fresh-schema smoke check and an upgrade-over-populated-0022 check.

## Reservation and state flow

`POST /v1/pattern-generations` keeps the one existing Pattern queue and control plane.

For `source_update`, admission requires:

1. a current authenticated active account, active chart, and confirmed locale;
2. a current Pattern-generation grant and a usable ontology;
3. an accepted claim and readable document for the active chart;
4. a stored document source hash different from the compiled source hash; and
5. either no pending regeneration or an existing pending generation that can be replayed.

The reservation batch sets `pending_regeneration_id` while leaving the claim `accepted`, creates the ordinary encrypted `generate_pattern` job and artifact key, and enqueues the ordinary `PATTERN_QUEUE` message. Different concurrent idempotency keys race on the nullable pointer; the loser reads and returns the winner.

Ready Pattern state remains `ready`. Its `pattern` block remains populated. The M9 `regeneration` block is:

- `eligible: true` when the stored source hash differs and no generation is pending;
- `eligible: false` plus `generation` while a replacement is active;
- `eligible: true` plus `failure` after a failed replacement when retry is allowed; or
- `eligible: false` with neither child when the document has the current source hash.

## Publication and erasure

The publication proof binds `pattern_source_hash` to the command, domain job, and compiled Worker constant. Its authorization guard has two closed branches:

- initial publication: the claim is `reserved`, unconsumed, and owned by `active_generation_id`;
- regeneration: the claim is `accepted`, consumed, owned by `pending_regeneration_id`, and still has the exact prior document being replaced.

For regeneration, the Worker writes the signed create-only replay intent before mutating D1. One D1 batch then:

1. rechecks crypto, account, chart, locale, consent, ontology, source, job lease, claim ownership, and prior-document identity;
2. records the replay receipt;
3. deletes the old encrypted document row;
4. inserts the replacement document with the current source hash;
5. destroys the old generation artifact key and encrypted command;
6. clears `pending_regeneration_id` while keeping the claim accepted;
7. commits the ordinary successful job transition and audit event.

Only after that atomic commit does the Worker delete the old generation's R2 objects. R2 deletion is idempotent; cryptographic erasure in the committed batch is the irreversible boundary. If replay-intent creation or the D1 batch fails, publication retries and the old Pattern remains.

Signed replay of `pattern_regenerated` erases only the named prior document/generation, never the replacement, clears a matching stale pending coordinate, and converges the claim to accepted. This prevents a disaster restore from resurrecting the prior reader artifact.

## Interface

The ready Pattern reader gains a restrained secondary panel near provenance and data controls:

- `A newer Pattern method is available` explains that the existing Pattern stays visible until the new one is ready and will then be permanently replaced.
- `Regenerate Pattern` opens an inline confirmation; no modal or hidden automatic action is introduced.
- The submit action remains disabled until the exact confirmation phrase is entered.
- During regeneration the panel announces the current public stage with `role="status"` while the existing chapters remain mounted and readable.
- After a failure the existing chapters remain and the panel offers a retry. Duplicate activation is disabled while a request is in flight.

The existing design tokens, typography, focus treatment, delete flow, and responsive structure are preserved.

## Verification

- deterministic source fingerprint unit tests and generated-file freshness check;
- M9 schema, fixture, manifest, and OpenAPI validation;
- fresh D1 apply plus populated 0022-to-0023 migration proof;
- claim-transition, route, concurrency, state, stale-stage, publication, erasure, and replay tests;
- web interaction tests for ineligible, eligible, confirmation, active, failed, and duplicate-action states;
- typecheck, focused builds/tests, UI static detector, desktop/mobile browser verification, and `npm run ci:local`.

Implementation stops short of commit, push, migration application, merge, or deployment unless separately authorized.
