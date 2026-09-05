# Personalized portrait implementation plan

> **For agentic workers:** Use subagent-driven-development with bounded ownership and review. Keep tests and evidence with each implementation task.

**Goal:** Generate, persist and display four account-specific chapter images and their unified constellation through ChatGPT-authenticated Codex.

**Architecture:** Separate durable chapter jobs are polled by the existing outbound runner. Accepted Pattern encryption protects images and graph; the authenticated reader consumes an additive portrait response and saved graph.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/R2, Codex app-server, React, Three.js.

**Spec:** `docs/superpowers/specs/2026-09-05-personalized-portrait-design.md`

## Global constraints

- Use ChatGPT-authenticated Codex native `gpt-image-2`; no API-key fallback.
- Four generated images, one recognizable object per full chapter, no other chapter text in an invocation.
- Image pixels alone supply local geometry; matching calculated Sun sign supplies artistic arrangement.
- Preserve existing Pattern consent, provenance, regeneration, deletion and reading fallback.
- No production migration or main-branch merge during implementation.
- Use the shared contract in `packages/shared/src/portrait-types.ts`; no duplicated wire types.

### Task 1: Shared graph and persistence contract

**Files:** `packages/shared/src/portrait-types.ts`, `portrait-graph.ts`, `portrait-sun-layout.ts`, their tests, `index.ts`; web `image-sculpture.ts`, `sun-sculpture.ts`, `PatternSculpture.tsx`.

**Interfaces:** `createPortraitGraph(images: readonly PortraitImagePixels[], sunSign: ZodiacSignName | null): PortraitGraph`; `isPortraitGraph(value: unknown): value is PortraitGraph`. Preserve the existing web `createImageSculpture` return contract as a Three.js adapter.

- [x] Add graph validation and serialized roundtrip tests using measured fixtures and the existing image-causality cases.
- [x] Move pixel extraction and sign layout into dependency-free shared functions; keep float precision and current public preview shape stable.
- [x] Add an optional saved graph to the viewer so an account portrait needs no full-image decode to render its constellation.
- [x] Run shared and portrait-focused web tests and typechecks.

### Task 2: Durable authenticated portrait service

**Files:** `db/d1/0026_pattern_portraits.sql`, migration inventory/test loader; API portrait db/services/routes/tests, `env.ts`, `index.ts`, lifecycle/deletion/replay and maintenance integration.

**Interfaces:** shared `PatternPortraitResponse`, `PatternPortraitGenerationRequest`, `CodexPortraitClaim`, `CodexPortraitCompletion`, `CodexPortraitFailure`. Machine paths `/codex-provider/v1/portraits/claim`, `/codex-provider/v1/portraits/:jobId/complete`, `/codex-provider/v1/portraits/:jobId/fail`. User paths from the spec; image reference IDs are opaque.

- [x] Write failing real D1/R2 route tests for four-image completion, duplicate start, owner isolation and revision rejection.
- [x] Implement durable per-chapter claims, bounded retries, private encrypted inventory and saved graph assembly after exactly four accepted images.
- [x] Add races covering lease expiry, completion after deletion/replacement, upload failure, and re-claim after partial completion.
- [x] Integrate account and Pattern lifecycle cleanup plus private portrait download; verify retention independence and erasure replay.
- [x] Run focused API tests, migration smoke and API typecheck.

### Task 3: Native Codex image runner

**Files:** `apps/codex-runner/src/portrait-client.ts`, `portrait-invocation.ts`, tests, runner/index configuration integration, package dependencies.

**Interfaces:** consume shared machine claims; complete with one PNG derivative, measured RGBA samples, object metadata, original SHA256 and native tool/turn identifiers.

- [x] Pin native event parsing with fixtures from the successful probe and installed app-server schema; reject absent/failed/multiple image results.
- [x] Execute an ephemeral ChatGPT-authenticated turn with shell/apps/plugins/browser/agents disabled; no API-key environment variables in the child.
- [x] Validate managed artifact location/type/size and exact native completion evidence; optimize/sanitize the image and sample from its actual decoded pixels.
- [x] Add bounded machine HTTP transport and polling without changing frozen text jobs. Clean only task-owned temporary artifacts.
- [x] Run runner suite and a real four-chapter generation probe using fictional chapter text.

### Task 4: Account reader and final verification

**Files:** web `AccountPatternPortrait.tsx` and tests/styles; `PatternExperience`, `ChartView`, API client and tests; portrait image binding adapter.

**Interfaces:** authenticated status/create/image/download functions use the shared types and existing request/idempotency conventions. Account component receives current chart ID, matched document, and state metadata.

- [x] Write failing tests for mismatched identity, explicit creation/retry, generating/ready/failure states and request cancellation.
- [x] Add optional creation/view UI; preserve prose and surrounding reader actions; load all four authenticated blobs with hash checks and cleanup.
- [x] Verify saved-graph rendering, mobile chapter navigation and reopening stable assets in a browser.
- [x] Compare two actual four-image chapter sets, record screenshots and delivery payload evidence.
- [x] Run `npm run ci:local`, inspect aggregate exit status, and review all changes for feature-branch delivery.
- Delivery: commit and push `codex/pattern-portrait`; report the matching local and remote SHA with the final handoff.

## Progress

- Main's three newer commits merged into this feature branch before 0026 work.
- Installed Codex 0.153.3 ChatGPT-authenticated native generation probe produced a valid PNG; app-server transport produced all four actual chapter images. The final stricter configuration preflight and one complete native invocation also passed; its extra compatibility image is excluded from both preview sets.
