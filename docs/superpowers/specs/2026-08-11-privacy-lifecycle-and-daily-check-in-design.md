# Privacy Lifecycle and Daily Check-In Design

**Date:** 2026-08-11

**Status:** Approved in conversation; awaiting written-spec review

**Baseline:** `main` at `6e0c71d`

**Scope:** Implement two documented feature families that still resolve through
honest `501 not_implemented` routes: (1) account export and account deletion,
and (2) the USR-06 daily check-in with its context-source permission controls.
The work ends with a production-grade local candidate. Remote D1 migration,
queue creation, deployment, and production certification are separate gates.

## Decision summary

The implementation is privacy-first and lands in two independently verifiable
slices:

1. account export and deletion establish portability, erasure, account-state
   gates, key destruction, and durable privacy processing; then
2. source controls and daily check-ins add the first new user-authored context
   that those controls govern.

The existing API Worker remains the owner of both features. Export and deletion
use D1 as a durable outbox and a dedicated privacy queue consumed by the same
Worker; they do not share the daily-reading queue or require another Worker.
Source-control mutations and check-in writes are bounded D1 transactions and
remain synchronous.

The existing frozen M0 request and response shapes remain authoritative:

- `POST /v1/exports` accepts `ExportRequest` and returns `WorkflowAccepted`;
- `DELETE /v1/account` accepts `DeleteAccountRequest` and returns
  `WorkflowAccepted`;
- `GET` and `PUT /v1/context-sources` use `contextSourcesDocument`; and
- `POST /v1/check-ins` accepts `CheckInRequest` and returns `ContextSignal`.

Those documents, their `$id` values, and their `schema_version: 0.2.0` values do
not change. A forward-only `contracts/m6` amendment package documents the four
implemented M0 paths by reference and defines only the new export-status,
deletion-status, and account-export artifact shapes. New M6 response documents
carry `schema_version: 0.6.0`; embedded M0 documents retain `0.2.0`. The package
number records that these features ship after the current M5 contract; it does
not rewrite their historical M1/M4 roadmap labels.

## Existing foundations

The implementation should extend the foundations already in the repository,
not create parallel systems:

- `apps/api/src/routes/stubs.ts` is the only current owner of the four selected
  public surfaces.
- `export_requests`, `deletion_requests`, `jobs`, `audit_events`,
  `context_source_permissions`, `consents`, and `context_signals` already exist
  in D1.
- the daily-reading pipeline already provides encrypted job payloads, a D1
  outbox, claim leases, bounded retries, and duplicate-delivery convergence;
  the privacy worker reuses those primitives behind a separate queue.
- `loadConstrainedContext()` already decrypts `context_signals.value_enc`, and
  the M5 publisher already applies source permission, consent, allowed-use, and
  freshness gates. Check-in ingestion supplies that existing reader; it does
  not add a provider-specific path.
- `PrivacyView` already calls the export and deletion routes and contains the
  destructive confirmation interlock. Its source ledger is presently static.
- `TodayView` already owns the authenticated daily-reading experience.

## Architecture and module boundaries

The API additions are divided into units with one responsibility each:

- **privacy routes** validate HTTP requests, enforce owner scope, issue workflow
  receipts, and project stored state. They do not assemble exports or perform
  deletion.
- **privacy job store** reserves idempotent export/deletion commands, claims
  jobs, records checkpoints, and drives the D1 outbox.
- **export assembler** reads and decrypts the approved user-data sections and
  emits one versioned portable document. It never reads sessions, identity
  provider subjects, key material, raw job payloads, or request logs.
- **export envelope store** creates the per-export key, seals the artifact,
  wraps that key under `ROOT_KEK`, and owns the opaque R2 object.
- **deletion manifest** is the explicit, dependency-ordered inventory of
  user-owned D1 rows and R2 objects. A schema-introspection test fails when a
  new user-owned table is not classified by that manifest.
- **deletion processor** freezes access, cancels work, executes the deletion
  manifest, destroys key material, scrubs the tombstone, and writes the one
  permitted proof event.
