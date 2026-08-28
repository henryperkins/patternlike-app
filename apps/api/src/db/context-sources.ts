import { canonicalJson, newId } from "@patternlike/shared";
import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import { buildCryptoWriteFence } from "./crypto-write-fence.js";
import { decryptPayload, encryptPayload, type UserIdentity } from "./users.js";

export const USR06_SOURCE_ID = "USR-06" as const;
export const USR09_SOURCE_ID = "USR-09" as const;
export const USR06_POLICY_VERSION = "usr-06-v1";
export const USR09_POLICY_VERSION = "usr-09-v1";
export const USR06_PERMISSION_TIER = 1 as const;
export const USR09_PERMISSION_TIER = 1 as const;
export const USR06_ALLOWED_USES = [
  "theme_ranking", "tone", "reflection_prompt", "notification_timing",
] as const;
export const USR09_ALLOWED_USES = ["time_travel"] as const;

const COMMON_MUTATION_JOB_TYPE = "context_source_mutation";
const LEGACY_USR06_MUTATION_JOB_TYPE = "context_source_usr06_mutation";
const SOURCE_ORDER = [USR06_SOURCE_ID, USR09_SOURCE_ID] as const;

export type ContextSourceId = typeof SOURCE_ORDER[number];
export type ContextSourceState = "active" | "paused" | "revoked" | "expired" | "never_granted";

export interface ContextSourceProjection {
  schema_version: "0.2.0";
  user_id: string;
  source_id: ContextSourceId;
  enabled: boolean;
  permission_state: ContextSourceState;
  allowed_uses: string[];
  permission_tier: 1;
  consent_id: string | null;
  freshness: null;
  last_signal_id: string | null;
  scopes: string[];
  connector_status: "not_applicable";
  updated_at: string;
}

export type Usr06SourceProjection = ContextSourceProjection & { source_id: "USR-06" };

export interface ContextSourcesDocument {
  schema_version: "0.2.0";
  user_id: string;
  /** GET/response has two canonical entries; PUT carries exactly one. */
  sources: ContextSourceProjection[];
  updated_at: string;
}

interface PermissionRow {
  source_id: ContextSourceId;
  enabled: number;
  permission_state: ContextSourceState;
  permission_allowed_uses_json: string;
  permission_tier: number;
  permission_consent_id: string | null;
  last_signal_id: string | null;
  permission_updated_at: string;
  consent_id: string | null;
  consent_kind: string | null;
  consent_status: string | null;
  consent_source_id: string | null;
  consent_permission_tier: number | null;
  consent_allowed_uses_json: string | null;
}

function expected(sourceId: ContextSourceId) {
  return sourceId === USR06_SOURCE_ID
    ? { uses: USR06_ALLOWED_USES, tier: USR06_PERMISSION_TIER, policy: USR06_POLICY_VERSION }
    : { uses: USR09_ALLOWED_USES, tier: USR09_PERMISSION_TIER, policy: USR09_POLICY_VERSION };
}

function parseUses(raw: string | null): string[] {
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("context-source uses are invalid"); }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("context-source uses are invalid");
  }
  return value;
}

function equalUses(value: readonly string[], wanted: readonly string[]): boolean {
  return value.length === wanted.length && value.every((item, index) => item === wanted[index]);
}

function consentStatus(state: Exclude<ContextSourceState, "never_granted">): string {
  return state === "active" ? "granted" : state;
}

function defaultSource(userId: string, sourceId: ContextSourceId, updatedAt: string): ContextSourceProjection {
  return {
    schema_version: "0.2.0",
    user_id: userId,
    source_id: sourceId,
    enabled: false,
    permission_state: "never_granted",
    allowed_uses: [],
    permission_tier: 1,
    consent_id: null,
    freshness: null,
    last_signal_id: null,
    scopes: [],
    connector_status: "not_applicable",
    updated_at: updatedAt,
  };
}

function projectRow(userId: string, row: PermissionRow): ContextSourceProjection {
  const config = expected(row.source_id);
  const permissionUses = parseUses(row.permission_allowed_uses_json);
  const consentUses = parseUses(row.consent_allowed_uses_json);
  if (
    !["active", "paused", "revoked", "expired"].includes(row.permission_state) ||
    (row.enabled === 1) !== (row.permission_state === "active") ||
    row.permission_tier !== config.tier || !row.permission_consent_id ||
    row.permission_consent_id !== row.consent_id || row.consent_kind !== "product_source" ||
    row.consent_source_id !== row.source_id || row.consent_permission_tier !== config.tier ||
    row.consent_status !== consentStatus(row.permission_state as Exclude<ContextSourceState, "never_granted">) ||
    !equalUses(permissionUses, config.uses) || !equalUses(consentUses, config.uses)
  ) {
    throw new Error(`${row.source_id} permission and consent are inconsistent`);
  }
  return {
    schema_version: "0.2.0",
    user_id: userId,
    source_id: row.source_id,
    enabled: row.permission_state === "active",
    permission_state: row.permission_state,
    allowed_uses: [...config.uses],
    permission_tier: 1,
    consent_id: row.consent_id,
    freshness: null,
    last_signal_id: row.last_signal_id,
    scopes: [],
    connector_status: "not_applicable",
    updated_at: row.permission_updated_at,
  };
}

