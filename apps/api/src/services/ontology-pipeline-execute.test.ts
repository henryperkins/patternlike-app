import { env } from "cloudflare:test";
import {
  canonicalJson,
  contentHash,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTestCorpusManifest,
  testOntologyPipelineArtifactKeyring,
  type TestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import { enqueueOntologyPipelineRun } from "./ontology-pipeline-enqueue.js";
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

class FakeOntologyPublisher implements OntologyPublisher {
  readonly generateInvocations = vi.fn();
  readonly evaluateInvocations = vi.fn();
  generatorProviderCalls = 0;
  evaluatorProviderCalls = 0;

  constructor(
    readonly generation: ProviderFixture<OntologyGenerationChunk>[],
    readonly evaluation: ProviderFixture<OntologyRuleVerdict>[] = [],
  ) {}

  async generate(
    _packet: Parameters<OntologyPublisher["generate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyGenerationChunk>> {
    this.generateInvocations();
    const reserved = await options.reserve("generator");
    if (!reserved.ok) return budgetExhausted();
    this.generatorProviderCalls += 1;
    const fixture = this.generation.shift();
    if (!fixture) throw new Error("missing generator fixture");
    if ("code" in fixture) return providerFailure(fixture);
    return providerSuccess("generator", fixture, this.generatorProviderCalls);
  }

  async evaluate(
    _packet: Parameters<OntologyPublisher["evaluate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyRuleVerdict>> {
    this.evaluateInvocations();
    const reserved = await options.reserve("evaluator");
    if (!reserved.ok) return budgetExhausted();
    this.evaluatorProviderCalls += 1;
    const fixture = this.evaluation.shift();
    if (!fixture) throw new Error("missing evaluator fixture");
    if ("code" in fixture) return providerFailure(fixture);
    return providerSuccess("evaluator", fixture, this.evaluatorProviderCalls);
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

async function providerSuccess<T>(
  pass: "generator" | "evaluator",
  value: T,
  call: number,
): Promise<OntologyPassOutcome<T>> {
  const raw = JSON.stringify({
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
      provider: "openai",
      pass,
      model: "gpt-5.6-sol",
      prompt_version: pass === "generator" ? "1.0.0" : "1.0.0-evaluator",
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
    { type: "position", body: "sun" },
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
    prohibited_claims: [],
    salience_band: "medium",
    presentation_priority: 50 + index,
    cluster_tags: [featurePredicate.type],
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
  return Object.assign(Object.create(env), {
    ONTOLOGY_PIPELINE_QUEUE: queue,
    ONTOLOGY_PIPELINE_ARTIFACT_KEYRING:
      testOntologyPipelineArtifactKeyring(),
    ONTOLOGY_PIPELINE_ROLLOUT: "internal",
    ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS: "1",
    OPENAI_ONTOLOGY_GENERATOR_MODEL: "gpt-5.6-sol",
    OPENAI_ONTOLOGY_GENERATOR_REASONING: "high",
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.0",
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
  }) as Env;
}

class TestClock {
  private value = Date.now() - 120_000;

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
  options: { dailyLimit?: number } = {},
): Promise<ReservedFixture> {
  const suffix = crypto.randomUUID();
  const releaseId = `corpus-task-6-${suffix}`;
  const manifest = await buildTestCorpusManifest(
    releaseId,
    "en-US",
    "internal_synthetic",
  );
  await registerOntologyCorpus(env, manifest);
  const { queue } = fakeQueue();
  const pipelineEnv = configuredEnv(queue, {
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT:
      String(options.dailyLimit ?? 500),
  });
  const clock = new TestClock();
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

async function runRow(runId: string): Promise<Record<string, unknown>> {
  return (await env.DB.prepare(
    `SELECT stage, stage_generation, stage_cursor, stage_attempt,
            failure_class, candidate_hash, compilation_report_hash,
            evaluation_report_hash, failed_at, failed_artifact_expires_at,
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
): Promise<OntologyPipelineExecuteOutcome> {
  return executeOntologyPipelineDelivery(
    envOverride,
    message ?? await currentMessage(fixture.runId),
    { publisher, clock: fixture.clock.now },
  );
}

async function driveToGenerating(
  fixture: ReservedFixture,
  publisher: OntologyPublisher,
): Promise<void> {
  expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
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
  expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
  expect(await runRow(fixture.runId)).toMatchObject({
    stage: "compiling",
    stage_generation: 3,
    stage_cursor: 0,
    candidate_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
  });
  expect(await deliver(fixture, publisher)).toMatchObject({ status: "advanced" });
  expect(await runRow(fixture.runId)).toMatchObject({
    stage: "evaluating",
    stage_generation: 4,
    stage_cursor: 0,
    compilation_report_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
  });
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

describe("ontology pipeline execution prefix", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM pattern_ontology_provider_daily_usage").run();
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

  it("does not trust complete=true until frozen coverage is complete", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records.slice(0, 5),
      complete: true,
    }]);

    await driveToGenerating(fixture, publisher);
    expect(await deliver(fixture, publisher)).toMatchObject({ status: "terminal" });
    expect(await runRow(fixture.runId)).toMatchObject({
      stage: "failed",
      failure_class: "candidate_invalid",
    });
    expect(publisher.generatorProviderCalls).toBe(1);
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
