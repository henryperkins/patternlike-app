import { canonicalJson, contentHash, newId } from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import { hasZone, pinnedLocalDate } from "../services/tzdb.js";
import { resolveCheckInRetentionMonths } from "../services/check-in-retention.js";
import {
  USR06_ALLOWED_USES,
  USR06_PERMISSION_TIER,
  USR06_SOURCE_ID,
} from "./context-sources.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";

const CHECK_IN_JOB_TYPE = "store_daily_check_in";
const M0_SCHEMA_VERSION = "0.2.0" as const;

export type CheckInLevel = "low" | "medium" | "high";

export interface NormalizedCheckInRequest {
  energy: CheckInLevel;
  pressure: CheckInLevel | null;
  clarity: CheckInLevel | null;
  connection: CheckInLevel | null;
  focus_domain: string | null;
  note: string | null;
  expires_in_seconds: number;
}

export interface CheckInProjection {
  schema_version: "0.2.0";
  id: string;
  user_id: string;
  source_id: "USR-06";
  source_window: string;
  evidence_lane: "user_and_context";
  allowed_uses: string[];
  confidence: "user_confirmed";
  sensitivity: "sensitive";
  permission_state: "active";
  conflict_status: "none";
  freshness: {
    status: "fresh";
    observed_at: string;
    ingested_at: string;
    expires_at: string;
    max_age_seconds: number;
    age_seconds: 0;
  };
  consent: {
    consent_id: string;
    status: "active";
    valid_for_uses: string[];
    permission_tier: 1;
    validated_at: string;
  };
  value: {
    encoding: "structured";
    structured: Omit<NormalizedCheckInRequest, "expires_in_seconds">;
  };
  labels: ["user_reported", "optional_context"];
  provenance: {
    ingestion_owner: "first-party-context-service";
    primary_runtime: "cloudflare-api-worker";
    connector_account_id: null;
    provider: null;
    acquisition: "explicit_daily_check_in";
  };
  supersedes_signal_id: string | null;
  normalized_hash: string;
  created_at: string;
  updated_at: string;
}

interface StoredCheckInMutation {
  request: NormalizedCheckInRequest;
  source_window: string;
  observed_at: string;
  response: CheckInProjection;
}

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : Uint8Array.from(value);
}

