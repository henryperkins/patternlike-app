import { describe, expect, it } from "vitest";
import { CALC_CONTRACT_ID, CALC_CONTRACT_VERSION, cycleHash, type NormalizedCycle, type PatternDocumentInternal } from "@patternlike/shared";
import type { ConstrainedFact, ConstrainedNatalFactInput } from "@patternlike/reading-engine";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { isReaderRelationshipSupport } from "../db/reader-relationship-supports.js";
import { loadOntologyRegressionCorpus } from "./ontology-regression.js";
import { deriveDailyReaderRelationshipSupport, derivePatternReaderRelationshipSupport, readerTimingUnits } from "./reader-relationship-support.js";

const HASH = `sha256:${"a".repeat(64)}`;
const DATE = "2026-09-09T12:00:00.000Z";
const natal = (value: ConstrainedNatalFactInput): ConstrainedFact => ({
  fact_id: value.fact_id, fact_class: value.fact_class, scope: "personalized", lane_rank: 3,
  label: "This label is not relationship evidence", attributes: { bodies: ["pluto"], signs: [], houses: [], degrees: [], timestamps: [], dates: [] },
  support: { kind: "natal", value }, origin: "natal", content_digest: null, category: "calculated_natal_facts",
});

function dailyInput(facts: ConstrainedFact[], references = facts.map((fact) => fact.fact_id)): Parameters<typeof deriveDailyReaderRelationshipSupport>[0] {
  return {
    reading: {
      schema_version: "0.5.0", output_schema: "daily-reading-v5", reading_id: "rdg_relationship_fixture",
      local_date: "2026-09-09", generated_at: DATE, assembly_mode: "constrained_model", revision: 2,
      locale: "en-US", domain_preference: null, headline: "A fixture", disclosure: "A fixture",
      paragraphs: [{ paragraph_id: "par_accepted", role: "primary_theme", order: 1, text: "A fixture passage." }],
    },
    contentHash: HASH,
    paragraphEvidence: [{ paragraph_id: "par_accepted", role: "primary_theme", order: 1,
      fact_refs: references.map((id) => ({ fact_id: id, fact_class: facts.find((fact) => fact.fact_id === id)?.fact_class ?? "natal_position",
        scope: "personalized", label: "Not a join key" })), context_refs: [] }],
    selectedFacts: facts, chartFingerprint: "fixture-chart", contractId: CALC_CONTRACT_ID, contractVersion: CALC_CONTRACT_VERSION,
    effectiveAccuracy: "exact", suppressedFeatures: [], timeZone: "UTC", dayStartAt: "2026-09-09T00:00:00.000Z",
    dayEndAt: "2026-09-10T00:00:00.000Z", cyclePolicyVersion: "1.0.0",
  };
}

async function patternInput() {
  const chain = structuredClone(loadOntologyRegressionCorpus().fixtures[0]!.chain);
  const document: PatternDocumentInternal = {
    schema_version: "0.7.0", pattern_id: "pat_relationship_fixture", generation_id: "pgen_relationship_fixture",
    locale: "en-US", effective_accuracy: "exact", plan_hash: HASH, candidate_hash: HASH, semantic_verdict_hash: HASH,
    artifact: chain.writer, compact_provenance: { assembly_mode: "constrained_model", provider: "fixture", model_family: "fixture",
      raw_birth_details_sent: false, ontology_version: "fixture", selection_policy_version: "1.0.0" },
  };
  return { document, generatedAt: DATE, contentHash: HASH, chartFingerprintHash: await hashChartFingerprint("fixture-chart"),
    contractId: CALC_CONTRACT_ID, contractVersion: CALC_CONTRACT_VERSION, packet: chain.fact_packet, plan: chain.plan };
}

function useOnly(input: Awaited<ReturnType<typeof patternInput>>, aliases: string[]) {
  const chapter = input.document.artifact.chapters[0]!;
  input.plan.chapters[0]!.feature_aliases = aliases;
  for (const unit of [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression]) unit.feature_aliases = aliases;
}

