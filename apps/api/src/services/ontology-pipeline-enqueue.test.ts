import { env } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import {
  canonicalJson,
  contentHash,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { describe, expect, it, vi } from "vitest";

import {
  APPROVED_COVERAGE_HINT_CORPUS_HASH,
  APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
  APPROVED_COVERAGE_HINT_FRAGMENT_ID,
  APPROVED_COVERAGE_HINT_FRAGMENT_IDS,
  buildApprovedCoverageHintCorpusManifest,
  buildTestCorpusManifest,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  advanceOntologyPipelineCursor,
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
  releaseExpiredOntologyPipelineLeases,
  retryOntologyPipelineStage,
  succeedOntologyPipelineRun,
} from "../db/ontology-pipeline.js";
import type { Env, OntologyPipelineMessage } from "../env.js";
import {
  buildOntologyPipelineCommand,
  loadOntologyPipelinePredecessor,
  ONTOLOGY_PIPELINE_COMMAND_VERSION,
  type OntologyPipelineCommand,
} from "./ontology-pipeline-command.js";
import {
  buildOntologyCoverageSourceHints,
} from "./ontology-coverage-source-hints.js";
import {
  dispatchUndispatchedOntologyPipelineRuns,
  enqueueOntologyPipelineRun,
  pauseOntologyPipelineDelivery,
} from "./ontology-pipeline-enqueue.js";
import { registerOntologyCorpus } from "./ontology-corpus.js";
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";

const NOW = new Date(Date.now() - 60_000);

function afterNow(milliseconds: number): Date {
  return new Date(NOW.getTime() + milliseconds);
}

function fakeQueue(failures = 0): {
  queue: Queue<OntologyPipelineMessage>;
  send: ReturnType<typeof vi.fn>;
} {
  let remaining = failures;
  const send = vi.fn(async () => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error("queue unavailable");
    }
  });
  return {
    queue: { send } as unknown as Queue<OntologyPipelineMessage>,
    send,
  };
}

function configuredEnv(queue: Queue<OntologyPipelineMessage>): Env {
  return Object.assign(Object.create(env), {
    ONTOLOGY_PIPELINE_QUEUE: queue,
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
    OPENAI_API_KEY: "test-provider-key-never-frozen",
    AI_GATEWAY_ACCOUNT_ID: undefined,
    AI_GATEWAY_ID: undefined,
    AI_GATEWAY_TOKEN: undefined,
  }) as Env;
}

async function registeredCorpus(): Promise<{
  releaseId: string;
  corpusHash: string;
  excerpt: string;
  objectKey: string;
}> {
  const releaseId = `corpus-enqueue-${crypto.randomUUID()}`;
  const manifest = await buildTestCorpusManifest(
    releaseId,
    "en-US",
    "internal_synthetic",
  );
  const registered = await registerOntologyCorpus(env, manifest);
  return {
    releaseId,
    corpusHash: manifest.corpus_hash,
    excerpt: manifest.fragments[0]!.excerpt,
    objectKey: registered.corpus.objectKey,
  };
}

async function reserve(
  pipelineEnv: Env,
  corpusReleaseId: string,
  suffix = crypto.randomUUID(),
  now = NOW,
) {
  return enqueueOntologyPipelineRun(
    pipelineEnv,
    {
      idempotencyKey: `ontology-enqueue-${suffix}`,
      corpusReleaseId,
      candidateOntologyVersion: `1.0.0-pipeline-${suffix}`,
    },
    now,
  );
}

