---
target: 3D model interaction, user interface, and relevant user workflows
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
target_identity: "file:/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx"
target_fingerprint: "sha256:a9b6bfd8962f13fce974e4cb6099f1be059e914f0342eaf3e6a5751e4c44f738"
target_path: /home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx
timestamp: 2026-09-07T13-58-34Z
slug: components-portrait-explorer-portraitexplorer-tsx
---
Method: dual-agent (A: isolated design-review agent, B: isolated detector/browser agent). Four highest-consequence findings independently verified in source by the coordinator before publication.

Target: the 3D portrait explorer, its interface, and the workflows that reach it. Primary file `apps/web/src/components/portrait-explorer/PortraitExplorer.tsx`.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Live regions and saved-model counts are strong. The generation wait shows progress but no bound or estimate. |
| 2 | Match System / Real World | 3 | "Whole portrait" and "Look closer" are humane. "Frame selection" is CAD language, and the same artifact is called both a portrait and a constellation. |
| 3 | User Control and Freedom | 2 | "Whole portrait" destroys the reading position while "Reset view" preserves it. No single control restores the default scene. |
| 4 | Consistency and Standards | 2 | Four variants of one scene green, three radii for one container, two tab strips sharing a visual language for unrelated meanings. |
| 5 | Error Prevention | 3 | Tap-versus-drag threshold, disabled panning, and a polar clamp are correct. A hard drag still reaches a useless near-vertical view. |
| 6 | Recognition Rather Than Recall | 2 | Five toggles mutate their own labels. One chapter label is hidden at the default framing. |
| 7 | Flexibility and Efficiency | 3 | Keyboard camera, guided path, low-power mode, retained reading positions. The mouse wheel does nothing over the canvas. |
| 8 | Aesthetic and Minimalist Design | 1 | Fifty-two focusable controls at once, two buttons calling the identical function, most of the frame given to scenery. |
| 9 | Error Recovery | 3 | The graphics-failure state is exemplary. One branch removes the whole section with no message. |
| 10 | Help and Documentation | 2 | The only explanation of how to rotate the scene sits inside a closed disclosure. |
| **Total** | | **24/40** | **Acceptable** |

Recovery scored one point below the design reviewer's 4. Every other recovery path explains itself; `AccountPortraitExplorer.tsx:190` returns the reading with no notice at all.

## Design Specificity Verdict

The instrument is unmistakably this product. The world around it is stock, and the world is what you see first.

Authored and irreplaceable: the zodiac dial plots real longitudes with 5-degree calibration ticks, keeps Sun, Moon, and rising in separate radial lanes so equal longitudes stay individually selectable, and when only a saved Sun sign exists it highlights a whole sector and reports the missing exact position rather than inventing a point. The failure copy is written in this product's voice and no other's.

Generic and dominant: a stylized timber pavilion among low-poly trees, with benches, stools, a rope coil, and perimeter planting. At the default desktop framing, foliage takes roughly 60 percent of the canvas and the four chapter objects roughly 15. The page title "Your zodiac observatory" is the one line here that would fit any astrology app.

Withdrawn finding, recorded for honesty: the 3D surface is NOT undocumented. It carries its own 260-line design law at `apps/web/src/components/portrait-explorer/DESIGN.md`, which deliberately resolves the flatness-versus-lighting question and specifies focus, targets, reduced motion, and occlusion. The implementation follows it closely. The open question is whether that law now describes a calm reading room or an instrument panel.

### Deterministic scan

Detector exited 0 with 107 advisory findings across two stylesheets and one scene file.

| Rule | Findings | True positives after triage |
|---|---|---|
| design-system-font-size | 55 | 22 |
| design-system-color | 42 | 41 |
| design-system-radius | 10 | 8 |

The detector resolves only the nearest DESIGN.md and does not merge the parent ramp; Assessment B proved this with two probe files, so 33 size findings are legitimate inherited values. The 71 survivors are real drift:

- Eight sites use an 11px micro-label size neither design document declares, one with `!important`.
- Every paper control carries a 5px radius where the documented token is 2px; the scene container uses 10px, 8px, and 3px across three rules.
- Forty-one of forty-two colors are near-misses rather than deliberate additions. The primary explorer button fills `#284b38` rather than documented `forest #173f35`. Scene control green exists in four variants across two files.

### Visual overlays

Injection succeeded, a real overlay was created in the page, and the live server was stopped afterward. New signal beyond the static scan: `.explorer-text-button` has 0px horizontal padding at both viewports. Its cream-palette warning is a false positive against the documented `surface #f2efe6` token.

### Accessibility, measured

Axe reported zero violations at 1440x900 and 390x844. Fifty-two text elements measured for contrast, none failing, including labels over the canvas at 9.4 to 11.7 against a 4.5 threshold. Dusk mode re-measured and passing. Two axe "incomplete" items: `.explorer-scene` carries `aria-label` on a role-less div (serious impact, needs review), and undeterminable contrast over the canvas, resolved by hand measurement.

