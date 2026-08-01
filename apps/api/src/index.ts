import { Hono } from "hono";
import type { Env } from "./env.js";
import { authStub, type AppVariables } from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";
import { birthRoutes } from "./routes/birth.js";
import { chartRoutes } from "./routes/chart.js";
import { stubRoutes } from "./routes/stubs.js";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.route("/", healthRoutes);

// Authenticated product API
const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();
api.use("*", authStub);
api.route("/", birthRoutes);
api.route("/", chartRoutes);
api.route("/", stubRoutes);

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
