import { canonicalJson, contentHash } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildTestEvaluationReport,
  testOntologyPipelineArtifactKeyring,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  advanceOntologyPipelineStage,
  claimOntologyPipelineRun,
  failOntologyPipelineRun,
  releaseExpiredOntologyPipelineLeases,
  retryOntologyPipelineStage,
  succeedOntologyPipelineRun,
  type ClaimedOntologyPipelineRun,
} from "../db/ontology-pipeline.js";
import {
  createOntologyPipelineArtifactEnvelope,
  ontologyPipelineArtifactIdentity,
  ontologyPipelineArtifactObjectKey,
  putOntologyPipelineArtifact,
  readOntologyPipelineArtifact,
  sweepExpiredOntologyPipelineArtifacts,
  type OntologyPipelineArtifactClass,
  type OntologyPipelineArtifactCoordinate,
  type OntologyPipelineStage,
} from "./ontology-pipeline-artifacts.js";
import type { Env } from "../env.js";

const HASH = (pair: string): string => `sha256:${pair.repeat(32)}`;
const TEST_NOW_MS = Date.now();
const RUN_CREATED_AT = new Date(
  TEST_NOW_MS - 10 * 24 * 60 * 60_000,
).toISOString();
const CLAIMED_AT = new Date(TEST_NOW_MS - 60_000);
const ARTIFACT_CREATED_AT = new Date(TEST_NOW_MS - 59_000).toISOString();
const FAILED_AT = new Date(TEST_NOW_MS - 58_000);
const PURGE_FAILED_AT = new Date(
  TEST_NOW_MS - 8 * 24 * 60 * 60_000,
);
const originalKeyring = env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING;

interface SeededRun {
  runId: string;
  ontologyVersion: string;
  stage: OntologyPipelineStage;
  stageGeneration: number;
}

const STAGES = [
  "corpus_reading",
  "generating",
  "compiling",
  "evaluating",
  "regressing",
  "signing",
  "ingesting",
] as const;

async function seedRunAt(stage: OntologyPipelineStage): Promise<SeededRun> {
  const suffix = crypto.randomUUID();
  const runId = `oprun_artifacts_${suffix}`;
  const corpusReleaseId = `corpus-artifacts-${suffix}`;
  const corpusHash = await contentHash(`artifact-corpus-${suffix}`);
  const ontologyVersion = `1.0.0-artifacts-${suffix}`;
  await env.DB.prepare(
    `INSERT INTO pattern_source_corpus_releases (
       corpus_release_id, corpus_hash, locale, object_key, fragment_count,
       license_class, public_capable, created_at, registered_at
     ) VALUES (?, ?, 'en-US', ?, 1, 'internal_synthetic', 0, ?, ?)`,
  ).bind(
    corpusReleaseId,
    corpusHash,
    `pattern-ontology-corpora/${corpusReleaseId}.json`,
    RUN_CREATED_AT,
    RUN_CREATED_AT,
  ).run();
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pipeline_runs (
       run_id, idempotency_key, corpus_release_id, corpus_hash,
       candidate_ontology_version, configuration_json, configuration_hash,
       stage, stage_generation, stage_cursor, stage_attempt, claim_token,
       lease_expires_at, available_at, dispatched_at, failure_class,
       candidate_hash, compilation_report_hash, evaluation_report_hash,
       regression_report_hash, bundle_hash, failed_artifact_expires_at,
       created_at, updated_at, finished_at, succeeded_at, failed_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, 0, 0, NULL, NULL, ?, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL
     )`,
  ).bind(
    runId,
    `ontology-artifacts-${suffix}`,
    corpusReleaseId,
    corpusHash,
    ontologyVersion,
    canonicalJson({ test: "artifact-boundary" }),
    HASH("a2"),
    RUN_CREATED_AT,
    RUN_CREATED_AT,
    RUN_CREATED_AT,
  ).run();

  const target = STAGES.indexOf(stage);
  for (let index = 0; index <= target; index += 1) {
    const next = STAGES[index]!;
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = ?, stage_generation = ?, stage_cursor = 0,
           stage_attempt = 0, claim_token = NULL, lease_expires_at = NULL,
           dispatched_at = NULL, updated_at = ?,
           candidate_hash = CASE WHEN ? = 'compiling' THEN ? ELSE candidate_hash END,
           compilation_report_hash = CASE WHEN ? = 'evaluating' THEN ? ELSE compilation_report_hash END,
           evaluation_report_hash = CASE WHEN ? = 'regressing' THEN ? ELSE evaluation_report_hash END,
           regression_report_hash = CASE WHEN ? = 'signing' THEN ? ELSE regression_report_hash END,
           bundle_hash = CASE WHEN ? = 'ingesting' THEN ? ELSE bundle_hash END
       WHERE run_id = ?`,
    ).bind(
      next,
      index + 1,
      RUN_CREATED_AT,
      next,
      HASH("b1"),
      next,
      HASH("b2"),
      next,
      HASH("b3"),
      next,
      HASH("b4"),
      next,
      HASH("b5"),
      runId,
    ).run();
  }
  return {
    runId,
    ontologyVersion,
    stage,
    stageGeneration: target + 1,
  };
}

