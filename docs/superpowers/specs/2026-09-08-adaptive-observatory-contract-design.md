# Slice 6: Observatory continuity and conditional artwork compatibility

Date: 2026-09-08

Reconciled: 2026-09-09 against the [updated alignment roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md), especially section 6.5.

Status: immediate reader continuity is substantially implemented through [Slice 4, now separately deployed](../plans/2026-09-09-reader-journey-production-implementation.md). Exact chapter entry, source-bound return, full text, and artwork-independent access have application, component and a rendered journey’s evidence. The broader rendered count/recovery matrix, signed-in production journey observation and human comprehension review remain open. Generated-artwork expansion remains unselected; its contracts and producer are not implemented.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Related state/queue interface: [Slices 7–8](2026-09-08-readiness-runner-fairness-design.md).

Original source review: commit `6e706741f03253f2807d33380afb529161f3481f` plus the pre-existing local Observatory edits, inspected on 2026-09-08. The September 9 reconciliation uses source baseline `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`; its implemented local reading stations supersede the earlier proposal to add three-to-six-chapter station support. Source availability does not establish deployed adoption or measured reader benefit.

## Rendered continuity verification — 2026-09-11

The integration exercised the real `ConnectedPatternReading` and observatory components with fictional exact-edition documents containing 3, 4, 5 and 6 chapters and repeated long paragraphs. All sixteen combinations of desktop/mobile (1440×1000 and 390×844), chapter count and reduced/default motion completed exact last-chapter entry, focused heading, complete-text checks, injected WebGL context loss, retry/recovery, preserved source history, return focus, complete-reading access and no horizontal overflow. Requests remained GET-only; the optional artwork endpoint was requested only for four-chapter documents. No generated artwork, provider or real account was involved.

The temporary harness and screenshots are in `/tmp/patternlike-roadmap-browser/`; the integration report records their evidence boundary. This closes the specified local rendered chapter-count/recovery matrix. Physical-device coverage, authenticated production navigation and measured human comprehension remain unobserved. Conditional wider generated artwork remains unselected.

## Decision and source boundary

[AccountPortraitExplorer](../../../apps/web/src/components/AccountPortraitExplorer.tsx) already defaults to local stations for a matching three-, four-, five-, or six-chapter Pattern. The [manifest builder](../../../apps/web/src/lib/pattern-portrait.ts) retains every published chapter in order, including its sections, tensions, resources, and counter-expression, as well as additional signatures and uncertainty. The [scene](../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx) uses authored reading folios when verified artwork is absent or cannot be loaded. The [reader](../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx) already supplies comparison, guided exploration, source-passage navigation, and a complete reading with retained navigation state.

The optional [portrait-generation service](../../../apps/api/src/services/pattern-portrait.ts) still admits exactly four chapters. That artwork limitation spans its admission/jobs, [generated-asset client validation](../../../apps/web/src/lib/account-portrait.ts), [shared types](../../../packages/shared/src/portrait-types.ts), graph generation, image/mesh claim schemas, and D1. Both [portrait image jobs](../../../db/d1/0026_pattern_portraits.sql) and [mesh jobs](../../../db/d1/0027_portrait_mesh_automation.sql) restrict `chapter_index` to 0–3; artwork completion/readiness checks also compare against four. These constraints do not prevent local three-to-six-chapter reading stations from opening.

Preserve every chapter field and the complete reading. Do not force four chapters, invent missing chapters, concatenate chapters, or choose an undisclosed subset to satisfy artwork eligibility. Generated images and meshes are optional derivatives; authored folios are part of the room, not additional interpretations or evidence.

## Immediate scope: supported entry and return navigation

Connect the existing observatory chapters to the supported reader journey and back to the referenced passage or edition. Use the [Slice 4 relationship design](2026-09-08-reader-relationships-feedback-design.md) for explained connections and destination access. Begin with a small, manually verified relationship set; opening a station does not require a new relationship inference model, generated image, or mesh.

Each entry identifies the exact accessible Pattern edition and chapter plus the originating passage and supported relationship. Preserve source identity when restoring selection, reading position, comparison, and return navigation. Recheck destination access and source compatibility; recalled, changed, invalidated, or erased material must receive its actual unavailable/correction behavior rather than silently opening the same ordinal from a different edition. A shared theme is not evidence of a causal relationship.

