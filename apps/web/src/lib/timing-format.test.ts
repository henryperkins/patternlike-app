import { describe, expect, it } from "vitest";
import {
  DURATION_OPTIONS,
  PHASE_OPTIONS,
  TIMING_GLOSSARY,
  formatTimingDate,
  formatTimingDuration,
  formatTimingInstant,
  formatTimingLength,
  formatTimingLocalDate,
  formatTimingOrb,
  formatTimingTime,
  nextPassIndex,
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

  it("defines every phase word the filter offers, mechanically", () => {
    const phaseEntry = TIMING_GLOSSARY.find((entry) => entry.term === "Phase");
    expect(phaseEntry).toBeDefined();
    for (const option of PHASE_OPTIONS) {
      if (option.value === "" || option.value === "upcoming") continue;
      expect(phaseEntry!.definition).toMatch(new RegExp(`\\b${option.label}\\b`, "i"));
    }
    expect(TIMING_GLOSSARY.map((entry) => entry.term)).toEqual([
      "In range",
      "Exact pass",
      "Direct, retrograde",
      "Phase",
      "Upcoming",
    ]);
    // Position in the arc, never what the arc means for the reader.
    const prose = TIMING_GLOSSARY.map((entry) => entry.definition).join(" ");
    expect(prose).not.toMatch(/\b(you should|will bring|means that|expect)\b/i);
  });

  it("labels both pass directions", () => {
    expect(timingDirectionLabel("direct")).toBe("Direct");
    expect(timingDirectionLabel("retrograde")).toBe("Retrograde");
  });

  it("uses one fractional digit for elapsed days and orb", () => {
    expect(formatTimingDuration(191.55685185185186)).toBe("191.6 days");
    expect(formatTimingOrb(3)).toBe("3.0°");
  });

  it("rounds an envelope to the unit a reader plans in", () => {
    expect(formatTimingLength(0.8)).toBe("about a day");
    expect(formatTimingLength(9.4)).toBe("about 9 days");
    expect(formatTimingLength(18.75)).toBe("about 3 weeks");
    expect(formatTimingLength(55)).toBe("about 8 weeks");
    expect(formatTimingLength(191.55685185185186)).toBe("about 6 months");
    expect(formatTimingLength(340)).toBe("about 11 months");
    expect(formatTimingLength(360)).toBe("about a year");
    expect(formatTimingLength(560)).toBe("about 1.5 years");
    expect(formatTimingLength(760)).toBe("about 2 years");
    expect(formatTimingLength(Number.NaN)).toBe("");
  });

  it("formats real instants locally and preserves malformed values", () => {
    const value = "2026-08-02T14:11:07Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

    expect(formatTimingInstant(value)).toBe(expected);
    expect(formatTimingInstant("not-an-instant")).toBe("not-an-instant");
    expect(formatTimingTime(value)).toBe(
      new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
        new Date(value),
      ),
    );
    expect(formatTimingTime("not-an-instant")).toBe("not-an-instant");
  });

  it("shows a day, and the year only when it is not the reference year", () => {
    const asOf = "2026-08-10T05:15:00Z";
    const sameYear = formatTimingDate("2026-10-19T03:52:44Z", asOf);
    const nextYear = formatTimingDate("2027-01-11T21:07:19Z", asOf);

    expect(sameYear).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
        new Date("2026-10-19T03:52:44Z"),
      ),
    );
    expect(sameYear).not.toContain("2026");
    expect(nextYear).toContain("2027");
    expect(formatTimingDate("not-an-instant", asOf)).toBe("not-an-instant");
  });

  it("formats a bare local date as the day it names, in any zone", () => {
    const asOf = "2026-08-10T05:15:00Z";
    expect(formatTimingLocalDate("2026-08-09", asOf)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2026, 7, 9))),
    );
    expect(formatTimingLocalDate("2025-12-31", asOf)).toContain("2025");
    expect(formatTimingLocalDate("yesterday", asOf)).toBe("yesterday");
  });

  it("finds the next exact pass with the route's inclusive comparison", () => {
    const passes = [
      { exact_at: "2026-08-02T14:11:07Z" },
      { exact_at: "2026-10-19T03:52:44Z" },
      { exact_at: "2027-01-11T21:07:19Z" },
    ];
    expect(nextPassIndex(passes, "2026-08-10T05:15:00Z")).toBe(1);
    expect(nextPassIndex(passes, "2026-10-19T03:52:44Z")).toBe(1);
    expect(nextPassIndex(passes, "2026-07-01T00:00:00Z")).toBe(0);
    expect(nextPassIndex(passes, "2027-02-01T00:00:00Z")).toBe(-1);
    expect(nextPassIndex(passes, "not-an-instant")).toBe(-1);
  });
});