function coordinate(
  run: SeededRun,
  artifactClass: OntologyPipelineArtifactClass,
  stageAttempt = 0,
): OntologyPipelineArtifactCoordinate {
  return {
    runId: run.runId,
    stage: run.stage,
    stageGeneration: run.stageGeneration,
    stageAttempt,
    artifactClass,
  };
}

async function claimRun(
  run: SeededRun,
  claimToken = `ontology-artifact-claim-${crypto.randomUUID()}`,
  now = CLAIMED_AT,
): Promise<ClaimedOntologyPipelineRun> {
  const claim = await claimOntologyPipelineRun(
    env,
    { run_id: run.runId, stage_generation: run.stageGeneration },
    now,
    claimToken,
  );
  expect(claim.status).toBe("claimed");
  if (claim.status !== "claimed") throw new Error("artifact test claim failed");
  return claim;
}

function overriddenEnv(overrides: Partial<Env>): Env {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property, overrides);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as Env;
}

async function putR2OnlyArtifact(
  run: SeededRun,
  artifactClass: OntologyPipelineArtifactClass,
  stageAttempt = 0,
): Promise<string> {
  const identity = coordinate(run, artifactClass, stageAttempt);
  const sealed = await createOntologyPipelineArtifactEnvelope(
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
    { ...identity, ontologyVersion: run.ontologyVersion },
    new TextEncoder().encode(`orphan-${artifactClass}-${stageAttempt}`),
  );
  const objectKey = await ontologyPipelineArtifactObjectKey(identity);
  await env.ARTIFACTS!.put(objectKey, sealed.envelopeBytes, {
    customMetadata: {
      artifact_id: await ontologyPipelineArtifactIdentity(identity),
      coordinate_sha256: await contentHash(canonicalJson({
        artifact_class: identity.artifactClass,
        run_id: identity.runId,
        stage: identity.stage,
        stage_attempt: identity.stageAttempt,
        stage_generation: identity.stageGeneration,
      })),
    },
  });
  return objectKey;
}

