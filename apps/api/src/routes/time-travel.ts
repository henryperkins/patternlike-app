import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadPreferences } from "../db/preferences.js";
import { buildTimeTravelResponse, TimeTravelError } from "../services/time-travel.js";
import { safeLog } from "../services/safe-log.js";

export const timeTravelRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function queryDate(url: string): string | null {
  const params = new URL(url).searchParams;
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== "date" || params.getAll("date").length !== 1) return null;
  const value = params.get("date");
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

timeTravelRoutes.get("/v1/time-travel", async (c) => {
  const requestId = c.get("requestId");
  const date = queryDate(c.req.url);
  if (!date) {
    return c.json({ error: { code: "invalid_date", message: "Exactly one YYYY-MM-DD date is required", request_id: requestId } }, 400);
  }
  const preferences = await loadPreferences(c.env, c.get("userId"));
  if (!preferences || preferences.timezoneSource !== "user_confirmed") {
    return c.json({ error: {
      code: "timezone_confirmation_required",
      message: "Confirm a scheduling time zone before using Time Travel",
      request_id: requestId,
    } }, 409);
  }
  try {
    return c.json(await buildTimeTravelResponse(
      c.env,
      {
        userId: c.get("userId"),
        cryptoSubject: c.get("cryptoSubject"),
      },
      preferences.timezone,
      date,
    ), 200);
  } catch (failure) {
    if (!(failure instanceof TimeTravelError)) {
      safeLog({ event: "time_travel_unhandled_failure" });
      return c.json({ error: {
        code: "time_travel_integrity_failure",
        message: "Time Travel could not verify its reconstruction",
        request_id: requestId,
      } }, 500);
    }
    // Explicit, not `status >= 500`: the log union is closed on purpose, and a
    // future 5xx code added to TimeTravelError should fail this switch rather
    // than smuggle an unreviewed name into the console boundary.
    switch (failure.code) {
      case "calc_unavailable":
      case "time_travel_integrity_failure":
      case "time_travel_configuration_error":
        safeLog({ event: failure.code });
        break;
      default:
        break;
    }
    if (failure.retryAfterSeconds) c.header("Retry-After", String(failure.retryAfterSeconds));
    return c.json({ error: {
      code: failure.code,
      message: failure.message,
      request_id: requestId,
      ...(failure.details ? { details: failure.details } : {}),
    } }, failure.status);
  }
});
