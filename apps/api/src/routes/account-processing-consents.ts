import { Hono } from "hono";
import { requireIdempotencyKey } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  grantAccountProcessingConsent,
  loadAccountProcessingConsentDocument,
  revokeAccountProcessingConsent,
} from "../db/account-processing-consents.js";
import {
  CURRENT_ACCOUNT_PROCESSING_POLICY,
  type AccountProcessingUiSurface,
} from "../policies/account-processing-policies.js";

export const accountProcessingConsentRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function errorBody(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

function idempotencyKey(header: string | undefined): string | null {
  const key = requireIdempotencyKey(header);
  return key && key.length <= 128 ? key : null;
}

function uiSurface(header: string | undefined): AccountProcessingUiSurface | null {
  return header === "onboarding" || header === "privacy_center" ? header : null;
}

function outcomeError(
  requestId: string,
  reason: "idempotency_conflict" | "consent_conflict" | "account_state_conflict",
) {
  const messages = {
    idempotency_conflict: "Idempotency-Key was already used for a different consent mutation",
    consent_conflict: "The consent state changed concurrently; retry the request",
    account_state_conflict: "The account state cannot be changed by this consent mutation",
  } as const;
  return errorBody(requestId, reason, messages[reason]);
}

accountProcessingConsentRoutes.get("/v1/consents/account-processing", async (c) => {
  return c.json(await loadAccountProcessingConsentDocument(c.env, c.get("userId")), 200);
});

accountProcessingConsentRoutes.put("/v1/consents/account-processing", async (c) => {
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(errorBody(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  const surface = uiSurface(c.req.header("x-consent-ui-surface"));
  if (!surface) {
    return c.json(errorBody(requestId, "invalid_body", "X-Consent-UI-Surface must be onboarding or privacy_center"), 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorBody(requestId, "invalid_json", "Request body must be valid JSON"), 400);
  }
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as { policy_version?: unknown }).policy_version !== "string"
  ) {
    return c.json(errorBody(requestId, "invalid_body", "Request body must contain only policy_version"), 400);
  }
  const policyVersion = (body as { policy_version: string }).policy_version;
  if (policyVersion !== CURRENT_ACCOUNT_PROCESSING_POLICY.version) {
    return c.json(errorBody(requestId, "consent_policy_version_stale", "Re-read the current account-processing policy and grant again"), 409);
  }
  const result = await grantAccountProcessingConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    policyVersion,
    surface,
    key,
  );
  if (!result.ok) return c.json(outcomeError(requestId, result.reason), 409);
  return c.json(await loadAccountProcessingConsentDocument(c.env, c.get("userId")), 200);
});

accountProcessingConsentRoutes.delete("/v1/consents/account-processing", async (c) => {
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  if (!key) {
    return c.json(errorBody(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  const surface = uiSurface(c.req.header("x-consent-ui-surface"));
  if (surface !== "privacy_center") {
    return c.json(errorBody(requestId, "invalid_body", "X-Consent-UI-Surface must be privacy_center"), 400);
  }
  if ((await c.req.text()).length !== 0) {
    return c.json(errorBody(requestId, "invalid_body", "DELETE request body must be empty"), 400);
  }
  const result = await revokeAccountProcessingConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    surface,
    key,
  );
  if (!result.ok) return c.json(outcomeError(requestId, result.reason), 409);
  return c.json(await loadAccountProcessingConsentDocument(c.env, c.get("userId")), 200);
});
