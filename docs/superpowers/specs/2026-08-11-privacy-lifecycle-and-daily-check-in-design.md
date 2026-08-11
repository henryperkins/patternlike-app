# Privacy Lifecycle and Daily Check-In Design

**Date:** 2026-08-11

**Status:** Revised after repository review; awaiting re-approval

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

M0 remains frozen. Its OpenAPI response lists are historical and currently name
only `400`/`401` on some of these paths. The M6 OpenAPI amendment is the
authoritative implemented surface: it references the unchanged M0 request and
success schemas and documents every additional `403`, `404`, `409`, `410`,
`500`, and `503` response described below. `POST /v1/check-ins`, including an
exact idempotent replay, returns the frozen `201`; an initial export or deletion
reservation returns `202` with `status: queued`, while its exact replay returns
the same IDs with the frozen `status: duplicate` member.

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
  the M5 publisher already applies source permission, consent, and allowed-use
  gates. The M6 work extends that shared compiler and the reading-engine input
  with an absolute expiry check; check-in ingestion does not add a
  provider-specific path.
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
queue handler. A new `PRIVACY_QUEUE` producer binding points to a separate queue.
The handler does not infer behavior from an unconfigured queue-name string: it
parses a closed message discriminant, then claims a D1 row whose exact
`job_type` must match. The only privacy job types are `export_account` and
`delete_account`; every claim, retry, lease-recovery, and undispatched sweep
pins one of those types in its compare-and-swap. Privacy messages contain only
`{ kind: "privacy", job_id, job_type }`. No user ID, request body, check-in,
export option, or deletion reason crosses Queue. Each message is explicitly
acknowledged only after durable convergence; transient failures explicitly
retry the individual message.

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
and cancels work that has not committed. Generation claim and publication paths
must also check for `users.status = 'active'`, so a worker already in flight
cannot publish after the deletion request wins the race. Export claims accept
only `active` or `frozen` accounts, and export publication repeats that account
guard as described below.

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
new exports. `ARTIFACTS` is a required capability for this route: if the binding
is absent, reservation fails before any row is written with `503
object_storage_not_configured`, matching the existing content-release boundary.
If a previously accepted worker later lacks the binding, it cannot mark the
request ready and records only that safe failure class.

### Portable artifact

The export is a single JSON document conforming to
`contracts/m6/account-export.schema.json`. It contains:

- export metadata and generation time;
- the account's portable profile metadata;
- reconstructed birth profiles and chart snapshots, including fields stored
  under the user DEK rather than the redacted `GET /v1/chart` projection;
- the preference columns on `users`, the `timezone_changes` history, consent
  history, and current context-source permissions;
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

The portable plaintext has an application-owned maximum of 16 MiB. Assembly
counts UTF-8 bytes section by section and stops before sealing if the next
section would exceed the cap. The request becomes `failed` with public class
`export_too_large`; no object or recoverable export key is retained. Downloads
also reject an object larger than the maximum ciphertext envelope before
calling `arrayBuffer()` or decrypting it. Supporting larger accounts requires a
new chunked/streaming artifact contract rather than silently raising this bound.

### R2 envelope and expiry

The assembler serializes the complete artifact as UTF-8. A fresh random
AES-256-GCM key seals those bytes. That key is independently wrapped under
`ROOT_KEK`; it is not wrapped by the user DEK, because an export must remain
downloadable until deletion actually removes it. The database stores only the
wrapped export key, its nonce and KEK version, the artifact nonce, and an opaque
R2 key.

The R2 key is exactly `exports/{export_request_id}.json.enc`; it contains no
user identifier. The seal binds AAD containing the artifact schema ID, export
request ID, and creation instant. Every R2 read, write, list, and delete builds
or validates this `exports/` prefix internally; the shared bucket's immutable
editorial objects are never candidates. A future user-owned artifact family
must register its own prefix-safe collector before the deletion manifest may
name it.

