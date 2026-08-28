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
import {
  collectDeletionArtifactKeys,
  DELETED_USER_TABLES,
  deleteUserRows,
} from "./deletion-manifest.js";

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

export class PreparedPatternReplayEvent {
  constructor(
    readonly event: PatternErasureReplayEvent,
    readonly objectKey: string,
    readonly canonicalBytes: string,
    readonly replicaPutAt: string,
  ) {}

  receiptStatements(
    env: Pick<Env, "DB">,
  ): D1PreparedStatement[] {
    const event = this.event;
    const values = [
      event.event_id,
      event.event_class,
      event.occurred_at,
      event.target_user_id,
      event.chart_fingerprint_hash,
      event.claim_id,
      event.generation_id,
      event.pattern_id,
      event.ontology_version,
      event.prior_claim_status,
      event.next_claim_status,
      event.content_hash,
      event.signing_key_id,
      event.signature,
      this.replicaPutAt,
      this.replicaPutAt,
    ] as const;
    return [
      env.DB.prepare(
        `INSERT OR IGNORE INTO pattern_erasure_replay_events (
           event_id, event_class, occurred_at, target_user_id,
           chart_fingerprint_hash, claim_id, generation_id, pattern_id,
           ontology_version, prior_claim_status, next_claim_status,
           content_hash, signing_key_id, signature, replica_put_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(...values),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'Pattern replay receipt did not converge'
         WHERE NOT EXISTS (
           SELECT 1 FROM pattern_erasure_replay_events
           WHERE event_id IS ?
             AND event_class IS ?
             AND occurred_at IS ?
             AND target_user_id IS ?
             AND chart_fingerprint_hash IS ?
             AND claim_id IS ?
             AND generation_id IS ?
             AND pattern_id IS ?
             AND ontology_version IS ?
             AND prior_claim_status IS ?
             AND next_claim_status IS ?
             AND content_hash IS ?
             AND signing_key_id IS ?
             AND signature IS ?
             AND replica_put_at IS ?
             AND created_at IS ?
         )`,
      ).bind(...values),
    ];
  }
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
  return new PreparedPatternReplayEvent(
    event,
    objectKey,
    bytes,
    object.uploaded.toISOString(),
  );
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

function terminalClaimTimestamp(
  status: PatternErasureReplayEvent["next_claim_status"],
  expected: Exclude<PatternReplayClaimStatus, "available" | "reserved">,
  occurredAt: string,
): string | null {
  return status === expected ? occurredAt : null;
}

async function existingReplicaPutAt(
  env: Pick<Env, "DB">,
  eventId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT replica_put_at FROM pattern_erasure_replay_events
     WHERE event_id = ?`,
  ).bind(eventId).first<{ replica_put_at: string }>();
  return row?.replica_put_at ?? null;
}

function claimReplayStatements(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement[] {
  const acceptedAt = terminalClaimTimestamp(
    event.next_claim_status,
    "accepted",
    event.occurred_at,
  );
  const deletedAt = terminalClaimTimestamp(
    event.next_claim_status,
    "deleted",
    event.occurred_at,
  );
  const supersededAt = terminalClaimTimestamp(
    event.next_claim_status,
    "superseded",
    event.occurred_at,
  );
  const withdrawnAt = terminalClaimTimestamp(
    event.next_claim_status,
    "withdrawn",
    event.occurred_at,
  );
  const replayGenerationId = event.generation_id ?? `replay:${event.event_id}`;
  return [
    env.DB.prepare(
      `INSERT OR IGNORE INTO pattern_generation_claims (
         id, user_id, chart_fingerprint_hash, last_chart_id, status,
         active_generation_id, consumed_at, accepted_at, deleted_at,
         superseded_at, withdrawn_at, created_at, updated_at
       )
       SELECT ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
    ).bind(
      event.claim_id,
      event.target_user_id,
      event.chart_fingerprint_hash,
      event.next_claim_status,
      event.occurred_at,
      acceptedAt,
      deletedAt,
      supersededAt,
      withdrawnAt,
      event.occurred_at,
      event.occurred_at,
      event.target_user_id,
    ),
    // Replay is the documented exception to live repository ownership, not to
    // monotonicity. An existing available row converges through the same legal
    // forward edges as a live row rather than jumping straight to a consumed
    // state and bypassing the D1 transition guard.
    env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'reserved', active_generation_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
         AND status = 'available' AND consumed_at IS NULL`,
    ).bind(
      replayGenerationId,
      event.occurred_at,
      event.claim_id,
      event.target_user_id,
      event.chart_fingerprint_hash,
    ),
    env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'accepted', active_generation_id = NULL,
           consumed_at = ?, accepted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
         AND status = 'reserved' AND consumed_at IS NULL`,
    ).bind(
      event.occurred_at,
      event.occurred_at,
      event.occurred_at,
      event.claim_id,
      event.target_user_id,
      event.chart_fingerprint_hash,
    ),
    ...(event.next_claim_status === "accepted"
      ? []
      : [env.DB.prepare(
          `UPDATE pattern_generation_claims
           SET status = ?,
               deleted_at = COALESCE(deleted_at, ?),
               superseded_at = COALESCE(superseded_at, ?),
               withdrawn_at = COALESCE(withdrawn_at, ?),
               updated_at = ?
           WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
             AND status = 'accepted'`,
        ).bind(
          event.next_claim_status,
          deletedAt,
          supersededAt,
          withdrawnAt,
          event.occurred_at,
          event.claim_id,
          event.target_user_id,
          event.chart_fingerprint_hash,
        )]),
  ];
}

