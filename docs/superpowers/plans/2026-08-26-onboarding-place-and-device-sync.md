# Onboarding Place and Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual preference and coordinate friction while keeping birthplace resolution trustworthy, private, accessible, and visible in chart uncertainty.

**Architecture:** A best-effort foreground synchronizer writes browser timezone/locale as `device_derived` and triggers Today to retry after settlement. Place autocomplete calls an authenticated, rate-limited Worker adapter; only a selected candidate is resolved and cached in a short-lived user-DEK-encrypted D1 row. Birth creation treats that owner-scoped resolution as authority, combines its confidence with historical timezone confidence, passes closed location metadata to calc, and renders the resulting qualifications.

**Tech Stack:** React 19, TypeScript strict ESM, Hono, Cloudflare Workers Rate Limiting binding, D1, Web Crypto, Google Places adapter subject to the mandatory rights gate, Vitest/Testing Library/workerd, JSON Schema/OpenAPI

## Global Constraints

- Preserve existing M3 preference routes and server lock semantics.
- Sync only after the Worker session is known to be valid.
- A `user_confirmed` preference always outranks `device_derived`; `409 preference_locked` is a successful no-op for foreground sync.
- Reuse one idempotency key per `(preference kind, normalized value)` for the lifetime of the mounted app.
- Place queries use POST bodies, never URLs. No query/provider payload enters logs, D1, analytics, or audit detail.
- The implementation assumes the Google Places API (New) only after Task 2 proves selected normalized coordinates may be retained for this product. If rights review fails, stop before adapter code and replace the provider decision with a cache-compatible provider or bundled gazetteer; do not weaken retention or silently violate terms.
- Keep all provider credentials server-side.
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

- `apps/web/src/lib/device-preference-sync.ts`: one in-flight foreground sync with stable keys.
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

**Interfaces:**
- Produces: `DevicePreferenceSynchronizer`.
- Consumed by: `App`.

- [ ] **Step 1: Write failing synchronizer tests**

Cover:

- Timezone and locale are sent with `source: "device_derived"`.
- The same normalized values reuse the same idempotency keys.
- Changed values receive new keys.
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

The instance owns:

```ts
private readonly idempotencyKeys = new Map<string, string>();
private inFlight: Promise<DevicePreferenceSyncResult> | null = null;
```

Canonicalize locale with `Intl.getCanonicalLocales` and use the existing device fallbacks. Call both PUTs with `Promise.allSettled`; no single preference failure suppresses the other.

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
npm exec -w @patternlike/api -- vitest run src/routes/preferences.test.ts
npm run typecheck -w @patternlike/web
```

Expected: all pass; server regression tests still prove locked/no-op semantics.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/device-preference-sync.ts apps/web/src/lib/device-preference-sync.test.ts apps/web/src/lib/device.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/TodayView.tsx apps/web/src/components/TodayView.test.tsx
git commit -m "web: sync device preferences on foreground"
```

---

### Task 2: Complete the geocoder rights, privacy, and provider decision

**Files:**
- Create: `docs/decisions/2026-08-26-geocoder-provider.md`
- Modify: `docs/superpowers/plans/2026-08-01-backend-completion-roadmap.md`
- Modify if the selected provider is not Google: `docs/superpowers/plans/2026-08-26-onboarding-place-and-device-sync.md`

- [ ] **Step 1: Evaluate the assumed Google Places API (New)**

Record dated primary-source evidence for:

- autocomplete and place-details API/field-mask shapes;
- storage/caching rights for selected label, latitude, longitude, and confidence;
- deletion/retention obligations;
- DPA, data residency, subprocessors, and whether query text is used for provider training;
- global locality coverage, quotas, latency, cost controls, and SLA;
- required attribution in the autocomplete and stored-result UI.

- [ ] **Step 2: Apply the hard gate**

The provider passes only if Pattern/Like may:

1. send the user-entered query from its Worker;
2. return suggestions to that user;
3. retain the selected normalized label and coordinates in the encrypted birth profile for the account lifetime;
4. retain no unselected query/result payload;
5. delete selected data with the account.