An export is ready only after the R2 put succeeds and a guarded D1 update records
the matching object metadata. Both the pre-put check and the publish update
require the user to remain `active` or `frozen` and the job claim token to remain
current. The post-put update is the race-closing guard: if deletion changed the
account after the preflight, publication fails and the worker immediately
deletes that deterministic export object before acknowledging the message.

Deletion also treats export claims as barriers. After preventing new claims, it
cancels unclaimed exports and waits while any export job has a valid running
lease; an expired claim is reclaimed into cleanup rather than treated as proof
that no object exists. Only then does deletion perform its final deterministic
`exports/` sweep. If an exporter crashes after PUT, its uncleared claim forces
that recovery/sweep before deletion can succeed. A stale worker that resumes
after losing its claim cannot publish through D1 and must delete its object on
the failed post-put guard. The integration suite exercises this ordering rather
than assuming an R2 sweep alone can fence a previously claimed worker.

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
with that job. The frozen request gives `reason` no `maxLength`, so the
implementation does not invent a check-in-style 1,000-character restriction.
Exact idempotent replay returns the same request IDs with workflow status
`duplicate`. A different body under the same key returns `409`.

The acceptance transaction:

1. creates the deletion request and encrypted job with a clear, opaque
   `deletion_requests.job_id` link needed for post-erasure resume;
2. changes `users.status` to `pending_deletion`;
3. revokes normal sessions;
4. disables current source permissions;
5. cancels queued user work and makes in-flight publication guards fail; and
6. stores the SHA-256 hash of a freshly generated one-purpose deletion receipt.

Deletion also preflights `ARTIFACTS` before changing account state, because it
cannot promise complete cleanup while the shared object store is unreachable.
If the binding disappears after acceptance, processing remains
`pending_deletion` and retryable; it never reports success without the R2 proof.

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
completed response clears the cookie after returning the completion state. Its
middleware is attached directly to `/v1/account/deletion-status` before routing
at `/`, following the `sessionRoutes` precedent in `apps/api/src/index.ts`; it
must not mount a wildcard sub-router at `/`, which would leak its middleware
across the parent app.

### Durable deletion

The processor is idempotent and checkpointed. Retried delivery may repeat any
completed step without restoring data or creating a second proof event. Its
ordered work is:

1. claim the deletion job and confirm the account is still
   `pending_deletion`;
2. cancel remaining jobs, prevent new reservations, and wait/recover until no
   export publication claim remains live;
3. delete every object registered by the prefix-safe R2 manifest, initially only
   deterministic `exports/{export_request_id}.json.enc` keys, including a key
   for every queued, running, ready, or partially published request;
4. execute the authoritative, foreign-key-ordered D1 manifest. Its initial
   classifications cover direct and indirect ownership in `reading_sources`,
   `reading_feedback`, `daily_readings`, `cycle_passes`, `cycle_instances`,
   `timezone_changes`, `natal_features`, `chart_snapshots`, `birth_profiles`,
   `context_signals`, `context_source_permissions`, `connector_accounts`,
   `device_tokens`, `sessions`, `identities`, `consents`, `export_requests`,
   prior user-correlated `audit_events`, and ordinary `jobs`. Preference values
   are columns on the retained `users` row, not a `preferences` table, and are
   scrubbed in step 6;
5. in one D1 batch, null the deletion job's encrypted payload, irreversibly
   erase every user DEK, set `dek_destroyed = 1`, and advance the request to the
   `keys_erased` checkpoint;
6. scrub required columns on the retained user tombstone to neutral values and
   set `status = 'deleted'` and `deleted_at`;
7. mark the deletion request complete and remove the now payload-free deletion
   job; and
8. insert exactly one payload-free `account_deleted` audit event keyed by the
   opaque tombstone and deletion request ID.

After the `keys_erased` batch, a retry must not attempt to decrypt the job it
just destroyed. It resolves the deletion request by the clear opaque `job_id`
link and resumes from its checkpoint. A redelivery after the terminal job row is
gone treats the completed request as convergence and acknowledges without
recreating work. Steps 6–8 are one guarded D1 finalization batch; the audit event
uses a deterministic ID derived from the deletion request so a replay cannot
create a second proof row.