function erasureReplayStatements(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `DELETE FROM pattern_documents
       WHERE user_id = ? AND claim_id = ?
         AND (? IS NULL OR generation_id = ?)
         AND (? IS NULL OR id = ?)`,
    ).bind(
      event.target_user_id,
      event.claim_id,
      event.generation_id,
      event.generation_id,
      event.pattern_id,
      event.pattern_id,
    ),
    env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL,
           wrapped_key_nonce = NULL, erased_at = COALESCE(erased_at, ?)
       WHERE user_id = ? AND erased_at IS NULL
         AND (
           (? IS NOT NULL AND generation_id = ?)
           OR (
             ? IS NULL
             AND generation_id IN (
               SELECT generation_id FROM pattern_generation_jobs
               WHERE claim_id = ? AND user_id = ?
             )
           )
         )`,
    ).bind(
      event.occurred_at,
      event.target_user_id,
      event.generation_id,
      event.generation_id,
      event.generation_id,
      event.claim_id,
      event.target_user_id,
    ),
  ];
}

function claimReplayConvergenceStatement(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'Pattern claim replay did not converge'
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM pattern_generation_claims
         WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
           AND status IN ('accepted', 'deleted', 'superseded', 'withdrawn')
           AND consumed_at IS NOT NULL
           AND active_generation_id IS NULL
       )`,
  ).bind(
    event.target_user_id,
    event.claim_id,
    event.target_user_id,
    event.chart_fingerprint_hash,
  );
}

