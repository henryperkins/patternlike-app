import { describe, expect, it } from "vitest";

import { checkSecureConfig } from "./config-guard.js";

const configuredProduction = {
  ENVIRONMENT: "production",
  AUTH_STUB: "0",
  ROOT_KEK: "a-real-root-kek-with-enough-entropy-32+",
  OIDC_ISSUER: "https://issuer.example.com",
  OIDC_AUDIENCE: "patternlike-web",
  OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  TIME_TRAVEL_RECEIPT_EPOCH: "1",
  TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
};

describe("birth operational configuration guard", () => {
  it("allows development to omit both values", () => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
      }),
    ).toBeNull();
  });

  it("allows development to set one valid value and default the other", () => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
        CALC_FETCH_TIMEOUT_MS: "12000",
      }),
    ).toBeNull();
  });

  it.each([
    { CALC_FETCH_TIMEOUT_MS: "0" },
    { BIRTH_CALC_DAILY_LIMIT: "5.5" },
  ])("rejects malformed present values before the development short-circuit: %j", (values) => {
    expect(
      checkSecureConfig({
        ENVIRONMENT: "development",
        AUTH_STUB: "1",
        ...values,
      })?.code,
    ).toBe("birth_operational_config_invalid");
  });

  it.each([
    {},
    { CALC_FETCH_TIMEOUT_MS: "10000" },
    { BIRTH_CALC_DAILY_LIMIT: "5" },
  ])("requires both values outside development: %j", (values) => {
    expect(
      checkSecureConfig({
        ...configuredProduction,
        ...values,
      })?.code,
    ).toBe("birth_operational_config_invalid");
  });

  it("accepts both bounded values in production", () => {
    expect(
      checkSecureConfig({
        ...configuredProduction,
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
      }),
    ).toBeNull();
  });
});
