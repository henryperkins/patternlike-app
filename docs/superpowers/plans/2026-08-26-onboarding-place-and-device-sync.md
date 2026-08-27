# Onboarding Place and Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual preference and coordinate friction while keeping birthplace resolution trustworthy, private, accessible, and visible in chart uncertainty.

**Architecture:** A best-effort foreground synchronizer writes browser timezone/locale as `device_derived` and triggers Today to retry after settlement. Place autocomplete calls an authenticated, rate-limited Worker composite adapter; Places Autocomplete (New) supplies transient city suggestions and Geocoding API v4 resolves only the selected Google Place ID. The narrowed selection is cached in a short-lived user-DEK-encrypted D1 row. Birth creation treats that owner-scoped resolution as authority, combines its confidence with historical timezone confidence, passes closed location metadata to calc, and renders the resulting qualifications.

**Tech Stack:** React 19, TypeScript strict ESM, Hono, Cloudflare Workers Rate Limiting binding, D1, Web Crypto, composite Google Places Autocomplete (New) + Geocoding API v4 adapter (`google_places_geocoding_v4`), Vitest/Testing Library/workerd, JSON Schema/OpenAPI

## Global Constraints

- Preserve existing M3 preference routes and server lock semantics.
- Sync only after the Worker session is known to be valid.
- A `user_confirmed` preference always outranks `device_derived`; `409 preference_locked` is a successful no-op for foreground sync.
- Keep at most one pending device-preference attempt containing both normalized
  values and both idempotency keys. Conflict retries and later retries with the
  same normalized values after an unavailable result keep the exact keys and
  bodies. Changed normalized values supersede the stale unconfirmed intent and
  mint a fresh pair; the mounted synchronizer never returns to a superseded
  pair. A fully settled attempt retires its pair, so the next foreground
  attempt mints fresh keys even when the device values are unchanged; an
  unauthorized result clears the current pending attempt before another
  account or session can use it.
- Retain succeeded automatic `web-device-*` preference jobs for 35 days, then
  prune them through bounded privacy maintenance. Never prune manual
  idempotency records through that lane.
- The approved provider and rights constraints are frozen in
  [`docs/decisions/2026-08-26-geocoder-provider.md`](../../decisions/2026-08-26-geocoder-provider.md).
  Implementation remains pending; there is no runtime provider fallback.
- The composite passes under both billing-account regimes: non-EEA Geocoding
  §6.3.2 and EEA Geocoding §6.2.2 permit the selected direct-user cache, while
  non-EEA Places §14.3 and EEA Places §15.4 reject account-lifetime Places
  coordinates. EEA permitted use (1) expressly permits address lookup and
  autocompletion. Record `EEA` or `non-EEA` for the billing account before
  provisioning; approval is not conditional on which regime applies.
- Autocomplete sends the raw query only in the JSON body of `POST
  https://places.googleapis.com/v1/places:autocomplete`. Selected resolution
  uses `GET
  https://geocode.googleapis.com/v4/geocode/places/{PLACE_ID}` because
  Geocoding v4 requires the opaque, provider-generated Place ID in that path.
  It is the only permitted dynamic provider URL component.
- Raw query, label, coordinates, locale, birth date/time, user/account/profile
  identifiers, credentials, and provider response content never enter URLs,
  logs, analytics, or audit detail. D1 receives no query, suggestion, or raw
  provider payload; its only provider-derived content is the selected,
  app-owned projection encrypted under the user's DEK.
- Search sends no user/account/birth identifier, coordinate, device location,
  location bias, or app-owned `sessionToken`. There is no browser-to-Google
  call.
- Places suggestions are transient and never persisted. Only the selected
  Geocoding v4 `formattedAddress`, `location`, `granularity`, `types`, and
  address components may be read, then immediately narrowed field-by-field.
- Map durable fields exactly: `label = formattedAddress`, `latitude =
  location.latitude`, and `longitude = location.longitude`. Confidence and
  qualifier mapping remains the closed mapping below.
- Keep the Worker secret `GOOGLE_MAPS_PLATFORM_API_KEY` server-side. Send it
  only in `X-Goog-Api-Key`, never in a URL or body, and API-restrict the key to
  Places API (New) and Geocoding API.
- Reuse consent source `AST-02` as `kind = "product_source"` with permission
  tier 0, allowed uses exactly `["chart_fact","timezone_resolution"]`,
  provider `google_places_geocoding_v4`, empty scopes, no connector account,
  and policy `google-places-geocoding-v4-2026-08-26`. Do not create a
  `context_source_permissions` or `context_signals` row.
- `GEOCODER_ROLLOUT` is a closed non-secret `off|enabled` var committed `off`
  in development and production. Off means grant/search/resolve return generic
  `503 geocoder_unavailable` and make no Google call; GET may expose current
  policy/state, and DELETE remains available for revocation.
- Public Terms and Privacy must carry the Google flow-down and
  independent-controller disclosure in the ADR. The adjacent disclosure and
  express, prior, revocable consent gate must be complete before the first
  query; declining or revoking leaves manual entry available.
- Show required Google attribution with live suggestions and every displayed
  stored selected result, with visible contrast, Google content visually
  distinct from manual content, accessible name exactly `Google Maps`,
  official asset size/aspect-ratio/clear-space rules, `translate="no"` on text
  attribution, and every supplied third-party attribution.
- Before enablement, set project quotas to 120 Places Autocomplete requests per
  minute and 30 Geocoding v4 requests per minute, plus a monthly USD 50 Google
  Maps budget with alerts at 50%, 75%, 90%, and 100%. Quotas are rate ceilings,
  budget alerts are advisory rather than hard caps, and the production
  operator owns verification.
- Preserve manual place label, coordinates, and IANA-zone entry as a complete fallback.
- A provider candidate id is short-lived transport identity. The durable `place_id` is an app-minted `plc_` id.
- Persist selected place label/coordinates/provider confidence only as user-DEK ciphertext.
- Add `place_resolutions.payload_enc` to `ENCRYPTED_COLUMNS` in the same commit that creates its writer.
- Birth creation ignores client label/coordinates when a valid `place_id` is present and uses the decrypted server resolution.
- Expired selected-place cache rows are pruned globally in bounded privacy maintenance; a failed birth retry reuses its original encrypted normalized profile rather than depending on an expired cache row.
- Existing M0 qualification enums stay frozen; location uncertainty uses `qualification: "technique_specific"` with stable feature ids.
- Do not add location confidence to the chart fingerprint; it qualifies interpretation without changing the astronomical calculation.
- The autocomplete follows the ARIA combobox pattern and preserves keyboard/manual operation.

## File Map

