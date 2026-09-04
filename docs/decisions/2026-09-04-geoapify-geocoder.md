# Geoapify geocoder successor

Date: 2026-09-04. Provider switch requested by the repository owner. This
records the implementation decision, not a claim of signed legal review,
account provisioning, provider availability, or production deployment.

Supersedes the Google provider and outbound-transport parts of
[the historical decision](2026-08-26-geocoder-provider.md). No Google fallback.

## Provider and outbound data

- Server-side `GET https://api.geoapify.com/v1/geocode/autocomplete`, with only
  `text`, `type=city`, `format=json`, `limit=8`, and optional two-letter `lang`.
- Selection uses `GET https://api.geoapify.com/v2/place-details`, with only
  `id`, `features=details`, and optional `lang`.
- Both use the documented `x-api-key` header. `GEOAPIFY_API_KEY` is a Worker
  secret, never a browser variable or URL parameter. Redirects are refused.
- Unlike Google's POST autocomplete, Geoapify carries query text in the URL.
  This is an explicit transport-policy change. Never log outbound URLs,
  headers, raw responses, search text, or identifiers. Fetch errors are replaced
  with content-free adapter errors; route logs retain only outcome and count.
- Only selected provider identifiers and language are sent for resolution.
  A Geoapify ID can encode location information; it is not promised to be
  opaque. No user ID, birth date/time, consent ID, app session token, device
  location, cookies, or forwarded client-IP headers are included.
- Locale tags use their language subtag only when it belongs to the exact
  shared language enum in both endpoint OpenAPI documents. Unsupported tags,
  including valid two-letter tags such as `zu`, are omitted. Five-second aborts
  and existing per-user limits remain.

API shapes and header authentication were checked against official
[autocomplete docs](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/),
[autocomplete OpenAPI](https://apidocs.geoapify.com/assets/openapi/specs/address-autocomplete/address-autocomplete-api-openapi-specs.json),
[Place Details docs](https://apidocs.geoapify.com/docs/place-details/), and
[Place Details OpenAPI](https://apidocs.geoapify.com/assets/openapi/specs/place-details/place-details-api-openapi-specs.json).

## Normalization, permission, and retention

Search emits at most eight city candidates with only provider ID and two labels.
The response's coordinates, rank, raw source metadata, geometry, and unselected
results are not persisted. Resolution selects exactly one `details` feature,
validates its coordinates, and maps its own documented locality categories.
An address's containing `city` does not turn a building or POI into a city.
Unknown/country/continent categories fail closed. Confidence describes locality
granularity, not Geoapify match probability. Every result is qualified as a
place coordinate, not an exact birth address; broader regions are additionally
marked as region-level. See [the category definitions](https://apidocs.geoapify.com/docs/places/).

Provider `geoapify`, disclosure policy `geoapify-2026-09-04`, consent schema
`0.8.1`, and normalization policy `1.0.0` identify new records. A new explicit
AST-02 grant is required. Existing Google grants and idempotency histories do
not authorize this policy. Revocation remains available without a key.

`contracts/geocoder-v2` succeeds only the geocoder consent family, with a
one-route OpenAPI overlay. Frozen M0-M9 files are unchanged; place search and
resolution keep their provider-neutral M8 0.8.0 shapes. The prior Google
fixtures remain valid historical documents and are rejected by the successor.

Migration 0024 preserves all old selected-place rows, IDs, encryption bytes,
key versions, nonces, expiry/consumption metadata, ownership, and indexes.
Only the provider CHECK expands to admit Geoapify. The new runtime does not
reuse Google handoffs. Durable encrypted birth-profile values are unchanged.
Selected normalized data retains the existing encrypted, account-owned
24-hour handoff and account-deletion lifecycle; no raw response is retained.

Geoapify permits result storage/caching in its
[autocomplete product guidance](https://www.geoapify.com/address-autocomplete/).
Its [privacy policy](https://www.geoapify.com/privacy-policy/) describes request
logging and generally no more than 24 hours for successful request logs, not
a universal deletion guarantee. It describes EU hosting and infrastructure
providers including Cloudflare. Do not claim zero retention, EU-only network
transit, exclusion from every secondary use, a signed Pattern/Like DPA, or
deletion of provider records through Pattern/Like account deletion.

UI attribution links to Geoapify and OpenStreetMap beside suggestions and the
selected result. The adapter accepts only the documented `openstreetmap`
datasource with exact attribution `© OpenStreetMap contributors`, license
`Open Database License`, and URL `https://www.openstreetmap.org/copyright`.
Other or missing source notices are refused in both search and resolution;
uncovered content cannot be persisted. This deliberately limits coverage to
verified OSM-backed places, with manual entry retained. Expanding sources needs
an attribution-carrying successor contract or another reviewed complete notice,
not simply removal of this guard. The provider/policy pair on stored rows
identifies this fixed attribution policy, and public terms retain the notice.
This follows [Geoapify's storage attribution guidance](https://www.geoapify.com/geocoding-api/),
[free-plan attribution guidance](https://www.geoapify.com/pricing/), and
[OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
Operators must review [Geoapify terms](https://www.geoapify.com/terms-and-conditions/)
and choose an account/plan appropriate for actual commercial volume.

## Availability and release

Missing `GEOAPIFY_API_KEY` disables only place search, resolution, and new grants.
It must never make optional place search a dependency of every product route
or background job. `GEOCODER_ROLLOUT` still accepts only `off` or `enabled`.

See [the rollout runbook](../deploy/geocoder-rollout.md). Full local CI,
populated-migration checks, credential canary, migration-before-Worker order,
and an authenticated live search/resolve/withdraw journey are separate proofs.
