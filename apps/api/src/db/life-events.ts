import {
  canonicalJson,
  newId,
  sha256Hex,
  type LifeEvent,
  type LifeEventRequest,
  type TimeTravelResponse,
} from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import { hasZone, pinnedLocalDate } from "../services/tzdb.js";
import {
  USR09_ALLOWED_USES,
  USR09_PERMISSION_TIER,
  USR09_SOURCE_ID,
  type ContextSourceState,
} from "./context-sources.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";

const CREATE_JOB_TYPE = "life_event_create";
const UPDATE_JOB_TYPE = "life_event_update";
const DELETE_JOB_TYPE = "life_event_delete";
const ACCOUNT_EVENT_CAP = 500;

export interface NormalizedLifeEventWindow {
  start: string;
  end: string;
}

interface StoredLifeEventValue {
  hash_salt: string;
  event: LifeEvent;
  normalized_start_date: string;
  normalized_end_date: string;
}

interface StoredMutation {
  request: LifeEventRequest;
  response: LifeEvent;
}

interface SignalRow {
  id: string;
  source_window: string;
  source_revision: number;
  is_current: number;
  evidence_lane: string;
  allowed_uses_json: string;
  confidence: string;
  sensitivity: string;
  permission_state: string;
  conflict_status: string;
  consent_id: string | null;
  freshness_status: string;
  observed_at: string;
  expires_at: string | null;
  retention_expires_at: string | null;
  value_encoding: string;
  value_enc: ArrayBuffer | readonly number[] | null;
  value_key_version: number | null;
  value_nonce: string | null;
  normalized_hash: string;
}

interface SourceAccess {
  state: TimeTravelResponse["life_event_source_state"];
  active: boolean;
  timezone: string;
  timezoneSource: string;
  permissionUpdatedAt: string | null;
  consentId: string | null;
}

type StoredJob =
  | { kind: "missing" }
  | { kind: "deleted" }
  | { kind: "stored"; eventId: string | null; mutation: StoredMutation };

export type LifeEventMutationOutcome =
  | { ok: true; response: LifeEvent; changed: boolean }
  | {
      ok: false;
      reason:
        | "idempotency_conflict"
        | "context_source_inactive"
        | "timezone_confirmation_required"
        | "invalid_life_event"
        | "event_limit_reached"
        | "event_not_found"
        | "event_deleted"
        | "consent_conflict";
    };

export type DeleteLifeEventOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "event_not_found" | "consent_conflict" };

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
}

function cipherBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function randomSalt(): string {
  const value = new Uint8Array(16);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function lastDayOfMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function normalizeLifeEventWindow(request: LifeEventRequest): NormalizedLifeEventWindow | null {
  if (!isRealIsoDate(request.start_date)) return null;
  if (request.end_date !== null && !isRealIsoDate(request.end_date)) return null;
  if (request.precision === "day") {
    if (request.end_date !== null && request.end_date !== request.start_date) return null;
    return { start: request.start_date, end: request.start_date };
  }
  if (request.precision === "month") {
    if (request.end_date !== null) return null;
    return {
      start: `${request.start_date.slice(0, 7)}-01`,
      end: lastDayOfMonth(request.start_date),
    };
  }
  if (request.precision === "year") {
    if (request.end_date !== null) return null;
    const year = request.start_date.slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (request.precision === "range") {
    if (request.end_date === null || request.end_date < request.start_date) return null;
    return { start: request.start_date, end: request.end_date };
  }
  return null;
}

function parseUses(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function exactUses(value: string | null): boolean {
  const uses = parseUses(value);
  return uses.length === USR09_ALLOWED_USES.length &&
    uses.every((use, index) => use === USR09_ALLOWED_USES[index]);
}

function projectState(value: string | null): TimeTravelResponse["life_event_source_state"] {
  if (value === "active" || value === "paused" || value === "revoked") return value;
  return value === null || value === "never_granted" ? "never_granted" : "revoked";
}

async function loadSourceAccess(env: Env, userId: string): Promise<SourceAccess> {
  const row = await env.DB.prepare(
    `SELECT u.timezone, u.timezone_source,
            p.enabled, p.permission_state, p.allowed_uses_json,
            p.permission_tier, p.consent_id, p.updated_at AS permission_updated_at,
            c.status AS consent_status, c.source_id AS consent_source_id,
            c.permission_tier AS consent_permission_tier,
            c.allowed_uses_json AS consent_allowed_uses_json
     FROM users u
     LEFT JOIN context_source_permissions p
       ON p.user_id = u.id AND p.source_id = ?
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = u.id
     WHERE u.id = ? AND u.status = 'active'`,
  ).bind(USR09_SOURCE_ID, userId).first<{
    timezone: string;
    timezone_source: string;
    enabled: number | null;
    permission_state: string | null;
    allowed_uses_json: string | null;
    permission_tier: number | null;
    consent_id: string | null;
    permission_updated_at: string | null;
    consent_status: string | null;
    consent_source_id: string | null;
    consent_permission_tier: number | null;
    consent_allowed_uses_json: string | null;
  }>();
  if (!row) throw new Error("life-event owner not found");
  const active = row.enabled === 1 && row.permission_state === "active" &&
    row.permission_tier === USR09_PERMISSION_TIER && row.consent_id !== null &&
    row.consent_status === "granted" && row.consent_source_id === USR09_SOURCE_ID &&
    row.consent_permission_tier === USR09_PERMISSION_TIER &&
    exactUses(row.allowed_uses_json) && exactUses(row.consent_allowed_uses_json);
  return {
    state: projectState(row.permission_state),
    active,
    timezone: row.timezone,
    timezoneSource: row.timezone_source,
    permissionUpdatedAt: row.permission_updated_at,
    consentId: row.consent_id,
  };
}

function eventMetadata(eventId: string): string {
  return canonicalJson({ event_id: eventId });
}

function metadataEventId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const eventId = (value as Record<string, unknown>).event_id;
    return typeof eventId === "string" ? eventId : null;
  } catch {
    return null;
  }
}

async function loadStoredJob(
  env: Env,
  identity: UserIdentity,
  jobType: typeof CREATE_JOB_TYPE | typeof UPDATE_JOB_TYPE,
  idempotencyKey: string,
): Promise<StoredJob> {
  const row = await env.DB.prepare(
    `SELECT id, payload_json, payload_enc, payload_key_version, payload_nonce, result_class
     FROM jobs WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  ).bind(jobType, identity.userId, idempotencyKey).first<{
    id: string;
    payload_json: string | null;
    payload_enc: ArrayBuffer | readonly number[] | null;
    payload_key_version: number | null;
    payload_nonce: string | null;
    result_class: string | null;
  }>();
  if (!row) return { kind: "missing" };
  if (
    row.result_class === "event_deleted" || row.payload_enc === null ||
    row.payload_key_version === null || row.payload_nonce === null
  ) return { kind: "deleted" };
  const mutation = await decryptPayload<StoredMutation>(env, identity, {
    key_version: row.payload_key_version,
    nonce: row.payload_nonce,
    ciphertext: b64(bytes(row.payload_enc)),
  }, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: row.id,
  });
  return { kind: "stored", eventId: metadataEventId(row.payload_json), mutation };
}

function replayOutcome(
  stored: StoredJob,
  request: LifeEventRequest,
  eventId: string | null,
): LifeEventMutationOutcome | null {
  if (stored.kind === "missing") return null;
  if (stored.kind === "deleted") return { ok: false, reason: "event_deleted" };
  if (
    (eventId !== null && stored.eventId !== eventId) ||
    canonicalJson(stored.mutation.request) !== canonicalJson(request)
  ) return { ok: false, reason: "idempotency_conflict" };
  return { ok: true, response: stored.mutation.response, changed: false };
}

function normalizedHashPreimage(
  eventId: string,
  revision: number,
  stored: StoredLifeEventValue,
): string {
  return canonicalJson({
    source_id: USR09_SOURCE_ID,
    source_window: eventId,
    revision,
    normalized_value: {
      event: stored.event,
      normalized_start_date: stored.normalized_start_date,
      normalized_end_date: stored.normalized_end_date,
    },
    hash_salt: stored.hash_salt,
  });
}

async function sealLifeEvent(
  env: Env,
  identity: UserIdentity,
  signalId: string,
  event: LifeEvent,
  window: NormalizedLifeEventWindow,
): Promise<{ value: StoredLifeEventValue; hash: string; sealed: Awaited<ReturnType<typeof encryptPayload>> }> {
  const value: StoredLifeEventValue = {
    hash_salt: randomSalt(),
    event,
    normalized_start_date: window.start,
    normalized_end_date: window.end,
  };
  const hash = await sha256Hex(normalizedHashPreimage(event.id, event.revision, value));
  const sealed = await encryptPayload(env, identity, value, {
    subject: identity.cryptoSubject,
    field: "context_signals.value_enc",
    recordId: signalId,
  });
  return { value, hash, sealed };
}

function permissionAssertion(env: Env, identity: UserIdentity, access: SourceAccess): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'life-event permission changed concurrently'
     WHERE NOT EXISTS (
       SELECT 1 FROM users u
       JOIN context_source_permissions p ON p.user_id = u.id
       JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
       WHERE u.id = ? AND u.status = 'active' AND u.timezone = ?
         AND u.timezone_source = 'user_confirmed'
         AND p.source_id = ? AND p.enabled = 1 AND p.permission_state = 'active'
         AND p.permission_tier = 1 AND p.allowed_uses_json = ?
         AND p.consent_id = ? AND p.updated_at = ?
         AND c.status = 'granted' AND c.source_id = ?
         AND c.permission_tier = 1 AND c.allowed_uses_json = ?
     )`,
  ).bind(
    identity.userId,
    access.timezone,
    USR09_SOURCE_ID,
    JSON.stringify(USR09_ALLOWED_USES),
    access.consentId,
    access.permissionUpdatedAt,
    USR09_SOURCE_ID,
    JSON.stringify(USR09_ALLOWED_USES),
  );
}

function signalInsert(
  env: Env,
  identity: UserIdentity,
  values: {
    signalId: string;
    eventId: string;
    revision: number;
    consentId: string;
    observedAt: string;
    predecessorId: string | null;
    normalizedHash: string;
    ciphertext: Uint8Array;
    keyVersion: number;
    nonce: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO context_signals
       (id, user_id, source_id, source_window, evidence_lane,
        allowed_uses_json, confidence, sensitivity, permission_state,
        conflict_status, consent_id, freshness_status, observed_at,
        ingested_at, expires_at, value_encoding, value_json, value_enc,
        value_key_version, value_nonce, labels_json, provenance_json,
        supersedes_signal_id, normalized_hash, created_at, updated_at,
        source_revision, is_current, retention_expires_at)
     VALUES (?, ?, ?, ?, 'user_and_context', ?, 'user_confirmed',
             'highly_sensitive', 'active', 'none', ?, 'fresh', ?, ?, NULL,
             'encrypted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
  ).bind(
    values.signalId,
    identity.userId,
    USR09_SOURCE_ID,
    values.eventId,
    JSON.stringify(USR09_ALLOWED_USES),
    values.consentId,
    values.observedAt,
    values.observedAt,
    values.ciphertext,
    values.keyVersion,
    values.nonce,
    JSON.stringify(["user_reported", "private_life_event"]),
    JSON.stringify({
      ingestion_owner: "first-party-context-service",
      primary_runtime: "cloudflare-api-worker",
      acquisition: "explicit_life_event",
    }),
    values.predecessorId,
    values.normalizedHash,
    values.observedAt,
    values.observedAt,
    values.revision,
  );
}

function jobInsert(
  env: Env,
  identity: UserIdentity,
  values: {
    jobId: string;
    jobType: typeof CREATE_JOB_TYPE | typeof UPDATE_JOB_TYPE;
    idempotencyKey: string;
    eventId: string;
    ciphertext: Uint8Array;
    keyVersion: number;
    nonce: string;
    nowIso: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status, payload_json,
        payload_enc, payload_key_version, payload_nonce, result_class,
        attempts, finished_at, created_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, 'life_event_stored', 1, ?, ?)`,
  ).bind(
    values.jobId,
    values.jobType,
    identity.userId,
    values.idempotencyKey,
    eventMetadata(values.eventId),
    values.ciphertext,
    values.keyVersion,
    values.nonce,
    values.nowIso,
    values.nowIso,
  );
}

function sourceLinkUpdate(
  env: Env,
  identity: UserIdentity,
  signalId: string,
  access: SourceAccess,
  nowIso: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE context_source_permissions SET last_signal_id = ?, updated_at = ?
     WHERE user_id = ? AND source_id = ? AND enabled = 1
       AND permission_state = 'active' AND consent_id = ? AND updated_at = ?`,
  ).bind(
    signalId,
    nowIso,
    identity.userId,
    USR09_SOURCE_ID,
    access.consentId,
    access.permissionUpdatedAt,
  );
}

function requestWindow(
  request: LifeEventRequest,
  access: SourceAccess,
  now: Date,
): NormalizedLifeEventWindow | null {
  if (access.timezoneSource !== "user_confirmed" || !hasZone(access.timezone)) return null;
  const window = normalizeLifeEventWindow(request);
  if (!window || window.end > pinnedLocalDate(access.timezone, now.getTime())) return null;
  return window;
}

export async function createLifeEvent(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  request: LifeEventRequest,
  now = new Date(),
): Promise<LifeEventMutationOutcome> {
  const replay = replayOutcome(
    await loadStoredJob(env, identity, CREATE_JOB_TYPE, idempotencyKey),
    request,
    null,
  );
  if (replay) return replay;
  const access = await loadSourceAccess(env, identity.userId);
  if (!access.active) return { ok: false, reason: "context_source_inactive" };
  if (access.timezoneSource !== "user_confirmed" || !hasZone(access.timezone)) {
    return { ok: false, reason: "timezone_confirmation_required" };
  }
  const window = requestWindow(request, access, now);
  if (!window) return { ok: false, reason: "invalid_life_event" };
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM context_signals
     WHERE user_id = ? AND source_id = ? AND is_current = 1`,
  ).bind(identity.userId, USR09_SOURCE_ID).first<{ count: number }>();
  if ((count?.count ?? 0) >= ACCOUNT_EVENT_CAP) return { ok: false, reason: "event_limit_reached" };

  const nowIso = now.toISOString();
  const eventId = newId("evt");
  const signalId = newId("sig");
  const event: LifeEvent = {
    ...request,
    id: eventId,
    revision: 1,
    observed_at: nowIso,
    recorded_at: nowIso,
    updated_at: nowIso,
  };
  const sealedValue = await sealLifeEvent(env, identity, signalId, event, window);
  const jobId = newId("job");
  const sealedJob = await encryptPayload(env, identity, { request, response: event } satisfies StoredMutation, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  try {
    await env.DB.batch([
      permissionAssertion(env, identity, access),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'life-event account cap reached concurrently'
         WHERE (SELECT COUNT(*) FROM context_signals
                WHERE user_id = ? AND source_id = ? AND is_current = 1) >= ?`,
      ).bind(identity.userId, USR09_SOURCE_ID, ACCOUNT_EVENT_CAP),
      signalInsert(env, identity, {
        signalId,
        eventId,
        revision: 1,
        consentId: access.consentId!,
        observedAt: nowIso,
        predecessorId: null,
        normalizedHash: sealedValue.hash,
        ciphertext: cipherBytes(sealedValue.sealed.ciphertext),
        keyVersion: sealedValue.sealed.keyVersion,
        nonce: sealedValue.sealed.nonce,
      }),
      sourceLinkUpdate(env, identity, signalId, access, nowIso),
      jobInsert(env, identity, {
        jobId,
        jobType: CREATE_JOB_TYPE,
        idempotencyKey,
        eventId,
        ciphertext: cipherBytes(sealedJob.ciphertext),
        keyVersion: sealedJob.keyVersion,
        nonce: sealedJob.nonce,
        nowIso,
      }),
    ]);
    return { ok: true, response: event, changed: true };
  } catch {
    const raced = replayOutcome(
      await loadStoredJob(env, identity, CREATE_JOB_TYPE, idempotencyKey),
      request,
      null,
    );
    if (raced) return raced;
    const latestCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM context_signals
       WHERE user_id = ? AND source_id = ? AND is_current = 1`,
    ).bind(identity.userId, USR09_SOURCE_ID).first<{ count: number }>();
    return (latestCount?.count ?? 0) >= ACCOUNT_EVENT_CAP
      ? { ok: false, reason: "event_limit_reached" }
      : { ok: false, reason: "consent_conflict" };
  }
}

async function loadCurrentSignal(env: Env, userId: string, eventId: string): Promise<SignalRow | null> {
  return env.DB.prepare(
    `SELECT id, source_window, source_revision, is_current, evidence_lane,
            allowed_uses_json, confidence, sensitivity, permission_state,
            conflict_status, consent_id, freshness_status, observed_at,
            expires_at, retention_expires_at, value_encoding, value_enc,
            value_key_version, value_nonce, normalized_hash
     FROM context_signals
     WHERE user_id = ? AND source_id = ? AND source_window = ? AND is_current = 1`,
  ).bind(userId, USR09_SOURCE_ID, eventId).first<SignalRow>();
}

async function openLifeEvent(
  env: Env,
  identity: UserIdentity,
  row: SignalRow,
): Promise<StoredLifeEventValue> {
  if (
    row.value_encoding !== "encrypted" || row.value_enc === null ||
    row.value_key_version === null || row.value_nonce === null
  ) throw new Error("life-event ciphertext is incomplete");
  const value = await decryptPayload<StoredLifeEventValue>(env, identity, {
    key_version: row.value_key_version,
    nonce: row.value_nonce,
    ciphertext: b64(bytes(row.value_enc)),
  }, {
    subject: identity.cryptoSubject,
    field: "context_signals.value_enc",
    recordId: row.id,
  });
  if (
    !value || typeof value !== "object" || typeof value.hash_salt !== "string" ||
    !value.event || value.event.id !== row.source_window ||
    value.event.revision !== row.source_revision ||
    !isRealIsoDate(value.normalized_start_date) ||
    !isRealIsoDate(value.normalized_end_date) ||
    value.normalized_end_date < value.normalized_start_date
  ) throw new Error("life-event plaintext is invalid");
  const hash = await sha256Hex(normalizedHashPreimage(row.source_window, row.source_revision, value));
  if (hash !== row.normalized_hash) throw new Error("life-event digest mismatch");
  return value;
}

export async function updateLifeEvent(
  env: Env,
  identity: UserIdentity,
  eventId: string,
  idempotencyKey: string,
  request: LifeEventRequest,
  now = new Date(),
): Promise<LifeEventMutationOutcome> {
  const replay = replayOutcome(
    await loadStoredJob(env, identity, UPDATE_JOB_TYPE, idempotencyKey),
    request,
    eventId,
  );
  if (replay) return replay;
  const access = await loadSourceAccess(env, identity.userId);
  if (!access.active) return { ok: false, reason: "context_source_inactive" };
  if (access.timezoneSource !== "user_confirmed" || !hasZone(access.timezone)) {
    return { ok: false, reason: "timezone_confirmation_required" };
  }
  const window = requestWindow(request, access, now);
  if (!window) return { ok: false, reason: "invalid_life_event" };
  const predecessor = await loadCurrentSignal(env, identity.userId, eventId);
  if (!predecessor) return { ok: false, reason: "event_not_found" };
  const prior = await openLifeEvent(env, identity, predecessor);
  const nowIso = now.toISOString();
  const signalId = newId("sig");
  const event: LifeEvent = {
    ...request,
    id: eventId,
    revision: predecessor.source_revision + 1,
    observed_at: nowIso,
    recorded_at: prior.event.recorded_at,
    updated_at: nowIso,
  };
  const sealedValue = await sealLifeEvent(env, identity, signalId, event, window);
  const jobId = newId("job");
  const sealedJob = await encryptPayload(env, identity, { request, response: event } satisfies StoredMutation, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  try {
    await env.DB.batch([
      permissionAssertion(env, identity, access),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'life-event predecessor changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_signals
           WHERE id = ? AND user_id = ? AND source_id = ? AND source_window = ?
             AND source_revision = ? AND is_current = 1
         )`,
      ).bind(
        predecessor.id,
        identity.userId,
        USR09_SOURCE_ID,
        eventId,
        predecessor.source_revision,
      ),
      env.DB.prepare(
        `UPDATE context_signals
         SET conflict_status = 'superseded', is_current = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND is_current = 1`,
      ).bind(nowIso, predecessor.id, identity.userId),
      signalInsert(env, identity, {
        signalId,
        eventId,
        revision: event.revision,
        consentId: access.consentId!,
        observedAt: nowIso,
        predecessorId: predecessor.id,
        normalizedHash: sealedValue.hash,
        ciphertext: cipherBytes(sealedValue.sealed.ciphertext),
        keyVersion: sealedValue.sealed.keyVersion,
        nonce: sealedValue.sealed.nonce,
      }),
      sourceLinkUpdate(env, identity, signalId, access, nowIso),
      jobInsert(env, identity, {
        jobId,
        jobType: UPDATE_JOB_TYPE,
        idempotencyKey,
        eventId,
        ciphertext: cipherBytes(sealedJob.ciphertext),
        keyVersion: sealedJob.keyVersion,
        nonce: sealedJob.nonce,
        nowIso,
      }),
    ]);
    return { ok: true, response: event, changed: true };
  } catch {
    const raced = replayOutcome(
      await loadStoredJob(env, identity, UPDATE_JOB_TYPE, idempotencyKey),
      request,
      eventId,
    );
    return raced ?? { ok: false, reason: "consent_conflict" };
  }
}

