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
  type ClaimedOntologyPipelineRun,
  type OntologyPipelineFailureClass,
} from "../db/ontology-pipeline.js";
import {
  createOntologyProviderCallReservation,
} from "../db/ontology-provider-usage.js";
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
  ONTOLOGY_PROHIBITED_CLAIMS,
  ONTOLOGY_PROHIBITED_CLAIM_POLICY_VERSION,
  ONTOLOGY_REGRESSION_POLICY_VERSION,
  loadOntologyPipelinePredecessor,
  type OntologyPipelineCommand,
} from "./ontology-pipeline-command.js";
import {
  dispatchUndispatchedOntologyPipelineRuns,
} from "./ontology-pipeline-enqueue.js";
import {
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
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";

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
}

interface CandidateChunkArtifactRow {
  stage_generation: number;
  stage_attempt: number;
}

interface VerdictArtifactRow {
  stage_generation: number;
  stage_attempt: number;
}

interface SingleArtifactRow {
  stage: "compiling";
  stage_generation: number;
  stage_attempt: number;
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
  | { status: "terminal" }
  | { status: "retry"; retryAfterSeconds: number };

export interface OntologyPipelineExecuteOptions {
  publisher?: OntologyPublisher;
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
  value: Record<string, unknown>,
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
      "coverage_targets",
      "feature_vocabulary",
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
            evaluation_report_hash
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
  stage: "generating" | "compiling" | "evaluating",
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
  nextStage: "corpus_reading" | "generating" | "compiling" | "evaluating" | "regressing",
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

async function loadCandidateChunks(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
): Promise<OntologyGenerationChunk[]> {
  const expectedCount = claim.stage === "generating"
    ? claim.stageCursor + 1
    : claim.stageGeneration - 2;
  const lastGeneration = claim.stage === "generating"
    ? claim.stageGeneration
    : claim.stageGeneration - 1;
  const firstGeneration = lastGeneration - expectedCount + 1;
  if (expectedCount < 1 || firstGeneration !== 2) terminal("candidate_invalid");
  const { results } = await env.DB.prepare(
    `SELECT stage_generation, stage_attempt
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND stage = 'generating'
       AND artifact_class = 'candidate_chunk' AND deleted_at IS NULL
     ORDER BY stage_generation, stage_attempt`,
  ).bind(claim.runId).all<CandidateChunkArtifactRow>();
  if (results.length !== expectedCount) terminal("candidate_invalid");

  const chunks: OntologyGenerationChunk[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const row = results[index]!;
    const generation = firstGeneration + index;
    if (row.stage_generation !== generation) terminal("candidate_invalid");
    const stored = await readOntologyPipelineArtifact(
      env,
      historicalCoordinate(
        claim.runId,
        "generating",
        row.stage_generation,
        row.stage_attempt,
        "candidate_chunk",
      ),
    );
    if (!stored) terminal("candidate_invalid");
    chunks.push(parseCanonicalChunk(stored.plaintext));
  }
  return chunks;
}

async function buildCompleteCandidate(
  env: Env,
  claim: ClaimedOntologyPipelineRun,
  command: OntologyPipelineCommand,
  corpus: RegisteredOntologyCorpus,
): Promise<{ release: PatternOntologyRelease; canonicalBytes: string; candidateHash: string }> {
  const chunks = await loadCandidateChunks(env, claim);
  if (
    chunks.some((chunk, index) =>
      chunk.complete !== (index === chunks.length - 1))
  ) {
    terminal("candidate_invalid");
  }
  const records = chunks.flatMap((chunk) => chunk.records);
  if (records.length === 0) terminal("candidate_invalid");
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id) || record.locale !== corpus.release.locale) {
      terminal("candidate_invalid");
    }
    ids.add(record.id);
    for (const fragmentId of record.source_fragment_ids) {
      if (!corpus.fragmentIndex.has(fragmentId)) terminal("candidate_invalid");
    }
  }
  for (const target of command.generator_input.coverage_targets) {
    const matching = records.filter(
      (record) => record.feature_predicate.type === target.feature_class,
    );
    const sourceSupported = matching.filter(
      (record) => record.meaning_class === "source_supported",
    );
    if (
      matching.length < target.minimum_total ||
      sourceSupported.length < target.minimum_source_supported
    ) {
      terminal("candidate_invalid");
    }
  }
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
  const canonicalBytes = canonicalJson(release);
  return {
    release,
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
    }, pinFromCommand(context.command));
    if (!packet.ok) terminal("candidate_invalid");
    await putArtifact(env, claim, "generator_request", packet.serialized, clock);
    const outcome = await publisher.generate(packet, {
      requestId: `opreq_${crypto.randomUUID()}`,
      timeoutMs: context.command.generator.timeout_ms,
      configuration: pinFromCommand(context.command),
      reserve: createOntologyProviderCallReservation(
        env,
        context.command.daily_provider_call_limit,
        clock,
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

  const chunkArtifact = await putArtifact(
    env,
    claim,
    "candidate_chunk",
    canonicalJson(chunk),
    clock,
  );
  if (!chunk.complete) return await advanceCursor(env, claim, clock);

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

function parseCandidateRelease(bytes: Uint8Array): PatternOntologyRelease {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    terminal("candidate_invalid");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== text) {
    terminal("candidate_invalid");
  }
  if (
    parsed.schema_version !== M7_SCHEMA_VERSION ||
    typeof parsed.ontology_version !== "string" ||
    typeof parsed.bundle_hash !== "string" ||
    !CONTENT_HASH.test(parsed.bundle_hash) ||
    typeof parsed.corpus_release_hash !== "string" ||
    !CONTENT_HASH.test(parsed.corpus_release_hash) ||
    typeof parsed.locale !== "string" ||
    parsed.status !== "candidate"
  ) {
    terminal("candidate_invalid");
  }
  const evaluation = parsed.evaluation;
  if (
    !isRecord(evaluation) ||
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
    evaluation.ontology_version !== parsed.ontology_version ||
    evaluation.verdict !== "pass" ||
    evaluation.compiler_passed !== true ||
    evaluation.evaluator_passed !== true ||
    evaluation.regression_passed !== false ||
    evaluation.unevaluated_fixture_count !== 0
  ) {
    terminal("candidate_invalid");
  }
  const provenance = parsed.provenance;
  if (
    !isRecord(provenance) ||
    !hasExactKeys(provenance, ["origin"]) ||
    provenance.origin !== "machine_pipeline"
  ) {
    terminal("candidate_invalid");
  }
  const recordsEnvelope = {
    schema_version: parsed.schema_version,
    records: parsed.records,
    complete: true,
  };
  if (!isOntologyGenerationChunk(recordsEnvelope)) {
    terminal("candidate_invalid");
  }
  const release: PatternOntologyRelease = {
    schema_version: parsed.schema_version,
    ontology_version: parsed.ontology_version,
    bundle_hash: parsed.bundle_hash,
    corpus_release_hash: parsed.corpus_release_hash,
    locale: parsed.locale,
    status: parsed.status,
    records: recordsEnvelope.records,
    evaluation: {
      schema_version: evaluation.schema_version,
      ontology_version: evaluation.ontology_version,
      verdict: evaluation.verdict,
      compiler_passed: evaluation.compiler_passed,
      evaluator_passed: evaluation.evaluator_passed,
      regression_passed: evaluation.regression_passed,
      unevaluated_fixture_count: evaluation.unevaluated_fixture_count,
    },
    provenance: { origin: provenance.origin },
  };
  if (canonicalJson(release) !== text) terminal("candidate_invalid");
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
  const candidate = parseCandidateRelease(candidateArtifact.plaintext);
  const evaluationStartGeneration = claim.stageGeneration - claim.stageCursor;
  if (
    candidateArtifact.stageGeneration + 1 !== evaluationStartGeneration ||
    claim.stageCursor >= candidate.records.length
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
    const packet = buildOntologyEvaluatorPacket({
      corpus,
      rule,
      citedMeanings,
      compilerSummary,
    }, pinFromCommand(context.command));
    if (!packet.ok) terminal("candidate_invalid");
    await putArtifact(env, claim, "evaluator_request", packet.serialized, clock);
    const outcome = await publisher.evaluate(packet, {
      requestId: `opreq_${crypto.randomUUID()}`,
      timeoutMs: context.command.evaluator.timeout_ms,
      configuration: pinFromCommand(context.command),
      reserve: createOntologyProviderCallReservation(
        env,
        context.command.daily_provider_call_limit,
        clock,
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

function failureClassForCaught(cause: unknown): OntologyPipelineFailureClass | null {
  if (cause instanceof TerminalPipelineFailure) return cause.failureClass;
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
  return null;
}

/**
 * Execute one opaque Queue delivery through the successful evaluating prefix.
 * The function owns no retry, accounting, transition, encryption, or Queue
 * implementation: it composes the Task 4 publisher with Task 5's reviewed
 * primitives and stops after committing `regressing`.
 */
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
  const claim = await claimOntologyPipelineRun(env, message, clock());
  if (claim.status === "duplicate") return { status: "duplicate" };

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
      case "signing":
      case "ingesting":
        // Task 7 owns every downstream transition. A Task 6 consumer must not
        // acknowledge or mutate a stage it cannot execute.
        return { status: "retry", retryAfterSeconds: LEASE_RETRY_DELAY_SECONDS };
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
