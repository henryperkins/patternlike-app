import type { LongitudePosition } from "@patternlike/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartWheel } from "./ChartWheel.js";

const BADGE_DIAMETER = 26;

function labelCentres(container: HTMLElement) {
  return [...container.querySelectorAll(".wheel-body__label-bg")].map((circle) => ({
    body: circle.parentElement?.querySelector("text")?.textContent?.trim() ?? "?",
    x: Number(circle.getAttribute("cx")),
    y: Number(circle.getAttribute("cy")),
  }));
}

function closestPair(container: HTMLElement) {
  const centres = labelCentres(container);
  let closest = { pair: "", distance: Number.POSITIVE_INFINITY };
  for (let a = 0; a < centres.length; a++) {
    for (let b = a + 1; b < centres.length; b++) {
      const distance = Math.hypot(centres[a].x - centres[b].x, centres[a].y - centres[b].y);
      if (distance < closest.distance) {
        closest = { pair: `${centres[a].body}/${centres[b].body}`, distance };
      }
    }
  }
  return closest;
}

function positions(longitudes: Array<[LongitudePosition["body"], number]>): LongitudePosition[] {
  return longitudes.map(([body, longitude_deg]) => ({ body, longitude_deg }));
}

describe("chart wheel labels", () => {
  it("keeps clustered bodies from drawing on top of each other", () => {
    // Mercury, the Sun and Venus inside seven degrees, plus a second cluster of
    // three outer planets: the shape that produced four overlapping badges.
    const { container } = render(
      <ChartWheel
        positions={positions([
          ["sun", 54.12],
          ["mercury", 47.86],
          ["venus", 60.31],
          ["moon", 201.4],
          ["saturn", 285.44],
          ["uranus", 278.1],
          ["neptune", 283.77],
          ["pluto", 226.9],
        ])}
        aspects={[]}
        houseCusps={null}
      />,
    );

    expect(closestPair(container).distance).toBeGreaterThanOrEqual(BADGE_DIAMETER);
  });

  it("keeps labels apart across the zero degree seam", () => {
    const { container } = render(
      <ChartWheel
        positions={positions([
          ["sun", 1.5],
          ["mercury", 356.2],
          ["venus", 359.4],
          ["mars", 3.1],
          ["moon", 180],
        ])}
        aspects={[]}
        houseCusps={null}
      />,
    );

    expect(closestPair(container).distance).toBeGreaterThanOrEqual(BADGE_DIAMETER);
  });

  it("leaves a single body on its own longitude", () => {
    const { container } = render(
      <ChartWheel positions={positions([["sun", 54.12]])} aspects={[]} houseCusps={null} />,
    );

    const [only] = labelCentres(container);
    const radians = ((54.12 - 90) * Math.PI) / 180;
    expect(only.x).toBeCloseTo(260 + Math.cos(radians) * 168, 5);
    expect(only.y).toBeCloseTo(260 + Math.sin(radians) * 168, 5);
  });
});