function erasureReplayConvergenceStatement(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'Pattern erasure replay did not converge'
     WHERE EXISTS (
       SELECT 1 FROM pattern_documents
       WHERE user_id = ? AND claim_id = ?
         AND (? IS NULL OR generation_id = ?)
         AND (? IS NULL OR id = ?)
     ) OR EXISTS (
       SELECT 1 FROM pattern_generation_artifact_keys
       WHERE user_id = ? AND erased_at IS NULL
         AND (
           (? IS NOT NULL AND generation_id = ?)
           OR (
             ? IS NULL
             AND generation_id IN (
               SELECT generation_id FROM pattern_generation_jobs
               WHERE claim_id = ? AND user_id = ?
             )
           )
         )
     )`,
  ).bind(
    event.target_user_id,
    event.claim_id,
    event.generation_id,
    event.generation_id,
    event.pattern_id,
    event.pattern_id,
    event.target_user_id,
    event.generation_id,
    event.generation_id,
    event.generation_id,
    event.claim_id,
    event.target_user_id,
  );
}

function ontologyRecallReplayStatements(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE pattern_ontology_releases
       SET status = 'recalled', recalled_at = COALESCE(recalled_at, ?)
       WHERE version = ? AND status IN ('candidate', 'active', 'superseded')`,
    ).bind(event.occurred_at, event.ontology_version),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer
       SET active_version = NULL, updated_at = ?
       WHERE id = 1 AND active_version = ?`,
    ).bind(event.occurred_at, event.ontology_version),
    env.DB.prepare(
      `INSERT OR IGNORE INTO pattern_ontology_recall_events (
         id, ontology_version, reason_class, created_at
       )
       SELECT ?, ?, 'replay_ledger', ?
       WHERE EXISTS (
         SELECT 1 FROM pattern_ontology_releases WHERE version = ?
       )`,
    ).bind(
      event.event_id,
      event.ontology_version,
      event.occurred_at,
      event.ontology_version,
    ),
  ];
}

function ontologyRecallConvergenceStatement(
  env: Pick<Env, "DB">,
  event: PatternErasureReplayEvent,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'Pattern ontology recall replay did not converge'
     WHERE EXISTS (
       SELECT 1 FROM pattern_ontology_pointer
       WHERE id = 1 AND active_version = ?
     ) OR EXISTS (
       SELECT 1 FROM pattern_ontology_releases
       WHERE version = ? AND status != 'recalled'
     )`,
  ).bind(event.ontology_version, event.ontology_version);
}

