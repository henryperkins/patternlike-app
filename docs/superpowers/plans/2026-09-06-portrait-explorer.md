# Portrait Explorer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Work in `/home/henry/patternlike-app/.worktrees/portrait-explorer`; preserve the original portrait branch and main checkout.

**Goal:** Implement the approved substantial portrait experience as a complete fictional study with genuine GLB fixtures, source-bound reading exploration, comparison, guidance, responsive controls, and preserved camera state.

**Architecture:** Add a separate `PortraitExplorer` component alongside the existing saved graph reader. A versioned local mesh bundle supplies four authored fixtures; the new controller coordinates a lazy Three.js renderer and semantic HTML reader. Existing account and numeric-graph contracts remain compatible. The public preview entry exposes the new study and a labelled comparison to the previous constellation.

**Tech Stack:** Existing React 19, TypeScript, Three.js 0.185.1, React Three Fiber 9.7.0, Vite, Vitest; Node 22 from `.nvmrc`.

**Spec:** `docs/superpowers/specs/2026-09-06-pattern-portrait-experience-redesign.md`, approved in this conversation.

## Global constraints

- Preserve all published chapter fields, signatures, uncertainty, and exact source/reference association.
- Genuine volumetric fixture objects; do not substitute image planes or sparse contour extrusions.
- Fixture meshes are explicitly authored fictional assets, not automatic per-account generation.
- Keep private generation, account storage changes, migration, and deployment outside this implementation stage.
- Complete native keyboard/touch alternatives; 44px controls; reduced motion; no idle animation or new provider calls.
- No commit, push, merge, or deployment is required by this implementation approval.
- Use the generated visual reference at `docs/superpowers/artifacts/portrait-explorer/design-reference.png`; follow its layout, palette, typography, and substantial object treatment. Native controls and the complete source text take precedence over image omissions.

## Task 1: Author and validate fixture meshes

Files: `scripts/portrait-explorer/build-fixture-assets.mjs`, `apps/web/public/portrait-explorer/*.glb`, `apps/web/public/portrait-explorer/fixtures.json`, associated generator tests.

- [ ] Inspect all four native source PNGs and author compass, bench, rope, spyglass as complete volumetric meshes.
- [ ] Export self-contained GLB files; record image/model SHA-256, bounds, triangles, and authoring provenance.
- [ ] Validate GLB headers, finite bounds, node identity, nontrivial depth, triangle/payload budgets, and deterministic regeneration.
- [ ] Inspect front/side/rear/three-quarter screenshots in the integrated renderer before accepting assets.

## Task 2: Scene and camera

Files: `apps/web/src/components/portrait-explorer/PortraitScene.tsx`, `scene-utils.ts`, `scene-utils.test.ts`.

Consumes shared `types.ts` scene props. Produces a lazy default-export scene with validated authenticated-byte-compatible GLB loading, material lighting, whole/chapter/comparison framing, unfold/reassemble, body picking, HTML labels, native gesture separation, demand rendering, disposal, and graphics-loss fallback.

- [ ] First write regressions for bounds framing, selection/gesture boundaries, asset validation and camera restore semantics.
- [ ] Implement only within the owned scene files; coordinate interface changes with the controller.
- [ ] Verify isolated tests and typecheck; expose visible status and real camera bookmarks.

## Task 3: Navigation and source projection

Files: `apps/web/src/components/portrait-explorer/explorer-state.ts`, `explorer-state.test.ts`, `content.ts`, `content.test.ts`.

Consumes `PortraitManifest` and exact-bound mesh metadata. Produces pure semantic navigation, per-chapter facet/passage state, reversible comparison/guidance/presentations, and exact source passage projection. Root controller owns browser history and DOM focus.

- [ ] Demonstrate failing regressions for compare return, full-reading return, per-chapter facet memory, all four facets, and source replacement.
- [ ] Implement typed transitions with bounded history and reject invalid chapter/facet/passage references.
- [ ] Validate source binding against full chapter text and image identity; never replace the original prose with annotation copy.

## Task 4: Complete reader and responsive study

Files: `PortraitExplorer.tsx`, `ExplorerReader.tsx`, `explorer.css`, component tests, `preview/portrait-explorer-fixture.ts`, existing preview entry.

- [ ] Build the native HTML workflow: whole/chapter, facet tabs, linked passages, source-image inspection, compare, guide, full reading, and explicit expand/return controls.
- [ ] Preserve camera and reading bookmarks through modal and renderer lifecycle; scope keyboard/history to the portrait.
- [ ] Keep chapter navigation visible in Explore and render every field in Full reading, including uncertainty and additional signatures.
- [ ] Match the reference layout using the existing tokens: compact header, dark scene, warm reader, four chapter controls.
- [ ] Add keyboard, lifecycle, source replacement, reading parity, failure, and modal regression tests.

## Task 5: Integration, independent review, and verification

- [ ] Run focused web tests and workspace typecheck after integration.
- [ ] Render 1440x900, reference-native size, 390x844 and 320px with local Playwright; inspect actual meshes from all required angles.
- [ ] Verify chapter/facet/passage/source/compare/guide/return paths, pointer/touch/keyboard controls, camera restoration, reduced motion, context loss, and no horizontal overflow.
- [ ] Review component and renderer changes independently; resolve material findings.
- [ ] Run `npm run ci:local` against the final source tree and retain the complete summary and exit code.
- [ ] Write a truthful handoff distinguishing implemented fixture experience, browser evidence, unverified physical-device/user-study gates, and the separate production asset pipeline.

## Rulings and progress

- Ruling: use a new sibling worktree based on `82d5dd9` and copy the approved review/specification into it. This protects the original review and existing implementation.
- Ruling: implementation approval covers the complete fixture experience through spec stages 1–5. Stage 6 explicitly separates automated account mesh generation and production release; neither is inferred from this approval.
- Ruling: use one concrete generated visual reference for the already-approved specification; no additional design-selection gate is necessary.
- Baseline: targeted existing portrait/scene tests are being run before integration.
