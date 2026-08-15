# OpenAI Pattern Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the three deterministic stand-ins behind M7 Your Pattern with a real OpenAI provider adapter — planner, writer, and semantic verifier — so an eligible consented reader receives a Pattern organized, written, and independently checked by a model inside the evidence envelope the deterministic selector already produces, instead of the `publisher_unavailable` terminal failure that any non-synthetic pin produces today.

**Architecture:** Keep the existing stage machine, queue, lease, and artifact envelope exactly as they are. Add one shared Responses boundary lifted from the reading publisher, one minimizing packet builder, one prompt module whose strict schemas are derived at module load from `contracts/m7`, and one provider adapter behind a `PatternPublisher` interface with two implementations — `openai` and the existing deterministic stand-ins, which become a selectable publisher rather than dead code. `pattern-execute.ts` changes at exactly four call sites. The deterministic engine proposes nothing and disposes everything: `validatePatternPlan` and `validatePatternCandidate` run unchanged, afterwards.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Queues, D1 and R2, Vitest with the Workers pool, Node test through tsx, Python jsonschema validation, OpenAI Responses API, and npm workspaces.

**Authoritative design:** `docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`. If implementation evidence requires a behavioral change, stop and amend/reapprove the design before changing code.

---

## Resolved open questions

The design lists six points that "may not be resolved silently during implementation." Each is resolved below with its evidence. **Q1 and Q3 change a committed constant or a contract posture and need explicit sign-off before Task 8 and Task 1 respectively; the other four are recorded engineering decisions.**

### Q1 — Writer attempt ceiling: adopt 3, widen the type

M7 design §13.5 specifies three writer attempts against one frozen plan. The frozen command declares `writer_attempts_max: 2` as a *literal type* (`apps/api/src/services/pattern-command.ts:53`) written by `pattern-enqueue.ts:264`. The field has never been read, which is why the disagreement never surfaced.

The design worries that changing the constant "changes the frozen command shape for jobs already enqueued." That risk is empty in production: `PATTERN_AI_ROLLOUT = "off"` in **both** wrangler blocks (`wrangler.toml:151`, `:268`), and production has no ontology release, so no Pattern command has ever been frozen there. Only dev/test rows can carry a `2`.

**Decision:** the enqueuer writes `3`, and the command type widens to `writer_attempts_max: 2 | 3` so any dev-era row still decodes through `isPatternCommand`. Narrow back to `3` once no `2` rows remain. Note `planner_attempts_max` and `verifier_attempts_max` are also literal `2` and are **not** changed — the design specifies three attempts for the writer only.

### Q2 — Verifier visibility of the plan: supply the full plan

Detecting that the writer drifted from its assignment requires seeing the assignment. A reduced projection that strips `working_title` and `purpose` removes framing bias but also removes the verifier's ability to judge whether a section answers the chapter it was assigned.

**Decision:** supply the full frozen plan, as the design specifies. Make the bias risk measurable rather than argued: the evaluation corpus records verifier pass-rate per prompt version, and a pass-rate that does not move when deliberately drifted candidates are injected is the signal to revisit. Task 9 adds that injected-drift case.

### Q3 — `assembly_mode` for the synthetic publisher: no schema bump

`assembly_mode` is `{"type": "string", "const": "constrained_model"}` in both `contracts/m7/pattern-document-internal.schema.json:43` and `pattern-response.schema.json:69`. Adding `deterministic_stand_in` turns a `const` into an `enum`, which is a `schema_version` bump rippling through every `0.7.0` const in the package.

The design frames this as "the M7-to-M8 window is the only cheap time to decide." That framing assumes the defect can reach a reader. It cannot: `resolvePatternPublisherConfiguration` already refuses `PATTERN_PUBLISHER=synthetic` outside development (`pattern-publisher.ts:152-154`), and `checkSecureConfig` calls it on every request and inside `queue()`. A synthetic-authored document is structurally impossible in any environment serving real readers.

