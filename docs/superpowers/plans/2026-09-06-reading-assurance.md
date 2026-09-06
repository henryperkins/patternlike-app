# Reading Assurance Implementation Plan

> **For agentic workers:** Use test-driven implementation per task; independent Daily and Pattern domains may be delegated under the dispatching-parallel-agents skill. Review changes and run the aggregate gate after integration.

**Goal:** Reject unsupported Daily factual statements and apply shared safety invariants to every newly published Pattern, with honest provenance and release evidence.

**Architecture:** Preserve calculation roles in internal fact records and validate emitted factual sentences against individual citations. Apply an origin-independent Pattern safety policy immediately before publication. Record external evidence gaps explicitly.

**Tech Stack:** TypeScript, node:test, Vitest/workerd, Cloudflare D1/R2, Python contract tooling.

**Spec:** `docs/superpowers/specs/2026-09-06-reading-assurance-design.md`.

## Global constraints

- Keep existing public/provider JSON shapes and immutable historical reading records.
- Never reinterpret a frozen command under an unpinned policy.
- Keep full written readings available through failed regeneration.
- No provider calls, migrations, deployment, push, or changes to unrelated worktrees.
- Do not record an automated review as human certification or a repository ledger as a live observation.
- Run Node 22, a real per-worktree `.venv`, focused regressions, and all 14 aggregate lanes.

## Task 1: Daily factual support

**Files:** `packages/reading-engine/src/constrained-types.ts`, `constrained-input.ts`, `candidate-validation.ts`, new `claim-support.ts`; adjacent tests; `apps/api/src/services/reading-prompt.ts`, `reading-publisher.ts`, and affected policy-pin fixtures/evaluation records.

**Interfaces:** Internal `ConstrainedFact.support` is projected from the raw frozen calculation record. `validateFactSupport(text, citedFacts, context)` returns a closed detail code or `null`; context carries unit kind, local date, and suppressed features. No private identifier or raw birth data crosses the provider boundary.

- [x] Add the seven reproduced malformed candidates and valid controls to the existing fixture suite. Assert `validateReadingCandidate(candidate, prepared).ok === false` for swaps, irrelevant citations, wrong participants, degrees and timestamps; add reversed roles and same-fact direction/date-kind cases.
- [x] Run `node node_modules/tsx/dist/cli.mjs --test packages/reading-engine/src/candidate-validation.test.ts` and capture genuine assertion failures.
- [x] Project typed support and enforce per-sentence factual relationships, explicit roles, scope, and bounded temporal/degree semantics. Reject ambiguous combinations and unknown factual syntax; preserve legitimate uncertainty notices and generated reflection.
- [x] Update policy/prompt pins and frozen-policy behavior tests. Run reading-engine, prompt/publisher, and Daily executor suites.

## Task 2: Universal Pattern publication gates

**Files:** New `apps/api/src/services/pattern-publication-safety.ts` and adjacent tests; `pattern-execute.ts`, `pattern-publication-proof.ts`, `ontology-regression.ts`, and affected integration tests; documentation describing authored assurance. Root owns the generated Pattern source fingerprint after integration.

**Interfaces:** A pure safety evaluator consumes original selected features/manifest, fact packet, frozen plan, exact writer, validated ontology/source IDs, semantic verdict, and public projection. It returns a policy version and closed failure codes. Publication binds the passing result to the candidate hash; both origins use the same call path.

- [x] Add failing tests for both ontology origins with a valid-shape passing semantic-verifier stub and unsafe writer outputs. Include summaries/titles/signatures/uncertainty, source dependencies, suppression, private projection, and mandatory coverage.
- [x] Run focused Vitest tests and verify the missing publication guard causes the expected failure.
- [x] Implement shared deterministic checks with carefully scoped uncertainty/negation handling. Invoke them on the exact bound artifacts before persistence; use existing bounded failure transitions and preserve the prior document on failed source replacement.
- [x] Run focused safety, ontology regression/evidence, Pattern execution, proof, and regeneration tests. Document release versus per-document checks accurately.

## Task 3: Provenance and release records

**Files:** `pattern-corpus/` provenance sidecar/validation and notes; `docs/reviews/2026-09-06-reading-assurance.md`; repository release-evidence tooling and tests where missing; Codex provider privacy evidence record. Inspect existing `feat/release-truth-attestation` work read-only before choosing overlap.

**Interfaces:** Evidence records bind hashes and distinguish `recorded`, `observed`, and `unverified`. Unknown generation/account/model fields and human review remain explicit. Frozen source comparison must reject mismatched paths or hashes and never promote a partial observation into deployment success.

- [x] Add meaningful failure cases for content-hash/provenance mismatch or incomplete release proof before implementing validators.
- [x] Record the 60-fragment model-generated corpus and unresolved provenance/editorial fields without inventing certification.
- [x] Build or reuse content-free snapshot/artifact evidence that can be attached to the final aggregate run; record the existing all-1,183-file match to `ce52443` separately from live deployment status.
- [x] Document actual inspected runner data boundaries and the external evidence still required for account privacy and authorized production lifecycle checks.

## Task 4: Integration and final verification

- [x] Review every changed file and focused regression result; resolve integration failures.
- [x] Update `apps/api/pattern-creation-sources.json` if new Pattern source modules require inclusion, then run `npm run generate:pattern-source -w @patternlike/api` once all relevant source is stable.
- [x] Run affected typechecks and contract checks, then `npm run ci:local` against frozen final source. Capture all 14 lanes, final success text, exit code, and toolchain versions.
- [x] Record final implementation scope, limits, source hashes, and verification. Leave changes on the isolated branch; no merge/push/deployment is part of this task.
