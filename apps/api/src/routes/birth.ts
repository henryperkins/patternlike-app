import { Hono } from "hono";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  SCHEMA_VERSION,
  isValidIanaZone,
  newId,
  requireIdempotencyKey,
  type BirthProfileRequest,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { safeLog } from "../services/safe-log.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "../db/users.js";
import { invokeCalc } from "../services/calc-client.js";
import { resolveBirthOperationalConfig } from "../services/birth-operational-config.js";
import {
  allocateBirthProfileVersion,
  prepareBirthCalcAttempt,
  readBirthCalcAttempt,
  type PreparedBirthCalcAttempt,
} from "../db/birth-calc-usage.js";
import {
  birthCalcCommandMatchesRequest,
  buildBirthCalcCommand,
  decodeBirthProfilePayload,
  type BirthCalcCommandV1,
  type BirthLocationQualifierCode,
} from "../services/birth-command.js";
import {
  resolveTimezone,
  type TimezoneResolution,
} from "../services/timezone.js";
import { reconcileCurrentFactRepair } from "../services/reading-invalidation.js";
import { recomputeUserNextDueAt } from "../db/reading-scheduler.js";
import { ensureNatalFeatureSet } from "../db/natal-features.js";
import {
  reconcilePatternAfterChartCorrection,
  retryPatternReconcileIfStale,
} from "../services/pattern-lifecycle.js";

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

  // Rejected here rather than four hundred milliseconds later as a calculation
  // failure. Without coordinates the hint is the only zone signal there is, so
  // a typo in it silently relocates the chart instead of failing.
  if (body.timezone_hint !== undefined && body.timezone_hint !== null) {
    // typeof first: this body is a cast, not a parsed type, so a number here
    // would reach .trim() and surface as a 500 rather than a bad request.
    if (typeof body.timezone_hint !== "string") {
      return fail("timezone_hint must be a string");
    }
    const hint = body.timezone_hint.trim();
    if (hint !== "" && !isValidIanaZone(hint)) {
      return fail(
        `timezone_hint must be an IANA zone id such as America/New_York (got ${hint})`,
      );
    }
  }

  return null;
}

interface ExistingBirthJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result_class: string | null;
  payload_json: string | null;
  attempts: number;
}

interface StoredBirthProfilePayload {
  payload_enc: ArrayBuffer | null;
  payload_key_version: number | null;
  payload_nonce: string | null;
}

interface BirthTimezoneResponse {
  resolved: string;
  source: "coordinates" | "hint" | "default";
  confidence: BirthCalcCommandV1["effective"]["location_confidence"];
  hint_overridden: string | null;
  qualifiers: Array<{
    code: BirthLocationQualifierCode;
    message: string;
  }>;
}

async function loadBirthJob(
  env: Env,
  userId: string,
  idempotencyKey: string,
): Promise<ExistingBirthJob | null> {
  return env.DB.prepare(
    `SELECT id, status, result_class, payload_json, attempts FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ?`,
  )
    .bind(
      "NormalizeBirthAndCalculateChart",
      userId,
      idempotencyKey,
    )
    .first<ExistingBirthJob>();
}

