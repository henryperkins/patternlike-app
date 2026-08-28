import { describe, it, expect } from "vitest";
import { validateBirthProfileRequest } from "./birth.js";

describe("birth profile request validation", () => {
  const base = {
    accuracy: "exact" as const,
    consent_id: "cns_0000000000000001",
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    birthplace: { latitude: 34.0522, longitude: -118.2437, label: "Los Angeles" },
  };

  it("accepts a complete exact profile", () => {
    expect(validateBirthProfileRequest(base)).toBeNull();
  });

  it("requires birth_time_local when accuracy is exact", () => {
    const err = validateBirthProfileRequest({ ...base, birth_time_local: undefined });
    expect(err?.code).toBe("invalid_body");
    expect(err?.message).toMatch(/birth_time_local/);
  });

  it("requires birth_time_local when accuracy is approximate", () => {
    const err = validateBirthProfileRequest({
      ...base,
      accuracy: "approximate",
      birth_time_local: null,
    });
    expect(err?.code).toBe("invalid_body");
  });

  it("allows a missing birth_time_local when accuracy is unknown", () => {
    expect(
      validateBirthProfileRequest({
        ...base,
        accuracy: "unknown",
        birth_time_local: null,
      }),
    ).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    for (const birthplace of [
      { latitude: 999, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: -91, longitude: 0 },
    ]) {
      expect(validateBirthProfileRequest({ ...base, birthplace })?.code).toBe(
        "invalid_body",
      );
    }
  });

  it("rejects coordinates supplied as strings", () => {
    const err = validateBirthProfileRequest({
      ...base,
      birthplace: { latitude: "34.05" as unknown as number, longitude: -118.24 },
    });
    expect(err?.code).toBe("invalid_body");
  });

  it("rejects a half-specified birthplace", () => {
    expect(
      validateBirthProfileRequest({ ...base, birthplace: { latitude: 34.05 } })?.code,
    ).toBe("invalid_body");
  });

  it("rejects a birth_date that is not YYYY-MM-DD", () => {
    expect(validateBirthProfileRequest({ ...base, birth_date: "1990-5-15" })?.code).toBe(
      "invalid_body",
    );
  });

  it("requires accuracy and consent_id", () => {
    expect(validateBirthProfileRequest({ ...base, consent_id: undefined })?.code).toBe(
      "invalid_body",
    );
    expect(
      validateBirthProfileRequest({ ...base, accuracy: undefined as never })?.code,
    ).toBe("invalid_body");
  });

  it("rejects a non-string consent_id before binding it to D1", () => {
    expect(
      validateBirthProfileRequest({
        ...base,
        consent_id: { malformed: true } as unknown as string,
      })?.code,
    ).toBe("invalid_body");
  });

  it("rejects an unrecognised accuracy value", () => {
    expect(
      validateBirthProfileRequest({ ...base, accuracy: "precise" as never })?.code,
    ).toBe("invalid_body");
  });

  it("rejects an implausible approximate window", () => {
    for (const approximate_window_minutes of [0, -30, 1441, 12.5]) {
      expect(
        validateBirthProfileRequest({
          ...base,
          accuracy: "approximate",
          approximate_window_minutes,
        })?.code,
      ).toBe("invalid_body");
    }
  });
});
