import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  seedUser,
} from "../../test/helpers.js";

async function request(path: string, init: RequestInit = {}) {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: { "x-user-id": USER_A, ...(init.headers ?? {}) },
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      error?: { code: string; request_id: string | null };
    },
  };
}

async function setStatus(
  status: "active" | "frozen" | "pending_deletion" | "deleted",
) {
  await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?")
    .bind(status, USER_A)
    .run();
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("central account-state policy", () => {
  it("allows active accounts to use ordinary product routes", async () => {
    const result = await request("/v1/time-travel?date=2026-08-12");

    expect(result.status).toBe(501);
    expect(result.body.error?.code).toBe("not_implemented");
  });

  it("limits frozen accounts to consent recovery, export, and deletion", async () => {
    await setStatus("frozen");

    const ordinary = await request("/v1/time-travel?date=2026-08-12");
    expect(ordinary.status).toBe(403);
    expect(ordinary.body.error?.code).toBe("account_not_active");

    expect((await request("/v1/consents/ai-synthesis")).status).toBe(200);
    expect(
      (
        await request("/v1/exports", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-export-frozen",
          },
          body: "{}",
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request("/v1/account", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-delete-frozen",
          },
          body: JSON.stringify({ confirm: "DELETE" }),
        })
      ).status,
    ).toBe(202);
  });

  it.each(["pending_deletion", "deleted"] as const)(
    "blocks every normal route for a %s account",
    async (status) => {
      await setStatus(status);

      for (const path of [
        "/v1/time-travel?date=2026-08-12",
        "/v1/consents/ai-synthesis",
        "/v1/exports",
        "/v1/account",
      ]) {
        const result = await request(path);
        expect(result.status, path).toBe(403);
        expect(result.body.error?.code, path).toBe("account_not_active");
        expect(result.body.error?.request_id, path).toBeTruthy();
      }
    },
  );
});
