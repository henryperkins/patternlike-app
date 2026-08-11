import { describe, expect, it } from "vitest";
import {
  LEASE_RETRY_DELAY_SECONDS,
  RETRY_DELAY_SECONDS,
  isAutomaticReplacementFailure,
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
  ] as const)("gives %s %s at attempt %i a %s queue disposition", (version, code, attempts, expected) => {
    expect(queueDisposition(version, code, attempts)).toBe(expected);
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
  ] as const)("allows automatic replacement for %s %s only when approved", (version, code, expected) => {
    expect(isAutomaticReplacementFailure(version, code)).toBe(expected);
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
    expect(leaseDisposition(4, 0, 90_000)).toBe("terminal_calc_unavailable");
  });
});
