import { describe, expect, it } from "vitest";
import {
  LEASE_RETRY_DELAY_SECONDS,
  MAX_COMMAND_GENERATION,
  MAX_JOB_ATTEMPTS,
  RETRY_DELAY_SECONDS,
  V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES,
  isAutomaticReplacementFailure,
  isGenerationFailureCode,
  isGenerationReplacementReason,
  isV1ReplacementReason,
  isV5ReplacementReason,
  leaseDisposition,
  queueDisposition,
} from "./generation-failures.js";

describe("generation failure policy", () => {
  it.each([
    ["v1", "calc_unavailable", 1, "retry_60s"],
    ["v1", "calc_unavailable", 3, "retry_60s"],
    ["v1", "calc_unavailable", 4, "terminal"],
    ["v1", "release_unreadable", 1, "retry_60s"],
    ["v1", "release_unreadable", 4, "terminal"],
    ["v2", "calc_unavailable", 1, "retry_60s"],
    ["v2", "daily_sky_unavailable", 3, "retry_60s"],
    ["v2", "publisher_unavailable", 4, "terminal"],
    ["v2", "publisher_output_invalid", 1, "retry_60s"],
    ["v2", "publisher_output_invalid", 2, "terminal"],
    ["v2", "publisher_refused", 1, "retry_60s"],
    ["v2", "publisher_refused", 2, "terminal"],
    ["v2", "publisher_budget_exhausted", 1, "terminal"],
    ["v2", "publisher_not_configured", 1, "terminal"],
    ["v2", "publisher_auth_failed", 1, "terminal"],
    ["v2", "publisher_model_unavailable", 1, "terminal"],
    ["v2", "ai_synthesis_consent_required", 1, "terminal"],
    ["v2", "context_ineligible", 1, "terminal"],
    ["v2", "generation_input_id_mismatch", 1, "terminal"],
    ["v2", "policy_unsupported", 1, "terminal"],
    ["v2", "release_unreadable", 1, "terminal"],
    // Never retried, at any attempt. Nothing about waiting makes a command
    // pinned to a transport this deployment no longer routes to executable.
    ["v2", "publisher_superseded", 1, "terminal"],
    ["v2", "publisher_superseded", 2, "terminal"],
    ["v2", "publisher_superseded", 3, "terminal"],
    ["v2", "publisher_superseded", 4, "terminal"],
  ] as const)("gives %s %s at attempt %i a %s queue disposition", (version, code, attempts, expected) => {
    expect(queueDisposition(version, code, attempts)).toBe(expected);
  });

  it("keeps the four-attempt provider policy intact around the new code", () => {
    // The whole retry matrix, stated once so a widened vocabulary cannot
    // quietly move a boundary: unavailable gets all four actual attempts,
    // invalid and refused get exactly one fresh one, and everything terminal
    // stays terminal.
    for (const attempts of [1, 2, 3]) {
      expect(queueDisposition("v2", "publisher_unavailable", attempts))
        .toBe("retry_60s");
    }
    expect(queueDisposition("v2", "publisher_unavailable", MAX_JOB_ATTEMPTS))
      .toBe("terminal");
    for (const code of ["publisher_output_invalid", "publisher_refused"] as const) {
      expect(queueDisposition("v2", code, 1)).toBe("retry_60s");
      expect(queueDisposition("v2", code, 2)).toBe("terminal");
    }
    for (
      const code of [
        "publisher_auth_failed",
        "publisher_model_unavailable",
        "publisher_budget_exhausted",
      ] as const
    ) {
      expect(queueDisposition("v2", code, 1)).toBe("terminal");
    }
  });

  it.each([
    ["v1", "calc_unavailable", true],
    ["v1", "release_unreadable", true],
    ["v1", "daily_sky_unavailable", false],
    ["v2", "calc_unavailable", true],
    ["v2", "daily_sky_unavailable", true],
    ["v2", "publisher_unavailable", true],
    ["v2", "publisher_output_invalid", true],
    ["v2", "publisher_refused", true],
    ["v2", "release_unreadable", false],
    ["v2", "publisher_budget_exhausted", false],
    ["v2", "publisher_not_configured", false],
    ["v2", "publisher_auth_failed", false],
    ["v2", "publisher_model_unavailable", false],
    ["v2", "ai_synthesis_consent_required", false],
    ["v2", "context_ineligible", false],
    ["v2", "generation_input_id_mismatch", false],
    ["v2", "policy_unsupported", false],
    // Replaceable by the scheduler, which is a different question from
    // retryable: the day still deserves a reading, frozen under a command this
    // deployment can actually execute.
    ["v2", "publisher_superseded", true],
  ] as const)("allows automatic replacement for %s %s only when approved", (version, code, expected) => {
    expect(isAutomaticReplacementFailure(version, code)).toBe(expected);
  });

  it("admits the superseded code to every closed vocabulary that must carry it", () => {
    expect(isGenerationFailureCode("publisher_superseded")).toBe(true);
    expect(isV5ReplacementReason("publisher_superseded")).toBe(true);
    expect(isGenerationReplacementReason("publisher_superseded")).toBe(true);
    // A V1 command has no publisher pin, so the reason means nothing there.
    expect(isV1ReplacementReason("publisher_superseded")).toBe(false);
    expect(isAutomaticReplacementFailure("v1", "publisher_superseded")).toBe(false);
    expect(
      (V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES as readonly string[]),
    ).toContain("publisher_superseded");
  });

  it.each([
    [1, 150_000, 90_000, "continue"],
    [1, 149_999, 90_000, "lease_retry_305s"],
    [3, 0, 90_000, "lease_retry_305s"],
    [4, 0, 90_000, "terminal_calc_unavailable"],
  ] as const)("handles a lease with attempt %i as %s", (attempts, remainingMs, providerTimeoutMs, expected) => {
    expect(leaseDisposition(attempts, remainingMs, providerTimeoutMs)).toBe(expected);
  });

  it("keeps lease-window metrics distinct from the calc-unavailable terminal alias", () => {
    expect(RETRY_DELAY_SECONDS).toBe(60);
    expect(LEASE_RETRY_DELAY_SECONDS).toBe(305);
    expect(MAX_JOB_ATTEMPTS).toBe(4);
    expect(MAX_COMMAND_GENERATION).toBe(3);
    expect(leaseDisposition(4, 0, 90_000)).toBe("terminal_calc_unavailable");
  });
});
