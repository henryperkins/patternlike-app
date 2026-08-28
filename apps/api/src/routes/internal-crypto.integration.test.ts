import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { DEV_ROOT_KEK } from "../crypto.js";
import { app } from "../index.js";
import type { Env } from "../env.js";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";

const TOKEN = "crypto_0123456789abcdefghijklmnopqrstuvwxyz";
const NEW_ROOT = "root-secret-2026-09-with-at-least-32-chars";

function operatorEnv(): Env {
  return {
    ...env,
    CRYPTO_OPERATOR_TOKEN: TOKEN,
    ROOT_KEK_KEYRING: JSON.stringify({
      version: 1,
      active_key_id: "root-2026-09",
      keys: {
        legacy: DEV_ROOT_KEK,
        "root-2026-09": NEW_ROOT,
      },
    }),
  } as Env;
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await app.request(
    `http://api.test/crypto-operator${path}`,
    { ...init, headers },
    operatorEnv(),
  );
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("crypto operator routes", () => {
  it("isolates authority and drives a resumable DEK rotation", async () => {
    const unauthorized = await app.request(
      "http://api.test/crypto-operator/dek-rotations",
      { method: "POST" },
      operatorEnv(),
    );
    expect(unauthorized.status).toBe(401);

    const invalid = await request("/dek-rotations", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "crypto-operations/v1",
        user_id: USER_A,
        idempotency_key: "crypto-route-invalid-0001",
        confirm: "ROTATE_USER_DEK",
        reason_class: "scheduled",
        extra: true,
      }),
    });
    expect(invalid.response.status).toBe(400);

    const started = await request("/dek-rotations", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "crypto-operations/v1",
        user_id: USER_A,
        idempotency_key: "crypto-route-start-0001",
        confirm: "ROTATE_USER_DEK",
        reason_class: "scheduled",
      }),
    });
    expect(started.response.status).toBe(202);
    expect(started.body).toMatchObject({
      schema_version: "crypto-operations/v1",
      operation_id: expect.stringMatching(/^cop_[0-9a-f]{32}$/),
      stage: "quiescing",
      reencrypted_count: 0,
    });

    const operationId = started.body.operation_id as string;
    const replay = await request("/dek-rotations", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "crypto-operations/v1",
        user_id: USER_A,
        idempotency_key: "crypto-route-start-0001",
        confirm: "ROTATE_USER_DEK",
        reason_class: "scheduled",
      }),
    });
    expect(replay.body.operation_id).toBe(operationId);

    const status = await request(`/dek-rotations/${operationId}`);
    expect(status.response.status).toBe(200);
    expect(status.body).not.toHaveProperty("candidate_wrapped_dek");
    expect(status.body).not.toHaveProperty("previous_key_version");

    const stepped = await request(`/dek-rotations/${operationId}/step`, {
      method: "POST",
      body: "{}",
    });
    expect(stepped.response.status).toBe(200);
    expect(stepped.body.operation_id).toBe(operationId);
  });

  it("creates, steps, retries, and reads a root-KEK campaign", async () => {
    const started = await request("/kek-rewrap-campaigns", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "crypto-operations/v1",
        target_root_kek_id: "root-2026-09",
        idempotency_key: "crypto-campaign-start-0001",
        confirm: "REWRAP_ROOT_KEK",
      }),
    });
    expect(started.response.status).toBe(202);
    expect(started.body).toMatchObject({
      schema_version: "crypto-operations/v1",
      campaign_id: expect.stringMatching(/^ckc_[0-9a-f]{32}$/),
      target_root_kek_id: "root-2026-09",
      status: "running",
      total_count: 1,
    });
    const campaignId = started.body.campaign_id as string;

    const stepped = await request(`/kek-rewrap-campaigns/${campaignId}/step`, {
      method: "POST",
      body: "{}",
    });
    expect(stepped.response.status).toBe(200);
    expect(stepped.body).toMatchObject({ status: "completed", completed_count: 1 });

    const retried = await request(`/kek-rewrap-campaigns/${campaignId}/retry-blocked`, {
      method: "POST",
      body: JSON.stringify({
        schema_version: "crypto-operations/v1",
        confirm: "RETRY_BLOCKED_KEK_ITEMS",
      }),
    });
    expect(retried.response.status).toBe(200);

    const status = await request(`/kek-rewrap-campaigns/${campaignId}`);
    expect(status.body).toMatchObject({ campaign_id: campaignId, status: "completed" });
    expect(await rows<{ root_kek_id: string }>(
      "SELECT root_kek_id FROM user_keys WHERE user_id = ? AND destroyed_at IS NULL",
      USER_A,
    )).toEqual([{ root_kek_id: "root-2026-09" }]);
  });
});
