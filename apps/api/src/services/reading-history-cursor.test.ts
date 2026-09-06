import { describe, expect, it } from "vitest";
import {
  encodeReadingHistoryCursor,
  parseReadingHistoryCursor,
} from "./reading-history-cursor.js";

describe("reading history cursors", () => {
  const HISTORY_ID = "rdg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const SAVED_ID = "rdg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("round-trips the canonical history and Saved cursor shapes", () => {
    const history = {
      v: 1 as const,
      view: "history" as const,
      local_date: "2026-08-09",
      reading_id: HISTORY_ID,
    };
    const saved = {
      v: 1 as const,
      view: "saved" as const,
      saved_at: "2026-08-10T00:00:00.000Z",
      reading_id: SAVED_ID,
    };

    expect(parseReadingHistoryCursor(encodeReadingHistoryCursor(history), "history"))
      .toEqual(history);
    expect(parseReadingHistoryCursor(encodeReadingHistoryCursor(saved), "saved"))
      .toEqual(saved);
  });

  it("rejects a cursor issued for the other view", () => {
    const encoded = encodeReadingHistoryCursor({
      v: 1,
      view: "history",
      local_date: "2026-08-09",
      reading_id: HISTORY_ID,
    });

    expect(parseReadingHistoryCursor(encoded, "saved")).toBeNull();
  });

  it("encodes equivalent objects identically regardless of construction order", () => {
    const expected = "eyJsb2NhbF9kYXRlIjoiMjAyNi0wOC0yNCIsInJlYWRpbmdfaWQiOiJyZGdfYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEiLCJ2IjoxLCJ2aWV3IjoiaGlzdG9yeSJ9";
    const normal = {
      v: 1 as const,
      view: "history" as const,
      local_date: "2026-08-24",
      reading_id: HISTORY_ID,
    };
    const alternate = {
      reading_id: HISTORY_ID,
      local_date: "2026-08-24",
      view: "history" as const,
      v: 1 as const,
    };

    expect(encodeReadingHistoryCursor(normal)).toBe(expected);
    expect(encodeReadingHistoryCursor(alternate)).toBe(expected);
    expect(parseReadingHistoryCursor(expected, "history")).toEqual(normal);
  });

  it("accepts historic opaque reading ids from the frozen reading contracts", () => {
    const cursor = {
      v: 1 as const,
      view: "history" as const,
      local_date: "2026-08-24",
      reading_id: "rdg_01JAMPLEREADING00001",
    };

    expect(parseReadingHistoryCursor(encodeReadingHistoryCursor(cursor), "history"))
      .toEqual(cursor);
  });

  it.each([
    "not-base64url!",
    Buffer.from("not json").toString("base64url"),
    Buffer.from(JSON.stringify({
      reading_id: HISTORY_ID,
      local_date: "2026-08-09",
      view: "history",
      v: 1,
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      v: 1,
      view: "history",
      local_date: "2026-08-09",
      reading_id: HISTORY_ID,
      extra: true,
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      v: 1,
      view: "history",
      local_date: "09-08-2026",
      reading_id: HISTORY_ID,
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      local_date: "2026-08-09",
      reading_id: "bad id",
      v: 1,
      view: "history",
    })).toString("base64url"),
    "a".repeat(2049),
  ])("rejects malformed, non-canonical, and oversized input", (encoded) => {
    expect(parseReadingHistoryCursor(encoded, "history")).toBeNull();
  });
});