If any condition fails, reject the provider. The next choice must satisfy the same gate; a bundled gazetteer is preferred over violating a service term.

- [ ] **Step 3: Freeze the app-owned provider contract**

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

- [ ] **Step 4: Review and commit the decision**

Do not begin Tasks 3–5 until product/privacy/legal owners approve the decision.
If the approved provider is not Google Places, this same decision commit must
replace every provider-specific item in this plan before approval: tech stack,
adapter/test filenames, `place_resolutions.provider` CHECK, secret/config
names, field mapping, attribution, and verification commands. There is no
runtime “fallback” through Google-shaped SQL or code.

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
- Create: `contracts/m8/openapi/openapi.yaml`
- Create: `contracts/m8/fixtures/valid/place-search.results.json`
- Create: `contracts/m8/fixtures/valid/place-resolution.high-confidence.json`
- Create: `contracts/m8/fixtures/invalid/place-search.query-too-short.json`
- Create: `contracts/m8/fixtures/invalid/place-resolution.extra-provider-field.json`
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
```

`POST /v1/places/search` accepts `PlaceSearchRequest`; `POST /v1/places/resolve` accepts `{ candidate_id, locale?, session_token }`. Document `400`, `401`, `429`, and `503`.

- [ ] **Step 2: Run contracts and verify RED**

```bash
npm run test:contracts
```

- [ ] **Step 3: Add closed schemas, fixtures, shared types, and manifest**

M8 records exact predecessor hashes and describes these endpoints as additive. Provider name, ids beyond `candidate_id`, score, raw address components, and attribution metadata are not on the product wire.

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
  provider TEXT NOT NULL CHECK (provider IN ('google_places')),
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
- Create: `apps/api/src/services/geocoder/google-places.ts`
- Create: `apps/api/src/services/geocoder/google-places.test.ts`
- Create: `apps/api/src/services/geocoder/index.ts`
- Create: `apps/api/src/routes/places.ts`
- Create: `apps/api/src/routes/places.integration.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/src/services/safe-log.test.ts`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/test/hermetic-bindings.ts`
- Modify: `apps/api/scripts/wrangler-config.test.ts`

**Interfaces:**
- Consumes: M8 place types and Task 4 storage.
- Produces: `/v1/places/search` and `/v1/places/resolve`.

- [ ] **Step 1: Retrieve current provider documentation before writing the adapter**

Confirm API URLs, headers, field masks, session-token rules, bounds, and error shapes against the dated primary sources recorded in Task 2. Do not implement from remembered API signatures.

- [ ] **Step 2: Write failing adapter and route tests**

Cover strict mapping, max 8 candidates, timeout, non-JSON/upstream errors, no provider-field leakage, authentication, invalid bodies, per-user limiting, empty results as 200, encrypted resolve storage, and safe logs without query/candidate id.

- [ ] **Step 3: Implement the narrow adapter**

Add:

```ts
export const GEOCODER_POLICY_VERSION = "1.0.0";
export const GEOCODER_TIMEOUT_MS = 5_000;
```

Map provider objects field-by-field into the internal interfaces. Derive confidence under the approved policy:

- `high`: locality/postal-town level;
- `medium`: sublocality or provider-indicated approximate locality;
- `low`: administrative-region-only result.

Unknown/unsupported result types are refused, not guessed.

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

Use key `${userId}:places`; the API is intentionally a fast, permissive per-location abuse guard, not an accounting ledger. Vendor-side quotas remain the hard spend ceiling.
Reserve namespace id `17001` for this binding and verify the account has no
other rate-limit binding using it before the first production deploy.

- [ ] **Step 5: Implement routes**

Both routes are behind existing consumer authentication/account-state middleware.

Search:

1. Strictly parse body.
2. Limit by user.
3. Call provider with abort timeout.
4. Return mapped candidates only.

Resolve:

1. Strictly parse body and limit.
2. Resolve one candidate.
3. Mint `plc_`, encrypt/store normalized result for 24 hours.
4. Return the app-owned resolution.

