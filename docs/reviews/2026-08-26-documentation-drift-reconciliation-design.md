# Documentation Drift Reconciliation Design

**Date:** 2026-08-26  
**Status:** Approved for planning

## Goal

Reconcile current repository documentation with the implementation and committed
configuration without rewriting historical evidence or implying that an
unimplemented feature exists.

## Scope

Update current authorities outside `docs/superpowers/`:

- `README.md` and `CLAUDE.md`;
- deployment and rollout documents under `docs/deploy/`;
- implementation-status statements in the normative `spec-bundle` source and
  its generated siblings;
- stale runtime comments and user-facing copy that describe retired behavior;
- historical reviews under `docs/reviews/` only by adding a prominent snapshot
  notice and links to current authorities.

All files under `docs/superpowers/` are explicitly out of scope.

No runtime behavior, contract, migration, binding, rollout value, secret, or
remote deployment changes as part of this work.

## Authority Rules

1. Code and committed configuration establish repository state.
2. Deployment runbooks must distinguish committed configuration from observed
   live state. Neither may silently stand in for the other.
3. Current summaries may be rewritten; dated evidence rows remain unchanged.
4. Historical reviews retain their original findings. A notice identifies the
   review as a point-in-time snapshot and links to the files that supersede each
   resolved absence claim.
5. Normative product intent is not weakened to match missing implementation.
   Only factual implementation-status prose is corrected.
6. An implemented-but-disabled capability is described separately from an
   unimplemented capability and from an unexecuted operational gate.

## Reconciliation Set

The update will:

- remove claims that privacy export/deletion, reading feedback, Auth0 sign-in,
  the Pattern provider adapter, ontology pipeline, and replay runtime are absent;
- correct retired Fly PWA and Worker deployment statements;
- align committed rollout summaries with `apps/api/wrangler.toml`, while
  preserving separately dated live observations;
- state that editorial fixture evaluation exists in `packages/reading-engine`
  but is not wired into content-release ingestion;
- state that persisted `account_processing` consent remains unimplemented;
- update daily-reading locale copy to describe model-written readings;
- remove unreachable-stub and nonexistent-engine comments;
- update the v0.5 statement that check-ins are unimplemented, without claiming
  journals or external connectors exist; and
- mark superseded review findings as historical rather than deleting them.

## Verification

Verification will include:

- a targeted search for every stale phrase identified by the audit, with any
  retained historical occurrence explicitly allowlisted;
- regeneration and validation of changed `spec-bundle` derivatives;
- `npm run test:contracts`;
- the affected web component tests and web typecheck for user-facing copy;
- link/path checks for every new supersession reference;
- `git diff --check`; and
- a final diff review confirming that `docs/superpowers/`, runtime behavior,
  contracts, migrations, and rollout configuration are unchanged.

