---
name: Pattern portrait preview
description: A spatial chapter reader within Pattern/Like's Private Observatory.
colors:
  paper: "#f2efe6"
  paper-light: "#faf8f2"
  paper-deep: "#e5dfd1"
  ink: "#17312a"
  ink-soft: "#4e625b"
  forest: "#173f35"
  forest-light: "#dce7df"
  coral: "#c76043"
  coral-ink: "#a84528"
  line: "#cec7b8"
  line-dark: "#9fa89f"
  focus: "#234c9f"
typography:
  headline:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "clamp(31px, 3.1vw, 45px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  reading-lead:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  reading-body:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  square: "0px"
---

# Design System: Pattern portrait preview

## Overview

**Creative North Star: “The Private Observatory”**

The local portrait preview extends the [app design authority](../../DESIGN.md) and its [product commitments](../../PRODUCT.md). Warm paper, green ink, lightly weighted serif prose, fine rules, and square controls frame one dimensional sculpture and its complete chapter reading. This preview does not replace the app identity or shell.

Four generated images, each showing one familiar object grounded in its own complete fictional chapter, are the content inputs to one unified form. Their visible contours determine geometry through a consistent modeling method. The four source images remain visible in chapter navigation so people can recognize the inputs and reach their readings. The fused result is an abstract interpretation; it does not promise four independently recognizable objects or recovered hidden surfaces.

The [original portrait direction](../../../../docs/superpowers/specs/2026-09-05-pattern-portrait-design.md) established the reading and interaction shell. The approved [four-image direction](../../../../docs/superpowers/specs/2026-09-05-pattern-object-direction.md) supersedes the earlier shared bands and single-door study. The [delivery handoff](../../../../docs/superpowers/2026-09-05-pattern-portrait-handoff.md) owns current verification and delivery claims.

Sources: [preview entry](../../pattern-portrait.html), [composition](pattern-portrait-preview.tsx), [preview styles](pattern-portrait-preview.css), [portrait component](../components/PatternPortrait.tsx), [portrait styles](../components/pattern-portrait.css), [sculpture renderer](../components/PatternSculpture.tsx), [pixel-based geometry](../lib/image-sculpture.ts), [image loader](../lib/portrait-images.ts), [frozen image bindings](image-study.ts), and [generated references](references/).

## Colors

Paper is the page field; lighter and deeper paper support controls and hover states. Ink carries headings and prose, with softer ink for instructions and uncertainty. Forest fills primary actions and the active presentation control. Pale forest marks the selected chapter row; fine graphite rules divide the composition. Focus cobalt remains reserved for keyboard focus.

The sculpture’s base material color comes from the input images. Coral provides restrained emphasis for the selected image’s attributed region, and the selected chapter number uses the darker coral text token. Selection does not replace or remove geometry. These colors communicate interaction, with no implied strength, personality score, or relationship scale. Source thumbnails retain their generated appearance.

## Typography

The inherited Iowan/Palatino/Georgia serif stack carries the headline, chapter names, summaries, and reading. Avenir Next/Segoe UI/Helvetica/Arial carries controls, instructions, accuracy, and scenario fields. No new font is loaded.

The introduction uses a fluid title (`45px`–`74px`, weight `400`, line height `0.99`). Chapter headings and reading roles use the tokens above; prose has a maximum measure of `68ch`. Chapter-index titles are `18px`, while most operational text is `12px`–`14px`. At widths up to `440px`, chapter-index titles become `17px` and selected-reader summaries become `23px`.

The object rationale uses the inherited serif at `15px` with `1.5` line height; its object name uses weight `600`. The underlined View the whole sculpture control uses the operational sans-serif at `12px` with a `44px` minimum target height. These roles preserve the separation between explanatory prose and controls; the broader app type ramp remains governed by the app design authority.

## Layout

The preview centers within `1280px`, with `52px` horizontal padding. Its ruled header precedes the introduction, presentation controls, accuracy, and reading surface. Desktop gives the scene/index and reader columns a `1.22:1` ratio. A vertical rule separates them; the reader has a `42px` left inset. The scene height is `clamp(350px, 38vw, 500px)`.

Each chapter row includes its ordinal, generated object image, published chapter title, and selection marker. Thumbnails use `object-fit: contain` in a `64px` by `76px` box so their full silhouettes remain visible. They are evidence for the sculpture’s inputs and part of chapter navigation, not a second gallery or decorative collage.

At `850px` and below, the introduction and portrait become one column, gutters shrink to `28px`, and the `370px` scene precedes controls, chapter index, and reader. At `440px` and below, gutters become `20px`, the scene becomes `310px`, the toolbar stacks, and reference boxes become `48px` by `66px`. Selection reveals and focuses the reader on stacked layouts; returning to the whole reveals and focuses the scene. Desktop also reveals the destination if it is outside the viewport. The complete reading and additional signatures use a centered `760px` maximum width.

## Elevation & Depth

The interface remains flat, divided by one-pixel rules and quiet state fills. The inherited faint drafting grid continues beneath it. Spatial depth belongs to the unified sculpture: directional, hemisphere, and ambient light describe its contours against a transparent canvas. There is no UI shadow stack, decorative chapter network, photographic plane standing in for a mesh, or idle spinning animation.

## Shapes and meaning

Controls and fields are square. The sculpture is one connected dimensional surface synthesized from four decoded images through the same contour method. There is no subject-specific door constructor, shared band fallback, or arrangement of four independent object meshes in the current modeling contract. Selection leaves the whole form visible and changes framing and visual emphasis only.

