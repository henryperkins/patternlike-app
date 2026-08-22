import { Hono, type Context } from "hono";

import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  applyPatternReplayReplica,
  PatternReplayLedgerError,
} from "../services/pattern-replay-ledger.js";

export const internalPatternReplayRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function routeError(
  requestId: string,
  code: string,
  message: string,
) {
  return { error: { code, message, request_id: requestId } };
}

async function applyReplica(c: Context<{
  Bindings: Env;
  Variables: AppVariables;
}>) {
  const requestId = c.get("requestId");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      routeError(requestId, "invalid_request", "Request body must be an empty JSON object"),
      400,
    );
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  ) {
    return c.json(
      routeError(requestId, "invalid_request", "Request body must be an empty JSON object"),
      400,
    );
  }

  try {
    const result = await applyPatternReplayReplica(c.env);
    return c.json({
      ...result,
      completed_at: new Date().toISOString(),
    }, 200);
  } catch (error) {
    const unavailable = error instanceof PatternReplayLedgerError &&
      (error.code === "replay_replica_unavailable" ||
        error.code === "replay_event_apply_unavailable");
    return c.json(
      routeError(
        requestId,
        unavailable ? "replay_replica_unavailable" : "replay_replica_invalid",
        unavailable
          ? "Pattern erasure replay is temporarily unavailable"
          : "Pattern erasure replay verification failed",
      ),
      unavailable ? 503 : 409,
    );
  }
}

internalPatternReplayRoutes.post(
  "/pattern-erasure-replay/apply",
  applyReplica,
);

internalPatternReplayRoutes.post(
  "/pattern-erasure-replay/sweep",
  applyReplica,
);
