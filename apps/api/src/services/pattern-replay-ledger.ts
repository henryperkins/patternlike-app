import {
  M7_SCHEMA_VERSION,
  contentHash,
  jcsCanonicalize,
  sha256Hex,
} from "@patternlike/shared";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import m0CommonSchema from "../../../../contracts/m0/common.schema.json";
import m7CommonSchema from "../../../../contracts/m7/common.schema.json";
import replayEventSchema from "../../../../contracts/m7/pattern-erasure-replay-event.schema.json";
import type { Env } from "../env.js";

export const PATTERN_REPLAY_EVENT_CLASSES = [
  "claim_consumed",
  "pattern_deleted",
  "chart_correction_erased",
  "pattern_withdrawn",
  "ontology_recalled",
  "account_deleted",
] as const;

export type PatternReplayEventClass =
  (typeof PATTERN_REPLAY_EVENT_CLASSES)[number];

export type PatternReplayClaimStatus =
  | "available"
  | "reserved"
  | "accepted"
  | "deleted"
  | "superseded"
  | "withdrawn";

export interface PatternErasureReplayEvent {
  schema_version: typeof M7_SCHEMA_VERSION;
  event_id: string;
  event_class: PatternReplayEventClass;
  occurred_at: string;
  target_user_id: string | null;
  chart_fingerprint_hash: string | null;
  claim_id: string | null;
  generation_id: string | null;
  pattern_id: string | null;
  ontology_version: string | null;
  prior_claim_status: PatternReplayClaimStatus | null;
  next_claim_status: Exclude<
    PatternReplayClaimStatus,
    "available" | "reserved"
  > | null;
  content_hash: string;
  signing_key_id: string;
  signature: string;
}

export interface ParsedPatternReplaySigningKey {
  keyId: string;
  privateKeyPkcs8: Uint8Array;
}

export interface PatternReplayIntentInput {
  eventClass: PatternReplayEventClass;
  semanticOperationKey: string;
  targetUserId: string | null;
  chartFingerprintHash: string | null;
  claimId: string | null;
  generationId: string | null;
  patternId: string | null;
  ontologyVersion: string | null;
  priorClaimStatus: PatternReplayClaimStatus | null;
  nextClaimStatus: Exclude<
    PatternReplayClaimStatus,
    "available" | "reserved"
  > | null;
}

export interface PreparedPatternReplayEvent {
  event: PatternErasureReplayEvent;
  objectKey: string;
  canonicalBytes: string;
  replicaPutAt: string;
}

export class PatternReplayLedgerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PatternReplayLedgerError";
  }
}

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_PUBLIC_KEYS = 16;
const MAX_REPLAY_EVENT_BYTES = 32 * 1024;
const REPLAY_EVENT_ID_PATTERN = /^prel_[0-9a-f]{32}$/;
const REPLAY_OBJECT_PREFIX = "pattern-erasure-replay/";
const WRITER_FIELDS = new Set([
  "version",
  "key_id",
  "private_key_pkcs8",
]);
const PUBLIC_KEY_FIELDS = new Set(["alg", "public_key"]);

const schemaValidator = new Ajv2020({ strict: true });
addFormats(schemaValidator);
for (const schema of [m0CommonSchema, m7CommonSchema, replayEventSchema]) {
  schemaValidator.addSchema(schema);
}
function requiredReplayEventValidator(): ValidateFunction<PatternErasureReplayEvent> {
  const validator = schemaValidator.getSchema<PatternErasureReplayEvent>(
    replayEventSchema.$id,
  );
  if (!validator) {
    throw new Error("Frozen M7 replay event schema is unavailable");
  }
  return validator;
}
const validateReplayEvent = requiredReplayEventValidator();

function fail(code: string): never {
  throw new PatternReplayLedgerError(code);
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

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value)) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const decoded = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    return toBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

export function parsePatternReplaySigningKey(
  raw: string | undefined,
): ParsedPatternReplaySigningKey | null {
  if (!raw || raw.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactFields(value, WRITER_FIELDS)) return null;
  if (
    value.version !== 1 ||
    typeof value.key_id !== "string" ||
    !KEY_ID_PATTERN.test(value.key_id) ||
    typeof value.private_key_pkcs8 !== "string"
  ) {
    return null;
  }
  const privateKeyPkcs8 = decodeBase64Url(value.private_key_pkcs8);
  if (
    !privateKeyPkcs8 ||
    privateKeyPkcs8.byteLength < 32 ||
    privateKeyPkcs8.byteLength > 1024
  ) {
    return null;
  }
  return { keyId: value.key_id, privateKeyPkcs8 };
}

