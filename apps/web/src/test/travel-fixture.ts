import type { LifeEvent, TimeTravelResponse } from "@patternlike/shared";

export const TRAVEL_ZONE = "America/Chicago";

/**
 * A contract-shaped Time Travel response.
 *
 * Both references carry one cycle and they share an id, so the fixture exercises
 * the `continuing` group and the phase-change marker at the same time. Dates are
 * fixed rather than derived from the clock: a fixture whose local date follows
 * `new Date()` asserts a different string every run.
 */
export function travelResponse(
  overrides: Partial<TimeTravelResponse> = {},
): TimeTravelResponse {
  const cycle = {
    id: "cyc_travel_fixture_00000000000001",
    technique: "transit" as const,
    body: "saturn" as const,
    target: "sun",
    aspect: "square" as const,
    start_at: "2026-05-01T00:00:00.000Z",
    exact_at: "2026-06-01T00:00:00.000Z",
    end_at: "2026-09-01T00:00:00.000Z",
    pass_count: 1,
    passes: [
      {
        pass_index: 1,
        direction: "direct" as const,
        exact_at: "2026-06-01T00:00:00.000Z",
        speed_deg_per_day: 0.03,
      },
    ],
    orb_deg: 3,
  };

  return {
    schema_version: "0.4.0",
    generated_at: "2026-08-13T18:00:00.000Z",
    timezone: TRAVEL_ZONE,
    calculation_policy: {
      contract_id: "calc-contract-launch",
      contract_version: "0.2.0",
      cycle_policy_id: "cycle-policy-launch",
      cycle_policy_version: "0.3.0",
      orb_policy_id: "orb-policy-launch",
      orb_policy_version: "0.3.0",
      receipt_epoch: 1,
    },
    selected: {
      local_date: "2026-06-14",
      reference_at: "2026-06-14T17:00:00.000Z",
      provenance: "on_demand",
      calculated_at: "2026-08-13T17:59:00.000Z",
      cycles: [{ cycle, phase: "building", rank: 1, dominant: true }],
    },
    present: {
      local_date: "2026-08-13",
      reference_at: "2026-08-13T18:00:00.000Z",
      provenance: "cache",
      calculated_at: "2026-08-13T12:00:00.000Z",
      cycles: [{ cycle, phase: "integrating", rank: 1, dominant: true }],
    },
    comparison: {
      continuing: [cycle.id],
      selected_only: [],
      present_only: [],
      phase_changed: [cycle.id],
    },
    saved_context: [],
    unreadable_context_count: 0,
    life_event_source_state: "never_granted",
    ...overrides,
  };
}

export function lifeEvent(overrides: Partial<LifeEvent> = {}): LifeEvent {
  return {
    schema_version: "0.4.0",
    id: "evt_00000000000000000000000000000001",
    start_date: "2026-06-14",
    end_date: null,
    precision: "day",
    category: "work",
    significance: "high",
    title: "Left the old job",
    note: null,
    use_in_time_travel: true,
    revision: 1,
    observed_at: "2026-06-14T09:00:00.000Z",
    recorded_at: "2026-06-14T09:00:00.000Z",
    updated_at: "2026-06-14T09:00:00.000Z",
    ...overrides,
  };
}
