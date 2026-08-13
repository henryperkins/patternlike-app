import { canonicalJson, newId } from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";

export const USR06_SOURCE_ID = "USR-06" as const;
export const USR06_POLICY_VERSION = "usr-06-v1";
export const USR06_PERMISSION_TIER = 1 as const;
export const USR06_ALLOWED_USES = [
  "theme_ranking",
  "tone",
  "reflection_prompt",
  "notification_timing",
] as const;
const MUTATION_JOB_TYPE = "context_source_usr06_mutation";

export type Usr06State =
  | "active"
  | "paused"
  | "revoked"
  | "expired"
  | "never_granted";

export interface Usr06SourceProjection {
  schema_version: "0.2.0";
  user_id: string;
  source_id: typeof USR06_SOURCE_ID;
  enabled: boolean;
  permission_state: Usr06State;
  allowed_uses: string[];
  permission_tier: 1;
  consent_id: string | null;
  freshness: null;
  last_signal_id: string | null;
  scopes: string[];
  connector_status: "not_applicable";
  updated_at: string;
}

export interface ContextSourcesDocument {
  schema_version: "0.2.0";
  user_id: string;
  sources: [Usr06SourceProjection];
  updated_at: string;
}

interface SourceRow {
  user_updated_at: string;
  source_id: string | null;
  enabled: number | null;
  permission_state: string | null;
  permission_allowed_uses_json: string | null;
  permission_tier: number | null;
  permission_consent_id: string | null;
  last_signal_id: string | null;
  permission_updated_at: string | null;
  consent_id: string | null;
  consent_kind: string | null;
  consent_status: string | null;
  consent_source_id: string | null;
  consent_permission_tier: number | null;
  consent_allowed_uses_json: string | null;
}

function parseUses(raw: string | null): string[] {
  if (raw === null) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.some((use) => typeof use !== "string")) {
    throw new Error("USR-06 allowed uses are invalid");
  }
  return value as string[];
}

function usesEqual(value: readonly string[], expected: readonly string[]): boolean {
  return (
    value.length === expected.length &&
    value.every((use, index) => use === expected[index])
  );
}

function consentStatusFor(state: Exclude<Usr06State, "never_granted">): string {
  if (state === "active") return "granted";
  return state;
}

export async function loadContextSourcesDocument(
  env: Env,
  userId: string,
): Promise<ContextSourcesDocument> {
  const row = await env.DB.prepare(
    `SELECT u.updated_at AS user_updated_at,
            p.source_id, p.enabled, p.permission_state,
            p.allowed_uses_json AS permission_allowed_uses_json,
            p.permission_tier, p.consent_id AS permission_consent_id,
            p.last_signal_id, p.updated_at AS permission_updated_at,
            c.id AS consent_id, c.kind AS consent_kind,
            c.status AS consent_status, c.source_id AS consent_source_id,
            c.permission_tier AS consent_permission_tier,
            c.allowed_uses_json AS consent_allowed_uses_json
     FROM users u
     LEFT JOIN context_source_permissions p
       ON p.user_id = u.id AND p.source_id = ?
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = u.id
     WHERE u.id = ?`,
  )
    .bind(USR06_SOURCE_ID, userId)
    .first<SourceRow>();
  if (!row) throw new Error("context source owner not found");

  if (row.source_id === null) {
    const source: Usr06SourceProjection = {
      schema_version: "0.2.0",
      user_id: userId,
      source_id: USR06_SOURCE_ID,
      enabled: false,
      permission_state: "never_granted",
      allowed_uses: [],
      permission_tier: USR06_PERMISSION_TIER,
      consent_id: null,
      freshness: null,
      last_signal_id: null,
      scopes: [],
      connector_status: "not_applicable",
      updated_at: row.user_updated_at,
    };
    return {
      schema_version: "0.2.0",
      user_id: userId,
      sources: [source],
      updated_at: source.updated_at,
    };
  }

  const state = row.permission_state as Usr06State;
  if (
    !["active", "paused", "revoked", "expired"].includes(state) ||
    (row.enabled === 1) !== (state === "active") ||
    row.permission_tier !== USR06_PERMISSION_TIER ||
    row.permission_consent_id === null ||
    row.permission_consent_id !== row.consent_id ||
    row.consent_kind !== "product_source" ||
    row.consent_source_id !== USR06_SOURCE_ID ||
    row.consent_permission_tier !== USR06_PERMISSION_TIER ||
    row.consent_status !== consentStatusFor(state as Exclude<Usr06State, "never_granted">)
  ) {
    throw new Error("USR-06 permission and consent are inconsistent");
  }
  const permissionUses = parseUses(row.permission_allowed_uses_json);
  const consentUses = parseUses(row.consent_allowed_uses_json);
  if (
    !usesEqual(permissionUses, USR06_ALLOWED_USES) ||
    !usesEqual(consentUses, USR06_ALLOWED_USES)
  ) {
    throw new Error("USR-06 permission uses do not match the registry");
  }

  const source: Usr06SourceProjection = {
    schema_version: "0.2.0",
    user_id: userId,
    source_id: USR06_SOURCE_ID,
    enabled: state === "active",
    permission_state: state,
    allowed_uses: [...USR06_ALLOWED_USES],
    permission_tier: USR06_PERMISSION_TIER,
    consent_id: row.consent_id,
    freshness: null,
    last_signal_id: row.last_signal_id,
    scopes: [],
    connector_status: "not_applicable",
    updated_at: row.permission_updated_at ?? row.user_updated_at,
  };
  return {
    schema_version: "0.2.0",
    user_id: userId,
    sources: [source],
    updated_at: source.updated_at,
  };
}

