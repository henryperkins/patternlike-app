---
target: 3D model interaction, user interface, and relevant user workflows (account path)
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
target_identity: "file:/home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx"
target_fingerprint: "sha256:4852a2a35b2fc16398e7c6695fdf64b4e4123a962508c6a5713e99d00ebb1e99"
target_path: /home/henry/patternlike-app/apps/web/src/components/portrait-explorer/PortraitExplorer.tsx
timestamp: 2026-09-07T11-29-17Z
slug: components-portrait-explorer-portraitexplorer-tsx
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated) plus parent verification of the three highest-consequence claims. Note on ordering: B returned before A, so detector evidence reached the synthesis context before A's report; A ran in an isolated context throughout and could not have been anchored by it. Evidence was gathered on the real signed-in Pattern page at http://127.0.0.1:5199/#pattern with every /v1 call intercepted and the four authored fixture meshes rendering in headless Chromium (SwiftShader), plus the standalone preview at :5174 for contrast.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Selection, facet and sky announce well; generating-to-ready and every scene-option change announce nothing. |
| 2 | Match System / Real World | 3 | Metaphors land, but "Read today's horoscope" names a surface the product calls Today, and "Unfold portrait" is never explained. |
| 3 | User Control and Freedom | 3 | Browser Back unwinds four levels correctly; Forward never restores and reopening discards the reader's place. |
| 4 | Consistency and Standards | 2 | Three names for one feature; two stacked cards share the heading "Four chapters, a shape of your own". |
| 5 | Error Prevention | 2 | One unconfirmed checkbox sends the whole reading to OpenAI without the processor/purpose/policy block used elsewhere on the same page. |
| 6 | Recognition Rather Than Recall | 2 | Zero of four object labels are drawn at 390px and 320px; objects are anonymous until tapped. |
| 7 | Flexibility and Efficiency | 3 | Camera keyboard group, per-view bookmarks, low-power mode, guided tour; 28 Tab stops from entry to the first passage. |
| 8 | Aesthetic and Minimalist Design | 2 | 31 interactive controls in the first explorer viewport; comparison renders 18 characters per line. |
| 9 | Error Recovery | 2 | WebGL loss is handled well, but a failed scene chunk is permanently unrecoverable and the failed portrait state offers no action. |
| 10 | Help and Documentation | 3 | "Scene controls & motion" is genuinely useful; nothing explains Unfold, the desks, or what the sky view is for. |
| **Total** | | **25/40** | **Acceptable** |

Assessment A scored 26/40. Synthesis lowered Error Recovery from 3 to 2 after the parent reproduced a permanent dead end on scene-chunk failure that neither assessment had exercised.

## Design Specificity Verdict

**LLM assessment.** Authored, not assembled. Nothing reads as a generic model viewer: no grey gradient stage, no orbit gizmo, no "drag to explore" tooltip. The courtyard is a place, and the twelve-sign bronze dial is an instrument with five-degree calibration ticks rather than a glowing wheel of glyphs. Nor does it read as a generic astrology app: no glyphs, no purple gradients, no starfield. Warm paper, forest ink, the Iowan serif reading column and one-pixel rules carry straight through from the app shell. What gives it character is restraint applied to a medium that rarely gets it: the scene is lit at noon rather than magic hour, markers are shapes in lanes rather than planets, and the page says out loud that marker sizes and spacing do not represent planetary size or distance. That sentence is the product's thesis rendered as an interaction rule. Two things pull against it. The reading-facing copy slips register, and the surface carries three names for one thing (3D portrait, constellation, observatory), the signature of a design that grew rather than one that was decided.

**Deterministic scan.** `impeccable detect --json` over the explorer directory and the four account components exited 0 with 105 findings, all advisory, none primary.

| Rule | Count | File | Count |
|---|---|---|---|
| design-system-font-size | 53 | explorer.css | 88 |
| design-system-color | 42 | observatory.css | 15 |
| design-system-radius | 10 | PortraitScene.tsx | 2 |

