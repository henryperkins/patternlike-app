import { describe, expect, it } from "vitest";
import { resolveTimeTravelConfiguration } from "./time-travel-config.js";

describe("Time Travel configuration", () => {
  it("accepts a positive receipt epoch and the pinned launch budget", () => {
    expect(resolveTimeTravelConfiguration({
      TIME_TRAVEL_RECEIPT_EPOCH: "3",
      TIME_TRAVEL_DAILY_SCAN_LIMIT: "32",
    })).toEqual({ ok: true, receiptEpoch: 3, dailyScanLimit: 32 });
  });

  it.each([
    [undefined, "32"],
    ["0", "32"],
    ["1.5", "32"],
    ["1", undefined],
    ["1", "31"],
    ["1", "33"],
  ])("fails closed for epoch=%s and limit=%s", (epoch, limit) => {
    expect(resolveTimeTravelConfiguration({
      TIME_TRAVEL_RECEIPT_EPOCH: epoch,
      TIME_TRAVEL_DAILY_SCAN_LIMIT: limit,
    }).ok).toBe(false);
  });
});
