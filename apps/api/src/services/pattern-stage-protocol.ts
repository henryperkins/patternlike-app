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
