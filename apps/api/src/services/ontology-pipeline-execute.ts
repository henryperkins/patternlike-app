import {
  M7_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
  canonicalJson,
  contentHash,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import {
  PATTERN_SELECTION_POLICY_ID,
  PATTERN_SELECTION_POLICY_VERSION,
  PATTERN_VALIDATION_POLICY_ID,
  PATTERN_VALIDATION_POLICY_VERSION,
  compileOntologyRelease,
} from "@patternlike/pattern-engine";

import {
  MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS,
  advanceOntologyPipelineCursor,
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
  retryOntologyPipelineStage,
  succeedOntologyPipelineRun,
  type ClaimedOntologyPipelineRun,
  type OntologyPipelineFailureClass,
} from "../db/ontology-pipeline.js";
import {
  validateOntologyCandidateRelease,
} from "./ontology-candidate-validation.js";
import { safeLog } from "./safe-log.js";
import {
  createClaimedOntologyProviderCallReservation,
  reserveClaimedOntologyRegressionProviderCall,
} from "../db/ontology-provider-usage.js";
import {
  ONTOLOGY_OBJECT_PREFIX,
  storeOntologyRelease,
} from "../db/pattern-ontology.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import {
  resolveOntologyPipelineConfiguration,
  type OntologyPipelineConfiguration,
  type OntologyPipelineConfigPin,
} from "../middleware/config-guard.js";
import {
  extractOutputText,
} from "./openai-responses-adapter.js";
import {
  assessOntologyRuleVerdict,
  buildOntologyCompilerSummaries,
  createCanonicalOntologyEvaluationReport,
} from "./ontology-evaluation.js";
import {
  OntologyCorpusError,
  readRegisteredOntologyCorpus,
  type RegisteredOntologyCorpus,
} from "./ontology-corpus.js";
import {
  frozenOntologyCoverageSourceHintsMatchIdentity,
} from "./ontology-coverage-source-hints.js";
import {
  buildOntologyEvaluatorPacket,
  buildOntologyGeneratorPacket,
} from "./ontology-packet.js";
import {
  OntologyPipelineArtifactError,
  putOntologyPipelineArtifact,
  readOntologyPipelineArtifact,
  type OntologyPipelineArtifactClass,
  type OntologyPipelineArtifactCoordinate,
} from "./ontology-pipeline-artifacts.js";
import {
  ONTOLOGY_COMPILER_POLICY_VERSION,
  ONTOLOGY_PIPELINE_COMMAND_VERSION,
  ONTOLOGY_PIPELINE_COVERAGE_TARGETS,
  ONTOLOGY_PIPELINE_FEATURE_VOCABULARY,
  ONTOLOGY_PIPELINE_LIMITS,
  ONTOLOGY_PROHIBITED_CLAIMS,
  ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION,
  ONTOLOGY_REGRESSION_POLICY_VERSION,
  OntologyPipelineCommandError,
  loadOntologyPipelinePredecessor,
  type OntologyPipelineCommand,
} from "./ontology-pipeline-command.js";
import {
  dispatchUndispatchedOntologyPipelineRuns,
} from "./ontology-pipeline-enqueue.js";
import {
  buildOntologyEvaluatorResponsesRequest,
  buildOntologyGeneratorResponsesRequest,
  isOntologyGenerationChunk,
  isOntologyRuleVerdict,
} from "./ontology-prompt.js";
import type {
  OntologyGenerationChunk,
  OntologyPassOutcome,
  OntologyPublisher,
  OntologyRuleVerdict,
} from "./ontology-publisher.js";
import { createOpenAiOntologyPublisher } from "./openai-ontology-publisher.js";
import {
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL,
  ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
  ONTOLOGY_REGRESSION_PATTERN_PIN,
  OntologyRegressionError,
  applyOntologyRegressionPass,
  createCanonicalOntologyRegressionReport,
  createOntologyRegressionFixtureState,
  loadOntologyRegressionCorpus,
  ontologyRegressionPassCanAttempt,
  ontologyRegressionPassMaximumOutputTokens,
  ontologyRegressionPassTimeoutMs,
  prepareOntologyRegressionPass,
  type OntologyRegressionFixtureResult,
  type OntologyRegressionFixtureState,
} from "./ontology-regression.js";
import {
  createOpenAiPatternPublisher,
} from "./pattern-publisher-factory.js";
import type {
  PatternPassOutcome,
  PatternPassProvenance,
  PatternPublisher,
  PatternStageClass,
} from "./pattern-publisher.js";
import {
  commitOntologyPipelineEvidence,
  PatternOntologyEvidenceError,
  verifyPatternOntologyEvidence,
} from "./pattern-ontology-evidence.js";
import {
  OntologySigningClientError,
  signOntologyCandidate,
} from "./ontology-signing-client.js";
import {
  computeOntologyBundleHash,
  parseOntologyKeys,
  stripOntologySignature,
  verifyOntologySignature,
  type SignedOntologyRelease,
} from "./pattern-ontology-verify.js";
import { reconcileMachineOntologyActivation } from "./pattern-lifecycle.js";

const textEncoder = new TextEncoder();
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const LEASE_RETRY_DELAY_SECONDS = 301;
const PROVIDER_RETRY_DELAY_SECONDS = 60;

interface OntologyPipelineExecutionRow {
  run_id: string;
  corpus_release_id: string;
  corpus_hash: string;
  candidate_ontology_version: string;
  configuration_json: string;
  configuration_hash: string;
  candidate_hash: string | null;
  compilation_report_hash: string | null;
  evaluation_report_hash: string | null;
  regression_report_hash: string | null;
  bundle_hash: string | null;
}

interface CandidateChunkArtifactRow {
  stage_generation: number;
  stage_attempt: number;
  plaintext_sha256: string;
}

interface LoadedCandidateChunk {
  chunk: OntologyGenerationChunk;
  plaintextHash: string;
  stageGeneration: number;
  stageAttempt: number;
}

interface VerdictArtifactRow {
  stage_generation: number;
  stage_attempt: number;
}

interface SingleArtifactRow {
  stage: "compiling" | "evaluating" | "regressing" | "signing" | "ingesting";
  stage_generation: number;
  stage_attempt: number;
  plaintext_sha256: string;
}

interface RegressionArtifactRow {
  stage_generation: number;
  stage_attempt: number;
  artifact_class: "regression_request" | "regression_response" | "regression_result";
  plaintext_sha256: string;
}

interface LoadedExecutionContext {
  row: OntologyPipelineExecutionRow;
  command: OntologyPipelineCommand;
  configuration: OntologyPipelineConfiguration;
}

export type OntologyPipelineExecuteOutcome =
  | { status: "advanced" }
  | { status: "rescheduled"; retryAfterSeconds: number }
  | { status: "duplicate" }
  | { status: "parked" }
  | { status: "terminal" }
  | { status: "retry"; retryAfterSeconds: number };

export interface OntologyPipelineExecuteOptions {
  publisher?: OntologyPublisher;
  patternPublisher?: PatternPublisher;
  clock?: () => Date;
}

class TerminalPipelineFailure extends Error {
  constructor(readonly failureClass: OntologyPipelineFailureClass) {
    super(failureClass);
    this.name = "TerminalPipelineFailure";
  }
}

function terminal(failureClass: OntologyPipelineFailureClass): never {
  throw new TerminalPipelineFailure(failureClass);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasExactKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return arraysEqual(actual, [...expected].sort());
}

function coverageTargetsAreFrozen(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length === ONTOLOGY_PIPELINE_COVERAGE_TARGETS.length &&
    value.every((target, index) => {
      const expected = ONTOLOGY_PIPELINE_COVERAGE_TARGETS[index]!;
      return isRecord(target) &&
        target.feature_class === expected.feature_class &&
        target.minimum_source_supported === expected.minimum_source_supported &&
        target.minimum_total === expected.minimum_total;
    });
}

function predecessorReferenceIsValid(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return arraysEqual(keys, [
    "bundle_hash",
    "corpus_release_hash",
    "locale",
    "object_key",
    "ontology_version",
  ]) &&
    typeof value.ontology_version === "string" && value.ontology_version.length > 0 &&
    typeof value.bundle_hash === "string" && CONTENT_HASH.test(value.bundle_hash) &&
    typeof value.corpus_release_hash === "string" && CONTENT_HASH.test(value.corpus_release_hash) &&
    typeof value.locale === "string" && value.locale.length > 0 &&
    typeof value.object_key === "string" && value.object_key.length > 0;
}

