---
version: alpha
name: Pattern/Like
description: Quiet, exacting, humane interfaces for private, inspectable psychological timing.
colors:
  primary: "#173f35"
  primary-deep: "#0f3028"
  primary-soft: "#dce7df"
  accent: "#c76043"
  accent-soft: "#e59a7f"
  focus: "#234c9f"
  surface: "#f2efe6"
  surface-light: "#faf8f2"
  surface-deep: "#e5dfd1"
  surface-evidence: "#e8e3d8"
  panel-surface: "rgba(250, 248, 242, 0.72)"
  on-surface: "#17312a"
  on-surface-soft: "#4e625b"
  on-surface-faint: "#7a8781"
  outline: "#cec7b8"
  outline-strong: "#9fa89f"
  on-primary: "#fffdf6"
  on-dark: "#f5f0e4"
typography:
  display-lg:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "78px"
    fontWeight: 400
    lineHeight: 0.96
    letterSpacing: "-0.055em"
  display-sm:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 0.96
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "27px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
  reading-lead:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  body-serif:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.62
  label-caps:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.15em"
  control:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "0.035em"
  evidence:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "9px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.08em"
rounded:
  square: "0px"
  subtle: "2px"
  full: "999px"
spacing:
  micro: "5px"
  xs: "8px"
  sm: "12px"
  field: "14px"
  md: "18px"
  control: "20px"
  gutter: "24px"
  panel: "30px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "50px"
  button-secondary-hover:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "50px"
  field:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0 14px"
    height: "49px"
  panel:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.square}"
    padding: "30px"
  metadata-chip:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface-soft}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.square}"
    padding: "6px 11px"
  nav-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.subtle}"
    padding: "0 12px"
    height: "48px"
  selector-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.square}"
    padding: "18px"
    height: "74px"
---

# Design System: Pattern/Like

## Overview

**Creative North Star: "The Private Observatory"**

Pattern/Like feels like a calm reading room joined to a precise observational instrument. Warm drafting paper, fine rules, an almost imperceptible grid, and ink-green type create privacy and permanence; the orbital mark and technical annotations make calculation visible without turning the product into cosmic spectacle.

The system is quiet, exacting, and humane. Spacious editorial composition gives interpretation room to breathe, while square controls, monospaced evidence, and explicit states keep every action accountable. Expression comes from typographic scale and disciplined contrast rather than decoration, gloss, or novelty.

**Key Characteristics:**

- Warm paper fields with fine structural rules and no decorative shadow stack.
- Large, lightly weighted serif headlines paired with compact sans-serif controls.
- Monospaced labels and evidence reserved for calculation, provenance, and status.
- Observatory Green carries authority; Signal Coral marks consequential change.
- Square, deliberate, restrained components with circles reserved for true indicators.

## Colors

The palette reads as ink and annotation on drafting paper: Observatory Green establishes authority, Signal Coral records change, and Focus Cobalt appears only when interaction requires unmistakable focus.

### Primary

- **Observatory Green** (`primary`): primary actions, the strongest dark surfaces, active navigation text, and the product mark.
- **Deep Observatory Green** (`primary-deep`): the primary-button hover state, used only to deepen an existing action.
- **Washed Observatory Green** (`primary-soft`): selected navigation, selected options, and other quiet active-state fills.

### Secondary

- **Signal Coral** (`accent`): eyebrows, active-edge markers, revision states, destructive controls, and sparse points of consequence.
- **Soft Signal Coral** (`accent-soft`): annotation on dark Observatory Green surfaces where the main accent would lose warmth.

### Tertiary

- **Focus Cobalt** (`focus`): keyboard focus rings only. It is functional accessibility infrastructure, not a decorative brand accent.

### Neutral

- **Drafting Paper** (`surface`): the default page field and the base of the faint instrument grid.
- **Clean Drafting Paper** (`surface-light`): forms and clearer reading surfaces.
- **Layered Drafting Paper** (`surface-deep`): progress tracks and quiet tonal separation.
- **Evidence Paper** (`surface-evidence`): expandable technical evidence regions.
- **Vellum Panel** (`panel-surface`): translucent bordered panels that preserve the page field beneath them.
- **Ink Green** (`on-surface`): primary copy and headings.
- **Soft Ink Green** (`on-surface-soft`): supporting prose and control text.
- **Faint Ink Green** (`on-surface-faint`): metadata, helper text, and de-emphasized states.
- **Graphite Rule** (`outline`) and **Strong Graphite Rule** (`outline-strong`): dividers, container borders, and hover reinforcement.
- **Button Paper** (`on-primary`) and **Dark-Surface Paper** (`on-dark`): text on Observatory Green.