Safe logs carry only `place_search_completed` with outcome (`success|empty|rate_limited|unavailable`) and candidate count.

- [ ] **Step 6: Keep static asset routing correct**

The route family is already covered by `/v1/*`; extend `wrangler-config.test.ts` only if exact expected route lists require no drift.

- [ ] **Step 7: Verify and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/services/geocoder/google-places.test.ts src/routes/places.integration.test.ts src/services/safe-log.test.ts
npm run test:wrangler-config -w @patternlike/api
npm run test:contracts
npm run typecheck -w @patternlike/api
```

```bash
git add apps/api/src/services/geocoder apps/api/src/routes/places.ts apps/api/src/routes/places.integration.test.ts apps/api/src/index.ts apps/api/src/env.ts apps/api/src/services/safe-log.ts apps/api/src/services/safe-log.test.ts apps/api/wrangler.toml apps/api/test/hermetic-bindings.ts apps/api/scripts/wrangler-config.test.ts
git commit -m "api: resolve birthplace candidates"
```

---

### Task 6: Add the accessible autocomplete and manual fallback

**Files:**
- Create: `apps/web/src/components/PlaceAutocomplete.tsx`
- Create: `apps/web/src/components/PlaceAutocomplete.test.tsx`
- Modify: `apps/web/src/components/Onboarding.tsx`
- Modify: `apps/web/src/components/Onboarding.test.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5 endpoints.
- Produces: selected `place_id`, label, coordinates, and confidence in onboarding state.

- [ ] **Step 1: Write failing component/onboarding tests**

Cover 300 ms debounce, minimum two characters, abort/stale response suppression, keyboard navigation, Enter selection, Escape dismissal, no-results/failure copy, selection→resolve→timezone lookup, low-confidence badge, manual coordinate fallback, and clearing `place_id` when label/coordinates are edited manually.

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
```

Generate one session token when onboarding mounts and reuse it for search+resolve in that form.

- [ ] **Step 3: Implement the ARIA combobox**

Use `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`; listbox/options use their matching roles. Up/Down changes the active option, Enter resolves it, Escape closes, and status/result counts use a polite live region. Do not auto-select the first result.

- [ ] **Step 4: Integrate with onboarding**

On resolution set:

```ts
setPlaceId(place.place_id);
setPlaceLabel(place.label);
setLatitude(String(place.latitude));
setLongitude(String(place.longitude));
setPlaceConfidence(place.geocode_confidence);
```

The existing coordinate effect then calls `/v1/timezone-lookup`. Manual edits clear `placeId` and `placeConfidence` but retain the manual fields. Include `place_id` in `BirthProfileRequest`.

Place the external-processing/attribution disclosure directly beside the search field, before any query can be sent. Keep the step-three ledger accurate.

- [ ] **Step 5: Verify and commit**

```bash
npm exec -w @patternlike/web -- vitest run src/components/PlaceAutocomplete.test.tsx src/components/Onboarding.test.tsx
npm run typecheck -w @patternlike/web
```

```bash
git add apps/web/src/components/PlaceAutocomplete.tsx apps/web/src/components/PlaceAutocomplete.test.tsx apps/web/src/components/Onboarding.tsx apps/web/src/components/Onboarding.test.tsx apps/web/src/lib/api-client.ts apps/web/src/styles.css
git commit -m "web: add birthplace autocomplete"
```

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
- [ ] The geocoder decision proves storage/privacy rights before provider implementation.
- [ ] Search/resolve routes are authenticated, bounded, rate-limited, and provider-narrowed.
- [ ] Unselected queries/results are not persisted or logged.
- [ ] Selected places are owner-scoped, encrypted, expiring, rotation-covered, and deletion-covered.
- [ ] Place selection fills coordinates and uses the existing historical timezone lookup.
- [ ] Manual coordinate and manual timezone flows remain complete.
- [ ] Birth creation trusts the server resolution behind `place_id`, not client copies.
- [ ] Low confidence reaches stored chart uncertainty and the user-facing chart card.
- [ ] Autocomplete is fully keyboard-operable and announces loading/results/errors.
