import { env, SELF } from "cloudflare:test";
import {
  canonicalJson,
  contentHash,
  type PatternFactPacket,
  type PatternOntologyRecord,
  type PatternPlan,
  type PatternSemanticVerdict,
  type PatternTransformationClass,
  type PatternWriterOutput,
} from "@patternlike/shared";
import {
  buildDeterministicPlan,
  buildDeterministicWriterOutput,
  ontologyRecordMatchesFeature,
} from "@patternlike/pattern-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  buildTestCorpusManifest,
  testOntologyPipelineArtifactKeyring,
  type TestCorpusLicenseClass,
  type TestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import { loadActiveOntology } from "../db/pattern-ontology.js";
import {
  enqueueOntologyPipelineRun,
} from "./ontology-pipeline-enqueue.js";
import {
  executeOntologyPipelineDelivery,
  type OntologyPipelineExecuteOutcome,
} from "./ontology-pipeline-execute.js";
import type {
  OntologyGenerationChunk,
  OntologyPassOptions,
  OntologyPassOutcome,
  OntologyPublisher,
  OntologyRuleVerdict,
} from "./ontology-publisher.js";
import {
  loadOntologyRegressionCorpus,
} from "./ontology-regression.js";
import { executePatternJob } from "./pattern-execute.js";
import type {
  PatternPassOptions,
  PatternPassOutcome,
  PatternPublisher,
} from "./pattern-publisher.js";
import { evaluateSemanticVerdict } from "./pattern-semantic.js";

const ALL_TRANSFORMATIONS: PatternTransformationClass[] = [
  "intersection",
  "contrast",
  "tension",
  "counterbalance",
  "developmental_arc",
  "expression_range",
  "shared_motif",
];

class TestClock {
  private value = Date.now() - 120_000;

  now = (): Date => {
    this.value += 10;
    return new Date(this.value);
  };
}

function reservationRefused<T>(
  reserved: { ok: false; reason?: string },
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
  return {
    ok: false,
    code: "publisher_budget_exhausted",
    safe_detail_code: "daily_call_limit_reached",
    retry_after_seconds: null,
    origin_layer: "none",
  };
}

