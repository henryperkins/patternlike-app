import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  acceptedReplayStage,
  buildPatternTransitionStatements,
  commitPatternTransition,
  patternArtifactId,
  patternAttemptCoordinate,
  patternDeliveryIsCurrent,
  patternPassProtocol,
  patternStageOwner,
  planPatternTransition,
  publicFailureStageFor,
  publicStageFor,
  type PatternJobRow,
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
    name: "provider wait preserves the exact planner coordinate",
    state: base({ stage: "planning", planner_attempts: 1 }),
    transition: { kind: "await_provider" },
    expected: {
      stage: "planning",
      stageGeneration: 7,
      attempts: [1, 0, 0],
      hashes: [null, null, null],
      jobStatus: "queued",
      queue: null,
      nextProviderCallAuthorized: false,
    },
  },
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

  it("holds the outbox marker while awaiting an external provider", () => {
    expect(planPatternTransition(base(), { kind: "await_provider" }, at))
      .toMatchObject({
        clearDispatchedAt: false,
        finish: false,
        releaseUnconsumedClaim: false,
        availableAt: undefined,
        nextQueueCoordinate: null,
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
});