async function applyAccountDeletionReplay(
  env: Env,
  event: PatternErasureReplayEvent,
  receipt: PreparedPatternReplayEvent,
): Promise<void> {
  if (
    !env.ARTIFACTS ||
    !event.target_user_id ||
    event.chart_fingerprint_hash !== null ||
    event.claim_id !== null ||
    event.generation_id !== null ||
    event.pattern_id !== null ||
    event.ontology_version !== null ||
    event.prior_claim_status !== null ||
    event.next_claim_status !== "deleted"
  ) {
    fail("replay_event_apply_invalid");
  }
  const userId = event.target_user_id;
  const existingProof = await env.DB.prepare(
    `SELECT id, idempotency_key, created_at
     FROM deletion_requests WHERE user_id = ?
     ORDER BY created_at, id LIMIT 1`,
  ).bind(userId).first<{
    id: string;
    idempotency_key: string;
    created_at: string;
  }>();
  const proofId = existingProof?.id ?? event.event_id;
  const proofKey = existingProof?.idempotency_key ?? event.event_id;
  const proofCreatedAt = existingProof?.created_at ?? event.occurred_at;

  let objectKeys: string[];
  try {
    objectKeys = await collectDeletionArtifactKeys(env, userId);
    for (let offset = 0; offset < objectKeys.length; offset += 1000) {
      await env.ARTIFACTS.delete(objectKeys.slice(offset, offset + 1000));
    }
  } catch {
    fail("replay_event_apply_unavailable");
  }

  // This manifest is intentionally idempotent and dependency ordered. A
  // restore route runs before traffic, so a crash between statements is
  // repaired by applying the same signed event again.
  await deleteUserRows(env, userId, event.event_id);

  const deletedSubject = `cs_deleted_${event.event_id.slice(5, 29)}`;
  const auditId = `aud_${event.event_id.slice(5)}`;
  const convergence = DELETED_USER_TABLES.map((table) =>
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'account deletion replay retained a user row'
       WHERE EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?)`,
    ).bind(userId)
  );
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM deletion_requests WHERE user_id = ? AND id != ?`,
    ).bind(userId, proofId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO deletion_requests (
         id, user_id, status, dek_destroyed, idempotency_key, created_at,
         completed_at, job_id, receipt_hash, receipt_expires_at, checkpoint,
         status_updated_at, error_class, artifact_manifest_json,
         artifact_cleanup_until
       ) VALUES (?, ?, 'completed', 1, ?, ?, ?, NULL, NULL, NULL,
                 'completed', ?, NULL, '[]', NULL)`,
    ).bind(
      proofId,
      userId,
      proofKey,
      proofCreatedAt,
      event.occurred_at,
      event.occurred_at,
    ),
    env.DB.prepare(
      `UPDATE deletion_requests
       SET status = 'completed', dek_destroyed = 1, completed_at = ?,
           job_id = NULL, receipt_hash = NULL, receipt_expires_at = NULL,
           checkpoint = 'completed', status_updated_at = ?, error_class = NULL,
           artifact_manifest_json = '[]', artifact_cleanup_until = NULL
       WHERE id = ? AND user_id = ?`,
    ).bind(event.occurred_at, event.occurred_at, proofId, userId),
    env.DB.prepare(
      `UPDATE user_keys
       SET wrapped_dek = NULL,
           destroyed_at = COALESCE(destroyed_at, ?),
           erased_at = COALESCE(erased_at, ?)
       WHERE user_id = ?`,
    ).bind(event.occurred_at, event.occurred_at, userId),
    env.DB.prepare(
      `UPDATE users
       SET crypto_subject = ?, status = 'deleted', locale = 'und',
           timezone = 'UTC', entitlement_tier = 'none', next_due_at = NULL,
           timezone_source = 'default_unconfirmed', timezone_revision = 0,
           timezone_updated_at = NULL, locale_source = 'default_unconfirmed',
           locale_updated_at = NULL, updated_at = ?,
           deleted_at = COALESCE(deleted_at, ?)
       WHERE id = ?`,
    ).bind(
      deletedSubject,
      event.occurred_at,
      event.occurred_at,
      userId,
    ),
    ...receipt.receiptStatements(env),
    env.DB.prepare(
      `INSERT OR IGNORE INTO audit_events (
         id, actor_type, actor_id, action, resource_type, resource_id,
         result, detail_class, created_at
       ) VALUES (?, 'system', ?, 'account_deleted', 'deletion_request', ?,
                 'success', 'replay_ledger', ?)`,
    ).bind(auditId, userId, proofId, event.occurred_at),
    ...convergence,
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'account deletion replay did not converge'
       WHERE EXISTS (SELECT 1 FROM jobs WHERE user_id = ?)
          OR NOT EXISTS (
            SELECT 1 FROM users
            WHERE id = ? AND status = 'deleted' AND deleted_at IS NOT NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM user_keys
            WHERE user_id = ? AND wrapped_dek IS NULL
              AND destroyed_at IS NOT NULL AND erased_at IS NOT NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM deletion_requests
            WHERE id = ? AND user_id = ? AND status = 'completed'
              AND checkpoint = 'completed' AND dek_destroyed = 1
          )`,
    ).bind(userId, userId, userId, proofId, userId),
  ]);
}