async function ontologySuccess<T>(
  pass: "generator" | "evaluator",
  value: T,
  call: number,
): Promise<OntologyPassOutcome<T>> {
  const id = `resp_task_10_${pass}_${call}`;
  const raw = JSON.stringify({
    id,
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
      prompt_version: pass === "generator" ? "1.0.3" : "1.0.0-evaluator",
      provider_request_id: id,
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

class IntegrationOntologyPublisher implements OntologyPublisher {
  generatorCalls = 0;
  evaluatorCalls = 0;

  constructor(
    private readonly records: PatternOntologyRecord[],
    private readonly rejectedRuleId: string | null = null,
  ) {}

  async generate(
    _packet: Parameters<OntologyPublisher["generate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyGenerationChunk>> {
    const reserved = await options.reserve("generator");
    if (!reserved.ok) return reservationRefused(reserved);
    this.generatorCalls += 1;
    return ontologySuccess(
      "generator",
      {
        schema_version: "0.7.0",
        records: this.records,
        complete: true,
      },
      this.generatorCalls,
    );
  }

  async evaluate(
    packet: Parameters<OntologyPublisher["evaluate"]>[0],
    options: OntologyPassOptions,
  ): Promise<OntologyPassOutcome<OntologyRuleVerdict>> {
    const reserved = await options.reserve("evaluator");
    if (!reserved.ok) return reservationRefused(reserved);
    this.evaluatorCalls += 1;
    const ruleId = packet.document.rule.id;
    const verdict = passingVerdict(ruleId);
    if (ruleId === this.rejectedRuleId) {
      verdict.verdict = "reject";
      verdict.dimensions.unsupported_expansion = "reject";
    }
    return ontologySuccess("evaluator", verdict, this.evaluatorCalls);
  }
}

class IntegrationPatternPublisher implements PatternPublisher {
  providerCalls = 0;
  private packet: PatternFactPacket | null = null;

  constructor(
    private readonly mutateWriter?: (writer: PatternWriterOutput) => void,
  ) {}

  private async success<T>(
    pass: "planner" | "writer" | "verifier",
    value: T,
    options: PatternPassOptions,
  ): Promise<PatternPassOutcome<T>> {
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
    const id = `resp_task_10_regression_${this.providerCalls}`;
    const raw = JSON.stringify({
      id,
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
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
        provider_request_id: id,
        input_tokens: 13,
        output_tokens: 8,
        provider_response_hash: await contentHash(raw),
      },
    };
  }

  async plan(
    input: unknown,
    options: PatternPassOptions,
  ): Promise<PatternPassOutcome<PatternPlan>> {
    const document = input as {
      packet: PatternFactPacket;
      ontology_records: PatternOntologyRecord[];
    };
    this.packet = document.packet;
    const plan = buildDeterministicPlan(
      document.packet,
      document.ontology_records,
    );
    return this.success(
      "planner",
      {
        ...plan,
        plan_hash: await contentHash(JSON.stringify(plan)),
        sparse_pattern: document.packet.selection_constraints.sparse_pattern,
      },
      options,
    );
  }

  async write(
    input: unknown,
    options: PatternPassOptions,
  ): Promise<PatternPassOutcome<PatternWriterOutput>> {
    const document = input as {
      plan: PatternPlan;
      ontology_records: PatternOntologyRecord[];
    };
    if (!this.packet) throw new Error("Regression planner packet missing");
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
    options: PatternPassOptions,
  ): Promise<PatternPassOutcome<PatternSemanticVerdict>> {
    const document = input as { candidate: PatternWriterOutput };
    return this.success(
      "verifier",
      evaluateSemanticVerdict(document.candidate, { forceReject: false }),
      options,
    );
  }
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
    OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION: "1.0.3",
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
    OPENAI_API_KEY: "task-10-hermetic-provider-key",
    AI_GATEWAY_ACCOUNT_ID: undefined,
    AI_GATEWAY_ID: undefined,
    AI_GATEWAY_TOKEN: undefined,
    PATTERN_ONTOLOGY_KEYS: JSON.stringify({
      [env.TEST_ONTOLOGY_SIGNER_KEY_ID]: {
        alg: "Ed25519",
        public_key: env.TEST_ONTOLOGY_SIGNER_PUBLIC_KEY,
      },
    }),
    ...overrides,
  };
  return Object.create(env, Object.getOwnPropertyDescriptors(values)) as Env;
}

function activationRecords(sourceId: string): PatternOntologyRecord[] {
  const regression = loadOntologyRegressionCorpus();
  const sourceTemplates = regression.manifest.reference_ontology_records.filter(
    (record) => record.meaning_class === "source_supported",
  );
  const records: PatternOntologyRecord[] = [];
  const sourceIdByTemplate = new Map<string, string>();
  const seenPredicates = new Set<string>();
  for (const fixture of regression.fixtures) {
    for (const feature of fixture.features) {
      const template = sourceTemplates.find((record) =>
        ontologyRecordMatchesFeature(record, feature));
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
      const id = `ont_${(records.length + 1).toString(16).padStart(32, "0")}`;
      records.push({
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
      feature_predicate: {
        type: "position" as const,
        body: "sun" as const,
        house: 1,
      },
      input_meaning_ids: record.input_meaning_ids.map((id) =>
        sourceIdByTemplate.get(id) ?? id),
    }));
  return [...records, ...derived];
}

interface PipelineHarness {
  pipelineEnv: Env;
  runId: string;
  version: string;
  records: PatternOntologyRecord[];
  messages: OntologyPipelineMessage[];
  ontologyPublisher: IntegrationOntologyPublisher;
  patternPublisher: IntegrationPatternPublisher;
  clock: TestClock;
}

async function registerCorpus(
  licenseClass: TestCorpusLicenseClass,
): Promise<TestCorpusManifest> {
  const manifest = await buildTestCorpusManifest(
    `corpus-task-10-${crypto.randomUUID()}`,
    "en-US",
    licenseClass,
  );
  manifest.fragments[0]!.allowed_transformations = [...ALL_TRANSFORMATIONS];
  const { corpus_hash: _oldHash, ...body } = manifest;
  manifest.corpus_hash = await contentHash(canonicalJson(body));
  const response = await SELF.fetch(
    "http://api.test/internal/ontology-corpora",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manifest),
    },
  );
  expect(response.status).toBe(201);
  return manifest;
}

async function createHarness(
  licenseClass: TestCorpusLicenseClass,
  options: {
    dailyLimit?: number;
    rejectedRuleId?: string | null;
    mutateWriter?: (writer: PatternWriterOutput) => void;
    envOverrides?: Partial<Env>;
  } = {},
): Promise<PipelineHarness> {
  const manifest = await registerCorpus(licenseClass);
  const records = activationRecords(manifest.fragments[0]!.id);
  const messages: OntologyPipelineMessage[] = [];
  const queue: Queue<OntologyPipelineMessage> = {
    metrics: async () => ({
      backlogCount: messages.length,
      backlogBytes: 0,
    }),
    send: async (message: OntologyPipelineMessage) => {
      messages.push(structuredClone(message));
      return {
        metadata: {
          metrics: {
            backlogCount: messages.length,
            backlogBytes: 0,
          },
        },
      };
    },
    sendBatch: async (batch) => {
      for (const message of batch) {
        messages.push(structuredClone(message.body));
      }
      return {
        metadata: {
          metrics: {
            backlogCount: messages.length,
            backlogBytes: 0,
          },
        },
      };
    },
  };
  const pipelineEnv = configuredEnv(queue, {
    ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT:
      String(options.dailyLimit ?? 500),
    ...options.envOverrides,
  });
  const clock = new TestClock();
  const version = `ontology-task-10-${crypto.randomUUID()}`;
  const reservation = await enqueueOntologyPipelineRun(
    pipelineEnv,
    {
      idempotencyKey: `task-10-${crypto.randomUUID()}`,
      corpusReleaseId: manifest.corpus_release_id,
      candidateOntologyVersion: version,
    },
    clock.now(),
  );
  return {
    pipelineEnv,
    runId: reservation.runId,
    version,
    records,
    messages,
    ontologyPublisher: new IntegrationOntologyPublisher(
      records,
      options.rejectedRuleId ?? null,
    ),
    patternPublisher: new IntegrationPatternPublisher(options.mutateWriter),
    clock,
  };
}

async function runRow(
  harness: PipelineHarness,
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    `SELECT stage, stage_generation, stage_cursor, stage_attempt,
            failure_class, candidate_hash, evaluation_report_hash,
            regression_report_hash, bundle_hash, succeeded_at
     FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
  ).bind(harness.runId).first<Record<string, unknown>>();
  if (!row) throw new Error("Ontology pipeline run missing");
  return row;
}

function failNextPipelineTransition(
  database: D1Database,
  transition: "stage" | "cursor",
): D1Database {
  let failed = false;
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver);
      return (query: string) => {
        const statement = target.prepare(query);
        const matches = transition === "stage"
          ? query.includes("candidate_hash = COALESCE")
          : query.includes("stage_cursor = stage_cursor + 1");
        if (!matches) return statement;
        return new Proxy(statement, {
          get(statementTarget, statementProperty, statementReceiver) {
            if (statementProperty !== "bind") {
              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            }
            return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              return new Proxy(bound, {
                get(boundTarget, boundProperty, boundReceiver) {
                  if (boundProperty === "run") {
                    return async () => {
                      if (!failed) {
                        failed = true;
                        throw new Error("injected post-provider D1 transition failure");
                      }
                      return boundTarget.run();
                    };
                  }
                  const value = Reflect.get(
                    boundTarget,
                    boundProperty,
                    boundReceiver,
                  );
                  return typeof value === "function"
                    ? value.bind(boundTarget)
                    : value;
                },
              });
            };
          },
        });
      };
    },
  });
}

async function releaseCrashedDelivery(
  harness: PipelineHarness,
): Promise<void> {
  const availableAt = harness.clock.now().toISOString();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL,
         available_at = ?, updated_at = ?
     WHERE run_id = ? AND claim_token IS NOT NULL`,
  ).bind(availableAt, availableAt, harness.runId).run();
  const row = await runRow(harness);
  harness.messages.push({
    run_id: harness.runId,
    stage_generation: row.stage_generation as number,
  });
}

function providerCallsFor(
  harness: PipelineHarness,
  stage: "generator" | "evaluator" | "regression",
): number {
  if (stage === "generator") return harness.ontologyPublisher.generatorCalls;
  if (stage === "evaluator") return harness.ontologyPublisher.evaluatorCalls;
  return harness.patternPublisher.providerCalls;
}

async function seedPriorActiveOntology(): Promise<string> {
  const version = `ontology-task-10-prior-${crypto.randomUUID()}`;
  await seedActiveOntology(version);
  return version;
}

async function expectPriorPointerPreserved(
  harness: PipelineHarness,
  priorVersion: string,
  failureClass: string,
  signedArtifactCount = 0,
): Promise<void> {
  expect(await runRow(harness)).toMatchObject({
    stage: "failed",
    failure_class: failureClass,
    succeeded_at: null,
  });
  expect(await env.DB.prepare(
    `SELECT p.active_version, r.status
     FROM pattern_ontology_pointer p
     JOIN pattern_ontology_releases r ON r.version = p.active_version
     WHERE p.id = 1`,
  ).first()).toEqual({
    active_version: priorVersion,
    status: "active",
  });
  expect(await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM pattern_ontology_releases
     WHERE version = ? AND status = 'active'`,
  ).bind(harness.version).first()).toEqual({ count: 0 });
  expect(await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM pattern_ontology_pipeline_artifacts
     WHERE run_id = ? AND artifact_class = 'signed_bundle'`,
  ).bind(harness.runId).first()).toEqual({ count: signedArtifactCount });
}

