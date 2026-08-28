import { describe, expect, it } from "vitest";

import {
  accountProcessingGranted,
  accountProcessingNotGranted,
  accountProcessingRevokedFreeze,
  accountProcessingUnexplainedFreeze,
} from "../test/account-processing-fixture.js";
import { isAccountProcessingConsentResponse } from "./account-processing-consent.js";

describe("account-processing response guard", () => {
  it.each([
    accountProcessingGranted,
    accountProcessingNotGranted,
    accountProcessingRevokedFreeze,
    accountProcessingUnexplainedFreeze,
  ])("accepts each complete current-state variant", (response) => {
    expect(isAccountProcessingConsentResponse(response)).toBe(true);
  });

  it.each([
    { ...accountProcessingGranted, source_id: "USR-01" },
    {
      ...accountProcessingGranted,
      allowed_uses: ["cycle_detection", "chart_fact", "uncertainty_model"],
    },
    { ...accountProcessingGranted, consent_id: null },
    { ...accountProcessingNotGranted, consent_id: "cns_impossible" },
    { ...accountProcessingNotGranted, disclosure: null },
    { ...accountProcessingNotGranted, policy_version: "future-policy" },
    { ...accountProcessingNotGranted, unexpected: true },
    {
      ...accountProcessingGranted,
      granted_at: "August 28, 2026",
    },
    {
      ...accountProcessingGranted,
      regrant_will_restore_access: true,
    },
  ])("rejects a malformed or internally inconsistent success body", (response) => {
    expect(isAccountProcessingConsentResponse(response)).toBe(false);
  });
});
