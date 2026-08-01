import { Hono } from "hono";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  SCHEMA_VERSION,
  newId,
  requireIdempotencyKey,
  type BirthProfileRequest,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { ensureUser, encryptPayload } from "../db/users.js";
import { invokeCalc } from "../services/calc-client.js";

export const birthRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

birthRoutes.post("/v1/birth-profiles", async (c) => {
  const idem = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!idem) {
    return c.json(
      {
        error: {
          code: "missing_idempotency_key",
          message: "Idempotency-Key header required (min 8 chars)",
          request_id: c.get("requestId"),
        },
      },
      400,
    );
  }

  const userId = c.get("userId");
  const body = (await c.req.json()) as BirthProfileRequest;

  if (!body.accuracy || !body.consent_id) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: "accuracy and consent_id are required",
          request_id: c.get("requestId"),
        },
      },
      400,
    );
  }

  if (body.accuracy !== "unknown" && !body.birth_date) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: "birth_date required unless accuracy is unknown",
          request_id: c.get("requestId"),
        },
      },
      400,
    );
  }

  // Idempotent job short-circuit
  const existingJob = await c.env.DB.prepare(
    `SELECT id, status, result_class FROM jobs
     WHERE job_type = ? AND idempotency_key = ?`,
  )
    .bind("NormalizeBirthAndCalculateChart", idem)
    .first<{ id: string; status: string; result_class: string | null }>();

  if (existingJob?.status === "succeeded") {
    return c.json(
      {
        schema_version: SCHEMA_VERSION,
        workflow: "NormalizeBirthAndCalculateChart",
        status: "duplicate",
        idempotency_key: idem,
        job_id: existingJob.id,
        resource_id: existingJob.result_class,
      },
      202,
    );
  }

  await ensureUser(c.env.DB, userId);

  const now = new Date().toISOString();
  const versionRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) AS v FROM birth_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ v: number }>();
  const profileVersion = (versionRow?.v ?? 0) + 1;

  const sensitive = {
    birth_date: body.birth_date ?? null,
    birth_time_local: body.birth_time_local ?? null,
    birthplace: body.birthplace ?? null,
    approximate_window_minutes: body.approximate_window_minutes ?? null,
    consent_id: body.consent_id,
  };

  const { keyVersion, nonce, ciphertext } = await encryptPayload(
    c.env,
    userId,
    sensitive,
  );

  // D1 bind BLOB: use Uint8Array from base64 ciphertext for payload_enc
  const encBytes = Uint8Array.from(atob(ciphertext), (ch) => ch.charCodeAt(0));

  await c.env.DB.prepare(
    `INSERT INTO birth_profiles (
      user_id, version, accuracy, status, timezone,
      payload_enc, payload_key_version, payload_nonce,
      geocode_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      userId,
      profileVersion,
      body.accuracy,
      body.timezone_hint ?? "UTC",
      encBytes,
      keyVersion,
      nonce,
      now,
      now,
    )
    .run();

  const jobId = newId("job");
  await c.env.DB.prepare(
    `INSERT INTO jobs (
      id, job_type, user_id, idempotency_key, status, payload_json,
      attempts, created_at
    ) VALUES (?, 'NormalizeBirthAndCalculateChart', ?, ?, 'running', ?, 1, ?)`,
  )
    .bind(
      jobId,
      userId,
      idem,
      JSON.stringify({ profile_version: profileVersion }),
      now,
    )
    .run();

  const calc = await invokeCalc(c.env, {
    request_id: jobId,
    user_id: userId,
    profile_version: profileVersion,
    accuracy: body.accuracy,
    birth_date: body.birth_date ?? null,
    birth_time_local: body.birth_time_local ?? null,
    timezone: body.timezone_hint ?? "UTC",
    latitude: body.birthplace?.latitude ?? null,
    longitude: body.birthplace?.longitude ?? null,
    place_label: body.birthplace?.label ?? null,
    approximate_window_minutes: body.approximate_window_minutes ?? null,
    contract_id: CALC_CONTRACT_ID,
    contract_version: CALC_CONTRACT_VERSION,
  });

  if (!calc.ok || !calc.chart) {
    await c.env.DB.prepare(
      `UPDATE jobs SET status = 'failed', result_class = ?, finished_at = ? WHERE id = ?`,
    )
      .bind(calc.error_class ?? "calc_failed", now, jobId)
      .run();
    return c.json(
      {
        error: {
          code: calc.error_class ?? "calc_failed",
          message: calc.error_message ?? "Calculation failed",
          request_id: c.get("requestId"),
        },
      },
      502,
    );
  }

  const chart = calc.chart;
  // Non-PII snapshot for query; birth PII encrypted separately
  const publicSnapshot = {
    positions: chart.positions,
    houses: chart.houses,
    angles: chart.angles,
    aspects: chart.aspects,
    patterns: chart.patterns ?? [],
    uncertainty: chart.uncertainty,
  };

  const birthEnc = await encryptPayload(c.env, userId, {
    utc_instant: chart.birth.utc_instant,
    place_label: chart.birth.place_label,
    latitude: chart.birth.latitude,
    longitude: chart.birth.longitude,
  });
  const birthEncBytes = Uint8Array.from(atob(birthEnc.ciphertext), (ch) =>
    ch.charCodeAt(0),
  );

  await c.env.DB.prepare(
    `INSERT INTO chart_snapshots (
      id, user_id, profile_version, fingerprint, contract_id, contract_version,
      container_digest, tzdb_version, status, calculated_at, snapshot_json,
      birth_accuracy, birth_enc, birth_key_version, birth_nonce,
      r2_uri, uncertainty_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      chart.id,
      userId,
      profileVersion,
      chart.fingerprint,
      chart.contract_id,
      chart.contract_version,
      chart.container_digest,
      chart.tzdb_version ?? null,
      chart.calculated_at,
      JSON.stringify(publicSnapshot),
      chart.birth.accuracy,
      birthEncBytes,
      birthEnc.keyVersion,
      birthEnc.nonce,
      JSON.stringify(chart.uncertainty),
      now,
    )
    .run();

  // Supersede older active charts
  await c.env.DB.prepare(
    `UPDATE chart_snapshots SET status = 'superseded'
     WHERE user_id = ? AND id != ? AND status = 'active'`,
  )
    .bind(userId, chart.id)
    .run();

  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'succeeded', result_class = ?, finished_at = ? WHERE id = ?`,
  )
    .bind(chart.id, now, jobId)
    .run();

  return c.json(
    {
      schema_version: SCHEMA_VERSION,
      workflow: "NormalizeBirthAndCalculateChart",
      status: "succeeded",
      idempotency_key: idem,
      job_id: jobId,
      resource_id: chart.id,
      chart: {
        id: chart.id,
        fingerprint: chart.fingerprint,
        contract_id: chart.contract_id,
        uncertainty: chart.uncertainty,
        status: "active",
      },
    },
    202,
  );
});