async function deliverNext(
  harness: PipelineHarness,
  envOverride = harness.pipelineEnv,
): Promise<OntologyPipelineExecuteOutcome> {
  const message = harness.messages.shift();
  if (!message) throw new Error("Durable ontology queue nudge missing");
  return executeOntologyPipelineDelivery(
    envOverride,
    message,
    {
      publisher: harness.ontologyPublisher,
      patternPublisher: harness.patternPublisher,
      clock: harness.clock.now,
    },
  );
}

async function runToStage(
  harness: PipelineHarness,
  target: string,
): Promise<Record<string, unknown>> {
  for (let delivery = 0; delivery < 256; delivery += 1) {
    const row = await runRow(harness);
    if (row.stage === target || row.stage === "failed" || row.stage === "succeeded") {
      return row;
    }
    const outcome = await deliverNext(harness);
    expect(outcome).toMatchObject({ status: "advanced" });
  }
  throw new Error(`Ontology pipeline did not reach ${target}`);
}

async function runToFailure(
  harness: PipelineHarness,
): Promise<Record<string, unknown>> {
  for (let delivery = 0; delivery < 256; delivery += 1) {
    const row = await runRow(harness);
    if (row.stage === "failed") return row;
    if (row.stage === "succeeded") {
      throw new Error("Ontology pipeline succeeded instead of failing closed");
    }
    const outcome = await deliverNext(harness);
    const after = await runRow(harness);
    expect(outcome).toMatchObject({
      status: after.stage === "failed" ? "terminal" : "advanced",
    });
  }
  throw new Error("Ontology pipeline did not reach failed");
}

