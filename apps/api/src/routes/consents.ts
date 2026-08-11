import { Hono } from "hono";
import {
  AI_CONSENT_DATA_CATEGORIES,
  requireIdempotencyKey,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  AI_SYNTHESIS_POLICY_VERSION,
  grantAiSynthesisConsent,
  loadAiSynthesisGrant,
  revokeAiSynthesisConsent,
  type AiSynthesisConsentState,
} from "../db/consents.js";

export const consentRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function responseBody(state: AiSynthesisConsentState) {
  return {
    kind: "ai_synthesis" as const,
    status: state.status,
    provider: "OpenAI" as const,
    purpose: "daily_reading_generation" as const,
    policy_version: AI_SYNTHESIS_POLICY_VERSION,
    enabled_categories: [...AI_CONSENT_DATA_CATEGORIES],
    granted_at: state.grantedAt,
  };
}

function requestError(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function idempotencyKey(header: string | undefined): string | null {
  const key = requireIdempotencyKey(header);
  return key && key.length <= 128 ? key : null;
}

consentRoutes.get("/v1/consents/ai-synthesis", async (c) => {
  const grant = await loadAiSynthesisGrant(c.env, c.get("userId"));
  return c.json(
    responseBody(
      grant
        ? { status: "granted", grantedAt: grant.grantedAt }
        : { status: "not_granted", grantedAt: null },
    ),
    200,
  );
});

consentRoutes.put("/v1/consents/ai-synthesis", async (c) => {
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      requestError(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-128 chars)",
      ),
      400,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      requestError(requestId, "invalid_json", "Request body must be valid JSON"),
      400,
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as { policy_version?: unknown }).policy_version !== "string"
  ) {
    return c.json(
      requestError(
        requestId,
        "invalid_body",
        "Request body must contain only policy_version",
      ),
      400,
    );
  }
  const policyVersion = (body as { policy_version: string }).policy_version;
  if (policyVersion !== AI_SYNTHESIS_POLICY_VERSION) {
    return c.json(
      requestError(
        requestId,
        "consent_policy_version_stale",
        "Re-read the current AI synthesis policy and grant again",
      ),
      409,
    );
  }

  const result = await grantAiSynthesisConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    policyVersion,
    key,
  );
  if (!result.ok) {
    return c.json(
      requestError(
        requestId,
        result.reason === "idempotency_conflict"
          ? "idempotency_conflict"
          : "consent_conflict",
        result.reason === "idempotency_conflict"
          ? "Idempotency-Key was already used for a different consent mutation"
          : "The consent state changed concurrently; retry the request",
      ),
      409,
    );
  }
  return c.json(responseBody(result.state), 200);
});

consentRoutes.delete("/v1/consents/ai-synthesis", async (c) => {
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(
      requestError(
        requestId,
        "missing_idempotency_key",
        "Idempotency-Key header required (8-128 chars)",
      ),
      400,
    );
  }
  let body: string;
  try {
    body = await c.req.text();
  } catch {
    body = "invalid";
  }
  if (body.length > 0) {
    return c.json(
      requestError(requestId, "invalid_body", "DELETE request body must be empty"),
      400,
    );
  }

  const result = await revokeAiSynthesisConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    key,
  );
  if (!result.ok) {
    return c.json(
      requestError(
        requestId,
        result.reason === "idempotency_conflict"
          ? "idempotency_conflict"
          : "consent_conflict",
        result.reason === "idempotency_conflict"
          ? "Idempotency-Key was already used for a different consent mutation"
          : "The consent state changed concurrently; retry the request",
      ),
      409,
    );
  }
  return c.json(responseBody(result.state), 200);
});
