# Internal-Only Ontology Activation Implementation Plan

**Date:** 2026-08-20

**Status:** Approved and ready to execute.

**Design:**
[`2026-08-15-internal-ontology-activation-design.md`](../specs/2026-08-15-internal-ontology-activation-design.md)

## Outcome

Produce one signed `en-US` ontology release with
`provenance.origin: "synthetic_internal"`, activate it, and prove that only an
account in `PATTERN_INTERNAL_ACCOUNT_IDS` can reserve against it. This removes
the ontology gate for the shortest internal path to a generated Pattern.

This plan adds no per-Pattern human step. Authoring and review happen once while
preparing the control-plane release. After activation, reservation, planning,
writing, verification, validation, and publication are fully machine-run. Slice
A is optional: implementing the automated Slice B first also satisfies the
ontology dependency.

## Current repository state

Already complete:

- the M7 release contract contains the optional signed provenance marker and
  valid/invalid fixtures;
- the deterministic compiler, signing verification, ingestion, immutable R2
  storage, active pointer, recall, and runtime reader exist;
- `PATTERN_ONTOLOGY_KEYS`, `PATTERN_INTERNAL_ACCOUNT_IDS`, and rollout parsing
  exist; and
- the synthetic engine fixture proves the mechanism, but is not release
  content.

Still absent:

- shared-TypeScript parity for provenance and report hashes;
- reservation-time provenance containment;
- the closed containment log event;
- authored corpus and ontology records;
- ontology-specific build/sign tooling; and
- activation and internal/external certification evidence.

## Task 1: Align shared types with the frozen M7 contract

**Files:**

- Modify: `packages/shared/src/m7-types.ts`
- Modify: `packages/shared/src/m7-types.test.ts`

- [ ] Add optional `evaluation_report_hash` and `regression_report_hash` to
  `PatternOntologyEvaluation`.
- [ ] Add optional `provenance` to `PatternOntologyRelease`, with closed
  `origin: "synthetic_internal" | "machine_pipeline"` and optional
  `authored_by` / `reviewed_at`.
- [ ] Add compile-time fixtures proving both marked and legacy unmarked releases
  remain assignable; do not widen `origin` to `string`.
- [ ] Run:

      npm run test -w @patternlike/shared
      npm run typecheck -w @patternlike/shared

- [ ] Commit: `shared: align ontology release types with M7`

## Task 2: Classify signed ontology provenance fail-closed

**Files:**

- Modify: `apps/api/src/services/pattern-rollout.ts`
- Modify: `apps/api/src/services/pattern-rollout.test.ts`

- [ ] Write failing tests for an `ontologyOriginOf(release)` helper: explicit
  `machine_pipeline` remains public-capable; explicit `synthetic_internal`, an
  absent marker, and any runtime-cast unknown value classify as internal-only.
- [ ] Implement the helper without reading D1 metadata or rollout mode. The
  verified release bytes are the authority.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-rollout.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: classify ontology provenance fail closed`

## Task 3: Enforce containment at reservation

**Files:**

- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `apps/api/src/services/safe-log.ts`
- Modify: `apps/api/src/services/safe-log.test.ts`
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`

- [ ] Write the reservation tests first. With a synthetic or unmarked active
  release, an external account must receive the exact existing
  `409 ontology_unavailable` response, create no claim/job/artifact row, consume
  no provider budget, and emit one closed
  `pattern_ontology_release_withheld` event. An allowlisted account must reserve.
- [ ] Include the `chart_correction` case. It must consult
  `isInternalPatternAccount` directly and must not inherit
  `consumerAdmissionEntry`'s chart-correction admission.
- [ ] Prove a `machine_pipeline` release reserves for a non-allowlisted account
  when the ordinary rollout gate admits it.
- [ ] Add the containment check immediately after `loadActiveOntology` succeeds
  and before feature derivation, consent mutation, claim reservation, or queue
  dispatch.
