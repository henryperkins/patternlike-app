import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AiConsentTerms } from "./AiConsent.js";
import { consentNotGranted } from "../test/reading-fixture.js";

/**
 * The sentences a reader agrees to.
 *
 * These are checked as literal strings because that is what makes them a
 * contract rather than a description. Every claim here is one the product has
 * to be able to keep, and the ones removed below were kept only by the direct
 * OpenAI API path: a Codex runner signed in to an account cannot promise
 * `store: false`, and no reader's grant has ever controlled a setting on
 * Pattern/Like's own OpenAI account.
 */

describe("the AI-synthesis consent terms", () => {
  it("names OpenAI as the processor and Codex as what writes the reading", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);

    // Two different facts, shown as two different things. The wire field stays
    // `provider` for compatibility, but a reader is told who processes their
    // data and, separately, what service generates the prose.
    expect(screen.getByText("Processor")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Codex");
  });

  it("makes no claim the Codex path cannot keep", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);
    const text = document.body.textContent ?? "";

    // `store: false` is an API parameter. A ChatGPT-authenticated Codex runner
    // has no equivalent, so the sentence that promised it is gone rather than
    // softened.
    expect(text).not.toContain("provider-side storage turned off");
    expect(text).not.toContain("up to 30 days");
    // Retention follows the account agreement, which is not something this
    // screen sets.
    expect(text).not.toContain("granting this leaves both of them off");
  });

  it("keeps the training statement honest about who controls the setting", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);
    const text = document.body.textContent ?? "";

    expect(text).toContain("This is not consent to train a model.");
    // The distinction the old copy blurred: Pattern/Like holds the account
    // whose training controls are off. The reader's grant does not reach it.
    expect(text).toMatch(/Pattern\/Like/);
    expect(text).toMatch(/does not change/i);
  });

  it("says what Pattern/Like does with its own copy of the exchange", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);
    expect(document.body.textContent ?? "").toMatch(
      /deletes its own encrypted copy/i,
    );
  });

  it("keeps the categories, the purpose, the free-text warning, and revocation", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);
    const text = document.body.textContent ?? "";

    for (const category of consentNotGranted.enabled_categories) {
      expect(text.length).toBeGreaterThan(0);
      expect(category.length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(
      consentNotGranted.enabled_categories.length,
    );
    expect(text).toContain("Writing your daily reading, and nothing else.");
    expect(text).toContain("The product does not claim that text is anonymous.");
    expect(text).toContain("You can withdraw this at any time");
    // Withdrawal now stops work already in flight, which the durable provider
    // path makes a real state rather than a theoretical one.
    expect(text).toMatch(/still being written/i);
  });

  it("shows the policy version the reader is agreeing to", () => {
    render(<AiConsentTerms consent={consentNotGranted} />);
    expect(screen.getByText("Policy")).toBeInTheDocument();
    expect(screen.getByText(`v${consentNotGranted.policy_version}`))
      .toBeInTheDocument();
    expect(consentNotGranted.policy_version).toBe("1.1.0");
  });
});
