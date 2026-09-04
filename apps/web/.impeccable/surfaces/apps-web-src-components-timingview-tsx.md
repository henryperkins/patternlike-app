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

An individual adult opens Timing, most often on a phone, without knowing what the page is for. The screen succeeds when the first two lines say what a cycle is and what the page shows, and the reader can then tell, without specialist knowledge, which cycles are in play, where each one stands, when it is next exact, and how fresh the calculation is. Everything else is one disclosure away.

Proof is the modelled Timing response itself: calculated body, target, aspect, active or upcoming status, one of five recomputed phases, envelope dates, ordered exact passes and directions, technique, orb, elapsed duration, opaque cycle id, scan receipt, applied filters, and any unreadable-artifact count. Copy keeps these as observations, not interpretations or promises about events and outcomes.

## Approved direction (revised 2026-09-04)

The 2026-08 build was correct and unreadable: operator vocabulary ("persisted daily-reading scan"), a headline that named an idea rather than the page, filters ahead of content, and every cycle fully expanded with full timestamps and a four-cell evidence grid. This revision keeps the Private Observatory world and the incumbent behaviour and rewrites the surface for a phone reader.

- **Mobile-first, in one block.** The Timing CSS is written with the phone layout as the base and two `min-width` steps (701px, 961px) that widen it; no Timing rule lives in the shared `max-width` breakpoint blocks.
- **Header.** Eyebrow `Timing / Active cycles`, h1 `Where each cycle stands today.`, then a three-sentence lede: what a cycle is (a planet in the current sky lining up at a set angle with a point in the birth chart; comes into range, is exact once or a few times, moves on), that these are the cycles the daily reading works from, and the boundary (calculated dates, not predicted events). The earlier headline, "See the whole arc, not just the peak.", is retired: it named the idea without saying what the page is.
- **Glossary once, not per card.** A closed disclosure, `What the terms mean`, defines in range, exact pass, direct/retrograde, phase, and upcoming. The phase entry describes position mechanically and mirrors `computePhase` (approach split early/late, the day or so around any exact pass, between first and last pass, after the last pass while still in range). It is the only place phase words are explained; no card carries interpretive phase prose.
- **Freshness as a sentence.** `Calculated today, when your daily reading was prepared.` on a current receipt; on a stale one, `Calculated Aug 9 with that day's reading. It updates when today's reading is prepared.` with an `Open Today` link. No clock time sits next to "today": the server decides "today" in the scheduling zone and the receipt instant would render in the browser's, which can be the other side of midnight. Stored cycles with no receipt at all (persistence succeeded, the reading reservation did not) get `Calculated for a daily reading that did not finish preparing.` and the same link. The unreadable count is a coral-ink warning line beneath the sentence in every state. The mono receipt strip is gone.
- **Filters only when they can narrow something.** The two native selects (Phase, Duration) remain and keep their contract semantics, but render only when the response has cycles or a filter is applied (client state or server echo). They share one row from about 410px up and stack below that, because `1 year or longer` clips inside anything narrower than a 180px select.
- **Grouped list.** Cycles are grouped under `Active now` and `Upcoming` label-style h2 headings with counts; cycle titles are h3. Active cycles precede upcoming ones inside the API's own order.
- **Per cycle, in reading order:** serif title; a status line made of the phase chip (mono caps, Time Travel's chip) and one fact, `Next exact <date>`, `Last exact <date>`, or `Starts <date>`; the track (a rule from start to end, a 3px elapsed fill to today, numbered ticks that key into the pass list, a coral today marker and a coral next tick); the span line (start date, `about 6 months`, end date); the visible ordered pass list (`Pass n`, day-level date, direction, a `Next` tag on the next pass, past rows muted); and a closed `Calculation details` disclosure holding orb, in-range days, technique, and cycle id.
- **Dates are days.** `formatTimingDate` shows month and day, adding the year only when it differs from the response's `as_of` year. The full instant stays in every `<time dateTime>`. The precise duration and orb live in the details disclosure; the visible length is the rounded `formatTimingLength`.
- **Coral is spent on exactly two things:** where today is, and the next exact pass. Phase chips are Graphite Rule and Soft Ink, not coral.
- **Status without noise.** The polite live region is `sr-only`; a three-bar skeleton stands in during the first load. A filter refetch keeps the existing list rendered and fully opaque under `aria-busy`, with a thin coral sweep along the filters' bottom edge as the visible cue; dimming the results would drop 13px text under AA for as long as the request lasted.
- The three typographic voices hold: serif for the headline and cycle titles, sans-serif for the lede, freshness, filters and pass dates, mono for chips, tick numbers, pass labels, directions, lengths, and evidence.

## Data ranges and states

- **Cycles:** zero to many readable cycles; active cycles precede already-persisted upcoming cycles, each group rendered only when non-empty.
- **Passes:** one to many exact passes per cycle, always exposed in semantic chronological order; at most one is tagged `Next`.
- **Phase:** Emerging, Building, Peak, Reconsidering, Integrating, or Upcoming.
- **Receipt:** current, stale, or not scanned, with known refresh fields only when a receipt exists.
- **Artifacts:** zero to many unreadable stored artifacts, reported as an exact omission count without hiding readable siblings.
- **Filters:** phase and duration independently or together; duration labels are Under 3 months, 3–12 months, and 1 year or longer.
- **Material states:** initial loading (skeleton); current with cycles; current empty (`Nothing is in range right now.`, describing the projection rather than the scan, since the route drops a cycle the moment its envelope ends; filters hidden); stale with the latest facts still visible; not scanned with nothing stored (`No cycles have been calculated yet.`, prerequisites named, `Open Today`, filters hidden); not scanned with stored cycles or omissions (cycles listed, the receipt-less sentence, the omission count); filtered empty (`No cycles match these filters.`, both selects kept, reset offered); readable facts alongside unreadable omissions; no readable cycles with unreadable omissions; cached-PWA/Worker-rollback 501 (`Timing is not available on this server.`); network or server error with request id and retry; and unauthorized handoff.

## Interaction and layout

1. Keep one stable page `h1` and a mounted polite status region through loading and retries; the region is visually hidden.
2. Freshness precedes the filters so the reader knows what the controls can inspect. An unreadable count is a visible warning, not hidden metadata.
3. Labeled square native selects for phase and duration. A change starts an abortable request; filtered-empty keeps both controls and offers a reset to the unfiltered response. The controls are absent when there is nothing to narrow.
4. Render cycles as ordered lists of semantic `<article>` elements under group `h2`s, with `h3` titles. Use `<time dateTime>` for envelope dates, the status-line date, and every exact pass.
5. The track is a progressive visual aid derived only from positions within the envelope and is `aria-hidden`. Pass order, dates, directions, and phase remain understandable without CSS, and the visible ordered pass list is never replaced by plotted ticks alone.
6. Evidence metadata (orb, in-range days, technique, cycle id) sits inside a closed disclosure styled like Time Travel's compact cycle detail, so technical identity never outranks the title and status.
7. On stale state, retain the facts and link to Today. On not-scanned state, say the cycles are calculated the first time a daily reading is prepared and name what that needs (chart, confirmed time zone and language, AI-synthesis consent); the link must not promise immediate Timing population.
8. At `390x844` and `320x568`, everything stacks in one column with no horizontal scroll, pass rows put the direction under the date, the cycle id wraps, and tap targets stay at 44px or more. At `1440x1000`, the header spans the page while freshness, filters, and the grouped list share one 860px column so their rules align.

## Boundaries and exclusions

- Do not author cycle interpretation, phase meaning beyond the mechanical glossary, life-domain inference, predictions, diagnoses, event promises, or new editorial content.
- Do not restore the removed domain filter, refresh from GET, call calculation, enqueue work, write D1, imply cron or complete future-horizon coverage, or add an in-place refresh action.
- Do not add related-reading links; the necessary cycle references are inside encrypted reading artifacts and have no bounded read index.
- Do not render development JSON, a milestone stamp, generic "route is returning data" copy, or the generic future-feature panel after a successful response.
- Preserve cached/installed-PWA rollback honesty for a 501, request-id-safe error reporting, unauthorized handoff to the existing signed-out experience, keyboard focus, reduced motion, visible focus treatment, and WCAG 2.2 AA.
- Preserve every shell, navigation, Today, Time Travel, Pattern, privacy, preference, and API behavior outside the named Timing integration.