**Decision:** do not bump `schema_version`. Task 5 adds a regression test pinning the refusal at `pattern-publisher.ts:152` as the enforcement boundary, and the limitation is recorded in the plan and in a code comment at the synthetic factory. Revisit only if the synthetic publisher is ever proposed for a non-development environment — which would be the actual defect.

### Q4 — Verifier finding vocabulary: closed list in code, not in the contract

`contracts/m7` types `finding.code` as a free-form `{"type": "string", "minLength": 1, "maxLength": 64}` with no enum. The design compiles a closed list in `pattern-prompt.ts` and rejects codes outside it.

**Decision:** keep the list in `pattern-prompt.ts` for this implementation. The vocabulary is prompt-coupled and no live verifier output exists yet; freezing today's guesses into `contracts/m7` as a new `$def` would harden a list written before a single real finding was observed. The manifest permits that `$def` additively at any later date, so nothing is lost by waiting. Promote it after the evaluation corpus has run against a live verifier and the list has stopped changing.

### Q5 — `MAX_STAGE_CLAIMS`: raise 8 → 16

`pattern-sweep.ts:19` sets `MAX_STAGE_CLAIMS = 8`. The pinned per-pass attempt budgets are unreachable beneath it.

**Decision:** raise to 16. This is safe *because* of the budget move in Task 6: once a provider call is charged immediately before the fetch rather than at stage entry, `MAX_STAGE_CLAIMS` bounds claim churn only, and spend stays bounded independently by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`. Raising it without the budget move would raise the spend ceiling too, so Task 6 and Task 8 land in that order.

### Q6 — Cross-pass budget attribution: one ceiling, attribute in logs

`pattern_provider_daily_usage` (`db/d1/0007_ai_generated_pattern.sql:420`) is keyed on `utc_date` alone with a single `used_calls` column. A per-pass dimension means a new primary key, i.e. a migration.

**Decision:** share one ceiling, attribute through the `pass` field in the safe-log arms, as the design specifies. A migration to buy per-pass sub-ceilings is not justified before a single live Pattern has been generated. Revisit before `enabled`, which is out of scope here.

---

## Global Constraints

- The approved design is authoritative. Contract changes are out of scope: `contracts/m0` through `contracts/m6` stay byte-identical, and `contracts/m7` keeps its `schema_version`, every `$id`, every enum, and every required field. This plan expects **no** contract edit at all.
- `packages/pattern-engine` keeps its purity contract (`packages/pattern-engine/src/index.ts:1-12`). `selectPatternEvidence`, `validatePatternPlan`, `validatePatternCandidate`, `stripPrivateEvidence`, and `projectPublicPattern` keep their current behavior byte-for-byte. The adapter lives in `apps/api`.
- Nothing new lands in `packages/shared`. The AGPL calc service imports it, and `LICENSING.md` makes that boundary the open legal question — do not widen it.
- Use test-driven development for every runtime task: add the named failing test, run it and record the expected failure, implement the smallest passing change, then rerun the focused lane.
- Preserve `apps/api/vitest.config.ts` `fileParallelism: false`. API test files share one D1 database and `resetDb()` is not safe across parallel files. Any new table touched by these tests must be added to the FK-ordered delete list in `test/helpers.ts` or it will leak rows between suites.
- The model receives no chart identifier, fingerprint, birth value, consent ID, user ID, source-fragment text, previous Pattern, or personal context. The packet builder must be *structurally* incapable of emitting one — this is a type-level guarantee in Task 2, not a review convention.
- `selected.aliasMap` never leaves the Worker (`packages/pattern-engine/src/types.ts:23`).
- One queue delivery makes at most one provider call per pass. No retry inside the adapter, no second call inside a stage.
- Every provider request and response exists only as an encrypted, expiring R2 artifact under a closed `artifact_class`. Prompt, packet, plan, draft, and prose logging is forbidden. Safe-log arms carry event name, pass, model, prompt version, latency, token counts, failure class, and hashes.
- No new encrypted column. If one becomes necessary, it must be added to `ENCRYPTED_COLUMNS` in `apps/api/src/db/users.ts` or DEK rotation destroys its data — but the design's intent is that none is needed.
- Merging advances no rollout. `PATTERN_AI_ROLLOUT` stays `off` in both wrangler blocks, and no Worker secret is configured as an implicit consequence of this work.
- These lines in `pattern-execute.ts` are load-bearing and must not change semantics: `claimStage`'s three-statement batch and its `assertion_probe` abort (`:136-179`), the `stageMovedOn` fallback (`:180-191`), `ownershipProbes` (`:350-370`), `advance`'s `stage_generation + 1` guard and `dispatched_at = NULL` (`:372-416`), `nudgeNextStage(..., claimed.job.stage_generation + 1)`, the `try` opening above `selectPatternEvidence` (`:600`), the eligibility and ontology rechecks (`:587-618`), and `publishPattern`'s single guarded batch (`:795-856`).

---

## Phase A: Shared boundary, minimized input, and prompts

### Task 1: Extract the shared Responses boundary

**Files:**

- Create: `apps/api/src/services/openai-responses-adapter.ts`
- Create: `apps/api/src/services/openai-responses-adapter.test.ts`
- Modify: `apps/api/src/services/openai-reading-publisher.ts`
- Modify: `apps/api/src/services/reading-publisher.ts`

Lift verbatim from `openai-reading-publisher.ts`: `extractOutputText` (`:57-106`), `retryAfterSeconds` (`:47-55`), the `failure()` helper, and the `PublisherFailureCode` / safe-detail unions. Re-export `resolveAiGatewayRoute`, `responsesUrlFor`, and `AiGatewayRoute` so Pattern does not import the reading module.

These functions carry no reading semantics — the only reading-specific line in `extractOutputText` is its return type, which becomes a generic parameter. Copying instead of extracting would let the two drift on the one behavior that is expensive to rediscover: a refusal part accompanied by text, two text parts, reasoning items ahead of the message.

- [ ] **Step 1: Write the failing shared-boundary test.** Cover the envelope cases directly: a refusal part alongside an `output_text` part resolves to refusal; two text parts is `publisher_output_invalid`, not a silent first-wins; reasoning items preceding the message are skipped; `incomplete_details.reason` of `max_output_tokens` maps to its own safe detail and not to malformed JSON. Assert `responsesUrlFor(null)` is the direct origin and a route yields `…/openai/responses`, never `…/openai/v1/responses`.
- [ ] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts

- [ ] **Step 3: Extract, and prove the reading publisher unchanged.** Move the functions, re-point `openai-reading-publisher.ts` at the new module, and change no reading behavior. The existing reading suite is the regression proof — it must pass untouched.
- [ ] **Step 4: Run both lanes.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts src/services/openai-reading-publisher.test.ts src/config.test.ts
      npm run typecheck -w @patternlike/api

  Expected: all pass, and the reading publisher's test file has **no diff**.
- [ ] **Step 5: Commit.** `api: extract the shared OpenAI Responses boundary`

### Task 2: Add the minimizing Pattern packet builders

**Files:**

- Create: `apps/api/src/services/pattern-packet.ts`
- Create: `apps/api/src/services/pattern-packet.test.ts`

Three builders producing the provider-visible input documents for planner, writer, and verifier from the fact packet, the frozen plan, the authorized ontology records, and nothing else.

Make the guarantee structural. The builders accept narrow input types that do not carry a chart id, fingerprint, birth value, consent id, user id, or alias map, so emitting one is a type error rather than a review miss. Do not accept the wide `selected` object and pick fields off it.

- [ ] **Step 1: Write the failing minimization tests.** Assert each builder's output serializes to a document containing none of the forbidden identifiers, using a deep scan over the serialized JSON against a fixture whose every private value is a recognizable sentinel. Assert `aliasMap` is absent from all three. Assert the byte size is bounded by `PATTERN_INPUT_MAX_BYTES` and that exceeding it is a typed refusal, not a truncation.
- [ ] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/pattern-packet.test.ts

- [ ] **Step 3: Implement the three builders.** Deterministic key order so the same packet yields identical bytes across calls — the artifact hash depends on it.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add minimizing Pattern provider packet builders`

