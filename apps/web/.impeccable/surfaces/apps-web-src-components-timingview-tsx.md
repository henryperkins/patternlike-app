---
version: 1
slug: "apps-web-src-components-timingview-tsx"
primary_target: "apps/web/src/components/TimingView.tsx"
related_targets: ["apps/web/src/lib/timing-format.ts","apps/web/src/styles.css"]
---

# Timing

## Scope and mode

- **Primary target:** `apps/web/src/components/TimingView.tsx`
- **Related targets:** `apps/web/src/lib/timing-format.ts`, `apps/web/src/styles.css`
- **Visitor mode:** Operate.
- Timing is a read-only inspection surface for active and already-persisted upcoming cycle arcs. It does not calculate, refresh, enqueue, interpret, or promise future coverage.

## Audience, job, and proof

An individual adult arrives to understand where a longer calculated cycle sits in its arc without needing specialist astrology knowledge. The screen succeeds when the reader can identify the factual contact, distinguish active from upcoming, inspect its envelope and exact passes, and understand the freshness and limits of the persisted scan without reading a predictive claim.

Proof is the modelled Timing response itself: calculated body, target, aspect, active or upcoming status, one of five recomputed phases, envelope dates, ordered exact passes and directions, technique, orb, elapsed duration, opaque cycle id, scan receipt, applied filters, and any unreadable-artifact count. Copy must keep these as observations, not interpretations or promises about events and outcomes.

## Approved direction

- Preserve the incumbent Pattern/Like shell and “Private Observatory” visual world established by `PRODUCT.md`, `DESIGN.md`, and the current application: warm drafting paper, Observatory Green, sparse Signal Coral, fine Graphite Rules, square flat components, and no shadows or cosmic spectacle.
- Keep the established factual header: eyebrow `Timing / Active cycles`, the whole-arc headline, and a present-tense lede that states the non-predictive boundary.
- Follow the header with one compact scan-status strip, then two native filters, then a single editorial cycle list. This is an operational reading instrument, not a generic dashboard-card grid.
- Each cycle leads with a plain factual title and mechanical phase or Upcoming marker. Its focal moment is a progressive envelope timeline whose current position or next exact pass may use Signal Coral; the visible ordered exact-pass list remains the authoritative content.
- Preserve the system's three typographic voices: serif for the whole-arc headline and cycle titles, sans-serif for controls and explanatory operations, and mono for receipt state, technique, orb, duration, pass labels, and opaque ids.

## Data ranges and states

- **Cycles:** zero to many readable cycles; active cycles precede already-persisted upcoming cycles.
- **Passes:** one to many exact passes per cycle, always exposed in semantic chronological order.
- **Phase:** Emerging, Building, Peak, Reconsidering, Integrating, or Upcoming.
- **Receipt:** current, stale, or not scanned, with known refresh fields only when a receipt exists.
- **Artifacts:** zero to many unreadable stored artifacts, reported as an exact omission count without hiding readable siblings.
- **Filters:** phase and duration independently or together; duration labels are Under 3 months, 3–12 months, and 1 year or longer.
- **Material states:** initial loading; current with cycles; current empty; stale with the latest facts still visible; not scanned; filtered empty; readable facts alongside unreadable omissions; no readable cycles with unreadable omissions; cached-PWA/Worker-rollback 501; network or server error; and unauthorized handoff.

## Interaction and layout

1. Keep one stable page `h1` and a mounted polite status region through loading and retries.
2. Present scan state and last refresh before the filters so the reader knows what the controls can actually inspect. An unreadable count is a visible warning, not hidden metadata.
3. Use labeled square native selects for phase and duration. A change starts an abortable request; filtered-empty keeps both controls and offers a reset to the unfiltered response.
4. Render cycles as an ordered editorial list of semantic `<article>` elements with `h2` titles. Use `<time dateTime>` for envelope dates and every exact pass.
5. Make the timeline a progressive visual aid derived only from positions within the envelope. Pass order, dates, directions, and phase remain understandable without CSS, and the visible ordered pass list is never replaced by plotted dots alone.
6. Close each cycle with restrained evidence metadata for technique, orb, elapsed duration, and cycle id. Do not let technical identity outrank the factual title and phase.
7. On stale state, retain the facts and link to Today to prepare the current local day. On not-scanned state, explain that Today is where preparation begins, while stating that chart, scheduling-zone, locale, or active-release setup may be required first; the link must not promise immediate Timing population.
8. At `1440x1000`, align the status, filters, list rules, timeline, pass list, and metadata to the shell's instrument grid. At `390x844`, stack controls and metadata before comprehension is lost, keep tap targets intact, prevent id overflow, and retain CSS-independent pass order and semantic times.

## Boundaries and exclusions

- Do not author cycle interpretation, phase meaning, life-domain inference, predictions, diagnoses, event promises, or new editorial content.
- Do not restore the removed domain filter, refresh from GET, call calculation, enqueue work, write D1, imply cron or complete future-horizon coverage, or add an in-place refresh action.
- Do not add related-reading links; the necessary cycle references are inside encrypted reading artifacts and have no bounded read index.
- Do not render development JSON, a milestone stamp, generic “route is returning data” copy, or the generic future-feature panel after a successful response.
- Preserve cached/installed-PWA rollback honesty for a 501, request-id-safe error reporting, unauthorized handoff to the existing signed-out experience, keyboard focus, reduced motion, visible focus treatment, and WCAG 2.2 AA.
- Preserve every shell, navigation, Today, Time Travel, Pattern, privacy, preference, and API behavior outside the named Timing integration. There are no unresolved product or visual decisions for the builder to invent.
