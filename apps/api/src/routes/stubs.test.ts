import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { resetDb, seedUser, IDENTITY_A, USER_A } from "../../test/helpers.js";

interface ErrorEnvelope {
  error: { code: string; message: string; request_id: string | null };
}

async function callStub(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ErrorEnvelope }> {
  const res = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: { "x-user-id": USER_A, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as ErrorEnvelope };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

/**
 * These stubs were the only error producers in the Worker that omitted
 * `request_id`, so every client rendering "(Request <id>)" on a 501 had nothing
 * to print and no thread for support to follow.
 */
describe("not-implemented stubs", () => {
  const routes: Array<[string, RequestInit]> = [
    ["/v1/readings/rdg_seed_00000001/feedback", { method: "POST" }],
  ];

  it.each(routes)("answers %s with a 501 carrying a request id", async (path, init) => {
    const { status, body } = await callStub(path, init);

    expect(status).toBe(501);
    expect(body.error.code).toBe("not_implemented");
    expect(body.error.request_id).toBeTruthy();
  });

  it("echoes a caller-supplied x-request-id so a client can correlate it", async () => {
    const { body } = await callStub("/v1/readings/rdg_seed_00000001/feedback", {
      method: "POST",
      headers: { "x-request-id": "req-stub-correlation-1" },
    });

    expect(body.error.request_id).toBe("req-stub-correlation-1");
  });
});
