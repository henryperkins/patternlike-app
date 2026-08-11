import { describe, expect, it } from "vitest";

import {
  READING_V5_ROLLOUT_MODES,
  isReadingV5Rollout,
  readReadingV5Rollout,
  rolloutAllows,
  type ReadingV5Rollout,
  type RolloutEntry,
} from "./reading-rollout.js";

/**
 * The staged switch, and the kill switch, in one closed value.
 *
 * The matrix below is the whole contract: each mode admits a prefix of the
 * entry points, so enabling one can never enable a later one by accident and
 * downgrading gates new entries while already-claimed work finishes under its
 * frozen command.
 */
describe("reading rollout modes", () => {
  it("is a closed four-value set", () => {
    expect([...READING_V5_ROLLOUT_MODES]).toEqual(["off", "internal", "first_open", "hybrid"]);
    for (const mode of READING_V5_ROLLOUT_MODES) {
      expect(isReadingV5Rollout(mode)).toBe(true);
    }
    for (const invalid of ["", "on", "OFF", "of", "enabled", "first-open", "scheduled"]) {
      expect(isReadingV5Rollout(invalid), invalid).toBe(false);
    }
  });

  it("admits exactly the entry points each mode names", () => {
    const matrix: Record<ReadingV5Rollout, RolloutEntry[]> = {
      off: [],
      internal: ["internal"],
      first_open: ["internal", "first_open"],
      hybrid: ["internal", "first_open", "scheduled"],
    };
    const entries: RolloutEntry[] = ["internal", "first_open", "scheduled"];

    for (const mode of READING_V5_ROLLOUT_MODES) {
      for (const entry of entries) {
        expect(rolloutAllows(mode, entry), `${mode} / ${entry}`).toBe(
          matrix[mode].includes(entry),
        );
      }
    }
  });

  it("off permits no V2 reservation at all", () => {
    expect(rolloutAllows("off", "internal")).toBe(false);
    expect(rolloutAllows("off", "first_open")).toBe(false);
    expect(rolloutAllows("off", "scheduled")).toBe(false);
  });

  it("reads a configured mode and reports a malformed one rather than guessing", () => {
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "hybrid" })).toBe("hybrid");
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "  internal  " })).toBe("internal");
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "on" })).toBeNull();
    // A typo must never resolve to a permissive mode. "of" is one keystroke
    // from "off" and would be indistinguishable from the kill switch.
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "of" })).toBeNull();
  });

  it("treats an absent value as the kill switch, not as a fault", () => {
    // Every wrangler block declares this explicitly, so absent means a hand
    // built environment. Defaulting a kill switch to its safest position beats
    // refusing every request over a var whose absence means "feature off".
    expect(readReadingV5Rollout({})).toBe("off");
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "" })).toBe("off");
    expect(readReadingV5Rollout({ READING_V5_ROLLOUT: "   " })).toBe("off");
  });
});
