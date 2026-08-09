import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../index.js";
import { resetDb, rows } from "../../test/helpers.js";
import { linkIdentity } from "../db/identities.js";
import { createSession } from "../db/sessions.js";

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
    // A *properly configured* production environment. The values spread from
    // `env` are wrangler.toml's issuer.invalid placeholders, which configGuard
    // now refuses — that refusal is the point, so override rather than relax it.
    OIDC_ISSUER: "https://issuer.example.com",
    OIDC_AUDIENCE: "patternlike-web",
    OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
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
    // The request carries no Idempotency-Key, so the ingestion handler's own
    // first refusal is what comes back. That it is the handler's code and not
    // `unauthorized` is what proves serviceAuth passed.
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("idempotency_key_required");
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

describe("authenticate", () => {
  beforeEach(resetDb);

  it("rejects a request with no credential", async () => {
    const res = await app.request("/v1/chart", {}, prodEnv());
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("rejects an unknown bearer", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: "Bearer totally-made-up" } },
      prodEnv(),
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("never answers 501 auth_not_configured again", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: "Bearer anything" } },
      prodEnv(),
    );
    expect(res.status).not.toBe(501);
    expect((await body(res)).error?.code).not.toBe("auth_not_configured");
  });

  it("accepts a live session presented as a bearer", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const res = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    // No chart exists for this user yet, so 404 — but authentication passed.
    // The code is `chart_not_found` (routes/chart.ts), NOT the router's
    // `not_found`: reaching the handler at all is what proves auth succeeded.
    expect(res.status).toBe(404);
    expect((await body(res)).error?.code).toBe("chart_not_found");
  });

  it("accepts the same session presented as a cookie", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const res = await app.request(
      "/v1/chart",
      { headers: { cookie: `pl_session=${token}` } },
      prodEnv(),
    );
    expect(res.status).toBe(404);
    expect((await body(res)).error?.code).toBe("chart_not_found");
  });

  it("rejects a revoked session presented as a cookie", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ?")
      .bind(new Date().toISOString())
      .run();

    const res = await app.request(
      "/v1/chart",
      { headers: { cookie: `pl_session=${token}` } },
      prodEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns the same request id it was given", async () => {
    const res = await app.request(
      "/v1/chart",
      { headers: { "x-request-id": "req-abc-123" } },
      prodEnv(),
    );
    expect((await body(res)).error?.request_id).toBe("req-abc-123");
  });

  it("503s loudly rather than 401ing when identity is unconfigured", async () => {
    // A deploy that never replaced the shipped placeholder should fail at the
    // guard, not per-request inside the verifier as an opaque 401.
    const res = await app.request(
      "/v1/chart",
      {},
      prodEnv({ OIDC_JWKS_URL: "https://issuer.invalid/.well-known/jwks.json" }),
    );
    expect(res.status).toBe(503);
    expect((await body(res)).error?.code).toBe("configuration_error");
  });

  it("still trusts X-User-Id under AUTH_STUB=1 in development", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const res = await app.request(
      "/v1/chart",
      { headers: { "x-user-id": id.userId } },
      { ...env, ENVIRONMENT: "development", AUTH_STUB: "1" },
    );
    expect(res.status).toBe(404);
  });

  it("401s under AUTH_STUB=1 when the header names no existing user", async () => {
    // The header names a user; it can no longer conjure one. Fabricating a
    // crypto subject from a header would produce ciphertext nobody can read.
    const res = await app.request(
      "/v1/chart",
      { headers: { "x-user-id": "usr_does_not_exist_0001" } },
      { ...env, ENVIRONMENT: "development", AUTH_STUB: "1" },
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });
});

describe("POST /v1/sessions", () => {
  beforeEach(resetDb);

  it("is reachable without an existing session", async () => {
    const res = await app.request(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_token: "not-a-real-token" }),
      },
      prodEnv(),
    );
    // 401 because the token is bad — NOT 401 because a session was required.
    expect(res.status).toBe(401);
    expect((await body(res)).error?.code).toBe("unauthorized");
  });

  it("rejects a body with no id_token", async () => {
    const res = await app.request(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
      prodEnv(),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("invalid_body");
  });

  it("never leaks the underlying verification failure", async () => {
    const res = await app.request(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_token: "not-a-real-token" }),
      },
      prodEnv(),
    );
    const message = (await body(res)).error?.message ?? "";
    expect(message).toBe("Authentication required");
    expect(message).not.toMatch(/jwt|token|kid|claim|signature/i);
  });

  it("revokes the current session on DELETE and stops accepting its token", async () => {
    const id = await linkIdentity(env, "oidc", "sub-alice");
    const { token } = await createSession(env, id.userId);

    const del = await app.request(
      "/v1/sessions/current",
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    expect(del.status).toBe(204);

    const after = await app.request(
      "/v1/chart",
      { headers: { authorization: `Bearer ${token}` } },
      prodEnv(),
    );
    expect(after.status).toBe(401);

    const live = await rows("SELECT id FROM sessions WHERE revoked_at IS NULL");
    expect(live).toHaveLength(0);
  });

  it("is idempotent on DELETE with no credential at all", async () => {
    const res = await app.request(
      "/v1/sessions/current",
      { method: "DELETE" },
      prodEnv(),
    );
    expect(res.status).toBe(204);
  });
});
