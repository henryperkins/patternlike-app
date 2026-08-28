import { Hono, type Context } from "hono";

import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import type {
  CryptoOperationView,
  KekRewrapCampaignView,
} from "../db/crypto-operations.js";
import {
  createKekRewrapCampaign,
  CryptoOperationError,
  getDekRotation,
  getKekRewrapCampaign,
  retryBlockedKekRewrapItems,
  startDekRotation,
  stepDekRotation,
  stepKekRewrapCampaign,
} from "../services/crypto-operations.js";

const SCHEMA_VERSION = "crypto-operations/v1" as const;
const USER_ID = /^usr_[A-Za-z0-9_-]{4,128}$/;
const OPERATION_ID = /^cop_[0-9a-f]{32}$/;
const CAMPAIGN_ID = /^ckc_[0-9a-f]{32}$/;
const ROOT_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;
const REASONS = new Set(["scheduled", "incident_response", "compliance"]);

export const internalCryptoRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

type CryptoOperatorContext = Context<{
  Bindings: Env;
  Variables: AppVariables;
}>;

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index]);
}

async function jsonBody(c: CryptoOperatorContext): Promise<unknown> {
  try {
    return await c.req.json() as unknown;
  } catch {
    return null;
  }
}

function operationResponse(view: CryptoOperationView) {
  return {
    schema_version: SCHEMA_VERSION,
    operation_id: view.id,
    stage: view.stage,
    reencrypted_count: view.reencryptedCount,
    not_before: view.notBefore,
    error_class: view.errorClass,
    created_at: view.createdAt,
    updated_at: view.updatedAt,
    completed_at: view.completedAt,
  };
}

function campaignResponse(view: KekRewrapCampaignView) {
  return {
    schema_version: SCHEMA_VERSION,
    campaign_id: view.id,
    target_root_kek_id: view.targetRootKekId,
    status: view.status,
    total_count: view.totalCount,
    completed_count: view.completedCount,
    blocked_count: view.blockedCount,
    created_at: view.createdAt,
    updated_at: view.updatedAt,
    completed_at: view.completedAt,
  };
}

function invalidBody(c: CryptoOperatorContext) {
  return c.json({
    error: {
      code: "invalid_body",
      message: "Request body is not valid",
      request_id: c.get("requestId") ?? null,
    },
  }, 400);
}

function operationFailure(c: CryptoOperatorContext, error: unknown) {
  if (!(error instanceof CryptoOperationError)) throw error;
  const notFound = error.code === "crypto_operation_not_found";
  return c.json({
    error: {
      code: error.code,
      message: notFound
        ? "Crypto operation was not found"
        : "Crypto operation could not be advanced",
      request_id: c.get("requestId") ?? null,
    },
  }, notFound ? 404 : 409);
}

async function emptyBody(c: CryptoOperatorContext): Promise<boolean> {
  const text = await c.req.raw.clone().text();
  if (text.trim() === "") return true;
  try {
    return exactObject(JSON.parse(text), []);
  } catch {
    return false;
  }
}

internalCryptoRoutes.post("/dek-rotations", async (c) => {
  const body = await jsonBody(c);
  const keys = [
    "confirm",
    "idempotency_key",
    "reason_class",
    "schema_version",
    "user_id",
  ];
  if (
    !exactObject(body, keys) ||
    body.schema_version !== SCHEMA_VERSION ||
    body.confirm !== "ROTATE_USER_DEK" ||
    typeof body.user_id !== "string" || !USER_ID.test(body.user_id) ||
    typeof body.idempotency_key !== "string" || !IDEMPOTENCY_KEY.test(body.idempotency_key) ||
    typeof body.reason_class !== "string" || !REASONS.has(body.reason_class)
  ) return invalidBody(c);
  try {
    const view = await startDekRotation(c.env, {
      userId: body.user_id,
      idempotencyKey: body.idempotency_key,
      reasonClass: body.reason_class as "scheduled" | "incident_response" | "compliance",
    });
    return c.json(operationResponse(view), 202);
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.post("/dek-rotations/:operationId/step", async (c) => {
  const operationId = c.req.param("operationId");
  if (!OPERATION_ID.test(operationId) || !await emptyBody(c)) return invalidBody(c);
  try {
    return c.json(operationResponse(await stepDekRotation(c.env, operationId)));
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.get("/dek-rotations/:operationId", async (c) => {
  const operationId = c.req.param("operationId");
  if (!OPERATION_ID.test(operationId)) return invalidBody(c);
  try {
    return c.json(operationResponse(await getDekRotation(c.env, operationId)));
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.post("/kek-rewrap-campaigns", async (c) => {
  const body = await jsonBody(c);
  const keys = ["confirm", "idempotency_key", "schema_version", "target_root_kek_id"];
  if (
    !exactObject(body, keys) ||
    body.schema_version !== SCHEMA_VERSION ||
    body.confirm !== "REWRAP_ROOT_KEK" ||
    typeof body.target_root_kek_id !== "string" || !ROOT_KEY_ID.test(body.target_root_kek_id) ||
    typeof body.idempotency_key !== "string" || !IDEMPOTENCY_KEY.test(body.idempotency_key)
  ) return invalidBody(c);
  try {
    const view = await createKekRewrapCampaign(c.env, {
      targetRootKekId: body.target_root_kek_id,
      idempotencyKey: body.idempotency_key,
    });
    return c.json(campaignResponse(view), 202);
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.post("/kek-rewrap-campaigns/:campaignId/step", async (c) => {
  const campaignId = c.req.param("campaignId");
  if (!CAMPAIGN_ID.test(campaignId) || !await emptyBody(c)) return invalidBody(c);
  try {
    return c.json(campaignResponse(await stepKekRewrapCampaign(c.env, campaignId)));
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.post("/kek-rewrap-campaigns/:campaignId/retry-blocked", async (c) => {
  const campaignId = c.req.param("campaignId");
  const body = await jsonBody(c);
  if (
    !CAMPAIGN_ID.test(campaignId) ||
    !exactObject(body, ["confirm", "schema_version"]) ||
    body.schema_version !== SCHEMA_VERSION ||
    body.confirm !== "RETRY_BLOCKED_KEK_ITEMS"
  ) return invalidBody(c);
  try {
    return c.json(campaignResponse(
      await retryBlockedKekRewrapItems(c.env, campaignId),
    ));
  } catch (error) {
    return operationFailure(c, error);
  }
});

internalCryptoRoutes.get("/kek-rewrap-campaigns/:campaignId", async (c) => {
  const campaignId = c.req.param("campaignId");
  if (!CAMPAIGN_ID.test(campaignId)) return invalidBody(c);
  try {
    return c.json(campaignResponse(await getKekRewrapCampaign(c.env, campaignId)));
  } catch (error) {
    return operationFailure(c, error);
  }
});
