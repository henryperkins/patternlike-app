import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "../../test/helpers.js";

const RUNNER_TOKEN = "runner_0123456789abcdefghijklmnopqrstuvwxyz";

async function claim(authorization?: string): Promise<Response> {
  return SELF.fetch("https://worker.test/codex-provider/v1/jobs/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: "{}",
  });
}

describe("Codex runner authentication", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_RUNNER_TOKEN = RUNNER_TOKEN;
    env.SERVICE_AUTH_TOKEN = "";
    env.PATTERN_ADMIN_TOKEN = "";
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
      version: 1,
      keys: {
        "codex-test-key": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      },
    });
  });

  it("requires the dedicated token and does not accept service authentication", async () => {
    env.SERVICE_AUTH_TOKEN = "service-token-that-must-not-cross-authorities";

    expect((await claim()).status).toBe(401);
    expect((await claim("Bearer service-token-that-must-not-cross-authorities")).status)
      .toBe(401);
    expect((await claim(`Bearer ${RUNNER_TOKEN}`)).status).toBe(204);
  });

  it("fails closed when the dedicated secret is absent", async () => {
    env.CODEX_RUNNER_TOKEN = "";
    const response = await claim(`Bearer ${RUNNER_TOKEN}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "codex_runner_auth_not_configured" },
    });
  });

  it.each(["SERVICE_AUTH_TOKEN", "PATTERN_ADMIN_TOKEN"] as const)(
    "fails closed when the runner token aliases %s",
    async (authority) => {
      env[authority] = RUNNER_TOKEN;
      const response = await claim(`Bearer ${RUNNER_TOKEN}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "configuration_error" },
      });
    },
  );

  it("refuses malformed authorization instead of normalizing it", async () => {
    expect((await claim(`bearer ${RUNNER_TOKEN}`)).status).toBe(401);
    expect((await claim(`Bearer  ${RUNNER_TOKEN}`)).status).toBe(401);
    expect((await claim(`Bearer ${RUNNER_TOKEN} suffix`)).status).toBe(401);
  });
});
