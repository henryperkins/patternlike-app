# Pattern portrait: an image-derived constellation

The current direction follows the user's “Constellation-esque” correction: four actually generated chapter-object images become one connected, rotatable constellation. Sparse stars and fine connections replace the rejected solid contour blend. The four references are a door, notebook, metronome, and lantern, each generated from its own complete fictional chapter text.

This is a fictional preview on `codex/pattern-portrait`, separate from the production reader. The user authorized feature-branch commit/push and the standalone Cloudflare preview at https://patternlike-portrait-preview.lfd.workers.dev. No merge to `main` or production-reader integration is part of this change.

## Inputs and geometry

- `specs/2026-09-05-chapter-image-prompts.json` preserves the four complete `chapter-object-v2` prompts. `apps/web/src/preview/references/` contains the actual generated PNGs and their provenance. Those images are unchanged by this iteration.
- `preview/image-study.ts` binds each image to a frozen full chapter snapshot and document revision. Changed chapter content invalidates its binding. The viewer requires all four references.
- `loadPortraitImages` fetches and decodes each image to at most 128 pixels per side, closes its bitmap, and passes only dimensions and RGBA pixels to geometry generation. Cancellation prevents late scene publication.
- `createImageSculpture` preserves image contour and internal-edge evidence as a sparse star graph. It does not average four radial envelopes, classify object names, read chapter prose, hash a person into a seed, or introduce random background stars. Each star retains a numeric chapter attribution.
- Four image-derived parts are connected into one graph in three-dimensional space. Depth is artistically composed from image features; it is not reconstructed physical depth. The constellation is rendered with point and line geometry, not an opaque surface.
- A supplied Sun sign guides the arrangement through twelve explicit artistic layout profiles. The images and their local features remain intact. These layouts are not measured astronomical star positions or physical/personality claims.

