# Four chapter images, one unified sculpture

Status: approved direction for the local fictional Pattern prototype. All four single-object chapter images have been generated. The current modeling contract uses their decoded pixels to build one connected sculptural form. This supersedes the earlier door study and shared band geometry. The [delivery handoff](../2026-09-05-pattern-portrait-handoff.md) records implementation, verification, and delivery status; this document defines the accepted direction and its boundaries.

## What the demonstration must prove

Each generated image depicts exactly one familiar, identifiable object chosen from its own complete chapter. All four actual images then contribute to the geometry of **one unified sculptural form**. The user selected a unified form explicitly; four separate object meshes arranged together do not satisfy this milestone.

The images are the only content inputs to modeling. Chapter text, titles, object names, metaphor rationales, document identifiers, and image hashes cannot select a mesh template or determine shape parameters. Fixed technical choices such as resolution, smoothing, orientation, and display scale are necessary parts of the modeling method. They must apply consistently across inputs rather than encode these four named subjects.

The result is an abstract sculptural interpretation of the images’ visible contours. It is not a reconstruction of hidden object surfaces, and the four images are different subjects rather than different views of one object. Recognizability is required of each source image; the resulting sculpture expresses their combined shapes without promising that each original object remains separately recognizable from every angle.

## The four generated references

The local prototype uses fictional published chapter text. Its reference subjects are:

| Chapter | Single image subject | Proposed metaphor |
| --- | --- | --- |
| Closeness, with room to breathe | Door | A chosen boundary can open to connection. |
| Giving your ideas a place | Notebook | Unfinished ideas can have a protected place that opens to sharing. |
| A steadiness of your own | Metronome | A steady rhythm can remain useful while its pace changes. |
| Letting change take its time | Lantern | Enough light for a next step does not require certainty about the whole path. |

These are authored image-generation choices, not a global chapter-title lookup or an implemented automatic subject selector. Each subject is an ordinary object with its intrinsic functional parts; there are no extra props, miniature scenes, collections, or invented hybrid devices.

The exact prompts are preserved in [2026-09-05-chapter-image-prompts.json](2026-09-05-chapter-image-prompts.json), version `chapter-object-v2`. Every prompt includes its own chapter’s title, summary, all prose sections, tensions, resources, and counter-expression verbatim, plus shared visual direction. Helpful context may be added when relevant, but no other chapter text may enter that image’s prompt. A theme summary is insufficient.

The four generated PNGs are stored in [the preview reference directory](../../../apps/web/src/preview/references/). Their neutral filenames and [provenance receipt](../../../apps/web/src/preview/references/provenance.json) preserve the connection to the original generated files. Ancillary PNG provenance metadata was removed from the modeling copies; their compressed image data was retained unchanged. Original and modeling-copy hashes document provenance only and never seed geometry.

## Input boundaries

1. **Chapter to image.** The image-generation stage may read the complete individual chapter and record its proposed subject, rationale, prompt version, and generated image. This stage explains the metaphor. Automatic per-user subject selection and image generation are not implemented in the preview.
2. **Published reading to approved references.** The reader binding freezes the document revision, chapter ID, complete source-text snapshot, reference ID, and asset hash. A reference attaches only when its revision, chapter ID, and every published source-text field still match. Stale or missing references prevent construction of the four-image sculpture while leaving the reading available.
3. **Images to geometry.** The reader supplies only four asset locations to image loading. The pure modeling API receives exactly four decoded pixel buffers containing width, height, and RGBA data. It has no chapter-text, subject-label, rationale, document, seed, or template argument. Every image must be valid and nonblank; missing or unusable inputs produce an explicit unavailable state, never a stock door or band fallback.
4. **Geometry to presentation.** The renderer displays one connected surface. Neutral image indices can attribute parts of that surface to inputs and connect selection back to the reader. Selection may change camera framing and visual emphasis, but cannot change the sculpture’s vertex positions or split it into four separate objects. Reading metadata remains outside geometry construction.

The runtime API and behavior tests must enforce this boundary. Restricting the modeling implementer’s supplied context is an additional input audit, not a claim that its filesystem access was sandboxed.

## Shape, meaning, and interaction

The contour method must extract visible structure from all four images and combine it into a stable dimensional surface. Altering one image’s silhouette must change actual vertices in a corresponding structural way. Changing a label, rationale, or hash while keeping valid image pixels fixed must not alter the geometry. A generic mesh with hash-derived jitter, an image texture on a prewritten shape, or four named object constructors does not demonstrate this requirement.

Shape, size, placement, emphasis, and color are artistic presentation choices, not measured traits, scores, birth-data claims, or inferred relationships between chapters. The published reading supplies meaning and uncertainty. The sculpture must not invent new claims about the person.

Display all four source images alongside their chapter navigation so a viewer can recognize the inputs and return to each complete reading. Keep the whole sculpture present during selection. Retain native keyboard controls, touch rotation with page scrolling, reduced motion, explicit bounded zoom, complete Reading view, accuracy and uncertainty, and graphics fallback. A missing image or unavailable WebGL must not remove readable content.

## Verification and delivery

The implementation must demonstrate deterministic geometry, finite bounds and normals, one connected closed surface, acceptable mesh cost, and structural contribution from each of the four images. It must reject absent, blank, or invalid input. Tests must establish that reader metadata cannot influence positions. Browser verification must inspect the actual sculpture from multiple directions, selection, all four visible references, mobile interaction, error states, and resource cleanup.

The conceptual lesson from [OpenAI’s architectural visualization guide](https://developers.openai.com/blog/architectural-visualization-with-astra) is to build an actual editable 3D artifact, inspect rendered results, and iterate. The guide does not establish a neural reconstruction capability for this prototype. A rotatable generated mesh and a screenshot of a mesh are different deliverables; evidence must identify which was produced.

This milestone is a local, separately built preview using four existing generated images and fictional text. Dynamic generation for each real user’s Pattern, authenticated asset storage, persisted model versions, publication integration, consent, removal, and deployment remain production work. A future service should persist the image set and modeling version for a published Pattern, invalidate assets when their source changes, and honor the Pattern’s access and removal rules. Those requirements are not a claim that the production pipeline is implemented.
