# Account Processing Consent and Frozen Account Recovery Design

Status: approved on 2026-08-28

Repository baseline: `52228edea7ebaceeb3172e4076a6764d89176ad2`

Scope: persisted `account_processing` consent, birth authorization, and
reversible account freeze/recovery

## Goal

Replace the web client's placeholder birth-consent identifier with one real,
append-only consent ledger. A birth calculation must be authorized by the exact
current grant before it can reserve spend or publish a chart. Withdrawing that
grant retains the account data but stops serving it by freezing the account;
granting the current policy again restores access.

Success means:

1. onboarding displays the current server-owned policy and obtains a real
   consent ID before submitting birth details;
2. an unknown, cross-user, revoked, expired, superseded, or stale-policy consent
   cannot authorize calculation;
3. the authorizing consent is queryable from `birth_profiles` without
   decrypting the profile payload;
4. revocation and regrant are idempotent, concurrency-safe account-state
   transitions; and
5. a frozen reader sees a usable recovery surface rather than an offline error.

## Existing authority and current gap

The frozen M0 consent vocabulary already includes `account_processing`, and
AST-01 defines the required Birth profile source with permission tier 0 and the
ordered allowed uses `chart_fact`, `cycle_detection`, and
`uncertainty_model`.

The approved Stream 0.4 decision settles the product behavior:

- revocation freezes the account;
- retained data becomes unserved rather than deleted;
- export, account deletion, and consent recovery remain available; and
- regrant is reversible.

The central `accountStateGate` already enforces the read-side boundary for
`users.status = 'frozen'`. The missing part is the durable writer that creates
that state. Today the birth route checks only that `consent_id` is non-empty,
the web sends `cns_local_web_0001`, and `birth_profiles` has no consent link.

M0 through M7 remain frozen. M8 is the additive consumer contract package and
owns the new resource.

## Design decisions

### One dedicated resource

The public resource is:

    GET    /v1/consents/account-processing
    PUT    /v1/consents/account-processing
    DELETE /v1/consents/account-processing

This follows the shipped AI-synthesis consent shape while keeping the two
permissions independent. It does not introduce a generic route on which a
client can choose an arbitrary consent kind, source, tier, or allowed-use set.

`apps/api/src/db/account-processing-consents.ts` is the primary state owner.
It owns current-state reads, append-only grant/revoke transitions, mutation
idempotency, account freeze/recovery, and the exact SQL predicate birth uses.
The existing AI, Pattern, source, and future geocoder consent owners retain
their current behavior.

### One server-owned policy

The launch policy identifier is:

    account-processing-v1-2026-08-28

The append-only registry in
`apps/api/src/policies/account-processing-policies.ts` maps that identifier
immutably to:

- kind: `account_processing`;
- source: `AST-01`;
- permission tier: `0`;
- allowed uses, in order: `chart_fact`, `cycle_detection`,
  `uncertainty_model`;
- no provider, connector account, or scopes; and
- the English disclosure and Pattern/Like policy links below.

The launch disclosure is:

> Pattern/Like uses the birth date, local birth time, accuracy choice, place
> label, coordinates, and timezone you submit to calculate your natal chart,
> timing cycles, and uncertainty. The API sends those values to Pattern/Like's
> calculation service; it does not send them to a generative model.
> Pattern/Like encrypts the submitted profile and retained birth fields under
> your account key while retaining the calculated chart facts needed by the
> product. Separate permissions govern generated readings, Your Pattern,
> research, and model training. You may withdraw this permission at any time.
> Withdrawal retains the account data but stops serving it by freezing the
> account; regrant, export, and account deletion remain available.

The response also supplies `/terms.html` and `/privacy.html`. The registry has
one separate current-policy pointer. Every policy ever issued keeps its exact
disclosure and links in that registry; an entry cannot be removed, edited, or
repointed after issuance. Contract fixtures pin every historical entry so a
future edit fails verification. A later material copy, purpose, field,
recipient, allowed-use, retention, or withdrawal change adds a new policy
identifier and moves only the current-policy pointer. An unknown or retired
policy version is never treated as an active grant.

