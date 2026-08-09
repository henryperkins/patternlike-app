import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  dispatch,
  enqueueDailyReading,
  enqueueReissue,
  replaceFailedCommand,
} from "../services/enqueue.js";
import { findExpiredLeases, findUndispatched } from "../db/generation.js";
import type {
  CommandReplacementReason,
  RevisionReason,
} from "../services/generation-command.js";

/**
 * Operator and scheduler entry points for daily-reading generation.
 *
 * Mounted under `/internal` behind the service token, never on the product API.
 * Until the cron trigger lands these are the only things that start generation,
 * and they are what the production smoke test drives: the runbook deploys the
 * Worker with no cron, proves initial generation, duplicate delivery, and an
 * explicit reissue through these routes, and only then enables the schedule.
 */
export const internalGenerationRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

const REISSUE_REASONS: readonly RevisionReason[] = [
  "chart_recalculated",
  "consent_revoked",
  "safety_correction",
  "defect_repair",
];

const REPLACEMENT_REASONS: readonly CommandReplacementReason[] = [
  "calc_unavailable",
  "release_unreadable",
  "context_minimized",
  "policy_upgraded",
  "defect_repair",
];

/**
 * Enqueue failures that are the caller's fault versus the deployment's.
 *
 * `duplicate` is 200, not an error: a scheduler that re-runs a day it already
 * reserved has succeeded at what it was asked to do.
 */
const CLIENT_ERROR_REASONS = new Set([
  "timezone_confirmation_required",
  "locale_confirmation_required",
  "chart_not_found",
  "release_not_active",
  "stale_predecessor",
  "not_replaceable",
  "budget_exhausted",
  "day_too_old",
  "stale_job",
]);

function statusFor(reason: string): 409 | 424 | 503 {
  if (CLIENT_ERROR_REASONS.has(reason)) return 409;
  if (reason === "calc_unavailable" || reason === "release_unreadable") return 503;
  return 424;
}

async function readJson(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

internalGenerationRoutes.post("/readings/generate", async (c) => {
  const requestId = c.get("requestId");
  const body = await readJson(c);
  const userId = typeof body?.user_id === "string" ? body.user_id : null;
  if (!userId) {
    return c.json(
      { error: { code: "invalid_body", message: "user_id is required", request_id: requestId } },
      400,
    );
  }

  const result = await enqueueDailyReading(c.env, userId);
  if (!result.ok) {
    if (result.reason === "duplicate") {
      return c.json({ status: "duplicate", detail: result.detail }, 200);
    }
    return c.json(
      { error: { code: result.reason, message: result.detail, request_id: requestId } },
      statusFor(result.reason),
    );
  }
  return c.json(
    {
      status: "reserved",
      reading_id: result.readingId,
      job_id: result.jobId,
      dispatched: result.dispatched,
    },
    202,
  );
});

internalGenerationRoutes.post("/readings/reissue", async (c) => {
  const requestId = c.get("requestId");
  const body = await readJson(c);
  const userId = typeof body?.user_id === "string" ? body.user_id : null;
  const expected =
    typeof body?.expected_live_reading_id === "string" ? body.expected_live_reading_id : null;
  const reason = body?.revision_reason as RevisionReason | undefined;

  if (!userId || !expected || !reason || !REISSUE_REASONS.includes(reason)) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: `user_id, expected_live_reading_id, and a revision_reason of ${REISSUE_REASONS.join(", ")} are required`,
          request_id: requestId,
        },
      },
      400,
    );
  }

  const result = await enqueueReissue(
    c.env,
    userId,
    expected,
    reason as Exclude<RevisionReason, "initial">,
  );
  if (!result.ok) {
    return c.json(
      { error: { code: result.reason, message: result.detail, request_id: requestId } },
      statusFor(result.reason),
    );
  }
  return c.json(
    {
      status: "reserved",
      reading_id: result.readingId,
      job_id: result.jobId,
      dispatched: result.dispatched,
    },
    202,
  );
});

internalGenerationRoutes.post("/readings/replace", async (c) => {
  const requestId = c.get("requestId");
  const body = await readJson(c);
  const userId = typeof body?.user_id === "string" ? body.user_id : null;
  const readingId = typeof body?.reading_id === "string" ? body.reading_id : null;
  const reason = body?.reason as CommandReplacementReason | undefined;
  const actor = body?.actor === "scheduler" ? "scheduler" : "operator";

  if (!userId || !readingId || !reason || !REPLACEMENT_REASONS.includes(reason)) {
    return c.json(
      {
        error: {
          code: "invalid_body",
          message: `user_id, reading_id, and a reason of ${REPLACEMENT_REASONS.join(", ")} are required`,
          request_id: requestId,
        },
      },
      400,
    );
  }

  const result = await replaceFailedCommand(c.env, userId, readingId, reason, actor);
  if (!result.ok) {
    return c.json(
      { error: { code: result.reason, message: result.detail, request_id: requestId } },
      statusFor(result.reason),
    );
  }
  return c.json(
    {
      status: "replaced",
      reading_id: result.readingId,
      job_id: result.jobId,
      dispatched: result.dispatched,
    },
    202,
  );
});

/**
 * Re-send what the outbox committed but never dispatched, and re-offer claims
 * whose lease expired.
 *
 * Both may produce a duplicate delivery, which is exactly what the claim CAS
 * exists to absorb. The cron trigger that calls this on a schedule is Phase 7;
 * today it is driven by hand.
 */
internalGenerationRoutes.post("/readings/sweep", async (c) => {
  const undispatched = await findUndispatched(c.env);
  const expired = await findExpiredLeases(c.env);

  let sent = 0;
  for (const candidate of [...undispatched, ...expired]) {
    if (!candidate.reading_id) continue;
    if (await dispatch(c.env, { job_id: candidate.id, reading_id: candidate.reading_id })) {
      sent++;
    }
  }

  return c.json(
    {
      status: "swept",
      undispatched: undispatched.length,
      expired_leases: expired.length,
      redispatched: sent,
    },
    200,
  );
});
