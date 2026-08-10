import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartSnapshot, DailySkyResponseSuccess, DailySkyWindow } from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  DailySkyRequestError,
  buildDailySkyRequest,
  dailySkyFailureCode,
  invokeDailySky,
} from "./daily-sky-client.js";

/**
 * Deliberately isolated from `test/mock-calc-service.ts`.
 *
 * That interceptor is installed as the pool's outbound service and answers by
 * host, which is the right shape for the integration suites. Here the point is
 * the client's own request-building and echo-verification, so the fetch is
 * stubbed locally and every assertion is about the bytes this module produced.
 */
const WINDOW: DailySkyWindow = {
  targetLocalDate: "2026-07-30",
  dayStartAt: "2026-07-30T07:00:00Z",
  dayEndAt: "2026-07-31T07:00:00Z",
  anchorAt: "2026-07-30T19:00:00Z",
  anchorResolution: "unique",
  tzdbVersion: "2026c",
  localDayResolutionPolicyVersion: "1.0.0",
};

const EPHE = "se-2.10.03-1800-2399";

function chart(overrides: Partial<ChartSnapshot> = {}): ChartSnapshot {
  return {
    schema_version: "0.2.0",
    id: "cht_01JAMPLECHART0000001",
    user_id: "usr_01JAMPLEUSER00000001",
    profile_version: 1,
    fingerprint: "sha256:" + "1a".repeat(32),
    contract_id: "patternlike.chart.launch",
    contract_version: "0.2.0",
    container_digest: "sha256:" + "3c".repeat(32),
    birth: {
      accuracy: "exact",
      utc_instant: "1990-01-02T15:42:00Z",
      timezone: "America/Chicago",
      place_label: "Chicago, Illinois",
      latitude: 41.8781,
      longitude: -87.6298,
    },
    positions: [
      { body: "sun", longitude_deg: 271.774002 },
      { body: "moon", longitude_deg: 12.004311 },
      { body: "saturn", longitude_deg: 301.774002 },
      { body: "ascendant", longitude_deg: 14.201 },
      { body: "midheaven", longitude_deg: 284.551 },
    ],
    houses: {
      system_used: "placidus",
      fallback_applied: false,
      cusps_deg: [14.2, 41.9, 72.0, 104.6, 136.1, 163.9, 194.2, 221.9, 252.0, 284.6, 316.1, 343.9],
    },
    angles: { ascendant_deg: 14.201, midheaven_deg: 284.551 },
    aspects: [],
    uncertainty: {
      accuracy: "exact",
      window: null,
      suppressed_features: [],
      qualified_features: [],
      user_facing_summary: null,
    },
    calculated_at: "2026-07-01T00:00:00Z",
    status: "active",
    ...overrides,
  };
}

const UNKNOWN_TIME = chart({
  houses: null,
  angles: null,
  birth: {
    accuracy: "unknown",
    utc_instant: null,
    timezone: "America/Chicago",
    place_label: "Chicago, Illinois",
    latitude: 41.8781,
    longitude: -87.6298,
  },
  uncertainty: {
    accuracy: "unknown",
    window: null,
    suppressed_features: [
      { feature_class: "angle_transits", feature_id: null, reason: "unknown_birth_time" },
      { feature_class: "angles", feature_id: null, reason: "unknown_birth_time" },
      { feature_class: "houses", feature_id: null, reason: "unknown_birth_time" },
      { feature_class: "moon_time_sensitive", feature_id: null, reason: "unknown_birth_time" },
    ],
    qualified_features: [],
    user_facing_summary: null,
  },
});

const build = (snapshot: ChartSnapshot) =>
  buildDailySkyRequest({
    requestId: "req_01JAMPLEDAILYSKY0001",
    window: WINDOW,
    chart: snapshot,
    ephemerisDataVersion: EPHE,
    calculationPolicyId: "swiss-ephemeris-launch",
    calculationPolicyVersion: "1.0.0",
  });

