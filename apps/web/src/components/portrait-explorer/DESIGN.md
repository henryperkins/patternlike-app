---
name: Pattern/Like zodiac observatory
description: A calibrated natal zodiac instrument and a reading station for every published chapter, with optional saved artwork and complete native reading.
colors:
  forest: "#173f35"
  forest-light: "#dce7df"
  ink: "#17312a"
  ink-soft: "#4e625b"
  paper-light: "#faf8f2"
  paper-deep: "#e5dfd1"
  rule: "#cec7b8"
  focus: "#234c9f"
  scene-control: "#153c33f2"
  scene-control-text: "#fffaf0"
  limestone: "#c8bfaa"
  stone-edge: "#968d79"
  lime-plaster: "#ded4bb"
  oak: "#705137"
  oak-endgrain: "#a17b4d"
  bronze: "#ad8950"
typography:
  heading:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontWeight: 400
    lineHeight: 1.17
    letterSpacing: "-0.035em"
  reading:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
  navigation:
    fontFamily: "Avenir Next, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  square: "0px"
  subtle: "2px"
spacing:
  compact: "6px"
  small: "8px"
  control: "12px"
  reading: "18px"
  section: "24px"
components:
  button-primary-account:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper-light}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "13px 20px"
  button-control:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.subtle}"
    padding: "8px 13px"
  button-control-selected:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper-light}"
    typography: "{typography.control}"
    rounded: "{rounded.subtle}"
    padding: "8px 13px"
  button-scene:
    backgroundColor: "{colors.scene-control}"
    textColor: "{colors.scene-control-text}"
    typography: "{typography.control}"
    padding: "8px 12px"
  facet-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "10px 0"
  chapter-navigation:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    padding: "10px 8px"
  graphics-select-account:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.control}"
    rounded: "{rounded.square}"
    padding: "0 8px"
  reading-passage:
    textColor: "{colors.ink}"
    typography: "{typography.reading}"
    padding: "0 0 0 13px"
  observatory-view:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.square}"
    padding: "8px 14px"
  sky-placement:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "8px 12px"
---

# Design System: Pattern/Like zodiac observatory

## Overview

**Creative North Star: "The Private Observatory"**

This local surface inherits the brand authority of [the application design system](../../../DESIGN.md) and the calm, precise, private voice in [PRODUCT.md](../../../PRODUCT.md). Warm paper and forest ink frame a stylized WebGL courtyard: limestone terraces, timber screens, perimeter planting, a bronze twelve-sign instrument over the water court, and a display for every chapter. The instrument replaces the central tree and gives the architectural model a celestial focal point.

The setting remains authored presentation furniture. Calculated natal placements arrive as separate, minimized chart context; personalized portraits retain their saved chapter meshes, original images, and complete prose. The fictional study identifies its example chart facts and fixture objects. Neither architecture nor zodiac selection creates relationships between chapters. The [zodiac direction contract](../../../../../docs/superpowers/specs/2026-09-06-zodiac-observatory-design.md) extends the [courtyard brief](../../../../../docs/superpowers/specs/2026-09-06-portrait-observatory-design.md) within the authorized local redesign; the composition is an implementation decision, not a separately approved concept.

**Key Characteristics:**

- A celestial court with distinct Your Pattern and Your sky views.
- Light serif interpretation, compact sans-serif controls, and warm ruled paper.
- Calibrated Sun, eligible Moon, and eligible rising markers with native facts and uncertainty.
- Three to six approachable displays with object turns, hinged desks, and visible lanterns.
- Complete native reading and controls remain usable independently of graphics.

## Colors

The inherited ink-and-paper palette surrounds warmer architectural materials; the scene's lighting changes their appearance without changing their source colors.

### Primary

- **Observatory Green** (`forest`) marks pressed environment controls and account primary actions; **Washed Observatory Green** (`forest-light`) marks account hover and selected chapter states. **Ink Green** (`ink`) carries headings and operational text.
- **Scene Control Green** (`scene-control`) and **Scene Control Paper** (`scene-control-text`) keep the camera bar and overview actions readable over changing scenery.

