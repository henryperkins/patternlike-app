import { canonicalJson, type PatternOntologyRelease } from "@patternlike/shared";
import type { Env } from "../env.js";
import { hashesEqual } from "./content-release.js";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVALUATION_OBJECT_PREFIX = "pattern-ontology/pipeline/";
const MAX_EVALUATION_ARTIFACT_BYTES = 4 * 1024 * 1024;

export type OntologyActivationScope = "internal" | "public";
export type OntologyCorpusLicenseClass =
  | "licensed_excerpt"
  | "internal_synthetic";

export interface CommitOntologyPipelineEvidenceInput {
  runId: string;
  ontologyVersion: string;
  corpusReleaseId: string;
  corpusReleaseHash: string;
  corpusLicenseClass: OntologyCorpusLicenseClass;
  corpusPublicCapable: boolean;
  activationScope: OntologyActivationScope;
  bundleHash: string;
  evaluationReportHash: string;
  evaluationArtifactObjectKey: string;
  evaluationArtifactCiphertextHash: string;
  signingKeyId: string;
  compilerPassed: true;
  evaluatorPassed: true;
  unevaluatedFixtureCount: 0;
}

interface EvidenceRow {
  run_id: string;
  ontology_version: string;
  corpus_release_id: string;
  corpus_release_hash: string;
  corpus_license_class: OntologyCorpusLicenseClass;
  corpus_public_capable: number;
  activation_scope: OntologyActivationScope;
  bundle_hash: string;
  evaluation_report_hash: string;
  evaluation_artifact_object_key: string;
  evaluation_artifact_ciphertext_hash: string;
  evaluation_artifact_status: "pending" | "committed";
  signing_key_id: string;
  run_status: "succeeded" | "failed";
  evidence_status: "pending" | "committed";
  compiler_passed: number;
  evaluator_passed: number;
  unevaluated_fixture_count: number;
  created_at: string;
  committed_at: string;
}

export interface VerifiedPatternOntologyEvidence {
  runId: string;
  corpusReleaseId: string;
  activationScope: OntologyActivationScope;
  evaluationReportHash: string;
  evidenceSummary: string;
}

export class PatternOntologyEvidenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PatternOntologyEvidenceError";
  }
}

function fail(code: string): never {
  throw new PatternOntologyEvidenceError(code);
}

function inputIsValid(input: CommitOntologyPipelineEvidenceInput): boolean {
  const publicCapabilityMatchesLicense =
    (input.corpusLicenseClass === "licensed_excerpt" &&
      input.corpusPublicCapable === true) ||
    (input.corpusLicenseClass === "internal_synthetic" &&
      input.corpusPublicCapable === false);
  return (
    RUN_ID.test(input.runId) &&
    input.ontologyVersion.length > 0 &&
    input.ontologyVersion.length <= 200 &&
    input.corpusReleaseId.length > 0 &&
    input.corpusReleaseId.length <= 200 &&
    CONTENT_HASH.test(input.corpusReleaseHash) &&
    CONTENT_HASH.test(input.bundleHash) &&
    CONTENT_HASH.test(input.evaluationReportHash) &&
    CONTENT_HASH.test(input.evaluationArtifactCiphertextHash) &&
    input.evaluationArtifactObjectKey.startsWith(
      `${EVALUATION_OBJECT_PREFIX}${input.runId}/`,
    ) &&
    KEY_ID.test(input.signingKeyId) &&
    input.compilerPassed === true &&
    input.evaluatorPassed === true &&
    input.unevaluatedFixtureCount === 0 &&
    publicCapabilityMatchesLicense
  );
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

async function verifiedArtifactHash(
  env: Env,
  objectKey: string,
): Promise<string> {
  if (!env.ARTIFACTS) fail("ontology_evaluation_artifact_missing");
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) fail("ontology_evaluation_artifact_missing");
  if (object.size > MAX_EVALUATION_ARTIFACT_BYTES) {
    fail("ontology_evaluation_artifact_too_large");
  }
  return sha256(await object.arrayBuffer());
}

function rowMatchesInput(
  row: EvidenceRow,
  input: CommitOntologyPipelineEvidenceInput,
): boolean {
  return (
    row.run_id === input.runId &&
    row.ontology_version === input.ontologyVersion &&
    row.corpus_release_id === input.corpusReleaseId &&
    hashesEqual(row.corpus_release_hash, input.corpusReleaseHash) &&
    row.corpus_license_class === input.corpusLicenseClass &&
    row.corpus_public_capable === (input.corpusPublicCapable ? 1 : 0) &&
    row.activation_scope === input.activationScope &&
    hashesEqual(row.bundle_hash, input.bundleHash) &&
    hashesEqual(row.evaluation_report_hash, input.evaluationReportHash) &&
    row.evaluation_artifact_object_key ===
      input.evaluationArtifactObjectKey &&
    hashesEqual(
      row.evaluation_artifact_ciphertext_hash,
      input.evaluationArtifactCiphertextHash,
    ) &&
    row.evaluation_artifact_status === "committed" &&
    row.signing_key_id === input.signingKeyId &&
    row.run_status === "succeeded" &&
    row.evidence_status === "committed" &&
    row.compiler_passed === 1 &&
    row.evaluator_passed === 1 &&
    row.unevaluated_fixture_count === 0
  );
}