function commandIsExecutable(
  value: unknown,
  row: OntologyPipelineExecutionRow,
  configuration: OntologyPipelineConfiguration,
): value is OntologyPipelineCommand {
  if (!isRecord(value)) return false;
  const corpus = value.corpus;
  const generator = value.generator;
  const evaluator = value.evaluator;
  const generatorInput = value.generator_input;
  const limits = value.limits;
  const policy = value.policy;
  const regression = value.regression;
  if (
    !hasExactKeys(value, [
      "candidate_ontology_version",
      "command_version",
      "configuration_equal",
      "corpus",
      "daily_provider_call_limit",
      "evaluator",
      "failed_artifact_retention_days",
      "generator",
      "generator_input",
      "input_max_bytes",
      "limits",
      "policy",
      "provider",
      "regression",
      "schema_version",
    ]) ||
    !isRecord(corpus) ||
    !hasExactKeys(corpus, [
      "corpus_hash",
      "corpus_release_id",
      "license_class",
      "object_key",
      "public_capable",
    ]) ||
    !isRecord(generator) ||
    !hasExactKeys(generator, [
      "max_output_tokens",
      "model",
      "prompt_version",
      "reasoning",
      "timeout_ms",
    ]) ||
    !isRecord(evaluator) ||
    !hasExactKeys(evaluator, [
      "max_output_tokens",
      "model",
      "prompt_version",
      "reasoning",
      "timeout_ms",
    ]) ||
    !isRecord(generatorInput) ||
    !hasExactKeys(generatorInput, [
      "active_machine_predecessor",
      "coverage_source_hints",
      "coverage_targets",
      "feature_vocabulary",
    ]) ||
    !isRecord(limits) ||
    !hasExactKeys(limits, [
      "maximum_candidate_bytes",
      "maximum_candidate_records",
      "maximum_evaluator_calls",
      "maximum_generation_chunks",
    ]) ||
    !isRecord(policy) ||
    !hasExactKeys(policy, [
      "compiler_policy_version",
      "feature_policy_version",
      "ontology_schema_version",
      "prohibited_claim_policy_version",
      "prohibited_claims",
      "regression_policy_version",
      "selection_policy_id",
      "selection_policy_version",
      "validation_policy_id",
      "validation_policy_version",
    ]) ||
    !isRecord(regression) ||
    !hasExactKeys(regression, [
      "fixture_count",
      "maximum_provider_calls_per_fixture",
      "minimum_pass_rate",
    ])
  ) {
    return false;
  }
  const pin = configuration.pin;
  return value.command_version === ONTOLOGY_PIPELINE_COMMAND_VERSION &&
    value.schema_version === M7_SCHEMA_VERSION &&
    value.provider === "openai" &&
    value.candidate_ontology_version === row.candidate_ontology_version &&
    corpus.corpus_release_id === row.corpus_release_id &&
    corpus.corpus_hash === row.corpus_hash &&
    (corpus.license_class === "licensed_excerpt" ||
      corpus.license_class === "internal_synthetic") &&
    corpus.public_capable ===
      (corpus.license_class === "licensed_excerpt") &&
    corpus.object_key ===
      `pattern-ontology-corpora/${row.corpus_release_id}.json` &&
    generator.model === pin.generator_model &&
    generator.reasoning === pin.generator_reasoning &&
    generator.prompt_version === pin.generator_prompt_version &&
    generator.timeout_ms === configuration.generatorTimeoutMs &&
    generator.max_output_tokens === pin.generator_max_output_tokens &&
    evaluator.model === pin.evaluator_model &&
    evaluator.reasoning === pin.evaluator_reasoning &&
    evaluator.prompt_version === pin.evaluator_prompt_version &&
    evaluator.timeout_ms === configuration.evaluatorTimeoutMs &&
    evaluator.max_output_tokens === pin.evaluator_max_output_tokens &&
    generator.prompt_version !== evaluator.prompt_version &&
    value.input_max_bytes === pin.input_max_bytes &&
    limits.maximum_generation_chunks ===
      ONTOLOGY_PIPELINE_LIMITS.maximum_generation_chunks &&
    limits.maximum_candidate_records ===
      ONTOLOGY_PIPELINE_LIMITS.maximum_candidate_records &&
    limits.maximum_evaluator_calls ===
      ONTOLOGY_PIPELINE_LIMITS.maximum_evaluator_calls &&
    limits.maximum_candidate_bytes ===
      ONTOLOGY_PIPELINE_LIMITS.maximum_candidate_bytes &&
    value.daily_provider_call_limit === configuration.dailyProviderCallLimit &&
    value.failed_artifact_retention_days === 7 &&
    value.configuration_equal === configuration.configurationEqual &&
    regression.fixture_count === 30 &&
    regression.maximum_provider_calls_per_fixture === 11 &&
    regression.minimum_pass_rate ===
      configuration.regressionMinimumPassRate &&
    Array.isArray(generatorInput.feature_vocabulary) &&
    arraysEqual(
      generatorInput.feature_vocabulary,
      ONTOLOGY_PIPELINE_FEATURE_VOCABULARY,
    ) &&
    coverageTargetsAreFrozen(generatorInput.coverage_targets) &&
    frozenOntologyCoverageSourceHintsMatchIdentity({
      corpus_release_id: corpus.corpus_release_id,
      corpus_hash: corpus.corpus_hash,
      license_class: corpus.license_class,
      public_capable: corpus.public_capable,
    }, generatorInput.coverage_source_hints) &&
    predecessorReferenceIsValid(
      generatorInput.active_machine_predecessor,
    ) &&
    policy.ontology_schema_version === M7_SCHEMA_VERSION &&
    policy.feature_policy_version === NATAL_FEATURE_POLICY_VERSION &&
    policy.compiler_policy_version === ONTOLOGY_COMPILER_POLICY_VERSION &&
    policy.regression_policy_version === ONTOLOGY_REGRESSION_POLICY_VERSION &&
    policy.prohibited_claim_policy_version ===
      ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION &&
    policy.selection_policy_id === PATTERN_SELECTION_POLICY_ID &&
    policy.selection_policy_version === PATTERN_SELECTION_POLICY_VERSION &&
    policy.validation_policy_id === PATTERN_VALIDATION_POLICY_ID &&
    policy.validation_policy_version === PATTERN_VALIDATION_POLICY_VERSION &&
    Array.isArray(policy.prohibited_claims) &&
    arraysEqual(policy.prohibited_claims, ONTOLOGY_PROHIBITED_CLAIMS);
}

async function loadExecutionContext(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  configuration: OntologyPipelineConfiguration,
): Promise<LoadedExecutionContext> {
  const row = await env.DB.prepare(
    `SELECT run_id, corpus_release_id, corpus_hash,
            candidate_ontology_version, configuration_json,
            configuration_hash, candidate_hash, compilation_report_hash,
            evaluation_report_hash, regression_report_hash, bundle_hash
     FROM pattern_ontology_pipeline_runs
     WHERE run_id = ? AND stage = ? AND stage_generation = ?
       AND stage_cursor = ? AND stage_attempt = ? AND claim_token = ?`,
  ).bind(
    claim.runId,
    claim.stage,
    claim.stageGeneration,
    claim.stageCursor,
    claim.stageAttempt,
    claim.claimToken,
  ).first<OntologyPipelineExecutionRow>();
  if (!row) terminal("execution_error");
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.configuration_json);
  } catch {
    terminal("configuration_invalid");
  }
  if (
    !isRecord(parsed) ||
    canonicalJson(parsed) !== row.configuration_json ||
    await contentHash(row.configuration_json) !== row.configuration_hash ||
    !commandIsExecutable(parsed, row, configuration)
  ) {
    terminal("configuration_invalid");
  }
  return { row, command: parsed, configuration };
}

async function readFrozenCorpus(
  env: Env,
  command: OntologyPipelineCommand,
): Promise<RegisteredOntologyCorpus> {
  const corpus = await readRegisteredOntologyCorpus(
    env,
    command.corpus.corpus_release_id,
  );
  if (
    corpus.release.corpus_release_id !== command.corpus.corpus_release_id ||
    corpus.release.corpus_hash !== command.corpus.corpus_hash ||
    corpus.release.locale.length === 0 ||
    corpus.objectKey !== command.corpus.object_key ||
    corpus.licenseClass !== command.corpus.license_class ||
    corpus.publicCapable !== command.corpus.public_capable
  ) {
    terminal("corpus_hash_mismatch");
  }
  return corpus;
}

function pinFromCommand(command: OntologyPipelineCommand): OntologyPipelineConfigPin {
  return {
    generator_model: command.generator.model,
    generator_reasoning: command.generator.reasoning,
    generator_prompt_version: command.generator.prompt_version,
    generator_max_output_tokens: command.generator.max_output_tokens,
    evaluator_model: command.evaluator.model,
    evaluator_reasoning: command.evaluator.reasoning,
    evaluator_prompt_version: command.evaluator.prompt_version,
    evaluator_max_output_tokens: command.evaluator.max_output_tokens,
    input_max_bytes: command.input_max_bytes,
  };
}

function artifactCoordinate(
  claim: ClaimedOntologyPipelineRun,
  artifactClass: OntologyPipelineArtifactClass,
): OntologyPipelineArtifactCoordinate {
  if (
    claim.stage !== "generating" &&
    claim.stage !== "compiling" &&
    claim.stage !== "evaluating" &&
    claim.stage !== "regressing" &&
    claim.stage !== "signing" &&
    claim.stage !== "ingesting"
  ) {
    terminal("execution_error");
  }
  return {
    runId: claim.runId,
    stage: claim.stage,
    stageGeneration: claim.stageGeneration,
    stageAttempt: claim.stageAttempt,
    artifactClass,
  };
}

function historicalCoordinate(
  runId: string,
  stage: "generating" | "compiling" | "evaluating" | "regressing" | "signing" | "ingesting",
  stageGeneration: number,
  stageAttempt: number,
  artifactClass: OntologyPipelineArtifactClass,
): OntologyPipelineArtifactCoordinate {
  return { runId, stage, stageGeneration, stageAttempt, artifactClass };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    terminal("artifact_integrity_failed");
  }
}

function parseCanonicalChunk(bytes: Uint8Array): OntologyGenerationChunk {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("artifact_integrity_failed");
  }
  if (!isOntologyGenerationChunk(parsed) || canonicalJson(parsed) !== text) {
    terminal("artifact_integrity_failed");
  }
  return parsed;
}

function parseCanonicalVerdict(bytes: Uint8Array): OntologyRuleVerdict {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("artifact_integrity_failed");
  }
  if (!isOntologyRuleVerdict(parsed) || canonicalJson(parsed) !== text) {
    terminal("artifact_integrity_failed");
  }
  return parsed;
}

function parseRawProviderValue<T>(
  bytes: Uint8Array,
  guard: (value: unknown) => value is T,
): T {
  const raw = decodeUtf8(bytes);
  const jsonText = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let envelope: unknown;
  try {
    envelope = JSON.parse(jsonText);
  } catch {
    terminal("provider_response_invalid");
  }
  const extracted = extractOutputText(envelope);
  if (!extracted.ok) terminal("provider_response_invalid");
  let value: unknown;
  try {
    value = JSON.parse(extracted.text);
  } catch {
    terminal("provider_response_invalid");
  }
  if (!guard(value)) terminal("provider_response_invalid");
  return value;
}

function generationPolicy(command: OntologyPipelineCommand) {
  return {
    ontology_schema_version: command.policy.ontology_schema_version,
    feature_policy_version: command.policy.feature_policy_version,
    compiler_policy_version: command.policy.compiler_policy_version,
    regression_policy_version: command.policy.regression_policy_version,
    prohibited_claim_policy_version:
      command.policy.prohibited_claim_policy_version,
    regression_minimum_pass_rate: command.regression.minimum_pass_rate,
    prohibited_claims: command.policy.prohibited_claims,
  };
}

function providerMetadataMatches(
  outcome: Extract<OntologyPassOutcome<unknown>, { ok: true }>,
  pass: "generator" | "evaluator",
  command: OntologyPipelineCommand,
): boolean {
  const expected = pass === "generator" ? command.generator : command.evaluator;
  return outcome.metadata.provider === "openai" &&
    outcome.metadata.pass === pass &&
    outcome.metadata.model === expected.model &&
    outcome.metadata.prompt_version === expected.prompt_version &&
    typeof outcome.metadata.provider_request_id === "string" &&
    outcome.metadata.provider_request_id.length > 0 &&
    Number.isSafeInteger(outcome.metadata.input_tokens) &&
    outcome.metadata.input_tokens >= 0 &&
    Number.isSafeInteger(outcome.metadata.output_tokens) &&
    outcome.metadata.output_tokens >= 0 &&
    CONTENT_HASH.test(outcome.metadata.provider_response_hash);
}

async function putArtifact(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  artifactClass: OntologyPipelineArtifactClass,
  bytes: string,
  clock: () => Date,
) {
  return putOntologyPipelineArtifact(
    env,
    artifactCoordinate(claim, artifactClass),
    textEncoder.encode(bytes),
    claim,
    clock(),
  );
}