### Task 3: Add the Pattern prompt module and derived strict schemas

**Files:**

- Create: `apps/api/src/services/pattern-prompt.ts`
- Create: `apps/api/src/services/pattern-prompt.test.ts`

Three system policies, three request builders, three output-schema names, the closed verifier finding vocabulary (Q4), and the strict-schema derivation. Exports `PATTERN_PLANNER_PROMPT_VERSION`, `PATTERN_WRITER_PROMPT_VERSION`, `PATTERN_VERIFIER_PROMPT_VERSION` as compiled constants.

Schemas are **derived at module load** from the normative `contracts/m7` documents by stripping the two keywords OpenAI strict mode does not support — not checked in as a second copy. A second copy is a contract that drifts silently.

- [ ] **Step 1: Write the failing prompt and derivation tests.** Assert each derived schema is the contract schema minus exactly the unsupported keywords, with every `required` and every `additionalProperties: false` preserved. Assert the request shape: exact model, reasoning effort, `max_output_tokens`, `store: false`, no background, no tools, no browsing/file-search/code/MCP fields, and `text.format` of type `json_schema` with `strict: true`. Assert prompt-injection resistance: ontology rule text and packet values that read as instructions cannot alter system policy, schema, tools, model, or request fields.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement policies, builders, derivation, and the closed finding vocabulary.** Record the Q4 decision in a module comment: the list lives here until a live corpus stabilizes it.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add Pattern prompt policies and derived strict schemas`

---

## Phase B: The provider boundary

### Task 4: Add the OpenAI Pattern publisher

**Files:**

- Create: `apps/api/src/services/openai-pattern-publisher.ts`
- Create: `apps/api/src/services/openai-pattern-publisher.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`

The provider boundary for all three passes: headers, one `AbortController`, one fetch, hash-before-parse, the ordered post-200 gauntlet, typed failures. The gateway route is a required constructor parameter, never read from `env` here, exactly as `createOpenAiReadingPublisher` now takes it — a default would let a new call site route around the gateway by saying nothing.

Send the same three `cf-aig-*` headers the reading adapter pins, for the same three reasons: `collect-log: false` because gateway logs store prompt and response verbatim, `max-attempts: 1` because a gateway retry makes one delivery into several calls the usage ledger counts as one, and `skip-cache: true` because a cache hit gives two Patterns one `provider_response_hash`.

- [ ] **Step 1: Write the failing adapter tests.** One fetch maximum per pass. Hash computed over the exact response bytes before parsing, then the bytes discarded. Failure mapping: timeout/network/429/retryable-5xx to `publisher_unavailable`, 401/403 to `publisher_auth_failed`, model-not-found to `publisher_model_unavailable`, refusal part to `publisher_refused`, malformed or incomplete output to `publisher_output_invalid`. No provider text, header, URL, or exception message reaches a returned detail or a log. Assert the three `cf-aig-*` headers are present with a route and absent without one.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement the three pass methods.**
- [ ] **Step 4: Extend the hermetic mock.** `mock-calc-service.ts` already routes `AI_GATEWAY_HOST`; add the Pattern pass scenarios keyed by request id or scenario header. Unknown hosts keep failing closed.
- [ ] **Step 5: Run the lane and typecheck.**
- [ ] **Step 6: Commit.** `api: add the OpenAI Pattern provider adapter`

### Task 5: Add the PatternPublisher interface and two factories

**Files:**

- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/config.test.ts`
- Create: `apps/api/src/services/pattern-publisher.test.ts`

