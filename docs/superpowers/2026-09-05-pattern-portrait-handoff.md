# Pattern portrait: chapter images with Sun-sign influence

The current milestone implements the user's corrected direction: four actually generated chapter images produce **one unified sculptural form**. Each reference depicts one familiar object, generated using its own full fictional chapter text. The viewer computes a base mesh from the four decoded image buffers, then optionally deforms it using an explicitly supplied Sun sign. The earlier shared-band and authored-door demonstrations have been superseded and their geometry constructors removed.

This is an isolated fictional preview on `codex/pattern-portrait`, based on `f658b6c`. The user authorized committing and pushing this feature branch. The fictional preview is public at https://patternlike-portrait-preview.lfd.workers.dev. It is not integrated into the production reader.

## Sun-sign extension

The user subsequently requested that their actual Sun sign also influence the shape, expanding the earlier image-only requirement. `sun-sculpture.ts` defines twelve explicit artistic directions for proportions, taper, curvature, and twist. These deform the image-derived vertices before normals and bounds are computed; they do not add a separate object, substitute a zodiac symbol, change the four images, or alter the chapter text. Positive cross-sectional scales and a height-preserving transform retain the surface topology. Without a sign, the original vertex positions are unchanged.

`PortraitSource.ready.sunSign` accepts the shared lowercase `ZodiacSignName` union. The manifest validates runtime values and uses null for missing or unsupported signs; it never infers a sign from prose. The published document revision and image bindings remain independent of the sign. The renderer identity and readiness include it, so sign changes rebuild the mesh while keeping the selected reading. Returning rapidly to a previously rendered sign still waits for its fresh renderer.

The public preview has no authenticated chart connection. Its visible **Your Sun sign** selector uses the sign supplied by the visitor, starts unselected, and keeps the choice in page state only. The introductory copy identifies both the fictional chapters and the artistic nature of the mapping. For future account integration, the active authenticated `/v1/chart` response supplies `positions.find(position => position.body === "sun")?.sign`; the account-owning parent must validate and pass that fact with the matching Pattern. That production wiring remains unimplemented.

The committed GLB and earlier screenshots below record the original form with no Sun sign. The interactive viewer generates sign variants at runtime. Sun-sign verification is recorded separately below so the earlier image-only evidence is not mistaken for coverage of this extension.

## Run and inspect

From the repository root, using the Node version in `.nvmrc`:

```sh
npm install
npm run build:portrait -w @patternlike/web
npm run preview:portrait -w @patternlike/web
```

