import { Hono, type Context } from "hono";
import {
  M4_SCHEMA_VERSION,
  requireIdempotencyKey,
  type LifeEventRequest,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  createLifeEvent,
  deleteLifeEvent,
  listLifeEvents,
  normalizeLifeEventWindow,
  updateLifeEvent,
  type LifeEventMutationOutcome,
} from "../db/life-events.js";
import { safeLog } from "../services/safe-log.js";

export const lifeEventRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
type ApiContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const EVENT_ID_RE = /^evt_[0-9a-f]{32}$/;
const EVENT_KEYS = new Set([
  "schema_version",
  "start_date",
  "end_date",
  "precision",
  "category",
  "significance",
  "title",
  "note",
  "use_in_time_travel",
]);
const PRECISIONS = new Set(["day", "month", "year", "range"]);
const CATEGORIES = new Set([
  "education",
  "work",
  "home",
  "travel",
  "relationship",
  "family",
  "creative",
  "community",
  "health_context",
  "other",
]);
const SIGNIFICANCE = new Set(["low", "medium", "high"]);
const MAX_BODY_CHARS = 16 * 1024;

function errorBody(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function identity(c: ApiContext) {
  return {
    userId: c.get("userId") as string,
    cryptoSubject: c.get("cryptoSubject"),
  };
}

function parseLifeEvent(value: unknown): LifeEventRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== EVENT_KEYS.size ||
    Object.keys(body).some((key) => !EVENT_KEYS.has(key)) ||
    body.schema_version !== M4_SCHEMA_VERSION ||
    typeof body.start_date !== "string" ||
    (body.end_date !== null && typeof body.end_date !== "string") ||
    !PRECISIONS.has(body.precision as string) ||
    !CATEGORIES.has(body.category as string) ||
    !SIGNIFICANCE.has(body.significance as string) ||
    typeof body.title !== "string" || body.title.length < 1 || body.title.length > 160 ||
    (body.note !== null && typeof body.note !== "string") ||
    (typeof body.note === "string" && body.note.length > 2000) ||
    typeof body.use_in_time_travel !== "boolean"
  ) return null;
  const request = body as unknown as LifeEventRequest;
  return normalizeLifeEventWindow(request) ? request : null;
}

async function readRequest(c: ApiContext): Promise<LifeEventRequest | null> {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > MAX_BODY_CHARS) return null;
  try {
    return parseLifeEvent(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function mutationFailure(c: ApiContext, outcome: Extract<LifeEventMutationOutcome, { ok: false }>) {
  const requestId = c.get("requestId") as string;
  const messages: Record<typeof outcome.reason, string> = {
    idempotency_conflict: "Idempotency-Key was already used for a different life-event request",
    context_source_inactive: "Enable Life-event timeline in Privacy before saving",
    timezone_confirmation_required: "Confirm your time zone before saving a life event",
    invalid_life_event: "Life event must use a completed valid precision window",
    event_limit_reached: "The account already has 500 current life events",
    event_not_found: "Life event not found",
    event_deleted: "The life event associated with this replay was deleted",
    consent_conflict: "The life-event source or revision changed concurrently; retry the request",
  };
  const status = outcome.reason === "invalid_life_event"
    ? 400
    : outcome.reason === "event_not_found"
      ? 404
      : outcome.reason === "event_deleted"
        ? 410
        : 409;
  return c.json(errorBody(requestId, outcome.reason, messages[outcome.reason]), status);
}

lifeEventRoutes.get("/v1/life-events", async (c) => {
  const requestId = c.get("requestId");
  if ([...new URL(c.req.url).searchParams.keys()].length > 0) {
    return c.json(errorBody(requestId, "invalid_query", "Life-event listing accepts no query parameters"), 400);
  }
  try {
    const items = await listLifeEvents(c.env, identity(c));
    return c.json({ schema_version: M4_SCHEMA_VERSION, items }, 200);
  } catch {
    safeLog({ event: "life_event_list_integrity_failure" });
    return c.json(errorBody(requestId, "life_event_integrity_failure", "Saved life events could not be verified"), 500);
  }
});

lifeEventRoutes.post("/v1/life-events", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(errorBody(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"), 400);
  }
  const request = await readRequest(c);
  if (!request) {
    return c.json(errorBody(requestId, "invalid_life_event", "Request must match LifeEventRequest"), 400);
  }
  const outcome = await createLifeEvent(c.env, identity(c), key, request);
  return outcome.ok ? c.json(outcome.response, 201) : mutationFailure(c, outcome);
});

lifeEventRoutes.put("/v1/life-events/:id", async (c) => {
  const requestId = c.get("requestId");
  const eventId = c.req.param("id");
  if (!EVENT_ID_RE.test(eventId)) {
    return c.json(errorBody(requestId, "invalid_life_event_id", "Life-event ID is invalid"), 400);
  }
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(errorBody(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"), 400);
  }
  const request = await readRequest(c);
  if (!request) {
    return c.json(errorBody(requestId, "invalid_life_event", "Request must match LifeEventRequest"), 400);
  }
  const outcome = await updateLifeEvent(c.env, identity(c), eventId, key, request);
  return outcome.ok ? c.json(outcome.response, 200) : mutationFailure(c, outcome);
});

lifeEventRoutes.delete("/v1/life-events/:id", async (c) => {
  const requestId = c.get("requestId");
  const eventId = c.req.param("id");
  if (!EVENT_ID_RE.test(eventId)) {
    return c.json(errorBody(requestId, "invalid_life_event_id", "Life-event ID is invalid"), 400);
  }
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(errorBody(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"), 400);
  }
  const outcome = await deleteLifeEvent(c.env, identity(c), eventId, key);
  if (outcome.ok) return c.body(null, 204);
  const message = outcome.reason === "event_not_found"
    ? "Life event not found"
    : outcome.reason === "idempotency_conflict"
      ? "Idempotency-Key was already used to delete a different life event"
      : "The life-event revision changed concurrently; retry the request";
  return c.json(
    errorBody(requestId, outcome.reason, message),
    outcome.reason === "event_not_found" ? 404 : 409,
  );
});
