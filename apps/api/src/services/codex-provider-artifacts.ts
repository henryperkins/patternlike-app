import { canonicalJson } from "@patternlike/shared";

import type { Env } from "../env.js";
import type {
  CodexProviderArtifactPointer,
  CodexProviderPass,
  CodexProviderPipeline,
} from "../db/codex-provider-jobs.js";
import {
  decodeOntologyArtifactBase64Url,
  decryptOntologyArtifact,
  encodeOntologyArtifactBase64Url,
  encryptOntologyArtifact,
  hashOntologyArtifactBytes,
  parseOntologyArtifactKeyring,
  selectOntologyArtifactEncryptionKey,
} from "./ontology-artifact-crypto.js";
import {
  CODEX_PROVIDER_MAX_REQUEST_BYTES,
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
} from "./codex-provider-contract.js";

export type CodexProviderArtifactRole = "request" | "response";

export interface CodexProviderArtifactCoordinate {
  jobId: string;
  pipeline: CodexProviderPipeline;
  ownerId: string;
  pass: CodexProviderPass;
  stageGeneration: number;
  stageAttempt: number;
  role: CodexProviderArtifactRole;
}

export type CodexProviderArtifactErrorCode =
  | "codex_provider_artifact_invalid"
  | "codex_provider_artifact_too_large"
  | "codex_provider_artifact_keyring_invalid"
  | "codex_provider_artifact_unavailable"
  | "codex_provider_artifact_conflict"
  | "codex_provider_artifact_integrity_failed";

export class CodexProviderArtifactError extends Error {
  constructor(readonly code: CodexProviderArtifactErrorCode) {
    super(code);
    this.name = "CodexProviderArtifactError";
  }
}

