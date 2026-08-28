import { Hono, type Context } from "hono";
import { M8_SCHEMA_VERSION } from "@patternlike/shared";

import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadGeocoderGrant } from "../db/consents.js";
import { storePlaceResolution } from "../db/place-resolutions.js";
import { createGeocoder, GEOCODER_TIMEOUT_MS } from "../services/geocoder/index.js";
import { safeLog } from "../services/safe-log.js";

export const placeRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

type PlaceContext = Context<{ Bindings: Env; Variables: AppVariables }>;

function errorBody(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function validLocale(value: unknown): value is string | null | undefined {
  return value === undefined || value === null ||
    (typeof value === "string" && value.length <= 64 &&
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value));
}

function validSessionToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 8 && value.length <= 128 &&
    /^[A-Za-z0-9._~-]+$/.test(value);
}

function parseSearch(value: unknown): { query: string; locale: string | null } | null {
  if (!isRecord(value) || !exactKeys(value, ["query", "locale", "session_token"])) {
    return null;
  }
  if (
    typeof value.query !== "string" ||
    value.query !== value.query.trim() ||
    [...value.query].length < 2 ||
    [...value.query].length > 120 ||
    !validLocale(value.locale) ||
    !validSessionToken(value.session_token)
  ) {
    return null;
  }
  return { query: value.query, locale: value.locale ?? null };
}

function parseResolve(value: unknown): { candidateId: string; locale: string | null } | null {
  if (!isRecord(value) || !exactKeys(value, ["candidate_id", "locale", "session_token"])) {
    return null;
  }
  if (
    typeof value.candidate_id !== "string" ||
    value.candidate_id.length < 1 ||
    value.candidate_id.length > 512 ||
    !validLocale(value.locale) ||
    !validSessionToken(value.session_token)
  ) {
    return null;
  }
  return { candidateId: value.candidate_id, locale: value.locale ?? null };
}

function unavailable(c: PlaceContext) {
  return c.json(
    errorBody(c.get("requestId"), "geocoder_unavailable", "Place search is unavailable"),
    503,
  );
}

async function providerPermission(c: PlaceContext): Promise<Response | null> {
  const grant = await loadGeocoderGrant(c.env, c.get("userId"));
  if (!grant) {
    return c.json(
      errorBody(
        c.get("requestId"),
        "geocoder_consent_required",
        "Current geocoder consent is required",
      ),
      403,
    );
  }
  const limited = await c.env.PLACE_SEARCH_RATE_LIMITER.limit({
    key: `${c.get("userId")}:places`,
  });
  if (!limited.success) {
    safeLog({
      event: "place_search_completed",
      outcome: "rate_limited",
      candidate_count: 0,
    });
    return c.json(
      errorBody(c.get("requestId"), "rate_limited", "Too many place requests"),
      429,
    );
  }
  return null;
}

placeRoutes.post("/v1/places/search", async (c) => {
  if (c.env.GEOCODER_ROLLOUT !== "enabled") return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorBody(c.get("requestId"), "invalid_json", "Request body must be valid JSON"), 400);
  }
  const request = parseSearch(body);
  if (!request) {
    return c.json(errorBody(c.get("requestId"), "invalid_body", "Place search request is invalid"), 400);
  }
  const denied = await providerPermission(c);
  if (denied) return denied;

  try {
    const candidates = await createGeocoder(c.env).search(
      request,
      AbortSignal.timeout(GEOCODER_TIMEOUT_MS),
    );
    safeLog({
      event: "place_search_completed",
      outcome: candidates.length === 0 ? "empty" : "success",
      candidate_count: candidates.length,
    });
    return c.json({ schema_version: M8_SCHEMA_VERSION, candidates }, 200);
  } catch {
    safeLog({
      event: "place_search_completed",
      outcome: "unavailable",
      candidate_count: 0,
    });
    return unavailable(c);
  }
});

placeRoutes.post("/v1/places/resolve", async (c) => {
  if (c.env.GEOCODER_ROLLOUT !== "enabled") return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorBody(c.get("requestId"), "invalid_json", "Request body must be valid JSON"), 400);
  }
  const request = parseResolve(body);
  if (!request) {
    return c.json(errorBody(c.get("requestId"), "invalid_body", "Place resolution request is invalid"), 400);
  }
  const denied = await providerPermission(c);
  if (denied) return denied;

  try {
    const resolved = await createGeocoder(c.env).resolve(
      request,
      AbortSignal.timeout(GEOCODER_TIMEOUT_MS),
    );
    const identity = {
      userId: c.get("userId"),
      cryptoSubject: c.get("cryptoSubject"),
    };
    const stored = await storePlaceResolution(c.env, identity, resolved);
    return c.json({
      schema_version: M8_SCHEMA_VERSION,
      place_id: stored.placeId,
      ...resolved,
    }, 200);
  } catch {
    return unavailable(c);
  }
});