- **context-source store** owns USR-06 consent history and the current permission
  projection. It is the only writer of `context_source_permissions`.
- **check-in store** normalizes, seals, supersedes, and returns USR-06 signals.
  It never makes astrology or reading-selection decisions.
- **retention maintenance** expires signals for use, purges raw check-ins after
  their retention horizon, expires export artifacts, and redrives undispatched
  or retryable privacy jobs.

`apps/api/src/index.ts` continues to export one fetch, one scheduled, and one
queue handler. A new `PRIVACY_QUEUE` producer binding points to a separate queue;
the queue handler dispatches by the configured queue name and a closed message
shape. Privacy messages contain only an opaque job ID and job type. No user ID,
request body, check-in, export option, or deletion reason crosses Queue.

## Account-state policy

Deletion cannot be safe while an authenticated session can continue writing.
Authentication therefore exposes the resolved account status to a central
account-access guard, including under `AUTH_STUB=1`.

The route policy is:

| Account state | Allowed normal operations |
| --- | --- |
| `active` | Existing product operations, export, deletion, and context controls |
| `frozen` | Consent recovery, export, and deletion only |
| `pending_deletion` | No normal session operation; deletion receipt status only |
| `deleted` | No normal session operation |

Starting deletion atomically changes the user to `pending_deletion`, revokes
every normal session, sets every context-source permission to disabled/revoked,
and cancels work that has not committed. Generation claim and publication paths must also check
for `users.status = 'active'`, so a worker already in flight cannot publish
after the deletion request wins the race.

## Account export

### Request and durable reservation

`POST /v1/exports` preserves the frozen optional body. Missing values use its
existing defaults. A successful response is `202 WorkflowAccepted` and always
populates both `job_id` and `resource_id`, even though the frozen schema leaves
them optional.

The idempotency key is scoped to `(export_account, user_id, key)`. The encrypted
job record stores the normalized request and accepted response. Replaying the
same key and body returns the same workflow; reusing the key with a different
body returns `409 idempotency_conflict`. Reservation and the
`export_requests.status = 'queued'` row commit in one D1 batch. Only after that
batch succeeds may the outbox dispatcher send the opaque queue message.

Frozen accounts may export. Pending-deletion and deleted accounts may not start
new exports.

### Portable artifact

The export is a single JSON document conforming to
`contracts/m6/account-export.schema.json`. It contains:

- export metadata and generation time;
- the account's portable profile metadata;
- reconstructed birth profiles and chart snapshots, including fields stored
  under the user DEK rather than the redacted `GET /v1/chart` projection;
- preferences, consent history, and current context-source permissions;
- all retained context signals, decrypted into their user-readable values;
- saved daily readings and their evidence when `include_readings` is true; and
- an explicit journal section.

Every optional section reports one of `included`, `omitted_by_request`, or
`not_available`. Until journals are implemented, `include_journal: true`
produces `not_available` with an empty item list; `false` produces
`omitted_by_request`. The export never implies that nonexistent journal data
was collected.

The export excludes:

- session tokens and hashes, identity-provider subjects, connector credentials,
  API keys, wrapped keys, and cryptographic material;
- raw jobs, queue leases, internal retry details, support data, request logs,
  and audit-event payloads; and
- data belonging to any other user, enforced in every query rather than by
  filtering a mixed result in memory.

### R2 envelope and expiry

The assembler serializes the complete artifact as UTF-8. A fresh random
AES-256-GCM key seals those bytes. That key is independently wrapped under
`ROOT_KEK`; it is not wrapped by the user DEK, because an export must remain
downloadable until deletion actually removes it. The database stores only the
wrapped export key, its nonce and KEK version, the artifact nonce, and an opaque
R2 key.

The R2 key is exactly `exports/{export_request_id}.json.enc`; it contains no
user identifier. The seal binds AAD containing the artifact schema ID, export
request ID, and creation instant. An export is ready only after the R2 put
succeeds and the guarded D1 update records the matching object metadata.

