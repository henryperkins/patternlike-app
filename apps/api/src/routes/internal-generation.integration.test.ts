import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { CYCLE_FP_UNAVAILABLE } from "../../test/mock-calc-service.js";

interface Envelope {
  status?: string;
  reading_id?: string;
  job_id?: string;
  dispatched?: boolean;
  undispatched?: number;
  expired_leases?: number;
  redispatched?: number;
  error?: { code: string; message: string; request_id: string | null };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Envelope }> {
  const res = await SELF.fetch(`http://api.test/internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

describe("POST /internal/readings/*", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    await seedActiveRelease();
  });

  it("reserves a reading and reports the job it dispatched", async () => {
    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(202);
    expect(body.status).toBe("reserved");
    expect(body.reading_id).toMatch(/^rdg_/);
    expect(body.dispatched).toBe(true);

    const reserved = await rows<{ id: string; status: string }>(
      "SELECT id, status FROM daily_readings WHERE user_id = ?",
      USER_A,
    );
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.status).toBe("pending");
  });

  it("reports a replayed day as a duplicate rather than an error", async () => {
    await post("/readings/generate", { user_id: USER_A });
    // A scheduler that re-runs a day it already reserved has done what it was
    // asked to do, so this is 200 rather than a failure the operator must triage.
    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(200);
    expect(body.status).toBe("duplicate");
  });

  it("surfaces an unconfirmed scheduling zone as an actionable 409", async () => {
    await rows("UPDATE users SET timezone_source = 'default_unconfirmed' WHERE id = ?", USER_A);
    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("timezone_confirmation_required");
    expect(body.error?.request_id).toBeTruthy();
  });

  it("separates a dependency outage from a caller mistake", async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_UNAVAILABLE });
    await seedActiveRelease();

    const { status, body } = await post("/readings/generate", { user_id: USER_A });
    expect(status).toBe(503);
    expect(body.error?.code).toBe("calc_unavailable");
  });

  it("validates its bodies", async () => {
    expect((await post("/readings/generate", {})).status).toBe(400);
    expect((await post("/readings/reissue", { user_id: USER_A })).status).toBe(400);
    expect(
      (
        await post("/readings/reissue", {
          user_id: USER_A,
          expected_live_reading_id: "rdg_x",
          revision_reason: "initial",
        })
      ).status,
    ).toBe(400);
    expect(
      (await post("/readings/replace", { user_id: USER_A, reading_id: "rdg_x", reason: "nope" }))
        .status,
    ).toBe(400);
  });

  it("re-dispatches what the outbox committed but never sent", async () => {
    const reserved = await post("/readings/generate", { user_id: USER_A });
    await rows("UPDATE jobs SET dispatched_at = NULL WHERE id = ?", reserved.body.job_id!);

    const { status, body } = await post("/readings/sweep", {});
    expect(status).toBe(200);
    expect(body.undispatched).toBe(1);
    expect(body.redispatched).toBe(1);

    const [job] = await rows<{ dispatched_at: string | null }>(
      "SELECT dispatched_at FROM jobs WHERE id = ?",
      reserved.body.job_id!,
    );
    expect(job!.dispatched_at).not.toBeNull();
  });

  it("is reachable only under /internal, and does not relax the product API", async () => {
    // Without the prefix the handler must not run. It answers 401 rather than
    // 404 because the authenticated product API is mounted at "/" and its
    // wildcard middleware sees every unmatched path first — the point is that
    // generation did not happen, not which refusal was rendered.
    const unprefixed = await SELF.fetch("http://api.test/readings/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: USER_A }),
    });
    expect(unprefixed.status).not.toBe(202);
    expect(await rows("SELECT id FROM daily_readings WHERE user_id = ?", USER_A)).toHaveLength(0);

    // And mounting a second router under /internal has not leaked serviceAuth
    // into the product API, which must still demand a session.
    const product = await SELF.fetch("http://api.test/v1/chart");
    expect(product.status).toBe(401);
  });
});