## Overall Impression

Carefully engineered 3D with an unusually mature design law behind it. The parts hardest to get right are right: reduced motion, render loop, keyboard access to 3D objects, touch gesture arbitration, graphics failure.

The problem is not craft. The surface has accumulated a control vocabulary that outranks the thing it exists to deliver. A reader arrives to read four chapters about themselves and meets eighteen scene controls, five equally confident ways to start, and a frame mostly filled with trees. The biggest opportunity is subtraction.

## What's Working

**Graphics-failure and generation states name what survives.** With WebGL disabled: "The portrait is taking a pause. / Your saved chapters are ready to read." Every camera and atmosphere control reports disabled; chapter rail, sky strip, guide, and full reading stay live. Account states retain images and completed models explicitly. Never says "Error", never blames, never strands.

**Keyboard access to the 3D scene is real.** The canvas is `role="img"` with a 186-character description and deliberately not focusable. Each chapter object carries a native button in tab order with a full accessible name. First object reached in seven tab stops. Focus rings measure exactly 3px at 3px offset on all 31 stops, cobalt on paper and paper on the dark scene bar, matching the written law. The occluded fourth label is correctly removed from tab order; access is carried by the chapter rail.

**The performance and touch contract is what mobile 3D usually gets wrong.** `touch-action: pan-y` so vertical page scroll always wins; pinch only where the canvas owns the gesture; a tap-versus-drag threshold so a small mis-drag neither selects nor deselects. Instrumented rAF counting confirms zero frames across 3s and 5s idle windows, and zero frames when the same actions run while the document is hidden.

## Priority Issues

### [P1] "Whole portrait" silently discards the chapter you were reading
`PortraitExplorer.tsx:284` dispatches `{type:"whole"}`; `explorer-state.ts:52` returns `[]` for that case. `Reset view` at `PortraitExplorer.tsx:305` only issues a camera command and preserves everything. Verified in source. The labels are inverted relative to consequence: the destructive-sounding control is safe, the zoom-sounding one throws away the reader's place with no undo and no warning. That button also does triple duty as the return from sky view.
**Fix:** make it reframe only, matching Reset view. If clearing selection is intended, rename it and give it the weight of a state change.
**Suggested command:** `/impeccable clarify`

### [P1] The opening frame buries the four objects the reader came for
Roughly 60 percent of the default canvas is foliage, roughly 15 percent the chapter objects. `PortraitScene.tsx:449-451` relocates only compact mobile labels and sets `visible = false` for colliding desktop labels, so only three of four render at 1440x900 while the copy beneath says four objects hold the chapters. This is the emotional peak of the feature and it contradicts its own caption.
**Fix:** tighten the default camera distance so the terrace fills the canvas as the expanded dialog already does, since that framing renders all four labels. Give chapter labels the leader line the sky readout already has.
**Suggested command:** `/impeccable layout`

### [P1] Five equally confident entrances to one first step, two the identical function call
`.explorer-primary` ("Explore the first chapter") and `.explorer-entry-invitation > .explorer-text-button` ("Begin with <title>") both call `select(manifest.chapters[0].id, true)`. Verified in source. On a phone both render roughly 1,280px apart, each under its own introduction paragraph. Add the chapter rail, in-scene labels, and the guided path: five doors, no intended one. This is the concrete face of the cognitive-load result, which failed five of eight checks (critical band).
**Fix:** keep one primary entrance and the guided path as its single secondary. Delete the duplicate button and its second introduction. Demote the chapter rail to navigation once a chapter is open.
**Suggested command:** `/impeccable distill`

### [P1] Nothing in the canvas signals that an object is clickable
`PortraitScene.tsx:117` hardcodes `cursor:grab`; the only mutation is to `grabbing` at `:335-336`. Verified in source and by live measurement over every visible chapter label. Hover feedback exists but is a 0.16 warm emissive on already-warm oak and bronze at roughly 50px. The introduction tells readers to choose an object, then withholds the universal zero-learning affordance for choosability.
**Fix:** set `cursor: pointer` when the pick test returns a chapter id, revert to grab over scenery. The pick already runs on every non-touch pointer move. Strengthen the hover ring so it survives the wide frame.
**Suggested command:** `/impeccable polish`

### [P2] The reading is hard to reach on mobile and clipped on desktop
At 390x844, selecting a chapter leaves the chapter title roughly 1,600px below the fold behind six scene controls, a disclosure, and the chapter grid. A Read-chapter mode that hides the scene already exists, but nothing points to it. On desktop `.explorer-reader` (`explorer.css:157`) is a scroll container with no visible affordance whose clip falls through "Inspect original image" and "Compare with", slicing both through the glyphs. Under peak-end, the last thing a reader sees is text cut in half.
**Fix:** scroll to the chapter heading on selection using the scroll margin already declared at `explorer.css:3`, or switch to reading mode automatically below 767px. Pin `.explorer-reader-actions` to the bottom of the scroll container.
**Suggested command:** `/impeccable adapt`

