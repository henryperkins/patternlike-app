# Slice 4: authorized reader journey implementation

Date: 2026-09-09. User authorization: “finish slice 4 with real, authorized reading data.”

Scope follows the approved [reader relationship specification](../specs/2026-09-08-reader-relationships-feedback-design.md). The initial local implementation below remains a dated record. The subsequent “Approved next steps” authorization included a separate Slice 4 release, recorded at the end of this document.

1. Retain encrypted support for the accepted paragraphs and chapters in the existing atomic Daily and Pattern publication transactions. Bind support to owner, document revision, and content hash. Register account key rotation and erasure; preserve frozen export contracts.
2. Add authenticated, owner-scoped source discovery, bounded relationship reads, source-bound destination reads, and exact retained Timing detail. Recheck current eligibility on every request. Existing editions without sufficient retained support yield no supported connection.
3. Connect the application’s real reading view to explanations, exact Pattern observatory chapters, retained Timing passes, and saved Daily editions. Reuse existing response controls. Revalidate on navigation and lifecycle changes, preserve return position, and keep complete text available without artwork.
4. Verify the resolver, encrypted D1 publication/read/cleanup paths, additive contracts, frontend navigation, and rendered behavior using existing focused commands. Update the existing Pattern source fingerprint after publication changes. No new gate stages, commands, or release wrappers.
5. Record implementation results and deployment limits in the roadmap and delivery ledger. Software checks do not establish human comprehension or improved interpretation quality.

## Execution record

Software implementation is complete locally. The [roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md), [delivery ledger](2026-09-07-mind-map-alignment-slices.md) and [specification](../specs/2026-09-08-reader-relationships-feedback-design.md) now distinguish this implementation from production deployment and the outstanding human comprehension exercise.

### Result

- Accepted V5 Daily paragraph references and Pattern chapter aliases produce typed support under the existing publication proof. The encrypted support and document publish together or roll back together. Revision/hash coordinates stay encrypted; owner/document references support deletion and rotation.
- Four read-only endpoints use existing authentication/account state, exact stored hashes, actual paragraph/chapter coordinates and current destination eligibility. Candidate scans are bounded and expose truncation. Graphs admit only shared calculated features, shared natal participants and dated occurrences; public evidence identities contain digests rather than raw chart coordinates.
- A shared transit fact must match its retained cycle hash/pass/date/zone/policy. Daily positions and Pattern positions use identical within-sign normalization; symmetric natal aspects use the existing canonical body pair while directed transit roles remain distinct. Similar prose, changed chart data or a rescanned cycle cannot substitute for original evidence.
- The production ReadingArticle connects Today/History to explanation, exact Pattern chapter, retained Timing pass and saved Daily. Existing feedback submission remains explicit and explains its current bounded grant effect. No provider packet, prompt, feedback category or consent policy changed.
- Back retains each visit’s paragraph/hash, focus and scroll without preparing Today again. Foreground and destination reads revalidate access. Existing three-to-six-chapter observatory and complete text work without generated artwork, artwork grants or generation requests.

### Verification

Node 22.23.2, Python in the existing worktree virtual environment. Focused checks used existing commands; no new gate stage, verification command, release wrapper or full `ci:local` run.

| Check | Result |
| --- | --- |
| API focused suites below | 11 files, 161 tests passed |
| Affected/new web suites below | 9 files, 152 tests passed |
| Existing AccountPortraitExplorer suite | 30 tests passed |
| Existing App account/lifecycle suite | 46 tests passed |
| Shared, API (Worker and scripts), web typechecks | Passed |
| Existing schema/OpenAPI validator | Passed, including 11 valid and 11 invalid additive reader fixtures |
| Existing D1 migration smoke check | Passed |
| Existing Pattern source check and its tests | Current; 3 fingerprint tests passed |
| Application browser QA | Desktop 1440×1000 and mobile 390×844 passed; screenshots and scope below |
| Documentation links, original inputs and whitespace | Passed; original checkout and prior archived evidence preserved |

API command, from `apps/api`:

```bash
npx vitest run \
  src/services/reader-relationship-resolver.test.ts \
  src/services/reader-relationship-support.test.ts \
  src/services/generate-daily-reading-v5.test.ts \
  src/services/pattern-lifecycle.test.ts \
  src/services/pattern-publication-proof.test.ts \
  src/db/encrypted-columns.test.ts \
  src/services/deletion-manifest.test.ts \
  src/routes/reader-relationships.integration.test.ts \
  src/routes/privacy-export.integration.test.ts \
  src/routes/privacy-deletion.integration.test.ts \
  src/routes/internal-pattern-replay.integration.test.ts
```

Web commands, from the repository root:

```bash
npm test --workspace=@patternlike/web -- \
  src/components/ReadingConnections.test.tsx \
  src/components/ConnectedPatternReading.test.tsx \
  src/components/ReadingArticle.test.tsx \
  src/components/ReadingFeedbackCard.test.tsx \
  src/components/portrait-explorer/use-explorer-navigation.test.tsx \
  src/components/portrait-explorer/PortraitExplorer.test.tsx \
  src/components/HistoryView.test.tsx \
  src/lib/pattern-portrait.test.ts \
  src/preview/reader-journey-preview.test.tsx
npm test --workspace=@patternlike/web -- src/components/AccountPortraitExplorer.test.tsx
npm test --workspace=@patternlike/web -- src/App.test.tsx
npm run typecheck --workspace @patternlike/shared --workspace @patternlike/api --workspace @patternlike/web
.venv/bin/python contracts/validate_schemas.py
.venv/bin/python contracts/smoke_check.py
npm run check:pattern-source --workspace @patternlike/api
npm run test:pattern-source --workspace @patternlike/api
```

