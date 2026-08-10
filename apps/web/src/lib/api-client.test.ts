import { describe, expect, it } from "vitest";
import {
  ensureTodayReading,
  getTiming,
  type TimingFilters,
  type TimingResponse,
} from "./api-client.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import { todayResponse } from "../test/reading-fixture.js";

const TODAY = "/v1/readings/today";
const TIMING = "/v1/timing";

const timingResponse = {
  schema_version: "0.3.0" as const,
  as_of: "2026-08-10T05:15:00Z",
  calculation_status: {
    mode: "persisted_daily_reading_scan" as const,
    state: "current" as const,
    last_refresh_at: "2026-08-10T05:01:12Z",
    last_refresh_local_date: "2026-08-10",
  },
  applied_filters: {
    phase: "peak" as const,
    duration: "medium" as const,
  },
  unreadable_cycle_count: 0,
  cycles: [],
};

describe("ensureTodayReading", () => {
  it("returns the preparation response from a body-less PUT", async () => {
    const preparationResponse = {
      schema_version: "0.3.0",
      status: "preparing" as const,
      local_date: "2026-08-09",
    };
    mockApiResponses({
      [TODAY]: { status: 202, body: preparationResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(preparationResponse);

    const [request] = capturedFor(TODAY);
    expect(request.method).toBe("PUT");
    expect(request.body).toBeNull();
  });

  it("returns the published reading response unchanged", async () => {
    mockApiResponses({
      [TODAY]: { status: 200, body: todayResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(todayResponse);
  });
});

describe("getTiming", () => {
  it("serializes the closed phase and duration filters in contract order", async () => {
    mockApiResponses({
      [TIMING]: { status: 200, body: timingResponse },
    });

    const response: TimingResponse = await getTiming({
      phase: "peak",
      duration: "medium",
    });

    expect(response).toEqual(timingResponse);
    expect(capturedFor(TIMING)[0]!.search).toBe("?phase=peak&duration=medium");
  });

  it("omits the query delimiter when no filter is selected", async () => {
    mockApiResponses({
      [TIMING]: { status: 200, body: timingResponse },
    });

    await getTiming();

    expect(capturedFor(TIMING)[0]!.search).toBe("");
  });

  it("has no client-side domain filter", () => {
    const filters: TimingFilters = {
      // @ts-expect-error The API has no authoritative cycle-to-domain mapping.
      domain: "work",
    };

    expect(filters).toEqual({ domain: "work" });
  });
});
