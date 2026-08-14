import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { resetDb, seedUser, IDENTITY_A, USER_A } from "../../test/helpers.js";

interface ErrorEnvelope {
  error: { code: string; message: string; request_id: string | null };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("retired not-implemented stubs", () => {
  it("no longer answers reading feedback with 501", async () => {
    const res = await SELF.fetch(
      "http://api.test/v1/readings/rdg_seed_00000001/feedback",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "idem-feedback-stub-retired",
          "x-request-id": "req-stub-correlation-1",
        },
        body: JSON.stringify({ resonance: "helpful" }),
      },
    );
    const body = (await res.json()) as ErrorEnvelope;
    expect(res.status).not.toBe(501);
    expect(body.error.code).not.toBe("not_implemented");
    expect(body.error.request_id).toBe("req-stub-correlation-1");
  });
});
