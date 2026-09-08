# Branch cleanup and documentation integration — 2026-09-08

Reviewed main: `c991c8a832454aab4418e812d9db4644ab34dea2`. This integration
preserves the three complete Cursor portrait reviews and their captured
evidence, and updates the useful documentation from PR #50 against current
source. It changes documentation and historical artifacts only. It does not
implement additional portrait interactions or establish new production,
provider, device, or browser verification.

The four original remote branches remain pending at the user's request.
Their retained source identities are recorded below. Incorporating historical
reports does not make their original findings current again.

## Documentation from PR #50

Source: [PR #50](https://github.com/henryperkins/patternlike-app/pull/50),
`cursor/engineering-documentation-updates-6f3e` at
`330ee55bf9a6ca9a8e9977953d1170f1c912e73d`.

| Topic | Incorporated guidance and source check |
| --- | --- |
| History and Save | README and CLAUDE now document query bounds, canonical history ordering, saved revision ordering, empty-body/idempotent Save behavior, ownership and deletion. Checked against `apps/api/src/routes/readings.ts`, `apps/api/src/db/readings.ts`, `apps/api/src/db/reading-saves.ts`, migration 0028 and the deletion manifest. These later features were not added to the M1-only checklist. |
| Observatory versus generated artwork | PR #50 predates PR #51. The docs distinguish default observatory presentation for three to six chapters from the current four-chapter artwork-generation contract. Local folios and complete reading do not require artwork generation, automation consent or a ready model. Checked against `AccountPatternPortrait`, `AccountPortraitExplorer`, the portrait services, and the [default-observatory release](2026-09-08-default-pattern-observatory.md). |
| Artwork operations | Preserved the exact API/runner flag predicates, current request/confirmation fields, chart-scoped automation, D1 polling and maintenance, artifact encryption and private download boundary. Checked against the portrait routes/services, `wrangler.toml`, runner README and deletion/export manifest. The flags describe committed configuration, not a fresh host or provider observation. |
| Migration 0029 | Replaced the inference that the prospective source note meant 0029 remained unapplied. The [separate apply receipt](artifacts/2026-09-07-release-attestation/production-migration-0029.json) and [release review](2026-09-07-release-attestation-merge.md#completed-deployment-prerequisites) record the September 7, 10:15:26 UTC apply. Runbooks now link that dated evidence without changing `MIGRATIONS.json` or claiming a new live query. |
| Geocoder and dated inventories | Retained local `GEOCODER_ROLLOUT=enabled` plus key guidance, the dedicated-ledger-note gap, and the distinction between default/off and committed production/enabled. Marked old content-release, cron and route inventories as historical. Checked current configuration and the existing dated runbooks; no new live inventory was requested. |

## Complete portrait review sources

The report bodies, three measurement files and 44 screenshots are preserved.
Only a preservation notice was prepended to each report. The
[provenance manifest](artifacts/2026-09-07-cursor-portrait-reviews/provenance.json)
records original Git blobs, byte counts, SHA-256 values and preserved-file
hashes for all 50 files. Relative artifact locations are unchanged.

| Source | Retained branch and commit | Original reviewed source |
| --- | --- | --- |
| A — [3D portrait interaction and workflows](2026-09-07-portrait-3d-interaction-workflows.md) | `cursor/3d-model-ui-workflows-b7ef`, `607d39d08cb643d734fdf124f2be9ba0dcd848b9` | `6e706741f03253f2807d33380afb529161f3481f` |
| B — [3D explorer UI workflows](2026-09-07-3d-model-ui-workflows.md) | `cursor/3d-ui-workflow-review-39e1`, `9f87b839047dab67e8c308a5fabac75e94ed2301` | `76b4671cb3392dec1424aab18929927613d72011` |
| C — [3D model interaction, UI and workflows](2026-09-07-3d-model-interaction-ui-workflows.md) | `cursor/3d-model-ui-workflows-review-d137`, `591d073bcb9261bc823f4dc220f1191574674fad` | `76b4671cb3392dec1424aab18929927613d72011` |

These are the complete versions of the extracts previously folded into the
[remaining priorities](2026-09-07-portrait-remaining-priorities.md). The original
audit could not retrieve the authenticated Cursor pages. The files are now
available through their Git branches; the old access limitation no longer
describes this repository's evidence inventory.

## Disposition against current source

| Historical finding or proposal | Current disposition |
| --- | --- |
| Browser Back remains in sky and silently changes the underlying facet | Addressed by R1. Sky/body are part of semantic navigation and the history/session model; later regression coverage is retained. |
| Named chapter choices and phone reading return are hard to reach | Addressed by R2's control order, explicit Explore/Read destinations and sticky reading navigation. Old viewport coordinates are not measurements of the current implementation. |
| Comparison removes the model or does not identify the chosen pair | Addressed by R3's two-object scene, named comparison controls and complete reading. Preserve both spatial comparison and the originating reading context. |
| Framing, picking and account investigation state reset unexpectedly | R4 added physical-bounds framing, visible-geometry picking and private session retention for camera, sky, lighting, roof, desks and turns. The original compass-framing and Whole-portrait no-op claims were already narrowed or withdrawn in the corrected review. |
| Account entry requires four chapters, a ready model and an explicit open action | Superseded by PR #51's default three-to-six-chapter observatory and local folios. Optional v1 artwork generation still requires four chapters and the existing grants. |
| Selected chapter identity and facet/passage feedback are weak | R5 remains open. Retain a chapter's name and source-bound feedback; the reports do not justify inventing additional interpretive geometry or moving the camera while someone reads. |
| Desktop prose continuation and image/compare actions are easy to miss | R6 remains open from the existing review. Source still places those actions after the chapter text inside the bounded reader. |
| Remove the courtyard, force reassembly on Whole portrait, or remove the second-tap desk operation | Not adopted as cleanup fixes. The [local design contract](../../apps/web/src/components/portrait-explorer/DESIGN.md) retains the authored observatory, distinct overview/reset/layout actions, and the clarified desk interaction. These proposals do not override the approved direction. |
| Promote tilt controls and teach facets during the guide | Retained as UX triage candidates. Source still places Tilt up/down inside Scene controls & motion and guides chapters. Current rendered discoverability and priority were not remeasured; this review does not label them new reproduced blockers. |

R5, R6 and the existing P3 wording/semantics/token items remain the actionable
backlog. Historical reports retain their original conclusions for attribution;
the dispositions above and the consolidated priorities govern follow-up work.

## Completed workspace cleanup

Before removal, a private archive preserved all reachable Git history and
18,262 files from 11 old worktrees, including the original dirty
release-attestation prototype, ignored evidence, local configuration and the
August 28 stash. Only reproducible `node_modules`/`.venv` directories and Git
linkage were excluded from the file archives. Every archived file or symlink
was verified, the Git bundle was restored and checked, and the dirty prototype
was restored with matching file hashes and Git status.

- Removed 11 old worktrees and one missing worktree registration.
- Removed 11 merged local branches and 13 merged or superseded remote branches.
- Archived and dropped the old reconciliation stash.
- Stopped the orphaned Vite preview from the PR #51 worktree.
- Retained main and all four pending remote branches listed above.

Recovery is in the private directory
`/home/henry/patternlike-archives/branch-cleanup-20260908T173101Z/`.
Its README includes the tested restoration helper; `BACKUP.json` and
`metadata-cleanup.json` record hashes, original refs and completed actions.
Private files are not included in this documentation commit.

## Verification boundary

This change adds no runtime code, contract, migration, dependency or generated
application asset. The prior R1–R4 implementation and its evidence remain
unchanged. Verification for this integration checks the preserved source
identities, JSON, relative documentation links and whitespace, followed by the
repository's `npm run ci:local` gate on the final documentation/artifact set.
The completed gate receipt is retained with the private cleanup record and
reported with the local commit. The four source branches and PR #50 remain
pending; this cleanup does not push the integrated documentation to main or
assert production adoption.
