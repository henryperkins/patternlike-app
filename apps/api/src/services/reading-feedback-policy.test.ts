import { describe, expect, it } from "vitest";
import { resolveFeedbackGenerationPolicy, supportsFeedbackGenerationPolicy } from "./reading-feedback-policy.js";

describe("categorical feedback generation policy", () => {
  it("preserves the incumbent prompt and selection pair while disabled", () => {
    expect(resolveFeedbackGenerationPolicy(undefined)).toEqual({ promptVersion: "1.1.0", selectionVersion: "1.5.0", categorical: false });
    expect(resolveFeedbackGenerationPolicy("0")).toEqual(resolveFeedbackGenerationPolicy(undefined));
  });

  it("requires an explicit switch and identifies the changed semantics", () => {
    expect(resolveFeedbackGenerationPolicy("1")).toEqual({ promptVersion: "1.1.1", selectionVersion: "1.6.0", categorical: true });
    expect(resolveFeedbackGenerationPolicy("true")).toBeNull();
    expect(resolveFeedbackGenerationPolicy("2")).toBeNull();
  });

  it("supports both current modes and refuses old or mixed policy identities", () => {
    expect(supportsFeedbackGenerationPolicy("1.0.3", "1.3.0")).toBe(false);
    expect(supportsFeedbackGenerationPolicy("1.0.4", "1.4.0")).toBe(false);
    expect(supportsFeedbackGenerationPolicy("1.1.0", "1.5.0")).toBe(true);
    expect(supportsFeedbackGenerationPolicy("1.1.1", "1.6.0")).toBe(true);
    expect(supportsFeedbackGenerationPolicy("1.1.0", "1.6.0")).toBe(false);
    expect(supportsFeedbackGenerationPolicy("1.1.1", "1.5.0")).toBe(false);
    expect(supportsFeedbackGenerationPolicy("unrecognized", "1.6.0")).toBe(false);
  });
});
