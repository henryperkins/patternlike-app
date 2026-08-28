import { newId } from "@patternlike/shared";

import {
  b64,
  decryptJson,
  encryptJson,
  generateUserDek,
  KEK_DERIVATION_VERSION,
  unwrapDek,
  wrapDek,
  type EncryptionContext,
} from "../crypto.js";
import {
  cryptoOperationView,
  kekRewrapCampaignView,
  readCryptoOperation,
  readCryptoOperationByIdempotency,
  readKekRewrapCampaign,
  readKekRewrapCampaignByIdempotency,
  type CryptoOperationRow,
  type CryptoOperationView,
  type KekRewrapCampaignRow,
  type KekRewrapCampaignView,
} from "../db/crypto-operations.js";
import {
  assertNoUnrotatedCiphertext,
  ENCRYPTED_COLUMNS,
  loadUserIdentity,
  loadUserKey,
  packWrapped,
  rewrapUserKey,
} from "../db/users.js";
import type { Env } from "../env.js";
import {
  readRootKekKeyring,
  resolveActiveRootKey,
  resolveRootKeyById,
  RootKekKeyringError,
} from "./root-kek-keyring.js";

export const DEK_ROTATION_QUIESCENCE_MS = 300_000;
export const DEK_ROTATION_BATCH_SIZE = 75;
export const KEK_REWRAP_BATCH_SIZE = 25;
const OPERATION_LEASE_MS = 30_000;
const ACTIVE_DEK_STAGES = [
  "quiescing",
  "reencrypting",
  "finalizing",
  "verifying",
  "blocked",
] as const;

export type CryptoOperationErrorCode =
  | "crypto_operation_not_found"
  | "crypto_operation_conflict"
  | "crypto_operation_ineligible"
  | "crypto_campaign_conflict"
  | "crypto_target_not_active";

export class CryptoOperationError extends Error {
  constructor(readonly code: CryptoOperationErrorCode) {
    super("The crypto operation could not be advanced");
    this.name = "CryptoOperationError";
  }
}

interface CiphertextRow {
  record_id: string | number;
  enc: ArrayBuffer;
  key_version: number;
  nonce: string;
}

function bytes(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value);
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function audit(
  env: Env,
  action: string,
  resourceType: string,
  resourceId: string,
  result: "success" | "failure" | "denied",
  detailClass: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_events
       (id, actor_type, actor_id, action, resource_type, resource_id,
        result, detail_class, created_at)
     VALUES (?, 'service', NULL, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId("aud"),
    action,
    resourceType,
    resourceId,
    result,
    detailClass,
    now,
  );
}

function operationErrorClass(error: unknown): string {
  if (error instanceof RootKekKeyringError) return "key_unavailable";
  if (error instanceof DOMException && error.name === "OperationError") {
    return "crypto_data_error";
  }
  return "operation_error";
}

async function loadRequiredOperation(
  env: Env,
  operationId: string,
): Promise<CryptoOperationRow> {
  const row = await readCryptoOperation(env, operationId);
  if (!row) throw new CryptoOperationError("crypto_operation_not_found");
  return row;
}

async function loadRequiredCampaign(
  env: Env,
  campaignId: string,
): Promise<KekRewrapCampaignRow> {
  const row = await readKekRewrapCampaign(env, campaignId);
  if (!row) throw new CryptoOperationError("crypto_operation_not_found");
  return row;
}

