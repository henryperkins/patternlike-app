import { describe, expect, it } from "vitest";
import { isIsoDate, shiftIsoDate } from "./travel-format.js";

describe("Time Travel date arithmetic", () => {
  it("steps a real civil date by whole UTC days", () => {
    expect(shiftIsoDate("2026-08-10", -1)).toBe("2026-08-09");
    expect(shiftIsoDate("2026-08-10", 1)).toBe("2026-08-11");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("leaves impossible calendar strings unchanged", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(shiftIsoDate("2026-02-30", 1)).toBe("2026-02-30");
    expect(shiftIsoDate("2026-13-01", -1)).toBe("2026-13-01");
    expect(shiftIsoDate("not-a-date", 1)).toBe("not-a-date");
  });
});
