import { canonicalJson } from "@patternlike/shared";

import type { Env } from "../env.js";
import {
  decodeOntologyArtifactBase64Url,
  decryptOntologyArtifact,
  encodeOntologyArtifactBase64Url,
  encryptOntologyArtifact,
  hashOntologyArtifactBytes,
  parseOntologyArtifactKeyring,
  selectOntologyArtifactEncryptionKey,
} from "./ontology-artifact-crypto.js";

export type OntologyPipelineStage =
  | "generating"
  | "compiling"
  | "evaluating"
  | "regressing"
  | "signing"
  | "ingesting";

export type OntologyPipelineArtifactClass =
  | "generator_request"
  | "generator_response"
  | "candidate_chunk"
  | "candidate_release"
  | "compilation_report"
  | "evaluator_request"
  | "evaluator_response"
  | "evaluator_verdict"
  | "evaluation_report"
  | "regression_request"
  | "regression_response"
  | "regression_result"
  | "regression_report"
  | "unsigned_bundle"
  | "signed_bundle"
  | "ingestion_receipt";

export interface OntologyPipelineArtifactCoordinate {
  runId: string;
  stage: OntologyPipelineStage;
  stageGeneration: number;
  stageAttempt: number;
  artifactClass: OntologyPipelineArtifactClass;
}

interface OntologyPipelineArtifactEnvelopeCoordinate
  extends OntologyPipelineArtifactCoordinate {
  ontologyVersion: string;
}

export interface OntologyPipelineArtifactRecord
  extends OntologyPipelineArtifactCoordinate {
  id: string;
  objectKey: string;
  plaintextSha256: string;
  envelopeSha256: string;
  ciphertextSha256: string;
  envelopeKeyId: string;
  envelopeNonce: string;
  byteLength: number;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

export interface SealedOntologyPipelineArtifact {
  envelopeBytes: Uint8Array;
  plaintextSha256: string;
  envelopeSha256: string;
  ciphertextSha256: string;
  envelopeKeyId: string;
  envelopeNonce: string;
  byteLength: number;
}

export interface PutOntologyPipelineArtifactResult {
  status: "created" | "adopted";
  artifact: OntologyPipelineArtifactRecord;
}

export interface ReadOntologyPipelineArtifactResult {
  artifact: OntologyPipelineArtifactRecord;
  plaintext: Uint8Array;
}

interface RunIdentityRow {
  candidate_ontology_version: string;
  stage: string;
  stage_generation: number;
  stage_attempt: number;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  stage: OntologyPipelineStage;
  stage_generation: number;
  stage_attempt: number;
  artifact_class: OntologyPipelineArtifactClass;
  object_key: string;
  plaintext_sha256: string;
  envelope_sha256: string;
  ciphertext_sha256: string;
  envelope_key_id: string;
  envelope_nonce: string;
  byte_length: number;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

type ParsedEnvelope = SealedOntologyPipelineArtifact & {
  plaintext: Uint8Array;
};

const MAX_PLAINTEXT_BYTES = 4 * 1024 * 1024;
const MAX_EVALUATION_ENVELOPE_BYTES = 4 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 6 * 1024 * 1024;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const ONTOLOGY_VERSION = /^.{1,200}$/;

const ARTIFACT_CLASSES: Readonly<Record<
  OntologyPipelineStage,
  ReadonlySet<OntologyPipelineArtifactClass>
>> = {
  generating: new Set([
    "generator_request",
    "generator_response",
    "candidate_chunk",
  ]),
  compiling: new Set(["candidate_release", "compilation_report"]),
  evaluating: new Set([
    "evaluator_request",
    "evaluator_response",
    "evaluator_verdict",
    "evaluation_report",
  ]),
  regressing: new Set([
    "regression_request",
    "regression_response",
    "regression_result",
    "regression_report",
  ]),
  signing: new Set(["unsigned_bundle", "signed_bundle"]),
  ingesting: new Set(["ingestion_receipt"]),
};

const EVALUATION_FIELDS = new Set([
  "schema_version",
  "artifact_class",
  "run_id",
  "ontology_version",
  "plaintext_hash",
  "ciphertext_hash",
  "encryption",
  "ciphertext",
]);
const PIPELINE_FIELDS = new Set([
  ...EVALUATION_FIELDS,
  "stage",
  "stage_generation",
  "stage_attempt",
]);
const ENCRYPTION_FIELDS = new Set(["alg", "key_id", "nonce"]);

function maximumEnvelopeBytes(
  artifactClass: OntologyPipelineArtifactClass,
): number {
  // Task 9's evaluation-evidence verifier already admits at most 4 MiB. Keep
  // creation inside that stable boundary; the generic pipeline envelope has
  // additional coordinate fields and its own separately bounded ceiling.
  return artifactClass === "evaluation_report"
    ? MAX_EVALUATION_ENVELOPE_BYTES
    : MAX_ENVELOPE_BYTES;
}

export class OntologyPipelineArtifactError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologyPipelineArtifactError";
  }
}

