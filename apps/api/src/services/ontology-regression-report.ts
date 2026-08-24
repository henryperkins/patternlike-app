import {
  canonicalJson,
  contentHash,
  type BirthTimeAccuracy,
} from "@patternlike/shared";

import {
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_PLANNER_MODEL,
  OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
  OPENAI_PATTERN_PLANNER_REASONING,
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_VERIFIER_MODEL,
  OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  OPENAI_PATTERN_VERIFIER_REASONING,
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_WRITER_MODEL,
  OPENAI_PATTERN_WRITER_PROMPT_VERSION,
  OPENAI_PATTERN_WRITER_REASONING,
  PATTERN_INPUT_MAX_BYTES,
  PATTERN_PUBLISHER_OPENAI,
  type PatternPublisherPin,
} from "./pattern-publisher.js";

import manifestDocument from "../../../../contracts/m7/fixtures/corpus/manifest.json";
import exact01 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-01.json";
import exact02 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-02.json";
import exact03 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-03.json";
import exact04 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-04.json";
import exact05 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-05.json";
import exact06 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-06.json";
import exact07 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-07.json";
import exact08 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-08.json";
import exact09 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-09.json";
import exact10 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-10.json";
import approximate01 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-01.json";
import approximate02 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-02.json";
import approximate03 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-03.json";
import approximate04 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-04.json";
import approximate05 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-05.json";
import approximate06 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-06.json";
import approximate07 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-07.json";
import approximate08 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-08.json";
import approximate09 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-09.json";
import approximate10 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-10.json";
import unknown01 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-01.json";
import unknown02 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-02.json";
import unknown03 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-03.json";
import unknown04 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-04.json";
import unknown05 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-05.json";
import unknown06 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-06.json";
import unknown07 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-07.json";
import unknown08 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-08.json";
import unknown09 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-09.json";
import unknown10 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-10.json";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export const ONTOLOGY_REGRESSION_FIXTURE_COUNT = 30;
export const ONTOLOGY_REGRESSION_MAXIMUM_CALLS_PER_FIXTURE = 11;
export const ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS =
  ONTOLOGY_REGRESSION_FIXTURE_COUNT *
  ONTOLOGY_REGRESSION_MAXIMUM_CALLS_PER_FIXTURE;
export const ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL = 98_304;
export const ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS =
  ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS *
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL;
export const ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS_PER_CALL = Math.max(
  OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
  OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
);
export const ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS =
  ONTOLOGY_REGRESSION_FIXTURE_COUNT *
  (2 * OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS +
    3 * OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS +
    3 * 2 * OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS);
export const ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS =
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS +
  ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS;
export const ONTOLOGY_REGRESSION_MAXIMUM_ARITHMETIC =
  `${ONTOLOGY_REGRESSION_FIXTURE_COUNT} * (` +
  `${ONTOLOGY_REGRESSION_MAXIMUM_CALLS_PER_FIXTURE} * ` +
  `${ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL} ` +
  `input-token upper-bound units + (` +
  `2 * ${OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS} + ` +
  `3 * ${OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS} + ` +
  `3 * 2 * ${OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS}) output tokens)`;
export const ONTOLOGY_REGRESSION_MONETARY_PRICING_STATUS =
  "current-rate spend approval remains a separate pre-rollout gate";

export const ONTOLOGY_REGRESSION_PATTERN_PIN: PatternPublisherPin = {
  publisher: PATTERN_PUBLISHER_OPENAI,
  planner_model: OPENAI_PATTERN_PLANNER_MODEL,
  planner_reasoning: OPENAI_PATTERN_PLANNER_REASONING,
  planner_prompt_version: OPENAI_PATTERN_PLANNER_PROMPT_VERSION,
  planner_max_output_tokens: OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS,
  writer_model: OPENAI_PATTERN_WRITER_MODEL,
  writer_reasoning: OPENAI_PATTERN_WRITER_REASONING,
  writer_prompt_version: OPENAI_PATTERN_WRITER_PROMPT_VERSION,
  writer_max_output_tokens: OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS,
  verifier_model: OPENAI_PATTERN_VERIFIER_MODEL,
  verifier_reasoning: OPENAI_PATTERN_VERIFIER_REASONING,
  verifier_prompt_version: OPENAI_PATTERN_VERIFIER_PROMPT_VERSION,
  verifier_max_output_tokens: OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS,
  input_max_bytes: PATTERN_INPUT_MAX_BYTES,
  selection_policy_version: "1.0.0",
  validation_policy_version: "1.0.0",
};

