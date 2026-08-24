import {
  canonicalJson,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  ONTOLOGY_PIPELINE_DEFAULT_REGRESSION_MINIMUM_PASS_RATE,
  ONTOLOGY_PIPELINE_EQUAL_MODEL_REGRESSION_MINIMUM_PASS_RATE,
} from "../middleware/config-guard.js";
import { hashesEqual } from "./content-release.js";
import {
  PatternOntologyCorpusError,
  readVerifiedPatternOntologyCorpus,
  type VerifiedCorpusLicenseClass,
} from "./pattern-ontology-corpus.js";
import {
  decodeOntologyArtifactBase64Url,
  hashOntologyArtifactBytes,
  parseOntologyArtifactKeyring,
} from "./ontology-artifact-crypto.js";
import {
  ontologyPipelineArtifactIdentity,
  readOntologyPipelineArtifact,
  type OntologyPipelineArtifactCoordinate,
} from "./ontology-pipeline-artifacts.js";
import {
  ONTOLOGY_REGRESSION_ACTIVATION_MANIFEST_HASH,
  ontologyRegressionConfigurationHash,
  parseCanonicalOntologyRegressionReport,
} from "./ontology-regression-report.js";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVALUATION_OBJECT_PREFIX = "pattern-ontology/pipeline/";
const MAX_EVALUATION_ARTIFACT_BYTES = 4 * 1024 * 1024;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const EVALUATION_ENVELOPE_FIELDS = new Set([
  "schema_version",
  "artifact_class",
  "run_id",
  "ontology_version",
  "plaintext_hash",
  "ciphertext_hash",
  "encryption",
  "ciphertext",
]);
const ENCRYPTION_FIELDS = new Set(["alg", "key_id", "nonce"]);

export type OntologyActivationScope = "internal" | "public";
export type OntologyCorpusLicenseClass =
  VerifiedCorpusLicenseClass;

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
  evaluationArtifactEnvelopeHash: string;
  evaluationArtifactCiphertextHash: string;
  regressionReportHash: string;
  regressionArtifactObjectKey: string;
  regressionArtifactEnvelopeHash: string;
  regressionArtifactCiphertextHash: string;
  regressionArtifactStageGeneration: number;
  regressionArtifactStageAttempt: number;
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
  evaluation_artifact_envelope_hash: string;
  evaluation_artifact_ciphertext_hash: string;
  regression_report_hash: string | null;
  regression_artifact_object_key: string | null;
  regression_artifact_envelope_hash: string | null;
  regression_artifact_ciphertext_hash: string | null;
  regression_artifact_stage_generation: number | null;
  regression_artifact_stage_attempt: number | null;
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
  ontologyVersion: string;
  corpusReleaseId: string;
  corpusReleaseHash: string;
  corpusLicenseClass: OntologyCorpusLicenseClass;
  corpusPublicCapable: boolean;
  activationScope: OntologyActivationScope;
  bundleHash: string;
  evaluationReportHash: string;
  evaluationArtifactObjectKey: string;
  evaluationArtifactEnvelopeHash: string;
  evaluationArtifactCiphertextHash: string;
  regressionReportHash: string;
  regressionArtifactObjectKey: string;
  regressionArtifactEnvelopeHash: string;
  regressionArtifactCiphertextHash: string;
  regressionArtifactStageGeneration: number;
  regressionArtifactStageAttempt: number;
  signingKeyId: string;
  compilerPassed: true;
  evaluatorPassed: true;
  regressionPassed: true;
  unevaluatedFixtureCount: 0;
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
    CONTENT_HASH.test(input.evaluationArtifactEnvelopeHash) &&
    CONTENT_HASH.test(input.evaluationArtifactCiphertextHash) &&
    CONTENT_HASH.test(input.regressionReportHash) &&
    typeof input.regressionArtifactObjectKey === "string" &&
    input.regressionArtifactObjectKey.length > 0 &&
    input.regressionArtifactObjectKey.length <= 1024 &&
    CONTENT_HASH.test(input.regressionArtifactEnvelopeHash) &&
    CONTENT_HASH.test(input.regressionArtifactCiphertextHash) &&
    Number.isSafeInteger(input.regressionArtifactStageGeneration) &&
    input.regressionArtifactStageGeneration > 0 &&
    Number.isSafeInteger(input.regressionArtifactStageAttempt) &&
    input.regressionArtifactStageAttempt >= 0 &&
    evaluationObjectKeyIsValid(
      input.runId,
      input.evaluationArtifactObjectKey,
    ) &&
    KEY_ID.test(input.signingKeyId) &&
    input.compilerPassed === true &&
    input.evaluatorPassed === true &&
    input.unevaluatedFixtureCount === 0 &&
    publicCapabilityMatchesLicense
  );
}

