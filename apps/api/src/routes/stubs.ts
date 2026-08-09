import { Hono, type Context } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";

/** M2–M4 surfaces stubbed so OpenAPI routes resolve with honest 501s. */
export const stubRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

type StubContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/**
 * Every other error producer in the Worker (auth, config-guard, chart, birth,
 * sessions, onError, notFound) carries `request_id`. These stubs were the sole
 * exception, so the clients that surface "(Request <id>)" to a user had nothing
 * to print on any 501 and support had no thread to pull.
 */
function notImplemented(c: StubContext, feature: string) {
  return c.json(
    {
      error: {
        code: "not_implemented",
        message: `${feature} lands in a later milestone`,
        request_id: c.get("requestId") ?? c.req.header("x-request-id") ?? null,
      },
    },
    501,
  );
}

// `/v1/readings/today` and `/v1/readings/:id/evidence` are served by
// routes/readings.ts. Feedback stays here: M3 documents it as 501 on purpose,
// and `resonance_feedback` was removed from the ranking vocabulary, so there is
// nowhere for an engagement signal to land even if it were collected.
stubRoutes.post("/v1/readings/:id/feedback", (c) =>
  notImplemented(c, "Reading feedback (M3)"),
);
stubRoutes.get("/v1/pattern", (c) =>
  notImplemented(c, "Your Pattern chapters (M3)"),
);
stubRoutes.get("/v1/timing", (c) => notImplemented(c, "Timing cycles (M3)"));
stubRoutes.get("/v1/time-travel", (c) => notImplemented(c, "Time Travel (M4)"));
stubRoutes.post("/v1/check-ins", (c) => notImplemented(c, "Check-ins (M4)"));
stubRoutes.get("/v1/context-sources", (c) =>
  notImplemented(c, "Context sources (M4)"),
);
stubRoutes.put("/v1/context-sources", (c) =>
  notImplemented(c, "Context sources (M4)"),
);
stubRoutes.post("/v1/exports", (c) =>
  notImplemented(c, "Account export (M1 privacy skeleton follows)"),
);
stubRoutes.delete("/v1/account", (c) =>
  notImplemented(c, "Account deletion (M1 privacy skeleton follows)"),
);
