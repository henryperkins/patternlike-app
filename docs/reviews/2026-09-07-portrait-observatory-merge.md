# Portrait Observatory and Zodiac merge review — 2026-09-07

This integrates the two September 6 designs on top of source-register merge `8d15092c0687b223e82c919e369625f623c8db34`. The observatory presents all four saved Pattern chapters; the separate sky view uses a minimized, identity-matched Sun/Moon/rising projection. The complete written reading remains available independently of the scene.

## Final supplied-audit corrections

Final source `8b9386848f1529c51bf67378fc1a6f30f79d93c1` resolves the supplied mobile framing, clipped placement names, disconnected sky readout, phone entry, and graphics-failure guidance findings. Camera bookmarks retain relative framing across viewport changes; the landscape scene has a scrollable support column; selected readouts avoid measured sign/marker bounds while their leaders reach the actual chart markers. The narrow header grows around legible helper text. Initial reading is available before the canvas, and graphics failure offers adjacent reading and retry actions.

The final scoped independent re-review is **PASS**, with no open Critical or Important findings. [Implementation and test history](artifacts/2026-09-07-portrait-feedback/implementation-review.md) and [independent re-review](artifacts/2026-09-07-portrait-feedback/independent-feedback-review.md) retain the earlier findings and their resolution.

Verification is limited to the 3D Pattern work under the user's latest explicit instruction:

- The nine-file portrait lane passed 119/119 on the first feedback candidate. The collision/header correction then produced an intermediate 120-pass/1-fail result; after correcting its clearance, the final two affected files passed **29/29**. The remaining portrait files retain their earlier passing results; this is not a new nine-file or full-repository pass.
- `npm run build:portrait -w @patternlike/web` passed on frozen `8b93868`, with all 26 artifacts recorded and included source unchanged (SHA-256 `05a425b079699c1d177b92f1818003696c6f6bcf1fc8e03a3c1c0be1e3f8ed65`). The existing large-chunk advisory remains.
- Built Chromium 1237/SwiftShader, reduced motion: 390px expansion shows all twelve signs without Reset in a 356 × 547px canvas. At 320px and 844 × 390 landscape, Sun, Moon and Rising each settle visibly, with all twelve signs inside the canvas and no readout/sign intersections. Landscape canvas height is 296px. At 320px, the header contains its wrapped content and Cancer/Taurus/Libra remain inside 96px placement cells without page overflow.
- Actual WebGL context loss removes the canvas and displays honest paused guidance with adjacent 44px-high Retry and Continue reading buttons. Continue reading focuses the Chapter 2 heading; retry restores the canvas, Chapter 2, Resources, the open reading desk, and Dusk.

[Final browser measurements](artifacts/2026-09-07-portrait-feedback/browser-final.json) retain the intermediate rapid samples separately from the successful settled observations. [Narrow phone](artifacts/2026-09-07-portrait-feedback/final-narrow-moon.png) · [Expanded phone](artifacts/2026-09-07-portrait-feedback/final-phone-expanded-sky.png) · [Landscape](artifacts/2026-09-07-portrait-feedback/final-landscape-rising-settled.png) · [Graphics fallback](artifacts/2026-09-07-portrait-feedback/final-desktop-graphics-fallback.png).

## Review corrections

The independent source/spec review passed after removing copied retrograde and unused accuracy fields, preserving same-source reader/navigation state when sky data changes, and qualifying no-marker fallbacks. Regression tests cover the corrected minimization, state retention, and actual scene accessibility. See [the full source review](artifacts/2026-09-07-portrait-merge/independent-source-review.md).

## Earlier candidate validation

- Focused review: 117 tests in eight files passed after the first three corrections; all 17 projection tests passed after the final minimization correction. The final preview build also typechecked the integrated web source.
- `npm run build:portrait -w @patternlike/web` passed on Node 22.23.2. The existing large-chunk warning remains. An earlier build rejected an obsolete accuracy field in a test fixture; the fixture was corrected before the successful build.
- Built static fictional preview, Chromium 1237 with SwiftShader: desktop 1440 × 960 and phone viewport 390 × 844. Chapter 2 / Resources, the open reading desk, and the chapter selection survived Pattern/sky navigation. Moon readback was 12° 30′ Taurus. The phone chapter reader retained its content without horizontal overflow.
- The full reading exposed all four named chapters and all sixteen chapter facet sections.
- Unknown birth time exposed only the supported Sun placement; Moon/rising were unavailable and no house was displayed. Approximate rising remained visibly qualified.
- A real `WEBGL_lose_context` event displayed the graphics fallback, and the native chapter reader still opened the selected text afterward.
- Final built-preview console: zero errors; four SwiftShader GPU readback warnings and the expected Three.js context-loss message. Earlier development-server/HMR observations are not final browser evidence.

[Desktop](artifacts/2026-09-07-portrait-merge/built-desktop.png) · [Phone reading](artifacts/2026-09-07-portrait-merge/built-mobile-reading.png) · [Unknown birth time](artifacts/2026-09-07-portrait-merge/built-unknown-time.png) · [Reading after graphics loss](artifacts/2026-09-07-portrait-merge/built-graphics-fallback.png). Bounded browser receipts, console output, and the intended web-file hashes are retained in the same artifact directory.

## Evidence limits

These are local built-fixture observations. Physical phones, Safari, VoiceOver/NVDA, live-account lifecycle behavior, and production adoption were not checked by this review. Source identity, the local aggregate gate, and Workers deployment observations are separate evidence. The historical September 6 plan receipts remain historical and do not substitute for this merge's gate.

The first source-frozen aggregate gate completed with 13 passing lanes and one failing web lane. One ChartView test still expected the removed `accuracy` field; 652 web tests passed and that assertion failed. The [nonpassing receipt](artifacts/2026-09-07-portrait-merge/local-release-evidence.json) is preserved. Correcting that expected object passed 37 focused tests across ChartView, account propagation, and sky projection. This was a test-only follow-up to the final browser build; the rendered implementation did not change. The browser file-hash record retains the original build inputs.

The second complete gate also had 13 passing lanes, with one web test timing out at the default five-second whole-test limit. The [second nonpassing receipt](artifacts/2026-09-07-portrait-merge/local-release-evidence-attempt-2.json) is preserved. That integration case constructs two complete scenes and independently allows each five seconds to become ready; a focused diagnostic completed at 4,694 ms. Its total test budget is now twelve seconds, retaining both five-second readiness checks and every assertion. The complete web suite then passed all 653 tests in 50 files. This follow-up changes only a test budget, with no rendered implementation change.

The third full gate was deliberately stopped after the user's instruction to run only tests directly related to the 3D Pattern work. It is interrupted evidence, not a pass, and no replacement full gate was run. All remaining PR verification is explicitly scoped above. The first gate's passing API lane logged workerd teardown diagnostics also seen in the preceding source-register gate; its 2,482 tests and compatibility lane completed with exit 0 before the restriction.
