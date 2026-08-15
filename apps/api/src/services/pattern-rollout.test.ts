import { describe, expect, it } from "vitest";
import {
  consumerAdmissionEntry,
  isInternalPatternAccount,
  patternRolloutAllows,
  readInternalAccountIds,
  readPatternAiRollout,
} from "./pattern-rollout.js";

describe("PATTERN_AI_ROLLOUT internal allowlist", () => {
  it("treats a missing or malformed allowlist as empty", () => {
    expect(readInternalAccountIds({})).toEqual(new Set());
    expect(readInternalAccountIds({ PATTERN_INTERNAL_ACCOUNT_IDS: "" })).toEqual(new Set());
    expect(readInternalAccountIds({ PATTERN_INTERNAL_ACCOUNT_IDS: "{not-json" })).toEqual(new Set());
    expect(readInternalAccountIds({ PATTERN_INTERNAL_ACCOUNT_IDS: "[1,2]" })).toEqual(new Set());
  });

  it("parses JSON arrays and comma-separated user ids", () => {
    expect(readInternalAccountIds({ PATTERN_INTERNAL_ACCOUNT_IDS: '["usr_a","usr_b"]' }))
      .toEqual(new Set(["usr_a", "usr_b"]));
    expect(readInternalAccountIds({ PATTERN_INTERNAL_ACCOUNT_IDS: "usr_a, usr_b" }))
      .toEqual(new Set(["usr_a", "usr_b"]));
  });

  it("admits first_open as internal only for allowlisted accounts", () => {
    const env = { PATTERN_INTERNAL_ACCOUNT_IDS: "usr_staff" };
    expect(isInternalPatternAccount(env, "usr_staff")).toBe(true);
    expect(consumerAdmissionEntry(env, "usr_staff", "first_open")).toBe("internal");
    expect(consumerAdmissionEntry(env, "usr_other", "first_open")).toBe("first_open");
    expect(patternRolloutAllows("internal", "internal")).toBe(true);
    expect(patternRolloutAllows("internal", "first_open")).toBe(false);
    expect(consumerAdmissionEntry(env, "usr_other", "chart_correction")).toBe("chart_correction");
  });

  it("reads off as the kill switch when the var is empty", () => {
    expect(readPatternAiRollout({})).toBe("off");
    expect(readPatternAiRollout({ PATTERN_AI_ROLLOUT: "internal" })).toBe("internal");
  });

  it("accepts every value the rollout runbook instructs an operator to set", () => {
    // A value the enum does not carry reads as null, which
    // resolvePatternPublisherConfiguration turns into pattern_rollout_invalid
    // and configGuard returns as 503 on every path -- including
    // POST /v1/sessions. `enabled` is step 10 of the deployment order in the
    // design spec, so following the runbook must not take the API down.
    for (const mode of ["off", "internal", "first_open", "enabled"] as const) {
      expect(readPatternAiRollout({ PATTERN_AI_ROLLOUT: mode })).toBe(mode);
    }
    expect(readPatternAiRollout({ PATTERN_AI_ROLLOUT: "hybrid" })).toBeNull();
  });

  it("admits the same consumer entry points under enabled as under first_open", () => {
    for (const entry of ["internal", "first_open", "chart_correction"] as const) {
      expect(patternRolloutAllows("enabled", entry)).toBe(true);
    }
  });
});
