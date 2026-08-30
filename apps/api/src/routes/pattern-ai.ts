import { Hono } from "hono";
import {
  M7_SCHEMA_VERSION,
  M9_SCHEMA_VERSION,
  PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  requireIdempotencyKey,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadUserIdentity } from "../db/users.js";
import { loadPatternGenerationGrant, patternConsentDocument } from "../db/pattern-consents.js";
import { isOntologyRecalled, loadActiveOntology, ontologyServesAccount } from "../db/pattern-ontology.js";
import { enqueuePatternGeneration } from "../services/pattern-enqueue.js";
import {
  buildPatternState,
  loadActiveChart,
  loadActivePatternDocument,
  projectPatternResponse,
} from "../services/pattern-state.js";
import {
  deleteCurrentPattern,
  revokePatternGenerationConsent,
} from "../services/pattern-lifecycle.js";
import {
  patternFailureIsRetryable,
} from "../services/pattern-command.js";
import {
  publicFailureStageFor,
  publicStageFor,
  type PatternDomainStage,
} from "../services/pattern-stage-protocol.js";
import { hashChartFingerprint, loadClaimForFingerprint } from "../db/pattern-claims.js";
import { loadPreferences } from "../db/preferences.js";

export const patternAiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function error(requestId: string, code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, request_id: requestId, ...(details ? { details } : {}) } };
}

function identityFrom(c: { get: (key: "userId") => string; env: Env }) {
  return loadUserIdentity(c.env, c.get("userId"));
}

patternAiRoutes.get("/v1/pattern-state", async (c) => {
  const identity = await identityFrom(c);
  if (!identity) return c.json(error(c.get("requestId"), "unauthorized", "Authentication required"), 401);
  const document = await buildPatternState(c.env, identity);
  return c.json(document, 200);
});

patternAiRoutes.get("/v1/consents/pattern-generation", async (c) => {
  const grant = await loadPatternGenerationGrant(c.env, c.get("userId"));
  return c.json(patternConsentDocument(grant), 200);
});

patternAiRoutes.delete("/v1/consents/pattern-generation", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(error(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  const identity = await identityFrom(c);
  if (!identity) return c.json(error(requestId, "unauthorized", "Authentication required"), 401);
  const result = await revokePatternGenerationConsent(c.env, identity);
  // Design spec 19.3: the envelope carries `existing_pattern_retained` once, at
  // the top level. It was also being nested inside `consent`, where the client
  // never reads it.
  return c.json(
    {
      schema_version: M7_SCHEMA_VERSION,
      consent: {
        ...patternConsentDocument(null),
        revoked_at: new Date().toISOString(),
      },
      existing_pattern_retained: result.retained,
    },
    200,
  );
});

patternAiRoutes.post("/v1/pattern-generations", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key || key.length > 128) {
    return c.json(error(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error(requestId, "invalid_json", "Request body must be valid JSON"), 400);
  }
  const record = body as {
    schema_version?: unknown;
    consent_policy_version?: unknown;
    confirm?: unknown;
    reason?: unknown;
  };
  const initialReason = record.reason === "first_open" ||
    record.reason === "first_open_retry" ||
    record.reason === "failed_attempt_retry";
  const initialRequest =
    (record.schema_version === M7_SCHEMA_VERSION ||
      record.schema_version === M9_SCHEMA_VERSION) &&
    record.confirm === "GENERATE MY PATTERN" &&
    initialReason;
  const sourceUpdateRequest =
    record.schema_version === M9_SCHEMA_VERSION &&
    record.confirm === "REGENERATE MY PATTERN" &&
    record.reason === "source_update";
  if (
    (!initialRequest && !sourceUpdateRequest) ||
    typeof record.consent_policy_version !== "string"
  ) {
    return c.json(error(requestId, "invalid_request", "Pattern generation request is not valid"), 400);
  }
  const identity = await identityFrom(c);
  if (!identity) return c.json(error(requestId, "unauthorized", "Authentication required"), 401);
  const result = await enqueuePatternGeneration(c.env, identity, {
    idempotencyKey: key,
    consentPolicyVersion: record.consent_policy_version,
    reason: record.reason as
      | "first_open"
      | "first_open_retry"
      | "failed_attempt_retry"
      | "source_update",
    requestId,
  });
  if (!result.ok) return c.json(error(requestId, result.code, result.message), result.status);
  return c.json(result.body, result.replay ? 200 : 202);
});

patternAiRoutes.get("/v1/pattern-generations/:generation_id", async (c) => {
  const requestId = c.get("requestId");
  const generationId = c.req.param("generation_id");
  const row = await c.env.DB.prepare(
    `SELECT generation_id, stage, updated_at, created_at, finished_at,
            public_failure_stage, failure_class
     FROM pattern_generation_jobs WHERE generation_id = ? AND user_id = ?`,
  )
    .bind(generationId, c.get("userId"))
    .first<{
      generation_id: string;
      stage: PatternDomainStage;
      updated_at: string;
      created_at: string;
      finished_at: string | null;
      public_failure_stage: string | null;
      failure_class: string | null;
    }>();
  if (!row) return c.json(error(requestId, "not_found", "Generation not found"), 404);
  const stage = row.stage === "failed"
    ? publicFailureStageFor(row.public_failure_stage)
    : publicStageFor(row.stage);
  if (!stage) return c.json(error(requestId, "not_found", "Generation not found"), 404);
  return c.json(
    {
      schema_version: M9_SCHEMA_VERSION,
      generation_id: row.generation_id,
      stage,
      status_updated_at: row.updated_at,
      started_at: row.created_at,
      retryable:
        row.stage === "failed" &&
        await patternFailureIsRetryable(c.env, row.failure_class),
      finished_at: row.finished_at,
    },
    200,
  );
});