async function loadEvidenceByIdentity(
  env: Env,
  runId: string,
  ontologyVersion: string,
): Promise<EvidenceRow | null> {
  return env.DB.prepare(
    `SELECT * FROM pattern_ontology_pipeline_evidence
     WHERE run_id = ? OR ontology_version = ?
     ORDER BY CASE WHEN run_id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  )
    .bind(runId, ontologyVersion, runId)
    .first<EvidenceRow>();
}

/**
 * Terminal executor seam. The future stage machine writes its create-only,
 * encrypted artifact first, then commits this immutable handoff receipt.
 */
export async function commitOntologyPipelineEvidence(
  env: Env,
  input: CommitOntologyPipelineEvidenceInput,
): Promise<void> {
  if (!inputIsValid(input)) fail("ontology_evidence_invalid");
  if (
    input.activationScope === "public" &&
    input.corpusPublicCapable !== true
  ) {
    fail("ontology_corpus_not_public");
  }
  const artifactHash = await verifiedArtifactHash(
    env,
    input.evaluationArtifactObjectKey,
  );
  if (
    !hashesEqual(artifactHash, input.evaluationArtifactCiphertextHash)
  ) {
    fail("ontology_evaluation_artifact_hash_mismatch");
  }

  const existing = await loadEvidenceByIdentity(
    env,
    input.runId,
    input.ontologyVersion,
  );
  if (existing) {
    if (rowMatchesInput(existing, input)) return;
    fail("ontology_evidence_immutable");
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_evidence (
         run_id, ontology_version, corpus_release_id, corpus_release_hash,
         corpus_license_class, corpus_public_capable, activation_scope,
         bundle_hash, evaluation_report_hash, evaluation_artifact_object_key,
         evaluation_artifact_ciphertext_hash, evaluation_artifact_status,
         signing_key_id, run_status, evidence_status, compiler_passed,
         evaluator_passed, unevaluated_fixture_count, created_at, committed_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed',
         ?, 'succeeded', 'committed', 1, 1, 0, ?, ?
       )`,
    )
      .bind(
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
        input.evaluationArtifactCiphertextHash,
        input.signingKeyId,
        now,
        now,
      )
      .run();
  } catch {
    const raced = await loadEvidenceByIdentity(
      env,
      input.runId,
      input.ontologyVersion,
    );
    if (raced && rowMatchesInput(raced, input)) return;
    fail("ontology_evidence_immutable");
  }
}

export async function verifyPatternOntologyEvidence(
  env: Env,
  release: PatternOntologyRelease,
  signingKeyId: string,
): Promise<VerifiedPatternOntologyEvidence> {
  const evaluationHash = release.evaluation.evaluation_report_hash;
  if (
    release.provenance?.origin !== "machine_pipeline" ||
    release.evaluation.verdict !== "pass" ||
    release.evaluation.compiler_passed !== true ||
    release.evaluation.evaluator_passed !== true ||
    release.evaluation.unevaluated_fixture_count !== 0 ||
    typeof evaluationHash !== "string" ||
    !CONTENT_HASH.test(evaluationHash)
  ) {
    fail("ontology_evaluation_not_passed");
  }

  const row = await env.DB.prepare(
    `SELECT * FROM pattern_ontology_pipeline_evidence
     WHERE ontology_version = ?`,
  )
    .bind(release.ontology_version)
    .first<EvidenceRow>();
  if (!row) fail("ontology_pipeline_evidence_missing");
  if (
    row.run_status !== "succeeded" ||
    row.evidence_status !== "committed" ||
    row.evaluation_artifact_status !== "committed" ||
    row.compiler_passed !== 1 ||
    row.evaluator_passed !== 1 ||
    row.unevaluated_fixture_count !== 0
  ) {
    fail("ontology_evidence_not_committed");
  }
  if (
    !row.corpus_release_id ||
    !hashesEqual(row.corpus_release_hash, release.corpus_release_hash)
  ) {
    fail("ontology_evidence_corpus_mismatch");
  }
  if (!hashesEqual(row.bundle_hash, release.bundle_hash)) {
    fail("ontology_evidence_bundle_mismatch");
  }
  if (!hashesEqual(row.evaluation_report_hash, evaluationHash)) {
    fail("ontology_evidence_evaluation_mismatch");
  }
  if (row.signing_key_id !== signingKeyId) {
    fail("ontology_evidence_signing_key_mismatch");
  }
  if (
    row.activation_scope === "public" &&
    (row.corpus_public_capable !== 1 ||
      row.corpus_license_class !== "licensed_excerpt")
  ) {
    fail("ontology_corpus_not_public");
  }

  const artifactHash = await verifiedArtifactHash(
    env,
    row.evaluation_artifact_object_key,
  );
  if (
    !hashesEqual(artifactHash, row.evaluation_artifact_ciphertext_hash)
  ) {
    fail("ontology_evaluation_artifact_hash_mismatch");
  }

  const evidenceSummary = canonicalJson({
    activation_scope: row.activation_scope,
    bundle_hash: row.bundle_hash,
    corpus_release_hash: row.corpus_release_hash,
    corpus_release_id: row.corpus_release_id,
    evaluation_report_hash: row.evaluation_report_hash,
    run_id: row.run_id,
    signing_key_id: row.signing_key_id,
  });
  return {
    runId: row.run_id,
    corpusReleaseId: row.corpus_release_id,
    activationScope: row.activation_scope,
    evaluationReportHash: row.evaluation_report_hash,
    evidenceSummary,
  };
}