The four account components produced zero findings. Most of the CSS findings are false positives for the product path: the account embedding zeroes the standalone surface's radii and shadows, and the local DESIGN.md authorises its own type ramp and material palette. Three findings survive that judgment. Two are colours in `PortraitScene.tsx:169` that appear in neither the app palette nor the local one and paint the live selection ring. One is a 3px radius at `observatory.css:30` that is outside the local scale of 0 and 2 and also defeats the embedded reset at equal specificity.

**Visual overlays and axe.** The overlay injected successfully on all six representative states, and the six full-page captures are on disk. There is no user-visible overlay tab, because the browser is headless. Console counts were 61, 62, 60, 16, 16 and 61 findings, but hit-testing attributes only one to the explorer: 10px functional text on "Next chapter". The rest belong to the surrounding app shell. axe-core reported exactly one violation in every state, `landmark-unique` on the shell's unnamed sidebar, with zero nodes inside the explorer. Every text and focus-ring contrast measurement passes AA comfortably, the lowest being 4.86:1 for the paper focus ring over the live scene.

**Three defects from the previous run are fixed.** WebGL contexts now balance exactly across eight open-and-close cycles, the entry button now scrolls and focuses the explorer, and the focus ring on dark scene surfaces now measures between 4.86:1 and 7.44:1 rather than below 3:1. The nested `main` and duplicate `h1` are gone in embedded mode.

## Overall Impression

The scene has become genuinely good, and the reading around it has not kept up. The instrument view is the clearest explanation of a birth chart this product has ever produced, the resource discipline is now measurably clean, and the accessibility floor holds. But the three worst defects all fail the same way: when the reader's task turns textual, the scene wins and the prose loses. Comparison, the feature whose entire purpose is putting two chapters side by side, renders at 18 characters per line on the only path real readers use. Phones show four unnamed shapes. A failed chunk leaves 3D permanently broken with no way back except a page reload. Fix the cases where reading should displace the scene and this is a distinctive Pattern/Like surface rather than a viewer with a reader attached.

## What's Working

- **The scene never asserts anything.** Geometry, lighting and arrangement stay furniture. The hint reads "A court, four chapter spaces", the footer reads "Personal meaning stays in the reading", and the sky reader explicitly disclaims marker size and spacing. Unknown birth time removes the Moon and rising from both the dial and the strip and says why, rather than drawing a guess.
- **The reading is never hostage to the graphics.** Every canvas affordance has a named native twin. On context loss the reading stays, graphics controls disable, and both recovery paths work. Assets are verified by hash before display and reused on reopen without a single extra request.
- **Browser Back is modelled properly.** Four Backs from a deep state unwind the expanded scene, then the facet, then the chapter, then the explorer. Very few embedded 3D surfaces get this right.

## Priority Issues

**[P1] Comparison renders the reading at 18 characters per line on the account path.** Verified independently by the parent at 1440x900.

| Measurement | Value |
|---|---|
| Workspace columns | 563px / 375px |
| Each comparison column | 169px |
| Passage width | 154px at 17px serif |
| First line | 18 characters |
| Single-chapter passage, for contrast | 332px, 41 characters |

The cause is a specificity defeat. `observatory.css:53` carries three classes and wins over both comparison rules, `explorer.css:204` and `observatory.css:56`, which carry two each. The two-column workspace therefore survives comparison, and the 375px reader column splits again inside itself.
- Why it matters: comparison exists to show two chapters of the actual product, and on the only path readers use, it is unreadable.
- Fix: give comparison the full embedded width by hiding the scene panel, exactly as mobile Read-chapter mode already does, and floor each column at 45 characters.
- Suggested command: `/impeccable typeset`

