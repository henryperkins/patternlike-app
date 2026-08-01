import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../index.js";

/**
 * These drive the real Hono app but override bindings per request via
 * app.request's third argument, so a production-shaped configuration can be
 * exercised without a second vitest project. SELF.fetch cannot do this —
 * it uses wrangler.toml's [vars] for the whole run.
 *
 * AUTH_STUB is `string` on Env rather than optional, so the non-stub path is
 * selected with an empty string: falsy and !== "1".
 */
function prodEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    ENVIRONMENT: "production",
    AUTH_STUB: "",
    ROOT_KEK: "test-root-kek-that-is-long-enough-to-pass",
    SERVICE_AUTH_TOKEN: "svc-token-for-internal-only",
    ...overrides,
  };
}

async function body(
  res: Response,
): Promise<{ error?: { code?: string; message?: string; request_id?: string } }> {
  return (await res.json()) as {
    error?: { code?: string; message?: string; request_id?: string };
  };
}

describe("service auth is scoped to /internal", () => {
  /**
   * These two assertions must DISCRIMINATE. Before the fix, serviceAuth answers
   * `/v1/chart` with 401 + code "unauthorized" — the same code the consumer path
   * uses — so asserting on the code alone passes both before and after and
   * guards nothing. The `message` is what differs: "Invalid service token" comes
   * only from serviceAuth (auth.ts:92), and no consumer path ever emits it,
   * including `authenticate` after Task 8.
   */
  it("does not gate GET /v1/chart on the service token", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect((await body(res)).error?.message).not.toBe("Invalid service token");
  });

  it("does not 503 GET /v1/chart when the service token is unset", async () => {
    // Before the fix this is 503 service_auth_not_configured — the failure mode
    // that makes the documented deploy steps break the consumer API.
    const res = await app.request(
      "/v1/chart",
      {},
      prodEnv({ SERVICE_AUTH_TOKEN: undefined }),
    );
    expect(res.status).not.toBe(503);
    expect((await body(res)).error?.code).not.toBe("service_auth_not_configured");
  });

  it("does not gate POST /v1/birth-profiles on the service token", async () => {
    const res = await app.request(
      "/v1/birth-profiles",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      prodEnv(),
    );
    expect((await body(res)).error?.message).not.toBe("Invalid service token");
  });

  it("still gates POST /internal/content-releases on the service token", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST" },
      prodEnv(),
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("accepts the internal route with the correct service token", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST", headers: { authorization: "Bearer svc-token-for-internal-only" } },
      prodEnv(),
    );
    // The handler is an honest 501 stub; reaching it proves serviceAuth passed.
    expect(res.status).toBe(501);
  });

  it("returns 503 on the internal route when the service token is unset", async () => {
    const res = await app.request(
      "/internal/content-releases",
      { method: "POST" },
      prodEnv({ SERVICE_AUTH_TOKEN: undefined }),
    );
    expect(res.status).toBe(503);
    expect((await body(res)).error?.code).toBe("service_auth_not_configured");
  });
});
