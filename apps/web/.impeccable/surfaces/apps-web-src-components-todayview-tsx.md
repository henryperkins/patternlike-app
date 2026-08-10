---
version: 1
slug: "apps-web-src-components-todayview-tsx"
primary_target: "apps/web/src/components/TodayView.tsx"
related_targets: ["apps/web/src/components/WhyThisDrawer.tsx","apps/web/src/styles.css"]
---

# Today

## Scope and mode

- **Primary target:** `apps/web/src/components/TodayView.tsx`
- **Related targets:** `apps/web/src/components/WhyThisDrawer.tsx`, `apps/web/src/styles.css`
- **Visitor mode:** Read.
- Today is a theme-first, read-only, self-contained daily chapter. It does not add journaling, acknowledgment, saving, a Timing bridge, API work, or changes to neighboring surfaces.

## Audience, job, and proof

An individual adult arrives for a quiet minute of private reflection. The screen succeeds when the reader can name one memorable theme and leave with one useful question. The chapter may carry one reviewed fallback paragraph, a typical four-part reading, or the anticipated seven role blocks. Calculated facts, reviewed content, uncertainty, context labeling, revision state, and provenance remain inspectable without displacing the reading.

## Approved direction

- **Composition:** The Lead Line.
- **Approved comp:** `apps/web/.impeccable/mocks/today-lead-line.png`
- **Memorable moment:** a short Signal Coral rule introduces the primary-theme paragraph, which becomes the first viewport's dominant typographic statement; the date establishes the day without acting as the hero.
- The reading proceeds as one continuous editorial column. Supporting influence, phase, timing, reflection, uncertainty, and context become progressively quieter. `Why this reading?` closes the same measure beneath the complete chapter.
- The comp is a north star, not literal line wrapping. All text and controls remain semantic, responsive, accessible code; the generated image is never shipped as UI.

## Fidelity inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Existing application shell | Preserve navigation, orbital mark, paper field, grid, and active-state behavior unchanged | Existing React, CSS, and SVG |
| Compact Today header | Eyebrow, medium serif date, and sparse metadata stay above the reading; date is subordinate to the lead on desktop and never overflows on mobile | Semantic header and CSS |
| Primary-theme lead | Largest reading type, generous measure, short coral rule, no card or background container | Existing paragraph markup plus CSS/pseudo-element |
| Supporting chapter | One narrow column; labels remain compact sans; prose remains serif; reflection closes the interpretive sequence in italic | Existing semantic markup and CSS |
| Uncertainty and context | Flat annotation rows with icons and rules, visibly distinct without becoming floating cards | Existing markup/icons plus CSS |
| Provenance disclosure | Square Evidence Paper disclosure aligned to the reading measure; lazy behavior and evidence states remain unchanged | Existing `details` component and CSS |
| Responsive translation | Header and metadata stack; lead scales down without losing priority; evidence and notices remain within the viewport | Existing breakpoints plus scoped CSS |

## Component grammar

Square corners, one-pixel Graphite Rules, flat paper layers, no shadows. Iowan/Palatino serif carries the date and reading; sans-serif operates labels; mono remains evidence-only. Desktop lead type is materially larger than the date; mobile preserves hierarchy through measure, spacing, and the coral rule rather than forcing desktop-scale type. Signal Coral is limited to the lead marker, revision state, and context consequence.

## Constraints and unresolved decisions

Preserve every existing loading, preference, missing-chart, not-generated, fallback, error, unauthorized, revision, and evidence behavior. Preserve one `h1`, article semantics, keyboard focus, live status messaging, reduced motion, and WCAG 2.2 AA. Do not replace factual copy or introduce claims. There are no unresolved product or interaction decisions.
