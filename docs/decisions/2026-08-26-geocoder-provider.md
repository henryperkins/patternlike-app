# Geocoder Provider, Rights, and Privacy Decision

> Historical Google decision. Superseded for new requests by
> [the 2026-09-04 Geoapify decision](2026-09-04-geoapify-geocoder.md).
> The frozen M8 Google contract and historical consent records remain unchanged.

- **Date:** 2026-08-26
- **Status:** Approved; implementation pending
- **Approval provenance:** The repository owner explicitly supplied
  product/privacy/legal approval in this Cursor implementation session on
  2026-08-26
- **Provider id:** `google_places_geocoding_v4`

## Decision

Pattern/Like will use one composite, server-side Google adapter:

1. transient search through Places Autocomplete (New), `POST
   https://places.googleapis.com/v1/places:autocomplete`; and
2. selected-place resolution through Geocoding API v4, `GET
   https://geocode.googleapis.com/v4/geocode/places/{PLACE_ID}`.

The browser calls only Pattern/Like. It never calls Google. The adapter keeps
the existing app-owned `GeocoderProvider` interface, but its `sessionToken`
remains internal and is never sent as Google's `sessionToken`. Google documents
the Autocomplete-with-Geocoding combination as a per-request flow: Geocoding,
not Place Details, resolves the selection.

There is no runtime provider fallback. Manual label, coordinate, and IANA-zone
entry remains the complete fallback when Google is unavailable, does not cover
a locality, or refuses a result.

## Rights decision

The governing Service Specific Terms depend on the Google Maps Platform billing
account address. The production operator must record the billing-account region
as `EEA` or `non-EEA` before provisioning the project, key, quotas, or budget.
That record selects the terms to retain with the enablement evidence; it does
not make this approval conditional because the composite passes under either
regime.

| Billing-account regime | Pure Places/Place Details | Composite Places Autocomplete + Geocoding v4 | Outcome |
|---|---|---|---|
| Non-EEA | Service Specific Terms §14.3 limits Places latitude/longitude caching to 30 consecutive days. | Geocoding §6.3.2 permits indefinite caching of latitude, longitude, `formatted_address`, and structured address values for the initiating direct end-user functionality when logically isolated and not reused across users. | Pure Places fails; composite passes. |
| EEA | EEA Service Specific Terms §15.4 imposes the same 30-day Places latitude/longitude limit. | EEA Geocoding §6.2.2 grants the same indefinite, direct-end-user, logically isolated caching right. EEA Places §15.2 also limits Places content to the published permitted uses; permitted use (1) expressly allows address lookup and autocompletion, which is this search flow. | Pure Places fails; composite passes. |

Pattern/Like displays no map in this flow, so the EEA “No Use With any Map”
clauses do not narrow the approved use. The composite's durable coordinates and
address come from Geocoding API v4, never Place Details.

Under both Geocoding clauses, all of the following must remain true:

- the data supports the direct, end-user-facing functionality that initiated
  the request;
- it is logically isolated to that end user;
- it is not used across users; and
- the cache is not used as a substitute for offering a geocoding service or
  avoiding a call that another user or request would otherwise require.

An encrypted birthplace attached to the selecting user's profile meets those
conditions. Pattern/Like must not turn it into a shared gazetteer, suggestion
cache, analytics dataset, or cross-user lookup.

### Five-condition hard gate

| # | Required condition | Composite control and primary-source basis | Result |
|---|---|---|---|
| 1 | Send the user-entered query from the Worker | After disclosure and consent, the Worker sends the query only as Autocomplete's JSON `input`. Non-EEA terms permit the documented API use; EEA permitted use (1) expressly permits address lookup and autocompletion. | Pass |
| 2 | Return suggestions to that user | Only narrowed place predictions are returned to the requesting user, with visible Google attribution; they are neither shared nor retained. | Pass |
| 3 | Retain the selected normalized label and coordinates in the encrypted birth profile for the account lifetime | Selection is resolved with Geocoding API v4, not Place Details. Non-EEA §6.3.2 and EEA §6.2.2 both permit indefinite, direct-user, logically isolated Geocoding caching. Pure Places/Place Details fails because non-EEA §14.3 and EEA §15.4 cap Places coordinates at 30 days. | Pass |
| 4 | Retain no unselected query or result payload | Within Pattern/Like, query and suggestions exist only in request memory. Safe logging, analytics, D1, and audit events receive no query, candidate, or provider payload. Google's separate controller retention is disclosed below. | Pass |
| 5 | Delete selected data with the account | The narrowed selection is encrypted under the user's DEK and is included in account deletion and crypto-shredding. Google remains an independent controller of the request data it separately collects; Pattern/Like cannot represent account deletion as deletion of Google's controller records. | Pass |

