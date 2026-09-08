---
target: 3D portrait explorer interaction, UI, and user workflows (account path)
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-09-06T12-06-13Z
slug: components-portrait-explorer-portraitexplorer-tsx
---
Method: dual-agent (A: a070dce548b13c898 · B: ab43281af7e1a04ea), plus eight further lenses (3D interaction, account workflows, accessibility, mobile, state/lifecycle code, copy, performance, spec conformance), one dedup pass, five batched adversarial verifiers, and one completeness critic. 17 agents, 96 raw findings, 64 after dedup, 30 P0–P2 findings verified: 30 confirmed or re-graded, 0 refuted, 0 unverifiable. 34 P3 findings are listed unverified. Evidence was gathered on the real signed-in Pattern page at http://127.0.0.1:5199/#pattern with every API call intercepted and the four compiled canary meshes rendering in headless Chromium (SwiftShader), plus the standalone preview for contrast.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Explore your 3D portrait" changes nothing on screen except its own label; "Read chapter" strands the reader on the chart page. |
| 2 | Match System / Real World | 3 | Facet names read well; "Explore what connects you." hints at a synthesis the product refuses, and ↗ decorates five unrelated actions. |
| 3 | User Control and Freedom | 2 | No exit inside the explorer, browser Back never closes it and eventually leaves the site, and choices made while reading are discarded on return. |
| 4 | Consistency and Standards | 1 | Second wordmark, nested `<main>`, second `<h1>`, private tokens, rounded and shadowed controls; the entry button paints in browser-default grey. |
| 5 | Error Prevention | 2 | A page scroll that starts on the phone canvas tilts the camera permanently; the Codex opt-in is thinner than the product's other consent blocks. |
| 6 | Recognition Rather Than Recall | 3 | Every control is labelled and the rail persists; the embedded phone scene hides all four object labels until one is tapped. |
| 7 | Flexibility and Efficiency | 3 | Keyboard camera group, arrow-key tabs, drag and pinch; twenty Tab stops between entry and the first word of reading. |
| 8 | Aesthetic and Minimalist Design | 2 | Two display headlines about the same thing, three eyebrows, duplicate masthead and footer; the scene itself is clean. |
| 9 | Error Recovery | 2 | Graphics and asset failures retry; a failed generation shows a count and no next step, and a deliberate stop reads as failure. |
| 10 | Help and Documentation | 3 | Manual, skippable guide and gesture help; nothing explains what Unfold changes or what each guide stop is for. |
| **Total** | | **23/40** | **Acceptable** |

Assessment A scored 24/40; synthesis lowered User Control from 3 to 2 after verification confirmed the three navigation-exit defects (F06, F08, F09).

## Design Specificity Verdict

**LLM assessment.** Split verdict. The scene is authored for Pattern/Like: four warm, recognisable objects on a deep-green field, a thin ground ring and a faint emissive lift as the only emphasis, annotations that read "Tensions · 1" rather than a trait, and an unfold that spreads parts without inventing relationships. The chrome around it is category-interchangeable and contradicts DESIGN.md. The explorer was built as a standalone page and mounted unchanged inside the Pattern page: it brings its own Georgia-bold wordmark, header and footer, its own four colour tokens and about 34 literals, 5–10 px radii on every control, two drop shadows, a 3965be focus ring in place of Focus Cobalt, and Unicode glyphs as icons. In one desktop viewport "Back to reading" (12 px, weight 750, square) sits 200 px above "Full reading" (15 px, weight 400, rounded).

