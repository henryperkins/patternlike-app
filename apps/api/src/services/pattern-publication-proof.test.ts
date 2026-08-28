import { contentHash, type PatternPlan, type PatternSemanticVerdict, type PatternWriterOutput } from "@patternlike/shared";
import { describe, expect, it } from "vitest";

import type { GeneratePatternCommandV1 } from "./pattern-command.js";
import { buildPatternPublicationProof } from "./pattern-publication-proof.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";
import type { PatternJobRow } from "./pattern-stage-protocol.js";

const pin: PatternPublisherPin = {
  publisher: "codex",
  planner_model: "gpt-5.6-sol",
  planner_reasoning: "high",
  planner_prompt_version: "1.0.1",
  planner_max_output_tokens: 32000,
  writer_model: "gpt-5.6-sol",
  writer_reasoning: "high",
  writer_prompt_version: "1.0.1",
  writer_max_output_tokens: 32000,
  verifier_model: "gpt-5.6-sol",
  verifier_reasoning: "high",
  verifier_prompt_version: "1.0.0-verifier",
  verifier_max_output_tokens: 32000,
  input_max_bytes: 98304,
  selection_policy_version: "1.0.0",
  validation_policy_version: "1.0.0",
};

const planner = {
  schema_version: "0.7.0",
  chapters: [],
  additional_signatures: [],
  omissions: [],
};
const writer = {
  schema_version: "0.7.0",
  title: "Stored candidate",
  summary: "Stored summary",
  sections: [],
} as unknown as PatternWriterOutput;
const verdict = {
  schema_version: "0.7.0",
  verdict: "pass",
  findings: [],
} as unknown as PatternSemanticVerdict;

async function fixture() {
  const planHash = await contentHash(JSON.stringify(planner));
  const candidateHash = await contentHash(JSON.stringify(writer));
  const plan = {
    ...planner,
    plan_hash: planHash,
    sparse_pattern: false,
  } as unknown as PatternPlan;
  const job = {
    generation_id: "pgen_proof",
    job_id: "job_proof",
    user_id: "usr_proof",
    claim_id: "pgc_proof",
    stage: "semantic_verifying",
    stage_generation: 3,
    planner_attempts: 0,
    writer_attempts: 0,
    verifier_attempts: 0,
    plan_hash: planHash,
    candidate_hash: candidateHash,
    semantic_verdict_hash: null,
    locale: "en-US",
    locale_revision: 7,
  } satisfies PatternJobRow;
  const command = {
    generation_id: job.generation_id,
    job_id: job.job_id,
    claim_id: job.claim_id,
    user_id: job.user_id,
    chart_fingerprint_hash: `sha256:${"1".repeat(64)}`,
    feature_set_hash: `sha256:${"2".repeat(64)}`,
    locale: job.locale,
    locale_revision: job.locale_revision,
    consent_id: "cns_proof",
    ontology_version: "ontology-proof",
    ontology_bundle_hash: `sha256:${"3".repeat(64)}`,
    publisher: pin,
  } as GeneratePatternCommandV1;
  const artifacts: Record<string, unknown> = {
    planner_response: planner,
    validated_plan: plan,
    writer_response: writer,
    semantic_verdict: verdict,
  };
  return { artifacts, command, job, planHash, candidateHash };
}

describe("Pattern publication proof", () => {
  it("derives every hash from the stored artifact values", async () => {
    const { artifacts, command, job, planHash, candidateHash } = await fixture();
    const bundle = await buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    });

    expect(bundle.proof).toMatchObject({
      generationId: command.generation_id,
      jobId: command.job_id,
      claimId: command.claim_id,
      planHash,
      candidateHash,
      semanticVerdict: "pass",
      executedWriterPin: pin,
    });
    expect(bundle.plan).toEqual(artifacts.validated_plan);
    expect(bundle.writer).toEqual(writer);
    expect(bundle.proof.semanticVerdictHash).toBe(
      await contentHash(JSON.stringify(verdict)),
    );
  });

  it("rejects candidate bytes that do not match the durable job coordinate", async () => {
    const { artifacts, command, job } = await fixture();
    artifacts.writer_response = { ...writer, title: "Tampered candidate" };

    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "candidate_hash_mismatch",
    });
  });

  it("rejects a non-passing verdict and a writer pin that differs from the frozen command", async () => {
    const { artifacts, command, job } = await fixture();
    artifacts.semantic_verdict = { ...verdict, verdict: "reject" };
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "semantic_verdict_not_pass",
    });

    artifacts.semantic_verdict = verdict;
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: { ...pin, writer_prompt_version: "unexpected" },
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "writer_pin_mismatch",
    });
  });
});
