import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CYCLE_POLICY_VERSION,
  cyclePassId,
  type NormalizedCycle,
} from "@patternlike/shared";
import { IDENTITY_A, USER_A, resetDb, rows, seedChart, seedUser } from "../../test/helpers.js";
import {
  CYCLE_FP_EMPTY,
  CYCLE_FP_REFUSED,
  CYCLE_FP_UNAVAILABLE,
} from "../../test/mock-calc-service.js";
import { buildCycleRequest, invokeCycles } from "../services/cycle-client.js";
import { deriveCycle, persistCycles } from "./cycles.js";

const WINDOW = { from: "2026-08-09T05:00:00Z", to: "2026-08-10T05:00:00Z" };

function scanRequest(fingerprint: string, suppressed?: string[]) {
  return buildCycleRequest({
    requestId: "req_cycles_test_00001",
    chartFingerprint: fingerprint,
    natalAccuracy: suppressed?.includes("moon_time_sensitive") ? "unknown" : "exact",
    suppressedFeatures: suppressed as never,
    natalPositions: [
      { body: "sun", longitude_deg: 54.703 },
      { body: "moon", longitude_deg: 128.44 },
    ],
    window: WINDOW,
    contractId: "calc-contract-launch",
    contractVersion: "0.2.0",
  });
}

const FINGERPRINT = `sha256:${"1a".repeat(32)}`;

describe("invokeCycles", () => {
  it("returns the scanned cycles for an ordinary chart", async () => {
    const result = await invokeCycles(env, scanRequest(FINGERPRINT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cycles).toHaveLength(2);
    expect(result.response.cycles[0]!.body).toBe("saturn");
    expect(result.response.cycles[0]!.pass_count).toBe(3);
    expect(result.response.ephemeris_data_version).toBe("se-2.10.03-1800-2399");
  });

  it("treats an empty scan as an ordinary result, not a failure", async () => {
    const result = await invokeCycles(env, scanRequest(CYCLE_FP_EMPTY));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cycles).toEqual([]);
  });

  it("separates an engine refusal from never reaching the engine", async () => {
    // The split is what decides whether the scheduler may re-freeze the day
    // unattended: only `unavailable` is a calc_unavailable replacement reason.
    const refused = await invokeCycles(env, scanRequest(CYCLE_FP_REFUSED));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.kind).toBe("refused");
    if (refused.kind !== "refused") return;
    expect(refused.failure.error_class).toBe("cycle_window_incomplete");

    const unavailable = await invokeCycles(env, scanRequest(CYCLE_FP_UNAVAILABLE));
    expect(unavailable.ok).toBe(false);
    if (unavailable.ok) return;
    expect(unavailable.kind).toBe("unavailable");
  });

  it("omits natal Moon targets when the chart suppresses time-sensitive Moon claims", async () => {
    const result = await invokeCycles(
      env,
      scanRequest(FINGERPRINT, ["moon_time_sensitive"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cycles.map((c) => c.target)).not.toContain("moon");
  });

  it("fails closed when CALC_SERVICE_URL is unset", async () => {
    const result = await invokeCycles(
      { ...env, CALC_SERVICE_URL: "" },
      scanRequest(FINGERPRINT),
    );
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("persistCycles", () => {
  let cycles: NormalizedCycle[];
  let chartId: string;

  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    ({ chartId } = await seedChart(IDENTITY_A));
    const scan = await invokeCycles(env, scanRequest(FINGERPRINT));
    if (!scan.ok) throw new Error("fixture scan failed");
    cycles = scan.response.cycles;
  });

  it("writes every cycle and every pass with derived ids", async () => {
    const derived = await persistCycles(env, USER_A, chartId, cycles);
    expect(derived).toHaveLength(2);
    expect(derived[0]!.passIds).toHaveLength(3);
    expect(derived[0]!.hash).toMatch(/^[a-f0-9]{64}$/);

    const instances = await rows<{ id: string; pass_count: number; horizon_version: string; phase: string | null }>(
      "SELECT id, pass_count, horizon_version, phase FROM cycle_instances WHERE user_id = ? ORDER BY exact_at",
      USER_A,
    );
    expect(instances).toHaveLength(2);
    expect(instances[0]!.pass_count).toBe(3);
    expect(instances[0]!.horizon_version).toBe(CYCLE_POLICY_VERSION);
    // Phase is a function of the cycle AND the day, so it is not stored.
    expect(instances[0]!.phase).toBeNull();

    const passes = await rows<{ id: string; cycle_id: string; pass_index: number }>(
      "SELECT id, cycle_id, pass_index FROM cycle_passes WHERE user_id = ? ORDER BY cycle_id, pass_index",
      USER_A,
    );
    expect(passes).toHaveLength(4);
    for (const pass of passes) {
      expect(pass.id).toBe(await cyclePassId(pass.cycle_id, pass.pass_index));
    }
  });

  it("is idempotent: a second identical scan creates no new rows", async () => {
    await persistCycles(env, USER_A, chartId, cycles);
    const first = await rows("SELECT id FROM cycle_passes WHERE user_id = ?", USER_A);

    await persistCycles(env, USER_A, chartId, cycles);
    const second = await rows("SELECT id FROM cycle_passes WHERE user_id = ?", USER_A);

    expect(second).toHaveLength(first.length);
    expect(await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A)).toHaveLength(2);
  });

  it("keeps the first envelope when a rescan refines one, and the hash notices", async () => {
    await persistCycles(env, USER_A, chartId, cycles);
    const original = await deriveCycle(cycles[0]!);

    const refined: NormalizedCycle = {
      ...cycles[0]!,
      end_at: "2027-01-27T18:44:02Z",
    };
    await persistCycles(env, USER_A, chartId, [refined]);

    const [row] = await rows<{ end_at: string }>(
      "SELECT end_at FROM cycle_instances WHERE id = ?",
      cycles[0]!.id,
    );
    // Not overwritten: a published reading's inputs are not rewritten in place.
    expect(row!.end_at).toBe(cycles[0]!.end_at);
    // The divergence is caught by the pinned hash instead, which is a state an
    // operator can see rather than a silent substitution.
    expect((await deriveCycle(refined)).hash).not.toBe(original.hash);
  });

  it("accepts an empty scan without writing anything", async () => {
    const derived = await persistCycles(env, USER_A, chartId, []);
    expect(derived).toEqual([]);
    expect(await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A)).toHaveLength(0);
  });

  it("refuses a pass whose parent cycle belongs to another user", async () => {
    await persistCycles(env, USER_A, chartId, cycles);
    await expect(
      env.DB.prepare(
        `INSERT INTO cycle_passes
           (id, cycle_id, user_id, pass_index, direction, exact_at, speed_deg_per_day, created_at)
         VALUES ('cyp_cross_user_0000000000000001', ?, 'usr_test_bob_000001', 9, 'direct', ?, 1.0, ?)`,
      )
        .bind(cycles[0]!.id, cycles[0]!.exact_at, new Date().toISOString())
        .run(),
    ).rejects.toThrow();
  });
});