Extend the current chapter/source navigation and retained session behavior where the connected path requires it. Keep the full reading available throughout and preserve keyboard access, focus restoration, reduced motion, mobile framing, and non-WebGL recovery. The current [station layout and framing](../../../apps/web/src/components/portrait-explorer/observatory-world.ts) are the baseline: longer readings already use two aisles, and comparison positions derive from display bounds. The September 8 radial `adaptive-stations/v1` proposal is superseded; this work does not prescribe replacing existing geometry or scene controls.

Immediate acceptance is a supported entry into the intended chapter, an understandable explanation of the connection, and return to the exact accessible origin without losing reading context. Slice 4 implements and tests exact entry/return across 3/4/5/6 chapters, preserves complete text without artwork, and revalidates source identity and access. Its [rendered evidence](../../reviews/artifacts/reader-journey/2026-09-09-authorized-implementation/README.md) covers one actual application journey at desktop/mobile sizes, including observatory chapter 3 and return. This does not establish the full rendered 3/4/5/6 long-text, reduced-motion, graphics-loss/recovery matrix or human comprehension. Complete those remaining checks before recording immediate acceptance as fully evaluated. Broader artwork generation is independent of this work.

## Conditional scope: generated-artwork expansion

The remaining design preserves the detailed v2 artwork proposal for review **only if** broader image/mesh eligibility is judged to add enough reader value to justify its contract, consent, capacity, and operational cost. Record that product decision before scheduling this expansion. Its schemas, migrations, protocol header, consent versions, and switch are planned contracts, not current implementation.

This expansion does not gate the immediate navigation work, the connected reader journey, or the existing three-to-six-chapter observatory experience. If it is not selected, existing four-chapter artwork and local reading folios remain the supported paths.

If selected, keep existing v1 responses, accepted image/model/graph bytes, per-chapter source serialization, and historical provenance readable. Expanded artwork support uses versioned contracts and explicit compatibility dispatch; do not widen a frozen v1 schema or retag accepted v1 bytes as newly generated v2 material.

### Source identity and count invariants

Derive `chapter_count` from the accepted source document at reservation. It is an integer in `{3,4,5,6}` and is frozen for that portrait. The source tuple is `(pattern_id, chart_id, document_revision, document_hash, chapter_count)`; each chapter adds `(chapter_index, chapter_id, source_text_sha256)`. `chapter_id` remains ordinal `chapter-${chapter_index + 1}` within that exact revision.

For every stage:

- Index is an integer from 0 through `chapter_count - 1`; all indices are unique and complete when the parent becomes ready.
- Ordered source text is produced by the existing chapter serializer. It includes title, summary, sections, tensions, resources, and counter-expression. Full reading presentation also retains additional signatures and uncertainty.
- Image adoption requires the same source tuple and text digest. Mesh adoption additionally requires the exact accepted source-image digest, compiler/program identity, and document revision.
- A changed count, reordered chapter, changed prose, replaced document, or changed source hash invalidates an earlier binding. Same ordinal alone never authorizes reuse.
- Every chapter needs its own accepted image/model for the relevant ready state. Partial progress does not mean a complete portrait; complete text remains independently readable throughout.

Unexpected counts fail optional-asset admission with an explicit unsupported state. They do not make a valid text document disappear or trigger a rewritten reading.

### Versioned transport

Add `contracts/portrait-v2/` and `contracts/portrait-mesh-v2/` with stable new `$id` values, manifests/freeze notes, OpenAPI declarations, and positive/negative fixtures. Maintain v1 validators and fixtures.

| Surface | v2 change |
| --- | --- |
| Portrait response/download | `pattern-portrait/v2` and `pattern-portrait-download/v2`; explicit `chapter_count`, 0–N completed count, ordered chapters, and version-discriminated graph |
| Explorer response/download | v2 envelope binds the portrait revision/count and 0–N completed models; every model belongs to one matching chapter |
| Image claim | `codex-portrait-claim/v2`; explicit count, index 0–5 bounded by count, chapter ID, document revision, and existing exact source hash |
| Mesh claim | `codex-portrait-mesh-claim/v2`; same count/index/revision binding plus image/text hashes and compiler identity |
| Mesh program/model | v2 accepts chapter IDs through `chapter-6` while preserving existing geometry, byte, validation, and audit limits |
| Graph | `constellation-v2`; explicit count, dynamic source-index bounds, one contribution per source chapter |