async function acquireOperationLease(
  env: Env,
  row: CryptoOperationRow,
  now: Date,
): Promise<{ row: CryptoOperationRow; leaseHash: string } | null> {
  if (!ACTIVE_DEK_STAGES.includes(row.stage as typeof ACTIVE_DEK_STAGES[number])) {
    return null;
  }
  const token = crypto.randomUUID();
  const leaseHash = await sha256(token);
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + OPERATION_LEASE_MS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE crypto_operations
     SET lease_token_hash = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND revision = ?
       AND stage IN ('quiescing','reencrypting','finalizing','verifying','blocked')
       AND (lease_token_hash IS NULL OR lease_expires_at <= ?)`,
  ).bind(
    leaseHash,
    expiresAt,
    nowIso,
    row.id,
    row.revision,
    nowIso,
  ).run();
  if (claimed.meta.changes !== 1) return null;
  const leased = await loadRequiredOperation(env, row.id);
  return { row: leased, leaseHash };
}

async function releaseQuiescentLease(
  env: Env,
  row: CryptoOperationRow,
  leaseHash: string,
  now: Date,
): Promise<CryptoOperationView> {
  await env.DB.prepare(
    `UPDATE crypto_operations
     SET revision = revision + 1, lease_token_hash = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND revision = ? AND lease_token_hash = ?`,
  ).bind(now.toISOString(), row.id, row.revision, leaseHash).run();
  return cryptoOperationView(await loadRequiredOperation(env, row.id));
}

export async function getDekRotation(
  env: Env,
  operationId: string,
): Promise<CryptoOperationView> {
  return cryptoOperationView(await loadRequiredOperation(env, operationId));
}

export async function startDekRotation(
  env: Env,
  input: {
    userId: string;
    idempotencyKey: string;
    reasonClass?: "scheduled" | "incident_response" | "compliance";
    now?: Date;
  },
): Promise<CryptoOperationView> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const idempotencyHash = await sha256(input.idempotencyKey);
  const replay = await readCryptoOperationByIdempotency(
    env,
    input.userId,
    idempotencyHash,
  );
  if (replay) return cryptoOperationView(replay);

  const identity = await loadUserIdentity(env, input.userId);
  if (!identity || (identity.status !== "active" && identity.status !== "frozen")) {
    throw new CryptoOperationError("crypto_operation_ineligible");
  }
  const activeCampaign = await env.DB.prepare(
    `SELECT 1 AS present FROM crypto_kek_rewrap_campaigns
     WHERE status IN ('running','blocked') LIMIT 1`,
  ).first<{ present: number }>();
  if (activeCampaign) throw new CryptoOperationError("crypto_campaign_conflict");

  const operationId = newId("cop");
  const notBefore = new Date(
    now.getTime() + DEK_ROTATION_QUIESCENCE_MS,
  ).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'root rewrap campaign is active'
         WHERE EXISTS (
           SELECT 1 FROM crypto_kek_rewrap_campaigns
           WHERE status IN ('running','blocked')
         )`,
      ),
      env.DB.prepare(
        `INSERT INTO crypto_operations (
           id, kind, user_id, idempotency_hash, stage,
           original_account_status, not_before, created_at, updated_at
         ) VALUES (?, 'dek_rotate', ?, ?, 'quiescing', ?, ?, ?, ?)`,
      ).bind(
        operationId,
        input.userId,
        idempotencyHash,
        identity.status,
        notBefore,
        nowIso,
        nowIso,
      ),
      env.DB.prepare(
        `UPDATE users
         SET status = 'frozen', crypto_write_fence = ?, updated_at = ?
         WHERE id = ? AND status = ? AND crypto_write_fence IS NULL`,
      ).bind(operationId, nowIso, input.userId, identity.status),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'crypto write fence was not installed'
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND status = 'frozen' AND crypto_write_fence = ?
         )`,
      ).bind(input.userId, operationId),
      audit(
        env,
        "crypto.dek_rotation.started",
        "crypto_operation",
        operationId,
        "success",
        input.reasonClass ?? "scheduled",
        nowIso,
      ),
    ]);
  } catch {
    const raced = await readCryptoOperationByIdempotency(
      env,
      input.userId,
      idempotencyHash,
    );
    if (raced) return cryptoOperationView(raced);
    throw new CryptoOperationError("crypto_operation_conflict");
  }
  return cryptoOperationView(await loadRequiredOperation(env, operationId));
}

async function hasActiveUserWork(
  env: Env,
  userId: string,
  now: Date,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM jobs
     WHERE user_id = ? AND status = 'running'
       AND (lease_expires_at IS NULL OR lease_expires_at > ?)
     LIMIT 1`,
  ).bind(userId, now.toISOString()).first<{ present: number }>();
  return row !== null;
}