function fail(code: string): never {
  throw new OntologyPipelineArtifactError(code);
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

function coordinateIsValid(
  identity: OntologyPipelineArtifactCoordinate,
): boolean {
  return (
    RUN_ID.test(identity.runId) &&
    Number.isSafeInteger(identity.stageGeneration) &&
    identity.stageGeneration > 0 &&
    Number.isSafeInteger(identity.stageAttempt) &&
    identity.stageAttempt >= 0 &&
    ARTIFACT_CLASSES[identity.stage]?.has(identity.artifactClass) === true
  );
}

function coordinateJson(identity: OntologyPipelineArtifactCoordinate): string {
  return canonicalJson({
    artifact_class: identity.artifactClass,
    run_id: identity.runId,
    stage: identity.stage,
    stage_attempt: identity.stageAttempt,
    stage_generation: identity.stageGeneration,
  });
}

export async function ontologyPipelineArtifactIdentity(
  identity: OntologyPipelineArtifactCoordinate,
): Promise<string> {
  if (!coordinateIsValid(identity)) fail("ontology_pipeline_artifact_invalid");
  const hash = await hashOntologyArtifactBytes(
    new TextEncoder().encode(coordinateJson(identity)),
  );
  return `opart_${hash.slice("sha256:".length, "sha256:".length + 40)}`;
}

export async function ontologyPipelineArtifactObjectKey(
  identity: OntologyPipelineArtifactCoordinate,
): Promise<string> {
  if (!coordinateIsValid(identity)) fail("ontology_pipeline_artifact_invalid");
  if (
    identity.artifactClass === "evaluation_report" &&
    identity.stageAttempt === 0
  ) {
    return `pattern-ontology/pipeline/${identity.runId}/evaluation-report.enc`;
  }
  const id = await ontologyPipelineArtifactIdentity(identity);
  return `pattern-ontology/pipeline/${identity.runId}/${id}.enc`;
}

function authenticatedIdentity(
  identity: OntologyPipelineArtifactEnvelopeCoordinate,
  plaintextHash: string,
  keyId: string,
  nonce: string,
): Record<string, unknown> {
  const common = {
    artifact_class: identity.artifactClass,
    encryption: { key_id: keyId, nonce },
    ontology_version: identity.ontologyVersion,
    plaintext_hash: plaintextHash,
    run_id: identity.runId,
  };
  if (identity.artifactClass === "evaluation_report") {
    return {
      ...common,
      schema_version: "ontology-evaluation-artifact/v1",
    };
  }
  return {
    ...common,
    schema_version: "ontology-pipeline-artifact/v1",
    stage: identity.stage,
    stage_attempt: identity.stageAttempt,
    stage_generation: identity.stageGeneration,
  };
}

export async function createOntologyPipelineArtifactEnvelope(
  rawKeyring: string | undefined,
  identity: OntologyPipelineArtifactEnvelopeCoordinate,
  plaintext: Uint8Array,
  nonce = crypto.getRandomValues(new Uint8Array(12)),
): Promise<SealedOntologyPipelineArtifact> {
  if (
    !coordinateIsValid(identity) ||
    !ONTOLOGY_VERSION.test(identity.ontologyVersion) ||
    plaintext.byteLength > MAX_PLAINTEXT_BYTES ||
    nonce.byteLength !== 12
  ) {
    fail("ontology_pipeline_artifact_invalid");
  }
  const keyring = parseOntologyArtifactKeyring(rawKeyring);
  if (!keyring) fail("ontology_pipeline_artifact_keyring_invalid");
  const selected = selectOntologyArtifactEncryptionKey(keyring);
  if (!selected) fail("ontology_pipeline_artifact_keyring_invalid");
  const plaintextSha256 = await hashOntologyArtifactBytes(plaintext);
  const envelopeNonce = encodeOntologyArtifactBase64Url(nonce);
  const aadIdentity = authenticatedIdentity(
    identity,
    plaintextSha256,
    selected.keyId,
    envelopeNonce,
  );
  let ciphertext: Uint8Array;
  try {
    ciphertext = await encryptOntologyArtifact(
      selected.rawKey,
      nonce,
      plaintext,
      new TextEncoder().encode(canonicalJson(aadIdentity)),
    );
  } catch {
    fail("ontology_pipeline_artifact_keyring_invalid");
  }
  const ciphertextSha256 = await hashOntologyArtifactBytes(ciphertext);
  const envelope = {
    ...aadIdentity,
    ciphertext_hash: ciphertextSha256,
    encryption: {
      alg: "AES-256-GCM",
      key_id: selected.keyId,
      nonce: envelopeNonce,
    },
    ciphertext: encodeOntologyArtifactBase64Url(ciphertext),
  };
  const envelopeBytes = new TextEncoder().encode(canonicalJson(envelope));
  if (envelopeBytes.byteLength > maximumEnvelopeBytes(identity.artifactClass)) {
    fail("ontology_pipeline_artifact_too_large");
  }
  return {
    envelopeBytes,
    plaintextSha256,
    envelopeSha256: await hashOntologyArtifactBytes(envelopeBytes),
    ciphertextSha256,
    envelopeKeyId: selected.keyId,
    envelopeNonce,
    byteLength: plaintext.byteLength,
  };
}

function rowToArtifact(row: ArtifactRow): OntologyPipelineArtifactRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    stageGeneration: row.stage_generation,
    stageAttempt: row.stage_attempt,
    artifactClass: row.artifact_class,
    objectKey: row.object_key,
    plaintextSha256: row.plaintext_sha256,
    envelopeSha256: row.envelope_sha256,
    ciphertextSha256: row.ciphertext_sha256,
    envelopeKeyId: row.envelope_key_id,
    envelopeNonce: row.envelope_nonce,
    byteLength: row.byte_length,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
  };
}