The source images show a door, notebook, metronome, and lantern. Their names and metaphor rationales belong to image generation and the reading interface. They must not enter geometry construction. The four images are different subjects, not multiview observations of one object; their fused surface is an abstract interpretation rather than recovered 3D geometry. The implementation’s technical limits and validation belong in the handoff.

**The Reading Authority Rule.** A source object may express a proposed metaphor grounded in its own complete published chapter. The complete reading supplies meaning and uncertainty. Shape, size, placement, proximity, and color must not become personality scores, birth-data claims, or inferred relationships between chapters.

## Components and behavior

- **Presentation and chapter navigation:** The default shows the whole sculpture with an introductory reader. Native buttons switch between 3D and complete Reading view using `aria-pressed`. Selecting a surface region, chapter image row, or first-chapter action opens that chapter and resets its expression to Overview. The selected row gains pale green fill, a coral number, and a changed end marker. Next chapter wraps through the document; Back to the whole clears selection.
- **Reader:** The title and summary remain visible while Overview, Tensions, Resources, and Another expression switch the associated prose. Reading view renders all of those sections for every chapter. Accuracy and any supplied uncertainty remain above both presentations; additional signatures remain below them. A polite live region announces selection and expression changes.
- **Chapter object note:** A fine rule above and below separates the source image’s object name and brief rationale from the published summary and expression controls. View the whole sculpture reveals and focuses the stage while preserving the selected chapter and current expression. It is disabled until graphics and images are ready. This note explains the source metaphor without rewriting any published chapter text.
- **Sculpture controls:** Drag turns the sculpture. Rotate left/right, zoom in/out, and Reset view provide native button alternatives; controls are disabled until graphics and the image-derived model are ready. Zoom is bounded and uses explicit controls, while vertical touch scrolling remains available. Reset also clears the selected chapter. Camera framing eases toward selection, with rendering only on demand. Reduced motion makes camera and selection-scroll transitions immediate; inherited CSS suppresses smooth scrolling and prolonged transitions.
- **Input attribution:** Neutral image indices associate surface regions with source images and reader chapters. Emphasis and camera orientation help inspect a contribution without separating the sculpture into objects. Attribution is a navigation convention, not a claim that a region reconstructs its source object exactly.
- **Focus and targets:** Interactive elements inherit a two-pixel cobalt focus outline with a three-pixel offset. Controls are at least `44px` high, primary reading actions `48px`, and chapter rows `62px`. A skip link reaches the main content; native chapter buttons provide keyboard access independently of the canvas. Reference images have descriptive alternative text.
- **Loading and fallback:** Image loading and graphics initialization leave chapter buttons and the reader available. A missing, invalid, blank, failed, or stale image prevents construction of the four-image sculpture and produces a status message. Unavailable WebGL, initialization/render errors, and context loss likewise preserve the reading. No failure substitutes a stock model. Loading document data has its own text state; unavailable or empty documents remove the previous portrait and reading. A document revision change remounts the ready surface, clearing selection and renderer state.
- **Preview scenarios:** A collapsed disclosure contains native controls for exact/approximate/unknown accuracy, loading/removal, and replacement/restoration of the fictional sample. These controls and the fictional-content notice belong to the preview.

## Data and modeling boundary

Future production integration begins at [`PatternPortrait`’s `source` prop](../components/PatternPortrait.tsx): supply an authorized published `PatternResponseV7`, or an explicit loading/unavailable state. The [local manifest](../lib/pattern-portrait.ts) projects reader-visible content only. Its revision uses schema version, Pattern ID, and generation time; chapter identity is document-local ordinal.

The optional `objectBindings` prop supplies the generated image references. The [preview binding](image-study.ts) freezes the exact document revision, chapter ID, complete source-text snapshot, reference ID, and image hash for every chapter. An image attaches only when revision, chapter ID, and every source-text field match, including title, summary, all sections, tensions, resources, and counter-expression. Keep these snapshots independent of the live fixture. A replaced document or changed chapter cannot silently reuse a stale reference.

Only four image locations cross from the reader into the loader. The modeling function receives exactly four decoded pixel buffers with width, height, and RGBA data. It receives no chapter text, subject label, rationale, document ID, hash seed, or template selector. Changing source pixels must influence actual geometry; changing reader metadata while preserving valid pixels must leave geometry unchanged. The [provenance receipt](references/provenance.json) records the generated originals and metadata-stripped modeling copies outside this shape API.

The [separate Vite entry](../../vite.portrait.config.ts) uses fictional data and bundled generated images without authentication, account storage, API/model calls, or service-worker registration. The local contour model is computed from these images. Automatic per-user subject choice and image generation, authenticated asset storage, persisted model delivery, publication, consent, deletion/invalidation wiring, production routing, and deployment remain separate work. The handoff records current evidence rather than inferring production readiness from the preview.

## Do’s and Don’ts

- **Do** preserve complete reading content, published order, accuracy, and uncertainty in every presentation and graphics fallback.
- **Do** keep all four recognizable source images visible in chapter navigation and the native index usable without canvas manipulation.
- **Do** retain one unified sculpture during selection, with visual emphasis that leaves its geometry unchanged.
- **Do** keep complete chapter text in its own image prompt and outside the modeling API; preserve exact source/reference binding upstream.
- **Do** describe the result as an image-derived abstract sculpture and distinguish existing generated assets from an automatic production pipeline.
- **Don’t** replace pixel-derived geometry with named object constructors, stock shapes, image planes, or hash-driven variation.
- **Don’t** derive geometry or relationships from private evidence, birth data, scores, chapter labels, or timing information, or present a metaphor as a new factual claim.
- **Don’t** promote fictional chapters, preview scenario controls, historical door/band milestones, or this preview’s composition into production product truth or a replacement brand system.