async function persistCandidate(
  env: Env,
  row: CryptoOperationRow,
  leaseHash: string,
  now: Date,
): Promise<CryptoOperationView> {
  const identity = await loadUserIdentity(env, row.user_id);
  if (!identity) throw new CryptoOperationError("crypto_operation_ineligible");
  const live = await loadUserKey(env, identity);
  const candidateVersion = live.keyVersion + 1;
  const candidate = await generateUserDek();
  const root = await resolveActiveRootKey(env);
  const wrapped = await wrapDek(
    candidate,
    root.key,
    identity.cryptoSubject,
    candidateVersion,
  );
  const nowIso = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'reencrypting', previous_key_version = ?,
           candidate_key_version = ?, candidate_wrapped_dek = ?,
           candidate_root_kek_id = ?, revision = revision + 1,
           lease_token_hash = NULL, lease_expires_at = NULL,
           error_class = NULL, updated_at = ?
       WHERE id = ? AND stage = 'quiescing' AND revision = ?
         AND lease_token_hash = ?
         AND EXISTS (
           SELECT 1 FROM users u JOIN user_keys k ON k.user_id = u.id
           WHERE u.id = crypto_operations.user_id
             AND u.crypto_write_fence = crypto_operations.id
             AND u.status = 'frozen' AND k.key_version = ?
             AND k.destroyed_at IS NULL
         )`,
    ).bind(
      live.keyVersion,
      candidateVersion,
      packWrapped(wrapped.nonce_b64, wrapped.wrapped_b64),
      root.keyId,
      nowIso,
      row.id,
      row.revision,
      leaseHash,
      live.keyVersion,
    ),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'candidate DEK was not persisted'
       WHERE NOT EXISTS (
         SELECT 1 FROM crypto_operations
         WHERE id = ? AND stage = 'reencrypting' AND revision = ?
           AND lease_token_hash IS NULL AND candidate_wrapped_dek IS NOT NULL
       )`,
    ).bind(row.id, row.revision + 1),
  ]);
  return cryptoOperationView(await loadRequiredOperation(env, row.id));
}

async function reencryptChunk(
  env: Env,
  row: CryptoOperationRow,
  leaseHash: string,
  now: Date,
): Promise<CryptoOperationView> {
  if (
    row.previous_key_version === null ||
    row.candidate_key_version === null ||
    row.candidate_wrapped_dek === null ||
    row.candidate_root_kek_id === null
  ) {
    throw new Error("candidate state is unavailable");
  }
  const identity = await loadUserIdentity(env, row.user_id);
  if (!identity) throw new CryptoOperationError("crypto_operation_ineligible");
  const live = await loadUserKey(env, identity);
  if (live.keyVersion !== row.previous_key_version) {
    throw new Error("live key changed during rotation");
  }
  const candidateRoot = await resolveRootKeyById(
    env,
    row.candidate_root_kek_id,
  );
  const candidateDek = await unwrapDek(
    bytes(row.candidate_wrapped_dek),
    candidateRoot,
    identity.cryptoSubject,
    row.candidate_key_version,
  );

  const selected: Array<{
    column: typeof ENCRYPTED_COLUMNS[number];
    row: CiphertextRow;
  }> = [];
  for (const column of ENCRYPTED_COLUMNS) {
    const remaining = DEK_ROTATION_BATCH_SIZE - selected.length;
    if (remaining === 0) break;
    const found = await env.DB.prepare(
      `SELECT ${column.idColumn} AS record_id, ${column.encColumn} AS enc,
              ${column.keyVersionColumn} AS key_version,
              ${column.nonceColumn} AS nonce
       FROM ${column.table}
       WHERE user_id = ? AND ${column.encColumn} IS NOT NULL
         AND ${column.keyVersionColumn} = ?
       ORDER BY ${column.idColumn} LIMIT ?`,
    ).bind(
      row.user_id,
      row.previous_key_version,
      remaining,
    ).all<CiphertextRow>();
    for (const foundRow of found.results) selected.push({ column, row: foundRow });
  }

  const nowIso = now.toISOString();
  if (selected.length === 0) {
    await env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'finalizing', revision = revision + 1,
           lease_token_hash = NULL, lease_expires_at = NULL,
           error_class = NULL, updated_at = ?
       WHERE id = ? AND revision = ? AND lease_token_hash = ?
         AND stage IN ('reencrypting','blocked')`,
    ).bind(nowIso, row.id, row.revision, leaseHash).run();
    return cryptoOperationView(await loadRequiredOperation(env, row.id));
  }

  const statements: D1PreparedStatement[] = [];
  const selectedByTable = new Map<string, {
    column: typeof ENCRYPTED_COLUMNS[number];
    ids: Array<string | number>;
  }>();
  for (const selectedRow of selected) {
    const { column, row: ciphertext } = selectedRow;
    const context: EncryptionContext = {
      subject: identity.cryptoSubject,
      field: `${column.table}.${column.encColumn}`,
      recordId: String(ciphertext.record_id),
    };
    const plaintext = await decryptJson(
      {
        key_version: ciphertext.key_version,
        nonce: ciphertext.nonce,
        ciphertext: b64(bytes(ciphertext.enc)),
      },
      live.dek,
      context,
    );
    const sealed = await encryptJson(
      plaintext,
      candidateDek,
      row.candidate_key_version,
      context,
    );
    statements.push(env.DB.prepare(
      `UPDATE ${column.table}
       SET ${column.encColumn} = ?, ${column.keyVersionColumn} = ?,
           ${column.nonceColumn} = ?
       WHERE user_id = ? AND ${column.idColumn} = ?
         AND ${column.keyVersionColumn} = ? AND ${column.encColumn} = ?
         AND ${column.nonceColumn} = ?
         AND EXISTS (
           SELECT 1 FROM users WHERE id = ? AND crypto_write_fence = ?
         )
         AND EXISTS (
           SELECT 1 FROM crypto_operations
           WHERE id = ? AND revision = ? AND lease_token_hash = ?
             AND stage IN ('reencrypting','blocked')
         )`,
    ).bind(
      Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
      row.candidate_key_version,
      sealed.nonce,
      row.user_id,
      ciphertext.record_id,
      row.previous_key_version,
      ciphertext.enc,
      ciphertext.nonce,
      row.user_id,
      row.id,
      row.id,
      row.revision,
      leaseHash,
    ));
    const tableRows = selectedByTable.get(column.table) ?? { column, ids: [] };
    tableRows.ids.push(ciphertext.record_id);
    selectedByTable.set(column.table, tableRows);
  }

  for (const { column, ids } of selectedByTable.values()) {
    statements.push(env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'ciphertext chunk did not commit'
       WHERE EXISTS (
         SELECT 1 FROM ${column.table}
         WHERE user_id = ? AND ${column.keyVersionColumn} = ?
           AND ${column.idColumn} IN (${ids.map(() => "?").join(", ")})
       )`,
    ).bind(row.user_id, row.previous_key_version, ...ids));
  }
  statements.push(
    env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'reencrypting', reencrypted_count = reencrypted_count + ?,
           revision = revision + 1, lease_token_hash = NULL,
           lease_expires_at = NULL, error_class = NULL, updated_at = ?
       WHERE id = ? AND revision = ? AND lease_token_hash = ?
         AND stage IN ('reencrypting','blocked')`,
    ).bind(selected.length, nowIso, row.id, row.revision, leaseHash),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'crypto operation checkpoint did not commit'
       WHERE NOT EXISTS (
         SELECT 1 FROM crypto_operations
         WHERE id = ? AND revision = ? AND lease_token_hash IS NULL
           AND reencrypted_count = ?
       )`,
    ).bind(
      row.id,
      row.revision + 1,
      row.reencrypted_count + selected.length,
    ),
  );
  await env.DB.batch(statements);
  return cryptoOperationView(await loadRequiredOperation(env, row.id));
}