async function assertProviderRunCapacity(
  env: Pick<Env, "DB">,
  claim: ClaimedOntologyPipelineRun,
  pass: "generator" | "evaluator",
  limit: number,
): Promise<void> {
  const artifactClass = pass === "generator"
    ? "generator_request"
    : "evaluator_request";
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS request_count
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND artifact_class = ?`,
  ).bind(claim.runId, artifactClass).first<{ request_count: number }>();
  if (
    !row ||
    !Number.isSafeInteger(row.request_count) ||
    row.request_count >= limit
  ) {
    terminal("attempts_exhausted");
  }
}

async function readCurrentArtifact(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  artifactClass: OntologyPipelineArtifactClass,
) {
  return readOntologyPipelineArtifact(
    env,
    artifactCoordinate(claim, artifactClass),
    { claim },
  );
}

async function nudgeOutbox(env: Env, now: Date): Promise<void> {
  try {
    await dispatchUndispatchedOntologyPipelineRuns(env, now);
  } catch {
    // The committed D1 outbox remains the authority. Scheduled repair owns a
    // failed or uncertain Queue send.
  }
}

async function advanceStage(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  nextStage:
    | "corpus_reading"
    | "generating"
    | "compiling"
    | "evaluating"
    | "regressing"
    | "signing"
    | "ingesting",
  evidence: Parameters<typeof advanceOntologyPipelineStage>[3],
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const now = clock();
  if (!await advanceOntologyPipelineStage(env, claim, nextStage, evidence, now)) {
    return { status: "duplicate" };
  }
  await nudgeOutbox(env, now);
  return { status: "advanced" };
}

async function advanceCursor(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const now = clock();
  if (!await advanceOntologyPipelineCursor(env, claim, now)) {
    return { status: "duplicate" };
  }
  await nudgeOutbox(env, now);
  return { status: "advanced" };
}

function providerFailureClass(
  outcome: Extract<OntologyPassOutcome<unknown>, { ok: false }>,
): { failureClass: OntologyPipelineFailureClass; retryable: boolean } {
  if (outcome.code === "publisher_budget_exhausted") {
    return { failureClass: "provider_budget_exhausted", retryable: false };
  }
  if (outcome.code === "publisher_run_call_limit_exhausted") {
    return { failureClass: "attempts_exhausted", retryable: false };
  }
  if (outcome.code === "publisher_claim_unavailable") {
    return { failureClass: "provider_unavailable", retryable: true };
  }
  if (outcome.code === "publisher_refused") {
    return { failureClass: "provider_refusal", retryable: false };
  }
  if (
    outcome.code === "publisher_auth_failed" ||
    outcome.code === "publisher_model_unavailable"
  ) {
    return { failureClass: "provider_not_configured", retryable: false };
  }
  if (outcome.code === "publisher_output_invalid") {
    return { failureClass: "provider_response_invalid", retryable: true };
  }
  return {
    failureClass: outcome.safe_detail_code === "request_timeout"
      ? "provider_timeout"
      : "provider_unavailable",
    retryable: true,
  };
}

async function handleProviderFailure(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  outcome: Extract<OntologyPassOutcome<unknown>, { ok: false }>,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const mapped = providerFailureClass(outcome);
  if (!mapped.retryable) terminal(mapped.failureClass);
  if (claim.stageAttempt + 1 >= MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS) {
    terminal("attempts_exhausted");
  }
  const delaySeconds = Math.max(
    PROVIDER_RETRY_DELAY_SECONDS,
    outcome.retry_after_seconds ?? 0,
  );
  const availableAt = new Date(clock().getTime() + delaySeconds * 1_000);
  if (!await retryOntologyPipelineStage(env, claim, availableAt)) {
    return { status: "duplicate" };
  }
  return { status: "rescheduled", retryAfterSeconds: delaySeconds };
}

async function rescheduleAmbiguousProviderRequest(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  if (claim.stageAttempt + 1 >= MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS) {
    terminal("attempts_exhausted");
  }
  const availableAt = new Date(
    clock().getTime() + PROVIDER_RETRY_DELAY_SECONDS * 1_000,
  );
  if (!await retryOntologyPipelineStage(env, claim, availableAt)) {
    return { status: "duplicate" };
  }
  return {
    status: "rescheduled",
    retryAfterSeconds: PROVIDER_RETRY_DELAY_SECONDS,
  };
}

async function loadCandidateChunkRange(
  env: Env,
  runId: string,
  expectedCount: number,
  firstGeneration: number,
  lastGeneration: number,
): Promise<LoadedCandidateChunk[]> {
  if (
    expectedCount < 0 ||
    firstGeneration !== 2 ||
    lastGeneration !== firstGeneration + expectedCount - 1
  ) {
    terminal("candidate_invalid");
  }
  if (expectedCount === 0) return [];
  const { results } = await env.DB.prepare(
    `SELECT stage_generation, stage_attempt, plaintext_sha256
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'generating'
       AND artifact_class = 'candidate_chunk' AND deleted_at IS NULL
       AND stage_generation >= ? AND stage_generation <= ?
     ORDER BY stage_generation, stage_attempt`,
  ).bind(runId, firstGeneration, lastGeneration).all<CandidateChunkArtifactRow>();
  if (results.length !== expectedCount) terminal("candidate_invalid");

  const chunks: LoadedCandidateChunk[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const row = results[index]!;
    const generation = firstGeneration + index;
    if (row.stage_generation !== generation) terminal("candidate_invalid");
    const stored = await readOntologyPipelineArtifact(
      env,
      historicalCoordinate(
        runId,
        "generating",
        row.stage_generation,
        row.stage_attempt,
        "candidate_chunk",
      ),
    );
    if (
      !stored ||
      stored.artifact.plaintextSha256 !== row.plaintext_sha256
    ) {
      terminal("artifact_integrity_failed");
    }
    chunks.push({
      chunk: parseCanonicalChunk(stored.plaintext),
      plaintextHash: row.plaintext_sha256,
      stageGeneration: row.stage_generation,
      stageAttempt: row.stage_attempt,
    });
  }
  return chunks;
}

async function loadCandidateChunks(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
): Promise<LoadedCandidateChunk[]> {
  const expectedCount = claim.stage === "generating"
    ? claim.stageCursor + 1
    : claim.stageGeneration - 2;
  const lastGeneration = claim.stage === "generating"
    ? claim.stageGeneration
    : claim.stageGeneration - 1;
  return loadCandidateChunkRange(
    env,
    claim.runId,
    expectedCount,
    2,
    lastGeneration,
  );
}

interface AcceptedGenerationProgress {
  chunks: LoadedCandidateChunk[];
  records: PatternOntologyRecord[];
  orderedRecordIds: string[];
}

interface CoverageDeficit {
  feature_class: OntologyPipelineCommand["generator_input"]["coverage_targets"][number]["feature_class"];
  minimum_source_supported: number;
  minimum_total: number;
}

async function loadAcceptedGenerationProgress(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  command: OntologyPipelineCommand,
): Promise<AcceptedGenerationProgress> {
  if (
    claim.stage !== "generating" ||
    claim.stageGeneration !== claim.stageCursor + 2 ||
    claim.stageCursor >= command.limits.maximum_generation_chunks
  ) {
    terminal("candidate_invalid");
  }
  const chunks = await loadCandidateChunkRange(
    env,
    claim.runId,
    claim.stageCursor,
    2,
    claim.stageGeneration - 1,
  );
  if (chunks.some(({ chunk }) => chunk.complete)) {
    terminal("candidate_invalid");
  }
  const records = chunks.flatMap(({ chunk }) => chunk.records);
  if (records.length > command.limits.maximum_candidate_records) {
    terminal("candidate_invalid");
  }
  const orderedRecordIds: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) terminal("candidate_invalid");
    seen.add(record.id);
    orderedRecordIds.push(record.id);
  }
  return { chunks, records, orderedRecordIds };
}

function coverageDeficits(
  command: OntologyPipelineCommand,
  acceptedRecords: readonly PatternOntologyRecord[],
): CoverageDeficit[] {
  return command.generator_input.coverage_targets.map((target) => {
    const matching = acceptedRecords.filter(
      (record) => record.feature_predicate.type === target.feature_class,
    );
    const sourceSupported = matching.filter(
      (record) => record.meaning_class === "source_supported",
    );
    const minimumTotal = Math.max(0, target.minimum_total - matching.length);
    const minimumSourceSupported = Math.max(
      0,
      target.minimum_source_supported - sourceSupported.length,
    );
    return {
      feature_class: target.feature_class,
      minimum_source_supported: minimumSourceSupported,
      minimum_total: minimumTotal,
    };
  });
}

function remainingCoverageTargets(
  command: OntologyPipelineCommand,
  acceptedRecords: readonly PatternOntologyRecord[],
): CoverageDeficit[] {
  return coverageDeficits(command, acceptedRecords).filter(
    (deficit) =>
      deficit.minimum_total > 0 || deficit.minimum_source_supported > 0,
  );
}

function coverageStrictlyDecreases(
  before: readonly CoverageDeficit[],
  after: readonly CoverageDeficit[],
): boolean {
  if (before.length !== after.length) return false;
  let decreased = false;
  for (let index = 0; index < before.length; index += 1) {
    const prior = before[index]!;
    const next = after[index]!;
    if (prior.feature_class !== next.feature_class) return false;
    if (
      next.minimum_total > prior.minimum_total ||
      next.minimum_source_supported > prior.minimum_source_supported
    ) {
      return false;
    }
    if (
      next.minimum_total < prior.minimum_total ||
      next.minimum_source_supported < prior.minimum_source_supported
    ) {
      decreased = true;
    }
  }
  return decreased;
}

function generatorContinuation(
  command: OntologyPipelineCommand,
  progress: AcceptedGenerationProgress,
) {
  if (progress.chunks.length === 0) return null;
  return {
    chunk_index: progress.chunks.length,
    maximum_generation_chunks: command.limits.maximum_generation_chunks,
    maximum_candidate_records: command.limits.maximum_candidate_records,
    maximum_evaluator_calls: command.limits.maximum_evaluator_calls,
    maximum_candidate_bytes: command.limits.maximum_candidate_bytes,
    accepted_ordered_chunk_plaintext_hashes: progress.chunks.map(
      (chunk) => chunk.plaintextHash,
    ),
    accepted_ordered_record_ids: progress.orderedRecordIds,
    remaining_coverage_targets: remainingCoverageTargets(
      command,
      progress.records,
    ),
  };
}

function validateCurrentChunk(
  chunk: OntologyGenerationChunk,
  progress: AcceptedGenerationProgress,
  command: OntologyPipelineCommand,
): void {
  if (
    progress.records.length + chunk.records.length >
      command.limits.maximum_candidate_records
  ) {
    terminal("candidate_invalid");
  }
  const ids = new Set(progress.orderedRecordIds);
  for (const record of chunk.records) {
    if (ids.has(record.id)) terminal("candidate_invalid");
    ids.add(record.id);
  }
}

async function materializeCandidateRelease(
  command: OntologyPipelineCommand,
  corpus: RegisteredOntologyCorpus,
  records: PatternOntologyRecord[],
): Promise<{ release: PatternOntologyRelease; canonicalBytes: string }> {
  const release: PatternOntologyRelease = {
    schema_version: M7_SCHEMA_VERSION,
    ontology_version: command.candidate_ontology_version,
    bundle_hash: `sha256:${"0".repeat(64)}`,
    corpus_release_hash: command.corpus.corpus_hash,
    locale: corpus.release.locale,
    status: "candidate",
    records,
    // compileOntologyRelease's unchanged contract requires a passing verdict
    // on the structurally complete candidate. These bytes remain encrypted and
    // unsigned; the independent evidence report, regression, and signer later
    // replace this pre-gate scaffold before ingestion can be authorized.
    evaluation: {
      schema_version: M7_SCHEMA_VERSION,
      ontology_version: command.candidate_ontology_version,
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: false,
      unevaluated_fixture_count: 0,
    },
    provenance: { origin: "machine_pipeline" },
  };
  release.bundle_hash = await computeOntologyBundleHash(release);
  return { release, canonicalBytes: canonicalJson(release) };
}

async function buildCompleteCandidate(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  command: OntologyPipelineCommand,
  corpus: RegisteredOntologyCorpus,
): Promise<{ release: PatternOntologyRelease; canonicalBytes: string; candidateHash: string }> {
  const loadedChunks = await loadCandidateChunks(env, claim);
  const chunks = loadedChunks.map(({ chunk }) => chunk);
  if (
    chunks.some((chunk, index) =>
      chunk.complete !== (index === chunks.length - 1))
  ) {
    terminal("candidate_invalid");
  }
  const records = chunks.flatMap((chunk) => chunk.records);
  if (records.length === 0) terminal("candidate_invalid");
  const { release, canonicalBytes } = await materializeCandidateRelease(
    command,
    corpus,
    records,
  );
  const validation = validateOntologyCandidateRelease(release, {
    canonicalBytes,
    corpusLocale: corpus.release.locale,
    permittedFragmentIds: new Set(corpus.fragmentIndex.keys()),
    fragments: corpus.fragmentIndex,
    coverageTargets: command.generator_input.coverage_targets,
    maximumCandidateRecords: command.limits.maximum_candidate_records,
    maximumCandidateBytes: command.limits.maximum_candidate_bytes,
  });
  if (!validation.ok) {
    safeLog({
      event: "ontology_candidate_rejected",
      reason: validation.safe_detail_code,
    });
    terminal("candidate_invalid");
  }
  return {
    release: validation.release,
    canonicalBytes,
    candidateHash: await contentHash(canonicalBytes),
  };
}

async function executeGenerating(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  publisher: OntologyPublisher,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const corpus = await readFrozenCorpus(env, context.command);
  const progress = await loadAcceptedGenerationProgress(
    env,
    claim,
    context.command,
  );
  let chunk: OntologyGenerationChunk | null = null;

  // Parsed output is the cheapest exact adoption. A response-only torn write
  // is the next probe and is deterministically narrowed below. Both precede
  // request construction, accounting, and the publisher's sole fetch.
  const adoptedChunk = await readCurrentArtifact(env, claim, "candidate_chunk");
  if (adoptedChunk) {
    chunk = parseCanonicalChunk(adoptedChunk.plaintext);
  } else {
    const adoptedResponse = await readCurrentArtifact(
      env,
      claim,
      "generator_response",
    );
    if (adoptedResponse) {
      chunk = parseRawProviderValue(
        adoptedResponse.plaintext,
        isOntologyGenerationChunk,
      );
    }
  }

  if (!chunk) {
    const ambiguousRequest = await readCurrentArtifact(
      env,
      claim,
      "generator_request",
    );
    if (ambiguousRequest) {
      return await rescheduleAmbiguousProviderRequest(env, claim, clock);
    }
    await assertProviderRunCapacity(
      env,
      claim,
      "generator",
      context.command.limits.maximum_generation_chunks,
    );
    const predecessor = await loadOntologyPipelinePredecessor(
      env,
      context.command.generator_input.active_machine_predecessor,
    );
    const packet = buildOntologyGeneratorPacket({
      corpus,
      featureVocabulary: context.command.generator_input.feature_vocabulary,
      coverageTargets: context.command.generator_input.coverage_targets,
      policy: generationPolicy(context.command),
      activeMachinePredecessor: predecessor,
      continuation: generatorContinuation(context.command, progress),
      coverageSourceHints:
        context.command.generator_input.coverage_source_hints,
    }, pinFromCommand(context.command));
    if (!packet.ok) terminal("candidate_invalid");
    const pin = pinFromCommand(context.command);
    const requestBody = canonicalJson(
      buildOntologyGeneratorResponsesRequest(packet.serialized, pin),
    );
    await putArtifact(env, claim, "generator_request", requestBody, clock);
    const outcome = await publisher.generate(packet, {
      requestId: `opreq_${crypto.randomUUID()}`,
      timeoutMs: context.command.generator.timeout_ms,
      configuration: pin,
      requestBody,
      reserve: createClaimedOntologyProviderCallReservation(
        env,
        claim,
        {
          expectedPass: "generator",
          dailyLimit: context.command.daily_provider_call_limit,
          runLimit: context.command.limits.maximum_generation_chunks,
          timeoutMs: context.command.generator.timeout_ms,
          now: clock,
        },
      ),
    });
    if (!outcome.ok) {
      return await handleProviderFailure(env, claim, outcome, clock);
    }
    if (!providerMetadataMatches(outcome, "generator", context.command)) {
      terminal("provider_response_invalid");
    }
    await putArtifact(env, claim, "generator_response", outcome.raw, clock);
    const storedValue = parseRawProviderValue(
      textEncoder.encode(outcome.raw),
      isOntologyGenerationChunk,
    );
    if (canonicalJson(storedValue) !== canonicalJson(outcome.value)) {
      terminal("provider_response_invalid");
    }
    chunk = storedValue;
  }

  validateCurrentChunk(chunk, progress, context.command);
  const preChunkCoverageDeficits = coverageDeficits(
    context.command,
    progress.records,
  );
  const postChunkCoverageDeficits = coverageDeficits(
    context.command,
    [...progress.records, ...chunk.records],
  );
  const remainingFeatureClasses = postChunkCoverageDeficits
    .filter((deficit) =>
      deficit.minimum_total > 0 || deficit.minimum_source_supported > 0)
    .map((deficit) => deficit.feature_class);
  // `complete` is a provider declaration, not an authority boundary. If the
  // immutable coverage targets prove work remains, persist this otherwise
  // valid chunk as an incomplete predecessor and continue within the frozen
  // chunk/call ceilings. The exact provider response remains preserved in its
  // response artifact; only the pipeline's accepted chunk state is narrowed.
  if (
    chunk.complete &&
    remainingCoverageTargets(
      context.command,
      [...progress.records, ...chunk.records],
    ).length > 0
  ) {
    chunk = { ...chunk, complete: false };
  }
  const prospectiveCandidate = await materializeCandidateRelease(
    context.command,
    corpus,
    [...progress.records, ...chunk.records],
  );
  if (
    textEncoder.encode(prospectiveCandidate.canonicalBytes).byteLength >
      context.command.limits.maximum_candidate_bytes
  ) {
    terminal("candidate_invalid");
  }
  const chunkArtifact = await putArtifact(
    env,
    claim,
    "candidate_chunk",
    canonicalJson(chunk),
    clock,
  );
  if (!chunk.complete) {
    if (
      preChunkCoverageDeficits.some((deficit) =>
        deficit.minimum_total > 0 || deficit.minimum_source_supported > 0) &&
      !coverageStrictlyDecreases(
        preChunkCoverageDeficits,
        postChunkCoverageDeficits,
      )
    ) {
      safeLog({
        event: "ontology_generation_stalled",
        safe_detail_code: "coverage_no_progress",
        remaining_feature_classes: remainingFeatureClasses,
      });
      terminal("candidate_invalid");
    }
    if (
      claim.stageCursor + 1 >=
        context.command.limits.maximum_generation_chunks
    ) {
      safeLog({
        event: "ontology_generation_stalled",
        safe_detail_code: "generation_chunk_limit_exhausted",
        remaining_feature_classes: remainingFeatureClasses,
      });
      terminal("candidate_invalid");
    }
    return await advanceCursor(env, claim, clock);
  }

  const candidate = await buildCompleteCandidate(
    env,
    claim,
    context.command,
    corpus,
  );
  if (chunkArtifact.artifact.plaintextSha256.length === 0) {
    terminal("artifact_integrity_failed");
  }
  return await advanceStage(
    env,
    claim,
    "compiling",
    { candidateHash: candidate.candidateHash },
    clock,
  );
}

async function executeCompiling(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const corpus = await readFrozenCorpus(env, context.command);
  const candidate = await buildCompleteCandidate(
    env,
    claim,
    context.command,
    corpus,
  );
  if (
    !context.row.candidate_hash ||
    context.row.candidate_hash !== candidate.candidateHash
  ) {
    terminal("candidate_invalid");
  }
  const storedCandidate = await putArtifact(
    env,
    claim,
    "candidate_release",
    candidate.canonicalBytes,
    clock,
  );
  if (storedCandidate.artifact.plaintextSha256 !== context.row.candidate_hash) {
    terminal("artifact_integrity_failed");
  }

  // This is the existing compiler without normalization, filtering, fallback,
  // or record dropping. Its ordered closed finding codes are encrypted below.
  const compilerResult = compileOntologyRelease(candidate.release);
  const reportBytes = canonicalJson({
    candidate_plaintext_hash: candidate.candidateHash,
    compiler_passed: compilerResult.ok,
    compiler_policy_version: context.command.policy.compiler_policy_version,
    finding_codes: compilerResult.failures.map((failure) => failure.code),
    ontology_version: context.command.candidate_ontology_version,
    schema_version: M7_SCHEMA_VERSION,
  });
  const report = await putArtifact(
    env,
    claim,
    "compilation_report",
    reportBytes,
    clock,
  );
  if (!compilerResult.ok) terminal("compilation_failed");
  return await advanceStage(
    env,
    claim,
    "evaluating",
    { compilationReportHash: report.artifact.plaintextSha256 },
    clock,
  );
}

async function loadSingleCompilingArtifact(
  env: Env,
  runId: string,
  artifactClass: "candidate_release" | "compilation_report",
): Promise<{
  plaintext: Uint8Array;
  plaintextHash: string;
  stageGeneration: number;
}> {
  const { results } = await env.DB.prepare(
    `SELECT stage, stage_generation, stage_attempt, plaintext_sha256
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'compiling' AND artifact_class = ?
       AND deleted_at IS NULL
     ORDER BY stage_generation, stage_attempt`,
  ).bind(runId, artifactClass).all<SingleArtifactRow>();
  if (results.length !== 1) terminal("candidate_invalid");
  const row = results[0]!;
  const stored = await readOntologyPipelineArtifact(
    env,
    historicalCoordinate(
      runId,
      "compiling",
      row.stage_generation,
      row.stage_attempt,
      artifactClass,
    ),
  );
  if (!stored || stored.artifact.plaintextSha256 !== row.plaintext_sha256) {
    terminal("artifact_integrity_failed");
  }
  return {
    plaintext: stored.plaintext,
    plaintextHash: row.plaintext_sha256,
    stageGeneration: row.stage_generation,
  };
}

async function parseCandidateRelease(
  bytes: Uint8Array,
  command: OntologyPipelineCommand,
  corpus: RegisteredOntologyCorpus,
): Promise<PatternOntologyRelease> {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("candidate_invalid");
  }
  const validation = validateOntologyCandidateRelease(parsed, {
    canonicalBytes: text,
    corpusLocale: corpus.release.locale,
    permittedFragmentIds: new Set(corpus.fragmentIndex.keys()),
    fragments: corpus.fragmentIndex,
    coverageTargets: command.generator_input.coverage_targets,
    maximumCandidateRecords: command.limits.maximum_candidate_records,
    maximumCandidateBytes: command.limits.maximum_candidate_bytes,
  });
  if (!validation.ok) terminal("candidate_invalid");
  const release = validation.release;
  if (
    release.schema_version !== M7_SCHEMA_VERSION ||
    release.ontology_version !== command.candidate_ontology_version ||
    release.corpus_release_hash !== command.corpus.corpus_hash ||
    release.locale !== corpus.release.locale ||
    release.status !== "candidate"
  ) {
    terminal("candidate_invalid");
  }
  const evaluation = release.evaluation;
  if (
    !hasExactKeys(evaluation, [
      "compiler_passed",
      "evaluator_passed",
      "ontology_version",
      "regression_passed",
      "schema_version",
      "unevaluated_fixture_count",
      "verdict",
    ]) ||
    evaluation.schema_version !== M7_SCHEMA_VERSION ||
    evaluation.ontology_version !== release.ontology_version ||
    evaluation.verdict !== "pass" ||
    evaluation.compiler_passed !== true ||
    evaluation.evaluator_passed !== true ||
    evaluation.regression_passed !== false ||
    evaluation.unevaluated_fixture_count !== 0
  ) {
    terminal("candidate_invalid");
  }
  const provenance = release.provenance;
  if (
    !provenance ||
    !hasExactKeys(provenance, ["origin"]) ||
    provenance.origin !== "machine_pipeline"
  ) {
    terminal("candidate_invalid");
  }
  if (release.bundle_hash !== await computeOntologyBundleHash(release)) {
    terminal("candidate_invalid");
  }
  const compiled = compileOntologyRelease(release);
  if (!compiled.ok) terminal("candidate_invalid");
  return release;
}

async function orderedVerdictEvidence(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  records: readonly PatternOntologyRecord[],
  evaluationStartGeneration: number,
): Promise<Array<{ ruleId: string; verdictHash: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT stage_generation, stage_attempt
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'evaluating'
       AND artifact_class = 'evaluator_verdict' AND deleted_at IS NULL
     ORDER BY stage_generation, stage_attempt`,
  ).bind(claim.runId).all<VerdictArtifactRow>();
  if (results.length !== records.length) terminal("candidate_invalid");
  const evidence: Array<{ ruleId: string; verdictHash: string }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const row = results[index]!;
    if (row.stage_generation !== evaluationStartGeneration + index) {
      terminal("candidate_invalid");
    }
    const stored = await readOntologyPipelineArtifact(
      env,
      historicalCoordinate(
        claim.runId,
        "evaluating",
        row.stage_generation,
        row.stage_attempt,
        "evaluator_verdict",
      ),
    );
    if (!stored) terminal("artifact_integrity_failed");
    const verdict = parseCanonicalVerdict(stored.plaintext);
    const assessment = assessOntologyRuleVerdict(records[index]!.id, verdict);
    if (!assessment.ok || assessment.rejected) terminal("evaluation_rejected");
    evidence.push({
      ruleId: records[index]!.id,
      verdictHash: stored.artifact.plaintextSha256,
    });
  }
  return evidence;
}

