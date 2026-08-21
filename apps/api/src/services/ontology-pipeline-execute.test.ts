import { env } from "cloudflare:test";
import {
  canonicalJson,
  contentHash,
  type PatternOntologyRecord,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTestCorpusManifest,
  testOntologyPipelineArtifactKeyring,
  type TestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import {
  claimOntologyPipelineRun,
  retryOntologyPipelineStage,
} from "../db/ontology-pipeline.js";
import {
  enqueueOntologyPipelineRun,
} from "./ontology-pipeline-enqueue.js";
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
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";

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
    this.generateInvocations(_packet);
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
    this.evaluateInvocations(_packet);
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
    prohibited_claims: ["No diagnosis, prediction, fate, or biography."],
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
  const values = {
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
  options: { dailyLimit?: number; clockStartMs?: number } = {},
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

function delayNamedStageCas(db: D1Database, milliseconds: number): D1Database {
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
                      await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    const first = JSON.parse(firstText);
    const second = JSON.parse(secondText);
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
    });
    expect(secondText).not.toBe(firstText);
    for (const forbidden of [fixture.runId, "stage_generation", "object_key", "oprun_"]) {
      expect(secondText).not.toContain(forbidden);
    }
    expect(publisher.generateInvocations.mock.calls[0]![0].serialized).toBe(firstText);
    expect(publisher.generateInvocations.mock.calls[1]![0].serialized).toBe(secondText);
  });

  it("closes complete=false on chunk sixteen before a seventeenth call or cursor", async () => {
    const fixture = await reserveFixture();
    const records = expandedRecords(fixture.records, 16);
    const publisher = new FakeOntologyPublisher(records.map((record) => ({
      schema_version: "0.7.0" as const,
      records: [record],
      complete: false,
    })));
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
  });

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

  it("cannot transition after final artifact persistence when the lease expires", async () => {
    const fixture = await reserveFixture({
      clockStartMs: Date.now() - 5 * 60_000 + 2_000,
    });
    const publisher = new FakeOntologyPublisher([{
      schema_version: "0.7.0",
      records: fixture.records,
      complete: true,
    }]);
    await driveToGenerating(fixture, publisher);
    const delayedEnv = configuredEnv(fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE, {
      DB: delayNamedStageCas(env.DB, 2_200),
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

  it("parks Task 7 stages before claim through more than sixteen recovery cycles", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher(
      [{ schema_version: "0.7.0", records: fixture.records, complete: true }],
      fixture.records.map((record) => passingVerdict(record.id)),
    );
    await driveToEvaluating(fixture, publisher);
    while ((await runRow(fixture.runId)).stage === "evaluating") {
      await deliver(fixture, publisher);
    }
    const message = await currentMessage(fixture.runId);
    const before = await runRow(fixture.runId);
    const receiptsBefore = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE resource_id = ? AND action = 'ontology_pipeline.claim_acquired'`,
    ).bind(fixture.runId).first<{ count: number }>();

    for (let cycle = 0; cycle < 17; cycle += 1) {
      expect(await deliver(fixture, publisher, message)).toEqual({
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
    }
    const after = await runRow(fixture.runId);
    const receiptsAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE resource_id = ? AND action = 'ontology_pipeline.claim_acquired'`,
    ).bind(fixture.runId).first<{ count: number }>();
    expect(after).toEqual(before);
    expect(receiptsAfter).toEqual(receiptsBefore);
    expect(await deliver(fixture, publisher, {
      run_id: fixture.runId,
      stage_generation: message.stage_generation - 1,
    })).toEqual({ status: "duplicate" });
  });

  it("fails a pre-claim stage lookup closed without acquiring a receipt", async () => {
    const fixture = await reserveFixture();
    const publisher = new FakeOntologyPublisher([]);
    const db = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          if (query.includes("ontology_pipeline_preclaim_stage")) {
            throw new Error("injected preclaim D1 failure");
          }
          return target.prepare(query);
        };
      },
    });
    const failingEnv = configuredEnv(fixture.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE, { DB: db });

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
