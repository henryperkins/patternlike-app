import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  ACCOUNT_PROCESSING_ALLOWED_USES,
  ACCOUNT_PROCESSING_POLICY_VERSION,
  CURRENT_ACCOUNT_PROCESSING_POLICY,
  accountProcessingPolicy,
  type AccountProcessingUiSurface,
} from "../policies/account-processing-policies.js";
import { decryptPayload, encryptPayload, type AccountStatus, type UserIdentity } from "./users.js";

const GRANT_JOB_TYPE = "account_processing_consent_grant";
const REVOKE_JOB_TYPE = "account_processing_consent_revoke";
const ALLOWED_USES_JSON = JSON.stringify(ACCOUNT_PROCESSING_ALLOWED_USES);

interface ConsentRow {
  id: string;
  status: string;
  source_id: string | null;
  permission_tier: number;
  allowed_uses_json: string;
  provider: string | null;
  connector_account_id: string | null;
  scopes_json: string;
  policy_version: string;
  granted_at: string | null;
  expires_at: string | null;
  ui_surface: string | null;
  revoked_at: string | null;
  version: number;
  created_at: string;
}

interface StoredMutation {
  operation: "grant" | "revoke";
  policyVersion: string;
  uiSurface: AccountProcessingUiSurface;
  consentId: string | null;
  cursorRefresh: {
    required: boolean;
    mutationAt: string;
  };
}

interface StoredMutationRow {
  id: string;
  payload_enc: ArrayBuffer | null;
  payload_key_version: number | null;
  payload_nonce: string | null;
  result_class: string | null;
}

interface StoredMutationRecord {
  jobId: string;
  resultClass: string | null;
  mutation: StoredMutation;
}

export interface AccountProcessingConsentDocument {
  schema_version: "0.8.0";
  kind: "account_processing";
  source_id: "AST-01";
  permission_tier: 0;
  allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"];
  provider: null;
  scopes: [];
  connector_account_id: null;
  status: "granted" | "not_granted";
  consent_id: string | null;
  account_status: "active" | "frozen";
  regrant_will_restore_access: boolean;
  policy_version: string;
  granted_at: string | null;
  ui_surface: AccountProcessingUiSurface | null;
  disclosure: {
    text: string;
    links: { patternlike_terms: "/terms.html"; patternlike_privacy: "/privacy.html" };
  };
}

export type AccountProcessingMutationOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "consent_conflict" | "account_state_conflict" };

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isSurface(value: unknown): value is AccountProcessingUiSurface {
  return value === "onboarding" || value === "privacy_center";
}

function isStoredMutation(value: unknown): value is StoredMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredMutation>;
  const cursorRefresh = candidate.cursorRefresh;
  return (
    (candidate.operation === "grant" || candidate.operation === "revoke") &&
    typeof candidate.policyVersion === "string" &&
    isSurface(candidate.uiSurface) &&
    (candidate.consentId === null || typeof candidate.consentId === "string") &&
    !!cursorRefresh &&
    typeof cursorRefresh === "object" &&
    typeof cursorRefresh.required === "boolean" &&
    typeof cursorRefresh.mutationAt === "string" &&
    Number.isFinite(Date.parse(cursorRefresh.mutationAt))
  );
}

async function loadLatest(env: Env, userId: string): Promise<ConsentRow | null> {
  return env.DB.prepare(
    `SELECT id, status, source_id, permission_tier, allowed_uses_json, provider,
            connector_account_id, scopes_json, policy_version, granted_at,
            expires_at, ui_surface, revoked_at, version, created_at
     FROM consents
     WHERE user_id = ? AND kind = 'account_processing'
     ORDER BY version DESC, created_at DESC, id DESC
     LIMIT 1`,
  ).bind(userId).first<ConsentRow>();
}

