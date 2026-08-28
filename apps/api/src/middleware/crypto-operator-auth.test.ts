import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../env.js";
import type { AppVariables } from "./auth.js";
import { cryptoOperatorAuth } from "./crypto-operator-auth.js";

const TOKEN = "crypto_0123456789abcdefghijklmnopqrstuvwxyz";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use("*", cryptoOperatorAuth);
  app.get("/", (c) => c.body(null, 204));
  return app;
}

async function request(
  authorization: string | undefined,
  overrides: Partial<Env> = {},
) {
  return testApp().request("http://test/", {
    headers: authorization ? { authorization } : {},
  }, {
    CRYPTO_OPERATOR_TOKEN: TOKEN,
    SERVICE_AUTH_TOKEN: "service_0123456789abcdefghijklmnopqrstuvwxyz",
    CODEX_RUNNER_TOKEN: "runner_0123456789abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  } as Env);
}

describe("crypto operator authentication", () => {
  it("accepts only the dedicated bearer", async () => {
    expect((await request(undefined)).status).toBe(401);
    expect((await request("Bearer service_0123456789abcdefghijklmnopqrstuvwxyz")).status)
      .toBe(401);
    expect((await request(`Bearer ${TOKEN}`)).status).toBe(204);
  });

  it("fails closed when absent or aliased", async () => {
    expect((await request(`Bearer ${TOKEN}`, { CRYPTO_OPERATOR_TOKEN: "" })).status)
      .toBe(503);
    expect((await request(`Bearer ${TOKEN}`, { SERVICE_AUTH_TOKEN: TOKEN })).status)
      .toBe(503);
    expect((await request(`Bearer ${TOKEN}`, { CODEX_RUNNER_TOKEN: TOKEN })).status)
      .toBe(503);
  });

  it("refuses authorization normalization", async () => {
    expect((await request(`bearer ${TOKEN}`)).status).toBe(401);
    expect((await request(`Bearer  ${TOKEN}`)).status).toBe(401);
  });
});
