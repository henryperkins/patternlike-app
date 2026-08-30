import type { Env } from "../env.js";

type ClaimEnv = Pick<Env, "DB">;

interface ClaimIdentity {
  claimId: string;
  userId: string;
  now: string;
}

/**
 * The sole live writer for claim reservation.
 *
 * An absent claim is inserted directly as reserved. A released claim moves
 * forward through the guarded available -> reserved transition. Callers keep
 * the returned statement inside the batch that creates the generation.
 */
export function reservePatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity & {
    chartFingerprintHash: string;
    chartId: string;
    generationId: string;
    existing: boolean;
  },
): D1PreparedStatement {
  if (!input.existing) {
    return env.DB.prepare(
      `INSERT INTO pattern_generation_claims (
         id, user_id, chart_fingerprint_hash, last_chart_id, status,
         active_generation_id, consumed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'reserved', ?, NULL, ?, ?)`,
    ).bind(
      input.claimId,
      input.userId,
      input.chartFingerprintHash,
      input.chartId,
      input.generationId,
      input.now,
      input.now,
    );
  }
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'reserved', active_generation_id = ?, last_chart_id = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
       AND status = 'available' AND consumed_at IS NULL`,
  ).bind(
    input.generationId,
    input.chartId,
    input.now,
    input.claimId,
    input.userId,
    input.chartFingerprintHash,
  );
}

/** Release only the matching, still-unconsumed reservation. */
export function releaseUnconsumedPatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity & { generationId: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'available', active_generation_id = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'reserved'
       AND consumed_at IS NULL AND active_generation_id = ?`,
  ).bind(input.now, input.claimId, input.userId, input.generationId);
}

/** Release every still-unconsumed reservation owned by one account. */
export function releaseUserPatternClaims(
  env: ClaimEnv,
  input: { userId: string; now: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'available', active_generation_id = NULL, updated_at = ?
     WHERE user_id = ? AND status = 'reserved' AND consumed_at IS NULL`,
  ).bind(input.now, input.userId);
}

/** Clear every accepted replacement owner after a user-wide lifecycle cancel. */
export function releaseUserPatternRegenerations(
  env: ClaimEnv,
  input: { userId: string; now: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET pending_regeneration_id = NULL, updated_at = ?
     WHERE user_id = ? AND status = 'accepted'
       AND consumed_at IS NOT NULL AND pending_regeneration_id IS NOT NULL`,
  ).bind(input.now, input.userId);
}

/** Reserve the only replacement generation while the accepted document stays live. */
export function reservePatternRegeneration(
  env: ClaimEnv,
  input: ClaimIdentity & {
    chartFingerprintHash: string;
    chartId: string;
    generationId: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET pending_regeneration_id = ?, last_chart_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND chart_fingerprint_hash = ?
       AND status = 'accepted' AND consumed_at IS NOT NULL
       AND pending_regeneration_id IS NULL`,
  ).bind(
    input.generationId,
    input.chartId,
    input.now,
    input.claimId,
    input.userId,
    input.chartFingerprintHash,
  );
}

/** Clear only the matching replacement owner; the accepted claim stays consumed. */
export function releasePatternRegeneration(
  env: ClaimEnv,
  input: ClaimIdentity & { generationId: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET pending_regeneration_id = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'accepted'
       AND consumed_at IS NOT NULL AND pending_regeneration_id = ?`,
  ).bind(input.now, input.claimId, input.userId, input.generationId);
}

/** Consume the exact reservation in the publication transaction. */
export function acceptPatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity & { generationId: string },
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'accepted', active_generation_id = NULL,
         consumed_at = ?, accepted_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'reserved'
       AND consumed_at IS NULL AND active_generation_id = ?`,
  ).bind(
    input.now,
    input.now,
    input.now,
    input.claimId,
    input.userId,
    input.generationId,
  );
}

function terminalTransition(
  env: ClaimEnv,
  input: ClaimIdentity,
  status: "deleted" | "superseded" | "withdrawn",
): D1PreparedStatement {
  const timestampColumn = `${status}_at`;
  return env.DB.prepare(
    `UPDATE pattern_generation_claims
     SET status = '${status}', ${timestampColumn} = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'accepted'
       AND consumed_at IS NOT NULL`,
  ).bind(input.now, input.now, input.claimId, input.userId);
}

export function deleteAcceptedPatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity,
): D1PreparedStatement {
  return terminalTransition(env, input, "deleted");
}

export function supersedeAcceptedPatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity,
): D1PreparedStatement {
  return terminalTransition(env, input, "superseded");
}

export function withdrawAcceptedPatternClaim(
  env: ClaimEnv,
  input: ClaimIdentity,
): D1PreparedStatement {
  return terminalTransition(env, input, "withdrawn");
}
