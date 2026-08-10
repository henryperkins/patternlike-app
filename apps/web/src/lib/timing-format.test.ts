import { describe, expect, it } from "vitest";
import {
  DURATION_OPTIONS,
  PHASE_OPTIONS,
  formatTimingDuration,
  formatTimingInstant,
  formatTimingOrb,
  timingCycleTitle,
  timingDirectionLabel,
  timingPhaseLabel,
} from "./timing-format.js";

describe("Timing factual formatting", () => {
  it("builds the established factual cycle title", () => {
    expect(timingCycleTitle("saturn", "square", "sun")).toBe(
      "Saturn square your Sun",
    );
  });

  it("labels known and future-safe cycle tokens deterministically", () => {
    expect(timingCycleTitle("true_node", "opposition", "midheaven")).toBe(
      "True Node opposition your Midheaven",
    );
    expect(
      timingCycleTitle("minor_planet", "sesquiquadrate", "part_of_fortune"),
    ).toBe("Minor planet sesquiquadrate your Part of fortune");
  });

  it("pins every phase and duration option label", () => {
    expect(PHASE_OPTIONS).toEqual([
      { value: "", label: "All phases" },
      { value: "emerging", label: "Emerging" },
      { value: "building", label: "Building" },
      { value: "peak", label: "Peak" },
      { value: "reconsidering", label: "Reconsidering" },
      { value: "integrating", label: "Integrating" },
      { value: "upcoming", label: "Upcoming" },
    ]);
    expect(DURATION_OPTIONS).toEqual([
      { value: "", label: "All durations" },
      { value: "short", label: "Under 3 months" },
      { value: "medium", label: "3–12 months" },
      { value: "long", label: "1 year or longer" },
    ]);
    expect(timingPhaseLabel("emerging", "active")).toBe("Emerging");
    expect(timingPhaseLabel("building", "active")).toBe("Building");
    expect(timingPhaseLabel("peak", "active")).toBe("Peak");
    expect(timingPhaseLabel("reconsidering", "active")).toBe("Reconsidering");
    expect(timingPhaseLabel("integrating", "active")).toBe("Integrating");
    expect(timingPhaseLabel(null, "upcoming")).toBe("Upcoming");
  });

  it("labels both pass directions", () => {
    expect(timingDirectionLabel("direct")).toBe("Direct");
    expect(timingDirectionLabel("retrograde")).toBe("Retrograde");
  });

  it("uses one fractional digit for elapsed days and orb", () => {
    expect(formatTimingDuration(191.55685185185186)).toBe("191.6 days");
    expect(formatTimingOrb(3)).toBe("3.0°");
  });

  it("formats real instants locally and preserves malformed values", () => {
    const value = "2026-08-02T14:11:07Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

    expect(formatTimingInstant(value)).toBe(expected);
    expect(formatTimingInstant("not-an-instant")).toBe("not-an-instant");
  });
});