`user_keys.wrapped_dek` is currently retained after `destroyed_at` during
ordinary rotation so a missed encrypted column still has a recovery path.
M6 preserves that behavior. The migration distinguishes retirement from account
erasure: live keys have wrapped bytes and no destruction time; retired rotation
keys retain wrapped bytes with `destroyed_at`; only deletion-erased keys have
`wrapped_dek = NULL`, `destroyed_at`, and `erased_at`. Deletion is not complete
until every key row for the user is deletion-erased. The schema-introspection
coverage in `encrypted-columns.test.ts`, the post-rotation ciphertext assertion,
and explicit rotation recovery tests remain the compensating controls for
ordinary retirement.

Transient D1 or R2 failures requeue with bounded exponential backoff and leave
the account in `pending_deletion`. They never move a partially deleted account
to the separately meaningful `frozen` state, which permits export. An invariant
failure may expose a safe `failed` request state, but it never reactivates the
account or claims completion. A maintenance sweep redrives retryable jobs and
expired leases.

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
a valid desired-state transition for USR-06. The synthetic `never_granted`
projection has the registry tier but `allowed_uses: []`, matching the frozen
fixture. On its one legal enable transition, the server accepts that exact
synthetic document and expands the persisted permission and consent rows to the
four registry uses. After a grant exists, request uses must exactly match that
persisted registry set. The response is always rebuilt from server state.

### State machine and consent history

The allowed user transitions are:

- `never_granted`, `revoked`, or `expired` to `active` by explicit enable;
- `active` to `paused` without deleting retained signals;
- `paused` to `active` by explicit resume; and
- `active` or `paused` to `revoked` by explicit revoke.

Each transition appends a new `product_source` consent version linked through
`supersedes_consent_id`, then atomically points the permission row at that
version. Pause and revoke immediately exclude all historical signals from new
commands, while the encrypted rows remain until retention or account deletion.
Re-enabling creates a new grant; it never rewrites a prior consent as though it
had remained active.

The three status vocabularies are mapped explicitly rather than passed through:

| Effective source state | `enabled` | D1 `consents.status` | New `ContextSignal.consent.status` | Reading-engine consent projection |
| --- | ---: | --- | --- | --- |
| `never_granted` | `0` | no row | no signal may be created | `revoked` fail-closed sentinel |
| `active` | `1` | `granted` | `active` | `granted` |
| `paused` | `0` | `paused` | no signal may be created | `revoked` after permission rejection |
| `revoked` | `0` | `revoked` | no signal may be created | `revoked` |
| `expired` | `0` | `expired` | no signal may be created | `expired` |

A newly stored `ContextSignal` can only be active, so its frozen
`consent.status` is `active` even though the backing D1 consent row says
`granted`. Active, paused, revoked, and expired permission/consent pairs retain
the exact four registry uses so the engine's set-equality check remains true;
only the synthetic no-consent state exposes an empty set. USR-06's
`notification_timing` permission is retained in those sets but does not enter
the reading packet because it is not in `M5_SUPPORTED_USES`.

`denied` and `pending` remain valid general D1 consent values but are not valid
current USR-06 transition results; if encountered, the source reader rejects the
row fail-closed rather than casting either value into the engine type. A
historical signal retains the active consent snapshot from its ingestion; the
current permission row is the independent gate that makes it ineligible later.

`enabled = 1` is valid exactly with `permission_state = 'active'`; every other
state requires `enabled = 0`. `loadContextSourceGrants()` is changed to preserve
the stored permission state and reject an inconsistent row as an invariant
failure instead of folding every disabled row into `paused`.

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
client cannot backdate a check-in. `users.timezone` is never null, so the route
uses the existing real gate: `timezone_source = 'default_unconfirmed'` (or an
unusable stored zone) returns `409 timezone_confirmation_required`. The default
cadence is one current check-in per local day.

