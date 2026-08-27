import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  DETERMINISTIC_PATTERN_PUBLISHER,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  stripOntologyPipelineEvidence,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
  patternReplayTestEnv,
} from "../../test/pattern-replay-fixtures.js";
import { executePatternJob } from "./pattern-execute.js";
import {
  deleteCurrentPattern,
  recallOntologyAndWithdraw,
  reconcileMachineOntologyActivation,
  reconcilePatternAfterChartCorrection,
} from "./pattern-lifecycle.js";
import { patternReplayEventId } from "./pattern-replay-ledger.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const HASH_E = `sha256:${"e".repeat(64)}`;
const MACHINE_VERSION = "ontology-machine-lifecycle-test";
const SLICE_A_VERSION = "ontology-slice-a-lifecycle-test";

async function reserveAndPublishSliceAPattern(): Promise<string> {
  const response = await SELF.fetch(
    "http://api.test/v1/pattern-generations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "task-10-slice-a-pattern",
        "x-user-id": USER_A,
      },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: "1.1.0",
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    },
  );
  expect(response.status).toBe(202);
  const body = await response.json<{ generation: { generation_id: string } }>();
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
    if (!row) throw new Error("Pattern generation row missing");
    if (row.stage === "succeeded") return generationId;
    await executePatternJob(env, {
      kind: "pattern_generation",
      job_id: row.job_id,
      generation_id: generationId,
      stage_generation: row.stage_generation,
    }, new Date(), DETERMINISTIC_PATTERN_PUBLISHER);
  }
  throw new Error("Pattern generation did not succeed");
}

async function seedCommittedMachineActivation(): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pattern_ontology_releases
       SET status = 'superseded'
       WHERE version = ? AND status = 'active'`,
    ).bind(SLICE_A_VERSION),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_releases (
         version, bundle_hash, corpus_release_hash, locale, status, object_key,
         evaluation_json, created_at, recalled_at
       ) VALUES (?, ?, ?, 'en-US', 'active', ?, '{}', ?, NULL)`,
    ).bind(
      MACHINE_VERSION,
      HASH_A,
      HASH_B,
      `pattern-ontology/${MACHINE_VERSION}.json`,
      now,
    ),
    env.DB.prepare(
      `UPDATE pattern_ontology_pointer
       SET active_version = ?, updated_at = ? WHERE id = 1`,
    ).bind(MACHINE_VERSION, now),
    env.DB.prepare(
      `INSERT INTO pattern_ontology_pipeline_evidence (
         run_id, ontology_version, corpus_release_id, corpus_release_hash,
         corpus_license_class, corpus_public_capable, activation_scope,
         bundle_hash, evaluation_report_hash,
         evaluation_artifact_object_key, evaluation_artifact_envelope_hash,
         evaluation_artifact_ciphertext_hash, evaluation_artifact_status,
         signing_key_id, run_status, evidence_status, compiler_passed,
         evaluator_passed, unevaluated_fixture_count, created_at, committed_at
       ) VALUES (
         'oprun_task_10_lifecycle', ?, 'corpus-task-10-lifecycle', ?,
         'internal_synthetic', 0, 'internal', ?, ?,
         'pattern-ontology/pipeline/oprun_task_10_lifecycle/evaluation-report.enc',
         ?, ?, 'committed', 'task-10-signing-key', 'succeeded', 'committed',
         1, 1, 0, ?, ?
       )`,
    ).bind(
      MACHINE_VERSION,
      HASH_B,
      HASH_A,
      HASH_C,
      HASH_D,
      HASH_E,
      now,
      now,
    ),
  ]);
}