async function loadStoredCheckIn(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<StoredCheckInMutation | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM jobs WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  )
    .bind(CHECK_IN_JOB_TYPE, identity.userId, idempotencyKey)
    .first<{
      id: string;
      payload_enc: ArrayBuffer | readonly number[];
      payload_key_version: number;
      payload_nonce: string;
    }>();
  if (!row) return null;
  return decryptPayload<StoredCheckInMutation>(
    env,
    identity,
    {
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
      ciphertext: b64(bytes(row.payload_enc)),
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
}

function randomSalt(): string {
  const value = new Uint8Array(16);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function retentionMonths(env: Env): number {
  const resolution = resolveCheckInRetentionMonths(
    env.CHECK_IN_RETENTION_MONTHS,
  );
  if (!resolution.ok) {
    throw new Error("CHECK_IN_RETENTION_MONTHS must be an integer from 1 through 13");
  }
  return resolution.months;
}

function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetStart = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(targetStart.getUTCFullYear(), targetStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetStart.getUTCFullYear(),
      targetStart.getUTCMonth(),
      Math.min(day, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function usesEqual(value: string[]): boolean {
  return (
    value.length === USR06_ALLOWED_USES.length &&
    value.every((use, index) => use === USR06_ALLOWED_USES[index])
  );
}

interface Eligibility {
  timezone: string;
  timezoneSource: string;
  permissionUpdatedAt: string;
  consentId: string;
}

async function loadEligibility(env: Env, userId: string): Promise<Eligibility | null> {
  const row = await env.DB.prepare(
    `SELECT u.timezone, u.timezone_source, p.updated_at AS permission_updated_at,
            p.enabled, p.permission_state, p.allowed_uses_json,
            p.permission_tier, p.consent_id, c.status AS consent_status,
            c.source_id AS consent_source_id,
            c.allowed_uses_json AS consent_allowed_uses_json,
            c.permission_tier AS consent_permission_tier
     FROM users u
     LEFT JOIN context_source_permissions p
       ON p.user_id = u.id AND p.source_id = ?
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = u.id
     WHERE u.id = ? AND u.status = 'active'`,
  )
    .bind(USR06_SOURCE_ID, userId)
    .first<{
      timezone: string;
      timezone_source: string;
      permission_updated_at: string | null;
      enabled: number | null;
      permission_state: string | null;
      allowed_uses_json: string | null;
      permission_tier: number | null;
      consent_id: string | null;
      consent_status: string | null;
      consent_source_id: string | null;
      consent_allowed_uses_json: string | null;
      consent_permission_tier: number | null;
    }>();
  if (!row) return null;
  if (
    row.enabled !== 1 ||
    row.permission_state !== "active" ||
    row.permission_tier !== USR06_PERMISSION_TIER ||
    !row.consent_id ||
    row.consent_status !== "granted" ||
    row.consent_source_id !== USR06_SOURCE_ID ||
    row.consent_permission_tier !== USR06_PERMISSION_TIER
  ) {
    return null;
  }
  let permissionUses: string[];
  let consentUses: string[];
  try {
    permissionUses = JSON.parse(row.allowed_uses_json ?? "[]") as string[];
    consentUses = JSON.parse(row.consent_allowed_uses_json ?? "[]") as string[];
  } catch {
    throw new Error("USR-06 permission uses are invalid");
  }
  if (!usesEqual(permissionUses) || !usesEqual(consentUses)) {
    throw new Error("USR-06 permission uses are inconsistent");
  }
  return {
    timezone: row.timezone,
    timezoneSource: row.timezone_source,
    permissionUpdatedAt: row.permission_updated_at!,
    consentId: row.consent_id,
  };
}

export type StoreCheckInOutcome =
  | { ok: true; response: CheckInProjection; changed: boolean }
  | {
      ok: false;
      reason:
        | "idempotency_conflict"
        | "context_source_inactive"
        | "timezone_confirmation_required"
        | "consent_conflict";
    };

export async function storeCheckIn(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  request: NormalizedCheckInRequest,
  now = new Date(),
): Promise<StoreCheckInOutcome> {
  const replay = await loadStoredCheckIn(env, identity, idempotencyKey);
  if (replay) {
    return canonicalJson(replay.request) === canonicalJson(request)
      ? { ok: true, response: replay.response, changed: false }
      : { ok: false, reason: "idempotency_conflict" };
  }

  const eligible = await loadEligibility(env, identity.userId);
  if (!eligible) return { ok: false, reason: "context_source_inactive" };
  if (
    eligible.timezoneSource === "default_unconfirmed" ||
    !hasZone(eligible.timezone)
  ) {
    return { ok: false, reason: "timezone_confirmation_required" };
  }

  const observedAt = now.toISOString();
  const ingestedAt = observedAt;
  const sourceWindow = pinnedLocalDate(eligible.timezone, now.getTime());
  const expiresAt = new Date(
    now.getTime() + request.expires_in_seconds * 1000,
  ).toISOString();
  const retentionExpiresAt = addCalendarMonths(
    now,
    retentionMonths(env),
  ).toISOString();
  const predecessor = await env.DB.prepare(
    `SELECT id, source_revision FROM context_signals
     WHERE user_id = ? AND source_id = ? AND source_window = ? AND is_current = 1`,
  )
    .bind(identity.userId, USR06_SOURCE_ID, sourceWindow)
    .first<{ id: string; source_revision: number }>();
  const revision = (predecessor?.source_revision ?? 0) + 1;
  const signalId = newId("sig");
  const value = {
    energy: request.energy,
    pressure: request.pressure,
    clarity: request.clarity,
    connection: request.connection,
    focus_domain: request.focus_domain,
    note: request.note,
  };
  const hashSalt = randomSalt();
  const normalizedHash = await contentHash(
    canonicalJson({
      hash_salt: hashSalt,
      schema_version: M0_SCHEMA_VERSION,
      source_id: USR06_SOURCE_ID,
      source_window: sourceWindow,
      source_revision: revision,
      observed_at: observedAt,
      expires_at: expiresAt,
      ...value,
    }),
  );
  const sealedValue = await encryptPayload(
    env,
    identity,
    { hash_salt: hashSalt, value },
    {
      subject: identity.cryptoSubject,
      field: "context_signals.value_enc",
      recordId: signalId,
    },
  );
  const response: CheckInProjection = {
    schema_version: M0_SCHEMA_VERSION,
    id: signalId,
    user_id: identity.userId,
    source_id: USR06_SOURCE_ID,
    source_window: sourceWindow,
    evidence_lane: "user_and_context",
    allowed_uses: [...USR06_ALLOWED_USES],
    confidence: "user_confirmed",
    sensitivity: "sensitive",
    permission_state: "active",
    conflict_status: "none",
    freshness: {
      status: "fresh",
      observed_at: observedAt,
      ingested_at: ingestedAt,
      expires_at: expiresAt,
      max_age_seconds: request.expires_in_seconds,
      age_seconds: 0,
    },
    consent: {
      consent_id: eligible.consentId,
      status: "active",
      valid_for_uses: [...USR06_ALLOWED_USES],
      permission_tier: USR06_PERMISSION_TIER,
      validated_at: ingestedAt,
    },
    value: { encoding: "structured", structured: value },
    labels: ["user_reported", "optional_context"],
    provenance: {
      ingestion_owner: "first-party-context-service",
      primary_runtime: "cloudflare-api-worker",
      connector_account_id: null,
      provider: null,
      acquisition: "explicit_daily_check_in",
    },
    supersedes_signal_id: predecessor?.id ?? null,
    normalized_hash: normalizedHash,
    created_at: ingestedAt,
    updated_at: ingestedAt,
  };
  const jobId = newId("job");
  const sealedJob = await encryptPayload(
    env,
    identity,
    {
      request,
      source_window: sourceWindow,
      observed_at: observedAt,
      response,
    } satisfies StoredCheckInMutation,
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );
  const usesJson = JSON.stringify(USR06_ALLOWED_USES);
  const predecessorAssertion = predecessor
    ? env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'check-in predecessor changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_signals
           WHERE id = ? AND user_id = ? AND source_id = ?
             AND source_window = ? AND source_revision = ? AND is_current = 1
         )`,
      ).bind(
        predecessor.id,
        identity.userId,
        USR06_SOURCE_ID,
        sourceWindow,
        predecessor.source_revision,
      )
    : env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'check-in appeared concurrently'
         WHERE EXISTS (
           SELECT 1 FROM context_signals
           WHERE user_id = ? AND source_id = ? AND source_window = ?
             AND is_current = 1
         )`,
      ).bind(identity.userId, USR06_SOURCE_ID, sourceWindow);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'check-in permission changed concurrently'
       WHERE NOT EXISTS (
         SELECT 1 FROM users u
         JOIN context_source_permissions p ON p.user_id = u.id
         JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
         WHERE u.id = ? AND u.status = 'active' AND u.timezone = ?
           AND u.timezone_source != 'default_unconfirmed'
           AND p.source_id = ? AND p.enabled = 1
           AND p.permission_state = 'active' AND p.updated_at = ?
           AND p.consent_id = ? AND c.status = 'granted'
       )`,
    ).bind(
      identity.userId,
      eligible.timezone,
      USR06_SOURCE_ID,
      eligible.permissionUpdatedAt,
      eligible.consentId,
    ),
    predecessorAssertion,
  ];
  if (predecessor) {
    statements.push(
      env.DB.prepare(
        `UPDATE context_signals
         SET conflict_status = 'superseded', is_current = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND is_current = 1`,
      ).bind(ingestedAt, predecessor.id, identity.userId),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, source_window, evidence_lane,
          allowed_uses_json, confidence, sensitivity, permission_state,
          conflict_status, consent_id, freshness_status, observed_at,
          ingested_at, expires_at, value_encoding, value_json, value_enc,
          value_key_version, value_nonce, labels_json, provenance_json,
          supersedes_signal_id, normalized_hash, created_at, updated_at,
          source_revision, is_current, retention_expires_at)
       VALUES (?, ?, ?, ?, 'user_and_context', ?, 'user_confirmed',
               'sensitive', 'active', 'none', ?, 'fresh', ?, ?, ?,
               'encrypted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      signalId,
      identity.userId,
      USR06_SOURCE_ID,
      sourceWindow,
      usesJson,
      eligible.consentId,
      observedAt,
      ingestedAt,
      expiresAt,
      Uint8Array.from(atob(sealedValue.ciphertext), (char) => char.charCodeAt(0)),
      sealedValue.keyVersion,
      sealedValue.nonce,
      JSON.stringify(response.labels),
      JSON.stringify(response.provenance),
      predecessor?.id ?? null,
      normalizedHash,
      ingestedAt,
      ingestedAt,
      revision,
      retentionExpiresAt,
    ),
    env.DB.prepare(
      `UPDATE context_source_permissions SET last_signal_id = ?, updated_at = ?
       WHERE user_id = ? AND source_id = ? AND enabled = 1
         AND permission_state = 'active' AND consent_id = ?`,
    ).bind(
      signalId,
      ingestedAt,
      identity.userId,
      USR06_SOURCE_ID,
      eligible.consentId,
    ),
    env.DB.prepare(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, payload_enc,
          payload_key_version, payload_nonce, result_class, attempts,
          finished_at, created_at)
       VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'check_in_stored', 1, ?, ?)`,
    ).bind(
      jobId,
      CHECK_IN_JOB_TYPE,
      identity.userId,
      idempotencyKey,
      Uint8Array.from(atob(sealedJob.ciphertext), (char) => char.charCodeAt(0)),
      sealedJob.keyVersion,
      sealedJob.nonce,
      ingestedAt,
      ingestedAt,
    ),
  );

  try {
    await env.DB.batch(statements);
    return { ok: true, response, changed: true };
  } catch {
    const raced = await loadStoredCheckIn(env, identity, idempotencyKey);
    if (raced) {
      return canonicalJson(raced.request) === canonicalJson(request)
        ? { ok: true, response: raced.response, changed: false }
        : { ok: false, reason: "idempotency_conflict" };
    }
    return { ok: false, reason: "consent_conflict" };
  }
}