async function finalizeRotation(
  env: Env,
  row: CryptoOperationRow,
  leaseHash: string,
  now: Date,
): Promise<CryptoOperationView> {
  if (
    row.previous_key_version === null ||
    row.candidate_key_version === null ||
    row.candidate_wrapped_dek === null ||
    row.candidate_root_kek_id === null
  ) {
    throw new Error("candidate state is unavailable");
  }
  const identity = await loadUserIdentity(env, row.user_id);
  if (!identity) throw new CryptoOperationError("crypto_operation_ineligible");
  await assertNoUnrotatedCiphertext(env, identity, row.candidate_key_version);
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = ENCRYPTED_COLUMNS.map((column) =>
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'old-version ciphertext remains'
       WHERE EXISTS (
         SELECT 1 FROM ${column.table}
         WHERE user_id = ? AND ${column.encColumn} IS NOT NULL
           AND ${column.keyVersionColumn} = ?
       )`,
    ).bind(row.user_id, row.previous_key_version)
  );
  statements.push(
    env.DB.prepare(
      `UPDATE user_keys SET rotated_at = ?, destroyed_at = ?
       WHERE user_id = ? AND key_version = ? AND destroyed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM users WHERE id = ? AND crypto_write_fence = ?
         )`,
    ).bind(
      nowIso,
      nowIso,
      row.user_id,
      row.previous_key_version,
      row.user_id,
      row.id,
    ),
    env.DB.prepare(
      `INSERT INTO user_keys (
         user_id, key_version, kek_version, wrapped_dek, root_kek_id, created_at
       ) SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM crypto_operations
         WHERE id = ? AND stage = 'finalizing' AND revision = ?
           AND lease_token_hash = ?
       )`,
    ).bind(
      row.user_id,
      row.candidate_key_version,
      KEK_DERIVATION_VERSION,
      row.candidate_wrapped_dek,
      row.candidate_root_kek_id,
      nowIso,
      row.id,
      row.revision,
      leaseHash,
    ),
    env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'verifying', revision = revision + 1,
           lease_token_hash = NULL, lease_expires_at = NULL,
           error_class = NULL, updated_at = ?
       WHERE id = ? AND stage = 'finalizing' AND revision = ?
         AND lease_token_hash = ?
         AND EXISTS (
           SELECT 1 FROM user_keys
           WHERE user_id = crypto_operations.user_id
             AND key_version = crypto_operations.candidate_key_version
             AND destroyed_at IS NULL
         )`,
    ).bind(nowIso, row.id, row.revision, leaseHash),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'DEK finalization did not commit'
       WHERE NOT EXISTS (
         SELECT 1 FROM crypto_operations
         WHERE id = ? AND stage = 'verifying' AND revision = ?
           AND lease_token_hash IS NULL
       )`,
    ).bind(row.id, row.revision + 1),
  );
  await env.DB.batch(statements);
  return cryptoOperationView(await loadRequiredOperation(env, row.id));
}

async function verifyRotation(
  env: Env,
  row: CryptoOperationRow,
  leaseHash: string,
  now: Date,
): Promise<CryptoOperationView> {
  if (row.candidate_key_version === null) {
    throw new Error("candidate state is unavailable");
  }
  const identity = await loadUserIdentity(env, row.user_id);
  if (!identity) throw new CryptoOperationError("crypto_operation_ineligible");
  const live = await loadUserKey(env, identity);
  if (live.keyVersion !== row.candidate_key_version) {
    throw new Error("candidate key did not become live");
  }
  await assertNoUnrotatedCiphertext(env, identity, row.candidate_key_version);
  const nowIso = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'succeeded', candidate_wrapped_dek = NULL,
           lease_token_hash = NULL, lease_expires_at = NULL,
           revision = revision + 1, error_class = NULL,
           updated_at = ?, completed_at = ?
       WHERE id = ? AND stage = 'verifying' AND revision = ?
         AND lease_token_hash = ?`,
    ).bind(nowIso, nowIso, row.id, row.revision, leaseHash),
    env.DB.prepare(
      `UPDATE users
       SET crypto_write_fence = NULL,
           status = CASE WHEN ? = 'active' THEN 'active' ELSE status END,
           updated_at = ?
       WHERE id = ? AND status = 'frozen' AND crypto_write_fence = ?
         AND EXISTS (
           SELECT 1 FROM crypto_operations
           WHERE id = ? AND stage = 'succeeded'
         )`,
    ).bind(
      row.original_account_status,
      nowIso,
      row.user_id,
      row.id,
      row.id,
    ),
    audit(
      env,
      "crypto.dek_rotation.succeeded",
      "crypto_operation",
      row.id,
      "success",
      "completed",
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'DEK verification did not release the account'
       WHERE NOT EXISTS (
         SELECT 1 FROM users WHERE id = ? AND crypto_write_fence IS NULL
       )`,
    ).bind(row.user_id),
  ]);
  return cryptoOperationView(await loadRequiredOperation(env, row.id));
}

async function settleOperationFailure(
  env: Env,
  operationId: string,
  leaseHash: string,
  error: unknown,
  now: Date,
): Promise<CryptoOperationView> {
  const row = await loadRequiredOperation(env, operationId);
  if (row.lease_token_hash !== leaseHash) return cryptoOperationView(row);
  const nowIso = now.toISOString();
  const errorClass = operationErrorClass(error);
  if (row.reencrypted_count > 0) {
    await env.DB.prepare(
      `UPDATE crypto_operations
       SET stage = 'blocked', error_class = ?, revision = revision + 1,
           lease_token_hash = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND revision = ? AND lease_token_hash = ?`,
    ).bind(errorClass, nowIso, row.id, row.revision, leaseHash).run();
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE crypto_operations
         SET stage = 'failed', error_class = ?, candidate_wrapped_dek = NULL,
             lease_token_hash = NULL, lease_expires_at = NULL,
             revision = revision + 1, updated_at = ?, completed_at = ?
         WHERE id = ? AND revision = ? AND lease_token_hash = ?`,
      ).bind(errorClass, nowIso, nowIso, row.id, row.revision, leaseHash),
      env.DB.prepare(
        `UPDATE users
         SET crypto_write_fence = NULL,
             status = CASE WHEN ? = 'active' THEN 'active' ELSE status END,
             updated_at = ?
         WHERE id = ? AND crypto_write_fence = ?
           AND EXISTS (
             SELECT 1 FROM crypto_operations
             WHERE id = ? AND stage = 'failed'
           )`,
      ).bind(
        row.original_account_status,
        nowIso,
        row.user_id,
        row.id,
        row.id,
      ),
      audit(
        env,
        "crypto.dek_rotation.failed",
        "crypto_operation",
        row.id,
        "failure",
        errorClass,
        nowIso,
      ),
    ]);
  }
  return cryptoOperationView(await loadRequiredOperation(env, operationId));
}