**[P1] A failed scene-chunk load leaves 3D permanently broken.** Reproduced by the parent: block the `PortraitScene` module request once, and "Try 3D again" issues no further network request, indefinitely.
- Cause: `PortraitScene` is a module-level `lazy()` at `PortraitExplorer.tsx:15`, so React caches the rejected import promise on the component object. Remounting the boundary through `key={JSON.stringify([retry, sky])}` at `PortraitExplorer.tsx:282` recreates the subtree but reuses the same poisoned lazy component. The browser's module map holds the same rejection.
- Why it matters: this is exactly the stale-deploy case. A push to `main` deploys within about a minute, and a reader holding the old page then asks for a hashed chunk the Worker answers with `index.html`. The visible result is a permanent "The portrait is taking a pause" with a retry button that does nothing.
- Fix: hold the lazy component in state and recreate it on retry, so the factory runs again, and add a cache-busting query on the retry import.
- Suggested command: `/impeccable harden`

**[P1] Objects are anonymous on phones.** Zero of four chapter labels are drawn at 390x844 and 320x760, two of four at 1024x768 and at 844x390, three of four at 1440x900.
- Cause: `PortraitScene.tsx:438` hides every unselected label when the canvas is narrower than 520px and shorter than 420px. The phone canvas measures 324x345 and always satisfies both.
- Why it matters: the reader sees four unnamed shapes and must scroll past the canvas to the rail to learn what they are. Recognition becomes recall exactly where attention is scarcest.
- Fix: on small canvases draw a numbered ordinal chip matching the rail instead of nothing, and keep the collision rule for full labels.
- Suggested command: `/impeccable adapt`

**[P1] The failed state is a dead end, and it collides with the retired constellation.** With `retryable: true` and two of four models saved, the section renders two sentences and zero actions, while directly below it a second card headed identically offers "View constellation" and "Download constellation".
- Cause: `AccountPortraitExplorer.tsx:191` has no retry branch even though `retryable` is validated at `:26`, and the legacy component still mounts whenever the explorer is not ready. The same collision occurs while generating.
- Why it matters: the one valley in the journey offers no next step, and the reader is handed a differently named artifact that still works.
- Fix: render a retry action when `retryable` is true, and suppress the legacy constellation card whenever the explorer section is present.
- Suggested command: `/impeccable clarify`

**[P2] Leaving the Pattern page costs everything and re-downloads every asset.** Verified by the parent: eight asset requests before a trip to Today, sixteen after returning and reopening, so all four images and all four models are fetched again. Reopening also resets to the intro rather than the last chapter, because `use-explorer-navigation.ts:75` calls `createExplorerState` fresh on every open. Forward after Back never restores the explorer. The sky reader's own link invites this trip.
- Why it matters: the explorer offers a link out and then charges roughly 2MB and the reader's place to come back.
- Fix: cache verified blobs keyed on the explorer response identity and re-mint object URLs on remount; retain the last snapshot across close and reopen, since the controller stays mounted.
- Suggested command: `/impeccable optimize`

**[P2] The opt-in that ships the whole reading to OpenAI is lighter than every other consent on the page.** One unconfirmed checkbox plus three paragraphs at `PortraitAutomationControl.tsx:53-63`. The same page's Pattern and AI consent surfaces render a processor, purpose and policy-version grid plus a category list. The portrait control declares `consent_policy_version: "1.1.0"` internally and never shows it.
- Why it matters: a reader taught that this product shows a formal block before sending anything to a model will read the lighter treatment as a lighter act.
- Fix: reuse the shared consent block, surface the policy version, and require the same confirm gesture.
- Suggested command: `/impeccable harden`

**[P2] Focus drops to the document body at two transitions.** Clicking "Explore your Pattern" in the sky reader unmounts the button, and the restoring effect at `PortraitExplorer.tsx:264` does not list `skyView` in its dependencies, so it never runs. Separately, the entry button disables itself to "Portrait open" while assets load, dropping focus with nothing to receive it.
- Why it matters: a keyboard reader must Tab from the top of the document twice in the primary flow.
- Fix: add `skyView` to the effect dependencies and move focus to the chapter heading; keep the entry button enabled or focus the loading status while loading.
- Suggested command: `/impeccable harden`