The central account-state middleware owns a second, live read gate after its
existing lifecycle decision. Once this feature ships, an `active` account may
use an ordinary authenticated product route only when its exact latest
`account_processing` row is a live grant for the current registry policy. An
active account with no row, an expired row, a revocation, a retired policy, or
corrupted fixed fields receives `403 account_processing_required`. The gate
still permits explicitly enumerated recovery routes: the account-processing
resource, the already-shipped consent resources, and account export and
deletion. Sign out remains available on its existing route outside this gate.
The allow-list names exact consent paths; it does not use `/v1/consents/*` as
authority for unknown future mutations.

This gate is the policy-bump mechanism as well as the initial-launch fence. A
Worker release that moves the current-policy pointer immediately makes
old-policy accounts unserved before an ordinary route executes. Those accounts
remain `active`; PUT appends the current grant without an unrelated lifecycle
transition, after which the next live gate read succeeds. A policy bump must
ship the new immutable registry entry, current pointer, recovery UI, and gate
tests in the same Worker/static-asset release. It cannot be deployed as a
constant-only change that leaves reads gated only by `users.status`.

Research, model training, AI synthesis, Pattern generation, and geocoding are
separate permissions. This resource cannot create or imply any of them.

## Wire contract

### Current-state response

Every successful response from the three methods returns one closed M8
document:

```json
{
  "schema_version": "0.8.0",
  "kind": "account_processing",
  "source_id": "AST-01",
  "permission_tier": 0,
  "allowed_uses": [
    "chart_fact",
    "cycle_detection",
    "uncertainty_model"
  ],
  "provider": null,
  "scopes": [],
  "connector_account_id": null,
  "status": "granted",
  "consent_id": "cns_01JAMPLEACCOUNTCONSENT01",
  "account_status": "active",
  "regrant_will_restore_access": false,
  "policy_version": "account-processing-v1-2026-08-28",
  "granted_at": "2026-08-28T00:00:00.000Z",
  "ui_surface": "onboarding",
  "disclosure": {
    "text": "Pattern/Like uses the birth date, local birth time, accuracy choice, place label, coordinates, and timezone you submit to calculate your natal chart, timing cycles, and uncertainty. The API sends those values to Pattern/Like's calculation service; it does not send them to a generative model. Pattern/Like encrypts the submitted profile and retained birth fields under your account key while retaining the calculated chart facts needed by the product. Separate permissions govern generated readings, Your Pattern, research, and model training. You may withdraw this permission at any time. Withdrawal retains the account data but stops serving it by freezing the account; regrant, export, and account deletion remain available.",
    "links": {
      "patternlike_terms": "/terms.html",
      "patternlike_privacy": "/privacy.html"
    }
  }
}
```

The `not_granted` variant has `consent_id`, `granted_at`, and `ui_surface` set
to `null`. Every successful response reports the state at response time and
the post-operation `account_status` as `active` or `frozen`.
`regrant_will_restore_access` is true only for a frozen account whose latest
row proves an account-processing revocation; it is false for active accounts
and unexplained freezes. The document still returns the current server policy
and disclosure so a new or recoverable reader can make a fresh decision.

### Read

`GET` takes no body and returns the current live grant or the `not_granted`
variant. A grant is live only when the latest row in the user's
`account_processing` chain:

- has the requested user and kind;
- has `status = 'granted'` and a non-null `granted_at`;
- is unexpired;
- names the current supported policy; and
- contains the exact server-owned AST-01 tier, source, allowed-use, provider,
  connector, and scope values.

Latest-row ordering is `version`, then `created_at`, then `id`, matching the
existing consent implementation. The server never searches backward for an
older grant after a later revoke or unsupported grant.

### Grant or regrant

`PUT` requires:

- `Idempotency-Key`, 8 through 128 permitted characters under the shared
  validator;
- `X-Consent-UI-Surface: onboarding|privacy_center`; and
- an exact JSON object containing only
  `{"policy_version":"account-processing-v1-2026-08-28"}`.

A stale version returns `409 consent_policy_version_stale` without writing a
consent, account state, audit event, or idempotency success receipt.