Keep four inspection views per mesh audit. The audit's `view_count: 4` is a validation viewpoint count, not a chapter count, and must not be changed by a broad replacement. Per-image sample dimensions, color channels, geometry tuples, attempt ceilings, and byte limits likewise retain their existing meanings.

Use capability negotiation on the existing authenticated claim endpoints: a new runner sends `X-Patternlike-Portrait-Protocol: v2` and accepts v1/v2 claims. A missing header means v1 capability; reject unsupported header values. A v1-capable claim request may select only v1 jobs. Select/filter protocol before acquiring the lease so an old runner cannot consume and repeatedly fail an incompatible job. This header is compatibility information, not authentication or spend authorization.

A v2 runner talking to an older Worker still receives and handles v1. New complete/fail endpoints or negotiated terminal forms bind to the stored job's protocol and lease; a completion cannot upgrade/downgrade a job's version. V1 completion handling remains available for already-issued v1 leases.

For browser reads and downloads, use the same `X-Patternlike-Portrait-Protocol: v2` header and accept a v1 response from an older Worker. Add the header to the applicable CORS allowlist and representation variation rules; retain private/no-store response handling. A v1 request for a v2 portrait returns an existing compatible unavailable response, preserving text access; it never receives a malformed four-item projection of a five-item source. The new client can render saved v1 assets without new provider calls.

### Persistence and migration

Add immutable `chapter_count` and protocol/format identity to the parent portrait reservation, with existing rows assigned count four and v1. Preserve all IDs, source hashes, statuses, asset keys, lease/completion hashes, attempt counts, timestamps, and cleanup inventory.

Widen image/mesh job storage to indices 0–5 through an ordered migration that reconstructs the affected CHECK-constrained tables if required. Also enforce index less than the parent's frozen count and prevent count/protocol mutation after reservation. Preserve unique keys and every incoming asset reference, index, cancellation/erasure/consent trigger, and replay behavior. Do not edit migrations 0026/0027 in place or assume the next migration number before checking the actual pending set.

The migration's integration tests must start with realistic v1 rows: pending, running with a lease, complete with assets, failed, and cancelled/cleanup inventory. After migration, validate exact row identity/bytes, foreign-key integrity, legal v2 inserts, rejection of invalid indices/count mutation, and behavior of every affected trigger. Preserve any completion-timestamp columns already introduced by Slice 7; agree actual migration order before freezing either candidate. Include interruption/recovery analysis and a forward-compatible recovery plan. The SQL and its D1 compatibility proof require their own review before any production application.

Ready-state transitions use the frozen count plus a complete ordered index set and all relevant completed jobs. Replace each semantically chapter-related hardcoded four; do not use only `COUNT(*) = N` if duplicates or missing index validation could hide a different set. Parent cancellation/source/consent guards remain in the atomic publication path.

### Graph and scene behavior

Keep the existing v1 graph algorithm/validator intact. V2 retains the current maximum of 84 graph stars per chapter, giving at most `84 * N` stars and source indices in 0–N−1; geometry arrays and connection bounds are derived from the actual vertex count. Require exactly N contribution records with unique indices. Preserve every other evidence/shape constraint and reject NaN/infinite/out-of-range values.

Retain the existing station geometry, source order, and reading entrances for every supported chapter count. V2 adds verified artwork to those stations; it does not require a new layout. Check accepted display bounds, including reader desks, against current station/comparison clearance and world/camera bounds. Any demonstrated framing or collision defect needs a bounded, separately reviewed correction grounded in rendered evidence before a layout policy changes.

Camera framing derives from actual bounds and viewport aspect, rather than scaling a four-station camera by chapter count. The navigation model uses the manifest's ordered chapter IDs, not fixed next/previous lists. Comparison/unfolded positions also derive from N and actual selected bounds, with a reserved reading path; they cannot reuse an out-of-range fallback to the origin.