### Secondary

- **Oiled Oak**, **Oak End Grain**, and **Brushed Bronze** (`oak`, `oak-endgrain`, `bronze`) repeat across screens, canopies, plinths, desks, fixtures, and the zodiac instrument. The dial adds a dark inset and polished bronze edges; its gold Sun, pale Moon, and green rising markers identify the three available body types without introducing a new application palette.

### Tertiary

- **Focus Cobalt** (`focus`) marks keyboard focus on paper. Scene controls use a light paper outline; forced-colors mode uses the system Highlight color.

### Neutral

- **Clean Drafting Paper**, **Layered Drafting Paper**, **Soft Ink**, and **Graphite Rule** (`paper-light`, `paper-deep`, `ink-soft`, `rule`) organize the reader, lighting selector, hints, and dividers.
- **Warm Limestone**, **Cut Stone Edges**, and **Lime Plaster** (`limestone`, `stone-edge`, `lime-plaster`) establish terrace, plinth, wall, and canopy planes. Water, foliage, and lantern glass retain their modeled material colors in `observatory-world.ts`.

**The Authored Setting Rule.** Materials and architecture describe the place; calibrated markers show supported natal positions; personal interpretation remains in the saved chapter reading.

## Typography

The existing Iowan/Palatino/Georgia serif stack and Avenir/Segoe UI sans-serif stack remain inherited choices. This local document does not establish a replacement type identity.

- **Headings:** light serif, with the page title at a restrained fluid scale (`1.75rem` to `2.5rem`) and chapter headings at a larger reading scale (`29px` to `42px`). The introduction has its own larger invitation (`2rem` to `3.1rem`).
- **Reading:** the `reading` role holds source paragraphs; comparison reduces this to (`17px`). Summaries stay sans-serif (`15px`, `1.8` line height).
- **Controls and supporting copy:** use the `control` and `body` roles. Chapter metadata is sentence case below the heading. Keep complete titles readable in the native chapter rail.
- **Sky facts:** body names and unavailable states use compact sans-serif text; sign names use the reading serif (`19px`), and the selected degree/sign uses a larger serif (`24px`). The `navigation` role distinguishes Your Pattern and Your sky without introducing another display face.

## Layout

The standalone desktop workspace pairs scene and reader (`1.85fr / 1fr`, reader minimum `300px`), with fluid gaps (`24px` to `46px`) and page gutters (`18px` to `52px`). The scene height follows available viewport space (`390px` to `590px`). The reader scrolls independently on desktop, retaining position per chapter and perspective. Complete reading uses a single centered measure (maximum `740px`).

Your sky initially frames the dial from nearly overhead, arranging all twelve sign labels around its circumference. Only the selected measured body's native label appears as a central readout; the actual marker remains at its calculated position. A three-column Sun/Moon/rising strip sits immediately below the canvas (top gap `10px`), with every available placement and each unavailable state exposed. The chapter rail and guide controls are hidden in sky view. Your Pattern restores the chapter workspace and its reading position. Orbit and visible-geometry rules still apply after the initial framing.

At (`1023px`) and below, the workspace stacks and the reader returns to page scrolling. The standalone scene is (`480px`) tall on tablets and (`345px`) below (`767px`), reducing to (`300px`) below (`359px`). Short landscape windows use a viewport-relative inline height bounded between (`260px`) and (`360px`). Phone gutters are (`16px`); chapter navigation uses two columns. All named chapter choices precede collapsed Scene options, so selecting a chapter cannot insert furniture controls above the rail. The expanded dialog allocates its height among the scene and native controls.