**[P3] Two copy lines leave the product's voice.** The intro headline reads "Your sky. Your story, unfolding." at `PortraitExplorer.tsx:329`, a spectacle register the product rules out, and it heads the Your Pattern view rather than the sky view. The sky reader links out as "Read today's horoscope" at `SkyReader.tsx:60`, to a surface the product calls Today and never calls a horoscope, in a view whose own specification says not to fabricate daily horoscope content. With unknown birth time the intro still promises "Find your Sun, Moon, and rising" while two of the three read as unavailable.
- Fix: retitle to something the calculation supports, relabel the link "Open today's reading", and make the invitation conditional on available placements.
- Suggested command: `/impeccable clarify`

## Persona Red Flags

**Casey (distracted mobile).** Opens to four unnamed shapes at 390px, zero labels drawn. The entry button sits at page offset 3090 of 7486, and the scene lands lower still. One-finger scrolling over the canvas correctly scrolls the page without moving the camera, which is a real improvement, but it also means the only way to manipulate the scene is six 44px buttons or the expanded dialog, which is two taps away and then presents 25 controls at once.

**Sam (screen reader and keyboard).** 28 Tab stops from the entry button to the first reading passage, because the scene-top pair, three canvas labels, the toolbar group, six camera buttons, both lighting buttons, the roof button, a summary, four rail buttons and "Guide me through" all come first. The canvas is correctly an image with a full description, dialogs trap and restore focus, and Escape works. But focus lands on the body twice, the generating-to-ready flip announces nothing, and the page still has two unlabelled complementary landmarks from the shell.

**Jordan (confused first-timer).** Five competing entrances to one task in a single viewport: the intro invitation, "Explore the first chapter", "Explore your birth sky", "Begin with", the rail, and "Guide me through". "Unfold portrait" is never explained, and the hint still reads "Turn the object to inspect every side" while unfolded. In sky view a disabled "Unfold portrait" and an inert "Show roof" stay on screen unexplained.

**Riley (stress tester).** Back four times unwinds correctly, then the fifth leaves the site and Forward cannot bring the explorer back. Flipping generating to ready swaps the whole section silently. A canvas click that misses every object correctly does nothing. At 320px the toolbar reflows to three columns with no horizontal overflow. Blocking the scene chunk once breaks 3D until reload.

## Minor Observations

- Sky view keeps a disabled "Unfold portrait" and an inert "Show roof"; a disabled control with no reason is noise.
- Chapter 4's canvas label is never drawn at 1440 in the default framing, reachable only from the rail.
- Scene-option changes (dusk, roof, turn, unfold) announce nothing to the live region.
- Three radii exist for one family of buttons: 5px in `explorer.css:29`, 2px from `observatory.css:52`, and 0 in the shell's `.button`.
- Two sticky bars stack on phone, 62px then 50px, above a 345px scene.
- "Cancel portrait loading" works but discards downloaded bytes; model requests went from four to eight after cancel and reopen.
- Destructive proximity is fine: "Delete this Pattern" sits 3471px below the portrait opt-in at 1440.
- The not-started state with automation off is the best-written of the five.
- Single-chapter reading measures 332px at 19px serif, about 41 characters per line, under the 45 to 75 target even in the good case.
- The standalone preview differs structurally: its own h1, wordmark, "Fictional study" chip and footer, none of which exist on the account path.
- `ObservatoryControls.tsx:30` puts a live region on the hint paragraph, so every chapter change produces two announcements.
- The generating copy is genuinely good, naming both image and model progress and the check between them.
- "Turn chapter object" gives no state readout, so the reader cannot tell how many turns they have applied or how to return to the original orientation.
- No console errors in any scenario beyond two known harness conflicts.
- The embedded title is a third name for the feature, alongside "3D portrait" and "constellation".

## Coverage Limits

No real device, no physical GPU, no Safari or Firefox, and no real screen reader. Frame timings under SwiftShader are not device performance and are excluded. Real touch-drag rotation could not be driven through synthetic touch events, so pointer rotation on a phone is unverified, though pinch in expanded mode did change the canvas. The signed-in page cannot be scanned by the detector's URL mode, because it needs the route mock installed before navigation. The production build was not exercised; the stale-chunk failure was reproduced against the dev server, and its production shape is inferred from the deployment model rather than observed.
