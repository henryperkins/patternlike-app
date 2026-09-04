# Google birthplace search — rollout and evidence runbook

**Created:** 2026-09-04

**Status:** The production configuration commit that sets
`GEOCODER_ROLLOUT = "enabled"` exists on a branch and is **not merged**. Gate 3
is open: the production Worker has no `GOOGLE_MAPS_PLATFORM_API_KEY` (verified
2026-09-04 with `wrangler secret list --env production`), and no billing-account
region, quota, budget, alert, or canary has been recorded. Merging before the
secret exists makes `configGuard` answer `503 configuration_error` on **every**
product request, not just place search.

The decision and its mandatory order live in
`docs/decisions/2026-08-26-geocoder-provider.md` ("Fail-closed rollout"). This
file is where the production operator records each gate with the evidence
behind it, in the same spirit as `openai-pattern-rollout.md`.

## Why the order is what it is

- `checkSecureConfig` (`apps/api/src/middleware/config-guard.ts`) accepts only
  `off` or `enabled`, and when the value is `enabled` it requires a non-empty
  `GOOGLE_MAPS_PLATFORM_API_KEY`. The check runs on every product request and
  in `queue()`, so a missing key is a whole-product outage, not a degraded
  search. **Secret first, deploy second.**
- Under `off`, grant (`PUT`), search, and resolve answer a generic
  `503 geocoder_unavailable` and make no Google call; `GET` still serves the
  disclosure and state; `DELETE` still revokes. Rollback is therefore a config
  commit flipping the value back to `off`, and never deleting the secret while
  the value is `enabled`.
- The development block stays `off`. A local Worker enables the search by
  putting both `GEOCODER_ROLLOUT=enabled` and the key in `apps/api/.dev.vars`
  (mode 0600, never committed); `wrangler dev` lets `.dev.vars` override
  `[vars]`.

## Gate ledger

| Gate | Requirement (ADR) | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Provider adapter, consent routes, search/resolve routes, and config landed with both blocks `off` | `f1c6711` (2026-08-28) "api: add crypto and place control planes" | done |
| 2 | Public Terms and Privacy carry the Google flow-down; exact disclosure; complete attribution | `apps/web/public/terms.html` links the Google Maps/Google Earth Additional Terms; `apps/web/public/privacy.html` links the Google Privacy Policy and states independent-controller processing, separate retention, and the absence of a residency control. The disclosure is the shared `GEOCODER_CONSENT_DISCLOSURE_TEXT` served by `GET /v1/consents/geocoder`; "Google Maps" text attribution sits beside suggestions and the selected result in `PlaceAutocomplete.tsx`. Inspected 2026-09-04. | done |
| 3a | Tests | `scripts/wrangler-config.test.ts` asserts development `off` / production `enabled`; `config-guard.test.ts` covers the enabled-without-key refusal; `places.integration.test.ts` exercises the routes with rollout overridden to `enabled`. Run 2026-09-04 on the branch; `npm run ci:local` summary goes in the PR. | done |
| 3b | API-restricted secret on the production Worker | Absent on 2026-09-04 (`wrangler secret list --env production`). | **open** |
| 3c | Billing-account region recorded as `EEA` or `non-EEA` before provisioning | Not recorded. | **open** |
| 3d | Project quotas: Places Autocomplete (New) 120/min, Geocoding API 30/min | Not recorded. | **open** |
| 3e | Monthly budget USD 50 with alerts at 50 %, 75 %, 90 %, 100 %, and named recipients | Not recorded. | **open** |
| 3f | Successful internal canary in a non-reader-serving Worker version or environment | None. | **open** |
| 4 | Production enabled in a separate configuration commit and deploy | Branch prepared 2026-09-04; not merged. | pending 3b–3f |

## Operator procedure

Each step is recorded in the ledger above when done. Do not reorder.

1. **Record the billing-account region** (3c). It decides which Google Service
   Specific Terms govern; the ADR's rights analysis passes under both.
2. **Provision in Google Cloud.** Enable *Places API (New)* and *Geocoding
   API* on the project. Create an API key whose API restriction is exactly
   those two services. Worker egress has no fixed address, so the API
   restriction is the control; the key is sent only in `X-Goog-Api-Key` by the
   adapter, which calls `places.googleapis.com/v1/places:autocomplete` and
   `geocode.googleapis.com/v4/geocode/places` with frozen field masks.
3. **Quotas, budget, alerts** (3d, 3e). Set the two per-minute quotas, the
   USD 50 budget, the four alert thresholds, and the recipients. Record the
   values here. Quotas are rate ceilings, not spend caps.
4. **Put the secret on the production Worker** (3b). It prompts interactively;
   never pass the value as an argument:

   ```bash
   cd apps/api && npx wrangler secret put GOOGLE_MAPS_PLATFORM_API_KEY --env production
   npx wrangler secret list --env production | grep GOOGLE_MAPS_PLATFORM_API_KEY
   ```

   Putting a secret creates a new version of the *current* deployment, which
   still reads `off`, so nothing changes for readers yet.
5. **Canary without serving readers** (3f). The product path needs an Auth0
   session bound to the production origin, so a version preview URL cannot
   sign in. Use a local Worker with the real key instead: add
   `GEOCODER_ROLLOUT=enabled` and `GOOGLE_MAPS_PLATFORM_API_KEY=…` to
   `apps/api/.dev.vars`, run `npm run dev:api` and `npm run web:dev`, grant the
   permission on Privacy or in the birth form, type a city, pick a suggestion,
   and confirm coordinates and time zone resolve. The API log carries the
   `place_search_completed` safe-log event with its `outcome`. Remove the key
   from `.dev.vars` afterwards and record the date and result here.
6. **Merge the configuration branch.** Workers Builds deploys `main`. Then, on
   the live origin: the Privacy page reads the permission, a grant answers
   `Granted`, a search returns candidates, and
   `npx wrangler tail --env production` shows `place_search_completed`. Record
   the Worker version id here.

## Rollback

Flip `[env.production.vars] GEOCODER_ROLLOUT` back to `"off"` in its own
commit and merge. Existing grants stay recorded and stay visible on Privacy;
grant, search, and resolve answer `503 geocoder_unavailable`; withdrawal keeps
working, so no reader is trapped in a grant they cannot revoke. Leave the
secret in place — it is inert under `off`, and deleting it while the value is
`enabled` is the outage described above.

## Record

| Date (UTC) | Event | Evidence |
| --- | --- | --- |
| 2026-09-04 | Production secret inventory checked; `GOOGLE_MAPS_PLATFORM_API_KEY` absent. | `wrangler secret list --env production` |
| 2026-09-04 | Configuration branch prepared: production `enabled`, development `off`, config test and decision record updated. | this file's commit |
