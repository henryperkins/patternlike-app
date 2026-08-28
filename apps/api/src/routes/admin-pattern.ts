import { Hono } from "hono";
import { contentHash, newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadUserIdentity } from "../db/users.js";
import { readVerifiedOntologyRelease } from "../db/pattern-ontology.js";
import { getArtifactById } from "../services/pattern-execute.js";

export const adminPatternRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const ADMIN_PURPOSES = new Set([
  "quality_review",
  "safety_investigation",
  "incident_response",
  "retention_audit",
] as const);

type AdminPurpose = AppVariables["adminPurpose"];

const INSPECTABLE_ARTIFACT_CLASSES = [
  "fact_packet",
  "planner_request",
  "planner_response",
  "validated_plan",
  "writer_request",
  "writer_response",
  "rejected_candidate",
  "candidate_validation",
  "correction_document",
  "verifier_request",
  "verifier_response",
  "semantic_verdict",
  "accepted_internal_document",
] as const;

function error(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

async function adminScopeHash(generationId: string): Promise<string> {
  return contentHash(`patternlike.pattern-admin-scope.v1|${generationId}`);
}

async function recordAccess(
  env: Env,
  generationId: string,
  userId: string | null,
  artifactClasses: readonly string[],
  result: "granted" | "denied" | "not_found" | "expired",
  adminSubject: string,
  purpose: AdminPurpose,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pattern_admin_access_events
       (id, admin_subject, target_user_id, target_scope_hash, generation_id, purpose_class,
        artifact_classes_json, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId("paae"),
      adminSubject,
      userId,
      await adminScopeHash(generationId),
      generationId,
      purpose,
      JSON.stringify(artifactClasses),
      result,
      new Date().toISOString(),
    )
    .run();
}

adminPatternRoutes.use("*", async (c, next) => {
  const requestId = c.get("requestId");
  const query = new URL(c.req.url).searchParams;
  const purposes = query.getAll("purpose");
  const purpose = purposes[0];
  if (
    purposes.length !== 1 ||
    !purpose ||
    !ADMIN_PURPOSES.has(purpose as AdminPurpose)
  ) {
    return c.json(
      error(
        requestId,
        "invalid_admin_purpose",
        "A single supported administrator purpose is required",
      ),
      400,
    );
  }
  c.set("adminPurpose", purpose as AdminPurpose);
  await next();
});

adminPatternRoutes.get("/pattern-generations/:generation_id", async (c) => {
  const requestId = c.get("requestId");
  const generationId = c.req.param("generation_id");
  const now = new Date().toISOString();
  const job = await c.env.DB.prepare(
    `SELECT j.generation_id, j.user_id, j.stage, j.plan_hash,
            j.candidate_hash, j.ontology_version, j.created_at,
            (SELECT COUNT(*) FROM pattern_generation_artifacts a
             WHERE a.generation_id = j.generation_id) AS artifact_count,
            EXISTS (
              SELECT 1 FROM pattern_generation_artifacts a
              WHERE a.generation_id = j.generation_id
                AND a.deleted_at IS NULL
                AND a.expires_at > ?
            ) AS exact_artifacts_retained
     FROM pattern_generation_jobs j WHERE j.generation_id = ?`,
  )
    .bind(now, generationId)
    .first<{
      generation_id: string;
      user_id: string;
      stage: string;
      plan_hash: string | null;
      candidate_hash: string | null;
      ontology_version: string;
      created_at: string;
      artifact_count: number;
      exact_artifacts_retained: number;
    }>();
  if (!job) {
    await recordAccess(
      c.env,
      generationId,
      null,
      INSPECTABLE_ARTIFACT_CLASSES,
      "not_found",
      c.get("adminSubject"),
      c.get("adminPurpose"),
    );
    return c.json(error(requestId, "not_found", "Generation not found"), 404);
  }
  await recordAccess(
    c.env,
    generationId,
    job.user_id,
    INSPECTABLE_ARTIFACT_CLASSES,
    "granted",
    c.get("adminSubject"),
    c.get("adminPurpose"),
  );
  return c.json({
    schema_version: "0.7.0",
    generation_id: job.generation_id,
    stage: job.stage,
    created_at: job.created_at,
    ontology_version: job.ontology_version,
    plan_hash: job.plan_hash,
    candidate_hash: job.candidate_hash,
    artifact_count: job.artifact_count,
    exact_artifacts_retained: job.exact_artifacts_retained === 1,
  }, 200);
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
    await recordAccess(
      c.env,
      generationId,
      null,
      INSPECTABLE_ARTIFACT_CLASSES,
      "not_found",
      c.get("adminSubject"),
      c.get("adminPurpose"),
    );
    return c.json(error(requestId, "not_found", "Generation not found"), 404);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, artifact_class, created_at, expires_at, deleted_at
     FROM pattern_generation_artifacts WHERE generation_id = ? ORDER BY created_at`,
  )
    .bind(generationId)
    .all<{
      id: string;
      artifact_class: string;
      created_at: string;
      expires_at: string;
      deleted_at: string | null;
    }>();
  const classes = [...new Set(results.map((row) => row.artifact_class))];
  await recordAccess(
    c.env,
    generationId,
    job.user_id,
    classes.length > 0 ? classes : INSPECTABLE_ARTIFACT_CLASSES,
    "granted",
    c.get("adminSubject"),
    c.get("adminPurpose"),
  );
  return c.json({
    schema_version: "0.7.0",
    generation_id: generationId,
    artifacts: results.map((row) => ({
      artifact_id: row.id,
      artifact_class: row.artifact_class,
      created_at: row.created_at,
      expires_at: row.expires_at,
      deleted_at: row.deleted_at,
    })),
  }, 200);
});

adminPatternRoutes.get(
  "/pattern-generations/:generation_id/artifacts/:artifact_id",
  async (c) => {
    const requestId = c.get("requestId");
    const generationId = c.req.param("generation_id");
    const artifactId = c.req.param("artifact_id");
    const row = await c.env.DB.prepare(
      `SELECT a.id, a.user_id, a.artifact_class, a.created_at, a.expires_at,
              a.deleted_at
       FROM pattern_generation_artifacts a
       WHERE a.generation_id = ? AND a.id = ?`,
    )
      .bind(generationId, artifactId)
      .first<{
        id: string;
        user_id: string;
        artifact_class: string;
        created_at: string;
        expires_at: string;
        deleted_at: string | null;
      }>();
    if (!row) {
      await recordAccess(
        c.env,
        generationId,
        null,
        INSPECTABLE_ARTIFACT_CLASSES,
        "not_found",
        c.get("adminSubject"),
        c.get("adminPurpose"),
      );
      return c.json(error(requestId, "not_found", "Artifact not found"), 404);
    }
    if (row.deleted_at !== null || row.expires_at <= new Date().toISOString()) {
      await recordAccess(
        c.env,
        generationId,
        row.user_id,
        [row.artifact_class],
        "expired",
        c.get("adminSubject"),
        c.get("adminPurpose"),
      );
      return c.json(
        error(requestId, "artifact_expired", "The exact artifact retention window has ended"),
        410,
      );
    }

    // Authorization and intent are durable before any content key or R2 bytes
    // are opened. `granted` describes the authorization decision; an integrity
    // failure after this point remains a 500 rather than rewriting the audit.
    await recordAccess(
      c.env,
      generationId,
      row.user_id,
      [row.artifact_class],
      "granted",
      c.get("adminSubject"),
      c.get("adminPurpose"),
    );
    const identity = await loadUserIdentity(c.env, row.user_id);
    if (!identity) throw new Error("Pattern artifact owner missing");
    const content = await getArtifactById<Record<string, unknown>>(
      c.env,
      identity,
      generationId,
      row.id,
      row.artifact_class,
    );
    if (!content) throw new Error("Pattern artifact storage mismatch");
    return c.json({
      schema_version: "0.7.0",
      generation_id: generationId,
      artifact_id: row.id,
      artifact_class: row.artifact_class,
      created_at: row.created_at,
      expires_at: row.expires_at,
      content,
    }, 200);
  },
);

adminPatternRoutes.get("/pattern-ontology-releases/:version", async (c) => {
  const requestId = c.get("requestId");
  const version = c.req.param("version");
  const row = await c.env.DB.prepare(
    `SELECT version, bundle_hash, corpus_release_hash, locale, status, object_key
     FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(version)
    .first<{
      version: string;
      bundle_hash: string;
      corpus_release_hash: string;
      locale: string;
      status: "candidate" | "active" | "superseded" | "recalled";
      object_key: string;
    }>();
  if (!row) {
    return c.json(error(requestId, "not_found", "Ontology release not found"), 404);
  }
  const release = await readVerifiedOntologyRelease(
    c.env,
    row.object_key,
    row.bundle_hash,
  );
  if (!release) throw new Error("Pattern ontology release integrity mismatch");
  return c.json({
    schema_version: "0.7.0",
    ontology_version: row.version,
    status: row.status,
    bundle_hash: row.bundle_hash,
    corpus_release_hash: row.corpus_release_hash,
    locale: row.locale,
    provenance_origin: release.provenance?.origin ?? "absent",
    record_count: release.records.length,
    evaluation: release.evaluation,
  }, 200);
});