- `apps/web/src/lib/device-preference-sync.ts`: one in-flight foreground sync with one supersedable pending attempt.
- `apps/api/src/services/privacy-maintenance.ts`: bounded retention for settled automatic preference jobs.
- `apps/api/src/services/geocoder/*`: narrow provider boundary and confidence policy.
- `apps/api/src/routes/places.ts`: authenticated search/resolve routes.
- `apps/api/src/db/place-resolutions.ts`: encrypted selected-result cache.
- `apps/web/src/components/PlaceAutocomplete.tsx`: accessible combobox.
- `apps/api/src/services/location-uncertainty.ts`: confidence combination and closed calc metadata.
- `apps/calc-stub/src/engine.ts`: uncertainty qualification.
- `db/d1/0018_place_resolutions.sql`: short-lived selected-place cache.

---

### Task 1: Sync device-derived preferences on sign-in and foreground

**Files:**
- Create: `apps/web/src/lib/device-preference-sync.ts`
- Create: `apps/web/src/lib/device-preference-sync.test.ts`
- Modify: `apps/web/src/lib/device.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/TodayView.tsx`
- Modify: `apps/web/src/components/TodayView.test.tsx`
- Modify: `apps/api/src/routes/preferences.test.ts`
- Modify: `apps/api/src/services/privacy-maintenance.ts`
- Modify: `apps/api/src/services/privacy-maintenance.test.ts`

**Interfaces:**
- Produces: `DevicePreferenceSynchronizer`.
- Consumed by: `App`.

- [ ] **Step 1: Write failing synchronizer tests**

Cover:

- Timezone and locale are sent with `source: "device_derived"`.
- A second settled attempt with the same normalized values uses fresh
  idempotency keys.
- An unavailable attempt retries with the same keys and bodies.
- Changed values receive new keys.
- `A -> B -> A` after settled attempts gives the second A a fresh key.
- Partial/unavailable A followed by settled B supersedes A, so returning to A
  also mints a fresh pair instead of replaying the abandoned intent.
