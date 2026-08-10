import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CyclePass, NormalizedCycle } from "@patternlike/shared";
import m0Common from "../../../../contracts/m0/common.schema.json";
import m3Common from "../../../../contracts/m3/common.schema.json";
import m3Timing from "../../../../contracts/m3/timing-response.schema.json";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  resetDb,
  seedActiveRelease,
  seedChart,
  seedTimingReceipt,
  seedUser,
} from "../../test/helpers.js";
import { persistCycles } from "../db/cycles.js";
import { projectTimingResponse } from "./timing.js";

const FIXED_NOW = "2026-08-10T04:30:00.000Z";
const DAY_MS = 86_400_000;

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
for (const schema of [m0Common, m3Common, m3Timing]) ajv.addSchema(schema);
const validateTimingResponse = ajv.getSchema(
  `${m3Timing.$id}#/$defs/timingResponse`,
)!;

type WirePhase =
  | "emerging"
  | "building"
  | "peak"
  | "reconsidering"
  | "integrating";
type WirePhaseFilter = WirePhase | "upcoming";
type WireDurationFilter = "short" | "medium" | "long";

interface TimingBody {
  schema_version: "0.3.0";
  as_of: string;
  calculation_status: {
    mode: "persisted_daily_reading_scan";
    state: "current" | "stale" | "not_scanned";
    last_refresh_at: string | null;
    last_refresh_local_date: string | null;
  };
  applied_filters: {
    phase: WirePhaseFilter | null;
    duration: WireDurationFilter | null;
  };
  unreadable_cycle_count: number;
  cycles: Array<{
    cycle_id: string;
    technique: "transit";
    body: string;
    target: string;
    aspect: string;
    status: "active" | "upcoming";
    phase: WirePhase | null;
    start_at: string;
    exact_at: string;
    end_at: string;
    duration_days: number;
    orb_deg: number;
    passes: Array<{
      pass_index: number;
      direction: "direct" | "retrograde";
      exact_at: string;
    }>;
  }>;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string | null;
  };
}

function cycleId(hexDigit: string): string {
  return `cyc_${hexDigit.repeat(32)}`;
}

function makeCycle(options: {
  id: string;
  startAt: string;
  endAt: string;
  passes: CyclePass[];
  body?: NormalizedCycle["body"];
  target?: string;
}): NormalizedCycle {
  return {
    id: options.id,
    technique: "transit",
    body: options.body ?? "saturn",
    target: options.target ?? "sun",
    aspect: "square",
    start_at: options.startAt,
    exact_at: options.passes[0]!.exact_at,
    end_at: options.endAt,
    pass_count: options.passes.length,
    passes: options.passes,
    orb_deg: 3,
    importance_score: null,
  };
}

const RETROGRADE = makeCycle({
  id: cycleId("a"),
  startAt: "2026-07-19T05:22:10Z",
  endAt: "2027-01-26T18:44:02Z",
  passes: [
    {
      pass_index: 1,
      direction: "direct",
      exact_at: "2026-08-02T14:11:07Z",
      speed_deg_per_day: 0.0331,
    },
    {
      pass_index: 2,
      direction: "retrograde",
      exact_at: "2026-10-19T03:52:44Z",
      speed_deg_per_day: -0.0288,
    },
    {
      pass_index: 3,
      direction: "direct",
      exact_at: "2027-01-11T21:07:19Z",
      speed_deg_per_day: 0.0302,
    },
  ],
});

function snapshot(cycles: NormalizedCycle[]) {
  return {
    cycles,
    unreadableCycleIds: [],
    receipt: {
      localDate: "2026-08-10",
      createdAt: "2026-08-10T04:00:00Z",
    },
  };
}

function project(
  cycles: NormalizedCycle[],
  asOf: string,
  filters: {
    phase: WirePhaseFilter | null;
    duration: WireDurationFilter | null;
  } = { phase: null, duration: null },
) {
  return projectTimingResponse({
    asOf,
    currentLocalDate: asOf.slice(0, 10),
    snapshot: snapshot(cycles),
    filters,
  });
}

