# Mobile-first design review — `apps/web`, 2026-08-11

Every claim below was measured against the tree at the time of writing, in a real
Chromium at phone viewports (320×640, 375×667, 393×852, and 852×393 landscape)
with the API stubbed from the repo's own fixtures in `src/test/`. Method and
reproduction are in [§ How this was measured](#how-this-was-measured).

**The layout work is sound.** There is no horizontal overflow anywhere, content
clears the fixed bottom bar, long mono identifiers wrap, and the four breakpoints
are individually well-reasoned — the comments in `styles.css` explain why each
one exists, and each reason checks out. What follows is not a rewrite argument.

**What is wrong is mostly not layout.** One feature is unreachable on a phone,
every text field zooms the page on iOS, and the labelling layer that tells a
reader what they are looking at renders at 8–10px. These are independent of the
grid work and can be fixed without touching it.

---

## Status

[#18](https://github.com/henryperkins/patternlike-app/pull/18) addresses these.
Re-measured against its head (`b6f6650`) with the same harness:

| Finding | Before | After |
|---|---|---|
| 1 · Sign-out on mobile | 0 of 5 views | Privacy, 123×50, clears the nav ✅ |
| 2 · Inputs under 16px | 4 | 0 ✅ |
| 3 · Text under 10px | 46% of runs | 27% — **partially fixed**, see below |
| 4 · Landscape chrome | 138px (35%) | 70px (18%) ✅ |
| 5 · Tap targets under 44px | 5 | 0 ✅ |
| 6 · `viewport-fit=cover` | absent | present ✅ |
| 7 · `theme-color` mismatch | yes | aligned ✅ |
| 8 · `100vh` | — | `100dvh` ✅, but see the correction in that finding |

Finding 3 is lifted by a hand-enumerated `:is(…)` allowlist of ~16 selectors, so
it raises exactly those and nothing else. Text under 12px is unchanged at ~63% of
runs, and 67 runs remain under 10px — concentrated in the evidence tables
(`dt` at 8px, `dd` at 9px), the timing-cycle metadata, and the 7px `M1` milestone
stamps. The remainder is the design decision named in the finding, not an
oversight in the PR.

---

## Findings

Ordered by what a reader on a phone actually hits.

### 1. There is no way to sign out on a phone — blocking

`AppShell.tsx:78` renders the only sign-out control in the app, inside
`<aside className="sidebar">`. `styles.css:3017` sets `.sidebar { display: none }`
at `max-width: 960px`. `.mobile-header` carries a wordmark and a status dot;
`.mobile-nav` carries the five view links. Neither carries sign-out, and no view
provides its own.

Measured at 393×852 across all five views: **one DOM match for "Sign out", zero
visible**, on every one.

```
 #today:   matches=1 visible=0   [{"text":"Sign out","hidden":true,"w":0,"h":0}]
 #pattern: matches=1 visible=0   ...same on #timing, #travel, #privacy
```

This matters more here than it would in most apps. `pl_session` is an httpOnly
cookie and, per `App.tsx:27-34`, the cookie is the only thing that answers "am I
signed in" — so a reader on a shared or borrowed phone has no way to end their
session from the UI, on a product whose stated posture is "private by design".
Clearing it requires browser settings, and in the installed PWA (`display:
standalone`) there is no browser UI to reach.

**Fix:** put sign-out on a surface that survives the breakpoint. The Privacy view
is the natural home — it already owns account deletion and export — and adding it
there fixes desktop and mobile together rather than adding a third copy of the
control.

### 2. Every text input zooms the page on iOS — high

iOS Safari zooms the viewport when a focused text field computes under 16px. The
zoom is not undone on blur: the reader is left with the layout viewport wider
than the visual viewport, which pushes the fixed header and bottom nav partly
off-screen until they pinch back out.

Measured computed sizes at 393px:

| Field | Rule | Size | Surface |
|---|---|---|---|
| Birth date, local time | `styles.css:659` | **14px** | Onboarding, step 1 |
| Phase / duration filters | `styles.css:2369` | **14px** | Timing |
| Deletion confirmation | `styles.css:2216` | **13px** | Privacy → delete account |
| Gate input | `styles.css:1634` | **15px** | Today, AI-consent gate |

Onboarding is the first thing every new reader touches, and the date and time
fields are the first two controls in it.

**Fix:** raise the four rules to `16px`. If 14px is load-bearing for the visual
rhythm, the usual escape is to keep the visual size and add
`@supports (-webkit-touch-callout: none)` at 16px, but simply moving to 16px on
four inputs is less machinery and reads the same at phone scale.

### 3. 46% of on-screen text renders under 10px — high

Across six screens at 393px, counting every visible run of HTML text (SVG
excluded):

```
   7px :   2      8px :  62      9px :  50     10px :  43     11px :   1
  12px :  15     13px :  14     17px :  22     27px :   6     51px :   3   …

TOTAL 248 runs | under 12px: 158 (64%) | under 10px: 114 (46%)
```

The editorial layer is generous — reading prose is 17px, the lede 27–34px, page
titles up to 51px. The problem is everything that *labels* it: eyebrows, kickers,
panel codes, chips, evidence-lane headers, and the tab bar all sit at 8–10px,
mostly uppercase with wide tracking. On a phone that labelling layer is what
tells a reader which thing they are looking at, and it is the layer least able to
survive being read at arm's length, in sunlight, or by anyone whose near vision
has started to go.

The tab bar is the sharpest case: `.mobile-nav .nav-item` is 9px, dropping to
**8px** below 420px (`styles.css:3425`). Apple's own floor for tab labels is 10pt.

**Fix:** this is a design decision, not a bug, so the call is yours. The
mechanical version is a floor of 11px on mobile for the label layer and 10px on
the tab bar, which costs very little of the look. Worth noting that these sizes
were presumably tuned against a 1440px desktop canvas where 9px sits in a dense
sidebar — the same value in a 393px column is doing a different job.

### 4. Landscape gives 35% of the screen to fixed chrome — medium

At 852×393, measured: header 68px + bottom nav 70px = **138px of 393px**, leaving
255px for content. The screenshot shows the eyebrow and the date, and the
reading's first paragraph starting underneath the nav bar.

The header earns little of its 68px. It holds a wordmark linking to `#pattern`
(already the second item in the tab bar) and a status dot whose text label is
already hidden below 700px (`styles.css:3117`).

**Fix:** collapse the header in short viewports —
`@media (max-height: 480px) { .mobile-header { display: none } }` and drop the
matching `padding-top` — or shrink both bars. Nothing in the header is unique, so
hiding it loses no function.

### 5. Sub-44px tap targets — medium

Measured at 393px against the 44×44 floor (WCAG 2.5.8, Apple HIG):

| Control | Size | Where |
|---|---|---|
| "Fill local example" | **123×15** | Onboarding |
| "See the daily layer status" | **194×17** | Chart |
| "Review" | **92×30** | Privacy |
| Wordmark (home) | **121×24** | Mobile header, all views |
| "Skip to content" | **134×38** | All views |

All are wide enough; all are too short. The radio cards and checkboxes are fine —
`.accuracy-option` is 74px tall and the whole card is the label, which is the
right pattern.

**Fix:** `min-height: 44px` plus centring on `.text-button` and `.inline-link`,
and vertical padding on the wordmark. These are inline text links, so padding
alone will not do it without `display: inline-flex`.

### 6. `env(safe-area-inset-*)` is inert — low, but the intent is not realised

`styles.css:3050`, `:3052`, and `:3090` all read `env(safe-area-inset-bottom)`,
and the comment at `:3088` states the goal: *"the content has to clear both or the
last rows sit under a home indicator."*

`index.html:5` is `content="width=device-width, initial-scale=1.0"`. Without
`viewport-fit=cover`, iOS never extends the layout viewport into the unsafe area,
so **every one of those `env()` calls resolves to `0px`**.

Nothing is currently broken by this — iOS insets the web view instead, so content
does clear the home indicator. But the CSS is written for a mode the app is not
in, so the safe-area handling is untested code that would only start mattering
the moment someone adds `viewport-fit=cover`. The visible cost today is
landscape: without `cover`, notched devices letterbox the page rather than
running it edge-to-edge.

**Fix:** either add `viewport-fit=cover` to the meta tag — which makes the
existing `env()` calls do their job and buys edge-to-edge landscape — or drop the
`env()` calls as dead code. The first is almost certainly what was intended.

### 7. `theme-color` disagrees with the manifest — low

`index.html:10` declares `#f2efe6` (paper). `public/manifest.webmanifest`
declares `"theme_color": "#173f35"` (forest). The manifest wins in the installed
PWA, the meta tag wins in the browser, so the status bar changes colour depending
on how the same app was opened.

**Fix:** pick one. Paper matches the app background, which is the usual choice.

### 8. `min-height: 100vh` does not account for the fixed chrome — low

`.main-content` is `min-height: 100vh` with `padding-top: 68px` and
`padding-bottom: 70px` at mobile widths. Its child pages set `min-height: 100vh`
again — `.onboarding` (`:433`), `.unavailable-page` (`:2686`), `.loading-page` /
`.error-page` (`:492`). The child measures 100vh against the *full* viewport, not
against what is left after 138px of chrome, so the two stack.

Two consequences. `align-content: center` on `.unavailable-page` centres its
content in an 852px box when only 714px is visible, so a short page is centred
against the wrong rectangle. And `100vh` on iOS resolves to the
toolbar-*retracted* viewport, so on a real device each of these is another
~60–90px taller than it measures in an emulator.

`.onboarding` also keeps its `min-height: 100vh` at every width — the 1180px
block resets `.onboarding__intro` and `.onboarding-card` to `auto` but not the
grid itself.

**Fix:** `100dvh` in place of `100vh` on these five rules, and subtract the chrome
where the intent is "fill the visible area" —
`min-height: calc(100dvh - var(--mobile-header) - var(--mobile-nav))`. Note that
`.main-content` is *not* one of those: it starts at `y=0` and carries the 138px
of chrome as its own padding under `box-sizing: border-box`, so a plain `100dvh`
is already the correct value there and subtracting again lands 138px short.

> **Correction, 2026-08-12.** An earlier revision of this finding claimed
> "181px of scroll on a page with one heading and a link" on Time travel, and
> attributed that scroll to the nested `min-height`. That was wrong. Measuring
> [#18](https://github.com/henryperkins/patternlike-app/pull/18), which applies
> the `100dvh` fix, shows the `min-height` was never the binding constraint —
> `.unavailable-page` renders 899px of real content, so it exceeds an 852px
> viewport on its own, and the page still scrolls 185px afterwards (marginally
> more, because the larger label sizes from finding #3 add height). The rule
> change is still correct for the two reasons above; it simply does not reduce
> scrolling, and the original text over-claimed that it would.

---

## The authoring direction

The stylesheet is desktop-first: the base rules are the desktop layout
(`.sidebar { position: fixed }`, `.main-content { margin-left: var(--sidebar) }`,
`.mobile-header, .mobile-nav { display: none }` at `:270`), and mobile is
reached by four `max-width` overrides.

The rendered result is fine, and inverting 3,495 lines to `min-width` would be a
large change that fixes nothing on its own. It is worth naming only because it
explains finding #1 and predicts the next one like it: the mobile chrome is a
*separate DOM subtree* that has to re-implement whatever the sidebar offers, and
nothing enforces parity between them. Sign-out is the control that has already
fallen through that gap. Anything added to `.sidebar__foot` later will fall
through it the same way.

If the two navigations rendered from one source with only presentation differing
per breakpoint — which `NavItems` already does for the links, and does not do for
the footer — the gap would close structurally rather than by remembering.

---

## Verified clean

Checked, and not a problem:

- **No horizontal overflow** at 320, 375, or 393px on any of the six screens —
  `document.scrollWidth === clientWidth` throughout. This is the failure mode I
  expected most and it is simply absent.
- **Content clears the fixed bottom nav.** At scroll end on Today: zero elements
  intersecting the bar.
- **Long mono identifiers wrap** — `cyc_0123456789abcdef0123456789abcdef` renders
  inside its card at 393px.
- **The provenance drawer** opens without introducing overflow.
- **`prefers-reduced-motion`** is honoured (`:3483`), and the `page-enter`
  animation uses `backwards` rather than `both` — the comment at `:280` documents
  the phantom-scroll bug that motivated it.
- **Tap highlight** suppressed, `:focus-visible` rings present on every
  interactive element, skip link present.
- **Radio and checkbox hit areas** are full-card, not the 15px/19px glyph.
- **The chart wheel** scales with a container query
  (`clamp(7px, calc(20.9px - 2.07cqi), 14px)`), which is the right tool.

## Out of scope, but noticed

`<AiConsentTerms>` throws on a consent payload missing `enabled_categories`, and
because the app has no error boundary the whole tree unmounts to a blank page —
`document.getElementById("root").innerHTML` is empty, with no visible error. I hit
this with a malformed stub of my own, not with a real API response, so it is not
evidence of a live bug. But a top-level error boundary would turn any such
payload mismatch into a recoverable screen instead of a white one.

---

## How this was measured

Vite dev server on `:5173`, real Chromium via Playwright, `isMobile: true`,
`hasTouch: true`, iOS user agent, `deviceScaleFactor: 2`. All `/v1/*` requests
intercepted and answered from `src/test/reading-fixture.ts` and
`src/test/timing-fixture.ts` so the screens carry the same data the unit tests
assert against.

Six screens (Today, Chart, Timing, Privacy, Time travel, Onboarding) × three
portrait viewports, plus landscape, scroll-end, and the drawer and
delete-confirmation states which only exist after a tap.

Per screen, measured in-page: every element's box against the viewport width;
every interactive element's rect against 44×44; every `input`/`select`/`textarea`
computed `font-size` against 16px; every visible text run's computed size; and
the distance from the lowest painted content to the end of the scrollable page.

Nothing in this document is inferred from reading CSS alone except the 15px gate
input in finding #2, which is a static read of `styles.css:1634` — that state
needs an ungranted consent record to render and the stub grants it.
