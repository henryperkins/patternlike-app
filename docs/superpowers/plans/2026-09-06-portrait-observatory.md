# Portrait observatory implementation plan

Goal: replace the empty display floor with a substantial, operable architectural scene around the existing chapter models.

Spec: [portrait observatory](../specs/2026-09-06-portrait-observatory-design.md). Execution is in this session; the work remains local on `codex/portrait-observatory`.

- [x] Add `observatory-world.ts` for authored architecture, four moving stations, reading-desk hinges, lighting, camera destinations, and deterministic transition updates. Test actual geometry and camera behavior beside it.
- [x] Integrate the world into `PortraitScene.tsx` through an optional typed experience prop, retaining loader validation, existing studio compatibility, bookmarks, demand rendering, reduced motion, and cleanup.
- [x] Add `ObservatoryControls.tsx` and `observatory.css`; retain source-backed reading, comparison, guide, image inspection, and responsive navigation. Cover per-chapter controls and failure behavior in `PortraitExplorer.test.tsx`.
- [x] Inspect desktop and phone in Chromium, exercise the new physical actions plus reading navigation, batch corrections, and obtain an independent finish review.
- [x] Run focused tests and `npm run ci:local` on final code. Record evidence and the actual limitations here; leave commit/push/deploy distinct.

## Verification record

- Focused final explorer suite: 8 files, 90 tests passed. Includes a failing-then-passing regression for alignment during every rendered unfolding frame; visible-architecture occlusion; real GLB loading, desk geometry, artifact-wrapper rotation, source-node preservation, idle rendering, and resource release.
- Preview production build passed. Vite reports the existing large shared Three.js/OrbitControls chunk; there is no new dependency or shipped raster asset.
- Chromium with software WebGL, local `http://127.0.0.1:5174/pattern-portrait.html`, desktop 1440×900 and phone 390×844. Browser plugin was absent; the Playwright CLI used the already-installed Chromium executable.
- Browser flow assertions: page identity/content, opening a desk, inspection, published Resources, two-chapter comparison, guide start/advance, all four chapters in full reading, no horizontal phone overflow, phone reading mode and preserved perspective, expanded-scene exit and Escape. Zero console errors on the clean page load.
- After occlusion correction, the overview exposes one scene label with the roof present and three with cutaway; all four native chapter controls remain available. Five recaptures were inspected. Independent verdict scored the five listed corrections resolved, with `ship` applying to that correction list.
- Local evidence: `/tmp/observatory-desktop.png`, `/tmp/observatory-chapter.png`, `/tmp/observatory-dusk.png`, `/tmp/observatory-mobile.png`, `/tmp/observatory-mobile-chapter.png`. These are temporary browser captures, not committed source assets.
- Coverage limits: browser exercise uses the fictional preview. Account integration and graphics-failure behavior have regression coverage; live authenticated production flow and performance on physical phones were not exercised. The scene is stylized WebGL with orbit/destination navigation; no native Blender/Unreal project or first-person collision is delivered.
- The independent documenter added the component's `DESIGN.md` and matching `.impeccable/design.json`, and verified parsing, token references, local links, narrative parity, and snippets. The pre-existing root `.impeccable/` work was left untouched.

## Aggregate gate before the hook follow-up

`npm run ci:local` completed on 2026-09-06 with exit 0 and all 14 lanes passing against the observatory implementation before the CSS adjustment recorded below. The main API suite passed 140 files / 2,482 tests; the web suite passed 48 files / 610 tests. The API runtime emitted `EnvironmentTeardownError` messages during worker teardown, but both API suites and the complete gate exited successfully. Full log: `/tmp/observatory-ci-final.log`.

The commit below identifies the base of the tested, uncommitted working tree. This work has not been committed, pushed, or deployed. Python differs from the GitHub workflow pin, as the gate explicitly reports.

```text
commit  cefc979 on codex/portrait-observatory
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

## Design-hook follow-up

The `side-tab` finding at `explorer.css:101` was a decorative stripe on the uncertainty paragraph. Replaced the 3px colored left border with the inherited 1px neutral top rule and aligned its padding with the reading text. Source uncertainty text and rendering conditions are unchanged. No suppressions were added; no reported findings remain standing.

The hook rescanned the file without deterministic findings. Fresh web verification passed all 48 files / 610 tests, and `npm run build:portrait --workspace @patternlike/web` passed. Chromium checks at 1440px and 390px confirmed the complete uncertainty text, a 0px left border and 1px top rule, all four reading chapters, and no horizontal overflow in both reading and exploration views. Captures: `/tmp/observatory-uncertainty-desktop.png` and `/tmp/observatory-uncertainty-mobile.png`. The full aggregate gate above predates this CSS-only follow-up and was not rerun for it.

Technical references checked for rendering behavior: [Three.js directional lighting](https://threejs.org/docs/pages/DirectionalLight.html) and the installed Three.js 0.185 source. Existing validated asset loading, complete reading, and saved-source identity remain the integration boundaries.
