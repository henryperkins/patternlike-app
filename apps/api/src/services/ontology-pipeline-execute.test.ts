import { env } from "cloudflare:test";
import {
  canonicalJson,
  contentHash,
  type PatternFactPacket,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
  type PatternPlan,
  type PatternSemanticVerdict,
  type PatternTransformationClass,
  type PatternWriterOutput,
} from "@patternlike/shared";
import {
  buildDeterministicPlan,
  buildDeterministicWriterOutput,
  ontologyRecordMatchesFeature,
  syntheticOntologyRelease,
} from "@patternlike/pattern-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_COVERAGE_HINT_CORPUS_HASH,
  APPROVED_COVERAGE_HINT_FRAGMENT_ID,
  APPROVED_COVERAGE_HINT_FRAGMENT_IDS,
  buildApprovedCoverageHintCorpusManifest,
  buildTestCorpusManifest,
  testOntologyPipelineArtifactKeyring,
  type TestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import { seedActiveOntology } from "../../test/helpers.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import {
  claimOntologyPipelineRun,
  retryOntologyPipelineStage,
} from "../db/ontology-pipeline.js";
import {
  claimCodexProviderJob,
  completeCodexProviderJob,
} from "../db/codex-provider-jobs.js";
import {
  putCodexProviderArtifact,
  readCodexProviderArtifact,
} from "./codex-provider-artifacts.js";
import {
  enqueueOntologyPipelineRun,
} from "./ontology-pipeline-enqueue.js";
import {
  buildOntologyPipelineCommand,
} from "./ontology-pipeline-command.js";
import {
  readOntologyPipelineArtifact,
  type OntologyPipelineArtifactClass,
  type OntologyPipelineStage,
} from "./ontology-pipeline-artifacts.js";
import { registerOntologyCorpus } from "./ontology-corpus.js";
import type {
  OntologyGenerationChunk,
  OntologyPassOptions,
  OntologyPassOutcome,
  OntologyPublisher,
  OntologyRuleVerdict,
} from "./ontology-publisher.js";
import {
  executeOntologyPipelineDelivery,
  type OntologyPipelineExecuteOutcome,
} from "./ontology-pipeline-execute.js";
import {
  loadOntologyRegressionCorpus,
} from "./ontology-regression.js";
import type {
  PatternPassOptions as RuntimePatternPassOptions,
  PatternPassOutcome as RuntimePatternPassOutcome,
  PatternPublisher,
} from "./pattern-publisher.js";
import { evaluateSemanticVerdict } from "./pattern-semantic.js";
import {
  computeOntologyBundleHash,
  type SignedOntologyRelease,
} from "./pattern-ontology-verify.js";

interface PublisherFailureFixture {
  code:
    | "publisher_unavailable"
    | "publisher_output_invalid"
    | "publisher_refused"
    | "publisher_auth_failed"
    | "publisher_model_unavailable";
  safe_detail_code:
    | "request_timeout"
    | "network_error"
    | "rate_limited"
    | "provider_5xx"
    | "authentication_failed"
    | "model_not_available"
    | "provider_refusal"
    | "schema_mismatch";
}

type ProviderFixture<T> = T | PublisherFailureFixture;

interface FakePublisherHooks {
  beforeReserve?: (pass: "generator" | "evaluator") => Promise<void>;
  afterReserve?: (pass: "generator" | "evaluator") => Promise<void>;
}

class FakeOntologyPublisher implements OntologyPublisher {
  readonly generateInvocations = vi.fn();
  readonly evaluateInvocations = vi.fn();
  generatorProviderCalls = 0;
  evaluatorProviderCalls = 0;

  constructor(
    readonly generation: ProviderFixture<OntologyGenerationChunk>[],
    readonly evaluation: ProviderFixture<OntologyRuleVerdict>[] = [],
    readonly hooks: FakePublisherHooks = {},
    readonly provider: "openai" | "codex" = "openai",
  ) {}

  async generate(
    _packet: Parameters<OntologyPublisher["generate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyGenerationChunk>> {
    this.generateInvocations(_packet, options);
    await this.hooks.beforeReserve?.("generator");
    if (this.provider === "openai") {
      const reserved = await options.reserve("generator");
      if (!reserved.ok) return reservationRefused(reserved);
    }
    await this.hooks.afterReserve?.("generator");
    this.generatorProviderCalls += 1;
    const fixture = this.generation.shift();
    if (!fixture) throw new Error("missing generator fixture");
    if ("code" in fixture) return providerFailure(fixture);
    return providerSuccess(
      "generator",
      fixture,
      this.generatorProviderCalls,
      this.provider,
    );
  }

  async evaluate(
    _packet: Parameters<OntologyPublisher["evaluate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyRuleVerdict>> {
    this.evaluateInvocations(_packet, options);
    await this.hooks.beforeReserve?.("evaluator");
    if (this.provider === "openai") {
      const reserved = await options.reserve("evaluator");
      if (!reserved.ok) return reservationRefused(reserved);
    }
    await this.hooks.afterReserve?.("evaluator");
    this.evaluatorProviderCalls += 1;
    const fixture = this.evaluation.shift();
    if (!fixture) throw new Error("missing evaluator fixture");
    if ("code" in fixture) return providerFailure(fixture);
    return providerSuccess(
      "evaluator",
      fixture,
      this.evaluatorProviderCalls,
      this.provider,
    );
  }
}

class FakeRegressionPatternPublisher implements PatternPublisher {
  readonly planInvocations = vi.fn();
  readonly writeInvocations = vi.fn();
  readonly verifyInvocations = vi.fn();
  providerCalls = 0;
  private packet: PatternFactPacket | null = null;

  constructor(
    private readonly mutateWriter?: (writer: PatternWriterOutput) => void,
    private readonly mismatchedRawPass?: "planner" | "writer" | "verifier",
  ) {}

  private async success<T>(
    pass: "planner" | "writer" | "verifier",
    value: T,
    options: RuntimePatternPassOptions,
  ): Promise<RuntimePatternPassOutcome<T>> {
    const reserved = await options.reserve(pass);
    if (!reserved.ok) {
      return {
        ok: false,
        code: "publisher_budget_exhausted",
        safe_detail_code: "daily_call_limit_reached",
        retry_after_seconds: null,
        origin_layer: "none",
      };
    }
    this.providerCalls += 1;
    const rawValue = pass === this.mismatchedRawPass ? {} : value;
    const raw = JSON.stringify({
      id: `resp_regression_${this.providerCalls}`,
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(rawValue) }],
      }],
      usage: { input_tokens: 13, output_tokens: 8 },
    });
    return {
      ok: true,
      value,
      raw,
      metadata: {
        provider: "openai",
        pass,
        model: options.pin[`${pass}_model`],
        prompt_version: options.pin[`${pass}_prompt_version`],
        provider_request_id: `resp_regression_${this.providerCalls}`,
        input_tokens: 13,
        output_tokens: 8,
        provider_response_hash: await contentHash(raw),
      },
    };
  }

  async plan(
    input: unknown,
    options: RuntimePatternPassOptions,
  ): Promise<RuntimePatternPassOutcome<PatternPlan>> {
    this.planInvocations(input, options);
    const document = input as {
      packet: PatternFactPacket;
      ontology_records: PatternOntologyRecord[];
    };
    this.packet = document.packet;
    const planner = buildDeterministicPlan(
      document.packet,
      document.ontology_records,
    );
    return this.success(
      "planner",
      {
        ...planner,
        plan_hash: await contentHash(JSON.stringify(planner)),
        sparse_pattern: document.packet.selection_constraints.sparse_pattern,
      },
      options,
    );
  }

  async write(
    input: unknown,
    options: RuntimePatternPassOptions,
  ): Promise<RuntimePatternPassOutcome<PatternWriterOutput>> {
    this.writeInvocations(input, options);
    const document = input as {
      plan: PatternPlan;
      ontology_records: PatternOntologyRecord[];
    };
    if (!this.packet) throw new Error("planner packet missing");
    const writer = buildDeterministicWriterOutput(
      document.plan,
      this.packet,
      document.ontology_records,
    );
    this.mutateWriter?.(writer);
    return this.success("writer", writer, options);
  }

  async verify(
    input: unknown,
    options: RuntimePatternPassOptions,
  ): Promise<RuntimePatternPassOutcome<PatternSemanticVerdict>> {
    this.verifyInvocations(input, options);
    const document = input as { candidate: PatternWriterOutput };
    return this.success(
      "verifier",
      evaluateSemanticVerdict(document.candidate, { forceReject: false }),
      options,
    );
  }
}

function providerFailure<T>(
  fixture: PublisherFailureFixture,
): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: fixture.code,
    safe_detail_code: fixture.safe_detail_code,
    retry_after_seconds: null,
    origin_layer: "provider",
  };
}