Add the interface, `createOpenAiPatternPublisher`, and `createSyntheticPatternPublisher` wrapping the existing `buildDeterministicPlan` (`packages/pattern-engine/src/synthetic.ts:30`), `buildDeterministicWriterOutput` (`:113`), and the module-local `evaluateSemanticVerdict` (`pattern-execute.ts:525`). The `PATTERN_SEMANTIC_FORCE_REJECT` escape moves into the synthetic implementation and keeps its `AUTH_STUB=1` condition.

    export interface PatternPublisher {
      plan(input: PlannerInput, options: PassOptions): Promise<PassResult<PatternPlan>>;
      write(input: WriterInput, options: PassOptions): Promise<PassResult<PatternWriterOutput>>;
      verify(input: VerifierInput, options: PassOptions): Promise<PassResult<PatternSemanticVerdict>>;
    }

    export interface PassOptions {
      requestId: string;
      timeoutMs: number;
      pin: PatternPublisherPin;
    }

- [ ] **Step 1: Write the failing interface and configuration tests.** Include the **Q3 regression test**: `checkSecureConfig` refuses `PATTERN_PUBLISHER=synthetic` outside development, so a `constrained_model` document authored by the stand-ins cannot exist in a reader-serving environment. Add the gateway refusals for the Pattern path — a half-configured pair is `publisher_not_configured`, never a fallback to the direct origin.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement both factories.** Comment the synthetic factory with the Q3 decision and its enforcement line.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add the Pattern publisher interface and two factories`

---

## Phase C: Rewiring the stage machine

### Task 6: Rewire the four edit points and move the budget

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`