function profileVersionFromJob(job: ExistingBirthJob): number {
  if (job.payload_json === null) {
    throw new Error("birth job profile metadata is unavailable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(job.payload_json);
  } catch {
    throw new Error("birth job profile metadata is malformed");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(parsed, "profile_version")
  ) {
    throw new Error("birth job profile metadata is malformed");
  }
  const version = (parsed as { profile_version?: unknown })
    .profile_version;
  if (!Number.isInteger(version) || Number(version) < 1) {
    throw new Error("birth job profile metadata is malformed");
  }
  return Number(version);
}

function bytesToBase64(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function loadFailedBirthCommand(
  env: Env,
  identity: UserIdentity,
  job: ExistingBirthJob,
): Promise<ReturnType<typeof decodeBirthProfilePayload>> {
  const version = profileVersionFromJob(job);
  const profile = await env.DB.prepare(
    `SELECT payload_enc, payload_key_version, payload_nonce
     FROM birth_profiles
     WHERE user_id = ? AND version = ?`,
  )
    .bind(identity.userId, version)
    .first<StoredBirthProfilePayload>();
  if (
    !profile ||
    profile.payload_enc === null ||
    profile.payload_key_version === null ||
    profile.payload_nonce === null
  ) {
    throw new Error("birth job profile payload is unavailable");
  }
  const plaintext = await decryptPayload<unknown>(
    env,
    identity,
    {
      key_version: profile.payload_key_version,
      nonce: profile.payload_nonce,
      ciphertext: bytesToBase64(profile.payload_enc),
    },
    {
      subject: identity.cryptoSubject,
      field: "birth_profiles.payload_enc",
      recordId: String(version),
    },
  );
  return decodeBirthProfilePayload(plaintext);
}

function qualifierMessage(code: BirthLocationQualifierCode): string {
  const messages: Record<BirthLocationQualifierCode, string> = {
    pre_1970_zone_boundary:
      "The historical timezone offset should be confirmed against a birth record.",
    near_zone_boundary:
      "The birthplace is near a timezone boundary; confirm the zone against a birth record.",
    hint_replaced:
      "The birthplace coordinates resolved to a different timezone than the supplied hint.",
    no_coordinates:
      "No birthplace coordinates were supplied, so the timezone could not be checked against a location.",
    nautical_zone:
      "The supplied coordinates resolve to an open-water fixed-offset timezone.",
    local_time_ambiguous:
      "The local clock ran through this birth time twice; the earlier instant was used.",
    local_time_nonexistent:
      "The local clock skipped this birth time; the first valid instant after the change was used.",
    approximate_match:
      "The birthplace was resolved through an approximate location match.",
    region_level_match:
      "The birthplace was resolved only to a region-level location match.",
  };
  return messages[code];
}

function timezoneResponseFromCommand(
  command: BirthCalcCommandV1,
): BirthTimezoneResponse {
  const birthplace = command.effective.birthplace;
  const hasCoordinates =
    birthplace.latitude !== null && birthplace.longitude !== null;
  const source = hasCoordinates
    ? "coordinates"
    : command.submitted.timezone_hint
      ? "hint"
      : "default";
  return {
    resolved: command.effective.timezone,
    source,
    confidence: command.effective.location_confidence,
    hint_overridden:
      source === "coordinates" &&
        command.submitted.timezone_hint !== null &&
        command.submitted.timezone_hint !==
          command.effective.timezone
        ? command.submitted.timezone_hint
        : null,
    qualifiers: command.effective.location_qualifier_codes.map(
      (code) => ({ code, message: qualifierMessage(code) }),
    ),
  };
}

function timezoneResponseFromResolution(
  resolution: TimezoneResolution,
): BirthTimezoneResponse {
  return {
    resolved: resolution.timezone,
    source: resolution.source,
    confidence: resolution.confidence,
    hint_overridden: resolution.hintOverridden,
    qualifiers: resolution.qualifiers,
  };
}

function isUniqueConstraintFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("unique constraint failed") ||
    message.includes("constraint failed: unique")
  );
}

const BIRTH_JOB_TYPE = "NormalizeBirthAndCalculateChart";
const RETRY_SAFE_KEY_MESSAGE =
  "This failed request predates retry-safe birth commands; submit it with a new Idempotency-Key.";
