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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const ACCURACIES = new Set(["exact", "approximate", "unknown"]);

export interface ValidationFailure {
  code: "invalid_body";
  message: string;
}

function badCoordinate(value: unknown, label: string, limit: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${label} must be a finite number`;
  }
  if (value < -limit || value > limit) {
    return `${label} out of range: ${value} (expected ${-limit}..${limit})`;
  }
  return null;
}

/**
 * Validate everything the calculation engine would otherwise have to guess at.
 *
 * birth_time_local is required for exact and approximate because without it the
 * engine synthesizes noon, and houses and angles derived from a synthetic noon
 * are not facts about the user. Previously only birth_date was required, so
 * `accuracy: "exact"` with no time produced a chart claiming a rising sign.
 */
export function validateBirthProfileRequest(
  body: Partial<BirthProfileRequest>,
): ValidationFailure | null {
  const fail = (message: string): ValidationFailure => ({ code: "invalid_body", message });

  if (!body.accuracy || !ACCURACIES.has(body.accuracy)) {
    return fail("accuracy must be one of exact, approximate, unknown");
  }
  if (!body.consent_id) {
    return fail("accuracy and consent_id are required");
  }

  if (body.accuracy !== "unknown") {
    if (!body.birth_date) {
      return fail("birth_date required unless accuracy is unknown");
    }
    if (!body.birth_time_local) {
      return fail(
        "birth_time_local required when accuracy is exact or approximate; " +
          'use accuracy "unknown" when the birth time is not known',
      );
    }
  }

  if (body.birth_date !== undefined && body.birth_date !== null) {
    if (typeof body.birth_date !== "string" || !ISO_DATE_RE.test(body.birth_date)) {
      return fail("birth_date must be formatted YYYY-MM-DD");
    }
  }
  if (body.birth_time_local !== undefined && body.birth_time_local !== null) {
    if (
      typeof body.birth_time_local !== "string" ||
      !LOCAL_TIME_RE.test(body.birth_time_local)
    ) {
      return fail("birth_time_local must be formatted HH:MM or HH:MM:SS");
    }
  }
  if (
    body.approximate_window_minutes !== undefined &&
    body.approximate_window_minutes !== null
  ) {
    const w = body.approximate_window_minutes;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > 1440) {
      return fail("approximate_window_minutes must be an integer between 1 and 1440");
    }
  }

  const latError = badCoordinate(body.birthplace?.latitude, "birthplace.latitude", 90);
  if (latError) return fail(latError);
  const lonError = badCoordinate(body.birthplace?.longitude, "birthplace.longitude", 180);
  if (lonError) return fail(lonError);

  const hasLat =
    body.birthplace?.latitude !== null && body.birthplace?.latitude !== undefined;
  const hasLon =
    body.birthplace?.longitude !== null && body.birthplace?.longitude !== undefined;
  if (hasLat !== hasLon) {
    return fail("birthplace latitude and longitude must be supplied together");
  }

  return null;
}

birthRoutes.post("/v1/birth-profiles", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  const idem = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!idem) {
    return c.json(
      errorBody(
        "missing_idempotency_key",
        "Idempotency-Key header required (8-256 chars)",
      ),
      400,
    );
  }

  const userId = c.get("userId");

  let body: Partial<BirthProfileRequest>;
  try {
    body = (await c.req.json()) as Partial<BirthProfileRequest>;
  } catch {
    return c.json(errorBody("invalid_json", "Request body must be valid JSON"), 400);
  }
  if (body === null || typeof body !== "object") {
    return c.json(errorBody("invalid_body", "Request body must be a JSON object"), 400);
  }

  const invalid = validateBirthProfileRequest(body);
  if (invalid) {
    return c.json(errorBody(invalid.code, invalid.message), 400);
  }
  const accuracy = body.accuracy!;

  // Idempotency is scoped to this user. Without the user_id predicate a second
  // user reusing the same key received the first user's job and chart ids while
  // their own profile was never written and their chart never calculated.
  const existingJob = await c.env.DB.prepare(
    `SELECT id, status, result_class FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ?`,
  )
    .bind("NormalizeBirthAndCalculateChart", userId, idem)
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
  if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
    // In flight. Report it rather than re-running the insert and 500ing on the
    // unique index, which is what every non-success retry used to do.
    return c.json(
      {
        schema_version: SCHEMA_VERSION,
        workflow: "NormalizeBirthAndCalculateChart",
        status: "running",
        idempotency_key: idem,
        job_id: existingJob.id,
        resource_id: null,
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

  const { keyVersion, nonce, ciphertext } = await encryptPayload(c.env, userId, sensitive);
  // D1 bind BLOB: Uint8Array from the base64 ciphertext
  const encBytes = Uint8Array.from(atob(ciphertext), (ch) => ch.charCodeAt(0));

  const jobId = existingJob?.id ?? newId("job");

  // The profile lands as 'pending' and the job as 'running' in one transaction.
  // A prior failed job for this key is reused rather than re-inserted, so a
  // retry can never collide with uq_jobs_scope_key.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO birth_profiles (
        user_id, version, accuracy, status, timezone,
        payload_enc, payload_key_version, payload_nonce,
        geocode_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      userId,
      profileVersion,
      accuracy,
      body.timezone_hint ?? "UTC",
      encBytes,
      keyVersion,
      nonce,
      now,
      now,
    ),
    existingJob
      ? c.env.DB.prepare(
          `UPDATE jobs SET status = 'running', payload_json = ?, attempts = attempts + 1,
                           started_at = ?, finished_at = NULL, result_class = NULL
           WHERE id = ?`,
        ).bind(JSON.stringify({ profile_version: profileVersion }), now, jobId)
      : c.env.DB.prepare(
          `INSERT INTO jobs (
            id, job_type, user_id, idempotency_key, status, payload_json,
            attempts, started_at, created_at
          ) VALUES (?, 'NormalizeBirthAndCalculateChart', ?, ?, 'running', ?, 1, ?, ?)`,
        ).bind(
          jobId,
          userId,
          idem,
          JSON.stringify({ profile_version: profileVersion }),
          now,
          now,
        ),
  ]);

  const calc = await invokeCalc(c.env, {
    request_id: jobId,
    user_id: userId,
    profile_version: profileVersion,
    accuracy,
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
    const calcClass = calc.error_class ?? "calc_failed";
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs SET status = 'failed', result_class = ?, finished_at = ? WHERE id = ?`,
      ).bind(calcClass, now, jobId),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'invalid', updated_at = ?
         WHERE user_id = ? AND version = ?`,
      ).bind(now, userId, profileVersion),
    ]);

    // Bad input is the caller's problem and is safe to echo back. Anything else
    // is an upstream fault whose message has previously carried the calculation
    // service's absolute filesystem path, so it is logged rather than returned.
    if (calcClass === "invalid_birth_profile") {
      return c.json(
        errorBody(
          "invalid_birth_profile",
          calc.error_message ?? "Birth profile is not valid",
        ),
        400,
      );
    }
    console.error("calc_failed", {
      request_id: requestId,
      job_id: jobId,
      error_class: calcClass,
      error_message: calc.error_message,
    });
    return c.json(
      errorBody("calc_failed", "Calculation service could not produce a chart"),
      502,
    );
  }

  const chart = calc.chart;

  // Identical birth data under a new key reproduces the fingerprint. OpenAPI
  // declares 409 for this; the previous code let UNIQUE(user_id, fingerprint)
  // throw a bare 500 after the profile and job rows were already committed,
  // leaving the job stuck 'running' forever.
  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM chart_snapshots WHERE user_id = ? AND fingerprint = ?`,
  )
    .bind(userId, chart.fingerprint)
    .first<{ id: string }>();

  if (duplicate) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs SET status = 'succeeded', result_class = ?, finished_at = ? WHERE id = ?`,
      ).bind(duplicate.id, now, jobId),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
         WHERE user_id = ? AND version = ?`,
      ).bind(now, userId, profileVersion),
    ]);
    return c.json(
      {
        error: {
          code: "chart_already_exists",
          message: "This birth data already has a chart",
          request_id: requestId,
          details: { chart_id: duplicate.id, fingerprint: chart.fingerprint },
        },
      },
      409,
    );
  }

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

  // One transaction: publish the chart, supersede the previous chart AND the
  // previous profile versions, activate this profile, close the job. Previously
  // only charts were superseded, so failed calculations left several profile
  // rows at status='active' simultaneously for one user.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO chart_snapshots (
        id, user_id, profile_version, fingerprint, contract_id, contract_version,
        container_digest, tzdb_version, status, calculated_at, snapshot_json,
        birth_accuracy, birth_enc, birth_key_version, birth_nonce,
        r2_uri, uncertainty_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
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
    ),
    c.env.DB.prepare(
      `UPDATE chart_snapshots SET status = 'superseded'
       WHERE user_id = ? AND id != ? AND status = 'active'`,
    ).bind(userId, chart.id),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
       WHERE user_id = ? AND version != ? AND status IN ('pending', 'active')`,
    ).bind(now, userId, profileVersion),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'active', updated_at = ?
       WHERE user_id = ? AND version = ?`,
    ).bind(now, userId, profileVersion),
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'succeeded', result_class = ?, finished_at = ? WHERE id = ?`,
    ).bind(chart.id, now, jobId),
  ]);

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