interface StoredSourceMutation {
  request: ContextSourcesDocument;
  response: ContextSourcesDocument;
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<StoredSourceMutation | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM jobs WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  )
    .bind(MUTATION_JOB_TYPE, identity.userId, idempotencyKey)
    .first<{
      id: string;
      payload_enc: ArrayBuffer | readonly number[];
      payload_key_version: number;
      payload_nonce: string;
    }>();
  if (!row) return null;
  const bytes =
    row.payload_enc instanceof ArrayBuffer
      ? new Uint8Array(row.payload_enc)
      : Uint8Array.from(row.payload_enc);
  return decryptPayload<StoredSourceMutation>(
    env,
    identity,
    {
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
      ciphertext: b64(bytes),
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
}

function legalTransition(from: Usr06State, to: Usr06State): boolean {
  return (
    ((from === "never_granted" || from === "revoked" || from === "expired") &&
      to === "active") ||
    (from === "active" && (to === "paused" || to === "revoked")) ||
    (from === "paused" && (to === "active" || to === "revoked"))
  );
}

function desiredDocumentMatchesCurrent(
  request: ContextSourcesDocument,
  current: ContextSourcesDocument,
): boolean {
  const desired = request.sources[0];
  const before = current.sources[0];
  return (
    request.schema_version === "0.2.0" &&
    request.user_id === current.user_id &&
    request.updated_at === current.updated_at &&
    desired.schema_version === "0.2.0" &&
    desired.user_id === before.user_id &&
    desired.source_id === before.source_id &&
    desired.permission_tier === before.permission_tier &&
    desired.consent_id === before.consent_id &&
    desired.freshness === null &&
    desired.last_signal_id === before.last_signal_id &&
    desired.scopes.length === 0 &&
    desired.connector_status === "not_applicable" &&
    desired.updated_at === before.updated_at &&
    usesEqual(desired.allowed_uses, before.allowed_uses) &&
    desired.enabled === (desired.permission_state === "active")
  );
}

export type MutateSourceOutcome =
  | { ok: true; response: ContextSourcesDocument; changed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "consent_conflict" };

export async function mutateContextSource(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  request: ContextSourcesDocument,
  now = new Date(),
): Promise<MutateSourceOutcome> {
  const replay = await loadStoredMutation(env, identity, idempotencyKey);
  if (replay) {
    return canonicalJson(replay.request) === canonicalJson(request)
      ? { ok: true, response: replay.response, changed: false }
      : { ok: false, reason: "idempotency_conflict" };
  }

  const current = await loadContextSourcesDocument(env, identity.userId);
  const from = current.sources[0].permission_state;
  const to = request.sources[0].permission_state;
  if (
    !desiredDocumentMatchesCurrent(request, current) ||
    !legalTransition(from, to)
  ) {
    return { ok: false, reason: "consent_conflict" };
  }

  const nowIso = now.toISOString();
  const latest = await env.DB.prepare(
    `SELECT id, version FROM consents
     WHERE user_id = ? AND kind = 'product_source' AND source_id = ?
     ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`,
  )
    .bind(identity.userId, USR06_SOURCE_ID)
    .first<{ id: string; version: number }>();
  const consentId = newId("cns");
  const source: Usr06SourceProjection = {
    schema_version: "0.2.0",
    user_id: identity.userId,
    source_id: USR06_SOURCE_ID,
    enabled: to === "active",
    permission_state: to,
    allowed_uses: [...USR06_ALLOWED_USES],
    permission_tier: USR06_PERMISSION_TIER,
    consent_id: consentId,
    freshness: null,
    last_signal_id: current.sources[0].last_signal_id,
    scopes: [],
    connector_status: "not_applicable",
    updated_at: nowIso,
  };
  const response: ContextSourcesDocument = {
    schema_version: "0.2.0",
    user_id: identity.userId,
    sources: [source],
    updated_at: nowIso,
  };
  const jobId = newId("job");
  const sealed = await encryptPayload(
    env,
    identity,
    { request, response } satisfies StoredSourceMutation,
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: jobId,
    },
  );
  const consentStatus = consentStatusFor(to as Exclude<Usr06State, "never_granted">);
  const usesJson = JSON.stringify(USR06_ALLOWED_USES);

  const currentAssertion =
    from === "never_granted"
      ? env.DB.prepare(
          `INSERT INTO assertion_probe (id, reason)
           SELECT 1, 'USR-06 permission appeared concurrently'
           WHERE EXISTS (
             SELECT 1 FROM context_source_permissions
             WHERE user_id = ? AND source_id = ?
           )`,
        ).bind(identity.userId, USR06_SOURCE_ID)
      : env.DB.prepare(
          `INSERT INTO assertion_probe (id, reason)
           SELECT 1, 'USR-06 permission changed concurrently'
           WHERE NOT EXISTS (
             SELECT 1 FROM context_source_permissions
             WHERE user_id = ? AND source_id = ? AND consent_id = ?
               AND permission_state = ? AND updated_at = ?
           )`,
        ).bind(
          identity.userId,
          USR06_SOURCE_ID,
          current.sources[0].consent_id,
          from,
          current.sources[0].updated_at,
        );

  try {
    await env.DB.batch([
      currentAssertion,
      env.DB.prepare(
        `INSERT INTO consents
           (id, user_id, kind, status, source_id, permission_tier,
            allowed_uses_json, scopes_json, policy_version, ui_surface,
            granted_at, revoked_at, paused_at, version,
            supersedes_consent_id, created_at, updated_at)
         VALUES (?, ?, 'product_source', ?, ?, 1, ?, '[]', ?,
                 'privacy_center', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        consentId,
        identity.userId,
        consentStatus,
        USR06_SOURCE_ID,
        usesJson,
        USR06_POLICY_VERSION,
        to === "active" ? nowIso : null,
        to === "revoked" ? nowIso : null,
        to === "paused" ? nowIso : null,
        (latest?.version ?? 0) + 1,
        latest?.id ?? null,
        nowIso,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO context_source_permissions
           (user_id, source_id, enabled, permission_state, allowed_uses_json,
            permission_tier, consent_id, scopes_json, connector_status,
            last_signal_id, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, '[]', 'not_applicable', ?, ?)
         ON CONFLICT(user_id, source_id) DO UPDATE SET
           enabled = excluded.enabled,
           permission_state = excluded.permission_state,
           allowed_uses_json = excluded.allowed_uses_json,
           permission_tier = excluded.permission_tier,
           consent_id = excluded.consent_id,
           scopes_json = excluded.scopes_json,
           connector_status = excluded.connector_status,
           updated_at = excluded.updated_at`,
      ).bind(
        identity.userId,
        USR06_SOURCE_ID,
        to === "active" ? 1 : 0,
        to,
        usesJson,
        consentId,
        current.sources[0].last_signal_id,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO jobs
           (id, job_type, user_id, idempotency_key, status, payload_enc,
            payload_key_version, payload_nonce, result_class, attempts,
            finished_at, created_at)
         VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'context_source_updated',
                 1, ?, ?)`,
      ).bind(
        jobId,
        MUTATION_JOB_TYPE,
        identity.userId,
        idempotencyKey,
        Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0)),
        sealed.keyVersion,
        sealed.nonce,
        nowIso,
        nowIso,
      ),
    ]);
    return { ok: true, response, changed: true };
  } catch {
    const raced = await loadStoredMutation(env, identity, idempotencyKey);
    if (raced) {
      return canonicalJson(raced.request) === canonicalJson(request)
        ? { ok: true, response: raced.response, changed: false }
        : { ok: false, reason: "idempotency_conflict" };
    }
    return { ok: false, reason: "consent_conflict" };
  }
}
