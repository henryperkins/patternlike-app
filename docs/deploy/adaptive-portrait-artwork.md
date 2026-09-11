# Adaptive portrait artwork rollout

Selected by the owner on September 11, 2026. This document describes the local
implementation and the required deployment order; it is not a deployment receipt.

V2 reserves the accepted Pattern's three-to-six-chapter count and creates one
image job per chapter. Explicit automation consent also permits one mesh job per
chapter. A ready result contains exactly that complete ordered set. The existing
three-attempt ceilings, image sample dimensions, transport limits, geometry
limits and four-view mesh audit remain unchanged. A six-chapter reading reserves
six image slots and six mesh slots when both pipelines are authorized, compared
with four of each under v1. No additional chapters are synthesized or omitted.

## Configuration and consent

| Setting | Committed value | Meaning |
| --- | --- | --- |
| `PATTERN_ADAPTIVE_PORTRAITS_ENABLED` | `0` in default and production vars | Exact `1` permits new v2 reservations. Any other value fails adaptive admission closed. |
| `PATTERN_PORTRAIT_ENABLED` | Production `1`, absent locally | Existing image service availability. |
| `PATTERN_PORTRAIT_MESH_ENABLED` | Production `1`, absent locally | Existing mesh service availability. |

The adaptive switch controls new reservations only. Turning it off leaves
accepted reads, downloads, retries, lease completion and erasure available.
Use the existing image/mesh controls for their separately documented operational
scope. Do not use the adaptive switch as an account-consent revocation mechanism.

Policy `2.0.0` is explicit complete-reading consent in both the one-time and
automation registries. One-time creation includes the accepted `chapter_count`.
Old policy `1.0.0` requests and automation `1.1.0` grants retain their four-chapter
scope. Renew automation only through the explicit reader action. Old accepted
assets remain readable without renewal or new provider calls.

## Compatibility sequence

1. Run the repository merge gate and the 0033 populated migration rehearsal.
   Before an authorized production migration, record a current export and D1
   recovery coordinates in the migration ledger.
2. Apply `0033_adaptive_portrait_artwork.sql` after 0032 as one D1 migration
   transaction. It rebuilds the constrained seven-table portrait family while
   preserving v1 rows, leases, grants, object references and completion times.
   Recheck foreign keys and integrity. Never disable foreign-key enforcement.
3. Deploy the compatible Worker with adaptive admission still `0`. Existing
   v1 complete/fail routes remain usable. Source invalidation and deletion work
   for both protocols.
4. Install and verify the compatible runner separately. Record the installed
   artifact hash and verify capability negotiation; a repository build alone
   does not establish installed support.
5. Ship the client that accepts both formats, exposes the explicit policy 2.0.0
   action, and preserves text and local stations when artwork is unavailable.
6. After separate operational approval, set adaptive admission to `1` and verify
   a consented source end to end. Observe all N image and model jobs and the
   ready/download count before extending rollout.

New runners and browsers advertise `X-Patternlike-Portrait-Protocol: v2` on the
existing authenticated routes. Missing capability means v1; unsupported values
are rejected. Claim queries filter protocol before leasing. Terminals bind
protocol, count, chapter and source revision to the stored lease. Old clients
receive a v1 unavailable response for a v2 portrait, while their text reading
remains available. Saved v1 artwork is returned in its original v1 envelope even
to a new client. Private responses use `Vary` for the capability header and
`Cache-Control: private, no-store`.

This repository serves the web client and API from the same Worker origin; it
has no cross-origin CORS allowlist. The custom header therefore needs no new
cross-origin permission here. Any separate cross-origin gateway introduced by an
operator must explicitly allow the capability header and retain private caching.

## Recovery and verification

Keep old artifacts and the new storage shape when rolling back producers. Do not
run a reverse table rebuild after v2 rows exist. Restoring D1 is a separate
incident operation and must account for the existing erasure replay ledger.
Disabling new v2 admission does not strand in-flight work or erase accepted assets.

Regression evidence includes counts 3/4/5/6, unsupported counts, ordered complete
sets, stale and mismatched terminal identity, old/new negotiation, revoked grants,
private downloads, and populated SQLite/local D1 migration checks. These use
fictional source and artifact fixtures. Live provider output, runner installation,
production migration and production behavior require their own release receipts.
