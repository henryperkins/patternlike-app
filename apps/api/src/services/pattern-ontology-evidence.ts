import {
  canonicalJson,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import type { Env } from "../env.js";
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
  signingKeyId: string;
  compilerPassed: true;
  evaluatorPassed: true;
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
    input.evaluationArtifactObjectKey ===
      `${EVALUATION_OBJECT_PREFIX}${input.runId}/evaluation-report.enc` &&
    KEY_ID.test(input.signingKeyId) &&
    input.compilerPassed === true &&
    input.evaluatorPassed === true &&
    input.unevaluatedFixtureCount === 0 &&
    publicCapabilityMatchesLicense
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
         evaluation_artifact_ciphertext_hash, evaluation_artifact_status,
         signing_key_id, run_status, evidence_status, compiler_passed,
         evaluator_passed, unevaluated_fixture_count, created_at, committed_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed',
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
    row.unevaluated_fixture_count !== 0 ||
    !CONTENT_HASH.test(row.corpus_release_hash) ||
    !CONTENT_HASH.test(row.bundle_hash) ||
    !CONTENT_HASH.test(row.evaluation_report_hash) ||
    !CONTENT_HASH.test(row.evaluation_artifact_envelope_hash) ||
    !CONTENT_HASH.test(row.evaluation_artifact_ciphertext_hash)
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
    signingKeyId: row.signing_key_id,
    compilerPassed: true,
    evaluatorPassed: true,
    unevaluatedFixtureCount: 0,
    evidenceSummary,
  };
}
