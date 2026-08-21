import { canonicalJson, type PatternOntologyRecord } from "@patternlike/shared";
import { describe, expect, it } from "vitest";

import type { OntologyRuleVerdict } from "./ontology-publisher.js";
import {
  assessOntologyRuleVerdict,
  buildOntologyCompilerSummaries,
  createCanonicalOntologyEvaluationReport,
} from "./ontology-evaluation.js";

const SOURCE_ID = `srcf_${"a".repeat(32)}`;

function record(
  suffix: string,
  overrides: Partial<PatternOntologyRecord> = {},
): PatternOntologyRecord {
  return {
    id: `ont_${suffix.repeat(32).slice(0, 32)}`,
    meaning_class: "source_supported",
    locale: "en-US",
    feature_predicate: { type: "position", body: "sun" },
    normalized_proposition: `Literal proposition ${suffix}.`,
    source_fragment_ids: [SOURCE_ID],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: ["A literal tension."],
    counter_expressions: ["A literal counter-expression."],
    prohibited_claims: [],
    salience_band: "medium",
    presentation_priority: 50,
    cluster_tags: ["position"],
    ...overrides,
  };
}

function passingVerdict(ruleId: string): OntologyRuleVerdict {
  return {
    schema_version: "0.7.0",
    rule_id: ruleId,
    verdict: "pass",
    dimensions: {
      source_support: "pass",
      entailment: "pass",
      contradiction: "pass",
      unsupported_expansion: "pass",
      diagnostic_or_predictive_drift: "pass",
      one_sided_or_essentialist_framing: "pass",
      tension_counter_expression_balance: "pass",
      uncertainty_compatibility: "pass",
      cross_record_conflict: "pass",
    },
  };
}

