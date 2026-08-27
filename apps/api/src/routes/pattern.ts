import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { serveGeneratedPattern } from "./pattern-ai.js";

export const patternRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * `GET /v1/pattern` is the generated Pattern reader for every authenticated
 * account.
 *
 * The M4 editorial catalogue is preserved data, not a product path: releases
 * still ingest, still verify, and still appear in an account export. What was
 * removed is the admission decision that could route a reader onto them —
 * matching approved chapters is no longer an outcome this route can produce,
 * so the paginated M4 contract (its cursor, its `limit`, its omission counters)
 * has no caller and is gone with it.
 */
patternRoutes.get("/v1/pattern", async (c) =>
  serveGeneratedPattern(
    c.env,
    c.get("userId"),
    c.get("cryptoSubject"),
    c.get("requestId"),
    c.req.url,
  ));
