# Automated personal portrait implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement independent units with regression evidence and integration review.

**Goal:** Automatically produce, verify, privately save, and display personalized solid 3D portraits after explicit user opt-in.

**Architecture:** Separate durable mesh jobs follow the existing image pipeline; a constrained Codex program is compiled and visually checked, then delivered through a versioned private account API to PortraitExplorer. An explicit automation grant creates durable start work on accepted Pattern publication.

**Tech Stack:** Existing TypeScript, Three.js 0.185.1, Codex app-server, Sharp, Hono, D1, encrypted R2, React and current test runners.

**Spec:** ../specs/2026-09-06-portrait-automation-design.md

## Global constraints

- Preserve existing v1 contracts, accepted source prose and legacy image/graph readiness.
- Never execute model-written code or use public URLs for private account assets.
- Preserve current consent, identity, encryption, write fences, erasure and source-revision boundaries.
- Work in the existing isolated worktree on `codex/portrait-automation`; root main stays at the reviewed commit.
- Root owns package manifests/lockfile, shared barrel exports, frontend integration, final plan/evidence and aggregate gate. Agents coordinate type boundaries before integration.

## Task 1: Trusted mesh compiler

Files: shared `portrait-mesh-program.ts` and tests; runner `portrait-mesh-compiler.ts`, `portrait-mesh-preview.ts` and tests.

- [x] Define strict program schema, validation and types; unknown fields, nonfinite numbers, unbounded paths and executable input must reject.
- [x] Demonstrate a failing test for a missing compiler and for an over-budget model before implementing the trusted geometry interpreter.
- [x] Export `compilePortraitMesh(program, identity)` returning GLB bytes, hashes, bounds and counts; insert authoritative chapter/source identity in the GLB root.
- [x] Export `renderPortraitMeshPreviews(program, identity)` returning fixed labelled PNG views for automated review.
- [x] Verify every supported geometry family, deterministic output, positive volume, standard GLTFLoader decoding, resource limits and cleanup.

## Task 2: Durable authorization and delivery

Files: shared `portrait-mesh-protocol.ts`; new mesh contracts/fixtures; additive migration 0027; API mesh/automation routes and services; existing portrait service, scheduled maintenance, deletion manifest and test migration wiring.

- [x] Publish the new exact protocol interfaces for the runner and frontend.
- [x] Demonstrate failed tests for automatic outbox publication, idempotent starts, lease races, revoked consent on graph-ready portraits, and cross-account model requests.
- [x] Implement explicit chart-scoped automation permission, atomic start recording, image-to-mesh job repair, bounded claims/completions/failures and source-bound encrypted inventory.
- [x] Implement private model/status/complete-download endpoints and cleanup that survives late writes.
- [x] Keep disabled/missing-migration deployments compatible and preserve legacy portrait v1 tests.

## Task 3: Automatic authoring and visual verification

Files: runner mesh client/invocation and tests, runner scheduling/index integration, a fictional canary entry.

- [x] Demonstrate failed fake-process tests for image-conditioned strict JSON output, unsolicited tool/approval requests, wrong source, malformed model and failed visual verification.
- [x] Reuse/refactor the existing isolated transport with an image-generation-disabled JSON mode; enforce exact current source inputs and bounded response sizes.
- [x] Compile the generated model, render fixed views, and require a successful independent structured visual check before returning completion.
- [x] Return exact program/model/source hashes and auditable provider request identities; preserve bounded leases and explicit failure codes.
- [x] Run fictional live provider canaries with the reviewed CLI, compile outputs unchanged, and retain sanitized receipts and model views.

## Task 4: Real account experience

Files: account portrait and Pattern generation flow components/tests, API client/tests, explorer types/content/scene validation and tests.

- [x] Demonstrate failed tests for explicit automation opt-in, restored preference, in-progress visual state, authenticated GLB delivery and personal-bundle explorer rendering.
- [x] Add clear optional portrait consent and automate all later stages; retain existing reading consent unchanged.
- [x] Select the new explorer for verified personal bundles, with complete reading/legacy graph fallback and correct source replacement cleanup.
- [x] Own and revoke authenticated image/model blob URLs; verify hashes and source identity before enabling the scene.
- [x] Make complete portrait download and generation recovery reachable using factual progress copy.

## Task 5: End-to-end review and release evidence

- [x] Validate the real generated geometry and unfamiliar-object canary without manual editing.
- [x] Exercise account generation/status/delivery/reader/graphics-loss paths in the browser, including phone layouts and keyboard controls.
- [x] Independently review compiler/runner authority and API consent/erasure boundaries; fix validated findings.
- [x] Run focused regressions and final `npm run ci:local -- --clean`; preserve exact summary and exit code.
- [x] Record implemented behavior and any remaining operational prerequisites, with no claim that code completion alone proves live generation.