async function loadRunIdentity(
  env: Pick<Env, "DB">,
  identity: OntologyPipelineArtifactCoordinate,
  requireCurrentOwner = true,
): Promise<OntologyPipelineArtifactEnvelopeCoordinate> {
  if (!coordinateIsValid(identity)) fail("ontology_pipeline_artifact_invalid");
  const row = await env.DB.prepare(
    `SELECT candidate_ontology_version, stage, stage_generation, stage_attempt
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(identity.runId).first<RunIdentityRow>();
  if (
    !row ||
    (requireCurrentOwner && (
      row.stage !== identity.stage ||
      row.stage_generation !== identity.stageGeneration ||
      row.stage_attempt !== identity.stageAttempt
    ))
  ) {
    fail("ontology_pipeline_artifact_stale_owner");
  }
  return { ...identity, ontologyVersion: row.candidate_ontology_version };
}

async function loadArtifactRow(
  env: Pick<Env, "DB">,
  identity: OntologyPipelineArtifactCoordinate,
): Promise<ArtifactRow | null> {
  return env.DB.prepare(
    `SELECT * FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = ? AND stage_generation = ?
       AND stage_attempt = ? AND artifact_class = ?`,
  ).bind(
    identity.runId,
    identity.stage,
    identity.stageGeneration,
    identity.stageAttempt,
    identity.artifactClass,
  ).first<ArtifactRow>();
}

function exactEnvelopeCoordinate(
  parsed: Record<string, unknown>,
  expected: OntologyPipelineArtifactEnvelopeCoordinate,
): boolean {
  const isEvaluation = expected.artifactClass === "evaluation_report";
  return (
    parsed.schema_version === (isEvaluation
      ? "ontology-evaluation-artifact/v1"
      : "ontology-pipeline-artifact/v1") &&
    parsed.artifact_class === expected.artifactClass &&
    parsed.run_id === expected.runId &&
    parsed.ontology_version === expected.ontologyVersion &&
    (isEvaluation || (
      parsed.stage === expected.stage &&
      parsed.stage_generation === expected.stageGeneration &&
      parsed.stage_attempt === expected.stageAttempt
    ))
  );
}

async function parseAndDecryptEnvelope(
  rawKeyring: string | undefined,
  expected: OntologyPipelineArtifactEnvelopeCoordinate,
  envelopeBytes: Uint8Array,
): Promise<ParsedEnvelope> {
  if (envelopeBytes.byteLength > maximumEnvelopeBytes(expected.artifactClass)) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(envelopeBytes);
  } catch {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  const fields = expected.artifactClass === "evaluation_report"
    ? EVALUATION_FIELDS
    : PIPELINE_FIELDS;
  if (
    !isRecord(parsed) ||
    !hasExactFields(parsed, fields) ||
    canonicalJson(parsed) !== bytes ||
    !exactEnvelopeCoordinate(parsed, expected) ||
    typeof parsed.plaintext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.plaintext_hash) ||
    typeof parsed.ciphertext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.ciphertext_hash) ||
    typeof parsed.ciphertext !== "string" ||
    !isRecord(parsed.encryption) ||
    !hasExactFields(parsed.encryption, ENCRYPTION_FIELDS) ||
    parsed.encryption.alg !== "AES-256-GCM" ||
    typeof parsed.encryption.key_id !== "string" ||
    typeof parsed.encryption.nonce !== "string"
  ) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  const nonce = decodeOntologyArtifactBase64Url(parsed.encryption.nonce);
  const ciphertext = decodeOntologyArtifactBase64Url(parsed.ciphertext);
  if (!nonce || nonce.byteLength !== 12 || !ciphertext || ciphertext.byteLength < 16) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  const ciphertextSha256 = await hashOntologyArtifactBytes(ciphertext);
  if (ciphertextSha256 !== parsed.ciphertext_hash) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  const keyring = parseOntologyArtifactKeyring(rawKeyring);
  const rawKey = keyring?.get(parsed.encryption.key_id);
  if (!rawKey) fail("ontology_pipeline_artifact_integrity_failed");
  const aad = authenticatedIdentity(
    expected,
    parsed.plaintext_hash,
    parsed.encryption.key_id,
    parsed.encryption.nonce,
  );
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptOntologyArtifact(
      rawKey,
      nonce,
      ciphertext,
      new TextEncoder().encode(canonicalJson(aad)),
    );
  } catch {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  if (
    plaintext.byteLength > MAX_PLAINTEXT_BYTES ||
    await hashOntologyArtifactBytes(plaintext) !== parsed.plaintext_hash
  ) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  return {
    envelopeBytes,
    plaintext,
    plaintextSha256: parsed.plaintext_hash,
    envelopeSha256: await hashOntologyArtifactBytes(envelopeBytes),
    ciphertextSha256,
    envelopeKeyId: parsed.encryption.key_id,
    envelopeNonce: parsed.encryption.nonce,
    byteLength: plaintext.byteLength,
  };
}

function rowMatchesSealed(
  row: ArtifactRow,
  id: string,
  objectKey: string,
  sealed: SealedOntologyPipelineArtifact,
): boolean {
  return (
    row.id === id &&
    row.object_key === objectKey &&
    row.plaintext_sha256 === sealed.plaintextSha256 &&
    row.envelope_sha256 === sealed.envelopeSha256 &&
    row.ciphertext_sha256 === sealed.ciphertextSha256 &&
    row.envelope_key_id === sealed.envelopeKeyId &&
    row.envelope_nonce === sealed.envelopeNonce &&
    row.byte_length === sealed.byteLength &&
    row.deleted_at === null
  );
}

async function verifyStored(
  env: Pick<Env, "ARTIFACTS" | "ONTOLOGY_PIPELINE_ARTIFACT_KEYRING">,
  expected: OntologyPipelineArtifactEnvelopeCoordinate,
  row: ArtifactRow | null,
  id: string,
  objectKey: string,
  requireAttemptMetadata = false,
): Promise<ParsedEnvelope> {
  if (!env.ARTIFACTS) fail("ontology_pipeline_artifact_unavailable");
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) fail("ontology_pipeline_artifact_integrity_failed");
  if (object.size > maximumEnvelopeBytes(expected.artifactClass)) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  if (requireAttemptMetadata) {
    const coordinateSha256 = await hashOntologyArtifactBytes(
      new TextEncoder().encode(coordinateJson(expected)),
    );
    if (
      object.customMetadata?.artifact_id !== id ||
      object.customMetadata.coordinate_sha256 !== coordinateSha256
    ) {
      fail("ontology_pipeline_artifact_integrity_failed");
    }
  }
  const parsed = await parseAndDecryptEnvelope(
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
    expected,
    new Uint8Array(await object.arrayBuffer()),
  );
  if (row && !rowMatchesSealed(row, id, objectKey, parsed)) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  return parsed;
}

async function insertArtifactRow(
  env: Pick<Env, "DB">,
  identity: OntologyPipelineArtifactCoordinate,
  id: string,
  objectKey: string,
  sealed: SealedOntologyPipelineArtifact,
  createdAt: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pipeline_artifacts (
       id, run_id, stage, stage_generation, stage_attempt, artifact_class,
       object_key, plaintext_sha256, envelope_sha256, ciphertext_sha256,
       envelope_key_id, envelope_nonce, byte_length, created_at,
       expires_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    id,
    identity.runId,
    identity.stage,
    identity.stageGeneration,
    identity.stageAttempt,
    identity.artifactClass,
    objectKey,
    sealed.plaintextSha256,
    sealed.envelopeSha256,
    sealed.ciphertextSha256,
    sealed.envelopeKeyId,
    sealed.envelopeNonce,
    sealed.byteLength,
    createdAt,
  ).run();
}

export async function putOntologyPipelineArtifact(
  env: Pick<Env, "DB" | "ARTIFACTS" | "ONTOLOGY_PIPELINE_ARTIFACT_KEYRING">,
  identity: OntologyPipelineArtifactCoordinate,
  plaintext: Uint8Array,
  createdAt = new Date(),
): Promise<PutOntologyPipelineArtifactResult> {
  const expected = await loadRunIdentity(env, identity);
  if (!env.ARTIFACTS) fail("ontology_pipeline_artifact_unavailable");
  const id = await ontologyPipelineArtifactIdentity(identity);
  const objectKey = await ontologyPipelineArtifactObjectKey(identity);
  const existing = await loadArtifactRow(env, identity);
  if (existing) {
    try {
      const stored = await verifyStored(env, expected, existing, id, objectKey);
      if (stored.plaintextSha256 !== await hashOntologyArtifactBytes(plaintext)) {
        fail("ontology_pipeline_artifact_conflict");
      }
      return { status: "adopted", artifact: rowToArtifact(existing) };
    } catch {
      fail("ontology_pipeline_artifact_conflict");
    }
  }

  const sealed = await createOntologyPipelineArtifactEnvelope(
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
    expected,
    plaintext,
  );
  const written = await env.ARTIFACTS.put(objectKey, sealed.envelopeBytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: {
      artifact_id: id,
      coordinate_sha256: await hashOntologyArtifactBytes(
        new TextEncoder().encode(coordinateJson(identity)),
      ),
    },
  });
  let admitted = sealed;
  let status: "created" | "adopted" = "created";
  if (written === null) {
    status = "adopted";
    try {
      admitted = await verifyStored(
        env,
        expected,
        null,
        id,
        objectKey,
        identity.artifactClass === "evaluation_report",
      );
      if (admitted.plaintextSha256 !== sealed.plaintextSha256) {
        fail("ontology_pipeline_artifact_conflict");
      }
    } catch {
      fail("ontology_pipeline_artifact_conflict");
    }
  }

  try {
    await insertArtifactRow(
      env,
      identity,
      id,
      objectKey,
      admitted,
      createdAt.toISOString(),
    );
  } catch {
    const raced = await loadArtifactRow(env, identity);
    if (!raced) fail("ontology_pipeline_artifact_conflict");
    try {
      const stored = await verifyStored(env, expected, raced, id, objectKey);
      if (stored.plaintextSha256 !== sealed.plaintextSha256) {
        fail("ontology_pipeline_artifact_conflict");
      }
      return { status: "adopted", artifact: rowToArtifact(raced) };
    } catch {
      fail("ontology_pipeline_artifact_conflict");
    }
  }
  const row = await loadArtifactRow(env, identity);
  if (!row || !rowMatchesSealed(row, id, objectKey, admitted)) {
    fail("ontology_pipeline_artifact_integrity_failed");
  }
  return { status, artifact: rowToArtifact(row) };
}

export async function readOntologyPipelineArtifact(
  env: Pick<Env, "DB" | "ARTIFACTS" | "ONTOLOGY_PIPELINE_ARTIFACT_KEYRING">,
  identity: OntologyPipelineArtifactCoordinate,
): Promise<ReadOntologyPipelineArtifactResult | null> {
  const row = await loadArtifactRow(env, identity);
  if (!row) return null;
  // Inventory rows are immutable evidence. A later stage must be able to read
  // prior-stage inputs, while only put/adoption requires the current owner.
  const expected = await loadRunIdentity(env, identity, false);
  const id = await ontologyPipelineArtifactIdentity(identity);
  const objectKey = await ontologyPipelineArtifactObjectKey(identity);
  const parsed = await verifyStored(env, expected, row, id, objectKey);
  return { artifact: rowToArtifact(row), plaintext: parsed.plaintext };
}