A second successful submission in the same local day is an edit: it inserts a
new immutable signal with `source_revision = previous + 1`, sets
`supersedes_signal_id` to the previous current row, and atomically writes the
predecessor to `conflict_status = 'superseded'` and `is_current = 0`. It does not
mislabel supersession as a freshness event. The new row is
`conflict_status = 'none'`, `freshness_status = 'fresh'`, and `is_current = 1`.
A partial unique index over `(user_id, source_id, source_window)` where
`source_id = 'USR-06' AND is_current = 1`, plus USR-06 revision uniqueness
within that window, closes the concurrent-write race without imposing daily
cardinality on future source types. The compiler selects only
`conflict_status = 'none' AND is_current = 1`; adding `is_current` without that
reader change is not sufficient.

### Encryption, minimization, and idempotency

The normalized value is stored only in `context_signals.value_enc` under the
user DEK with AAD bound to the immutable crypto subject, column name, signal ID,
and key version. `value_json` remains null. The clear columns contain only the
contract-required source, consent, permission, freshness, timing, and routing
metadata.

Because the value vocabulary is low entropy, the canonical payload includes a
fresh 128-bit random hash salt that is stored only inside `value_enc`. The
`normalized_hash` is ordinary SHA-256 over a canonical object containing that
salt, the schema version, `USR-06`, local-date source window, source revision,
`observed_at`, `expires_at`, and every normalized value including explicit
nulls. It is rendered in the frozen `sha256:<hex>` content-hash shape. Rotation
re-encrypts the stable salt and value together, so it deliberately preserves the
hash without deriving hash behavior from whichever DEK is current.

`normalized_hash` is an evidence fingerprint, not a uniqueness or
supersession key. Migration drops `uq_context_signals_norm` and replaces it with
a non-unique evidence lookup index; the daily-current and revision indexes own
edit ordering. Thus low → high → low produces three valid immutable revisions.
An identical body under a new idempotency key is also an intentional edit; only
an exact replay of the original key is a deduplicated upsert.

The check-in's idempotency job stores the normalized request, server-derived
source window/timestamp, and returned signal projection under the user DEK.
Exact replay returns that projection without inserting or superseding again.
It also returns the frozen `201`, not a workflow status. Different input under
the same key returns `409 idempotency_conflict`.

The POST response is the frozen `ContextSignal` projection with a structured,
user-readable value over TLS. Ciphertext, nonces, and key versions are storage
details and are not returned.

### Freshness and retention

`expires_in_seconds` controls eligibility, not raw-data retention. Command
creation and execution compare the instant against `expires_at`; they never
depend solely on a cron-updated `freshness_status`. Once expired, a signal
cannot affect a new reading even if maintenance has not run.

That guarantee requires changes in both workspaces that currently omit the
instant. `ConstrainedContextSignalInput` in `packages/reading-engine` gains a
nullable `expires_at`; the engine rejects a non-null expiry at or before the
input `generation_anchor` even if `freshness_status` still says `fresh`.
`loadConstrainedContext()` selects `expires_at` and `is_current` and supplies the
field during command construction. At execution, the pinned-signal eligibility
query also selects `expires_at` and `is_current`, compares expiry with the actual
execution instant, and returns the validated expiry to the frozen engine input.
It does not rely on a cron status update or claim that the existing compiler is
already sufficient. Existing non-check-in inputs may keep a null expiry.

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

USR-06 permission governs whether the check-in may be stored and considered; it
does not itself authorize provider disclosure. The current `ai_synthesis` grant
must also include `enabled_personal_context` at command creation and execution.
Without that category, the check-in remains saved and available to the user but
is rejected before any provider packet is assembled.

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
“Available to the next eligible generation” only when the current
`ai_synthesis` grant includes `enabled_personal_context`. Otherwise it says the
check-in is saved but will not be sent to the reading publisher until Reading
generation permission includes personal context. Neither state implies that an
already-published reading was silently rewritten. A source-state race returns a
safe conflict while leaving the unsaved form values in the browser.

