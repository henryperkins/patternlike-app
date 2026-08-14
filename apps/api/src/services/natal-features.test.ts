import { describe, expect, it } from "vitest";
import {
  NATAL_FEATURE_POLICY_ID,
  NATAL_FEATURE_POLICY_VERSION,
  deriveNatalFeatureSet,
} from "./natal-features.js";
import { matchPatternObject } from "./pattern-matcher.js";
import { readPatternObjects } from "./pattern-content.js";

const fingerprint = `sha256:${"4a".repeat(32)}`;

function snapshot() {
  return {
    positions: [
      { body: "sun", longitude_deg: 15, sign: "aries", house: 10 },
      { body: "moon", longitude_deg: 103, sign: "cancer", house: 1 },
    ],
    aspects: [
      {
        body_a: "sun",
        body_b: "moon",
        aspect: "square",
        orb_deg: 1.25,
      },
    ],
    patterns: [{ pattern: "t_square", member_bodies: ["sun", "moon", "saturn"] }],
    houses: { cusps_deg: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] },
    angles: { ascendant_deg: 103, midheaven_deg: 15 },
  };
}

describe("deriveNatalFeatureSet", () => {
  it("is deterministic across source ordering and canonicalizes symmetric facts", async () => {
    const first = await deriveNatalFeatureSet({
      chartId: "cht_alpha",
      userId: "usr_alpha",
      chartFingerprint: fingerprint,
      effectiveAccuracy: "exact",
      snapshot: snapshot(),
      uncertainty: { accuracy: "exact", suppressed_features: [] },
    });
    const reordered = snapshot();
    reordered.positions.reverse();
    reordered.aspects[0] = {
      ...reordered.aspects[0],
      body_a: "moon",
      body_b: "sun",
    };
    reordered.patterns[0]!.member_bodies.reverse();
    const second = await deriveNatalFeatureSet({
      chartId: "cht_alpha",
      userId: "usr_alpha",
      chartFingerprint: fingerprint,
      effectiveAccuracy: "exact",
      snapshot: reordered,
      uncertainty: { suppressed_features: [], accuracy: "exact" },
    });

    expect(second.featureSetHash).toBe(first.featureSetHash);
    expect(second.featureSetId).toBe(first.featureSetId);
    expect(second.features).toEqual(first.features);
    expect(first.features.every((feature) => feature.policy_id === NATAL_FEATURE_POLICY_ID))
      .toBe(true);
    expect(first.features.every((feature) => feature.policy_version === NATAL_FEATURE_POLICY_VERSION))
      .toBe(true);
    // Canonical order is LAUNCH_BODIES rank, not alphabetical: the frozen M4
    // contract's rejection fixture is exactly `{body_a: "moon", body_b: "sun"}`,
    // so a derivation that sorted alphabetically would write the shape the
    // contract calls invalid.
    expect(first.features.find((feature) => feature.feature_class === "aspect"))
      .toMatchObject({ body_a: "sun", body_b: "moon", orb: 1.25 });
  });

  it("omits houses and angles when the effective chart says they are suppressed", async () => {
    const result = await deriveNatalFeatureSet({
      chartId: "cht_alpha",
      userId: "usr_alpha",
      chartFingerprint: fingerprint,
      effectiveAccuracy: "unknown",
      snapshot: snapshot(),
      uncertainty: {
        accuracy: "unknown",
        suppressed_features: [
          { feature_class: "houses", reason: "unknown_birth_time" },
          { feature_class: "angles", reason: "unknown_birth_time" },
        ],
      },
    });

    expect(result.features.some((feature) => feature.feature_class === "angle")).toBe(false);
    expect(result.features.some((feature) => feature.feature_class === "house_cusp")).toBe(false);
    expect(result.features.filter((feature) => feature.feature_class === "position"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ body: "sun", house: null }),
        expect.objectContaining({ body: "moon", house: null }),
      ]));
    expect(result.features.find((feature) => feature.feature_class === "uncertainty"))
      .toMatchObject({ accuracy: "unknown", suppressed_features: ["angles", "houses"] });
  });
});