function budgetExhausted<T>(): OntologyPassOutcome<T> {
  return {
    ok: false,
    code: "publisher_budget_exhausted",
    safe_detail_code: "daily_call_limit_reached",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

function reservationRefused<T>(
  reserved: { ok: false } & Partial<{ reason: string }>,
): OntologyPassOutcome<T> {
  if (reserved.reason === "claim_unavailable") {
    return {
      ok: false,
      code: "publisher_claim_unavailable",
      safe_detail_code: "claim_fence_refused",
      retry_after_seconds: null,
      origin_layer: "none",
    };
  }
  if (reserved.reason === "run_exhausted") {
    return {
      ok: false,
      code: "publisher_run_call_limit_exhausted",
      safe_detail_code: "run_call_limit_reached",
      retry_after_seconds: null,
      origin_layer: "none",
    };
  }
  return budgetExhausted();
}

async function providerSuccess<T>(
  pass: "generator" | "evaluator",
  value: T,
  call: number,
  provider: "openai" | "codex" = "openai",
): Promise<OntologyPassOutcome<T>> {
  const raw = provider === "codex"
    ? canonicalJson(value)
    : JSON.stringify({
      id: `resp_task_6_${pass}_${call}`,
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      }],
      usage: { input_tokens: 11, output_tokens: 7 },
    });
  return {
    ok: true,
    value,
    raw,
    metadata: {
      provider,
      pass,
      model: "gpt-5.6-sol",
      prompt_version: pass === "generator" ? "1.0.5" : "1.0.0-evaluator",
      provider_request_id: `resp_task_6_${pass}_${call}`,
      input_tokens: 11,
      output_tokens: 7,
      provider_response_hash: await contentHash(raw),
    },
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

function rejectingVerdict(ruleId: string): OntologyRuleVerdict {
  const verdict = passingVerdict(ruleId);
  verdict.verdict = "reject";
  verdict.dimensions.unsupported_expansion = "reject";
  return verdict;
}

function pipelineRecords(sourceId: string): PatternOntologyRecord[] {
  const predicates: PatternOntologyRecord["feature_predicate"][] = [
    { type: "position", body: "sun", house: 1 },
    { type: "aspect", body_a: "sun", body_b: "moon", aspect: "square" },
    { type: "pattern", pattern: "grand_trine" },
    { type: "angle", angle: "ascendant" },
    { type: "house_cusp", house: 1 },
    { type: "uncertainty", accuracy: "unknown" },
  ];
  return predicates.map((featurePredicate, index) => ({
    id: `ont_${String(index + 1).repeat(32).slice(0, 32)}`,
    meaning_class: "source_supported",
    locale: "en-US",
    feature_predicate: featurePredicate,
    normalized_proposition: `Closed Task 6 proposition ${index + 1}.`,
    source_fragment_ids: [sourceId],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: [`Closed tension ${index + 1}.`],
    counter_expressions: [`Closed counter-expression ${index + 1}.`],
    prohibited_claims: ["No diagnosis, prediction, fate, or biography."],
    salience_band: "medium",
    presentation_priority: 50 + index,
    cluster_tags: [featurePredicate.type],
  }));
}

function approvedCoverageHints() {
  return [
    {
      feature_class: "position" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.sun,
      feature_predicate: { type: "position" as const, body: "sun" },
    },
    {
      feature_class: "position" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.moon,
      feature_predicate: { type: "position" as const, body: "moon" },
    },
    {
      feature_class: "aspect" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.conjunction,
      feature_predicate: { type: "aspect" as const, aspect: "conjunction" },
    },
    {
      feature_class: "aspect" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.square,
      feature_predicate: { type: "aspect" as const, aspect: "square" },
    },
    {
      feature_class: "aspect" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.trine,
      feature_predicate: { type: "aspect" as const, aspect: "trine" },
    },
    {
      feature_class: "aspect" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.sextile,
      feature_predicate: { type: "aspect" as const, aspect: "sextile" },
    },
    {
      feature_class: "pattern" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.stellium,
      feature_predicate: { type: "pattern" as const, pattern: "stellium" },
    },
    {
      feature_class: "uncertainty" as const,
      source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.uncertainty,
      feature_predicate: { type: "uncertainty" as const },
    },
  ];
}

function approvedHintRecords(): PatternOntologyRecord[] {
  return approvedCoverageHints().map((hint, index) => ({
    id: `ont_${(index + 10).toString(16).padStart(32, "0")}`,
    meaning_class: "source_supported",
    locale: "en-US",
    feature_predicate: hint.feature_predicate,
    normalized_proposition: `Reviewed coverage proposition ${index + 1}.`,
    source_fragment_ids: [hint.source_fragment_id],
    input_meaning_ids: [],
    transformation_class: null,
    tensions: [`Reviewed coverage tension ${index + 1}.`],
    counter_expressions: [`Reviewed coverage counter-expression ${index + 1}.`],
    prohibited_claims: ["No diagnosis, prediction, fate, or biography."],
    salience_band: "medium",
    presentation_priority: 100 + index,
    cluster_tags: [hint.feature_class],
  }));
}

function fakeQueue(): {
  queue: Queue<OntologyPipelineMessage>;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async () => undefined);
  return {
    queue: { send } as unknown as Queue<OntologyPipelineMessage>,
    send,
  };
}

function configuredEnv(
  queue: Queue<OntologyPipelineMessage>,
  overrides: Partial<Env> = {},
): Env {
  const values = {
    ONTOLOGY_PIPELINE_QUEUE: queue,
    ONTOLOGY_PIPELINE_ARTIFACT_KEYRING:
      testOntologyPipelineArtifactKeyring(),
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "high",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.5",
    OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS: "8000",
    OPENAI_ONTOLOGY_EVALUATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_EVALUATOR_REASONING: "high",
    OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION: "1.0.0-evaluator",
    OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "120000",
    OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS: "4000",
    ONTOLOGY_PIPELINE_INPUT_MAX_BYTES: "98304",
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT: "500",
    ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS: "7",
    OPENAI_CREDENTIAL_SOURCE: "worker",
    OPENAI_API_KEY: "task-6-hermetic-provider-key",
    AI_GATEWAY_ACCOUNT_ID: undefined,
    AI_GATEWAY_ID: undefined,
    AI_GATEWAY_TOKEN: undefined,
    ...overrides,
  };
  // Cloudflare's binding object is a proxy. Define own properties directly so
  // a one-test DB/R2 fault proxy cannot flow through its inherited [[Set]] trap
  // and contaminate later cases in this file.
  return Object.create(env, Object.getOwnPropertyDescriptors(values)) as Env;
}

class TestClock {
  private value: number;

  constructor(initialValue = Date.now() - 120_000) {
    this.value = initialValue;
  }

  now = (): Date => {
    this.value += 10;
    return new Date(this.value);
  };

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

interface ReservedFixture {
  pipelineEnv: Env;
  manifest: TestCorpusManifest;
  records: PatternOntologyRecord[];
  runId: string;
  version: string;
  clock: TestClock;
}

async function reserveFixture(
  options: {
    dailyLimit?: number;
    clockStartMs?: number;
    allowedTransformations?: PatternTransformationClass[];
    manifest?: TestCorpusManifest;
    codex?: boolean;
  } = {},
): Promise<ReservedFixture> {
  const suffix = crypto.randomUUID();
  const releaseId =
    options.manifest?.corpus_release_id ?? `corpus-task-6-${suffix}`;
  const manifest = options.manifest ?? await buildTestCorpusManifest(
    releaseId,
    "en-US",
    "internal_synthetic",
  );
  if (options.allowedTransformations) {
    manifest.fragments[0]!.allowed_transformations = [
      ...options.allowedTransformations,
    ];
    const { corpus_hash: _corpusHash, ...body } = manifest;
    manifest.corpus_hash = await contentHash(canonicalJson(body));
  }
  await registerOntologyCorpus(env, manifest);
  const { queue } = fakeQueue();
  const pipelineEnv = configuredEnv(queue, {
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT:
      String(options.dailyLimit ?? 500),
    ...(options.codex
      ? {
          ONTOLOGY_PIPELINE_PUBLISHER: "codex",
          CODEX_RUNNER_TOKEN:
            "runner_0123456789abcdefghijklmnopqrstuvwxyz",
          CODEX_PROVIDER_ARTIFACT_KEYRING: JSON.stringify({
            version: 1,
            keys: {
              "codex-test-key":
                "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
            },
          }),
          OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "900000",
          OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "900000",
        }
      : {}),
  });
  const clock = new TestClock(options.clockStartMs);
  const version = `ontology-task-6-${suffix}`;
  const reservation = await enqueueOntologyPipelineRun(
    pipelineEnv,
    {
      idempotencyKey: `task-6-${suffix}`,
      corpusReleaseId: releaseId,
      candidateOntologyVersion: version,
    },
    clock.now(),
  );
  return {
    pipelineEnv,
    manifest,
    records: pipelineRecords(manifest.fragments[0]!.id),
    runId: reservation.runId,
    version,
    clock,
  };
}

async function reserveActivationFixture(codex = false): Promise<ReservedFixture> {
  const fixture = await reserveFixture({
    codex,
    allowedTransformations: [
      "intersection",
      "contrast",
      "tension",
      "counterbalance",
      "developmental_arc",
      "expression_range",
      "shared_motif",
    ],
  });
  const regression = loadOntologyRegressionCorpus();
  const sourceId = fixture.manifest.fragments[0]!.id;
  const sourceTemplates = regression.manifest.reference_ontology_records.filter(
    (record) => record.meaning_class === "source_supported",
  );
  const sourceRecords: PatternOntologyRecord[] = [];
  const sourceIdByTemplate = new Map<string, string>();
  const seenPredicates = new Set<string>();
  for (const activationFixture of regression.fixtures) {
    for (const feature of activationFixture.features) {
      const template = sourceTemplates.find((record) =>
        ontologyRecordMatchesFeature(record, feature));
      // `aspect_chain` is the corpus's deliberate unsupported ontology gap.
      if (!template) continue;
      const predicate = feature.feature_class === "position"
        ? { type: "position" as const, body: feature.body, house: 1 }
        : feature.feature_class === "aspect"
          ? {
              type: "aspect" as const,
              body_a: feature.body_a,
              body_b: feature.body_b,
              aspect: feature.aspect,
            }
          : feature.feature_class === "pattern"
            ? { type: "pattern" as const, pattern: feature.pattern }
            : feature.feature_class === "angle"
              ? { type: "angle" as const, angle: feature.angle }
              : feature.feature_class === "house_cusp"
                ? { type: "house_cusp" as const, house: feature.house }
                : {
                    type: "uncertainty" as const,
                    accuracy: feature.accuracy,
                  };
      const identity = canonicalJson(predicate);
      if (seenPredicates.has(identity)) continue;
      seenPredicates.add(identity);
      const id = `ont_${(sourceRecords.length + 1).toString(16).padStart(32, "0")}`;
      sourceRecords.push({
        ...structuredClone(template),
        id,
        feature_predicate: predicate,
        source_fragment_ids: [sourceId],
      });
      if (!sourceIdByTemplate.has(template.id)) {
        sourceIdByTemplate.set(template.id, id);
      }
    }
  }
  const derived = regression.manifest.reference_ontology_records
    .filter((record) => record.meaning_class === "derived_synthesis")
    .map((record) => ({
      ...structuredClone(record),
      feature_predicate: { type: "position" as const, body: "sun" as const, house: 1 },
      input_meaning_ids: record.input_meaning_ids.map((id) =>
        sourceIdByTemplate.get(id) ?? id),
    }));
  fixture.records = [...sourceRecords, ...derived];
  fixture.pipelineEnv = configuredEnv(
    fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
    {
      PATTERN_ONTOLOGY_KEYS: JSON.stringify({
        [env.TEST_ONTOLOGY_SIGNER_KEY_ID]: {
          alg: "Ed25519",
          public_key: env.TEST_ONTOLOGY_SIGNER_PUBLIC_KEY,
        },
      }),
      ...(codex
        ? {
            ONTOLOGY_PIPELINE_PUBLISHER: "codex",
            CODEX_RUNNER_TOKEN:
              "runner_0123456789abcdefghijklmnopqrstuvwxyz",
            CODEX_PROVIDER_ARTIFACT_KEYRING: JSON.stringify({
              version: 1,
              keys: {
                "codex-test-key":
                  "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
              },
            }),
            OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS: "900000",
            OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS: "900000",
          }
        : {}),
    },
  );
  return fixture;
}

async function runRow(runId: string): Promise<Record<string, unknown>> {
  return (await env.DB.prepare(
    `SELECT stage, stage_generation, stage_cursor, stage_attempt,
            failure_class, candidate_hash, compilation_report_hash,
            evaluation_report_hash, regression_report_hash, bundle_hash,
            failed_at, failed_artifact_expires_at,
            succeeded_at
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(runId).first<Record<string, unknown>>())!;
}

async function currentMessage(runId: string): Promise<OntologyPipelineMessage> {
  const row = await env.DB.prepare(
    `SELECT stage_generation FROM pattern_ontology_pipeline_runs
     WHERE run_id = ?`,
  ).bind(runId).first<{ stage_generation: number }>();
  return { run_id: runId, stage_generation: row!.stage_generation };
}

async function deliver(
  fixture: ReservedFixture,
  publisher: OntologyPublisher,
  message?: OntologyPipelineMessage,
  envOverride: Env = fixture.pipelineEnv,
  patternPublisher?: PatternPublisher,
): Promise<OntologyPipelineExecuteOutcome> {
  return executeOntologyPipelineDelivery(
    envOverride,
    message ?? await currentMessage(fixture.runId),
    { publisher, patternPublisher, clock: fixture.clock.now },
  );
}

async function driveToGenerating(
  fixture: ReservedFixture,
  publisher: OntologyPublisher,
): Promise<void> {
  const reserved = await deliver(fixture, publisher);
  expect(
    reserved,
    JSON.stringify(await runRow(fixture.runId)),
  ).toMatchObject({ status: "advanced" });
  expect(await runRow(fixture.runId)).toMatchObject({
    stage: "corpus_reading",
    stage_generation: 1,
    stage_cursor: 0,
  });
  expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
  expect(await runRow(fixture.runId)).toMatchObject({
    stage: "generating",
    stage_generation: 2,
    stage_cursor: 0,
  });
}

async function driveToEvaluating(
  fixture: ReservedFixture,
  publisher: OntologyPublisher,
): Promise<void> {
  await driveToGenerating(fixture, publisher);
  const generated = await deliver(fixture, publisher);
  const generatedRow = await runRow(fixture.runId);
  expect(generatedRow.failure_class).toBeNull();
  expect({ outcome: generated, row: generatedRow }).toMatchObject({
    outcome: { status: "advanced" },
    row: {
      stage: "compiling",
      stage_generation: 3,
      stage_cursor: 0,
      candidate_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    },
  });
  expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
  expect(await runRow(fixture.runId)).toMatchObject({
    stage: "evaluating",
    stage_generation: 4,
    stage_cursor: 0,
    compilation_report_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
  });
}

async function driveActivationToRegression(codex = false): Promise<{
  fixture: ReservedFixture;
  publisher: FakeOntologyPublisher;
}> {
  const fixture = await reserveActivationFixture(codex);
  const publisher = new FakeOntologyPublisher(
    [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
    fixture.records.map((record) => passingVerdict(record.id)),
    {},
    codex ? "codex" : "openai",
  );
  await driveToEvaluating(fixture, publisher);
  while ((await runRow(fixture.runId)).stage === "evaluating") {
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
  }
  expect(await runRow(fixture.runId)).toMatchObject({ stage: "regressing" });
  return { fixture, publisher };
}

function coordinate(
  runId: string,
  stage: OntologyPipelineStage,
  stageGeneration: number,
  stageAttempt: number,
  artifactClass: OntologyPipelineArtifactClass,
) {
  return { runId, stage, stageGeneration, stageAttempt, artifactClass };
}

async function releaseCrashedClaim(runId: string, now: Date): Promise<void> {
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL,
         available_at = ?, updated_at = ?
     WHERE run_id = ? AND claim_token IS NOT NULL`,
  ).bind(now.toISOString(), now.toISOString(), runId).run();
}

function failThirdArtifactPut(bucket: R2Bucket): R2Bucket {
  let puts = 0;
  return new Proxy(bucket, {
    get(target, property) {
      if (property === "put") {
        return async (...args: Parameters<R2Bucket["put"]>) => {
          puts += 1;
          if (puts === 3) throw new Error("injected post-response crash");
          return target.put(...args);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function failSecondArtifactPut(bucket: R2Bucket): R2Bucket {
  let puts = 0;
  return new Proxy(bucket, {
    get(target, property) {
      if (property === "put") {
        return async (...args: Parameters<R2Bucket["put"]>) => {
          puts += 1;
          if (puts === 2) throw new Error("injected pre-response-persistence crash");
          return target.put(...args);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function releaseClaimBeforeNamedStageCas(
  db: D1Database,
  runId: string,
): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver);
      return (query: string) => {
        const statement = target.prepare(query);
        if (!query.includes("candidate_hash = COALESCE")) return statement;
        return new Proxy(statement, {
          get(statementTarget, statementProperty, statementReceiver) {
            if (statementProperty !== "bind") {
              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function" ? value.bind(statementTarget) : value;
            }
            return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              return new Proxy(bound, {
                get(boundTarget, boundProperty, boundReceiver) {
                  if (boundProperty === "run") {
                    return async () => {
                      await db.prepare(
                        `UPDATE pattern_ontology_pipeline_runs
                         SET claim_token = NULL, lease_expires_at = NULL,
                             dispatched_at = NULL
                         WHERE run_id = ? AND claim_token IS NOT NULL`,
                      ).bind(runId).run();
                      return boundTarget.run();
                    };
                  }
                  const value = Reflect.get(boundTarget, boundProperty, boundReceiver);
                  return typeof value === "function" ? value.bind(boundTarget) : value;
                },
              });
            };
          },
        });
      };
    },
  });
}

function shortenClaimLease(db: D1Database, remainingMs: number): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver);
      return (query: string) => {
        const statement = target.prepare(query);
        if (!query.includes("SET claim_token = ?, lease_expires_at = ?")) {
          return statement;
        }
        return new Proxy(statement, {
          get(statementTarget, statementProperty, statementReceiver) {
            if (statementProperty !== "bind") {
              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function" ? value.bind(statementTarget) : value;
            }
            return (...values: unknown[]) => statementTarget.bind(
              values[0],
              new Date(Date.now() + remainingMs).toISOString(),
              ...values.slice(2),
            );
          },
        });
      };
    },
  });
}

function expandedRecords(
  source: readonly PatternOntologyRecord[],
  count: number,
): PatternOntologyRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...source[index % source.length]!,
    id: `ont_${(index + 1).toString(16).padStart(32, "0")}`,
    feature_predicate: { ...source[index % source.length]!.feature_predicate },
    source_fragment_ids: [...source[index % source.length]!.source_fragment_ids],
    input_meaning_ids: [],
    tensions: [...source[index % source.length]!.tensions],
    counter_expressions: [...source[index % source.length]!.counter_expressions],
    prohibited_claims: [...source[index % source.length]!.prohibited_claims],
    cluster_tags: [...source[index % source.length]!.cluster_tags],
  }));
}

