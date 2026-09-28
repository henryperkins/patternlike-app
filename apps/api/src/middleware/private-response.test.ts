import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../index.js";
import { confirmPreferences, IDENTITY_A, resetDb, seedUser, USER_A } from "../../test/helpers.js";

const userHeaders = { "x-user-id": USER_A };
const privatePolicy = "private, no-store";

describe("private response boundary", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it.each([
    ["/v1/readings/today", "GET"],
    ["/v1/readings", "GET"],
    ["/v1/readings/absent/evidence", "GET"],
    ["/v1/readings/absent/feedback", "GET"],
    ["/v1/sessions", "POST"],
    ["/v1/account/deletion-status", "GET"],
    ["/admin/pattern-generations", "GET"],
    ["/internal/readings/generate", "POST"],
    ["/codex-provider/claim", "POST"],
    ["/crypto-operator/rotations", "POST"],
  ])("protects %s before configuration refusal", async (path, method) => {
    const response = await app.request(path, { method }, { ...env, ENVIRONMENT: "production", AUTH_STUB: "1" });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects successful private reads", async () => {
    const response = await app.request("/v1/consents/account-processing", { headers: userHeaders }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it.each(["/v1/readings/today", "/v1/readings", "/v1/readings/absent/evidence", "/v1/readings/absent/feedback"])("protects authentication refusal for %s", async (path) => {
    const response = await app.request(path, {}, env);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects account-state refusal", async () => {
    await env.DB.prepare("UPDATE users SET status='frozen' WHERE id=?").bind(USER_A).run();
    const response = await app.request("/v1/readings/today", { headers: userHeaders }, env);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects validation refusal without requiring a session to exchange one", async () => {
    const response = await app.request("/v1/sessions", { method: "POST", body: "{}" }, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_body" } });
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects missing private resources", async () => {
    await confirmPreferences(USER_A);
    const response = await app.request("/v1/readings/today", { headers: userHeaders }, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects preference conflict", async () => {
    await confirmPreferences(USER_A);
    await env.DB.prepare("UPDATE users SET timezone_source='default_unconfirmed' WHERE id=?").bind(USER_A).run();
    const response = await app.request("/v1/readings/today", { headers: userHeaders }, env);
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it("protects uncaught server failures", async () => {
    const bindings = { ...env, DB: new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === "prepare") return () => { throw new Error("unavailable database"); };
        return Reflect.get(target, property, receiver);
      },
    }) };
    const response = await app.request("/v1/readings/today", { headers: userHeaders }, bindings);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
    expect(response.headers.get("cache-control")).toBe(privatePolicy);
  });

  it.each(["/health", "/v1/meta"])("keeps %s public outside configuration checks", async (path) => {
    const response = await app.request(path, {}, { ...env, ENVIRONMENT: "production", AUTH_STUB: "1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