/** Apply one already-signed event without ever assigning an available claim. */
export async function applyPatternReplayEvent(
  env: Env,
  event: PatternErasureReplayEvent,
  appliedAt = new Date(),
): Promise<"applied" | "replay"> {
  if (!Number.isFinite(appliedAt.getTime())) fail("replay_event_apply_invalid");
  const verified = await verifyPatternReplayEvent(
    event,
    env.PATTERN_REPLAY_LEDGER_KEYS,
  );
  const erasure = verified.event_class === "pattern_deleted" ||
    verified.event_class === "chart_correction_erased" ||
    verified.event_class === "pattern_withdrawn";
  const ontologyRecall = verified.event_class === "ontology_recalled";
  const accountDeletion = verified.event_class === "account_deleted";
  if (
    verified.event_class !== "claim_consumed" &&
    !erasure &&
    !ontologyRecall &&
    !accountDeletion
  ) {
    fail("replay_event_apply_unsupported");
  }
  const priorReplicaPutAt = await existingReplicaPutAt(env, verified.event_id);
  const receipt = new PreparedPatternReplayEvent(
    verified,
    patternReplayObjectKey(verified.event_id),
    jcsCanonicalize(verified),
    priorReplicaPutAt ?? appliedAt.toISOString(),
  );
  if (accountDeletion) {
    await applyAccountDeletionReplay(env, verified, receipt);
    return priorReplicaPutAt === null ? "applied" : "replay";
  }
  if (ontologyRecall) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'Pattern ontology recall replay precondition failed'
         WHERE ? != 'ontology_recalled' OR ? IS NULL OR ? IS NOT NULL`,
      ).bind(
        verified.event_class,
        verified.ontology_version,
        verified.next_claim_status,
      ),
      ...ontologyRecallReplayStatements(env, verified),
      ...receipt.receiptStatements(env),
      ontologyRecallConvergenceStatement(env, verified),
    ]);
    return priorReplicaPutAt === null ? "applied" : "replay";
  }
  const finalAssertions = [claimReplayConvergenceStatement(env, verified)];
  if (erasure) {
    finalAssertions.push(erasureReplayConvergenceStatement(env, verified));
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'Pattern replay precondition failed'
       WHERE ? NOT IN (
         'claim_consumed', 'pattern_deleted',
         'chart_correction_erased', 'pattern_withdrawn'
       )
          OR ? IS NULL OR ? IS NULL OR ? IS NULL OR ? IS NULL`,
    ).bind(
      verified.event_class,
      verified.target_user_id,
      verified.chart_fingerprint_hash,
      verified.claim_id,
      verified.next_claim_status,
    ),
    ...(erasure ? erasureReplayStatements(env, verified) : []),
    ...claimReplayStatements(env, verified),
    ...receipt.receiptStatements(env),
    ...finalAssertions,
  ]);
  return priorReplicaPutAt === null ? "applied" : "replay";
}

/** Verify the whole external replica before applying any ordered event. */
export async function applyPatternReplayReplica(
  env: Env,
  now = new Date(),
): Promise<{ listed: number; applied: number; replayed: number }> {
  if (!env.PATTERN_REPLAY_LEDGER || !Number.isFinite(now.getTime())) {
    fail("replay_replica_unavailable");
  }
  const prepared: PreparedPatternReplayEvent[] = [];
  const eventIds = new Set<string>();
  let cursor: string | undefined;
  do {
    let page: R2Objects;
    try {
      page = await env.PATTERN_REPLAY_LEDGER.list({
        prefix: REPLAY_OBJECT_PREFIX,
        cursor,
      });
    } catch {
      fail("replay_replica_unavailable");
    }
    for (const object of page.objects) {
      const stored = await readReplicaEvent(
        env.PATTERN_REPLAY_LEDGER,
        object.key,
        env.PATTERN_REPLAY_LEDGER_KEYS,
      );
      if (
        !stored ||
        stored.objectKey !== patternReplayObjectKey(stored.event.event_id) ||
        eventIds.has(stored.event.event_id)
      ) {
        fail("replay_replica_integrity");
      }
      eventIds.add(stored.event.event_id);
      prepared.push(stored);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  prepared.sort((left, right) => {
    const leftAccount = left.event.event_class === "account_deleted" ? 1 : 0;
    const rightAccount = right.event.event_class === "account_deleted" ? 1 : 0;
    if (leftAccount !== rightAccount) return leftAccount - rightAccount;
    return left.event.occurred_at.localeCompare(right.event.occurred_at) ||
      left.event.event_id.localeCompare(right.event.event_id);
  });

  let applied = 0;
  let replayed = 0;
  for (const item of prepared) {
    const outcome = await applyPatternReplayEvent(
      env,
      item.event,
      new Date(item.replicaPutAt),
    );
    if (outcome === "applied") applied += 1;
    else replayed += 1;
  }
  return { listed: prepared.length, applied, replayed };
}
