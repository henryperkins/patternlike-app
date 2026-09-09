import { describe, expect, it } from "vitest";
import { createReaderJourneyFixture } from "../preview/reader-journey-fixture.js";
import { exactReaderUnit, readerTargetKey, resolveReaderRelationships } from "./reader-relationships.js";

describe("fictional reader relationship resolver", () => {
  it("connects the exact full journey and a direct timing branch with distinct reasons", async () => {
    const fixture = await createReaderJourneyFixture();
    const result = await resolveReaderRelationships(fixture.source, fixture.units);
    expect(result.status).toBe("available");
    expect(result.items.map((edge) => [edge.from.kind, edge.to.kind, edge.kind])).toEqual([
      ["daily", "pattern", "shared_calculated_feature"], ["daily", "timing", "shared_natal_participant"],
      ["pattern", "timing", "shared_natal_participant"], ["timing", "daily", "dated_occurrence"],
    ]);
    expect(result.items.every((edge) => /^reader-relationship:[a-f0-9]{64}$/.test(edge.id))).toBe(true);
    expect(result.items[0]!.to).toMatchObject({ chapter_index: 2 });
    expect(result.items[1]!.to).toMatchObject({ pass_index: 2 });
  });

  it.each(["missing_source", "replaced_source"] as const)("never resolves a %s edition against its successor", async (scenario) => {
    const fixture = await createReaderJourneyFixture(scenario);
    expect((await resolveReaderRelationships(fixture.source, fixture.units)).status).toBe("unavailable");
  });

  it.each(["missing_pattern", "replaced_pattern", "inaccessible_timing"] as const)("removes unavailable destinations in %s and never substitutes", async (scenario) => {
    const fixture = await createReaderJourneyFixture(scenario);
    const removed = fixture.documents[scenario === "inaccessible_timing" ? 2 : 1]!.target;
    expect(exactReaderUnit(removed, fixture.units)).toBeUndefined();
    expect((await resolveReaderRelationships(fixture.source, fixture.units)).items.some((edge) => readerTargetKey(edge.to) === readerTargetKey(removed))).toBe(false);
  });

  it.each(["unknown_time", "no_support"] as const)("does not invent evidence for %s", async (scenario) => {
    const fixture = await createReaderJourneyFixture(scenario);
    expect((await resolveReaderRelationships(fixture.source, fixture.units))).toMatchObject({ status: "no_supported_connection", items: [] });
  });

  it.each(["chart", "frame", "role", "feature_policy", "uncertainty", "unit", "hash"])("rejects a %s mismatch even when prose is identical", async (mismatch) => {
    const fixture = await createReaderJourneyFixture();
    const pattern = fixture.units[1]!;
    const feature = pattern.features[0]!;
    if (mismatch === "chart") feature.chart = "other_chart";
    if (mismatch === "frame") feature.frame = "sidereal_geocentric";
    if (mismatch === "role") feature.participants[0]!.role = "natal_object";
    if (mismatch === "feature_policy") feature.policy = "other-policy";
    if (mismatch === "uncertainty") feature.uncertainty_policy = "other-uncertainty";
    if (mismatch === "unit" && pattern.target.kind === "pattern") pattern.target = { ...pattern.target, chapter_index: 0 };
    if (mismatch === "hash" && pattern.target.kind === "pattern") pattern.target = { ...pattern.target, chapter_source_sha256: "0".repeat(64) };
    const result = await resolveReaderRelationships(fixture.source, fixture.units);
    if (mismatch === "unit" || mismatch === "hash") expect(exactReaderUnit(fixture.documents[1]!.target, fixture.units)).toBeUndefined();
    else expect(result.items.some((edge) => edge.to.kind === "pattern")).toBe(false);
  });

  it("requires natal and transit roles for the shared participant explanation", async () => {
    const fixture = await createReaderJourneyFixture();
    fixture.units[2]!.participants[0]!.role = "natal_interpretation";
    expect((await resolveReaderRelationships(fixture.source, fixture.units)).items.some((edge) => edge.kind === "shared_natal_participant")).toBe(false);
  });

  it.each(["zone", "interval", "occurrence", "pass"])("rejects inconsistent retained date evidence: %s", async (mismatch) => {
    const fixture = await createReaderJourneyFixture();
    const timing = fixture.units[2]!;
    if (mismatch === "zone") fixture.units[3]!.day!.time_zone = "Asia/Tokyo";
    if (mismatch === "interval") fixture.units[3]!.day!.starts_at = "2026-09-03T04:00:00Z";
    if (mismatch === "occurrence") timing.occurrence!.exact_at = "2026-09-03T11:35:00Z";
    if (mismatch === "pass" && timing.target.kind === "timing") timing.target = { ...timing.target, pass_index: 0 };
    expect((await resolveReaderRelationships(fixture.source, fixture.units)).items.some((edge) => edge.kind === "dated_occurrence")).toBe(false);
  });

  it("uses stable evidence identities and bounds outgoing links without modifying input", async () => {
    const fixture = await createReaderJourneyFixture();
    const pattern = fixture.units[1]!;
    for (let index = 0; index < 6; index += 1) {
      if (pattern.target.kind === "pattern") fixture.units.push({ ...structuredClone(pattern), target: { ...pattern.target, pattern_id: `fictional_extra_${index}` } });
    }
    const before = JSON.stringify(fixture);
    const result = await resolveReaderRelationships(fixture.source, fixture.units);
    const reordered = await resolveReaderRelationships(fixture.source, [...fixture.units].reverse());
    expect(result).toEqual(reordered);
    expect(result.truncated).toBe(true);
    expect(result.items.filter((edge) => readerTargetKey(edge.from) === readerTargetKey(fixture.source))).toHaveLength(4);
    expect(result.items.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
