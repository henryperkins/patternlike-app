import type { TimingCycle, TimingResponse } from "../lib/api-client.js";

export const ACTIVE_TIMING_CYCLE: TimingCycle = {
  cycle_id: "cyc_0123456789abcdef0123456789abcdef",
  technique: "transit",
  body: "saturn",
  target: "sun",
  aspect: "square",
  status: "active",
  phase: "reconsidering",
  start_at: "2026-07-19T05:22:10Z",
  exact_at: "2026-08-02T14:11:07Z",
  end_at: "2027-01-26T18:44:02Z",
  duration_days: 191.55685185185186,
  orb_deg: 3,
  passes: [
    {
      pass_index: 1,
      direction: "direct",
      exact_at: "2026-08-02T14:11:07Z",
    },
    {
      pass_index: 2,
      direction: "retrograde",
      exact_at: "2026-10-19T03:52:44Z",
    },
    {
      pass_index: 3,
      direction: "direct",
      exact_at: "2027-01-11T21:07:19Z",
    },
  ],
};

export const UPCOMING_TIMING_CYCLE: TimingCycle = {
  cycle_id: "cyc_fedcba9876543210fedcba9876543210",
  technique: "transit",
  body: "jupiter",
  target: "moon",
  aspect: "trine",
  status: "upcoming",
  phase: null,
  start_at: "2026-09-03T08:00:00Z",
  exact_at: "2026-09-12T17:30:00Z",
  end_at: "2026-09-22T02:00:00Z",
  duration_days: 18.75,
  orb_deg: 4,
  passes: [
    {
      pass_index: 1,
      direction: "direct",
      exact_at: "2026-09-12T17:30:00Z",
    },
  ],
};

interface TimingFixtureOptions {
  state?: TimingResponse["calculation_status"]["state"];
  cycles?: TimingCycle[];
  unreadableCycleCount?: number;
  filters?: TimingResponse["applied_filters"];
}

export function timingResponseFixture(
  options: TimingFixtureOptions = {},
): TimingResponse {
  const state = options.state ?? "current";
  const hasReceipt = state !== "not_scanned";
  return {
    schema_version: "0.3.0",
    as_of: "2026-08-10T05:15:00Z",
    calculation_status: {
      mode: "persisted_daily_reading_scan",
      state,
      last_refresh_at: hasReceipt ? "2026-08-10T05:01:12Z" : null,
      last_refresh_local_date:
        state === "stale" ? "2026-08-09" : hasReceipt ? "2026-08-10" : null,
    },
    applied_filters: options.filters ?? { phase: null, duration: null },
    unreadable_cycle_count: options.unreadableCycleCount ?? 0,
    cycles: options.cycles ?? [ACTIVE_TIMING_CYCLE, UPCOMING_TIMING_CYCLE],
  };
}

export const TIMING_RESPONSE = timingResponseFixture();
