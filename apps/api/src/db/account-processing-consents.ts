import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  ACCOUNT_PROCESSING_ALLOWED_USES,
  CURRENT_ACCOUNT_PROCESSING_POLICY,
  accountProcessingPolicy,
  type AccountProcessingUiSurface,
} from "../policies/account-processing-policies.js";
import { decryptPayload, encryptPayload, type AccountStatus, type UserIdentity } from "./users.js";
import { buildCryptoWriteFence } from "./crypto-write-fence.js";

const GRANT_JOB_TYPE = "account_processing_consent_grant";
const REVOKE_JOB_TYPE = "account_processing_consent_revoke";
const ALLOWED_USES_JSON = JSON.stringify(
  CURRENT_ACCOUNT_PROCESSING_POLICY.allowedUses,
);

/**
 * One SQL predicate owns current account-processing authority. Every read and
 * transaction-time assertion below interpolates these immutable fragments and
 * binds `(now, current policy, allowed uses)` in that order.
 */
const CURRENT_GRANT_PREDICATE_SQL = `
  consents.kind = 'account_processing'
  AND consents.status = 'granted'
  AND consents.granted_at IS NOT NULL
  AND length(consents.granted_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', consents.granted_at) = consents.granted_at
  AND (
    consents.expires_at IS NULL OR (
      length(consents.expires_at) = 24
      AND strftime('%Y-%m-%dT%H:%M:%fZ', consents.expires_at) = consents.expires_at
      AND julianday(consents.expires_at) > julianday(?)
    )
  )
  AND consents.policy_version = ?
  AND consents.source_id = 'AST-01'
  AND consents.permission_tier = 0
  AND consents.allowed_uses_json = ?
  AND consents.provider IS NULL
  AND consents.connector_account_id IS NULL
  AND consents.scopes_json = '[]'`;

const CURRENT_GRANT_IS_HEAD_SQL = `
  NOT EXISTS (
    SELECT 1 FROM consents newer
    WHERE newer.user_id = consents.user_id
      AND newer.kind = consents.kind
      AND (
        newer.version > consents.version OR
        (newer.version = consents.version AND newer.created_at > consents.created_at) OR
        (newer.version = consents.version AND newer.created_at = consents.created_at AND newer.id > consents.id)
      )
  )`;

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
  has_active_chart: boolean;
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

