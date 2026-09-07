# Historical audit preservation — 2026-09-07

This index records three historical report snapshots recovered into the
repository on 2026-09-07. They preserve what their original authors or research
sessions recorded at the stated dates. They are not refreshed status audits,
current production evidence, or confirmation that an old finding remains open
or has since been fixed.

Each report starts with a preservation notice and a distinct separator. The
original body begins immediately after the line
`<!-- ORIGINAL BODY STARTS BELOW. DO NOT EDIT. -->`. The SHA-256 values below
apply only to the bytes after that marker's terminating newline, including the
original final newline. Those bytes match both the private preservation copy and
the named immutable Git object.

## Astrology feature-reference audit

- Preserved report: [2026-08-10 astrology feature-reference audit](./2026-08-10-astrology-feature-reference-audit.md)
- Snapshot date: 2026-08-10
- Source: commit `1a06419d76c617152262e15bc46916325d38a43c`, path `docs/reviews/2026-08-10-astrology-feature-reference-audit.md`
- Source Git blob: `589ab334264ed276676eebc06ecd57f47162d77a`
- Original-body SHA-256: `9584ccce16a77f95ae91097743fbfc4df476292ede85c5c82838fe95e12bad7d` (28,202 bytes; 328 newline-terminated lines)
- Supersession context: this repository copy supersedes reliance on remote branch `origin/claude/astrology-feature-reference-t40rqh`; no pull request existed for that branch.

## Mobile-first design review

- Preserved report: [2026-08-11 mobile-first design review](./2026-08-11-mobile-first-design.md)
- Snapshot date: 2026-08-11, with the preserved 2026-08-12 follow-up correction
- Source: commit `980ed05832c9c167a9227a9cff61920b947737ae`, path `docs/reviews/2026-08-11-mobile-first-design.md`
- Source Git blob: `5c8ed4f2dc548f149e91ea0de3263108bc5fdc10`
- Original-body SHA-256: `31791aa248f1b141312e79f6f3ec220ea936980327a7b1094a868e8658085a67` (15,051 bytes; 305 newline-terminated lines)
- Supersession context: this repository copy supersedes reliance on PR #17 and remote branch `origin/claude/mobile-first-design-review-7h9bql`. The preserved body's references to PR #18 are historical observations, not current verification.

## Competitive systems original research

- Preserved report: [2026-08-28 competitive systems original research](./2026-08-28-competitive-systems-original-research.md)
- Research date recorded by the original body: 2026-08-28
- Source: third parent of immutable stash `17f1901676a5eae22b674c3d28f95d662220accf`, path `CompetitiveSystemsAuditThePatternCo-StarAstrocom.md`
- Source ref: `17f1901676a5eae22b674c3d28f95d662220accf^3`
- Source Git blob: `cdd096ada0b05c935f567f2f9852705e7c32983d`
- Original-body SHA-256: `da4cf2d6f4d48a74c82675bc44ade9e1f20a1358ce0f52e1256cae5b81a423d3` (49,979 bytes; 1,013 newline-terminated lines)
- Recovery context: this repository copy supersedes reliance on the stash-only root file. No pull request or source branch is associated with that untracked body. The stash commit metadata identifies the stash creator, but it does not establish authorship of the report, so this preservation record assigns none.
- Coexistence context: the existing [Patternlike competitive audit](./2026-08-28-competitive-systems-audit.md) remains unchanged at its established path. The distinct `original-research` name preserves both reports and avoids treating the stash snapshot as a replacement for that current authored history.

## Link and privacy inspection limits

The astrology and competitive original bodies contain no Markdown links. The
mobile original body contains one same-document fragment link and two external
GitHub PR links. Its file location is unchanged, and the fragment still targets
the preserved `How this was measured` heading. The notice and index links are
relative within `docs/reviews/`. External links and the historical reports'
research claims were not rechecked on 2026-09-07.

The three original bodies were read for credentials and private customer
details before preservation. They contain public company-policy descriptions,
generic data categories such as email, password, and phone number, and
repository evidence, but no credential values or private customer records were
found.

## Independent review

The frozen four-file preservation commit `f1bd449c5e5ad1338945c691a0c9f2f2e99a6998` received **PASS**, with no Critical or Important findings. The review verified immutable source blobs, byte-identical original bodies, corrected mobile content, unchanged existing competitive audit, provenance, relative links and obvious privacy exposure. Source refs and the stash remain preserved. Reports are in [the preservation artifacts](artifacts/2026-09-07-historical-audit-preservation/task-6-review.md).

Per the user's latest instruction, no tests unrelated to the 3D Pattern work were run for this documentation batch. There is no full-gate result for this candidate. Historical external claims were not refreshed.
