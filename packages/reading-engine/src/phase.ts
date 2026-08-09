/**
 * Cycle lifecycle phase (DER-01).
 *
 * DER-01 defines this as a deterministic state machine over event timestamps,
 * recomputed "at each daily reading". The stored `cycle_instances.phase` column
 * is therefore a scan-time cache for `/v1/timing` filtering, not the authority:
 * a reading must be reproducible from immutable facts rather than from a column
 * that has since been overwritten.
 *
 * The phase vocabulary contains `reconsidering`, which is unreachable under a
 * one-pass model — it is precisely the interior of a retrograde loop, between
 * the first and final exact pass. Multi-pass cycles are what make the product's
 * own phase language expressible.
 *
 * Every threshold lives in this one versioned block rather than at call sites,
 * and `cycle_policy_version` (persisted as `cycle_instances.horizon_version`)
 * must bump when they change, so a threshold change re-scans into a new vintage
 * instead of mixing vintages in one table.
 */

import type { CyclePhase, NormalizedCycle } from "./types.js";

export const PHASE_POLICY_VERSION = "1.0.0";

export const PHASE_THRESHOLDS = {
  /**
   * Within this many hours either side of any exact pass, the cycle reads as
   * `peak`. Timestamp-driven rather than orb-driven because DER-01 specifies a
   * state machine over event timestamps, and because the engine is pure: it has
   * no ephemeris with which to evaluate an instantaneous orb.
   */
  peakWindowHours: 36,
  /**
   * How much of the approach from orb entry to the first exact pass counts as
   * `emerging`. The remainder is `building`.
   */
  emergingFractionOfApproach: 0.5,
} as const;

const HOUR_MS = 3_600_000;

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`phase: ${label} is not a parseable instant: ${value}`);
  }
  return parsed;
}

/** True when `at` falls inside the cycle's calculated orb envelope. */
export function isActiveAt(cycle: NormalizedCycle, at: string): boolean {
  const t = instant(at, "at");
  return (
    t >= instant(cycle.start_at, "start_at") && t <= instant(cycle.end_at, "end_at")
  );
}

/**
 * The phase of `cycle` on the instant `at`, or null when the cycle is not
 * active then.
 *
 * Precedence is explicit and `peak` wins. For a three-pass retrograde the
 * middle pass's peak window sits inside the `reconsidering` interval, so both
 * rules fire on the same instant; without a stated order the state machine is
 * ambiguous exactly where multi-pass cycles are most interesting.
 */
export function computePhase(cycle: NormalizedCycle, at: string): CyclePhase | null {
  if (!isActiveAt(cycle, at)) return null;

  const t = instant(at, "at");
  const start = instant(cycle.start_at, "start_at");
  const passes = cycle.passes.length
    ? cycle.passes.map((p) => instant(p.exact_at, "pass.exact_at"))
    : [instant(cycle.exact_at, "exact_at")];

  const peakWindow = PHASE_THRESHOLDS.peakWindowHours * HOUR_MS;

  // 1. peak — within the peak window of ANY pass. Checked first so it takes
  //    precedence over the reconsidering interval it sits inside.
  for (const pass of passes) {
    if (Math.abs(t - pass) <= peakWindow) return "peak";
  }

  const first = passes[0]!;
  const last = passes[passes.length - 1]!;

  // 2. reconsidering — after the first pass and before the final one. Only
  //    reachable for a multi-pass cycle, which is the point.
  if (passes.length > 1 && t > first && t < last) return "reconsidering";

  // 3. integrating — separating from the final pass toward orb exit.
  if (t > last) return "integrating";

  // 4. emerging / building — the approach, split by how much of it remains.
  const approach = first - start;
  if (approach <= 0) return "building";
  const elapsed = (t - start) / approach;
  return elapsed < PHASE_THRESHOLDS.emergingFractionOfApproach ? "emerging" : "building";
}

/** Whether `phase` is a peak-adjacent state, used by ranking. */
export function phaseWeight(phase: CyclePhase | null): number {
  switch (phase) {
    case "peak":
      return 1;
    case "building":
      return 0.75;
    case "reconsidering":
      return 0.6;
    case "integrating":
      return 0.4;
    case "emerging":
      return 0.3;
    default:
      return 0;
  }
}