export async function loadContextSourcesDocument(env: Env, userId: string): Promise<ContextSourcesDocument> {
  const user = await env.DB.prepare("SELECT updated_at FROM users WHERE id = ?")
    .bind(userId).first<{ updated_at: string }>();
  if (!user) throw new Error("context source owner not found");
  const result = await env.DB.prepare(
    `SELECT p.source_id, p.enabled, p.permission_state,
            p.allowed_uses_json AS permission_allowed_uses_json,
            p.permission_tier, p.consent_id AS permission_consent_id,
            p.last_signal_id, p.updated_at AS permission_updated_at,
            c.id AS consent_id, c.kind AS consent_kind, c.status AS consent_status,
            c.source_id AS consent_source_id, c.permission_tier AS consent_permission_tier,
            c.allowed_uses_json AS consent_allowed_uses_json
     FROM context_source_permissions p
     LEFT JOIN consents c ON c.id = p.consent_id AND c.user_id = p.user_id
     WHERE p.user_id = ? AND p.source_id IN ('USR-06', 'USR-09')`,
  ).bind(userId).all<PermissionRow>();
  const byId = new Map((result.results ?? []).map((row) => [row.source_id, row]));
  const sources = SOURCE_ORDER.map((sourceId) => {
    const row = byId.get(sourceId);
    return row ? projectRow(userId, row) : defaultSource(userId, sourceId, user.updated_at);
  });
  return {
    schema_version: "0.2.0",
    user_id: userId,
    sources,
    updated_at: sources.map((source) => source.updated_at).sort().at(-1) ?? user.updated_at,
  };
}