function evaluationObjectKeyIsValid(runId: string, objectKey: string): boolean {
  const prefix = `${EVALUATION_OBJECT_PREFIX}${runId}/`;
  return objectKey === `${prefix}evaluation-report.enc` ||
    (
      objectKey.startsWith(prefix) &&
      /^opart_[a-f0-9]{40}\.enc$/.test(objectKey.slice(prefix.length))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, index) => bytes[index] === byte)
  );
}

function parseArtifactKeyring(
  raw: string | undefined,
): Map<string, Uint8Array> {
  if (!raw) fail("ontology_evaluation_artifact_keyring_missing");
  const keys = parseOntologyArtifactKeyring(raw);
  if (!keys) fail("ontology_evaluation_artifact_keyring_invalid");
  return keys;
}

interface EvaluationArtifactIdentity {
  schemaVersion: "ontology-evaluation-artifact/v1";
  artifactClass: "evaluation_report";
  runId: string;
  ontologyVersion: string;
  plaintextHash: string;
  keyId: string;
  nonce: string;
}

function evaluationArtifactIdentity(
  runId: unknown,
  ontologyVersion: unknown,
  plaintextHash: unknown,
  keyId: unknown,
  nonce: unknown,
): EvaluationArtifactIdentity {
  if (
    typeof runId !== "string" ||
    typeof ontologyVersion !== "string" ||
    typeof plaintextHash !== "string" ||
    typeof keyId !== "string" ||
    typeof nonce !== "string"
  ) {
    fail("ontology_evaluation_artifact_invalid");
  }
  return {
    schemaVersion: "ontology-evaluation-artifact/v1",
    artifactClass: "evaluation_report",
    runId,
    ontologyVersion,
    plaintextHash,
    keyId,
    nonce,
  };
}

function evaluationArtifactAad(
  identity: EvaluationArtifactIdentity,
): Uint8Array {
  // This closed JCS object is the one authenticated identity for v1 artifacts.
  // ciphertext_hash is intentionally excluded to avoid a circular dependency.
  return new TextEncoder().encode(canonicalJson({
    artifact_class: identity.artifactClass,
    encryption: {
      key_id: identity.keyId,
      nonce: identity.nonce,
    },
    ontology_version: identity.ontologyVersion,
    plaintext_hash: identity.plaintextHash,
    run_id: identity.runId,
    schema_version: identity.schemaVersion,
  }));
}

function verifyEvaluationReport(
  plaintext: Uint8Array,
  ontologyVersion: string,
): void {
  if (hasUtf8Bom(plaintext)) fail("ontology_evaluation_report_invalid");
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(plaintext);
  } catch {
    fail("ontology_evaluation_report_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("ontology_evaluation_report_invalid");
  }
  if (!isRecord(parsed)) fail("ontology_evaluation_report_invalid");
  if (canonicalJson(parsed) !== bytes) {
    fail("ontology_evaluation_report_noncanonical");
  }
  if (
    parsed.schema_version !== "0.7.0" ||
    typeof parsed.ontology_version !== "string" ||
    typeof parsed.compiler_passed !== "boolean" ||
    typeof parsed.evaluator_passed !== "boolean" ||
    typeof parsed.unevaluated_fixture_count !== "number" ||
    !Number.isInteger(parsed.unevaluated_fixture_count)
  ) {
    fail("ontology_evaluation_report_invalid");
  }
  if (parsed.ontology_version !== ontologyVersion) {
    fail("ontology_evaluation_report_identity_mismatch");
  }
  if (
    parsed.compiler_passed !== true ||
    parsed.evaluator_passed !== true ||
    parsed.unevaluated_fixture_count !== 0
  ) {
    fail("ontology_evaluation_report_gate_mismatch");
  }
}

