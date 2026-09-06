# Automated personal portrait delivery

The user requires the portrait to be generated automatically. This extends the approved explorer design through its previously separate account-delivery stage. A successful personal portrait must use generated, source-bound volumetric models in the real account flow; fictional fixture models are not account output.

## User experience

A reader explicitly opts into automatic visual portraits for the active chart, with disclosure that accepted chapter text and generated imagery are processed by Codex to create and check 3D interpretations. Existing written-Pattern consent is not expanded silently. An accepted Pattern then starts durable background work automatically. The reader can leave and return; ready images and models are reused. Progress reflects completed images/models, and bounded retries happen without human asset authoring. Withdrawal stops unfinished/future work; accepted reading and already accepted artifacts retain their existing erasure semantics.

The account component opens the new explorer for a valid personal mesh bundle. The complete written reading remains available throughout generation, failure, and graphics loss. The existing image/graph representation remains available when a mesh is not ready. Progress and error copy explain the user-visible state, without exposing pipeline internals.

This first automated release supports four-chapter Patterns, matching the current portrait and explorer contract. Other chapter counts retain their complete reading and accessible automation preference, show the limitation, and do not leave a pending generation job.

## Authoring route

Use the existing ChatGPT-authenticated Codex runner. Each mesh job receives the exact accepted chapter source plus its verified generated image, then requests a strict declarative model program. No generated JavaScript, Python, shaders, expressions, imports, URLs, or shell commands execute. A trusted Three.js compiler interprets a closed geometry vocabulary: rounded solids, ellipsoids, closed cylinders, tori, revolved profiles, capped polygon extrusions, capped paths, and bounded repetition/braiding.

Each program compiles to a self-contained indexed GLB with normals and opaque materials. The compiler owns normalization, identities, hashes and bounds. Initial ceilings are 64 KiB/program, 128 declared parts, 512 expanded parts, 20,000 triangles, 750,000 GLB bytes, and four material groups per chapter. Four chapters therefore fit the proposed 80k triangle and 3 MB assembly budget. Invalid or over-budget programs fail; they do not silently lose meaningful geometry.

The runner renders several fixed inspection views and submits them with the reference image to a separate structured visual check. Accepted output must describe a recognizable substantial object corresponding to the source, with visible depth, meaningful openings where applicable, and no severe collapse/intersection. An unsuccessful check produces a bounded retry. These automatic checks are fallible, so a real fictional provider canary and rendered review must establish the initial route before claiming success.

## Durable lifecycle

Retain the existing v1 image jobs and graph-ready status. Introduce a separately versioned mesh contract and additive migration for automation grants/start outbox, mesh jobs, and private mesh inventory. Publishing a Pattern atomically creates a start entry when an explicit applicable automation grant exists; an opt-in for an existing accepted Pattern creates the equivalent entry transactionally. A sweeper drains entries idempotently into the existing image pipeline and repairs missing mesh jobs from accepted images.

Mesh jobs are uniquely bound to portrait, chapter, exact image and source, and compiler version. They use bounded attempts, expiring leases, retry times, fenced completion, idempotent acknowledgments, and terminal failure. Mesh failure never changes the meaning of legacy graph-ready status. Consent withdrawal cancels unfinished mesh work even if its graph is already ready. Source erasure/replacement, account deletion, and late uploads flow through durable cleanup inventory.

## Private artifacts and contracts

Preserve all v1 contracts unchanged. New consumer endpoints expose automation preference/status, mesh bundle/status, authorized model bytes, and a complete versioned download. New runner endpoints expose mesh claim/completion/failure. Mesh source image bytes are bounded and supplied through the authenticated machine channel, never public artifact URLs.

Persist encrypted model/program/audit artifacts under the accepted Pattern key with authoritative source identity, source image and text hashes, program hash, compiler version, model hash, and provider request identity. Consumer delivery revalidates owner/current source, uses private no-store responses, and verifies bounded self-contained GLB structure. The browser fetches authenticated bytes through the account API client, verifies hashes, and owns/revokes blob URLs. A personal bundle is never labelled as fictional fixtures.

The new complete download contains accepted reading, uncertainty, additional signatures, source identity, saved chapter images, models, and the viewing manifest. The old image/graph download retains its current meaning.

## Verification and delivery

Tests must demonstrate invalid program rejection, deterministic compilation, real GLB decoding, source/provenance binding, bounded visual-check failures, transport isolation, durable starts/retries, consent/erasure races, authorized delivery, and real account explorer selection. Exercise an actual generated mesh from fictional imagery and an unfamiliar object, with zero manual model edits. Inspect the rendered result and account flow at desktop and phone widths. Run the authoritative clean local gate on final code. Main integration, production migration, runner release, feature enablement, and live end-to-end success must be reported separately with evidence.

The current task authorizes implementation of this automated process. A production release must be concrete and verified before any outstanding operational approval is requested. The existing main remains untouched while development proceeds in the isolated worktree.
