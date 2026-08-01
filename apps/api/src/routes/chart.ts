import { Hono } from "hono";
import { SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";

export const chartRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

chartRoutes.get("/v1/chart", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    `SELECT id, fingerprint, contract_id, contract_version, container_digest,
            status, calculated_at, snapshot_json, uncertainty_json, birth_accuracy,
            profile_version, tzdb_version
     FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<{
      id: string;
      fingerprint: string;
      contract_id: string;
      contract_version: string;
      container_digest: string;
      status: string;
      calculated_at: string;
      snapshot_json: string;
      uncertainty_json: string;
      birth_accuracy: string;
      profile_version: number;
      tzdb_version: string | null;
    }>();

  if (!row) {
    return c.json(
      {
        error: {
          code: "chart_not_found",
          message: "No active chart for user",
          request_id: c.get("requestId"),
        },
      },
      404,
    );
  }

  const snap = JSON.parse(row.snapshot_json) as {
    positions: unknown[];
    houses: unknown;
    angles: unknown;
    aspects: unknown[];
  };

  return c.json({
    schema_version: SCHEMA_VERSION,
    id: row.id,
    user_id: userId,
    profile_version: row.profile_version,
    fingerprint: row.fingerprint,
    contract_id: row.contract_id,
    contract_version: row.contract_version,
    container_digest: row.container_digest,
    tzdb_version: row.tzdb_version,
    status: row.status,
    calculated_at: row.calculated_at,
    birth: {
      accuracy: row.birth_accuracy,
      // PII redacted in API summary; full birth stays encrypted at rest
      utc_instant: null,
      timezone: null,
      place_label: null,
      latitude: null,
      longitude: null,
    },
    positions: snap.positions,
    houses: snap.houses,
    angles: snap.angles,
    aspects: snap.aspects,
    uncertainty: JSON.parse(row.uncertainty_json),
  });
});