interface CodexProviderArtifactEnvelope {
  schema_version: "codex-provider-artifact/v1";
  job_id: string;
  pipeline: CodexProviderPipeline;
  owner_id: string;
  pass: CodexProviderPass;
  stage_generation: number;
  stage_attempt: number;
  role: CodexProviderArtifactRole;
  plaintext_hash: string;
  byte_length: number;
  encryption: {
    alg: "AES-256-GCM";
    key_id: string;
    nonce: string;
  };
  ciphertext_hash: string;
  ciphertext: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const JOB_ID = /^cpjob_[a-f0-9]{32}$/;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const ENVELOPE_FIELDS = new Set([
  "schema_version",
  "job_id",
  "pipeline",
  "owner_id",
  "pass",
  "stage_generation",
  "stage_attempt",
  "role",
  "plaintext_hash",
  "byte_length",
  "encryption",
  "ciphertext_hash",
  "ciphertext",
]);
const ENCRYPTION_FIELDS = new Set(["alg", "key_id", "nonce"]);

function fail(code: CodexProviderArtifactErrorCode): never {
  throw new CodexProviderArtifactError(code);
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

function coordinateIsValid(value: CodexProviderArtifactCoordinate): boolean {
  const passValid = [
    "planner",
    "writer",
    "verifier",
    "generator",
    "evaluator",
  ].includes(value.pass);
  return JOB_ID.test(value.jobId) &&
    (value.pipeline === "pattern" || value.pipeline === "ontology") &&
    value.ownerId.length >= 1 &&
    value.ownerId.length <= 200 &&
    passValid &&
    (value.pipeline === "ontology" ||
      (value.pass !== "generator" && value.pass !== "evaluator")) &&
    Number.isSafeInteger(value.stageGeneration) &&
    value.stageGeneration >= 0 &&
    Number.isSafeInteger(value.stageAttempt) &&
    value.stageAttempt >= 0 &&
    (value.role === "request" || value.role === "response");
}

function maximumPlaintextBytes(role: CodexProviderArtifactRole): number {
  return role === "request"
    ? CODEX_PROVIDER_MAX_REQUEST_BYTES
    : CODEX_PROVIDER_MAX_RESPONSE_BYTES;
}

function maximumEnvelopeBytes(role: CodexProviderArtifactRole): number {
  return Math.ceil(maximumPlaintextBytes(role) * 1.4) + 8192;
}

export function codexProviderArtifactObjectKey(
  coordinate: CodexProviderArtifactCoordinate,
): string {
  if (!coordinateIsValid(coordinate)) fail("codex_provider_artifact_invalid");
  return `codex-provider-jobs/${coordinate.jobId}/${coordinate.role}.json.enc`;
}

function authenticatedIdentity(
  coordinate: CodexProviderArtifactCoordinate,
  plaintextHash: string,
  byteLength: number,
  keyId: string,
  nonce: string,
) {
  return {
    schema_version: "codex-provider-artifact/v1" as const,
    job_id: coordinate.jobId,
    pipeline: coordinate.pipeline,
    owner_id: coordinate.ownerId,
    pass: coordinate.pass,
    stage_generation: coordinate.stageGeneration,
    stage_attempt: coordinate.stageAttempt,
    role: coordinate.role,
    plaintext_hash: plaintextHash,
    byte_length: byteLength,
    encryption: {
      alg: "AES-256-GCM" as const,
      key_id: keyId,
      nonce,
    },
  };
}

async function seal(
  rawKeyring: string | undefined,
  coordinate: CodexProviderArtifactCoordinate,
  plaintext: Uint8Array,
): Promise<{ bytes: Uint8Array; pointer: CodexProviderArtifactPointer }> {
  if (!coordinateIsValid(coordinate)) fail("codex_provider_artifact_invalid");
  if (plaintext.byteLength > maximumPlaintextBytes(coordinate.role)) {
    fail("codex_provider_artifact_too_large");
  }
  const keyring = parseOntologyArtifactKeyring(rawKeyring);
  const selected = keyring
    ? selectOntologyArtifactEncryptionKey(keyring)
    : null;
  if (!selected) fail("codex_provider_artifact_keyring_invalid");

  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const nonce = encodeOntologyArtifactBase64Url(nonceBytes);
  const plaintextHash = await hashOntologyArtifactBytes(plaintext);
  const identity = authenticatedIdentity(
    coordinate,
    plaintextHash,
    plaintext.byteLength,
    selected.keyId,
    nonce,
  );
  let ciphertext: Uint8Array;
  try {
    ciphertext = await encryptOntologyArtifact(
      selected.rawKey,
      nonceBytes,
      plaintext,
      textEncoder.encode(canonicalJson(identity)),
    );
  } catch {
    fail("codex_provider_artifact_keyring_invalid");
  }
  const ciphertextHash = await hashOntologyArtifactBytes(ciphertext);
  const envelope: CodexProviderArtifactEnvelope = {
    ...identity,
    ciphertext_hash: ciphertextHash,
    ciphertext: encodeOntologyArtifactBase64Url(ciphertext),
  };
  const bytes = textEncoder.encode(canonicalJson(envelope));
  if (bytes.byteLength > maximumEnvelopeBytes(coordinate.role)) {
    fail("codex_provider_artifact_too_large");
  }
  return {
    bytes,
    pointer: {
      objectKey: codexProviderArtifactObjectKey(coordinate),
      plaintextHash,
      envelopeHash: await hashOntologyArtifactBytes(bytes),
      ciphertextHash,
      keyId: selected.keyId,
      nonce,
      byteLength: plaintext.byteLength,
    },
  };
}

function coordinateMatches(
  envelope: CodexProviderArtifactEnvelope,
  coordinate: CodexProviderArtifactCoordinate,
): boolean {
  return envelope.schema_version === "codex-provider-artifact/v1" &&
    envelope.job_id === coordinate.jobId &&
    envelope.pipeline === coordinate.pipeline &&
    envelope.owner_id === coordinate.ownerId &&
    envelope.pass === coordinate.pass &&
    envelope.stage_generation === coordinate.stageGeneration &&
    envelope.stage_attempt === coordinate.stageAttempt &&
    envelope.role === coordinate.role;
}

async function openEnvelope(
  rawKeyring: string | undefined,
  coordinate: CodexProviderArtifactCoordinate,
  bytes: Uint8Array,
): Promise<{
  plaintext: Uint8Array;
  pointer: CodexProviderArtifactPointer;
}> {
  if (
    !coordinateIsValid(coordinate) ||
    bytes.byteLength > maximumEnvelopeBytes(coordinate.role)
  ) {
    fail("codex_provider_artifact_integrity_failed");
  }
  let text: string;
  let parsed: unknown;
  try {
    text = textDecoder.decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    fail("codex_provider_artifact_integrity_failed");
  }
  if (
    !isRecord(parsed) ||
    !hasExactFields(parsed, ENVELOPE_FIELDS) ||
    canonicalJson(parsed) !== text ||
    !isRecord(parsed.encryption) ||
    !hasExactFields(parsed.encryption, ENCRYPTION_FIELDS) ||
    parsed.encryption.alg !== "AES-256-GCM" ||
    typeof parsed.encryption.key_id !== "string" ||
    typeof parsed.encryption.nonce !== "string" ||
    typeof parsed.plaintext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.plaintext_hash) ||
    !Number.isSafeInteger(parsed.byte_length) ||
    (parsed.byte_length as number) < 0 ||
    (parsed.byte_length as number) > maximumPlaintextBytes(coordinate.role) ||
    typeof parsed.ciphertext_hash !== "string" ||
    !CONTENT_HASH.test(parsed.ciphertext_hash) ||
    typeof parsed.ciphertext !== "string" ||
    !coordinateMatches(
      parsed as unknown as CodexProviderArtifactEnvelope,
      coordinate,
    )
  ) {
    fail("codex_provider_artifact_integrity_failed");
  }
  const envelope = parsed as unknown as CodexProviderArtifactEnvelope;
  const nonce = decodeOntologyArtifactBase64Url(envelope.encryption.nonce);
  const ciphertext = decodeOntologyArtifactBase64Url(envelope.ciphertext);
  if (!nonce || nonce.byteLength !== 12 || !ciphertext) {
    fail("codex_provider_artifact_integrity_failed");
  }
  if (await hashOntologyArtifactBytes(ciphertext) !== envelope.ciphertext_hash) {
    fail("codex_provider_artifact_integrity_failed");
  }
  const keyring = parseOntologyArtifactKeyring(rawKeyring);
  const rawKey = keyring?.get(envelope.encryption.key_id);
  if (!rawKey) fail("codex_provider_artifact_integrity_failed");
  const identity = authenticatedIdentity(
    coordinate,
    envelope.plaintext_hash,
    envelope.byte_length,
    envelope.encryption.key_id,
    envelope.encryption.nonce,
  );
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptOntologyArtifact(
      rawKey,
      nonce,
      ciphertext,
      textEncoder.encode(canonicalJson(identity)),
    );
  } catch {
    fail("codex_provider_artifact_integrity_failed");
  }
  if (
    plaintext.byteLength !== envelope.byte_length ||
    await hashOntologyArtifactBytes(plaintext) !== envelope.plaintext_hash
  ) {
    fail("codex_provider_artifact_integrity_failed");
  }
  return {
    plaintext,
    pointer: {
      objectKey: codexProviderArtifactObjectKey(coordinate),
      plaintextHash: envelope.plaintext_hash,
      envelopeHash: await hashOntologyArtifactBytes(bytes),
      ciphertextHash: envelope.ciphertext_hash,
      keyId: envelope.encryption.key_id,
      nonce: envelope.encryption.nonce,
      byteLength: envelope.byte_length,
    },
  };
}

