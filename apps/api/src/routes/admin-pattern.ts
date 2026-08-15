import { Hono } from "hono";
import { contentHash, newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";

export const adminPatternRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function error(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

async function requireAdmin(c: { env: Env; req: { header: (name: string) => string | undefined }; get: (key: "requestId") => string }) {
  const requestId = c.get("requestId") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
  const expected = c.env.PATTERN_ADMIN_TOKEN;
  if (!expected) {
    if (c.env.ENVIRONMENT === "development" || c.env.AUTH_STUB === "1") return null;
    return { response: { body: error(requestId, "admin_auth_not_configured", "PATTERN_ADMIN_TOKEN missing"), status: 503 as const } };
  }
  if (c.req.header("authorization") !== `Bearer ${expected}`) {
    return { response: { body: error(requestId, "unauthorized", "Invalid administrator token"), status: 401 as const } };
  }
  return null;
}

async function adminScopeHash(generationId: string): Promise<string> {
  return contentHash(`patternlike.pattern-admin-scope.v1|${generationId}`);
}

async function recordAccess(
  env: Env,
  generationId: string,
  userId: string | null,
  artifactClasses: string[],
  result: "granted" | "denied" | "not_found" | "expired",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pattern_admin_access_events
       (id, admin_subject, target_user_id, target_scope_hash, generation_id, purpose_class,
        artifact_classes_json, result, created_at)
     VALUES (?, ?, ?, ?, ?, 'quality_review', ?, ?, ?)`,
  )
    .bind(
      newId("paae"),
      "admin",
      userId,
      await adminScopeHash(generationId),
      generationId,
      JSON.stringify(artifactClasses),
      result,
      new Date().toISOString(),
    )
    .run();
}

adminPatternRoutes.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const denied = await requireAdmin(c);
  if (denied) return c.json(denied.response.body, denied.response.status);
  await next();
});

adminPatternRoutes.get("/pattern-generations/:generation_id", async (c) => {
  const requestId = c.get("requestId");
  const generationId = c.req.param("generation_id");
  const job = await c.env.DB.prepare(
    `SELECT generation_id, user_id, stage, plan_hash, candidate_hash, ontology_version, created_at
     FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<{
      generation_id: string;
      user_id: string;
      stage: string;
      plan_hash: string | null;
      candidate_hash: string | null;
      ontology_version: string;
      created_at: string;
    }>();
  if (!job) {
    await recordAccess(c.env, generationId, null, ["inventory"], "not_found");
    return c.json(error(requestId, "not_found", "Generation not found"), 404);
  }
  await recordAccess(c.env, generationId, job.user_id, ["inventory"], "granted");
  return c.json({ schema_version: "0.7.0", generation: job }, 200);
});

adminPatternRoutes.get("/pattern-generations/:generation_id/artifacts", async (c) => {
  const requestId = c.get("requestId");
  const generationId = c.req.param("generation_id");
  const job = await c.env.DB.prepare(
    `SELECT generation_id, user_id FROM pattern_generation_jobs WHERE generation_id = ?`,
  )
    .bind(generationId)
    .first<{ generation_id: string; user_id: string }>();
  if (!job) {
    await recordAccess(c.env, generationId, null, ["inventory"], "not_found");
    return c.json(error(requestId, "not_found", "Generation not found"), 404);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, artifact_class, created_at, expires_at, deleted_at
     FROM pattern_generation_artifacts WHERE generation_id = ? ORDER BY created_at`,
  )
    .bind(generationId)
    .all<{ artifact_class: string }>();
  const classes = [...new Set(results.map((row) => row.artifact_class))];
  await recordAccess(c.env, generationId, job.user_id, classes.length > 0 ? classes : ["inventory"], "granted");
  return c.json({ schema_version: "0.7.0", artifacts: results }, 200);
});