export async function listLifeEvents(env: Env, identity: UserIdentity): Promise<LifeEvent[]> {
  const result = await env.DB.prepare(
    `SELECT id, source_window, source_revision, is_current, evidence_lane,
            allowed_uses_json, confidence, sensitivity, permission_state,
            conflict_status, consent_id, freshness_status, observed_at,
            expires_at, retention_expires_at, value_encoding, value_enc,
            value_key_version, value_nonce, normalized_hash
     FROM context_signals
     WHERE user_id = ? AND source_id = ? AND is_current = 1
     LIMIT ?`,
  ).bind(identity.userId, USR09_SOURCE_ID, ACCOUNT_EVENT_CAP + 1).all<SignalRow>();
  if (result.results.length > ACCOUNT_EVENT_CAP) throw new Error("life-event account cap invariant failed");
  const opened = await Promise.all(result.results.map(async (row) => ({
    value: await openLifeEvent(env, identity, row),
    eventId: row.source_window,
  })));
  opened.sort((left, right) =>
    right.value.normalized_start_date.localeCompare(left.value.normalized_start_date) ||
    left.eventId.localeCompare(right.eventId));
  return opened.map((item) => item.value.event);
}

async function loadDeleteReplay(
  env: Env,
  userId: string,
  eventId: string,
  idempotencyKey: string,
): Promise<DeleteLifeEventOutcome | null> {
  const row = await env.DB.prepare(
    `SELECT payload_json FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ? AND status = 'succeeded'`,
  ).bind(DELETE_JOB_TYPE, userId, idempotencyKey).first<{ payload_json: string | null }>();
  if (!row) return null;
  return metadataEventId(row.payload_json) === eventId
    ? { ok: true, changed: false }
    : { ok: false, reason: "idempotency_conflict" };
}

