# Portrait interaction and workflow review — corrected follow-up

Reviewed commit: `6e706741f03253f2807d33380afb529161f3481f`.
Primary component SHA-256: `a9b6bfd8962f13fce974e4cb6099f1be059e914f0342eaf3e6a5751e4c44f738`.

This September 7 follow-up completed the earlier dual-agent review with coordinator verification of the actual account integration. It corrects the claims in the [historical critique](artifacts/2026-09-07-portrait-r1-r4/critique/2026-09-07T13-58-34Z__components-portrait-explorer-portraitexplorer-tsx.md). Its [original source capture](artifacts/2026-09-07-portrait-r1-r4/originals/critique/2026-09-07T13-58-34Z__components-portrait-explorer-portraitexplorer-tsx.md.gz) is preserved byte for byte alongside the readable copy. No application code or saved artwork was edited during that original review.

**Current backlog:** The [consolidated remaining priorities](2026-09-07-portrait-remaining-priorities.md) supersede the four priorities below. R1–R4, including the subsequently reproduced sky-history and standalone phone-return defects, were fixed and pushed; R5, R6 and P3 remain open. The [complete Cursor reports and captures](2026-09-08-branch-cleanup-and-review-integration.md#complete-portrait-review-sources) are now preserved with their original source identities. The original audit corrections below remain historical evidence.

The recommendation is to retain the 3D observatory and improve object recognition, the transition to reading, and control hierarchy. The architectural setting and visual exploration are part of the written direction; they are not accidental departures that this review authorizes removing. No release blocker was established within this initial follow-up's observed workflows; the later consolidated review adds the separately reproduced sky/history failure.

## Original priorities (superseded by the consolidated backlog)

### P1: Make chapter objects easier to recognize and select in the opening view

The original-model desktop capture shows large areas of foliage and overlapping structures around the chapter displays. Only three chapter labels are visible in that frame, although all four chapters remain reachable through native navigation. Do not treat this as an accessibility lockout or make labels pick through opaque architecture: occlusion is intentional under the Visible Surface Rule.

Improve the opening camera angle/distance and the visual connection between labels and their objects. Consider connectors for collision-displaced labels while preserving occlusion. The canvas also remains `grab` over selectable geometry; `PortraitScene.tsx:117,335-340` already has the pick result needed to show a pointer over an interactive object. Strengthen the hover/selection indication at the default camera distance. Native label buttons already provide a separate interactive target.

Relevant source: `apps/web/src/components/portrait-explorer/observatory-world.ts:19` and `PortraitScene.tsx:338`.
Suggested work: Impeccable layout, then polish.

Evidence: [original-model opening capture](artifacts/2026-09-07-portrait-r1-r4/review-resume/assessment-a-01-desktop-initial.png), [selected chapter capture](artifacts/2026-09-07-portrait-r1-r4/review-resume/assessment-a-02-desktop-chapter-selected.png). These are copied from Assessment A, whose reviewed component fingerprint matches the current component. The account test shapes below are not evidence about artwork quality.

### P2: Clarify the difference between approaching a chapter and reading it on phones

At 390×900 in the real account shell, different controls produce different outcomes:

| Entry | Result | Heading top within viewport |
| --- | --- | ---: |
| Introductory “Begin with…” button | Focuses and brings the reading into view | 196px |
| Chapter rail | Keeps exploration active; heading appears low in the viewport | 731px |
| In-scene label | Keeps the scene in view and focuses its annotation | 1,239px; below viewport |
| “Read chapter” | Hides the scene and focuses the selected reading | 196px |

The first and fourth paths work. The broad earlier claim that selecting any chapter strands the reading 1,600px away was inaccurate. The remaining concern is that similarly described entry choices do not clearly distinguish approach from reading. Preserve direct scene exploration and place an explicit, chapter-specific reading action near the selected scene state; use clear labels to explain each action's destination. Any automatic switch to reading should be a deliberate product choice, not assumed to be a bug fix.

Relevant source: `PortraitExplorer.tsx:143`, `:244`, `:281`, `:336`, `:351`.
Suggested work: Impeccable clarify and adapt.

Evidence: [rail selection on phone](artifacts/2026-09-07-portrait-r1-r4/review-resume/account-phone-rail-selected.png), [scene selection on phone](artifacts/2026-09-07-portrait-r1-r4/review-resume/account-phone-scene-selected.png).

### P2: Remove the redundant mobile introduction and distinguish primary actions from scene options

“Explore the first chapter” and “Begin with [chapter title]” both call `select(manifest.chapters[0].id, true)`. They appear in separate introductory blocks on phones. One prominent entry plus named chapter navigation is sufficient; preserve the guide as an optional sequential route. Keep camera, lighting and object-operation controls grouped according to purpose.

This is a hierarchy recommendation, not evidence that five routes are equally prominent or that every selectable control is a simultaneous decision. Do not use the earlier “52 focusable controls” count as a measured simultaneous-visibility limit.

Relevant source: `PortraitExplorer.tsx:336,351`.
Suggested work: Impeccable distill.

### P2: Make the desktop reader's additional content and actions discoverable

The account reader measured 722px high with 938px of scrollable content for the Overview chapter. At its initial scroll position, the image/compare action row began at viewport y=914px while the reader ended at y=891px, so the actions were below its visible boundary. The original preview capture also shows action text cut at that boundary.

The actions remain available by scrolling; this is not lost content. Give the scroll region a visible continuation cue or keep the action row accessible in a distinct footer, with sufficient content padding if it becomes sticky.

Relevant source: `explorer.css:74,157,194`.
Suggested work: Impeccable adapt, followed by polish.

## Corrections to the earlier report

1. **“Whole portrait” does not destroy the chapter, perspective, or saved reader position.** It changes to the overview and records a history snapshot. Browser Back restored chapter 2 with Resources selected. A separate check restored Overview with the reader's exact 150px scroll position. The wording can be clarified, but the prior P1 loss/no-undo claim is withdrawn. See `explorer-state.ts:71,84,117` and `use-explorer-navigation.ts:145`.
2. **Silent disappearance after regeneration was not established.** The isolated `if (!sourceMatches)` branch was previously treated as a complete user workflow. Its parent validates Pattern/document identity and provides explicit recovery on mismatch (`PatternExperience.tsx:379-402`). A mismatched saved portrait response in the browser displayed a status-refresh error and retained the complete prose. The claim of a demonstrated silent failure is withdrawn. Actual regeneration against a live backend was not exercised.
3. **Account provenance checks are not an integration blocker.** The authored preview GLBs intentionally cannot be passed off as account models. Four synthetic programs compiled through the existing compiler produced valid source-bound GLBs with correct hashes; the real account component validated and rendered them without changes to validators or originals. This establishes local integration, not a live model-generation audit.
4. **The per-model payload limit is 750,000 bytes, not 3 MiB.** Both the compiler and browser delivery enforce that limit (`portrait-mesh-compiler.ts:13`, `api-client.ts:1353`). The 3 MiB constant limits a transport request containing other fields. The earlier 12 MiB worst-case total for four production GLBs is incorrect; the four model limits sum to 3,000,000 bytes, excluding images and other application resources.
5. **107 detector advisories are not 107 user-facing defects.** The earlier detector did run successfully, but its nearest-document token resolution, inherited values, overridden CSS and 3D material values require triage. The published “71 verified true positives” mixes token drift with visual consequences and should not be used as a remediation checklist without computed-style checks. No detector rerun was needed for this follow-up.
6. **The 24/40 score is not a reliable release decision.** It incorporated the withdrawn state-loss and silent-failure claims. No replacement numerical score or trend is asserted from this targeted follow-up.

## Verified workflows and strengths

| Workflow | Current local evidence |
| --- | --- |
| No portrait yet | Real account card shows the automation choice and complete written chapters |
| Generation in progress | Real account card reports 2/4 images and 1/4 models; reading remains present |
| Generation failure | Saved model count, retained-reading copy and status-refresh action are present |
| Stale saved portrait | Explicit refresh error; complete prose remains available |
| Ready account portrait | Four image and four model requests; actual validators pass; WebGL controls become enabled |
| Overview and Back | Chapter, perspective and exact reader scroll position restored |
| Phone reading → sky → Pattern | Selected chapter and Resources perspective restored in reading presentation |
| Full reading | All four chapters' titles, summaries, sections, tensions, resources and counter-expressions present |

Both 1440×900 and 390×900 account runs had no page JavaScript errors and no horizontal document overflow. The prior assessments separately measured zero axe violations on the preview, visible keyboard focus, passing sampled text contrast, one-frame reduced-motion updates, and rendering that stops at rest. Those results remain preview evidence, not a fresh full-account accessibility certification.

Two smaller issues remain: the stale portrait error calls it a “constellation” inside the “3D portrait” card (`account-portrait.ts:4`); the scene wrapper's `aria-label` lacks a corresponding semantic role. Neither establishes a blocked workflow.

## Evidence and scope

- Node: pinned Node 22.23.2. Browser: cached Chromium 1234 via Playwright 1.62.1, SwiftShader software rendering.
- Source was unchanged from the original review. Original assessments were independent A and B; this continuation is a coordinator verification, not a new independently scored critique.
- All account `/v1` requests were intercepted locally. The compiler created clearly labeled fictional test shapes with genuine matching byte hashes. No generation provider, live account, deployment, or API mutation was used.
- [Initial account results](artifacts/2026-09-07-portrait-r1-r4/review-resume/results.json) include all five states. [Bounded confirmation results](artifacts/2026-09-07-portrait-r1-r4/review-resume/confirmation.json) additionally verify the exact reader-scroll restoration and introductory CTA.
- Reproduction sources: [fixture.mts](artifacts/2026-09-07-portrait-r1-r4/review-resume/fixture.mts) and [check.mjs](artifacts/2026-09-07-portrait-r1-r4/review-resume/check.mjs). The current fixture builder reuses the prior review's local chart fixture and therefore needs that temporary source if rebuilt verbatim.
- One harness error was corrected: navigating to the same URL retained the prior document rather than reloading between status scenarios. Unique query strings forced separate loads; the saved results come from the successful rerun, not the discarded attempt.
- The local Vite server on 5183 was stopped and browsers were closed. No new detector live server or overlay was started. Previous Assessment B reported cleaning up its overlay server. Cleanup of the prior review's abandoned wait loops was not established; an overbroad command-line match terminated its own cleanup shell. This did not affect source or browser evidence.
- Physical-device performance, actual screen-reader use, live generation/retry, download usability and production behavior remain unverified. A full CI merge gate was not run because this task changed no application code and performs no merge.