The expanded API check exposed an existing receipt-test race: the real privacy queue could complete deletion before a test asserted `queued`. That acceptance test now controls delivery and asserts the exact queue message, preserving its strict lock/revocation/encryption/receipt checks. Existing delivery tests still exercise deletion completion. Production deletion behavior is unchanged.

The source fingerprint now includes both publication-support helpers and is `sha256:dd93fde6dbc7f7de8c7598c3eafc70912533e41efe66b4a964f08206f2985e34` over 32 sources. This updates existing source identity; it does not add a check. Independent API and persistence reviews found no blocking issue.

[Browser results and screenshots](../../reviews/artifacts/reader-journey/2026-09-09-authorized-implementation/README.md) cover the actual application, exact observatory chapter 3, full text, retained Timing pass, saved revision, existing feedback mutation, keyboard/Back focus and scroll, foreground unavailability, support gaps and mobile wrapping. No application console errors/warnings occurred. The final mobile saved-reading axe scan reported no WCAG A/AA violations. Browser responses were contract-shaped test fixtures; server tests separately used test-owned records, actual encrypted D1, and accepted publication code. This does not claim a live personal-account test or application-wide accessibility certification.

### Release and evaluation boundary

Migration 0030 must be applied before compatible Worker code is deployed. This task did not migrate production, deploy, merge, push or generate a live account reading. Earlier editions without retained passage evidence remain readable with no supported connection; there is no historical backfill or retention extension. Pattern support follows existing current-document eligibility and does not create a historical Pattern library.

A consented human comprehension exercise remains open. Navigation tests establish the working software path; they do not establish that a person understands the connections or that interpretation quality improved. At this initial implementation boundary, Slice 5’s categorized feedback and Slice 7’s shared permission-consequence presentation remained separate planned work. Slice 5’s subsequent local implementation is recorded in its [own plan](2026-09-09-reader-feedback-implementation.md).

## Authorized separate release — 2026-09-09

[PR 52](https://github.com/henryperkins/patternlike-app/pull/52) released only the authenticated reader journey, support storage/lifecycle, additive contracts, client navigation and associated verification. The candidate branch `codex/reader-journey-release` ended at `308178ab69cd7c0c1978d678040743f7bf4accac`; the merge at 06:59:35 UTC produced `c4e94f2257c258e8c06f80e6b77df698838234b2`. Local map tooling, ontology candidates, the publication-safety 1.0.1 fix and Slice 5 were excluded.

The existing `npm run ci:local` merge gate passed all 14 steps on that exact candidate, and its complete summary was pasted into the PR before merging. Environment: Node 22.23.2, npm 10.9.8, Python 3.14.4; the summary discloses the Python difference from CI’s 3.12. The initial run exposed one obsolete Today layout assertion after passage wrappers were added; the corrected test preserves the lead paragraph and adjacent evidence assertions. The full rerun passed. This reused the existing merge procedure and added no verification stage.

Production D1 migration `0030_reader_relationship_supports.sql` was applied and recorded at **06:58:26 UTC**, before the merge. The migration history, ten expected columns, composite owner/document cascade references and empty initial support table were verified. No historical support was backfilled. The immediate pre-release Pattern-job aggregate had eight successes and seven failures, with no unfinished job observed; it is a dated aggregate, not an ongoing queue guarantee.

Workers Builds run `77df2ecd-0b91-4513-bce7-53f6345f441c` for the merge commit completed successfully at **07:00:55.257 UTC**. Deployment `d4e0392e-18fe-476c-a11f-c76213c149b1`, created at 07:00:43.866 UTC, serves 100% Worker version `f637dc53-4824-4415-8160-bf98e551c209`. The released Pattern creation source fingerprint is `sha256:dd93fde6dbc7f7de8c7598c3eafc70912533e41efe66b4a964f08206f2985e34`.

Public curl checks at approximately 11:02–11:09 UTC observed:

- Worker `/health`: HTTP 200 with `ok: true`, service `patternlike-api`, environment `production`.
- [Production application](https://pattern.lakefrontdev.com/): HTTP 200 for the app shell.
- [Production metadata](https://pattern.lakefrontdev.com/v1/meta): HTTP 200 with `release_git_sha` equal to the merge commit, `worker_version_id` equal to the version above, and `auth_stub: false`.
- The new `/v1/readings/:id/relationship-source` route with well-formed test coordinates and no session: HTTP 401 `unauthorized`, with `Cache-Control: private, no-store`.

These checks establish the deployed identity, public liveness and unauthenticated rejection. They do not demonstrate an authenticated personal reading or prove a supported connection exists in older data. No account session was fabricated, live reading generated, provider request made, or reader result invented. The [human-review worksheet](../../reviews/artifacts/reader-feedback/2026-09-09-implementation/human-review-worksheet.md) remains unfilled; a signed-in reader check was requested separately.