If the exact current grant already exists, the operation returns that grant and
does not mint a duplicate consent row. Otherwise it appends a `granted` row
whose `version` is one greater than the latest row and whose
`supersedes_consent_id` names that row.

An active account remains active. A frozen account becomes active only when the
latest durable `account_processing` row is the revoked row the new grant
supersedes. A frozen account without that proof returns
`409 account_state_conflict`; a grant cannot clear an unexplained hold.
`pending_deletion` and `deleted` accounts are rejected by the central gate and
can never be revived here.

At this repository baseline, no runtime other than this feature creates a
frozen account. The unimplemented crypto-control plan proposes a different
freeze reason. That future work must add its own durable fence and extend this
activation predicate before it can write `users.status = 'frozen'`; this change
does not pre-build that separate state machine.

### Revoke

`DELETE` requires `Idempotency-Key` and
`X-Consent-UI-Surface: privacy_center`, and requires an empty body.

When the exact latest row is a grant, the mutation appends a `revoked` row that
supersedes it and changes `users.status` from `active` to `frozen` in the same
D1 transaction. The revocation row preserves the policy identity it revokes.
A concurrent newer grant makes the compare-and-swap fail; a stale delete can
never freeze a later grant.

Only an active account can acquire this consent-owned freeze. If an already
frozen account still has a latest granted row, DELETE returns
`409 account_state_conflict` without appending a revocation. That prevents an
unexplained hold from being converted into a revocation that a later regrant
could clear.

When the latest row is not `granted`, or no row exists, DELETE is a no-op
current-state read. It does not create an orphan revocation row or freeze a
fresh account that never granted processing. It still writes the successful
idempotency receipt, but no consent or account-state audit event. A replay does
not acquire new mutation authority and reports whatever state is current when
the replay is read.

Revocation does not mutate or delete birth profiles, charts, readings, Pattern
documents, keys, or sessions. The next authenticated request reloads the live
account status and the central gate stops ordinary product access.

### Idempotency and audit

Grant and revoke use distinct `jobs.job_type` values and the existing encrypted
`jobs.payload_enc` receipt pattern. The receipt contains the request
fingerprint, committed mutation outcome and consent ID, and any required
post-commit cursor refresh state; it contains no birth data. The response body
is not treated as a historical snapshot.

- same key, same operation, policy, and UI surface proves that the original
  outcome already committed, then reloads and returns the current resource
  document;
- the replay does not repeat an account transition or append another row;
- reuse with different input returns `409 idempotency_conflict`; and
- a distinct mutation racing on the same latest consent row returns
  `409 consent_conflict` unless its own receipt proves it committed.

The consent append, guarded account-state transition, encrypted mutation
receipt, and opaque audit records commit in one D1 batch. Changed mutations
write `consent.granted` or `consent.revoked`; status changes additionally write
`account.activated` or `account.frozen`. Audit detail classes identify only
`account_processing`; they contain no submitted profile or policy prose.

Revocation clears or suppresses the user's next reading cursor. Regrant runs
the existing deterministic cursor recomputation after the atomic state change.
The encrypted mutation receipt records an unfinished refresh so an idempotent
replay can complete it after a process interruption.

## Birth authorization and provenance

### Exact authorization predicate

There is one reusable SQL predicate for birth authorization. It requires:

- `users.id` is the authenticated user and `users.status = 'active'`;
- the supplied consent ID belongs to that user;
- it is the exact latest `account_processing` row;
- it is a granted, unexpired current-policy row; and
- its fixed AST-01 source, tier, allowed uses, provider, connector, and scopes
  match the server policy.

For an active account that passed the current-policy gate, an application-level
read gives a prompt `403 consent_invalid` when the submitted ID is not that
account's exact grant, before timezone resolution, profile-version allocation,
or budget preparation. An account with no live current-policy grant is refused
earlier by the central gate; a frozen account is refused by the lifecycle gate.
The same exact predicate is then asserted at the head of the D1 batch that
charges the birth reservation and creates or retries the profile/job. A read
alone is not authority because another session can revoke between the read and
the charge.

