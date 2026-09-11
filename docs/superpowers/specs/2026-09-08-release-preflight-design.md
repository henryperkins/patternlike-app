# Slice 2: verification expansion withdrawn

Date: 2026-09-08. Superseded: 2026-09-09 by the user's decision to simplify verification and prioritize application improvements.

Parent: [Delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Direction: [Application alignment roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md).

## Decision

The proposed release-preflight implementation is withdrawn. Slice 2 requires no implementation and is not a dependency for any other slice. Its number is retained so existing references remain understandable.

Do not add release wrappers, summary sidecars, candidate-tree comparison, PR-body checks, remote observations, or new compatibility-record formats for this roadmap. The [existing release-evidence tooling](../../../scripts/pattern-release/release-evidence.mjs) and [release runbook](../../deploy/repository-release-evidence.md) remain available as they are.

## Verification for the remaining work

Use existing commands and focused tests for the behavior being changed. Extend relevant regression cases where needed; do not add gate stages, mandatory map checks, or new approval and evidence workflows. Local implementation does not require the full local gate under the user's instruction. Existing [repository merge policy](../../../AGENTS.md) remains applicable when a merge is actually undertaken.

Source-map capture, checking, and `test:source-map` are optional maintenance commands. They are not part of `test:content` or a prerequisite for product work. Preserve dated map snapshots and earlier verification results as history.

Migration compatibility, permission handling, and deployment checks still belong to changes that actually need them; this decision creates no new checklist or record format.

## Next work

Proceed from the corrected source inventory to Slice 3's interpretation-quality baseline and Slice 4's connected reader journey. Use their findings to select changes that improve what readers receive and understand.