describe("accepted passage support", () => {
  it("joins accepted paragraph refs only, with matching fractional positions and natal aspect orbs across namespaces", async () => {
    const position = natal({ fact_id: "nat_venus", fact_class: "natal_position", body: "venus", target: null,
      aspect: null, sign: "taurus", degree_deg: ((38.1 % 30) + 30) % 30, house: null });
    const aspect = natal({ fact_id: "nat_aspect", fact_class: "natal_aspect", body: "mars", target: "sun",
      aspect: "square", sign: null, degree_deg: 1.23, house: null });
    const unused = natal({ ...position.support.kind === "natal" ? position.support.value : {} as ConstrainedNatalFactInput,
      fact_id: "nat_unused", body: "jupiter" });
    const daily = await deriveDailyReaderRelationshipSupport(dailyInput([position, aspect, unused], [position.fact_id, aspect.fact_id, "nat_missing"]));
    const input = await patternInput();
    input.packet.features = [
      { alias: "f001", feature_class: "position", fact: { body: "venus", longitude: 38.1, sign: 2, house: null }, coverage: "eligible", ontology_rule_ids: [], cluster_ids: [] },
      { alias: "f002", feature_class: "aspect", fact: { body_a: "sun", body_b: "mars", aspect: "square", orb: 1.23 }, coverage: "eligible", ontology_rule_ids: [], cluster_ids: [] },
      { alias: "f003", feature_class: "position", fact: { body: "jupiter", longitude: 5, house: null }, coverage: "eligible", ontology_rule_ids: [], cluster_ids: [] },
    ];
    useOnly(input, ["f001", "f002"]);
    const pattern = await derivePatternReaderRelationshipSupport(input);
    expect(daily.units[0]!.features).toEqual(pattern.units[0]!.features);
    expect(daily.units[0]!.features[0]!.coordinate).toBe('{"degree_deg":8.100000000000001,"sign_index":1}');
    expect(daily.units[0]!.features[1]!.coordinate).toBe('{"aspect":"square","orb_deg":1.23}');
    expect(daily.units[0]!.participants.map((entry) => entry.body)).not.toContain("pluto");
    expect(pattern.units[0]!.participants.map((entry) => entry.body)).not.toContain("jupiter");
  });

  it("suppresses only unsupported time-sensitive support while preserving an ordinary natal participant", async () => {
    const facts = ["venus", "moon", "ascendant"].map((name, index) => natal({ fact_id: `nat_${index}`, fact_class: "natal_position",
      body: name as "venus" | "moon" | "ascendant", target: null, aspect: null, sign: "taurus", degree_deg: 5, house: 3 }));
    const input = dailyInput(facts);
    input.effectiveAccuracy = "unknown";
    input.suppressedFeatures = ["houses", "angles", "angle_transits", "moon_time_sensitive"];
    const support = await deriveDailyReaderRelationshipSupport(input);
    expect(support.units[0]!.participants.map((entry) => entry.body)).toEqual(["venus"]);
    expect(support.units[0]!.features.map((entry) => entry.kind)).toEqual(["natal_position"]);
    expect(await deriveDailyReaderRelationshipSupport({ ...input, contractVersion: "unverified" })).toEqual({ schema_version: "reader-relationship-support/v1", units: [] });
  });

  it("binds accepted cycle references to every retained pass and keeps transit/natal roles", async () => {
    const cycle: NormalizedCycle = { id: "cyc_fixture", technique: "transit", body: "saturn", target: "venus", aspect: "square",
      start_at: "2026-09-08T00:00:00.000Z", exact_at: "2026-09-09T00:30:00.000Z", end_at: "2026-09-11T00:30:00.000Z",
      pass_count: 2, orb_deg: 2, passes: [
        { pass_index: 1, exact_at: "2026-09-09T00:30:00.000Z", direction: "direct", speed_deg_per_day: 1 },
        { pass_index: 2, exact_at: "2026-09-11T00:30:00.000Z", direction: "retrograde", speed_deg_per_day: -1 },
      ] };
    const base = natal({ fact_id: "nat_base", fact_class: "natal_position", body: "venus", target: null, aspect: null, sign: "taurus", degree_deg: 5, house: null });
    const fact: ConstrainedFact = { ...base, fact_id: cycle.id, fact_class: "cycle_instance", support: { kind: "cycle", value: cycle }, origin: "cycle_scan" };
    const input = dailyInput([fact]);
    input.timeZone = "America/Chicago";
    const support = await deriveDailyReaderRelationshipSupport(input);
    const timing = await readerTimingUnits({ cycle, chartFingerprintHash: await hashChartFingerprint("fixture-chart"),
      effectiveAccuracy: "exact", suppressedFeatures: [], timeZone: input.timeZone, policyVersion: input.cyclePolicyVersion });
    expect(support.units[0]!.cycle_refs).toEqual(timing.map((unit) => unit.target));
    expect(timing.map((unit) => unit.target.kind === "timing" && unit.target.local_date)).toEqual(["2026-09-08", "2026-09-10"]);
    expect(support.units[0]!.features[0]!.participants).toEqual([
      { body: "saturn", role: "transiting" }, { body: "venus", role: "natal_target" },
    ]);
    expect(support.units[0]!.cycle_refs![1]!.cycle_hash).toBe(await cycleHash(cycle));
    expect(isReaderRelationshipSupport(support, { documentKind: "daily", documentId: input.reading.reading_id,
      revisionKey: "2", contentHash: HASH })).toBe(true);
  });

  it("requires exact paragraph/chapter coordinates and changes chapter identity when accepted text changes", async () => {
    const input = await patternInput();
    const first = await derivePatternReaderRelationshipSupport(input);
    input.document.artifact.chapters[0]!.summary += " Changed accepted source.";
    const second = await derivePatternReaderRelationshipSupport(input);
    expect(second.units[0]!.target).not.toEqual(first.units[0]!.target);
    const document = { documentKind: "pattern" as const, documentId: input.document.pattern_id,
      revisionKey: `0.7.0:${input.document.pattern_id}:${DATE}`, contentHash: HASH };
    expect(isReaderRelationshipSupport(first, document)).toBe(true);
    expect(isReaderRelationshipSupport(first, { ...document, revisionKey: "different-edition" })).toBe(false);
    expect(isReaderRelationshipSupport({ ...first, units: [first.units[0], first.units[0]] }, document)).toBe(false);
  });
});