patternAiRoutes.delete("/v1/pattern", async (c) => {
  const requestId = c.get("requestId");
  const key = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(error(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error(requestId, "invalid_json", "Request body must be valid JSON"), 400);
  }
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== "DELETE PATTERN") {
    return c.json(error(requestId, "invalid_request", "Confirm DELETE PATTERN to erase this Pattern"), 400);
  }
  const identity = await identityFrom(c);
  if (!identity) return c.json(error(requestId, "unauthorized", "Authentication required"), 401);
  const result = await deleteCurrentPattern(c.env, identity, key);
  return result === "gone" ? c.body(null, 204) : c.body(null, 202);
});

/**
 * `GET /v1/pattern` for every authenticated account.
 *
 * There is no cohort escape and no editorial fallthrough: this function always
 * answers. The M4 catalogue's data is preserved and still exported; it is no
 * longer a product path an account can be routed onto.
 */
export async function serveGeneratedPattern(
  env: Env,
  userId: string,
  cryptoSubject: import("../crypto.js").CryptoSubject,
  requestId: string,
  url: string,
): Promise<Response> {
  const params = new URL(url).searchParams;
  if ([...params.keys()].length > 0) {
    return Response.json(error(requestId, "invalid_pattern_query", "AI Pattern accepts no query parameters"), { status: 400 });
  }

  const chart = await loadActiveChart(env, userId);
  if (!chart) {
    return Response.json(error(requestId, "chart_not_found", "No active chart for user"), { status: 404 });
  }
  const preferences = await loadPreferences(env, userId);
  if (!preferences || preferences.localeSource !== "user_confirmed") {
    return Response.json(error(requestId, "locale_confirmation_required", "Confirm a content locale before loading Pattern"), { status: 409 });
  }

  const fingerprintHash = await hashChartFingerprint(chart.fingerprint);
  const claim = await loadClaimForFingerprint(env, userId, fingerprintHash);
  const identity = { userId, cryptoSubject };
  const document = await loadActivePatternDocument(env, userId, fingerprintHash);
  if (document) {
    if (await isOntologyRecalled(env, document.ontology_version)) {
      return Response.json(error(requestId, "pattern_withdrawn", "The interpretation basis for this Pattern was withdrawn"), { status: 410 });
    }
    const body = await projectPatternResponse(env, identity, document);
    return Response.json(body, { status: 200 });
  }
  if (claim?.status === "deleted" || claim?.status === "superseded") {
    return Response.json(error(requestId, "pattern_deleted", "This Pattern was deleted and cannot be regenerated"), { status: 410 });
  }
  if (claim?.status === "withdrawn") {
    return Response.json(error(requestId, "pattern_withdrawn", "The interpretation basis for this Pattern was withdrawn"), { status: 410 });
  }
  if (claim?.status === "reserved") {
    return Response.json(error(requestId, "pattern_generation_in_progress", "Pattern generation is in progress"), { status: 409 });
  }
  // Design spec 19.6 lists a terminal failure as its own refusal. Answering
  // `404 pattern_not_generated` here left a client that reads this route rather
  // than /v1/pattern-state unable to tell "never generated" from "failed, and
  // you may try again" -- which is the difference between offering a retry and
  // offering nothing.
  const lastGeneration = await env.DB.prepare(
    `SELECT stage, public_failure_stage, failure_class
     FROM pattern_generation_jobs
     WHERE user_id = ? AND chart_fingerprint_hash = ?
     ORDER BY created_at DESC, generation_id DESC
     LIMIT 1`,
  )
    .bind(userId, fingerprintHash)
    .first<{
      stage: string;
      public_failure_stage: string | null;
      failure_class: string | null;
    }>();
  if (lastGeneration?.stage === "failed") {
    const publicFailureStage = publicFailureStageFor(
      lastGeneration.public_failure_stage,
    );
    return Response.json(
      error(requestId, "pattern_generation_failed", "The last Pattern generation did not finish", {
        retryable:
          claim?.status === "available" &&
          await patternFailureIsRetryable(
            env,
            lastGeneration.failure_class,
          ),
        ...(publicFailureStage ? { stage: publicFailureStage } : {}),
      }),
      { status: 409 },
    );
  }
  const grant = await loadPatternGenerationGrant(env, userId);
  if (!grant) {
    return Response.json(error(requestId, "pattern_generation_consent_required", "Pattern generation consent is required"), { status: 409 });
  }
  if (!ontologyServesAccount(await loadActiveOntology(env))) {
    return Response.json(error(requestId, "ontology_unavailable", "No activated Pattern ontology is available"), { status: 409 });
  }
  return Response.json(error(requestId, "pattern_not_generated", "No accepted Pattern exists"), { status: 404 });
}

void PATTERN_GENERATION_CONSENT_POLICY_VERSION;