async function seedRunStageForCas(
  runId: string,
  target: "reserved" | "generating" | "ingesting",
): Promise<void> {
  if (target === "reserved") return;
  const stages = [
    "corpus_reading",
    "generating",
    "compiling",
    "evaluating",
    "regressing",
    "signing",
    "ingesting",
  ] as const;
  const finalIndex = stages.indexOf(target);
  for (let index = 0; index <= finalIndex; index += 1) {
    const stage = stages[index]!;
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = ?, stage_generation = ?, stage_cursor = 0, stage_attempt = 0,
           claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL,
           candidate_hash = COALESCE(candidate_hash, ?),
           compilation_report_hash = COALESCE(compilation_report_hash, ?),
           evaluation_report_hash = COALESCE(evaluation_report_hash, ?),
           regression_report_hash = COALESCE(regression_report_hash, ?),
           bundle_hash = COALESCE(bundle_hash, ?)
       WHERE run_id = ?`,
    ).bind(
      stage,
      index + 1,
      stage === "compiling" ? `sha256:${"3".repeat(64)}` : null,
      stage === "evaluating" ? `sha256:${"4".repeat(64)}` : null,
      stage === "regressing" ? `sha256:${"5".repeat(64)}` : null,
      stage === "signing" ? `sha256:${"6".repeat(64)}` : null,
      stage === "ingesting" ? `sha256:${"7".repeat(64)}` : null,
      runId,
    ).run();
  }
}

async function seedActiveMachinePredecessor(): Promise<{
  version: string;
  bundleHash: string;
  corpusHash: string;
  objectKey: string;
}> {
  const version = `ontology-command-predecessor-${crypto.randomUUID()}`;
  const release = syntheticOntologyRelease(version) as PatternOntologyRelease;
  // Machine bundles are signed/stored as candidates; D1 is the activation
  // authority and projects this row as active through the pointer.
  release.status = "candidate";
  release.provenance = { origin: "machine_pipeline" };
  const bundleHash = await computeOntologyBundleHash(release);
  release.bundle_hash = bundleHash;
  const objectKey = `pattern-ontology/${version}.json`;
  await env.ARTIFACTS!.put(objectKey, canonicalJson(release));
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_releases (
       version, bundle_hash, corpus_release_hash, locale, status, object_key,
       evaluation_json, created_at, recalled_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
  ).bind(
    version,
    bundleHash,
    release.corpus_release_hash,
    release.locale,
    objectKey,
    canonicalJson(release.evaluation),
    NOW.toISOString(),
  ).run();
  await env.DB.prepare(
    `UPDATE pattern_ontology_pointer SET active_version = ?, updated_at = ?
     WHERE id = 1`,
  ).bind(version, NOW.toISOString()).run();
  return {
    version,
    bundleHash,
    corpusHash: release.corpus_release_hash,
    objectKey,
  };
}

describe("ontology pipeline immutable command", () => {
  it("freezes the full reviewed identity and equal-model 100% threshold", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const command = await buildOntologyPipelineCommand(
      configuredEnv(queue),
      corpus.releaseId,
      "1.0.0-candidate",
    );

    expect(ONTOLOGY_PIPELINE_COMMAND_VERSION).toBe("OntologyPipelineCommandV4");
    expect(command).toEqual({
      command_version: ONTOLOGY_PIPELINE_COMMAND_VERSION,
      schema_version: "0.7.0",
      provider: "openai",
      candidate_ontology_version: "1.0.0-candidate",
      corpus: {
        corpus_release_id: corpus.releaseId,
        corpus_hash: corpus.corpusHash,
        license_class: "internal_synthetic",
        public_capable: false,
        object_key: corpus.objectKey,
      },
      generator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        prompt_version: "1.0.5",
        timeout_ms: 120000,
        max_output_tokens: 8000,
      },
      evaluator: {
        model: "gpt-5.6-sol",
        reasoning: "high",
        prompt_version: "1.0.0-evaluator",
        timeout_ms: 120000,
        max_output_tokens: 4000,
      },
      generator_input: {
        feature_vocabulary: [
          "position",
          "aspect",
          "pattern",
          "angle",
          "house_cusp",
          "uncertainty",
        ],
        coverage_targets: [
          { feature_class: "position", minimum_source_supported: 1, minimum_total: 1 },
          { feature_class: "aspect", minimum_source_supported: 1, minimum_total: 1 },
          { feature_class: "pattern", minimum_source_supported: 1, minimum_total: 1 },
          { feature_class: "angle", minimum_source_supported: 1, minimum_total: 1 },
          { feature_class: "house_cusp", minimum_source_supported: 1, minimum_total: 1 },
          { feature_class: "uncertainty", minimum_source_supported: 1, minimum_total: 1 },
        ],
        coverage_source_hints: [],
        active_machine_predecessor: null,
      },
      input_max_bytes: 98304,
      limits: {
        maximum_generation_chunks: 16,
        maximum_candidate_records: 64,
        maximum_evaluator_calls: 64,
        maximum_candidate_bytes: 262144,
      },
      policy: {
        ontology_schema_version: "0.7.0",
        feature_policy_version: "1.0.0",
        compiler_policy_version: "1.0.0",
        regression_policy_version: "1.0.0",
        prohibited_claim_policy_version: "1.0.0",
        selection_policy_id: "pattern-selection-policy",
        selection_policy_version: "1.0.0",
        validation_policy_id: "pattern-validation-policy",
        validation_policy_version: "1.0.0",
        prohibited_claims: [
          "diagnosis",
          "prediction",
          "fate",
          "biographical fact",
        ],
      },
      configuration_equal: true,
      regression: {
        fixture_count: 30,
        maximum_provider_calls_per_fixture: 11,
        minimum_pass_rate: 1,
      },
      daily_provider_call_limit: 500,
      failed_artifact_retention_days: 7,
    });
    expect(
      command.limits.maximum_generation_chunks +
      command.limits.maximum_evaluator_calls +
      command.regression.fixture_count *
        command.regression.maximum_provider_calls_per_fixture,
    ).toBe(410);
    const frozen = JSON.stringify(command);
    expect(frozen).not.toContain(corpus.excerpt);
    expect(frozen).not.toContain("test-provider-key-never-frozen");
    expect(frozen).not.toContain("fragments");
  });

  it("freezes the exact approved corpus hint into the immutable command", async () => {
    const manifest = await buildApprovedCoverageHintCorpusManifest();
    expect(manifest.corpus_release_id).toBe(
      APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
    );
    expect(manifest.corpus_hash).toBe(APPROVED_COVERAGE_HINT_CORPUS_HASH);
    expect(manifest.fragments.some((fragment) =>
      fragment.id === APPROVED_COVERAGE_HINT_FRAGMENT_ID
    )).toBe(true);
    await registerOntologyCorpus(env, manifest);
    const { queue } = fakeQueue();

    const command = await buildOntologyPipelineCommand(
      configuredEnv(queue),
      manifest.corpus_release_id,
      "0.1.6",
    );

    expect(command.generator_input.coverage_source_hints).toEqual([
      {
        feature_class: "position",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.sun,
        feature_predicate: { type: "position", body: "sun" },
      },
      {
        feature_class: "position",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.moon,
        feature_predicate: { type: "position", body: "moon" },
      },
      {
        feature_class: "aspect",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.conjunction,
        feature_predicate: { type: "aspect", aspect: "conjunction" },
      },
      {
        feature_class: "aspect",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.square,
        feature_predicate: { type: "aspect", aspect: "square" },
      },
      {
        feature_class: "aspect",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.trine,
        feature_predicate: { type: "aspect", aspect: "trine" },
      },
      {
        feature_class: "aspect",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.sextile,
        feature_predicate: { type: "aspect", aspect: "sextile" },
      },
      {
        feature_class: "pattern",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.stellium,
        feature_predicate: { type: "pattern", pattern: "stellium" },
      },
      {
        feature_class: "uncertainty",
        source_fragment_id: APPROVED_COVERAGE_HINT_FRAGMENT_IDS.uncertainty,
        feature_predicate: { type: "uncertainty" },
      },
    ]);
    expect(command.generator_input).not.toHaveProperty("fragments");
    expect(command.generator_input.coverage_source_hints[0]).not.toHaveProperty(
      "normalized_proposition",
    );
  });

  it("fails closed when the approved corpus id resolves to a stale hash", async () => {
    const stale = await buildTestCorpusManifest(
      APPROVED_COVERAGE_HINT_CORPUS_RELEASE_ID,
      "en-US",
      "licensed_excerpt",
    );
    expect(stale.corpus_hash).not.toBe(APPROVED_COVERAGE_HINT_CORPUS_HASH);
    expect(buildOntologyCoverageSourceHints({
      release: stale,
      canonicalBytes: canonicalJson(stale),
      objectKey:
        `pattern-ontology-corpora/${stale.corpus_release_id}.json`,
      licenseClass: "licensed_excerpt",
      publicCapable: true,
      fragmentIndex: new Map(stale.fragments.map((fragment) => [
        fragment.id,
        fragment,
      ])),
    })).toEqual({
      ok: false,
    });
  });

  it("rejects replaying a V3 command identity after the V4 exact-hint freeze", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const idempotencyKey = `ontology-v1-conflict-${suffix}`;
    const candidateVersion = `1.0.0-v1-conflict-${suffix}`;
    const current = await buildOntologyPipelineCommand(
      pipelineEnv,
      corpus.releaseId,
      candidateVersion,
    );
    const oldShape = { ...current } as Record<string, unknown>;
    oldShape.command_version = "OntologyPipelineCommandV3";
    const oldJson = canonicalJson(oldShape);
    const oldHash = await contentHash(oldJson);
    const runId = `oprun_v2_conflict_${suffix}`;
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
      idempotencyKey,
      corpus.releaseId,
      corpus.corpusHash,
      candidateVersion,
      oldJson,
      oldHash,
      NOW.toISOString(),
      NOW.toISOString(),
      NOW.toISOString(),
    ).run();
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET dispatched_at = ? WHERE run_id = ?`,
    ).bind(NOW.toISOString(), runId).run();

    await expect(enqueueOntologyPipelineRun(
      pipelineEnv,
      { idempotencyKey, corpusReleaseId: corpus.releaseId, candidateOntologyVersion: candidateVersion },
      NOW,
    )).rejects.toMatchObject({ code: "ontology_pipeline_command_conflict" });
    expect(await env.DB.prepare(
      `SELECT configuration_json, configuration_hash
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(runId).first()).toEqual({
      configuration_json: oldJson,
      configuration_hash: oldHash,
    });
  });

  it("freezes coverage and a content-addressed active predecessor before pointer mutation", async () => {
    const predecessor = await seedActiveMachinePredecessor();
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const reserved = await reserve(pipelineEnv, corpus.releaseId, suffix);
    const before = await env.DB.prepare(
      `SELECT configuration_json, configuration_hash
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first<{
      configuration_json: string;
      configuration_hash: string;
    }>();
    const command = JSON.parse(before!.configuration_json) as OntologyPipelineCommand;
    expect(command.generator_input.active_machine_predecessor).toEqual({
      ontology_version: predecessor.version,
      bundle_hash: predecessor.bundleHash,
      corpus_release_hash: predecessor.corpusHash,
      locale: "en-US",
      object_key: predecessor.objectKey,
    });
    expect(command.generator_input.coverage_targets).toHaveLength(6);
    expect(before!.configuration_json).not.toContain('"records":');

    await env.DB.prepare(
      `UPDATE pattern_ontology_pointer SET active_version = NULL, updated_at = ?
       WHERE id = 1`,
    ).bind(new Date(NOW.getTime() + 1_000).toISOString()).run();
    await expect(loadOntologyPipelinePredecessor(
      pipelineEnv,
      command.generator_input.active_machine_predecessor,
    )).resolves.toMatchObject({
      version: predecessor.version,
      bundleHash: predecessor.bundleHash,
      objectKey: predecessor.objectKey,
    });
    pipelineEnv.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = "501";
    await expect(reserve(pipelineEnv, corpus.releaseId, suffix))
      .rejects.toMatchObject({ code: "ontology_pipeline_command_conflict" });
    expect(await env.DB.prepare(
      `SELECT configuration_json, configuration_hash
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(reserved.runId).first()).toEqual(before);
  });
});

describe("ontology pipeline reservation and outbox", () => {
  it("replays an exact immutable command without rewriting or redispatching", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const first = await reserve(pipelineEnv, corpus.releaseId, suffix);
    const replay = await reserve(pipelineEnv, corpus.releaseId, suffix);

    expect(first.status).toBe("reserved");
    expect(replay).toEqual({ ...first, status: "replay" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      run_id: first.runId,
      stage_generation: 0,
    });
    expect(Object.keys(send.mock.calls[0]![0] as object).sort()).toEqual([
      "run_id",
      "stage_generation",
    ]);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first()).toEqual({ count: 1 });
  });

  it("refuses a duplicate key when any frozen command field differs", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    await reserve(pipelineEnv, corpus.releaseId, suffix);
    pipelineEnv.ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT = "501";

    await expect(reserve(pipelineEnv, corpus.releaseId, suffix))
      .rejects.toMatchObject({ code: "ontology_pipeline_command_conflict" });
    expect(await env.DB.prepare(
      `SELECT configuration_json FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first<{ configuration_json: string }>())
      .toMatchObject({ configuration_json: expect.stringContaining('"daily_provider_call_limit":500') });
  });

  it("admits one durable row under a concurrent last-writer reservation race", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const results = await Promise.all([
      reserve(pipelineEnv, corpus.releaseId, suffix),
      reserve(pipelineEnv, corpus.releaseId, suffix),
    ]);

    expect(results.map((result) => result.status).sort())
      .toEqual(["replay", "reserved"]);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_runs
       WHERE idempotency_key = ?`,
    ).bind(`ontology-enqueue-${suffix}`).first()).toEqual({ count: 1 });
  });

  it("rethrows a non-identity reservation insert failure", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const operationalFailure = new Error("d1 reservation unavailable");
    const failingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          if (query.includes("INSERT INTO pattern_ontology_pipeline_runs")) {
            return {
              bind: () => ({
                run: async () => { throw operationalFailure; },
              }),
            } as unknown as D1PreparedStatement;
          }
          return target.prepare(query);
        };
      },
    }) as D1Database;
    const pipelineEnv = new Proxy(configuredEnv(queue), {
      get(target, property, receiver) {
        if (property === "DB") return failingDb;
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(reserve(pipelineEnv, corpus.releaseId))
      .rejects.toBe(operationalFailure);
  });

  it("does not misclassify an operational insert failure as a matching race", async () => {
    const corpus = await registeredCorpus();
    const { queue } = fakeQueue();
    const suffix = crypto.randomUUID();
    await reserve(configuredEnv(queue), corpus.releaseId, suffix);

    const operationalFailure = new Error("D1_ERROR: disk I/O error");
    let occupiedLookupCount = 0;
    const failingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          if (query.includes("INSERT INTO pattern_ontology_pipeline_runs")) {
            return {
              bind: () => ({
                run: async () => { throw operationalFailure; },
              }),
            } as unknown as D1PreparedStatement;
          }
          if (
            query.includes("FROM pattern_ontology_pipeline_runs") &&
            query.includes("WHERE idempotency_key = ? OR candidate_ontology_version = ?") &&
            occupiedLookupCount++ === 0
          ) {
            return {
              bind: () => ({ first: async () => null }),
            } as unknown as D1PreparedStatement;
          }
          return target.prepare(query);
        };
      },
    }) as D1Database;
    const pipelineEnv = new Proxy(configuredEnv(queue), {
      get(target, property, receiver) {
        if (property === "DB") return failingDb;
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(reserve(pipelineEnv, corpus.releaseId, suffix))
      .rejects.toBe(operationalFailure);
  });

  it("leaves a failed send durable and the undispatched sweep repairs it", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue(1);
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    expect(result.dispatched).toBe(false);
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({ dispatched_at: null });

    expect(await dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare(
      `SELECT dispatched_at FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({ dispatched_at: NOW.toISOString() });
  });

  it("batches the bounded default outbox marks with D1 query headroom", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue(12);
    const pipelineEnv = configuredEnv(queue);
    for (let index = 0; index < 12; index += 1) {
      await reserve(pipelineEnv, corpus.releaseId, `bounded-outbox-${crypto.randomUUID()}`);
    }
    let ontologyQueries = 0;
    const countedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          if (query.includes("pattern_ontology_pipeline_runs")) ontologyQueries += 1;
          return target.prepare(query);
        };
      },
    }) as D1Database;

    await expect(dispatchUndispatchedOntologyPipelineRuns(
      new Proxy(pipelineEnv, {
        get(target, property, receiver) {
          if (property === "DB") return countedDb;
          return Reflect.get(target, property, receiver);
        },
      }),
      NOW,
    )).resolves.toEqual({ dispatched: 4, failed: 0 });
    expect(ontologyQueries).toBeLessThanOrEqual(2);
    expect(send).toHaveBeenCalledTimes(16);
    // Permanent Task 2 run identities intentionally survive the test; drain
    // the remaining bounded pages so later outbox assertions stay isolated.
    await dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW);
    await dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW);
  });

  it("does not dispatch an exact replay before retry backoff expires", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const suffix = crypto.randomUUID();
    const result = await reserve(pipelineEnv, corpus.releaseId, suffix);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-backoff",
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await retryOntologyPipelineStage(
      env,
      claim,
      afterNow(20 * 60_000),
    )).toBe(true);

    await expect(reserve(pipelineEnv, corpus.releaseId, suffix)).resolves
      .toMatchObject({ status: "replay", dispatched: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a rollout-paused outbox quiet until rollout resumes", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    expect(await pauseOntologyPipelineDelivery(
      pipelineEnv,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
    )).toBe(true);
    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "off";

    await expect(dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .resolves.toEqual({ dispatched: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);

    pipelineEnv.ONTOLOGY_PIPELINE_ROLLOUT = "internal";
    await expect(dispatchUndispatchedOntologyPipelineRuns(pipelineEnv, NOW))
      .resolves.toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("ontology pipeline generation and claim CAS", () => {
  it("rejects every owned write after the exact stored lease expires", async () => {
    const corpus = await registeredCorpus();
    const expiredClaimAt = new Date(Date.now() - 10 * 60_000);
    const cases = [
      {
        name: "fail",
        stage: "reserved" as const,
        write: (claim: Extract<Awaited<ReturnType<typeof claimOntologyPipelineRun>>, { status: "claimed" }>) =>
          failOntologyPipelineRun(env, claim, "execution_error", new Date()),
      },
      {
        name: "retry",
        stage: "reserved" as const,
        write: (claim: Extract<Awaited<ReturnType<typeof claimOntologyPipelineRun>>, { status: "claimed" }>) =>
          retryOntologyPipelineStage(env, claim, new Date()),
      },
      {
        name: "named-stage",
        stage: "reserved" as const,
        write: (claim: Extract<Awaited<ReturnType<typeof claimOntologyPipelineRun>>, { status: "claimed" }>) =>
          advanceOntologyPipelineStage(env, claim, "corpus_reading", {}, new Date()),
      },
      {
        name: "cursor",
        stage: "generating" as const,
        write: (claim: Extract<Awaited<ReturnType<typeof claimOntologyPipelineRun>>, { status: "claimed" }>) =>
          advanceOntologyPipelineCursor(env, claim, new Date()),
      },
      {
        name: "succeed",
        stage: "ingesting" as const,
        write: (claim: Extract<Awaited<ReturnType<typeof claimOntologyPipelineRun>>, { status: "claimed" }>) =>
          succeedOntologyPipelineRun(env, claim, new Date()),
      },
    ];

    for (const item of cases) {
      const result = await reserve(
        configuredEnv(fakeQueue().queue),
        corpus.releaseId,
        `expired-${item.name}-${crypto.randomUUID()}`,
        new Date(expiredClaimAt.getTime() - 60_000),
      );
      await seedRunStageForCas(result.runId, item.stage);
      const claim = await claimOntologyPipelineRun(
        env,
        { run_id: result.runId, stage_generation: item.stage === "reserved" ? 0 : item.stage === "generating" ? 2 : 7 },
        expiredClaimAt,
        `expired-${item.name}`,
      );
      expect(claim.status).toBe("claimed");
      if (claim.status !== "claimed") continue;
      const before = await env.DB.prepare(
        `SELECT stage, stage_generation, stage_cursor, stage_attempt,
                claim_token, lease_expires_at, failure_class
         FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
      ).bind(result.runId).first();
      expect(await item.write(claim)).toBe(false);
      expect(await env.DB.prepare(
        `SELECT stage, stage_generation, stage_cursor, stage_attempt,
                claim_token, lease_expires_at, failure_class
         FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
      ).bind(result.runId).first()).toEqual(before);
      await releaseExpiredOntologyPipelineLeases(env, new Date(), 100);
      const cleanup = await claimOntologyPipelineRun(
        env,
        {
          run_id: result.runId,
          stage_generation: item.stage === "reserved" ? 0 : item.stage === "generating" ? 2 : 7,
        },
        new Date(),
        `cleanup-${item.name}`,
      );
      if (cleanup.status === "claimed") {
        await failOntologyPipelineRun(env, cleanup, "execution_error", new Date());
      }
    }
  });

  it("binds owned writes to the exact stored lease timestamp", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      new Date(),
      "claim-exact-lease",
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await retryOntologyPipelineStage(env, {
      ...claim,
      leaseExpiresAt: new Date(Date.parse(claim.leaseExpiresAt) + 1).toISOString(),
    }, new Date())).toBe(false);
    expect(await env.DB.prepare(
      `SELECT stage_attempt, claim_token, lease_expires_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage_attempt: 0,
      claim_token: claim.claimToken,
      lease_expires_at: claim.leaseExpiresAt,
    });
    await failOntologyPipelineRun(env, claim, "execution_error", new Date());
  });

  it("claims exactly five minutes and rejects claim theft", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const message = { run_id: result.runId, stage_generation: 0 };
    const claim = await claimOntologyPipelineRun(env, message, NOW, "claim-owner-a");
    expect(claim).toMatchObject({
      status: "claimed",
      claimToken: "claim-owner-a",
      leaseExpiresAt: afterNow(5 * 60_000).toISOString(),
    });
    await expect(claimOntologyPipelineRun(env, message, NOW, "claim-thief"))
      .resolves.toEqual({ status: "duplicate" });
    if (claim.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        claim,
        "execution_error",
        afterNow(1_000),
      );
    }
  });

  it("rejects a stale owner and retries at the same generation", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-live",
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await retryOntologyPipelineStage(
      env,
      { ...claim, claimToken: "claim-stale" },
      afterNow(10_000),
    )).toBe(false);
    expect(await retryOntologyPipelineStage(
      env,
      claim,
      afterNow(10_000),
    )).toBe(true);
    expect(await env.DB.prepare(
      `SELECT stage_generation, stage_attempt, claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage_generation: 0,
      stage_attempt: 1,
      claim_token: null,
      dispatched_at: null,
    });
    const cleanup = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      afterNow(10_000),
      "claim-retry-cleanup",
    );
    if (cleanup.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        cleanup,
        "execution_error",
        afterNow(11_000),
      );
    }
  });

  it("advances iterative cursors and named stages by successor generation", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    const reserved = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-reserved",
    );
    expect(reserved.status).toBe("claimed");
    if (reserved.status !== "claimed") return;
    expect(await advanceOntologyPipelineStage(
      env,
      reserved,
      "corpus_reading",
      {},
      afterNow(1_000),
    )).toBe(true);
    const corpusClaim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 1 },
      afterNow(1_000),
      "claim-corpus",
    );
    expect(corpusClaim.status).toBe("claimed");
    if (corpusClaim.status !== "claimed") return;
    expect(await advanceOntologyPipelineStage(
      env,
      corpusClaim,
      "generating",
      {},
      afterNow(2_000),
    )).toBe(true);
    const generating = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 2 },
      afterNow(2_000),
      "claim-generating",
    );
    expect(generating.status).toBe("claimed");
    if (generating.status !== "claimed") return;
    expect(await advanceOntologyPipelineCursor(
      env,
      generating,
      afterNow(3_000),
    )).toBe(true);
    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, stage_cursor, stage_attempt,
              claim_token, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage: "generating",
      stage_generation: 3,
      stage_cursor: 1,
      stage_attempt: 0,
      claim_token: null,
      dispatched_at: null,
    });
    const cleanup = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 3 },
      afterNow(3_000),
      "claim-cursor-cleanup",
    );
    if (cleanup.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        cleanup,
        "execution_error",
        afterNow(4_000),
      );
    }
  });

  it("recovers an expired lease without spending an attempt and redelivers", async () => {
    const corpus = await registeredCorpus();
    const { queue, send } = fakeQueue();
    const pipelineEnv = configuredEnv(queue);
    const result = await reserve(pipelineEnv, corpus.releaseId);
    const claim = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      NOW,
      "claim-crashed",
    );
    expect(claim.status).toBe("claimed");

    const afterExpiry = afterNow(5 * 60_000 + 1_000);
    expect(await releaseExpiredOntologyPipelineLeases(env, afterExpiry)).toBe(1);
    expect(await dispatchUndispatchedOntologyPipelineRuns(
      pipelineEnv,
      afterExpiry,
    )).toEqual({ dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const recovered = await claimOntologyPipelineRun(
      env,
      { run_id: result.runId, stage_generation: 0 },
      afterExpiry,
      "claim-redelivery",
    );
    expect(recovered).toMatchObject({
      status: "claimed",
      stageGeneration: 0,
      stageAttempt: 0,
      claimToken: "claim-redelivery",
    });
    if (recovered.status === "claimed") {
      await failOntologyPipelineRun(
        env,
        recovered,
        "execution_error",
        new Date(afterExpiry.getTime() + 1),
      );
    }
  });

  it("terminally bounds repeated expired-lease claims at the durable ceiling", async () => {
    const corpus = await registeredCorpus();
    const result = await reserve(configuredEnv(fakeQueue().queue), corpus.releaseId);
    let claimAt = NOW;
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      const claim = await claimOntologyPipelineRun(
        env,
        { run_id: result.runId, stage_generation: 0 },
        claimAt,
        `ontology-expiry-cycle-${attempt}`,
      );
      expect(claim.status).toBe("claimed");
      const afterExpiry = new Date(claimAt.getTime() + 5 * 60_000 + 1);
      const released = await releaseExpiredOntologyPipelineLeases(
        env,
        afterExpiry,
        4,
      );
      expect(released).toBe(attempt === 16 ? 0 : 1);
      claimAt = afterExpiry;
    }

    expect(await env.DB.prepare(
      `SELECT stage, failure_class, claim_token, lease_expires_at,
              failed_at, failed_artifact_expires_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(result.runId).first()).toEqual({
      stage: "failed",
      failure_class: "attempts_exhausted",
      claim_token: null,
      lease_expires_at: null,
      failed_at: claimAt.toISOString(),
      failed_artifact_expires_at:
        new Date(claimAt.getTime() + 7 * 86400_000).toISOString(),
    });
  });
});
