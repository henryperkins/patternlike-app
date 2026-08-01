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

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    },
    404,
  ),
);

export default app;