async function loadAccountStatus(env: Env, userId: string): Promise<AccountStatus | null> {
  const row = await env.DB.prepare("SELECT status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ status: AccountStatus }>();
  return row?.status ?? null;
}

function rowHasServerOwnedFields(row: ConsentRow): boolean {
  const policy = accountProcessingPolicy(row.policy_version);
  return !!policy &&
    row.source_id === policy.sourceId &&
    row.permission_tier === policy.permissionTier &&
    row.allowed_uses_json === JSON.stringify(policy.allowedUses) &&
    row.provider === policy.provider &&
    row.connector_account_id === policy.connectorAccountId &&
    row.scopes_json === JSON.stringify(policy.scopes);
}

function isProvenConsentFreeze(row: ConsentRow | null): boolean {
  return !!row &&
    row.status === "revoked" &&
    row.revoked_at !== null &&
    rowHasServerOwnedFields(row);
}

function liveGrant(row: ConsentRow | null, now = new Date()): ConsentRow | null {
  const grantedAt = row?.granted_at === null || row?.granted_at === undefined
    ? Number.NaN
    : Date.parse(row.granted_at);
  const expiresAt = row?.expires_at === null || row?.expires_at === undefined
    ? null
    : Date.parse(row.expires_at);
  if (
    !row ||
    row.status !== "granted" ||
    !Number.isFinite(grantedAt) ||
    (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) ||
    row.policy_version !== ACCOUNT_PROCESSING_POLICY_VERSION ||
    !rowHasServerOwnedFields(row)
  ) {
    return null;
  }
  return row;
}

/** The live gate and birth reservation share this exact current-grant decision. */
export async function loadLiveAccountProcessingGrant(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<{ consentId: string; grantedAt: string } | null> {
  const row = liveGrant(await loadLatest(env, userId), now);
  return row ? { consentId: row.id, grantedAt: row.granted_at! } : null;
}

/**
 * Birth authorization cannot use a prior read as authority. This read is the
 * prompt refusal shared by birth before it reaches its reservation batch; the
 * paired assertion below is the transaction-time authority.
 */
export async function loadExactCurrentAccountProcessingGrant(
  env: Env,
  userId: string,
  consentId: string,
  now = new Date(),
): Promise<{ consentId: string; grantedAt: string } | null> {
  const [accountStatus, latest] = await Promise.all([
    loadAccountStatus(env, userId),
    loadLatest(env, userId),
  ]);
  const grant = liveGrant(latest, now);
  if (accountStatus !== "active" || grant?.id !== consentId) return null;
  return { consentId: grant.id, grantedAt: grant.granted_at! };
}

/**
 * A conditional D1 abort for the head of birth reservation/publication
 * batches. It repeats the exact read predicate, so a revocation committed
 * between the read and batch aborts every following statement atomically.
 */
export function assertExactCurrentAccountProcessingGrant(
  env: Env,
  userId: string,
  consentId: string,
  now = new Date(),
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'birth requires an exact active current account-processing grant'
     WHERE NOT EXISTS (
       SELECT 1
       FROM users
       JOIN consents ON consents.user_id = users.id
       WHERE users.id = ?
         AND users.status = 'active'
         AND consents.id = ?
         AND consents.kind = 'account_processing'
         AND consents.status = 'granted'
         AND consents.granted_at IS NOT NULL
         AND julianday(consents.granted_at) IS NOT NULL
         AND (
           consents.expires_at IS NULL OR (
             julianday(consents.expires_at) IS NOT NULL
             AND julianday(consents.expires_at) > julianday(?)
           )
         )
         AND consents.policy_version = ?
         AND consents.source_id = 'AST-01'
         AND consents.permission_tier = 0
         AND consents.allowed_uses_json = ?
         AND consents.provider IS NULL
         AND consents.connector_account_id IS NULL
         AND consents.scopes_json = '[]'
         AND NOT EXISTS (
           SELECT 1 FROM consents newer
           WHERE newer.user_id = consents.user_id
             AND newer.kind = 'account_processing'
             AND (
               newer.version > consents.version OR
               (newer.version = consents.version AND newer.created_at > consents.created_at) OR
               (newer.version = consents.version AND newer.created_at = consents.created_at AND newer.id > consents.id)
             )
         )
     )`,
  ).bind(
    userId,
    consentId,
    now.toISOString(),
    ACCOUNT_PROCESSING_POLICY_VERSION,
    ALLOWED_USES_JSON,
  );
}

export async function loadAccountProcessingConsentDocument(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<AccountProcessingConsentDocument> {
  const [latest, accountStatus] = await Promise.all([
    loadLatest(env, userId),
    loadAccountStatus(env, userId),
  ]);
  if (accountStatus !== "active" && accountStatus !== "frozen") {
    throw new Error("account-processing state is unavailable");
  }
  const grant = liveGrant(latest, now);
  const regrantWillRestoreAccess =
    accountStatus === "frozen" && isProvenConsentFreeze(latest);
  return {
    schema_version: "0.8.0",
    kind: "account_processing",
    source_id: "AST-01",
    permission_tier: 0,
    allowed_uses: [...ACCOUNT_PROCESSING_ALLOWED_USES],
    provider: null,
    scopes: [],
    connector_account_id: null,
    status: grant ? "granted" : "not_granted",
    consent_id: grant?.id ?? null,
    account_status: accountStatus,
    regrant_will_restore_access: regrantWillRestoreAccess,
    policy_version: CURRENT_ACCOUNT_PROCESSING_POLICY.version,
    granted_at: grant?.granted_at ?? null,
    ui_surface: grant && isSurface(grant.ui_surface) ? grant.ui_surface : null,
    disclosure: {
      text: CURRENT_ACCOUNT_PROCESSING_POLICY.disclosure.text,
      links: { ...CURRENT_ACCOUNT_PROCESSING_POLICY.disclosure.links },
    },
  };
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  jobType: string,
  idempotencyKey: string,
): Promise<StoredMutationRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce, result_class
     FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ? AND status = 'succeeded'`,
  ).bind(jobType, identity.userId, idempotencyKey).first<StoredMutationRow>();
  if (!row) return null;
  if (!row.payload_enc || row.payload_key_version === null || !row.payload_nonce) {
    throw new Error("account-processing idempotency record is incomplete");
  }
  const mutation = await decryptPayload<unknown>(
    env,
    identity,
    {
      ciphertext: bytesToBase64(row.payload_enc),
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
    },
    { subject: identity.cryptoSubject, field: "jobs.payload_enc", recordId: row.id },
  );
  if (!isStoredMutation(mutation)) {
    throw new Error("account-processing idempotency record is invalid");
  }
  return { jobId: row.id, resultClass: row.result_class, mutation };
}

async function mutationInsert(
  env: Env,
  identity: UserIdentity,
  jobType: string,
  idempotencyKey: string,
  mutation: StoredMutation,
  now: string,
): Promise<D1PreparedStatement> {
  const jobId = newId("job");
  const sealed = await encryptPayload(env, identity, mutation, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  return env.DB.prepare(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status, payload_enc,
        payload_key_version, payload_nonce, result_class, attempts, finished_at, created_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    jobId,
    jobType,
    identity.userId,
    idempotencyKey,
    Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
    sealed.keyVersion,
    sealed.nonce,
    mutation.cursorRefresh.required ? "consent_cursor_pending" : "consent_no_cursor_change",
    now,
    now,
  );
}

async function finishStoredCursorRefresh(
  env: Env,
  identity: UserIdentity,
  record: StoredMutationRecord,
): Promise<void> {
  const refresh = record.mutation.cursorRefresh;
  if (!refresh.required || record.resultClass !== "consent_cursor_pending") return;

  const { recomputeUserNextDueAt } = await import("./reading-scheduler.js");
  await recomputeUserNextDueAt(env, identity.userId, new Date(refresh.mutationAt));
  await env.DB.prepare(
    `UPDATE jobs SET result_class = 'consent_cursor_refreshed'
     WHERE id = ? AND user_id = ? AND status = 'succeeded'
       AND result_class = 'consent_cursor_pending'`,
  ).bind(record.jobId, identity.userId).run();
}

function latestAssertion(
  env: Env,
  userId: string,
  latest: ConsentRow | null,
): D1PreparedStatement {
  return latest
    ? env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'account-processing consent state changed concurrently'
       WHERE NOT EXISTS (
         SELECT 1 FROM consents
         WHERE id = ? AND user_id = ? AND kind = 'account_processing' AND version = ?
           AND NOT EXISTS (
             SELECT 1 FROM consents newer
             WHERE newer.user_id = consents.user_id AND newer.kind = consents.kind AND (
               newer.version > consents.version OR
               (newer.version = consents.version AND newer.created_at > consents.created_at) OR
               (newer.version = consents.version AND newer.created_at = consents.created_at AND newer.id > consents.id)
             )
           )
       )`,
    ).bind(latest.id, userId, latest.version)
    : env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'account-processing consent state appeared concurrently'
       WHERE EXISTS (SELECT 1 FROM consents WHERE user_id = ? AND kind = 'account_processing')`,
    ).bind(userId);
}

function accountStatusAssertion(
  env: Env,
  userId: string,
  expected: AccountStatus,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assertion_probe (id, reason)
     SELECT 1, 'account-processing account state changed concurrently'
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND status = ?)`,
  ).bind(userId, expected);
}

async function mutate(
  env: Env,
  identity: UserIdentity,
  input: {
    operation: "grant" | "revoke";
    policyVersion: string;
    uiSurface: AccountProcessingUiSurface;
    idempotencyKey: string;
    now: Date;
  },
): Promise<AccountProcessingMutationOutcome> {
  const jobType = input.operation === "grant" ? GRANT_JOB_TYPE : REVOKE_JOB_TYPE;
  const replay = await loadStoredMutation(env, identity, jobType, input.idempotencyKey);
  if (replay) {
    if (
      replay.mutation.operation !== input.operation ||
      replay.mutation.policyVersion !== input.policyVersion ||
      replay.mutation.uiSurface !== input.uiSurface
    ) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    await finishStoredCursorRefresh(env, identity, replay);
    return { ok: true, changed: false };
  }

  const [latest, accountStatus] = await Promise.all([
    loadLatest(env, identity.userId),
    loadAccountStatus(env, identity.userId),
  ]);
  if (accountStatus !== "active" && accountStatus !== "frozen") {
    return { ok: false, reason: "account_state_conflict" };
  }
  const now = input.now.toISOString();
  const currentGrant = liveGrant(latest, input.now);
  const changing = input.operation === "grant"
    ? currentGrant === null
    : currentGrant !== null;

  if (input.operation === "grant" && accountStatus === "frozen" && !isProvenConsentFreeze(latest)) {
    return { ok: false, reason: "account_state_conflict" };
  }
  if (input.operation === "revoke" && accountStatus === "frozen" && latest?.status === "granted") {
    return { ok: false, reason: "account_state_conflict" };
  }

  const nextConsentId = changing ? newId("cns") : null;
  const mutation: StoredMutation = {
    operation: input.operation,
    policyVersion: input.policyVersion,
    uiSurface: input.uiSurface,
    consentId: nextConsentId,
    cursorRefresh: { required: changing, mutationAt: now },
  };
  const statements: D1PreparedStatement[] = [latestAssertion(env, identity.userId, latest)];

  if (changing && nextConsentId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO consents
           (id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
            scopes_json, provider, connector_account_id, policy_version, ui_surface,
            granted_at, revoked_at, version, supersedes_consent_id, created_at, updated_at)
         VALUES (?, ?, 'account_processing', ?, 'AST-01', 0, ?, '[]', NULL, NULL,
                 ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        nextConsentId,
        identity.userId,
        input.operation === "grant" ? "granted" : "revoked",
        ALLOWED_USES_JSON,
        input.policyVersion,
        input.uiSurface,
        input.operation === "grant" ? now : null,
        input.operation === "revoke" ? now : null,
        (latest?.version ?? 0) + 1,
        latest?.id ?? null,
        now,
        now,
      ),
    );
  }
  if (changing && input.operation === "revoke") {
    statements.push(accountStatusAssertion(env, identity.userId, "active"));
    statements.push(
      env.DB.prepare("UPDATE users SET status = 'frozen', updated_at = ? WHERE id = ? AND status = 'active'")
        .bind(now, identity.userId),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
         VALUES (?, 'user', ?, 'account.frozen', 'account', ?, 'success', 'account_processing', ?)`,
      ).bind(newId("aud"), identity.userId, identity.userId, now),
    );
  }
  if (changing && input.operation === "grant" && accountStatus === "frozen") {
    statements.push(accountStatusAssertion(env, identity.userId, "frozen"));
    statements.push(
      env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'frozen'")
        .bind(now, identity.userId),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
         VALUES (?, 'user', ?, 'account.activated', 'account', ?, 'success', 'account_processing', ?)`,
      ).bind(newId("aud"), identity.userId, identity.userId, now),
    );
  }
  statements.push(await mutationInsert(env, identity, jobType, input.idempotencyKey, mutation, now));
  if (changing && nextConsentId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
         VALUES (?, 'user', ?, ?, 'consent', ?, 'success', 'account_processing', ?)`,
      ).bind(
        newId("aud"),
        identity.userId,
        input.operation === "grant" ? "consent.granted" : "consent.revoked",
        nextConsentId,
        now,
      ),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    const raced = await loadStoredMutation(env, identity, jobType, input.idempotencyKey);
    if (raced) {
      if (
        raced.mutation.operation !== input.operation ||
        raced.mutation.policyVersion !== input.policyVersion ||
        raced.mutation.uiSurface !== input.uiSurface
      ) {
        return { ok: false, reason: "idempotency_conflict" };
      }
      await finishStoredCursorRefresh(env, identity, raced);
      return { ok: true, changed: false };
    }
    return { ok: false, reason: "consent_conflict" };
  }
  if (changing) {
    const inserted = await loadStoredMutation(env, identity, jobType, input.idempotencyKey);
    if (!inserted) throw new Error("account-processing idempotency record disappeared");
    await finishStoredCursorRefresh(env, identity, inserted);
  }
  return { ok: true, changed: changing };
}

export async function grantAccountProcessingConsent(
  env: Env,
  identity: UserIdentity,
  policyVersion: string,
  uiSurface: AccountProcessingUiSurface,
  idempotencyKey: string,
  now = new Date(),
): Promise<AccountProcessingMutationOutcome> {
  return mutate(env, identity, {
    operation: "grant",
    policyVersion,
    uiSurface,
    idempotencyKey,
    now,
  });
}

export async function revokeAccountProcessingConsent(
  env: Env,
  identity: UserIdentity,
  uiSurface: AccountProcessingUiSurface,
  idempotencyKey: string,
  now = new Date(),
): Promise<AccountProcessingMutationOutcome> {
  return mutate(env, identity, {
    operation: "revoke",
    policyVersion: ACCOUNT_PROCESSING_POLICY_VERSION,
    uiSurface,
    idempotencyKey,
    now,
  });
}