Read chapter hides the scene and secondary controls on narrow layouts for a single chapter. Comparison keeps its two-object scene available in both Explore and reading presentations. Sticky reading controls retain Return to portrait, the selected chapter names, and the Pattern/sky switch while prose scrolls. Their measured height, including text wrapping, reserves the focus and scroll offset; account controls stay below the host header and existing Back to reading bar. The single Pattern introduction describes the chapters. Explore the first chapter approaches its object, focuses its named chapter button, and brings the scene into view; Read chapter enters prose. Pattern uncertainty remains complete at the start of the reader and in Full reading.

Account embedding inherits the host's paper, navigation, and content width. Container rules stack it below (`859px`), size the scene between (`240px`) and (`345px`) according to viewport height, reduce the chapter rail to two columns below (`539px`), and wrap the camera bar into three columns below (`319px`). Comparison pairs a scene of the two selected displays with both complete source facets. At standalone widths of `1200px` and above, or account container widths of `1100px` and above, the scene stays beside the reader; narrower layouts stack the scene above it. Its `17px` serif reading columns have a `45ch` minimum capped at the available width, stacking when two columns cannot fit. Comparison chapter headings use the same `25px` role in standalone and account views; summaries retain the `15px` sans-serif role. The sticky comparison strip retains End comparison, Read both chapters, View objects, both chapter names, and the Pattern/sky switch. General camera, motion and graphics settings remain available below the two named chapter links; furniture controls are confined to the normal courtyard.

On canvases below `520px` wide and `420px` tall, unselected visible objects use `44px` ordinal controls matching the chapter rail. Compact controls move to the nearest free space; full labels retain their collision rule. Both respect occlusion and keep complete accessible chapter names.

## Elevation & Depth

Paper controls use fine borders and tonal selection. Scene labels have no drop shadow in this local surface. Architectural depth comes from geometry, rough stone and timber, metallic bronze, modeled water rings, environmental light, and cast shadows. The inherited image/expanded dialog retains modal elevation; that shadow is a dialog treatment, not a general card style.

Daylight is the initial viewing condition. Dusk lowers the scene light and ambient contribution, changes the sky/fog, and brightens the modeled lanterns; it does not change natal facts. Roof cutaway starts open. Showing the roof restores opaque canopy geometry: picking and label placement respect visible occlusion, with native controls retaining access.

**The Visible Surface Rule.** Scene picking and annotations respect the architecture in front of them; native navigation carries access when an object is occluded.

## Shapes

The interface retains restrained rectangular controls and fine rules; environment controls and scene labels use the `subtle` radius. Account embedding keeps the inherited square controls except where the local observatory override applies. Circular chapter ordinals indicate sequence. The terrace, water court, display plinths, zodiac sectors, and armillary hoops use circular geometry as actual objects. Timber slats, rectangular canopy planes, and folio desks provide the contrasting straight forms.

## Components

### Zodiac instrument and natal context

The instrument places twelve sign sectors and five-degree calibration ticks on a bronze dial (radius `1.42`, surface near `y=0.85`). Raised armillary hoops establish the court's silhouette; focused sky inspection hides the hoops and their supports. Longitude is calibrated clockwise from negative z: zero degrees points to negative z and ninety degrees to positive x. Sign names are native DOM labels at sector midpoints, not generated text textures.

Sun, Moon, and rising occupy separate radial lanes so equal-longitude placements remain individually selectable. Their angular positions come from the supplied longitude. Selecting a body emphasizes its marker and actual sign sector. Lanes, marker shapes, sizes, and the Moon icon identify controls; they do not depict planetary distance, scale, or Moon phase. When no validated sky context is available, a saved Sun sign highlights its whole sector and reports the missing exact position; it never creates a longitude, degree, or marker. A body missing from an available chart stays unavailable in both the dial and native controls.

The `PortraitSky` projection is separate from the immutable portrait manifest and saved GLBs. It requires an active chart with matching identity and contains only the supported placements, permitted house/retrograde data, qualification, accuracy, uncertainty, unavailable reasons, and chart identity needed for validation. Birth values, location, timezone, account identifiers, fingerprints, provider packets, and internal evidence aliases are not copied into this display context.