export const ONTOLOGY_REGRESSION_HARD_GATES = [
  "suppressed_feature_leak",
  "uncited_astrological_claim",
  "source_dependency_failure",
  "prohibited_claim",
  "mandatory_feature_omission",
  "private_projection_leak",
  "semantic_refusal",
] as const;

export type OntologyRegressionHardGateFailure =
  (typeof ONTOLOGY_REGRESSION_HARD_GATES)[number];

export interface OntologyRegressionFixtureResult {
  fixture_id: string;
  accuracy: BirthTimeAccuracy;
  accepted: boolean;
  declared_outcome: "accepted" | "refused";
  result_hash: string;
  provider_calls: number;
  input_tokens: number;
  output_tokens: number;
  hard_gate_failures: OntologyRegressionHardGateFailure[];
}

export interface OntologyRegressionThresholdResult {
  passed: boolean;
  required_per_cohort: 9 | 10;
  cohorts: Record<BirthTimeAccuracy, {
    accepted: number;
    total: number;
    passed: boolean;
  }>;
}

export class OntologyRegressionError extends Error {
  constructor(
    readonly code:
      | "regression_failed"
      | "regression_budget_exceeded",
  ) {
    super(code);
    this.name = "OntologyRegressionError";
  }
}

export class OntologyRegressionReportError extends Error {
  constructor(readonly code: "regression_report_invalid") {
    super(code);
    this.name = "OntologyRegressionReportError";
  }
}

interface FrozenFixtureIdentity {
  fixture_id: string;
  effective_accuracy: BirthTimeAccuracy;
  declared_outcome: "accepted" | "refused";
}

const frozenFixtureIdentities = [
  exact01,
  exact02,
  exact03,
  exact04,
  exact05,
  exact06,
  exact07,
  exact08,
  exact09,
  exact10,
  approximate01,
  approximate02,
  approximate03,
  approximate04,
  approximate05,
  approximate06,
  approximate07,
  approximate08,
  approximate09,
  approximate10,
  unknown01,
  unknown02,
  unknown03,
  unknown04,
  unknown05,
  unknown06,
  unknown07,
  unknown08,
  unknown09,
  unknown10,
] as unknown as readonly FrozenFixtureIdentity[];

export function evaluateOntologyRegressionThresholds(
  results: readonly { accuracy: BirthTimeAccuracy; accepted: boolean }[],
  configurationEqual: boolean,
): OntologyRegressionThresholdResult {
  const required = configurationEqual ? 10 : 9;
  const cohorts = Object.fromEntries(
    (["exact", "approximate", "unknown"] as const).map((accuracy) => {
      const cohort = results.filter((result) => result.accuracy === accuracy);
      const accepted = cohort.filter((result) => result.accepted).length;
      return [accuracy, {
        accepted,
        total: cohort.length,
        passed: cohort.length === 10 && accepted >= required,
      }];
    }),
  ) as OntologyRegressionThresholdResult["cohorts"];
  return {
    passed: Object.values(cohorts).every((cohort) => cohort.passed),
    required_per_cohort: required,
    cohorts,
  };
}

export async function ontologyRegressionConfigurationHash(
  publisher: "openai" | "codex",
): Promise<string> {
  return contentHash(canonicalJson({
    ...ONTOLOGY_REGRESSION_PATTERN_PIN,
    publisher,
  }));
}