The expiry is seven days from successful assembly, not seven days from request.
Maintenance deletes the object and nulls all recoverable key metadata before
marking the row `expired`. A status or download request that observes a past
expiry fails closed immediately and schedules the same idempotent cleanup; it
does not wait for cron.

### Status and download

Two additive owner-scoped routes are introduced:

- `GET /v1/exports/:id` returns `queued`, `running`, `ready`, `failed`, or
  `expired`, plus safe timestamps, download availability, and a closed public
  error class; and
- `GET /v1/exports/:id/download` unwraps and decrypts a ready artifact and
  returns readable JSON over TLS with `Content-Disposition: attachment` and
  `Cache-Control: no-store`.

There are no public or presigned R2 URLs. A missing or differently owned ID is
reported as the same `404`. A valid but unfinished export returns `409
export_not_ready`; an expired one returns `410 export_expired`.

## Account deletion

### Acceptance and deletion receipt

`DELETE /v1/account` continues to require `{ "confirm": "DELETE" }`; the
optional reason is encrypted inside the job command, never logged, and removed
with that job. Exact idempotent replay returns the same request. A different body
under the same key returns `409`.

The acceptance transaction:

1. creates the deletion request and encrypted job;
2. changes `users.status` to `pending_deletion`;
3. revokes normal sessions;
4. disables current source permissions;
5. cancels queued user work and makes in-flight publication guards fail; and
6. stores the SHA-256 hash of a freshly generated one-purpose deletion receipt.

The raw receipt is returned only as an `HttpOnly; Secure; SameSite=Strict`
cookie whose path is limited to `/v1/account/deletion-status`. It is not a
session and authorizes only one operation. The cookie expires after seven days.
`GET /v1/account/deletion-status` locates the deletion request by the receipt
hash, so no request or user ID needs to appear in a query string. The response
contains only the opaque deletion request ID, status, safe timestamps, and a
public error class.

The status route is mounted outside normal account authentication but behind
request-ID/config middleware and its own constant-time receipt authentication.
Losing the receipt produces an unknown status, never a fabricated success. A
completed response clears the cookie after returning the completion state.

### Durable deletion

The processor is idempotent and checkpointed. Retried delivery may repeat any
completed step without restoring data or creating a second proof event. Its
ordered work is:

1. claim the deletion job and confirm the account is still
   `pending_deletion`;
2. cancel remaining jobs and prevent new reservations;
3. delete every export object, including queued or partially assembled exports,
   and any other user-owned R2 objects named by the deletion manifest;
4. delete user-owned D1 rows in foreign-key-safe order, including readings,
   evidence, charts, profiles, preferences, context, feedback, device tokens,
   sessions, identities, exports, and ordinary jobs;
5. irreversibly destroy every user DEK;
6. scrub required columns on the retained user tombstone to neutral values and
   set `status = 'deleted'` and `deleted_at`;
7. mark the deletion request complete; and
8. insert exactly one payload-free `account_deleted` audit event keyed by the
   opaque tombstone and deletion request ID.

`user_keys.wrapped_dek` is currently non-null even after `destroyed_at` is set,
which is key retirement, not destruction. The migration changes the invariant:
a live key must have wrapped bytes, while a destroyed key must have
`wrapped_dek = NULL`. Both deletion and ordinary key rotation must satisfy that
invariant. Deletion is not complete until no live key and no recoverable wrapped
DEK remain.

Transient D1 or R2 failures requeue with bounded exponential backoff and leave
the account frozen. An invariant failure may expose a safe `failed` state, but
it never reactivates the account or claims completion. A scheduled sweeper
redrives retryable jobs and expired leases.

The retained records after completion are limited to:

- the scrubbed `users` tombstone;
- destroyed `user_keys` rows with no wrapped key bytes;
- the deletion request and unexpired receipt hash; and
- the single payload-free audit proof.

## Context-source controls

### Supported source

The first implementation exposes only `USR-06 Daily check-in`. Birth and chart
facts remain visible in the broader Privacy presentation but are not mutable
context sources. External connectors, journals, device data, and every other
registry source remain unavailable rather than appearing as functional toggles.
`GET /v1/context-sources` always returns exactly one USR-06 projection; before
the first mutation it synthesizes the contract's `never_granted` state with a
null consent and signal ID.