async function executeEvaluating(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  publisher: OntologyPublisher,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const corpus = await readFrozenCorpus(env, context.command);
  const candidateArtifact = await loadSingleCompilingArtifact(
    env,
    claim.runId,
    "candidate_release",
  );
  const compilationArtifact = await loadSingleCompilingArtifact(
    env,
    claim.runId,
    "compilation_report",
  );
  if (
    candidateArtifact.plaintextHash !== context.row.candidate_hash ||
    compilationArtifact.plaintextHash !== context.row.compilation_report_hash
  ) {
    terminal("candidate_invalid");
  }
  const candidate = await parseCandidateRelease(
    candidateArtifact.plaintext,
    context.command,
    corpus,
  );
  const evaluationStartGeneration = claim.stageGeneration - claim.stageCursor;
  if (
    candidateArtifact.stageGeneration + 1 !== evaluationStartGeneration ||
    claim.stageCursor >= candidate.records.length ||
    candidate.records.length > context.command.limits.maximum_evaluator_calls ||
    claim.stageCursor >= context.command.limits.maximum_evaluator_calls
  ) {
    terminal("candidate_invalid");
  }
  const rule = candidate.records[claim.stageCursor]!;
  const summaries = buildOntologyCompilerSummaries(candidate.records);
  const compilerSummary = summaries[claim.stageCursor]!;
  const byId = new Map(candidate.records.map((record) => [record.id, record]));
  const citedMeanings = compilerSummary.source_meaning_ids.map((id) => {
    const meaning = byId.get(id);
    if (!meaning) terminal("candidate_invalid");
    return meaning;
  });

  let verdict: OntologyRuleVerdict | null = null;
  const adoptedVerdict = await readCurrentArtifact(
    env,
    claim,
    "evaluator_verdict",
  );
  if (adoptedVerdict) {
    verdict = parseCanonicalVerdict(adoptedVerdict.plaintext);
  } else {
    const adoptedResponse = await readCurrentArtifact(
      env,
      claim,
      "evaluator_response",
    );
    if (adoptedResponse) {
      verdict = parseRawProviderValue(
        adoptedResponse.plaintext,
        isOntologyRuleVerdict,
      );
    }
  }

  if (!verdict) {
    const ambiguousRequest = await readCurrentArtifact(
      env,
      claim,
      "evaluator_request",
    );
    if (ambiguousRequest) {
      return await rescheduleAmbiguousProviderRequest(env, claim, clock);
    }
    await assertProviderRunCapacity(
      env,
      claim,
      "evaluator",
      context.command.limits.maximum_evaluator_calls,
    );
    const packet = buildOntologyEvaluatorPacket({
      corpus,
      rule,
      citedMeanings,
      compilerSummary,
    }, pinFromCommand(context.command));
    if (!packet.ok) terminal("candidate_invalid");
    const pin = pinFromCommand(context.command);
    const requestBody = canonicalJson(
      buildOntologyEvaluatorResponsesRequest(packet.serialized, pin),
    );
    await putArtifact(env, claim, "evaluator_request", requestBody, clock);
    const outcome = await publisher.evaluate(packet, {
      requestId: `opreq_${crypto.randomUUID()}`,
      timeoutMs: context.command.evaluator.timeout_ms,
      configuration: pin,
      requestBody,
      reserve: createClaimedOntologyProviderCallReservation(
        env,
        claim,
        {
          expectedPass: "evaluator",
          dailyLimit: context.command.daily_provider_call_limit,
          runLimit: context.command.limits.maximum_evaluator_calls,
          timeoutMs: context.command.evaluator.timeout_ms,
          now: clock,
        },
      ),
    });
    if (!outcome.ok) {
      return await handleProviderFailure(env, claim, outcome, clock);
    }
    if (!providerMetadataMatches(outcome, "evaluator", context.command)) {
      terminal("provider_response_invalid");
    }
    await putArtifact(env, claim, "evaluator_response", outcome.raw, clock);
    const storedValue = parseRawProviderValue(
      textEncoder.encode(outcome.raw),
      isOntologyRuleVerdict,
    );
    if (canonicalJson(storedValue) !== canonicalJson(outcome.value)) {
      terminal("provider_response_invalid");
    }
    verdict = storedValue;
  }

  const assessment = assessOntologyRuleVerdict(rule.id, verdict);
  if (!assessment.ok) terminal("provider_response_invalid");
  const verdictArtifact = await putArtifact(
    env,
    claim,
    "evaluator_verdict",
    canonicalJson(verdict),
    clock,
  );
  if (assessment.rejected) terminal("evaluation_rejected");

  const finalRuleIndex = candidate.records.length - 1;
  if (claim.stageCursor !== finalRuleIndex) {
    return await advanceCursor(env, claim, clock);
  }
  if (verdictArtifact.artifact.plaintextSha256.length === 0) {
    terminal("artifact_integrity_failed");
  }
  const verdicts = await orderedVerdictEvidence(
    env,
    claim,
    candidate.records,
    evaluationStartGeneration,
  );
  const report = createCanonicalOntologyEvaluationReport({
    ontologyVersion: context.command.candidate_ontology_version,
    configurationHash: context.row.configuration_hash,
    corpus: {
      corpusReleaseId: context.command.corpus.corpus_release_id,
      corpusHash: context.command.corpus.corpus_hash,
      locale: corpus.release.locale,
      licenseClass: context.command.corpus.license_class,
      publicCapable: context.command.corpus.public_capable,
      objectKey: context.command.corpus.object_key,
    },
    candidateHash: candidateArtifact.plaintextHash,
    compiler: {
      passed: true,
      policyVersion: context.command.policy.compiler_policy_version,
      reportHash: compilationArtifact.plaintextHash,
    },
    orderedVerdicts: verdicts,
    generator: {
      model: context.command.generator.model,
      reasoning: context.command.generator.reasoning,
      promptVersion: context.command.generator.prompt_version,
      timeoutMs: context.command.generator.timeout_ms,
      maxOutputTokens: context.command.generator.max_output_tokens,
    },
    evaluator: {
      model: context.command.evaluator.model,
      reasoning: context.command.evaluator.reasoning,
      promptVersion: context.command.evaluator.prompt_version,
      timeoutMs: context.command.evaluator.timeout_ms,
      maxOutputTokens: context.command.evaluator.max_output_tokens,
    },
    inputMaxBytes: context.command.input_max_bytes,
    limits: {
      maximumGenerationChunks:
        context.command.limits.maximum_generation_chunks,
      maximumCandidateRecords:
        context.command.limits.maximum_candidate_records,
      maximumEvaluatorCalls:
        context.command.limits.maximum_evaluator_calls,
      maximumCandidateBytes:
        context.command.limits.maximum_candidate_bytes,
    },
    configurationEqual: context.command.configuration_equal,
    regression: {
      fixtureCount: context.command.regression.fixture_count,
      maximumProviderCallsPerFixture:
        context.command.regression.maximum_provider_calls_per_fixture,
      minimumPassRate: context.command.regression.minimum_pass_rate,
    },
  });
  const storedReport = await putArtifact(
    env,
    claim,
    "evaluation_report",
    report.canonicalBytes,
    clock,
  );
  return await advanceStage(
    env,
    claim,
    "regressing",
    { evaluationReportHash: storedReport.artifact.plaintextSha256 },
    clock,
  );
}