describe("matchPatternObject", () => {
  it("implements all/any/none and returns only positive matched feature IDs", async () => {
    const set = await deriveNatalFeatureSet({
      chartId: "cht_alpha",
      userId: "usr_alpha",
      chartFingerprint: fingerprint,
      effectiveAccuracy: "exact",
      snapshot: snapshot(),
      uncertainty: { accuracy: "exact", suppressed_features: [] },
    });
    const result = matchPatternObject(
      {
        id: "pattern.sun-moon",
        content_type: "pattern",
        content_version: "1.0.0",
        object_hash: `sha256:${"5b".repeat(32)}`,
        locale: "en-US",
        status: "approved",
        display_priority: 10,
        title: "A steady center",
        summary: "Summary",
        body: "Body",
        resources: ["Resource"],
        tensions: ["Tension"],
        counter_expression: "Counter-expression",
        prohibited_claims: [],
        tags: [],
        minimum_accuracy: "unknown",
        requires_houses: false,
        required_bodies: ["sun", "moon"],
        required_aspects: ["square"],
        match: {
          all_of: [{ type: "aspect", body_a: "sun", body_b: "moon", aspect: "square", max_orb: 2 }],
          any_of: [
            { type: "position", body: "sun", sign: 1 },
            { type: "position", body: "sun", sign: 2 },
          ],
          none_of: [{ type: "position", body: "moon", sign: 12 }],
        },
      },
      set.features,
      "exact",
    );

    expect(result.eligible).toBe(true);
    expect(result.omission).toBe(null);
    expect(result.evidence.map((feature) => feature.feature_id)).toEqual(
      [...result.evidence.map((feature) => feature.feature_id)].sort(),
    );
    expect(result.evidence).toHaveLength(2);
  });

  it("never matches deprecated content or a negative-predicate hit", async () => {
    const set = await deriveNatalFeatureSet({
      chartId: "cht_alpha",
      userId: "usr_alpha",
      chartFingerprint: fingerprint,
      effectiveAccuracy: "exact",
      snapshot: snapshot(),
      uncertainty: { accuracy: "exact", suppressed_features: [] },
    });
    const base = {
      id: "pattern.blocked",
      content_type: "pattern" as const,
      content_version: "1.0.0",
      object_hash: `sha256:${"6c".repeat(32)}`,
      locale: "en-US",
      status: "approved" as const,
      display_priority: 1,
      title: "Blocked",
      summary: "Summary",
      body: "Body",
      resources: [],
      tensions: ["Tension"],
      counter_expression: "Counter-expression",
      prohibited_claims: [],
      tags: [],
      minimum_accuracy: "unknown" as const,
      requires_houses: false,
      required_bodies: [],
      required_aspects: [],
      match: {
        all_of: [{ type: "position" as const, body: "sun" as const, sign: 1 }],
        any_of: [],
        none_of: [{ type: "position" as const, body: "moon" as const, sign: 4 }],
      },
    };

    expect(matchPatternObject(base, set.features, "exact")).toMatchObject({
      eligible: false,
      omission: "predicate_mismatch",
    });
    expect(matchPatternObject({ ...base, status: "deprecated" }, set.features, "exact"))
      .toMatchObject({ eligible: false, omission: "deprecated" });
  });
});

describe("release-object narrowing", () => {
  const base = {
    id: "pattern.ordering",
    content_type: "pattern",
    content_version: "1.0.0",
    object_hash: `sha256:${"0".repeat(64)}`,
    locale: "en-US",
    status: "approved",
    display_priority: 1,
    title: "t",
    summary: "s",
    body: "b",
    resources: [],
    tensions: ["one"],
    counter_expression: "c",
    prohibited_claims: ["none"],
    tags: [],
    minimum_accuracy: "unknown",
    requires_houses: false,
    required_bodies: [],
    required_aspects: [],
  };

  it("accepts the contract's canonical aspect order and refuses the reverse", () => {
    const canonical = {
      ...base,
      match: {
        all_of: [{ type: "aspect", body_a: "sun", body_b: "moon", aspect: "trine" }],
        any_of: [],
        none_of: [],
      },
    };
    expect(readPatternObjects([canonical])).toHaveLength(1);

    // The alphabetical form. It is the frozen contract's own rejection fixture,
    // so accepting it here would mean shipping an object the contract refuses.
    const reversed = {
      ...base,
      match: {
        all_of: [{ type: "aspect", body_a: "moon", body_b: "sun", aspect: "trine" }],
        any_of: [],
        none_of: [],
      },
    };
    expect(readPatternObjects([reversed])).toBeNull();
  });

  it("refuses a match with no positive predicate and an object with an unknown field", () => {
    expect(readPatternObjects([{
      ...base,
      match: { all_of: [], any_of: [], none_of: [{ type: "position", body: "sun", sign: 1 }] },
    }])).toBeNull();
    expect(readPatternObjects([{ ...base, match: { all_of: [], any_of: [], none_of: [] } }])).toBeNull();
    expect(readPatternObjects("not an array")).toBeNull();
  });
});