### Named Rules

**The Signal, Not Decoration Rule.** Signal Coral marks a state, boundary, revision, or consequential action; it does not become a large ambient fill.

**The Paper Before White Rule.** Build hierarchy with warm paper tones and transparency. Pure white is not the default canvas.

**The Focus Is Functional Rule.** Focus Cobalt exists to make keyboard location unmistakable and must not compete as a second decorative accent.

## Typography

**Display Font:** Iowan Old Style, falling back through Palatino and Georgia.

**Body Font:** Avenir Next, falling back through Segoe UI, Helvetica, and Arial.

**Label/Mono Font:** SFMono-Regular, falling back through Consolas and Liberation Mono.

**Character:** The serif carries interpretation, dignity, and reflective pace. The sans-serif makes controls and operational copy immediate. The monospaced voice exposes evidence, status, versioning, and technical identity without leaking into narrative prose.

### Hierarchy

- **Display** (400, fluid `42px` to `78px`, `0.96` line height): page-defining statements and major dates; keep the weight light and the tracking tight.
- **Headline** (500, `27px`, `1.1` line height): panel and section titles.
- **Title** (600, `17px`, `1.5` line height): evidence summaries, source rows, and compact editorial headings.
- **Reading Lead** (400, up to `26px`, `1.42` line height): the primary interpretive paragraph in a daily chapter.
- **Body** (400, generally `13px` to `15px`, `1.5` to `1.65` line height): controls, helper copy, and secondary explanation.
- **Body Serif** (400, generally `17px`, `1.62` line height): reflective or explanatory prose that deserves a slower reading pace.
- **Label** (750-800, `8px` to `10px`, generous tracking, uppercase): eyebrows, field labels, chips, and compact state names.
- **Evidence** (500, `8px` to `10px`, monospaced): identifiers, contract versions, evidence lanes, and reproducibility details.

### Named Rules

**The Three Voices Rule.** Serif explains meaning, sans-serif operates the product, and mono proves what happened. Do not swap their jobs for variety.

**The Quiet Scale Rule.** Display type may be large, but it stays lightly weighted and tightly tracked; hierarchy comes from measure and spacing rather than heavy boldness.

## Layout

The desktop shell uses a fixed left rail (`252px`, narrowing to `222px` below `1180px`) and a fluid main area. Primary pages center within a wide maximum measure (`1540px`) with fluid horizontal gutters and generous vertical closure. Fine one-pixel divisions align navigation, headers, anchor strips, evidence grids, and data rows into one observational frame.

Spacing follows a repeated practical rhythm led by `8px`, `12px`, `18px`, `24px`, `30px`, and `48px`. Dense metadata sits close; related controls use medium gaps; page sections and headers receive the largest separation. Panels typically use `20px` to `34px` of internal space depending on information density.

At `1180px`, complex chart and onboarding columns stack before their contents become illegible. At `960px`, the desktop rail becomes a fixed `68px` mobile header plus a `70px` bottom navigation that respects safe-area insets. At `700px`, multi-column content, anchor strips, evidence grids, and form rows collapse to one column; outer page gutters reduce to `18px`. At `420px`, compact navigation and controls tighten without losing their square silhouette or tap area.

### Named Rules

**The Instrument Grid Rule.** Align content to shared rules, gutters, and baselines so every surface feels observed within the same apparatus.

**The Collapse by Comprehension Rule.** Stack a complex region before labels, charts, or controls become too small to understand; never preserve columns merely to preserve a desktop composition.

## Elevation & Depth

The system is flat and structural. It does not use drop shadows for cards, menus, or controls. Depth comes from warm tonal layers, translucent paper surfaces, dark feature fields, and one-pixel borders. The only shadow-like treatment is a small status halo; it communicates state rather than physical elevation.

### Named Rules

**The Flat and Structural Rule.** A surface earns hierarchy through tone, rule, and placement—not through a floating shadow.

## Shapes

Rectangular controls, fields, panels, chips, drawers, and data regions are square (`0px`). Desktop navigation permits only a nearly imperceptible corner (`2px`) so the active field reads as selected rather than pill-shaped. Circles are reserved for orbital marks, radio indicators, status dots, and spinners—elements whose meaning depends on a point, cycle, or continuous state.

Borders are visible but quiet: one-pixel Graphite Rules define most containers, while Strong Graphite Rules mark hover or editable boundaries. Large solid silhouettes use Observatory Green rather than rounded cards or clipping effects.

### Named Rules

