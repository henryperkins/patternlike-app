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
  buildTestEvaluationReport,
  buildTestPassedRegressionReport,
  putTestCorpusManifest,
  putTestEvaluationArtifact,
  testOntologyPipelineArtifactKeyring,
  type TestCorpusLicenseClass,
  type TestCorpusManifest,
  type TestEvaluationArtifactOptions,
  type TestEvaluationArtifactEnvelope,
} from "../../test/ontology-pipeline-fixtures.js";
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";
import {
  PatternOntologyEvidenceError,
  commitOntologyPipelineEvidence,
  verifyPatternOntologyEvidence,
  type CommitOntologyPipelineEvidenceInput,
} from "./pattern-ontology-evidence.js";
import {
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  retryOntologyPipelineStage,
  succeedOntologyPipelineRun,
} from "../db/ontology-pipeline.js";
import { putOntologyPipelineArtifact } from "./ontology-pipeline-artifacts.js";
import {
  loadActiveOntology,
  loadOntologyByVersion,
  ontologyServesAccount,
  storeOntologyRelease,
} from "../db/pattern-ontology.js";

interface MachineRelease extends PatternOntologyRelease {
  provenance: { origin: "machine_pipeline" };
}

type EvidenceInputWithEnvelope = CommitOntologyPipelineEvidenceInput & {
  evaluationArtifactEnvelopeHash: string;
  regressionReportHash: string;
  regressionArtifactObjectKey: string;
  regressionArtifactEnvelopeHash: string;
  regressionArtifactCiphertextHash: string;
  regressionArtifactStageGeneration: number;
  regressionArtifactStageAttempt: number;
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

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(
    atob(padded),
    (character) => character.charCodeAt(0),
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
    evaluationReport?: string;
    artifactOptions?: TestEvaluationArtifactOptions;
    inputOverrides?: Partial<EvidenceInputWithEnvelope>;
    regressionAttempt?: 0 | 1;
    minimalRegressionReport?: boolean;
    mutateRegressionReport?: (report: Record<string, unknown>) => void;
    mutateCommand?: (command: Record<string, unknown>) => void;
    leaveRunSigning?: boolean;
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
  const evaluationReport =
    options.evaluationReport ??
    buildTestEvaluationReport(value.ontology_version);
  const artifact = await buildTestEvaluationArtifact(
    runId,
    value.ontology_version,
    evaluationReport,
    options.artifactOptions,
  );
  value.evaluation.evaluation_report_hash = artifact.plaintextHash;
  const objectKey = await putTestEvaluationArtifact(
    env.ARTIFACTS!,
    runId,
    artifact.bytes,
  );
  const now = new Date(Date.now() - 1_000);
  const candidateHash = `sha256:${"1".repeat(64)}`;
  const command: Record<string, unknown> = {
    candidate_ontology_version: value.ontology_version,
    configuration_equal: true,
    corpus: {
      corpus_hash: corpus.corpus_hash,
      corpus_release_id: corpusReleaseId,
    },
    provider: "openai",
    regression: {
      fixture_count: 30,
      maximum_provider_calls_per_fixture: 11,
      minimum_pass_rate: 1,
    },
  };
  options.mutateCommand?.(command);
  const configuration = canonicalJson(command);
  const configurationHash = await contentHash(configuration);
  await env.DB.prepare(
    `INSERT INTO pattern_source_corpus_releases (
       corpus_release_id, corpus_hash, locale, object_key, fragment_count,
       license_class, public_capable, created_at, registered_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    corpus.corpus_release_id,
    corpus.corpus_hash,
    corpus.locale,
    corpusObjectKey,
    corpus.fragments.length,
    corpusLicenseClass,
    options.corpusPublicCapable ?? corpusLicenseClass === "licensed_excerpt"
      ? 1
      : 0,
    now.toISOString(),
    now.toISOString(),
  ).run();
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pipeline_runs (
       run_id, idempotency_key, corpus_release_id, corpus_hash,
       candidate_ontology_version, configuration_json, configuration_hash,
       stage, stage_generation, stage_cursor, stage_attempt, claim_token,
       lease_expires_at, available_at, dispatched_at, failure_class,
       candidate_hash, compilation_report_hash, evaluation_report_hash,
       regression_report_hash, bundle_hash, failed_artifact_expires_at,
       created_at, updated_at, finished_at, succeeded_at, failed_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, 0, 0, NULL, NULL, ?, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL
     )`,
  ).bind(
    runId,
    `evidence-${crypto.randomUUID()}`,
    corpusReleaseId,
    value.corpus_release_hash,
    value.ontology_version,
    configuration,
    configurationHash,
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  ).run();
  for (const [index, stage] of [
    "corpus_reading",
    "generating",
    "compiling",
    "evaluating",
    "regressing",
  ].entries()) {
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = ?, stage_generation = ?, stage_cursor = 0,
           stage_attempt = 0, claim_token = NULL, lease_expires_at = NULL,
           dispatched_at = NULL, updated_at = ?,
           candidate_hash = CASE WHEN ? = 'compiling' THEN ? ELSE candidate_hash END,
           compilation_report_hash = CASE WHEN ? = 'evaluating' THEN ? ELSE compilation_report_hash END,
           evaluation_report_hash = CASE WHEN ? = 'regressing' THEN ? ELSE evaluation_report_hash END
       WHERE run_id = ?`,
    ).bind(
      stage,
      index + 1,
      now.toISOString(),
      stage,
      candidateHash,
      stage,
      `sha256:${"2".repeat(64)}`,
      stage,
      artifact.plaintextHash,
      runId,
    ).run();
  }
  let regressionClaim = await claimOntologyPipelineRun(
    env,
    { run_id: runId, stage_generation: 5 },
    now,
    "regression-evidence-attempt-zero",
  );
  if (regressionClaim.status !== "claimed") {
    throw new Error("regression evidence claim failed");
  }
  if (options.regressionAttempt === 1) {
    expect(await retryOntologyPipelineStage(
      env,
      regressionClaim,
      new Date(now.getTime() + 1),
    )).toBe(true);
    regressionClaim = await claimOntologyPipelineRun(
      env,
      { run_id: runId, stage_generation: 5 },
      new Date(now.getTime() + 1),
      "regression-evidence-attempt-one",
    );
    if (regressionClaim.status !== "claimed") {
      throw new Error("regression evidence retry claim failed");
    }
  }
  const completeRegressionReport = await buildTestPassedRegressionReport({
    ontologyVersion: value.ontology_version,
    commandHash: configurationHash,
    corpusReleaseId,
    corpusHash: corpus.corpus_hash,
    candidateHash,
    evaluationReportHash: artifact.plaintextHash,
  });
  const regressionDocument = structuredClone(
    completeRegressionReport.document,
  );
  options.mutateRegressionReport?.(regressionDocument);
  const regressionReport = options.minimalRegressionReport
    ? canonicalJson({
        candidate_hash: candidateHash,
        command_hash: configurationHash,
        corpus: {
          corpus_hash: corpus.corpus_hash,
          corpus_release_id: corpusReleaseId,
        },
        evaluation_report_hash: artifact.plaintextHash,
        ontology_version: value.ontology_version,
        passed: true,
        schema_version: "ontology-regression-report/v1",
      })
    : canonicalJson(regressionDocument);
  const regressionArtifact = await putOntologyPipelineArtifact(
    env,
    {
      runId,
      stage: "regressing",
      stageGeneration: regressionClaim.stageGeneration,
      stageAttempt: regressionClaim.stageAttempt,
      artifactClass: "regression_report",
    },
    new TextEncoder().encode(regressionReport),
    regressionClaim,
    new Date(now.getTime() + 2),
  );
  expect(await advanceOntologyPipelineStage(
    env,
    regressionClaim,
    "signing",
    { regressionReportHash: regressionArtifact.artifact.plaintextSha256 },
    new Date(now.getTime() + 3),
  )).toBe(true);
  value.evaluation.regression_passed = true;
  value.evaluation.regression_report_hash =
    regressionArtifact.artifact.plaintextSha256;
  value.bundle_hash = await computeOntologyBundleHash(value);
  if (!options.leaveRunSigning) {
    const signingClaim = await claimOntologyPipelineRun(
      env,
      { run_id: runId, stage_generation: 6 },
      new Date(now.getTime() + 4),
      "regression-evidence-signing",
    );
    if (signingClaim.status !== "claimed") {
      throw new Error("regression evidence signing claim failed");
    }
    expect(await advanceOntologyPipelineStage(
      env,
      signingClaim,
      "ingesting",
      { bundleHash: value.bundle_hash },
      new Date(now.getTime() + 5),
    )).toBe(true);
  }
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
    regressionReportHash: regressionArtifact.artifact.plaintextSha256,
    regressionArtifactObjectKey: regressionArtifact.artifact.objectKey,
    regressionArtifactEnvelopeHash: regressionArtifact.artifact.envelopeSha256,
    regressionArtifactCiphertextHash:
      regressionArtifact.artifact.ciphertextSha256,
    regressionArtifactStageGeneration:
      regressionArtifact.artifact.stageGeneration,
    regressionArtifactStageAttempt: regressionArtifact.artifact.stageAttempt,
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
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING =
      testOntologyPipelineArtifactKeyring();
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
      regressionReportHash: input.regressionReportHash,
      regressionArtifactObjectKey: input.regressionArtifactObjectKey,
      regressionArtifactEnvelopeHash:
        input.regressionArtifactEnvelopeHash,
      regressionArtifactCiphertextHash:
        input.regressionArtifactCiphertextHash,
      regressionArtifactStageGeneration:
        input.regressionArtifactStageGeneration,
      regressionArtifactStageAttempt: input.regressionArtifactStageAttempt,
      signingKeyId: input.signingKeyId,
      compilerPassed: true,
      evaluatorPassed: true,
      regressionPassed: true,
      unevaluatedFixtureCount: 0,
      evidenceSummary: expect.any(String),
    });
  });

  it("refuses the former seven-field passed regression report stub", async () => {
    const value = await release("ontology-evidence-regression-stub");
    const { input } = await evidenceFixture(value, {
      minimalRegressionReport: true,
    });

    await expect(commitOntologyPipelineEvidence(env, input))
      .rejects.toMatchObject({ code: "ontology_regression_report_invalid" });
  });

  it.each([
    "configuration_hash",
    "activation_manifest_hash",
    "fixture_count",
    "threshold",
    "hard_gate_count",
    "fixture_result",
    "duplicate_fixture_id",
    "duplicate_result_hash",
    "provider_accounting",
    "provider_fixed_field",
  ] as const)(
    "refuses a complete regression report with tampered %s",
    async (tamper) => {
      const value = await release(`ontology-evidence-regression-${tamper}`);
      const { input } = await evidenceFixture(value, {
        mutateRegressionReport(report) {
          if (tamper === "configuration_hash") {
            report.configuration_hash = `sha256:${"9".repeat(64)}`;
          } else if (tamper === "activation_manifest_hash") {
            (report.corpus as Record<string, unknown>)
              .activation_manifest_hash = `sha256:${"9".repeat(64)}`;
          } else if (tamper === "fixture_count") {
            (report.corpus as Record<string, unknown>).fixture_count = 29;
          } else if (tamper === "threshold") {
            (report.threshold as Record<string, unknown>)
              .required_per_cohort = 9;
          } else if (tamper === "hard_gate_count") {
            (report.hard_gate_counts as Record<string, unknown>)
              .prohibited_claim = 1;
          } else if (tamper === "fixture_result") {
            const results = report.ordered_fixture_results as Array<
              Record<string, unknown>
            >;
            results[0]!.accepted = false;
          } else if (tamper === "duplicate_fixture_id") {
            const results = report.ordered_fixture_results as Array<
              Record<string, unknown>
            >;
            results[1]!.fixture_id = results[0]!.fixture_id;
          } else if (tamper === "duplicate_result_hash") {
            const results = report.ordered_fixture_results as Array<
              Record<string, unknown>
            >;
            results[1]!.result_hash = results[0]!.result_hash;
          } else if (tamper === "provider_accounting") {
            (report.provider_usage as Record<string, unknown>)
              .request_artifact_count = 89;
          } else {
            (report.provider_usage as Record<string, unknown>)
              .maximum_arithmetic = "stale arithmetic";
          }
        },
      });

      await expect(commitOntologyPipelineEvidence(env, input))
        .rejects.toMatchObject({
          code: "ontology_regression_report_invalid",
        });
    },
  );

  it("requires the pipeline run to have reached ingesting", async () => {
    const value = await release("ontology-evidence-run-still-signing");
    const { input } = await evidenceFixture(value, {
      leaveRunSigning: true,
    });

    await expect(commitOntologyPipelineEvidence(env, input))
      .rejects.toMatchObject({
        code: "ontology_regression_run_identity_mismatch",
      });
  });

  it.each([
    "fixture_count",
    "maximum_provider_calls_per_fixture",
    "minimum_pass_rate",
  ] as const)("rejects a run with a non-authoritative regression %s", async (field) => {
    const value = await release(`ontology-evidence-command-${field}`);
    const { input } = await evidenceFixture(value, {
      mutateCommand(command) {
        const regression = command.regression as Record<string, unknown>;
        regression[field] = field === "minimum_pass_rate" ? 0.9 : 1;
      },
    });

    await expect(commitOntologyPipelineEvidence(env, input))
      .rejects.toMatchObject({
        code: "ontology_regression_run_identity_mismatch",
      });
  });

  it("binds the evidence bundle hash to the ingesting pipeline run", async () => {
    const value = await release("ontology-evidence-run-bundle-mismatch");
    const { input } = await evidenceFixture(value);
    input.bundleHash = `sha256:${"9".repeat(64)}`;

    await expect(commitOntologyPipelineEvidence(env, input))
      .rejects.toMatchObject({
        code: "ontology_regression_run_identity_mismatch",
      });
  });

  it("refuses evidence from release A before writing release B bytes", async () => {
    const valueA = await release("ontology-evidence-store-release-a");
    const { input } = await evidenceFixture(valueA);
    await commitOntologyPipelineEvidence(env, input);
    const evidenceA = await verifyPatternOntologyEvidence(
      env,
      valueA,
      input.signingKeyId,
    );
    const valueB = structuredClone(valueA);
    valueB.ontology_version = "ontology-evidence-store-release-b";
    valueB.evaluation.ontology_version = valueB.ontology_version;
    valueB.bundle_hash = await computeOntologyBundleHash(valueB);
    const objectKeyB = `pattern-ontology/${valueB.ontology_version}.json`;
    env.PATTERN_ONTOLOGY_KEYS = "";

    await expect(
      storeOntologyRelease(env, valueB, objectKeyB, evidenceA),
    ).rejects.toThrow("ontology_pipeline_evidence_mismatch");
    await expect(env.ARTIFACTS!.get(objectKeyB)).resolves.toBeNull();
  });

  it("falls back to internal scope when the regression receipt summary is incomplete", async () => {
    const value = await release("ontology-evidence-read-time-regression");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      input.signingKeyId,
    );
    env.PATTERN_ONTOLOGY_KEYS = "";
    await storeOntologyRelease(
      env,
      value,
      `pattern-ontology/${value.ontology_version}.json`,
      verified,
    );
    await expect(loadActiveOntology(env)).resolves.toMatchObject({
      activationScope: "public",
    });
    await env.DB.prepare(
      `UPDATE pattern_ontology_evaluation_runs
       SET summary_json = json_remove(
         summary_json,
         '$.regression_report_hash',
         '$.regression_artifact_object_key',
         '$.regression_artifact_envelope_hash',
         '$.regression_artifact_ciphertext_hash',
         '$.regression_artifact_stage_generation',
         '$.regression_artifact_stage_attempt',
         '$.regression_passed'
       )
       WHERE ontology_version = ?`,
    ).bind(value.ontology_version).run();

    const active = await loadActiveOntology(env);
    expect(active).toMatchObject({
      activationScope: "internal",
    });
    expect(ontologyServesAccount(active, false)).toBe(false);
  });

  it("treats a migrated all-null legacy regression tuple as internal", async () => {
    const value = await release("ontology-evidence-read-time-legacy-null");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      input.signingKeyId,
    );
    env.PATTERN_ONTOLOGY_KEYS = "";
    await storeOntologyRelease(
      env,
      value,
      `pattern-ontology/${value.ontology_version}.json`,
      verified,
    );
    await env.DB.prepare(
      "DROP TRIGGER pattern_ontology_pipeline_evidence_committed_immutable",
    ).run();
    try {
      await env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_evidence
         SET regression_report_hash = NULL,
             regression_artifact_object_key = NULL,
             regression_artifact_envelope_hash = NULL,
             regression_artifact_ciphertext_hash = NULL,
             regression_artifact_stage_generation = NULL,
             regression_artifact_stage_attempt = NULL
         WHERE ontology_version = ?`,
      ).bind(value.ontology_version).run();
    } finally {
      await env.DB.prepare(
        `CREATE TRIGGER pattern_ontology_pipeline_evidence_committed_immutable
         BEFORE UPDATE ON pattern_ontology_pipeline_evidence
         FOR EACH ROW
         WHEN OLD.evidence_status = 'committed'
         BEGIN
           SELECT RAISE(ABORT, 'committed ontology pipeline evidence is immutable');
         END`,
      ).run();
    }

    const active = await loadActiveOntology(env);
    expect(active).toMatchObject({
      activationScope: "internal",
    });
    expect(ontologyServesAccount(active, false)).toBe(false);
    await expect(loadOntologyByVersion(env, value.ontology_version))
      .resolves.toMatchObject({ activationScope: "internal" });
  });

  it("rejects a forged verified-evidence object at the activation D1 batch boundary", async () => {
    const value = await release("ontology-evidence-forged-ts-object");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      input.signingKeyId,
    );
    env.PATTERN_ONTOLOGY_KEYS = "";

    await expect(storeOntologyRelease(
      env,
      value,
      `pattern-ontology/${value.ontology_version}.json`,
      {
        ...verified,
        regressionArtifactStageAttempt:
          verified.regressionArtifactStageAttempt + 1,
      },
    )).rejects.toThrow();
    await expect(env.DB.prepare(
      `SELECT version FROM pattern_ontology_releases WHERE version = ?`,
    ).bind(value.ontology_version).first()).resolves.toBeNull();
  });

  it("commits and re-verifies an attempt-one generic regression report", async () => {
    const value = await release("ontology-evidence-true-retry");
    const fixture = await evidenceFixture(value, { regressionAttempt: 1 });

    expect(fixture.input.regressionArtifactObjectKey).toMatch(
      /\/opart_[a-f0-9]{40}\.enc$/,
    );
    await expect(commitOntologyPipelineEvidence(env, fixture.input))
      .resolves.toBeUndefined();
    const verified = await verifyPatternOntologyEvidence(
      env,
      value,
      fixture.input.signingKeyId,
    );
    expect(verified).toMatchObject({
      runId: fixture.input.runId,
      regressionArtifactObjectKey: fixture.input.regressionArtifactObjectKey,
      regressionArtifactStageGeneration: 5,
      regressionArtifactStageAttempt: 1,
    });
    env.PATTERN_ONTOLOGY_KEYS = "";
    await storeOntologyRelease(
      env,
      value,
      `pattern-ontology/${value.ontology_version}.json`,
      verified,
    );
    await expect(loadActiveOntology(env)).resolves.toMatchObject({
      version: value.ontology_version,
      activationScope: "public",
    });
  });

  it("re-verifies committed regression evidence after the run succeeds", async () => {
    const value = await release("ontology-evidence-terminal-succeeded");
    const fixture = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, fixture.input);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: fixture.input.runId, stage_generation: 7 },
      new Date(),
      "regression-evidence-terminal-success",
    );
    if (claim.status !== "claimed") throw new Error("ingesting claim failed");
    expect(await succeedOntologyPipelineRun(env, claim, new Date())).toBe(true);

    await expect(verifyPatternOntologyEvidence(
      env,
      value,
      fixture.input.signingKeyId,
    )).resolves.toMatchObject({ runId: fixture.input.runId });
  });

  it("accepts a locale admitted by the frozen corpus contract", async () => {
    const value = await release("ontology-evidence-contract-locale");
    value.locale = "en-abcdefghij";
    const { input } = await evidenceFixture(value);

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the release does not carry a passing regression result", async () => {
    const value = await release("ontology-evidence-no-regression");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    value.evaluation.regression_passed = false;
    delete value.evaluation.regression_report_hash;

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({ code: "ontology_regression_not_passed" });
  });

  it("fails closed for a legacy all-null regression evidence receipt", async () => {
    const value = await release("ontology-evidence-legacy-regression");
    const { input } = await evidenceFixture(value);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_evidence (
         run_id, ontology_version, corpus_release_id, corpus_release_hash,
         corpus_license_class, corpus_public_capable, activation_scope,
         bundle_hash, evaluation_report_hash, evaluation_artifact_object_key,
         evaluation_artifact_envelope_hash,
         evaluation_artifact_ciphertext_hash, evaluation_artifact_status,
         signing_key_id, run_status, evidence_status, compiler_passed,
         evaluator_passed, unevaluated_fixture_count, created_at, committed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?,
         'succeeded', 'committed', 1, 1, 0, ?, ?)`,
    ).bind(
      input.runId,
      input.ontologyVersion,
      input.corpusReleaseId,
      input.corpusReleaseHash,
      input.corpusLicenseClass,
      input.corpusPublicCapable ? 1 : 0,
      input.activationScope,
      input.bundleHash,
      input.evaluationReportHash,
      input.evaluationArtifactObjectKey,
      input.evaluationArtifactEnvelopeHash,
      input.evaluationArtifactCiphertextHash,
      input.signingKeyId,
      now,
      now,
    ).run();

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({
      code: "ontology_regression_evidence_missing",
    });
  });

  it("refuses a self-consistent envelope encrypted under an untrusted key", async () => {
    const value = await release("ontology-evidence-untrusted-artifact-key");
    const attackerKey = Uint8Array.from(
      { length: 32 },
      (_, index) => 255 - index,
    );
    const { input } = await evidenceFixture(value, {
      artifactOptions: { rawKey: attackerKey },
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_authentication_failed",
    });
  });

  it("refuses ciphertext authenticated with different AAD", async () => {
    const value = await release("ontology-evidence-wrong-artifact-aad");
    const { input } = await evidenceFixture(value, {
      artifactOptions: {
        additionalData: canonicalJson({
          run_id: "different-authenticated-identity",
        }),
      },
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_authentication_failed",
    });
  });

  it("refuses an evaluation envelope naming an unknown artifact key", async () => {
    const value = await release("ontology-evidence-unknown-artifact-key");
    const { input } = await evidenceFixture(value, {
      artifactOptions: { keyId: "unknown-artifact-key" },
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_key_unknown",
    });
  });

  it.each([
    [
      "missing",
      undefined,
      "ontology_evaluation_artifact_keyring_missing",
    ],
    [
      "malformed JSON",
      "{",
      "ontology_evaluation_artifact_keyring_invalid",
    ],
    [
      "open shape",
      JSON.stringify({ version: 1, keys: {}, extra: true }),
      "ontology_evaluation_artifact_keyring_invalid",
    ],
    [
      "wrong key length",
      JSON.stringify({
        version: 1,
        keys: { "test-evaluation-envelope-key": "AA" },
      }),
      "ontology_evaluation_artifact_keyring_invalid",
    ],
  ] as const)(
    "refuses a %s artifact keyring",
    async (_label, keyring, code) => {
      const value = await release(
        `ontology-evidence-keyring-${_label.replaceAll(" ", "-").toLowerCase()}`,
      );
      const { input } = await evidenceFixture(value);
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING = keyring;

      await expect(
        commitOntologyPipelineEvidence(env, input),
      ).rejects.toMatchObject({ code });
    },
  );

  it("refuses a ciphertext whose authentication tag no longer verifies", async () => {
    const value = await release("ontology-evidence-artifact-tag");
    const fixture = await evidenceFixture(value);
    const envelope = structuredClone(fixture.artifact.envelope);
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    ciphertext[0] = ciphertext[0]! ^ 1;
    envelope.ciphertext = toBase64Url(ciphertext);
    envelope.ciphertext_hash = await hashBytes(ciphertext);
    fixture.input.evaluationArtifactCiphertextHash =
      envelope.ciphertext_hash;
    await replaceArtifactEnvelope(fixture, envelope);

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_authentication_failed",
    });
  });

  it("refuses decrypted plaintext whose declared hash is self-consistently wrong", async () => {
    const value = await release("ontology-evidence-artifact-plaintext-hash");
    const { input } = await evidenceFixture(value, {
      artifactOptions: {
        declaredPlaintextHash: `sha256:${"9".repeat(64)}`,
      },
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_plaintext_hash_mismatch",
    });
  });

  it("refuses a decrypted evaluation report that is not canonical JSON", async () => {
    const value = await release("ontology-evidence-report-noncanonical");
    const report = JSON.stringify({
      schema_version: "0.7.0",
      ontology_version: value.ontology_version,
      compiler_passed: true,
      evaluator_passed: true,
      unevaluated_fixture_count: 0,
    });
    expect(report).not.toBe(canonicalJson(JSON.parse(report)));
    const { input } = await evidenceFixture(value, {
      evaluationReport: report,
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_report_noncanonical",
    });
  });

  it.each([
    [
      "compiler_passed",
      false,
      "ontology_evaluation_report_gate_mismatch",
    ],
    [
      "evaluator_passed",
      false,
      "ontology_evaluation_report_gate_mismatch",
    ],
    [
      "unevaluated_fixture_count",
      1,
      "ontology_evaluation_report_gate_mismatch",
    ],
    [
      "ontology_version",
      "ontology-different",
      "ontology_evaluation_report_identity_mismatch",
    ],
    [
      "schema_version",
      "0.6.0",
      "ontology_evaluation_report_invalid",
    ],
  ] as const)(
    "refuses a decrypted evaluation report with wrong %s",
    async (field, fieldValue, code) => {
      const value = await release(`ontology-evidence-report-${field}`);
      const report = buildTestEvaluationReport(value.ontology_version, {
        [field]: fieldValue,
      });
      const { input } = await evidenceFixture(value, {
        evaluationReport: report,
      });

      await expect(
        commitOntologyPipelineEvidence(env, input),
      ).rejects.toMatchObject({ code });
    },
  );

  it("re-authenticates the encrypted report during ingestion verification", async () => {
    const value = await release("ontology-evidence-ingestion-reauth");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING =
      testOntologyPipelineArtifactKeyring(
        undefined,
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      );

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_authentication_failed",
    });
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

  it("refuses a regression artifact pin that does not exactly match its inventory row", async () => {
    const value = await release("ontology-evidence-regression-pin-mismatch");
    const { input } = await evidenceFixture(value);
    input.regressionArtifactEnvelopeHash = `sha256:${"7".repeat(64)}`;

    await expect(commitOntologyPipelineEvidence(env, input))
      .rejects.toMatchObject({
        code: "ontology_regression_artifact_identity_mismatch",
      });
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

  it("explicitly refuses a BOM-prefixed decrypted evaluation report", async () => {
    const value = await release("ontology-evidence-report-bom");
    const report =
      "\uFEFF" + buildTestEvaluationReport(value.ontology_version);
    const { input } = await evidenceFixture(value, {
      evaluationReport: report,
    });

    await expect(
      commitOntologyPipelineEvidence(env, input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_report_invalid",
    });
  });

  it("explicitly refuses a BOM-prefixed evaluation artifact envelope", async () => {
    const value = await release("ontology-evidence-artifact-bom");
    const fixture = await evidenceFixture(value);
    const canonical = new TextEncoder().encode(fixture.artifact.bytes);
    const prefixed = new Uint8Array(canonical.byteLength + 3);
    prefixed.set([0xef, 0xbb, 0xbf]);
    prefixed.set(canonical, 3);
    await env.ARTIFACTS!.put(
      fixture.input.evaluationArtifactObjectKey,
      prefixed,
    );
    fixture.input.evaluationArtifactEnvelopeHash =
      await hashBytes(prefixed);

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_evaluation_artifact_invalid",
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
    await commitOntologyPipelineEvidence(env, input);
    if (field === "corpus_release_hash") {
      value.corpus_release_hash = `sha256:${"9".repeat(64)}`;
      value.bundle_hash = await computeOntologyBundleHash(value);
    } else if (field === "bundle_hash") {
      value.bundle_hash = `sha256:${"9".repeat(64)}`;
    } else if (field === "evaluation_report_hash") {
      value.evaluation.evaluation_report_hash = `sha256:${"9".repeat(64)}`;
    }

    await expect(
      verifyPatternOntologyEvidence(
        env,
        value,
        field === "signing_key_id"
          ? "ontology-signing-other"
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

  it("explicitly refuses a BOM-prefixed corpus manifest", async () => {
    const value = await release("ontology-evidence-corpus-bom");
    const fixture = await evidenceFixture(value);
    const canonical = new TextEncoder().encode(canonicalJson(fixture.corpus));
    const prefixed = new Uint8Array(canonical.byteLength + 3);
    prefixed.set([0xef, 0xbb, 0xbf]);
    prefixed.set(canonical, 3);
    await env.ARTIFACTS!.put(fixture.corpusObjectKey, prefixed);

    await expect(
      commitOntologyPipelineEvidence(env, fixture.input),
    ).rejects.toMatchObject({
      code: "ontology_corpus_manifest_invalid",
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

  it("re-verifies and refuses a replaced generic regression artifact", async () => {
    const value = await release("ontology-evidence-regression-tamper");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);
    await env.ARTIFACTS!.put(
      input.regressionArtifactObjectKey,
      canonicalJson({ replacement: "not the committed regression envelope" }),
    );

    await expect(
      verifyPatternOntologyEvidence(env, value, input.signingKeyId),
    ).rejects.toMatchObject({
      code: "ontology_regression_artifact_integrity_failed",
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
    await expect(
      env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_evidence
         SET regression_artifact_stage_attempt = 99 WHERE run_id = ?`,
      ).bind(input.runId).run(),
    ).rejects.toThrow(/immutable/);
  });

  it("prevents deletion of committed legacy and regression evidence rows", async () => {
    const value = await release("ontology-evidence-sql-no-delete");
    const { input } = await evidenceFixture(value);
    await commitOntologyPipelineEvidence(env, input);

    await expect(
      env.DB.prepare(
        `DELETE FROM pattern_ontology_pipeline_evidence WHERE run_id = ?`,
      ).bind(input.runId).run(),
    ).rejects.toThrow(/cannot be deleted/);
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
