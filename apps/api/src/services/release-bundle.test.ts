import { describe, expect, it } from "vitest";
import { draftBundle } from "../../test/content-release-fixtures.js";
import { toVerifiedBundle } from "./release-bundle.js";

describe("release bundle projection", () => {
  it("projects both supported release versions into the Today engine shape", () => {
    const m3 = draftBundle();
    const m4 = draftBundle((bundle) => {
      bundle.schema_version = "0.4.0";
    });

    expect(toVerifiedBundle(m3).release.version).toBe(m3.release.version);
    expect(toVerifiedBundle(m4).objects.daily_fallbacks).toHaveLength(
      m4.objects.daily_fallbacks.length,
    );
  });

  it("validates the version-selected schema before projecting stored bytes", () => {
    const malformed = draftBundle((bundle) => {
      bundle.schema_version = "0.4.0";
      delete (bundle.objects.daily_fallbacks[0] as Record<string, unknown>).body;
    });

    expect(() => toVerifiedBundle(malformed)).toThrow(/stored release bundle is invalid/);
  });
});
