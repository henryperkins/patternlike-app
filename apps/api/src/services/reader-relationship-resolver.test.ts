import { describe, expect, it } from "vitest";
import type { AuthorizedReaderUnit, CalculatedFeature, ReaderDailyTarget, ReaderPatternTarget, ReaderTimingTarget } from "@patternlike/shared";
import { resolveReaderRelationships } from "./reader-relationship-resolver.js";

function fixture() {
  const source: ReaderDailyTarget = { kind: "daily", reading_id: "rd_current", revision: 2, content_hash: `sha256:${"a".repeat(64)}`, paragraph_id: "paragraph_actual" };
  const pattern: ReaderPatternTarget = { kind: "pattern", pattern_id: "pat_current", document_revision: "0.7.0:pat_current:2026-09-01T00:00:00Z", content_hash: `sha256:${"b".repeat(64)}`, chapter_index: 2, chapter_source_sha256: "c".repeat(64) };
  const timing: ReaderTimingTarget = { kind: "timing", cycle_id: "cycle_retained", cycle_hash: "d".repeat(64), pass_index: 2, starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-08T00:00:00Z", exact_at: "2026-09-03T11:00:00Z", local_date: "2026-09-03", time_zone: "America/New_York", policy_version: "cycle-policy/v1" };
  const saved: ReaderDailyTarget = { ...source, reading_id: "rd_saved", paragraph_id: "saved_actual" };
  const feature: CalculatedFeature = { chart: "private-chart-fingerprint", policy: "reader-coordinate/v1", kind: "natal_position", frame: "tropical_geocentric", participants: [{ body: "sun", role: "natal_subject" }], coordinate: "private-exact-longitude", uncertainty_policy: "exact", requires_birth_time: false };
  const participant = { chart: feature.chart, body: "sun", frame: feature.frame, policy: feature.policy, role: "natal_interpretation" as const, requires_birth_time: false };
  const units: AuthorizedReaderUnit[] = [
    { target: source, eligible: true, birth_time: "exact", features: [feature], participants: [participant] },
    { target: pattern, eligible: true, birth_time: "exact", features: [structuredClone(feature)], participants: [participant] },
    { target: timing, eligible: true, birth_time: "exact", features: [], participants: [{ ...participant, role: "transit_target" }], occurrence: { chart: feature.chart, exact_at: timing.exact_at } },
    { target: saved, eligible: true, birth_time: "exact", features: [], participants: [], day: { chart: feature.chart, local_date: timing.local_date, time_zone: timing.time_zone, starts_at: "2026-09-03T04:00:00Z", ends_at: "2026-09-04T04:00:00Z" } },
  ];
  return { source, pattern, timing, saved, feature, units };
}

describe("authorized reader relationship resolver", () => {
  it("resolves the complete journey and direct timing branch without exposing private evidence coordinates", async () => {
    const data = fixture();
    const graph = await resolveReaderRelationships(data.source, data.units);
    expect(graph.items.map((edge) => [edge.from.kind, edge.to.kind, edge.reason_code])).toEqual([
      ["daily", "pattern", "shared_calculated_feature"], ["daily", "timing", "shared_natal_participant"],
      ["pattern", "timing", "shared_natal_participant"], ["timing", "daily", "dated_occurrence"],
    ]);
    expect(JSON.stringify(graph)).not.toContain("private-");
    expect(graph.items.every((edge) => /^sha256:[a-f0-9]{64}$/.test(edge.evidence_identity))).toBe(true);
  });

  it.each(["revision", "content_hash", "paragraph_id"] as const)("does not substitute a different source %s", async (key) => {
    const data = fixture();
    const requested = { ...data.source, [key]: key === "revision" ? 1 : "other" };
    expect((await resolveReaderRelationships(requested, data.units)).status).toBe("unavailable");
  });

  it.each(["chart", "policy", "frame", "coordinate", "uncertainty_policy", "role"])("rejects mismatched %s even if labels agree", async (field) => {
    const data = fixture();
    const feature = data.units[1]!.features[0]!;
    if (field === "role") feature.participants[0]!.role = "natal_object";
    else Object.assign(feature, { [field]: `other-${field}` });
    expect((await resolveReaderRelationships(data.source, data.units)).items.some((edge) => edge.to.kind === "pattern")).toBe(false);
  });

  it("suppresses unsupported time-sensitive features and ineligible targets", async () => {
    const data = fixture();
    for (const unit of data.units) {
      unit.birth_time = "unknown";
      for (const feature of unit.features) feature.requires_birth_time = true;
      for (const participant of unit.participants) participant.requires_birth_time = true;
    }
    expect((await resolveReaderRelationships(data.source, data.units)).status).toBe("no_supported_connection");
    data.units[0]!.eligible = false;
    expect((await resolveReaderRelationships(data.source, data.units)).status).toBe("unavailable");
  });

  it("binds a shared transit fact to the retained full cycle hash and policy", async () => {
    const data = fixture();
    const transit: CalculatedFeature = { ...data.feature, kind: "transit_aspect", participants: [
      { body: "saturn", role: "transiting" }, { body: "sun", role: "natal_target" },
    ], coordinate: data.timing.exact_at };
    data.units[0]!.features = [transit];
    data.units[0]!.participants = [];
    data.units[0]!.cycle_refs = [structuredClone(data.timing)];
    data.units[2]!.features = [structuredClone(transit)];
    expect((await resolveReaderRelationships(data.source, data.units)).items[0]?.reason_code).toBe("shared_calculated_feature");
    data.timing.cycle_hash = "0".repeat(64);
    expect((await resolveReaderRelationships(data.source, data.units)).status).toBe("no_supported_connection");
    data.units[0]!.cycle_refs = [];
    expect((await resolveReaderRelationships(data.source, data.units)).status).toBe("no_supported_connection");
  });

  it("accepts an inclusive stored cycle boundary but excludes the next local day", async () => {
    const data = fixture();
    data.timing.ends_at = data.timing.exact_at;
    let graph = await resolveReaderRelationships(data.source, data.units);
    expect(graph.items.some((edge) => edge.reason_code === "dated_occurrence")).toBe(true);
    data.units[3]!.day!.ends_at = data.timing.exact_at;
    graph = await resolveReaderRelationships(data.source, data.units);
    expect(graph.items.some((edge) => edge.reason_code === "dated_occurrence")).toBe(false);
  });

  it("collapses repeated identical units and rejects contradictory support for one coordinate", async () => {
    const data = fixture();
    const graph = await resolveReaderRelationships(data.source, data.units);
    data.units.push(structuredClone(data.units[1]!));
    expect(await resolveReaderRelationships(data.source, data.units)).toEqual(graph);
    data.units.at(-1)!.features = [];
    expect((await resolveReaderRelationships(data.source, data.units)).items.some((edge) => edge.to.kind === "pattern")).toBe(false);
  });

  it("chooses stable support and enforces the existing graph bounds", async () => {
    const data = fixture();
    for (const unit of data.units.slice(0, 2)) unit.features.push({ ...data.feature, coordinate: "another-private-coordinate" });
    const graph = await resolveReaderRelationships(data.source, data.units);
    const reversed = structuredClone(data.units).reverse();
    for (const unit of reversed) unit.features.reverse();
    expect(await resolveReaderRelationships(data.source, reversed)).toEqual(graph);
    for (let index = 0; index < 8; index++) data.units.push({ ...structuredClone(data.units[1]!), target: { ...data.pattern, pattern_id: `pat_extra_${index}` } });
    const bounded = await resolveReaderRelationships(data.source, data.units);
    expect(bounded.truncated).toBe(true);
    expect(bounded.items.filter((edge) => edge.from.kind === "daily")).toHaveLength(4);
    expect(bounded.items.length).toBeLessThanOrEqual(12);
  });
});
