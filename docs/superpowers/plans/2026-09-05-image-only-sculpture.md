# Image-only unified sculpture implementation plan

> **For agentic workers:** Use subagent-driven-development for the independent geometry and asset boundaries. The user approved one unified form and a feature-branch commit and push.

**Goal:** Build one interactive sculpture whose actual vertices are derived from all four generated chapter images.

**Architecture:** Chapter-local prompts and frozen reading bindings produce four image assets. A loader supplies only decoded RGBA pixels to a pure geometry function. The reader associates neutral image slots with chapters after modeling; text, labels, hashes, and subject constructors cannot determine geometry.

**Tech Stack:** React 19, Three.js 0.185.1, React Three Fiber 9.7.0, Vite, Vitest, Playwright.

**Spec:** The user's accepted correction supersedes the door-only milestone in `../specs/2026-09-05-pattern-object-direction.md`.

## Global constraints

- Exactly four actual generated images, one recognizable object in each, generated using only its own complete chapter text.
- One connected sculptural surface, derived from image pixels; no shared bands, subject-specific constructors, hash seeds, or text-to-geometry route.
- Four different subjects are not multiview photographs. Describe the output as contour-derived abstract synthesis, not recovered geometry.
- Preserve full reading, keyboard controls, reduced motion, mobile page scroll, replacement/removal, and graphics fallback.
- Feature branch only. No merge or production deployment.

## Task 1: Pure geometry and input causality

Files: `apps/web/src/lib/image-sculpture.ts` and colocated tests.

- [x] Test finite normals/bounds, closed connected topology, invalid inputs, repeatability, and vertex changes from each input's silhouette.
- [x] Implement `createImageSculpture(images: readonly ImagePixels[])`, where `ImagePixels` contains only `width`, `height`, and `Uint8ClampedArray data`.
- [x] Return one owned `BufferGeometry`, average color, and numeric source contributions; retain numeric source attribution for navigation.
- [x] Inspect all four neutral references and rendered output; report the technical assumptions and unrecovered hidden surfaces.

## Task 2: Asset boundary and reader integration

Files: `lib/pattern-portrait.ts`, `lib/portrait-images.ts`, `preview/image-study.ts`, `preview/references/*`, both portrait components and tests.

- [x] Commit four neutral PNGs retaining identical image data, stripping embedded prompt metadata; retain a separate provenance receipt.
- [x] Bind each reference to frozen full chapter text and revision. Reject stale or incomplete four-image sets before rendering.
- [x] Test `loadPortraitImages(urls, signal)` for four-input count, fetch/decode failures and cancellation; decode/downsample pixels and close bitmaps.
- [x] Pass only four neutral URLs into the scene loader and only four pixel arrays into geometry. Selection changes camera/material, never positions.
- [x] Show all four reference images alongside chapter buttons. Keep the unified whole present during chapter selection.

## Task 3: Verification and feature branch delivery

- [x] Build the isolated preview and inspect desktop/mobile screenshots. Exercise rotation, zoom/reset, chapter reading, narrow-page scroll, keyboard, fallback, and replacement/removal.
- [x] Run affected tests, full `npm run ci:local`, and independent review. Record current evidence in the handoff.
- [x] Export a reviewable artifact and record source-to-image-to-geometry limits.
- Delivery command: stage an explicit file list, commit scoped work, push `codex/pattern-portrait` normally, and prove the remote branch SHA matches local HEAD. All verification prerequisites passed; the final task reply records the resulting remote SHA.
