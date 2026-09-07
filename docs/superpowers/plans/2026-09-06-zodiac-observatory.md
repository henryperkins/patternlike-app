# Zodiac Observatory Implementation Plan

**Goal:** Connect the 3D portrait to supported natal zodiac facts and the complete Pattern reading.

**Architecture:** A minimized chart projection travels through the existing account components as an optional `sky` prop. The renderer owns a separate zodiac instrument; the explorer owns sky/Pattern navigation and an accessible facts reader.

**Tech stack:** Existing React, TypeScript, Three.js, Vitest, and Playwright. No new dependencies.

**Spec:** [Zodiac observatory](../specs/2026-09-06-zodiac-observatory-design.md).

## Constraints

- Continue on the existing local branch, preserving prior work and the unrelated root `.impeccable/` directory. No commit, push, migration, or deployment is included.
- Project only Sun, Moon, and ascendant. Omit unsupported Moon, angles, and houses; retain qualifications and uncertainty.
- Keep saved meshes, images, chapter prose, source identity, comparison, guide, and complete reading unchanged.
- Record implementation assumptions without claiming additional user approval. Use independent workers for bounded data and geometry tasks; the root owns integration and final verification.

## Tasks

- [x] **Supported chart context.** Create `apps/web/src/lib/portrait-sky.ts` and adjacent tests. Implement `createPortraitSky(chart, expectedChartId)` returning `PortraitSky | null`; validate active identity, normalize finite longitude to zodiac sign/degree, omit ineligible placements/houses, and strip private fields. Pass optional `sky` through `ChartView`, `PatternExperience`, `AccountPatternPortrait`, and `AccountPortraitExplorer`. Exercise propagation and identity rejection.
- [x] **Zodiac instrument.** Create `components/portrait-explorer/zodiac-instrument.ts` and adjacent tests. Own a bronze twelve-sector dial, ticks, calibrated Sun/Moon/rising markers, selected-sector emphasis, and deterministic selection. Export `zodiacPoint(longitude, radius, height)` and `createZodiacInstrument(placements)`; actual longitude determines angular position. Do not create a marker from a sign alone.
- [x] **Integrated exploration.** Extend the explorer and scene props with optional sky context and local sky selection. Replace the central tree with the instrument, add instrument framing and picking, and render a compact native facts panel with the existing reading navigation. Add explicit fictional sky data to the preview without modifying saved chapter content or model bindings. Cover source replacement, sky/Pattern return, unavailable placements, and real scene lifecycle.
- [x] **Visual finish and documentation.** Inspect desktop and phone together, batch fixes, get independent review, and update the component design record. Keep the native chapter rail and accurate uncertainty available when graphics fail.
- [x] **Scoped final verification.** Per the user’s later instruction, verification is limited to the 3D Pattern work. The relevant tests passed within the final web run, the preview build passed, and the affected browser flows were checked. The broader aggregate was stopped; it is not a completed gate.

## Execution record

Initial state: prior observatory and CSS hook fix are local and uncommitted. The prior full aggregate gate predates that CSS change. This pass will establish a fresh aggregate result after the zodiac integration.


### Implemented and reviewed