interface RegressionRequestDocument {
  schema_version: "ontology-regression-request/v1";
  fixture_index: number;
  fixture_id: string;
  pass: PatternStageClass;
  document: unknown;
}

interface RegressionResponseDocument {
  schema_version: "ontology-regression-response/v1";
  fixture_index: number;
  fixture_id: string;
  pass: PatternStageClass;
  raw: string;
  metadata: PatternPassProvenance;
  value: unknown;
}

function parseCanonicalObject(bytes: Uint8Array): Record<string, unknown> {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("artifact_integrity_failed");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== text) {
    terminal("artifact_integrity_failed");
  }
  return parsed;
}

function parseCanonicalRegressionState(
  bytes: Uint8Array,
): OntologyRegressionFixtureState {
  const parsed = parseCanonicalObject(bytes);
  const phase = parsed.phase;
  const result = parsed.result;
  if (
    !hasExactKeys(parsed, [
      "accuracy",
      "candidate",
      "complete",
      "correction",
      "fixture_id",
      "fixture_index",
      "input_tokens",
      "output_tokens",
      "phase",
      "plan",
      "planner_calls",
      "provider_calls",
      "result",
      "schema_version",
      "verifier_calls_for_candidate",
      "writer_calls",
    ]) ||
    parsed.schema_version !== "ontology-regression-state/v1" ||
    !Number.isSafeInteger(parsed.fixture_index) ||
    (parsed.fixture_index as number) < 0 ||
    (parsed.fixture_index as number) >= 30 ||
    typeof parsed.fixture_id !== "string" ||
    !["exact", "approximate", "unknown"].includes(String(parsed.accuracy)) ||
    !["planner", "writer", "verifier", "complete"].includes(String(phase)) ||
    typeof parsed.complete !== "boolean" ||
    !["planner_calls", "writer_calls", "verifier_calls_for_candidate", "provider_calls", "input_tokens", "output_tokens"]
      .every((key) => Number.isSafeInteger(parsed[key]) && (parsed[key] as number) >= 0) ||
    (parsed.planner_calls as number) > 2 ||
    (parsed.writer_calls as number) > 3 ||
    (parsed.verifier_calls_for_candidate as number) > 2 ||
    (parsed.provider_calls as number) > 11 ||
    (parsed.complete !== (phase === "complete")) ||
    (parsed.complete !== (result !== null)) ||
    (phase === "writer" && !isRecord(parsed.plan)) ||
    (phase === "verifier" &&
      (!isRecord(parsed.plan) || !isRecord(parsed.candidate)))
  ) {
    terminal("artifact_integrity_failed");
  }
  if (result !== null) {
    if (
      !isRecord(result) ||
      typeof result.fixture_id !== "string" ||
      result.fixture_id !== parsed.fixture_id ||
      result.accuracy !== parsed.accuracy ||
      typeof result.accepted !== "boolean" ||
      !["accepted", "refused"].includes(String(result.declared_outcome)) ||
      result.provider_calls !== parsed.provider_calls ||
      result.input_tokens !== parsed.input_tokens ||
      result.output_tokens !== parsed.output_tokens ||
      !Array.isArray(result.hard_gate_failures)
    ) {
      terminal("artifact_integrity_failed");
    }
  }
  return parsed as unknown as OntologyRegressionFixtureState;
}