const IDEMPOTENCY_CONFLICT_MESSAGE =
  "This Idempotency-Key was already used with a different request; submit it with a new Idempotency-Key.";

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
  const identity: UserIdentity = {
    userId,
    cryptoSubject: c.get("cryptoSubject"),
  };

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
  const now = new Date();
  const nowIso = now.toISOString();

  // Idempotency is scoped to this user. Without the user_id predicate a second
  // user reusing the same key received the first user's job and chart ids while
  // their own profile was never written and their chart never calculated.
  const respondToExistingJob = async (job: ExistingBirthJob) => {
    if (job.status === "succeeded") {
      try {
        await retryPatternReconcileIfStale(c.env, identity, now);
      } catch {
        safeLog({ event: "pattern_stage_failed" });
        return c.json(
          errorBody(
            "pattern_invalidation_failed",
            "Pattern invalidation after chart correction did not complete",
          ),
          503,
        );
      }
      return c.json(
        {
          schema_version: SCHEMA_VERSION,
          workflow: BIRTH_JOB_TYPE,
          status: "duplicate",
          idempotency_key: idem,
          job_id: job.id,
          resource_id: job.result_class,
        },
        202,
      );
    }
    // A non-winning concurrent caller may observe the winning synchronous
    // attempt either in flight or just after it closed. It never invokes calc;
    // the next explicit retry re-reads the durable failed state normally.
    return c.json(
      {
        schema_version: SCHEMA_VERSION,
        workflow: BIRTH_JOB_TYPE,
        status: "running",
        idempotency_key: idem,
        job_id: job.id,
        resource_id: null,
      },
      202,
    );
  };

  const existingJob = await loadBirthJob(c.env, userId, idem);
  if (
    existingJob?.status === "succeeded" ||
    existingJob?.status === "queued" ||
    existingJob?.status === "running"
  ) {
    return respondToExistingJob(existingJob);
  }

  let command: BirthCalcCommandV1;
  let timezoneResponse: BirthTimezoneResponse;
  if (existingJob) {
    if (existingJob.status !== "failed") {
      return c.json(
        errorBody("idempotency_conflict", IDEMPOTENCY_CONFLICT_MESSAGE),
        409,
      );
    }
    const decoded = await loadFailedBirthCommand(c.env, identity, existingJob);
    if (decoded.kind === "malformed_v1") {
      throw new Error("stored birth calculation command is malformed");
    }
    if (decoded.kind !== "v1") {
      return c.json(
        errorBody("idempotency_conflict", RETRY_SAFE_KEY_MESSAGE),
        409,
      );
    }
    if (!birthCalcCommandMatchesRequest(decoded.command, body as BirthProfileRequest)) {
      return c.json(
        errorBody("idempotency_conflict", IDEMPOTENCY_CONFLICT_MESSAGE),
        409,
      );
    }
    command = decoded.command;
    timezoneResponse = timezoneResponseFromCommand(command);
  } else {
    // Resolve the zone from the birthplace rather than trusting the client's
    // hint, which is the browser's current zone and may not be the birth zone.
    // Replays and retry-safe failed attempts do not repeat this resolution.
    const timezone = resolveTimezone({
      latitude: body.birthplace?.latitude ?? null,
      longitude: body.birthplace?.longitude ?? null,
      birthDate: body.birth_date ?? null,
      birthTimeLocal: body.birth_time_local ?? null,
      timezoneHint: body.timezone_hint ?? null,
    });
    command = buildBirthCalcCommand(
      body as BirthProfileRequest,
      timezone,
    );
    timezoneResponse = timezoneResponseFromResolution(timezone);
  }

  const operational = resolveBirthOperationalConfig(c.env);
  if (!operational.ok) {
    throw new Error("birth operational configuration is unavailable");
  }
  const profileVersion = await allocateBirthProfileVersion(
    c.env,
    userId,
    now,
  );

  // The AAD binds this ciphertext to this user, this column, and this profile
  // version, so a blob lifted into another row or another user's record fails
  // to decrypt even when the DEK is correct.
  const { keyVersion, nonce, ciphertext } = await encryptPayload(
    c.env,
    identity,
    command,
    {
      subject: identity.cryptoSubject,
      field: "birth_profiles.payload_enc",
      recordId: String(profileVersion),
    },
  );
  // D1 bind BLOB: Uint8Array from the base64 ciphertext
  const encBytes = Uint8Array.from(atob(ciphertext), (ch) => ch.charCodeAt(0));

  const jobId = existingJob?.id ?? newId("job");
  const attempt = (existingJob?.attempts ?? 0) + 1;
  const profileMetadata = JSON.stringify({ profile_version: profileVersion });
  const claimToken = crypto.randomUUID();
  const prepared: PreparedBirthCalcAttempt = await prepareBirthCalcAttempt(
    c.env,
    userId,
    idem,
    attempt,
    claimToken,
    operational.value.dailyLimit,
    now,
  );

  // Reservation statements run first in the same transaction. The profile and
  // job statements are no-ops unless this exact owner-scoped claim was charged.
  // A failed retry additionally compares the durable job row it read, so two
  // callers cannot both advance one attempt.
  const profileStatement = existingJob
    ? c.env.DB.prepare(
      `INSERT INTO birth_profiles (
        user_id, version, accuracy, status, timezone,
        payload_enc, payload_key_version, payload_nonce,
        geocode_confidence, created_at, updated_at
       )
       SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM birth_calc_reservations
         WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
           AND status = 'charged'
       )
       AND EXISTS (
         SELECT 1 FROM jobs
         WHERE id = ? AND job_type = ? AND user_id = ?
           AND idempotency_key = ? AND status = 'failed'
           AND attempts = ? AND payload_json = ?
       )`,
    ).bind(
      userId,
      profileVersion,
      command.effective.accuracy,
      command.effective.timezone,
      encBytes,
      keyVersion,
      nonce,
      command.effective.location_confidence,
      nowIso,
      nowIso,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      existingJob.id,
      BIRTH_JOB_TYPE,
      userId,
      idem,
      existingJob.attempts,
      existingJob.payload_json,
    )
    : c.env.DB.prepare(
      `INSERT INTO birth_profiles (
         user_id, version, accuracy, status, timezone,
         payload_enc, payload_key_version, payload_nonce,
         geocode_confidence, created_at, updated_at
       )
       SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM birth_calc_reservations
         WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
           AND status = 'charged'
       )
       AND NOT EXISTS (
         SELECT 1 FROM jobs
         WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       )`,
    ).bind(
      userId,
      profileVersion,
      command.effective.accuracy,
      command.effective.timezone,
      encBytes,
      keyVersion,
      nonce,
      command.effective.location_confidence,
      nowIso,
      nowIso,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      BIRTH_JOB_TYPE,
      userId,
      idem,
    );

  const jobStatement = existingJob
    ? c.env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', payload_json = ?, attempts = ?,
           started_at = ?, finished_at = NULL, result_class = NULL
       WHERE id = ? AND job_type = ? AND user_id = ?
         AND idempotency_key = ? AND status = 'failed'
         AND attempts = ? AND payload_json = ?
         AND EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         AND EXISTS (
           SELECT 1 FROM birth_profiles
           WHERE user_id = ? AND version = ? AND status = 'pending'
         )`,
    ).bind(
      profileMetadata,
      attempt,
      nowIso,
      existingJob.id,
      BIRTH_JOB_TYPE,
      userId,
      idem,
      existingJob.attempts,
      existingJob.payload_json,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      userId,
      profileVersion,
    )
    : c.env.DB.prepare(
      `INSERT INTO jobs (
         id, job_type, user_id, idempotency_key, status, payload_json,
         attempts, started_at, created_at
       )
       SELECT ?, ?, ?, ?, 'running', ?, 1, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM birth_calc_reservations
         WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
           AND status = 'charged'
       )
       AND EXISTS (
         SELECT 1 FROM birth_profiles
         WHERE user_id = ? AND version = ? AND status = 'pending'
       )
       AND NOT EXISTS (
         SELECT 1 FROM jobs
         WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       )`,
    ).bind(
      jobId,
      BIRTH_JOB_TYPE,
      userId,
      idem,
      profileMetadata,
      nowIso,
      nowIso,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      userId,
      profileVersion,
      BIRTH_JOB_TYPE,
      userId,
      idem,
    );

  try {
    await c.env.DB.batch([
      ...prepared.statements,
      profileStatement,
      jobStatement,
    ]);
  } catch (error) {
    if (!isUniqueConstraintFailure(error)) throw error;
    const racedJob = await loadBirthJob(c.env, userId, idem);
    if (!racedJob) throw error;
    return respondToExistingJob(racedJob);
  }

  const reservation = await readBirthCalcAttempt(
    c.env,
    userId,
    prepared.reservationHash,
    prepared.claimTokenHash,
    now,
  );
  if (!reservation) {
    throw new Error("birth calculation reservation disappeared after commit");
  }
  if (reservation.status === "denied") {
    safeLog({
      event: "birth_calc_budget_exhausted",
      daily_limit: operational.value.dailyLimit,
    });
    c.header("Retry-After", String(reservation.retryAfterSeconds));
    return c.json(
      {
        error: {
          code: "birth_calc_budget_exhausted",
          message: "The daily birth calculation limit has been reached",
          request_id: requestId,
          details: { resets_at: reservation.resetsAt },
        },
      },
      429,
    );
  }
  if (!reservation.winner) {
    const racedJob = await loadBirthJob(c.env, userId, idem);
    if (!racedJob) {
      throw new Error("birth calculation claim has no durable job");
    }
    return respondToExistingJob(racedJob);
  }

  const claimedJob = await loadBirthJob(c.env, userId, idem);
  if (
    !claimedJob ||
    claimedJob.id !== jobId ||
    claimedJob.status !== "running" ||
    claimedJob.attempts !== attempt ||
    profileVersionFromJob(claimedJob) !== profileVersion
  ) {
    if (claimedJob) return respondToExistingJob(claimedJob);
    throw new Error("birth calculation claim did not create a durable job");
  }

  const calcInvocation = await invokeCalc(c.env, {
    request_id: jobId,
    user_id: userId,
    profile_version: profileVersion,
    accuracy: command.effective.accuracy,
    birth_date: command.effective.birth_date,
    birth_time_local: command.effective.birth_time_local,
    timezone: command.effective.timezone,
    latitude: command.effective.birthplace.latitude,
    longitude: command.effective.birthplace.longitude,
    place_label: command.effective.birthplace.label,
    approximate_window_minutes:
      command.effective.approximate_window_minutes,
    contract_id: CALC_CONTRACT_ID,
    contract_version: CALC_CONTRACT_VERSION,
  }, operational.value.fetchTimeoutMs);
  const calc = calcInvocation.response;
  const outcome = calcInvocation.timedOut
    ? "timeout"
    : calc.ok
      ? "success"
      : calc.error_class === "invalid_birth_profile"
        ? "invalid_input"
        : "upstream_failure";
  safeLog({
    event: "birth_calc_completed",
    outcome,
    latency_ms: Math.max(0, Math.round(calcInvocation.latencyMs)),
    timeout_ms: operational.value.fetchTimeoutMs,
  });

  if (!calc.ok || !calc.chart) {
    const calcClass = calc.error_class ?? "calc_failed";
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs
         SET status = 'failed', result_class = ?, finished_at = ?
         WHERE id = ? AND job_type = ? AND user_id = ?
           AND idempotency_key = ? AND status = 'running'
           AND attempts = ? AND payload_json = ?
           AND EXISTS (
             SELECT 1 FROM birth_calc_reservations
             WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
               AND status = 'charged'
           )`,
      ).bind(
        calcClass,
        nowIso,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        userId,
        prepared.reservationHash,
        prepared.claimTokenHash,
      ),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'invalid', updated_at = ?
         WHERE user_id = ? AND version = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM birth_calc_reservations
             WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
               AND status = 'charged'
           )
           AND EXISTS (
             SELECT 1 FROM jobs
             WHERE id = ? AND job_type = ? AND user_id = ?
               AND idempotency_key = ? AND status = 'failed'
               AND attempts = ? AND payload_json = ? AND result_class = ?
           )`,
      ).bind(
        nowIso,
        userId,
        profileVersion,
        userId,
        prepared.reservationHash,
        prepared.claimTokenHash,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        calcClass,
      ),
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
    return c.json(
      errorBody("calc_failed", "Calculation service could not produce a chart"),
      502,
    );
  }

  const chart = calc.chart;

  // Fingerprint uniqueness is decided by the guarded insertion below, never by
  // a read-before-write check. Two distinct keys can finish the same
  // calculation concurrently; the database chooses one chart and the loser
  // converges its durable job/profile after observing that winner.

  // Non-PII snapshot for query; birth PII encrypted separately
  const publicSnapshot = {
    positions: chart.positions,
    houses: chart.houses,
    angles: chart.angles,
    aspects: chart.aspects,
    patterns: chart.patterns ?? [],
    uncertainty: chart.uncertainty,
  };

  const birthEnc = await encryptPayload(
    c.env,
    identity,
    {
      utc_instant: chart.birth.utc_instant,
      place_label: chart.birth.place_label,
      latitude: chart.birth.latitude,
      longitude: chart.birth.longitude,
    },
    {
      subject: identity.cryptoSubject,
      field: "chart_snapshots.birth_enc",
      recordId: chart.id,
    },
  );
  const birthEncBytes = Uint8Array.from(atob(birthEnc.ciphertext), (ch) =>
    ch.charCodeAt(0),
  );

  // One transaction: publish the chart, supersede the previous chart AND the
  // previous profile versions, activate this profile, close the job. Previously
  // only charts were superseded, so failed calculations left several profile
  // rows at status='active' simultaneously for one user.
  const publication = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO chart_snapshots (
        id, user_id, profile_version, fingerprint, contract_id, contract_version,
        container_digest, tzdb_version, status, calculated_at, snapshot_json,
        birth_accuracy, birth_enc, birth_key_version, birth_nonce,
        r2_uri, uncertainty_json, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM birth_calc_reservations
         WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
           AND status = 'charged'
       )
       AND EXISTS (
         SELECT 1 FROM jobs
         WHERE id = ? AND job_type = ? AND user_id = ?
           AND idempotency_key = ? AND status = 'running'
           AND attempts = ? AND payload_json = ?
       )
       AND EXISTS (
         SELECT 1 FROM birth_profiles
         WHERE user_id = ? AND version = ?
           AND status IN ('pending', 'superseded')
       )`,
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
      nowIso,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      jobId,
      BIRTH_JOB_TYPE,
      userId,
      idem,
      attempt,
      profileMetadata,
      userId,
      profileVersion,
    ),
    c.env.DB.prepare(
      `UPDATE chart_snapshots SET status = 'superseded'
       WHERE user_id = ? AND id != ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         AND EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
             AND profile_version = ? AND status = 'active'
         )`,
    ).bind(
      userId,
      chart.id,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      chart.id,
      userId,
      chart.fingerprint,
      profileVersion,
    ),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
       WHERE user_id = ? AND version != ? AND status IN ('pending', 'active')
         AND EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         AND EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
             AND profile_version = ? AND status = 'active'
         )`,
    ).bind(
      nowIso,
      userId,
      profileVersion,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      chart.id,
      userId,
      chart.fingerprint,
      profileVersion,
    ),
    c.env.DB.prepare(
      `UPDATE birth_profiles SET status = 'active', updated_at = ?
       WHERE user_id = ? AND version = ?
         AND status IN ('pending', 'superseded')
         AND EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         AND EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
             AND profile_version = ? AND status = 'active'
         )`,
    ).bind(
      nowIso,
      userId,
      profileVersion,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      chart.id,
      userId,
      chart.fingerprint,
      profileVersion,
    ),
    c.env.DB.prepare(
      `UPDATE jobs
       SET status = 'succeeded', result_class = ?, finished_at = ?
       WHERE id = ? AND job_type = ? AND user_id = ?
         AND idempotency_key = ? AND status = 'running'
         AND attempts = ? AND payload_json = ?
         AND EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         AND EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
             AND profile_version = ? AND status = 'active'
         )
         AND EXISTS (
           SELECT 1 FROM birth_profiles
           WHERE user_id = ? AND version = ? AND status = 'active'
         )`,
    ).bind(
      chart.id,
      nowIso,
      jobId,
      BIRTH_JOB_TYPE,
      userId,
      idem,
      attempt,
      profileMetadata,
      userId,
      prepared.reservationHash,
      prepared.claimTokenHash,
      chart.id,
      userId,
      chart.fingerprint,
      profileVersion,
      userId,
      profileVersion,
    ),
  ]);

  const insertChanges = publication[0]?.meta.changes;
  if (
    typeof insertChanges !== "number" ||
    !Number.isInteger(insertChanges) ||
    insertChanges < 0
  ) {
    throw new Error("birth chart insertion result is unavailable");
  }
  const ownChart = await c.env.DB.prepare(
    `SELECT id FROM chart_snapshots
     WHERE id = ? AND user_id = ? AND fingerprint = ? AND profile_version = ?`,
  ).bind(
    chart.id,
    userId,
    chart.fingerprint,
    profileVersion,
  ).first<{ id: string }>();

  if (insertChanges === 0 || !ownChart) {
    const duplicate = await c.env.DB.prepare(
      `SELECT id FROM chart_snapshots
       WHERE user_id = ? AND fingerprint = ?`,
    ).bind(userId, chart.fingerprint).first<{ id: string }>();
    if (!duplicate) {
      throw new Error("birth chart publication did not converge");
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'birth fingerprint winner settlement precondition failed'
         WHERE NOT EXISTS (
           SELECT 1 FROM birth_calc_reservations
           WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
             AND status = 'charged'
         )
         OR NOT EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
         )
         OR NOT EXISTS (
           SELECT 1 FROM jobs
           WHERE id = ? AND job_type = ? AND user_id = ?
             AND idempotency_key = ? AND status = 'running'
             AND attempts = ? AND payload_json = ?
         )
         OR NOT EXISTS (
           SELECT 1 FROM birth_profiles
           WHERE user_id = ? AND version = ?
             AND status IN ('pending', 'superseded')
         )`,
      ).bind(
        userId,
        prepared.reservationHash,
        prepared.claimTokenHash,
        duplicate.id,
        userId,
        chart.fingerprint,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        userId,
        profileVersion,
      ),
      c.env.DB.prepare(
        `UPDATE jobs
         SET status = 'succeeded', result_class = ?, finished_at = ?
         WHERE id = ? AND job_type = ? AND user_id = ?
           AND idempotency_key = ? AND status = 'running'
           AND attempts = ? AND payload_json = ?
           AND EXISTS (
             SELECT 1 FROM birth_calc_reservations
             WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
               AND status = 'charged'
           )
           AND EXISTS (
             SELECT 1 FROM chart_snapshots
             WHERE id = ? AND user_id = ? AND fingerprint = ?
           )
           AND EXISTS (
             SELECT 1 FROM birth_profiles
             WHERE user_id = ? AND version = ?
               AND status IN ('pending', 'superseded')
           )`,
      ).bind(
        duplicate.id,
        nowIso,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        userId,
        prepared.reservationHash,
        prepared.claimTokenHash,
        duplicate.id,
        userId,
        chart.fingerprint,
        userId,
        profileVersion,
      ),
      c.env.DB.prepare(
        `UPDATE birth_profiles SET status = 'superseded', updated_at = ?
         WHERE user_id = ? AND version = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM birth_calc_reservations
             WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
               AND status = 'charged'
           )
           AND EXISTS (
             SELECT 1 FROM chart_snapshots
             WHERE id = ? AND user_id = ? AND fingerprint = ?
           )
           AND EXISTS (
             SELECT 1 FROM jobs
             WHERE id = ? AND job_type = ? AND user_id = ?
               AND idempotency_key = ? AND status = 'succeeded'
               AND attempts = ? AND payload_json = ? AND result_class = ?
           )`,
      ).bind(
        nowIso,
        userId,
        profileVersion,
        userId,
        prepared.reservationHash,
        prepared.claimTokenHash,
        duplicate.id,
        userId,
        chart.fingerprint,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        duplicate.id,
      ),
      c.env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'birth fingerprint winner settlement did not converge'
         WHERE NOT EXISTS (
           SELECT 1 FROM chart_snapshots
           WHERE id = ? AND user_id = ? AND fingerprint = ?
         )
         OR NOT EXISTS (
           SELECT 1 FROM jobs
           WHERE id = ? AND job_type = ? AND user_id = ?
             AND idempotency_key = ? AND status = 'succeeded'
             AND attempts = ? AND payload_json = ? AND result_class = ?
         )
         OR NOT EXISTS (
           SELECT 1 FROM birth_profiles
           WHERE user_id = ? AND version = ? AND status = 'superseded'
         )`,
      ).bind(
        duplicate.id,
        userId,
        chart.fingerprint,
        jobId,
        BIRTH_JOB_TYPE,
        userId,
        idem,
        attempt,
        profileMetadata,
        duplicate.id,
        userId,
        profileVersion,
      ),
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

  // The chart commit above is authoritative. Pattern's deterministic cache is
  // awaited for the eager path, but its failure must not roll back a valid
  // chart or make onboarding depend on editorial content. The Pattern GET
  // repairs the same receipt lazily.
  try {
    await ensureNatalFeatureSet(c.env, userId, chart.id, now);
  } catch {
    safeLog({ event: "natal_feature_cache_write_failed" });
  }

  await recomputeUserNextDueAt(c.env, userId, now);

  // Chart activation commits first. If the process dies here, Today's read
  // guard already hides prose pinned to the superseded chart; the same
  // owner-scoped reconciliation is safe to repeat on the next pass.
  const repair = await reconcileCurrentFactRepair(
    c.env,
    identity,
    "chart_correction",
    now,
  );
  if (!repair.ok) {
    safeLog({ event: "fact_repair_reconciliation_failed" });
  }

  try {
    await reconcilePatternAfterChartCorrection(
      c.env,
      identity,
      chart.id,
      now,
    );
  } catch {
    safeLog({ event: "pattern_stage_failed" });
    return c.json(
      errorBody(
        "pattern_invalidation_failed",
        "Pattern invalidation after chart correction did not complete",
      ),
      503,
    );
  }

  return c.json(
    {
      schema_version: SCHEMA_VERSION,
      workflow: BIRTH_JOB_TYPE,
      status: "succeeded",
      idempotency_key: idem,
      job_id: jobId,
      resource_id: chart.id,
      // What the chart was actually calculated in. A client that posted a hint
      // the coordinates overruled would otherwise never learn the substitution
      // happened, and would keep showing the user a zone nothing used.
      timezone: timezoneResponse,
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
