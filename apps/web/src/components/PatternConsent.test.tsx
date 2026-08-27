import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PatternConsent } from "@patternlike/shared";
import { PATTERN_GENERATION_CONSENT_POLICY_VERSION } from "@patternlike/shared";

import { PatternConsentTerms } from "./PatternConsent.js";

function consent(overrides: Partial<PatternConsent> = {}): PatternConsent {
  return {
    schema_version: "0.7.0",
    kind: "pattern_generation",
    status: "not_granted",
    provider: "OpenAI",
    purpose: "one_pattern_per_chart",
    policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    enabled_categories: [
      "calculated_natal_features",
      "accuracy_and_suppression",
      "confirmed_content_locale",
      "activated_interpretation_ontology",
      "generated_pattern_plan_and_draft_for_validation",
    ],
    granted_at: null,
    ...overrides,
  };
}

function terms(): string {
  return document.body.textContent ?? "";
}

describe("Pattern consent terms", () => {
  it("names the processor and the generation service separately", () => {
    render(<PatternConsentTerms consent={consent()} />);

    // `provider` is the processor of record and stays `OpenAI` in D1 and on the
    // wire. Naming only it left the reader unable to tell which service writes
    // their Pattern.
    expect(screen.getByText("Processor")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Generation service")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.queryByText("Provider")).toBeNull();
  });

  it("shows the policy version currently in force", () => {
    render(<PatternConsentTerms consent={consent()} />);
    expect(screen.getByText(`v${PATTERN_GENERATION_CONSENT_POLICY_VERSION}`)).toBeTruthy();
    expect(PATTERN_GENERATION_CONSENT_POLICY_VERSION).toBe("1.1.0");
  });

  it("makes no promise about the processor that Pattern/Like cannot keep", () => {
    render(<PatternConsentTerms consent={consent()} />);
    const text = terms();

    // The 1.0.0 copy said requests were sent with provider-side storage off,
    // that retention was thirty days, and that granting turned training off.
    // None of the three is something this grant controls.
    expect(text).not.toContain("provider-side storage turned off");
    expect(text).not.toContain("30 days");
    expect(text).not.toMatch(/retention is (?:necessarily )?30/i);
  });

  it("states who governs training and retention, and what Pattern/Like deletes", () => {
    render(<PatternConsentTerms consent={consent()} />);
    const text = terms();

    expect(text).toContain("sent once, to Codex, run by OpenAI");
    expect(text).toContain("not consent to train a model");
    expect(text).toContain("account and workspace");
    expect(text).toContain("agreement");
    expect(text).toContain(
      "deletes its own encrypted copies of the request and the response",
    );
  });

  it("keeps the input list, the exclusion list, and the purpose", () => {
    render(<PatternConsentTerms consent={consent()} />);
    const text = terms();

    expect(text).toContain("Writing one Pattern for this chart, and nothing else.");
    expect(text).toContain("Birth date, time, place, and coordinates are not sent as fields");
    expect(text).toContain("Calculated natal features are still sensitive derived data");
    expect(text).toContain(
      "Daily check-ins, life events, journal entries, prior readings, and a biography are not sent",
    );
  });

  it("keeps the no-reroll, permanent-deletion, and withdrawal warnings", () => {
    render(<PatternConsentTerms consent={consent()} />);
    const text = terms();

    expect(text).toContain("A successful Pattern cannot be rerolled for this chart.");
    expect(text).toContain("Deleting your Pattern is permanent.");
    expect(text).toContain("Withdrawing stops unfinished and future Pattern generation.");
    expect(text).toContain("An already accepted Pattern stays readable until you delete it.");
  });

  it("offers the privacy pointer only where the reader is granting", () => {
    const { unmount } = render(<PatternConsentTerms consent={consent()} />);
    expect(terms()).not.toContain("You can review or withdraw this later");
    unmount();

    render(<PatternConsentTerms consent={consent()} privacyLink />);
    expect(terms()).toContain("You can review or withdraw this later in Context & privacy.");
  });
});