function regressionMetadataMatches(
  metadata: PatternPassProvenance,
  pass: PatternStageClass,
): boolean {
  return metadata.provider === "openai" &&
    metadata.pass === pass &&
    metadata.model === ONTOLOGY_REGRESSION_PATTERN_PIN[`${pass}_model`] &&
    metadata.prompt_version ===
      ONTOLOGY_REGRESSION_PATTERN_PIN[`${pass}_prompt_version`] &&
    typeof metadata.provider_request_id === "string" &&
    metadata.provider_request_id.length > 0 &&
    Number.isSafeInteger(metadata.input_tokens) &&
    metadata.input_tokens !== null &&
    metadata.input_tokens >= 0 &&
    metadata.input_tokens <=
      ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL &&
    Number.isSafeInteger(metadata.output_tokens) &&
    metadata.output_tokens !== null &&
    metadata.output_tokens >= 0 &&
    metadata.output_tokens <= ontologyRegressionPassMaximumOutputTokens(pass) &&
    typeof metadata.provider_response_hash === "string" &&
    CONTENT_HASH.test(metadata.provider_response_hash);
}

async function parseRegressionResponse(
  bytes: Uint8Array,
  fixtureIndex: number,
  fixtureId: string,
  pass: PatternStageClass,
): Promise<RegressionResponseDocument> {
  const parsed = parseCanonicalObject(bytes);
  if (
    !hasExactKeys(parsed, [
      "document",
      "fixture_id",
      "fixture_index",
      "metadata",
      "pass",
      "raw",
      "schema_version",
    ]) ||
    parsed.schema_version !== "ontology-regression-response/v1" ||
    parsed.fixture_index !== fixtureIndex ||
    parsed.fixture_id !== fixtureId ||
    parsed.pass !== pass ||
    typeof parsed.raw !== "string" ||
    !isRecord(parsed.metadata)
  ) {
    terminal("artifact_integrity_failed");
  }
  const metadata = parsed.metadata as unknown as PatternPassProvenance;
  if (
    !regressionMetadataMatches(metadata, pass) ||
    await contentHash(parsed.raw) !== metadata.provider_response_hash
  ) {
    terminal("artifact_integrity_failed");
  }
  const providerValue = parseRawProviderValue(
    textEncoder.encode(parsed.raw),
    isRecord,
  );
  if (canonicalJson(providerValue) !== canonicalJson(parsed.document)) {
    terminal("provider_response_invalid");
  }
  return {
    schema_version: "ontology-regression-response/v1",
    fixture_index: fixtureIndex,
    fixture_id: fixtureId,
    pass,
    raw: parsed.raw,
    metadata,
    value: providerValue,
  };
}

function regressionRequestDocument(
  fixtureIndex: number,
  fixtureId: string,
  pass: PatternStageClass,
  document: unknown,
): RegressionRequestDocument {
  return {
    schema_version: "ontology-regression-request/v1",
    fixture_index: fixtureIndex,
    fixture_id: fixtureId,
    pass,
    document,
  };
}

function parseRegressionRequest(
  bytes: Uint8Array,
): RegressionRequestDocument {
  const parsed = parseCanonicalObject(bytes);
  if (
    !hasExactKeys(parsed, [
      "document",
      "fixture_id",
      "fixture_index",
      "pass",
      "schema_version",
    ]) ||
    parsed.schema_version !== "ontology-regression-request/v1" ||
    !Number.isSafeInteger(parsed.fixture_index) ||
    typeof parsed.fixture_id !== "string" ||
    !["planner", "writer", "verifier"].includes(String(parsed.pass))
  ) {
    terminal("artifact_integrity_failed");
  }
  return parsed as unknown as RegressionRequestDocument;
}

async function loadPriorRegressionState(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
): Promise<OntologyRegressionFixtureState | null> {
  const { results } = await env.DB.prepare(
    `SELECT stage_generation, stage_attempt, artifact_class, plaintext_sha256
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'regressing'
       AND artifact_class = 'regression_result' AND deleted_at IS NULL
       AND stage_generation < ?
     ORDER BY stage_generation, stage_attempt`,
  ).bind(claim.runId, claim.stageGeneration).all<RegressionArtifactRow>();
  if (results.length !== claim.stageCursor) terminal("regression_failed");
  const latest = results.at(-1);
  if (!latest) return null;
  const stored = await readOntologyPipelineArtifact(
    env,
    historicalCoordinate(
      claim.runId,
      "regressing",
      latest.stage_generation,
      latest.stage_attempt,
      "regression_result",
    ),
  );
  if (!stored || stored.artifact.plaintextSha256 !== latest.plaintext_sha256) {
    terminal("artifact_integrity_failed");
  }
  return parseCanonicalRegressionState(stored.plaintext);
}

async function assertRegressionProviderRunCapacity(
  env: Pick<Env, "DB">,
  runId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS request_count
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND artifact_class = 'regression_request'`,
  ).bind(runId).first<{ request_count: number }>();
  if (
    !row ||
    !Number.isSafeInteger(row.request_count) ||
    row.request_count >= ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS
  ) {
    terminal("regression_budget_exceeded");
  }
}

async function runRegressionPublisherPass(
  publisher: PatternPublisher,
  pass: PatternStageClass,
  document: unknown,
  options: Parameters<PatternPublisher["plan"]>[1],
): Promise<PatternPassOutcome<unknown>> {
  if (pass === "planner") return publisher.plan(document, options);
  if (pass === "writer") return publisher.write(document, options);
  return publisher.verify(document, options);
}

async function retryRegressionProviderPass(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  state: OntologyRegressionFixtureState,
  retryAfterSeconds: number,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  if (!ontologyRegressionPassCanAttempt(state, claim.stageAttempt + 1)) {
    terminal("regression_failed");
  }
  const delaySeconds = Math.max(
    PROVIDER_RETRY_DELAY_SECONDS,
    retryAfterSeconds,
  );
  const availableAt = new Date(clock().getTime() + delaySeconds * 1_000);
  if (!await retryOntologyPipelineStage(env, claim, availableAt)) {
    return { status: "duplicate" };
  }
  return { status: "rescheduled", retryAfterSeconds: delaySeconds };
}

async function handleRegressionProviderFailure(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  state: OntologyRegressionFixtureState,
  outcome: Extract<PatternPassOutcome<unknown>, { ok: false }>,
  reservationFailure:
    | "exhausted"
    | "claim_unavailable"
    | "run_exhausted"
    | null,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  if (reservationFailure === "run_exhausted") terminal("attempts_exhausted");
  if (reservationFailure === "exhausted") {
    terminal("provider_budget_exhausted");
  }
  if (outcome.code === "publisher_budget_exhausted") {
    return retryRegressionProviderPass(env, claim, state, 0, clock);
  }
  if (outcome.code === "publisher_refused") terminal("provider_refusal");
  if (
    outcome.code === "publisher_auth_failed" ||
    outcome.code === "publisher_model_unavailable"
  ) {
    terminal("provider_not_configured");
  }
  return retryRegressionProviderPass(
    env,
    claim,
    state,
    outcome.retry_after_seconds ?? 0,
    clock,
  );
}

async function loadRegressionArtifactRows(
  env: Pick<Env, "DB">,
  runId: string,
): Promise<RegressionArtifactRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT stage_generation, stage_attempt, artifact_class, plaintext_sha256
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'regressing'
       AND artifact_class IN (
         'regression_request', 'regression_response', 'regression_result'
       )
       AND deleted_at IS NULL
     ORDER BY stage_generation, stage_attempt, artifact_class`,
  ).bind(runId).all<RegressionArtifactRow>();
  return results;
}

function regressionCoordinateKey(row: {
  stage_generation: number;
  stage_attempt: number;
}): string {
  return `${row.stage_generation}:${row.stage_attempt}`;
}

