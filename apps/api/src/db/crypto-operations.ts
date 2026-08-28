import type { Env } from "../env.js";

export type CryptoOperationStage =
  | "quiescing"
  | "reencrypting"
  | "finalizing"
  | "verifying"
  | "blocked"
  | "succeeded"
  | "failed"
  | "abandoned_to_deletion";

export interface CryptoOperationRow {
  id: string;
  user_id: string;
  idempotency_hash: string;
  stage: CryptoOperationStage;
  original_account_status: "active" | "frozen";
  previous_key_version: number | null;
  candidate_key_version: number | null;
  candidate_wrapped_dek: ArrayBuffer | null;
  candidate_root_kek_id: string | null;
  reencrypted_count: number;
  revision: number;
  lease_token_hash: string | null;
  lease_expires_at: string | null;
  not_before: string;
  error_class: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CryptoOperationView {
  id: string;
  stage: CryptoOperationStage;
  reencryptedCount: number;
  notBefore: string;
  errorClass: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type KekRewrapCampaignStatus = "running" | "blocked" | "completed";

export interface KekRewrapCampaignRow {
  id: string;
  idempotency_hash: string;
  target_root_kek_id: string;
  status: KekRewrapCampaignStatus;
  total_count: number;
  completed_count: number;
  blocked_count: number;
  revision: number;
  lease_token_hash: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface KekRewrapCampaignView {
  id: string;
  targetRootKekId: string;
  status: KekRewrapCampaignStatus;
  totalCount: number;
  completedCount: number;
  blockedCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export async function readCryptoOperation(
  env: Env,
  operationId: string,
): Promise<CryptoOperationRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, idempotency_hash, stage, original_account_status,
            previous_key_version, candidate_key_version,
            candidate_wrapped_dek, candidate_root_kek_id,
            reencrypted_count, revision, lease_token_hash, lease_expires_at,
            not_before, error_class, created_at, updated_at, completed_at
     FROM crypto_operations WHERE id = ?`,
  ).bind(operationId).first<CryptoOperationRow>();
}

export async function readCryptoOperationByIdempotency(
  env: Env,
  userId: string,
  idempotencyHash: string,
): Promise<CryptoOperationRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, idempotency_hash, stage, original_account_status,
            previous_key_version, candidate_key_version,
            candidate_wrapped_dek, candidate_root_kek_id,
            reencrypted_count, revision, lease_token_hash, lease_expires_at,
            not_before, error_class, created_at, updated_at, completed_at
     FROM crypto_operations
     WHERE kind = 'dek_rotate' AND user_id = ? AND idempotency_hash = ?`,
  ).bind(userId, idempotencyHash).first<CryptoOperationRow>();
}

export function cryptoOperationView(row: CryptoOperationRow): CryptoOperationView {
  return {
    id: row.id,
    stage: row.stage,
    reencryptedCount: row.reencrypted_count,
    notBefore: row.not_before,
    errorClass: row.error_class,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function readKekRewrapCampaign(
  env: Env,
  campaignId: string,
): Promise<KekRewrapCampaignRow | null> {
  return env.DB.prepare(
    `SELECT id, idempotency_hash, target_root_kek_id, status, total_count,
            completed_count, blocked_count, revision, lease_token_hash,
            lease_expires_at, created_at, updated_at, completed_at
     FROM crypto_kek_rewrap_campaigns WHERE id = ?`,
  ).bind(campaignId).first<KekRewrapCampaignRow>();
}

export async function readKekRewrapCampaignByIdempotency(
  env: Env,
  idempotencyHash: string,
): Promise<KekRewrapCampaignRow | null> {
  return env.DB.prepare(
    `SELECT id, idempotency_hash, target_root_kek_id, status, total_count,
            completed_count, blocked_count, revision, lease_token_hash,
            lease_expires_at, created_at, updated_at, completed_at
     FROM crypto_kek_rewrap_campaigns WHERE idempotency_hash = ?`,
  ).bind(idempotencyHash).first<KekRewrapCampaignRow>();
}

export function kekRewrapCampaignView(
  row: KekRewrapCampaignRow,
): KekRewrapCampaignView {
  return {
    id: row.id,
    targetRootKekId: row.target_root_kek_id,
    status: row.status,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    blockedCount: row.blocked_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