**Hard-gate outcome under both billing-account regimes:**
`google_places_geocoding_v4` passes. Pure Places plus Place Details does not.

## Frozen provider request shapes

### Search

The Worker sends:

```http
POST https://places.googleapis.com/v1/places:autocomplete
Content-Type: application/json
X-Goog-Api-Key: <GOOGLE_MAPS_PLATFORM_API_KEY>
X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text
```

With a locale, the exact JSON body is:

```json
{
  "input": "<trimmed user query>",
  "includedPrimaryTypes": ["(cities)"],
  "includeQueryPredictions": false,
  "languageCode": "<canonical locale>"
}
```

When locale is null, the exact JSON body is:

```json
{
  "input": "<trimmed user query>",
  "includedPrimaryTypes": ["(cities)"],
  "includeQueryPredictions": false
}
```

Angle-bracketed values above denote the runtime string values. The adapter
sends no Google `sessionToken`,
`locationBias`, `locationRestriction`, `origin`, `includedRegionCodes`, or
`regionCode`. In particular, search sends no coordinates or device location.
It maps at most eight place predictions into the app-owned
`ProviderPlaceCandidate` shape and discards every other response field.

The raw query is allowed only in the Autocomplete POST body. It is prohibited
from URLs, logs, analytics, D1, and audit detail.

### Resolve

The selected candidate's opaque, provider-generated Place ID is the sole
dynamic outbound URL component:

```http
GET https://geocode.googleapis.com/v4/geocode/places/{PLACE_ID}
X-Goog-Api-Key: <GOOGLE_MAPS_PLATFORM_API_KEY>
X-Goog-FieldMask: formattedAddress,location,granularity,types,addressComponents.longText,addressComponents.shortText,addressComponents.types
```

There are no query parameters and no request body. `resolve.locale` remains in
the app-owned interface but is not forwarded because Geocoding v4 exposes
language selection as a URL parameter and this decision forbids locale in an
outbound URL.

The URL builder must accept only the candidate's opaque Google Place ID as a
single encoded path segment. Raw query, suggestion label, coordinates, locale,
birth date/time, user/account/birth-profile identifiers, credentials, and all
other provider response content are forbidden in URLs. They are also forbidden
from logs and audit detail. D1 may contain only the encrypted, selected,
app-owned projection described below; it must never contain a raw Google
response or any unselected suggestion.

## Data minimization and storage

The only credential is the Worker secret
`GOOGLE_MAPS_PLATFORM_API_KEY`. It is sent to Google only in
`X-Goog-Api-Key`, never in a URL, body, log, D1, analytics, or audit event. The
Google Cloud key must be API-restricted to Places API (New) and Geocoding API.

Places suggestions and the user query are transient. After selection, the
adapter reads only the Geocoding fields in the frozen mask and immediately
narrows them field-by-field to:

```ts
{
  label: string;
  latitude: number;
  longitude: number;
  geocodeConfidence: "high" | "medium" | "low";
  qualifiers: Array<{
    code: "approximate_match" | "region_level_match";
    message: string;
  }>;
}
```

That projection is encrypted under the selecting user's DEK. The short-lived
`place_resolutions` row may hold it for 24 hours; birth creation copies it into
the encrypted birth profile for the account lifetime. Raw `granularity`,
`types`, `addressComponents`, the Google response, and the Google Place ID are
not persisted. The plaintext provider discriminator is the closed constant
`google_places_geocoding_v4`, and the durable public `place_id` remains an
app-minted `plc_` id.

The field mapping is exact:

- durable `label = formattedAddress`;
- durable `latitude = location.latitude`; and
- durable `longitude = location.longitude`.

The confidence policy uses the most specific accepted type found in the result
or its address components:

| Google type | App confidence | Qualifier |
|---|---|---|
| `locality` or `postal_town` | `high` | Add `approximate_match` only when `granularity` is `APPROXIMATE`. |
| `sublocality` or `sublocality_level_*` | `medium` | Add `approximate_match` when `granularity` is `APPROXIMATE`. |
| `administrative_area_level_*` | `low` | Add `region_level_match`; also add `approximate_match` when applicable. |
| No accepted type, unknown type-only result, or unknown granularity | Refuse | Do not guess or store a result. |

## Frozen consent policy

This consent reuses the existing data-source registry entry `AST-02`
(`Birthplace geocoding`). It does not mint an ad hoc source.

| Consent field | Frozen value |
|---|---|
| `kind` | `product_source` |
| `source_id` | `AST-02` |
| `permission_tier` | `0` |
| `allowed_uses_json` | `["chart_fact","timezone_resolution"]` in this exact order, with no additional use |
| `provider` | `google_places_geocoding_v4` |
| `scopes_json` | `[]` |
| `connector_account_id` | `NULL` |
| `policy_version` | `google-places-geocoding-v4-2026-08-26` |
| `ui_surface` | `onboarding` or `privacy_center`, supplied through the closed `X-Consent-UI-Surface` mutation header |

The immutable server-owned disclosure for that policy version is the following
exact text:

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

The server maps the policy version to that text and these immutable links; the
client does not submit or author any disclosure content:

```json
{
  "patternlike_terms": "/terms.html",
  "patternlike_privacy": "/privacy.html",
  "google_maps_terms": "https://maps.google.com/help/terms_maps/",
  "google_privacy": "https://policies.google.com/privacy"
}
```

`PUT /v1/consents/geocoder` accepts only the current `policy_version` and a
closed `X-Consent-UI-Surface: onboarding|privacy_center` header. An unknown,
old, or future version is `409 consent_policy_version_stale` and writes
nothing. `GET` returns the current server-owned policy/disclosure and may report
state while rollout is off, but a response is never itself authorization.

The consent chain lookup tuple is exactly `(user_id, kind = 'product_source',
source_id = 'AST-02', provider = 'google_places_geocoding_v4')`. Load the
latest row by `version DESC, created_at DESC, id DESC`; do not look up by policy
version because that could resurrect an older grant. The latest row authorizes
a provider call only when all of these checks pass:

1. `status = 'granted'`, `granted_at IS NOT NULL`, `revoked_at IS NULL`, and
   `paused_at IS NULL`;
2. it is unexpired;
3. `policy_version` is exactly
   `google-places-geocoding-v4-2026-08-26` and exists in the server disclosure
   map;
4. `permission_tier = 0`;
5. `allowed_uses_json` parses to exactly
   `["chart_fact","timezone_resolution"]`;
6. `scopes_json` parses to exactly `[]`; and
7. `connector_account_id IS NULL`.

Any mismatch, including an otherwise-live grant under an unknown or old policy,
is no grant. Search and resolve then fail closed without contacting Google.

Grant, revoke, and resume are append-only. An initial grant inserts version 1
with no predecessor. Every later state-changing grant, revoke, or resume
inserts `version = latest.version + 1` and
`supersedes_consent_id = latest.id`; prior consent rows are never updated or
deleted. A current-policy grant that replaces an old-policy row is
state-changing and appends. Revoke inserts a `revoked` row with `revoked_at`;
resume is a new `granted` row under the current policy, never reactivation of
an old row. A grant while the exact current grant is already active and a
revoke while already not granted are no-op states and do not append a consent
row.

Every mutation requires an 8–128 character `Idempotency-Key`. The durable
receipt is scoped by `(job_type, user_id, idempotency_key)`. Replaying the same
operation, policy version, and UI surface returns the stored response and
creates no row; reusing that scoped key with different mutation input returns
`409 idempotency_conflict`. The latest-row assertion and receipt commit in the
same D1 batch, so concurrent different keys have one winner and the loser
returns `409 consent_conflict`.

No `context_source_permissions` or `context_signals` row is created for this
consent. `AST-02` writes the selected normalization directly into the
user-encrypted birth path; it is not reading context. The implementation is
stricter than the registry's raw-retention ceiling: raw queries and unselected
suggestions are never persisted.

## Fail-closed rollout

`GEOCODER_ROLLOUT` is a non-secret, closed configuration value:

- `off`
- `enabled`