interface StoredMutation {
  request: ContextSourcesDocument;
  response: ContextSourcesDocument;
}

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
  jobType: string,
): Promise<StoredMutation | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ? AND status = 'succeeded'`,
  ).bind(jobType, identity.userId, idempotencyKey).first<{
    id: string;
    payload_enc: ArrayBuffer | readonly number[];
    payload_key_version: number;
    payload_nonce: string;
  }>();
  if (!row) return null;
  return decryptPayload<StoredMutation>(env, identity, {
    key_version: row.payload_key_version,
    nonce: row.payload_nonce,
    ciphertext: b64(bytes(row.payload_enc)),
  }, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: row.id,
  });
}

function legalTransition(from: ContextSourceState, to: ContextSourceState): boolean {
  return (
    ((from === "never_granted" || from === "revoked" || from === "expired") && to === "active") ||
    (from === "active" && (to === "paused" || to === "revoked")) ||
    (from === "paused" && (to === "active" || to === "revoked"))
  );
}

function exactServerOwnedFields(desired: ContextSourceProjection, current: ContextSourceProjection): boolean {
  return (
    desired.schema_version === "0.2.0" && desired.user_id === current.user_id &&
    desired.source_id === current.source_id && desired.permission_tier === current.permission_tier &&
    desired.consent_id === current.consent_id && desired.freshness === null &&
    desired.last_signal_id === current.last_signal_id && desired.scopes.length === 0 &&
    desired.connector_status === "not_applicable" && desired.updated_at === current.updated_at &&
    equalUses(desired.allowed_uses, current.allowed_uses) &&
    desired.enabled === (desired.permission_state === "active")
  );
}

function stateAssertion(env: Env, userId: string, source: ContextSourceProjection): D1PreparedStatement {
  return source.permission_state === "never_granted"
    ? env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'context source appeared concurrently'
         WHERE EXISTS (SELECT 1 FROM context_source_permissions WHERE user_id = ? AND source_id = ?)`,
      ).bind(userId, source.source_id)
    : env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'context source changed concurrently'
         WHERE NOT EXISTS (
           SELECT 1 FROM context_source_permissions
           WHERE user_id = ? AND source_id = ? AND permission_state = ?
             AND consent_id = ? AND updated_at = ?
         )`,
      ).bind(userId, source.source_id, source.permission_state, source.consent_id, source.updated_at);
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
  const replay = await loadStoredMutation(env, identity, idempotencyKey, COMMON_MUTATION_JOB_TYPE);
  if (replay) {
    return canonicalJson(replay.request) === canonicalJson(request)
      ? { ok: true, response: replay.response, changed: false }
      : { ok: false, reason: "idempotency_conflict" };
  }
  const legacy = await loadStoredMutation(env, identity, idempotencyKey, LEGACY_USR06_MUTATION_JOB_TYPE);
  if (legacy) {
    return canonicalJson(legacy.request) === canonicalJson(request)
      ? { ok: true, response: legacy.response, changed: false }
      : { ok: false, reason: "idempotency_conflict" };
  }

  const current = await loadContextSourcesDocument(env, identity.userId);
  if (
    request.schema_version !== "0.2.0" || request.user_id !== identity.userId ||
    request.updated_at !== current.updated_at || request.sources.length !== 1
  ) return { ok: false, reason: "consent_conflict" };
  const desired = request.sources[0]!;
  const before = current.sources.find((source) => source.source_id === desired.source_id);
  if (!before || !exactServerOwnedFields(desired, before) || !legalTransition(before.permission_state, desired.permission_state)) {
    return { ok: false, reason: "consent_conflict" };
  }

  const nowIso = now.toISOString();
  const config = expected(desired.source_id);
  const latest = await env.DB.prepare(
    `SELECT id, version FROM consents
     WHERE user_id = ? AND kind = 'product_source' AND source_id = ?
     ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`,
  ).bind(identity.userId, desired.source_id).first<{ id: string; version: number }>();
  const consentId = newId("cns");
  const target: ContextSourceProjection = {
    ...before,
    enabled: desired.permission_state === "active",
    permission_state: desired.permission_state,
    allowed_uses: [...config.uses],
    consent_id: consentId,
    updated_at: nowIso,
  };
  const response: ContextSourcesDocument = {
    schema_version: "0.2.0",
    user_id: identity.userId,
    sources: current.sources.map((source) => source.source_id === target.source_id ? target : source),
    updated_at: nowIso,
  };
  const jobId = newId("job");
  const sealed = await encryptPayload(env, identity, { request, response } satisfies StoredMutation, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  const usesJson = JSON.stringify(config.uses);
  try {
    await env.DB.batch([
      buildCryptoWriteFence(env, {
        userId: identity.userId,
        keyVersion: sealed.keyVersion,
        allowedStatuses: ["active"],
      }),
      ...current.sources.map((source) => stateAssertion(env, identity.userId, source)),
      env.DB.prepare(
        `INSERT INTO consents (
           id, user_id, kind, status, source_id, permission_tier,
           allowed_uses_json, scopes_json, policy_version, ui_surface,
           granted_at, revoked_at, paused_at, version, supersedes_consent_id,
           created_at, updated_at
         ) VALUES (?, ?, 'product_source', ?, ?, 1, ?, '[]', ?,
                   'privacy_center', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        consentId,
        identity.userId,
        consentStatus(desired.permission_state as Exclude<ContextSourceState, "never_granted">),
        desired.source_id,
        usesJson,
        config.policy,
        desired.permission_state === "active" ? nowIso : null,
        desired.permission_state === "revoked" ? nowIso : null,
        desired.permission_state === "paused" ? nowIso : null,
        (latest?.version ?? 0) + 1,
        latest?.id ?? null,
        nowIso,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO context_source_permissions (
           user_id, source_id, enabled, permission_state, allowed_uses_json,
           permission_tier, consent_id, scopes_json, connector_status,
           last_signal_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, '[]', 'not_applicable', ?, ?)
         ON CONFLICT(user_id, source_id) DO UPDATE SET
           enabled = excluded.enabled, permission_state = excluded.permission_state,
           allowed_uses_json = excluded.allowed_uses_json,
           permission_tier = excluded.permission_tier, consent_id = excluded.consent_id,
           scopes_json = excluded.scopes_json, connector_status = excluded.connector_status,
           updated_at = excluded.updated_at`,
      ).bind(
        identity.userId,
        desired.source_id,
        desired.permission_state === "active" ? 1 : 0,
        desired.permission_state,
        usesJson,
        consentId,
        before.last_signal_id,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO jobs (
           id, job_type, user_id, idempotency_key, status, payload_enc,
           payload_key_version, payload_nonce, result_class, attempts,
           finished_at, created_at
         ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'context_source_updated', 1, ?, ?)`,
      ).bind(
        jobId,
        COMMON_MUTATION_JOB_TYPE,
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
    const raced = await loadStoredMutation(env, identity, idempotencyKey, COMMON_MUTATION_JOB_TYPE);
    if (raced) {
      return canonicalJson(raced.request) === canonicalJson(request)
        ? { ok: true, response: raced.response, changed: false }
        : { ok: false, reason: "idempotency_conflict" };
    }
    return { ok: false, reason: "consent_conflict" };
  }
}
