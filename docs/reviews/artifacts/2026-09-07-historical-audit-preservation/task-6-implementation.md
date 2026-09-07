# Task 6 implementation — historical audit preservation

## Scope and freeze

- Worktree: `/home/henry/patternlike-app/.worktrees/historical-audit-preservation-20260907`
- Branch: `codex/historical-audit-preservation-20260907`
- Frozen base/HEAD: `727acaa37b958d48ce90257738b58cb69a6bdd5d`
- Only the four documentation paths listed below are changed in the worktree.
- No commit, push, stash application/drop, branch cleanup, runtime edit, test, build, install, CI lane, browser run, or external call was performed.

## Frozen owned files

| Path | Full-file SHA-256 | State |
|---|---|---|
| `docs/reviews/2026-08-10-astrology-feature-reference-audit.md` | `255e3917798dcd9aefd4d9f03cef7de3db41ae9322fd645fb048d2fbef5f3c23` | added |
| `docs/reviews/2026-08-11-mobile-first-design.md` | `59e88f1239e49b06fbf2c434bc401d1bf7c6b65c67c6573d4d5a048792bc291a` | added |
| `docs/reviews/2026-08-28-competitive-systems-original-research.md` | `7ca3d0988d5bf1a53d5b8287f8c9a5cfc234b9164310eb65c290c47eb535cf81` | added |
| `docs/reviews/2026-09-07-historical-audit-preservation.md` | `e06d532a0b54322455346640b38022a3206e0bd63a21497baba1f79793a0fd65` | added |

Each preserved report has a dated historical notice, a relative link to the
shared index, a Markdown separator, and the exact marker
`<!-- ORIGINAL BODY STARTS BELOW. DO NOT EDIT. -->`. The byte contract begins
after the marker's LF byte.

## Provenance and original-body evidence

| Report | Immutable source and path | Git blob | Original-body SHA-256 | Bytes / lines | Exact checks |
|---|---|---|---|---|---|
| Astrology | `1a06419d76c617152262e15bc46916325d38a43c:docs/reviews/2026-08-10-astrology-feature-reference-audit.md` | `589ab334264ed276676eebc06ecd57f47162d77a` | `9584ccce16a77f95ae91097743fbfc4df476292ede85c5c82838fe95e12bad7d` | 28,202 / 328 | extracted body matches both the private original and `git show` byte-for-byte |
| Mobile | `980ed05832c9c167a9227a9cff61920b947737ae:docs/reviews/2026-08-11-mobile-first-design.md` | `5c8ed4f2dc548f149e91ea0de3263108bc5fdc10` | `31791aa248f1b141312e79f6f3ec220ea936980327a7b1094a868e8658085a67` | 15,051 / 305 | extracted body matches both the private original and `git show` byte-for-byte; includes the 2026-08-12 correction |
| Competitive | `17f1901676a5eae22b674c3d28f95d662220accf^3:CompetitiveSystemsAuditThePatternCo-StarAstrocom.md` | `cdd096ada0b05c935f567f2f9852705e7c32983d` | `da4cf2d6f4d48a74c82675bc44ade9e1f20a1358ce0f52e1256cae5b81a423d3` | 49,979 / 1,013 | extracted body matches both the private original and `git show` byte-for-byte |

The marker terminator was verified as LF (`10`) in all three files. The source
ref for the competitive body uses the immutable full stash ID and its third
parent; no moving stash index was used to read the body. The stash remains
present as `17f1901676a5eae22b674c3d28f95d662220accf`, and no source branch, worktree,
or stash was changed.

Supersession is documented without changing historical conclusions:

- Astrology supersedes reliance on `origin/claude/astrology-feature-reference-t40rqh`; no PR existed.
- Mobile supersedes reliance on PR #17 and `origin/claude/mobile-first-design-review-7h9bql`; its references to PR #18 remain historical observations.
- Competitive supersedes reliance on the stash-only root file. The stash
  creator is not treated as the report author. It is preserved at the distinct
  `docs/reviews/2026-08-28-competitive-systems-original-research.md` path.
- The existing `docs/reviews/2026-08-28-competitive-systems-audit.md` is retained
  byte-for-byte from base `727acaa37b958d48ce90257738b58cb69a6bdd5d`
  (Git blob `33a87f81da35d47f816712c6eba8582337c0c170`; SHA-256
  `d3898ad185034609d9a848894c2c8adfa871bcbfe6321925485344d425bbaf4d`).
  The two reports coexist; the stash snapshot does not replace that authored
  Patternlike comparison.

## Privacy and link inspection

All three original bodies were read before preservation. No credential values,
private keys, private customer records, email addresses, or customer identifiers
were found. The astrology and competitive reports use generic terms such as
secret, password, email, and phone number while describing public product
behavior or policy; those are not private values.

The astrology and competitive original bodies contain no Markdown links. The
mobile body contains one same-document fragment and two external GitHub PR
links. The mobile destination path is unchanged, and the fragment resolves to
the preserved `## How this was measured` heading. All new report-to-index and
index-to-report relative targets exist within `docs/reviews/`. External targets
and the historical research claims were intentionally not browsed or refreshed,
so their current availability and present-day accuracy remain unverified.

## Actual source checks

- Recomputed the three private-copy SHA-256 values and byte/line counts.
- Resolved each source object to its exact Git blob.
- Compared every private copy byte-for-byte with its immutable Git object.
- Extracted each preserved body by byte offset after the marker and compared it
  byte-for-byte with both sources; all three comparisons passed.
- Recomputed the three extracted-body SHA-256 values; all match the recorded
  values above.
- Verified every new report/index link and the retained-audit coexistence link
  resolve locally, and the mobile fragment target heading remains present.
- Ran a whitespace-error diff check against each added file; all four were
  clean.
- Inspected `git status --short --untracked-files=all`; it lists exactly the
  four owned documentation paths.

## Remaining limits

- These are historical snapshots. No old finding is represented as current,
  fixed, or production-verified.
- External URLs were preserved byte-for-byte and were not checked.
- No tests were run because the latest user instruction permits only tests
  directly related to 3D Pattern animation, and this task changes documentation
  only.
- Root still owns predecessor integration, independent review, commit, PR, and
  merge. Any integration edit to one of the four frozen files invalidates the
  corresponding full-file hash and requires repeating the body-byte check.
