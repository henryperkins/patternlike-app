import { canonicalJson, type PatternOntologyRelease } from "@patternlike/shared";
import { describe, expect, it } from "vitest";

import {
  validateOntologyCandidateRelease,
} from "./ontology-candidate-validation.js";

const FRAGMENT_ID = `srcf_${"a".repeat(32)}`;

function release(): PatternOntologyRelease {
  return {
    schema_version: "0.7.0",
    ontology_version: "ontology-candidate-validation",
    bundle_hash: `sha256:${"b".repeat(64)}`,
    corpus_release_hash: `sha256:${"c".repeat(64)}`,
    locale: "en-US",
    status: "candidate",
    records: [{
      id: `ont_${"1".repeat(32)}`,
      meaning_class: "source_supported",
      locale: "en-US",
      feature_predicate: { type: "house_cusp", house: 12 },
      normalized_proposition: "A source-supported bounded proposition.",
      source_fragment_ids: [FRAGMENT_ID],
      input_meaning_ids: [],
      transformation_class: null,
      tensions: ["A real tension."],
      counter_expressions: ["A genuinely different counter-expression."],
      prohibited_claims: ["No diagnosis, prediction, causation, or inevitability."],
      salience_band: "medium",
      presentation_priority: 1000,
      cluster_tags: ["house_cusp"],
    }],
    evaluation: {
      schema_version: "0.7.0",
      ontology_version: "ontology-candidate-validation",
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: false,
      unevaluated_fixture_count: 0,
    },
    provenance: { origin: "machine_pipeline" },
  };
}

function validate(candidate: PatternOntologyRelease) {
  const canonicalBytes = canonicalJson(candidate);
  return validateOntologyCandidateRelease(candidate, {
    canonicalBytes,
    corpusLocale: "en-US",
    permittedFragmentIds: new Set([FRAGMENT_ID]),
    coverageTargets: [{
      feature_class: "house_cusp",
      minimum_source_supported: 1,
      minimum_total: 1,
    }],
    maximumCandidateRecords: 64,
    maximumCandidateBytes: 262144,
  });
}

describe("frozen ontology candidate validation", () => {
  it("uses the exact frozen release and record schemas as runtime authority", () => {
    expect(validate(release())).toMatchObject({ ok: true });

    const badHouse = release();
    badHouse.records[0]!.feature_predicate = { type: "house_cusp", house: 13 };
    expect(validate(badHouse)).toEqual({ ok: false, code: "candidate_schema_invalid" });

    const badPriority = release();
    badPriority.records[0]!.presentation_priority = 1001;
    expect(validate(badPriority)).toEqual({ ok: false, code: "candidate_schema_invalid" });
  });

  it("closes locale, fragment, coverage, and source-supported policy failures", () => {
    const cases = [
      (() => {
        const value = release();
        value.records[0]!.locale = "fr-FR";
        return value;
      })(),
      (() => {
        const value = release();
        value.records[0]!.source_fragment_ids = [`srcf_${"d".repeat(32)}`];
        return value;
      })(),
      (() => {
        const value = release();
        value.records[0]!.tensions = [];
        return value;
      })(),
      (() => {
        const value = release();
        value.records[0]!.counter_expressions = [];
        return value;
      })(),
      (() => {
        const value = release();
        value.records[0]!.prohibited_claims = [];
        return value;
      })(),
    ];
    for (const candidate of cases) {
      expect(validate(candidate)).toMatchObject({ ok: false });
    }
  });

  it("allows non-claim-bearing expression guidance without synthesis inputs", () => {
    const candidate = release();
    candidate.records.push({
      ...candidate.records[0]!,
      id: `ont_${"2".repeat(32)}`,
      meaning_class: "expression_guidance",
      normalized_proposition: "Use a concise title and plain-language pacing.",
      source_fragment_ids: [],
      input_meaning_ids: [],
      transformation_class: null,
      tensions: ["Keep the wording measured."],
      counter_expressions: ["Leave room for a different emphasis."],
    });

    expect(validate(candidate)).toMatchObject({ ok: true });
  });

  it("requires every derived synthesis graph to resolve only into sources", () => {
    const candidate = release();
    const secondSource = {
      ...candidate.records[0]!,
      id: `ont_${"2".repeat(32)}`,
      source_fragment_ids: [...candidate.records[0]!.source_fragment_ids],
      input_meaning_ids: [],
    };
    candidate.records.push(secondSource, {
      ...candidate.records[0]!,
      id: `ont_${"3".repeat(32)}`,
      meaning_class: "derived_synthesis",
      normalized_proposition: "A bounded synthesis of two source meanings.",
      source_fragment_ids: [],
      input_meaning_ids: [candidate.records[0]!.id, secondSource.id],
      transformation_class: "intersection",
    });
    expect(validate(candidate)).toMatchObject({ ok: true });

    candidate.records[2]!.input_meaning_ids[1] = `ont_${"4".repeat(32)}`;
    expect(validate(candidate)).toEqual({
      ok: false,
      code: "candidate_policy_invalid",
    });
  });

  it("rejects astrological assertions disguised as expression guidance", () => {
    const candidate = release();
    candidate.records.push({
      ...candidate.records[0]!,
      id: `ont_${"2".repeat(32)}`,
      meaning_class: "expression_guidance",
      normalized_proposition: "Mars in Aries predicts a life event.",
      source_fragment_ids: [],
      input_meaning_ids: [],
      transformation_class: null,
    });

    expect(validate(candidate)).toEqual({
      ok: false,
      code: "candidate_policy_invalid",
    });
  });

  it("enforces the exact 64-record and 262144-byte inclusive ceilings", () => {
    const tooMany = release();
    tooMany.records = Array.from({ length: 65 }, (_, index) => ({
      ...release().records[0]!,
      id: `ont_${(index + 1).toString(16).padStart(32, "0")}`,
    }));
    expect(validate(tooMany)).toEqual({ ok: false, code: "candidate_limit_exceeded" });

    const tooLarge = release();
    const original = canonicalJson(tooLarge).length;
    tooLarge.records[0]!.normalized_proposition += "x".repeat(262145 - original);
    expect(new TextEncoder().encode(canonicalJson(tooLarge)).byteLength).toBe(262145);
    expect(validate(tooLarge)).toEqual({ ok: false, code: "candidate_limit_exceeded" });
  });
});