The top-level development block is committed `off`; a local Worker that needs
the search overrides it in `.dev.vars` together with the key. The production
block was changed to `enabled` on 2026-09-04 in its own configuration commit;
`docs/deploy/geocoder-rollout.md` records each gate below with the evidence
behind it and the rollback. Hermetic route tests explicitly override the value
to `enabled`; no other value is accepted.

While rollout is `off`, consent grant (`PUT`), place search, and place resolve
return the same generic `503 geocoder_unavailable` envelope and make no Google
request. `GET /v1/consents/geocoder` may expose the current policy,
server-owned disclosure, and fail-closed state, but cannot authorize a provider
call. Revocation (`DELETE`) remains available so disabling rollout never traps
a grant.

`checkSecureConfig` validates the closed rollout value in every environment. It
requires `GOOGLE_MAPS_PLATFORM_API_KEY` only when rollout is `enabled`. A
missing key while rollout is `off` therefore does not break unrelated API
routes; an invalid rollout value or enabled rollout without the key fails
closed.

Rollout order is mandatory:

1. land provider code, consent routes, search/resolve routes, and config with
   development and production still `off`;
2. land public Terms, public Privacy, the exact disclosure, and complete
   attribution while still `off`;
3. verify tests, the API-restricted secret, recorded billing-account region,
   project quotas, budget/alerts, and a successful internal canary in a
   non-reader-serving Worker version or environment; then
4. enable production only in a separate configuration commit and deploy.

The production operator owns and records every gate before enablement. Existing
grants under an unknown or old policy remain fail-closed after a policy change;
an enablement never revives them.

## Privacy and user-facing obligations

Google Maps Platform is governed here by controller-controller terms, not the
Google Cloud processor DPA. Google and Pattern/Like independently determine
their processing. The reviewed Maps terms say Google collects or receives data
including search terms, IP addresses, and latitude/longitude coordinates and
may retain and use it to provide and improve Google products and services,
subject to Google's Privacy Policy. No reviewed promise narrows “improve” to
exclude model training, so Pattern/Like must not claim that Google will not use
request data for training.

This design minimizes what Google receives:

- no browser-to-Google request or direct transfer of the browser's IP;
- no Pattern/Like user, account, birth-profile, consent, or session identifier;
- no birth date or birth time;
- no coordinates, device location, or location bias in search;
- no app-owned `sessionToken`;
- only query plus optional canonical locale in the Autocomplete body, followed
  by the selected Google Place ID in the Geocoding path; and
- no end-user credential.

Google still receives the Worker request, its project credential, the search
term, the selected Place ID, and network metadata such as the Worker egress IP.

The Maps terms point to controller-controller cross-border transfer terms.
Google's configurable Cloud data-residency list does not document Maps,
Places, or Geocoding as configurable-residency services. The Cloud DPA and its
subprocessor list therefore must not be presented as the processor contract or
as a Maps residency commitment.

Before the first query can leave the Worker:

1. public Terms must disclose that the application includes Google Maps
   features/content and flow down the current Google Maps/Google Earth
   Additional Terms;
2. public Privacy must link Google's Privacy Policy and explain the
   controller-controller transfer, data categories, improvement-use language,
   cross-border processing, retention uncertainty, and account-deletion
   boundary;
3. the onboarding field must show the same external-processing disclosure and
   obtain express, prior, revocable consent; and
4. declining or revoking that consent must prevent further Google calls while
   leaving manual entry fully usable.

Google attribution must be visible with sufficient contrast alongside the
Autocomplete suggestions and beside every displayed stored selected result,
including later onboarding review. Google content must be visually distinct
from manual or other non-Google content, without implying that Google supplied
the latter. The attribution control's required accessible name is exactly
`Google Maps`.

Use a current, locally bundled official asset without alteration and preserve
Google's minimum size, aspect ratio, and clear-space rules. Do not hide
attribution behind interaction, crop it, translate it, or fetch it from Google
in the browser. If text attribution is used, render `Google Maps` with
`translate="no"`. Display every third-party attribution Google supplies with
the affected content; if required attribution cannot be represented, refuse
that suggestion/result rather than silently dropping it.

## Coverage, reliability, quota, and cost controls

Coverage and accuracy vary by country and can change with government rules and
Google's provider contracts. Unknown result types fail closed, and manual entry
handles gaps.

