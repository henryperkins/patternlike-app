import { jcsCanonicalize } from "@patternlike/shared";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  resetDb,
  seedUser,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import {
  writePatternReplayIntent,
} from "../services/pattern-replay-ledger.js";

const SERVICE_TOKEN = "pattern-replay-route-test-token";

async function post(
  path: "/internal/pattern-erasure-replay/apply" | "/internal/pattern-erasure-replay/sweep",
  body: unknown = {},
  token: string | null = SERVICE_TOKEN,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await SELF.fetch(`http://api.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json<Record<string, unknown>>(),
  };
}

beforeEach(async () => {
  await resetDb();
  await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
  installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
  env.SERVICE_AUTH_TOKEN = SERVICE_TOKEN;
});

afterEach(() => {
  env.SERVICE_AUTH_TOKEN = "";
});

describe("internal Pattern erasure replay routes", () => {
  it("requires the configured service token", async () => {
    expect((await post(
      "/internal/pattern-erasure-replay/apply",
      {},
      null,
    )).status).toBe(401);
    expect((await post(
      "/internal/pattern-erasure-replay/sweep",
      {},
      "wrong-token",
    )).status).toBe(401);
  });

  it("refuses caller-supplied event material", async () => {
    const response = await post(
      "/internal/pattern-erasure-replay/apply",
      { event: { event_id: "caller-controlled" } },
    );

    expect(response.status).toBe(400);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_erasure_replay_events",
    ).first()).toEqual({ count: 0 });
  });

  it.each([
    "/internal/pattern-erasure-replay/apply",
    "/internal/pattern-erasure-replay/sweep",
  ] as const)("returns only content-free counts for an empty replica at %s", async (path) => {
    const response = await post(path);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listed: 0,
      applied: 0,
      replayed: 0,
      completed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("verifies every object before making any D1 change", async () => {
    await seedUser(IDENTITY_A);
    const prepared = await writePatternReplayIntent(env, {
      eventClass: "claim_consumed",
      semanticOperationKey: "pgen_11111111111111111111111111111111",
      targetUserId: USER_A,
      chartFingerprintHash: `sha256:${"2".repeat(64)}`,
      claimId: "pgc_33333333333333333333333333333333",
      generationId: "pgen_11111111111111111111111111111111",
      patternId: "pat_44444444444444444444444444444444",
      ontologyVersion: "pattern-ontology-en-us-0.1.0",
      priorClaimStatus: "reserved",
      nextClaimStatus: "accepted",
    });
    await env.PATTERN_REPLAY_LEDGER!.put(
      prepared.objectKey,
      jcsCanonicalize({ ...prepared.event, signature: "A".repeat(86) }),
    );

    const response = await post("/internal/pattern-erasure-replay/apply");

    expect(response.status).toBe(409);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_generation_claims",
    ).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_erasure_replay_events",
    ).first()).toEqual({ count: 0 });
  });

  it("applies account deletion last and exposes no event identifiers", async () => {
    await seedUser(IDENTITY_A);
    await writePatternReplayIntent(env, {
      eventClass: "account_deleted",
      semanticOperationKey: "del_route_ordering_test",
      targetUserId: USER_A,
      chartFingerprintHash: null,
      claimId: null,
      generationId: null,
      patternId: null,
      ontologyVersion: null,
      priorClaimStatus: null,
      nextClaimStatus: "deleted",
    }, new Date("2026-08-22T15:20:00.000Z"));
    await writePatternReplayIntent(env, {
      eventClass: "claim_consumed",
      semanticOperationKey: "pgen_22222222222222222222222222222222",
      targetUserId: USER_A,
      chartFingerprintHash: `sha256:${"3".repeat(64)}`,
      claimId: "pgc_55555555555555555555555555555555",
      generationId: "pgen_22222222222222222222222222222222",
      patternId: "pat_66666666666666666666666666666666",
      ontologyVersion: "pattern-ontology-en-us-0.1.0",
      priorClaimStatus: "available",
      nextClaimStatus: "accepted",
    }, new Date("2026-08-22T15:21:00.000Z"));

    const response = await post("/internal/pattern-erasure-replay/apply");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listed: 2,
      applied: 2,
      replayed: 0,
      completed_at: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain("prel_");
    expect(await env.DB.prepare(
      "SELECT status FROM users WHERE id = ?",
    ).bind(USER_A).first()).toEqual({ status: "deleted" });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_generation_claims WHERE user_id = ?",
    ).bind(USER_A).first()).toEqual({ count: 0 });
  });
});
