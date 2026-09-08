# R1 and R2 local validation — 2026-09-07

Base commit: `6e706741f03253f2807d33380afb529161f3481f`. Changes remain local and uncommitted. Final production file hashes are in `source-sha256.txt`.

Implemented sky browser-history navigation and responsive chapter/reading navigation. R3–R6 remain outside this change. Exact source prose, source identity and private-memory invalidation are retained.

- Web workspace tests: 51 files, 687 tests passed under Node 22.23.2. See `portrait-final-web-test.txt`.
- Web TypeScript and Vite build passed after the final CSS correction. See `portrait-web-build.txt`. Vite reports its existing large-chunk advisory.
- Browser preview: 44 checks passed, no page errors (`results.json`). Desktop 1440×900, phones 390×844 and 320×844, enlarged text, and short landscape 844×390.
- Account fixture: 19 checks passed, no page errors (`account-results.json`). All API requests intercepted using fictional reading/image fixtures and compiled test shapes. These verify account navigation and lifecycle, not production access or artwork quality.
- Final nested navigation: 9 checks passed, no page errors (`nested-results.json`). Includes sky → expanded scene → return, selected body retention, queued reading history, second comparison column scroll/focus restoration, and 200% interface reflow.
- `git diff --check` passed.

The root `npm test` attempt is incomplete. Earlier lanes passed, then the API Worker emitted `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending` and stalled without a test result. The process was stopped with SIGINT (exit 130). See `portrait-full-test.txt`. This is not a passing full suite or merge gate; `ci:local` was not run.

Screenshots cover desktop/phone entry, pinned account reading controls, comparison return, enlarged interface, and expanded landscape. Browser verification used local Chromium with software WebGL. Production deployment and physical-device QA were not performed.