The server owns USR-06's registry fields:

- permission tier `1`;
- allowed uses `theme_ranking`, `tone`, `reflection_prompt`, and
  `notification_timing`;
- evidence lane `user_and_context`;
- sensitivity `sensitive`; and
- confidence `user_confirmed`.

The client cannot add an allowed use, change the tier, supply a consent ID, or
enable another source. `PUT /v1/context-sources` keeps the frozen whole-document
shape, requires its `user_id` to match the authenticated owner, and accepts only
a valid desired-state transition for USR-06. Server-owned fields in the request
must match the current/registry projection or the request is rejected; the
response is always rebuilt from server state.

### State machine and consent history

The allowed user transitions are:

- `never_granted` or `revoked` to `active` by explicit enable;
- `active` to `paused` without deleting retained signals;
- `paused` to `active` by explicit resume; and
- `active` or `paused` to `revoked` by explicit revoke.

Each transition appends a new `product_source` consent version linked through
`supersedes_consent_id`, then atomically points the permission row at that
version. Pause and revoke immediately exclude all historical signals from new
commands, while the encrypted rows remain until retention or account deletion.
Re-enabling creates a new grant; it never rewrites a prior consent as though it
had remained active.

All context eligibility readers must consult the current permission projection
as well as the signal's historical consent pin. No M3 or M5 reader may treat an
older still-readable grant row as current after the permission row has moved to
paused or revoked.

Source mutations use the same encrypted exact-body idempotency pattern as the
existing AI-synthesis consent routes. A concurrent state change produces `409
consent_conflict`; key reuse with a different document produces `409
idempotency_conflict`.

## Daily check-in

### Validation and local-day identity

`POST /v1/check-ins` implements the frozen request exactly:

- `energy` is required and is `low`, `medium`, or `high`;
- `pressure`, `clarity`, and `connection` are optional values from the same
  vocabulary;
- `focus_domain` and a nullable note are optional;
- notes are limited to 1,000 characters; and
- `expires_in_seconds` defaults to 86,400 and remains within 300–604,800.

An active USR-06 permission is required. The server derives `observed_at` and
the user's local `YYYY-MM-DD` source window from the stored IANA timezone; the
client cannot backdate a check-in. A missing or unusable timezone returns `409
timezone_required`. The default cadence is one current check-in per local day.

A second successful submission in the same local day is an edit: it inserts a
new immutable signal, sets `supersedes_signal_id` to the previous current row,
and marks the previous row stale/non-current in the same transaction. A partial
unique index over `(user_id, source_id, source_window)` for current rows closes
the concurrent-write race.

### Encryption, minimization, and idempotency

The normalized value is stored only in `context_signals.value_enc` under the
user DEK with AAD bound to the immutable crypto subject, column name, signal ID,
and key version. `value_json` remains null. The clear columns contain only the
contract-required source, consent, permission, freshness, timing, and routing
metadata.

Because the value vocabulary is low entropy, `normalized_hash` is not an
unkeyed dictionary-friendly digest. It is HMAC-SHA-256 over a canonical object
containing the schema version, `USR-06`, the local-date source window, every
normalized value (including explicit nulls), and `expires_in_seconds`, using a
purpose-separated key derived from the user DEK. It is rendered in the frozen
`sha256:<hex>` content-hash shape. Identical values on different local dates do
not collide; an identical same-day submission can resolve to the current row.
DEK rotation re-encrypts the value but deliberately preserves this evidence
identifier, which was validly produced under the key active at ingestion.

The check-in's idempotency job stores the normalized request, server-derived
source window/timestamp, and returned signal projection under the user DEK.
Exact replay returns that projection without inserting or superseding again.
Different input under the same key returns `409 idempotency_conflict`.

The POST response is the frozen `ContextSignal` projection with a structured,
user-readable value over TLS. Ciphertext, nonces, and key versions are storage
details and are not returned.

