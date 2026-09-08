# 3D portrait — consolidated remaining priorities

Status updated **2026-09-08, after local R5 and R6 implementation**. R1–R4 are implemented with regression coverage and were pushed as `4394e9c`, followed by evidence commit `c991c8a`. **R5 and R6 are implemented locally; the three P3 follow-ups remain open.** Their verification and release status are separate from the historical R1–R4 receipts below. The original audit/remediation baseline was `6e706741f03253f2807d33380afb529161f3481f`. Their integration built on `e4ba2f9c8316cf884f17bcf70da8bc8734d38a9e`, which already includes default observatory entry and support for three to six chapters.

This priority list originally folded three user-supplied Cursor review extracts into the [corrected local review](2026-09-07-portrait-review-followup.md). Their [complete reports and captures](2026-09-08-branch-cleanup-and-review-integration.md#complete-portrait-review-sources) are now preserved from the original Git branches. The current status below supersedes the original backlog. Historical evidence retains its original scope; its line references and measurements describe the pre-remediation source. The [R1–R4 evidence](artifacts/2026-09-07-portrait-r1-r4/README.md) retains the remediation reports, receipts and source fingerprints. A Git push does not by itself establish verified production adoption.

Keep the observatory as the product's 3D path. Prioritize investigating the published chapter objects, with the complete reading and calibrated sky intact. The sky is a distinct navigation mode; lighting and furniture controls support exploration. Preserve source identity, exact passages, uncertainty, accessible alternatives and private-session invalidation throughout.

## Unaddressed implementation work

| Order / ID | Priority | Open issue | Next change and completion criteria |
| --- | --- | --- | --- |
| 3 — P3: wording | P3 | Shared portrait validation errors still use “constellation” when surfaced in the observatory. | Use context-appropriate wording for portrait, observatory and the actual legacy constellation. Keep the underlying source validation and recovery actions intact. |
| 4 — P3: scene semantics | P3 | The scene wrapper has an accessible label on a generic `div`. | Give it an appropriate semantic role or remove the unsupported redundant label; preserve the canvas description and native keyboard controls. |
| 5 — P3: token drift | P3 | Design-token cleanup remains untriaged; detector advisories alone do not establish a rendered defect. | Check computed styles against the local design contract, fix demonstrable drift, and document intentional exceptions. Preserve contrast, focus visibility, responsive geometry and the authored scene materials. |

The P3 follow-ups are the next remaining priorities. Detailed R5 and R6 implementation status, scope and acceptance criteria appear under **Remaining interaction work** below. P3 evidence and completion criteria appear under **Small follow-ups**. Guide progress through facets and whether a guide inherits desk/layout choices remain optional onboarding evaluations, not confirmed defects or release blockers.

## Completed locally — preserve these behaviors

| ID | Implemented behavior that later work must preserve |
| --- | --- |
| R1 | Pattern/sky transitions and selected sky body participate in browser history. Back/Forward and explicit return restore the exact originating reader and presentation; private content stays out of browser history and URLs. |
| R2 | Named chapter navigation and scene controls remain reachable at entry and after selection. Narrow reading retains chapter identity and a sticky return path, including account embedding and short landscape. |
| R3 | Comparison frames and names exactly the selected pair alongside both complete facets. Annotation links retain their source chapter/passage; leaving comparison restores its reader and camera origin. |
| R4 | Chapter objects have improved approach/inspection framing and pickable hover feedback. Overview/layout actions are distinct and reversible. Same-source reopening retains scene/camera choices in private memory, cleared by existing source/access invalidation. |
| R5 | Selected annotations retain chapter names with explicit perspective and passage labels. Matching reader captions and named native passage links make selection clear; Show in portrait preserves the manual camera and returns to the exact source. Occluded or oversized labels transfer focus to the native link, and enlarged native choices stack. |
| R6 | A separate desktop footer exposes reading continuation, original-image inspection and comparison. Wrapped controls reserve their own space; the pane restores its scroll only after its header and footer dimensions are established. Narrow layouts keep page scrolling and keyboard focus survives the transition. |

The [component design contract](../../apps/web/src/components/portrait-explorer/DESIGN.md#scene-navigation-and-chapter-displays) records the current interaction and retention policy. The local R4 implementation note at the end of this document records its validation.

All remaining work must also preserve:

- Complete, unchanged source prose, uncertainty, chapter identity and verified asset bindings; no inferred compatibility, diagnostic geometry or unsupported source anchors.
- Exact facet/passage links, reader positions, guided return state, camera bookmarks and full-reading round trips. Facet or passage changes must not move the camera automatically.
- Private session invalidation on source replacement, access loss and deletion, including protection against late renderer cleanup restoring cleared data.
- Visible-geometry picking, label occlusion/collision limits, named native alternatives, unobscured keyboard focus, reduced motion and rendering that stops at rest.
- Renderer disposal and context release, graphics failure/retry recovery, all named chapter entry choices, sticky phone/account navigation and comparison readability.

## Outstanding verification and release work

| Item | Current evidence / remaining work |
| --- | --- |
| Full repository suite and merge gate | The September 8 `npm run ci:local` passed all 14 lanes on the integrated, uncommitted source based on `e4ba2f9`, including 2,525 API tests, the compatibility lane and 721 web tests. See the [actual summary](artifacts/2026-09-07-portrait-r1-r4/verification/ci-local-summary.txt), [gate receipt](artifacts/2026-09-07-portrait-r1-r4/verification/review-gate.json), and [subsequent packaging checks](artifacts/2026-09-07-portrait-r1-r4/verification/packaging-checks.json). Runtime and test bytes are unchanged by the documentation/artifact packaging. Preserve this evidence when publishing the change. |
| Coverage beyond local Chromium | The recorded browser checks used fictional preview data and intercepted account responses with SwiftShader on their stated September 7 source snapshots. They are historical browser evidence; the later integrated source has automated-suite verification. Live account generation, Safari, physical-device performance and real screen-reader use remain unverified. |
| Production adoption | The implementation and evidence were pushed in commits [`4394e9c`](https://github.com/henryperkins/patternlike-app/commit/4394e9c7380c51c19efa1e78d73d81f94ec45992) and [`c991c8a`](https://github.com/henryperkins/patternlike-app/commit/c991c8a832454aab4418e812d9db4644ab34dea2) on September 8. Production build completion and adoption of these follow-ups were not verified in the push or branch-cleanup task. |

The remaining items are verification and release gaps, not additional reproduced product defects. The September 8 full gate supersedes the earlier timed-out repository test. Historical R4 source hashes and browser measurements remain attached to their original checkpoint; they are not represented as measurements of the later default-observatory source. Documentation/artifact packaging was checked separately while preserving the tested runtime and test files.

## Original audit order and R1–R4 evidence

The table and R1–R4 findings below record the original audit, before their local remediation. They are retained for provenance, not as the current unresolved list. Audit baseline: `6e706741f03253f2807d33380afb529161f3481f`; original primary component SHA-256: `a9b6bfd8962f13fce974e4cb6099f1be059e914f0342eaf3e6a5751e4c44f738`.

| Order / ID | Priority | Remaining work | Classification |
| --- | --- | --- | --- |
| 1 — R1 | P1 | Put Pattern / sky transitions into browser history | Reproduced navigation defect |
| 2 — R2 | P1 | Keep named chapter navigation, scene access and reading return visible | Reproduced layout/navigation gaps; merges three original priorities |
| 3 — R3 | P1 for the spatial-reader brief | Restore a deliberate two-object comparison experience | Confirmed gap against the original interaction specification; conflicts with the newer documented text-only comparison |
| 4 — R4 | P2 | Improve object framing and define consistent overview/reopen behavior | Mixed: framing refinement, confirmed presentation-state reset, and interaction decisions |
| 5 — R5 | P2 | Retain chapter identity and strengthen source-bound facet feedback in the scene | Confirmed label/feedback limitation; no geometry-morphing requirement |
| 6 — R6 | P2 | Make desktop reading continuation and image/compare actions discoverable | Previously measured reader affordance gap |

At the audit baseline, R1 and R2 were reproduced defects; R3 identified a conflict between the original spatial-comparison requirement and the then-current text-only design. The P1 label did not claim a data-loss, privacy, or availability incident. R1–R4 have since been addressed locally as described above.

### R1 — Browser history must return from Your sky before undoing the reading

**Evidence:** Select chapter 1 → Tensions → Your sky → native Browser Back. Sky remains selected, its Sun reader stays visible, and the opaque portrait history index changes from 2 to 1. Selecting Your Pattern then reveals Overview. The sky transition never created a history entry. This is distinct from Whole portrait → Back, which correctly restores the prior reading.

`PortraitExplorer.tsx:96,150` holds `skyView` in local component state; the reducer and `use-explorer-navigation.ts` own chapter/facet/presentation history separately.

**Scope:** Include Pattern/sky and selected sky body in the navigation model with deliberate push/replace rules. Preserve the existing account-route boundary and keep private content out of browser history/URLs. Camera steps, lighting adjustments and hover must not add history entries.

**Acceptance:** Tensions → sky → Back returns to the exact originating chapter, facet, passage and presentation; Forward returns to sky. Explicit Your Pattern/Back to Pattern and native history agree. Repeat from phone reading and comparison, and verify eventual exit to the surrounding account route without extra or skipped entries.

Sources: A, B, C; fresh browser reproduction.

### R2 — Make the chapter journey visible in the first viewport and during reading

This combines the original object-discoverability/navigation work, phone-transition clarification and duplicate-introduction cleanup. Include these as one coordinated layout change rather than three independently added controls.

**Original measurements, fictional preview before remediation:**

| State | Observed result |
| --- | --- |
| Desktop entry, 1440×900 | Chapter rail y=834.2–910.8; its full height does not fit |
| Desktop chapter selected | Added workbench controls push the rail to y=888.2–964.8 |
| Phone entry, 390×844 | Named chapter rail begins at y=840.8; four visible scene labels use ordinal controls |
| Phone introductory “Begin with…” | Page scrolls to y=910 while still in Explore; canvas ends at viewport y=−323.3 |
| Standalone phone Read chapter | Canvas is deliberately hidden; Return to portrait begins at y=−137.3 and moves farther off-screen during reading |
| Account phone Read chapter | Return to portrait remains pinned at y=130, including after a 250px page scroll |
| Short landscape, 844×390 | Inline scene is 480px tall and ends at y=640; the expanded scene fits at 296px tall with chapter controls visible |

**Scope:** Keep four named chapter choices and usable camera controls visible with the opening artifact. Preserve that navigation after selection. Use the existing Scene options disclosure to subordinate atmosphere and furniture choices; remove the two equivalent mobile introductions. Keep the selected chapter's identity and a reliable Return to portrait action visible during reading. Preserve the account's existing sticky navigation rather than replacing it with the weaker standalone behavior. Make inline landscape dimensions respond to available height.

Resolve the primary action's destination explicitly: an Explore action should approach the chapter with the model available; a Read action may reveal prose or enter reading presentation. The current CTA successfully scrolls to prose, but that is insufficient for the older Explore contract. Do not force all scene taps into reading; body selection remains spatial exploration. Keep the Pattern introduction about its chapters and the sky switch available without repeating a second primary introduction.

**Acceptance:** At 1440×900 and 390×844, the initial artifact, all four named chapter choices and scene controls are visible without document scrolling. They remain easy to reach after selection. On phone reading, selected identity and return remain visible while prose scrolls. At 320px/enlarged text and short landscape, preserve readable controls and vertical reachability without horizontal overflow or obscured focus.

Sources: A, B, C; original local priorities 1–3; fresh preview and account measurements. The claim that all phone labels are hidden is superseded; the lack of visible *names* remains.

### R3 — Reconcile and deliver spatial comparison alongside complete text

**Evidence:** Current comparison sets `.explorer-workspace.explorer-is-comparing > .explorer-visual` to `display:none` (`observatory.css:58`). The two-facet reader remains complete and readable. A's observation matches current source; C's visible courtyard with non-compared labels reflects a different state/version and is not the current defect.

The original `2026-09-06-pattern-portrait-experience-redesign.md:104` requires framing two selected contributions with persistent identities. The newer component `DESIGN.md:171` expressly documents hiding the scene for wide text comparison. These requirements conflict; do not silently treat the current layout as an accidental CSS mistake.

**Recommended direction:** Provide an explicit comparison presentation with exactly the selected pair framed and named, alongside their complete matching-facet text. Use a readable stacked arrangement where two columns plus models cannot fit; preserve access to full reading. De-emphasize or exclude other stations from the comparison focus without inventing a relationship between the selected chapters. Update the conflicting design documentation with the chosen behavior.

**Acceptance:** Both selected object identities and both complete chosen facets are clear; facet changes update the pair; annotation links retain their exact chapter/passages. Exiting restores the originating reader and camera context. No inferred compatibility, diagnosis or generated connection appears.

Sources: A, C; original interaction specification and newer local design documentation. This is a design-contract gap, not a claim that the text comparison is broken.

### R4 — Improve object inspection and make overview/reopen behavior predictable

**Keep the verified behavior:** Look closer is functional. In the fresh compass capture it visibly enlarges the selected object; `observatoryFrame` fits selected bounds with offsets of 1.5 for approach and 1.05 for inspection. Whole portrait from unfolded inspection visibly returns to a wide court view. Neither action reproduced the reported no-op. These checks covered the compass; they do not prove ideal inspection of every chapter object or every camera bookmark.

**Remaining work:** Improve default chapter framing and hover affordance so the selected object is the subject, with a clear pointer over pickable geometry. Check all four models, including occlusion and restricted views. Make the difference between current-state camera reset, whole-court overview, unfold/reassemble and object inspection clear. Unfold currently retains selection and inspect, so it can show one separated station rather than all four. Whole portrait retains unfolded state; automatic reassembly would be a behavior change to decide explicitly, not a repair for demonstrated state loss.

On account close/reopen, chapter/facet state and verified blobs survive, but the component's sky, lighting, desk and inspect state reset. A fresh check retained Resources while resetting Dusk, an open desk, inspection and sky mode. Camera bookmarks are also component-local by source inspection; no manual-camera close/reopen measurement was made in this pass. Full-reading round trips are a separate lifecycle and should keep their existing successful restoration.

**Scope:** Define what the user should retain for the same source revision across close/reopen, then align camera/scene state with that expectation. If retained, keep it in private session memory and clear it on the existing source/access invalidations. Clarify the second mesh tap's desk operation; it is already documented, not an accidental duplicate-selection handler.

**Acceptance:** Selection and Look closer give useful object views for all four chapters. Whole portrait reliably shows the full court without losing reading history. Assembly and inspection controls have distinct, observable outcomes. Reopen follows the documented retention policy; a different source or lost access clears private state. No new continuous animation or scene verbs are needed.

Sources: A, B, C; original local priority 1; fresh compass/overview captures and account lifecycle check.

## Remaining interaction work

### R5 — Preserve the selected chapter title and make facets legible in the scene

**Status: implemented locally, P2.** Ordinary and comparison annotations now retain the chapter name above the perspective and explicit passage number. Matching reader captions, per-chapter live announcements and named native passage links expose the same selection. Show in portrait focuses that source anchor without issuing a camera command; repeated actions and returns from reading preserve their context. Label placement respects available space and occlusion, with native focus fallback and enlarged-text stacking. Source prose and saved mesh geometry remain unchanged. This implementation does not establish production adoption.

**Original limitation:** In ordinary single-chapter exploration, the selected visible title was replaced by an annotation chip such as “● Tensions · 1.” Its accessible name still included the chapter, and the exact passage link worked. Before R5, the label branch in [PortraitScene.tsx](../../apps/web/src/components/portrait-explorer/PortraitScene.tsx) rendered the chapter-title span inside an annotation only when comparing. R3 already preserved both comparison names. The renderer used `facet` for annotation content without selecting a different pose or mesh-feature emphasis for each facet; R5 retains this source-bound geometry policy.

**Scope:** Keep a visible chapter title with the active facet/passage as secondary information. Strengthen the selected chapter/anchor emphasis and the return between annotation and passage. Facet-specific annotations or views must be bound to actual source content. The original specification permits one chapter-level anchor where there is no justified feature-level metaphor; do not invent extra anchors, cracks, strength scores or diagnostic geometry just to create motion. Do not move the camera automatically while someone is reading.

**Acceptance:** At every supported size, the selected object can be identified by name, with its chapter-title annotation visible when geometry and available space permit and its named native alternative retained when the label is occluded or cannot fit. Facet and active-passage changes are understandable in the scene and reader, and both link to unchanged source prose. Preserve the four-label budget, keyboard focus, reduced motion and camera stability while reading. Verify ordinary exploration and comparison at 1440×900, 390×844, 320px with enlarged text and 844×390, including Show in portrait and return to the exact passage.

Sources: B, C; A's working passage-loop evidence; current source. This is an interaction-quality gap, not a requirement to mutate the authored mesh.

### R6 — Make desktop reading continuation and actions discoverable

**Status: implemented locally, P2.** Desktop reading now scrolls above a separate footer containing original-image inspection and comparison. More to read and Continue reading make overflow explicit; Back to start is available at the end. The footer reserves its own space, including the larger wrapped continuation state during restoration, and the pane accounts for measured navigation and title rows. The original reader element and per-perspective position memory remain in place. Narrow and comparison layouts keep page scrolling; a continuation control losing visibility transfers focus to the reader. Comparison also refreshes replaced scene controls when the canvas size is unchanged, preserving the manual camera projection on return. This implementation does not establish production adoption.

**Original limitation:** The account Overview reader was measured at 722px high with 938px of content; its image/compare action row began below the visible reader boundary. Those dimensions are historical. Before R6, `.explorer-reader-actions` followed the chapter text inside the bounded scrolling reader in [PortraitExplorer.tsx](../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx). R4 checks confirmed image inspection and comparison worked, but did not resolve discovering their controls or the reading continuation.

Add a clear continuation affordance or a distinct accessible footer for these actions. If sticky, reserve space so it cannot cover prose or focus. Keep full-reading access, complete chapter fields and per-facet reading positions.

**Acceptance:** Users can recognize that more reading/actions are available, reach image inspection and comparison with pointer or keyboard, and return to the same passage and per-facet scroll position. Verify standalone and embedded readers at standard desktop, short viewports and enlarged text. A footer must reserve space for wrapped actions and focused controls without covering prose. Preserve the R2 sticky phone/account return controls and the R3 comparison presentation and return context.

Source: original local priority 4, retained; not contradicted by the Cursor extracts.

## Small follow-ups after the main interaction work

| Follow-up | Evidence and scope | Completion criteria |
| --- | --- | --- |
| P3 — Contextual wording | [account-portrait.ts](../../apps/web/src/lib/account-portrait.ts) still says “This constellation no longer matches the current Pattern” in a shared validation error used by the portrait flow. Align portrait/observatory terminology while preserving legitimate legacy constellation copy. | The observatory's stale/error/recovery states use appropriate names; validation still rejects mismatched sources and recovery actions retain their behavior. |
| P3 — Scene-wrapper semantics | [PortraitExplorer.tsx](../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx) labels `.explorer-scene` with `aria-label="Interactive Pattern portrait"` on a generic `div`. | Use an appropriate role or remove the unsupported redundant label; verify the canvas description, native controls, keyboard order and focus behavior remain available. |
| P3 — Design-token triage | The original broad detector pass reported 107 advisories; the later scoped R4 pass reported two pre-existing scene-color advisories. Neither count measures confirmed UI defects. Inspect computed styles against [DESIGN.md](../../apps/web/src/components/portrait-explorer/DESIGN.md) before changing tokens. | Resolve only demonstrated drift or record intentional exceptions, with rendered checks for contrast, focus, text wrapping and layout. Preserve authored scene material distinctions. |

Optional evaluation: guide progress through facets and whether guide entry should inherit desk/layout choices. Preserve the existing manual guide, reversible guided history and documented second-tap desk operation. These are not established release blockers; R4 already clarified the desk interaction.

## Reconciliation of supplied reviews — historical baseline

At the original audit, the text supplied in chat was the available review source. The referenced full files and `/opt/cursor/artifacts` screenshots were not in the checkout, and the authenticated Cursor pages were not readable. The [September 8 integration](2026-09-08-branch-cleanup-and-review-integration.md) now preserves all three full reports and their Git-tracked captures; it does not repeat their browser sessions. The dispositions below describe the original audit baseline; current status is listed at the top of this document.

| Source | Supplied report identity | Revision / scope |
| --- | --- | --- |
| A | `2026-09-07-portrait-3d-interaction-workflows.md` | Claims live preview at `6e70674` |
| B | `2026-09-07-3d-model-ui-workflows.md` | Claims preview at older `76b4671`; account reviewed from source only |
| C | `2026-09-07-3d-model-interaction-ui-workflows.md` | The original extract supplied no commit; the recovered full report identifies `76b4671`. Several observations differ from later main. |

| Review claim | Disposition at the original audit baseline |
| --- | --- |
| Native Back leaves sky visible and undoes a facet underneath | Reproduced; R1. Does not reinstate the withdrawn Whole-portrait state-loss claim |
| Named chapter navigation is below/clipped by the fold | Reproduced at specified desktop/phone sizes; R2 |
| All phone scene labels are hidden | Superseded: all four compact ordinal labels were visible at entry; names still depend on the rail |
| Primary phone Explore CTA scrolls the canvas away | Reproduced; clarify destination as part of R2 |
| Read chapter should keep canvas visible | Canvas hiding is intentional; the actionable gap is identity/return/navigation continuity, R2 |
| Return to portrait disappears | Reproduced in standalone preview; account return remains pinned |
| Comparison leaves all station labels visible | Not current: scene is now hidden. Retain the spatial-comparison requirement gap as R3 |
| Look closer cannot inspect / always keeps whole courtyard | Not reproduced for the compass; real zoom observed. Retain all-model framing quality work as R4 |
| Whole portrait is byte-identical/no-op after unfolded inspection | Not reproduced after settling: wide-court capture differs visibly and by hash. Unfolded retention is real; R4 defines the intended semantics |
| Facets only change an annotation caption; title disappears | Source-confirmed; R5, with source-bound emphasis rather than mandatory mesh morphing |
| Pattern home still says “Your sky. Your story, unfolding.” | Superseded: heading is “Your Pattern, in four chapters.” Further hierarchy refinement belongs to R2 |
| Account reopen downloads all four images and models again | Rejected on current main: request count stayed at eight across close/reopen |
| Account reopen restores reading but not sky/desk/inspect | Confirmed; R4. Camera bookmark locality is source-confirmed, not freshly measured with a manual pose |
| Landscape scene exceeds window | Inline 480px scene reproduced; expanded scene now fits. Scope R2 to inline sizing |
| Second mesh tap toggles a desk | Confirmed and explicitly documented; clarify if needed, not a standalone bug |
| Wheel scroll should zoom the embedded canvas | Not adopted: page scrolling is an intentional interaction/accessibility constraint |

## Original audit verification receipts and limits

- [Preview browser results](artifacts/2026-09-07-portrait-r1-r4/review-merged/results.json): 1440×900, 390×844 and 844×390; original fictional meshes, real WebGL, reduced motion enabled to inspect settled destinations. The immediate DOM measurements and subsequent settled captures serve different purposes; raw label projections immediately after camera changes are not treated as final camera evidence.
- [Account browser results](artifacts/2026-09-07-portrait-r1-r4/review-merged/account-results.json): real account components with intercepted fictional responses and the previously compiled/hash-validated test shapes; eight asset requests before and after reopening, retained Resources, reset scene preferences, visible sticky return, no page JavaScript errors. Synthetic account shapes are not used to judge artwork quality.
- [Chapter approach](artifacts/2026-09-07-portrait-r1-r4/review-merged/chapter-canvas.png), [Look closer](artifacts/2026-09-07-portrait-r1-r4/review-merged/inspect-canvas.png), [whole court after unfolded inspection](artifacts/2026-09-07-portrait-r1-r4/review-merged/whole-after-inspect-unfold-canvas.png), [comparison](artifacts/2026-09-07-portrait-r1-r4/review-merged/comparison.png), [phone entry](artifacts/2026-09-07-portrait-r1-r4/review-merged/phone-entry.png), [standalone phone reading](artifacts/2026-09-07-portrait-r1-r4/review-merged/phone-reading-scrolled.png), [account reading return](artifacts/2026-09-07-portrait-r1-r4/review-merged/account-reading-return.png), [expanded landscape](artifacts/2026-09-07-portrait-r1-r4/review-merged/landscape-expanded.png).
- Screenshot hashes distinguish captured frames; they do not on their own prove semantic geometry changes. Screenshots clipped to canvas bounds still include DOM overlays visible in that rectangle. Facet geometry behavior was checked in source rather than inferred from a screenshot hash.
- Node 22.23.2, cached Chromium 1234, Playwright 1.62.1, SwiftShader. The local server used port 5184; it and all browsers were stopped after verification.
- This was review consolidation and targeted verification. No app edits, production/provider calls, commits, merges or deployment occurred. No aggregate CI gate was required or claimed. Live account generation, Safari, physical-phone performance and real screen-reader use remain unverified.

## Local R4 implementation update — 2026-09-07

R4 is implemented locally on top of the existing R1–R3 remediations. The original audit and measurements above remain a record of the earlier state. The current interaction and retention policy is documented in the component [design contract](../../apps/web/src/components/portrait-explorer/DESIGN.md#scene-navigation-and-chapter-displays).

- Chapter approach and inspection use tighter physical-bound framing, with an elevated view for shallow objects. Visible pickable geometry shows a pointer. Turning an object only adjusts the camera when the turn would newly clip it; it preserves the orbit angle, wider views and deliberately cropped views.
- Reset view refits the current subject. Whole portrait refits all four displays in the current layout. Unfold and Reassemble change the layout and show all four in one reversible navigation step, preserving the originating chapter, facet, passage, guided stop and camera context.
- Same-source account close/reopen and route remounts retain navigation, reading positions, lighting, roof, desks, object turns, inspection and camera bookmarks in private session memory. Existing source/access/deletion invalidation clears that memory, including protection against late renderer cleanup restoring cleared bookmarks. Graphics quality, motion overrides and disclosures remain mount-local.
- Existing source prose and identity, sky navigation, spatial comparison, native controls, reduced motion and renderer disposal remain covered by regression checks. R5's selected-title/facet feedback, R6's desktop reader affordances and the P3 follow-ups remain open.

Verification on unchanged application source: all repository typechecks passed; the web build passed; the full web suite passed **704 tests in 52 files**. Local Chromium checks passed **128 preview camera/navigation checks**, **27 account-session checks** and **12 standard-graphics interface/recovery checks**, with no page errors. Preview coverage used the four original fictional models at 1440×900, 390×844, 320×844 with enlarged text, and 844×390; account coverage used intercepted fictional responses and validated test shapes. This is local browser evidence, not production or physical-device verification.

At this September 7 checkpoint, the full repository `npm test` attempt timed out after 300 seconds in the API Worker lane and was **not a passing full-suite result**. The `ci:local` merge gate had not passed, and no commit, push, merge or deployment had occurred. The September 8 passing gate above supersedes that verification gap; these browser measurements retain their original source and scope.

The [original R4 verification receipt](artifacts/2026-09-07-portrait-r1-r4/r4/verification.json), [source hashes](artifacts/2026-09-07-portrait-r1-r4/r4/source-sha256-final.txt), browser results and supporting logs are preserved in the evidence archive.
