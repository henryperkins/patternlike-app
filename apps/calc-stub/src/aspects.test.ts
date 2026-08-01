import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASPECT_ANGLE_BY_TYPE,
  angularSeparation,
  goldenExactFixture,
  isApplying,
} from "./engine.js";

describe("applying / separating", () => {
  it("is true when a conjunction is closing", () => {
    // A at 0° gaining on B parked at 5°: separation 5 → 4.
    assert.equal(isApplying(0, 5, 1, 0, 0), true);
  });

  it("is false when a conjunction is opening", () => {
    assert.equal(isApplying(0, 5, 0, 1, 0), false);
  });

  it("is true when a trine is closing from below the aspect angle", () => {
    // Separation 118° growing toward an exact 120° trine.
    assert.equal(isApplying(0, 118, 0, 1, 120), true);
  });

  it("is false when the separation shrinks away from the aspect angle", () => {
    // Separation 118° shrinking to 117° — moving away from 120°, so the orb
    // grows. The old heuristic called this applying because separation closed.
    assert.equal(isApplying(0, 118, 0, -1, 120), false);
  });

  it("is true when a trine is closing from above the aspect angle", () => {
    // Separation 122° shrinking toward 120°.
    assert.equal(isApplying(0, 122, 0, -1, 120), true);
  });

  it("is false when a trine is opening from above the aspect angle", () => {
    assert.equal(isApplying(0, 122, 0, 1, 120), false);
  });

  it("handles the 0/360 wrap", () => {
    // A at 359°, B at 1°: separation 2°, A gaining → conjunction applying.
    assert.equal(isApplying(359, 1, 1, 0, 0), true);
    assert.equal(isApplying(1, 359, 0, 1, 0), true);
  });

  it("treats an exact aspect as neither applying nor separating", () => {
    assert.equal(isApplying(0, 120, 0, 1, 120), false);
  });

  it("matches the sign of the numerically differentiated orb on the golden chart", async () => {
    const chart = await goldenExactFixture();
    const byBody = new Map(chart.positions.map((p) => [p.body, p]));

    let checked = 0;
    const failures: string[] = [];

    for (const asp of chart.aspects) {
      const a = byBody.get(asp.body_a);
      const b = byBody.get(asp.body_b);
      assert.ok(a && b, `missing position for ${asp.body_a}/${asp.body_b}`);

      const speedA = a.speed_longitude_deg_per_day ?? 0;
      const speedB = b.speed_longitude_deg_per_day ?? 0;
      const angle = ASPECT_ANGLE_BY_TYPE[asp.aspect];

      // Choose dt so the pair moves ~0.001° relative to each other: three orders
      // of magnitude above the 1e-6 rounding on stored longitudes, and far too
      // small to step over exactness.
      const relSpeed = Math.abs(speedA - speedB);
      if (relSpeed === 0) continue;
      const dt = 0.001 / relSpeed;

      const orbNow = Math.abs(
        angularSeparation(a.longitude_deg, b.longitude_deg) - angle,
      );
      if (orbNow < 1e-6) continue; // exact: derivative undefined
      const orbLater = Math.abs(
        angularSeparation(
          a.longitude_deg + speedA * dt,
          b.longitude_deg + speedB * dt,
        ) - angle,
      );

      const expected = orbLater < orbNow;
      if (asp.applying !== expected) {
        failures.push(
          `${asp.aspect} ${asp.body_a}/${asp.body_b}: applying=${asp.applying} ` +
            `but orb ${orbNow.toFixed(6)} → ${orbLater.toFixed(6)}`,
        );
      }
      checked++;
    }

    assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
    assert.ok(checked >= 10, `expected a meaningful aspect count, checked ${checked}`);
  });
});