**The Meaning Earns the Circle Rule.** Use a circle only for an indicator, orbit, point, or continuous action; never round a rectangular component merely to make it friendlier.

## Components

Components are square, deliberate, and restrained. Each one states its role through tone, border, type voice, and state feedback rather than ornament.

### Buttons

- **Shape:** square (`0px`) with a `50px` minimum height and `20px` horizontal padding.
- **Primary:** Observatory Green with Button Paper text; hover deepens to Deep Observatory Green.
- **Secondary:** transparent with Observatory Green text and a Strong Graphite Rule; hover adds Washed Observatory Green.
- **Danger:** transparent with Signal Coral text and a half-strength coral rule; it is not filled by default.
- **Interaction:** state transitions use `160ms ease`; press translates down `1px`; disabled controls use `0.48` opacity and a forbidden cursor.
- **Focus:** a `2px` Focus Cobalt outline with a `3px` offset remains visible around every button.

### Chips

- **Style:** square, transparent metadata containers with a one-pixel Graphite Rule and compact uppercase sans-serif text.
- **Spacing:** `6px 11px`; chips wrap rather than truncate.
- **State:** revision or consequential state changes the border and text to Signal Coral. Locale and code-like values switch to the monospaced evidence voice.

### Cards / Containers

- **Corner Style:** square (`0px`).
- **Background:** Vellum Panel for standard containers; Observatory Green for high-authority feature cards; Evidence Paper for technical drawers.
- **Shadow Strategy:** none; use tone and one-pixel rules.
- **Border:** Graphite Rule by default.
- **Internal Padding:** generally `20px` to `34px`, scaled to content density rather than card importance.

### Inputs / Fields

- **Style:** `49px` high, square, Clean Drafting Paper background, `14px` horizontal padding, and a Graphite Rule.
- **Labels:** compact uppercase sans-serif with wide tracking; helper copy may use the serif when it explains meaning rather than mechanics.
- **Hover / Focus:** hover strengthens the rule; focus changes it to Observatory Green while the global Focus Cobalt ring remains available through `:focus-visible`.
- **Read-only:** use a dashed rule and Drafting Paper to distinguish derived facts from editable values.
- **Error / Disabled:** error moves the rule to Signal Coral; do not rely on color without accompanying copy or status semantics.

### Navigation

- **Desktop:** fixed paper rail with `48px` rows, restrained line icons, and compact sans-serif labels. Active items use Washed Observatory Green, Observatory Green text, and a narrow Signal Coral edge marker.
- **Mobile:** fixed paper header and five-column bottom navigation. The active marker moves to the top edge; labels and icons stack vertically without becoming pills.
- **Feedback:** hover adds a very light Observatory Green wash; focus uses the global Focus Cobalt outline.

### Accuracy Selector

Each birth-time accuracy choice is a full-width, square row with a `74px` minimum height. The selected row uses Washed Observatory Green and an Observatory Green rule; the circular radio is the sole rounded element because it represents a discrete selection. Title and explanation remain stacked and readable at every width.

### Evidence Drawer

The evidence drawer is a signature component: a square Evidence Paper disclosure with an `82px` summary row, serif title, monospaced state label, and one-pixel internal grid. Closed state says “Open”; open state says “Close.” Evidence cells use monospaced values and collapse from three columns to one below `700px`.

### Named Rules

**The State Must Read Before It Moves Rule.** Color, label, border, and status copy establish a state first; motion only confirms the transition.

## Do's and Don'ts

### Do:

- **Do** build from Drafting Paper, warm tonal layers, and fine Graphite Rules.
- **Do** use serif for interpretation, sans-serif for operation, and mono for evidence.
- **Do** reserve Signal Coral for active edges, revisions, destructive actions, and consequential annotations.
- **Do** keep visible Focus Cobalt outlines and meet the product's WCAG 2.2 AA target.
- **Do** stack dense regions at the established breakpoints before content becomes cramped or illegible.
- **Do** respect reduced-motion preferences by collapsing animation and transition durations.

### Don't:

- **Don't** introduce zodiac kitsch, neon cosmic gradients, or decorative celestial spectacle.
- **Don't** use glossy dashboard cards, ambient drop shadows, glassmorphic layers, or floating surfaces.
- **Don't** turn controls, chips, fields, cards, or navigation rows into pills.
- **Don't** use Focus Cobalt as decorative color or Signal Coral as a broad background wash.
- **Don't** replace inspectable rules and evidence with generic wellness imagery or sign-based filler.
- **Don't** shrink complex charts, grids, or evidence merely to preserve a multi-column layout.