export function parsePatternReplayKeyring(
  raw: string | undefined,
): Map<string, Uint8Array> | null {
  if (!raw || raw.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_PUBLIC_KEYS) return null;
  const keys = new Map<string, Uint8Array>();
  for (const [keyId, candidate] of entries) {
    if (
      !KEY_ID_PATTERN.test(keyId) ||
      !isRecord(candidate) ||
      !hasExactFields(candidate, PUBLIC_KEY_FIELDS) ||
      candidate.alg !== "Ed25519" ||
      typeof candidate.public_key !== "string"
    ) {
      return null;
    }
    const publicKey = decodeBase64Url(candidate.public_key);
    if (!publicKey || publicKey.byteLength !== 32) return null;
    keys.set(keyId, publicKey);
  }
  return keys;
}

function replaySigningPayload(event: PatternErasureReplayEvent): string {
  const {
    content_hash: _contentHash,
    signature: _signature,
    ...unsigned
  } = event;
  return jcsCanonicalize(unsigned);
}

async function importReplayVerifyKey(
  raw: Uint8Array,
): Promise<CryptoKey | null> {
  const attempts: SubtleCryptoImportKeyAlgorithm[] = [
    { name: "Ed25519" },
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
  ];
  for (const params of attempts) {
    try {
      return await crypto.subtle.importKey("raw", raw, params, false, [
        "verify",
      ]);
    } catch {
      // Workerd compatibility dates use one of the two Ed25519 spellings.
    }
  }
  return null;
}

export async function verifyPatternReplayEvent(
  value: unknown,
  rawKeyring: string | undefined,
): Promise<PatternErasureReplayEvent> {
  if (!validateReplayEvent(value)) fail("replay_event_schema_invalid");
  const event = value as PatternErasureReplayEvent;
  const payload = replaySigningPayload(event);
  if (await contentHash(payload) !== event.content_hash) {
    fail("replay_event_hash_mismatch");
  }
  const keyring = parsePatternReplayKeyring(rawKeyring);
  if (!keyring) fail("replay_keyring_invalid");
  const rawKey = keyring.get(event.signing_key_id);
  if (!rawKey) fail("replay_event_key_unknown");
  const signature = decodeBase64Url(event.signature);
  if (!signature || signature.byteLength !== 64) {
    fail("replay_event_signature_invalid");
  }
  const key = await importReplayVerifyKey(rawKey);
  if (!key) fail("replay_keyring_invalid");
  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      { name: key.algorithm.name },
      key,
      signature,
      new TextEncoder().encode(payload),
    );
  } catch {
    fail("replay_event_signature_invalid");
  }
  if (!verified) fail("replay_event_signature_invalid");
  return event;
}

export async function patternReplayEventId(
  eventClass: PatternReplayEventClass,
  semanticOperationKey: string,
): Promise<string> {
  if (
    !(PATTERN_REPLAY_EVENT_CLASSES as readonly string[]).includes(eventClass) ||
    semanticOperationKey.length === 0 ||
    semanticOperationKey.length > 512
  ) {
    fail("replay_intent_invalid");
  }
  const digest = await sha256Hex(jcsCanonicalize([
    "pattern-erasure-replay-event-v1",
    eventClass,
    semanticOperationKey,
  ]));
  return `prel_${digest.slice(0, 32)}`;
}

export function patternReplayObjectKey(eventId: string): string {
  if (!REPLAY_EVENT_ID_PATTERN.test(eventId)) {
    fail("replay_intent_invalid");
  }
  return `${REPLAY_OBJECT_PREFIX}${eventId}.json`;
}

async function importReplaySigningKey(
  raw: Uint8Array,
): Promise<CryptoKey | null> {
  const attempts: SubtleCryptoImportKeyAlgorithm[] = [
    { name: "Ed25519" },
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
  ];
  for (const params of attempts) {
    try {
      return await crypto.subtle.importKey("pkcs8", raw, params, false, [
        "sign",
      ]);
    } catch {
      // Workerd compatibility dates use one of the two Ed25519 spellings.
    }
  }
  return null;
}

async function signReplayPayload(
  key: CryptoKey,
  payload: string,
): Promise<string> {
  try {
    const signature = await crypto.subtle.sign(
      { name: key.algorithm.name },
      key,
      new TextEncoder().encode(payload),
    );
    return toBase64Url(new Uint8Array(signature));
  } catch {
    fail("replay_signing_configuration_invalid");
  }
}

function eventMatchesIntent(
  event: PatternErasureReplayEvent,
  eventId: string,
  input: PatternReplayIntentInput,
): boolean {
  return (
    event.event_id === eventId &&
    event.event_class === input.eventClass &&
    event.target_user_id === input.targetUserId &&
    event.chart_fingerprint_hash === input.chartFingerprintHash &&
    event.claim_id === input.claimId &&
    event.generation_id === input.generationId &&
    event.pattern_id === input.patternId &&
    event.ontology_version === input.ontologyVersion &&
    event.prior_claim_status === input.priorClaimStatus &&
    event.next_claim_status === input.nextClaimStatus
  );
}

function decodeReplayBytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPLAY_EVENT_BYTES) {
    fail("replay_replica_integrity");
  }
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
  } catch {
    fail("replay_replica_integrity");
  }
}

async function readReplicaEvent(
  bucket: R2Bucket,
  objectKey: string,
  rawKeyring: string | undefined,
): Promise<PreparedPatternReplayEvent | null> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(objectKey);
  } catch {
    fail("replay_replica_unavailable");
  }
  if (!object) return null;
  let bytes: string;
  try {
    bytes = decodeReplayBytes(new Uint8Array(await object.arrayBuffer()));
  } catch (cause) {
    if (cause instanceof PatternReplayLedgerError) throw cause;
    fail("replay_replica_integrity");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("replay_replica_integrity");
  }
  let event: PatternErasureReplayEvent;
  try {
    event = await verifyPatternReplayEvent(parsed, rawKeyring);
  } catch {
    fail("replay_replica_integrity");
  }
  if (jcsCanonicalize(event) !== bytes) fail("replay_replica_integrity");
  return {
    event,
    objectKey,
    canonicalBytes: bytes,
    replicaPutAt: object.uploaded.toISOString(),
  };
}

async function adoptReplicaEvent(
  bucket: R2Bucket,
  objectKey: string,
  rawKeyring: string | undefined,
  eventId: string,
  input: PatternReplayIntentInput,
): Promise<PreparedPatternReplayEvent | null> {
  const stored = await readReplicaEvent(bucket, objectKey, rawKeyring);
  if (stored && !eventMatchesIntent(stored.event, eventId, input)) {
    fail("replay_replica_integrity");
  }
  return stored;
}

export async function writePatternReplayIntent(
  env: Env,
  input: PatternReplayIntentInput,
  now = new Date(),
): Promise<PreparedPatternReplayEvent> {
  if (!env.PATTERN_REPLAY_LEDGER || !Number.isFinite(now.getTime())) {
    fail("replay_replica_unavailable");
  }
  const eventId = await patternReplayEventId(
    input.eventClass,
    input.semanticOperationKey,
  );
  const objectKey = patternReplayObjectKey(eventId);
  const adopted = await adoptReplicaEvent(
    env.PATTERN_REPLAY_LEDGER,
    objectKey,
    env.PATTERN_REPLAY_LEDGER_KEYS,
    eventId,
    input,
  );
  if (adopted) return adopted;

  const writer = parsePatternReplaySigningKey(
    env.PATTERN_REPLAY_LEDGER_SIGNING_KEY,
  );
  const keyring = parsePatternReplayKeyring(env.PATTERN_REPLAY_LEDGER_KEYS);
  if (!writer || !keyring?.has(writer.keyId)) {
    fail("replay_signing_configuration_invalid");
  }
  const signingKey = await importReplaySigningKey(writer.privateKeyPkcs8);
  if (!signingKey) fail("replay_signing_configuration_invalid");

  const unsigned = {
    schema_version: M7_SCHEMA_VERSION,
    event_id: eventId,
    event_class: input.eventClass,
    occurred_at: now.toISOString(),
    target_user_id: input.targetUserId,
    chart_fingerprint_hash: input.chartFingerprintHash,
    claim_id: input.claimId,
    generation_id: input.generationId,
    pattern_id: input.patternId,
    ontology_version: input.ontologyVersion,
    prior_claim_status: input.priorClaimStatus,
    next_claim_status: input.nextClaimStatus,
    signing_key_id: writer.keyId,
  };
  const payload = jcsCanonicalize(unsigned);
  const event: PatternErasureReplayEvent = {
    ...unsigned,
    content_hash: await contentHash(payload),
    signature: await signReplayPayload(signingKey, payload),
  };
  try {
    await verifyPatternReplayEvent(event, env.PATTERN_REPLAY_LEDGER_KEYS);
  } catch {
    fail("replay_signing_configuration_invalid");
  }
  const canonicalBytes = jcsCanonicalize(event);
  try {
    await env.PATTERN_REPLAY_LEDGER.put(objectKey, canonicalBytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // A transport failure can still have committed. Only a verified readback
    // authorizes the caller to proceed to its D1 lifecycle mutation.
  }
  const stored = await adoptReplicaEvent(
    env.PATTERN_REPLAY_LEDGER,
    objectKey,
    env.PATTERN_REPLAY_LEDGER_KEYS,
    eventId,
    input,
  );
  if (!stored) fail("replay_replica_unavailable");
  return stored;
}
