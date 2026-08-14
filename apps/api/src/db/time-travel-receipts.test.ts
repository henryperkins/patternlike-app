import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  M3_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  type CycleRequest,
  type CycleResponseSuccess,
} from "@patternlike/shared";
import { IDENTITY_A, resetDb, rows, seedChart, seedUser } from "../../test/helpers.js";
import {
  MAX_SCAN_RECEIPTS_PER_USER,
  MAX_SCAN_RESULT_BYTES,
  loadScanReceipt,
  persistScanReceipt,
  reserveScanBudget,
  type ScanReceiptKey,
} from "./time-travel-receipts.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");

function key(chartId: string, fingerprint: string): ScanReceiptKey {
  return {
    userId: IDENTITY_A.userId,
    chartId,
    chartFingerprint: fingerprint,
    localDate: "2026-08-10",
    schedulingTimezone: "America/Chicago",
    windowFrom: "2026-08-10T05:00:00Z",
    windowTo: "2026-08-11T05:00:00Z",
    tzdbVersion: "2026a",
    localDayResolutionPolicyVersion: "1.0.0",
    contractId: "calc-contract-launch",
    contractVersion: "0.2.0",
    receiptEpoch: 1,
  };
}

function request(fingerprint: string): CycleRequest {
  return {
    schema_version: M3_SCHEMA_VERSION,
    request_id: "req_receipt_test",
    chart_fingerprint: fingerprint,
    natal_positions: [{ body: "sun", longitude_deg: 15 }],
    natal_accuracy: "exact",
    window: { from: "2026-08-10T05:00:00Z", to: "2026-08-11T05:00:00Z" },
    techniques: ["transits"],
    cycle_policy_id: CYCLE_POLICY_ID,
    cycle_policy_version: CYCLE_POLICY_VERSION,
    orb_policy_id: TRANSIT_ORB_POLICY_ID,
    orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
  };
}

function response(fingerprint: string): CycleResponseSuccess {
  return {
    ok: true,
    schema_version: M3_SCHEMA_VERSION,
    request_id: "req_receipt_test",
    chart_fingerprint: fingerprint,
    cycle_policy_id: CYCLE_POLICY_ID,
    cycle_policy_version: CYCLE_POLICY_VERSION,
    orb_policy_id: TRANSIT_ORB_POLICY_ID,
    orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    container_digest: `sha256:${"4d".repeat(32)}`,
    ephemeris_data_version: "se-test",
    cycles: [],
  };
}

describe("Time Travel spend ledger", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("reserves the whole miss count atomically and never partially crosses 32", async () => {
    expect(await reserveScanBudget(env, IDENTITY_A.userId, 2, 32, NOW)).toMatchObject({ ok: true, reserved: 2 });
    for (let expected = 4; expected <= 32; expected += 2) {
      expect(await reserveScanBudget(env, IDENTITY_A.userId, 2, 32, NOW))
        .toMatchObject({ ok: true, reserved: expected });
    }
    const denied = await reserveScanBudget(env, IDENTITY_A.userId, 2, 32, NOW);
    expect(denied).toMatchObject({ ok: false, resetsAt: "2026-08-14T00:00:00.000Z" });
    expect(await rows<{ reserved_scan_count: number }>(
      "SELECT reserved_scan_count FROM time_travel_daily_usage WHERE user_id = ?",
      IDENTITY_A.userId,
    )).toEqual([{ reserved_scan_count: 32 }]);
  });

  it("charges a zero-miss cache hit nothing", async () => {
    expect(await reserveScanBudget(env, IDENTITY_A.userId, 0, 32, NOW))
      .toEqual({ ok: true, reserved: 0 });
    expect(await rows("SELECT * FROM time_travel_daily_usage")).toHaveLength(0);
  });
});

