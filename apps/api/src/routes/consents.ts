import { Hono, type Context } from "hono";
import {
  AI_CONSENT_DATA_CATEGORIES,
  GEOCODER_CONSENT_ALLOWED_USES,
  GEOCODER_CONSENT_DISCLOSURE_LINKS,
  GEOCODER_CONSENT_DISCLOSURE_TEXT,
  GEOCODER_CONSENT_POLICY_VERSION,
  GEOCODER_CONSENT_SCHEMA_VERSION,
  GEOCODER_PROVIDER,
  requireIdempotencyKey,
  type GeocoderConsentUiSurface,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { isGeocoderAvailable } from "../services/geocoder/index.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  AI_SYNTHESIS_POLICY_VERSION,
  grantAiSynthesisConsent,
  loadAiSynthesisGrant,
  revokeAiSynthesisConsent,
  grantGeocoderConsent,
  loadGeocoderConsentState,
  revokeGeocoderConsent,
  type AiSynthesisConsentState,
  type GeocoderConsentState,
} from "../db/consents.js";

export const consentRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

type ConsentContext = Context<{ Bindings: Env; Variables: AppVariables }>;

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

function geocoderResponseBody(state: GeocoderConsentState) {
  return {
    schema_version: GEOCODER_CONSENT_SCHEMA_VERSION,
    kind: "product_source" as const,
    source_id: "AST-02" as const,
    permission_tier: 0 as const,
    allowed_uses: [...GEOCODER_CONSENT_ALLOWED_USES],
    provider: GEOCODER_PROVIDER,
    scopes: [] as [],
    connector_account_id: null,
    status: state.status,
    policy_version: GEOCODER_CONSENT_POLICY_VERSION,
    granted_at: state.grantedAt,
    ui_surface: state.status === "granted" ? state.uiSurface : null,
    disclosure: {
      text: GEOCODER_CONSENT_DISCLOSURE_TEXT,
      links: { ...GEOCODER_CONSENT_DISCLOSURE_LINKS },
    },
  };
}

function geocoderUiSurface(value: string | undefined): GeocoderConsentUiSurface | null {
  return value === "onboarding" || value === "privacy_center" ? value : null;
}

function geocoderUnavailable(c: ConsentContext) {
  return c.json(
    requestError(c.get("requestId"), "geocoder_unavailable", "Place search is unavailable"),
    503,
  );
}

consentRoutes.get("/v1/consents/geocoder", async (c) => {
  return c.json(
    geocoderResponseBody(await loadGeocoderConsentState(c.env, c.get("userId"))),
    200,
  );
});

consentRoutes.put("/v1/consents/geocoder", async (c) => {
  if (!isGeocoderAvailable(c.env)) return geocoderUnavailable(c);
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  const uiSurface = geocoderUiSurface(c.req.header("x-consent-ui-surface"));
  if (!key) {
    return c.json(requestError(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  if (!uiSurface) {
    return c.json(requestError(requestId, "invalid_ui_surface", "X-Consent-UI-Surface must be onboarding or privacy_center"), 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(requestError(requestId, "invalid_json", "Request body must be valid JSON"), 400);
  }
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    (body as { policy_version?: unknown }).policy_version !== GEOCODER_CONSENT_POLICY_VERSION
  ) {
    return c.json(requestError(requestId, "consent_policy_version_stale", "Re-read the current geocoder policy and grant again"), 409);
  }
  const result = await grantGeocoderConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    GEOCODER_CONSENT_POLICY_VERSION,
    uiSurface,
    key,
  );
  if (!result.ok) {
    return c.json(requestError(
      requestId,
      result.reason === "idempotency_conflict" ? "idempotency_conflict" : "consent_conflict",
      "The geocoder consent mutation could not be committed",
    ), 409);
  }
  return c.json(geocoderResponseBody(result.state), 200);
});

consentRoutes.delete("/v1/consents/geocoder", async (c) => {
  const requestId = c.get("requestId");
  const key = idempotencyKey(c.req.header("idempotency-key"));
  const uiSurface = geocoderUiSurface(c.req.header("x-consent-ui-surface"));
  if (!key) {
    return c.json(requestError(requestId, "missing_idempotency_key", "Idempotency-Key header required (8-128 chars)"), 400);
  }
  if (!uiSurface) {
    return c.json(requestError(requestId, "invalid_ui_surface", "X-Consent-UI-Surface must be onboarding or privacy_center"), 400);
  }
  if ((await c.req.text()).length > 0) {
    return c.json(requestError(requestId, "invalid_body", "DELETE request body must be empty"), 400);
  }
  const result = await revokeGeocoderConsent(
    c.env,
    { userId: c.get("userId"), cryptoSubject: c.get("cryptoSubject") },
    uiSurface,
    key,
  );
  if (!result.ok) {
    return c.json(requestError(
      requestId,
      result.reason === "idempotency_conflict" ? "idempotency_conflict" : "consent_conflict",
      "The geocoder consent mutation could not be committed",
    ), 409);
  }
  return c.json(geocoderResponseBody(result.state), 200);
});

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
