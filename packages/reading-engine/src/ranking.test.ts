import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreFact } from "./ranking.js";
import type { AssemblyFactInput } from "./types.js";

/**
 * Direct coverage for the DER-02 exactness factor.
 *
 * It carries the largest weight in the table (0.30) and orders both the
 * deterministic assembler and the constrained packet, and it had no test of its
 * own until the temporal proxy replaced the orb ratio.
 */

const EXACTNESS_WEIGHT = 0.3;

/** A day, in ms, so the envelope arithmetic below reads as calendar distance. */
const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(T0 + days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");

function cycle(overrides: Partial<AssemblyFactInput> = {}): AssemblyFactInput {
  return {
    id: "cyc_test",
    fact_class: "cycle_instance",
    technique: "transit",
    body: "saturn",
    target: "sun",
    aspect: "square",
    phase: "building",
    orb_deg: 2,
    first_exact_at: at(10),
    pass_count: 1,
    start_at: at(0),
    end_at: at(120),
    pass_exact_ats: [at(10)],
    ...overrides,
  };
}

/** The exactness factor's raw value, recovered from its weighted contribution. */
function exactnessOf(fact: AssemblyFactInput, instant: string | null) {
  const scored = scoreFact(fact, {
    domainPreference: null,
    matchingCycleObject: null,
    seenRecently: false,
    at: instant,
  });
  const factor = scored.factors.find((f) => f.factor === "exactness");
  assert.ok(factor, "every scored fact records an exactness factor");
  return {
    value: (factor.weight ?? 0) / EXACTNESS_WEIGHT,
    reason: factor.reason,
  };
}

const close = (actual: number, expected: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${what}: expected ~${expected}, got ${actual}`,
  );

// ---------------------------------------------------------------------------

test("an off-centre pass reaches zero at both real envelope edges, not partway", () => {
  // The pass sits at day 10 of a 0..120 envelope. Normalizing against half the
  // envelope (60) would score orb entry at 1 - 10/60 = 0.83 and pin everything
  // from day 70 onward at 0. Per-side normalization puts the zero where the
  // docstring says it is.
  const fact = cycle();
  close(exactnessOf(fact, at(0)).value, 0, "orb entry");
  close(exactnessOf(fact, at(10)).value, 1, "the exact pass");
  close(exactnessOf(fact, at(120)).value, 0, "orb exit");

  // Still discriminating across the long side rather than flat at zero.
  close(exactnessOf(fact, at(65)).value, 0.5, "halfway to orb exit");
  close(exactnessOf(fact, at(5)).value, 0.5, "halfway to orb entry");
});

test("exactness falls monotonically away from the pass on each side", () => {
  const fact = cycle();
  let previous = exactnessOf(fact, at(10)).value;
  for (const day of [20, 40, 60, 80, 100, 120]) {
    const current = exactnessOf(fact, at(day)).value;
    assert.ok(current <= previous, `day ${day}: ${current} must not exceed ${previous}`);
    previous = current;
  }
  previous = exactnessOf(fact, at(10)).value;
  for (const day of [8, 6, 4, 2, 0]) {
    const current = exactnessOf(fact, at(day)).value;
    assert.ok(current <= previous, `day ${day}: ${current} must not exceed ${previous}`);
    previous = current;
  }
});

test("a multi-pass envelope peaks at every pass, dips to neutral between them, and falls only at the edges", () => {
  const fact = cycle({
    pass_count: 3,
    first_exact_at: at(10),
    pass_exact_ats: [at(10), at(60), at(110)],
  });
  for (const day of [10, 60, 110]) {
    close(exactnessOf(fact, at(day)).value, 1, `pass at day ${day}`);
  }
  // Between two passes the denominator is the gap to the neighbouring pass,
  // so the value bottoms out at the neutral 0.5 exactly midway and never
  // reaches 0 inside the passes: the contact is inside orb the whole time,
  // and this package cannot say how far inside.
  close(exactnessOf(fact, at(35)).value, 0.5, "midway between the first two passes");
  close(exactnessOf(fact, at(85)).value, 0.5, "midway between the last two passes");
  close(exactnessOf(fact, at(20)).value, 0.8, "a fifth of the way to the next pass");
  close(exactnessOf(fact, at(100)).value, 0.8, "a fifth of the way back to the previous pass");
  for (const day of [15, 25, 45, 55, 70, 95, 105]) {
    assert.ok(exactnessOf(fact, at(day)).value >= 0.5, `day ${day} stays at or above neutral`);
  }
  // Only the envelope edges reach zero.
  close(exactnessOf(fact, at(0)).value, 0, "orb entry");
  close(exactnessOf(fact, at(120)).value, 0, "orb exit");
  close(exactnessOf(fact, at(5)).value, 0.5, "halfway from orb entry to the first pass");
  close(exactnessOf(fact, at(115)).value, 0.5, "halfway from the last pass to orb exit");
});

test("exactness is continuous where the nearest pass changes hands", () => {
  // Passes at days 10, 60 and 110 inside a 0..120 envelope. The nearest pass
  // switches at day 35 and again at day 85. Normalizing against the envelope
  // edge on both sides of the switch would drop the value from 1 - 25/110 to
  // 1 - 25/60 in one step, reordering Daily and Time Travel priorities on a
  // day when nothing about the contact changed.
  const fact = cycle({
    pass_count: 3,
    first_exact_at: at(10),
    pass_exact_ats: [at(10), at(60), at(110)],
  });
  const step = 0.25;
  for (const boundary of [35, 85]) {
    let previous = exactnessOf(fact, at(boundary - 2)).value;
    for (let day = boundary - 2 + step; day <= boundary + 2 + 1e-9; day += step) {
      const current = exactnessOf(fact, at(day)).value;
      assert.ok(
        Math.abs(current - previous) < 0.01,
        `day ${day}: ${previous} -> ${current} is a jump, not a slope`,
      );
      previous = current;
    }
    const before = exactnessOf(fact, at(boundary - 0.01)).value;
    const after = exactnessOf(fact, at(boundary + 0.01)).value;
    assert.ok(Math.abs(before - after) < 0.001, `day ${boundary}: ${before} vs ${after}`);
  }
  // And it recovers towards the next pass rather than staying pinned.
  assert.ok(
    exactnessOf(fact, at(50)).value > exactnessOf(fact, at(40)).value,
    "climbs back towards the second pass",
  );
});

test("a fact with no scale to divide by scores neutral, never maximum", () => {
  // Returning 1 here would hand the largest weight in the table to every fact
  // whose exactness is simply unknown.
  const natal: AssemblyFactInput = {
    ...cycle(),
    id: "nat_test",
    fact_class: "natal_aspect",
    technique: null,
    phase: null,
    orb_deg: 5.9,
    first_exact_at: null,
    pass_count: null,
    start_at: null,
    end_at: null,
    pass_exact_ats: null,
  };
  const measured = exactnessOf(natal, at(10));
  close(measured.value, 0.5, "natal aspect with an orb but no ceiling");
  assert.equal(measured.reason, "no_orb_ceiling_treated_as_neutral");

  // A tight natal orb and a wide one score the same, because this package has
  // no ceiling to tell them apart. That is the honest answer, not 1.
  close(exactnessOf({ ...natal, orb_deg: 0.2 }, at(10)).value, 0.5, "tight natal orb");

  const sky: AssemblyFactInput = { ...natal, fact_class: "lunar_phase", orb_deg: null };
  const unscaled = exactnessOf(sky, at(10));
  close(unscaled.value, 0.5, "daily-sky fact with no orb concept");
  assert.equal(unscaled.reason, "no_orb_scale_treated_as_neutral");
});

test("a genuinely exact contact still scores maximum", () => {
  const exact = exactnessOf(cycle({ orb_deg: 0 }), at(10));
  close(exact.value, 1, "orb zero");
  assert.equal(exact.reason, "orb_zero_is_exact");
});

test("the recorded reason always names the branch the arithmetic took", () => {
  // Value and reason are returned together precisely so these cannot disagree;
  // an envelope with no pass is the case the previous split computation got
  // wrong, reporting a temporal measure it never performed.
  const noPass = exactnessOf(
    cycle({ first_exact_at: null, pass_exact_ats: [] }),
    at(10),
  );
  close(noPass.value, 0.5, "envelope with no pass");
  assert.equal(noPass.reason, "envelope_without_pass_treated_as_neutral");

  const noInstant = exactnessOf(cycle(), null);
  close(noInstant.value, 0.5, "no evaluation instant");
  assert.equal(noInstant.reason, "no_orb_ceiling_treated_as_neutral");

  const unparseable = exactnessOf(cycle({ start_at: "not-a-date" }), at(10));
  close(unparseable.value, 0.5, "unparseable envelope");
  assert.equal(unparseable.reason, "unparseable_envelope_treated_as_neutral");

  const degenerate = exactnessOf(cycle({ start_at: at(120), end_at: at(120) }), at(10));
  close(degenerate.value, 0.5, "degenerate envelope");
  assert.equal(degenerate.reason, "degenerate_envelope_treated_as_neutral");
});

test("scoring is deterministic and independent of pass ordering ties", () => {
  // Two passes equidistant from the instant: the earlier one must win every
  // time, or the same corpus ranks differently between runs.
  const tied = cycle({ pass_count: 2, pass_exact_ats: [at(10), at(60)], first_exact_at: at(10) });
  const first = exactnessOf(tied, at(35));
  for (let i = 0; i < 5; i += 1) {
    assert.equal(exactnessOf(tied, at(35)).value, first.value);
  }
});
