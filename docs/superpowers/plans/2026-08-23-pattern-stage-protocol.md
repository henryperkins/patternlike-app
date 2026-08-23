# Pattern Stage Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract M7 stage, attempt, artifact-coordinate, and transition semantics into one typed protocol without changing provider calls, publication atomicity, lifecycle behavior, contracts, or rollout.

**Architecture:** `pattern-stage-protocol.ts` becomes the normative owner of durable-execution stage classification, public-stage projection, pass coordinates, legal transitions, counter effects, hash effects, stage-generation effects, and the guarded D1 statements that commit them. `pattern-execute.ts` continues to claim work, load artifacts, call providers, validate outputs, write R2 artifacts, and choose a typed outcome; publication composes the protocol's guards and mutations into its existing all-or-nothing batch. Bulk lifecycle cancellation keeps its documented temporary exception until pull request 3 centralizes its claim mutations.

**Tech Stack:** TypeScript ES modules, Hono Cloudflare Worker, Cloudflare D1/R2/Queues, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-pattern-invariant-kernel-design.md`

## Global Constraints

- Create the execution worktree from the commit containing this plan; its runtime files must still match documentation baseline `a35101d` (approved PR1 over runtime baseline `a9a45b7`).
- Implement only pull request 2 from the approved spec; publication proof, claim-transition guards, and shared provider-boundary JSON remain later pull requests.
- At execution start, invoke `superpowers:using-git-worktrees` and create an isolated feature worktree because the shared checkout contains unrelated user changes.
- Keep planner, deterministic plan validation, writer, deterministic candidate validation, semantic verifier, and guarded publication as separate stages.
- Keep the frozen per-command ceilings unchanged: two planner calls, two or three writer calls as already encoded by `GeneratePatternCommandV1`, and two verifier calls per candidate. The three-writer worst case remains exactly 11 provider calls.
- A successful pass must not increment the pass whose artifact it commits.
- A retry increments only that pass; verifier rejection increments the next writer attempt; a new candidate resets verifier attempts to zero.
- Preserve current cancellation behavior: executor cancellation does not advance `stage_generation`.
- Preserve artifact-first lookup before budget reservation and provider fetch.
- Preserve create-only artifact identity `(generation_id, artifact_class, stage_generation, attempt)`.
- Do not change an M7 schema, fixture, wire response, model pin, prompt pin, retry delay, retention period, rollout value, ontology pointer, or credential mode.
- Do not create or modify a D1 migration; migrations `0001` through `0012` remain byte-identical.
- Do not modify or stage the pre-existing working-tree changes in `docs/deploy/openai-pattern-rollout.md`, `docs/superpowers/plans/2026-08-22-auth0-pattern-canary.md`, or `pattern-ontology-corpus.zip`.
- No test may contact a live provider; use the existing synthetic publisher and hermetic OpenAI mock.

---

## File Map and Ownership

| File | Responsibility after this pull request |
|---|---|
| `apps/api/src/services/pattern-stage-protocol.ts` | Domain/public stage mapping, pass metadata, artifact identity, pure transition planning, legal-transition checks, job-row loading, ownership probes, composable D1 transition statements, and guarded transition commit |
| `apps/api/src/services/pattern-stage-protocol.test.ts` | Primary pure transition table plus focused mapping, coordinate, invalid-transition, and composable-publication tests |
| `apps/api/src/services/pattern-command.ts` | Frozen command version, snapshot type/decoder, job type, reservation reason, and budget-failure retryability only |
| `apps/api/src/services/pattern-execute.ts` | Stage claim, snapshot/eligibility checks, provider orchestration, artifact storage/adoption, deterministic validation, correction-artifact creation, publication document construction, and selection of `PatternTransition` values |
| `apps/api/src/services/pattern-execute-protocol.test.ts` | Existing queue, R2, provider-budget, adoption, retry, publication, and exact-11-call integration coverage |
| `apps/api/src/services/pattern-execute-openai.test.ts` | Existing hermetic OpenAI delivery coverage; imports the durable job loader from the new protocol owner |
| `apps/api/src/services/pattern-enqueue.ts` | Mechanical import of replay-stage projection from the new owner |
| `apps/api/src/services/pattern-state.ts` | Mechanical import of domain/public stage projection from the new owner |
| `apps/api/src/services/pattern-sweep.ts` | Expired-lease recovery keeps its distinct lease guard but consumes the protocol's typed terminal-failure effect instead of recomputing stage generation |
| `apps/api/src/routes/pattern-ai.ts` | Mechanical import of domain/public stage projection from the new owner |
| `apps/api/src/routes/pattern-ai.integration.test.ts` | Direct guarded-transition tests import the new owner rather than executor internals |

The lifecycle service's bulk consent, correction, and recall cancellation SQL is not redesigned here. It does not increment a provider pass counter, and changing its batch shape belongs with the claim-transition consolidation in pull request 3.

---

### Task 1: Define the Pure Stage Protocol

**Files:**
- Create: `apps/api/src/services/pattern-stage-protocol.ts`
- Create: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-command.ts` — stage/public-stage declarations
- Modify: `apps/api/src/services/pattern-enqueue.ts` — stage imports and stored-reservation annotations
- Modify: `apps/api/src/services/pattern-state.ts` — stage/public-stage imports
- Modify: `apps/api/src/services/pattern-sweep.ts` — stage imports and reconciliation classification
- Modify: `apps/api/src/routes/pattern-ai.ts` — stage/public-stage imports
- Modify: `apps/api/src/services/pattern-execute.ts` — protocol metadata, artifact identity, job row, and stage dispatch
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts` — executor/protocol import block

**Interfaces:**
- Consumes: `PatternStageClass` from `pattern-publisher.ts`, `PatternPublicStage` and `sha256Hex` from `@patternlike/shared`.
- Produces: `PatternDomainStage`, `PatternStageOwner`, `PatternStageState`, `PatternAttemptCoordinate`, `PatternTransition`, `PatternTransitionEffect`, `patternStageOwner`, `publicStageFor`, `publicFailureStageFor`, `acceptedReplayStage`, `patternPassProtocol`, `patternAttemptCoordinate`, `patternDeliveryIsCurrent`, `planPatternTransition`, and `patternArtifactId`.

- [ ] **Step 1: Write the failing pure protocol suite**

Create `apps/api/src/services/pattern-stage-protocol.test.ts` with a table that names every approved transition and asserts final state, queue coordinate, and provider authorization:

```ts
import { describe, expect, it } from "vitest";

import {
  acceptedReplayStage,
  patternArtifactId,
  patternAttemptCoordinate,
  patternDeliveryIsCurrent,
  patternPassProtocol,
  patternStageOwner,
  planPatternTransition,
  publicFailureStageFor,
  publicStageFor,
  type PatternStageState,
  type PatternTransition,
} from "./pattern-stage-protocol.js";

const base = (overrides: Partial<PatternStageState> = {}): PatternStageState => ({
  generation_id: "pgen_protocol",
  stage: "planning",
  stage_generation: 7,
  planner_attempts: 0,
  writer_attempts: 0,
  verifier_attempts: 0,
  plan_hash: null,
  candidate_hash: null,
  semantic_verdict_hash: null,
  ...overrides,
});

const at = new Date("2026-08-23T12:00:00.000Z");

