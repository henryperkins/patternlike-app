# Portrait Observatory and Zodiac merge review — 2026-09-07

This integrates the two September 6 designs on top of source-register merge `8d15092c0687b223e82c919e369625f623c8db34`. The observatory presents all four saved Pattern chapters; the separate sky view uses a minimized, identity-matched Sun/Moon/rising projection. The complete written reading remains available independently of the scene.

## Review corrections

The independent source/spec review passed after removing copied retrograde and unused accuracy fields, preserving same-source reader/navigation state when sky data changes, and qualifying no-marker fallbacks. Regression tests cover the corrected minimization, state retention, and actual scene accessibility. See [the full source review](artifacts/2026-09-07-portrait-merge/independent-source-review.md).

## Observed local validation

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

A new source-frozen full gate will be recorded and attached verbatim to the PR before merging. The first gate's passing API lane logged workerd teardown diagnostics also seen in the preceding source-register gate; its 2,482 tests and compatibility lane completed with exit 0.