interface ExpectedEvaluationArtifact {
  runId: string;
  ontologyVersion: string;
  plaintextHash: string;
  objectKey: string;
  envelopeHash: string;
  ciphertextHash: string;
}

async function verifyEvaluationArtifact(
  env: Env,
  expected: ExpectedEvaluationArtifact,
): Promise<void> {
  if (
    expected.objectKey !==
      `${EVALUATION_OBJECT_PREFIX}${expected.runId}/evaluation-report.enc`
  ) {
    await verifyRetryEvaluationArtifact(env, expected);
    return;
  }
  if (!env.ARTIFACTS) fail("ontology_evaluation_artifact_missing");
  const object = await env.ARTIFACTS.get(expected.objectKey);
  if (!object) fail("ontology_evaluation_artifact_missing");
  if (object.size > MAX_EVALUATION_ARTIFACT_BYTES) {
    fail("ontology_evaluation_artifact_too_large");
  }
  const rawBytes = new Uint8Array(await object.arrayBuffer());
  const envelopeHash = await hashOntologyArtifactBytes(rawBytes);
  if (!hashesEqual(envelopeHash, expected.envelopeHash)) {
    fail("ontology_evaluation_artifact_envelope_hash_mismatch");
  }
  if (hasUtf8Bom(rawBytes)) {
    fail("ontology_evaluation_artifact_invalid");
  }
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(rawBytes);
  } catch {
    fail("ontology_evaluation_artifact_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("ontology_evaluation_artifact_invalid");
  }
  if (
    !isRecord(parsed) ||
    !hasExactFields(parsed, EVALUATION_ENVELOPE_FIELDS)
  ) {
    fail("ontology_evaluation_artifact_invalid");
  }
  if (canonicalJson(parsed) !== bytes) {
    fail("ontology_evaluation_artifact_noncanonical");
  }
  if (
    parsed.schema_version !== "ontology-evaluation-artifact/v1" ||
    parsed.artifact_class !== "evaluation_report" ||
    typeof parsed.run_id !== "string" ||
    typeof parsed.ontology_version !== "string" ||
    typeof parsed.plaintext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.plaintext_hash) ||
    typeof parsed.ciphertext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.ciphertext_hash) ||
    typeof parsed.ciphertext !== "string" ||
    !isRecord(parsed.encryption) ||
    !hasExactFields(parsed.encryption, ENCRYPTION_FIELDS) ||
    parsed.encryption.alg !== "AES-256-GCM" ||
    typeof parsed.encryption.key_id !== "string" ||
    !KEY_ID.test(parsed.encryption.key_id) ||
    typeof parsed.encryption.nonce !== "string"
  ) {
    fail("ontology_evaluation_artifact_invalid");
  }
  if (
    parsed.run_id !== expected.runId ||
    parsed.ontology_version !== expected.ontologyVersion
  ) {
    fail("ontology_evaluation_artifact_identity_mismatch");
  }
  if (!hashesEqual(parsed.plaintext_hash, expected.plaintextHash)) {
    fail("ontology_evaluation_artifact_plaintext_mismatch");
  }
  const nonce = decodeOntologyArtifactBase64Url(parsed.encryption.nonce);
  const ciphertext = decodeOntologyArtifactBase64Url(parsed.ciphertext);
  if (!nonce || nonce.byteLength !== 12 || !ciphertext || ciphertext.byteLength < 16) {
    fail("ontology_evaluation_artifact_invalid");
  }
  const ciphertextHash = await hashOntologyArtifactBytes(ciphertext);
  if (
    !hashesEqual(ciphertextHash, parsed.ciphertext_hash) ||
    !hashesEqual(ciphertextHash, expected.ciphertextHash)
  ) {
    fail("ontology_evaluation_artifact_ciphertext_hash_mismatch");
  }
  const keyring = parseArtifactKeyring(
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
  );
  const rawKey = keyring.get(parsed.encryption.key_id);
  if (!rawKey) fail("ontology_evaluation_artifact_key_unknown");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
  } catch {
    fail("ontology_evaluation_artifact_keyring_invalid");
  }
  const identity = evaluationArtifactIdentity(
    parsed.run_id,
    parsed.ontology_version,
    parsed.plaintext_hash,
    parsed.encryption.key_id,
    parsed.encryption.nonce,
  );
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: evaluationArtifactAad(identity),
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
  } catch {
    fail("ontology_evaluation_artifact_authentication_failed");
  }
  const plaintextHash = await hashOntologyArtifactBytes(plaintext);
  if (
    !hashesEqual(plaintextHash, parsed.plaintext_hash) ||
    !hashesEqual(plaintextHash, expected.plaintextHash)
  ) {
    fail("ontology_evaluation_artifact_plaintext_hash_mismatch");
  }
  verifyEvaluationReport(plaintext, expected.ontologyVersion);
}