The reading/keyboard list exposes all N chapters immediately from the source document. Graphs, images, and meshes can be unavailable without blocking that list. Partial progress is described as `completed / chapter_count`; do not offer a ready graph/model binding before its acceptance conditions pass. Maintain text-only/no-WebGL recovery, reduced motion, focus restoration, source-aware caches, and scene/session disposal.

### Consent, capacity, and rollout order

More chapters mean more possible per-reading image/mesh work. Preserve per-job attempt ceilings and existing global limits; do not imply that a six-chapter run has the same maximum provider work as a four-chapter run. Record the full count-dependent worst-case envelope before enabling production creation.

Existing one-time portrait consent `1.0.0` and automation grants `1.1.0` continue to authorize their v1/four-chapter behavior. They are not silently promoted to a larger work envelope. Reserve one-time policy `2.0.0` and automation policy `2.0.0` in their separate existing registries for explicit complete-reading/count scope. Update the related closed storage constraints/contracts together and bind count/protocol to the applicable policy. Renew each grant only through its corresponding explicit action; accepted old assets remain readable without reconfirmation. Enabling a new producer still requires separate operational/spend authorization.

Use proposed producer switch `PATTERN_ADAPTIVE_PORTRAITS_ENABLED`, default `0`, with strict `0 | 1` parsing and invalid values failing closed for adaptive admission. It controls new v2 reservations, not access, cleanup, or completion of existing work. Keep it off during compatibility rollout and add it to the deployment-variable inventory. The staged sequence is:

1. Verify and, when authorized, apply the backward-compatible storage migration while existing producers remain v1.
2. Deploy Worker support for reading both formats and issuing v2 only to capable runners; leave adaptive creation off. Keep v1 complete/fail paths and accepted reads working.
3. Install/verify the v2-capable runner separately. Record actual installed artifact/protocol support; a repository build is insufficient.
4. Ship the client that reads both formats, preserves fallback, and supports the new explicit consent policy.
5. After applicable consent/capacity/operational evidence and authorization, enable creation for N=3/5/6. Existing compatible four-chapter generation may remain v1.

On rollback, stop new adaptive creation and keep a compatible reader/cleanup path for already-created v2 work. Do not roll back to a Worker that cannot safely read/cancel/clean up persisted v2 rows, delete accepted assets as a shortcut, or reinterpret v2 leases as v1. The rollback target must be the compatibility Worker from step 2 or later.

### Conditional artwork verification and acceptance

Use a 3/4/5/6 matrix across source admission, manifests, job reservation, image claims/completions, graph validation, mesh claims/programs/completions, downloads, source updates, cancellation, and UI navigation. Negative cases include 0/2/7 chapters; fractional/out-of-range indices; missing/duplicate/out-of-order chapter sets; mismatched count/revision/text/image hashes; old client/runner against v2 work; new client/runner against v1; completion after revocation/deletion; and schema-version spoofing.

Migration tests preserve real v1 references/leases/triggers and prove both valid new counts and invalid-count rejection. Verify saved v1 image/model reuse with zero new provider requests in the applicable controlled test. Actual provider/reader lifecycle evidence remains a separately authorized observation.

Capture rendered desktop/narrow/landscape states for each count, keyboard and reduced-motion navigation, long chapters, read-position restoration, missing assets, non-WebGL mode, and context loss/recovery. Preserve the current observatory implementation and any unrelated local edits when touching those files. Assess image fidelity to the bound chapter/visual metaphor and mesh fidelity to the accepted image separately from [interpretation quality](2026-09-08-interpretation-quality-baseline-design.md); visual appeal and source binding do not validate psychological claims. Use focused tests in the affected shared/API/runner/web suites, with existing contract, fixture asset, or fingerprint/build checks when those inputs change. Keep the existing [repository merge policy](../../../AGENTS.md); this slice adds no verification gate, preflight dependency, or mandatory tooling framework.

The conditional contract/storage/compatibility work, runner/client adoption, and adaptive producer enablement remain separate release boundaries. Local acceptance of this expansion requires the full artwork count matrix and preserved reading/source identity; operational completion additionally requires compatible installed/runtime evidence and an authorized lifecycle result. Slice 6's immediate reader-continuity work has its own acceptance criteria above and can complete without selecting or enabling this expansion.