Four edit points, and nothing else in the file changes semantics:

1. `:637-640` — the fail-closed guard becomes publisher selection. The gateway route resolves before this point; a half-configured gateway is a terminal `publisher_not_configured`.
2. `:648` — `buildDeterministicPlan(...)` becomes `publisherImpl.plan(...)`. `validatePatternPlan` at `:649` stays verbatim.
3. `:685` — `buildDeterministicWriterOutput(...)` becomes `publisherImpl.write(...)`. `validatePatternCandidate` at `:686` stays verbatim.
4. `:717` — `evaluateSemanticVerdict(env, writer)` becomes `publisherImpl.verify(...)`.

Then move `consumePatternProviderCallBudget` from stage entry to immediately before the fetch, so a delivery that never reaches the provider never spends a unit. Note this is **three** call sites, one per stage class (`:643`, `:670`, `:701`), not one — each moves independently and each must keep charging exactly once. Give artifact identity an attempt component, and compute every hash advanced into D1 over the bytes R2 actually committed — so a provider success followed by a failed D1 advance converges on the first response rather than a second one.

- [ ] **Step 1: Write the failing rewiring tests.** An `openai` pin reaches the adapter instead of failing closed. A synthetic pin still produces the deterministic document in development. A delivery that fails eligibility or ontology recheck spends no budget. A provider success whose D1 advance fails, replayed, converges on the first artifact hash.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Apply the four edits and the budget move.** Touch nothing on the load-bearing list in Global Constraints.
- [ ] **Step 4: Run the Pattern lane and typecheck.**
- [ ] **Step 5: Commit.** `api: wire the Pattern stage machine to the publisher interface`

### Task 7: Derive provenance from the pin that ran

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/safe-log.ts`

`compact_provenance.provider` and `model_family` are the hardcoded literals `"OpenAI"` and `"gpt"` at `pattern-execute.ts:773-774`. Derive both from the publisher pin that actually ran, so stored provenance names the model that wrote the prose. Add the two new closed safe-log arms with their `pass` field — the attribution mechanism the Q6 decision relies on.

- [ ] **Step 1: Write the failing provenance and logging tests.** Assert a synthetic run and an openai run produce different stored `provider`/`model_family`, and that no arm can carry prompt, packet, plan, draft, or prose.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement derivation and the two arms.**
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: derive Pattern provenance from the executed publisher pin`

### Task 8: Apply the resolved constants

**Files:**

- Modify: `apps/api/src/services/pattern-sweep.ts`
- Modify: `apps/api/src/services/pattern-command.ts`
- Modify: `apps/api/src/services/pattern-enqueue.ts`