Unknown birth time removes Moon and rising. Suppressed `moon_time_sensitive` removes Moon; suppressed angles or a missing/non-finite ascendant remove rising. House numbers require known time, available unsuppressed houses, and a valid number. Approximate time and supplied qualification conditions remain visible. An unavailable placement is a native explanatory state rather than a fabricated point on the dial.

**The Calibrated Fact Rule.** Plot only supported longitude, preserve its qualification, and use a whole-sector fallback when only a saved Sun sign is available.

### Scene navigation and chapter displays

Your Pattern returns to the existing chapter selection, perspective, and reader position. Opening the sky from phone reading temporarily shows the scene while retaining the reading history, including comparisons; Back to Pattern restores that reading context. Choosing an object or named chapter approaches that display. The approach centers the object with a smaller allowance for its plinth and folio; shallow objects get an elevated view based only on their physical bounds. Look closer selects a separate inspection framing; Step back restores the approach bookmark. Reset view refits the current chapter, inspection, comparison, sky or overview. Whole portrait always refits all chapter displays in the current assembled or unfolded layout, including when already in overview. These camera commands leave the reader's facet and passage choices intact. View bookmarks distinguish sky, chapter selection, assembly, and inspection. Navigation uses chapter destinations and orbit controls.

Entering sky adds one browser-history step with the originating chapter, facet, active passage, and presentation preserved in private session memory. Selecting a different sky body updates that visit without adding extra Back steps. Your Pattern and Back to Pattern unwind any presentations opened within that sky visit before returning to its Pattern origin; native Back traverses those same steps individually. Closing an expanded sky retains its current body choice. Forward restores the saved sky visit. A new reading opened after a return creates its own history entry after the return completes, preserving every earlier chapter step. Camera steps, lighting, and hover remain outside navigation history. Browser state contains only an opaque scope and index, never chapter text or sky facts. Account close/reopen and route remounts retain navigation, reading positions, lighting, roof cutaway, per-chapter desks and turns, inspection choice and camera bookmarks for the same source. The scene cache compares the manifest with `sunSign` set to null and per-chapter `object` bindings omitted, so optional artwork delivery does not replace the reading's session identity. It stays in private session memory, with no localStorage, sessionStorage, URL or history serialization. A replaced source or session starts fresh; existing access/deletion invalidation clears scene memory, and late renderer cleanup cannot restore cleared bookmarks. Graphics quality, motion controls and disclosure state remain mount-local; operating-system reduced motion still applies on entry.

Comparison is a deliberate view of two saved objects, replacing the former text-only comparison layout. The first chosen chapter sits on the left and the second on the right in the initial camera view, matching reading order. Their original meshes, turns, plinths, desks and lanterns retain their identity; the unselected chapter displays, courtyard architecture, roof and zodiac instrument are temporarily excluded. A camera-space fit includes both complete displays. The arrangement expresses reading order only, and introduces no connection, compatibility score or new interpretation. Facet changes update both complete readings and their source annotations without moving the camera.

Each comparison object keeps its chapter name and an exact chapter/facet/passage link. Every paragraph in either column can return to that object's annotation without ending comparison. Expanded scene annotations close the expansion and focus the corresponding paragraph in the preserved pair. Native named links keep each reading reachable when graphics are paused or a label is occluded. Ending comparison restores its originating chapter, facet, active passage, reader position and camera bookmark; courtyard, roof, assembly, desk, lighting and inspection choices remain as they were. Sky Back/Forward, Full reading and account session invalidation continue to use the existing private navigation controller.

Annotation placement observes text-size and wrapping changes without moving the camera. A comparison label that cannot fit clear of the objects and controls defers to its named native chapter link; that link also receives keyboard focus and Show in portrait actions when needed. Its scroll offset respects the sticky navigation. Reduced-motion CSS disables explorer transitions completely so grid and text resizing cannot clamp the restored reading position.

