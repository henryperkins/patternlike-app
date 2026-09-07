import { Hono } from "hono";
import { SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  readReleaseGitSha,
  readWorkerVersionId,
} from "../services/release-attestation.js";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/health", (c) =>
  c.json({
    ok: true,
    service: "patternlike-api",
    schema_version: SCHEMA_VERSION,
    environment: c.env.ENVIRONMENT,
  }),
);

/**
 * Deliberately outside configGuard, and that is what makes it useful here.
 *
 * A Worker deployed without a usable RELEASE_GIT_SHA answers 503 on every
 * guarded path, so release verification could not ask the deployment what it is.
 * This route can still answer, and answers null rather than echoing a
 * malformed value — so "absent" and "wrong shape" are the same visible failure
 * to the caller doing the verifying.
 */
healthRoutes.get("/v1/meta", (c) =>
  c.json({
    schema_version: SCHEMA_VERSION,
    architecture_profile:
      "cloudflare-first-wordpress-editorial-fly-portable-v1",
    calc_service_configured: Boolean(c.env.CALC_SERVICE_URL),
    auth_stub: c.env.AUTH_STUB === "1",
    release_git_sha: readReleaseGitSha(c.env),
    worker_version_id: readWorkerVersionId(c.env),
  }),
);