const cases: Array<{
  name: string;
  state: PatternStageState;
  transition: PatternTransition;
  expected: {
    stage: PatternStageState["stage"];
    stageGeneration: number;
    attempts: [number, number, number];
    hashes: [string | null, string | null, string | null];
    jobStatus: "queued" | "failed" | "cancelled" | "succeeded";
    queue: { owner: "planner" | "writer" | "verifier" | "publication"; stageGeneration: number; attempt: number | null } | null;
    nextProviderCallAuthorized: boolean;
  };
}> = [
  {
    name: "planning to writing",
    state: base(),
    transition: { kind: "advance", nextStage: "writing", hashes: { planHash: "plan-a" } },
    expected: {
      stage: "writing",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 8, attempt: 0 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "reserved to writing",
    state: base({ stage: "reserved" }),
    transition: { kind: "advance", nextStage: "writing", hashes: { planHash: "plan-a" } },
    expected: {
      stage: "writing",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 8, attempt: 0 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "plan validation to writing",
    state: base({ stage: "plan_validating" }),
    transition: { kind: "advance", nextStage: "writing", hashes: { planHash: "plan-a" } },
    expected: {
      stage: "writing",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 8, attempt: 0 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "planner retry preserves reserved stage",
    state: base({ stage: "reserved" }),
    transition: { kind: "retry", pass: "planner", availableAt: at },
    expected: {
      stage: "reserved",
      stageGeneration: 7,
      attempts: [1, 0, 0],
      hashes: [null, null, null],
      jobStatus: "queued",
      queue: { owner: "planner", stageGeneration: 7, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "writing to semantic verification",
    state: base({ stage: "writing", plan_hash: "plan-a", verifier_attempts: 1 }),
    transition: { kind: "advance", nextStage: "semantic_verifying", hashes: { candidateHash: "candidate-a" } },
    expected: {
      stage: "semantic_verifying",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "verifier", stageGeneration: 8, attempt: 0 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "writer retry",
    state: base({ stage: "writing", plan_hash: "plan-a" }),
    transition: { kind: "retry", pass: "writer", availableAt: null },
    expected: {
      stage: "writing",
      stageGeneration: 7,
      attempts: [0, 1, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 7, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "candidate validation to semantic verification",
    state: base({ stage: "candidate_validating", plan_hash: "plan-a", verifier_attempts: 1 }),
    transition: { kind: "advance", nextStage: "semantic_verifying", hashes: { candidateHash: "candidate-a" } },
    expected: {
      stage: "semantic_verifying",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "verifier", stageGeneration: 8, attempt: 0 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "verifier transport retry",
    state: base({ stage: "semantic_verifying", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "retry", pass: "verifier", availableAt: at },
    expected: {
      stage: "semantic_verifying",
      stageGeneration: 7,
      attempts: [0, 0, 1],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "verifier", stageGeneration: 7, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "verifier recovery retry while publishing",
    state: base({ stage: "publishing", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "retry", pass: "verifier", availableAt: at },
    expected: {
      stage: "publishing",
      stageGeneration: 7,
      attempts: [0, 0, 1],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "verifier", stageGeneration: 7, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "verifier rejection returns to writer",
    state: base({ stage: "semantic_verifying", plan_hash: "plan-a", candidate_hash: "candidate-a", verifier_attempts: 1 }),
    transition: { kind: "return_to_writer", availableAt: null },
    expected: {
      stage: "writing",
      stageGeneration: 8,
      attempts: [0, 1, 1],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 8, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "verifier rejection recovery returns from publishing to writer",
    state: base({ stage: "publishing", plan_hash: "plan-a", candidate_hash: "candidate-a", verifier_attempts: 1 }),
    transition: { kind: "return_to_writer", availableAt: null },
    expected: {
      stage: "writing",
      stageGeneration: 8,
      attempts: [0, 1, 1],
      hashes: ["plan-a", null, null],
      jobStatus: "queued",
      queue: { owner: "writer", stageGeneration: 8, attempt: 1 },
      nextProviderCallAuthorized: true,
    },
  },
  {
    name: "publication retry",
    state: base({ stage: "semantic_verifying", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "publication_retry", availableAt: at },
    expected: {
      stage: "publishing",
      stageGeneration: 7,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "publication", stageGeneration: 7, attempt: null },
      nextProviderCallAuthorized: false,
    },
  },
  {
    name: "publication recovery retry while publishing",
    state: base({ stage: "publishing", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "publication_retry", availableAt: at },
    expected: {
      stage: "publishing",
      stageGeneration: 7,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", null],
      jobStatus: "queued",
      queue: { owner: "publication", stageGeneration: 7, attempt: null },
      nextProviderCallAuthorized: false,
    },
  },
  {
    name: "terminal failure",
    state: base({ stage: "writing", plan_hash: "plan-a", writer_attempts: 2 }),
    transition: { kind: "fail", failureClass: "writer_attempts_exhausted", publicStage: "writing" },
    expected: {
      stage: "failed",
      stageGeneration: 8,
      attempts: [0, 2, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "failed",
      queue: null,
      nextProviderCallAuthorized: false,
    },
  },
  {
    name: "cancellation",
    state: base({ stage: "writing", plan_hash: "plan-a" }),
    transition: { kind: "cancel", reason: "cancel_stale" },
    expected: {
      stage: "cancelled",
      stageGeneration: 7,
      attempts: [0, 0, 0],
      hashes: ["plan-a", null, null],
      jobStatus: "cancelled",
      queue: null,
      nextProviderCallAuthorized: false,
    },
  },
  {
    name: "publication success",
    state: base({ stage: "publishing", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "publish", candidateHash: "candidate-a", semanticVerdictHash: "verdict-a" },
    expected: {
      stage: "succeeded",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", "verdict-a"],
      jobStatus: "succeeded",
      queue: null,
      nextProviderCallAuthorized: false,
    },
  },
  {
    name: "semantic verification publishes directly",
    state: base({ stage: "semantic_verifying", plan_hash: "plan-a", candidate_hash: "candidate-a" }),
    transition: { kind: "publish", candidateHash: "candidate-a", semanticVerdictHash: "verdict-a" },
    expected: {
      stage: "succeeded",
      stageGeneration: 8,
      attempts: [0, 0, 0],
      hashes: ["plan-a", "candidate-a", "verdict-a"],
      jobStatus: "succeeded",
      queue: null,
      nextProviderCallAuthorized: false,
    },
  },
];

describe("Pattern stage protocol", () => {
  it.each(cases)("plans $name", ({ state, transition, expected }) => {
    const effect = planPatternTransition(state, transition, at);
    expect(effect.next.stage).toBe(expected.stage);
    expect(effect.next.stage_generation).toBe(expected.stageGeneration);
    expect([
      effect.next.planner_attempts,
      effect.next.writer_attempts,
      effect.next.verifier_attempts,
    ]).toEqual(expected.attempts);
    expect([
      effect.next.plan_hash,
      effect.next.candidate_hash,
      effect.next.semantic_verdict_hash,
    ]).toEqual(expected.hashes);
    expect(effect.jobStatus).toBe(expected.jobStatus);
    expect(effect.nextQueueCoordinate).toEqual(expected.queue);
    expect(effect.nextProviderCallAuthorized).toBe(expected.nextProviderCallAuthorized);
  });

  it("rejects a retry for a pass that does not own the current stage", () => {
    expect(() => planPatternTransition(
      base({ stage: "writing" }),
      { kind: "retry", pass: "planner", availableAt: null },
      at,
    )).toThrow("planner cannot retry writing");
  });

  it("rejects every transition from a terminal stage", () => {
    expect(() => planPatternTransition(
      base({ stage: "failed" }),
      { kind: "cancel", reason: "cancel_stale" },
      at,
    )).toThrow("terminal Pattern stage cannot transition");
  });

  it("preserves terminal metadata and the current failed-job retention", () => {
    const failed = planPatternTransition(base(), {
      kind: "fail",
      failureClass: "planner_attempts_exhausted",
      publicStage: "organizing_evidence",
    }, at);
    expect(failed).toMatchObject({
      finish: true,
      resultClass: "planner_attempts_exhausted",
      publicFailureStage: "organizing_evidence",
      releaseUnconsumedClaim: true,
      nextProviderCallAuthorized: false,
    });
    expect(failed.retentionExpiresAt?.toISOString()).toBe("2026-09-22T12:00:00.000Z");

    const cancelled = planPatternTransition(base(), {
      kind: "cancel",
      reason: "cancel_stale",
    }, at);
    expect(cancelled).toMatchObject({
      finish: true,
      cancellationReason: "cancel_stale",
      retentionExpiresAt: undefined,
      releaseUnconsumedClaim: true,
      nextProviderCallAuthorized: false,
    });
  });

  it("classifies stale and duplicate delivery without provider authorization", () => {
    const state = base();
    expect(patternDeliveryIsCurrent(state, { generationId: state.generation_id, stageGeneration: 7 })).toBe(true);
    expect(patternDeliveryIsCurrent(state, { generationId: "pgen_other", stageGeneration: 7 })).toBe(false);
    expect(patternDeliveryIsCurrent(state, { generationId: state.generation_id, stageGeneration: 6 })).toBe(false);
    expect(patternDeliveryIsCurrent(base({ stage: "succeeded" }), {
      generationId: state.generation_id,
      stageGeneration: 7,
    })).toBe(false);
  });

  it("owns stage, public-stage, pass, and artifact-coordinate mapping", async () => {
    expect(patternStageOwner("reserved")).toBe("planner");
    expect(patternStageOwner("candidate_validating")).toBe("writer");
    expect(patternStageOwner("semantic_verifying")).toBe("verifier");
    expect(patternStageOwner("publishing")).toBe("publication");
    expect(patternStageOwner("failed")).toBe("terminal");
    expect(publicStageFor("planning")).toBe("organizing_evidence");
    expect(publicStageFor("candidate_validating")).toBe("checking_claims");
    expect(publicStageFor("publishing")).toBe("checking_claims");
    expect(publicFailureStageFor("writing")).toBe("writing");
    expect(publicFailureStageFor("private_stage")).toBeNull();
    expect(acceptedReplayStage("succeeded")).toBe("ready");
    expect(patternPassProtocol("verifier")).toEqual({
      attemptColumn: "verifier_attempts",
      requestArtifactClass: "verifier_request",
      responseArtifactClass: "verifier_response",
      publicFailureStage: "checking_claims",
    });
    expect(patternAttemptCoordinate(base(), "planner")).toEqual({
      generationId: "pgen_protocol",
      pass: "planner",
      stageGeneration: 7,
      attempt: 0,
      requestArtifactClass: "planner_request",
      responseArtifactClass: "planner_response",
    });
    const artifactId = await patternArtifactId("pgen_protocol", "planner_response", 7, 0);
    expect(artifactId).not.toBe(await patternArtifactId("pgen_other", "planner_response", 7, 0));
    expect(artifactId).not.toBe(await patternArtifactId("pgen_protocol", "writer_response", 7, 0));
    expect(artifactId).not.toBe(await patternArtifactId("pgen_protocol", "planner_response", 8, 0));
    expect(artifactId).not.toBe(await patternArtifactId("pgen_protocol", "planner_response", 7, 1));
  });
});
```

- [ ] **Step 2: Run the new suite and verify the missing module failure**

Run:

```bash
npm exec -w @patternlike/api -- vitest run src/services/pattern-stage-protocol.test.ts
```

Expected: FAIL because `./pattern-stage-protocol.js` does not exist.

- [ ] **Step 3: Implement the pure types, mappings, and transition planner**

Create `apps/api/src/services/pattern-stage-protocol.ts` with these public types and closed mappings:

```ts
import {
  PATTERN_PUBLIC_STAGES,
  sha256Hex,
  type PatternPublicStage,
} from "@patternlike/shared";

import type { PatternStageClass } from "./pattern-publisher.js";

export type PatternDomainStage =
  | "reserved"
  | "planning"
  | "plan_validating"
  | "writing"
  | "candidate_validating"
  | "semantic_verifying"
  | "publishing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PatternStageOwner = PatternStageClass | "publication" | "terminal";

export type PatternCancellationReason =
  | "cancel_consent"
  | "cancel_stale"
  | "cancel_ontology";

export interface PatternStageState {
  generation_id: string;
  stage: PatternDomainStage;
  stage_generation: number;
  planner_attempts: number;
  writer_attempts: number;
  verifier_attempts: number;
  plan_hash: string | null;
  candidate_hash: string | null;
  semantic_verdict_hash: string | null;
}

export interface PatternAttemptCoordinate {
  generationId: string;
  pass: PatternStageClass;
  stageGeneration: number;
  attempt: number;
  requestArtifactClass: "planner_request" | "writer_request" | "verifier_request";
  responseArtifactClass: "planner_response" | "writer_response" | "verifier_response";
}

export type PatternTransition =
  | { kind: "advance"; nextStage: "writing"; hashes: { planHash: string } }
  | { kind: "advance"; nextStage: "semantic_verifying"; hashes: { candidateHash: string } }
  | { kind: "retry"; pass: PatternStageClass; availableAt: Date | null }
  | { kind: "return_to_writer"; availableAt: Date | null }
  | { kind: "publication_retry"; availableAt: Date }
  | { kind: "fail"; failureClass: string; publicStage: PatternPublicStage }
  | { kind: "cancel"; reason: PatternCancellationReason }
  | { kind: "publish"; candidateHash: string; semanticVerdictHash: string };

export interface PatternQueueCoordinate {
  owner: Exclude<PatternStageOwner, "terminal">;
  stageGeneration: number;
  attempt: number | null;
}

export interface PatternTransitionEffect {
  transition: PatternTransition;
  next: PatternStageState;
  jobStatus: "queued" | "failed" | "cancelled" | "succeeded";
  availableAt: Date | null | undefined;
  clearDispatchedAt: boolean;
  finish: boolean;
  resultClass: string | undefined;
  publicFailureStage: PatternPublicStage | undefined;
  cancellationReason: PatternCancellationReason | undefined;
  retentionExpiresAt: Date | undefined;
  releaseUnconsumedClaim: boolean;
  nextQueueCoordinate: PatternQueueCoordinate | null;
  nextProviderCallAuthorized: boolean;
}

const PASS_PROTOCOL = {
  planner: {
    attemptColumn: "planner_attempts",
    requestArtifactClass: "planner_request",
    responseArtifactClass: "planner_response",
    publicFailureStage: "organizing_evidence",
  },
  writer: {
    attemptColumn: "writer_attempts",
    requestArtifactClass: "writer_request",
    responseArtifactClass: "writer_response",
    publicFailureStage: "writing",
  },
  verifier: {
    attemptColumn: "verifier_attempts",
    requestArtifactClass: "verifier_request",
    responseArtifactClass: "verifier_response",
    publicFailureStage: "checking_claims",
  },
} as const satisfies Record<PatternStageClass, {
  attemptColumn: "planner_attempts" | "writer_attempts" | "verifier_attempts";
  requestArtifactClass: "planner_request" | "writer_request" | "verifier_request";
  responseArtifactClass: "planner_response" | "writer_response" | "verifier_response";
  publicFailureStage: PatternPublicStage;
}>;

export function patternPassProtocol(pass: PatternStageClass) {
  return PASS_PROTOCOL[pass];
}

export function patternStageOwner(stage: PatternDomainStage): PatternStageOwner {
  if (stage === "reserved" || stage === "planning" || stage === "plan_validating") return "planner";
  if (stage === "writing" || stage === "candidate_validating") return "writer";
  if (stage === "semantic_verifying") return "verifier";
  if (stage === "publishing") return "publication";
  return "terminal";
}

export function publicStageFor(stage: PatternDomainStage): PatternPublicStage | null {
  if (stage === "reserved" || stage === "planning" || stage === "plan_validating") {
    return "organizing_evidence";
  }
  if (stage === "writing") return "writing";
  if (stage === "candidate_validating" || stage === "semantic_verifying" || stage === "publishing") {
    return "checking_claims";
  }
  return null;
}

export function publicFailureStageFor(value: string | null): PatternPublicStage | null {
  return (PATTERN_PUBLIC_STAGES as readonly string[]).includes(value ?? "")
    ? (value as PatternPublicStage)
    : null;
}

export type PatternAcceptedReplayStage = PatternPublicStage | "ready";

export function acceptedReplayStage(stage: PatternDomainStage): PatternAcceptedReplayStage {
  return publicStageFor(stage) ?? (stage === "succeeded" ? "ready" : "organizing_evidence");
}
```

Implement `patternAttemptCoordinate`, `patternDeliveryIsCurrent`, and `patternArtifactId` with the current four-part identity:

```ts
export function patternAttemptCoordinate(
  state: PatternStageState,
  pass: PatternStageClass,
): PatternAttemptCoordinate {
  const protocol = patternPassProtocol(pass);
  return {
    generationId: state.generation_id,
    pass,
    stageGeneration: state.stage_generation,
    attempt: state[protocol.attemptColumn],
    requestArtifactClass: protocol.requestArtifactClass,
    responseArtifactClass: protocol.responseArtifactClass,
  };
}

export function patternDeliveryIsCurrent(
  state: PatternStageState,
  coordinate: { generationId: string; stageGeneration: number },
): boolean {
  return state.generation_id === coordinate.generationId &&
    state.stage_generation === coordinate.stageGeneration &&
    patternStageOwner(state.stage) !== "terminal";
}

export async function patternArtifactId(
  generationId: string,
  artifactClass: string,
  stageGeneration: number,
  attempt: number,
): Promise<string> {
  const digest = await sha256Hex(`${generationId}:${artifactClass}:${stageGeneration}:${attempt}`);
  return `part_${digest.slice(0, 32)}`;
}
```

Implement `planPatternTransition` as one switch. Copy the input state before changing it, reject terminal inputs first, enforce the current owner for `advance`, `retry`, `return_to_writer`, `publication_retry`, and `publish`, and set exactly these effects:

| Kind | Legal owner | Stage generation | Counter effect | Hash effect | Generic job | Claim release |
|---|---|---:|---|---|---|---|
| advance to writing | planner | +1 | none | set plan | queued | no |
| advance to semantic verification | writer | +1 | verifier = 0 | set candidate | queued | no |
| retry | matching pass; verifier also during publication recovery | same | matching pass +1 | preserve | queued | no |
| return to writer | verifier or publication | +1 | writer +1 | clear candidate | queued | no |
| publication retry | verifier or publication | same | none | preserve | queued | no |
| fail | any nonterminal | +1 | none | preserve | failed | yes |
| cancel | any nonterminal | same | none | preserve | cancelled | yes |
| publish | verifier or publication | +1 | none | set candidate and verdict | succeeded | no |

Use the existing 30-day failed-job retention calculation only for `fail`:

```ts
const FAILURE_RETENTION_MS = 30 * 86_400_000;

export function planPatternTransition(
  state: PatternStageState,
  transition: PatternTransition,
  now = new Date(),
): PatternTransitionEffect {
  const owner = patternStageOwner(state.stage);
  if (owner === "terminal") throw new Error("terminal Pattern stage cannot transition");
  const next = { ...state };

  const queued = (
    nextQueueCoordinate: PatternQueueCoordinate,
    availableAt: Date | null | undefined,
    nextProviderCallAuthorized: boolean,
  ): PatternTransitionEffect => ({
    transition,
    next,
    jobStatus: "queued",
    availableAt,
    clearDispatchedAt: true,
    finish: false,
    resultClass: undefined,
    publicFailureStage: undefined,
    cancellationReason: undefined,
    retentionExpiresAt: undefined,
    releaseUnconsumedClaim: false,
    nextQueueCoordinate,
    nextProviderCallAuthorized,
  });

  switch (transition.kind) {
    case "advance": {
      if (transition.nextStage === "writing") {
        if (owner !== "planner") throw new Error(`${owner} cannot advance to writing`);
        next.stage = "writing";
        next.stage_generation += 1;
        next.plan_hash = transition.hashes.planHash;
        return queued({ owner: "writer", stageGeneration: next.stage_generation, attempt: next.writer_attempts }, undefined, true);
      }
      if (owner !== "writer") throw new Error(`${owner} cannot advance to semantic_verifying`);
      next.stage = "semantic_verifying";
      next.stage_generation += 1;
      next.candidate_hash = transition.hashes.candidateHash;
      next.verifier_attempts = 0;
      return queued({ owner: "verifier", stageGeneration: next.stage_generation, attempt: 0 }, undefined, true);
    }
    case "retry": {
      const publicationVerifierRecovery = owner === "publication" && transition.pass === "verifier";
      if (owner !== transition.pass && !publicationVerifierRecovery) {
        throw new Error(`${transition.pass} cannot retry ${state.stage}`);
      }
      const column = patternPassProtocol(transition.pass).attemptColumn;
      next[column] += 1;
      return queued({ owner: transition.pass, stageGeneration: next.stage_generation, attempt: next[column] }, transition.availableAt, true);
    }
    case "return_to_writer": {
      if (owner !== "verifier" && owner !== "publication") throw new Error(`${owner} cannot return to writer`);
      next.stage = "writing";
      next.stage_generation += 1;
      next.writer_attempts += 1;
      next.candidate_hash = null;
      return queued({ owner: "writer", stageGeneration: next.stage_generation, attempt: next.writer_attempts }, transition.availableAt, true);
    }
    case "publication_retry": {
      if (owner !== "verifier" && owner !== "publication") throw new Error(`${owner} cannot retry publication`);
      next.stage = "publishing";
      return queued({ owner: "publication", stageGeneration: next.stage_generation, attempt: null }, transition.availableAt, false);
    }
    case "fail":
      next.stage = "failed";
      next.stage_generation += 1;
      return {
        transition,
        next,
        jobStatus: "failed",
        availableAt: undefined,
        clearDispatchedAt: false,
        finish: true,
        resultClass: transition.failureClass,
        publicFailureStage: transition.publicStage,
        cancellationReason: undefined,
        retentionExpiresAt: new Date(now.getTime() + FAILURE_RETENTION_MS),
        releaseUnconsumedClaim: true,
        nextQueueCoordinate: null,
        nextProviderCallAuthorized: false,
      };
    case "cancel":
      next.stage = "cancelled";
      return {
        transition,
        next,
        jobStatus: "cancelled",
        availableAt: undefined,
        clearDispatchedAt: false,
        finish: true,
        resultClass: undefined,
        publicFailureStage: undefined,
        cancellationReason: transition.reason,
        retentionExpiresAt: undefined,
        releaseUnconsumedClaim: true,
        nextQueueCoordinate: null,
        nextProviderCallAuthorized: false,
      };
    case "publish":
      if (owner !== "verifier" && owner !== "publication") throw new Error(`${owner} cannot publish`);
      next.stage = "succeeded";
      next.stage_generation += 1;
      next.candidate_hash = transition.candidateHash;
      next.semantic_verdict_hash = transition.semanticVerdictHash;
      return {
        transition,
        next,
        jobStatus: "succeeded",
        availableAt: undefined,
        clearDispatchedAt: false,
        finish: true,
        resultClass: undefined,
        publicFailureStage: undefined,
        cancellationReason: undefined,
        retentionExpiresAt: undefined,
        releaseUnconsumedClaim: false,
        nextQueueCoordinate: null,
        nextProviderCallAuthorized: false,
      };
  }
}
```

Move `PatternDomainStage`, `publicStageFor`, `publicFailureStageFor`, and `acceptedReplayStage` out of `pattern-command.ts`. Update the five consumer imports listed in the file map to import them directly from `pattern-stage-protocol.js`; do not leave re-export aliases in `pattern-command.ts`.

In `pattern-enqueue.ts`, replace every inline
`import("./pattern-command.js").PatternDomainStage` annotation with one direct
`import type { PatternDomainStage } from "./pattern-stage-protocol.js"`.

Use `patternStageOwner()` at the executor's top-level dispatch boundary:

```ts
const stageOwner = patternStageOwner(stage);
if (stageOwner === "planner") {
  // existing planner orchestration
}
if (stageOwner === "writer") {
  // existing writer orchestration
}
if (stageOwner === "verifier" || stageOwner === "publication") {
  // existing verifier-adoption and publication orchestration
}
```

The comments stand for the unchanged branch bodies; do not introduce wrapper
functions just to mirror this snippet. In `pattern-sweep.ts`, type the
reconciliation row's `stage` as `PatternDomainStage` and replace the three-value
terminal-stage comparison in `reconcilePatternGeneration()` with
`patternStageOwner(row.stage) === "terminal"`, while retaining the generic-job
terminal-status checks. These changes remove duplicate stage-family lists.

Move `patternArtifactId` and the four pass metadata maps out of `pattern-execute.ts`. In the executor, call `patternPassProtocol(pass)` for attempt-column, request-class, response-class, and public-failure-stage access.

At the start of each planner, writer, and verifier branch, derive the complete
provider coordinate once and use it for the ceiling check plus every
attempt-scoped artifact probe/write:

```ts
const coordinate = patternAttemptCoordinate(claimed.job, "planner");
if (coordinate.attempt >= command.planner_attempts_max) {
  // existing terminal failure outcome
}
const adopted = await getArtifactAt<PatternPlannerOutput>(
  env,
  identity,
  coordinate.generationId,
  coordinate.responseArtifactClass,
  coordinate.stageGeneration,
  coordinate.attempt,
);
```

Apply the same shape to writer and verifier. Change `writeRequestArtifact()` to
accept a `PatternAttemptCoordinate` and use its request class, attempt, and
stage generation. Response writes and the verifier's `semantic_verdict` alias
write must use that same coordinate. Budget-ceiling comparisons remain in the
executor because they are versioned policy, but they read
`coordinate.attempt`; do not re-read an attempt column or reconstruct an
artifact coordinate there.

In `pattern-execute-protocol.test.ts`, import `patternArtifactId` from
`pattern-stage-protocol.js` while keeping executor orchestration and artifact
read helpers imported from `pattern-execute.js`.

- [ ] **Step 4: Run focused tests and typechecking**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-stage-protocol.test.ts \
  src/services/pattern-command.test.ts \
  src/services/pattern-execute-protocol.test.ts \
  src/services/pattern-execute-openai.test.ts \
  src/routes/pattern-ai.integration.test.ts
npm run typecheck
```

Expected: all selected tests pass and every workspace typecheck exits zero.

- [ ] **Step 5: Commit the pure protocol owner**

```bash
git add \
  apps/api/src/services/pattern-stage-protocol.ts \
  apps/api/src/services/pattern-stage-protocol.test.ts \
  apps/api/src/services/pattern-command.ts \
  apps/api/src/services/pattern-enqueue.ts \
  apps/api/src/services/pattern-state.ts \
  apps/api/src/services/pattern-sweep.ts \
  apps/api/src/routes/pattern-ai.ts \
  apps/api/src/services/pattern-execute.ts \
  apps/api/src/services/pattern-execute-protocol.test.ts
git diff --cached --check
git commit -m "api: define Pattern stage protocol"
```

---

### Task 2: Make Non-Publication D1 Transitions Consume the Protocol

**Files:**
- Modify: `apps/api/src/services/pattern-stage-protocol.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts` — job loading, ownership/transition helpers, failure handling, and stage outcomes
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts` — import block and `writes a genuine retry...`
- Modify: `apps/api/src/services/pattern-execute-openai.test.ts` — job-loader import
- Modify: `apps/api/src/services/pattern-sweep.ts` — `failExhaustedPatternJob()` and expired-lease query
- Modify: `apps/api/src/routes/pattern-ai.integration.test.ts` — transition imports, stale-transition tests, and stage-claim ceiling tests

**Interfaces:**
- Consumes: `PatternTransition` and `planPatternTransition` from Task 1; `PATTERN_JOB_TYPE` from `pattern-command.ts`; `Env` from `env.ts`.
- Produces: `PatternJobRow`, `loadPatternJob`, `PatternTransitionStatements`, `buildPatternTransitionStatements`, and `commitPatternTransition`.
- Limitation until Task 3: `commitPatternTransition` refuses `kind: "publish"`; publication must use composable statements so it remains atomic with document insertion and claim acceptance.

- [ ] **Step 1: Change the direct retry test to require the new commit API**

In `pattern-execute-protocol.test.ts`, add `commitPatternTransition` and `loadPatternJob` to the existing import from `pattern-stage-protocol.js`. Replace the direct `retryStage` call with:

```ts
expect(await commitPatternTransition(
  env,
  rewound!,
  "clm_test_retry",
  { kind: "retry", pass: "planner", availableAt: null },
)).not.toBeNull();
```

Keep the existing assertions that `planner_attempts` becomes one, `stage_generation` stays unchanged, and attempt-scoped artifact IDs differ.

- [ ] **Step 2: Run the focused test and verify the missing export failure**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-execute-protocol.test.ts \
  -t "writes a genuine retry"
```

Expected: FAIL because `commitPatternTransition` is not exported yet.

- [ ] **Step 3: Add the durable row and composable statement interfaces**

Extend the import block and then add these interfaces to `pattern-stage-protocol.ts`:

```ts
import type { Env } from "../env.js";
import { PATTERN_JOB_TYPE } from "./pattern-command.js";

export interface PatternJobRow extends PatternStageState {
  job_id: string;
  user_id: string;
  claim_id: string;
  locale: string;
  locale_revision: number;
}

export interface PatternTransitionStatements {
  effect: PatternTransitionEffect;
  guards: D1PreparedStatement[];
  mutations: D1PreparedStatement[];
}

export async function loadPatternJob(
  env: Pick<Env, "DB">,
  generationId: string,
): Promise<PatternJobRow | null> {
  return env.DB.prepare(
    `SELECT generation_id, job_id, user_id, claim_id, stage, stage_generation,
            planner_attempts, writer_attempts, verifier_attempts, plan_hash,
            candidate_hash, semantic_verdict_hash, locale, locale_revision
     FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<PatternJobRow>();
}
```

Add the existing two ownership assertion probes to a private `ownershipProbes()` function in the new module. They must still assert the generic job's `claim_token`, `running` status, and job type, followed by the generation's unchanged `stage_generation` and nonterminal stage.

- [ ] **Step 4: Implement one generalized mutation builder for non-publication transitions**

Implement `buildPatternTransitionStatements()` using the pure effect. Preserve the distinction between `undefined` (leave the column unchanged) and `null` (write SQL NULL):

```ts
export function buildPatternTransitionStatements(
  env: Pick<Env, "DB">,
  job: PatternJobRow,
  token: string,
  transition: PatternTransition,
  now = new Date(),
): PatternTransitionStatements {
  const effect = planPatternTransition(job, transition, now);
  if (transition.kind === "publish") {
    throw new Error("publish transition requires atomic publication composition");
  }
  const nowIso = now.toISOString();
  const writeAvailableAt = effect.availableAt !== undefined;
  const writeResultClass = effect.resultClass !== undefined;
  const writePublicFailureStage = effect.publicFailureStage !== undefined;
  const writeCancellationReason = effect.cancellationReason !== undefined;
  const writeRetention = effect.retentionExpiresAt !== undefined;

  const mutations: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE jobs
       SET status = ?, claim_token = NULL, lease_expires_at = NULL,
           dispatched_at = CASE WHEN ? THEN NULL ELSE dispatched_at END,
           available_at = CASE WHEN ? THEN ? ELSE available_at END,
           finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
           result_class = CASE WHEN ? THEN ? ELSE result_class END
       WHERE id = ? AND claim_token = ? AND status = 'running'`,
    ).bind(
      effect.jobStatus,
      effect.clearDispatchedAt ? 1 : 0,
      writeAvailableAt ? 1 : 0,
      effect.availableAt?.toISOString() ?? null,
      effect.finish ? 1 : 0,
      nowIso,
      writeResultClass ? 1 : 0,
      effect.resultClass ?? null,
      job.job_id,
      token,
    ),
    env.DB.prepare(
      `UPDATE pattern_generation_jobs
       SET stage = ?, stage_generation = ?,
           planner_attempts = ?, writer_attempts = ?, verifier_attempts = ?,
           plan_hash = ?, candidate_hash = ?, semantic_verdict_hash = ?,
           updated_at = ?,
           finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
           public_failure_stage = CASE WHEN ? THEN ? ELSE public_failure_stage END,
           failure_class = CASE WHEN ? THEN ? ELSE failure_class END,
           cancellation_reason = CASE WHEN ? THEN ? ELSE cancellation_reason END,
           retention_expires_at = CASE WHEN ? THEN ? ELSE retention_expires_at END
       WHERE generation_id = ? AND stage_generation = ?
         AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
    ).bind(
      effect.next.stage,
      effect.next.stage_generation,
      effect.next.planner_attempts,
      effect.next.writer_attempts,
      effect.next.verifier_attempts,
      effect.next.plan_hash,
      effect.next.candidate_hash,
      effect.next.semantic_verdict_hash,
      nowIso,
      effect.finish ? 1 : 0,
      nowIso,
      writePublicFailureStage ? 1 : 0,
      effect.publicFailureStage ?? null,
      writeResultClass ? 1 : 0,
      effect.resultClass ?? null,
      writeCancellationReason ? 1 : 0,
      effect.cancellationReason ?? null,
      writeRetention ? 1 : 0,
      effect.retentionExpiresAt?.toISOString() ?? null,
      job.generation_id,
      job.stage_generation,
    ),
  ];

  if (effect.releaseUnconsumedClaim) {
    mutations.push(
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'available', active_generation_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'reserved' AND consumed_at IS NULL
           AND active_generation_id = ?`,
      ).bind(nowIso, job.claim_id, job.generation_id),
    );
  }

  return { effect, guards: ownershipProbes(env, job, token), mutations };
}

export async function commitPatternTransition(
  env: Pick<Env, "DB">,
  job: PatternJobRow,
  token: string,
  transition: Exclude<PatternTransition, { kind: "publish" }>,
  now = new Date(),
): Promise<PatternTransitionEffect | null> {
  try {
    const statements = buildPatternTransitionStatements(env, job, token, transition, now);
    await env.DB.batch([...statements.guards, ...statements.mutations]);
    return statements.effect;
  } catch {
    return null;
  }
}
```

The generalized SQL deliberately writes the pure planner's exact next counters and hashes. It does not use `counter = counter + 1` or `stage_generation = stage_generation + 1`; those decisions exist only in `planPatternTransition`. Returning the committed effect lets queue nudges use `nextQueueCoordinate.stageGeneration` without recomputing `+1` in the executor.

Preserve the current transition-helper failure behavior: a rejected guarded D1
batch returns `null` (formerly `false`) without adding a new transition-specific
log. The baseline helpers contain no `skipped pattern transition` logger to
retain; adding one would be a separate observability change.

- [ ] **Step 5: Migrate executor outcomes to the typed commit**

Move `PatternJobRow`, `loadJob`, and `ownershipProbes` out of `pattern-execute.ts`. Import `PatternJobRow`, `PatternTransition`, `loadPatternJob`, `planPatternTransition`, `commitPatternTransition`, and `buildPatternTransitionStatements` from the new module.

In `pattern-execute-openai.test.ts`, keep `getArtifactAt` imported from
`pattern-execute.js` and import `loadPatternJob` directly from
`pattern-stage-protocol.js`. This is a mechanical owner change; do not add a
compatibility re-export to the executor.

Add one orchestration-only helper. It consumes the protocol's committed queue coordinate and contains no stage arithmetic:

```ts
type QueuedPatternTransition = Extract<
  PatternTransition,
  { kind: "advance" | "retry" | "return_to_writer" }
>;

async function commitAndNudgePatternTransition(
  env: Env,
  job: PatternJobRow,
  token: string,
  transition: QueuedPatternTransition,
): Promise<boolean> {
  const effect = await commitPatternTransition(env, job, token, transition);
  if (!effect?.nextQueueCoordinate) return false;
  await nudgeNextStage(env, job, effect.nextQueueCoordinate.stageGeneration);
  return true;
}
```

Replace each old helper call with an explicit transition:

```ts
if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, {
  kind: "advance",
  nextStage: "writing",
  hashes: { planHash },
}))) {
  return { ok: false, reason: "duplicate", failureClass: "duplicate" };
}

if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, {
  kind: "advance",
  nextStage: "semantic_verifying",
  hashes: { candidateHash },
}))) {
  return { ok: false, reason: "duplicate", failureClass: "duplicate" };
}

if (!(await commitAndNudgePatternTransition(env, job, token, {
  kind: "retry",
  pass,
  availableAt,
}))) {
  return { ok: false, reason: "duplicate", failureClass: "duplicate" };
}

await commitPatternTransition(env, claimed.job, claimed.token, {
  kind: "fail",
  failureClass,
  publicStage: patternPassProtocol(pass).publicFailureStage,
});

await commitPatternTransition(env, claimed.job, claimed.token, {
  kind: "cancel",
  reason: gate,
});
```

For deterministic candidate rejection, derive the correction artifact's next
attempt from the same retry transition that will be committed:

```ts
const transition = {
  kind: "retry",
  pass: "writer",
  availableAt: null,
} as const satisfies PatternTransition;
const planned = planPatternTransition(claimed.job, transition);
const correction = buildCorrectionDocument(
  plan,
  { deterministic: candidate.failures },
  planned.next.writer_attempts,
);
await putArtifact(
  env,
  identity,
  claimed.job,
  "correction_document",
  correction,
  expiresAt,
  planned.next.writer_attempts,
  planned.next.stage_generation,
);
if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, transition))) {
  return { ok: false, reason: "duplicate", failureClass: "duplicate" };
}
```

For semantic rejection, keep `putArtifact()` in the executor because it owns encryption and R2. Derive both the capacity check and successor coordinate from one planned transition, write the correction first, then commit the transition:

```ts
const transition = {
  kind: "return_to_writer",
  availableAt: null,
} as const satisfies PatternTransition;
const planned = planPatternTransition(claimed.job, transition);
if (planned.next.writer_attempts < command.writer_attempts_max) {
  const correction = buildCorrectionDocument(
    plan,
    { semantic: verdict.findings },
    planned.next.writer_attempts,
  );
  await putArtifact(
    env,
    identity,
    claimed.job,
    "correction_document",
    correction,
    expiresAt,
    planned.next.writer_attempts,
    planned.next.stage_generation,
  );
  if (!(await commitAndNudgePatternTransition(env, claimed.job, claimed.token, transition))) {
    return { ok: false, reason: "duplicate", failureClass: "duplicate" };
  }
  return { ok: true, terminal: false };
}
```

Keep the existing terminal `semantic_verification_failed` branch immediately
after that block. Delete `nextWriterAttempt`; no successor attempt or stage
generation is calculated independently in the executor.

Do not add `correctionHash` to D1 or to the transition merely to mirror the design's illustrative type. There is no correction-hash column in the frozen schema; the attempt-scoped create-only artifact remains the durable authority and the existing integration suite verifies it before the state transition.

Replace `releasePublicationRetry()` with:

```ts
await commitPatternTransition(env, claimed.job, claimed.token, {
  kind: "publication_retry",
  availableAt: new Date(now.getTime() + 60_000),
}, now);
```

Delete `advance`, `retryStage`, `returnToWriter`, `failJob`, `cancelJob`, `releasePublicationRetry`, `PASS_ATTEMPT_COLUMN`, `PASS_REQUEST_CLASS`, `PASS_RESPONSE_CLASS`, `PASS_PUBLIC_STAGE`, and `TERMINAL_STAGES` from `pattern-execute.ts` after all call sites use the protocol.

Update `stageMovedOn()` to call `patternDeliveryIsCurrent()` after loading the row. Keep the current fallback: a D1 read error is retryable, not silently classified as duplicate.

- [ ] **Step 6: Migrate direct test imports and characterize exhausted lease failure**

In `pattern-ai.integration.test.ts`, import `commitPatternTransition` and
`loadPatternJob` from `pattern-stage-protocol.js`. Replace direct `failJob` and
`cancelJob` calls with:

```ts
expect(await commitPatternTransition(env, job!, "clm_stale_token_does_not_own", {
  kind: "fail",
  failureClass: "stale_worker",
  publicStage: "checking_claims",
})).toBeNull();

expect(await commitPatternTransition(env, winner!, "clm_stale_loser", {
  kind: "fail",
  failureClass: "stale_loser",
  publicStage: "organizing_evidence",
})).not.toBeNull();

expect(await commitPatternTransition(env, cancelTarget!, "clm_stale_cancel", {
  kind: "cancel",
  reason: "cancel_stale",
})).not.toBeNull();
```

Rename the stale test title from `ignores a stale failJob after another worker
published` to `ignores a stale failure transition after another worker
published` so the suite names the domain behavior rather than the removed
helper. Keep `executePatternJob` and artifact functions imported from
`pattern-execute.ts`; do not re-export transition functions from the executor.

Add a test beside `keeps an eleven-call job recoverable beneath the stage-claim ceiling`
in `pattern-ai.integration.test.ts`. Reuse that test's reservation setup, but
set the generic job to an expired running lease with `attempts = 16`. Capture
the durable row first with `loadPatternJob()`, run `sweepPatternJobs(env, now)`,
then assert:

```ts
const after = await env.DB.prepare(
  `SELECT j.status AS job_status, j.result_class,
          p.stage, p.stage_generation,
          p.planner_attempts, p.writer_attempts, p.verifier_attempts,
          p.plan_hash, p.candidate_hash, p.semantic_verdict_hash,
          p.public_failure_stage, p.failure_class, p.retention_expires_at,
          c.status AS claim_status
   FROM pattern_generation_jobs p
   JOIN jobs j ON j.id = p.job_id
   JOIN pattern_generation_claims c ON c.id = p.claim_id
   WHERE p.generation_id = ?`,
)
  .bind(generationId)
  .first();

expect(after).toEqual({
  job_status: "failed",
  result_class: "stage_attempts_exhausted",
  stage: "failed",
  stage_generation: before!.stage_generation + 1,
  planner_attempts: before!.planner_attempts,
  writer_attempts: before!.writer_attempts,
  verifier_attempts: before!.verifier_attempts,
  plan_hash: before!.plan_hash,
  candidate_hash: before!.candidate_hash,
  semantic_verdict_hash: before!.semantic_verdict_hash,
  public_failure_stage: "organizing_evidence",
  failure_class: "stage_attempts_exhausted",
  retention_expires_at: "2026-09-19T12:00:00.000Z",
  claim_status: "available",
});
```

Use the existing test date `2026-08-20T12:00:00.000Z`, so the exact 30-day
retention timestamp above is deterministic. Run just the two claim-ceiling
tests before refactoring:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/routes/pattern-ai.integration.test.ts \
  -t "stage-claim ceiling|exhausted expired lease"
```

Expected: PASS against current code. This is characterization coverage for a
currently untested mechanism, not a new behavior.

- [ ] **Step 7: Make expired-lease failure consume the same typed effect**

Extend the expired-lease query in `pattern-sweep.ts` to select
`planner_attempts`, `writer_attempts`, `verifier_attempts`, `plan_hash`,
`candidate_hash`, and `semantic_verdict_hash`. Make the row type extend
`PatternStageState`, then plan its terminal effect before building the
expired-lease-specific batch:

```ts
const effect = planPatternTransition(
  row,
  {
    kind: "fail",
    failureClass: "stage_attempts_exhausted",
    publicStage: publicStageFor(row.stage) ?? "organizing_evidence",
  },
  new Date(nowIso),
);
```

Keep the current generic-job lease predicate, claim-release guard, and safe log.
Replace the domain update's `stage_generation = stage_generation + 1` with the
effect's exact values:

```ts
env.DB.prepare(
  `UPDATE pattern_generation_jobs
   SET stage = ?, stage_generation = ?,
       planner_attempts = ?, writer_attempts = ?, verifier_attempts = ?,
       plan_hash = ?, candidate_hash = ?, semantic_verdict_hash = ?,
       updated_at = ?, finished_at = ?, public_failure_stage = ?,
       failure_class = ?, retention_expires_at = ?
   WHERE generation_id = ? AND stage_generation = ?
     AND stage NOT IN ('succeeded', 'failed', 'cancelled')`,
).bind(
  effect.next.stage,
  effect.next.stage_generation,
  effect.next.planner_attempts,
  effect.next.writer_attempts,
  effect.next.verifier_attempts,
  effect.next.plan_hash,
  effect.next.candidate_hash,
  effect.next.semantic_verdict_hash,
  nowIso,
  nowIso,
  effect.publicFailureStage!,
  effect.resultClass!,
  effect.retentionExpiresAt!.toISOString(),
  row.generation_id,
  row.stage_generation,
)
```

This path does not call `commitPatternTransition()` because the sweeper never
owns a stage claim token; it consumes the same pure effect under its existing
expired-lease predicate.

- [ ] **Step 8: Run new-owner and end-to-end protocol tests**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-stage-protocol.test.ts \
  src/services/pattern-execute-protocol.test.ts \
  src/services/pattern-execute-openai.test.ts \
  src/routes/pattern-ai.integration.test.ts
npm run typecheck
```

Expected: all selected tests pass; retry counters, stale-token failures, cancellations, correction artifacts, and the exact 11-call test retain their existing assertions.

- [ ] **Step 9: Commit the durable transition repository**

```bash
git add \
  apps/api/src/services/pattern-stage-protocol.ts \
  apps/api/src/services/pattern-stage-protocol.test.ts \
  apps/api/src/services/pattern-execute.ts \
  apps/api/src/services/pattern-execute-protocol.test.ts \
  apps/api/src/services/pattern-execute-openai.test.ts \
  apps/api/src/services/pattern-sweep.ts \
  apps/api/src/routes/pattern-ai.integration.test.ts
git diff --cached --check
git commit -m "api: centralize Pattern stage transitions"
```

---

### Task 3: Compose Publication Success Through the Protocol

**Files:**
- Modify: `apps/api/src/services/pattern-stage-protocol.ts`
- Modify: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts` — `publishPattern()`
- Modify: `apps/api/src/services/pattern-execute-protocol.test.ts` — `adopts the write-ahead publication intent after a D1 failure`

**Interfaces:**
- Consumes: `PatternTransitionStatements` and the `publish` transition from Tasks 1 and 2.
- Produces: `buildPatternTransitionStatements()` support for `kind: "publish"`; publication remains unavailable through standalone `commitPatternTransition()`.

- [ ] **Step 1: Add a failing composable-publication test**

In `pattern-stage-protocol.test.ts`, add `vi` to the existing Vitest import, use
the Cloudflare test `env`, and define a complete `PatternJobRow` fixture:

```ts
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  buildPatternTransitionStatements,
  commitPatternTransition,
  type PatternTransition,
  type PatternJobRow,
} from "./pattern-stage-protocol.js";

const publicationJob: PatternJobRow = {
  ...base({
    stage: "publishing",
    plan_hash: "plan-a",
    candidate_hash: "candidate-a",
  }),
  job_id: "job_protocol",
  user_id: "usr_protocol",
  claim_id: "pgc_protocol",
  locale: "en-US",
  locale_revision: 1,
};

const publicationTransition = {
  kind: "publish",
  candidateHash: "candidate-a",
  semanticVerdictHash: "verdict-a",
} as const satisfies PatternTransition;

type StandalonePatternTransition = Parameters<typeof commitPatternTransition>[3];
// @ts-expect-error publication must be composed into the enclosing D1 batch
const illegalStandaloneTransition: StandalonePatternTransition = publicationTransition;
void illegalStandaloneTransition;

const standalonePrepare = vi.fn();
const standaloneBatch = vi.fn();
const standaloneEnv = {
  DB: {
    prepare: standalonePrepare,
    batch: standaloneBatch,
  } as unknown as D1Database,
};

it("builds guarded publication mutations without committing them alone", () => {
  const statements = buildPatternTransitionStatements(
    env,
    publicationJob,
    "clm_protocol",
    publicationTransition,
    at,
  );
  expect(statements.effect.next).toMatchObject({
    stage: "succeeded",
    stage_generation: 8,
    candidate_hash: "candidate-a",
    semantic_verdict_hash: "verdict-a",
  });
  expect(statements.effect.releaseUnconsumedClaim).toBe(false);
  expect(statements.guards).toHaveLength(2);
  expect(statements.mutations).toHaveLength(2);
});

it("currently resolves null before D1 when the publication builder refuses standalone commit", async () => {
  standalonePrepare.mockClear();
  standaloneBatch.mockClear();
  await expect(commitPatternTransition(
    standaloneEnv,
    publicationJob,
    "clm_protocol",
    publicationTransition as never,
    at,
  )).resolves.toBeNull();
  expect(standalonePrepare).not.toHaveBeenCalled();
  expect(standaloneBatch).not.toHaveBeenCalled();
});
```

The `@ts-expect-error` assignment is the type-level contract: if standalone
commit ever accepts `publish`, typechecking fails because the directive becomes
unused. The `as never` on the call deliberately bypasses that compile-time
boundary only so the separate runtime behavior can be characterized.

- [ ] **Step 2: Run the publication-unit test and verify the deliberate refusal**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-stage-protocol.test.ts \
  -t "publication"
```

Expected: the composable-builder test FAILS because the builder still throws.
The standalone-commit characterization PASSES: Task 2 catches the builder error,
resolves `null`, and calls neither `DB.prepare` nor `DB.batch`.

- [ ] **Step 3: Permit publish in the statement builder but not standalone commit**

Remove the `publish` refusal from `buildPatternTransitionStatements()`. Keep the standalone API type and runtime guard narrow:

```ts
export async function commitPatternTransition(
  env: Pick<Env, "DB">,
  job: PatternJobRow,
  token: string,
  transition: Exclude<PatternTransition, { kind: "publish" }>,
  now = new Date(),
): Promise<PatternTransitionEffect | null> {
  if ((transition as { kind: string }).kind === "publish") {
    throw new Error("publish transition requires atomic publication composition");
  }
  try {
    const statements = buildPatternTransitionStatements(env, job, token, transition, now);
    await env.DB.batch([...statements.guards, ...statements.mutations]);
    return statements.effect;
  } catch {
    return null;
  }
}
```

Now change the standalone runtime test from its Task 2 characterization to the
final contract, retaining both no-D1 assertions:

```ts
it("throws before D1 when publication is passed to standalone commit", async () => {
  standalonePrepare.mockClear();
  standaloneBatch.mockClear();
  await expect(commitPatternTransition(
    standaloneEnv,
    publicationJob,
    "clm_protocol",
    publicationTransition as never,
    at,
  )).rejects.toThrow("publish transition requires atomic publication composition");
  expect(standalonePrepare).not.toHaveBeenCalled();
  expect(standaloneBatch).not.toHaveBeenCalled();
});
```

This makes the only publication path compositional: callers can place the two ownership guards and two job mutations inside a larger D1 batch, but cannot mark a job succeeded in a separate transaction through `commitPatternTransition()`.

- [ ] **Step 4: Replace publication's duplicated job updates with protocol statements**

In `publishPattern()`, build the transition after the replay intent exists and
inside the existing `try` that maps every post-intent preparation or D1 error to
`publication_commit_failed`. Do not let a statement-preparation error escape to
the executor's ordinary terminal-failure catch after a `claim_consumed` intent
exists:

```ts
const publicationTransition = buildPatternTransitionStatements(
  env,
  claimed.job,
  claimed.token,
  {
    kind: "publish",
    candidateHash,
    semanticVerdictHash: verdictHash,
  },
  now,
);
```

This must be the first statement inside the current `try`; move the `try`
boundary above it. Inside that same `try`, compose the existing transaction in
this order:

```ts
const claimStillReservedProbe = env.DB.prepare(
  `INSERT INTO assertion_probe (id, reason)
   SELECT 1, 'pattern claim no longer reserved'
   WHERE NOT EXISTS (
     SELECT 1 FROM pattern_generation_claims
     WHERE id = ? AND status = 'reserved' AND active_generation_id = ? AND consumed_at IS NULL
   )`,
).bind(command.claim_id, command.generation_id);
const deleteStalePatternDocuments = env.DB.prepare(
  `DELETE FROM pattern_documents WHERE user_id = ? AND chart_fingerprint_hash != ?`,
).bind(identity.userId, command.chart_fingerprint_hash);
const insertPatternDocument = env.DB.prepare(
  `INSERT INTO pattern_documents (
     id, user_id, claim_id, generation_id, chart_fingerprint_hash, ontology_version,
     ontology_bundle_hash, locale, effective_accuracy, document_enc, document_nonce,
     wrapped_document_key_enc, wrapped_document_key_version, wrapped_document_key_nonce,
     content_hash, compact_provenance_json, generated_at, created_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).bind(
  patternId,
  identity.userId,
  command.claim_id,
  command.generation_id,
  command.chart_fingerprint_hash,
  command.ontology_version,
  command.ontology_bundle_hash,
  command.locale,
  accuracy,
  documentEnc,
  b64(nonce),
  Uint8Array.from(atob(wrapped.ciphertext), (ch) => ch.charCodeAt(0)),
  wrapped.keyVersion,
  wrapped.nonce,
  content,
  JSON.stringify(internal.compact_provenance),
  generatedAt,
  generatedAt,
);
const acceptClaim = env.DB.prepare(
  `UPDATE pattern_generation_claims
   SET status = 'accepted', active_generation_id = NULL, consumed_at = ?, accepted_at = ?, updated_at = ?
   WHERE id = ? AND status = 'reserved'`,
).bind(generatedAt, generatedAt, generatedAt, command.claim_id);
const insertPublicationAuditEvent = env.DB.prepare(
  `INSERT INTO audit_events
     (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
   VALUES (?, 'system', ?, 'pattern_generation.published', 'pattern', ?, 'success', 'accepted', ?)`,
).bind(newId("aud"), identity.userId, patternId, generatedAt);

await env.DB.batch([
  claimStillReservedProbe,
  ...publicationTransition.guards,
  ...replay.receiptStatements(env),
  deleteStalePatternDocuments,
  insertPatternDocument,
  acceptClaim,
  ...publicationTransition.mutations,
  insertPublicationAuditEvent,
]);
```

Delete the hand-written `UPDATE jobs SET status = 'succeeded'` and `UPDATE pattern_generation_jobs SET stage = 'succeeded'` statements. Do not move document insertion, claim acceptance, replay receipt, or audit insertion out of this batch.

- [ ] **Step 5: Strengthen the existing publication-retry assertion**

In the existing `adopts the write-ahead publication intent after a D1 failure` test, capture the row before the injected failure and assert after the first failed batch:

```ts
const beforePublication = await loadPatternJob(env, generationId);

// after the injected D1 failure and publication_retry transition
const publishing = await loadPatternJob(env, generationId);
expect(publishing).toMatchObject({
  stage: "publishing",
  stage_generation: beforePublication!.stage_generation,
  planner_attempts: beforePublication!.planner_attempts,
  writer_attempts: beforePublication!.writer_attempts,
  verifier_attempts: beforePublication!.verifier_attempts,
  candidate_hash: beforePublication!.candidate_hash,
});

// after redelivery succeeds
const succeeded = await loadPatternJob(env, generationId);
expect(succeeded).toMatchObject({
  stage: "succeeded",
  stage_generation: beforePublication!.stage_generation + 1,
  candidate_hash: beforePublication!.candidate_hash,
  semantic_verdict_hash: expect.any(String),
});
```

Retain the existing assertions that the first batch creates no D1 replay receipt, consumes no claim, inserts no document, then redelivery adopts the one R2 intent and commits one receipt and one document.

- [ ] **Step 6: Run publication and protocol tests**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-stage-protocol.test.ts \
  src/services/pattern-execute-protocol.test.ts \
  src/services/pattern-replay-ledger.test.ts \
  src/routes/pattern-ai.integration.test.ts
npm run typecheck
```

Expected: all selected tests pass; publication remains atomic and publication retry retains the same stage generation.

- [ ] **Step 7: Commit atomic publication composition**

```bash
git add \
  apps/api/src/services/pattern-stage-protocol.ts \
  apps/api/src/services/pattern-stage-protocol.test.ts \
  apps/api/src/services/pattern-execute.ts \
  apps/api/src/services/pattern-execute-protocol.test.ts
git diff --cached --check
git commit -m "api: compose publication through stage protocol"
```

---

### Task 4: Remove Duplicate Authority and Run the PR2 Gate

**Files:**
- Modify: `apps/api/src/services/pattern-execute.ts` — durable-delivery ownership header
- Verify: `apps/api/src/services/pattern-stage-protocol.ts`
- Verify: `apps/api/src/services/pattern-stage-protocol.test.ts`
- Verify: `apps/api/src/services/pattern-execute-protocol.test.ts`

**Interfaces:**
- Consumes: all protocol interfaces completed in Tasks 1 through 3.
- Produces: one documented protocol owner and evidence that no executor caller writes counters or stage generation independently.

- [ ] **Step 1: Replace the executor's twelve-step ownership header**

Keep the useful delivery sequence, but make ownership explicit:

```ts
// Durable delivery orchestration lives here: claim, snapshot checks, artifact
// adoption, provider call, deterministic validation, and queue nudge.
// pattern-stage-protocol.ts is the sole owner of domain-stage legality,
// attempt arithmetic, stage-generation effects, hash effects, public-stage
// mapping, and guarded job transition statements.
```

Do not duplicate the transition table in the executor comment.

- [ ] **Step 2: Prove duplicate counter and stage-generation writers are gone from the executor**

Run:

```bash
rg -n "planner_attempts\s*=\s*planner_attempts\s*\+|writer_attempts\s*=\s*writer_attempts\s*\+|verifier_attempts\s*=\s*verifier_attempts\s*\+|stage_generation\s*=\s*stage_generation\s*\+" \
  apps/api/src/services/pattern-execute.ts \
  apps/api/src/services/pattern-sweep.ts
rg -n "stage_generation\s*\+\s*1" apps/api/src/services/pattern-execute.ts
```

Expected: no output from either command. `attempt + 1 < attemptsMax`
comparisons remain permitted because ceilings are versioned budget policy; an
artifact coordinate or queue nudge must use the protocol effect instead of
recomputing stage generation or a next-attempt coordinate.

Run:

```bash
rg -n "function (advance|retryStage|returnToWriter|failJob|cancelJob|releasePublicationRetry)|const PASS_(ATTEMPT_COLUMN|REQUEST_CLASS|RESPONSE_CLASS|PUBLIC_STAGE)" \
  apps/api/src/services/pattern-execute.ts
```

Expected: no output.

Run:

```bash
rg -n "TERMINAL_STAGES|stage === \"reserved\"|stage === \"planning\"|stage === \"writing\"|stage === \"candidate_validating\"|stage === \"semantic_verifying\"|stage === \"publishing\"" \
  apps/api/src/services/pattern-execute.ts
```

Expected: no output. Executor pass dispatch must consume
`patternStageOwner(stage)` rather than restating the stage families.

Run:

```bash
rg -n "const attempt = claimed\.job\.(planner_attempts|writer_attempts|verifier_attempts)|const next(Writer)?Attempt =|PASS_(REQUEST|RESPONSE)_CLASS|\"(planner|writer|verifier)_(request|response)\"" \
  apps/api/src/services/pattern-execute.ts
```

Expected: no output. All provider and artifact coordinates come from
`patternAttemptCoordinate()`.

Run:

```bash
if rg -n "planPatternLifecycleCancellation" apps/api/src; then
  echo "unexpected PR2 lifecycle planner"
  exit 1
fi
```

Expected: exit zero with no output. PR2 does not add a lifecycle-cancellation planner or claim
that bulk lifecycle cancellation is protocol-owned; that path remains the
explicit PR3 exception.

- [ ] **Step 3: Run the complete PR2 targeted gate**

Run:

```bash
npm exec -w @patternlike/api -- vitest run \
  src/services/pattern-stage-protocol.test.ts \
  src/services/pattern-command.test.ts \
  src/services/pattern-execute-protocol.test.ts \
  src/services/pattern-execute-openai.test.ts \
  src/services/pattern-lifecycle.test.ts \
  src/services/pattern-replay-ledger.test.ts \
  src/routes/pattern-ai.integration.test.ts
npm run typecheck
```

Expected: every selected suite passes; the existing exact-11-call test still asserts `used_calls: 11`, `planner_calls: 2`, `writer_calls: 3`, and `verifier_calls: 6` without changing that test's expected values.

- [ ] **Step 4: Prove repository freeze conditions**

Run:

```bash
git diff --check
git diff --exit-code a35101d -- \
  db/d1 \
  contracts/m7 \
  packages/shared/src/m7-types.ts \
  apps/api/wrangler.toml \
  apps/api/src/services/pattern-lifecycle.ts
git show HEAD:apps/api/wrangler.toml | rg -n '^PATTERN_AI_ROLLOUT = "off"$'
git status --short
```

Expected:

- no whitespace errors;
- no D1, M7 contract, public M7 type, Wrangler, or bulk lifecycle changes;
- exactly two committed `PATTERN_AI_ROLLOUT = "off"` values; and
- the feature worktree has no uncommitted PR2 files after the planned commits; the original shared checkout's unrelated user files were never copied, staged, or modified by this work.

- [ ] **Step 5: Commit the ownership cleanup if Step 1 changed after Task 3**

```bash
git add apps/api/src/services/pattern-execute.ts
git diff --cached --check
git commit -m "refactor(api): finish Pattern protocol extraction"
```

If Task 3 already included the exact final header and there is no diff, do not create an empty commit.

---

## Pull Request 2 Review Checklist

- [ ] `pattern-stage-protocol.ts` is the only module defining pass-to-counter, pass-to-artifact, domain-to-public-stage, and durable-executor transition-to-stage-generation mappings.
- [ ] PR2 does not define `planPatternLifecycleCancellation` or map bulk lifecycle cancellation into the protocol; `pattern-lifecycle.ts` remains unchanged as the explicit pull-request-3 exception.
- [ ] `pattern-execute.ts` chooses typed transitions and performs orchestration; it does not contain an independent transition table or counter-mutating SQL.
- [ ] Planner success keeps `planner_attempts` unchanged.
- [ ] Writer success keeps `writer_attempts` unchanged and resets `verifier_attempts` to zero.
- [ ] Verifier rejection increments `writer_attempts`, leaves `verifier_attempts` unchanged, and moves to a new stage generation.
- [ ] Same-pass retries increment only the matching pass and retain stage generation.
- [ ] Publication retry retains stage generation, hashes, and counters and authorizes no provider call.
- [ ] Publication success increments stage generation and remains atomic with document insertion and claim acceptance.
- [ ] Cancellation retains current stage generation.
- [ ] Stale and duplicate deliveries perform no provider work.
- [ ] The exact 11-call test is unchanged and passes.
- [ ] No schema, migration, contract, provider pin, rollout, retention, or production state changes.
