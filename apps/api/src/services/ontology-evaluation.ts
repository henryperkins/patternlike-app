import {
  M7_SCHEMA_VERSION,
  canonicalJson,
  type PatternOntologyRecord,
} from "@patternlike/shared";

import type { OntologyCompilerSummary } from "./ontology-packet.js";
import { isOntologyRuleVerdict } from "./ontology-prompt.js";

export type OntologyRuleVerdictAssessment =
  | { ok: true; rejected: boolean }
  | { ok: false; code: "evaluation_verdict_invalid" };

export function assessOntologyRuleVerdict(
  expectedRuleId: string,
  value: unknown,
): OntologyRuleVerdictAssessment {
  if (!isOntologyRuleVerdict(value) || value.rule_id !== expectedRuleId) {
    return { ok: false, code: "evaluation_verdict_invalid" };
  }
  return { ok: true, rejected: value.verdict === "reject" };
}

export class OntologyEvaluationError extends Error {
  constructor(readonly code: "evaluation_candidate_invalid") {
    super(code);
    this.name = "OntologyEvaluationError";
  }
}

/**
 * Derive the source-supported meaning closure the compiler-approved candidate
 * authorizes for each rule. Output ordering always follows candidate ordering,
 * never provider input ordering or graph traversal order.
 */
export function buildOntologyCompilerSummaries(
  records: readonly PatternOntologyRecord[],
): OntologyCompilerSummary[] {
  const byId = new Map(records.map((record) => [record.id, record]));

  const closureFor = (root: PatternOntologyRecord): Set<string> => {
    const sourceIds = new Set<string>();
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (record: PatternOntologyRecord): void => {
      if (visited.has(record.id)) return;
      if (visiting.has(record.id)) {
        throw new OntologyEvaluationError("evaluation_candidate_invalid");
      }
      visiting.add(record.id);
      if (record.meaning_class === "source_supported") {
        sourceIds.add(record.id);
      }
      for (const inputId of record.input_meaning_ids) {
        const input = byId.get(inputId);
        if (!input) {
          throw new OntologyEvaluationError("evaluation_candidate_invalid");
        }
        visit(input);
      }
      visiting.delete(record.id);
      visited.add(record.id);
    };
    visit(root);
    return sourceIds;
  };

  return records.map((record) => {
    const closure = closureFor(record);
    return {
      rule_id: record.id,
      compiler_passed: true,
      source_meaning_ids: records
        .filter((candidate) => closure.has(candidate.id))
        .map((candidate) => candidate.id),
      finding_codes: [],
    };
  });
}

export interface CanonicalOntologyEvaluationReportInput {
  ontologyVersion: string;
  configurationHash: string;
  corpus: {
    corpusReleaseId: string;
    corpusHash: string;
    locale: string;
    licenseClass: "licensed_excerpt" | "internal_synthetic";
    publicCapable: boolean;
    objectKey: string;
  };
  candidateHash: string;
  compiler: {
    passed: true;
    policyVersion: string;
    reportHash: string;
  };
  orderedVerdicts: readonly {
    ruleId: string;
    verdictHash: string;
  }[];
  generator: {
    model: string;
    reasoning: "high";
    promptVersion: string;
    timeoutMs: number;
    maxOutputTokens: number;
  };
  evaluator: {
    model: string;
    reasoning: "high";
    promptVersion: string;
    timeoutMs: number;
    maxOutputTokens: number;
  };
  inputMaxBytes: number;
  limits: {
    maximumGenerationChunks: number;
    maximumCandidateRecords: number;
    maximumEvaluatorCalls: number;
    maximumCandidateBytes: number;
  };
  configurationEqual: boolean;
  regression: {
    fixtureCount: number;
    maximumProviderCallsPerFixture: number;
    minimumPassRate: number;
  };
}

export interface CanonicalOntologyEvaluationReport {
  schema_version: typeof M7_SCHEMA_VERSION;
  ontology_version: string;
  compiler_passed: true;
  evaluator_passed: true;
  unevaluated_fixture_count: 0;
  corpus: {
    corpus_release_id: string;
    corpus_hash: string;
    locale: string;
    license_class: "licensed_excerpt" | "internal_synthetic";
    public_capable: boolean;
    object_key: string;
  };
  candidate_plaintext_hash: string;
  configuration_hash: string;
  compiler: {
    passed: true;
    policy_version: string;
    report_hash: string;
  };
  ordered_rule_verdicts: Array<{
    rule_id: string;
    verdict_hash: string;
  }>;
  generator: {
    model: string;
    reasoning: "high";
    prompt_version: string;
    timeout_ms: number;
    max_output_tokens: number;
  };
  evaluator: {
    model: string;
    reasoning: "high";
    prompt_version: string;
    timeout_ms: number;
    max_output_tokens: number;
  };
  input_max_bytes: number;
  limits: {
    maximum_generation_chunks: number;
    maximum_candidate_records: number;
    maximum_evaluator_calls: number;
    maximum_candidate_bytes: number;
  };
  configuration_equal: boolean;
  regression: {
    fixture_count: number;
    maximum_provider_calls_per_fixture: number;
    minimum_pass_rate: number;
  };
}

export function createCanonicalOntologyEvaluationReport(
  input: CanonicalOntologyEvaluationReportInput,
): {
  report: CanonicalOntologyEvaluationReport;
  canonicalBytes: string;
} {
  const report: CanonicalOntologyEvaluationReport = {
    schema_version: M7_SCHEMA_VERSION,
    ontology_version: input.ontologyVersion,
    compiler_passed: true,
    evaluator_passed: true,
    unevaluated_fixture_count: 0,
    corpus: {
      corpus_release_id: input.corpus.corpusReleaseId,
      corpus_hash: input.corpus.corpusHash,
      locale: input.corpus.locale,
      license_class: input.corpus.licenseClass,
      public_capable: input.corpus.publicCapable,
      object_key: input.corpus.objectKey,
    },
    candidate_plaintext_hash: input.candidateHash,
    configuration_hash: input.configurationHash,
    compiler: {
      passed: true,
      policy_version: input.compiler.policyVersion,
      report_hash: input.compiler.reportHash,
    },
    ordered_rule_verdicts: input.orderedVerdicts.map((verdict) => ({
      rule_id: verdict.ruleId,
      verdict_hash: verdict.verdictHash,
    })),
    generator: {
      model: input.generator.model,
      reasoning: input.generator.reasoning,
      prompt_version: input.generator.promptVersion,
      timeout_ms: input.generator.timeoutMs,
      max_output_tokens: input.generator.maxOutputTokens,
    },
    evaluator: {
      model: input.evaluator.model,
      reasoning: input.evaluator.reasoning,
      prompt_version: input.evaluator.promptVersion,
      timeout_ms: input.evaluator.timeoutMs,
      max_output_tokens: input.evaluator.maxOutputTokens,
    },
    input_max_bytes: input.inputMaxBytes,
    limits: {
      maximum_generation_chunks: input.limits.maximumGenerationChunks,
      maximum_candidate_records: input.limits.maximumCandidateRecords,
      maximum_evaluator_calls: input.limits.maximumEvaluatorCalls,
      maximum_candidate_bytes: input.limits.maximumCandidateBytes,
    },
    configuration_equal: input.configurationEqual,
    regression: {
      fixture_count: input.regression.fixtureCount,
      maximum_provider_calls_per_fixture:
        input.regression.maximumProviderCallsPerFixture,
      minimum_pass_rate: input.regression.minimumPassRate,
    },
  };
  return { report, canonicalBytes: canonicalJson(report) };
}