async function createCompletedRegressionReport(input: {
  env: Env;
  claim: ClaimedOntologyPipelineRun;
  context: LoadedExecutionContext;
  candidateHash: string;
  corpusManifestHash: string;
}): Promise<{
  canonicalBytes: string;
  plaintextHash: string;
}> {
  const rows = await loadRegressionArtifactRows(input.env, input.claim.runId);
  const requests = rows.filter((row) => row.artifact_class === "regression_request");
  const responses = rows.filter((row) => row.artifact_class === "regression_response");
  const states = rows.filter((row) => row.artifact_class === "regression_result");
  if (
    requests.length > ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS ||
    responses.length !== states.length ||
    states.length !== input.claim.stageCursor + 1
  ) {
    terminal("regression_budget_exceeded");
  }

  const responseCoordinates = new Set(responses.map(regressionCoordinateKey));
  const requestCoordinates = new Set(requests.map(regressionCoordinateKey));
  const stateCoordinates = new Set(states.map(regressionCoordinateKey));
  if (
    responseCoordinates.size !== responses.length ||
    requestCoordinates.size !== requests.length ||
    stateCoordinates.size !== states.length ||
    responses.some((row) => !requestCoordinates.has(regressionCoordinateKey(row))) ||
    states.some((row) => !responseCoordinates.has(regressionCoordinateKey(row)))
  ) {
    terminal("artifact_integrity_failed");
  }

  let successfulInputTokens = 0;
  let successfulOutputTokens = 0;
  for (const row of responses) {
    const stored = await readOntologyPipelineArtifact(
      input.env,
      historicalCoordinate(
        input.claim.runId,
        "regressing",
        row.stage_generation,
        row.stage_attempt,
        "regression_response",
      ),
    );
    if (!stored || stored.artifact.plaintextSha256 !== row.plaintext_sha256) {
      terminal("artifact_integrity_failed");
    }
    const parsed = parseCanonicalObject(stored.plaintext);
    if (
      !Number.isSafeInteger(parsed.fixture_index) ||
      typeof parsed.fixture_id !== "string" ||
      !["planner", "writer", "verifier"].includes(String(parsed.pass))
    ) {
      terminal("artifact_integrity_failed");
    }
    const response = await parseRegressionResponse(
      stored.plaintext,
      parsed.fixture_index as number,
      parsed.fixture_id,
      parsed.pass as PatternStageClass,
    );
    successfulInputTokens += response.metadata.input_tokens!;
    successfulOutputTokens += response.metadata.output_tokens!;
  }

  let missingInputTokens = 0;
  let missingOutputTokens = 0;
  for (const row of requests) {
    if (responseCoordinates.has(regressionCoordinateKey(row))) continue;
    const stored = await readOntologyPipelineArtifact(
      input.env,
      historicalCoordinate(
        input.claim.runId,
        "regressing",
        row.stage_generation,
        row.stage_attempt,
        "regression_request",
      ),
    );
    if (!stored || stored.artifact.plaintextSha256 !== row.plaintext_sha256) {
      terminal("artifact_integrity_failed");
    }
    const request = parseRegressionRequest(stored.plaintext);
    missingInputTokens += ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL;
    missingOutputTokens += ontologyRegressionPassMaximumOutputTokens(request.pass);
  }

  const complete = new Map<number, OntologyRegressionFixtureResult>();
  let accountedProviderCalls = 0;
  let accountedInputTokens = 0;
  let accountedOutputTokens = 0;
  for (const row of states) {
    const stored = await readOntologyPipelineArtifact(
      input.env,
      historicalCoordinate(
        input.claim.runId,
        "regressing",
        row.stage_generation,
        row.stage_attempt,
        "regression_result",
      ),
    );
    if (!stored || stored.artifact.plaintextSha256 !== row.plaintext_sha256) {
      terminal("artifact_integrity_failed");
    }
    const state = parseCanonicalRegressionState(stored.plaintext);
    if (!state.complete || !state.result) continue;
    if (complete.has(state.fixture_index)) terminal("regression_failed");
    const result: OntologyRegressionFixtureResult = {
      fixture_id: state.result.fixture_id,
      accuracy: state.result.accuracy,
      accepted: state.result.accepted,
      declared_outcome: state.result.declared_outcome,
      result_hash: row.plaintext_sha256,
      provider_calls: state.result.provider_calls,
      input_tokens: state.result.input_tokens,
      output_tokens: state.result.output_tokens,
      hard_gate_failures: state.result.hard_gate_failures,
    };
    complete.set(state.fixture_index, result);
    accountedProviderCalls += result.provider_calls;
    accountedInputTokens += result.input_tokens;
    accountedOutputTokens += result.output_tokens;
  }
  const orderedResults = Array.from({ length: 30 }, (_, fixtureIndex) =>
    complete.get(fixtureIndex));
  if (
    orderedResults.some((result) => result === undefined) ||
    accountedProviderCalls !== requests.length ||
    accountedInputTokens !== successfulInputTokens ||
    accountedOutputTokens !== successfulOutputTokens
  ) {
    terminal("regression_failed");
  }
  const configurationHash = await contentHash(
    canonicalJson(ONTOLOGY_REGRESSION_PATTERN_PIN),
  );
  return createCanonicalOntologyRegressionReport({
    ontologyVersion: input.context.command.candidate_ontology_version,
    commandHash: input.context.row.configuration_hash,
    configurationHash,
    corpusReleaseId: input.context.command.corpus.corpus_release_id,
    corpusHash: input.context.command.corpus.corpus_hash,
    corpusManifestHash: input.corpusManifestHash,
    candidateHash: input.candidateHash,
    evaluationReportHash: input.context.row.evaluation_report_hash!,
    configurationEqual: input.context.command.configuration_equal,
    results: orderedResults as OntologyRegressionFixtureResult[],
    requestArtifactCount: requests.length,
    responseArtifactCount: responses.length,
    inputTokens: successfulInputTokens + missingInputTokens,
    outputTokens: successfulOutputTokens + missingOutputTokens,
  });
}

async function executeRegressing(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  publisher: PatternPublisher,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  if (!context.row.evaluation_report_hash || !context.row.candidate_hash) {
    terminal("regression_failed");
  }
  const sourceCorpus = await readFrozenCorpus(env, context.command);
  const candidateArtifact = await loadSingleCompilingArtifact(
    env,
    claim.runId,
    "candidate_release",
  );
  if (candidateArtifact.plaintextHash !== context.row.candidate_hash) {
    terminal("candidate_invalid");
  }
  const candidate = await parseCandidateRelease(
    candidateArtifact.plaintext,
    context.command,
    sourceCorpus,
  );
  const regressionCorpus = loadOntologyRegressionCorpus();
  const prior = await loadPriorRegressionState(env, claim);
  const fixtureIndex = prior?.complete
    ? prior.fixture_index + 1
    : prior?.fixture_index ?? 0;
  const fixture = regressionCorpus.fixtures[fixtureIndex];
  if (!fixture) terminal("regression_failed");
  const baseState = prior?.complete
    ? createOntologyRegressionFixtureState(fixtureIndex, fixture)
    : prior ?? createOntologyRegressionFixtureState(fixtureIndex, fixture);
  if (
    baseState.fixture_index !== fixtureIndex ||
    baseState.fixture_id !== fixture.fixture_id ||
    baseState.accuracy !== fixture.effective_accuracy
  ) {
    terminal("regression_failed");
  }
  const prepared = prepareOntologyRegressionPass({
    state: baseState,
    fixture,
    ontology: candidate.records,
    inputMaxBytes: ONTOLOGY_REGRESSION_PATTERN_PIN.input_max_bytes,
  });
  if (JSON.stringify(prepared.document) !== prepared.serialized) {
    terminal("regression_failed");
  }
  const request = regressionRequestDocument(
    fixtureIndex,
    fixture.fixture_id,
    prepared.pass,
    prepared.document,
  );
  const requestBytes = canonicalJson(request);

  let response: RegressionResponseDocument | null = null;
  const adoptedResponse = await readCurrentArtifact(
    env,
    claim,
    "regression_response",
  );
  if (adoptedResponse) {
    response = await parseRegressionResponse(
      adoptedResponse.plaintext,
      fixtureIndex,
      fixture.fixture_id,
      prepared.pass,
    );
  }

  let nextState: OntologyRegressionFixtureState | null = null;
  const adoptedResult = await readCurrentArtifact(
    env,
    claim,
    "regression_result",
  );
  if (adoptedResult) {
    if (!response) terminal("artifact_integrity_failed");
    const recomputed = await applyOntologyRegressionPass({
      state: baseState,
      fixture,
      ontology: candidate.records,
      sourceFragmentIds: new Set(sourceCorpus.fragmentIndex.keys()),
      pass: prepared.pass,
      value: response.value,
      deliveryAttempt: claim.stageAttempt,
      metadata: response.metadata,
      ontologyVersion: candidate.ontology_version,
    });
    nextState = parseCanonicalRegressionState(adoptedResult.plaintext);
    if (canonicalJson(nextState) !== canonicalJson(recomputed)) {
      terminal("artifact_integrity_failed");
    }
  }

  if (!response) {
    const ambiguousRequest = await readCurrentArtifact(
      env,
      claim,
      "regression_request",
    );
    if (ambiguousRequest) {
      if (decodeUtf8(ambiguousRequest.plaintext) !== requestBytes) {
        terminal("artifact_integrity_failed");
      }
      return retryRegressionProviderPass(env, claim, baseState, 0, clock);
    }
    if (!ontologyRegressionPassCanAttempt(baseState, claim.stageAttempt)) {
      terminal("regression_failed");
    }
    await assertRegressionProviderRunCapacity(env, claim.runId);
    await putArtifact(env, claim, "regression_request", requestBytes, clock);
    let reservationFailure:
      | "exhausted"
      | "claim_unavailable"
      | "run_exhausted"
      | null = null;
    const timeoutMs = ontologyRegressionPassTimeoutMs(prepared.pass);
    const outcome = await runRegressionPublisherPass(
      publisher,
      prepared.pass,
      prepared.document,
      {
        requestId: `opreq_${crypto.randomUUID()}`,
        timeoutMs,
        pin: ONTOLOGY_REGRESSION_PATTERN_PIN,
        reserve: async (stageClass) => {
          if (stageClass !== prepared.pass) {
            reservationFailure = "claim_unavailable";
            return { ok: false };
          }
          const reserved = await reserveClaimedOntologyRegressionProviderCall(
            env,
            claim,
            {
              dailyLimit: context.command.daily_provider_call_limit,
              runLimit: ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
              timeoutMs,
              now: clock,
            },
          );
          if (!reserved.ok) reservationFailure = reserved.reason;
          return reserved;
        },
      },
    );
    if (!outcome.ok) {
      return handleRegressionProviderFailure(
        env,
        claim,
        baseState,
        outcome,
        reservationFailure,
        clock,
      );
    }
    if (
      !regressionMetadataMatches(outcome.metadata, prepared.pass) ||
      outcome.raw === null ||
      await contentHash(outcome.raw) !== outcome.metadata.provider_response_hash
    ) {
      terminal("provider_response_invalid");
    }
    const responseBytes = canonicalJson({
      schema_version: "ontology-regression-response/v1",
      fixture_index: fixtureIndex,
      fixture_id: fixture.fixture_id,
      pass: prepared.pass,
      raw: outcome.raw,
      metadata: outcome.metadata,
      document: outcome.value,
    });
    await putArtifact(env, claim, "regression_response", responseBytes, clock);
    response = await parseRegressionResponse(
      textEncoder.encode(responseBytes),
      fixtureIndex,
      fixture.fixture_id,
      prepared.pass,
    );
  }

  if (!nextState) {
    nextState = await applyOntologyRegressionPass({
      state: baseState,
      fixture,
      ontology: candidate.records,
      sourceFragmentIds: new Set(sourceCorpus.fragmentIndex.keys()),
      pass: prepared.pass,
      value: response.value,
      deliveryAttempt: claim.stageAttempt,
      metadata: response.metadata,
      ontologyVersion: candidate.ontology_version,
    });
    await putArtifact(
      env,
      claim,
      "regression_result",
      canonicalJson(nextState),
      clock,
    );
  }

  if (nextState.result?.hard_gate_failures.length) {
    terminal("regression_failed");
  }
  if (!nextState.complete || fixtureIndex < regressionCorpus.fixtures.length - 1) {
    return advanceCursor(env, claim, clock);
  }
  const report = await createCompletedRegressionReport({
    env,
    claim,
    context,
    candidateHash: candidateArtifact.plaintextHash,
    corpusManifestHash: regressionCorpus.manifest_hash,
  });
  const storedReport = await putArtifact(
    env,
    claim,
    "regression_report",
    report.canonicalBytes,
    clock,
  );
  if (storedReport.artifact.plaintextSha256 !== report.plaintextHash) {
    terminal("artifact_integrity_failed");
  }
  return advanceStage(
    env,
    claim,
    "signing",
    { regressionReportHash: report.plaintextHash },
    clock,
  );
}

async function loadUniquePipelineArtifact(
  env: Env,
  runId: string,
  stage: "evaluating" | "regressing" | "signing",
  artifactClass:
    | "evaluation_report"
    | "regression_report"
    | "unsigned_bundle"
    | "signed_bundle",
) {
  const { results } = await env.DB.prepare(
    `SELECT stage, stage_generation, stage_attempt, plaintext_sha256
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = ? AND artifact_class = ?
       AND deleted_at IS NULL
     ORDER BY stage_generation, stage_attempt`,
  ).bind(runId, stage, artifactClass).all<SingleArtifactRow>();
  if (results.length !== 1) terminal("artifact_unavailable");
  const row = results[0]!;
  const stored = await readOntologyPipelineArtifact(
    env,
    historicalCoordinate(
      runId,
      stage,
      row.stage_generation,
      row.stage_attempt,
      artifactClass,
    ),
  );
  if (!stored || stored.artifact.plaintextSha256 !== row.plaintext_sha256) {
    terminal("artifact_integrity_failed");
  }
  return stored;
}