export async function stepDekRotation(
  env: Env,
  operationId: string,
  now = new Date(),
): Promise<CryptoOperationView> {
  const current = await loadRequiredOperation(env, operationId);
  if (!ACTIVE_DEK_STAGES.includes(current.stage as typeof ACTIVE_DEK_STAGES[number])) {
    return cryptoOperationView(current);
  }
  if (current.stage === "quiescing" && current.not_before > now.toISOString()) {
    return cryptoOperationView(current);
  }
  const lease = await acquireOperationLease(env, current, now);
  if (!lease) return cryptoOperationView(await loadRequiredOperation(env, operationId));
  try {
    const row = lease.row;
    if (row.stage === "quiescing") {
      if (await hasActiveUserWork(env, row.user_id, now)) {
        return releaseQuiescentLease(env, row, lease.leaseHash, now);
      }
      return persistCandidate(env, row, lease.leaseHash, now);
    }
    if (row.stage === "reencrypting" || row.stage === "blocked") {
      return reencryptChunk(env, row, lease.leaseHash, now);
    }
    if (row.stage === "finalizing") {
      return finalizeRotation(env, row, lease.leaseHash, now);
    }
    return verifyRotation(env, row, lease.leaseHash, now);
  } catch (error) {
    return settleOperationFailure(env, operationId, lease.leaseHash, error, now);
  }
}