Turn chapter object rotates the selected loaded object's wrapper in (`45-degree`) increments without changing its source geometry. If an explicit turn would newly clip the object, it recenters its physical bounds and backs the camera up as needed, keeping the current orbit angle and any wider view. A turn that already fits leaves the camera untouched, as does a view the user had already cropped with the camera controls. Facet and passage changes do not trigger this fit. Open reading desk rotates that station's lid around its hinge (open angle `-1.25` radians); selecting an already selected visible object toggles the same desk, as explained beside the controls. Desk state and turn count are retained per chapter in private session memory and discarded on source identity replacement. The desk is a visual interaction, not a gate on reading. Visible pickable geometry has a pointer cursor; empty or occluding surfaces retain the grab cursor, with grabbing feedback during orbit gestures. Roof cutaway remains an explicit choice, and native chapter controls retain access under a closed roof.

Unfold portrait and Reassemble move each object, plinth, desk, and lantern together and frame all chapter displays; furniture follows the object's position on every rendered frame. In ordinary exploration, changing layout and entering overview is one history step, so Back restores the preceding chapter, facet, passage, assembly and camera context. Inspection is dormant while in overview; returning to its originating chapter restores that view. Expanded presentations retain their existing return semantics. Camera travel uses bounded transitions (`420ms` for approach/reset, `540ms` for unfolding, `260ms` for camera steps). Reduced motion places objects, desks, and camera directly at their destinations. Rendering stops at rest and pauses while the document is hidden.

**The One Display Rule.** Object, plinth, desk, and fixture share the unfolding trajectory; their visual connection must survive every frame.

### Controls and accessible navigation

Environment and display buttons expose pressed state with labels and forest fill. Camera buttons use inline SVG paths with accessible names; pointer gestures have matching native controls. Scene and workbench actions retain (`44px`) minimum targets. The compact lighting pair's smaller minimum is an existing exception, not a reusable target-size standard. Visible focus uses a (`3px`) outline and (`3px`) offset.

Your Pattern and Your sky use square native buttons with a two-pixel selected underline and layered-paper fill. The placement strip uses taller native buttons (minimum `66px`), body-specific inline SVG icons, compact body labels, and serif sign names. Unavailable bodies remain explanatory text rather than selectable empty markers. The selected dial label is a readout for the active body; the strip provides access to all placements, including coincident longitudes.

The focused camera toolbar accepts arrow keys, plus/minus, and Home. Perspective tabs support Left/Right, Home/End, selected state, and a linked tabpanel. Sky selection uses named native Sun, Moon, and rising buttons with pressed state and separate unavailable explanations; these remain usable when WebGL fails. Native dialogs trap focus, close on Escape, and return focus to the opener. One-finger vertical page scrolling remains available over the normal canvas; expanded mode enables pinch zoom. Reduced motion follows the system preference and has a manual setting. Low power limits pixel ratio and disables shadows/environment lighting.

### Chapter reader and complete reading

The reader preserves chapter title, summary, all Overview paragraphs, Tensions, Resources, and Another expression. Comparison presents the same perspective in two chapters; the guide advances only through explicit Previous/Next actions. Show in portrait connects an unchanged passage to its scene annotation, and the annotation returns focus to that source passage. Original-image inspection retains its label, rationale, chapter title, and image reference.

Full reading remains a native text view containing every chapter and perspective, additional signatures, uncertainty, and source revision. Reading and navigation do not depend on the desk being open or WebGL being available. Graphics failure displays an honest status and disables graphics-dependent controls; the scene can retry while the complete reading remains accessible. A failed scene-code import offers an explicit page reload to retrieve the current application, since retrying a deleted deployment chunk cannot restore it. Loading entry controls remain focusable, and returning from the sky reader focuses the selected chapter heading.

**The Complete Reading Rule.** Visual exploration must retain every source passage and its chapter association; the scene never substitutes for the complete text.

