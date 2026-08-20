import { env } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import {
  canonicalJson,
  contentHash,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/helpers.js";
import {
  buildTestCorpusManifest,
  buildTestEvaluationArtifact,
  putTestCorpusManifest,
  putTestEvaluationArtifact,
  type TestCorpusLicenseClass,
  type TestCorpusManifest,
  type TestEvaluationArtifactEnvelope,
} from "../../test/ontology-pipeline-fixtures.js";
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

type EvidenceInputWithEnvelope = CommitOntologyPipelineEvidenceInput & {
  evaluationArtifactEnvelopeHash: string;
};

interface EvidenceFixture {
  input: EvidenceInputWithEnvelope;
  corpus: TestCorpusManifest;
  corpusObjectKey: string;
  artifact: Awaited<ReturnType<typeof buildTestEvaluationArtifact>>;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

async function release(version = "ontology-evidence-1"): Promise<MachineRelease> {
  const value = syntheticOntologyRelease(version) as MachineRelease;
  value.provenance = { origin: "machine_pipeline" };
  value.status = "candidate";
  value.evaluation.regression_passed = false;
  value.evaluation.regression_report_hash = `sha256:${"0".repeat(64)}`;
  return value;
}

async function evidenceFixture(
  value: MachineRelease,
  options: {
    activationScope?: "internal" | "public";
    corpusLicenseClass?: TestCorpusLicenseClass;
    corpusPublicCapable?: boolean;
    inputOverrides?: Partial<EvidenceInputWithEnvelope>;
  } = {},
): Promise<EvidenceFixture> {
  const runId = `ontrun_${value.ontology_version}`;
  const corpusReleaseId = `corpus-${value.ontology_version}`;
  const corpusLicenseClass =
    options.corpusLicenseClass ?? "licensed_excerpt";
  const corpus = await buildTestCorpusManifest(
    corpusReleaseId,
    value.locale,
    corpusLicenseClass,
  );
  const corpusObjectKey = await putTestCorpusManifest(env.ARTIFACTS!, corpus);
  value.corpus_release_hash = corpus.corpus_hash;
  const evaluationReport = canonicalJson({
    compiler_passed: true,
    evaluator_passed: true,
    ontology_version: value.ontology_version,
    schema_version: "0.7.0",
    unevaluated_fixture_count: 0,
  });
  const artifact = await buildTestEvaluationArtifact(
    runId,
    value.ontology_version,
    evaluationReport,
  );
  value.evaluation.evaluation_report_hash = artifact.plaintextHash;
  value.bundle_hash = await computeOntologyBundleHash(value);
  const objectKey = await putTestEvaluationArtifact(
    env.ARTIFACTS!,
    runId,
    artifact.bytes,
  );
  const input: EvidenceInputWithEnvelope = {
    runId,
    ontologyVersion: value.ontology_version,
    corpusReleaseId,
    corpusReleaseHash: value.corpus_release_hash,
    corpusLicenseClass,
    corpusPublicCapable:
      options.corpusPublicCapable ?? corpusLicenseClass === "licensed_excerpt",
    activationScope: options.activationScope ?? "public",
    bundleHash: value.bundle_hash,
    evaluationReportHash: artifact.plaintextHash,
    evaluationArtifactObjectKey: objectKey,
    evaluationArtifactEnvelopeHash: artifact.envelopeHash,
    evaluationArtifactCiphertextHash: artifact.ciphertextHash,
    signingKeyId: "ontology-signing-2026",
    compilerPassed: true,
    evaluatorPassed: true,
    unevaluatedFixtureCount: 0,
    ...options.inputOverrides,
  };
  return {
    input,
    corpus,
    corpusObjectKey,
    artifact,
  };
}

async function replaceArtifactEnvelope(
  fixture: EvidenceFixture,
  envelope: TestEvaluationArtifactEnvelope,
  bytes = canonicalJson(envelope),
): Promise<void> {
  await env.ARTIFACTS!.put(fixture.input.evaluationArtifactObjectKey, bytes);
  fixture.input.evaluationArtifactEnvelopeHash = await contentHash(bytes);
}

describe("machine ontology evidence", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("commits and verifies a succeeded public-capable receipt against real R2 bytes", async () => {
    const value = await release();
    const { input, artifact } = await evidenceFixture(value);

    await commitOntologyPipelineEvidence(env, input);
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      input.signingKeyId,
    );

    expect(artifact.bytes).not.toContain("\"compiler_passed\"");
    expect(verified).toEqual({
      runId: input.runId,
      ontologyVersion: input.ontologyVersion,
      corpusReleaseId: input.corpusReleaseId,
      corpusReleaseHash: input.corpusReleaseHash,
      corpusLicenseClass: "licensed_excerpt",
      corpusPublicCapable: true,
      activationScope: "public",
      bundleHash: input.bundleHash,
      evaluationReportHash: input.evaluationReportHash,
      evaluationArtifactObjectKey: input.evaluationArtifactObjectKey,
      evaluationArtifactEnvelopeHash:
        input.evaluationArtifactEnvelopeHash,
      evaluationArtifactCiphertextHash:
        input.evaluationArtifactCiphertextHash,
      signingKeyId: input.signingKeyId,
      compilerPassed: true,
      evaluatorPassed: true,
      unevaluatedFixtureCount: 0,
      evidenceSummary: expect.any(String),
    });
  });

  it("accepts a locale admitted by the frozen corpus contract", async () => {
    const value = await release("ontology-evidence-contract-locale");
    value.locale = "en-abcdefghij";
    const { input } = await evidenceFixture(value);

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).resolves.toBeUndefined();
  });

  it("does not consult regression fields when verifying evidence", async () => {
    const value = await release("ontology-evidence-no-regression");
    value.evaluation.regression_passed = false;
    delete value.evaluation.regression_report_hash;
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).resolves.toMatchObject({ runId: input.runId });
  });

  it("makes an identical evidence commit idempotent and changed evidence immutable", async () => {
    const value = await release("ontology-evidence-replay");
    const { input } = await evidenceFixture(value);

    await commitOntologyPipelineEvidence(env, input);
    await expect(commitOntologyPipelineEvidence(env, input)).resolves.toBeUndefined();
    await expect(
      commitOntologyPipelineEvidence(env, {
        ...input,
        signingKeyId: "ontology-signing-changed",
      }),
    ).rejects.toMatchObject({ code: "ontology_evidence_immutable" });
  });

  it("refuses to commit a receipt before its evaluation artifact exists", async () => {
    const value = await release("ontology-evidence-no-artifact");
    const { input } = await evidenceFixture(value);
    await env.ARTIFACTS!.delete(input.evaluationArtifactObjectKey);

    await expect(commitOntologyPipelineEvidence(env, input)).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_missing",
    });
  });

  it.each([
    ["plaintext_hash", "ontology_evaluation_artifact_plaintext_mismatch"],
    ["ciphertext", "ontology_evaluation_artifact_ciphertext_hash_mismatch"],
    ["run_id", "ontology_evaluation_artifact_identity_mismatch"],
    ["ontology_version", "ontology_evaluation_artifact_identity_mismatch"],
    ["artifact_class", "ontology_evaluation_artifact_invalid"],
  ] as const)(
    "refuses a committed artifact whose %s is not bound to the receipt",
    async (field, code) => {
      const value = await release(`ontology-evidence-artifact-${field}`);
      const fixture = await evidenceFixture(value);
      const envelope = structuredClone(fixture.artifact.envelope);
      if (field === "plaintext_hash") {
        envelope.plaintext_hash = `sha256:${"9".repeat(64)}`;
      } else if (field === "ciphertext") {
        envelope.ciphertext =
          `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
      } else if (field === "run_id") {
        envelope.run_id = `${fixture.input.runId}-different`;
      } else if (field === "ontology_version") {
        envelope.ontology_version =
          `${fixture.input.ontologyVersion}-different`;
      } else {
        (envelope as { artifact_class: string }).artifact_class =
          "regression_report";
      }
      await replaceArtifactEnvelope(fixture, envelope);

      await expect(
        commitOntologyPipelineEvidence(env, fixture.input),
      ).rejects.toMatchObject({ code });
    },
  );

  it("refuses noncanonical evaluation artifact envelope bytes", async () => {
    const value = await release("ontology-evidence-artifact-noncanonical");
    const fixture = await evidenceFixture(value);
    const noncanonical = JSON.stringify(fixture.artifact.envelope);
    expect(noncanonical).not.toBe(canonicalJson(fixture.artifact.envelope));
    await replaceArtifactEnvelope(
      fixture,
      fixture.artifact.envelope,
      noncanonical,
    );

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_noncanonical",
    });
  });

  it("hashes exact artifact bytes and refuses malformed UTF-8", async () => {
    const value = await release("ontology-evidence-artifact-utf8");
    const fixture = await evidenceFixture(value);
    const canonical = new TextEncoder().encode(fixture.artifact.bytes);
    const malformed = new Uint8Array(canonical.byteLength + 1);
    malformed.set(canonical);
    malformed[malformed.length - 1] = 0xff;
    fixture.input.evaluationArtifactEnvelopeHash =
      await hashBytes(malformed);
    await env.ARTIFACTS!.put(
      fixture.input.evaluationArtifactObjectKey,
      malformed,
    );

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_invalid",
    });
  });

  it("refuses a declared envelope hash that does not match the R2 object", async () => {
    const value = await release("ontology-evidence-artifact-envelope-hash");
    const { input } = await evidenceFixture(value);
    input.evaluationArtifactEnvelopeHash = `sha256:${"7".repeat(64)}`;

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_envelope_hash_mismatch",
    });
  });

  it.each([
    ["corpus_release_hash", "ontology_evidence_corpus_mismatch"],
    ["bundle_hash", "ontology_evidence_bundle_mismatch"],
    ["evaluation_report_hash", "ontology_evidence_evaluation_mismatch"],
    ["signing_key_id", "ontology_evidence_signing_key_mismatch"],
  ] as const)("refuses a mismatched %s independently", async (field, code) => {
    const value = await release(`ontology-evidence-mismatch-${field}`);
    const { input } = await evidenceFixture(value);
    if (field === "corpus_release_hash") {
      value.corpus_release_hash = `sha256:${"9".repeat(64)}`;
      value.bundle_hash = await computeOntologyBundleHash(value);
      input.bundleHash = value.bundle_hash;
    } else if (field === "bundle_hash") {
      input.bundleHash = `sha256:${"9".repeat(64)}`;
    } else if (field === "evaluation_report_hash") {
      value.evaluation.evaluation_report_hash = `sha256:${"9".repeat(64)}`;
      value.bundle_hash = await computeOntologyBundleHash(value);
      input.bundleHash = value.bundle_hash;
    } else {
      input.signingKeyId = "ontology-signing-other";
    }
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      verifyPatternOntologyEvidence(
        env,
        value,
        field === "signing_key_id"
          ? "ontology-signing-2026"
          : input.signingKeyId,
      ),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    "declared-id",
    "declared-hash",
    "fragment-id",
    "fragment-id-shape",
    "fragment-locale",
    "unresolved-license",
  ] as const)(
    "refuses a corpus manifest with invalid %s identity",
    async (failure) => {
      const value = await release(`ontology-evidence-corpus-${failure}`);
      const fixture = await evidenceFixture(value);
      const manifest = structuredClone(fixture.corpus);
      if (failure === "declared-id") {
        manifest.corpus_release_id = `${manifest.corpus_release_id}-other`;
      } else if (failure === "declared-hash") {
        manifest.corpus_hash = `sha256:${"8".repeat(64)}`;
      } else if (failure === "fragment-id") {
        manifest.fragments[0]!.corpus_release_id = "corpus-other";
      } else if (failure === "fragment-id-shape") {
        manifest.fragments[0]!.id = `srcf_${"g".repeat(32)}`;
        const { corpus_hash: _hash, ...payload } = manifest;
        manifest.corpus_hash = await contentHash(canonicalJson(payload));
      } else if (failure === "fragment-locale") {
        manifest.fragments[0]!.locale = "fr-FR";
      } else {
        (manifest as unknown as { license_resolved: boolean })
          .license_resolved = false;
      }
      await env.ARTIFACTS!.put(
        fixture.corpusObjectKey,
        canonicalJson(manifest),
      );

      await expect(
        commitOntologyPipelineEvidence(env, fixture.input),
      ).rejects.toMatchObject({
        code: failure === "declared-hash"
          ? "ontology_corpus_manifest_hash_mismatch"
          : "ontology_corpus_manifest_invalid",
      });
    },
  );

  it("refuses noncanonical corpus manifest bytes", async () => {
    const value = await release("ontology-evidence-corpus-noncanonical");
    const fixture = await evidenceFixture(value);
    const noncanonical = JSON.stringify(fixture.corpus);
    expect(noncanonical).not.toBe(canonicalJson(fixture.corpus));
    await env.ARTIFACTS!.put(fixture.corpusObjectKey, noncanonical);

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_corpus_manifest_noncanonical",
    });
  });

  it("hashes exact corpus bytes and refuses malformed UTF-8", async () => {
    const value = await release("ontology-evidence-corpus-malformed-utf8");
    const fixture = await evidenceFixture(value);
    const manifest = structuredClone(fixture.corpus);
    manifest.fragments[0]!.excerpt = "\ufffd";
    const { corpus_hash: _hash, ...payload } = manifest;
    manifest.corpus_hash = await contentHash(canonicalJson(payload));
    fixture.input.corpusReleaseHash = manifest.corpus_hash;
    const canonical = new TextEncoder().encode(canonicalJson(manifest));
    const replacement = new TextEncoder().encode("\ufffd");
    const replacementAt = canonical.findIndex(
      (byte, index) =>
        byte === replacement[0] &&
        canonical[index + 1] === replacement[1] &&
        canonical[index + 2] === replacement[2],
    );
    expect(replacementAt).toBeGreaterThan(-1);
    const malformed = new Uint8Array(canonical.byteLength - 2);
    malformed.set(canonical.slice(0, replacementAt));
    malformed[replacementAt] = 0x80;
    malformed.set(
      canonical.slice(replacementAt + replacement.byteLength),
      replacementAt + 1,
    );
    await env.ARTIFACTS!.put(fixture.corpusObjectKey, malformed);

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_corpus_manifest_invalid",
    });
  });

  it("refuses a release whose compiler or independent evaluator did not pass", async () => {
    const value = await release("ontology-evidence-failed-evaluator");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    value.evaluation.evaluator_passed = false;

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code: "ontology_evaluation_not_passed" });
  });

  it("refuses public activation backed by an internal synthetic corpus", async () => {
    const value = await release("ontology-evidence-synthetic-public");
    const { input } = await evidenceFixture(value, {
      activationScope: "public",
      corpusLicenseClass: "internal_synthetic",
      corpusPublicCapable: false,
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({ code: "ontology_corpus_not_public" });
  });

  it("accepts an internal activation backed by an internal synthetic corpus", async () => {
    const value = await release("ontology-evidence-synthetic-internal");
    const { input } = await evidenceFixture(value, {
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
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);

    await env.ARTIFACTS!.put(
      input.evaluationArtifactObjectKey,
      canonicalJson({
        replacement: "not the committed encrypted envelope",
      }),
    );

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toBeInstanceOf(PatternOntologyEvidenceError);
    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_envelope_hash_mismatch",
    });
  });

  it("refuses a corpus manifest replaced after evidence commit", async () => {
    const value = await release("ontology-evidence-corpus-tamper");
    const fixture = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, fixture.input);
    const changed = structuredClone(fixture.corpus);
    changed.fragments[0]!.excerpt += " changed";
    await env.ARTIFACTS!.put(
      fixture.corpusObjectKey,
      canonicalJson(changed),
    );

    await expect(
      verifyPatternOntologyEvidence(
        env,
        value,
        fixture.input.signingKeyId,
      ),
    ).rejects.toMatchObject({
      code: "ontology_corpus_manifest_hash_mismatch",
    });
  });

  it("makes committed evidence identity immutable at the SQL boundary", async () => {
    const value = await release("ontology-evidence-sql-immutable");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_evidence
         SET signing_key_id = 'changed' WHERE run_id = ?`,
      )
        .bind(input.runId)
        .run(),
    ).rejects.toThrow();
    const row = await env.DB.prepare(
      `SELECT signing_key_id FROM pattern_ontology_pipeline_evidence
       WHERE run_id = ?`,
    )
      .bind(input.runId)
      .first<{ signing_key_id: string }>();
    expect(row?.signing_key_id).toBe(input.signingKeyId);
  });

  it("enforces public corpus capability at the SQL boundary", async () => {
    const value = await release("ontology-evidence-sql-public-check");
    const { input } = await evidenceFixture(value);
    const now = new Date().toISOString();

    await expect(
      env.DB.prepare(
        `INSERT INTO pattern_ontology_pipeline_evidence (
           run_id, ontology_version, corpus_release_id, corpus_release_hash,
           corpus_license_class, corpus_public_capable, activation_scope,
           bundle_hash, evaluation_report_hash,
           evaluation_artifact_object_key,
           evaluation_artifact_envelope_hash,
           evaluation_artifact_ciphertext_hash,
           evaluation_artifact_status, signing_key_id, run_status,
           evidence_status, compiler_passed, evaluator_passed,
           unevaluated_fixture_count, created_at, committed_at
         ) VALUES (
           ?, ?, ?, ?, 'internal_synthetic', 0, 'public', ?, ?, ?, ?, ?,
           'committed', ?, 'succeeded', 'committed', 1, 1, 0, ?, ?
         )`,
      )
        .bind(
          input.runId,
          input.ontologyVersion,
          input.corpusReleaseId,
          input.corpusReleaseHash,
          input.bundleHash,
          input.evaluationReportHash,
          input.evaluationArtifactObjectKey,
          input.evaluationArtifactEnvelopeHash,
          input.evaluationArtifactCiphertextHash,
          input.signingKeyId,
          now,
          now,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
