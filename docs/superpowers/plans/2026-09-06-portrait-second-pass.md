# Portrait Second Pass Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Preserve reading choices on return, repair focus transitions, and integrate the explorer with the account layout.

**Architecture:** Keep snapshot restoration for comparison, guidance, and images; presentation-only returns retain current chapter choices. Let the account own an in-memory navigation controller throughout open/close so browser history has a real account boundary. Add an embedded presentation using the existing account tokens and container width, while preserving the standalone preview.

**Tech Stack:** React, TypeScript, Vitest, CSS container queries, Playwright/Chromium.

**Spec:** `docs/superpowers/specs/2026-09-06-pattern-portrait-experience-redesign.md`; approved second-pass findings for reading, focus, and account embedding.

## Global Constraints

- Preserve every source chapter field, uncertainty, signatures, and source identity.
- Image inspection, comparison, and guidance restore their originating context.
- Pointer selection must not unexpectedly steal focus.
- Keep the current first-pass changes and unrelated `.impeccable/` work.
- Commit and push the verified changes to `main` as subsequently authorized. No manual deployment or migration is included.

### Task 1: Reading and account navigation

**Files:** `explorer-state.ts`, `use-explorer-navigation.ts`, their tests, and `AccountPortraitExplorer.tsx` / `.test.tsx` under `apps/web/src/components/` (explorer files in `portrait-explorer/`).

**Interface:** `ExplorerNavigation` exposes `state`, `dispatch(action | actions)`, `isOpen`, `open()`, and `close()`. The account retains the controller while the renderer is closed; standalone exploration initializes an active controller.

- [x] Add and run failing regressions for presentation return and native Back/Forward at the account boundary.

```ts
const result = act(origin, { type: "presentation", presentation: "reading" },
  { type: "select", chapterId: "chapter-4" }, { type: "facet", facet: "resources" }, { type: "back" });
expect(selectedChapterIds(result)).toEqual(["chapter-4"]);
expect(currentFacet(result)).toBe("resources");
```

- [x] Implement presentation return as `{ ...previous, view: state.view, facets: state.facets, passages: state.passages, unfolded: state.unfolded }` only when the popped snapshot changes presentation without closing an image. Keep semantic undo unchanged.
- [x] Store opaque scoped indices and entry depths in browser history. Push an account entry on explicit open; `close()` traverses `-(depth + 1)` to the original account entry. Native Back updates the in-memory target through the same reducer; Forward reopens retained state. Preserve other history fields and keep all reading content out of history.
- [x] Run focused state, controller, and account tests.

### Task 2: Reading position and keyboard focus

**Files:** `PortraitExplorer.tsx`, `ExplorerReader.tsx`, and `PortraitExplorer.test.tsx`.

**Interface:** `PortraitExplorer` optionally accepts the account's `navigation` controller. Reader headings expose `data-reader-heading` independently of heading level.

- [x] Add failing tests for Next chapter focus/scroll, comparison entry/exit, introductory selection, and retained choices after native Back.

```ts
await user.click(screen.getByRole("button", { name: /^Next chapter/ }));
expect(document.activeElement).toHaveTextContent(nativePattern.core_chapters[1].title);
expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts).toContain(document.activeElement);
```

- [x] Track explicit focus destinations for controls replaced by transitions; focus comparison controls on entry/exit and headings on chapter advancement. Retain existing scroll restoration and avoid moving focus for ordinary pointer selections.
- [x] Run focused component tests, including complete source text and image restoration.

### Task 3: Embedded layout and verification

**Files:** `PortraitExplorer.tsx`, `ExplorerReader.tsx`, `AccountPortraitExplorer.tsx`, `explorer.css`, and corresponding component tests.

- [x] Add failing assertions that embedded exploration is a named section inside the existing main, has no extra h1, offers a local exit, and retains complete reading.
- [x] Render `const Root = navigation ? "section" : "main"`, with an account toolbar and h2 title for the embedded section. Shift embedded chapter/facet headings consistently. Use `button--primary` on the account entry.
- [x] Map embedded explorer variables to `--ink`, `--ink-soft`, `--line`, and `--paper`; remove duplicate masthead/footer, nested gutters, rounded controls, and shadows. Use a named inline-size container, stack below 860px, and keep return controls sticky. Use a three-column camera toolbar below 320px of available space.
- [x] Give expanded dialogs a fixed available-height flex layout with a labeled close button and chapter rail outside the flexible scene. Add a light focus ring on dark controls and a forced-colors selection outline.
- [x] Verify desktop, phone, 320px phone, landscape, browser Back/Forward, keyboard comparison, forced colors, and complete reading using local fictional fixtures. Capture screenshots.
- [x] Obtain a bounded code review, resolve findings, freeze final source, and run `npm run ci:local`. Record all 14 lane results and the final exit code.

Review additions: retain browser entries beyond 30 reducer snapshots; serialize rapid Return then account close; preserve pointer focus on chapter rail; offer cancellation during stalled or failed asset hydration. The standalone expanded fallback also uses the available dialog height.

Final verification: all 14 local CI lanes passed on isolated base `875c09b`, with the approved portrait files unchanged and matching the shared checkout. See [the review and evidence](../../reviews/2026-09-06-portrait-second-pass.md).
