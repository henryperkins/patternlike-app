# Geocoder Provider, Rights, and Privacy Decision

- **Date:** 2026-08-26
- **Status:** Approved; implementation pending
- **Decision owners:** Product, privacy, and legal
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

A pure Places Autocomplete plus Place Details design is rejected. Section 14.3
of the current Google Maps Platform Service Specific Terms limits Places API
latitude/longitude caching to 30 consecutive days. That cannot support an
account-lifetime encrypted birth profile.

The composite passes because its durable coordinates and address come from
Geocoding API v4. Section 6.3.2 expressly permits indefinite caching of
Geocoding latitude, longitude, `formatted_address`, and structured address
values when all of the following remain true:

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
| 1 | Send the user-entered query from the Worker | After disclosure and consent, the Worker sends the query only as Autocomplete's JSON `input`; the documented endpoint accepts this use. | Pass |
| 2 | Return suggestions to that user | Only narrowed place predictions are returned to the requesting user, with visible Google attribution; they are neither shared nor retained. | Pass |
| 3 | Retain the selected normalized label and coordinates in the encrypted birth profile for the account lifetime | Selection is resolved with Geocoding API v4, not Place Details. Service Specific Terms §6.3.2 permits indefinite, direct-user, logically isolated Geocoding caching. Pure Places/Place Details fails this condition because §14.3 caps Places coordinates at 30 days. | Pass |
| 4 | Retain no unselected query or result payload | Within Pattern/Like, query and suggestions exist only in request memory. Safe logging, analytics, D1, and audit events receive no query, candidate, or provider payload. Google's separate controller retention is disclosed below. | Pass |
| 5 | Delete selected data with the account | The narrowed selection is encrypted under the user's DEK and is included in account deletion and crypto-shredding. Google remains an independent controller of the request data it separately collects; Pattern/Like cannot represent account deletion as deletion of Google's controller records. | Pass |

**Hard-gate outcome:** `google_places_geocoding_v4` passes. Pure Places plus
Place Details does not.

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

The confidence policy uses the most specific accepted type found in the result
or its address components:

| Google type | App confidence | Qualifier |
|---|---|---|
| `locality` or `postal_town` | `high` | Add `approximate_match` only when `granularity` is `APPROXIMATE`. |
| `sublocality` or `sublocality_level_*` | `medium` | Add `approximate_match` when `granularity` is `APPROXIMATE`. |
| `administrative_area_level_*` | `low` | Add `region_level_match`; also add `approximate_match` when applicable. |
| No accepted type, unknown type-only result, or unknown granularity | Refuse | Do not guess or store a result. |

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

The Google logo/required Google attribution must be visible with the
Autocomplete suggestions and beside every displayed stored selected result,
including later onboarding review. Any provider-supplied third-party
attribution required by current documentation must also be shown. Attribution
must not be hidden behind interaction or removed after selection.

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
default 25 QPS project quota. Pattern/Like will:

- keep the existing combined app limit of 30 search/resolve requests per
  authenticated user per 60 seconds;
- debounce search by 300 ms and require at least two Unicode code points;
- request only the frozen field masks;
- use per-request Autocomplete billing without a Google session token;
- set project-level method quotas as the hard spend ceiling;
- configure quota alerts and billing-budget alerts before production; and
- monitor request count per completed selection because Google documents the
  Autocomplete-plus-Geocoding flow as cost-effective when selection averages
  four or fewer Autocomplete requests.

## Primary sources

All sources were reviewed on 2026-08-26. Dates in parentheses are the page's
reported publication or last-update date where the reviewed page supplied one.

- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
  (accessed 2026-08-26): §3.2.2 flow-down; §4.4 independent collection, use,
  consent, and location-privacy duties.
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
  (2026-06-10): §§6.3.1–6.3.2 Geocoding caching and §14.3 Places caching.
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
provider interface. Implementation remains pending. Any change to endpoint,
field mask, provider id, retention model, attribution, consent, or confidence
mapping requires a new dated rights review before deployment.
