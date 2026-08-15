import { sha256Hex } from "@patternlike/shared";
import type { Env } from "../env.js";

/** Domain-separated hash. The raw chart fingerprint never lands in this column. */
export async function hashChartFingerprint(fingerprint: string): Promise<string> {
  return sha256Hex(`patternlike.pattern-claim.v1|${fingerprint}`);
}

export type PatternClaimStatus =
  | "available"
  | "reserved"
  | "accepted"
  | "deleted"
  | "superseded"
  | "withdrawn";

export interface PatternClaimRow {
  id: string;
  user_id: string;
  chart_fingerprint_hash: string;
  last_chart_id: string | null;
  status: PatternClaimStatus;
  active_generation_id: string | null;
  consumed_at: string | null;
  accepted_at: string | null;
  deleted_at: string | null;
  superseded_at: string | null;
  withdrawn_at: string | null;
}

export async function loadClaimForFingerprint(
  env: Env,
  userId: string,
  fingerprintHash: string,
): Promise<PatternClaimRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, chart_fingerprint_hash, last_chart_id, status,
            active_generation_id, consumed_at, accepted_at, deleted_at,
            superseded_at, withdrawn_at
     FROM pattern_generation_claims
     WHERE user_id = ? AND chart_fingerprint_hash = ?`,
  )
    .bind(userId, fingerprintHash)
    .first<PatternClaimRow>();
}

export async function loadAnyClaim(env: Env, userId: string): Promise<PatternClaimRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, chart_fingerprint_hash, last_chart_id, status,
            active_generation_id, consumed_at, accepted_at, deleted_at,
            superseded_at, withdrawn_at
     FROM pattern_generation_claims
     WHERE user_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<PatternClaimRow>();
}

export async function loadClaimByGeneration(
  env: Env,
  userId: string,
  generationId: string,
): Promise<PatternClaimRow | null> {
  return env.DB.prepare(
    `SELECT c.id, c.user_id, c.chart_fingerprint_hash, c.last_chart_id, c.status,
            c.active_generation_id, c.consumed_at, c.accepted_at, c.deleted_at,
            c.superseded_at, c.withdrawn_at
     FROM pattern_generation_claims c
     JOIN pattern_generation_jobs j ON j.claim_id = c.id
     WHERE j.user_id = ? AND j.generation_id = ?`,
  )
    .bind(userId, generationId)
    .first<PatternClaimRow>();
}

export function isConsumedStatus(status: PatternClaimStatus): boolean {
  return status === "accepted" || status === "deleted" || status === "superseded" || status === "withdrawn";
}
