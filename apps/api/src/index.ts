import { Hono } from "hono";
import type { Env } from "./env.js";
import { authenticate, serviceAuth, type AppVariables } from "./middleware/auth.js";
import { configGuard } from "./middleware/config-guard.js";
import { healthRoutes } from "./routes/health.js";
import { birthRoutes } from "./routes/birth.js";
import { chartRoutes } from "./routes/chart.js";
import { timezoneRoutes } from "./routes/timezone.js";
import { stubRoutes } from "./routes/stubs.js";
import { contentReleaseRoutes } from "./routes/content-releases.js";
import { sessionRoutes } from "./routes/sessions.js";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.route("/", healthRoutes);

// Session exchange is unauthenticated by necessity — it is what mints the
// session everything else requires — but still config-guarded.
//
// configGuard is attached to the two session paths directly rather than via a
// sub-app with use("*", ...) routed at "/". That sub-app pattern is exactly the
// defect the /internal mount fix removed: a router mounted at "/" contributes
// its wildcard middleware to EVERY path in the parent.
app.use("/v1/sessions", configGuard);
app.use("/v1/sessions/*", configGuard);
app.route("/", sessionRoutes);

// Authenticated product API. configGuard runs first so no surface serves on a
// development-shaped configuration in a non-development environment.
const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();
api.use("*", configGuard);
api.use("*", authenticate);
api.route("/", birthRoutes);
api.route("/", chartRoutes);
api.route("/", timezoneRoutes);
api.route("/", stubRoutes);

// Internal service-to-service API, behind the service token rather than the
// consumer auth stub. Paths inside these routers are relative to the /internal
// mount prefix below, not absolute.
const internal = new Hono<{ Bindings: Env; Variables: AppVariables }>();
internal.use("*", configGuard);
internal.use("*", serviceAuth);
internal.route("/", contentReleaseRoutes);

// Mounted under a prefix, not "/". A sub-app routed at "/" contributes its
// `use("*", ...)` middleware to every path in the parent.
app.route("/internal", internal);
app.route("/", api);

// Without this, Hono's default handler returns 500 as text/plain, so the
// documented error envelope never appeared on any uncaught path.
app.onError((err, c) => {
  const requestId =
    c.get("requestId") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
  // Log the detail; never return it. Upstream messages have carried the
  // calculation service's absolute filesystem path.
  console.error("unhandled_error", {
    request_id: requestId,
    path: c.req.path,
    method: c.req.method,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        request_id: requestId,
      },
    },
    500,
  );
});

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: c.get("requestId") ?? c.req.header("x-request-id") ?? null,
      },
    },
    404,
  ),
);

export default app;