### [P2] The visual system has drifted inside the explorer
Seventy-one verified true positives across sizes, radii, and colors, none visible individually and all cumulative. Most consequential: the primary button fills with a near-miss green on a near-miss paper rather than documented tokens. Three radii describe the same scene container.
**Fix:** replace near-miss literals with the tokens they approximate, collapse the scene container to one radius, and either adopt 11px into the local type scale or move those eight sites to the declared 12px control size.
**Suggested command:** `/impeccable extract`

## Persona Red Flags

**Sam (screen reader, keyboard, low vision, 200% zoom).** Genuinely well served: zero axe violations, no failing contrast among 52 measured elements, no horizontal overflow at three viewports, consistent 3px focus rings, all four chapter objects reachable. Flags: the canvas cursor never changes, so pointer use gets no target confirmation; the reader scroll boundary cuts through a control label and reads as a rendering fault at high zoom; the rotation explanation is inside a collapsed `<details>`, so a screen-reader user is never told the scene is drag-rotatable; `.explorer-scene` carries `aria-label` on a role-less div.

**Casey (one-handed phone, interrupted, slow connection).** Must thumb past six scene controls to reach a word of the reading. Mobile scene labels are numbered squares in non-sequential screen positions with no connector to any object. The mobile camera bar is six unlabelled glyphs, two reading as undo/redo rather than rotate. Camera pitch cannot be changed by touch at all; tilt controls sit two levels deep inside a collapsed disclosure. In her favour: the render loop stops when the tab is hidden, and the fixture payload is 2.3 MB across four models (production contract permits 3 MB each).

**Riley (stress tester).** A diagonal drag reaches `minPolarAngle = 0.12`, a near-vertical plan view with no soft return. The mouse wheel over the canvas silently does nothing. Roof plus unfold hides most objects and two labels; recovery needs two toggles whose labels have both mutated. A second click on a selected object silently opens its reading desk instead of re-selecting. Most seriously, `AccountPortraitExplorer.tsx:190` (`if (!sourceMatches) return <>{children}</>`) removes the entire 3D section with no message after a Pattern is regenerated. Verified in source.

**The private reflector (derived from PRODUCT.md audience).** Offered five ways to start and told twice, in two voices, what the page is for. Given eighteen scene controls before a sentence of her own reading, none of which changes what her Pattern says. The page is titled with the one phrase that sounds like every product this one positions against. The reassuring download yields `pattern-portrait-complete.json`, a file she cannot open.

## Minor Observations

- The same artifact has two names: one delivery path says portrait, the other says constellation, under an identical subtitle. Which one a reader sees depends on whether explorer delivery is available.
- Dusk is the best-looking frame on this surface and is not the default. It is the only condition where the model rather than the scenery is the subject.
- `.explorer-text-button` has zero horizontal padding at both viewports, though it holds 44px height.
- The expanded dialog carries a 100px-blur shadow. Documented as inherited modal elevation, so not a violation, but now the loudest off-system moment here.
- Sky view keeps a disabled "Unfold portrait" in frame, reading as broken rather than not applicable.
- The mobile "Explore" tab measures 42.7px wide, 1.3px short of the minimum; its sibling is comfortably over.
- During asset load three elements describe one wait: a relabelled disabled button, a status line, and a cancel button.
- `enableDamping = false` makes the drag stop dead. Defensible for an instrument, but the largest single contributor to the scene feeling mechanical rather than held.
- Two tab strips sit roughly 200px apart with identical selected styling and unrelated meanings.
- The observatory hint and footer run at 11px, below the local law's own smallest declared role.
- Neither agent could browser-test the signed-in 3D explorer: fixture GLB `extras` cannot satisfy `validateGlb`'s provenance check without re-authoring bytes that would break their hashes. The four account status states were reached and captured; the embedded explorer was assessed from source and from the fixture preview, which mounts the same component.

## Questions to Consider

1. If you deleted the trees, benches, stools, rope coil, and lamp, everything that is neither a chapter object nor the instrument, what would the reader actually lose?
2. Dusk is the only condition where the model is the subject. Why is daylight the default?
3. You built leader lines for the sky readout because a label that points at nothing is useless. Why do the four chapter labels not get one?
4. What is the single thing a reader is meant to do on their first visit? The page gives five answers with equal confidence.
5. If a reader never rotates, never toggles dusk, never cuts away the roof, and never opens a desk, do they get less of their Pattern? If not, why do those controls outrank the reading in screen order?
6. The generation wait is the most vulnerable moment in this feature and the state with the least information. What would you put there if you could add one sentence?
