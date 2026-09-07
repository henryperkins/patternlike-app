# Task 2 Portrait Observatory and Zodiac integration review

## Verdict

- Spec compliance: **PASS after four Important corrections**.
- Code quality: **PASS after four Important corrections**.
- Critical findings: none.
- Important findings: four found and resolved in the reviewed working tree.
- Merge readiness remains conditional on the root owner's fresh rendered desktop/phone/fallback checks and source-frozen `npm run ci:local`. Historical browser and aggregate evidence in the implementation plans is context only, not final merge evidence.

## Important findings and resolutions

### I1. The minimized sky projection copied retrograde state outside the accepted allowlist

- Original files/lines: `apps/web/src/lib/portrait-sky.ts:12,57`; `apps/web/src/components/portrait-explorer/SkyReader.tsx:51`; acceptance authority at `docs/superpowers/specs/2026-09-06-zodiac-observatory-design.md:15`.
- Impact: the proposed `PortraitSky` projection copied and could display `retrograde`, although the data contract permits only supported Sun/Moon/rising placements, sign/degree, permitted house, qualification, user-facing uncertainty, and the chart identity needed for the match. This weakened the explicit frontend minimization boundary.
- Resolution reviewed: `PortraitSkyPlacement` now contains only body, normalized longitude, derived sign/degree, optional permitted house, and optional qualification (`portrait-sky.ts:6-13`). The projection no longer copies `position.retrograde`, and `SkyReader` renders only a permitted house (`SkyReader.tsx:51`). The full-object equality regression at `portrait-sky.test.ts:28-40` now rejects an extra projected property while confirming that private source fields do not cross the boundary.

### I2. Sky refresh/removal remounted the whole explorer and discarded same-source state

- Original file/line: `apps/web/src/components/portrait-explorer/PortraitExplorer.tsx:23` in the supplied review package, where `sky` was included in the `ReadyExplorer` React key; acceptance authority at `docs/superpowers/specs/2026-09-06-portrait-observatory-design.md:25` and `docs/superpowers/specs/2026-09-06-zodiac-observatory-design.md:9,25`.
- Impact: changing or removing the optional sky projection for the same saved Pattern remounted `ReadyExplorer`. That cleared chapter/facet/navigation, desk/turn state, camera and scroll bookmarks, motion and quality choices. The account test only mocked `PortraitExplorer`, so retaining the source and loaded blob URLs did not prove UI-state retention.
- Resolution reviewed: the source-derived key again excludes `sky` (`PortraitExplorer.tsx:20-25`). Sky changes remount only the scene boundary that owns sky-dependent geometry (`PortraitExplorer.tsx:262-268`), while the requested body is reconciled against currently supported placements (`PortraitExplorer.tsx:84-87`). The regression at `PortraitExplorer.test.tsx:414-443` refreshes, changes, and removes sky facts while retaining chapter 2, Resources, the camera bookmark, open desk, object turn, and Dusk state; it also proves the scene itself is refreshed and the selected body remains valid.

### I3. No-placement fallbacks claimed markers and instructed an impossible placement choice

- Original files/lines: `apps/web/src/components/portrait-explorer/PortraitScene.tsx:116`; `apps/web/src/components/portrait-explorer/ObservatoryControls.tsx:30`; `apps/web/src/components/portrait-explorer/SkyReader.tsx:60`; acceptance authority at `docs/superpowers/specs/2026-09-06-zodiac-observatory-design.md:9,17,21`.
- Impact: the canvas alternative text claimed birth-chart markers even when the active projection had no placements or only a saved Sun sector without longitude. The adjacent hint told the reader to choose an unavailable placement, and the map note presupposed markers. These contradicted the otherwise-correct missing-data fallback.
- Resolution reviewed: the canvas names markers only when `props.sky.placements` is nonempty (`PortraitScene.tsx:116`); the sky hint now describes the ring and any available placements (`ObservatoryControls.tsx:30`); and the map note is explicitly conditional (`SkyReader.tsx:60`). Runtime regressions assert the presence and absence of the marker phrase alongside actual geometry in `PortraitScene.runtime.test.tsx:95-135`.

### I4. The projection retained an unused birth-time accuracy field outside the output allowlist

- Original file/lines: `apps/web/src/lib/portrait-sky.ts:17,68` before correction; acceptance authority at `docs/superpowers/specs/2026-09-06-zodiac-observatory-design.md:15`.
- Impact: `accuracy` was required internally to suppress or qualify facts, but no explorer or renderer consumed the copied output field. Retaining it made the minimized projection broader than the accepted output contract for no product behavior.
- Resolution reviewed: `accuracy` remains an internal input used at `portrait-sky.ts:27-61` but is absent from `PortraitSky` and the returned object (`portrait-sky.ts:15-20,66-69`). Exact whole-object expectations in `portrait-sky.test.ts:28-40` enforce the narrower result.

## Confirmed compliance

- `createPortraitSky` rejects empty, mismatched, superseded, and invalid chart identities; normalizes only finite longitudes; derives sign/degree rather than trusting source labels; suppresses Moon, ascendant, and houses according to the approved uncertainty rules; and carries only user-facing qualification text and summary.
- Account propagation keeps sky facts separate from the immutable portrait manifest and accepts them only when `sky.chartId === chartId`. Existing document, chapter source text, image/model hashes, and mesh revision bindings remain unchanged.
- The complete reader still exposes every chapter title, summary, section, tension, resource, counter-expression, additional signature, Pattern uncertainty statement, and source revision. Sky selection does not rewrite prose, bind chapters to planets/signs, or create aspects.
- Pattern/sky navigation retains chapter selection, facet, comparison, and phone reading presentation. The native placement controls and complete reader remain usable when WebGL is unavailable; unsupported placements stay unavailable, and a saved Sun sign can illuminate a sector without creating a longitude or marker.
- The observatory world is presentation-only geometry. Four source models retain their wrapper identities, stations/desks follow unfolding transforms, per-chapter turn and desk state is independent, reduced motion settles immediately, and demand rendering stops at rest.
- Picking filters invisible ancestors, including the cutaway roof. Chapter selection, selected-object desk operation, and sky-marker selection use separate event paths. Camera controls remain disabled during loading/failure and do not take arrow keys unless their control group owns focus.
- Scene cleanup releases observatory/instrument geometry, loaded model resources, environment and shadow resources, OrbitControls/listeners, animation frames, the renderer, and the WebGL context on failure, source/scene replacement, and unmount.
- Responsive source structure retains native chapter and sky controls outside the canvas, a stacked phone layout, mobile explore/read presentation, expanded-scene dialog boundaries, reduced-motion behavior, and the reading-first fallback. Root-owned rendered verification remains required for the integrated candidate.

## Validation performed

- Focused review run after I1-I3: 8 files, 117 tests passed. Files covered account propagation, ChartView projection, explorer state/navigation, real scene runtime/lifecycle, scene utilities, observatory geometry, zodiac geometry, and sky projection.
- After I4 narrowed the output type: `apps/web/src/lib/portrait-sky.test.ts` passed 17/17.
- `git diff --check` passed on the corrected working tree.
- `apps/web/src/components/portrait-explorer/.impeccable/design.json` parsed successfully with both `jq` and `JSON.parse`.

This was a bounded source/spec review of the supplied Task 2 diff plus the four focused corrections. No repository source was edited by the reviewer, and no branch change, staging, commit, provider call, broad suite, deployment, or final browser run was performed.