async function putInventoriedPastArtifact(
  run: SeededRun,
  artifactClass: OntologyPipelineArtifactClass,
): Promise<{ id: string; objectKey: string }> {
  const identity = coordinate(run, artifactClass);
  const plaintext = new TextEncoder().encode("inventoried failed artifact");
  const sealed = await createOntologyPipelineArtifactEnvelope(
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
    { ...identity, ontologyVersion: run.ontologyVersion },
    plaintext,
  );
  const id = await ontologyPipelineArtifactIdentity(identity);
  const objectKey = await ontologyPipelineArtifactObjectKey(identity);
  await env.ARTIFACTS!.put(objectKey, sealed.envelopeBytes, {
    customMetadata: {
      artifact_id: id,
      coordinate_sha256: await contentHash(canonicalJson({
        artifact_class: identity.artifactClass,
        run_id: identity.runId,
        stage: identity.stage,
        stage_attempt: identity.stageAttempt,
        stage_generation: identity.stageGeneration,
      })),
    },
  });
  await env.DB.prepare(
    `INSERT INTO pattern_ontology_pipeline_artifacts (
       id, run_id, stage, stage_generation, stage_attempt, artifact_class,
       object_key, plaintext_sha256, envelope_sha256, ciphertext_sha256,
       envelope_key_id, envelope_nonce, byte_length, created_at,
       expires_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    id,
    identity.runId,
    identity.stage,
    identity.stageGeneration,
    identity.stageAttempt,
    identity.artifactClass,
    objectKey,
    sealed.plaintextSha256,
    sealed.envelopeSha256,
    sealed.ciphertextSha256,
    sealed.envelopeKeyId,
    sealed.envelopeNonce,
    sealed.byteLength,
    new Date(PURGE_FAILED_AT.getTime() - 60_000).toISOString(),
  ).run();
  return { id, objectKey };
}

beforeEach(() => {
  env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING =
    testOntologyPipelineArtifactKeyring();
});

afterEach(() => {
  env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING = originalKeyring;
});

describe("ontology pipeline encrypted artifacts", () => {
  it.each([
    ["generating", "generator_request"],
    ["generating", "generator_response"],
    ["generating", "candidate_chunk"],
    ["compiling", "candidate_release"],
    ["compiling", "compilation_report"],
    ["evaluating", "evaluator_request"],
    ["evaluating", "evaluator_response"],
    ["evaluating", "evaluator_verdict"],
    ["evaluating", "evaluation_report"],
    ["regressing", "regression_request"],
    ["regressing", "regression_response"],
    ["regressing", "regression_result"],
    ["regressing", "regression_report"],
    ["signing", "unsigned_bundle"],
    ["signing", "signed_bundle"],
    ["ingesting", "ingestion_receipt"],
  ] as const)("encrypts %s/%s and persists metadata only", async (stage, artifactClass) => {
    const run = await seedRunAt(stage);
    const identity = coordinate(run, artifactClass);
    const claim = await claimRun(run);
    const secret = `PRIVATE-${artifactClass}-${crypto.randomUUID()}`;
    const plaintext = new TextEncoder().encode(canonicalJson({ secret }));

    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    const object = await env.ARTIFACTS!.get(stored.artifact.objectKey);
    expect(object).not.toBeNull();
    const envelopeBytes = new Uint8Array(await object!.arrayBuffer());
    expect(new TextDecoder().decode(envelopeBytes)).not.toContain(secret);

    const recovered = await readOntologyPipelineArtifact(env, identity);
    expect(recovered?.plaintext).toEqual(plaintext);
    expect(recovered?.artifact).toEqual(stored.artifact);

    const row = await env.DB.prepare(
      `SELECT * FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.artifact.id).first<Record<string, unknown>>();
    expect(row).not.toBeNull();
    expect(Object.keys(row ?? {})).not.toContain("plaintext");
    expect(JSON.stringify(row)).not.toContain(secret);

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("keeps the existing evaluation-report envelope identity compatible", async () => {
    const run = await seedRunAt("evaluating");
    const identity = coordinate(run, "evaluation_report");
    const claim = await claimRun(run, "ontology-evaluation-legacy-owner");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode(canonicalJson({
        compiler_passed: true,
        evaluator_passed: true,
        ontology_version: run.ontologyVersion,
        schema_version: "0.7.0",
        unevaluated_fixture_count: 0,
      })),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );

    expect(stored.artifact.objectKey).toBe(
      `pattern-ontology/pipeline/${run.runId}/evaluation-report.enc`,
    );
    const object = await env.ARTIFACTS!.get(stored.artifact.objectKey);
    const envelope = JSON.parse(await object!.text()) as Record<string, unknown>;
    expect(envelope.schema_version).toBe("ontology-evaluation-artifact/v1");
    expect(Object.keys(envelope).sort()).toEqual([
      "artifact_class",
      "ciphertext",
      "ciphertext_hash",
      "encryption",
      "ontology_version",
      "plaintext_hash",
      "run_id",
      "schema_version",
    ]);

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("authenticates true-retry evaluation reports with their attempt coordinate", async () => {
    const run = await seedRunAt("evaluating");
    const identity = coordinate(run, "evaluation_report", 1);
    const sealed = await createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      new TextEncoder().encode(buildTestEvaluationReport(run.ontologyVersion)),
    );

    expect(await ontologyPipelineArtifactObjectKey(identity)).toMatch(
      /\/opart_[a-f0-9]{40}\.enc$/,
    );
    expect(JSON.parse(new TextDecoder().decode(sealed.envelopeBytes)))
      .toMatchObject({
        schema_version: "ontology-pipeline-artifact/v1",
        stage: "evaluating",
        stage_generation: run.stageGeneration,
        stage_attempt: 1,
      });
  });

  it("keeps evaluation envelopes within the existing admission byte ceiling", async () => {
    const run = await seedRunAt("evaluating");
    const identity = coordinate(run, "evaluation_report");

    await expect(createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      new Uint8Array(3_200_000),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_too_large" });
  });

  it("derives different create-only identities for attempts at one generation", async () => {
    const run = await seedRunAt("generating");
    const first = coordinate(run, "generator_response", 0);
    const second = coordinate(run, "generator_response", 1);

    expect(await ontologyPipelineArtifactIdentity(first))
      .not.toBe(await ontologyPipelineArtifactIdentity(second));
    expect(await ontologyPipelineArtifactObjectKey(first))
      .not.toBe(await ontologyPipelineArtifactObjectKey(second));
  });

  it("adopts an exact stored artifact before any budget reservation", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "generator_response");
    const claim = await claimRun(run, "ontology-artifact-adoption-owner");
    const plaintext = new TextEncoder().encode("exact provider response bytes");
    const first = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    const replay = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );

    expect(first.status).toBe("created");
    expect(replay).toEqual({ ...first, status: "adopted" });
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_ontology_pipeline_artifacts
       WHERE run_id = ? AND stage_generation = ? AND stage_attempt = ?
         AND artifact_class = ?`,
    ).bind(
      run.runId,
      run.stageGeneration,
      0,
      "generator_response",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1);
    expect(await env.DB.prepare(
      `SELECT used_calls FROM pattern_ontology_provider_daily_usage
       WHERE utc_date = '2026-08-21'`,
    ).first()).toBeNull();

    await env.ARTIFACTS!.delete(first.artifact.objectKey);
  });

  it("repairs an R2-first torn write only after decrypting the full stored identity", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "candidate_chunk");
    const claim = await claimRun(run, "ontology-artifact-torn-put-owner");
    const plaintext = new TextEncoder().encode(canonicalJson({ chunk: 1 }));
    const sealed = await createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      plaintext,
      Uint8Array.from({ length: 12 }, (_, index) => index + 1),
    );
    const objectKey = await ontologyPipelineArtifactObjectKey(identity);
    await env.ARTIFACTS!.put(objectKey, sealed.envelopeBytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: {
        artifact_id: await ontologyPipelineArtifactIdentity(identity),
        coordinate_sha256: await contentHash(canonicalJson({
          artifact_class: identity.artifactClass,
          run_id: identity.runId,
          stage: identity.stage,
          stage_attempt: identity.stageAttempt,
          stage_generation: identity.stageGeneration,
        })),
      },
    });

    const repaired = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(repaired.status).toBe("adopted");
    expect(repaired.artifact.envelopeNonce).toBe(sealed.envelopeNonce);
    await expect(readOntologyPipelineArtifact(env, identity))
      .resolves.toMatchObject({ plaintext });

    await env.ARTIFACTS!.delete(objectKey);
  });

  it("discovers and reconciles a crash-after-R2 response at the pre-provider read seam", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-r2-first-read-owner");
    const identity = coordinate(run, "generator_response");
    const plaintext = new TextEncoder().encode("provider response stored before D1");
    const sealed = await createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      plaintext,
      Uint8Array.from({ length: 12 }, (_, index) => 40 + index),
    );
    const id = await ontologyPipelineArtifactIdentity(identity);
    const objectKey = await ontologyPipelineArtifactObjectKey(identity);
    const coordinateHash = await contentHash(canonicalJson({
      artifact_class: identity.artifactClass,
      run_id: identity.runId,
      stage: identity.stage,
      stage_attempt: identity.stageAttempt,
      stage_generation: identity.stageGeneration,
    }));
    await env.ARTIFACTS!.put(objectKey, sealed.envelopeBytes, {
      customMetadata: {
        artifact_id: id,
        coordinate_sha256: coordinateHash,
      },
    });

    const recovered = await readOntologyPipelineArtifact(env, identity, {
      claim,
      clock: () => new Date(ARTIFACT_CREATED_AT),
    });
    expect(recovered).toMatchObject({
      artifact: {
        id,
        objectKey,
        plaintextSha256: sealed.plaintextSha256,
      },
      plaintext,
    });
    expect(await env.DB.prepare(
      `SELECT plaintext_sha256 FROM pattern_ontology_pipeline_artifacts
       WHERE id = ?`,
    ).bind(id).first()).toEqual({ plaintext_sha256: sealed.plaintextSha256 });

    await env.ARTIFACTS!.delete(objectKey);
  });

  it("requires the exact unexpired claim for create and R2-first adoption", async () => {
    const run = await seedRunAt("generating");
    const claimedAt = new Date(Date.now() - 5 * 60_000 - 1_000);
    const owner = await claimRun(
      run,
      "ontology-artifact-expired-owner",
      claimedAt,
    );
    const stale = { ...owner, claimToken: "ontology-artifact-stale-owner" };

    await expect(putOntologyPipelineArtifact(
      env,
      coordinate(run, "generator_request"),
      new TextEncoder().encode("request"),
      stale,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });

    const afterExpiry = new Date();
    await expect(putOntologyPipelineArtifact(
      env,
      coordinate(run, "generator_response"),
      new TextEncoder().encode("late response"),
      owner,
      afterExpiry,
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });

    expect(await releaseExpiredOntologyPipelineLeases(env, afterExpiry, 100))
      .toBeGreaterThan(0);
    const successor = await claimRun(
      run,
      "ontology-artifact-successor-owner",
      afterExpiry,
    );
    await expect(putOntologyPipelineArtifact(
      env,
      coordinate(run, "candidate_chunk"),
      new TextEncoder().encode("successor chunk"),
      owner,
      afterExpiry,
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });
    const stored = await putOntologyPipelineArtifact(
      env,
      coordinate(run, "candidate_chunk"),
      new TextEncoder().encode("successor chunk"),
      successor,
      afterExpiry,
    );
    expect(stored.status).toBe("created");
    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("binds artifact admission to the claim's exact stored lease tuple", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "generator_request");
    const claim = await claimRun(run, "ontology-artifact-exact-lease-owner");
    const forgedLease = {
      ...claim,
      leaseExpiresAt: new Date(
        Date.parse(claim.leaseExpiresAt) + 1_000,
      ).toISOString(),
    };

    await expect(putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("request under a different lease tuple"),
      forgedLease,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });
    expect(await env.DB.prepare(
      `SELECT id FROM pattern_ontology_pipeline_artifacts WHERE run_id = ?`,
    ).bind(run.runId).first()).toBeNull();

    await env.ARTIFACTS!.delete(
      await ontologyPipelineArtifactObjectKey(identity),
    );
  });

  it("uses D1 admission time when a lease expires during the awaited R2 put", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "generator_response");
    const claimAt = new Date(Date.now() - 5 * 60_000 + 300);
    const claim = await claimRun(
      run,
      "ontology-artifact-r2-put-expiry-owner",
      claimAt,
    );
    const delayedBucket = new Proxy(env.ARTIFACTS!, {
      get(target, property, receiver) {
        if (property === "put") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            const result = await target.put(...args);
            await new Promise((resolve) => setTimeout(resolve, 450));
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const pipelineEnv = overriddenEnv({
      ARTIFACTS: delayedBucket,
    });

    await expect(putOntologyPipelineArtifact(
      pipelineEnv,
      identity,
      new TextEncoder().encode("response crossing lease expiry"),
      claim,
      claimAt,
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });
    expect(await env.DB.prepare(
      `SELECT id FROM pattern_ontology_pipeline_artifacts WHERE run_id = ?`,
    ).bind(run.runId).first()).toBeNull();

    await env.ARTIFACTS!.delete(
      await ontologyPipelineArtifactObjectKey(identity),
    );
  });

  it("does not return a raced artifact row after the exact owner is lost", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "candidate_chunk");
    const claim = await claimRun(run, "ontology-artifact-raced-row-owner");
    let intercepted = false;
    const racedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          const statement = target.prepare(query);
          if (!query.includes("INSERT INTO pattern_ontology_pipeline_artifacts")) {
            return statement;
          }
          return {
            bind: (...values: unknown[]) => {
              const bound = statement.bind(...values);
              return {
                run: async () => {
                  await bound.run();
                  intercepted = true;
                  expect(await retryOntologyPipelineStage(
                    env,
                    claim,
                    new Date(),
                  )).toBe(true);
                  throw new Error("uncertain D1 artifact admission result");
                },
              };
            },
          } as unknown as D1PreparedStatement;
        };
      },
    }) as D1Database;
    const pipelineEnv = overriddenEnv({ DB: racedDb });

    await expect(putOntologyPipelineArtifact(
      pipelineEnv,
      identity,
      new TextEncoder().encode("raced artifact row"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });
    expect(intercepted).toBe(true);
    expect(await env.DB.prepare(
      `SELECT stage_attempt, claim_token FROM pattern_ontology_pipeline_runs
       WHERE run_id = ?`,
    ).bind(run.runId).first()).toEqual({ stage_attempt: 1, claim_token: null });

    await env.ARTIFACTS!.delete(
      await ontologyPipelineArtifactObjectKey(identity),
    );
  });

  it("revalidates exact ownership after the awaited R2 read", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "generator_response");
    const claim = await claimRun(run, "ontology-artifact-r2-get-owner");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("stored response"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    let ownerReleased = false;
    const stealingBucket = new Proxy(env.ARTIFACTS!, {
      get(target, property, receiver) {
        if (property === "get") {
          return async (...args: Parameters<R2Bucket["get"]>) => {
            const object = await target.get(...args);
            if (!ownerReleased) {
              ownerReleased = true;
              expect(await retryOntologyPipelineStage(
                env,
                claim,
                new Date(),
              )).toBe(true);
            }
            return object;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const pipelineEnv = overriddenEnv({
      ARTIFACTS: stealingBucket,
    });

    await expect(readOntologyPipelineArtifact(pipelineEnv, identity, { claim }))
      .rejects.toMatchObject({ code: "ontology_pipeline_artifact_stale_owner" });
    expect(ownerReleased).toBe(true);

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("rejects BOM-prefixed canonical envelopes during R2 adoption", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-artifact-bom-owner");
    const identity = coordinate(run, "generator_response");
    const plaintext = new TextEncoder().encode("provider response");
    const sealed = await createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      plaintext,
    );
    const id = await ontologyPipelineArtifactIdentity(identity);
    const objectKey = await ontologyPipelineArtifactObjectKey(identity);
    const prefixed = new Uint8Array(sealed.envelopeBytes.byteLength + 3);
    prefixed.set([0xef, 0xbb, 0xbf]);
    prefixed.set(sealed.envelopeBytes, 3);
    await env.ARTIFACTS!.put(objectKey, prefixed, {
      customMetadata: {
        artifact_id: id,
        coordinate_sha256: await contentHash(canonicalJson({
          artifact_class: identity.artifactClass,
          run_id: identity.runId,
          stage: identity.stage,
          stage_attempt: identity.stageAttempt,
          stage_generation: identity.stageGeneration,
        })),
      },
    });

    await expect(putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_conflict" });
    expect(await env.DB.prepare(
      `SELECT id FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(id).first()).toBeNull();
    await env.ARTIFACTS!.delete(objectKey);
  });

  it("refuses an R2-only compatible evaluation envelope without attempt identity", async () => {
    const run = await seedRunAt("evaluating");
    const claim = await claimRun(run, "ontology-evaluation-metadata-owner");
    const identity = coordinate(run, "evaluation_report");
    const plaintext = new TextEncoder().encode(buildTestEvaluationReport(
      run.ontologyVersion,
    ));
    const sealed = await createOntologyPipelineArtifactEnvelope(
      env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING,
      { ...identity, ontologyVersion: run.ontologyVersion },
      plaintext,
    );
    const objectKey = await ontologyPipelineArtifactObjectKey(identity);
    // Historical Task 9 envelopes intentionally have no stage/generation
    // fields. They remain readable by evidence admission, but cannot prove a
    // Task 5 torn write's complete attempt coordinate on their own.
    await env.ARTIFACTS!.put(objectKey, sealed.envelopeBytes, {
      onlyIf: { etagDoesNotMatch: "*" },
    });

    await expect(putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_conflict" });
    expect(await env.DB.prepare(
      `SELECT id FROM pattern_ontology_pipeline_artifacts WHERE object_key = ?`,
    ).bind(objectKey).first()).toBeNull();

    await env.ARTIFACTS!.delete(objectKey);
  });

  it("refuses a create-only object collision without overwriting it", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-artifact-collision-owner");
    const identity = coordinate(run, "generator_request");
    const objectKey = await ontologyPipelineArtifactObjectKey(identity);
    const occupied = "PRIVATE OCCUPIED OBJECT";
    await env.ARTIFACTS!.put(objectKey, occupied);

    await expect(putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("different request"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_conflict" });
    expect(await (await env.ARTIFACTS!.get(objectKey))!.text()).toBe(occupied);
    expect(await env.DB.prepare(
      `SELECT id FROM pattern_ontology_pipeline_artifacts WHERE object_key = ?`,
    ).bind(objectKey).first()).toBeNull();

    await env.ARTIFACTS!.delete(objectKey);
  });

  it("refuses adoption when any stored ciphertext identity no longer matches", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "generator_response");
    const claim = await claimRun(run, "ontology-artifact-tamper-owner");
    const plaintext = new TextEncoder().encode("provider response");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    await env.ARTIFACTS!.put(stored.artifact.objectKey, "tampered-envelope");

    await expect(putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    )).rejects.toMatchObject({ code: "ontology_pipeline_artifact_conflict" });
    await expect(readOntologyPipelineArtifact(env, identity))
      .rejects.toMatchObject({ code: "ontology_pipeline_artifact_integrity_failed" });

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("assigns failed retention from the actual terminal instant and never at creation", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "candidate_chunk");
    const claim = await claimRun(run, "ontology-artifact-retention-claim");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("candidate chunk"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(await env.DB.prepare(
      `SELECT expires_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.artifact.id).first()).toEqual({ expires_at: null });

    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      FAILED_AT,
    )).toBe(true);

    const expiry = new Date(
      FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    ).toISOString();
    expect(await env.DB.prepare(
      `SELECT failed_at, failed_artifact_expires_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(run.runId).first()).toEqual({
      failed_at: FAILED_AT.toISOString(),
      failed_artifact_expires_at: expiry,
    });
    expect(await env.DB.prepare(
      `SELECT created_at, expires_at
       FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.artifact.id).first()).toEqual({
      created_at: ARTIFACT_CREATED_AT,
      expires_at: expiry,
    });

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("refuses failed-artifact reads at the exact seven-day boundary", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-artifact-expiry-owner");
    const identity = coordinate(run, "candidate_chunk");
    const plaintext = new TextEncoder().encode("expiring candidate chunk");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );

    await expect(readOntologyPipelineArtifact(env, identity, {
      clock: () => new Date(expiresAt.getTime() - 1),
    })).resolves.toMatchObject({ plaintext });
    await expect(readOntologyPipelineArtifact(env, identity, {
      clock: () => expiresAt,
    })).rejects.toMatchObject({ code: "ontology_pipeline_artifact_unavailable" });

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("rechecks expiry with a fresh clock after the awaited R2 read", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-artifact-cross-expiry-owner");
    const identity = coordinate(run, "candidate_chunk");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("plaintext must not cross expiry"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );
    const readings = [
      new Date(expiresAt.getTime() - 1),
      expiresAt,
    ];
    let clockCalls = 0;

    await expect(readOntologyPipelineArtifact(env, identity, {
      clock: () => readings[Math.min(clockCalls++, readings.length - 1)]!,
    })).rejects.toMatchObject({ code: "ontology_pipeline_artifact_unavailable" });
    expect(clockCalls).toBeGreaterThanOrEqual(2);

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("purges an R2-only failed-run orphan at the exact retention boundary", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-orphan-boundary-owner");
    const objectKey = await putR2OnlyArtifact(run, "generator_response");
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      PURGE_FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      PURGE_FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );

    await sweepExpiredOntologyPipelineArtifacts(
      env,
      new Date(expiresAt.getTime() - 1),
    );
    expect(await env.ARTIFACTS!.head(objectKey)).not.toBeNull();

    await sweepExpiredOntologyPipelineArtifacts(env, expiresAt);
    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_type = 'ontology_pipeline_run' AND resource_id = ?`,
    ).bind(run.runId).first()).toEqual({ count: 1 });

    // A completion marker is a scheduling cursor, never a permanent skip.
    // A later stale R2-only write must be found by the marked-run rescan.
    await putR2OnlyArtifact(run, "generator_response");
    await sweepExpiredOntologyPipelineArtifacts(
      env,
      new Date(expiresAt.getTime() + 15 * 60_000),
    );
    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_type = 'ontology_pipeline_run' AND resource_id = ?`,
    ).bind(run.runId).first()).toEqual({ count: 1 });
  });

  it("drains failed-run orphan prefixes in bounded pages before marking complete", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-orphan-pages-owner");
    for (const attempt of [0, 1]) {
      for (const artifactClass of [
        "generator_request",
        "generator_response",
        "candidate_chunk",
      ] as const) {
        await putR2OnlyArtifact(run, artifactClass, attempt);
      }
    }
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      PURGE_FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      PURGE_FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );
    const prefix = `pattern-ontology/pipeline/${run.runId}/`;

    await sweepExpiredOntologyPipelineArtifacts(env, expiresAt);
    expect((await env.ARTIFACTS!.list({ prefix })).objects).toHaveLength(2);
    expect(await env.DB.prepare(
      `SELECT id FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_id = ?`,
    ).bind(run.runId).first()).toBeNull();

    await sweepExpiredOntologyPipelineArtifacts(
      env,
      new Date(expiresAt.getTime() + 15 * 60_000),
    );
    expect((await env.ARTIFACTS!.list({ prefix })).objects).toHaveLength(0);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_id = ?`,
    ).bind(run.runId).first()).toEqual({ count: 1 });
  });

  it("leaves a failed-run orphan retryable when R2 deletion fails", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-orphan-r2-failure-owner");
    const objectKey = await putR2OnlyArtifact(run, "candidate_chunk");
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      PURGE_FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      PURGE_FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );
    const failingBucket = new Proxy(env.ARTIFACTS!, {
      get(target, property, receiver) {
        if (property === "delete") {
          return async () => { throw new Error("R2 delete unavailable"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;

    await sweepExpiredOntologyPipelineArtifacts(
      overriddenEnv({ ARTIFACTS: failingBucket }),
      expiresAt,
    );
    expect(await env.ARTIFACTS!.head(objectKey)).not.toBeNull();
    expect(await env.DB.prepare(
      `SELECT id FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_id = ?`,
    ).bind(run.runId).first()).toBeNull();

    await sweepExpiredOntologyPipelineArtifacts(env, expiresAt);
    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
  });

  it("recovers the D1 tombstone after R2 deletion succeeded", async () => {
    const run = await seedRunAt("generating");
    const claim = await claimRun(run, "ontology-retention-d1-failure-owner");
    const stored = await putInventoriedPastArtifact(run, "candidate_chunk");
    expect(await failOntologyPipelineRun(
      env,
      claim,
      "execution_error",
      PURGE_FAILED_AT,
    )).toBe(true);
    const expiresAt = new Date(
      PURGE_FAILED_AT.getTime() + 7 * 24 * 60 * 60_000,
    );
    let failedOnce = false;
    const failingDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (query: string) => {
          const statement = target.prepare(query);
          if (
            !failedOnce &&
            query.includes("UPDATE pattern_ontology_pipeline_artifacts") &&
            query.includes("SET deleted_at")
          ) {
            failedOnce = true;
            return {
              bind: () => ({
                run: async () => { throw new Error("D1 tombstone unavailable"); },
              }),
            } as unknown as D1PreparedStatement;
          }
          return statement;
        };
      },
    }) as D1Database;

    await expect(sweepExpiredOntologyPipelineArtifacts(
      overriddenEnv({ DB: failingDb }),
      expiresAt,
    )).rejects.toThrow("D1 tombstone unavailable");
    expect(await env.ARTIFACTS!.head(stored.objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT deleted_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.id).first()).toEqual({ deleted_at: null });

    await sweepExpiredOntologyPipelineArtifacts(env, expiresAt);
    expect(await env.DB.prepare(
      `SELECT deleted_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.id).first()).toEqual({
      deleted_at: expiresAt.toISOString(),
    });
  });

  it("never prefix-purges an R2-only object for a succeeded run", async () => {
    const run = await seedRunAt("ingesting");
    const claim = await claimRun(run, "ontology-success-orphan-owner");
    const objectKey = await putR2OnlyArtifact(run, "ingestion_receipt");
    expect(await succeedOntologyPipelineRun(env, claim, FAILED_AT)).toBe(true);

    await sweepExpiredOntologyPipelineArtifacts(env, new Date());
    expect(await env.ARTIFACTS!.head(objectKey)).not.toBeNull();
    expect(await env.DB.prepare(
      `SELECT id FROM audit_events
       WHERE action = 'ontology_pipeline.artifacts_purge_verified'
         AND resource_id = ?`,
    ).bind(run.runId).first()).toBeNull();

    await env.ARTIFACTS!.delete(objectKey);
  });

  it("keeps successful evidence unexpired", async () => {
    const run = await seedRunAt("ingesting");
    const identity = coordinate(run, "ingestion_receipt");
    const claim = await claimRun(run, "ontology-artifact-success-claim");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      new TextEncoder().encode("ingestion receipt"),
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(await succeedOntologyPipelineRun(env, claim, FAILED_AT)).toBe(true);
    expect(await env.DB.prepare(
      `SELECT expires_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(stored.artifact.id).first()).toEqual({ expires_at: null });

    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });

  it("reads immutable prior-stage artifacts after a successor transition", async () => {
    const run = await seedRunAt("generating");
    const identity = coordinate(run, "candidate_chunk");
    const plaintext = new TextEncoder().encode("complete candidate chunk");
    const claim = await claimRun(run, "ontology-prior-stage-read-claim");
    const stored = await putOntologyPipelineArtifact(
      env,
      identity,
      plaintext,
      claim,
      new Date(ARTIFACT_CREATED_AT),
    );
    expect(await advanceOntologyPipelineStage(
      env,
      claim,
      "compiling",
      { candidateHash: stored.artifact.plaintextSha256 },
      FAILED_AT,
    )).toBe(true);

    await expect(readOntologyPipelineArtifact(env, identity)).resolves.toEqual({
      artifact: stored.artifact,
      plaintext,
    });
    await env.ARTIFACTS!.delete(stored.artifact.objectKey);
  });
});
