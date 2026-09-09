# Authorized reader journey: local verification

Date: 2026-09-09. Worktree: `codex/source-map-maintenance`. [Implementation record](../../../../superpowers/plans/2026-09-09-reader-journey-production-implementation.md).

These screenshots show the production application components with test reading responses at the browser API boundary. They contain contract/example prose, not a live account’s personal readings. Ownership, encrypted persistence, publication, and lifecycle behavior are exercised separately by the API’s real D1 integration tests. No production migration, deployment, real-account generation, or human comprehension exercise occurred.

The [browser results](browser-results.json) record the complete Today → explanation → exact Pattern chapter → retained Timing pass → saved Daily → existing feedback path. The actual observatory opens chapter 3 and returns without artwork. Keyboard entry, Back focus/scroll, no extra Today preparation on Back, foreground unavailability, no-support behavior and mobile overflow were checked. No application console errors or warnings occurred. Axe reported no WCAG A/AA violations in the final mobile saved-reading state; this is a scoped check, not an application-wide accessibility certification.

- [Desktop explanation](explanation-desktop.png)
- [Mobile explanation](explanation-mobile.png)
- [Exact chapter in the observatory](observatory-desktop.png)
- [Saved Daily on mobile](saved-daily-mobile.png)

Browser plugin was unavailable. Playwright, Chromium, system libraries and the temporary QA script remained under `/tmp`; no browser dependency, package command or gate was added to the repository.