**Deterministic scan.** `detect.mjs` exited 2 with 79 findings: 77 in `apps/web/src/components/portrait-explorer/explorer.css` and 2 in `PortraitScene.tsx`; 38 off-palette colours, 31 off-ramp font sizes, 9 non-square radii, 1 side-tab accent bar. Zero findings in the controller, reducer, navigation hook, reader, account gate, or automation control. False positives judged by Assessment B: the 13–15 px body sizes (inside DESIGN.md's stated Body range), 10 px uppercase chips (inside the Label range), the checkbox's user-agent outline, the selection ring colour (a near-miss of Soft Signal Coral used exactly as coral is prescribed), and every kicker/grid/cream-palette tell that belongs to the surrounding shell.

**Visual overlays.** `detect.js` was injected on five representative pages (account whole portrait, account chapter + Tensions, account phone explore, account full reading, preview). The overlay DOM rendered and is captured in the screenshots, but the browser is headless, so there is no user-visible [Human] tab. Console counts with the DESIGN.md allowlist: 80 / 84 / 40 / 82 / 25 groups, dominated on the account pages by the shell; explorer-attributed items are the same three families as the CLI. axe reported three moderate landmark violations on every account page, all caused by the explorer's `<main>` nested inside the app's `<main>`, and no violations on the preview.

## Overall Impression

Two products in one scroll. The scene is the best thing in the feature: calculated-feeling, warm, restrained, faithful to the rule that geometry must not imply measurement, and the state machine beneath it is unusually disciplined. But it ships wrapped in a standalone page's chrome dropped into the app shell, and on the real account path three fundamentals fail: the entry button appears to do nothing, the phone reading action throws the reader to the top of the chart page, and every teardown leaks a WebGL context. Fix the phone navigation, release the context, and strip the chrome, and this becomes a distinctive Pattern/Like surface rather than an embedded viewer. The preview used for sign-off cannot show any of the top three, because the explorer starts at document top there and has no surrounding page.

## What's Working

- **The scene honours the product principles better than its chrome does.** Four recognisable objects, no particles or idle spectacle, a selection ring and faint emissive lift as the only emphasis, and an annotation that names a facet and a passage number rather than a personality claim. Unfold moves parts to fixed positions without implying relationships.
- **State discipline is real.** Per-chapter facet and passage survive compare, guide, full reading and expanded round trips; Escape and focus return work in both dialogs; camera controls disable rather than fail when graphics are lost; reduced motion is honoured with a manual override; assets are hash-verified in the browser and object URLs are revoked on every exit.
- **The copy under load is in the product's voice.** "Creating your portrait · 1 of 4 images · 0 of 4 models saved", "Each model is checked against its chapter image before it is saved", and "Personal meaning stays in the reading" are precise and honest.

## Priority Issues

**[P1] F02 Phone "Read chapter" scrolls the whole Pattern page to the top.** Confirmed by four lenses and re-reproduced by a verifier at 390 and 320 px. The reading presentation restores `scrollPositions.get("reading") ?? 0`; nothing ever saves a reading position, so every tap calls `window.scrollTo(0)`. In the preview 0 is the explorer's own top; on the account page it is "The architecture of your chart", 3,200–3,900 px above the reader, with focus left on an off-screen button. It repeats on every entry, and the unit suite stubs `scrollTo` so cannot see it.
- Why it matters: the primary phone reading action reads as a crash; WCAG 2.4.3 and 3.2.2.
- Fix: never fall back to 0. Scroll the reader heading or `#portrait-start` into view with scroll-margin for the fixed header, instant under reduced motion; route every presentation exit through one `leave()` that records the position being left, since "Return to portrait" and the expand/close button call `back()` directly today. Add a test that mounts inside a container with a non-zero offset. `apps/web/src/components/portrait-explorer/PortraitExplorer.tsx:136-140, 154-157`.
- Suggested command: /impeccable harden

**[P1] F03 "Explore your 3D portrait" produces nothing visible, and the button is a toggle.** The click mounts the explorer beneath the account card and focuses an unnamed `<div tabIndex=-1>` with `preventScroll`. At the natural tap position (button just above the bottom chrome) the explorer is entirely below the fold on phone, tablet and desktop; the only visible change is the label flipping to "Back to reading", and a second tap closes it. Even after scrolling the explorer to the top at 1440 × 900, the chapter rail is still below the viewport. The preview meets the spec's first-viewport criterion; the shipping path does not.
- Why it matters: first-time, mobile, keyboard and magnifier readers believe the feature is broken; screen readers land on an unlabelled container.
- Fix: on open, scroll `#portrait-start` into view and focus it (it already has `tabIndex=-1` and is a landmark); make the CTA a one-way entry with an explicit exit inside the explorer (F09); the live announcement already exists at `PortraitExplorer.tsx:199`, so do not add a second. Fitting scene plus rail into 900 px also needs the chrome and width fixes below. `AccountPortraitExplorer.tsx:166-170, 185, 192`.
- Suggested command: /impeccable harden

**[P1] F05 Every scene teardown leaks a live WebGL context.** `PortraitRuntime.dispose()` calls `renderer.dispose()` and removes the canvas but never `forceContextLoss()`. The verifier counted live contexts equal to the cycle count across 18 Explore/Back cycles, with Chrome's "Too many active WebGL contexts" warning at cycle 17, and a heap snapshot showing every dead renderer retained by three.js's own DFG-LUT singleton listener. Because Expand, Close and Full reading → Return each rebuild the whole scene (F07, confirmed: 0.3–1.0 s freeze, new renderer, PMREM, eight blob re-fetches, re-hash, re-parse), ordinary controls compound the leak.
- Why it matters: on phones a handful of round trips accumulates GPU memory the page cannot free; the classic trigger for tab kills or "The portrait is taking a pause".
- Fix: in `dispose()`, `if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()` before `canvas.remove()` (proved sufficient over 18 cycles). Then stop re-parenting the scene panel between the workspace and the `<dialog>`: render it in one tree position and implement the expanded presentation as a fixed-position class, or keep a permanent `<dialog>` and toggle `showModal()`; a `createPortal` with a switching container does not avoid the remount. `PortraitScene.tsx:401-425`, `PortraitExplorer.tsx:201-206`.
- Suggested command: /impeccable optimize

**[P2] F01 · F11 · F30 · F23 · F25 The explorer is a site within the site.** Nested `<main>`, second `<h1>`, second wordmark, own tokens, `min-height:100dvh`, own header and footer, and two differently named routes to the same prose ("Back to reading" on the card, "Full reading" in the explorer header). The card's own CTA has `className="button"` with no modifier and paints in Chromium's grey (`styles.css` gives bare `.button` no colour; five other CTAs on the Pattern page share the miss). The explorer's viewport media queries assume a page width: at 1440 the reader is squeezed to its 320 px floor (33 characters per line at 19 px serif, 1,204 px of internal scroll in a 665 px box); at 320 px three stacked paddings leave 222 px, the six-button toolbar wraps to two rows over the scene and chapter titles wrap to four lines. The opt-in card with always-expanded terms sits between the Pattern heading and the first chapter on every visit: 807 px of an 844 px phone viewport.
- Why it matters: the most visible surface on the Pattern page reads as an embedded third-party viewer; the written Pattern, the source of meaning, is pushed 1,000 px down; vertical space lost above the scene is what pushes it below the fold.
- Fix: an `embedded` prop that drops `<main>`, header, wordmark, second title and footer in favour of a `<section aria-labelledby>` consuming the shell's tokens and `.button`; fold the primary palette into bare `.button`; `container-type:inline-size` on the host with `@container` breakpoints and `minmax(360px,1fr)` for the reader; collapse the consent terms into a `<details>` once the choice is saved. Give the shell's asides `aria-label`s as a separate fix, since `landmark-unique` fires with the explorer closed.
- Suggested command: /impeccable layout, then /impeccable distill

**[P2] F04 · F10 Generation failure is a dead end, and the retired constellation appears beside it.** On `failed` the card renders two sentences and no action; retained models are unreachable; turning automation off mid-generation keeps "Creating your portrait" until the runner's next claim and then reports the reader's own stop as "could not be completed". The verifier traced the server: a fresh grant does resume withdrawn and image-phase work, only exhausted mesh jobs are terminal, and nothing tells the reader any of that. Separately, whenever images are done but meshes are generating or failed, the legacy "Your constellation" section mounts as a second boxed section with the same subheading, a "View constellation" that opens the retired star graph, and a second download with different contents; it vanishes when meshes finish, and after a mesh failure it stays forever.
- Why it matters: the one valley in the journey offers no explanation and no next step; readers get a different product than the one they opted into.
- Fix: add an additive `failure_reason` (withdrawn / exhausted / refused / unavailable) to the explorer response and branch the copy on it; acknowledge the untick immediately ("Stopping unfinished work…"); a Retry that re-issues the same PUT re-grant. During `generating` do not mount the legacy component; during `failed` keep the saved constellation reachable per spec §11, but inside the single "Your 3D portrait" section with one heading and one secondary action. `AccountPortraitExplorer.tsx:94-99, 182, 192-193`, `pattern-portrait-mesh.ts:155-161, 904-921`.
- Suggested command: /impeccable clarify, then /impeccable harden

## Verified P2 backlog

Every item below was reproduced from scratch by a verifier on the account path.

- **F06** Chapter and facet chosen inside the phone reader or the expanded scene are discarded on return; the reducer treats those presentations as undo-able overlays and `explorer-state.test.ts:38-42` enshrines it.
- **F08** Explorer history entries outlive the explorer: after "Back to reading", Back does nothing three times (with scroll jumps) and then leaves the site; opening the explorer pushes no entry, so Back never closes it.
- **F09** No exit inside the explorer: at the footer the card's toggle is 629 px (desktop) to 1,827 px (320 px phone) above the viewport; the wordmark link, the rail "Pattern" item and the bottom-nav tab do nothing.
- **F12** The Codex opt-in is a bare checkbox outside the shared consent block that PatternConsent and AiConsent use on the same page; no policy line, no retention wording, no sentence that Codex also writes the object name and note the reader will read. The "images are sent" copy is accurate.
- **F14** Phone reading mode has no sticky scene/return strip; at the end of a chapter "Return to portrait" is 492–833 px off-screen. The system Back gesture exits reading mode, undocumented.
- **F16** Starting a page scroll on the phone canvas tilts the camera 11° per scroll and saves the drifted pose as the bookmark; three scrolls flatten the portrait to the horizon. Snapshot the pose on `pointerdown` and restore on `pointercancel`, then save again.
- **F17** "Show in portrait" changes nothing in the scene except a label number and always snaps the camera to the home pose, discarding the reader's orbit and zoom; the canvas hash is identical across all four facets. Reframe only when the chapter is clipped and relabel to what it does.
- **F18** Keyboard focus drops to `<body>` after compare, End comparison, Exit guide, Finish exploration and "Explore the first chapter"; after compare-start the next Tab lands on "Delete this Pattern".
- **F20** The 3965be focus ring measures 1.7–2.6:1 on every dark scene surface (WCAG 1.4.11); restoring Focus Cobalt would make it worse. Use a two-tone ring on `.explorer-scene`.
- **F24** Landscape phone 844 × 390: the 470 px scene exceeds the 320 px usable viewport, and the "full-viewport" expanded scene collapses to 300 px with its rail cut off inside the dialog.
- **F27** Four full-mesh raycasts run on every drawn frame for label occlusion: 7 ms of a 13.5 ms frame at 1×, 30 ms at 4× throttling. Test against each form's Box3 instead of 47k triangles.
- **F28** Explorer load is three serial network phases (three.core, then eight assets, then the scene chunk) and blocks on 1.03 MB of images the scene never draws; one generic status line, no progress.
- **F29** Glancing at Today and back re-downloads all 2 MB of verified assets; cache verified Blobs keyed on the explorer response identity and re-mint URLs on remount.

## Persona Red Flags

**Casey (distracted mobile user).** Taps "Explore your 3D portrait" with the button just above the bottom nav: the viewport does not move and the label becomes "Back to reading". Finds the scene by scrolling, taps a chapter, taps "Read chapter" and lands on "The architecture of your chart" 3,400 px away. Scrolls the page with a thumb on the canvas and the portrait tilts toward the horizon. Finishes the chapter and finds no way back to the portrait or the written reading; presses the system Back gesture three times with nothing happening, then leaves the app.

**Sam (screen reader and keyboard).** Hears two `main` landmarks and two `h1`s. After activating Explore, focus lands on an unnamed `div`; twenty Tab stops separate entry from the first reading control. Focus drops to `body` after starting a comparison, and the next Tab lands on "Delete this Pattern". The focus ring is below 3:1 on every dark scene control. The canvas is `role=img` with a good label, but body picking has no keyboard equivalent when the overlay labels are hidden by occlusion or by the small-scene rule.

**Jordan (confused first-timer).** Ticks a checkbox and looks for a Create button; the status line appears but nothing says how long four images and four models take. On failure reads "could not be completed. 2 of 4 models are saved." with no button. Meets a second "Pattern/Like" masthead inside the page and reads it as having left the app. Sees "Full reading ↗" and "Unfold portrait ↗" as links that leave the page.

## Minor Observations

Re-graded to P3 by verification: F13 the tagline "Explore what connects you." (desktop-only, 14 px) and the guide's inherited facet with no per-stop orientation; F15 the explorer's spec-mandated facet labels versus the written page's longer H4s, and a lowercase facet id in the live region; F19 the checkbox blurs to `body` while saving; F21 a 10 px footer instruction on phones; F22 h2 larger than h1, 19 controls and 20 Tab stops in the first viewport (collapse the toolbar to one roving-tabindex stop and make overlay labels `tabIndex=-1`); F26 the model-written object name and "Visual metaphor" note carry no authorship line.

Unverified P3 findings, listed for the backlog: F31 parallel design system in `explorer.css`; F32 "Reset view", "Frame selection" and Home are one command; F33 `aria-label` on a generic `div`; F34 legacy fallback stacks two opt-ins; F35 portrait errors give no reason; F36 mixed `aria-pressed` semantics; F37 input during a selection transition bookmarks a half-finished pose; F38 tilt down reaches below the single-sided ground plane; F39 fixed selection ring ignores object footprint; F40 unfold spreads by only 0.5 units then pulls the camera back; F41 loading placeholder hue differs from the canvas clear colour; F42 chapter 3's label is dropped by the collision pass in the default view; F43 anonymous objects on the embedded phone scene; F44 focused "Next stop" hidden by the reader's scroll clip; F45 undocumented Tab stop on the toolbar group; F46 "Show in portrait" visible label not in its accessible name; F47 active-passage marker at 2.29:1; F48 chapter title below the fold after phone selection; F49 focus targets ignore the fixed app chrome; F50 "A different wayto see your Pattern." on phones; F51 expanded scene on phones has no title, an icon-only exit and no safe-area allowance; F52 fixed-px typography ignores the browser font preference; F53 no in-flight guard on restoring dispatches; F54 "Show passage" silently ends a guide or comparison; F55 first frame is one synchronous block; F56 unfold has no reading response; F57 rail focus gives no scene emphasis; F58 one artefact, five nouns; F59 Unicode arrows as meaning carriers; F60 smaller voice slips; F61 mismatch error says "constellation"; F62 ready transition silent for assistive tech; F63 the 2.7 MB base64 download has no format explanation; F64 the toggle reads "Back to reading" while assets are still loading.

## Coverage limits

The completeness critic named four areas no lens exercised, each with a ready-to-run check in the scratchpad. Two of its own probes found something: (1) a stale-deploy lazy-chunk failure leaves "Try 3D again" and "Retry portrait loading" permanently unable to recover, because the browser module map remembers the failed import and the Worker answers a missing hashed chunk with `index.html`; and (2) under forced colours the chapter rail's selected state is conveyed by background fill alone. Neither was verified by a second agent. Also unexercised: content at contract scale (90-character titles, six sections, 800-character rationales), and Pattern regeneration completing while the reader is inside the explorer. No real screen reader, no Safari or Firefox, no physical device frame times or GPU memory, and the production build was used only for bundle sizing.

## Questions to Consider

- Should the account explorer have a masthead at all? It was built as a page and mounted as a section. What is it as a panel inside "A private reading of this chart"?
- The written Pattern is already on this page and "Back to reading" restores it. What does "Full reading" inside the explorer give the reader that costs a header button and a third copy of the prose?
- Is a single checkbox the right gravity for the second processor grant on the same content, when Daily and Pattern consent use the shared processor/purpose/policy block?
- Nine camera controls for a scene whose spec says motion should communicate navigation, not spectacle. Would drag, Reset and Expand alone make the objects feel more like evidence and less like a toy?
- On the phone the objects are anonymous until tapped and the rail below carries their names. Is that still "inspectable by default", or should the mobile default be the unfolded, labelled layout?