## Error and recovery contract

Every error uses the existing envelope and request ID. The public classes are
closed and actionable:

- `400` for malformed bodies, unsupported source documents, and missing or
  invalid idempotency keys;
- `401` for absent/invalid normal authentication or deletion receipt;
- `403 account_not_active` when account-state policy blocks a normal route;
- `404` for missing and differently owned resources alike;
- `409` for idempotency conflicts, concurrent state changes, inactive sources,
  `timezone_confirmation_required`, or exports that are not ready;
- `410 export_expired` for an expired artifact;
- `500` only for unexpected invariant failures or an invalid oversized stored
  artifact, with private detail confined to safe logs; and
- `503 object_storage_not_configured` when export storage is unbound before a
  reservation is accepted.

Export and deletion jobs classify transient D1/R2 failures for retry. No log,
audit event, queue message, or clear job metadata contains check-in values,
export JSON, birth data, or deletion reasons. Deletion does not report success
until R2 cleanup, row cleanup, and irreversible DEK destruction all succeed.

## Data migration

A forward migration `db/d1/0004_privacy_context.sql` and matching
`MIGRATIONS.json` entry will:

- rebuild `user_keys` so only deletion-erased rows may have a null
  `wrapped_dek`, while ordinary rotated rows retain their recovery bytes;
- add clear opaque `job_id` linkage, wrapped export-key, artifact-nonce, status
  timestamp, and safe error-class columns to `export_requests`;
- add clear opaque `job_id` linkage, receipt-hash, receipt-expiry, checkpoint,
  status timestamp, and safe error-class columns to `deletion_requests`;
- add `source_revision`, `is_current`, and `retention_expires_at` to
  `context_signals`, drop `uq_context_signals_norm`, add the non-unique evidence
  index, and add USR-06-scoped revision and partial daily-current unique
  indexes; and
- add the bounded indexes required by privacy outbox, expiry, deletion receipt,
  and retention sweeps.

The context migration does not assume an empty table. It deterministically
orders any existing USR-06 rows by `(observed_at, id)`, assigns revisions within
each `(user_id, source_id, source_window)`, and marks only the latest
non-conflicted row current; already superseded/conflicted rows remain
non-current. Other source families retain current-by-default behavior and are
not captured by the USR-06 uniqueness predicates. Existing rows have no
invented retention deadline; the new check-in writer always supplies one.

Making `wrapped_dek` nullable is not an `ALTER COLUMN` one-liner. The migration
keeps foreign-key enforcement on and first proves through `sqlite_master` that
no table has an inbound reference to `user_keys`. It creates a temporary table
with the original composite primary key plus nullable `wrapped_dek` and
`erased_at`, copies every live and retired row byte-for-byte with
`erased_at = NULL`, checks the copied count, drops and recreates `user_keys`
under its final name, copies back, drops the temporary table, and recreates
`uq_user_keys_active`. It deliberately avoids the rename-based rebuild hazard
documented in `0002`. Its check permits exactly these cases:

- live: `destroyed_at IS NULL`, `erased_at IS NULL`, wrapped bytes present;
- retired by rotation: `destroyed_at IS NOT NULL`, `erased_at IS NULL`, wrapped
  bytes present; or
- erased by deletion: `destroyed_at IS NOT NULL`, `erased_at IS NOT NULL`, and
  `wrapped_dek IS NULL`.

The remote precondition is the repository's live-D1 gate, not an empty-table
assumption: capture a D1 time-travel bookmark; produce a restricted full SQL
export and checksum; record table counts, `user_keys` schema/indexes, and
foreign-key state; rehearse the exact migration on a restored clone; then apply
with Wrangler migrations. Post-apply proof repeats counts and indexes, verifies
that no pre-existing row was marked erased or lost wrapped bytes, and requires
empty `PRAGMA foreign_key_check` plus `PRAGMA quick_check = 'ok'`.

