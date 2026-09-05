# Pattern portrait: first milestone

> Historical first-milestone record. The current implementation supersedes shared bands and the door-only study; see `2026-09-05-image-only-sculpture.md` in the plans directory and the current portrait handoff.
Status: approved concept, implemented as a local fictional preview and reusable web component. Production integration, timing relationships, and publication are separate work.

## Purpose

Make a published Pattern easier to explore and remember through a stable, rotatable sculpture. The first milestone uses four clearly fictional chapters. Selecting a form opens its existing summary, prose, tensions, resources, and counter-expression. Geometry organizes reading; it does not measure personality or infer relationships.

## Scope and boundaries

- A reusable `PatternPortrait` takes a published `PatternResponseV7` or explicit loading/unavailable state. It makes no API/model calls and stores no personal data.
- A pure local manifest copies only reader-visible content. Chapter identity is scoped to the published document and ordinal; replacing the document resets selection and renderer state. No private evidence or new wire contract is exposed.
- The default scene consists of equal-scale sculpted bands. Color signals selection only. Placement is editorial and deterministic for chapter count, never a score or claimed relationship.
- Desktop pointer and mobile touch rotation, explicit rotation/zoom/reset controls, native chapter-selection buttons, and a reading-only view expose the same content.
- Selection moves the camera gently; reduced-motion requests make transitions immediate. Rendering stops while idle. A renderer failure or unavailable WebGL keeps reading usable.
- Accuracy and published uncertainty remain visible. No houses, angles, time-sensitive facts, or timing links are created by this renderer.
- A separate Vite HTML entry provides the fictional preview without authentication, service workers, API calls, or additions to the production entry. Preview controls demonstrate accuracy, replacement, loading, removal, and restoration.
- All production API, provider, authentication, publication, frozen contracts, and consent semantics are unchanged.

## Visual direction

Extend Pattern/Like's existing Private Observatory: drafting paper, ink green, lightly weighted serif reading, square controls, thin rules. The sculpture is the main spatial artifact; readable prose is its companion. Desktop places them alongside each other; mobile stacks them. No stars, scores, fabricated chart data, or decorative network edges.

## Verification

Test projection preservation and exclusion, deterministic layout, replacement/removal, chapter facets, keyboard navigation, uncertainty, and rendering failure. Inspect the real WebGL scene at desktop and mobile widths, exercise selection and camera controls, verify no network requests for personal data, and check reduced motion and WebGL failure. Run the full local CI gate on Node 22 with a real worktree-local Python environment. Record browser screenshots and any limits. Do not merge, push, or deploy as part of this milestone.