The D1 transaction is the reservation linearization point. If revocation
commits first, the assertion rolls the whole batch back: no charged reservation,
profile, job, or calculation call survives. If reservation commits first, that
attempt was authorized when it began.

The route checks the same predicate again immediately before invoking the
calculation service. If it has changed, the attempt is cancelled without making
the external call; the pending profile becomes `invalid`, the job becomes
`cancelled` with the opaque `consent_invalid` result class, and the reservation
remains charged. The reservation transaction is the budget boundary, so a
later state change never refunds it.

Because an external call cannot be one transaction with D1, the
chart-publication batch reasserts the predicate a final time. If revocation wins
while calculation is running, no active chart or profile is published; the same
invalid/cancelled settlement applies and the already charged calculation stays
charged. If publication commits first, a later revocation freezes the account
and immediately makes the newly retained result unserved.

### Idempotent birth retries

A terminal succeeded or in-flight birth job may return its ordinary duplicate
or running response before consent validation because that caller performs no
new processing. A failed-job retry must revalidate the consent pinned in its
encrypted command before it can reserve another attempt.

The encrypted `BirthCalcCommandV1` already pins the submitted consent ID and
its request comparator treats a different ID as different input. After revoke
and regrant, an old failed birth key cannot be resumed under the new grant. The
web starts a new birth intent and idempotency key instead.

### Queryable link

Migration `0018_account_processing_consent.sql` adds:

    birth_profiles.consent_id TEXT REFERENCES consents(id)

The column is nullable so existing profiles remain truthful: `NULL` means the
queryable authorization provenance was not recorded, not that a grant is being
assumed retroactively. No backfill decrypts or trusts legacy placeholder IDs.
Every new profile insert, including failed-job retry inserts, writes the
command's exact consent ID.

The foreign key establishes row existence. Same-user ownership, kind, status,
policy, and latest-version integrity are enforced by the atomic birth
predicate; SQLite cannot express those cross-row conditions as a column CHECK.
Tests prove no writer can link another user's consent.

`chart_snapshots` does not gain a duplicate consent column. Its existing
`(user_id, profile_version)` relationship reaches the authorizing profile in
one join.

The migration is forward-only and updates `db/d1/MIGRATIONS.json` plus the
clean and populated migration harnesses. It must be applied before Worker code
that reads or writes the new column. This design reserves the actual next
manifest number, `0018`; unimplemented crypto, place, history, and Pattern
plans that pre-reserved stale numbers must rebase on the manifest before their
migrations are implemented. Two different `0018` files are never allowed.

## Web behavior

### Onboarding and correction

Onboarding reads the account-processing resource and renders the server-returned
policy version, disclosure, and links in step 3. An unreadable policy disables
final submission; the checkbox never stands in for a persisted grant.

On final confirmation the form:

1. holds one grant idempotency key for the visible intent;
2. PUTs the displayed policy with UI surface `onboarding`;
3. requires the returned state to be `granted` with a non-null consent ID; and
4. submits that exact ID in the birth request.

The grant happens only at final submit, so abandoning steps 1 through 3 creates
no consent row. If birth subsequently fails, the explicit grant remains. A
retry reuses or observes the current grant rather than minting another row.
Chart correction uses the same sequence and normally receives the existing
grant without a ledger append.

`onboardingConsentId`, `VITE_CONSENT_ID`, and their tests/types are removed.
`403 consent_invalid` is distinct from form validation: the form refreshes the
current policy, clears stale mutation/birth intent keys, and asks for a fresh
confirmation.

### Privacy and withdrawal

`PrivacyView` gains one account-processing panel beside the other consent
owners. It renders three honest read states: granted, not granted, and unknown.
Withdrawal requires an explicit confirmation that the account will freeze and
that retained data will stop being served. Successful DELETE immediately tells
`App` to enter the frozen state; the browser does not probe ordinary routes to
discover what the mutation just did.

### Frozen recovery

The frozen experience renders outside `AppShell`, because every ordinary shell
destination is gated. It contains:

- the current account-processing policy and a regrant action;
- account export controls;
- account deletion controls; and
- sign out.

On a cold load, `GET /v1/chart` returning `403 account_not_active` or
`403 account_processing_required` triggers a read of the account-processing
resource. A response with `account_status: "frozen"` and
`regrant_will_restore_access: true` opens consent recovery. A frozen response
with that flag false offers export, deletion, and sign out without claiming
that regrant can clear the hold. If the consent read is also rejected, the
account is pending deletion, deleted, or otherwise unavailable; the UI does
not call it a consent freeze. An active `not_granted` response opens onboarding
or current-policy reconfirmation rather than calling the account frozen.

Successful regrant reloads the chart and returns to the ordinary app. Existing
retained data becomes visible again; regrant does not recalculate or rewrite
the chart.

## Error behavior

| Status | Code | Meaning and client action |
|---|---|---|
| 400 | `missing_idempotency_key` | Mutation has no valid key |
| 400 | `invalid_json` / `invalid_body` | Body, empty-DELETE rule, or UI surface is invalid |
| 401 | `unauthorized` | No valid reader session |
| 403 | `consent_invalid` | Birth does not name the exact current grant; refresh and reconfirm |
| 403 | `account_not_active` | Central account lifecycle gate refused the route |
| 403 | `account_processing_required` | Active account lacks the current processing grant; open onboarding or reconfirmation |
| 409 | `consent_policy_version_stale` | Reload and display the current server policy |
| 409 | `idempotency_conflict` | One key was reused for different mutation input |
| 409 | `consent_conflict` | Latest consent changed concurrently; retry with a new read |
| 409 | `account_state_conflict` | A frozen state is not proven to belong to this revocation |
| 503 | existing safe envelope | Storage or crypto dependency is unavailable |

Birth-ID validation never distinguishes unknown, cross-user, malformed, or
superseded IDs when the account otherwise passes the current-policy gate. They
become `consent_invalid` with the request ID. Missing, expired, revoked, or
retired latest grants are intercepted by the account policy or lifecycle gate
without exposing the rejected row.

## Contracts and implementation boundaries

M8 gains:

- `account-processing-consent.schema.json` with grant request, disclosure,
  UI-surface, account-recovery, and current-state definitions;
- valid granted/not-granted fixtures and invalid wrong-source,
  wrong-allowed-use, missing-consent-ID, and stale-policy fixtures;
- manifest and closed validator-inventory updates;
- OpenAPI GET/PUT/DELETE paths and components; and
- the missing documented `403` response on `POST /v1/birth-profiles`.

`packages/shared` exports the exact M8 constants and TypeScript wire types.
Contract tests prove the ordered uses and immutable disclosure match the schema.

M0 through M7 files, `$id` values, hashes, fixtures, and required fields remain
byte-unchanged.

## Security and privacy properties

- Only an authenticated account can read or mutate its resource.
- A consent ID is never sufficient authority without exact user ownership and
  latest-state checks.
- The client can echo only the policy version and UI surface; it cannot choose
  kind, source, tier, allowed uses, provider, scopes, status, or timestamps.
- Consent and account transitions are append-only/CAS operations, not updates
  to the meaning of an old grant.
- Mutation receipts use the already-registered encrypted `jobs.payload_enc`
  column, so no new encrypted-column rotation registration is needed.
- Safe logs and audit events contain only request/event classes and opaque IDs.
  They never contain birth inputs, policy prose, ciphertext, or rejected IDs.
- Export already includes the consent ledger and account state. Legacy profile
  links remain nullable and are not fabricated.
- Account deletion remains the only operation that destroys retained data;
  consent withdrawal never calls deletion or key shredding.

## Testing strategy

Implementation follows test-driven development.

Contract tests cover the new schema, fixtures, OpenAPI projection, immutable
policy constants, and frozen predecessor hashes.

Database and route tests cover:

- first grant, current-grant no-op, revoke, regrant, and exact version chains;
- encrypted idempotency replay, current-state reload after an intervening
  mutation, and differing-input conflicts;