export async function getKekRewrapCampaign(
  env: Env,
  campaignId: string,
): Promise<KekRewrapCampaignView> {
  return kekRewrapCampaignView(await loadRequiredCampaign(env, campaignId));
}

export async function createKekRewrapCampaign(
  env: Env,
  input: {
    targetRootKekId: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<KekRewrapCampaignView> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const idempotencyHash = await sha256(input.idempotencyKey);
  const replay = await readKekRewrapCampaignByIdempotency(env, idempotencyHash);
  if (replay) {
    if (replay.target_root_kek_id !== input.targetRootKekId) {
      throw new CryptoOperationError("crypto_operation_conflict");
    }
    return kekRewrapCampaignView(replay);
  }
  const keyring = readRootKekKeyring(env);
  if (!keyring.ok || keyring.value.activeKeyId !== input.targetRootKekId) {
    throw new CryptoOperationError("crypto_target_not_active");
  }
  const activeOperation = await env.DB.prepare(
    `SELECT 1 AS present FROM crypto_operations
     WHERE stage IN ('quiescing','reencrypting','finalizing','verifying','blocked')
     LIMIT 1`,
  ).first<{ present: number }>();
  if (activeOperation) throw new CryptoOperationError("crypto_campaign_conflict");

  const keys = await env.DB.prepare(
    `SELECT k.user_id, k.root_kek_id
     FROM user_keys k
     WHERE k.destroyed_at IS NULL AND k.root_kek_id <> ?
     ORDER BY k.user_id`,
  ).bind(input.targetRootKekId).all<{
    user_id: string;
    root_kek_id: string;
  }>();
  const campaignId = newId("ckc");
  const status = keys.results.length === 0 ? "completed" : "running";
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'DEK rotation is active'
       WHERE EXISTS (
         SELECT 1 FROM crypto_operations
         WHERE stage IN ('quiescing','reencrypting','finalizing','verifying','blocked')
       )`,
    ),
    env.DB.prepare(
      `INSERT INTO crypto_kek_rewrap_campaigns (
         id, idempotency_hash, target_root_kek_id, status, total_count,
         completed_count, blocked_count, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).bind(
      campaignId,
      idempotencyHash,
      input.targetRootKekId,
      status,
      keys.results.length,
      nowIso,
      nowIso,
      status === "completed" ? nowIso : null,
    ),
  ];
  for (const key of keys.results) {
    statements.push(env.DB.prepare(
      `INSERT INTO crypto_kek_rewrap_items (
         campaign_id, user_id, source_root_kek_id, status, updated_at
       ) VALUES (?, ?, ?, 'pending', ?)`,
    ).bind(campaignId, key.user_id, key.root_kek_id, nowIso));
  }
  statements.push(audit(
    env,
    "crypto.kek_rewrap.started",
    "crypto_kek_rewrap_campaign",
    campaignId,
    "success",
    status === "completed" ? "empty_campaign" : "campaign_created",
    nowIso,
  ));
  try {
    await env.DB.batch(statements);
  } catch {
    const raced = await readKekRewrapCampaignByIdempotency(env, idempotencyHash);
    if (raced && raced.target_root_kek_id === input.targetRootKekId) {
      return kekRewrapCampaignView(raced);
    }
    throw new CryptoOperationError("crypto_campaign_conflict");
  }
  return kekRewrapCampaignView(await loadRequiredCampaign(env, campaignId));
}

