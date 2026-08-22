import { env, SELF } from "cloudflare:test";
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
import { executePatternJob } from "./pattern-execute.js";
import { reconcileMachineOntologyActivation } from "./pattern-lifecycle.js";

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
        consent_policy_version: "1.0.0",
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
    });
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

describe("machine ontology activation lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
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

    expect(await reconcileMachineOntologyActivation(env, MACHINE_VERSION)).toBe(0);
  });
});
