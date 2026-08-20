import { Hono } from "hono";
import { compileOntologyRelease } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { storeOntologyRelease } from "../db/pattern-ontology.js";
import { recallOntologyAndWithdraw } from "../services/pattern-lifecycle.js";
import { reconcilePatternGeneration } from "../services/pattern-sweep.js";
import {
  parseOntologyKeys,
  stripOntologySignature,
  verifyOntologySignature,
  type SignedOntologyRelease,
} from "../services/pattern-ontology-verify.js";
import { isDevEnvironment } from "../crypto.js";
import {
  PatternOntologyEvidenceError,
  verifyPatternOntologyEvidence,
  type VerifiedPatternOntologyEvidence,
} from "../services/pattern-ontology-evidence.js";

export const internalPatternRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface PatternOntologyReleaseWithRawProvenance {
  provenance?: { origin?: unknown };
}

function error(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

internalPatternRoutes.post("/pattern-ontology-releases", async (c) => {
  const requestId = c.get("requestId");
  if (!c.env.PATTERN_ONTOLOGY_KEYS && c.env.ENVIRONMENT !== "development" && c.env.AUTH_STUB !== "1") {
    return c.json(error(requestId, "ontology_keys_not_configured", "PATTERN_ONTOLOGY_KEYS is required"), 503);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error(requestId, "invalid_json", "Request body must be valid JSON"), 400);
  }
  // stripOntologySignature destructures, so a bare `null` body throws before
  // the compiler ever sees it. Everything past this guard is shape-checked by
  // compileOntologyRelease against the frozen contract and reported as a 400.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json(error(requestId, "ontology_release_invalid", "release_malformed"), 400);
  }
  const signed = body as SignedOntologyRelease;
  const release = stripOntologySignature(signed);
  const compiled = compileOntologyRelease(release);
  if (!compiled.ok) {
    return c.json(error(requestId, "ontology_release_invalid", compiled.failures.map((f) => f.code).join(",")), 400);
  }
  const rawOrigin = (release as PatternOntologyReleaseWithRawProvenance)
    .provenance?.origin;
  if (
    rawOrigin !== undefined &&
    rawOrigin !== "synthetic_internal" &&
    rawOrigin !== "machine_pipeline"
  ) {
    return c.json(
      error(
        requestId,
        "ontology_release_invalid",
        "provenance.origin is not a known value",
      ),
      400,
    );
  }
  if (rawOrigin === "machine_pipeline" && release.status !== "candidate") {
    return c.json(
      error(
        requestId,
        "ontology_status_not_candidate",
        "Machine ontology releases must be signed as candidates",
      ),
      400,
    );
  }
  const keys = parseOntologyKeys(c.env.PATTERN_ONTOLOGY_KEYS);
  if (keys.size > 0) {
    const failed = await verifyOntologySignature(signed, keys);
    if (failed) {
      return c.json(error(requestId, "ontology_signature_invalid", failed.message), 400);
    }
  } else if (!isDevEnvironment(c.env.ENVIRONMENT) && c.env.AUTH_STUB !== "1") {
    return c.json(error(requestId, "ontology_keys_not_configured", "PATTERN_ONTOLOGY_KEYS is required"), 503);
  }
  if (rawOrigin === "machine_pipeline" && keys.size === 0) {
    return c.json(
      error(
        requestId,
        "ontology_keys_not_configured",
        "PATTERN_ONTOLOGY_KEYS is required for machine releases",
      ),
      503,
    );
  }

  const existing = await c.env.DB.prepare(
    `SELECT bundle_hash, status
     FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(signed.ontology_version)
    .first<{ bundle_hash: string; status: string }>();
  if (existing?.status === "recalled") {
    return c.json(error(requestId, "ontology_version_recalled", "A recalled ontology version cannot be revived"), 409);
  }
  if (existing && existing.bundle_hash !== signed.bundle_hash) {
    return c.json(error(requestId, "ontology_version_immutable", "Ontology version bytes are immutable"), 409);
  }

  let evidence: VerifiedPatternOntologyEvidence | undefined;
  if (rawOrigin === "machine_pipeline") {
    if (!signed.signature) {
      return c.json(
        error(
          requestId,
          "ontology_signature_invalid",
          "Machine ontology release is not signed",
        ),
        400,
      );
    }
    try {
      evidence = await verifyPatternOntologyEvidence(
        c.env,
        release,
        signed.signature.key_id,
      );
    } catch (cause) {
      if (cause instanceof PatternOntologyEvidenceError) {
        return c.json(
          error(requestId, cause.code, "Machine ontology evidence was refused"),
          409,
        );
      }
      throw cause;
    }
  }
  const objectKey = `pattern-ontology/${signed.ontology_version}.json`;
  try {
    await storeOntologyRelease(
      c.env,
      signed,
      objectKey,
      evidence,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message === "ontology_version_recalled") {
      return c.json(error(requestId, "ontology_version_recalled", "A recalled ontology version cannot be revived"), 409);
    }
    if (message === "ontology_version_immutable") {
      return c.json(error(requestId, "ontology_version_immutable", "Ontology version bytes are immutable"), 409);
    }
    if (message === "ontology_bundle_hash_mismatch") {
      return c.json(error(requestId, "ontology_bundle_hash_mismatch", "bundle_hash does not match the canonical payload"), 400);
    }
    if (message === "ontology_signature_invalid") {
      return c.json(error(requestId, "ontology_signature_invalid", "Ontology signature is invalid"), 400);
    }
    if (message === "ontology_pipeline_evidence_missing") {
      return c.json(
        error(
          requestId,
          "ontology_pipeline_evidence_missing",
          "Machine ontology evidence was refused",
        ),
        409,
      );
    }
    throw cause;
  }
  const pointer = await c.env.DB.prepare(
    `SELECT bundle_hash, status
     FROM pattern_ontology_releases WHERE version = ?`,
  )
    .bind(signed.ontology_version)
    .first<{ bundle_hash: string; status: string }>();
  return c.json(
    {
      ontology_version: signed.ontology_version,
      bundle_hash: pointer?.bundle_hash ?? signed.bundle_hash,
      status: pointer?.status ?? "candidate",
      r2_uri: objectKey,
    },
    201,
  );
});

internalPatternRoutes.post("/pattern-ontology-releases/:version/recall", async (c) => {
  const requestId = c.get("requestId");
  const version = c.req.param("version");
  const withdrawn = await recallOntologyAndWithdraw(c.env, version, "critical_defect");
  return c.json({ ontology_version: version, withdrawn_patterns: withdrawn, request_id: requestId }, 200);
});

internalPatternRoutes.post("/pattern-generations/:generation_id/reconcile", async (c) => {
  const requestId = c.get("requestId");
  const result = await reconcilePatternGeneration(c.env, c.req.param("generation_id"));
  if (!result.ok) {
    return c.json(error(requestId, result.code, "Generation not found"), result.status);
  }
  return c.json(result.body, result.status);
});