async function acquireCampaignLease(
  env: Env,
  row: KekRewrapCampaignRow,
  now: Date,
): Promise<{ row: KekRewrapCampaignRow; leaseHash: string } | null> {
  if (row.status === "completed") return null;
  const leaseHash = await sha256(crypto.randomUUID());
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + OPERATION_LEASE_MS).toISOString();
  const result = await env.DB.prepare(
    `UPDATE crypto_kek_rewrap_campaigns
     SET lease_token_hash = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND revision = ? AND status IN ('running','blocked')
       AND (lease_token_hash IS NULL OR lease_expires_at <= ?)`,
  ).bind(
    leaseHash,
    expiresAt,
    nowIso,
    row.id,
    row.revision,
    nowIso,
  ).run();
  if (result.meta.changes !== 1) return null;
  return { row: await loadRequiredCampaign(env, row.id), leaseHash };
}

export async function stepKekRewrapCampaign(
  env: Env,
  campaignId: string,
  now = new Date(),
): Promise<KekRewrapCampaignView> {
  const current = await loadRequiredCampaign(env, campaignId);
  if (current.status === "completed") return kekRewrapCampaignView(current);
  const keyring = readRootKekKeyring(env);
  if (!keyring.ok || keyring.value.activeKeyId !== current.target_root_kek_id) {
    throw new CryptoOperationError("crypto_target_not_active");
  }
  const lease = await acquireCampaignLease(env, current, now);
  if (!lease) {
    return kekRewrapCampaignView(await loadRequiredCampaign(env, campaignId));
  }
  const items = await env.DB.prepare(
    `SELECT i.user_id, i.source_root_kek_id, u.crypto_subject
     FROM crypto_kek_rewrap_items i JOIN users u ON u.id = i.user_id
     WHERE i.campaign_id = ? AND i.status = 'pending'
     ORDER BY i.user_id LIMIT ?`,
  ).bind(campaignId, KEK_REWRAP_BATCH_SIZE).all<{
    user_id: string;
    source_root_kek_id: string;
    crypto_subject: string;
  }>();
  const nowIso = now.toISOString();
  const itemStatements: D1PreparedStatement[] = [];
  for (const item of items.results) {
    try {
      const identity = await loadUserIdentity(env, item.user_id);
      if (!identity) throw new Error("user unavailable");
      await rewrapUserKey(env, identity, current.target_root_kek_id);
      itemStatements.push(env.DB.prepare(
        `UPDATE crypto_kek_rewrap_items
         SET status = 'succeeded', error_class = NULL, updated_at = ?
         WHERE campaign_id = ? AND user_id = ? AND status = 'pending'`,
      ).bind(nowIso, campaignId, item.user_id));
    } catch (error) {
      itemStatements.push(env.DB.prepare(
        `UPDATE crypto_kek_rewrap_items
         SET status = 'blocked', error_class = ?, updated_at = ?
         WHERE campaign_id = ? AND user_id = ? AND status = 'pending'`,
      ).bind(operationErrorClass(error), nowIso, campaignId, item.user_id));
    }
  }
  itemStatements.push(
    env.DB.prepare(
      `UPDATE crypto_kek_rewrap_campaigns
       SET completed_count = (
             SELECT COUNT(*) FROM crypto_kek_rewrap_items
             WHERE campaign_id = ? AND status = 'succeeded'
           ),
           blocked_count = (
             SELECT COUNT(*) FROM crypto_kek_rewrap_items
             WHERE campaign_id = ? AND status = 'blocked'
           ),
           status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM crypto_kek_rewrap_items
               WHERE campaign_id = ? AND status = 'pending'
             ) AND NOT EXISTS (
               SELECT 1 FROM crypto_kek_rewrap_items
               WHERE campaign_id = ? AND status = 'blocked'
             ) AND NOT EXISTS (
               SELECT 1 FROM user_keys
               WHERE destroyed_at IS NULL AND root_kek_id <> ?
             ) AND NOT EXISTS (
               SELECT 1 FROM crypto_operations
               WHERE stage IN ('quiescing','reencrypting','finalizing','verifying','blocked')
                 AND candidate_root_kek_id IS NOT NULL
                 AND candidate_root_kek_id <> ?
             ) THEN 'completed'
             WHEN NOT EXISTS (
               SELECT 1 FROM crypto_kek_rewrap_items
               WHERE campaign_id = ? AND status = 'pending'
             ) THEN 'blocked'
             ELSE 'running'
           END,
           completed_at = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM crypto_kek_rewrap_items
               WHERE campaign_id = ? AND status <> 'succeeded'
             ) AND NOT EXISTS (
               SELECT 1 FROM user_keys
               WHERE destroyed_at IS NULL AND root_kek_id <> ?
             ) THEN ? ELSE NULL END,
           revision = revision + 1, lease_token_hash = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND revision = ? AND lease_token_hash = ?`,
    ).bind(
      campaignId,
      campaignId,
      campaignId,
      campaignId,
      current.target_root_kek_id,
      current.target_root_kek_id,
      campaignId,
      campaignId,
      current.target_root_kek_id,
      nowIso,
      nowIso,
      campaignId,
      lease.row.revision,
      lease.leaseHash,
    ),
    env.DB.prepare(
      `INSERT INTO assertion_probe (id, reason)
       SELECT 1, 'root rewrap checkpoint did not commit'
       WHERE NOT EXISTS (
         SELECT 1 FROM crypto_kek_rewrap_campaigns
         WHERE id = ? AND revision = ? AND lease_token_hash IS NULL
       )`,
    ).bind(campaignId, lease.row.revision + 1),
  );
  await env.DB.batch(itemStatements);
  const result = await loadRequiredCampaign(env, campaignId);
  if (result.status === "completed") {
    await audit(
      env,
      "crypto.kek_rewrap.completed",
      "crypto_kek_rewrap_campaign",
      campaignId,
      "success",
      "completed",
      nowIso,
    ).run();
  }
  return kekRewrapCampaignView(result);
}

