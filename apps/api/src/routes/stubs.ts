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

// `/v1/readings/today`, `/v1/readings/:id/evidence`, and
// `/v1/readings/:id/feedback` are served by routes/readings.ts. Feedback is a
// first-party write that does not feed the deterministic ranker:
// `resonance_feedback` stays out of the ranking vocabulary. The constrained
// compiler may pin it for repetition_control and theme_ranking only after the
// writer has created the USR-12 source grant.
// `/v1/pattern` and `/v1/time-travel` are served by routes/pattern.ts and
// routes/time-travel.ts. Their stubs are gone rather than shadowed: this router
// is mounted last, so a registration a real route already answers can never be
// reached, and leaving one here would read as a live rollback path that does
// not exist.
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