function unavailableReplayBucket(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, property, receiver) {
      if (property === "get") return async () => null;
      if (property === "put") {
        return async () => {
          throw new Error("injected replay outage");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("machine ontology activation lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    enablePatternAi();
    await seedActiveOntology(SLICE_A_VERSION);
  });

  afterEach(() => {
    disablePatternAi();
  });

  it("recalls a superseded Slice A release and withdraws every Pattern based on it", async () => {
    const generationId = await reserveAndPublishSliceAPattern();
    // Slice A is the pre-evidence release this reconcile exists for. A Pattern
    // can only be generated from a public, evidence-backed ontology now, so the
    // fixture publishes first and then strips the receipt rather than trying to
    // generate from a release the API would refuse.
    await stripOntologyPipelineEvidence(SLICE_A_VERSION);
    await seedCommittedMachineActivation();

    expect(await reconcileMachineOntologyActivation(env, MACHINE_VERSION)).toBe(1);

    expect(await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    ).bind(SLICE_A_VERSION).first()).toEqual({ status: "recalled" });
    expect(await env.DB.prepare(
      `SELECT active_version FROM pattern_ontology_pointer WHERE id = 1`,
    ).first()).toEqual({ active_version: MACHINE_VERSION });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_generation_claims WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({ status: "withdrawn" });
    expect(await env.DB.prepare(
      `SELECT wrapped_key_enc, erased_at
       FROM pattern_generation_artifact_keys WHERE generation_id = ?`,
    ).bind(generationId).first()).toEqual({
      wrapped_key_enc: null,
      erased_at: expect.any(String),
    });
    expect((await env.ARTIFACTS!.list({
      prefix: `pattern-generations/${generationId}/`,
    })).objects).toEqual([]);
    expect(await env.DB.prepare(
      `SELECT event_class, COUNT(*) AS count
       FROM pattern_erasure_replay_events
       WHERE event_class IN ('ontology_recalled', 'pattern_withdrawn')
       GROUP BY event_class ORDER BY event_class`,
    ).all()).toMatchObject({
      results: [
        { event_class: "ontology_recalled", count: 1 },
        { event_class: "pattern_withdrawn", count: 1 },
      ],
    });

    expect(await reconcileMachineOntologyActivation(env, MACHINE_VERSION)).toBe(0);
  });

  it("keeps an accepted Pattern readable when its delete intent cannot replicate", async () => {
    const generationId = await reserveAndPublishSliceAPattern();
    const unavailable = patternReplayTestEnv(env, {
      PATTERN_REPLAY_LEDGER: unavailableReplayBucket(env.PATTERN_REPLAY_LEDGER!),
    });

    await expect(deleteCurrentPattern(
      unavailable,
      IDENTITY_A,
      "idem-delete-replay-outage",
      new Date("2026-08-22T15:00:00.000Z"),
    )).rejects.toMatchObject({ code: "replay_replica_unavailable" });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first()).toEqual({ count: 1 });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_generation_claims WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({ status: "accepted" });
  });

  it("commits a reader deletion and its replay receipt atomically", async () => {
    const generationId = await reserveAndPublishSliceAPattern();
    const semanticKey = "idem-delete-receipt";

    await expect(deleteCurrentPattern(
      env,
      IDENTITY_A,
      semanticKey,
      new Date("2026-08-22T15:01:00.000Z"),
    )).resolves.toBe("accepted");
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT event_class FROM pattern_erasure_replay_events WHERE event_id = ?`,
    ).bind(await patternReplayEventId(
      "pattern_deleted",
      `${USER_A}:${semanticKey}`,
    )).first()).toEqual({ event_class: "pattern_deleted" });
  });

  it("writes chart-correction erasure ahead of the correction batch", async () => {
    const generationId = await reserveAndPublishSliceAPattern();
    const replacementChartId = "cht_replacement_test_0001";
    const unavailable = patternReplayTestEnv(env, {
      PATTERN_REPLAY_LEDGER: unavailableReplayBucket(env.PATTERN_REPLAY_LEDGER!),
    });

    await expect(reconcilePatternAfterChartCorrection(
      unavailable,
      IDENTITY_A,
      replacementChartId,
      new Date("2026-08-22T15:02:00.000Z"),
    )).rejects.toMatchObject({ code: "replay_replica_unavailable" });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_documents WHERE generation_id = ?`,
    ).bind(generationId).first()).toEqual({ count: 1 });

    await reconcilePatternAfterChartCorrection(
      env,
      IDENTITY_A,
      replacementChartId,
      new Date("2026-08-22T15:02:00.000Z"),
    );
    expect(await env.DB.prepare(
      `SELECT event_class FROM pattern_erasure_replay_events WHERE event_id = ?`,
    ).bind(await patternReplayEventId(
      "chart_correction_erased",
      replacementChartId,
    )).first()).toEqual({ event_class: "chart_correction_erased" });
  });

  it("does not recall an ontology when the recall intent cannot replicate", async () => {
    await reserveAndPublishSliceAPattern();
    const unavailable = patternReplayTestEnv(env, {
      PATTERN_REPLAY_LEDGER: unavailableReplayBucket(env.PATTERN_REPLAY_LEDGER!),
    });

    await expect(recallOntologyAndWithdraw(
      unavailable,
      SLICE_A_VERSION,
      "critical_defect",
    )).rejects.toMatchObject({ code: "replay_replica_unavailable" });
    expect(await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    ).bind(SLICE_A_VERSION).first()).toEqual({ status: "active" });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pattern_documents WHERE ontology_version = ?`,
    ).bind(SLICE_A_VERSION).first()).toEqual({ count: 1 });
  });
});