describe("ontology independent evaluation", () => {
  it("accepts a rule only when all nine frozen dimensions pass", () => {
    const verdict = passingVerdict(record("1").id);

    expect(assessOntologyRuleVerdict(verdict.rule_id, verdict)).toEqual({
      ok: true,
      rejected: false,
    });
  });

  it("terminally recognizes one rejected dimension", () => {
    const verdict = passingVerdict(record("2").id);
    verdict.verdict = "reject";
    verdict.dimensions.uncertainty_compatibility = "reject";

    expect(assessOntologyRuleVerdict(verdict.rule_id, verdict)).toEqual({
      ok: true,
      rejected: true,
    });
  });

  it("refuses missing, extra, contradictory, or wrong-rule verdicts", () => {
    const ruleId = record("3").id;
    const missing = passingVerdict(ruleId) as unknown as {
      dimensions: Record<string, string>;
    };
    delete missing.dimensions.cross_record_conflict;

    const extra = passingVerdict(ruleId) as unknown as {
      dimensions: Record<string, string>;
    };
    extra.dimensions.replacement_rule = "pass";

    const contradictory = passingVerdict(ruleId);
    contradictory.dimensions.entailment = "reject";

    expect(assessOntologyRuleVerdict(ruleId, missing)).toEqual({
      ok: false,
      code: "evaluation_verdict_invalid",
    });
    expect(assessOntologyRuleVerdict(ruleId, extra)).toEqual({
      ok: false,
      code: "evaluation_verdict_invalid",
    });
    expect(assessOntologyRuleVerdict(ruleId, contradictory)).toEqual({
      ok: false,
      code: "evaluation_verdict_invalid",
    });
    expect(assessOntologyRuleVerdict(record("4").id, passingVerdict(ruleId)))
      .toEqual({ ok: false, code: "evaluation_verdict_invalid" });
  });

  it("derives deterministic source-meaning closure in candidate order", () => {
    const first = record("a");
    const second = record("b", {
      feature_predicate: { type: "aspect", body_a: "sun", body_b: "moon", aspect: "square" },
    });
    const derived = record("c", {
      meaning_class: "derived_synthesis",
      source_fragment_ids: [],
      input_meaning_ids: [second.id, first.id],
      transformation_class: "intersection",
    });
    const guidance = record("d", {
      meaning_class: "expression_guidance",
      source_fragment_ids: [],
      input_meaning_ids: [derived.id],
    });

    expect(buildOntologyCompilerSummaries([
      first,
      second,
      derived,
      guidance,
    ])).toEqual([
      {
        rule_id: first.id,
        compiler_passed: true,
        source_meaning_ids: [first.id],
        finding_codes: [],
      },
      {
        rule_id: second.id,
        compiler_passed: true,
        source_meaning_ids: [second.id],
        finding_codes: [],
      },
      {
        rule_id: derived.id,
        compiler_passed: true,
        source_meaning_ids: [first.id, second.id],
        finding_codes: [],
      },
      {
        rule_id: guidance.id,
        compiler_passed: true,
        source_meaning_ids: [first.id, second.id],
        finding_codes: [],
      },
    ]);
  });

  it("binds every ordered verdict and frozen configuration in canonical bytes", () => {
    const result = createCanonicalOntologyEvaluationReport({
      ontologyVersion: "ontology-task-6",
      configurationHash: `sha256:${"1".repeat(64)}`,
      corpus: {
        corpusReleaseId: "corpus-task-6",
        corpusHash: `sha256:${"2".repeat(64)}`,
        locale: "en-US",
        licenseClass: "internal_synthetic",
        publicCapable: false,
        objectKey: "pattern-ontology-corpora/corpus-task-6.json",
      },
      candidateHash: `sha256:${"3".repeat(64)}`,
      compiler: {
        passed: true,
        policyVersion: "1.0.0",
        reportHash: `sha256:${"4".repeat(64)}`,
      },
      orderedVerdicts: [
        { ruleId: `ont_${"a".repeat(32)}`, verdictHash: `sha256:${"5".repeat(64)}` },
        { ruleId: `ont_${"b".repeat(32)}`, verdictHash: `sha256:${"6".repeat(64)}` },
      ],
      generator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        promptVersion: "1.0.0",
        timeoutMs: 120000,
        maxOutputTokens: 8000,
      },
      evaluator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        promptVersion: "1.0.0-evaluator",
        timeoutMs: 120000,
        maxOutputTokens: 4000,
      },
      inputMaxBytes: 98304,
      configurationEqual: true,
      regression: {
        fixtureCount: 30,
        maximumProviderCallsPerFixture: 11,
        minimumPassRate: 1,
      },
    });
    const expected = {
      candidate_plaintext_hash: `sha256:${"3".repeat(64)}`,
      compiler: {
        passed: true,
        policy_version: "1.0.0",
        report_hash: `sha256:${"4".repeat(64)}`,
      },
      compiler_passed: true,
      configuration_equal: true,
      configuration_hash: `sha256:${"1".repeat(64)}`,
      corpus: {
        corpus_hash: `sha256:${"2".repeat(64)}`,
        corpus_release_id: "corpus-task-6",
        license_class: "internal_synthetic",
        locale: "en-US",
        object_key: "pattern-ontology-corpora/corpus-task-6.json",
        public_capable: false,
      },
      evaluator: {
        max_output_tokens: 4000,
        model: "gpt-5.6-sol",
        prompt_version: "1.0.0-evaluator",
        reasoning: "high",
        timeout_ms: 120000,
      },
      evaluator_passed: true,
      generator: {
        max_output_tokens: 8000,
        model: "gpt-5.6-sol",
        prompt_version: "1.0.0",
        reasoning: "high",
        timeout_ms: 120000,
      },
      input_max_bytes: 98304,
      ontology_version: "ontology-task-6",
      ordered_rule_verdicts: [
        { rule_id: `ont_${"a".repeat(32)}`, verdict_hash: `sha256:${"5".repeat(64)}` },
        { rule_id: `ont_${"b".repeat(32)}`, verdict_hash: `sha256:${"6".repeat(64)}` },
      ],
      regression: {
        fixture_count: 30,
        maximum_provider_calls_per_fixture: 11,
        minimum_pass_rate: 1,
      },
      schema_version: "0.7.0",
      unevaluated_fixture_count: 0,
    };

    expect(result.report).toEqual(expected);
    expect(result.canonicalBytes).toBe(canonicalJson(expected));
  });
});
