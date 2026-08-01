import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { resetDb, rows } from "../test/helpers.js";

/**
 * Guards the test harness itself. If one of these fails, every other
 * integration test in this workspace is testing nothing.
 */
describe("workers test harness", () => {
  it("binds a real D1 with the migration applied", async () => {
    const tables = await rows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain("birth_profiles");
    expect(names).toContain("chart_snapshots");
    expect(names).toContain("user_keys");
    expect(names).toContain("jobs");
  });

  it("carries the schema fixes from the remediation", async () => {
    const indexes = await rows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index'",
    );
    const names = indexes.map((i) => i.name);
    // Per-user idempotency scoping and one-live-key-per-user.
    expect(names).toContain("uq_jobs_scope_key");
    expect(names).toContain("uq_user_keys_active");
  });

  it("dispatches a real request into the Hono app", async () => {
    const res = await SELF.fetch("http://api.test/health");
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });

  it("routes outbound fetch to the mock calculation service, never the network", async () => {
    const res = await fetch("http://127.0.0.1:8080/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "harness",
        user_id: "usr_harness_000001",
        profile_version: 1,
        accuracy: "exact",
        birth_date: "1990-05-15",
        birth_time_local: "12:00:00",
        timezone: "UTC",
        latitude: 0,
        longitude: 0,
        place_label: null,
        contract_id: "calc-contract-launch",
        contract_version: "0.2.0",
      }),
    });
    const body = (await res.json()) as { ok: boolean; chart: { fingerprint: string } | null };
    expect(body.ok).toBe(true);
    expect(body.chart?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  describe("explicit reset", () => {
    // Storage is NOT auto-isolated per test in this pool version, so every
    // integration suite calls resetDb() in beforeEach. These two tests prove
    // that contract holds — if it stops working, tests start leaking into
    // each other and passing for the wrong reasons.
    beforeEach(resetDb);

    it("writes are visible within a test", async () => {
      await env.DB.prepare(
        "INSERT INTO users (id, crypto_subject, status, locale, timezone," +
          " entitlement_tier, created_at, updated_at)" +
          " VALUES ('usr_reset_probe_1','cs_reset_probe_1','active','en-US','UTC'," +
          "'free','2026-01-01','2026-01-01')",
      ).run();
      expect(await rows("SELECT id FROM users")).toHaveLength(1);
    });

    it("and are gone by the next test", async () => {
      expect(await rows("SELECT id FROM users")).toHaveLength(0);
    });
  });
});
