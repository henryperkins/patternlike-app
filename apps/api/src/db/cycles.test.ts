import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CYCLE_POLICY_VERSION,
  cyclePassId,
  type NormalizedCycle,
} from "@patternlike/shared";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  CYCLE_FP_EMPTY,
  CYCLE_FP_REFUSED,
  CYCLE_FP_UNAVAILABLE,
  mockCalcService,
} from "../../test/mock-calc-service.js";
import {
  buildCycleRequest,
  invokeCycles,
  type CycleScanInputs,
} from "../services/cycle-client.js";
import { deriveCycle, persistCycles } from "./cycles.js";

const WINDOW = { from: "2026-08-09T05:00:00Z", to: "2026-08-10T05:00:00Z" };

function scanRequest(
  fingerprint: string,
  suppressed?: CycleScanInputs["suppressedFeatures"],
) {
  return buildCycleRequest({
    requestId: "req_cycles_test_00001",
    chartFingerprint: fingerprint,
    natalAccuracy: suppressed?.includes("moon_time_sensitive") ? "unknown" : "exact",
    suppressedFeatures: suppressed,
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
  it("uses a mock boundary that refuses an incomplete scanner request", async () => {
    const incomplete = { ...scanRequest(FINGERPRINT) } as Record<string, unknown>;
    delete incomplete.natal_positions;
    const response = await mockCalcService(
      // The host the Worker actually calls. The interceptor dispatches by host
      // first and fails closed on anything else, so a made-up host here would
      // pass through the wrong branch and prove nothing about /v1/cycles.
      new Request("http://127.0.0.1:8080/v1/cycles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(incomplete),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the scanned cycles for an ordinary chart", async () => {
    const result = await invokeCycles(env, scanRequest(FINGERPRINT));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture scan failed");
    expect(result.response.cycles).toHaveLength(2);
    expect(result.response.cycles[0]!.body).toBe("saturn");
    expect(result.response.cycles[0]!.pass_count).toBe(3);
    expect(result.response.ephemeris_data_version).toBe("se-2.10.03-1800-2399");
  });

  it("treats an empty scan as an ordinary result, not a failure", async () => {
    const result = await invokeCycles(env, scanRequest(CYCLE_FP_EMPTY));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("empty fixture scan failed");
    expect(result.response.cycles).toEqual([]);
  });

  it("separates an engine refusal from never reaching the engine", async () => {
    // The split is what decides whether the scheduler may re-freeze the day
    // unattended: only `unavailable` is a calc_unavailable replacement reason.
    const refused = await invokeCycles(env, scanRequest(CYCLE_FP_REFUSED));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("refusal fixture unexpectedly succeeded");
    expect(refused.kind).toBe("refused");
    if (refused.kind !== "refused") throw new Error("fixture did not reach the engine");
    expect(refused.failure.error_class).toBe("cycle_window_incomplete");

    const unavailable = await invokeCycles(env, scanRequest(CYCLE_FP_UNAVAILABLE));
    expect(unavailable.ok).toBe(false);
    if (unavailable.ok) throw new Error("unavailable fixture unexpectedly succeeded");
    expect(unavailable.kind).toBe("unavailable");
  });

  it("omits natal Moon targets when the chart suppresses time-sensitive Moon claims", async () => {
    const result = await invokeCycles(
      env,
      scanRequest(FINGERPRINT, ["moon_time_sensitive"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("suppressed-feature scan failed");
    expect(result.response.cycles.map((c) => c.target)).not.toContain("moon");
  });

  it("fails closed when CALC_SERVICE_URL is unset", async () => {
    const result = await invokeCycles(
      { ...env, CALC_SERVICE_URL: "" },
      scanRequest(FINGERPRINT),
    );
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("bounds a cycle scan so an unresponsive calculation service cannot hold the job forever", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) throw new DOMException("timed out", "AbortError");
        const req = scanRequest(FINGERPRINT);
        return new Response(
          JSON.stringify({
            ok: true,
            schema_version: req.schema_version,
            request_id: req.request_id,
            chart_fingerprint: req.chart_fingerprint,
            cycle_policy_id: req.cycle_policy_id,
            cycle_policy_version: req.cycle_policy_version,
            orb_policy_id: req.orb_policy_id,
            orb_policy_version: req.orb_policy_version,
            contract_id: req.contract_id,
            contract_version: req.contract_version,
            cycles: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    try {
      const result = await invokeCycles(env, scanRequest(FINGERPRINT));
      expect(result).toMatchObject({ ok: false, kind: "unavailable" });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("rejects a successful response produced for a different calculation contract", async () => {
    const originalFetch = globalThis.fetch;
    const req = scanRequest(FINGERPRINT);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            schema_version: req.schema_version,
            request_id: req.request_id,
            chart_fingerprint: req.chart_fingerprint,
            cycle_policy_id: req.cycle_policy_id,
            cycle_policy_version: req.cycle_policy_version,
            orb_policy_id: req.orb_policy_id,
            orb_policy_version: req.orb_policy_version,
            contract_id: req.contract_id,
            contract_version: "different-contract-version",
            cycles: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    try {
      expect(await invokeCycles(env, req)).toMatchObject({
        ok: false,
        kind: "unavailable",
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});

describe("persistCycles", () => {
  let cycles: NormalizedCycle[];
  let chartId: string;

  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
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
    const expectedPasses = cycles
      .flatMap((cycle, cycleIndex) =>
        cycle.passes.map((pass, passIndex) => ({
          id: derived[cycleIndex]!.passIds[passIndex]!,
          cycle_id: cycle.id,
          pass_index: pass.pass_index,
        })),
      )
      .sort((a, b) =>
        a.cycle_id === b.cycle_id
          ? a.pass_index - b.pass_index
          : a.cycle_id.localeCompare(b.cycle_id),
      );
    expect(passes).toEqual(expectedPasses);
    for (const pass of expectedPasses) {
      expect(pass.id).toBe(await cyclePassId(pass.cycle_id, pass.pass_index));
    }
  });

  it("streams bounded prepared statements and retries after a partial batch failure", async () => {
    const source = cycles[0]!;
    const largeScan = Array.from({ length: 51 }, (_, index) => ({
      ...source,
      id: `cyc_${index.toString(16).padStart(32, "0")}`,
      pass_count: 1,
      passes: [{ ...source.passes[0]!, pass_index: 1 }],
    }));
    let trackPreparedStatements = false;
    let preparedSinceFlush = 0;
    let batchCalls = 0;
    const prepare = env.DB.prepare.bind(env.DB);
    const batch = env.DB.batch.bind(env.DB);
    const boundedPrepare = vi.spyOn(env.DB, "prepare").mockImplementation((query) => {
      if (trackPreparedStatements) {
        preparedSinceFlush += 1;
        if (preparedSinceFlush > 100) {
          throw new Error("D1 prepared statements must flush before the 101st write");
        }
      }
      return prepare(query);
    });
    const limitedBatch = vi.spyOn(env.DB, "batch").mockImplementation(async (statements) => {
      if (statements.length > 100) {
        throw new Error("D1 batch must contain at most 100 statements");
      }
      if (trackPreparedStatements) {
        expect(preparedSinceFlush).toBe(statements.length);
        preparedSinceFlush = 0;
        batchCalls += 1;
        if (batchCalls === 2) {
          throw new Error("simulated D1 batch failure");
        }
      }
      return batch(statements);
    });

    try {
      trackPreparedStatements = true;
      await expect(persistCycles(env, USER_A, chartId, largeScan)).rejects.toThrow(
        "simulated D1 batch failure",
      );
      trackPreparedStatements = false;
      expect(
        await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A),
      ).toHaveLength(50);
      expect(
        await rows("SELECT id FROM cycle_passes WHERE user_id = ?", USER_A),
      ).toHaveLength(50);

      trackPreparedStatements = true;
      await expect(persistCycles(env, USER_A, chartId, largeScan)).resolves.toHaveLength(51);
      trackPreparedStatements = false;
      expect(
        await rows("SELECT id FROM cycle_instances WHERE user_id = ?", USER_A),
      ).toHaveLength(51);
      expect(
        await rows("SELECT id FROM cycle_passes WHERE user_id = ?", USER_A),
      ).toHaveLength(51);
    } finally {
      trackPreparedStatements = false;
      limitedBatch.mockRestore();
      boundedPrepare.mockRestore();
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
         VALUES ('cyp_cross_user_0000000000000001', ?, ?, 9, 'direct', ?, 1.0, ?)`,
      )
        .bind(cycles[0]!.id, USER_B, cycles[0]!.exact_at, new Date().toISOString())
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});
