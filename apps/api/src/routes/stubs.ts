import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";

/** M2–M4 surfaces stubbed so OpenAPI routes resolve with honest 501s. */
export const stubRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function notImplemented(feature: string) {
  return {
    error: {
      code: "not_implemented",
      message: `${feature} lands in a later milestone`,
    },
  };
}

stubRoutes.get("/v1/readings/today", (c) =>
  c.json(notImplemented("Daily readings (M3)"), 501),
);
stubRoutes.get("/v1/readings/:id/evidence", (c) =>
  c.json(notImplemented("Reading evidence (M3)"), 501),
);
stubRoutes.post("/v1/readings/:id/feedback", (c) =>
  c.json(notImplemented("Reading feedback (M3)"), 501),
);
stubRoutes.get("/v1/pattern", (c) =>
  c.json(notImplemented("Your Pattern chapters (M3)"), 501),
);
stubRoutes.get("/v1/timing", (c) =>
  c.json(notImplemented("Timing cycles (M3)"), 501),
);
stubRoutes.get("/v1/time-travel", (c) =>
  c.json(notImplemented("Time Travel (M4)"), 501),
);
stubRoutes.post("/v1/check-ins", (c) =>
  c.json(notImplemented("Check-ins (M4)"), 501),
);
stubRoutes.get("/v1/context-sources", (c) =>
  c.json(notImplemented("Context sources (M4)"), 501),
);
stubRoutes.put("/v1/context-sources", (c) =>
  c.json(notImplemented("Context sources (M4)"), 501),
);
stubRoutes.post("/v1/exports", (c) =>
  c.json(notImplemented("Account export (M1 privacy skeleton follows)"), 501),
);
stubRoutes.delete("/v1/account", (c) =>
  c.json(notImplemented("Account deletion (M1 privacy skeleton follows)"), 501),
);
stubRoutes.post("/internal/content-releases", (c) =>
  c.json(notImplemented("Content release ingestion (M2)"), 501),
);