interface CreateOntologyRegressionReportInput {
  ontologyVersion: string;
  commandHash: string;
  configurationHash: string;
  corpusReleaseId: string;
  corpusHash: string;
  corpusManifestHash: string;
  candidateHash: string;
  evaluationReportHash: string;
  configurationEqual: boolean;
  results: readonly OntologyRegressionFixtureResult[];
  requestArtifactCount: number;
  responseArtifactCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ExpectedOntologyRegressionReportIdentity {
  ontologyVersion: string;
  commandHash: string;
  configurationHash: string;
  corpusReleaseId: string;
  corpusHash: string;
  corpusManifestHash: string;
  candidateHash: string;
  evaluationReportHash: string;
  configurationEqual: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidReport(): never {
  throw new OntologyRegressionReportError("regression_report_invalid");
}

function identityIsClosed(
  input: ExpectedOntologyRegressionReportIdentity,
): boolean {
  return input.ontologyVersion.length > 0 &&
    input.ontologyVersion.length <= 200 &&
    CONTENT_HASH.test(input.commandHash) &&
    CONTENT_HASH.test(input.configurationHash) &&
    input.corpusReleaseId.length > 0 &&
    input.corpusReleaseId.length <= 200 &&
    CONTENT_HASH.test(input.corpusHash) &&
    CONTENT_HASH.test(input.corpusManifestHash) &&
    input.corpusManifestHash ===
      ONTOLOGY_REGRESSION_ACTIVATION_MANIFEST_HASH &&
    CONTENT_HASH.test(input.candidateHash) &&
    CONTENT_HASH.test(input.evaluationReportHash) &&
    typeof input.configurationEqual === "boolean";
}

function resultsAreClosed(
  results: readonly OntologyRegressionFixtureResult[],
): boolean {
  if (results.length !== ONTOLOGY_REGRESSION_FIXTURE_COUNT) return false;
  const fixtureIds = new Set<string>();
  const resultHashes = new Set<string>();
  for (const [index, result] of results.entries()) {
    const frozen = frozenFixtureIdentities[index];
    if (
      !frozen ||
      result.fixture_id !== frozen.fixture_id ||
      result.accuracy !== frozen.effective_accuracy ||
      result.declared_outcome !== frozen.declared_outcome ||
      typeof result.accepted !== "boolean" ||
      !CONTENT_HASH.test(result.result_hash) ||
      !Number.isSafeInteger(result.provider_calls) ||
      result.provider_calls <= 0 ||
      result.provider_calls > ONTOLOGY_REGRESSION_MAXIMUM_CALLS_PER_FIXTURE ||
      !isSafeNonnegativeInteger(result.input_tokens) ||
      !isSafeNonnegativeInteger(result.output_tokens) ||
      result.input_tokens >
        result.provider_calls * ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL ||
      result.output_tokens >
        result.provider_calls * ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS_PER_CALL ||
      !Array.isArray(result.hard_gate_failures) ||
      result.hard_gate_failures.some((gate) =>
        !ONTOLOGY_REGRESSION_HARD_GATES.includes(gate)) ||
      new Set(result.hard_gate_failures).size !==
        result.hard_gate_failures.length ||
      fixtureIds.has(result.fixture_id) ||
      resultHashes.has(result.result_hash)
    ) {
      return false;
    }
    fixtureIds.add(result.fixture_id);
    resultHashes.add(result.result_hash);
  }
  return true;
}

function usageIsClosed(input: CreateOntologyRegressionReportInput): boolean {
  const usageValues = [
    input.requestArtifactCount,
    input.responseArtifactCount,
    input.inputTokens,
    input.outputTokens,
  ];
  if (usageValues.some((value) => !isSafeNonnegativeInteger(value))) {
    return false;
  }
  const resultProviderCalls = input.results.reduce(
    (sum, result) => sum + result.provider_calls,
    0,
  );
  const successfulInputTokens = input.results.reduce(
    (sum, result) => sum + result.input_tokens,
    0,
  );
  const successfulOutputTokens = input.results.reduce(
    (sum, result) => sum + result.output_tokens,
    0,
  );
  const missingResponses =
    input.requestArtifactCount - input.responseArtifactCount;
  return (
    input.requestArtifactCount === resultProviderCalls &&
    input.responseArtifactCount >= ONTOLOGY_REGRESSION_FIXTURE_COUNT &&
    input.responseArtifactCount <= input.requestArtifactCount &&
    input.inputTokens === successfulInputTokens +
      missingResponses * ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL &&
    input.outputTokens === successfulOutputTokens +
      missingResponses * ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS_PER_CALL &&
    input.requestArtifactCount <= ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS &&
    input.inputTokens <= ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS &&
    input.outputTokens <= ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS &&
    input.inputTokens + input.outputTokens <=
      ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS
  );
}

function buildReportDocument(input: CreateOntologyRegressionReportInput): {
  document: Record<string, unknown>;
  passed: boolean;
} {
  const threshold = evaluateOntologyRegressionThresholds(
    input.results,
    input.configurationEqual,
  );
  const hardGateCounts = Object.fromEntries(
    ONTOLOGY_REGRESSION_HARD_GATES.map((code) => [
      code,
      input.results.filter((result) =>
        result.hard_gate_failures.includes(code)).length,
    ]),
  );
  const behaviorRegressions = input.results.filter((result) =>
    (result.declared_outcome === "accepted") !== result.accepted).length;
  const hardGatesPassed = Object.values(hardGateCounts)
    .every((count) => count === 0);
  const passed = input.results.length === ONTOLOGY_REGRESSION_FIXTURE_COUNT &&
    threshold.passed && hardGatesPassed && behaviorRegressions === 0;
  return {
    document: {
      schema_version: "ontology-regression-report/v1",
      ontology_version: input.ontologyVersion,
      command_hash: input.commandHash,
      configuration_hash: input.configurationHash,
      corpus: {
        corpus_release_id: input.corpusReleaseId,
        corpus_hash: input.corpusHash,
        activation_manifest_hash: input.corpusManifestHash,
        fixture_count: ONTOLOGY_REGRESSION_FIXTURE_COUNT,
      },
      candidate_hash: input.candidateHash,
      evaluation_report_hash: input.evaluationReportHash,
      configuration_equal: input.configurationEqual,
      threshold,
      hard_gate_counts: hardGateCounts,
      deterministic_behavior_regressions: behaviorRegressions,
      ordered_fixture_results: input.results,
      provider_usage: {
        request_artifact_count: input.requestArtifactCount,
        response_artifact_count: input.responseArtifactCount,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        billable_token_units: input.inputTokens + input.outputTokens,
        maximum_provider_calls: ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
        maximum_input_tokens: ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS,
        maximum_output_tokens: ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS,
        maximum_billable_token_units:
          ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS,
        maximum_arithmetic: ONTOLOGY_REGRESSION_MAXIMUM_ARITHMETIC,
        monetary_pricing_status: ONTOLOGY_REGRESSION_MONETARY_PRICING_STATUS,
      },
      passed,
    },
    passed,
  };
}

export async function createCanonicalOntologyRegressionReport(
  input: CreateOntologyRegressionReportInput,
): Promise<{
  document: Record<string, unknown>;
  canonicalBytes: string;
  plaintextHash: string;
}> {
  if (!identityIsClosed(input) || !resultsAreClosed(input.results)) {
    throw new OntologyRegressionError("regression_failed");
  }
  if (!usageIsClosed(input)) {
    throw new OntologyRegressionError("regression_budget_exceeded");
  }
  const { document, passed } = buildReportDocument(input);
  if (!passed) throw new OntologyRegressionError("regression_failed");
  const canonicalBytes = canonicalJson(document);
  return {
    document,
    canonicalBytes,
    plaintextHash: await contentHash(canonicalBytes),
  };
}

const TOP_LEVEL_KEYS = [
  "schema_version",
  "ontology_version",
  "command_hash",
  "configuration_hash",
  "corpus",
  "candidate_hash",
  "evaluation_report_hash",
  "configuration_equal",
  "threshold",
  "hard_gate_counts",
  "deterministic_behavior_regressions",
  "ordered_fixture_results",
  "provider_usage",
  "passed",
] as const;
const CORPUS_KEYS = [
  "corpus_release_id",
  "corpus_hash",
  "activation_manifest_hash",
  "fixture_count",
] as const;
const THRESHOLD_KEYS = ["passed", "required_per_cohort", "cohorts"] as const;
const COHORT_KEYS = ["accepted", "total", "passed"] as const;
const RESULT_KEYS = [
  "fixture_id",
  "accuracy",
  "accepted",
  "declared_outcome",
  "result_hash",
  "provider_calls",
  "input_tokens",
  "output_tokens",
  "hard_gate_failures",
] as const;
const PROVIDER_USAGE_KEYS = [
  "request_artifact_count",
  "response_artifact_count",
  "input_tokens",
  "output_tokens",
  "billable_token_units",
  "maximum_provider_calls",
  "maximum_input_tokens",
  "maximum_output_tokens",
  "maximum_billable_token_units",
  "maximum_arithmetic",
  "monetary_pricing_status",
] as const;

function parseClosedResults(value: unknown): OntologyRegressionFixtureResult[] {
  if (!Array.isArray(value)) invalidReport();
  const results: OntologyRegressionFixtureResult[] = [];
  for (const result of value) {
    if (
      !isRecord(result) ||
      !hasExactKeys(result, RESULT_KEYS) ||
      typeof result.fixture_id !== "string" ||
      !["exact", "approximate", "unknown"].includes(
        result.accuracy as string,
      ) ||
      typeof result.accepted !== "boolean" ||
      !["accepted", "refused"].includes(result.declared_outcome as string) ||
      typeof result.result_hash !== "string" ||
      !isSafeNonnegativeInteger(result.provider_calls) ||
      !isSafeNonnegativeInteger(result.input_tokens) ||
      !isSafeNonnegativeInteger(result.output_tokens) ||
      !Array.isArray(result.hard_gate_failures) ||
      result.hard_gate_failures.some((gate) => typeof gate !== "string")
    ) {
      invalidReport();
    }
    results.push(result as unknown as OntologyRegressionFixtureResult);
  }
  if (!resultsAreClosed(results)) invalidReport();
  return results;
}

export async function parseCanonicalOntologyRegressionReport(
  plaintext: Uint8Array,
  expected: ExpectedOntologyRegressionReportIdentity,
): Promise<Record<string, unknown>> {
  if (!identityIsClosed(expected)) invalidReport();
  if (
    plaintext.byteLength >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, index) => plaintext[index] === byte)
  ) {
    invalidReport();
  }
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(plaintext);
  } catch {
    invalidReport();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    invalidReport();
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, TOP_LEVEL_KEYS) ||
    canonicalJson(parsed) !== bytes ||
    parsed.schema_version !== "ontology-regression-report/v1" ||
    parsed.ontology_version !== expected.ontologyVersion ||
    parsed.command_hash !== expected.commandHash ||
    parsed.configuration_hash !== expected.configurationHash ||
    parsed.candidate_hash !== expected.candidateHash ||
    parsed.evaluation_report_hash !== expected.evaluationReportHash ||
    parsed.configuration_equal !== expected.configurationEqual ||
    parsed.passed !== true ||
    !isRecord(parsed.corpus) ||
    !hasExactKeys(parsed.corpus, CORPUS_KEYS) ||
    parsed.corpus.corpus_release_id !== expected.corpusReleaseId ||
    parsed.corpus.corpus_hash !== expected.corpusHash ||
    parsed.corpus.activation_manifest_hash !== expected.corpusManifestHash ||
    parsed.corpus.fixture_count !== ONTOLOGY_REGRESSION_FIXTURE_COUNT ||
    !isRecord(parsed.threshold) ||
    !hasExactKeys(parsed.threshold, THRESHOLD_KEYS) ||
    typeof parsed.threshold.passed !== "boolean" ||
    ![9, 10].includes(parsed.threshold.required_per_cohort as number) ||
    !isRecord(parsed.threshold.cohorts) ||
    !hasExactKeys(parsed.threshold.cohorts, [
      "exact",
      "approximate",
      "unknown",
    ]) ||
    !isRecord(parsed.hard_gate_counts) ||
    !hasExactKeys(parsed.hard_gate_counts, ONTOLOGY_REGRESSION_HARD_GATES) ||
    !isSafeNonnegativeInteger(parsed.deterministic_behavior_regressions) ||
    !isRecord(parsed.provider_usage) ||
    !hasExactKeys(parsed.provider_usage, PROVIDER_USAGE_KEYS)
  ) {
    invalidReport();
  }
  for (const cohort of ["exact", "approximate", "unknown"] as const) {
    const value = parsed.threshold.cohorts[cohort];
    if (
      !isRecord(value) ||
      !hasExactKeys(value, COHORT_KEYS) ||
      !isSafeNonnegativeInteger(value.accepted) ||
      !isSafeNonnegativeInteger(value.total) ||
      typeof value.passed !== "boolean"
    ) {
      invalidReport();
    }
  }
  for (const gate of ONTOLOGY_REGRESSION_HARD_GATES) {
    if (!isSafeNonnegativeInteger(parsed.hard_gate_counts[gate])) {
      invalidReport();
    }
  }
  const usage = parsed.provider_usage;
  if (
    !isSafeNonnegativeInteger(usage.request_artifact_count) ||
    !isSafeNonnegativeInteger(usage.response_artifact_count) ||
    !isSafeNonnegativeInteger(usage.input_tokens) ||
    !isSafeNonnegativeInteger(usage.output_tokens) ||
    !isSafeNonnegativeInteger(usage.billable_token_units) ||
    !isSafeNonnegativeInteger(usage.maximum_provider_calls) ||
    !isSafeNonnegativeInteger(usage.maximum_input_tokens) ||
    !isSafeNonnegativeInteger(usage.maximum_output_tokens) ||
    !isSafeNonnegativeInteger(usage.maximum_billable_token_units) ||
    typeof usage.maximum_arithmetic !== "string" ||
    typeof usage.monetary_pricing_status !== "string"
  ) {
    invalidReport();
  }
  const results = parseClosedResults(parsed.ordered_fixture_results);
  const input: CreateOntologyRegressionReportInput = {
    ...expected,
    results,
    requestArtifactCount: usage.request_artifact_count,
    responseArtifactCount: usage.response_artifact_count,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
  if (!usageIsClosed(input)) invalidReport();
  const rebuilt = buildReportDocument(input);
  if (!rebuilt.passed || canonicalJson(rebuilt.document) !== bytes) {
    invalidReport();
  }
  return parsed;
}

export const ONTOLOGY_REGRESSION_ACTIVATION_MANIFEST_HASH =
  (manifestDocument as { corpus_identity_hash: string }).corpus_identity_hash;
