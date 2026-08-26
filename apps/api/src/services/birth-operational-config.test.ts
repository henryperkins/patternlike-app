import { describe, expect, it } from "vitest";

import {
  DEFAULT_BIRTH_CALC_DAILY_LIMIT,
  DEFAULT_CALC_FETCH_TIMEOUT_MS,
  resolveBirthOperationalConfig,
} from "./birth-operational-config.js";

describe("birth operational configuration", () => {
  it.each(["development", "test"])(
    "uses bounded defaults when %s omits both values",
    (environment) => {
      expect(resolveBirthOperationalConfig({ ENVIRONMENT: environment })).toEqual({
        ok: true,
        value: {
          fetchTimeoutMs: DEFAULT_CALC_FETCH_TIMEOUT_MS,
          dailyLimit: DEFAULT_BIRTH_CALC_DAILY_LIMIT,
        },
      });
    },
  );

  it("accepts explicit production values", () => {
    expect(
      resolveBirthOperationalConfig({
        ENVIRONMENT: "production",
        CALC_FETCH_TIMEOUT_MS: "10000",
        BIRTH_CALC_DAILY_LIMIT: "5",
      }),
    ).toEqual({
      ok: true,
      value: { fetchTimeoutMs: 10_000, dailyLimit: 5 },
    });
  });

  it.each([
    {},
    { CALC_FETCH_TIMEOUT_MS: "10000" },
    { BIRTH_CALC_DAILY_LIMIT: "5" },
  ])("requires both values outside development: %j", (values) => {
    expect(
      resolveBirthOperationalConfig({
        ENVIRONMENT: "production",
        ...values,
      }),
    ).toEqual({ ok: false, code: "birth_operational_config_invalid" });
  });

  it.each([
    ["0", "5"],
    ["999", "5"],
    ["30001", "5"],
    ["10000.5", "5"],
    ["+10000", "5"],
    ["-10000", "5"],
    ["   ", "5"],
    ["10000", "0"],
    ["10000", "51"],
    ["10000", "5.5"],
    ["10000", "+5"],
    ["10000", "-5"],
    ["10000", "   "],
  ])(
    "rejects invalid integer or range values timeout=%s limit=%s",
    (fetchTimeout, dailyLimit) => {
      expect(
        resolveBirthOperationalConfig({
          ENVIRONMENT: "production",
          CALC_FETCH_TIMEOUT_MS: fetchTimeout,
          BIRTH_CALC_DAILY_LIMIT: dailyLimit,
        }),
      ).toEqual({ ok: false, code: "birth_operational_config_invalid" });
    },
  );

  it.each([
    ["1000", "1", 1_000, 1],
    ["30000", "50", 30_000, 50],
  ])(
    "accepts inclusive bounds timeout=%s limit=%s",
    (fetchTimeout, dailyLimit, expectedTimeout, expectedLimit) => {
      expect(
        resolveBirthOperationalConfig({
          ENVIRONMENT: "production",
          CALC_FETCH_TIMEOUT_MS: fetchTimeout,
          BIRTH_CALC_DAILY_LIMIT: dailyLimit,
        }),
      ).toEqual({
        ok: true,
        value: {
          fetchTimeoutMs: expectedTimeout,
          dailyLimit: expectedLimit,
        },
      });
    },
  );

  it("defaults only the omitted development value", () => {
    expect(
      resolveBirthOperationalConfig({
        ENVIRONMENT: "development",
        CALC_FETCH_TIMEOUT_MS: "12000",
      }),
    ).toEqual({
      ok: true,
      value: {
        fetchTimeoutMs: 12_000,
        dailyLimit: DEFAULT_BIRTH_CALC_DAILY_LIMIT,
      },
    });
  });

  it("rejects a malformed value in development instead of defaulting it", () => {
    expect(
      resolveBirthOperationalConfig({
        ENVIRONMENT: "development",
        CALC_FETCH_TIMEOUT_MS: "not-an-integer",
      }),
    ).toEqual({ ok: false, code: "birth_operational_config_invalid" });
  });
});
