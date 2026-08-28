import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { IDENTITY_A, resetDb, rows, seedUser, USER_A } from "../../test/helpers.js";

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("crypto operation schema", () => {
  it("backfills existing live keys with the legacy root key identity", async () => {
    expect(
      await rows<{ root_kek_id: string }>(
        "SELECT root_kek_id FROM user_keys WHERE user_id = ?",
        USER_A,
      ),
    ).toEqual([{ root_kek_id: "legacy" }]);
  });

  it("enforces one active DEK operation for a user", async () => {
    const now = new Date().toISOString();
    const insert = (id: string, hash: string) => env.DB.prepare(
      `INSERT INTO crypto_operations (
         id, kind, user_id, idempotency_hash, stage, original_account_status,
         not_before, created_at, updated_at
       ) VALUES (?, 'dek_rotate', ?, ?, 'quiescing', 'active', ?, ?, ?)`,
    ).bind(id, USER_A, hash, now, now, now);

    await insert("cop_00000000000000000000000000000001", "sha256:a").run();
    await expect(
      insert("cop_00000000000000000000000000000002", "sha256:b").run(),
    ).rejects.toThrow();
  });

  it("enforces one running or blocked fleet campaign", async () => {
    const now = new Date().toISOString();
    const insert = (id: string, hash: string) => env.DB.prepare(
      `INSERT INTO crypto_kek_rewrap_campaigns (
         id, idempotency_hash, target_root_kek_id, status, total_count,
         created_at, updated_at
       ) VALUES (?, ?, 'root-2026-09', 'running', 0, ?, ?)`,
    ).bind(id, hash, now, now);

    await insert("ckc_00000000000000000000000000000001", "sha256:a").run();
    await expect(
      insert("ckc_00000000000000000000000000000002", "sha256:b").run(),
    ).rejects.toThrow();
  });
});
