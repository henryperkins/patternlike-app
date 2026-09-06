# Reading History and Save implementation

Status: implementation, independent review, and local browser verification complete on `feat/reading-history-save`. The feature started from `ce52443` and now includes main through `eccddcc`, preserving its runner privacy fix and migration receipts. All 14 aggregate CI lanes passed. Production migration 0028 was applied before the compatible main release.

Readers can save one immutable Daily revision and revisit earlier chapters through History. History selects one readable artifact per local date, prioritizing published, then invalidated, then superseded revisions. Saved preserves every explicitly saved revision, including two revisions from the same date.

The implementation follows the [Reading History and Save plan](../superpowers/plans/2026-08-26-reading-history-and-save.md), with migration 0028 replacing the already-used 0019 and the existing M8 contract's required view filter taking precedence over the plan's original default.

## Compatibility and privacy

- Daily prose remains in its existing encrypted column. Saves contain only owner, exact reading id, and timestamp.
- Ownership, readable status, and ciphertext are required for historical detail, evidence, feedback, and Save. Unknown and foreign ids receive the same response.
- Historical detail retains its original M3 or M5 envelope and remains readable after chart correction. Today's active-chart rule remains in place.
- New account exports pin M8 and carry `saved_at` on the matching revision. Previously reserved export commands without the new pin retain M7 on retry.
- Account deletion removes saves before their reading rows.

## Verification record

Baseline: 79 existing API reading/privacy tests and 59 Today tests passed. Existing M8 contracts passed the complete contract suite before implementation.

The browser walkthrough uses the actual local Worker and ephemeral D1, with fictional encrypted readings and external service calls disabled. It exercises Today → Save → History → Saved → detail/evidence/feedback → Unsave, multiple revisions, pagination, and mobile keyboard navigation. Browser plugin/skill is unavailable, so validation uses Playwright CLI with the installed Chromium binary. The legacy plan's `/opt/cursor/artifacts` directory is not writable on this host; the video and browser artifacts are recorded under `/home/henry/.local/state/patternlike/reading-history-save-20260906`.

Focused implementation checks passed on Node 22.23.2:

- Projection, cursor, Save persistence, and reading routes: 4 files, 89 tests.
- Save/export/deletion/reading integration: 4 files, 110 tests.
- Related privacy, deletion, and maintenance: 5 files, 56 tests.
- Final complete web suite: 46 files, 582 tests; both API and web typechecks passed.
- Complete contract validation, including the frozen M8 fixtures/OpenAPI and fresh migration smoke: passed; all 28 migrations applied in the test database.

These overlapping focused counts are separate runs, not an aggregate test count.

Independent review found four web edge cases: re-saving from an open Saved detail, pagination after removing every loaded Saved item, expired-session recovery for feedback, and a delayed initial feedback request overwriting a successful submission. All four were closed with regressions. A further copy correction distinguishes an emptied loaded page from an entirely empty Saved library. The final reviewer reported no outstanding actionable findings; independent focused verification passed 4 files and 26 tests.

Final browser checks passed against real local Worker/D1 responses:

- Keyboard Save survived reload; History paginated from 20 to 23 canonical dates; Saved retained three exact revisions, including two from one date.
- Superseded and invalidated detail displayed all five original paragraphs, disclosure, accurate revision badges, and evidence. Historical feedback submission returned its saved confirmation.
- Unsave → Save in the open detail restored the revision at the correct Saved position. Back restored the opening control or the Saved filter after the opening row was removed.
- Unsave removed all three Saved rows and showed the empty state while canonical History retained its chapters.
- Keyboard filter navigation and mobile keyboard unsave passed. All six navigation links remained available at 320px, 390px, and desktop widths without horizontal overflow.
- Automated WCAG 2 A/AA and 2.1 AA checks found zero violations on History at 320/390/1440px and historical detail at 320/1440px, after entry animations settled. This is automated and keyboard evidence, not a claim of manual screen-reader testing.
- The console contained three expected 404 responses for absent historical feedback records; there were no other errors or warnings.

Artifacts are under `/home/henry/.local/state/patternlike/reading-history-save-20260906/final`: `reading-history-demo-3x.webm` is a 65-second walkthrough at 3× playback speed; `history-desktop.png`, `saved-desktop.png`, `historical-evidence.png`, `historical-feedback.png`, `history-320.png`, and `invalidated-detail-320.png` record the rendered flow. Fictional fixture dates and prose are test data, not generated readings for a real person.

The repository includes [desktop](artifacts/2026-09-06-reading-history-and-save/history-desktop.png) and [320px mobile](artifacts/2026-09-06-reading-history-and-save/history-mobile-320.png) screenshots, [browser assertions](artifacts/2026-09-06-reading-history-and-save/browser-checks.json), and a [bounded migration rehearsal receipt](artifacts/2026-09-06-reading-history-and-save/migration-rehearsal.json). The production SQL backup stays private and outside Git.

Earlier aggregate runs were stopped when review changes and then newly advanced main superseded their source. The final `ci:local` run began after integrating `eccddcc` and freezing all runtime/test changes; `ci-local.log` and `source-sha256.txt` accompany the artifacts. The [complete CI summary](artifacts/2026-09-06-reading-history-and-save/ci-summary.txt) records all 14 lanes passing with exit 0, including 137 API files / 2,338 tests, M3 compatibility, 46 web files / 582 tests, production build, Pattern engine, Codex runner, and content verification. The printed commit identifies the integrated base (`eccddcc`); the implementation was an uncommitted but frozen working tree, whose runtime/test fingerprint was confirmed unchanged before release. Only operational receipt notes and documentation were added afterward; contract validation was rerun after those notes.

## Release order

Migration `0028_reading_saves.sql` is additive. Apply and verify it before deploying this runtime: History, Save, new exports, and account deletion reference the new relation. The previous Worker remains compatible with the new empty table. Once Save is enabled, rolling back to a Worker that cannot delete Save rows requires care: its account-deletion flow does not know the new foreign-key child relation.

Production preflight confirmed only 0028 pending, the prior Worker at 100% mapped to a successful build of `eccddcc`, and clean database integrity. A private production export and Time Travel bookmark were captured before release. Rehearsal of unchanged 0028 against that export preserved the row counts and content hashes of all 64 existing tables, left the new Save table empty, and passed foreign-key and quick checks. Migration 0028 applied at 2026-09-06 09:08:54 UTC: 3 commands in 0.63ms. Post-apply checks confirmed 28 migration records, no pending migrations, the empty Save table with its index and ownership keys, unchanged counts (4 users, 37 readings, 128 evidence rows), zero foreign-key violations, and quick-check `ok`. The [apply receipt](artifacts/2026-09-06-reading-history-and-save/migration-apply.json) and `db/d1/MIGRATIONS.json` record the evidence. Main’s Workers Builds trigger deploys API and PWA together; version-to-commit and traffic-allocation receipts are kept in the private release directory alongside the backup.
