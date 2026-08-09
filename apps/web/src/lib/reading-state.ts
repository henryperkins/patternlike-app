import { ApiError } from "./api-client.js";
import { isNotImplemented } from "./api-status.js";

/**
 * What went wrong on Today, in the terms the screen has an answer for.
 *
 * `unauthorized` is a classification rather than a rendered state: a 401 has a
 * screen already — the signed-out one — and rendering "Unreachable" for it would
 * be a lie about a state the app knows how to handle. The caller escalates it
 * instead of setting state.
 */
export type TodayFailure =
  | { kind: "unauthorized" }
  | { kind: "needs_onboarding"; requestId: string | null }
  | { kind: "needs_preference"; preference: "timezone" | "locale"; requestId: string | null }
  | { kind: "not_implemented"; requestId: string | null }
  | { kind: "error"; message: string; requestId: string | null };

/**
 * Neither 404 code nor either 409 code is assumed to exhaust its status: an
 * unrecognised code of either falls through to the generic error branch with the
 * server's own message, rather than being silently rendered as the wrong screen.
 */
export function classifyTodayError(error: unknown): TodayFailure {
  // Checked first because it requires both the 501 and the code, and because a
  // roadmap answer must never be offered a retry.
  if (isNotImplemented(error)) {
    return { kind: "not_implemented", requestId: error.requestId };
  }

  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "unauthorized" };

    if (error.status === 404) {
      if (error.code === "chart_not_found") {
        return { kind: "needs_onboarding", requestId: error.requestId };
      }
    }

    if (error.status === 409) {
      if (error.code === "timezone_confirmation_required") {
        return { kind: "needs_preference", preference: "timezone", requestId: error.requestId };
      }
      if (error.code === "locale_confirmation_required") {
        return { kind: "needs_preference", preference: "locale", requestId: error.requestId };
      }
    }

    return { kind: "error", message: error.message, requestId: error.requestId };
  }

  return {
    kind: "error",
    // Where "The Pattern/Like API could not be reached." arrives from.
    message: error instanceof Error ? error.message : "Today could not load in this session.",
    requestId: null,
  };
}