`context_signals.value_enc` is already in `ENCRYPTED_COLUMNS` and explicitly
covered by `encrypted-columns.test.ts`; M6 does not move it from the unwritten
registry. Rotation tests add real written check-ins and prove both ciphertext
rotation and preservation of their salted evidence hashes. Migration smoke
tests run against a fresh database and an upgraded 0001+0002+0003 database with
non-empty live and retired `user_keys` rows. `MIGRATIONS.json.schema_version`
moves from `0.5.0` to `0.6.0`.

## Runtime configuration and production activation

`wrangler.toml` declares a `PRIVACY_QUEUE` producer and consumer with a distinct
DLQ in both the top-level development configuration and the named production
environment, because named environments do not inherit those bindings. The
four required remote resources are:

- `patternlike-privacy-dev` and `patternlike-privacy-dev-dlq`; and
- `patternlike-privacy` and `patternlike-privacy-dlq`.

They must exist before the first deploy containing those bindings. Queue
creation is deliberately a separate remote operation, so landing the config
before that gate makes `npm run deploy:api` fail on an unknown queue; the
implementation handoff must say so plainly rather than presenting the commit as
deployable by itself.

The existing scheduled handler gains bounded privacy lanes for undispatched
outbox delivery, expired-lease recovery, export expiry, and check-in retention.
Development exercises them under the top-level fifteen-minute cron. Production
currently has the deliberate override `crons = []`, so none of those recovery
lanes runs there. Production activation therefore requires a separate approved
configuration gate that replaces the empty production override with the
reviewed cadence and verifies the scheduled handler against production-shaped
bindings. Until that gate runs, export expiry still fails closed when read, but
retention and crash-before-dispatch recovery have no production runner and the
feature is not certified operationally complete.

## Verification and acceptance

### Contract and unit proof

- validate the untouched frozen M0 package and the new M6 amendment, schemas,
  valid fixtures, rejection fixtures, and OpenAPI paths;
- prove all state machines and exact-body idempotency branches;
- prove export section inclusion/omission, owner scoping, redaction, envelope
  encryption, key wrapping, AAD mismatch failure, and seven-day expiry;
- prove deletion order, resume checkpoints, R2 cleanup, publication race gates,
  tombstone scrubbing, deletion-only wrapped-key erasure, rotation recovery, and
  the single audit proof;
- prove registry-pinned USR-06 fields, consent-version transitions, source-state
  and enabled-state mappings, D1/wire/engine consent projections, check-in
  validation, low → high → low daily supersession, encrypted salt/hash behavior,
  DEK rotation, freshness at command and execute time, AI category exclusion,
  and retention purge; and
- introspect D1 foreign keys/user-owned tables and fail if the deletion manifest
  does not classify a newly introduced user-data table.

### Integration proof

- use the suite's real local D1 and real bound `ARTIFACTS` R2 for complete export
  and deletion journeys—no new R2 test double;
- add a paginated `exports/` cleanup helper to shared test setup/teardown, and
  add `connector_accounts`, `device_tokens`, and every migration-added table to
  the FK-safe D1 reset inventory, while never deleting `content-releases/`
  objects through the export helper;
- run duplicate and out-of-order queue deliveries and lease recovery;
- use two seeded users for every owner-isolation operation;
- request deletion during queued, running, and ready exports and during a
  reading generation race, including the exact case where export claim precedes
  deletion, deletion's R2 sweep finishes, and the stale worker attempts its PUT;
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
production deletion/portability evidence. In particular, queue creation and the
production cron activation above remain explicit external gates.

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
2. USR-06 source controls, check-in ingestion/retention, Today UI, compiler and
   `packages/reading-engine` expiry changes, publisher eligibility proof, and
   full regression verification.

The second slice may depend on privacy primitives from the first, especially
key destruction and deletion-manifest coverage. The first slice must not depend
on check-ins being present; its export schema already represents an empty
context collection truthfully.