**Requires Q1 sign-off.** Raise `MAX_STAGE_CLAIMS` from 8 to 16 (Q5) — after Task 6's budget move, not before. Widen `writer_attempts_max` to `2 | 3` and have the enqueuer write `3` (Q1). Leave `planner_attempts_max` and `verifier_attempts_max` at literal `2`.

- [ ] **Step 1: Write the failing constant tests.** A stored dev-era command carrying `writer_attempts_max: 2` still decodes through `isPatternCommand`. A newly frozen command carries `3`. Claim churn up to 16 is permitted while spend stays bounded by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Apply the constants.**
- [ ] **Step 4: Run the Pattern lane and typecheck.**
- [ ] **Step 5: Commit.** `api: adopt the resolved Pattern attempt and claim ceilings`

---

## Phase D: Verification and handoff

### Task 9: Integration, idempotency, and failure-taxonomy tests

**Files:**

- Create: `apps/api/src/services/pattern-execute-openai.test.ts`

Drive the worker's `queue()` export with `createMessageBatch` + `getQueueResult`, against the hermetic mock.

- [ ] **Step 1: Write the integration suite.** One reader's one Pattern claim produces at most one accepted document despite duplicate delivery, an expired lease, and a provider success whose D1 advance failed. A timeout, refusal, budget exhaustion, and exhausted attempt budget each produce an honest failed state with a coarse public stage and no prose. Include the **Q2 injected-drift case**: a candidate deliberately drifted from its plan assignment must be caught by the verifier, proving the full-plan input earns its framing-bias cost.
- [ ] **Step 2: Run, implement any gaps, rerun.**
- [ ] **Step 3: Commit.** `api: add Pattern adapter integration and idempotency tests`

### Task 10: Full candidate gate and rollout handoff

**Files:**

- Create: `docs/deploy/openai-pattern-rollout.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full gate.**

      npm run typecheck
      npm test
      npm run build
      python contracts/validate_schemas.py

  Expected: all exit 0, and `contracts/m7` proven byte-identical — this plan expects no contract edit.
- [ ] **Step 2: Write the rollout runbook.** Transcribe the design's ten ordered gates, each with its evidence requirement and stop condition, and an empty ledger table. Carry the design's worst-case spend requirement verbatim: 14 provider attempts per Pattern × pinned token bounds × current model rates × maximum new Patterns per UTC day, against `PATTERN_DAILY_PROVIDER_CALL_LIMIT`, approved in writing before any non-`off` rollout.
- [ ] **Step 3: Record the invariants that span files in `CLAUDE.md`.** The four edit points, the derived-not-copied schema rule, the structural minimization guarantee, and the Q1/Q3 decisions with their enforcement lines.
- [ ] **Step 4: Commit.** `docs: add the Pattern adapter rollout runbook and invariants`

---

## Dependency and checkpoint map

    Task 1 (shared boundary) ─┬─> Task 4 (adapter) ──> Task 5 (interface) ──> Task 6 (rewire) ─┬─> Task 7 (provenance)
    Task 2 (packet) ──────────┤                                                                └─> Task 8 (constants, needs Q1)
    Task 3 (prompts) ─────────┘
                                                              Task 6 + 7 + 8 ──> Task 9 (integration) ──> Task 10 (gate + runbook)

**Checkpoints.**

- After Task 1: the reading publisher's behavior is unchanged and its test file has no diff.
- After Task 3: no provider call exists yet; Phase A is pure input construction and is fully testable offline.
- After Task 5: `pattern-execute.ts` is still untouched and production behavior is byte-identical.
- After Task 6: an `openai` pin reaches a provider in test only; `PATTERN_AI_ROLLOUT` is still `off` everywhere.
- After Task 10: the code is a rollout candidate. It is not deployed, no secret is set, and no rollout has moved.

**Sign-off gates.** Q1 blocks Task 8. Q3 blocks Task 5's regression test only in the sense that reversing the decision would require a `schema_version` bump and a much larger plan. Both decisions are recorded above with their evidence; neither may be reversed silently during implementation.
