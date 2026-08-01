import { Hono } from "hono";
import { SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/health", (c) =>
  c.json({
    ok: true,
    service: "patternlike-api",
    schema_version: SCHEMA_VERSION,
    environment: c.env.ENVIRONMENT,
  }),
);

healthRoutes.get("/v1/meta", (c) =>
  c.json({
    schema_version: SCHEMA_VERSION,
    architecture_profile:
      "cloudflare-first-wordpress-editorial-fly-portable-v1",
    calc_service_configured: Boolean(c.env.CALC_SERVICE_URL),
    auth_stub: c.env.AUTH_STUB === "1",
  }),
);