async function publishReaderPattern(): Promise<{
  generationId: string;
  response: Response;
}> {
  await seedUser(IDENTITY_A);
  await confirmPreferences(USER_A);
  await seedChart(IDENTITY_A);
  enablePatternAi();
  env.PATTERN_INTERNAL_ACCOUNT_IDS = "";
  const reservation = await SELF.fetch(
    "http://api.test/v1/pattern-generations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `task-10-reader-${crypto.randomUUID()}`,
        "x-user-id": USER_A,
      },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: "1.0.0",
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    },
  );
  if (reservation.status !== 202) {
    return { generationId: "", response: reservation };
  }
  const body = await reservation.json<{
    generation: { generation_id: string };
  }>();
  const generationId = body.generation.generation_id;
  for (let step = 0; step < 8; step += 1) {
    const row = await env.DB.prepare(
      `SELECT job_id, stage, stage_generation
       FROM pattern_generation_jobs WHERE generation_id = ?`,
    ).bind(generationId).first<{
      job_id: string;
      stage: string;
      stage_generation: number;
    }>();
    if (!row) throw new Error("Reader Pattern job missing");
    if (row.stage === "succeeded") break;
    await executePatternJob(env, {
      kind: "pattern_generation",
      job_id: row.job_id,
      generation_id: generationId,
      stage_generation: row.stage_generation,
    });
  }
  return { generationId, response: reservation };
}