- Added the identity-checked natal projection through the existing account path, with supported Sun/Moon/rising facts and explicit omission/qualification states. Private chart inputs are not copied into this context. The four saved chapter assets and complete source reading remain unchanged.
- Replaced the central tree with a calibrated bronze instrument, added Your Pattern / Your sky navigation, below-canvas placement controls, a natal facts reader, and an account-only link to the existing Today route.
- Independent review found obstructed signs, overlapping labels, displaced phone controls, incorrect mobile return and live announcements, and misleading generic suppression copy. One correction batch addressed these; a follow-up runtime check aligned missing-Sun fallback with the native reader. The final reviewer cleared the scored fixes.
- Final captures show twelve visible signs on both desktop and phone, one centered selected-body readout, and no horizontal overflow. Actual marker angles remain unchanged by label placement. Closing the roof also retained twelve visible signs in the default sky framing.
- Browser flows verified chapter Resources → sky → Read chapter, all four complete-reading chapters, expanded scene, and unknown/approximate birth-time handling. Unknown time exposed one supported placement and two unavailable states. Approximate rising retained its qualification. These are fictional preview checks, not live account or physical-phone performance evidence.
- The apparent dark Reset-view text in an intermediate capture was a scroll/hover repaint artifact. Computed hover colors are paper `rgb(224, 232, 210)` and ink `rgb(24, 57, 47)`; no CSS change or suppression was warranted.
- Manual detector: zero anti-patterns on the touched explorer UI/CSS. Its 105 advisory notes concern inherited literal type/color/radius values and documentation ramp matching; they are not detector failures. No ignores were added. The original `explorer.css:101` side-accent finding was already fixed with a neutral top rule.

### Verification before the aggregate gate

- Chart projection/account focused lanes: 79 tests passed.
- Zodiac geometry: 15 tests passed after the initial red run.
- First web pass: 50 files / 648 tests passed before the review corrections.
- Review regressions first failed as expected (3 failures / 41 passes). Final UI file: 35 passed; final runtime file including click-routing and fallback boundaries: 11 passed. The other explorer files passed in the preceding scoped run.
- Web typecheck and `build:portrait` passed. The preview build retains the existing large shared Three/OrbitControls chunk warning.
- `git diff --check` passed before the full gate.
- Fresh `npm run ci:local` started on the final source/tests at base `cefc979`, branch `codex/portrait-observatory`; the working tree is uncommitted. Log: `/tmp/zodiac-ci-final.log`. Final result is pending below.

- Conjunction browser check used a temporary interception of the fictional preview fixture, assigning all three placements longitude 115. All three choices remained reachable, twelve signs remained visible, and only the selected central readout appeared. The interception was removed and the exact fixture restored; no source or account data changed. Final browser sequences reported no new page errors.
- Final local captures: `/tmp/zodiac-final-overview.png`, `/tmp/zodiac-final-desktop.png`, `/tmp/zodiac-final-mobile.png`, `/tmp/zodiac-final-unknown.png`, and `/tmp/zodiac-final-conjunction.png`.


### Reading-comparison correction

A final navigation check found that `openSky()` could pop the comparison while leaving the phone in reading presentation, hiding the canvas. The focused regression failed before the correction. The explorer now derives a temporary explore presentation while the sky is visible, retaining the underlying reading/navigation history. Sky's top control reads Back to Pattern and restores that context. Display, focus, and scroll handling use the derived presentation.

Independent review found no regression in this bounded correction. The final full web suite passed 50 files / 652 tests, and the preview build passed. The earlier aggregate was deliberately interrupted (exit 130) during its API lane so it could not be mistaken for verification of the corrected source. Its partial log is `/tmp/zodiac-ci-before-reading-fix.log`. A fresh complete run now uses `/tmp/zodiac-ci-final.log`; no lane is skipped.


Browser confirmation of the correction passed: phone comparison → sky displayed the canvas; expanded scene opened and closed; Back to Pattern restored reading, both compared chapters, and selected Resources. Final desktop/phone recaptures retained twelve visible signs and reported no new page errors. The post-correction detector found zero anti-patterns in `PortraitExplorer.tsx`.


### Final verification scope requested by the user

The user directed: “if it isnr dirextly related to the 3d animation pattern work dont run its tests”. This supersedes the earlier broad testing requirement for this task. The fresh aggregate was stopped during the unrelated API lane; no aggregate success is claimed. No further unrelated tests will run.

The final source had already passed the web suite (50 files / 652 tests, including the changed 3D explorer, natal projection, and account integration checks), `build:portrait`, the focused reading-comparison regression, and the browser flows recorded above. Source/test fingerprints were unchanged when the broader run was stopped. The implementation remains local and uncommitted, with no deployment or migration performed.
