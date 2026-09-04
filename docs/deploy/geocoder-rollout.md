# Geoapify birthplace search rollout

Updated: 2026-09-04. Local implementation is not production proof. Record the
exact release SHA, Worker version/allocation, credential canary, and migration
receipt when the live switch is performed.

## Incident and successor

The Google enablement commit 2887937 reached production without its required
credential. The global configuration guard then rejected product routes with
503 configuration_error, even though /health returned 200. The earlier
statement that the enablement was unmerged was incorrect.

The Geoapify successor moves credential availability to the optional route
boundary. A missing GEOAPIFY_API_KEY or rollout off disables POST place search,
POST place resolve, and PUT geocoder consent. GET and DELETE consent, manual
birth entry, and unrelated product routes remain available. Google keys are
not read by the new runtime. The adapter and old tests are retained in Git
history, not as a fallback.

This first successor accepts only verified OpenStreetMap-backed Geoapify
results matching the displayed attribution. Unknown or other data sources are
refused, so coverage can be narrower than Geoapify's complete dataset. Manual
entry remains available. Do not remove this guard without supporting the other
sources' attribution requirements through display and retained-data reuse.

Design and source review: [Geoapify decision](../decisions/2026-09-04-geoapify-geocoder.md).

## Credential

1. Create a project and key at [Geoapify MyProjects](https://myprojects.geoapify.com/).
   No key is provisioned by gcloud. Do not paste it into a chat or commit it.
2. Save it locally as GEOAPIFY_API_KEY in apps/api/.dev.vars (mode 0600), or
   enter it directly into wrangler secret put GEOAPIFY_API_KEY --env production
   from apps/api. For a local Worker also set GEOCODER_ROLLOUT=enabled.
3. Keep it server-only. Browser referrer/origin restrictions do not match this
   server-to-server adapter; use a dedicated project and review provider key
   controls suitable for Worker egress. Never forward user headers to satisfy
   a restriction. Use the x-api-key header, never a URL query parameter.
4. Review [current plan limits](https://www.geoapify.com/pricing/) and set the
   provider project's usage controls before public rollout. The reviewed free
   plan offers 3,000 credits/day and 5 requests/second; free commercial use is
   limited under provider terms. The existing app limit is per user, not a
   global provider spending cap. No paid plan purchase is implied here.

## Verification and deployment order

- Run npm run ci:local on the final candidate and keep its complete paste-ready
  summary in the PR before merging. GitHub Actions remains billing-blocked;
  merging main still triggers Cloudflare Workers Builds.
- Run a real adapter canary with a synthetic city (not a user's birthplace),
  checking both autocomplete and details with the same server-side key header.
  Confirm the returned source notice passes the OSM attribution guard for each
  endpoint; mock success does not establish real city coverage.
  Report only status, candidate count, resolution/confidence, and key presence.
  Never log the key, outbound URL, raw provider payload, or real user data.
- Inspect the exact pending D1 migration ledger. Migration 0024 follows 0023;
  do not silently apply unexpected earlier migrations. Export a mode-0600
  backup outside the repo and record a Time Travel bookmark before mutation.
- Apply 0024_geoapify_place_resolutions.sql before deploying the compatible
  Worker. It rebuilds only the selected-place table and preserves existing
  Google rows byte-for-byte. Verify both indexes, provider CHECK, row counts,
  PRAGMA foreign_key_check, and PRAGMA quick_check after application.
- Provision the key before activating search. The code can safely deploy
  without it to restore non-geocoder routes, but that is not a working-search
  release and must not be reported as one.
- Verify the exact deployed SHA/version and 100% allocation. Check both the
  workers.dev origin and the production custom origin, asset manifest/hydration,
  and that an unauthenticated protected route returns 401 rather than the old
  503 configuration_error. Health alone does not establish recovery.
- In an authorized test account, prove no query is sent before permission,
  grant the current Geoapify policy, search, select, resolve to an encrypted
  account-owned handoff, and withdraw. Verify manual entry remains available.
  Do not create a birth chart or alter a real profile just for a canary.

## Rollback

Disable GEOCODER_ROLLOUT to stop new grants and provider calls. Consent reads
and withdrawal still work. Do not roll back to the Google-enabled/no-key
Worker, which restores the whole-product outage. The widened database remains
compatible with old Google rows and requires no destructive rollback.

## Evidence ledger

| Proof | Required evidence |
| --- | --- |
| Local merge gate | Final SHA and full ci:local summary |
| Credential | Dedicated Geoapify key present; no value recorded |
| Provider canary | Autocomplete and details succeed with x-api-key |
| Database | Backup/bookmark, exact migration receipt, integrity checks |
| Worker | Release SHA, version ID, 100% allocation, both live origins |
| Authenticated journey | Grant, search, selection, withdrawal, manual fallback |

No ledger entry may be marked complete based only on configuration or a mock.
