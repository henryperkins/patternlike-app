# Slice 4: authorized reader journey implementation

Date: 2026-09-09. User authorization: “finish slice 4 with real, authorized reading data.”

Scope follows the approved [reader relationship specification](../specs/2026-09-08-reader-relationships-feedback-design.md). Work remains in `codex/source-map-maintenance`; no production migration, deployment, or provider generation is implied.

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

A consented human comprehension exercise remains open. Navigation tests establish the working software path; they do not establish that a person understands the connections or that interpretation quality improved. Slice 5’s categorized feedback and Slice 7’s shared permission-consequence presentation remain separate planned work.