async function readObject(
  env: Pick<Env, "ARTIFACTS">,
  coordinate: CodexProviderArtifactCoordinate,
): Promise<Uint8Array> {
  if (!env.ARTIFACTS) fail("codex_provider_artifact_unavailable");
  const object = await env.ARTIFACTS.get(
    codexProviderArtifactObjectKey(coordinate),
  );
  if (!object) fail("codex_provider_artifact_unavailable");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > maximumEnvelopeBytes(coordinate.role)) {
    fail("codex_provider_artifact_integrity_failed");
  }
  return bytes;
}

export async function putCodexProviderArtifact(
  env: Pick<Env, "ARTIFACTS" | "CODEX_PROVIDER_ARTIFACT_KEYRING">,
  coordinate: CodexProviderArtifactCoordinate,
  plaintext: Uint8Array,
): Promise<{
  status: "created" | "adopted";
  artifact: CodexProviderArtifactPointer;
}> {
  if (!env.ARTIFACTS) fail("codex_provider_artifact_unavailable");
  const sealed = await seal(
    env.CODEX_PROVIDER_ARTIFACT_KEYRING,
    coordinate,
    plaintext,
  );
  const written = await env.ARTIFACTS.put(
    sealed.pointer.objectKey,
    sealed.bytes,
    { onlyIf: { etagDoesNotMatch: "*" } },
  );
  if (written !== null) {
    return { status: "created", artifact: sealed.pointer };
  }
  let existing: Awaited<ReturnType<typeof openEnvelope>>;
  try {
    existing = await openEnvelope(
      env.CODEX_PROVIDER_ARTIFACT_KEYRING,
      coordinate,
      await readObject(env, coordinate),
    );
  } catch {
    fail("codex_provider_artifact_conflict");
  }
  if (existing.pointer.plaintextHash !== sealed.pointer.plaintextHash) {
    fail("codex_provider_artifact_conflict");
  }
  return { status: "adopted", artifact: existing.pointer };
}

export async function readCodexProviderArtifact(
  env: Pick<Env, "ARTIFACTS" | "CODEX_PROVIDER_ARTIFACT_KEYRING">,
  coordinate: CodexProviderArtifactCoordinate,
  expected: CodexProviderArtifactPointer,
): Promise<Uint8Array> {
  if (expected.objectKey !== codexProviderArtifactObjectKey(coordinate)) {
    fail("codex_provider_artifact_integrity_failed");
  }
  const opened = await openEnvelope(
    env.CODEX_PROVIDER_ARTIFACT_KEYRING,
    coordinate,
    await readObject(env, coordinate),
  );
  if (canonicalJson(opened.pointer) !== canonicalJson(expected)) {
    fail("codex_provider_artifact_integrity_failed");
  }
  return opened.plaintext;
}
