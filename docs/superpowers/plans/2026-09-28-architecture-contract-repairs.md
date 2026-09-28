# Architecture Contract Repairs Implementation Plan

> **For agentic workers:** Use the debugging and test-driven-development skills for each independent repair, then integrate and review the complete change.

**Goal:** Complete the five first-pass corrections requested from the architecture map without changing production configuration or authority boundaries.

**Architecture:** Keep existing routes and publication machinery. Share private-response and uncertainty policies at their existing boundaries, separate portrait capability from permission, make release evidence consume canonical gate output, and make compile-only ontology output fail closed.

**Tech Stack:** Node 22, TypeScript, Hono/Cloudflare Workers, React, Vitest, node:test, Python contract tooling.

**Spec:** The user's `patternlike-architecture-map-proposed-corrections.md`, R01, R02, R03, R06, and the immediate R07 correction. The supplied original map remains unchanged. Starting checkout: `b5e5fc50673c94641cc6b930812c0398025c1207`.

## Global Constraints

- Retain separate session, deletion-receipt, admin, service, runner, and crypto-operator authority.
- Keep `/health` and `/v1/meta` public.
- Do not change rollout flags, grant contents, production data, release pointers, or deployed settings.
- Preserve frozen schemas and identities; use compatible additive contracts or versioned successors with fixtures and freeze notes.
- Keep suppressed chart features suppressed; exact time with a qualified zone must not become unknown birth time.
- Do not downgrade v2 portrait grants to v1. Revocation retains cancellation and completed-asset policy.
- Compilation, evaluation, human review, signing, and activation are separate claims.
- Preserve historical map captures; capture and verify a new snapshot after source changes.
- Run the final `npm run ci:local` on Node 22 with a real checkout-local `.venv`; local evidence is not deployment evidence.
- R04 operator repair, R05 feedback applicability, R08 reader navigation, and throughput changes are outside this first pass.

## Review Focus

- Exceptions and early refusals must receive private cache policy without changing authority.
- Multiple uncertainty reasons must all be represented; invented reasons must fail.
- Disabled rollout and missing grant storage must produce distinguishable permission states.
- A successful-looking line must never outweigh a failed exit, missing lane, or skipped required validation.
- A compile-only ontology candidate must remain ineligible for release admission.

### Task 1: Shared private-response boundary

**Files:** `apps/api/src/index.ts`, new `apps/api/src/middleware/private-response.ts`, middleware and route tests.

**Interfaces:** Consume Hono middleware context; produce `privateResponsePolicy` applying `Cache-Control: private, no-store` to private API responses and errors. Route authentication stays where it is.

- [x] Add tests for private success and 401/403/404/409/410/429/500/503 responses, including early configuration failure, session exchange, deletion receipt, and sibling authority routes.
- [x] Run new regression coverage and observe the current missing or inconsistent headers.
- [x] Mount one default policy before private route checks, exempting only public health/metadata; remove redundant feature lists and reconcile narrower private headers.
- [x] Run focused middleware, auth, configuration, and route tests.

### Task 2: Typed uncertainty disclosure plan

**Files:** `packages/reading-engine/src/constrained-types.ts`, `constrained-input.ts`, `claim-support.ts`, `candidate-validation.ts`, their tests; Daily publisher/compiler policy and compatible contracts where needed.

**Interfaces:** Derive one deterministic typed plan from stored uncertainty. Input preparation, model packet, and candidate validation consume the same plan; command identities and versioned validation policy bind its semantics.

- [x] Reproduce exact/qualified historical-zone ineligibility with a failing regression; add exact/unqualified, approximate, unknown, combinations, unsupported reason, omitted/invented note, and suppression cases.
- [x] Implement closed, reason-specific disclosures with no generic disclaimer escape.
- [x] Update the affected versioned policy and contract fixtures without changing historical frozen semantics.
- [x] Run reading-engine tests and focused API command/publication tests; report generated artifacts to the integrator.

### Task 3: Portrait state and withdrawal

**Files:** `apps/api/src/services/pattern-portrait.ts`, `pattern-portrait-mesh.ts`, routes/tests, shared portrait types/contracts, `apps/web/src/components/AccountPatternPortrait.tsx`, `PortraitAutomationControl.tsx`, their actual locations/callers, and `apps/codex-runner/src/{runner,index,portrait-invocation}.ts` plus tests.

