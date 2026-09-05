# Pattern Portrait Implementation Plan

> Historical first-milestone record. The current implementation supersedes shared bands and the door-only study; see `2026-09-05-image-only-sculpture.md` in the plans directory and the current portrait handoff.
> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a local, fictional four-chapter interactive 3D Pattern and a reusable, privacy-preserving reader component.

**Architecture:** Project the existing public Pattern response into a local presentation manifest. Keep reading and navigation in React; lazily render procedural geometry through React Three Fiber. A separate preview entry supplies fictional data and lifecycle scenarios without reaching production services.

**Tech Stack:** React 19, TypeScript, Three.js, React Three Fiber, Vite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-pattern-portrait-design.md`

## Global constraints

- Node 22; strict TypeScript, ES modules, double quotes, two-space indentation.
- No API/model calls, private evidence, persistence, scoring, inferred relationships, or production route changes.
- Preserve source prose and accuracy; all preview content is explicitly fictional.
- Keep the existing reading usable when graphics fail or are disabled.
- Preserve the unrelated main-checkout changes; work on `codex/pattern-portrait`.

## Task 1: Public-content projection and fictional fixture

**Files:** `apps/web/src/lib/pattern-portrait.ts`, its adjacent test, `apps/web/src/preview/pattern-portrait-fixture.ts`.

**Interfaces:** `createPortraitManifest(document: PatternResponseV7): PortraitManifest`; chapters contain `id`, `ordinal`, `title`, `summary`, `sections`, `tensions`, `resources`, `counterExpression`. Manifest contains `revision`, `accuracy`, `uncertainty`, `chapters`, and `signatures`. Scene layout depends on chapter ordinal/count only.

- [x] Write regression tests asserting exact public prose, deterministic identity, no copied private fields, and new revision on replacement.
- [x] Run the focused test and confirm missing implementation fails.
- [x] Implement the explicit projection and four substantive fictional chapters with no invented calculation evidence.
- [x] Run the focused test until those behaviors pass.

## Task 2: Reading and lifecycle shell

**Files:** `apps/web/src/components/PatternPortrait.tsx`, `PatternPortrait.test.tsx`, `pattern-portrait.css`.

**Interface:** `PatternPortrait({ source }: { source: { status: "ready"; document: PatternResponseV7 } | { status: "loading" } | { status: "unavailable" } })`.

- [x] Test keyboard chapter/facet selection, complete reading mode, uncertainty, replacement reset, removal, loading, and renderer failure.
- [x] Run the focused test and confirm expected missing-component failure.
- [x] Implement native controls and readable content; key the ready component by manifest revision and isolate graphics behind Suspense and an error boundary.
- [x] Apply existing paper/ink/serif styles; stack at narrow widths and preserve visible focus.
- [x] Verify focused tests and typecheck.

## Task 3: Real 3D sculpture and preview

**Files:** `apps/web/src/components/PatternSculpture.tsx`, `apps/web/src/lib/portrait-geometry.ts`, its adjacent test, `apps/web/pattern-portrait.html`, `apps/web/src/preview/pattern-portrait-preview.tsx`, preview CSS, `apps/web/package.json`, root lockfile.

**Interface:** graphics receives the manifest, selected chapter id, selection callback, reduced-motion flag, and camera action. Geometry is procedural, deterministic, and disposable.

- [x] Add pinned Three.js / Fiber dependencies compatible with React 19.
- [x] Test finite bounded geometry and stable layouts for three to six chapters.
- [x] Implement solid sculpted bands, raycast selection, constrained orbit, native camera actions, demand rendering, and reduced-motion camera settling.
- [x] Add an explicit fictional preview and separately labeled accuracy/lifecycle controls.
- [x] Run web tests and build; ensure the default production build does not include the preview.

## Task 4: Browser verification and delivery

- [x] Open the preview; exercise pointer selection, rotation, zoom, reset, chapter facets, reading mode, and replacement/removal.
- [x] Inspect desktop/mobile screenshots, check keyboard/contrast/overflow, exercise touch and reduced motion, and verify graphics failure retains reading.
- [x] Fix the material issues from one batched inspection and confirm once.
- [x] Obtain the Impeccable finish review using screenshots and the approved direction; record the outcome at its scope.
- [x] Run `npm run ci:local` and retain the aggregate summary and exit status.
- [x] Document run command, preview URL, evidence, and remaining production integration in the handoff. Keep this work local.