Google publishes a 99.9% monthly uptime SLA for covered Maps services,
including Places and Geocoding. This is an availability/service-credit
commitment, not a per-request latency guarantee. The adapter therefore keeps a
5-second timeout and returns an unavailable result without blocking manual
entry.

Places API (New) quotas are per method and per project. Geocoding API v4 has a
default 25 QPS project quota, but Pattern/Like's initial project controls are
deliberately lower:

- Places Autocomplete (New): 120 requests per minute per project;
- Geocoding API v4: 30 requests per minute per project;
- keep the existing combined app limit of 30 search/resolve requests per
  authenticated user per 60 seconds;
- debounce search by 300 ms and require at least two Unicode code points;
- request only the frozen field masks;
- use per-request Autocomplete billing without a Google session token;
- set a monthly Google Maps Platform budget of USD 50 with alerts at 50%, 75%,
  90%, and 100%; and
- monitor request count per completed selection because Google documents the
  Autocomplete-plus-Geocoding flow as cost-effective when selection averages
  four or fewer Autocomplete requests.

Provider quotas are rate ceilings, not spend caps. Budget alerts are advisory
and do not stop requests or guarantee a USD 50 maximum. The production operator
owns verification of the two quota values, budget, four alert thresholds, and
alert recipients before changing rollout to `enabled`.

## Primary sources

All sources were reviewed on 2026-08-26. Dates in parentheses are the page's
reported publication or last-update date where the reviewed page supplied one.

- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
  (accessed 2026-08-26): §3.2.2 flow-down; §4.4 independent collection, use,
  consent, and location-privacy duties.
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
  (2026-06-10): §§6.3.1–6.3.2 Geocoding caching and §14.3 Places caching.
- [Google Maps Platform EEA Service Specific Terms](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)
  (accessed 2026-08-26): EEA Geocoding §6.2.2 indefinite direct-user caching,
  Places §15.2 permitted-use restriction, and Places §15.4 30-day coordinate
  caching.
- [Places API permitted uses for EEA billing addresses](https://cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses)
  (accessed 2026-08-26): permitted use (1), address lookup and autocompletion.
- [Google Controller-Controller Data Protection Terms](https://business.safety.google/controllerterms)
  (accessed 2026-08-26): independent-controller roles and cross-border transfer
  terms.
- [Google Cloud services with configurable data residency](https://cloud.google.com/terms/data-residency)
  (accessed 2026-08-26): no documented Maps, Places, or Geocoding residency
  control.
- [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
  (updated 2026-08-25): `(cities)`, field masks, performance, and the
  per-request Autocomplete-plus-Geocoding flow.
- [Autocomplete REST method](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/autocomplete)
  (2026-05-15): POST body and prediction fields.
- [Places policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies)
  (accessed 2026-08-26): Google and third-party attribution requirements.
- [Geocode a place](https://developers.google.com/maps/documentation/geocoding/places-geocoding)
  (updated 2026-08-18): v4 GET path, API-key header, response, and field-mask
  header.
- [Geocoding API v4 overview](https://developers.google.com/maps/documentation/geocoding/geocoding-v4-overview)
  (accessed 2026-08-26): 25 QPS default quota, server-to-server design, and
  field masks.
- [Geocoding v4 result fields](https://developers.google.com/maps/documentation/geocoding/reference/rest/v4beta/GeocodeResult)
  (accessed 2026-08-26): `formattedAddress`, `location`, `granularity`,
  `types`, and `addressComponents`.
- [Google Maps Platform coverage](https://developers.google.com/maps/coverage)
  (updated 2026-08-25): country coverage and provider-contract change risk.
- [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
  (updated 2026-08-25): method/project quotas, field-mask billing, and quota
  controls.
- [Google Maps Platform SLA](https://cloud.google.com/maps-platform/terms/sla)
  (accessed 2026-08-26): covered services and 99.9% monthly uptime commitment.

## Consequences

Tasks 3–7 may implement this frozen decision without changing the app-owned
provider interface. Implementation remains pending and committed rollout stays
`off` until the separate enablement gate. Any change to endpoint, field mask,
provider id, retention model, attribution, consent, disclosure, confidence
mapping, or governing terms requires a new dated rights review before
deployment.
