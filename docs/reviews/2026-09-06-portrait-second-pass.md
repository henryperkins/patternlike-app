# Portrait second-pass verification

Verification snapshot on base `875c09b42f96424155dcf1ddee1867462c07c363` plus the approved portrait changes. Commit and push to `main` were subsequently authorized; migration and live deployment were outside this verification run.

## Scope

- Presentation returns retain selected chapter, facet, and passage; comparison, guidance, and image inspection keep their origin-restoration behavior.
- Next chapter, introductory entry, comparison, and guide controls have explicit focus destinations. Ordinary pointer selections retain focus on their controls.
- The account owns the browser-history boundary. Closing traverses directly to the original account entry; Forward can reopen retained navigation. Long histories and rapid Return then close have regressions.
- Embedded exploration uses the account tokens and headings, a local exit, sticky navigation, container-responsive prose, and a landscape dialog with visible chapter controls.
- Stalled or failed asset hydration retains a cancellation action.

## Verification

- Focused tests: 60 passed across 4 files, with regression failures observed before the relevant repairs.
- Final Chromium scripts: all exited 0 against the frozen source (12 files; hashes in the saved verified-source artifact).
- Four account viewports: 1440x900, 390x844, 320x740, and 844x390; standalone fallback also checked at 844x390.
- Desktop reader width: 502.9px. One main landmark and one h1.
- Phone Next chapter: heading top 195.7px; focus is the chapter H3, beneath the fixed controls.
- Small-phone scene width: 254.0px; camera controls fit without document overflow.
- Expanded landscape: chapter rail bottom 369.0px within dialog bottom 378.0px.
- Standalone failed-graphics landscape: rail bottom 369.0px within dialog bottom 378.0px.
- Rapid close: original account history entry restored. Chromium reproduced the previous overshoot although jsdom's first race test passed.
- Forced-colors selection: persistent system-color outline and bold label after focus moves away. Dark scene controls use a light focus outline.
- Complete-reading browser assertions retain every fixture source paragraph, including counter-expressions. Account source/hash validation tests remain in the focused suite.
- Normal account flows reported no browser console errors. Axe's remaining landmark-unique finding points to the existing account sidebar; the duplicate/nested explorer main findings are gone.
- Independent review: no remaining material findings after its fixes.
- API recheck on the isolated base: 49 tests passed across the two portrait integration suites.
- Full local CI: all 14 lanes passed, exit 0, on the frozen 875c09b checkout plus these changes. API: 140 files / 2,482 tests, plus the compatibility test. Web: 47 files / 603 tests. Run: 2026-09-06 16:50:59–17:10:18 UTC.
- Final comparison: the isolated tracked diff remained unchanged, and all 12 portrait source/test files match the shared working copy. Local Python is 3.14.4; the CI configuration pins 3.12, as noted in the saved summary.
- Pre-commit recheck: the verified base and all 12 source/test hashes still match; fresh web typecheck and the 60 focused tests passed before staging.

## Deferred from the wider critique

Touch rotation behavior, renderer reuse across expanded presentation changes, generation recovery, and lazy scene-module retry remain separate work. Physical devices, screen readers, live private accounts, and deployment were not verified.

## Evidence

- [Local CI summary](artifacts/2026-09-06-portrait-second-pass/ci-local-summary.txt)
- [Verified source identity and hashes](artifacts/2026-09-06-portrait-second-pass/verified-source.json)
- [Desktop reading](artifacts/2026-09-06-portrait-second-pass/desktop-reading.png)
- [Phone chapter advancement](artifacts/2026-09-06-portrait-second-pass/phone-next-chapter.png)
- [Landscape expanded scene](artifacts/2026-09-06-portrait-second-pass/landscape-expanded.png)

The shared checkout advanced during the first CI attempt. That interrupted run is excluded from the final evidence. Browser flows and the full gate were rerun on an isolated checkout of 875c09b with the identical approved portrait changes. The verified copy remains at `/tmp/patternlike-portrait-second-pass-verify`.
