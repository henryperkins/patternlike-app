import { test } from "node:test";
import assert from "node:assert/strict";

import { computePhase, isActiveAt, PHASE_THRESHOLDS } from "./phase.js";
import type { NormalizedCycle } from "./types.js";

/** The canonical three-pass retrograde encounter from the contract fixtures. */
const retrograde: NormalizedCycle = {
  id: "cyc_" + "ab".repeat(16),
  technique: "transit",
  body: "saturn",
  target: "sun",
  aspect: "square",
  start_at: "2026-07-19T05:22:10Z",
  exact_at: "2026-08-02T14:11:07Z",
  end_at: "2027-01-26T18:44:02Z",
  pass_count: 3,
  orb_deg: 3,
  passes: [
    { pass_index: 1, direction: "direct", exact_at: "2026-08-02T14:11:07Z", speed_deg_per_day: 0.0331 },
    { pass_index: 2, direction: "retrograde", exact_at: "2026-10-19T03:52:44Z", speed_deg_per_day: -0.0288 },
    { pass_index: 3, direction: "direct", exact_at: "2027-01-11T21:07:19Z", speed_deg_per_day: 0.0302 },
  ],
};

const singlePass: NormalizedCycle = {
  ...retrograde,
  id: "cyc_" + "cd".repeat(16),
  start_at: "2026-07-28T00:00:00Z",
  exact_at: "2026-07-30T22:40:00Z",
  end_at: "2026-08-02T00:00:00Z",
  pass_count: 1,
  passes: [
    { pass_index: 1, direction: "direct", exact_at: "2026-07-30T22:40:00Z", speed_deg_per_day: 1.1 },
  ],
};

test("a cycle has no phase outside its calculated orb envelope", () => {
  assert.equal(isActiveAt(retrograde, "2026-07-01T00:00:00Z"), false);
  assert.equal(computePhase(retrograde, "2026-07-01T00:00:00Z"), null);
  assert.equal(computePhase(retrograde, "2027-03-01T00:00:00Z"), null);
});

test("the approach splits into emerging then building", () => {
  // Orb entry 2026-07-19, first exact 2026-08-02: a ~14.4 day approach.
  assert.equal(computePhase(retrograde, "2026-07-20T00:00:00Z"), "emerging");
  assert.equal(computePhase(retrograde, "2026-07-30T12:00:00Z"), "building");
});

test("peak is a window around ANY pass, not only the first", () => {
  assert.equal(computePhase(retrograde, "2026-08-02T14:11:07Z"), "peak");
  assert.equal(computePhase(retrograde, "2026-10-19T03:52:44Z"), "peak");
  assert.equal(computePhase(retrograde, "2027-01-11T21:07:19Z"), "peak");
});

test("reconsidering is reachable — it is the interior of the retrograde loop", () => {
  // Under a one-pass model this state is unreachable, which is why the M0
  // schema could not express the product's own phase vocabulary.
  assert.equal(computePhase(retrograde, "2026-09-10T00:00:00Z"), "reconsidering");
  assert.equal(computePhase(retrograde, "2026-12-01T00:00:00Z"), "reconsidering");
});

test("peak takes precedence over the reconsidering interval it sits inside", () => {
  // The middle pass is simultaneously "within a peak window" and "after pass 1
  // and before the final pass". Without a stated precedence the state machine
  // is ambiguous exactly where multi-pass cycles are most interesting.
  const middle = Date.parse("2026-10-19T03:52:44Z");
  const inside = new Date(middle - 12 * 3_600_000).toISOString();
  assert.ok(middle > Date.parse(retrograde.passes[0]!.exact_at));
  assert.ok(middle < Date.parse(retrograde.passes[2]!.exact_at));
  assert.equal(computePhase(retrograde, inside), "peak");
});

test("integrating follows the final pass", () => {
  assert.equal(computePhase(retrograde, "2027-01-20T00:00:00Z"), "integrating");
});

test("a single-pass cycle never reports reconsidering", () => {
  const seen = new Set<string | null>();
  const start = Date.parse(singlePass.start_at);
  const end = Date.parse(singlePass.end_at);
  for (let t = start; t <= end; t += 3_600_000) {
    seen.add(computePhase(singlePass, new Date(t).toISOString()));
  }
  assert.equal(seen.has("reconsidering"), false);
});

test("the state machine is total across the whole envelope", () => {
  const start = Date.parse(retrograde.start_at);
  const end = Date.parse(retrograde.end_at);
  for (let t = start; t <= end; t += 6 * 3_600_000) {
    const phase = computePhase(retrograde, new Date(t).toISOString());
    assert.ok(phase !== null, `no phase at ${new Date(t).toISOString()}`);
  }
});

test("thresholds are a single versioned block, not scattered literals", () => {
  assert.equal(typeof PHASE_THRESHOLDS.peakWindowHours, "number");
  assert.equal(typeof PHASE_THRESHOLDS.emergingFractionOfApproach, "number");
});