describe("automated ontology pipeline end to end", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
  });

  afterEach(() => {
    disablePatternAi();
  });

  it("activates an internal synthetic release through durable queue nudges without opening it to external accounts", async () => {
    const harness = await createHarness("internal_synthetic");

    const succeeded = await runToStage(harness, "succeeded");

    expect(succeeded).toMatchObject({
      stage: "succeeded",
      failure_class: null,
      succeeded_at: expect.any(String),
    });
    expect(harness.messages).toEqual([]);
    const active = await loadActiveOntology(harness.pipelineEnv);
    expect(active).toMatchObject({
      version: harness.version,
      activationScope: "internal",
      release: { provenance: { origin: "machine_pipeline" } },
    });
    const frozen = await env.DB.prepare(
      `SELECT configuration_json
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(harness.runId).first<{ configuration_json: string }>();
    const command = JSON.parse(frozen!.configuration_json) as {
      limits: {
        maximum_generation_chunks: number;
        maximum_evaluator_calls: number;
      };
      regression: {
        fixture_count: number;
        maximum_provider_calls_per_fixture: number;
      };
    };
    expect(
      command.limits.maximum_generation_chunks +
      command.limits.maximum_evaluator_calls +
      command.regression.fixture_count *
        command.regression.maximum_provider_calls_per_fixture,
    ).toBe(410);
    expect(
      harness.ontologyPublisher.generatorCalls +
      harness.ontologyPublisher.evaluatorCalls +
      harness.patternPublisher.providerCalls,
    ).toBeLessThanOrEqual(410);

    const attempted = await publishReaderPattern();
    expect(attempted.response.status).toBe(409);
    expect(await attempted.response.json()).toMatchObject({
      error: { code: "ontology_unavailable" },
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_generation_jobs WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({ count: 0 });
  }, 60_000);

  it("publishes a Pattern for a non-allowlisted account only after the licensed machine path activates", async () => {
    const harness = await createHarness("licensed_excerpt");

    expect(await runToStage(harness, "succeeded")).toMatchObject({
      stage: "succeeded",
      failure_class: null,
    });
    expect(await loadActiveOntology(harness.pipelineEnv)).toMatchObject({
      version: harness.version,
      activationScope: "public",
      release: { provenance: { origin: "machine_pipeline" } },
    });

    const published = await publishReaderPattern();
    expect(published.response.status).toBe(202);
    expect(published.generationId).toMatch(/^pgen_/);
    expect(await env.DB.prepare(
      `SELECT stage, ontology_version
       FROM pattern_generation_jobs WHERE generation_id = ?`,
    ).bind(published.generationId).first()).toEqual({
      stage: "succeeded",
      ontology_version: harness.version,
    });
    const response = await SELF.fetch("http://api.test/v1/pattern", {
      headers: { "x-user-id": USER_A },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schema_version: "0.7.0",
      core_chapters: expect.any(Array),
    });
  }, 60_000);

  it.each([
    { providerStage: "generator" as const, pipelineStage: "generating", transition: "stage" as const },
    { providerStage: "evaluator" as const, pipelineStage: "evaluating", transition: "cursor" as const },
    { providerStage: "regression" as const, pipelineStage: "regressing", transition: "cursor" as const },
  ])(
    "adopts the $providerStage artifact after D1 failure without a second call or charge",
    async ({ providerStage, pipelineStage, transition }) => {
      const harness = await createHarness("internal_synthetic");
      expect(await runToStage(harness, pipelineStage)).toMatchObject({
        stage: pipelineStage,
      });
      const failingEnv = configuredEnv(
        harness.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
        {
          DB: failNextPipelineTransition(env.DB, transition),
          PATTERN_ONTOLOGY_KEYS: harness.pipelineEnv.PATTERN_ONTOLOGY_KEYS,
        },
      );

      expect(await deliverNext(harness, failingEnv)).toEqual({
        status: "retry",
        retryAfterSeconds: 301,
      });
      const callsAfterFailure = providerCallsFor(harness, providerStage);
      const usageAfterFailure = await env.DB.prepare(
        `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
         FROM pattern_ontology_provider_daily_usage`,
      ).first<{
        used_calls: number;
        generator_calls: number;
        evaluator_calls: number;
        regression_calls: number;
      }>();
      expect(callsAfterFailure).toBeGreaterThan(0);
      expect(usageAfterFailure).not.toBeNull();
      expect(harness.messages).toEqual([]);

      await releaseCrashedDelivery(harness);
      expect(await deliverNext(harness)).toMatchObject({ status: "advanced" });

      expect(providerCallsFor(harness, providerStage)).toBe(callsAfterFailure);
      expect(await env.DB.prepare(
        `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
         FROM pattern_ontology_provider_daily_usage`,
      ).first()).toEqual(usageAfterFailure);
      expect(await runToStage(harness, "succeeded")).toMatchObject({
        stage: "succeeded",
        failure_class: null,
      });
    },
    60_000,
  );

  it("preserves the prior pointer when the evaluator rejects a candidate", async () => {
    const priorVersion = await seedPriorActiveOntology();
    const harness = await createHarness("internal_synthetic");
    harness.ontologyPublisher = new IntegrationOntologyPublisher(
      harness.records,
      harness.records[0]!.id,
    );

    expect(await runToFailure(harness)).toMatchObject({
      stage: "failed",
      failure_class: "evaluation_rejected",
    });
    await expectPriorPointerPreserved(
      harness,
      priorVersion,
      "evaluation_rejected",
    );
  }, 60_000);

  it("preserves the prior pointer when regression detects a prohibited claim", async () => {
    const priorVersion = await seedPriorActiveOntology();
    const harness = await createHarness("internal_synthetic", {
      mutateWriter: (writer) => {
        writer.chapters[0]!.sections[0]!.text =
          "This placement guarantees a future medical diagnosis.";
      },
    });

    expect(await runToFailure(harness)).toMatchObject({
      stage: "failed",
      failure_class: "regression_failed",
    });
    await expectPriorPointerPreserved(
      harness,
      priorVersion,
      "regression_failed",
    );
  }, 60_000);

  it("preserves the prior pointer when the provider budget is exhausted", async () => {
    const priorVersion = await seedPriorActiveOntology();
    const harness = await createHarness("internal_synthetic", { dailyLimit: 1 });

    expect(await runToFailure(harness)).toMatchObject({
      stage: "failed",
      failure_class: "provider_budget_exhausted",
    });
    expect(harness.ontologyPublisher.generatorCalls).toBe(1);
    expect(harness.ontologyPublisher.evaluatorCalls).toBe(0);
    await expectPriorPointerPreserved(
      harness,
      priorVersion,
      "provider_budget_exhausted",
    );
  }, 60_000);

  it("preserves the prior pointer when the isolated signer returns an invalid signature", async () => {
    const priorVersion = await seedPriorActiveOntology();
    const harness = await createHarness("internal_synthetic");
    expect(await runToStage(harness, "signing")).toMatchObject({
      stage: "signing",
    });
    const invalidSignerEnv = configuredEnv(
      harness.pipelineEnv.ONTOLOGY_PIPELINE_QUEUE,
      {
        ONTOLOGY_SIGNER: {
          signOntology: async (request) => ({
            ok: true,
            signature: {
              alg: "Ed25519",
              key_id: request.key_id,
              signature: "AA",
              signed_payload_hash: request.payload_hash,
            },
          }),
        },
      },
    );

    expect(await deliverNext(harness, invalidSignerEnv)).toEqual({
      status: "terminal",
    });
    await expectPriorPointerPreserved(
      harness,
      priorVersion,
      "signing_failed",
    );
  }, 60_000);

  it("preserves the prior pointer when signed evidence no longer matches its committed hash", async () => {
    const priorVersion = await seedPriorActiveOntology();
    const harness = await createHarness("internal_synthetic");
    expect(await runToStage(harness, "signing")).toMatchObject({
      stage: "signing",
    });
    expect(await deliverNext(harness)).toEqual({ status: "advanced" });
    expect(await runRow(harness)).toMatchObject({ stage: "ingesting" });
    const report = await env.DB.prepare(
      `SELECT object_key
       FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND artifact_class = 'evaluation_report'`,
    ).bind(harness.runId).first<{ object_key: string }>();
    const stored = await env.ARTIFACTS!.get(report!.object_key);
    const corrupted = new Uint8Array(await stored!.arrayBuffer());
    corrupted[0] = corrupted[0] === 0x7b ? 0x5b : 0x7b;
    await env.ARTIFACTS!.put(report!.object_key, corrupted);

    expect(await deliverNext(harness)).toEqual({ status: "terminal" });
    await expectPriorPointerPreserved(
      harness,
      priorVersion,
      "artifact_integrity_failed",
      1,
    );
  }, 60_000);
});
