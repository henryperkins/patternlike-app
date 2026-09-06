import { contentHash, type PatternPlan, type PatternSemanticVerdict, type PatternWriterOutput } from "@patternlike/shared";
import { describe, expect, it } from "vitest";

import { loadOntologyRegressionCorpus } from "./ontology-regression.js";
import type { GeneratePatternCommandV2 } from "./pattern-command.js";
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

const corpus = loadOntologyRegressionCorpus();
const chain = corpus.fixtures[0]!.chain;
const { plan_hash: _planHash, sparse_pattern: _sparse, ...planner } = chain.plan;
const writer: PatternWriterOutput = chain.writer;
const verdict: PatternSemanticVerdict = chain.verdict;
const safety = {
  features: corpus.fixtures[0]!.features,
  selectionManifest: chain.selection_manifest,
  packet: chain.fact_packet,
  ontology: corpus.manifest.reference_ontology_records,
  sourceFragmentIds: corpus.source_fragment_ids,
};
const publication = {
  generatedAt: "2026-09-06T00:00:00.000Z",
  provider: "Codex",
  modelFamily: "gpt",
};

async function fixture() {
  const planHash = await contentHash(JSON.stringify(planner));
  const candidateHash = await contentHash(JSON.stringify(writer));
  const plan = {
    ...planner,
    plan_hash: planHash,
    sparse_pattern: chain.fact_packet.selection_constraints.sparse_pattern,
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
    reservation_reason: "first_open",
    pattern_source_hash: `sha256:${"4".repeat(64)}`,
  } satisfies PatternJobRow;
  const command = {
    command_version: "GeneratePatternCommandV2",
    schema_version: "0.9.0",
    generation_id: job.generation_id,
    job_id: job.job_id,
    claim_id: job.claim_id,
    user_id: job.user_id,
    chart_fingerprint_hash: `sha256:${"1".repeat(64)}`,
    feature_set_hash: chain.selection_manifest.feature_set_hash.replace(/^sha256:/, ""),
    locale: job.locale,
    locale_revision: job.locale_revision,
    consent_id: "cns_proof",
    ontology_version: "ontology-proof",
    ontology_bundle_hash: `sha256:${"3".repeat(64)}`,
    pattern_source_hash: job.pattern_source_hash,
    reservation_reason: job.reservation_reason,
    publisher: pin,
  } as GeneratePatternCommandV2;
  const artifacts: Record<string, unknown> = {
    planner_response: planner,
    validated_plan: plan,
    writer_response: writer,
    semantic_verdict: verdict,
    fact_packet: chain.fact_packet,
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
      safety,
      publication,
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
      safety,
      publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "candidate_hash_mismatch",
    });
  });

  it("rejects changed plan contents even if the stored plan hash field is unchanged", async () => {
    const { artifacts, command, job } = await fixture();
    artifacts.validated_plan = { ...artifacts.validated_plan as PatternPlan, omissions: [] };
    (artifacts.validated_plan as PatternPlan).chapters = [];
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      safety,
      publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({ code: "plan_hash_mismatch" });
  });

  it("rejects a fact packet that differs from the frozen planner artifact", async () => {
    const { artifacts, command, job } = await fixture();
    artifacts.fact_packet = { ...chain.fact_packet, uncertainty: { suppressed_classes: [], required_language_rule_ids: [] } };
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      safety,
      publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({ code: "publication_coordinate_mismatch" });
  });

  it("binds the safety policy and exact candidate into a distinct safety receipt", async () => {
    const { artifacts, command, job } = await fixture();
    const first = await buildPatternPublicationProof({
      command, job, executedWriterPin: pin, safety, publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    });
    artifacts.writer_response = { ...writer, title: "A second safe candidate" };
    job.candidate_hash = await contentHash(JSON.stringify(artifacts.writer_response));
    const second = await buildPatternPublicationProof({
      command, job, executedWriterPin: pin, safety, publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    });
    expect(first.proof.safety.policyVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(first.proof.safety.candidateHash).toBe(first.proof.candidateHash);
    expect(second.proof.safety.candidateHash).toBe(second.proof.candidateHash);
    expect(second.proof.safety.resultHash).not.toBe(first.proof.safety.resultHash);
  });

  it("reads the semantic verdict at the current verifier attempt even when an older pass sorts newest", async () => {
    const { artifacts, command, job } = await fixture();
    const currentVerdict: PatternSemanticVerdict = {
      ...verdict,
      findings: [{ code: "semantic_verification_failed", severity: "warning", target_key: null, feature_aliases: [], ontology_rule_ids: [], rationale: "Current candidate note" }],
    };
    const bundle = await buildPatternPublicationProof({
      command, job, executedWriterPin: pin, safety, publication,
      readArtifact: async (artifactClass, coordinate?: { stageGeneration: number; attempt: number }) => {
        if (artifactClass === "semantic_verdict") {
          return coordinate?.stageGeneration === job.stage_generation && coordinate.attempt === job.verifier_attempts
            ? currentVerdict
            : verdict;
        }
        return artifacts[artifactClass] ?? null;
      },
    });
    expect(bundle.proof.semanticVerdictHash).toBe(await contentHash(JSON.stringify(currentVerdict)));
  });

  it("rejects a non-passing verdict and a writer pin that differs from the frozen command", async () => {
    const { artifacts, command, job } = await fixture();
    artifacts.semantic_verdict = { ...verdict, verdict: "reject" };
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: pin,
      safety,
      publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "semantic_verdict_not_pass",
    });

    artifacts.semantic_verdict = verdict;
    await expect(buildPatternPublicationProof({
      command,
      job,
      executedWriterPin: { ...pin, writer_prompt_version: "unexpected" },
      safety,
      publication,
      readArtifact: async (artifactClass) => artifacts[artifactClass] ?? null,
    })).rejects.toMatchObject({
      code: "writer_pin_mismatch",
    });
  });
});