export async function deleteLifeEvent(
  env: Env,
  identity: UserIdentity,
  eventId: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<DeleteLifeEventOutcome> {
  const replay = await loadDeleteReplay(env, identity.userId, eventId, idempotencyKey);
  if (replay) return replay;
  const current = await loadCurrentSignal(env, identity.userId, eventId);
  if (!current) return { ok: false, reason: "event_not_found" };
  const nowIso = now.toISOString();
  const metadata = eventMetadata(eventId);
  const jobId = newId("job");
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'life-event delete raced a revision'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_signals
           WHERE id = ? AND user_id = ? AND source_id = ? AND source_window = ?
             AND source_revision = ? AND is_current = 1
         )`,
      ).bind(
        current.id,
        identity.userId,
        USR09_SOURCE_ID,
        eventId,
        current.source_revision,
      ),
      env.DB.prepare(
        `UPDATE context_source_permissions
         SET last_signal_id = NULL, updated_at = ?
         WHERE user_id = ? AND source_id = ? AND last_signal_id IN (
           SELECT id FROM context_signals
           WHERE user_id = ? AND source_id = ? AND source_window = ?
         )`,
      ).bind(
        nowIso,
        identity.userId,
        USR09_SOURCE_ID,
        identity.userId,
        USR09_SOURCE_ID,
        eventId,
      ),
      env.DB.prepare(
        `UPDATE jobs
         SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL,
             result_class = 'event_deleted'
         WHERE user_id = ? AND job_type IN (?, ?) AND payload_json = ?`,
      ).bind(identity.userId, CREATE_JOB_TYPE, UPDATE_JOB_TYPE, metadata),
      env.DB.prepare(
        `DELETE FROM context_signals
         WHERE user_id = ? AND source_id = ? AND source_window = ?`,
      ).bind(identity.userId, USR09_SOURCE_ID, eventId),
      env.DB.prepare(
        `INSERT INTO jobs
           (id, job_type, user_id, idempotency_key, status, payload_json,
            result_class, attempts, finished_at, created_at)
         VALUES (?, ?, ?, ?, 'succeeded', ?, 'life_event_deleted', 1, ?, ?)`,
      ).bind(
        jobId,
        DELETE_JOB_TYPE,
        identity.userId,
        idempotencyKey,
        metadata,
        nowIso,
        nowIso,
      ),
    ]);
    return { ok: true, changed: true };
  } catch {
    return (await loadDeleteReplay(env, identity.userId, eventId, idempotencyKey)) ??
      { ok: false, reason: "consent_conflict" };
  }
}

function exactSignalMetadata(row: SignalRow, consentId: string): boolean {
  return row.is_current === 1 && row.evidence_lane === "user_and_context" &&
    exactUses(row.allowed_uses_json) && row.confidence === "user_confirmed" &&
    row.sensitivity === "highly_sensitive" && row.permission_state === "active" &&
    row.conflict_status === "none" && row.consent_id === consentId &&
    row.freshness_status === "fresh" && row.expires_at === null &&
    row.retention_expires_at === null;
}

export async function loadTimeTravelLifeEvents(
  env: Env,
  identity: UserIdentity,
  selectedDate: string,
): Promise<{
  savedContext: TimeTravelResponse["saved_context"];
  unreadableCount: number;
  sourceState: TimeTravelResponse["life_event_source_state"];
}> {
  const before = await loadSourceAccess(env, identity.userId);
  if (!before.active || !before.consentId) {
    return { savedContext: [], unreadableCount: 0, sourceState: before.state };
  }
  const result = await env.DB.prepare(
    `SELECT id, source_window, source_revision, is_current, evidence_lane,
            allowed_uses_json, confidence, sensitivity, permission_state,
            conflict_status, consent_id, freshness_status, observed_at,
            expires_at, retention_expires_at, value_encoding, value_enc,
            value_key_version, value_nonce, normalized_hash
     FROM context_signals
     WHERE user_id = ? AND source_id = ? AND is_current = 1 AND consent_id = ?
     LIMIT ?`,
  ).bind(identity.userId, USR09_SOURCE_ID, before.consentId, ACCOUNT_EVENT_CAP + 1).all<SignalRow>();
  if (result.results.length > ACCOUNT_EVENT_CAP) throw new Error("life-event account cap invariant failed");

  let unreadableCount = 0;
  const saved: Array<{
    event: LifeEvent;
    normalizedStart: string;
    recording_relation: "recorded_then" | "added_later";
  }> = [];
  for (const row of result.results) {
    if (!exactSignalMetadata(row, before.consentId)) continue;
    let value: StoredLifeEventValue;
    try {
      value = await openLifeEvent(env, identity, row);
    } catch {
      unreadableCount++;
      continue;
    }
    if (
      !value.event.use_in_time_travel ||
      selectedDate < value.normalized_start_date || selectedDate > value.normalized_end_date
    ) continue;
    const observedDate = value.event.observed_at.slice(0, 10);
    saved.push({
      event: value.event,
      normalizedStart: value.normalized_start_date,
      recording_relation:
        observedDate >= value.normalized_start_date && observedDate <= value.normalized_end_date
          ? "recorded_then"
          : "added_later",
    });
  }

  const after = await loadSourceAccess(env, identity.userId);
  if (
    !after.active || after.consentId !== before.consentId ||
    after.permissionUpdatedAt !== before.permissionUpdatedAt
  ) return { savedContext: [], unreadableCount: 0, sourceState: after.state };
  saved.sort((left, right) =>
    right.normalizedStart.localeCompare(left.normalizedStart) ||
    left.event.id.localeCompare(right.event.id));
  return {
    savedContext: saved.map(({ event, recording_relation }) => ({ event, recording_relation })),
    unreadableCount,
    sourceState: after.state,
  };
}

export type { ContextSourceState };