describe("immutable Time Travel scan receipts", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("persists and validates successful empty results while removing request IDs", async () => {
    const chart = await seedChart(IDENTITY_A);
    const receipt = await persistScanReceipt(
      env,
      key(chart.chartId, chart.fingerprint),
      request(chart.fingerprint),
      response(chart.fingerprint),
      JSON.stringify(response(chart.fingerprint)),
      NOW,
    );
    expect(receipt.cycles).toEqual([]);
    const stored = await loadScanReceipt(env, key(chart.chartId, chart.fingerprint));
    expect(stored).toEqual(receipt);
    const raw = await rows<{ result_json: string }>("SELECT result_json FROM cycle_scan_receipts");
    expect(raw[0]!.result_json).not.toContain("request_id");
  });

  it("fails closed when stored normalized bytes no longer match the receipt hash", async () => {
    const chart = await seedChart(IDENTITY_A);
    await persistScanReceipt(
      env,
      key(chart.chartId, chart.fingerprint),
      request(chart.fingerprint),
      response(chart.fingerprint),
      JSON.stringify(response(chart.fingerprint)),
      NOW,
    );
    await env.DB.prepare("UPDATE cycle_scan_receipts SET result_json = '[{}]'").run();
    await expect(loadScanReceipt(env, key(chart.chartId, chart.fingerprint)))
      .rejects.toThrow("receipt integrity");
  });

  it("rejects a normalized result over the 512 KiB application cap before writing", async () => {
    const chart = await seedChart(IDENTITY_A);
    const oversized = response(chart.fingerprint);
    oversized.cycles = [{ padding: "x".repeat(MAX_SCAN_RESULT_BYTES) }] as never;
    await expect(persistScanReceipt(
      env,
      key(chart.chartId, chart.fingerprint),
      request(chart.fingerprint),
      oversized,
      JSON.stringify(oversized),
      NOW,
    )).rejects.toThrow("512 KiB");
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(0);
  });

  it("keys on the receipt epoch and never selects an old-epoch row", async () => {
    const chart = await seedChart(IDENTITY_A);
    const first = key(chart.chartId, chart.fingerprint);
    await persistScanReceipt(env, first, request(chart.fingerprint), response(chart.fingerprint), "{}", NOW);
    expect(await loadScanReceipt(env, first)).not.toBeNull();

    // An operator bumps the epoch before a result-changing calculation deploy.
    // The old row is not selected, and it is not mutated either.
    const bumped = { ...first, receiptEpoch: 2 };
    expect(await loadScanReceipt(env, bumped)).toBeNull();
    expect(await rows("SELECT id FROM cycle_scan_receipts WHERE receipt_epoch = 1")).toHaveLength(1);

    const next = await persistScanReceipt(
      env,
      bumped,
      request(chart.fingerprint),
      { ...response(chart.fingerprint), container_digest: `sha256:${"7e".repeat(32)}` },
      "{}",
      new Date(NOW.getTime() + 1000),
    );
    expect(next.receiptId).toMatch(/^csr_/);
    // The insert prunes every other epoch: an old-epoch row can never be
    // resurrected by a later bump back to its number.
    expect(await rows<{ receipt_epoch: number }>(
      "SELECT receipt_epoch FROM cycle_scan_receipts ORDER BY receipt_epoch",
    )).toEqual([{ receipt_epoch: 2 }]);
  });

  it("fails closed when one epoch spans two calculation vintages", async () => {
    const chart = await seedChart(IDENTITY_A);
    const first = key(chart.chartId, chart.fingerprint);
    await persistScanReceipt(env, first, request(chart.fingerprint), response(chart.fingerprint), "{}", NOW);

    // Same epoch, a different container digest: the deployment changed and
    // nobody bumped TIME_TRAVEL_RECEIPT_EPOCH. Serving the old cache beside the
    // new one would mix two calculation vintages under one identity.
    await expect(
      persistScanReceipt(
        env,
        { ...first, windowFrom: "2026-08-11T05:00:00Z", windowTo: "2026-08-12T05:00:00Z" },
        request(chart.fingerprint),
        { ...response(chart.fingerprint), container_digest: `sha256:${"9a".repeat(32)}` },
        "{}",
        new Date(NOW.getTime() + 1000),
      ),
    ).rejects.toThrow(/different calculation vintages/);
  });

  it("converges two responses that differ only by request id, and keeps their raw digests apart", async () => {
    const chart = await seedChart(IDENTITY_A);
    const scanKey = key(chart.chartId, chart.fingerprint);
    const first = await persistScanReceipt(
      env,
      scanKey,
      { ...request(chart.fingerprint), request_id: "req_first" },
      { ...response(chart.fingerprint), request_id: "req_first" },
      JSON.stringify({ request_id: "req_first" }),
      NOW,
    );

    // The loser of a race re-reads and accepts the winner, because the semantic
    // hash is taken over the response with `request_id` removed.
    const second = await persistScanReceipt(
      env,
      scanKey,
      { ...request(chart.fingerprint), request_id: "req_second" },
      { ...response(chart.fingerprint), request_id: "req_second" },
      JSON.stringify({ request_id: "req_second" }),
      new Date(NOW.getTime() + 500),
    );
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.semanticResultHash).toBe(first.semanticResultHash);
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(1);

    // The raw byte digest is retained for audit and is deliberately not what
    // convergence is decided on: these two raw bodies differ.
    const digests = await rows<{ raw_response_sha256: string; result_json: string }>(
      "SELECT raw_response_sha256, result_json FROM cycle_scan_receipts",
    );
    expect(digests[0]!.raw_response_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(digests[0]!.result_json).not.toContain("request_id");
  });

  it("fails closed when the same key produced a different semantic result", async () => {
    const chart = await seedChart(IDENTITY_A);
    const scanKey = key(chart.chartId, chart.fingerprint);
    await persistScanReceipt(env, scanKey, request(chart.fingerprint), response(chart.fingerprint), "{}", NOW);

    await expect(
      persistScanReceipt(
        env,
        scanKey,
        request(chart.fingerprint),
        {
          ...response(chart.fingerprint),
          cycles: [{
            id: "cyc_" + "c0".repeat(16),
            technique: "transit",
            body: "saturn",
            target: "sun",
            aspect: "square",
            start_at: "2026-08-01T00:00:00.000Z",
            exact_at: "2026-08-10T00:00:00.000Z",
            end_at: "2026-08-20T00:00:00.000Z",
            pass_count: 1,
            passes: [{ pass_index: 1, direction: "direct", exact_at: "2026-08-10T00:00:00.000Z", speed_deg_per_day: 0.03 }],
            orb_deg: 1,
          }],
        },
        "{}",
        new Date(NOW.getTime() + 500),
      ),
    ).rejects.toThrow(/did not converge/);
    // The stored receipt is untouched: pruning is cache deletion, never mutation.
    expect(await rows<{ result_json: string }>("SELECT result_json FROM cycle_scan_receipts"))
      .toEqual([{ result_json: "[]" }]);
  });

  it("retains at most 256 receipts per user and prunes the oldest deterministically", async () => {
    const chart = await seedChart(IDENTITY_A);
    // 258 distinct windows, one receipt each. Only the newest 256 survive.
    for (let day = 0; day < 258; day++) {
      const from = new Date(Date.UTC(2026, 0, 1 + day, 5)).toISOString();
      const to = new Date(Date.UTC(2026, 0, 2 + day, 5)).toISOString();
      await persistScanReceipt(
        env,
        { ...key(chart.chartId, chart.fingerprint), windowFrom: from, windowTo: to },
        request(chart.fingerprint),
        response(chart.fingerprint),
        "{}",
        new Date(Date.UTC(2026, 0, 1 + day, 12)),
      );
    }

    const retained = await rows<{ window_from: string }>(
      "SELECT window_from FROM cycle_scan_receipts ORDER BY created_at",
    );
    expect(retained).toHaveLength(MAX_SCAN_RECEIPTS_PER_USER);
    // The two oldest windows went; the newest is still there.
    expect(retained[0]!.window_from).toBe(new Date(Date.UTC(2026, 0, 3, 5)).toISOString());
    expect(retained.at(-1)!.window_from).toBe(new Date(Date.UTC(2026, 0, 258, 5)).toISOString());
  });

  it("keeps the spend ledger to at most 35 UTC days per user", async () => {
    for (let day = 0; day < 40; day++) {
      await reserveScanBudget(env, IDENTITY_A.userId, 1, 32, new Date(Date.UTC(2026, 5, 1 + day, 12)));
    }
    const ledger = await rows<{ utc_date: string }>(
      "SELECT utc_date FROM time_travel_daily_usage ORDER BY utc_date",
    );
    expect(ledger.length).toBeLessThanOrEqual(35);
    // The window is the last 35 UTC days ending on the most recent reservation.
    expect(ledger.at(-1)!.utc_date).toBe("2026-07-10");
    expect(ledger[0]!.utc_date).toBe("2026-06-06");
  });

  it("treats scheduling timezone as part of the lookup identity", async () => {
    const chart = await seedChart(IDENTITY_A);
    const chicago = key(chart.chartId, chart.fingerprint);
    await persistScanReceipt(
      env,
      chicago,
      request(chart.fingerprint),
      response(chart.fingerprint),
      "{}",
      NOW,
    );
    const newYork = { ...chicago, schedulingTimezone: "America/New_York" };
    expect(await loadScanReceipt(env, newYork)).toBeNull();
    await persistScanReceipt(
      env,
      newYork,
      request(chart.fingerprint),
      response(chart.fingerprint),
      "{}",
      new Date(NOW.getTime() + 1000),
    );
    expect(await loadScanReceipt(env, chicago)).not.toBeNull();
    expect(await loadScanReceipt(env, newYork)).not.toBeNull();
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(2);
  });
});
