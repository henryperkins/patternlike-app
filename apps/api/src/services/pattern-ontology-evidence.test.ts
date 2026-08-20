import { env } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { contentHash, type PatternOntologyRelease } from "@patternlike/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/helpers.js";
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";
import {
  PatternOntologyEvidenceError,
  commitOntologyPipelineEvidence,
  verifyPatternOntologyEvidence,
  type CommitOntologyPipelineEvidenceInput,
} from "./pattern-ontology-evidence.js";

interface MachineRelease extends PatternOntologyRelease {
  provenance: { origin: "machine_pipeline" };
}

async function release(version = "ontology-evidence-1"): Promise<MachineRelease> {
  const value = syntheticOntologyRelease(version) as MachineRelease;
  value.provenance = { origin: "machine_pipeline" };
  value.evaluation.evaluation_report_hash = `sha256:${"e".repeat(64)}`;
  value.evaluation.regression_passed = false;
  value.evaluation.regression_report_hash = `sha256:${"0".repeat(64)}`;
  value.bundle_hash = await computeOntologyBundleHash(value);
  return value;
}

async function evidenceInput(
  value: MachineRelease,
  overrides: Partial<CommitOntologyPipelineEvidenceInput> = {},
): Promise<CommitOntologyPipelineEvidenceInput> {
  const runId = `ontrun_${value.ontology_version}`;
  const objectKey = `pattern-ontology/pipeline/${runId}/evaluation-report.enc`;
  const opaqueArtifact = `encrypted evaluation artifact for ${value.ontology_version}`;
  await env.ARTIFACTS!.put(objectKey, opaqueArtifact, {
    onlyIf: new Headers({ "if-none-match": "*" }),
  });
  return {
    runId,
    ontologyVersion: value.ontology_version,
    corpusReleaseId: `corpus-${value.ontology_version}`,
    corpusReleaseHash: value.corpus_release_hash,
    corpusLicenseClass: "licensed_excerpt",
    corpusPublicCapable: true,
    activationScope: "public",
    bundleHash: value.bundle_hash,
    evaluationReportHash: value.evaluation.evaluation_report_hash!,
    evaluationArtifactObjectKey: objectKey,
    evaluationArtifactCiphertextHash: await contentHash(opaqueArtifact),
    signingKeyId: "ontology-signing-2026",
    compilerPassed: true,
    evaluatorPassed: true,
    unevaluatedFixtureCount: 0,
    ...overrides,
  };
}

describe("machine ontology evidence", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("commits and verifies a succeeded public-capable receipt against real R2 bytes", async () => {
    const value = await release();
    const input = await evidenceInput(value);

    await commitOntologyPipelineEvidence(env, input);
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      input.signingKeyId,
    );

    expect(verified).toEqual({
      runId: input.runId,
      corpusReleaseId: input.corpusReleaseId,
      activationScope: "public",
      evaluationReportHash: input.evaluationReportHash,
      evidenceSummary: expect.any(String),
    });
  });

  it("does not consult regression fields when verifying evidence", async () => {
    const value = await release("ontology-evidence-no-regression");
    value.evaluation.regression_passed = false;
    delete value.evaluation.regression_report_hash;
    value.bundle_hash = await computeOntologyBundleHash(value);
    const input = await evidenceInput(value);
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).resolves.toMatchObject({ runId: input.runId });
  });

  it("makes an identical evidence commit idempotent and changed evidence immutable", async () => {
    const value = await release("ontology-evidence-replay");
    const input = await evidenceInput(value);

    await commitOntologyPipelineEvidence(env, input);
    await expect(commitOntologyPipelineEvidence(env, input)).resolves.toBeUndefined();
    await expect(
      commitOntologyPipelineEvidence(env, {
        ...input,
        corpusReleaseId: `${input.corpusReleaseId}-changed`,
      }),
    ).rejects.toMatchObject({ code: "ontology_evidence_immutable" });
  });

  it("refuses to commit a receipt before its evaluation artifact exists", async () => {
    const value = await release("ontology-evidence-no-artifact");
    const input = await evidenceInput(value);
    await env.ARTIFACTS!.delete(input.evaluationArtifactObjectKey);

    await expect(commitOntologyPipelineEvidence(env, input)).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_missing",
    });
  });

  it.each([
    ["corpus_release_hash", "ontology_evidence_corpus_mismatch"],
    ["bundle_hash", "ontology_evidence_bundle_mismatch"],
    ["evaluation_report_hash", "ontology_evidence_evaluation_mismatch"],
    ["signing_key_id", "ontology_evidence_signing_key_mismatch"],
  ] as const)("refuses a mismatched %s independently", async (column, code) => {
    const value = await release(`ontology-evidence-mismatch-${column}`);
    const input = await evidenceInput(value);
    await commitOntologyPipelineEvidence(env, input);
    const replacement =
      column === "signing_key_id"
        ? "ontology-signing-other"
        : `sha256:${"9".repeat(64)}`;
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_evidence SET ${column} = ? WHERE run_id = ?`,
    )
      .bind(replacement, input.runId)
      .run();

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code });
  });

  it("refuses a release whose compiler or independent evaluator did not pass", async () => {
    const value = await release("ontology-evidence-failed-evaluator");
    const input = await evidenceInput(value);
    await commitOntologyPipelineEvidence(env, input);
    value.evaluation.evaluator_passed = false;
    value.bundle_hash = await computeOntologyBundleHash(value);
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_evidence
       SET bundle_hash = ?, evaluator_passed = 0
       WHERE run_id = ?`,
    )
      .bind(value.bundle_hash, input.runId)
      .run();

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code: "ontology_evaluation_not_passed" });
  });

  it("refuses public activation backed by an internal synthetic corpus", async () => {
    const value = await release("ontology-evidence-synthetic-public");
    const input = await evidenceInput(value, {
      activationScope: "internal",
      corpusLicenseClass: "internal_synthetic",
      corpusPublicCapable: false,
    });
    await commitOntologyPipelineEvidence(env, input);
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_evidence
       SET activation_scope = 'public'
       WHERE run_id = ?`,
    )
      .bind(input.runId)
      .run();

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code: "ontology_corpus_not_public" });
  });

  it("accepts an internal activation backed by an internal synthetic corpus", async () => {
    const value = await release("ontology-evidence-synthetic-internal");
    const input = await evidenceInput(value, {
      activationScope: "internal",
      corpusLicenseClass: "internal_synthetic",
      corpusPublicCapable: false,
    });
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).resolves.toMatchObject({ activationScope: "internal" });
  });

  it("refuses a deleted or replaced evaluation artifact", async () => {
    const value = await release("ontology-evidence-artifact-tamper");
    const input = await evidenceInput(value);
    await commitOntologyPipelineEvidence(env, input);

    await env.ARTIFACTS!.put(input.evaluationArtifactObjectKey, "changed ciphertext");

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toBeInstanceOf(PatternOntologyEvidenceError);
    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code: "ontology_evaluation_artifact_hash_mismatch" });
  });
});
