import { Hono, type Context } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadReadingFeedbackOptions, parseReadingFeedbackEventRequest, storeReadingFeedbackEvent } from "../db/reading-feedback-events.js";

export const feedbackEventRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type FeedbackContext = Context<{ Bindings: Env; Variables: AppVariables }>;
const identity = (c: FeedbackContext) => ({ userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") });
const error = (c: FeedbackContext, code: string, message: string) => ({ error: { code, message, request_id: c.get("requestId") } });
const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);

feedbackEventRoutes.get("/v1/readings/:id/feedback-options", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const params = new URL(c.req.url).searchParams;
  const revision = params.get("revision") ?? "";
  const paragraphId = params.get("paragraph_id");
  if (!validId(c.req.param("id")) || params.getAll("revision").length !== 1 || !/^[1-9][0-9]{0,9}$/.test(revision) ||
    Number(revision) > 2_147_483_647 || params.getAll("paragraph_id").length > 1 || (paragraphId !== null && !validId(paragraphId)) ||
    [...params.keys()].some((key) => !["revision", "paragraph_id"].includes(key))) {
    return c.json(error(c, "invalid_feedback_query", "Feedback coordinates are invalid"), 400);
  }
  const options = await loadReadingFeedbackOptions(c.env, identity(c), c.req.param("id"), Number(revision), paragraphId);
  return options ? c.json(options) : c.json(error(c, "reading_not_found", "This reading passage is unavailable"), 404);
});

feedbackEventRoutes.post("/v1/readings/:id/feedback-events", async (c) => {
  c.header("Cache-Control", "private, no-store");
  let value: unknown;
  try { value = await c.req.json(); } catch { value = null; }
  const request = parseReadingFeedbackEventRequest(value);
  if (!request || !validId(c.req.param("id"))) return c.json(error(c, "invalid_body", "Feedback request is invalid"), 400);
  const outcome = await storeReadingFeedbackEvent(c.env, identity(c), c.req.param("id"), c.req.header("idempotency-key") ?? null, request);
  if (outcome.ok) return c.json(outcome.receipt, 201);
  const status = outcome.reason === "missing_idempotency_key" ? 400 : outcome.reason === "reading_not_found" ? 404 : 409;
  return c.json(error(c, outcome.reason, outcome.reason === "feedback_use_changed"
    ? "Feedback use changed. Review the current explanation before submitting again."
    : outcome.reason === "reading_not_found" ? "This reading passage is unavailable"
      : outcome.reason === "idempotency_conflict" ? "This request key already names another response" : "Idempotency-Key header required"), status);
});