This follows the [architectural visualization guide](https://developers.openai.com/blog/architectural-visualization-with-astra) conceptually: construct actual editable geometry, inspect rendered views, and refine the geometry and composition before delivery. No general image-to-3D reconstruction service is implied.

## Sun-sign data boundary

`PortraitSource.ready.sunSign` accepts the shared lowercase `ZodiacSignName` union. The manifest validates it and uses null for missing or unsupported input; it never infers a sign from prose. Document revision and image bindings remain independent of the sign. Renderer identity and readiness include it, so switching signs rebuilds the graph while retaining the selected reading. A rapid return to a prior sign waits for its fresh renderer.

The public preview has no authenticated chart connection. Its **Your Sun sign** selector starts unselected and keeps the visitor's choice in page state. Future account integration must pass the corresponding authenticated chart's `positions.find(position => position.body === "sun")?.sign` alongside the matching Pattern. That wiring remains unimplemented.

## Interaction and limitations

Star taps highlight a chapter **without scrolling** and show a nearby “Read chapter” action. Chapter-image buttons deliberately open the reader. Returning to the constellation preserves the chapter and expression. A sticky mobile reader header provides Return and a native chapter switcher, including “All chapters” recovery even after graphics loss. The 3D-view mode button always returns to the constellation instead of replaying an earlier reader destination.

The mobile intro is shorter, camera controls occupy one row, and the selected reader sits closer to the constellation. The camera fits the actual graph bounding sphere against the shorter viewport dimension with a 12% margin. Picking selects the nearest projected star within 20 CSS pixels for touch/pen or 8 for a mouse; drags, scrolling, cancelled gestures, and multitouch reject selection. Native controls still rotate, zoom, reset, and switch to complete reading. All published prose, alternative expressions, accuracy, and uncertainty remain available.

The renderer draws on demand and respects reduced motion. Vertical touch scrolling remains available. Missing images, decoding failures, unavailable WebGL, lost contexts, and removed/replaced documents preserve readable content without substitute geometry. Both point and line geometry are owned and disposed by the viewer.

This preview uses one fixed fictional reading and its four generated images. It does not yet generate or store chapter images automatically for arbitrary accounts. Account permissions, deletion/consent handling, and authenticated Pattern/chart association remain future work. The extractor assumes the reference backgrounds distinguish the subjects; unrestricted imagery is not validated. Image transfer remains approximately 7.16 MB. Browser mobile emulation does not establish physical-device performance.

The committed `artifacts/pattern-portrait/unified-sculpture.glb`, earlier screenshots, and earlier browser receipt record the superseded solid model. They are historical artifacts and do not represent this constellation. The current constellation is generated at runtime from the four bundled PNGs. A current portable [constellation.glb](artifacts/pattern-portrait/constellation.glb) is also included: 32,912 bytes, with 305 points and 310 segments in one connected graph. GLTFLoader roundtrip preserved positions, colors, attribution, and bounds exactly. Its [receipt](artifacts/pattern-portrait/constellation-model.json) distinguishes the exported geometry and colors from the viewer's custom glow and controls.

## Run

Use the Node version in `.nvmrc` from the repository root:

```sh
npm run build:portrait -w @patternlike/web
npm run preview:portrait -w @patternlike/web
```

Open http://127.0.0.1:4174/pattern-portrait.html. For editing, `npm run dev:portrait -w @patternlike/web` serves port 5174. The regular production entry remains separate.

The Cloudflare preview is a separate static Worker, `patternlike-portrait-preview`. Its task-owned deployment packet is under ignored `.impeccable/review/cloudflare/`; the built `pattern-portrait.html` is also copied to `index.html` so the public root works. Do not use the production web deployment script for this preview.

## Verification of this iteration

The final preview passed TypeScript and Vite production compilation, and the complete web suite passed **438 tests in 34 files**. Coverage includes image causality, internal edges, graph connectivity, sign layouts, invalid inputs, cancellation, readiness, disposal, camera framing, touch picking, intentional reading navigation, return-state preservation, and mode-switch focus.

Actual browser-decoded reference pixels generate **305 stars and 310 segments**: 66 / 75 / 82 / 82 stars per chapter. Replacing each of the four images independently changes that chapter's coordinates while leaving the other three chapters' coordinates unchanged. The default bounds are approximately 2.444 × 2.771 × 0.557 units. This is shallow spatial relief, not recovered hidden object surfaces.

Desktop Chromium verified the final public point/line draws, visible stars, direct star selection, idle rendering stopping, all twelve sign variants, unchanged reference URLs, preserved reading selection, rotation, sign removal, rapid sign return, and reading/3D transitions. Axe reported zero violations. Superseded image loads were intentionally cancelled during rapid sign replacement; there were no unexpected runtime errors.

Mobile navigation checks passed **56/56 locally**, followed by **66/66 against the final public build**, at 390×844 and 320×740. Final checks cover forgiving near-star taps without scrolling, explicit reading navigation, preserved chapter/expression across return and Reading → 3D, sticky reader controls, all four chapter switches, All chapters recovery both normally and after graphics loss, Reset, horizontal rotation, vertical scrolling, idle rendering, and three sign renders. There were no runtime errors, failed requests, external requests, or horizontal overflow. Axe found zero violations in the overview, reader, and sticky-reader states at 320px. All six final public mobile screenshots were visually inspected.

The public root, preview path, and all seven built assets match the tested deployment packet byte-for-byte. Worker version `a336a569-d55c-42d3-bcd4-c6f9a30f06ed` receives 100% of preview traffic. The final entry is `pattern-portrait-z_p0qTll.js`, renderer `PatternSculpture-Coi5m8PK.js`, and stylesheet `pattern-portrait-yav6X_ed.css`.

Current review artifacts: [desktop](artifacts/pattern-portrait/constellation-desktop.png), [mobile arrival](artifacts/pattern-portrait/constellation-mobile.png), [mobile selection](artifacts/pattern-portrait/constellation-mobile-selection.png), [sticky reader](artifacts/pattern-portrait/constellation-mobile-reader.png), and [verification receipt](artifacts/pattern-portrait/constellation-verification.json). Detailed temporary browser evidence is under `/tmp/pattern-portrait-constellation/` and `/tmp/pattern-portrait-mobile-polish/`. Browser plugin was unavailable, so checks used the existing Playwright installation with software WebGL.

Full local CI passed all **14 lanes with exit 0**, including 2,250 API tests and 438 web tests. A final mode-switch focus fix and its jsdom scroll stub followed that run; the affected frontend was typechecked, rebuilt, and its complete 438-test suite rerun successfully. Backend and geometry source did not change during that follow-up. Final source hashes are recorded in the verification receipt. The summary identifies the base HEAD used for the working-tree run; no merge is authorized by this receipt.

```text
════════════════════ SUMMARY ════════════════════
commit  25c8b66 on codex/pattern-portrait
node    v22.23.2   npm 10.9.8   python 3.14.4
note    local 3.14.4, ci.yml pinned 3.12

  pass   contracts: npm run test:contracts
  pass   monorepo: npm ci --dry-run (lockfile agrees with package.json)
  pass   monorepo: ephemeris download
  pass   monorepo: npm run typecheck
  pass   monorepo: test @patternlike/shared
  pass   monorepo: test @patternlike/reading-engine
  pass   monorepo: test @patternlike/calc-stub
  pass   monorepo: test @patternlike/ontology-signer
  pass   monorepo: test @patternlike/api
  pass   monorepo: test @patternlike/web
  pass   monorepo: npm run build
  pass   extra: test @patternlike/pattern-engine
  pass   extra: test @patternlike/codex-runner
  pass   extra: npm run test:content

ALL STEPS PASSED — safe to merge on local evidence.
```