const env = { CALC_SERVICE_URL: "https://calc.example", CALC_SERVICE_AUTH_TOKEN: "tok" } as Env;

function successFor(req: ReturnType<typeof build>): DailySkyResponseSuccess {
  return {
    ok: true,
    schema_version: req.schema_version,
    request_id: req.request_id,
    day_start_at: req.day_start_at,
    day_end_at: req.day_end_at,
    anchor_at: req.anchor_at,
    anchor_resolution: req.anchor_resolution,
    effective_accuracy: req.effective_accuracy,
    suppressed_features: [...req.suppressed_features],
    daily_sky_policy_id: req.daily_sky_policy_id,
    daily_sky_policy_version: req.daily_sky_policy_version,
    calculation_policy_id: req.calculation_policy_id,
    calculation_policy_version: req.calculation_policy_version,
    contract_id: req.contract_id,
    contract_version: req.contract_version,
    container_digest: "sha256:" + "7e".repeat(32),
    ephemeris_data_version: req.ephemeris_data_version,
    tzdb_version: req.tzdb_version,
    facts: [],
  };
}

function stubFetch(body: unknown, init: { status?: number; json?: boolean } = {}) {
  const spy = vi.fn(async (_url: string, _requestInit?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    init.json === false
      ? new Response("not json", { status: init.status ?? 200 })
      : new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "content-type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildDailySkyRequest", () => {
  it("carries the day, the anchor, and the pinned versions", () => {
    const req = build(chart());
    expect(req.schema_version).toBe("0.5.0");
    expect(req.day_start_at).toBe(WINDOW.dayStartAt);
    expect(req.day_end_at).toBe(WINDOW.dayEndAt);
    expect(req.anchor_at).toBe(WINDOW.anchorAt);
    expect(req.anchor_resolution).toBe("unique");
    expect(req.tzdb_version).toBe("2026c");
    expect(req.local_day_resolution_policy_version).toBe("1.0.0");
    expect(req.daily_sky_policy_id).toBe("daily-sky-launch");
    expect(req.ephemeris_data_version).toBe(EPHE);
    expect(req.zodiac).toBe("tropical");
    expect(req.node).toBe("true");
  });

  it("never lets a birth field or an account handle across the boundary", () => {
    const encoded = JSON.stringify(build(chart()));
    for (const token of [
      "user_id",
      "usr_",
      "cht_",
      "chart_fingerprint",
      "fingerprint",
      "birth",
      "utc_instant",
      "place_label",
      "latitude",
      "timezone",
      "America/Chicago",
      "Chicago",
      "1990-01-02",
    ]) {
      expect(encoded).not.toContain(token);
    }
    // The projection is field by field precisely so this holds: a spread of the
    // snapshot would have taken every one of those with it.
    expect(encoded).toContain("longitude_deg");
  });

  it("sends house cusps only when the accuracy permits houses", () => {
    expect(build(chart()).natal_house_cusps).toEqual({
      house_system: "placidus",
      cusps_deg: expect.any(Array),
    });
    expect(build(UNKNOWN_TIME).natal_house_cusps).toBeNull();
  });

  it("omits suppressed targets rather than sending them to be filtered", () => {
    const exact = build(chart());
    expect(exact.natal_positions.map((p) => p.body)).toEqual([
      "sun",
      "moon",
      "saturn",
      "ascendant",
      "midheaven",
    ]);

    const unknown = build(UNKNOWN_TIME);
    // Angles and the natal Moon are absent, not present-and-ignored. A
    // longitude computed from a synthesized noon that reached the engine could
    // come back as a contact the uncertainty report says is unavailable.
    expect(unknown.natal_positions.map((p) => p.body)).toEqual(["sun", "saturn"]);
    expect(unknown.suppressed_features).toEqual([
      "angle_transits",
      "angles",
      "houses",
      "moon_time_sensitive",
    ]);
  });

  it("keeps one copy of the accuracy decision", () => {
    const req = build(UNKNOWN_TIME);
    expect(req.effective_accuracy).toBe(req.uncertainty.accuracy);
    expect([...req.suppressed_features].sort()).toEqual(
      [...new Set(req.uncertainty.suppressed_features.map((f) => f.feature_class))].sort(),
    );
    expect(req.uncertainty).not.toHaveProperty("user_facing_summary");
  });

  it("refuses to build a request with nothing left to scan", () => {
    const empty = chart({ positions: [{ body: "moon", longitude_deg: 12 }], houses: null });
    empty.uncertainty = UNKNOWN_TIME.uncertainty;
    expect(() => build(empty)).toThrow(DailySkyRequestError);
  });
});

describe("invokeDailySky", () => {
  it("posts to /v1/daily-sky with the service token and returns the success body", async () => {
    const req = build(chart());
    const spy = stubFetch(successFor(req));
    const result = await invokeDailySky(env, req);

    expect(result).toEqual({ ok: true, response: successFor(req) });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, sent] = spy.mock.calls[0]!;
    expect(url).toBe("https://calc.example/v1/daily-sky");
    expect(sent?.method).toBe("POST");
    expect(sent?.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(JSON.parse(sent?.body ?? "{}")).toEqual(req);
  });

  it("separates an engine refusal from an engine that never answered", async () => {
    const req = build(chart());

    stubFetch({
      ok: false,
      schema_version: "0.5.0",
      request_id: req.request_id,
      error_class: "calculation_failed",
      error_message: "transient",
    });
    const refused = await invokeDailySky(env, req);
    expect(refused).toMatchObject({ ok: false, kind: "refused" });
    if (!refused.ok && refused.kind === "refused") {
      // Only calculation_failed is worth another delivery; the rest are
      // deterministic refusals of the exact frozen request.
      expect(dailySkyFailureCode(refused.failure)).toBe("daily_sky_unavailable");
      expect(
        dailySkyFailureCode({ ...refused.failure, error_class: "ephemeris_range" }),
      ).toBe("policy_unsupported");
    }

    stubFetch({ error: { code: "unauthorized", message: "no" } }, { status: 401 });
    expect(await invokeDailySky(env, req)).toMatchObject({ ok: false, kind: "unavailable" });

    stubFetch(null, { json: false });
    expect(await invokeDailySky(env, req)).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("fails closed when the service echoes a different day, version, or suppression set", async () => {
    const req = build(chart());
    const mutations: Array<[string, (r: DailySkyResponseSuccess) => void]> = [
      ["a different local day", (r) => (r.day_end_at = "2026-08-01T07:00:00Z")],
      ["a different anchor", (r) => (r.anchor_at = "2026-07-30T12:00:00Z")],
      ["a different anchor resolution", (r) => (r.anchor_resolution = "ambiguous_earlier")],
      ["a different tz database", (r) => (r.tzdb_version = "2025b")],
      ["a different ephemeris vintage", (r) => (r.ephemeris_data_version = "se-2.10.02")],
      ["a different daily-sky policy", (r) => (r.daily_sky_policy_version = "9.9.9")],
      ["a different contract", (r) => (r.contract_version = "0.3.0")],
      ["an unrequested suppression", (r) => (r.suppressed_features = ["houses"])],
      ["a different request", (r) => (r.request_id = "req_other000000000001")],
    ];
    for (const [label, mutate] of mutations) {
      const body = successFor(req);
      mutate(body);
      stubFetch(body);
      const result = await invokeDailySky(env, req);
      expect(result, label).toMatchObject({ ok: false, kind: "unavailable" });
    }
  });

  it("does not call out at all when the calculation runtime is unconfigured", async () => {
    const spy = stubFetch(successFor(build(chart())));
    const result = await invokeDailySky({} as Env, build(chart()));
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
    expect(spy).not.toHaveBeenCalled();
  });
});