interface RetryEvaluationArtifactRow {
  id: string;
  run_id: string;
  stage: "evaluating";
  stage_generation: number;
  stage_attempt: number;
  artifact_class: "evaluation_report";
  object_key: string;
  plaintext_sha256: string;
  envelope_sha256: string;
  ciphertext_sha256: string;
  deleted_at: string | null;
  expires_at: string | null;
  candidate_ontology_version: string;
}

async function verifyRetryEvaluationArtifact(
  env: Env,
  expected: ExpectedEvaluationArtifact,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT artifact.id, artifact.run_id, artifact.stage,
            artifact.stage_generation, artifact.stage_attempt,
            artifact.artifact_class, artifact.object_key,
            artifact.plaintext_sha256, artifact.envelope_sha256,
            artifact.ciphertext_sha256, artifact.deleted_at,
            artifact.expires_at, run.candidate_ontology_version
     FROM pattern_ontology_pipeline_artifacts artifact
     JOIN pattern_ontology_pipeline_runs run ON run.run_id = artifact.run_id
     WHERE artifact.run_id = ? AND artifact.object_key = ?
       AND artifact.stage = 'evaluating'
       AND artifact.artifact_class = 'evaluation_report'
       AND artifact.stage_attempt > 0`,
  ).bind(expected.runId, expected.objectKey).first<RetryEvaluationArtifactRow>();
  if (
    !row ||
    row.candidate_ontology_version !== expected.ontologyVersion ||
    row.deleted_at !== null ||
    row.expires_at !== null ||
    !hashesEqual(row.plaintext_sha256, expected.plaintextHash) ||
    !hashesEqual(row.envelope_sha256, expected.envelopeHash) ||
    !hashesEqual(row.ciphertext_sha256, expected.ciphertextHash)
  ) {
    fail("ontology_evaluation_artifact_identity_mismatch");
  }
  const coordinate: OntologyPipelineArtifactCoordinate = {
    runId: row.run_id,
    stage: row.stage,
    stageGeneration: row.stage_generation,
    stageAttempt: row.stage_attempt,
    artifactClass: row.artifact_class,
  };
  if (await ontologyPipelineArtifactIdentity(coordinate) !== row.id) {
    fail("ontology_evaluation_artifact_identity_mismatch");
  }
  let artifact;
  try {
    artifact = await readOntologyPipelineArtifact(env, coordinate);
  } catch {
    fail("ontology_evaluation_artifact_invalid");
  }
  if (
    !artifact ||
    artifact.artifact.objectKey !== expected.objectKey ||
    !hashesEqual(artifact.artifact.plaintextSha256, expected.plaintextHash) ||
    !hashesEqual(artifact.artifact.envelopeSha256, expected.envelopeHash) ||
    !hashesEqual(artifact.artifact.ciphertextSha256, expected.ciphertextHash)
  ) {
    fail("ontology_evaluation_artifact_identity_mismatch");
  }
  verifyEvaluationReport(artifact.plaintext, expected.ontologyVersion);
}

async function verifyCorpus(
  env: Env,
  expected: {
    releaseId: string;
    releaseHash: string;
    licenseClass: OntologyCorpusLicenseClass;
    publicCapable: boolean;
    locale?: string;
  },
): Promise<void> {
  try {
    const corpus = await readVerifiedPatternOntologyCorpus(
      env,
      expected.releaseId,
    );
    if (
      !hashesEqual(corpus.releaseHash, expected.releaseHash) ||
      corpus.licenseClass !== expected.licenseClass ||
      corpus.publicCapable !== expected.publicCapable ||
      (expected.locale !== undefined && corpus.locale !== expected.locale)
    ) {
      fail("ontology_evidence_corpus_mismatch");
    }
  } catch (cause) {
    if (cause instanceof PatternOntologyEvidenceError) throw cause;
    if (cause instanceof PatternOntologyCorpusError) fail(cause.code);
    throw cause;
  }
}

interface RegressionRunRow {
  stage: string;
  candidate_ontology_version: string;
  configuration_json: string;
  configuration_hash: string;
  corpus_release_id: string;
  corpus_hash: string;
  candidate_hash: string | null;
  evaluation_report_hash: string | null;
  regression_report_hash: string | null;
  bundle_hash: string | null;
}

interface ExpectedRegressionArtifact {
  runId: string;
  ontologyVersion: string;
  corpusReleaseId: string;
  corpusReleaseHash: string;
  evaluationReportHash: string;
  regressionReportHash: string;
  bundleHash: string;
  objectKey: string;
  envelopeHash: string;
  ciphertextHash: string;
  stageGeneration: number;
  stageAttempt: number;
}

async function verifyRegressionReport(
  plaintext: Uint8Array,
  expected: ExpectedRegressionArtifact,
  run: RegressionRunRow,
): Promise<void> {
  let command: unknown;
  let commandHash: string;
  try {
    command = JSON.parse(run.configuration_json);
    commandHash = await hashOntologyArtifactBytes(
      new TextEncoder().encode(run.configuration_json),
    );
  } catch {
    fail("ontology_regression_run_identity_mismatch");
  }
  if (
    !isRecord(command) ||
    canonicalJson(command) !== run.configuration_json ||
    commandHash !== run.configuration_hash ||
    (command.provider !== "openai" && command.provider !== "codex") ||
    typeof command.configuration_equal !== "boolean" ||
    command.candidate_ontology_version !== run.candidate_ontology_version ||
    !isRecord(command.corpus) ||
    command.corpus.corpus_release_id !== run.corpus_release_id ||
    command.corpus.corpus_hash !== run.corpus_hash ||
    !isRecord(command.regression) ||
    command.regression.fixture_count !== 30 ||
    command.regression.maximum_provider_calls_per_fixture !== 11 ||
    command.regression.minimum_pass_rate !==
      (command.configuration_equal
        ? ONTOLOGY_PIPELINE_EQUAL_MODEL_REGRESSION_MINIMUM_PASS_RATE
        : ONTOLOGY_PIPELINE_DEFAULT_REGRESSION_MINIMUM_PASS_RATE)
  ) {
    fail("ontology_regression_run_identity_mismatch");
  }
  try {
    const configurationHash = await ontologyRegressionConfigurationHash(
      command.provider,
    );
    await parseCanonicalOntologyRegressionReport(plaintext, {
      ontologyVersion: expected.ontologyVersion,
      commandHash: run.configuration_hash,
      configurationHash,
      corpusReleaseId: expected.corpusReleaseId,
      corpusHash: expected.corpusReleaseHash,
      corpusManifestHash: ONTOLOGY_REGRESSION_ACTIVATION_MANIFEST_HASH,
      candidateHash: run.candidate_hash!,
      evaluationReportHash: expected.evaluationReportHash,
      configurationEqual: command.configuration_equal,
    });
  } catch {
    fail("ontology_regression_report_invalid");
  }
}

async function verifyRegressionArtifact(
  env: Env,
  expected: ExpectedRegressionArtifact,
  stageExpectation: "commit" | "reverify",
): Promise<void> {
  const run = await env.DB.prepare(
    `SELECT stage, candidate_ontology_version, configuration_json,
            configuration_hash,
            corpus_release_id, corpus_hash, candidate_hash,
            evaluation_report_hash, regression_report_hash, bundle_hash
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(expected.runId).first<RegressionRunRow>();
  if (
    !run ||
    (stageExpectation === "commit"
      ? run.stage !== "ingesting"
      : run.stage !== "ingesting" && run.stage !== "succeeded") ||
    run.candidate_ontology_version !== expected.ontologyVersion ||
    run.corpus_release_id !== expected.corpusReleaseId ||
    !hashesEqual(run.corpus_hash, expected.corpusReleaseHash) ||
    !CONTENT_HASH.test(run.configuration_hash) ||
    !run.candidate_hash ||
    !CONTENT_HASH.test(run.candidate_hash) ||
    !run.evaluation_report_hash ||
    !hashesEqual(run.evaluation_report_hash, expected.evaluationReportHash) ||
    !run.regression_report_hash ||
    !hashesEqual(run.regression_report_hash, expected.regressionReportHash) ||
    !run.bundle_hash ||
    !hashesEqual(run.bundle_hash, expected.bundleHash)
  ) {
    fail("ontology_regression_run_identity_mismatch");
  }
  const coordinate: OntologyPipelineArtifactCoordinate = {
    runId: expected.runId,
    stage: "regressing",
    stageGeneration: expected.stageGeneration,
    stageAttempt: expected.stageAttempt,
    artifactClass: "regression_report",
  };
  let stored;
  try {
    stored = await readOntologyPipelineArtifact(env, coordinate);
  } catch {
    fail("ontology_regression_artifact_integrity_failed");
  }
  if (!stored) fail("ontology_regression_artifact_missing");
  if (
    stored.artifact.objectKey !== expected.objectKey ||
    !hashesEqual(
      stored.artifact.plaintextSha256,
      expected.regressionReportHash,
    ) ||
    !hashesEqual(stored.artifact.envelopeSha256, expected.envelopeHash) ||
    !hashesEqual(stored.artifact.ciphertextSha256, expected.ciphertextHash)
  ) {
    fail("ontology_regression_artifact_identity_mismatch");
  }
  await verifyRegressionReport(stored.plaintext, expected, run);
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
      row.evaluation_artifact_envelope_hash,
      input.evaluationArtifactEnvelopeHash,
    ) &&
    hashesEqual(
      row.evaluation_artifact_ciphertext_hash,
      input.evaluationArtifactCiphertextHash,
    ) &&
    row.regression_report_hash !== null &&
    hashesEqual(row.regression_report_hash, input.regressionReportHash) &&
    row.regression_artifact_object_key === input.regressionArtifactObjectKey &&
    row.regression_artifact_envelope_hash !== null &&
    hashesEqual(
      row.regression_artifact_envelope_hash,
      input.regressionArtifactEnvelopeHash,
    ) &&
    row.regression_artifact_ciphertext_hash !== null &&
    hashesEqual(
      row.regression_artifact_ciphertext_hash,
      input.regressionArtifactCiphertextHash,
    ) &&
    row.regression_artifact_stage_generation ===
      input.regressionArtifactStageGeneration &&
    row.regression_artifact_stage_attempt ===
      input.regressionArtifactStageAttempt &&
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
  await verifyCorpus(env, {
    releaseId: input.corpusReleaseId,
    releaseHash: input.corpusReleaseHash,
    licenseClass: input.corpusLicenseClass,
    publicCapable: input.corpusPublicCapable,
  });
  await verifyEvaluationArtifact(
    env,
    {
      runId: input.runId,
      ontologyVersion: input.ontologyVersion,
      plaintextHash: input.evaluationReportHash,
      objectKey: input.evaluationArtifactObjectKey,
      envelopeHash: input.evaluationArtifactEnvelopeHash,
      ciphertextHash: input.evaluationArtifactCiphertextHash,
    },
  );
  await verifyRegressionArtifact(env, {
    runId: input.runId,
    ontologyVersion: input.ontologyVersion,
    corpusReleaseId: input.corpusReleaseId,
    corpusReleaseHash: input.corpusReleaseHash,
    evaluationReportHash: input.evaluationReportHash,
    regressionReportHash: input.regressionReportHash,
    bundleHash: input.bundleHash,
    objectKey: input.regressionArtifactObjectKey,
    envelopeHash: input.regressionArtifactEnvelopeHash,
    ciphertextHash: input.regressionArtifactCiphertextHash,
    stageGeneration: input.regressionArtifactStageGeneration,
    stageAttempt: input.regressionArtifactStageAttempt,
  }, "commit");

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
         evaluation_artifact_envelope_hash,
         evaluation_artifact_ciphertext_hash, regression_report_hash,
         regression_artifact_object_key, regression_artifact_envelope_hash,
         regression_artifact_ciphertext_hash,
         regression_artifact_stage_generation, regression_artifact_stage_attempt,
         evaluation_artifact_status,
         signing_key_id, run_status, evidence_status, compiler_passed,
         evaluator_passed, unevaluated_fixture_count, created_at, committed_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed',
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
        input.evaluationArtifactEnvelopeHash,
        input.evaluationArtifactCiphertextHash,
        input.regressionReportHash,
        input.regressionArtifactObjectKey,
        input.regressionArtifactEnvelopeHash,
        input.regressionArtifactCiphertextHash,
        input.regressionArtifactStageGeneration,
        input.regressionArtifactStageAttempt,
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
  const regressionHash = release.evaluation.regression_report_hash;
  if (
    release.provenance?.origin !== "machine_pipeline" ||
    release.status !== "candidate" ||
    release.evaluation.verdict !== "pass" ||
    release.evaluation.compiler_passed !== true ||
    release.evaluation.evaluator_passed !== true ||
    release.evaluation.unevaluated_fixture_count !== 0 ||
    typeof evaluationHash !== "string" ||
    !CONTENT_HASH.test(evaluationHash)
  ) {
    fail("ontology_evaluation_not_passed");
  }
  if (
    release.evaluation.regression_passed !== true ||
    typeof regressionHash !== "string" ||
    !CONTENT_HASH.test(regressionHash)
  ) {
    fail("ontology_regression_not_passed");
  }

  const row = await env.DB.prepare(
    `SELECT * FROM pattern_ontology_pipeline_evidence
     WHERE ontology_version = ?`,
  )
    .bind(release.ontology_version)
    .first<EvidenceRow>();
  if (!row) fail("ontology_pipeline_evidence_missing");
  if (
    row.regression_report_hash === null ||
    row.regression_artifact_object_key === null ||
    row.regression_artifact_envelope_hash === null ||
    row.regression_artifact_ciphertext_hash === null ||
    row.regression_artifact_stage_generation === null ||
    row.regression_artifact_stage_attempt === null
  ) {
    fail("ontology_regression_evidence_missing");
  }
  if (
    row.run_status !== "succeeded" ||
    row.evidence_status !== "committed" ||
    row.evaluation_artifact_status !== "committed" ||
    row.compiler_passed !== 1 ||
    row.evaluator_passed !== 1 ||
    row.unevaluated_fixture_count !== 0 ||
    !CONTENT_HASH.test(row.corpus_release_hash) ||
    !CONTENT_HASH.test(row.bundle_hash) ||
    !CONTENT_HASH.test(row.evaluation_report_hash) ||
    !CONTENT_HASH.test(row.evaluation_artifact_envelope_hash) ||
    !CONTENT_HASH.test(row.evaluation_artifact_ciphertext_hash) ||
    !CONTENT_HASH.test(row.regression_report_hash) ||
    !CONTENT_HASH.test(row.regression_artifact_envelope_hash) ||
    !CONTENT_HASH.test(row.regression_artifact_ciphertext_hash) ||
    row.regression_artifact_object_key.length === 0 ||
    row.regression_artifact_object_key.length > 1024 ||
    !Number.isSafeInteger(row.regression_artifact_stage_generation) ||
    row.regression_artifact_stage_generation <= 0 ||
    !Number.isSafeInteger(row.regression_artifact_stage_attempt) ||
    row.regression_artifact_stage_attempt < 0
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
  if (!hashesEqual(row.regression_report_hash, regressionHash)) {
    fail("ontology_evidence_regression_mismatch");
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
  await verifyCorpus(env, {
    releaseId: row.corpus_release_id,
    releaseHash: row.corpus_release_hash,
    licenseClass: row.corpus_license_class,
    publicCapable: row.corpus_public_capable === 1,
    locale: release.locale,
  });
  await verifyEvaluationArtifact(
    env,
    {
      runId: row.run_id,
      ontologyVersion: row.ontology_version,
      plaintextHash: row.evaluation_report_hash,
      objectKey: row.evaluation_artifact_object_key,
      envelopeHash: row.evaluation_artifact_envelope_hash,
      ciphertextHash: row.evaluation_artifact_ciphertext_hash,
    },
  );
  await verifyRegressionArtifact(env, {
    runId: row.run_id,
    ontologyVersion: row.ontology_version,
    corpusReleaseId: row.corpus_release_id,
    corpusReleaseHash: row.corpus_release_hash,
    evaluationReportHash: row.evaluation_report_hash,
    regressionReportHash: row.regression_report_hash,
    bundleHash: row.bundle_hash,
    objectKey: row.regression_artifact_object_key,
    envelopeHash: row.regression_artifact_envelope_hash,
    ciphertextHash: row.regression_artifact_ciphertext_hash,
    stageGeneration: row.regression_artifact_stage_generation,
    stageAttempt: row.regression_artifact_stage_attempt,
  }, "reverify");

  const evidenceSummary = canonicalJson({
    activation_scope: row.activation_scope,
    bundle_hash: row.bundle_hash,
    compiler_passed: true,
    corpus_license_class: row.corpus_license_class,
    corpus_public_capable: row.corpus_public_capable === 1,
    corpus_release_hash: row.corpus_release_hash,
    corpus_release_id: row.corpus_release_id,
    evaluation_artifact_ciphertext_hash:
      row.evaluation_artifact_ciphertext_hash,
    evaluation_artifact_envelope_hash:
      row.evaluation_artifact_envelope_hash,
    evaluation_artifact_object_key: row.evaluation_artifact_object_key,
    evaluation_report_hash: row.evaluation_report_hash,
    evaluator_passed: true,
    ontology_version: row.ontology_version,
    run_id: row.run_id,
    regression_artifact_ciphertext_hash:
      row.regression_artifact_ciphertext_hash,
    regression_artifact_envelope_hash: row.regression_artifact_envelope_hash,
    regression_artifact_object_key: row.regression_artifact_object_key,
    regression_artifact_stage_attempt: row.regression_artifact_stage_attempt,
    regression_artifact_stage_generation:
      row.regression_artifact_stage_generation,
    regression_passed: true,
    regression_report_hash: row.regression_report_hash,
    signing_key_id: row.signing_key_id,
    unevaluated_fixture_count: 0,
  });
  return {
    runId: row.run_id,
    ontologyVersion: row.ontology_version,
    corpusReleaseId: row.corpus_release_id,
    corpusReleaseHash: row.corpus_release_hash,
    corpusLicenseClass: row.corpus_license_class,
    corpusPublicCapable: row.corpus_public_capable === 1,
    activationScope: row.activation_scope,
    bundleHash: row.bundle_hash,
    evaluationReportHash: row.evaluation_report_hash,
    evaluationArtifactObjectKey: row.evaluation_artifact_object_key,
    evaluationArtifactEnvelopeHash:
      row.evaluation_artifact_envelope_hash,
    evaluationArtifactCiphertextHash:
      row.evaluation_artifact_ciphertext_hash,
    regressionReportHash: row.regression_report_hash,
    regressionArtifactObjectKey: row.regression_artifact_object_key,
    regressionArtifactEnvelopeHash: row.regression_artifact_envelope_hash,
    regressionArtifactCiphertextHash:
      row.regression_artifact_ciphertext_hash,
    regressionArtifactStageGeneration:
      row.regression_artifact_stage_generation,
    regressionArtifactStageAttempt: row.regression_artifact_stage_attempt,
    signingKeyId: row.signing_key_id,
    compilerPassed: true,
    evaluatorPassed: true,
    regressionPassed: true,
    unevaluatedFixtureCount: 0,
    evidenceSummary,
  };
}