describe("projectTimingResponse", () => {
  it.each([
    ["2026-07-20T00:00:00Z", "active", "emerging"],
    ["2026-07-30T12:00:00Z", "active", "building"],
    ["2026-08-02T14:11:07Z", "active", "peak"],
    ["2026-09-10T00:00:00Z", "active", "reconsidering"],
    ["2027-01-20T00:00:00Z", "active", "integrating"],
    ["2026-07-01T00:00:00Z", "upcoming", null],
  ] as const)(
    "recomputes %s as %s / %s",
    (asOf, status, phase) => {
      const response = project([RETROGRADE], asOf);

      expect(response.cycles[0]).toMatchObject({ status, phase });
      expect(validateTimingResponse(response), ajv.errorsText(validateTimingResponse.errors)).toBe(
        true,
      );
    },
  );

  it("sorts active cycles by next pass or end, then cycle id, before upcoming", () => {
    const asOf = "2026-08-10T00:00:00Z";
    const pass = (index: number, exactAt: string): CyclePass => ({
      pass_index: index,
      direction: index === 2 ? "retrograde" : "direct",
      exact_at: exactAt,
      speed_deg_per_day: index === 2 ? -0.03 : 0.04,
    });
    const fallback = makeCycle({
      id: cycleId("4"),
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-08-11T00:00:00Z",
      passes: [pass(1, "2026-08-01T00:00:00Z")],
    });
    const nextSoon = makeCycle({
      id: cycleId("3"),
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-09-01T00:00:00Z",
      passes: [
        pass(1, "2026-08-01T00:00:00Z"),
        pass(2, "2026-08-12T00:00:00Z"),
      ],
    });
    const tieHigh = makeCycle({
      id: cycleId("f"),
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-09-01T00:00:00Z",
      passes: [pass(1, "2026-08-15T00:00:00Z")],
    });
    const tieLow = makeCycle({
      id: cycleId("1"),
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-09-01T00:00:00Z",
      passes: [pass(1, "2026-08-15T00:00:00Z")],
    });
    const upcoming = makeCycle({
      id: cycleId("2"),
      startAt: "2026-08-10T01:00:00Z",
      endAt: "2026-08-20T00:00:00Z",
      passes: [pass(1, "2026-08-15T12:00:00Z")],
    });

    const response = project(
      [upcoming, tieHigh, nextSoon, tieLow, fallback],
      asOf,
    );

    expect(response.cycles.map((cycle) => cycle.cycle_id)).toEqual([
      fallback.id,
      nextSoon.id,
      tieLow.id,
      tieHigh.id,
      upcoming.id,
    ]);
  });

  it("classifies the exact 90-day and 365-day duration boundaries", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const cycleWithDuration = (id: string, elapsedMs: number) =>
      makeCycle({
        id,
        startAt: new Date(start).toISOString(),
        endAt: new Date(start + elapsedMs).toISOString(),
        passes: [
          {
            pass_index: 1,
            direction: "direct",
            exact_at: new Date(start + 2 * DAY_MS).toISOString(),
            speed_deg_per_day: 0.04,
          },
        ],
      });
    const below90 = cycleWithDuration(cycleId("1"), 90 * DAY_MS - 1);
    const at90 = cycleWithDuration(cycleId("2"), 90 * DAY_MS);
    const below365 = cycleWithDuration(cycleId("3"), 365 * DAY_MS - 1);
    const at365 = cycleWithDuration(cycleId("4"), 365 * DAY_MS);
    const cycles = [below90, at90, below365, at365];
    const asOf = new Date(start + DAY_MS).toISOString();

    expect(
      project(cycles, asOf, { phase: null, duration: "short" }).cycles.map(
        (cycle) => cycle.cycle_id,
      ),
    ).toEqual([below90.id]);
    expect(
      project(cycles, asOf, { phase: null, duration: "medium" }).cycles.map(
        (cycle) => cycle.cycle_id,
      ),
    ).toEqual([at90.id, below365.id]);
    expect(
      project(cycles, asOf, { phase: null, duration: "long" }).cycles.map(
        (cycle) => cycle.cycle_id,
      ),
    ).toEqual([at365.id]);
  });

  it("filters after phase recomputation and echoes accepted filters", () => {
    const upcoming = makeCycle({
      id: cycleId("b"),
      startAt: "2026-09-20T00:00:00Z",
      endAt: "2026-10-20T00:00:00Z",
      passes: [
        {
          pass_index: 1,
          direction: "direct",
          exact_at: "2026-10-01T00:00:00Z",
          speed_deg_per_day: 0.04,
        },
      ],
    });
    const asOf = "2026-09-10T00:00:00Z";

    const reconsidering = project([upcoming, RETROGRADE], asOf, {
      phase: "reconsidering",
      duration: null,
    });
    expect(reconsidering.applied_filters).toEqual({
      phase: "reconsidering",
      duration: null,
    });
    expect(reconsidering.cycles.map((cycle) => cycle.cycle_id)).toEqual([
      RETROGRADE.id,
    ]);

    const combined = project([upcoming, RETROGRADE], asOf, {
      phase: "upcoming",
      duration: "short",
    });
    expect(combined.applied_filters).toEqual({
      phase: "upcoming",
      duration: "short",
    });
    expect(combined.cycles.map((cycle) => cycle.cycle_id)).toEqual([upcoming.id]);
  });
});