- Concurrent triggers share one in-flight promise.
- `preference_locked` is classified as settled, not failed.
- `401` remains distinguishable so `App` can sign out.
- One `preference_conflict` retries once with the same key/body.
- Other network/5xx failures settle as best-effort failures.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm exec -w @patternlike/web -- vitest run src/lib/device-preference-sync.test.ts src/App.test.tsx
```

Expected: missing synchronizer/foreground calls.

- [ ] **Step 3: Implement the synchronizer**

Expose:

```ts
export type DevicePreferenceSyncResult =
  | { status: "settled" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

export class DevicePreferenceSynchronizer {
  sync(signal?: AbortSignal): Promise<DevicePreferenceSyncResult>;
}
```

The instance owns one pending pair:

```ts
private pending: {
  timezone: string;
  locale: string;
  timezoneKey: string;
  localeKey: string;
} | null = null;
private inFlight: Promise<DevicePreferenceSyncResult> | null = null;
```

Canonicalize locale with `Intl.getCanonicalLocales` and use the existing device fallbacks. Call both PUTs with `Promise.allSettled`; no single preference failure suppresses the other.

If sampled values match `pending`, reuse its exact keys and bodies. If either
normalized value differs, replace `pending` with a newly keyed pair before
writing; this supersedes the stale intent, which must never be reused by that
mounted synchronizer. Retain the current pair after `unavailable`, including
when one write succeeded. Clear that exact pair after `settled` or
`unauthorized`. Conflict retries reuse the current pair's key and body.

- [ ] **Step 4: Trigger from `App` and re-arm Today**

Create one synchronizer in `useRef`. Once `authState.status === "signed-in"`:

1. Sync immediately.
2. Sync when `document.visibilityState` becomes `visible`.
3. Increment `preferenceSyncRevision` after every settled attempt.
4. Set signed-out on an unauthorized result.

Pass the revision into `TodayView`. Include it in Today’s load-effect dependencies so an initial `timezone_confirmation_required` or `locale_confirmation_required` response is retried after device sync settles. Keep `PreferenceConfirm` as the fallback for unavailable sync and as the explicit override path.

- [ ] **Step 5: Update the device-source comment**

Replace the stale “never something to send” claim in `lib/device.ts` with the actual rule: automatic writes are marked `device_derived` and remain subordinate to user choice.

- [ ] **Step 6: Run focused verification**

```bash
npm exec -w @patternlike/web -- vitest run src/lib/device-preference-sync.test.ts src/App.test.tsx src/components/TodayView.test.tsx
npm exec -w @patternlike/api -- vitest run src/routes/preferences.test.ts src/services/privacy-maintenance.test.ts
npm run typecheck -w @patternlike/web
npm run typecheck -w @patternlike/api
```

Expected: all pass; server regression tests still prove locked/no-op semantics,
distinct automatic keys converge `A -> B -> A`, and bounded maintenance prunes
only eligible succeeded `web-device-*` preference jobs older than 35 days.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/device-preference-sync.ts apps/web/src/lib/device-preference-sync.test.ts apps/web/src/lib/device.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/TodayView.tsx apps/web/src/components/TodayView.test.tsx apps/api/src/routes/preferences.test.ts apps/api/src/services/privacy-maintenance.ts apps/api/src/services/privacy-maintenance.test.ts docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md
git commit -m "web: sync device preferences on foreground"
```

---

### Task 2: Complete the geocoder rights, privacy, and provider decision

**Status:** The repository owner explicitly supplied product/privacy/legal
approval in this Cursor implementation session on 2026-08-26. Implementation
remains pending. See
[`docs/decisions/2026-08-26-geocoder-provider.md`](../../decisions/2026-08-26-geocoder-provider.md).

**Files:**
- Create: `docs/decisions/2026-08-26-geocoder-provider.md`
- Modify: `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md`
- Modify: `docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md`

- [x] **Step 1: Evaluate the assumed Google Places API (New)**

Record dated primary-source evidence for:

- Autocomplete, Place Details, and Geocoding v4 API/field-mask shapes;
- storage/caching rights for selected label, latitude, longitude, and confidence;
- deletion/retention obligations;
- DPA, data residency, subprocessors, and whether query text is used for provider training;
- global locality coverage, quotas, latency, cost controls, and SLA;
- required attribution in the autocomplete and stored-result UI.

- [x] **Step 2: Apply the hard gate**

The provider passes only if Pattern/Like may:

1. send the user-entered query from its Worker;
2. return suggestions to that user;
3. retain the selected normalized label and coordinates in the encrypted birth profile for the account lifetime;
4. retain no unselected query/result payload;
5. delete selected data with the account.

If any condition fails, reject the provider. The next choice must satisfy the same gate; a bundled gazetteer is preferred over violating a service term.

- [x] **Step 3: Freeze the app-owned provider contract**

Regardless of provider, the decision accepts this internal boundary:

```ts
export interface GeocoderProvider {
  search(input: {
    query: string;
    locale: string | null;
    sessionToken: string;
    signal: AbortSignal;
  }): Promise<ProviderPlaceCandidate[]>;
  resolve(input: {
    candidateId: string;
    locale: string | null;
    sessionToken: string;
    signal: AbortSignal;
  }): Promise<ResolvedProviderPlace>;
}
```

The document names the selected adapter, secret names, attribution, confidence mapping, and permitted persisted fields. It contains no undecided alternatives when approved.

- [x] **Step 4: Review and commit the decision**

The approval covers both governing regimes: non-EEA Geocoding §6.3.2/Places
§14.3 and EEA Geocoding §6.2.2/Places §15.4 plus the EEA address
lookup/autocompletion permitted use. The composite
`google_places_geocoding_v4` decision differs from the plan's former pure
Places/Place Details assumption, so this decision commit replaces every
provider-specific item in the plan: tech stack, constraints, adapter/test
filenames, `place_resolutions.provider` CHECK, secret/config names, endpoints,
methods, headers, field masks, field mapping, attribution/disclosure,
confidence mapping, and verification commands. There is no runtime fallback
through the rejected pure-Places shape.

```bash
git add docs/decisions/2026-08-26-geocoder-provider.md docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md
git commit -m "docs: decide birthplace geocoder provider"
```

---

### Task 3: Freeze M8 place search and resolution contracts

**Files:**
- Create: `contracts/m8/common.schema.json`
- Create: `contracts/m8/place-search.schema.json`
- Create: `contracts/m8/place-resolution.schema.json`
- Create: `contracts/m8/geocoder-consent.schema.json`
- Create: `contracts/m8/openapi/openapi.yaml`
- Create: `contracts/m8/fixtures/valid/place-search.results.json`
- Create: `contracts/m8/fixtures/valid/place-resolution.high-confidence.json`
- Create: `contracts/m8/fixtures/valid/geocoder-consent.granted.json`
- Create: `contracts/m8/fixtures/valid/geocoder-consent.not-granted.json`
- Create: `contracts/m8/fixtures/invalid/place-search.query-too-short.json`
- Create: `contracts/m8/fixtures/invalid/place-resolution.extra-provider-field.json`
- Create: `contracts/m8/fixtures/invalid/geocoder-consent.wrong-source.json`
- Create: `contracts/m8/fixtures/invalid/geocoder-consent.wrong-allowed-use.json`
- Create: `contracts/m8/fixtures/invalid/geocoder-consent.unknown-policy.json`
- Create: `contracts/m8/fixtures/invalid/geocoder-consent.extra-field.json`
- Create: `contracts/m8/SCHEMA_MANIFEST.json`
- Modify: `contracts/validate_schemas.py`
- Create: `packages/shared/src/m8-place-types.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: public types used by Tasks 4 and 5.

- [ ] **Step 1: Write failing schema/fixture/OpenAPI validation**

The contract is:

```ts
export interface PlaceSearchRequest {
  query: string; // trimmed, 2..120 Unicode code points
  locale?: string | null;
  session_token: string; // app-generated UUID, 8..128 chars
}

export interface PlaceSearchCandidate {
  candidate_id: string; // provider transport id, 1..512 chars
  primary_label: string;
  secondary_label: string | null;
}

export interface PlaceSearchResponse {
  schema_version: "0.8.0";
  candidates: PlaceSearchCandidate[]; // max 8
}

export type PlaceConfidence = "high" | "medium" | "low";

export interface PlaceResolutionResponse {
  schema_version: "0.8.0";
  place_id: string; // plc_<32 hex>
  label: string;
  latitude: number;
  longitude: number;
  geocode_confidence: PlaceConfidence;
  qualifiers: Array<{
    code: "approximate_match" | "region_level_match";
    message: string;
  }>;
}

export const GEOCODER_CONSENT_POLICY_VERSION =
  "google-places-geocoding-v4-2026-08-26" as const;

export const GEOCODER_CONSENT_DISCLOSURE_TEXT =
  "Google birthplace search is optional. If you enable it, Pattern/Like sends the city or place text you type and your language preference (when available) to Google Places Autocomplete. After you choose a suggestion, Pattern/Like sends only Google's opaque Place ID to Google Geocoding. Pattern/Like does not send your birth date or time, coordinates or device location, Pattern/Like user, account, birth-profile, or consent identifiers, or the app-owned search session token. Google receives these requests, Pattern/Like's project credential, and network metadata such as the Worker IP. Google acts as an independent controller and may retain and use information it receives, including search terms and IP addresses, to provide and improve Google products and services; the reviewed terms do not promise to exclude model training. Pattern/Like does not store your query or unselected suggestions. It encrypts the selected formatted address, coordinates, confidence, and qualifiers under your account key and deletes that data with your Pattern/Like account, but account deletion does not delete Google's separately controlled records. You can decline or withdraw this permission and enter the place, coordinates, and time zone manually." as const;

export interface GeocoderConsentResponse {
  schema_version: "0.8.0";
  kind: "product_source";
  source_id: "AST-02";
  permission_tier: 0;
  allowed_uses: ["chart_fact", "timezone_resolution"];
  provider: "google_places_geocoding_v4";
  scopes: [];
  connector_account_id: null;
  status: "granted" | "not_granted";
  policy_version: typeof GEOCODER_CONSENT_POLICY_VERSION;
  granted_at: string | null;
  ui_surface: "onboarding" | "privacy_center" | null;
  disclosure: {
    text: typeof GEOCODER_CONSENT_DISCLOSURE_TEXT;
    links: {
      patternlike_terms: "/terms.html";
      patternlike_privacy: "/privacy.html";
      google_maps_terms: "https://maps.google.com/help/terms_maps/";
      google_privacy: "https://policies.google.com/privacy";
    };
  };
}
```

`POST /v1/places/search` accepts `PlaceSearchRequest`; `POST
/v1/places/resolve` accepts `{ candidate_id, locale?, session_token }`. The
app-owned request shapes stay provider-neutral. `GET /v1/consents/geocoder`,
`PUT /v1/consents/geocoder`, and `DELETE /v1/consents/geocoder` expose the
versioned, revocable provider consent. `PUT` accepts only
`{ policy_version: "google-places-geocoding-v4-2026-08-26" }`; an old,
unknown, or future value is `409 consent_policy_version_stale`. `PUT` and
`DELETE` require `Idempotency-Key` and the closed
`X-Consent-UI-Surface: onboarding|privacy_center` header; `DELETE` has an empty
body. The client never submits disclosure text or links. Document `400`, `401`,
`403`, `409`, `429`, and `503`.

- [ ] **Step 2: Run contracts and verify RED**

```bash
npm run test:contracts
```

- [ ] **Step 3: Add closed schemas, fixtures, shared types, and manifest**

M8 records exact predecessor hashes and describes these endpoints as additive.
`geocoder-consent.schema.json` is closed with `additionalProperties: false` at
every object level. It pins every literal above with `const`, pins
`allowed_uses` as a two-item ordered tuple and `scopes` as an empty tuple, and
uses `oneOf` so `granted` requires an RFC 3339 `granted_at` and non-null
`ui_surface`, while `not_granted` requires `granted_at: null`. Its disclosure
text and four links are server-owned `const` values, not free-form strings.

The valid fixtures are exactly `geocoder-consent.granted.json` and
`geocoder-consent.not-granted.json`. Rejection coverage is exactly:

- `geocoder-consent.wrong-source.json`: `source_id` is not `AST-02`;
- `geocoder-consent.wrong-allowed-use.json`: the ordered two-use tuple differs;
- `geocoder-consent.unknown-policy.json`: the policy is not the current
  server-mapped version; and
- `geocoder-consent.extra-field.json`: an undeclared response or nested
  disclosure field is present.

The provider name appears only on the consent response, where the user must
know which independent controller is authorized. It does not appear on search
or resolution responses. Provider ids beyond `candidate_id`, score, raw address
components, and attribution metadata are not on the product wire.

- [ ] **Step 4: Verify and hand the open M8 package to the reading plan**

```bash
npm run test:contracts
npm test -w @patternlike/shared
npm run typecheck -w @patternlike/shared
```

Do not commit or freeze the partial M8 package here. Continue with
`2026-08-26-reading-history-and-save.md` Task 1, add the birth `429`, then use
the umbrella plan’s single M8 commit.

---

### Task 4: Add encrypted selected-place storage

**Files:**
- Create: `db/d1/0018_place_resolutions.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Modify: `contracts/smoke_check.py`
- Create: `apps/api/src/db/place-resolutions.ts`
- Create: `apps/api/src/db/place-resolutions.test.ts`
- Modify: `apps/api/src/db/users.ts`
- Modify: `apps/api/src/db/encrypted-columns.test.ts`
- Modify: `apps/api/src/db/crypto-write-fence.test.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`
- Modify: `apps/api/src/services/privacy-maintenance.ts`
- Modify: `apps/api/src/services/privacy-maintenance.test.ts`

**Interfaces:**
- Produces: `storePlaceResolution`, `loadPlaceResolution`.
- Consumed by: Tasks 5 and 7.

- [ ] **Step 1: Write failing migration, encryption, ownership, expiry, and lifecycle tests**

Prove ciphertext cannot be moved between users/rows, foreign ids return null, expired rows are refused, selected normalized fields round-trip, rotation re-encrypts the new column, and deletion removes it.
Also prove an in-flight place resolution sealed under the old key cannot commit
after `users.crypto_write_fence` is set.

- [ ] **Step 2: Add migration 0018**

```sql
CREATE TABLE place_resolutions (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'plc_[0-9a-f]*' AND length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google_places_geocoding_v4')),
  policy_version TEXT NOT NULL,
  payload_enc BLOB NOT NULL,
  payload_key_version INTEGER NOT NULL,
  payload_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (user_id, id)
);

CREATE INDEX idx_place_resolutions_expiry
  ON place_resolutions(expires_at, id);

CREATE INDEX idx_place_resolutions_user_expiry
  ON place_resolutions(user_id, expires_at, id);
```

The encrypted payload is exactly:

```ts
interface StoredPlaceResolution {
  label: string;
  latitude: number;
  longitude: number;
  geocode_confidence: PlaceConfidence;
  qualifiers: PlaceResolutionResponse["qualifiers"];
}
```

Set expiry to 24 hours. `consumed_at` does not extend it. A failed birth-job
retry loads the original normalized birthplace from that failed profile’s
encrypted payload, so pruning the ephemeral resolution cannot change retry
inputs.
Extend `contracts/smoke_check.py` with exact columns, both indexes, FK
integrity, and encrypted-column pairing checks.

- [ ] **Step 3: Implement owner-scoped storage**

Use AAD:

```ts
{
  subject: identity.cryptoSubject,
  field: "place_resolutions.payload_enc",
  recordId: placeId,
}
```

Add this column to `ENCRYPTED_COLUMNS` before the first writer. Classify the table deleted/non-portable: the durable portable copy is the birth profile after selection.

Prepend `buildCryptoWriteFence` to the insert batch using the exact
`payload_key_version`; register `storePlaceResolution` in the crypto writer
inventory test. This P1 task depends on the P0 fence helper being deployed.

Add `pruneExpiredPlaceResolutions(env, now, limit)` and invoke it as a bounded
lane from `runPrivacyMaintenance`. Delete by the global `(expires_at, id)`
cursor/index in batches no larger than the existing privacy-maintenance limit.
Tests prove an unconsumed and consumed expired row are both removed while a
non-expired row remains.

- [ ] **Step 4: Verify, commit, and apply schema**

```bash
npm exec -w @patternlike/api -- vitest run src/db/place-resolutions.test.ts src/db/encrypted-columns.test.ts src/db/crypto-write-fence.test.ts src/db/key-rotation.test.ts src/services/deletion-manifest.test.ts
```

```bash
git add db/d1/0018_place_resolutions.sql db/d1/MIGRATIONS.json apps/api/test/apply-migrations.ts contracts/smoke_check.py
git commit -m "db: add selected place resolutions"
```

Apply 0018, then commit runtime registration. This ordering matters because
`rotateUserDek` scans every `ENCRYPTED_COLUMNS` table and would fail if code
named `place_resolutions` before the table existed.

```bash
git add apps/api/src/db/place-resolutions.ts apps/api/src/db/place-resolutions.test.ts apps/api/src/db/users.ts apps/api/src/db/encrypted-columns.test.ts apps/api/src/db/crypto-write-fence.test.ts apps/api/test/helpers.ts apps/api/src/services/deletion-manifest.ts apps/api/src/services/deletion-manifest.test.ts apps/api/src/services/privacy-maintenance.ts apps/api/src/services/privacy-maintenance.test.ts
git commit -m "api: store selected places under the user key"
```

---

### Task 5: Implement rate-limited place search and resolution

**Files:**
- Create: `apps/api/src/services/geocoder/types.ts`
- Create: `apps/api/src/services/geocoder/google-places-geocoding-v4.ts`
- Create: `apps/api/src/services/geocoder/google-places-geocoding-v4.test.ts`
- Create: `apps/api/src/services/geocoder/index.ts`
- Create: `apps/api/src/routes/places.ts`
- Create: `apps/api/src/routes/places.integration.test.ts`
- Modify: `apps/api/src/routes/consents.ts`
- Modify: `apps/api/src/routes/consents.integration.test.ts`
- Modify: `apps/api/src/db/consents.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/middleware/config-guard.test.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/src/services/safe-log.test.ts`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/test/hermetic-bindings.ts`
- Modify: `apps/api/scripts/wrangler-config.test.ts`

**Interfaces:**
- Consumes: M8 place types and Task 4 storage.
- Produces: `/v1/places/search` and `/v1/places/resolve`.

- [ ] **Step 1: Retrieve current provider documentation before writing the adapter**

Recheck the dated sources in the ADR. Confirm:

- Places Autocomplete (New): `POST
  https://places.googleapis.com/v1/places:autocomplete`;
- Geocoding API v4 selected-place resolution: `GET
  https://geocode.googleapis.com/v4/geocode/places/{PLACE_ID}`;
- `X-Goog-Api-Key` and `X-Goog-FieldMask` header behavior;
- the exact bodies and field masks frozen below;
- omission of Google's `sessionToken` for the per-request
  Autocomplete-plus-Geocoding flow;
- the Geocoding response types, granularity enums, quotas, and error shapes; and
- current attribution requirements.

Do not implement from remembered API signatures. A changed right, endpoint, or
field requirement blocks implementation pending an updated decision.

- [ ] **Step 2: Write failing adapter and route tests**

Cover:

- exact Autocomplete method, URL, JSON body, headers, and field mask;
- exact Geocoding method, URL path, headers, field mask, and absence of query
  parameters/body;
- omission of Google `sessionToken`, coordinates, device location, location
  bias, and app/user/birth identifiers;
- an optional locale only as Autocomplete `languageCode` in the POST body,
  never in a URL;
- strict field-by-field mapping, including `label = formattedAddress`,
  latitude/longitude from `location`, and no more than eight candidates;
- locality/postal-town, sublocality, and administrative-region confidence
  fixtures, plus refusal of unknown types or granularity;
- timeout, non-JSON/upstream errors, no provider-field leakage,
  authentication, invalid bodies, the consent gate, per-user limiting, empty
  results as 200, encrypted resolve storage, and safe logs without query,
  candidate id, outbound URL, or provider payload; and
- exact `AST-02` consent tuple, append-only grant/revoke/resume, idempotent
  replay/conflict, concurrent latest-row conflict, and refusal of old or
  unknown policies;
- rollout `off` returning generic `503 geocoder_unavailable` for grant,
  search, and resolve without invoking `fetch`, while GET still returns the
  current server-owned policy/state and DELETE can revoke; and
- config refusal for an invalid rollout value, or for enabled rollout without
  `GOOGLE_MAPS_PLATFORM_API_KEY`, while off rollout with no key leaves unrelated
  routes healthy.

- [ ] **Step 3: Implement the narrow adapter**

Add:

```ts
export const GEOCODER_PROVIDER = "google_places_geocoding_v4";
export const GEOCODER_POLICY_VERSION = "1.0.0";
export const GEOCODER_CONSENT_POLICY_VERSION =
  "google-places-geocoding-v4-2026-08-26";
export const GEOCODER_TIMEOUT_MS = 5_000;

const AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId," +
  "suggestions.placePrediction.structuredFormat.mainText.text," +
  "suggestions.placePrediction.structuredFormat.secondaryText.text";
const GEOCODE_PLACE_URL =
  "https://geocode.googleapis.com/v4/geocode/places";
const GEOCODE_FIELD_MASK =
  "formattedAddress,location,granularity,types," +
  "addressComponents.longText,addressComponents.shortText," +
  "addressComponents.types";
```

For Autocomplete, send only:

```ts
{
  input: input.query,
  includedPrimaryTypes: ["(cities)"],
  includeQueryPredictions: false,
  ...(input.locale === null ? {} : { languageCode: input.locale }),
}
```

Use `Content-Type: application/json`, `X-Goog-Api-Key:
env.GOOGLE_MAPS_PLATFORM_API_KEY`, and the exact Autocomplete field mask.
Never forward the app-owned `sessionToken`.

For selected resolution, validate the opaque candidate as one provider Place ID
and append only its encoded single segment to `GEOCODE_PLACE_URL`. Send a GET
with only `X-Goog-Api-Key` and the exact Geocoding field mask; send no query
parameters or body. `resolve.locale` remains in the app-owned interface but is
not forwarded because Geocoding v4 exposes it as a URL parameter and the
approved URL policy forbids locale there.

Map provider objects field-by-field into the internal interfaces. Derive
confidence from the most specific accepted value in result `types` or
`addressComponents[].types`:

- `label = formattedAddress`;
- `latitude = location.latitude`;
- `longitude = location.longitude`;
- `high`: `locality` or `postal_town`;
- `medium`: `sublocality` or `sublocality_level_*`;
- `low`: `administrative_area_level_*`.

Add `region_level_match` for low results and `approximate_match` when
`granularity === "APPROXIMATE"`. Unknown/unsupported result types or
granularity are refused, not guessed. Do not retain raw types, granularity,
address components, Place ID, or provider response after narrowing.

Add `GEOCODER_ROLLOUT: "off" | "enabled"` and
`GOOGLE_MAPS_PLATFORM_API_KEY?: string` to `Env`. Commit the non-secret var in
both Wrangler environments:

```toml
[vars]
GEOCODER_ROLLOUT = "off"

[env.production.vars]
GEOCODER_ROLLOUT = "off"
```

Hermetic route tests override only their binding to `enabled`.
`checkSecureConfig` rejects any rollout value outside the closed pair and
requires a non-placeholder `GOOGLE_MAPS_PLATFORM_API_KEY` only when rollout is
`enabled`. It must not require that secret while off, so the merged routes
cannot make unrelated API surfaces unavailable.

Provision the secret with `wrangler secret put
GOOGLE_MAPS_PLATFORM_API_KEY --env production`; never add a value to committed
Wrangler config. Restrict the key to Places API (New) and Geocoding API in
Google Cloud before production.

- [ ] **Step 4: Add soft interactive rate limiting**

Declare `PLACE_SEARCH_RATE_LIMITER: RateLimit` in `Env` and both Wrangler environments:

```toml
[[ratelimits]]
name = "PLACE_SEARCH_RATE_LIMITER"
namespace_id = "17001"

  [ratelimits.simple]
  limit = 30
  period = 60
```

Use key `${userId}:places`; the API is intentionally a fast, permissive
per-location abuse guard, not an accounting ledger. Preserve this combined
30-request/user/60-second guard independently of project controls.
Reserve namespace id `17001` for this binding and verify the account has no
other rate-limit binding using it before the first production deploy.

Keep the client controls pinned at a 300 ms debounce and two Unicode-code-point
minimum. Before enablement, configure the initial project ceilings exactly:

- Places Autocomplete (New): 120 requests/minute;
- Geocoding API v4: 30 requests/minute; and
- monthly Google Maps budget: USD 50, with alert thresholds at 50%, 75%, 90%,
  and 100%.

These provider quotas are rate ceilings, not spend caps. Billing-budget alerts
are advisory and do not stop traffic or guarantee a USD 50 maximum. The
production operator owns verification of both quotas, the budget, all four
alert thresholds, and alert recipients. Geocoding v4's documented default 25
QPS is context, not the configured launch ceiling. The published 99.9% SLA is
not a request-latency guarantee, so retain the 5-second adapter timeout.

- [ ] **Step 5: Implement routes**

Both routes are behind existing consumer authentication/account-state middleware.
After authentication, check rollout before parsing provider input, looking up
consent, reserving rate limit, or calling `fetch`. Any state other than
`enabled` returns generic `503 geocoder_unavailable`.

Search:

1. Require enabled rollout, then strictly parse the body.
2. Require the exact active consent defined below; otherwise return
   `403 geocoder_consent_required` before rate-limit reservation or fetch.
3. Limit by user.
4. Call provider with abort timeout.
5. Return mapped candidates only.

Resolve:

1. Require enabled rollout, strictly parse the body, and require the same exact
   active consent.
2. Limit and resolve one candidate.
3. Mint `plc_`, encrypt/store the normalized result for 24 hours.
4. Return the app-owned resolution.

Extend the existing consent route/helper with versioned `GET`, `PUT`, and
`DELETE /v1/consents/geocoder`. Reuse the existing registry source with this
exact row shape:

```ts
{
  kind: "product_source",
  source_id: "AST-02",
  permission_tier: 0,
  allowed_uses: ["chart_fact", "timezone_resolution"],
  provider: "google_places_geocoding_v4",
  scopes: [],
  connector_account_id: null,
  policy_version: "google-places-geocoding-v4-2026-08-26",
  ui_surface: "onboarding" | "privacy_center",
}
```

The chain lookup tuple is exactly `(user_id, kind = 'product_source',
source_id = 'AST-02', provider = 'google_places_geocoding_v4')`, ordered by
`version DESC, created_at DESC, id DESC`. Do not include policy in the lookup:
the latest row authorizes a provider call only if it is an unexpired,
unpaused, unrevoked `granted` row and its policy, permission tier, ordered
allowed uses, empty scopes, and null connector all exactly match the current
server constants. Any unknown/old policy or tuple mismatch is no grant.

Grant, revoke, and resume follow the existing append-only consent pattern.
Initial grant is version 1 with `supersedes_consent_id = null`; each
later state-changing grant, revoke, or resume inserts `latest.version + 1` and
points `supersedes_consent_id` at the latest row. A current-policy grant over
an old-policy latest row is state-changing. Never update or reactivate an old
row. A repeated exact active grant and repeated non-granted revoke are no-op
states with no new consent row.

Use durable jobs scoped by `(job_type, user_id, idempotency_key)`. Exact replay
of operation, current policy, and UI surface returns its stored response;
different input under the same scoped key is `409 idempotency_conflict`. Commit
the latest-row assertion, appended consent when needed, and encrypted
idempotency receipt in one batch; a concurrent loser is
`409 consent_conflict`.

Read `ui_surface` only from the required, strictly parsed
`X-Consent-UI-Surface: onboarding|privacy_center` mutation header. The PUT body
contains only the current `policy_version`; DELETE has no body. The server maps
that policy to the immutable disclosure text and links frozen in Task 3.

`PUT` requires enabled rollout, accepts only the current policy version, and
returns generic `503 geocoder_unavailable` while off. `GET` returns the current
server-owned policy/disclosure and state but does not constitute
authorization. `DELETE` remains available while off, and revocation blocks
every later provider call. Create neither a `context_source_permissions` nor a
`context_signals` row: `AST-02` writes only the encrypted birth normalization
path.

Safe logs carry only `place_search_completed` with outcome
(`success|empty|rate_limited|unavailable`) and candidate count. Never interpolate
the query, candidate id, selected label, coordinate, locale, user/account/birth
identifier, credential, outbound provider URL, or provider response.

- [ ] **Step 6: Keep static asset routing correct**

The route family is already covered by `/v1/*`; extend `wrangler-config.test.ts` only if exact expected route lists require no drift.

- [ ] **Step 7: Verify and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/services/geocoder/google-places-geocoding-v4.test.ts src/routes/places.integration.test.ts src/routes/consents.integration.test.ts src/middleware/config-guard.test.ts src/services/safe-log.test.ts
npm run test:wrangler-config -w @patternlike/api
npm run test:contracts
npm run typecheck -w @patternlike/api
```

```bash
git add apps/api/src/services/geocoder apps/api/src/routes/places.ts apps/api/src/routes/places.integration.test.ts apps/api/src/routes/consents.ts apps/api/src/routes/consents.integration.test.ts apps/api/src/db/consents.ts apps/api/src/index.ts apps/api/src/env.ts apps/api/src/middleware/config-guard.ts apps/api/src/middleware/config-guard.test.ts apps/api/src/services/safe-log.ts apps/api/src/services/safe-log.test.ts apps/api/wrangler.toml apps/api/test/hermetic-bindings.ts apps/api/scripts/wrangler-config.test.ts
git commit -m "api: resolve birthplace candidates"
```

- [ ] **Step 8: Land the provider path disabled**

Push/deploy this task only with committed development and production rollout
still `off`. Do not combine this code commit with production enablement.
Hermetic tests are the only committed configuration that sets `enabled`.

---

### Task 6: Add the accessible autocomplete and manual fallback

**Files:**
- Create: `apps/web/public/terms.html`
- Create: `apps/web/public/privacy.html`
- Create: `apps/web/public/google-maps-attribution.png`
- Create: `apps/web/src/components/PlaceAutocomplete.tsx`
- Create: `apps/web/src/components/PlaceAutocomplete.test.tsx`
- Modify: `apps/web/src/components/Onboarding.tsx`
- Modify: `apps/web/src/components/Onboarding.test.tsx`
- Modify: `apps/web/src/components/PrivacyView.tsx`
- Modify: `apps/web/src/components/PrivacyView.test.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5 endpoints.
- Produces: selected `place_id`, label, coordinates, and confidence in onboarding state.

- [ ] **Step 1: Write failing component/onboarding tests**

Cover 300 ms debounce, minimum two characters, abort/stale response
suppression, keyboard navigation, Enter selection, Escape dismissal,
no-results/failure copy, selection→resolve→timezone lookup, low-confidence
badge, manual coordinate fallback, and clearing `place_id` when
label/coordinates are edited manually.

Also prove:

- typing before consent sends no search request;
- the response and UI carry the exact policy-mapped disclosure text and four
  immutable links frozen below, plus the exact `AST-02` source, tier, ordered
  uses, provider, policy, scopes, and null connector;
- consent is unchecked by default, a successful versioned grant precedes the
  first query, and revocation prevents later search/resolve calls;
- old/unknown policy state cannot authorize calls after a policy change;
- rollout-off grant/search/resolve shows one unavailable state and sends no
  provider request, while consent state remains readable and revocation works;
- declining or revoking leaves all manual fields usable;
- Google attribution is visible with suggestions and remains beside the
  selected stored result, has accessible name exactly `Google Maps`, retains
  sufficient contrast and visual distinction, and obeys asset clear-space,
  minimum-size, aspect-ratio, and text `translate="no"` rules;
- any provider-supplied third-party attribution is displayed with its affected
  content or that content is refused; and
- the step-three ledger no longer says that no external provider received
  birthplace search data after the user enabled Google search.

- [ ] **Step 2: Implement the API client methods**

```ts
searchPlaces(
  request: PlaceSearchRequest,
  signal?: AbortSignal,
): Promise<PlaceSearchResponse>;

resolvePlace(
  request: PlaceResolutionRequest,
  signal?: AbortSignal,
): Promise<PlaceResolutionResponse>;

getGeocoderConsent(signal?: AbortSignal): Promise<GeocoderConsentResponse>;
grantGeocoderConsent(
  policyVersion: string,
  uiSurface: "onboarding" | "privacy_center",
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GeocoderConsentResponse>;
revokeGeocoderConsent(
  uiSurface: "onboarding" | "privacy_center",
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GeocoderConsentResponse>;
```

The client sends `uiSurface` only as `X-Consent-UI-Surface`; it never sends
disclosure text or links. PUT sends only `{ policy_version }`, and DELETE sends
an empty body.

Generate one app-owned session token when onboarding mounts and reuse it for
the app's search+resolve requests in that form. It preserves the internal
provider-neutral interface and stale-response boundary; the Worker must not
forward it as Google's `sessionToken`.

- [ ] **Step 3: Implement the ARIA combobox**

Use `role="combobox"`, `aria-expanded`, `aria-controls`, and
`aria-activedescendant`; listbox/options use their matching roles. Up/Down
changes the active option, Enter resolves it, Escape closes, and status/result
counts use a polite live region. Do not auto-select the first result.

Render the locally bundled, current Google attribution asset with the
suggestion list and beside the selected result. Give the attribution control
the accessible name exactly `Google Maps`. Preserve sufficient visible
contrast and the official asset's documented aspect ratio, clear space,
minimum size, colors, and unaltered form; do not crop, recolor, translate, or
hide it behind a tooltip, menu, or disclosure expansion. If text attribution
is used, render the exact text `Google Maps` with `translate="no"`. Do not fetch
attribution assets from Google in the browser.

Place Google suggestions/results in a visually distinct region from manual or
other non-Google content and do not imply that Google supplied manual content.
Render every third-party attribution supplied for the affected Google content.
If the closed current wire cannot represent required supplied attribution,
refuse that suggestion/result rather than dropping the attribution.

- [ ] **Step 4: Integrate with onboarding**

On resolution set:

```ts
setPlaceId(place.place_id);
setPlaceLabel(place.label);
setLatitude(String(place.latitude));
setLongitude(String(place.longitude));
setPlaceConfidence(place.geocode_confidence);
```

The existing coordinate effect then calls `/v1/timezone-lookup`. Manual edits
clear `placeId` and `placeConfidence` but retain the manual fields. Include
`place_id` in `BirthProfileRequest`.

Place the external-processing disclosure and consent control directly beside
the search field. Render the server-owned `disclosure.text` verbatim and the
four server-owned links; do not maintain a client-authored paraphrase. The
policy text is exactly:

> Google birthplace search is optional. If you enable it, Pattern/Like sends
> the city or place text you type and your language preference (when available)
> to Google Places Autocomplete. After you choose a suggestion, Pattern/Like
> sends only Google's opaque Place ID to Google Geocoding. Pattern/Like does not
> send your birth date or time, coordinates or device location, Pattern/Like
> user, account, birth-profile, or consent identifiers, or the app-owned search
> session token. Google receives these requests, Pattern/Like's project
> credential, and network metadata such as the Worker IP. Google acts as an
> independent controller and may retain and use information it receives,
> including search terms and IP addresses, to provide and improve Google
> products and services; the reviewed terms do not promise to exclude model
> training. Pattern/Like does not store your query or unselected suggestions.
> It encrypts the selected formatted address, coordinates, confidence, and
> qualifiers under your account key and deletes that data with your
> Pattern/Like account, but account deletion does not delete Google's separately
> controlled records. You can decline or withdraw this permission and enter the
> place, coordinates, and time zone manually.

The immutable links are `/terms.html`, `/privacy.html`,
`https://maps.google.com/help/terms_maps/`, and
`https://policies.google.com/privacy`, under the exact response keys in Task 3.
Until a grant under
`google-places-geocoding-v4-2026-08-26` passes every active-row check, do not
call search or resolve. An old or unknown policy is visibly not granted and
cannot be revived without a new current-policy PUT.

Add a revocation control to Privacy that calls the consent DELETE, aborts any
in-flight request, clears transient suggestions, and prevents later provider
calls. Keep the step-three ledger accurate about Google search when consent is
granted.

Publish public Terms and Privacy before enabling the control. Terms must flow
down the current Google Maps/Google Earth Additional Terms. Privacy must link
Google's Privacy Policy and describe controller-controller processing,
cross-border transfers, no documented configurable Maps residency, Google's
separate retention/use, Pattern/Like's encrypted selected-result retention,
and the boundary of account deletion. Both documents and the inline disclosure
must use the dated requirements in the ADR.

- [ ] **Step 5: Verify and commit**

```bash
npm exec -w @patternlike/web -- vitest run src/components/PlaceAutocomplete.test.tsx src/components/Onboarding.test.tsx src/components/PrivacyView.test.tsx
npm run typecheck -w @patternlike/web
```

```bash
git add apps/web/public/terms.html apps/web/public/privacy.html apps/web/public/google-maps-attribution.png apps/web/src/components/PlaceAutocomplete.tsx apps/web/src/components/PlaceAutocomplete.test.tsx apps/web/src/components/Onboarding.tsx apps/web/src/components/Onboarding.test.tsx apps/web/src/components/PrivacyView.tsx apps/web/src/components/PrivacyView.test.tsx apps/web/src/lib/api-client.ts apps/web/src/styles.css
git commit -m "web: add birthplace autocomplete"
```

- [ ] **Step 6: Enable only through a separate configuration commit**

Keep development and production `GEOCODER_ROLLOUT = "off"` through the Task 5
provider/routes commit and this Terms/Privacy/disclosure/attribution commit.
Before a later configuration-only production enablement, the production
operator must record:

1. passing contract, API, web, type, and Wrangler-config tests;
2. the billing-account region (`EEA` or `non-EEA`);
3. the installed secret and API restrictions to Places API (New) plus
   Geocoding API;
4. project quotas of 120 Autocomplete requests/minute and 30 Geocoding
   requests/minute;
5. a USD 50 monthly budget with alert recipients at 50%, 75%, 90%, and 100%;
6. deployed public Terms/Privacy, exact policy disclosure, and complete Google
   and third-party attribution; and
7. a successful internal canary against a non-reader-serving Worker version or
   environment with rollout enabled.

Only then make a separate config commit changing production to `enabled` and
deploy it. Do not bundle enablement with provider or UI code.

---

### Task 7: Make selected-place and timezone confidence authoritative

**Files:**
- Create: `apps/api/src/services/location-uncertainty.ts`
- Create: `apps/api/src/services/location-uncertainty.test.ts`
- Modify: `packages/shared/src/chart-types.ts`
- Modify: `apps/api/src/routes/birth.ts`
- Modify: `apps/api/src/routes/birth.integration.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`
- Modify: `apps/calc-stub/src/engine.ts`
- Create: `apps/calc-stub/src/location-uncertainty.test.ts`
- Modify: `apps/web/src/components/ChartView.tsx`
- Create: `apps/web/src/components/ChartView.test.tsx`

**Interfaces:**
- Consumes: Task 4 selected-place storage and existing timezone resolver.
- Produces: location-qualified `UncertaintyReport`.

- [ ] **Step 1: Write failing trust-boundary tests**

Prove:

- Foreign/expired `place_id` is rejected without revealing ownership.
- When `place_id` is valid, tampered client coordinates/label are ignored.
- Manual coordinates still work without `place_id`.
- Combined confidence is the weaker of geocoder and timezone confidence.
- Medium/low/none creates a `birthplace/technique_specific` qualification.
- Boundary/pre-1970/ambiguous/nonexistent qualifiers create a `birth_instant/technique_specific` qualification.
- High confidence/no qualifier leaves the existing exact summary unchanged.
- Chart UI renders plain-language location qualifications, not raw codes.

- [ ] **Step 2: Add closed optional calc inputs**

```ts
export type LocationQualifierCode =
  | "approximate_match"
  | "region_level_match"
  | TimezoneQualifier["code"];

export interface CalcRequest {
  // existing fields...
  location_confidence?: TimezoneConfidence;
  location_qualifier_codes?: LocationQualifierCode[];
}
```

Inputs are optional so older Worker/calc deployments remain compatible. Validate the closed codes before calling calc.

- [ ] **Step 3: Normalize the authoritative birthplace in `birth.ts`**

For a new idempotency key, after idempotency short-circuits and before timezone
resolution:

```ts
const birthplace = body.birthplace?.place_id
  ? await loadPlaceResolution(c.env, identity, body.birthplace.place_id, new Date())
  : normalizeManualBirthplace(body.birthplace);
```

Use this object for encrypted profile payload, timezone resolution, calc request, and 202 response. Mark a selected resolution consumed only in the same profile/job batch.
Persist it in `BirthCalcCommandV1.effective`. A failed-job retry compares the
submitted portion of that command and reuses its effective birthplace,
timezone, confidence, and qualifier codes; it never reloads an expired
`place_resolution`.

- [ ] **Step 4: Combine confidence and build uncertainty**

Add a pure rank (`none < low < medium < high`) and pass the weaker result plus deduplicated qualifier codes to calc. In `buildUncertainty`, append stable feature entries using the existing frozen `technique_specific` enum and append one plain-language clause to `user_facing_summary`.

Write the same combined value to `birth_profiles.geocode_confidence`. Do not
add location metadata to `fingerprintPayload`.

- [ ] **Step 5: Render qualifications**

Extend `ChartView`’s uncertainty card with a semantic list. Map:

- `feature_id = "birthplace"` → “Birthplace resolution needs confirmation.”
- `feature_id = "birth_instant"` → “The civil-time conversion needs confirmation.”

Do not render provider names or raw machine codes.

- [ ] **Step 6: Run focused, golden, contract, and type verification**

```bash
npm exec -w @patternlike/api -- vitest run src/services/location-uncertainty.test.ts src/routes/birth.integration.test.ts
npx tsx --test src/location-uncertainty.test.ts
```

Run the second command from `apps/calc-stub`.

```bash
npm exec -w @patternlike/web -- vitest run src/components/ChartView.test.tsx src/components/Onboarding.test.tsx
npm run calc:golden
npm run test:contracts
npm run typecheck
```

Expected: all pass. Golden fingerprints remain unchanged because uncertainty is excluded from the fingerprint.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/location-uncertainty.ts apps/api/src/services/location-uncertainty.test.ts packages/shared/src/chart-types.ts apps/api/src/routes/birth.ts apps/api/src/routes/birth.integration.test.ts apps/api/test/mock-calc-service.ts apps/calc-stub/src/engine.ts apps/calc-stub/src/location-uncertainty.test.ts apps/web/src/components/ChartView.tsx apps/web/src/components/ChartView.test.tsx
git commit -m "chart: qualify location uncertainty"
```

## Definition of Done

- [ ] Fresh signed-in accounts receive device-derived timezone and locale without manual confirmation.
- [ ] User-confirmed values remain unchanged across foreground sync.
- [ ] Today automatically retries after the initial device sync settles.
- [x] The geocoder decision proves storage/privacy rights before provider implementation.
- [ ] Public Terms/Privacy, the exact server-owned disclosure, `AST-02`
      append-only revocable consent, and complete Google/third-party
      attribution satisfy the approved ADR before the first provider call.
- [ ] Provider/routes and legal/UI commits land with rollout off; production
      enablement is a separate config commit after the recorded operator gates.
- [ ] Project quotas are 120/min Autocomplete and 30/min Geocoding, the USD 50
      budget has 50/75/90/100% advisory alerts, and the 30/user/min app guard
      remains active.
- [ ] Search/resolve routes are authenticated, bounded, rate-limited, and provider-narrowed.
- [ ] Unselected queries/results are not persisted or logged.
- [ ] Selected places are owner-scoped, encrypted, expiring, rotation-covered, and deletion-covered.
- [ ] Place selection fills coordinates and uses the existing historical timezone lookup.
- [ ] Manual coordinate and manual timezone flows remain complete.
- [ ] Birth creation trusts the server resolution behind `place_id`, not client copies.
- [ ] Low confidence reaches stored chart uncertainty and the user-facing chart card.
- [ ] Autocomplete is fully keyboard-operable and announces loading/results/errors.