export async function retryBlockedKekRewrapItems(
  env: Env,
  campaignId: string,
  now = new Date(),
): Promise<KekRewrapCampaignView> {
  const campaign = await loadRequiredCampaign(env, campaignId);
  if (campaign.status === "completed") return kekRewrapCampaignView(campaign);
  const keyring = readRootKekKeyring(env);
  if (!keyring.ok || keyring.value.activeKeyId !== campaign.target_root_kek_id) {
    throw new CryptoOperationError("crypto_target_not_active");
  }
  const blocked = await env.DB.prepare(
    `SELECT user_id, source_root_kek_id FROM crypto_kek_rewrap_items
     WHERE campaign_id = ? AND status = 'blocked' ORDER BY user_id`,
  ).bind(campaignId).all<{ user_id: string; source_root_kek_id: string }>();
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const item of blocked.results) {
    try {
      await keyring.value.resolve(item.source_root_kek_id);
      await keyring.value.resolve(campaign.target_root_kek_id);
    } catch {
      continue;
    }
    statements.push(env.DB.prepare(
      `UPDATE crypto_kek_rewrap_items
       SET status = 'pending', error_class = NULL, updated_at = ?
       WHERE campaign_id = ? AND user_id = ? AND status = 'blocked'`,
    ).bind(nowIso, campaignId, item.user_id));
  }
  statements.push(env.DB.prepare(
    `UPDATE crypto_kek_rewrap_campaigns
     SET status = CASE WHEN EXISTS (
           SELECT 1 FROM crypto_kek_rewrap_items
           WHERE campaign_id = ? AND status = 'pending'
         ) THEN 'running' ELSE 'blocked' END,
         blocked_count = (
           SELECT COUNT(*) FROM crypto_kek_rewrap_items
           WHERE campaign_id = ? AND status = 'blocked'
         ),
         revision = revision + 1, updated_at = ?
     WHERE id = ? AND status IN ('running','blocked')
       AND lease_token_hash IS NULL`,
  ).bind(campaignId, campaignId, nowIso, campaignId));
  await env.DB.batch(statements);
  return kekRewrapCampaignView(await loadRequiredCampaign(env, campaignId));
}