**Interfaces:** Existing state projections expose supported protocol, generation availability, actual grant state, and allowed actions. Unreadable grants are unknown/unavailable. Withdrawal is allowed independently of generation flags when the grant store and ownership checks are available.

- [x] Add failing tests for enabled grants with rollout disabled, absent storage, no downgrade, and unsupported v2 generation controls.
- [x] Split capability checks from grant reads/revocation, preserve existing transactional cancellation and write-safety checks.
- [x] Make the client offer only supported artwork actions and retain visible withdrawal for existing grants.
- [x] Run portrait route/service and web component tests, including v1/v2, chapter counts, completed assets, and missing schema behavior.
- [x] Check image compatibility before claiming a job, retain runtime checks for drift, and verify an incompatible image CLI consumes no claim while text/mesh remain schedulable.

### Task 4: Canonical gate and receipt evidence

**Files:** `scripts/ci-local.sh`, `scripts/pattern-release/release-evidence.mjs`, release tests, `contracts/validate_schemas.py`, source-map gate configuration, and maintenance documentation.

**Interfaces:** Gate producer and receipt parser share an ASCII summary format and required lane definitions. Receipt creation requires process success and complete passing lane output. A tracked current-map pointer selects an immutable snapshot for stale-map validation.

- [x] Record that the original mis-encoded success line is already repaired at this baseline.
- [x] Add producer/consumer regressions for real emitted output, nonzero exit, missing/duplicate/skipped lanes, malformed output, and stale source identity.
- [x] Implement shared canonical output, mandatory OpenAPI dependencies, and source-map tests/checks as required gate lanes.
- [x] Run release-evidence and contract-tooling tests. The integrator captures the final map and runs the complete gate once source work settles.

### Task 5: Truthful compile-only ontology evidence

**Files:** `apps/api/scripts/build-internal-ontology.ts`, focused builder tests, minimal pattern-engine compile boundary if required, and relevant admission tests/contracts.

**Interfaces:** A compile-only candidate has no evaluation-success or completed-review claim. Structural compilation remains testable independently from release admission; no evaluator evidence is fabricated.

- [x] Execute the actual builder in a regression test and demonstrate its unsupported evaluation-success claim.
- [x] Use a fail-closed representation supported by the current schema, separating structural compilation from release admission if necessary.
- [x] Verify real compile failure is still rejected, compile-only candidates cannot pass admission, and historical evidence stays untouched.
- [x] Run focused builder/compiler/admission tests.

### Task 6: Integration and final evidence

**Files:** generated validators/fingerprints, `docs/architecture/source-map/map.json`, new dated snapshot, source-map README/pointer, and this plan's verification record.

**Interfaces:** All first-pass changes feed a single source snapshot and local gate receipt; deployment fields remain unverified.

- [x] Review integration, update maintained claims/selectors, regenerate affected code artifacts, and preserve older captures.
- [x] Run affected typechecks and focused suites; resolve regressions before the full gate.
- [x] Capture/check the current map and run `npm run ci:local` through the receipt producer, retaining full logs and its paste-ready summary.
- [x] Obtain an independent review, resolve material findings, and rerun affected verification plus the gate if source changes.
- [x] Leave the isolated branch reviewable and report exact local evidence and remaining scope. No push, merge, or deployment is part of this task.

## Verification Record

Focused regressions reproduced the policy gaps before repair. Current focused checks pass for private API boundaries (214), service-worker handling (6), ontology builder (8), Pattern engine (7), Daily engine (177), shared types (107), Daily API integration (247), portrait API (80), portrait web (81), and release/source-map tooling. The complete final gate passed all 16 lanes. Receipt `docs/reviews/artifacts/2026-09-28-architecture-contract-repairs/local-gate-03.json` verifies against 1,629 unchanged source files and current build artifacts with zero problems; deployment remains unverified. The final full run includes 2,803 primary API tests, 913 web tests, and no API teardown error. See the [completion report](../../reviews/2026-09-28-architecture-contract-repairs.md) and actual summary for complete evidence. The two rejected earlier receipts remain preserved; only the final uninterrupted gate supplies the passing claim.

Independent review found an obsolete-policy rewrite in the full-packet fixture generator; its real-script regression now checks preserved policy/history, all 38 candidates, and idempotence. Review also caught the image pre-claim compatibility requirement in the attachment; that bounded runner correction is part of Task 3. Historical map artifacts remain in Git history and their five archived hashes were verified without rewriting them.
