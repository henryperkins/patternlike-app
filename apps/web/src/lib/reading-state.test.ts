import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client.js";
import { classifyTodayError, type TodayFailure } from "./reading-state.js";

/**
 * The classifier decides which Today screen a failure gets, and — new in v5 —
 * whether that screen is allowed to offer a retry.
 *
 * The retry question is the one worth pinning. Three v5 failures answer 503 and
 * only one of them improves by asking again, so a screen that inferred
 * "retryable" from the status would put a button in front of an exhausted
 * provider budget that can only fail until tomorrow.
 */
function apiError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(status, {
    error: { code, message: `message for ${code}`, request_id: `req_${code}`, ...extra },
  } as never);
}

describe("classifyTodayError", () => {
  it("routes the AI-synthesis gate to its own screen", () => {
    const failure = classifyTodayError(
      apiError(409, "ai_synthesis_consent_required"),
    );

    expect(failure).toEqual<TodayFailure>({
      kind: "needs_ai_consent",
      requestId: "req_ai_synthesis_consent_required",
    });
  });

  it.each([
    { code: "timezone_confirmation_required", preference: "timezone" as const },
    { code: "locale_confirmation_required", preference: "locale" as const },
  ])("keeps the $preference gate on its own form", ({ code, preference }) => {
    expect(classifyTodayError(apiError(409, code))).toEqual<TodayFailure>({
      kind: "needs_preference",
      preference,
      requestId: `req_${code}`,
    });
  });

  it.each([
    {
      label: "a retryable calculation outage",
      status: 503,
      code: "calc_unavailable",
      envelope: { retryable: true },
      retryable: true,
    },
    {
      label: "an exhausted provider budget",
      status: 503,
      code: "publisher_budget_exhausted",
      envelope: { retryable: false },
      retryable: false,
    },
    {
      label: "an unconfigured publisher",
      status: 503,
      code: "publisher_not_configured",
      envelope: { retryable: false },
      retryable: false,
    },
    {
      label: "an exhausted generation",
      status: 424,
      code: "reading_generation_failed",
      envelope: { retryable: false },
      retryable: false,
    },
  ])("takes retryability from the envelope for $label", (row) => {
    const failure = classifyTodayError(apiError(row.status, row.code, row.envelope));

    expect(failure).toMatchObject({ kind: "error", retryable: row.retryable });
  });

  it("treats a 424 without the flag as terminal, and any other status as retryable", () => {
    // Only the v5 envelope carries `retryable`. A v3 503 predates the flag and
    // is worth one more press; an exhausted generation never is, whoever
    // answered it.
    expect(classifyTodayError(apiError(424, "reading_generation_failed"))).toMatchObject({
      retryable: false,
    });
    expect(classifyTodayError(apiError(503, "release_unreadable"))).toMatchObject({
      retryable: true,
    });
  });

  it("treats a transport failure as retryable", () => {
    expect(
      classifyTodayError(new Error("The Pattern/Like API could not be reached.")),
    ).toEqual<TodayFailure>({
      kind: "error",
      message: "The Pattern/Like API could not be reached.",
      requestId: null,
      retryable: true,
    });
  });

  it("still escalates a 401 rather than rendering a failure", () => {
    expect(classifyTodayError(apiError(401, "unauthorized"))).toEqual<TodayFailure>({
      kind: "unauthorized",
    });
  });
});
