# Pattern portrait explorer — implementation and verification

Approved design: [Detailed redesign specification](../superpowers/specs/2026-09-06-pattern-portrait-experience-redesign.md). Original evidence: [Experience review](2026-09-06-pattern-portrait-experience-review.md).

This implementation delivers the fictional fixture experience in an isolated worktree, based on portrait commit `82d5dd9fd3ff406bcec985411dc58fcbf2bf3432`. Branch: `codex/portrait-explorer`. Local development preview: `http://127.0.0.1:5175/pattern-portrait.html`. Built preview: `http://127.0.0.1:4175/pattern-portrait.html`. At the initial implementation handoff, no commit, push, migration, account rollout, or deployment had been performed. The verification record below is updated for the subsequent main integration request.

## What changed

The preview now opens a four-part volumetric portrait with solid compass, rocking bench, knotted rope, and spyglass models. These are deterministic, authored fictional fixtures based on the existing native image references. They are not automatic image reconstruction or generated account portraits.

The interaction loop is complete: choose a mesh body or named chapter, select a perspective, follow its annotation to the exact source paragraph, and return to the whole. Reading links select and reveal the corresponding scene anchor. Native controls also provide orbit, tilt, zoom, framing, reset, unfolding, reassembly, and expanded inspection.

Two-chapter comparison presents both complete facets without inventing a relationship between them. The manual guide walks through all four chapters. Original-image inspection shows the bound image and the existing visual-metaphor rationale. Full reading preserves every chapter field, additional signatures, uncertainty, and source revision, and opens at the current chapter.

Chapter/facet/passage state, camera bookmarks, assembly state, and desktop reader scroll positions survive presentation changes. Browser Back uses opaque in-memory navigation entries. Image URL hydration preserves the reading state; source replacement clears it. The previous image-derived graph preview remains available through the fictional preview scenarios. Existing account `PatternPortrait` behavior is unchanged.

Desktop uses a scene with persistent chapter controls and a separately scrolling reader. Tablet layouts stack. Phone layouts offer Explore, Read chapter, and an expanded scene; vertical touch gestures remain page scrolling in the embedded view. Enlarged text can grow the scene and wrap its controls instead of compressing the models.

## Files and boundaries

- Controller, reader, navigation, scene, utilities, styles, and regressions: `apps/web/src/components/portrait-explorer/`.
- Fictional binding adapter: `apps/web/src/preview/portrait-explorer-fixture.ts`.
- Preview integration: `apps/web/src/preview/pattern-portrait-preview.tsx`.
- Versioned fixture metadata and GLB files: `apps/web/public/portrait-explorer/`.
- Reproducible asset generator, validation, and 32-angle inspection harness: `scripts/portrait-explorer/`.

Metadata validates the complete chapter source, source revision, reference hash, and artifact hash. Downloaded GLBs are bounded, SHA-256 checked, and rejected if they contain external resource references or a wrong, duplicate, missing, or conflicting chapter identity. Source prose remains in the DOM reader. The renderer disposes geometry, materials, textures, decoded image resources, controls, observers, and GPU resources when ownership ends.

The four asset payloads total **2,385,588 bytes**, **79,196 triangles**, and **16 base material draw calls**. Lighting/shadow passes are additional rendering work. Low-power mode reduces pixel ratio and optional lighting costs; it uses the same fixture geometry.

## Verification record

- Focused explorer suite: **59 tests**, including 14 controller/reader tests, 25 state/content tests, and 20 renderer/geometry/lifecycle tests.
- Deterministic asset validation: **6 tests**, including official GLTFLoader decoding, exact source hashes, finite geometry, valid volumetric bounds, budgets, and byte-identical regeneration.
- Production portrait build: passed; Vite reports a shared Three.js/OrbitControls chunk above its 500 kB minified advisory threshold (approximately 144 kB gzip). No threshold was suppressed.
- Initial aggregate `npm run ci:local`: **13/14 lanes passed**, including all 529 frontend tests, 2,282 primary API tests, the compatibility test, all other test suites, and builds. The type-check lane failed because two workspace-local `@cloudflare/workers-types` packages were missing. After restoring their locked version `4.20260702.1`, the full `npm run typecheck` passed with exit 0. Source and lockfile hashes remained unchanged.

Browser evidence uses Chromium with SwiftShader on Linux, with desktop 1440×900, tablet 820px, phone 390×844 and 320×740, and emulated touch. This is software-rendered evidence, not physical-device performance evidence.

Verified interactions include body picking; keyboard chapter/facet/passage navigation; actual modal Tab containment and Escape focus return; camera control shortcuts; complete comparison and guide loops; original-image inspection; nested browser Back exits; full-reading chapter entry; and camera restoration. The canvas screenshot before and after a full-reading round trip was byte-identical. The built preview additionally verified forward/backward Tab wrapping in the expanded dialog, Escape focus restoration, source-passage focus, one active canvas, and zero page errors. A WebGL call counter recorded **zero additional draws during a settled idle interval**.

Forced WebGL context loss and an aborted GLB request retained the selected chapter and reading, disabled unavailable camera controls, and recovered through an explicit retry. Reduced-motion preference and low-power resolution were exercised. Live touch inspection confirmed vertical scrolling and pointer cancellation without accidental chapter selection.