The sky reader shows calculated position and qualification beside an explicit return to the Pattern. It does not assign chapters or paragraphs to planets, signs, or inferred aspects. In account embedding, Open today's reading links to the existing `#today` route; this natal view neither calculates a new date nor generates daily reading copy. The Pattern introduction names its published chapters and only invites exploration of placements that are available.

Failed portrait creation exposes a status refresh alongside the complete reading. `retryable` describes pending or running automatic work; refreshing does not start generation. The observatory opens by default with a matching published Pattern, independently of generated-artwork delivery. Each chapter starts with an authored reading folio; these are navigation furniture, never a claimed personal interpretation. Verified saved models replace folios when available. The v1 artwork service still supports four-chapter Patterns and requires explicit generation consent, but neither restriction hides the room. Three-, five-, and six-chapter readings all have distinct stations and retain every passage. Artwork failures keep the room and reading available, with a separate status refresh. A deliberate return to reading is retained for the current session and source; status polls do not reopen the room or move focus.

### Resource ownership

The runtime owns its canvas, controls, observers, animation requests, environment target, shadow resources, and authored world, including the instrument's materials and geometry. The loader effect owns reading folios and downloaded model resources, aborts pending loads, and disposes completed or late models on failure, source replacement, and unmount. Static architecture and calibration ticks are merged where appropriate; desk hinges, markers, and hoops retain their required independent transforms. Asset validation retains chapter, source text, source image, mesh hash, and revision binding before display. Sky selection adds private session navigation state without changing saved GLBs, image bindings, or source prose. The setting adds geometry, not raster assets or new generation requests.

The signed-in chart session retains one portrait's fully verified image and model blobs, keyed on the exact explorer response. Reopening after a route change first validates a fresh authenticated status response and creates new object URLs; each mount revokes its own URLs. Changed source identity, failed authorization, Pattern deletion or withdrawal, sign-out, access loss and chart replacement invalidate reuse. Nothing is written to browser storage. Chapter, perspective, presentation and reading positions remain in session memory across close/reopen and route changes. Reopening rebuilds the retained path for Back controls; the session also retains prior visits so native Back and Forward restore them after a route change. Clearing the Pattern session unwinds the current visit before its history becomes unavailable.

## Do's and Don'ts

### Do:

- **Do** inherit application brand tokens and keep architectural materials local to this surface.
- **Do** preserve complete prose, original-image access, source identity, and native chapter navigation.
- **Do** separate supported natal facts from published interpretation and retain every omission and qualification.
- **Do** keep display furniture synchronized with the object and respect visible scene occlusion.
- **Do** preserve keyboard access, page scrolling, reduced motion, reading positions, and graphics fallback.
- **Do** release owned resources when the scene ends or its source changes.

### Don't:

- **Don't** present the authored court, lighting, or arrangement as personalized psychological evidence.
- **Don't** invent a longitude from a Sun sign or infer chapter-to-planet relationships, aspects, or a daily horoscope.
- **Don't** describe this stylized WebGL scene as photorealistic or a native first-person walkthrough.
- **Don't** require a scene gesture, animation, or open desk to reach the reading.
- **Don't** mutate saved mesh geometry or source prose to implement an interaction.

Observed sources: `observatory.css`, `explorer.css`, `ObservatoryControls.tsx`, `SceneIcon.tsx`, `observatory-world.ts`, `zodiac-instrument.ts`, `PortraitScene.tsx`, `PortraitExplorer.tsx`, `SkyReader.tsx`, `ExplorerReader.tsx`, `content.ts`, and `../../lib/portrait-sky.ts`. The prior desktop, phone, chapter, and dusk captures establish the courtyard context; this zodiac update records the current local source. It does not establish production deployment, a live signed-in account flow, or performance on physical GPU hardware. The matching `.impeccable/design.json` carries motion, breakpoints, component snippets, and synthesized panel swatch ramps; those ramps do not add active UI tokens.

Not canonized: inherited uppercase micro-labels and glyph adornments, the compact lighting target-size exception, and legacy dialog rounding remain implementation carryovers rather than new system rules.
