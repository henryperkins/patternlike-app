import { describe, expect, it } from "vitest";

import { PATTERN_COMMAND_VERSION, isPatternCommand } from "./pattern-command.js";

function commandWithMaxima(
  writerAttemptsMax: unknown,
  plannerAttemptsMax: unknown = 2,
  verifierAttemptsMax: unknown = 2,
): Record<string, unknown> {
  return {
    command_version: PATTERN_COMMAND_VERSION,
    planner_attempts_max: plannerAttemptsMax,
    writer_attempts_max: writerAttemptsMax,
    verifier_attempts_max: verifierAttemptsMax,
  };
}

describe("Pattern command attempt maxima", () => {
  it.each([2, 3])("decodes a stored writer maximum of %i", (writerAttemptsMax) => {
    expect(isPatternCommand(commandWithMaxima(writerAttemptsMax))).toBe(true);
  });

  it.each([undefined, null, -1, 0, 1, 4, "3"])(
    "rejects writer_attempts_max=%s",
    (writerAttemptsMax) => {
      expect(isPatternCommand(commandWithMaxima(writerAttemptsMax))).toBe(false);
    },
  );

  it.each([
    [null, 2],
    [1, 2],
    [3, 2],
    ["2", 2],
    [2, null],
    [2, 1],
    [2, 3],
    [2, "2"],
  ])(
    "rejects planner_attempts_max=%s and verifier_attempts_max=%s",
    (plannerAttemptsMax, verifierAttemptsMax) => {
      expect(
        isPatternCommand(commandWithMaxima(3, plannerAttemptsMax, verifierAttemptsMax)),
      ).toBe(false);
    },
  );

  it.each(["planner_attempts_max", "verifier_attempts_max"] as const)(
    "rejects a command missing %s",
    (field) => {
      const command = commandWithMaxima(3);
      delete command[field];
      expect(isPatternCommand(command)).toBe(false);
    },
  );
});