async function candidateByteSizedRecords(
  fixture: ReservedFixture,
  targetBytes: number,
): Promise<PatternOntologyRecord[]> {
  const records = fixture.records.map((record) => ({
    ...record,
    feature_predicate: { ...record.feature_predicate },
    source_fragment_ids: [...record.source_fragment_ids],
    input_meaning_ids: [...record.input_meaning_ids],
    tensions: [...record.tensions],
    counter_expressions: [...record.counter_expressions],
    prohibited_claims: [...record.prohibited_claims],
    cluster_tags: [...record.cluster_tags],
  }));
  const release = (): PatternOntologyRelease => ({
    schema_version: "0.7.0",
    ontology_version: fixture.version,
    bundle_hash: `sha256:${"0".repeat(64)}`,
    corpus_release_hash: fixture.manifest.corpus_hash,
    locale: "en-US",
    status: "candidate",
    records,
    evaluation: {
      schema_version: "0.7.0",
      ontology_version: fixture.version,
      verdict: "pass",
      compiler_passed: true,
      evaluator_passed: true,
      regression_passed: false,
      unevaluated_fixture_count: 0,
    },
    provenance: { origin: "machine_pipeline" },
  });
  let candidate = release();
  candidate.bundle_hash = await computeOntologyBundleHash(candidate);
  const currentBytes = new TextEncoder().encode(canonicalJson(candidate)).byteLength;
  const growth = targetBytes - currentBytes;
  if (growth < 0) throw new Error("candidate target is smaller than fixture");
  records[0]!.normalized_proposition += "x".repeat(growth);
  candidate = release();
  candidate.bundle_hash = await computeOntologyBundleHash(candidate);
  expect(new TextEncoder().encode(canonicalJson(candidate)).byteLength).toBe(targetBytes);
  return records;
}

