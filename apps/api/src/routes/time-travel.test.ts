import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import type { TimeTravelResponse } from "@patternlike/shared";
import {
  CYCLE_FP_EMPTY,
  CYCLE_FP_REFUSED,
} from "../../test/mock-calc-service.js";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

async function get(path: string) {
  const response = await SELF.fetch(`http://api.test${path}`, {
    headers: { "x-user-id": USER_A },
  });
  return {
    response,
    body: await response.json() as TimeTravelResponse & {
      error?: { code: string; details?: { resets_at?: string; next_representable_date?: string } };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GET /v1/time-travel", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-13T18:00:00.000Z"));
    await resetDb();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A, "America/Chicago");
  });

  it("reconstructs at most two local-day scans, caches both, and never touches Timing storage", async () => {
    await seedChart(IDENTITY_A);
    const first = await get("/v1/time-travel?date=2026-08-10");
    expect(first.response.status).toBe(200);
    expect(first.body.schema_version).toBe("0.4.0");
    expect(first.body.selected.local_date).toBe("2026-08-10");
    expect(first.body.selected.provenance).toBe("on_demand");
    expect(first.body.present.provenance).toBe("on_demand");
    expect(first.body.selected.reference_at).toMatch(/T17:00:00/);
    expect(first.body.comparison.selected_only).toEqual([]);
    expect(first.body.comparison.present_only).toEqual([]);
    expect(first.body.comparison.continuing.length).toBeGreaterThan(0);
    expect(first.body.life_event_source_state).toBe("never_granted");

    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(2);
    expect(await rows("SELECT id FROM cycle_instances")).toHaveLength(0);
    expect(await rows("SELECT id FROM cycle_passes")).toHaveLength(0);
    expect(await rows<{ reserved_scan_count: number }>("SELECT reserved_scan_count FROM time_travel_daily_usage"))
      .toEqual([{ reserved_scan_count: 2 }]);

    const cached = await get("/v1/time-travel?date=2026-08-10");
    expect(cached.response.status).toBe(200);
    expect(cached.body.selected.provenance).toBe("cache");
    expect(cached.body.present.provenance).toBe("cache");
    expect(await rows<{ reserved_scan_count: number }>("SELECT reserved_scan_count FROM time_travel_daily_usage"))
      .toEqual([{ reserved_scan_count: 2 }]);
  });

  it("persists a successful empty scan as a complete result", async () => {
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_EMPTY });
    const result = await get("/v1/time-travel?date=2026-08-10");
    expect(result.response.status).toBe(200);
    expect(result.body.selected.cycles).toEqual([]);
    expect(await rows<{ result_json: string }>("SELECT result_json FROM cycle_scan_receipts"))
      .toEqual(expect.arrayContaining([{ result_json: "[]" }]));
  });

  it.each([
    "/v1/time-travel",
    "/v1/time-travel?date=2026-8-10",
    "/v1/time-travel?date=2026-08-10&date=2026-08-11",
    "/v1/time-travel?date=2026-08-10&zone=UTC",
  ])("rejects the closed date query: %s", async (path) => {
    await seedChart(IDENTITY_A);
    const result = await get(path);
    expect(result.response.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid_date");
  });

  it("reports a skipped civil date with its deterministic recovery", async () => {
    await confirmPreferences(USER_A, "Pacific/Apia");
    await seedChart(IDENTITY_A);
    const result = await get("/v1/time-travel?date=2011-12-30");
    expect(result.response.status).toBe(422);
    expect(result.body.error?.code).toBe("skipped_local_date");
    expect(result.body.error?.details?.next_representable_date).toBe("2011-12-31");
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(0);
  });

  it("maps a deterministic engine refusal separately from unavailability", async () => {
    await seedChart(IDENTITY_A, { fingerprint: CYCLE_FP_REFUSED });
    const result = await get("/v1/time-travel?date=2026-08-10");
    expect(result.response.status).toBe(422);
    expect(result.body.error?.code).toBe("date_not_supported");
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(0);
  });

  it("reserves nothing when the full two-scan request would cross the daily limit", async () => {
    await seedChart(IDENTITY_A);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO time_travel_daily_usage
         (user_id, utc_date, reserved_scan_count, created_at, updated_at)
       VALUES (?, ?, 31, ?, ?)`,
    ).bind(USER_A, now.slice(0, 10), now, now).run();
    const result = await get("/v1/time-travel?date=2026-08-10");
    expect(result.response.status).toBe(429);
    expect(result.body.error?.code).toBe("time_travel_scan_budget_exhausted");
    expect(result.body.error?.details?.resets_at).toMatch(/T00:00:00.000Z$/);
    expect(await rows<{ reserved_scan_count: number }>("SELECT reserved_scan_count FROM time_travel_daily_usage"))
      .toEqual([{ reserved_scan_count: 31 }]);
    expect(await rows("SELECT id FROM cycle_scan_receipts")).toHaveLength(0);
  });

  it("sends the calculation boundary normalized positions and nothing private", async () => {
    const chart = await seedChart(IDENTITY_A);

    // A real saved life event is loaded on the same request, so if any private
    // context could reach the cycle call, this is the request it would reach on.
    const document = await SELF.fetch("http://api.test/v1/context-sources", {
      headers: { "x-user-id": USER_A },
    }).then((response) => response.json()) as {
      sources: Array<Record<string, unknown> & { source_id: string }>;
    };
    const usr09 = document.sources.find((source) => source.source_id === "USR-09")!;
    await SELF.fetch("http://api.test/v1/context-sources", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_A,
        "idempotency-key": "travel-leak-grant-0001",
      },
      body: JSON.stringify({
        ...document,
        sources: [{ ...usr09, enabled: true, permission_state: "active" }],
      }),
    });
    await SELF.fetch("http://api.test/v1/life-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_A,
        "idempotency-key": "travel-leak-event-0001",
      },
      body: JSON.stringify({
        schema_version: "0.4.0",
        start_date: "2026-08-10",
        end_date: null,
        precision: "day",
        category: "work",
        significance: "high",
        title: "A private life event title",
        note: "A private note",
        use_in_time_travel: true,
      }),
    });
    // The mock calculation service runs as miniflare's outbound service, in a
    // different context from this test, so its module state is not observable
    // here. The Worker's own `fetch` is, and that is the call under test.
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/cycles")) {
        const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
        if (typeof body === "string") sent.push(body);
      }
      return realFetch(input as never, init as never);
    });

    const result = await get("/v1/time-travel?date=2026-08-10");
    const capturedCycleRequests = sent;
    expect(result.response.status).toBe(200);
    expect(capturedCycleRequests.length).toBeGreaterThan(0);

    for (const body of capturedCycleRequests) {
      const sent = JSON.parse(body) as Record<string, unknown>;
      // An allowlist, not an exact set: `suppressed_features` is omitted for a
      // chart with nothing suppressed. A key outside this list is a new thing
      // crossing a boundary that exists to stay narrow.
      const allowed = new Set([
        "chart_fingerprint",
        "contract_id",
        "contract_version",
        "cycle_policy_id",
        "cycle_policy_version",
        "natal_accuracy",
        "natal_positions",
        "orb_policy_id",
        "orb_policy_version",
        "request_id",
        "schema_version",
        "suppressed_features",
        "techniques",
        "window",
      ]);
      expect(Object.keys(sent).filter((key) => !allowed.has(key))).toEqual([]);
      expect(Object.keys(sent)).toEqual(
        expect.arrayContaining(["chart_fingerprint", "natal_positions", "natal_accuracy", "window"]),
      );
      expect(sent.chart_fingerprint).toBe(chart.fingerprint);
      // Normalized ecliptic longitudes are the point of the request; a
      // birthplace coordinate is not. Asserting on the position shape separates
      // the two rather than banning the substring "longitude".
      for (const position of sent.natal_positions as Array<Record<string, unknown>>) {
        expect(Object.keys(position).sort()).toEqual(["body", "longitude_deg"]);
      }
      for (const forbidden of [
        USER_A,
        IDENTITY_A.cryptoSubject,
        chart.chartId,
        "America/Chicago",
        "birth",
        "latitude",
        "place",
        "life_event",
        "USR-09",
        "A private life event title",
        "A private note",
      ]) {
        expect(body, `${forbidden} crossed the calculation boundary`).not.toContain(forbidden);
      }
    }
  });
});