async function buildPassedOntologyRelease(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
): Promise<PatternOntologyRelease> {
  if (
    !context.row.candidate_hash ||
    !context.row.evaluation_report_hash ||
    !context.row.regression_report_hash
  ) {
    terminal("signing_failed");
  }
  const corpus = await readFrozenCorpus(env, context.command);
  const candidateArtifact = await loadSingleCompilingArtifact(
    env,
    claim.runId,
    "candidate_release",
  );
  if (candidateArtifact.plaintextHash !== context.row.candidate_hash) {
    terminal("candidate_invalid");
  }
  const candidate = await parseCandidateRelease(
    candidateArtifact.plaintext,
    context.command,
    corpus,
  );
  const evaluationArtifact = await loadUniquePipelineArtifact(
    env,
    claim.runId,
    "evaluating",
    "evaluation_report",
  );
  const regressionArtifact = await loadUniquePipelineArtifact(
    env,
    claim.runId,
    "regressing",
    "regression_report",
  );
  if (
    evaluationArtifact.artifact.plaintextSha256 !==
      context.row.evaluation_report_hash ||
    regressionArtifact.artifact.plaintextSha256 !==
      context.row.regression_report_hash
  ) {
    terminal("artifact_integrity_failed");
  }
  const regressionReport = parseCanonicalObject(regressionArtifact.plaintext);
  if (
    regressionReport.schema_version !== "ontology-regression-report/v1" ||
    regressionReport.ontology_version !== candidate.ontology_version ||
    regressionReport.command_hash !== context.row.configuration_hash ||
    regressionReport.candidate_hash !== context.row.candidate_hash ||
    regressionReport.evaluation_report_hash !==
      context.row.evaluation_report_hash ||
    regressionReport.passed !== true
  ) {
    terminal("regression_failed");
  }
  const release: PatternOntologyRelease = {
    ...candidate,
    evaluation: {
      ...candidate.evaluation,
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: true,
      unevaluated_fixture_count: 0,
      evaluation_report_hash: context.row.evaluation_report_hash,
      regression_report_hash: context.row.regression_report_hash,
    },
  };
  release.bundle_hash = await computeOntologyBundleHash(release);
  const compiled = compileOntologyRelease(release);
  if (!compiled.ok) terminal("candidate_invalid");
  return release;
}

function ontologyPipelineSigningKeyId(env: Env): string {
  const keys = [...parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS).keys()].sort();
  // A rotation with two verification keys needs an explicit operator cutover;
  // choosing one silently could ask the isolated signer for the wrong key.
  if (keys.length !== 1) terminal("signing_failed");
  return keys[0]!;
}

async function parseSignedOntologyBundle(
  bytes: Uint8Array,
  expected: PatternOntologyRelease,
  env: Env,
): Promise<SignedOntologyRelease> {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("artifact_integrity_failed");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== text) {
    terminal("artifact_integrity_failed");
  }
  const signed = parsed as unknown as SignedOntologyRelease;
  if (
    !signed.signature ||
    canonicalJson(stripOntologySignature(signed)) !== canonicalJson(expected) ||
    await verifyOntologySignature(
      signed,
      parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS),
    ) !== null
  ) {
    terminal("signing_failed");
  }
  return signed;
}

async function executeSigning(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  const release = await buildPassedOntologyRelease(env, claim, context);
  const unsignedBytes = canonicalJson(release);
  await putArtifact(env, claim, "unsigned_bundle", unsignedBytes, clock);
  let signed: SignedOntologyRelease;
  const adopted = await readCurrentArtifact(env, claim, "signed_bundle");
  if (adopted) {
    signed = await parseSignedOntologyBundle(adopted.plaintext, release, env);
  } else {
    const keyId = ontologyPipelineSigningKeyId(env);
    let signature;
    try {
      signature = await signOntologyCandidate(env.ONTOLOGY_SIGNER, release, keyId);
    } catch {
      terminal("signing_failed");
    }
    signed = { ...release, signature };
    if (
      await verifyOntologySignature(
        signed,
        parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS),
      ) !== null
    ) {
      terminal("signing_failed");
    }
    await putArtifact(
      env,
      claim,
      "signed_bundle",
      canonicalJson(signed),
      clock,
    );
  }
  if (release.bundle_hash !== context.row.bundle_hash && context.row.bundle_hash) {
    terminal("signing_failed");
  }
  return advanceStage(
    env,
    claim,
    "ingesting",
    { bundleHash: release.bundle_hash },
    clock,
  );
}

async function executeIngesting(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  context: LoadedExecutionContext,
  clock: () => Date,
): Promise<OntologyPipelineExecuteOutcome> {
  if (
    !context.row.bundle_hash ||
    !context.row.evaluation_report_hash ||
    !context.row.regression_report_hash
  ) {
    terminal("ingestion_failed");
  }
  const release = await buildPassedOntologyRelease(env, claim, context);
  if (release.bundle_hash !== context.row.bundle_hash) {
    terminal("ingestion_failed");
  }
  const signedArtifact = await loadUniquePipelineArtifact(
    env,
    claim.runId,
    "signing",
    "signed_bundle",
  );
  const signed = await parseSignedOntologyBundle(
    signedArtifact.plaintext,
    release,
    env,
  );
  const evaluationArtifact = await loadUniquePipelineArtifact(
    env,
    claim.runId,
    "evaluating",
    "evaluation_report",
  );
  const signature = signed.signature;
  if (!signature) terminal("ingestion_failed");
  await commitOntologyPipelineEvidence(env, {
    runId: claim.runId,
    ontologyVersion: release.ontology_version,
    corpusReleaseId: context.command.corpus.corpus_release_id,
    corpusReleaseHash: context.command.corpus.corpus_hash,
    corpusLicenseClass: context.command.corpus.license_class,
    corpusPublicCapable: context.command.corpus.public_capable,
    activationScope: context.command.corpus.public_capable ? "public" : "internal",
    bundleHash: release.bundle_hash,
    evaluationReportHash: context.row.evaluation_report_hash,
    evaluationArtifactObjectKey: evaluationArtifact.artifact.objectKey,
    evaluationArtifactEnvelopeHash: evaluationArtifact.artifact.envelopeSha256,
    evaluationArtifactCiphertextHash: evaluationArtifact.artifact.ciphertextSha256,
    signingKeyId: signature.key_id,
    compilerPassed: true,
    evaluatorPassed: true,
    unevaluatedFixtureCount: 0,
  });
  const evidence = await verifyPatternOntologyEvidence(
    env,
    release,
    signature.key_id,
  );
  const objectKey = `${ONTOLOGY_OBJECT_PREFIX}${release.ontology_version}.json`;
  await storeOntologyRelease(env, signed, objectKey, evidence);
  await reconcileMachineOntologyActivation(env, release.ontology_version);
  await putArtifact(
    env,
    claim,
    "ingestion_receipt",
    canonicalJson({
      schema_version: "ontology-ingestion-receipt/v1",
      run_id: claim.runId,
      ontology_version: release.ontology_version,
      bundle_hash: release.bundle_hash,
      evaluation_report_hash: context.row.evaluation_report_hash,
      regression_report_hash: context.row.regression_report_hash,
      signing_key_id: signature.key_id,
      object_key: objectKey,
      status: "activated",
    }),
    clock,
  );
  if (!await succeedOntologyPipelineRun(env, claim, clock())) {
    return { status: "duplicate" };
  }
  return { status: "advanced" };
}

function failureClassForCaught(cause: unknown): OntologyPipelineFailureClass | null {
  if (cause instanceof TerminalPipelineFailure) return cause.failureClass;
  if (
    cause instanceof OntologyPipelineCommandError &&
    cause.code === "ontology_pipeline_predecessor_unavailable"
  ) {
    return "configuration_invalid";
  }
  if (cause instanceof OntologyCorpusError) {
    if (cause.code.includes("hash_mismatch")) return "corpus_hash_mismatch";
    if (cause.code.includes("missing") || cause.code.includes("not_registered")) {
      return "corpus_unavailable";
    }
    return "corpus_invalid";
  }
  if (cause instanceof OntologyPipelineArtifactError) {
    if (cause.code === "ontology_pipeline_artifact_conflict") {
      return "artifact_conflict";
    }
    if (cause.code === "ontology_pipeline_artifact_unavailable") {
      return "artifact_unavailable";
    }
    if (cause.code === "ontology_pipeline_artifact_integrity_failed") {
      return "artifact_integrity_failed";
    }
    if (cause.code === "ontology_pipeline_artifact_keyring_invalid") {
      return "configuration_invalid";
    }
    if (cause.code === "ontology_pipeline_artifact_too_large") {
      return "candidate_invalid";
    }
  }
  if (cause instanceof OntologyRegressionError) return cause.code;
  if (cause instanceof OntologySigningClientError) return "signing_failed";
  if (cause instanceof PatternOntologyEvidenceError) return "ingestion_failed";
  return null;
}

/** Execute one opaque Queue delivery through the complete durable stage graph. */
export async function executeOntologyPipelineDelivery(
  env: Env,
  message: OntologyPipelineMessage,
  options: OntologyPipelineExecuteOptions = {},
): Promise<OntologyPipelineExecuteOutcome> {
  const clock = options.clock ?? (() => new Date());
  const resolved = resolveOntologyPipelineConfiguration(env);
  if (!resolved.ok || resolved.rollout !== "internal" || !resolved.config) {
    return { status: "retry", retryAfterSeconds: LEASE_RETRY_DELAY_SECONDS };
  }
  let claim;
  try {
    claim = await claimOntologyPipelineRun(
      env,
      message,
      clock(),
      `opclaim_${crypto.randomUUID()}`,
      "all",
    );
  } catch {
    return { status: "retry", retryAfterSeconds: LEASE_RETRY_DELAY_SECONDS };
  }
  if (claim.status === "duplicate") return { status: "duplicate" };
  if (claim.status === "parked") return { status: "parked" };

  try {
    const context = await loadExecutionContext(env, claim, resolved.config);
    const publisher = options.publisher ?? createOpenAiOntologyPublisher(
      resolved.config.credential,
      resolved.config.gatewayRoute,
    );
    switch (claim.stage) {
      case "reserved":
        return await advanceStage(env, claim, "corpus_reading", {}, clock);
      case "corpus_reading":
        await readFrozenCorpus(env, context.command);
        return await advanceStage(env, claim, "generating", {}, clock);
      case "generating":
        return await executeGenerating(env, claim, context, publisher, clock);
      case "compiling":
        return await executeCompiling(env, claim, context, clock);
      case "evaluating":
        return await executeEvaluating(env, claim, context, publisher, clock);
      case "regressing":
        return await executeRegressing(
          env,
          claim,
          context,
          options.patternPublisher ?? createOpenAiPatternPublisher(
            resolved.config.credential,
            resolved.config.gatewayRoute,
          ),
          clock,
        );
      case "signing":
        return await executeSigning(env, claim, context, clock);
      case "ingesting":
        return await executeIngesting(env, claim, context, clock);
    }
  } catch (cause) {
    if (
      cause instanceof OntologyPipelineArtifactError &&
      cause.code === "ontology_pipeline_artifact_stale_owner"
    ) {
      return { status: "duplicate" };
    }
    const failureClass = failureClassForCaught(cause);
    if (failureClass !== null) {
      try {
        if (await failOntologyPipelineRun(env, claim, failureClass, clock())) {
          return { status: "terminal" };
        }
        return { status: "duplicate" };
      } catch {
        return { status: "retry", retryAfterSeconds: LEASE_RETRY_DELAY_SECONDS };
      }
    }
    return { status: "retry", retryAfterSeconds: LEASE_RETRY_DELAY_SECONDS };
  }
}