At 390px, the scene and all four named chapters fit above the initial viewport bottom, and all six camera controls are 44×44 CSS pixels. At 320px, no horizontal page overflow was observed. A doubled-font-size check preserved reflow and reachable controls. Source typography and scene overlays were visually inspected; sampled solid text/background contrast ratios range from 5.55:1 to 12.02:1.

Automated accessibility results and their exact scan scope are in the evidence JSON. No violations were reported in the recorded desktop and mobile scans. Color contrast over graphics and some ARIA checks remain marked incomplete by axe; these scans are not a complete accessibility certification.

Independent reviews caught and verified fixes for long history stacks, nested returns, expanded annotations, source hydration, full-reading entry, modal focus, mobile reverse links, tablet stacking, desktop reading scroll, and GLB chapter identity. No unresolved P1/P2 findings remained in their checked scopes.

## Evidence

- [Desktop whole portrait](artifacts/2026-09-06-portrait-explorer/desktop-whole.png)
- [Two-chapter comparison](artifacts/2026-09-06-portrait-explorer/desktop-comparison.png)
- [Phone exploration](artifacts/2026-09-06-portrait-explorer/mobile-selected.png)
- [Expanded phone scene](artifacts/2026-09-06-portrait-explorer/mobile-expanded.png)
- [Original-image inspection](artifacts/2026-09-06-portrait-explorer/original-image.png)
- [32 model angles](artifacts/2026-09-06-portrait-explorer/model-angle-contact-sheet.png)
- [Browser results](artifacts/2026-09-06-portrait-explorer/browser-evidence.json)
- [Contrast samples](artifacts/2026-09-06-portrait-explorer/contrast-samples.json)

## Main integration scope

The baseline already contains the preceding portrait commits. Relative to main `e3d794de13a40c9f0e7da7d7281c53ae5801f4d9`, integration includes that account portrait foundation as well as this explorer. The inherited account component adds portrait status above the complete reading; creation remains unavailable while the feature flag is absent/off. The new explorer is imported only by the fictional preview, whose dedicated build writes `dist-portrait`; the production Worker build serves `dist`. A main push does not expose the new explorer through the normal account entry.

The production Worker settings were checked before integration and contained no portrait feature bindings. Source guards tolerate missing migration 0026 in disabled mode: maintenance checks table existence and deletion skips absent portrait tables. Runner portrait polling also requires explicit opt-in. No migration or flag change is part of this commit/push operation.

## Remaining release qualifications

The approved account-generation and delivery stage remains separate. It needs an evaluated automated mesh authoring route, authorized private artifact delivery, storage/erasure/download compatibility, and any required contract/migration work. This fixture preview does not enable that production capability.

Physical iOS/Android frame times, GPU/texture memory and repeated-lifecycle memory plateaus, Safari behavior, VoiceOver/NVDA, and formative sessions with representative readers remain unverified. They are required before claiming broad-release readiness. Automated disposal tests and software-rendered browser checks do not substitute for those measurements.

## Aggregate gate history

The aggregate invocation exited **1**, and its original summary is preserved in [ci-local-summary.txt](artifacts/2026-09-06-portrait-explorer/ci-local-summary.txt). It was not relabelled as a green run. The repaired full type-check invocation exited **0**; its output is in [typecheck-repair.txt](artifacts/2026-09-06-portrait-explorer/typecheck-repair.txt). All individual gate lanes have therefore passed, with the type-check lane verified in a separate rerun.

That initial handoff did not include a fresh uninterrupted aggregate after the type-only dependency repair. The subsequent main integration request received the clean full gate recorded below. The local Python was 3.14.4; the gate recorded the workflow's 3.12 pin as a local-environment difference.

[Structured verification](artifacts/2026-09-06-portrait-explorer/verification.json) records the exact boundary. The [source fingerprint](artifacts/2026-09-06-portrait-explorer/source-fingerprint.json) identifies all 27 source/asset files independently of the uncommitted branch's baseline SHA.


## Fresh main integration gate

`npm run ci:local -- --clean` completed with exit **0**, **14/14 lanes passed**, after a full clean install from the unchanged lockfile. The exact [paste-ready summary](artifacts/2026-09-06-portrait-explorer/main-ci-local-summary.txt) is preserved separately from the earlier failed invocation. The summary's baseline SHA is `82d5dd9`: the invocation also tested the uncommitted explorer implementation identified by all 27 matching source/asset fingerprints. Only this documentation and its evidence records changed during the run.

The six deterministic fixture tests and dedicated portrait production build also passed again. A fresh built-preview browser smoke verified modal Tab wrapping, Escape focus restoration, the exact source paragraph link, one active canvas, and zero page errors. See [fresh browser result](artifacts/2026-09-06-portrait-explorer/main-browser-smoke.json) and [structured main verification](artifacts/2026-09-06-portrait-explorer/main-integration-verification.json).

The user requested a direct commit and push to main. This record supplies the pre-push gate evidence; the resulting commit and verified remote SHA are reported after push. A main push triggers the configured Cloudflare production build. Migration 0026, account generation enablement, and deployment of the separate explorer preview are outside this commit/push operation.
