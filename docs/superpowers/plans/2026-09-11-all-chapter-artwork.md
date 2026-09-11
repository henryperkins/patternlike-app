# Artwork for every supported Pattern chapter

The September 11 user request selects the previously conditional artwork expansion in `docs/superpowers/specs/2026-09-08-adaptive-observatory-contract-design.md`. Implement the existing v2 design for all supported counts, 3 through 6, while keeping existing four-chapter v1 assets and clients compatible. Preserve the uncommitted Observatory review refinements and Dockerfile edits.

This is local implementation and verification. Publishing, applying a production migration, installing the runner, and enabling production generation remain separate operations. The adaptive producer switch defaults off; it does not gate accepted asset reads, completion, cancellation, or cleanup. Existing grants retain their original scope, with explicit policy 2.0.0 for adaptive generation.

## Shared interfaces and storage

- [x] Add version-discriminated response, download, claim, graph, mesh-program, and automation types. Export v2 constants, `PortraitChapterCount` (3 | 4 | 5 | 6), and its validator. Preserve v1 schemas and graph bytes. V2 count is derived from the source and included in its response/claim bindings; index is less than that count.
- [x] Add v2 graph construction and validation with one contribution for every chapter and at most 84 stars per chapter. Keep the existing four-view mesh audit unchanged.
- [x] Add v2 contract fixtures for 3, 5 and 6 chapters plus invalid count/index/attribution cases, and wire validation into the existing contract checks.
- [x] Add migration 0033 with immutable parent `chapter_count` and `protocol_version`, preserving all existing v1 rows and references. Rebuild CHECK-constrained job/grant tables, preserve triggers and indexes, and test row/lease/asset identity, allowed indices, invalid writes, cancellation, consent withdrawal, and erasure.

## Generation and consumption

- [x] Update API reservation, ordered completeness checks, graph publication, reads and downloads to use the frozen count. Filter jobs by runner protocol before leasing. New capable clients send `X-Patternlike-Portrait-Protocol: v2`; missing header retains v1 behavior. Bind terminal operations to each stored job protocol. Add Vary response handling. Source inspection confirmed a same-origin Worker deployment with no CORS allowlist to extend.
- [x] Add explicit one-time and automation policy 2.0.0 paths and strict adaptive-switch parsing. Existing policy 1.0.0/1.1.0 continues to authorize four-chapter v1 work only. Renewed automation schedules eligible current work without duplicating existing portraits.
- [x] Update the installed-runner source to advertise v2, accept v1/v2 claims, compile compatible programs, and retain exact source/count/revision binding throughout completion and failure. Keep every per-job attempt, byte, image-sample, geometry and visual-audit limit.
- [x] Update account artwork validation, progress, source-image loading and downloads for all counts; preserve legacy reads and text fallback. Count-aware consent copy explicitly describes one image per chapter and automatic artwork. Preserve the existing station layout and source order.

## Verification and delivery

- [x] Use regression tests for 3/4/5/6 admission, complete image/model sets, last-chapter jobs, malformed sets and protocol compatibility; test consent/source/erasure fences without provider calls.
- [x] Run focused shared, migration, API, runner and web lanes on Node 22; run typechecking and builds, and attempt the repository suite. Record environment or pre-existing failures separately rather than weakening checks.
- [x] Verify rendered desktop/mobile access to final-chapter artwork and preserved comparison/readers using fictional fixtures; inspect the final diff and document the compatibility rollout and capacity envelope.

## Interface decisions

`protocol_version` is stored as `v1` or `v2`; existing rows default to `v1` and count 4. V2 image generation requests include `chapter_count` and consent policy 2.0.0. V2 responses without an accepted current document use `chapter_count: null`. V2 mesh authoring/compiler versions are distinct from v1. Completion/failure bodies for v2 explicitly carry their schema version and count/revision identity; v1 bodies retain their original shape. The negotiated capability header is not authorization.

## Implementation receipt

Implemented locally on September 11, 2026. Shared v2 contracts, migration 0033, image and mesh APIs, runner protocols, account consumers and the Observatory refinements are present. The independent review findings about OpenAPI compatibility and resuming reserved work after the adaptive switch is disabled were corrected and rechecked.

The deployment sequence and consent/capacity rules are in `docs/deploy/adaptive-portrait-artwork.md`. Local verification and fictional browser evidence are recorded in `output/observatory-v2-2026-09-11/verification.md`. The producer flag remains `0`; production migration, runner installation and deployment remain separate operations.

- [ ] Obtain a green `npm run ci:local` merge gate and record its full summary before any separately authorized merge. The local implementation checks are not a merge or production approval.