### Freshness and retention

`expires_in_seconds` controls eligibility, not raw-data retention. Command
creation and execution compare the instant against `expires_at`; they never
depend solely on a cron-updated `freshness_status`. Once expired, a signal
cannot affect a new reading even if maintenance has not run.

USR-06 raw records are purged after the registry's thirteen-month maximum.
`CHECK_IN_RETENTION_MONTHS` is an integer from 1 through 13 and defaults to 13;
it may shorten but never extend that horizon. The write records
`retention_expires_at` using calendar-month arithmetic from ingestion, and
scheduled maintenance deletes due rows in bounded batches. Superseded, paused,
and revoked signals follow the same retention rule unless account deletion
removes them first.

The existing context compiler remains the only route into the reading
publisher. Eligible check-ins may rank a valid theme, shape tone, or influence
the reflection prompt. They may never alter chart facts, diagnose, guarantee an
outcome, infer protected traits, or be represented as something astrology
discovered. User-facing evidence uses “you reported” language.

## User experience

### Privacy

The static “Check-ins and priorities” row becomes a live USR-06 permission row
fed by `GET /v1/context-sources`. It displays `Active`, `Paused`, `Revoked`, or
`Not enabled`, its exact permitted uses in plain language, and distinct Enable,
Pause/Resume, and Revoke actions. Revocation copy says that future use stops
immediately while retained encrypted check-ins age out under the stated policy.

The account-data panel replaces milestone and 501 copy with real workflow
state. Export progresses through queued, processing, ready, expired, and failed.
The ready state shows the expiry and a same-origin download link, allowing the
browser to stream the attachment without holding decrypted JSON in React state.
The opaque export request ID is kept in `sessionStorage` so navigation within
the tab resumes polling without minting another request.

Deletion keeps the existing typed `DELETE` interlock and focus restoration. Its
copy explains that acceptance immediately locks the account and that completion
is irreversible. After `202`, the app navigates to a deletion-status surface
that can render before normal authenticated app boot. It polls using only the
httpOnly receipt cookie. A lost receipt or `401` is “status unavailable,” never
“deleted.” A confirmed completion renders once and then transitions to the
signed-out experience.

All asynchronous status text uses persistent polite live regions. Error text
includes the API request ID when present. Controls retain keyboard focus,
screen-reader labels, reduced-motion behavior, and the existing responsive
breakpoints.

### Today

Today gains a compact “How are you arriving?” card before the reading body.
When USR-06 is inactive, the card links to its control in Privacy rather than
granting permission implicitly.

When active, the first view contains the required energy choice and Save action
so the documented five-second path is real. “Add detail” reveals pressure,
clarity, connection, focus domain, and the optional note. The web client sends
the 24-hour default unless a later product decision adds an expiry selector.

After save, the card announces the active-until time and offers Edit. It states
that the value is available to the next eligible generation; it never implies
that an already-published reading was silently rewritten. A source-state race
returns a safe conflict while leaving the unsaved form values in the browser.

## Error and recovery contract

Every error uses the existing envelope and request ID. The public classes are
closed and actionable:

- `400` for malformed bodies, unsupported source documents, and missing or
  invalid idempotency keys;
- `401` for absent/invalid normal authentication or deletion receipt;
- `403 account_not_active` when account-state policy blocks a normal route;
- `404` for missing and differently owned resources alike;
- `409` for idempotency conflicts, concurrent state changes, inactive sources,
  missing timezone, or exports that are not ready;
- `410 export_expired` for an expired artifact; and
- `500` only for unexpected invariant failures, with private detail confined to
  safe logs.

Export and deletion jobs classify transient D1/R2 failures for retry. No log,
audit event, queue message, or clear job metadata contains check-in values,
export JSON, birth data, or deletion reasons. Deletion does not report success
until R2 cleanup, row cleanup, and irreversible DEK destruction all succeed.

## Data migration

A forward migration `db/d1/0004_privacy_context.sql` and matching
`MIGRATIONS.json` entry will:

- make destroyed `user_keys.wrapped_dek` null and enforce the live/destroyed key
  invariant;
- add wrapped export-key, artifact-nonce, status timestamp, and safe error-class
  columns to `export_requests`;
- add receipt-hash, receipt-expiry, checkpoint, status timestamp, and safe
  error-class columns to `deletion_requests`;
- add current-row and retention-expiry columns plus the partial daily-current
  index to `context_signals`; and
- add the bounded indexes required by privacy outbox, expiry, deletion receipt,
  and retention sweeps.

`context_signals.value_enc` moves from `UNWRITTEN_ENCRYPTED_COLUMNS` to
`ENCRYPTED_COLUMNS` before the first writer. Rotation tests cover both its
ciphertext and preservation of its normalized evidence identifier. Migration
smoke tests run against a fresh database and an upgraded 0001+0002+0003
database.

## Verification and acceptance

### Contract and unit proof

- validate the untouched frozen M0 package and the new M6 amendment, schemas,
  valid fixtures, rejection fixtures, and OpenAPI paths;
- prove all state machines and exact-body idempotency branches;
- prove export section inclusion/omission, owner scoping, redaction, envelope
  encryption, key wrapping, AAD mismatch failure, and seven-day expiry;
- prove deletion order, resume checkpoints, R2 cleanup, publication race gates,
  tombstone scrubbing, wrapped-key removal, and the single audit proof;
- prove registry-pinned USR-06 fields, consent-version transitions, source-state
  races, check-in validation, daily supersession, encryption, DEK rotation,
  freshness at read/execute time, and retention purge; and
- introspect D1 foreign keys/user-owned tables and fail if the deletion manifest
  does not classify a newly introduced user-data table.

### Integration proof

- use real isolated D1 migrations and an R2 test double for complete export and
  deletion journeys;
- run duplicate and out-of-order queue deliveries and lease recovery;
- use two seeded users for every owner-isolation operation;
- request deletion during queued, running, and ready exports and during a
  reading generation race;
- prove revoked/paused/expired check-ins cannot enter a new M5 provider packet;
  and
- set authentication bindings explicitly in tests rather than inheriting
  `.dev.vars`, so local `AUTH_STUB` choices cannot change test meaning.

### UI proof

- test keyboard operation, focus restoration, live-region announcements,
  polling cleanup, tab navigation/resumption, and error/request-ID rendering;
- run accessibility checks on active, paused, export-ready, deletion-confirm,
  deletion-processing, and failure states;
- verify the compact and expanded check-in form at mobile and desktop widths;
  and
- prove a current reading remains unchanged after a check-in while a later
  generation can consume the eligible signal.

### Completion gates

Each slice runs its focused API, contract, migration, queue, and web tests before
the repository-wide gates:

```text
npm run typecheck
npm test
npm run build
```

A passing local suite is not deployment proof. This scope does not create remote
queues, apply production D1 migrations, upload secrets, deploy Workers, or claim
production deletion/portability evidence.

## Explicitly out of scope

- journals, weekly reflections, external connectors, device/health/calendar
  ingestion, and notification delivery;
- reading feedback, Pattern, Time Travel, place search, and advanced astrology
  techniques;
- retroactively regenerating or rewriting a published Today reading when a
  check-in changes;
- email delivery of export links or deletion confirmations;
- public/presigned export URLs, multi-file ZIP exports, and password-encrypted
  client-side archives;
- support tooling for failed deletion jobs beyond safe correlation data; and
- remote migration, deployment, production data operations, or physical-device
  certification.

## Implementation order

The subsequent implementation plan must preserve two reviewable slices rather
than interleave all four routes:

1. contract amendment, migration, account-state gate, export, deletion, Privacy
   workflow UI, and privacy verification;
2. USR-06 source controls, check-in ingestion/retention, Today UI, publisher
   eligibility proof, and full regression verification.

The second slice may depend on privacy primitives from the first, especially
key destruction and deletion-manifest coverage. The first slice must not depend
on check-ins being present; its export schema already represents an empty
context collection truthfully.