async function loadAccountState(
  env: Env,
  userId: string,
): Promise<{ status: AccountStatus; hasActiveChart: boolean } | null> {
  const row = await env.DB.prepare(
    `SELECT users.status,
            EXISTS (
              SELECT 1 FROM chart_snapshots
              WHERE chart_snapshots.user_id = users.id
                AND chart_snapshots.status = 'active'
            ) AS has_active_chart
     FROM users
     WHERE users.id = ?`,
  ).bind(userId).first<{ status: AccountStatus; has_active_chart: number }>();
  return row
    ? { status: row.status, hasActiveChart: row.has_active_chart === 1 }
    : null;
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

async function loadCurrentGrantRow(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<ConsentRow | null> {
  return env.DB.prepare(
    `SELECT consents.id, consents.status, consents.source_id,
            consents.permission_tier, consents.allowed_uses_json,
            consents.provider, consents.connector_account_id,
            consents.scopes_json, consents.policy_version,
            consents.granted_at, consents.expires_at, consents.ui_surface,
            consents.revoked_at, consents.version, consents.created_at
     FROM consents
     WHERE consents.user_id = ?
       AND ${CURRENT_GRANT_PREDICATE_SQL}
       AND ${CURRENT_GRANT_IS_HEAD_SQL}
     LIMIT 1`,
  ).bind(
    userId,
    now.toISOString(),
    CURRENT_ACCOUNT_PROCESSING_POLICY.version,
    ALLOWED_USES_JSON,
  ).first<ConsentRow>();
}

/** The live gate and birth reservation share this exact current-grant decision. */
export async function loadLiveAccountProcessingGrant(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<{ consentId: string; grantedAt: string } | null> {
  const row = await loadCurrentGrantRow(env, userId, now);
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
  const grant = await env.DB.prepare(
    `SELECT consents.id, consents.granted_at
     FROM consents
     JOIN users ON users.id = consents.user_id
     WHERE users.id = ?
       AND users.status = 'active'
       AND consents.id = ?
       AND ${CURRENT_GRANT_PREDICATE_SQL}
       AND ${CURRENT_GRANT_IS_HEAD_SQL}`,
  ).bind(
    userId,
    consentId,
    now.toISOString(),
    CURRENT_ACCOUNT_PROCESSING_POLICY.version,
    ALLOWED_USES_JSON,
  ).first<{ id: string; granted_at: string }>();
  if (!grant) return null;
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
         AND ${CURRENT_GRANT_PREDICATE_SQL}
         AND ${CURRENT_GRANT_IS_HEAD_SQL}
     )`,
  ).bind(
    userId,
    consentId,
    now.toISOString(),
    CURRENT_ACCOUNT_PROCESSING_POLICY.version,
    ALLOWED_USES_JSON,
  );
}

export async function loadAccountProcessingConsentDocument(
  env: Env,
  userId: string,
  now = new Date(),
): Promise<AccountProcessingConsentDocument> {
  const [latest, accountState, grant] = await Promise.all([
    loadLatest(env, userId),
    loadAccountState(env, userId),
    loadCurrentGrantRow(env, userId, now),
  ]);
  const accountStatus = accountState?.status ?? null;
  if (
    !accountState ||
    (accountStatus !== "active" && accountStatus !== "frozen")
  ) {
    throw new Error("account-processing state is unavailable");
  }
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
    has_active_chart: accountState.hasActiveChart,
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
): Promise<{ fence: D1PreparedStatement; insert: D1PreparedStatement }> {
  const jobId = newId("job");
  const sealed = await encryptPayload(env, identity, mutation, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  return {
    fence: buildCryptoWriteFence(env, {
      userId: identity.userId,
      keyVersion: sealed.keyVersion,
      allowedStatuses: ["active", "frozen"],
    }),
    insert: env.DB.prepare(
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
    ),
  };
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

function sameConsentHead(
  before: ConsentRow | null,
  after: ConsentRow | null,
): boolean {
  if (!before || !after) return before === after;
  return before.id === after.id && before.version === after.version;
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

  const [latest, accountStatus, currentGrant] = await Promise.all([
    loadLatest(env, identity.userId),
    loadAccountStatus(env, identity.userId),
    loadCurrentGrantRow(env, identity.userId, input.now),
  ]);
  if (accountStatus !== "active" && accountStatus !== "frozen") {
    return { ok: false, reason: "account_state_conflict" };
  }
  const now = input.now.toISOString();
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
  const statements: D1PreparedStatement[] = [
    latestAssertion(env, identity.userId, latest),
    accountStatusAssertion(env, identity.userId, accountStatus),
  ];

  if (changing && nextConsentId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO consents
           (id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
            scopes_json, provider, connector_account_id, policy_version, ui_surface,
            granted_at, revoked_at, version, supersedes_consent_id, created_at, updated_at)
         SELECT ?, ?, 'account_processing', ?, 'AST-01', 0, ?, '[]', NULL, NULL,
                ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM users WHERE id = ? AND status = ?
         )`,
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
        identity.userId,
        accountStatus,
      ),
    );
  }
  if (changing && input.operation === "revoke") {
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
  const encryptedMutation = await mutationInsert(
    env,
    identity,
    jobType,
    input.idempotencyKey,
    mutation,
    now,
  );
  statements.unshift(encryptedMutation.fence);
  statements.push(encryptedMutation.insert);
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
  } catch (error) {
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
    const [currentLatest, currentAccountStatus, currentCryptoState] = await Promise.all([
      loadLatest(env, identity.userId),
      loadAccountStatus(env, identity.userId),
      env.DB.prepare(
        "SELECT crypto_write_fence FROM users WHERE id = ?",
      ).bind(identity.userId).first<{ crypto_write_fence: string | null }>(),
    ]);
    if (currentCryptoState?.crypto_write_fence) {
      return { ok: false, reason: "account_state_conflict" };
    }
    if (currentAccountStatus !== accountStatus) {
      return { ok: false, reason: "account_state_conflict" };
    }
    if (!sameConsentHead(latest, currentLatest)) {
      return { ok: false, reason: "consent_conflict" };
    }
    throw error;
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
    policyVersion: CURRENT_ACCOUNT_PROCESSING_POLICY.version,
    uiSurface,
    idempotencyKey,
    now,
  });
}