- concurrent grant/grant, revoke/revoke, and revoke/regrant serialization;
- atomic account freeze/recovery and guarded unexplained-frozen behavior;
- current-state `account_status` and `regrant_will_restore_access` truth;
- stale policy, expiry, fixed-field corruption, and no fallback to old grants;
- current-policy gating for missing, expired, revoked, corrupted, and retired
  latest rows, including exact recovery-route enumeration;
- audit events and cursor refresh recovery;
- frozen account access to consent, export, and deletion only; and
- pending/deleted accounts never reactivating.

Birth integration tests cover:

- unknown, cross-user, wrong-kind, superseded, and malformed submitted IDs
  returning `403 consent_invalid` for an otherwise currently granted account;
- missing, revoked, expired, corrupted, and retired latest grants being stopped
  by the central gate before the birth handler;
- rejection before timezone resolution, version allocation, spend reservation,
  profile/job creation, and calculation invocation;
- a revoke that wins the reservation race leaving no charged work;
- a revoke that wins the publication race leaving no active chart/profile;
- publication that wins before revoke becoming retained but unserved;
- the exact consent ID on initial and retry profile rows;
- old failed commands refusing a newly regranted consent ID; and
- succeeded idempotency replay performing no new processing.

Migration tests cover a clean database and a populated database with legacy
profiles and charts. Existing rows survive byte-for-byte apart from the new
`NULL` column, the foreign key is healthy, and new linked rows survive the
normal migration harness.

Web tests cover policy loading, disabled unreadable state, grant-before-birth
ordering, returned-ID use, stale-policy and `consent_invalid` recovery, privacy
confirmation, immediate frozen transition, cold-load recovery, regrant reload,
export/delete availability, and keyboard/screen-reader status behavior.

Focused lanes run during development. Before completion, run the pinned-Node
full typecheck, tests, build, and `npm run ci:local`; preserve its paste-ready
summary as the local merge evidence because hosted GitHub Actions cannot run.

## Delivery and rollout

This implementation produces local commits only. It does not apply a remote D1
migration, merge to `main`, or deploy a Worker.

The eventual production order is mandatory:

1. take the documented D1 backup/bookmark and rehearse the populated migration;
2. apply `0018_account_processing_consent.sql` remotely;
3. build the web assets and deploy the Worker/static-asset bundle that reads and
   writes `birth_profiles.consent_id` and stops emitting the placeholder; and
4. verify grant, birth, revoke/freeze, export, delete, and regrant on a dedicated
   account without logging private input.

Rollback is a forward-deployed compatibility release, not restoration of the
pre-feature bundle. Once any revocation can freeze an account, every rollback
target must retain the account-processing GET/PUT recovery contract, immutable
policy registry, live read gate, and frozen recovery UI so those users can
regrant. It may disable new birth submission or restore other Worker/web
behavior before any schema decision, but it cannot strand a consent-owned
freeze behind a Worker with no recovery route. The nullable additive column
and append-only ledger rows remain readable and do not require destructive
rollback.

## Out of scope

- Generic arbitrary-kind consent creation.
- Changes to AI-synthesis, Pattern-generation, source, or geocoder consent.
- Deleting data on consent withdrawal.
- Adding `chart_snapshots.consent_id`.
- Backfilling legacy placeholder consent IDs.
- Implementing the crypto operator freeze or another future hold system.
- Applying migrations, merging, or deploying production in this work.
- Administrator authorization and Pattern invariant-kernel PR3/PR4; those are
  the next separately designed and planned subprojects.

## Acceptance criteria

The slice is complete when all of the following are true:

1. no production or development web path can submit the placeholder consent ID;
2. every newly created birth profile links to the exact current grant;
3. invalid consent cannot reserve spend or invoke calculation;
4. consent revoked during calculation cannot publish an active chart;
5. revocation atomically freezes future product access without deleting data;
6. regrant atomically restores only a proven account-processing freeze;
7. frozen readers can regrant, export, delete, or sign out from a truthful UI;
8. frozen M0-M7 contracts remain unchanged; and
9. focused verification and the complete local CI gate pass on the final commit.