Open [the built preview](http://127.0.0.1:4174/pattern-portrait.html). For editing, `npm run dev:portrait -w @patternlike/web` serves port 5174. The regular production entry remains separate; the generated PNGs and Three viewer are imported only by the preview.

All four PNGs are committed under `apps/web/src/preview/references/`. A fresh checkout can reproduce the interactive model without credentials, image generation calls, or a 3D provider. The preview uses fictional text and same-origin static requests.

## What shapes the model

1. `specs/2026-09-05-chapter-image-prompts.json` preserves the four actual `chapter-object-v2` prompts. Each includes its own complete title, summary, prose sections, tensions, resources, and counter-expression; it contains no other chapter's prose.
2. The four generated subjects are a door, notebook, metronome, and lantern. Their neutral PNG files retain the original IDAT image data and omit ancillary embedded prompt/provenance metadata. `preview/references/provenance.json` records original, prepared, and IDAT hashes and dimensions.
3. `preview/image-study.ts` binds each image to a frozen full-text snapshot and document revision. `createPortraitManifest` drops bindings when any chapter field or the document identity changes. `portraitImageUrls` permits the sculpture only with a complete four-image set and passes just four URLs onward.
4. `loadPortraitImages` fetches and decodes the images, downsamples to at most 128 pixels per side, closes each bitmap, and yields only width, height, and RGBA pixels. Cancellation prevents late scene publication.
5. `createImageSculpture` segments foreground against border color/alpha, measures silhouettes, coverage, skew, and enclosed background, and blends the four contours into one closed surface. Every input contributes to contour and thickness. The strongest significant enclosed opening determines an aperture. No chapter words, subject names, hashes, existing object constructors, or per-person seeds enter the function.
6. The renderer owns one geometry. Numeric source attribution connects a clicked surface region back to its chapter after modeling. Chapter selection adjusts camera and color while retaining the entire mesh and its vertex positions.

The geometry implementer inspected only four neutrally named image files as creative inputs, plus technical workflow references. That was an audited input restriction, not an operating-system sandbox. That historical image-only restriction now applies to the base surface; the user-authorized extension adds one validated Sun-sign value as an explicit input.

## What the result means

This is an **abstract contour-derived synthesis**, not recovered physical geometry or four independently reconstructed objects. Polar envelopes bridge some concavities; the largest opening is approximated by a fitted ellipse; depth comes from fixed rules applied to measured pixel features. Hidden surfaces and fine material details cannot be recovered from these independent single views. Recognition applies to the four generated reference objects; the unified result blends their features into an abstract form.

This follows the guide's conceptual method of building actual editable geometry, rendering it, inspecting it, and refining the result. The [architectural visualization guide](https://developers.openai.com/blog/architectural-visualization-with-astra) does not supply a general image-to-3D reconstruction service.

A production system for automatically choosing/generating images for arbitrary published Patterns, storing assets under account permissions, invalidating them on regeneration, and applying deletion/consent rules remains unimplemented. This preview proves the four-image-to-unified-mesh step for one fictional sample. The foreground extractor assumes distinguishable backgrounds and is not validated across unrestricted user images.

## Reading and interaction

The public reader preserves every chapter's summary, prose, tensions, resources, and alternative expression. All four actual reference images appear beside chapter controls. Native buttons supply keyboard navigation, rotation, zoom, reset, and a complete reading view. Selecting a chapter reveals the reader when offscreen; returning to the sculpture retains the selected reading. Accuracy and uncertainty remain visible.

Rendering is on demand, motion respects the system preference, and vertical touch scrolling remains available. Missing references, invalid image decoding, unsupported WebGL, and lost contexts retain readable content without substitute geometry. Replacement, removal, and loading clear stale scenes. Material and geometry cleanup is explicit; chapter highlighting reuses its GPU color buffer.

## Sun-sign verification

**Full local CI passed all 14 lanes with exit status 0**, including 417 web tests and 2,250 API tests. This run tested the Sun-sign working tree on base HEAD `f5db6ee`; the receipt reports that base commit. No runtime source changes were made after those checks. Full log: `/tmp/pattern-portrait-sun-ci.log`.

```text
════════════════════ SUMMARY ════════════════════
commit  f5db6ee on codex/pattern-portrait
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

The focused geometry, manifest, and reader tests passed (76 tests after adding the rapid-return regression); the renderer lifecycle suite also passed (5 tests). All twelve sign variants are deterministic and distinct, retain one closed connected surface with finite normals and bounded coordinates, and leave image evidence/material color intact. Each image still changes structure with a sign applied. Omitting/removing the sign restores the original vertex array exactly.

The tested preview build is `pattern-portrait-EDSLlasz.js` / `PatternSculpture-d-xlrb8_.js`. Desktop Chromium verified twelve distinct rendered variants, unchanged four-image inputs, selected-chapter preservation, rotation, sign removal, delayed-image rapid sign switching, and reading/3D transitions. Axe found zero violations. Independent touch-emulated mobile checks passed **56/56** at 390×844 and 320×740, including horizontal rotation without page scrolling and vertical page scrolling. There were no unexpected runtime errors; aborted superseded image loads in the rapid-switch probe were expected. Existing Three deprecation/software renderer warnings remain. Physical devices and authenticated account integration were not tested.

Browser evidence is under `/tmp/pattern-portrait-sun/` (`desktop-report.json`, `mobile-report.json`, and per-sign screenshots). Browser plugin was unavailable, so these checks used the existing Playwright installation.

## Earlier image-only milestone verification

**Full local CI passed all 14 lanes with exit status 0.** The run used Node 22.23.2, npm 10.9.8, and local Python 3.14.4 (the CI workflow pins Python 3.12). It verified the staged working tree based on `f658b6c`; final source hashes were checked unchanged before committing. The final web suite passed **383 tests in 33 files**; the API suite passed **2,250 tests in 131 files**, plus compatibility and tooling checks. Final browser verification passed **86 of 86 checks** on `pattern-portrait-DNEelpn3.js` / `PatternSculpture-CjAxzNES.js`. Earlier door/band results are historical and do not establish this milestone's correctness.

Completed evidence for the original model without a Sun sign:

- Final browser verification: **44 functional/mobile/fallback/accessibility checks**, **20 exact reading-parity comparisons**, and **22 GPU lifecycle checks** passed. Tested Chromium at 1440px desktop, 390px and 320px mobile, plus reduced motion and dev StrictMode. All four images loaded; scene clicks and chapter buttons preserved the whole mesh; native camera controls, reading facets, removal/replacement, initial WebGL denial, and context loss behaved correctly. Axe found zero violations in the tested state.
- Forty chapter selections allocated no new GPU buffers: five buffers and one shader program remained live. Four reading/3D cycles released observable GPU buffers/programs to zero, then restored exactly five buffers, one program, and one canvas. This does not directly measure JavaScript-object garbage collection.
- Horizontal mobile touch rotated the scene while retaining page position; vertical touch scrolled the page. There was no horizontal overflow at 390px or 320px. Reduced-motion selection rendered once then stopped; idle rendering remained stopped.
- No unexpected browser errors, failed requests, or external requests. The intentional WebGL-denial probe emits Three's expected context-creation error. Dependency `THREE.Clock` deprecation and software-renderer warnings remain. Browser plugin was unavailable; tests used the existing Playwright installation and software WebGL, with no physical-device validation.
- Final local ready observations: desktop **926 ms**, 390px **739 ms**, and 320px **723 ms**. These are observations under local mobile emulation, not production benchmarks. The portable ZIP was extracted into a separate directory and served on port 4175; its renderer and all four references loaded successfully.
- Independent code review cleared the final source after fixes for material disposal, color-buffer reuse, and image-specific readiness. Runtime byte-integrity checking remains a future requirement for mutable remote assets; bundled fixture provenance is independently verified.

- Four generated source files were verified against original tool outputs; prepared PNGs match recorded hashes and retain the original IDAT data with no ancillary chunks.
- The browser-decoded model contains **12,288 vertices and 24,576 triangles**, one closed connected manifold surface. Its bounds are approximately **1.838 × 3.499 × 1.188** units. Pure-geometry regression tests check finite normals, welded topology, invalid/blank input rejection, determinism, per-input structural influence, and ignored metadata.
- A binary glTF export is **493,120 bytes**; export/reload retains **one mesh and 24,576 triangles**. The frozen export and source/hash receipt are committed in `artifacts/pattern-portrait/`; the preview generates the same geometry directly from its PNGs.
- Actual-image substitution checks changed vertex positions for every input. Maximum coordinate changes for substitutions 1→2, 2→3, and 3→4 were approximately **0.599, 0.668, and 0.137** units respectively. Substitution 4→1 removed the image-derived opening and changed topology. RMS comparison is not meaningful across changed vertex ordering/topology.
- The original-resolution prepared PNGs total approximately **7.16 MB**; mobile network transfer has not been optimized. Initial built-preview first-ready measurement was approximately **780 ms** with one canvas. This is a local software-WebGL observation, not a network or physical-device performance guarantee.

## Delivery artifacts

The source branch includes the frozen GLB and verification receipt, the four neutral generated images and their provenance, complete image prompts, fictional reading/bindings, geometry and loader, viewer/reader, and regression tests. Local review artifacts are kept outside tracked source: `/tmp/pattern-sculpture-export/` for the GLB and causality receipt, `/tmp/pattern-sculpture-browser/` for browser evidence, and `/tmp/pattern-sculpture-ci.log` for the full CI log.

A portable static preview ZIP is `/tmp/pattern-sculpture-delivery/pattern-portrait-preview.zip` (archive integrity checked). Extract it, serve the folder with `python3 -m http.server 4174 --bind 127.0.0.1`, and open `/pattern-portrait.html`. It includes the four images, interactive viewer, frozen GLB, and instructions.

Committed review evidence: [desktop](artifacts/pattern-portrait/preview-desktop.png), [mobile](artifacts/pattern-portrait/preview-mobile.png), and [browser summary](artifacts/pattern-portrait/browser-summary.json).

## Full local CI receipt

The pre-commit run prints its base HEAD below; it tested the completed staged source. This receipt authorizes no merge or deployment.

```text
════════════════════ SUMMARY ════════════════════
commit  f658b6c on codex/pattern-portrait
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