async function seedUnavailableMachinePredecessor(): Promise<string> {
  const version = `ontology-task-6-missing-${crypto.randomUUID()}`;
  const release = syntheticOntologyRelease(version) as PatternOntologyRelease;
  release.status = "candidate";
  release.provenance = { origin: "machine_pipeline" };
  release.bundle_hash = await computeOntologyBundleHash(release);
  const objectKey = `pattern-ontology/${version}.json`;
  await env.ARTIFACTS!.put(objectKey, canonicalJson(release));
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_releases (
       version, bundle_hash, corpus_release_hash, locale, status, object_key,
       evaluation_json, created_at, recalled_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
  ).bind(
    version,
    release.bundle_hash,
    release.corpus_release_hash,
    release.locale,
    objectKey,
    canonicalJson(release.evaluation),
    new Date().toISOString(),
  ).run();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pointer SET active_version = ?, updated_at = ?
     WHERE id = 1`,
  ).bind(version, new Date().toISOString()).run();
  return objectKey;
}

describe("ontology pipeline execution", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM pattern_ontology_provider_daily_usage").run();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
  });

  it("uses deterministic zero-provider deliveries for reservation and corpus reading", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([]);
    const stale = { run_id: fixture.runId, stage_generation: 0 };

    await driveToGenerating(fixture, publisher);
    expect(publisher.generateInvocations).not.toHaveBeenCalled();
    expect(publisher.evaluateInvocations).not.toHaveBeenCalled();

    expect(await deliver(fixture, publisher, stale)).toEqual({
      status: "duplicate",
    });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
    });
  });

  it("parks and adopts a Codex generator result at the same attempt", async () => {
    const fixture = await reserveFixture({ codex: true });
    const deliverCodex = () => executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      { run_id: fixture.runId, stage_generation: 0 },
      { clock: fixture.clock.now },
    );

    expect(await deliverCodex()).toEqual({ status: "advanced" });
    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      await currentMessage(fixture.runId),
      { clock: fixture.clock.now },
    )).toEqual({ status: "advanced" });
    const generatingMessage = await currentMessage(fixture.runId);
    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      generatingMessage,
      { clock: fixture.clock.now },
    )).toEqual({ status: "parked" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
      stage_attempt: 0,
    });
    expect(await env.DB.prepare(
      `SELECT claim_token, lease_expires_at, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(fixture.runId).first()).toEqual({
      claim_token: null,
      lease_expires_at: null,
      dispatched_at: expect.any(String),
    });

    const claimed = await claimCodexProviderJob(
      fixture.pipelineEnv,
      new Date("2030-08-24T00:00:00.000Z"),
    );
    if (claimed.status !== "claimed") throw new Error("Codex job missing");
    const raw = canonicalJson({
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    });
    const response = await putCodexProviderArtifact(
      fixture.pipelineEnv,
      {
        jobId: claimed.job.id,
        pipeline: "ontology",
        ownerId: fixture.runId,
        pass: "generator",
        stageGeneration: 2,
        stageAttempt: 0,
        role: "response",
      },
      new TextEncoder().encode(raw),
    );
    await completeCodexProviderJob(
      fixture.pipelineEnv,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        response: response.artifact,
        providerRequestId: "thread_ontology_pipeline_generator",
        inputTokens: 1000,
        outputTokens: 500,
      },
      new Date("2030-08-24T00:01:00.000Z"),
    );

    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      generatingMessage,
      { clock: fixture.clock.now },
    )).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "compiling",
      stage_generation: 3,
      stage_attempt: 0,
      candidate_hash: expect.stringMatching(/^sha256:/),
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs WHERE owner_id = ?",
    ).bind(fixture.runId).first()).toEqual({ count: 1 });

    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      await currentMessage(fixture.runId),
      { clock: fixture.clock.now },
    )).toEqual({ status: "advanced" });
    const evaluatingMessage = await currentMessage(fixture.runId);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_generation: 4,
      stage_cursor: 0,
      stage_attempt: 0,
    });
    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      evaluatingMessage,
      { clock: fixture.clock.now },
    )).toEqual({ status: "parked" });

    const evaluatorClaim = await claimCodexProviderJob(
      fixture.pipelineEnv,
      new Date("2030-08-24T00:02:00.000Z"),
    );
    if (evaluatorClaim.status !== "claimed") {
      throw new Error("Codex evaluator job missing");
    }
    const evaluatorRaw = canonicalJson(
      passingVerdict(fixture.records[0]!.id),
    );
    const evaluatorResponse = await putCodexProviderArtifact(
      fixture.pipelineEnv,
      {
        jobId: evaluatorClaim.job.id,
        pipeline: "ontology",
        ownerId: fixture.runId,
        pass: "evaluator",
        stageGeneration: 4,
        stageAttempt: 0,
        role: "response",
      },
      new TextEncoder().encode(evaluatorRaw),
    );
    await completeCodexProviderJob(
      fixture.pipelineEnv,
      {
        jobId: evaluatorClaim.job.id,
        leaseToken: evaluatorClaim.leaseToken,
        response: evaluatorResponse.artifact,
        providerRequestId: "thread_ontology_pipeline_evaluator",
        inputTokens: 700,
        outputTokens: 100,
      },
      new Date("2030-08-24T00:03:00.000Z"),
    );
    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      evaluatingMessage,
      { clock: fixture.clock.now },
    )).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_generation: 5,
      stage_cursor: 1,
      stage_attempt: 0,
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs WHERE owner_id = ?",
    ).bind(fixture.runId).first()).toEqual({ count: 2 });
  });

  it("parks and adopts a Codex regression planner at the same attempt", async () => {
    const { fixture } = await driveActivationToRegression(true);
    const message = await currentMessage(fixture.runId);
    const before = await runRow(fixture.runId);
    expect(before).toMatchObject({
      stage: "regressing",
      stage_attempt: 0,
    });

    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      message,
      { clock: fixture.clock.now },
    )).toEqual({ status: "parked" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      stage_generation: before.stage_generation,
      stage_cursor: before.stage_cursor,
      stage_attempt: 0,
    });

    const claimed = await claimCodexProviderJob(
      fixture.pipelineEnv,
      new Date("2030-08-24T01:00:00.000Z"),
    );
    if (claimed.status !== "claimed") {
      throw new Error("Codex regression planner job missing");
    }
    expect(claimed.job.pass).toBe("planner");
    const invocationBytes = await readCodexProviderArtifact(
      fixture.pipelineEnv,
      {
        jobId: claimed.job.id,
        pipeline: "ontology",
        ownerId: fixture.runId,
        pass: "planner",
        stageGeneration: claimed.job.stageGeneration,
        stageAttempt: claimed.job.stageAttempt,
        role: "request",
      },
      claimed.job.request,
    );
    const invocation = JSON.parse(new TextDecoder().decode(invocationBytes)) as {
      prompt: string;
    };
    const inputText = invocation.prompt.split(
      "\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n",
    )[1];
    if (!inputText) throw new Error("regression planner input missing");
    const document = JSON.parse(inputText) as {
      packet: Parameters<typeof buildDeterministicPlan>[0];
      ontology_records: Parameters<typeof buildDeterministicPlan>[1];
    };
    const raw = canonicalJson(buildDeterministicPlan(
      document.packet,
      document.ontology_records,
    ));
    const response = await putCodexProviderArtifact(
      fixture.pipelineEnv,
      {
        jobId: claimed.job.id,
        pipeline: "ontology",
        ownerId: fixture.runId,
        pass: "planner",
        stageGeneration: claimed.job.stageGeneration,
        stageAttempt: claimed.job.stageAttempt,
        role: "response",
      },
      new TextEncoder().encode(raw),
    );
    await completeCodexProviderJob(
      fixture.pipelineEnv,
      {
        jobId: claimed.job.id,
        leaseToken: claimed.leaseToken,
        response: response.artifact,
        providerRequestId: "thread_ontology_regression_planner",
        inputTokens: 900,
        outputTokens: 180,
      },
      new Date("2030-08-24T01:01:00.000Z"),
    );

    expect(await executeOntologyPipelineDelivery(
      fixture.pipelineEnv,
      message,
      { clock: fixture.clock.now },
    )).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      stage_generation: (before.stage_generation as number) + 1,
      stage_cursor: (before.stage_cursor as number) + 1,
      stage_attempt: 0,
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs WHERE owner_id = ?",
    ).bind(fixture.runId).first()).toEqual({ count: 1 });
  });

  it("terminally closes an unavailable frozen predecessor without lease churn", async () => {
    const predecessorObjectKey = await seedUnavailableMachinePredecessor();
    const fixture = await reserveFixture();
    const frozen = await env.DB.prepare(
      `SELECT configuration_json FROM pattern_ontology_pipeline_runs
       WHERE run_id = ?`,
    ).bind(fixture.runId).first<{ configuration_json: string }>();
    expect(JSON.parse(frozen!.configuration_json).generator_input
      .active_machine_predecessor).not.toBeNull();
    await env.ARTIFACTS!.delete(predecessorObjectKey);
    await env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = NULL, updated_at = ?
       WHERE id = 1`,
    ).bind(new Date().toISOString()).run();
    const publisher = new FakeOntologyPublisher([]);

    await driveToGenerating(fixture, publisher);
    const outcome = await deliver(fixture, publisher);
    const row = await runRow(fixture.runId);
    expect({ outcome, row }).toMatchObject({
      outcome: { status: "terminal" },
      row: {
        stage: "failed",
        failure_class: "configuration_invalid",
        stage_attempt: 0,
      },
    });
    expect(publisher.generateInvocations).not.toHaveBeenCalled();
  });

  it("continues bounded generation when complete=true precedes frozen coverage", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([
      {
        schema_version: "0.7.0",
        records: fixture.records.slice(0, 5),
        complete: true,
      },
      {
        schema_version: "0.7.0",
        records: fixture.records.slice(5),
        complete: true,
      },
    ]);

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_cursor: 1,
      stage_generation: 3,
    });
    const acceptedChunk = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "candidate_chunk"),
    );
    const exactResponse = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "generator_response"),
    );
    expect(JSON.parse(new TextDecoder().decode(acceptedChunk!.plaintext)))
      .toMatchObject({ complete: false });
    const envelope = JSON.parse(new TextDecoder().decode(exactResponse!.plaintext)) as {
      output: Array<{ content: Array<{ text: string }> }>;
    };
    expect(JSON.parse(envelope.output[0]!.content[0]!.text))
      .toMatchObject({ complete: true });
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "compiling",
      stage_cursor: 0,
      stage_generation: 4,
    });
    expect(publisher.generatorProviderCalls).toBe(2);
  });

  it("continues after class coverage until every exact reviewed hint is satisfied", async () => {
    const manifest = await buildApprovedCoverageHintCorpusManifest();
    expect(manifest.corpus_hash).toBe(APPROVED_COVERAGE_HINT_CORPUS_HASH);
    const fixture = await reserveFixture({ manifest });
    const hintedRecords = approvedHintRecords();
    const publisher = new FakeOntologyPublisher([
      {
        schema_version: "0.7.0",
        records: fixture.records,
        complete: true,
      },
      {
        schema_version: "0.7.0",
        records: hintedRecords,
        complete: true,
      },
    ]);

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toEqual({ status: "advanced" });
    const secondOutcome = await deliver(fixture, publisher);
    const secondRow = await runRow(fixture.runId);
    expect({ secondOutcome, secondRow }).toMatchObject({
      secondOutcome: { status: "advanced" },
      secondRow: {
        stage: "compiling",
        stage_cursor: 0,
        failure_class: null,
      },
    });
    expect(publisher.generateInvocations).toHaveBeenCalledTimes(2);
    const firstPacket = publisher.generateInvocations.mock.calls[0]![0] as {
      document: Record<string, unknown>;
    };
    const secondPacket = publisher.generateInvocations.mock.calls[1]![0] as {
      document: {
        continuation: {
          remaining_coverage_targets: unknown[];
          remaining_coverage_source_hints: unknown[];
        };
        coverage_source_hints: unknown[];
      };
    };
    expect(secondPacket.document.continuation.remaining_coverage_targets)
      .toEqual([]);
    expect(secondPacket.document.continuation.remaining_coverage_source_hints)
      .toEqual(approvedCoverageHints());
    expect(secondPacket.document.coverage_source_hints)
      .toEqual(approvedCoverageHints());
    expect(firstPacket.document.coverage_source_hints)
      .toEqual(approvedCoverageHints());
    expect(hintedRecords[0]!.feature_predicate).not.toHaveProperty("house");
    expect(hintedRecords[2]!.feature_predicate).not.toHaveProperty("body_a");
    expect(hintedRecords[7]!.feature_predicate).not.toHaveProperty("accuracy");
  });

  it("closes a continuation that reduces neither class nor exact-hint deficits", async () => {
    const manifest = await buildApprovedCoverageHintCorpusManifest();
    const fixture = await reserveFixture({ manifest });
    const unrelated = {
      ...fixture.records[0]!,
      id: `ont_${"f".repeat(32)}`,
      feature_predicate: { type: "position" as const, body: "mercury", house: 2 },
    };
    const publisher = new FakeOntologyPublisher([
      { schema_version: "0.7.0", records: fixture.records, complete: true },
      { schema_version: "0.7.0", records: [unrelated], complete: true },
    ]);

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toEqual({ status: "advanced" });
    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
      stage_cursor: 1,
    });
    expect(publisher.generatorProviderCalls).toBe(2);
    expect(publisher.evaluateInvocations).not.toHaveBeenCalled();
  });

  it("rejects any frozen coverage-hint mapping drift before a provider request", async () => {
    const manifest = await buildApprovedCoverageHintCorpusManifest();
    await registerOntologyCorpus(env, manifest);
    const otherExistingFragmentId = manifest.fragments.find((fragment) =>
      fragment.id !== APPROVED_COVERAGE_HINT_FRAGMENT_ID
    )!.id;
    type FrozenCommand = {
      command_version: string;
      generator_input: {
        coverage_source_hints: Array<{
          source_fragment_id: string;
          feature_predicate: Record<string, unknown>;
        }>;
      };
    };
    const mutators: Array<(command: FrozenCommand) => void> = [
      (command) => {
        command.generator_input.coverage_source_hints[0]!.source_fragment_id =
          `srcf_${"f".repeat(32)}`;
      },
      (command) => {
        command.generator_input.coverage_source_hints[0]!.source_fragment_id =
          otherExistingFragmentId;
      },
      (command) => {
        command.generator_input.coverage_source_hints[0]!
          .feature_predicate.body = "moon";
      },
      (command) => {
        command.generator_input.coverage_source_hints = [];
      },
      (command) => {
        command.command_version = "OntologyPipelineCommandV4";
      },
    ];

    for (const mutate of mutators) {
      const suffix = crypto.randomUUID();
      const { queue } = fakeQueue();
      const pipelineEnv = configuredEnv(queue);
      const clock = new TestClock();
      const version = `ontology-task-6-tamper-${suffix}`;
      const command = await buildOntologyPipelineCommand(
        pipelineEnv,
        manifest.corpus_release_id,
        version,
      ) as unknown as FrozenCommand;
      mutate(command);
      const configurationJson = canonicalJson(command);
      const runId = `oprun_hint_tamper_${suffix}`;
      const at = clock.now().toISOString();
      await env.DB.prepare(
        `INSERT INTO pattern_ontology_pipeline_runs (
           run_id, idempotency_key, corpus_release_id, corpus_hash,
           candidate_ontology_version, configuration_json, configuration_hash,
           stage, stage_generation, stage_cursor, stage_attempt,
           claim_token, lease_expires_at, available_at, dispatched_at,
           failure_class, candidate_hash, compilation_report_hash,
           evaluation_report_hash, regression_report_hash, bundle_hash,
           failed_artifact_expires_at, created_at, updated_at,
           finished_at, succeeded_at, failed_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, 0, 0,
           NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           ?, ?, NULL, NULL, NULL
         )`,
      ).bind(
        runId,
        `task-6-hint-tamper-${suffix}`,
        manifest.corpus_release_id,
        manifest.corpus_hash,
        version,
        configurationJson,
        await contentHash(configurationJson),
        at,
        at,
        at,
      ).run();
      const fixture: ReservedFixture = {
        pipelineEnv,
        manifest,
        records: pipelineRecords(manifest.fragments[0]!.id),
        runId,
        version,
        clock,
      };
      const publisher = new FakeOntologyPublisher([]);

      expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
      expect(await runRow(fixture.runId)).toMatchObject({
        stage: "failed",
        failure_class: "configuration_invalid",
      });
      expect(publisher.generateInvocations).not.toHaveBeenCalled();
    }
  });

  it("stores a valid non-covering chunk then closes stalled generation without another request", async () => {
    const fixture = await reserveFixture();
    const secondNonPositionRecord = expandedRecords(
      [fixture.records[1]!],
      2,
    )[1]!;
    const publisher = new FakeOntologyPublisher([
      {
        schema_version: "0.7.0",
        records: fixture.records.slice(1),
        complete: true,
      },
      {
        schema_version: "0.7.0",
        records: [secondNonPositionRecord],
        complete: true,
      },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 3,
      stage_cursor: 1,
    });
    const firstChunk = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "candidate_chunk"),
    );
    expect(JSON.parse(new TextDecoder().decode(firstChunk!.plaintext)))
      .toMatchObject({ complete: false });

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
      stage_cursor: 1,
    });
    const secondChunk = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 3, 0, "candidate_chunk"),
    );
    expect(secondChunk).not.toBeNull();
    expect(publisher.generatorProviderCalls).toBe(2);
    expect(warn).toHaveBeenCalledWith("ontology_generation_stalled", {
      trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
      safe_detail_code: "coverage_no_progress",
      remaining_feature_classes: ["position"],
    });
  });

  it("assembles exact ordered chunks and compiles the unchanged whole candidate", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([
      { schema_version: "0.7.0", records: fixture.records.slice(0, 2), complete: false },
      { schema_version: "0.7.0", records: fixture.records.slice(2), complete: true },
    ]);

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 3,
      stage_cursor: 1,
    });
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "compiling",
      stage_generation: 4,
      stage_cursor: 0,
    });
    expect(publisher.generatorProviderCalls).toBe(2);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    const stored = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "compiling", 4, 0, "candidate_release"),
    );
    const candidate = JSON.parse(
      new TextDecoder().decode(stored!.plaintext),
    ) as PatternOntologyRelease;
    expect(candidate.records.map((item) => item.id)).toEqual(
      fixture.records.map((item) => item.id),
    );
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_generation: 5,
      stage_cursor: 0,
    });
  });

  it("authenticates deterministic continuation state and differentiates successive requests", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([
      { schema_version: "0.7.0", records: fixture.records.slice(0, 2), complete: false },
      { schema_version: "0.7.0", records: fixture.records.slice(2), complete: true },
    ]);
    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });

    const firstRequest = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "generator_request"),
    );
    const secondRequest = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 3, 0, "generator_request"),
    );
    const firstChunk = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "candidate_chunk"),
    );
    const firstText = new TextDecoder().decode(firstRequest!.plaintext);
    const secondText = new TextDecoder().decode(secondRequest!.plaintext);
    const providerInput = (requestBytes: string) => {
      const request = JSON.parse(requestBytes) as {
        input: Array<{ content: Array<{ text: string }> }>;
      };
      return JSON.parse(request.input[0]!.content[0]!.text);
    };
    const first = providerInput(firstText);
    const second = providerInput(secondText);
    expect(first.continuation).toBeNull();
    expect(second.continuation).toEqual({
      chunk_index: 1,
      maximum_candidate_bytes: 262144,
      maximum_candidate_records: 64,
      maximum_evaluator_calls: 64,
      maximum_generation_chunks: 16,
      accepted_ordered_chunk_plaintext_hashes: [
        firstChunk!.artifact.plaintextSha256,
      ],
      accepted_ordered_record_ids: fixture.records.slice(0, 2).map((record) => record.id),
      remaining_coverage_targets: [
        { feature_class: "pattern", minimum_source_supported: 1, minimum_total: 1 },
        { feature_class: "angle", minimum_source_supported: 1, minimum_total: 1 },
        { feature_class: "house_cusp", minimum_source_supported: 1, minimum_total: 1 },
        { feature_class: "uncertainty", minimum_source_supported: 1, minimum_total: 1 },
      ],
      remaining_coverage_source_hints: [],
    });
    expect(secondText).not.toBe(firstText);
    for (const forbidden of [fixture.runId, "stage_generation", "object_key", "oprun_"]) {
      expect(secondText).not.toContain(forbidden);
    }
    expect(publisher.generateInvocations.mock.calls[0]![1].requestBody).toBe(firstText);
    expect(publisher.generateInvocations.mock.calls[1]![1].requestBody).toBe(secondText);
    expect(publisher.generateInvocations.mock.calls[0]![0].serialized)
      .toBe(canonicalJson(first));
    expect(publisher.generateInvocations.mock.calls[1]![0].serialized)
      .toBe(canonicalJson(second));
  });

  it("closes complete=false on chunk sixteen before a seventeenth call or cursor", async () => {
    const fixture = await reserveFixture();
    const records = expandedRecords(fixture.records, 16);
    const publisher = new FakeOntologyPublisher(records.map((record) => ({
      schema_version: "0.7.0" as const,
      records: [record],
      complete: false,
    })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await driveToGenerating(fixture, publisher);
    for (let index = 0; index < 15; index += 1) {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }
    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
      stage_cursor: 15,
    });
    expect(publisher.generatorProviderCalls).toBe(16);
    expect(warn).toHaveBeenCalledWith("ontology_generation_stalled", {
      trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
      safe_detail_code: "generation_chunk_limit_exhausted",
      remaining_feature_classes: [],
    });
  });

  it("counts retries and ambiguous requests toward the 16-call generator run ceiling across UTC days", async () => {
    const fixture = await reserveFixture();
    const records = expandedRecords(fixture.records, 16);
    const publisher = new FakeOntologyPublisher([
      { code: "publisher_unavailable", safe_detail_code: "network_error" },
      ...records.map((record, index) => ({
        schema_version: "0.7.0" as const,
        records: [record],
        complete: index === records.length - 1,
      })),
    ]);
    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "rescheduled" });
    const firstUsage = await env.DB.prepare(
      `SELECT utc_date FROM pattern_ontology_provider_daily_usage`,
    ).first<{ utc_date: string }>();
    const priorUtcDate = new Date(
      Date.parse(`${firstUsage!.utc_date}T00:00:00.000Z`) - 24 * 60 * 60_000,
    ).toISOString().slice(0, 10);
    await env.DB.prepare(
      `UPDATE pattern_ontology_provider_daily_usage SET utc_date = ?`,
    ).bind(priorUtcDate).run();
    fixture.clock.advance(60_000);
    for (let index = 0; index < 15; index += 1) {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(publisher.generatorProviderCalls).toBe(16);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "attempts_exhausted",
      stage_cursor: 15,
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'generator_request'`,
    ).bind(fixture.runId).first()).toEqual({ count: 16 });
    expect(await env.DB.prepare(
      `SELECT SUM(used_calls) AS used_calls, SUM(generator_calls) AS generator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 16, generator_calls: 16 });
    const usageRows = await env.DB.prepare(
      `SELECT utc_date, generator_calls FROM pattern_ontology_provider_daily_usage
       ORDER BY utc_date`,
    ).all<{ utc_date: string; generator_calls: number }>();
    expect(usageRows.results.map(({ generator_calls }) => generator_calls))
      .toEqual([1, 15]);
  }, 20_000);

  it("serializes concurrent final generator reservations at the exact run boundary", async () => {
    const fixture = await reserveFixture();
    const records = expandedRecords(fixture.records, 16);
    const publisher = new FakeOntologyPublisher(records.map((record, index) => ({
      schema_version: "0.7.0" as const,
      records: [record],
      complete: index === records.length - 1,
    })));
    await driveToGenerating(fixture, publisher);
    for (let index = 0; index < 15; index += 1) {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }
    const message = await currentMessage(fixture.runId);

    const outcomes = await Promise.all([
      deliver(fixture, publisher, message),
      deliver(fixture, publisher, message),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "advanced")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "duplicate")).toHaveLength(1);
    expect(publisher.generatorProviderCalls).toBe(16);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'generator_request'`,
    ).bind(fixture.runId).first()).toEqual({ count: 16 });
  }, 20_000);

  it("accepts exactly 64 candidate records and closes record 65 before cursor advance", async () => {
    const boundary = await reserveFixture();
    const boundaryRecords = expandedRecords(boundary.records, 64);
    const boundaryPublisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: boundaryRecords,
      complete: true,
    }]);
    await driveToGenerating(boundary, boundaryPublisher);
    expect(await deliver(boundary, boundaryPublisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(boundary.runId)).toMatchObject({ stage: "compiling" });

    const overflow = await reserveFixture();
    const overflowPublisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: expandedRecords(overflow.records, 65),
      complete: false,
    }]);
    await driveToGenerating(overflow, overflowPublisher);
    expect(await deliver(overflow, overflowPublisher)).toEqual({ status: "terminal" });
    expect(await runRow(overflow.runId)).toMatchObject({
      stage: "failed",
      failure_class: "provider_response_invalid",
      stage_cursor: 0,
    });
    expect(overflowPublisher.generatorProviderCalls).toBe(1);
    expect(overflowPublisher.evaluatorProviderCalls).toBe(0);
  });

  it("accepts 262144 candidate bytes and rejects 262145 before compiling", async () => {
    const boundary = await reserveFixture();
    const boundaryRecords = await candidateByteSizedRecords(boundary, 262144);
    const boundaryPublisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: boundaryRecords,
      complete: true,
    }]);
    await driveToGenerating(boundary, boundaryPublisher);
    expect(await deliver(boundary, boundaryPublisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(boundary.runId)).toMatchObject({ stage: "compiling" });

    const overflow = await reserveFixture();
    const overflowRecords = await candidateByteSizedRecords(overflow, 262145);
    const overflowPublisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: overflowRecords,
      complete: true,
    }]);
    await driveToGenerating(overflow, overflowPublisher);
    expect(await deliver(overflow, overflowPublisher)).toEqual({ status: "terminal" });
    expect(await runRow(overflow.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
    });
    expect(overflowPublisher.generatorProviderCalls).toBe(1);
  });

  it("closes a 262145-byte incomplete candidate before cursor advance", async () => {
    const fixture = await reserveFixture();
    const records = await candidateByteSizedRecords(fixture, 262145);
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records,
      complete: false,
    }]);
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
      stage_cursor: 0,
    });
    expect(publisher.generatorProviderCalls).toBe(1);
  });

  it("rejects frozen-schema and source-supported policy violations as a whole candidate", async () => {
    for (const mutate of [
      (records: PatternOntologyRecord[]) => {
        records[4]!.feature_predicate = { type: "house_cusp", house: 13 };
      },
      (records: PatternOntologyRecord[]) => {
        records[0]!.presentation_priority = 1001;
      },
      (records: PatternOntologyRecord[]) => {
        records[0]!.prohibited_claims = [];
      },
    ]) {
      const fixture = await reserveFixture();
      mutate(fixture.records);
      const publisher = new FakeOntologyPublisher([{
        schema_version: "0.7.0",
        records: fixture.records,
        complete: true,
      }]);
      await driveToGenerating(fixture, publisher);
      expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
      expect(await runRow(fixture.runId)).toMatchObject({ stage: "failed" });
      expect(await deliver(
        fixture,
        publisher,
        { run_id: fixture.runId, stage_generation: 2 },
      )).toEqual({ status: "duplicate" });
    }
  });

  it("rejects an unknown frozen celestial body before accepting generator coverage", async () => {
    const fixture = await reserveFixture();
    fixture.records[0]!.feature_predicate = {
      type: "position",
      body: "ceres",
      house: 1,
    };
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "provider_response_invalid",
      stage_cursor: 0,
    });
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { artifact_class: "generator_request" },
        { artifact_class: "generator_response" },
      ],
    });
  });

  it("cannot transition after final artifact persistence when the lease expires", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);
    const delayedEnv = configuredEnv(fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE, {
      DB: releaseClaimBeforeNamedStageCas(env.DB, fixture.runId),
    });

    expect(await executeOntologyPipelineDelivery(
      delayedEnv,
      await currentMessage(fixture.runId),
      { publisher, clock: fixture.clock.now },
    )).toEqual({ status: "duplicate" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
      stage_attempt: 0,
      candidate_hash: null,
      failure_class: null,
    });
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2
       ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { artifact_class: "candidate_chunk" },
        { artifact_class: "generator_request" },
        { artifact_class: "generator_response" },
      ],
    });
  });

  it("fails the whole run when an ordered chunk artifact has a gap", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([
      { schema_version: "0.7.0", records: fixture.records.slice(0, 2), complete: false },
      { schema_version: "0.7.0", records: fixture.records.slice(2), complete: true },
    ]);
    await driveToGenerating(fixture, publisher);
    await deliver(fixture, publisher);
    await deliver(fixture, publisher);
    const first = await env.DB.prepare(
      `SELECT object_key FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage = 'generating'
         AND stage_generation = 2 AND artifact_class = 'candidate_chunk'`,
    ).bind(fixture.runId).first<{ object_key: string }>();
    await env.ARTIFACTS!.delete(first!.object_key);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "artifact_integrity_failed",
    });
  });

  it("adopts an exact response-only artifact before spend and derives the missing chunk", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { ARTIFACTS: failThirdArtifactPut(env.ARTIFACTS!) },
    );

    expect(await deliver(fixture, publisher, undefined, crashingEnv)).toEqual({
      status: "retry",
      retryAfterSeconds: 301,
    });
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2
       ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { artifact_class: "generator_request" },
        { artifact_class: "generator_response" },
      ],
    });

    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(publisher.generateInvocations).toHaveBeenCalledTimes(1);
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1 });
    expect(await runRow(fixture.runId)).toMatchObject({ stage: "compiling" });
  });

  it("stores the exact complete credential-free provider request bytes for generator and evaluator", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [passingVerdict(fixture.records[0]!.id)],
    );
    await driveToGenerating(fixture, publisher);
    await deliver(fixture, publisher);

    const generatorRequest = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "generating", 2, 0, "generator_request"),
    );
    const generatorOptions = publisher.generateInvocations.mock.calls[0]![1];
    const generatorBytes = new TextDecoder().decode(generatorRequest!.plaintext);
    expect(generatorBytes).toBe(generatorOptions.requestBody);
    expect(JSON.parse(generatorBytes)).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: expect.any(String),
      max_output_tokens: 8000,
      text: { format: { strict: true } },
      input: expect.any(Array),
    });

    await deliver(fixture, publisher);
    await deliver(fixture, publisher);
    const evaluatorRequest = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "evaluating", 4, 0, "evaluator_request"),
    );
    const evaluatorOptions = publisher.evaluateInvocations.mock.calls[0]![1];
    const evaluatorBytes = new TextDecoder().decode(evaluatorRequest!.plaintext);
    expect(evaluatorBytes).toBe(evaluatorOptions.requestBody);
    expect(JSON.parse(evaluatorBytes)).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: expect.any(String),
      max_output_tokens: 4000,
      text: { format: { strict: true } },
      input: expect.any(Array),
    });
    for (const privateValue of [
      fixture.runId,
      "task-6-hermetic-provider-key",
      "authorization",
      "cf-aig-authorization",
      "object_key",
      "claim_token",
    ]) {
      expect(generatorBytes).not.toContain(privateValue);
      expect(evaluatorBytes).not.toContain(privateValue);
    }
  });

  it("never re-fetches an ambiguous generator request under the same attempt", async () => {
    const fixture = await reserveFixture();
    const successfulChunk = {
      schema_version: "0.7.0" as const,
      records: fixture.records,
      complete: true,
    };
    const publisher = new FakeOntologyPublisher([successfulChunk, successfulChunk]);
    await driveToGenerating(fixture, publisher);
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { ARTIFACTS: failSecondArtifactPut(env.ARTIFACTS!) },
    );

    expect(await deliver(fixture, publisher, undefined, crashingEnv)).toEqual({
      status: "retry",
      retryAfterSeconds: 301,
    });
    expect(publisher.generatorProviderCalls).toBe(1);
    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(fixture, publisher)).toEqual({
      status: "rescheduled",
      retryAfterSeconds: 60,
    });
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await runRow(fixture.runId)).toMatchObject({ stage_attempt: 1 });
    fixture.clock.advance(60_000);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(publisher.generatorProviderCalls).toBe(2);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 2, generator_calls: 2 });
    expect(await env.DB.prepare(
      `SELECT stage_attempt, artifact_class
       FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2
       ORDER BY stage_attempt, artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { stage_attempt: 0, artifact_class: "generator_request" },
        { stage_attempt: 1, artifact_class: "candidate_chunk" },
        { stage_attempt: 1, artifact_class: "generator_request" },
        { stage_attempt: 1, artifact_class: "generator_response" },
      ],
    });
  });

  it("fences a generator owner lost between request persistence and reservation", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [],
      {
        beforeReserve: async (pass) => {
          if (pass === "generator") {
            await releaseCrashedClaim(fixture.runId, fixture.clock.now());
          }
        },
      },
    );
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({ status: "duplicate" });
    expect(publisher.generatorProviderCalls).toBe(0);
    expect(await env.DB.prepare(
      `SELECT used_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toBeNull();
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2 ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [{ artifact_class: "generator_request" }],
    });
  });

  it("requires enough D1-current lease for generator timeout plus persistence and true-retries", async () => {
    const fixture = await reserveFixture({
      clockStartMs: Date.now() - 5 * 60_000 + 145_000,
    });
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({
      status: "rescheduled",
      retryAfterSeconds: 60,
    });
    expect(publisher.generatorProviderCalls).toBe(0);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_attempt: 1,
    });
    expect(await env.DB.prepare(
      `SELECT used_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toBeNull();
  });

  it("closes attempt fifteen when the claim has insufficient provider-call lease", async () => {
    const fixture = await reserveFixture({
      clockStartMs: Date.now() - 5 * 60_000 + 145_000,
    });
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const claim = await claimOntologyPipelineRun(
        fixture.pipelineEnv,
        await currentMessage(fixture.runId),
        fixture.clock.now(),
      );
      if (claim.status !== "claimed") throw new Error("expected live test claim");
      expect(await retryOntologyPipelineStage(
        fixture.pipelineEnv,
        claim,
        fixture.clock.now(),
      )).toBe(true);
    }

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(publisher.generatorProviderCalls).toBe(0);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "attempts_exhausted",
    });
  });

  it("closes an ambiguous request at the attempt ceiling without another fetch", async () => {
    const fixture = await reserveFixture();
    const successfulChunk = {
      schema_version: "0.7.0" as const,
      records: fixture.records,
      complete: true,
    };
    const publisher = new FakeOntologyPublisher([successfulChunk, successfulChunk]);
    await driveToGenerating(fixture, publisher);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const claim = await claimOntologyPipelineRun(
        fixture.pipelineEnv,
        await currentMessage(fixture.runId),
        fixture.clock.now(),
      );
      expect(claim.status, `claim retry attempt ${attempt}`).toBe("claimed");
      if (claim.status !== "claimed") throw new Error("expected owned retry claim");
      expect(await retryOntologyPipelineStage(
        fixture.pipelineEnv,
        claim,
        fixture.clock.now(),
      )).toBe(true);
    }
    expect(await runRow(fixture.runId)).toMatchObject({ stage_attempt: 15 });
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { ARTIFACTS: failSecondArtifactPut(env.ARTIFACTS!) },
    );
    expect(await deliver(fixture, publisher, undefined, crashingEnv)).toMatchObject({
      status: "retry",
    });
    expect(publisher.generatorProviderCalls).toBe(1);
    await releaseCrashedClaim(fixture.runId, fixture.clock.now());

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1 });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "attempts_exhausted",
    });
  });

  it("uses a new attempt identity for a true retry and charges each actual call once", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([
      { code: "publisher_unavailable", safe_detail_code: "network_error" },
      { schema_version: "0.7.0", records: fixture.records, complete: true },
    ]);
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "rescheduled" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 2,
      stage_attempt: 1,
    });
    fixture.clock.advance(60_000);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(publisher.generatorProviderCalls).toBe(2);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 2, generator_calls: 2 });
    expect(await env.DB.prepare(
      `SELECT stage_attempt, artifact_class
       FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2
       ORDER BY stage_attempt, artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { stage_attempt: 0, artifact_class: "generator_request" },
        { stage_attempt: 1, artifact_class: "candidate_chunk" },
        { stage_attempt: 1, artifact_class: "generator_request" },
        { stage_attempt: 1, artifact_class: "generator_response" },
      ],
    });
  });

  it("adopts an evaluator response-only artifact and derives the missing verdict", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [passingVerdict(fixture.records[0]!.id)],
    );
    await driveToEvaluating(fixture, publisher);
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { ARTIFACTS: failThirdArtifactPut(env.ARTIFACTS!) },
    );

    expect(await deliver(fixture, publisher, undefined, crashingEnv)).toEqual({
      status: "retry",
      retryAfterSeconds: 301,
    });
    expect(publisher.evaluatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage = 'evaluating' AND stage_generation = 4
       ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [
        { artifact_class: "evaluator_request" },
        { artifact_class: "evaluator_response" },
      ],
    });

    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(publisher.evaluateInvocations).toHaveBeenCalledTimes(1);
    expect(publisher.evaluatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls, evaluator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({
      used_calls: 2,
      generator_calls: 1,
      evaluator_calls: 1,
    });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_generation: 5,
      stage_cursor: 1,
    });
  });

  it("never re-fetches an ambiguous evaluator request under the same attempt", async () => {
    const fixture = await reserveFixture();
    const verdict = passingVerdict(fixture.records[0]!.id);
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [verdict, verdict],
    );
    await driveToEvaluating(fixture, publisher);
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { ARTIFACTS: failSecondArtifactPut(env.ARTIFACTS!) },
    );

    expect(await deliver(fixture, publisher, undefined, crashingEnv)).toEqual({
      status: "retry",
      retryAfterSeconds: 301,
    });
    expect(publisher.evaluatorProviderCalls).toBe(1);
    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(fixture, publisher)).toEqual({
      status: "rescheduled",
      retryAfterSeconds: 60,
    });
    expect(publisher.evaluatorProviderCalls).toBe(1);
    expect(await runRow(fixture.runId)).toMatchObject({ stage_attempt: 1 });
    fixture.clock.advance(60_000);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(publisher.evaluatorProviderCalls).toBe(2);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls, evaluator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 3, generator_calls: 1, evaluator_calls: 2 });
  });

  it("fences an evaluator owner lost between request persistence and reservation", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [passingVerdict(fixture.records[0]!.id)],
      {
        beforeReserve: async (pass) => {
          if (pass === "evaluator") {
            await releaseCrashedClaim(fixture.runId, fixture.clock.now());
          }
        },
      },
    );
    await driveToEvaluating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({ status: "duplicate" });
    expect(publisher.evaluatorProviderCalls).toBe(0);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls, evaluator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1, evaluator_calls: 0 });
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage = 'evaluating' AND stage_generation = 4
       ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [{ artifact_class: "evaluator_request" }],
    });
  });

  it("requires enough D1-current lease for evaluator timeout plus persistence", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [passingVerdict(fixture.records[0]!.id)],
    );
    await driveToEvaluating(fixture, publisher);
    const shortLeaseEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      { DB: shortenClaimLease(env.DB, 145_000) },
    );

    expect(await executeOntologyPipelineDelivery(
      shortLeaseEnv,
      await currentMessage(fixture.runId),
      { publisher, clock: fixture.clock.now },
    )).toEqual({ status: "rescheduled", retryAfterSeconds: 60 });
    expect(publisher.evaluatorProviderCalls).toBe(0);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_attempt: 1,
    });
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls, evaluator_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1, evaluator_calls: 0 });
  });

  it("cannot persist or transition if ownership is lost after fenced reservation", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [],
      {
        afterReserve: async (pass) => {
          if (pass === "generator") {
            await releaseCrashedClaim(fixture.runId, fixture.clock.now());
          }
        },
      },
    );
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toEqual({ status: "duplicate" });
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1 });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
      stage_attempt: 0,
    });
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = 2 ORDER BY artifact_class`,
    ).bind(fixture.runId).all()).toMatchObject({
      results: [{ artifact_class: "generator_request" }],
    });
  });

  it("fails closed on budget exhaustion without a second provider call or charge", async () => {
    const fixture = await reserveFixture({ dailyLimit: 1 });
    const publisher = new FakeOntologyPublisher([
      { code: "publisher_unavailable", safe_detail_code: "network_error" },
      { schema_version: "0.7.0", records: fixture.records, complete: true },
    ]);
    await driveToGenerating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "rescheduled" });
    fixture.clock.advance(60_000);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "terminal" });
    expect(publisher.generateInvocations).toHaveBeenCalledTimes(2);
    expect(publisher.generatorProviderCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ used_calls: 1, generator_calls: 1 });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "provider_budget_exhausted",
    });
  });

  it("stores compiler rejection evidence and never drops the bad record", async () => {
    const fixture = await reserveFixture();
    fixture.records[1]!.feature_predicate = {
      type: "aspect",
      body_a: "moon",
      body_b: "sun",
      aspect: "square",
    };
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);
    await deliver(fixture, publisher);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "compilation_failed",
    });
    const report = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "compiling", 3, 0, "compilation_report"),
    );
    expect(JSON.parse(new TextDecoder().decode(report!.plaintext))).toMatchObject({
      compiler_passed: false,
      finding_codes: ["noncanonical_aspect"],
    });
    const candidate = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "compiling", 3, 0, "candidate_release"),
    );
    expect((JSON.parse(new TextDecoder().decode(candidate!.plaintext)) as {
      records: unknown[];
    }).records).toHaveLength(6);
  });

  it("makes exactly one evaluator call per frozen rule and never retries rejection", async () => {
    const fixture = await reserveFixture();
    const evaluatorFixtures = fixture.records.map((item, index) =>
      index === 1 ? rejectingVerdict(item.id) : passingVerdict(item.id));
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      evaluatorFixtures,
    );
    await driveToEvaluating(fixture, publisher);

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "evaluating",
      stage_cursor: 1,
    });
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "terminal" });
    const failed = await runRow(fixture.runId);
    expect(failed).toMatchObject({
      stage: "failed",
      failure_class: "evaluation_rejected",
      stage_attempt: 0,
    });
    expect(publisher.evaluatorProviderCalls).toBe(2);

    expect(await deliver(
      fixture,
      publisher,
      { run_id: fixture.runId, stage_generation: 5 },
    )).toEqual({ status: "duplicate" });
    expect(publisher.evaluatorProviderCalls).toBe(2);
    const failedAt = Date.parse(failed.failed_at as string);
    const expiresAt = Date.parse(failed.failed_artifact_expires_at as string);
    expect(expiresAt - failedAt).toBe(7 * 24 * 60 * 60 * 1_000);
    const expiries = await env.DB.prepare(
      `SELECT DISTINCT expires_at FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ?`,
    ).bind(fixture.runId).all<{ expires_at: string }>();
    expect(expiries.results).toEqual([
      { expires_at: failed.failed_artifact_expires_at },
    ]);
  });

  it("evaluates exactly 64 ordered rules and never makes call 65", async () => {
    const fixture = await reserveFixture();
    fixture.records = expandedRecords(fixture.records, 64);
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      fixture.records.map((record) => passingVerdict(record.id)),
    );
    await driveToEvaluating(fixture, publisher);

    while ((await runRow(fixture.runId)).stage === "evaluating") {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      evaluation_report_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(publisher.evaluatorProviderCalls).toBe(64);
    expect(publisher.evaluateInvocations).toHaveBeenCalledTimes(64);
  }, 20_000);

  it("refuses evaluator call 65 after a retry of rule zero before fetch", async () => {
    const fixture = await reserveFixture();
    fixture.records = expandedRecords(fixture.records, 64);
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      [
        { code: "publisher_unavailable", safe_detail_code: "network_error" },
        passingVerdict(fixture.records[0]!.id),
        ...fixture.records.slice(1).map((record) => passingVerdict(record.id)),
      ],
    );
    await driveToEvaluating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "rescheduled" });
    fixture.clock.advance(60_000);
    while (
      (await runRow(fixture.runId)).stage === "evaluating" &&
      (await runRow(fixture.runId)).stage_cursor !== 63
    ) {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }

    expect(await deliver(fixture, publisher)).toEqual({ status: "terminal" });
    expect(publisher.evaluatorProviderCalls).toBe(64);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "attempts_exhausted",
      stage_cursor: 63,
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'evaluator_request'`,
    ).bind(fixture.runId).first()).toEqual({ count: 64 });
    expect(await env.DB.prepare(
      `SELECT evaluator_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ evaluator_calls: 64 });
  }, 30_000);

  it("stores the canonical attempt-zero report and stops before regression or success", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      fixture.records.map((item) => passingVerdict(item.id)),
    );
    await driveToEvaluating(fixture, publisher);
    while ((await runRow(fixture.runId)).stage === "evaluating") {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }

    const row = await runRow(fixture.runId);
    expect(row).toMatchObject({
      stage: "regressing",
      stage_cursor: 0,
      stage_attempt: 0,
      evaluation_report_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      succeeded_at: null,
    });
    expect(publisher.evaluatorProviderCalls).toBe(fixture.records.length);
    const reportCoordinate = coordinate(
      fixture.runId,
      "evaluating",
      9,
      0,
      "evaluation_report",
    );
    const report = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      reportCoordinate,
    );
    expect(report!.artifact.objectKey).toBe(
      `pattern-ontology/pipeline/${fixture.runId}/evaluation-report.enc`,
    );
    expect(report!.artifact.plaintextSha256).toBe(row.evaluation_report_hash);
    const parsed = JSON.parse(new TextDecoder().decode(report!.plaintext));
    expect(canonicalJson(parsed)).toBe(new TextDecoder().decode(report!.plaintext));
    expect(parsed).toMatchObject({
      ontology_version: fixture.version,
      compiler_passed: true,
      evaluator_passed: true,
      unevaluated_fixture_count: 0,
      configuration_equal: true,
      regression: { minimum_pass_rate: 1 },
    });
    expect(parsed.ordered_rule_verdicts.map((entry: { rule_id: string }) => entry.rule_id))
      .toEqual(fixture.records.map((item) => item.id));
    const envelope = JSON.parse(
      await (await env.ARTIFACTS!.get(report!.artifact.objectKey))!.text(),
    );
    expect(envelope.schema_version).toBe("ontology-evaluation-artifact/v1");

    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_evidence
       WHERE run_id = ?`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage IN ('regressing', 'signing', 'ingesting')`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
  });

  it("does not add a mandatory-coverage gate before the existing regression", async () => {
    const fixture = await reserveFixture();
    const mandatoryMoon = loadOntologyRegressionCorpus().fixtures[0]!.features
      .find((feature) =>
        feature.feature_class === "position" && feature.body === "moon"
      );
    expect(mandatoryMoon).toBeDefined();
    expect(fixture.records.some((record) =>
      ontologyRecordMatchesFeature(record, mandatoryMoon!)
    )).toBe(false);
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      fixture.records.map((record) => passingVerdict(record.id)),
    );
    await driveToEvaluating(fixture, publisher);
    while ((await runRow(fixture.runId)).stage === "evaluating") {
      expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    }
    expect(await runRow(fixture.runId)).toMatchObject({ stage: "regressing" });

    const patternPublisher = new FakeRegressionPatternPublisher();
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toMatchObject({ status: "advanced" });

    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      stage_cursor: 1,
      failure_class: null,
      regression_report_hash: null,
      bundle_hash: null,
    });
    expect(patternPublisher.providerCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'regression_request'`,
    ).bind(fixture.runId).first()).toEqual({ count: 1 });
  }, 60_000);

  it("adopts a persisted regression response after a result-write crash without another call", async () => {
    const { fixture, publisher } = await driveActivationToRegression();
    const patternPublisher = new FakeRegressionPatternPublisher();
    const coordinateRow = await runRow(fixture.runId);
    const stageGeneration = coordinateRow.stage_generation as number;
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      {
        ARTIFACTS: failThirdArtifactPut(env.ARTIFACTS!),
        PATTERN_ONTOLOGY_KEYS: fixture.pipelineEnv.PATTERN_ONTOLOGY_KEYS,
      },
    );

    expect(await deliver(
      fixture,
      publisher,
      undefined,
      crashingEnv,
      patternPublisher,
    )).toEqual({ status: "retry", retryAfterSeconds: 301 });
    expect(patternPublisher.providerCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT artifact_class FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = ? ORDER BY artifact_class`,
    ).bind(fixture.runId, stageGeneration).all()).toMatchObject({
      results: [
        { artifact_class: "regression_request" },
        { artifact_class: "regression_response" },
      ],
    });

    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toMatchObject({ status: "advanced" });
    expect(patternPublisher.providerCalls).toBe(1);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      stage_cursor: 1,
      stage_attempt: 0,
    });
    const state = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(
        fixture.runId,
        "regressing",
        stageGeneration,
        0,
        "regression_result",
      ),
    );
    expect(JSON.parse(new TextDecoder().decode(state!.plaintext))).toMatchObject({
      phase: "writer",
      provider_calls: 1,
      planner_calls: 1,
    });
  }, 60_000);

  it("refuses a regression value that does not match the exact provider response", async () => {
    const { fixture, publisher } = await driveActivationToRegression();
    const patternPublisher = new FakeRegressionPatternPublisher(
      undefined,
      "planner",
    );

    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "provider_response_invalid",
      regression_report_hash: null,
    });
    expect(patternPublisher.providerCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'regression_result'`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
  }, 60_000);

  it("treats a request-only regression crash as one ambiguous call and retries once", async () => {
    const { fixture, publisher } = await driveActivationToRegression();
    const patternPublisher = new FakeRegressionPatternPublisher();
    const coordinateRow = await runRow(fixture.runId);
    const stageGeneration = coordinateRow.stage_generation as number;
    const crashingEnv = configuredEnv(
      fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      {
        ARTIFACTS: failSecondArtifactPut(env.ARTIFACTS!),
        PATTERN_ONTOLOGY_KEYS: fixture.pipelineEnv.PATTERN_ONTOLOGY_KEYS,
      },
    );

    expect(await deliver(
      fixture,
      publisher,
      undefined,
      crashingEnv,
      patternPublisher,
    )).toEqual({ status: "retry", retryAfterSeconds: 301 });
    expect(patternPublisher.providerCalls).toBe(1);
    await releaseCrashedClaim(fixture.runId, fixture.clock.now());
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "rescheduled", retryAfterSeconds: 60 });
    expect(patternPublisher.providerCalls).toBe(1);
    fixture.clock.advance(60_000);
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toMatchObject({ status: "advanced" });
    expect(patternPublisher.providerCalls).toBe(2);
    const state = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(
        fixture.runId,
        "regressing",
        stageGeneration,
        1,
        "regression_result",
      ),
    );
    expect(JSON.parse(new TextDecoder().decode(state!.plaintext))).toMatchObject({
      phase: "writer",
      provider_calls: 2,
      planner_calls: 2,
    });
    expect(await env.DB.prepare(
      `SELECT regression_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ regression_calls: 2 });
  }, 60_000);

  it("routes a prohibited claim through the remaining writer correction loop", async () => {
    const { fixture, publisher } = await driveActivationToRegression();
    let writerCalls = 0;
    const patternPublisher = new FakeRegressionPatternPublisher((writer) => {
      writerCalls += 1;
      if (writerCalls === 1) {
        writer.chapters[0]!.sections[0]!.text +=
          " This placement guarantees a future medical diagnosis.";
      }
    });
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toMatchObject({ status: "advanced" });
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toMatchObject({ status: "advanced" });
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      failure_class: null,
      regression_report_hash: null,
      bundle_hash: null,
    });
    expect(patternPublisher.providerCalls).toBe(3);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class IN ('unsigned_bundle', 'signed_bundle')`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
    const resultRow = await env.DB.prepare(
      `SELECT stage_generation, stage_attempt FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'regression_result'
       ORDER BY stage_generation DESC LIMIT 1`,
    ).bind(fixture.runId).first<{
      stage_generation: number;
      stage_attempt: number;
    }>();
    const result = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(
        fixture.runId,
        "regressing",
        resultRow!.stage_generation,
        resultRow!.stage_attempt,
        "regression_result",
      ),
    );
    expect(JSON.parse(new TextDecoder().decode(result!.plaintext))).toMatchObject({
      complete: false,
      phase: "writer",
      correction: {
        attempt: 1,
        items: [{
          code: "prohibited_claim",
          origin: "deterministic",
        }],
      },
    });

    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "advanced" });
    const correctedWriterInput = patternPublisher.writeInvocations.mock.calls[1]![0] as {
      correction?: {
        attempt: number;
        items: Array<{ code: string; origin: string }>;
        preserve: { plan_hash: string };
      };
    };
    expect(correctedWriterInput.correction).toMatchObject({
      attempt: 1,
      items: [{ code: "prohibited_claim", origin: "deterministic" }],
      preserve: { plan_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "regressing",
      failure_class: null,
      regression_report_hash: null,
      bundle_hash: null,
    });
    expect(patternPublisher.providerCalls).toBe(5);
    const correctedResultRow = await env.DB.prepare(
      `SELECT stage_generation, stage_attempt FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'regression_result'
       ORDER BY stage_generation DESC LIMIT 1`,
    ).bind(fixture.runId).first<{
      stage_generation: number;
      stage_attempt: number;
    }>();
    const correctedResult = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(
        fixture.runId,
        "regressing",
        correctedResultRow!.stage_generation,
        correctedResultRow!.stage_attempt,
        "regression_result",
      ),
    );
    expect(JSON.parse(new TextDecoder().decode(correctedResult!.plaintext))).toMatchObject({
      complete: true,
      phase: "complete",
      result: {
        accepted: true,
        hard_gate_failures: [],
        provider_calls: 5,
      },
    });
    expect(await env.DB.prepare(
      `SELECT regression_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ regression_calls: 5 });
  }, 60_000);

  it("keeps a prohibited claim terminal after writer corrections are exhausted", async () => {
    const { fixture, publisher } = await driveActivationToRegression();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const patternPublisher = new FakeRegressionPatternPublisher((writer) => {
      writer.chapters[0]!.sections[0]!.text +=
        " This placement guarantees a future medical diagnosis.";
    });

    for (let delivery = 0; delivery < 6; delivery += 1) {
      expect(await deliver(
        fixture,
        publisher,
        undefined,
        fixture.pipelineEnv,
        patternPublisher,
      )).toEqual({ status: "advanced" });
    }
    expect(await deliver(
      fixture,
      publisher,
      undefined,
      fixture.pipelineEnv,
      patternPublisher,
    )).toEqual({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "regression_failed",
      regression_report_hash: null,
      bundle_hash: null,
    });
    expect(patternPublisher.providerCalls).toBe(7);
    expect(await env.DB.prepare(
      `SELECT regression_calls FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({ regression_calls: 7 });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class IN ('unsigned_bundle', 'signed_bundle')`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
    expect(warn).toHaveBeenCalledWith(
      "ontology_regression_hard_gate_failed",
      {
        trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
        fixture_index: 0,
        pass: "verifier",
        hard_gate_failures: ["prohibited_claim"],
      },
    );
  }, 60_000);

  it("runs all 30 fixtures one provider pass per delivery, signs, and activates", async () => {
    const sliceAVersion = `ontology-slice-a-${crypto.randomUUID()}`;
    await seedActiveOntology(sliceAVersion);
    const { fixture, publisher } = await driveActivationToRegression();
    const frozen = await env.DB.prepare(
      `SELECT configuration_json
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(fixture.runId).first<{ configuration_json: string }>();
    expect((JSON.parse(frozen!.configuration_json) as {
      generator_input: { active_machine_predecessor: unknown };
    }).generator_input.active_machine_predecessor).toBeNull();

    const patternPublisher = new FakeRegressionPatternPublisher();
    let regressionDeliveries = 0;
    while ((await runRow(fixture.runId)).stage === "regressing") {
      const before = patternPublisher.providerCalls;
      const outcome = await deliver(
        fixture,
        publisher,
        undefined,
        fixture.pipelineEnv,
        patternPublisher,
      );
      const afterDelivery = await runRow(fixture.runId);
      expect(
        afterDelivery.failure_class,
        `regression delivery ${regressionDeliveries}`,
      ).toBeNull();
      expect({
        outcome,
        row: afterDelivery,
        regressionDeliveries,
      }).toMatchObject({ outcome: { status: "advanced" } });
      expect(patternPublisher.providerCalls - before).toBe(1);
      regressionDeliveries += 1;
    }
    expect(regressionDeliveries).toBe(90);
    expect(patternPublisher.providerCalls).toBe(90);
    expect(patternPublisher.planInvocations).toHaveBeenCalledTimes(30);
    expect(patternPublisher.writeInvocations).toHaveBeenCalledTimes(30);
    expect(patternPublisher.verifyInvocations).toHaveBeenCalledTimes(30);
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "signing",
      regression_report_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });

    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "ingesting",
      bundle_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    const succeeded = await runRow(fixture.runId);
    expect(succeeded).toMatchObject({
      stage: "succeeded",
      failure_class: null,
      succeeded_at: expect.any(String),
    });

    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'regression_request'`,
    ).bind(fixture.runId).first()).toEqual({ count: 90 });
    expect(await env.DB.prepare(
      `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
       FROM pattern_ontology_provider_daily_usage`,
    ).first()).toEqual({
      used_calls: 1 + fixture.records.length + 90,
      generator_calls: 1,
      evaluator_calls: fixture.records.length,
      regression_calls: 90,
    });
    const active = await env.DB.prepare(
      `SELECT r.status, r.object_key, r.evaluation_json
       FROM pattern_ontology_pointer p
       JOIN pattern_ontology_releases r ON r.version = p.active_version
       WHERE p.id = 1`,
    ).first<{
      status: string;
      object_key: string;
      evaluation_json: string;
    }>();
    expect(active?.status).toBe("active");
    const stored = JSON.parse(
      await (await env.ARTIFACTS!.get(active!.object_key))!.text(),
    ) as SignedOntologyRelease;
    expect(stored).toMatchObject({
      status: "candidate",
      bundle_hash: succeeded.bundle_hash,
      evaluation: {
        regression_passed: true,
        evaluation_report_hash: succeeded.evaluation_report_hash,
        regression_report_hash: succeeded.regression_report_hash,
      },
      signature: { key_id: env.TEST_ONTOLOGY_SIGNER_KEY_ID },
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_evidence
       WHERE run_id = ? AND bundle_hash = ?`,
    ).bind(fixture.runId, succeeded.bundle_hash).first()).toEqual({ count: 1 });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    ).bind(sliceAVersion).first()).toEqual({ status: "recalled" });
  }, 60_000);

  it("fails a claim transaction closed without acquiring a receipt", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([]);
    const db = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          return target.prepare(query);
        };
      },
    });
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "batch") return Reflect.get(target, property, receiver);
        return async () => { throw new Error("injected claim D1 failure"); };
      },
    });
    const failingEnv = configuredEnv(fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE, { DB: failingDb });

    expect(await deliver(fixture, publisher, undefined, failingEnv)).toEqual({
      status: "retry",
      retryAfterSeconds: 301,
    });
    expect(await env.DB.prepare(
      `SELECT claim_token, lease_expires_at FROM pattern_ontology_pipeline_runs
       WHERE run_id = ?`,
    ).bind(fixture.runId).first()).toEqual({
      claim_token: null,
      lease_expires_at: null,
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE resource_id = ? AND action = 'ontology_pipeline.claim_acquired'`,
    ).bind(fixture.runId).first()).toEqual({ count: 0 });
  });

  it("writes a Task 9-readable attempt-scoped report after a true final-rule retry", async () => {
    const fixture = await reserveFixture();
    const evaluation: ProviderFixture<OntologyRuleVerdict>[] = fixture.records
      .slice(0, -1)
      .map((item) => passingVerdict(item.id));
    evaluation.push(
      { code: "publisher_unavailable", safe_detail_code: "request_timeout" },
      passingVerdict(fixture.records.at(-1)!.id),
    );
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      evaluation,
    );
    await driveToEvaluating(fixture, publisher);
    for (let index = 0; index < fixture.records.length - 1; index += 1) {
      await deliver(fixture, publisher);
    }
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "rescheduled" });
    const retryRow = await runRow(fixture.runId);
    expect(retryRow).toMatchObject({
      stage: "evaluating",
      stage_cursor: fixture.records.length - 1,
      stage_attempt: 1,
    });
    fixture.clock.advance(60_000);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
    const final = await runRow(fixture.runId);
    expect(final).toMatchObject({ stage: "regressing" });

    const report = await readOntologyPipelineArtifact(
      fixture.pipelineEnv,
      coordinate(fixture.runId, "evaluating", 9, 1, "evaluation_report"),
    );
    expect(report!.artifact.plaintextSha256).toBe(final.evaluation_report_hash);
    expect(report!.artifact.objectKey).toMatch(/\/opart_[a-f0-9]{40}\.enc$/);
    const envelope = JSON.parse(
      await (await env.ARTIFACTS!.get(report!.artifact.objectKey))!.text(),
    );
    expect(envelope).toMatchObject({
      schema_version: "ontology-pipeline-artifact/v1",
      artifact_class: "evaluation_report",
      run_id: fixture.runId,
      stage: "evaluating",
      stage_attempt: 1,
    });
    expect(publisher.evaluatorProviderCalls).toBe(fixture.records.length + 1);
  });
});
