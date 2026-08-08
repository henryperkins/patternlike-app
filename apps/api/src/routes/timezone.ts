import { Hono } from "hono";
import {
  SCHEMA_VERSION,
  TZDB_STABLE_FROM_YEAR,
  isValidIanaZone,
  type TimezoneLookupRequest,
  type TimezoneLookupResponse,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { resolveTimezone } from "../services/timezone.js";

export const timezoneRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

/**
 * Resolve a birthplace to the timezone a chart would actually be calculated in,
 * without creating anything.
 *
 * POST rather than GET because the body carries a birth date and time. Those
 * are the values the rest of this API encrypts at rest; putting them in a query
 * string would write them to every access log and proxy cache between the
 * browser and the Worker. Nothing here is stored, and no `Idempotency-Key` is
 * required — the request has no effect to repeat.
 *
 * The answer is the same one `POST /v1/birth-profiles` will reach from the same
 * inputs, so the onboarding form can show the user the zone before they commit
 * to it rather than asking them to vouch for a value the browser guessed.
 */
timezoneRoutes.post("/v1/timezone-lookup", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  let body: TimezoneLookupRequest;
  try {
    body = (await c.req.json()) as TimezoneLookupRequest;
  } catch {
    return c.json(errorBody("invalid_json", "Request body must be valid JSON"), 400);
  }
  if (body === null || typeof body !== "object") {
    return c.json(errorBody("invalid_body", "Request body must be a JSON object"), 400);
  }

  const hasLat = body.latitude !== null && body.latitude !== undefined;
  const hasLon = body.longitude !== null && body.longitude !== undefined;
  if (hasLat !== hasLon) {
    return c.json(
      errorBody("invalid_body", "latitude and longitude must be supplied together"),
      400,
    );
  }
  if (hasLat) {
    if (typeof body.latitude !== "number" || !Number.isFinite(body.latitude)) {
      return c.json(errorBody("invalid_body", "latitude must be a finite number"), 400);
    }
    if (typeof body.longitude !== "number" || !Number.isFinite(body.longitude)) {
      return c.json(errorBody("invalid_body", "longitude must be a finite number"), 400);
    }
    if (body.latitude < -90 || body.latitude > 90) {
      return c.json(errorBody("invalid_body", "latitude out of range (expected -90..90)"), 400);
    }
    if (body.longitude < -180 || body.longitude > 180) {
      return c.json(
        errorBody("invalid_body", "longitude out of range (expected -180..180)"),
        400,
      );
    }
  }

  const hint =
    typeof body.timezone_hint === "string" && body.timezone_hint.trim()
      ? body.timezone_hint.trim()
      : null;
  if (hint && !isValidIanaZone(hint)) {
    return c.json(
      errorBody(
        "invalid_body",
        `timezone_hint must be an IANA zone id such as America/New_York (got ${hint})`,
      ),
      400,
    );
  }

  // Without either signal there is nothing to resolve, and answering "UTC"
  // would look like a lookup rather than the absence of one.
  if (!hasLat && !hint) {
    return c.json(
      errorBody(
        "invalid_body",
        "Supply birthplace coordinates, a timezone_hint, or both",
      ),
      400,
    );
  }

  const resolution = resolveTimezone({
    latitude: hasLat ? (body.latitude as number) : null,
    longitude: hasLon ? (body.longitude as number) : null,
    birthDate: body.birth_date ?? null,
    birthTimeLocal: body.birth_time_local ?? null,
    timezoneHint: hint,
  });

  const response: TimezoneLookupResponse = {
    schema_version: SCHEMA_VERSION,
    timezone: resolution.timezone,
    source: resolution.source,
    confidence: resolution.confidence,
    boundary_nearby: resolution.boundaryNearby,
    hint_overridden: resolution.hintOverridden,
    tzdb_stable_from_year: TZDB_STABLE_FROM_YEAR,
    local: resolution.local,
    qualifiers: resolution.qualifiers,
  };

  return c.json(response, 200);
});