- [ ] Project only
  `origin: "synthetic_internal" | "absent"` through `safeLog`; no user id,
  version, hash, record, or raw origin reaches the log.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-rollout.test.ts src/services/safe-log.test.ts src/routes/pattern-ai.integration.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: contain synthetic ontology releases to internal accounts`

## Task 4: Add the authored corpus and deterministic release builder

**Files:**

- Create: `content/pattern-ontology/README.md`
- Create: `content/pattern-ontology/source-corpus.en-US.json`
- Create: `content/pattern-ontology/records.en-US.json`
- Create: `content/pattern-ontology/review-manifest.en-US.json`
- Create: `scripts/pattern-ontology/build.mjs`
- Create: `scripts/pattern-ontology/sign.mjs`
- Create: `scripts/pattern-ontology/build.test.mjs`
- Modify: `package.json`

- [ ] Author the contract-valid `internal_synthetic` source corpus. Every
  `source_supported` ontology record must cite an id present in this exact
  corpus; no orphan or invented fragment id is allowed.
- [ ] Author 40–50 records covering all 13 launch bodies, five aspect classes,
  angles/houses/patterns/uncertainty, six or more acyclic derived syntheses, and
  expression guidance. Every source-supported record includes tensions,
  counter-expressions, and prohibited claims.
- [ ] Record the reviewed hashes in `review-manifest.en-US.json`. Review is a
  release-preparation control only; the manifest is never read by runtime code.
- [ ] Write the builder to validate both input documents, verify every source
  edge, call `compileOntologyRelease`, set the four fixed values below without
  CLI overrides, canonicalize deterministically, and write only under ignored
  `build/pattern-ontology/`:

      locale: "en-US"
      provenance.origin: "synthetic_internal"
      evaluator_passed: false
      regression_passed: false

- [ ] Set `compiler_passed: true`, `verdict: "pass"`, and
  `unevaluated_fixture_count: 0` only after the real compiler succeeds.
- [ ] Implement signing as a separate command. It accepts a private-key path
  outside the repository, refuses any in-repository key, and emits the exact
  request body accepted by `POST /internal/pattern-ontology-releases`. It never
  prints key material.
- [ ] Add source-scan tests proving no runtime file under `apps/` or `packages/`
  reads `content/pattern-ontology/`, and mutation tests for source-edge,
  provenance, evaluation, cycle, review-hash, and deterministic-byte failures.
- [ ] Extend `test:content` so the new builder tests run in the root gate.
- [ ] Run:

      npm run test:content
      npm run test:contracts
      npm run typecheck

- [ ] Commit: `content: add the internal Pattern ontology release`

## Task 5: Prove the signed release through the real ingestion path

**Files:**

- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts`
- Modify: `apps/api/src/routes/internal-pattern.ts`
- Modify only if a discovered gap requires coverage:
  `apps/api/src/db/pattern-ontology.ts`

- [ ] Add an integration fixture signed by a test-only key. POST it through the
  internal route, then assert signature verification, canonical bundle hash,
  immutable create-only storage, active-pointer movement, identical replay, and
  conflicting-version refusal.
- [ ] Run one exact-time and one unknown-time internal generation with the
  synthetic publisher. Assert four to six chapters for the exact chart and
  suppression of houses, angles, and time-sensitive Moon claims for the unknown
  chart.
- [ ] In the same test environment, prove the external reservation is withheld
  before any generation row or provider call.
- [ ] Do not weaken ingestion to accommodate the authored release. If the bundle
  fails, fix the bundle or builder.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/routes/pattern-ai.integration.test.ts
      npm test

- [ ] Commit: `api: certify the internal ontology through ingestion`

## Task 6: Candidate gate and operational handoff

**Files:**

- Modify: `docs/deploy/openai-pattern-rollout.md`
- Modify: `docs/superpowers/plans/2026-08-15-m7-remaining-slices-ledger.md`

- [ ] Run the full candidate gate:

      npm run typecheck
      npm test
      npm run build
      python contracts/validate_schemas.py

- [ ] Record command output and commit hashes in the rollout evidence table.
  Do not mark signing, ingestion, or rollout complete from local tests.
- [ ] Follow the runbook's internal path: configure the public verification key,
  build and sign outside the repository, ingest once, configure exactly the
  designated internal account, and move only to `PATTERN_AI_ROLLOUT=internal`.
- [ ] Certify one internal accepted Pattern and one indistinguishable external
  refusal. Record opaque ids/hashes only; never paste release records, prompts,
  packets, provider responses, or signing material into the runbook.
- [ ] Stop with rollout at `internal`. Public rollout requires Slice B and cannot
  be approved by this plan.
- [ ] Commit: `docs: record the internal ontology canary evidence`

## Dependency map

    Task 1 -> Task 2 -> Task 3
       |                 |
       +-> Task 4 -> Task 5 -> Task 6

Task 4 may proceed alongside Tasks 1–3. Task 5 requires both branches. The live
internal OpenAI canary additionally requires adapter Tasks 6–9; until then the
release can be proven end to end only with the development synthetic publisher.