async function getTiming<T = TimingBody>(
  query = "",
  userId: string | null = USER_A,
  requestId?: string,
) {
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  if (requestId) headers["x-request-id"] = requestId;
  const response = await SELF.fetch(`http://api.test/v1/timing${query}`, { headers });
  return { status: response.status, body: (await response.json()) as T };
}

describe("GET /v1/timing", () => {
  let aliceChartId: string;
  let bobChartId: string;
  let releaseVersion: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FIXED_NOW));
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_A, "UTC");
    await confirmPreferences(USER_B, "UTC");
    ({ chartId: aliceChartId } = await seedChart(IDENTITY_A));
    ({ chartId: bobChartId } = await seedChart(IDENTITY_B));
    ({ version: releaseVersion } = await seedActiveRelease("release-timing-route-tests"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function activeCycle(id: string, options: { long?: boolean } = {}): NormalizedCycle {
    return makeCycle({
      id,
      startAt: options.long ? "2025-07-01T00:00:00Z" : "2026-07-01T00:00:00Z",
      endAt: "2026-09-15T00:00:00Z",
      passes: [
        {
          pass_index: 1,
          direction: "direct",
          exact_at: options.long ? "2026-07-01T00:00:00Z" : FIXED_NOW,
          speed_deg_per_day: 0.04,
        },
      ],
    });
  }

  it("returns a schema-valid authenticated 200 for an ordinary current empty scan", async () => {
    await seedTimingReceipt({
      id: "rdg_timing_route_empty",
      userId: USER_A,
      localDate: "2026-08-10",
      releaseVersion,
      createdAt: "2026-08-10T04:00:00Z",
    });

    const { status, body } = await getTiming();

    expect(status).toBe(200);
    expect(validateTimingResponse(body), ajv.errorsText(validateTimingResponse.errors)).toBe(
      true,
    );
    expect(body.calculation_status.state).toBe("current");
    expect(body.cycles).toEqual([]);
  });

  it.each([
    ["not_scanned", null],
    ["stale", "2026-08-09"],
    ["current", "2026-08-10"],
  ] as const)("reports %s calculation status", async (state, localDate) => {
    if (localDate) {
      await seedTimingReceipt({
        id: `rdg_timing_state_${state}`,
        userId: USER_A,
        localDate,
        releaseVersion,
        status: "failed",
        createdAt: "2026-08-10T03:00:00Z",
      });
    }

    const { status, body } = await getTiming();

    expect(status).toBe(200);
    expect(body.calculation_status.state).toBe(state);
    expect(body.calculation_status.last_refresh_local_date).toBe(localDate);
    expect(body.calculation_status.last_refresh_at).toBe(
      localDate ? "2026-08-10T03:00:00Z" : null,
    );
  });

  it("treats an ahead-zone receipt as current after moving to a behind zone", async () => {
    await confirmPreferences(USER_A, "Asia/Tokyo");
    await seedTimingReceipt({
      id: "rdg_timing_tokyo",
      userId: USER_A,
      localDate: "2026-08-10",
      releaseVersion,
      createdAt: "2026-08-10T03:30:00Z",
    });
    await confirmPreferences(USER_A, "America/Los_Angeles");

    const { body } = await getTiming();

    expect(body.calculation_status.state).toBe("current");
    expect(body.calculation_status.last_refresh_local_date).toBe("2026-08-10");
  });

  it("never includes another user's cycle", async () => {
    const alice = activeCycle(cycleId("a"));
    const bob = activeCycle(cycleId("b"));
    await persistCycles(env, USER_A, aliceChartId, [alice]);
    await persistCycles(env, USER_B, bobChartId, [bob]);

    const { body } = await getTiming();

    expect(body.cycles.map((cycle) => cycle.cycle_id)).toEqual([alice.id]);
    expect(JSON.stringify(body)).not.toContain(bob.id);
  });

  it("logs, omits, and counts one unreadable cycle without losing its sibling", async () => {
    const valid = activeCycle(cycleId("a"));
    const malformed = activeCycle(cycleId("b"));
    await persistCycles(env, USER_A, aliceChartId, [valid, malformed]);
    await env.DB.prepare("UPDATE cycle_instances SET cycle_json = '{' WHERE id = ?")
      .bind(malformed.id)
      .run();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await getTiming(
      "",
      USER_A,
      "req-timing-unreadable-1",
    );

    expect(status).toBe(200);
    expect(body.unreadable_cycle_count).toBe(1);
    expect(body.cycles.map((cycle) => cycle.cycle_id)).toEqual([valid.id]);
    expect(log).toHaveBeenCalledWith("timing_cycles_unreadable", {
      request_id: "req-timing-unreadable-1",
      cycle_ids: [malformed.id],
    });
  });

  it("applies phase, duration, and combined filters", async () => {
    const peak = activeCycle(cycleId("a"));
    const long = activeCycle(cycleId("b"), { long: true });
    await persistCycles(env, USER_A, aliceChartId, [peak, long]);

    const phase = await getTiming("?phase=peak");
    expect(phase.status).toBe(200);
    expect(phase.body.applied_filters).toEqual({ phase: "peak", duration: null });
    expect(phase.body.cycles.map((cycle) => cycle.cycle_id)).toEqual([peak.id]);

    const duration = await getTiming("?duration=long");
    expect(duration.status).toBe(200);
    expect(duration.body.applied_filters).toEqual({ phase: null, duration: "long" });
    expect(duration.body.cycles.map((cycle) => cycle.cycle_id)).toEqual([long.id]);

    const combined = await getTiming("?phase=integrating&duration=long");
    expect(combined.status).toBe(200);
    expect(combined.body.applied_filters).toEqual({
      phase: "integrating",
      duration: "long",
    });
    expect(combined.body.cycles.map((cycle) => cycle.cycle_id)).toEqual([long.id]);
  });

  it.each([
    "?domain=work",
    "?unknown=value",
    "?phase=",
    "?phase=peak&phase=building",
    "?phase=waning",
    "?duration=annual",
  ])("rejects invalid filter query %s without echoing it", async (query) => {
    const { status, body } = await getTiming<ErrorEnvelope>(
      query,
      USER_A,
      "req-timing-filter-1",
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "invalid_filter",
        message: "Timing filters are invalid",
        request_id: "req-timing-filter-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain(query.slice(1));
  });

  it("requires authentication", async () => {
    const { status, body } = await getTiming<ErrorEnvelope>("", null);

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.request_id).toBeTruthy();
  });

  it("returns the safe 500 envelope for a malformed global receipt", async () => {
    await seedTimingReceipt({
      id: "rdg_timing_bad_receipt",
      userId: USER_A,
      localDate: "2026-02-30",
      releaseVersion,
      status: "failed",
      createdAt: "2026-08-10T03:00:00Z",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await getTiming<ErrorEnvelope>(
      "",
      USER_A,
      "req-timing-bad-receipt-1",
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        request_id: "req-timing-bad-receipt-1",
      },
    });
  });

  it("returns the safe 500 envelope for a D1 read failure", async () => {
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((query) => {
      if (query.includes("FROM cycle_instances")) throw new Error("simulated D1 failure");
      return prepare(query);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await getTiming<ErrorEnvelope>(
      "",
      USER_A,
      "req-timing-d1-failure-1",
    );

    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: "internal_error",
      message: "Unexpected server error",
      request_id: "req-timing-d1-failure-1",
    });
  });

  it("performs no outbound fetch or D1 mutation on an ordinary read", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const prepare = vi.spyOn(env.DB, "prepare");
    const batch = vi.spyOn(env.DB, "batch");

    const { status } = await getTiming();

    expect(status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    const statements = prepare.mock.calls.map(([query]) => query.trim().toUpperCase());
    expect(statements.every((query) => query.startsWith("SELECT"))).toBe(true);
  });
});
